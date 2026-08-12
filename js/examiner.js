// Examiner mode: 10 random questions per session, drawn from
// speeds, memory flows ("what comes next", recitation) and scenarios.
import { t } from './i18n.js';
import { store } from './store.js';
import { checkUnlocks } from './achievements.js';
import { todayIso, floatLabel } from './fx.js';

const $ = (id) => document.getElementById(id);

export function createExaminer({ onExit }) {
  let questions = [];
  let index = 0;
  let score = { ok: 0, miss: 0 };
  let revealed = false;
  let finished = false;
  let dayCredited = false;

  const els = {};
  function bindEls() {
    Object.assign(els, {
      score: $('exam-score'),
      tag: $('exam-tag'),
      card: $('exam-card'),
      kind: $('exam-kind'),
      question: $('exam-question'),
      answer: $('exam-answer'),
      hint: $('exam-hint'),
      btnQuit: $('btn-exam-quit'),
      btnMiss: $('btn-exam-miss'),
      btnOk: $('btn-exam-ok'),
      btnBack: $('btn-exam-back'),
    });
  }

  function init() {
    bindEls();
    els.card.addEventListener('click', onTap);
    els.btnMiss.addEventListener('click', () => grade(false));
    els.btnOk.addEventListener('click', () => grade(true));
    // single handler slot — finish() swaps it for the "new session" handler.
    // Wrapped so the click Event is not passed as `completed`.
    els.btnQuit.onclick = () => finish(false);
    els.btnBack.addEventListener('click', onExit);
  }

  const SESSION_SIZE = 10;
  const SCENARIO_QUOTA = 3;

  function start(mod, steps) {
    questions = buildQuestions(mod, steps);
    shuffle(questions);
    // The hand-written failure scenarios are the sharpest content in the app and
    // would otherwise surface about twice per draw. Guarantee a few every time.
    const scenarioLabel = t('exam.kind.scenario');
    const scenarios = questions.filter(q => q.kind === scenarioLabel).slice(0, SCENARIO_QUOTA);
    const rest = questions.filter(q => !scenarios.includes(q));
    questions = [...scenarios, ...rest.slice(0, SESSION_SIZE - scenarios.length)];
    shuffle(questions);
    index = 0;
    score = { ok: 0, miss: 0 };
    revealed = false;
    finished = false;
    dayCredited = false;
    // start() owns the quit button — finish() repurposes it, so reclaim it here
    els.btnQuit.textContent = t('exam.end');
    els.btnQuit.onclick = () => finish(false);
    render();
  }

  function buildQuestions(mod, steps) {
    const qs = [];

    // 1. speeds
    for (const s of mod.speeds || []) {
      qs.push({
        tag: t('ref.speeds'), kind: t('exam.kind.speed'),
        q: `${s.code}${s.label ? ` — ${s.label}` : ''}?`,
        a: /^\d/.test(s.kias) ? `${s.kias} ${s.unit || 'KIAS'}` : s.kias,
      });
    }

    // A checklist is READ in the aircraft, never recalled by item position — so
    // an item is never asked as "what is number 4?". It IS asked the way an
    // instructor asks it: challenge, and you give the response.
    const memory = (s) => s.kind !== 'checklist' && s.kind !== 'note';

    // 1a. challenge -> response, the question an instructor actually asks.
    // Some challenges repeat inside one check with different responses (Throttle
    // is set three times during the run-up); out of context those are ambiguous,
    // so they are left out of the draw.
    const byBlock = new Map();
    for (const s2 of steps) {
      if (!s2.challenge) continue;
      const key = `${s2.phase.id}::${s2.blockTitle}`;
      if (!byBlock.has(key)) byBlock.set(key, new Map());
      const m = byBlock.get(key);
      m.set(s2.challenge, (m.get(s2.challenge) || 0) + 1);
    }
    const unambiguous = steps.filter(s2 => {
      if (!s2.challenge) return false;
      return byBlock.get(`${s2.phase.id}::${s2.blockTitle}`)?.get(s2.challenge) === 1;
    });
    for (const s2 of pickRandom(unambiguous, 14)) {
      qs.push({
        tag: s2.blockTitle, kind: t('exam.kind.item'),
        q: `${s2.challenge} — ?`,
        a: s2.response,
        key: s2.key,
        mem: s2.mem,
        long: (s2.response || '').length > 60,
      });
    }

    // 1b. recite the marked items of a check, in order
    const markedByBlock = new Map();
    for (const s of steps) {
      if (!s.mem) continue;
      const key = `${s.phase.id}::${s.blockTitle}`;
      if (!markedByBlock.has(key)) markedByBlock.set(key, { title: s.blockTitle, items: [] });
      markedByBlock.get(key).items.push(s.answer);
    }
    for (const { title, items } of markedByBlock.values()) {
      if (items.length < 2) continue;
      qs.push({
        tag: title, kind: t('exam.kind.marked'),
        q: t('exam.markedQ', title, items.length),
        a: items.join('\n'),
        long: true,
      });
    }

    // 1c. what you actually say out loud for a given item
    for (const s of pickRandom(steps.filter(x => x.spoken), 12)) {
      qs.push({
        tag: s.blockTitle, kind: t('exam.kind.spoken'),
        q: t('exam.spokenQ', `${s.challenge} — ${s.response}`),
        a: s.spoken,
        key: s.key,
        mem: s.mem,
        long: true,
      });
    }

    // 2. what comes next (within the same memory block)
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1], cur = steps[i];
      if (!memory(cur) || !memory(prev)) continue;
      if (prev.blockTitle !== cur.blockTitle || prev.phase.id !== cur.phase.id) continue;
      if (Math.random() > 0.3) continue;
      const a = cur.answer;
      qs.push({
        tag: cur.blockTitle, kind: t('exam.kind.next'),
        q: t('exam.nextQ', shorten(prev.answer)),
        a,
        key: cur.key,
        mem: cur.mem,
        long: a.length > 60,
      });
    }

    // 3. recite a whole memory block (flows, callouts — never checklists)
    const blocks = new Map();
    for (const s of steps) {
      if (!memory(s)) continue;
      const key = `${s.phase.id}::${s.blockTitle}`;
      if (!blocks.has(key)) blocks.set(key, { title: s.blockTitle, items: [] });
      blocks.get(key).items.push(s.answer);
    }
    const seenRecites = new Set();
    for (const { title, items } of blocks.values()) {
      if (items.length < 3) continue;
      const sig = `${title}::${items.join('|')}`;
      if (seenRecites.has(sig)) continue; // identical block repeated in another phase
      seenRecites.add(sig);
      qs.push({
        tag: title, kind: t('exam.kind.recite'),
        q: t('exam.reciteQ', title, items.length),
        a: items.map((it, i) => `${i + 1}. ${it}`).join('\n'),
        long: true,
      });
    }

    // 5. scenarios from data
    for (const ex of mod.examiner || []) {
      qs.push({ tag: ex.tag || t('exam.kind.scenario'), kind: t('exam.kind.scenario'), q: ex.q, a: ex.a, long: ex.a.length > 60 });
    }

    return qs;
  }

  function get() { return questions[index]; }

  function render() {
    const q = get();
    if (!q) { finish(true); return; }
    els.score.textContent = t('exam.score', index + 1, questions.length, score.ok, score.miss);
    els.tag.textContent = q.tag;
    els.kind.textContent = q.kind;
    els.kind.className = 'step-kind k-callout';
    els.question.textContent = q.q;
    els.answer.textContent = q.a;
    els.answer.classList.add('hidden');
    els.answer.classList.toggle('long', !!q.long);
    els.hint.textContent = t('exam.hint');
    revealed = false;
    setActionState();
  }

  function setActionState() {
    els.btnMiss.disabled = !revealed;
    els.btnOk.disabled = !revealed;
  }

  function onTap() {
    if (finished || !get()) return;
    if (!revealed) {
      revealed = true;
      els.answer.classList.remove('hidden');
      els.hint.textContent = t('exam.grade');
      setActionState();
    }
  }

  function grade(ok) {
    if (finished || !revealed) return;
    if (ok) score.ok += 1; else score.miss += 1;
    // an examiner session is real practice: it earns and it counts for the day
    if (!dayCredited) { dayCredited = true; store.touchDay(todayIso()); }
    store.bumpStreak(ok);
    // questions that map 1:1 to a step feed the review schedule; speeds and
    // scenarios have no step behind them, so nothing is written for those
    const q = get();
    if (q?.key) {
      if (ok) store.clearMiss(q.key); else store.addMiss(q.key);
      // vital actions cap at box 4 here too, or they escape to 16 days
      store.recordAnswer(q.key, ok, todayIso(), q.mem ? 4 : undefined);
    }
    if (ok) {
      store.addXp(6);
      floatLabel(els.card, '+6 XP');
    }
    if (index >= questions.length - 1) { finish(true); return; }
    index += 1;
    render();
  }

  function finish(completed = false) {
    finished = true;
    const total = score.ok + score.miss;
    // a clean sheet is worth an achievement — only over a whole session
    if (completed && total === SESSION_SIZE && score.miss === 0) checkUnlocks(null, { examPerfect: true });
    els.score.textContent = t('exam.over');
    els.tag.textContent = '';
    els.kind.textContent = t('exam.result');
    els.kind.className = 'step-kind k-checklist';
    els.question.textContent = !total
      ? t('exam.resultNone')
      : !completed
        ? t('exam.resultStopped', score.ok, total)
        : (score.ok === total ? t('exam.resultPerfect', score.ok, total) : t('exam.resultPartial', score.ok, total));
    els.answer.classList.add('hidden');
    els.answer.textContent = '';
    els.hint.textContent = t('exam.overHint');
    revealed = false;
    setActionState();
    els.btnQuit.textContent = t('exam.new');
    els.btnQuit.onclick = restart; // start() restores the label and handler
  }

  let lastArgs = null;
  function restart() { if (lastArgs) start(...lastArgs); }
  const _start = start;
  start = (mod, steps) => { lastArgs = [mod, steps]; _start(mod, steps); };

  function pickRandom(arr, n) {
    const copy = [...arr];
    shuffle(copy);
    return copy.slice(0, n);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  function shorten(t) {
    return t.length > 70 ? `${t.slice(0, 67)}…` : t;
  }

  init();
  return { start: (...a) => start(...a) };
}
