# VocabES 🇪🇸

**European Spanish flashcard trainer (B1–C2)** — a single-file web app with SM-2
spaced repetition, cluster challenges, and full verb conjugation tables.

- **No dependencies, no build step for users**: `index.html` is a self-contained
  app (HTML + CSS + JS inlined). Open it in any browser, or serve it statically.
- **Data**: 2,000+ common European-Spanish words (currently 2,074: B1 830 · B2 607
  · C1 426 · C2 211), curated around real frequency lists.
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

- **Spaced repetition** — SM-2-style scheduling (again/hard/good/easy), daily
  new-card quota (default 20, adjustable 5–60), overdue-first sessions.
- **Cluster challenges** — timed multiple-choice bursts over word groups:
  weekdays, months, numbers, colors, family, food & drink, body, animals.
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
