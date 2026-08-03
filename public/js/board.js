// Rendering des Spieltischs: Pyramiden, Ablage, Nachziehstapel, Effekte.

import * as E from '../shared/engine.js';
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
const elM = { streak: $('#m-streak'), boost: $('#m-boost'), tower: $('#m-tower'), total: $('#m-total') };

let nodes = [];        // 28 DOM-Wrapper, passend zum LAYOUT
let faces = [];        // wie die Karte zuletzt gezeigt wurde: true = verdeckt
let built = false;
let onPlay = () => {};

// Der Punktestand zählt hoch statt zu springen – das ist die halbe Miete.
let shownScore = 0;
let targetScore = 0;

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

export function bindPlay(fn) { onPlay = fn; }

// ── Kartenbau ──────────────────────────────────────────────────────────────

function cardEl(card, faceDown = false, gold = false) {
  const d = document.createElement('div');
  if (faceDown || card == null) { d.className = 'card back' + (gold ? ' gold-back' : ''); return d; }
  d.className = 'card' + (E.isRed(card) ? ' red' : '') + (gold ? ' gold' : '');
  const s = E.SUITS[E.suitOf(card)];
  d.innerHTML =
    `<div class="r">${E.RANKS[E.rankOf(card)]}</div>` +
    `<div class="big">${gold ? '★' : s}</div>` +
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
    w.appendChild(cardEl(st.board[i], faces[i], E.isGold(st, i)));
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
      w.replaceChildren(cardEl(st.board[i], hidden, E.isGold(st, i)));
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

  if (st.score !== targetScore) {
    targetScore = st.score;
    elScore.classList.remove('bump');
    void elScore.offsetWidth;
    elScore.classList.add('bump');
  }
}

/** Jeden Frame: Punkte hochzählen, Multiplikatoren und Bonusleiste nachziehen. */
export function renderLive(st, t) {
  // Punktestand läuft dem Ziel hinterher – bei großen Sprüngen sichtbar lange.
  if (shownScore !== targetScore) {
    const d = targetScore - shownScore;
    shownScore = Math.abs(d) < 1 ? targetScore : shownScore + d * 0.18;
    elScore.textContent = fmt(shownScore);
  }

  const m = st && !st.over ? E.mults(st, t) : { streak: 1, boost: 1, tower: 1, total: 1 };
  elM.streak.textContent = `×${m.streak}`;
  elM.boost.textContent = `×${m.boost.toFixed(1)}`;
  elM.tower.textContent = `×${m.tower}`;
  elM.total.textContent = `×${Math.round(m.total)}`;
  elM.total.classList.toggle('big', m.total >= 20);
  elM.streak.classList.toggle('on', m.streak > 1);
  elM.boost.classList.toggle('on', m.boost > 1.05);
  elM.tower.classList.toggle('on', m.tower > 1);

  renderBoost(st, t);
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
function renderBoost(st, t) {
  const b = st && !st.over ? E.boostAt(st, t) : 0;
  elBoostFill.style.width = `${(b * 100).toFixed(1)}%`;
  elBoost.classList.toggle('hot', b >= 0.5);
  elBoost.classList.toggle('max', b >= 0.995);
  elBoostLbl.textContent = `Bonus ×${(1 + b * E.BOOST.maxMult).toFixed(1)}`;
}

export function resetView() {
  built = false;
  prevTop = null;
  prevUnlocked = 0;
  shownScore = 0;
  targetScore = 0;
  nodes = [];
  faces = [];
  elPeaks.innerHTML = '';
  elScore.textContent = '0';
  elBoostFill.style.width = '0%';
  elBoost.classList.remove('hot', 'max');
}

/** Nach einem Risiko-Wurf: Punktestand neu anpeilen, ohne den Rest zu rühren. */
export function setScore(score) {
  targetScore = score;
  elScore.classList.remove('bump');
  void elScore.offsetWidth;
  elScore.classList.add('bump');
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
    popAt(ev.index, `+${fmt(ev.gain)}`, ev.gold ? '#ffd447' : ev.mults?.total >= 15 ? '#ff2e88' : null);
    if (ev.gold) { sfx.peak(); banner(`GOLDKARTE! ×${E.SCORE.goldMult}`); coins(); }
    else if (ev.streak > 0 && ev.streak % 5 === 0) banner(`COMBO ×${Math.min(ev.mult, 10)}`);
    if (ev.peaks?.length) { sfx.peak(); banner(`TURM FREI! +${fmt(E.SCORE.peak)}`); }
    if (ev.unlocked) { sfx.unlock(); banner(`${ev.unlocked}. KARTE FREI!`); }
    // Ein Treffer über einer halben Million ist einen eigenen Auftritt wert.
    if (ev.gain >= 500_000 && !ev.gold) banner('MEGA WIN!');
  } else if (ev.type === 'draw') {
    sfx.draw();
  }
  if (ev.boardClear) { sfx.clear(); banner('BOARD LEER! 🔥'); coins(); }
  else if (ev.finished === 'stuck') { sfx.bad(); banner('DURCH'); }
}

/** Münzregen – reine Angeberei, aber genau darum geht es hier. */
export function coins() {
  for (let i = 0; i < 26; i++) {
    const c = document.createElement('div');
    c.className = 'coin';
    c.textContent = '🪙';
    c.style.left = `${10 + Math.random() * 80}vw`;
    c.style.animationDelay = `${Math.random() * 0.35}s`;
    c.style.fontSize = `${18 + Math.random() * 18}px`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2200);
  }
}
