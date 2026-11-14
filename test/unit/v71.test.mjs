import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  STUDIO_MAX_SCALE, STUDIO_EXPORT_EDGE, STUDIO_ERODE_PX, STUDIO_FEATHER_PX,
  centerTransform, renderStudio, guidedRefine, erodeMask, featherMask,
  decontaminateEdges, refineMaskAtFullRes, subjectPadBox, cropRGBA, pasteMask,
  foregroundBounds, upsampleMask, closeMask, dilateMask, reconnectComponents, subjectTiles, convexHull, pointInHull, maskConvexHull, keepInsideHull, columnEnvelope, keepInsideEnvelope, STUDIO_MAX_COMPOSITE_EDGE, scalePx
} from "../../app/js/core/studio.js";

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
function rectMask(W, H, x, y, w, h, v = 1) {
  const m = new Float32Array(W * H);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) m[yy * W + xx] = v;
  }
  return m;
}

describe("v0.7.4 never upscale past the source", () => {
  it("caps scale at 1.0 by default, and pads more instead of enlarging", () => {
    assert.equal(STUDIO_MAX_SCALE, 1);
    const b = { x: 10, y: 10, w: 40, h: 30 };
    const xf = centerTransform(b, 2000, 2000, 0.10);
    assert.equal(xf.scale, 1);
    assert.equal(xf.dstW, 40);
    assert.equal(xf.dstH, 30);
    // Centered, with lots of padding — not blown up to fill 1600px.
    assert.ok(Math.abs(xf.dstX - (2000 - 40) / 2) < 1e-9);
    assert.ok(xf.dstX > 700);
  });

  it("still shrinks a large item to fit the padded frame (scale < 1 is fine)", () => {
    const b = { x: 0, y: 0, w: 1800, h: 1800 };
    const xf = centerTransform(b, 2000, 2000, 0.10);
    assert.ok(xf.scale < 1);
    assert.ok(xf.dstW <= 1600 + 1e-9);
  });

  it("renderStudio keeps a small item at 1:1 pixels, not a 2000px blow-up", () => {
    const W = 200, H = 200;
    const data = rgba(W, H, [40, 140, 40, 255]); // green "grass"
    const mask = rectMask(W, H, 80, 80, 40, 30);
    for (let y = 80; y < 110; y++) {
      for (let x = 80; x < 120; x++) {
        const o = (y * W + x) * 4;
        data[o] = 180; data[o + 1] = 50; data[o + 2] = 40; // rust-red item
      }
    }
    const out = renderStudio({ data, width: W, height: H, mask }, {
      background: "white", shadow: false, straighten: false, center: true,
      aspect: "square", edge: 400, padding: 0.10, refine: false, decontaminate: false
    });
    assert.equal(out.width, 400);
    assert.equal(out.height, 400);
    // The item is 40×30 in the source. In the 400 frame it must stay ≤ 40×30.
    const framed = foregroundBounds(
      Float32Array.from({ length: 400 * 400 }, (_, i) => {
        const o = i * 4;
        const r = out.data[o], g = out.data[o + 1], b = out.data[o + 2];
        return (r < 250 || g < 250 || b < 250) ? 1 : 0;
      }),
      400, 400, { threshold: 0.5 }
    );
    assert.ok(framed, "expected a subject");
    assert.ok(framed.w <= 42, `item was widened to ${framed.w} (source 40)`);
    assert.ok(framed.h <= 32, `item was tallened to ${framed.h} (source 30)`);
    // Center is the rust-red item, sharp (not a blurry upscale of grass+item).
    const mid = at(out.data, 400, 200, 200);
    assert.ok(mid[0] > 140 && mid[1] < 160 && mid[0] > mid[1], `center ${mid}`);
  });
});

describe("v0.7.4 mask quality at full resolution", () => {
  it("erodes a solid square by about the requested radius", () => {
    const W = 40, H = 40;
    const m = rectMask(W, H, 10, 10, 20, 20);
    const e = erodeMask(m, W, H, 2);
    // Interior still 1, but a 2px border of the original square is gone.
    assert.equal(e[20 * W + 20], 1);
    assert.equal(e[10 * W + 10], 0); // original corner
    assert.equal(e[11 * W + 11], 0);
    assert.equal(e[12 * W + 12], 1);
    const before = [...m].filter(v => v > 0.5).length;
    const after = [...e].filter(v => v > 0.5).length;
    assert.ok(after < before);
  });

  it("feathers a hard edge into a 1–2px soft ramp", () => {
    const W = 30, H = 10;
    const m = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 15; x < W; x++) m[y * W + x] = 1;
    const f = featherMask(m, W, H, 1.5);
    // A few pixels left of the cut now have a mid alpha, and the far sides stay put.
    assert.ok(f[5] < 0.05);
    assert.ok(f[25] > 0.95);
    const mid = f[14]; // just left of the original edge
    assert.ok(mid > 0.05 && mid < 0.95, `feather mid ${mid}`);
  });

  it("snaps a blurry upsampled mask to a sharp color edge (guided filter)", () => {
    const W = 32, H = 32;
    // Left half green background, right half red item — a hard photo edge at x=16.
    const data = rgba(W, H, [20, 180, 20, 255]);
    for (let y = 0; y < H; y++) {
      for (let x = 16; x < W; x++) {
        const o = (y * W + x) * 4;
        data[o] = 200; data[o + 1] = 30; data[o + 2] = 30;
      }
    }
    // A blurry mask that leaks 4px into the green.
    const m = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // ramp from 0 at x=8 to 1 at x=20
        let t = (x - 8) / 12;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        m[y * W + x] = t;
      }
    }
    const q = guidedRefine(m, data, W, H, { radius: 4, eps: 0.0008 });
    // Measure just inside each side of the real color edge at x=16.
    const left = q[16 * W + 14];
    const right = q[16 * W + 18];
    const origLeft = m[16 * W + 14];
    const origRight = m[16 * W + 18];
    const origContrast = origRight - origLeft;
    const newContrast = right - left;
    assert.ok(newContrast > origContrast + 0.15, `contrast ${newContrast} vs ${origContrast} (L ${left} R ${right})`);
    assert.ok(left < 0.4, `left of edge should be low, got ${left}`);
    assert.ok(right > 0.7, `right of edge should be high, got ${right}`);
  });

  it("decontaminates a wood-colored fringe by sampling inward", () => {
    const W = 24, H = 16;
    const data = rgba(W, H, [140, 90, 40, 255]); // brown "wood"
    const mask = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 10; x < W; x++) {
        const o = (y * W + x) * 4;
        if (x >= 12) {
          data[o] = 230; data[o + 1] = 220; data[o + 2] = 200; // cream item
          mask[y * W + x] = 1;
        } else {
          // Fringe: brown still showing, partial alpha
          data[o] = 160; data[o + 1] = 120; data[o + 2] = 80;
          mask[y * W + x] = 0.4;
        }
      }
    }
    const out = decontaminateEdges(data, mask, W, H, { lo: 0.05, hi: 0.9, step: 3 });
    const fringe = at(out, W, 10, 8);
    // Inward is cream, so the brown should be pulled toward cream.
    assert.ok(fringe[0] > 180 && fringe[2] > 140, `fringe still brown: ${fringe}`);
    // Solid interior is untouched.
    const inner = at(out, W, 18, 8);
    assert.deepEqual(inner, [230, 220, 200, 255]);
  });

  it("refineMaskAtFullRes cuts a halo without smoothing interior texture", () => {
    const W = 48, H = 48;
    const data = rgba(W, H, [30, 150, 40, 255]); // grass
    // A rusty rectangle with a distinctive checker of rust spots — must survive.
    const mask = new Float32Array(W * H);
    for (let y = 12; y < 36; y++) {
      for (let x = 12; x < 36; x++) {
        mask[y * W + x] = 1;
        const o = (y * W + x) * 4;
        const rust = ((x + y) % 3 === 0);
        data[o] = rust ? 160 : 50;
        data[o + 1] = rust ? 80 : 120;
        data[o + 2] = rust ? 40 : 50;
      }
    }
    // A 2px grass halo just outside, with mid alpha leaking in 1px.
    for (let y = 11; y < 37; y++) {
      for (let x = 11; x < 37; x++) {
        if (x >= 12 && x < 36 && y >= 12 && y < 36) continue;
        mask[y * W + x] = 0.45;
      }
    }
    const before = at(data, W, 20, 20);
    const { mask: m, data: d } = refineMaskAtFullRes(mask, data, W, H, {
      matte: "default", erodePx: 1, featherPx: 1, decontaminate: true
    });
    const after = at(d, W, 20, 20);
    assert.deepEqual(after, before, "interior texture must not change");
    // The 1px halo just outside the original item should be nearly gone.
    assert.ok(m[11 * W + 20] < 0.28, `top halo ${m[11 * W + 20]}`);
    // Interior stays solid.
    assert.ok(m[24 * W + 24] > 0.95, `interior ${m[24 * W + 24]}`);
  });



  it("reconnects two sizable pieces across a short gap, without filling a hole inside one piece", () => {
    const W = 80, H = 30;
    const m = new Float32Array(W * H);
    // Left plate and main body, 6px gap, both large.
    for (let y = 6; y < 24; y++) {
      for (let x = 2; x < 22; x++) m[y * W + x] = 1;
      for (let x = 28; x < 76; x++) m[y * W + x] = 1;
    }
    // A real hole inside the body should stay open.
    for (let y = 12; y < 18; y++) for (let x = 48; x < 56; x++) m[y * W + x] = 0;
    const r = reconnectComponents(m, W, H, { threshold: 0.35, maxGap: 8, minArea: 50 });
    assert.ok(r[15 * W + 24] > 0.9, `bridge missing: ${r[15 * W + 24]}`);
    assert.ok(r[15 * W + 25] > 0.9);
    assert.equal(r[15 * W + 52], 0, "interior hole was filled");
  });

  it("closes a thin gap so a broken piece is joined back to the item", () => {
    const W = 40, H = 16;
    const m = new Float32Array(W * H);
    // Two solid bars with a 2px gap at x=18,19 — like a thin metal bar the model missed.
    for (let y = 4; y < 12; y++) {
      for (let x = 2; x < 18; x++) m[y * W + x] = 1;
      for (let x = 20; x < 38; x++) m[y * W + x] = 1;
    }
    assert.equal(m[8 * W + 18], 0);
    const c = closeMask(m, W, H, 2);
    assert.ok(c[8 * W + 18] > 0.9, `gap still open: ${c[8 * W + 18]}`);
    assert.ok(c[8 * W + 19] > 0.9);
    // The original bars are still solid.
    assert.ok(c[8 * W + 10] > 0.9);
    assert.ok(c[8 * W + 30] > 0.9);

  });

  it("scales pixel radii with resolution and keeps a high composite cap", () => {
    assert.equal(STUDIO_MAX_COMPOSITE_EDGE, 4096);
    assert.equal(scalePx(1, 2048, 2048), 1);
    assert.equal(scalePx(1, 4096, 4096), 2);
    assert.equal(scalePx(4, 4096, 2048), 8);
  });

  it("pastes a crop mask back into a full-size canvas", () => {
    const box = subjectPadBox({ x: 10, y: 10, w: 10, h: 10 }, 40, 40, 0.2, 4);
    assert.ok(box.x <= 10 && box.y <= 10);
    assert.ok(box.x + box.w >= 20 && box.y + box.h >= 20);
    const src = new Float32Array(4).fill(1);
    const dest = new Float32Array(16);
    pasteMask(dest, 4, 4, src, 2, 2, 1, 1);
    assert.equal(dest[1 * 4 + 1], 1);
    assert.equal(dest[0], 0);
    const cropped = cropRGBA(rgba(8, 8, [1, 2, 3, 255]), 8, 8, { x: 2, y: 2, w: 3, h: 3 });
    assert.equal(cropped.width, 3);
    assert.deepEqual(at(cropped.data, 3, 0, 0), [1, 2, 3, 255]);
  });
});

describe("subjectTiles: overlapping square tiles for a wide or tall item", () => {
  it("returns no tiles for a compact, nearly-square crop", () => {
    const tiles = subjectTiles({ x: 10, y: 10, w: 300, h: 280 }, 400, 400);
    assert.deepEqual(tiles, []);
  });

  it("splits a wide crop into overlapping tiles that cover the box", () => {
    const box = { x: 0, y: 600, w: 1153, h: 740 };
    const tiles = subjectTiles(box, 1153, 2048);
    assert.ok(tiles.length >= 2 && tiles.length <= 4);
    // Each tile is roughly square (side ≈ the short side of the box).
    for (const t of tiles) {
      assert.ok(t.w >= 16 && t.h >= 16);
      assert.ok(t.x >= 0 && t.y >= 0);
      assert.ok(t.x + t.w <= 1153 && t.y + t.h <= 2048);
      assert.ok(Math.abs(t.h - box.h) <= 1, "tiles share the box height");
    }
    // Union covers the full box width.
    const left = Math.min(...tiles.map(t => t.x));
    const right = Math.max(...tiles.map(t => t.x + t.w));
    assert.equal(left, box.x);
    assert.equal(right, box.x + box.w);
    // Neighbors overlap.
    const ordered = [...tiles].sort((a, b) => a.x - b.x);
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.ok(ordered[i].x + ordered[i].w > ordered[i + 1].x, "tiles overlap");
    }
  });

  it("splits a tall crop vertically", () => {
    const tiles = subjectTiles({ x: 20, y: 0, w: 200, h: 900 }, 400, 900);
    assert.ok(tiles.length >= 2);
    const ordered = [...tiles].sort((a, b) => a.y - b.y);
    assert.equal(ordered[0].y, 0);
    assert.equal(ordered[ordered.length - 1].y + ordered[ordered.length - 1].h, 900);
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.ok(ordered[i].y + ordered[i].h > ordered[i + 1].y);
    }
  });

  it("caps the number of tiles and still covers the full box", () => {
    const box = { x: 0, y: 0, w: 2000, h: 400 };
    const tiles = subjectTiles(box, 2000, 400, { maxTiles: 4 });
    assert.ok(tiles.length >= 2 && tiles.length <= 4);
    const left = Math.min(...tiles.map(t => t.x));
    const right = Math.max(...tiles.map(t => t.x + t.w));
    assert.equal(left, 0);
    assert.equal(right, 2000);
    // No gaps: walking from the left, each pixel is in some tile.
    const covered = new Uint8Array(2000);
    for (const t of tiles) {
      for (let x = t.x; x < t.x + t.w; x++) covered[x] = 1;
    }
    assert.ok(covered.every(v => v === 1), "no gaps in coverage");
  });
});

describe("pasteMask max mode keeps the stronger value", () => {
  it("takes the max in the destination region and leaves the rest alone", () => {
    const dest = new Float32Array(16);
    dest[1 * 4 + 1] = 0.4;
    dest[1 * 4 + 2] = 0.9;
    dest[0] = 0.3;
    const src = new Float32Array([0.8, 0.2, 0.1, 0.5]);
    pasteMask(dest, 4, 4, src, 2, 2, 1, 1, { mode: "max" });
    assert.ok(Math.abs(dest[1 * 4 + 1] - 0.8) < 1e-6); // 0.4 vs 0.8
    assert.ok(Math.abs(dest[1 * 4 + 2] - 0.9) < 1e-6); // 0.9 vs 0.2
    assert.ok(Math.abs(dest[0] - 0.3) < 1e-6);          // outside, untouched
  });
});

describe("convex hull keeps a bay fill and drops clutter under the item", () => {
  it("builds a CCW hull and tests points inside and out", () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]);
    assert.ok(hull.length >= 4);
    assert.ok(pointInHull(5, 5, hull));
    assert.ok(pointInHull(0, 0, hull));
    assert.ok(!pointInHull(11, 5, hull));
    assert.ok(!pointInHull(5, -1, hull));
  });

  it("keeps a fill in the bay of a C-shape and drops a blob below it", () => {
    const W = 40, H = 40;
    const base = new Float32Array(W * H);
    // Two vertical bars joined at the top: a C opening downward-right would
    // be wrong — we want a C opening to the side, like a missing side plate.
    // Left bar x=4..10, y=8..30; right bar x=24..30, y=8..30; top x=4..30, y=8..14.
    const fill = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) base[y * W + x] = 1;
    };
    fill(4, 8, 10, 30);
    fill(24, 8, 30, 30);
    fill(4, 8, 30, 14);
    const hull = maskConvexHull(base, W, H);
    const added = new Float32Array(base);
    // Bay between the bars (inside the hull): a side plate.
    for (let y = 16; y <= 26; y++) for (let x = 12; x <= 22; x++) added[y * W + x] = 1;
    // Clutter under the item (outside the hull).
    for (let y = 33; y <= 38; y++) for (let x = 12; x <= 28; x++) added[y * W + x] = 1;
    const out = keepInsideHull(added, W, H, hull, base);
    assert.ok(out[20 * W + 17] > 0.5, "bay fill is kept");
    assert.ok(out[35 * W + 20] < 0.1, "clutter under the item is dropped");
    assert.equal(out[10 * W + 6], 1, "original bar is untouched");
  });
});

describe("column envelope drops clutter under a blade whose ends sit lower", () => {
  it("keeps a bay fill and drops a pile below a higher middle edge", () => {
    const W = 50, H = 40;
    const base = new Float32Array(W * H);
    const fill = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) base[y * W + x] = 1;
    };
    // Ends sit lower (to y=32) than the middle (to y=22), like a blade
    // whose side plates rest on the ground and whose moldboard sits on leaves.
    // Gap at x=9..19 is the missing side plate.
    fill(2, 8, 8, 32);    // left end, low
    fill(40, 8, 48, 32);  // right end, low
    fill(20, 8, 40, 22);  // middle, higher bottom, starts after a gap
    fill(2, 8, 48, 12);   // top bar (joins them at the top)
    const env = columnEnvelope(base, W, H);
    assert.ok(base[18 * W + 13] < 0.5, "gap is empty in the baseline");
    const added = new Float32Array(base);
    // Side-plate bay: in the gap, inside the interpolated y-range.
    for (let y = 14; y <= 26; y++) for (let x = 10; x <= 18; x++) added[y * W + x] = 1;
    // Leaves under the middle, below the local bottom (y=22) but above the
    // convex-hull line between the low ends (y=32).
    for (let y = 24; y <= 31; y++) for (let x = 22; x <= 36; x++) added[y * W + x] = 1;
    const out = keepInsideEnvelope(added, W, H, env, base, { pad: 2 });
    assert.ok(out[18 * W + 13] > 0.5, "bay / side plate is kept");
    assert.ok(out[28 * W + 28] < 0.1, "leaves under the middle are dropped");
    assert.equal(out[10 * W + 6], 1, "original left end is untouched");
  });
});

describe("v0.7.4 version", () => {
  it("exports the new quality knobs and bumps the app to 0.9.0", () => {
    assert.equal(STUDIO_ERODE_PX, 1);
    assert.ok(STUDIO_FEATHER_PX >= 1 && STUDIO_FEATHER_PX <= 2);
    assert.equal(STUDIO_EXPORT_EDGE, 2000);
    assert.equal(STUDIO_MAX_SCALE, 1);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const main = readFileSync(join(root, "app/js/main.js"), "utf8");
    const sw = readFileSync(join(root, "app/sw.js"), "utf8");
    assert.equal(pkg.version, "0.9.0");
    assert.match(main, /export const VERSION = "0\.9\.0"/);
    assert.match(sw, /flip-helper-v0\.9\.0/);
  });
});
