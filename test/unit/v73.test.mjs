import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  autoExposure, autoTone, gentleDenoise, unsharpMask, deepenBackground,
  cropToSubject, enhancePhoto, isEnhanceOptions, inscribedAfterRotate, cropToRealPixels,
  ENHANCE_LOOK, ENHANCE_LABEL, ENHANCE_NOTE, ENHANCE_MAX_GAIN
} from "../../app/js/core/enhance.js";
import { STUDIO_MAX_SCALE as SMS, STUDIO_NOTE, BACKGROUNDS, EXPORT_FRAMES, frameSize, rotateImageAndMask } from "../../app/js/core/studio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function rgba(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = typeof fill === "function" ? fill(i % w, (i / w) | 0) : fill;
    data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = c[3] ?? 255;
  }
  return data;
}

function luma(data, i) {
  const o = i * 4;
  return 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
}

describe("v0.7.4 auto exposure, white balance, contrast and levels", () => {
  it("lifts a dark photo toward mid brightness without blowing highlights", () => {
    const w = 32, h = 32;
    const src = rgba(w, h, (x, y) => {
      // Dark midtones, a few near-white sparkles
      if (x === 2 && y === 2) return [250, 250, 250];
      return [40, 42, 38];
    });
    const out = autoExposure(src, w, h, null);
    const midIn = luma(src, 16 * w + 16);
    const midOut = luma(out, 16 * w + 16);
    assert.ok(midOut > midIn + 10, `lifted ${midIn} -> ${midOut}`);
    // Highlight is not crushed to 255 from over-gain
    assert.ok(out[2 * w * 4 + 2 * 4] <= 255);
    assert.ok(out[2 * w * 4 + 2 * 4] >= 240);
  });

  it("does not invent a color: a already-bright photo stays close to the original", () => {
    const w = 16, h = 16;
    const src = rgba(w, h, [140, 142, 138]);
    const out = autoExposure(src, w, h, null);
    // Gain should be near 1 (within 4% no-op or a small nudge)
    const d = Math.abs(out[0] - src[0]);
    assert.ok(d < 25, "small change on a mid-bright photo, got " + d);
  });

  it("autoTone reduces a warm lighting cast on a near-white backdrop", () => {
    const w = 24, h = 24;
    // Creamy/yellow background, a slightly warmer item in the middle
    const src = rgba(w, h, (x, y) => {
      const inItem = x >= 8 && x < 16 && y >= 8 && y < 16;
      return inItem ? [160, 80, 50] : [230, 210, 160];
    });
    const mask = new Float32Array(w * h);
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) mask[y * w + x] = 1;
    const out = autoTone(src, w, h, mask);
    // Background should be closer to neutral (R closer to B)
    const bgIn = src[0] - src[2];
    const bgOut = out[0] - out[2];
    assert.ok(bgOut < bgIn, `cast ${bgIn} -> ${bgOut}`);
  });
});

describe("v0.7.4 gentle denoise and unsharp mask", () => {
  it("denoise smooths speckles but keeps a hard edge", () => {
    const w = 20, h = 20;
    const src = rgba(w, h, (x, y) => {
      if (x < 10) return [30, 30, 30];
      return [200, 200, 200];
    });
    // Sprinkle noise on the flat areas
    src[(2 * w + 2) * 4] = 48;
    src[(2 * w + 2) * 4 + 1] = 48;
    src[(2 * w + 2) * 4 + 2] = 48;
    const out = gentleDenoise(src, w, h, { radius: 1, threshold: 24 });
    // A mild 48 on a 30 field is inside the threshold and should move toward 30
    assert.ok(out[(2 * w + 2) * 4] < 48, "speckle reduced");
    // The hard edge at x=9 vs x=10 stays distinct
    const left = out[(10 * w + 9) * 4];
    const right = out[(10 * w + 10) * 4];
    assert.ok(right - left > 100, `edge kept ${left} vs ${right}`);
  });

  it("unsharp mask raises contrast at an edge and leaves a flat area alone", () => {
    const w = 24, h = 24;
    const src = rgba(w, h, (x, y) => x < 12 ? [40, 40, 40] : [200, 200, 200]);
    const out = unsharpMask(src, w, h, { amount: 0.7, radius: 1, threshold: 2 });
    // Pixels next to the edge should be pushed further (darker left, brighter right)
    const leftIn = src[(12 * w + 11) * 4];
    const leftOut = out[(12 * w + 11) * 4];
    const rightIn = src[(12 * w + 12) * 4];
    const rightOut = out[(12 * w + 12) * 4];
    assert.ok(leftOut <= leftIn, `left ${leftIn} -> ${leftOut}`);
    assert.ok(rightOut >= rightIn, `right ${rightIn} -> ${rightOut}`);
    // Far from the edge, a flat pixel is unchanged (below threshold vs its blur)
    assert.equal(out[(12 * w + 2) * 4], src[(12 * w + 2) * 4]);
  });
});

describe("v0.7.4 portrait blur, crop, and no upscale", () => {
  it("blurs the background but leaves subject pixels unchanged", () => {
    const w = 32, h = 32;
    const src = rgba(w, h, (x, y) => {
      // A textured background (checker) and a solid subject
      const inItem = x >= 10 && x < 22 && y >= 10 && y < 22;
      if (inItem) return [180, 60, 40];
      return ((x + y) % 2 === 0) ? [40, 120, 40] : [80, 160, 80];
    });
    const mask = new Float32Array(w * h);
    for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) mask[y * w + x] = 1;
    const out = deepenBackground(src, mask, w, h, { strength: 0.8, radiusFrac: 0.08, radiusMax: 6 });
    // Center of subject is identical
    const c = (16 * w + 16) * 4;
    assert.equal(out[c], src[c]);
    assert.equal(out[c + 1], src[c + 1]);
    // A far-background checker pixel should be pulled toward its neighbor (less extreme)
    const bg = (2 * w + 2) * 4;
    const spreadIn = Math.abs(src[bg] - src[bg + 4]);
    const spreadOut = Math.abs(out[bg] - out[bg + 4]);
    assert.ok(spreadOut < spreadIn || out[bg] !== src[bg], "background softened");
  });

  it("crops to the item with a margin and never enlarges past the source", () => {
    const w = 80, h = 80;
    const src = rgba(w, h, (x, y) => {
      const inItem = x >= 30 && x < 50 && y >= 30 && y < 50;
      return inItem ? [200, 100, 50] : [20, 80, 20];
    });
    const mask = new Float32Array(w * h);
    for (let y = 30; y < 50; y++) for (let x = 30; x < 50; x++) mask[y * w + x] = 1;
    const cut = cropToSubject(src, mask, w, h, { marginFrac: 0.2, aspect: "photo" });
    assert.ok(cut.cropped);
    assert.ok(cut.width <= w && cut.height <= h, "no upscale");
    assert.ok(cut.width < w || cut.height < h, "actually cropped");
    // The item is still fully inside the crop (20px item + margin)
    assert.ok(cut.width >= 20);
    assert.ok(cut.height >= 20);
    // Square crop also stays inside the source
    const sq = cropToSubject(src, mask, w, h, { marginFrac: 0.2, aspect: "square" });
    assert.ok(sq.width <= w && sq.height <= h);
    assert.equal(sq.width, sq.height);
  });

  it("enhancePhoto never upscales and keeps a real background (not a white cutout)", () => {
    const w = 48, h = 48;
    const src = rgba(w, h, (x, y) => {
      const inItem = x >= 16 && x < 32 && y >= 16 && y < 32;
      return inItem ? [160, 70, 40] : [50, 110, 50]; // green grass-like bg
    });
    const mask = new Float32Array(w * h);
    for (let y = 16; y < 32; y++) for (let x = 16; x < 32; x++) mask[y * w + x] = 1;
    const out = enhancePhoto({ data: src, width: w, height: h, mask }, {
      straighten: false, crop: true, blurBg: true, aspect: "photo"
    });
    assert.ok(out.width <= w && out.height <= h);
    assert.equal(out.kind, "enhance");
    assert.equal(out.background, "original");
    assert.equal(out.usedShadow, false);
    // A background pixel is still green-ish, not white
    // After crop, (0,0) should be near the padded grass
    const r = out.data[0], g = out.data[1], b = out.data[2];
    assert.ok(g > r && g > b, `bg stayed green-ish, got ${r},${g},${b}`);
    assert.ok(r < 200 && g < 230, "not a white studio backdrop");
    // Every pixel is opaque
    for (let i = 0; i < out.width * out.height; i++) assert.equal(out.data[i * 4 + 3], 255);
  });


  it("straighten drops invented corners and never grows past the source", () => {
    const w = 80, h = 120;
    const src = rgba(w, h, [40, 160, 50]);
    const mask = new Float32Array(w * h);
    // A tall item, slightly filled, so a rotation has something to work with
    for (let y = 10; y < 110; y++) for (let x = 20; x < 60; x++) mask[y * w + x] = 1;
    const rot = rotateImageAndMask(src, mask, w, h, 8);
    assert.ok(rot.width > w || rot.height > h, "rotate expands the canvas");
    // Raw rotation has empty corners (alpha 0)
    assert.equal(rot.data[3], 0);
    const cut = cropToRealPixels(rot.data, rot.mask, rot.width, rot.height, {
      srcW: w, srcH: h, degrees: 8
    });
    assert.ok(cut.width <= w && cut.height <= h, `inscribed ${cut.width}x${cut.height} vs ${w}x${h}`);
    assert.ok(cut.width > 20 && cut.height > 20, "kept a useful area");
    const ins = inscribedAfterRotate(w, h, 8);
    assert.ok(ins.width <= w && ins.height <= h);
    // Every corner is a real green pixel, not invented black
    const corners = [[0, 0], [cut.width - 1, 0], [0, cut.height - 1], [cut.width - 1, cut.height - 1]];
    for (const [x, y] of corners) {
      const o = (y * cut.width + x) * 4;
      assert.ok(cut.data[o + 3] >= 128, `alpha at ${x},${y}`);
      assert.ok(cut.data[o + 1] > 80, `green at ${x},${y}, got ${cut.data[o]},${cut.data[o + 1]},${cut.data[o + 2]}`);
    }
    // Full enhance with straighten also stays inside the source and has no black corners
    const out = enhancePhoto({ data: src, width: w, height: h, mask }, {
      straighten: true, crop: false, blurBg: false, aspect: "photo", denoise: false, sharpen: false
    });
    assert.ok(out.width <= w && out.height <= h, `enhance ${out.width}x${out.height}`);
    for (const [x, y] of [[0, 0], [out.width - 1, 0], [0, out.height - 1], [out.width - 1, out.height - 1]]) {
      const o = (y * out.width + x) * 4;
      assert.ok(out.data[o + 1] > 60, `enhance corner ${x},${y} is real`);
    }
  });

  it("isEnhanceOptions recognizes the default look", () => {
    assert.equal(isEnhanceOptions({ look: "enhance" }), true);
    assert.equal(isEnhanceOptions({ background: "enhance" }), true);
    assert.equal(isEnhanceOptions({ background: "white" }), false);
    assert.equal(ENHANCE_LOOK, "enhance");
    assert.equal(ENHANCE_LABEL, "Enhance");
    assert.match(ENHANCE_NOTE, /keeps your background|real background/i);
    assert.ok(ENHANCE_MAX_GAIN <= 1.4);
    assert.equal(SMS, 1);
  });
});

describe("v0.7.4 wiring: Enhance is the default, white cutout is secondary", () => {
  it("bumps the app to 0.9.1 and caches enhance.js", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "0.9.1");
    const main = readFileSync(join(root, "app/js/main.js"), "utf8");
    assert.match(main, /export const VERSION = "0\.9\.1"/);
    const sw = readFileSync(join(root, "app/sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.9\.1/);
    assert.match(sw, /js\/core\/enhance\.js/);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(readme, /0\.9\.1/);
    assert.match(readme, /Enhance/);
  });

  it("makes Enhance the default Make it look pro result, with white studio as a choice on the same sheet", () => {
    const ui = readFileSync(join(root, "app/js/ui/cleanup.js"), "utf8");
    const studio = readFileSync(join(root, "app/js/core/studio.js"), "utf8");
    const seg = readFileSync(join(root, "app/js/core/segment.js"), "utf8");
    assert.match(ui, /look:\s*"enhance"/);
    assert.match(ui, /background:\s*"enhance"/);
    assert.match(ui, /ENHANCE_BLUR_LABEL|Soften the background/);
    assert.match(ui, /ENHANCE_CROP_LABEL|Crop in on the item/);
    assert.match(ui, /\["enhance", "white", "gray"\]/);
    assert.match(STUDIO_NOTE, /keeps the real background|auto-enhance/);
    assert.equal(BACKGROUNDS.enhance.label, "Enhance");
    assert.equal(BACKGROUNDS.white.label, "White studio");
    assert.ok(EXPORT_FRAMES.photo);
    assert.equal(EXPORT_FRAMES.photo.id, "photo");
    const f = frameSize("photo", 2000, 4000, 3000);
    assert.ok(f.width <= 2000 && f.height <= 2000);
    assert.ok(Math.abs(f.width / f.height - 4000 / 3000) < 0.02);
    assert.match(seg, /enhancePhoto/);
    assert.match(seg, /isEnhanceOptions/);
    // White cutout path is still there
    assert.match(studio, /export function renderStudio/);
    assert.match(studio, /White studio/);
    assert.match(ui, /\["enhance", "white", "gray"\]/);
  });

  it("does not mention last names, emails, secrets, or Ken's test photos", () => {
    const a = readFileSync(join(root, "app/js/core/enhance.js"), "utf8");
    const b = readFileSync(join(root, "app/js/ui/cleanup.js"), "utf8");
    const both = a + b;
    assert.doesNotMatch(both, /Hasier/);
    assert.doesNotMatch(both, /KennethNootbaar6/i);
    assert.doesNotMatch(both, /sk-[a-zA-Z0-9]{10,}/);
    assert.doesNotMatch(both, /ken-test-photos/);
    assert.doesNotMatch(both, /rear-blade/);
  });
});
