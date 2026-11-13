// Smart price-drop and "send offers" suggestions for listings that have sat.
// She approves each one. The app does not change the live listing on a site.
import { money, formatUsd, listedSiteIds, firstListedAt, siteName } from "./inventory.js";
import { isKnownSite } from "./sites.js";
import { DEFAULT_DROP_DAYS } from "./settings.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Sites where sending an offer (to likers, watchers, or a buyer) is a usual next step. */
export const OFFER_SITES = new Set(["ebay", "poshmark", "mercari", "depop", "facebook", "offerup"]);

export const OFFER_HINTS = {
  ebay: "On eBay you can send offers to people watching the listing.",
  poshmark: "On Poshmark you can send offers to people who liked it.",
  mercari: "On Mercari you can send an offer to interested buyers.",
  depop: "On Depop you can send offers on the listing.",
  facebook: "On Facebook Marketplace you can lower the price or message people who asked.",
  offerup: "On OfferUp you can lower the price or make an offer to a buyer."
};

export function daysListed(item, at = Date.now()) {
  const t = firstListedAt(item);
  if (t == null) return 0;
  return Math.floor(Math.max(0, at - Number(t)) / DAY_MS);
}

export function dropPercent(days, threshold = DEFAULT_DROP_DAYS) {
  if (days < threshold) return 0;
  if (days >= threshold * 3) return 20;
  if (days >= threshold * 2) return 15;
  return 10;
}

function alreadyHandled(item, siteId, at) {
  const hist = Array.isArray(item.askingHistory) ? item.askingHistory : [];
  // If she approved or dismissed a suggestion for this site in the last threshold window, skip.
  const recent = hist.filter(h => h && h.siteId === siteId && h.at && (at - h.at) < DAY_MS);
  return recent.some(h => h.status === "approved" || h.status === "dismissed" || h.status === "updated");
}

function suggestedPrice(item, percent) {
  const current = money(item.askingPrice);
  if (current == null || current <= 0) return null;
  let to = money(current * (1 - percent / 100));
  const floor = money(item.priceLow);
  if (floor != null && to < floor) to = floor;
  // Don't go below about cost plus a little breathing room if we know cost.
  const cost = money(item.costPaid);
  if (cost != null && to < cost) to = money(Math.max(cost, floor ?? 0)) || to;
  if (to == null || to >= current) return null;
  return to;
}

export function reasonFor({ siteId, days, fromPrice, toPrice, percent, action }) {
  const from = formatUsd(fromPrice);
  const to = formatUsd(toPrice);
  const sit = siteName(siteId);
  const drop = `Listed ${days} day${days === 1 ? "" : "s"} with no sale. A ${percent}% drop from ${from} to ${to} is a usual next step on ${sit}.`;
  if (action === "offers") {
    const hint = OFFER_HINTS[siteId] || "You can send an offer to interested people.";
    return `${drop} ${hint}`;
  }
  return drop + " Change the price on the site yourself after you approve it.";
}

/**
 * Per-site suggestions for one item. Empty if it is not yet stale, already
 * sold, has no asking price, or was just handled.
 */
export function suggestionsForItem(item, { days = DEFAULT_DROP_DAYS, at = Date.now() } = {}) {
  if (!item || item.soldAt) return [];
  const ids = listedSiteIds(item);
  if (!ids.length) return [];
  const age = daysListed(item, at);
  if (age < days) return [];
  const percent = dropPercent(age, days);
  const to = suggestedPrice(item, percent);
  if (to == null) return [];
  const from = money(item.askingPrice);
  const out = [];
  for (const siteId of ids) {
    if (alreadyHandled(item, siteId, at)) continue;
    const action = OFFER_SITES.has(siteId) ? "offers" : "drop";
    out.push({
      id: `drop_${item.id}_${siteId}`,
      itemId: item.id,
      siteId,
      siteName: siteName(siteId),
      daysListed: age,
      fromPrice: from,
      toPrice: to,
      percent,
      action,
      actionLabel: action === "offers" ? "Drop the price or send offers" : "Drop the price",
      reason: reasonFor({ siteId, days: age, fromPrice: from, toPrice: to, percent, action })
    });
  }
  return out;
}

export function suggestionsForAll(items, opts = {}) {
  const out = [];
  for (const item of items || []) out.push(...suggestionsForItem(item, opts).map(s => ({ ...s, title: item.title || "Untitled item" })));
  return out;
}

export function recordDropDecision(item, suggestion, status, at = Date.now()) {
  const hist = Array.isArray(item.askingHistory) ? item.askingHistory.slice() : [];
  hist.push({
    siteId: suggestion.siteId,
    from: suggestion.fromPrice,
    to: suggestion.toPrice,
    percent: suggestion.percent,
    action: suggestion.action,
    status, // "approved" | "dismissed" | "updated"
    reason: suggestion.reason,
    at
  });
  const next = { ...item, askingHistory: hist, updatedAt: at };
  if (status === "approved") {
    next.askingPrice = money(suggestion.toPrice);
    // She still needs to change it on the site. Track that as a to-do.
    const updates = { ...(item.priceUpdates || {}) };
    updates[suggestion.siteId] = {
      needed: true,
      action: suggestion.action,
      toPrice: money(suggestion.toPrice),
      at
    };
    next.priceUpdates = updates;
  }
  return next;
}

export function markPriceUpdated(item, siteId, done = true, at = Date.now()) {
  if (!isKnownSite(siteId)) return item;
  const updates = { ...(item.priceUpdates || {}) };
  if (!updates[siteId]) return item;
  updates[siteId] = { ...updates[siteId], needed: !done, doneAt: done ? at : null };
  const hist = Array.isArray(item.askingHistory) ? item.askingHistory.slice() : [];
  if (done) hist.push({ siteId, status: "updated", at, to: updates[siteId].toPrice });
  return { ...item, priceUpdates: updates, askingHistory: hist, updatedAt: at };
}

export function pendingPriceUpdates(item) {
  const map = (item && item.priceUpdates) || {};
  return Object.keys(map).filter(id => map[id] && map[id].needed);
}

export { money, formatUsd, siteName, DEFAULT_DROP_DAYS };
