# KFO Trainer — DR400 Chair Flying

Offline-first PWA to memorize the checklists, flows, callouts and procedures of the
Robin DR400 **HB-KFO** (GVMN) — built for PPL chair-flying practice.

**How it works:** the app walks you through a complete flight (preflight → circuit →
shutdown), one step at a time. Say the step **out loud**, tap to reveal the answer,
grade yourself, tap for the next step. Missed steps are collected for targeted review.

## Modes

- **Full flight** — the complete circuit flight, step by step, with a circuit mini-map
- **Examiner** — random questions: speeds, next-step, recite-a-check, failure scenarios
- **Review misses** — replays only what you marked as missed
- **Reference** — browse every checklist, flow, callout and the speed table

## Content versions

Content lives in `data/modules/*.json`, separate from the code:

- **V1 — `circuit.json`**: full circuit flight (this version)
- V2 (planned): emergencies & abnormal procedures
- V3 (planned): radio phraseology, steep turns, high/low circuits
- V4 (planned): flight preparation, weight & balance

Sources: GVMN checklist EN V9 / FR V10, GVMN SOP & Takeoff Briefing, AFM HB-KFO,
SPHAIR Bases & Procedures. Checklist items are verbatim from the official EN checklist.

## Development

No build step — plain HTML/CSS/JS modules. Serve the folder and open it:

```bash
python3 -m http.server 8400
```

The service worker is disabled on `localhost` so you always see fresh files.
When deploying, bump `VERSION` in `sw.js` so installed apps pick up the update.

---

**Training aid only — not for operational use. Always fly per your club's current documents.**
