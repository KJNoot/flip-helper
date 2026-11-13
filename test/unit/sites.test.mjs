import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SITES, SITE_IDS, SITE_GROUPS, DEFAULT_ENABLED, isKnownSite, knownSiteIds, siteName, searchQuery } from "../../app/js/core/sites.js";
import { getEnabledIds, setEnabledIds, clearEnabledIds, enabledSites, sitesForItem, PREFS_KEY } from "../../app/js/core/prefs.js";
import {
  emptyItem, normalizeAdvice, hasAdvice, planSiteIds, setSitePlan,
  exportPayload, importPayload, importEnabledSites, markSold, setListed, delistTargets
} from "../../app/js/core/inventory.js";
import { normalizeDraft } from "../../app/js/core/draft.js";

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m
  };
}

describe("selling sites", () => {
  it("lists every major site Ken asked for", () => {
    const ids = SITE_IDS.slice().sort();
    for (const id of ["ebay", "poshmark", "mercari", "facebook", "etsy", "depop",
                      "vinted", "grailed", "shopify", "offerup", "craigslist",
                      "whatnot", "kidizen", "thredup"]) {
      assert.equal(isKnownSite(id), true, id);
    }
    assert.equal(SITES.length, 14);
    assert.equal(SITE_IDS.length, 14);
    assert.equal(new Set(SITE_IDS).size, 14, "ids are unique");
    assert.ok(SITE_GROUPS.length >= 4);
    assert.ok(SITES.every(s => s.sellUrl && s.manageUrl && typeof s.soldSearch === "function"));
    assert.match(SITES.find(s => s.id === "craigslist").note, /city/i);
    assert.match(SITES.find(s => s.id === "thredup").note, /consignment/i);
    assert.match(SITES.find(s => s.id === "shopify").note, /own shop/i);
  });
  it("default enabled set is the usual first six, all known", () => {
    assert.deepEqual(DEFAULT_ENABLED, ["ebay", "poshmark", "mercari", "facebook", "etsy", "depop"]);
    assert.ok(DEFAULT_ENABLED.every(isKnownSite));
  });
});

describe("enabled-site prefs", () => {
  it("defaults, saves, and ignores unknown ids", () => {
    const ls = mem();
    assert.deepEqual(getEnabledIds(ls), DEFAULT_ENABLED);
    const saved = setEnabledIds(["ebay", "grailed", "not-a-site", "ebay"], ls);
    assert.deepEqual(saved, ["ebay", "grailed"]);
    assert.deepEqual(getEnabledIds(ls), ["ebay", "grailed"]);
    assert.equal(enabledSites(ls).map(s => s.id).join(), "ebay,grailed");
    clearEnabledIds(ls);
    assert.deepEqual(getEnabledIds(ls), DEFAULT_ENABLED);
    assert.equal(ls.getItem(PREFS_KEY), null);
  });
  it("sitesForItem adds listed, sold, and advised sites to the enabled list", () => {
    const ls = mem();
    setEnabledIds(["ebay", "poshmark"], ls);
    let i = emptyItem({
      siteAdvice: { bestPrice: { sites: ["etsy"], reason: "handmade" }, fastestSale: { sites: ["facebook"] } }
    });
    i = setListed(i, "vinted", true);
    i = markSold(i, { siteId: "mercari", salePrice: 10, at: 1 });
    const ids = sitesForItem(i, ls);
    for (const id of ["ebay", "poshmark", "etsy", "facebook", "vinted", "mercari"]) {
      assert.ok(ids.includes(id), id);
    }
    assert.ok(!ids.includes("grailed"));
    assert.deepEqual(ids, knownSiteIds(ids), "stable site order");
  });
});

describe("site advice and plans", () => {
  it("drops unknown ids and unions both", () => {
    const a = normalizeAdvice({
      best_price: { sites: ["ebay", "etsy", "ebay", "nope"], reason: "Collectors pay more." },
      fastestSale: { sites: ["facebook", "mercari"], reason: "Local pickup is quicker." }
    });
    assert.deepEqual(a.bestPrice.sites, ["ebay", "etsy"]);
    assert.equal(a.bestPrice.reason, "Collectors pay more.");
    assert.deepEqual(a.fastestSale.sites, ["facebook", "mercari"]);
    const item = emptyItem({ siteAdvice: a, sitePlan: "own" });
    assert.equal(hasAdvice(item), true);
    assert.deepEqual(planSiteIds(item, "bestPrice"), ["ebay", "etsy"]);
    assert.deepEqual(planSiteIds(item, "fastestSale"), ["facebook", "mercari"]);
    assert.deepEqual(planSiteIds(item, "both"), ["ebay", "facebook", "mercari", "etsy"]);
    assert.deepEqual(planSiteIds(item, "own"), []);
    const next = setSitePlan(item, "both");
    assert.equal(next.sitePlan, "both");
    assert.deepEqual(planSiteIds(next), ["ebay", "facebook", "mercari", "etsy"]);
    assert.equal(hasAdvice(emptyItem()), false);
  });
  it("parses advice out of a draft, including facebook aliases", () => {
    const d = normalizeDraft({
      title: "Blue mug",
      bestPrice: { sites: ["etsy", "ebay"], reason: "Handmade pottery often brings more on Etsy." },
      fastest_sale: { sites: ["facebook"], reason: "Local pickup." },
      siteTweaks: { grailed: { notes: "Not a fit." } }
    });
    assert.deepEqual(d.siteAdvice.bestPrice.sites, ["ebay", "etsy"]);
    assert.deepEqual(d.siteAdvice.fastestSale.sites, ["facebook"]);
    assert.equal(d.siteTweaks.grailed.notes, "Not a fit.");
  });
  it("keeps delist logic working on newly added sites", () => {
    let i = emptyItem();
    i = setListed(i, "vinted", true);
    i = setListed(i, "grailed", true);
    i = setListed(i, "kidizen", true);
    i = markSold(i, { siteId: "vinted", salePrice: 20, at: 5 });
    assert.deepEqual(delistTargets(i), ["grailed", "kidizen"]);
  });
  it("includes enabled sites in a backup and never a key", () => {
    const i = setListed(emptyItem({ id: "a", title: "Hat" }), "offerup", true);
    const payload = exportPayload([i], "0.1.0", Date.now(), { enabledSites: ["offerup", "whatnot", "nope"] });
    assert.deepEqual(payload.enabledSites, ["offerup", "whatnot"]);
    assert.equal("apiKey" in payload, false);
    assert.deepEqual(importEnabledSites(payload), ["offerup", "whatnot"]);
    assert.equal(importEnabledSites({ app: "flip-helper", items: [] }), null);
    assert.equal(importPayload(payload)[0].title, "Hat");
  });
});
