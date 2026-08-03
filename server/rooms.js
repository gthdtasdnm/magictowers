// Raumverwaltung + Rundenablauf. Der Server ist autoritativ: er rechnet jeden
// Zug mit derselben Engine nach, die auch im Browser läuft.

import * as E from '../shared/engine.js';
import * as LB from './leaderboard.js';

const COUNTDOWN_MS = 3200;
const GRACE_MS = 400;      // Puffer für Latenz am Rundenende
const TICK_MS = 500;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
/** So weit darf die vom Client gemeldete Zugzeit von der Serveruhr abweichen. */
const TIME_SLACK_MS = 1500;

/** Die vier festen Tische. Sie existieren immer und werden nie gelöscht. */
const TABLES = [
  { code: 'T1', name: 'Tisch 1' },
  { code: 'T2', name: 'Tisch 2' },
  { code: 'T3', name: 'Tisch 3' },
  { code: 'T4', name: 'Tisch 4' },
];

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Set<Client>} */
const lobbyWatchers = new Set();
/** Spieler-ID → Raumcode, damit ein Reload zurück an den Tisch führt. */
const homes = new Map();

for (const t of TABLES) {
  rooms.set(t.code, {
    code: t.code,
    name: t.name,
    hostId: null,
    players: [],
    phase: 'lobby',
    round: 0,
    totalRounds: E.ROUNDS,
    seed: null,
    startsAt: 0,
    endsAt: 0,
    riskAt: 0,
    timers: [],
  });
}

// --------------------------------------------------------------- Hilfsmittel

export function send(client, type, data = {}) {
  if (client?.socket?.readyState === 1) {
    // `t` zuletzt: ein gleichnamiges Feld in `data` darf den Typ nicht kippen.
    try { client.socket.send(JSON.stringify({ ...data, t: type })); } catch { /* egal */ }
  }
}

function broadcast(room, type, data = {}) {
  for (const p of room.players) send(p.client, type, data);
}

/** Plätze vergeben – gleicher Score heißt gleicher Platz. Liste muss sortiert sein. */
export function rank(list, key = 'score') {
  list.forEach((r, i) => {
    r.place = i > 0 && list[i - 1][key] === r[key] ? list[i - 1].place : i + 1;
  });
  return list;
}

// ------------------------------------------------------------------- Lobby

function roomSummary(r) {
  return {
    code: r.code,
    name: r.name,
    players: r.players.length,
    max: MAX_PLAYERS,
    phase: r.phase,
    round: r.round,
    rounds: r.totalRounds,
    names: r.players.map((p) => p.name),
    host: r.players.find((p) => p.id === r.hostId)?.name ?? null,
  };
}

export function lobbyList() {
  return TABLES.map((t) => roomSummary(rooms.get(t.code)));
}

function pushLobby() {
  const list = lobbyList();
  for (const c of lobbyWatchers) send(c, 'rooms', { rooms: list });
}

export function watchLobby(client) {
  lobbyWatchers.add(client);
  send(client, 'rooms', { rooms: lobbyList() });
}

export function unwatchLobby(client) {
  lobbyWatchers.delete(client);
}

// -------------------------------------------------------------------- Räume

export function joinRoom(client, code) {
  const room = rooms.get(String(code ?? '').toUpperCase().trim());
  if (!room) return send(client, 'error', { msg: 'Diesen Tisch gibt es nicht.' });

  // Rückkehrer bekommen ihren Platz zurück.
  const existing = room.players.find((p) => p.id === client.id);
  if (existing) {
    if (client.room && client.room !== room) leaveRoom(client);
    existing.client = client;
    existing.online = true;
    existing.name = client.name;
    client.room = room;
    homes.set(client.id, room.code);
    unwatchLobby(client);
    syncRoom(room);
    if (room.phase === 'playing' || room.phase === 'countdown') sendRoundStart(room, existing, true);
    return;
  }

  if (room.players.length >= MAX_PLAYERS) return send(client, 'error', { msg: 'Der Tisch ist voll.' });
  if (room.phase !== 'lobby' && room.phase !== 'gameEnd') {
    return send(client, 'error', { msg: 'Hier läuft schon eine Partie – nimm einen anderen Tisch.' });
  }
  if (client.room) leaveRoom(client);

  room.players.push({
    id: client.id,
    name: client.name,
    client,
    online: true,
    ready: false,
    st: null,
    total: 0,
    rounds: [],
    bestStreak: 0,
    clears: 0,
    golds: 0,
    best: 0,
  });
  // Wer als Erster am Tisch sitzt, ist Host und startet die Partie.
  if (!room.hostId || !room.players.some((p) => p.id === room.hostId)) room.hostId = client.id;
  client.room = room;
  homes.set(client.id, room.code);
  unwatchLobby(client);
  syncRoom(room);
  pushLobby();
}

/**
 * Nach einem Reload oder Verbindungsabbruch zurück an den alten Tisch setzen.
 * Greift nur bei laufenden Partien – wer in der Lobby weg war, hat seinen Platz
 * schon freigegeben.
 */
export function resume(client) {
  const code = homes.get(client.id);
  if (!code) return false;
  const room = rooms.get(code);
  if (!room || !room.players.some((p) => p.id === client.id)) {
    homes.delete(client.id);
    return false;
  }
  joinRoom(client, code);
  return true;
}

/** Namensänderung auch am Tisch sichtbar machen. */
export function renamed(client) {
  const room = client.room;
  if (!room) return;
  const p = room.players.find((x) => x.id === client.id);
  if (!p || p.name === client.name) return;
  p.name = client.name;
  syncRoom(room);
  pushLobby();
}

export function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  client.room = null;
  homes.delete(client.id);
  const i = room.players.findIndex((p) => p.id === client.id);
  if (i >= 0) room.players.splice(i, 1);

  if (room.players.length === 0) {
    resetTable(room);
  } else {
    if (room.hostId === client.id) room.hostId = room.players[0].id;
    // Wenn nur noch einer da ist, hat eine laufende Partie keinen Sinn mehr.
    if (room.players.length < MIN_PLAYERS && (room.phase === 'playing' || room.phase === 'countdown')) {
      endRound(room, true);
    } else {
      checkAllReady(room);
      syncRoom(room);
    }
  }
  pushLobby();
}

/** Verbindung weg – Platz bleibt reserviert, damit man zurückkommen kann. */
export function markOffline(client) {
  const room = client.room;
  unwatchLobby(client);
  if (!room) return;
  const p = room.players.find((x) => x.id === client.id);
  if (!p) return;

  if (room.phase === 'lobby' || room.phase === 'gameEnd') {
    leaveRoom(client);
    return;
  }
  p.online = false;
  p.ready = false;
  client.room = null;
  syncRoom(room);

  // Niemand mehr online? Dann macht die Partie keinen Sinn mehr.
  if (room.players.every((x) => !x.online)) {
    for (const x of room.players) homes.delete(x.id);
    room.players.length = 0;
    resetTable(room);
    pushLobby();
  } else {
    maybeEndRound(room);
  }
}

function clearTimers(room) {
  room.timers.forEach(clearTimeout);
  room.timers.forEach(clearInterval);
  room.timers = [];
}

/** Tisch zurück auf Anfang – er bleibt bestehen, nur leer. */
function resetTable(room) {
  clearTimers(room);
  room.players.length = 0;
  room.hostId = null;
  room.phase = 'lobby';
  room.round = 0;
  room.totalRounds = E.ROUNDS;
  room.seed = null;
  room.riskAt = 0;
}

function roomState(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    totalRounds: room.totalRounds,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      online: p.online,
      total: p.total,
      rounds: p.rounds,
      bestStreak: p.bestStreak,
      clears: p.clears,
    })),
  };
}

function syncRoom(room) {
  broadcast(room, 'room', { room: roomState(room) });
}

// ------------------------------------------------------------ Bereit / Start

export function setReady(client, value) {
  const room = client.room;
  if (!room) return;
  const p = room.players.find((x) => x.id === client.id);
  if (!p) return;
  p.ready = !!value;
  syncRoom(room);
  checkAllReady(room);
}

/** Der Host stellt die Rundenzahl ein, solange die Partie nicht läuft. */
export function setRounds(client, n) {
  const room = client.room;
  if (!room || room.hostId !== client.id || room.phase !== 'lobby') return;
  room.totalRounds = Math.min(20, Math.max(1, n | 0 || E.ROUNDS));
  syncRoom(room);
  pushLobby();
}

function checkAllReady(room) {
  const active = room.players.filter((p) => p.online);
  if (active.length < MIN_PLAYERS) return;
  if (!active.every((p) => p.ready)) return;

  if (room.phase === 'roundEnd') startRound(room);
  else if (room.phase === 'gameEnd') resetGame(room);
}

export function hostStart(client) {
  const room = client.room;
  if (!room || room.hostId !== client.id) return;
  if (room.phase !== 'lobby') return;
  const active = room.players.filter((p) => p.online);
  if (active.length < MIN_PLAYERS) return send(client, 'error', { msg: `Mindestens ${MIN_PLAYERS} Spieler nötig.` });
  if (!active.every((p) => p.ready || p.id === room.hostId)) {
    return send(client, 'error', { msg: 'Es sind noch nicht alle bereit.' });
  }
  for (const p of room.players) { p.total = 0; p.rounds = []; p.bestStreak = 0; p.clears = 0; p.golds = 0; p.best = 0; }
  room.round = 0;
  startRound(room);
}

function resetGame(room) {
  clearTimers(room);
  room.phase = 'lobby';
  room.round = 0;
  for (const p of room.players) { p.ready = false; p.total = 0; p.rounds = []; p.bestStreak = 0; p.clears = 0; p.golds = 0; p.best = 0; p.st = null; }
  syncRoom(room);
  pushLobby();
}

// ------------------------------------------------------------------- Runden

function startRound(room) {
  clearTimers(room);
  room.round++;
  room.phase = 'countdown';
  room.seed = `${room.code}-${room.round}-${Math.random().toString(36).slice(2, 10)}`;
  room.startsAt = Date.now() + COUNTDOWN_MS;
  room.endsAt = room.startsAt + E.roundMs(room.round, room.totalRounds);
  room.riskAt = 0;

  for (const p of room.players) {
    p.ready = false;
    // Alle spielen dasselbe Blatt – gleiche Chancen, direkt vergleichbar.
    p.st = E.createRound(room.seed, room.round, room.totalRounds);
  }

  syncRoom(room);
  for (const p of room.players) sendRoundStart(room, p, false);

  room.timers.push(setTimeout(() => {
    room.phase = 'playing';
    syncRoom(room);
  }, COUNTDOWN_MS));

  room.timers.push(setInterval(() => pushLive(room), TICK_MS));
  room.timers.push(setTimeout(
    () => endRound(room),
    COUNTDOWN_MS + E.roundMs(room.round, room.totalRounds) + GRACE_MS,
  ));
  pushLobby();
}

function sendRoundStart(room, p, resume) {
  send(p.client, 'roundStart', {
    round: room.round,
    totalRounds: room.totalRounds,
    seed: room.seed,
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    now: Date.now(),
    resume,
    state: resume ? E.snapshot(p.st) : null,
  });
}

function pushLive(room) {
  const live = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    online: p.online,
    ...(p.st ? E.publicStats(p.st) : { score: 0, streak: 0, bestStreak: 0, clears: 0, left: E.BOARD_SIZE, over: false }),
  }));
  broadcast(room, 'live', { live });
}

/**
 * Sobald alle durch sind (Board leer oder nichts mehr möglich), ist die Runde
 * vorbei – aber erst, wenn auch niemand mehr an der Risikoleiter steht. Wer noch
 * riskieren darf, bekommt dafür ein kurzes Fenster.
 */
function maybeEndRound(room) {
  if (room.phase !== 'playing' && room.phase !== 'countdown') return;
  const active = room.players.filter((p) => p.online);
  if (!active.length || !active.every((p) => p.st?.over)) return;
  pushLive(room);

  if (active.every((p) => !E.canRisk(p.st))) return endRound(room);
  if (room.riskAt) return;   // Fenster läuft schon

  room.riskAt = Date.now() + E.RISK.windowMs;
  broadcast(room, 'riskWindow', { endsAt: room.riskAt });
  room.timers.push(setTimeout(() => endRound(room), E.RISK.windowMs));
}

/** Ein Zug auf der Risikoleiter. Der Münzwurf passiert hier, nicht im Client. */
export function risk(client, go) {
  const room = client.room;
  if (!room) return;
  const p = room.players.find((x) => x.id === client.id);
  if (!p?.st) return;
  if (room.phase !== 'playing' && room.phase !== 'countdown') return;

  if (!go) {
    send(client, 'risk', E.stopRisk(p.st));
  } else {
    if (!E.canRisk(p.st)) return;
    const res = E.applyRisk(p.st, Math.random() < 0.5);
    send(client, 'risk', res);
    pushLive(room);
  }
  maybeEndRound(room);
}

function endRound(room, aborted = false) {
  if (room.phase === 'roundEnd' || room.phase === 'gameEnd' || room.phase === 'lobby') return;
  clearTimers(room);

  const results = room.players.map((p) => {
    const s = p.st ? E.publicStats(p.st) : { score: 0, bestStreak: 0, clears: 0, golds: 0, best: 0, misses: 0, riskWon: 0, riskLost: 0 };
    p.rounds.push(s.score);
    p.total += s.score;
    p.bestStreak = Math.max(p.bestStreak, s.bestStreak);
    p.clears += s.clears;
    p.golds += s.golds;
    p.best = Math.max(p.best, s.best);
    p.ready = false;
    return {
      id: p.id, name: p.name, online: p.online,
      score: s.score, streak: s.bestStreak, clears: s.clears, total: p.total,
      golds: s.golds, best: s.best, misses: s.misses,
      riskWon: s.riskWon, riskLost: s.riskLost,
    };
  }).sort((a, b) => b.score - a.score);

  rank(results);
  const standings = rank([...room.players]
    .map((p) => ({ id: p.id, name: p.name, total: p.total }))
    .sort((a, b) => b.total - a.total), 'total');

  const last = room.round >= room.totalRounds || aborted;
  room.phase = last ? 'gameEnd' : 'roundEnd';
  syncRoom(room);

  if (last) {
    const final = rank(room.players
      .map((p) => ({ id: p.id, name: p.name, score: p.total, rounds: p.rounds, bestStreak: p.bestStreak, clears: p.clears, golds: p.golds, best: p.best }))
      .sort((a, b) => b.score - a.score));
    if (!aborted && final.length >= MIN_PLAYERS) LB.record(final, room.name);
    broadcast(room, 'gameEnd', { results: final, aborted });
  } else {
    broadcast(room, 'roundEnd', { round: room.round, totalRounds: room.totalRounds, results, standings });
  }
  pushLobby();
}

// -------------------------------------------------------------------- Züge

export function move(client, msg) {
  const room = client.room;
  if (!room) return;
  const p = room.players.find((x) => x.id === client.id);
  if (!p || !p.st || p.st.over) return;

  const now = Date.now();
  if (room.phase !== 'playing' && room.phase !== 'countdown') return;
  if (now < room.startsAt - 250 || now > room.endsAt + GRACE_MS) return;

  // Die Bonusleiste hängt an der Zeit. Wir übernehmen die Uhr des Clients (sie
  // ist mit uns abgeglichen), aber nur solange sie plausibel neben unserer
  // liegt – sonst ließe sich die Leiste einfach einfrieren.
  const wanted = Number(msg.ts);
  const ok = Number.isFinite(wanted) && wanted > now - TIME_SLACK_MS && wanted < now + 500;
  const t = ok ? wanted : now;

  const ev = msg.a === 'draw'
    ? E.draw(p.st, t)
    : msg.a === 'miss'
    ? E.miss(p.st, msg.i | 0, t)
    : E.play(p.st, msg.i | 0, t);
  if (!ev || !ok) {
    // Client und Server sind auseinandergelaufen – autoritativen Stand schicken.
    send(client, 'resync', { state: E.snapshot(p.st), seq: msg.seq });
  }
  if (p.st.over) {
    pushLive(room);
    maybeEndRound(room);
  }
}

export { MAX_PLAYERS, MIN_PLAYERS, TABLES };
