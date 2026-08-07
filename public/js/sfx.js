// Sounds komplett synthetisch – keine Assets, kein Ladebalken.

let ctx = null;
let master = null;
export let muted = localStorage.getItem('cc-mute') === '1';

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() { try { ac(); } catch { /* noop */ } }

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('cc-mute', muted ? '1' : '0');
  return muted;
}

function tone({ f = 440, to = null, dur = 0.12, type = 'sine', vol = 0.5, delay = 0, slide = 0 }) {
  if (muted) return;
  try {
    const c = ac();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + (slide || dur));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch { /* Audio ist optional */ }
}

function noise({ dur = 0.08, vol = 0.3, delay = 0, hp = 1200 }) {
  if (muted) return;
  try {
    const c = ac();
    const t0 = c.currentTime + delay;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  } catch { /* noop */ }
}

// Die Tonhöhe steigt mit dem Streak – das treibt richtig an.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export const sfx = {
  place(streak = 1) {
    const step = SCALE[Math.min(streak - 1, SCALE.length - 1)];
    const f = 440 * 2 ** (step / 12);
    tone({ f, to: f * 1.5, dur: 0.11, type: 'triangle', vol: 0.4, slide: 0.05 });
    noise({ dur: 0.05, vol: 0.12, hp: 2600 });
  },
  draw() {
    noise({ dur: 0.12, vol: 0.22, hp: 900 });
    tone({ f: 260, to: 180, dur: 0.14, type: 'sine', vol: 0.22 });
  },
  bad() {
    tone({ f: 180, to: 120, dur: 0.16, type: 'sawtooth', vol: 0.2 });
  },
  peak() {
    [0, 4, 7, 12].forEach((s, i) => tone({ f: 523 * 2 ** (s / 12), dur: 0.22, type: 'triangle', vol: 0.32, delay: i * 0.06 }));
  },
  clear() {
    [0, 4, 7, 12, 16, 19].forEach((s, i) =>
      tone({ f: 392 * 2 ** (s / 12), dur: 0.4, type: 'square', vol: 0.2, delay: i * 0.07 }));
    noise({ dur: 0.5, vol: 0.16, hp: 500, delay: 0.05 });
  },
  unlock() {
    tone({ f: 880, to: 1760, dur: 0.2, type: 'sine', vol: 0.3, slide: 0.18 });
  },
  tick(n) {
    tone({ f: n === 0 ? 880 : 440, dur: 0.1, type: 'square', vol: 0.3 });
  },
  go() {
    tone({ f: 660, to: 1320, dur: 0.35, type: 'sawtooth', vol: 0.3, slide: 0.25 });
  },
  end() {
    [12, 7, 4, 0].forEach((s, i) => tone({ f: 523 * 2 ** (s / 12), dur: 0.3, type: 'triangle', vol: 0.28, delay: i * 0.1 }));
  },
  win() {
    [0, 4, 7, 12, 7, 12, 16].forEach((s, i) =>
      tone({ f: 523 * 2 ** (s / 12), dur: 0.35, type: 'square', vol: 0.22, delay: i * 0.11 }));
  },
  join() { tone({ f: 660, to: 990, dur: 0.14, type: 'sine', vol: 0.25, slide: 0.1 }); },
  warn() { tone({ f: 330, dur: 0.09, type: 'square', vol: 0.28 }); },
};
