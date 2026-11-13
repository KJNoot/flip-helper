// Runs U²-Netp in a Web Worker so the listing sheet stays responsive.
// onnxruntime-web is MIT, lazy-loaded from jsDelivr, and cached by the
// browser after the first use. Single-thread WASM only: GitHub Pages is
// not cross-origin isolated, so SharedArrayBuffer / WASM threads are off.

import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.wasm.bundle.min.mjs";

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
try { ort.env.logLevel = "error"; } catch (_) { /* older builds */ }

let session = null;

self.onmessage = async ev => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type === "load") {
      const buf = msg.modelBuffer;
      if (!buf) throw new Error("studio: missing model");
      session = await ort.InferenceSession.create(buf, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      self.postMessage({ id, type: "ready" });
      return;
    }
    if (msg.type === "infer") {
      if (!session) throw new Error("studio: model is not ready");
      const tensor = msg.tensor;
      const size = msg.size || Math.round(Math.sqrt((tensor.length || 0) / 3)) || 320;
      const feeds = { "input.1": new ort.Tensor("float32", tensor, [1, 3, size, size]) };
      const out = await session.run(feeds);
      const pred = out[session.outputNames[0]];
      const mask = pred.data instanceof Float32Array ? pred.data : Float32Array.from(pred.data);
      self.postMessage({ id, type: "mask", mask, width: size, height: size }, [mask.buffer]);
      return;
    }
    throw new Error("studio: unknown worker message");
  } catch (err) {
    self.postMessage({ id, type: "error", message: err && err.message ? err.message : String(err) });
  }
};
