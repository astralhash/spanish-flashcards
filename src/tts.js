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
 *     smaller per-voice downloads (20–110 MB), 22 kHz, more robotic. Cached
 *     in OPFS.
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
      desc: 'authentic Spain-accented voices · 22 kHz · more robotic · 20–110 MB per voice'
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
      label: 'Sharvard · female es-ES — authentic Spain accent, decent · ~63 MB'
    },
    'es_MX-claude-high': {
      engine: 'piper', voice: 'es_MX-claude-high',
      group: 'Piper es-MX — Mexican accent · 22 kHz · more robotic',
      label: 'Claude · male es-MX — best Piper quality, Mexican accent · ~110 MB'
    },
    'es_ES-carlfm-x_low': {
      engine: 'piper', voice: 'es_ES-carlfm-x_low',
      group: 'Piper es-ES — authentic Spain (castellano) accent · 22 kHz · more robotic',
      label: 'Carl FM · male es-ES — Spain accent, tiny & fastest, very robotic · ~20 MB'
    }
  };
  var DEFAULT_VOICE = 'kokoro-ef_dora';

  var seq = 0;                 /* play token: stale syntheses are not played */
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
        return dir.getFileHandle(name).then(function (f) {
          return f.getFile().then(function (file) { return file.arrayBuffer(); });
        }).catch(function () { return null; });
      });
    },
    cachePut: function (name, buf) {
      return this.cacheDir().then(function (dir) {
        if (!dir) return;
        return dir.getFileHandle(name, { create: true }).then(function (f) {
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
          self.cachePut(name, buf);
          return buf;
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
      var make = function (providers) {
        return ort.InferenceSession.create(buf, { executionProviders: providers });
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
        return Promise.all(ST_ASSETS.map(function (a) { return self.asset(a[0]); }));
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

    /* ---- voice style tensors (F1…M5), ~285 KB each, cached like assets ---- */
    style: function (voice) {
      var self = this;
      if (this.styles[voice]) return Promise.resolve(this.styles[voice]);
      if (!this.styleP[voice]) {
        this.styleP[voice] = this.asset('voice_styles/' + voice + '.json').then(function (buf) {
          var j = JSON.parse(new TextDecoder().decode(buf));
          var ort = self.ort;
          var s = {
            ttl: new ort.Tensor('float32', Float32Array.from(j.style_ttl.data.flat(Infinity)), j.style_ttl.dims),
            dp: new ort.Tensor('float32', Float32Array.from(j.style_dp.data.flat(Infinity)), j.style_dp.dims)
          };
          self.styles[voice] = s;
          return s;
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

    ids: function (text) {
      var ort = this.ort;
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
      return {
        textIds: new ort.Tensor('int64', ids, [1, L]),
        textMask: new ort.Tensor('float32', mask, [1, 1, L])
      };
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
        if (hit && mySeq === seq) {
          wordMemPut(keyPre, hit);
          return play(hit, 0).then(function () {
            if (mySeq === seq && st.status !== 'error') setStatus('ready', '');
          }).catch(function (err) {
            return fail(mySeq, err, 'supertonic TTS');
          }).then(function () { return 'cached'; });
        }
        return null;
      }).then(function (done) {
        if (done) return done;
        setStatus('loading', 'loading Supertonic voice model…');
        return self.ensure().then(function () {
          if (mySeq !== seq) return null;
          return self.style(meta.voice);
        });
      }).then(function (style) {
        if (!style || style === 'cached') return style;
        if (mySeq !== seq) return null;
        setStatus('loading', 'synthesizing…');
        var ort = self.ort;
        var t = tPre || self.prep(text);
        var speed = speedPre;
        var tIds = self.ids(t);
        var total = new ort.Tensor('float32', new Float32Array([ST_STEPS]), [1]);
        var duration = null;   /* filled by the duration predictor, read below */
        return self.dp.run({ text_ids: tIds.textIds, style_dp: style.dp, text_mask: tIds.textMask }).then(function (o) {
          duration = Array.from(o.duration.data);
          for (var i = 0; i < duration.length; i++) duration[i] /= speed;
          return self.te.run({ text_ids: tIds.textIds, style_ttl: style.ttl, text_mask: tIds.textMask });
        }).then(function (o) {
          var textEmb = o.text_emb;
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
          var latentMaskT = new ort.Tensor('float32', latentMask, [1, 1, latentLen]);
          var cur = 0;
          function step() {
            if (mySeq !== seq) return null;
            var xtT = new ort.Tensor('float32', xt, [1, latentDim, latentLen]);
            return self.ve.run({
              noisy_latent: xtT, text_emb: textEmb, style_ttl: style.ttl,
              latent_mask: latentMaskT, text_mask: tIds.textMask,
              current_step: new ort.Tensor('float32', new Float32Array([cur]), [1]),
              total_step: total
            }).then(function (o) {
              xt = new Float32Array(o.denoised_latent.data);
              cur++;
              if (cur < ST_STEPS) return step();
              return new ort.Tensor('float32', xt, [1, latentDim, latentLen]);
            });
          }
          return step();
        }).then(function (latent) {
          if (mySeq !== seq) return null;
          return self.voc.run({ latent: latent });
        }).then(function (o) {
          if (mySeq !== seq || !o) return null;
          var wav = new Float32Array(o.wav_tts.data);
          var sr = self.cfgs.ae.sample_rate;
          var blob = wavBlob(wav, sr);   /* first use plays the WAV right away… */
          if (keyPre) wordCacheStore(keyPre, wav, sr, blob);   /* …while Opus is encoded in the background */
          return play(blob, 0);   /* native speed already applied */
        });
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
   * Opus (32 kbps webm/ogg via MediaRecorder) in the background for next
   * time. Repeats play the cached blob instantly — no model load, no
   * inference. Key covers voice + preprocessed text + rate, so a settings
   * change naturally misses the cache. Chrome + Firefox encode AND decode;
   * Safari has no supported Opus-encode path here and falls back to
   * re-synthesizing (WAV fallback is stored so a future decode-capable pass
   * can still hit). Everything is best-effort: any failure resolves null and
   * the caller synthesizes as if uncached. */
  var WORD_MEM_MAX = 300;
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
    return 'st-' + String(voice) + '-' + wordHash(String(voice) + '\x00' + String(preppedText) + '\x00' + rate);
  }
  var _wdir;   /* OPFS 'tts-cache' dir handle, or null when unavailable */
  function wordDir() {
    if (_wdir !== undefined) return Promise.resolve(_wdir || null);
    try {
      return navigator.storage.getDirectory().then(function (root) {
        return root.getDirectoryHandle('tts-cache', { create: true });
      }).then(function (dir) {
        _wdir = dir;
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
            rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 32000 });
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
  /* Fire-and-forget: Opus when encodable, else keep the WAV fallback so a
     repeat still skips inference (larger, but instant). Never rejects. */
  function wordCacheStore(key, wav, sampleRate, wavFallbackBlob) {
    try {
      var mime = opusMime();
      if (!mime) {
        wordCachePut(key, wavFallbackBlob, '.wav');
        return;
      }
      encodeOpus(wav, sampleRate, mime).then(function (opus) {
        if (opus) {
          var ext = mime.indexOf('ogg') !== -1 ? '.ogg' : '.webm';
          wordCachePut(key, opus, ext);
        } else {
          wordCachePut(key, wavFallbackBlob, '.wav');
        }
      });
    } catch (e) { /* cache is best-effort */ }
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

  function storedList() {
    return piper.stored();
  }

  /* Drop every cached Supertonic word (memory + OPFS). Resolves to the number
     of deleted files; best-effort, never rejects. */
  function clearWordCache() {
    wordMem.clear();
    return wordDir().then(function (dir) {
      if (!dir || !dir.values) return 0;
      var it = dir.values(), n = 0;
      function next() {
        return it.next().then(function (r) {
          if (r.done) return n;
          var name = r.value && r.value.name;
          if (name && name.indexOf('st-') === 0 &&
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

  window.NeuralTTS = {
    engines: ENGINES,
    engineOrder: ENGINE_ORDER,
    voices: VOICES,
    speak: speak,
    stop: stop,
    prefetch: prefetch,
    stored: storedList,
    clearWordCache: clearWordCache,
    _wordKey: wordKey,   /* exposed for tests: key stability (voice/text/rate) */
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
