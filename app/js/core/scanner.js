// Buy-or-pass: identify an item, estimate resale, subtract approximate fees
// and shipping, and give a Buy / Maybe / Pass verdict.
import { money, formatUsd, emptyItem } from "./inventory.js";
import { feeFor } from "./fees.js";
import { defaultShippingCost, heuristicShip, normalizeShipSuggest, shippingEstimates } from "./shipping.js";
import { isKnownSite, knownSiteIds, siteName } from "./sites.js";

export const VERDICTS = ["buy", "maybe", "pass"];
export const VERDICT_LABELS = { buy: "Buy", maybe: "Maybe", pass: "Pass" };

/**
 * Verdict from likely profit after fees and shipping.
 * Uses a conservative (low) resale and a midpoint resale.
 * Thresholds are plain and testable; the UI labels them as a guide, not a promise.
 *
 *  - Buy: even the low estimate is clearly profitable (at least $8, or at least $3 with 40%+ return on the asking price)
 *  - Pass: the midpoint is a loss, or only a tiny gain (under $5 and under 15% return)
 *  - Maybe: everything in between
 */
export function verdictFromProfit({ netLow, netMid, asking } = {}) {
  const low = money(netLow);
  const mid = money(netMid);
  const ask = money(asking) ?? 0;
  const roi = ask > 0 && mid != null ? mid / ask : (mid != null && mid > 0 ? 1 : 0);
  if (mid == null && low == null) return "maybe";
  const midV = mid ?? low;
  const lowV = low ?? mid;
  if (midV < 0 || (midV < 5 && roi < 0.15)) return "pass";
  if (lowV >= 8 || (lowV >= 3 && roi >= 0.40)) return "buy";
  return "maybe";
}

export function midPrice(low, high) {
  const lo = money(low), hi = money(high);
  if (lo == null && hi == null) return null;
  if (lo == null) return hi;
  if (hi == null) return lo;
  return money((lo + hi) / 2);
}

function localSite(id) {
  return id === "facebook" || id === "offerup" || id === "craigslist";
}

/**
 * Build a per-site profit picture and an overall verdict.
 * `resaleLow` / `resaleHigh` are expected sale prices.
 * `asking` is what the store wants.
 * `weightOz` feeds the shipping estimate. Local sites can skip shipping.
 */
export function scanResult({
  asking,
  resaleLow,
  resaleHigh,
  siteIds,
  weightOz,
  costPaid,
  shippingOverride
} = {}) {
  const ask = money(asking);
  const low = money(resaleLow);
  const high = money(resaleHigh);
  const mid = midPrice(low, high);
  const shipDefault = shippingOverride != null ? money(shippingOverride) : defaultShippingCost(weightOz || 16);
  const ids = knownSiteIds(siteIds && siteIds.length ? siteIds : undefined);
  const useIds = ids.length ? ids : knownSiteIds(["ebay", "poshmark", "mercari", "facebook", "etsy", "depop"]);
  const rows = useIds.map(id => {
    const local = localSite(id);
    const ship = local ? 0 : (shipDefault ?? 0);
    const feeLow = low != null ? feeFor(id, low, { local }).fee : null;
    const feeMid = mid != null ? feeFor(id, mid, { local }).fee : null;
    const feeHigh = high != null ? feeFor(id, high, { local }).fee : null;
    const net = (sale, fee) => {
      if (sale == null || ask == null) return null;
      return money(sale - ask - (fee ?? 0) - ship);
    };
    return {
      siteId: id,
      name: siteName(id),
      local,
      feeLow, feeMid, feeHigh,
      shipping: ship,
      netLow: net(low, feeLow),
      netMid: net(mid, feeMid),
      netHigh: net(high, feeHigh),
      feeNote: feeFor(id, mid ?? low ?? 0, { local }).note
    };
  });

  // Overall: the best midpoint among her sites, and the low at that same site (or the best low).
  const withMid = rows.filter(r => r.netMid != null);
  const best = withMid.slice().sort((a, b) => b.netMid - a.netMid)[0] || rows[0];
  const conservative = rows.filter(r => r.netLow != null).slice().sort((a, b) => b.netLow - a.netLow)[0];
  const netMid = best ? best.netMid : null;
  const netLow = conservative ? conservative.netLow : (best ? best.netLow : null);
  const verdict = ask == null || mid == null ? "maybe" : verdictFromProfit({ netLow, netMid, asking: ask });
  const shipEstimates = shippingEstimates(weightOz || 16);

  return {
    asking: ask,
    resaleLow: low,
    resaleHigh: high,
    resaleMid: mid,
    costPaid: money(costPaid),
    shippingDefault: shipDefault,
    shipEstimates,
    rows,
    bestSite: best ? best.siteId : null,
    netLow,
    netMid,
    netHigh: best ? best.netHigh : null,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    approx: true
  };
}

export function normalizeScanDraft(raw = {}) {
  const days = String(raw.daysToSell || raw.speed || raw.days_to_sell || "").toLowerCase();
  const speed = /fast/.test(days) ? "fast" : /slow/.test(days) ? "slow" : /med/.test(days) ? "medium" : (days || "medium");
  const ship = normalizeShipSuggest({
    boxLabel: raw.box || raw.boxLabel,
    weightOz: raw.weightOz ?? raw.weight_oz,
    lengthIn: raw.lengthIn ?? raw.l,
    widthIn: raw.widthIn ?? raw.w,
    heightIn: raw.heightIn ?? raw.h,
    reason: raw.shipReason || "",
    source: "ai"
  }, "ai");
  return {
    title: String(raw.title || "").trim(),
    description: String(raw.description || raw.notes || "").trim(),
    category: String(raw.category || "").trim(),
    condition: String(raw.condition || "").trim(),
    brand: /^unknown$/i.test(String(raw.brand || "").trim()) ? "" : String(raw.brand || "").trim(),
    priceLow: money(raw.priceLow ?? raw.price_low ?? raw.resaleLow),
    priceHigh: money(raw.priceHigh ?? raw.price_high ?? raw.resaleHigh),
    priceReason: String(raw.priceReason || raw.price_reason || "").trim(),
    daysToSell: speed,
    speedReason: String(raw.speedReason || raw.speed_reason || "").trim(),
    notes: String(raw.notes || "").trim(),
    ship
  };
}

/** Turn a scan into a draft inventory item she can save. */
export function itemFromScan({ photos, draft, asking, result, notes } = {}, at = Date.now()) {
  const d = draft || {};
  const askingList = d.priceHigh ?? d.priceLow ?? (result && result.resaleMid);
  return emptyItem({
    photos: photos || [],
    title: d.title || "Scanned item",
    description: d.description || "",
    category: d.category || "",
    condition: d.condition || "",
    brand: d.brand || "",
    priceLow: d.priceLow,
    priceHigh: d.priceHigh,
    priceReason: d.priceReason || "",
    askingPrice: askingList,
    costPaid: asking,
    notes: [notes, d.notes, d.speedReason].filter(Boolean).join("\n"),
    shipSuggest: d.ship || heuristicShip(d),
    scan: {
      asking: money(asking),
      verdict: result ? result.verdict : null,
      netMid: result ? result.netMid : null,
      at
    }
  }, at);
}

export { money, formatUsd, feeFor, siteName, heuristicShip };
