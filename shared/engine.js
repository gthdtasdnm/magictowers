// Magic Towers – Spiel-Engine.
// Läuft identisch im Browser und in Deno. Alles ist deterministisch aus dem Seed
// und den mitgelieferten Zeitstempeln ableitbar, damit der Server jeden Zug
// nachrechnen kann.

export const MAX_SLOTS = 3;   // so viele Karten merkt sich die Ablage maximal
export const BASE_SLOTS = 1;  // ohne Kombo liegt genau eine Karte offen
export const DECK_SIZE = 16;
export const BOARD_SIZE = 28;

/** Ab welchem Streak der 2. bzw. 3. Ablageplatz aufgeht. */
export const SLOT_STREAK = [5, 10];

export const ROUND_MS = 75_000;
export const ROUNDS = 10;

/** Ab dieser Runde können die verdeckten Karten wirklich verdeckt liegen. */
export const FOG_FROM_ROUND = 3;

export const SCORE = {
  perCard: 10,        // * Streak (gedeckelt), danach * Bonusleiste
  maxStreakMult: 10,
  peak: 100,
  boardClear: 300,
  perLeftoverCard: 25,
};

/** Bonusleiste: läuft dauernd aus, füllt sich durch schnelle Züge. */
export const BOOST = {
  drainMs: 5000,   // volle Leiste ist nach 5 s leer
  fastMs: 1200,    // schneller als das zählt als „hintereinander"
  gain: 0.4,       // maximaler Zuwachs pro Karte
  maxMult: 1,      // volle Leiste = doppelte Punkte
};

// ---------------------------------------------------------------- Kartenwerte

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];

export const rankOf = (c) => c % 13;
export const suitOf = (c) => (c / 13) | 0;
export const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardLabel = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

/** Aufeinander legbar? K–A–2 zählt als Runde, also wrappt es. */
export function adjacent(a, b) {
  if (a == null || b == null) return false;
  const d = Math.abs(rankOf(a) - rankOf(b));
  return d === 1 || d === 12;
}

// ------------------------------------------------------------------- Layout

// x ist in halben Kartenbreiten gemessen, damit sich die Reihen verzahnen.
const ROW_XS = [
  [3, 9, 15],
  [2, 4, 8, 10, 14, 16],
  [1, 3, 5, 7, 9, 11, 13, 15, 17],
  [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
];

function buildLayout() {
  const nodes = [];
  ROW_XS.forEach((xs, row) => xs.forEach((x) => nodes.push({ i: nodes.length, row, x, covers: [] })));
  for (const n of nodes) {
    if (n.row === 3) continue;
    n.covers = nodes.filter((m) => m.row === n.row + 1 && Math.abs(m.x - n.x) === 1).map((m) => m.i);
  }
  return nodes;
}

/** Statische Pyramiden-Geometrie: 3 Türme, 28 Plätze. */
export const LAYOUT = buildLayout();

/** Die drei Turmspitzen (Reihe 0). */
export const PEAK_TIPS = [0, 1, 2];

// ---------------------------------------------------------------------- RNG

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(seedStr) {
  const rnd = mulberry32(hashSeed(seedStr));
  const a = Array.from({ length: 52 }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Liegen die gedeckten Karten in dieser Runde wirklich verdeckt?
 * Hängt nur an Seed und Rundennummer – also bei allen Spielern gleich.
 */
export function fogFor(seed, round) {
  if (round < FOG_FROM_ROUND) return false;
  const rnd = mulberry32(hashSeed(`${seed}#fog`));
  return rnd() < Math.min(1, 0.45 + 0.15 * (round - FOG_FROM_ROUND));
}

// -------------------------------------------------------------------- State

export function createRound(seed, round = 1) {
  const cards = shuffled(seed);
  const st = {
    seed,
    round,
    fog: fogFor(seed, round),
    board: cards.slice(0, BOARD_SIZE),
    taken: new Array(BOARD_SIZE).fill(false),
    deck: cards.slice(BOARD_SIZE, BOARD_SIZE + DECK_SIZE),
    deckPos: 0,
    peaks: [false, false, false],
    slots: new Array(MAX_SLOTS).fill(null),
    unlocked: BASE_SLOTS,
    streak: 0,
    bestStreak: 0,
    score: 0,
    clears: 0,
    cardsPlayed: 0,
    boost: 0,
    boostT: 0,      // Zeitpunkt des letzten Boost-Updates
    lastPlayT: 0,   // Zeitpunkt der zuletzt gelegten Karte
    over: false,
    finished: null, // 'clear' | 'stuck' | null
  };
  // Erste Karte kommt gratis auf die Ablage, sonst könnte man nicht starten.
  pushSlot(st, st.deck[st.deckPos++]);
  return st;
}

// ------------------------------------------------------------------- Regeln

export function isOpen(st, i) {
  if (st.taken[i]) return false;
  return LAYOUT[i].covers.every((c) => st.taken[c]);
}

/** Liegt die Karte in dieser Runde verdeckt? Deckt sich auf, sobald sie frei ist. */
export function isHidden(st, i) {
  return !!st.fog && !st.taken[i] && !isOpen(st, i);
}

/** Index der Ablage, auf die Board-Karte `i` passt – oder -1. */
export function matchingSlot(st, i) {
  if (!isOpen(st, i)) return -1;
  const card = st.board[i];
  for (let s = 0; s < st.unlocked; s++) {
    if (adjacent(card, st.slots[s])) return s;
  }
  return -1;
}

export function hasMove(st) {
  for (let i = 0; i < BOARD_SIZE; i++) if (matchingSlot(st, i) >= 0) return true;
  return false;
}

export function canDraw(st) {
  return st.deckPos < st.deck.length;
}

function slotsForStreak(streak) {
  let n = BASE_SLOTS;
  for (const s of SLOT_STREAK) if (streak >= s) n++;
  return Math.min(MAX_SLOTS, n);
}

function pushSlot(st, card) {
  st.slots.unshift(card);
  st.slots.length = MAX_SLOTS;
}

// ------------------------------------------------------------- Bonusleiste

/** Stand der Leiste zum Zeitpunkt `t`, ohne den State anzufassen (für die Anzeige). */
export function boostAt(st, t) {
  if (!st.boostT) return st.boost;
  return Math.max(0, st.boost - Math.max(0, t - st.boostT) / BOOST.drainMs);
}

function drainBoost(st, t) {
  st.boost = boostAt(st, t);
  st.boostT = t;
}

function feedBoost(st, t) {
  if (st.lastPlayT) {
    const dt = Math.max(0, t - st.lastPlayT);
    if (dt < BOOST.fastMs) st.boost = Math.min(1, st.boost + BOOST.gain * (1 - dt / BOOST.fastMs));
  }
  st.lastPlayT = t;
}

// ------------------------------------------------------------------- Züge

/**
 * Prüft nach jedem Zug, ob für diesen Spieler Schluss ist.
 * Läuft rein aus dem State – Client und Server kommen so aufs gleiche Ergebnis.
 */
function settle(st, ev) {
  if (st.taken.every(Boolean)) {
    // Board leergeräumt: fette Prämie, danach ist die Runde für dich gelaufen.
    const left = st.deck.length - st.deckPos;
    const bonus = SCORE.boardClear + left * SCORE.perLeftoverCard;
    st.score += bonus;
    ev.gain += bonus;
    st.clears++;
    ev.boardClear = true;
    st.over = true;
    st.finished = 'clear';
  } else if (!hasMove(st) && !canDraw(st)) {
    // Stapel leer und nichts mehr legbar: fertig, wir warten auf die anderen.
    st.over = true;
    st.finished = 'stuck';
  }
  if (st.over) ev.finished = st.finished;
  return ev;
}

/** Board-Karte `i` auf die Ablage legen. `t` ist die abgeglichene Spielzeit. */
export function play(st, i, t = 0) {
  if (st.over) return null;
  const slot = matchingSlot(st, i);
  if (slot < 0) return null;

  const card = st.board[i];
  st.taken[i] = true;
  st.cardsPlayed++;
  st.streak++;
  st.bestStreak = Math.max(st.bestStreak, st.streak);

  drainBoost(st, t);
  feedBoost(st, t);

  const mult = Math.min(st.streak, SCORE.maxStreakMult);
  const boostMult = 1 + st.boost * BOOST.maxMult;
  let gain = Math.round(SCORE.perCard * mult * boostMult);

  const ev = {
    type: 'play', index: i, card, slot,
    streak: st.streak, mult, boost: st.boost, gain: 0, peaks: [],
  };

  // Turmspitze abgeräumt?
  for (const p of PEAK_TIPS) {
    if (!st.peaks[p] && st.taken[p]) {
      st.peaks[p] = true;
      gain += SCORE.peak;
      ev.peaks.push(p);
    }
  }

  st.score += gain;
  ev.gain = gain;

  const before = st.unlocked;
  st.unlocked = slotsForStreak(st.streak);
  if (st.unlocked > before) ev.unlocked = st.unlocked;

  pushSlot(st, card);
  return settle(st, ev);
}

/** Karte vom Nachziehstapel holen. Bricht den Streak und klappt die Ablage zu. */
export function draw(st, t = 0) {
  if (st.over || !canDraw(st)) return null;
  const card = st.deck[st.deckPos++];
  st.streak = 0;
  st.unlocked = BASE_SLOTS;
  drainBoost(st, t);   // Ziehen füttert die Leiste nicht, sie läuft weiter aus
  pushSlot(st, card);
  return settle(st, { type: 'draw', card, boost: st.boost, gain: 0 });
}

// ------------------------------------------------------------- Serialisierung

/** Kompakter Snapshot für Resync nach einem Desync. */
export function snapshot(st) {
  return JSON.parse(JSON.stringify(st));
}

export function restore(snap) {
  return JSON.parse(JSON.stringify(snap));
}

/** Was die Gegner live zu sehen bekommen. */
export function publicStats(st) {
  return {
    score: st.score,
    streak: st.streak,
    bestStreak: st.bestStreak,
    clears: st.clears,
    left: st.taken.filter((t) => !t).length,
    over: st.over,
    finished: st.finished,
  };
}
