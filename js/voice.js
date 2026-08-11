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
  if (n < 10000) {
    // pilots read most numbers digit by digit or as "two thousand"
    if (n % 1000 === 0) return `${NUM_WORDS[n / 1000]} thousand`;
    if (n % 100 === 0 && n < 1000) return `${NUM_WORDS[n / 100]} hundred`;
    return String(n).split('').map(d => NUM_WORDS[d]).join(' ');
  }
  return String(n);
}

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[’'']/g, ' ')
    .replace(/(\d+)/g, (m) => ` ${m} ${numberToWords(m)} `)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(['and', 'or', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'then', 'as', 'at', 'is']);

function tokens(text) {
  return normalize(text).split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w));
}

// Score: fraction of target tokens present in what was heard.
export function matchScore(heard, target) {
  const t = tokens(target);
  if (!t.length) return 0;
  const h = new Set(tokens(heard));
  // digits already expanded to words on both sides
  const hits = t.filter(w => h.has(w)).length;
  return hits / t.length;
}

export function createRecognizer({ onResult, onState }) {
  if (!SR) return null;
  let rec = null;
  let active = false;

  function start() {
    if (active) return;
    rec = new SR();
    rec.lang = 'en-US';
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
