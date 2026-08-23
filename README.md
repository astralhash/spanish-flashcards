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
  auto-picked, switchable with preview in Settings) and an opt-in **HD neural
  voice** — Piper models running fully in-browser (WASM), downloaded once
  (~60–120 MB, cached by the browser) then offline-capable. Falls back to
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

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/template.html` | page skeleton; `%%COUNT%%`-style markers replaced by the build |
| `src/style.css` | all styling |
| `src/core.cjs` | SRS + challenge logic (pure JS, also a CJS module) |
| `src/conj.cjs` | Spanish conjugation engine (templates + irregular tables) |
| `src/app.js` | UI layer (vanilla JS, no framework) |
| `src/tts.js` | HD neural TTS engine (Piper WASM via CDN, lazy-loaded) |
| `data/*.json` | vocabulary sources: arrays of `["spanish","english","level","cluster?"]` |
| `scripts/build.mjs` | merge + validate `data/*.json`, inject counts, emit `index.html` |
| `scripts/smoke.mjs` | unit tests for `core.cjs` |
| `scripts/conj-test.mjs` | battery of conjugation checks (`conj.cjs`) |
| `scripts/tests/e2e.mjs` | jsdom end-to-end test against the built `index.html` |
| `scripts/topup.mjs` | dev helper: fill level shortfalls from curated candidates |

See `agents.md` for the working conventions (data format, dedupe rules,
conjugation coverage, test commands).

## Test suite

```sh
node scripts/build.mjs            # must finish without SHORTFALL; rebuilds index.html
node scripts/smoke.mjs            # core SRS/challenge logic
node scripts/conj-test.mjs        # conjugation forms
node scripts/tests/e2e.mjs        # full UI flow in jsdom (needs: cd scripts/tests && npm i)
```
