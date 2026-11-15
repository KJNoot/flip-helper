// Where the listing engine and business manager keep their settings: the same small key/value store as Kris's
// memory (localStorage, time-stamped), so they ride along with "Sync with my computer" when it is on.
// Objects are kept as a one-item list ([obj]) because the sync layer carries lists.
import { createKrisStore } from "./kris.js";
import { normalizeListPrefs, normalizeSkuConfig, normalizeStyle, emptyStyle } from "./listing.js";
import { normalizeBatches, normalizeDecisions } from "./business.js";

export function bizStore(storage) {
  const kv = createKrisStore(storage);
  const getObj = async name => { const v = await kv.get(name, null); return Array.isArray(v) ? v[0] : (v && typeof v === "object" ? v : null); };
  const setObj = (name, o) => kv.set(name, [o]);
  return {
    prefs: async () => normalizeListPrefs(await getObj("listPrefs")),
    setPrefs: async p => setObj("listPrefs", normalizeListPrefs(p)),
    sku: async () => normalizeSkuConfig(await getObj("listSku")),
    setSku: async c => setObj("listSku", normalizeSkuConfig(c)),
    style: async () => normalizeStyle((await getObj("listStyle")) || emptyStyle()),
    setStyle: async st => setObj("listStyle", normalizeStyle(st)),
    batches: async () => normalizeBatches(await kv.get("bizBatches", [])),
    setBatches: async list => kv.set("bizBatches", normalizeBatches(list)),
    decisions: async () => normalizeDecisions(await kv.get("bizDecisions", [])),
    setDecisions: async list => kv.set("bizDecisions", normalizeDecisions(list)),
    expenses: async () => { const e = await kv.get("krisExpenses", []); return Array.isArray(e) ? e : []; },
    facts: async () => { const f = await kv.get("krisFacts", []); return Array.isArray(f) ? f : []; },
    addFact: async t => { const f = await kv.get("krisFacts", []); const arr = Array.isArray(f) ? f : []; if (!arr.some(x => x && x.t === t)) arr.push({ t, ts: Date.now() }); await kv.set("krisFacts", arr.slice(-40)); }
  };
}
