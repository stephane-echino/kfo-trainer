// Achievements — unlocked from stats after a session. Purely motivational.
import { store } from './store.js';
import { dayStreak } from './fx.js';

const NS = 'kfo-trainer:achievements';

export const ACHIEVEMENTS = [
  {
    id: 'first-flight', icon: '🛫',
    en: { name: 'Wheels up', desc: 'Complete your first full flight' },
    fr: { name: 'Décollage', desc: 'Terminer ton premier vol complet' },
    test: (s) => s.flights >= 1,
  },
  {
    id: 'clean-flight', icon: '✨',
    en: { name: 'Clean sweep', desc: 'A full flight without a single miss' },
    fr: { name: 'Sans faute', desc: 'Un vol complet sans aucun raté' },
    test: (s, ses) => ses && ses.complete && ses.miss === 0 && ses.ok > 20,
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
    id: 'days-3', icon: '📅',
    en: { name: 'Building the habit', desc: 'Practise 3 days in a row' },
    fr: { name: 'L\'habitude', desc: 'S\'entraîner 3 jours d\'affilée' },
    test: (s) => dayStreak(s.days || {}) >= 3,
  },
  {
    id: 'days-7', icon: '🗓️',
    en: { name: 'A full week', desc: 'Practise 7 days in a row' },
    fr: { name: 'Une semaine pleine', desc: 'S\'entraîner 7 jours d\'affilée' },
    test: (s) => dayStreak(s.days || {}) >= 7,
  },
  {
    id: 'flights-10', icon: '🏅',
    en: { name: 'Ten circuits', desc: 'Complete 10 full flights' },
    fr: { name: 'Dix voltes', desc: 'Terminer 10 vols complets' },
    test: (s) => s.flights >= 10,
  },
  {
    id: 'xp-5000', icon: '💎',
    en: { name: 'Five thousand', desc: 'Reach 5000 XP' },
    fr: { name: 'Cinq mille', desc: 'Atteindre 5000 XP' },
    test: (s) => s.xp >= 5000,
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
export function checkUnlocks(session) {
  const stats = store.getStats();
  const have = unlocked();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let ok = false;
    try { ok = a.test(stats, session); } catch { ok = false; }
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
