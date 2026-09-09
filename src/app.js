/* VocabES UI layer — vanilla JS, zero dependencies, ~60fps-friendly. */
'use strict';
(function () {
  var C = window.Core;
  if (!C) throw new Error('core missing');
  var CJ = window.Conj || null;    /* conjugation engine — may be absent in stub builds */

  var DAY = C.DAY;
  var LS_KEY = 'vocabes.v1';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  /* ---------------- state ---------------- */
  var settings = loadSettings();
  var state = loadState() || C.defaultState();
  var ENTS = null;                 /* cached combined entry list */
  var sess = null;                 /* running review session */
  var challenge = null;            /* running cluster challenge */
  var saveTimer = null;

  function entries() { return ENTS || (ENTS = C.withIds(VOCAB, state.custom)); }

  function defaultSettings() {
    return {
      levels: ['b1', 'b2'], dir: 'es-en', newPerDay: 20, sound: true, theme: null,
      ans: 'type', pretest: true, tts: true,
      /* speech: system-voice override ('' = auto-pick best), speed multiplier,
         and the optional HD neural engine (src/tts.js — Kokoro, Supertonic or Piper).
         hdEngine picks the model, hdVoice the voice within it (two-step picker).
         autoSpeak: pronounce each word as it is revealed (off = only on demand
         via 🔊 buttons or the S key). */
      voiceURI: '', rate: 0.92, hd: false, hdEngine: 'kokoro', hdVoice: 'kokoro-ef_dora',
      autoSpeak: true
    };
  }
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY + '.set') || '{}');
      var merged = Object.assign(defaultSettings(), s);
      /* hdEngine is new: stored settings from before only carry hdVoice, and
         the default would mask that — derive the model from the voice then */
      if (hdEngineOrder().indexOf(s.hdEngine) === -1) merged.hdEngine = engineOfVoice(merged.hdVoice);
      return merged;
    } catch (e) { return defaultSettings(); }
  }
  function saveSettings() { try { localStorage.setItem(LS_KEY + '.set', JSON.stringify(settings)); } catch (e) {} }
  function loadState() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY + '.state') || 'null'); return s; } catch (e) { return null; }
  }
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { try { localStorage.setItem(LS_KEY + '.state', JSON.stringify(state)); } catch (e) {} }, 220);
  }

  /* ---- vetted answer alternatives ---- */
  /* When the learner overrules a marked-wrong typed answer ("✋ my answer was
     right"), the guess is remembered locally as a correct alternative for that
     target word and accepted by typedMatch from then on. Keyed by the
     normalized target, so both directions and challenges benefit. */
  var alts = loadAlts();
  function loadAlts() {
    try { var a = JSON.parse(localStorage.getItem(LS_KEY + '.alt') || '{}'); return a && typeof a === 'object' ? a : {}; } catch (e) { return {}; }
  }
  function saveAlts() { try { localStorage.setItem(LS_KEY + '.alt', JSON.stringify(alts)); } catch (e) {} }
  function addAlt(target, guess) {
    var k = C.normalizeAnswer(target);
    var g = C.normalizeAnswer(guess);
    if (!k || !g) return;
    if (!alts[k]) alts[k] = [];
    if (alts[k].indexOf(g) === -1) { alts[k].push(g); saveAlts(); }
  }
  function altMatch(target, guess) {
    var list = alts[C.normalizeAnswer(target)];
    return !!list && list.indexOf(C.normalizeAnswer(guess)) !== -1;
  }

  /* ---------------- helpers ---------------- */
  function entryById(id) {
    var all = entries();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  /* the entry the running review session is currently showing (or null) */
  function curEntry() {
    return (sess && sess.ids) ? entryById(sess.ids[sess.i]) : null;
  }
  function show(id) {
    $$('.screen').forEach(function (s) { s.hidden = s.id !== id; });
  }
  function dirOf() {
    if (settings.dir === 'mix') return Math.random() < 0.5 ? 'es-en' : 'en-es';
    return settings.dir;
  }

  /* Gender-colored articles for Spanish words. */
  var ART_RE = /^((?:el|la|los|las|lo|un|una|unos|unas|der|die|das)\s+)(.*)$/i;
  function renderWord(node, txt, isEs, noTag) {
    node.textContent = '';
    /* mark Spanish verbs: hovering them shows a live conjugation card */
    if (isEs && CJ && !noTag) {
      var cj = CJ.analyze(txt);
      if (cj) { node.dataset.conj = txt; node.classList.add('verbal'); hideConj(); }
      else { node.removeAttribute('data-conj'); node.classList.remove('verbal'); }
    } else {
      node.removeAttribute('data-conj');
      node.classList.remove('verbal');
    }
    var m = String(txt).match(ART_RE);
    if (m) {
      var art = m[1].trim().toLowerCase();
      var artSpan = el('span', 'art');
      if (art === 'el' || art === 'los' || art === 'un' || art === 'unos' || art === 'der') artSpan.classList.add('m');
      else if (art === 'la' || art === 'las' || art === 'una' || art === 'unas' || art === 'die') artSpan.classList.add('f');
      else artSpan.classList.add('n');
      artSpan.textContent = m[1];
      node.appendChild(artSpan);
      node.appendChild(document.createTextNode(m[2]));
    } else {
      node.textContent = txt;
    }
    /* speak button on Spanish words when pronunciation is enabled */
    if (isEs && settings.tts) node.appendChild(sayBtn(txt));
  }

  /* ---------------- conjugation hover card ---------------- */
  var conjCard = null;          /* DOM node */
  var conjKey = null;           /* phrase currently shown */
  var conjCache = {};           /* phrase → parsed table object */
  var conjTouch = 0;            /* timestamp when a touch long-press shown the card */

  function conjEl() {
    if (!conjCard) {
      conjCard = el('div', 'conj-card');
      conjCard.id = 'conjCard';
      conjCard.setAttribute('role', 'tooltip');
      document.body.appendChild(conjCard);
    }
    return conjCard;
  }

  function conjTable(phrase) {
    if (conjCache[phrase]) return conjCache[phrase];
    return (conjCache[phrase] = CJ.table(phrase) || false);
  }

  function cellText(verb, form) {
    return form + (verb.suffix || '');
  }

  function buildConjDom(t) {
    var card = el('div', 'conj-inner');

    var head = el('div', 'conj-head');
    head.appendChild(el('div', 'conj-word', t.phrase));
    var sub = 'conjugation of ' + t.base;
    if (t.reflex) sub += ' · reflexive';
    if (t.defective && t.note) sub += ' · ' + t.note;
    head.appendChild(el('div', 'conj-sub', sub));
    card.appendChild(head);

    var grid = el('div', 'conj-grid');
    t.tenses.forEach(function (tm) {
      var b = el('div', 'conj-tense');
      b.appendChild(el('div', 'conj-tense-name', tm.label));
      tm.rows.forEach(function (r) {
        var row = el('div', 'conj-row');
        row.appendChild(el('span', 'conj-pron', r[0]));
        row.appendChild(el('span', 'conj-form', cellText(t, r[1])));
        b.appendChild(row);
      });
      grid.appendChild(b);
    });
    card.appendChild(grid);

    if (t.imperative) {
      var imp = el('div', 'conj-tense');
      imp.appendChild(el('div', 'conj-tense-name', 'Imperative'));
      [['tú', t.imperative.tu], ['usted', t.imperative.usted], ['nosotros', t.imperative.nosotros],
       ['vosotros', t.imperative.vosotros], ['ustedes', t.imperative.ustedes]].forEach(function (p) {
        var row = el('div', 'conj-row');
        row.appendChild(el('span', 'conj-pron', p[0]));
        row.appendChild(el('span', 'conj-form', cellText(t, p[1])));
        imp.appendChild(row);
      });
      grid.appendChild(imp);
    }

    var foot = el('div', 'conj-foot');
    var ge = t.reflex && t.gerundSe ? t.gerundSe : t.gerund;
    foot.appendChild(el('span', 'conj-chip', 'Gerund: ' + cellText(t, ge)));
    foot.appendChild(el('span', 'conj-chip', 'Participle: ' + cellText(t, t.participle)));
    card.appendChild(foot);

    return card;
  }

  function positionConj(x, y) {
    var c = conjEl();
    var pad = 14, margin = 8;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var w = c.offsetWidth, h = c.offsetHeight;
    var left = x + pad, top = y + pad;
    if (left + w > vw - margin) left = x - w - pad;
    if (top + h > vh - margin) top = y - h - pad;
    if (top < margin) top = margin;
    c.style.left = Math.max(margin, left) + 'px';
    c.style.top = top + 'px';
  }

  function showConj(phrase, x, y) {
    if (!CJ) return;
    var t = conjTable(phrase);
    if (!t) return;
    var c = conjEl();
    if (conjKey !== phrase) {
      conjKey = phrase;
      c.textContent = '';
      c.appendChild(buildConjDom(t));
    }
    c.classList.add('show');
    positionConj(x, y);
  }

  function hideConj() {
    conjKey = null;
    if (conjCard) conjCard.classList.remove('show');
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* tiny WebAudio blips — no assets needed */
  var actx = null;
  function beep(freq, dur, type, gain, when) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      var t0 = actx.currentTime + (when || 0);
      g.gain.setValueAtTime(gain || 0.07, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + dur);
    } catch (e) { /* audio unavailable — stay silent */ }
  }
  function sndGood() { if (settings.sound) { beep(620, .08); beep(880, .12, 'sine', .06, .07); } }
  function sndBad() { if (settings.sound) beep(190, .2, 'triangle', .08); }
  function sndTic() { if (settings.sound) beep(440, .045, 'sine', .04); }

   /* ---- speech (text-to-speech) + production prompts ---- */
   /* The production effect: saying words aloud (or at least hearing them right
      after a recall attempt) strengthens memory for the spoken form.
      Two engines, selected in settings:
        1. HD neural voice (src/tts.js — Kokoro-82M, Supertonic 3, or Piper as
           the lighter fallback) — opt-in, downloaded once. When HD is chosen
           it is HD or silence: synthesis may be slow, still loading, or
           superseded by fast card progression — we never degrade to the
           low-quality system voice, we just stay quiet.
       2. System voices via Web Speech API — used only when HD is off; ranked
          best-first, because getVoices() order is arbitrary and the first
          es* voice is often the worst one installed (compact eSpeak-style
          voices etc.). */
  var esVoices = [];
  var esVoice = null;
  function scoreVoice(v) {
    var n = String(v.name || '').toLowerCase();
    var lang = String(v.lang || '').toLowerCase().replace('_', '-');
    var s = 0;
    if (/natural|neural/.test(n)) s += 45;                    /* Edge/Win11 neural */
    if (/\bgoogle\b/.test(n)) s += 50;                        /* Chrome network voices */
    if (/premium|enhanced|mejorada|extend/.test(n)) s += 25;  /* macOS/Win high tiers */
    if (/mónica|monica|marisol|jorge|nelida|luciana|isidora|dalia|elvira/.test(n)) s += 18;
    if (/es-es/.test(lang)) s += 10;                          /* European Spanish bias… */
    else if (/^es([-$]|$)/.test(lang)) s += 6;                /* …but good MX beats bad ES */
    if (v.localService === false) s += 6;                     /* network voices tend to sound better */
    if (/compact|eloquence|espeak|pico|festival|novelty|robosoft/.test(n)) s -= 30;
    return s;
  }
  function refreshVoices() {
    try {
      if (!window.speechSynthesis) { esVoices = []; esVoice = null; return; }
      var vs = window.speechSynthesis.getVoices() || [];
      esVoices = vs.filter(function (v) { return String(v.lang || '').toLowerCase().indexOf('es') === 0; })
        .sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
      esVoice = esVoices[0] || null;
    } catch (e) { esVoices = []; esVoice = null; }
    if (!$('#modal').hidden) fillVoiceUI();
  }
  function pickSystemVoice() {
    if (!esVoices.length) refreshVoices();
    if (settings.voiceURI) {
      for (var i = 0; i < esVoices.length; i++) {
        if (esVoices[i].voiceURI === settings.voiceURI) return esVoices[i];
      }
    }
    return esVoice;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  refreshVoices();

  /* App-initiated HD speak jobs in flight (synthesizing or playing) — keeps
     the orb honest even while the rolling prefetch window suppresses the
     engine's own 'loading' status lines. */
  var hdWanted = 0;
  function hdPlay(text) {
    hdWanted++;
    var done = function (v) { hdWanted--; return v; };
    return NeuralTTS.speak(text, { voice: settings.hdVoice, rate: settings.rate })
      .then(done, function (e) { done(); throw e; });
  }
  function speak(text) {
    if (!settings.tts) return;
    text = String(text);
    if (!settings.hd) { speakSystem(text); return; }
    /* HD selected: HD or silence — no system-voice fallback, even when
       synthesis fails or is superseded by fast card progression. */
    if (window.NeuralTTS) {
      /* While the full pre-heat batch owns the engine, only play words that
         are already cached — a first-time synthesis would contend for the
         single ort proxy worker (or even compile a second session set
         mid-warm). An uncached word stays silent now but jumps to the front
         of the warm queue, so its next reveal plays from cache.
         The rolling n+1 prefetch (aheadJob) never gates: the word on screen
         must always sound — uncached it synthesizes interactively (the
         compile lock in tts.js serializes that against the warm worker's
         compile, and the warm yields between words to quiz narration). */
      if (warmJob) {
        NeuralTTS.hasCachedWord(text, { voice: settings.hdVoice, rate: settings.rate }).then(function (cached) {
          if (cached) {
            hdPlay(text).catch(function () {});
          } else if (warmJob && warmJob.prioritize) {
            warmJob.prioritize([text]);   /* the word on screen is wanted now — cache it next */
          }
        });
        return;
      }
      hdPlay(text)
        .catch(function () { /* stay silent; ⚠ status line in settings explains */ });
    }
  }
  function speakSystem(text) {
    try {
      if (!window.speechSynthesis) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES';
      u.rate = Math.max(0.5, Math.min(1.5, Number(settings.rate) || 0.92));
      var v = pickSystemVoice();
      if (v) u.voice = v;
      /* system voices expose no audio tap, so the orb gets a gentle CSS pulse */
      u.onstart = function () { sysSpeaking = true; voiceShowOrb(false); };
      var endSys = function () { if (sysSpeaking) { sysSpeaking = false; voiceSync(); } };
      u.onend = endSys; u.onerror = endSys;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }
  /* stop ongoing narration — used when a new card/question renders, so audio
     from the previous word never bleeds over the current one */
  function stopSpeech() {
    sysSpeaking = false;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    try { if (window.NeuralTTS) NeuralTTS.stop(); } catch (e) {}   /* emits audio 'stop' → orb hides */
    voiceSync();
  }
  /* ---- voice activity orb: flowing spinner while the HD voice generates, orb
     pulsing with the voice while it plays. One element morphs between states
     and docks bottom-center of the active card (header is the fallback home).
     HD amplitude comes from a WebAudio analyser tapped off the live <audio>
     element (NeuralTTS.onAudio); system voices have no tap → CSS pulse. */
  var voiceOrb = null, voiceLoading = false, hdPlaying = false, sysSpeaking = false;
  var voiceAC = null, voiceAn = null, voiceSrc = null, voiceBuf = null, voiceRaf = 0;
  function orbEl() { if (!voiceOrb) voiceOrb = $('#voiceOrb'); return voiceOrb; }
  function voiceAnalyserStop() {
    if (voiceRaf) { try { cancelAnimationFrame(voiceRaf); } catch (e) {} voiceRaf = 0; }
    if (voiceSrc) { try { voiceSrc.disconnect(); } catch (e) {} voiceSrc = null; }
    voiceAn = null; voiceBuf = null;
  }
  function orbHide() {
    voiceAnalyserStop();
    var o = orbEl();
    if (o) { o.hidden = true; o.classList.remove('spin', 'orb', 'pulse'); o.style.transform = ''; }
  }
  /* visible card for the orb: challenge card, else the open quiz panel
     (pretest / typed / flashcard), else null = stay in the header */
  function voiceSlot() {
    var chal = $('#scr-chal'), quiz = $('#scr-quiz');
    if (chal && !chal.hidden) return $('#chal-q-card');
    if (quiz && !quiz.hidden) {
      var pre = $('#pretestPanel'), type = $('#typePanel'), flip = $('#flip');
      if (pre && !pre.hidden) return pre;
      if (type && !type.hidden) return type;
      if (flip && !flip.hidden) return flip;
    }
    return null;
  }
  function voicePlace() {
    var o = orbEl(); if (!o) return;
    var slot = voiceSlot();
    if (slot) { if (o.parentNode !== slot) slot.appendChild(o); return; }
    var home = document.querySelector('.top-right');
    if (home && o.parentNode !== home) home.insertBefore(o, home.firstChild);
  }
  function voiceShowSpin() {
    var o = orbEl(); if (!o) return;
    voiceAnalyserStop();
    voicePlace();
    o.hidden = false;
    o.classList.remove('orb', 'pulse');
    o.style.transform = '';
    o.classList.add('spin');
  }
  function voiceShowOrb(live) {
    var o = orbEl(); if (!o) return;
    voicePlace();
    o.hidden = false;
    o.classList.remove('spin');
    o.classList.add('orb');
    o.classList.toggle('pulse', !live);
    if (!live) o.style.transform = '';
  }
  /* derive the display from the three flags — callers only set flags */
  function voiceSync() {
    if (hdPlaying || sysSpeaking) return;   /* orb already up, owned by the player */
    if (voiceLoading) voiceShowSpin();
    else orbHide();
  }
  function voiceTick() {
    if (!voiceAn) return;
    voiceRaf = requestAnimationFrame(voiceTick);
    try {
      voiceAn.getByteTimeDomainData(voiceBuf);
      var sum = 0, i, d;
      for (i = 0; i < voiceBuf.length; i++) { d = (voiceBuf[i] - 128) / 128; sum += d * d; }
      var s = 1 + Math.min(0.55, Math.sqrt(sum / voiceBuf.length) * 2.4);
      var o = orbEl();
      if (o) o.style.transform = 'scale(' + s.toFixed(3) + ')';
    } catch (e) { /* analyser torn down mid-frame */ }
  }
  /* tap the live element: MediaElementSource → analyser → speakers (blob: URL
     is same-origin, so the analyser sees real levels). Fresh element per
     play(), so one source per element is always legal. */
  function voiceAttach(a) {
    voiceAnalyserStop();
    if (!a) return false;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || typeof requestAnimationFrame !== 'function') return false;
      if (!voiceAC) voiceAC = new AC();
      if (voiceAC.state === 'suspended') voiceAC.resume().catch(function () {});
      voiceSrc = voiceAC.createMediaElementSource(a);
      voiceAn = voiceAC.createAnalyser();
      voiceAn.fftSize = 256;
      voiceAn.smoothingTimeConstant = 0.55;
      voiceSrc.connect(voiceAn);
      voiceAn.connect(voiceAC.destination);
      voiceBuf = new Uint8Array(voiceAn.fftSize);
      voiceTick();
      return true;
    } catch (e) { voiceAnalyserStop(); return false; }
  }
  function onHdStatus(s) {
    /* While the pre-heat batch runs, its status lines (model compiles, asset
       downloads) are batch progress, not quiz narration — the orb stays still.
       Quiz audio during a warm is cached plays only, which the orb follows via
       onHdAudio. Resynced from the live status when the warm ends. */
    /* Batch 'loading' lines (full pre-heat or the prefetch window's
       background compile) are not quiz narration — the orb stays still. A
       real app-initiated synthesis (hdWanted) always shows the spinner,
       even mid-window. Cached plays keep the orb via onHdAudio. */
    voiceLoading = hdWanted > 0 ||
      (!warmJob && !aheadJob && !!(s && s.status === 'loading'));
    voiceSync();
  }
  function onHdAudio(ev) {
    if (!ev) return;
    if (ev.type === 'play') {
      hdPlaying = true;
      voiceShowOrb(voiceAttach(ev.audio));
    } else {   /* 'ended' | 'stop' */
      hdPlaying = false;
      voiceAnalyserStop();
      voiceSync();
    }
  }
  /* is narration currently playing? (system voices and/or the HD engine) */
  function ttsBusy() {
    try {
      if (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) return true;
    } catch (e) {}
    try {
      /* the pre-heat batch's 'loading' is batch progress, not quiz narration;
         the prefetch window's word syntheses never touch the status at all */
      if (settings.hd && window.NeuralTTS && !warmJob && NeuralTTS.status().status === 'loading') return true;
    } catch (e) {}
    return false;
  }

  /* The Spanish word currently on screen — or null when showing it would spoil
     the answer (e.g. the prompt of an en-es round before it is revealed). */
  function curEsWord() {
    var e = curEntry();
    if (!$('#scr-quiz').hidden && sess && e) {
      if (!$('#typePanel').hidden) {
        if (sess.typed === 'idle' && sess.curDir === 'en-es') return null;
        return e.es;
      }
      if ($('#flip').classList.contains('flipped')) return e.es;   /* revealed card */
      return sess.curDir === 'es-en' ? e.es : null;                /* front side */
    }
    if (!$('#scr-chal').hidden && challenge) {
      var q = challenge.qs[challenge.i];
      if (!q) return null;
      var revealed = challenge.waiting || challenge.locked;
      if (!revealed && q.d === 'en-es') return null;
      return q.es;
    }
    return null;
  }
  function sayBtn(text) {
    var b = el('button', 'say-btn');
    /* small monochrome speaker icon (scales with the text, tints on hover) */
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
      '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    b.setAttribute('aria-label', 'Pronounce: ' + text);
    b.title = 'Pronounce';
    b.addEventListener('click', function (ev) {
      if (ev) ev.stopPropagation();
      b.blur();       /* Space must advance to the next word, not re-fire this button */
      speak(text);
    });
    return b;
  }

  /* ---- typed-answer matching ---- */
  function typedMatch(target, guess) {
    if (altMatch(target, guess)) return true;   /* learner-vetted alternative */
    if (C.answerMatches(target, guess)) return true;
    /* verb tolerance: accept a conjugated form of the target infinitive */
    if (!CJ) return false;
    try {
      var t = CJ.analyze(target);
      if (!t || t.reflex) return false;           /* reflexives typed with particle — keep strict */
      var tbl = CJ.table(target);
      if (!tbl) return false;
      var g = C.normalizeAnswer(guess);
      var fm;
      for (var i = 0; i < tbl.tenses.length; i++) {
        var rows = tbl.tenses[i].rows;
        for (var k = 0; k < rows.length; k++) {
          fm = C.normalizeAnswer(rows[k][1]);
          if (fm === g) return true;
        }
      }
      if (tbl.gerund && C.normalizeAnswer(tbl.gerund) === g) return true;
      if (tbl.participle && C.normalizeAnswer(tbl.participle) === g) return true;
      if (tbl.imperative) {
        for (var p in tbl.imperative) {
          if (tbl.imperative[p] && C.normalizeAnswer(tbl.imperative[p]) === g) return true;
        }
      }
    } catch (e) { return false; }
    return false;
  }

  /* ---------------- theme ---------------- */
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    var resolved = settings.theme || (mq && mq.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = resolved;
    $('#themeBtn').textContent = resolved === 'dark' ? '☀️' : '🌙';
  }
  function toggleTheme() {
    var resolved = settings.theme || (mq && mq.matches ? 'dark' : 'light');
    settings.theme = resolved === 'dark' ? 'light' : 'dark';
    saveSettings(); applyTheme();
  }
  if (mq) mq.addEventListener('change', function () { if (!settings.theme) applyTheme(); });

  /* ---------------- start screen ---------------- */
  function renderStart() {
    var wrap = $('#levelChips');
    wrap.textContent = '';
    var counts = C.countLevels(VOCAB);
    var all = entries();
    C.LEVELS.forEach(function (lvl) {
      var on = settings.levels.indexOf(lvl) !== -1;
      var total = (counts[lvl] || 0) + state.custom.filter(function (e) { return e[2] === lvl; }).length;
      var learnedN = 0;
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        if (e.level === lvl && C.learned(state.cards[e.id])) learnedN++;
      }
      var b = el('button', 'chip' + (on ? ' on' : ''));
      b.appendChild(el('span', 'chip-name', lvl.toUpperCase()));
      b.appendChild(el('span', 'chip-count', learnedN + ' / ' + total));
      b.addEventListener('click', function () { toggleLevel(lvl); });
      wrap.appendChild(b);
    });

    $$('#dirSeg button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.dir === settings.dir);
    });
    $$('#ansSeg button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.ans === settings.ans);
    });

    /* one contextual "how to play" line — it matches the chosen answer style,
       so typed mode never shows flashcard instructions and vice versa */
    var dirLabel = settings.dir === 'es-en' ? 'Spanish → English'
                 : settings.dir === 'en-es' ? 'English → Spanish' : 'mixed directions';
    var how;
    if (settings.ans === 'type') {
      how = ['✏️ Typed', 'type the translation · <kbd>Enter</kbd> checks · empty <kbd>Enter</kbd> shows the answer · wrongly marked? <kbd>V</kbd> overrules and remembers your answer'];
    } else if (settings.ans === 'flip') {
      how = ['🃏 Flashcards', 'click or press <kbd>Space</kbd> to reveal · <kbd>1</kbd>–<kbd>4</kbd> grades'];
    } else {
      how = ['🔀 Mixed', 'typed cards (<kbd>Enter</kbd> checks · empty reveals) & flashcards (<kbd>Space</kbd> reveals) alternate'];
    }
    if (settings.tts && !settings.autoSpeak) {
      how[1] += ' · <kbd>S</kbd> says the word';
    }
    $('#dirHint').innerHTML = how[0] + ': <b>' + dirLabel + '</b> · ' + how[1];

    var act = C.eligible(all, settings.levels);
    var learnedN = 0;
    for (var j = 0; j < act.length; j++) if (C.learned(state.cards[act[j].id])) learnedN++;
    var due = C.dueCards(state, all, settings.levels).length;
    $('#startStats').textContent = '';
    $('#startStats').appendChild(statBox('⌛', 'Due now', due));
    $('#startStats').appendChild(statBox('📚', 'Learned', act.length ? Math.round(learnedN / act.length * 100) + '%' : '0%'));
    $('#startStats').appendChild(statBox('★', 'XP', state.xp));
    $('#startStats').appendChild(statBox('🔥', 'Best streak', state.best));
    renderChalList('chalListStart');
  }
  function statBox(icon, label, value) {
    var d = el('div', 'stat');
    d.appendChild(el('b', null, icon + ' ' + value));
    d.appendChild(el('span', null, label));
    return d;
  }
  function toggleLevel(lvl) {
    var i = settings.levels.indexOf(lvl);
    if (i !== -1) {
      if (settings.levels.length > 1) settings.levels.splice(i, 1);
    } else {
      settings.levels.push(lvl);
      settings.levels.sort(function (a, b) { return C.LEVELS.indexOf(a) - C.LEVELS.indexOf(b); });
    }
    saveSettings(); renderStart();
  }

  /* ---------------- review session ---------------- */
  function startSession(forcedIds) {
    if (!Array.isArray(forcedIds)) forcedIds = null;   /* click events land here too */
    var s = forcedIds
      ? { ids: forcedIds.slice(), total: forcedIds.length, dueCount: 0, newCount: 0, skippedDue: 0 }
      : C.buildSession(state, entries(), settings.levels, settings.newPerDay);
    if (forcedIds && !forcedIds.length) { toast('Nothing to practice'); return; }
    sess = {
      ids: s.ids, total: s.total, i: 0, correct: 0, xp: 0, best: 0,
      revoked: new Set(), skippedDue: s.skippedDue,
      missed: [], pre: null, preLocked: false, preWaiting: false, preCorrect: false, typed: 'idle', curDir: settings.dir
    };
    prioritizeWarm(sess.ids.map(function (id) { return entryById(id).es; }));
    if (s.total === 0) { renderDone(s.skippedDue ? 'All caught up — the rest awaits tomorrow ⏳' : 'Nothing due right now 🎉', 0); return; }
    show('scr-quiz');
    renderCard();
  }

  /* A quiz that starts while the pre-heat batch runs jumps its own words to
     the front of the warm queue — the quiz plays cached audio only, so the
     sooner the warm reaches these words, the sooner their audio is back. */
  function prioritizeWarm(esWords) {
    if (!warmJob || !warmJob.prioritize) return;
    try { warmJob.prioritize(esWords.filter(Boolean)); } catch (e) { /* best-effort */ }
  }

  /* a card the learner has never seen at all (no state, or untouched) */
  function neverSeen(e) {
    var c = state.cards[e.id];
    return !c || (c.r === 0 && c.l === 0 && c.d === 0);
  }

  function setQuizVisibility(which) {        /* 'pre' | 'flip' | 'type' */
    $('#pretestPanel').hidden = which !== 'pre';
    var flip = $('#flip');
    flip.hidden = which !== 'flip';
    /* pretest/typed panels replace the card: clear a stale answer-side state so
       the hidden card can never resurface flipped */
    if (which !== 'flip') flip.classList.remove('flipped');
    $('#typePanel').hidden = which !== 'type';
  }

  function renderCard() {
    var e = entryById(sess.ids[sess.i]);
    hideConj();
    stopSpeech();                     /* a new card opens: silence the previous word */

    var card = state.cards[e.id];
    $('#newBadge').hidden = !(card ? (card.r === 0 || C.inSteps(card)) : true);

    $('#lvlBadge').hidden = true;   /* the word's level is irrelevant while reviewing */
    if (e.cluster && C.CLUSTERS[e.cluster]) {
      $('#clsBadge').textContent = C.CLUSTERS[e.cluster].icon + ' ' + C.CLUSTERS[e.cluster].label;
      $('#clsBadge').hidden = false;
    } else { $('#clsBadge').hidden = true; }

    $('#qcount').textContent = (sess.i + 1) + ' / ' + sess.total;
    $('#qbarFill').style.width = (sess.i / sess.total * 100) + '%';

    sess.curDir = dirOf();
    prefetchAhead();   /* keep the next words' audio ready while this card is up */
    var useType = settings.ans === 'type' || (settings.ans === 'mix' && Math.random() < 0.5);
    if (useType) { renderTypeCard(e); return; }
    if (settings.pretest && neverSeen(e)) { renderPretest(e); return; }
    renderFlipCard(e);
  }

  /* ---------- flashcard mode ---------- */
  /* answerUp: render straight to the ANSWER side (where the grade buttons live —
     EN face for es-en, ES face for en-es). Used after a pretest: the learner
     rates immediately, without a meaningless extra flip of a stale card. */
  function renderFlipCard(e, answerUp) {
    var dir = sess.curDir;
    var front = dir === 'es-en' ? e.es : e.en;
    var back = dir === 'es-en' ? e.en : e.es;
    var flip = $('#flip');
    var faces = $$('#flip .face');
    flip.classList.remove('flipped', 'reload');
    flip.style.transition = 'none';
    faces.forEach(function (f) { f.style.transition = 'none'; });
    void flip.offsetWidth;                 /* snap back without animating */
    if (answerUp) flip.classList.add('flipped');
    void flip.offsetWidth;                 /* commit (possibly answer-up) while transitions are off */
    flip.style.transition = '';
    faces.forEach(function (f) { f.style.transition = ''; });
    flip.classList.add('reload');
    renderWord($('#frontWord'), front, dir === 'es-en');
    renderWord($('#backWord'), back, dir === 'en-es');
    setQuizVisibility('flip');
  }

  function flipCard() {
    var flip = $('#flip');
    flip.classList.toggle('flipped');
    /* autoSpeak: hear the Spanish word the moment the card reveals it */
    if (settings.tts && settings.autoSpeak && flip.classList.contains('flipped')) {
      var e = curEntry();
      if (e) speak(e.es);
    }
  }

  /* ---------- pretest (new words, flashcard mode) ---------- */
  /* The pretest is self-grading, one try: first-try correct commits grade 'good',
     a wrong guess commits an 'again'-style step restart (no lapse marking — the
     card was never studied). There is NO rating card afterwards. */
  function renderPretest(e) {
    var q = C.buildPretest(entries(), e, sess.curDir);
    sess.pre = q; sess.preLocked = false; sess.preWaiting = false; sess.preCorrect = false;
    $('#preFb').hidden = true;
    renderWord($('#preWord'), q.d === 'es-en' ? q.es : q.en, false, true);
    var wrap = $('#preOpts');
    wrap.textContent = '';
    q.opts.forEach(function (opt, idx) {
      var b = el('button', null, '');
      renderWord(b, opt);
      b.addEventListener('click', function () { preAnswer(idx); });
      wrap.appendChild(b);
    });
    setQuizVisibility('pre');
  }

  function preAnswer(idx) {
    if (!sess || !sess.pre || sess.preLocked) return;
    sess.preLocked = true;
    var q = sess.pre;
    var btns = $$('#preOpts button');
    var chosen = btns[idx];
    var ok = chosen.textContent.trim().toLowerCase() === q.answer.trim().toLowerCase();
    sess.preCorrect = ok;
    if (ok) {
      chosen.classList.add('right');
      sndGood();
      revealPair($('#preFb'), $('#preFbQ'), $('#preFbA'), q.es, q.en, q.d, 'ok');
    } else {
      chosen.classList.add('wrong');
      sndBad();
      revealPair($('#preFb'), $('#preFbQ'), $('#preFbA'), q.es, q.en, q.d, 'miss');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === q.answer.trim().toLowerCase()) { btns[i].classList.add('right'); break; }
      }
    }
    btns.forEach(function (b) { b.classList.add('lock'); });
    /* the feedback holds until the learner advances (click anywhere on the
       panel, Space or Enter) — nothing disappears on a timer */
    sess.preWaiting = true;
  }

  /* leave the pretest feedback: commit the self-grade and move straight to the
     next card. quiet: the pick already played its sound. */
  function preAdvance() {
    if (!sess || !sess.pre || !sess.preWaiting) return;
    var ok = !!sess.preCorrect;
    sess.pre = null;
    sess.preWaiting = false;
    grade(ok ? 2 : 0, ok ? { quiet: true } : { quiet: true, pretest: true });
  }

  /* ---------- typed mode ---------- */
  var TYPE_ASK = ['#typeDir', '#typeWord', '#typeInput'];
  /* 'ask': show the question and the answer input.
     'reveal': show only the "question = answer" row. checkType() re-shows the input
     afterwards so the learner's own green/red answer stays visible above it —
     a peek has nothing to show there and leaves it hidden. */
  function setTypeMode(ask) {
    TYPE_ASK.forEach(function (sel) {
      var n = document.querySelector(sel);
      if (n) n.hidden = !ask;
    });
  }

  function renderTypeCard(e) {
    var dir = sess.curDir;
    $('#typeDir').textContent =
      (settings.ans === 'mix' ? '✏️ ' : '') +
      (dir === 'es-en' ? 'Spanish → type the English meaning' : 'English → type the Spanish word') +
      ' · accents & articles optional';
    renderWord($('#typeWord'), dir === 'es-en' ? e.es : e.en, dir === 'es-en');
    var inp = $('#typeInput');
    inp.value = ''; inp.disabled = false;
    inp.classList.remove('ok', 'bad');
    $('#typeFb').hidden = true;
    $('#typeVerdict').hidden = true;
    $('#typeNext').hidden = true;
    $('#typeVeto').hidden = true;
    sess.typed = 'idle';
    setTypeMode(true);
    setQuizVisibility('type');
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) inp.focus();
  }

  function typeTarget(e, dir) { return dir === 'es-en' ? e.en : e.es; }

  /* Simple reveal: "question word = correct answer" in one row, answer prominent.
     The play button rides on the Spanish side; nothing speaks automatically.
     state: 'ok' (green answer) | 'miss' (red answer) | 'peek' (neutral). */
  function fillReveal(node, txt, withPlay) {
    node.textContent = '';
    node.appendChild(document.createTextNode(txt));
    if (withPlay) node.appendChild(sayBtn(txt));
  }

  /* one-shot color flash on a typed reveal block — green for a correct answer,
     red for a miss. The animation runs once; the resting fb-ok/fb-bad style stays. */
  function flashFb(fb, state) {
    if (!fb) return;
    fb.classList.remove('flash-ok', 'flash-bad');
    if (state === 'ok') fb.classList.add('flash-ok');
    else if (state === 'miss') fb.classList.add('flash-bad');
  }

  function revealPair(fb, qEl, aEl, es, en, dir, state) {
    fb.hidden = false;
    fb.classList.remove('fb-ok', 'fb-bad');
    if (state === 'ok') fb.classList.add('fb-ok');
    else if (state === 'miss') fb.classList.add('fb-bad');
    var q = dir === 'es-en' ? es : en;      /* the question word as shown */
    var a = dir === 'es-en' ? en : es;      /* the correct answer */
    fillReveal(qEl, q, dir === 'es-en');
    fillReveal(aEl, a, dir === 'en-es');
    /* production prompt: hear the word right as it is revealed (autoSpeak setting) */
    if (settings.tts && settings.autoSpeak) speak(es);
  }

  /* big ✓ / ✗ verdict line — the headed feedback for a typed answer */
  function setVerdict(node, state) {
    if (!node) return;
    node.classList.remove('ok', 'bad');
    if (state === 'ok') { node.textContent = '✓ Correct!'; node.classList.add('ok'); node.hidden = false; }
    else if (state === 'veto') { node.textContent = '✓ Accepted — remembered as an alternative'; node.classList.add('ok'); node.hidden = false; }
    else if (state === 'miss') { node.textContent = '✗ Not quite'; node.classList.add('bad'); node.hidden = false; }
    else node.hidden = true;                 /* peek stays neutral */
  }

  /* whole-card color wash so the outcome cannot be missed */
  function flashPanel(panel, state) {
    if (!panel) return;
    panel.classList.remove('panel-flash-ok', 'panel-flash-bad');
    if (state === 'ok') panel.classList.add('panel-flash-ok');
    else if (state === 'miss') panel.classList.add('panel-flash-bad');
  }

  function revealType(e, dir, state) {
    setTypeMode(false);                       /* keep the colored input on screen beside the answer */
    revealPair($('#typeFb'), $('#typeFbQ'), $('#typeFbA'), e.es, e.en, dir, state);
    setVerdict($('#typeVerdict'), state);
    flashFb($('#typeFb'), state);
    flashPanel($('#typePanel'), state);
    if (state === 'ok') sndGood(); else if (state === 'miss') sndBad();
  }

  /* every typed outcome stays on screen until the learner says so:
     click anywhere, Space or Enter → graded ('good' when correct, 'again' otherwise) */
  function awaitType() {
    $('#typeNext').hidden = false;
  }

  function continueTyped() {
    if (!sess || sess.typed === 'idle') return;
    grade(sess.typed === 'ok' ? 2 : 0);
  }

  function checkType() {
    if (!sess || sess.typed !== 'idle') return;
    var e = entryById(sess.ids[sess.i]);
    var dir = sess.curDir;
    var guess = $('#typeInput').value;
    if (!guess.trim()) { peekType(); return; }   /* empty Enter = don't know → reveal */
    var ok = typedMatch(typeTarget(e, dir), guess);
    sess.typed = ok ? 'ok' : 'miss';
    var inp = $('#typeInput');
    inp.disabled = true;
    inp.classList.remove('ok', 'bad');
    inp.classList.add(ok ? 'ok' : 'bad');     /* instant: the typed word turns green/red */
    revealType(e, dir, ok ? 'ok' : 'miss');
    inp.hidden = false;                       /* the colored answer stays above the reveal */
    /* wrong according to the app, but the learner may overrule (✋ / V) */
    $('#typeVeto').hidden = ok;
    /* correct, wrong or peeked: the correct answer stays on screen until
       the learner advances (click, Space or Enter) */
    awaitType();
  }

  /* the learner overrules a marked-wrong typed answer: accept it now and
     remember it locally as a correct alternative for this word */
  function vetoType() {
    if (!sess || sess.typed !== 'miss') return;
    var e = entryById(sess.ids[sess.i]);
    addAlt(typeTarget(e, sess.curDir), $('#typeInput').value);
    sess.typed = 'ok';                        /* advancing will grade this as 'good' */
    var inp = $('#typeInput');
    inp.classList.remove('bad');
    inp.classList.add('ok');
    $('#typeVeto').hidden = true;
    var fb = $('#typeFb');
    fb.classList.remove('fb-bad');
    fb.classList.add('fb-ok');
    flashFb(fb, 'ok');
    flashPanel($('#typePanel'), 'ok');
    setVerdict($('#typeVerdict'), 'veto');
    sndGood();
  }

  function peekType() {
    if (!sess || sess.typed !== 'idle') return;
    var e = entryById(sess.ids[sess.i]);
    sess.typed = 'peek';
    $('#typeInput').disabled = true;
    $('#typeVeto').hidden = true;
    revealType(e, sess.curDir, 'peek');
    awaitType();
  }

  /* opts.quiet:   outcome sounds already played (pretest pick) — don't double-fire
     opts.pretest: failed FIRST-CONTACT guess → 'again' scheduling without lapse
                   marking (forwarded to Core.applyGrade) */
  function grade(q, opts) {
    if (!sess) return;
    var id = sess.ids[sess.i];
    C.applyGrade(state, id, q, null, opts);
    state.total++;
    if (q === 0) {
      state.streak = 0;
      if (!sess.revoked.has(id)) { sess.revoked.add(id); sess.ids.push(id); sess.total++; }
      /* remember for the "words to watch" recap */
      var e = entryById(id);
      if (e && !sess.missed.some(function (m) { return m.id === id; })) sess.missed.push({ id: id, es: e.es, en: e.en });
      if (!(opts && opts.quiet)) sndBad();
    } else {
      state.correct++;
      state.streak++;
      state.best = Math.max(state.best, state.streak);
      state.xp += C.xpFor(q);
      sess.correct++;
      sess.xp += C.xpFor(q);
      sess.best = Math.max(sess.best, state.streak);
      if (!(opts && opts.quiet)) sndGood();
    }
    saveState();
    refreshPills();
    sess.i++;
    if (sess.i >= sess.ids.length) endSession();
    else renderCard();
    /* no toast after grading: the requeue / learning-step mechanics are visible
       from the flow itself (the word simply comes back), so popups were noise */
  }

  function endSession() {
    var reviewed = sess.i;
    renderDone('Session complete 🎉', reviewed);
  }

  /* ---------- recap: missed words ---------- */
  function renderRecap(list, listId, boxId) {
    var box = document.getElementById(boxId || 'recapBox');
    var wrap = document.getElementById(listId || 'recapList');
    wrap.textContent = '';
    if (!list || !list.length) { box.hidden = true; return; }
    list.forEach(function (m) {
      var row = el('div', 'recap-item');
      row.appendChild(el('span', 'recap-es', m.es));
      row.appendChild(el('span', 'muted', ' — ' + m.en));
      row.appendChild(sayBtn(m.es));
      wrap.appendChild(row);
    });
    box.hidden = false;
  }

  function practiceMissed() {
    if (!sess || !sess.missed) return;
    var seen = {};
    var ids = [];
    sess.missed.forEach(function (m) {
      if (!seen[m.id]) { seen[m.id] = true; ids.push(m.id); }
    });
    startSession(ids.slice(0, 25));
  }

  /* ---------------- done screen ---------------- */
  function renderDone(title, reviewed) {
    $('#doneTitle').textContent = title;
    $('#doneStats').textContent = '';
    $('#doneStats').appendChild(statBox('🃏', 'Reviewed', reviewed));
    $('#doneStats').appendChild(statBox('✅', 'Correct', sess && sess.total ? Math.round(sess.correct / sess.total * 100) + '%' : '—'));
    $('#doneStats').appendChild(statBox('★', 'XP gained', sess ? sess.xp : 0));
    $('#doneStats').appendChild(statBox('🔥', 'Best streak', sess ? sess.best : state.best));

    renderRecap(sess && sess.missed, 'recapList', 'recapBox');
    $('#doneTip').hidden = !(reviewed > 0);

    /* sometimes a challenge pops up */
    var offer = C.pickChallengeOffer(state, entries(), settings.levels);
    var box = $('#chalOffer');
    if (offer && Math.random() < 0.6) {
      var def = C.CLUSTERS[offer.key];
      $('#chalOfferTitle').textContent = def.icon + ' ' + def.label;
      box.hidden = false;
      box._key = offer.key;
    } else { box.hidden = true; }

    renderChalList();
    show('scr-done');
  }

  function renderChalList(hostId) {
    var wrap = document.getElementById(hostId || 'chalList');
    wrap.textContent = '';
    var cands = C.challengeCandidates(state, entries(), settings.levels);
    cands.forEach(function (cand) {
      var def = cand.def;
      var tile = el('button', 'chal-tile');
      tile.appendChild(el('span', 'chal-tile-icon', def.icon));
      tile.appendChild(el('span', 'chal-tile-name', def.label));
      tile.appendChild(el('span', 'chal-tile-sub', cand.words.length + ' words'));
      tile.addEventListener('click', function () { startChallenge(cand.key); });
      wrap.appendChild(tile);
    });
  }

  /* ---------------- cluster challenge ---------------- */
  function startChallenge(key) {
    var qs = C.buildChallenge(state, entries(), settings.levels, key, settings.dir);
    /* per-question answer format fixed at build time (matters in Mixed mode:
       a replayed question keeps the format it was asked in) */
    qs.forEach(function (q) {
      q.typed = settings.ans === 'type' || (settings.ans === 'mix' && Math.random() < 0.5);
    });
    challenge = {
      key: key,
      qs: qs,
      i: 0, correct: 0, streak: 0, best: 0, xp: 0, locked: false,
      mainLen: qs.length, asked: qs.length, round: 0,
      missed: [], allMissed: [], chInput: false, waiting: false
    };
    if (!qs.length) { toast('Not enough words in this cluster yet'); return; }
    prioritizeWarm(qs.map(function (q) { return q.es; }));
    var def = C.CLUSTERS[key];
    $('#chCluster').textContent = def.icon + ' ' + def.label;
    show('scr-chal');
    renderChalQ();
    sndTic();
  }

  /* typed round chrome: question + input (ask) vs. only the reveal row.
     chCheckType() re-shows the input afterwards so the green/red answer stays
     visible; a peek has nothing to show there and leaves it hidden. */
  function setChalAskMode(ask) {
    $('#chDir').hidden = !ask;
    $('#chWord').hidden = !ask;
    $('#chTypeInput').hidden = !ask;
  }

  function renderChalQ() {
    var q = challenge.qs[challenge.i];
    hideConj();
    stopSpeech();                     /* a new question opens: silence the previous word */
    $('#chDir').textContent =
      (settings.ans === 'mix' ? (q.typed ? '✏️ ' : '🃏 ') : '') +
      (q.d === 'es-en' ? 'Spanish → English' : 'English → Spanish') + (q.typed ? ' · type your answer' : '');
    /* challenge words stay untagged: no conjugation card in these rounds */
    renderWord($('#chWord'), q.d === 'es-en' ? q.es : q.en, q.d === 'es-en', true);
    var wrap = $('#chOpts');
    wrap.textContent = '';
    var tw = $('#chTypeWrap');
    var inp = $('#chTypeInput');
    var fb = $('#chTypeFb');
    setChalAskMode(true);                       /* back to the ask layout for every new question */
    if (q.typed) {
      wrap.hidden = true;
      tw.hidden = false;
      inp.value = ''; inp.disabled = false;
      inp.classList.remove('ok', 'bad');
      $('#chTypeNext').hidden = true;
      $('#chTypeVeto').hidden = true;
      fb.hidden = true;
      fb.classList.remove('fb-ok', 'fb-bad');
      $('#chTypeVerdict').hidden = true;
      challenge.chInput = true;
      challenge.waiting = false;
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) inp.focus();
    } else {
      wrap.hidden = false;
      tw.hidden = true;
      challenge.chInput = false;
      challenge.waiting = false;
      q.opts.forEach(function (opt, idx) {
        var b = el('button', null, '');
        renderWord(b, opt);
        b.addEventListener('click', function () { chAnswer(idx); });
        wrap.appendChild(b);
      });
    }
    $('#chCount').textContent = (challenge.i + 1) + ' / ' + challenge.qs.length;
    $('#chBarFill').style.width = (challenge.i / challenge.qs.length * 100) + '%';
    prefetchAhead();   /* keep the next questions' audio ready while this one is up */
    var card = $('#chal-q-card');
    if (card) { card.classList.remove('reload'); void card.offsetWidth; card.classList.add('reload'); }
    challenge.locked = false;
  }

  function chAnswer(idx) {
    if (!challenge || challenge.locked) return;
    challenge.locked = true;
    var q = challenge.qs[challenge.i];
    var btns = $$('#chOpts button');
    var chosen = btns[idx];
    var ok = chosen.textContent.trim().toLowerCase() === q.answer.trim().toLowerCase();
    if (ok) {
      chosen.classList.add('right');
      challenge.correct++; challenge.streak++;
      challenge.best = Math.max(challenge.best, challenge.streak);
      sndGood();
    } else {
      chosen.classList.add('wrong');
      challenge.streak = 0;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === q.answer.trim().toLowerCase()) { btns[i].classList.add('right'); break; }
      }
      challenge.missed.push(q);
      pushMissed(q);
      sndBad();
    }
    btns.forEach(function (b) { b.classList.add('lock'); });
    /* autoSpeak: the answer (and in es-en questions, the word itself) is now shown */
    if (settings.tts && settings.autoSpeak) speak(q.es);
    advanceAfterSpeech(620);
  }

  /* MC rounds advance automatically — but only once the revealed word has been
     heard: hold the resolution while TTS is talking (capped, in case speech is
     unavailable or stuck), so the next question never opens mid-word. */
  function advanceAfterSpeech(minMs) {
    var t0 = Date.now();
    (function tick() {
      if (!challenge) return;                    /* aborted meanwhile */
      var dt = Date.now() - t0;
      var busy = settings.tts && settings.autoSpeak ? ttsBusy() : false;
      if (dt >= minMs && (!busy || dt >= 3200)) chAdvance();
      else setTimeout(tick, 80);
    })();
  }

  /* Prominent reveal for typed challenge answers — same pair row as the review. */
  function revealChal(q, state) {
    setChalAskMode(false);                    /* only the reveal row remains on screen */
    revealPair($('#chTypeFb'), $('#chTypeFbQ'), $('#chTypeFbA'), q.es, q.en, q.d, state);
    setVerdict($('#chTypeVerdict'), state);
    flashFb($('#chTypeFb'), state);
    flashPanel($('#chTypeWrap'), state);      /* wash the typed round — never the card (its reload animation) */
    if (state === 'ok') sndGood(); else if (state === 'miss') sndBad();
  }

  function chCheckType() {
    if (!challenge || challenge.locked || !challenge.chInput) return;
    var q = challenge.qs[challenge.i];
    var guess = $('#chTypeInput').value;
    if (!guess.trim()) { chPeekType(); return; }   /* empty Enter = don't know → reveal */
    challenge.locked = true;
    challenge.chInput = false;
    var target = q.d === 'es-en' ? q.en : q.es;
    var ok = typedMatch(target, guess);
    var inp = $('#chTypeInput');
    inp.disabled = true;
    inp.classList.remove('ok', 'bad');
    inp.classList.add(ok ? 'ok' : 'bad');     /* instant: the typed word turns green/red */
    if (ok) {
      challenge.correct++; challenge.streak++;
      challenge.best = Math.max(challenge.best, challenge.streak);
    } else {
      challenge.streak = 0;
      challenge.missed.push(q);
      pushMissed(q);
    }
    revealChal(q, ok ? 'ok' : 'miss');
    inp.hidden = false;                 /* the colored answer stays above the reveal */
    /* wrong according to the app, but the learner may overrule (✋ / V) */
    $('#chTypeVeto').hidden = ok;
    /* correct, wrong or peeked: the correct answer stays on screen until
       the learner advances (click, Space or Enter) */
    challenge.waiting = true;
    $('#chTypeNext').hidden = false;
  }

  /* the learner overrules a marked-wrong typed challenge answer: accept it and
     remember it locally as a correct alternative for this word */
  function vetoChal() {
    if (!challenge || !challenge.waiting || $('#chTypeVeto').hidden) return;
    var q = challenge.qs[challenge.i];
    addAlt(q.d === 'es-en' ? q.en : q.es, $('#chTypeInput').value);
    /* undo the miss bookkeeping: no replay round, no recap row */
    var mi = challenge.missed.lastIndexOf(q);
    if (mi !== -1) challenge.missed.splice(mi, 1);
    for (var i = 0; i < challenge.allMissed.length; i++) {
      if (challenge.allMissed[i].id === q.id) { challenge.allMissed.splice(i, 1); break; }
    }
    challenge.correct++; challenge.streak++;
    challenge.best = Math.max(challenge.best, challenge.streak);
    var inp = $('#chTypeInput');
    inp.classList.remove('bad');
    inp.classList.add('ok');
    $('#chTypeVeto').hidden = true;
    var fb = $('#chTypeFb');
    fb.classList.remove('fb-bad');
    fb.classList.add('fb-ok');
    flashFb(fb, 'ok');
    flashPanel($('#chTypeWrap'), 'ok');
    setVerdict($('#chTypeVerdict'), 'veto');
    sndGood();
  }

  function chPeekType() {
    if (!challenge || challenge.locked || !challenge.chInput) return;
    var q = challenge.qs[challenge.i];
    challenge.locked = true;
    challenge.chInput = false;
    challenge.streak = 0;
    challenge.missed.push(q);
    pushMissed(q);
    revealChal(q, 'peek');
    $('#chTypeInput').disabled = true;
    $('#chTypeVeto').hidden = true;
    challenge.waiting = true;
    $('#chTypeNext').hidden = false;
  }

  function continueChalTyped() {
    if (!challenge || !challenge.waiting) return;
    challenge.waiting = false;
    chAdvance();
  }

  function pushMissed(q) {
    if (!challenge.allMissed.some(function (m) { return m.id === q.id; })) challenge.allMissed.push(q);
  }

  function chAdvance() {
    if (!challenge) return;                    /* aborted meanwhile */
    challenge.i++;
    if (challenge.i >= challenge.qs.length) {
      /* one replay round of the missed items — errors get re-attempted, then we stop */
      if (challenge.round === 0 && challenge.missed.length) {
        var replay = challenge.missed.slice();
        challenge.missed = [];
        challenge.round = 1;
        challenge.i = 0;
        challenge.qs = C.shuffle(replay);
        challenge.asked += challenge.qs.length;
        renderChalQ();
        return;
      }
      finishChallenge();
      return;
    }
    renderChalQ();
  }

  function finishChallenge() {
    var asked = challenge.asked;
    var xp = 10 + 2 * challenge.correct + (challenge.best >= 8 ? 10 : challenge.best >= 5 ? 5 : 0);
    state.xp += xp;
    var prev = state.chalDone[challenge.key] || { n: 0 };
    state.chalDone[challenge.key] = { n: prev.n + 1 };
    saveState();
    refreshPills();

    $('#chdTitle').textContent = 'Challenge complete';
    $('#chdStats').textContent = '';
    $('#chdStats').appendChild(statBox('🎯', 'Score', challenge.correct + ' / ' + asked));
    $('#chdStats').appendChild(statBox('🔥', 'Best streak', challenge.best));
    $('#chdStats').appendChild(statBox('★', 'XP earned', '+' + xp));
    $('#chdStats').appendChild(statBox('🗂️', 'Cluster', C.CLUSTERS[challenge.key].label));
    /* recap of missed words */
    renderRecap(challenge.allMissed.map(function (q) { return { id: q.id, es: q.es, en: q.en }; }), 'chdRecapList', 'chdRecap');
    show('scr-chaldone');
    toast('+' + xp + ' XP for the ' + C.CLUSTERS[challenge.key].label + ' challenge ⚡');
    challenge = null;
  }

  /* ---------------- import / settings ---------------- */
  function openModal() {
    $('#modal').hidden = false;
    $('#setNew').value = settings.newPerDay;
    $('#setNewVal').textContent = settings.newPerDay + ' / day';
    $('#setSound').checked = !!settings.sound;
    $('#setPretest').checked = !!settings.pretest;
    $('#setTts').checked = !!settings.tts;
    fillVoiceUI();
    refreshVoices();          /* voices may have loaded since last open */
    $('#importMsg').textContent = '';
  }
  function closeModal() { $('#modal').hidden = true; }

  /* ---- voice settings UI ---- */
  function voiceLabel(v) {
    var bits = [v.name, v.lang];
    if (v.localService === false) bits.push('network');
    return bits.join(' · ');
  }
  /* HD neural pickers — two-step: model first, then a voice of that model.
     settings.hdEngine is new; older stored settings only carry hdVoice, so
     the model is derived from the voice when hdEngine is missing/invalid. */
  function engineOfVoice(voiceId) {
    if (window.NeuralTTS && NeuralTTS.voices[voiceId]) return NeuralTTS.voices[voiceId].engine;
    if (/^st-/.test(voiceId || '')) return 'supertonic';
    if (/^es_/.test(voiceId || '')) return 'piper';
    return 'kokoro';
  }
  function hdEngineOrder() {
    if (window.NeuralTTS && NeuralTTS.engineOrder && NeuralTTS.engineOrder.length) {
      return NeuralTTS.engineOrder.slice();
    }
    var order = [];
    Object.keys(window.NeuralTTS ? NeuralTTS.voices : {}).forEach(function (id) {
      var e = NeuralTTS.voices[id].engine;
      if (order.indexOf(e) === -1) order.push(e);
    });
    return order;
  }
  function fillHdVoices(engine) {
    var hdSel = $('#setHdVoice');
    hdSel.innerHTML = '';
    Object.keys(NeuralTTS.voices).forEach(function (id) {
      var v = NeuralTTS.voices[id];
      if (v.engine !== engine) return;
      var o = el('option', '', v.label);
      o.value = id;
      hdSel.appendChild(o);
    });
    var firstOpt = hdSel.querySelector('option');
    if (!NeuralTTS.voices[settings.hdVoice] || NeuralTTS.voices[settings.hdVoice].engine !== engine) {
      settings.hdVoice = firstOpt ? firstOpt.value : settings.hdVoice;
    }
    hdSel.value = settings.hdVoice;
  }
  function fillVoiceUI() {
    if (!$('#modal') || !$('#setVoice')) return;
    /* the whole engine block only makes sense when speaking is enabled */
    $('#voiceBox').hidden = !settings.tts;
    $('#setAutoSpeak').checked = !!settings.autoSpeak;
    /* system-voice dropdown: Auto first, then ranked es voices */
    var sel = $('#setVoice');
    sel.innerHTML = '';
    var auto = el('option', '', 'Auto — best available');
    auto.value = '';
    sel.appendChild(auto);
    for (var i = 0; i < esVoices.length; i++) {
      var o = el('option', '', voiceLabel(esVoices[i]));
      o.value = esVoices[i].voiceURI;
      sel.appendChild(o);
    }
    sel.disabled = esVoices.length === 0;
    if (!esVoices.some(function (v) { return v.voiceURI === settings.voiceURI; })) settings.voiceURI = '';
    sel.value = settings.voiceURI || '';
    /* HD neural pickers — model first, then the voices of that model. */
    if (window.NeuralTTS) {
      var order = hdEngineOrder();
      var engSel = $('#setHdEngine');
      engSel.innerHTML = '';
      order.forEach(function (e) {
        var meta = (NeuralTTS.engines && NeuralTTS.engines[e]) || { label: e, desc: '' };
        var o = el('option', '', meta.desc ? meta.label + ' — ' + meta.desc : meta.label);
        o.value = e;
        engSel.appendChild(o);
      });
      var curEngine = engineOfVoice(settings.hdVoice);
      if (order.indexOf(settings.hdEngine) !== -1) curEngine = settings.hdEngine;
      else if (order.indexOf(curEngine) === -1) curEngine = order[0];
      settings.hdEngine = curEngine;
      engSel.value = curEngine;
      fillHdVoices(curEngine);
      $('#setHd').checked = !!settings.hd;
      $('#hdVoiceRow').hidden = !settings.hd;
    }
    /* speed slider (stored as multiplier, shown as %) */
    var ratePct = Math.round((Number(settings.rate) || 0.92) * 100);
    $('#setRate').value = ratePct;
    $('#setRateVal').textContent = ratePct + '%';
    updateHdStatus();
    renderWarm();
  }
  function updateHdStatus() {
    var node = $('#hdStatus');
    if (!node) return;
    var s = window.NeuralTTS ? NeuralTTS.status() : { status: 'idle', detail: '' };
    if (!settings.hd) { node.textContent = ''; return; }
    if (s.status === 'loading') node.textContent = '⏳ ' + s.detail;
    else if (s.status === 'ready') node.textContent = '✓ HD voice ready';
    else if (s.status === 'error') node.textContent = '⚠ ' + s.detail + ' — staying silent (system-voice fallback is off)';
    else node.textContent = '';
  }
  /* 🔊 next to the voice pickers: speaks a random sample sentence with the
     *selected* controls (settings are already persisted by their change
     handlers). A different sentence each time, so switching models/voices
     is judged on fresh material; never the same one twice in a row. */
  var VOICE_SAMPLES = [
    'Hola, así suena esta voz.',
    'El zapato cruza la plaza al atardecer.',
    'La niña canta una canción en el jardín.',
    '¿Puedes decirme dónde está la estación?',
    'El cielo está lleno de estrellas esta noche.',
    'Me encanta el olor a pan recién hecho.',
    'Los jueves jugamos al fútbol con mis primos.',
    'La biblioteca cierra a las ocho en punto.',
    'Qué alegría verte después de tanto tiempo.',
    'El zorro corre entre los árboles del bosque.',
    'Mañana pasearemos por el río hasta el puente viejo.',
    'No olvides comprar pan, leche y tomates en el mercado.',
    '¿Cuánto cuesta el billete de ida y vuelta a Sevilla?',
    'El concierto se ha aplazado hasta la semana que viene.',
    'Caminábamos despacio porque la lluvia empapaba las calles.',
    'Ayer vimos una película fabulosa en el cine del barrio.',
    'El gato duerme encima de la silla del comedor.',
    '¿Sabes si el tren llega puntual los domingos?',
    'Prefiero el té verde con un chorrito de miel.',
    'Los niños sueltan cometas en la colina del parque.',
    'Este verano quiero visitar Galicia y probar su cocina.',
    'El verano pasado trabajé en una tienda de deportes.',
    'Después de comer, damos un paseo alrededor de la plaza.',
    'La llave de la casa está en el cajón de la cocina.',
    'Nos abrazamos en el andén antes de despedirnos.'
  ];
  var lastSample = -1;
  function voiceSample() {
    var i = Math.floor(Math.random() * VOICE_SAMPLES.length);
    if (i === lastSample) i = (i + 1) % VOICE_SAMPLES.length;
    lastSample = i;
    return VOICE_SAMPLES[i];
  }
  function previewVoice() {
    if (!window.NeuralTTS) return;
    var sample = voiceSample();
    if ($('#setHd').checked && !$('#hdVoiceRow').hidden) {
      NeuralTTS.speak(sample, { voice: $('#setHdVoice').value, rate: settings.rate })
        .catch(function () { /* stay silent; the ⚠ status line shows the reason */ });
      return;
    }
    var saved = settings.voiceURI;
    settings.voiceURI = $('#setVoice').value || '';
    speakSystem(sample);
    settings.voiceURI = saved;
  }

  /* ---- pre-heat the Supertonic Opus word cache ---- */
  /* A one-time background job that synthesizes every Spanish word with the
     selected Supertonic voice and stores it, so later repeats play instantly
     offline with no model load. Shows progress (bar + count) in settings. */
  var warmJob = null;         /* in-flight warmCache promise (also carries .cancel) */
  var warmProg = null;        /* latest { done, skipped, failed, total, percent } */
  var warmCancelled = false;

  /* every distinct Spanish word in the deck (built-ins + imports), deduped */
  function warmWordList() {
    var seen = {}, out = [];
    var all = entries();
    for (var i = 0; i < all.length; i++) {
      var w = all[i].es;
      if (!seen[w]) { seen[w] = true; out.push(w); }
    }
    return out;
  }
  /* the Opus word cache only exists for the Supertonic engine */
  function warmEngineOk() {
    return !!(window.NeuralTTS && NeuralTTS.voices[settings.hdVoice] &&
      NeuralTTS.voices[settings.hdVoice].engine === 'supertonic');
  }
  function fmtBytes(n) {
    if (!n) return '0 B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function refreshCacheStats() {
    if (!window.NeuralTTS || !window.NeuralTTS.cacheStats) return;
    NeuralTTS.cacheStats().then(function (s) {
      var node = $('#cacheStats');
      if (node) node.textContent = 'Cached audio: ' + fmtBytes(s.bytes) + ' · ' + s.count + ' words';
      var btn = $('#clearCacheBtn');
      if (btn) btn.disabled = !s.count || !!warmJob || !!aheadJob;
      /* show the resume progress only when the box is on screen (a Supertonic
         voice is selected) — otherwise keep the bar out of the way */
      var box = $('#warmBox');
      if (box && box.hidden) return;
      if (!warmJob && s.count > 0) {
        var total = warmWordList().length;
        if (total) {
          var cached = Math.min(s.count, total);
          $('#warmProgress').hidden = false;
          $('#warmFill').style.width = Math.round(cached / total * 100) + '%';
          $('#warmCount').textContent = cached + ' / ' + total + ' cached';
        }
      }
    }).catch(function () {});
    if (window.NeuralTTS.modelCached) {
      NeuralTTS.modelCached().then(function (cached) {
        var n = $('#modelStatus');
        if (!n) return;
        var s = window.NeuralTTS.status();
        if (s && s.status === 'loading') {
          n.textContent = '⤓ ' + (s.detail || 'loading Supertonic model…');
        } else {
          n.textContent = cached ? '✓ Supertonic model already downloaded' : '⤓ Model downloads on the first run, then stays cached';
        }
      }).catch(function () {});
    }
  }
  function renderWarm() {
    var box = $('#warmBox'), btn = $('#warmBtn');
    if (!box || !btn) return;
    var ok = !!settings.hd && warmEngineOk();
    box.hidden = !ok;
    refreshCacheStats();
    if (!ok) return;
    var running = !!warmJob;
    btn.disabled = running;
    $('#warmCancel').hidden = !running;
    var prog = $('#warmProgress');
    if (warmProg && warmProg.total) {
      prog.hidden = false;
      $('#warmFill').style.width = (warmProg.percent || 0) + '%';
      $('#warmCount').textContent = (warmProg.done + warmProg.skipped) + ' / ' + warmProg.total + ' cached';
    } else {
      prog.hidden = true;
    }
  }
  function startWarm() {
    if (!window.NeuralTTS || !window.NeuralTTS.warmCache) return;
    if (warmJob) return;
    var words = warmWordList();
    if (!words.length) { toast('No words to warm'); return; }
    var begin = function () {
      warmCancelled = false;
      warmProg = { done: 0, skipped: 0, failed: 0, total: words.length, percent: 0 };
      $('#warmBtn').disabled = true;
      $('#warmCancel').hidden = false;
      $('#warmProgress').hidden = false;
      $('#warmFill').style.width = '0%';
      $('#warmCount').textContent = '0 / ' + words.length + ' cached';
      $('#warmMsg').textContent = 'warming…';
      warmJob = NeuralTTS.warmCache(words, { voice: settings.hdVoice, rate: settings.rate }, function (p) {
        warmProg = p;
        $('#warmFill').style.width = (p.percent || 0) + '%';
        $('#warmCount').textContent = (p.done + p.skipped) + ' / ' + p.total + ' cached';
        var left = p.total - (p.done + p.skipped + p.failed);
        $('#warmMsg').textContent = left > 0 ? 'warming… ' + left + ' remaining' : '';
      }).then(function () {
        warmJob = null;
        warmResyncOrb();   /* warm's status lines no longer suppressed — resync the orb */
        var prog = warmProg || { done: 0, skipped: 0, failed: 0, total: words.length };
        if (warmCancelled) {
          $('#warmMsg').textContent = 'Stopped — ' + (prog.done + prog.skipped) + ' / ' + prog.total + ' cached';
        } else {
          $('#warmMsg').textContent = prog.failed
            ? '✓ cached ' + (prog.done + prog.skipped) + ' words · ' + prog.failed + ' failed'
            : '✓ all ' + prog.total + ' words cached';
        }
        renderWarm();
        if (!warmCancelled) toast('Word audio cache warmed');
      }).catch(function (err) {
        warmJob = null;
        warmResyncOrb();
        renderWarm();
        $('#warmMsg').textContent = '⚠ ' + ((err && err.message) || err);
      });
    };
    if (aheadJob) {
      if (aheadJob.cancel) aheadJob.cancel();   /* stop the prefetch window after its current word */
      aheadJob.then(begin, begin);              /* one warm loop on the shared worker at a time */
    } else {
      begin();
    }
  }
  /* the orb ignored the warm's status lines while it ran — after it ends,
     return to honest status-driven display (e.g. a compile left pending) */
  function warmResyncOrb() {
    try {
      voiceLoading = !!(window.NeuralTTS && NeuralTTS.status().status === 'loading');
    } catch (e) { voiceLoading = false; }
    voiceSync();
  }

  /* ---- rolling n+1 audio prefetch (Supertonic) ---- */
  /* While a card or question is on screen, quietly warm the word cache for
     the UPCOMING ones, so advancing never waits on synthesis. The visible
     word is deliberately NOT warmed: it always synthesizes interactively when
     uncached (autoplay must never be dropped — a window word would be too
     late anyway), and once it has played it is cached for good.
     Reuses the pre-heat machinery (warmCache: one serial warm worker,
     watchdogs, skip-if-cached, compile lock, narration yield) on a tiny
     rolling window instead of the whole deck. Windows are serialized: never
     two warmCache loops on the shared _warmWorker at once. */
  var AHEAD_N = 2;            /* upcoming words kept warm */
  var aheadJob = null;        /* in-flight rolling warmCache window promise */
  function aheadWords() {
    var out = [];
    var add = function (w) { if (w && out.indexOf(w) < 0) out.push(w); };
    if (!$('#scr-quiz').hidden && sess) {
      for (var k = 1; k <= AHEAD_N; k++) {
        var e = entryById(sess.ids[sess.i + k]);
        if (e) add(e.es);
      }
    } else if (!$('#scr-chal').hidden && challenge) {
      for (var j = 1; j <= AHEAD_N; j++) {
        var q = challenge.qs[challenge.i + j];
        if (q) add(q.es);
      }
    }
    return out;
  }
  function prefetchAhead() {
    if (!settings.tts || !settings.hd || warmJob) return;
    if (!window.NeuralTTS || !NeuralTTS.warmCache || !warmEngineOk()) return;
    var words = aheadWords();
    if (!words.length) return;
    /* hold the window while quiz narration is wanted (hdWanted) — the word
       the learner is waiting for must never queue behind a warm word in the
       shared ort proxy worker */
    var yieldToNarration = function () {
      return new Promise(function (resolve) {
        (function poll() {
          if (hdWanted === 0) { resolve(); return; }
          setTimeout(poll, 250);
        })();
      });
    };
    var run = function () {
      var job = NeuralTTS.warmCache(words, { voice: settings.hdVoice, rate: settings.rate, wait: yieldToNarration }, null);
      aheadJob = job;
      var settle = function () {
        if (aheadJob === job) aheadJob = null;
        if (!warmJob) warmResyncOrb();
      };
      job.then(settle, settle);
    };
    if (aheadJob) aheadJob.then(run, run);   /* previous window still going — chain */
    else run();
  }
  function cancelWarm() {
    if (!warmJob) return;
    warmCancelled = true;
    if (warmJob.cancel) warmJob.cancel();
    $('#warmCancel').hidden = true;
    $('#warmMsg').textContent = 'Stopping after the current word…';
  }
  function clearCache() {
    if (!window.NeuralTTS || !window.NeuralTTS.clearWordCache) return;
    if (warmJob || aheadJob) return;   /* don't wipe a cache a warm run is writing to */
    if (!confirm('Delete every cached word audio (all voices)?')) return;
    NeuralTTS.clearWordCache().then(function (n) {
      warmProg = null;                     /* cache is gone — reset the warm progress */
      $('#warmProgress').hidden = true;
      $('#warmFill').style.width = '0%';
      $('#warmMsg').textContent = 'Cleared ' + n + ' cached word(s)';
      renderWarm();
      toast('Word audio cache cleared');
    }).catch(function () {});
  }
  function doImport() {
    var text = $('#importArea').value;
    if (!text.trim()) { $('#importMsg').textContent = 'Paste words first.'; return; }
    var res = C.parseImport(text);
    if (!res.entries.length) { $('#importMsg').textContent = 'Nothing importable — check the format.'; return; }
    state.custom = state.custom.concat(res.entries);
    ENTS = null;
    saveState();
    refreshPills();
    $('#importArea').value = '';
    var msg = '✓ ' + res.entries.length + ' word(s) imported';
    if (res.errors) msg += ' · ' + res.errors + ' skipped (duplicate/invalid)';
    $('#importMsg').textContent = msg;
    toast(msg);
    renderStart();
  }

  /* ---------------- global UI updates ---------------- */
  function refreshPills() {
    var due = C.dueCards(state, entries(), settings.levels).length;
    var p = $('#duePill');
    p.textContent = '⏰ ' + (due > 0 ? due : '0 due');
    p.classList.toggle('hot', due > 0);
    $('#xpPill').textContent = '★ ' + state.xp;
  }

  /* ---------------- events ---------------- */
  function init() {
    applyTheme();

    $('#startBtn').addEventListener('click', startSession);
    $('#dirSeg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      settings.dir = b.dataset.dir;
      saveSettings(); renderStart();
    });
    $('#flip').addEventListener('click', function (ev) {
      /* ignore clicks on the grade buttons — they live inside the card and must not flip it */
      if (ev.target && ev.target.closest && ev.target.closest('.g')) return;
      if (Date.now() < suppressFlipUntil) return;   /* long-press conj card was shown */
      flipCard();
    });
    $('#quitBtn').addEventListener('click', function () { if (sess) endSession(); });
    $('#againBtn').addEventListener('click', startSession);
    $('#homeBtn').addEventListener('click', function () { show('scr-start'); renderStart(); refreshPills(); });
    $('#recapPractice').addEventListener('click', practiceMissed);
    $('#typeNext').addEventListener('click', continueTyped);
    $('#typeVeto').addEventListener('click', function () { this.blur(); vetoType(); });
    $('#chTypeVeto').addEventListener('click', function () { this.blur(); vetoChal(); });
    /* answered pretest: a click anywhere on the panel (except the option
       buttons themselves — their click is the ANSWER and must not bubble
       straight into "advance") moves on to the rating card */
    $('#pretestPanel').addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#preOpts button')) return;
      preAdvance();
    });
    /* after a miss/peek, a click anywhere else on the typed panel advances
       (clicks on controls keep their own behavior) */
    $('#typePanel').addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('button, input, .say-btn')) return;
      continueTyped();
    });
    $('#typeInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();              /* this Enter is handled here — it must NOT bubble to the
                                              document handler, which would immediately advance the
                                              resolved answer (skipping the reveal / the wait) */
        if (sess && sess.typed !== 'idle') continueTyped();
        else checkType();
      }
    });
    $('#chTypeNext').addEventListener('click', continueChalTyped);
    $('#chal-q-card').addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('button, input, .say-btn')) return;
      continueChalTyped();
    });
    $('#chTypeInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();              /* same as above: do not double-advance via the document handler */
        if (challenge && challenge.waiting) continueChalTyped();
        else chCheckType();
      }
    });
    $('#grades').addEventListener('click', function (ev) {
      var b = ev.target.closest('.g');
      if (!b) return;
      ev.stopPropagation();                /* grade clicks must not bubble to the card flip toggle */
      if (typeof b.blur === 'function') b.blur();
      /* above: drop keyboard focus so a later Space flips the card instead of re-grading (stale focus) */
      grade(parseInt(b.dataset.q, 10));
    });
    $('#chalStart').addEventListener('click', function () { var box = $('#chalOffer'); if (box._key) startChallenge(box._key); });
    $('#chQuit').addEventListener('click', function () { challenge = null; show('scr-start'); renderStart(); refreshPills(); toast('Challenge aborted'); });
    $('#chdAgain').addEventListener('click', startSession);
    $('#chdHome').addEventListener('click', function () { show('scr-start'); renderStart(); refreshPills(); });

    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#settingsBtn').addEventListener('click', openModal);
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', function (ev) { if (ev.target === this) closeModal(); });

    /* ---- conjugation hover card ---- */
    var suppressFlipUntil = 0;   /* long-press shows the card — swallow the follow-up click */
    if (CJ) {
      document.addEventListener('mouseover', function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-conj]') : null;
        if (!t || !t.dataset.conj || !CJ.analyze(t.dataset.conj)) { hideConj(); return; }
        var x = (ev.clientX != null) ? ev.clientX : window.innerWidth / 2;
        var y = (ev.clientY != null) ? ev.clientY : window.innerHeight / 2;
        showConj(t.dataset.conj, x, y);
      });
      document.addEventListener('mousemove', function (ev) {
        if (conjKey && ev.clientX != null) positionConj(ev.clientX, ev.clientY);
      });
      document.addEventListener('mouseout', function (ev) {
        if (!ev.relatedTarget) hideConj();           /* pointer left the window */
      });
      /* touch fallback: long-press a verb to pin its table */
      var holdTimer = null;
      document.addEventListener('touchstart', function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-conj]') : null;
        clearTimeout(holdTimer);
        if (!t || !t.dataset.conj) return;
        var touch = ev.touches && ev.touches[0];
        if (!touch) return;
        holdTimer = setTimeout(function () {
          conjTouch = Date.now();
          showConj(t.dataset.conj, touch.clientX, touch.clientY);
        }, 460);
      }, { passive: true });
      document.addEventListener('touchmove', function () { clearTimeout(holdTimer); }, { passive: true });
      document.addEventListener('touchend', function () {
        clearTimeout(holdTimer);
        if (conjTouch && Date.now() - conjTouch < 800) {
          hideConj();
          suppressFlipUntil = Date.now() + 700;      /* don't flip the card underneath */
        }
        conjTouch = 0;
      }, { passive: true });
    }
    if (window.NeuralTTS) {
      NeuralTTS.onStatus(function () { updateHdStatus(); });
      NeuralTTS.onStatus(onHdStatus);   /* header orb: spinner while generating */
      if (NeuralTTS.onAudio) NeuralTTS.onAudio(onHdAudio);   /* …orb pulsing while playing */
    }
    $('#setNew').addEventListener('input', function () {
      settings.newPerDay = parseInt($('#setNew').value, 10);
      $('#setNewVal').textContent = settings.newPerDay + ' / day';
      saveSettings();
    });
    $('#setSound').addEventListener('change', function () { settings.sound = $('#setSound').checked; saveSettings(); });
    $('#ansSeg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      settings.ans = b.dataset.ans;
      saveSettings(); renderStart();   /* re-render also updates the contextual how-to line */
    });
    $('#setPretest').addEventListener('change', function () { settings.pretest = $('#setPretest').checked; saveSettings(); });
    $('#setTts').addEventListener('change', function () {
      settings.tts = $('#setTts').checked; saveSettings();
      if (window.NeuralTTS) NeuralTTS.stop();
      try { window.speechSynthesis.cancel(); } catch (e) {}
      $('#voiceBox').hidden = !settings.tts;
      renderStart();          /* keeps the contextual how-to hint in sync */
    });
    $('#setAutoSpeak').addEventListener('change', function () {
      settings.autoSpeak = $('#setAutoSpeak').checked; saveSettings();
      renderStart();
    });
    $('#setVoice').addEventListener('change', function () {
      settings.voiceURI = $('#setVoice').value || '';
      saveSettings();
      previewVoice();
    });
    $('#voicePrev').addEventListener('click', function () { previewVoice(); });
    $('#setRate').addEventListener('input', function () {
      settings.rate = parseInt($('#setRate').value, 10) / 100;
      $('#setRateVal').textContent = $('#setRate').value + '%';
      saveSettings();
    });
    $('#setHd').addEventListener('change', function () {
      settings.hd = $('#setHd').checked;
      saveSettings();
      $('#hdVoiceRow').hidden = !settings.hd;
      updateHdStatus();
      renderWarm();
      if (settings.hd && window.NeuralTTS && NeuralTTS.status().status === 'idle') {
        /* warm up the chosen model in the background so the first 🔊 is quick */
        NeuralTTS.prefetch(settings.hdVoice).catch(function () { updateHdStatus(); });
        updateHdStatus();
      }
    });
    $('#setHdEngine').addEventListener('change', function () {
      settings.hdEngine = $('#setHdEngine').value;
      if (window.NeuralTTS) NeuralTTS.stop();
      fillHdVoices(settings.hdEngine);
      settings.hdVoice = $('#setHdVoice').value;
      saveSettings();
      renderWarm();
      previewVoice();           /* hear the default voice of the new model */
    });
    $('#setHdVoice').addEventListener('change', function () {
      settings.hdVoice = $('#setHdVoice').value;
      saveSettings();
      if (window.NeuralTTS) NeuralTTS.stop();
      renderWarm();
      previewVoice();           /* hear the newly picked HD voice */
    });
    $('#warmBtn').addEventListener('click', function () { this.blur(); startWarm(); });
    $('#warmCancel').addEventListener('click', function () { this.blur(); cancelWarm(); });
    $('#clearCacheBtn').addEventListener('click', function () { this.blur(); clearCache(); });
    $('#importBtn').addEventListener('click', doImport);
    $('#resetProgress').addEventListener('click', function () {
      if (!confirm('Reset all learning progress? Imported words stay.')) return;
      state.cards = {}; state.chalDone = {}; state.xp = 0; state.total = 0; state.correct = 0; state.streak = 0; state.best = 0;
      ENTS = null; saveState(); refreshPills(); renderStart();
      toast('Progress reset');
    });
    $('#resetAll').addEventListener('click', function () {
      if (!confirm('Delete EVERYTHING (progress + imported words)?')) return;
      try { localStorage.removeItem(LS_KEY + '.state'); } catch (e) {}
      state = C.defaultState(); ENTS = null;
      saveState(); refreshPills(); renderStart();
      toast('Fresh start');
    });

    /* rating keys: 1–4, plus the right-hand home row j k l ö (j=1 … ö=4) so
       grading never leaves the base row — works on any keyboard layout.
       The grade buttons show the home-row letters; the ö hint appears only
       once the layout is known to produce ö (German-family keyboard). */
    function showOeHint() {
      var b = document.getElementById('altOe');
      if (b) b.hidden = false;
    }
    try {
      if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
        navigator.keyboard.getLayoutMap().then(function (m) {
          if (m.get('Semicolon') === 'ö') showOeHint();
        }, function () {});
      }
    } catch (e) {}
    function gradeKeyOf(ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return -1;
      if (ev.key >= '1' && ev.key <= '4') return parseInt(ev.key, 10) - 1;
      var k = ev.key.toLowerCase();
      if (k === 'j') return 0;
      if (k === 'k') return 1;
      if (k === 'l') return 2;
      if (k === 'ö') { showOeHint(); return 3; }
      return -1;
    }

    document.addEventListener('keydown', function (ev) {
      if (!$('#modal').hidden) {
        if (ev.key === 'Escape') closeModal();
        return;
      }
      /* S says the current Spanish word on demand — never while typing an answer */
      if ((ev.key === 's' || ev.key === 'S') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        var t = ev.target;
        var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t.closest && t.closest('input, textarea')));
        if (!typing) {
          var w = curEsWord();
          if (w) { ev.preventDefault(); speak(w); }
        }
      }
      var quiz = !$('#scr-quiz').hidden;
      var chal = !$('#scr-chal').hidden;
      if (quiz) {
        if (sess && sess.pre && !$('#pretestPanel').hidden) {
          if (sess.preWaiting) {
            /* answered: the feedback holds until the learner advances */
            if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); preAdvance(); }
            return;
          }
          /* fresh pretest: 1–4 picks an option */
          var pk = gradeKeyOf(ev);
          if (pk >= 0 && !sess.preLocked) { ev.preventDefault(); preAnswer(pk); }
          return;
        }
        if (!$('#typePanel').hidden) {
          /* a typed round is on screen (type or mixed mode) */
          /* keydowns that started on the panel's own controls (input/Check/Peek) are
             handled there — the same Enter must not advance twice from here.
             .say-btn is exempt: after clicking 🔊, Space still advances. */
          var inTypeCtrl = ev.target && ev.target.closest && ev.target.closest('#typePanel button:not(.say-btn), #typePanel input');
          if (sess && sess.typed !== 'idle') {
            /* resolution on screen (correct or not): Space/Enter advances,
               V overrules a wrongly marked answer */
            if (!inTypeCtrl && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); continueTyped(); }
            else if (!inTypeCtrl && (ev.key === 'v' || ev.key === 'V')) { ev.preventDefault(); vetoType(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); if (sess) endSession(); }
          } else if (ev.key === 'Enter' && !inTypeCtrl && !$('#typeInput').disabled) { ev.preventDefault(); checkType(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); if (sess) endSession(); }
          return;
        }
        if (ev.key === ' ' || ev.key === 'Enter') {
          /* let focused grade buttons keep their native click */
          if (ev.target && ev.target.closest && ev.target.closest('.g')) return;
          ev.preventDefault(); flipCard();
        }
        else if (ev.key === 'Escape') { ev.preventDefault(); if (sess) endSession(); }
        else if ($('#flip').classList.contains('flipped')) {
          var gk = gradeKeyOf(ev);
          if (gk >= 0) { ev.preventDefault(); grade(gk); }
        }
      } else if (chal) {
        var cq = challenge ? challenge.qs[challenge.i] : null;
        var inChCtrl = ev.target && ev.target.closest && ev.target.closest('#chTypeWrap button:not(.say-btn), #chTypeWrap input');
        if (challenge && challenge.waiting) {
          /* typed resolution on screen: Space/Enter advances, V overrules */
          if (!inChCtrl && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); continueChalTyped(); }
          else if (!inChCtrl && (ev.key === 'v' || ev.key === 'V')) { ev.preventDefault(); vetoChal(); }
          else if (ev.key === 'Escape') { $('#chQuit').click(); }
        }
        else if (cq && !cq.typed) {
          var ck = gradeKeyOf(ev);
          if (ck >= 0) { ev.preventDefault(); chAnswer(ck); }
        }
        else if (cq && cq.typed && ev.key === 'Enter' && !inChCtrl && !$('#chTypeInput').disabled) { ev.preventDefault(); chCheckType(); }
        else if (ev.key === 'Escape') { $('#chQuit').click(); }
      }
    });

    renderStart();
    refreshPills();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();