// Chair-flying engine: say it out loud → tap to reveal → grade → next.
import { store } from './store.js';
import { renderCircuit, moveDot } from './circuit.js';
import { voiceSupported, createRecognizer, matchScore } from './voice.js';

const $ = (id) => document.getElementById(id);

export function createTrainer({ onExit }) {
  let steps = [];
  let seqId = 'flight';
  let index = 0;
  let revealed = false;
  let finished = false;
  let recognizer = null;
  let voiceOn = false;
  let lastHeard = '';

  const els = {};
  function bindEls() {
    Object.assign(els, {
      phaseTitle: $('trainer-phase-title'),
      context: $('trainer-context'),
      circuit: $('circuit-wrap'),
      progress: $('trainer-progress'),
      blockTitle: $('step-block-title'),
      card: $('step-card'),
      kind: $('step-kind'),
      prompt: $('step-prompt'),
      answer: $('step-answer'),
      note: $('step-note'),
      voiceFb: $('voice-feedback'),
      hint: $('step-hint'),
      btnPrev: $('btn-step-prev'),
      btnMiss: $('btn-step-miss'),
      btnOk: $('btn-step-ok'),
      btnBack: $('btn-trainer-back'),
      btnVoice: $('btn-voice-toggle'),
    });
  }

  function init() {
    bindEls();
    renderCircuit(els.circuit);
    els.card.addEventListener('click', onCardTap);
    els.btnPrev.addEventListener('click', prev);
    els.btnMiss.addEventListener('click', () => grade(false));
    els.btnOk.addEventListener('click', () => grade(true));
    els.btnBack.addEventListener('click', () => { stopVoice(); saveAndNotifyExit(); });
    els.btnVoice.addEventListener('click', toggleVoice);
    updateVoiceButton();
  }

  function saveAndNotifyExit() {
    store.setPosition(seqId, index);
    onExit();
  }

  // sequence: 'flight' (all steps) | 'review' (missed only) | 'phase:<id>'
  function start(allSteps, sequence) {
    seqId = sequence;
    if (sequence === 'review') {
      const misses = store.getMisses();
      steps = allSteps.filter(s => misses[s.key]);
      index = 0;
    } else if (sequence.startsWith('phase:')) {
      const pid = sequence.slice(6);
      steps = allSteps.filter(s => s.phase.id === pid);
      index = 0;
      seqId = 'flight-phase'; // phase jumps don't clobber full-flight position
    } else {
      steps = allSteps;
      index = Math.min(store.getPosition(seqId), Math.max(steps.length - 1, 0));
    }
    revealed = false;
    finished = false;
    render();
  }

  function get() { return steps[index]; }

  function render() {
    const s = get();
    if (!s) { renderEmpty(); return; }
    const phase = s.phase;

    els.phaseTitle.textContent = phase.title;
    els.context.innerHTML = (phase.context || [])
      .map(c => `<span>${c.k ? `${esc(c.k)} ` : ''}<b>${esc(c.v)}</b></span>`)
      .join('<span class="ctx-sep">·</span>');
    moveDot(els.circuit, phase.map);

    els.progress.style.width = `${(index / Math.max(steps.length - 1, 1)) * 100}%`;
    els.blockTitle.textContent = s.blockTitle;

    els.kind.textContent = kindLabel(s.kind);
    els.kind.className = `step-kind k-${s.kind}`;

    els.prompt.innerHTML =
      (s.promptPre ? `<span class="prompt-pre">${esc(s.promptPre)}</span>` : '') + esc(s.prompt);

    els.answer.classList.add('hidden');
    els.note.classList.add('hidden');
    els.voiceFb.classList.add('hidden');
    els.answer.classList.toggle('long', !!s.answerLong);
    els.answer.textContent = s.answer;
    if (s.note) els.note.textContent = s.note;

    revealed = false;
    lastHeard = '';
    els.hint.textContent = s.kind === 'note'
      ? 'tap to read'
      : (voiceOn ? 'say it out loud — I\'m listening · or tap to reveal' : 'say it out loud · tap to reveal');
    setActionState();

    if (voiceOn && s.sayTarget && recognizer) recognizer.start();
  }

  function renderEmpty() {
    els.phaseTitle.textContent = 'Nothing to review';
    els.context.textContent = '';
    els.blockTitle.textContent = '';
    els.kind.className = 'step-kind';
    els.kind.textContent = '';
    els.prompt.textContent = 'No missed steps — nice work. Fly the full flight to collect new ones.';
    els.answer.classList.add('hidden');
    els.note.classList.add('hidden');
    els.voiceFb.classList.add('hidden');
    els.hint.textContent = 'tap ← to go back';
    els.btnPrev.disabled = true;
    els.btnMiss.disabled = true;
    els.btnOk.disabled = true;
  }

  function setActionState() {
    els.btnPrev.disabled = index === 0;
    const s = get();
    const gradable = revealed && s && s.graded;
    els.btnMiss.disabled = !gradable;
    els.btnOk.disabled = !gradable;
  }

  function onCardTap() {
    if (finished || !get()) return;
    if (!revealed) reveal();
    else advance(true); // tap after reveal = implicit "got it"
  }

  function reveal() {
    const s = get();
    revealed = true;
    els.answer.classList.remove('hidden');
    if (s.note) els.note.classList.remove('hidden');
    els.hint.textContent = s.graded ? 'tap = got it · or grade below' : 'tap for next';
    stopVoice(false);
    haptic();
    setActionState();
  }

  function grade(ok) {
    const s = get();
    if (!s || !revealed) return;
    if (ok) store.clearMiss(s.key); else store.addMiss(s.key);
    advance(ok);
  }

  function advance() {
    const s = get();
    if (!s) return;
    if (!revealed) { reveal(); return; }
    const prevPhase = s.phase.id;
    const marksPhases = seqId === 'flight' || seqId === 'flight-phase';
    if (index >= steps.length - 1) {
      if (marksPhases) store.setPhaseDone(prevPhase);
      finish();
      return;
    }
    index += 1;
    if (marksPhases && steps[index].phase.id !== prevPhase) store.setPhaseDone(prevPhase);
    if (seqId === 'flight') store.setPosition(seqId, index);
    render();
  }

  function prev() {
    if (index === 0) return;
    index -= 1;
    if (seqId === 'flight') store.setPosition(seqId, index);
    render();
  }

  function finish() {
    stopVoice();
    finished = true;
    index = 0; // so exiting after completion doesn't re-save a stale position
    if (seqId === 'flight') store.setPosition('flight', 0);
    els.phaseTitle.textContent = 'Flight complete';
    els.context.textContent = '';
    els.blockTitle.textContent = '';
    els.kind.className = 'step-kind';
    els.kind.textContent = '';
    const missCount = Object.keys(store.getMisses()).length;
    els.prompt.textContent = missCount
      ? `Done — ${missCount} step${missCount > 1 ? 's' : ''} to review. They're waiting in "Review misses".`
      : 'Done — no missed steps. Solid.';
    els.answer.classList.add('hidden');
    els.note.classList.add('hidden');
    els.hint.textContent = 'tap ← to go home';
    els.btnPrev.disabled = true;
    els.btnMiss.disabled = true;
    els.btnOk.disabled = true;
  }

  // ---------- voice ----------
  function toggleVoice() {
    if (!voiceSupported) {
      els.voiceFb.className = 'voice-feedback bad';
      els.voiceFb.textContent = 'Speech recognition is not available in this browser.';
      els.voiceFb.classList.remove('hidden');
      return;
    }
    voiceOn = !voiceOn;
    const settings = store.getSettings();
    settings.voice = voiceOn;
    store.setSettings(settings);
    updateVoiceButton();
    if (voiceOn) {
      ensureRecognizer();
      if (get()?.sayTarget && !revealed) recognizer.start();
    } else {
      stopVoice();
    }
  }

  function updateVoiceButton() {
    els.btnVoice.classList.toggle('on', voiceOn);
    els.btnVoice.style.display = voiceSupported ? '' : 'none';
  }

  let voiceErrors = 0;
  function ensureRecognizer() {
    if (recognizer) return;
    recognizer = createRecognizer({
      onResult: ({ text, final }) => {
        lastHeard = text;
        voiceErrors = 0;
        const s = get();
        if (!s || !s.sayTarget || revealed) return;
        const score = matchScore(text, s.sayTarget);
        els.voiceFb.classList.remove('hidden');
        if (score >= 0.6) {
          els.voiceFb.className = 'voice-feedback good';
          els.voiceFb.textContent = `Heard: "${text}" ✓`;
          reveal();
        } else if (final) {
          els.voiceFb.className = 'voice-feedback bad';
          els.voiceFb.textContent = `Heard: "${text}" — check yourself, tap to reveal`;
        } else {
          els.voiceFb.className = 'voice-feedback listening';
          els.voiceFb.textContent = `"${text}"`;
        }
      },
      onState: (state) => {
        if (!voiceOn || revealed) return;
        if (state === 'listening') {
          els.voiceFb.className = 'voice-feedback listening';
          els.voiceFb.textContent = 'Listening…';
          els.voiceFb.classList.remove('hidden');
        } else if (state === 'error') {
          voiceErrors += 1;
          els.voiceFb.className = 'voice-feedback bad';
          els.voiceFb.textContent = 'Mic unavailable — tap flow still works. On iOS, try Safari (not the installed app).';
          els.voiceFb.classList.remove('hidden');
        } else if (state === 'idle') {
          // recognition ends on silence — restart while the step still wants a voice answer
          if (voiceErrors < 3 && get()?.sayTarget && !finished) {
            setTimeout(() => {
              if (voiceOn && !revealed && !finished && get()?.sayTarget && recognizer) recognizer.start();
            }, 400);
          } else if (!lastHeard) {
            els.voiceFb.classList.add('hidden');
          }
        }
      },
    });
  }

  function stopVoice(turnOff = false) {
    recognizer?.stop();
    if (turnOff) voiceOn = false;
  }

  function setVoicePref(on) {
    voiceOn = !!on && voiceSupported;
    if (voiceOn) ensureRecognizer();
    updateVoiceButton();
  }

  // ---------- misc ----------
  function haptic() {
    if (store.getSettings().haptics && navigator.vibrate) navigator.vibrate(8);
  }

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function kindLabel(kind) {
    return { checklist: 'Checklist', flow: 'Flow', callout: 'Callout', radio: 'Radio', briefing: 'Briefing', note: 'Technique' }[kind] || kind;
  }

  init();
  return { start, setVoicePref, stopVoice: () => stopVoice(true) };
}
