/* Stub of onnxruntime-web that emulates the REAL wasm-proxy transfer semantics
   (both verified against the minified 1.29.0 bundle):
     • InferenceSession.create TRANSFERS (neuters) the model ArrayBuffer it is
       handed — even when the create later fails.
     • session.run() TRANSFERS (neuters) the data buffer of every input tensor
       (the real ort.Tensor wraps data by reference; the proxy posts the
       buffers with a transfer list).
     • Any buffer handed back a second time throws, exactly like Firefox:
       "attempting to access detached ArrayBuffer".
   Code under test must therefore never reuse a buffer across two ort calls —
   model bytes must be sliced per create, tensor data sliced per run(). */

var MODEL_SIZES = [1001, 1002, 1003, 1004];   /* dp, te, ve, voc — dispatch key */
var creates = 0, runs = 0;
var wordOrder = [];                            /* decoded word per dp.run — processing order */

function neuter(buf) {
  if (buf && buf.byteLength > 0) structuredClone(new Map(), { transfer: [buf] });
}
function assertLive(name, buf) {
  if (buf && buf.byteLength === 0) {
    throw new Error('attempting to access detached ArrayBuffer (' + name + ')');
  }
}
class OrtTensor {
  constructor(type, data, dims) {   /* mirrors the real ctor: data by reference */
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
function f32(arr, dims) { return new OrtTensor('float32', Float32Array.from(arr), dims || [arr.length]); }

class Session {
  constructor(modelSize) {
    this.modelSize = modelSize;
    this.kind = MODEL_SIZES.indexOf(modelSize);
    if (this.kind < 0) throw new Error('stub: unknown model size ' + modelSize);
  }
  async run(feeds) {
    runs++;
    var names = Object.keys(feeds);
    /* the real proxy worker receives LIVE transferred bytes — snapshot the
       inputs first, only then simulate the main-thread-side neutering */
    var snap = {};
    for (var i = 0; i < names.length; i++) {
      var t = feeds[names[i]];
      assertLive(names[i] + '.data', t.data && t.data.buffer);
      snap[names[i]] = { data: t.data.slice(), dims: t.dims };
    }
    for (i = 0; i < names.length; i++) neuter(feeds[names[i]].data.buffer);   /* proxy transfer */
    switch (this.kind) {
      case 0:   /* duration predictor — decode the word from its token ids */
        wordOrder.push(Array.from(snap.text_ids.data).map(function (n) { return String.fromCharCode(Number(n)); }).join(''));
        return { duration: f32([1.0], [1]) };
      case 1:   /* text encoder */
        return { text_emb: f32([1, 2, 3], [1, 1, 3]) };
      case 2: { /* vector estimator — return latent shaped like its input */
        var xt = snap.noisy_latent;
        var out = new Float32Array(xt.data.length);
        for (var j = 0; j < out.length; j++) out[j] = xt.data[j] * 0.5;
        return { denoised_latent: new OrtTensor('float32', out, xt.dims) };
      }
      default:  /* vocoder */
        return { wav_tts: f32(new Array(44100).fill(0.01), [44100]) };
    }
  }
}

export var env = { wasm: {} };
export var Tensor = OrtTensor;
export var InferenceSession = {
  create: async function (buf, opts) {
    assertLive('model buffer', buf);
    var size = buf.byteLength;
    neuter(buf);   /* real proxy transfers the model bytes on create */
    creates++;
    return new Session(size);
  }
};
/* test introspection: how many creates / runs the stub saw, and the order in
   which words were processed (one dp.run per word) */
export var stats = {
  get creates() { return creates; },
  get runs() { return runs; },
  get order() { return wordOrder; }
};
