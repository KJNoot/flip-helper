import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  gridSpec, parseCell, parseCellRange, cellsToBox, padBox, mapLocalToPhoto,
  clampBox, parseGridLocate, parseVerify, applyVerifiedBoxes,
  gridLocateUserText, verifyUserText, requestGridLocate, requestBoxVerify,
  locateAndVerify, GRID_SYSTEM, VERIFY_SYSTEM, GRID_MAX_ITEMS,
  BOX_DROPPED_NOTE, LOCATE_MODEL
} from "../../app/js/core/locate.js";
import { runLookDeeper, LOOK_DEEPER_NOTE, LOOK_DEEPER_MODEL } from "../../app/js/core/lookdeeper.js";
import { attachThumbs, lookCardHtml, normalizeLookItem } from "../../app/js/core/secondlook.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("v0.7.4 grid cells map to a photo box in code", () => {
  it("uses a 6×8 grid on a tall photo and an 8×6 grid on a wide one", () => {
    const tall = gridSpec(2252, 4000);
    assert.equal(tall.cols, "ABCDEF");
    assert.equal(tall.rows, 8);
    const wide = gridSpec(4000, 2252);
    assert.equal(wide.cols, "ABCDEFGH");
    assert.equal(wide.rows, 6);
  });

  it("parses a cell and an inclusive range, including a few messy forms", () => {
    const g = gridSpec(100, 200);
    assert.deepEqual(parseCell("b4", g), { col: 1, row: 3, label: "B4" });
    assert.equal(parseCell("Z9", g), null);
    assert.equal(parseCell("A0", g), null);
    const r = parseCellRange("B4-C6", g);
    assert.deepEqual(r, { from: "B4", to: "C6" });
    assert.deepEqual(parseCellRange("c3 to d5", g), { from: "c3", to: "d5" });
    assert.deepEqual(parseCellRange(["E2", "E3", "F3"], g), { from: "E2", to: "F3" });
    assert.deepEqual(parseCellRange({ from: "A1", to: "B2" }, g), { from: "A1", to: "B2" });
    assert.deepEqual(parseCellRange({ cell: "C4" }, g), { from: "C4", to: "C4" });
  });

  it("maps a cell range to photo-space fractions without trusting raw coords", () => {
    const g = gridSpec(100, 200); // 6 cols, 8 rows
    const box = cellsToBox("B4", "C6", g);
    // B is col 1, C is col 2; rows 4–6 are 3–5 (0-based)
    assert.ok(Math.abs(box.x - 1 / 6) < 1e-9);
    assert.ok(Math.abs(box.y - 3 / 8) < 1e-9);
    assert.ok(Math.abs(box.w - 2 / 6) < 1e-9);
    assert.ok(Math.abs(box.h - 3 / 8) < 1e-9);
    // A single cell A1 is the top-left sixth-by-eighth
    const a1 = cellsToBox("A1", "A1", g);
    assert.ok(Math.abs(a1.x) < 1e-9 && Math.abs(a1.y) < 1e-9);
    assert.ok(Math.abs(a1.w - 1 / 6) < 1e-9 && Math.abs(a1.h - 1 / 8) < 1e-9);
    // Reversed corners still work
    const rev = cellsToBox("C6", "B4", g);
    assert.deepEqual(rev, box);
  });

  it("pads a box inside the photo and never invents pixels past the edge", () => {
    const b = padBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.1);
    assert.ok(b.w > 0.2 && b.h > 0.2);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9);
    const edge = padBox({ x: 0, y: 0, w: 0.2, h: 0.2 }, 0.5);
    assert.equal(edge.x, 0);
    assert.equal(edge.y, 0);
    assert.ok(edge.w <= 1 && edge.h <= 1);
  });

  it("maps a tighter verify box from a crop back to the photograph", () => {
    const crop = { x: 0.2, y: 0.4, w: 0.5, h: 0.4 };
    const local = { x: 0.2, y: 0.25, w: 0.6, h: 0.5 };
    const photo = mapLocalToPhoto(local, crop);
    assert.ok(Math.abs(photo.x - (0.2 + 0.2 * 0.5)) < 1e-9);
    assert.ok(Math.abs(photo.y - (0.4 + 0.25 * 0.4)) < 1e-9);
    assert.ok(Math.abs(photo.w - 0.6 * 0.5) < 1e-9);
    assert.ok(Math.abs(photo.h - 0.5 * 0.4) < 1e-9);
  });
});

describe("v0.7.4 verify drops a wrong box rather than showing one", () => {
  const g = gridSpec(100, 200);
  const items = [
    { name: "Riding mower", where: "far back left" },
    { name: "Stack of chairs", where: "middle left" },
    { name: "Cty J Rd street sign", where: "left wall" }
  ];

  it("parses a grid locate reply into cell boxes, and marks missing items", () => {
    const json = {
      items: [
        { index: 1, name: "Riding mower", from: "A5", to: "B6", missing: false },
        { index: 2, name: "Stack of chairs", missing: true },
        { index: 3, name: "Cty J Rd street sign", cell: "B3-B4" }
      ]
    };
    const out = parseGridLocate(json, items, g);
    assert.ok(out[0].gridBox);
    assert.ok(Math.abs(out[0].gridBox.x - 0) < 1e-9);
    assert.equal(out[1].locateMissing, true);
    assert.equal(out[1].gridBox, null);
    assert.ok(out[2].gridBox);
    assert.equal(out[2].cells, "B3-B4");
  });

  it("keeps a verified tighter box and DROPS a box that fails the check", () => {
    const located = [
      { name: "Riding mower", gridBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 } },
      { name: "Stack of chairs", gridBox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } },
      { name: "Empty wall", locateMissing: true }
    ];
    const crops = [
      { index: 1, name: "Riding mower", frac: { x: 0.05, y: 0.15, w: 0.4, h: 0.4 }, dataUrl: "data:image/jpeg;base64,x" },
      { index: 2, name: "Stack of chairs", frac: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }, dataUrl: "data:image/jpeg;base64,y" }
    ];
    const checks = [
      { index: 1, name: "Riding mower", found: true, centered: true, localBox: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } },
      { index: 2, name: "Stack of chairs", found: false, localBox: null }
    ];
    const out = applyVerifiedBoxes(located, checks, crops);
    // Mower: tighter box mapped from the crop
    assert.equal(out[0].boxVerified, true);
    assert.equal(out[0].boxDropped, false);
    assert.ok(out[0].box);
    const expected = mapLocalToPhoto({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, crops[0].frac);
    assert.ok(Math.abs(out[0].box.x - expected.x) < 1e-9);
    // Chairs: failed verify → box dropped, item kept
    assert.equal(out[1].name, "Stack of chairs");
    assert.equal(out[1].box, null);
    assert.equal(out[1].boxDropped, true);
    assert.equal(out[1].boxVerified, false);
    assert.equal(out[1].boxStatus, "unknown");
    assert.equal(out[1].thumbDataUrl, "");
    // Already-missing locate: also dropped
    assert.equal(out[2].boxDropped, true);
    assert.equal(out[2].box, null);
  });

  it("maps a tighter box from crop-grid cells only when the item is centered; otherwise keeps the padded crop", () => {
    const located = [
      { name: "Riding mower", gridBox: { x: 0.0, y: 0.2, w: 0.4, h: 0.4 }, box: { x: 0.0, y: 0.2, w: 0.4, h: 0.4 } },
      { name: "Stack of tires", gridBox: { x: 0.0, y: 0.0, w: 0.3, h: 0.3 }, box: { x: 0.0, y: 0.0, w: 0.3, h: 0.3 } },
      { name: "Canoe", gridBox: { x: 0.2, y: 0.4, w: 0.5, h: 0.4 }, box: { x: 0.2, y: 0.4, w: 0.5, h: 0.4 } }
    ];
    const crops = [
      { index: 1, name: "Riding mower", frac: { x: 0.0, y: 0.15, w: 0.5, h: 0.5 }, cropSpec: { cols: "ABCD", rows: 4 }, dataUrl: "data:image/jpeg;base64,x" },
      { index: 2, name: "Stack of tires", frac: { x: 0.0, y: 0.0, w: 0.4, h: 0.35 }, cropSpec: { cols: "ABCD", rows: 4 }, dataUrl: "data:image/jpeg;base64,y" },
      { index: 3, name: "Canoe", frac: { x: 0.15, y: 0.35, w: 0.6, h: 0.5 }, cropSpec: { cols: "ABCD", rows: 4 }, dataUrl: "data:image/jpeg;base64,z" }
    ];
    const checks = parseVerify({
      checks: [
        { index: 1, name: "Riding mower", found: true, centered: false, from: "C3", to: "D4", box: { x: 0.01, y: 0.01, w: 0.1, h: 0.1 } },
        { index: 2, name: "Stack of tires", found: true, centered: false },
        { index: 3, name: "Canoe", found: true, centered: true, from: "A2", to: "D4" }
      ]
    }, crops);
    // Raw coords 0.01,0.01 were ignored; cells were parsed
    assert.ok(checks[0].localBox);
    assert.ok(Math.abs(checks[0].localBox.x - 0.5) < 1e-9);
    const out = applyVerifiedBoxes(located, checks, crops);
    // Mower: found but not centered → keep the padded crop, not the small cell guess
    assert.equal(out[0].boxVerified, true);
    assert.ok(Math.abs(out[0].box.x - crops[0].frac.x) < 1e-9);
    assert.ok(Math.abs(out[0].box.w - crops[0].frac.w) < 1e-9);
    assert.equal(out[0].boxStatus, "verified-loose");
    // Tires: found, no cells → padded crop
    assert.equal(out[1].boxVerified, true);
    assert.equal(out[1].boxDropped, false);
    assert.ok(Math.abs(out[1].box.x - crops[1].frac.x) < 1e-9);
    // Canoe: centered + cells → tighter box mapped from A2–D4 (rows 2–4 of 4 = y 0.25, h 0.75)
    const expected = mapLocalToPhoto(checks[2].localBox, crops[2].frac);
    assert.ok(Math.abs(out[2].box.x - expected.x) < 1e-9);
    assert.equal(out[2].boxStatus, "verified");
    assert.equal(out[2].boxCentered, true);
  });


  it("asks the model for grid cells and a yes/no verify, not raw photo coordinates", () => {
    assert.match(GRID_SYSTEM, /labeled grid/i);
    assert.match(GRID_SYSTEM, /Do not guess a range on empty wall/);
    assert.match(GRID_SYSTEM, /do not estimate coordinates/i);
    assert.match(VERIFY_SYSTEM, /Set found to true if the named item is visible/i);
    assert.match(VERIFY_SYSTEM, /Empty wall, floor, ceiling/);
    assert.match(VERIFY_SYSTEM, /Do not estimate raw coordinates/);
    assert.match(VERIFY_SYSTEM, /inclusive cell range/);
    assert.match(VERIFY_SYSTEM, /If you are not sure, found is false/);
    assert.match(VERIFY_SYSTEM, /WHOLE crop/i);
    const text = gridLocateUserText([{ name: "Fireplace insert", where: "center" }], gridSpec(100, 200));
    assert.match(text, /columns A, B, C, D, E, F/);
    assert.match(text, /Fireplace insert/);
    assert.match(text, /from": "B4"/);
    const vtext = verifyUserText([{ index: 1, name: "Cty J Rd street sign" }]);
    assert.match(vtext, /Cty J Rd street sign/);
    assert.match(vtext, /found to false/);
    assert.match(vtext, /columns A, B, C, D/);
    assert.doesNotMatch(vtext, /"box": \{ "x"/);
  });
});

describe("v0.7.4 request and runLookDeeper wiring", () => {
  it("requestGridLocate sends one gpt-4o high-detail image and never puts the key in the body", async () => {
    let body;
    const fetchImpl = async (url, opts) => {
      body = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            items: [{ index: 1, name: "Canoe", from: "B4", to: "E7", missing: false }]
          }) } }],
          usage: { prompt_tokens: 1000, completion_tokens: 80 },
          model: "gpt-4o"
        })
      };
    };
    const { items, usage } = await requestGridLocate({
      image: { dataUrl: "data:image/jpeg;base64,xx", width: 100, height: 200 },
      items: [{ name: "Canoe", where: "center" }],
      key: "sk-test-not-a-real-key-xxxx",
      fetchImpl,
      spec: gridSpec(100, 200)
    });
    assert.equal(body.model, "gpt-4o");
    assert.equal(body.messages[1].content.some(c => c.type === "image_url" && c.image_url.detail === "high"), true);
    const raw = JSON.stringify(body);
    assert.doesNotMatch(raw, /sk-test-not-a-real-key/);
    assert.ok(items[0].gridBox);
    assert.equal(items[0].cells, "B4-E7");
    assert.equal(usage.prompt_tokens, 1000);
  });

  it("requestBoxVerify records found:false so a bad crop is dropped", async () => {
    const fetchImpl = async (url, opts) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          checks: [
            { index: 1, name: "Tires", found: false },
            { index: 2, name: "Canoe", found: true, centered: true, from: "A1", to: "D4" }
          ]
        }) } }],
        usage: { prompt_tokens: 800, completion_tokens: 60 }
      })
    });
    const { checks } = await requestBoxVerify({
      crops: [
        { index: 1, name: "Tires", dataUrl: "data:image/jpeg;base64,a", frac: { x: 0, y: 0, w: 0.3, h: 0.3 } },
        { index: 2, name: "Canoe", dataUrl: "data:image/jpeg;base64,b", frac: { x: 0.2, y: 0.4, w: 0.6, h: 0.5 } }
      ],
      key: "sk-test-not-a-real-key-xxxx",
      fetchImpl
    });
    assert.equal(checks[0].found, false);
    assert.equal(checks[1].found, true);
    assert.ok(checks[1].localBox);
  });

  it("runLookDeeper locates, verifies, and keeps an item whose box was dropped", async () => {
    const chatImpl = async () => ({
      result: {
        items: [
          { name: "Riding mower", where: "far back left", priceLow: 200, priceHigh: 500, box: { x: 0.4, y: 0.1, w: 0.1, h: 0.1 } },
          { name: "Stack of 8 chairs", where: "middle left", priceLow: 40, priceHigh: 80, box: { x: 0.2, y: 0.3, w: 0.2, h: 0.3 } }
        ],
        skipped: [],
        note: "looked"
      },
      usage: { prompt_tokens: 9000, completion_tokens: 400 },
      model: "gpt-4o"
    });
    const locateAndVerifyImpl = async ({ items }) => ({
      items: [
        { ...items[0], box: null, boxDropped: true, boxVerified: false, boxStatus: "unknown", thumbDataUrl: "", where: items[0].where },
        { ...items[1], box: { x: 0.18, y: 0.35, w: 0.16, h: 0.28 }, boxVerified: true, boxDropped: false, boxStatus: "verified", boxRefined: true, cells: "B4-C6" }
      ],
      usage: { prompt_tokens: 2000, completion_tokens: 200 }
    });
    const out = await runLookDeeper({
      scan: { items: [], skipped: [] },
      key: "sk-test-not-a-real-key-xxxx",
      chatImpl,
      locateAndVerifyImpl,
      tiles: {
        tiles: [{ index: 1, dataUrl: "data:image/jpeg;base64,T", frac: { x: 0, y: 0, w: 0.4, h: 0.4 }, x: 0, y: 0, w: 360, h: 360 }],
        overview: { dataUrl: "data:image/jpeg;base64,O", width: 900, height: 900, frac: { x: 0, y: 0, w: 1, h: 1 } },
        width: 900, height: 900
      },
      cropFn: async () => "data:image/jpeg;base64,THUMB"
    });
    const mower = out.items.find(it => /mower/i.test(it.name));
    const chairs = out.items.find(it => /chair/i.test(it.name));
    assert.ok(mower, "mower is still listed");
    assert.equal(mower.boxDropped, true);
    assert.equal(mower.box, null);
    // No misleading thumb of a wall
    assert.equal(mower.thumbDataUrl, "");
    assert.equal(chairs.boxVerified, true);
    assert.ok(chairs.box);
    assert.equal(chairs.cells, "B4-C6");
    // Combined usage: first pass + locate
    assert.equal(out.usage.prompt_tokens, 11000);
  });

  it("attachThumbs does not invent a thumbnail from a dropped box", async () => {
    const result = {
      items: [
        { name: "Doors", lookedDeeper: true, boxDropped: true, boxVerified: false, box: null, where: "middle right" },
        { name: "Canoe", lookedDeeper: true, boxVerified: true, box: { x: 0.2, y: 0.4, w: 0.5, h: 0.4 } }
      ]
    };
    const frames = [{ dataUrl: "data:image/jpeg;base64,WHOLE", width: 900, height: 900 }];
    const out = await attachThumbs(result, frames, async () => "data:image/jpeg;base64,CROP");
    assert.equal(out.items[0].thumbDataUrl, "");
    assert.equal(out.items[1].thumbDataUrl, "data:image/jpeg;base64,CROP");
  });
});

describe("v0.7.4 wiring, UI, version, and service worker", () => {
  it("bumps the app to 0.9.0 and caches locate.js", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "0.9.0");
    const main = readFileSync(join(root, "app/js/main.js"), "utf8");
    assert.match(main, /export const VERSION = "0\.9\.0"/);
    const sw = readFileSync(join(root, "app/sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.9\.0/);
    assert.match(sw, /js\/core\/locate\.js/);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(readme, /0\.9\.0/);
    assert.match(readme, /labeled grid/);
    assert.match(LOOK_DEEPER_NOTE, /five cents/);
    assert.equal(LOCATE_MODEL, "gpt-4o");
    assert.equal(LOOK_DEEPER_MODEL, "gpt-4o");
  });

  it("tells the user when a box was dropped, and persists the new fields", () => {
    const html = lookCardHtml({
      id: "li_1",
      name: "Riding mower",
      where: "far back left, near the tire stack",
      boxDropped: true,
      boxVerified: false,
      whatToCheck: []
    });
    assert.match(html, /couldn't pin the exact spot/);
    assert.match(html, /far back left/);
    assert.match(html, /Riding mower/);
    const ok = lookCardHtml({
      id: "li_2",
      name: "Canoe",
      where: "center",
      boxVerified: true,
      whatToCheck: []
    });
    assert.doesNotMatch(ok, /couldn't pin the exact spot/);
    const raw = normalizeLookItem({
      name: "Canoe",
      box: { x: 0.2, y: 0.4, w: 0.5, h: 0.4 },
      boxVerified: true,
      boxDropped: false,
      boxStatus: "verified",
      cells: "B4-E7",
      lookedDeeper: true
    });
    assert.equal(raw.boxVerified, true);
    assert.equal(raw.cells, "B4-E7");
    assert.equal(raw.boxDropped, false);
  });

  it("does not mention last names, emails, secrets, or Ken's test photos", () => {
    const a = readFileSync(join(root, "app/js/core/locate.js"), "utf8");
    const b = readFileSync(join(root, "app/js/core/lookdeeper.js"), "utf8");
    const both = a + b;
    assert.doesNotMatch(both, /Hasier/);
    assert.doesNotMatch(both, /KennethNootbaar6/i);
    assert.doesNotMatch(both, /sk-[a-zA-Z0-9]{10,}/);
    assert.doesNotMatch(both, /ken-test-photos/);
    assert.doesNotMatch(both, /barn-\d/);
  });
});
