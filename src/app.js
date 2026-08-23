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

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY + '.set') || '{}');
      return Object.assign({ levels: ['b1', 'b2'], dir: 'es-en', newPerDay: 20, sound: true, theme: null, ans: 'type', pretest: true, tts: true }, s);
    } catch (e) { return { levels: ['b1', 'b2'], dir: 'es-en', newPerDay: 20, sound: true, theme: null, ans: 'type', pretest: true, tts: true }; }
  }
  function saveSettings() { try { localStorage.setItem(LS_KEY + '.set', JSON.stringify(settings)); } catch (e) {} }
  function loadState() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY + '.state') || 'null'); return s; } catch (e) { return null; }
  }
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { try { localStorage.setItem(LS_KEY + '.state', JSON.stringify(state)); } catch (e) {} }, 220);
  }

  /* ---------------- helpers ---------------- */
  function entryById(id) {
    var all = entries();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
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
     after a recall attempt) strengthens memory for the spoken form. */
  var esVoice = null;
  function pickEsVoice() {
    try {
      if (!window.speechSynthesis) return null;
      var vs = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) {
        if (String(vs[i].lang || '').toLowerCase().indexOf('es') === 0) return vs[i];
      }
    } catch (e) { /* no voices */ }
    return null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = function () { esVoice = pickEsVoice(); };
  }
  function speak(text) {
    if (!settings.tts) return;
    try {
      if (!window.speechSynthesis) return;
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'es-ES';
      u.rate = 0.92;
      if (!esVoice) esVoice = pickEsVoice();
      if (esVoice) u.voice = esVoice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }
  function sayBtn(text) {
    var b = el('button', 'say-btn', '🔊');
    b.setAttribute('aria-label', 'Pronounce: ' + text);
    b.title = 'Pronounce';
    b.addEventListener('click', function (ev) {
      if (ev) ev.stopPropagation();
      speak(text);
    });
    return b;
  }
  /* Show/hide a "say it aloud" chip that speaks `word` when clicked.
     Showing it does not depend on the tts setting — it is a human nudge. */
  function armChip(node, word) {
    if (!node) return;
    if (!word) { node.hidden = true; return; }
    node._word = word;
    node.hidden = false;
  }

  /* ---- typed-answer matching ---- */
  function typedMatch(target, guess) {
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
      missed: [], pre: null, preLocked: false, typed: 'idle', curDir: settings.dir
    };
    if (s.total === 0) { renderDone(s.skippedDue ? 'All caught up — the rest awaits tomorrow ⏳' : 'Nothing due right now 🎉', 0); return; }
    show('scr-quiz');
    renderCard();
  }

  /* a card the learner has never seen at all (no state, or untouched) */
  function neverSeen(e) {
    var c = state.cards[e.id];
    return !c || (c.r === 0 && c.l === 0 && c.d === 0);
  }

  function setQuizVisibility(which) {        /* 'pre' | 'flip' | 'type' */
    $('#pretestPanel').hidden = which !== 'pre';
    $('#flip').hidden = which !== 'flip';
    $('#typePanel').hidden = which !== 'type';
  }

  function renderCard() {
    var e = entryById(sess.ids[sess.i]);
    hideConj();
    armChip($('#frontChip'), null);
    armChip($('#sayChip'), null);
    armChip($('#preSay'), null);

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
    var useType = settings.ans === 'type' || (settings.ans === 'mix' && Math.random() < 0.5);
    if (useType) { renderTypeCard(e); return; }
    if (settings.pretest && neverSeen(e)) { renderPretest(e); return; }
    renderFlipCard(e);
  }

  /* ---------- flashcard mode ---------- */
  function renderFlipCard(e) {
    var dir = sess.curDir;
    var front = dir === 'es-en' ? e.es : e.en;
    var back = dir === 'es-en' ? e.en : e.es;
    var flip = $('#flip');
    flip.classList.remove('flipped', 'reload');
    flip.style.transition = 'none';
    void flip.offsetWidth;                 /* snap back without animating */
    flip.style.transition = '';
    void flip.offsetWidth;
    flip.classList.add('reload');
    renderWord($('#frontWord'), front, dir === 'es-en');
    renderWord($('#backWord'), back, dir === 'en-es');
    $('#frontWord').parentNode.querySelector('.hint').textContent =
      (settings.ans === 'mix' ? '🃏 ' : '') +
      (dir === 'es-en' ? 'Spanish → English' : 'English → Spanish') + ' · click or press Space to reveal';
    if (dir === 'es-en') armChip($('#frontChip'), e.es);   /* production prompt while the Spanish is visible */
    setQuizVisibility('flip');
  }

  function flipCard() {
    var flip = $('#flip');
    var willShow = !flip.classList.contains('flipped');
    flip.classList.toggle('flipped');
    /* the reveal moment: if the revealed side is Spanish, offer the say-aloud chip
       (audio only plays when the chip is clicked) */
    if (willShow && sess && sess.curDir === 'en-es') {
      var e = entryById(sess.ids[sess.i]);
      if (e) armChip($('#sayChip'), e.es);
    }
  }

  /* ---------- pretest (new words, flashcard mode) ---------- */
  function renderPretest(e) {
    var q = C.buildPretest(entries(), e, sess.curDir);
    sess.pre = q; sess.preLocked = false;
    $('#preFb').hidden = true;
    armChip($('#preSay'), null);
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
    armChip($('#preSay'), q.es);
    setTimeout(function () {
      if (!sess) return;
      /* reveal the card with the answer side up → the learner rates at once */
      var flip = $('#flip');
      flip.classList.add('flipped');
      setQuizVisibility('flip');
      if (q.d === 'en-es') armChip($('#sayChip'), q.es);
      sess.pre = null;
    }, 1150);
  }

  /* ---------- typed mode ---------- */
  var TYPE_ASK = ['#typeDir', '#typeWord', '#typeInput', '#typeActions'];
  /* 'ask': show the question, input and actions.
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
    $('#typeCheck').disabled = false;
    $('#typeFb').hidden = true;
    $('#typeVerdict').hidden = true;
    $('#typeNext').hidden = true;
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
  }

  /* big ✓ / ✗ verdict line — the headed feedback for a typed answer */
  function setVerdict(node, state) {
    if (!node) return;
    node.classList.remove('ok', 'bad');
    if (state === 'ok') { node.textContent = '✓ Correct!'; node.classList.add('ok'); node.hidden = false; }
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
    if (!guess.trim()) return;
    var ok = typedMatch(typeTarget(e, dir), guess);
    sess.typed = ok ? 'ok' : 'miss';
    var inp = $('#typeInput');
    inp.disabled = true;
    inp.classList.remove('ok', 'bad');
    inp.classList.add(ok ? 'ok' : 'bad');     /* instant: the typed word turns green/red */
    $('#typeCheck').disabled = true;
    revealType(e, dir, ok ? 'ok' : 'miss');
    inp.hidden = false;                       /* the colored answer stays above the reveal */
    /* correct, wrong or peeked: the correct answer stays on screen until
       the learner advances (click, Space or Enter) */
    awaitType();
  }

  function peekType() {
    if (!sess || sess.typed !== 'idle') return;
    var e = entryById(sess.ids[sess.i]);
    sess.typed = 'peek';
    $('#typeInput').disabled = true;
    $('#typeCheck').disabled = true;
    revealType(e, sess.curDir, 'peek');
    awaitType();
  }

  function grade(q) {
    if (!sess) return;
    var id = sess.ids[sess.i];
    var res = C.applyGrade(state, id, q);
    state.total++;
    if (q === 0) {
      state.streak = 0;
      if (!sess.revoked.has(id)) { sess.revoked.add(id); sess.ids.push(id); sess.total++; }
      /* remember for the "words to watch" recap */
      var e = entryById(id);
      if (e && !sess.missed.some(function (m) { return m.id === id; })) sess.missed.push({ id: id, es: e.es, en: e.en });
      sndBad();
    } else {
      state.correct++;
      state.streak++;
      state.best = Math.max(state.best, state.streak);
      state.xp += C.xpFor(q);
      sess.correct++;
      sess.xp += C.xpFor(q);
      sess.best = Math.max(sess.best, state.streak);
      sndGood();
    }
    saveState();
    refreshPills();
    sess.i++;
    if (sess.i >= sess.ids.length) endSession();
    else renderCard();
    if (res === 'again') toast('Back into the queue — you will see it again this session');
    else if (C.inSteps(state.cards[id])) toast('New word — another quick pass later this session');
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
    var def = C.CLUSTERS[key];
    $('#chCluster').textContent = def.icon + ' ' + def.label;
    show('scr-chal');
    renderChalQ();
    sndTic();
  }

  /* typed round chrome: question + input + actions (ask) vs. only the reveal row.
     chCheckType() re-shows the input afterwards so the green/red answer stays
     visible; a peek has nothing to show there and leaves it hidden. */
  function setChalAskMode(ask) {
    $('#chDir').hidden = !ask;
    $('#chWord').hidden = !ask;
    $('#chTypeInput').hidden = !ask;
    $('#chTypeActions').hidden = !ask;
  }

  function renderChalQ() {
    var q = challenge.qs[challenge.i];
    hideConj();
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
      $('#chTypeCheck').disabled = false;
      $('#chTypeNext').hidden = true;
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
    setTimeout(chAdvance, 620);
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
    if (!guess.trim()) { $('#chTypeInput').focus(); return; }
    challenge.locked = true;
    challenge.chInput = false;
    var target = q.d === 'es-en' ? q.en : q.es;
    var ok = typedMatch(target, guess);
    var inp = $('#chTypeInput');
    inp.disabled = true;
    inp.classList.remove('ok', 'bad');
    inp.classList.add(ok ? 'ok' : 'bad');     /* instant: the typed word turns green/red */
    $('#chTypeCheck').disabled = true;
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
    /* correct, wrong or peeked: the correct answer stays on screen until
       the learner advances (click, Space or Enter) */
    challenge.waiting = true;
    $('#chTypeNext').hidden = false;
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
    $('#chTypeCheck').disabled = true;
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
    $$('#ansSeg button').forEach(function (b) { b.classList.toggle('active', b.dataset.ans === settings.ans); });
    $('#setPretest').checked = !!settings.pretest;
    $('#setTts').checked = !!settings.tts;
    $('#importMsg').textContent = '';
  }
  function closeModal() { $('#modal').hidden = true; }

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
    /* delegated: "🔊 Say it aloud" chips speak their word and never flip the card */
    document.addEventListener('click', function (ev) {
      var chip = ev.target && ev.target.closest ? ev.target.closest('.say-chip') : null;
      if (chip && chip._word) { ev.stopPropagation(); speak(chip._word); }
    });
    $('#quitBtn').addEventListener('click', function () { if (sess) endSession(); });
    $('#againBtn').addEventListener('click', startSession);
    $('#homeBtn').addEventListener('click', function () { show('scr-start'); renderStart(); refreshPills(); });
    $('#recapPractice').addEventListener('click', practiceMissed);
    $('#typeCheck').addEventListener('click', checkType);
    $('#typePeek').addEventListener('click', peekType);
    $('#typeNext').addEventListener('click', continueTyped);
    /* after a miss/peek, a click anywhere else on the typed panel advances
       (clicks on controls keep their own behavior) */
    $('#typePanel').addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('button, input, .say-chip, .say-btn')) return;
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
    $('#chTypeCheck').addEventListener('click', chCheckType);
    $('#chTypePeek').addEventListener('click', chPeekType);
    $('#chTypeNext').addEventListener('click', continueChalTyped);
    $('#chal-q-card').addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('button, input, .say-chip, .say-btn')) return;
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
      saveSettings();
      $$('#ansSeg button').forEach(function (x) { x.classList.toggle('active', x.dataset.ans === settings.ans); });
    });
    $('#setPretest').addEventListener('change', function () { settings.pretest = $('#setPretest').checked; saveSettings(); });
    $('#setTts').addEventListener('change', function () { settings.tts = $('#setTts').checked; saveSettings(); });
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

    document.addEventListener('keydown', function (ev) {
      if (!$('#modal').hidden) {
        if (ev.key === 'Escape') closeModal();
        return;
      }
      var quiz = !$('#scr-quiz').hidden;
      var chal = !$('#scr-chal').hidden;
      if (quiz) {
        if (sess && sess.pre && !$('#pretestPanel').hidden) {
          /* pretest mode: 1–4 picks an option */
          if (ev.key >= '1' && ev.key <= '4' && !sess.preLocked) { ev.preventDefault(); preAnswer(parseInt(ev.key, 10) - 1); }
          return;
        }
        if (!$('#typePanel').hidden) {
          /* a typed round is on screen (type or mixed mode) */
          /* keydowns that started on the panel's own controls (input/Check/Peek) are
             handled there — the same Enter must not advance twice from here */
          var inTypeCtrl = ev.target && ev.target.closest && ev.target.closest('#typePanel button, #typePanel input');
          if (sess && sess.typed !== 'idle') {
            /* resolution on screen (correct or not): Space/Enter advances */
            if (!inTypeCtrl && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); continueTyped(); }
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
        else if (ev.key >= '1' && ev.key <= '4' && $('#flip').classList.contains('flipped')) grade(parseInt(ev.key, 10) - 1);
      } else if (chal) {
        var cq = challenge ? challenge.qs[challenge.i] : null;
        var inChCtrl = ev.target && ev.target.closest && ev.target.closest('#chTypeWrap button, #chTypeWrap input');
        if (challenge && challenge.waiting) {
          /* typed resolution on screen: Space/Enter advances */
          if (!inChCtrl && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); continueChalTyped(); }
          else if (ev.key === 'Escape') { $('#chQuit').click(); }
        }
        else if (cq && !cq.typed && ev.key >= '1' && ev.key <= '4') { ev.preventDefault(); chAnswer(parseInt(ev.key, 10) - 1); }
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