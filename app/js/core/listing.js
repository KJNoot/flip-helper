// The listing engine (v0.10): clothing facts saved once on the item, a Depop listing in her format,
// then Mercari, Vinted and eBay versions from the same facts. Automatic SKUs per category and a
// writing-style memory (her edits and "never say X" rules). No DOM here, so it unit-tests in Node.
// The AI runs on the Kris server ("garment", "depop", "xlist" modes); no AI key lives in the app.

// ---------- Depop's real tag lists ----------
// From Depop's public taxonomy (https://api.depop.com/api/v3/attributes/, read 2026-11-15), active values only.
// Max 3 of each on a listing. The AI's picks are checked against these; anything else is dropped.
export const DEPOP_TAXONOMY_AS_OF = "2026-11-15";
export const DEPOP_STYLES = [
  ["streetwear", "Streetwear"], ["sportswear", "Sportswear"], ["loungewear", "Loungewear"], ["goth", "Goth"], ["retro", "Retro"],
  ["boho", "Boho"], ["western", "Western"], ["indie", "Indie"], ["skater", "Skater"], ["rave", "Rave"], ["costume", "Costume"],
  ["cosplay", "Cosplay"], ["grunge", "Grunge"], ["emo", "Emo"], ["minimalist", "Minimalist"], ["preppy", "Preppy"],
  ["avant_garde", "Avant Garde"], ["punk", "Punk"], ["glam", "Glam"], ["regency", "Regency"], ["casual", "Casual"],
  ["techwear", "Utility"], ["futuristic", "Futuristic"], ["cottage", "Cottage"], ["fairy", "Fairy"], ["kidcore", "Kidcore"],
  ["y2_k", "Y2K"], ["biker", "Biker"], ["gorpcore", "Gorpcore"], ["twee", "Twee"], ["coquette", "Coquette"], ["whimsygoth", "Whimsygoth"]
].map(([id, name]) => ({ id, name }));
export const DEPOP_OCCASIONS = [
  ["daytime", "Casual"], ["festival", "Festival"], ["gifting", "Gifting"], ["going-out-evening", "Going out"], ["outdoors", "Outdoors"],
  ["celebration", "Party"], ["relaxation", "Relaxation"], ["school", "School"], ["ski", "Ski"], ["special-occasion", "Special Occasion"],
  ["summertime", "Summer"], ["holiday", "Vacation"], ["winter", "Winter"], ["work", "Work"], ["sport-workout", "Workout"]
].map(([id, name]) => ({ id, name }));
export const DEPOP_CONDITIONS = ["Brand new", "Like new", "Used - Excellent", "Used - Good", "Used - Fair"];
export const TAG_MAX = 3;

const simple = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** "Y2K", "y2_k", "y2k" -> the Depop entry, or null. Matches the id or the shown name only. */
// common words people (and the AI) use for a real Depop value
const TAG_ALIASES = { cottagecore: "cottage", bohemian: "boho", vintage: "retro", minimal: "minimalist", athleisure: "sportswear", athletic: "sportswear",
  utility: "techwear", workwear: "techwear", gothic: "goth", hippie: "boho", lounge: "loungewear", y2000s: "y2_k",
  everyday: "daytime", brunch: "daytime", dailywear: "daytime", datenight: "going-out-evening", nightout: "going-out-evening", goingout: "going-out-evening",
  office: "work", workwear2: "work", gym: "sport-workout", sport: "sport-workout", sports: "sport-workout", beach: "summertime", summer: "summertime",
  weddingguest: "special-occasion", formal: "special-occasion", holidayparty: "celebration", birthday: "celebration", travel: "holiday", cozy: "relaxation", hiking: "outdoors", backtoschool: "school" };
export function matchTag(list, raw) {
  const v = simple(raw && typeof raw === "object" ? raw.id || raw.name : raw);
  if (!v) return null;
  const hit = list.find(t => simple(t.id) === v || simple(t.name) === v);
  if (hit) return hit;
  const a = TAG_ALIASES[v];
  return a ? list.find(t => t.id === a) || null : null;
}
/** Keep only real Depop values, no repeats, at most 3. Returns ids. */
export function validTags(list, picks) {
  const out = [];
  for (const p of Array.isArray(picks) ? picks : String(picks || "").split(/[,;]/)) {
    const t = matchTag(list, p);
    if (t && !out.includes(t.id)) out.push(t.id);
    if (out.length >= TAG_MAX) break;
  }
  return out;
}
export const tagName = (list, id) => (list.find(t => t.id === id) || {}).name || id;

// sensible top-ups when the AI gave fewer than 3 real values (shown to her as "picked for you, check")
const STYLE_FALLBACK = ["casual", "minimalist", "retro", "streetwear", "preppy", "boho"];
const OCC_FALLBACK = ["daytime", "work", "going-out-evening", "summertime", "winter", "holiday"];
function topUp(ids, fallback, n = TAG_MAX) {
  const out = ids.slice(0, n);
  for (const f of fallback) { if (out.length >= n) break; if (!out.includes(f)) out.push(f); }
  return out;
}

// ---------- categories and SKUs ----------
export const CATEGORIES = [
  { id: "wtop", label: "Women’s top", prefix: "WTOP", group: "clothing" },
  { id: "wbtm", label: "Women’s bottoms", prefix: "WBTM", group: "clothing" },
  { id: "wdrs", label: "Women’s dress / jumpsuit", prefix: "WDRS", group: "clothing" },
  { id: "wout", label: "Women’s jacket / coat", prefix: "WOUT", group: "clothing" },
  { id: "wact", label: "Women’s activewear", prefix: "WACT", group: "clothing" },
  { id: "wsho", label: "Women’s shoes", prefix: "WSHO", group: "clothing" },
  { id: "wacc", label: "Women’s bag / accessory", prefix: "WACC", group: "clothing" },
  { id: "mtop", label: "Men’s top", prefix: "MTOP", group: "clothing" },
  { id: "mbtm", label: "Men’s bottoms", prefix: "MBTM", group: "clothing" },
  { id: "mout", label: "Men’s jacket / coat", prefix: "MOUT", group: "clothing" },
  { id: "msho", label: "Men’s shoes", prefix: "MSHO", group: "clothing" },
  { id: "macc", label: "Men’s accessory", prefix: "MACC", group: "clothing" },
  { id: "kids", label: "Kids’ clothing", prefix: "KIDS", group: "clothing" },
  { id: "home", label: "Home & decor", prefix: "HOME", group: "general" },
  { id: "toys", label: "Toys & games", prefix: "TOYS", group: "general" },
  { id: "elec", label: "Electronics", prefix: "ELEC", group: "general" },
  { id: "book", label: "Books & media", prefix: "BOOK", group: "general" },
  { id: "othr", label: "Other", prefix: "OTHR", group: "general" }
];
export const categoryLabel = id => (CATEGORIES.find(c => c.id === id) || {}).label || "";
export function categoriesFor(mode = "clothing") {
  return mode === "general" ? CATEGORIES : CATEGORIES.filter(c => c.group === "clothing" || c.id === "othr");
}
/** Default SKU settings: prefix, next number and digits per category. She can change all of it in Settings. */
export function defaultSkuConfig() {
  const cats = {};
  for (const c of CATEGORIES) cats[c.id] = { prefix: c.prefix, next: 1, digits: 3 };
  return { sep: "", cats };
}
export function normalizeSkuConfig(raw) {
  const base = defaultSkuConfig(), src = raw && typeof raw === "object" ? raw : {};
  const sep = typeof src.sep === "string" ? src.sep.replace(/[^-_./ ]/g, "").slice(0, 2) : "";
  const cats = {};
  for (const c of CATEGORIES) {
    const r = (src.cats && src.cats[c.id]) || {};
    const prefix = String(r.prefix == null ? base.cats[c.id].prefix : r.prefix).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || c.prefix;
    const next = Math.max(1, Math.min(9999999, Math.floor(Number(r.next) || 1)));
    const digits = Math.max(1, Math.min(7, Math.floor(Number(r.digits) || 3)));
    cats[c.id] = { prefix, next, digits };
  }
  return { sep, cats };
}
export function formatSku(cfg, catId, n) {
  const c = normalizeSkuConfig(cfg).cats[catId] || normalizeSkuConfig(cfg).cats.othr;
  return c.prefix + (cfg && cfg.sep ? cfg.sep : "") + String(n).padStart(c.digits, "0");
}
/** The next SKU for a category without using it up (skips any number already on an item). */
export function peekSku(cfg, catId, usedSkus = []) {
  const C = normalizeSkuConfig(cfg), cat = C.cats[catId] ? catId : "othr";
  const used = new Set((usedSkus || []).map(s => String(s || "").toUpperCase()));
  let n = C.cats[cat].next;
  while (used.has(formatSku(C, cat, n).toUpperCase()) && n < 9999999) n++;
  return { sku: formatSku(C, cat, n), n, cat };
}
/** Use the next SKU: returns { sku, cfg } with the counter moved past it. */
export function claimSku(cfg, catId, usedSkus = []) {
  const C = normalizeSkuConfig(cfg), p = peekSku(C, catId, usedSkus);
  C.cats[p.cat] = { ...C.cats[p.cat], next: p.n + 1 };
  return { sku: p.sku, cfg: C };
}

// ---------- her Depop format (defaults; editable in Settings) ----------
export const DEFAULT_LIST_PREFS = {
  mode: "clothing",          // "clothing" or "general" (optional setting)
  keywordsMin: 3, keywordsMax: 5,
  keywordSep: " | ",
  hashtags: 5,
  skuLastLine: true,
  measurements: true,
  alwaysSay: "",             // e.g. "Smoke-free home. Ships in 1-2 days."
  extraRules: ""             // free text she types
};
export function normalizeListPrefs(raw) {
  const p = { ...DEFAULT_LIST_PREFS, ...(raw && typeof raw === "object" ? raw : {}) };
  const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  p.mode = p.mode === "general" ? "general" : "clothing";
  p.keywordsMin = int(p.keywordsMin, 1, 8, 3);
  p.keywordsMax = Math.max(p.keywordsMin, int(p.keywordsMax, 1, 8, 5));
  p.keywordSep = typeof p.keywordSep === "string" && p.keywordSep.length <= 5 ? p.keywordSep : " | ";
  p.hashtags = int(p.hashtags, 0, 10, 5);
  p.skuLastLine = p.skuLastLine !== false;
  p.measurements = p.measurements !== false;
  p.alwaysSay = String(p.alwaysSay || "").slice(0, 300);
  p.extraRules = String(p.extraRules || "").slice(0, 600);
  return p;
}

// ---------- the garment facts (saved once on the item) ----------
export const FACT_FIELDS = ["category", "brand", "size", "color", "material", "condition", "measurements", "flaws", "details", "era"];
export const FACT_LABELS = { category: "Category", brand: "Brand", size: "Size", color: "Color", material: "Material", condition: "Condition", measurements: "Measurements", flaws: "Flaws", details: "Other details", era: "Era / style" };
const s = v => (v == null || typeof v === "object" ? "" : String(v)).replace(/\s+\n/g, "\n").trim();
export function emptyFacts() { const f = {}; for (const k of FACT_FIELDS) f[k] = ""; f.noFlaws = false; return f; }
export function normalizeFacts(raw) {
  const f = emptyFacts(), src = raw && typeof raw === "object" ? raw : {};
  for (const k of FACT_FIELDS) f[k] = s(src[k]).slice(0, k === "details" || k === "measurements" || k === "flaws" ? 1200 : 120);
  if (!CATEGORIES.some(c => c.id === f.category)) f.category = guessCategory(f.category);
  f.condition = matchCondition(f.condition) || f.condition;
  f.noFlaws = !!src.noFlaws;
  // "none noted" from the AI is not a fact; leave the box empty so she confirms (the No-flaws box is hers to tick)
  if (/^(none|none noted|none seen|no flaws?( noted| seen)?|n\/?a|-)\.?$/i.test(f.flaws)) f.flaws = "";
  return f;
}
export function matchCondition(raw) {
  const v = simple(raw);
  if (!v) return "";
  if (/nwt|newwithtags|brandnew|^new$|withtags|deadstock/.test(v)) return "Brand new";
  if (/likenew|nwot|mint/.test(v)) return "Like new";
  if (/excellent|great/.test(v)) return "Used - Excellent";
  if (/fair|worn|flaw|damag|poor/.test(v)) return "Used - Fair";
  if (/good|gently|used/.test(v)) return "Used - Good";
  return "";
}
/** "women's blouse" -> "wtop"; "" when unclear. */
export function guessCategory(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return "";
  const byId = CATEGORIES.find(c => c.id === t || simple(c.label) === simple(t));
  if (byId) return byId.id;
  const men = /\b(men|mens|men's|man|male|guys?)\b/.test(t) && !/women/.test(t);
  const kid = /\b(kid|kids|girl|boy|toddler|baby|youth)\b/.test(t);
  if (kid) return "kids";
  const k = (re, w, m) => (re.test(t) ? (men ? m : w) : null);
  return k(/dress|jumpsuit|romper|playsuit/, "wdrs", "mtop") || k(/jacket|coat|blazer|parka|vest|windbreaker|puffer/, "wout", "mout")
    || k(/legging|sports bra|athletic|activewear|yoga|gym/, "wact", "mtop") || k(/shoe|boot|sneaker|heel|sandal|loafer/, "wsho", "msho")
    || k(/bag|purse|tote|wallet|belt|hat|scarf|jewel|accessor/, "wacc", "macc")
    || k(/jean|pant|trouser|skirt|short|bottom|jogger|sweatpant/, "wbtm", "mbtm")
    || k(/top|tee|t-shirt|shirt|blouse|tank|cami|sweater|cardigan|hoodie|sweatshirt|pullover|crop|bodysuit|polo/, "wtop", "mtop")
    || (/lamp|decor|vase|kitchen|mug|plate|frame/.test(t) ? "home" : /toy|game|lego|puzzle/.test(t) ? "toys" : /phone|camera|console|electronic/.test(t) ? "elec" : /book|dvd|vinyl|record|cd\b/.test(t) ? "book" : "");
}
/** Fill only the empty boxes (never overwrite what she typed). Returns { facts, filled: [field] }. */
export function mergeFacts(mine, fromAi) {
  const a = normalizeFacts(mine), b = normalizeFacts(fromAi), filled = [];
  for (const k of FACT_FIELDS) if (!a[k] && b[k]) { a[k] = b[k]; filled.push(k); }
  return { facts: a, filled };
}
export function factsText(f) {
  const F = normalizeFacts(f), lines = [];
  for (const k of FACT_FIELDS) {
    if (k === "category") { if (F.category) lines.push("Category: " + categoryLabel(F.category)); continue; }
    if (k === "flaws") { lines.push("Flaws: " + (F.flaws || (F.noFlaws ? "none (she checked)" : "not given yet (don't say it has no flaws)"))); continue; }
    if (F[k]) lines.push(FACT_LABELS[k] + ": " + F[k]);
  }
  return lines.join("\n");
}
/** What's still missing before a good listing (she can still go on). */
export function missingFacts(f, mode = "clothing") {
  const F = normalizeFacts(f), out = [];
  if (!F.category) out.push("category");
  if (!F.brand) out.push("brand");
  if (mode !== "general" && !F.size) out.push("size");
  if (!F.condition) out.push("condition");
  if (mode !== "general" && !F.measurements) out.push("measurements");
  if (!F.flaws && !F.noFlaws) out.push("flaws");
  return out;
}

// ---------- writing-style memory ----------
// rules: [{ t: "Never say “gorgeous”", ts, from: "told"|"edit" }], edits: [{ from, to, ts }] (short snippets), avoid: { word: count }
export function emptyStyle() { return { rules: [], edits: [], avoid: {} }; }
export function normalizeStyle(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    rules: (Array.isArray(src.rules) ? src.rules : []).filter(r => r && typeof r.t === "string" && r.t.trim()).slice(-40).map(r => ({ t: r.t.trim().slice(0, 200), ts: Number(r.ts) || 0, from: r.from === "edit" ? "edit" : "told" })),
    edits: (Array.isArray(src.edits) ? src.edits : []).filter(e => e && (e.from || e.to)).slice(-12).map(e => ({ from: String(e.from || "").slice(0, 200), to: String(e.to || "").slice(0, 200), ts: Number(e.ts) || 0 })),
    avoid: src.avoid && typeof src.avoid === "object" ? Object.fromEntries(Object.entries(src.avoid).filter(([k, v]) => k && Number(v) > 0).slice(-80)) : {}
  };
}
/** "never say gorgeous" / "don't use the word cute" -> a rule. */
export function addRule(style, text, from = "told", at = Date.now()) {
  const st = normalizeStyle(style), t = String(text || "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (!t) return st;
  if (st.rules.some(r => simple(r.t) === simple(t))) return st;
  st.rules.push({ t, ts: at, from });
  return st;
}
export function removeRule(style, i) { const st = normalizeStyle(style); st.rules.splice(i, 1); return st; }
const STOP = new Set("a an the and or but of to in on for with is it its this that very so as at by from be are was were your you my our has have had not no just really also than then".split(" "));
const words = t => String(t || "").match(/[#\w’'.\-"]+|\n/g) || [];
/** Word-level diff (LCS). Returns [{ del: "...", ins: "..." }] runs. */
export function diffRuns(a, b) {
  const A = words(a).slice(0, 400), B = words(b).slice(0, 400), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].toLowerCase() === B[j].toLowerCase() ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const runs = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur && (cur.del.length || cur.ins.length)) runs.push({ del: cur.del.join(" "), ins: cur.ins.join(" ") }); cur = null; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].toLowerCase() === B[j].toLowerCase()) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { (cur || (cur = { del: [], ins: [] })).ins.push(B[j]); j++; }
    else { (cur || (cur = { del: [], ins: [] })).del.push(A[i]); i++; }
  }
  flush();
  return runs.map(r => ({ del: r.del.replace(/ ?\n ?/g, " ").trim(), ins: r.ins.replace(/ ?\n ?/g, " ").trim() })).filter(r => r.del || r.ins);
}
/**
 * Learn from her edit of an AI draft. Keeps short before/after examples, counts words she deletes,
 * and after she deletes the same word twice it becomes a rule ("Avoid the word …").
 * Facts (brand, size, numbers) and hashtags/SKU are not "style", so they are skipped.
 */
export function learnFromEdit(style, aiText, herText, { at = Date.now(), facts = null } = {}) {
  let st = normalizeStyle(style);
  if (!aiText || !herText || aiText.trim() === herText.trim()) return { style: st, learned: [] };
  const factWords = new Set(words(facts ? factsText(facts) : "").map(w => w.toLowerCase()));
  const runs = diffRuns(aiText, herText).filter(r => !/^#|^[A-Z]{2,8}[-_.]?\d+$/.test(r.del + r.ins) && (r.del + r.ins).length <= 400);
  const learned = [];
  for (const r of runs.slice(0, 6)) {
    if (r.del.length + r.ins.length < 3) continue;
    st.edits.push({ from: r.del.slice(0, 200), to: r.ins.slice(0, 200), ts: at });
    for (const w of words(r.del)) {
      const k = w.toLowerCase().replace(/^["'’]+|["'’.,!]+$/g, "");
      if (k.length < 4 || STOP.has(k) || /\d/.test(k) || factWords.has(k) || words(r.ins).some(x => x.toLowerCase().includes(k))) continue;
      st.avoid[k] = (st.avoid[k] || 0) + 1;
      if (st.avoid[k] === 2) { const before = st.rules.length; st = addRule(st, `Avoid the word “${k}”`, "edit", at); if (st.rules.length > before) learned.push(st.rules[st.rules.length - 1].t); }
    }
  }
  st.edits = st.edits.slice(-12);
  return { style: st, learned };
}
/** Kris memory facts that are about how listings are worded. */
export function styleFactsFrom(facts = []) {
  return (facts || []).map(f => (typeof f === "string" ? f : f && f.t) || "").filter(t => /^listing style:/i.test(t) || /\b(never|always|don'?t|do not|avoid|stop)\b.*\b(say|use|write|word|mention|put|call|emoji|hashtag|description|listing|title)/i.test(t)).slice(-20);
}
export function styleText(style, krisFacts = []) {
  const st = normalizeStyle(style), out = [];
  const rules = st.rules.map(r => r.t).concat(styleFactsFrom(krisFacts).map(t => t.replace(/^listing style:\s*/i, "")));
  if (rules.length) out.push("HER RULES (always follow):\n" + rules.map(r => "- " + r).join("\n"));
  const ex = st.edits.slice(-6).filter(e => e.from || e.to);
  if (ex.length) out.push("HER PAST CORRECTIONS (write like the 'to' side):\n" + ex.map(e => `- "${e.from || "(nothing)"}" -> "${e.to || "(removed)"}"`).join("\n"));
  return out.join("\n\n");
}

// ---------- Depop ----------
export const DEPOP_MAX = 1000;
export function depopRequest(facts, { prefs, style = "", price = null, mode = "clothing" } = {}) {
  const P = normalizeListPrefs(prefs);
  const styles = DEPOP_STYLES.map(t => t.name).join(", "), occ = DEPOP_OCCASIONS.map(t => t.name).join(", ");
  return [
    "Write a Depop listing. Reply with JSON exactly like:",
    `{"keywords":["${P.keywordsMin}-${P.keywordsMax} short searchable phrases"],"body":"the description","hashtags":["${P.hashtags} hashtags"],"styles":["3 from STYLE LIST"],"occasions":["3 from OCCASION LIST"],"check":["anything she should double-check"]}`,
    "FORMAT RULES:",
    `- Depop has NO title. "keywords": ${P.keywordsMin} to ${P.keywordsMax} strong phrases buyers type in search (brand, item type, style, color, era). They become the first line.`,
    "- \"body\": flows naturally like a friendly person wrote it: what it is, the details, fit, condition and flaws said honestly" + (P.measurements && mode !== "general" ? ", then the measurements exactly as given (one per line is fine)" : "") + ". No hashtags, no SKU, no title line, no price in the body.",
    `- "hashtags": exactly ${P.hashtags}, relevant, lowercase, no spaces, no repeats.`,
    `- "styles": exactly 3, ONLY from STYLE LIST: ${styles}.`,
    `- "occasions": exactly 3, ONLY from OCCASION LIST: ${occ}.`,
    `- Keep keywords + body under ${DEPOP_MAX - 120} characters together.`,
    P.alwaysSay ? `- End the body with this, in her words: ${P.alwaysSay}` : "",
    P.extraRules ? `- Her extra rules: ${P.extraRules}` : "",
    "",
    "GARMENT FACTS (use only these; don't add facts):",
    factsText(facts) || "(none given)",
    price != null ? `Her price: $${price} (don't put it in the text)` : "",
    style ? "\nWRITING STYLE:\n" + style : ""
  ].filter(x => x !== "").join("\n");
}
const cleanTag = t => "#" + String(t || "").toLowerCase().replace(/^#+/, "").replace(/[^a-z0-9]/g, "");
/** Hashtags from the AI plus sensible extras from the facts, exactly n, no repeats. */
export function exactHashtags(list, facts, n = 5, styleIds = []) {
  const out = [];
  const add = t => { const c = cleanTag(t); if (c.length > 2 && c.length <= 31 && !out.includes(c)) out.push(c); };
  for (const t of Array.isArray(list) ? list : String(list || "").split(/[\s,]+/)) { if (out.length >= n) break; add(t); }
  const F = normalizeFacts(facts);
  const extras = [F.brand, ...styleIds.map(id => tagName(DEPOP_STYLES, id)), F.era, F.color, categoryLabel(F.category).replace(/^(Women|Men|Kids)’s /, ""), "depop", "thrifted", "preloved", "secondhand", "resale"];
  for (const e of extras) { if (out.length >= n) break; if (e) add(e.split(/[ /]/)[0] === e ? e : e.replace(/\s+/g, "")); }
  return out.slice(0, n);
}
function stripBody(body, sku) {
  let b = String(body || "").replace(/\r/g, "");
  b = b.split("\n").filter(line => !/^\s*(sku\b|title\s*:)/i.test(line) && !(sku && line.trim().toUpperCase() === String(sku).toUpperCase())).join("\n");
  b = b.replace(/(^|\s)#[\w-]+/g, "$1").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return b;
}
/** The AI's answer -> a checked Depop draft. Never trusts the AI's counts: it fixes them. */
export function normalizeDepop(raw, { facts, sku = "", prefs } = {}) {
  const P = normalizeListPrefs(prefs), r = raw && typeof raw === "object" ? raw : {};
  let keywords = (Array.isArray(r.keywords) ? r.keywords : String(r.keywords || "").split(/[|,•·]/)).map(k => s(k).replace(/^#/, "")).filter(k => k && !/\bsku\b/i.test(k) && simple(k) !== simple(sku));
  keywords = keywords.filter((k, i) => keywords.findIndex(x => simple(x) === simple(k)) === i).slice(0, P.keywordsMax);
  const F = normalizeFacts(facts);
  for (const extra of [F.brand && F.brand + " " + (categoryLabel(F.category).replace(/^(Women|Men|Kids)’s /, "") || ""), F.era, F.color]) {
    if (keywords.length >= P.keywordsMin) break; if (extra && extra.trim()) keywords.push(extra.trim());
  }
  const aiStyles = validTags(DEPOP_STYLES, r.styles), aiOcc = validTags(DEPOP_OCCASIONS, r.occasions);
  const styles = topUp(aiStyles, STYLE_FALLBACK), occasions = topUp(aiOcc, OCC_FALLBACK);
  const out = {
    keywords, body: stripBody(r.body || r.description, sku),
    hashtags: exactHashtags(r.hashtags, F, P.hashtags, styles),
    styles, occasions,
    filledStyles: styles.filter(x => !aiStyles.includes(x)), filledOccasions: occasions.filter(x => !aiOcc.includes(x)),
    droppedTags: [].concat(r.styles || [], r.occasions || []).filter(t => !matchTag(DEPOP_STYLES, t) && !matchTag(DEPOP_OCCASIONS, t)).map(String),
    check: (Array.isArray(r.check) ? r.check : []).map(String).filter(Boolean).slice(0, 6),
    sku: String(sku || "")
  };
  out.text = composeDepop(out, P);
  return out;
}
/** keywords line, blank, body, blank, hashtags, then the SKU alone on the very last line. */
export function composeDepop(d, prefs) {
  const P = normalizeListPrefs(prefs);
  let body = d.body || "";
  const tail = [d.hashtags && d.hashtags.length ? d.hashtags.join(" ") : "", P.skuLastLine && d.sku ? d.sku : ""].filter(Boolean);
  const head = (d.keywords || []).join(P.keywordSep);
  const build = b => [head, b, ...tail].filter(Boolean).join("\n\n").replace(/\n\n(\S+)$/, (m, last) => (P.skuLastLine && d.sku && last === d.sku ? "\n" + last : m));
  let text = build(body);
  // Depop stops at 1,000 characters: trim the body at a sentence, never the tags or the SKU.
  while (text.length > DEPOP_MAX && body.length > 40) {
    const cut = body.slice(0, body.length - (text.length - DEPOP_MAX) - 1);
    const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    body = (at > 40 ? cut.slice(0, at + 1) : cut).trim();
    text = build(body);
  }
  return text;
}
/** Checks on the final text she will paste (works on her edited text too). */
export function checkDepop(text, { sku = "", prefs, styles = [], occasions = [] } = {}) {
  const P = normalizeListPrefs(prefs), t = String(text || "").replace(/\r/g, "").trim();
  const lines = t.split("\n"), last = (lines[lines.length - 1] || "").trim(), first = (lines[0] || "").trim();
  const tags = t.match(/(^|\s)#[A-Za-z0-9_]+/g) || [];
  const checks = [
    { id: "notitle", ok: !/^title\s*:/i.test(first) && first.length > 0 && first.length <= 160, label: "No title line; it starts with keywords" },
    { id: "hashtags", ok: tags.length === P.hashtags, label: `Exactly ${P.hashtags} hashtags (has ${tags.length})` },
    { id: "sku", ok: !P.skuLastLine || (!!sku && last === sku), label: "Your SKU is alone on the last line" },
    { id: "skuword", ok: !/\bsku\b/i.test(t), label: "The word “SKU” isn’t in the text" },
    { id: "styles", ok: validTags(DEPOP_STYLES, styles).length === TAG_MAX, label: "3 style tags from Depop’s list" },
    { id: "occasions", ok: validTags(DEPOP_OCCASIONS, occasions).length === TAG_MAX, label: "3 occasion tags from Depop’s list" },
    { id: "length", ok: t.length <= DEPOP_MAX, label: `Under ${DEPOP_MAX} characters (${t.length})` }
  ];
  return { ok: checks.every(c => c.ok), checks };
}
/** Fix her edited text: move hashtags to one line, put the SKU alone at the end, exact hashtag count. */
export function fixDepopText(text, { sku = "", prefs, facts, styles = [] } = {}) {
  const P = normalizeListPrefs(prefs);
  const t = String(text || "").replace(/\r/g, "");
  const tags = (t.match(/(^|\s)#[A-Za-z0-9_]+/g) || []).map(x => x.trim());
  let lines = stripBody(t, sku).split("\n");
  lines = lines.filter(l => !/^title\s*:/i.test(l));
  const first = (lines.shift() || "").trim();
  const body = lines.join("\n").trim();
  return composeDepop({ keywords: first ? [first] : [], body, hashtags: exactHashtags(tags, facts, P.hashtags, styles), sku }, { ...P, keywordSep: " " });
}

// ---------- Mercari, Vinted, eBay ----------
export const XSITES = [
  { id: "mercari", name: "Mercari", titleMax: 80, descMax: 1000, note: "Title up to 80 characters, description up to 1,000. No hashtags." },
  { id: "vinted", name: "Vinted", titleMax: 100, descMax: 2000, note: "Title up to 100 characters (brand, color, item type), description up to 2,000." },
  { id: "ebay", name: "eBay", titleMax: 80, descMax: 4000, note: "Title up to 80 characters, packed with search words. No hashtags. SKU goes in Custom label." }
];
export function xlistRequest(facts, depopText, { style = "", mode = "clothing" } = {}) {
  return [
    "Turn her approved Depop listing into Mercari, Vinted and eBay listings. Reply with JSON exactly like:",
    '{"mercari":{"title":"","description":""},"vinted":{"title":"","description":""},"ebay":{"title":"","description":"","specifics":{"Brand":"","Size":"","Color":"","Material":"","Condition":""}}}',
    "RULES:",
    "- The garment facts must match the Depop listing exactly (same brand, size, measurements, flaws). Don't add facts.",
    "- Mercari: title up to 80 characters (brand, item type, style, size, color); description up to 900 characters, plain, no hashtags.",
    "- Vinted: title up to 100 characters, simple: brand + color + item type (+ size); no words like 'nice' or 'pretty'; description up to 1,800 characters, friendly, no hashtags.",
    "- eBay: title up to 80 characters, use most of it with words buyers search (brand, item type, women's/men's, size, color, material, style, era); no punctuation spam, no ALL CAPS words except brand names; description clear with a Condition line, Flaws line and Measurements" + (mode === "general" ? " (if given)" : "") + "; no hashtags.",
    "- Don't put the SKU or the price in any text; the app adds the SKU.",
    "",
    "GARMENT FACTS:", factsText(facts) || "(none)",
    "", "HER APPROVED DEPOP LISTING:", String(depopText || "").slice(0, 1200),
    style ? "\nWRITING STYLE:\n" + style : ""
  ].join("\n");
}
/** Cut at a word so the title fits the site's limit. */
export function fitTitle(t, max) {
  let x = s(t).replace(/\s+/g, " ").replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
  if (x.length <= max) return x;
  x = x.slice(0, max + 1);
  const at = x.lastIndexOf(" ");
  return (at > max * 0.6 ? x.slice(0, at) : x.slice(0, max)).replace(/[\s,;:|/-]+$/, "");
}
function fitDesc(d, max, sku) {
  let x = stripBody(d, sku);
  if (x.length > max) { x = x.slice(0, max); const at = Math.max(x.lastIndexOf(". "), x.lastIndexOf("\n")); if (at > max * 0.6) x = x.slice(0, at + 1); }
  return x.trim();
}
/** The AI's answer -> three checked listings with the SKU on the last line of each description. */
export function normalizeXlist(raw, { facts, sku = "", price = null, depop = null } = {}) {
  const r = raw && typeof raw === "object" ? raw : {}, F = normalizeFacts(facts), out = {};
  for (const site of XSITES) {
    const x = r[site.id] && typeof r[site.id] === "object" ? r[site.id] : {};
    let title = fitTitle(x.title, site.titleMax);
    if (!title) title = fitTitle([F.brand, F.color, categoryLabel(F.category).replace(/^(Women|Men|Kids)’s /, ""), F.size && "Size " + F.size].filter(Boolean).join(" "), site.titleMax);
    const room = site.descMax - (sku ? sku.length + 2 : 0);
    let description = fitDesc(x.description, room, sku);
    if (!description && depop) description = fitDesc(depop, room, sku);
    if (sku) description = description + "\n\n" + sku;
    const specifics = site.id === "ebay" ? Object.fromEntries(Object.entries({ Brand: F.brand, Size: F.size, Color: F.color, Material: F.material, Condition: F.condition, ...(x.specifics && typeof x.specifics === "object" ? x.specifics : {}) }).map(([k, v]) => [k, s(v)]).filter(([k, v]) => v)) : null;
    // the facts win over the AI for item specifics
    if (specifics) { if (F.brand) specifics.Brand = F.brand; if (F.size) specifics.Size = F.size; if (F.condition) specifics.Condition = F.condition; }
    out[site.id] = { title, description, price: price != null ? String(price) : "", ...(specifics ? { specifics } : {}), ai: { title, description } };
  }
  return out;
}
/** Facts that must show up the same everywhere (brand and size in titles when known). */
export function checkXlist(x, facts) {
  const F = normalizeFacts(facts), problems = [];
  for (const site of XSITES) {
    const l = x && x[site.id]; if (!l) { problems.push(site.name + ": missing"); continue; }
    if (l.title.length > site.titleMax) problems.push(`${site.name}: title is ${l.title.length}/${site.titleMax}`);
    if (l.description.length > site.descMax) problems.push(`${site.name}: description too long`);
    if (F.brand && !simple(l.title).includes(simple(F.brand))) problems.push(`${site.name}: title doesn’t say ${F.brand}`);
    if (/(^|\s)#\w/.test(l.description) && site.id !== "vinted") problems.push(`${site.name}: has hashtags`);
  }
  return problems;
}

// ---------- the AI call (Kris server, JSON modes) ----------
/** POST to the Kris server. Returns { ok, data, tokens, used } or { ok:false, error }. */
export async function listingAsk({ url, code, mode, text, images = [], context = "", version = "", fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (!url || !code) return { ok: false, error: "off" };
  const imgs = (images || []).filter(Boolean).slice(0, 4);
  const body = { code, mode, text, image: imgs[0] || null, images: imgs.slice(1), context, memory: { facts: [], summary: "" }, history: [], app: { id: "flip-side", version, view: "New listing" } };
  let res, j;
  try { res = await f(String(url).replace(/\/$/, "") + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); j = await res.json().catch(() => ({})); }
  catch (e) { return { ok: false, error: "network" }; }
  if (!res.ok) return { ok: false, error: j.error || "upstream", status: res.status };
  let data = j.data && typeof j.data === "object" ? j.data : null;
  if (!data) { try { const m = String(j.reply || "").match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : null; } catch (e) { data = null; } }
  if (!data) return { ok: false, error: "format" };
  return { ok: true, data, tokens: j.tokens || null, used: j.used || null };
}
export function garmentRequest(facts, spoken = "", mode = "clothing") {
  return [
    "Read the photos" + (spoken ? " and what she said" : "") + " and fill in the " + (mode === "general" ? "item" : "garment") + " facts. Reply with JSON exactly like:",
    '{"category":"","brand":"","size":"","color":"","material":"","condition":"","measurements":"","flaws":"","details":"","era":"","check":[""]}',
    "- category: one of " + categoriesFor(mode).map(c => c.id + " (" + c.label + ")").join(", ") + ".",
    "- brand/size/material: only if you can read them on a tag or she said them; else \"\".",
    "- condition: one of " + DEPOP_CONDITIONS.join(", ") + ".",
    "- measurements: only numbers she said or that are written in the photos (never estimate).",
    "- flaws: EVERY flaw she said (keep her words, e.g. fading, snag, stain, pilling) plus any you clearly see; \"\" if none (never write \"none\").",
    "- details: style, fit, neckline, sleeves, pattern, closures, features, in a few words.",
    "- check: things she should double-check.",
    spoken ? "\nWHAT SHE SAID / TYPED:\n" + String(spoken).slice(0, 2500) : "",
    "\nALREADY FILLED (keep these):\n" + (factsText(facts) || "(nothing yet)")
  ].join("\n");
}
