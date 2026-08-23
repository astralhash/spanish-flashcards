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
    window.speechSynthesis = { speak() {}, cancel() {}, getVoices() { return []; } };
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

await wait(250);

/* ——— start screen ——— */
ok($$('#levelChips .chip').length === 4, '4 level chips rendered');

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
{
  const row = findRow(doc.querySelector('#typeWord').textContent);
  ok(!!row, 'can resolve the typed question word to a vocab row');
  const input = doc.querySelector('#typeInput');
  input.value = 'zzz-not-the-answer';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(350);
  ok(!doc.querySelector('#typeFb').hidden && doc.querySelector('#typeFb').classList.contains('fb-bad'),
    'wrong typed answer (via Enter) shows the red reveal block');
  ok(doc.querySelector('#typeFbQ').textContent.replace(/🔊/g, '').trim() === row[0],
    'reveal row shows the question word');
  ok(doc.querySelector('#typeFbA').textContent.trim() === row[1], 'reveal row shows the correct answer');
  ok(!doc.querySelector('#typeVerdict').hidden && doc.querySelector('#typeVerdict').classList.contains('bad') &&
     doc.querySelector('#typeVerdict').textContent.includes('✗'), 'red ✗ verdict shown');
  ok(!doc.querySelector('#typeInput').hidden && doc.querySelector('#typeInput').classList.contains('bad'),
    'typed input stays visible, turned red');
  ok(doc.querySelector('#typeWord').hidden && doc.querySelector('#typeActions').hidden,
    'reveal clears the question and action buttons');
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
  const row = findRow(doc.querySelector('#typeWord').textContent);
  ok(!!row, 'second question resolvable');
  const input = doc.querySelector('#typeInput');
  input.value = answerFor(row, true);                /* dir is es-en */
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(350);
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

/* end the session → recap shows the missed word → practice them now */
click(doc.querySelector('#quitBtn'));
await wait(40);
ok(!doc.querySelector('#scr-done').hidden, 'done screen visible after ending the session');
ok(!doc.querySelector('#recapBox').hidden, 'words-to-watch recap shown');
ok(doc.querySelector('#recapList .recap-item') != null, 'recap lists the missed word');
ok(!doc.querySelector('#doneTip').hidden, 'evening-review tip shown after the session');
click(doc.querySelector('#recapPractice'));
await wait(40);
ok(!doc.querySelector('#scr-quiz').hidden, 'practice-missed starts a fresh review');
ok(doc.querySelector('#qcount').textContent.split('/')[1].trim() === '1', 'practice session contains exactly the missed card');
/* answer it correctly (green reveal holds → Space advances) until done */
let guard = 0;
while (doc.querySelector('#scr-done').hidden && guard++ < 8) {
  const row = findRow(doc.querySelector('#typeWord').textContent);
  doc.querySelector('#typeInput').value = answerFor(row, true);
  click(doc.querySelector('#typeCheck'));
  await wait(400);
  key(' ');
  await wait(350);
}
ok(!doc.querySelector('#scr-done').hidden, 'practice session completes');

/* ——— settings: switch to flashcard mode ——— */
click(doc.querySelector('#settingsBtn'));
await wait(30);
ok(!doc.querySelector('#modal').hidden, 'settings modal opens');
ok($$('#ansSeg button').length === 3, 'answer-style segmented control present (Type/Mixed/Flashcard)');
const flipBtn = doc.querySelector('#ansSeg button[data-ans="flip"]');
click(flipBtn);
await wait(20);
ok(flipBtn.classList.contains('active'), 'flashcard mode selected');
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
  const row = findRow(doc.querySelector('#preWord').textContent);
  ok(!!row, 'pretest question resolvable');
  const correct = $$('#preOpts button').find((b) => NORM(b.textContent) === NORM(answerFor(row, true)));
  ok(!!correct, 'pretest answer option found');
  click(correct);
  await wait(350);
  ok(!doc.querySelector('#preFb').hidden && doc.querySelector('#preFb').classList.contains('fb-ok'),
    'correct pretest guess confirmed (green reveal)');
  ok(doc.querySelector('#preFbQ').textContent.replace(/🔊/g, '').trim() === row[0] &&
    doc.querySelector('#preFbA').textContent.trim() === row[1], 'pretest reveal shows question = answer');
  await wait(1100);                                  /* auto-reveal */
  ok(doc.querySelector('#flip').classList.contains('flipped'), 'pretest reveal shows the answer side');
  ok(!doc.querySelector('#flip').hidden, 'flashcard visible after pretest');
}

/* keyboard: 1–4 answers the pretest; grades work after the reveal */
{
  key('3');                                                /* grade the revealed card 1 */
  await wait(60);
  const pre2 = doc.querySelector('#pretestPanel');
  ok(!pre2.hidden, 'next new card: pretest again');
  key('2');                                                /* keyboard answers the pretest */
  await wait(1350);
  ok(doc.querySelector('#flip').classList.contains('flipped'), 'pretest reveal via keyboard works');
  key('3');                                                /* grade the revealed card 2 */
  await wait(60);
  ok(!doc.querySelector('#pretestPanel').hidden, 'flashcard session continues: pretest on card 3');
}

/* grade the whole session: pretests → reveal → Space (regression) → grade */
(() => {
  let graded = 0, guard = 0;
  const loop = async () => {
    while (doc.querySelector('#scr-done').hidden && guard++ < 90) {
      if (doc.querySelector('#scr-quiz').hidden) { ok(false, 'quiz vanished mid-session'); break; }
      const pre = doc.querySelector('#pretestPanel');
      if (!pre.hidden) {
        click($$('#preOpts button')[Math.floor(Math.random() * 4)]);
        await wait(1300);
        /* after the pretest reveal the card is auto-flipped; grade it */
        if (!doc.querySelector('#flip').hidden && doc.querySelector('#flip').classList.contains('flipped')) {
          click(doc.querySelector('#grades .g-good'));
          await wait(30);
        }
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
    await wait(700);
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
  click(doc.querySelector('#settingsBtn'));
  await wait(30);
  click(doc.querySelector('#ansSeg button[data-ans="type"]'));
  click(doc.querySelector('#modalClose'));
  await wait(20);
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
    ok(doc.querySelector('#chWord').hidden && doc.querySelector('#chTypeActions').hidden,
      'typed challenge reveal clears the question and buttons');
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
    click(doc.querySelector('#chTypePeek'));
    await wait(350);
    ok(!doc.querySelector('#chTypeFb').hidden && !doc.querySelector('#chTypeFb').classList.contains('fb-ok') &&
       !doc.querySelector('#chTypeFb').classList.contains('fb-bad'), 'peek shows a neutral reveal');
    ok(doc.querySelector('#chTypeFbQ').textContent.replace(/🔊/g, '').trim() === row[0] &&
    doc.querySelector('#chTypeFbA').textContent.trim() === row[1], 'peek reveals question = answer');
    ok(doc.querySelector('#chTypeVerdict').hidden, 'peek shows no ✓/✗ verdict');
    ok(doc.querySelector('#chTypeInput').hidden, 'peek hides the idle input — no dead field above the reveal');
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
  click(doc.querySelector('#settingsBtn'));
  await wait(30);
  ok($$('#ansSeg button').length === 3, 'answer style offers Type / Mixed / Flashcard');
  click(doc.querySelector('#ansSeg button[data-ans="mix"]'));
  click(doc.querySelector('#modalClose'));
  await wait(20);
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
        click(doc.querySelector('#typeCheck'));
        await wait(400);                             /* green reveal holds… Space advances */
        key(' ');
        await wait(350);
      } else { key(' '); await wait(400); }
    } else if (!doc.querySelector('#pretestPanel').hidden) {
      sawFlip = true; mixes++;              /* a pretest only appears in flashcard rounds */
      click($$('#preOpts button')[0]);
      await wait(1400);
      if (!doc.querySelector('#flip').hidden && doc.querySelector('#flip').classList.contains('flipped')) {
        click(doc.querySelector('#grades .g-good'));
        await wait(30);
      }
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