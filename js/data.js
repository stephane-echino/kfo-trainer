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
export function flattenSteps(mod) {
  const steps = [];
  for (const phase of mod.phases) {
    for (const [bi, block] of phase.blocks.entries()) {
      const blockTitle = block.title || defaultBlockTitle(block.type);
      const push = (i, s) => steps.push({
        key: `${phase.id}/${bi}/${i}`,
        phase, blockTitle,
        kind: block.type,
        graded: block.type !== 'note',
        ...s,
      });

      if (block.type === 'checklist') {
        block.items.forEach((it, i) => push(i, {
          prompt: it.c,
          answer: it.r,
          note: it.note || null,
          sayTarget: `${it.c} ${it.r}`,
        }));
        if (block.closing) push('close', {
          kind: 'checklist',
          prompt: 'Close the check',
          answer: block.closing,
          note: null,
          sayTarget: block.closing,
        });
      } else if (block.type === 'flow' || block.type === 'briefing') {
        (block.steps || []).forEach((st, i) => push(i, {
          prompt: `Step ${i + 1} of ${block.steps.length} — what do you do?`,
          promptPre: i === 0 ? (block.intro || null) : null,
          answer: st.say ? st.say : st.do,
          answerLong: (st.say ? st.say : st.do).length > 60,
          note: st.say && st.do && st.say !== st.do ? st.do : (st.note || null),
          sayTarget: st.say || st.do,
        }));
      } else if (block.type === 'callout' || block.type === 'radio') {
        block.items.forEach((it, i) => push(i, {
          prompt: it.when,
          promptPre: block.type === 'radio' ? 'Radio call' : null,
          answer: it.say,
          answerLong: it.say.length > 60,
          note: it.note || null,
          sayTarget: it.say,
        }));
      } else if (block.type === 'note') {
        push(0, {
          prompt: block.title || 'Technique',
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

function defaultBlockTitle(type) {
  return { checklist: 'Checklist', flow: 'Memory flow', callout: 'Callouts', radio: 'Radio', briefing: 'Briefing', note: 'Technique' }[type] || '';
}
