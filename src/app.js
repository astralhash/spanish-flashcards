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
      return Object.assign({ levels: ['b1', 'b2'], dir: 'es-en', newPerDay: 20, sound: true, theme: null }, s);
    } catch (e) { return { levels: ['b1', 'b2'], dir: 'es-en', newPerDay: 20, sound: true, theme: null }; }
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
  function renderWord(node, txt, isEs) {
    node.textContent = '';
    /* mark Spanish verbs: hovering them shows a live conjugation card */
    if (isEs && CJ) {
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
  function startSession() {
    var s = C.buildSession(state, entries(), settings.levels, settings.newPerDay);
    sess = { ids: s.ids, total: s.total, i: 0, correct: 0, xp: 0, best: 0, revoked: new Set(), skippedDue: s.skippedDue };
    if (s.total === 0) { renderDone(s.skippedDue ? 'All caught up — the rest awaits tomorrow ⏳' : 'Nothing due right now 🎉', 0); return; }
    show('scr-quiz');
    renderCard();
  }

  function renderCard() {
    var e = entryById(sess.ids[sess.i]);
    hideConj();
    var flip = $('#flip');
    flip.classList.remove('flipped', 'reload');
    flip.style.transition = 'none';
    void flip.offsetWidth;                 /* snap back without animating */
    flip.style.transition = '';
    void flip.offsetWidth;
    flip.classList.add('reload');

    var dir = dirOf();
    var front = dir === 'es-en' ? e.es : e.en;
    var back = dir === 'es-en' ? e.en : e.es;

    renderWord($('#frontWord'), front, dir === 'es-en');
    renderWord($('#backWord'), back, dir === 'en-es');
    $('#frontWord').parentNode.querySelector('.hint').textContent =
      (dir === 'es-en' ? 'Spanish → English' : 'English → Spanish') + ' · click or press Space to reveal';

    $('#lvlBadge').hidden = true;   /* the word's level is irrelevant while reviewing */
    if (e.cluster && C.CLUSTERS[e.cluster]) {
      $('#clsBadge').textContent = C.CLUSTERS[e.cluster].icon + ' ' + C.CLUSTERS[e.cluster].label;
      $('#clsBadge').hidden = false;
    } else { $('#clsBadge').hidden = true; }
    var card = state.cards[e.id];
    $('#newBadge').hidden = !(card ? card.r === 0 : true);

    $('#qcount').textContent = (sess.i + 1) + ' / ' + sess.total;
    $('#qbarFill').style.width = (sess.i / sess.total * 100) + '%';
  }

  function flipCard() { $('#flip').classList.toggle('flipped'); }

  function grade(q) {
    if (!sess) return;
    var id = sess.ids[sess.i];
    var before = state.cards[id];
    var res = C.applyGrade(state, id, q);
    state.total++;
    if (q === 0) {
      state.streak = 0;
      if (!sess.revoked.has(id)) { sess.revoked.add(id); sess.ids.push(id); sess.total++; }
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
    if (before && res === 'again') toast('Back into the queue — you will see it again this session');
  }

  function endSession() {
    var reviewed = sess.i;
    renderDone('Session complete 🎉', reviewed);
  }

  /* ---------------- done screen ---------------- */
  function renderDone(title, reviewed) {
    $('#doneTitle').textContent = title;
    $('#doneStats').textContent = '';
    $('#doneStats').appendChild(statBox('🃏', 'Reviewed', reviewed));
    $('#doneStats').appendChild(statBox('✅', 'Correct', sess && sess.total ? Math.round(sess.correct / sess.total * 100) + '%' : '—'));
    $('#doneStats').appendChild(statBox('★', 'XP gained', sess ? sess.xp : 0));
    $('#doneStats').appendChild(statBox('🔥', 'Best streak', sess ? sess.best : state.best));

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
    challenge = {
      key: key,
      qs: C.buildChallenge(state, entries(), settings.levels, key, settings.dir),
      i: 0, correct: 0, streak: 0, best: 0, xp: 0, locked: false
    };
    if (!challenge.qs.length) { toast('Not enough words in this cluster yet'); return; }
    var def = C.CLUSTERS[key];
    $('#chCluster').textContent = def.icon + ' ' + def.label;
    show('scr-chal');
    renderChalQ();
    sndTic();
  }

  function renderChalQ() {
    var q = challenge.qs[challenge.i];
    hideConj();
    $('#chDir').textContent = q.d === 'es-en' ? 'Spanish → English' : 'English → Spanish';
    /* challenge words/options stay untagged: no conjugation card in the 4-answer flash rounds */
    renderWord($('#chWord'), q.d === 'es-en' ? q.es : q.en);
    var wrap = $('#chOpts');
    wrap.textContent = '';
    q.opts.forEach(function (opt, idx) {
      var b = el('button', null, '');
      renderWord(b, opt);
      b.addEventListener('click', function () { answer(idx); });
      wrap.appendChild(b);
    });
    $('#chCount').textContent = (challenge.i + 1) + ' / ' + challenge.qs.length;
    $('#chBarFill').style.width = (challenge.i / challenge.qs.length * 100) + '%';
    var card = $('#chal-q-card');
    if (card) { card.classList.remove('reload'); void card.offsetWidth; card.classList.add('reload'); }
    challenge.locked = false;
  }

  function answer(idx) {
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
      sndBad();
    }
    btns.forEach(function (b) { b.classList.add('lock'); });
    setTimeout(function () {
      if (!challenge) return;                    /* aborted meanwhile */
      challenge.i++;
      if (challenge.i >= challenge.qs.length) finishChallenge();
      else renderChalQ();
    }, 520);
  }

  function finishChallenge() {
    var n = challenge.qs.length;
    var xp = 10 + 2 * challenge.correct + (challenge.best >= 8 ? 10 : challenge.best >= 5 ? 5 : 0);
    state.xp += xp;
    var prev = state.chalDone[challenge.key] || { n: 0 };
    state.chalDone[challenge.key] = { n: prev.n + 1 };
    saveState();
    refreshPills();

    $('#chdTitle').textContent = 'Challenge complete';
    $('#chdStats').textContent = '';
    $('#chdStats').appendChild(statBox('🎯', 'Score', challenge.correct + ' / ' + n));
    $('#chdStats').appendChild(statBox('🔥', 'Best streak', challenge.best));
    $('#chdStats').appendChild(statBox('★', 'XP earned', '+' + xp));
    $('#chdStats').appendChild(statBox('🗂️', 'Cluster', C.CLUSTERS[challenge.key].label));
    show('scr-chaldone');
    toast('+' + xp + ' XP for the ' + C.CLUSTERS[challenge.key].label + ' challenge ⚡');
    challenge = null;
  }

  /* ---------------- import / settings ---------------- */
  function openModal() { $('#modal').hidden = false; $('#setNew').value = settings.newPerDay; $('#setNewVal').textContent = settings.newPerDay + ' / day'; $('#setSound').checked = !!settings.sound; $('#importMsg').textContent = ''; }
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
    $('#quitBtn').addEventListener('click', function () { if (sess) endSession(); });
    $('#againBtn').addEventListener('click', startSession);
    $('#homeBtn').addEventListener('click', function () { show('scr-start'); renderStart(); refreshPills(); });
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
        if (ev.key === ' ' || ev.key === 'Enter') {
          /* let focused grade buttons keep their native click */
          if (ev.target && ev.target.closest && ev.target.closest('.g')) return;
          ev.preventDefault(); flipCard();
        }
        else if (ev.key === 'Escape') { ev.preventDefault(); if (sess) endSession(); }
        else if (ev.key >= '1' && ev.key <= '4' && $('#flip').classList.contains('flipped')) grade(parseInt(ev.key, 10) - 1);
      } else if (chal) {
        if (ev.key >= '1' && ev.key <= '4') { ev.preventDefault(); answer(parseInt(ev.key, 10) - 1); }
        else if (ev.key === 'Escape') { $('#chQuit').click(); }
      }
    });

    renderStart();
    refreshPills();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();