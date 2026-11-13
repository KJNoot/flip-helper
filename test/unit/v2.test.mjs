import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, emptyItem, setListed, markSold, profit, exportPayload, importPayload, importMileage, importSettings } from "../../app/js/core/inventory.js";
import { FEE_TABLE, FEE_TABLE_AS_OF, feeFor, feeRows, netAfterFees } from "../../app/js/core/fees.js";
import { IRS_BUSINESS_RATES, IRS_PAGE, defaultIrsRate, irsBandForDate, mileageRateFor, normalizeSettings, addTrip, getTrips, removeTrip, setTrips, getSettings, setSettings, ymd, newTripId } from "../../app/js/core/settings.js";
import { yearTotals, yearCsv, yearOf, TAX_DISCLAIMER, yearsFrom } from "../../app/js/core/taxes.js";
import { delistCountdown, shouldRemind, nextReminderAt, badgeCount, formatDuration, ACT_WITHIN_MS, REMIND_AT_MS, reminderBody } from "../../app/js/core/protect.js";
import { suggestionsForItem, suggestionsForAll, recordDropDecision, markPriceUpdated, pendingPriceUpdates, daysListed, dropPercent, DAY_MS } from "../../app/js/core/drops.js";
import { rateForWeight, shippingEstimates, defaultShippingCost, heuristicShip, normalizeShipSuggest, boxSizeLabel, labelLinksFor, SHIP_TABLE_AS_OF } from "../../app/js/core/shipping.js";
import { soldLinks, soldLinkKind, addLoggedComp, removeLoggedComp, loggedCompStats, setAiComps, normalizeAiComps, ebayOfficialAdapter, getCompsAdapter } from "../../app/js/core/comps.js";
import { verdictFromProfit, midPrice, scanResult, normalizeScanDraft, itemFromScan } from "../../app/js/core/scanner.js";
import { autoLevels, cropSquareBounds, cropToSquare, whitenBackground, luminancePercentile } from "../../app/js/core/photo.js";
import { SITES } from "../../app/js/core/sites.js";

const T = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh, 0, 0).getTime();
function item(partial = {}, at = T(2026, 11, 12)) {
  return emptyItem({ id: "it_test", ...partial }, at);
}
function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

describe("fees", () => {
  it("is dated November 2026 and covers every known site", () => {
    assert.equal(FEE_TABLE_AS_OF, "2026-11");
    for (const s of SITES) {
      assert.ok(FEE_TABLE[s.id], s.id);
      const row = feeFor(s.id, 50);
      assert.equal(row.approx, true);
      assert.ok(row.note);
    }
  });
  it("matches the published approximate schedules on a $50 sale", () => {
    assert.equal(feeFor("ebay", 50).fee, money(50 * 0.136 + 0.40)); // 7.20
    assert.equal(feeFor("ebay", 10).fee, money(10 * 0.136 + 0.30));
    assert.equal(feeFor("poshmark", 14.99).fee, 2.95);
    assert.equal(feeFor("poshmark", 15).fee, 3);
    assert.equal(feeFor("mercari", 50).fee, 5);
    assert.equal(feeFor("facebook", 50).fee, 5);
    assert.equal(feeFor("facebook", 50, { local: true }).fee, 0);
    assert.equal(feeFor("facebook", 5).fee, 0.80); // minimum
    assert.equal(feeFor("depop", 50).fee, money(50 * 0.033 + 0.45));
    assert.equal(feeFor("etsy", 50).fee, money(50 * 0.095 + 0.45));
    assert.equal(feeFor("vinted", 50).fee, 0);
    assert.equal(feeFor("craigslist", 50).fee, 0);
    assert.equal(feeFor("thredup", 50).fee, 0);
    assert.equal(feeFor("thredup", 50).payoutShare, true);
  });
  it("computes net after fees and lists rows in a stable order", () => {
    assert.equal(netAfterFees("mercari", 50), 45);
    const rows = feeRows(50, ["ebay", "poshmark"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].siteId, "ebay");
    assert.equal(rows[0].net, money(50 - rows[0].fee));
  });
});

describe("profit includes shipping she paid", () => {
  it("subtracts shippingPaid and treats a missing amount as zero", () => {
    const i = markSold(item({ costPaid: 20 }), { siteId: "ebay", salePrice: 50, fees: 8, shippingPaid: 6 });
    assert.equal(profit(i), 16);
    assert.equal(profit(markSold(item({ costPaid: 20 }), { siteId: "ebay", salePrice: 50, fees: 8 })), 22);
  });
});

describe("IRS mileage and settings", () => {
  it("uses 72.5 cents in the first half of 2026 and 76 cents after July 1", () => {
    assert.equal(irsBandForDate("2026-06-30").rate, 0.725);
    assert.match(irsBandForDate("2026-06-30").source, /Notice 2026-10/);
    assert.equal(irsBandForDate("2026-07-01").rate, 0.76);
    assert.match(irsBandForDate("2026-07-01").source, /Announcement 2026-11/);
    assert.equal(defaultIrsRate(T(2026, 11, 12)), 0.76);
    assert.equal(IRS_PAGE, "https://www.irs.gov/tax-professionals/standard-mileage-rates");
    assert.ok(IRS_BUSINESS_RATES.length >= 2);
  });
  it("lets Settings override the rate, and freezes a trip's rate when it is logged", () => {
    const ls = mem();
    const official = mileageRateFor("2026-11-12", { irsMileageRate: null });
    assert.equal(official.rate, 0.76);
    assert.equal(official.overridden, false);
    const over = mileageRateFor("2026-11-12", { irsMileageRate: 0.80 });
    assert.equal(over.rate, 0.80);
    assert.equal(over.overridden, true);
    const trip = addTrip({ date: "2026-03-02", miles: 10, purpose: "Post office" }, ls, T(2026, 3, 2));
    assert.equal(trip.rate, 0.725);
    assert.equal(trip.deduction, 7.25);
    const later = addTrip({ date: "2026-11-12", miles: 10, purpose: "Pickup" }, ls, T(2026, 11, 12));
    assert.equal(later.rate, 0.76);
    assert.equal(later.deduction, 7.60);
    assert.equal(getTrips(ls).length, 2);
    removeTrip(trip.id, ls);
    assert.equal(getTrips(ls).length, 1);
  });
  it("normalizes drop-after-days and a custom rate", () => {
    const s = normalizeSettings({ dropAfterDays: 21, irsMileageRate: "0.76" });
    assert.equal(s.dropAfterDays, 21);
    assert.equal(s.irsMileageRate, 0.76);
    assert.equal(normalizeSettings({ dropAfterDays: 0 }).dropAfterDays, 14);
  });
});

describe("tax year totals and CSV", () => {
  it("adds income, cost, fees, shipping, and mileage, and is not tax advice", () => {
    const a = markSold(item({ id: "a", title: "Mug", costPaid: 6 }, T(2026, 3, 1)), { siteId: "ebay", salePrice: 24, fees: 3.6, shippingPaid: 5, at: T(2026, 3, 10) });
    const b = markSold(item({ id: "b", title: "Hat", costPaid: 4 }, T(2026, 11, 1)), { siteId: "poshmark", salePrice: 20, fees: 4, at: T(2026, 11, 12) });
    const old = markSold(item({ id: "c", costPaid: 1 }, T(2025, 5, 1)), { siteId: "etsy", salePrice: 10, fees: 1, at: T(2025, 5, 2) });
    const trips = [
      { id: "t1", date: "2026-03-02", miles: 10, rate: 0.725, deduction: 7.25, purpose: "PO" },
      { id: "t2", date: "2026-11-01", miles: 8, rate: 0.76, deduction: 6.08, purpose: "Pickup" },
      { id: "t3", date: "2025-06-01", miles: 50, rate: 0.70, deduction: 35, purpose: "Old" }
    ];
    const t = yearTotals([a, b, old], trips, 2026);
    assert.equal(t.year, 2026);
    assert.equal(t.soldCount, 2);
    assert.equal(t.income, 44);
    assert.equal(t.cogs, 10);
    assert.equal(t.fees, 7.6);
    assert.equal(t.shipping, 5);
    assert.equal(t.goodsProfit, money(44 - 10 - 7.6 - 5));
    assert.equal(t.miles, 18);
    assert.equal(t.mileageDeduction, money(7.25 + 6.08));
    assert.match(TAX_DISCLAIMER, /not tax advice/i);
    const csv = yearCsv(t);
    assert.match(csv, /Not tax advice/);
    assert.match(csv, /Mug/);
    assert.match(csv, /Hat/);
    assert.doesNotMatch(csv, /sk-/);
    assert.match(csv, /Post office|PO/);
    assert.ok(yearsFrom([a, old], trips).includes(2026));
    assert.ok(yearsFrom([a, old], trips).includes(2025));
    assert.equal(yearOf("2026-11-12"), 2026);
  });
});

describe("double-sale protection", () => {
  function soldMulti(at = T(2026, 11, 12)) {
    let i = item({ title: "Scarf" }, at);
    i = setListed(i, "ebay", true, at);
    i = setListed(i, "poshmark", true, at);
    i = markSold(i, { siteId: "ebay", salePrice: 16, at });
    return i;
  }
  it("counts down 15 minutes, then shows overdue", () => {
    const soldAt = T(2026, 11, 12);
    const i = soldMulti(soldAt);
    const mid = delistCountdown(i, soldAt + 5 * 60 * 1000);
    assert.equal(mid.overdue, false);
    assert.deepEqual(mid.pending, ["poshmark"]);
    assert.match(mid.headline, /15 minutes|10:00|10m/i);
    const late = delistCountdown(i, soldAt + ACT_WITHIN_MS + 1000);
    assert.equal(late.overdue, true);
    assert.match(late.headline, /Still listed|sold/i);
    assert.equal(delistCountdown(item(), Date.now()), null);
    assert.equal(badgeCount([i, item()]), 1);
  });
  it("schedules reminders at 0, 5, 15, 30, 60 minutes, then every 2 hours", () => {
    const soldAt = 1_000_000;
    const i = soldMulti(soldAt);
    assert.equal(shouldRemind(i, null, soldAt + 1000), true, "immediate when just sold");
    assert.equal(shouldRemind(i, soldAt, soldAt + 1000), false, "already reminded at sale");
    assert.equal(shouldRemind(i, soldAt, soldAt + 5 * 60 * 1000), true);
    assert.equal(shouldRemind(i, soldAt + 5 * 60 * 1000, soldAt + 6 * 60 * 1000), false);
    assert.equal(shouldRemind(i, soldAt + 5 * 60 * 1000, soldAt + 15 * 60 * 1000), true);
    // Opening the app an hour later, never reminded: skip slot 0, fire a due later slot
    assert.equal(shouldRemind(i, null, soldAt + 60 * 60 * 1000), true);
    const next = nextReminderAt(i, soldAt + 15 * 60 * 1000, soldAt + 16 * 60 * 1000);
    assert.equal(next, soldAt + 30 * 60 * 1000);
    const body = reminderBody(i, soldAt + 1000);
    assert.match(body.title, /Take a listing down/);
    assert.match(body.body, /Scarf/);
    assert.doesNotMatch(body.body, /sk-/);
    assert.ok(REMIND_AT_MS.includes(0));
  });
  it("formats durations in plain language", () => {
    assert.equal(formatDuration(1000), "1 second");
    assert.equal(formatDuration(60 * 1000), "1 minute");
    assert.equal(formatDuration(2 * 60 * 60 * 1000), "2 hours");
    assert.match(formatDuration(65 * 1000, { clock: true }), /1:05|1m 5s/);
  });
});

describe("smart price drops", () => {
  it("suggests a 10% drop after N days, 15% after 2N, 20% after 3N, per site, with a floor", () => {
    const listedAt = T(2026, 10, 1);
    let i = setListed(item({ askingPrice: 40, priceLow: 20, title: "Jacket" }, listedAt), "ebay", true, listedAt);
    i = setListed(i, "poshmark", true, listedAt);
    assert.deepEqual(suggestionsForItem(i, { days: 14, at: listedAt + 13 * DAY_MS }), []);
    const at14 = listedAt + 14 * DAY_MS;
    const s14 = suggestionsForItem(i, { days: 14, at: at14 });
    assert.equal(s14.length, 2);
    assert.equal(s14[0].percent, 10);
    assert.equal(s14[0].toPrice, 36);
    assert.equal(s14.find(s => s.siteId === "poshmark").action, "offers");
    assert.equal(s14.find(s => s.siteId === "ebay").action, "offers");
    assert.match(s14[0].reason, /14 days/);
    const s28 = suggestionsForItem(i, { days: 14, at: listedAt + 28 * DAY_MS });
    assert.equal(s28[0].percent, 15);
    const s42 = suggestionsForItem(i, { days: 14, at: listedAt + 42 * DAY_MS });
    assert.equal(s42[0].percent, 20);
    assert.equal(daysListed(i, at14), 14);
    assert.equal(dropPercent(14, 14), 10);
  });
  it("approving updates the asking price and leaves a per-site to-do; dismissing hides it", () => {
    const listedAt = T(2026, 10, 1);
    let i = setListed(item({ id: "j", askingPrice: 40, title: "Jacket" }, listedAt), "ebay", true, listedAt);
    const sug = suggestionsForItem(i, { days: 14, at: listedAt + 14 * DAY_MS })[0];
    const approved = recordDropDecision(i, sug, "approved", listedAt + 14 * DAY_MS);
    assert.equal(approved.askingPrice, sug.toPrice);
    assert.deepEqual(pendingPriceUpdates(approved), ["ebay"]);
    const done = markPriceUpdated(approved, "ebay", true, listedAt + 14 * DAY_MS + 1000);
    assert.deepEqual(pendingPriceUpdates(done), []);
    const dismissed = recordDropDecision(i, sug, "dismissed", listedAt + 14 * DAY_MS);
    assert.equal(dismissed.askingPrice, 40);
    assert.equal(suggestionsForItem(dismissed, { days: 14, at: listedAt + 14 * DAY_MS }).length, 0);
    assert.equal(suggestionsForAll([i], { days: 14, at: listedAt + 13 * DAY_MS }).length, 0);
  });
  it("does not suggest for sold items or drafts", () => {
    const at = T(2026, 10, 1);
    const sold = markSold(setListed(item({ askingPrice: 20 }, at), "ebay", true, at), { siteId: "ebay", salePrice: 20, at: at + 20 * DAY_MS });
    assert.deepEqual(suggestionsForItem(sold, { days: 14, at: at + 20 * DAY_MS }), []);
    assert.deepEqual(suggestionsForItem(item({ askingPrice: 20 }), { days: 1, at: Date.now() }), []);
  });
});

describe("shipping estimates", () => {
  it("looks up approximate mid-zone rates by weight and is dated", () => {
    assert.equal(SHIP_TABLE_AS_OF, "2026-11");
    const ga = rateForWeight("uspsGroundAdvantage", 16);
    assert.equal(ga.name, "USPS Ground Advantage");
    assert.equal(ga.usd, 7.15);
    assert.equal(ga.approx, true);
    const pri = rateForWeight("uspsPriority", 16);
    assert.ok(pri.usd > ga.usd);
    const ups = rateForWeight("upsGround", 16);
    assert.ok(ups.usd > pri.usd);
    assert.equal(defaultShippingCost(16), 7.15);
    assert.equal(shippingEstimates(16).length, 3);
  });
  it("suggests a poly mailer for clothes and a sturdy box for a mug", () => {
    const scarf = heuristicShip({ title: "Yellow knit scarf", category: "Women's accessories" });
    assert.match(scarf.boxLabel, /mailer/i);
    assert.ok(scarf.weightOz <= 16);
    const mug = heuristicShip({ title: "Lakeview Pottery mug", category: "Kitchen" });
    assert.match(mug.boxLabel, /box/i);
    assert.ok(mug.weightOz >= 16);
    const n = normalizeShipSuggest({ box: "Small box", weightOz: 24, l: 8, w: 8, h: 8, reason: "padded" }, "ai");
    assert.equal(n.weightOz, 24);
    assert.equal(n.weightLb, 1.5);
    assert.match(boxSizeLabel(n), /Small box/);
    const links = labelLinksFor("ebay");
    assert.equal(links[0].id, "ebay");
    assert.match(links[0].url, /ebay\.com/);
  });
});

describe("sold price check", () => {
  it("puts eBay sold and completed first, and labels real sold filters", () => {
    const { query, links } = soldLinks({ title: "Blue mug & co" }, ["poshmark", "etsy"]);
    assert.equal(query, "Blue mug & co");
    assert.equal(links[0].id, "ebay");
    assert.equal(links[0].kind, "sold-completed");
    assert.equal(links[0].realSoldFilter, true);
    assert.match(links[0].url, /LH_Sold=1/);
    assert.match(links[0].url, /LH_Complete=1/);
    const posh = links.find(l => l.id === "poshmark");
    assert.equal(posh.kind, "sold-out");
    assert.match(posh.url, /sold_out/);
    const etsy = links.find(l => l.id === "etsy");
    assert.equal(etsy.kind, "search");
    assert.equal(etsy.realSoldFilter, false);
  });
  it("logs sold prices she found and averages them", () => {
    let i = item({ title: "Mug" });
    i = addLoggedComp(i, { price: 18, siteId: "ebay", note: "like new" }, 1);
    i = addLoggedComp(i, { price: 22, siteId: "ebay" }, 2);
    i = addLoggedComp(i, { price: 20, siteId: "poshmark" }, 3);
    const s = loggedCompStats(i);
    assert.equal(s.count, 3);
    assert.equal(s.low, 18);
    assert.equal(s.high, 22);
    assert.equal(s.average, 20);
    assert.equal(s.median, 20);
    i = removeLoggedComp(i, i.comps.logged[0].id);
    assert.equal(loggedCompStats(i).count, 2);
  });
  it("stores an AI estimate and exposes a coming-soon official eBay adapter that does not scrape", async () => {
    let i = setAiComps(item(), normalizeAiComps({ low: 12, high: 20, typical: 16, reason: "Estimate only.", confidence: "low" }));
    assert.equal(i.comps.ai.low, 12);
    assert.equal(i.comps.ai.typical, 16);
    assert.equal(ebayOfficialAdapter.available, false);
    assert.equal(ebayOfficialAdapter.status, "coming-soon");
    assert.match(ebayOfficialAdapter.needs, /developer account/i);
    assert.match(ebayOfficialAdapter.endpoints.itemSales, /marketplace_insights/);
    assert.equal(ebayOfficialAdapter.isConfigured(), false);
    const res = await ebayOfficialAdapter.fetchSoldComps("mug");
    assert.equal(res.ok, false);
    assert.equal(res.status, "coming-soon");
    assert.equal(getCompsAdapter().id, "ebay-official");
    // No scrape URL or hidden fetch in the adapter surface
    assert.equal("scrape" in ebayOfficialAdapter, false);
  });
});

describe("buy-or-pass scanner", () => {
  it("gives Buy, Maybe, and Pass from clear profit thresholds", () => {
    assert.equal(verdictFromProfit({ netLow: 12, netMid: 20, asking: 8 }), "buy");
    assert.equal(verdictFromProfit({ netLow: 4, netMid: 10, asking: 8 }), "buy"); // $4 low and 125% ROI
    assert.equal(verdictFromProfit({ netLow: -2, netMid: -1, asking: 20 }), "pass");
    assert.equal(verdictFromProfit({ netLow: 1, netMid: 3, asking: 30 }), "pass");
    assert.equal(verdictFromProfit({ netLow: 2, netMid: 8, asking: 20 }), "maybe");
    assert.equal(midPrice(10, 20), 15);
  });
  it("builds per-site profit after approximate fees and shipping", () => {
    const r = scanResult({
      asking: 8,
      resaleLow: 24,
      resaleHigh: 32,
      siteIds: ["ebay", "poshmark", "facebook"],
      weightOz: 8,
      shippingOverride: 6
    });
    assert.equal(r.resaleMid, 28);
    assert.equal(r.asking, 8);
    const ebay = r.rows.find(x => x.siteId === "ebay");
    // mid 28, ebay fee 28*0.136+0.40 = 4.208 -> 4.21, ship 6, profit 28-8-4.21-6 = 9.79
    assert.equal(ebay.shipping, 6);
    assert.equal(ebay.feeMid, money(28 * 0.136 + 0.40));
    assert.equal(ebay.netMid, money(28 - 8 - ebay.feeMid - 6));
    const fb = r.rows.find(x => x.siteId === "facebook");
    assert.equal(fb.shipping, 0);
    assert.equal(fb.feeMid, 0); // local
    assert.equal(fb.netMid, money(28 - 8));
    assert.ok(["buy", "maybe", "pass"].includes(r.verdict));
    assert.equal(r.approx, true);
  });
  it("normalizes a draft and can save it as an inventory item", () => {
    const d = normalizeScanDraft({
      title: "Blue mug",
      brand: "Unknown",
      priceLow: "20",
      price_high: 30,
      daysToSell: "Fast",
      box: "Small box",
      weightOz: 24
    });
    assert.equal(d.brand, "");
    assert.equal(d.priceLow, 20);
    assert.equal(d.daysToSell, "fast");
    assert.equal(d.ship.weightOz, 24);
    const it = itemFromScan({ draft: d, asking: 6, photos: [{ dataUrl: "data:image/png;base64,xx" }], result: { verdict: "buy", netMid: 12 } }, 5);
    assert.equal(it.title, "Blue mug");
    assert.equal(it.costPaid, 6);
    assert.equal(it.scan.verdict, "buy");
    assert.equal(it.stage, "draft");
  });
});

describe("basic photo clean-up", () => {
  function solid(w, h, r, g, b) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    }
    return data;
  }
  it("brightens a dark image and crops to a centered square", () => {
    const dark = solid(4, 4, 40, 40, 40);
    const out = autoLevels(dark, 4, 4);
    const before = luminancePercentile(dark, 4, 4, 0.5);
    const after = luminancePercentile(out, 4, 4, 0.5);
    assert.ok(after > before, `expected ${after} > ${before}`);
    const b = cropSquareBounds(10, 6);
    assert.equal(b.side, 6);
    assert.equal(b.x, 2);
    assert.equal(b.y, 0);
    const wide = solid(6, 4, 10, 10, 10);
    const cropped = cropToSquare(wide, 6, 4);
    assert.equal(cropped.width, 4);
    assert.equal(cropped.height, 4);
    assert.equal(cropped.data.length, 4 * 4 * 4);
  });
  it("whitens a light, even background and leaves a dark subject in the middle", () => {
    const w = 12, h = 12;
    const data = solid(w, h, 230, 230, 230);
    // dark subject in the center
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) {
      const o = (y * w + x) * 4;
      data[o] = 20; data[o + 1] = 20; data[o + 2] = 40;
    }
    const out = whitenBackground(data, w, h);
    // a corner pixel should be closer to white
    assert.ok(out[0] >= data[0], "corner got at least as light");
    assert.ok(out[0] > 230 || out[0] === 255 || out[0] >= 230);
    // center subject should stay dark (not forced to white)
    const co = (6 * w + 6) * 4;
    assert.ok(out[co] < 80, `center stayed dark, got ${out[co]}`);
  });
  it("does not invent a cut-out on a dark background", () => {
    const data = solid(8, 8, 20, 20, 20);
    const out = whitenBackground(data, 8, 8);
    assert.equal(out[0], 20);
    assert.equal(out[1], 20);
  });
});

describe("backup still never includes a key, and can carry mileage", () => {
  it("round-trips mileage and settings without a key", () => {
    const i = markSold(item({ title: "Hat", costPaid: 4, shippingPaid: 3 }), { siteId: "depop", salePrice: 20, fees: 1, at: T(2026, 11, 1) });
    const payload = exportPayload([i], "0.2.0", T(2026, 11, 12), {
      enabledSites: ["depop"],
      mileage: [{ id: "mi_1", date: "2026-11-01", miles: 5, rate: 0.76, deduction: 3.8, purpose: "PO", rateSource: "IRS" }],
      settings: { dropAfterDays: 21, irsMileageRate: null, apiKey: "sk-should-never-appear", key: "nope" }
    });
    assert.equal(payload.version, "0.2.0");
    assert.equal("apiKey" in payload.settings, false);
    assert.equal("key" in payload.settings, false);
    const text = JSON.stringify(payload);
    assert.doesNotMatch(text, /sk-/);
    assert.equal(importMileage(payload)[0].miles, 5);
    assert.equal(importSettings(payload).dropAfterDays, 21);
    assert.equal(importSettings(payload).apiKey, undefined);
    assert.equal(importPayload(payload)[0].shippingPaid, 3);
    assert.equal(profit(importPayload(payload)[0]), money(20 - 4 - 1 - 3));
  });
});
