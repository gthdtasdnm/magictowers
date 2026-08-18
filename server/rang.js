/**
 * Plätze vergeben – gleicher Score heißt gleicher Platz. Liste muss sortiert
 * sein. Steht in einer eigenen Datei, weil sowohl der Tisch (`rooms.js`) als
 * auch die Bestenliste (`leaderboard.js`) sie braucht und `leaderboard.js`
 * nicht auf `rooms.js` zeigen darf – das wäre ein Ring.
 */
export function rank(list, key = 'score') {
  list.forEach((r, i) => {
    r.place = i > 0 && list[i - 1][key] === r[key] ? list[i - 1].place : i + 1;
  });
  return list;
}
