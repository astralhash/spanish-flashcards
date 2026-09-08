/* Regression test: the Supertonic MODEL assets must persist in OPFS.
   The asset names are repo-style paths ('onnx/tts.json',
   'voice_styles/F1.json') — OPFS forbids '/' in file names, so every
   getFileHandle rejected and (silently caught) NOTHING was ever stored:
   the ~380 MB model re-downloaded on every session, including every
   pre-heat click. The fake OPFS below is backed by a REAL temp directory
   and enforces Chrome's rule (throws on names containing '/'), so this
   test fails unless the cache flattens names.

   A "page" is a separate node process (a truly fresh module instance;
   Node's ESM cache ignores query-string busting under module hooks).
   Phase 1 = first page: downloads once, stores everything.
   Phase 2 = reload: must find the model in OPFS, fetch NOTHING, skip the
   already-cached word, and synthesize a new word from the cached model. */

import { register } from 'node:module';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SELF = fileURLToPath(import.meta.url);

function runPhase(phase, tmp) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [SELF, '--phase=' + phase, tmp], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', function (code) {
      if (code === 0) resolve();
      else reject(new Error('phase ' + phase + ' failed (exit ' + code + ')'));
    });
    child.on('error', reject);
  });
}

if (!process.argv[2] || !process.argv[2].startsWith('--phase=')) {
  /* driver: two pages over one shared "disk" */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-opfs-'));
  try {
    await runPhase(1, tmp);
    await runPhase(2, tmp);
    console.log('TTS OPFS TEST OK — model persisted across a real reload: ' +
      'page 1 downloaded once and stored; page 2 fetched nothing, skipped the ' +
      'cached word and synthesized a new word from the OPFS model');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else {
  await main(Number(process.argv[2].split('=')[1]), process.argv[3]);
}

async function main(phase, tmp) {
  register('./tts-stub/loader.mjs', import.meta.url);

  /* minimal browser env: no WebGPU, no MediaRecorder, no AudioContext */
  globalThis.window = globalThis;
  const nav = {};
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });

  /* ---- fake OPFS: REAL temp dir on disk + Chrome's no-'/'-in-names rule ---- */
  const DIRS = { supertonic: 'supertonic', 'tts-cache': 'tts-cache' };
  function dirPath(name) {
    if (!DIRS[name]) throw new Error('unknown dir: ' + name);
    const p = path.join(tmp, DIRS[name]);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  function makeDir(name) {
    const p = dirPath(name);
    return {
      getFileHandle: function (fname, opts) {
        if (String(fname).indexOf('/') !== -1) {
          throw new TypeError("Name is not allowed (contains '/'): " + fname);
        }
        const fp = path.join(p, fname);
        if (!fs.existsSync(fp) && !opts?.create) {
          return Promise.reject(new Error('NotFoundError: ' + fname));
        }
        return Promise.resolve({
          getFile: function () {
            if (!fs.existsSync(fp)) return Promise.reject(new Error('NotFoundError: ' + fname));
            const bytes = fs.readFileSync(fp);
            return Promise.resolve({
              size: bytes.length,
              arrayBuffer: async function () { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
            });
          },
          createWritable: function () {
            return Promise.resolve({
              write: async function (data) {
                const bytes = typeof data.arrayBuffer === 'function'
                  ? Buffer.from(await data.arrayBuffer())
                  : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
                fs.writeFileSync(fp, bytes);
              },
              close: async function () {}
            });
          }
        });
      },
      values: function () {
        let names = fs.existsSync(p) ? fs.readdirSync(p) : [];
        let i = 0;
        return {
          next: async function () {
            if (i >= names.length) return { done: true };
            const n = names[i++];
            const fp = path.join(p, n);
            return { value: {
              name: n,
              getFile: async function () {
                const bytes = fs.readFileSync(fp);
                return { size: bytes.length, arrayBuffer: async function () { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
              }
            }, done: false };
          }
        };
      }
    };
  }
  nav.storage = {
    getDirectory: async function () {
      return {
        getDirectoryHandle: function (name) {
          return Promise.resolve(makeDir(name));
        }
      };
    }
  };

  /* ---- fetch stub: counts every HF asset download ---- */
  const TTS_JSON = JSON.stringify({
    ae: { sample_rate: 44100, base_chunk_size: 512 },
    ttl: { chunk_compress_factor: 4, latent_dim: 32 }
  });
  const INDEXER = JSON.stringify((function () {
    const a = new Array(65536);
    for (let i = 0; i < a.length; i++) a[i] = i;
    return a;
  })());
  const STYLE = JSON.stringify({
    style_ttl: { data: [[1, 2, 3, 4]], dims: [1, 4] },
    style_dp: { data: [[5, 6]], dims: [1, 2] }
  });
  const MODEL_SIZES = { 'duration_predictor.onnx': 1001, 'text_encoder.onnx': 1002, 'vector_estimator.onnx': 1003, 'vocoder.onnx': 1004 };
  const downloads = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function (url) {
    const u = String(url);
    if (u.indexOf('Supertone/supertonic-3') === -1) return realFetch(url);
    downloads.push(u.split('/resolve/main/')[1]);
    let bytes;
    if (u.endsWith('tts.json')) bytes = new TextEncoder().encode(TTS_JSON);
    else if (u.endsWith('unicode_indexer.json')) bytes = new TextEncoder().encode(INDEXER);
    else if (u.indexOf('voice_styles/') !== -1) bytes = new TextEncoder().encode(STYLE);
    else {
      const file = u.split('/').pop();
      assert.ok(MODEL_SIZES[file], 'unexpected asset fetch: ' + u);
      bytes = new Uint8Array(MODEL_SIZES[file]);
    }
    return { ok: true, body: null, arrayBuffer: async function () { return bytes.buffer.slice(0); } };
  };

  await import('../../src/tts.js');
  const NTT = globalThis.window.NeuralTTS;

  if (phase === 1) {
    assert.equal(await NTT.modelCached(), false, 'fresh page: model not cached yet');
    const res = await NTT.warmCache(['hola'], { voice: 'st-F1', rate: 1 });
    assert.equal(res.failed, 0, 'warm synthesize: no failures (' + JSON.stringify(res) + ')');
    assert.equal(res.done, 1, 'warm synthesize: word cached');
    assert.equal(await NTT.modelCached(), true, 'all model assets stored after first use');

    /* the 6 model assets + the used voice style must each be on disk under a
       FLAT name (no '/'), each downloaded exactly once */
    const stFiles = fs.readdirSync(path.join(tmp, 'supertonic'));
    for (const name of ['onnx/tts.json', 'onnx/unicode_indexer.json',
      'onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx',
      'onnx/vector_estimator.onnx', 'onnx/vocoder.onnx', 'voice_styles/F1.json']) {
      assert.ok(stFiles.indexOf(name.replace(/\//g, '__')) !== -1, 'stored flat: ' + name);
      assert.ok(!stFiles.some(function (k) { return k.indexOf('/') !== -1; }), 'no slashy names on disk');
    }
    const counts = {};
    for (const u of downloads) counts[u] = (counts[u] || 0) + 1;
    for (const u of downloads) assert.equal(counts[u], 1, 'single download: ' + u);
    assert.equal(downloads.length, 7, 'exactly 7 downloads (6 assets + voice style), got ' + downloads.length);
    console.log('  page 1: 7 downloads, all assets persisted under flat names');

    /* importWordCache: writes downloaded package files straight into the OPFS
       word cache; junk names are ignored; a second import skips the files it
       already wrote. The cached key must then be findable via cacheStats. The
       package's index.json manifest is recorded as package metadata. */
    {
      const key1 = NTT._wordKey('F1', '<es>adiós.</es>', 1);
      const key2 = NTT._wordKey('F1', '<es>gato.</es>', 1);
      const fake = (name) => ({ name, arrayBuffer: async () => new TextEncoder().encode('PACKAGE-' + name) });
      const manifest = { voice: 'F1', rate: 1, rateKey: '1.00', bitrateKbps: 48, count: 2, files: [key1 + '.ogg', key2 + '.ogg'] };
      const r1 = await NTT.importWordCache([
        fake(key1 + '.ogg'), fake(key2 + '.ogg'), fake('readme.txt'),
        { name: 'index.json', arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(manifest)) }
      ]);
      assert.equal(r1.imported, 2, 'import writes the two package files (got ' + JSON.stringify(r1) + ')');
      const r2 = await NTT.importWordCache([fake(key1 + '.ogg'), fake(key2 + '.ogg')]);
      assert.equal(r2.skipped, 2, 'second import skips files already in the cache (' + JSON.stringify(r2) + ')');
      const wFiles = fs.readdirSync(path.join(tmp, 'tts-cache'));
      assert.ok(wFiles.indexOf(key1 + '.ogg') !== -1 && wFiles.indexOf(key2 + '.ogg') !== -1,
        'imported package files land in tts-cache (' + wFiles.join(',') + ')');
      const stats = await NTT.cacheStats();
      assert.equal(stats.count, 3, 'cacheStats counts the warm word + 2 imported (' + stats.count + ')');
      const pkg = await NTT.packageInfo();
      assert.equal(pkg.voice, 'F1', 'packageInfo voice (' + JSON.stringify(pkg) + ')');
      assert.equal(pkg.rateKey, '1.00', 'packageInfo rate key');
      assert.equal(pkg.count, 2, 'packageInfo count from the manifest');
      assert.ok(wFiles.indexOf('package-meta.json') !== -1, 'package meta persisted to OPFS');
      console.log('  page 1: audio-package import writes 2 files, re-import skips both; package meta persisted');
    }
  } else {
    /* simulated reload: fresh process, same disk — the model must be reused */
    assert.equal(await NTT.modelCached(), true, 'reload: model recognized as cached');
    assert.equal(downloads.length, 0, 'reload: modelCached() fetched NOTHING (got: ' + downloads.join(',') + ')');

    /* a pre-heat on the fresh page must reuse the model AND the word cache */
    const res2 = await NTT.warmCache(['hola'], { voice: 'st-F1', rate: 1 });
    assert.equal(res2.skipped, 1, 'reload: already-cached word skipped (' + JSON.stringify(res2) + ')');
    assert.equal(res2.failed, 0, 'reload: no failures');
    assert.equal(downloads.length, 0, 'reload: pre-heat re-downloaded NOTHING');

    /* and an uncached word must synthesize from the OPFS-held model, no download */
    const res3 = await NTT.warmCache(['adiós'], { voice: 'st-F1', rate: 1 });
    assert.equal(res3.done, 1, 'reload: new word synthesized (' + JSON.stringify(res3) + ')');
    assert.equal(res3.failed, 0, 'reload: no failures');
    assert.equal(downloads.length, 0, 'reload: synthesis from cache fetched NOTHING');

    /* the imported package metadata must survive the reload (read from OPFS) */
    const pkg = await NTT.packageInfo();
    assert.equal(pkg.voice, 'F1', 'reload: package voice remembered (' + JSON.stringify(pkg) + ')');
    assert.equal(pkg.rateKey, '1.00', 'reload: package rate remembered');
    console.log('  page 2 (reload): 0 downloads; cached word skipped, new word synthesized, package meta persisted');
  }
}
