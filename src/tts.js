/* VocabES neural text-to-speech — HD voices running in the browser.
 *
 * Two engines, each lazily imported from a CDN the first time one of its
 * voices is actually needed:
 *
 *   • Kokoro-82M (kokoro-js on Transformers.js/ONNX WASM) — the quality
 *     pick. One ~90 MB q8 model (24 kHz) shared by all Kokoro voices;
 *     clearly more natural prosody than Piper. kokoro-js only phonemizes
 *     English, so Spanish text is phonemized separately with ephone
 *     (espeak-ng WASM, Romance pack, voice "es" = Castilian) and fed to
 *     the model via generate_from_ids — the same route the official
 *     Kokoro Spanish pipeline (misaki's EspeakG2P) takes. Model files are
 *     cached by Transformers.js (Cache Storage), voice packs by kokoro-js
 *     ("kokoro-voices" cache).
 *
  *   • Supertonic 3 (raw ONNX on onnxruntime-web, WebGPU/WASM) — the quality
  *     ceiling at 44.1 kHz, ~380 MB one-time download cached in OPFS. Pure-JS
  *     text preprocessing with <es> language tags; neutral (not specifically
  *     peninsular) accent. Synthesized words are cached as Opus in OPFS on
  *     first use, so repeats play instantly without re-running inference
  *     (Chrome/Firefox; Safari has no Opus-encode path and re-synthesizes).
 *
 *   • Piper (VITS via @diffusionstudio/vits-web, ONNX Runtime WASM) — the
 *     lightweight fallback and the ONLY genuinely peninsular-accented tier:
 *     smaller per-voice downloads (27–77 MB), 16–22 kHz, more robotic. Cached
 *     in OPFS. Three es_ES voices of the current Piper catalog (the two MLS
 *     low voices are deliberately omitted — auditioned and rejected).
 *
 * Both work fully offline after their first download. Failure paths degrade
 * to silence: when the HD voice is selected, app.js stays quiet rather than
 * degrading to the lower-quality system (Web Speech) voices.
 *
  * Exposes window.NeuralTTS with:
  *   .engines                { engineId -> { label, desc } } of bundled models,
  *                           rendered as the first ("model") dropdown; the
  *                           second ("voice") dropdown lists only the voices
  *                           of the selected model
  *   .voices                 { id -> meta } of bundled Spanish voices
  *                           (engine, dropdown label, quality/size info)
  *   .speak(text, opts)      Promise; synthesizes + plays (opts: voice, rate)
  *   .stop()                 stop current playback (emits an audio 'stop' event)
  *   .onAudio(fn)            subscribe to playback events { type: play|ended|stop, audio }
  *                           ('play' carries the live element for UI visualisation)
 *   .prefetch(id, cb)       download engine+model ahead of time (cb gets % 0-100)
 *   .status()               { status: idle|loading|ready|error, detail }
 *   .onStatus(fn)           subscribe to status changes
 */
'use strict';
(function () {
  var KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
  var EPHONE_CDN = 'https://cdn.jsdelivr.net/npm/ephone@1.0.2/ephone.js';
  var KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  var PIPER_CDN = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';

  /* Spanish voices worth shipping. The accent lives in each voice's TRAINING
     data, not in the phonemizer: Kokoro's es voices sound the most natural but
     carry a Latin-American tint (their espeak G2P is Castilian — zapato gets
     its θ — yet the timbre/prosody was trained on Latin speech, and no
     Spain-finetuned Kokoro exists). Piper's es_ES voices are genuinely
     peninsular but lower fidelity (22 kHz). Labels say so explicitly; Piper
     ids keep their historical names so stored settings stay valid. */
  /* HD models for the first ("model") dropdown. The per-voice `group` strings
     below mirror these descriptions and are kept for backward compatibility;
     the settings UI renders engines from here and voices filtered by engine. */
  var ENGINES = {
    kokoro: {
      label: 'Kokoro',
      desc: 'most natural, but Latin-American accent · 24 kHz · one ~90 MB download'
    },
    supertonic: {
      label: 'Supertonic 3',
      desc: 'studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)'
    },
    piper: {
      label: 'Piper',
      desc: 'authentic Spain-accented voices · 16–22 kHz · more robotic · 27–77 MB per voice'
    }
  };
  var ENGINE_ORDER = ['kokoro', 'supertonic', 'piper'];
  var VOICES = {
    'kokoro-ef_dora': {
      engine: 'kokoro', voice: 'ef_dora',
      group: 'Kokoro — most natural, but Latin-American accent · 24 kHz · one ~90 MB download',
      label: 'Dora · female — most natural sound, Latin tint (recommended)'
    },
    'kokoro-em_alex': {
      engine: 'kokoro', voice: 'em_alex',
      group: 'Kokoro — most natural, but Latin-American accent · 24 kHz · one ~90 MB download',
      label: 'Alex · male — very natural, Latin tint · same ~90 MB download'
    },
    'kokoro-em_santa': {
      engine: 'kokoro', voice: 'em_santa',
      group: 'Kokoro — most natural, but Latin-American accent · 24 kHz · one ~90 MB download',
      label: 'Santa · male — very natural, Latin tint · same ~90 MB download'
    },
    'st-F1': {
      engine: 'supertonic', voice: 'F1',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'F1 · female — studio quality, neutral accent · ~380 MB, WebGPU'
    },
    'st-F2': {
      engine: 'supertonic', voice: 'F2',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'F2 · female — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-F3': {
      engine: 'supertonic', voice: 'F3',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'F3 · female — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-F4': {
      engine: 'supertonic', voice: 'F4',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'F4 · female — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-F5': {
      engine: 'supertonic', voice: 'F5',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'F5 · female — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-M1': {
      engine: 'supertonic', voice: 'M1',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'M1 · male — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-M2': {
      engine: 'supertonic', voice: 'M2',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'M2 · male — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-M3': {
      engine: 'supertonic', voice: 'M3',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'M3 · male — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-M4': {
      engine: 'supertonic', voice: 'M4',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'M4 · male — studio quality, neutral accent · shares the ~380 MB download'
    },
    'st-M5': {
      engine: 'supertonic', voice: 'M5',
      group: 'Supertonic 3 — studio quality · 44.1 kHz · ~380 MB one-time · neutral accent (WebGPU recommended)',
      label: 'M5 · male — studio quality, neutral accent · shares the ~380 MB download'
    },
    'es_ES-davefx-medium': {
      engine: 'piper', voice: 'es_ES-davefx-medium',
      group: 'Piper es-ES — authentic Spain (castellano) accent · 22 kHz · more robotic',
      label: 'Davefx · male es-ES — authentic Spain accent, decent quality · ~63 MB'
    },
    'es_ES-sharvard-medium': {
      engine: 'piper', voice: 'es_ES-sharvard-medium',
      group: 'Piper es-ES — authentic Spain (castellano) accent · 22 kHz · more robotic',
      label: 'Sharvard · male es-ES — authentic Spain accent, decent · ~77 MB'
    },
    'es_ES-carlfm-x_low': {
      engine: 'piper', voice: 'es_ES-carlfm-x_low',
      group: 'Piper es-ES — authentic Spain (castellano) accent · 16 kHz · more robotic',
      label: 'Carl FM · male es-ES — Spain accent, tiny & fastest, very robotic · ~27 MB'
    },
    'es_MX-claude-high': {
      engine: 'piper', voice: 'es_MX-claude-high',
      group: 'Piper es-MX — Mexican accent · 22 kHz · more robotic',
      label: 'Claude · female es-MX — best Piper quality, Mexican accent · ~63 MB'
    }
  };
  var DEFAULT_VOICE = 'kokoro-ef_dora';

  var seq = 0;                 /* play token: stale syntheses are not played */
  var lastSpeak = 0;           /* token of the newest issued speak (status ownership) */
  var audio = null;            /* current HTMLAudioElement */
  var blobUrl = null;
  var listeners = [];
  var audioListeners = [];     /* playback events: { type: play|ended|stop, audio } */
  var st = { status: 'idle', detail: '' };
  var chain = Promise.resolve();   /* serializes downloads/inference */

  function setStatus(status, detail) {
    if (st.status === status && st.detail === detail) return;
    st = { status: status, detail: detail || '' };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](st); } catch (e) { /* listener bug must not break us */ }
    }
  }

  function pct(p) {
    if (!p || !p.total) return null;
    return Math.min(100, Math.round((p.loaded / p.total) * 100));
  }

  function emitAudio(ev) {
    for (var i = 0; i < audioListeners.length; i++) {
      try { audioListeners[i](ev); } catch (e) { /* listener bug must not break us */ }
    }
  }

  function stop(quiet) {
    var had = !!audio;
    if (audio) { try { audio.pause(); } catch (e) {} }
    audio = null;
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) {} blobUrl = null; }
    if (had && !quiet) emitAudio({ type: 'stop', audio: null });
    /* Advancing / toggling means pending narration is no longer wanted: the
       play token goes stale. A Supertonic first-use generation still finishes
       (and caches the word), but the sample is never played for it. */
    if (!quiet) seq++;
  }

  function play(blob, rate) {
    stop(true);   /* superseded/completed audio ends silently here; 'playing'/'ended' below are the signals */
    blobUrl = URL.createObjectURL(blob);
    var a = new Audio(blobUrl);
    audio = a;
    if (rate && rate > 0) {
      try { a.preservesPitch = true; } catch (e) {}
      try { a.mozPreservesPitch = true; } catch (e) {}
      a.playbackRate = Math.max(0.6, Math.min(1.4, rate));
    }
    a.addEventListener('playing', function () { if (audio === a) emitAudio({ type: 'play', audio: a }); });
    a.addEventListener('ended', function () {
      if (audio === a) {
        emitAudio({ type: 'ended', audio: a });
        stop(true);
        setStatus('ready', '');
      }
    });
    return a.play();
  }

  /* Run one job at a time: prevents duplicate model downloads and overlapping
     inference when 🔊 is clicked repeatedly. Results are still skipped when
     superseded (seq check inside speak). */
  function enqueue(job) {
    var run = chain.then(job, job);
    chain = run.then(function () {}, function () {});
    return run;
  }

  function fail(mySeq, err, tag) {
    if (mySeq !== seq) return null;
    console.warn('[vocabes] ' + tag + ' failed:', err);
    stop();
    setStatus('error', String((err && err.message) || err));
    throw err;                             /* callers stay silent on failure */
  }

  /* ephone logs "Tones have been removed" via console.log — keep the console clean */
  function textToIpaQuietly(eph, text) {
    var orig = console.log, out;
    console.log = function (msg) {
      if (msg === 'Tones have been removed') return;
      return orig.apply(console, arguments);
    };
    try { out = eph.textToIpa(text); } finally { console.log = orig; }
    return String(out || '').trim();
  }

  /* ================= engine: Kokoro-82M ================= */
  var kokoro = {
    lib: null, libP: null,         /* the imported kokoro-js module */
    tts: null,                     /* loaded KokoroTTS instance (model) */
    eph: null, ephP: null,         /* ephone (espeak-ng WASM) instance */

    ensure: function () {
      var self = this;
      if (this.tts) return Promise.resolve(this.tts);
      if (!this.libP) {
        setStatus('loading', 'loading Kokoro engine…');
        this.libP = import(KOKORO_CDN).then(function (m) {
          self.lib = m;
          return m;
        }).catch(function (err) {
          self.libP = null;        /* allow retrying (e.g. back online) */
          throw err;
        });
      }
      return this.libP.then(function () {
        if (self.tts) return self.tts;
        return self.lib.KokoroTTS.from_pretrained(KOKORO_MODEL, {
          dtype: 'q8', device: 'wasm',
          progress_callback: function (p) {
            var percent = pct(p);
            if (percent != null) setStatus('loading', 'downloading HD voice… ' + percent + '%');
          }
        }).then(function (t) {
          self.tts = t;
          return t;
        });
      });
    },

    /* espeak-ng phonemizer (ephone), loaded once with the Romance pack —
       carries es (Castilian), es-419, fr, it, pt; ~0.7 MB. */
    ensurePhon: function () {
      var self = this;
      if (this.eph) return Promise.resolve(this.eph);
      if (!this.ephP) {
        this.ephP = import(EPHONE_CDN).then(function (m) {
          return m.default(m.roa);
        }).then(function (e) {
          self.eph = e;
          return e;
        }).catch(function (err) {
          self.ephP = null;
          throw err;
        });
      }
      return this.ephP;
    },

    /* Spanish G2P mirroring the official Kokoro pipeline (misaki EspeakG2P
       with language 'es'): keep punctuation as-is, phonemize the rest with
       the Castilian espeak voice, strip tie/hyphen artifacts. espeak adds a
       sentence-final period to any segment, so strip it per segment and
       re-attach one at the end (avoids doubled periods). */
    phonemizeEs: function (text) {
      var PUNCT = /(\s*[;:,.!?¡¿—…·–"«»“”(){}[\]]+\s*)+/g;
      text = String(text);
      var parts = [], last = 0, m;
      PUNCT.lastIndex = 0;
      while ((m = PUNCT.exec(text))) {
        if (m.index > last) parts.push({ punct: false, t: text.slice(last, m.index) });
        parts.push({ punct: true, t: m[0] });
        last = m.index + m[0].length;
      }
      if (last < text.length) parts.push({ punct: false, t: text.slice(last) });
      return this.ensurePhon().then(function (eph) {
        eph.setVoice('es');
        var out = parts.map(function (part) {
          if (part.punct || !part.t.trim()) return part.t;
          return textToIpaQuietly(eph, part.t).replace(/[.,!?;:…]+$/, '');
        }).join('').replace(/[\^-]/g, '').replace(/\s+/g, ' ').trim();
        if (out && !/[.,!?;:…]$/.test(out)) out += '.';
        return out;
      });
    },

    speak: function (text, meta, opts, mySeq) {
      var self = this;
      setStatus('loading', 'loading HD voice…');
      return this.ensure().then(function (tts) {
        if (mySeq !== seq) return null;
        return self.phonemizeEs(text).then(function (ps) {
          if (mySeq !== seq || !ps) return null;
          setStatus('loading', 'synthesizing…');
          var ids = tts.tokenizer(ps, { truncation: true }).input_ids;
          return tts.generate_from_ids(ids, { voice: meta.voice, speed: 1 });
        });
      }).then(function (raw) {
        if (mySeq !== seq || !raw) return null;   /* a newer click superseded us */
        return play(raw.toBlob(), opts.rate);
      }).then(function () {
        if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
      }).catch(function (err) {
        return fail(mySeq, err, 'kokoro TTS');
      });
    },

    prefetch: function (meta, cbProgress) {
      var self = this;
      return this.ensure().then(function (tts) {
        /* tiny warm-up generate: pulls the voice pack + phonemizer and
           compiles the WASM hot path so the first real 🔊 is quick */
        setStatus('loading', 'preparing HD voice…');
        if (cbProgress) cbProgress(90);
        return self.phonemizeEs('Hola.').then(function (ps) {
          var ids = tts.tokenizer(ps || 'ola', { truncation: true }).input_ids;
          return tts.generate_from_ids(ids, { voice: meta.voice, speed: 1 });
        });
      }).then(function () {
        setStatus('ready', '');
        if (cbProgress) cbProgress(100);
      }).catch(function (err) {
        console.warn('[vocabes] HD voice download failed:', err);
        setStatus('error', String((err && err.message) || err));
        throw err;
      });
    }
  };

  /* ================= engine: Supertonic 3 =================
   * Flow-matching TTS (Supertone), 44.1 kHz — the quality ceiling. Runs the
   * four public ONNX assets directly on onnxruntime-web (WebGPU preferred,
   * WASM fallback); text preprocessing is pure JS with <es> language tags.
   * Assets are fetched once (~380 MB, size-weighted progress) and cached in
   * OPFS for offline use. Upstream repo is archived (2026-07) — the weights
   * remain on Hugging Face under OpenRAIL-M. Accent: neutral, not
   * specifically peninsular (auditioned and approved by the user). */
  var ST_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/';
  var ORT_VER = '1.29.0';
  var ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/ort.all.bundle.min.mjs';
  var ORT_DIST = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/';
  /* onnxruntime-web's WASM backend defaults its thread pool to the CPU core
     count (often 8–16), which can trip Firefox's "this page is slowing your
     browser" warning during the heavy Supertonic warm. Cap the WASM threads so
     the tab stays responsive. */
  var ORT_THREADS = 4;
  /* known sizes (bytes) for download-progress weighting */
  var ST_ASSETS = [
    ['onnx/tts.json', 1500],
    ['onnx/unicode_indexer.json', 310000],
    ['onnx/duration_predictor.onnx', 3670000],
    ['onnx/text_encoder.onnx', 36400000],
    ['onnx/vector_estimator.onnx', 256700000],
    ['onnx/vocoder.onnx', 101400000]
  ];
  var ST_TOTAL = ST_ASSETS.reduce(function (s, a) { return s + a[1]; }, 0);
  var ST_STEPS = 8;            /* denoise steps (official default; 5 low – 12 high) */
  /* One-time asset download shared by the warm worker and the interactive
     engine, so the ~380 MB is fetched (or read from OPFS) exactly once. */
  var _assetsP = null;
  function assets() {
    if (!_assetsP) {
      _assetsP = Promise.all(ST_ASSETS.map(function (a) { return supersonic.asset(a[0]); }));
    }
    return _assetsP;
  }

  var supersonic = {
    ort: null, ortP: null,
    ready: null,                 /* promise -> this, once sessions exist */
    ep: '',                      /* active execution provider */
    dp: null, te: null, ve: null, voc: null,
    cfgs: null, indexer: null,
    styles: {},                  /* voice -> {ttl, dp} tensors */
    styleP: {},
    got: {},                     /* asset name -> bytes downloaded (progress) */

    /* ---- OPFS cache (graceful fallback to no-cache, e.g. on file://) ---- */
    /* OPFS forbids '/' in file names; asset names are repo-style paths
       ('onnx/tts.json', 'voice_styles/F1.json'). Flatten the directory part
       into the name so the write and every later lookup agree — unmangled
       names made each getFileHandle reject (silently swallowed), so nothing
       was ever stored and the ~380 MB model re-downloaded every session. */
    fsName: function (name) {
      return String(name).replace(/\//g, '__');
    },
    cacheDir: function () {
      if (this._dir !== undefined) return Promise.resolve(this._dir || null);
      var self = this;
      try {
        return navigator.storage.getDirectory().then(function (root) {
          return root.getDirectoryHandle('supertonic', { create: true });
        }).then(function (dir) {
          self._dir = dir;
          return dir;
        }).catch(function () {
          self._dir = null;
          return null;
        });
      } catch (e) {
        this._dir = null;
        return Promise.resolve(null);
      }
    },
    cacheGet: function (name) {
      var self = this;
      return this.cacheDir().then(function (dir) {
        if (!dir) return null;
        return dir.getFileHandle(self.fsName(name)).then(function (f) {
          return f.getFile().then(function (file) { return file.arrayBuffer(); });
        }).catch(function () { return null; });
      });
    },
    cachePut: function (name, buf) {
      var self = this;
      return this.cacheDir().then(function (dir) {
        if (!dir) return;
        return dir.getFileHandle(self.fsName(name), { create: true }).then(function (f) {
          return f.createWritable().then(function (w) {
            return w.write(buf).then(function () { return w.close(); });
          });
        });
      }).catch(function (e) { /* cache is best-effort */ });
    },

    /* ---- fetch one asset: OPFS cache first, else stream with progress ---- */
    asset: function (name) {
      var self = this;
      return this.cacheGet(name).then(function (buf) {
        if (buf) return buf;
        setStatus('loading', 'downloading Supertonic voice model…');
        return fetch(ST_BASE + name).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + name);
          var reader = res.body && res.body.getReader ? res.body.getReader() : null;
          if (!reader) return res.arrayBuffer();
          var chunks = [], loaded = 0;
          return new Promise(function (resolve, reject) {
            (function read() {
              reader.read().then(function (chunk) {
                if (chunk.done) {
                  var out = new Uint8Array(loaded), off = 0;
                  for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
                  resolve(out.buffer);
                  return;
                }
                chunks.push(chunk.value);
                loaded += chunk.value.length;
                self.got[name] = loaded;
                var sum = 0;
                for (var k in self.got) sum += self.got[k];
                var mb = Math.round(sum / 1048576), tot = Math.round(ST_TOTAL / 1048576);
                setStatus('loading', 'downloading Supertonic voice model… ' +
                  Math.min(99, Math.round((sum / ST_TOTAL) * 100)) + '% (~' + mb + '/' + tot + ' MB)');
                read();
              }).catch(reject);
            })();
          });
        }).then(function (buf) {
          /* await the OPFS write so the model is reliably persisted for the
             next run (a fire-and-forget write could silently fail/evict and
             force a full 380 MB re-download next time) */
          return self.cachePut(name, buf).then(function () { return buf; });
        });
      });
    },

    ensureOrt: function () {
      var self = this;
      if (this.ort) return Promise.resolve(this.ort);
      if (!this.ortP) {
        setStatus('loading', 'loading Supertonic engine…');
        this.ortP = import(ORT_URL).then(function (m) {
          self.ort = m;
          try { m.env.wasm.wasmPaths = ORT_DIST; } catch (e) { /* older env shape */ }
          /* Run the WASM backend in a worker (proxy) so the heavy model compile
             and inference never block the main thread — Firefox shows "this page
             is slowing your browser" when the Supertonic compile/inference runs
             inline. */
          try { m.env.wasm.proxy = true; } catch (e) { /* env may not expose it yet */ }
          try { m.env.wasm.numThreads = ORT_THREADS; } catch (e) { /* env may not expose it yet */ }
          return m;
        }).catch(function (err) {
          self.ortP = null;
          throw err;
        });
      }
      return this.ortP;
    },

    session: function (buf) {
      var ort = this.ort;
      var opts = { executionProviders: ['wasm'] };
      var tryWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
      /* CRITICAL: ort-web's wasm proxy TRANSFERS the model ArrayBuffer to its
         worker on create (neutering the caller's copy), even when the create
         later fails. Every attempt therefore gets its OWN copy — handing out
         the shared asset() buffers twice (second warm worker, interactive
         engine after a warm, ensure() retry) would synthesize sessions from
         detached 0-byte buffers and fail every word. */
      var make = function (providers) {
        return ort.InferenceSession.create(buf.slice(0), { executionProviders: providers });
      };
      var p = tryWebGpu ? make(['webgpu']).then(function (s) {
        supersonic.ep = 'WebGPU';
        return s;
      }).catch(function () { return make(opts); }) : make(opts);
      return p.then(function (s) {
        if (!supersonic.ep) supersonic.ep = 'WASM';
        return s;
      });
    },

    ensure: function () {
      var self = this;
      if (this.ready) return this.ready;
      this.got = {};
      this.ready = this.ensureOrt().then(function () {
        return assets();
      }).then(function (bufs) {
        var byName = {};
        ST_ASSETS.forEach(function (a, i) { byName[a[0]] = bufs[i]; });
        setStatus('loading', 'compiling Supertonic model…');
        self.cfgs = JSON.parse(new TextDecoder().decode(byName['onnx/tts.json']));
        self.indexer = JSON.parse(new TextDecoder().decode(byName['onnx/unicode_indexer.json']));
        /* compile one model at a time so the status line shows real progress
           (the vector estimator is 245 MB and can take minutes on WASM) */
        var jobs = [
          ['duration predictor', 'onnx/duration_predictor.onnx', 'dp'],
          ['text encoder', 'onnx/text_encoder.onnx', 'te'],
          ['vector estimator', 'onnx/vector_estimator.onnx', 've'],
          ['vocoder', 'onnx/vocoder.onnx', 'voc']
        ];
        var chain = Promise.resolve();
        jobs.forEach(function (job, i) {
          chain = chain.then(function () {
            setStatus('loading', 'compiling Supertonic model… (' + (i + 1) + '/4 ' + job[0] + ')');
            return self.session(byName[job[1]]);
          }).then(function (s) { self[job[2]] = s; });
        });
        return chain.then(function () {
          setStatus('ready', '');
        });
      }).then(function () {
        return self;
      }).catch(function (err) {
        self.ready = null;       /* allow a retry (e.g. back online) */
        throw err;
      });
    },

    /* ---- voice style data (F1…M5), ~285 KB each, cached like assets ---- */
    style: function (voice) {
      var self = this;
      if (this.styles[voice]) return Promise.resolve(this.styles[voice]);
      if (!this.styleP[voice]) {
        this.styleP[voice] = this.asset('voice_styles/' + voice + '.json').then(function (buf) {
          var j = JSON.parse(new TextDecoder().decode(buf));
          /* RAW data + dims, not tensors: ort's wasm proxy TRANSFERS the data
             buffer of every input tensor on every run() — a tensor object
             reused across two runs is a detached-buffer poison pill (Firefox:
             "attempting to access detached ArrayBuffer"). infer() therefore
             builds a fresh tensor from a fresh copy for every run() call. */
          self.styles[voice] = {
            ttlData: Float32Array.from(j.style_ttl.data.flat(Infinity)),
            ttlDims: j.style_ttl.dims.slice(),
            dpData: Float32Array.from(j.style_dp.data.flat(Infinity)),
            dpDims: j.style_dp.dims.slice()
          };
          return self.styles[voice];
        });
      }
      return this.styleP[voice];
    },

    /* ---- pure-JS text preprocessing (mirrors upstream web/helper.js) ---- */
    prep: function (text) {
      text = String(text).normalize('NFKD');
      text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
      var repl = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ' };
      for (var k in repl) text = text.split(k).join(repl[k]);
      text = text.replace(/[♥☆♡©\\]/g, '');
      text = text.split('@').join(' at ');
      text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!').replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'");
      text = text.replace(/"+/g, '"').replace(/'+/g, "'").replace(/`+/g, '`');
      text = text.replace(/\s+/g, ' ').trim();
      if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += '.';
      return '<es>' + text + '</es>';
    },

    /* Raw token ids + mask (dims included) — NOT tensors. The tensor objects
       are built fresh (with fresh buffers) at every run() call site in infer(),
       because ort's proxy transfers input data buffers on every run. */
    ids: function (text) {
      var L = text.length;
      var row = new Array(L).fill(0);
      for (var j = 0; j < L; j++) {
        var cp = text.codePointAt(j);
        row[j] = cp < this.indexer.length ? this.indexer[cp] : -1;
      }
      var ids = new BigInt64Array(L);
      for (var i = 0; i < L; i++) ids[i] = BigInt(row[i]);
      var mask = new Float32Array(L);
      for (i = 0; i < L; i++) mask[i] = 1.0;
      return { ids: ids, idsDims: [1, L], mask: mask, maskDims: [1, 1, L] };
    },

    /* Shared Supertonic inference: duration predictor → text encoder → 8-step
       flow loop → vocoder. onStage is called after each heavy stage so the
       interactive speak path can release the serialized queue slot when the
       learner has moved on. Returns { wav, sr } (the 44.1 kHz mono floats) or
       null. Warm uses this with a no-op onStage. */
    infer: function (style, preppedText, speed, onStage) {
      var self = this;
      var ort = self.ort;
      var tIds = self.ids(preppedText);
      var totalData = new Float32Array([ST_STEPS]);
      var duration = null;   /* filled by the duration predictor, read below */
      /* ort's wasm proxy transfers the data buffer of EVERY input tensor on
         EVERY run() — and the ort.Tensor constructor wraps data by reference.
         So each run() call gets its own freshly-built tensors: anything reused
         across runs (style data, ids/mask, the text embedding, total steps,
         the latent mask) is `.slice()`-copied per call; only genuinely
         single-use buffers (noisy latent per step, final latent) skip the
         copy — their buffers are replaced before the next run. */
      var f32T = function (data, dims) { return new ort.Tensor('float32', data.slice(), dims); };
      var idsT = function () { return new ort.Tensor('int64', tIds.ids.slice(), tIds.idsDims); };
      var maskT = function () { return f32T(tIds.mask, tIds.maskDims); };
      return self.dp.run({ text_ids: idsT(), style_dp: f32T(style.dpData, style.dpDims), text_mask: maskT() }).then(function (o) {
        duration = Array.from(o.duration.data);
        for (var i = 0; i < duration.length; i++) duration[i] /= speed;
        return self.te.run({ text_ids: idsT(), style_ttl: f32T(style.ttlData, style.ttlDims), text_mask: maskT() });
      }).then(function (o) {
        var embData = new Float32Array(o.text_emb.data);   /* copy once — re-wrapped fresh for all 8 steps */
        var embDims = o.text_emb.dims.slice();
        var cfg = self.cfgs, sampleRate = cfg.ae.sample_rate;
        var chunkSize = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
        var latentLen = Math.floor((Math.floor(duration[0] * sampleRate) + chunkSize - 1) / chunkSize);
        var latentDim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
        var xt = new Float32Array(latentDim * latentLen);
        for (var i = 0; i < xt.length; i += 2) {
          var u1 = Math.max(0.0001, Math.random()), u2 = Math.random();
          var g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          xt[i] = g;
          if (i + 1 < xt.length) xt[i + 1] = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
        }
        var wavLen = Math.floor(duration[0] * sampleRate);
        var maskLen = Math.floor((wavLen + chunkSize - 1) / chunkSize);
        var latentMask = new Float32Array(latentLen);
        for (i = 0; i < latentLen; i++) latentMask[i] = i < maskLen ? 1 : 0;
        for (i = 0; i < xt.length; i++) xt[i] *= latentMask[i % latentLen];
        var cur = 0;
        function step() {
          var xtT = new ort.Tensor('float32', xt, [1, latentDim, latentLen]);
          return self.ve.run({
            noisy_latent: xtT, text_emb: f32T(embData, embDims),
            style_ttl: f32T(style.ttlData, style.ttlDims),
            latent_mask: f32T(latentMask, [1, 1, latentLen]), text_mask: maskT(),
            current_step: new ort.Tensor('float32', new Float32Array([cur]), [1]),
            total_step: f32T(totalData, [1])
          }).then(function (o) {
            xt = new Float32Array(o.denoised_latent.data);   /* copy — the old buffer was transferred away */
            cur++;
            if (onStage) onStage();
            if (cur < ST_STEPS) return step();
            return new ort.Tensor('float32', xt, [1, latentDim, latentLen]);
          });
        }
        return step();
      }).then(function (latent) {
        return self.voc.run({ latent: latent });
      }).then(function (o) {
        if (!o) return null;
        var wav = new Float32Array(o.wav_tts.data);
        return { wav: wav, sr: self.cfgs.ae.sample_rate };
      });
    },

    speak: function (text, meta, opts, mySeq) {
      var self = this;
      /* Word cache first: a repeat plays the stored Opus blob instantly and
         skips the model download + inference entirely (also survives reloads
         via OPFS). First use synthesizes, plays the WAV immediately, and
         encodes/stores Opus in the background for next time. */
      var tPre = null, speedPre = 1, keyPre = null, memHit = null;
      try {
        tPre = self.prep(text);
        speedPre = Math.max(0.7, Math.min(2, Number(opts.rate) || 1));
        keyPre = wordKey(meta.voice, tPre, speedPre);
        memHit = wordMemGet(keyPre);
      } catch (e) { keyPre = null; memHit = null; }
      if (memHit) {
        if (mySeq !== seq) return Promise.resolve(null);
        return play(memHit, 0).then(function () {
          if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
        }).catch(function (err) {
          return fail(mySeq, err, 'supertonic TTS');
        });
      }
      var fromDisk = keyPre ? wordCacheGet(keyPre) : Promise.resolve(null);
      return fromDisk.then(function (hit) {
        if (!hit) return null;
        if (mySeq !== seq) return 'cached';   /* learner moved on: it is on disk already, no play */
        wordMemPut(keyPre, hit);
        return play(hit, 0).then(function () {
          if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
        }).catch(function (err) {
          return fail(mySeq, err, 'supertonic TTS');
        }).then(function () { return 'cached'; });
      }).then(function (done) {
        if (done) return done;
        /* Join an in-flight generation of the SAME word (e.g. 🔊 re-clicked
           while a detached attempt still runs) instead of synthesizing twice. */
        var twin = (keyPre && pendingGen && pendingGen.key === keyPre) ? pendingGen.p : null;
        if (twin) {
          return twin.then(function (blob) {
            if (mySeq !== seq || !blob) return null;
            return play(blob, 0).then(function () {
              if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
            });
          }).catch(function (err) {
            return fail(mySeq, err, 'supertonic TTS');
          });
        }
        /* First use. The generation is never aborted: if the learner has
           already moved on (stop() advanced the play token), the serialized
           queue is released at the next stage boundary and the remainder
           detaches — still synthesizing and caching the word, but the sample
           is never played for a stale token. */
        var release = null;   /* resolves the serialized queue slot early */
        var gate = new Promise(function (r) { release = r; });
        var releaseOnce = function () { if (release) { var f = release; release = null; f(); } };
        var releaseIfStale = function () { if (mySeq !== seq) releaseOnce(); };
        setStatus('loading', 'loading Supertonic voice model…');
        var gen = self.ensure().then(function () {
          releaseIfStale();
          return self.style(meta.voice);
        }).then(function (style) {
          if (!style) return null;
          if (mySeq === seq) setStatus('loading', 'synthesizing…');
          releaseIfStale();
          var t = tPre || self.prep(text);
          var speed = speedPre;
          return self.infer(style, t, speed, releaseIfStale);
        }).then(function (out) {
          if (!out) return null;
          var wav = out.wav, sr = out.sr;
          var blob = wavBlob(wav, sr);   /* first use plays the WAV right away… */
          if (keyPre) wordCacheStore(keyPre, wav, sr, blob);   /* …while Opus is encoded in the background */
          if (mySeq !== seq) return null;   /* learner moved on: cached, never played */
          return play(blob, 0);   /* native speed already applied */
        });
        if (keyPre) {
          pendingGen = { key: keyPre, p: gen };   /* re-clicks join this instead of re-synthesizing */
          var clearPending = function () { if (pendingGen && pendingGen.key === keyPre) pendingGen = null; };
          gen.then(clearPending, clearPending);
        }
        gen.then(function () {
          if (mySeq === seq) {
            if (st.status !== 'error') setStatus('ready', '');
          } else if (lastSpeak === mySeq) {
            setStatus('ready', '');   /* stale finish, no newer speak: calm the orb */
          }
        }).catch(function (err) {
          if (mySeq === seq) return fail(mySeq, err, 'supertonic TTS');
          console.warn('[vocabes] background Supertonic generation failed:', err);   /* best-effort */
        }).then(releaseOnce, releaseOnce);
        return gate;
      }).then(function () {
        if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
      }).catch(function (err) {
        return fail(mySeq, err, 'supertonic TTS');
      });
    },

    prefetch: function (meta, cbProgress) {
      var self = this;
      return this.ensure().then(function () {
        setStatus('loading', 'preparing Supertonic voice…');
        return self.style(meta.voice);
      }).then(function () {
        setStatus('ready', '');
        if (cbProgress) cbProgress(100);
      }).catch(function (err) {
        console.warn('[vocabes] Supertonic download failed:', err);
        setStatus('error', String((err && err.message) || err));
        throw err;
      });
    }
  };

  /* A Supertonic inference worker: its OWN compiled sessions, so warm can
     synthesize words without concurrent run() on the interactive engine's
     sessions (which onnxruntime-web doesn't guarantee to be safe). Reuses the
     shared asset download (assets()), the voice-style tensors
     (supersonic.style) and the shared ids/infer logic — call
     `supersonic.infer.call(worker, ...)`. The warm is strictly SERIAL —
     exactly one worker, one compiled session set: ort's wasm proxy funnels
     every session through a single shared proxy worker, so more "workers"
     never synthesized in parallel; they only doubled the model memory inside
     it (an OOM recipe). The worker is cached across warm runs so a retry
     after a Stop doesn't re-pay the minutes-long compile. */
  var _warmWorker = null;
  function makeWarmWorker() {
    var w = {
      ort: null, dp: null, te: null, ve: null, voc: null,
      cfgs: null, indexer: null, ready: null,
      ids: supersonic.ids,
      ensure: function () {
        var self = w;
        if (self.ready) return self.ready;
        self.ready = supersonic.ensureOrt().then(function () {
          self.ort = supersonic.ort;
          return assets();
        }).then(function (bufs) {
          var byName = {};
          ST_ASSETS.forEach(function (a, i) { byName[a[0]] = bufs[i]; });
          self.cfgs = JSON.parse(new TextDecoder().decode(byName['onnx/tts.json']));
          self.indexer = JSON.parse(new TextDecoder().decode(byName['onnx/unicode_indexer.json']));
          var jobs = [
            ['duration predictor', 'onnx/duration_predictor.onnx', 'dp'],
            ['text encoder', 'onnx/text_encoder.onnx', 'te'],
            ['vector estimator', 'onnx/vector_estimator.onnx', 've'],
            ['vocoder', 'onnx/vocoder.onnx', 'voc']
          ];
          var chain = Promise.resolve();
          jobs.forEach(function (job, i) {
            chain = chain.then(function () {
              setStatus('loading', 'compiling Supertonic worker… (' + (i + 1) + '/4 ' + job[0] + ')');
              return supersonic.session(byName[job[1]]);
            }).then(function (s) { self[job[2]] = s; });
          });
          return chain;
        }).then(function () {
          setStatus('ready', '');
          return self;
        }).catch(function (err) {
          self.ready = null;       /* allow a retry */
          throw err;
        });
        return self.ready;
      }
    };
    return w;
  }

  /* 16-bit PCM WAV encoder (mirrors upstream writeWavFile) */
  function wavBlob(samples, rate) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    var wstr = function (off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    wstr(8, 'WAVE');
    wstr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wstr(36, 'data');
    v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var c = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, Math.floor(c * 32767), true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /* ================= Supertonic word cache (Opus in OPFS) =================
   * First use of a word synthesizes, plays the WAV immediately, and encodes
   * Opus (48 kbps webm/ogg via MediaRecorder) in the background for next
   * time. Repeats play the cached blob instantly — no model load, no
   * inference. Key covers voice + preprocessed text + rate + bitrate, so a
   * settings (or bitrate) change naturally misses the cache. Chrome +
   * Firefox encode AND decode;
   * Safari has no supported Opus-encode path here and falls back to
   * re-synthesizing (WAV fallback is stored so a future decode-capable pass
   * can still hit). If the play token goes stale mid-generation (the learner
   * moved on), the job queue is released at the next stage boundary and the
   * generation finishes detached — the word is still cached, never played.
   * Everything is best-effort: any failure resolves null and
   * the caller synthesizes as if uncached. */
  var WORD_KBPS = 48;   /* Opus encode bitrate; baked into the key so a bump
                           re-keys the cache instead of replaying old blobs */
  var WORD_MEM_MAX = 300;
  var pendingGen = null;   /* { key, p } in-flight first-use generation: a
                              re-click joins it instead of synthesizing twice */
  var wordMem = new Map();   /* key -> Blob (this session; no OPFS round-trip) */
  function wordMemGet(key) {
    if (!key || !wordMem.has(key)) return null;
    var b = wordMem.get(key);
    wordMem.delete(key);     /* refresh LRU position */
    wordMem.set(key, b);
    return b;
  }
  function wordMemPut(key, blob) {
    if (!key || !blob) return;
    if (wordMem.has(key)) wordMem.delete(key);
    wordMem.set(key, blob);
    while (wordMem.size > WORD_MEM_MAX) {
      var oldest = wordMem.keys().next();
      if (oldest.done) break;
      wordMem.delete(oldest.value);
    }
  }
  /* cyrb53 hash → compact base36; filename-safe, no raw text on disk */
  function wordHash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36));
  }
  function wordKey(voice, preppedText, speed) {
    var rate = Number(speed).toFixed(2);
    return 'st2-' + String(voice) + '-' + wordHash(String(voice) + '\x00' + String(preppedText) + '\x00' + rate + '\x00' + WORD_KBPS);
  }
  /* Legacy sweep: pre-48k blobs ('st-' keys) can never be hit again — delete
     them on first OPFS access so they don't linger. Best-effort, never rejects. */
  function sweepLegacyWords(dir) {
    if (!dir || !dir.values) return;
    var it = dir.values();
    function next() {
      return it.next().then(function (r) {
        if (r.done) return;
        var name = r.value && r.value.name;
        if (name && name.indexOf('st-') === 0 &&
            (name.slice(-5) === '.webm' || name.slice(-4) === '.ogg' || name.slice(-4) === '.wav')) {
          return dir.removeEntry(name).catch(function () {}).then(next);
        }
        return next();
      });
    }
    next().catch(function () {});
  }
  var _wdir;   /* OPFS 'tts-cache' dir handle, or null when unavailable */
  function wordDir() {
    if (_wdir !== undefined) return Promise.resolve(_wdir || null);
    try {
      return navigator.storage.getDirectory().then(function (root) {
        return root.getDirectoryHandle('tts-cache', { create: true });
      }).then(function (dir) {
        _wdir = dir;
        sweepLegacyWords(dir);
        return dir;
      }).catch(function () {
        _wdir = null;
        return null;
      });
    } catch (e) {
      _wdir = null;
      return Promise.resolve(null);
    }
  }
  function wordFileGet(dir, name) {
    return dir.getFileHandle(name).then(function (f) {
      return f.getFile();
    }).catch(function () { return null; });
  }
  /* opus blob preferred (small); wav fallback accepted (older pass / no encoder) */
  function wordCacheGet(key) {
    return wordDir().then(function (dir) {
      if (!dir) return null;
      return wordFileGet(dir, key + '.webm').then(function (f) {
        if (f) return f;
        return wordFileGet(dir, key + '.ogg');
      }).then(function (f) {
        if (f) return f;
        return wordFileGet(dir, key + '.wav');
      }).then(function (f) {
        return f || null;
      });
    }).catch(function () { return null; });
  }
  function wordCachePut(key, blob, ext) {
    if (!key || !blob) return Promise.resolve(false);
    return wordDir().then(function (dir) {
      if (!dir) return false;
      return dir.getFileHandle(key + ext, { create: true }).then(function (f) {
        return f.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).then(function () {
        wordMemPut(key, blob);
        return true;
      });
    }).catch(function () { return false; });
  }
  /* Is this word already in the Supertonic word cache (memory or OPFS) for the
     given voice/rate? Lets the app stay silent for uncached words while the
     pre-heat batch owns the engine — synthesizing one mid-warm would contend
     for the single ort proxy worker (or compile a second session set).
     Best-effort: false for non-Supertonic voices and any lookup failure. */
  function hasCachedWord(text, opts) {
    opts = opts || {};
    var meta = VOICES[opts.voice] || VOICES[DEFAULT_VOICE];
    if (meta.engine !== 'supertonic') return Promise.resolve(false);
    var rate = Math.max(0.7, Math.min(2, Number(opts.rate) || 1));
    try {
      var tPre = supersonic.prep(text);
      var key = wordKey(meta.voice, tPre, rate);
      if (wordMemGet(key)) return Promise.resolve(true);
      return wordCacheGet(key).then(function (hit) { return !!hit; });
    } catch (e) { return Promise.resolve(false); }
  }
  var _actx = null;   /* shared AudioContext for background Opus encodes */
  function opusMime() {
    try {
      if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
      if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
    } catch (e) { /* no MediaRecorder support (e.g. jsdom) */ }
    return null;
  }
  /* Offline-speed transcode is NOT possible with MediaRecorder (realtime), so
     this runs detached after the first-use WAV is already playing: ~1-2 s of
     silent background recording per new word, then the Opus blob is stored. */
  function encodeOpus(wav, sampleRate, mime) {
    return new Promise(function (resolve) {
      var done = function (b) { resolve(b || null); };
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return done(null);
        if (!_actx) {
          try { _actx = new AC(); } catch (e) { return done(null); }
        }
        var ctx = _actx;
        var resume = ctx.state === 'suspended' ? ctx.resume().catch(function () {}) : Promise.resolve();
        resume.then(function () {
          var buf;
          try {
            buf = ctx.createBuffer(1, wav.length, sampleRate);
            buf.getChannelData(0).set(wav);
          } catch (e) { return done(null); }
          var src = ctx.createBufferSource();
          src.buffer = buf;
          var dest = ctx.createMediaStreamDestination();
          src.connect(dest);
          var rec;
          try {
            rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: WORD_KBPS * 1000 });
          } catch (e) { return done(null); }
          var chunks = [];
          rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
          rec.onerror = function () { try { rec.stop(); } catch (e) {} done(null); };
          rec.onstop = function () {
            if (!chunks.length) return done(null);
            done(new Blob(chunks, { type: rec.mimeType || mime }));
          };
          src.onended = function () { setTimeout(function () { try { rec.stop(); } catch (e) { done(null); } }, 200); };
          try {
            rec.start();
            src.start();
          } catch (e) { done(null); }
          /* safety: never hang the background encode */
          setTimeout(function () {
            if (rec.state !== 'inactive') { try { rec.stop(); } catch (e) { done(null); } }
          }, Math.max(4000, (wav.length / sampleRate) * 1000 + 2500));
        });
      } catch (e) { done(null); }
    });
  }
  /* Store a synthesized word: Opus when encodable, else keep the WAV fallback
     so a repeat still skips inference (larger, but instant). Never rejects;
     resolves once the blob is written (the interactive speak path ignores the
     promise — the warm awaits it so its "done" count means cached on disk). */
  /* Background Opus encodes are realtime (MediaRecorder) and each runs its own
     encoder on the main thread; keep at most ONE in flight so a fast warm loop
     doesn't pile up encoders and trigger Firefox's "this page is slowing your
     browser" warning. Writes still land in whatever order they finish. */
  var ENCODE_MAX = 1;
  var encodeActive = 0, encodeWait = [];
  function encodeSlot() {
    return new Promise(function (res) {
      if (encodeActive < ENCODE_MAX) { encodeActive++; res(); }
      else encodeWait.push(res);
    });
  }
  function encodeRelease() {
    encodeActive = Math.max(0, encodeActive - 1);
    if (encodeWait.length) { encodeWait.shift()(); }
  }
  function wordCacheStore(key, wav, sampleRate, wavFallbackBlob) {
    var mime = null;
    try { mime = opusMime(); } catch (e) { mime = null; }
    if (!mime) return wordCachePut(key, wavFallbackBlob, '.wav');
    return encodeSlot().then(function () {
      return encodeOpus(wav, sampleRate, mime);
    }).then(function (opus) {
      if (opus) {
        var ext = mime.indexOf('ogg') !== -1 ? '.ogg' : '.webm';
        return wordCachePut(key, opus, ext);
      }
      return wordCachePut(key, wavFallbackBlob, '.wav');
    }).then(encodeRelease, function (e) {
      encodeRelease();
      return wordCachePut(key, wavFallbackBlob, '.wav');   /* still cache something usable */
    });
  }

  /* Import an audio package (the offline build tool's output folder): write
     each downloaded <key>.ogg/.webm/.wav straight into the OPFS tts-cache +
     memory LRU, so a word that matches this voice/rate combo plays instantly
     with no model load and no in-browser synthesis. Files already in the cache
     are skipped (cheap re-import). No OPFS (e.g. file://) → memory-only, so the
     session still benefits. Resolves to { imported, skipped, meta }; never
     rejects. `files` is an array of File-like objects ({name, arrayBuffer}).
     The package's `index.json` manifest (if present) is parsed and recorded as
     the package metadata — voice/rate the cache was built for — so the UI can
     say which voice the imported cache belongs to and warn when the user picks
     a different one. */
  var pkgMeta = null;   /* { voice, rate, rateKey, bitrateKbps, count } or null */
  var PKG_META_FILE = 'package-meta.json';
  function pkgMetaPut(meta) {
    pkgMeta = meta;
    if (!meta) return wordDir().then(function (dir) {
      if (!dir) return;
      return dir.removeEntry(PKG_META_FILE).catch(function () {});
    });
    var blob = new Blob([JSON.stringify(meta)], { type: 'application/json' });
    return wordDir().then(function (dir) {
      if (!dir) return;
      return dir.getFileHandle(PKG_META_FILE, { create: true }).then(function (f) {
        return f.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).catch(function () {});
    });
  }
  function pkgMetaGet() {
    if (pkgMeta) return Promise.resolve(pkgMeta);
    return wordDir().then(function (dir) {
      if (!dir) return null;
      return wordFileGet(dir, PKG_META_FILE).then(function (f) {
        if (!f) return null;
        return f.arrayBuffer().then(function (buf) {
          try { pkgMeta = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { pkgMeta = null; }
          return pkgMeta;
        });
      }).catch(function () { return null; });
    }).catch(function () { return null; });
  }
  /* Which voice/rate is the currently-imported audio package built for?
     Resolves to the manifest ({voice, rate, rateKey, bitrateKbps, count}) or
     null when no package has been imported. */
  function packageInfo() { return pkgMetaGet(); }

  function importWordCache(files) {
    var wanted = [], metaFile = null, i;
    for (i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !f.name) continue;
      var n = String(f.name);
      if (n === 'index.json') { metaFile = f; continue; }
      if (n.indexOf('st2-') !== 0) continue;
      if (!(n.slice(-5) === '.webm' || n.slice(-4) === '.ogg' || n.slice(-4) === '.wav')) continue;
      wanted.push(f);
    }
    if (!wanted.length) return Promise.resolve({ imported: 0, skipped: 0, meta: null });
    return wordDir().then(function (dir) {
      var imported = 0, skipped = 0, ops = [];
      function putOne(f) {
        var ext = f.name.slice(-5) === '.webm' ? '.webm' : f.name.slice(-4) === '.ogg' ? '.ogg' : '.wav';
        var key = f.name.slice(0, f.name.length - ext.length);
        var hitP = dir ? wordFileGet(dir, f.name).then(function (existing) { return !!existing; }) : Promise.resolve(false);
        return hitP.then(function (already) {
          if (already) { skipped++; return; }
          if (wordMemGet(key)) { skipped++; return; }
          return f.arrayBuffer().then(function (buf) {
            var blob = new Blob([buf]);
            return wordCachePut(key, blob, ext).then(function (ok) {
              if (!ok) wordMemPut(key, blob);   /* no OPFS: keep it in the session LRU */
              imported++;
            });
          });
        });
      }
      for (i = 0; i < wanted.length; i++) ops.push(putOne(wanted[i]));
      var metaP = metaFile
        ? metaFile.arrayBuffer().then(function (buf) {
            try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return null; }
          })
        : Promise.resolve(null);
      return Promise.all([Promise.all(ops), metaP]).then(function (r) {
        var meta = r[1];
        if (meta && meta.voice) {
          if (meta.files) meta.count = meta.files.length;
          if (typeof meta.rate === 'number') meta.rateKey = Number(meta.rate).toFixed(2);
          return pkgMetaPut(meta).then(function () { return { imported: imported, skipped: skipped, meta: meta }; });
        }
        /* no manifest — derive the voice from the key prefix
           (`st2-<VOICE>-<hash>`); keep any known rate so a manifest-less
           re-import doesn't erase the package's rate */
        var voices = {};
        for (i = 0; i < wanted.length; i++) {
          var m = /^st2-([FM][1-5])-/.exec(wanted[i].name);
          if (m) voices[m[1]] = true;
        }
        var vlist = Object.keys(voices);
        if (vlist.length) {
          var existing = pkgMeta;
          var derived = {
            voice: vlist.length === 1 ? vlist[0] : vlist.join('/'),
            rate: existing && existing.rate != null ? existing.rate : null,
            rateKey: existing && existing.rateKey ? existing.rateKey : null,
            count: wanted.length
          };
          return pkgMetaPut(derived).then(function () { return { imported: imported, skipped: skipped, meta: derived }; });
        }
        pkgMetaPut(null);
        return { imported: imported, skipped: skipped, meta: null };
      });
    }).catch(function () { return { imported: 0, skipped: 0, meta: null }; });
  }

  /* ================= engine: Piper (vits-web) ================= */
  var piper = {
    mod: null, modP: null,

    ensure: function () {
      var self = this;
      if (this.mod) return Promise.resolve(this.mod);
      if (!this.modP) {
        setStatus('loading', 'loading engine…');
        this.modP = import(PIPER_CDN).then(function (m) {
          self.mod = m;
          return m;
        }).catch(function (err) {
          self.modP = null;      /* allow retrying (e.g. back online) */
          throw err;
        });
      }
      return this.modP;
    },

    speak: function (text, meta, opts, mySeq) {
      var self = this;
      return this.ensure().then(function (m) {
        if (mySeq !== seq) return null;
        setStatus('loading', 'synthesizing…');
        return m.predict({ text: String(text), voiceId: meta.voice }, function (p) {
          if (mySeq !== seq) return;
          var percent = pct(p);
          if (percent != null) setStatus('loading', 'downloading HD voice… ' + percent + '%');
        });
      }).then(function (blob) {
        if (mySeq !== seq || !blob) return null;   /* a newer click superseded us */
        return play(blob, opts.rate);
      }).then(function () {
        if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
      }).catch(function (err) {
        return fail(mySeq, err, 'piper TTS');
      });
    },

    prefetch: function (meta, cbProgress) {
      return this.ensure().then(function (m) {
        setStatus('loading', 'downloading HD voice…');
        return m.download(meta.voice, function (p) {
          var percent = pct(p);
          if (percent != null) setStatus('loading', 'downloading HD voice… ' + percent + '%');
          else setStatus('loading', 'downloading HD voice…');
          if (cbProgress) cbProgress(percent);
        }).then(function () {
          setStatus('ready', '');
          if (cbProgress) cbProgress(100);
        });
      }).catch(function (err) {
        console.warn('[vocabes] HD voice download failed:', err);
        setStatus('error', String((err && err.message) || err));
        throw err;
      });
    },

    stored: function () {
      if (!this.mod) return Promise.resolve([]);
      try { return this.mod.stored(); } catch (e) { return Promise.resolve([]); }
    }
  };

  function engineOf(meta) {
    if (meta.engine === 'piper') return piper;
    if (meta.engine === 'supertonic') return supersonic;
    return kokoro;
  }

  function speak(text, opts) {
    opts = opts || {};
    var meta = VOICES[opts.voice] || VOICES[DEFAULT_VOICE];
    var mySeq = ++seq;
    lastSpeak = mySeq;
    return enqueue(function () {
      if (mySeq !== seq) return null;        /* superseded while queued */
      return engineOf(meta).speak(text, meta, opts, mySeq);
    });
  }

  function prefetch(voiceId, cbProgress) {
    var meta = VOICES[voiceId] || VOICES[DEFAULT_VOICE];
    return enqueue(function () {
      return engineOf(meta).prefetch(meta, cbProgress);
    });
  }

  /* Pre-heat the Supertonic Opus word cache: synthesize every word and store the
     encoded audio so later repeats play instantly with no model load or
     inference. Words already cached are skipped (and count as done). One word
     at a time, serially (see makeWarmWorker); each step is bounded by a
     watchdog so a wedged ort proxy worker can never freeze the batch forever
     (it used to stall at "N-1 remaining" when the proxy died mid-run), and a
     run of consecutive failures aborts the batch with a clear error instead of
     burning the whole list. Resolves to { done, skipped, failed, total,
     percent }; the promise also carries a .cancel() that stops the batch after
     the current in-flight word. */

  /* Reject if the underlying promise neither resolves nor rejects in time.
     The orphaned promise is simply abandoned (it can never be cancelled), but
     the warm moves on and reports honestly instead of freezing. */
  function warmGuard(p, ms, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error(what + ' timed out after ' + Math.round(ms / 1000) + ' s (engine unresponsive)'));
      }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); },
             function (e) { clearTimeout(t); reject(e); });
    });
  }
  var WARM_LOOKUP_TIMEOUT = 60000;    /* OPFS hit check */
  var WARM_WORD_TIMEOUT = 180000;     /* style + inference + store for ONE word */
  var WARM_COMPILE_TIMEOUT = 900000;  /* asset download + first-use compile can take many minutes */
  var WARM_MAX_CONSEC_FAILS = 5;      /* systematic breakage → stop, don't burn the list */

  function warmCache(words, opts, onProgress) {
    opts = opts || {};
    var meta = VOICES[opts.voice] || VOICES[DEFAULT_VOICE];
    if (meta.engine !== 'supertonic') {
      return Promise.reject(new Error('The Opus word cache belongs to the Supertonic engine — pick a Supertonic HD voice first.'));
    }
    var rate = Math.max(0.7, Math.min(2, Number(opts.rate) || 1));
    var total = words.length;
    if (!total) {
      var empty = { done: 0, skipped: 0, failed: 0, total: 0, percent: 100 };
      if (onProgress) onProgress(empty);
      return Promise.resolve(empty);
    }
    var i = 0, done = 0, skipped = 0, failed = 0, stopped = false;
    var broken = null;          /* Error — set when the engine is systematically broken */
    var consecFails = 0, lastErr = null;
    function report() {
      var summary = { done: done, skipped: skipped, failed: failed, total: total };
      summary.percent = total ? Math.min(100, Math.round((done + skipped) / total * 100)) : 100;
      if (onProgress) onProgress(summary);
    }
    function warmOne(worker, word) {
      var key = null, tPre = null;
      try {
        tPre = supersonic.prep(word);
        key = wordKey(meta.voice, tPre, rate);
      } catch (e) { key = null; }
      var skipP = key ? wordCacheGet(key) : Promise.resolve(null);
      return warmGuard(skipP, WARM_LOOKUP_TIMEOUT, 'cache lookup').then(function (hit) {
        if (hit) return 'skipped';
        if (!tPre) return 'failed';
        return warmGuard(worker.ensure(), WARM_COMPILE_TIMEOUT, 'Supertonic model compile').then(function () {
          return warmGuard(supersonic.style(meta.voice).then(function (style) {
            if (!style) return null;
            return supersonic.infer.call(worker, style, tPre, rate, null);
          }).then(function (out) {
            if (!out) return 'failed';
            var blob = wavBlob(out.wav, out.sr);
            /* await the write so "done" means cached on disk, not merely
               synthesized — the realtime Opus encode is bounded by its own
               recorder safety timeout */
            return wordCacheStore(key, out.wav, out.sr, blob).then(function () { return 'done'; });
          }), WARM_WORD_TIMEOUT, 'Supertonic synthesis');
        });
      }).catch(function (err) {
        console.warn('[vocabes] word-cache warm failed for "' + word + '":', err);
        lastErr = err;
        return 'failed';
      }).then(function (res) {
        if (res === 'skipped') skipped++;
        else if (res === 'done') done++;
        else failed++;
        report();
        return res;
      });
    }
    function workerLoop(worker) {
      function next() {
        if (stopped || broken || i >= total) return Promise.resolve();
        var word = String(words[i]); i++;
        return warmOne(worker, word).then(function (res) {
          if (res === 'failed') {
            if (++consecFails >= WARM_MAX_CONSEC_FAILS) {
              broken = new Error('Warm stopped: ' + consecFails + ' words failed in a row after ' +
                (done + skipped) + ' cached — engine problem, not word list' +
                (lastErr ? ' (' + ((lastErr && lastErr.message) || lastErr) + ')' : ''));
            }
          } else {
            consecFails = 0;
          }
          /* yield between words so the main thread isn't monopolized by the
             WASM inference / encoders (Firefox flags long busy loops) */
          return new Promise(function (r) { setTimeout(r, 0); });
        }).then(next);
      }
      return next();
    }
    var worker = _warmWorker || (_warmWorker = makeWarmWorker());
    var p = workerLoop(worker).then(function () {
      if (broken) {
        _warmWorker = null;    /* a wedged engine must not be reused — recompile next run */
        throw broken;
      }
      report();
      return { done: done, skipped: skipped, failed: failed, total: total };
    });
    p.cancel = function () { stopped = true; };
    /* Jump pending words to the front of the queue so a quiz that started
       mid-warm gets its own words cached ASAP (the quiz plays cached audio
       only — this shortens how long its words stay silent). Words already
       processed are ignored; the pulled words keep their relative order.
       No-op once stopped/aborted. */
    p.prioritize = function (prioWords) {
      if (stopped || broken || !prioWords || !prioWords.length) return;
      var want = {}, k;
      for (k = 0; k < prioWords.length; k++) {
        var w = String(prioWords[k] || '');
        if (w) want[w] = true;
      }
      var pulled = [];
      for (var j = total - 1; j >= i; j--) {
        if (want[words[j]]) { pulled.unshift(words[j]); words.splice(j, 1); }
      }
      if (pulled.length) words.splice.apply(words, [i, 0].concat(pulled));
    };
    return p;
  }

  function storedList() {
    return piper.stored();
  }

  /* Drop every cached Supertonic word (memory + OPFS). Resolves to the number
     of deleted files; best-effort, never rejects. */
  function clearWordCache() {
    wordMem.clear();
    pkgMeta = null;
    return wordDir().then(function (dir) {
      if (!dir || !dir.values) return 0;
      var it = dir.values(), n = 0;
      function next() {
        return it.next().then(function (r) {
          if (r.done) return n;
          var name = r.value && r.value.name;
          if (name === PKG_META_FILE) {
            return dir.removeEntry(name).catch(function () {}).then(next);
          }
          if (name && (name.indexOf('st-') === 0 || name.indexOf('st2-') === 0) &&
              (name.slice(-5) === '.webm' || name.slice(-4) === '.ogg' || name.slice(-4) === '.wav')) {
            n++;
            return dir.removeEntry(name).catch(function () {}).then(next);
          }
          return next();
        });
      }
      return next().catch(function () { return n; });
    }).catch(function () { return 0; });
  }

  /* Size of the persistent Supertonic word cache (OPFS only — the in-memory
     LRU mirrors the same blobs). Resolves to { bytes, count } or zeros. */
  function wordCacheStats() {
    return wordDir().then(function (dir) {
      if (!dir || !dir.values) return { bytes: 0, count: 0 };
      var it = dir.values(), bytes = 0, count = 0;
      function next() {
        return it.next().then(function (r) {
          if (r.done) return { bytes: bytes, count: count };
          var f = r.value;
          if (f && typeof f.name === 'string' &&
              (f.name.indexOf('st-') === 0 || f.name.indexOf('st2-') === 0) &&
              (f.name.slice(-5) === '.webm' || f.name.slice(-4) === '.ogg' || f.name.slice(-4) === '.wav')) {
            count++;
            return f.getFile().then(function (file) {
              bytes += file.size;
              return next();
            }).catch(function () { return next(); });
          }
          return next();
        });
      }
      return next().catch(function () { return { bytes: bytes, count: count }; });
    }).catch(function () { return { bytes: 0, count: 0 }; });
  }

  /* Are all Supertonic model assets already in the OPFS cache? Lets the UI say
     "model already downloaded" instead of implying a fresh 380 MB download. */
  function modelCached() {
    return Promise.all(ST_ASSETS.map(function (a) {
      return supersonic.cacheGet(a[0]).then(function (buf) { return !!buf; });
    })).then(function (flags) {
      return flags.every(Boolean);
    }).catch(function () { return false; });
  }

  window.NeuralTTS = {
    engines: ENGINES,
    engineOrder: ENGINE_ORDER,
    voices: VOICES,
    speak: speak,
    stop: stop,
    prefetch: prefetch,
    warmCache: warmCache,
    hasCachedWord: hasCachedWord,
    importWordCache: importWordCache,
    packageInfo: packageInfo,
    stored: storedList,
    clearWordCache: clearWordCache,
    cacheStats: wordCacheStats,
    modelCached: modelCached,
    _wordKey: wordKey,   /* exposed for tests: key stability (voice/text/rate/bitrate) */
    status: function () { return st; },
    onStatus: function (fn) {
      listeners.push(fn);
      try { fn(st); } catch (e) {}
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    /* playback lifecycle for UI (voice orb): 'play' carries the live
       HTMLAudioElement so the UI can analyse it; 'ended'/'stop' mean silence */
    onAudio: function (fn) {
      audioListeners.push(fn);
      return function () {
        var i = audioListeners.indexOf(fn);
        if (i >= 0) audioListeners.splice(i, 1);
      };
    }
  };
})();
