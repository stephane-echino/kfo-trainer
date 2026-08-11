# KFO Trainer — DR400 Chair Flying

Offline-first PWA to memorize the checklists, flows, callouts and procedures of the
Robin DR400 **HB-KFO** (GVMN), in English or French.

**How it works:** the app walks you through a complete flight, one step at a time.
Say the step **out loud**, tap to reveal, grade yourself, tap for the next one.
Missed steps are collected for targeted review, and accuracy is tracked per phase
so you can see what to work on.

Live: <https://stephane-echino.github.io/kfo-trainer/> — open it in Safari on iPhone
and add it to the home screen; it then runs fully offline.

## Modes

- **Full flight** — the whole flight, step by step, with the circuit map
- **Examiner** — random questions: speeds, memory flows, marked-item recitation,
  spoken call-outs, failure scenarios. Checklist items are never asked by position:
  in the aircraft a checklist is read, not recalled from memory.
- **Marked items** — the checklist items carrying a bar in the PDF margin, in printed order
- **Review misses** — replays only what you marked as missed
- **Reference** — every checklist, flow, callout and speed, searchable

Flight conditions (engine warm/cold, day/night, dry/wet, calm/crosswind) change what
the app expects: with a cold engine the throttle target after start is 1200 RPM, not 1000.

## Content

Content lives in `data/modules/*.json`, separate from the code. A *course* is a body
of content with an English and a French module; the home screen offers a switcher as
soon as a second course ships. Progress, misses and per-phase accuracy are stored per
course.

| Course | Files | State |
|---|---|---|
| Circuit | `circuit.json`, `circuit-fr.json` | 25 phases, full flight |
| Emergencies | `emergency.json`, `emergency-fr.json` | in preparation |

Sources: GVMN checklist EN V9 / FR V10, GVMN SOP and Takeoff Briefing, AFM HB-KFO,
SPHAIR Bases & Procedures. Checklist items are verbatim from the official checklists.
Published call-outs stay in English in both languages, because that is what is spoken
in the cockpit. Every figure is traceable to a source document — none are invented.

The source PDFs are **not** in this repository and must not be added: they belong to
the club and to SPHAIR.

## Data schema

```jsonc
{
  "id": "circuit", "name": "…", "version": "1.0.0", "aircraft": "HB-KFO",
  "speeds":   [{ "code": "Vr", "kias": "54", "label": "rotation", "unit": "kt" }],
  "examiner": [{ "q": "…", "a": "…", "tag": "…" }],
  "phases": [{
    "id": "engine-start", "title": "…", "subtitle": "…",
    "map": { "point": "parking", "altFt": 1000 },   // point: see js/circuit.js
    "context": [{ "k": "Starter", "v": "max 30 s" }],
    "blocks": [
      { "type": "checklist", "title": "…", "source": "Checklist EN V9",
        "items": [{ "c": "challenge", "r": "RESPONSE",
                    "note": "…", "mem": true, "spoken": "what you actually say" }],
        "closing": "… CHECK COMPLETED" },
      { "type": "flow",     "source": "SOP GVMN", "intro": "…",
        "steps": [{ "do": "…", "say": "ROTATE", "note": "…" }] },
      { "type": "callout",  "source": "…", "items": [{ "when": "…", "say": "…" }] },
      { "type": "radio",    "source": "…", "items": [{ "when": "…", "say": "…" }] },
      { "type": "briefing", "source": "…", "steps": [ /* like flow */ ] },
      { "type": "note",     "source": "…", "text": "…" }
    ]
  }]
}
```

`mem: true` marks an item the student must know from memory. In the circuit course
that means a bar in the checklist margin; in the emergency course, a vital action.

## Development

No build step — plain HTML/CSS/JS modules:

```bash
python3 -m http.server 8400
```

The service worker is disabled on `localhost`, so you always get fresh files.
Note that browsers cache ES modules per URL: reloading the page is not always enough,
re-fetch them with `cache: 'reload'` or use a private window.

## Deploy ritual

Three files must be bumped **together**, or the in-app updater lies:

1. `js/version.js` — `APP_VERSION`
2. `sw.js` — `VERSION` (invalidates the offline cache)
3. `version.json` — `version`, plus a release entry in both languages

Then push to `main`; GitHub Pages builds in a minute or two, and its CDN serves the
new files within ten minutes. In the app, the version line at the bottom of the home
screen opens the release notes, and the button under it installs a new version — tap
it twice to force a refresh if the CDN is still serving the old `version.json`.

---

**Training aid only — not for operational use. Always fly per your club's current documents.**
