// Persistence — localStorage wrapper with namespacing.
const NS = 'kfo-trainer';

function defaultLang() {
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// Progress is per course (circuit, emergencies…) so switching content does not
// mix up positions, misses or per-phase accuracy. Settings and stats stay global.
let scope = 'circuit';
const scoped = (key) => (scope === 'circuit' ? key : `${scope}:${key}`);

// Days before a step comes back, per Leitner box. Box 0 means "again today".
const SR_INTERVALS = [0, 1, 2, 4, 8, 16];

function addDays(iso, days) {
  if (!days) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

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
  // Only the misses. The Leitner schedule is the memory model built over weeks
  // and has its own reset — wiping it here would silently undo all of it.
  resetMisses() { write(scoped('misses'), {}); },

  // ---------- spaced repetition (Leitner boxes) ----------
  // { [stepKey]: { box: 0..5, due: 'YYYY-MM-DD' } }
  // A step answered correctly comes back later and later; a missed step drops
  // to box 0 and is due again the same day. Steps never answered have no entry
  // and are covered by the full flight instead.
  getSched() { return read(scoped('sched'), {}); },

  // maxBox caps how far a step can climb. Vital actions stop at box 4 (16 days)
  // so they keep coming back — they are the ones you cannot look up in flight.
  recordAnswer(stepKey, ok, todayIso, maxBox = SR_INTERVALS.length - 1, opts = {}) {
    const sched = store.getSched();
    const cur = sched[stepKey] || { box: 0, due: todayIso };
    // Only a step that is actually due earns a promotion. Answering the same
    // step again before it is due — review this morning, full flight tonight,
    // or a phase drill run five times — proves nothing about retention and must
    // not skip rungs of the ladder. A miss always demotes: forgetting is signal
    // whenever it happens.
    if (ok && cur.due > todayIso) return cur;
    // An answer found with a clue in hand does not predict free recall in the
    // aircraft. Hold the box and keep it due today rather than promoting it —
    // due tomorrow would freeze the item for the day.
    if (ok && opts.cued) {
      sched[stepKey] = { box: cur.box, due: todayIso };
      write(scoped('sched'), sched);
      return sched[stepKey];
    }
    const box = ok ? Math.min(cur.box + 1, maxBox) : 0;
    sched[stepKey] = { box, due: addDays(todayIso, SR_INTERVALS[box]) };
    write(scoped('sched'), sched);
    return sched[stepKey];
  },

  // keys due on or before `todayIso`
  dueKeys(todayIso) {
    const sched = store.getSched();
    return Object.keys(sched).filter(k => sched[k].due <= todayIso);
  },

  resetSched() { write(scoped('sched'), {}); },

  // Step keys are `${phase.id}/${blockIndex}/${itemIndex}` — derived from
  // position. Editing a module would hand one item's boxes to another, and the
  // app would certify mastery on the wrong line. Stamp the content version and
  // start the schedule over when it moves.
  syncContentVersion(version) {
    const key = scoped('contentVersion');
    const seen = read(key, null);
    if (seen === version) return false;
    // stamps used to carry the module file id ("circuit-fr@…"); the same content
    // under another name must not count as a content change
    if (seen && seen.replace(/-(fr|en)@/, '@') === version) { write(key, version); return false; }
    if (seen !== null) {
      write(scoped('sched'), {});
      write(scoped('misses'), {});
      write(scoped('phaseStats'), {});
    }
    write(key, version);
    return seen !== null;
  },

  // best time on a timed drill, in ms, per course
  getBestTime(seq) { return read(scoped(`best:${seq}`), null); },
  recordTime(seq, ms) {
    const cur = store.getBestTime(seq);
    if (cur === null || ms < cur) { write(scoped(`best:${seq}`), ms); return { best: true, ms };  }
    return { best: false, ms: cur };
  },

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
      voice: false, wakelock: true, haptics: true, speak: false, lang: defaultLang(),
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
