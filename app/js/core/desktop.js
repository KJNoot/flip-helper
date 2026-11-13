// Roomy computer layout helpers. The phone UI is unchanged: these only
// apply on a wide screen. Pure functions here are unit-testable in Node.

export const DESKTOP_MIN_WIDTH = 1024;
export const DESKTOP_MQ = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

export function isDesktop(width, mqImpl) {
  if (typeof width === "number") return width >= DESKTOP_MIN_WIDTH;
  try {
    const mq = mqImpl || (typeof window !== "undefined" && window.matchMedia);
    if (typeof mq === "function") return !!mq(DESKTOP_MQ).matches;
    if (typeof window !== "undefined") return window.innerWidth >= DESKTOP_MIN_WIDTH;
  } catch (_) { /* ignore */ }
  return false;
}

export function markDesktop(doc, width) {
  const root = (doc || (typeof document !== "undefined" ? document : null));
  if (!root || !root.documentElement) return isDesktop(width);
  const on = isDesktop(width);
  root.documentElement.classList.toggle("desktop", on);
  root.documentElement.dataset.desktop = on ? "1" : "0";
  return on;
}

/** Reorder a photo list by moving the item at `from` to `to`. */
export function reorderPhotos(photos, from, to) {
  const list = Array.isArray(photos) ? photos.slice() : [];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}

/** Make the photo at `index` the cover (first). */
export function movePhotoToCover(photos, index) {
  return reorderPhotos(photos, index, 0);
}

/**
 * Photos she can gather into the current listing, from other items and
 * from Second look scans. Copies only — originals stay where they are.
 */
export function gatherCandidates({ items = [], scans = [], excludeItemId = "" } = {}) {
  const out = [];
  for (const item of items || []) {
    if (!item || item.id === excludeItemId) continue;
    const title = item.title || "Untitled item";
    (item.photos || []).forEach((p, i) => {
      if (!p || !p.dataUrl) return;
      out.push({
        source: "item",
        itemId: item.id,
        scanId: "",
        photoIndex: i,
        label: title,
        caption: (item.photos.length > 1 ? `Photo ${i + 1} · ` : "") + title,
        dataUrl: p.dataUrl,
        originalDataUrl: p.originalDataUrl || null
      });
    });
  }
  for (const scan of scans || []) {
    if (!scan) continue;
    const when = scan.createdAt ? "Scan" : "A table scan";
    if (scan.coverThumb) {
      out.push({
        source: "scan",
        itemId: "",
        scanId: scan.id,
        photoIndex: -1,
        label: when,
        caption: "Cover from a table scan",
        dataUrl: scan.coverThumb,
        originalDataUrl: null
      });
    }
    (scan.items || []).forEach(it => {
      if (it && it.thumbDataUrl) {
        out.push({
          source: "scan-item",
          itemId: "",
          scanId: scan.id,
          lookItemId: it.id,
          photoIndex: 0,
          label: it.name || "From a scan",
          caption: (it.name || "From a scan") + " · table scan",
          dataUrl: it.thumbDataUrl,
          originalDataUrl: null
        });
      }
      (it && it.closeupPhotos || []).forEach((p, i) => {
        const url = typeof p === "string" ? p : (p && (p.dataUrl || p));
        if (!url) return;
        out.push({
          source: "scan-closeup",
          itemId: "",
          scanId: scan.id,
          lookItemId: it.id,
          photoIndex: i,
          label: it.name || "Close-up",
          caption: (it.name || "Close-up") + " · close photo",
          dataUrl: url,
          originalDataUrl: null
        });
      });
    });
  }
  return out;
}

export function applyGathered(photos, picks, at = Date.now()) {
  const list = Array.isArray(photos) ? photos.slice() : [];
  for (const pick of picks || []) {
    if (!pick || !pick.dataUrl) continue;
    list.push({
      id: "",
      dataUrl: pick.dataUrl,
      originalDataUrl: pick.originalDataUrl || null,
      addedAt: at,
      gatheredFrom: pick.source + ":" + (pick.itemId || pick.scanId || "")
    });
  }
  return list;
}

/** Fields the bulk editor may apply. Keep this conservative. */
export const BULK_FIELDS = ["category", "condition", "binLocation", "notes", "flawsNoted", "noFlaws"];

export function bulkFields(raw = {}) {
  const out = {};
  for (const k of BULK_FIELDS) {
    if (raw[k] === undefined || raw[k] === "") continue;
    out[k] = raw[k];
  }
  return out;
}

export function droppedImageFiles(fileList) {
  const files = [...(fileList || [])];
  return files.filter(f => f && /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name || ""));
}

export { BULK_FIELDS as DESKTOP_BULK_FIELDS };
