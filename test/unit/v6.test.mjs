import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planFrameTimes, selectFrames, isNearDuplicate, blockMeans, signatureDistance,
  videoLimit, FRAME_INTERVAL, MAX_FRAMES, MAX_VIDEO_SECONDS, REFUSE_VIDEO_SECONDS,
  MSG_TOO_LONG, MSG_EMPTY, MSG_NO_KEY, PRIVACY_NOTE, EARBUD_LATER, SECOND_LOOK_SYSTEM,
  SCANS_KEY,
  normalizeBox, pixelCropBounds, whereFromBox,
  normalizeLookItem, normalizeSecondLook, parseSecondLookResponse,
  dedupeItems, isSameLookItem, namesSimilar, nameKey, boxesOverlap, mergeLookItems,
  friendlyRound, haggleNumbers, haggleLines, bundleTip, priceRangeLabel,
  lookCardHtml, skippedHtml, haggleSheetHtml,
  loadScans, saveScan, getScan, updateScan, dismissItem, markScanRead,
  removeScan, unreadScanCount, clearSecondLook, normalizeScan,
  requestSecondLook, attachThumbs, scanWorkFromLookItem, decorateItem,
  estimatesForItem, frameByIndex
} from "../../app/js/core/secondlook.js";
import { FEATURE_GUIDE } from "../../app/js/core/guide.js";
import { WALKTHROUGH_SCREENS } from "../../app/js/core/walkthrough.js";
import { buyUpTo } from "../../app/js/core/profit.js";
import { money } from "../../app/js/core/inventory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const APP = join(ROOT, "app");

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

function gray(w, h, v) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return data;
}

function split(w, h, left, right) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? left : right;
      const o = (y * w + x) * 4;
      data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
    }
  }
  return data;
}

describe("frame sampling", () => {
  it("plans about one frame per 1–1.5 seconds, capped, and skips a sliver at the ends", () => {
    const times = planFrameTimes(20, { interval: 1.25, maxFrames: 24 });
    assert.ok(times.length >= 12 && times.length <= 24, `got ${times.length}`);
    assert.ok(times[0] >= 0.15, "skips a black-ish first instant");
    assert.ok(times[0] < 1);
    assert.ok(times[times.length - 1] <= 20);
    assert.ok(times[times.length - 1] >= 18);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      assert.ok(gap >= 0.5 && gap <= 2.5, `gap ${gap}`);
    }
    assert.equal(planFrameTimes(0).length, 0);
    assert.equal(planFrameTimes(-3).length, 0);
    assert.equal(planFrameTimes("nope").length, 0);
    const tiny = planFrameTimes(0.3);
    assert.equal(tiny.length, 1);
    assert.ok(tiny[0] >= 0 && tiny[0] <= 0.3);
  });

  it("caps a long video at two minutes of planned times", () => {
    const times = planFrameTimes(400, { interval: 1.25, maxFrames: 24, maxDuration: MAX_VIDEO_SECONDS });
    assert.ok(times[times.length - 1] <= MAX_VIDEO_SECONDS + 0.01);
    assert.ok(times.length <= 24);
  });

  it("refuses a very long video and warns when trimming a long one", () => {
    const refuse = videoLimit(REFUSE_VIDEO_SECONDS + 10);
    assert.equal(refuse.ok, false);
    assert.equal(refuse.refuse, true);
    assert.match(refuse.warning, /too long|under two minutes|wide photo/i);

    const trim = videoLimit(MAX_VIDEO_SECONDS + 30);
    assert.equal(trim.ok, true);
    assert.equal(trim.used, MAX_VIDEO_SECONDS);
    assert.match(trim.warning, /first two minutes/i);

    const ok = videoLimit(40);
    assert.equal(ok.ok, true);
    assert.equal(ok.warning, "");
    assert.equal(ok.used, 40);

    const bad = videoLimit(0);
    assert.equal(bad.ok, false);
  });
});

describe("near-duplicate frame skip and selection", () => {
  it("treats identical and almost-identical frames as duplicates, and black vs white as different", () => {
    const a = { blocks: blockMeans(gray(16, 16, 20), 16, 16, 8) };
    const b = { blocks: blockMeans(gray(16, 16, 22), 16, 16, 8) };
    const white = { blocks: blockMeans(gray(16, 16, 250), 16, 16, 8) };
    const splitL = { blocks: blockMeans(split(16, 16, 10, 200), 16, 16, 8) };
    const splitR = { blocks: blockMeans(split(16, 16, 200, 10), 16, 16, 8) };
    assert.ok(isNearDuplicate(a, a));
    assert.ok(isNearDuplicate(a, b));
    assert.equal(isNearDuplicate(a, white), false);
    assert.equal(isNearDuplicate(splitL, splitR), false);
    assert.ok(signatureDistance(a, white) > 100);
    assert.equal(isNearDuplicate(null, a), false);
  });

  it("drops near-duplicates and keeps at most the cap, spaced across the pan", () => {
    const same = { blocks: blockMeans(gray(8, 8, 40), 8, 8, 8) };
    const other = { blocks: blockMeans(gray(8, 8, 200), 8, 8, 8) };
    const mid = { blocks: blockMeans(split(8, 8, 40, 200), 8, 8, 8) };
    const cands = [
      { id: "a1", hash: same }, { id: "a2", hash: same },
      { id: "b1", hash: mid },
      { id: "c1", hash: other }, { id: "c2", hash: other }
    ];
    const picked = selectFrames(cands, { maxFrames: 16 });
    assert.equal(picked.length, 3);
    assert.deepEqual(picked.map(c => c.id), ["a1", "b1", "c1"]);

    // Explicit signatures: 40 clearly unique frames, so selection (not hashing) is what's under test.
    const many = [];
    for (let i = 0; i < 40; i++) {
      // Every block shifts by 20 from one frame to the next — well above the duplicate threshold.
      const blocks = Array.from({ length: 64 }, (_, j) => i * 15 + j);
      many.push({ id: i, hash: { blocks } });
    }
    const capped = selectFrames(many, { maxFrames: 16 });
    assert.equal(capped.length, 16);
    assert.equal(capped[0].id, 0);
    assert.equal(capped[capped.length - 1].id, 39, "the end of the pan is kept");
    // Evenly spaced: the second pick should not be the immediate neighbor if we have plenty.
    assert.ok(capped[1].id >= 2);
    assert.equal(selectFrames([], { maxFrames: 16 }).length, 0);
  });
});

describe("boxes, crops, and where", () => {
  it("normalizes fractions, percentages, arrays, and inverted sizes, and rejects junk", () => {
    assert.deepEqual(normalizeBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    const pct = normalizeBox({ left: 10, top: 20, width: 30, height: 40 });
    assert.equal(pct.x, 0.1);
    assert.equal(pct.w, 0.3);
    const arr = normalizeBox([0.2, 0.3, 0.4, 0.5]);
    assert.equal(arr.x, 0.2);
    assert.equal(arr.h, 0.5);
    const inv = normalizeBox({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 });
    assert.ok(inv.x < 0.5 && inv.w > 0);
    assert.equal(normalizeBox(null), null);
    assert.equal(normalizeBox({ x: "no", y: 0, w: 1, h: 1 }), null);
    assert.equal(normalizeBox({ x: 800, y: 600, w: 100, h: 100 }), null, "raw pixels without a size");
    const clamped = normalizeBox({ x: -0.2, y: 0.9, w: 2, h: 0.5 });
    assert.ok(clamped.x >= 0 && clamped.x + clamped.w <= 1.001);
    assert.ok(clamped.y + clamped.h <= 1.001);
  });

  it("turns a box into a padded pixel crop and a plain-words 'where'", () => {
    const b = pixelCropBounds(1000, 500, { x: 0.1, y: 0.2, w: 0.2, h: 0.4 }, 0.08);
    assert.equal(b.x, Math.round((0.1 - 0.08) * 1000));
    assert.ok(b.w > 200);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1000 && b.y + b.h <= 500);
    const full = pixelCropBounds(100, 80, null, 0);
    assert.equal(full.x, 0);
    assert.equal(full.w, 100);
    assert.equal(full.h, 80);
    assert.equal(whereFromBox({ x: 0.05, y: 0.1, w: 0.2, h: 0.2 }), "left side of the table, toward the back");
    assert.equal(whereFromBox({ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }), "right side of the table, toward the front");
    assert.equal(whereFromBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }), "middle of the table");
    assert.equal(whereFromBox(null), "on the table");
  });
});

describe("JSON parsing and validation", () => {
  it("accepts a well-formed look-over and fills in defaults", () => {
    const raw = {
      items: [{
        name: "Brass mantel clock",
        why: "Looks vintage, might be solid brass. This is a guess from the photo.",
        priceLow: 40,
        priceHigh: 80,
        priceNote: "Estimate from the photo, not from sold listings.",
        confidence: "medium",
        frame: 2,
        box: { x: 0.1, y: 0.2, w: 0.25, h: 0.3 },
        where: "left side of the table, near the clocks",
        whatToCheck: ["maker's marks", "does it run", "completeness"]
      }],
      skipped: [{ name: "plastic hangers", reason: "common, low resale" }],
      note: "Crowded table, a few things were hard to see."
    };
    const r = normalizeSecondLook(raw, [0, 0, 0]);
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].name, "Brass mantel clock");
    assert.equal(r.items[0].priceLow, 40);
    assert.equal(r.items[0].priceHigh, 80);
    assert.equal(r.items[0].confidence, "medium");
    assert.equal(r.items[0].frame, 2);
    assert.equal(r.items[0].where, "left side of the table, near the clocks");
    assert.deepEqual(r.items[0].whatToCheck, ["maker's marks", "does it run", "completeness"]);
    assert.equal(r.skipped[0].name, "plastic hangers");
    assert.match(r.note, /Crowded/);
  });

  it("pulls JSON out of markdown fences and leftover prose", () => {
    const text = "Sure.\n```json\n{\"items\":[{\"name\":\"Pyrex bowl\",\"priceLow\":15,\"priceHigh\":25}],\"skipped\":[],\"note\":\"ok\"}\n```\nHope that helps.";
    const r = parseSecondLookResponse(text);
    assert.equal(r.ok, true);
    assert.equal(r.items[0].name, "Pyrex bowl");
    assert.equal(r.items[0].priceLow, 15);
  });

  it("handles malformed, missing, and messy fields without throwing", () => {
    assert.equal(parseSecondLookResponse(null).ok, false);
    assert.equal(parseSecondLookResponse("").ok, false);
    assert.match(parseSecondLookResponse("{not json").error, /wasn't in a form/i);
    assert.equal(parseSecondLookResponse(42).ok, false);

    const messy = normalizeSecondLook({
      items: [
        { title: "  Sterling spoon  ", price_low: "12", priceHigh: "8", confidence: "HIGH", frame: 0, box: { left: 50, top: 10, width: 20, height: 20 }, check: "look for 925; condition", why: "" },
        "just a string",
        { name: "" },
        null,
        { name: "Clock", box: "nope", priceLow: -4, whatToCheck: [{ text: "maker's mark" }, ""] }
      ],
      skipped: ["cables", { name: "paperbacks", reason: "mass-market" }, 7, {}],
      note: 12
    }, [0, 0]);
    assert.equal(messy.ok, true);
    const spoon = messy.items.find(i => /sterling/i.test(i.name));
    assert.ok(spoon);
    assert.equal(spoon.priceLow, 8, "swaps inverted low/high");
    assert.equal(spoon.priceHigh, 12);
    assert.equal(spoon.confidence, "medium", "high is capped — this is a distant look");
    assert.equal(spoon.frame, 1);
    assert.ok(spoon.box && Math.abs(spoon.box.x - 0.5) < 0.001);
    assert.ok(spoon.whatToCheck.some(c => /925|condition/i.test(c)));
    assert.ok(messy.items.find(i => i.name === "just a string"));
    assert.ok(messy.items.find(i => i.name === "Clock"));
    assert.ok(messy.items.every(i => i.name));
    assert.ok(messy.skipped.find(s => s.name === "cables"));
    assert.ok(messy.skipped.find(s => /paperback/i.test(s.name)));
    assert.ok(!messy.skipped.some(s => s.name && s.name !== "cables" && s.name !== "paperbacks" && !s.reason && s.name === "Something" && !s.name));
  });

  it("dedupes the same item across frames, but keeps two similar items in different places", () => {
    const a = normalizeLookItem({ name: "Brass clock", frame: 1, where: "left side of the table", box: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, whatToCheck: ["maker's mark"], priceLow: 40, priceHigh: 70, confidence: "low" }, 0);
    const b = normalizeLookItem({ name: "brass mantel clock", frame: 2, where: "left side of the table", box: { x: 0.12, y: 0.22, w: 0.2, h: 0.2 }, whatToCheck: ["does it run"], priceLow: 45, priceHigh: 90, confidence: "medium" }, 1);
    const c = normalizeLookItem({ name: "Brass clock", frame: 3, where: "right side of the table", box: { x: 0.75, y: 0.2, w: 0.2, h: 0.2 }, priceLow: 30, priceHigh: 55 }, 2);
    assert.equal(namesSimilar("Brass clock", "brass mantel clock"), true);
    assert.equal(isSameLookItem(a, b), true, "same place, similar name");
    assert.equal(isSameLookItem(a, c), false, "different sides of the table");
    const d = dedupeItems([a, b, c]);
    assert.equal(d.length, 2);
    const merged = d.find(i => /left/i.test(i.where));
    assert.equal(merged.confidence, "medium");
    assert.ok(merged.whatToCheck.includes("maker's mark"));
    assert.ok(merged.whatToCheck.includes("does it run"));
    assert.equal(merged.priceLow, 40);
    assert.equal(merged.priceHigh, 90);
    assert.ok(d.find(i => /right/i.test(i.where)));
  });
});

describe("haggle number math", () => {
  it("rounds to friendly amounts", () => {
    assert.equal(friendlyRound(0), 0);
    assert.equal(friendlyRound(-2), 0);
    assert.equal(friendlyRound(3.2), 3);
    assert.equal(friendlyRound(3.4), 3.5);
    assert.equal(friendlyRound(12.4), 12);
    assert.equal(friendlyRound(12.6), 13);
    assert.equal(friendlyRound(43), 45);
    assert.equal(friendlyRound(47), 45);
    assert.equal(friendlyRound(123), 120);
    assert.equal(friendlyRound(null), null);
  });

  it("builds opening, fair, and walk-away from Buy up to, and never goes above asking", () => {
    const buy = buyUpTo({ resale: 60, fees: 8, shipping: 7, desiredProfit: 10 });
    assert.equal(buy, 35);
    const h = haggleNumbers({ priceLow: 40, priceHigh: 80, buyUpTo: buy });
    assert.equal(h.ready, true);
    assert.equal(h.walkAway, 35);
    assert.ok(h.opening < h.fair, `${h.opening} < ${h.fair}`);
    assert.ok(h.fair <= h.walkAway, `${h.fair} <= ${h.walkAway}`);
    assert.ok(h.opening >= 10 && h.opening <= 25);
    assert.ok(h.fair >= 20 && h.fair <= 35);

    const under = haggleNumbers({ priceLow: 40, priceHigh: 80, buyUpTo: 35, asking: 20 });
    assert.equal(under.walkAway, 20, "no need to offer more than they're asking");
    assert.ok(under.opening <= 20);
    assert.ok(under.fair <= 20);

    const zero = haggleNumbers({ buyUpTo: 0 });
    assert.deepEqual(zero, { opening: 0, fair: 0, walkAway: 0, ready: true });

    const neg = haggleNumbers({ buyUpTo: -8 });
    assert.equal(neg.walkAway, 0);

    const empty = haggleNumbers({});
    assert.equal(empty.ready, false);
    assert.equal(empty.opening, null);

    const fromPrices = haggleNumbers({ priceLow: 40, priceHigh: 80 });
    assert.equal(fromPrices.ready, true);
    assert.ok(fromPrices.walkAway > 0 && fromPrices.walkAway < 40);

    // A modest mug: with a local site available, Buy up to is mid minus desired
    // profit (no fees, no shipping) — not "only if it's free."
    const mug = estimatesForItem(
      { priceLow: 12, priceHigh: 22 },
      { desiredProfit: 10, siteIds: ["ebay", "facebook"] }
    );
    assert.equal(mug.buyUpTo, 7);
    assert.match(mug.buyUpToLabel, /Buy up to \$7/);
    assert.ok(mug.haggle.walkAway === 7);
    assert.ok(mug.haggle.opening > 0 && mug.haggle.opening < mug.haggle.fair);
    assert.ok(mug.haggle.fair <= 7);

    // eBay only: fees and shipping can make a cheap item a pass, and that's honest.
    const ebayOnly = estimatesForItem(
      { priceLow: 12, priceHigh: 22 },
      { desiredProfit: 10, siteIds: ["ebay"] }
    );
    assert.ok(ebayOnly.buyUpTo == null || ebayOnly.buyUpTo <= 0);
  });

  it("writes three short polite lines, and a bundle tip for two or more items", () => {
    const h = haggleNumbers({ buyUpTo: 40 });
    const lines = haggleLines({ name: "brass clock", ...h });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /\$|would you take/i);
    assert.match(lines[1], /\$/);
    assert.match(lines[2], /highest|thanks|no pressure/i);
    assert.doesNotMatch(lines.join(" "), /broken|cheap|don't know what you have|steal/i);
    const free = haggleLines({ name: "thing", opening: 0, fair: 0, walkAway: 0 });
    assert.equal(free.length, 3);
    assert.match(free.join(" "), /free|almost free/i);

    const items = [
      decorateItem({ id: "a", name: "Clock", priceLow: 40, priceHigh: 80, dismissed: false }, { desiredProfit: 10, siteIds: ["ebay"] }),
      decorateItem({ id: "b", name: "Pyrex bowl", priceLow: 20, priceHigh: 35, dismissed: false }, { desiredProfit: 10, siteIds: ["ebay"] }),
      decorateItem({ id: "c", name: "Sneakers", priceLow: 30, priceHigh: 50, dismissed: false }, { desiredProfit: 10, siteIds: ["ebay"] })
    ];
    const tip = bundleTip(items);
    assert.ok(tip);
    assert.equal(tip.count, 3);
    assert.match(tip.line, /these 3 together|Pyrex|Clock|Sneakers/);
    assert.ok(tip.offer < tip.fair);
    assert.ok(tip.fair <= tip.walkAway);
    assert.equal(bundleTip(items.slice(0, 1)), null);
    assert.equal(bundleTip(items.map(i => ({ ...i, dismissed: true }))), null);
  });
});

describe("card and haggle rendering", () => {
  it("renders a closer-look card with the crop, where, estimate label, checks, and actions", () => {
    const html = lookCardHtml({
      id: "li_1",
      name: "Brass clock",
      where: "left side of the table, near the clocks",
      priceLow: 40,
      priceHigh: 80,
      priceNote: "This is an estimate from the photo, not from sold listings.",
      why: "Looks vintage.",
      whatToCheck: ["maker's marks", "sterling or 925"],
      confidence: "medium",
      thumbDataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      buyUpToLabel: "Buy up to $25.00",
      dismissed: false
    });
    assert.match(html, /Brass clock/);
    assert.match(html, /left side of the table, near the clocks/);
    assert.match(html, /\$40\.00 to \$80\.00/);
    assert.match(html, /First guess from the table: check it up close/);
    assert.match(html, /Find it/);
    assert.match(html, /Snap a close photo/);
    assert.match(html, /maker&#39;s marks|maker's marks/);
    assert.match(html, /Go check this one/);
    assert.match(html, /Take a picture of just this item/);
    assert.match(html, /Help me haggle/);
    assert.match(html, /List it/);
    assert.match(html, /Not interested/);
    assert.match(html, /Buy up to \$25/);
    assert.match(html, /data:image\/gif/);
    assert.doesNotMatch(html, /<script/);
    const escaped = lookCardHtml({ id: "x", name: `<img src=x onerror=alert(1)>`, where: "a", whatToCheck: [] });
    assert.doesNotMatch(escaped, /<img src=x/);
    assert.match(escaped, /&lt;img/);
    assert.equal(priceRangeLabel({ priceLow: 10, priceHigh: 10 }), "$10.00");
    assert.equal(priceRangeLabel({}), "No estimate yet");
  });

  it("renders skipped items and a haggle helper with Coming later on the earbud mode", () => {
    const skip = skippedHtml([{ name: "plastic hangers", reason: "common" }], "A first pass.");
    assert.match(skip, /likely low value/i);
    assert.match(skip, /plastic hangers/);
    assert.match(skip, /AI guess/);
    const item = decorateItem({ id: "li_1", name: "Brass clock", priceLow: 40, priceHigh: 80 }, { desiredProfit: 10, siteIds: ["ebay"] });
    const html = haggleSheetHtml(item, { bundle: bundleTip([item, decorateItem({ id: "li_2", name: "Bowl", priceLow: 20, priceHigh: 30 }, { desiredProfit: 10, siteIds: ["ebay"] })]) });
    assert.match(html, /Help me haggle/);
    assert.match(html, /Opening offer/);
    assert.match(html, /Fair price/);
    assert.match(html, /Walk away/);
    assert.match(html, /Would you take|could go|no pressure/i);
    assert.match(html, /Bundle tip/);
    assert.match(html, /Coming later/);
    assert.match(html, /earbud/i);
    assert.match(html, /Be upfront and respectful|not a trick/i);
    assert.doesNotMatch(html, /Coach is listening|whisper is on/i);
    assert.match(EARBUD_LATER, /Coming later|isn't ready/i);
  });
});

describe("scan storage", () => {
  it("saves a scan with the date, lists it, dismisses a card, and wipes", () => {
    const s = mem();
    const row = saveScan({
      kind: "photo",
      items: [{ name: "Clock", priceLow: 20, priceHigh: 40, where: "middle of the table" }],
      skipped: [{ name: "hangers", reason: "low value" }],
      note: "ok",
      unread: true,
      coverThumb: "data:image/gif;base64,xx"
    }, s, 1731480000000);
    assert.match(row.id, /^sl_/);
    assert.equal(row.createdAt, 1731480000000);
    assert.equal(loadScans(s).length, 1);
    assert.equal(getScan(row.id, s).items[0].name, "Clock");
    assert.equal(unreadScanCount(s), 1);
    markScanRead(row.id, s);
    assert.equal(unreadScanCount(s), 0);
    dismissItem(row.id, getScan(row.id, s).items[0].id, true, s);
    assert.equal(getScan(row.id, s).items[0].dismissed, true);
    removeScan(row.id, s);
    assert.equal(loadScans(s).length, 0);
    saveScan({ items: [{ name: "A" }] }, s);
    assert.equal(loadScans(s).length, 1);
    clearSecondLook(s);
    assert.equal(s.getItem(SCANS_KEY), null);
    assert.equal(loadScans(s).length, 0);
    assert.equal(normalizeScan(null), null);
    assert.equal(loadScans(mem()).length, 0);
  });
});

describe("API request and close-up handoff", () => {
  it("sends frames to gpt-4o-mini, asks for structured JSON, and never puts the key in the body", async () => {
    let captured = null;
    const frames = [
      { dataUrl: "data:image/jpeg;base64,AAA", time: 0.4 },
      { dataUrl: "data:image/jpeg;base64,BBB", time: 1.6 }
    ];
    const mock = {
      items: [{ name: "Clock", priceLow: 40, priceHigh: 80, frame: 1, box: { x: 0.1, y: 0.2, w: 0.2, h: 0.3 }, where: "left side of the table", whatToCheck: ["maker's marks"], why: "Looks vintage.", priceNote: "Estimate only.", confidence: "medium" }],
      skipped: [{ name: "hangers", reason: "low value" }],
      note: "ok"
    };
    const fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(mock) } }] }) };
    };
    const { result } = await requestSecondLook({ frames, key: "sk-secret-test-key-not-real", fetchImpl });
    assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.response_format.type, "json_object");
    assert.ok(body.messages[0].content.includes("closer look") || body.messages[0].content.includes("second set of eyes"));
    const user = body.messages[1].content;
    const images = user.filter(p => p.type === "image_url");
    assert.equal(images.length, 2);
    assert.match(JSON.stringify(user), /frame 1/i);
    assert.doesNotMatch(captured.opts.body, /sk-secret-test-key-not-real/);
    assert.match(captured.opts.headers.Authorization, /sk-secret-test-key-not-real/);
    assert.equal(result.items[0].name, "Clock");
    assert.equal(result.skipped[0].name, "hangers");
  });

  it("fails kindly with no key and no frames", async () => {
    await assert.rejects(() => requestSecondLook({ frames: [{ dataUrl: "x" }], key: "" }), /paste the AI key/i);
    await assert.rejects(() => requestSecondLook({ frames: [], key: "sk-x" }), /video or a wide photo/i);
  });

  it("attaches a cropped thumb from the right frame, using an injectable crop", async () => {
    const result = normalizeSecondLook({
      items: [{ name: "Clock", frame: 2, box: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } }]
    });
    const frames = [
      { dataUrl: "frame1", width: 100, height: 80 },
      { dataUrl: "frame2", width: 100, height: 80 }
    ];
    const withThumbs = await attachThumbs(result, frames, async (url, box) => `crop:${url}:${box.x}`);
    assert.equal(withThumbs.items[0].thumbDataUrl, "crop:frame2:0.1");
    assert.equal(frameByIndex(frames, 2).dataUrl, "frame2");
    assert.equal(frameByIndex(frames, 99).dataUrl, "frame2");
  });

  it("hands a close-up to the existing Buy or pass work shape, prefilled with the guess", () => {
    const item = decorateItem({
      id: "li_1",
      name: "Brass clock",
      where: "left side of the table, near the clocks",
      priceLow: 40,
      priceHigh: 80,
      why: "Looks vintage.",
      whatToCheck: ["maker's marks", "does it run"],
      thumbDataUrl: "data:image/gif;base64,xx"
    }, { desiredProfit: 10, siteIds: ["ebay", "facebook"] });
    const work = scanWorkFromLookItem(item);
    assert.equal(work.draft.title, "Brass clock");
    assert.equal(work.draft.priceLow, 40);
    assert.equal(work.draft.priceHigh, 80);
    assert.match(work.draft.priceReason, /estimate|close-up|table scan/i);
    assert.match(work.notes, /Close-up of: Brass clock/);
    assert.match(work.notes, /maker's marks/);
    assert.equal(work.photos[0].dataUrl, "data:image/gif;base64,xx");
    assert.equal(work.busy, false);
    assert.ok(work.result);
    assert.ok("buyUpTo" in work.result);
    assert.ok("assumptions" in work);
    // Shape the existing scan screen already paints.
    assert.ok(["title", "priceLow", "priceHigh", "priceReason", "notes"].every(k => k in work.draft));
  });
});

describe("guide, walkthrough, version, and privacy", () => {
  it("adds Second look to the Ask helper's guide and the first-run walkthrough, without dropping existing screens", () => {
    assert.match(FEATURE_GUIDE, /Second look: scan a table/);
    assert.match(FEATURE_GUIDE, /Go check this one/);
    assert.match(FEATURE_GUIDE, /List it/);
    assert.match(FEATURE_GUIDE, /Help me haggle/);
    assert.match(FEATURE_GUIDE, /Coming later/);
    assert.match(FEATURE_GUIDE, /sent only to the AI service/);
    assert.equal(WALKTHROUGH_SCREENS.length, 4, "still four skippable screens — Second look is mentioned on existing ones");
    const all = WALKTHROUGH_SCREENS.map(s => s.body + " " + (s.extra || "")).join(" ");
    assert.match(all, /Second look/);
    for (const s of WALKTHROUGH_SCREENS) assert.ok(s.body.length < 500);
  });

  it("bumps the app, package, and service worker to v0.7.4 and caches the new modules", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.version, "0.7.4");
    const main = readFileSync(join(APP, "js/main.js"), "utf8");
    assert.match(main, /export const VERSION = "0\.7\.4"/);
    const sw = readFileSync(join(APP, "sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.7\.4/);
    assert.match(sw, /js\/core\/secondlook\.js/);
    assert.match(sw, /js\/ui\/screens\/secondlook\.js/);
    assert.doesNotMatch(sw, /media\/intro\.mp4/);
    assert.match(PRIVACY_NOTE, /only to the AI service/);
    assert.match(PRIVACY_NOTE, /Thumbnails stay on this phone/);
    assert.match(SECOND_LOOK_SYSTEM, /sterling|925|maker/);
    assert.match(SECOND_LOOK_SYSTEM, /skipped/);
  });

  it("does not mention last names, emails, or the invite token in the new modules", () => {
    const a = readFileSync(join(APP, "js/core/secondlook.js"), "utf8");
    const b = readFileSync(join(APP, "js/ui/screens/secondlook.js"), "utf8");
    const both = a + b;
    assert.doesNotMatch(both, /Hasier/);
    assert.doesNotMatch(both, /KennethNootbaar6/i);
    assert.doesNotMatch(both, /sk-[a-zA-Z0-9]{10,}/);
  });
});
