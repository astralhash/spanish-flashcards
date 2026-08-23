/* Smoke test for the SRS core with synthetic data. Run: node scripts/smoke.mjs */
import Core from '../src/core.cjs';

const DAY = Core.DAY, MIN = Core.MIN, T = Date.now();
let fails = 0;
function ok(cond, name) {
  if (!cond) { fails++; console.error('FAIL:', name); }
  else console.log('  ✓', name);
}

/* synthetic vocab: 4 levels; clusters with >=10 words */
const VOCAB = [];
const nPer = { b1: 800, b2: 600, c1: 400, c2: 200 };
let i = 0;
for (const lvl of ['b1', 'b2', 'c1', 'c2']) {
  for (let k = 0; k < nPer[lvl]; k++) VOCAB.push(['palabra' + i, 'word' + i, lvl, null]);
  i++;
}
for (let k = 0; k < 12; k++) VOCAB.push(['rojo' + k, 'red' + k, 'b1', 'farben']);
for (let k = 0; k < 12; k++) VOCAB.push(['lunes' + k, 'monday' + k, 'b1', 'wochentage']);
for (let k = 0; k < 12; k++) VOCAB.push(['perro' + k, 'dog' + k, 'b2', 'tiere']);

const st = Core.defaultState();
const entries = Core.withIds(VOCAB, []);

/* counts */
ok(Core.countLevels(VOCAB).b1 === 824, 'countLevels b1 (800 + two 12-word clusters)');
ok(Core.countCluster(VOCAB).farben === 12, 'countCluster farben');

/* session building */
ok(entries.length === VOCAB.length, 'withIds length');
let s = Core.buildSession(st, entries, ['b1'], 20);
ok(s.total === 20 && s.newCount === 20, 'first session introduces 20 new (quota)');
ok(s.dueCount === 0, 'nothing due initially');
s = Core.buildSession(st, entries, ['b1', 'b2'], 20);
ok(s.total === 20 && s.newCount === 20, 'level filter works');

/* learning steps: hard on a new card repeats step 0 (1 min), does not graduate */
const idA = s.ids[0];
Core.applyGrade(st, idA, 1, T - 2 * DAY);
let card = st.cards[idA];
ok(card.r === 1 && card.st === 0 && card.i === 0 && card.d === T - 2 * DAY + 1 * MIN,
  'hard on new card: repeats step 0, due in 1 min');
let s2 = Core.buildSession(st, entries, ['b1', 'b2'], 20);
ok(s2.ids.indexOf(idA) !== -1, 'old step-0 card reappears as overdue');
ok(Core.inSteps(st.cards[idA]), 'inSteps true while learning');

/* good on a new card advances to step 1 (10 min) */
const idB = s2.ids.filter((x) => x !== idA)[0];
Core.applyGrade(st, idB, 2, T);
card = st.cards[idB];
ok(card.r === 1 && card.st === 1 && card.i === 0 && card.d === T + 10 * MIN, 'good on new card: advances to step 1 (10 min)');
ok(!Core.learned(st.cards[idB]), 'step card not yet "learned"');

/* second good graduates → first day interval */
Core.applyGrade(st, idB, 2, T + 11 * MIN);
card = st.cards[idB];
ok(card.st == null && card.i === 1 && card.d === T + 11 * MIN + DAY, 'second good graduates to 1-day interval');
ok(Core.learned(st.cards[idB]), 'graduated card is learned');
let s3 = Core.buildSession(st, entries, ['b1', 'b2'], 20);
ok(s3.ids.indexOf(idB) === -1, 'card due tomorrow is not scheduled now');

/* again mid-steps restarts the current step (error → fast re-exposure) */
const idE = s3.ids.filter((x) => x !== idA && x !== idB)[0];
Core.applyGrade(st, idE, 2, T);
Core.applyGrade(st, idE, 0, T + MIN);
card = st.cards[idE];
ok(card.l === 1 && card.r === 0 && card.st === 1 && card.d === T + MIN + 10 * MIN, 'again mid-steps: lapse, restart step 1 (10 min)');

/* lapse on a graduated card: classic relearning (10 min), not "learned" any more */
Core.applyGrade(st, idB, 0, T - 20 * MIN);
card = st.cards[idB];
ok(card.r === 0 && card.l === 1 && card.st == null && card.d === T - 10 * MIN, 'again on learned card: lapse -> r=0, due in 10 min (now past)');
ok(Core.dueCards(st, entries, ['b1', 'b2']).some((e) => e.id === idB), 'lapsed card is due again');
ok(!Core.learned(st.cards[idB]), 'lapsed card no longer learned');
/* re-graduating a lapsed card returns to the classic 1-day path */
Core.applyGrade(st, idB, 2, T);
card = st.cards[idB];
ok(card.st == null && card.i === 1 && card.d === T + DAY, 'lapsed card recovers via classic 1-day interval');

/* easy on a fresh new card skips straight to 3 days */
const idC = s3.ids.filter((x) => x !== idA && x !== idB && x !== idE)[0];
Core.applyGrade(st, idC, 3, T);
card = st.cards[idC];
ok(card.st == null && card.i === 3 && card.e === 2.65, 'easy: 3 days, ease 2.5 -> 2.65');

/* daily new-card quota: only r=0 cards newly added today count (idE failed) */
ok(Core.newTodayCount(st) === 1, 'newTodayCount: only the failed new card (r=0) counts');

/* challenges — independent of the level selection */
const cands = Core.challengeCandidates(st, entries, ['b1']);
ok(cands.length === Object.keys(Core.CLUSTERS).length, 'every cluster is always listed (main menu shows all)');
ok(cands.filter((c) => c.startable).length === 3, 'farben, wochentage, tiere all startable (level-independent)');
const candsC2 = Core.challengeCandidates(st, entries, ['c2']);
ok(cands.filter((c) => c.startable).map((c) => c.key).join() === candsC2.filter((c) => c.startable).map((c) => c.key).join(), 'startability is identical whatever levels are picked');
const offer = Core.pickChallengeOffer(st, entries, ['b1']);
ok(offer && cands.find((c) => c.key === offer.key).startable, 'offer picks a startable cluster');
const qs = Core.buildChallenge(st, entries, ['b1'], 'farben', 'es-en');
ok(qs.length === 10, 'challenge = 10 questions');
for (const q of qs) {
  ok(q.opts.length === 4, '4 options per question');
  ok(q.opts.indexOf(q.answer) !== -1, 'answer among options');
  ok(new Set(q.opts.map((x) => x.toLowerCase())).size === 4, 'options unique');
}
ok(Core.buildChallenge(st, entries, ['b1'], 'farben', 'mix').length === 10, 'mix direction still 10 questions');
ok(Core.buildChallenge(st, entries, ['c2'], 'farben', 'es-en').length === 10, 'challenge draws from the whole deck, not just selected levels');

/* no cooldown: clusters stay available right after being played */
const beforePlay = Core.challengeCandidates(st, entries, ['b1']).map((c) => c.key + ':' + c.startable).join();
st.chalDone.farben = { n: 1 };
const afterPlay = Core.challengeCandidates(st, entries, ['b1']).map((c) => c.key + ':' + c.startable).join();
ok(beforePlay === afterPlay, 'clusters stay ready immediately after a challenge (no cooldown)');
ok(Core.pickChallengeOffer(st, entries, ['b1']) !== null, 'offer still picks a cluster right after playing');

/* import parser: mixed line + JSON-line input */
const imp = Core.parseImport('["el gato","cat","b1"]\n["el sol","sun","a5","nope"]\nperro | dog | b1 | tiere\n');
ok(imp.entries.length === 3, 'parseImport mixed: 3 valid entries');
ok(imp.entries[1][2] === 'b1' && (imp.entries[1][3] || null) === null, 'invalid level+cluster defaulted');
ok(imp.entries[2][3] === 'tiere' && imp.entries[2][2] === 'b1', 'line format with cluster works');
ok(imp.errors === 0, 'no duplicates');

const imp2 = Core.parseImport('[["uno","one","b1"],["uno","other","b1"]]');
ok(imp2.entries.length === 1 && imp2.errors === 1, 'whole-JSON import + duplicate detection');

/* pretest: 4 unique options incl. the answer, both directions */
const p1 = Core.buildPretest(entries, entries[0], 'es-en');
ok(p1 && p1.opts.length === 4 && p1.opts.indexOf(entries[0].en) !== -1, 'buildPretest es-en: 4 options incl. English answer');
const p2 = Core.buildPretest(entries, entries[0], 'en-es');
ok(p2 && p2.opts.indexOf(entries[0].es) !== -1, 'buildPretest en-es: Spanish answer among options');
ok(p2.opts.every((o) => typeof o === 'string' && o.length > 0), 'pretest options non-empty');

/* typed matching: accents, articles, junk */
ok(Core.answerMatches('la mesa', 'MESÁ'), 'matches ignoring accents');
ok(Core.answerMatches('el tiempo', 'tiempo'), 'matches ignoring leading article');
ok(Core.answerMatches('tiempo', 'el tiempo'), 'matches with extra article on guess');
ok(Core.answerMatches('trabajar', 'trabajár '), 'matches ignoring accents + trailing space');
ok(!Core.answerMatches('la mesa', 'silla'), 'rejects a wrong word');
ok(!Core.answerMatches('salir', 'ir'), 'rejects substring traps');
ok(!Core.answerMatches('la mesa', ''), 'rejects empty guess');
ok(Core.normalizeAnswer('¡MÁÑANA!') === 'manana', 'normalizeAnswer strips accents + punctuation');

if (fails) { console.error('\n' + fails + ' FAILURE(S)'); process.exit(1); }
console.log('\nSMOKE OK — core logic verified');