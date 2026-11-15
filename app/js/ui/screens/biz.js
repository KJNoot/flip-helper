// Business manager + strategist screens (v0.10). Big buttons, one job per screen.
//   #/biz                 the hub (advanced tools)
//   #/biz/find            Find inventory (SKU, brand, size, words)
//   #/biz/attention       Needs attention
//   #/biz/offer           Review an offer (pick the item)
//   #/biz/batches         Sourcing batches; #/biz/batch/<id> one batch
//   #/biz/report          Financial snapshot (totals, by platform, batches) + fee calculator
//   #/biz/calendar        Relisting calendar
//   #/strategy/<id>[/offer]  one item: strategy, per-site prices, offers, promos, relists, history
import { esc, toast, thumb, download, confirmSheet } from "../dom.js";
import { formatUsd, money, siteName, STAGE_LABELS, markSold } from "../../core/inventory.js";
import { bizStore } from "../../core/bizstore.js";
import {
  STRATEGIES, BIZ_SITES, planStrategy, applyStrategy, siteProfit, reviewOffer, logOffer, logPromo, logRelist, recordPriceChange,
  itemHistory, outcome, normalizeBatch, batchStats, batchItems, spreadBatchCost, finance, monthRange, yearRange,
  calendarDays, reviewDate, setReview, reviewsIcs, needsAttention, noteDecision, withBiz, addEvent, DAY
} from "../../core/business.js";
import { krisCore } from "../kris.js";

const B = bizStore();
const usd = n => (n == null ? "—" : formatUsd(n));
const top = (title, back = "#/biz") => `<div class="topbar"><a class="iconbtn" href="${back}" aria-label="Back">‹</a><h2>${esc(title)}</h2><span class="spacer48"></span></div>`;
const row = (it, right = "", href = null) => `<li><a class="itemrow" href="${esc(href || "#/strategy/" + it.id)}">${thumb(it, 48)}<span class="grow"><b>${esc(it.title || "Untitled item")}</b><span class="tiny muted">${esc([it.sku, STAGE_LABELS[it.stage] || it.stage, it.askingPrice != null ? usd(it.askingPrice) : ""].filter(Boolean).join(" · "))}</span></span>${right}</a></li>`;

export async function renderBiz(ctx, el, sub = "", rest = []) {
  const items = ctx.items.map(withBiz);
  if (sub === "find" || sub === "offer") return find(ctx, el, items, sub);
  if (sub === "attention") return attention(el, items);
  if (sub === "batches") return batches(ctx, el, items);
  if (sub === "batch") return batch(ctx, el, items, rest[1]);
  if (sub === "report") return report(el, items);
  if (sub === "calendar") return calendar(ctx, el, items);
  const att = needsAttention(items).length;
  el.innerHTML = `${top("Business manager", "#/home")}
    <div class="dash">
      <a class="dash-tile" href="#/biz/attention"><span class="dt-ic">⚠️</span><b>Needs attention</b><span class="tiny muted">${att} to look at</span></a>
      <a class="dash-tile" href="#/biz/offer"><span class="dt-ic">🤝</span><b>Review an offer</b><span class="tiny muted">Accept, counter or pass</span></a>
      <a class="dash-tile" href="#/biz/find"><span class="dt-ic">🔍</span><b>Find inventory</b><span class="tiny muted">By SKU, brand or size</span></a>
      <a class="dash-tile" href="#/biz/batches"><span class="dt-ic">🛍</span><b>Sourcing batches</b><span class="tiny muted">Hauls and what they made</span></a>
      <a class="dash-tile" href="#/biz/report"><span class="dt-ic">📊</span><b>Financial snapshot</b><span class="tiny muted">Totals, platforms, batches</span></a>
      <a class="dash-tile" href="#/biz/calendar"><span class="dt-ic">📅</span><b>Relisting calendar</b><span class="tiny muted">What’s due for a review</span></a>
    </div>`;
}

// ---------- find / offer picker ----------
function find(ctx, el, items, sub) {
  const isOffer = sub === "offer";
  el.innerHTML = `${top(isOffer ? "Review an offer" : "Find inventory")}
    <div class="card">${isOffer ? `<p class="small">Which item got the offer?</p>` : ""}
      <input id="biz-q" type="search" placeholder="SKU, brand, size or words" autocomplete="off" aria-label="Search">
      <div class="seg" id="biz-filter" style="margin-top:10px">${[["all", "All"], ["unsold", "Not sold"], ["listed", "Listed"], ["sold", "Sold"]].map(([k, v]) => `<button type="button" data-f="${k}" class="${(isOffer ? "listed" : "all") === k ? "on" : ""}">${v}</button>`).join("")}</div>
    </div>
    <ul class="itemlist" id="biz-results"></ul>`;
  let filter = isOffer ? "listed" : "all";
  const q = el.querySelector("#biz-q");
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const hits = items.filter(i => {
      if (filter === "unsold" && i.soldAt) return false;
      if (filter === "listed" && (i.soldAt || !Object.keys(i.listedOn || {}).length && !(i.listings && i.listings.depop && i.listings.depop.approvedAt))) return false;
      if (filter === "sold" && !i.soldAt) return false;
      if (!t) return true;
      const g = i.garment || {};
      return [i.sku, i.title, i.brand, g.brand, g.size, i.size, g.color, i.category, i.binLocation].join(" ").toLowerCase().includes(t);
    }).slice(0, 80);
    el.querySelector("#biz-results").innerHTML = hits.length ? hits.map(i => row(i, i.binLocation ? `<span class="pill">📦 ${esc(i.binLocation)}</span>` : "", isOffer ? "#/strategy/" + i.id + "/offer" : null)).join("") : `<li class="card empty"><p>Nothing matches.</p></li>`;
  };
  q.addEventListener("input", draw);
  el.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.f; el.querySelectorAll("[data-f]").forEach(x => x.classList.toggle("on", x === b)); draw(); }));
  draw();
}

function attention(el, items) {
  const list = needsAttention(items);
  const ic = { ship: "📦", offer: "🤝", review: "📅", draft: "✍️" };
  el.innerHTML = `${top("Needs attention")}
    ${list.length ? `<ul class="itemlist" id="biz-attn">${list.map(a => row(a.item, `<span class="pill pill-warn">${ic[a.kind]} ${esc(a.text)}</span>`, a.kind === "ship" ? "#/item/" + a.item.id : a.kind === "draft" ? "#/listing/" + a.item.id + "/depop" : "#/strategy/" + a.item.id + (a.kind === "offer" ? "/offer" : ""))).join("")}</ul>` : `<div class="card empty"><span class="em">🎉</span><p>All caught up.</p></div>`}`;
}

// ---------- batches ----------
async function batches(ctx, el, items) {
  const list = await B.batches();
  el.innerHTML = `${top("Sourcing batches")}
    <div class="card"><h3>Add a haul or purchase</h3>
      <label class="field"><span>Name</span><input id="bt-name" placeholder="Goodwill bins Nov 15"></label>
      <div class="row wrap" style="gap:10px"><label class="field grow"><span>Where</span><input id="bt-where" placeholder="Goodwill"></label>
      <label class="field grow"><span>Date</span><input id="bt-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
      <label class="field"><span>Total paid ($)</span><input id="bt-cost" inputmode="decimal" placeholder="42"></label>
      <button type="button" class="btn" id="bt-add">＋ Save batch</button></div>
    ${list.length ? `<ul class="itemlist" id="bt-list">${list.slice().reverse().map(b => { const s = batchStats(b, items); return `<li><a class="itemrow" href="#/biz/batch/${esc(b.id)}"><span class="thumb ph">🛍</span><span class="grow"><b>${esc(b.name)}</b><span class="tiny muted">${esc(b.date)} · ${s.items} items · ${s.sold} sold · paid ${usd(s.cost)}</span></span><span class="pill ${s.net >= 0 ? "pill-sold" : "pill-warn"}">${usd(s.net)}</span></a></li>`; }).join("")}</ul>` : `<p class="small muted center">No batches yet.</p>`}`;
  el.querySelector("#bt-add").addEventListener("click", async () => {
    const b = normalizeBatch({ name: el.querySelector("#bt-name").value, where: el.querySelector("#bt-where").value, date: el.querySelector("#bt-date").value, cost: el.querySelector("#bt-cost").value });
    if (!el.querySelector("#bt-name").value.trim()) { toast("Give it a name."); return; }
    await B.setBatches(list.concat(b)); toast("Batch saved."); location.hash = "#/biz/batch/" + b.id;
  });
}
async function batch(ctx, el, items, id) {
  const list = await B.batches(), b = list.find(x => x.id === id);
  if (!b) { el.innerHTML = `${top("Batch", "#/biz/batches")}<div class="card empty"><p>Batch not found.</p></div>`; return; }
  const s = batchStats(b, items), its = batchItems(items, b.id);
  const free = items.filter(i => !i.batchId && !i.soldAt).slice(0, 40);
  el.innerHTML = `${top(b.name, "#/biz/batches")}
    <div class="stats"><div class="card stat"><span class="tiny muted">Paid</span><b>${usd(s.cost)}</b></div><div class="card stat"><span class="tiny muted">Sales</span><b>${usd(s.revenue)}</b></div><div class="card stat"><span class="tiny muted">Net so far</span><b>${usd(s.net)}</b></div></div>
    <div class="card"><p class="small">${s.items} items · ${s.sold} sold (${s.sellThrough}%)${s.roi != null ? " · return " + s.roi + "%" : ""}${b.where ? " · " + esc(b.where) : ""}</p>
      <a class="btn" href="#/listing" id="bt-newlisting">👗 Start a listing from this batch</a>
      ${b.cost != null && its.some(i => i.costPaid == null) ? `<button type="button" class="btn soft" id="bt-spread" style="margin-top:8px">Split the ${usd(b.cost)} across items with no cost</button>` : ""}</div>
    <div class="section-title"><h3>Items</h3></div>
    ${its.length ? `<ul class="itemlist">${its.map(i => row(i, `<span class="tiny muted">${esc(outcome(i))}</span>`)).join("")}</ul>` : `<p class="small muted">No items yet.</p>`}
    ${free.length ? `<details class="card"><summary><b>Add items you already have</b></summary><ul class="itemlist">${free.map(i => `<li><label class="check"><input type="checkbox" data-add="${esc(i.id)}"><span>${esc(i.title || "Untitled")} ${i.sku ? "· " + esc(i.sku) : ""}</span></label></li>`).join("")}</ul><button type="button" class="btn sm" id="bt-addsel">Add the checked items</button></details>` : ""}`;
  el.querySelector("#bt-newlisting").addEventListener("click", () => { try { sessionStorage.setItem("flip-helper.nextBatch", b.id); } catch (e) { } });
  const sp = el.querySelector("#bt-spread"); if (sp) sp.addEventListener("click", async () => { for (const i of spreadBatchCost(b, items)) await ctx.save(addEvent(i, "cost", "Cost from batch split: " + usd(i.costPaid))); toast("Done."); batch(ctx, el, ctx.items.map(withBiz), id); });
  const as = el.querySelector("#bt-addsel"); if (as) as.addEventListener("click", async () => { const ids = [...el.querySelectorAll("[data-add]:checked")].map(x => x.dataset.add); for (const iid of ids) { const it = items.find(i => i.id === iid); if (it) await ctx.save(addEvent({ ...it, batchId: b.id }, "source", "Added to batch “" + b.name + "”")); } toast(ids.length + " added."); batch(ctx, el, ctx.items.map(withBiz), id); });
}

// ---------- financial snapshot ----------
async function report(el, items) {
  const expenses = await B.expenses(), batchesList = await B.batches();
  let period = "month";
  const draw = () => {
    const r = period === "month" ? monthRange() : period === "year" ? yearRange() : { from: null, to: null };
    const f = finance(items, { ...r, expenses, batches: batchesList });
    el.innerHTML = `${top("Financial snapshot")}
      <div class="seg" id="fin-period">${[["month", "This month"], ["year", "This year"], ["all", "All time"]].map(([k, v]) => `<button type="button" data-p="${k}" class="${period === k ? "on" : ""}">${v}</button>`).join("")}</div>
      <div class="stats"><div class="card stat"><span class="tiny muted">Sales</span><b id="fin-rev">${usd(f.revenue)}</b></div><div class="card stat"><span class="tiny muted">Profit</span><b id="fin-profit">${usd(f.profit)}</b></div><div class="card stat"><span class="tiny muted">Sold</span><b>${f.sold}</b></div></div>
      <div class="card"><h3>All together</h3><dl class="kris-pre" id="fin-totals">
        <dt>Sales</dt><dd>${usd(f.revenue)}</dd><dt>Cost of items</dt><dd>${usd(f.cogs)}</dd><dt>Platform fees</dt><dd>${usd(f.fees)}</dd><dt>Shipping you paid</dt><dd>${usd(f.shipping)}</dd><dt>Supplies, discounts, refunds</dt><dd>${usd(f.otherCosts)}</dd><dt>Profit on sales</dt><dd><b>${usd(f.profit)}</b></dd><dt>Other expenses</dt><dd>${usd(f.expenses)}</dd><dt>Net</dt><dd><b>${usd(f.net)}</b></dd></dl>
        <p class="tiny muted">Unsold inventory: ${f.inventory.count} item${f.inventory.count === 1 ? "" : "s"} (${f.inventory.listed} listed), cost ${usd(f.inventory.cost)}. Fees are estimates unless you typed the real ones.</p></div>
      <div class="card"><h3>By platform</h3>${f.byPlatform.length ? `<table class="fin-table" id="fin-platforms"><tr><th>Site</th><th>Sold</th><th>Sales</th><th>Fees</th><th>Profit</th><th>Avg days</th></tr>${f.byPlatform.map(p => `<tr><td>${esc(p.name)}</td><td>${p.sold}</td><td>${usd(p.revenue)}</td><td>${usd(p.fees)}</td><td><b>${usd(p.profit)}</b></td><td>${p.avgDays ?? "—"}</td></tr>`).join("")}</table>` : `<p class="small muted">No sales in this period yet.</p>`}</div>
      <div class="card"><h3>Sourcing batches</h3>${f.batches.length ? `<table class="fin-table" id="fin-batches"><tr><th>Batch</th><th>Paid</th><th>Sold</th><th>Sales</th><th>Net</th></tr>${f.batches.map(b => `<tr><td><a href="#/biz/batch/${esc(b.batch.id)}">${esc(b.batch.name)}</a></td><td>${usd(b.cost)}</td><td>${b.sold}/${b.items}</td><td>${usd(b.revenue)}</td><td><b>${usd(b.net)}</b></td></tr>`).join("")}</table><p class="tiny muted">Batches show all-time numbers.</p>` : `<p class="small muted">Add a batch in Sourcing batches to see how each haul did.</p>`}</div>
      <div class="card" id="fee-calc"><h3>Fee &amp; profit calculator</h3>
        <div class="row wrap" style="gap:10px"><label class="field grow"><span>Price ($)</span><input id="fc-price" inputmode="decimal" value="30"></label><label class="field grow"><span>You paid ($)</span><input id="fc-cost" inputmode="decimal" value="5"></label><label class="field grow"><span>Shipping you pay ($)</span><input id="fc-ship" inputmode="decimal" value="0"></label></div>
        <table class="fin-table" id="fc-out"></table><p class="tiny muted">Approximate US fees, November 2026. Check your account; sites change fees.</p></div>`;
    el.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => { period = b.dataset.p; draw(); }));
    const calc = () => {
      const p = el.querySelector("#fc-price").value, c = money(el.querySelector("#fc-cost").value) ?? 0, s = money(el.querySelector("#fc-ship").value) ?? 0;
      el.querySelector("#fc-out").innerHTML = `<tr><th>Site</th><th>Fee</th><th>You keep</th><th>Profit</th></tr>` + BIZ_SITES.map(id => { const r = siteProfit(id, p, { cost: c, ship: s }); return r ? `<tr data-site="${id}"><td>${esc(siteName(id))}</td><td>${usd(r.fee)}</td><td>${usd(r.net)}</td><td><b>${usd(r.profit)}</b></td></tr>` : ""; }).join("");
    };
    el.querySelectorAll("#fee-calc input").forEach(i => i.addEventListener("input", calc)); calc();
  };
  draw();
}

// ---------- relisting calendar ----------
function calendar(ctx, el, items) {
  const cal = calendarDays(items, { days: 42 });
  let pick = null;
  const draw = () => {
    const sel = pick != null ? cal.days[pick] : null;
    el.innerHTML = `${top("Relisting calendar")}
      ${cal.overdue.length ? `<div class="card alert"><h3>Due now (${cal.overdue.length})</h3><ul class="itemlist" id="cal-overdue">${cal.overdue.map(i => row(i, `<span class="pill pill-warn">due</span>`)).join("")}</ul></div>` : ""}
      <div class="card"><div class="cal-grid" id="cal-grid">${["S", "M", "T", "W", "T", "F", "S"].map(d => `<span class="cal-h">${d}</span>`).join("")}${"<span></span>".repeat(cal.days[0].day.getDay())}${cal.days.map((d, i) => `<button type="button" class="cal-d ${d.items.length ? "has" : ""} ${pick === i ? "on" : ""}" data-d="${i}" aria-label="${esc(d.day.toDateString())}: ${d.items.length} due">${d.day.getDate()}${d.items.length ? `<i>${d.items.length}</i>` : ""}</button>`).join("")}</div>
        <p class="tiny muted">Dots are listings due for a price review or relist (from each item’s strategy). Tap a day.</p></div>
      ${sel ? `<div class="card"><h3>${esc(sel.day.toDateString())}</h3>${sel.items.length ? `<ul class="itemlist">${sel.items.map(i => row(i)).join("")}</ul>` : `<p class="small muted">Nothing due.</p>`}</div>` : ""}
      <button type="button" class="btn" id="cal-ics">📅 Put these reviews on my phone’s calendar</button>
      <p class="tiny muted center">Opens a calendar file with an alert for each review. Phones can’t wake a web app on a timer, so this is the sure reminder.</p>`;
    el.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => { pick = Number(b.dataset.d); draw(); }));
    el.querySelector("#cal-ics").addEventListener("click", () => { download("flip-side-reviews.ics", reviewsIcs(items), "text/calendar"); toast("Open the file to add the reviews to your calendar."); });
  };
  draw();
}

// ---------- one item: strategy, prices, offers, history ----------
export async function renderStrategy(ctx, el, id, focus = "") {
  const raw = ctx.items.find(i => i.id === id);
  if (!raw) { el.innerHTML = `${top("Pricing", "#/items")}<div class="card empty"><p>Item not found.</p></div>`; return; }
  const item = withBiz(raw), st = item.strategy, decisions = await B.decisions(), batchesList = await B.batches();
  let mode = st.mode || "balanced";
  const draw = () => {
    const plan = planStrategy(item, mode, {});
    const curPer = st.mode === mode && Object.keys(st.perSite).length ? st.perSite : plan.perSite;
    const due = reviewDate(item);
    el.innerHTML = `${top(item.title || "Pricing", "#/item/" + item.id)}
      <div class="card"><p class="small">${esc([item.sku, STAGE_LABELS[item.stage]].filter(Boolean).join(" · "))} · cost ${usd(item.costPaid)} · price ${usd(item.askingPrice)}</p>
        <div class="row wrap" style="gap:8px"><a class="btn sm soft" href="#/listing/${esc(item.id)}/depop">✍️ Listings</a><a class="btn sm soft" href="#/item/${esc(item.id)}">📦 Item page</a></div></div>
      <div class="card" id="st-card"><h3>Pricing strategy</h3>
        <div class="stack">${Object.entries(STRATEGIES).map(([k, v]) => `<button type="button" class="btn ${mode === k ? "" : "soft"}" data-mode="${k}" aria-pressed="${mode === k}">${esc(v.label)}${st.mode === k ? " ✓" : ""}</button>`).join("")}</div>
        <p class="small muted" style="margin-top:8px">${esc(STRATEGIES[mode].blurb)}</p>
        ${plan.target == null ? `<p class="small">${esc(plan.note)}</p>` : `
        <div class="row wrap" style="gap:10px"><label class="field grow"><span>Target price ($)</span><input id="st-target" inputmode="decimal" value="${esc(st.mode === mode && st.target != null ? st.target : plan.target)}"></label>
          <label class="field grow"><span>Lowest OK offer ($)</span><input id="st-min" inputmode="decimal" value="${esc(st.mode === mode && st.minOffer != null ? st.minOffer : plan.minOffer)}"></label></div>
        <table class="fin-table" id="st-sites"><tr><th>Site</th><th>Price</th><th>Fee</th><th>Profit</th></tr>${BIZ_SITES.map(sId => { const p = curPer[sId]; const r = siteProfit(sId, p, { cost: item.costPaid ?? 0 }); return `<tr><td>${esc(siteName(sId))}</td><td><input class="st-site" data-site="${sId}" inputmode="decimal" value="${esc(p ?? "")}" aria-label="${esc(siteName(sId))} price"></td><td>${usd(r && r.fee)}</td><td><b>${usd(r && r.profit)}</b></td></tr>`; }).join("")}</table>
        <p class="tiny muted">Site prices are set so you keep about the same after each site’s fees. Approximate fees.</p>
        <button type="button" class="btn" id="st-apply">Use this plan</button>`}
        <p class="tiny muted" id="st-mind"></p></div>
      <div class="card" id="offer-card"><h3>🤝 Review an offer</h3>
        <div class="row wrap" style="gap:10px"><label class="field grow"><span>Offer ($)</span><input id="of-amt" inputmode="decimal" placeholder="20"></label>
          <label class="field grow"><span>Site</span><select id="of-site">${BIZ_SITES.map(s => `<option value="${s}">${esc(siteName(s))}</option>`).join("")}</select></label></div>
        <button type="button" class="btn" id="of-check">What should I do?</button><div id="of-out"></div>
        ${item.offers.length ? `<p class="tiny muted" id="of-past">Past offers: ${esc(item.offers.map(o => usd(o.amount) + " " + o.decision).join(" · "))}</p>` : ""}</div>
      <div class="card"><h3>Promos, price changes &amp; relists</h3>
        <div class="row wrap" style="gap:10px"><label class="field grow"><span>New price ($)</span><input id="pc-to" inputmode="decimal"></label><label class="field grow"><span>Site (optional)</span><select id="pc-site"><option value="">All</option>${BIZ_SITES.map(s => `<option value="${s}">${esc(siteName(s))}</option>`).join("")}</select></label></div>
        <button type="button" class="btn sm soft" id="pc-save">Save price change</button>
        <div class="row wrap" style="gap:10px;margin-top:10px"><label class="field grow"><span>Promo</span><select id="pr-kind"><option>Sale / % off</option><option>Offer to likers</option><option>Free shipping</option><option>Bundle discount</option><option>Boost / promoted</option></select></label><label class="field grow"><span>% off</span><input id="pr-pct" inputmode="numeric" placeholder="10"></label></div>
        <button type="button" class="btn sm soft" id="pr-save">Log promo</button>
        <div class="row wrap" style="gap:8px;margin-top:10px"><button type="button" class="btn sm soft" id="rl-save">↻ I relisted it today</button></div>
        <label class="field" style="margin-top:10px"><span>Next review</span><input id="rv-date" type="date" value="${due ? new Date(due).toISOString().slice(0, 10) : ""}"></label>
        <div class="row wrap" style="gap:8px"><button type="button" class="btn sm soft" id="rv-save">Save review date</button><button type="button" class="btn sm soft" id="rv-remind">⏰ Remind me that day</button></div></div>
      <div class="card"><h3>Batch</h3><select id="st-batch"><option value="">None</option>${batchesList.map(b => `<option value="${esc(b.id)}" ${item.batchId === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
      <div class="card" id="hist-card"><h3>History</h3><p class="small"><b>Outcome:</b> ${esc(outcome(item))}</p>
        <ul class="timeline" id="st-history">${itemHistory(item, batchesList).map(e => `<li><span class="tiny muted">${esc(new Date(e.at).toLocaleDateString())}</span> ${esc(e.text)}</li>`).join("")}</ul></div>`;
    wire();
    if (focus === "offer") { const a = el.querySelector("#of-amt"); el.querySelector("#offer-card").scrollIntoView(); a && a.focus(); focus = ""; }
  };
  const save = async next => { await ctx.save(next); Object.assign(item, withBiz(ctx.items.find(i => i.id === id) || next)); };
  const wire = () => {
    el.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { mode = b.dataset.mode; draw(); }));
    const ap = el.querySelector("#st-apply");
    if (ap) ap.addEventListener("click", async () => {
      const per = {}; el.querySelectorAll(".st-site").forEach(i => { const m = money(i.value); if (m != null) per[i.dataset.site] = m; });
      const plan = { ...planStrategy(item, mode, {}), target: money(el.querySelector("#st-target").value), minOffer: money(el.querySelector("#st-min").value), perSite: per };
      await save(applyStrategy(item, plan));
      // copy site prices into her listings so the price fields match
      const L = { ...(item.listings || {}) }; for (const s of BIZ_SITES) if (L[s] && per[s] != null) L[s] = { ...L[s], price: String(per[s]) };
      await save({ ...item, listings: L, askingPrice: per.depop ?? plan.target });
      const r = noteDecision(decisions, { topic: "Pricing strategy", value: STRATEGIES[mode].label, itemId: id });
      await B.setDecisions(r.decisions); decisions.splice(0, decisions.length, ...r.decisions);
      const mn = noteDecision(decisions, { topic: "Lowest OK offer (% of target)", value: plan.target ? Math.round((plan.minOffer / plan.target) * 100) + "%" : "", itemId: id });
      await B.setDecisions(mn.decisions); decisions.splice(0, decisions.length, ...mn.decisions);
      draw();
      const ch = r.changed || mn.changed;
      if (ch) {
        el.querySelector("#st-mind").innerHTML = `💭 You usually pick <b>${esc(ch.from)}</b>, and this time chose <b>${esc(ch.to)}</b>. <button type="button" class="btn small soft" id="st-newdefault">Make it my new usual</button>`;
        el.querySelector("#st-newdefault").addEventListener("click", async () => { await B.addFact("Changed her mind: now prefers " + ch.to + " (" + (r.changed ? "pricing strategy" : "lowest OK offer") + "), used to pick " + ch.from); toast("Kris will remember that."); });
      } else toast("Plan saved.");
    });
    el.querySelector("#of-check").addEventListener("click", () => {
      const amt = el.querySelector("#of-amt").value, site = el.querySelector("#of-site").value;
      const r = reviewOffer(item, amt, site);
      const word = { accept: "✅ Accept", counter: "↩️ Counter", decline: "✋ Pass" }[r.verdict];
      el.querySelector("#of-out").innerHTML = `<div class="card flat" id="of-verdict" data-verdict="${r.verdict}"><h3>${word}${r.counter != null ? " at " + usd(r.counter) : ""}</h3><p class="small">${esc(r.reason)}</p>
        <p class="tiny muted">At ${usd(money(amt))} on ${esc(siteName(site))}: fee ${usd(r.fee)}, you keep ${usd(r.keep)}, profit ${usd(r.profit)}. Target ${usd(r.target)}, lowest OK ${usd(r.min)}.</p>
        <div class="row wrap" style="gap:8px"><button type="button" class="btn sm" data-dec="accepted">I accepted</button><button type="button" class="btn sm soft" data-dec="countered">I countered${r.counter != null ? " " + usd(r.counter) : ""}</button><button type="button" class="btn sm soft" data-dec="declined">I passed</button><button type="button" class="btn sm soft" data-dec="pending">Decide later</button></div></div>`;
      el.querySelectorAll("[data-dec]").forEach(b => b.addEventListener("click", async () => {
        const dec = b.dataset.dec;
        let next = logOffer(item, { amount: amt, site, decision: dec, counter: dec === "countered" ? r.counter : null });
        if (dec === "accepted" && !item.soldAt && await confirmSheet({ title: "Mark it sold?", body: `Sold for ${usd(money(amt))} on ${siteName(site)}. This starts the take-down checklist for the other sites.`, ok: "Yes, mark sold", cancel: "Not yet" })) {
          next = markSold(next, { siteId: site, salePrice: money(amt) }); await save(next); if (ctx.onSold) ctx.onSold(next);
        } else await save(next);
        const d = noteDecision(decisions, { topic: "Offers at " + (r.verdict === "accept" ? "or above lowest OK" : "below lowest OK"), value: dec, itemId: id });
        await B.setDecisions(d.decisions);
        toast("Offer saved to the history."); draw();
      }));
    });
    el.querySelector("#pc-save").addEventListener("click", async () => { const to = money(el.querySelector("#pc-to").value); if (to == null) { toast("Type the new price."); return; } await save(recordPriceChange(item, item.askingPrice, to, { site: el.querySelector("#pc-site").value, reason: "her change" })); toast("Price change saved."); draw(); });
    el.querySelector("#pr-save").addEventListener("click", async () => { await save(logPromo(item, { kind: el.querySelector("#pr-kind").value, percent: el.querySelector("#pr-pct").value })); toast("Promo saved."); draw(); });
    el.querySelector("#rl-save").addEventListener("click", async () => { await save(logRelist(item, "")); toast("Relist saved. Next review set."); draw(); });
    el.querySelector("#rv-save").addEventListener("click", async () => { const v = el.querySelector("#rv-date").value; if (!v) return; const [y, m, d] = v.split("-").map(Number); await save(setReview(item, Date.now(), new Date(y, m - 1, d, 10).getTime())); toast("Review date saved."); draw(); });
    el.querySelector("#rv-remind").addEventListener("click", async () => { const v = el.querySelector("#rv-date").value; if (!v) { toast("Pick a date first."); return; } const r = await krisCore().addReminder({ at: v + "T10:00", text: "Review the listing: " + (item.sku ? item.sku + " " : "") + (item.title || "") }); toast(r ? "Reminder set for 10 AM that day (while the app is open). The calendar file is the sure alarm." : "Couldn’t set that reminder."); });
    el.querySelector("#st-batch").addEventListener("change", async e => { await save(addEvent({ ...item, batchId: e.target.value || null }, "source", e.target.value ? "Added to a batch" : "Removed from batch")); toast("Saved."); });
  };
  draw();
}
