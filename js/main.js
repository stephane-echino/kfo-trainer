// App shell: screen routing, home rendering, reference browser, settings.
import { loadModule, flattenSteps, combineNote } from './data.js';
import { store } from './store.js';
import { todayIso } from './fx.js';
import { createTrainer } from './trainer.js';
import { createExaminer } from './examiner.js';
import { voiceSupported } from './voice.js';
import { ttsSupported, speak } from './tts.js';
import { t, setLang, getLang } from './i18n.js';
import { APP_VERSION } from './version.js';
import { fetchVersionInfo, cachedVersionInfo, isNewer, applyUpdate, currentVersion } from './updates.js';
import { dayStreak } from './fx.js';
import { CONDITIONS, getState, cycleCondition, randomize } from './state.js';
import { ACHIEVEMENTS, unlocked, resetAchievements } from './achievements.js';

const $ = (id) => document.getElementById(id);

// A "course" is a body of content; each has an EN and an FR module file.
const COURSES = [
  { id: 'circuit', icon: '🛫', file: { en: 'circuit', fr: 'circuit-fr' } },
  { id: 'emergency', icon: '🚨', file: { en: 'emergency', fr: 'emergency-fr' } },
];

let mod = null;
let steps = [];    // what to train — filtered by the "what to train" toggles
let scored = [];   // what to score — the whole course, so narrowing the scope
                   // can never make the student look more ready
let trainer = null;
let examiner = null;
let wakeLock = null;

function sessionActive() {
  return $('screen-trainer').classList.contains('active') || $('screen-examiner').classList.contains('active');
}

let reloadPending = false;
function reloadWhenIdle() {
  reloadPending = true;
}

function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
  // a worker update that arrived mid-session applies as soon as the session ends
  if (reloadPending && !sessionActive()) { location.reload(); return; }
  if (screenId === 'screen-home') renderHome();
  window.scrollTo(0, 0);
}

// Applies every data-i18n / data-i18n-small binding in the static markup.
function applyStaticStrings() {
  document.documentElement.lang = getLang();
  $('ref-search').placeholder = t('ref.search');
  // the marked-items mode means something different in the emergency course
  const emg = (store.getSettings().course || 'circuit') === 'emergency';
  const memCard = document.querySelector('.mode-card[data-mode="memory"]');
  if (memCard) {
    memCard.querySelector('.mode-name').dataset.i18n = emg ? 'mode.memory.nameEmg' : 'mode.memory.name';
    memCard.querySelector('.mode-desc').dataset.i18n = emg ? 'mode.memory.descEmg' : 'mode.memory.desc';
  }
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const smallKey = el.dataset.i18nSmall;
    el.textContent = t(el.dataset.i18n);
    if (smallKey) {
      const small = document.createElement('small');
      small.textContent = t(smallKey);
      el.appendChild(small);
    }
  }
  // icon-only buttons carry their label for screen readers only
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}

function includeMap() {
  const s = store.getSettings();
  return {
    checklist: s.incChecklists, flow: s.incFlows, callout: s.incCallouts,
    radio: s.incRadio, briefing: s.incBriefings, note: s.incNotes,
  };
}

function currentCourse() {
  const want = store.getSettings().course || 'circuit';
  return COURSES.find(c => c.id === want) || COURSES[0];
}

async function loadContent() {
  const course = currentCourse();
  store.setScope(course.id);
  const lang = getLang();
  // never fall back to another course: loading circuit under the emergency
  // scope would stamp the wrong content version and show the wrong material
  const tries = [course.file[lang], course.file.en];
  let lastErr = null;
  for (const id of tries) {
    if (!id) continue;
    try {
      mod = await loadModule(id);
      lastErr = null;
      break;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw new Error('missing content');
  // progress keys are position-derived: reset them if the content moved
  // stamp the COURSE, not the module file: circuit.json and circuit-fr.json
  // carry different ids, and the two languages share one progress scope
  store.syncContentVersion(`${course.id}@${mod.version}`);
  rebuildSteps();
}

// Courses whose module file actually exists; probed once at boot so the
// switcher never offers content that has not shipped yet.
let availableCourses = ['circuit'];
// A HEAD request never reaches the service-worker cache (the fetch handler
// only serves GET), so offline every probe failed and the course switcher
// vanished — stranding the student on whichever course was saved.
async function moduleExists(url) {
  try {
    if (window.caches && await caches.match(url, { ignoreSearch: true })) return true;
  } catch { /* no CacheStorage in this context */ }
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

async function probeCourses() {
  const lang = getLang();
  const found = [];
  for (const c of COURSES) {
    const localized = `./data/modules/${c.file[lang] || c.file.en}.json`;
    const english = `./data/modules/${c.file.en}.json`;
    if (await moduleExists(localized) || await moduleExists(english)) found.push(c.id);
  }
  availableCourses = found.length ? found : ['circuit'];
  renderCourseSwitch();
}

function renderCourseSwitch() {
  const box = $('course-switch');
  box.innerHTML = '';
  if (availableCourses.length < 2) return;   // nothing to switch between
  const active = currentCourse().id;
  for (const id of availableCourses) {
    const c = COURSES.find(x => x.id === id);
    const btn = document.createElement('button');
    btn.className = `course-btn${id === active ? ' active' : ''}`;
    btn.dataset.course = id;
    btn.textContent = `${c.icon} ${t(`course.${id}`)}`;
    btn.onclick = () => switchCourse(id);
    box.appendChild(btn);
  }
}

async function switchCourse(id) {
  if (id === currentCourse().id) return;
  store.setSettings({ ...store.getSettings(), course: id });
  await loadContent();
  applyStaticStrings();
  refRendered = false;
  renderVersionLine();
  renderCourseSwitch();
  renderHome();
}

// The saved position is an index into the *filtered* list, so changing what to
// train would leave it dangling. Remap it through the step key, which survives
// a toggle being switched off and back on.
function rebuildSteps() {
  const prevKey = steps[store.getPosition('flight')]?.key;
  steps = flattenSteps(mod, includeMap());
  scored = flattenSteps(mod);            // unfiltered: the readiness denominator
  if (!steps.length) return;
  const exact = prevKey ? steps.findIndex(s => s.key === prevKey) : -1;
  store.setPosition('flight', exact >= 0
    ? exact
    : Math.min(store.getPosition('flight'), steps.length - 1));
}

async function boot() {
  setLang(store.getSettings().lang);
  applyStaticStrings();
  try {
    await loadContent();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;text-align:center">Could not load flight data.<br>${e.message}</p>`;
    return;
  }

  trainer = createTrainer({ onExit: () => { releaseWake(); show('screen-home'); } });
  examiner = createExaminer({ onExit: () => { releaseWake(); show('screen-home'); } });

  // home actions
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      if (mode === 'flight') startTrainer('flight');
      else if (mode === 'review') startTrainer('review');
      else if (mode === 'memory') startTrainer('memory');
      else if (mode === 'examiner') { requestWake(); examiner.start(mod, steps); show('screen-examiner'); }
      else if (mode === 'reference') { renderReference(); show('screen-reference'); }
    });
  });
  $('btn-settings').addEventListener('click', () => { renderSettings(); show('screen-settings'); });
  $('btn-update').addEventListener('click', onUpdateClick);
  $('app-version').addEventListener('click', openChangelog);
  $('btn-randomize').addEventListener('click', () => { randomize(); renderConditions(); });
  $('btn-ref-back').addEventListener('click', () => show('screen-home'));
  $('ref-search').addEventListener('input', (e) => filterReference(e.target.value));
  $('btn-settings-back').addEventListener('click', () => show('screen-home'));
  $('btn-changelog-back').addEventListener('click', () => show('screen-home'));
  $('btn-ach-back').addEventListener('click', () => show('screen-home'));
  $('badges-row').addEventListener('click', openAchievements);

  renderVersionLine();
  renderHome();
  registerSW();
  checkOnLaunch();
  probeCourses();
}

function renderVersionLine() {
  $('app-version').textContent = `KFO Trainer ${APP_VERSION} · ${mod.name} v${mod.version}`;
  if (pendingVersion) $('app-version').innerHTML += ` <span class="new-badge">NEW</span>`;
}

// Language switch: reload content in the new language and re-render everything.
async function switchLang(l) {
  if (l === getLang()) return;
  store.setSettings({ ...store.getSettings(), lang: l });
  setLang(l);
  applyStaticStrings();
  await loadContent(); // trainer/examiner receive `steps` on every start()
  refRendered = false;
  renderVersionLine();
  paintUpdateButton();
  renderCourseSwitch();
  renderSettings();
  renderHome();
}

function startTrainer(seq) {
  const settings = store.getSettings();
  trainer.setVoicePref(settings.voice);
  requestWake();
  trainer.start(steps, seq, scored);
  show('screen-trainer');
}

// ---------- home ----------
function renderStats() {
  const st = store.getStats();
  const days = dayStreak(st.days || {});
  const cards = [
    { v: st.xp, l: t('stat.xp'), c: 'amber' },
    { v: st.best, l: t('stat.best'), c: 'green' },
    { v: days, l: t('stat.days'), c: 'blue' },
    { v: st.flights, l: t('stat.flights'), c: '' },
  ];
  const strip = $('stats-strip');
  strip.innerHTML = '';
  for (const c of cards) {
    const d = document.createElement('div');
    d.className = 'stat-pill';
    d.innerHTML = `<span class="stat-value ${c.c}"></span><span class="stat-label"></span>`;
    d.querySelector('.stat-value').textContent = c.v;
    d.querySelector('.stat-label').textContent = c.l;
    strip.appendChild(d);
  }
}

function renderConditions() {
  const st = getState();
  const lang = getLang();
  const box = $('conditions-chips');
  box.innerHTML = '';
  for (const c of CONDITIONS) {
    const opt = c.options.find(o => o.id === st[c.id]) || c.options[0];
    const btn = document.createElement('button');
    btn.className = `cond-chip${opt.id === c.options[0].id ? '' : ' alt'}`;
    btn.textContent = `${opt.icon} ${opt.label[lang] || opt.label.en}`;
    btn.onclick = () => { cycleCondition(c.id); renderConditions(); };
    box.appendChild(btn);
  }
}

function renderBadges() {
  const have = unlocked();
  const row = $('badges-row');
  row.innerHTML = '';
  const lang = getLang();
  for (const a of ACHIEVEMENTS) {
    const got = !!have[a.id];
    const l = a[lang] || a.en;
    const el = document.createElement('span');
    el.className = `badge${got ? ' got' : ''}`;
    el.textContent = a.icon;
    el.title = got ? `${l.name} — ${l.desc}` : l.desc;
    row.appendChild(el);
  }
}

// Readiness = how deep this course sits in memory, not how much XP was earned.
// A step contributes its Leitner box out of the top box; steps never answered
// contribute nothing. Reaching 100% means every step survived the full 1-2-4-8-16
// day ladder at least once.
const TOP_BOX = 5;

function readiness() {
  const pool = scored.length ? scored : steps;
  if (!pool.length) return { pct: 0, seen: 0, solid: 0, total: 0 };
  const sched = store.getSched();
  const graded = pool.filter(s => s.graded);
  if (!graded.length) return { pct: 0, seen: 0, solid: 0, total: 0 };
  let sum = 0, seen = 0, solid = 0;
  for (const s of graded) {
    const box = sched[s.key]?.box ?? -1;
    if (box >= 0) seen += 1;
    if (box >= 3) solid += 1;
    sum += Math.max(box, 0) / TOP_BOX;
  }
  return { pct: Math.round((sum / graded.length) * 100), seen, solid, total: graded.length };
}

function renderReadiness() {
  const r = readiness();
  $('readiness-label').textContent = t('ready.label');
  $('readiness-pct').textContent = `${r.pct}%`;
  $('readiness-fill').style.width = `${r.pct}%`;
  $('readiness-sub').textContent = t('ready.sub', r.seen, r.total, r.solid);
  // the number measures wording and sequence; say plainly what it leaves out
  $('readiness-caveat').textContent = t('ready.caveat');
}

function renderHome() {
  renderReadiness();
  renderStats();
  renderBadges();
  renderConditions();
  const pos = Math.min(store.getPosition('flight'), Math.max(steps.length - 1, 0));
  const pct = steps.length ? Math.min(100, Math.round((pos / steps.length) * 100)) : 0;
  const flightPill = $('progress-flight');
  flightPill.innerHTML = '';
  // the flight in progress is the one thing to come back for — give it the weight,
  // and say where you are rather than repeating how the mode works
  const flightCard = document.querySelector('.mode-card[data-mode="flight"]');
  flightCard?.classList.toggle('hero', pos > 0);
  const flightDesc = flightCard?.querySelector('.mode-desc');
  if (flightDesc) {
    flightDesc.textContent = pos > 0
      ? `${steps[pos]?.phase.title || ''} · ${t('home.step', pos + 1, steps.length)}`
      : t('mode.flight.desc');
  }
  if (pos > 0) {
    flightPill.append(t('home.resume', pct));
    const restart = document.createElement('span');
    restart.className = 'restart-btn';
    restart.textContent = '↺';
    restart.title = t('home.restart');
    restart.onclick = (e) => {
      e.stopPropagation();            // don't start the flight, just rewind it
      store.setPosition('flight', 0);
      renderHome();
    };
    flightPill.appendChild(restart);
  }
  // what the schedule says is due today, limited to steps the toggles keep
  const due = new Set(store.dueKeys(todayIso()));
  const dueCount = steps.filter(s => due.has(s.key)).length;
  $('progress-review').textContent = dueCount ? t('home.due', dueCount) : '';
  const reviewDesc = document.querySelector('.mode-card[data-mode="review"] .mode-desc');
  if (reviewDesc) reviewDesc.textContent = t('mode.review.desc');
  const memCount = steps.filter(s => s.mem).length;
  $('progress-memory').textContent = memCount ? `${memCount}` : '';

  const done = store.getPhaseDone();
  const phaseStats = store.getPhaseStats();
  const currentPhase = steps[pos]?.phase.id;
  const chips = $('phase-chips');
  chips.innerHTML = '';
  for (const phase of mod.phases) {
    const btn = document.createElement('button');
    btn.className = 'phase-chip';
    btn.textContent = phase.title;
    // Mastery, once there is enough signal to mean something. It then becomes
    // the ONLY colour on the chip: having walked a phase once must never look
    // like having learned it, so "visited" green is dropped as soon as a real
    // accuracy is known.
    const st = phaseStats[phase.id];
    const seen = st ? st.ok + st.miss : 0;
    if (seen >= 5) {
      const pct = Math.round((st.ok / seen) * 100);
      const band = pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'low';
      btn.classList.add(`m-${band}`);
      const tag = document.createElement('span');
      tag.className = `chip-pct ${band}`;
      tag.textContent = `${pct}%`;
      btn.appendChild(tag);
    } else if (done[phase.id]) {
      btn.classList.add('done');     // walked, but not yet enough answers to score
    }
    if (phase.id === currentPhase) btn.classList.add('current');
    btn.addEventListener('click', () => {
      const settings = store.getSettings();
      trainer.setVoicePref(settings.voice);
      requestWake();
      trainer.start(steps, `phase:${phase.id}`, scored);
      show('screen-trainer');
    });
    chips.appendChild(btn);
  }
  paintPhaseMore();
}

// The wall collapses to two rows; expanding it scrolls the phase you are on
// into view so the button is useful rather than just longer.
let phasesExpanded = false;

function paintPhaseMore() {
  const chips = $('phase-chips');
  const more = $('btn-phase-more');
  const count = chips.children.length;
  chips.classList.toggle('collapsed', !phasesExpanded);
  // nothing to expand if everything already fits
  const overflows = phasesExpanded || chips.scrollHeight > chips.clientHeight + 2;
  more.classList.toggle('hidden', !overflows && !phasesExpanded);
  more.textContent = phasesExpanded ? t('home.showLess') : t('home.showAll', count);
  more.onclick = () => {
    phasesExpanded = !phasesExpanded;
    paintPhaseMore();
    if (phasesExpanded) chips.querySelector('.phase-chip.current')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
}

// ---------- reference ----------
let refRendered = false;
function renderReference() {
  if (refRendered) return;
  refRendered = true;
  const area = $('ref-area');
  area.innerHTML = '';

  // speeds first
  area.appendChild(refSpeedsCard());

  for (const phase of mod.phases) {
    const div = document.createElement('div');
    div.className = 'ref-phase';
    const head = document.createElement('button');
    head.className = 'ref-phase-head';
    head.innerHTML = `<span class="ref-head-text"></span><span class="chev">›</span>`;
    const headText = head.querySelector('.ref-head-text');
    headText.textContent = phase.title;
    if (phase.subtitle) {
      const sub = document.createElement('span');
      sub.className = 'ref-phase-sub';
      sub.textContent = phase.subtitle;
      headText.appendChild(sub);
    }
    head.addEventListener('click', () => div.classList.toggle('open'));
    const body = document.createElement('div');
    body.className = 'ref-phase-body';

    for (const block of phase.blocks) {
      const b = document.createElement('div');
      b.className = 'ref-block';
      const title = document.createElement('div');
      title.className = `ref-block-title k-${block.type}`;
      title.textContent = block.title || block.type;
      if (block.source) {
        const src = document.createElement('span');
        src.className = 'ref-source';
        src.textContent = block.source;
        title.appendChild(src);
      }
      b.appendChild(title);

      if (block.intro) {
        const intro = document.createElement('div');
        intro.className = 'ref-note';
        intro.textContent = block.intro;
        b.appendChild(intro);
      }

      if (block.type === 'checklist') {
        block.items.forEach((it, i) => {
          const row = refItem(`${i + 1}. ${it.c}`, it.r, it.note);
          if (it.mem) row.querySelector('.ref-item .c').insertAdjacentHTML('afterbegin', '<span class="ref-mem">🧠</span> ');
          if (it.spoken) {
            const sp = document.createElement('div');
            sp.className = 'ref-spoken';
            sp.innerHTML = `<span class="spoken-label"></span>`;
            sp.querySelector('.spoken-label').textContent = t('badge.spoken');
            sp.appendChild(document.createTextNode(it.spoken));
            row.appendChild(sp);
          }
          b.appendChild(row);
        });
        if (block.closing) {
          const c = document.createElement('div');
          c.className = 'ref-closing';
          c.textContent = block.closing;
          b.appendChild(c);
        }
      } else if (block.type === 'flow' || block.type === 'briefing') {
        (block.steps || []).forEach((st, i) => b.appendChild(refItem(`${i + 1}.`, st.say || st.do, combineNote(st))));
      } else if (block.type === 'callout' || block.type === 'radio') {
        for (const it of block.items) b.appendChild(refItem(it.when, it.say, it.note));
      } else if (block.type === 'note') {
        const n = document.createElement('div');
        n.className = 'ref-note';
        n.textContent = block.text;
        b.appendChild(n);
      }
      body.appendChild(b);
    }
    div.appendChild(head);
    div.appendChild(body);
    area.appendChild(div);
  }
}

// Live filter over the reference: hides non-matching rows and auto-opens
// the phases that still have something to show.
function filterReference(query) {
  const q = query.trim().toLowerCase();
  const phases = document.querySelectorAll('#ref-area .ref-phase');
  for (const phase of phases) {
    if (!q) {
      phase.style.display = '';
      phase.classList.remove('open', 'force-open');
      for (const row of phase.querySelectorAll('.ref-item, .ref-note, .ref-spoken, .ref-block')) row.style.display = '';
      continue;
    }
    let hits = 0;
    for (const block of phase.querySelectorAll('.ref-block')) {
      let blockHits = 0;
      for (const row of block.children) {
        if (row.classList.contains('ref-block-title')) continue;
        const match = row.textContent.toLowerCase().includes(q);
        row.style.display = match ? '' : 'none';
        if (match) blockHits += 1;
      }
      const titleMatch = (block.querySelector('.ref-block-title')?.textContent || '').toLowerCase().includes(q);
      if (titleMatch) {
        for (const row of block.children) row.style.display = '';
        blockHits += 1;
      }
      block.style.display = blockHits ? '' : 'none';
      hits += blockHits;
    }
    const headMatch = (phase.querySelector('.ref-phase-head')?.textContent || '').toLowerCase().includes(q);
    phase.style.display = (hits || headMatch) ? '' : 'none';
    phase.classList.toggle('open', !!(hits || headMatch));
  }
}

function refItem(c, r, note) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  // a bare ordinal ("4.") gets a narrow first column
  row.className = /^\d+\.$/.test(String(c).trim()) ? 'ref-item numbered' : 'ref-item';
  row.innerHTML = `<span class="c"></span><span class="r"></span>`;
  row.querySelector('.c').textContent = c;
  row.querySelector('.r').textContent = r;
  wrap.appendChild(row);
  if (note) {
    const n = document.createElement('div');
    n.className = 'ref-note';
    n.textContent = note;
    wrap.appendChild(n);
  }
  return wrap;
}

function refSpeedsCard() {
  const div = document.createElement('div');
  div.className = 'ref-phase open';
  div.innerHTML = `<button class="ref-phase-head"><span></span><span class="chev">›</span></button>`;
  div.querySelector('.ref-phase-head span').textContent = t('ref.speeds');
  if (mod.speedsSource) {
    const src = document.createElement('span');
    src.className = 'ref-source';
    src.textContent = mod.speedsSource;
    div.querySelector('.ref-phase-head span').appendChild(src);
  }
  div.querySelector('.ref-phase-head').addEventListener('click', () => div.classList.toggle('open'));
  const body = document.createElement('div');
  body.className = 'ref-phase-body';
  const b = document.createElement('div');
  b.className = 'ref-block';
  for (const s of mod.speeds || []) {
    // the card header already says KIAS — spell out anything measured otherwise
    const unit = s.unit && s.unit !== 'KIAS' ? ` ${s.unit}` : '';
    b.appendChild(refItem(`${s.code}${s.label ? ` — ${s.label}` : ''}`, `${s.kias}${unit}`));
  }
  body.appendChild(b);
  div.appendChild(body);
  return div;
}

// ---------- settings ----------
function renderSettings() {
  const s = store.getSettings();
  $('set-voice').checked = s.voice && voiceSupported;
  $('set-voice').disabled = !voiceSupported;
  $('set-speak').checked = s.speak && ttsSupported;
  $('set-speak').disabled = !ttsSupported;
  $('set-wakelock').checked = s.wakelock;
  $('set-haptics').checked = s.haptics;
  $('voice-support-note').textContent = `${voiceSupported ? t('settings.voiceYes') : t('settings.voiceNo')} ${t('settings.storage')}`;

  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.classList.toggle('active', btn.dataset.lang === getLang());
    btn.onclick = () => switchLang(btn.dataset.lang);
  }

  // what to train
  const SETTING_OF_TYPE = {
    checklist: 'incChecklists', flow: 'incFlows', callout: 'incCallouts',
    radio: 'incRadio', briefing: 'incBriefings', note: 'incNotes',
  };
  for (const btn of document.querySelectorAll('.train-toggle')) {
    const key = SETTING_OF_TYPE[btn.dataset.type];
    btn.classList.toggle('on', store.getSettings()[key] !== false);
    btn.onclick = () => {
      const cur = store.getSettings();
      const next = cur[key] === false;
      // never let the student switch everything off
      const others = Object.entries(SETTING_OF_TYPE)
        .filter(([type]) => type !== btn.dataset.type)
        .some(([, k]) => cur[k] !== false);
      if (!next && !others) return;
      save({ [key]: next });
      btn.classList.toggle('on', next);
      rebuildSteps();
      renderHome();
    };
  }

  $('set-voice').onchange = (e) => save({ voice: e.target.checked });
  $('set-speak').onchange = (e) => {
    save({ speak: e.target.checked });
    // iOS only allows speech that starts from a user gesture — prime it here
    if (e.target.checked) speak(t('settings.speak'), getLang() === 'fr' ? 'fr-FR' : 'en-US');
  };
  $('set-wakelock').onchange = (e) => save({ wakelock: e.target.checked });
  $('set-haptics').onchange = (e) => save({ haptics: e.target.checked });
  $('set-controls').checked = s.controls !== false;
  $('set-controls').onchange = (e) => save({ controls: e.target.checked });
  $('btn-reset-progress').onclick = () => {
    store.setPosition('flight', 0);
    store.resetPhaseDone();
    store.resetPhaseStats();
    flashBtn('btn-reset-progress');
  };
  $('btn-reset-misses').onclick = () => { store.resetMisses(); flashBtn('btn-reset-misses'); };
  $('btn-reset-stats').onclick = () => {
    store.resetStats();
    resetAchievements();
    renderStats();
    renderBadges();
    flashBtn('btn-reset-stats');
  };

  function save(patch) { store.setSettings({ ...store.getSettings(), ...patch }); }
  function flashBtn(id) {
    const b = $(id);
    const label = b.textContent;
    b.textContent = t('settings.done');
    setTimeout(() => { b.textContent = label; }, 1200);
  }
}

// ---------- wake lock ----------
async function requestWake() {
  if (!store.getSettings().wakelock || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not critical */ }
}
function releaseWake() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionActive()) requestWake();
});

// ---------- updates ----------
let versionInfo = null;      // parsed version.json (also feeds the changelog)
let pendingVersion = null;   // newer version available on the server
let updateReloading = false; // guards against reload loops during an update

// Silent check on launch: only paints the button, never interrupts.
async function checkOnLaunch() {
  versionInfo = cachedVersionInfo(); // so the changelog opens offline
  try {
    versionInfo = await fetchVersionInfo();
    if (isNewer(versionInfo.version)) {
      pendingVersion = versionInfo.version;
      paintUpdateButton();
      $('app-version').innerHTML += ` <span class="new-badge">NEW</span>`;
    }
  } catch {
    /* offline — the cached changelog (if any) still opens */
  }
}

function paintUpdateButton() {
  const btn = $('btn-update');
  btn.classList.toggle('available', !!pendingVersion);
  btn.textContent = pendingVersion ? t('update.available', pendingVersion) : t('update.check');
}

let forceArmed = false;

async function onUpdateClick() {
  const btn = $('btn-update');
  if (forceArmed) {          // second tap right after "up to date" → hard refresh
    forceArmed = false;
    btn.textContent = t('update.updating');
    await applyUpdate(currentVersion());
    return;
  }
  if (pendingVersion) {
    btn.textContent = t('update.updating');
    await applyUpdate(pendingVersion);
    return;
  }
  btn.textContent = t('update.checking');
  try {
    versionInfo = await fetchVersionInfo();
    if (isNewer(versionInfo.version)) {
      pendingVersion = versionInfo.version;
      paintUpdateButton();
      btn.textContent = t('update.updating');
      await applyUpdate(pendingVersion);
    } else {
      // GitHub Pages caches version.json for up to 10 minutes, so "up to date"
      // can be stale right after a release — offer a forced refresh.
      btn.classList.add('ready');
      btn.textContent = t('update.uptodate');
      forceArmed = true;
      setTimeout(() => {
        if (!forceArmed) return;
        btn.textContent = t('update.force');
      }, 1800);
      setTimeout(() => { forceArmed = false; btn.classList.remove('ready'); paintUpdateButton(); }, 12000);
    }
  } catch {
    btn.textContent = t('update.offline');
    setTimeout(paintUpdateButton, 2500);
  }
}


// ---------- achievements sheet ----------
function openAchievements() {
  const area = $('ach-area');
  area.innerHTML = '';
  const have = unlocked();
  const lang = getLang();
  // earned first, so the sheet opens on what you have rather than what you lack
  const sorted = [...ACHIEVEMENTS].sort((a, b) => (have[b.id] ? 1 : 0) - (have[a.id] ? 1 : 0));
  for (const a of sorted) {
    const got = !!have[a.id];
    const l = a[lang] || a.en;
    const row = document.createElement('div');
    row.className = `ach-item ${got ? 'got' : 'locked'}`;
    const icon = document.createElement('div');
    icon.className = 'ach-icon';
    icon.textContent = a.icon;
    const text = document.createElement('div');
    text.className = 'ach-text';
    const name = document.createElement('div');
    name.className = 'ach-name';
    name.textContent = l.name;
    const desc = document.createElement('div');
    desc.className = 'ach-desc';
    desc.textContent = l.desc;
    text.appendChild(name);
    text.appendChild(desc);
    row.appendChild(icon);
    row.appendChild(text);
    area.appendChild(row);
  }
  show('screen-achievements');
}

// ---------- changelog ----------
async function openChangelog() {
  const area = $('changelog-area');
  area.innerHTML = '';
  if (!versionInfo) {
    try { versionInfo = await fetchVersionInfo(); } catch { versionInfo = cachedVersionInfo(); }
  }
  if (!versionInfo) {
    const p = document.createElement('p');
    p.className = 'settings-note';
    p.textContent = t('changelog.unavailable');
    area.appendChild(p);
  } else {
    const lang = getLang();
    for (const rel of versionInfo.releases || []) {
      const box = document.createElement('div');
      box.className = 'rel';
      const head = document.createElement('div');
      head.className = 'rel-head';
      const isCurrent = rel.version === currentVersion();
      head.innerHTML = `<span class="rel-ver${isCurrent ? ' current' : ''}">v${rel.version}</span>`;
      if (isCurrent) {
        const tag = document.createElement('span');
        tag.className = 'rel-date';
        tag.textContent = `${rel.date} · ${t('changelog.current')}`;
        head.appendChild(tag);
      } else {
        const d = document.createElement('span');
        d.className = 'rel-date';
        d.textContent = rel.date;
        head.appendChild(d);
      }
      const body = document.createElement('div');
      body.className = 'rel-body';
      const notes = rel[lang] || rel.en || {};
      for (const group of ['added', 'changed', 'fixed']) {
        const lines = notes[group] || [];
        if (!lines.length) continue;
        const g = document.createElement('div');
        g.className = `rel-group ${group}`;
        const h = document.createElement('h4');
        h.textContent = t(`changelog.${group}`);
        const ul = document.createElement('ul');
        for (const line of lines) {
          const li = document.createElement('li');
          li.textContent = line;
          ul.appendChild(li);
        }
        g.appendChild(h);
        g.appendChild(ul);
        body.appendChild(g);
      }
      box.appendChild(head);
      box.appendChild(body);
      area.appendChild(box);
    }
  }
  show('screen-changelog');
}

// ---------- service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // dev: no SW cache; drop any previously registered one
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    return;
  }

  // A page loaded just before a new worker takes over ends up mixing fresh HTML
  // with cached scripts. When the new worker claims this page, reload once so
  // every file comes from the same version.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || updateReloading) return;
    updateReloading = true;
    // never yank a session out from under the student — wait until they leave it
    if (sessionActive()) {
      reloadWhenIdle();
      return;
    }
    location.reload();
  });

  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline still fine on next visit */ });
}

boot();
