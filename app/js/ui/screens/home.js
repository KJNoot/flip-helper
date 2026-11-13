import { esc, thumb, honesty, pill } from "../dom.js";
import { monthTotals, needsDelistHighlight, statusLine, formatUsd, pendingDelist, siteName } from "../../core/inventory.js";
import { delistCountdown, badgeCount } from "../../core/protect.js";
import { suggestionsForAll } from "../../core/drops.js";
import { getSettings, PAUSE_NOTE_ON } from "../../core/settings.js";
import { yearTotals } from "../../core/taxes.js";
import { getTrips } from "../../core/settings.js";
import { morningList } from "../../core/morning.js";

export function renderHome(ctx, el) {
  const items = ctx.items;
  const totals = monthTotals(items);
  const settings = getSettings();
  const morning = morningList(items, { dropDays: settings.dropAfterDays });
  const alerts = morning.stillLive;
  const recent = items.slice(0, 8);
  const monthLabel = monthTitle(totals.month);
  const drops = suggestionsForAll(items, { days: settings.dropAfterDays, defaultFloor: settings.defaultProfitFloor });
  const year = new Date().getFullYear();
  const ytot = yearTotals(items, getTrips(), year);
  const paused = settings.pauseAutomation;
  el.innerHTML = `
    <div class="hero">
      <p class="hero-brand"><span class="wordmark-script">Jessika’s</span><span class="wordmark-bold">Flip Side</span></p>
      <h1>Take a photo. Get a draft. Keep track.</h1>
      <p class="muted">A pocket helper for listing the same item on more than one site.</p>
      <div class="hero-actions">
        <a class="btn" href="#/add" data-cta="add">📷 Add an item</a>
        <a class="btn hero-secondary" href="#/scan" data-cta="scan">🔎 Buy or pass</a>
      </div>
    </div>
    ${paused ? `<div class="card alert" id="pause-banner">
      <div class="row between"><h3>Automation is paused</h3>${honesty("warn", "Paused")}</div>
      <p class="small">${esc(PAUSE_NOTE_ON)}</p>
      <a class="btn soft sm" href="#/settings">Turn it back on in Settings</a>
    </div>` : ""}
    <div class="stats">
      <div class="card stat"><span class="tiny muted">Listed ${esc(monthLabel)}</span><b>${totals.listed}</b></div>
      <div class="card stat"><span class="tiny muted">Sold ${esc(monthLabel)}</span><b>${totals.sold}</b></div>
      <div class="card stat"><span class="tiny muted">Profit ${esc(monthLabel)}</span><b>${esc(formatUsd(totals.profit))}</b></div>
    </div>
    ${morning.empty ? "" : morningCard(morning, settings)}
    ${alerts.length && !morning.stillLive ? "" : ""}
    ${drops.length && !morning.needsDecision.some(d => d.kind === "drop") ? "" : ""}
    ${drops.length ? `<div class="card" id="drop-alerts">
      <div class="row between"><h3>Price-drop ideas</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">Listings that have been up a while. Open an item to approve a drop or to send offers. A drop will not go below your profit floor. You'll still change it on the site yourself.</p>
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
      <p class="small">${honesty("ok", "Working")} Photo to a draft, Buy or pass, a tracker, a sold take-down checklist with a guided walk-through, price-drop ideas, profit and taxes, a morning list, and an Ask-a-question helper.</p>
      <p class="small">${honesty("warn", "Estimate")} AI prices, sold-price estimates, fees, shipping costs, and Buy or pass verdicts. Check them yourself.</p>
      <p class="small">${honesty("warn", "Needs you to post")} You copy the listing and post it in each site's own app. Taking it down and changing a price is a checklist, not automatic. A guided walk-through can open each site for you.</p>
      <p class="small">${honesty("later", "Coming later")} Official one-tap listing and take-down (starting with eBay), official eBay sold prices, a computer helper, and buying shipping labels.</p>
    </div>
  `;
}

function morningCard(morning, settings) {
  const ship = morning.mustShip;
  const live = morning.stillLive;
  const decide = morning.needsDecision;
  return `<div class="card" id="morning">
    <div class="row between"><h3>This morning</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">What must ship, what's still live after a sale, and what needs a decision.</p>
    ${live.length ? `<div class="card alert loud" id="delist-alerts" style="margin:10px 0 0;box-shadow:none">
      <div class="row between"><h3>Take these down — don't let them sell twice</h3>${honesty("ok", "Working")}</div>
      <p class="small">Sold, but still listed on other sites. A checklist with a countdown and reminders, not automatic. This cannot promise that a double sale is impossible.</p>
      <ul class="itemlist">${live.map(i => alertRow(i, settings)).join("")}</ul>
    </div>` : ""}
    ${ship.length ? `<div style="margin-top:12px">
      <h4>Must ship</h4>
      <ul class="itemlist">${ship.map(i => `<li>
        <a class="li" href="#/item/${esc(i.id)}">${thumb(i)}<span class="grow"><b class="clamp2">${esc(i.title || "Untitled item")}</b>
          <span class="tiny muted">${i.binLocation ? "Bin " + esc(i.binLocation) + " · " : ""}Pack and ship</span></span></a>
      </li>`).join("")}</ul>
    </div>` : ""}
    ${decide.length ? `<div style="margin-top:12px">
      <h4>Needs a decision</h4>
      <ul class="itemlist">${decide.map(d => `<li>
        <a class="li" href="#/item/${esc(d.itemId)}"><span class="grow"><b class="clamp2">${esc(d.title)}</b>
          <span class="tiny muted">${esc(d.label)}</span></span></a>
      </li>`).join("")}</ul>
    </div>` : ""}
  </div>`;
}

function alertRow(item, settings) {
  const c = delistCountdown(item);
  const pending = pendingDelist(item);
  const paused = settings && settings.pauseAutomation;
  return `<li>
    <div class="li alert" style="flex-wrap:wrap">
      <a href="#/item/${esc(item.id)}" style="display:flex;gap:12px;align-items:center;flex:1;text-decoration:none;color:inherit;min-width:0">
        ${thumb(item)}
        <span class="grow">
          <b class="clamp2">${esc(item.title || "Untitled item")}</b>
          <span class="tiny attn">${c ? esc(c.headline) : "Take it down"}</span>
          <span class="tiny muted">${esc("Still up on " + pending.map(siteName).join(", "))}</span>
        </span>
      </a>
      ${paused ? "" : `<a class="btn sm btn-main" href="#/item/${esc(item.id)}/takedown" style="width:100%;margin-top:8px">Take them all down automatically</a>`}
    </div>
  </li>`;
}

function dropRows(drops) {
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
  const bin = item.binLocation ? `<span class="tiny muted"> · Bin ${esc(item.binLocation)}</span>` : "";
  return `<li>
    <a class="li ${alert ? "alert" : ""}" href="#/item/${esc(item.id)}">
      ${thumb(item)}
      <span class="grow">
        <b class="clamp2">${esc(item.title || "Untitled item")}</b>
        <span class="tiny muted">${extra}${bin}</span>
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
