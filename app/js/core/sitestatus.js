// Per-site listing status. Today she updates these herself.
// Automatic checks and official take-down are Coming later.
import { SITE_IDS, isKnownSite, siteName, siteById } from "./sites.js";

export const SITE_STATUSES = ["draft", "pending", "live", "sold", "removed", "failed", "needsManual"];

export const SITE_STATUS_LABELS = {
  draft: "Draft",
  pending: "Pending",
  live: "Live",
  sold: "Sold",
  removed: "Removed",
  failed: "Failed",
  needsManual: "Needs a manual step"
};

export const SITE_STATUS_NOTE = "You set each site's status yourself in this version. Automatic checks that a listing is really live or gone are coming later.";

export const GUIDED_TAKEDOWN_NOTE = "This walks you through each remaining site, one after another, and ticks a site off when you confirm you took it down. Automatic removal comes later for eBay, Etsy, and Shopify through official connections, and through the computer helper. Some sites will always need your tap.";

export const GUIDED_TAKEDOWN_PAUSED = "Automation is paused. Turn it back on in Settings, or take each site down yourself with the checklist below.";

export const DOUBLE_SALE_CAVEAT = "This helps you take listings down quickly, but it cannot promise that a double sale is impossible.";

export function isSiteStatus(s) {
  return SITE_STATUSES.includes(s);
}

export function statusLabel(s) {
  return SITE_STATUS_LABELS[s] || String(s || "");
}

export function normalizeOneStatus(raw = {}, at = 0) {
  const status = isSiteStatus(raw.status) ? raw.status : "draft";
  return {
    status,
    lastCheckAt: raw.lastCheckAt || raw.at || at || null,
    note: String(raw.note || "").trim(),
    updatedAt: raw.updatedAt || raw.at || at || 0,
    unavailable: !!raw.unavailable,
    auto: false // automatic checks are not built yet
  };
}

export function normalizeSiteStatusMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of SITE_IDS) {
    const v = raw[id];
    if (!v || typeof v !== "object") continue;
    out[id] = normalizeOneStatus(v);
  }
  return out;
}

function listedIds(item) {
  const map = (item && item.listedOn) || {};
  return SITE_IDS.filter(id => !!map[id]);
}

function isDelisted(item, siteId) {
  return !!(item && item.delistedOn && item.delistedOn[siteId]);
}

/**
 * Status for one site. Uses an explicit record when present, otherwise
 * derives it from listed / sold / delisted facts so older items still work.
 */
export function siteStatusOf(item, siteId) {
  if (!isKnownSite(siteId)) return null;
  const explicit = item && item.siteStatus && item.siteStatus[siteId];
  if (explicit && isSiteStatus(explicit.status)) {
    const row = normalizeOneStatus(explicit);
    // A sale always wins for the sale site.
    if (item.soldOn === siteId && item.soldAt && row.status !== "sold") {
      return { ...row, status: "sold", unavailable: true };
    }
    return row;
  }
  if (item && item.soldOn === siteId && item.soldAt) {
    return normalizeOneStatus({ status: "sold", lastCheckAt: item.soldAt, updatedAt: item.soldAt, unavailable: true });
  }
  if (isDelisted(item, siteId)) {
    const at = item.delistedOn[siteId].at || 0;
    return normalizeOneStatus({ status: "removed", lastCheckAt: at, updatedAt: at, unavailable: true });
  }
  if (item && item.listedOn && item.listedOn[siteId]) {
    const at = item.listedOn[siteId].at || 0;
    const unavailable = !!(item.unavailable || item.soldAt);
    const status = unavailable ? "needsManual" : "live";
    return normalizeOneStatus({ status, lastCheckAt: at, updatedAt: at, unavailable });
  }
  return normalizeOneStatus({ status: "draft" });
}

/** Every known site, with a derived or explicit status. */
export function siteStatusList(item, siteIds) {
  const ids = (siteIds && siteIds.length ? siteIds : SITE_IDS).filter(isKnownSite);
  return ids.map(id => {
    const s = siteById(id);
    const row = siteStatusOf(item, id);
    return {
      siteId: id,
      name: s ? (s.short || s.name) : id,
      fullName: s ? s.name : id,
      manageUrl: s ? s.manageUrl : "",
      sellUrl: s ? s.sellUrl : "",
      ...row,
      label: statusLabel(row.status)
    };
  });
}

export function setSiteStatus(item, siteId, status, { at = Date.now(), note, lastCheckAt, unavailable } = {}) {
  if (!isKnownSite(siteId) || !isSiteStatus(status)) return item;
  const siteStatus = { ...(item.siteStatus || {}) };
  const prev = siteStatusOf(item, siteId) || {};
  siteStatus[siteId] = normalizeOneStatus({
    ...prev,
    status,
    note: note !== undefined ? note : prev.note,
    lastCheckAt: lastCheckAt !== undefined ? lastCheckAt : (status === prev.status ? prev.lastCheckAt : at),
    updatedAt: at,
    unavailable: unavailable !== undefined ? unavailable : prev.unavailable
  }, at);
  return { ...item, siteStatus, updatedAt: at };
}

/** "I did it" — she took the listing down herself. */
export function confirmSiteDone(item, siteId, at = Date.now()) {
  if (!isKnownSite(siteId)) return item;
  const delistedOn = { ...(item.delistedOn || {}) };
  delistedOn[siteId] = { at: (delistedOn[siteId] && delistedOn[siteId].at) || at };
  const next = setSiteStatus(
    { ...item, delistedOn },
    siteId,
    "removed",
    { at, lastCheckAt: at, unavailable: true, note: "You marked this as taken down." }
  );
  return next;
}

/** Retry a failed or stale row. Today this only clears the failure; automatic retry is Coming later. */
export function retrySiteStatus(item, siteId, at = Date.now()) {
  if (!isKnownSite(siteId)) return item;
  const prev = siteStatusOf(item, siteId);
  const nextStatus = prev && prev.unavailable && !isDelisted(item, siteId) ? "needsManual" : (item.listedOn && item.listedOn[siteId] ? "pending" : "draft");
  return setSiteStatus(item, siteId, nextStatus, {
    at,
    lastCheckAt: at,
    note: "Ready for you to try again. Automatic checks are coming later."
  });
}

export function markSiteFailed(item, siteId, note, at = Date.now()) {
  if (!isKnownSite(siteId)) return item;
  return setSiteStatus(item, siteId, "failed", {
    at,
    lastCheckAt: at,
    note: note || "This step didn't work. Please try again, or take it down yourself.",
    unavailable: !!(item && (item.unavailable || item.soldAt))
  });
}

export function markSitePending(item, siteId, at = Date.now()) {
  return setSiteStatus(item, siteId, "pending", { at, lastCheckAt: at });
}

export function markSiteLive(item, siteId, at = Date.now()) {
  const listedOn = { ...(item.listedOn || {}) };
  if (!listedOn[siteId]) listedOn[siteId] = { at };
  return setSiteStatus({ ...item, listedOn }, siteId, "live", { at, lastCheckAt: at, unavailable: false });
}

/**
 * Flag the item Unavailable everywhere. Called the moment a sale is marked.
 * Other live listings become "Needs a manual step" until she takes them down.
 * This does not itself take anything down.
 */
export function flagUnavailableEverywhere(item, at = Date.now()) {
  if (!item) return item;
  let siteStatus = { ...(item.siteStatus || {}) };
  const soldOn = item.soldOn;
  for (const id of SITE_IDS) {
    const listed = !!(item.listedOn && item.listedOn[id]);
    const delisted = isDelisted(item, id);
    const prev = siteStatusOf(item, id);
    if (soldOn && id === soldOn) {
      siteStatus[id] = normalizeOneStatus({
        status: "sold",
        lastCheckAt: at,
        updatedAt: at,
        unavailable: true,
        note: prev && prev.note
      }, at);
      continue;
    }
    if (delisted) {
      siteStatus[id] = normalizeOneStatus({
        status: "removed",
        lastCheckAt: (item.delistedOn[id] && item.delistedOn[id].at) || at,
        updatedAt: at,
        unavailable: true,
        note: prev && prev.note
      }, at);
      continue;
    }
    if (listed) {
      siteStatus[id] = normalizeOneStatus({
        status: prev && prev.status === "failed" ? "failed" : "needsManual",
        lastCheckAt: prev && prev.lastCheckAt,
        updatedAt: at,
        unavailable: true,
        note: prev && prev.status === "failed"
          ? prev.note
          : "Marked unavailable because this item sold. Please take the listing down so it doesn't sell twice."
      }, at);
    }
  }
  return { ...item, unavailable: true, siteStatus, updatedAt: at };
}

/** Sites still waiting on a take-down, in a stable order, for the guided flow. */
export function guidedQueue(item) {
  if (!item || !item.soldAt) return [];
  return listedIds(item).filter(id => id !== item.soldOn && !isDelisted(item, id));
}

export function startGuidedTakedown(item, at = Date.now()) {
  const flagged = flagUnavailableEverywhere(item, at);
  const queue = guidedQueue(flagged);
  return {
    item: flagged,
    queue,
    index: 0,
    total: queue.length,
    done: queue.length === 0
  };
}

export function guidedCurrent(state) {
  if (!state || state.done || state.index >= (state.queue || []).length) {
    return { done: true, siteId: null, index: state ? state.index : 0, total: state ? state.total : 0, isLast: true };
  }
  const siteId = state.queue[state.index];
  const s = siteById(siteId);
  return {
    done: false,
    siteId,
    name: s ? s.name : siteId,
    short: s ? (s.short || s.name) : siteId,
    manageUrl: s ? s.manageUrl : "",
    index: state.index,
    number: state.index + 1,
    total: state.total,
    isLast: state.index === state.total - 1
  };
}

/** Advance after "I did it" or "Skip". `didIt` ticks the current site off. */
export function advanceGuidedTakedown(item, state, { didIt = false, at = Date.now() } = {}) {
  const cur = guidedCurrent(state);
  let nextItem = item;
  if (cur.siteId && didIt) nextItem = confirmSiteDone(nextItem, cur.siteId, at);
  const nextIndex = (state.index || 0) + 1;
  const queue = state.queue || [];
  const done = nextIndex >= queue.length;
  return {
    item: nextItem,
    state: {
      queue,
      index: nextIndex,
      total: queue.length,
      done
    }
  };
}

export function formatLastCheck(at, now = Date.now()) {
  if (!at) return "Not checked yet";
  const ms = Math.max(0, now - Number(at));
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 45) return "Just now";
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  if (d < 14) return d === 1 ? "Yesterday" : `${d} days ago`;
  try {
    return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) { return "Earlier"; }
}

export function failedSiteIds(item) {
  return SITE_IDS.filter(id => {
    const s = siteStatusOf(item, id);
    return s && s.status === "failed";
  });
}

export function needsManualSiteIds(item) {
  return SITE_IDS.filter(id => {
    const s = siteStatusOf(item, id);
    return s && s.status === "needsManual";
  });
}

export { SITE_IDS, isKnownSite, siteName, siteById };
