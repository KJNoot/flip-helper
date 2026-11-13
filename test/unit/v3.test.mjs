import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyItem, setListed, markSold, markDelisted, profit, money, formatUsd, exportPayload, importPayload } from "../../app/js/core/inventory.js";
import {
  SITE_STATUSES, SITE_STATUS_LABELS, siteStatusOf, setSiteStatus, flagUnavailableEverywhere,
  confirmSiteDone, retrySiteStatus, markSiteFailed, startGuidedTakedown, guidedCurrent,
  advanceGuidedTakedown, guidedQueue, formatLastCheck, DOUBLE_SALE_CAVEAT, GUIDED_TAKEDOWN_NOTE
} from "../../app/js/core/sitestatus.js";
import { captureOriginals, pushHistory, undoLast, canUndo, applyCleanedPhoto, restorePhotoOriginal, photoHasOriginal, restoreOriginals, bulkApply, previewSnapshot } from "../../app/js/core/history.js";
import { createHaulBatch, addPhotosToHaul, upsertBatch, pendingHaulItems, markHaulItemSaved, dedupeById, saveWork, loadWork, clearWork, saveBatch, loadBatch, clearBatch } from "../../app/js/core/autosave.js";
import { emptyConfirm, normalizeConfirm, setConfirm, confirmedFields, honestValue, seedConfirmsFromDraft, HONESTY_NOTE } from "../../app/js/core/honesty.js";
import { profitBreakdown, buyUpTo, buyUpToLabel, askingFloor, normalizeReturn } from "../../app/js/core/profit.js";
import { qrMatrix, qrSvg, itemQrPayload, itemQrSvg, printLabelHtml, formatBits, rsEncode, VERSIONS } from "../../app/js/core/qr.js";
import { titleSimilarity, alreadyOwnedMatches, alreadyOwnedWarning, normalizeTitle } from "../../app/js/core/match.js";
import { morningList, mustShip, stillLiveAfterSale, needsDecision } from "../../app/js/core/morning.js";
import { COMPAT, COMPAT_REGION, COMPAT_DISCLAIMER, compatFor, compatLimitsNote } from "../../app/js/core/compat.js";
import { logAction, getActionLog, failedActions, clearActionLog } from "../../app/js/core/actions.js";
import { pricingOptions, applyPricingChoice, choicePrices, PRICING_LABELS, PRICING_NOTE, keepOnSite } from "../../app/js/core/pricing.js";
import { catchMistakes, dismissMistake, mistakeSummary } from "../../app/js/core/mistakes.js";
import { parseCsv, suggestMapping, rowsToItems, mergeItems, findDuplicateGroups, itemsToCsv } from "../../app/js/core/csv.js";
import { appendDictation, speechSupported, DICTATION_HINT, friendlyVoiceError } from "../../app/js/core/voice.js";
import { suggestionsForItem, DAY_MS } from "../../app/js/core/drops.js";
import { scanResult } from "../../app/js/core/scanner.js";
import { normalizeSettings, DEFAULT_SETTINGS, PAUSE_NOTE_ON, NO_SUBSCRIPTION_NOTE, getSettings, setSettings } from "../../app/js/core/settings.js";
import { hasSoldData, soldDataMessage, NO_SOLD_DATA, addLoggedComp } from "../../app/js/core/comps.js";
import { PHOTO_CLEANUP_NOTE, autoLevels } from "../../app/js/core/photo.js";
import { SITE_IDS } from "../../app/js/core/sites.js";
import { applyDraft, normalizeDraft } from "../../app/js/core/draft.js";
import { yearTotals, yearCsv, TAX_DISCLAIMER } from "../../app/js/core/taxes.js";
import { effectiveShipCost, applyBoxToItem } from "../../app/js/core/shipping.js";

const T = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh, 0, 0).getTime();
function item(partial = {}, at = T(2026, 11, 12)) {
  return emptyItem({ id: partial.id || "it_test", ...partial }, at);
}
function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

describe("per-site status", () => {
  it("has every status Ken asked for, with plain labels", () => {
    for (const s of ["draft", "pending", "live", "sold", "removed", "failed", "needsManual"]) {
      assert.ok(SITE_STATUSES.includes(s));
      assert.ok(SITE_STATUS_LABELS[s]);
    }
    assert.equal(SITE_STATUS_LABELS.needsManual, "Needs a manual step");
  });
  it("derives live / sold / removed from older items that have no siteStatus", () => {
    let i = setListed(item(), "ebay", true, T(2026, 11, 1));
    assert.equal(siteStatusOf(i, "ebay").status, "live");
    assert.equal(siteStatusOf(i, "poshmark").status, "draft");
    i = markSold(i, { siteId: "ebay", salePrice: 20, at: T(2026, 11, 12) });
    assert.equal(siteStatusOf(i, "ebay").status, "sold");
    assert.equal(i.unavailable, true);
  });
  it("flags the item unavailable everywhere on sale, and other live sites need a manual step", () => {
    let i = item({ title: "Mug" });
    i = setListed(i, "ebay", true);
    i = setListed(i, "poshmark", true);
    i = setListed(i, "mercari", true);
    i = markSold(i, { siteId: "ebay", salePrice: 24, at: T(2026, 11, 12) });
    assert.equal(i.unavailable, true);
    assert.equal(siteStatusOf(i, "ebay").status, "sold");
    assert.equal(siteStatusOf(i, "poshmark").status, "needsManual");
    assert.equal(siteStatusOf(i, "poshmark").unavailable, true);
    assert.equal(siteStatusOf(i, "mercari").status, "needsManual");
    assert.match(DOUBLE_SALE_CAVEAT, /cannot promise|impossible/i);
  });
  it("I-did-it marks a site removed, and Retry clears a failure", () => {
    let i = markSold(setListed(setListed(item(), "ebay", true), "poshmark", true), { siteId: "ebay", salePrice: 10, at: T(2026, 11, 12) });
    i = confirmSiteDone(i, "poshmark", T(2026, 11, 12));
    assert.equal(siteStatusOf(i, "poshmark").status, "removed");
    assert.ok(i.delistedOn.poshmark);
    i = markSiteFailed(i, "mercari", "Couldn't open the page");
    // mercari wasn't listed; still records failed
    assert.equal(siteStatusOf(i, "mercari").status, "failed");
    i = retrySiteStatus(i, "mercari");
    assert.notEqual(siteStatusOf(i, "mercari").status, "failed");
  });
  it("guided take-down flags unavailable, queues remaining sites, and ticks them off as she confirms", () => {
    let i = item({ title: "Scarf" });
    i = setListed(i, "ebay", true);
    i = setListed(i, "poshmark", true);
    i = setListed(i, "depop", true);
    i = markSold(i, { siteId: "ebay", salePrice: 16, at: T(2026, 11, 12) });
    const started = startGuidedTakedown(i, T(2026, 11, 12));
    assert.equal(started.item.unavailable, true);
    assert.deepEqual(started.queue, ["poshmark", "depop"]); // known-site order
    assert.equal(started.done, false);
    const cur = guidedCurrent(started);
    assert.equal(cur.siteId, "poshmark");
    assert.equal(cur.number, 1);
    assert.equal(cur.total, 2);
    assert.ok(cur.manageUrl);
    const step1 = advanceGuidedTakedown(started.item, started, { didIt: true, at: T(2026, 11, 12) });
    assert.equal(siteStatusOf(step1.item, "poshmark").status, "removed");
    const cur2 = guidedCurrent(step1.state);
    assert.equal(cur2.siteId, "depop");
    const step2 = advanceGuidedTakedown(step1.item, step1.state, { didIt: true });
    assert.equal(step2.state.done, true);
    assert.equal(guidedQueue(step2.item).length, 0);
    assert.match(GUIDED_TAKEDOWN_NOTE, /Automatic removal comes later/i);
    assert.match(GUIDED_TAKEDOWN_NOTE, /eBay/);
    assert.match(GUIDED_TAKEDOWN_NOTE, /always need your tap/i);
  });
  it("skipping a site leaves it for later", () => {
    let i = markSold(setListed(setListed(item(), "ebay", true), "poshmark", true), { siteId: "ebay", salePrice: 8 });
    const started = startGuidedTakedown(i);
    const step = advanceGuidedTakedown(started.item, started, { didIt: false });
    assert.equal(step.state.done, true);
    assert.equal(siteStatusOf(step.item, "poshmark").status, "needsManual");
  });
  it("formatLastCheck is plain language", () => {
    const now = T(2026, 11, 12);
    assert.equal(formatLastCheck(null, now), "Not checked yet");
    assert.equal(formatLastCheck(now - 10 * 1000, now), "Just now");
    assert.match(formatLastCheck(now - 5 * 60 * 1000, now), /5 minutes/);
  });
});

describe("originals, edit history, and undo", () => {
  it("keeps the first original text and can undo the last edit", () => {
    let i = item({ title: "Blue mug", description: "A mug." });
    i = captureOriginals(i, T(2026, 11, 12));
    assert.equal(i.originals.title, "Blue mug");
    i = pushHistory(i, { kind: "edit", label: "Before a title change", at: T(2026, 11, 12) });
    i = { ...i, title: "Wrong title" };
    assert.equal(canUndo(i), true);
    const preview = previewSnapshot(i, "original");
    assert.equal(preview.title, "Blue mug");
    i = undoLast(i);
    assert.equal(i.title, "Blue mug");
    assert.equal(canUndo(i), false);
  });
  it("keeps original pixels when a photo is cleaned, and can restore them", () => {
    const photos = [{ dataUrl: "data:image/png;base64,ORIG", addedAt: 1 }];
    const cleaned = applyCleanedPhoto(photos, 0, "data:image/png;base64,NEW", 2);
    assert.equal(cleaned[0].originalDataUrl, "data:image/png;base64,ORIG");
    assert.equal(cleaned[0].dataUrl, "data:image/png;base64,NEW");
    assert.equal(photoHasOriginal(cleaned[0]), true);
    const back = restorePhotoOriginal(cleaned, 0);
    assert.equal(back[0].dataUrl, "data:image/png;base64,ORIG");
  });
  it("restoreOriginals puts the first text back, and bulk edits are undoable", () => {
    let a = captureOriginals(item({ id: "a", title: "Hat" }));
    a = pushHistory({ ...a, title: "Hat v2" }, { kind: "edit", label: "rename" });
    a = { ...a, title: "Hat v2" };
    a = restoreOriginals(a);
    assert.equal(a.title, "Hat");
    const [b, c] = bulkApply([item({ id: "b", title: "One" }), item({ id: "c", title: "Two" })], { category: "Kitchen" }, { label: "Bulk category" });
    assert.equal(b.category, "Kitchen");
    assert.equal(undoLast(b).category, "");
    void c;
  });
});

describe("autosave and haul batches", () => {
  it("saves and restores a work draft, and clears it", () => {
    const ls = mem();
    saveWork({ item: { id: "it_1", title: "Draft mug" }, saved: false }, ls);
    const loaded = loadWork(ls);
    assert.equal(loaded.item.title, "Draft mug");
    clearWork(ls);
    assert.equal(loadWork(ls), null);
  });
  it("does not restore a work draft that was already saved", () => {
    const ls = mem();
    saveWork({ item: { id: "it_1" }, saved: true }, ls);
    assert.equal(loadWork(ls), null);
  });
  it("a haul assigns stable ids, resumes without duplicates, and merges by id", () => {
    const photos = [{ dataUrl: "a" }, { dataUrl: "b" }];
    const batch = createHaulBatch(photos, T(2026, 11, 12));
    assert.equal(batch.items.length, 2);
    assert.ok(batch.items[0].id.startsWith("it_"));
    assert.notEqual(batch.items[0].id, batch.items[1].id);
    const already = [{ id: batch.items[0].id, title: "Already saved" }];
    const pending = pendingHaulItems(batch, already);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, batch.items[1].id);
    const marked = markHaulItemSaved(batch, batch.items[1].id);
    assert.equal(pendingHaulItems(marked, already).length, 0);
    const merged = upsertBatch(batch, { items: [{ id: batch.items[0].id, title: "Named", saved: true }] });
    assert.equal(merged.items.length, 2);
    assert.equal(merged.items.find(x => x.id === batch.items[0].id).saved, true);
    assert.equal(merged.items.find(x => x.id === batch.items[0].id).title, "Named");
    assert.deepEqual(dedupeById([{ id: "a", n: 1 }, { id: "a", n: 2 }, { id: "b", n: 3 }]).map(x => x.n), [2, 3]);
  });
});

describe("AI honesty", () => {
  it("treats unknown or invented values as empty", () => {
    assert.equal(honestValue("Unknown"), "");
    assert.equal(honestValue("Nike"), "Nike");
    assert.equal(honestValue("Nike", { invented: true }), "");
    assert.equal(honestValue("can't tell"), "");
  });
  it("confirm boxes start unchecked, and only confirmed values count as fact", () => {
    const c = setConfirm(emptyConfirm(), "brand", { value: "Lakeview", confirmed: false });
    assert.equal(confirmedFields(c).brand, "");
    const yes = setConfirm(c, "brand", { confirmed: true });
    assert.equal(confirmedFields(yes).brand, "Lakeview");
  });
  it("applyDraft leaves brand and condition as guesses, not confirmed facts", () => {
    const i = applyDraft(item({ costPaid: 5 }), {
      title: "Mug",
      brand: "Lakeview Pottery",
      condition: "Like new",
      priceLow: 12,
      priceHigh: 18,
      priceReason: "rough guess",
      photoShows: { whatYouSee: "A blue ceramic mug", visibleFlaws: "" }
    });
    assert.equal(i.title, "Mug");
    assert.equal(i.askingPrice, 18);
    assert.equal(i.brand, ""); // unconfirmed
    assert.ok(i.aiGuess);
    assert.equal(i.aiGuess.brand, "Lakeview Pottery");
    assert.equal(i.youConfirm.brand.confirmed, false);
    assert.equal(i.youConfirm.brand.value, "Lakeview Pottery");
    assert.ok(i.photoShows);
    assert.match(i.photoShows.what, /mug/i);
    assert.match(HONESTY_NOTE, /left blank/i);
  });
  it("normalizeDraft empties unknown brand and condition", () => {
    const d = normalizeDraft({ title: "Chair", brand: "Unknown", condition: "unknown" });
    assert.equal(d.brand, "");
    assert.equal(d.condition, "");
  });
});

describe("full profit and buy-up-to", () => {
  it("breaks out marketplace fees, payment fees, postage, supplies, discounts, and refunds", () => {
    const i = item({
      salePrice: 50, costPaid: 10, marketplaceFees: 6, paymentFees: 2,
      actualShipCost: 5, supplies: 1.5, discounts: 2, refunds: 0
    });
    const b = profitBreakdown(i);
    assert.equal(b.marketplaceFees, 6);
    assert.equal(b.paymentFees, 2);
    assert.equal(b.postage, 5);
    assert.equal(b.postageIsActual, true);
    assert.equal(b.supplies, 1.5);
    assert.equal(b.discounts, 2);
    assert.equal(b.estimatedProfit, money(50 - 10 - 6 - 2 - 5 - 1.5 - 2));
    assert.equal(profit(i), b.estimatedProfit);
  });
  it("uses the old combined fees field when the split fields are empty, so older items still work", () => {
    const i = item({ salePrice: 50, costPaid: 20, fees: 8.5 });
    assert.equal(profit(i), 21.5);
    assert.equal(profitBreakdown(i).marketplaceFees, 8.5);
    assert.equal(profitBreakdown(i).paymentFees, 0);
  });
  it("shows estimated profit vs money received", () => {
    const i = item({ salePrice: 40, costPaid: 8, fees: 5, shippingPaid: 4, moneyReceived: 31 });
    const b = profitBreakdown(i);
    assert.equal(b.estimatedProfit, 23);
    assert.equal(b.moneyReceived, 31);
    assert.equal(b.receivedProfit, 23); // 31 - 8 cost (fees and postage already out of the payout)
  });
  it("Buy up to is resale minus fees, shipping, and desired profit", () => {
    assert.equal(buyUpTo({ resale: 30, fees: 4, shipping: 6, desiredProfit: 8 }), 12);
    assert.equal(buyUpToLabel(12), "Buy up to $12.00");
    assert.match(buyUpToLabel(0), /Don't buy/i);
    assert.equal(buyUpTo({ resale: null, fees: 4 }), null);
  });
  it("asking floor is cost plus shipping plus her profit floor", () => {
    const i = item({ costPaid: 10, profitFloor: 8, actualShipCost: 4 });
    assert.equal(askingFloor(i, { defaultFloor: 5 }), 22);
    assert.equal(askingFloor(item({ costPaid: 10 }), { defaultFloor: 5 }), 15);
  });
});

describe("QR labels", () => {
  it("builds a matrix with finder patterns in three corners for a short item id", () => {
    const { matrix, size, version } = qrMatrix("FH:it_test");
    assert.ok(size >= 21);
    assert.ok(version >= 1);
    // Finder: 7x7 dark border, white inside, dark 3x3 center, at (0,0)
    const dark = (x, y) => matrix[y][x] === 1;
    assert.equal(dark(0, 0), true);
    assert.equal(dark(6, 0), true);
    assert.equal(dark(0, 6), true);
    assert.equal(dark(6, 6), true);
    assert.equal(dark(1, 1), false); // inner white ring
    assert.equal(dark(3, 3), true); // center
    // top-right finder
    assert.equal(dark(size - 1, 0), true);
    assert.equal(dark(size - 7, 0), true);
    // bottom-left finder
    assert.equal(dark(0, size - 1), true);
    assert.equal(dark(0, size - 7), true);
    // quiet-ish: separators next to finders are white
    assert.equal(dark(7, 0), false);
  });
  it("returns an SVG and a printable label with the title, bin, and id — never a key", () => {
    const item_ = item({ title: "Blue mug", binLocation: "A3", id: "it_mug1" });
    const svg = itemQrSvg(item_);
    assert.match(svg, /<svg/);
    assert.match(svg, /<rect/);
    const html = printLabelHtml(item_);
    assert.match(html, /Blue mug/);
    assert.match(html, /Bin A3/);
    assert.match(html, /it_mug1/);
    assert.doesNotMatch(html, /sk-/);
    assert.equal(itemQrPayload(item_), "FH:it_mug1");
  });
  it("Reed-Solomon of a known short block has the right length", () => {
    const ecc = rsEncode(Uint8Array.from([1, 2, 3, 4]), 10);
    assert.equal(ecc.length, 10);
    // Deterministic: encoding twice matches.
    const ecc2 = rsEncode(Uint8Array.from([1, 2, 3, 4]), 10);
    assert.deepEqual([...ecc], [...ecc2]);
    assert.ok(formatBits(0) > 0);
    assert.equal(VERSIONS[2].size, 25);
  });
});

describe("already-own warning", () => {
  it("finds a fuzzy title match and ignores empty titles", () => {
    const items = [
      item({ id: "a", title: "Lakeview Pottery blue ceramic mug" }),
      item({ id: "b", title: "Navy wool jacket" }),
      item({ id: "c", title: "" })
    ];
    const hits = alreadyOwnedMatches(items, "Lakeview Pottery blue mug");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].id, "a");
    assert.ok(hits[0].score >= 0.55);
    assert.equal(alreadyOwnedMatches(items, "").length, 0);
    assert.equal(alreadyOwnedMatches(items, "Lakeview Pottery blue ceramic mug", { excludeId: "a" }).length, 0);
    assert.match(alreadyOwnedWarning(hits), /already own/i);
    assert.ok(titleSimilarity("Blue ceramic mug", "blue ceramic mug") === 1);
    assert.equal(normalizeTitle("Mug & Co!"), "mug and co");
  });
});

describe("morning list", () => {
  it("splits must-ship, still-live-after-a-sale, and needs-a-decision", () => {
    const soldAt = T(2026, 11, 11);
    let ship = markSold(setListed(item({ id: "s", title: "To ship" }), "ebay", true, soldAt), { siteId: "ebay", salePrice: 10, at: soldAt });
    let live = markSold(setListed(setListed(item({ id: "l", title: "Still up" }), "ebay", true), "poshmark", true), { siteId: "ebay", salePrice: 12, at: soldAt });
    const listedAt = T(2026, 10, 1);
    let drop = setListed(item({ id: "d", title: "Stale jacket", askingPrice: 40, costPaid: 5 }, listedAt), "ebay", true, listedAt);
    const list = morningList([ship, live, drop], { dropDays: 14, at: listedAt + 20 * DAY_MS });
    assert.equal(list.mustShip.length, 2); // ship and live are both unsipped sales
    assert.ok(list.mustShip.some(i => i.id === "s"));
    assert.equal(list.stillLive.length, 1);
    assert.equal(list.stillLive[0].id, "l");
    assert.ok(list.needsDecision.some(d => d.itemId === "d"));
    assert.equal(list.empty, false);
  });
});

describe("marketplace compatibility chart", () => {
  it("covers every known site, is US-only, and has source links", () => {
    assert.equal(COMPAT_REGION, "US");
    assert.match(COMPAT_DISCLAIMER, /not legal advice/i);
    assert.match(COMPAT_DISCLAIMER, /United States/i);
    for (const id of SITE_IDS) {
      const c = compatFor(id);
      assert.ok(c, "missing " + id);
      assert.ok(c.sources && c.sources.length, "no sources for " + id);
      assert.ok(c.sources.every(s => /^https:\/\//.test(s.url)));
      assert.ok(c.needsTap || c.automate);
    }
    const mercari = compatFor("mercari");
    assert.match(mercari.sources[0].url, /prohibited-conduct/);
    const posh = compatFor("poshmark");
    assert.match(posh.pathLabel, /not allowed/i);
    const ebay = compatFor("ebay");
    assert.equal(ebay.officialApi, true);
    assert.match(compatLimitsNote("craigslist") + " " + compatFor("craigslist").needsTap, /yourself|not allowed|auto-post|open the post/i);
  });
});

describe("action / support log", () => {
  it("records failures, redacts keys, and lists only failures when asked", () => {
    const ls = mem();
    logAction({ kind: "takedown", siteId: "poshmark", status: "failed", message: "Couldn't open the page. sk-this-is-a-fake-key-xxx" }, ls);
    logAction({ kind: "draft", status: "ok", message: "Draft ready" }, ls);
    const all = getActionLog(ls);
    assert.equal(all.length, 2);
    assert.doesNotMatch(all[0].message, /sk-/);
    assert.equal(failedActions(ls).length, 1);
    clearActionLog(ls);
    assert.equal(getActionLog(ls).length, 0);
  });
});

describe("three pricing options", () => {
  it("offers Sell quickly, Balanced, and Hold for more, with estimated keep-money per site", () => {
    const i = item({ priceLow: 16, priceHigh: 28, askingPrice: 22, costPaid: 6, title: "Mug" });
    const { options, note } = pricingOptions(i, ["ebay", "poshmark", "facebook"]);
    assert.equal(options.length, 3);
    assert.equal(options[0].label, "Sell quickly");
    assert.equal(options[1].label, "Balanced");
    assert.equal(options[2].label, "Hold for more");
    assert.equal(options[0].asking, 16);
    assert.equal(options[1].asking, 22);
    assert.equal(options[2].asking, 28);
    assert.ok(options[0].rows.length >= 3);
    for (const r of options[0].rows) {
      assert.ok(r.proceeds != null);
      assert.equal(r.approx, true);
      // proceeds = asking - fee - ship, so less than asking
      assert.ok(r.proceeds <= r.asking);
    }
    // Facebook local: no shipping in the estimate
    const fb = options[1].rows.find(r => r.siteId === "facebook");
    assert.equal(fb.shipping, 0);
    assert.match(note, /Estimate|approximate/i);
    const applied = applyPricingChoice(i, "quick");
    assert.equal(applied.askingPrice, 16);
    assert.equal(applied.pricingChoice, "quick");
    assert.equal(PRICING_LABELS.hold, "Hold for more");
    assert.match(PRICING_NOTE, /Not a quote/);
  });
});

describe("mistake catcher", () => {
  it("flags missing size, an unconfirmed brand, and flaws not noted", () => {
    const i = applyDraft(item({ title: "Nike running shoes", category: "Shoes" }), {
      title: "Nike running shoes",
      brand: "Nike",
      priceLow: 20,
      priceHigh: 40
    });
    const issues = catchMistakes(i);
    const ids = issues.map(x => x.id);
    assert.ok(ids.includes("size"), "missing size");
    assert.ok(ids.includes("brand"), "unconfirmed brand");
    assert.ok(ids.includes("flaws"), "flaws not noted");
    assert.match(mistakeSummary(issues), /things to check|missing|brand|flaws/i);
    const dismissed = dismissMistake(dismissMistake(dismissMistake(i, "size"), "brand"), "flaws");
    const after = catchMistakes(dismissed);
    assert.equal(after.find(x => x.id === "size"), undefined);
    assert.equal(after.find(x => x.id === "brand"), undefined);
    assert.equal(after.find(x => x.id === "flaws"), undefined);
  });
  it("does not flag a listing she has already filled in and confirmed", () => {
    const i = item({
      title: "Blue mug",
      size: "",
      measurements: "3.5 in tall",
      brand: "Lakeview",
      youConfirm: { brand: { confirmed: true, value: "Lakeview" }, material: { confirmed: false, value: "" }, size: { confirmed: false, value: "" }, flaws: { confirmed: true, value: "No chips" } },
      flawsNoted: true,
      noFlaws: false
    });
    const issues = catchMistakes(i);
    assert.equal(issues.find(x => x.id === "size"), undefined);
    assert.equal(issues.find(x => x.id === "brand"), undefined);
    assert.equal(issues.find(x => x.id === "flaws"), undefined);
  });
});

describe("CSV import, mapping, merge, and export", () => {
  it("parses quoted commas and suggests a column mapping", () => {
    const csv = `Title,Cost,Asking Price,Brand,Notes\n"Blue mug, handmade",6,24,Lakeview,"A nice, honest mug."\nNavy jacket,12,40,,"Wool"`;
    const { headers, rows } = parseCsv(csv);
    assert.deepEqual(headers, ["Title", "Cost", "Asking Price", "Brand", "Notes"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Title, "Blue mug, handmade");
    const map = suggestMapping(headers);
    assert.equal(map.Title, "title");
    assert.equal(map.Cost, "costPaid");
    assert.equal(map["Asking Price"], "askingPrice");
    const items = rowsToItems(rows, map, T(2026, 11, 12));
    assert.equal(items[0].title, "Blue mug, handmade");
    assert.equal(items[0].costPaid, 6);
    assert.equal(items[0].askingPrice, 24);
    assert.equal(items[0].brand, "Lakeview");
    assert.equal(items[1].title, "Navy jacket");
    // history records the import
    assert.ok(items[0].editHistory.some(h => h.kind === "import"));
  });
  it("merges duplicates and can find them by title", () => {
    const a = item({ id: "it_a", title: "Blue ceramic mug", description: "Short.", costPaid: 6, listedOn: { ebay: { at: 1 } } });
    const b = item({ id: "it_b", title: "Blue ceramic mug", description: "A longer, better description.", askingPrice: 24, listedOn: { poshmark: { at: 2 } }, photos: [{ dataUrl: "x" }] });
    const groups = findDuplicateGroups([a, b], { threshold: 0.7 });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 2);
    const merged = mergeItems(a, b);
    assert.equal(merged.id, "it_a");
    assert.match(merged.description, /longer/);
    assert.equal(merged.costPaid, 6);
    assert.equal(merged.askingPrice, 24);
    assert.ok(merged.listedOn.ebay);
    assert.ok(merged.listedOn.poshmark);
    assert.equal(merged.photos.length, 1);
  });
  it("exports a CSV without a key, and round-trips a title", () => {
    const i = item({ title: "Hat", costPaid: 4, askingPrice: 16 });
    const csv = itemsToCsv([i]);
    assert.match(csv, /Hat/);
    assert.doesNotMatch(csv, /sk-/);
    assert.doesNotMatch(csv, /apiKey/);
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].title || rows[0].Title, "Hat");
  });
});

describe("voice dictation helpers", () => {
  it("appends spoken text cleanly, and reports when the Speech API is missing (as in Node)", () => {
    assert.equal(appendDictation("", "a small chip on the rim"), "a small chip on the rim");
    assert.equal(appendDictation("a mug", "a small chip"), "a mug a small chip");
    assert.equal(appendDictation("a small chip", "a small chip"), "a small chip");
    assert.equal(speechSupported(), false);
    assert.match(DICTATION_HINT, /microphone on the keyboard/i);
    assert.match(friendlyVoiceError("not-allowed"), /isn't allowed|keyboard/i);
  });
});

describe("price drops respect the profit floor", () => {
  it("will not suggest a price below cost plus the profit floor", () => {
    const listedAt = T(2026, 10, 1);
    // 10% of $20 is $18, but cost 12 + floor 8 = 20, so it cannot drop.
    let i = setListed(item({ askingPrice: 20, costPaid: 12, profitFloor: 8, title: "Tight floor" }, listedAt), "ebay", true, listedAt);
    const s = suggestionsForItem(i, { days: 14, at: listedAt + 14 * DAY_MS, defaultFloor: 8 });
    assert.equal(s.length, 0);
    // A higher asking price can drop, but not below 20.
    i = setListed(item({ askingPrice: 40, costPaid: 12, profitFloor: 8, title: "Room to drop" }, listedAt), "ebay", true, listedAt);
    const s2 = suggestionsForItem(i, { days: 14, at: listedAt + 14 * DAY_MS, defaultFloor: 8 });
    assert.ok(s2.length >= 1);
    assert.ok(s2[0].toPrice >= 20);
    assert.equal(s2[0].toPrice, 36); // 10% of 40 is 36, which is above the $20 floor
  });
});

describe("scanner Buy up to", () => {
  it("returns a Buy-up-to figure from mid resale minus fees, shipping, and desired profit", () => {
    const r = scanResult({
      asking: 6,
      resaleLow: 20,
      resaleHigh: 32,
      siteIds: ["ebay"],
      weightOz: 16,
      desiredProfit: 8
    });
    assert.ok(r.buyUpTo != null);
    assert.match(r.buyUpToLabel, /Buy up to|Don't buy/i);
    assert.equal(r.assumptions.desiredProfit, 8);
    // mid resale 26, minus eBay fees, minus ship, minus 8.
    const mid = 26;
    assert.ok(r.buyUpTo <= mid - 8);
    assert.ok(r.assumptions.fees != null);
  });
});

describe("settings: pause, profit floor, no subscription", () => {
  it("defaults include a profit floor and pause off, and notes are plain", () => {
    const s = normalizeSettings({});
    assert.equal(s.pauseAutomation, false);
    assert.equal(s.defaultProfitFloor, 5);
    assert.equal(s.desiredProfit, 10);
    assert.deepEqual(s.boxes, []);
    assert.equal(DEFAULT_SETTINGS.pauseAutomation, false);
    assert.match(PAUSE_NOTE_ON, /paused/i);
    assert.match(NO_SUBSCRIPTION_NOTE, /no subscription/i);
    assert.match(NO_SUBSCRIPTION_NOTE, /complete app/i);
    const ls = mem();
    const next = setSettings({ pauseAutomation: true, defaultProfitFloor: 12, boxes: [{ label: "Shoebox", lengthIn: 14, widthIn: 9, heightIn: 5 }] }, ls);
    assert.equal(next.pauseAutomation, true);
    assert.equal(next.defaultProfitFloor, 12);
    assert.equal(next.boxes[0].label, "Shoebox");
    assert.equal(getSettings(ls).pauseAutomation, true);
  });
});

describe("sold data honesty and photo clean-up note", () => {
  it("says No sold data yet when nothing is logged, and lists date, condition, and confidence when it is", () => {
    const i = item({ title: "Mug" });
    assert.equal(hasSoldData(i), false);
    assert.equal(soldDataMessage(i), NO_SOLD_DATA);
    const withOne = addLoggedComp(i, { price: 18, siteId: "ebay", date: "2026-10-02", condition: "Good", confidence: "high", note: "Same mug" });
    assert.equal(hasSoldData(withOne), true);
    assert.equal(soldDataMessage(withOne), "");
    const c = withOne.comps.logged[0];
    assert.equal(c.date, "2026-10-02");
    assert.equal(c.condition, "Good");
    assert.equal(c.confidence, "high");
    // An AI estimate alone is not sold data
    const aiOnly = item({ comps: { ai: { low: 10, high: 20, source: "ai-estimate" }, logged: [] } });
    assert.equal(hasSoldData(aiOnly), false);
  });
  it("the clean-up note says it will not hide damage or blur or smooth", () => {
    assert.match(PHOTO_CLEANUP_NOTE, /does not hide damage/i);
    assert.match(PHOTO_CLEANUP_NOTE, /does not blur or smooth/i);
    // There is still no blur or smooth filter — autoLevels only stretches brightness.
    assert.equal(typeof autoLevels, "function");
  });
});

describe("tax export includes new cost fields and is still not tax advice", () => {
  it("adds supplies and refunds into the year and the CSV", () => {
    const a = markSold(item({ id: "a", title: "Mug", costPaid: 6, supplies: 1, refunds: 0 }, T(2026, 3, 1)), { siteId: "ebay", salePrice: 24, fees: 3.6, shippingPaid: 5, at: T(2026, 3, 10) });
    const t = yearTotals([a], [], 2026);
    assert.equal(t.supplies, 1);
    assert.equal(t.goodsProfit, money(24 - 6 - 3.6 - 5 - 1));
    const csv = yearCsv(t);
    assert.match(csv, /Not tax advice/);
    assert.match(csv, /Supplies/);
    assert.match(csv, /Mug/);
    assert.match(TAX_DISCLAIMER, /not tax advice/i);
  });
});

describe("backup still never includes a key", () => {
  it("exportPayload never has a key, even with new fields", () => {
    const i = item({ title: "Hat", receipts: [{ id: "rc_1", note: "Goodwill", dataUrl: "data:image/png;base64,xx" }] });
    const payload = exportPayload([i], "0.3.0", T(2026, 11, 12), { settings: { apiKey: "sk-secret", pauseAutomation: true } });
    const text = JSON.stringify(payload);
    assert.doesNotMatch(text, /sk-secret/);
    assert.equal("apiKey" in (payload.settings || {}), false);
    assert.equal(payload.version, "0.3.0");
    assert.equal(importPayload(payload)[0].title, "Hat");
  });
});

describe("shipping actual cost and saved boxes", () => {
  it("uses the actual cost when she enters one, otherwise the estimate", () => {
    const i = item({ packedWeightOz: 16, actualShipCost: 7.25 });
    const e = effectiveShipCost(i, 16);
    assert.equal(e.usd, 7.25);
    assert.equal(e.actual, true);
    assert.equal(e.approx, false);
    const est = effectiveShipCost(item({ packedWeightOz: 16 }), 16);
    assert.equal(est.actual, false);
    assert.equal(est.approx, true);
    assert.ok(est.usd > 0);
    const boxed = applyBoxToItem(item(), { id: "bx_1", label: "Shoebox", lengthIn: 14, widthIn: 9, heightIn: 5 });
    assert.equal(boxed.boxId, "bx_1");
    assert.equal(boxed.packedLengthIn, 14);
  });
});
