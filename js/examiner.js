// Examiner mode: 10 random questions per session, drawn from
// speeds, checklist items, "what comes next", block recitation and scenarios.
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
        tag: 'Speeds', kind: 'Speed',
        q: `${s.code}${s.label ? ` — ${s.label}` : ''}?`,
        a: /^\d/.test(s.kias) ? `${s.kias} ${s.unit || 'KIAS'}` : s.kias,
      });
    }

    // 2. checklist items (challenge → response)
    const clSteps = steps.filter(s => s.challenge);
    for (const s of pickRandom(clSteps, 25)) {
      qs.push({
        tag: s.blockTitle, kind: 'Item',
        q: `${s.challenge} — ?`,
        a: s.response,
        long: s.response.length > 60,
      });
    }

    // 3. what comes next (within the same block)
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1], cur = steps[i];
      if (prev.blockTitle !== cur.blockTitle || prev.phase.id !== cur.phase.id || cur.kind === 'note') continue;
      if (Math.random() > 0.15) continue;
      const a = cur.answer;
      qs.push({
        tag: cur.blockTitle, kind: 'Next step',
        q: `After "${shorten(prev.answer)}" — what comes next?`,
        a,
        long: a.length > 60,
      });
    }

    // 4. recite a whole block (per phase — same title can exist in several phases)
    const blocks = new Map();
    for (const s of steps) {
      if (s.kind === 'note' || String(s.key).endsWith('/open')) continue;
      const key = `${s.phase.id}::${s.blockTitle}`;
      if (!blocks.has(key)) blocks.set(key, { title: s.blockTitle, items: [], numbered: false });
      const b = blocks.get(key);
      b.items.push(s.answer);
      if (s.challenge) b.numbered = true; // checklist items carry their official numbers
    }
    const seenRecites = new Set();
    for (const { title, items, numbered } of blocks.values()) {
      if (items.length < 3) continue;
      const sig = `${title}::${items.join('|')}`;
      if (seenRecites.has(sig)) continue; // identical block repeated in another phase
      seenRecites.add(sig);
      qs.push({
        tag: title, kind: 'Recite',
        q: `Recite: ${title} (${items.length} items)`,
        a: numbered ? items.join('\n') : items.map((t, i) => `${i + 1}. ${t}`).join('\n'),
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
    els.score.textContent = `Question ${index + 1}/${questions.length} · ✓ ${score.ok} · ✗ ${score.miss}`;
    els.tag.textContent = q.tag;
    els.kind.textContent = q.kind;
    els.kind.className = 'step-kind k-callout';
    els.question.textContent = q.q;
    els.answer.textContent = q.a;
    els.answer.classList.add('hidden');
    els.answer.classList.toggle('long', !!q.long);
    els.hint.textContent = 'answer out loud · tap to reveal';
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
      els.hint.textContent = 'grade yourself below';
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
    els.score.textContent = 'Session over';
    els.tag.textContent = '';
    els.kind.textContent = 'Result';
    els.kind.className = 'step-kind k-checklist';
    els.question.textContent = total
      ? `${score.ok}/${total} correct${score.ok === total ? ' — examiner is impressed.' : '. Rerun the weak ones in Review.'}`
      : 'No questions answered.';
    els.answer.classList.add('hidden');
    els.answer.textContent = '';
    els.hint.textContent = 'tap ← to go back · New session for a new draw';
    revealed = false;
    setActionState();
    els.btnQuit.textContent = 'New session';
    els.btnQuit.onclick = () => { els.btnQuit.textContent = 'End session'; els.btnQuit.onclick = finish; restart(); };
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
