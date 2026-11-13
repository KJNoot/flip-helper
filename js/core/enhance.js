// Enhance (v0.7.3): a pro clean-up that KEEPS the real background.
// Like a phone's auto-enhance or portrait mode: exposure, white balance,
// contrast and levels, a gentle denoise, and a smart unsharp for focus.
// Optionally a slight background blur using the U²-Netp mask so the item
// pops while its edges stay clean, plus a gentle straighten and a crop to
// the item with margin. Never upscales, never invents pixels.
//
// This is the default result of "Make it look pro." The white-background
// studio cutout stays as a secondary choice on the same sheet.

import { autoLevels, luminancePercentile } from "./photo.js";
import {
  grayWorldBalance, boxBlur, softBlur, erodeMask, dilateMask, featherMask,
  foregroundBounds, subjectPadBox, cropRGBA, rotateImageAndMask,
  tiltInfo, gentleStraightenDegrees, STUDIO_MAX_COMPOSITE_EDGE,
  workingSize, resizeRGBA, upsampleMask
} from "./studio.js";

export const ENHANCE_LOOK = "enhance";
export const ENHANCE_LABEL = "Enhance";
export const ENHANCE_NOTE = "Keeps your background and cleans up the photo, like a phone's auto-enhance: light, color, and focus. A white studio cutout is still a choice on this sheet. It does not hide damage. Check that flaws are still visible.";
export const ENHANCE_BLUR_LABEL = "Soften the background a little";
export const ENHANCE_CROP_LABEL = "Crop in on the item";
export const ENHANCE_PROGRESS = "Cleaning up your photo…";

export const ENHANCE_MAX_GAIN = 1.28;
export const ENHANCE_MAX_PULL = 0.90;
export const ENHANCE_TARGET_LUMA = 126;
export const ENHANCE_DENOISE_RADIUS = 1;
export const ENHANCE_DENOISE_THRESHOLD = 16;
export const ENHANCE_SHARP_AMOUNT = 0.52;
export const ENHANCE_SHARP_RADIUS = 1;
export const ENHANCE_SHARP_THRESHOLD = 5;
export const ENHANCE_BLUR_STRENGTH = 0.32;
export const ENHANCE_BLUR_RADIUS_FRAC = 0.008;
export const ENHANCE_BLUR_RADIUS_MAX = 10;
export const ENHANCE_CROP_MARGIN = 0.16;
export const ENHANCE_CROP_MIN_PAD = 24;

export function isEnhanceOptions(options = {}) {
  const look = options.look || options.background;
  return look === ENHANCE_LOOK || look === "enhance";
}

function asRGBA(data, width, height) {
  const n = Math.max(0, (width * height) | 0) * 4;
  if (data instanceof Uint8ClampedArray && data.length >= n) {
    return data.length === n ? new Uint8ClampedArray(data) : data.slice(0, n);
  }
  const out = new Uint8ClampedArray(n);
  if (data && data.length) out.set(data.length > n ? data.subarray(0, n) : data);
  return out;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function lumaOf(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function medianLuma(data, width, height, mask, { threshold = 0.35 } = {}) {
  const n = width * height;
  const vals = [];
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] < threshold) continue;
    const o = i * 4;
    vals.push(lumaOf(data[o], data[o + 1], data[o + 2]));
  }
  if (!vals.length) return luminancePercentile(data, width, height, 0.5);
  vals.sort((a, b) => a - b);
  return vals[(vals.length / 2) | 0];
}

/**
 * Auto exposure: a gentle gain (or pull) toward a mid brightness,
 * with a soft shoulder so highlights are not blown.
 */
export function autoExposure(data, width, height, mask, {
  target = ENHANCE_TARGET_LUMA, maxGain = ENHANCE_MAX_GAIN, maxPull = ENHANCE_MAX_PULL
} = {}) {
  const src = asRGBA(data, width, height);
  const mid = medianLuma(src, width, height, mask);
  if (!(mid > 0)) return src;
  let gain = target / mid;
  gain = clamp(gain, maxPull, maxGain);
  // Already close to the target: leave it (a no-op keeps original pixels).
  if (Math.abs(gain - 1) < 0.04) return src;
  const out = new Uint8ClampedArray(src);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      let v = src[o + c] * gain;
      // Soft highlight rolloff above 240.
      if (v > 240) v = 240 + (v - 240) * 0.35;
      out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/** White balance, then exposure, then a mild levels stretch. */
export function autoTone(data, width, height, mask) {
  let out = grayWorldBalance(data, width, height, mask);
  out = autoExposure(out, width, height, mask);
  // Measure levels on the subject when we have a mask, so a dark background
  // does not force a harsh stretch.
  let measured = out;
  if (mask) {
    measured = new Uint8ClampedArray(out);
    const n = width * height;
    for (let i = 0; i < n; i++) measured[i * 4 + 3] = mask[i] >= 0.35 ? 255 : 0;
  }
  const leveled = autoLevels(measured, width, height, { lowP: 0.012, highP: 0.995, contrast: 1.06 });
  if (!mask) return leveled;
  // autoLevels used subject alpha to skip bg in percentiles, but still
  // wrote every pixel. That's what we want — a consistent grade.
  const out2 = new Uint8ClampedArray(leveled);
  const n = width * height;
  for (let i = 0; i < n; i++) out2[i * 4 + 3] = 255;
  return out2;
}

/**
 * A tiny edge-preserving denoise: average a neighbor only when its
 * color is close to this pixel. Rust, wood grain, and edges stay.
 */
export function gentleDenoise(data, width, height, {
  radius = ENHANCE_DENOISE_RADIUS, threshold = ENHANCE_DENOISE_THRESHOLD
} = {}) {
  const src = asRGBA(data, width, height);
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return src;
  const out = new Uint8ClampedArray(src);
  const thr2 = threshold * threshold * 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const r0 = src[o], g0 = src[o + 1], b0 = src[o + 2];
      let rs = 0, gs = 0, bs = 0, wsum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const p = (yy * width + xx) * 4;
          const dr = src[p] - r0, dg = src[p + 1] - g0, db = src[p + 2] - b0;
          if (dr * dr + dg * dg + db * db <= thr2) {
            rs += src[p]; gs += src[p + 1]; bs += src[p + 2];
            wsum += 1;
          }
        }
      }
      if (wsum > 0) {
        out[o] = rs / wsum;
        out[o + 1] = gs / wsum;
        out[o + 2] = bs / wsum;
      }
    }
  }
  return out;
}

function blurRGBA(data, width, height, radius, { soft = false } = {}) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return asRGBA(data, width, height);
  const n = width * height;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    ch[0][i] = data[o];
    ch[1][i] = data[o + 1];
    ch[2][i] = data[o + 2];
  }
  for (let c = 0; c < 3; c++) {
    ch[c] = soft ? softBlur(ch[c], width, height, r) : boxBlur(ch[c], width, height, r);
  }
  const dest = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    dest[o] = ch[0][i];
    dest[o + 1] = ch[1][i];
    dest[o + 2] = ch[2][i];
    dest[o + 3] = 255;
  }
  return dest;
}

/**
 * Unsharp mask for focus. Only pixels that already differ from their
 * blur by more than `threshold` are sharpened, so noise is not boosted.
 */
export function unsharpMask(data, width, height, {
  amount = ENHANCE_SHARP_AMOUNT, radius = ENHANCE_SHARP_RADIUS, threshold = ENHANCE_SHARP_THRESHOLD
} = {}) {
  const src = asRGBA(data, width, height);
  const r = Math.max(1, Math.round(radius));
  const blur = blurRGBA(src, width, height, r, { soft: false });
  const out = new Uint8ClampedArray(src);
  const n = width * height;
  const amt = Math.max(0, Number(amount) || 0);
  if (amt === 0) return src;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const d = src[o + c] - blur[o + c];
      if (Math.abs(d) < threshold) continue;
      const v = src[o + c] + d * amt;
      out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/**
 * A slight portrait-style background blur. The item itself is left
 * untouched. The mask is eroded and feathered so the blur starts just
 * outside the subject and the edges stay clean (no halo).
 */
export function deepenBackground(data, mask, width, height, {
  strength = ENHANCE_BLUR_STRENGTH, radiusFrac = ENHANCE_BLUR_RADIUS_FRAC, radiusMax = ENHANCE_BLUR_RADIUS_MAX
} = {}) {
  const src = asRGBA(data, width, height);
  if (!mask || !mask.length) return src;
  const minE = Math.min(width, height);
  const radius = Math.max(2, Math.min(radiusMax, Math.round(minE * radiusFrac)));
  const erodePx = Math.max(2, Math.round(radius * 0.45));
  const featherPx = Math.max(2, Math.round(radius * 0.7));
  // Subject is protected: erode so we only blur well outside the edge,
  // then feather that for a smooth falloff.
  let protect = erodeMask(mask, width, height, erodePx);
  protect = featherMask(protect, width, height, featherPx);
  const blur = blurRGBA(src, width, height, radius, { soft: true });
  const out = new Uint8ClampedArray(src);
  const n = width * height;
  const s = clamp(Number(strength) || 0, 0, 1);
  if (s <= 0) return src;
  for (let i = 0; i < n; i++) {
    const keep = protect[i]; // 1 = subject, keep original
    const t = (1 - keep) * s; // 0 = original, s = fully blurred (far bg)
    if (t <= 0) continue;
    const o = i * 4;
    const it = 1 - t;
    out[o] = src[o] * it + blur[o] * t;
    out[o + 1] = src[o + 1] * it + blur[o + 1] * t;
    out[o + 2] = src[o + 2] * it + blur[o + 2] * t;
  }
  return out;
}

/**
 * Crop to the item with a margin, never enlarging past the source, and
 * never padding with invented pixels. If the requested aspect does not
 * fit around the item inside the photo, we take the largest crop that
 * does fit and keep every pixel real.
 */
export function cropToSubject(data, mask, width, height, {
  marginFrac = ENHANCE_CROP_MARGIN, minPad = ENHANCE_CROP_MIN_PAD, aspect = "photo"
} = {}) {
  const src = asRGBA(data, width, height);
  const bounds = mask ? foregroundBounds(mask, width, height, { threshold: 0.25 }) : null;
  if (!bounds) return { data: src, mask, width, height, cropped: false };
  const padded = subjectPadBox(bounds, width, height, marginFrac, minPad);
  let x = padded.x, y = padded.y, w = padded.w, h = padded.h;
  const want = aspect === "square" ? 1 : aspect === "portrait" ? 4 / 5 : (aspect === "photo" || !aspect ? w / h : null);
  if (want && isFinite(want) && want > 0) {
    // Grow the box toward the desired aspect, staying inside the photo.
    let cw = w, ch = h;
    if (cw / ch > want) {
      ch = cw / want;
    } else {
      cw = ch * want;
    }
    if (cw > width) { cw = width; ch = cw / want; }
    if (ch > height) { ch = height; cw = ch * want; }
    // Center on the padded box, clamp to the photo.
    let cx = x + w / 2, cy = y + h / 2;
    x = Math.round(cx - cw / 2);
    y = Math.round(cy - ch / 2);
    w = Math.round(cw);
    h = Math.round(ch);
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > width) x = width - w;
    if (y + h > height) y = height - h;
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(w, width - x);
    h = Math.min(h, height - y);
  }
  w = Math.max(1, Math.min(w, width));
  h = Math.max(1, Math.min(h, height));
  // Never larger than the source.
  if (w >= width && h >= height) {
    return { data: src, mask, width, height, cropped: false };
  }
  const cut = cropRGBA(src, width, height, { x, y, w, h });
  let cutMask = mask;
  if (mask) {
    cutMask = new Float32Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const sx = x + xx, sy = y + yy;
        cutMask[yy * w + xx] = (sx >= 0 && sy >= 0 && sx < width && sy < height) ? mask[sy * width + sx] : 0;
      }
    }
  }
  return { data: cut.data, mask: cutMask, width: cut.width, height: cut.height, cropped: true, box: { x, y, w, h } };
}


/**
 * Largest axis-aligned size that sits entirely on real source pixels
 * after a rotation (no black corners, no invented edge).
 * "rotatedRectWithMaxArea" — the usual crop-after-rotate formula.
 */
export function inscribedAfterRotate(srcW, srcH, degrees) {
  const w = Math.max(1, srcW | 0);
  const h = Math.max(1, srcH | 0);
  const ang = Math.abs(Number(degrees) || 0) * Math.PI / 180;
  if (!(ang > 1e-8)) return { width: w, height: h };
  const sinA = Math.sin(ang);
  const cosA = Math.cos(ang);
  if (sinA < 1e-8) return { width: w, height: h };
  const widthIsLonger = w >= h;
  const sideLong = widthIsLonger ? w : h;
  const sideShort = widthIsLonger ? h : w;
  let wr, hr;
  if (sideShort <= 2 * sinA * cosA * sideLong + 1e-9 || Math.abs(sinA - cosA) < 1e-10) {
    const x = 0.5 * sideShort;
    wr = widthIsLonger ? x / sinA : x / cosA;
    hr = widthIsLonger ? x / cosA : x / sinA;
  } else {
    const cos2 = cosA * cosA - sinA * sinA;
    wr = (w * cosA - h * sinA) / cos2;
    hr = (h * cosA - w * sinA) / cos2;
  }
  wr = Math.max(1, Math.min(w, Math.floor(wr)));
  hr = Math.max(1, Math.min(h, Math.floor(hr)));
  return { width: wr, height: hr };
}

function borderIsReal(data, width, height, x0, y0, tw, th) {
  if (x0 < 0 || y0 < 0 || x0 + tw > width || y0 + th > height) return false;
  const opaque = (x, y) => data[(y * width + x) * 4 + 3] >= 128;
  for (let x = 0; x < tw; x++) {
    if (!opaque(x0 + x, y0) || !opaque(x0 + x, y0 + th - 1)) return false;
  }
  for (let y = 0; y < th; y++) {
    if (!opaque(x0, y0 + y) || !opaque(x0 + tw - 1, y0 + y)) return false;
  }
  return true;
}

/**
 * After a rotation that grew the canvas, drop the invented (transparent
 * or empty) corners. The result is only real source pixels, and never
 * larger than the photo we started with.
 */
export function cropToRealPixels(data, mask, width, height, { srcW, srcH, degrees } = {}) {
  const src = asRGBA(data, width, height);
  let tw = width, th = height;
  if (srcW && srcH) {
    const ins = inscribedAfterRotate(srcW, srcH, degrees || 0);
    tw = Math.min(width, ins.width);
    th = Math.min(height, ins.height);
  }
  const cx = width / 2, cy = height / 2;
  let x0 = Math.round(cx - tw / 2);
  let y0 = Math.round(cy - th / 2);
  if (!borderIsReal(src, width, height, x0, y0, tw, th)) {
    let lo = 0.55, hi = 1, best = 0.55;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const w = Math.max(1, Math.floor(tw * mid));
      const h = Math.max(1, Math.floor(th * mid));
      const x = Math.round(cx - w / 2);
      const y = Math.round(cy - h / 2);
      if (borderIsReal(src, width, height, x, y, w, h)) { best = mid; lo = mid; }
      else hi = mid;
    }
    tw = Math.max(1, Math.floor(tw * best));
    th = Math.max(1, Math.floor(th * best));
    x0 = Math.round(cx - tw / 2);
    y0 = Math.round(cy - th / 2);
  }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  tw = Math.min(tw, width - x0);
  th = Math.min(th, height - y0);
  if (srcW) tw = Math.min(tw, srcW);
  if (srcH) th = Math.min(th, srcH);
  if (tw >= width && th >= height) {
    return { data: src, mask, width, height, cropped: false };
  }
  const cut = cropRGBA(src, width, height, { x: x0, y: y0, w: tw, h: th });
  let cutMask = mask;
  if (mask) {
    cutMask = new Float32Array(tw * th);
    for (let yy = 0; yy < th; yy++) {
      for (let xx = 0; xx < tw; xx++) {
        const sx = x0 + xx, sy = y0 + yy;
        cutMask[yy * tw + xx] = (sx >= 0 && sy >= 0 && sx < width && sy < height) ? mask[sy * width + sx] : 0;
      }
    }
  }
  return { data: cut.data, mask: cutMask, width: cut.width, height: cut.height, cropped: true, box: { x: x0, y: y0, w: tw, h: th } };
}

/**
 * Full Enhance pipeline. Returns opaque RGBA at the photo's own resolution
 * or smaller (after a crop). Never upscales.
 */
export function enhancePhoto(src, {
  straighten = true,
  crop = true,
  blurBg = true,
  aspect = "photo",
  denoise = true,
  sharpen = true
} = {}) {
  let width = src.width;
  let height = src.height;
  const srcW = width, srcH = height;
  let data = asRGBA(src.data, width, height);
  let mask = src.mask && src.mask.length ? src.mask : null;

  // Cap only huge photos. Never enlarge.
  const work = workingSize(width, height, STUDIO_MAX_COMPOSITE_EDGE);
  if (work.scale < 1) {
    data = resizeRGBA(data, width, height, work.width, work.height);
    if (mask) mask = upsampleMask(mask, width, height, work.width, work.height);
    width = work.width;
    height = work.height;
  }
  data = autoTone(data, width, height, mask);
  if (denoise) data = gentleDenoise(data, width, height);
  if (sharpen) data = unsharpMask(data, width, height);
  if (blurBg && mask) data = deepenBackground(data, mask, width, height);

  let straightenDeg = 0;
  if (straighten && mask) {
    const tilt = tiltInfo(mask, width, height);
    straightenDeg = gentleStraightenDegrees(tilt.angle, { elongation: tilt.elongation });
    if (straightenDeg) {
      const rot = rotateImageAndMask(data, mask, width, height, straightenDeg);
      const real = cropToRealPixels(rot.data, rot.mask, rot.width, rot.height, {
        srcW: width, srcH: height, degrees: straightenDeg
      });
      data = real.data;
      mask = real.mask;
      width = real.width;
      height = real.height;
    }
  }

  let cropped = false;
  if (crop && mask) {
    const cut = cropToSubject(data, mask, width, height, { aspect });
    data = cut.data;
    mask = cut.mask;
    width = cut.width;
    height = cut.height;
    cropped = !!cut.cropped;
  }

  // Fully opaque — this is a real photo, not a cutout.
  const n = width * height;
  for (let i = 0; i < n; i++) data[i * 4 + 3] = 255;

  return {
    data,
    width,
    height,
    mask,
    kind: ENHANCE_LOOK,
    background: "original",
    look: ENHANCE_LOOK,
    aspect: aspect || "photo",
    usedShadow: false,
    usedStraighten: !!straightenDeg,
    straightenDeg,
    usedBlur: !!(blurBg && src.mask),
    usedCrop: cropped
  };
}

export { ENHANCE_LOOK as LOOK };
