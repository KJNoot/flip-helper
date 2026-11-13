import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  STUDIO_LABEL, STUDIO_NOTE, STUDIO_BUTTON, STUDIO_BASIC_LINK, STUDIO_FALLBACK_MSG,
  STUDIO_EDGES_NOTE, STUDIO_PROGRESS_FIRST, STUDIO_MODEL, STUDIO_RECOMMENDED,
  BACKGROUNDS, EXPORT_FRAMES, COVER_CHECK_NOTE, COVER_CHECK_SYSTEM, COVER_CHECK_LABEL,
  prepareInputTensor, upsampleMask, refineMatte, nextMattePreset,
  foregroundBounds, centerTransform, frameSize, workingSize,
  boxBlur, shadowFromMask, principalAxisAngle, gentleStraightenDegrees, tiltInfo,
  rotateImageAndMask, grayWorldBalance, fillBackground, applyShadow,
  compositeForeground, renderStudio, studioOrBasic, normalizeCoverCheck
} from "../../app/js/core/studio.js";
import { applyCleanedPhoto, restorePhotoOriginal, photoHasOriginal } from "../../app/js/core/history.js";
import { PHOTO_CLEANUP_NOTE, PHOTO_CLEANUP_LABEL } from "../../app/js/core/photo.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function rgba(width, height, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3] == null ? 255 : fill[3];
  }
  return data;
}

function at(data, width, x, y) {
  const o = (y * width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

function circleMask(width, height, cx, cy, r) {
  const m = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      m[y * width + x] = d <= r - 1 ? 1 : d >= r + 1 ? 0 : 1 - (d - (r - 1)) / 2;
    }
  }
  return m;
}

function rectMask(width, height, x0, y0, x1, y1) {
  const m = new Float32Array(width * height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) m[y * width + x] = 1;
  }
  return m;
}

function paintRect(data, width, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  }
}

describe("v0.7.0 studio photo math", () => {
  it("exports the recommended studio wording and keeps the honesty note", () => {
    assert.equal(STUDIO_BUTTON, "Make it look pro");
    assert.equal(STUDIO_LABEL, "studio");
    assert.equal(STUDIO_RECOMMENDED, "Recommended");
    assert.match(STUDIO_NOTE, /does not hide damage/i);
    assert.match(STUDIO_NOTE, /keeps the real background/i);
    assert.match(STUDIO_NOTE, /white studio cutout is still a choice/i);
    assert.match(STUDIO_NOTE, /Check that flaws are still visible/);
    assert.match(STUDIO_NOTE, /on this phone/);
    assert.match(STUDIO_FALLBACK_MSG, /basic clean-up/i);
    assert.match(STUDIO_EDGES_NOTE, /Try again/i);
    assert.match(STUDIO_EDGES_NOTE, /basic/i);
    assert.match(STUDIO_PROGRESS_FIRST, /Getting the studio ready/);
    assert.match(STUDIO_PROGRESS_FIRST, /first time takes a moment/);
    assert.match(STUDIO_BASIC_LINK, /basic/i);
    // The original basic note is still there for the lesser option.
    assert.match(PHOTO_CLEANUP_NOTE, /not a studio cut-out/);
    assert.equal(PHOTO_CLEANUP_LABEL, "basic");
  });

  it("uses U²-Netp under the Apache-2.0 license, at the known size and hash", () => {
    assert.equal(STUDIO_MODEL.id, "u2netp");
    assert.equal(STUDIO_MODEL.license, "Apache-2.0");
    assert.equal(STUDIO_MODEL.sizeBytes, 4574861);
    assert.equal(STUDIO_MODEL.sha256, "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8");
    assert.equal(STUDIO_MODEL.inputSize, 320);
    const bin = readFileSync(join(root, "app/vendor/studio/u2netp.onnx"));
    assert.equal(bin.length, 4574861);
    const notice = readFileSync(join(root, "app/vendor/studio/NOTICE.txt"), "utf8");
    assert.match(notice, /Apache License 2.0/);
    assert.match(notice, /U²-Netp/);
    const lic = readFileSync(join(root, "app/vendor/studio/U2-Net-LICENSE.txt"), "utf8");
    assert.match(lic, /Apache License/);
  });

  it("offers pure white, soft gray studio, and keep-original backgrounds, plus 1:1 and 4:5 frames", () => {
    assert.equal(BACKGROUNDS.white.rgb[0], 255);
    assert.equal(BACKGROUNDS.white.rgb[1], 255);
    assert.equal(BACKGROUNDS.white.rgb[2], 255);
    assert.ok(BACKGROUNDS.gray.rgb);
    assert.ok(BACKGROUNDS.gray.rgbBottom);
    assert.equal(BACKGROUNDS.original.rgb, null);
    assert.match(BACKGROUNDS.white.note, /Marketplace standard/i);
    const sq = frameSize("square", 2000);
    assert.equal(sq.width, 2000);
    assert.equal(sq.height, 2000);
    const tall = frameSize("portrait", 2000);
    assert.equal(tall.width, 1600);
    assert.equal(tall.height, 2000);
    assert.equal(tall.width / tall.height, 4 / 5);
    assert.equal(EXPORT_FRAMES.portrait.ratio, "4:5");
  });

  it("prepares a 320 ImageNet NCHW tensor from a solid color", () => {
    const data = rgba(10, 8, [255, 0, 0, 255]);
    const t = prepareInputTensor(data, 10, 8);
    assert.equal(t.length, 3 * 320 * 320);
    // Red 255 → (1 - 0.485) / 0.229 ≈ 2.249
    const r = t[0];
    const g = t[320 * 320];
    const b = t[2 * 320 * 320];
    assert.ok(Math.abs(r - (1 - 0.485) / 0.229) < 0.02, `R ${r}`);
    assert.ok(Math.abs(g - (0 - 0.456) / 0.224) < 0.02, `G ${g}`);
    assert.ok(Math.abs(b - (0 - 0.406) / 0.225) < 0.02, `B ${b}`);
  });

  it("upsamples a mask bilinearly and keeps a sharp 1 at the center", () => {
    const src = new Float32Array(4);
    src[0] = 0; src[1] = 0; src[2] = 0; src[3] = 1; // 2×2, bottom-right is 1
    const up = upsampleMask(src, 2, 2, 8, 8);
    assert.equal(up.length, 64);
    assert.ok(up[7 * 8 + 7] > 0.9);
    assert.ok(up[0] < 0.1);
  });

  it("refines a matte with a smoothstep and cycles try-again presets", () => {
    const m = new Float32Array([0, 0.05, 0.5, 0.95, 1]);
    const r = refineMatte(m, "default");
    assert.equal(r[0], 0);
    assert.ok(r[4] > 0.99);
    // 0.5 is well into the item — the default matte snaps it near solid
    // so a wood table doesn't show through. The mid-edge sits lower.
    assert.ok(r[2] > 0.7, `mid ${r[2]}`);
    const edge = refineMatte(new Float32Array([0.25]), "default")[0];
    assert.ok(edge > 0.05 && edge < 0.95, `edge ${edge}`);
    assert.equal(nextMattePreset("default"), "tighter");
    assert.equal(nextMattePreset("tighter"), "softer");
    assert.equal(nextMattePreset("softer"), "default");
  });

  it("finds foreground bounds and centers the item with even padding", () => {
    const m = rectMask(100, 80, 5, 10, 25, 30); // 20×20 box at (5,10)
    const b = foregroundBounds(m, 100, 80, { threshold: 0.5 });
    assert.deepEqual(b, { x: 5, y: 10, w: 20, h: 20 });
    // Default: never enlarge past the source pixels. A 20×20 item in a
    // 200×200 frame stays 20×20, with more padding, not a 8× blow-up.
    const xf = centerTransform(b, 200, 200, 0.10);
    assert.equal(xf.scale, 1);
    assert.equal(xf.dstW, 20);
    assert.equal(xf.dstH, 20);
    assert.equal(xf.dstX, 90);
    assert.equal(xf.dstY, 90);
    // Even padding on all sides.
    assert.equal(xf.dstX, 200 - xf.dstX - xf.dstW);
    assert.equal(xf.dstY, 200 - xf.dstY - xf.dstH);
    // The old "fill the padded frame" scale is still available when asked for.
    const uncapped = centerTransform(b, 200, 200, 0.10, { maxScale: Infinity });
    assert.equal(uncapped.scale, 8);
    assert.equal(uncapped.dstW, 160);
    assert.equal(uncapped.dstX, 20);
    // Portrait frame: same even left/right, same even top/bottom (may differ from L/R).
    const tall = centerTransform(b, 160, 200, 0.10);
    assert.ok(Math.abs(tall.dstX - (160 - tall.dstX - tall.dstW)) < 1e-9);
    assert.ok(Math.abs(tall.dstY - (200 - tall.dstY - tall.dstH)) < 1e-9);
    assert.ok(tall.scale <= 1);
  });

  it("caps a 12MP working size to 2048 on the long edge", () => {
    const w = workingSize(4032, 3024, 2048);
    assert.equal(w.width, 2048);
    assert.equal(w.height, Math.round(3024 * 2048 / 4032));
    assert.ok(w.scale < 1);
    const small = workingSize(900, 900, 2048);
    assert.equal(small.width, 900);
    assert.equal(small.scale, 1);
  });

  it("composites a red subject onto pure white and leaves corners white", () => {
    const width = 64, height = 64;
    const data = rgba(width, height, [0, 180, 0, 255]); // green background
    const mask = circleMask(width, height, 32, 32, 12);
    // Paint the circle red so we can see it survive.
    for (let i = 0; i < width * height; i++) {
      if (mask[i] > 0.5) {
        data[i * 4] = 200;
        data[i * 4 + 1] = 20;
        data[i * 4 + 2] = 20;
      }
    }
    const out = renderStudio({ data, width, height, mask }, {
      background: "white",
      shadow: false,
      straighten: false,
      center: true,
      aspect: "square",
      edge: 80,
      padding: 0.10
    });
    assert.equal(out.width, 80);
    assert.equal(out.height, 80);
    assert.equal(out.kind, "studio");
    assert.equal(out.usedShadow, false);
    // Corners of a square frame with a centered circle must be white.
    const c00 = at(out.data, 80, 0, 0);
    const c10 = at(out.data, 80, 79, 0);
    const c01 = at(out.data, 80, 0, 79);
    const c11 = at(out.data, 80, 79, 79);
    for (const p of [c00, c10, c01, c11]) {
      assert.ok(p[0] > 250 && p[1] > 250 && p[2] > 250, `corner ${p}`);
    }
    // Center should be the red item, not green.
    const mid = at(out.data, 80, 40, 40);
    assert.ok(mid[0] > 150 && mid[1] < 130 && mid[0] > mid[1], `center ${mid}`);
    // Green background must be gone (the item is red, not a green leftover).
    assert.ok(mid[1] < 130 && mid[0] > mid[1], `green leftover? ${mid}`);
  });

  it("lays a soft drop shadow below the item, not above, and only on a studio background", () => {
    const width = 80, height = 80;
    const mask = circleMask(width, height, 40, 36, 14);
    const shadow = shadowFromMask(mask, width, height, { offsetX: 0, offsetY: 8, radius: 4, opacity: 0.4 });
    // Mass of the shadow should sit lower (larger y) than the mask's mass.
    function cy(m) {
      let s = 0, yy = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const v = m[y * width + x];
        s += v; yy += y * v;
      }
      return yy / s;
    }
    assert.ok(cy(shadow) > cy(mask) + 3, `shadow cy ${cy(shadow)} mask cy ${cy(mask)}`);
    // Soft: shadow is wider than the hard mask at a mid row below the item.
    const y = 36 + 14 + 6;
    let maskSpan = 0, shSpan = 0;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0.05) maskSpan++;
      if (shadow[y * width + x] > 0.02) shSpan++;
    }
    assert.ok(shSpan > maskSpan, `shadow span ${shSpan} vs mask ${maskSpan}`);
    // Max opacity is below the requested 0.4 (blur spreads it) but not zero, and below 1.
    let mx = 0;
    for (let i = 0; i < shadow.length; i++) if (shadow[i] > mx) mx = shadow[i];
    assert.ok(mx > 0.1 && mx <= 0.4, `max ${mx}`);

    const data = rgba(width, height, [10, 10, 10, 255]);
    for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) {
      data[i * 4] = 240; data[i * 4 + 1] = 240; data[i * 4 + 2] = 240;
    }
    const withSh = renderStudio({ data, width, height, mask }, {
      background: "white", shadow: true, straighten: false, center: true, aspect: "square", edge: 100, padding: 0.15
    });
    const noSh = renderStudio({ data, width, height, mask }, {
      background: "white", shadow: false, straighten: false, center: true, aspect: "square", edge: 100, padding: 0.15
    });
    assert.equal(withSh.usedShadow, true);
    // Bounds from the unshadowed frame so we look just below the item, not past the shadow.
    const b = foregroundBounds(
      Float32Array.from({ length: 100 * 100 }, (_, i) => {
        const o = i * 4;
        const r = noSh.data[o], g = noSh.data[o + 1], bl = noSh.data[o + 2];
        return (r < 250 || g < 250 || bl < 250) ? 1 : 0;
      }),
      100, 100, { threshold: 0.5 }
    );
    assert.ok(b, "expected a subject in the output");
    const sy = Math.min(99, b.y + b.h + 3);
    const sx = Math.round(b.x + b.w / 2);
    const pSh = at(withSh.data, 100, sx, sy);
    const pNo = at(noSh.data, 100, sx, sy);
    const lumSh = (pSh[0] + pSh[1] + pSh[2]) / 3;
    const lumNo = (pNo[0] + pNo[1] + pNo[2]) / 3;
    assert.ok(lumSh < lumNo - 4, `shadow lum ${lumSh} vs ${lumNo} at ${sx},${sy} item box ${JSON.stringify(b)}`);

    const orig = renderStudio({ data, width, height, mask }, {
      background: "original", shadow: true, straighten: false, center: false, aspect: "square", edge: 80, padding: 0
    });
    assert.equal(orig.usedShadow, false);
    assert.equal(orig.background, "original");
  });

  it("fills a soft gray studio with a gentle vertical gradient", () => {
    const out = new Uint8ClampedArray(40 * 60 * 4);
    fillBackground(out, 40, 60, "gray");
    const top = at(out, 40, 20, 0);
    const bot = at(out, 40, 20, 59);
    assert.ok(top[0] > bot[0], `top ${top} bot ${bot}`);
    assert.ok(top[0] > 230 && bot[0] > 210);
  });

  it("detects a small tilt and only straightens gentle angles", () => {
    assert.equal(gentleStraightenDegrees(0), 0);
    assert.equal(gentleStraightenDegrees(0.5), 0);
    assert.equal(gentleStraightenDegrees(20), 0);
    assert.ok(Math.abs(gentleStraightenDegrees(8) + 8) < 1e-9);
    assert.ok(Math.abs(gentleStraightenDegrees(-6) - 6) < 1e-9);
    // A near-vertical object (axis ≈ 90) with a 5° tilt → 85°, correction +5.
    assert.ok(Math.abs(gentleStraightenDegrees(85) - 5) < 1e-9);
    assert.equal(gentleStraightenDegrees(90), 0);

    // A tall thin rectangle, rotated ~8° clockwise in a 120×120 canvas.
    const W = 120, H = 120;
    const m = new Float32Array(W * H);
    const ang = 8 * Math.PI / 180;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - 60, dy = y - 60;
        const lx =  cos * dx + sin * dy;
        const ly = -sin * dx + cos * dy;
        if (Math.abs(lx) < 8 && Math.abs(ly) < 36) m[y * W + x] = 1;
      }
    }
    const tilt = tiltInfo(m, W, H);
    assert.ok(tilt.elongation > 1.8, `elongation ${tilt.elongation}`);
    const corr = gentleStraightenDegrees(tilt.angle, { elongation: tilt.elongation });
    assert.ok(Math.abs(Math.abs(corr) - 8) < 2.5, `axis ${tilt.angle} corr ${corr} elong ${tilt.elongation}`);

    // A roughly square mug (body + handle) must not be rotated: the handle
    // pulls the axis off vertical, and "correcting" it makes the photo worse.
    const mug = new Float32Array(W * H);
    for (let y = 30; y < 90; y++) {
      for (let x = 35; x < 75; x++) mug[y * W + x] = 1; // body
      if (y > 45 && y < 75) {
        for (let x = 75; x < 95; x++) mug[y * W + x] = 1; // handle
      }
    }
    const mugTilt = tiltInfo(mug, W, H);
    assert.equal(gentleStraightenDegrees(mugTilt.angle, { elongation: mugTilt.elongation }), 0);
    assert.equal(gentleStraightenDegrees(8, { elongation: 1.2 }), 0);
  });

  it("rotates a mask so a tilted rectangle stands upright", () => {
    const W = 80, H = 80;
    const data = rgba(W, H, [255, 255, 255, 255]);
    const m = new Float32Array(W * H);
    const ang = 8 * Math.PI / 180;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - 40, dy = y - 40;
        const lx =  cos * dx + sin * dy;
        const ly = -sin * dx + cos * dy;
        if (Math.abs(lx) < 6 && Math.abs(ly) < 28) {
          m[y * H + x] = 1;
          const o = (y * W + x) * 4;
          data[o] = 200; data[o + 1] = 30; data[o + 2] = 30;
        }
      }
    }
    const axis = principalAxisAngle(m, W, H);
    const deg = gentleStraightenDegrees(axis);
    const rot = rotateImageAndMask(data, m, W, H, deg);
    const after = principalAxisAngle(rot.mask, rot.width, rot.height);
    const leftover = gentleStraightenDegrees(after, { min: 0.5, max: 20 });
    assert.ok(Math.abs(leftover) < Math.abs(deg) / 2, `before corr ${deg}, leftover ${leftover}, after axis ${after}`);
  });

  it("gently white-balances from a warm backdrop and leaves a cream item cream when the backdrop is already neutral", () => {
    const W = 40, H = 40;
    // Warm lighting: yellowish "white" background, a cream subject with the same cast.
    const data = rgba(W, H, [240, 220, 180, 255]);
    const mask = new Float32Array(W * H); // background everywhere
    paintRect(data, W, 12, 12, 28, 28, [200, 180, 145]);
    for (let y = 12; y < 28; y++) for (let x = 12; x < 28; x++) mask[y * W + x] = 1;
    const out = grayWorldBalance(data, W, H, mask);
    const p = at(out, W, 20, 20);
    const beforeSpread = 200 - 145;
    const afterSpread = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
    assert.ok(afterSpread < beforeSpread - 4, `spread ${afterSpread} from ${beforeSpread}, pixel ${p}`);
    // Clamped: not a wild swing, and a stain-sized difference could still survive.
    assert.ok(p[0] >= Math.floor(200 * 0.92) - 1);
    assert.ok(p[0] <= Math.ceil(200 * 1.08) + 1);

    // A cream item on an already-neutral light backdrop must stay cream.
    const cream = rgba(W, H, [232, 236, 234, 255]);
    paintRect(cream, W, 12, 12, 28, 28, [235, 223, 199]);
    const creamOut = grayWorldBalance(cream, W, H, mask);
    const c = at(creamOut, W, 20, 20);
    assert.ok(Math.abs(c[0] - 235) < 8 && Math.abs(c[1] - 223) < 8 && Math.abs(c[2] - 199) < 8, `cream shifted too far: ${c}`);
    // Cream is still warmer than it is blue.
    assert.ok(c[0] > c[2], `cream lost its warmth: ${c}`);

    // A colorful backdrop (red table) is not treated as a lighting cast.
    const table = rgba(W, H, [180, 70, 50, 255]);
    paintRect(table, W, 12, 12, 28, 28, [200, 180, 145]);
    const tableOut = grayWorldBalance(table, W, H, mask);
    const t = at(tableOut, W, 20, 20);
    assert.deepEqual(t, [200, 180, 145, 255]);
  });

  it("falls back to the basic clean-up with a kind message when the model fails", async () => {
    const data = rgba(16, 16, [128, 128, 128, 255]);
    const result = await studioOrBasic(
      { data, width: 16, height: 16 },
      { background: "white" },
      {
        inferMask: async () => { throw new Error("wasm exploded"); },
        cleanup: async () => "data:image/jpeg;base64,BASIC",
        dataUrl: "data:image/jpeg;base64,ORIG"
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.fallback, true);
    assert.equal(result.kind, "basic");
    assert.equal(result.dataUrl, "data:image/jpeg;base64,BASIC");
    assert.equal(result.message, STUDIO_FALLBACK_MSG);
    assert.match(result.error, /wasm exploded/);
  });

  it("falls back when the matte is empty (no item found)", async () => {
    const data = rgba(16, 16, [128, 128, 128, 255]);
    const result = await studioOrBasic(
      { data, width: 16, height: 16 },
      { background: "white", edge: 32, straighten: false, shadow: false },
      {
        inferMask: async () => new Float32Array(16 * 16), // all zeros
        cleanup: async () => "data:image/jpeg;base64,BASIC",
        dataUrl: "data:image/jpeg;base64,ORIG"
      }
    );
    assert.equal(result.fallback, true);
    assert.equal(result.kind, "basic");
    assert.equal(result.code, "no-subject");
  });

  it("returns a studio result when inferMask succeeds, and upsamples a 320 mask", async () => {
    const W = 40, H = 40;
    const data = rgba(W, H, [0, 160, 0, 255]);
    const full = circleMask(W, H, 20, 20, 10);
    for (let i = 0; i < full.length; i++) if (full[i] > 0.5) {
      data[i * 4] = 200; data[i * 4 + 1] = 20; data[i * 4 + 2] = 20;
    }
    const result = await studioOrBasic(
      { data, width: W, height: H },
      { background: "white", shadow: false, straighten: false, center: true, aspect: "square", edge: 50, padding: 0.1 },
      {
        inferMask: async () => ({ mask: upsampleMask(full, W, H, 320, 320), width: 320, height: 320 })
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallback, false);
    assert.equal(result.kind, "studio");
    assert.equal(result.width, 50);
    const mid = at(result.data, 50, 25, 25);
    assert.ok(mid[0] > 140 && mid[1] < 140 && mid[0] > mid[1], `center ${mid}`);
  });

  it("keeps the original pixels when a studio photo is applied, and can restore them", () => {
    const photos = [{ dataUrl: "data:image/png;base64,ORIG", addedAt: 1 }];
    const cleaned = applyCleanedPhoto(photos, 0, "data:image/png;base64,NEW", 2, { kind: "studio" });
    assert.equal(cleaned[0].originalDataUrl, "data:image/png;base64,ORIG");
    assert.equal(cleaned[0].dataUrl, "data:image/png;base64,NEW");
    assert.equal(cleaned[0].cleaned, "studio");
    assert.equal(photoHasOriginal(cleaned[0]), true);
    const back = restorePhotoOriginal(cleaned, 0);
    assert.equal(back[0].dataUrl, "data:image/png;base64,ORIG");
    // Default kind stays "basic" so older callers and tests stay valid.
    const basic = applyCleanedPhoto(photos, 0, "data:image/png;base64,B", 3);
    assert.equal(basic[0].cleaned, "basic");
  });

  it("normalizes a cover-photo check and keeps it optional and labeled", () => {
    const n = normalizeCoverCheck({ tip: "Lead with the front.", cover: "2", missing: "tag" });
    assert.equal(n.tip, "Lead with the front.");
    assert.equal(n.cover, 2);
    assert.equal(n.missing, "tag");
    assert.equal(n.model, "gpt-4o-mini");
    assert.match(COVER_CHECK_NOTE, /optional/i);
    assert.match(COVER_CHECK_NOTE, /gpt-4o-mini/);
    assert.match(COVER_CHECK_NOTE, /suggestion, not a requirement/);
    assert.match(COVER_CHECK_NOTE, /tag, sole, back, or label/);
    assert.match(COVER_CHECK_SYSTEM, /Do not invent damage/);
    assert.equal(COVER_CHECK_LABEL, "Cover photo check");
  });

  it("does not put last names, emails, or keys in the studio modules", () => {
    const files = [
      "app/js/core/studio.js",
      "app/js/core/segment.js",
      "app/js/core/studio-worker.js",
      "app/js/ui/cleanup.js",
      "app/vendor/studio/NOTICE.txt"
    ];
    const deny = /Nootbaar|KennethNootbaar6|sk-[A-Za-z0-9]/;
    for (const f of files) {
      let src;
      try { src = readFileSync(join(root, f), "utf8"); } catch { continue; }
      if (f.endsWith(".onnx")) continue;
      assert.doesNotMatch(src, deny, f);
    }
  });
});


describe("v0.7.0 wiring, version, and service worker", () => {
  it("bumps the app, package, and service worker to v0.7.4 and caches studio modules but not the model", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "0.7.4");
    const main = readFileSync(join(root, "app/js/main.js"), "utf8");
    assert.match(main, /export const VERSION = "0\.7\.4"/);
    const sw = readFileSync(join(root, "app/sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.7\.4/);
    assert.match(sw, /js\/core\/studio\.js/);
    assert.match(sw, /js\/core\/segment\.js/);
    assert.match(sw, /js\/core\/studio-worker\.js/);
    assert.doesNotMatch(sw, /\.onnx/);
    assert.doesNotMatch(sw, /u2netp/);
    assert.doesNotMatch(sw, /media\/intro\.mp4/);
  });

  it("makes Make it look pro the main button on Add and Item, with basic as a smaller option in the sheet", () => {
    const add = readFileSync(join(root, "app/js/ui/screens/add.js"), "utf8");
    const item = readFileSync(join(root, "app/js/ui/screens/item.js"), "utf8");
    const cleanup = readFileSync(join(root, "app/js/ui/cleanup.js"), "utf8");
    const settings = readFileSync(join(root, "app/js/ui/screens/settings.js"), "utf8");
    const guide = readFileSync(join(root, "app/js/core/guide.js"), "utf8");
    for (const src of [add, item]) {
      assert.match(src, /STUDIO_BUTTON/);
      assert.match(src, /onApplyAll/);
      assert.doesNotMatch(src, /Clean up photos \(basic\)/);
    }
    assert.match(cleanup, /STUDIO_BUTTON/);
    assert.match(cleanup, /STUDIO_BASIC_LINK/);
    assert.match(cleanup, /Do all photos/);
    assert.match(cleanup, /Try again/);
    assert.match(cleanup, /Use basic/);
    assert.match(cleanup, /Cover photo check|COVER_CHECK_LABEL/);
    assert.match(cleanup, /ba-range/);
    assert.match(settings, /STUDIO_NOTE/);
    assert.match(guide, /Make it look pro/);
    const walk = readFileSync(join(root, "app/js/core/walkthrough.js"), "utf8");
    assert.match(walk, /Make it look pro/);
    assert.equal((walk.match(/id:\s*"/g) || []).length, 4);
  });
});
