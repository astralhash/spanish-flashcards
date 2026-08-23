/* VocabES neural text-to-speech — Piper voices running in the browser.
 *
 * Uses @diffusionstudio/vits-web (Piper VITS models on ONNX Runtime WASM),
 * imported lazily from a CDN the first time an HD voice is actually needed.
 * The library streams the model (~60–120 MB) once and caches it in OPFS, so
 * later sessions are fully offline. Every failure path degrades quietly:
 * app.js falls back to ranked system (Web Speech) voices when this fails.
 *
 * Exposes window.NeuralTTS with:
 *   .voices                 { id -> label } of bundled Spanish Piper voices
 *   .speak(text, opts)      Promise; synthesizes + plays (opts: voice, rate)
 *   .stop()                 stop current playback
 *   .prefetch(id, cb)       download a model ahead of time (cb gets % 0-100)
 *   .status()               { status: idle|loading|ready|error, detail }
 *   .onStatus(fn)           subscribe to status changes
 */
'use strict';
(function () {
  var CDN = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';

  /* Spanish Piper voices worth shipping (id -> human label). */
  var VOICES = {
    'es_ES-sharvard-medium': 'Sharvard · es-ES · female',
    'es_ES-davefx-medium': 'Davefx · es-ES · male',
    'es_MX-claude-high': 'Claude · es-MX · male (largest, best quality)',
    'es_ES-carlfm-x_low': 'Carl FM · es-ES · male (smallest/fastest)'
  };

  var mod = null;              /* the imported ESM module */
  var modPromise = null;
  var seq = 0;                 /* play token: stale syntheses are not played */
  var audio = null;            /* current HTMLAudioElement */
  var blobUrl = null;
  var listeners = [];
  var st = { status: 'idle', detail: '' };
  var chain = Promise.resolve();   /* serializes downloads/inference */

  function setStatus(status, detail) {
    if (st.status === status && st.detail === detail) return;
    st = { status: status, detail: detail || '' };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](st); } catch (e) { /* listener bug must not break us */ }
    }
  }

  function ensureMod() {
    if (mod) return Promise.resolve(mod);
    if (!modPromise) {
      setStatus('loading', 'loading engine…');
      modPromise = import(CDN).then(function (m) {
        mod = m;
        return m;
      }).catch(function (err) {
        modPromise = null;     /* allow retrying (e.g. back online) */
        throw err;
      });
    }
    return modPromise;
  }

  function pct(p) {
    if (!p || !p.total) return null;
    return Math.min(100, Math.round((p.loaded / p.total) * 100));
  }

  function stop() {
    if (audio) { try { audio.pause(); } catch (e) {} }
    audio = null;
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) {} blobUrl = null; }
  }

  function play(blob, rate) {
    stop();
    blobUrl = URL.createObjectURL(blob);
    var a = new Audio(blobUrl);
    audio = a;
    if (rate && rate > 0) {
      try { a.preservesPitch = true; } catch (e) {}
      try { a.mozPreservesPitch = true; } catch (e) {}
      a.playbackRate = Math.max(0.6, Math.min(1.4, rate));
    }
    a.addEventListener('ended', function () { if (audio === a) { stop(); setStatus('ready', ''); } });
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

  function speak(text, opts) {
    opts = opts || {};
    var voiceId = VOICES[opts.voice] ? opts.voice : 'es_ES-sharvard-medium';
    var mySeq = ++seq;
    return enqueue(function () {
      if (mySeq !== seq) return null;        /* superseded while queued */
      return ensureMod().then(function (m) {
        setStatus('loading', 'synthesizing…');
        return m.predict({ text: String(text), voiceId: voiceId }, function (p) {
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
        if (mySeq !== seq) return;
        console.warn('[vocabes] neural TTS failed:', err);
        stop();
        setStatus('error', String((err && err.message) || err));
        throw err;                             /* caller falls back to system voice */
      });
    });
  }

  function prefetch(voiceId, cbProgress) {
    return enqueue(function () {
      return ensureMod().then(function (m) {
        var id = VOICES[voiceId] ? voiceId : 'es_ES-sharvard-medium';
        setStatus('loading', 'downloading HD voice…');
        return m.download(id, function (p) {
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
    });
  }

  function storedList() {
    if (!mod) return Promise.resolve([]);
    try { return mod.stored(); } catch (e) { return Promise.resolve([]); }
  }

  window.NeuralTTS = {
    voices: VOICES,
    speak: speak,
    stop: stop,
    prefetch: prefetch,
    stored: storedList,
    status: function () { return st; },
    onStatus: function (fn) {
      listeners.push(fn);
      try { fn(st); } catch (e) {}
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };
})();
