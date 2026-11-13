// Basic in-browser photo clean-up: auto brighten and contrast, crop to square,
// and a simple plain-background whitener. All of this runs on the phone.
// Labeled "basic" — it is not a studio cut-out.
//
// Pure pixel helpers take { data, width, height } where data is an RGBA
// Uint8ClampedArray or a plain array, so they can be unit-tested in Node.

export const PHOTO_CLEANUP_LABEL = "basic";
export const PHOTO_CLEANUP_NOTE = "A basic clean-up on this phone: brighter, a bit more contrast, cropped square, and an optional plain background. It does not hide damage, and it does not blur or smooth the photo. Check that flaws are still visible. It is not a studio cut-out.";

function asBytes(data) {
  return data instanceof Uint8ClampedArray ? data : Uint8ClampedArray.from(data);
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Percentile luminance of opaque-ish pixels, 0–255. */
export function luminancePercentile(data, width, height, p) {
  const bytes = asBytes(data);
  const vals = [];
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (bytes[o + 3] < 16) continue;
    vals.push(luminance(bytes[o], bytes[o + 1], bytes[o + 2]));
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  const idx = Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))));
  return vals[idx];
}

/**
 * Stretch levels between the low and high luminance percentiles and
 * apply a mild contrast bump. Returns a new Uint8ClampedArray.
 */
export function autoLevels(data, width, height, { lowP = 0.01, highP = 0.99, contrast = 1.08 } = {}) {
  const src = asBytes(data);
  const out = new Uint8ClampedArray(src);
  const lo = luminancePercentile(src, width, height, lowP);
  const hi = luminancePercentile(src, width, height, highP);
  const span = hi - lo;
  const n = width * height;
  // Uniform or nearly uniform: don't stretch a tiny range to black/white.
  // If the photo is dark, lift it toward a mid brightness. If it's already
  // light, leave it (a mild contrast bump only).
  const uniform = span < 16;
  const lift = uniform && lo < 90 ? (130 - lo) : 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      let v = src[o + c];
      if (uniform) {
        v = v + lift;
        v = (v - 128) * Math.min(contrast, 1.04) + 128;
      } else {
        v = ((v - lo) / span) * 255;
        v = (v - 128) * contrast + 128;
      }
      out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    out[o + 3] = src[o + 3];
  }
  return out;
}

/** Center-square crop bounds. */
export function cropSquareBounds(width, height) {
  const side = Math.max(1, Math.min(width, height));
  const x = Math.floor((width - side) / 2);
  const y = Math.floor((height - side) / 2);
  return { x, y, side };
}

/** Crop RGBA data to a centered square. */
export function cropToSquare(data, width, height) {
  const { x, y, side } = cropSquareBounds(width, height);
  const src = asBytes(data);
  const out = new Uint8ClampedArray(side * side * 4);
  for (let row = 0; row < side; row++) {
    const srcOff = ((y + row) * width + x) * 4;
    const dstOff = row * side * 4;
    out.set(src.subarray(srcOff, srcOff + side * 4), dstOff);
  }
  return { data: out, width: side, height: side, x, y, side };
}

function avgColor(bytes, width, height, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(width, Math.ceil(x1));
  const yb = Math.min(height, Math.ceil(y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const o = (y * width + x) * 4;
      if (bytes[o + 3] < 16) continue;
      r += bytes[o]; g += bytes[o + 1]; b += bytes[o + 2]; n++;
    }
  }
  if (!n) return { r: 240, g: 240, b: 240, n: 0 };
  return { r: r / n, g: g / n, b: b / n, n };
}

/**
 * Simple background whitener. Samples the corners and edges. If they look
 * similar and reasonably light, pixels close to that color (especially near
 * the edges) are blended toward white. The center is mostly left alone.
 * This is basic: a busy or dark background will barely change.
 */
export function whitenBackground(data, width, height, { threshold = 42, minLum = 140 } = {}) {
  const src = asBytes(data);
  const out = new Uint8ClampedArray(src);
  const strip = Math.max(1, Math.round(Math.min(width, height) * 0.08));
  const samples = [
    avgColor(src, width, height, 0, 0, strip, strip),
    avgColor(src, width, height, width - strip, 0, width, strip),
    avgColor(src, width, height, 0, height - strip, strip, height),
    avgColor(src, width, height, width - strip, height - strip, width, height),
    avgColor(src, width, height, 0, 0, width, strip),
    avgColor(src, width, height, 0, height - strip, width, height)
  ];
  const usable = samples.filter(s => s.n > 0);
  if (!usable.length) return out;
  const bg = {
    r: usable.reduce((a, s) => a + s.r, 0) / usable.length,
    g: usable.reduce((a, s) => a + s.g, 0) / usable.length,
    b: usable.reduce((a, s) => a + s.b, 0) / usable.length
  };
  const bgLum = luminance(bg.r, bg.g, bg.b);
  if (bgLum < minLum) return out; // dark background — don't pretend we can cut it out
  // Corners should agree; if they don't, the background is busy.
  let spread = 0;
  for (const s of usable) {
    spread = Math.max(spread, Math.abs(s.r - bg.r) + Math.abs(s.g - bg.g) + Math.abs(s.b - bg.b));
  }
  if (spread > threshold * 2.2) return out;

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy) || 1;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const o = i * 4;
    const dr = src[o] - bg.r;
    const dg = src[o + 1] - bg.g;
    const db = src[o + 2] - bg.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist > threshold) continue;
    const edge = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxD;
    // Stronger near the edges, weaker in the middle. Closer colors go further toward white.
    const closeness = 1 - dist / threshold;
    const strength = closeness * (0.35 + 0.65 * edge);
    if (strength <= 0) continue;
    out[o] = src[o] + (255 - src[o]) * strength;
    out[o + 1] = src[o + 1] + (255 - src[o + 1]) * strength;
    out[o + 2] = src[o + 2] + (255 - src[o + 2]) * strength;
  }
  return out;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That photo couldn't be read."));
    img.src = dataUrl;
  });
}

function canvasFromImage(img) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, img.naturalWidth || img.width);
  c.height = Math.max(1, img.naturalHeight || img.height);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return { canvas: c, ctx };
}

function put(ctx, data, w, h) {
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
}

/**
 * Clean up a data-URL photo in the browser. Options default to all on
 * except the plain background, which is opt-in.
 */
export async function cleanupDataUrl(dataUrl, { brighten = true, square = true, whiteBackground = false, quality = 0.86 } = {}) {
  if (!dataUrl) throw new Error("Take a photo first.");
  const img = await loadImage(dataUrl);
  let { canvas, ctx } = canvasFromImage(img);
  let data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let w = canvas.width, h = canvas.height;
  if (square && w !== h) {
    const cropped = cropToSquare(data, w, h);
    const c = document.createElement("canvas");
    c.width = cropped.width; c.height = cropped.height;
    const cctx = c.getContext("2d", { willReadFrequently: true });
    put(cctx, cropped.data, cropped.width, cropped.height);
    canvas = c; ctx = cctx; data = cropped.data; w = cropped.width; h = cropped.height;
  }
  if (brighten) {
    data = autoLevels(data, w, h);
    put(ctx, data, w, h);
  }
  if (whiteBackground) {
    data = whitenBackground(data, w, h);
    put(ctx, data, w, h);
  }
  return canvas.toDataURL("image/jpeg", quality);
}

export { luminance };
