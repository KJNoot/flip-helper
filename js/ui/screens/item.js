import { esc, $, toast, bind, honesty, pill, copyText, confirmSheet, promptSheet, thumb } from "../dom.js";
import {
  applyFields, setListed, markSold, markDelisted, markShipped, setShipCheck,
  listingCopy, listedSiteIds, delistTargets, pendingDelist, isDelisted,
  needsDelistHighlight, isFullyDelisted, profit, formatUsd, statusLine,
  SHIP_CHECKS, siteName, STAGE_LABELS, setSitePlan, planSiteIds, hasAdvice
} from "../../core/inventory.js";
import { SITES, SITE_IDS, siteById } from "../../core/sites.js";
import { photoFromFile, MAX_PHOTOS } from "../../core/draft.js";
import { fieldsHtml, readFields, searchLinks, adviceHtml } from "./form.js";
import { getEnabledIds, sitesForItem } from "../../core/prefs.js";

export function renderItem(ctx, el, item) {
  if (!item) {
    el.innerHTML = `<div class="topbar"><a class="iconbtn" href="#/items" aria-label="Back">‹</a><h2>Item</h2><span class="spacer48"></span></div>
      <div class="card empty"><p>That item isn't on this phone.</p><a class="btn soft" href="#/items">Back to items</a></div>`;
    return;
  }
  const alert = needsDelistHighlight(item);
  const targets = delistTargets(item);
  const pending = pendingDelist(item);
  const listed = listedSiteIds(item);
  const p = profit(item);
  const photos = item.photos || [];

  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/items" aria-label="Back">‹</a><h2 class="clamp2">${esc(item.title || "Untitled item")}</h2><span class="spacer48"></span></div>
    <div class="row wrap" style="margin-bottom:8px">${pill(STAGE_LABELS[item.stage] || item.stage, item.stage)} ${alert ? pill("Take it down", "warn") : ""}</div>

    <div class="photos">
      ${photos.map((ph, i) => `<div class="photo">
        <img src="${esc(ph.dataUrl)}" alt="Photo ${i + 1}">
        <button type="button" class="iconbtn sm" data-act="delphoto" data-i="${i}" aria-label="Remove photo">×</button>
      </div>`).join("")}
      ${photos.length < MAX_PHOTOS ? `
        <label class="photo add"><input id="cam" type="file" accept="image/*" capture="environment" hidden><span>📷</span></label>
        <label class="photo add"><input id="lib" type="file" accept="image/*" multiple hidden><span>🖼</span></label>` : ""}
    </div>

    ${alert ? delistCard(item, targets, pending, false) : (item.soldAt && targets.length && isFullyDelisted(item) ? `<div class="card okbox"><p>All other listings are checked off. Nice work.</p></div>` : "")}

    ${item.soldAt ? soldCard(item, p) : ""}

    ${!item.soldAt ? adviceHtml(item) : ""}

    <div class="card" id="post">
      <div class="row between"><h3>Post it</h3>${honesty("warn", "Needs you to post")}</div>
      <p class="small muted">Copy the listing, open the site's own selling page, paste it, and post it yourself. Then tick the site so Flip Helper can keep track.</p>
      ${siteLists(item, listed)}
    </div>

    ${!item.soldAt ? `<div class="card">
      <h3>It sold</h3>
      <p class="small muted">When it sells on one site, mark it here. You'll get a take-down checklist for the others.</p>
      <button type="button" class="btn" data-act="sold">Mark as sold</button>
    </div>` : shipCard(item)}

    <div class="card" id="fields">
      <h3>Listing details</h3>
      ${fieldsHtml(item)}
      ${searchLinks(item)}
      <button type="button" class="btn soft" data-act="savefields" style="margin-top:10px">Save changes</button>
    </div>

    <div class="card flat">
      <button type="button" class="btn dangerghost" data-act="delete">Delete this item</button>
    </div>
  `;

  const onFiles = async (input) => {
    const files = [...(input.files || [])];
    input.value = "";
    try {
      let next = item;
      for (const f of files) {
        if ((next.photos || []).length >= MAX_PHOTOS) break;
        const photo = await photoFromFile(f);
        next = { ...next, photos: [...(next.photos || []), photo] };
      }
      await ctx.save(next);
      ctx.render();
    } catch (e) { toast(e.message || "That photo couldn't be used."); }
  };
  const cam = $("#cam", el), lib = $("#lib", el);
  if (cam) cam.addEventListener("change", () => onFiles(cam));
  if (lib) lib.addEventListener("change", () => onFiles(lib));

  bind(el, {
    delphoto: async b => {
      const next = { ...item, photos: (item.photos || []).filter((_, n) => n !== +b.dataset.i) };
      await ctx.save(next); ctx.render();
    },
    plan: async b => {
      const next = setSitePlan(readMerged(el, item), b.dataset.plan);
      await ctx.save(next);
      ctx.render();
    },
    listed: async b => {
      const on = b.checked;
      const next = setListed(item, b.dataset.site, on);
      await ctx.save(next);
      toast(on ? `Listed on ${siteName(b.dataset.site)}` : `Removed from ${siteName(b.dataset.site)}`);
      ctx.render();
    },
    copy: async b => {
      const text = listingCopy(readMerged(el, item), b.dataset.site);
      const ok = await copyText(text);
      toast(ok ? `Copied for ${siteName(b.dataset.site)}` : "Couldn't copy. You can select the text and copy it.");
    },
    delist: async b => {
      const next = markDelisted(item, b.dataset.site, b.checked);
      await ctx.save(next);
      ctx.render();
    },
    shipcheck: async b => {
      const next = setShipCheck(item, b.dataset.check, b.checked);
      await ctx.save(next);
      ctx.render();
    },
    shipped: async () => {
      const next = markShipped(item, !item.shippedAt);
      await ctx.save(next);
      toast(next.shippedAt ? "Marked as shipped" : "Shipped mark cleared");
      ctx.render();
    },
    sold: async () => {
      const offer = sitesForItem(item);
      const options = offer.map(id => {
        const s = siteById(id);
        return { value: id, label: (s ? s.name : id) + (listed.includes(id) ? " (listed)" : "") };
      });
      const values = await promptSheet({
        title: "Mark as sold",
        body: "Which site did it sell on? Add the sale price and any fees (site fees plus shipping you paid).",
        ok: "Mark as sold",
        fields: [
          { id: "site", type: "select", label: "Sold on", options, value: listed[0] || "ebay", required: true },
          { id: "sale", type: "text", inputmode: "decimal", label: "Sale price", placeholder: "0.00", value: item.askingPrice ?? "", required: true },
          { id: "fees", type: "text", inputmode: "decimal", label: "Fees (optional)", placeholder: "0.00", value: item.fees ?? "" }
        ]
      });
      if (!values) return;
      const next = markSold(readMerged(el, item), { siteId: values.site, salePrice: values.sale, fees: values.fees });
      await ctx.save(next);
      toast("Marked as sold");
      ctx.render();
    },
    savefields: async () => {
      const next = applyFields(item, readFields(el));
      await ctx.save(next);
      toast("Saved");
      ctx.render();
    },
    delete: async () => {
      if (!(await confirmSheet({ title: "Delete this item?", body: "It will be removed from this phone. This cannot be undone.", ok: "Delete", danger: true }))) return;
      await ctx.remove(item.id);
      toast("Item deleted");
      ctx.go("#/items");
    }
  });
}

function readMerged(el, item) {
  const fieldsEl = $("#fields", el);
  if (!fieldsEl) return item;
  try { return applyFields(item, readFields(el)); } catch (e) { return item; }
}


function siteLists(item, listed) {
  const enabled = getEnabledIds();
  const planned = item.sitePlan && item.sitePlan !== "own" ? planSiteIds(item) : [];
  const primaryIds = planned.length ? planned : enabled;
  const primary = primaryIds.map(id => siteById(id)).filter(Boolean);
  const seen = new Set(primary.map(s => s.id));
  // Already-listed sites stay in the main list
  for (const id of listed) {
    if (!seen.has(id)) {
      const s = siteById(id);
      if (s) { primary.push(s); seen.add(id); }
    }
  }
  // Every other known site is under "More sites"
  const restClean = SITE_IDS.filter(id => !seen.has(id)).map(id => siteById(id)).filter(Boolean);
  const highlight = new Set(planned);
  return `
    <ul class="siterows">${primary.map(s => siteRow(item, s, listed, highlight.has(s.id))).join("")}</ul>
    ${restClean.length ? `<details class="more-sites"><summary>More sites (${restClean.length})</summary>
      <ul class="siterows">${restClean.map(s => siteRow(item, s, listed, false)).join("")}</ul>
    </details>` : ""}`;
}

function siteRow(item, s, listed, suggested = false) {
  const on = listed.includes(s.id);
  return `<li class="siterow${suggested ? " suggested" : ""}">
    <label class="check">
      <input type="checkbox" data-act="listed" data-site="${esc(s.id)}" ${on ? "checked" : ""}>
      <span>${esc(s.name)}${suggested ? ' <span class="pill pill-listed">Suggested</span>' : ""}${s.note ? `<span class="tiny muted" style="display:block;font-weight:400">${esc(s.note)}</span>` : ""}</span>
    </label>
    <div class="row wrap siteacts">
      <button type="button" class="btn sm soft" data-act="copy" data-site="${esc(s.id)}">Copy for ${esc(s.short || s.name)}</button>
      <a class="btn sm ghost" href="${esc(s.sellUrl)}" target="_blank" rel="noopener">Open ${esc(s.short || s.name)} sell page</a>
    </div>
  </li>`;
}

function delistCard(item, targets, pending, _done) {
  return `<div class="card alert" id="delist">
    <h3>Take it down on these sites</h3>
    <p class="small">It sold${item.soldOn ? " on " + esc(siteName(item.soldOn)) : ""}. This is a checklist, not automatic. Open each site, mark the listing sold or remove it, then check it off.</p>
    <ul class="delist">${targets.map(id => {
      const s = SITES.find(x => x.id === id);
      const done = isDelisted(item, id);
      return `<li class="${done ? "done" : ""}">
        <label class="check">
          <input type="checkbox" data-act="delist" data-site="${esc(id)}" ${done ? "checked" : ""}>
          <span>${esc(s ? s.name : id)}</span>
        </label>
        <a class="btn sm soft" href="${esc(s ? s.manageUrl : "#")}" target="_blank" rel="noopener">Open to take it down</a>
      </li>`;
    }).join("")}</ul>
    ${pending.length === 0 ? `<p class="small ok">All checked off.</p>` : `<p class="small attn">${pending.length} still to take down.</p>`}
  </div>`;
}

function soldCard(item, p) {
  return `<div class="card">
    <h3>Sale</h3>
    <div class="stats tight">
      <div><span class="tiny muted">Sold on</span><b>${esc(item.soldOn ? siteName(item.soldOn) : "—")}</b></div>
      <div><span class="tiny muted">Sale price</span><b>${esc(formatUsd(item.salePrice))}</b></div>
      <div><span class="tiny muted">Fees</span><b>${esc(formatUsd(item.fees))}</b></div>
      <div><span class="tiny muted">Profit</span><b>${esc(p == null ? "—" : formatUsd(p))}</b></div>
    </div>
    <p class="tiny muted">Profit is sale price minus what you paid (${esc(formatUsd(item.costPaid))}) minus fees.</p>
  </div>`;
}

function shipCard(item) {
  return `<div class="card" id="ship">
    <div class="row between"><h3>Ship it</h3>${honesty("ok", "Working, simple")}</div>
    <p class="small muted">A short packing list. This version does not buy shipping labels.</p>
    <ul class="checks">${SHIP_CHECKS.map(c => `<li>
      <label class="check"><input type="checkbox" data-act="shipcheck" data-check="${esc(c.id)}" ${item.shipChecks && item.shipChecks[c.id] ? "checked" : ""}><span>${esc(c.label)}</span></label>
    </li>`).join("")}</ul>
    <button type="button" class="btn soft sm" data-act="shipped" style="margin-top:10px">${item.shippedAt ? "Clear shipped mark" : "Mark as shipped"}</button>
  </div>`;
}
