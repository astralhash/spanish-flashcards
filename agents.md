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
node scripts/tests/tts-transfer-test.mjs   # Supertonic infer under ort's
                                    # buffer-TRANSFER rules (stubbed ort: model
                                    # bytes neutered per create, tensor data
                                    # neutered per run — any reuse throws)
```

If `node` isn't on PATH, use `/opt/homebrew/bin/node`.

## Vocabulary data (data/*.json)

- Every file is a JSON array of rows: `["spanish","english","level","cluster?"]`.
- `level` ∈ `b1 | b2 | c1 | c2`. Build targets: **b1 800 · b2 600 · c1 400 · c2 200**
  (counts below target → build exits 1; exceeding is fine).
- `cluster` ∈ `wochentage, monate, zahlen, farben, familie, essen, koerper,
  tiere, expresiones, jerga, cine, casa, ropa, clima, trabajo, viajes, deportes,
  escuela, salud, tecnologia, ocio` (Core.CLUSTERS order; only for entries
  belonging to a challenge word group).
- **Merge order = lexical filename order**, and **the first occurrence of a
  Spanish word wins**: `vocab-b1a < vocab-b1b < vocab-b2 < vocab-c1 < vocab-c2
  < vocab-cluster-* < vocab-freq-* < zz-topup`. Name new files so the intended priority holds.
- Dedupe key is the full `es` string, lowercased — `el tiempo` vs `tiempo` are
  different cards; `como` and `cómo` are different words.
- `vocab-freq-*` files hold the frequency-grounded additions across all bands
  (`freq-b1a…freq-c2`, plus `freq-gaps` for leftovers); `vocab-cluster-*` files
  hold themed challenge-group words. The core files (`vocab-b1a…vocab-c2`) are
  the original themed sets; keep them untouched unless fixing an error in them.
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
  HD neural voices (`src/tts.js` — Kokoro-82M, Supertonic 3, or Piper WASM,
  all lazy-loaded from CDN; accent trade-offs are labeled in the voice
  dropdown). Speaker buttons blur on
  click and `.say-btn` is exempt from the "focused control" keydown guards, so
  Space always advances instead of re-triggering audio. Narration belongs to
  the card it was spoken for: `renderCard`/`renderChalQ` cancel stale speech,
   and challenge MC rounds use `advanceAfterSpeech()` so the next question only
   appears once the revealed word has finished playing. The busy check covers
   engine status ('loading' = synthesizing), the `hdPlaying` flag (playback —
   `audio.play()` resolves at playback START, so status alone never sees the
   playing phase) and `hdWanted` (speak issued but not started yet), capped
   at 10 s (a first-use Supertonic synthesis can take seconds on WASM; cutting
   it there detaches the generation and the word never sounds — only a wedged
   engine/stuck audio element may pass the cap).
  While the Supertonic pre-heat batch is running, the quiz plays **cached
  audio only**: `speak()` in app.js gates on `NeuralTTS.hasCachedWord(text,
  {voice, rate})` (memory or OPFS hit for that voice/rate key) and stays
  silent for uncached words — synthesizing one mid-warm would contend for the
  single ort proxy worker. The check is asynchronous, so if the warm ENDS while
  it is in flight the word is spoken normally (`!warmJob` fallback) instead of
  falling into the silence gap. An uncached word (and every word of a quiz that
  starts mid-warm, via `warmJob.prioritize(esWords)`) jumps to the FRONT of
  the warm queue, so the next reveal plays from cache within moments. The
  warm's own status lines (compiles/downloads) are batch progress: while
  `warmJob` is set the quiz orb ignores engine status (no spinner) and
  `ttsBusy()` reads false; both resync when the warm ends.
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

## HD voice engines (src/tts.js)

`window.NeuralTTS` exposes three lazily-imported engines behind one interface:
`speak(text, {voice, rate})` · `stop()` · `prefetch(id, cb)` · `status()` ·
`onStatus(fn)` · `onAudio(fn)` · `clearWordCache()` · `voices`
(`{id -> {engine, voice, group, label}}`) · `engines` + `engineOrder`.
Settings renders a two-step picker: HD model dropdown (`#setHdEngine`,
`settings.hdEngine`) then the voices of that model (`#setHdVoice`,
`settings.hdVoice`); stored settings from before `hdEngine` existed backfill
it from the voice. One serialized job queue (`enqueue`); every
speak carries a `seq` token and stale results are dropped, never played.
`stop()` — the app's `stopSpeech()` on card render, plus the settings
switches — also bumps the token: narration the learner walked away from never
plays. A stale **Supertonic first-use** generation is not aborted: it releases
the queue at the next stage boundary and finishes detached (a re-click on the
same word joins it via a pending-generation registry instead of synthesizing
twice), still caching the word — and the joiner plays the freshly synthesized
blob for its own current token exactly when the original token never played it
(the gen resolves `{blob, played}`; before this fix a joiner got `play()`'s
resolved value, undefined, and dropped the narration). The queue hold of one
first-use generation is bounded (`GATE_MAX_MS`, 120 s): a wedged ort proxy
must not deadlock the serialized speak queue forever. The rolling prefetch
window is created with `onlyIfReady: true` and skips entirely while
`supersonic.compiled` is false — the window must never pay the first compile
(a reveal needs to win the shared `compileSlot` lock itself; a warm-worker
compile first = silent first cards for minutes).
Failures degrade to silence (HD-or-silence policy in `speak()` in app.js).
HD is strictly opt-in (`settings.hd: false` default).

- **Kokoro-82M** (`kokoro-js@1.2.1` from jsDelivr `+esm`, model
  `onnx-community/Kokoro-82M-v1.0-ONNX`, dtype `q8` / device `wasm`, ~90 MB
  shared by all voices, 24 kHz). kokoro-js only phonemizes English, so Spanish
  goes through **ephone** (`ephone@1.0.2/ephone.js` + Romance pack `lang/roa.js`,
  ~0.7 MB, voice `es` = Castilian) and into the model via the public
  `generate_from_ids(tokenizer(ps), {voice})` — mirrors the official Kokoro
  Spanish pipeline (misaki EspeakG2P). Phonemes are validated against the
  model vocab via `tokenizer.decode` round-trip. Voices: `ef_dora`,
  `em_alex`, `em_santa` (fetched as `.bin` from the model repo, cached by
  kokoro-js). Accent: natural but Latin-American tint — say so in labels.
- **Supertonic 3** (raw ONNX on `onnxruntime-web`, `ort.all.bundle.min.mjs`,
  WebGPU preferred with automatic WASM fallback). Assets from
  `Supertone/supertonic-3` on HF: 4 ONNX files (~380 MB total — the vector
  estimator alone is ~245 MB) + `tts.json` + `unicode_indexer.json` + per-voice
  `voice_styles/{F1..F5,M1..M5}.json` (~285 KB each). Text preprocessing is
  pure JS (`prep()`: NFKD, emoji strip, `<es>…</es>` tag, codepoint→id via the
  indexer); inference is duration predictor → text encoder → 8-step
  flow-matching loop (`ST_STEPS`) → vocoder → float32 @44.1 kHz, WAV-encoded
  by `wavBlob()`. `settings.rate` maps to the native `speed` param (0.7–2.0).
  Assets are fetched with size-weighted progress and cached in OPFS
  (`supertonic` dir, best-effort — falls back to no-cache on file://). Session
  compile shows per-model progress (`(1/4 duration predictor)` … `(4/4
  vocoder)`) because the vector estimator can take minutes on WASM. Accent:
  studio quality but neutral (not peninsular). Upstream repo is archived
  (2026-07); weights frozen on HF under OpenRAIL-M. **ort proxy transfer
  rules** (both verified in the minified 1.29.0 bundle): the wasm proxy
  **transfers the model ArrayBuffer to its worker on every
  `InferenceSession.create`** — even a failed create — so `session()` hands
  each attempt a private `buf.slice(0)` copy; and every proxied `run()`
  **transfers the data buffer of each input tensor** (the `ort.Tensor`
  constructor wraps data by reference) — so `infer()` builds fresh tensors
  from `.slice()` copies for every single run() call, `style()` caches raw
  style data + dims (never tensor objects), and `ids()` returns raw ids/mask +
  dims. Any tensor reused across two runs (or any model buffer reused across
  two creates) dies as a detached buffer — Firefox fails with "attempting to
  access detached ArrayBuffer".
- **Piper** (`@diffusionstudio/vits-web@1.0.3` — latest npm release; ONNX WASM,
  per-voice 27–114 MB, 16–22 kHz, cached in OPFS). The ONLY genuinely
  peninsular tier (`es_ES` voices — davefx/sharvard medium, carlfm x_low;
  the two MLS low voices of the Piper catalog are deliberately omitted:
  auditioned and rejected as terrible). Plus the community-trained
  `es_ES-carlfm-high` (friyin on HF, public-domain dataset): registered into
  vits-web's live `PATH_MAP` export at engine load (`../..`-climb to the HF
  host root — the browser URL parser normalizes it, OPFS keys on the file
  name). Kept as the lightweight fallback.

To add a voice: one entry in `VOICES` (`engine` + engine-native `voice` id +
honest `group`/`label` covering accent, quality and size); Piper ids are
historic — never rename them (stored settings). Then rebuild + run all four
test scripts. Verify a new engine end-to-end in headless Chrome against the
real `src/tts.js` (drive `NeuralTTS.speak` with a stubbed `Audio`) before
claiming it works — the Kokoro `phonemizer`-only-speaks-English and the
Supertonic `bufs`-vs-`byName` bugs both escaped unit tests.

## Supertonic word cache (Opus in OPFS, src/tts.js)

Supertonic inference is slow (8-step flow loop, minutes to compile on WASM),
so its words are cached on first use; **repeats play instantly with no model
load and no inference**. Kokoro/Piper synthesize directly (no cache).

- **First use**: synthesize → play the WAV immediately (no added latency) →
  encode Opus in the background (`MediaRecorder`, 48 kbps, `webm;codecs=opus`
  preferred, `ogg;codecs=opus` fallback) → store in OPFS (`tts-cache` dir, a
  separate dir from the `supertonic` model assets) + in-memory LRU (300 blobs).
  If the learner advances before the generation finishes (play token stale),
  the sample is **not** played when it lands — but the word is still cached.
- **Repeat**: memory → OPFS (`.webm`/`.ogg` preferred, `.wav` fallback) →
  `play(blob)` straight away. The cache check runs **before** `ensure()`, so a
  repeat skips the ~380 MB model path entirely, even after a reload.
- **Pre-heat**: `NeuralTTS.warmCache(words, {voice, rate}, onProgress)` batch-
  synthesizes every Spanish word with the selected Supertonic voice (words
  already on disk are skipped) so the whole deck plays instantly offline. It
  never plays audio and resolves to `{done, skipped, failed, total, percent}`
  with a `.cancel()`. Parallelism is hard **1** (strictly serial): the warm
  runs ONE worker with its own compiled session set — onnxruntime-web runs
  with `env.wasm.proxy` on, and that proxy is a **single worker shared by
  every session**, so extra "workers" never synthesized in parallel, they
  only doubled the model memory inside the proxy (~2 × 380 MB, OOM recipe).
  Worse, the proxy **transfers** (neuters) the model ArrayBuffer
  to its worker on every `InferenceSession.create` — even a failed create — so
  `supersonic.session()` hands each attempt a private `buf.slice(0)` copy;
  never create a session from a shared `assets()` buffer (a second warm
  worker / the interactive engine after a warm used to get detached 0-byte
  buffers → every word failed and the run froze at "N-1 remaining"). The warm
  worker (one, cached across runs in `_warmWorker`, dropped if the run aborts
  on engine failure) gets its own compiled sessions so a mid-warm 🔊 can't
  run concurrent inference on the interactive sessions. Every stage is
  watchdogged (`warmGuard`: lookup 60 s · compile 15 min · word 3 min) and
  `WARM_MAX_CONSEC_FAILS` (5) consecutive failures abort the batch with a
  clear error instead of mass-failing the list; `done` counts words that are
  actually written to disk (the store is awaited). `env.wasm.proxy` also keeps
  the heavy compile + inference off the main thread (otherwise Firefox reports
  "this page is slowing your browser" during the minutes-long compile). WASM
  threads are capped at `ORT_THREADS` (4); Opus encodes run one-at-a-time
  behind an `ENCODE_MAX` (1) semaphore (MediaRecorder is realtime,
  main-thread), and the loop yields between words. The Settings modal wires a
  "Pre-heat word audio cache" button
  + progress bar that shows only when the HD voice is Supertonic (the Opus
  cache doesn't exist for Kokoro/Piper), plus a live "Cached audio: X MB · N
  words" stat, a "Clear cache" button (`clearWordCache`), and a `modelCached()`
  status that confirms whether the ~380 MB model is already cached (so it isn't
  re-fetched — `supersonic.asset` awaits the OPFS write).
- **Key** (`wordKey`, exposed as `NeuralTTS._wordKey` for tests):
  `st2-<voice>-<cyrb53(voice + prep(text) + rate + bitrate)>` — prepped text
  (the same `<es>…</es>` string inference sees) + voice + rate clamped to
  0.7–2.0 (`toFixed(2)`) + the encode bitrate (`WORD_KBPS`). A voice, speed or
  bitrate change naturally misses the cache.
- **Sizes**: ~4–8 KB/word Opus vs ~88 KB/s WAV (44.1 kHz mono 16-bit); the
  whole deck is ~10–20 MB per voice. No eviction yet (no quota pressure at
  that size); `clearWordCache()` drops memory + all cached audio files and
  resolves the deleted count (no Settings UI wired — call it from console).
  Pre-bitrate-bump blobs (`st-` prefix, ≤32 kbps) are swept from OPFS once on
  load (`sweepLegacyWords`) — they can never be replayed.
- **Fallbacks**: no Opus encoder (Safari, jsdom) → the WAV is stored instead
  (still instant, just larger); no OPFS (`file://`) → memory-only; **every
  failure resolves null and the caller synthesizes as if uncached** — caching
  never rejects a `speak()`.
- Opus decode in Safari was partial until macOS 15.4 / iOS 18.4 — Chrome and
  Firefox encode AND decode; Safari re-synthesizes. Accepted trade-off.

## Voice activity orb (src/app.js, src/style.css, src/template.html)

One `#voiceOrb` element morphs spinner → orb: a flowing conic-arc spinner
(`vspin` + `vglow`) while the HD voice generates (`status() === 'loading'`
and nothing playing), then an orb that scales with the live RMS level while
audible. It docks bottom-center of the active card (challenge card, else the
open quiz panel — `voicePlace()` moves it; all four containers are positioned
ancestors, the orb is a click-through overlay so layout and buttons are
unaffected) and falls back to the header when no card is visible.

- HD amplitude comes from a WebAudio tap: `MediaElementSource(audio) →
  Analyser → destination` on the live element. Fresh element per `play()`, so
  one-source-per-element is always legal; blob: URLs are same-origin so levels
  are real. System voices have no audio tap → gentle CSS pulse instead;
  `prefers-reduced-motion` → static orb.
- `tts.js` contract (added for this, status values unchanged so `ttsBusy()` /
  `advanceAfterSpeech()` are unaffected): `onAudio(fn)` emits
  `{type: 'play'|'ended'|'stop', audio}` — `'play'` fires on the element's
  `playing` event and carries it for visualisation; `stop()` emits `'stop'`
  only when audio actually existed (internal calls pass quiet). e2e asserts
  the orb exists and starts hidden.

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
