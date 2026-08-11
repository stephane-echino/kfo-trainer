// Persistence — localStorage wrapper with namespacing.
const NS = 'kfo-trainer';

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
  // trainer position: { stepIndex } per sequence id ('flight' | 'review')
  getPosition(seq) { return read(`pos:${seq}`, 0); },
  setPosition(seq, i) { write(`pos:${seq}`, i); },

  // missed steps: { [stepKey]: count }
  getMisses() { return read('misses', {}); },
  addMiss(stepKey) {
    const m = store.getMisses();
    m[stepKey] = (m[stepKey] || 0) + 1;
    write('misses', m);
  },
  clearMiss(stepKey) {
    const m = store.getMisses();
    if (stepKey in m) { delete m[stepKey]; write('misses', m); }
  },
  resetMisses() { write('misses', {}); },

  // per-phase completion: { [phaseId]: true }
  getPhaseDone() { return read('phasesDone', {}); },
  setPhaseDone(phaseId) {
    const d = store.getPhaseDone();
    if (!d[phaseId]) { d[phaseId] = true; write('phasesDone', d); }
  },
  resetPhaseDone() { write('phasesDone', {}); },

  // settings
  getSettings() {
    return read('settings', { voice: false, wakelock: true, haptics: true });
  },
  setSettings(s) { write('settings', s); },
};
