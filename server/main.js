// Card Chaos – HTTP + WebSocket Server (Deno, ohne Abhängigkeiten).

import * as R from './rooms.js';
import * as LB from './leaderboard.js';
import {
  absender,
  darfRaumOeffnen,
  darfVerbinden,
  raumVermerkt,
  verbindungAuf,
  verbindungZu,
} from './bremse.js';

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const HOST = Deno.env.get('HOST') ?? '0.0.0.0';
const ROOT = new URL('../', import.meta.url).pathname;

await LB.load();

// ------------------------------------------------------------ Statische Dateien

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveFile(pathname) {
  // Nur public/ und shared/ sind erreichbar.
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const isShared = rel.startsWith('/shared/');
  const file = isShared ? ROOT + rel.slice(1) : ROOT + 'public' + rel;
  const safe = file.replace(/\/+/g, '/');
  if (safe.includes('..')) return new Response('Nope', { status: 403 });

  try {
    const data = await Deno.readFile(safe);
    const ext = safe.slice(safe.lastIndexOf('.'));
    return new Response(data, {
      headers: {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
      },
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- WebSocket

let nextConn = 1;
const clients = new Set();

function handleSocket(socket, ip) {
  /** @type {any} */
  const client = { id: null, name: 'Gast', socket, room: null, conn: nextConn++, ip };

  // Erst zaehlen, wenn die Verbindung wirklich steht, und genau einmal wieder
  // freigeben - sonst sperrt sich die IP mit der Zeit selbst aus.
  let gezaehlt = false;

  socket.onopen = () => {
    gezaehlt = true;
    verbindungAuf(ip);
    clients.add(client);
    R.send(client, 'welcome', { serverTime: Date.now() });
  };

  socket.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    try { route(client, msg); } catch (err) { console.error('Fehler bei', msg?.t, err); }
  };

  const close = () => {
    if (gezaehlt) { gezaehlt = false; verbindungZu(ip); }
    clients.delete(client);
    R.markOffline(client);
  };
  socket.onclose = close;
  socket.onerror = close;
}

/** Einmal anlegen, nicht bei jedem Namen neu - das Ding ist teuer. */
const ZEICHEN = new Intl.Segmenter('de', { granularity: 'grapheme' });

/**
 * Namen entschaerfen: Steuerzeichen raus, dann auf sechzehn *Zeichen*
 * kuerzen - nicht auf sechzehn UTF-16-Einheiten. Ein Emoji besteht aus
 * zweien, `slice(0, 16)` schnitt es mittendurch und liess ein
 * Ersatzzeichen stehen. Zweite Grenze bei 64 Einheiten gegen gestapelte
 * Kombinationszeichen, abgebrochen wird zwischen zwei Zeichen.
 * Gleiche Fassung wie `cleanName` in gemeinsam/raum.js, nur mit der
 * hier ueblichen Laenge.
 */
function sauberName(roh, ersatz) {
  const s = String(roh ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  let kurz = '';
  for (const z of [...ZEICHEN.segment(s)].slice(0, 16)) {
    if (kurz.length + z.segment.length > 64) break;
    kurz += z.segment;
  }
  return kurz || ersatz;
}

/**
 * Ausweise fuer die dauerhafte Spieler-Id.
 *
 * Die `pid` kommt vom Client und wird ueber `hello` behauptet - sie ist die
 * Identitaet, an der `resume()` den alten Platz wiederfindet. Sie steht aber
 * zugleich in jedem Tischzustand bei **allen** Mitspielern drin. Wer nur die
 * pid prueft, laesst deshalb jeden am Tisch die Identitaet eines anderen
 * uebernehmen und sich auf dessen Platz setzen.
 *
 * Also wie in gemeinsam/raum.js: die pid bleibt oeffentlich, dazu kommt ein
 * geheimer Ausweis, den nur der Eigentuemer bekommt. Wer eine pid ohne
 * passenden Ausweis behauptet, bekommt eine neue Id statt des fremden Platzes.
 */
const ausweise = new Map();   // pid -> { token, zuletzt }

function ausweisen(pid, token) {
  const gewuenscht = /^[a-z0-9_-]{6,40}$/i.test(String(pid ?? '')) ? String(pid) : null;
  const bekannt = gewuenscht ? ausweise.get(gewuenscht) : null;
  const frisch = () => {
    const id = crypto.randomUUID();
    const eintrag = { token: crypto.randomUUID(), zuletzt: Date.now() };
    ausweise.set(id, eintrag);
    return { id, token: eintrag.token };
  };
  if (!gewuenscht) return frisch();
  if (bekannt && bekannt.token !== String(token ?? '')) return frisch();
  const eintrag = bekannt ?? { token: crypto.randomUUID(), zuletzt: 0 };
  eintrag.zuletzt = Date.now();
  ausweise.set(gewuenscht, eintrag);
  return { id: gewuenscht, token: eintrag.token };
}

// Ohne das waechst die Karte endlos - sie soll einen Nachmittag ueberdauern,
// nicht die Laufzeit des Dienstes.
setInterval(() => {
  const grenze = Date.now() - 12 * 60 * 60 * 1000;
  for (const [pid, e] of ausweise) if (e.zuletzt < grenze) ausweise.delete(pid);
}, 60 * 60 * 1000);

function route(client, msg) {
  switch (msg.t) {
    case 'hello': {
      client.name = sauberName(msg.name, `Gast${client.conn}`);
      const ausweis = ausweisen(msg.pid, msg.token);
      client.id = ausweis.id;
      client.token = ausweis.token;
      R.send(client, 'hello', { id: client.id, name: client.name, token: client.token });
      // Reload mitten in der Partie? Dann direkt zurück an den Tisch.
      if (!R.resume(client)) R.renamed(client);
      break;
    }
    case 'rename':
      client.name = sauberName(msg.name, client.name);
      R.send(client, 'hello', { id: client.id, name: client.name, token: client.token });
      R.renamed(client);
      break;

    case 'watchLobby': R.watchLobby(client); break;
    case 'unwatchLobby': R.unwatchLobby(client); break;

    case 'createRoom': {
      if (!darfRaumOeffnen(client.ip)) {
        R.send(client, 'error', { msg: 'Zu viele Tische in kurzer Zeit. Warte kurz.' });
        break;
      }
      raumVermerkt(client.ip);
      R.createRoom(client, msg.isPublic !== false);
      break;
    }
    case 'joinRoom': R.joinRoom(client, msg.code); break;
    case 'visibility': R.setVisibility(client, !!msg.isPublic); break;
    case 'leaveRoom': R.leaveRoom(client); R.watchLobby(client); break;

    case 'ready': R.setReady(client, msg.value); break;
    case 'rounds': R.setRounds(client, msg.value); break;
    case 'start': R.hostStart(client); break;
    case 'move': R.move(client, msg); break;
    case 'risk': R.risk(client, !!msg.go); break;

    case 'leaderboard':
      R.send(client, 'leaderboard', LB.tafeln());
      break;

    case 'ping': R.send(client, 'pong', { c: msg.c, serverTime: Date.now() }); break;
  }
}

// -------------------------------------------------------------------- Server

Deno.serve({ port: PORT, hostname: HOST, onListen: ({ hostname, port }) => {
  console.log(`\n  🃏  Card Chaos läuft auf http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}\n`);
} }, async (req, info) => {
  const url = new URL(req.url);

  if (url.pathname === '/ws') {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket erwartet', { status: 400 });
    }
    const ip = absender(req, info);
    if (!darfVerbinden(ip)) {
      // 429 statt stiller Ablehnung: der Client soll den Unterschied zwischen
      // "Server kaputt" und "du warst zu schnell" sehen koennen.
      return new Response('Zu viele Verbindungen', { status: 429 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleSocket(socket, ip);
    return response;
  }

  if (url.pathname === '/api/leaderboard') {
    return Response.json(LB.tafeln());
  }

  if (url.pathname === '/api/health') {
    return Response.json({ ok: true, clients: clients.size, rooms: R.lobbyList().length });
  }

  const file = await serveFile(url.pathname);
  if (file) return file;

  // Alles Unbekannte auf die App – die Navigation läuft clientseitig.
  return (await serveFile('/index.html')) ?? new Response('Not found', { status: 404 });
});
