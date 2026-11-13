// The AI key lives only in this device's localStorage. It is never written to a
// backup, the inventory store, or the repo. The only time it leaves the phone
// is as an Authorization header to api.openai.com when she drafts a listing or
// taps Check key.
const KEY = "flip-helper.openai.apiKey";

function store() {
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export function getKey() {
  const s = store(); if (!s) return "";
  try { return String(s.getItem(KEY) || "").trim(); } catch (e) { return ""; }
}
export function setKey(k) {
  const s = store(); if (!s) return false;
  const v = String(k == null ? "" : k).trim();
  try { if (v) s.setItem(KEY, v); else s.removeItem(KEY); return true; } catch (e) { return false; }
}
export function removeKey() {
  const s = store(); if (!s) return;
  try { s.removeItem(KEY); } catch (e) {}
}
export function hasKey() { return !!getKey(); }

/** Injected storage, for unit tests (same shape as localStorage). */
export function keyStore(storage) {
  return {
    get: () => { try { return String((storage && storage.getItem(KEY)) || "").trim(); } catch (e) { return ""; } },
    set: k => { const v = String(k == null ? "" : k).trim(); if (v) storage.setItem(KEY, v); else storage.removeItem(KEY); },
    remove: () => { try { storage.removeItem(KEY); } catch (e) {} },
    has() { return !!this.get(); },
    keyName: KEY
  };
}
