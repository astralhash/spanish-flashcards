# agents.md — working guide for AI agents & contributors

VocabES: single-file European-Spanish flashcard app. `index.html` is the built
artifact — never edit it directly; edit `src/*` and `data/*`, then run
`node scripts/build.mjs`.

## Quick commands (repo root)

```sh
node scripts/build.mjs              # validate data, merge, inline -> index.html (fails on SHORTFALL)
node scripts/smoke.mjs              # core logic unit tests
node scripts/conj-test.mjs          # conjugation battery
node scripts/tests/e2e.mjs          # jsdom UI e2e (deps in scripts/tests: npm i)
```

If `node` isn't on PATH, use `/opt/homebrew/bin/node`.

## Vocabulary data (data/*.json)

- Every file is a JSON array of rows: `["spanish","english","level","cluster?"]`.
- `level` ∈ `b1 | b2 | c1 | c2`. Build targets: **b1 800 · b2 600 · c1 400 · c2 200**
  (counts below target → build exits 1; exceeding is fine).
- `cluster` ∈ `wochentage, monate, zahlen, farben, familie, essen, koerper, tiere, expresiones, jerga, cine`
  (only for entries belonging to a challenge word group).
- **Merge order = lexical filename order**, and **the first occurrence of a
  Spanish word wins**: `vocab-b1a < vocab-b1b < vocab-b2 < vocab-c1 < vocab-c2
  < vocab-freq-* < zz-topup`. Name new files so the intended priority holds.
- Dedupe key is the full `es` string, lowercased — `el tiempo` vs `tiempo` are
  different cards; `como` and `cómo` are different words.
- `vocab-freq-*` files hold the frequency-grounded additions (top band = B1).
  The core files (`vocab-b1a…vocab-c2`) are the original themed sets; keep them
  untouched unless fixing an error in them.
- Rows that duplicate an earlier file are reported as PROBLEMS but silently
  dropped — the totals already account for that.

House style for new rows:
- include the article for nouns (`el trabajo`), bare infinitive for verbs
  (`trabajar`), plain form for adjectives/adverbs; Spanish side lowercase.
- English side: short, lowercase, no leading article ("job", not "the job").
- When adding a verb, make sure `src/conj.cjs` conjugates it (see below).
- Keep cluster membership honest: foods → `essen`, body parts → `koerper`, etc.

## Conjugation engine (src/conj.cjs)

Regular -ar/-er/-ir verbs conjugate automatically, including orthography rules
(-car/-gar/-zar, -guir/-gir, -cer/-cir → -zco, -guar → -güe) and reflexives.
Non-regular verbs need an entry:
- `STEM` — stem-changing verbs: `contar: 'o_ue'`, `cerrar: 'e_ie'`,
  `pedir: 'e_i'`, `jugar: 'u_ue'`, `discernir: 'e_ie_no'`.
- `IRREG` — fully irregular tables (haber, poder, querer, saber, salir, traer,
  ver, oír, caer, valer, oler, conducir, predecir, suponer, obtener, construir,
  incluir, sustituir, contribuir, intuir, …). Mirror an existing entry's shape.
- `HIATUS` — i/u stressed next to a vowel: `enviar → envío` (`enviar: 1`).
- `PART` — irregular participles: `abrir → 'abierto'`, `morir → 'muerto'`.
- `DEFECTIVE` — 3rd-person-only: `llover`, `atañer`, `acaecer`, `incumbir`.
- `YVERBS` — leer/creer-style verbs (irregular preterite/gerund).

The build warns (doesn't fail) about infinitive-led entries without a
conjugation; `node scripts/conj-test.mjs` is the gate — add checks there
when you add tables for new verbs.

## Frequency grounding (for vocab work)

Genuinely "most used" additions should be checked against:
- Wiktionary `Frequency_lists/Spanish1000` (lemmatized) — fetch the raw wikitext:
  `https://en.wiktionary.org/w/index.php?title=Wiktionary:Frequency_lists/Spanish1000&action=raw`
- Opensubtitles frequency list (tokens): 
  `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt`

Prefs: add common speech chunks too (`por favor`, `lo siento`, `a lo mejor`),
keep every word at its natural frequency band, and don't trim good words purely
to hit round totals — exceeding targets is fine.

## SRS & answer mechanics (don't regress these)

- **Learning steps**: brand-new cards carry `st` (index into `STEPS = [1, 10]`
  minutes) and only graduate to day intervals after passing the last step —
  'good' advances a step, 'hard' repeats it, 'again' restarts it; lapsed
  (already-graduated) cards keep the classic 10-min relearning → 1-day path.
  Scheduling lives in `applyGrade` in `src/core.cjs`; tests in `scripts/smoke.mjs`.
- **Answer style setting** `settings.ans`: `'type'` (default) | `'mix'` | `'flip'`.
  Mix randomly picks typed vs. flashcard per card (challenge questions get a
  fixed `q.typed` flag at build time). Flashcard rounds may show a 4-option
  **pretest** for never-seen cards (`settings.pretest`). The pretest is
  **self-grading**, one try: first-try correct commits grade 'good'; a wrong
  guess commits an 'again'-style step restart **without** lapse/ease marking
  (`applyGrade(..., { pretest: true })` — a failed first contact is not a lapse)
  plus the usual once-per-session requeue and words-to-watch recap. The ✓/✗
  feedback holds until the learner advances (panel click / Space / Enter);
  `preAdvance()` then commits and moves straight on — there is **no rating card
  after a pretest**. Regular flashcard rounds keep their 1–4 buttons on the
  answer face (`renderFlipCard` maps back := answer; EN for es-en, ES for
  en-es). Never just toggle `.flipped` without re-rendering: that
  resurfaces a stale card.
- **Typed rounds have no Check / Show-answer buttons**: Enter checks, and Enter
  on an empty field reveals the answer (graded like a peek = 'again'). The
  continue button is labeled plain "Continue" but silently accepts Space,
  Enter and clicks anywhere on the panel.
- **Typed matching**: `Core.answerMatches`/`Core.normalizeAnswer` are
  accent-insensitive, punctuation-insensitive and article-tolerant, and the
  leading infinitive "to" is optional on English verb glosses ("work" matches
  "to work" — the display keeps the formal "to work"); a
  comma-separated answer ("beanie, winter hat") is treated as a synonym list
  and typing any ONE synonym counts as correct (commas inside parentheses
  don't split — `to be (location, state)` stays one gloss). The UI
  (`typedMatch` in `src/app.js`) additionally accepts any conjugated form of
  a target infinitive via `Conj.table`.
- **Veto ("✋ My answer was right", key `V`)**: after a typed answer is marked
  wrong in a review or challenge round, the learner can overrule it — the
  verdict flips to accepted, the round grades as 'good' (challenge miss
  bookkeeping — replay queue + recap — is undone) and the guess is stored
  locally (`localStorage` key `vocabes.v1.alt`, keyed by the normalized
  target) as a correct alternative accepted by `typedMatch` from then on.
  Only typed rounds offer the veto; peeks and MC picks don't.
- **Reveals**: on check/peek the panel collapses to `question = answer` and
  *holds* — advancing requires clicking, Space or Enter (correct = graded
  'good', miss/peek = 'again'). Speech: audio plays on demand via 🔊
  buttons/chips or the `S` key (`curEsWord()` picks the visible word without
  spoiling en-es prompts); with `settings.autoSpeak` (default) every reveal
  also speaks the word automatically — hooks live in `revealPair`, `flipCard`
  and `chAnswer`. Engines (`settings.tts`): ranked system voices or the opt-in
  HD neural voice (`src/tts.js`, Piper WASM via CDN). Speaker buttons blur on
  click and `.say-btn` is exempt from the "focused control" keydown guards, so
  Space always advances instead of re-triggering audio. Narration belongs to
  the card it was spoken for: `renderCard`/`renderChalQ` cancel stale speech,
  and challenge MC rounds use `advanceAfterSpeech()` so the next question only
  appears once the revealed word has finished playing (capped at ~3.2 s).
- **Rating keys**: `1`–`4` grade everywhere a 4-option gesture exists
  (flashcard answer face, pretest picks, challenge MC). The right-hand home
  row does the same on any layout — `j`→again, `k`→hard, `l`→good, `ö`→easy
  (`gradeKeyOf` in `src/app.js`) — and every grading keydown calls
  `preventDefault()`, so the key can never leak into the next typed input.
  The flashcard grade buttons show the home-row letters (`j k l`, plus `ö`
  on the Easy button once the layout is known to produce it — eager via
  `navigator.keyboard.getLayoutMap`, lazy via a real `ö` keydown).
- Failed cards are re-queued once per session (`sess.revoked`) and recorded in
  the "words to watch" recap; challenges replay missed items once in a final
  round (`challenge.missed`/`allMissed`, one replay round max).

## Do / Don't

- Do edit `src/` + `data/`, then rebuild `index.html`, then run all four
  test scripts before committing.
- Do commit `index.html` alongside source changes (it is the deliverable).
- Don't put scratch/working files inside `data/` (the build loads **all**
  `data/*.json` — a stray file becomes vocab).
- Don't edit `index.html` by hand; don't rename data files without checking
  the merge-order priority above.
- Don't add rows whose `es` already exists in an earlier file — pick a new
  word or fix the original instead.
- Don't reintroduce anti-farming friction (cooldowns, replay caps, hard
  gates) on XP or challenges: this is a local, single-user app with no
  leaderboards or economy, so XP farming has no real benefit to anyone —
  players may repeat anything as often as they like (cluster challenges are
  deliberately replayable without waits).
