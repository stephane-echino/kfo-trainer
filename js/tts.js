// Reading answers aloud. Uses the platform voice, so it works offline on iOS
// once a voice is installed — useful for hearing a call-out said properly
// rather than only reading it.

const synth = window.speechSynthesis;

export const ttsSupported = !!synth;

let voices = [];
function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
}
if (synth) {
  loadVoices();
  synth.onvoiceschanged = loadVoices;
}

function pickVoice(lang) {
  if (!voices.length) loadVoices();
  const want = lang.slice(0, 2).toLowerCase();
  return voices.find(v => v.lang?.toLowerCase().replace('_', '-') === lang.toLowerCase())
    || voices.find(v => v.lang?.toLowerCase().startsWith(want))
    || null;
}

// Checklist shorthand reads badly out loud: expand what the eye fills in.
function speakable(text, lang) {
  let out = String(text || '')
    .replace(/^\d+\.\s*/, '')                 // the printed item number
    .replace(/\s*—\s*/g, ', ')                // challenge — response
    .replace(/\bRPM\b/g, lang.startsWith('fr') ? 'tours par minute' : 'R P M')
    .replace(/\bKIAS\b/g, lang.startsWith('fr') ? 'nœuds' : 'knots')
    .replace(/\bft\b/g, lang.startsWith('fr') ? 'pieds' : 'feet');
  if (lang.startsWith('fr')) {
    out = out.replace(/\b1er\b/g, 'premier').replace(/\b2me\b/g, 'deuxième');
  }
  return out;
}

export function speak(text, lang = 'en-US', onEnd = null) {
  if (!synth || !text) { onEnd?.(); return; }
  try {
    synth.cancel();                            // never queue up a backlog
    const u = new SpeechSynthesisUtterance(speakable(text, lang));
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.rate = 0.95;
    if (onEnd) {
      let done = false;
      const finish = () => { if (!done) { done = true; onEnd(); } };
      u.onend = finish;
      u.onerror = finish;
      // iOS sometimes never fires onend; fall back on a length-based estimate
      const estimate = Math.min(30000, 1200 + speakable(text, lang).length * 70);
      setTimeout(finish, estimate);
    }
    synth.speak(u);
  } catch {
    onEnd?.();                                 // speech is a bonus, never a blocker
  }
}

export function stopSpeaking() {
  try { synth?.cancel(); } catch { /* nothing to stop */ }
}
