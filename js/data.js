import { t } from './i18n.js';

// Module loading and flattening into a linear list of trainer steps.
//
// Data schema (data/modules/*.json):
// {
//   id, name, version, aircraft,
//   speeds: [{code, kias, label}],
//   examiner: [{q, a, tag}],          // extra scenario questions
//   phases: [{
//     id, title, subtitle?, optional?,
//     map: {point, altFt},            // point: named anchor in circuit.js
//     context: [{k, v}],              // chips shown under the phase title
//     blocks: [
//       {type:'checklist', title, source, items:[{c, r, note?}], closing?}
//       {type:'flow',      title, source, steps:[{do, say?, note?}]}
//       {type:'callout',   title?, source, items:[{when, say, note?}]}
//       {type:'radio',     title?, source, items:[{when, say, note?}]}
//       {type:'briefing',  title, source, intro?, steps:[{do, say?, note?}]}
//       {type:'note',      title?, source, text}
//     ]
//   }]
// }

export async function loadModule(id) {
  const res = await fetch(`./data/modules/${id}.json`);
  if (!res.ok) throw new Error(`Cannot load module ${id}`);
  return res.json();
}

// One trainer step = one tap-to-reveal unit.
// {key, phase, block, kind, prompt, promptPre, answer, answerLong, note, sayTarget, graded}
//
// `include` filters block types out of training (Settings → what to train).
export function flattenSteps(mod, include = null) {
  const wanted = (type) => !include || include[type] !== false;
  const steps = [];
  for (const phase of mod.phases) {
    for (const [bi, block] of phase.blocks.entries()) {
      if (!wanted(block.type)) continue;
      const blockTitle = block.title || defaultBlockTitle(block.type);
      const push = (i, s) => steps.push({
        key: `${phase.id}/${bi}/${i}`,
        phase, blockTitle,
        kind: block.type,
        source: block.source || null,
        // published English wording can sit inside a French module (GVMN
        // briefing lines, SPHAIR call-outs) — speech follows this, not the UI
        lang: block.lang || null,
        graded: block.type !== 'note',
        ...s,
      });

      if (block.type === 'checklist') {
        // announce which check is starting…
        push('open', {
          prompt: t('prompt.whichCheck'),
          answer: blockTitle,
          note: null,
          sayTarget: blockTitle,
        });
        // …then recall each item in full: number + challenge + response
        const n = block.items.length;
        block.items.forEach((it, i) => push(i, {
          prompt: t('prompt.item', i + 1, n),
          answer: `${i + 1}. ${it.c} — ${it.r}`,
          answerLong: (it.c.length + it.r.length) > 55,
          note: it.note || null,
          sayTarget: `${it.c} ${it.r}`,
          challenge: it.c,
          response: it.r,
          spoken: it.spoken || null,
          mem: !!it.mem,
          num: i + 1,
        }));
        if (block.closing) push('close', {
          kind: 'checklist',
          prompt: t('prompt.close'),
          answer: block.closing,
          note: null,
          sayTarget: block.closing,
        });
      } else if (block.type === 'flow' || block.type === 'briefing') {
        (block.steps || []).forEach((st, i) => push(i, {
          prompt: t('prompt.flowStep', i + 1, block.steps.length),
          promptPre: i === 0 ? (block.intro || null) : null,
          answer: st.say ? st.say : st.do,
          answerLong: (st.say ? st.say : st.do).length > 60,
          note: combineNote(st),
          sayTarget: st.say || st.do,
          lang: st.lang || block.lang || null,
        }));
      } else if (block.type === 'callout' || block.type === 'radio') {
        block.items.forEach((it, i) => push(i, {
          prompt: it.when,
          promptPre: block.type === 'radio' ? t('prompt.radio') : null,
          answer: it.say,
          answerLong: it.say.length > 60,
          note: it.note || null,
          sayTarget: it.say,
          lang: it.lang || block.lang || null,
        }));
      } else if (block.type === 'note') {
        push(0, {
          prompt: block.title || t('kind.note'),
          answer: block.text,
          answerLong: true,
          note: null,
          sayTarget: null,
        });
      }
    }
  }
  return steps;
}

// For flow/briefing steps where "say" is the answer, keep the action ("do")
// visible as a note — and never drop an authored note.
export function combineNote(st) {
  const doDiffers = st.say && st.do && st.say !== st.do;
  if (doDiffers) return st.note ? `${st.do} — ${st.note}` : st.do;
  return st.note || null;
}

function defaultBlockTitle(type) {
  return t(`block.${type}`) || '';
}
