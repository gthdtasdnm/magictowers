# 🃏 Magic Towers

Ein schnelles Mehrspieler-Kartenspiel für 2–4 Leute, inspiriert vom Klassiker an den
Fun4Four-Tischen in der Shishabar. Drei Pyramiden, ein Timer, zehn Runden – wer am
schnellsten Ketten baut, gewinnt.

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
| Karte gelegt | Sie wandert nach vorn in die Ablage, die älteren rutschen nach hinten |

Legbare Karten werden **nirgends hervorgehoben** – nicht durch Leuchten, nicht durch
Mauszeiger oder Hover. Alle freien Karten sehen gleich aus; das Suchen gehört zum Spiel.

**Ablage.** Normal liegt genau **eine** Karte da. Eine starke Kombi reiht weitere auf:
ab Streak 5 erscheint eine der zuletzt gelegten Karten als zweite Ablage, ab Streak 10
eine dritte. Vorher sind sie gar nicht sichtbar – sie fahren beim Freischalten rein.
Ein Nachzug klappt alles wieder auf eine Karte zusammen. Mehr als drei gibt es nie.

**Bonusleiste.** Sie läuft dauernd aus und füllt sich, wenn du Karte auf Karte legst.
Volle Leiste heißt **doppelte Punkte**. Nachziehen lädt sie nicht auf.

**Verdeckte Karten.** Ab Runde 3 liegen die hinteren Karten manchmal wirklich verdeckt
und drehen sich erst um, wenn beide Karten davor weg sind. Ob eine Runde verdeckt
läuft, hängt am Seed – es gilt also **für alle am Tisch gleich** und wird zu den
späteren Runden hin immer wahrscheinlicher.

**Punkte**

| | |
|---|---|
| Karte legen | `10 × Streak × Bonusleiste`, Streak-Faktor gedeckelt bei 10 |
| Streak 5 / 10 | 2. bzw. 3. Ablagekarte offen |
| Turmspitze abgeräumt | +100 |
| Board komplett leer | +300 und +25 pro übriger Stapelkarte |

**Rundenende.** Ist der Stapel leer und passt nichts mehr, bist du **durch** – genau
wie wenn du das Board leergeräumt hast. Es wird nicht neu ausgeteilt; du siehst deinen
Stand und wartest, bis auch die anderen fertig sind. Sobald alle durch sind, kommt
sofort die Auswertung, spätestens nach **75 Sekunden**.

**Alle Spieler bekommen exakt dasselbe Blatt** – es entscheidet also nur, wer schneller
und cleverer räumt. Sobald alle „Bereit" drücken, geht es weiter. Nach der letzten
Runde gewinnt die höchste Gesamtpunktzahl, und das Ergebnis landet in der Bestenliste.

---

## Aufbau

```
shared/engine.js    Spiellogik – läuft identisch im Browser und auf dem Server
server/main.js      HTTP + WebSocket, statische Dateien
server/rooms.js     Räume, Rundenablauf, Zugvalidierung
server/leaderboard.js  Bestenliste als JSON-Datei
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
sudo mkdir -p /opt/magictowers
sudo chown $USER:$USER /opt/magictowers
rsync -av --exclude data/ ./ user@dein-server:/opt/magictowers/
```

### 3. Als Dienst einrichten

`/etc/systemd/system/magictowers.service`:

```ini
[Unit]
Description=Magic Towers
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/magictowers
Environment=PORT=8080
Environment=HOST=127.0.0.1
Environment=MT_DATA=/var/lib/magictowers/leaderboard.json
ExecStart=/usr/local/bin/deno run --allow-net --allow-read --allow-write --allow-env server/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/magictowers && sudo chown www-data /var/lib/magictowers
sudo systemctl daemon-reload
sudo systemctl enable --now magictowers
sudo journalctl -u magictowers -f
```

### 4. Nginx davor (WebSocket nicht vergessen!)

```nginx
server {
    listen 80;
    server_name spiel.deine-domain.de;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/magictowers /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d spiel.deine-domain.de
```

Ohne die drei `Upgrade`/`Connection`/`http_version`-Zeilen bricht die WebSocket-Verbindung
sofort ab und das Spiel hängt in der Lobby – das ist der Klassiker.

Danach den Link teilen: `https://spiel.deine-domain.de/?tisch=2` führt direkt an Tisch 2.

---

## Stellschrauben

Alles Wichtige steht oben in `shared/engine.js`:

```js
export const ROUND_MS = 75_000;     // Rundenlänge
export const ROUNDS = 10;           // Standard-Rundenzahl
export const DECK_SIZE = 16;        // Nachziehstapel
export const MAX_SLOTS = 3;         // so viele Ablagekarten maximal
export const BASE_SLOTS = 1;        // so viele ohne Kombi
export const SLOT_STREAK = [5, 10]; // ab welchem Streak die 2./3. aufgeht
export const FOG_FROM_ROUND = 3;    // ab wann verdeckt gespielt wird
export const BOOST = { ... };       // Bonusleiste
export const SCORE = { ... };       // Punktevergabe
```

Die vier Tische stehen oben in `server/rooms.js` (`TABLES`).

Änderungen dort gelten automatisch für Server und Client – neu laden reicht.
