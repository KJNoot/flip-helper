// Pure inventory logic: stages, listing/delist checklist, profit, monthly totals.
// No DOM, no storage, no network. Safe to unit-test in Node.
import { SITES, SITE_IDS, isKnownSite, siteName, knownSiteIds } from "./sites.js";
import { normalizeSiteStatusMap, flagUnavailableEverywhere, setSiteStatus, siteStatusOf } from "./sitestatus.js";
import { normalizeHistory as normalizeEditHistory } from "./history.js";
import { emptyConfirm, normalizeConfirm, normalizePhotoShows, normalizeAiGuess } from "./honesty.js";
import { normalizeReturn, normalizeReceipts } from "./profit.js";

export { SITES, SITE_IDS, isKnownSite, siteName, knownSiteIds };

export const SITE_PLANS = ["bestPrice", "fastestSale", "both", "own"];
export const SITE_PLAN_LABELS = {
  bestPrice: "Best price",
  fastestSale: "Fastest sale",
  both: "Both",
  own: "My own picks"
};

export const STAGES = ["draft", "listed", "sold", "shipped"];
export const STAGE_LABELS = { draft: "Draft", listed: "Listed", sold: "Sold", shipped: "Shipped" };
export const SHIP_CHECKS = [
  { id: "packed", label: "Pack it safely" },
  { id: "labeled", label: "Add the shipping label or slip" },
  { id: "droppedOff", label: "Drop it off" }
];

export function newId(at = Date.now()) {
  return "it_" + at.toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Parse a money amount. Accepts numbers or strings like "$12.50" or "1,200". Null if blank or not a number. */
export function money(n) {
  if (n == null || n === "") return null;
  if (typeof n === "number") return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  const v = Number(String(n).trim().replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

export function emptyItem(partial = {}, at = Date.now()) {
  return normalizeItem({
    id: partial.id || newId(at),
    createdAt: at,
    updatedAt: at,
    photos: [],
    title: "",
    description: "",
    category: "",
    condition: "",
    brand: "",
    priceLow: null,
    priceHigh: null,
    priceReason: "",
    askingPrice: null,
    costPaid: null,
    salePrice: null,
    fees: null,
    soldOn: null,
    soldAt: null,
    shippedAt: null,
    siteTweaks: {},
    listedOn: {},
    delistedOn: {},
    shipChecks: { packed: false, labeled: false, droppedOff: false },
    notes: "",
    siteAdvice: { bestPrice: { sites: [], reason: "" }, fastestSale: { sites: [], reason: "" } },
    sitePlan: "own",
    shippingPaid: null,
    comps: { ai: null, logged: [] },
    askingHistory: [],
    priceUpdates: {},
    shipSuggest: null,
    scan: null,
    unavailable: false,
    siteStatus: {},
    originals: null,
    editHistory: [],
    photoShows: null,
    youConfirm: emptyConfirm(),
    aiGuess: null,
    binLocation: "",
    material: "",
    size: "",
    marketplaceFees: null,
    paymentFees: null,
    supplies: null,
    discounts: null,
    refunds: null,
    returns: null,
    moneyReceived: null,
    profitFloor: null,
    packedWeightOz: null,
    packedLengthIn: null,
    packedWidthIn: null,
    packedHeightIn: null,
    actualShipCost: null,
    receipts: [],
    mileageTripIds: [],
    boxId: null,
    measurements: "",
    flawsNoted: false,
    noFlaws: false,
    noBrand: false,
    noSize: false,
    pricingChoice: null,
    ...partial
  }, at);
}

export function normalizeItem(raw = {}, at = Date.now()) {
  const item = { ...raw };
  if (!item.id) item.id = newId(at);
  if (!item.createdAt) item.createdAt = at;
  item.photos = Array.isArray(item.photos) ? item.photos.filter(p => p && p.dataUrl) : [];
  item.title = String(item.title || "");
  item.description = String(item.description || "");
  item.category = String(item.category || "");
  item.condition = String(item.condition || "");
  item.brand = String(item.brand || "");
  item.priceLow = money(item.priceLow);
  item.priceHigh = money(item.priceHigh);
  item.priceReason = String(item.priceReason || "");
  item.askingPrice = money(item.askingPrice);
  item.costPaid = money(item.costPaid);
  item.salePrice = money(item.salePrice);
  item.fees = money(item.fees);
  item.soldOn = isKnownSite(item.soldOn) ? item.soldOn : null;
  item.soldAt = item.soldAt || null;
  item.shippedAt = item.shippedAt || null;
  item.siteTweaks = normalizeTweaks(item.siteTweaks);
  item.listedOn = pickSiteMap(item.listedOn);
  item.delistedOn = pickSiteMap(item.delistedOn);
  const sc = item.shipChecks || {};
  item.shipChecks = {
    packed: !!sc.packed,
    labeled: !!sc.labeled,
    droppedOff: !!sc.droppedOff
  };
  item.notes = String(item.notes || "");
  item.siteAdvice = normalizeAdvice(item.siteAdvice);
  item.sitePlan = SITE_PLANS.includes(item.sitePlan) ? item.sitePlan : "own";
  item.shippingPaid = money(item.shippingPaid);
  item.comps = normalizeComps(item.comps);
  item.askingHistory = Array.isArray(item.askingHistory) ? item.askingHistory.map(normalizeHistory).filter(Boolean) : [];
  item.priceUpdates = normalizePriceUpdates(item.priceUpdates);
  item.shipSuggest = item.shipSuggest && typeof item.shipSuggest === "object" ? item.shipSuggest : null;
  item.scan = item.scan && typeof item.scan === "object" ? item.scan : null;
  item.unavailable = !!(item.unavailable || item.soldAt);
  item.siteStatus = normalizeSiteStatusMap(item.siteStatus);
  item.originals = item.originals && typeof item.originals === "object" ? item.originals : null;
  item.editHistory = normalizeEditHistory(item.editHistory);
  item.photoShows = normalizePhotoShows(item.photoShows);
  item.youConfirm = normalizeConfirm(item.youConfirm);
  item.aiGuess = normalizeAiGuess(item.aiGuess);
  item.binLocation = String(item.binLocation || "");
  item.material = String(item.material || "");
  item.size = String(item.size || "");
  item.marketplaceFees = money(item.marketplaceFees);
  item.paymentFees = money(item.paymentFees);
  item.supplies = money(item.supplies);
  item.discounts = money(item.discounts);
  item.refunds = money(item.refunds);
  item.returns = normalizeReturn(item.returns);
  item.moneyReceived = money(item.moneyReceived);
  item.profitFloor = money(item.profitFloor);
  const pw = Number(item.packedWeightOz);
  item.packedWeightOz = Number.isFinite(pw) && pw > 0 ? pw : null;
  const pl = Number(item.packedLengthIn), pwi = Number(item.packedWidthIn), ph = Number(item.packedHeightIn);
  item.packedLengthIn = Number.isFinite(pl) && pl > 0 ? pl : null;
  item.packedWidthIn = Number.isFinite(pwi) && pwi > 0 ? pwi : null;
  item.packedHeightIn = Number.isFinite(ph) && ph > 0 ? ph : null;
  item.actualShipCost = money(item.actualShipCost);
  item.receipts = normalizeReceipts(item.receipts);
  item.mileageTripIds = Array.isArray(item.mileageTripIds) ? item.mileageTripIds.map(String) : [];
  item.boxId = item.boxId ? String(item.boxId) : null;
  item.measurements = String(item.measurements || "");
  item.flawsNoted = !!item.flawsNoted;
  item.noFlaws = !!item.noFlaws;
  item.noBrand = !!item.noBrand;
  item.noSize = !!item.noSize;
  item.pricingChoice = ["quick", "balanced", "hold"].includes(item.pricingChoice) ? item.pricingChoice : null;
  // Photos keep originalDataUrl when a clean-up was applied.
  item.photos = item.photos.map(p => {
    if (!p || typeof p !== "object") return p;
    return {
      ...p,
      id: p.id || "",
      dataUrl: p.dataUrl,
      originalDataUrl: p.originalDataUrl || null,
      cleaned: p.cleaned || null,
      cleanedAt: p.cleanedAt || null,
      addedAt: p.addedAt || 0
    };
  });
  return deriveStage(item);
}

function normalizeComps(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const logged = Array.isArray(src.logged) ? src.logged.map(c => {
    if (!c || typeof c !== "object") return null;
    const price = money(c.price);
    if (price == null) return null;
    return { id: String(c.id || ""), price, siteId: String(c.siteId || ""), note: String(c.note || ""), date: String(c.date || ""), condition: String(c.condition || ""), confidence: String(c.confidence || ""), at: c.at || 0 };
  }).filter(Boolean) : [];
  const ai = src.ai && typeof src.ai === "object" ? {
    low: money(src.ai.low),
    high: money(src.ai.high),
    typical: money(src.ai.typical),
    reason: String(src.ai.reason || ""),
    confidence: String(src.ai.confidence || ""),
    at: src.ai.at || 0,
    source: "ai-estimate"
  } : null;
  return { ai, logged };
}

function normalizeHistory(h) {
  if (!h || typeof h !== "object") return null;
  return {
    siteId: String(h.siteId || ""),
    from: money(h.from),
    to: money(h.to),
    percent: Number(h.percent) || 0,
    action: String(h.action || ""),
    status: String(h.status || ""),
    reason: String(h.reason || ""),
    at: h.at || 0
  };
}

function normalizePriceUpdates(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of SITE_IDS) {
    const v = raw[id];
    if (!v || typeof v !== "object") continue;
    out[id] = { needed: !!v.needed, action: String(v.action || ""), toPrice: money(v.toPrice), at: v.at || 0, doneAt: v.doneAt || null };
  }
  return out;
}

function pickSiteMap(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  for (const id of SITE_IDS) {
    const v = map[id];
    if (v && typeof v === "object") out[id] = { at: Number(v.at) || 0 };
    else if (v === true) out[id] = { at: 0 };
  }
  return out;
}

function normalizeTweaks(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of SITE_IDS) {
    const v = raw[id];
    if (!v || typeof v !== "object") continue;
    const t = {
      title: String(v.title || ""),
      description: String(v.description || ""),
      notes: String(v.notes || "")
    };
    if (t.title || t.description || t.notes) out[id] = t;
  }
  return out;
}

/** Derive stage from facts. Shipped only after a sale. Never invent a sale. */
export function deriveStage(item) {
  let stage = "draft";
  if (listedSiteIds(item).length) stage = "listed";
  if (item.soldAt) stage = "sold";
  if (item.shippedAt && item.soldAt) stage = "shipped";
  return { ...item, stage };
}

export function listedSiteIds(item) {
  const map = (item && item.listedOn) || {};
  return SITE_IDS.filter(id => !!map[id]);
}

/**
 * Sites she still needs to take the listing down on, after a sale.
 * Only sites she marked as listed, excluding the site it sold on.
 * Empty until the item is marked sold.
 */
export function delistTargets(item) {
  if (!item || !item.soldAt) return [];
  return listedSiteIds(item).filter(id => id !== item.soldOn);
}

export function isDelisted(item, siteId) {
  return !!(item && item.delistedOn && item.delistedOn[siteId]);
}

export function pendingDelist(item) {
  return delistTargets(item).filter(id => !isDelisted(item, id));
}

export function isFullyDelisted(item) {
  return pendingDelist(item).length === 0;
}

/** Sold or shipped, and at least one other-site listing is still up. */
export function needsDelistHighlight(item) {
  return !!(item && item.soldAt && pendingDelist(item).length > 0);
}

/** Profit after cost, fees, and shipping she paid. Null until a sale price is set. Missing cost, fees, or shipping count as 0. */
export function profit(item) {
  if (!item) return null;
  const sale = money(item.salePrice);
  if (sale == null) return null;
  const cost = money(item.costPaid) ?? 0;
  const hasM = item.marketplaceFees != null && item.marketplaceFees !== "";
  const hasP = item.paymentFees != null && item.paymentFees !== "";
  const hasSplit = hasM || hasP;
  const mFees = hasSplit ? (money(item.marketplaceFees) ?? 0) : (money(item.fees) ?? 0);
  const pFees = hasSplit ? (money(item.paymentFees) ?? 0) : 0;
  const ship = (item.actualShipCost != null && item.actualShipCost !== "")
    ? (money(item.actualShipCost) ?? 0)
    : (money(item.shippingPaid) ?? 0);
  const supplies = money(item.supplies) ?? 0;
  const discounts = money(item.discounts) ?? 0;
  const refunds = money(item.refunds) ?? (item.returns ? money(item.returns.refundAmount) ?? 0 : 0);
  return money(sale - cost - mFees - pFees - ship - supplies - discounts - refunds);
}

export function monthKey(at = Date.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Totals for a calendar month on the device's local clock:
 *  - listed: items first listed (any site) in that month
 *  - sold: items whose sale date is in that month
 *  - profit: sum of profit for those sold items (items with no sale price add 0)
 */
export function monthTotals(items, at = Date.now()) {
  const key = monthKey(at);
  let listed = 0, sold = 0, profitSum = 0;
  for (const item of items || []) {
    if (firstListedAt(item) != null && monthKey(firstListedAt(item)) === key) listed += 1;
    if (item.soldAt && monthKey(item.soldAt) === key) {
      sold += 1;
      const p = profit(item);
      if (p != null) profitSum = money(profitSum + p);
    }
  }
  return { listed, sold, profit: profitSum, month: key };
}

export function firstListedAt(item) {
  const ids = listedSiteIds(item);
  if (!ids.length) return null;
  return Math.min(...ids.map(id => Number(item.listedOn[id].at) || 0));
}

export function setListed(item, siteId, listed = true, at = Date.now()) {
  if (!isKnownSite(siteId)) return deriveStage({ ...item, updatedAt: at });
  const listedOn = { ...(item.listedOn || {}) };
  const delistedOn = { ...(item.delistedOn || {}) };
  if (listed) {
    listedOn[siteId] = { at: (listedOn[siteId] && listedOn[siteId].at) || at };
  } else {
    delete listedOn[siteId];
    delete delistedOn[siteId];
  }
  let next = { ...item, listedOn, delistedOn, updatedAt: at };
  next = setSiteStatus(next, siteId, listed ? "live" : "draft", {
    at,
    lastCheckAt: listed ? at : (siteStatusOf(item, siteId) && siteStatusOf(item, siteId).lastCheckAt),
    unavailable: listed ? !!(item.unavailable || item.soldAt) : false,
    note: listed ? "" : "Listing cleared."
  });
  return deriveStage(next);
}

/**
 * Mark the item sold. If the sale site was not already in listedOn, it is added
 * (she sold it there, so it was listed there). That site is not a delist target.
 */
export function markSold(item, { siteId, salePrice, fees, shippingPaid, at = Date.now() } = {}) {
  let listedOn = { ...(item.listedOn || {}) };
  let soldOn = item.soldOn;
  if (siteId && isKnownSite(siteId)) {
    soldOn = siteId;
    if (!listedOn[siteId]) listedOn[siteId] = { at };
  }
  const next = {
    ...item,
    listedOn,
    soldOn,
    salePrice: salePrice !== undefined ? money(salePrice) : item.salePrice,
    fees: fees !== undefined ? money(fees) : item.fees,
    shippingPaid: shippingPaid !== undefined ? money(shippingPaid) : item.shippingPaid,
    soldAt: item.soldAt || at,
    unavailable: true,
    updatedAt: at
  };
  return deriveStage(flagUnavailableEverywhere(next, at));
}

export function markDelisted(item, siteId, done = true, at = Date.now()) {
  if (!isKnownSite(siteId)) return { ...item, updatedAt: at };
  const delistedOn = { ...(item.delistedOn || {}) };
  if (done) delistedOn[siteId] = { at };
  else delete delistedOn[siteId];
  let next = { ...item, delistedOn, updatedAt: at };
  if (done) {
    next = setSiteStatus(next, siteId, "removed", { at, lastCheckAt: at, unavailable: true, note: "You marked this as taken down." });
  } else if (item.soldAt && item.soldOn !== siteId) {
    next = setSiteStatus(next, siteId, "needsManual", { at, unavailable: true, note: "Still needs to be taken down." });
  }
  return next;
}

export function setShipCheck(item, checkId, value, at = Date.now()) {
  if (!SHIP_CHECKS.some(c => c.id === checkId)) return { ...item, updatedAt: at };
  const shipChecks = { ...(item.shipChecks || {}), [checkId]: !!value };
  const all = SHIP_CHECKS.every(c => shipChecks[c.id]);
  const next = { ...item, shipChecks, updatedAt: at };
  if (all && item.soldAt && !item.shippedAt) next.shippedAt = at;
  if (!all && item.shippedAt) {
    // Unchecking a box after auto-ship leaves the shipped date; stage stays shipped
    // only if shippedAt is set. We keep shippedAt unless they clear it on purpose.
  }
  return deriveStage(next);
}

export function markShipped(item, shipped = true, at = Date.now()) {
  if (!item.soldAt) return deriveStage({ ...item, updatedAt: at });
  return deriveStage({
    ...item,
    shippedAt: shipped ? (item.shippedAt || at) : null,
    updatedAt: at
  });
}

export function applyFields(item, fields, at = Date.now()) {
  const next = { ...item, ...fields, updatedAt: at };
  return normalizeItem(next, at);
}

/** Plain text she can paste into a selling site. Uses that site's title/description tweak when present. */
export function listingCopy(item, siteId) {
  const tw = (item.siteTweaks || {})[siteId] || {};
  const title = String(tw.title || item.title || "").trim();
  const desc = String(tw.description || item.description || "").trim();
  const notes = String(tw.notes || "").trim();
  const price = item.askingPrice ?? item.priceHigh ?? item.priceLow;
  const lines = [];
  if (title) lines.push(title);
  if (desc) { if (lines.length) lines.push(""); lines.push(desc); }
  const meta = [];
  if (price != null) meta.push(`Price: ${formatUsd(price)}`);
  if (item.condition) meta.push(`Condition: ${item.condition}`);
  if (item.brand) meta.push(`Brand: ${item.brand}`);
  if (item.category) meta.push(`Category: ${item.category}`);
  if (meta.length) { lines.push(""); lines.push(meta.join("\n")); }
  if (notes) { lines.push(""); lines.push(notes); }
  return lines.join("\n").trim();
}

export function formatUsd(n) {
  const v = money(n);
  if (v == null) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function priceRangeLabel(item) {
  const lo = money(item.priceLow), hi = money(item.priceHigh);
  if (lo == null && hi == null) return "";
  if (lo != null && hi != null) {
    if (lo === hi) return formatUsd(lo);
    return `${formatUsd(lo)} to ${formatUsd(hi)}`;
  }
  return formatUsd(lo ?? hi);
}

/** A compact status line for lists. */
export function statusLine(item) {
  if (needsDelistHighlight(item)) {
    const n = pendingDelist(item).length;
    return `Sold — take it down on ${n} site${n === 1 ? "" : "s"}`;
  }
  if (item.stage === "shipped") return "Shipped";
  if (item.stage === "sold") return item.soldOn ? `Sold on ${siteName(item.soldOn)}` : "Sold";
  if (item.stage === "listed") {
    const ids = listedSiteIds(item);
    return `Listed on ${ids.map(siteName).join(", ")}`;
  }
  return "Draft";
}


/** Normalize AI site advice. Unknown ids are dropped. Reasons stay as short text. */
export function normalizeAdvice(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const pick = block => {
    const b = block && typeof block === "object" ? block : {};
    const sites = knownSiteIds(Array.isArray(b.sites) ? b.sites : []);
    return { sites, reason: String(b.reason || "").trim() };
  };
  return {
    bestPrice: pick(src.bestPrice || src.best_price),
    fastestSale: pick(src.fastestSale || src.fastest_sale)
  };
}

export function hasAdvice(item) {
  const a = item && item.siteAdvice;
  if (!a) return false;
  const n = ((a.bestPrice && a.bestPrice.sites && a.bestPrice.sites.length) || 0) +
            ((a.fastestSale && a.fastestSale.sites && a.fastestSale.sites.length) || 0);
  return n > 0;
}

/**
 * Site ids for a plan. "own" returns [] (the UI then uses her enabled list).
 * "both" is the union of best-price and fastest-sale, best-price first.
 */
export function planSiteIds(item, plan) {
  const a = (item && item.siteAdvice) || normalizeAdvice({});
  const bp = (a.bestPrice && a.bestPrice.sites) || [];
  const fs = (a.fastestSale && a.fastestSale.sites) || [];
  const p = plan === undefined ? (item && item.sitePlan) : plan;
  if (p === "bestPrice") return bp.slice();
  if (p === "fastestSale") return fs.slice();
  if (p === "both") return knownSiteIds([...bp, ...fs]);
  return [];
}

export function setSitePlan(item, plan, at = Date.now()) {
  const p = SITE_PLANS.includes(plan) ? plan : "own";
  return { ...item, sitePlan: p, updatedAt: at };
}

export function setSiteAdvice(item, advice, at = Date.now()) {
  return { ...item, siteAdvice: normalizeAdvice(advice), updatedAt: at };
}

export const EXPORT_APP = "flip-helper";

/** Backup payload. Never includes an AI key. May include her enabled-sites list. */
export function exportPayload(items, version, at = Date.now(), extras = {}) {
  const out = {
    app: EXPORT_APP,
    version: String(version || ""),
    exportedAt: new Date(at).toISOString(),
    items: (items || []).map(i => normalizeItem(i, at))
  };
  if (Array.isArray(extras.enabledSites)) out.enabledSites = knownSiteIds(extras.enabledSites);
  if (Array.isArray(extras.mileage)) out.mileage = extras.mileage;
  if (extras.settings && typeof extras.settings === "object") {
    const s = { ...extras.settings };
    delete s.apiKey; delete s.key; delete s.openai; delete s.token;
    out.settings = s;
  }
  return out;
}

export function importPayload(data) {
  if (!data || typeof data !== "object") throw new Error("That file couldn't be read.");
  if (data.app && data.app !== EXPORT_APP) throw new Error("That file is not a Jessika's Flip Side backup.");
  const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : null);
  if (!items) throw new Error("That file has no items in it.");
  return items.map(i => normalizeItem(i));
}

/** Enabled-sites list from a backup, or null if the file didn't have one. */
export function importEnabledSites(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.enabledSites)) return null;
  const ids = knownSiteIds(data.enabledSites);
  return ids.length ? ids : null;
}

/** Mileage trips from a backup, or null if the file didn't have them. */
export function importMileage(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.mileage)) return null;
  return data.mileage;
}

/** Settings from a backup (never a key), or null. */
export function importSettings(data) {
  if (!data || typeof data !== "object" || !data.settings || typeof data.settings !== "object") return null;
  const s = { ...data.settings };
  delete s.apiKey; delete s.key; delete s.openai; delete s.token;
  return s;
}
