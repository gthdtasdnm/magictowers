// Bestenliste als JSON-Datei – reicht völlig, und es gibt nichts zu installieren.

import { rank } from './rang.js';

const FILE = Deno.env.get('MT_DATA') ?? './data/leaderboard.json';

/**
 * Jede Rundenzahl bekommt ihre eigene Liste. Der Rundenmultiplikator gleicht
 * die kürzeren Runden exakt aus, also bringt jede Runde ungefähr gleich viel –
 * eine Partie über zehn Runden liefert damit rund das Dreifache einer über
 * drei. In einem gemeinsamen Topf wäre eine kurze Partie chancenlos.
 */
export const RUNDEN = [3, 5, 10];

/** Rundenzahl der Einträge von vor dem 19.08.2026: damals gab es das Feld
 *  noch nicht, und zehn war die Voreinstellung im Menü. */
const RUNDEN_ALT = 10;

// Frische Einträge bleiben vollständig liegen, denn die Wochenliste zeigt auch
// schwache Läufe. Ältere werden auf den besten Lauf je Person und Rundenzahl
// eingedampft – mehr braucht die ewige Liste nicht.
const VOLLSTAENDIG_MS = 60 * 24 * 3600 * 1000;
const MAX_ENTRIES = 5000;   // letzte Reißleine, falls doch jemand Amok spielt
const ZEILEN = 25;

let entries = [];
let dirty = false;

export async function load() {
  try {
    entries = JSON.parse(await Deno.readTextFile(FILE));
  } catch {
    entries = [];
  }
  for (const e of entries) if (e.totalRounds == null) e.totalRounds = RUNDEN_ALT;
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

// Der Prozess soll nicht an diesem Timer haengen: der Server lebt von
// `Deno.serve`, und in den Proben soll er nicht endlos weiterlaufen.
Deno.unrefTimer(setInterval(() => flush(), 5000));

// ------------------------------------------------------------ Wochengrenze

const BERLIN = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Wie weit die Berliner Wanduhr der Weltzeit voraus ist, in ms. */
function berlinVorsprung(ms) {
  const p = {};
  for (const t of BERLIN.formatToParts(ms)) p[t.type] = t.value;
  // Mitternacht liefert je nach Laufzeitumgebung 0 oder 24 – deshalb % 24.
  const wanduhr = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wanduhr - Math.floor(ms / 1000) * 1000;
}

/**
 * Montag 00:00 Berliner Zeit der Woche, in der `jetzt` liegt. Die Wochenliste
 * ist damit ein reiner Filter: es wird nie etwas gelöscht, es fällt nur aus
 * der Ansicht – kein Zeitgeber, der ausfallen könnte, und die Vorwoche wäre
 * jederzeit nachrüstbar.
 */
export function wochenStart(jetzt = Date.now()) {
  const vorsprung = berlinVorsprung(jetzt);
  const d = new Date(jetzt + vorsprung);
  const seitMontag = (d.getUTCDay() + 6) % 7;
  const montagWanduhr = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
    seitMontag * 86400000;
  // Zwischen Montag und heute kann die Zeit umgestellt worden sein, deshalb
  // mit dem Vorsprung nachziehen, der am Montag selbst galt.
  return montagWanduhr - berlinVorsprung(montagWanduhr - vorsprung);
}

// ------------------------------------------------------------------ Pflege

function aufraeumen(jetzt = Date.now()) {
  const grenze = jetzt - VOLLSTAENDIG_MS;
  const jung = [];
  const beste = new Map();
  for (const e of entries) {
    if (e.at >= grenze) {
      jung.push(e);
      continue;
    }
    const k = `${e.name.toLowerCase()} ${e.totalRounds}`;
    const bisher = beste.get(k);
    if (!bisher || e.score > bisher.score) beste.set(k, e);
  }
  entries = [...beste.values(), ...jung];
  // Nach Alter kappen, nicht nach Punktzahl: eine schwache Partie von heute
  // gehört in die Wochenliste, eine starke von vor einem Jahr nicht mehr.
  entries.sort((a, b) => a.at - b.at);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
}

/** Ein abgeschlossenes Spiel verbuchen. `results` ist nach Score sortiert. */
export function record(results, roomName, totalRounds = RUNDEN_ALT) {
  const at = Date.now();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    entries.push({
      name: r.name,
      score: r.score,
      won: (r.place ?? i + 1) === 1,   // bei Gleichstand gewinnen beide
      place: r.place ?? i + 1,
      players: results.length,
      totalRounds,
      bestStreak: r.bestStreak ?? 0,
      clears: r.clears ?? 0,
      room: roomName,
      at,
    });
  }
  aufraeumen(at);
  dirty = true;
  // Sofort schreiben, nicht erst beim naechsten Takt: hier ist gerade eine
  // ganze Partie fertig geworden, und ein Neustart in den naechsten fuenf
  // Sekunden wuerde sie sonst verschlucken.
  flush();
}

// ---------------------------------------------------------------- Abfragen

/**
 * Eine Liste: **eine Zeile je Person**, ihr bester Lauf im gewählten Feld.
 * Ohne das belegt der Vielspieler die halbe Tabelle mit sich selbst – am
 * 18.08.2026 gehörten 19 von 37 Einträgen einem einzigen Namen.
 */
export function tafel(totalRounds, zeitraum = 'woche', n = ZEILEN) {
  const seit = zeitraum === 'woche' ? wochenStart() : 0;
  const je = new Map();
  for (const e of entries) {
    if (e.totalRounds !== totalRounds || e.at < seit) continue;
    const k = e.name.toLowerCase();
    const a = je.get(k);
    if (!a) {
      je.set(k, {
        name: e.name,
        score: e.score,
        at: e.at,
        players: e.players,
        bestStreak: e.bestStreak ?? 0,
        laeufe: 1,
      });
      continue;
    }
    a.laeufe++;
    a.bestStreak = Math.max(a.bestStreak, e.bestStreak ?? 0);
    if (e.score > a.score) {
      a.name = e.name;   // die Schreibweise des besten Laufs gewinnt
      a.score = e.score;
      a.at = e.at;
      a.players = e.players;
    }
  }
  const liste = [...je.values()].sort((a, b) => b.score - a.score).slice(0, n);
  return rank(liste).map((e) => ({ rank: e.place, ...e }));
}

/**
 * Alle sechs Felder auf einmal. Zusammen sind das höchstens 150 Zeilen – dafür
 * lohnt keine Nachfrage je Klick, und das Umschalten läuft ohne Wartezeit.
 */
export function tafeln() {
  const boards = {};
  for (const r of RUNDEN) {
    boards[r] = { woche: tafel(r, 'woche'), ewig: tafel(r, 'ewig') };
  }
  return { wochenStart: wochenStart(), boards };
}

globalThis.addEventListener?.('unload', () => flush());
