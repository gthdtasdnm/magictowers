// Card Chaos – Spiel-Engine.
// Läuft identisch im Browser und in Deno. Alles ist deterministisch aus dem Seed
// und den mitgelieferten Zeitstempeln ableitbar, damit der Server jeden Zug
// nachrechnen kann.

export const MAX_SLOTS = 3;   // so viele Karten merkt sich die Ablage maximal
export const BASE_SLOTS = 1;  // ohne Kombo liegt genau eine Karte offen
export const DECK_SIZE = 16;
export const BOARD_SIZE = 28;

/** Ab welchem Streak der 2. bzw. 3. Ablageplatz aufgeht. */
export const SLOT_STREAK = [5, 10];

// Die Runden werden immer kürzer: von entspannt zu hektisch. Die verlorene Zeit
// wird über einen Rundenmultiplikator exakt wieder aufgewogen, damit späte
// Runden nicht weniger wert sind als frühe.
export const ROUND_MS = 90_000;      // erste Runde
export const ROUND_MIN_MS = 25_000;  // letzte Runde
export const ROUNDS = 10;

/** Rundenlänge in ms – linear von ROUND_MS auf ROUND_MIN_MS über die Partie. */
export function roundMs(round, totalRounds = ROUNDS) {
  if (totalRounds <= 1) return ROUND_MS;
  const f = Math.min(1, Math.max(0, (round - 1) / (totalRounds - 1)));
  return Math.round((ROUND_MS + (ROUND_MIN_MS - ROUND_MS) * f) / 1000) * 1000;
}

/** Genau so viel mehr Punkte, wie die Runde kürzer ist. */
export function roundMult(round, totalRounds = ROUNDS) {
  return Math.round((ROUND_MS / roundMs(round, totalRounds)) * 10) / 10;
}

/** Ab dieser Runde können die verdeckten Karten wirklich verdeckt liegen. */
export const FOG_FROM_ROUND = 3;

// Gespielt wird um dicke Zahlen: eine Karte bringt im Grundwert 2.500, unter
// voller Multiplikator-Kette aber 300.000. Eine starke Runde landet damit im
// zweistelligen Millionenbereich.
export const SCORE = {
  perCard: 5_000,     // × Streak × Bonusleiste × Türme
  maxStreakMult: 10,
  peak: 500_000,      // Turmspitze abgeräumt
  boardClear: 2_000_000,
  perLeftoverCard: 150_000,
  goldMult: 10,       // Goldkarte zahlt das Zehnfache
  miss: 20_000,       // Fehlgriff auf eine offene Karte, × Fehlserie (max ×5)
  maxMissRun: 5,
};

/** Bonusleiste: läuft dauernd aus, füllt sich durch schnelle Züge. */
export const BOOST = {
  drainMs: 6000,   // volle Leiste ist nach 6 s leer
  fastMs: 1500,    // schneller als das zählt als „hintereinander"
  gain: 0.5,       // maximaler Zuwachs pro Karte
  maxMult: 2,      // volle Leiste = dreifache Punkte
};

/** So viele Goldkarten liegen pro Runde im Feld – bei allen an derselben Stelle. */
export const GOLD_COUNT = 3;

/** Risikoleiter: nach dem Rundenende darf man seinen Einsatz verdoppeln. */
export const RISK = {
  steps: 3,        // so oft darf man hoch
  share: 0.5,      // so viel vom Rundenkonto steht jedes Mal auf dem Spiel
  windowMs: 10_000, // so lange wartet der Tisch am Ende noch aufs Risiko
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

/** Wo die Goldkarten liegen. Hängt nur am Seed – also bei allen gleich. */
export function goldFor(seed) {
  const rnd = mulberry32(hashSeed(`${seed}#gold`));
  const pool = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, GOLD_COUNT).sort((a, b) => a - b);
}

// -------------------------------------------------------------------- State

export function createRound(seed, round = 1, totalRounds = ROUNDS) {
  const cards = shuffled(seed);
  const st = {
    seed,
    round,
    totalRounds,
    ms: roundMs(round, totalRounds),
    roundMult: roundMult(round, totalRounds),
    fog: fogFor(seed, round),
    gold: goldFor(seed),
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
    golds: 0,       // eingesammelte Goldkarten
    best: 0,        // dickster Einzelgewinn der Runde
    misses: 0,      // Fehlgriffe insgesamt
    missRun: 0,     // Fehlgriffe in Folge – erhöht den Abzug
    risk: { used: 0, won: 0, lost: 0, done: false },
    over: false,
    finished: null, // 'clear' | 'stuck' | null
  };
  // Erste Karte kommt gratis auf die Ablage, sonst könnte man nicht starten.
  resetSlots(st, st.deck[st.deckPos++]);
  return st;
}

// ------------------------------------------------------------------- Regeln

export function isOpen(st, i) {
  // Der Index kommt aus einer Nachricht des Clients. Ohne diese Zeile griff
  // `LAYOUT[i]` bei einem Wert ausserhalb des Bretts ins Leere und warf
  // "Cannot read properties of undefined (reading 'covers')". Geworfen wurde
  // damit bis in `route()` hinauf, wo der Fehler nur noch protokolliert wird:
  // der Client bekam gar keine Antwort - auch kein `resync` -, und jede
  // solche Nachricht schrieb einen Stacktrace ins Journal. Ein Feld, das es
  // nicht gibt, ist kein Fehlerfall, sondern schlicht nicht offen.
  // `miss()` prueft die Grenzen laengst; hier fehlte es.
  if (!Number.isInteger(i) || i < 0 || i >= BOARD_SIZE) return false;
  if (st.taken[i]) return false;
  return LAYOUT[i].covers.every((c) => st.taken[c]);
}

/** Liegt die Karte in dieser Runde verdeckt? Deckt sich auf, sobald sie frei ist. */
export function isHidden(st, i) {
  return !!st.fog && !st.taken[i] && !isOpen(st, i);
}

/** Goldkarte? Zahlt das Zehnfache und füllt die Bonusleiste komplett. */
export function isGold(st, i) {
  return st.gold.includes(i);
}

// ------------------------------------------------------- Multiplikator-Kette

export const streakMult = (st) => Math.min(Math.max(st.streak, 1), SCORE.maxStreakMult);
/** Jede offene Turmspitze verdoppelt: ×1 → ×2 → ×4 → ×8. */
export const towerMult = (st) => 1 << st.peaks.filter(Boolean).length;
export const boostMult = (st, t) => 1 + (t == null ? st.boost : boostAt(st, t)) * BOOST.maxMult;

/** Was eine Karte gerade wert wäre – für die Anzeige im HUD. */
export function mults(st, t) {
  const streak = streakMult(st);
  const boost = boostMult(st, t);
  const tower = towerMult(st);
  return { streak, boost, tower, total: streak * boost * tower };
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

/**
 * Ablage auf eine einzige Karte zusammenklappen – Rundenstart und Nachziehen.
 * Die gesperrten Plätze werden dabei geleert, damit beim nächsten
 * Freischalten keine uralte Karte wieder auftaucht.
 */
function resetSlots(st, card) {
  st.slots = new Array(MAX_SLOTS).fill(null);
  st.slots[0] = card;
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
    const bonus = Math.round((SCORE.boardClear + left * SCORE.perLeftoverCard) * st.roundMult);
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
  const covered = st.slots[slot];   // die Karte, auf die gelegt wird
  st.taken[i] = true;
  st.cardsPlayed++;
  st.streak++;
  st.bestStreak = Math.max(st.bestStreak, st.streak);

  drainBoost(st, t);
  feedBoost(st, t);

  // Goldkarte: Leiste sofort randvoll, bevor der Multiplikator gerechnet wird.
  const gold = isGold(st, i);
  if (gold) { st.boost = 1; st.golds++; }

  const m = mults(st);
  let gain = Math.round(SCORE.perCard * m.total * st.roundMult) * (gold ? SCORE.goldMult : 1);

  const ev = {
    type: 'play', index: i, card, slot, gold,
    streak: st.streak, mult: m.streak, boost: st.boost, mults: m, gain: 0, peaks: [],
  };

  // Turmspitze abgeräumt? Hebt ab der nächsten Karte den Turm-Multiplikator.
  for (const p of PEAK_TIPS) {
    if (!st.peaks[p] && st.taken[p]) {
      st.peaks[p] = true;
      gain += Math.round(SCORE.peak * st.roundMult);
      ev.peaks.push(p);
    }
  }

  st.missRun = 0;   // sauberer Zug bricht die Fehlserie

  st.score += gain;
  st.best = Math.max(st.best, gain);
  ev.gain = gain;

  const before = st.unlocked;
  st.unlocked = slotsForStreak(st.streak);
  if (st.unlocked > before) ev.unlocked = st.unlocked;

  // Die Karte deckt genau den Stapel zu, auf den sie passt – die anderen
  // Ablagen bleiben unberührt liegen. Früher rutschte stattdessen alles einen
  // Platz nach hinten, und die hinterste Karte fiel dabei heraus: wer bei
  // 6-7-8 eine 5 auf die 6 legte, stand danach vor 5-6-7 und hatte die 8
  // verloren, ohne sie angefasst zu haben (Bugreport 19).
  st.slots[slot] = card;
  // Ein gerade freigeschalteter Platz bekommt die eben zugedeckte Karte –
  // sonst bliebe er leer und wäre nutzlos.
  if (st.unlocked > before) st.slots[st.unlocked - 1] = covered;

  return settle(st, ev);
}

/**
 * Danebengegriffen: eine offene Karte angeklickt, die nirgends passt. Kostet
 * Punkte, und zwar zunehmend – Blindklicken durchs Feld soll sich nicht lohnen.
 * Verdeckte und schon abgeräumte Karten kosten nichts, die sieht man ja.
 */
export function miss(st, i, t = 0) {
  if (st.over) return null;
  if (i < 0 || i >= BOARD_SIZE) return null;
  if (st.taken[i] || !isOpen(st, i)) return null;
  if (matchingSlot(st, i) >= 0) return null;   // der Zug wäre gültig gewesen

  st.misses++;
  st.missRun++;
  const cost = Math.round(SCORE.miss * st.roundMult * Math.min(st.missRun, SCORE.maxMissRun));
  const before = st.score;
  st.score = Math.max(0, st.score - cost);   // unter null geht es nicht
  drainBoost(st, t);

  return { type: 'miss', index: i, card: st.board[i], cost: before - st.score, run: st.missRun };
}

/** Karte vom Nachziehstapel holen. Bricht den Streak und klappt die Ablage zu. */
export function draw(st, t = 0) {
  if (st.over || !canDraw(st)) return null;
  const card = st.deck[st.deckPos++];
  st.streak = 0;
  st.unlocked = BASE_SLOTS;
  drainBoost(st, t);   // Ziehen füttert die Leiste nicht, sie läuft weiter aus
  resetSlots(st, card);
  return settle(st, { type: 'draw', card, boost: st.boost, gain: 0 });
}

// -------------------------------------------------------------- Risikoleiter

/** Was beim nächsten Zug auf dem Spiel steht. */
export function riskStake(st) {
  return Math.round(st.score * RISK.share);
}

export function canRisk(st) {
  return st.over && !st.risk.done && st.risk.used < RISK.steps && riskStake(st) > 0;
}

/**
 * Einen Zug der Leiter abrechnen. Ob gewonnen wird, entscheidet **der Server** –
 * aus dem Seed dürfte es nicht ableitbar sein, sonst wüsste der Client vorher,
 * wann sich das Risiko lohnt.
 */
export function applyRisk(st, won) {
  const stake = riskStake(st);
  st.risk.used++;
  if (won) { st.score += stake; st.risk.won++; } else { st.score -= stake; st.risk.lost++; }
  if (st.risk.used >= RISK.steps) st.risk.done = true;
  return { won, stake, score: st.score, used: st.risk.used, done: st.risk.done };
}

export function stopRisk(st) {
  st.risk.done = true;
  return { stopped: true, score: st.score, used: st.risk.used, done: true };
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
    golds: st.golds,
    best: st.best,
    misses: st.misses,
    left: st.taken.filter((t) => !t).length,
    over: st.over,
    finished: st.finished,
    risking: canRisk(st),
    riskWon: st.risk.won,
    riskLost: st.risk.lost,
  };
}
