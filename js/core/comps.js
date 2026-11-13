// Sold-price checks. This version uses AI estimates, one-tap links to each
// site's own sold or search page, and sold prices she logs herself.
// An official eBay API adapter is defined here but not wired up.
// This module does not scrape any site.
import { money, formatUsd } from "./inventory.js";
import { SITES, searchQuery, siteName, isKnownSite } from "./sites.js";

export const COMPS_NOTE = "AI estimates are not live sold data. The eBay sold & completed link opens eBay's own sold listings so you can check. The official eBay sold-price API needs a free eBay developer account and is coming soon.";

/**
 * Official eBay sold-comps adapter (Browse API and Marketplace Insights).
 *
 * When a free eBay developer account is set up, this would call:
 *   GET https://api.ebay.com/buy/browse/v1/item_summary/search
 *   GET https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search
 * using an OAuth token the seller grants on eBay's own "allow this app" screen.
 * It never scrapes eBay pages and never asks for an eBay password.
 *
 * This version only exposes the interface. The Settings toggle is labeled
 * "Needs eBay developer account (free), coming soon" and does not make calls.
 */
export const ebayOfficialAdapter = {
  id: "ebay-official",
  name: "eBay official sold prices",
  status: "coming-soon",
  available: false,
  needs: "Needs eBay developer account (free), coming soon",
  endpoints: {
    browseSearch: "https://api.ebay.com/buy/browse/v1/item_summary/search",
    itemSales: "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search"
  },
  isConfigured() { return false; },
  async fetchSoldComps(_query, _opts = {}) {
    return {
      ok: false,
      status: "coming-soon",
      message: "Needs eBay developer account (free), coming soon.",
      comps: [],
      source: "ebay-official"
    };
  }
};

export function getCompsAdapter() {
  return ebayOfficialAdapter;
}

/**
 * Kind of sold-price link:
 *  - "sold-completed": a real sold/completed filter (eBay)
 *  - "sold-out": a sold-out / sold filter (Poshmark)
 *  - "search": a regular search; the site has no reliable public sold filter we can link to
 */
export function soldLinkKind(site) {
  if (!site) return "search";
  if (site.soldKind) return site.soldKind;
  if (site.id === "ebay") return "sold-completed";
  if (site.id === "poshmark") return "sold-out";
  return "search";
}

export function soldLinkLabel(site) {
  const kind = soldLinkKind(site);
  const name = site.short || site.name;
  if (kind === "sold-completed") return `${name} sold & completed`;
  if (kind === "sold-out") return `${name} sold`;
  return `${name} search`;
}

export function soldLinks(item, enabledIds) {
  const q = searchQuery(item);
  if (!q) return { query: "", links: [] };
  const enabled = new Set(enabledIds || []);
  const ordered = [
    ...SITES.filter(s => enabled.has(s.id)),
    ...SITES.filter(s => !enabled.has(s.id))
  ];
  // eBay sold/completed always first when present — it's the most useful public sold filter.
  ordered.sort((a, b) => {
    const ak = soldLinkKind(a) === "sold-completed" ? 0 : soldLinkKind(a) === "sold-out" ? 1 : 2;
    const bk = soldLinkKind(b) === "sold-completed" ? 0 : soldLinkKind(b) === "sold-out" ? 1 : 2;
    if (ak !== bk) return ak - bk;
    return 0;
  });
  const links = ordered.map(s => ({
    id: s.id,
    name: s.short || s.name,
    label: soldLinkLabel(s),
    kind: soldLinkKind(s),
    url: s.soldSearch(q),
    realSoldFilter: soldLinkKind(s) !== "search"
  }));
  return { query: q, links };
}

export function normalizeLoggedComp(raw = {}, at = Date.now()) {
  return {
    id: raw.id || ("cp_" + at.toString(36) + Math.random().toString(36).slice(2, 6)),
    price: money(raw.price),
    siteId: isKnownSite(raw.siteId) ? raw.siteId : (raw.siteId ? String(raw.siteId) : ""),
    note: String(raw.note || "").trim(),
    at: raw.at || at
  };
}

export function addLoggedComp(item, raw, at = Date.now()) {
  const comp = normalizeLoggedComp(raw, at);
  if (comp.price == null) return item;
  const logged = [...((item.comps && item.comps.logged) || []), comp];
  return { ...item, comps: { ...(item.comps || {}), logged }, updatedAt: at };
}

export function removeLoggedComp(item, id, at = Date.now()) {
  const logged = ((item.comps && item.comps.logged) || []).filter(c => c.id !== id);
  return { ...item, comps: { ...(item.comps || {}), logged }, updatedAt: at };
}

export function loggedCompStats(item) {
  const logged = ((item && item.comps && item.comps.logged) || []).filter(c => c.price != null);
  if (!logged.length) return null;
  const prices = logged.map(c => c.price).sort((a, b) => a - b);
  const sum = prices.reduce((a, b) => a + b, 0);
  const mid = prices.length % 2
    ? prices[(prices.length - 1) / 2]
    : money((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2);
  return {
    count: prices.length,
    low: prices[0],
    high: prices[prices.length - 1],
    average: money(sum / prices.length),
    median: mid
  };
}

export function setAiComps(item, estimate, at = Date.now()) {
  const ai = {
    low: money(estimate.low ?? estimate.priceLow),
    high: money(estimate.high ?? estimate.priceHigh),
    typical: money(estimate.typical ?? estimate.typicalPrice),
    reason: String(estimate.reason || estimate.priceReason || "").trim(),
    confidence: String(estimate.confidence || "").trim(),
    at,
    source: "ai-estimate"
  };
  return { ...item, comps: { ...(item.comps || {}), ai }, updatedAt: at };
}

export function normalizeAiComps(raw = {}) {
  return {
    low: money(raw.low ?? raw.priceLow),
    high: money(raw.high ?? raw.priceHigh),
    typical: money(raw.typical ?? raw.typicalPrice),
    reason: String(raw.reason || raw.priceReason || "").trim(),
    confidence: String(raw.confidence || "").trim()
  };
}

export { money, formatUsd, searchQuery, siteName };
