// Three pricing options: Sell quickly, Balanced, and Hold for more.
// Each shows the estimated money she keeps on each suitable site after
// fees and shipping. These are estimates, not quotes.
import { money, formatUsd } from "./inventory.js";
import { feeFor } from "./fees.js";
import { defaultShippingCost } from "./shipping.js";
import { isKnownSite, knownSiteIds, siteName } from "./sites.js";

export const PRICING_CHOICES = ["quick", "balanced", "hold"];

export const PRICING_LABELS = {
  quick: "Sell quickly",
  balanced: "Balanced",
  hold: "Hold for more"
};

export const PRICING_NOTE = "Estimated money you'd keep after approximate fees and shipping. Not a quote. Sites change their fees, and shipping depends on the package and the destination.";

export const PRICING_BLURBS = {
  quick: "A lower asking price, aimed at a faster sale.",
  balanced: "A middle asking price, between a quick sale and holding out.",
  hold: "A higher asking price, if you're willing to wait."
};

function mid(lo, hi) {
  const a = money(lo), b = money(hi);
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return money((a + b) / 2);
}

/**
 * The three asking prices, derived from her low/high estimates (or asking
 * price). She can still type her own number.
 *
 *  - quick: the low estimate, or 15% below a single asking price
 *  - balanced: the midpoint, or her asking price
 *  - hold: the high estimate, or 15% above a single asking price
 */
export function choicePrices(item) {
  const lo = money(item && item.priceLow);
  const hi = money(item && item.priceHigh);
  const ask = money(item && item.askingPrice);
  const middle = mid(lo, hi) ?? ask;
  let quick = lo;
  let hold = hi;
  let balanced = middle;
  if (quick == null && balanced != null) quick = money(balanced * 0.85);
  if (hold == null && balanced != null) hold = money(balanced * 1.15);
  if (balanced == null && ask != null) balanced = ask;
  if (quick == null && ask != null) quick = money(ask * 0.85);
  if (hold == null && ask != null) hold = money(ask * 1.15);
  // Keep them in order if we have all three.
  if (quick != null && balanced != null && quick > balanced) quick = balanced;
  if (hold != null && balanced != null && hold < balanced) hold = balanced;
  return { quick, balanced, hold };
}

function localSite(id) {
  return id === "facebook" || id === "offerup" || id === "craigslist";
}

function shipFor(item, siteId) {
  if (localSite(siteId)) return 0;
  if (item && item.actualShipCost != null && item.actualShipCost !== "") {
    return money(item.actualShipCost) ?? 0;
  }
  const oz = (item && item.packedWeightOz) || (item && item.shipSuggest && item.shipSuggest.weightOz) || 16;
  return defaultShippingCost(oz) ?? 0;
}

/**
 * Estimated money she'd keep at a given asking price, on one site.
 * sale - marketplace fees - shipping. Cost is shown separately so she
 * can see proceeds vs profit.
 */
export function keepOnSite(item, siteId, asking) {
  const price = money(asking);
  if (price == null || !isKnownSite(siteId)) return null;
  const local = localSite(siteId);
  const fee = feeFor(siteId, price, { local }).fee ?? 0;
  const ship = shipFor(item, siteId);
  const proceeds = money(price - fee - ship);
  const cost = money(item && item.costPaid) ?? 0;
  const supplies = money(item && item.supplies) ?? 0;
  const profit = money(proceeds - cost - supplies);
  return {
    siteId,
    name: siteName(siteId),
    asking: price,
    fee,
    shipping: ship,
    local,
    proceeds,
    profit,
    approx: true
  };
}

/**
 * All three options, each with a per-site keep-table for her suitable sites.
 * `siteIds` should be the sites she's considering (enabled, or the plan).
 */
export function pricingOptions(item, siteIds) {
  const prices = choicePrices(item);
  const ids = knownSiteIds(siteIds && siteIds.length ? siteIds : undefined);
  const useIds = ids.length ? ids : knownSiteIds(["ebay", "poshmark", "mercari", "facebook", "etsy", "depop"]);
  const make = (id) => {
    const asking = prices[id];
    const rows = useIds.map(siteId => keepOnSite(item, siteId, asking)).filter(Boolean);
    const withP = rows.filter(r => r.proceeds != null);
    const best = withP.slice().sort((a, b) => b.proceeds - a.proceeds)[0] || null;
    return {
      id,
      label: PRICING_LABELS[id],
      blurb: PRICING_BLURBS[id],
      asking,
      rows,
      bestSite: best ? best.siteId : null,
      bestProceeds: best ? best.proceeds : null,
      approx: true
    };
  };
  return {
    options: PRICING_CHOICES.map(make),
    prices,
    note: PRICING_NOTE
  };
}

export function applyPricingChoice(item, choice, at = Date.now()) {
  const id = PRICING_CHOICES.includes(choice) ? choice : "balanced";
  const prices = choicePrices(item);
  const asking = prices[id];
  if (asking == null) return { ...item, pricingChoice: id, updatedAt: at };
  return { ...item, pricingChoice: id, askingPrice: asking, updatedAt: at };
}

export { money, formatUsd, siteName };
