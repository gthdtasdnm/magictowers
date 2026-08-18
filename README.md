# 🃏 Card Chaos

Ein schnelles Kartenspiel für 1–4 Leute (`MIN_PLAYERS = 1` seit dem
18.08.2026 – allein läuft es gegen die eigene Bestzeit). Drei Pyramiden, ein Timer,
zehn Runden – wer am schnellsten Ketten baut, gewinnt.

Läuft komplett auf **Deno**, ohne eine einzige externe Abhängigkeit. Kein Build-Schritt,
kein `node_modules`, ein Prozess.

---

## Schnellstart (lokal)

```bash
deno task dev     # mit Auto-Reload auf http://localhost:8080
deno task start   # ohne Reload
deno task test    # Engine-Tests
```

Zum Ausprobieren allein: die Seite in **zwei Browser-Tabs** öffnen. Jeder Tab ist ein
eigener Spieler (die Spieler-ID hängt am `sessionStorage`).

---

## An den Tisch kommen

Es gibt **vier feste Tische**. Man klickt einen an und sitzt drin – kein Raum
anlegen, keine Codes. Wer als Erster an einem Tisch sitzt, ist **Host**: er stellt
die Rundenzahl ein und startet. Alle anderen drücken **Bereit**, und erst dann
lässt sich starten. Ab zwei Leuten geht es los, vier passen an einen Tisch.

## Spielregeln

Vor dir liegen drei Pyramiden aus 28 Pokerkarten; nur die unterste Reihe ist offen.
Daneben ein Nachziehstapel mit 16 Karten.

| Aktion | Wirkung |
|---|---|
| Offene Feldkarte anklicken | Geht, wenn sie **genau ±1** zu einer offenen Ablagekarte ist (K–A–2 zählt rundherum) |
| Nachziehen (Klick aufs Deck oder **Leertaste**) | Neue Karte in die Ablage – **Streak weg**, Ablage wieder auf eine Karte |
| Karte gelegt | Sie deckt **genau die Ablagekarte zu, auf die sie passt** – die anderen Ablagen bleiben unberührt liegen |

Legbare Karten werden **nirgends hervorgehoben** – nicht durch Leuchten, nicht durch
Mauszeiger oder Hover. Alle freien Karten sehen gleich aus; das Suchen gehört zum Spiel.

**Ablage.** Normal liegt genau **eine** Karte da. Eine starke Kombi reiht weitere auf:
ab Streak 5 erscheint eine der zuletzt gelegten Karten als zweite Ablage, ab Streak 10
eine dritte. Vorher sind sie gar nicht sichtbar – sie fahren beim Freischalten rein.
Ein Nachzug klappt alles wieder auf eine Karte zusammen. Mehr als drei gibt es nie.

Jede offene Ablage ist ein **eigener Stapel**: Wer bei 6-7-8 die 5 auf die 6 legt, sieht
danach 5-7-8 und nicht 5-6-7. Früher rutschte stattdessen alles einen Platz nach hinten,
und die hinterste Karte fiel dabei heraus, ohne dass man sie angefasst hatte – der Grund,
warum die zweite und dritte Ablage sich nicht wie ein Gewinn anfühlten (Bugreport 19).

**Bonusleiste.** Sie läuft dauernd aus und füllt sich, wenn du Karte auf Karte legst.
Volle Leiste heißt **doppelte Punkte**. Nachziehen lädt sie nicht auf.

**Verdeckte Karten.** Ab Runde 3 liegen die hinteren Karten manchmal wirklich verdeckt
und drehen sich erst um, wenn beide Karten davor weg sind. Ob eine Runde verdeckt
läuft, hängt am Seed – es gilt also **für alle am Tisch gleich** und wird zu den
späteren Runden hin immer wahrscheinlicher.

**Goldkarten.** Drei Plätze im Feld sind ⭐ markiert – aus dem Seed abgeleitet, also bei
allen an derselben Stelle. Wer eine legt, kassiert den **zehnfachen** Kartenwert und hat
augenblicklich die volle Bonusleiste.

**Punkte.** Gespielt wird um dicke Zahlen. Eine Karte ist 5.000 wert, aber alles hängt
an der Multiplikator-Kette:

```
Punkte = 5.000 × Streak (bis ×10) × Bonusleiste (bis ×3) × Türme (bis ×8)
```

| | |
|---|---|
| Karte legen | 5.000 × Kette – von 5.000 bis **1.200.000** pro Karte |
| Goldkarte ⭐ | zehnfacher Kartenwert, Bonusleiste sofort voll |
| Streak 5 / 10 | 2. bzw. 3. Ablagekarte offen |
| Turmspitze abgeräumt | +500.000, und der Turm-Multiplikator **verdoppelt** sich (×1 → ×2 → ×4 → ×8) |
| Board komplett leer | +2.000.000 und +150.000 pro übriger Stapelkarte |
| **Fehlgriff** | −20.000, und jeder weitere in Folge kostet mehr (bis ×5) |

Eine mittelmäßige Runde landet bei rund **2 Millionen**, eine richtig gute bei
**10 Millionen und mehr** – und die Risikoleiter kann das noch mal verdreifachen.

**Fehlgriffe.** Eine offene Karte anzuklicken, die nirgends passt, kostet 20.000 – und
jeder weitere Fehlgriff in Folge kostet ein Vielfaches davon, gedeckelt beim Fünffachen.
Ein sauberer Zug setzt die Fehlserie zurück. Verdeckte und schon abgeräumte Karten kosten
nichts; blind durchs Feld klicken soll sich nicht lohnen, versehentlich danebentippen
aber auch nicht bestraft werden. Unter null geht der Punktestand nie.

**Rundenlängen.** Die Runden werden immer kürzer – von 90 Sekunden herunter auf 25, linear
über die gewählte Rundenzahl verteilt. Damit späte Runden dadurch nicht weniger wert sind,
zählt jede Runde einen **Rundenmultiplikator**, der exakt dem Zeitverhältnis entspricht
(`90 s / Rundenlänge`) und auf *alle* Punkte der Runde wirkt, Abzüge eingeschlossen:

| Runden | Verlauf |
|---|---|
| 3 | 90 s ×1,0 · 58 s ×1,6 · 25 s ×3,6 |
| 5 | 90 s ×1,0 · 74 s ×1,2 · 58 s ×1,6 · 41 s ×2,2 · 25 s ×3,6 |
| 10 | 90 s ×1,0 · 83 s ×1,1 · … · 32 s ×2,8 · 25 s ×3,6 |

Wer von der Uhr gebremst wird, kommt damit rechnerisch auf dasselbe heraus. Wer das Board
ohnehin vor Ablauf leerräumt, verdient in den späten Runden deutlich mehr – die Partie
entscheidet sich also am Ende.

**Risikoleiter.** Sobald du durch bist, steht die Hälfte deiner Rundenpunkte zur
Wahl: 50/50, gewonnen heißt verdoppelt, verloren heißt weg. Bis zu drei Sprossen,
Aufhören geht jederzeit. Den Münzwurf macht **der Server** – der Client könnte ihn
sonst vorher ausrechnen und nur bei sicherem Gewinn ziehen. Der Erwartungswert ist
exakt neutral, die Varianz ist es nicht.

**Rundenende.** Ist der Stapel leer und passt nichts mehr, bist du **durch** – genau
wie wenn du das Board leergeräumt hast. Es wird nicht neu ausgeteilt; du siehst deinen
Stand, darfst an die Risikoleiter und wartest, bis auch die anderen fertig sind. Sobald
alle durch sind, bleiben noch 10 Sekunden fürs Risiko, dann kommt die Auswertung –
spätestens wenn die Rundenzeit abgelaufen ist.

**Alle Spieler bekommen exakt dasselbe Blatt** – es entscheidet also nur, wer schneller
und cleverer räumt. Sobald alle „Bereit" drücken, geht es weiter. Nach der letzten
Runde gewinnt die höchste Gesamtpunktzahl, und das Ergebnis landet in der Bestenliste.

Die **Bestenliste** ist nach Rundenzahl getrennt – 3, 5 und 10 Runden haben je eine
eigene, weil zehn Runden rund das Dreifache einer Dreirundenpartie einbringen und
eine kurze Partie in einem gemeinsamen Topf chancenlos wäre. Dazu kommt der
Zeitraum: „Diese Woche" (ab Montag 00:00 Berliner Zeit) oder „Ewig". Sichtbar ist
immer nur eines dieser sechs Felder; welches, wählen zwei Knopfreihen, und beim
Öffnen steht die Rundenzahl vorne, die am eigenen Tisch eingestellt ist. Jede Person
belegt genau **eine Zeile** – ihre beste Partie im gewählten Feld.

---

## Aufbau

```
shared/engine.js    Spiellogik – läuft identisch im Browser und auf dem Server
server/main.js      HTTP + WebSocket, statische Dateien
server/rooms.js     Räume, Rundenablauf, Zugvalidierung
server/leaderboard.js  Bestenliste als JSON-Datei
server/rang.js      Plätze vergeben – von rooms.js und leaderboard.js genutzt
public/             Frontend (Vanilla JS, keine Build-Tools)
tests/              Engine-Tests
```

**Warum der Server autoritativ ist:** Der Client rechnet jeden Zug sofort lokal
(damit sich nichts träge anfühlt) und schickt ihn parallel an den Server. Der Server
führt dieselbe Engine mit demselben Seed und lehnt ungültige Züge ab – dann bekommt
der Client ein `resync` mit dem echten Stand. Manipulierte Scores gehen so nicht.

Die Bonusleiste hängt an der Uhr, also schickt der Client seinen Zeitstempel (`ts`)
mit – seine Uhr ist über die Ping-Messung mit dem Server abgeglichen. Der Server
übernimmt ihn nur, solange er plausibel neben seiner eigenen Uhr liegt (höchstens
1,5 s zurück), sonst rechnet er mit seiner Zeit und schickt ein `resync`. Damit lässt
sich die Leiste nicht durch eingefrorene Zeitstempel vollhalten.

Verbindungsabbrüche sind abgefangen: Der Platz am Tisch bleibt reserviert, der Client
verbindet sich automatisch neu und bekommt seinen Rundenstand zurück.

---

## Deployment auf dem Ubuntu-Server

### 1. Deno installieren

```bash
curl -fsSL https://deno.land/install.sh | sh
sudo mv ~/.deno/bin/deno /usr/local/bin/
deno --version
```

### 2. Code hochladen

```bash
ssh user@inf-zeus.de 'sudo mkdir -p /opt/cardchaos && sudo chown $USER /opt/cardchaos'
rsync -av --exclude data/ --exclude .git/ ./ user@inf-zeus.de:/opt/cardchaos/
```

Oder direkt vom Repo aus – dann ist ein Update später nur `git pull` plus Neustart:

```bash
ssh user@inf-zeus.de
sudo git clone https://github.com/gthdtasdnm/cardchaos.git /opt/cardchaos
```

### 3. Dauerhaft laufen lassen (PM2)

Läuft auf demselben Server schon PM2 (z. B. für Keep), kommt Card Chaos einfach
daneben. Deno ist kein JS-Skript, deshalb `--interpreter none` und die Argumente
hinter `--`:

```bash
cd /opt/cardchaos
PORT=8080 HOST=127.0.0.1 MT_DATA=/opt/cardchaos/data/leaderboard.json \
pm2 start /usr/local/bin/deno --name cardchaos --interpreter none --cwd /opt/cardchaos -- \
  run --allow-net --allow-read --allow-write --allow-env server/main.js

pm2 save
pm2 logs cardchaos
```

`pm2 startup` muss nur einmal pro Server laufen – ist das für ein anderes Projekt
schon passiert, reicht hier `pm2 save`.

Zwei Dinge, die man leicht übersieht:

- **Port frei wählen.** Läuft Keep auf 3000, nimm für Card Chaos 8080 (so steht es
  auch in der Apache-Config unten). Zwei Dienste auf demselben Port starten nicht.
- **`HOST=127.0.0.1`** – sonst hängt der Deno-Prozess offen im Netz und man käme unter
  Umgehung von Apache direkt auf `inf-zeus.de:8080`.

Update später:

```bash
cd /opt/cardchaos && git pull && pm2 restart cardchaos
```

<details>
<summary>Alternative: systemd statt PM2</summary>

`/etc/systemd/system/cardchaos.service`:

```ini
[Unit]
Description=Card Chaos
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/cardchaos
Environment=PORT=8080
Environment=HOST=127.0.0.1
Environment=MT_DATA=/var/lib/cardchaos/leaderboard.json
ExecStart=/usr/local/bin/deno run --allow-net --allow-read --allow-write --allow-env server/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/cardchaos && sudo chown www-data /var/lib/cardchaos
sudo systemctl daemon-reload
sudo systemctl enable --now cardchaos
sudo journalctl -u cardchaos -f
```

</details>

### 4. Apache als Reverse Proxy – im Unterordner

Die App hängt an **keinem** festen Pfad: alle Verweise im HTML sind relativ und die
WebSocket-URL wird aus `location.pathname` gebaut. Sie läuft deshalb genauso unter
`/` wie unter `/cardchaos/`. Apache schneidet das Präfix beim Weiterleiten ab, der
Deno-Prozess sieht also immer nur Wurzelpfade.

Module aktivieren – `proxy_wstunnel` ist der entscheidende:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite
sudo systemctl restart apache2
```

In den vorhandenen vHost von `inf-zeus.de`:

```apache
# WebSocket MUSS zuerst stehen – Apache nimmt die erste passende Regel,
# und die allgemeine unten würde den Upgrade-Handshake verschlucken.
ProxyPass        /cardchaos/ws  ws://127.0.0.1:8080/ws
ProxyPassReverse /cardchaos/ws  ws://127.0.0.1:8080/ws

ProxyPass        /cardchaos/    http://127.0.0.1:8080/
ProxyPassReverse /cardchaos/    http://127.0.0.1:8080/

# Ohne den Slash am Ende wäre der Basispfad "/" und die relativen Pfade
# (css/style.css …) würden auf inf-zeus.de/css/style.css zeigen.
RedirectMatch ^/cardchaos$ /cardchaos/
```

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

Die drei Fallstricke in genau dieser Reihenfolge:

1. **`proxy_wstunnel` fehlt** → die Verbindung bricht sofort ab, das Spiel hängt in
   der Lobby. Das ist der Klassiker.
2. **`/cardchaos/ws` steht nach der allgemeinen Regel** → gleicher Effekt, weil der
   Upgrade als normales HTTP weitergereicht wird.
3. **Der Redirect auf den Schrägstrich fehlt** → wer `inf-zeus.de/cardchaos` ohne
   Slash aufruft, bekommt eine Seite ohne CSS und ohne JavaScript.

Läuft der vHost schon über HTTPS (certbot), ist nichts weiter zu tun – der Client
schaltet automatisch auf `wss://`.

Danach: `https://inf-zeus.de/cardchaos/` – und `?tisch=2` führt direkt an Tisch 2.

**Anderer Pfad?** Nur die vier Zeilen oben anpassen, im Code ist nichts zu ändern.

---

## Stellschrauben

Alles Wichtige steht oben in `shared/engine.js`:

```js
export const ROUND_MS = 90_000;     // erste Runde
export const ROUND_MIN_MS = 25_000; // letzte Runde
export const ROUNDS = 10;           // Standard-Rundenzahl
export const DECK_SIZE = 16;        // Nachziehstapel
export const MAX_SLOTS = 3;         // so viele Ablagekarten maximal
export const BASE_SLOTS = 1;        // so viele ohne Kombi
export const SLOT_STREAK = [5, 10]; // ab welchem Streak die 2./3. aufgeht
export const FOG_FROM_ROUND = 3;    // ab wann verdeckt gespielt wird
export const GOLD_COUNT = 3;        // Goldkarten pro Runde
export const BOOST = { ... };       // Bonusleiste
export const RISK = { ... };        // Risikoleiter
export const SCORE = { ... };       // Punktevergabe
```

Die vier Tische stehen oben in `server/rooms.js` (`TABLES`).

Änderungen dort gelten automatisch für Server und Client – neu laden reicht.
