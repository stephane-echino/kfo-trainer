// Small celebration and feedback effects. All purely cosmetic — never on a
// path that matters for training correctness.
import { store } from './store.js';

const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function haptic(pattern = 8) {
  if (store.getSettings().haptics && navigator.vibrate) navigator.vibrate(pattern);
}

const COLORS = ['#f8bd4a', '#4fd982', '#5fb0f7', '#c792ea', '#ffffff'];

// Confetti burst from the centre of an element (or the viewport centre).
export function burst(anchor, count = 26) {
  if (REDUCED) return;
  const rect = anchor?.getBoundingClientRect();
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

  const layer = document.createElement('div');
  layer.className = 'burst';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 70 + Math.random() * 130;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist + 40}px`);
    p.style.setProperty('--rot', `${Math.random() * 540 - 270}deg`);
    p.style.animationDelay = `${Math.random() * 0.12}s`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1200);
}

// Floating "+10 XP" style label near an element.
export function floatLabel(anchor, text, color) {
  color = color || '#4fd982';
  if (REDUCED || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top + 18}px`,
    transform: 'translateX(-50%)',
    color,
    font: '700 15px -apple-system, sans-serif',
    pointerEvents: 'none',
    zIndex: 60,
    transition: 'transform 0.85s cubic-bezier(0.22,1,0.36,1), opacity 0.85s',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'translateX(-50%) translateY(-46px)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 900);
}

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function todayIso() {
  return isoOf(new Date());
}

// Consecutive-day streak, counting back from today.
export function dayStreak(days) {
  const has = (d) => !!days[isoOf(d)];
  const cursor = new Date();
  if (!has(cursor)) cursor.setDate(cursor.getDate() - 1); // today not practised yet: still count yesterday's run
  let n = 0;
  while (has(cursor) && n < 400) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}
