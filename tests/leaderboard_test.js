import { assertEquals } from 'jsr:@std/assert@1';

// Die Datei, aus der gelesen wird, steht beim Import fest – deshalb erst die
// Umgebung setzen, dann laden.
const DIR = await Deno.makeTempDir();
const FILE = `${DIR}/leaderboard.json`;
Deno.env.set('MT_DATA', FILE);
const LB = await import('../server/leaderboard.js');

const TAG = 86400000;

/** Ein Eintrag, wie ihn `record` schreibt. */
function eintrag(name, score, totalRounds, at, extra = {}) {
  return {
    name,
    score,
    won: true,
    place: 1,
    players: 1,
    totalRounds,
    bestStreak: 0,
    clears: 0,
    room: 'Probe',
    at,
    ...extra,
  };
}

async function laden(liste) {
  await Deno.writeTextFile(FILE, JSON.stringify(liste));
  await LB.load();
}

// ------------------------------------------------------------ Wochengrenze

Deno.test('Wochenstart: ein Montag um Mitternacht Berliner Zeit', () => {
  const fmt = (ms) =>
    new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ms);
  // Einmal quer durchs Jahr, damit beide Seiten der Zeitumstellung drankommen.
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3 * TAG + 3600000) {
    assertEquals(fmt(LB.wochenStart(t)), 'Mo., 00:00', `bei ${new Date(t).toISOString()}`);
  }
});

Deno.test('Wochenstart: liegt nie in der Zukunft und nie mehr als acht Tage zurück', () => {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += TAG + 1234567) {
    const w = LB.wochenStart(t);
    assertEquals(w <= t, true, `Zukunft bei ${new Date(t).toISOString()}`);
    assertEquals(t - w < 8 * TAG, true, `zu weit zurück bei ${new Date(t).toISOString()}`);
  }
});

Deno.test('Wochenstart: Sonntag 23:59 gehört noch zur alten Woche', () => {
  // 16.08.2026 ist ein Sonntag.
  const sonntag = Date.parse('2026-08-16T21:59:00Z'); // 23:59 Berliner Sommerzeit
  const montag = Date.parse('2026-08-16T22:00:00Z'); // 00:00 am 17.08.
  assertEquals(LB.wochenStart(montag) - LB.wochenStart(sonntag), 7 * TAG);
  assertEquals(LB.wochenStart(montag), montag);
});

// ------------------------------------------------------------------ Tafeln

Deno.test('Tafel: eine Zeile je Person, ihr bester Lauf', async () => {
  const jetzt = Date.now();
  await laden([
    eintrag('Ata', 100, 10, jetzt - 1000, { bestStreak: 5 }),
    eintrag('ata', 300, 10, jetzt - 2000, { bestStreak: 9, players: 2 }),
    eintrag('Ata', 200, 10, jetzt - 3000, { bestStreak: 7 }),
    eintrag('Madin', 250, 10, jetzt - 4000),
  ]);
  const t = LB.tafel(10, 'ewig');
  assertEquals(t.length, 2, 'zwei Personen, nicht vier Zeilen');
  assertEquals(t.map((e) => [e.name, e.score, e.laeufe]), [['ata', 300, 3], ['Madin', 250, 1]]);
  assertEquals(t[0].bestStreak, 9, 'die beste Serie über alle Läufe');
  assertEquals(t[0].players, 2, 'die Begleitdaten stammen vom besten Lauf');
  assertEquals(t.map((e) => e.rank), [1, 2]);
});

Deno.test('Tafel: Gleichstand heißt gleicher Platz', async () => {
  const jetzt = Date.now();
  await laden([
    eintrag('A', 500, 5, jetzt),
    eintrag('B', 500, 5, jetzt),
    eintrag('C', 10, 5, jetzt),
  ]);
  assertEquals(LB.tafel(5, 'ewig').map((e) => e.rank), [1, 1, 3]);
});

Deno.test('Tafel: Rundenzahlen bleiben getrennt', async () => {
  const jetzt = Date.now();
  await laden([
    eintrag('Kurz', 400, 3, jetzt),
    eintrag('Lang', 9000, 10, jetzt),
    eintrag('Mittel', 1500, 5, jetzt),
  ]);
  assertEquals(LB.tafel(3, 'ewig').map((e) => e.name), ['Kurz']);
  assertEquals(LB.tafel(5, 'ewig').map((e) => e.name), ['Mittel']);
  assertEquals(LB.tafel(10, 'ewig').map((e) => e.name), ['Lang']);
});

Deno.test('Tafel: die Wochenliste zeigt nur diese Woche, die ewige alles', async () => {
  const jetzt = Date.now();
  const vorigeWoche = LB.wochenStart(jetzt) - 1000;
  await laden([
    eintrag('Alt', 9000, 10, vorigeWoche),
    eintrag('Neu', 100, 10, jetzt),
  ]);
  assertEquals(LB.tafel(10, 'woche').map((e) => e.name), ['Neu']);
  assertEquals(LB.tafel(10, 'ewig').map((e) => e.name), ['Alt', 'Neu']);
});

Deno.test('Altbestand ohne Rundenzahl zählt als Zehnrundenpartie', async () => {
  const jetzt = Date.now();
  const alt = eintrag('Frueher', 777, 10, jetzt);
  delete alt.totalRounds;
  await laden([alt]);
  assertEquals(LB.tafel(10, 'ewig').map((e) => e.name), ['Frueher']);
  assertEquals(LB.tafel(3, 'ewig').length, 0);
});

// ----------------------------------------------------------------- Ablauf

Deno.test('record schreibt die Rundenzahl mit', async () => {
  await laden([]);
  LB.record([{ name: 'Wer', score: 42, bestStreak: 3, place: 1 }], 'Tisch', 3);
  assertEquals(LB.tafel(3, 'woche').map((e) => [e.name, e.score]), [['Wer', 42]]);
  assertEquals(LB.tafel(10, 'woche').length, 0);
});

Deno.test('tafeln liefert alle sechs Felder', async () => {
  await laden([]);
  const { boards, wochenStart } = LB.tafeln();
  assertEquals(Object.keys(boards), ['3', '5', '10']);
  for (const r of LB.RUNDEN) assertEquals(Object.keys(boards[r]), ['woche', 'ewig']);
  assertEquals(wochenStart <= Date.now(), true);
});

Deno.test('Altes wird eingedampft, Frisches bleibt vollständig', async () => {
  const jetzt = Date.now();
  const uralt = jetzt - 400 * TAG;
  await laden([
    eintrag('Opa', 100, 10, uralt),
    eintrag('Opa', 900, 10, uralt + 1000),
    eintrag('Heute', 50, 10, jetzt - 1000),
    eintrag('Heute', 60, 10, jetzt - 2000),
  ]);
  // Erst ein neuer Eintrag stößt das Aufräumen an.
  LB.record([{ name: 'Neu', score: 1, place: 1 }], 'Tisch', 10);
  const t = LB.tafel(10, 'ewig');
  assertEquals(t.find((e) => e.name === 'Opa').laeufe, 1, 'vom Uralten bleibt der beste Lauf');
  assertEquals(t.find((e) => e.name === 'Opa').score, 900);
  assertEquals(t.find((e) => e.name === 'Heute').laeufe, 2, 'Frisches bleibt vollständig');
});
