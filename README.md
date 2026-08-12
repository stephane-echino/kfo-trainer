# KFO Trainer — DR400 Chair Flying

Offline-first PWA to memorize the checklists, flows, callouts and procedures of the
Robin DR400 **HB-KFO** (GVMN), in English or French.

**How it works:** the app walks you through a complete flight, one step at a time.
Say the step **out loud**, tap to reveal, grade yourself, tap for the next one.

Grading is deliberate: tapping past a card advances without claiming you knew it.
Only the ✓/✗ buttons earn XP and schedule the step, so the cheapest gesture cannot
inflate your progress. Every graded answer feeds a spaced-repetition schedule
(1, 2, 4, 8, 16 days; a miss comes back the same day), and the home screen shows
one honest number — **ready for the flight** — averaging how far each step has
climbed that ladder.

Live: <https://stephane-echino.github.io/kfo-trainer/> — open it in Safari on iPhone
and add it to the home screen; it then runs fully offline.

## Modes

- **Full flight** — the whole flight, step by step, with the circuit map
- **Examiner** — random questions: speeds, memory flows, marked-item recitation,
  spoken call-outs, failure scenarios, and checklist items asked the way an
  instructor asks them — challenge, you give the response. Never by position: in
  the aircraft a checklist is read, not recalled from a rank. Challenges that
  repeat inside one check with different responses (the throttle is set three
  times during the run-up) are excluded, having no single right answer out of
  context. Three failure scenarios are guaranteed per draw.
- **Marked items / Vital actions** — the checklist items carrying a bar in the PDF
  margin (or, in the emergency course, the actions done from memory), in printed
  order and timed against your own best
- **Daily review** — whatever the spaced-repetition schedule says is due today,
  weakest boxes first. Vital actions cap at the 16-day box so they never leave it.
- **Reference** — every checklist, flow, callout and speed, searchable

Two aids sit on every card: **? clue** returns the challenge (or the opening words
of a call-out) so you can still retrieve the answer yourself — worth less XP — and
🎧 **hands-free** turns the session into challenge and response: the app reads the
challenge, waits for you to answer aloud, reads the item back, and moves on.
Optional speech reads the answer when you reveal it, in the language of the step.

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
| Emergencies | `emergency.json`, `emergency-fr.json` | 18 phases, AFM §3 + SPHAIR |

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

**Step keys are position-derived** (`phaseId/blockIndex/itemIndex`), so editing a
module would hand one item's review history to another. Bump the module's `version`
whenever you change its content: the app stamps it and restarts that course's
schedule rather than certifying mastery on the wrong line.

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
