// Rendering des Spieltischs: Pyramiden, Ablage, Nachziehstapel, Effekte.

import * as E from '/shared/engine.js';
import { sfx } from './sfx.js';

const $ = (s) => document.querySelector(s);

const elPeaks = $('#peaks');
const elFx = $('#fx');
const elSlots = $('#slots');
const elDeck = $('#deck');
const elDeckCount = $('#deck-count');
const elStreak = $('#streak');
const elStreakHint = $('#streak-hint');
const elSlotHint = $('#slot-hint');
const elScore = $('#hud-score');
const elBoost = $('#boost');
const elBoostFill = $('#boost-fill');
const elBoostLbl = $('#boost-lbl');

let nodes = [];        // 28 DOM-Wrapper, passend zum LAYOUT
let faces = [];        // wie die Karte zuletzt gezeigt wurde: true = verdeckt
let built = false;
let lastScore = 0;
let onPlay = () => {};

export function bindPlay(fn) { onPlay = fn; }

// ── Kartenbau ──────────────────────────────────────────────────────────────

function cardEl(card, faceDown = false) {
  const d = document.createElement('div');
  if (faceDown || card == null) { d.className = 'card back'; return d; }
  d.className = 'card' + (E.isRed(card) ? ' red' : '');
  const s = E.SUITS[E.suitOf(card)];
  d.innerHTML =
    `<div class="r">${E.RANKS[E.rankOf(card)]}</div>` +
    `<div class="big">${s}</div>` +
    `<div class="s">${s}</div>`;
  return d;
}

function buildBoard(st) {
  elPeaks.innerHTML = '';
  faces = [];
  nodes = E.LAYOUT.map((n, i) => {
    const w = document.createElement('div');
    w.className = 'slot';
    w.style.left = `calc(var(--card-w) * ${n.x / 2})`;
    w.style.top = `calc(var(--card-h) * ${n.row * 0.42})`;
    w.style.zIndex = String(n.row + 1);
    faces[i] = E.isHidden(st, i);
    w.appendChild(cardEl(st.board[i], faces[i]));
    w.addEventListener('click', () => onPlay(i));
    elPeaks.appendChild(w);
    return w;
  });
  built = true;
}

// ── Haupt-Render ───────────────────────────────────────────────────────────

export function render(st) {
  if (!built || nodes.length === 0) buildBoard(st);

  for (let i = 0; i < E.BOARD_SIZE; i++) {
    const w = nodes[i];
    const taken = st.taken[i];
    const open = !taken && E.LAYOUT[i].covers.every((c) => st.taken[c]);
    const hidden = E.isHidden(st, i);

    // Frei geräumt und vorher verdeckt? Dann jetzt umdrehen.
    if (faces[i] !== hidden) {
      faces[i] = hidden;
      w.replaceChildren(cardEl(st.board[i], hidden));
      if (!hidden && !taken) {
        w.classList.remove('flip');
        void w.offsetWidth;
        w.classList.add('flip');
      }
    }

    w.classList.toggle('hidden', taken);
    w.classList.toggle('covered', !open && !taken);
    // Bewusst nur „frei", nicht „legbar": die Oberfläche verrät die Züge nicht.
    w.classList.toggle('open', open);
  }

  renderSlots(st);

  const left = st.deck.length - st.deckPos;
  elDeckCount.textContent = String(left);
  elDeck.classList.toggle('empty', left === 0);

  elStreak.firstElementChild.textContent = String(st.streak);
  elStreak.classList.toggle('hot', st.streak >= E.SLOT_STREAK[0] && st.streak < E.SLOT_STREAK[1]);
  elStreak.classList.toggle('fire', st.streak >= E.SLOT_STREAK[1]);

  const next = E.SLOT_STREAK.find((s) => st.streak < s);
  elStreakHint.textContent = next
    ? `noch ${next - st.streak} für die ${st.unlocked + 1}. Ablage`
    : 'alle Ablagen offen';
  elSlotHint.textContent = st.unlocked === 1 ? 'Ablage' : `${st.unlocked} Ablagen`;

  if (st.score !== lastScore) {
    elScore.textContent = st.score.toLocaleString('de-DE');
    elScore.classList.remove('bump');
    void elScore.offsetWidth;
    elScore.classList.add('bump');
    lastScore = st.score;
  }
}

let prevTop = null;
let prevUnlocked = 0;

/** Nur die freigeschalteten Ablagen zeigen – die anderen gibt es noch nicht. */
function renderSlots(st) {
  elSlots.innerHTML = '';
  for (let s = 0; s < st.unlocked; s++) {
    const card = st.slots[s];
    if (card == null) continue;

    const wrap = document.createElement('div');
    wrap.className = `slot-card s${s}` + (s > 0 ? ' dim' : '');
    wrap.appendChild(cardEl(card));
    if (s === 0 && card !== prevTop) wrap.classList.add('fresh');
    // Gerade durch eine Kombi dazugekommen? Dann fährt sie sichtbar rein.
    if (s > 0 && s >= prevUnlocked) wrap.classList.add('reveal');
    elSlots.appendChild(wrap);
  }
  prevTop = st.slots[0];
  prevUnlocked = st.unlocked;
}

/** Die Bonusleiste läuft in Echtzeit aus – daher jeden Frame frisch. */
export function renderBoost(st, t) {
  const b = st && !st.over ? E.boostAt(st, t) : 0;
  elBoostFill.style.width = `${(b * 100).toFixed(1)}%`;
  elBoost.classList.toggle('hot', b >= 0.5);
  elBoost.classList.toggle('max', b >= 0.995);
  elBoostLbl.textContent = `Bonus ×${(1 + b * E.BOOST.maxMult).toFixed(1)}`;
}

export function resetView() {
  built = false;
  lastScore = 0;
  prevTop = null;
  prevUnlocked = 0;
  nodes = [];
  faces = [];
  elPeaks.innerHTML = '';
  elScore.textContent = '0';
  elBoostFill.style.width = '0%';
  elBoost.classList.remove('hot', 'max');
}

// ── Effekte ────────────────────────────────────────────────────────────────

export function popAt(index, text, color) {
  const w = nodes[index];
  if (!w) return;
  const p = document.createElement('div');
  p.className = 'pop';
  p.textContent = text;
  if (color) p.style.color = color;
  p.style.left = `calc(var(--card-w) * ${E.LAYOUT[index].x / 2} + var(--card-w) / 2)`;
  p.style.top = `calc(var(--card-h) * ${E.LAYOUT[index].row * 0.42})`;
  elFx.appendChild(p);
  setTimeout(() => p.remove(), 1000);
}

export function banner(text) {
  const b = document.createElement('div');
  b.className = 'banner';
  b.innerHTML = `<b>${text}</b>`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 950);
}

export function shake() {
  elPeaks.classList.remove('shake');
  void elPeaks.offsetWidth;
  elPeaks.classList.add('shake');
}

/** Übersetzt ein Engine-Event in Sound + Bildschirmeffekte. */
export function celebrate(ev) {
  if (!ev) return;
  if (ev.type === 'play') {
    sfx.place(ev.streak);
    popAt(ev.index, `+${ev.gain}`, ev.boost >= 0.5 || ev.mult >= 5 ? '#ff2e88' : null);
    if (ev.streak > 0 && ev.streak % 5 === 0) banner(`COMBO ×${Math.min(ev.mult, 10)}`);
    if (ev.peaks?.length) { sfx.peak(); banner('TURM FREI! +100'); }
    if (ev.unlocked) { sfx.unlock(); banner(`${ev.unlocked}. KARTE FREI!`); }
  } else if (ev.type === 'draw') {
    sfx.draw();
  }
  if (ev.boardClear) { sfx.clear(); banner('BOARD LEER! 🔥'); }
  else if (ev.finished === 'stuck') { sfx.bad(); banner('DURCH'); }
}
