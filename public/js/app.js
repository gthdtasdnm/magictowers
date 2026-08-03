// Magic Towers – Client-Steuerung: Screens, Lobby, Raum, Runde, Auswertung.

import * as E from '../shared/engine.js';
import * as net from './net.js';
import * as B from './board.js';
import { sfx, unlock as unlockAudio } from './sfx.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const AVATARS = ['🦊', '🐙', '🦅', '🐺', '🦁', '🐉'];
const fmt = (n) => Number(n || 0).toLocaleString('de-DE');

// ─────────────────────────────────────────────────────────── Zustand

// Identität hängt am Tab (sessionStorage): Reload und Verbindungsabbruch führen
// zurück an den Tisch, zwei Tabs sind aber zwei Spieler. Der zuletzt benutzte
// Name aus localStorage dient nur als Vorschlag für einen frischen Tab.
const me = {
  id: sessionStorage.getItem('mt-pid') || '',
  name: sessionStorage.getItem('mt-name') || localStorage.getItem('mt-name') || '',
};

let room = null;          // letzter Raum-Snapshot vom Server
let st = null;            // eigene Engine-Instanz der laufenden Runde
let round = { startsAt: 0, endsAt: 0, no: 0, total: 10, running: false };
let live = [];            // Live-Scores der Gegner
let seq = 0;
let backScreen = 's-name';

// ─────────────────────────────────────────────────────────── Screens

function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  if (id !== 's-lb') backScreen = id;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

const avatarFor = (id) => AVATARS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

// ─────────────────────────────────────────────────────────── Start / Name

$('#in-name').value = me.name;

function enterLobby() {
  const name = $('#in-name').value.trim();
  if (!name) { $('#in-name').focus(); return toast('Wie heißt du?'); }
  me.name = name;
  sessionStorage.setItem('mt-name', name);
  localStorage.setItem('mt-name', name);
  unlockAudio();
  net.send('hello', { name, pid: me.id });
  net.send('watchLobby');
  $('#me-name').textContent = name;
  show('s-lobby');
}

$('#btn-enter').onclick = enterLobby;
$('#in-name').onkeydown = (e) => { if (e.key === 'Enter') enterLobby(); };
$('#btn-name-edit').onclick = () => { $('#in-name').value = me.name; show('s-name'); };

// ─────────────────────────────────────────────────────────── Lobby

// Es gibt vier feste Tische. Man geht einfach in einen rein – wer zuerst da ist,
// ist Host und startet, alle anderen drücken „Bereit".
net.on('rooms', ({ rooms }) => {
  const list = $('#room-list');
  list.innerHTML = '';
  for (const r of rooms) {
    const free = r.max - r.players;
    const joinable = (r.phase === 'lobby' || r.phase === 'gameEnd') && free > 0;
    const state = r.phase === 'lobby' || r.phase === 'gameEnd'
      ? (free > 0 ? (r.players ? 'offen' : 'leer') : 'voll')
      : `Runde ${r.round}/${r.rounds}`;

    const d = document.createElement('div');
    d.className = 'table-card' + (joinable ? '' : ' busy');
    d.innerHTML =
      `<div class="tc-head">
         <span class="tc-name">${esc(r.name)}</span>
         <span class="pill ${joinable ? 'open' : 'live'}">${state}</span>
       </div>
       <div class="tc-seats">${
        Array.from({ length: r.max }, (_, i) => {
          const n = r.names[i];
          return n
            ? `<span class="tc-seat"><i>${avatarFor(n)}</i>${esc(n)}${i === 0 ? ' 👑' : ''}</span>`
            : '<span class="tc-seat free"><i>🪑</i>frei</span>';
        }).join('')
      }</div>
       <div class="tc-foot">${r.players}/${r.max} am Tisch · ${r.rounds} Runden</div>`;
    d.onclick = () => {
      if (!joinable) return toast(r.phase === 'lobby' ? 'Der Tisch ist voll.' : 'Hier läuft schon eine Partie.');
      net.send('joinRoom', { code: r.code });
    };
    list.appendChild(d);
  }
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ─────────────────────────────────────────────────────────── Raum

$('#btn-leave').onclick = () => { net.send('leaveRoom'); room = null; show('s-lobby'); };
$('#btn-ready').onclick = () => {
  const p = room?.players.find((x) => x.id === me.id);
  net.send('ready', { value: !p?.ready });
};
$('#btn-start').onclick = () => net.send('start');
$('#in-rounds').onchange = (e) => net.send('rounds', { value: Number(e.target.value) });

function renderRoom() {
  if (!room) return;
  $('#room-name').textContent = room.name;
  const isHost = room.hostId === me.id;
  const meP = room.players.find((p) => p.id === me.id);

  const seats = $('#seats');
  seats.innerHTML = '';
  for (let i = 0; i < room.maxPlayers; i++) {
    const p = room.players[i];
    const d = document.createElement('div');
    if (!p) {
      d.className = 'seat empty';
      d.innerHTML = '<div class="av">🪑</div><div class="nm">frei</div><div class="st">wartet</div>';
    } else {
      d.className = 'seat' + (p.ready ? ' ready' : '') + (p.online ? '' : ' off');
      d.innerHTML =
        `<div class="av">${avatarFor(p.id)}</div>
         <div class="nm">${esc(p.name)}${p.id === me.id ? ' (du)' : ''}</div>
         <div class="st">${!p.online ? 'weg' : p.id === room.hostId ? 'startet' : p.ready ? '✓ bereit' : 'wartet'}</div>
         ${p.id === room.hostId ? '<div class="host">HOST</div>' : ''}`;
    }
    seats.appendChild(d);
  }

  const ready = $('#btn-ready');
  ready.textContent = meP?.ready ? '✓ Bereit' : 'Bereit';
  ready.classList.toggle('on', !!meP?.ready);

  const online = room.players.filter((p) => p.online);
  const allReady = online.length >= room.minPlayers && online.every((p) => p.ready || p.id === room.hostId);
  $('#btn-start').style.display = isHost ? '' : 'none';
  $('#btn-start').disabled = !allReady;
  $('#btn-ready').style.display = isHost ? 'none' : '';
  $('#rounds-field').style.display = isHost && room.phase === 'lobby' ? '' : 'none';
  if ($('#in-rounds').value !== String(room.totalRounds)) $('#in-rounds').value = String(room.totalRounds);

  $('#room-sub').textContent = `${room.totalRounds} Runden · ${online.length}/${room.maxPlayers} am Tisch`;
  $('#start-hint').textContent = online.length < room.minPlayers
    ? `Mindestens ${room.minPlayers} Spieler – hol noch jemanden an den Tisch!`
    : isHost ? (allReady ? 'Alle bereit. Hau rein!' : 'Warte, bis alle bereit sind.')
      : 'Der Host startet, sobald alle bereit sind.';
}

net.on('room', ({ room: r }) => {
  const joined = !room || room.code !== r.code;
  const before = room?.players.length ?? 0;
  room = r;
  if (r.players.length > before && before > 0) sfx.join();
  if (r.phase === 'lobby') { if (joined) sfx.join(); show('s-room'); }
  // Reload während einer Auswertung: zurück an den Tisch, damit man „Bereit" drücken kann.
  else if (joined && (r.phase === 'roundEnd' || r.phase === 'gameEnd')) show('s-room');
  renderRoom();
});

net.on('error', ({ msg }) => toast(msg));

// ─────────────────────────────────────────────────────────── Runde

net.on('roundStart', (m) => {
  round = {
    startsAt: m.startsAt, endsAt: m.endsAt, no: m.round, total: m.totalRounds,
    ms: m.endsAt - m.startsAt,   // jede Runde ist kürzer als die davor
    running: true,
  };
  st = m.resume && m.state ? E.restore(m.state) : E.createRound(m.seed, m.round, m.totalRounds);
  seq = 0;
  live = [];
  hideDone();
  B.resetView();
  B.render(st);
  $('#hud-round').textContent = m.round;
  $('#hud-rounds').textContent = m.totalRounds;
  $('#hud-roundmult').textContent = `×${st.roundMult.toFixed(1)}`;
  $('#hud-roundmult').classList.toggle('on', st.roundMult > 1);
  renderRivals();
  show('s-game');
  if (!m.resume) startCountdown();
  if (st.over) showDone();
  requestAnimationFrame(tickLoop);
});

let cdShown = -1;

function startCountdown() {
  cdShown = -1;
  $('#countdown').classList.add('on');
}

function tickLoop() {
  if (!round.running) return;
  const t = net.now();

  if (t < round.startsAt) {
    const n = Math.ceil((round.startsAt - t) / 1000);
    if (n !== cdShown) {
      cdShown = n;
      const el = $('#countdown').firstElementChild;
      el.textContent = n <= 0 ? 'LOS!' : String(Math.min(3, n));
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      if (n <= 3) sfx.tick(n === 0 ? 0 : n);
    }
    $('#hud-timer').textContent = Math.ceil(round.ms / 1000);
    $('#hud-timerbar').style.width = '100%';
  } else {
    if ($('#countdown').classList.contains('on')) { $('#countdown').classList.remove('on'); sfx.go(); }
    const left = Math.max(0, round.endsAt - t);
    const secs = Math.ceil(left / 1000);
    const timer = $('#hud-timer');
    if (timer.textContent !== String(secs)) {
      timer.textContent = String(secs);
      if (secs <= 10 && secs > 0) sfx.warn();
    }
    timer.classList.toggle('warn', secs <= 10);
    const pct = (left / round.ms) * 100;
    $('#hud-timerbar').style.width = `${pct}%`;
    $('#hud-timerbar').classList.toggle('warn', pct < 25);
    if (left <= 0) round.running = false;
  }
  B.renderLive(st, t);
  if (riskEndsAt) {
    const left = Math.max(0, riskEndsAt - t);
    $('#risk-timer').textContent = left > 0 ? `noch ${Math.ceil(left / 1000)} s` : '';
  }
  requestAnimationFrame(tickLoop);
}

const playable = () => st && !st.over && round.running
  && net.now() >= round.startsAt && net.now() < round.endsAt;

// Optimistisch lokal ausführen, parallel an den Server melden. Die Zugzeit geht
// mit, damit die Bonusleiste hier und auf dem Server exakt gleich läuft.
function tryPlay(i) {
  if (!playable()) return;
  if (E.matchingSlot(st, i) < 0) {
    // Offene Karte, die nirgends passt: das kostet Punkte.
    const ts = net.now();
    const ev = E.miss(st, i, ts);
    if (ev) {
      net.send('move', { a: 'miss', i, ts, seq: ++seq });
      afterMove(ev);
    } else if (!st.taken[i]) { sfx.bad(); B.shake(); }
    return;
  }
  const ts = net.now();
  const ev = E.play(st, i, ts);
  net.send('move', { a: 'play', i, ts, seq: ++seq });
  afterMove(ev);
}

function tryDraw() {
  if (!playable()) return;
  if (!E.canDraw(st)) { sfx.bad(); B.shake(); return toast('Stapel ist leer!'); }
  const ts = net.now();
  const ev = E.draw(st, ts);
  net.send('move', { a: 'draw', ts, seq: ++seq });
  afterMove(ev);
}

function afterMove(ev) {
  B.render(st);
  B.celebrate(ev);
  if (st.over) setTimeout(showDone, ev?.boardClear ? 1100 : 500);
}

B.bindPlay(tryPlay);
$('#deck').onclick = tryDraw;

document.addEventListener('keydown', (e) => {
  if (!$('#s-game').classList.contains('on')) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tryDraw(); }
});

net.on('resync', ({ state }) => {
  // Der Server hat das letzte Wort – lokalen Stand nachziehen.
  st = E.restore(state);
  B.resetView();
  B.render(st);
  if (st.over) showDone(); else hideDone();
});

net.on('live', ({ live: l }) => { live = l; renderRivals(); if (st?.over) renderDone(); });

function renderRivals() {
  const box = $('#rivals');
  const others = live.filter((p) => p.id !== me.id);
  const best = Math.max(0, ...live.map((p) => p.score));
  box.innerHTML = '';
  for (const p of others) {
    const d = document.createElement('div');
    d.className = 'rival' + (p.score === best && best > 0 ? ' lead' : '') + (p.online ? '' : ' off')
      + (p.over ? ' done' : '');
    d.innerHTML = `<span class="rn">${esc(p.name)}${p.over ? ' ✔' : ''}</span><span class="rs">${fmt(p.score)}</span>`;
    box.appendChild(d);
  }
}

// ── Durch: Board leer oder nichts mehr möglich – wir warten auf die anderen ──

let riskEndsAt = 0;
let riskBusy = false;

function showDone() {
  if (!st?.over) return;
  const clear = st.finished === 'clear';
  $('#done-icon').textContent = clear ? '🔥' : '🏁';
  $('#done-title').textContent = clear ? 'Board leer!' : 'Nichts mehr möglich';
  $('#risk-text').textContent = 'Die Hälfte einsetzen und verdoppeln?';
  $('#risk-coin').textContent = '🎲';
  renderDone();
  $('#done').classList.add('on');
}

function hideDone() {
  $('#done').classList.remove('on');
  riskEndsAt = 0;
  riskBusy = false;
  $('#risk-timer').textContent = '';
}

function renderDone() {
  $('#done-score').textContent = fmt(st?.score ?? 0);

  // Risikoleiter: solange noch ein Zug offen ist und etwas auf dem Konto liegt.
  const can = st && E.canRisk(st) && !riskBusy;
  $('#risk').classList.toggle('off', !st?.over);
  $('#risk').classList.toggle('spent', !can && !riskBusy);
  $('#risk-stake').textContent = fmt(st ? E.riskStake(st) : 0);
  $('#btn-risk').disabled = !can;
  $('#btn-keep').disabled = !can;
  if (st?.over && !st.risk.used && !E.riskStake(st)) $('#risk-text').textContent = 'Nichts zu riskieren.';
  $('#risk-steps').innerHTML = Array.from({ length: E.RISK.steps }, (_, i) =>
    `<i class="${i < (st?.risk.used ?? 0) ? 'used' : ''}"></i>`).join('');

  const others = live.filter((p) => p.id !== me.id && p.online);
  const waiting = others.filter((p) => !p.over);
  $('#done-sub').textContent = waiting.length
    ? `Warte auf ${waiting.map((p) => p.name).join(', ')} …`
    : 'Alle durch – gleich gibt es die Auswertung.';
  $('#done-list').innerHTML = others.map((p) =>
    `<div class="dl-row${p.over ? ' ok' : ''}">
       <span>${esc(p.name)}</span>
       <b>${fmt(p.score)}</b>
       <i>${p.risking ? '🎲 riskiert' : p.over ? 'durch' : 'spielt noch'}</i>
     </div>`).join('');
}

// Den Münzwurf macht der Server – der Client darf ihn nicht vorher kennen.
$('#btn-risk').onclick = () => {
  if (!st || !E.canRisk(st) || riskBusy) return;
  riskBusy = true;
  $('#btn-risk').disabled = true;
  $('#btn-keep').disabled = true;
  $('#risk-coin').classList.add('spin');
  $('#risk-text').textContent = 'Läuft …';
  sfx.tick(2);
  net.send('risk', { go: true });
};

$('#btn-keep').onclick = () => {
  if (!st || riskBusy) return;
  net.send('risk', { go: false });
};

net.on('risk', (m) => {
  if (!st) return;
  st.risk.used = m.used ?? st.risk.used;
  st.risk.done = !!m.done;
  if (m.stopped) {
    $('#risk-text').textContent = 'Punkte gesichert.';
    renderDone();
    return;
  }
  st.score = m.score;
  if (m.won) st.risk.won++; else st.risk.lost++;

  // Kurz die Münze drehen lassen, dann auflösen.
  setTimeout(() => {
    $('#risk-coin').classList.remove('spin');
    $('#risk-coin').textContent = m.won ? '🪙' : '💀';
    $('#risk-text').innerHTML = m.won
      ? `<b class="win">+${fmt(m.stake)}</b> – verdoppelt!`
      : `<b class="lose">−${fmt(m.stake)}</b> – weg.`;
    $('#done-score').textContent = fmt(st.score);
    B.setScore(st.score);
    if (m.won) { sfx.win(); B.coins(); } else { sfx.bad(); }
    riskBusy = false;
    renderDone();
  }, 900);
});

net.on('riskWindow', ({ endsAt }) => { riskEndsAt = endsAt; });

// ─────────────────────────────────────────────────────────── Rundenende

net.on('roundEnd', ({ round: r, totalRounds, results, standings }) => {
  round.running = false;
  hideDone();
  sfx.end();
  $('#re-title').textContent = `Runde ${r} von ${totalRounds}`;
  $('#re-results').innerHTML = results.map((x, i) => resRow({
    place: x.place, name: x.name, score: x.score,
    sub: `Beste Serie ${x.streak} · ${x.clears}× Board leer`, id: x.id, delay: i,
  })).join('');
  $('#re-standings').innerHTML = standings.map((x, i) => resRow({
    place: x.place, name: x.name, score: x.total, sub: 'Gesamt', id: x.id, delay: i,
  })).join('');
  $('#btn-next').textContent = 'Bereit für die nächste Runde';
  $('#btn-next').classList.remove('on');
  show('s-round');
});

function resRow({ place, name, score, sub, id, delay = 0 }) {
  const medal = ['🥇', '🥈', '🥉'][place - 1] ?? place;
  return `<div class="res p${place}${id === me.id ? ' me' : ''}" style="animation-delay:${delay * 70}ms">
    <span class="pl">${medal}</span>
    <span class="nm">${esc(name)}<div class="sub">${esc(sub)}</div></span>
    <span class="sc">${fmt(score)}</span></div>`;
}

$('#btn-next').onclick = () => {
  const p = room?.players.find((x) => x.id === me.id);
  const next = !p?.ready;
  net.send('ready', { value: next });
  $('#btn-next').textContent = next ? '✓ Bereit – warte auf die anderen' : 'Bereit für die nächste Runde';
  $('#btn-next').classList.toggle('on', next);
};

// Solange die Auswertung offen ist, zeigen wir wer schon bereit ist.
net.on('room', () => {
  if (!room) return;
  if ($('#s-round').classList.contains('on') || $('#s-end').classList.contains('on')) {
    const waiting = room.players.filter((p) => p.online && !p.ready).map((p) => p.name);
    const hint = waiting.length ? `Warte auf: ${waiting.join(', ')}` : 'Alle bereit – gleich geht es los!';
    $('#re-hint').textContent = hint;
    $('#end-hint').textContent = hint;
  }
  if (room.phase === 'lobby' && !$('#s-game').classList.contains('on')) show('s-room');
});

// ─────────────────────────────────────────────────────────── Spielende

net.on('gameEnd', ({ results, aborted }) => {
  round.running = false;
  hideDone();
  const win = results[0];
  const tied = results.filter((r) => r.place === 1);
  const iWon = tied.some((r) => r.id === me.id);
  $('#end-winner').textContent = aborted
    ? 'Partie abgebrochen'
    : tied.length > 1
      ? `Unentschieden: ${tied.map((r) => r.name).join(' & ')}!`
      : iWon ? 'Du hast gewonnen! 🎉' : `${win.name} gewinnt!`;
  $('#end-results').innerHTML = results.map((x, i) => resRow({
    place: x.place, name: x.name, score: x.score,
    sub: `Beste Serie ${x.bestStreak} · ${x.clears}× Board leer`, id: x.id, delay: i,
  })).join('');
  $('#btn-again').textContent = 'Nochmal!';
  $('#btn-again').classList.remove('on');
  show('s-end');
  if (!aborted) { if (iWon) { sfx.win(); confetti(); } else sfx.end(); }
});

$('#btn-again').onclick = () => {
  const p = room?.players.find((x) => x.id === me.id);
  const next = !p?.ready;
  net.send('ready', { value: next });
  $('#btn-again').textContent = next ? '✓ Bereit' : 'Nochmal!';
  $('#btn-again').classList.toggle('on', next);
};
$('#btn-tolobby').onclick = () => { net.send('leaveRoom'); room = null; show('s-lobby'); };

function confetti() {
  const colors = ['#ff2e88', '#ffd447', '#35e6ff', '#52ffa8', '#ff8a3d'];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('div');
    const size = 6 + Math.random() * 8;
    Object.assign(p.style, {
      position: 'fixed', zIndex: 70, pointerEvents: 'none',
      left: `${Math.random() * 100}vw`, top: '-20px',
      width: `${size}px`, height: `${size * 0.6}px`,
      background: colors[(Math.random() * colors.length) | 0],
      borderRadius: '2px',
      transform: `rotate(${Math.random() * 360}deg)`,
      transition: `transform ${2 + Math.random() * 2}s linear, top ${2 + Math.random() * 2}s linear, opacity .6s ease ${2 + Math.random()}s`,
    });
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.top = '110vh';
      p.style.transform = `rotate(${Math.random() * 1440 - 720}deg)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 4600);
  }
}

// ─────────────────────────────────────────────────────────── Bestenliste

function openLB() { net.send('leaderboard'); show('s-lb'); }
$('#btn-lb-1').onclick = openLB;
$('#btn-lb-2').onclick = openLB;
$('#btn-lb-back').onclick = () => show(backScreen);

net.on('leaderboard', ({ top, fame }) => {
  $('#lb-fame').innerHTML = fame.length
    ? fame.map((e, i) => resRow({
      place: e.rank, name: e.name, score: e.best,
      sub: `${e.wins} ${e.wins === 1 ? 'Sieg' : 'Siege'} aus ${e.games} ${e.games === 1 ? 'Partie' : 'Partien'} · Ø ${fmt(e.avg)}`,
      id: null, delay: i,
    })).join('')
    : '<p class="muted">Noch nichts gespielt. Sei der Erste!</p>';
  $('#lb-top').innerHTML = top.length
    ? top.map((e, i) => resRow({
      place: e.rank, name: e.name, score: e.score,
      sub: `${new Date(e.at).toLocaleDateString('de-DE')} · Platz ${e.place}/${e.players} · Serie ${e.bestStreak}`,
      id: null, delay: i,
    })).join('')
    : '<p class="muted">Noch keine Ergebnisse.</p>';
});

// ─────────────────────────────────────────────────────────── Regeln

const rules = $('#m-rules');
$('#btn-rules-1').onclick = () => rules.classList.add('on');
$('#btn-rules-2').onclick = () => rules.classList.add('on');
$('#btn-rules-close').onclick = () => rules.classList.remove('on');
rules.onclick = (e) => { if (e.target === rules) rules.classList.remove('on'); };

// ─────────────────────────────────────────────────────────── Verbindung

net.on('hello', (m) => {
  me.id = m.id;
  me.name = m.name;
  sessionStorage.setItem('mt-pid', m.id);
  $('#me-name').textContent = m.name;
});

net.on('open', () => {
  if (me.name) {
    net.send('hello', { name: me.name, pid: me.id });
    // Nach einem Verbindungsabriss zurück an den alten Tisch.
    if (room) net.send('joinRoom', { code: room.code });
    else if (!$('#s-name').classList.contains('on')) net.send('watchLobby');
  }
});

net.status((s) => { if (s === 'closed') toast('Verbindung weg – versuche neu …'); });

document.addEventListener('pointerdown', unlockAudio, { once: true });

net.connect();

// Direkt an einen Tisch: /?tisch=2
const tableParam = new URLSearchParams(location.search).get('tisch');
const tableCode = /^[1-4]$/.test(String(tableParam)) ? `T${tableParam}` : null;

show('s-name');

if (me.name) {
  $('#in-name').value = me.name;
  let bootstrapped = false;
  net.on('welcome', () => {
    if (bootstrapped) return;   // nach einem Reconnect nicht erneut in die Lobby springen
    bootstrapped = true;
    enterLobby();
    if (tableCode) setTimeout(() => net.send('joinRoom', { code: tableCode }), 120);
  });
}
