import { assertEquals } from 'jsr:@std/assert@1';
import { rank } from '../server/rooms.js';

Deno.test('Platzvergabe: gleicher Score, gleicher Platz', () => {
  const r = rank([{ score: 900 }, { score: 890 }, { score: 890 }, { score: 50 }]);
  assertEquals(r.map((x) => x.place), [1, 2, 2, 4], 'nach zwei zweiten Plätzen folgt Platz 4');
});

Deno.test('Platzvergabe: alle gleich', () => {
  const r = rank([{ score: 100 }, { score: 100 }, { score: 100 }]);
  assertEquals(r.map((x) => x.place), [1, 1, 1]);
});

Deno.test('Platzvergabe: alle verschieden', () => {
  const r = rank([{ score: 30 }, { score: 20 }, { score: 10 }]);
  assertEquals(r.map((x) => x.place), [1, 2, 3]);
});

Deno.test('Platzvergabe: alternatives Feld', () => {
  const r = rank([{ total: 5 }, { total: 5 }, { total: 1 }], 'total');
  assertEquals(r.map((x) => x.place), [1, 1, 3]);
});

Deno.test('Platzvergabe: Einzelspieler und leere Liste', () => {
  assertEquals(rank([{ score: 7 }])[0].place, 1);
  assertEquals(rank([]).length, 0);
});
