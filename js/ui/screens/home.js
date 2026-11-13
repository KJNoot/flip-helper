import { esc, thumb, honesty, pill } from "../dom.js";
import { monthTotals, needsDelistHighlight, statusLine, formatUsd, pendingDelist, siteName } from "../../core/inventory.js";

export function renderHome(ctx, el) {
  const items = ctx.items;
  const totals = monthTotals(items);
  const alerts = items.filter(needsDelistHighlight);
  const recent = items.slice(0, 8);
  const monthLabel = monthTitle(totals.month);
  el.innerHTML = `
    <div class="hero">
      <p class="eyebrow">Flip Helper</p>
      <h1>Take a photo. Get a draft. Keep track.</h1>
      <p class="muted">A pocket helper for listing the same item on more than one site.</p>
      <a class="btn" href="#/add" data-cta="add">📷 Add an item</a>
    </div>
    <div class="stats">
      <div class="card stat"><span class="tiny muted">Listed ${esc(monthLabel)}</span><b>${totals.listed}</b></div>
      <div class="card stat"><span class="tiny muted">Sold ${esc(monthLabel)}</span><b>${totals.sold}</b></div>
      <div class="card stat"><span class="tiny muted">Profit ${esc(monthLabel)}</span><b>${esc(formatUsd(totals.profit))}</b></div>
    </div>
    ${alerts.length ? `<div class="card alert" id="delist-alerts">
      <h3>Take these down</h3>
      <p class="small">Sold, but still listed on other sites. This is a checklist, not automatic.</p>
      <ul class="itemlist">${alerts.map(row).join("")}</ul>
    </div>` : ""}
    <div class="section-title"><h3>Your items</h3><a href="#/items">See all</a></div>
    ${recent.length
      ? `<ul class="itemlist">${recent.map(row).join("")}</ul>`
      : `<div class="card empty"><span class="em">📷</span><p>No items yet. Take a photo to start a draft.</p></div>`}
    <div class="card flat honesty-card">
      <h3>What this version does</h3>
      <p class="small">${honesty("ok", "Working")} Photo to a draft, your approval, a tracker, and a sold checklist.</p>
      <p class="small">${honesty("warn", "Needs you to post")} You copy the listing and post it in each site's own app. Taking it down is a checklist, not automatic.</p>
      <p class="small">${honesty("later", "Coming later")} Official one-tap listing, starting with eBay, if and when that's set up.</p>
    </div>
  `;
}

function row(item) {
  const alert = needsDelistHighlight(item);
  const pending = pendingDelist(item);
  const extra = alert ? `<span class="pill pill-warn">Take it down${pending.length ? " · " + pending.map(siteName).join(", ") : ""}</span>` : pill(statusLine(item), item.stage);
  return `<li>
    <a class="li ${alert ? "alert" : ""}" href="#/item/${esc(item.id)}">
      ${thumb(item)}
      <span class="grow">
        <b class="clamp2">${esc(item.title || "Untitled item")}</b>
        <span class="tiny muted">${extra}</span>
      </span>
      <span class="tiny muted price">${item.stage === "sold" || item.stage === "shipped" ? esc(formatUsd(item.salePrice)) : esc(item.askingPrice != null ? formatUsd(item.askingPrice) : "")}</span>
    </a>
  </li>`;
}

function monthTitle(key) {
  const [y, m] = String(key).split("-").map(Number);
  try {
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short" });
  } catch (e) { return "this month"; }
}
