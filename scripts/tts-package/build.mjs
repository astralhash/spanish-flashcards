/* Offline TTS package builder — pre-synthesize every Spanish word with the
 * Supertonic 3 model and encode it as Opus, so the browser can import the
 * finished folder instead of warming the word cache in-browser (which is slow:
 * it re-runs inference on every first encounter).
 *
 * Output: an `audio/` folder next to `index.html` (or --out) containing one
 * Opus file per word named by the browser's exact Supertonic word-cache key
 * (`st2-<voice>-<hash(voice + prepped text + rate + bitrate)>`), plus an
 * `index.json` manifest describing voice / rate / bitrate / word count.
 * The browser's "Load audio package" button imports this folder into its OPFS
 * `tts-cache`, so the keys line up and repeats play instantly — no model load.
 *
 * The inference here is the same math as src/tts.js `supersonic.infer` /
 * `prep` / `ids` / `wordKey`, but driven by onnxruntime-node (CPU) instead of
 * onnxruntime-web (WASM/WebGPU) so it runs headless. Opus encoding uses ffmpeg
 * (must be on PATH) to produce real Opus-in-Ogg files the browser can decode.
 *
 * Usage (from repo root):
 *   npm --prefix scripts/tts-package i          # once: installs onnxruntime-node
 *   node scripts/tts-package/build.mjs          # default: st-F2 @ 1.00 -> audio/
 *   node scripts/tts-package/build.mjs --voice st-M1 --rate 0.92 --out /tmp/audio
 *
 * The model (~380 MB) is downloaded from Hugging Face on first run and cached
 * under a `.cache/` dir next to this script.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const CACHE = join(here, '.cache');
mkdirSync(CACHE, { recursive: true });

const ort = require('onnxruntime-node');

/* ---- config (mirror src/tts.js) ---- */
const ST_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/';
const ST_ASSETS = [
  ['onnx/tts.json', 1500],
  ['onnx/unicode_indexer.json', 310000],
  ['onnx/duration_predictor.onnx', 3670000],
  ['onnx/text_encoder.onnx', 36400000],
  ['onnx/vector_estimator.onnx', 256700000],
  ['onnx/vocoder.onnx', 101400000]
];
const ST_STEPS = 8;
const WORD_KBPS = 48;   /* must match src/tts.js WORD_KBPS — baked into the key */
const RATE_MIN = 0.7, RATE_MAX = 2.0;

/* supported Supertonic voices: the ones in src/tts.js VOICES */
const ST_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

function parseArgs(argv) {
  const a = { voice: 'F2', rate: 1.0, out: join(ROOT, 'audio'), limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--voice') a.voice = String(argv[++i]).toUpperCase();
    else if (v === '--rate') a.rate = Number(argv[++i]);
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--limit') a.limit = Number(argv[++i]);
    else if (v === '--help' || v === '-h') { a.help = true; }
  }
  return a;
}

/* ---- vocab: same merge/dedupe as scripts/build.mjs ---- */
function loadWords() {
  const files = readdirSync(join(ROOT, 'data')).filter((f) => f.endsWith('.json')).sort();
  const seen = new Map();
  for (const f of files) {
    const rows = JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const es = String(row[0]);
      if (!es) continue;
      const key = es.toLowerCase();
      if (!seen.has(key)) seen.set(key, es);
    }
  }
  return [...seen.values()];
}

/* ---- fetch + cache model assets ---- */
function cachePath(name) { return join(CACHE, name.replace(/\//g, '__')); }

async function fetchAsset(name) {
  const dest = cachePath(name);
  if (existsSync(dest)) return dest;
  const url = ST_BASE + name;
  process.stdout.write(`  downloading ${name}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    process.stdout.write(` ${(buf.length / 1048576).toFixed(1)} MB\n`);
    return dest;
  }
  const total = Number(res.headers.get('content-length') || 0);
  let loaded = 0, last = 0;
  const src = Readable.fromWeb(res.body);
  const ws = createWriteStream(dest);
  src.on('data', (c) => {
    loaded += c.length;
    const pct = total ? Math.round((loaded / total) * 100) : 0;
    if (pct !== last) { last = pct; process.stdout.write(` ${pct}%`); }
  });
  await pipeline(src, ws);
  process.stdout.write(` ${(loaded / 1048576).toFixed(1)} MB\n`);
  return dest;
}

/* ---- text preprocessing (mirror src/tts.js supersonic.prep) ---- */
function prep(text) {
  text = String(text).normalize('NFKD');
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
  const repl = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ' };
  for (const k in repl) text = text.split(k).join(repl[k]);
  text = text.replace(/[♥☆♡©\\]/g, '');
  text = text.split('@').join(' at ');
  text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!').replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'");
  text = text.replace(/"+/g, '"').replace(/'+/g, "'").replace(/`+/g, '`');
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += '.';
  return '<es>' + text + '</es>';
}

/* cyrb53 hash (mirror src/tts.js wordHash) */
function wordHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36));
}
/* wordCache key (mirror src/tts.js wordKey) */
function wordKey(voice, preppedText, speed) {
  const rate = Number(speed).toFixed(2);
  return 'st2-' + String(voice) + '-' + wordHash(String(voice) + '\x00' + String(preppedText) + '\x00' + rate + '\x00' + WORD_KBPS);
}

/* ---- Supertonic inference on onnxruntime-node ---- */
let SESS = null, CFG = null, IDX = null, STYLE = null;

function ids(text) {
  const L = text.length;
  const row = new Array(L);
  for (let j = 0; j < L; j++) row[j] = text.codePointAt(j) < IDX.length ? IDX[text.codePointAt(j)] : -1;
  const idsArr = row.map((n) => BigInt(n));
  const mask = new Float32Array(L).fill(1.0);
  return { ids: idsArr, mask, L };
}

async function ensure(voice) {
  if (SESS) return;
  const [ttsP, idxP, dpP, teP, veP, vocP, styleP] = await Promise.all([
    fetchAsset('onnx/tts.json'),
    fetchAsset('onnx/unicode_indexer.json'),
    fetchAsset('onnx/duration_predictor.onnx'),
    fetchAsset('onnx/text_encoder.onnx'),
    fetchAsset('onnx/vector_estimator.onnx'),
    fetchAsset('onnx/vocoder.onnx'),
    fetchAsset(`voice_styles/${voice}.json`)
  ]);
  CFG = JSON.parse(readFileSync(ttsP, 'utf8'));
  IDX = JSON.parse(readFileSync(idxP, 'utf8'));
  const style = JSON.parse(readFileSync(styleP, 'utf8'));
  STYLE = {
    ttlData: Float32Array.from(style.style_ttl.data.flat(Infinity)),
    ttlDims: style.style_ttl.dims,
    dpData: Float32Array.from(style.style_dp.data.flat(Infinity)),
    dpDims: style.style_dp.dims
  };
  const opts = { executionProviders: ['cpu'] };
  process.stdout.write('  compiling 4 Supertonic models…');
  SESS = {
    dp: await ort.InferenceSession.create(dpP, opts),
    te: await ort.InferenceSession.create(teP, opts),
    ve: await ort.InferenceSession.create(veP, opts),
    voc: await ort.InferenceSession.create(vocP, opts)
  };
  process.stdout.write(' done\n');
}

function infer(preppedText, speed) {
  const { ids: tIds, mask, L } = ids(preppedText);
  const t = (type, data, dims) => new ort.Tensor(type, data, dims);
  const run = (sess, feeds) => sess.run(feeds);
  const idsT = () => t('int64', tIds, [1, L]);
  const maskT = () => t('float32', mask, [1, 1, L]);

  return run(SESS.dp, { text_ids: idsT(), style_dp: t('float32', STYLE.dpData, STYLE.dpDims), text_mask: maskT() }).then((o) => {
    const duration = Array.from(o.duration.data).map((v) => v / speed);
    return run(SESS.te, { text_ids: idsT(), style_ttl: t('float32', STYLE.ttlData, STYLE.ttlDims), text_mask: maskT() }).then((o2) => {
      const embData = Float32Array.from(o2.text_emb.data);
      const embDims = Array.from(o2.text_emb.dims);
      const sr = CFG.ae.sample_rate;
      const chunkSize = CFG.ae.base_chunk_size * CFG.ttl.chunk_compress_factor;
      const latentLen = Math.floor((Math.floor(duration[0] * sr) + chunkSize - 1) / chunkSize);
      const latentDim = CFG.ttl.latent_dim * CFG.ttl.chunk_compress_factor;
      let xt = new Float32Array(latentDim * latentLen);
      for (let i = 0; i < xt.length; i += 2) {
        const u1 = Math.max(0.0001, Math.random()), u2 = Math.random();
        const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        xt[i] = g;
        if (i + 1 < xt.length) xt[i + 1] = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      }
      const wavLen = Math.floor(duration[0] * sr);
      const maskLen = Math.floor((wavLen + chunkSize - 1) / chunkSize);
      const latentMask = new Float32Array(latentLen);
      for (let i = 0; i < latentLen; i++) latentMask[i] = i < maskLen ? 1 : 0;
      for (let i = 0; i < xt.length; i++) xt[i] *= latentMask[i % latentLen];
      const totalData = new Float32Array([ST_STEPS]);
      const f32copy = (d, dims) => t('float32', Float32Array.from(d), dims);
      let cur = 0;
      const step = () => run(SESS.ve, {
        noisy_latent: t('float32', xt, [1, latentDim, latentLen]),
        text_emb: f32copy(embData, embDims),
        style_ttl: f32copy(STYLE.ttlData, STYLE.ttlDims),
        latent_mask: f32copy(latentMask, [1, 1, latentLen]),
        text_mask: maskT(),
        current_step: t('float32', new Float32Array([cur]), [1]),
        total_step: f32copy(totalData, [1])
      }).then((o) => {
        xt = Float32Array.from(o.denoised_latent.data);
        cur++;
        return cur < ST_STEPS ? step() : t('float32', xt, [1, latentDim, latentLen]);
      });
      return step().then((latent) => run(SESS.voc, { latent }).then((o3) => ({
        wav: Float32Array.from(o3.wav_tts.data), sr
      })));
    });
  });
}

/* ---- WAV writer ---- */
function wavBytes(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.floor(c * 32767), 44 + i * 2);
  }
  return buf;
}

/* ---- Opus encode via ffmpeg (real Opus-in-Ogg the browser can decode) ---- */
function encodeOpus(wavBuf, rate, dest) {
  /* wavBuf is a full RIFF WAV file — ffmpeg gets raw PCM here, so strip the
     44-byte header (feeding the header bytes as s16le produced a loud pop at
     the start of every word). */
  const pcm = (wavBuf.length >= 44 && wavBuf.toString('ascii', 0, 4) === 'RIFF')
    ? wavBuf.subarray(44)
    : wavBuf;
  const r = spawnSync('ffmpeg', [
    '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
    '-c:a', 'libopus', '-b:a', String(WORD_KBPS) + 'k', dest
  ], { input: pcm });
  if (r.status !== 0) {
    throw new Error('ffmpeg failed: ' + (r.stderr ? r.stderr.toString() : '') + (r.stdout ? r.stdout.toString() : ''));
  }
}

function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version']);
  return r.status === 0;
}

/* ---- main ---- */
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/tts-package/build.mjs [--voice F2] [--rate 1.00] [--out audio/]
  --voice   Supertonic voice (${ST_VOICES.join(', ')}); default F2
  --rate    playback rate 0.7-2.0; must match the app's rate setting; default 1.00
  --out     output folder; default <repo>/audio
  --limit   only build the first N words (testing); default all
Writes one <key>.ogg per word plus index.json (voice/rate/bitrate/count).`);
  process.exit(0);
}
const voice = args.voice.toUpperCase();
if (!ST_VOICES.includes(voice)) { console.error('Unknown Supertonic voice:', args.voice, '— pick one of', ST_VOICES.join(', ')); process.exit(1); }
const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, Number(args.rate) || 1.0));
if (!ffmpegAvailable()) { console.error('ffmpeg not found on PATH — required for Opus encoding.'); process.exit(1); }

const words = loadWords();
if (args.limit > 0) words.length = Math.min(args.limit, words.length);
console.log(`Building Supertonic audio package:`);
console.log(`  voice: ${voice} · rate: ${rate.toFixed(2)} · words: ${words.length}`);
console.log(`  output: ${args.out}`);
mkdirSync(args.out, { recursive: true });

await ensure(voice);

const manifest = { voice, rate: Number(rate.toFixed(2)), rateKey: rate.toFixed(2), bitrateKbps: WORD_KBPS, count: 0, bytes: 0, files: [] };
const started = Date.now();
let failed = 0;
const tmp = join(args.out, '.tmp.wav');

for (let i = 0; i < words.length; i++) {
  const word = words[i];
  const key = wordKey(voice, prep(word), rate);
  const dest = join(args.out, key + '.ogg');
  if (existsSync(dest)) { manifest.bytes += readFileSync(dest).length; manifest.files.push(key + '.ogg'); manifest.count++; continue; }
  try {
    const out = await infer(prep(word), rate);
    if (!out) throw new Error('no inference output');
    writeFileSync(tmp, wavBytes(out.wav, out.sr));
    encodeOpus(readFileSync(tmp), out.sr, dest);
    const bytes = readFileSync(dest).length;
    manifest.bytes += bytes;
    manifest.files.push(key + '.ogg');
    manifest.count++;
    const sec = ((Date.now() - started) / 1000);
    process.stdout.write(`  [${i + 1}/${words.length}] ${word} → ${(bytes / 1024).toFixed(1)} kB  (${(i + 1) / Math.max(1, sec) * 60 | 0} words/min)\n`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${word}: ${(e && e.message) || e}`);
  }
  if (failed > 20) { console.error('Too many failures — aborting.'); process.exit(1); }
}
if (existsSync(tmp)) { try { require('node:fs').unlinkSync(tmp); } catch (e) {} }

manifest.bytes = Number(manifest.bytes);
writeFileSync(join(args.out, 'index.json'), JSON.stringify(manifest, null, 2));
console.log(`\n✓ package written to ${args.out}`);
console.log(`  ${manifest.count}/${words.length} words · ${(manifest.bytes / 1048576).toFixed(1)} MB · ${Math.round((Date.now() - started) / 1000)}s` + (failed ? ` · ${failed} failed` : ''));
/* onnxruntime-node's native thread pool crashes on teardown after work is done
   (recursive_mutex lock failed). Exit explicitly so the package is final. */
process.exit(failed ? 1 : 0);
