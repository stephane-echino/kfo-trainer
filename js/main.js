// App shell: screen routing, home rendering, reference browser, settings.
import { loadModule, flattenSteps, combineNote } from './data.js';
import { store } from './store.js';
import { createTrainer } from './trainer.js';
import { createExaminer } from './examiner.js';
import { voiceSupported } from './voice.js';
import { t, setLang, getLang } from './i18n.js';
import { APP_VERSION } from './version.js';
import { fetchVersionInfo, isNewer, applyUpdate, currentVersion } from './updates.js';
import { dayStreak } from './fx.js';

const $ = (id) => document.getElementById(id);

const MODULE_FOR_LANG = { en: 'circuit', fr: 'circuit-fr' };

let mod = null;
let steps = [];
let trainer = null;
let examiner = null;
let wakeLock = null;

function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
  if (screenId === 'screen-home') renderHome();
  window.scrollTo(0, 0);
}

// Applies every data-i18n / data-i18n-small binding in the static markup.
function applyStaticStrings() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const smallKey = el.dataset.i18nSmall;
    el.textContent = t(el.dataset.i18n);
    if (smallKey) {
      const small = document.createElement('small');
      small.textContent = t(smallKey);
      el.appendChild(small);
    }
  }
}

function includeMap() {
  const s = store.getSettings();
  return {
    checklist: s.incChecklists, flow: s.incFlows, callout: s.incCallouts,
    radio: s.incRadio, briefing: s.incBriefings, note: s.incNotes,
  };
}

async function loadContent() {
  const id = MODULE_FOR_LANG[getLang()] || 'circuit';
  try {
    mod = await loadModule(id);
  } catch {
    if (id !== 'circuit') mod = await loadModule('circuit'); // FR module missing → fall back
    else throw new Error('missing content');
  }
  rebuildSteps();
}

function rebuildSteps() {
  steps = flattenSteps(mod, includeMap());
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
      else if (mode === 'examiner') { requestWake(); examiner.start(mod, steps); show('screen-examiner'); }
      else if (mode === 'reference') { renderReference(); show('screen-reference'); }
    });
  });
  $('btn-settings').addEventListener('click', () => { renderSettings(); show('screen-settings'); });
  $('btn-update').addEventListener('click', onUpdateClick);
  $('app-version').addEventListener('click', openChangelog);
  $('btn-ref-back').addEventListener('click', () => show('screen-home'));
  $('btn-settings-back').addEventListener('click', () => show('screen-home'));
  $('btn-changelog-back').addEventListener('click', () => show('screen-home'));

  renderVersionLine();
  renderHome();
  registerSW();
  checkOnLaunch();
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
  renderSettings();
  renderHome();
}

function startTrainer(seq) {
  const settings = store.getSettings();
  trainer.setVoicePref(settings.voice);
  requestWake();
  trainer.start(steps, seq);
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

function renderHome() {
  renderStats();
  const pos = store.getPosition('flight');
  const pct = steps.length ? Math.round((pos / steps.length) * 100) : 0;
  $('progress-flight').textContent = pos > 0 ? t('home.resume', pct) : '';
  const missCount = Object.keys(store.getMisses()).length;
  $('progress-review').textContent = missCount ? t('home.toReview', missCount) : '';

  const done = store.getPhaseDone();
  const currentPhase = steps[pos]?.phase.id;
  const chips = $('phase-chips');
  chips.innerHTML = '';
  for (const phase of mod.phases) {
    const btn = document.createElement('button');
    btn.className = 'phase-chip';
    if (done[phase.id]) btn.classList.add('done');
    if (phase.id === currentPhase) btn.classList.add('current');
    btn.textContent = phase.title;
    btn.addEventListener('click', () => {
      const settings = store.getSettings();
      trainer.setVoicePref(settings.voice);
      requestWake();
      trainer.start(steps, `phase:${phase.id}`);
      show('screen-trainer');
    });
    chips.appendChild(btn);
  }
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
        block.items.forEach((it, i) => b.appendChild(refItem(`${i + 1}. ${it.c}`, it.r, it.note)));
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

function refItem(c, r, note) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'ref-item';
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
  div.querySelector('.ref-phase-head').addEventListener('click', () => div.classList.toggle('open'));
  const body = document.createElement('div');
  body.className = 'ref-phase-body';
  const b = document.createElement('div');
  b.className = 'ref-block';
  for (const s of mod.speeds || []) b.appendChild(refItem(`${s.code}${s.label ? ` — ${s.label}` : ''}`, `${s.kias}`));
  body.appendChild(b);
  div.appendChild(body);
  return div;
}

// ---------- settings ----------
function renderSettings() {
  const s = store.getSettings();
  $('set-voice').checked = s.voice && voiceSupported;
  $('set-voice').disabled = !voiceSupported;
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
  $('set-wakelock').onchange = (e) => save({ wakelock: e.target.checked });
  $('set-haptics').onchange = (e) => save({ haptics: e.target.checked });
  $('btn-reset-progress').onclick = () => { store.setPosition('flight', 0); store.resetPhaseDone(); flashBtn('btn-reset-progress'); };
  $('btn-reset-misses').onclick = () => { store.resetMisses(); flashBtn('btn-reset-misses'); };
  $('btn-reset-stats').onclick = () => { store.resetStats(); renderStats(); flashBtn('btn-reset-stats'); };

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
  const inSession = $('screen-trainer').classList.contains('active') || $('screen-examiner').classList.contains('active');
  if (document.visibilityState === 'visible' && inSession) requestWake();
});

// ---------- updates ----------
let versionInfo = null;      // parsed version.json (also feeds the changelog)
let pendingVersion = null;   // newer version available on the server

// Silent check on launch: only paints the button, never interrupts.
async function checkOnLaunch() {
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

async function onUpdateClick() {
  const btn = $('btn-update');
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
      btn.classList.add('ready');
      btn.textContent = t('update.uptodate');
      setTimeout(() => { btn.classList.remove('ready'); paintUpdateButton(); }, 2500);
    }
  } catch {
    btn.textContent = t('update.offline');
    setTimeout(paintUpdateButton, 2500);
  }
}

// ---------- changelog ----------
async function openChangelog() {
  const area = $('changelog-area');
  area.innerHTML = '';
  if (!versionInfo) {
    try { versionInfo = await fetchVersionInfo(); } catch { /* handled below */ }
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
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline still fine on next visit */ });
}

boot();
