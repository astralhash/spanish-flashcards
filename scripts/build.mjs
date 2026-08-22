/* VocabES build: merge data/*.json → validate → inline everything into a single index.html */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const TARGETS = { b1: 400, b2: 300, c1: 200, c2: 100 };
const CLUSTERS_OK = new Set(['wochentage', 'monate', 'zahlen', 'farben', 'familie', 'essen', 'koerper', 'tiere']);
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
const css = readFileSync('src/style.css', 'utf8');
const app = readFileSync('src/app.js', 'utf8');
let html = readFileSync('src/template.html', 'utf8');
const vocabJs = 'const VOCAB = ' + JSON.stringify(merged).replace(/</g, '\\u003c') + ';';

html = html.replace('/*__CSS__*/', () => css)
           .replace('/*__CORE__*/', () => core)
           .replace('/*__VOCAB__*/', () => vocabJs)
           .replace('/*__APP__*/', () => app);   /* replacer fn: prevents $ pattern interpretation ($$ in app.js!) */

if (html.includes('/*__')) { console.error('unreplaced marker left in template'); process.exit(1); }
writeFileSync('index.html', html);
console.log('\n✓ built index.html (' + (html.length / 1024).toFixed(1) + ' kB)');