// Lazy-load U²-Netp and onnxruntime-web, run a 320×320 mask (then a tighter second pass on the
// item itself, so edges are inferred at a higher effective resolution), and hand
// the result to the studio pipeline. Nothing here runs until someone
// taps “Make it look pro.” There is no paid API.
//
// If the model or WASM cannot start (older phones, missing WebAssembly,
// a blocked CDN), we fall back to the basic clean-up with a kind message.

import {
  STUDIO_MODEL, STUDIO_PROGRESS_FIRST, STUDIO_PROGRESS_WORKING, STUDIO_FALLBACK_MSG,
  STUDIO_QUALITY, STUDIO_MAX_WORKING_EDGE, STUDIO_MAX_COMPOSITE_EDGE,
  prepareInputTensor, studioOrBasic,
  renderStudio, workingSize, upsampleMask, foregroundBounds, subjectPadBox,
  cropRGBA, pasteMask, resizeRGBA, subjectTiles,
  maskConvexHull, keepInsideHull, dilateMask,
  columnEnvelope, keepInsideEnvelope
} from "./studio.js";
import { cleanupDataUrl } from "./photo.js";

export const ORT_VERSION = "1.21.0";
export const ORT_WASM_BUNDLE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.bundle.min.mjs`;
export const ORT_WASM_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const STUDIO_CACHE = "flip-helper-studio-v1";
export const MODEL_URL = new URL("../../vendor/studio/u2netp.onnx", import.meta.url).href;

let worker = null;
let workerReady = null;
let mainSession = null;
let mainOrt = null;
let loadPromise = null;
let modelReady = false;

export function studioModelReady() {
  return modelReady;
}

export function resetStudioModel() {
  loadPromise = null;
  modelReady = false;
  mainSession = null;
  mainOrt = null;
  if (worker) {
    try { worker.terminate(); } catch (_) { /* already gone */ }
    worker = null;
    workerReady = null;
  }
}

function progress(onProgress, phase, message, extra) {
  onProgress?.({ phase, message, ...extra });
}

async function fetchModel(fetchImpl, onProgress) {
  const url = MODEL_URL;
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(STUDIO_CACHE);
      const hit = await cache.match(url);
      if (hit) {
        progress(onProgress, "load", STUDIO_PROGRESS_WORKING, { cached: true });
        return await hit.arrayBuffer();
      }
    }
  } catch (_) { /* private mode, etc. */ }

  progress(onProgress, "load", STUDIO_PROGRESS_FIRST, { cached: false });
  const f = fetchImpl || fetch;
  const res = await f(url, { cache: "force-cache" });
  if (!res.ok) throw new Error("studio: the studio model couldn't be downloaded");
  const total = Number(res.headers.get("content-length")) || STUDIO_MODEL.sizeBytes;
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      progress(onProgress, "load", STUDIO_PROGRESS_FIRST, { received, total, cached: false });
    }
    buf = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
    buf = buf.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(STUDIO_CACHE);
      await cache.put(url, new Response(buf.slice(0), {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "max-age=31536000" }
      }));
    }
  } catch (_) { /* ignore */ }
  return buf;
}

function startWorker() {
  if (typeof Worker === "undefined") return null;
  try {
    const url = new URL("./studio-worker.js", import.meta.url);
    return new Worker(url, { type: "module", name: "flip-studio" });
  } catch (_) {
    return null;
  }
}

function workerCall(w, payload, transfer, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const id = "s" + Math.random().toString(36).slice(2);
    const t = setTimeout(() => {
      w.removeEventListener("message", onMsg);
      reject(new Error("studio: the studio tools took too long"));
    }, timeoutMs);
    const onMsg = ev => {
      const msg = ev.data || {};
      if (msg.id !== id) return;
      clearTimeout(t);
      w.removeEventListener("message", onMsg);
      if (msg.type === "error") reject(new Error(msg.message || "studio: worker error"));
      else resolve(msg);
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ ...payload, id }, transfer || []);
  });
}

async function loadOnMain(modelBuffer, onProgress) {
  progress(onProgress, "load", STUDIO_PROGRESS_FIRST);
  const ort = await import(ORT_WASM_BUNDLE);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = ORT_WASM_PATHS;
  try { ort.env.logLevel = "error"; } catch (_) { /* older builds */ }
  const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all"
  });
  mainOrt = ort;
  mainSession = session;
  return { ort, session };
}

/**
 * Load the model (and the WASM runtime) once. Cached afterward.
 * Tries a Web Worker first, then the main thread.
 */
export async function loadStudioModel({ onProgress, fetchImpl } = {}) {
  if (modelReady && (worker || mainSession)) return { worker, session: mainSession, ort: mainOrt };
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (typeof WebAssembly === "undefined") {
      throw new Error("studio: WebAssembly is not available on this phone");
    }
    const modelBuffer = await fetchModel(fetchImpl, onProgress);
    // Try the worker. If it fails, we still have the buffer for the main thread.
    const w = startWorker();
    if (w) {
      try {
        // Transfer a copy so a failure can still use the original on the main thread.
        const copy = modelBuffer.slice(0);
        const ready = workerCall(w, { type: "load", modelBuffer: copy }, [copy], 90000);
        const msg = await ready;
        if (msg.type === "ready") {
          worker = w;
          workerReady = true;
          modelReady = true;
          return { worker, session: null, ort: null };
        }
      } catch (_) {
        try { w.terminate(); } catch (__) { /* ignore */ }
      }
    }
    const main = await loadOnMain(modelBuffer, onProgress);
    modelReady = true;
    return { worker: null, session: main.session, ort: main.ort };
  })();
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    modelReady = false;
    throw err;
  }
}

async function inferOnce(pixels, loaded) {
  const size = STUDIO_MODEL.inputSize;
  const tensor = prepareInputTensor(pixels.data, pixels.width, pixels.height, { size });
  if (loaded.worker) {
    // Copy: the worker transfers the buffer away.
    const copy = tensor.slice();
    const msg = await workerCall(loaded.worker, { type: "infer", tensor: copy, size }, [copy.buffer], 60000);
    return { mask: msg.mask, width: msg.width || size, height: msg.height || size };
  }
  const { session, ort } = loaded;
  if (!session || !ort) throw new Error("studio: model is not ready");
  const feeds = { [STUDIO_MODEL.inputName]: new ort.Tensor("float32", tensor, [1, 3, size, size]) };
  const out = await session.run(feeds);
  const pred = out[session.outputNames[0]];
  const mask = pred.data instanceof Float32Array ? pred.data : Float32Array.from(pred.data);
  return { mask, width: size, height: size };
}

/**
 * First pass on the whole photo, then a second pass on a tight crop of the
 * item. The second 320×320 covers just the subject, so edges are inferred
 * at a much higher effective resolution — without a heavier model.
 * Returns a full-size mask (already upsampled to the photo).
 */
function downscaleForInfer(pixels) {
  const work = workingSize(pixels.width, pixels.height, STUDIO_MAX_WORKING_EDGE);
  if (work.scale === 1) return { src: pixels, work };
  return {
    src: {
      data: resizeRGBA(pixels.data, pixels.width, pixels.height, work.width, work.height),
      width: work.width,
      height: work.height
    },
    work
  };
}

/**
 * Infer at a memory-safe working size, then (optionally) a tighter second
 * pass on the item. The returned mask is always upsampled to the incoming
 * photo size, so the composite can use the photo's own pixels.
 */
export async function inferMask(pixels, { onProgress, refineCrop = true } = {}) {
  const loaded = await loadStudioModel({ onProgress });
  const { src } = downscaleForInfer(pixels);
  const first = await inferOnce(src, loaded);
  const workMask = upsampleMask(first.mask, first.width, first.height, src.width, src.height);
  let resultMask = workMask;
  let passes = 1;
  let box = null;
  if (refineCrop) {
    const bounds = foregroundBounds(workMask, src.width, src.height, { threshold: 0.28 });
    if (bounds && bounds.w >= 8 && bounds.h >= 8) {
      const cropBox = subjectPadBox(bounds, src.width, src.height, 0.2, 24);
      const areaFrac = (cropBox.w * cropBox.h) / (src.width * src.height);
      if (areaFrac <= 0.82) {
        const crop = cropRGBA(src.data, src.width, src.height, cropBox);
        const second = await inferOnce(crop, loaded);
        const cropMask = upsampleMask(second.mask, second.width, second.height, crop.width, crop.height);
        resultMask = new Float32Array(src.width * src.height);
        pasteMask(resultMask, src.width, src.height, cropMask, crop.width, crop.height, cropBox.x, cropBox.y);
        passes = 2;
        box = cropBox;
      }
      const baseline = Float32Array.from(resultMask);
      // A wide implement (a rear blade, a bench) is still tiny in a single
      // 320 pass on the whole crop. Overlapping square tiles give each
      // piece a much higher effective resolution. Tiles use a tighter pad
      // than the second pass so each crop is mostly the item, not a sea
      // of grass — that's what lets the 320 model see a green side plate
      // against a green lawn. Results are merged with max() so a strong
      // tile can fill a part the coarser pass missed, without wiping a
      // part it got right. Compact (table-top) crops skip this and stay
      // on the single second pass.
      const tileBox = subjectPadBox(bounds, src.width, src.height, 0.06, 12);
      const tiles = subjectTiles(tileBox, src.width, src.height);
      for (const t of tiles) {
        if (t.w < 16 || t.h < 16) continue;
        const crop = cropRGBA(src.data, src.width, src.height, t);
        const tiled = await inferOnce(crop, loaded);
        const tileMask = upsampleMask(tiled.mask, tiled.width, tiled.height, crop.width, crop.height);
        resultMask = pasteMask(
          resultMask, src.width, src.height,
          tileMask, crop.width, crop.height,
          t.x, t.y, { mode: "max" }
        );
        passes += 1;
        box = box || cropBox;
      }
      if (tiles.length) {
        // Column-wise envelope of the coarser pass: a missing side plate
        // sits in a gap we interpolate across, but leaves under the
        // moldboard sit below the local bottom edge and are dropped.
        const env = columnEnvelope(baseline, src.width, src.height, { threshold: 0.35 });
        resultMask = keepInsideEnvelope(resultMask, src.width, src.height, env, baseline, { pad: 6 });
      }
    }
  }
  // Lift the working-size mask up to the photo's own resolution.
  const full = (src.width === pixels.width && src.height === pixels.height)
    ? resultMask
    : upsampleMask(resultMask, src.width, src.height, pixels.width, pixels.height);
  return { mask: full, width: pixels.width, height: pixels.height, passes, box };
}

function decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("studio: that photo couldn't be read"));
    img.src = dataUrl;
  });
}

/** Decode a data URL, capped to the working long edge for iPhone memory. */
export async function pixelsFromDataUrl(dataUrl, { maxEdge = STUDIO_MAX_COMPOSITE_EDGE } = {}) {
  const img = await decodeImage(dataUrl);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const work = workingSize(w0, h0, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = work.width;
  canvas.height = work.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, work.width, work.height);
  const imageData = ctx.getImageData(0, 0, work.width, work.height);
  try { canvas.width = 0; canvas.height = 0; } catch (_) { /* ignore */ }
  return { data: imageData.data, width: work.width, height: work.height };
}

export function pixelsToJpegDataUrl(pixels, { quality = STUDIO_QUALITY } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d");
  const data = pixels.data instanceof Uint8ClampedArray ? pixels.data : new Uint8ClampedArray(pixels.data);
  ctx.putImageData(new ImageData(data, pixels.width, pixels.height), 0, 0);
  const url = canvas.toDataURL("image/jpeg", quality);
  try { canvas.width = 0; canvas.height = 0; } catch (_) { /* ignore */ }
  return url;
}

export function renderStudioJpeg(source, options) {
  const result = renderStudio(source, options);
  return { ...result, dataUrl: pixelsToJpegDataUrl(result), ok: true, fallback: false, source };
}

/**
 * End-to-end: load the model if needed, infer a mask, composite, JPEG.
 * On any failure, fall back to the basic clean-up and a kind message.
 */
export async function makeStudioPhoto(dataUrl, options = {}, { onProgress } = {}) {
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const elapsed = () => ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
  try {
    const pixels = await pixelsFromDataUrl(dataUrl);
    progress(onProgress, "infer", STUDIO_PROGRESS_WORKING);
    const result = await studioOrBasic(pixels, options, {
      inferMask: src => inferMask(src, { onProgress }),
      cleanup: cleanupDataUrl,
      dataUrl,
      onProgress
    });
    if (result.fallback) return { ...result, elapsedMs: elapsed() };
    const dataUrlOut = pixelsToJpegDataUrl(result);
    return { ...result, dataUrl: dataUrlOut, elapsedMs: elapsed() };
  } catch (err) {
    progress(onProgress, "fallback", STUDIO_FALLBACK_MSG);
    let basic = null;
    try {
      basic = await cleanupDataUrl(dataUrl, {
        brighten: true,
        square: true,
        whiteBackground: options.background !== "original"
      });
    } catch (_) { /* ignore */ }
    return {
      ok: false,
      fallback: true,
      kind: "basic",
      dataUrl: basic,
      message: STUDIO_FALLBACK_MSG,
      error: err && err.message ? err.message : String(err),
      elapsedMs: elapsed()
    };
  }
}

export { STUDIO_FALLBACK_MSG };
