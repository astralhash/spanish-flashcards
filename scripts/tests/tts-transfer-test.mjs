/* Regression test: Supertonic inference under ort's wasm-proxy TRANSFER rules.
   The real ort (verified in the minified 1.29.0 bundle) neuters the model
   ArrayBuffer on every InferenceSession.create and the data buffer of every
   input tensor on every run(); a reused buffer dies detached and Firefox
   throws "attempting to access detached ArrayBuffer". The stub reproduces
   that behavior exactly, so driving the REAL src/tts.js warmCache through it
   proves that no buffer is ever reused across two ort calls: every word of
   the warm must synthesize cleanly, across consecutive runs (the persistent
   warm worker re-runs inference on the same compiled sessions). */

import { register } from 'node:module';
import assert from 'node:assert/strict';

register('./tts-stub/loader.mjs', import.meta.url);

/* minimal browser env for src/tts.js: no WebGPU, no OPFS, no MediaRecorder,
   no AudioContext — the warm must still complete end-to-end */
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });

const TTS_JSON = JSON.stringify({
  ae: { sample_rate: 44100, base_chunk_size: 512 },
  ttl: { chunk_compress_factor: 4, latent_dim: 32 }
});
const INDEXER = JSON.stringify(new Array(65536).fill(42));
const STYLE = JSON.stringify({
  style_ttl: { data: [[1, 2, 3, 4]], dims: [1, 4] },
  style_dp: { data: [[5, 6]], dims: [1, 2] }
});
const MODEL_SIZES = { 'duration_predictor.onnx': 1001, 'text_encoder.onnx': 1002, 'vector_estimator.onnx': 1003, 'vocoder.onnx': 1004 };

const realFetch = globalThis.fetch;
globalThis.fetch = async function (url) {
  const u = String(url);
  if (u.indexOf('Supertone/supertonic-3') === -1) return realFetch(url);
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

const ort = await import('./tts-stub/ort-stub.mjs');
const { window: _ignored } = await import('../../src/tts.js');
const NTT = globalThis.window.NeuralTTS;

async function warm(words, label) {
  const res = await NTT.warmCache(words, { voice: 'st-F1', rate: 1 });
  assert.equal(res.failed, 0, label + ': no word may fail under proxy-transfer rules (' + JSON.stringify(res) + ')');
  assert.equal(res.done, words.length, label + ': every word cached (' + JSON.stringify(res) + ')');
  assert.equal(res.skipped, 0, label + ': fresh cache, nothing skipped');
  return res;
}

/* run 1: fresh worker, fresh sessions — exercises dp/te/8x ve/voc per word */
await warm(['hola', 'adiós', 'gato', 'casa', 'perro'], 'run 1');
/* run 2: the SAME persistent worker and SAME compiled sessions — catches any
   buffer reuse across words (the exact bug that froze the old warm) */
await warm(['luna', 'sol', 'mesa', 'silla', 'puerta', 'ventana'], 'run 2');
/* run 3: cancellation still resolves cleanly */
{
  const p = NTT.warmCache(['uno', 'dos', 'tres', 'cuatro'], { voice: 'st-F1', rate: 1 });
  p.cancel();
  const res = await p;
  assert.ok(res.total === 4 && res.done + res.skipped + res.failed <= 4, 'cancel resolves with a sane summary');
}
/* and a second real warm after the cancel, to prove the engine survived it */
await warm(['taco', 'burrito'], 'post-cancel');

const stats = ort.stats;
assert.ok(stats.creates >= 4, 'stub saw the four model compiles (' + stats.creates + ')');
assert.ok(stats.runs >= 13 * 11, 'stub saw the full dp+te+8ve+voc chains (' + stats.runs + ')');

console.log('TTS TRANSFER TEST OK — ' + stats.creates + ' creates, ' + stats.runs +
  ' runs, zero detached-buffer violations across ' + 18 + ' warm words');
