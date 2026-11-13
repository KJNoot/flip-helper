// Buy-or-pass scanner: a quick camera for thrift stores and garage sales.
import { esc, $, toast, bind, honesty, pill } from "../dom.js";
import { photoFromFile, requestScan, MAX_PHOTOS } from "../../core/draft.js";
import { hasKey } from "../../core/key.js";
import { getEnabledIds } from "../../core/prefs.js";
import { normalizeScanDraft, scanResult, itemFromScan, VERDICT_LABELS } from "../../core/scanner.js";
import { heuristicShip, boxSizeLabel, SHIP_TABLE_NOTE } from "../../core/shipping.js";
import { FEE_TABLE_NOTE } from "../../core/fees.js";
import { formatUsd as usd, money } from "../../core/inventory.js";
import { alreadyOwnedMatches, alreadyOwnedWarning } from "../../core/match.js";
import { getSettings } from "../../core/settings.js";
import { buyUpToLabel } from "../../core/profit.js";
import { tip, openTip } from "../tips.js";

function emptyWork() {
  return {
    photos: [], asking: "", notes: "", busy: false, error: "", draft: null, result: null,
    assumptions: { resale: "", fees: "", shipping: "", desiredProfit: "" }
  };
}

export function renderScan(ctx, el) {
  if (!ctx.scanWork) ctx.scanWork = emptyWork();
  paint(ctx, el);
}

function paint(ctx, el) {
  const w = ctx.scanWork;
  const photos = w.photos || [];
  const result = w.result;
  const draft = w.draft;
  const matches = draft && draft.title ? alreadyOwnedMatches(ctx.items, draft.title) : [];
  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>Buy or pass</h2><span class="spacer48"></span></div>
    <div class="card">
      <div class="row between"><h3>Quick check</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">Take a photo at a thrift store or garage sale. The app identifies the item, estimates what it might resell for, subtracts approximate fees and shipping, and gives a Buy, Maybe, or Pass guide — and a “Buy up to” amount. Prices and fees are estimates.</p>
      <div class="photos" id="photos">
        ${photos.map((p, i) => `<div class="photo">
          <img src="${esc(p.dataUrl)}" alt="Photo ${i + 1}">
          <button type="button" class="iconbtn sm" data-act="delphoto" data-i="${i}" aria-label="Remove photo">×</button>
        </div>`).join("")}
        ${photos.length < MAX_PHOTOS ? `
          <label class="photo add">
            <input id="cam" type="file" accept="image/*" capture="environment" hidden>
            <span>📷 Take</span>
          </label>
          <label class="photo add">
            <input id="lib" type="file" accept="image/*" multiple hidden>
            <span>🖼 Choose</span>
          </label>` : ""}
      </div>
      <label class="field"><span>What are they asking?</span>
        <input id="asking" type="text" inputmode="decimal" value="${esc(w.asking)}" placeholder="0.00">
      </label>
      <label class="field"><span>Anything to know (optional)</span>
        <textarea id="notes" rows="2" placeholder="Brand, size, flaws">${esc(w.notes || "")}</textarea>
      </label>
      <button type="button" class="btn btn-main" data-act="check" ${w.busy ? "disabled" : ""}>${w.busy ? "Looking at your photo…" : "✨ Identify and check"}</button>
      ${!hasKey() ? `<p class="tiny muted" style="margin-top:10px">To identify from a photo, paste the AI key in <a href="#/settings">Settings</a> first. You can still enter a price and see fee math after a draft is saved.</p>` : ""}
      ${w.error ? `<p class="attn" id="scan-error">${esc(w.error)}</p>` : ""}
    </div>
    ${matches.length ? `<div class="card alert" id="already-own"><p class="small">${esc(alreadyOwnedWarning(matches))}</p>
      <ul class="itemlist">${matches.map(m => `<li><a class="li" href="#/item/${esc(m.id)}"><span class="grow"><b>${esc(m.title)}</b></span></a></li>`).join("")}</ul>
    </div>` : ""}
    ${draft || result ? resultsBlock(w) : ""}
  `;

  const onFiles = async (input) => {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    try {
      for (const f of files) {
        if ((ctx.scanWork.photos || []).length >= MAX_PHOTOS) break;
        const photo = await photoFromFile(f);
        ctx.scanWork.photos = [...(ctx.scanWork.photos || []), photo];
      }
      paint(ctx, el);
    } catch (e) { toast(e.message || "That photo couldn't be used."); }
  };
  const cam = $("#cam", el), lib = $("#lib", el);
  if (cam) cam.addEventListener("change", () => onFiles(cam));
  if (lib) lib.addEventListener("change", () => onFiles(lib));
  const asking = $("#asking", el);
  if (asking) asking.addEventListener("input", () => {
    ctx.scanWork.asking = asking.value;
    if (ctx.scanWork.draft) recompute(ctx, el, false);
  });
  const notes = $("#notes", el);
  if (notes) notes.addEventListener("input", () => { ctx.scanWork.notes = notes.value; });
  ["assume-resale", "assume-fees", "assume-ship", "assume-profit"].forEach(id => {
    const n = $("#" + id, el);
    if (n) n.addEventListener("input", () => {
      const a = ctx.scanWork.assumptions || (ctx.scanWork.assumptions = {});
      if (id === "assume-resale") a.resale = n.value;
      if (id === "assume-fees") a.fees = n.value;
      if (id === "assume-ship") a.shipping = n.value;
      if (id === "assume-profit") a.desiredProfit = n.value;
      if (ctx.scanWork.draft) recompute(ctx, el, false);
    });
  });

  bind(el, {
    tip: b => openTip(b.dataset.tip || ""),
    delphoto: b => {
      ctx.scanWork.photos = (ctx.scanWork.photos || []).filter((_, n) => n !== +b.dataset.i);
      paint(ctx, el);
    },
    check: async () => {
      sync(ctx, el);
      if (!(ctx.scanWork.photos || []).length) { toast("Take a photo first"); return; }
      if (!hasKey()) { toast("Paste the AI key in Settings first"); ctx.go("#/settings"); return; }
      ctx.scanWork.busy = true; ctx.scanWork.error = ""; paint(ctx, el);
      try {
        const { json } = await requestScan({
          photos: ctx.scanWork.photos,
          notes: ctx.scanWork.notes,
          asking: ctx.scanWork.asking,
          enabledSites: getEnabledIds()
        });
        ctx.scanWork.draft = normalizeScanDraft(json);
        ctx.scanWork.assumptions = { resale: "", fees: "", shipping: "", desiredProfit: "" };
        recompute(ctx, el, true);
        toast("Check ready. Please look it over.");
      } catch (e) {
        ctx.scanWork.busy = false;
        ctx.scanWork.error = e.message || "The check couldn't be made.";
        paint(ctx, el);
      }
    },
    save: async () => {
      sync(ctx, el);
      const item = itemFromScan({
        photos: ctx.scanWork.photos,
        draft: ctx.scanWork.draft,
        asking: money(ctx.scanWork.asking),
        result: ctx.scanWork.result,
        notes: ctx.scanWork.notes
      });
      if (!item.title && !(item.photos || []).length) { toast("Add a photo first"); return; }
      const saved = await ctx.save(item);
      ctx.scanWork = emptyWork();
      toast("Saved to your items");
      ctx.go("#/item/" + saved.id);
    },
    reset: () => {
      ctx.scanWork = emptyWork();
      paint(ctx, el);
    }
  });
}

function sync(ctx, el) {
  const asking = $("#asking", el);
  const notes = $("#notes", el);
  if (asking) ctx.scanWork.asking = asking.value;
  if (notes) ctx.scanWork.notes = notes.value;
  const a = ctx.scanWork.assumptions || (ctx.scanWork.assumptions = {});
  const r = $("#assume-resale", el); if (r) a.resale = r.value;
  const f = $("#assume-fees", el); if (f) a.fees = f.value;
  const s = $("#assume-ship", el); if (s) a.shipping = s.value;
  const p = $("#assume-profit", el); if (p) a.desiredProfit = p.value;
}

function assumptionValues(w) {
  const a = w.assumptions || {};
  const settings = getSettings();
  const d = w.draft;
  const mid = d ? ((money(d.priceLow) != null && money(d.priceHigh) != null)
    ? money(((money(d.priceLow) + money(d.priceHigh)) / 2))
    : (money(d.priceHigh) ?? money(d.priceLow))) : null;
  return {
    resale: money(a.resale) != null ? money(a.resale) : mid,
    fees: money(a.fees),
    shipping: money(a.shipping),
    desiredProfit: money(a.desiredProfit) != null ? money(a.desiredProfit) : settings.desiredProfit
  };
}

function recompute(ctx, el, fullPaint) {
  const d = ctx.scanWork.draft;
  const ask = money(ctx.scanWork.asking);
  const ship = d && d.ship ? d.ship : heuristicShip(d || {});
  const ass = assumptionValues(ctx.scanWork);
  ctx.scanWork.result = d ? scanResult({
    asking: ask,
    resaleLow: d.priceLow,
    resaleHigh: money(ctx.scanWork.assumptions && ctx.scanWork.assumptions.resale) != null
      ? money(ctx.scanWork.assumptions.resale) : d.priceHigh,
    siteIds: getEnabledIds(),
    weightOz: ship.weightOz,
    shippingOverride: ass.shipping,
    desiredProfit: ass.desiredProfit,
    feeOverride: ass.fees
  }) : null;
  // If she edited resale, also pass it as both low and high so mid equals it —
  // already handled if only high is set... midPrice of (low, edited high) isn't equal.
  // Recompute buy-up-to with explicit resale if provided.
  if (ctx.scanWork.result && ass.resale != null) {
    const r = scanResult({
      asking: ask,
      resaleLow: ass.resale,
      resaleHigh: ass.resale,
      siteIds: getEnabledIds(),
      weightOz: ship.weightOz,
      shippingOverride: ass.shipping,
      desiredProfit: ass.desiredProfit,
      feeOverride: ass.fees
    });
    ctx.scanWork.result = { ...ctx.scanWork.result, buyUpTo: r.buyUpTo, buyUpToLabel: r.buyUpToLabel, assumptions: r.assumptions, resaleMid: r.resaleMid };
  }
  ctx.scanWork.busy = false;
  if (fullPaint !== false) paint(ctx, el);
  else if (ctx.scanWork.result) {
    const box = $("#verdict-live", el);
    if (box) box.innerHTML = verdictHtml(ctx.scanWork);
  }
}

function verdictClass(v) {
  return v === "buy" ? "verdict-buy" : v === "pass" ? "verdict-pass" : "verdict-maybe";
}

function resultsBlock(w) {
  const d = w.draft || {};
  const r = w.result;
  const ship = d.ship || heuristicShip(d);
  const ass = assumptionValues(w);
  const settings = getSettings();
  return `
    <div class="card" id="scan-results">
      <div class="row between"><h3>What it looks like</h3>${honesty("warn", "Estimate")}</div>
      <p class="big-num">${esc(d.title || "—")}</p>
      <p class="small">${[d.brand, d.category, d.condition].filter(Boolean).map(esc).join(" · ") || "No details yet."}</p>
      <p class="small">${d.notes ? esc(d.notes) : ""}</p>
      <div class="estimate">
        <div class="row between"><strong>Resale estimate</strong>${honesty("warn", "AI estimate")}</div>
        <p class="big-num">${d.priceLow != null || d.priceHigh != null ? esc((usd(d.priceLow) + " to " + usd(d.priceHigh))) : "—"}</p>
        <p class="small">${d.priceReason ? esc(d.priceReason) : "No estimate yet."}</p>
        <p class="small"><b>How fast:</b> ${esc(d.daysToSell || "—")}${d.speedReason ? " — " + esc(d.speedReason) : ""}</p>
        <p class="tiny muted">This is an AI estimate from the photo, not from checking sold listings.</p>
      </div>
    </div>
    ${r && r.buyUpToLabel ? `<div class="card" id="buy-up-to">
      <div class="row between"><h3>Buy up to</h3>${honesty("warn", "Estimate")} ${tip("Estimated resale, minus approximate fees, shipping, and the profit you want to keep. You can change those numbers below.")}</div>
      <p class="big-num">${esc(r.buyUpToLabel)}</p>
      <p class="small muted">So you still have a chance to keep about ${esc(usd(ass.desiredProfit ?? settings.desiredProfit))} after fees and shipping, if it sells near ${esc(usd((r.assumptions && r.assumptions.resale) || r.resaleMid))}.</p>
      <details class="more-block"><summary>Change the numbers used</summary>
        <div class="grid2">
          <label class="field"><span>Estimated resale</span><input id="assume-resale" inputmode="decimal" value="${esc((w.assumptions && w.assumptions.resale) || "")}" placeholder="${esc(usd(r.resaleMid))}"></label>
          <label class="field"><span>Fees</span><input id="assume-fees" inputmode="decimal" value="${esc((w.assumptions && w.assumptions.fees) || "")}" placeholder="${esc(usd(r.assumptions && r.assumptions.fees))}"></label>
          <label class="field"><span>Shipping</span><input id="assume-ship" inputmode="decimal" value="${esc((w.assumptions && w.assumptions.shipping) || "")}" placeholder="${esc(usd(r.assumptions && r.assumptions.shipping))}"></label>
          <label class="field"><span>Profit you want</span><input id="assume-profit" inputmode="decimal" value="${esc((w.assumptions && w.assumptions.desiredProfit) || "")}" placeholder="${esc(usd(settings.desiredProfit))}"></label>
        </div>
        <p class="tiny muted">These only change the “Buy up to” guide. They are not saved to the item until you tap Save.</p>
      </details>
    </div>` : ""}
    <div id="verdict-live">${r ? verdictHtml(w) : `<div class="card"><p class="muted">Enter what they're asking to see a Buy, Maybe, or Pass guide.</p></div>`}</div>
    <div class="card">
      <div class="row between"><h3>Shipping used in the math</h3>${honesty("warn", "Estimate")}</div>
      <p class="small">${esc(boxSizeLabel(ship))}</p>
      <p class="tiny muted">${esc(ship.reason || "")} ${esc(SHIP_TABLE_NOTE)}</p>
    </div>
    <div class="stack" style="margin-top:14px">
      <button type="button" class="btn btn-main" data-act="save">Save to my items</button>
      <button type="button" class="btn soft" data-act="reset">Check another item</button>
    </div>
  `;
}

function verdictHtml(w) {
  const r = w.result;
  if (!r) return "";
  const v = r.asking == null ? null : r.verdict;
  const head = v
    ? `<div class="verdict ${verdictClass(v)}" id="verdict">
        <div class="row between"><h3>${esc(VERDICT_LABELS[v])}</h3>${honesty("warn", "Estimate")}</div>
        <p class="small">${verdictSentence(r)}</p>
        ${r.buyUpToLabel ? `<p class="small"><b>${esc(r.buyUpToLabel)}</b></p>` : ""}
      </div>`
    : `<div class="card"><p class="muted">Enter what they're asking to see a guide.</p></div>`;
  const rows = (r.rows || []).map(row => `<tr>
    <td>${esc(row.name)}${row.local ? ` <span class="tiny muted">local</span>` : ""}</td>
    <td class="num">${esc(usd(row.feeMid))}</td>
    <td class="num">${esc(usd(row.shipping))}</td>
    <td class="num"><b>${esc(usd(row.netMid))}</b></td>
  </tr>`).join("");
  return `
    ${head}
    <div class="card">
      <div class="row between"><h3>Likely profit, by site</h3>${honesty("warn", "Approximate")}</div>
      <p class="tiny muted">Using a mid resale of ${esc(usd(r.resaleMid))} and an asking price of ${esc(usd(r.asking))}. Fees are approximate, as of November 2026. ${esc(FEE_TABLE_NOTE)}</p>
      <div class="tablewrap"><table class="fee-table">
        <thead><tr><th>Site</th><th>Fees</th><th>Ship</th><th>Profit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="tiny muted">Local pickup sites assume no shipping and, for Facebook and OfferUp, no selling fee. "Profit" is mid resale minus what they're asking, approximate fees, and estimated shipping.</p>
    </div>
  `;
}

function verdictSentence(r) {
  const mid = usd(r.netMid);
  const low = usd(r.netLow);
  const ask = usd(r.asking);
  const site = r.bestSite ? ` Best midpoint is on ${siteNameSafe(r)}.` : "";
  if (r.verdict === "buy") return `Even a careful estimate looks profitable after approximate fees and shipping (about ${low} on the low end, ${mid} at the midpoint). They're asking ${ask}.${site} This is a guide, not a promise.`;
  if (r.verdict === "pass") return `At a mid resale, this looks like a loss or only a tiny gain after approximate fees and shipping (about ${mid}). They're asking ${ask}. This is a guide, not a promise.`;
  return `It could go either way. Midpoint profit is about ${mid}; the low estimate is about ${low}. They're asking ${ask}.${site} This is a guide, not a promise.`;
}

function siteNameSafe(r) {
  const row = (r.rows || []).find(x => x.siteId === r.bestSite);
  return row ? row.name : "";
}

export { buyUpToLabel };
