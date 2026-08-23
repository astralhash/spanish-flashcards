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

/* grading: hard -> 1 day, due tomorrow */
const idA = s.ids[0];
Core.applyGrade(st, idA, 1, T - 2 * DAY);
let card = st.cards[idA];
ok(card.r === 1 && card.i === 1 && card.d === T - DAY, 'hard: interval 1 day, due next day');
let s2 = Core.buildSession(st, entries, ['b1', 'b2'], 20);
ok(s2.ids.indexOf(idA) !== -1, 'overdue card reappears in session');
ok(s2.dueCount >= 1, 'dueCount reflects the overdue card');

/* good -> tomorrow  |  not due now, not unseen */
const idB = s2.ids.filter((x) => x !== idA)[0];
Core.applyGrade(st, idB, 2, T);
card = st.cards[idB];
ok(card.i === 1 && card.d === T + DAY, 'good: +1 day');
let s3 = Core.buildSession(st, entries, ['b1', 'b2'], 20);
ok(s3.ids.indexOf(idB) === -1, 'card due tomorrow is not scheduled now');

/* lapse: again on a learned card, due 10 min later, no longer learned */
Core.applyGrade(st, idB, 0, T - 20 * MIN);
card = st.cards[idB];
ok(card.r === 0 && card.l === 1 && card.d === T - 10 * MIN, 'again: lapse -> r=0, due in 10 min (now past)');
ok(Core.dueCards(st, entries, ['b1', 'b2']).some((e) => e.id === idB), 'lapsed card is due again');
ok(!Core.learned(st.cards[idB]), 'lapsed card no longer learned');

/* easy ramps interval + ease (fresh card -> e 2.65) */
const idC = s3.ids.filter((x) => x !== idA && x !== idB)[0];
Core.applyGrade(st, idC, 3, T);
card = st.cards[idC];
ok(card.i === 3 && card.e === 2.65, 'easy: 3 days, ease 2.5 -> 2.65');

/* daily new-card quota */
ok(Core.newTodayCount(st) === 1, 'newTodayCount: exactly the card introduced today (idB)');

/* challenges */
const cands = Core.challengeCandidates(st, entries, ['b1']);
ok(cands.length === 2, 'two clusters eligible for b1 (farben, wochentage)');
const offer = Core.pickChallengeOffer(st, entries, ['b1']);
ok(offer && (offer.key === 'farben' || offer.key === 'wochentage'), 'offer picks an eligible cluster');
const qs = Core.buildChallenge(st, entries, ['b1'], 'farben', 'es-en');
ok(qs.length === 10, 'challenge = 10 questions');
for (const q of qs) {
  ok(q.opts.length === 4, '4 options per question');
  ok(q.opts.indexOf(q.answer) !== -1, 'answer among options');
  ok(new Set(q.opts.map((x) => x.toLowerCase())).size === 4, 'options unique');
}
ok(Core.buildChallenge(st, entries, ['b1'], 'farben', 'mix').length === 10, 'mix direction still 10 questions');

/* challenge cooldown */
st.chalDone.farben = { n: 1, last: T };
const after = Core.challengeCandidates(st, entries, ['b1']);
ok(after.find((c) => c.key === 'farben').cooldownMs > 0, 'cooldown set after challenge');
ok(Core.pickChallengeOffer(st, entries, ['b1']) === null || Core.pickChallengeOffer(st, entries, ['b1']).key !== 'farben', 'offer respects cooldown');

/* import parser: mixed line + JSON-line input */
const imp = Core.parseImport('["el gato","cat","b1"]\n["el sol","sun","a5","nope"]\nperro | dog | b1 | tiere\n');
ok(imp.entries.length === 3, 'parseImport mixed: 3 valid entries');
ok(imp.entries[1][2] === 'b1' && (imp.entries[1][3] || null) === null, 'invalid level+cluster defaulted');
ok(imp.entries[2][3] === 'tiere' && imp.entries[2][2] === 'b1', 'line format with cluster works');
ok(imp.errors === 0, 'no duplicates');

const imp2 = Core.parseImport('[["uno","one","b1"],["uno","other","b1"]]');
ok(imp2.entries.length === 1 && imp2.errors === 1, 'whole-JSON import + duplicate detection');

if (fails) { console.error('\n' + fails + ' FAILURE(S)'); process.exit(1); }
console.log('\nSMOKE OK — core logic verified');