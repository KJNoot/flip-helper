// Which selling sites she uses. Stored only on this device. Not a secret,
// and it may be included in a backup. Never touches the AI key.
import { SITE_IDS, DEFAULT_ENABLED, SITES, isKnownSite, knownSiteIds } from "./sites.js";

const KEY = "flip-helper.enabledSites";

function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export function getEnabledIds(storage) {
  const s = store(storage);
  if (!s) return DEFAULT_ENABLED.slice();
  try {
    const raw = s.getItem(KEY);
    if (!raw) return DEFAULT_ENABLED.slice();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_ENABLED.slice();
    const ids = knownSiteIds(arr);
    return ids.length ? ids : DEFAULT_ENABLED.slice();
  } catch (e) { return DEFAULT_ENABLED.slice(); }
}

export function setEnabledIds(ids, storage) {
  const s = store(storage);
  const clean = knownSiteIds(ids);
  if (!s) return clean;
  try {
    if (!clean.length) s.removeItem(KEY);
    else s.setItem(KEY, JSON.stringify(clean));
  } catch (e) { /* quota */ }
  return clean.length ? clean : DEFAULT_ENABLED.slice();
}

export function isEnabled(id, storage) {
  return getEnabledIds(storage).includes(id);
}

export function enabledSites(storage) {
  const ids = new Set(getEnabledIds(storage));
  return SITES.filter(s => ids.has(s.id));
}

/** Sites to offer for posting: her enabled list, plus any already marked listed or recommended on this item. */
export function sitesForItem(item, storage) {
  const enabled = getEnabledIds(storage);
  const extra = [];
  if (item) {
    for (const id of Object.keys(item.listedOn || {})) extra.push(id);
    if (item.soldOn) extra.push(item.soldOn);
    const a = item.siteAdvice || {};
    for (const block of [a.bestPrice, a.fastestSale]) {
      if (block && Array.isArray(block.sites)) extra.push(...block.sites);
    }
    if (item.sitePlan && item.sitePlan !== "own") {
      // plan sites already in advice extras
    }
  }
  return knownSiteIds([...enabled, ...extra]);
}

export function clearEnabledIds(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(KEY); } catch (e) {}
}

export { KEY as PREFS_KEY, DEFAULT_ENABLED, SITE_IDS, isKnownSite, SITES };
