import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  money, emptyItem, deriveStage, listedSiteIds, setListed, markSold, markDelisted,
  delistTargets, pendingDelist, isFullyDelisted, needsDelistHighlight, profit,
  monthKey, monthTotals, firstListedAt, markShipped, setShipCheck, listingCopy,
  formatUsd, priceRangeLabel, statusLine, exportPayload, importPayload, importEnabledSites,
  applyFields, SHIP_CHECKS, normalizeAdvice, hasAdvice, planSiteIds, setSitePlan
} from "../../app/js/core/inventory.js";
import { SITES, isKnownSite, searchQuery, siteName } from "../../app/js/core/sites.js";
import { extractJson, normalizeDraft, applyDraft, friendlyApiError } from "../../app/js/core/draft.js";
import { keyStore } from "../../app/js/core/key.js";
import { suggestMailto, SUGGEST_TO, SUGGEST_SUBJECT } from "../../app/js/ui/suggest.js";

const T = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh, 0, 0).getTime();

function item(partial = {}, at = T(2026, 11, 12)) {
  return emptyItem({ id: "it_test", ...partial }, at);
}

describe("money", () => {
  it("parses numbers and common strings", () => {
    assert.equal(money(12.5), 12.5);
    assert.equal(money("12.50"), 12.5);
    assert.equal(money("$1,200.10"), 1200.1);
    assert.equal(money("  $8  "), 8);
    assert.equal(money(0), 0);
    assert.equal(money(""), null);
    assert.equal(money(null), null);
    assert.equal(money(undefined), null);
    assert.equal(money("nope"), null);
    assert.equal(money(NaN), null);
  });
  it("rounds to cents", () => {
    assert.equal(money(12.349), 12.35);
    assert.equal(money(12.341), 12.34);
    assert.equal(money("7.1") - money("3.02"), money(4.08));
  });
});

describe("stages", () => {
  it("starts as a draft", () => {
    const i = item();
    assert.equal(i.stage, "draft");
    assert.deepEqual(listedSiteIds(i), []);
  });
  it("moves to listed when a known site is marked", () => {
    let i = setListed(item(), "ebay", true, T(2026, 11, 1));
    assert.equal(i.stage, "listed");
    assert.deepEqual(listedSiteIds(i), ["ebay"]);
    assert.equal(i.listedOn.ebay.at, T(2026, 11, 1));
    i = setListed(i, "poshmark", true, T(2026, 11, 2));
    assert.deepEqual(listedSiteIds(i), ["ebay", "poshmark"]);
  });
  it("ignores unknown sites", () => {
    const i = setListed(item(), "not-a-site", true);
    assert.equal(i.stage, "draft");
    assert.deepEqual(listedSiteIds(i), []);
    assert.equal(isKnownSite("not-a-site"), false);
    assert.equal(isKnownSite("grailed"), true);
    assert.equal(isKnownSite("ebay"), true);
  });
  it("goes back to draft if the last listing is cleared", () => {
    let i = setListed(item(), "etsy", true);
    i = setListed(i, "etsy", false);
    assert.equal(i.stage, "draft");
    assert.deepEqual(listedSiteIds(i), []);
  });
  it("moves to sold when marked sold, and to shipped after a sale", () => {
    let i = setListed(item(), "mercari", true);
    i = markSold(i, { siteId: "mercari", salePrice: 40, fees: 5, at: T(2026, 11, 10) });
    assert.equal(i.stage, "sold");
    assert.equal(i.soldOn, "mercari");
    assert.equal(i.salePrice, 40);
    i = markShipped(i, true, T(2026, 11, 11));
    assert.equal(i.stage, "shipped");
    i = markShipped(i, false);
    assert.equal(i.stage, "sold");
  });
  it("does not mark shipped if it has not sold", () => {
    const i = markShipped(setListed(item(), "ebay", true), true);
    assert.equal(i.stage, "listed");
    assert.equal(i.shippedAt, null);
  });
  it("auto-ships when every packing box is checked after a sale", () => {
    let i = markSold(setListed(item(), "depop", true), { siteId: "depop", salePrice: 20, at: T(2026, 11, 10) });
    for (const c of SHIP_CHECKS) i = setShipCheck(i, c.id, true, T(2026, 11, 12));
    assert.equal(i.stage, "shipped");
    assert.equal(i.shippedAt, T(2026, 11, 12));
  });
  it("editing fields does not change the stage", () => {
    let i = setListed(item(), "facebook", true);
    i = applyFields(i, { title: "Blue mug", askingPrice: "18" });
    assert.equal(i.stage, "listed");
    assert.equal(i.askingPrice, 18);
    assert.equal(i.title, "Blue mug");
  });
});

describe("delist checklist", () => {
  it("is empty until the item is sold", () => {
    let i = setListed(item(), "ebay", true);
    i = setListed(i, "poshmark", true);
    assert.deepEqual(delistTargets(i), []);
    assert.equal(needsDelistHighlight(i), false);
    assert.equal(isFullyDelisted(i), true);
  });
  it("lists the other sites she listed on, not the one it sold on", () => {
    let i = item();
    i = setListed(i, "ebay", true);
    i = setListed(i, "poshmark", true);
    i = setListed(i, "mercari", true);
    i = markSold(i, { siteId: "ebay", salePrice: 50, at: T(2026, 11, 12) });
    assert.deepEqual(delistTargets(i), ["mercari", "poshmark"]);
    assert.deepEqual(pendingDelist(i), ["mercari", "poshmark"]);
    assert.equal(needsDelistHighlight(i), true);
    assert.equal(isFullyDelisted(i), false);
    assert.match(statusLine(i), /take it down on 2 sites/);
  });
  it("adds a sale site to listedOn if it was missing, and does not ask to delist that site", () => {
    let i = setListed(item(), "poshmark", true);
    i = markSold(i, { siteId: "ebay", salePrice: 10, at: T(2026, 11, 12) });
    assert.ok(listedSiteIds(i).includes("ebay"));
    assert.deepEqual(delistTargets(i), ["poshmark"]);
    assert.equal(i.soldOn, "ebay");
  });
  it("has no checklist when the only listing is the one that sold", () => {
    let i = markSold(setListed(item(), "etsy", true), { siteId: "etsy", salePrice: 12, at: T(2026, 11, 12) });
    assert.deepEqual(delistTargets(i), []);
    assert.equal(needsDelistHighlight(i), false);
    assert.equal(isFullyDelisted(i), true);
  });
  it("clears the highlight as each site is checked off, including after shipping", () => {
    let i = item();
    i = setListed(i, "ebay", true);
    i = setListed(i, "poshmark", true);
    i = setListed(i, "depop", true);
    i = markSold(i, { siteId: "ebay", salePrice: 30, at: T(2026, 11, 12) });
    i = markDelisted(i, "poshmark", true, T(2026, 11, 12));
    assert.deepEqual(pendingDelist(i), ["depop"]);
    assert.equal(needsDelistHighlight(i), true);
    i = markDelisted(i, "depop", true);
    assert.equal(isFullyDelisted(i), true);
    assert.equal(needsDelistHighlight(i), false);
    i = markShipped(i, true);
    assert.equal(i.stage, "shipped");
    assert.equal(needsDelistHighlight(i), false);
    // still highlights if shipped but not delisted
    i = markDelisted(i, "depop", false);
    assert.equal(needsDelistHighlight(i), true);
    assert.match(statusLine(i), /take it down/);
  });
  it("ignores unknown site ids when checking off", () => {
    let i = markSold(setListed(item(), "mercari", true), { siteId: "ebay", salePrice: 8, at: T(2026, 11, 1) });
    const before = JSON.stringify(i.delistedOn);
    i = markDelisted(i, "not-a-site", true);
    assert.equal(JSON.stringify(i.delistedOn), before);
  });
  it("clearing a listing also drops its delist check", () => {
    let i = item();
    i = setListed(i, "facebook", true);
    i = setListed(i, "etsy", true);
    i = markSold(i, { siteId: "etsy", salePrice: 9, at: T(2026, 11, 1) });
    i = markDelisted(i, "facebook", true);
    i = setListed(i, "facebook", false);
    assert.deepEqual(delistTargets(i), []);
    assert.equal(i.delistedOn.facebook, undefined);
  });
});

describe("profit", () => {
  it("is sale minus cost minus fees", () => {
    const i = markSold(item({ costPaid: 20 }), { siteId: "ebay", salePrice: 50, fees: 8.5 });
    assert.equal(profit(i), 21.5);
  });
  it("treats missing cost or fees as zero", () => {
    assert.equal(profit(markSold(item(), { siteId: "ebay", salePrice: 50 })), 50);
    assert.equal(profit(item({ salePrice: 50, costPaid: 10 })), 40);
  });
  it("is null until there is a sale price, including a sale of zero", () => {
    assert.equal(profit(item({ costPaid: 10 })), null);
    assert.equal(profit(item({ salePrice: 0, costPaid: 10 })), -10);
  });
  it("accepts string form amounts", () => {
    const i = item({ salePrice: "$80.00", costPaid: "25", fees: "7.25" });
    assert.equal(profit(i), 47.75);
  });
});

describe("month totals", () => {
  it("counts listings and sales in the current month only", () => {
    const jan = T(2026, 1, 20);
    const feb1 = T(2026, 2, 1);
    const feb10 = T(2026, 2, 10);
    const feb15 = T(2026, 2, 15);
    const a = markSold(setListed(item({ id: "a", costPaid: 10 }, jan), "ebay", true, jan), { siteId: "ebay", salePrice: 40, fees: 5, at: jan });
    const b = setListed(item({ id: "b" }, feb1), "poshmark", true, feb1);
    const c = setListed(setListed(item({ id: "c" }, feb1), "ebay", true, feb1), "mercari", true, feb10); // one item, two sites
    const d = markSold(setListed(item({ id: "d", costPaid: 8 }, feb1), "depop", true, feb1), { siteId: "depop", salePrice: 30, fees: 2, at: feb15 });
    const e = markSold(setListed(item({ id: "e", salePrice: null }, feb1), "etsy", true, feb1), { siteId: "etsy", at: feb15 });
    // e has no sale price (markSold without salePrice leaves it null)
    const totals = monthTotals([a, b, c, d, e], feb15);
    assert.equal(totals.month, "2026-02");
    assert.equal(totals.listed, 4, "b,c,d,e listed in Feb; a was January");
    assert.equal(totals.sold, 2, "d and e sold in Feb; a sold in January");
    assert.equal(totals.profit, 20, "d profit 20; e has no sale price so adds 0");
  });
  it("uses the device's local calendar, including month boundaries", () => {
    const last = new Date(2026, 2, 31, 23, 30).getTime(); // March 31
    const first = new Date(2026, 3, 1, 0, 15).getTime();  // April 1
    const marchItem = setListed(item({ id: "m" }, last), "ebay", true, last);
    const aprilItem = setListed(item({ id: "a" }, first), "ebay", true, first);
    assert.equal(monthKey(last), "2026-03");
    assert.equal(monthKey(first), "2026-04");
    assert.equal(monthTotals([marchItem, aprilItem], last).listed, 1);
    assert.equal(monthTotals([marchItem, aprilItem], first).listed, 1);
  });
  it("is zero for an empty list", () => {
    const t = monthTotals([], T(2026, 11, 12));
    assert.deepEqual(t, { listed: 0, sold: 0, profit: 0, month: "2026-11" });
  });
  it("firstListedAt is the earliest site listing", () => {
    let i = setListed(item(), "etsy", true, T(2026, 11, 10));
    i = setListed(i, "ebay", true, T(2026, 11, 2));
    assert.equal(firstListedAt(i), T(2026, 11, 2));
  });
});

describe("listing copy and labels", () => {
  it("uses site-specific title and notes when present", () => {
    const i = item({
      title: "Blue mug",
      description: "A nice mug.",
      condition: "Good",
      brand: "Lakeview",
      category: "Kitchen",
      askingPrice: 18,
      siteTweaks: { ebay: { title: "Lakeview Pottery Blue Ceramic Mug", notes: "Use category: Pottery." } }
    });
    const text = listingCopy(i, "ebay");
    assert.match(text, /Lakeview Pottery Blue Ceramic Mug/);
    assert.match(text, /A nice mug/);
    assert.match(text, /Price: \$18\.00/);
    assert.match(text, /Condition: Good/);
    assert.match(text, /Use category: Pottery/);
    const plain = listingCopy(i, "poshmark");
    assert.match(plain, /^Blue mug/m);
    assert.doesNotMatch(plain, /Pottery Blue/);
  });
  it("formats a price range and status", () => {
    assert.equal(priceRangeLabel({ priceLow: 10, priceHigh: 20 }), "$10.00 to $20.00");
    assert.equal(priceRangeLabel({ priceLow: 15, priceHigh: 15 }), "$15.00");
    assert.equal(formatUsd(null), "—");
    assert.equal(statusLine(item({ title: "x" })), "Draft");
    assert.match(statusLine(setListed(item(), "ebay", true)), /Listed on eBay/);
  });
  it("builds sold-search links with encoded queries", () => {
    const ebay = SITES.find(s => s.id === "ebay");
    const url = ebay.soldSearch("blue mug & co");
    assert.match(url, /LH_Sold=1/);
    assert.match(url, /blue%20mug%20%26%20co/);
    assert.equal(searchQuery({ title: "Red hat" }), "Red hat");
    assert.equal(searchQuery({ brand: "Nike", category: "Shoes" }), "Nike Shoes");
    assert.equal(siteName("facebook"), "Facebook");
    assert.equal(SITES.length, 14);
  });
});

describe("backup export", () => {
  it("never includes a key field and round-trips items", () => {
    const i = setListed(item({ title: "Hat", costPaid: 4 }), "depop", true, T(2026, 11, 1));
    const payload = exportPayload([i], "0.1.0", T(2026, 11, 12));
    assert.equal(payload.app, "flip-helper");
    assert.equal(payload.version, "0.1.0");
    assert.equal(payload.items[0].title, "Hat");
    assert.equal("apiKey" in payload, false);
    assert.equal("key" in payload, false);
    const text = JSON.stringify(payload);
    assert.doesNotMatch(text, /sk-/);
    const back = importPayload(payload);
    assert.equal(back[0].title, "Hat");
    assert.equal(back[0].stage, "listed");
  });
  it("rejects a file from another app", () => {
    assert.throws(() => importPayload({ app: "other", items: [] }), /not a Jessika's Flip Side/);
    assert.throws(() => importPayload("nope"), /couldn't be read/);
    assert.throws(() => importPayload({ app: "flip-helper" }), /no items/);
  });
});

describe("draft parsing", () => {
  it("reads clean JSON and messy fenced JSON", () => {
    const clean = extractJson('{"title":"Blue mug","priceLow":12}');
    assert.equal(clean.title, "Blue mug");
    const messy = extractJson(`Sure, here you go:\n\`\`\`json\n{\n  "title": "Red hat",\n  "price_low": "15",\n  "siteTweaks": { "ebay": { "title": "Red Wool Hat" } }\n}\n\`\`\`\nHope that helps.`);
    const d = normalizeDraft(messy);
    assert.equal(d.title, "Red hat");
    assert.equal(d.priceLow, 15);
    assert.equal(d.siteTweaks.ebay.title, "Red Wool Hat");
  });
  it("treats unknown brand as empty and maps facebook aliases", () => {
    const d = normalizeDraft({
      title: "Chair",
      brand: "Unknown",
      site_tweaks: { facebook_marketplace: { notes: "Local pickup." } }
    });
    assert.equal(d.brand, "");
    assert.equal(d.siteTweaks.facebook.notes, "Local pickup.");
  });
  it("throws on empty or non-JSON output", () => {
    assert.throws(() => extractJson(""), /empty/);
    assert.throws(() => extractJson("sorry, I cannot"), /wasn't in a form|weren't in a form/);
  });
  it("applyDraft fills asking price from the high estimate", () => {
    const i = applyDraft(item({ costPaid: 5 }), { title: "Mug", priceLow: 12, priceHigh: 18, priceReason: "rough guess" });
    assert.equal(i.title, "Mug");
    assert.equal(i.askingPrice, 18);
    assert.equal(i.costPaid, 5);
    assert.equal(i.priceReason, "rough guess");
  });
  it("normalizeDraft is idempotent: a second pass (Apply on an already-normalized draft) keeps siteAdvice", () => {
    const raw = {
      title: "Speckled mug",
      bestPrice: { sites: ["ebay", "etsy"], reason: "Often brings more here." },
      fastestSale: { sites: ["facebook", "mercari"], reason: "Can sell faster locally." }
    };
    const once = normalizeDraft(raw);
    assert.deepEqual(once.siteAdvice.bestPrice.sites, ["ebay", "etsy"]);
    assert.deepEqual(once.siteAdvice.fastestSale.sites, ["facebook", "mercari"]);
    assert.match(once.siteAdvice.bestPrice.reason, /more/);
    const twice = normalizeDraft(once);
    assert.deepEqual(twice.siteAdvice, once.siteAdvice);
    // This is the Apply path: requestDraft already normalized, applyDraft normalizes again.
    const applied = applyDraft(item({ costPaid: 4 }), once);
    assert.deepEqual(applied.siteAdvice.bestPrice.sites, ["ebay", "etsy"]);
    assert.deepEqual(applied.siteAdvice.fastestSale.sites, ["facebook", "mercari"]);
    assert.match(applied.siteAdvice.bestPrice.reason, /more/);
    assert.match(applied.siteAdvice.fastestSale.reason, /faster/);
  });
  it("maps API errors to plain language and never includes a key", () => {
    assert.match(friendlyApiError(401, "Incorrect API key"), /not accepted/);
    assert.match(friendlyApiError(429, ""), /busy|limit/);
    assert.match(friendlyApiError(500, ""), /problem/);
    assert.doesNotMatch(friendlyApiError(401, "sk-abc"), /sk-abc/);
  });
});

describe("device-held key store", () => {
  it("saves, reads, and removes a key only in the given storage", () => {
    const mem = new Map();
    const ls = {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k)
    };
    const k = keyStore(ls);
    assert.equal(k.has(), false);
    k.set("  secret-test-value  ");
    assert.equal(k.get(), "secret-test-value");
    assert.equal(k.has(), true);
    assert.equal([...mem.keys()].length, 1);
    k.remove();
    assert.equal(k.get(), "");
    assert.equal(k.has(), false);
  });
});

describe("suggestion mailto", () => {
  it("uses the Flip Side subject and prefills version and screen", () => {
    const href = suggestMailto({ version: "0.1.0", screen: "Home", text: "Add Grailed" });
    assert.ok(href.startsWith(`mailto:${SUGGEST_TO}?`));
    assert.equal(SUGGEST_SUBJECT, "Flip Side suggestion");
    assert.match(href, /subject=Flip%20Side%20suggestion/);
    const body = decodeURIComponent(href.split("body=")[1]);
    assert.match(body, /App version: 0\.1\.0/);
    assert.match(body, /Screen: Home/);
    assert.match(body, /Add Grailed/);
  });
});
