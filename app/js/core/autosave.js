// Autosave drafts and haul batches on this device. Dedupe by item id
// so an interrupted batch can resume without creating duplicates.
// Never touches the AI key.

const WORK_KEY = "flip-helper.workDraft";
const BATCH_KEY = "flip-helper.haulBatch";
const SCAN_KEY = "flip-helper.scanWork";

function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

function readJson(s, key) {
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function writeJson(s, key, value) {
  if (!s) return false;
  try {
    if (value == null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Quota: try again without photos.
    if (value && Array.isArray(value.photos)) {
      try {
        const slim = { ...value, photos: [], photosDropped: true };
        s.setItem(key, JSON.stringify(slim));
        return true;
      } catch (e2) { return false; }
    }
    if (value && value.item && Array.isArray(value.item.photos)) {
      try {
        const slim = { ...value, item: { ...value.item, photos: [] }, photosDropped: true };
        s.setItem(key, JSON.stringify(slim));
        return true;
      } catch (e2) { return false; }
    }
    return false;
  }
}

export function saveWork(work, storage) {
  if (!work || work.saved) {
    writeJson(store(storage), WORK_KEY, null);
    return null;
  }
  const payload = { ...work, savedAt: Date.now() };
  writeJson(store(storage), WORK_KEY, payload);
  return payload;
}

export function loadWork(storage) {
  const data = readJson(store(storage), WORK_KEY);
  if (!data || data.saved) return null;
  return data;
}

export function clearWork(storage) {
  writeJson(store(storage), WORK_KEY, null);
}

export function saveScanWork(work, storage) {
  if (!work) { writeJson(store(storage), SCAN_KEY, null); return null; }
  return writeJson(store(storage), SCAN_KEY, { ...work, savedAt: Date.now() }) ? work : null;
}

export function loadScanWork(storage) {
  return readJson(store(storage), SCAN_KEY);
}

export function clearScanWork(storage) {
  writeJson(store(storage), SCAN_KEY, null);
}

export function newBatchId(at = Date.now()) {
  return "haul_" + at.toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * A haul is several photos that each become their own draft, with a stable id
 * assigned when the photo is added. Resuming skips ids already in inventory.
 */
export function createHaulBatch(photos = [], at = Date.now()) {
  const items = (photos || []).map((p, i) => ({
    id: p.itemId || ("it_haul_" + at.toString(36) + "_" + i.toString(36) + Math.random().toString(36).slice(2, 5)),
    photo: p,
    title: "",
    createdAt: at,
    saved: false
  }));
  return {
    id: newBatchId(at),
    createdAt: at,
    updatedAt: at,
    status: "in-progress",
    items
  };
}

export function addPhotosToHaul(batch, photos = [], at = Date.now()) {
  const items = (batch && batch.items ? batch.items.slice() : []);
  const existing = new Set(items.map(i => i.id));
  for (const p of photos || []) {
    const id = p.itemId || ("it_haul_" + at.toString(36) + "_" + items.length.toString(36) + Math.random().toString(36).slice(2, 5));
    if (existing.has(id)) continue;
    existing.add(id);
    items.push({ id, photo: p, title: "", createdAt: at, saved: false });
  }
  return { ...(batch || {}), items, updatedAt: at, status: "in-progress" };
}

/** Merge by item id. Later records win on fields, but a saved flag sticks. */
export function upsertBatch(batch, incoming, at = Date.now()) {
  const a = (batch && batch.items) || [];
  const b = (incoming && incoming.items) || (Array.isArray(incoming) ? incoming : []);
  const map = new Map();
  for (const row of [...a, ...b]) {
    if (!row || !row.id) continue;
    const prev = map.get(row.id);
    if (!prev) map.set(row.id, { ...row });
    else map.set(row.id, { ...prev, ...row, saved: !!(prev.saved || row.saved), id: row.id });
  }
  return {
    id: (incoming && incoming.id) || (batch && batch.id) || newBatchId(at),
    createdAt: (batch && batch.createdAt) || (incoming && incoming.createdAt) || at,
    updatedAt: at,
    status: (incoming && incoming.status) || (batch && batch.status) || "in-progress",
    items: [...map.values()]
  };
}

/**
 * Items in the batch that are not already in inventory (by id) and not
 * already marked saved. Use this to resume without creating duplicates.
 */
export function pendingHaulItems(batch, existingItems) {
  const have = new Set((existingItems || []).map(i => i.id));
  return ((batch && batch.items) || []).filter(row => row && row.id && !have.has(row.id) && !row.saved);
}

export function markHaulItemSaved(batch, id, at = Date.now()) {
  const items = ((batch && batch.items) || []).map(row => row.id === id ? { ...row, saved: true, savedAt: at } : row);
  const allSaved = items.length > 0 && items.every(r => r.saved);
  return { ...batch, items, updatedAt: at, status: allSaved ? "done" : "in-progress" };
}

export function saveBatch(batch, storage) {
  if (!batch || batch.status === "done") {
    writeJson(store(storage), BATCH_KEY, null);
    return null;
  }
  writeJson(store(storage), BATCH_KEY, batch);
  return batch;
}

export function loadBatch(storage) {
  return readJson(store(storage), BATCH_KEY);
}

export function clearBatch(storage) {
  writeJson(store(storage), BATCH_KEY, null);
}

/** Deduplicate a list of items by id, keeping the last copy. */
export function dedupeById(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item || !item.id) continue;
    map.set(item.id, item);
  }
  return [...map.values()];
}

export { WORK_KEY, BATCH_KEY, SCAN_KEY };
