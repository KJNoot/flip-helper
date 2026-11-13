// HTML for each sandboxed demo step. Events are handled by ui/intro.js
// through [data-act] / [data-sample] / [data-site].
import { esc, honesty } from "./dom.js";
import {
  DEMO_EXPLAIN, PRETEND_POSTED, PRETEND_SOLD, PRETEND_TAKEDOWN, PRETEND_BANNER,
  demoScan, listingRows, takedownRows, soldHeadline, demoProfit, demoShipSuggest,
  demoSourceLabel, SAMPLE_LABEL, SHIP_CHECKS, formatUsd, siteName, SHIP_TABLE_NOTE,
  SAMPLES
} from "../core/demo.js";
import { SITE_STATUS_LABELS } from "../core/sitestatus.js";
import { SITES } from "../core/sites.js";
import { VERDICT_LABELS } from "../core/scanner.js";
import { isStandalone, shouldShowAddToHomeScreen } from "../core/intro.js";

function explain(step) {
  const t = DEMO_EXPLAIN[step] || "";
  return t ? `<p class="demo-explain">${esc(t)}</p>` : "";
}

function banner() {
  return `<p class="demo-banner">${esc(PRETEND_BANNER)}</p>`;
}

function chrome(session, { title, n, of, nextLabel = "Next", nextAct = "next", extra = "", hideNext = false } = {}) {
  const step = session.step;
  return `
    <div class="demo-top">
      <p class="tiny muted">${n ? `${n} of ${of}` : "Demo"}</p>
      <button type="button" class="demo-skip" data-act="skip-demo">Skip to the end</button>
    </div>
    ${banner()}
    <h2 class="demo-title">${esc(title)}</h2>
    ${extra}
    ${explain(step)}
    ${hideNext ? "" : `<div class="stack demo-actions">
      <button type="button" class="btn btn-main" data-act="${esc(nextAct)}">${esc(nextLabel)}</button>
    </div>`}
  `;
}

function photoEl(item) {
  const src = item && item.photos && item.photos[0] && item.photos[0].dataUrl;
  if (!src) return "";
  return `<img class="demo-photo" src="${esc(src)}" alt="">`;
}

const FLOW = ["draft", "scan", "sites", "listing", "sold", "takedown", "pack", "ship", "profit"];
function idx(step) {
  const i = FLOW.indexOf(step);
  return i < 0 ? 0 : i + 1;
}

export function welcomeHtml() {
  return `
    <div class="intro-welcome" data-step="welcome">
      <div class="intro-wordmark">
        <span class="wordmark-script">Jessika’s</span>
        <span class="wordmark-bold">Flip Side</span>
      </div>
      <div class="intro-player" id="intro-player">
        <video id="intro-vid" playsinline muted preload="none" poster="media/intro-poster.jpg" hidden></video>
        <div class="intro-ph" id="intro-ph">
          <img src="media/intro-poster.jpg" alt="Jessika's Flip Side">
          <p class="intro-ph-label">Video coming soon</p>
        </div>
        <button type="button" class="intro-sound" data-act="sound" hidden>Tap for sound</button>
        <button type="button" class="intro-skip" data-act="skip-video">Skip</button>
      </div>
      <div class="intro-ctas">
        <p class="small muted center intro-lead">Give it a try before you add it to your Home Screen. Nothing is posted to any real selling site.</p>
        <button type="button" class="btn btn-main" data-act="try-photo">Try it with your own photo</button>
        <button type="button" class="btn soft" data-act="try-sample">Try a sample item</button>
        <button type="button" class="btn ghost" data-act="goto-end">Add it to your Home Screen</button>
        <button type="button" class="btn ghost" data-act="start-real">Skip to the app</button>
      </div>
    </div>`;
}

export function samplesHtml(session) {
  return `
    <div class="demo-step" data-step="samples" data-ready="1">
      ${chrome(session, { title: "Try a sample item", n: "", of: "", hideNext: true })}
      <p class="small muted">Three made-up items, with sample listings already written. No real brands.</p>
      <div class="demo-samples">
        ${SAMPLES.map(s => `
          <button type="button" class="demo-sample" data-sample="${esc(s.id)}" data-act="pick-sample">
            <img src="${esc(s.photo)}" alt="">
            <span>${esc(s.name)}</span>
          </button>`).join("")}
      </div>
      <button type="button" class="btn ghost" data-act="try-photo">Or use your own photo</button>
    </div>`;
}

export function photoHtml(session) {
  const has = session.photos && session.photos.length;
  return `
    <div class="demo-step" data-step="photo" data-ready="1">
      ${chrome(session, { title: "Take a photo", n: "", of: "", hideNext: true })}
      ${has ? photoEl({ photos: session.photos }) : `<div class="demo-photo-empty"><span>📷</span><p>Take or choose a photo of something you might sell.</p></div>`}
      <div class="stack demo-actions">
        <button type="button" class="btn btn-main" data-act="demo-cam">Take a photo</button>
        <button type="button" class="btn soft" data-act="demo-lib">Choose a photo</button>
        ${has ? `<button type="button" class="btn btn-main" data-act="make-draft">Make a draft</button>` : ""}
        <button type="button" class="btn ghost" data-act="try-sample">Or try a sample item</button>
      </div>
      <input id="demo-cam" type="file" accept="image/*" capture="environment" hidden>
      <input id="demo-lib" type="file" accept="image/*" hidden>
    </div>`;
}

export function draftHtml(session) {
  const item = session.item || {};
  const label = demoSourceLabel(session);
  const kind = session.draftSource === "ai" ? "ok" : "warn";
  return `
    <div class="demo-step" data-step="draft" data-ready="1">
      ${chrome(session, { title: "Here's a listing draft", n: idx("draft"), of: FLOW.length, nextLabel: "Looks good", extra: `
        ${photoEl(item)}
        <p class="demo-badge">${honesty(kind, label)}</p>
        ${session.draftNote ? `<p class="small muted">${esc(session.draftNote)}</p>` : ""}
        <div class="card">
          <h3>${esc(item.title || "Untitled")}</h3>
          <p>${esc(item.description || "")}</p>
          <p class="small muted">${esc([item.category, item.condition].filter(Boolean).join(" · "))}</p>
          <p class="demo-price">${item.priceLow != null || item.priceHigh != null
            ? `${honesty("warn", "Estimate")} ${esc(formatUsd(item.priceLow))} – ${esc(formatUsd(item.priceHigh))}`
            : ""}</p>
          ${item.priceReason ? `<p class="small muted">${esc(item.priceReason)}</p>` : ""}
        </div>
      ` })}
    </div>`;
}

export function scanHtml(session) {
  const result = demoScan(session);
  const item = session.item || {};
  const verdict = (result && result.verdictLabel) || VERDICT_LABELS[result && result.verdict] || "Maybe";
  const buy = result && result.buyUpToLabel ? result.buyUpToLabel : (result && result.buyUpTo != null ? "Buy up to " + formatUsd(result.buyUpTo) : "");
  return `
    <div class="demo-step" data-step="scan" data-ready="1">
      ${chrome(session, { title: "Buy or pass", n: idx("scan"), of: FLOW.length, nextLabel: "Next: pick sites", extra: `
        ${photoEl(item)}
        <div class="card okbox center">
          <p class="tiny muted">${honesty("warn", "Estimate")}</p>
          <p class="demo-buyup">${esc(buy || "Buy up to —")}</p>
          <p class="demo-verdict">${esc(verdict)}</p>
          <p class="small muted">The thrift-store price in this demo is ${esc(formatUsd(item.costPaid))}.</p>
        </div>
        <p class="small muted">This uses estimated resale, fees, and shipping, minus the profit you'd like to keep. You can change those numbers for real in the app.</p>
      ` })}
    </div>`;
}

export function sitesHtml(session) {
  const item = session.item || {};
  const advice = item.siteAdvice || {};
  const picked = new Set(session.siteIds || []);
  const block = (b, label) => {
    if (!b || !(b.sites && b.sites.length)) return "";
    return `<div class="card flat">
      <h3>${esc(label)} ${honesty("warn", "Estimate")}</h3>
      <p>${esc((b.sites || []).map(siteName).join(", "))}</p>
      ${b.reason ? `<p class="small muted">${esc(b.reason)}</p>` : ""}
    </div>`;
  };
  return `
    <div class="demo-step" data-step="sites" data-ready="1">
      ${chrome(session, { title: "Where to list it", n: idx("sites"), of: FLOW.length, nextLabel: "List them (pretend)", nextAct: "list-pretend", extra: `
        ${block(advice.bestPrice, "Best price")}
        ${block(advice.fastestSale, "Fastest sale")}
        <div class="card">
          <h3>Your sites</h3>
          <p class="small muted">Tick the ones you want to see in this demo.</p>
          <ul class="sitelist">${SITES.map(s => `<li>
            <label class="check">
              <input type="checkbox" data-act="togglesite" data-site="${esc(s.id)}" ${picked.has(s.id) ? "checked" : ""}>
              <span>${esc(s.name)}</span>
            </label>
          </li>`).join("")}</ul>
        </div>
      ` })}
    </div>`;
}

export function listingHtml(session) {
  const rows = listingRows(session);
  const ready = session.listingDone ? "1" : "0";
  return `
    <div class="demo-step" data-step="listing" data-ready="${ready}">
      ${chrome(session, { title: "Listing on your sites", n: idx("listing"), of: FLOW.length, nextLabel: "Continue", hideNext: !session.listingDone, extra: `
        <p class="demo-pretend">${honesty("warn", "Pretend")} ${esc(PRETEND_POSTED)}</p>
        <ul class="demo-sites">${rows.map(r => `<li class="${r.visible ? "on" : "off"}">
          <span>${esc(r.name)}</span>
          ${r.visible ? `<span class="pill pill-live">${esc(SITE_STATUS_LABELS.live || "Live")}</span>` : `<span class="pill">…</span>`}
        </li>`).join("")}</ul>
        <p class="small muted">For real, you would copy the listing and post it yourself in each site's own app. Jessika's Flip Side does not log into those accounts.</p>
      ` })}
    </div>`;
}

export function soldHtml(session) {
  return `
    <div class="demo-step" data-step="sold" data-ready="1">
      ${chrome(session, { title: soldHeadline(session), n: idx("sold"), of: FLOW.length, nextLabel: "Take the others down", extra: `
        <p class="tiny muted">A few days later…</p>
        <div class="demo-sold">
          <p class="demo-sold-head">${esc(soldHeadline(session))}</p>
          <p class="demo-pretend">${honesty("warn", "Pretend")} ${esc(PRETEND_SOLD)}</p>
        </div>
      ` })}
    </div>`;
}

export function takedownHtml(session) {
  const rows = takedownRows(session);
  const allDone = !!session.takedownDone || (rows.length > 0 && rows.every(r => r.done));
  const none = rows.length === 0;
  return `
    <div class="demo-step" data-step="takedown" data-ready="1">
      ${chrome(session, { title: "Take them all down", n: idx("takedown"), of: FLOW.length, nextLabel: "Next: pack it", hideNext: !allDone && !none, extra: `
        <p class="demo-pretend">${honesty("warn", "Pretend")} ${esc(PRETEND_TAKEDOWN)}</p>
        ${none ? `<p>It was only listed on the site that sold it, so there's nothing else to take down.</p>` : `
          <ul class="demo-sites">${rows.map(r => `<li class="${r.done ? "done" : "needs"}">
            <span>${esc(r.name)}</span>
            <span class="pill ${r.done ? "pill-removed" : "pill-warn"}">${r.done ? "Removed" : "Still up"}</span>
          </li>`).join("")}</ul>
          ${allDone ? "" : `<button type="button" class="btn btn-main" data-act="takedown-all">Take them all down automatically</button>
          <p class="small muted">In this demo it marks them removed right away, as a pretend. For real, that button flags the item unavailable and walks you through each site. Official automatic removal comes later for eBay, Etsy, and Shopify. Some sites will always need your tap.</p>`}
        `}
      ` })}
    </div>`;
}

export function packHtml(session) {
  const item = session.item || {};
  return `
    <div class="demo-step" data-step="pack" data-ready="1">
      ${chrome(session, { title: "Pack it up", n: idx("pack"), of: FLOW.length, nextLabel: "It's packed", nextAct: "packed", extra: `
        ${photoEl(item)}
        <div class="card">
          <p><b>${esc(item.title || "")}</b></p>
          <p>Bin: <b>${esc(item.binLocation || "A3")}</b></p>
          <ul class="demo-checks">${SHIP_CHECKS.map(c => `<li>${c.id === "droppedOff" ? "☐" : "☑"} ${esc(c.label)}</li>`).join("")}</ul>
        </div>
      ` })}
    </div>`;
}

export function shipHtml(session) {
  const ship = demoShipSuggest(session);
  const item = session.item || {};
  const saleShip = item.actualShipCost ?? item.shippingPaid;
  const rows = (ship.estimates || []).slice(0, 3);
  return `
    <div class="demo-step" data-step="ship" data-ready="1">
      ${chrome(session, { title: "Ship it", n: idx("ship"), of: FLOW.length, nextLabel: "Mark as shipped", nextAct: "shipped", extra: `
        <div class="card">
          <p>${honesty("warn", "Estimate")} ${esc(ship.boxLabel || (ship.suggest && ship.suggest.boxLabel) || "A small box")}</p>
          ${rows.length ? `<ul class="tiny">${rows.map(r => `<li>${esc(r.name || "")} — ${esc(formatUsd(r.usd))}</li>`).join("")}</ul>` : ""}
          ${saleShip != null ? `<p>Shipping used in this demo: ${esc(formatUsd(saleShip))}</p>` : ""}
          <p class="small muted">${esc(SHIP_TABLE_NOTE)}</p>
        </div>
      ` })}
    </div>`;
}

export function profitHtml(session) {
  const p = demoProfit(session) || {};
  const row = (label, v, note) => `<div class="row between demo-profit-row"><span>${esc(label)}</span><b>${esc(v == null ? "—" : formatUsd(v))}</b></div>${note ? `<p class="tiny muted">${esc(note)}</p>` : ""}`;
  return `
    <div class="demo-step" data-step="profit" data-ready="1">
      ${chrome(session, { title: "What you kept", n: idx("profit"), of: FLOW.length, nextLabel: "See how to keep this app", nextAct: "goto-end", extra: `
        <div class="card">
          ${row("Sale price", p.sale)}
          ${row("What you paid", p.cost)}
          ${row("Marketplace fees", p.fees, "Estimate")}
          ${row("Shipping", p.postage, p.postageIsActual ? "" : "Estimate")}
          <div class="row between demo-profit-row total"><span>Estimated profit</span><b>${esc(p.estimatedProfit == null ? "—" : formatUsd(p.estimatedProfit))}</b></div>
          <p class="small muted">${esc(p.note || "")}</p>
          <p class="small muted">This is a sample sale, for the demo only.</p>
        </div>
      ` })}
    </div>`;
}

function shareSvg() {
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#0f766e"/>
    <path d="M24 10v18" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M16 18l8-8 8 8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14 28v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8" fill="none" stroke="#5eead4" stroke-width="2.6" stroke-linecap="round"/></svg>`;
}
function plusSvg() {
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#0f766e"/>
    <rect x="12" y="12" width="24" height="24" rx="6" fill="none" stroke="#fff" stroke-width="2.4"/>
    <path d="M24 18v12M18 24h12" stroke="#5eead4" stroke-width="2.6" stroke-linecap="round"/></svg>`;
}
function homeSvg() {
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#0f766e"/>
    <rect x="14" y="16" width="20" height="20" rx="5" fill="#fff"/>
    <path d="M18 31V25h5v6" fill="none" stroke="#0f766e" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="30" cy="22" r="2.2" fill="#0f766e"/></svg>`;
}

export function endHtml(session, win) {
  const showAdd = shouldShowAddToHomeScreen(win);
  const standalone = isStandalone(win);
  return `
    <div class="demo-step demo-end" data-step="end" data-ready="1">
      <div class="intro-wordmark">
        <span class="wordmark-script">Jessika’s</span>
        <span class="wordmark-bold">Flip Side</span>
      </div>
      ${standalone || !showAdd ? `
        <div class="card okbox center">
          <h2>It's already on your Home Screen</h2>
          <p>You're all set. Tap below to start with your real items. The demo you just tried was not saved.</p>
        </div>
      ` : `
        <h2 class="demo-title">Add it to your Home Screen</h2>
        <p class="small muted">It opens like an app, with its own icon. You can also try it in Safari first.</p>
        <ol class="addhome">
          <li>
            <div class="addhome-icon">${shareSvg()}</div>
            <p><b>1. Tap Share</b> at the bottom of Safari (the square with the arrow pointing up).</p>
          </li>
          <li>
            <div class="addhome-icon">${plusSvg()}</div>
            <p><b>2. Tap Add to Home Screen.</b> You may need to scroll down the share list to see it.</p>
          </li>
          <li>
            <div class="addhome-icon">${homeSvg()}</div>
            <p><b>3. Tap Add.</b> Jessika's Flip Side appears on your Home Screen. Open it from there next time.</p>
          </li>
        </ol>
      `}
      ${explain("end")}
      <div class="stack demo-actions">
        <button type="button" class="btn btn-main" data-act="start-real">Start for real</button>
        <button type="button" class="btn ghost" data-act="try-sample">Try the demo again</button>
      </div>
    </div>`;
}

export function busyHtml(message) {
  return `<div class="demo-step" data-step="busy" data-ready="0">
    <div class="demo-busy"><span class="demo-spin" aria-hidden="true"></span><p>${esc(message || "One moment…")}</p></div>
  </div>`;
}

export function demoHtml(session, win) {
  switch (session && session.step) {
    case "welcome": return welcomeHtml();
    case "photo": return photoHtml(session);
    case "samples": return samplesHtml(session);
    case "draft": return draftHtml(session);
    case "scan": return scanHtml(session);
    case "sites": return sitesHtml(session);
    case "listing": return listingHtml(session);
    case "sold": return soldHtml(session);
    case "takedown": return takedownHtml(session);
    case "pack": return packHtml(session);
    case "ship": return shipHtml(session);
    case "profit": return profitHtml(session);
    case "end": return endHtml(session, win);
    default: return welcomeHtml();
  }
}

export { FLOW };
