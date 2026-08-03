// Bestenliste als JSON-Datei – reicht völlig, und es gibt nichts zu installieren.

const FILE = Deno.env.get('MT_DATA') ?? './data/leaderboard.json';
const MAX_ENTRIES = 500;

let entries = [];
let dirty = false;

export async function load() {
  try {
    entries = JSON.parse(await Deno.readTextFile(FILE));
  } catch {
    entries = [];
  }
}

async function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    await Deno.mkdir(FILE.replace(/\/[^/]+$/, ''), { recursive: true });
    await Deno.writeTextFile(FILE, JSON.stringify(entries));
  } catch (e) {
    console.error('Bestenliste konnte nicht gespeichert werden:', e.message);
  }
}

setInterval(() => flush(), 5000);

/** Ein abgeschlossenes Spiel verbuchen. `results` ist nach Score sortiert. */
export function record(results, roomName) {
  const at = Date.now();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    entries.push({
      name: r.name,
      score: r.score,
      won: (r.place ?? i + 1) === 1,   // bei Gleichstand gewinnen beide
      place: r.place ?? i + 1,
      players: results.length,
      bestStreak: r.bestStreak ?? 0,
      clears: r.clears ?? 0,
      room: roomName,
      at,
    });
  }
  entries.sort((a, b) => b.score - a.score);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  dirty = true;
}

/** Top-Einzelergebnisse. */
export function top(n = 25) {
  return entries.slice(0, n).map((e, i) => ({ rank: i + 1, ...e }));
}

/** Aggregiert pro Spielername – wer ist insgesamt am stärksten? */
export function hallOfFame(n = 25) {
  const by = new Map();
  for (const e of entries) {
    const k = e.name.toLowerCase();
    const agg = by.get(k) ?? { name: e.name, games: 0, wins: 0, best: 0, total: 0, bestStreak: 0 };
    agg.games++;
    if (e.won) agg.wins++;
    agg.best = Math.max(agg.best, e.score);
    agg.total += e.score;
    agg.bestStreak = Math.max(agg.bestStreak, e.bestStreak ?? 0);
    by.set(k, agg);
  }
  return [...by.values()]
    .map((a) => ({ ...a, avg: Math.round(a.total / a.games) }))
    .sort((a, b) => b.wins - a.wins || b.best - a.best)
    .slice(0, n)
    .map((e, i) => ({ rank: i + 1, ...e }));
}

globalThis.addEventListener?.('unload', () => flush());
