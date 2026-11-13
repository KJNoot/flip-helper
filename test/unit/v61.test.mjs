import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIRST_GUESS_LABEL,
  applyCloseupResult, runCloseupCheck,
  sortLookItems, checkedSummary,
  lookCardHtml, haggleSheetHtml, decorateItem,
  itemFromLookItem,
  saveScan, getScan, normalizeScan,
} from "../../app/js/core/secondlook.js";
import { FEATURE_GUIDE } from "../../app/js/core/guide.js";
import { needsDelistHighlight, reminderBody } from "../../app/js/core/protect.js";
import { setListed, markSold } from "../../app/js/core/inventory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

const mug = {
  id: "li_1",
  name: "Speckled ceramic mug",
  where: "left side of the table, near the front",
  priceLow: 12,
  priceHigh: 22,
  priceNote: "This is an estimate from the photo, not from checking sold listings.",
  why: "A handmade-looking mug.",
  whatToCheck: ["maker's mark on the bottom", "chips or cracks"],
  confidence: "medium",
  thumbDataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  buyUpToLabel: "Buy up to $7.00",
  dismissed: false,
  checked: false
};

describe("v0.6.1 close-up check and List it", () => {
  it("labels the table estimate as a first guess and makes Go check this one the primary action", () => {
    const html = lookCardHtml(decorateItem(mug, { desiredProfit: 10, siteIds: ["facebook"] }));
    assert.match(html, new RegExp(FIRST_GUESS_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /Go check this one/);
    assert.match(html, /Take a picture of just this item/);
    assert.match(html, /Find it/);
    assert.match(html, /left side of the table/);
    assert.match(html, /Snap a close photo/);
    assert.match(html, /maker&#39;s mark|maker's mark/);
    assert.match(html, /List it/);
    assert.match(html, /Help me haggle/);
    assert.match(html, /data-checked="0"/);
    assert.doesNotMatch(html, /Bought, on the way home/);
    assert.doesNotMatch(html, /I didn't buy it/);
    assert.doesNotMatch(html, /Take a close-up/);
  });

  it("after a close-up, marks the card Checked and replaces the first guess with the verified result", () => {
    const checked = applyCloseupResult(mug, {
      draft: {
        title: "Speckled ceramic mug",
        priceLow: 18,
        priceHigh: 32,
        priceReason: "From the close-up.",
        notes: "No chips.",
        brand: "",
        category: "Kitchen",
        condition: "Good"
      },
      photos: [{ dataUrl: "data:image/jpeg;base64,CCC" }]
    }, 1731480000000, { desiredProfit: 10, siteIds: ["facebook"] });
    assert.equal(checked.checked, true);
    assert.equal(checked.priceLow, 18);
    assert.equal(checked.priceHigh, 32);
    assert.equal(checked.firstGuess.priceLow, 12);
    assert.equal(checked.firstGuess.priceHigh, 22);
    assert.equal(checked.firstGuess.name, "Speckled ceramic mug");
    assert.equal(checked.thumbDataUrl, "data:image/jpeg;base64,CCC");
    assert.ok(checked.closeupDraft);
    assert.equal(checked.closeupDraft.priceLow, 18);

    const html = lookCardHtml(checked);
    assert.match(html, />Checked</);
    assert.match(html, /\$18\.00 to \$32\.00/);
    assert.match(html, /From your close-up/);
    assert.match(html, /Help me haggle/);
    assert.match(html, /Recommended/);
    assert.match(html, /List it/);
    assert.match(html, /Take another close-up/);
    // First guess is kept, in the fold, and is not the main range.
    assert.match(html, /First guess from the table/);
    assert.match(html, /\$12\.00 to \$22\.00/);
    assert.doesNotMatch(html, /Go check this one/);
    assert.doesNotMatch(html, /Bought, on the way home/);
    assert.doesNotMatch(html, /I didn't buy it/);
  });

  it("runs the existing single-item pricing on a close-up, without requiring a Buy or pass screen change", async () => {
    const fetchImpl = async (url, opts) => {
      assert.match(url, /chat\/completions/);
      const body = JSON.parse(opts.body);
      // Existing requestScan path: identify and estimate.
      assert.match(JSON.stringify(body.messages), /identify this item|close-up|resell/i);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            title: "Speckled ceramic mug",
            priceLow: 18,
            priceHigh: 32,
            priceReason: "From the close-up.",
            notes: "No chips.",
            category: "Kitchen",
            condition: "Good"
          }) } }]
        })
      };
    };
    const next = await runCloseupCheck(mug, {
      photos: [{ dataUrl: "data:image/jpeg;base64,CCC" }],
      key: "sk-test-not-real",
      fetchImpl,
      enabledSites: ["facebook"],
      desiredProfit: 10
    });
    assert.equal(next.checked, true);
    assert.equal(next.priceLow, 18);
    assert.equal(next.priceHigh, 32);
    assert.equal(next.firstGuess.priceLow, 12);
    await assert.rejects(
      () => runCloseupCheck(mug, { photos: [], key: "sk-test-not-real", fetchImpl }),
      /Take a picture of just this item first/
    );
  });

  it("lists unchecked items first and shows a 2 of 3 checked counter", () => {
    const items = [
      { id: "a", name: "A", checked: true, dismissed: false },
      { id: "b", name: "B", checked: false, dismissed: false },
      { id: "c", name: "C", checked: true, dismissed: false },
      { id: "d", name: "D", checked: false, dismissed: true }
    ];
    const order = sortLookItems(items).map(i => i.id);
    assert.deepEqual(order, ["b", "a", "c", "d"]);
    const sum = checkedSummary(items);
    assert.equal(sum.checked, 2);
    assert.equal(sum.total, 3);
    assert.equal(sum.label, "2 of 3 checked");
    assert.equal(checkedSummary([{ id: "x", dismissed: false }, { id: "y", dismissed: false }]).label, "0 of 2 checked");
  });

  it("hands List it into a normal inventory item, prefilled from the close-up or the first guess", () => {
    const first = itemFromLookItem(mug, { scanId: "sl_1", at: 1731480000000 });
    assert.equal(first.title, "Speckled ceramic mug");
    assert.equal(first.priceLow, 12);
    assert.equal(first.priceHigh, 22);
    assert.equal(first.photos[0].dataUrl, mug.thumbDataUrl);
    assert.equal(first.secondLookItemId, "li_1");
    assert.equal(first.secondLookScanId, "sl_1");
    assert.match(first.notes, /First guess from a table scan/);
    assert.equal(first.notInHand, undefined);
    assert.equal(first.purchasePending, undefined);
    assert.equal(first.didntBuy, undefined);
    assert.equal(first.onTheWayHome, undefined);

    const checked = applyCloseupResult(mug, {
      draft: { title: "Speckled ceramic mug, no chips", priceLow: 18, priceHigh: 32, priceReason: "Close-up.", category: "Kitchen", condition: "Good", notes: "Clean." },
      photos: [{ dataUrl: "data:image/jpeg;base64,CCC" }]
    }, 1731480000000, { desiredProfit: 10, siteIds: ["facebook"] });
    const listed = itemFromLookItem(checked, { scanId: "sl_1" });
    assert.equal(listed.title, "Speckled ceramic mug, no chips");
    assert.equal(listed.priceLow, 18);
    assert.equal(listed.priceHigh, 32);
    assert.equal(listed.photos[0].dataUrl, "data:image/jpeg;base64,CCC");
    assert.equal(listed.category, "Kitchen");
    assert.equal(listed.condition, "Good");
    assert.match(listed.notes, /From a close-up/);
    assert.equal(listed.notInHand, undefined);
    assert.equal(listed.didntBuy, undefined);
  });

  it("persists Checked, the first guess, the close-up, and a List it link across save and load", () => {
    const s = mem();
    const checked = applyCloseupResult(mug, {
      draft: { title: "Mug", priceLow: 18, priceHigh: 32, priceReason: "Close-up." },
      photos: [{ dataUrl: "data:image/gif;base64,xx" }]
    }, 1731480000000, { desiredProfit: 10, siteIds: ["facebook"] });
    checked.listedItemId = "it_abc";
    const row = saveScan({ kind: "photo", items: [checked], unread: false }, s, 1731480000000);
    const loaded = getScan(row.id, s).items[0];
    assert.equal(loaded.checked, true);
    assert.equal(loaded.priceLow, 18);
    assert.equal(loaded.firstGuess.priceLow, 12);
    assert.equal(loaded.listedItemId, "it_abc");
    assert.ok(loaded.closeupPhotos.length);
    const again = normalizeScan(JSON.parse(JSON.stringify(row)));
    assert.equal(again.items[0].checked, true);
    assert.equal(again.items[0].firstGuess.priceLow, 12);
  });

  it("notes on Help me haggle that numbers are a first guess until the close-up is in", () => {
    const unchecked = decorateItem(mug, { desiredProfit: 10, siteIds: ["facebook"] });
    const before = haggleSheetHtml(unchecked);
    assert.match(before, /first guess from the table/i);
    const after = haggleSheetHtml(applyCloseupResult(unchecked, {
      draft: { title: mug.name, priceLow: 18, priceHigh: 32, priceReason: "Close-up." },
      photos: [{ dataUrl: "data:image/gif;base64,xx" }]
    }, Date.now(), { desiredProfit: 10, siteIds: ["facebook"] }));
    assert.match(after, /from your close-up/i);
    assert.doesNotMatch(after, /first guess from the table/i);
  });

  it("a listed item from List it still uses the existing sold take-down alerts", () => {
    let item = itemFromLookItem(mug, { scanId: "sl_1" });
    item = setListed(item, "ebay", true);
    item = setListed(item, "poshmark", true);
    const sold = markSold(item, { siteId: "ebay", salePrice: 20, at: Date.now() });
    assert.equal(needsDelistHighlight(sold), true);
    const body = reminderBody(sold);
    assert.ok(body);
    assert.match(body.body, /sold/i);
    assert.match(body.body, /Poshmark|take/i);
  });

  it("keeps the Ask helper guide honest about Go check, List it, and no on-the-way-home status", () => {
    assert.match(FEATURE_GUIDE, /Go check this one/);
    assert.match(FEATURE_GUIDE, /List it/);
    assert.match(FEATURE_GUIDE, /first table guess|first guess/i);
    assert.doesNotMatch(FEATURE_GUIDE, /Bought, on the way home/);
    assert.doesNotMatch(FEATURE_GUIDE, /I didn't buy it/);
  });

  it("does not put last names, emails, or keys in the v0.6.1 modules", () => {
    const a = readFileSync(join(ROOT, "app/js/core/secondlook.js"), "utf8");
    const b = readFileSync(join(ROOT, "app/js/ui/screens/secondlook.js"), "utf8");
    const both = a + b;
    assert.doesNotMatch(both, /Hasier/);
    assert.doesNotMatch(both, /KennethNootbaar6/i);
    assert.doesNotMatch(both, /sk-[a-zA-Z0-9]{10,}/);
    assert.doesNotMatch(both, /Bought, on the way home/);
    assert.doesNotMatch(both, /I didn't buy it/);
    assert.doesNotMatch(both, /confirm the purchase/i);
  });
});
