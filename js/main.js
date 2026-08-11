// App shell: screen routing, home rendering, reference browser, settings.
import { loadModule, flattenSteps, combineNote } from './data.js';
import { store } from './store.js';
import { createTrainer } from './trainer.js';
import { createExaminer } from './examiner.js';
import { voiceSupported } from './voice.js';

const $ = (id) => document.getElementById(id);

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

async function boot() {
  try {
    mod = await loadModule('circuit');
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;text-align:center">Could not load flight data.<br>${e.message}</p>`;
    return;
  }
  steps = flattenSteps(mod);

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
  $('btn-update').addEventListener('click', checkForUpdates);
  $('btn-ref-back').addEventListener('click', () => show('screen-home'));
  $('btn-settings-back').addEventListener('click', () => show('screen-home'));

  $('app-version').textContent = `${mod.name} · module v${mod.version}`;

  renderHome();
  registerSW();
}

function startTrainer(seq) {
  const settings = store.getSettings();
  trainer.setVoicePref(settings.voice);
  requestWake();
  trainer.start(steps, seq);
  show('screen-trainer');
}

// ---------- home ----------
function renderHome() {
  const pos = store.getPosition('flight');
  const pct = steps.length ? Math.round((pos / steps.length) * 100) : 0;
  $('progress-flight').textContent = pos > 0 ? `resume · ${pct}%` : '';
  const missCount = Object.keys(store.getMisses()).length;
  $('progress-review').textContent = missCount ? `${missCount} to review` : '';

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
  div.innerHTML = `<button class="ref-phase-head"><span>Speeds — KIAS (MTOW)</span><span class="chev">›</span></button>`;
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
  $('voice-support-note').textContent = (voiceSupported
    ? 'Speech recognition detected in this browser. It needs network and a mic permission the first time.'
    : 'Speech recognition is NOT available in this browser. On iPhone, open the app in Safari itself to try it — the installed home-screen app usually cannot use the microphone for recognition.')
    + ' Note: if you use the app in a Safari tab (not installed), Safari may erase saved progress after ~7 days without a visit. The installed home-screen app keeps data reliably.';

  $('set-voice').onchange = (e) => save({ voice: e.target.checked });
  $('set-wakelock').onchange = (e) => save({ wakelock: e.target.checked });
  $('set-haptics').onchange = (e) => save({ haptics: e.target.checked });
  $('btn-reset-progress').onclick = () => { store.setPosition('flight', 0); store.resetPhaseDone(); flashBtn('btn-reset-progress'); };
  $('btn-reset-misses').onclick = () => { store.resetMisses(); flashBtn('btn-reset-misses'); };

  function save(patch) { store.setSettings({ ...store.getSettings(), ...patch }); }
  function flashBtn(id) { const b = $(id); const t = b.textContent; b.textContent = 'Done ✓'; setTimeout(() => { b.textContent = t; }, 1200); }
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
// The SW takes over immediately after install (skipWaiting + clients.claim),
// so a successful reg.update() with a new version fires 'controllerchange'.
let updateReloading = false;
async function checkForUpdates() {
  const btn = $('btn-update');
  btn.textContent = 'Checking…';
  try {
    if (!('serviceWorker' in navigator)) { location.reload(); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { location.reload(); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateReloading) return;
      updateReloading = true;
      btn.textContent = 'Updating…';
      btn.classList.add('ready');
      location.reload();
    });
    await reg.update();
    setTimeout(() => {
      if (updateReloading) return;
      if (reg.installing || reg.waiting) {
        btn.textContent = 'Update found — installing…';
        btn.classList.add('ready');
      } else {
        btn.textContent = 'Up to date ✓';
        setTimeout(() => { btn.textContent = '↻ Check for updates'; btn.classList.remove('ready'); }, 2500);
      }
    }, 3000);
  } catch {
    location.reload(); // worst case: plain reload still refreshes via network-first
  }
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
