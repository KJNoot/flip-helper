// On-device inventory store. Prefers IndexedDB; falls back to localStorage.
// Never reads or writes the AI key.
import { normalizeItem, exportPayload, importPayload } from "./inventory.js";

const DB_NAME = "flip-helper";
const DB_VERSION = 1;
const STORE = "items";
const LS_KEY = "flip-helper.items";

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("no-idb")); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("idb"));
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbStore(db) {
  const tx = mode => db.transaction(STORE, mode).objectStore(STORE);
  return {
    name: "indexeddb",
    async all() {
      const rows = await idbReq(tx("readonly").getAll());
      return (rows || []).map(r => normalizeItem(r)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async get(id) {
      const row = await idbReq(tx("readonly").get(id));
      return row ? normalizeItem(row) : null;
    },
    async put(item) {
      const row = normalizeItem(item);
      await idbReq(tx("readwrite").put(row));
      return row;
    },
    async remove(id) { await idbReq(tx("readwrite").delete(id)); },
    async wipe() { await idbReq(tx("readwrite").clear()); }
  };
}

function readLs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalizeItem) : [];
  } catch (e) { return []; }
}
function writeLs(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

function localStore() {
  return {
    name: "localstorage",
    async all() {
      return readLs().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async get(id) { return readLs().find(x => x.id === id) || null; },
    async put(item) {
      const row = normalizeItem(item);
      const items = readLs().filter(x => x.id !== row.id);
      items.push(row);
      writeLs(items);
      return row;
    },
    async remove(id) { writeLs(readLs().filter(x => x.id !== id)); },
    async wipe() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
  };
}

export async function createStore() {
  try {
    const db = await idbOpen();
    return idbStore(db);
  } catch (e) {
    return localStore();
  }
}

export async function exportFrom(store, version, at) {
  const items = await store.all();
  return exportPayload(items, version, at);
}

export async function importInto(store, data) {
  const items = importPayload(data);
  await store.wipe();
  for (const item of items) await store.put(item);
  return items;
}

export { EXPORT_APP } from "./inventory.js";
