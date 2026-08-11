// Examiner mode: 10 random questions per session, drawn from
// speeds, memory flows ("what comes next", recitation) and scenarios.
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

export function createExaminer({ onExit }) {
  let questions = [];
  let index = 0;
  let score = { ok: 0, miss: 0 };
  let revealed = false;
  let finished = false;

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
    // single handler slot — finish() swaps it for the "new session" handler
    els.btnQuit.onclick = finish;
    els.btnBack.addEventListener('click', onExit);
  }

  const SESSION_SIZE = 10;

  function start(mod, steps) {
    questions = buildQuestions(mod, steps);
    shuffle(questions);
    questions = questions.slice(0, SESSION_SIZE);
    index = 0;
    score = { ok: 0, miss: 0 };
    revealed = false;
    finished = false;
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

    // Checklists are deliberately excluded from the examiner: in the aircraft
    // a checklist is READ, not recalled by item position. Only memory content
    // is quizzed — speeds, flows, callouts, radio, briefings and scenarios.
    const memory = (s) => s.kind !== 'checklist' && s.kind !== 'note';

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
      qs.push({ tag: ex.tag || 'Scenario', kind: 'Scenario', q: ex.q, a: ex.a, long: ex.a.length > 60 });
    }

    return qs;
  }

  function get() { return questions[index]; }

  function render() {
    const q = get();
    if (!q) { finish(); return; }
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
    if (index >= questions.length - 1) { finish(); return; }
    index += 1;
    render();
  }

  function finish() {
    finished = true;
    const total = score.ok + score.miss;
    els.score.textContent = t('exam.over');
    els.tag.textContent = '';
    els.kind.textContent = t('exam.result');
    els.kind.className = 'step-kind k-checklist';
    els.question.textContent = total
      ? (score.ok === total ? t('exam.resultPerfect', score.ok, total) : t('exam.resultPartial', score.ok, total))
      : t('exam.resultNone');
    els.answer.classList.add('hidden');
    els.answer.textContent = '';
    els.hint.textContent = t('exam.overHint');
    revealed = false;
    setActionState();
    els.btnQuit.textContent = t('exam.new');
    els.btnQuit.onclick = () => { els.btnQuit.textContent = t('exam.end'); els.btnQuit.onclick = finish; restart(); };
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
