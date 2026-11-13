// Original photos and text, plus an undoable edit history per item.
// Snapshots store text fields, not extra copies of every photo (originals
// live on each photo as originalDataUrl).
const TEXT_FIELDS = [
  "title", "description", "category", "condition", "brand", "material", "size",
  "measurements", "notes", "priceLow", "priceHigh", "priceReason", "askingPrice", "costPaid",
  "binLocation"
];

export function newHistoryId(at = Date.now()) {
  return "ed_" + at.toString(36) + Math.random().toString(36).slice(2, 7);
}

function textSnapshot(item) {
  const out = {};
  for (const k of TEXT_FIELDS) out[k] = item[k] == null ? "" : item[k];
  out.siteTweaks = item.siteTweaks && typeof item.siteTweaks === "object" ? JSON.parse(JSON.stringify(item.siteTweaks)) : {};
  out.youConfirm = item.youConfirm && typeof item.youConfirm === "object" ? JSON.parse(JSON.stringify(item.youConfirm)) : null;
  return out;
}

function clonePhotosOriginals(photos) {
  return (photos || []).filter(p => p && (p.dataUrl || p.originalDataUrl)).map(p => ({
    id: p.id || "",
    dataUrl: p.originalDataUrl || p.dataUrl,
    addedAt: p.addedAt || 0
  }));
}

/** Capture the first-seen original photos and text, once. */
export function captureOriginals(item, at = Date.now()) {
  if (!item) return item;
  if (item.originals && item.originals.capturedAt) return item;
  return {
    ...item,
    originals: {
      ...textSnapshot(item),
      photos: clonePhotosOriginals(item.photos),
      capturedAt: at
    },
    updatedAt: at
  };
}

export function hasOriginals(item) {
  return !!(item && item.originals && item.originals.capturedAt);
}

export function normalizeHistoryEntry(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: String(raw.id || ""),
    at: raw.at || 0,
    kind: String(raw.kind || "edit"), // edit | bulk | import | photo | ai | restore
    label: String(raw.label || "").trim(),
    snapshot: raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : {}
  };
}

export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeHistoryEntry).filter(Boolean);
}

/**
 * Push a snapshot of the current text (before a change) onto the history.
 * Call this with the item as it is now, then apply the change.
 */
export function pushHistory(item, { kind = "edit", label = "Edit", at = Date.now(), snapshot } = {}) {
  const base = item.originals ? item : captureOriginals(item, at);
  const hist = normalizeHistory(base.editHistory);
  hist.push(normalizeHistoryEntry({
    id: newHistoryId(at),
    at,
    kind,
    label,
    snapshot: snapshot || textSnapshot(base)
  }));
  // Keep a reasonable tail so storage stays small.
  const trimmed = hist.length > 40 ? hist.slice(hist.length - 40) : hist;
  return { ...base, editHistory: trimmed, updatedAt: at };
}

export function canUndo(item) {
  return !!(item && Array.isArray(item.editHistory) && item.editHistory.length);
}

/** Restore the last snapshot and drop it from the history. */
export function undoLast(item, at = Date.now()) {
  const hist = normalizeHistory(item && item.editHistory);
  if (!hist.length) return item;
  const last = hist[hist.length - 1];
  const snap = last.snapshot || {};
  const next = { ...item, editHistory: hist.slice(0, -1), updatedAt: at };
  for (const k of TEXT_FIELDS) {
    if (k in snap) next[k] = snap[k] === "" ? (["priceLow", "priceHigh", "askingPrice", "costPaid"].includes(k) ? null : "") : snap[k];
  }
  if (snap.siteTweaks) next.siteTweaks = snap.siteTweaks;
  if (snap.youConfirm) next.youConfirm = snap.youConfirm;
  return next;
}

/** A preview of a history entry (or the originals) without changing the item. */
export function previewSnapshot(item, historyId) {
  if (historyId === "original" || historyId === "originals") {
    return item && item.originals ? { ...textSnapshot(item.originals), photos: item.originals.photos || [], kind: "original", label: "Original", at: item.originals.capturedAt } : null;
  }
  const hist = normalizeHistory(item && item.editHistory);
  const entry = hist.find(h => h.id === historyId) || (historyId == null && hist.length ? hist[hist.length - 1] : null);
  if (!entry) return null;
  return { ...entry.snapshot, kind: entry.kind, label: entry.label, at: entry.at, id: entry.id };
}

/** Restore the original text (and optionally original photos). Pushes a history entry first. */
export function restoreOriginals(item, { photos = false, at = Date.now() } = {}) {
  if (!hasOriginals(item)) return item;
  let next = pushHistory(item, { kind: "restore", label: "Before restoring the original", at });
  const o = next.originals;
  for (const k of TEXT_FIELDS) {
    if (k in o) next[k] = o[k];
  }
  if (o.siteTweaks) next.siteTweaks = o.siteTweaks;
  if (photos && Array.isArray(o.photos) && o.photos.length) {
    // Put original photos back, keeping any extra photos that were added later.
    const origIds = new Set(o.photos.map(p => p.dataUrl));
    const extras = (next.photos || []).filter(p => p && p.originalDataUrl && !origIds.has(p.originalDataUrl) && !origIds.has(p.dataUrl));
    next.photos = [...o.photos.map(p => ({ ...p })), ...extras];
  }
  next.updatedAt = at;
  return next;
}

/**
 * Keep the original pixels when a photo is cleaned up. `dataUrl` is the new
 * (cleaned) picture; the first original is preserved on originalDataUrl.
 */
export function applyCleanedPhoto(photos, index, dataUrl, at = Date.now()) {
  const list = Array.isArray(photos) ? photos.slice() : [];
  const prev = list[index];
  if (!prev) return list;
  list[index] = {
    ...prev,
    dataUrl,
    originalDataUrl: prev.originalDataUrl || prev.dataUrl,
    cleanedAt: at,
    cleaned: "basic"
  };
  return list;
}

export function restorePhotoOriginal(photos, index) {
  const list = Array.isArray(photos) ? photos.slice() : [];
  const prev = list[index];
  if (!prev || !prev.originalDataUrl) return list;
  list[index] = {
    ...prev,
    dataUrl: prev.originalDataUrl,
    cleanedAt: null,
    cleaned: null
  };
  return list;
}

export function photoHasOriginal(photo) {
  return !!(photo && photo.originalDataUrl && photo.originalDataUrl !== photo.dataUrl);
}

/** Apply the same text changes to many items, each with its own undo entry. */
export function bulkApply(items, fields, { label = "Bulk edit", at = Date.now() } = {}) {
  return (items || []).map(item => {
    const next = pushHistory(item, { kind: "bulk", label, at });
    return { ...next, ...fields, updatedAt: at };
  });
}

export { TEXT_FIELDS, textSnapshot };
