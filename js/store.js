// Persistence — localStorage wrapper with namespacing.
const NS = 'kfo-trainer';

function defaultLang() {
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// Progress is per course (circuit, emergencies…) so switching content does not
// mix up positions, misses or per-phase accuracy. Settings and stats stay global.
let scope = 'circuit';
const scoped = (key) => (scope === 'circuit' ? key : `${scope}:${key}`);

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(`${NS}:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
  } catch {
    /* storage full or private mode — training still works, just not persisted */
  }
}

export const store = {
  setScope(courseId) { scope = courseId || 'circuit'; },

  // trainer position: { stepIndex } per sequence id ('flight' | 'review')
  getPosition(seq) { return read(scoped(`pos:${seq}`), 0); },
  setPosition(seq, i) { write(scoped(`pos:${seq}`), i); },

  // missed steps: { [stepKey]: count }
  getMisses() { return read(scoped('misses'), {}); },
  addMiss(stepKey) {
    const m = store.getMisses();
    m[stepKey] = (m[stepKey] || 0) + 1;
    write(scoped('misses'), m);
  },
  clearMiss(stepKey) {
    const m = store.getMisses();
    if (stepKey in m) { delete m[stepKey]; write(scoped('misses'), m); }
  },
  resetMisses() { write(scoped('misses'), {}); },

  // rolling accuracy per phase: { [phaseId]: {ok, miss} }
  getPhaseStats() { return read(scoped('phaseStats'), {}); },
  recordPhase(phaseId, ok) {
    const s = store.getPhaseStats();
    const p = s[phaseId] || { ok: 0, miss: 0 };
    p[ok ? 'ok' : 'miss'] += 1;
    s[phaseId] = p;
    write(scoped('phaseStats'), s);
  },
  resetPhaseStats() { write(scoped('phaseStats'), {}); },

  // per-phase completion: { [phaseId]: true }
  getPhaseDone() { return read(scoped('phasesDone'), {}); },
  setPhaseDone(phaseId) {
    const d = store.getPhaseDone();
    if (!d[phaseId]) { d[phaseId] = true; write(scoped('phasesDone'), d); }
  },
  resetPhaseDone() { write(scoped('phasesDone'), {}); },

  // settings
  getSettings() {
    const s = read('settings', {});
    return {
      voice: false, wakelock: true, haptics: true, lang: defaultLang(),
      // which content types take part in training
      incRadio: true, incNotes: true, incBriefings: true, incCallouts: true, incChecklists: true, incFlows: true,
      ...s,
    };
  },
  setSettings(s) { write('settings', s); },

  // ---------- progress / gamification ----------
  // { xp, best, streak, days: {'YYYY-MM-DD': n}, lastDay, flights, sessions }
  getStats() {
    return read('stats', { xp: 0, best: 0, streak: 0, days: {}, lastDay: null, flights: 0 });
  },
  setStats(s) { write('stats', s); },

  addXp(n) {
    const s = store.getStats();
    s.xp += n;
    write('stats', s);
    return s.xp;
  },

  // running streak of correct answers; returns the new streak
  bumpStreak(ok) {
    const s = store.getStats();
    s.streak = ok ? s.streak + 1 : 0;
    if (s.streak > s.best) s.best = s.streak;
    write('stats', s);
    return s.streak;
  },

  // marks today as practised; returns the day streak in days
  touchDay(todayIso) {
    const s = store.getStats();
    s.days[todayIso] = (s.days[todayIso] || 0) + 1;
    s.lastDay = todayIso;
    // trim history to the last 60 days so storage stays small
    const keys = Object.keys(s.days).sort();
    while (keys.length > 60) delete s.days[keys.shift()];
    write('stats', s);
    return s;
  },

  countFlight() {
    const s = store.getStats();
    s.flights += 1;
    write('stats', s);
    return s.flights;
  },

  resetStats() { write('stats', { xp: 0, best: 0, streak: 0, days: {}, lastDay: null, flights: 0 }); },
};
