// Experimental voice check — Web Speech API, English.
// iOS caveat: SpeechRecognition often works in Safari tabs but not in
// installed (standalone) PWAs, and needs network. Tap flow always works.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = !!SR;

const NUM_WORDS = {
  0:'zero',1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',
  10:'ten',11:'eleven',12:'twelve',13:'thirteen',14:'fourteen',15:'fifteen',16:'sixteen',
  17:'seventeen',18:'eighteen',19:'nineteen',20:'twenty',30:'thirty',40:'forty',50:'fifty',
  60:'sixty',70:'seventy',80:'eighty',90:'ninety',
};

function numberToWords(n) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) return '';
  if (n in NUM_WORDS) return NUM_WORDS[n];
  if (n < 100) {
    const t = Math.floor(n / 10) * 10, u = n % 10;
    return `${NUM_WORDS[t]} ${NUM_WORDS[u]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return `${NUM_WORDS[h]} hundred${r ? ` ${numberToWords(r)}` : ''}`;
  }
  if (n < 100000) {
    const th = Math.floor(n / 1000), r = n % 1000;
    return `${numberToWords(th)} thousand${r ? ` ${numberToWords(r)}` : ''}`;
  }
  return String(n);
}

// Pilots say the same figure several ways: 1200 is "one thousand two hundred"
// or "twelve hundred"; a runway or a code is read digit by digit. Any of them
// must satisfy the value.
function enVariants(n) {
  const v = new Set([numberToWords(n)]);
  if (n >= 1000 && n < 10000 && n % 100 === 0) v.add(`${numberToWords(n / 100)} hundred`);
  v.add(String(n).split('').map(d => NUM_WORDS[d]).join(' '));
  return [...v].filter(Boolean);
}

const FR_ORDINALS = { 1: 'premier', 2: 'deuxieme', 3: 'troisieme' };
const EN_ORDINALS = { 1: 'first', 2: 'second', 3: 'third' };

const FR_WORDS = {
  0:'zero',1:'un',2:'deux',3:'trois',4:'quatre',5:'cinq',6:'six',7:'sept',8:'huit',9:'neuf',
  10:'dix',11:'onze',12:'douze',13:'treize',14:'quatorze',15:'quinze',16:'seize',
  20:'vingt',30:'trente',40:'quarante',50:'cinquante',60:'soixante',
};

function frNumberToWords(n) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) return '';
  if (n in FR_WORDS) return FR_WORDS[n];
  // French has no word for 70, 80 or 90: 70-79 is soixante + 10..19,
  // 80-99 is quatre-vingt + 0..19. A plain tens+units table gets these wrong.
  if (n < 70) {
    const t = Math.floor(n / 10) * 10, u = n % 10;
    return `${FR_WORDS[t] || ''} ${FR_WORDS[u] || ''}`.trim();
  }
  if (n < 80) return `soixante ${frNumberToWords(n - 60)}`.trim();
  if (n < 100) return n === 80 ? 'quatre vingts' : `quatre vingt ${frNumberToWords(n - 80)}`.trim();
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    const head = h === 1 ? 'cent' : `${FR_WORDS[h]} cent${r ? '' : 's'}`;
    return r ? `${head} ${frNumberToWords(r)}` : head;
  }
  if (n < 100000) {
    const th = Math.floor(n / 1000), r = n % 1000;
    const head = th === 1 ? 'mille' : `${frNumberToWords(th)} mille`;
    return r ? `${head} ${frNumberToWords(r)}` : head;
  }
  return String(n);
}

function frVariants(n) {
  const v = new Set([frNumberToWords(n)]);
  // "six cent" is also heard without the plural s
  v.add(frNumberToWords(n).replace(/cents\b/g, 'cent'));
  v.add(String(n).split('').map(d => FR_WORDS[d]).join(' '));
  return [...v].filter(Boolean);
}

// ICAO says the digits differently on the radio: niner, tree, fife. Fold them
// onto the plain words so a correct read-back is not penalised.
const ICAO = [[/\bniner\b/g, 'nine'], [/\btree\b/g, 'three'], [/\bfife\b/g, 'five'], [/\bzeero\b/g, 'zero']];

function normalize(text, lang = 'en') {
  let out = (text || '').toLowerCase();
  for (const [re, w] of ICAO) out = out.replace(re, w);
  return out
    // strip accents first: the a-z filter below would otherwise split
    // "réchauffage" into "r chauffage"
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'']/g, ' ')
    // checklist ordinals: "1er CRAN" is said "premier", "1st NOTCH" is "first"
    .replace(/\b(\d)\s*(?:er|eme|me|e|st|nd|rd|th)\b/g,
      (_, d) => ` ${(lang === 'fr' ? FR_ORDINALS : EN_ORDINALS)[d] || d} `)
    .replace(/(\d+)/g, (m) => ` ${m} ${lang === 'fr' ? frNumberToWords(m) : numberToWords(m)} `)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 'on' is deliberately NOT a stopword: for ten checklist items the entire
// response is ON, and dropping it made "alternator off" score 100%.
const STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'to', 'of', 'in', 'for', 'with', 'then', 'as', 'at', 'is',
  'et', 'ou', 'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'dans', 'sur', 'pour', 'avec', 'puis', 'au', 'aux', 'est',
]);

function tokens(text, lang = 'en') {
  return normalize(text, lang).split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w));
}

// A flap notch, an RPM, a side or an ordinal carries the meaning; the rest is
// grammar. If the target demands one and it is absent from what was heard, the
// answer is wrong however many other words matched — saying "flaps two" for
// FLAPS 1, or "left" for "right side clear", is exactly what this mode exists
// to catch.
const KEY_WORDS = ['left', 'right', 'gauche', 'droite', 'on', 'off',
  ...Object.values(FR_ORDINALS), ...Object.values(EN_ORDINALS)];

const has = (norm, w) => new RegExp(`(^| )${w}( |$)`).test(norm);

// Every token that can carry a numeric value, so a word form is not matched
// inside a bigger number: "mille" must not satisfy 1000 inside "deux mille".
const NUMBER_TOKENS = new Set([
  ...Object.values(NUM_WORDS), 'hundred', 'thousand',
  ...Object.values(FR_WORDS), 'cent', 'cents', 'mille',
]);

const isNumberToken = (w) => NUMBER_TOKENS.has(w) || /^\d+$/.test(w);

function hasNumberWords(norm, words) {
  const m = new RegExp(`(^| )${words}( |$)`).exec(norm);
  if (!m) return false;
  // the phrase must be the whole number, not a slice of a bigger one:
  // "mille" is not 1000 inside "deux mille" nor inside "mille deux cents"
  const before = norm.slice(0, m.index).trim().split(' ').pop() || '';
  const after = norm.slice(m.index + m[0].length).trim().split(' ')[0] || '';
  return !isNumberToken(before) && !isNumberToken(after);
}

function requiredValuesPresent(heardNorm, targetNorm, target, lang) {
  // Figures quoted in parentheses are reference values printed on the
  // checklist, not part of what the pilot says: "CONTROLES (baisse max 175 -
  // diff max 50)" is answered "contrôlés". Requiring them rejected correct
  // answers outright.
  const core = String(target).replace(/\([^)]*\)/g, ' ');
  // numbers may be heard as digits or as any spoken form: accept any of them.
  // An ordinal ("2me CRAN", "1st NOTCH") is not the cardinal — normalize() has
  // already turned it into a word and KEY_WORDS checks it.
  for (const m of core.matchAll(/\d+(?!\s*(?:er|eme|me|e|st|nd|rd|th)\b)/gi)) {
    const n = m[0];
    if (has(heardNorm, n)) continue;
    const variants = lang === 'fr' ? frVariants(n) : enVariants(n);
    if (!variants.some(w => hasNumberWords(heardNorm, w))) return false;
  }
  for (const w of KEY_WORDS) {
    if (has(targetNorm, w) && !has(heardNorm, w)) return false;
  }
  return true;
}

// Score: fraction of target tokens present in what was heard — but zero as soon
// as a value the target requires is missing.
export function matchScore(heard, target, lang = 'en') {
  const short = lang.slice(0, 2);
  // score against the spoken core: a parenthesis on the checklist is a printed
  // reference ("CONTROLES (baisse max 175 - diff max 50)"), not words to recite
  const core = String(target).replace(/\([^)]*\)/g, ' ').trim() || String(target);
  const t = tokens(core, short);
  if (!t.length) return 0;

  const heardNorm = normalize(heard, short);
  const targetNorm = normalize(core, short);
  if (!requiredValuesPresent(heardNorm, targetNorm, target, short)) return 0;

  const h = new Set(tokens(heard, short));
  const hits = t.filter(w => h.has(w)).length;
  return hits / t.length;
}

export function createRecognizer({ onResult, onState }) {
  if (!SR) return null;
  let rec = null;
  let active = false;

  // Published callouts are spoken in English even when the checklist is the
  // French one, so the recogniser follows the step, not just the app language.
  function start(lang = 'en-US') {
    if (active) return;
    rec = new SR();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    active = true;
    onState('listening');

    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (const r of e.results) {
        if (r.isFinal) finalText += ` ${r[0].transcript}`;
        else interim += ` ${r[0].transcript}`;
      }
      onResult({ text: (finalText || interim).trim(), final: !!finalText });
    };
    rec.onerror = () => { active = false; onState('error'); };
    rec.onend = () => { active = false; onState('idle'); };
    try { rec.start(); } catch { active = false; onState('error'); }
  }

  function stop() {
    if (rec && active) { try { rec.stop(); } catch { /* noop */ } }
    active = false;
  }

  return { start, stop, get active() { return active; } };
}
