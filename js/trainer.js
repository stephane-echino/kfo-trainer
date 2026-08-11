// Chair-flying engine: say it out loud → tap to reveal → grade → next.
import { store } from './store.js';
import { renderCircuit, moveDot } from './circuit.js';
import { voiceSupported, createRecognizer, matchScore } from './voice.js';
import { t } from './i18n.js';
import { haptic, burst, floatLabel, todayIso } from './fx.js';
import { hintFor, rpmTarget, summary as conditionsSummary } from './state.js';
import { getLang } from './i18n.js';
import { checkUnlocks } from './achievements.js';

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
  let rpmGoal = null;
  let session = null;   // { ok, miss, startedAt, xpStart, complete }

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
      source: $('step-source'),
      streak: $('streak-chip'),
      prompt: $('step-prompt'),
      answer: $('step-answer'),
      spoken: $('step-spoken'),
      mem: $('step-mem'),
      note: $('step-note'),
      stateHint: $('state-hint'),
      rpm: $('rpm-control'),
      rpmReadout: $('rpm-readout'),
      rpmSlider: $('rpm-slider'),
      rpmSet: $('rpm-set'),
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
    els.rpm.addEventListener('click', (e) => e.stopPropagation()); // slider must not advance the card
    els.rpmSlider.addEventListener('input', () => {
      els.rpmReadout.textContent = els.rpmSlider.value;
      els.rpmReadout.className = 'rpm-readout';
    });
    els.rpmSet.addEventListener('click', checkRpm);
    bindSwipe($('step-area'));
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
    } else if (sequence === 'memory') {
      // items the checklist marks with a bar, kept in their printed order,
      // each check introduced by its own opening step
      const memBlocks = new Set(allSteps.filter(s => s.mem).map(s => `${s.phase.id}/${s.blockTitle}`));
      steps = allSteps.filter(s =>
        s.mem || (String(s.key).endsWith('/open') && memBlocks.has(`${s.phase.id}/${s.blockTitle}`)));
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
    session = { ok: 0, miss: 0, startedAt: Date.now(), xpStart: store.getStats().xp, complete: false };
    render();
  }

  function get() { return steps[index]; }

  function render() {
    const s = get();
    if (!s) { renderEmpty(); return; }
    const phase = s.phase;

    els.phaseTitle.textContent = phase.title;
    const conds = conditionsSummary(getLang())
      .filter(c => !c.isDefault)
      .map(c => `<span>${c.icon} <b>${esc(c.text)}</b></span>`);
    els.context.innerHTML = [
      ...conds,
      ...(phase.context || []).map(c => `<span>${c.k ? `${esc(c.k)} ` : ''}<b>${esc(c.v)}</b></span>`),
    ].join('<span class="ctx-sep">·</span>');
    moveDot(els.circuit, phase.map);

    els.progress.style.width = `${(index / Math.max(steps.length - 1, 1)) * 100}%`;
    els.blockTitle.textContent = s.blockTitle;

    els.kind.textContent = kindLabel(s.kind);
    els.kind.className = `step-kind k-${s.kind}`;
    els.source.textContent = s.source || '';
    els.source.classList.toggle('hidden', !s.source);
    els.mem.textContent = t('badge.mem');
    els.mem.classList.toggle('hidden', !s.mem);

    // "Item 3 of 10" reads as a counter, not as the question
    const counter = /^(Item|Step|Étape) /.test(s.prompt) && /\d/.test(s.prompt);
    els.prompt.innerHTML =
      (s.promptPre ? `<span class="prompt-pre">${esc(s.promptPre)}</span>` : '') +
      (counter ? `<span class="count">${esc(s.prompt)}</span>` : esc(s.prompt));

    els.card.classList.remove('revealed');
    els.answer.classList.add('hidden');
    els.spoken.classList.add('hidden');
    els.note.classList.add('hidden');
    els.stateHint.classList.add('hidden');
    els.voiceFb.classList.add('hidden');
    if (s.spoken) els.spoken.innerHTML = `<span class="spoken-label">${esc(t('badge.spoken'))}</span>${esc(s.spoken)}`;

    // interactive throttle when the step sets an RPM value
    rpmGoal = store.getSettings().controls === false ? null : rpmTarget(s);
    els.rpm.classList.toggle('hidden', !rpmGoal);
    if (rpmGoal) {
      els.rpmSlider.value = 1000;
      els.rpmReadout.textContent = '1000';
      els.rpmReadout.className = 'rpm-readout';
      els.rpmSet.textContent = t('rpm.set');
    }

    const hint = hintFor(s, getLang());
    if (hint) els.stateHint.textContent = hint;
    els.answer.classList.toggle('long', !!s.answerLong);
    // dim the official item number so the response itself carries the eye
    const numbered = /^(\d+)\.\s/.exec(s.answer);
    if (numbered && !s.answerLong) {
      els.answer.innerHTML = `<span class="num">${numbered[1]}.</span> ${esc(s.answer.slice(numbered[0].length))}`;
    } else {
      els.answer.textContent = s.answer;
    }
    if (s.note) els.note.textContent = s.note;

    revealed = false;
    lastHeard = '';
    els.hint.textContent = s.kind === 'note'
      ? t('hint.read')
      : (voiceOn ? t('hint.sayListen') : t('hint.say'));
    setActionState();

    if (voiceOn && s.sayTarget && recognizer) recognizer.start();
  }

  function renderEmpty() {
    els.phaseTitle.textContent = t('trainer.emptyReview');
    els.context.textContent = '';
    els.blockTitle.textContent = '';
    els.kind.className = 'step-kind';
    els.kind.textContent = '';
    els.prompt.textContent = t('trainer.emptyReviewMsg');
    els.answer.classList.add('hidden');
    els.note.classList.add('hidden');
    els.voiceFb.classList.add('hidden');
    els.hint.textContent = t('hint.goBack');
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
    else advanceFromTap();
  }

  // Horizontal swipes: left = next, right = previous. Vertical movement is
  // left alone so the note panel can still scroll.
  function bindSwipe(el) {
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (finished || !get()) return;
      if (dx < 0) { if (!revealed) reveal(); else advanceFromTap(); }
      else prev();
    }, { passive: true });
  }

  function reveal() {
    const s = get();
    revealed = true;
    els.card.classList.add('revealed');
    els.rpm.classList.add('hidden');
    els.answer.classList.remove('hidden');
    if (s.spoken) els.spoken.classList.remove('hidden');
    if (s.note) els.note.classList.remove('hidden');
    if (hintFor(s, getLang())) els.stateHint.classList.remove('hidden');
    els.hint.textContent = s.graded ? t('hint.revealed') : t('hint.next');
    stopVoice(false);
    haptic();
    setActionState();
  }

  // Interactive throttle: set the lever, then check against the printed value.
  function checkRpm() {
    if (!rpmGoal || revealed) return;
    const v = +els.rpmSlider.value;
    const ok = v >= rpmGoal.min && v <= rpmGoal.max;
    els.rpmReadout.className = `rpm-readout ${ok ? 'ok' : 'no'}`;
    els.rpmSet.textContent = ok ? t('rpm.good') : t('rpm.bad', rpmGoal.label);
    haptic(ok ? 8 : [14, 50, 14]);
    if (ok) {
      floatLabel(els.rpm, '+5 XP');
      store.addXp(5);
    }
    setTimeout(reveal, ok ? 420 : 1100);
  }

  function grade(ok) {
    const s = get();
    if (!s || !revealed) return;
    if (ok) store.clearMiss(s.key); else store.addMiss(s.key);
    if (s.graded) award(ok);
    advance(ok);
  }

  // XP and running streak — cosmetic motivation, never affects content.
  function award(ok) {
    if (session) session[ok ? 'ok' : 'miss'] += 1;
    const cur = get();
    if (cur?.phase?.id) store.recordPhase(cur.phase.id, ok);
    const streak = store.bumpStreak(ok);
    if (ok) {
      const bonus = streak >= 20 ? 6 : streak >= 10 ? 4 : streak >= 5 ? 2 : 0;
      store.addXp(10 + bonus);
      floatLabel(els.card, `+${10 + bonus} XP`);
      if (streak > 0 && streak % 10 === 0) {
        burst(els.streak, 20);
        haptic([10, 40, 14]);
      }
    } else {
      haptic([14, 50, 14]);
    }
    paintStreak(streak, ok);
  }

  function paintStreak(streak, grew) {
    els.streak.textContent = `🔥 ${streak}`;
    els.streak.classList.toggle('show', streak >= 3);
    if (grew && streak >= 3) {
      els.streak.classList.remove('bump');
      void els.streak.offsetWidth; // restart the animation
      els.streak.classList.add('bump');
    }
  }

  // tapping the card past the reveal counts as "got it"
  function advanceFromTap() {
    const s = get();
    if (s && revealed && s.graded) {
      store.clearMiss(s.key);
      award(true);
    }
    advance();
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
    if (seqId === 'flight') {
      store.setPosition('flight', 0);
      store.countFlight();
    }
    store.touchDay(todayIso());
    if (session) session.complete = true;
    burst(els.card, 34);
    haptic([12, 60, 12, 60, 20]);
    els.phaseTitle.textContent = t('trainer.done');
    els.context.textContent = '';
    els.blockTitle.textContent = '';
    els.kind.className = 'step-kind';
    els.kind.textContent = '';
    els.mem.classList.add('hidden');
    els.source.classList.add('hidden');
    els.rpm.classList.add('hidden');
    els.spoken.classList.add('hidden');
    els.stateHint.classList.add('hidden');

    const total = (session?.ok || 0) + (session?.miss || 0);
    const pct = total ? Math.round((session.ok / total) * 100) : 0;
    const xp = store.getStats().xp - (session?.xpStart || 0);
    const mins = Math.max(1, Math.round(((Date.now() - (session?.startedAt || Date.now())) / 60000)));
    const missCount = Object.keys(store.getMisses()).length;

    els.prompt.innerHTML = total
      ? `<span class="summary-score">${pct}<span class="pct">%</span></span>
         <span class="summary-line">${session.ok} ✓ · ${session.miss} ✗ · +${xp} XP · ${mins}′</span>`
      : esc(missCount ? t('trainer.doneMiss', missCount) : t('trainer.doneClean'));

    const fresh = checkUnlocks(session);
    const lines = [];
    if (missCount) lines.push(t('trainer.doneMiss', missCount));
    else if (total) lines.push(t('trainer.doneClean'));
    for (const a of fresh) {
      const l = a[getLang()] || a.en;
      lines.push(`${a.icon} ${t('trainer.unlocked')} — ${l.name}: ${l.desc}`);
    }
    if (lines.length) {
      els.note.textContent = lines.join('\n');
      els.note.classList.remove('hidden');
    } else {
      els.note.classList.add('hidden');
    }
    if (fresh.length) setTimeout(() => burst(els.card, 22), 500);

    els.answer.classList.add('hidden');
    els.hint.textContent = t('hint.goHome');
    els.btnPrev.disabled = true;
    els.btnMiss.disabled = true;
    els.btnOk.disabled = true;
  }

  // ---------- voice ----------
  function toggleVoice() {
    if (!voiceSupported) {
      els.voiceFb.className = 'voice-feedback bad';
      els.voiceFb.textContent = t('voice.unsupported');
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
          els.voiceFb.textContent = t('voice.heardOk', text);
          reveal();
        } else if (final) {
          els.voiceFb.className = 'voice-feedback bad';
          els.voiceFb.textContent = t('voice.heardBad', text);
        } else {
          els.voiceFb.className = 'voice-feedback listening';
          els.voiceFb.textContent = `"${text}"`;
        }
      },
      onState: (state) => {
        if (!voiceOn || revealed) return;
        if (state === 'listening') {
          els.voiceFb.className = 'voice-feedback listening';
          els.voiceFb.textContent = t('voice.listening');
          els.voiceFb.classList.remove('hidden');
        } else if (state === 'error') {
          voiceErrors += 1;
          els.voiceFb.className = 'voice-feedback bad';
          els.voiceFb.textContent = t('voice.unavailable');
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
    return t(`kind.${kind}`) || kind;
  }

  init();
  return { start, setVoicePref, stopVoice: () => stopVoice(true) };
}
