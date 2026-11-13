import { esc, thumb, honesty, pill } from "../dom.js";
import { monthTotals, needsDelistHighlight, statusLine, formatUsd, pendingDelist, siteName } from "../../core/inventory.js";
import { delistCountdown, badgeCount } from "../../core/protect.js";
import { suggestionsForAll } from "../../core/drops.js";
import { getSettings } from "../../core/settings.js";
import { yearTotals } from "../../core/taxes.js";
import { getTrips } from "../../core/settings.js";

export function renderHome(ctx, el) {
  const items = ctx.items;
  const totals = monthTotals(items);
  const alerts = items.filter(needsDelistHighlight)
    .sort((a, b) => (a.soldAt || 0) - (b.soldAt || 0));
  const recent = items.slice(0, 8);
  const monthLabel = monthTitle(totals.month);
  const drops = suggestionsForAll(items, { days: getSettings().dropAfterDays });
  const year = new Date().getFullYear();
  const ytot = yearTotals(items, getTrips(), year);
  el.innerHTML = `
    <div class="hero">
      <p class="eyebrow">Flip Helper</p>
      <h1>Take a photo. Get a draft. Keep track.</h1>
      <p class="muted">A pocket helper for listing the same item on more than one site.</p>
      <div class="hero-actions">
        <a class="btn" href="#/add" data-cta="add">📷 Add an item</a>
        <a class="btn hero-secondary" href="#/scan" data-cta="scan">🔎 Buy or pass</a>
      </div>
    </div>
    <div class="stats">
      <div class="card stat"><span class="tiny muted">Listed ${esc(monthLabel)}</span><b>${totals.listed}</b></div>
      <div class="card stat"><span class="tiny muted">Sold ${esc(monthLabel)}</span><b>${totals.sold}</b></div>
      <div class="card stat"><span class="tiny muted">Profit ${esc(monthLabel)}</span><b>${esc(formatUsd(totals.profit))}</b></div>
    </div>
    ${alerts.length ? `<div class="card alert loud" id="delist-alerts">
      <div class="row between"><h3>Take these down — don't let them sell twice</h3>${honesty("ok", "Working")}</div>
      <p class="small">Sold, but still listed on other sites. A checklist with a countdown and reminders, not automatic.</p>
      <ul class="itemlist">${alerts.map(alertRow).join("")}</ul>
    </div>` : ""}
    ${drops.length ? `<div class="card" id="drop-alerts">
      <div class="row between"><h3>Price-drop ideas</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">Listings that have been up a while. Open an item to approve a drop or to send offers. You'll still change it on the site yourself.</p>
      <ul class="itemlist">${dropRows(drops).join("")}</ul>
    </div>` : ""}
    <div class="section-title"><h3>Your items</h3><a href="#/items">See all</a></div>
    ${recent.length
      ? `<ul class="itemlist">${recent.map(row).join("")}</ul>`
      : `<div class="card empty"><span class="em">📷</span><p>No items yet. Take a photo to start a draft, or use Buy or pass at a thrift store.</p></div>`}
    <div class="card flat">
      <div class="row between"><h3>${esc(String(year))} taxes</h3>${honesty("ok", "Working")}</div>
      <p class="small">Income ${esc(formatUsd(ytot.income))} · after cost, fees, and shipping ${esc(formatUsd(ytot.goodsProfit))} · ${esc(String(ytot.miles))} miles logged.</p>
      <p class="tiny muted">Not tax advice.</p>
      <a class="btn soft" href="#/taxes">Open the year view</a>
    </div>
    <div class="card flat honesty-card">
      <h3>What this version does</h3>
      <p class="small">${honesty("ok", "Working")} Photo to a draft, Buy or pass, a tracker, a sold take-down checklist with reminders, price-drop ideas, basic photo clean-up, and a tax year view.</p>
      <p class="small">${honesty("warn", "Estimate")} AI prices, sold-price estimates, fees, shipping costs, and Buy or pass verdicts. Check them yourself.</p>
      <p class="small">${honesty("warn", "Needs you to post")} You copy the listing and post it in each site's own app. Taking it down and changing a price is a checklist, not automatic.</p>
      <p class="small">${honesty("later", "Coming later")} Official one-tap listing and take-down (starting with eBay), official eBay sold prices, a computer helper, and buying shipping labels.</p>
    </div>
  `;
}

function alertRow(item) {
  const c = delistCountdown(item);
  const pending = pendingDelist(item);
  return `<li>
    <a class="li alert" href="#/item/${esc(item.id)}">
      ${thumb(item)}
      <span class="grow">
        <b class="clamp2">${esc(item.title || "Untitled item")}</b>
        <span class="tiny attn">${c ? esc(c.headline) : "Take it down"}</span>
        <span class="tiny muted">${esc("Still up on " + pending.map(siteName).join(", "))}</span>
      </span>
    </a>
  </li>`;
}

function dropRows(drops) {
  // One row per item, not per site.
  const byItem = new Map();
  for (const d of drops) {
    if (!byItem.has(d.itemId)) byItem.set(d.itemId, { ...d, sites: [d.siteName] });
    else byItem.get(d.itemId).sites.push(d.siteName);
  }
  return [...byItem.values()].map(d => `<li>
    <a class="li" href="#/item/${esc(d.itemId)}">
      <span class="grow">
        <b class="clamp2">${esc(d.title || "Untitled item")}</b>
        <span class="tiny muted">Listed ${esc(String(d.daysListed))} days · ${esc(formatUsd(d.fromPrice))} → ${esc(formatUsd(d.toPrice))} · ${esc(d.sites.join(", "))}</span>
      </span>
    </a>
  </li>`);
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

export { badgeCount };
