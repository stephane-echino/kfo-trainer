// Aircraft / flight conditions simulation.
//
// The conditions do not change the published procedure — they tell the student
// which documented variant applies today, and they drive the interactive
// controls (e.g. the throttle target after start is 1000 RPM, or 1200 RPM with
// a cold engine, exactly as printed on the checklist).
import { store } from './store.js';

export const CONDITIONS = [
  {
    id: 'engine',
    label: { en: 'Engine', fr: 'Moteur' },
    options: [
      { id: 'warm', label: { en: 'warm', fr: 'chaud' }, icon: '🔆' },
      { id: 'cold', label: { en: 'cold', fr: 'froid' }, icon: '❄️' },
    ],
  },
  {
    id: 'light',
    label: { en: 'Light', fr: 'Lumière' },
    options: [
      { id: 'day', label: { en: 'day', fr: 'jour' }, icon: '☀️' },
      { id: 'night', label: { en: 'night', fr: 'nuit' }, icon: '🌙' },
    ],
  },
  {
    id: 'runway',
    label: { en: 'Runway', fr: 'Piste' },
    options: [
      { id: 'dry', label: { en: 'dry', fr: 'sèche' }, icon: '🛬' },
      { id: 'wet', label: { en: 'wet', fr: 'mouillée' }, icon: '💧' },
    ],
  },
  {
    id: 'wind',
    label: { en: 'Wind', fr: 'Vent' },
    options: [
      { id: 'calm', label: { en: 'calm', fr: 'calme' }, icon: '🍃' },
      { id: 'crosswind', label: { en: 'crosswind', fr: 'travers' }, icon: '💨' },
    ],
  },
];

const DEFAULT = { engine: 'warm', light: 'day', runway: 'dry', wind: 'calm' };

export function getState() {
  return { ...DEFAULT, ...(store.getSettings().conditions || {}) };
}

export function setCondition(id, value) {
  const conditions = { ...getState(), [id]: value };
  store.setSettings({ ...store.getSettings(), conditions });
  return conditions;
}

export function cycleCondition(id) {
  const def = CONDITIONS.find(c => c.id === id);
  const cur = getState()[id];
  const i = def.options.findIndex(o => o.id === cur);
  return setCondition(id, def.options[(i + 1) % def.options.length].id);
}

export function randomize() {
  const conditions = {};
  for (const c of CONDITIONS) {
    conditions[c.id] = c.options[Math.floor(Math.random() * c.options.length)].id;
  }
  store.setSettings({ ...store.getSettings(), conditions });
  return conditions;
}

export function summary(lang = 'en') {
  const st = getState();
  return CONDITIONS.map(c => {
    const opt = c.options.find(o => o.id === st[c.id]) || c.options[0];
    return { id: c.id, icon: opt.icon, text: opt.label[lang] || opt.label.en, isDefault: opt.id === DEFAULT[c.id] };
  });
}

// ---------------------------------------------------------------------------
// Condition reminders attached to the steps they actually affect.
// Every line is traceable to a source document; `match` decides where it lands.
// ---------------------------------------------------------------------------
const HINTS = [
  {
    when: (s) => s.engine === 'cold',
    match: /AJUSTE 1000 RPM|SET 1000 RPM/i,
    phase: 'engine-start',
    en: 'Engine cold today → 1200 RPM, per the printed variant. AFM: sustain RPM with successive injections up to 900–1000 RPM in cold weather.',
    fr: 'Moteur froid aujourd\'hui → 1200 RPM, selon la variante imprimée. AFM : par temps froid, soutenir le régime par injections successives jusqu\'à 900 à 1000 tr/mn.',
  },
  {
    when: (s) => s.engine === 'cold',
    match: /INJECT|INJECTEZ/i,
    phase: 'engine-start',
    en: 'Cold engine: 2 or 3 injections, then throttle 1/4 forward (AFM normal start). A warm engine takes no injection at all.',
    fr: 'Moteur froid : 2 ou 3 injections puis manette 1/4 en avant (démarrage normal AFM). Moteur chaud : aucune injection.',
  },
  {
    when: (s) => s.engine === 'warm',
    match: /INJECT|INJECTEZ/i,
    phase: 'engine-start',
    en: 'Engine warm today → same procedure but WITHOUT injections (AFM).',
    fr: 'Moteur chaud aujourd\'hui → même procédure mais SANS injections (AFM).',
  },
  {
    when: (s) => s.light === 'night',
    match: /Lights|Feux|Landing and Taxi|atterissage et de roulage/i,
    // "Annunciator lights" and "Voyants lumineux" are panel warnings, not exterior lights
    exclude: /Annunciator|Voyants|Warning lights/i,
    en: 'Night flight → all exterior lights on; instrument panel lighting set (LIGHTING 1/2/3).',
    fr: 'Vol de nuit → tous les feux extérieurs allumés ; éclairage du tableau réglé (LIGHTING 1/2/3).',
  },
  {
    when: (s) => s.runway === 'wet',
    phase: 'before-takeoff',
    match: /briefing/i,
    en: 'Runway wet today → say "wet" in the conditions line of the briefing. The AFM publishes no wet-runway correction — its only surface correction is dry grass +15 % — so expect degraded braking and plan accordingly.',
    fr: 'Piste mouillée aujourd\'hui → annonce « mouillée » dans la ligne conditions du briefing. L\'AFM ne publie aucune correction piste mouillée — sa seule correction de surface est herbe sèche +15 % — donc freinage dégradé à prévoir.',
  },
  {
    when: (s) => s.wind === 'crosswind',
    phase: 'before-takeoff',
    match: /Flaps|Volets/i,
    en: 'Crosswind today → AFM crosswind take-off: flaps 1st notch, ailerons into wind, lift off slightly faster, max 15° bank near the ground. Demonstrated crosswind 22 kt.',
    fr: 'Vent de travers aujourd\'hui → AFM décollage vent de travers : volets 1er cran, ailerons dans le vent, décoller à une vitesse légèrement supérieure, inclinaison maxi 15° près du sol. Vent de travers démontré 22 kt.',
  },
  {
    when: (s) => s.wind === 'crosswind',
    phase: 'final',
    match: /Flaps|Volets/i,
    en: 'Crosswind today → AFM crosswind/gusty landing: flaps 1st notch (not full), approach 70 kt + half the gust value.',
    fr: 'Vent de travers aujourd\'hui → AFM atterrissage vent de travers ou fortes rafales : volets 1er cran (pas plein volets), approche 70 kt + 1/2 valeur rafale.',
  },
];

export function hintFor(step, lang = 'en') {
  const st = getState();
  const haystack = `${step.challenge || ''} ${step.answer || ''} ${step.prompt || ''} ${step.blockTitle || ''}`;
  for (const h of HINTS) {
    if (!h.when(st)) continue;
    if (h.phase && step.phase?.id !== h.phase) continue;
    if (h.match && !h.match.test(haystack)) continue;
    if (h.exclude && h.exclude.test(haystack)) continue;
    return h[lang] || h.en;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Interactive throttle control: parse the RPM target printed on the step.
// ---------------------------------------------------------------------------
export function rpmTarget(step) {
  // Only an actionable item gets a throttle to set. Prose blocks mention RPM
  // figures in passing and must never turn into a control.
  if (step.kind === 'note' || step.answerLong) return null;
  const text = step.answer || '';
  if (!/RPM|tr\/mn/i.test(text)) return null;

  // idle range, e.g. "RALENTI (600-650 rpm)"
  const range = /(\d{3,4})\s*[-–]\s*(\d{3,4})\s*(?:RPM|rpm|tr\/mn)/.exec(text);
  if (range) return { min: +range[1], max: +range[2], label: `${range[1]}–${range[2]} RPM` };

  // full power, e.g. "PLEIN GAZ (min 2200 RPM)"
  const min = /min\.?\s*(\d{3,4})\s*(?:RPM|rpm)/i.exec(text);
  if (min) return { min: +min[1], max: 2700, label: `≥ ${min[1]} RPM` };

  // conditional value, e.g. "AJUSTE 1000 RPM (1200 si moteur froid)"
  const cond = /(\d{3,4})\s*(?:RPM|rpm).{0,12}\((\d{3,4})\s*(?:RPM\s*)?(?:with engine cold|si moteur froid)/i.exec(text);
  if (cond) {
    const cold = getState().engine === 'cold';
    const v = cold ? +cond[2] : +cond[1];
    return { min: v - 50, max: v + 50, label: `${v} RPM`, exact: v };
  }

  const one = /(\d{3,4})\s*(?:RPM|rpm|tr\/mn)/.exec(text);
  if (one) {
    const v = +one[1];
    if (v < 500 || v > 2700) return null;
    return { min: v - 50, max: v + 50, label: `${v} RPM`, exact: v };
  }
  return null;
}
