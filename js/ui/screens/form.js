// Shared item-field form used on the add-review and item screens.
import { esc, $, honesty } from "../dom.js";
import { SITES, searchQuery, siteName, siteById } from "../../core/sites.js";
import { priceRangeLabel, formatUsd, hasAdvice, planSiteIds, SITE_PLAN_LABELS } from "../../core/inventory.js";
import { getEnabledIds } from "../../core/prefs.js";

function tweakBlock(s, tweaks) {
  const t = tweaks[s.id] || {};
  return `<details class="tweak" data-site="${esc(s.id)}">
    <summary>${esc(s.name)}</summary>
    ${s.note ? `<p class="tiny muted">${esc(s.note)}</p>` : ""}
    <label class="field"><span>Title for ${esc(s.name)}</span><input data-tw="title" value="${esc(t.title || "")}" maxlength="120" placeholder="Leave blank to use the main title"></label>
    <label class="field"><span>Description for ${esc(s.name)}</span><textarea data-tw="description" rows="3" placeholder="Leave blank to use the main description">${esc(t.description || "")}</textarea></label>
    <label class="field"><span>Notes for you (not copied unless you leave them in)</span><textarea data-tw="notes" rows="2" placeholder="e.g. category, size, hashtags">${esc(t.notes || "")}</textarea></label>
  </details>`;
}

export function fieldsHtml(item, { prefix = "", enabledIds, hideSearch = false } = {}) {
  const p = prefix;
  const tweaks = item.siteTweaks || {};
  const enabled = enabledIds || getEnabledIds();
  const enabledSet = new Set(enabled);
  const primary = SITES.filter(s => enabledSet.has(s.id));
  const rest = SITES.filter(s => !enabledSet.has(s.id));
  const sites = primary.map(s => tweakBlock(s, tweaks)).join("") +
    (rest.length ? `<details class="tweak more"><summary>More sites</summary>${rest.map(s => tweakBlock(s, tweaks)).join("")}</details>` : "");
  const range = priceRangeLabel(item);
  return `
    <label class="field"><span>Title</span><input id="${p}title" maxlength="120" value="${esc(item.title)}" placeholder="What is it?"></label>
    <label class="field"><span>Description</span><textarea id="${p}desc" rows="5" maxlength="4000" placeholder="A short, honest description">${esc(item.description)}</textarea></label>
    <div class="grid2">
      <label class="field"><span>Category</span><input id="${p}category" maxlength="60" value="${esc(item.category)}" placeholder="e.g. Women's shoes"></label>
      <label class="field"><span>Brand</span><input id="${p}brand" maxlength="60" value="${esc(item.brand)}" placeholder="If you know it"></label>
    </div>
    <label class="field"><span>Condition</span><input id="${p}condition" maxlength="60" value="${esc(item.condition)}" placeholder="e.g. Good, Like new" list="${p}conds"></label>
    <datalist id="${p}conds">
      <option value="New with tags"><option value="New without tags"><option value="Like new">
      <option value="Good"><option value="Fair"><option value="Poor">
    </datalist>
    <div class="grid2">
      <label class="field"><span>What you paid</span><input id="${p}cost" type="text" inputmode="decimal" value="${esc(item.costPaid ?? "")}" placeholder="e.g. 8.00"></label>
      <label class="field"><span>Your asking price</span><input id="${p}asking" type="text" inputmode="decimal" value="${esc(item.askingPrice ?? "")}" placeholder="e.g. 24.00"></label>
    </div>
    <div class="estimate">
      <div class="row between"><strong>Suggested price</strong><span class="honesty warn">AI estimate</span></div>
      <p class="big-num">${range ? esc(range) : "—"}</p>
      <p class="small">${item.priceReason ? esc(item.priceReason) : "No estimate yet."}</p>
      <p class="tiny muted">This is an AI estimate from the photo. It was not checked against real sold listings. Please look at sold prices and change anything that's wrong.</p>
      <div class="grid2" style="margin-top:8px">
        <label class="field"><span>Low</span><input id="${p}plow" type="text" inputmode="decimal" value="${esc(item.priceLow ?? "")}"></label>
        <label class="field"><span>High</span><input id="${p}phigh" type="text" inputmode="decimal" value="${esc(item.priceHigh ?? "")}"></label>
      </div>
      <label class="field"><span>Why this range</span><textarea id="${p}preason" rows="2">${esc(item.priceReason)}</textarea></label>
      ${hideSearch ? "" : searchLinks(item, enabled)}
    </div>
    <label class="field"><span>Your notes</span><textarea id="${p}notes" rows="2" placeholder="Anything you want to remember">${esc(item.notes)}</textarea></label>
    <h3 class="section-kicker">Per-site tweaks</h3>
    <p class="tiny muted">Optional. Change the title or description for a site, or leave a note for yourself.</p>
    <div id="${p}tweaks">${sites}</div>
  `;
}

export function searchLinks(item, enabledIds) {
  const q = searchQuery(item);
  if (!q) return `<p class="tiny muted">Add a title to get sold-price search links.</p>`;
  const enabled = new Set(enabledIds || getEnabledIds());
  const list = [...SITES.filter(s => enabled.has(s.id)), ...SITES.filter(s => !enabled.has(s.id))];
  const links = list.map(s => `<a class="chiplink" href="${esc(s.soldSearch(q))}" target="_blank" rel="noopener">${esc(s.short || s.name)}</a>`).join("");
  return `<div class="searchlinks"><span class="tiny muted">Check real sold prices:</span><div class="row wrap">${links}</div></div>`;
}

export function adviceHtml(item) {
  if (!hasAdvice(item)) return "";
  const a = item.siteAdvice;
  const plan = item.sitePlan || "own";
  const chips = ids => (ids || []).map(id => `<span class="pill pill-listed">${esc(siteName(id))}</span>`).join(" ");
  const block = (title, data, planId) => {
    if (!data || !(data.sites || []).length) return "";
    const on = plan === planId;
    return `<div class="advice-block">
      <div class="row between"><h4>${esc(title)}</h4>${honesty("warn", "AI estimate")}</div>
      <div class="row wrap" style="margin:6px 0">${chips(data.sites)}</div>
      <p class="small">${data.reason ? esc(data.reason) : "No reason given."}</p>
      <button type="button" class="btn sm ${on ? "" : "soft"}" data-act="plan" data-plan="${esc(planId)}">${on ? "Using these sites" : "Use these sites"}</button>
    </div>`;
  };
  const planned = planSiteIds(item, plan);
  const bothOn = plan === "both";
  const ownOn = plan === "own";
  return `<div class="card advice" id="advice">
    <h3>Where to list it</h3>
    <p class="tiny muted">These are rough AI estimates from the photo, not from checking live listings or how fast things actually sell. You choose where to post.</p>
    ${block("Best price", a.bestPrice, "bestPrice")}
    ${block("Fastest sale", a.fastestSale, "fastestSale")}
    <div class="planbtns">
      <button type="button" class="btn sm ${bothOn ? "" : "soft"}" data-act="plan" data-plan="both">${bothOn ? "Using both" : "Both"}</button>
      <button type="button" class="btn sm ${ownOn ? "" : "soft"}" data-act="plan" data-plan="own">${ownOn ? "Picking my own" : "Pick my own"}</button>
    </div>
    ${!ownOn && planned.length ? `<p class="small" id="plan-summary">You'll post on: <b>${esc(planned.map(siteName).join(", "))}</b>. You can still tick other sites below.</p>` : `<p class="small muted" id="plan-summary">Pick any of your sites below.</p>`}
  </div>`;
}

export function readFields(el, prefix = "") {
  const p = prefix;
  const val = id => { const n = $(`#${p}${id}`, el); return n ? n.value : ""; };
  const siteTweaks = {};
  el.querySelectorAll(`#${p}tweaks details[data-site]`).forEach(d => {
    const id = d.dataset.site;
    const get = k => { const n = d.querySelector(`[data-tw="${k}"]`); return n ? n.value.trim() : ""; };
    const t = { title: get("title"), description: get("description"), notes: get("notes") };
    if (t.title || t.description || t.notes) siteTweaks[id] = t;
  });
  return {
    title: val("title").trim(),
    description: val("desc"),
    category: val("category").trim(),
    brand: val("brand").trim(),
    condition: val("condition").trim(),
    costPaid: val("cost"),
    askingPrice: val("asking"),
    priceLow: val("plow"),
    priceHigh: val("phigh"),
    priceReason: val("preason").trim(),
    notes: val("notes"),
    siteTweaks
  };
}

export { formatUsd, siteById };
