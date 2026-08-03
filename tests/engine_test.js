import { assert, assertEquals } from 'jsr:@std/assert@1';
import * as E from '../shared/engine.js';

Deno.test('Layout: 28 Plätze, korrekte Verdeckung', () => {
  assertEquals(E.LAYOUT.length, 28);
  assertEquals(E.LAYOUT.filter((n) => n.row === 3).length, 10);
  // Nur die Basisreihe ist von Anfang an offen.
  for (const n of E.LAYOUT) {
    assertEquals(n.covers.length, n.row === 3 ? 0 : 2, `Platz ${n.i}`);
  }
  // Jede Deckkarte liegt tatsächlich eine Reihe tiefer und daneben.
  for (const n of E.LAYOUT) {
    for (const c of n.covers) {
      assertEquals(E.LAYOUT[c].row, n.row + 1);
      assertEquals(Math.abs(E.LAYOUT[c].x - n.x), 1);
    }
  }
});

Deno.test('Nachbarschaft inkl. Ass-Wrap', () => {
  const card = (rank) => rank; // Pik, Rang 0..12
  assert(E.adjacent(card(2), card(3)));
  assert(E.adjacent(card(3), card(2)));
  assert(E.adjacent(card(0), card(12)), 'Ass an König');
  assert(E.adjacent(card(0), card(1)), 'Ass an Zwei');
  assert(!E.adjacent(card(5), card(7)));
  assert(!E.adjacent(card(5), card(5)));
  assert(!E.adjacent(null, card(5)));
});

Deno.test('Start: Basisreihe offen, Deckel zu, eine Karte in der Ablage', () => {
  const st = E.createRound('test-1');
  assertEquals(st.board.length, 28);
  assertEquals(st.deck.length, E.DECK_SIZE);
  assertEquals(st.deckPos, 1, 'die Startkarte kommt vom Stapel');
  assert(st.slots[0] != null);
  assertEquals(st.slots.length, E.MAX_SLOTS);
  assertEquals(st.slots.slice(1).filter((c) => c != null).length, 0);
  assertEquals(st.unlocked, E.BASE_SLOTS);
  assertEquals(E.BASE_SLOTS, 1, 'ohne Kombo liegt genau eine Karte offen');
  assertEquals(E.MAX_SLOTS, 3, 'mehr als drei werden nie aufgereiht');
  for (let i = 0; i < 28; i++) assertEquals(E.isOpen(st, i), E.LAYOUT[i].row === 3);
  // Keine doppelten Karten zwischen Board und Stapel.
  assertEquals(new Set([...st.board, ...st.deck]).size, 28 + E.DECK_SIZE);
});

Deno.test('Deterministisch: gleicher Seed, gleiches Blatt', () => {
  const a = E.createRound('abc');
  const b = E.createRound('abc');
  const c = E.createRound('xyz');
  assertEquals(a.board, b.board);
  assertEquals(a.deck, b.deck);
  assert(JSON.stringify(a.board) !== JSON.stringify(c.board));
});

Deno.test('Legen: Karte weg, Ablage rutscht, Streak und Punkte steigen', () => {
  const st = E.createRound('play-1');
  // Passende Basiskarte zur Ablage bauen statt suchen.
  const top = st.slots[0];
  st.board[18] = ((E.rankOf(top) + 1) % 13) + 13; // eine Herz-Karte, Rang +1
  const before = st.slots[0];

  const ev = E.play(st, 18, 1000);
  assert(ev, 'Zug muss zulässig sein');
  assertEquals(st.taken[18], true);
  assertEquals(st.streak, 1);
  assertEquals(st.score, E.SCORE.perCard * 1, 'ohne Bonusleiste der glatte Grundwert');
  assertEquals(st.slots[0], st.board[18], 'gelegte Karte liegt oben');
  assertEquals(st.slots[1], before, 'alte Karte rutscht einen Slot nach hinten');
});

Deno.test('Verdeckte Karten sind gesperrt, werden aber frei', () => {
  const st = E.createRound('cover-1');
  const upper = E.LAYOUT.find((n) => n.row === 2);
  assertEquals(E.isOpen(st, upper.i), false);
  st.taken[upper.covers[0]] = true;
  assertEquals(E.isOpen(st, upper.i), false, 'eine Deckkarte reicht nicht');
  st.taken[upper.covers[1]] = true;
  assertEquals(E.isOpen(st, upper.i), true);
});

Deno.test('Unpassende oder verdeckte Karte lässt sich nicht legen', () => {
  const st = E.createRound('bad-1');
  const top = st.slots[0];
  st.board[18] = ((E.rankOf(top) + 5) % 13) + 26; // Rang +5 → passt nie
  assertEquals(E.play(st, 18), null);
  assertEquals(st.taken[18], false);
  assertEquals(E.play(st, 0), null, 'Turmspitze ist verdeckt');
});

Deno.test('Ziehen killt den Streak und klappt die Ablage auf eine Karte zu', () => {
  const st = E.createRound('draw-1');
  st.streak = 9;
  st.unlocked = 3;
  const posBefore = st.deckPos;
  const ev = E.draw(st, 500);
  assert(ev);
  assertEquals(st.streak, 0);
  assertEquals(st.unlocked, E.BASE_SLOTS);
  assertEquals(st.deckPos, posBefore + 1);
  assertEquals(st.slots[0], st.deck[posBefore]);
});

Deno.test('Leerer Stapel: Ziehen ist nicht mehr möglich', () => {
  const st = E.createRound('draw-2');
  st.deckPos = st.deck.length;
  assertEquals(E.canDraw(st), false);
  assertEquals(E.draw(st), null);
});

/** Legt `n` Karten am Stück – sie werden dafür passend untergeschoben. */
function chain(st, n, t0 = 0, step = 5000) {
  for (let k = 0; k < n; k++) {
    const i = [...Array(E.BOARD_SIZE).keys()].find((j) => E.isOpen(st, j));
    assert(i !== undefined, 'es muss eine offene Karte geben');
    st.board[i] = ((E.rankOf(st.slots[0]) + 1) % 13) + 13 * (i % 4);
    assert(E.play(st, i, t0 + k * step), `Zug auf Platz ${i} muss gehen`);
  }
}

Deno.test('Eine starke Kombi reiht weitere Ablagekarten auf', () => {
  const st = E.createRound('slots-1');
  chain(st, E.SLOT_STREAK[0] - 1, 0);
  assertEquals(st.unlocked, 1, 'vorher liegt nur eine Karte offen');

  chain(st, 1, 100_000);
  assertEquals(st.streak, E.SLOT_STREAK[0]);
  assertEquals(st.unlocked, 2, 'ab der Schwelle kommt eine der letzten Karten dazu');
  assert(st.slots[1] != null, 'und die ist auch wirklich belegt');

  chain(st, E.SLOT_STREAK[1] - E.SLOT_STREAK[0], 200_000);
  assertEquals(st.unlocked, 3);
  chain(st, 2, 300_000);
  assertEquals(st.unlocked, 3, 'mehr als drei gibt es nicht');

  // Nachziehen reduziert wieder auf eine Karte.
  E.draw(st, 99_000);
  assertEquals(st.unlocked, 1);
});

Deno.test('Ältere Ablagekarten bleiben legbar, solange der Slot offen ist', () => {
  const st = E.createRound('match-1');
  const a = st.slots[0];
  // Zwei Karten legen, danach auf die inzwischen älteste Karte matchen.
  st.board[18] = ((E.rankOf(a) + 1) % 13) + 13;
  E.play(st, 18);
  st.board[19] = ((E.rankOf(st.slots[0]) + 1) % 13) + 26;
  E.play(st, 19);

  // Einen Rang suchen, der ausschließlich zur dritten Ablagekarte passt.
  const only2 = [...Array(13).keys()].find((r) =>
    E.adjacent(r, st.slots[2]) && !E.adjacent(r, st.slots[0]) && !E.adjacent(r, st.slots[1]));
  assert(only2 !== undefined, 'so ein Rang muss existieren');

  const target = 20;
  st.board[target] = only2 + 39;
  st.unlocked = 3;
  assertEquals(E.matchingSlot(st, target), 2, 'passt nur auf den dritten Slot');

  // Ohne freigeschaltete Slots ginge derselbe Zug nicht.
  st.unlocked = E.BASE_SLOTS;
  assertEquals(E.matchingSlot(st, target), -1, 'gesperrte Slots zählen nicht');

  st.unlocked = 3;
  assert(E.play(st, target));
});

Deno.test('Punkte skalieren mit dem Streak, gedeckelt bei ×10', () => {
  const st = E.createRound('score-1');
  // Langsame Züge: die Bonusleiste bleibt leer, die Punkte also glatt.
  chain(st, 10, 0, 20_000);
  let expected = 0;
  for (let k = 1; k <= 10; k++) expected += E.SCORE.perCard * Math.min(k, E.SCORE.maxStreakMult);
  assert(st.score >= expected, 'Bonuspunkte kommen oben drauf');
});

Deno.test('Bonusleiste: füllt sich bei schnellen Zügen und läuft wieder aus', () => {
  const fast = E.createRound('boost-1');
  chain(fast, 4, 0, 120);   // vier Karten im 120-ms-Takt
  assert(fast.boost > 0.5, `Leiste sollte gut voll sein, ist ${fast.boost}`);

  const slow = E.createRound('boost-1');
  chain(slow, 4, 0, 4000);  // dieselben Karten, aber gemütlich
  assertEquals(slow.boost, 0, 'zu langsam für den Bonus');
  assert(fast.score > slow.score, 'schnelles Spiel bringt mehr Punkte');

  // Ohne Zug leert sich die Leiste von selbst.
  const t = fast.boostT;
  assert(E.boostAt(fast, t + E.BOOST.drainMs / 2) < fast.boost);
  assertEquals(E.boostAt(fast, t + E.BOOST.drainMs * 2), 0);
  assertEquals(fast.boost, E.boostAt(fast, t), 'die Anzeige fasst den State nicht an');
});

Deno.test('Ziehen füttert die Leiste nicht, lässt sie aber auslaufen', () => {
  const st = E.createRound('boost-2');
  chain(st, 4, 0, 120);
  const before = st.boost;
  E.draw(st, st.boostT + 1000);
  assert(st.boost < before, 'die Leiste läuft weiter aus');
  E.draw(st, st.boostT + 200);
  E.draw(st, st.boostT + 200);
  assert(st.boost < before, 'schnelles Ziehen lädt sie nicht auf');
});

Deno.test('Turmspitze abräumen bringt Bonus – nur einmal', () => {
  const st = E.createRound('peak-1');
  // Alles außer der ersten Spitze abräumen.
  for (let i = 1; i < 28; i++) st.taken[i] = true;
  st.taken[0] = false;
  st.slots[0] = ((E.rankOf(st.board[0]) + 1) % 13) + 13;
  const before = st.score;
  const ev = E.play(st, 0);
  assert(ev.peaks.includes(0));
  assert(st.score - before >= E.SCORE.peak);
  assert(ev.boardClear, 'damit ist auch das Board leer');
});

Deno.test('Board leer: Bonus kassiert, danach ist die Runde durch', () => {
  const st = E.createRound('clear-1');
  for (let i = 1; i < 28; i++) st.taken[i] = true;
  st.streak = 6;
  st.slots[0] = ((E.rankOf(st.board[0]) + 1) % 13) + 13;
  const ev = E.play(st, 0);

  assert(ev.boardClear);
  assertEquals(ev.finished, 'clear');
  assertEquals(st.over, true, 'es wird nicht mehr neu ausgeteilt');
  assertEquals(st.clears, 1);
  assert(st.score > E.SCORE.boardClear);
  assertEquals(E.draw(st), null, 'nach dem Ende geht kein Zug mehr');
});

Deno.test('Stapel leer und nichts mehr legbar: durch, ohne Abzug', () => {
  const st = E.createRound('stuck-1');
  // Ablage auf einen Rang setzen, zu dem keine offene Karte passt.
  const openRanks = new Set(E.LAYOUT.filter((n) => n.row === 3).map((n) => E.rankOf(st.board[n.i])));
  let safe = -1;
  for (let r = 0; r < 13; r++) {
    if (![...openRanks].some((o) => Math.abs(o - r) === 1 || Math.abs(o - r) === 12)) { safe = r; break; }
  }
  if (safe < 0) return; // bei diesem Blatt nicht konstruierbar
  st.slots = [safe, null, null];
  st.unlocked = E.BASE_SLOTS;
  st.score = 500;
  assertEquals(E.hasMove(st), false);

  // Letzte Stapelkarte ziehen – hilft sie nicht weiter, ist Schluss.
  st.deckPos = st.deck.length - 1;
  st.deck[st.deckPos] = safe + 13;   // gleicher Rang, passt also auch nirgends
  const ev = E.draw(st, 1000);
  assertEquals(E.canDraw(st), false);
  assertEquals(st.over, true);
  assertEquals(ev.finished, 'stuck');
  assertEquals(st.score, 500, 'kein Abzug fürs Warten');
  assertEquals(E.play(st, 18), null);
});

Deno.test('Leerer Stapel allein beendet nichts, solange Züge da sind', () => {
  const st = E.createRound('stuck-2');
  st.deckPos = st.deck.length;
  // Zwei Anschlusskarten in der Basisreihe: nach dem ersten Zug geht es weiter.
  st.board[18] = ((E.rankOf(st.slots[0]) + 1) % 13) + 13;
  st.board[19] = ((E.rankOf(st.board[18]) + 1) % 13) + 26;
  assertEquals(E.canDraw(st), false);
  assert(E.play(st, 18), 'weiterspielen geht');
  assertEquals(st.over, false, 'ein leerer Stapel allein ist noch kein Ende');
  assert(E.hasMove(st));
});

Deno.test('Verdeckte Runden: erst ab Runde 3 und für alle gleich', () => {
  for (let r = 1; r < E.FOG_FROM_ROUND; r++) {
    for (const seed of ['a', 'b', 'c', 'd']) assertEquals(E.fogFor(seed, r), false);
  }
  // Gleicher Seed, gleiche Runde → gleiche Entscheidung für jeden Spieler.
  for (const seed of ['a', 'b', 'c', 'd']) {
    assertEquals(E.fogFor(seed, 5), E.fogFor(seed, 5));
    assertEquals(E.createRound(seed, 5).fog, E.fogFor(seed, 5));
  }
  // Irgendwann kommt es auf jeden Fall vor.
  const seeds = Array.from({ length: 40 }, (_, i) => `fog-${i}`);
  assert(seeds.some((s) => E.fogFor(s, 4)), 'ab Runde 4 muss es Fog-Runden geben');
});

Deno.test('Verdeckte Karten decken sich auf, sobald sie frei sind', () => {
  const st = E.createRound('hide-1');
  st.fog = true;
  const upper = E.LAYOUT.find((n) => n.row === 2);
  assertEquals(E.isHidden(st, upper.i), true);
  assertEquals(E.isHidden(st, upper.covers[0]), false, 'die Basisreihe liegt immer offen');
  st.taken[upper.covers[0]] = true;
  assertEquals(E.isHidden(st, upper.i), true, 'eine Karte davor reicht nicht');
  st.taken[upper.covers[1]] = true;
  assertEquals(E.isHidden(st, upper.i), false, 'jetzt ist sie frei und wird umgedreht');

  st.fog = false;
  assertEquals(E.isHidden(st, E.LAYOUT.find((n) => n.row === 0).i), false);
});

Deno.test('publicStats liefert genau die Gegner-Infos', () => {
  const st = E.createRound('stats-1');
  const s = E.publicStats(st);
  assertEquals(Object.keys(s).sort(), ['bestStreak', 'clears', 'finished', 'left', 'over', 'score', 'streak']);
  assertEquals(s.left, 28);
  assertEquals(s.over, false);
});

Deno.test('snapshot/restore ergibt denselben Zustand', () => {
  const st = E.createRound('snap-1');
  st.board[18] = ((E.rankOf(st.slots[0]) + 1) % 13) + 13;
  E.play(st, 18, 1234);
  const copy = E.restore(E.snapshot(st));
  assertEquals(copy, st);
});
