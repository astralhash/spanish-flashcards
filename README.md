# VocabES 🇪🇸

**European Spanish flashcard trainer (B1–C2)** — a single-file web app with
spaced repetition (SM-2 + learning steps), typed & flashcard practice, cluster
challenges, and full verb conjugation tables.

- **No dependencies, no build step for users**: `index.html` is a self-contained
  app (HTML + CSS + JS inlined). Open it in any browser, or serve it statically.
- **Data**: 2,000+ common European-Spanish words (currently 2,494: B1 934 · B2 752
  · C1 540 · C2 268), curated around real frequency lists.
- **Progress**: everything is saved to `localStorage` of the browser — no accounts,
  no network.

## Try it

Build and open:

```sh
node scripts/build.mjs            # regenerates index.html from src/ + data/
python3 -m http.server 8000       # or: npx serve .
# open http://localhost:8000
```

## Features

- **Spaced repetition with learning steps** — new words walk short 1-min /
  10-min within-session steps before graduating to SM-2-style day intervals
  (again/hard/good/easy), daily new-card quota (default 20, adjustable 5–60),
  overdue-first sessions.
- **Answer style: Type / Mixed / Flashcard** (main menu) —
  - **Typed recall (default)** — write your answer instead of recognizing it;
    accent- and article-tolerant matching, accepts conjugated forms of target
    verbs. Right answers show a green reveal; wrong answers and peeks show
    the correct pair prominently (`question = answer`). Every typed outcome
    holds on screen and clears question/input/buttons until you click, press
    Space or Enter. Research (the generation effect) shows production beats
    recognition for long-term retention.
  - **Mixed** — randomly alternates typed and flashcard rounds within one run
    (format marked with ✏️ / 🃏).
  - **Flashcard** — flip card plus an optional 4-option *pretest* for new
    words (errorful generation), then self-graded reveal.
- **Pronunciation** — 🔊 buttons/chips and the <kbd>S</kbd> key speak Spanish on
  demand; optionally every word is spoken automatically as it is revealed
  (Settings). Two engines: ranked system voices (best installed voice
  auto-picked, switchable with preview in Settings) and opt-in **HD neural
  voices** — Kokoro-82M, Supertonic 3 or Piper models running fully
  in-browser, downloaded once (~20–380 MB depending on voice, cached) then
  offline-capable. Accent trade-offs (natural-but-Latin vs. authentic-Spain
  vs. studio-neutral) are labeled in the voice dropdown. Falls back to
  system speech automatically. Space always advances to the next word, even
  right after using a speaker button.
- **Cluster challenges** — multiple-choice or typed bursts over word groups:
  weekdays, months, numbers, colors, family, food & drink, body, animals.
  Missed items are re-asked in a replay round, and every challenge ends with
  a "words to watch" recap.
- **Session recap** — missed words are listed after each session with a
  one-click "practice these now" re-run.
- **Conjugation tables** — hover any verb to see 7 tenses + imperatives
  (European Spanish, incl. `vosotros`), generated from `src/conj.cjs`.
- **Import** — add your own words in Settings (JSON array or `es | en | level | cluster` lines).
- **Stats & themes** — XP, streaks, review counts; light/dark theme.

## Offline audio package (optional)

Supertonic is the highest-quality HD voice tier, but its in-browser "pre-heat"
re-runs the ~380 MB model on every word, which is slow. If you want the whole
deck's audio available instantly and offline, you can pre-synthesize it once
**outside** the browser and import the finished package:

```sh
npm --prefix scripts/tts-package i    # once: installs onnxruntime-node
node scripts/tts-package/build.mjs    # -> audio/  (Supertonic F2 @ 1.00)
```

Then in the app: Settings → HD voice → pick a Supertonic voice → **📦 Load audio
package** → select the generated `audio/` folder. The import auto-switches the
voice/rate selection to match the package, so the cached audio applies
immediately and every word plays with no model load.

**Other voices / rates:** a package only matches the exact voice + rate it was
built with, so build one for the voice you actually want:

```sh
node scripts/tts-package/build.mjs --voice M1 --rate 0.92 --out /tmp/audio-M1
```

The tool takes any Supertonic voice (`F1`–`F5`, `M1`–`M5`) and any rate
(0.7–2.0). It shares one ~380 MB model download cached in
`scripts/tts-package/.cache/`, so a second voice only re-runs the synthesis.
If you later switch to a voice with no matching package, the UI warns you that
words will be synthesized on demand again — build and import a package for that
voice to cache it.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/template.html` | page skeleton; `%%COUNT%%`-style markers replaced by the build |
| `src/style.css` | all styling |
| `src/core.cjs` | SRS + challenge logic (pure JS, also a CJS module) |
| `src/conj.cjs` | Spanish conjugation engine (templates + irregular tables) |
| `src/app.js` | UI layer (vanilla JS, no framework) |
| `src/tts.js` | HD neural TTS engines (Kokoro / Supertonic 3 / Piper, all lazy-loaded from CDN) |
| `data/*.json` | vocabulary sources: arrays of `["spanish","english","level","cluster?"]` |
| `scripts/build.mjs` | merge + validate `data/*.json`, inject counts, emit `index.html` |
| `scripts/smoke.mjs` | unit tests for `core.cjs` |
| `scripts/conj-test.mjs` | battery of conjugation checks (`conj.cjs`) |
| `scripts/tests/e2e.mjs` | jsdom end-to-end test against the built `index.html` |
| `scripts/topup.mjs` | dev helper: fill level shortfalls from curated candidates |
| `scripts/tts-package/build.mjs` | offline builder: pre-synthesize all words as Opus (Supertonic via onnxruntime-node + ffmpeg) |

See `agents.md` for the working conventions (data format, dedupe rules,
conjugation coverage, test commands).

## Test suite

```sh
node scripts/build.mjs            # must finish without SHORTFALL; rebuilds index.html
node scripts/smoke.mjs            # core SRS/challenge logic
node scripts/conj-test.mjs        # conjugation forms
node scripts/tests/e2e.mjs        # full UI flow in jsdom (needs: cd scripts/tests && npm i)
```
