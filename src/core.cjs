/* VocabES core: spaced repetition + challenge logic. Pure JS, no DOM.
   Works as a classic browser script (sets window.Core) and as a CJS module (module.exports). */
'use strict';
(function () {
  var DAY = 86400000;
  var MIN = 60000;

  var LEVELS = ['b1', 'b2', 'c1', 'c2'];

  var CLUSTERS = {
    wochentage: { label: 'Weekdays', icon: '📅', min: 7 },
    monate:     { label: 'Months',   icon: '📆', min: 10 },
    zahlen:     { label: 'Numbers',  icon: '🔢', min: 10 },
    farben:     { label: 'Colors',   icon: '🎨', min: 10 },
    familie:    { label: 'Family',   icon: '👪', min: 10 },
    essen:      { label: 'Food & Drink', icon: '🥘', min: 10 },
    koerper:    { label: 'Body',     icon: '🫀', min: 10 },
    tiere:      { label: 'Animals',  icon: '🐾', min: 10 },
    expresiones: { label: 'Expressions', icon: '💬', min: 10 },
    jerga:      { label: 'Slang & Youth', icon: '😎', min: 10 },
    cine:       { label: 'TV & Film',  icon: '🎬', min: 10 },
    casa:       { label: 'Home & Furniture', icon: '🏠', min: 10 },
    ropa:       { label: 'Clothing',  icon: '👕', min: 10 },
    clima:      { label: 'Weather',   icon: '🌦️', min: 10 },
    trabajo:    { label: 'Work & Office', icon: '💼', min: 10 },
    viajes:     { label: 'Travel',    icon: '🧳', min: 10 },
    deportes:   { label: 'Sports',    icon: '⚽', min: 10 },
    escuela:    { label: 'School & Study', icon: '🎓', min: 10 },
    salud:      { label: 'Health',    icon: '🩺', min: 10 },
    tecnologia: { label: 'Tech & Internet', icon: '💻', min: 10 },
    ocio:       { label: 'Free Time & Hobbies', icon: '🎮', min: 10 }
  };

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function dayStart(ts) {
    var d = new Date(ts || Date.now());
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function defaultState() {
    return {
      cards: {},   /* id -> { r:reps, e:ease, i:intervalDays, d:dueTs, l:lapses, added:ts } */
      xp: 0,
      total: 0, correct: 0, streak: 0, best: 0,
      chalDone: {},   /* clusterId -> { n } — completion counts only, no cooldown */
      custom: []      /* imported entries [ [es,en,level,cluster?], ... ] */
    };
  }

  /* Combined entry list: built-ins get id n<i>, custom get id c<i>. */
  function withIds(vocab, custom) {
    var out = [];
    for (var i = 0; i < vocab.length; i++) {
      var e = vocab[i];
      out.push({ id: 'n' + i, es: e[0], en: e[1], level: e[2], cluster: e[3] || null, custom: false });
    }
    var cus = custom || [];
    for (var j = 0; j < cus.length; j++) {
      var ce = cus[j];
      out.push({ id: 'c' + j, es: ce[0], en: ce[1], level: ce[2], cluster: ce[3] || null, custom: true });
    }
    return out;
  }

  function eligible(entries, levels) {
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      if (levels.indexOf(entries[i].level) !== -1) out.push(entries[i]);
    }
    return out;
  }

  /* Due = has a schedule and due time <= now (includes recently "again"-ed cards). */
  function dueCards(state, entries, levels) {
    var now = Date.now();
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var c = state.cards[e.id];
      if (c && levels.indexOf(e.level) !== -1 && c.d <= now) out.push(e);
    }
    out.sort(function (a, b) { return state.cards[a.id].d - state.cards[b.id].d; });
    return out;
  }

  function unseen(state, entries, levels) {
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (levels.indexOf(e.level) !== -1 && !state.cards[e.id]) out.push(e);
    }
    return out;
  }

  /* Number of brand-new cards introduced so far today (quota tracking). */
  function newTodayCount(state) {
    var start = dayStart();
    var n = 0;
    for (var k in state.cards) {
      var c = state.cards[k];
      if (c.r === 0 && c.added >= start) n++;
    }
    return n;
  }

  /* Build a session queue: overdue first (most overdue first), then fresh cards up to the daily quota. */
  function buildSession(state, entries, levels, newPerDay) {
    var due = dueCards(state, entries, levels);
    var fresh = shuffle(unseen(state, entries, levels));
    var quota = Math.max(0, newPerDay - newTodayCount(state));
    var freshPick = fresh.slice(0, quota);
    var ids = [];
    for (var i = 0; i < due.length; i++) ids.push(due[i].id);
    for (var j = 0; j < freshPick.length; j++) ids.push(freshPick[j].id);
    var max = 40;
    var sliced = ids.slice(0, max);
    return {
      ids: sliced,
      total: sliced.length,
      dueCount: due.length,
      newCount: freshPick.length,
      skippedDue: Math.max(0, due.length - sliced.length)
    };
  }

  /* SM-2-ish grading. q: 0=again 1=hard 2=good 3=easy. Mutates state. */
  function applyGrade(state, id, q, now) {
    now = now || Date.now();
    var c = state.cards[id];
    if (!c) { c = state.cards[id] = { r: 0, e: 2.5, i: 0, d: 0, l: 0, added: now }; }
    var eff = c.e;
    if (q === 0) {
      c.l += 1; c.r = 0; c.e = Math.max(1.3, eff - 0.2); c.i = 0;
      c.d = now + 10 * MIN;                       /* reappears in ~10 min (and again this session) */
      return 'again';
    } else if (q === 1) {
      c.r += 1;
      c.i = c.i === 0 ? 1 : Math.max(1, Math.round(c.i * 1.2));
      c.e = Math.max(1.3, eff - 0.15);
      c.d = now + c.i * DAY;
      return 'hard';
    } else if (q === 2) {
      c.r += 1;
      c.i = c.i === 0 ? 1 : Math.max(1, Math.round(c.i * eff));
      c.d = now + c.i * DAY;
      return 'good';
    } else {
      c.r += 1;
      c.i = c.i === 0 ? 3 : Math.max(1, Math.round(c.i * eff * 1.3));
      c.e = Math.min(3, eff + 0.15);
      c.d = now + c.i * DAY;
      return 'easy';
    }
  }

  function xpFor(q) { return q >= 2 ? 1 : 0; }
  function learned(card) { return !!(card && card.r >= 1 && card.i >= 1); }

  /* ---- challenges ---- */
  /* Clusters are independent of the level selection: every defined cluster is
     always listed with its full word count, ignoring the level chips. */
  function challengeCandidates(state, entries, levels) {
    var out = [];
    for (var key in CLUSTERS) {
      var words = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].cluster === key) words.push(entries[i]);
      }
      out.push({ key: key, def: CLUSTERS[key], words: words, startable: words.length >= CLUSTERS[key].min });
    }
    return out;
  }

  /* Random startable cluster, or null. No cooldowns — always available. */
  function pickChallengeOffer(state, entries, levels) {
    var ready = [];
    var cands = challengeCandidates(state, entries, levels);
    for (var i = 0; i < cands.length; i++) if (cands[i].startable) ready.push(cands[i]);
    if (!ready.length) return null;
    return ready[Math.floor(Math.random() * ready.length)];
  }

  /* Question list for one cluster: min(10, size) words, 4 options each.
     Levels are ignored: a cluster challenge always draws from the whole deck. */
  function buildChallenge(state, entries, levels, key, dir, maxQ) {
    maxQ = maxQ || 10;
    var words = [];
    var pool = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      pool.push(e);
      if (e.cluster === key) {
        var c = state.cards[e.id];
        if (!(c && c.l > 5)) words.push(e);      /* skip hopelessly lapsed cards */
      }
    }
    words = shuffle(words).slice(0, Math.min(maxQ, words.length));
    var qs = [];
    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      var d = dir === 'mix' ? (Math.random() < 0.5 ? 'es-en' : 'en-es') : dir;
      var correct = d === 'es-en' ? word.en : word.es;
      var seen = {};
      seen[correct.toLowerCase()] = true;
      var opts = [correct];
      var cand = shuffle(pool);
      for (var p = 0; p < cand.length && opts.length < 4; p++) {
        if (cand[p].id === word.id) continue;
        var t = d === 'es-en' ? cand[p].en : cand[p].es;
        var tk = t.toLowerCase();
        if (!seen[tk]) { seen[tk] = true; opts.push(t); }
      }
      qs.push({ id: word.id, d: d, es: word.es, en: word.en, opts: shuffle(opts), answer: correct });
    }
    return qs;
  }

  function countLevels(vocab) {
    var o = { b1: 0, b2: 0, c1: 0, c2: 0 };
    for (var i = 0; i < vocab.length; i++) o[vocab[i][2]] = (o[vocab[i][2]] || 0) + 1;
    return o;
  }

  function countCluster(vocab) {
    var o = {};
    for (var i = 0; i < vocab.length; i++) {
      var cl = vocab[i][3];
      if (cl) o[cl] = (o[cl] || 0) + 1;
    }
    return o;
  }

  /* Import parser: JSON array of arrays, or lines "es | en | level | cluster". */
  function parseImport(text) {
    var entries = [];
    var seen = {};
    var errors = 0;
    function push(es, en, level, cluster) {
      es = String(es == null ? '' : es).trim();
      en = String(en == null ? '' : en).trim();
      if (!es || !en) return;
      level = String(level == null ? 'b1' : level).trim().toLowerCase();
      if (LEVELS.indexOf(level) === -1) level = 'b1';
      cluster = cluster ? String(cluster).trim().toLowerCase() : null;
      if (cluster && !CLUSTERS[cluster]) cluster = null;
      var key = es.toLowerCase();
      if (seen[key]) { errors++; return; }
      seen[key] = true;
      entries.push(cluster ? [es, en, level, cluster] : [es, en, level]);
    }
    var data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    var lines = String(text).split(/\r?\n/);
    for (var j = 0; j < lines.length; j++) {
      var t = lines[j].trim();
      if (!t) continue;
      if (data && Array.isArray(data)) break;       /* whole text was JSON — handled below */
      var row = null;
      if (t.charAt(0) === '[') { try { row = JSON.parse(t); } catch (e) { row = null; } }
      if (Array.isArray(row)) {
        if (row.length < 2) { errors++; continue; }
        push(row[0], row[1], row[2], row[3]);
      } else {
        var parts = t.split(/\s*[|;]\s*/);
        push(parts[0], parts[1], parts[2], parts[3]);
      }
    }
    if (data && Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        var rowArr = data[i];
        if (!Array.isArray(rowArr) || rowArr.length < 2) { errors++; continue; }
        push(rowArr[0], rowArr[1], rowArr[2], rowArr[3]);
      }
    }
    return { entries: entries, errors: errors };
  }

  var Core = {
    DAY: DAY, MIN: MIN,
    LEVELS: LEVELS, CLUSTERS: CLUSTERS,
    shuffle: shuffle, dayStart: dayStart,
    defaultState: defaultState, withIds: withIds, eligible: eligible,
    dueCards: dueCards, unseen: unseen, newTodayCount: newTodayCount,
    buildSession: buildSession, applyGrade: applyGrade, xpFor: xpFor, learned: learned,
    challengeCandidates: challengeCandidates, pickChallengeOffer: pickChallengeOffer,
    buildChallenge: buildChallenge, countLevels: countLevels, countCluster: countCluster,
    parseImport: parseImport
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else if (typeof window !== 'undefined') window.Core = Core;
})();