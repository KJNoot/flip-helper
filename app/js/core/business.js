// Business manager + strategist (v0.10). Pure logic, no DOM, unit-tested in Node.
// - Sourcing batches (a haul / purchase) linked to items, so cost and performance roll up.
// - Each item's history: where it came from, cost, where it's listed, offers, promos, price changes, relists, outcome.
// - A pricing strategy per item (Maximize profit / Balanced / Faster sale), per-platform prices, fee + profit math,
//   offer review with her target price and lowest OK offer, a relisting calendar, and decisions Kris remembers.
// Existing items keep every field; the new fields are added with safe defaults (no migration that deletes anything).
import { money, formatUsd, siteName, STAGE_LABELS } from "./inventory.js";
import { feeFor } from "./fees.js";
import { profitBreakdown } from "./profit.js";

export const DAY = 864e5;
export const BIZ_SITES = ["depop", "mercari", "vinted", "ebay"];
const str = v => (v == null || typeof v === "object" ? "" : String(v)).trim();
const id = (p, at = Date.now()) => p + at.toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- new item fields (safe defaults) ----------
export function bizFields(item = {}) {
  const it = item || {};
  const arr = v => (Array.isArray(v) ? v : []);
  return {
    sku: str(it.sku).slice(0, 40),
    batchId: it.batchId ? String(it.batchId) : null,
    garment: it.garment && typeof it.garment === "object" ? it.garment : null,
    listings: it.listings && typeof it.listings === "object" ? it.listings : {},
    strategy: normalizeStrategy(it.strategy),
    offers: arr(it.offers).map(normalizeOffer).filter(Boolean),
    promos: arr(it.promos).filter(p => p && typeof p === "object").map(p => ({ id: String(p.id || id("pr_")), site: str(p.site), kind: str(p.kind) || "promo", percent: Number(p.percent) || 0, note: str(p.note).slice(0, 200), at: Number(p.at) || 0 })),
    relists: arr(it.relists).filter(r => r && typeof r === "object").map(r => ({ site: str(r.site), at: Number(r.at) || 0, note: str(r.note).slice(0, 200) })),
    events: arr(it.events).filter(e => e && typeof e === "object").map(e => ({ at: Number(e.at) || 0, kind: str(e.kind) || "note", text: str(e.text).slice(0, 300) })).slice(-200),
    reviewAt: Number(it.reviewAt) || null
  };
}
export function withBiz(item) { return { ...item, ...bizFields(item) }; }
export function addEvent(item, kind, text, at = Date.now()) {
  const b = bizFields(item);
  return { ...item, ...b, events: b.events.concat({ at, kind, text: String(text || "").slice(0, 300) }).slice(-200), updatedAt: at };
}

// ---------- sourcing batches ----------
export function normalizeBatch(raw = {}, at = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: String(raw.id || id("b_", at)),
    name: str(raw.name).slice(0, 80) || "Batch",
    where: str(raw.where).slice(0, 100),
    date: /^\d{4}-\d\d-\d\d$/.test(str(raw.date)) ? str(raw.date) : new Date(at).toISOString().slice(0, 10),
    cost: money(raw.cost),
    notes: str(raw.notes).slice(0, 400),
    createdAt: Number(raw.createdAt) || at
  };
}
export function normalizeBatches(list) { return (Array.isArray(list) ? list : []).map(b => normalizeBatch(b)).filter(Boolean); }
export function batchItems(items, batchId) { return (items || []).filter(i => i.batchId === batchId); }
/** Split a batch's total cost across its items that have no cost of their own. */
export function spreadBatchCost(batch, items) {
  const its = batchItems(items, batch.id);
  const fixed = its.reduce((t, i) => t + (money(i.costPaid) ?? 0), 0);
  const open = its.filter(i => i.costPaid == null);
  if (batch.cost == null || !open.length) return [];
  const each = money(Math.max(0, batch.cost - fixed) / open.length);
  return open.map(i => ({ ...i, costPaid: each, updatedAt: Date.now() }));
}
export function batchStats(batch, items) {
  const its = batchItems(items, batch.id);
  const sold = its.filter(i => i.soldAt);
  const revenue = money(sold.reduce((t, i) => t + (money(i.salePrice) ?? 0), 0));
  const profitSold = money(sold.reduce((t, i) => t + (profitBreakdown(i).estimatedProfit ?? 0), 0));
  const itemCost = money(its.reduce((t, i) => t + (money(i.costPaid) ?? 0), 0));
  const cost = batch.cost != null ? batch.cost : itemCost;
  const feesShip = money(sold.reduce((t, i) => { const p = profitBreakdown(i); return t + p.fees + p.postage + p.supplies; }, 0));
  const net = money(revenue - feesShip - cost);
  return { items: its.length, sold: sold.length, unsold: its.length - sold.length, revenue, cost, net, roi: cost ? Math.round((net / cost) * 100) : null, sellThrough: its.length ? Math.round((sold.length / its.length) * 100) : 0, profitSold };
}

// ---------- strategy ----------
export const STRATEGIES = {
  max: { label: "Maximize profit", short: "Max profit", markup: 1.15, minOfferPct: 0.85, reviewDays: 30, blurb: "Price high, hold firm, accept only strong offers. Slower, more money." },
  balanced: { label: "Balanced", short: "Balanced", markup: 1.0, minOfferPct: 0.8, reviewDays: 21, blurb: "A fair market price, normal offers, a review every 3 weeks." },
  fast: { label: "Faster sales", short: "Fast", markup: 0.85, minOfferPct: 0.7, reviewDays: 10, blurb: "Price to move, take reasonable offers, review often." }
};
export function normalizeStrategy(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const per = {};
  for (const [k, v] of Object.entries(r.perSite && typeof r.perSite === "object" ? r.perSite : {})) { const m = money(v); if (m != null) per[k] = m; }
  return { mode: STRATEGIES[r.mode] ? r.mode : null, target: money(r.target), minOffer: money(r.minOffer), perSite: per, setAt: Number(r.setAt) || 0 };
}
/** Net money she keeps on a site at a price: price - fees - shipping she pays - cost. */
export function siteProfit(siteId, price, { cost = 0, ship = 0 } = {}) {
  const p = money(price); if (p == null) return null;
  const fee = feeFor(siteId, p).fee ?? 0;
  return { price: p, fee: money(fee), ship: money(ship) ?? 0, cost: money(cost) ?? 0, net: money(p - fee - (money(ship) ?? 0)), profit: money(p - fee - (money(ship) ?? 0) - (money(cost) ?? 0)) };
}
/** Price on a site so she keeps about the same as her base price on Depop (fees differ by site). */
export function priceForSameTakeHome(siteId, base, from = "depop") {
  const b = money(base); if (b == null) return null;
  const keep = b - (feeFor(from, b).fee ?? 0);
  let p = keep;
  for (let i = 0; i < 30; i++) { const fee = feeFor(siteId, p).fee ?? 0; const next = keep + fee; if (Math.abs(next - p) < 0.01) break; p = next; }
  return Math.ceil(p - 0.001); // round up to a whole dollar
}
/** Suggested target, lowest OK offer, per-site prices and the review date for a strategy. */
export function planStrategy(item, mode = "balanced", { base = null, at = Date.now(), floor = 0, ship = 0 } = {}) {
  const S = STRATEGIES[mode] || STRATEGIES.balanced;
  const ref = money(base) ?? money(item.askingPrice) ?? (item.priceLow != null && item.priceHigh != null ? money((item.priceLow + item.priceHigh) / 2) : money(item.priceHigh ?? item.priceLow));
  if (ref == null) return { mode, target: null, minOffer: null, perSite: {}, reviewAt: at + S.reviewDays * DAY, note: "Add a price first (or ask Kris for a price range)." };
  const target = Math.max(1, Math.round(ref * S.markup));
  const cost = money(item.costPaid) ?? 0;
  const lowest = Math.max(Math.round(target * S.minOfferPct), Math.ceil(cost + (money(floor) ?? 0) + (money(ship) ?? 0)));
  const perSite = {};
  for (const sId of BIZ_SITES) perSite[sId] = sId === "depop" ? target : priceForSameTakeHome(sId, target);
  return { mode, target, minOffer: Math.min(lowest, target), perSite, reviewAt: at + S.reviewDays * DAY, note: S.blurb };
}
export function applyStrategy(item, plan, at = Date.now()) {
  const prev = bizFields(item).strategy;
  let next = { ...item, ...bizFields(item), strategy: { mode: plan.mode, target: plan.target, minOffer: plan.minOffer, perSite: plan.perSite || {}, setAt: at }, reviewAt: plan.reviewAt || null, updatedAt: at };
  if (plan.target != null && money(item.askingPrice) !== plan.target) next = recordPriceChange(next, item.askingPrice, plan.target, { site: "", reason: STRATEGIES[plan.mode] ? STRATEGIES[plan.mode].label : "", at });
  return addEvent(next, "strategy", `Strategy: ${STRATEGIES[plan.mode] ? STRATEGIES[plan.mode].label : plan.mode}` + (plan.target != null ? `, target ${formatUsd(plan.target)}, lowest OK offer ${formatUsd(plan.minOffer)}` : "") + (prev.mode && prev.mode !== plan.mode ? ` (was ${STRATEGIES[prev.mode].label})` : ""), at);
}
export function recordPriceChange(item, from, to, { site = "", reason = "", at = Date.now() } = {}) {
  const f = money(from), t = money(to);
  const hist = (Array.isArray(item.askingHistory) ? item.askingHistory : []).concat({ siteId: site, from: f, to: t, percent: f ? Math.round(((t - f) / f) * 100) : 0, action: "price", status: "done", reason, at });
  return { ...item, askingPrice: t, askingHistory: hist, updatedAt: at };
}

// ---------- offers ----------
export function normalizeOffer(o) {
  if (!o || typeof o !== "object") return null;
  const amount = money(o.amount); if (amount == null) return null;
  return { id: String(o.id || id("of_")), site: str(o.site), amount, at: Number(o.at) || 0, decision: ["accepted", "countered", "declined", "pending"].includes(o.decision) ? o.decision : "pending", counter: money(o.counter), note: str(o.note).slice(0, 200) };
}
/**
 * Review an offer against her target and lowest OK offer. Returns a plain recommendation:
 * { verdict: "accept"|"counter"|"decline", counter, keep, profit, reason }.
 */
export function reviewOffer(item, amount, site = "depop", { ship = 0 } = {}) {
  const a = money(amount); const st = bizFields(item).strategy;
  const target = st.target ?? money(item.askingPrice), min = st.minOffer ?? (target != null ? Math.round(target * 0.8) : null);
  const sp = siteProfit(site || "depop", a, { cost: item.costPaid ?? 0, ship });
  if (a == null) return { verdict: "decline", reason: "Type the offer amount." };
  const pastBest = Math.max(0, ...bizFields(item).offers.filter(o => o.decision !== "accepted").map(o => o.amount));
  let verdict, counter = null, reason;
  if (target != null && a >= target) { verdict = "accept"; reason = "It’s at or above your target price."; }
  else if (min != null && a >= min) { verdict = "accept"; reason = `It’s above your lowest OK offer (${formatUsd(min)}).`; }
  else if (min != null && a >= min * 0.85) { verdict = "counter"; counter = Math.round(((target ?? min) + min) / 2); reason = `It’s a little under your lowest OK offer (${formatUsd(min)}). Counter in the middle.`; }
  else { verdict = min != null ? "counter" : "accept"; counter = min != null ? Math.max(min, Math.round((target ?? min) * 0.95)) : null; reason = min != null ? `It’s well under your lowest OK offer (${formatUsd(min)}). Counter near your price, or decline.` : "No target set yet. Set a strategy so I can judge offers."; }
  if (sp && sp.profit != null && sp.profit < 0) { verdict = "counter"; counter = Math.max(counter ?? 0, Math.ceil((item.costPaid ?? 0) + (sp.fee ?? 0) + (money(ship) ?? 0) + 1)); reason = "You’d lose money after fees. Counter higher."; }
  if (pastBest && a < pastBest) reason += ` You turned down ${formatUsd(pastBest)} before.`;
  return { verdict, counter, target, min, keep: sp ? sp.net : null, profit: sp ? sp.profit : null, fee: sp ? sp.fee : null, reason };
}
export function logOffer(item, offer, at = Date.now()) {
  const o = normalizeOffer({ ...offer, at: offer.at || at }); if (!o) return item;
  const b = bizFields(item);
  return addEvent({ ...item, ...b, offers: b.offers.concat(o) }, "offer", `Offer ${formatUsd(o.amount)}${o.site ? " on " + siteName(o.site) : ""}: ${o.decision}${o.counter != null ? ", countered " + formatUsd(o.counter) : ""}`, at);
}
export function logPromo(item, promo, at = Date.now()) {
  const b = bizFields(item);
  const p = { id: id("pr_", at), site: str(promo.site), kind: str(promo.kind) || "promo", percent: Number(promo.percent) || 0, note: str(promo.note).slice(0, 200), at };
  return addEvent({ ...item, ...b, promos: b.promos.concat(p) }, "promo", `${p.kind}${p.percent ? " " + p.percent + "% off" : ""}${p.site ? " on " + siteName(p.site) : ""}${p.note ? ": " + p.note : ""}`, at);
}
export function logRelist(item, site, at = Date.now(), { reviewDays = null } = {}) {
  const b = bizFields(item);
  const days = reviewDays ?? (STRATEGIES[b.strategy.mode] || STRATEGIES.balanced).reviewDays;
  return addEvent({ ...item, ...b, relists: b.relists.concat({ site: str(site), at, note: "" }), reviewAt: at + days * DAY }, "relist", `Relisted${site ? " on " + siteName(site) : ""}`, at);
}

// ---------- relisting calendar ----------
/** When an unsold listed item is due for a review: her date, or by strategy from when it was listed / last touched. */
export function reviewDate(item) {
  if (item.soldAt) return null;
  const b = bizFields(item);
  if (b.reviewAt) return b.reviewAt;
  const listed = Object.values(item.listedOn || {}).map(x => Number(x && x.at) || 0).filter(Boolean);
  if (!listed.length) return null;
  const last = Math.max(Math.min(...listed), ...b.relists.map(r => r.at), ...(item.askingHistory || []).map(h => Number(h.at) || 0));
  return last + (STRATEGIES[b.strategy.mode] || STRATEGIES.balanced).reviewDays * DAY;
}
export function calendarDays(items, { from = Date.now(), days = 42 } = {}) {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i < days; i++) out.push({ day: new Date(start.getTime() + i * DAY), items: [] });
  const overdue = [];
  for (const it of items || []) {
    const d = reviewDate(it); if (!d) continue;
    const idx = Math.floor((d - start.getTime()) / DAY);
    if (idx < 0) overdue.push(it); else if (idx < days) out[idx].items.push(it);
  }
  return { days: out, overdue };
}
export function setReview(item, at, when) { return addEvent({ ...item, ...bizFields(item), reviewAt: when }, "review", "Review set for " + new Date(when).toDateString(), at); }
/** An .ics file with one alarm per due review (she taps it to put them on her phone's calendar). */
export function reviewsIcs(items, { now = Date.now() } = {}) {
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flip Side//Relist reviews//EN"];
  for (const it of items || []) {
    const d = reviewDate(it); if (!d || d < now - DAY) continue;
    const at = new Date(d); at.setHours(10, 0, 0, 0);
    lines.push("BEGIN:VEVENT", "UID:" + it.id + "-review@flipside", "DTSTAMP:" + stamp(new Date(now)), "DTSTART:" + stamp(at), "DURATION:PT15M",
      "SUMMARY:" + ("Review listing: " + (it.sku ? it.sku + " " : "") + (it.title || "item")).replace(/[,;\n]/g, " ").slice(0, 120),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Review this listing in Flip Side", "TRIGGER:-PT0M", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// ---------- needs attention ----------
export function needsAttention(items, { now = Date.now() } = {}) {
  const out = [];
  for (const it of items || []) {
    const b = bizFields(it);
    if (it.soldAt && !it.shippedAt) out.push({ item: it, kind: "ship", text: "Sold, ship it" });
    const pend = b.offers.filter(o => o.decision === "pending");
    if (pend.length && !it.soldAt) out.push({ item: it, kind: "offer", text: `Offer ${formatUsd(pend[pend.length - 1].amount)} waiting` });
    const d = reviewDate(it);
    if (d && d <= now) out.push({ item: it, kind: "review", text: "Due for a price review / relist" });
    if (!it.soldAt && b.listings && b.listings.depop && !b.listings.depop.approvedAt && b.garment) out.push({ item: it, kind: "draft", text: "Listing draft not approved yet" });
  }
  const order = { ship: 0, offer: 1, review: 2, draft: 3 };
  return out.sort((a, c) => order[a.kind] - order[c.kind]);
}

// ---------- financial reporting ----------
function inRange(t, from, to) { return t && (!from || t >= from) && (!to || t < to); }
export function finance(items, { from = null, to = null, expenses = [], batches = [] } = {}) {
  const sold = (items || []).filter(i => inRange(i.soldAt, from, to));
  const byPlatform = {};
  let revenue = 0, cogs = 0, fees = 0, ship = 0, other = 0, profit = 0;
  for (const i of sold) {
    const p = profitBreakdown(i), site = i.soldOn || "other";
    const row = byPlatform[site] || (byPlatform[site] = { site, name: site === "other" ? "Other / not set" : siteName(site), sold: 0, revenue: 0, fees: 0, ship: 0, cost: 0, profit: 0, days: 0 });
    row.sold++; row.revenue += p.sale ?? 0; row.fees += p.fees; row.ship += p.postage; row.cost += p.cost; row.profit += p.estimatedProfit ?? 0;
    const listedAt = Math.min(...Object.values(i.listedOn || {}).map(x => Number(x && x.at) || Infinity), i.createdAt || Infinity);
    if (Number.isFinite(listedAt) && i.soldAt > listedAt) row.days += (i.soldAt - listedAt) / DAY;
    revenue += p.sale ?? 0; cogs += p.cost; fees += p.fees; ship += p.postage; other += p.supplies + p.discounts + p.refunds; profit += p.estimatedProfit ?? 0;
  }
  const ex = (expenses || []).filter(e => { const t = Date.parse(e.date); return Number.isFinite(t) && inRange(t, from, to); });
  const expenseTotal = ex.reduce((t, e) => t + (money(e.amount) ?? 0), 0);
  const plat = Object.values(byPlatform).map(r => ({ ...r, revenue: money(r.revenue), fees: money(r.fees), ship: money(r.ship), cost: money(r.cost), profit: money(r.profit), avgDays: r.sold ? Math.round(r.days / r.sold) : null, avgProfit: r.sold ? money(r.profit / r.sold) : null })).sort((a, b) => b.profit - a.profit);
  const unsold = (items || []).filter(i => !i.soldAt);
  return {
    sold: sold.length, revenue: money(revenue), cogs: money(cogs), fees: money(fees), shipping: money(ship), otherCosts: money(other),
    profit: money(profit), expenses: money(expenseTotal), net: money(profit - expenseTotal),
    inventory: { count: unsold.length, cost: money(unsold.reduce((t, i) => t + (money(i.costPaid) ?? 0), 0)), listed: unsold.filter(i => Object.keys(i.listedOn || {}).length).length },
    byPlatform: plat,
    batches: normalizeBatches(batches).map(b => ({ batch: b, ...batchStats(b, items) })).sort((a, b) => (b.net ?? 0) - (a.net ?? 0))
  };
}
export function monthRange(at = Date.now()) { const d = new Date(at); const a = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); const b = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); return { from: a, to: b }; }
export function yearRange(at = Date.now()) { const y = new Date(at).getFullYear(); return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() }; }

// ---------- item history (derived; works for old items too) ----------
export function itemHistory(item, batches = []) {
  const b = bizFields(item), ev = [];
  const push = (at, kind, text) => { if (at) ev.push({ at: Number(at), kind, text }); };
  const batch = normalizeBatches(batches).find(x => x.id === b.batchId);
  push(item.createdAt, "added", "Added to Flip Side" + (b.sku ? " as " + b.sku : ""));
  if (batch) push(item.createdAt + 1, "source", `From batch “${batch.name}”${batch.where ? " (" + batch.where + ")" : ""}`);
  if (item.costPaid != null) push(item.createdAt + 2, "cost", "Cost " + formatUsd(item.costPaid));
  for (const [site, v] of Object.entries(item.listedOn || {})) push(v && v.at, "listed", "Listed on " + siteName(site));
  for (const [k, v] of Object.entries(b.listings || {})) if (v && v.approvedAt) push(v.approvedAt, "listing", (k === "depop" ? "Depop" : siteName(k)) + " listing approved");
  for (const h of item.askingHistory || []) if (h && h.at && h.to != null) push(h.at, "price", `Price ${h.from != null ? formatUsd(h.from) + " → " : ""}${formatUsd(h.to)}${h.siteId ? " on " + siteName(h.siteId) : ""}${h.reason ? " (" + h.reason + ")" : ""}`);
  for (const e of b.events) if (!["offer", "promo", "relist"].includes(e.kind) || true) push(e.at, e.kind, e.text);
  if (item.soldAt) push(item.soldAt, "sold", "Sold" + (item.salePrice != null ? " for " + formatUsd(item.salePrice) : "") + (item.soldOn ? " on " + siteName(item.soldOn) : ""));
  if (item.shippedAt) push(item.shippedAt, "shipped", "Shipped");
  if (item.returns && item.returns.returned) push(item.returns.returnedAt, "return", "Returned");
  // the same price change can be in askingHistory and events: keep one
  const seen = new Set();
  return ev.sort((x, y) => x.at - y.at).filter(e => { const k = e.kind + "|" + Math.round(e.at / 1000) + "|" + (e.kind === "price" ? "" : e.text); if (seen.has(k)) return false; seen.add(k); return true; });
}
export function outcome(item) {
  if (item.returns && item.returns.returned) return "Returned";
  if (item.soldAt) { const p = profitBreakdown(item).estimatedProfit; return "Sold" + (p != null ? ", profit " + formatUsd(p) : ""); }
  return STAGE_LABELS[item.stage] || "Draft";
}

// ---------- decisions Kris remembers (and noticing a change of mind) ----------
export function normalizeDecisions(list) {
  return (Array.isArray(list) ? list : []).filter(d => d && d.topic).map(d => ({ topic: str(d.topic).slice(0, 60), value: str(d.value).slice(0, 120), at: Number(d.at) || 0, itemId: d.itemId ? String(d.itemId) : null, note: str(d.note).slice(0, 160) })).slice(-200);
}
/** Add a decision. Returns { decisions, changed: { from, to, since } | null } when she goes against her usual choice. */
export function noteDecision(list, { topic, value, itemId = null, note = "", at = Date.now() }) {
  const ds = normalizeDecisions(list);
  const same = ds.filter(d => d.topic === topic);
  const usual = usualChoice(same);
  ds.push({ topic, value: str(value), at, itemId, note });
  const changed = usual && usual.value !== str(value) && usual.count >= 2 ? { from: usual.value, to: str(value), since: usual.since, count: usual.count } : null;
  return { decisions: ds.slice(-200), changed };
}
export function usualChoice(list) {
  if (!list.length) return null;
  const recent = list.slice(-5), counts = {};
  for (const d of recent) counts[d.value] = (counts[d.value] || 0) + 1;
  const [value, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { value, count, since: (recent.find(d => d.value === value) || {}).at || 0 };
}
export function decisionsText(list) {
  const ds = normalizeDecisions(list), topics = [...new Set(ds.map(d => d.topic))];
  return topics.map(t => { const u = usualChoice(ds.filter(d => d.topic === t)); const last = ds.filter(d => d.topic === t).pop(); return `${t}: usually ${u.value}${last.value !== u.value ? `, but last time ${last.value}` : ""}`; }).join("\n");
}
