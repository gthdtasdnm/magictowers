// WebSocket-Verbindung mit automatischem Reconnect und Uhr-Abgleich zum Server.

const handlers = new Map();
let ws = null;
let tries = 0;
let offset = 0;      // serverTime - clientTime
let onStatus = () => {};

export const now = () => Date.now() + offset;

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(fn);
}

function emit(type, msg) {
  for (const fn of handlers.get(type) ?? []) fn(msg);
  for (const fn of handlers.get('*') ?? []) fn(type, msg);
}

// `t` ist der Nachrichtentyp – er wird zuletzt gesetzt, damit ein gleichnamiges
// Feld in `data` ihn nicht aus Versehen überschreibt.
export function send(t, data = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...data, t }));
}

export function status(fn) { onStatus = fn; }

/**
 * Basispfad der Seite, z. B. `/` oder `/cardchaos/`. Damit läuft die App auch
 * in einem Unterordner hinter einem Reverse Proxy, ohne dass irgendwo ein
 * fester Pfad einkompiliert wäre.
 */
export const base = location.pathname.replace(/[^/]*$/, '');

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${base}ws`);

  ws.onopen = () => { tries = 0; onStatus('open'); syncClock(); emit('open', {}); };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'pong') return gotPong(msg);
    emit(msg.t, msg);
  };
  ws.onclose = () => {
    onStatus('closed');
    const delay = Math.min(8000, 400 * 2 ** tries++);
    setTimeout(connect, delay);
  };
  ws.onerror = () => ws.close();
}

// ── Uhrzeit angleichen, damit der Rundentimer überall gleich läuft ──────────
const pending = new Map();
let samples = [];

function syncClock() {
  samples = [];
  for (let i = 0; i < 5; i++) setTimeout(() => ping(), i * 120);
  setInterval(() => ping(), 20_000);
}

function ping() {
  const c = Math.random().toString(36).slice(2);
  pending.set(c, performance.now() + performance.timeOrigin);
  send('ping', { c });
}

function gotPong(msg) {
  const sent = pending.get(msg.c);
  pending.delete(msg.c);
  if (!sent) return;
  const recv = performance.now() + performance.timeOrigin;
  const rtt = recv - sent;
  samples.push({ off: msg.serverTime + rtt / 2 - recv, rtt });
  samples.sort((a, b) => a.rtt - b.rtt);
  if (samples.length > 8) samples.length = 8;
  offset = samples[0].off;   // die schnellste Probe ist die genaueste
}
