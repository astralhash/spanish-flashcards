/* Module-hooks loader: map the ort CDN import in src/tts.js to the transfer-
   semantics stub so the real engine code can run (and be stress-tested) under
   plain Node. */
export async function resolve(specifier, context, next) {
  if (specifier.indexOf('https://cdn.jsdelivr.net/npm/onnxruntime-web@') === 0) {
    return { url: new URL('./ort-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
