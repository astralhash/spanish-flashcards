/* VocabES build: merge data/*.json → validate → inline everything into a single index.html */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const TARGETS = { b1: 800, b2: 600, c1: 400, c2: 200 };
const CLUSTERS_OK = new Set(['wochentage', 'monate', 'zahlen', 'farben', 'familie', 'essen', 'koerper', 'tiere', 'expresiones', 'jerga', 'cine']);
const LEVELS_OK = new Set(Object.keys(TARGETS));

/* ---------- 1. load & validate source files ---------- */
const files = readdirSync('data').filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) { console.error('no data files found'); process.exit(1); }

const problems = [];
const all = [];
for (const f of files) {
  let arr;
  try { arr = JSON.parse(readFileSync('data/' + f, 'utf8')); }
  catch (e) { console.error('JSON parse error in', f, ':', e.message); process.exit(1); }
  if (!Array.isArray(arr)) { console.error(f, 'is not an array'); process.exit(1); }
  for (const row of arr) {
    const bad = [];
    if (!Array.isArray(row) || row.length < 3 || row.length > 4) bad.push('shape');
    else {
      if (typeof row[0] !== 'string' || !row[0].trim()) bad.push('es');
      const en = typeof row[1] === 'string' ? row[1].trim() : '';
      if (en) row[1] = en; else bad.push('en');
      const lvl = String(row[2] || '').toLowerCase();
      if (!LEVELS_OK.has(lvl)) bad.push('level:' + row[2]);
      row[2] = lvl;
      if (row.length === 4) {
        const cl = String(row[3] || '').toLowerCase();
        if (!CLUSTERS_OK.has(cl)) bad.push('cluster:' + row[3]);
        else row[3] = cl;
      }
    }
    if (bad.length) problems.push([f, JSON.stringify(row), bad.join(',')]);
    else all.push({ f, row });
  }
  console.log(`${f}: ${arr.length} rows`);
}

/* ---------- 2. dedupe by Spanish word (keep lower level / earlier file) ---------- */
const seen = new Map();
for (const { f, row } of all) {
  const key = row[0].toLowerCase();
  if (!seen.has(key)) seen.set(key, { f, row });
  else problems.push([f, JSON.stringify(row), 'duplicate of ' + seen.get(key).row[0] + ' (' + seen.get(key).f + ')']);
}
const merged = [...seen.values()].map((v) => v.row);

/* ---------- 3. report ---------- */
const counts = { b1: 0, b2: 0, c1: 0, c2: 0 };
const clusters = {};
for (const row of merged) {
  counts[row[2]]++;
  if (row[3]) clusters[row[3]] = (clusters[row[3]] || 0) + 1;
}
console.log('\n=== merged totals ===');
let total = 0;
for (const lvl of ['b1', 'b2', 'c1', 'c2']) {
  const delta = counts[lvl] - TARGETS[lvl];
  console.log(`${lvl}: ${counts[lvl]} (target ${TARGETS[lvl]}, ${delta >= 0 ? '+' : ''}${delta})`);
  total += counts[lvl];
}
console.log('total:', total);

console.log('\nclusters:', JSON.stringify(clusters));
if (problems.length) {
  console.log('\n=== PROBLEMS (' + problems.length + ') ===');
  for (const p of problems.slice(0, 40)) console.log(' -', p.join('  |  '));
  if (problems.length > 40) console.log(' ... and', problems.length - 40, 'more');
} else console.log('\nno duplicate/invalid rows');

/* shortfall detection */
const short = Object.keys(TARGETS).filter((l) => counts[l] < TARGETS[l]);
if (short.length) {
  console.error('\nSHORTFALL: fill up levels:', short.join(', '), 'before building.');
  process.exit(1);
}

/* ---------- 4. assemble single html ---------- */
const core = readFileSync('src/core.cjs', 'utf8');
const conj = readFileSync('src/conj.cjs', 'utf8');
const css = readFileSync('src/style.css', 'utf8');
const app = readFileSync('src/app.js', 'utf8');
let html = readFileSync('src/template.html', 'utf8');
/* inject real word counts into the template text */
html = html.replace(/%%COUNT%%/g, String(total))
           .replace(/%%B1%%/g, String(counts.b1))
           .replace(/%%B2%%/g, String(counts.b2))
           .replace(/%%C1%%/g, String(counts.c1))
           .replace(/%%C2%%/g, String(counts.c2));
{
  const left = html.match(/%{2}(?:COUNT|B1|B2|C1|C2)%{2}/g);
  if (left && left.length) { console.error('unreplaced count marker:', left.join(',')); process.exit(1); }
}
const vocabJs = 'const VOCAB = ' + JSON.stringify(merged).replace(/</g, '\\u003c') + ';';

/* conjugation coverage: every entry that starts with an infinitive must conjugate */
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const Conj = require('../src/conj.cjs');
let conjCount = 0, conjMiss = [];
for (const row of merged) {
  if (Conj.analyze(row[0])) conjCount++;
  else {
    const first = String(row[0]).split(/\s+/)[0].toLowerCase().replace(/^no\s+/, '');
    if (/(?:ar|er|ir|ír|arse|erse|irse)$/.test(first)) conjMiss.push(row[0]);
  }
}
console.log(`conjugations: ${conjCount} entries with conjugation data (hover tables)`);
if (conjMiss.length) {
  console.log('  WARNING — infinitive-led entries without conjugation:', conjMiss.join(' | '));
}

html = html.replace('/*__CSS__*/', () => css)
           .replace('/*__CORE__*/', () => core)
           .replace('/*__CONJ__*/', () => conj)
           .replace('/*__VOCAB__*/', () => vocabJs)
           .replace('/*__APP__*/', () => app);   /* replacer fn: prevents $ pattern interpretation ($$ in app.js!) */

if (html.includes('/*__')) { console.error('unreplaced marker left in template'); process.exit(1); }
writeFileSync('index.html', html);
console.log('\n✓ built index.html (' + (html.length / 1024).toFixed(1) + ' kB)');