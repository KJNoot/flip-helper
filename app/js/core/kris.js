// Kris for Flip Side: the app-specific half of "Ask Kris" with no DOM, so it unit-tests in Node.
// The reusable half (memory, the request, the ```kris``` action block, reminders, .ics, drafts) is
// kris-core.js, copied unchanged from Shift Report. The AI runs on the Kris server; no AI key lives here.
// Kris only helps with reselling and paperwork. She never sends, posts or saves anything on her own:
// every listing, record change and expense is shown first and saved only when Jessika taps.
import "./kris-core.js";
import { emptyItem, normalizeItem, money, formatUsd, setListed, markSold, markShipped, STAGE_LABELS } from "./inventory.js";
import { SITES, siteName, isKnownSite } from "./sites.js";
import { titleSimilarity, normalizeTitle } from "./match.js";

export const KrisCore = globalThis.KrisCore;
export const KRIS_URL = "https://kris-chat.kens-remi.workers.dev"; // the server address (not a secret)
export const KRIS_APP_ID = "flip-side";
export const KRIS_TITLE = "Kris · Your reselling helper";
export const CHANGE_TO = "kens.remi@mail.grokbot.com"; // KJ's helper; she presses Send herself
export const CODE_KEY = "flip-helper.kris.code"; // this device only; never synced, never in a backup
export const LOG_KEY = "flip-helper.kris.log"; // the chat on this device (photos are not kept)
export const KV_PREFIX = "flip-helper.kris.kv.";
// What Kris remembers, recent chat topics, reminders and expenses. These ride along with
// "Sync with my computer" when it is on (the kv table). The code and the chat log do not.
export const SYNC_NAMES = ["krisFacts", "krisTopics", "krisReminders", "krisExpenses"];
// v0.9.1: her code also rides along in her own sync data, so a paired device turns Kris on by itself.
export const ACCESS_NAME = "krisAccess";
export const CODE_AT_KEY = "flip-helper.kris.codeAt";
// A code this device must not pick up again by itself (turned off here, or the server said it's no good).
export const NO_AUTO_KEY = "flip-helper.kris.noAuto";
export const NOTIFY_ASKED_KEY = "flip-helper.kris.notifyAsked";
// iPhone copies a site's cookies (not its storage) into a Home Screen app when she adds it (iOS 17.2+).
export const COOKIE_NAME = "flipkris";
export const CLOUD_PREFIX = "kris:";
export const LOG_MAX = 40;

function ls(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

// ---------- the access code (typed once, or from the private setup link) ----------
export function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
}
export function isPlausibleCode(raw) { return normalizeCode(raw).length >= 8; }
export function getCode(storage) {
  const s = ls(storage); if (!s) return "";
  try { return normalizeCode(s.getItem(CODE_KEY) || ""); } catch (e) { return ""; }
}
/** She (or her link) set the code on purpose: save it, and clear any "don't pick this up" marker. */
export function setCode(raw, storage, at = Date.now()) {
  const s = ls(storage), c = normalizeCode(raw);
  if (!s || !isPlausibleCode(c)) return "";
  try { s.setItem(CODE_KEY, c); s.setItem(CODE_AT_KEY, String(at)); s.removeItem(NO_AUTO_KEY); } catch (e) { return ""; }
  return c;
}
export function codeAt(storage) {
  const s = ls(storage); if (!s) return 0;
  try { return Number(s.getItem(CODE_AT_KEY)) || 0; } catch (e) { return 0; }
}
/** Remove the code from this device. It won't come back by itself (cookie or sync) unless she sets it again. */
export function clearCode(storage) {
  const s = ls(storage); if (!s) return;
  try { const c = s.getItem(CODE_KEY); if (c) s.setItem(NO_AUTO_KEY, normalizeCode(c)); s.removeItem(CODE_KEY); s.removeItem(CODE_AT_KEY); } catch (e) { }
}
/** A code found by itself (cookie, sync): take it only if this device has none and hasn't turned that code away. */
export function adoptCode(raw, storage, at = Date.now()) {
  const s = ls(storage), c = normalizeCode(raw);
  if (!s || !isPlausibleCode(c) || getCode(s)) return "";
  try { if (s.getItem(NO_AUTO_KEY) === c) return ""; s.setItem(CODE_KEY, c); s.setItem(CODE_AT_KEY, String(at)); } catch (e) { return ""; }
  return c;
}

// ---------- carrying the code into an installed app (cookie + manifest) ----------
export function codeFromCookie(cookieStr = "") {
  const m = new RegExp("(?:^|;\\s*)" + COOKIE_NAME + "=([A-Za-z0-9-]+)").exec(String(cookieStr || ""));
  const c = m ? normalizeCode(m[1]) : "";
  return isPlausibleCode(c) ? c : "";
}
export function codeCookie(code, path = "/", maxAgeDays = 400) {
  const c = normalizeCode(code);
  if (!isPlausibleCode(c)) return COOKIE_NAME + "=; Path=" + path + "; Max-Age=0; Secure; SameSite=Strict";
  return COOKIE_NAME + "=" + c + "; Path=" + path + "; Max-Age=" + Math.round(maxAgeDays * 86400) + "; Secure; SameSite=Strict";
}
/** The app's folder, e.g. "/flip-helper/" for "/flip-helper/index.html". */
export function appPath(pathname = "/") {
  const p = String(pathname || "/");
  return p.endsWith("/") ? p : p.slice(0, p.lastIndexOf("/") + 1) || "/";
}
/**
 * A copy of the app's manifest whose start_url carries her code (#kris=…, a hash so it is never sent to the
 * web server). Every address is absolute because a blob: manifest has no folder of its own; the id stays the
 * same so it is still the same app.
 */
export function krisManifest(base = {}, { pageUrl, manifestUrl, code } = {}) {
  const c = normalizeCode(code);
  const abs = u => new URL(u, manifestUrl || pageUrl).href;
  const out = { ...base };
  out.id = abs(base.id || base.start_url || "./");
  out.scope = abs(base.scope || "./");
  out.start_url = abs(base.start_url || "./") .split("#")[0] + (isPlausibleCode(c) ? "#kris=" + c : "");
  out.icons = (base.icons || []).map(i => ({ ...i, src: abs(i.src) }));
  return out;
}
export function isIOSDevice({ ua = "", platform = "", maxTouchPoints = 0 } = {}) {
  return /iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}
export function isStandaloneDisplay(win) {
  try { return !!((win.navigator && win.navigator.standalone) || (win.matchMedia && win.matchMedia("(display-mode: standalone)").matches)); } catch (e) { return false; }
}
/** Ask for notification permission once ever: the first time she sets a reminder. */
export function shouldAskNotify(storage) {
  const s = ls(storage); if (!s) return false;
  try { if (s.getItem(NOTIFY_ASKED_KEY)) return false; s.setItem(NOTIFY_ASKED_KEY, String(Date.now())); return true; } catch (e) { return false; }
}

/** The code from a private setup link: ...flip-helper/#kris=CODE (also #/home?kris=CODE or ?kris=CODE). */
export function codeFromUrl(hash = "", search = "") {
  const pick = str => {
    const m = /(?:^|[#?&\/])kris=([A-Za-z0-9-]+)/.exec(String(str || ""));
    return m ? normalizeCode(m[1]) : "";
  };
  const c = pick(hash) || pick(search);
  return isPlausibleCode(c) ? c : "";
}
/** Store the code from the link, then strip it from the address bar so it isn't left in history or a bookmark. */
// respectNoAuto: an installed app started from its icon (start_url carries #kris=…) must not undo
// "Turn off Kris on this device" or bring back a code the server turned down.
export function takeSetupLink(loc, hist, storage, { respectNoAuto = false } = {}) {
  try {
    const code = codeFromUrl(loc.hash, loc.search);
    if (!code) return false;
    if (respectNoAuto) adoptCode(code, storage); else setCode(code, storage);
    const search = String(loc.search || "").replace(/([?&])kris=[A-Za-z0-9-]*&?/, "$1").replace(/[?&]$/, "");
    const clean = String(loc.pathname || "") + search + "#/home";
    if (hist && hist.replaceState) hist.replaceState(null, "", clean);
    return true;
  } catch (e) { return false; }
}

// ---------- memory store for kris-core (localStorage, with a time stamp per key for sync) ----------
const listeners = new Set();
export function onKrisChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function createKrisStore(storage) {
  return {
    async get(name, def) {
      const s = ls(storage); if (!s) return def;
      try { const raw = s.getItem(KV_PREFIX + name); if (!raw) return def; const o = JSON.parse(raw); return o && "v" in o ? o.v : def; } catch (e) { return def; }
    },
    async set(name, value, updatedAt = Date.now()) {
      const s = ls(storage); if (!s) return;
      try { s.setItem(KV_PREFIX + name, JSON.stringify({ v: value, updatedAt })); } catch (e) { }
      for (const fn of listeners) { try { fn(name); } catch (e) { } }
    }
  };
}
/** For sync: { "kris:krisFacts": { key, payload: { v }, updatedAt } } — only the four memory lists. */
export function krisKvSnapshot(storage) {
  const s = ls(storage), out = {};
  if (!s) return out;
  for (const name of SYNC_NAMES) {
    try {
      const raw = s.getItem(KV_PREFIX + name); if (!raw) continue;
      const o = JSON.parse(raw); if (!o || !("v" in o)) continue;
      out[CLOUD_PREFIX + name] = { key: CLOUD_PREFIX + name, payload: { v: o.v }, updatedAt: Number(o.updatedAt) || 0 };
    } catch (e) { }
  }
  const code = getCode(s);
  if (code) out[CLOUD_PREFIX + ACCESS_NAME] = { key: CLOUD_PREFIX + ACCESS_NAME, payload: { v: [code] }, updatedAt: codeAt(s) || 1 };
  return out;
}
/** For sync: apply the other device's newer copy. Ignores anything that isn't one of the four lists. */
export function applyKrisKv(key, payload, updatedAt, storage) {
  const name = String(key || "").startsWith(CLOUD_PREFIX) ? String(key).slice(CLOUD_PREFIX.length) : "";
  if (name === ACCESS_NAME) {
    // Her code from another of her devices: take it if this one has none (and didn't turn it away),
    // or replace an older code with a newer one.
    const c = payload && Array.isArray(payload.v) ? normalizeCode(payload.v[0]) : "";
    const s = ls(storage);
    if (!s || !isPlausibleCode(c)) return false;
    const mine = getCode(s), t = Number(updatedAt) || Date.now();
    if (!mine) return adoptCode(c, s, t) ? "access" : false;
    if (mine !== c && t > codeAt(s)) { try { if (s.getItem(NO_AUTO_KEY) === c) return false; s.setItem(CODE_KEY, c); s.setItem(CODE_AT_KEY, String(t)); } catch (e) { return false; } return "access"; }
    return false;
  }
  if (!SYNC_NAMES.includes(name) || !payload || !Array.isArray(payload.v)) return false;
  const s = ls(storage); if (!s) return false;
  try { s.setItem(KV_PREFIX + name, JSON.stringify({ v: payload.v, updatedAt: Number(updatedAt) || Date.now() })); } catch (e) { return false; }
  return true; // no change event here, so applying the other device's copy doesn't start another sync
}

// ---------- chat log on this device ----------
export function loadLog(storage) {
  const s = ls(storage); if (!s) return [];
  try { const a = JSON.parse(s.getItem(LOG_KEY) || "[]"); return Array.isArray(a) ? a.slice(-LOG_MAX) : []; } catch (e) { return []; }
}
export function saveLog(log, storage) {
  const s = ls(storage); if (!s) return;
  const slim = (log || []).slice(-LOG_MAX).map(m => {
    const { img, photo, ...rest } = m || {};
    return { ...rest, text: rest.text || (img ? "(photo)" : ""), hadPhoto: !!(img || rest.hadPhoto) };
  });
  try { s.setItem(LOG_KEY, JSON.stringify(slim)); } catch (e) { }
}
export function clearLog(storage) { const s = ls(storage); if (s) try { s.removeItem(LOG_KEY); } catch (e) { } }

// ---------- what the app tells Kris each time (short, no phone numbers or codes) ----------
const usd = n => (n == null ? "" : formatUsd(n));
function itemLine(it) {
  const bits = [`"${(it.title || "Untitled item").slice(0, 70)}"`, STAGE_LABELS[it.stage] || it.stage];
  if (it.costPaid != null) bits.push("cost " + usd(it.costPaid));
  if (it.salePrice != null) bits.push("sold " + usd(it.salePrice) + (it.soldOn ? " on " + siteName(it.soldOn) : ""));
  else if (it.askingPrice != null) bits.push("asking " + usd(it.askingPrice));
  else if (it.priceLow != null || it.priceHigh != null) bits.push("est " + [usd(it.priceLow), usd(it.priceHigh)].filter(Boolean).join("–"));
  const listed = Object.keys(it.listedOn || {});
  if (listed.length && !it.soldAt) bits.push("listed on " + listed.map(siteName).join(", "));
  return bits.join(" · ") + ` [${it.id}]`;
}
export function krisContext({ items = [], screen = "", openItem = null, name = "", expenses = [], now = Date.now() } = {}) {
  const out = [];
  out.push("User: " + (name || "Jessika") + " (reseller)");
  if (screen) out.push("Screen open in the app: " + screen);
  const counts = {};
  for (const it of items) counts[it.stage] = (counts[it.stage] || 0) + 1;
  out.push(`Items: ${items.length}` + (items.length ? " (" + Object.entries(counts).map(([k, n]) => `${STAGE_LABELS[k] || k} ${n}`).join(", ") + ")" : ""));
  if (openItem) out.push("Open item: " + itemLine(openItem) + (openItem.description ? "\n  Description: " + openItem.description.slice(0, 240).replace(/\s+/g, " ") : ""));
  const recent = items.filter(it => !openItem || it.id !== openItem.id).slice(0, 25);
  if (recent.length) out.push("Recent items (newest first):\n" + recent.map(it => "- " + itemLine(it)).join("\n"));
  const y = new Date(now).getFullYear(), ex = (expenses || []).filter(e => String(e.date || "").startsWith(String(y)));
  if (ex.length) out.push(`Expenses logged with Kris in ${y}: ${ex.length}, total ${formatUsd(expensesTotal(ex))}`);
  let text = out.join("\n");
  if (text.length > 3000) text = text.slice(0, 2990) + "…";
  return text;
}

// ---------- sites ----------
const SITE_ALIASES = { fb: "facebook", "facebook marketplace": "facebook", marketplace: "facebook", fbmp: "facebook", posh: "poshmark", "e bay": "ebay", thredup: "thredup", "thred up": "thredup" };
export function siteIdFrom(text) {
  const t = String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (isKnownSite(t)) return t;
  if (SITE_ALIASES[t] && isKnownSite(SITE_ALIASES[t])) return SITE_ALIASES[t];
  for (const s of SITES) {
    const n = s.name.toLowerCase();
    if (t === n || t.includes(n) || (t.length >= 4 && n.includes(t))) return s.id;
  }
  for (const [k, v] of Object.entries(SITE_ALIASES)) if (t.includes(k) && isKnownSite(v)) return v;
  return null;
}

// ---------- dates ----------
const pad = n => String(n).padStart(2, "0");
export function ymdLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
/** "2026-11-14", "11/14/2026", "Nov 14" -> a local Date (noon), or null. */
export function parseDay(s, now = new Date()) {
  const t = String(s || "").trim(); if (!t) return null;
  let m = /^(\d{4})-(\d\d)-(\d\d)/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) { let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2], 12); }
  if (/^today$/i.test(t)) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (/^yesterday$/i.test(t)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const p = Date.parse(t + (/\d{4}/.test(t) ? "" : " " + now.getFullYear()));
  if (Number.isFinite(p)) { const d = new Date(p); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
  return null;
}

// ---------- fill: listing -> a new draft item ----------
const str = v => (v == null || typeof v === "object" ? "" : String(v)).trim();
export function listingRows(data = {}) {
  const d = data || {}, rows = [];
  const add = (label, v) => { v = str(v); if (v) rows.push([label, v]); };
  add("Title", d.title);
  const lo = money(d.priceLow), hi = money(d.priceHigh), price = money(d.price);
  if (price != null) rows.push(["Asking price", formatUsd(price)]);
  if (lo != null || hi != null) rows.push(["Price (estimate)", [lo, hi].filter(x => x != null).map(formatUsd).join(" – ")]);
  add("Category", d.category); add("Condition", d.condition); add("Brand (check it)", d.brand);
  add("Size", d.size); add("Color", d.color);
  const tags = Array.isArray(d.tags) ? d.tags.map(str).filter(Boolean) : str(d.tags) ? [str(d.tags)] : [];
  if (tags.length) rows.push(["Tags", tags.join(", ")]);
  const site = siteIdFrom(d.platform); if (site || str(d.platform)) rows.push(["Plan to list on", site ? siteName(site) : str(d.platform)]);
  add("Description", d.description); add("Notes", d.notes);
  return rows;
}
export function makeListingItem(data = {}, { photo = null, at = Date.now() } = {}) {
  const d = data || {};
  const tags = Array.isArray(d.tags) ? d.tags.map(str).filter(Boolean) : str(d.tags) ? [str(d.tags)] : [];
  const site = siteIdFrom(d.platform);
  const notes = [str(d.notes), str(d.color) && "Color: " + str(d.color), tags.length && "Tags: " + tags.join(", "),
    (site || str(d.platform)) && "Plan to list on: " + (site ? siteName(site) : str(d.platform)), "Drafted with Kris. Check the brand, condition and price before you post."].filter(Boolean).join("\n");
  return emptyItem({
    title: str(d.title).slice(0, 140), description: str(d.description), category: str(d.category), condition: str(d.condition),
    brand: str(d.brand), size: str(d.size), priceLow: money(d.priceLow), priceHigh: money(d.priceHigh), askingPrice: money(d.price),
    notes, photos: photo ? [{ dataUrl: photo, addedAt: at }] : []
  }, at);
}

// ---------- fill: record -> change an item she already has ----------
/** Which item she means: { item } when clear, or { candidates } to pick from. */
export function findItem(items = [], query = "") {
  const q = str(query);
  if (!q) return { item: null, candidates: [] };
  const byId = items.find(i => i.id === q || (q.includes(i.id) && i.id.length > 4));
  if (byId) return { item: byId, candidates: [] };
  const nq = normalizeTitle(q);
  const scored = items.filter(i => normalizeTitle(i.title)).map(i => {
    const nt = normalizeTitle(i.title);
    let s = titleSimilarity(q, i.title);
    if (nt === nq) s = 1; else if (nt.includes(nq) || nq.includes(nt)) s = Math.max(s, 0.7);
    return { item: i, score: s };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Safer to ask "which one?" than to change the wrong item.
  if (best && best.score >= 0.55 && (!scored[1] || scored[1].score < best.score - 0.2)) return { item: best.item, candidates: [] };
  return { item: null, candidates: scored.filter(x => x.score >= 0.3).slice(0, 3).map(x => x.item) };
}

const VIEW = [
  ["Stage", it => STAGE_LABELS[it.stage] || it.stage],
  ["Cost", it => usd(it.costPaid)],
  ["Asking price", it => usd(it.askingPrice)],
  ["Sold price", it => usd(it.salePrice)],
  ["Sold on", it => (it.soldOn ? siteName(it.soldOn) : "")],
  ["Sold date", it => (it.soldAt ? ymdLocal(new Date(it.soldAt)) : "")],
  ["Fees", it => usd(it.fees)],
  ["Shipping you paid", it => usd(it.shippingPaid)],
  ["Listed on", it => Object.keys(it.listedOn || {}).map(siteName).join(", ")],
  ["Returned", it => (it.returns && it.returns.returned ? "Yes" + (it.returns.refundAmount != null ? ", refund " + usd(it.returns.refundAmount) : "") : "")],
  ["Notes", it => it.notes || ""]
];
/**
 * What a record fill would change. Returns { next, changes: [{ label, from, to }], skipped: [text] }.
 * Nothing is saved here; the panel shows `changes` and saves `next` only when she taps.
 */
export function recordPlan(item, data = {}, { now = Date.now() } = {}) {
  const d = data || {}, skipped = [];
  let next = normalizeItem({ ...item });
  const at = now;
  const status = str(d.status).toLowerCase();
  const site = siteIdFrom(d.platform);
  const day = parseDay(d.date, new Date(now));
  const soldAt = day ? day.getTime() : at;
  const sale = money(d.soldPrice) ?? (status === "sold" ? money(d.price) : null);
  const fees = money(d.fees), ship = money(d.shipping), cost = money(d.cost);
  const ask = status === "sold" ? null : money(d.price);
  if (cost != null) next.costPaid = cost;
  if (ask != null) next.askingPrice = ask;
  if (/^(sold|shipped)/.test(status) && !next.soldAt) {
    next = markSold(next, { siteId: site || undefined, salePrice: sale ?? undefined, fees: fees ?? undefined, shippingPaid: ship ?? undefined, at: soldAt });
  } else {
    if (sale != null) next.salePrice = sale;
    if (fees != null) next.fees = fees;
    if (ship != null) next.shippingPaid = ship;
    if (site && next.soldAt && /^sold/.test(status) && !next.soldOn) next.soldOn = site;
  }
  if (/^shipped/.test(status)) next = markShipped(next, true, day ? day.getTime() : at);
  if (/^(listed|live|posted)/.test(status)) {
    if (site) next = setListed(next, site, true, at);
    else skipped.push("Which site it’s listed on (tell Kris the site)");
  }
  if (/^return/.test(status)) next.returns = { ...(next.returns || {}), returned: true, returnedAt: (next.returns && next.returns.returnedAt) || (day ? day.getTime() : at), refundAmount: money(d.refund) ?? (next.returns && next.returns.refundAmount) ?? null };
  if (status && !/^(sold|shipped|listed|live|posted|return|draft)/.test(status)) skipped.push("Status “" + str(d.status) + "” (change it on the item page)");
  const extra = [str(d.buyer) && "Buyer: " + str(d.buyer), str(d.notes)].filter(Boolean).join("\n");
  if (extra && !(next.notes || "").includes(extra)) next.notes = (next.notes ? next.notes + "\n" : "") + extra;
  next = normalizeItem({ ...next, updatedAt: at }, at);
  const before = normalizeItem(item);
  const changes = [];
  for (const [label, get] of VIEW) {
    const a = get(before), b = get(next);
    if (a !== b) changes.push({ label, from: a || "(blank)", to: b || "(blank)" });
  }
  return { next, changes, skipped, becameSold: !before.soldAt && !!next.soldAt };
}

// ---------- fill: expense ----------
export function normalizeExpense(raw = {}, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const amount = money(raw.amount);
  const what = str(raw.what).slice(0, 140);
  if (amount == null && !what) return null;
  const day = parseDay(raw.date, new Date(now));
  return {
    id: String(raw.id || ("ex_" + now.toString(36) + Math.random().toString(36).slice(2, 6))),
    date: day ? ymdLocal(day) : ymdLocal(new Date(now)),
    what: what || "Expense",
    amount,
    where: str(raw.where).slice(0, 100),
    notes: str(raw.notes).slice(0, 300),
    at: Number(raw.at) || now
  };
}
export function expenseRows(e) {
  if (!e) return [];
  return [["What", e.what], ["Amount", e.amount != null ? formatUsd(e.amount) : "(not given)"], ["Date", e.date], ["Where", e.where], ["Notes", e.notes]].filter(r => r[1]);
}
export function expensesTotal(list = []) {
  return (list || []).reduce((s, e) => money(s + (money(e && e.amount) ?? 0)), 0);
}
export function expensesInYear(list = [], year) {
  return (list || []).filter(e => e && String(e.date || "").startsWith(String(year))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---------- drafts she sends herself ----------
export function smsHref(to, body) {
  const num = String(to || "").replace(/[^\d+]/g, "");
  if (num.replace(/\D/g, "").length < 7) return "";
  return "sms:" + num + "?&body=" + encodeURIComponent(body || "");
}
export function changeMailto({ text = "", version = "" } = {}) {
  const body = ["APP REQUEST (from Ask Kris in Flip Side)", "", String(text || "").trim(), "", "---", "App version: " + version].join("\n");
  return "mailto:" + CHANGE_TO + "?subject=" + encodeURIComponent("Flip Side app request (from Kris)") + "&body=" + encodeURIComponent(body);
}
export function friendlyError(error) {
  return ({
    code: "That code didn’t work. Ask KJ for a new one, then type it in Settings → Ask Kris.",
    cap: "Kris is resting for this month. You can still use everything else in the app.",
    busy: "That’s a lot at once! Give me a minute, then try again.",
    network: "I can’t reach Kris right now. Check your signal and try again.",
    big: "That photo is too big. Try a smaller one.",
    off: "Kris isn’t turned on in this copy of the app."
  })[error] || "Kris isn’t working right now. Try again in a little bit.";
}

/** Which mode to send: a photo with no other choice means "listing". */
export function pickMode(chosen, hasPhoto) {
  const ok = ["chat", "listing", "help", "change"];
  if (ok.includes(chosen)) return chosen;
  return hasPhoto ? "listing" : "chat";
}
