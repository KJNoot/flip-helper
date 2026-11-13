// Studio photo: on-phone background removal, a soft studio look, and
// marketplace framing. All of the pixel math is pure and unit-testable.
// The segmentation model lives in segment.js and is lazy-loaded only
// when someone taps “Make it look pro.”
//
// Honesty: this does not hide damage, and it does not blur or smooth
// the item itself. The original photo is always kept.

import { autoLevels, cleanupDataUrl, PHOTO_CLEANUP_NOTE } from "./photo.js";
import { chatJson, AI_MODEL } from "./draft.js";

export const STUDIO_LABEL = "studio";
export const STUDIO_NOTE = "A studio photo on this phone: the background comes off here, not through a paid service. It does not hide damage, and it does not blur or smooth the photo. Check that flaws are still visible.";
export const STUDIO_PROGRESS_FIRST = "Getting the studio ready… first time takes a moment";
export const STUDIO_PROGRESS_WORKING = "Making a studio photo…";
export const STUDIO_FALLBACK_MSG = "The studio tools couldn’t start on this phone, so we used the basic clean-up instead. Your original is still here.";
export const STUDIO_EDGES_NOTE = "Edges look off? Try again, or use the basic clean-up.";
export const STUDIO_RECOMMENDED = "Recommended";
export const STUDIO_BUTTON = "Make it look pro";
export const STUDIO_BASIC_LINK = "Use a basic clean-up instead";

export const STUDIO_MODEL = {
  id: "u2netp",
  name: "U²-Netp",
  license: "Apache-2.0",
  licenseUrl: "https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE",
  source: "https://github.com/xuebinqin/U-2-Net",
  weightsFrom: "https://github.com/danielgatis/rembg",
  sizeBytes: 4574861,
  sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
  inputSize: 320,
  inputName: "input.1",
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225]
};

export const BACKGROUNDS = {
  white: { id: "white", label: "Pure white", rgb: [255, 255, 255], note: "Marketplace standard" },
  gray: {
    id: "gray",
    label: "Soft gray",
    rgb: [244, 244, 246],
    rgbBottom: [226, 226, 230],
    note: "A soft studio look"
  },
  original: { id: "original", label: "Original", rgb: null, note: "Keep the original background" }
};

export const EXPORT_FRAMES = {
  square: { id: "square", label: "Square", ratio: "1:1", w: 1, h: 1, note: "Most sites, including eBay and Mercari" },
  portrait: { id: "portrait", label: "Tall", ratio: "4:5", w: 4, h: 5, note: "Poshmark and Depop-style feeds" }
};

export const STUDIO_MAX_WORKING_EDGE = 2048; // inference, to fit iPhone memory
export const STUDIO_MAX_COMPOSITE_EDGE = 4096; // final pixels: keep the photo's own resolution
export const STUDIO_EXPORT_EDGE = 2000;
export const STUDIO_PADDING = 0.10;
export const STUDIO_QUALITY = 0.92;
// Never enlarge the item past its own source pixels. If the crop is
// small, we pad the frame more instead of blowing the photo up.
export const STUDIO_MAX_SCALE = 1;
export const STUDIO_ERODE_PX = 1;
export const STUDIO_FEATHER_PX = 1.5;
export const STUDIO_CLOSE_PX = 2;
export const STUDIO_GUIDED_RADIUS = 4;
export const STUDIO_GUIDED_EPS = 0.0008;

export const COVER_CHECK_LABEL = "Cover photo check";
export const COVER_CHECK_NOTE = "An optional guess from the estimate model (gpt-4o-mini). It looks at your photos and suggests an order, and whether a missing angle (tag, sole, back, or label) would help. It is a suggestion, not a requirement.";
export const COVER_CHECK_SYSTEM = `You help a reseller pick listing photos.
Reply with JSON only: {"tip":"two or three short sentences","cover":1,"missing":""}
cover is the 1-based index of the best cover photo.
missing is one of "" (nothing needed), "tag", "sole", "back", "label", "flaw", or a short phrase for another useful angle.
Be honest. This is a suggestion, not a requirement. Do not invent damage you cannot see.`;

const MATTE_PRESETS = {
  default: { lo: 0.10, hi: 0.58 },
  tighter: { lo: 0.22, hi: 0.50 },
  softer: { lo: 0.04, hi: 0.85 }
};


/** Scale a pixel radius so it stays the same relative size at any working resolution. Tuned at 2048. */
export function scalePx(base, width, height, ref = STUDIO_MAX_WORKING_EDGE) {
  const long = Math.max(width, height);
  if (!base || base <= 0) return 0;
  return Math.max(1, Math.round(base * long / ref));
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function asRGBA(data, width, height) {
  const n = width * height;
  if (data.length === n * 4) {
    return data instanceof Uint8ClampedArray ? data : Uint8ClampedArray.from(data);
  }
  if (data.length === n * 3) {
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = data[i * 3];
      out[i * 4 + 1] = data[i * 3 + 1];
      out[i * 4 + 2] = data[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  throw new Error("studio: unexpected pixel length");
}

function asMask(mask, length) {
  if (mask.length !== length) throw new Error("studio: mask size must match the photo");
  return mask instanceof Float32Array ? mask : Float32Array.from(mask);
}

/** Destination pixel size for a marketplace frame. Long edge is `edge`. */
export function frameSize(aspect = "square", edge = STUDIO_EXPORT_EDGE) {
  const frame = EXPORT_FRAMES[aspect] || EXPORT_FRAMES.square;
  if (frame.w === frame.h) return { width: edge, height: edge, aspect: frame.id };
  // Portrait 4:5: tall side is the long edge.
  const height = edge;
  const width = Math.round(edge * (frame.w / frame.h));
  return { width, height, aspect: frame.id };
}

/** Cap a photo to a working long-edge so a 12MP shot fits in iPhone memory. */
export function workingSize(width, height, maxEdge = STUDIO_MAX_WORKING_EDGE) {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height, scale: 1 };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/**
 * ImageNet-normalized NCHW float tensor, size×size, ready for U²-Netp.
 * Input is RGBA or RGB, 0–255.
 */
export function prepareInputTensor(data, width, height, {
  size = STUDIO_MODEL.inputSize,
  mean = STUDIO_MODEL.mean,
  std = STUDIO_MODEL.std
} = {}) {
  const src = asRGBA(data, width, height);
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    const sy = (y + 0.5) * height / size - 0.5;
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5) * width / size - 0.5;
      const [r, g, b] = sampleRGB(src, width, height, sx, sy);
      const i = y * size + x;
      out[i] = (r / 255 - mean[0]) / std[0];
      out[plane + i] = (g / 255 - mean[1]) / std[1];
      out[2 * plane + i] = (b / 255 - mean[2]) / std[2];
    }
  }
  return out;
}

function sampleRGB(src, width, height, x, y) {
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x > width - 1) x = width - 1;
  if (y > height - 1) y = height - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  return [
    src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11,
    src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11,
    src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11
  ];
}

function sampleMask(src, width, height, x, y, { clampEdge = false } = {}) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
    if (!clampEdge) return 0;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x > width - 1) x = width - 1;
    if (y > height - 1) y = height - 1;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = src[y0 * width + x0];
  const v10 = src[y0 * width + x1];
  const v01 = src[y1 * width + x0];
  const v11 = src[y1 * width + x1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/** Bilinear upsample (or downsample) a float mask to a new size. */
export function upsampleMask(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src instanceof Float32Array ? src : Float32Array.from(src);
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * sh / dh - 0.5;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * sw / dw - 0.5;
      out[y * dw + x] = sampleMask(src, sw, sh, sx, sy, { clampEdge: true });
    }
  }
  return out;
}

/**
 * Fast guided filter: snap an upsampled matte to the photo's own edges.
 * Operates on the matte only — the photo's pixels are not smoothed.
 * He, et al., "Guided Image Filtering" (ECCV 2010).
 */
export function guidedRefine(mask, rgba, width, height, {
  radius = STUDIO_GUIDED_RADIUS,
  eps = STUDIO_GUIDED_EPS
} = {}) {
  // 3-channel (color) guided filter. Luma alone fails when the item and
  // the backdrop have similar brightness — green paint on grass, a cream
  // mug on wood that's close in lightness. Color covariance snaps to the
  // real edge. The photo itself is not smoothed.
  const n = width * height;
  const Ir = new Float32Array(n);
  const Ig = new Float32Array(n);
  const Ib = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    Ir[i] = rgba[o] / 255;
    Ig[i] = rgba[o + 1] / 255;
    Ib[i] = rgba[o + 2] / 255;
  }
  const r = Math.max(1, Math.round(radius));
  const meanR = boxBlur(Ir, width, height, r);
  const meanG = boxBlur(Ig, width, height, r);
  const meanB = boxBlur(Ib, width, height, r);
  const meanP = boxBlur(mask, width, height, r);
  const prod = (A, B) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = A[i] * B[i];
    return boxBlur(out, width, height, r);
  };
  const mRR = prod(Ir, Ir), mRG = prod(Ir, Ig), mRB = prod(Ir, Ib);
  const mGG = prod(Ig, Ig), mGB = prod(Ig, Ib), mBB = prod(Ib, Ib);
  const mRP = prod(Ir, mask), mGP = prod(Ig, mask), mBP = prod(Ib, mask);
  const ar = new Float32Array(n);
  const ag = new Float32Array(n);
  const ab = new Float32Array(n);
  const b0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const vrR = mRR[i] - meanR[i] * meanR[i] + eps;
    const vrG = mRG[i] - meanR[i] * meanG[i];
    const vrB = mRB[i] - meanR[i] * meanB[i];
    const vgG = mGG[i] - meanG[i] * meanG[i] + eps;
    const vgB = mGB[i] - meanG[i] * meanB[i];
    const vbB = mBB[i] - meanB[i] * meanB[i] + eps;
    const covR = mRP[i] - meanR[i] * meanP[i];
    const covG = mGP[i] - meanG[i] * meanP[i];
    const covB = mBP[i] - meanB[i] * meanP[i];
    // Inverse of the symmetric 3×3 covariance.
    const A = vgG * vbB - vgB * vgB;
    const B = vrB * vgB - vrG * vbB;
    const C = vrG * vgB - vrB * vgG;
    const D = vrR * vbB - vrB * vrB;
    const E = vrB * vrG - vrR * vgB;
    const F = vrR * vgG - vrG * vrG;
    const det = vrR * A + vrG * B + vrB * C;
    const inv = Math.abs(det) > 1e-12 ? 1 / det : 0;
    ar[i] = (A * covR + B * covG + C * covB) * inv;
    ag[i] = (B * covR + D * covG + E * covB) * inv;
    ab[i] = (C * covR + E * covG + F * covB) * inv;
    b0[i] = meanP[i] - ar[i] * meanR[i] - ag[i] * meanG[i] - ab[i] * meanB[i];
  }
  const meanAr = boxBlur(ar, width, height, r);
  const meanAg = boxBlur(ag, width, height, r);
  const meanAb = boxBlur(ab, width, height, r);
  const meanB0 = boxBlur(b0, width, height, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = meanAr[i] * Ir[i] + meanAg[i] * Ig[i] + meanAb[i] * Ib[i] + meanB0[i];
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    q[i] = v;
  }
  return q;
}

/** Square min-filter (separable). Shrinks the foreground to cut a thin fringe. */
export function erodeMask(mask, width, height, radius = STUDIO_ERODE_PX) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 1;
      for (let k = -r; k <= r; k++) {
        const v = mask[row + clamp(x + k, 0, width - 1)];
        if (v < m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 1;
      for (let k = -r; k <= r; k++) {
        const v = tmp[clamp(y + k, 0, height - 1) * width + x];
        if (v < m) m = v;
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Square max-filter (separable). The inverse of erodeMask. */
export function dilateMask(mask, width, height, radius = 1) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const v = mask[row + clamp(x + k, 0, width - 1)];
        if (v > m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const v = tmp[clamp(y + k, 0, height - 1) * width + x];
        if (v > m) m = v;
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Close small gaps (dilate, then erode) so thin metal stays in one piece. */
export function closeMask(mask, width, height, radius = STUDIO_CLOSE_PX) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  return erodeMask(dilateMask(mask, width, height, r), width, height, r);
}


/**
 * If the model leaves a piece of the item (a side plate, a handle) as a
 * separate blob a short gap away, join it back. Only bridges between
 * sizable components — it does not fill real holes inside one piece.
 */
export function reconnectComponents(mask, width, height, {
  threshold = 0.52,
  maxGap = 28,
  minArea = 400
} = {}) {
  const n = width * height;
  const labels = new Int32Array(n);
  const parent = [0];
  const find = (i) => {
    let a = i;
    while (parent[a] !== a) a = parent[a];
    let b = i;
    while (b !== a) { const n = parent[b]; parent[b] = a; b = n; }
    return a;
  };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  let next = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (mask[i] < threshold) continue;
      let lab = 0;
      if (x > 0 && labels[i - 1]) lab = labels[i - 1];
      if (y > 0 && labels[i - width]) {
        if (!lab) lab = labels[i - width];
        else unite(lab, labels[i - width]);
      }
      if (!lab) { lab = ++next; parent[lab] = lab; }
      labels[i] = lab;
    }
  }
  if (next < 2) return mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  const area = new Int32Array(next + 1);
  for (let i = 0; i < n; i++) {
    if (!labels[i]) continue;
    const r = find(labels[i]);
    labels[i] = r;
    area[r]++;
  }
  const big = [];
  for (let l = 1; l <= next; l++) {
    if (parent[l] === l && area[l] >= minArea) big.push(l);
  }
  if (big.length < 2) return mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);

  const R = Math.max(1, Math.round(maxGap));
  const out = mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  for (let a = 0; a < big.length; a++) {
    for (let b = a + 1; b < big.length; b++) {
      const la = big[a], lb = big[b];
      const A = new Float32Array(n);
      const B = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (labels[i] === la) A[i] = 1;
        else if (labels[i] === lb) B[i] = 1;
      }
      const dilA = dilateMask(A, width, height, R);
      const dilB = dilateMask(B, width, height, R);
      let overlap = false;
      for (let i = 0; i < n; i++) {
        if (dilA[i] > 0.5 && dilB[i] > 0.5) { overlap = true; break; }
      }
      if (!overlap) continue;
      const union = new Float32Array(n);
      for (let i = 0; i < n; i++) union[i] = A[i] || B[i] ? 1 : 0;
      const closed = closeMask(union, width, height, R);
      for (let i = 0; i < n; i++) {
        if (dilA[i] > 0.5 && dilB[i] > 0.5 && closed[i] > out[i]) out[i] = closed[i];
      }
    }
  }
  return out;
}

/** Soften the cut by 1–2 px so the edge isn't jagged. Matte only. */
export function featherMask(mask, width, height, radius = STUDIO_FEATHER_PX) {
  const r = Math.max(1, Math.round(radius));
  let out = boxBlur(mask, width, height, r);
  if (radius >= 1.25) out = boxBlur(out, width, height, Math.max(1, r - 1) || 1);
  for (let i = 0; i < out.length; i++) {
    if (out[i] < 0) out[i] = 0;
    else if (out[i] > 1) out[i] = 1;
  }
  return out;
}

/**
 * Replace fringe colors (a blend of the item and the old background)
 * with a color sampled a few pixels inward, so wood grain or grass
 * doesn't cling to the cutout. Interior pixels are left untouched.
 */
export function decontaminateEdges(rgba, mask, width, height, { lo = 0.04, hi = 0.92, step = 2.5 } = {}) {
  const out = new Uint8ClampedArray(rgba);
  const maxX = width - 1;
  const maxY = height - 1;
  for (let y = 1; y < maxY; y++) {
    const row = y * width;
    for (let x = 1; x < maxX; x++) {
      const a = mask[row + x];
      if (a <= lo || a >= hi) continue;
      const gx = mask[row + x + 1] - mask[row + x - 1];
      const gy = mask[row + width + x] - mask[row - width + x];
      const len = Math.hypot(gx, gy);
      if (len < 1e-5) continue;
      const sx = clamp(x + (gx / len) * step, 0, maxX);
      const sy = clamp(y + (gy / len) * step, 0, maxY);
      const [r, g, b] = sampleRGB(rgba, width, height, sx, sy);
      const o = (row + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

/**
 * Apply the full matte cleanup at the working resolution: color guided-filter
 * snap to photo edges, a light erode, contrast, a 1–2 px feather, and
 * edge-color decontamination. The photo's interior texture is not smoothed.
 */
export function refineMaskAtFullRes(mask, rgba, width, height, {
  matte = "default",
  guided = true,
  closePx = STUDIO_CLOSE_PX,
  erodePx = STUDIO_ERODE_PX,
  featherPx = STUDIO_FEATHER_PX,
  decontaminate = true,
  scaleRadii = true
} = {}) {
  let m = mask instanceof Float32Array ? mask : Float32Array.from(mask);
  let data = rgba;
  const px = (base) => (scaleRadii ? scalePx(base, width, height) : Math.max(0, Math.round(base)));
  const gRadius = px(STUDIO_GUIDED_RADIUS);
  if (guided) m = guidedRefine(m, data, width, height, { radius: gRadius });
  // Close first so a thin bar of metal that the 320 model almost
  // missed is joined back to the item, then a light erode to cut fringe.
  const c = px(closePx);
  const e = px(erodePx);
  const f = px(featherPx);
  if (c > 0) m = closeMask(m, width, height, c);
  m = reconnectComponents(m, width, height, {
    // A higher threshold treats a weak 1px neck as a break, so we can
    // build a solid bridge that a later erode will not sever.
    threshold: 0.52,
    maxGap: Math.max(c, px(48)),
    minArea: Math.max(200, Math.round(width * height * 0.0004))
  });
  if (e > 0) m = erodeMask(m, width, height, e);
  m = refineMatte(m, matte);
  if (f > 0) m = featherMask(m, width, height, f);
  if (decontaminate) data = decontaminateEdges(data, m, width, height, { step: Math.max(2, px(2.5)) });
  return { mask: m, data };
}

/** A padded crop around a subject box, clamped to the image. */
export function subjectPadBox(bounds, width, height, padFrac = 0.18, minPad = 16) {
  if (!bounds) return { x: 0, y: 0, w: width, h: height };
  const pad = Math.max(minPad, Math.round(Math.max(bounds.w, bounds.h) * padFrac));
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  const x1 = Math.min(width, bounds.x + bounds.w + pad);
  const y1 = Math.min(height, bounds.y + bounds.h + pad);
  return { x, y, w: x1 - x, h: y1 - y };
}

export function cropRGBA(data, width, height, box) {
  const { x, y, w, h } = box;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * width + x) * 4;
    out.set(data.subarray(src, src + w * 4), row * w * 4);
  }
  return { data: out, width: w, height: h, x, y };
}

export function pasteMask(dest, dw, dh, src, sw, sh, x, y, { mode = "replace" } = {}) {
  const out = dest instanceof Float32Array ? dest : Float32Array.from(dest);
  const useMax = mode === "max";
  for (let row = 0; row < sh; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= dh) continue;
    const destOff = dy * dw + x;
    const srcOff = row * sw;
    for (let col = 0; col < sw; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= dw) continue;
      const v = src[srcOff + col];
      out[destOff + col] = useMax ? Math.max(out[destOff + col], v) : v;
    }
  }
  return out;
}

/**
 * Split a wide or tall subject box into overlapping, roughly-square tiles
 * so a 320×320 model sees each piece at a higher effective resolution.
 * Returns [] when the box is already compact — a single 320 pass is enough.
 */
export function subjectTiles(box, width, height, {
  overlap = 0.30,
  maxAspect = 1.45,
  maxTiles = 4
} = {}) {
  if (!box) return [];
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.min(width - x, Math.round(box.w));
  const h = Math.min(height - y, Math.round(box.h));
  if (w < 16 || h < 16) return [];
  const wide = w >= h;
  const long = wide ? w : h;
  const short = wide ? h : w;
  if (short <= 0 || long / short <= maxAspect) return [];
  const stepFrac = 1 - Math.min(0.5, Math.max(0.15, overlap));
  const stepIdeal = Math.max(8, Math.round(short * stepFrac));
  let n = Math.ceil((long - short) / stepIdeal) + 1;
  n = Math.max(2, Math.min(maxTiles, n));
  const tileLong = Math.max(short, Math.ceil(long / (1 + stepFrac * (n - 1))));
  if (tileLong >= long) return [];
  const last = long - tileLong;
  const step = last / (n - 1);
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const off = (i === n - 1) ? last : Math.round(i * step);
    if (wide) {
      tiles.push({ x: x + off, y, w: Math.min(tileLong, width - (x + off)), h });
    } else {
      tiles.push({ x, y: y + off, w, h: Math.min(tileLong, height - (y + off)) });
    }
  }
  return tiles.length >= 2 ? tiles : [];
}

/** Andrew's monotone chain. Returns a CCW hull of {x,y} points. */
export function convexHull(points) {
  const pts = points
    .map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function pointInHull(x, y, hull) {
  const n = hull ? hull.length : 0;
  if (n === 0) return false;
  if (n === 1) return x === hull[0].x && y === hull[0].y;
  if (n === 2) {
    const a = hull[0], b = hull[1];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) > 1e-6) return false;
    const dot = (x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y);
    const len = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
    return dot >= 0 && dot <= len;
  }
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross < -1e-6) return false;
  }
  return true;
}

/** Leftmost and rightmost foreground pixel of each row, then the convex hull. */
export function maskConvexHull(mask, width, height, { threshold = 0.35 } = {}) {
  const pts = [];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] >= threshold) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) {
      pts.push({ x: left, y }, { x: right, y });
    }
  }
  return convexHull(pts);
}

/**
 * Where `mask` is stronger than `baseline`, keep the new value only if
 * the pixel sits inside the convex hull of the baseline. Fills a missing
 * side plate (that's in the bay between two already-found pieces) but
 * drops ground clutter a tile picked up under the item.
 */
export function keepInsideHull(mask, width, height, hull, baseline) {
  const out = mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  if (!hull || hull.length < 3) return out;
  const base = baseline || null;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const b = base ? base[i] : 0;
      if (out[i] > b && !pointInHull(x, y, hull)) out[i] = b;
    }
  }
  return out;
}

/**
 * For each column, the top and bottom of the baseline subject. Gaps
 * (a missing side plate between two pieces) are filled by interpolating
 * neighboring columns — tighter than a convex hull, which would also
 * include ground clutter under a blade whose ends sit lower than its middle.
 */
export function columnEnvelope(mask, width, height, { threshold = 0.35, minHeightFrac = 0.4 } = {}) {
  const lo = new Int32Array(width);
  const hi = new Int32Array(width);
  lo.fill(-1);
  hi.fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (mask[y * width + x] >= threshold) {
        if (hi[x] < 0) hi[x] = y;
        lo[x] = y;
      }
    }
  }
  // A thin top bar that spans a missing side plate should not define the
  // bottom of the envelope. Only "tall" columns (a real piece of the item)
  // do, and we interpolate across the short or empty ones.
  const heights = [];
  for (let x = 0; x < width; x++) {
    if (lo[x] >= 0) heights.push(lo[x] - hi[x] + 1);
  }
  heights.sort((a, b) => a - b);
  const median = heights.length ? heights[heights.length >> 1] : 0;
  const minTall = Math.max(8, Math.round(median * minHeightFrac));
  const tall = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    tall[x] = lo[x] >= 0 && (lo[x] - hi[x] + 1) >= minTall ? 1 : 0;
  }
  let prev = -1;
  for (let x = 0; x <= width; x++) {
    const isTall = x < width && tall[x];
    if (!isTall && x < width) continue;
    if (prev >= 0 && x - prev > 1) {
      const span = (x < width ? x : prev) - prev;
      const endLo = x < width ? lo[x] : lo[prev];
      const endHi = x < width ? hi[x] : hi[prev];
      for (let i = prev + 1; i < x && i < width; i++) {
        const t = (i - prev) / span;
        const iLo = Math.round(lo[prev] * (1 - t) + endLo * t);
        const iHi = Math.round(hi[prev] * (1 - t) + endHi * t);
        // If this column already had a short sliver, expand to the
        // interpolated full-item range (don't shrink a tall piece).
        if (!tall[i]) {
          lo[i] = iLo;
          hi[i] = iHi;
        }
      }
    }
    if (isTall) prev = x;
  }
  return { lo, hi };
}

export function keepInsideEnvelope(mask, width, height, env, baseline, { pad = 6 } = {}) {
  const out = mask instanceof Float32Array ? new Float32Array(mask) : Float32Array.from(mask);
  if (!env) return out;
  const { lo, hi } = env;
  const base = baseline || null;
  const p = Math.max(0, Math.round(pad));
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const b = base ? base[i] : 0;
      if (out[i] <= b) continue;
      if (lo[x] < 0 || y < hi[x] - p || y > lo[x] + p) out[i] = b;
    }
  }
  return out;
}

/**
 * Gentle contrast on the matte only (not the photo). Cleans noise at the
 * edges without shrinking the item. Presets: default, tighter, softer.
 */
export function refineMatte(mask, preset = "default") {
  const { lo, hi } = MATTE_PRESETS[preset] || MATTE_PRESETS.default;
  const span = hi - lo || 1;
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    let t = (mask[i] - lo) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

export function nextMattePreset(current) {
  if (current === "default") return "tighter";
  if (current === "tighter") return "softer";
  return "default";
}

/** Axis-aligned bounding box of pixels at or above the threshold. */
export function foregroundBounds(mask, width, height, { threshold = 0.2 } = {}) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] >= threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Place a subject box into a destination frame with even padding.
 * Returns the source-box → dest-box mapping.
 */
export function centerTransform(bounds, dstW, dstH, padding = STUDIO_PADDING, { maxScale = STUDIO_MAX_SCALE } = {}) {
  if (!bounds || bounds.w < 1 || bounds.h < 1) {
    return { scale: 1, srcX: 0, srcY: 0, srcW: dstW, srcH: dstH, dstX: 0, dstY: 0, dstW: dstW, dstH: dstH };
  }
  const pad = clamp(padding, 0, 0.4);
  const availW = dstW * (1 - 2 * pad);
  const availH = dstH * (1 - 2 * pad);
  let scale = Math.min(availW / bounds.w, availH / bounds.h);
  // Cap at 1.0 of the source pixels (or a caller-supplied max). A small
  // item is padded, never enlarged into a soft, blurry blow-up.
  if (Number.isFinite(maxScale) && scale > maxScale) scale = maxScale;
  if (scale < 0) scale = 0;
  const dw = bounds.w * scale;
  const dh = bounds.h * scale;
  return {
    scale,
    srcX: bounds.x,
    srcY: bounds.y,
    srcW: bounds.w,
    srcH: bounds.h,
    dstX: (dstW - dw) / 2,
    dstY: (dstH - dh) / 2,
    dstW: dw,
    dstH: dh
  };
}

/** Horizontal then vertical sliding-window box blur (clamp-to-edge). */
export function boxBlur(src, width, height, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return src instanceof Float32Array ? new Float32Array(src) : Float32Array.from(src);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = r * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clamp(k, 0, width - 1)];
    tmp[row] = sum / w;
    for (let x = 1; x < width; x++) {
      sum += src[row + clamp(x + r, 0, width - 1)] - src[row + clamp(x - r - 1, 0, width - 1)];
      tmp[row + x] = sum / w;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, height - 1) * width + x];
    out[x] = sum / w;
    for (let y = 1; y < height; y++) {
      sum += tmp[clamp(y + r, 0, height - 1) * width + x] - tmp[clamp(y - r - 1, 0, height - 1) * width + x];
      out[y * width + x] = sum / w;
    }
  }
  return out;
}

/** Three box-blur passes, a cheap Gaussian stand-in. */
export function softBlur(src, width, height, radius) {
  let cur = src;
  const r = Math.max(1, Math.round(radius));
  for (let i = 0; i < 3; i++) cur = boxBlur(cur, width, height, r);
  return cur;
}

/**
 * A soft natural drop shadow from the matte: slightly down, blurred,
 * lower opacity, under the item. y increases downward.
 */
export function shadowFromMask(mask, width, height, {
  offsetX = 0,
  offsetY,
  radius,
  opacity = 0.28
} = {}) {
  const oy = offsetY == null ? Math.max(4, Math.round(height * 0.025)) : offsetY;
  const ox = offsetX == null ? 0 : offsetX;
  const rad = radius == null ? Math.max(6, Math.round(Math.min(width, height) * 0.035)) : radius;
  const blurred = softBlur(mask, width, height, rad);
  const out = new Float32Array(width * height);
  const a = clamp(opacity, 0, 1);
  for (let y = 0; y < height; y++) {
    const sy = y - oy;
    for (let x = 0; x < width; x++) {
      const sx = x - ox;
      if (sy < 0 || sx < 0 || sy >= height || sx >= width) continue;
      out[y * width + x] = blurred[sy * width + sx] * a;
    }
  }
  return out;
}

/**
 * Principal-axis angle (degrees, 0 = horizontal, clockwise with y-down)
 * and elongation (λ1/λ2) of the matte. Elongation is ~1 for a circle
 * and large for a tall thin object. Returns { angle, elongation }.
 */
export function tiltInfo(mask, width, height, { threshold = 0.25 } = {}) {
  let m00 = 0, m10 = 0, m01 = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const v = mask[i];
    if (v < threshold) continue;
    const x = i % width;
    const y = (i - x) / width;
    m00 += v;
    m10 += x * v;
    m01 += y * v;
  }
  if (m00 < 1e-6) return { angle: 0, elongation: 1 };
  const cx = m10 / m00;
  const cy = m01 / m00;
  let mu20 = 0, mu02 = 0, mu11 = 0;
  for (let i = 0; i < n; i++) {
    const v = mask[i];
    if (v < threshold) continue;
    const x = i % width;
    const y = (i - x) / width;
    const dx = x - cx;
    const dy = y - cy;
    mu20 += dx * dx * v;
    mu02 += dy * dy * v;
    mu11 += dx * dy * v;
  }
  const angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02) * (180 / Math.PI);
  const hyp = Math.sqrt(((mu20 - mu02) / 2) ** 2 + mu11 * mu11);
  const l1 = (mu20 + mu02) / 2 + hyp;
  const l2 = (mu20 + mu02) / 2 - hyp;
  const elongation = l1 / Math.max(l2, 1e-6);
  return { angle, elongation };
}

export function principalAxisAngle(mask, width, height, opts) {
  return tiltInfo(mask, width, height, opts).angle;
}

/**
 * Only straighten a small photo tilt. Returns the rotation to apply,
 * or 0 if the tilt is tiny, large, or already aligned to an axis.
 */
export function gentleStraightenDegrees(angleDeg, { min = 1.5, max = 12, elongation = Infinity } = {}) {
  // A mug with a handle is not a tall thin object: its principal axis is
  // pulled off-vertical by the handle, and rotating it would make it worse.
  // Default elongation (Infinity) means "caller didn't measure it — use the angle."
  if (elongation < 1.8) return 0;
  if (!Number.isFinite(angleDeg)) return 0;
  // Wrap to [-90, 90), then to the nearest axis (0 or ±90).
  let d = angleDeg % 180;
  if (d > 90) d -= 180;
  if (d < -90) d += 180;
  const nearest = Math.round(d / 90) * 90;
  const delta = d - nearest;
  if (Math.abs(delta) < min || Math.abs(delta) > max) return 0;
  return -delta;
}

/** Rotate RGBA + mask around the center; canvas grows to fit. Fill is transparent. */
export function rotateImageAndMask(data, mask, width, height, degrees) {
  if (!degrees) {
    return {
      data: asRGBA(data, width, height),
      mask: asMask(mask, width * height),
      width,
      height
    };
  }
  const src = asRGBA(data, width, height);
  const rad = degrees * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const nw = Math.max(1, Math.ceil(Math.abs(width * c) + Math.abs(height * s)));
  const nh = Math.max(1, Math.ceil(Math.abs(width * s) + Math.abs(height * c)));
  const out = new Uint8ClampedArray(nw * nh * 4);
  const outM = new Float32Array(nw * nh);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const ncx = (nw - 1) / 2;
  const ncy = (nh - 1) / 2;
  // Inverse rotation: dest → source.
  const ic = c;
  const is_ = -s; // wait: dest rotated by +deg means source is sampled at -deg
  // Rotation of the image by `degrees` clockwise (y-down):
  // dest = R * (src - c) + nc, so src = R^{-1} * (dest - nc) + c
  // R_cw = [[c, -s], [s, c]] with y-down? Standard math CCW with y-up.
  // With y-down, a positive clockwise angle:
  // x' =  c*x + s*y
  // y' = -s*x + c*y   ... let's use standard:
  // We defined principalAxisAngle with atan2(2*mu11, mu20-mu02) which is the
  // standard image-axis angle (clockwise with y-down if we use this form).
  // Inverse of clockwise rotation by θ: clockwise by -θ:
  // x =  c*x' + s*y'
  // y = -s*x' + c*y'   for standard CCW... I'll use:
  // x_src =  cosθ * x_d + sinθ * y_d   where θ is the inverse.
  const icos = Math.cos(-rad);
  const isin = Math.sin(-rad);
  for (let y = 0; y < nh; y++) {
    const dy = y - ncy;
    for (let x = 0; x < nw; x++) {
      const dx = x - ncx;
      const sx = icos * dx - isin * dy + cx;
      const sy = isin * dx + icos * dy + cy;
      if (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5) continue;
      const [r, g, b] = sampleRGB(src, width, height, sx, sy);
      const a = sampleMask(mask, width, height, sx, sy);
      const o = (y * nw + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
      outM[y * nw + x] = a;
    }
  }
  return { data: out, mask: outM, width: nw, height: nh };
}

/**
 * Gentle white balance from the background, not the item. A cream mug
 * must stay cream: we only correct a lighting cast visible in bright
 * backdrop pixels (what should be close to white). Colorful backdrops
 * and photos with no useful background are left alone. Scales are
 * clamped so a stain or a real color is never pulled away.
 */
export function grayWorldBalance(data, width, height, mask, { minScale = 0.92, maxScale = 1.08, threshold = 0.2 } = {}) {
  const src = asRGBA(data, width, height);
  const n = width * height;
  const samples = [];
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] >= threshold) continue;
    const o = i * 4;
    const r = src[o], g = src[o + 1], b = src[o + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 80) continue;
    samples.push([lum, r, g, b]);
  }
  const out = new Uint8ClampedArray(src);
  if (samples.length < 16) return out;
  samples.sort((a, b) => a[0] - b[0]);
  const start = Math.floor(samples.length * 0.5);
  let rSum = 0, gSum = 0, bSum = 0, w = 0;
  for (let i = start; i < samples.length; i++) {
    rSum += samples[i][1];
    gSum += samples[i][2];
    bSum += samples[i][3];
    w += 1;
  }
  const rM = rSum / w, gM = gSum / w, bM = bSum / w;
  const mx = Math.max(rM, gM, bM);
  const mn = Math.min(rM, gM, bM);
  // A saturated colored backdrop is not a lighting cast — leave the item alone.
  if (mx > 0 && (mx - mn) / mx > 0.35) return out;
  const gray = (rM + gM + bM) / 3;
  const rs = clamp(gray / (rM || 1), minScale, maxScale);
  const gs = clamp(gray / (gM || 1), minScale, maxScale);
  const bs = clamp(gray / (bM || 1), minScale, maxScale);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = src[o] * rs;
    out[o + 1] = src[o + 1] * gs;
    out[o + 2] = src[o + 2] * bs;
  }
  return out;
}

/** Mild auto-levels measured on the foreground (alpha taken from the matte). */
export function gentleAutoLight(data, width, height, mask) {
  const src = asRGBA(data, width, height);
  const measured = new Uint8ClampedArray(src);
  if (mask) {
    const n = width * height;
    for (let i = 0; i < n; i++) measured[i * 4 + 3] = clamp(Math.round(mask[i] * 255), 0, 255);
  }
  return autoLevels(measured, width, height, { lowP: 0.02, highP: 0.99, contrast: 1.05 });
}

/** Fill an opaque RGB(A) canvas with a solid color or a soft vertical gradient. */
export function fillBackground(out, width, height, background = "white") {
  const bg = typeof background === "string" ? BACKGROUNDS[background] || BACKGROUNDS.white : background;
  const top = bg.rgb || [255, 255, 255];
  const bot = bg.rgbBottom || top;
  const same = top[0] === bot[0] && top[1] === bot[1] && top[2] === bot[2];
  const n = width * height;
  if (same) {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out[o] = top[0];
      out[o + 1] = top[1];
      out[o + 2] = top[2];
      out[o + 3] = 255;
    }
    return out;
  }
  for (let y = 0; y < height; y++) {
    const t = height <= 1 ? 0 : y / (height - 1);
    const r = top[0] + (bot[0] - top[0]) * t;
    const g = top[1] + (bot[1] - top[1]) * t;
    const b = top[2] + (bot[2] - top[2]) * t;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const o = (row + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Paint a dark soft shadow under the item. Assumes `out` already has a background. */
export function applyShadow(out, shadow, width, height, color = [36, 36, 38]) {
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const a = shadow[i];
    if (a <= 0) continue;
    const o = i * 4;
    const ia = 1 - a;
    out[o] = out[o] * ia + color[0] * a;
    out[o + 1] = out[o + 1] * ia + color[1] * a;
    out[o + 2] = out[o + 2] * ia + color[2] * a;
  }
  return out;
}

/** Porter-Duff over: foreground RGB weighted by the matte, onto `out`. */
export function compositeForeground(out, rgba, mask, width, height) {
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const a = mask[i];
    if (a <= 0) continue;
    const o = i * 4;
    const ia = 1 - a;
    out[o] = out[o] * ia + rgba[o] * a;
    out[o + 1] = out[o + 1] * ia + rgba[o + 1] * a;
    out[o + 2] = out[o + 2] * ia + rgba[o + 2] * a;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Resample an RGBA image and a float mask into a destination frame using
 * a centerTransform. Outside-source pixels for "original" background use
 * the nearest edge color; for a studio background they stay empty (mask 0).
 */
export function resampleToFrame(rgba, mask, srcW, srcH, transform, dstW, dstH, { keepOriginal = false } = {}) {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const outM = new Float32Array(dstW * dstH);
  const { srcX, srcY, dstX, dstY, scale } = transform;
  const inv = scale ? 1 / scale : 1;
  for (let y = 0; y < dstH; y++) {
    const sy = srcY + (y + 0.5 - dstY) * inv - 0.5;
    for (let x = 0; x < dstW; x++) {
      const sx = srcX + (x + 0.5 - dstX) * inv - 0.5;
      const o = (y * dstW + x) * 4;
      if (sx < 0 || sy < 0 || sx > srcW - 1 || sy > srcH - 1) {
        if (keepOriginal) {
          const cx = clamp(sx, 0, srcW - 1);
          const cy = clamp(sy, 0, srcH - 1);
          const [r, g, b] = sampleRGB(rgba, srcW, srcH, cx, cy);
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
          out[o + 3] = 255;
          outM[y * dstW + x] = 0;
        }
        continue;
      }
      const [r, g, b] = sampleRGB(rgba, srcW, srcH, sx, sy);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
      outM[y * dstW + x] = sampleMask(mask, srcW, srcH, sx, sy);
    }
  }
  return { data: out, mask: outM, width: dstW, height: dstH };
}

/**
 * Full studio pipeline from pixels + a same-size (or already-upsampled) mask.
 * Does not call the model. Returns opaque RGBA pixels in the chosen frame.
 */
export function renderStudio(src, {
  background = "white",
  shadow = true,
  straighten = true,
  center = true,
  aspect = "square",
  edge = STUDIO_EXPORT_EDGE,
  padding = STUDIO_PADDING,
  matte = "default",
  maxScale = STUDIO_MAX_SCALE,
  refine = true,
  erodePx = STUDIO_ERODE_PX,
  featherPx = STUDIO_FEATHER_PX,
  decontaminate = true
} = {}) {
  let width = src.width;
  let height = src.height;
  let data = asRGBA(src.data, width, height);
  let mask = asMask(src.mask, width * height);

  // Cap only extremely large photos. Do not shrink a 12MP or 9MP shot
  // down to 2048 before framing — that throws away source pixels and
  // leaves a small item sitting in a sea of padding.
  const work = workingSize(width, height, STUDIO_MAX_COMPOSITE_EDGE);
  if (work.scale !== 1) {
    data = resizeRGBA(data, width, height, work.width, work.height);
    mask = upsampleMask(mask, width, height, work.width, work.height);
    width = work.width;
    height = work.height;
  }

  // Refine the matte at the inference working size (fast, same relative
  // radii), then bring it back to the photo's own pixels. Decontaminate
  // at full resolution so edge colors come from the original photo.
  if (refine) {
    const infer = workingSize(width, height, STUDIO_MAX_WORKING_EDGE);
    let m = mask, d = data, rw = width, rh = height;
    if (infer.scale !== 1) {
      d = resizeRGBA(data, width, height, infer.width, infer.height);
      m = upsampleMask(mask, width, height, infer.width, infer.height);
      rw = infer.width;
      rh = infer.height;
    }
    const cleaned = refineMaskAtFullRes(m, d, rw, rh, {
      matte, erodePx, featherPx, decontaminate: false
    });
    mask = (rw === width && rh === height)
      ? cleaned.mask
      : upsampleMask(cleaned.mask, rw, rh, width, height);
    if (decontaminate) {
      data = decontaminateEdges(data, mask, width, height, {
        step: Math.max(2, scalePx(2.5, width, height))
      });
    }
  } else {
    mask = refineMatte(mask, matte);
  }

  data = grayWorldBalance(data, width, height, mask);
  data = gentleAutoLight(data, width, height, mask);

  let straightenDeg = 0;
  if (straighten) {
    const tilt = tiltInfo(mask, width, height);
    straightenDeg = gentleStraightenDegrees(tilt.angle, { elongation: tilt.elongation });
    if (straightenDeg) {
      const rot = rotateImageAndMask(data, mask, width, height, straightenDeg);
      data = rot.data;
      mask = rot.mask;
      width = rot.width;
      height = rot.height;
    }
  }

  const keepOriginal = background === "original";
  const frame = frameSize(aspect, edge);
  let framed;
  if (center) {
    const bounds = foregroundBounds(mask, width, height);
    if (!bounds) {
      const err = new Error("studio: no item found in the photo");
      err.code = "no-subject";
      throw err;
    }
    const xf = centerTransform(bounds, frame.width, frame.height, padding, { maxScale });
    framed = resampleToFrame(data, mask, width, height, xf, frame.width, frame.height, { keepOriginal });
  } else {
    const xf = centerTransform({ x: 0, y: 0, w: width, h: height }, frame.width, frame.height, 0, { maxScale });
    framed = resampleToFrame(data, mask, width, height, xf, frame.width, frame.height, { keepOriginal });
  }
  data = framed.data;
  mask = framed.mask;
  width = framed.width;
  height = framed.height;

  const out = new Uint8ClampedArray(width * height * 4);
  if (keepOriginal) {
    out.set(data);
    // Make sure fully opaque.
    for (let i = 0; i < width * height; i++) out[i * 4 + 3] = 255;
  } else {
    fillBackground(out, width, height, background);
    const wantShadow = shadow !== false;
    if (wantShadow) {
      const opac = background === "gray" ? 0.22 : 0.28;
      const sub = foregroundBounds(mask, width, height, { threshold: 0.25 });
      const itemEdge = sub ? Math.max(sub.w, sub.h) : Math.min(width, height);
      applyShadow(out, shadowFromMask(mask, width, height, {
        opacity: opac,
        offsetY: Math.max(3, Math.round(itemEdge * 0.03)),
        radius: Math.max(5, Math.round(itemEdge * 0.045))
      }), width, height);
    }
    compositeForeground(out, data, mask, width, height);
  }

  return {
    data: out,
    width,
    height,
    kind: STUDIO_LABEL,
    background: keepOriginal ? "original" : (BACKGROUNDS[background] ? background : "white"),
    aspect: frame.aspect,
    usedShadow: !keepOriginal && shadow !== false,
    usedStraighten: !!straightenDeg,
    straightenDeg,
    matte
  };
}

export function resizeRGBA(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * sh / dh - 0.5;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * sw / dw - 0.5;
      const [r, g, b] = sampleRGB(src, sw, sh, sx, sy);
      const o = (y * dw + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Run the studio pipeline with an injectable inferMask. If inference or
 * compositing fails, fall back to the basic clean-up and a kind message.
 *
 * inferMask(pixels) → Float32Array mask of the same size, or { mask, width, height }
 *   if it returns the native 320×320 map (we upsample).
 */
export async function studioOrBasic(pixels, options = {}, {
  inferMask,
  cleanup = cleanupDataUrl,
  dataUrl,
  onProgress
} = {}) {
  try {
    if (typeof inferMask !== "function") throw new Error("studio: no model");
    onProgress?.({ phase: "infer", message: STUDIO_PROGRESS_WORKING });
    const src = {
      data: pixels.data,
      width: pixels.width,
      height: pixels.height
    };
    let raw = await inferMask(src);
    let mask, mw, mh;
    if (raw && raw.mask) {
      mask = raw.mask;
      mw = raw.width;
      mh = raw.height;
    } else {
      mask = raw;
      mw = pixels.width;
      mh = pixels.height;
    }
    if (!mask || !mask.length) throw new Error("studio: empty mask");
    if (mw !== pixels.width || mh !== pixels.height) {
      mask = upsampleMask(mask, mw, mh, pixels.width, pixels.height);
    }
    const result = renderStudio({ ...src, mask }, options);
    return {
      ok: true,
      fallback: false,
      source: { data: src.data, width: src.width, height: src.height, mask },
      ...result
    };
  } catch (err) {
    onProgress?.({ phase: "fallback", message: STUDIO_FALLBACK_MSG });
    let basic = null;
    if (typeof cleanup === "function" && dataUrl) {
      try {
        const white = options.background !== "original";
        basic = await cleanup(dataUrl, { brighten: true, square: true, whiteBackground: white });
      } catch (_) { /* ignore cleanup failure */ }
    }
    return {
      ok: false,
      fallback: true,
      kind: "basic",
      message: STUDIO_FALLBACK_MSG,
      dataUrl: basic,
      error: err && err.message ? err.message : String(err),
      code: err && err.code
    };
  }
}

export function normalizeCoverCheck(raw = {}) {
  const tip = String(raw.tip || raw.note || raw.message || "").trim();
  let cover = Number(raw.cover);
  if (!Number.isFinite(cover) || cover < 1) cover = 1;
  cover = Math.round(cover);
  const missing = String(raw.missing || "").trim();
  return { tip, cover, missing, model: AI_MODEL };
}

/** Optional, cheap, labeled cover-photo suggestion. */
export async function requestCoverCheck({ photos = [], key, fetchImpl, chat } = {}) {
  const fn = chat || chatJson;
  const urls = photos.map(p => typeof p === "string" ? p : (p && p.dataUrl)).filter(Boolean);
  if (!urls.length) {
    return { tip: "Add a photo first.", cover: 1, missing: "", model: AI_MODEL };
  }
  const raw = await fn({
    system: COVER_CHECK_SYSTEM,
    userText: `Here are ${urls.length} listing photo${urls.length === 1 ? "" : "s"}, in their current order (photo 1 is first). Give one short tip.`,
    photos: urls,
    key,
    fetchImpl,
    model: AI_MODEL,
    maxTokens: 180,
    temperature: 0.3,
    imageDetail: "low"
  });
  return normalizeCoverCheck(raw || {});
}

export { PHOTO_CLEANUP_NOTE };
