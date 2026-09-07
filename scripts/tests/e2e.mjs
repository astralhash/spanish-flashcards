/* Full e2e: typed session (+ recap) → practice missed → flashcard session with
   pretests → cluster challenge with replay → typed challenge → import → persistence. */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('log', (...a) => console.log('PAGE-LOG:', ...a));
vc.on('jsdomError', (e) => errors.push(e.message.split('\n')[0]));

const dom = new JSDOM(html, {
  url: 'https://vocabes.local/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.confirm = () => true;
    window.speechSynthesis = { speak() {}, cancel() {}, getVoices() { return []; }, speaking: false };
    window.addEventListener('error', (e) => errors.push((e.error && e.error.message) || e.message));
  },
});
const { window } = dom;
const doc = window.document;
const $$ = (s) => [...doc.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗ FAIL:', name); } };

/* ——— helpers ——— */
const NORM = (s) => String(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STRIP_ART = (s) => s.replace(/^(el|la|los|las|lo|un|una|unos|unas|der|die|das)\s+/, '');
const normWord = (el) => STRIP_ART(NORM((el.textContent || '').replace(/🔊/g, '')));
/* VOCAB is a top-level const → global lexical binding, not a window property */
const VOCAB = window.eval('VOCAB');
ok(Array.isArray(VOCAB) && VOCAB.length > 1000, 'vocab array accessible (' + (VOCAB && VOCAB.length) + ' rows)');
/* find a VOCAB row whose Spanish (or English) matches the given text */
function findRow(text) {
  const t = normWord({ textContent: text });
  for (const row of VOCAB) {
    if (normWord({ textContent: row[0] }) === t) return row;
  }
  for (const row of VOCAB) {
    if (NORM(row[1]) === t) return row;
  }
  return null;
}
const answerFor = (row, isEsFront) => isEsFront ? row[1] : row[0];
/* resolve the row behind a pretest question by matching its rendered options —
   robust against homonyms ("sonar"/"soñar" collide accent-stripped, and EN
   glosses repeat across rows, which makes findRow ambiguous) */
const pretestRow = (text, isEsFront) => {
  const opts = $$('#preOpts button').map((b) => NORM(b.textContent));
  return VOCAB.find((r) => (isEsFront ? normWord({ textContent: r[0] }) === normWord({ textContent: text })
                                      : NORM(r[1]) === NORM(text)) &&
                         opts.indexOf(NORM(isEsFront ? r[1] : r[0])) !== -1) || findRow(text);
};
/* the row actually behind a typed round: same ES (accent-insensitively) AND the
   EN the page just revealed — findRow alone can pick an accent-homonym
   ("sonar" vs "soñar" normalize identically) */
const trueRow = (esText, shownEn) =>
  VOCAB.find((r) => normWord({ textContent: r[0] }) === normWord({ textContent: esText }) &&
                    NORM(r[1]) === NORM(shownEn)) || findRow(esText);

await wait(250);

/* ——— start screen ——— */
ok($$('#levelChips .chip').length === 4, '4 level chips rendered');
ok(doc.querySelector('#voiceOrb') && doc.querySelector('#voiceOrb').hidden, 'voice orb present and idle initially');

/* main menu exposes every cluster challenge directly */
const allClusters = Object.keys(window.Core.CLUSTERS).length;
const menuRows = $$('#chalListStart .chal-tile');
ok(menuRows.length === allClusters, 'main-menu lists all ' + allClusters + ' clusters');
ok($$('#chalListStart .chal-tile:not(:disabled)').length >= 3, 'several challenges startable from the main menu');

/* default answer style is typed → challenge starts in typed mode */
click(doc.querySelector('#chalListStart .chal-tile:not(:disabled)'));
await wait(40);
ok(!doc.querySelector('#scr-chal').hidden, 'challenge can be started from the main menu');
ok(!doc.querySelector('#chTypeWrap').hidden && doc.querySelector('#chOpts').hidden, 'typed challenge shows the type-in box, not options');
click(doc.querySelector('#chQuit'));
await wait(30);
ok(!doc.querySelector('#scr-start').hidden, 'aborting a main-menu challenge returns to the main menu');

/* disable b2 -> only b1 in session */
click(doc.querySelector('#levelChips .chip:nth-child(2)'));
await wait(30);

/* ——— typed review session ——— */
click(doc.querySelector('#startBtn'));
await wait(30);
ok(!doc.querySelector('#scr-quiz').hidden, 'quiz screen visible');
ok(!doc.querySelector('#typePanel').hidden && doc.querySelector('#flip').hidden, 'typed panel shown by default');
const total = parseInt(doc.querySelector('#qcount').textContent.split('/')[1], 10);
ok(total === 20, 'session has 20 cards: ' + total);

/* wrong answer via the ENTER key (the real keyboard path) → red reveal + the correct
   solution, and it STAYS — the Enter keydown must not double-fire into an instant advance */
const typedMissRows = [];
{
  let row = findRow(doc.querySelector('#typeWord').textContent);
  ok(!!row, 'can resolve the typed question word to a vocab row');
  const input = doc.querySelector('#typeInput');
  input.value = 'zzz-not-the-answer';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(350);
  ok(!doc.querySelector('#typeFb').hidden && doc.querySelector('#typeFb').classList.contains('fb-bad'),
    'wrong typed answer (via Enter) shows the red reveal block');
  row = trueRow(row[0], doc.querySelector('#typeFbA').textContent);
  typedMissRows.push(row);
  ok(doc.querySelector('#typeFbQ').textContent.replace(/🔊/g, '').trim() === row[0],
    'reveal row shows the question word');
  ok(doc.querySelector('#typeFbA').textContent.trim() === row[1], 'reveal row shows the correct answer');
  ok(!doc.querySelector('#typeVerdict').hidden && doc.querySelector('#typeVerdict').classList.contains('bad') &&
     doc.querySelector('#typeVerdict').textContent.includes('✗'), 'red ✗ verdict shown');
  ok(!doc.querySelector('#typeInput').hidden && doc.querySelector('#typeInput').classList.contains('bad'),
    'typed input stays visible, turned red');
  ok(doc.querySelector('#typeWord').hidden, 'reveal clears the question word');
  ok(doc.querySelector('#typeInput').disabled, 'input locked after answering');
  ok(!doc.querySelector('#typeNext').hidden, 'Continue button shown after a miss');
  await wait(900);                                   /* no auto-advance for a miss */
  ok(doc.querySelector('#qcount').textContent.split('/')[0].trim() === '1', 'resolution stays on screen until the learner advances');
  key(' ');                                          /* Space advances */
  await wait(80);
  ok(doc.querySelector('#qcount').textContent.split('/')[1].trim() === '21', 'missed card re-queued (total 20 → 21)');
  ok(!doc.querySelector('#typeInput').hidden, 'next card shows the input again');
}

/* correct answer via Enter → green reveal + green input → held until Space/Enter/click */
{
  let row = findRow(doc.querySelector('#typeWord').textContent);
  ok(!!row, 'second question resolvable');
  const input = doc.querySelector('#typeInput');
  input.value = answerFor(row, true);                /* dir is es-en */
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(350);
  if (doc.querySelector('#typeFb').classList.contains('fb-bad')) {
    /* findRow picked an accent-homonym (sonar/soñar) → the "wrong" reveal is
       the matcher being right about the real word: overrule and move on */
    click(doc.querySelector('#typeVeto'));
    await wait(80);
  }
  row = trueRow(row[0], doc.querySelector('#typeFbA').textContent);
  ok(!doc.querySelector('#typeFb').hidden && doc.querySelector('#typeFb').classList.contains('fb-ok'),
    'correct typed answer shows the green reveal block');
  ok(doc.querySelector('#typeFbQ').textContent.replace(/🔊/g, '').trim() === row[0], 'green reveal shows the question word');
  ok(doc.querySelector('#typeFbA').textContent.trim() === row[1], 'green reveal shows the correct answer');
  ok(!doc.querySelector('#typeVerdict').hidden && doc.querySelector('#typeVerdict').classList.contains('ok') &&
     doc.querySelector('#typeVerdict').textContent.includes('✓'), 'green ✓ verdict shown');
  ok(!doc.querySelector('#typeInput').hidden && doc.querySelector('#typeInput').classList.contains('ok'),
    'typed input stays visible, turned green');
  ok(!doc.querySelector('#typeNext').hidden, 'correct answer also waits — Continue button shown');
  await wait(900);                                   /* no auto-advance for a correct answer either */
  ok(doc.querySelector('#qcount').textContent.split('/')[0].trim() === '2', 'correct answer holds until the learner advances');
  key(' ');                                          /* Space advances */
  await wait(80);
  ok(doc.querySelector('#qcount').textContent.split('/')[0].trim() === '3', 'Space advances after a correct answer');
}

/* ✋ veto: a wrongly marked typed answer can be overruled — graded good and
   remembered locally as a correct alternative for that word */
let vetoedEs = null;
{
  let row = findRow(doc.querySelector('#typeWord').textContent);
  ok(!!row, 'fourth question resolvable (veto round)');
  const input = doc.querySelector('#typeInput');
  ok(doc.querySelector('#typeVeto').hidden, 'no veto button on a fresh card');
  input.value = 'zz-novelt-guess';                   /* definitely wrong */
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(350);
  row = trueRow(row[0], doc.querySelector('#typeFbA').textContent);
  vetoedEs = row[0];
  ok(!doc.querySelector('#typeVeto').hidden, 'wrong mark offers the ✋ veto button');
  const totalBefore = doc.querySelector('#qcount').textContent.split('/')[1].trim();
  click(doc.querySelector('#typeVeto'));
  await wait(80);
  ok(doc.querySelector('#typeVeto').hidden, 'veto button hides after overruling');
  ok(doc.querySelector('#typeVerdict').classList.contains('ok') &&
     doc.querySelector('#typeVerdict').textContent.includes('✓'), 'overruled verdict flips to accepted');
  ok(doc.querySelector('#typeInput').classList.contains('ok'), 'overruled input turns green');
  const alts = JSON.parse(window.localStorage.getItem('vocabes.v1.alt') || '{}');
  ok(Array.isArray(alts[NORM(row[1])]) && alts[NORM(row[1])].indexOf(NORM('zz-novelt-guess')) !== -1,
    'overruled guess stored as a correct alternative (localStorage vocabes.v1.alt)');
  key(' ');
  await wait(80);
  ok(doc.querySelector('#qcount').textContent.split('/')[1].trim() === totalBefore,
    'overruled answer grades good — no requeue (total unchanged)');
}

/* synonym glosses ("beanie, winter hat"): any ONE synonym counts as correct */
ok(window.eval('Core.answerMatches("beanie, winter hat", "beanie")') === true,
  'built page accepts a single synonym (beanie, winter hat → beanie)');
ok(window.eval('Core.answerMatches("beanie, winter hat", "winter hat")') === true,
  'built page accepts the other synonym too');

/* empty field + Enter = "don't know": neutral reveal (no verdict), held like every outcome */
{
  let row = findRow(doc.querySelector('#typeWord').textContent);
  ok(!!row, 'third question resolvable');
  const input = doc.querySelector('#typeInput');
  input.value = '';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(350);
  ok(!doc.querySelector('#typeFb').hidden && !doc.querySelector('#typeFb').classList.contains('fb-ok') &&
     !doc.querySelector('#typeFb').classList.contains('fb-bad'), 'empty Enter reveals neutrally (no red/green wash class)');
  ok(doc.querySelector('#typeVerdict').hidden, 'empty Enter shows no \u2713/\u2717 verdict');
  row = trueRow(row[0], doc.querySelector('#typeFbA').textContent);
  typedMissRows.push(row);
  ok(doc.querySelector('#typeFbA').textContent.trim() === row[1], 'empty Enter reveals the correct answer');
  ok(!doc.querySelector('#typeNext').hidden, 'Continue shown after an empty reveal');
  ok(doc.querySelector('#typeInput').hidden, 'revealed-without-answer round hides the idle input');
  key(' ');
  await wait(80);
}

/* end the session → recap shows the missed word → practice them now */
click(doc.querySelector('#quitBtn'));
await wait(40);
ok(!doc.querySelector('#scr-done').hidden, 'done screen visible after ending the session');
ok(!doc.querySelector('#recapBox').hidden, 'words-to-watch recap shown');
ok(doc.querySelector('#recapList .recap-item') != null, 'recap lists the missed word');
ok($$('#recapList .recap-item').every((r) => !r.textContent.includes(vetoedEs)),
  'overruled (vetoed) word is NOT in words-to-watch');
ok(!doc.querySelector('#doneTip').hidden, 'evening-review tip shown after the session');
click(doc.querySelector('#recapPractice'));
await wait(40);
ok(!doc.querySelector('#scr-quiz').hidden, 'practice-missed starts a fresh review');
const missedN = $$('#recapList .recap-item').length;
ok(doc.querySelector('#qcount').textContent.split('/')[1].trim() === String(missedN),
  'practice session contains exactly the missed cards (' + missedN + ')');
/* answer it correctly (green reveal holds → Space advances) until done */
let guard = 0;
while (doc.querySelector('#scr-done').hidden && guard++ < 8) {
  const q = doc.querySelector('#typeWord').textContent;
  const row = typedMissRows.find((r) => normWord({ textContent: r[0] }) === normWord({ textContent: q })) || findRow(q);
  doc.querySelector('#typeInput').value = answerFor(row, true);
  doc.querySelector('#typeInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(400);
  key(' ');
  await wait(350);
}
ok(!doc.querySelector('#scr-done').hidden, 'practice session completes');

/* ——— answer style lives on the main menu: switch to flashcard mode ——— */
ok(doc.querySelector('#scr-start #ansSeg') && $$('#ansSeg button').length === 3,
  'answer-style segmented control sits on the main menu (Type/Mixed/Flashcard)');
const flipBtn = doc.querySelector('#ansSeg button[data-ans="flip"]');
click(flipBtn);
await wait(30);
ok(flipBtn.classList.contains('active'), 'flashcard mode selected');
ok(/Space/i.test(doc.querySelector('#dirHint').textContent), 'main-page hint explains flashcards (Space reveals)');
ok(!/Enter/.test(doc.querySelector('#dirHint').textContent), 'flashcard hint does not leak typed-mode instructions');
click(doc.querySelector('#settingsBtn'));
await wait(30);
ok(!doc.querySelector('#modal').hidden, 'settings modal opens');
ok(doc.querySelector('#setPretest').checked === true, 'pretest on by default');
click(doc.querySelector('#modalClose'));
await wait(20);
const savedSet = JSON.parse(window.localStorage.getItem('vocabes.v1.set') || '{}');
ok(savedSet.ans === 'flip', 'answer style persisted: ' + savedSet.ans);

/* ——— flashcard session with pretests ——— */
click(doc.querySelector('#startBtn'));
await wait(30);
ok(!doc.querySelector('#scr-quiz').hidden, 'quiz screen visible (flashcard mode)');

/* first card is brand-new → pretest panel with 4 options */
await wait(60);
ok(!doc.querySelector('#pretestPanel').hidden, 'new card shows the 4-option pretest');
ok($$('#preOpts button').length === 4, 'pretest has 4 options');
{
  const row = pretestRow(doc.querySelector('#preWord').textContent, true);
  ok(!!row, 'pretest question resolvable');
  const correct = $$('#preOpts button').find((b) => NORM(b.textContent) === NORM(answerFor(row, true)));
  ok(!!correct, 'pretest answer option found');
  click(correct);
  await wait(350);
  ok(!doc.querySelector('#preFb').hidden && doc.querySelector('#preFb').classList.contains('fb-ok'),
    'correct pretest guess confirmed (green reveal)');
  ok(doc.querySelector('#preFbQ').textContent.replace(/🔊/g, '').trim() === row[0] &&
    doc.querySelector('#preFbA').textContent.trim() === row[1], 'pretest reveal shows question = answer');
  await wait(1400);                                  /* nothing may auto-advance */
  ok(!doc.querySelector('#pretestPanel').hidden, 'pretest feedback holds until the learner advances');
  ok(doc.querySelector('#flip').hidden, 'rating card stays hidden while feedback holds');
  key(' ');                                          /* advance: the self-grade commits */
  await wait(80);
  ok(doc.querySelector('#flip').hidden, 'self-grading pretest: no rating card afterwards');
  ok(!doc.querySelector('#pretestPanel').hidden, 'advance goes straight to the next new word');
}

/* keyboard: digits answer the pretest; a correct pick self-grades and moves on */
{
  const krow = pretestRow(doc.querySelector('#preWord').textContent, true);
  const kopts = $$('#preOpts button');
  const kidx = kopts.findIndex((b) => NORM(b.textContent) === NORM(answerFor(krow, true)));
  key(String(kidx + 1));                             /* keyboard picks the option */
  await wait(150);
  ok(!doc.querySelector('#pretestPanel').hidden, 'keyboard answer holds its feedback too');
  key(' ');                                          /* commit + next card */
  await wait(80);
  ok(doc.querySelector('#flip').hidden && !doc.querySelector('#pretestPanel').hidden,
    'correct keyboard pick self-grades straight into the next pretest');
}

/* grade the whole session: pretests → reveal → Space (regression) → grade */
(() => {
  let graded = 0, guard = 0;
  const loop = async () => {
    while (doc.querySelector('#scr-done').hidden && guard++ < 90) {
      if (doc.querySelector('#scr-quiz').hidden) { ok(false, 'quiz vanished mid-session'); break; }
      const pre = doc.querySelector('#pretestPanel');
      if (!pre.hidden) {
        /* self-grading: pick the correct option so the session stays recap-clean */
        const prow = pretestRow(doc.querySelector('#preWord').textContent, true);
        const popts = $$('#preOpts button');
        const pidx = popts.findIndex((b) => NORM(b.textContent) === NORM(answerFor(prow, true)));
        click(popts[Math.max(0, pidx)]);
        await wait(120);
        key(' ');                                   /* hold released → grade commits, next card */
        await wait(60);
        continue;
      }
      const flip = doc.querySelector('#flip');
      if (!flip.classList.contains('flipped')) {
        if (graded === 0) {
          key(' ');                                   /* regression: Space must flip the card */
          await wait(15);
          ok(flip.classList.contains('flipped'), 'Space flips the card (shows answer)');
          key('3');                                   /* and 1–4 grades */
          await wait(30);
          ok(!flip.classList.contains('flipped'), '1–4 key grades to the next question');
        } else {
          click(flip);
          await wait(15);
          ok(flip.classList.contains('flipped'), 'click reveals answer side');
          click(doc.querySelector('#grades .g-good'));
          await wait(30);
        }
        if (!doc.querySelector('#scr-done').hidden) break;
        ok(!flip.classList.contains('flipped') || !doc.querySelector('#pretestPanel').hidden,
          'next card shows news-side (front-up or pretest)');
        graded++;
      } else {
        click(doc.querySelector('#grades .g-good'));
        await wait(30);
      }
    }
  };
  return loop();
})().then(async () => {
  ok(!doc.querySelector('#scr-done').hidden, 'flashcard session complete after grading (' + 'all' + ')');
  ok(doc.querySelector('#recapBox').hidden, 'no words-to-watch when everything was graded good');

  /* ——— right-hand home row: j k l ö grade like 1 2 3 4 on any layout —
     dedicated round with the pretest off so every card is a rating card;
     k is pressed FIRST, before any ö/layout detection, like on a US keyboard ——— */
  click(doc.querySelector('#homeBtn'));
  await wait(30);
  click(doc.querySelector('#settingsBtn'));
  await wait(30);
  ok(!doc.querySelector('#modal').hidden, 'settings modal opens for the rating-key round');
  click(doc.querySelector('#setPretest'));
  await wait(20);
  ok(doc.querySelector('#setPretest').checked === false, 'pretest disabled for the rating-key round');
  click(doc.querySelector('#modalClose'));
  await wait(20);
  click(doc.querySelector('#startBtn'));
  await wait(40);
  ok(doc.querySelector('#pretestPanel').hidden && !doc.querySelector('#flip').hidden,
    'pretest off: every card opens as a rating card');
  key(' ');
  await wait(15);
  ok(key('k') === false, 'k grades "hard" with no prior layout detection');
  await wait(30);
  ok(!doc.querySelector('#flip').classList.contains('flipped'), 'k grades to the next question');
  ok($$('#grades kbd.alt:not([hidden])').length === 3, 'grade buttons show the j/k/l home-row hints');
  ok(doc.querySelector('#altOe').hidden, 'ö hint hidden until the layout is known to produce ö');
  key(' ');
  await wait(15);
  ok(key('ö') === false, 'ö grades "easy"');
  await wait(30);
  ok(!doc.querySelector('#altOe').hidden, 'pressing ö reveals the ö hint on the Easy button');
  key(' ');
  await wait(15);
  ok(key('l') === false, 'l grades "good"');
  await wait(30);
  key(' ');
  await wait(15);
  ok(key('3') === false, 'digit grading preventDefaults (no leak into the next typed input)');
  await wait(30);
  ok(!doc.querySelector('#flip').classList.contains('flipped'), '1–4 key grades to the next question');
  let guardR = 0;
  while (doc.querySelector('#scr-done').hidden && guardR++ < 60) {
    if (!doc.querySelector('#flip').classList.contains('flipped')) { key(' '); await wait(15); }
    key('3');
    await wait(30);
  }
  ok(!doc.querySelector('#scr-done').hidden, 'rating-key round completes (j/k/l/ö behave like 1/2/3/4)');
  ok(doc.querySelector('#recapBox').hidden, 'rating-key round stays recap-clean (easy/hard/good only)');
  /* pretest back on for the following sections */
  click(doc.querySelector('#homeBtn'));
  await wait(30);
  click(doc.querySelector('#settingsBtn'));
  await wait(30);
  click(doc.querySelector('#setPretest'));
  await wait(20);
  ok(doc.querySelector('#setPretest').checked === true, 'pretest re-enabled');
  click(doc.querySelector('#modalClose'));
  await wait(20);

  /* ——— EN→ES: self-grading fail path + direction invariant of the grade buttons ——— */
  click(doc.querySelector('#homeBtn'));
  await wait(30);
  click(doc.querySelector('#dirSeg button[data-dir="en-es"]'));
  await wait(30);
  ok($$('#dirSeg button').find((b) => b.dataset.dir === 'en-es').classList.contains('active'),
    'EN→ES direction selected');
  click(doc.querySelector('#startBtn'));
  await wait(60);
  let missRow = null;
  {
    ok(!doc.querySelector('#pretestPanel').hidden, 'en-es: brand-new card opens with the pretest');
    /* resolve the real row via its Spanish option — findRow alone is ambiguous
       when several rows share the same English gloss */
    missRow = pretestRow(doc.querySelector('#preWord').textContent, false);
    ok(!!missRow, 'en-es pretest resolvable');
    ok(normWord(doc.querySelector('#preWord')) === NORM(missRow[1]), 'en-es prompt is the ENGLISH word');
    const popts = $$('#preOpts button');
    const wrongIdx = popts.findIndex((b) => NORM(b.textContent) !== NORM(missRow[0]));
    click(popts[wrongIdx]);                          /* wrong on purpose (single try) */
    await wait(350);
    ok(!doc.querySelector('#preFb').hidden && doc.querySelector('#preFb').classList.contains('fb-bad'),
      'wrong pretest guess shows the red reveal');
    await wait(1200);
    ok(!doc.querySelector('#pretestPanel').hidden, 'failed-pick feedback also holds for input');
    key(' ');
    await wait(80);
    ok(doc.querySelector('#flip').hidden, 'a failed pretest also never opens a rating card');
  }

  /* finish the session: every remaining pretest answered correctly */
  let guardE = 0;
  while (doc.querySelector('#scr-done').hidden && guardE++ < 90) {
    if (!doc.querySelector('#pretestPanel').hidden) {
      const o = $$('#preOpts button');
      const tr = pretestRow(doc.querySelector('#preWord').textContent, false);
      const i = o.findIndex((b) => NORM(b.textContent) === NORM(tr[0]));
      if (i < 0) console.error('DBG no valid option for', doc.querySelector('#preWord').textContent);
      click(o[Math.max(0, i)]);
      await wait(120);
      key(' ');
      await wait(60);
      continue;
    }
    const flip = doc.querySelector('#flip');
    if (!flip.classList.contains('flipped')) { key(' '); await wait(30); }
    key('3');
    await wait(40);
  }
  ok(!doc.querySelector('#scr-done').hidden, 'en-es session completes');

  /* the deliberately missed word is the only entry in words-to-watch … */
  ok(!doc.querySelector('#recapBox').hidden, 'failed pretest lands in words-to-watch');
  ok($$('#recapList .recap-item').length === 1, 'exactly one watched word after a single failed pretest');
  ok(normWord({ textContent: doc.querySelector('#recapList .recap-es').textContent }) === normWord({ textContent: missRow[0] }),
    'watched word is the missed Spanish word');

  /* … and practicing it returns a REGULAR flashcard: question side up first,
     grade buttons on the real answer face (Spanish back for en-es) */
  click(doc.querySelector('#recapPractice'));
  await wait(40);
  ok(doc.querySelector('#pretestPanel').hidden && !doc.querySelector('#flip').hidden,
    'practiced word comes back as a regular flashcard, not a second pretest');
  ok(!doc.querySelector('#flip').classList.contains('flipped'), 'regular flashcard opens question-side-up');
  ok(normWord(doc.querySelector('#frontWord')) === NORM(missRow[1]), 'en-es front face shows the English question');
  key(' ');
  await wait(60);
  ok(doc.querySelector('#flip').classList.contains('flipped'), 'Space flips to the answer side');
  ok(normWord(doc.querySelector('#backWord')) === normWord({ textContent: missRow[0] }),
    'grade buttons sit on the REAL answer face: Spanish back for en-es');
  ok(key('j') === false, 'j grades "again"');
  await wait(80);
  ok(doc.querySelector('#scr-done').hidden, '"again" requeues the failed card within the session');
  ok(!doc.querySelector('#flip').classList.contains('flipped'), 'requeued card returns question-side-up');
  key(' ');
  await wait(40);
  ok(doc.querySelector('#flip').classList.contains('flipped'), 'requeued card flips to the answer side');
  ok(key('l') === false, 'l grades the requeued card "good"');
  await wait(60);
  ok(!doc.querySelector('#scr-done').hidden, 'practice round completes after the requeue');

  /* restore ES→EN for the following sections */
  click(doc.querySelector('#homeBtn'));
  await wait(30);
  click(doc.querySelector('#dirSeg button[data-dir="es-en"]'));
  await wait(30);

  const chalRows = $$('#chalList .chal-tile');
  ok(chalRows.length === allClusters, 'done-screen cluster list also shows all ' + allClusters + ' clusters');

  /* ——— flashcard challenge with missed-item replay ——— */
  const startBtn = doc.querySelector('#chalList .chal-tile:not(:disabled)');
  if (startBtn) {
    click(startBtn);
    await wait(40);
    ok(!doc.querySelector('#scr-chal').hidden, 'challenge screen visible (flashcard mode)');
    ok($$('#chOpts button').length === 4 && doc.querySelector('#chTypeWrap').hidden, '4 answer options in flashcard challenge');
    const word = doc.querySelector('#chWord').textContent.trim();
    ok(word.length > 0, 'question word shown: ' + word.replace(/🔊/g, ''));
    ok(!doc.querySelector('#chWord').hasAttribute('data-conj') &&
       [...doc.querySelectorAll('#chOpts button')].every((b) => !b.hasAttribute('data-conj')),
       'challenge words are not conjugation-tagged');
    /* Q1: answer wrong on purpose → it must come back in the replay round */
    const mainLen = parseInt(doc.querySelector('#chCount').textContent.split('/')[1].trim(), 10);
    const row1 = findRow(doc.querySelector('#chWord').textContent);
    ok(!!row1, 'challenge question resolvable (' + doc.querySelector('#chWord').textContent.replace(/🔊/g, '').trim() + ')');
    const q1answer = answerFor(row1, true);
    const wrongIdx = $$('#chOpts button').findIndex((b) => NORM(b.textContent) !== NORM(q1answer));
    click($$('#chOpts button')[wrongIdx]);
    /* regression: while TTS is talking, the next question must wait — set the
       flag immediately (the app's own minimum dwell is only 620 ms) */
    window.speechSynthesis.speaking = true;
    const cntBusy = doc.querySelector('#chCount').textContent;
    await wait(900);
    ok(doc.querySelector('#chCount').textContent === cntBusy, 'MC challenge holds the resolution while speech plays');
    window.speechSynthesis.speaking = false;
    await wait(300);
    ok(doc.querySelector('#chCount').textContent !== cntBusy, 'challenge advances once speech finished');
    /* the rest: answer correctly */
    let guard2 = 0;
    while (doc.querySelector('#scr-chaldone').hidden && guard2++ < 60) {
      const row = findRow(doc.querySelector('#chWord').textContent);
      const ans = row ? answerFor(row, true) : null;
      const idx = ans === null ? -1 : $$('#chOpts button').findIndex((b) => NORM(b.textContent) === NORM(ans));
      click($$('#chOpts button')[Math.max(0, idx)]);
      await wait(700);
    }
    ok(!doc.querySelector('#scr-chaldone').hidden, 'challenge finished');
    const scoreTxt = doc.querySelector('#chdStats').textContent;
    /* one deliberate miss in the main round → replay re-asks it → asked = mainLen + 1, all but the first correct */
    ok(scoreTxt.includes(mainLen + ' / ' + (mainLen + 1)),
      'replay round included: expected score ' + mainLen + ' / ' + (mainLen + 1) + ' → ' + scoreTxt.replace(/\s+/g, ' ').slice(0, 60));
    ok(!doc.querySelector('#chdRecap').hidden && $$('#chdRecapList .recap-item').length >= 1, 'words-to-watch recap after challenge');
  }

  /* ——— typed challenge: wrong answer & peek wait for Space/click ——— */
  click(doc.querySelector('#chdHome'));
  await wait(30);
  click(doc.querySelector('#ansSeg button[data-ans="type"]'));
  await wait(30);
  ok(/Enter/.test(doc.querySelector('#dirHint').textContent) && !/Space to reveal/.test(doc.querySelector('#dirHint').textContent),
    'main-page hint switches to typed instructions (Enter checks, no flashcard reveal text)');
  click(doc.querySelector('#chalListStart .chal-tile:not(:disabled)'));
  await wait(40);
  ok(!doc.querySelector('#scr-chal').hidden && !doc.querySelector('#chTypeWrap').hidden, 'typed challenge active after switching style');
  {
    const row = findRow(doc.querySelector('#chWord').textContent);
    doc.querySelector('#chTypeInput').value = 'zzz-wrong';
    doc.querySelector('#chTypeInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(400);
    ok(!doc.querySelector('#chTypeFb').hidden && doc.querySelector('#chTypeFb').classList.contains('fb-bad'),
      'typed challenge wrong answer (via Enter) shows red reveal');
    ok(doc.querySelector('#chTypeFbQ').textContent.replace(/🔊/g, '').trim() === row[0], 'reveal shows the question word');
    ok(!doc.querySelector('#chTypeInput').hidden && doc.querySelector('#chTypeInput').classList.contains('bad'),
      'challenge input stays visible, turned red');
    ok(!doc.querySelector('#chTypeVerdict').hidden && doc.querySelector('#chTypeVerdict').classList.contains('bad') &&
       doc.querySelector('#chTypeVerdict').textContent.includes('✗'), 'challenge shows the ✗ verdict');
    ok(!doc.querySelector('#chTypeVeto').hidden, 'challenge miss offers the ✋ veto button too');
    click(doc.querySelector('#chTypeVeto'));
    await wait(80);
    ok(doc.querySelector('#chTypeVeto').hidden && doc.querySelector('#chTypeVerdict').classList.contains('ok') &&
       doc.querySelector('#chTypeVerdict').textContent.includes('✓') && doc.querySelector('#chTypeInput').classList.contains('ok'),
      'challenge veto flips the verdict to accepted (input green)');
    ok(!doc.querySelector('#chTypeFb').classList.contains('fb-bad') && doc.querySelector('#chTypeFb').classList.contains('fb-ok'),
      'challenge veto turns the reveal green');
    ok(doc.querySelector('#chWord').hidden, 'typed challenge reveal clears the question word');
    ok(!doc.querySelector('#chTypeNext').hidden, 'challenge Continue button shown');
    const beforeCount = doc.querySelector('#chCount').textContent;
    await wait(900);
    ok(doc.querySelector('#chCount').textContent === beforeCount, 'typed challenge resolution stays until Space');
    key(' ');
    await wait(500);
    ok(doc.querySelector('#chCount').textContent !== beforeCount, 'Space advances the typed challenge');
    ok(!doc.querySelector('#chTypeInput').hidden, 'next typed question shows the input again');
  }
  /* peek: resolution shown (neutral), waits for input too */
  {
    const row = findRow(doc.querySelector('#chWord').textContent);
    const chInp = doc.querySelector('#chTypeInput');
    chInp.value = '';                                     /* empty Enter = show answer */
    chInp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(350);
    ok(!doc.querySelector('#chTypeFb').hidden && !doc.querySelector('#chTypeFb').classList.contains('fb-ok') &&
       !doc.querySelector('#chTypeFb').classList.contains('fb-bad'), 'peek shows a neutral reveal');
    ok(doc.querySelector('#chTypeFbQ').textContent.replace(/🔊/g, '').trim() === row[0] &&
    doc.querySelector('#chTypeFbA').textContent.trim() === row[1], 'peek reveals question = answer');
    ok(doc.querySelector('#chTypeVerdict').hidden, 'peek shows no ✓/✗ verdict');
    ok(doc.querySelector('#chTypeInput').hidden, 'peek hides the idle input — no dead field above the reveal');
    ok(chInp.disabled, 'peeked input is locked too');
    const beforeCount = doc.querySelector('#chCount').textContent;
    await wait(900);
    ok(doc.querySelector('#chCount').textContent === beforeCount, 'peeked resolution also waits for input');
    key(' ');
    await wait(500);
    ok(doc.querySelector('#chCount').textContent !== beforeCount, 'Space advances after peek');
  }
  /* correct typed answer → green reveal → held until Space, like every other outcome */
  {
    const row = findRow(doc.querySelector('#chWord').textContent);
    doc.querySelector('#chTypeInput').value = answerFor(row, true);
    doc.querySelector('#chTypeInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(350);
    ok(!doc.querySelector('#chTypeFb').hidden && doc.querySelector('#chTypeFb').classList.contains('fb-ok'),
      'typed challenge correct answer shows green reveal');
    ok(!doc.querySelector('#chTypeInput').hidden && doc.querySelector('#chTypeInput').classList.contains('ok'),
      'challenge input stays visible, turned green');
    ok(!doc.querySelector('#chTypeVerdict').hidden && doc.querySelector('#chTypeVerdict').classList.contains('ok') &&
       doc.querySelector('#chTypeVerdict').textContent.includes('✓'), 'challenge shows the ✓ verdict');
    ok(!doc.querySelector('#chTypeNext').hidden, 'challenge Continue button shown after a correct answer too');
    const beforeCount = doc.querySelector('#chCount').textContent;
    await wait(1100);                               /* no auto-advance here either */
    ok(doc.querySelector('#chCount').textContent === beforeCount, 'correct typed challenge answer also waits');
    key(' ');
    await wait(500);
    ok(doc.querySelector('#chCount').textContent !== beforeCount && !doc.querySelector('#chTypeInput').hidden,
      'Space advances after a correct typed challenge answer');
  }
  click(doc.querySelector('#chQuit'));
  await wait(30);
  ok(!doc.querySelector('#scr-start').hidden, 'aborting typed challenge returns to the main menu');

  /* ——— mixed mode: type + flashcard in one run ——— */
  ok($$('#ansSeg button').length === 3, 'answer style offers Type / Mixed / Flashcard');
  click(doc.querySelector('#ansSeg button[data-ans="mix"]'));
  await wait(30);
  ok(/Enter/.test(doc.querySelector('#dirHint').textContent) && /Space/i.test(doc.querySelector('#dirHint').textContent),
    'mixed-mode hint covers both formats (Enter checks, Space reveals)');
  ok(JSON.parse(window.localStorage.getItem('vocabes.v1.set') || '{}').ans === 'mix', 'mixed mode persisted');
  click(doc.querySelector('#startBtn'));
  await wait(30);
  ok(!doc.querySelector('#scr-quiz').hidden, 'mixed-mode session starts');
  let sawType = false, sawFlip = false, mixes = 0, guardM = 0;
  while (doc.querySelector('#scr-done').hidden && guardM++ < 80 && mixes < 26) {
    if (!doc.querySelector('#typePanel').hidden) {
      sawType = true; mixes++;
      const row = findRow(doc.querySelector('#typeWord').textContent);
      if (row) {
        doc.querySelector('#typeInput').value = answerFor(row, true);
        doc.querySelector('#typeInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await wait(400);                             /* green reveal holds… Space advances */
        key(' ');
        await wait(350);
      } else { key(' '); await wait(400); }
    } else if (!doc.querySelector('#pretestPanel').hidden) {
      sawFlip = true; mixes++;              /* a pretest only appears in flashcard rounds */
      const prow = findRow(doc.querySelector('#preWord').textContent);
      const popts = $$('#preOpts button');
      const pidx = popts.findIndex((b) => NORM(b.textContent) === NORM(answerFor(prow, true)));
      click(popts[Math.max(0, pidx)]);
      await wait(150);
      key(' ');                                   /* self-grading advance, no rating card */
      await wait(100);
    } else if (!doc.querySelector('#flip').hidden) {
      sawFlip = true; mixes++;
      if (!doc.querySelector('#flip').classList.contains('flipped')) {
        click(doc.querySelector('#flip'));
        await wait(20);
      }
      click(doc.querySelector('#grades .g-good'));
      await wait(30);
    } else break;
  }
  ok(sawType && sawFlip, 'mixed run contained both typed rounds and flashcards');
  click(doc.querySelector('#quitBtn'));
  await wait(40);
  ok(!doc.querySelector('#scr-done').hidden, 'mixed session ends cleanly on the done screen');

  /* ——— settings & import ——— */
  click(doc.querySelector('#settingsBtn'));
  await wait(30);
  ok(!doc.querySelector('#modal').hidden, 'settings modal opens (2nd)');

  /* pre-heat UI present; hidden because the default HD voice is not Supertonic */
  ok(!!doc.querySelector('#warmBtn') && !!doc.querySelector('#warmBox'), 'pre-heat button + box present in settings');
  ok(doc.querySelector('#warmBox').hidden, 'pre-heat box hidden for a non-Supertonic voice');
  ok(typeof window.NeuralTTS.warmCache === 'function', 'NeuralTTS.warmCache exposed');
  ok(typeof window.NeuralTTS.cacheStats === 'function' && typeof window.NeuralTTS.clearWordCache === 'function',
    'NeuralTTS.cacheStats + clearWordCache exposed');
  ok(!!doc.querySelector('#cacheStats') && !!doc.querySelector('#clearCacheBtn'), 'cache size + clear-cache controls present');
  ok(doc.querySelector('#clearCacheBtn').disabled === true, 'clear-cache disabled when the cache is empty');
  ok(typeof window.NeuralTTS.modelCached === 'function' && !!doc.querySelector('#modelStatus'), 'model-cache check + status element present');
  {
    const cached = await window.NeuralTTS.modelCached();
    ok(cached === false, 'modelCached resolves false without OPFS');
  }
  /* warmCache: an empty deck (Supertonic voice) resolves; a non-Supertonic voice rejects */
  {
    const emptyRes = await window.NeuralTTS.warmCache([], { voice: 'st-F1' });
    ok(emptyRes && emptyRes.total === 0 && emptyRes.percent === 100, 'warmCache empty (Supertonic) resolves');
    let rejected = false;
    await window.NeuralTTS.warmCache(['hola'], { voice: 'kokoro-ef_dora' }).catch(() => { rejected = true; });
    ok(rejected, 'warmCache rejects for a non-Supertonic voice');
  }
  /* warmCache circuit breaker: with the engine unusable (jsdom — no ort module,
     no OPFS) the batch must ABORT with a clear error after
     WARM_MAX_CONSEC_FAILS consecutive failures, not mass-fail the whole list
     (the old code burned through every word and froze on an unsettled
     promise). Six words: the 5th consecutive failure throws 'Warm stopped…'. */
  {
    let err = null, lastProg = null;
    await window.NeuralTTS.warmCache(
      ['hola', 'adiós', 'casa', 'perro', 'gato', 'luna'],
      { voice: 'st-F1' },
      (p) => { lastProg = p; }
    ).then(() => { }, (e) => { err = e; });
    ok(err && /Warm stopped/.test(err.message), 'warmCache aborts on consecutive engine failures: ' + (err && err.message));
    ok(lastProg && lastProg.failed === 5 && lastProg.total === 6,
      'breaker stops the list at the failure cap (failed=' + (lastProg && lastProg.failed) + ' of 6)');
  }
  /* cacheStats resolves (0 bytes/count in jsdom — no OPFS) and clearWordCache returns a count */
  {
    const st = await window.NeuralTTS.cacheStats();
    ok(st && st.bytes === 0 && st.count === 0, 'cacheStats resolves to zeros without OPFS');
    const n = await window.NeuralTTS.clearWordCache();
    ok(typeof n === 'number' && n === 0, 'clearWordCache resolves to a count (0 here)');
  }

  const ta = doc.querySelector('#importArea');
  ta.value = 'la estrella de mar | starfish | b1 | tiere\n["el casco urbano","city center","b2"]\n';
  click(doc.querySelector('#importBtn'));
  await wait(400);   /* state save is debounced ~220ms */
  ok(doc.querySelector('#importMsg').textContent.includes('2 word'), 'import accepted 2 words: ' + doc.querySelector('#importMsg').textContent);
  click(doc.querySelector('#modalClose'));
  await wait(20);

  /* ——— conjugation hover card ——— */
  const mo = (target, opts) => target.dispatchEvent(new window.MouseEvent('mouseover', Object.assign({ bubbles: true, cancelable: true, view: window }, opts || {})));
  ok(!!window.Conj, 'conjugation engine present in page');
  ok(window.Conj.analyze('tomar el pelo') && window.Conj.analyze('tomar el pelo').head === 'tomar', 'analyze handles idioms');
  ok(window.Conj.analyze('ayer') === null, 'analyze rejects ayer');
  const pg = window.Conj.table('pagar');
  ok(pg && pg.tenses[0].rows.some((r) => r[1] === 'pago'), 'pagar presente yo = pago');
  ok(pg && pg.tenses[1].rows.some((r) => r[1] === 'pagué'), 'pagar preterite yo = pagué');
  const vw = doc.createElement('div');
  vw.dataset.conj = 'pagar';
  doc.body.appendChild(vw);
  mo(vw, { clientX: 120, clientY: 130 });
  await wait(30);
  const cc = doc.querySelector('#conjCard');
  ok(cc && cc.classList.contains('show'), 'hover shows conjugation card');
  ok(cc && cc.textContent.includes('pago') && cc.textContent.includes('pagamos'), 'card contains pago/pagamos');
  mo(vw, { clientX: 200, clientY: 200 });
  await wait(20);
  mo(doc.body, { clientX: 5, clientY: 5 });   /* leave the verb */
  await wait(20);
  ok(!cc.classList.contains('show'), 'card hides when pointer leaves the verb');
  vw.remove();

  /* custom imported word conjugates too (analyze fallback) */
  ok(window.Conj.analyze('nadar') && window.Conj.analyze('nadar').head === 'nadar', 'custom infinitive conjugates');

  /* local state persisted */
  const saved = JSON.parse(window.localStorage.getItem('vocabes.v1.state') || 'null');
  ok(saved && saved.custom.length === 2, 'import persisted to localStorage');

  /* theme toggle */
  const before = doc.documentElement.dataset.theme;
  click(doc.querySelector('#themeBtn'));
  await wait(20);
  ok(doc.documentElement.dataset.theme !== before, 'theme toggled: ' + before + ' → ' + doc.documentElement.dataset.theme);

  ok(errors.length === 0, 'NO JS ERRORS: ' + (errors.length ? errors.join('; ') : ''));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});