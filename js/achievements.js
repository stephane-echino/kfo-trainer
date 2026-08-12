// Achievements — unlocked from stats after a session. Purely motivational, and
// deliberately tied to real mastery (readiness, Leitner boxes, vital actions)
// rather than to time spent, so they cannot be farmed by tapping.
import { store } from './store.js';
import { dayStreak } from './fx.js';

const NS = 'kfo-trainer:achievements';

// test(stats, session, ctx) — ctx carries facts the store alone cannot answer:
//   { readiness, vitalSolid, vitalTotal, bestMemoryTime, examPerfect }
export const ACHIEVEMENTS = [
  {
    id: 'first-flight', icon: '🛫',
    en: { name: 'Wheels up', desc: 'Complete your first full flight' },
    fr: { name: 'Décollage', desc: 'Terminer ton premier vol complet' },
    test: (s) => s.flights >= 1,
  },
  {
    id: 'ready-25', icon: '🧭',
    en: { name: 'Finding your way', desc: 'Reach 25% ready for the flight' },
    fr: { name: 'Tu trouves tes marques', desc: 'Atteindre 25 % de préparation au vol' },
    test: (s, ses, c) => (c?.readiness ?? 0) >= 25,
  },
  {
    id: 'ready-60', icon: '⭐',
    en: { name: 'Ahead of the aircraft', desc: 'Reach 60% ready for the flight' },
    fr: { name: 'Devant l\'avion', desc: 'Atteindre 60 % de préparation au vol' },
    test: (s, ses, c) => (c?.readiness ?? 0) >= 60,
  },
  {
    id: 'ready-90', icon: '🏆',
    en: { name: 'Checked out', desc: 'Reach 90% ready for the flight — this course is in your memory, not on the page' },
    fr: { name: 'Lâché', desc: 'Atteindre 90 % de préparation — ce cours est dans ta mémoire, plus sur la feuille' },
    test: (s, ses, c) => (c?.readiness ?? 0) >= 90,
  },
  {
    id: 'vital-solid', icon: '⚠️',
    en: { name: 'Hands know it', desc: 'Every vital action survived four days or more between reviews' },
    fr: { name: 'Les mains savent', desc: 'Toutes les actions vitales tenues 4 jours ou plus entre deux révisions' },
    test: (s, ses, c) => !!c?.vitalTotal && c.vitalSolid >= c.vitalTotal,
  },
  {
    id: 'exam-perfect', icon: '🎓',
    en: { name: 'Examiner impressed', desc: 'Answer all ten examiner questions correctly' },
    fr: { name: 'Examinateur convaincu', desc: 'Répondre juste aux dix questions de l\'examinateur' },
    test: (s, ses, c) => !!c?.examPerfect,
  },
  {
    id: 'streak-25', icon: '🔥',
    en: { name: 'On a roll', desc: '25 correct answers in a row' },
    fr: { name: 'En série', desc: '25 bonnes réponses d\'affilée' },
    test: (s) => s.best >= 25,
  },
  {
    id: 'streak-100', icon: '🚀',
    en: { name: 'Unshakeable', desc: '100 correct answers in a row' },
    fr: { name: 'Imperturbable', desc: '100 bonnes réponses d\'affilée' },
    test: (s) => s.best >= 100,
  },
  {
    id: 'days-7', icon: '📅',
    en: { name: 'A full week', desc: 'Practise 7 days in a row' },
    fr: { name: 'Une semaine pleine', desc: 'S\'entraîner 7 jours d\'affilée' },
    test: (s) => dayStreak(s.days || {}) >= 7,
  },
  {
    id: 'days-30', icon: '🗓️',
    en: { name: 'A month of it', desc: 'Practise 30 days in a row' },
    fr: { name: 'Un mois entier', desc: 'S\'entraîner 30 jours d\'affilée' },
    test: (s) => dayStreak(s.days || {}) >= 30,
  },
  {
    id: 'flights-10', icon: '🔁',
    en: { name: 'Ten circuits', desc: 'Complete 10 full flights' },
    fr: { name: 'Dix voltes', desc: 'Terminer 10 vols complets' },
    test: (s) => s.flights >= 10,
  },
  {
    id: 'quick-hands', icon: '⏱️',
    en: { name: 'Quick hands', desc: 'Run the vital actions in under a minute' },
    fr: { name: 'Mains rapides', desc: 'Dérouler les actions vitales en moins d\'une minute' },
    test: (s, ses, c) => !!c?.bestMemoryTime && c.bestMemoryTime < 60000,
  },
];

export function unlocked() {
  try {
    return JSON.parse(localStorage.getItem(NS) || '{}');
  } catch {
    return {};
  }
}

// Returns the achievements newly unlocked by this session.
export function checkUnlocks(session, ctx) {
  const stats = store.getStats();
  const have = unlocked();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let ok = false;
    try { ok = a.test(stats, session, ctx); } catch { ok = false; }
    if (ok) { have[a.id] = Date.now(); fresh.push(a); }
  }
  if (fresh.length) {
    try { localStorage.setItem(NS, JSON.stringify(have)); } catch { /* storage full */ }
  }
  return fresh;
}

export function resetAchievements() {
  try { localStorage.removeItem(NS); } catch { /* noop */ }
}
