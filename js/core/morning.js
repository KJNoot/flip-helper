// Morning list: what must ship, what's still live after a sale, and
// what needs a decision. Pure logic.
import { needsDelistHighlight, pendingDelist, siteName } from "./inventory.js";
import { suggestionsForAll, pendingPriceUpdates } from "./drops.js";
import { failedSiteIds, needsManualSiteIds } from "./sitestatus.js";

export function mustShip(items) {
  return (items || []).filter(i => i && i.soldAt && !i.shippedAt)
    .sort((a, b) => (a.soldAt || 0) - (b.soldAt || 0));
}

export function stillLiveAfterSale(items) {
  return (items || []).filter(needsDelistHighlight)
    .sort((a, b) => (a.soldAt || 0) - (b.soldAt || 0));
}

/**
 * Things that need a decision today: price-drop ideas, failed site steps,
 * approved price updates she still has to make on a site, and drafts that
 * have been sitting with no title review for a while are not included —
 * only concrete actions.
 */
export function needsDecision(items, { dropDays, at = Date.now() } = {}) {
  const out = [];
  const drops = suggestionsForAll(items, { days: dropDays, at });
  const seenDrop = new Set();
  for (const d of drops) {
    if (seenDrop.has(d.itemId)) continue;
    seenDrop.add(d.itemId);
    out.push({
      kind: "drop",
      itemId: d.itemId,
      title: d.title || "Untitled item",
      label: `Price-drop idea: ${d.fromPrice != null ? "lower the price" : "review the price"}`
    });
  }
  for (const item of items || []) {
    const failed = failedSiteIds(item);
    if (failed.length) {
      out.push({
        kind: "failed",
        itemId: item.id,
        title: item.title || "Untitled item",
        label: `A step failed on ${failed.map(siteName).join(", ")}`
      });
    }
    const todos = pendingPriceUpdates(item);
    if (todos.length) {
      out.push({
        kind: "priceUpdate",
        itemId: item.id,
        title: item.title || "Untitled item",
        label: `Update the price on ${todos.map(siteName).join(", ")}`
      });
    }
    // Manual take-down already appears under stillLive; don't double it here
    // unless it's a failed/needsManual without a sale highlight (shouldn't happen).
    void needsManualSiteIds;
    void pendingDelist;
  }
  return out;
}

export function morningList(items, opts = {}) {
  const ship = mustShip(items);
  const live = stillLiveAfterSale(items);
  const decide = needsDecision(items, opts);
  return {
    mustShip: ship,
    stillLive: live,
    needsDecision: decide,
    empty: !ship.length && !live.length && !decide.length,
    counts: { ship: ship.length, live: live.length, decide: decide.length }
  };
}
