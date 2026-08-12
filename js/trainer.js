// Chair-flying engine: say it out loud → tap to reveal → grade → next.
import { store } from './store.js';
import { renderCircuit, moveDot, renderSituationBand, moveBand } from './circuit.js';
import { voiceSupported, createRecognizer, matchScore } from './voice.js';
import { t } from './i18n.js';
import { haptic, burst, floatLabel, todayIso } from './fx.js';
import { hintFor, rpmTarget, summary as conditionsSummary } from './state.js';
import { getLang } from './i18n.js';
import { checkUnlocks } from './achievements.js';
import { speak, stopSpeaking, ttsSupported } from './tts.js';

const $ = (id) => document.getElementById(id);

export function createTrainer({ onExit }) {
  let steps = [];
  let courseSteps = [];   // whole course — mastery is judged on this, not on the session
  let seqId = 'flight';
  let index = 0;
  let revealed = false;
  let finished = false;
  let recognizer = null;
  let voiceOn = false;
  let lastHeard = '';
  let rpmGoal = null;
  let clueUsed = false;
  let rpmRevealTimer = null;
  let session = null;   // { ok, miss, startedAt, xpStart, complete }
  let swipedAt = 0;     // timestamp of the last handled swipe

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
      timer: $('timer-chip'),
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
      clue: $('step-clue'),
      btnClue: $('btn-clue'),
      hint: $('step-hint'),
      btnPrev: $('btn-step-prev'),
      btnMiss: $('btn-step-miss'),
      btnOk: $('btn-step-ok'),
      btnBack: $('btn-trainer-back'),
      btnVoice: $('btn-voice-toggle'),
      btnHf: $('btn-handsfree'),
    });
  }

  // The circuit course gets the pattern map; the emergency course gets a
  // situation band, because a pattern drawing says nothing about a cabin fire.
  let mapMode = 'circuit';

  function setMapMode(mode) {
    if (mode === mapMode && els.circuit.childElementCount) return;
    mapMode = mode;
    if (mode === 'band') {
      renderSituationBand(els.circuit, {
        ground: t('band.ground'), takeoff: t('band.takeoff'), inflight: t('band.inflight'),
        circuit: t('band.circuit'), landing: t('band.landing'),
      });
    } else {
      renderCircuit(els.circuit);
    }
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
    els.btnClue.addEventListener('click', (e) => { e.stopPropagation(); showClue(); });
    bindSwipe($('step-area'));
    els.btnPrev.addEventListener('click', prev);
    els.btnMiss.addEventListener('click', () => grade(false));
    els.btnOk.addEventListener('click', () => grade(true));
    els.btnBack.addEventListener('click', () => { stopVoice(true); stopHandsFree(); saveAndNotifyExit(); });
    els.btnVoice.addEventListener('click', toggleVoice);
    els.btnHf.addEventListener('click', toggleHandsFree);
    updateVoiceButton();
  }

  function saveAndNotifyExit() {
    stopTimer();
    els.timer.classList.add('hidden');
    store.setPosition(seqId, index);
    // a partial session can still have earned something
    if (session && (session.ok + session.miss) > 0 && !session.complete) checkUnlocks(session, unlockContext());
    onExit();
  }

  // sequence: 'flight' (all steps) | 'review' (missed only) | 'phase:<id>'
  function start(allSteps, sequence, wholeCourse) {
    seqId = sequence;
    courseSteps = wholeCourse || allSteps;
    if (sequence === 'review') {
      // everything the schedule says is due today, weakest boxes first so the
      // shakiest items come back while attention is freshest
      const due = new Set(store.dueKeys(todayIso()));
      const sched = store.getSched();
      steps = allSteps.filter(s => due.has(s.key));
      steps.sort((a, b) => (sched[a.key]?.box ?? 0) - (sched[b.key]?.box ?? 0));
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
    startTimer();
  }


  // Cued recall: give back the challenge (or the opening words) so the student
  // can still retrieve the answer instead of being handed it. A step answered
  // with a clue is worth less XP and does not count as a clean streak hit.
  function clueFor(step) {
    if (!step || step.kind === 'note') return null;
    if (step.challenge) return step.challenge;
    const words = String(step.answer || '').split(/\s+/);
    if (words.length < 4) return null;
    return `${words.slice(0, Math.max(2, Math.ceil(words.length / 4))).join(' ')}…`;
  }

  function showClue() {
    const s = get();
    if (!s || revealed) return;
    const c = clueFor(s);
    if (!c) return;
    clueUsed = true;
    els.clue.textContent = c;
    els.clue.classList.remove('hidden');
    els.btnClue.classList.add('used');
    els.btnClue.textContent = t('clue.used');
    haptic(6);
  }


  // ---------- hands-free ----------
  // The app plays pilot monitoring: it reads the challenge, leaves you a beat to
  // answer out loud, then reads the response and moves on. This is the mode for
  // a train with earphones in, phone in a pocket.
  let handsFree = false;
  let hfTimer = null;
  const HF_ANSWER_DELAY = 4000;   // time to say it yourself
  const HF_NEXT_DELAY = 2600;     // time to hear the answer land

  // The cue is what triggers the action: a checklist item's challenge, a
  // call-out's "when", a flow step's own prompt. Never a slice of the answer —
  // reading the first quarter of the answer aloud gives the answer away.
  function hfCue(step) {
    if (!step) return '';
    if (step.challenge) return step.challenge;              // checklist item
    // A flow or briefing step's own prompt is only "step 3 of 7", which cues
    // nothing in earphones. Name the drill it belongs to.
    if ((step.kind === 'flow' || step.kind === 'briefing') && step.blockTitle) {
      return `${step.blockTitle}, ${step.prompt || ''}`.trim();
    }
    return step.prompt || '';                               // callout/radio "when"
  }

  // The cue is written in the interface language; only the answer can be
  // published English inside a French module.
  function cueLang() { return getLang() === 'fr' ? 'fr-FR' : 'en-US'; }

  function toggleHandsFree() {
    if (!ttsSupported) {
      els.voiceFb.className = 'voice-feedback bad';
      els.voiceFb.textContent = t('hf.unsupported');
      els.voiceFb.classList.remove('hidden');
      return;
    }
    handsFree ? stopHandsFree() : startHandsFree();
  }

  function startHandsFree() {
    handsFree = true;
    els.btnHf.classList.add('on');
    els.voiceFb.className = 'voice-feedback listening';
    els.voiceFb.textContent = t('hf.on');
    els.voiceFb.classList.remove('hidden');
    hfPlay();
  }

  // Any deliberate action takes back control: otherwise the pending timer would
  // advance a second time and the voice would narrate a card you already left.
  function userTookOver() {
    if (handsFree) stopHandsFree();
  }

  function stopHandsFree() {
    handsFree = false;
    clearTimeout(hfTimer);
    stopSpeaking();
    els.btnHf.classList.remove('on');
    els.voiceFb.classList.add('hidden');
  }

  function hfPlay() {
    if (!handsFree) return;
    const s = get();
    if (!s || finished) { stopHandsFree(); return; }

    const readAnswer = () => {
      if (!handsFree) return;
      if (!revealed) reveal();
      // move on only once the answer has actually finished: a spoken call-out
      // runs far longer than any fixed delay
      speak(s.spoken || s.answer, stepLang(s), () => {
        if (!handsFree) return;
        hfTimer = setTimeout(() => {
          if (!handsFree) return;
          advance();            // advance() ends the session on the last step
          hfPlay();
        }, HF_NEXT_DELAY);
      });
    };

    // the answer window is for you to speak, so it starts after the question
    const afterCue = () => {
      if (!handsFree) return;
      hfTimer = setTimeout(readAnswer, HF_ANSWER_DELAY);
    };

    if (!revealed) speak(hfCue(s), cueLang(), afterCue);
    else afterCue();
  }



  // ---------- stopwatch (vital-actions drill only) ----------
  // Emergency drills are about reacting, so this run is timed against your own
  // previous best. No target time is shown: none is published.
  let timerId = null;

  function timed() { return seqId === 'memory'; }

  function fmt(ms) {
    const total = Math.round(ms / 100) / 10;
    return total >= 60 ? `${Math.floor(total / 60)}′${String(Math.floor(total % 60)).padStart(2, '0')}″` : `${total.toFixed(1)}s`;
  }

  function startTimer() {
    stopTimer();
    if (!timed()) { els.timer.classList.add('hidden'); return; }
    els.timer.classList.remove('hidden');
    els.timer.textContent = '0.0s';
    timerId = setInterval(() => {
      if (!session) return;
      els.timer.textContent = fmt(Date.now() - session.startedAt);
    }, 100);
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }


  // Facts the achievement tests need that the store cannot answer on its own.
  function unlockContext() {
    const sched = store.getSched();
    // measured over the course: a three-item review must not read as 90% ready
    const graded = (courseSteps.length ? courseSteps : steps).filter(x => x.graded);
    let sum = 0, vitalSolid = 0, vitalTotal = 0;
    for (const x of graded) {
      const box = sched[x.key]?.box ?? 0;
      sum += Math.max(box, 0) / 5;
      if (x.mem) { vitalTotal += 1; if (box >= 3) vitalSolid += 1; }
    }
    return {
      readiness: graded.length ? Math.round((sum / graded.length) * 100) : 0,
      vitalSolid, vitalTotal,
      bestMemoryTime: store.getBestTime('memory'),
    };
  }

  function get() { return steps[index]; }

  // In the emergency course a marked item is a vital action to be done from
  // memory, not a checklist item flagged in the margin — so it is labelled
  // differently and coloured as a warning.
  function isEmergency() { return (store.getSettings().course || 'circuit') === 'emergency'; }

  function render() {
    // the previous card's answer must not still be playing when the mic reopens,
    // or the recogniser hears the phone and validates the wrong step
    stopSpeaking();
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
    setMapMode((store.getSettings().course || 'circuit') === 'emergency' ? 'band' : 'circuit');
    if (mapMode === 'band') moveBand(els.circuit, phase.map);
    else moveDot(els.circuit, phase.map);

    els.progress.style.width = `${(index / Math.max(steps.length - 1, 1)) * 100}%`;
    // a technique card uses its block title as the question — don't print it twice
    const sameAsPrompt = (s.blockTitle || '').trim() === (s.prompt || '').trim();
    els.blockTitle.textContent = sameAsPrompt ? '' : s.blockTitle;

    els.kind.textContent = kindLabel(s.kind);
    els.kind.className = `step-kind k-${s.kind}`;
    els.source.textContent = s.source || '';
    els.source.classList.toggle('hidden', !s.source);
    els.mem.textContent = t(isEmergency() ? 'badge.memAction' : 'badge.mem');
    els.mem.classList.toggle('hidden', !s.mem);
    els.mem.classList.toggle('vital', isEmergency());

    // "Item 3 of 10" reads as a counter, not as the question
    const counter = /^(Item|Step|Étape) /.test(s.prompt) && /\d/.test(s.prompt);
    els.prompt.innerHTML =
      (s.promptPre ? `<span class="prompt-pre">${esc(s.promptPre)}</span>` : '') +
      (counter ? `<span class="count">${esc(s.prompt)}</span>` : esc(s.prompt));

    els.card.classList.remove('revealed');
    clearTimeout(rpmRevealTimer);
    rpmRevealTimer = null;
    clueUsed = false;
    els.clue.classList.add('hidden');
    els.btnClue.classList.remove('used');
    els.btnClue.textContent = t('clue.ask');
    els.btnClue.classList.toggle('hidden', !clueFor(s));
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
    els.card.classList.toggle('long-answer', !!s.answerLong);
    els.card.classList.toggle('k-note', s.kind === 'note');
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

    if (voiceOn && s.sayTarget && recognizer) recognizer.start(stepLang(s));
  }

  function renderEmpty() {
    const isMemory = seqId === 'memory';
    els.phaseTitle.textContent = isMemory ? t('trainer.emptyMarked') : t('trainer.emptyReview');
    els.context.textContent = '';
    els.blockTitle.textContent = '';
    els.kind.className = 'step-kind';
    els.kind.textContent = '';
    els.mem.classList.add('hidden');
    els.source.classList.add('hidden');
    els.rpm.classList.add('hidden');
    els.spoken.classList.add('hidden');
    els.stateHint.classList.add('hidden');
    els.prompt.textContent = isMemory ? t('trainer.emptyMarkedMsg') : t('trainer.emptyReviewMsg');
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
    if (handsFree) { stopHandsFree(); return; }   // taking back control stops the loop
    if (swipedAt && Date.now() - swipedAt < 400) return; // a flick can also fire a click
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
      swipedAt = Date.now();
      userTookOver();
      if (dx < 0) { if (!revealed) reveal(); else advanceFromTap(); }
      else prev();
    }, { passive: true });
  }

  function reveal() {
    const s = get();
    revealed = true;
    els.card.classList.add('revealed');
    els.rpm.classList.add('hidden');
    // the clue is contained in the answer — drop both once it is out
    els.btnClue.classList.add('hidden');
    els.clue.classList.add('hidden');
    els.answer.classList.remove('hidden');
    if (s.spoken) els.spoken.classList.remove('hidden');
    if (s.note) els.note.classList.remove('hidden');
    if (hintFor(s, getLang())) els.stateHint.classList.remove('hidden');
    els.hint.textContent = s.graded ? t('hint.revealed') : t('hint.next');
    if (!handsFree && store.getSettings().speak) speak(s.spoken || s.answer, stepLang(s));
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
    // cancelled on the next render: otherwise leaving before it fires would
    // reveal the following card before the student has answered it
    clearTimeout(rpmRevealTimer);
    rpmRevealTimer = setTimeout(reveal, ok ? 420 : 1100);
  }

  function grade(ok) {
    userTookOver();
    const s = get();
    if (!s || !revealed) return;
    if (ok) store.clearMiss(s.key); else store.addMiss(s.key);
    // every graded answer schedules when the step should come back
    if (s.graded) store.recordAnswer(s.key, ok, todayIso(), s.mem ? 4 : undefined, { cued: clueUsed });
    if (s.graded) award(ok);
    advance(ok);
  }

  // XP and running streak — cosmetic motivation, never affects content.
  function award(ok) {
    if (session) {
      session[ok ? 'ok' : 'miss'] += 1;
      if (ok && clueUsed) session.cued = (session.cued || 0) + 1;
    }
    // a session interrupted mid-flight still counts as practice for today
    if (session && !session.dayCredited) {
      session.dayCredited = true;
      store.touchDay(todayIso());
    }
    const clued = clueUsed;
    const cur = get();
    if (cur?.phase?.id) store.recordPhase(cur.phase.id, ok);
    // a clued hit is neutral for the run: it neither extends nor breaks it
    const streak = (ok && clued) ? store.getStats().streak : store.bumpStreak(ok);
    if (ok) {
      const bonus = streak >= 20 ? 6 : streak >= 10 ? 4 : streak >= 5 ? 2 : 0;
      const gained = clued ? 4 : 10 + bonus;   // a clued answer is worth less
      store.addXp(gained);
      floatLabel(els.card, `+${gained} XP`, clued ? '#5fb0f7' : undefined);
      if (!clued && streak > 0 && streak % 10 === 0) {
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
  // Tapping on past a revealed card moves on without claiming you knew it.
  // Grading stays deliberate (the ✓/✗ buttons): XP, streaks and the review
  // schedule are only worth something if the cheapest gesture cannot earn them.
  function advanceFromTap() {
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
    userTookOver();
    if (index === 0) return;
    index -= 1;
    if (seqId === 'flight') store.setPosition(seqId, index);
    render();
  }

  function finish() {
    stopVoice();
    stopTimer();
    // the summary is its own kind of card: drop the last step's styling, which
    // otherwise dims the score through the long-answer rule
    els.card.classList.remove('long-answer', 'k-note');
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

    // a timed drill reports seconds against your own best, not round minutes
    let timeLine = `${mins}′`;
    let beatRecord = false;
    if (timed() && session && total > 0) {
      const elapsed = Date.now() - session.startedAt;
      const prev = store.getBestTime(seqId);
      const res = store.recordTime(seqId, elapsed);
      beatRecord = res.best && prev !== null;
      timeLine = fmt(elapsed) + (beatRecord ? ` · ${t('timer.record')}` : (prev !== null ? ` · ${t('timer.best', fmt(prev))}` : ''));
    }

    // what the session actually changed in the schedule — the point of grading
    const sched = store.getSched();
    const today = todayIso();
    let backToday = 0, backLater = 0;
    for (const st of steps) {
      const e = sched[st.key];
      if (!e) continue;
      if (e.due <= today) backToday += 1; else backLater += 1;
    }
    const nextLine = total
      ? (backToday
          ? t('summary.backToday', backToday)
          : (backLater ? t('summary.backLater', backLater) : ''))
      : '';

    els.prompt.innerHTML = total
      ? `<span class="summary-score">${pct}<span class="pct">%</span></span>
         <span class="summary-line">${session.ok} ✓ · ${session.miss} ✗${session.cued ? ` · ${t('summary.cued', session.cued)}` : ''} · +${xp} XP · ${timeLine}</span>
         ${nextLine ? `<span class="summary-next">${esc(nextLine)}</span>` : ''}`
      : esc(missCount ? t('trainer.doneMiss', missCount) : t('trainer.doneClean'));
    if (beatRecord) burst(els.card, 26);

    const fresh = checkUnlocks(session, unlockContext());
    const lines = [];
    // With a scored session the summary already says what comes back and when;
    // the running miss total would only contradict it with a different number.
    if (!total) {
      if (missCount) lines.push(t('trainer.doneMiss', missCount));
    } else if (!session.miss) {
      lines.push(t('trainer.doneClean'));
    }
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
      if (get()?.sayTarget && !revealed) recognizer.start(stepLang(get()));
    } else {
      stopVoice();
    }
  }

  function updateVoiceButton() {
    els.btnVoice.classList.toggle('on', voiceOn);
    els.btnVoice.style.display = voiceSupported ? '' : 'none';
  }


  // Callouts, radio and briefings are published in English in both modules;
  // checklists and technique flows follow the module language.
  function stepLang(step) {
    if (!step) return 'en-US';
    // the data can say so explicitly (English wording inside a French module)
    if (step.lang) return step.lang === 'fr' ? 'fr-FR' : 'en-US';
    if (step.kind === 'callout' || step.kind === 'radio') return 'en-US';
    return getLang() === 'fr' ? 'fr-FR' : 'en-US';
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
        const score = matchScore(text, s.sayTarget, stepLang(s));
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
              if (voiceOn && !revealed && !finished && get()?.sayTarget && recognizer) recognizer.start(stepLang(get()));
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
    if (turnOff) { voiceOn = false; updateVoiceButton(); }
  }

  function setVoicePref(on) {
    voiceOn = !!on && voiceSupported;
    if (voiceOn) ensureRecognizer();
    updateVoiceButton();
  }

  // ---------- misc ----------
  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function kindLabel(kind) {
    return t(`kind.${kind}`) || kind;
  }

  init();
  return { start, setVoicePref, stopVoice: () => stopVoice(true) };
}
