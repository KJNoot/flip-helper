// CSV import with simple column mapping, a merge-duplicates helper,
// and a free CSV export. Never includes an AI key.
import { emptyItem, money, newId, normalizeItem, listedSiteIds } from "./inventory.js";
import { alreadyOwnedMatches, titleSimilarity } from "./match.js";
import { pushHistory } from "./history.js";
import { SITE_IDS, isKnownSite } from "./sites.js";

export const CSV_FIELDS = [
  { id: "title", label: "Title", aliases: ["title", "name", "item", "item name", "listing", "listing title"] },
  { id: "description", label: "Description", aliases: ["description", "desc", "details", "body"] },
  { id: "category", label: "Category", aliases: ["category", "cat", "type"] },
  { id: "brand", label: "Brand", aliases: ["brand", "maker", "manufacturer"] },
  { id: "condition", label: "Condition", aliases: ["condition", "cond"] },
  { id: "size", label: "Size", aliases: ["size"] },
  { id: "material", label: "Material", aliases: ["material", "fabric"] },
  { id: "measurements", label: "Measurements", aliases: ["measurements", "measurement", "dims", "dimensions"] },
  { id: "askingPrice", label: "Asking price", aliases: ["asking", "asking price", "price", "list price"] },
  { id: "costPaid", label: "What you paid", aliases: ["cost", "cost paid", "purchase", "purchase cost", "paid", "bought for"] },
  { id: "salePrice", label: "Sale price", aliases: ["sale", "sale price", "sold for", "sold price"] },
  { id: "fees", label: "Fees", aliases: ["fees", "fee", "marketplace fees"] },
  { id: "shippingPaid", label: "Shipping you paid", aliases: ["shipping", "postage", "ship", "shipping paid"] },
  { id: "supplies", label: "Supplies", aliases: ["supplies", "supply"] },
  { id: "binLocation", label: "Bin location", aliases: ["bin", "bin location", "location", "shelf", "box"] },
  { id: "listedOn", label: "Listed on (sites)", aliases: ["listed on", "sites", "listed", "marketplaces"] },
  { id: "soldOn", label: "Sold on", aliases: ["sold on", "sold site"] },
  { id: "notes", label: "Notes", aliases: ["notes", "note", "comments"] },
  { id: "sku", label: "SKU / id", aliases: ["sku", "id", "item id", "inventory id"] }
];

export function parseCsv(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  if (!src.trim()) return { headers: [], rows: [] };
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => {
    // Skip completely empty rows
    if (row.some(c => String(c).trim())) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { pushField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushField(); pushRow(); i++; continue; }
    field += c; i++;
  }
  pushField();
  if (row.length && row.some(c => String(c).trim())) pushRow();
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h || "").trim());
  const body = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] != null ? String(r[idx]) : ""; });
    // Also keep a values array for positional mapping
    obj.__values = r;
    return obj;
  });
  return { headers, rows: body };
}

function normHead(s) {
  return String(s || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Suggested mapping: header name → field id, or "" if unknown. */
export function suggestMapping(headers) {
  const map = {};
  const used = new Set();
  for (const h of headers || []) {
    const n = normHead(h);
    let found = "";
    for (const f of CSV_FIELDS) {
      if (used.has(f.id)) continue;
      if (f.aliases.some(a => a === n) || f.id.toLowerCase() === n) { found = f.id; break; }
    }
    // loose contains
    if (!found) {
      for (const f of CSV_FIELDS) {
        if (used.has(f.id)) continue;
        if (f.aliases.some(a => n.includes(a) || a.includes(n))) { found = f.id; break; }
      }
    }
    map[h] = found;
    if (found) used.add(found);
  }
  return map;
}

function parseSites(text) {
  const parts = String(text || "").split(/[;|,/]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const aliases = { fb: "facebook", "facebook marketplace": "facebook", "ebay.com": "ebay", thredup: "thredup" };
  const ids = [];
  for (const p of parts) {
    const id = aliases[p] || (isKnownSite(p) ? p : SITE_IDS.find(s => s === p || p.includes(s)));
    if (id && isKnownSite(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function rowToItem(row, mapping, at = Date.now(), index = 0) {
  const get = fieldId => {
    for (const [header, id] of Object.entries(mapping || {})) {
      if (id === fieldId) return row[header] != null ? String(row[header]).trim() : "";
    }
    return "";
  };
  const sku = get("sku");
  const id = sku && /^it_/.test(sku) ? sku : newId(at + index);
  const listedIds = parseSites(get("listedOn"));
  const listedOn = {};
  for (const s of listedIds) listedOn[s] = { at };
  const soldOnRaw = get("soldOn");
  const soldOn = parseSites(soldOnRaw)[0] || (isKnownSite(soldOnRaw.toLowerCase()) ? soldOnRaw.toLowerCase() : null);
  const salePrice = money(get("salePrice"));
  const item = emptyItem({
    id,
    title: get("title") || "Imported item",
    description: get("description"),
    category: get("category"),
    brand: get("brand"),
    condition: get("condition"),
    size: get("size"),
    material: get("material"),
    measurements: get("measurements"),
    askingPrice: money(get("askingPrice")),
    costPaid: money(get("costPaid")),
    salePrice,
    fees: money(get("fees")),
    shippingPaid: money(get("shippingPaid")),
    supplies: money(get("supplies")),
    binLocation: get("binLocation"),
    notes: get("notes"),
    listedOn,
    soldOn: soldOn || null,
    soldAt: salePrice != null && soldOn ? at : (salePrice != null ? at : null)
  }, at);
  return pushHistory(item, { kind: "import", label: "Imported from a CSV file", at, snapshot: { title: "", description: "" } });
}

export function rowsToItems(rows, mapping, at = Date.now()) {
  return (rows || []).map((row, i) => rowToItem(row, mapping, at, i));
}

/**
 * Groups of likely-duplicate items (by fuzzy title, and same id if any).
 * Each group is { score, items: [item, item, ...] } with at least two items.
 */
export function findDuplicateGroups(items, { threshold = 0.72 } = {}) {
  const list = items || [];
  const used = new Set();
  const groups = [];
  for (let i = 0; i < list.length; i++) {
    if (used.has(list[i].id)) continue;
    const mates = [];
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(list[j].id)) continue;
      if (list[i].id === list[j].id) {
        mates.push(list[j]);
        used.add(list[j].id);
        continue;
      }
      const score = titleSimilarity(list[i].title, list[j].title);
      if (score >= threshold) {
        mates.push({ ...list[j], __score: score });
      }
    }
    if (mates.length) {
      used.add(list[i].id);
      for (const m of mates) used.add(m.id);
      const score = Math.max(...mates.map(m => m.__score || 1));
      groups.push({ score, items: [list[i], ...mates.map(m => { const { __score, ...rest } = m; return rest; })] });
    }
  }
  groups.sort((a, b) => b.score - a.score);
  return groups;
}

function prefer(a, b) {
  const sa = String(a ?? "").trim(), sb = String(b ?? "").trim();
  if (sa && !sb) return a;
  if (sb && !sa) return b;
  if (sb.length > sa.length) return b;
  return a;
}

/**
 * Merge b into a. Keeps a's id. Unions photos, listed sites, receipts,
 * and notes. Prefers the longer text and any sale already recorded.
 */
export function mergeItems(a, b, at = Date.now()) {
  if (!a) return b;
  if (!b) return a;
  let next = pushHistory(a, { kind: "edit", label: "Before merging a duplicate", at });
  const photos = [...(next.photos || [])];
  const seen = new Set(photos.map(p => p.dataUrl));
  for (const p of b.photos || []) {
    if (p && p.dataUrl && !seen.has(p.dataUrl)) { photos.push(p); seen.add(p.dataUrl); }
  }
  const listedOn = { ...(b.listedOn || {}), ...(next.listedOn || {}) };
  const delistedOn = { ...(b.delistedOn || {}), ...(next.delistedOn || {}) };
  const receipts = [...(next.receipts || [])];
  const rseen = new Set(receipts.map(r => r.id || r.dataUrl));
  for (const r of b.receipts || []) {
    const k = r.id || r.dataUrl;
    if (k && !rseen.has(k)) { receipts.push(r); rseen.add(k); }
  }
  const notes = [next.notes, b.notes].filter(Boolean).join("\n");
  next = normalizeItem({
    ...next,
    title: prefer(next.title, b.title),
    description: prefer(next.description, b.description),
    category: prefer(next.category, b.category),
    brand: prefer(next.brand, b.brand),
    condition: prefer(next.condition, b.condition),
    size: prefer(next.size, b.size),
    material: prefer(next.material, b.material),
    measurements: prefer(next.measurements, b.measurements),
    binLocation: prefer(next.binLocation, b.binLocation),
    askingPrice: next.askingPrice ?? b.askingPrice,
    costPaid: next.costPaid ?? b.costPaid,
    salePrice: next.salePrice ?? b.salePrice,
    fees: next.fees ?? b.fees,
    shippingPaid: next.shippingPaid ?? b.shippingPaid,
    soldOn: next.soldOn || b.soldOn,
    soldAt: next.soldAt || b.soldAt,
    shippedAt: next.shippedAt || b.shippedAt,
    photos,
    listedOn,
    delistedOn,
    receipts,
    notes,
    updatedAt: at
  }, at);
  return next;
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function itemsToCsv(items) {
  const cols = [
    "id", "title", "description", "category", "brand", "condition", "size", "material",
    "measurements", "askingPrice", "costPaid", "salePrice", "fees", "shippingPaid",
    "supplies", "discounts", "refunds", "moneyReceived", "binLocation", "listedOn",
    "soldOn", "stage", "notes"
  ];
  const lines = [cols.join(",")];
  for (const item of items || []) {
    const listed = listedSiteIds(item).join(";");
    const row = cols.map(c => {
      if (c === "listedOn") return csvEscape(listed);
      if (c === "stage") return csvEscape(item.stage || "");
      const v = item[c];
      return csvEscape(v == null ? "" : v);
    });
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

export { alreadyOwnedMatches, money };
