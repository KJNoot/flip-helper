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

export const STUDIO_MAX_WORKING_EDGE = 2048;
export const STUDIO_EXPORT_EDGE = 2000;
export const STUDIO_PADDING = 0.10;
export const STUDIO_QUALITY = 0.92;

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
export function centerTransform(bounds, dstW, dstH, padding = STUDIO_PADDING) {
  if (!bounds || bounds.w < 1 || bounds.h < 1) {
    return { scale: 1, srcX: 0, srcY: 0, srcW: dstW, srcH: dstH, dstX: 0, dstY: 0, dstW: dstW, dstH: dstH };
  }
  const pad = clamp(padding, 0, 0.4);
  const availW = dstW * (1 - 2 * pad);
  const availH = dstH * (1 - 2 * pad);
  const scale = Math.min(availW / bounds.w, availH / bounds.h);
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
  matte = "default"
} = {}) {
  let width = src.width;
  let height = src.height;
  let data = asRGBA(src.data, width, height);
  let mask = asMask(src.mask, width * height);
  mask = refineMatte(mask, matte);

  const work = workingSize(width, height);
  if (work.scale !== 1) {
    data = resizeRGBA(data, width, height, work.width, work.height);
    mask = upsampleMask(mask, width, height, work.width, work.height);
    width = work.width;
    height = work.height;
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
    const xf = centerTransform(bounds, frame.width, frame.height, padding);
    framed = resampleToFrame(data, mask, width, height, xf, frame.width, frame.height, { keepOriginal });
  } else {
    const xf = centerTransform({ x: 0, y: 0, w: width, h: height }, frame.width, frame.height, 0);
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
      applyShadow(out, shadowFromMask(mask, width, height, { opacity: opac }), width, height);
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

function resizeRGBA(src, sw, sh, dw, dh) {
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
