// Sandboxed "try it before you install" demo. In-memory only.
// Nothing here is written to the real inventory store, and nothing is posted
// to a selling site. Every pretend step is labeled as such.

import { emptyItem, normalizeItem, money, formatUsd, setListed, markSold, markShipped, setShipCheck, SHIP_CHECKS, newId } from "./inventory.js";
import { applyDraft, normalizeDraft, requestDraft } from "./draft.js";
import { scanResult } from "./scanner.js";
import { setSiteStatus, flagUnavailableEverywhere, confirmSiteDone, startGuidedTakedown, guidedQueue, guidedCurrent, advanceGuidedTakedown, siteStatusOf } from "./sitestatus.js";
import { profitBreakdown, PROFIT_NOTE } from "./profit.js";
import { heuristicShip, shippingEstimates, SHIP_TABLE_NOTE, boxSizeLabel } from "./shipping.js";
import { feeFor } from "./fees.js";
import { siteName, knownSiteIds } from "./sites.js";
import { getKey, hasKey } from "./key.js";
import { SAMPLES, sampleById, sampleDraft, samplePhoto, GENERIC_OWN_PHOTO, SAMPLE_OWN_PHOTO_NOTE, SAMPLE_LABEL, SAMPLE_DRAFT_NOTE } from "./samples.js";

export const PRETEND_POSTED = "Pretend: nothing was posted";
export const PRETEND_SOLD = "Pretend: this is a fast-forward. Nothing really sold.";
export const PRETEND_TAKEDOWN = "Pretend: nothing was taken down on a real site.";
export const PRETEND_BANNER = "This is a demo. Your real items are left alone.";
export const PRETEND_INVENTORY = "Nothing in this demo is saved to your real inventory.";

export const DEMO_STEPS = [
  "welcome", "photo", "samples", "draft", "scan", "sites",
  "listing", "sold", "takedown", "pack", "ship", "profit", "end"
];

/** One plain sentence, on every step, about what happens for real. */
export const DEMO_EXPLAIN = {
  welcome: "Watch a short look, then try the app yourself with a photo.",
  photo: "For real, you take a photo of something you want to sell.",
  samples: "Pick a sample item to walk through the whole path, from a photo to a sale.",
  draft: "For real, the AI writes a listing for you to check and change before anything is posted.",
  scan: "For real, at a thrift store you can see a buy-up-to price and estimated profit before you buy.",
  sites: "For real, you pick the sites. The app suggests where it might sell for more, or faster.",
  listing: "For real, you copy the listing and post it yourself in each site's own app. Nothing is posted automatically.",
  sold: "For real, when an item sells on one site, the app tells you right away so you can take it down elsewhere.",
  takedown: "For real, you get a walk-through to take the listing down on the other sites, so it doesn't sell twice.",
  pack: "For real, when it sells you see the photo, where you stored it, and a packing checklist.",
  ship: "For real, you get a box and cost estimate, then enter the actual shipping cost. Buying a real label comes later.",
  profit: "For real, the app tracks what you paid, fees, shipping, and what you kept, all year.",
  end: "Add this to your Home Screen so it opens like an app. Your real items stay on this phone."
};

export function createDemoStore() {
  const rows = new Map();
  return {
    name: "demo-memory",
    isDemo: true,
    async all() {
      return [...rows.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async get(id) { return rows.has(id) ? rows.get(id) : null; },
    async put(item) {
      const row = normalizeItem(item);
      rows.set(row.id, row);
      return row;
    },
    async remove(id) { rows.delete(id); },
    async wipe() { rows.clear(); }
  };
}

export function newDemoId(at = Date.now()) {
  return "demo_" + at.toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptySession(at = Date.now()) {
  return {
    step: "welcome",
    source: null,          // "photo" | "sample"
    sampleId: null,
    draftSource: null,     // "ai" | "sample"
    draftNote: "",
    photos: [],
    siteIds: ["ebay", "poshmark", "mercari", "facebook"],
    listingShown: 0,
    listingDone: false,
    soldOn: null,
    takedownIds: [],
    takedownShown: 0,
    packed: false,
    shipped: false,
    item: null,
    store: createDemoStore(),
    at
  };
}

export function gotoStep(session, step) {
  if (!DEMO_STEPS.includes(step)) return session;
  return { ...session, step };
}

function persist(session, item) {
  const row = normalizeItem(item);
  // Fire-and-forget into the in-memory demo store. Callers may also await.
  try { session.store && session.store.put(row); } catch (e) { /* ignore */ }
  return { ...session, item: row };
}

export function setDemoPhotos(session, photos, at = Date.now()) {
  const shots = (photos || []).filter(p => p && (p.dataUrl || typeof p === "string")).map(p => (
    typeof p === "string" ? { dataUrl: p, addedAt: at } : p
  ));
  let item = session.item || emptyItem({ id: newDemoId(at) }, at);
  item = { ...item, photos: shots, updatedAt: at };
  return persist({ ...session, photos: shots, source: session.source || "photo" }, item);
}

export function applySample(session, sampleId, at = Date.now()) {
  const sample = sampleById(sampleId);
  if (!sample) return session;
  const photo = samplePhoto(sample);
  const draft = sampleDraft(sample);
  let item = emptyItem({
    id: newDemoId(at),
    photos: photo ? [photo] : [],
    costPaid: sample.costPaid,
    binLocation: sample.binLocation,
    packedWeightOz: sample.weightOz
  }, at);
  item = applyDraft(item, draft, at);
  item.costPaid = money(sample.costPaid);
  item.binLocation = sample.binLocation;
  const sites = knownSiteIds(sample.defaultSites && sample.defaultSites.length ? sample.defaultSites : session.siteIds);
  return persist({
    ...session,
    step: "draft",
    source: "sample",
    sampleId: sample.id,
    draftSource: "sample",
    draftNote: SAMPLE_DRAFT_NOTE,
    photos: item.photos,
    siteIds: sites,
    item
  }, item);
}

export function applyCannedDraft(session, raw = GENERIC_OWN_PHOTO, note = SAMPLE_OWN_PHOTO_NOTE, at = Date.now()) {
  const draft = normalizeDraft(raw);
  let item = session.item || emptyItem({ id: newDemoId(at), photos: session.photos }, at);
  item = applyDraft(item, draft, at);
  return persist({
    ...session,
    step: "draft",
    draftSource: "sample",
    draftNote: note,
    item
  }, item);
}

export function applyAiDraft(session, draft, at = Date.now()) {
  let item = session.item || emptyItem({ id: newDemoId(at), photos: session.photos }, at);
  item = applyDraft(item, draft, at);
  return persist({
    ...session,
    step: "draft",
    draftSource: "ai",
    draftNote: "This draft came from the AI, from your photo. Please check it. Prices are estimates.",
    item
  }, item);
}

/**
 * Make a draft for the current photos. Uses a real AI call only when a key
 * is already on this device. Never sends a key anywhere else, and never
 * writes to the real inventory. Falls back to a labeled sample on failure.
 */
export async function draftForDemo(session, { request = requestDraft, key, enabledSites } = {}) {
  const photos = (session.photos && session.photos.length) ? session.photos : (session.item && session.item.photos) || [];
  const k = (key != null ? key : (hasKey() ? getKey() : "")).trim();
  if (k && photos.length) {
    try {
      const { draft } = await request({ photos, key: k, enabledSites, notes: "This is a demo draft the seller is trying before they install." });
      return applyAiDraft(session, draft);
    } catch (e) {
      const next = applyCannedDraft(session, GENERIC_OWN_PHOTO, "The AI couldn't be reached, so this is a sample draft. " + (e && e.message ? e.message : ""));
      next.error = e && e.message ? e.message : "The draft couldn't be made.";
      return next;
    }
  }
  return applyCannedDraft(session);
}

export function demoScan(session, { desiredProfit, siteIds } = {}) {
  const item = session.item || {};
  const sample = session.sampleId ? sampleById(session.sampleId) : null;
  const cost = money(item.costPaid) ?? (sample ? money(sample.costPaid) : 4);
  const ids = knownSiteIds(siteIds || session.siteIds);
  const weight = item.packedWeightOz || (sample && sample.weightOz) || 16;
  const want = desiredProfit != null ? money(desiredProfit) : (sample ? money(sample.desiredProfit) : 6);
  const result = scanResult({
    asking: cost,
    resaleLow: item.priceLow,
    resaleHigh: item.priceHigh,
    siteIds: ids,
    weightOz: weight,
    costPaid: cost,
    desiredProfit: want
  });
  return result;
}

export function setDemoSites(session, ids) {
  const siteIds = knownSiteIds(ids);
  return { ...session, siteIds: siteIds.length ? siteIds : session.siteIds };
}

export function startListing(session) {
  return { ...session, step: "listing", listingShown: 0, listingDone: false };
}

export function revealNextListing(session, at = Date.now()) {
  const ids = session.siteIds || [];
  const n = Math.min((session.listingShown || 0) + 1, ids.length);
  let item = session.item || emptyItem({ id: newDemoId(at) }, at);
  for (const id of ids.slice(0, n)) {
    item = setListed(item, id, true, at);
    item = setSiteStatus(item, id, "live", { at });
  }
  const done = n >= ids.length && ids.length > 0;
  return persist({ ...session, listingShown: n, listingDone: done, step: "listing" }, item);
}

export function revealAllListings(session, at = Date.now()) {
  let s = { ...session, listingShown: 0 };
  const n = (s.siteIds || []).length;
  for (let i = 0; i < n; i++) s = revealNextListing(s, at);
  return s;
}

export function soldSiteId(session) {
  const ids = session.siteIds || [];
  if (ids.includes("mercari")) return "mercari";
  return ids[0] || "mercari";
}

export function pretendSold(session, at = Date.now()) {
  const sample = session.sampleId ? sampleById(session.sampleId) : null;
  const soldOn = soldSiteId(session);
  let item = session.item;
  if (!item) return session;
  // Make sure the sold site is listed first, in case reveal was skipped.
  if (!(item.listedOn && item.listedOn[soldOn])) {
    item = setListed(item, soldOn, true, at);
    item = setSiteStatus(item, soldOn, "live", { at });
  }
  const sale = money((sample && sample.salePrice) || item.askingPrice || item.priceHigh || 16);
  const fee = feeFor(soldOn, sale).fee;
  const ship = money((sample && sample.shipCost) || 5.5);
  item = markSold(item, { siteId: soldOn, salePrice: sale, fees: fee, shippingPaid: ship, at });
  item = flagUnavailableEverywhere(item, at);
  const remaining = (session.siteIds || []).filter(id => id !== soldOn);
  return persist({
    ...session,
    step: "sold",
    soldOn,
    takedownIds: remaining,
    takedownShown: 0,
    item
  }, item);
}

export function startDemoTakedown(session, at = Date.now()) {
  let item = session.item;
  if (!item) return session;
  // startGuidedTakedown returns a guided-flow state { item, queue, index }, not an item.
  const guided = startGuidedTakedown(item, at);
  item = guided.item || item;
  return persist({ ...session, step: "takedown", item, takedownShown: 0, guided }, item);
}

export function revealNextTakedown(session, at = Date.now()) {
  let item = session.item;
  if (!item) return session;
  const ids = session.takedownIds || guidedQueue(item);
  const n = Math.min((session.takedownShown || 0) + 1, ids.length);
  const id = ids[n - 1];
  if (id) item = confirmSiteDone(item, id, at);
  const done = n >= ids.length;
  return persist({ ...session, takedownShown: n, takedownDone: done, step: "takedown" }, item);
}

/** "Take them all down automatically" — in the demo this is pretend and instant. */
export function takeDownAllPretend(session, at = Date.now()) {
  let s = { ...session, step: "takedown" };
  const ids = s.takedownIds || (s.item ? guidedQueue(s.item) : []);
  s.takedownIds = ids;
  s.takedownShown = 0;
  for (let i = 0; i < ids.length; i++) s = revealNextTakedown(s, at);
  return { ...s, takedownDone: true };
}

export function markDemoPacked(session, at = Date.now()) {
  let item = session.item;
  if (!item) return session;
  for (const c of SHIP_CHECKS) {
    if (c.id === "droppedOff") continue;
    item = setShipCheck(item, c.id, true, at);
  }
  return persist({ ...session, packed: true, step: "pack", item }, item);
}

export function markDemoShipped(session, at = Date.now()) {
  let item = session.item;
  if (!item) return session;
  const sample = session.sampleId ? sampleById(session.sampleId) : null;
  if (sample && sample.shipCost != null) item = { ...item, actualShipCost: money(sample.shipCost), shippingPaid: money(sample.shipCost) };
  for (const c of SHIP_CHECKS) item = setShipCheck(item, c.id, true, at);
  item = markShipped(item, true, at);
  return persist({ ...session, packed: true, shipped: true, step: "ship", item }, item);
}

export function demoShipSuggest(session) {
  const item = session.item || {};
  const sample = session.sampleId ? sampleById(session.sampleId) : null;
  const suggest = heuristicShip(item);
  const weight = item.packedWeightOz || (sample && sample.weightOz) || (suggest && suggest.weightOz) || 16;
  const estimates = shippingEstimates(weight);
  return { suggest, weight, estimates, note: SHIP_TABLE_NOTE, boxLabel: boxSizeLabel(suggest) };
}

export function demoProfit(session) {
  const item = session.item;
  if (!item) return null;
  const breakdown = profitBreakdown(item);
  return { ...breakdown, note: PROFIT_NOTE, item, format: formatUsd };
}

export function listingRows(session) {
  const ids = session.siteIds || [];
  const shown = session.listingShown || 0;
  const item = session.item;
  return ids.map((id, i) => ({
    siteId: id,
    name: siteName(id),
    visible: i < shown,
    status: item ? siteStatusOf(item, id).status : (i < shown ? "live" : "draft"),
    pretend: true
  }));
}

export function takedownRows(session) {
  const ids = session.takedownIds || [];
  const shown = session.takedownShown || 0;
  const item = session.item;
  return ids.map((id, i) => ({
    siteId: id,
    name: siteName(id),
    done: i < shown,
    status: item ? siteStatusOf(item, id).status : (i < shown ? "removed" : "needsManual"),
    pretend: true
  }));
}

export function soldHeadline(session) {
  const id = session.soldOn || soldSiteId(session);
  return "Sold on " + siteName(id) + "!";
}

export function isDemoItemId(id) {
  return String(id || "").startsWith("demo_");
}

/** Delays for listing / sold animations. Zero in tests or reduced motion. */
export function demoDelay(ms = 550, win = globalThis) {
  try {
    if (win && (win.__flipFast || win.__flipQuiet)) return 0;
    if (win && typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  } catch (e) { /* ignore */ }
  return ms;
}

export function demoSourceLabel(session) {
  if (session && session.draftSource === "ai") return "From the AI";
  return SAMPLE_LABEL;
}

export {
  SAMPLES, sampleById, SAMPLE_OWN_PHOTO_NOTE, SAMPLE_LABEL, SAMPLE_DRAFT_NOTE,
  GENERIC_OWN_PHOTO, siteName, formatUsd, money, SHIP_CHECKS, PROFIT_NOTE,
  SHIP_TABLE_NOTE, guidedQueue, guidedCurrent, siteStatusOf, hasKey
};
