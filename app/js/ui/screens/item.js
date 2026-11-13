import { esc, $, toast, bind, honesty, pill, copyText, confirmSheet, promptSheet } from "../dom.js";
import {
  applyFields, setListed, markSold, markDelisted, markShipped, setShipCheck,
  listingCopy, listedSiteIds, delistTargets, pendingDelist, isDelisted,
  needsDelistHighlight, isFullyDelisted, profit, formatUsd, statusLine,
  SHIP_CHECKS, siteName, STAGE_LABELS, setSitePlan, planSiteIds, money
} from "../../core/inventory.js";
import { SITES, SITE_IDS, siteById } from "../../core/sites.js";
import { photoFromFile, requestCompsEstimate, requestShipSuggest, MAX_PHOTOS } from "../../core/draft.js";
import { fieldsHtml, readFields, adviceHtml } from "./form.js";
import { getEnabledIds, sitesForItem } from "../../core/prefs.js";
import { delistCountdown, formatDuration } from "../../core/protect.js";
import { soldLinks, addLoggedComp, removeLoggedComp, loggedCompStats, setAiComps, normalizeAiComps, ebayOfficialAdapter } from "../../core/comps.js";
import { suggestionsForItem, recordDropDecision, markPriceUpdated, pendingPriceUpdates } from "../../core/drops.js";
import { getSettings } from "../../core/settings.js";
import { heuristicShip, normalizeShipSuggest, shippingEstimates, boxSizeLabel, labelLinksFor, SHIP_TABLE_NOTE } from "../../core/shipping.js";
import { hasKey } from "../../core/key.js";
import { openCleanup } from "../cleanup.js";

let clockTimer = null;

export function renderItem(ctx, el, item) {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
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
  const countdown = delistCountdown(item);
  const drops = suggestionsForItem(item, { days: getSettings().dropAfterDays });
  const priceTodos = pendingPriceUpdates(item);

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
    ${photos.length ? `<button type="button" class="btn soft sm" data-act="cleanup" style="margin-top:10px">Clean up photos (basic)</button>` : ""}

    ${alert ? delistCard(item, targets, pending, countdown) : (item.soldAt && targets.length && isFullyDelisted(item) ? `<div class="card okbox"><p>All other listings are checked off. Nice work.</p></div>` : "")}

    ${item.soldAt ? soldCard(item, p) : ""}

    ${!item.soldAt ? adviceHtml(item) : ""}

    ${!item.soldAt && drops.length ? dropsCard(drops) : ""}
    ${priceTodos.length ? priceUpdateCard(item, priceTodos) : ""}

    ${compsCard(item)}

    <div class="card" id="post">
      <div class="row between"><h3>Post it</h3>${honesty("warn", "Needs you to post")}</div>
      <p class="small muted">Copy the listing, open the site's own selling page, paste it, and post it yourself. Then tick the site so Flip Helper can keep track.</p>
      ${siteLists(item, listed)}
    </div>

    ${!item.soldAt ? `<div class="card">
      <h3>It sold</h3>
      <p class="small muted">When it sells on one site, mark it here. You'll get a loud take-down checklist for the others, with a countdown and reminders, so it doesn't sell twice.</p>
      <button type="button" class="btn" data-act="sold">Mark as sold</button>
    </div>` : shipCard(item)}

    ${shipSuggestCard(item)}

    <div class="card" id="fields">
      <h3>Listing details</h3>
      ${fieldsHtml(item, { hideSearch: true })}
      <button type="button" class="btn soft" data-act="savefields" style="margin-top:10px">Save changes</button>
    </div>

    <div class="card flat">
      <button type="button" class="btn dangerghost" data-act="delete">Delete this item</button>
    </div>
  `;

  if (countdown) {
    const clock = $("#countdown-clock", el);
    clockTimer = setInterval(() => {
      const c = delistCountdown(item);
      if (!c || !clock || !clock.isConnected) { clearInterval(clockTimer); clockTimer = null; return; }
      clock.textContent = c.headline;
      clock.classList.toggle("overdue", c.overdue);
    }, 1000);
  }

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
    cleanup: () => {
      const first = (item.photos || [])[0];
      if (!first) { toast("Take a photo first"); return; }
      openCleanup({
        dataUrl: first.dataUrl,
        onApply: async (dataUrl) => {
          const photos = (item.photos || []).slice();
          photos[0] = { ...photos[0], dataUrl, cleanedAt: Date.now(), cleaned: "basic" };
          await ctx.save({ ...item, photos });
          toast("Photo cleaned up (basic)");
          ctx.render();
        }
      });
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
      if (isFullyDelisted(next) || pendingDelist(next).length === 0) toast("All other listings are checked off");
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
        body: "Which site did it sell on? Add the sale price, site fees, and any shipping you paid.",
        ok: "Mark as sold",
        fields: [
          { id: "site", type: "select", label: "Sold on", options, value: listed[0] || "ebay", required: true },
          { id: "sale", type: "text", inputmode: "decimal", label: "Sale price", placeholder: "0.00", value: item.askingPrice ?? "", required: true },
          { id: "fees", type: "text", inputmode: "decimal", label: "Site fees (optional)", placeholder: "0.00", value: item.fees ?? "" },
          { id: "shipping", type: "text", inputmode: "decimal", label: "Shipping you paid (optional)", placeholder: "0.00", value: item.shippingPaid ?? "" }
        ]
      });
      if (!values) return;
      const next = markSold(readMerged(el, item), { siteId: values.site, salePrice: values.sale, fees: values.fees, shippingPaid: values.shipping });
      await ctx.save(next);
      toast("Marked as sold");
      ctx.render();
      // Loud take-down sheet if other sites are still up.
      if (pendingDelist(next).length) {
        // Re-render already shows the loud card; also ping reminders.
        if (ctx.onSold) ctx.onSold(next);
      }
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
    },
    logcomp: async () => {
      const enabled = getEnabledIds();
      const options = [{ value: "", label: "Not sure" }, ...SITES.filter(s => enabled.includes(s.id) || s.id === "ebay").map(s => ({ value: s.id, label: s.name }))];
      const values = await promptSheet({
        title: "Log a sold price you found",
        body: "Type a sold price you actually saw, for example on eBay sold listings.",
        ok: "Save",
        fields: [
          { id: "price", type: "text", inputmode: "decimal", label: "Sold price", placeholder: "0.00", required: true },
          { id: "site", type: "select", label: "Where you saw it", options, value: "ebay" },
          { id: "note", type: "text", label: "Note (optional)", placeholder: "Condition, date…" }
        ]
      });
      if (!values) return;
      if (money(values.price) == null) { toast("Enter a sold price"); return; }
      const next = addLoggedComp(item, { price: values.price, siteId: values.site, note: values.note });
      await ctx.save(next);
      toast("Sold price saved");
      ctx.render();
    },
    delcomp: async b => {
      const next = removeLoggedComp(item, b.dataset.id);
      await ctx.save(next);
      ctx.render();
    },
    aicomps: async () => {
      if (!hasKey()) { toast("Paste the AI key in Settings first"); ctx.go("#/settings"); return; }
      toast("Estimating…");
      try {
        const { json } = await requestCompsEstimate({
          title: item.title,
          category: item.category,
          brand: item.brand,
          condition: item.condition,
          photos: item.photos
        });
        const next = setAiComps(item, normalizeAiComps(json));
        await ctx.save(next);
        toast("Estimate ready. Please check it against sold listings.");
        ctx.render();
      } catch (e) { toast(e.message || "The estimate couldn't be made."); }
    },
    approvedrop: async b => {
      const sug = drops.find(d => d.id === b.dataset.id);
      if (!sug) return;
      if (!(await confirmSheet({
        title: `Drop the price on ${sug.siteName}?`,
        body: `This will change your asking price in Flip Helper to ${formatUsd(sug.toPrice)}. You'll still need to change it on ${sug.siteName} yourself.`,
        ok: "Approve"
      }))) return;
      const next = recordDropDecision(item, sug, "approved");
      await ctx.save(next);
      toast("Approved. Please update it on " + sug.siteName);
      ctx.render();
    },
    dismissdrop: async b => {
      const sug = drops.find(d => d.id === b.dataset.id);
      if (!sug) return;
      const next = recordDropDecision(item, sug, "dismissed");
      await ctx.save(next);
      ctx.render();
    },
    priceupdated: async b => {
      const next = markPriceUpdated(item, b.dataset.site, b.checked);
      await ctx.save(next);
      ctx.render();
    },
    aiship: async () => {
      let next = item;
      if (hasKey() && (item.photos || []).length) {
        toast("Suggesting a box…");
        try {
          const { json } = await requestShipSuggest({
            photos: item.photos,
            title: item.title,
            category: item.category,
            condition: item.condition
          });
          next = { ...item, shipSuggest: normalizeShipSuggest(json, "ai") };
        } catch (e) {
          toast(e.message || "Using a simple estimate instead.");
          next = { ...item, shipSuggest: heuristicShip(item) };
        }
      } else {
        next = { ...item, shipSuggest: heuristicShip(item) };
      }
      await ctx.save(next);
      toast("Box suggestion ready. Please weigh the packed item.");
      ctx.render();
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
  for (const id of listed) {
    if (!seen.has(id)) {
      const s = siteById(id);
      if (s) { primary.push(s); seen.add(id); }
    }
  }
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

function delistCard(item, targets, pending, countdown) {
  const c = countdown || delistCountdown(item);
  return `<div class="card alert loud" id="delist">
    <div class="row between"><h3>Take it down — don't let it sell twice</h3>${honesty("ok", "Working")}</div>
    <p class="countdown ${c && c.overdue ? "overdue" : ""}" id="countdown-clock">${esc(c ? c.headline : "Take it down on the other sites now.")}</p>
    <p class="small">${c ? esc(c.sub) : "It sold" + (item.soldOn ? " on " + siteName(item.soldOn) : "") + ". Open each site, mark the listing sold or remove it, then check it off."} This is a checklist, not automatic. Reminders will keep coming until every site is checked off.</p>
    <ul class="delist">${targets.map(id => {
      const s = SITES.find(x => x.id === id);
      const done = isDelisted(item, id);
      return `<li class="${done ? "done" : ""}">
        <label class="check">
          <input type="checkbox" data-act="delist" data-site="${esc(id)}" ${done ? "checked" : ""}>
          <span>${esc(s ? s.name : id)}</span>
        </label>
        <a class="btn sm" href="${esc(s ? s.manageUrl : "#")}" target="_blank" rel="noopener">Open to take it down</a>
      </li>`;
    }).join("")}</ul>
    ${pending.length === 0 ? `<p class="small ok">All checked off.</p>` : `<p class="small attn">${pending.length} still to take down.</p>`}
    <p class="tiny muted">A computer helper that can take listings down for you, the legal way, is coming later. See the roadmap.</p>
  </div>`;
}

function soldCard(item, p) {
  return `<div class="card">
    <h3>Sale</h3>
    <div class="stats tight">
      <div><span class="tiny muted">Sold on</span><b>${esc(item.soldOn ? siteName(item.soldOn) : "—")}</b></div>
      <div><span class="tiny muted">Sale price</span><b>${esc(formatUsd(item.salePrice))}</b></div>
      <div><span class="tiny muted">Fees</span><b>${esc(formatUsd(item.fees))}</b></div>
      <div><span class="tiny muted">Shipping you paid</span><b>${esc(formatUsd(item.shippingPaid))}</b></div>
      <div><span class="tiny muted">Profit</span><b>${esc(p == null ? "—" : formatUsd(p))}</b></div>
    </div>
    <p class="tiny muted">Profit is sale price minus what you paid (${esc(formatUsd(item.costPaid))}) minus fees minus shipping you paid.</p>
  </div>`;
}

function shipCard(item) {
  return `<div class="card" id="ship">
    <div class="row between"><h3>Ship it</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">A short packing list. This version does not buy shipping labels.</p>
    <ul class="checks">${SHIP_CHECKS.map(c => `<li>
      <label class="check"><input type="checkbox" data-act="shipcheck" data-check="${esc(c.id)}" ${item.shipChecks && item.shipChecks[c.id] ? "checked" : ""}><span>${esc(c.label)}</span></label>
    </li>`).join("")}</ul>
    <button type="button" class="btn soft sm" data-act="shipped" style="margin-top:10px">${item.shippedAt ? "Clear shipped mark" : "Mark as shipped"}</button>
  </div>`;
}

function shipSuggestCard(item) {
  const saved = item.shipSuggest || null;
  const s = saved || heuristicShip(item);
  const estimates = shippingEstimates(s.weightOz);
  const links = labelLinksFor(item.soldOn);
  return `<div class="card" id="shipsuggest">
    <div class="row between"><h3>One-tap shipping</h3>${honesty("warn", "Estimate")}</div>
    <p class="small">${esc(boxSizeLabel(s))}${saved ? "" : " <span class=\"tiny muted\">(simple estimate)</span>"}</p>
    <p class="tiny muted">${s.reason ? esc(s.reason) + " " : ""}${esc(SHIP_TABLE_NOTE)}</p>
    <button type="button" class="btn soft sm" data-act="aiship" style="margin-top:6px">${saved ? "Suggest again" : "Ask AI to suggest a box"}</button>
    <div class="tablewrap" style="margin-top:12px"><table class="fee-table">
      <thead><tr><th>Service</th><th>Estimate</th></tr></thead>
      <tbody>${estimates.map(r => `<tr><td>${esc(r.name)}${r.over ? " (heavy)" : ""}</td><td class="num">${esc(formatUsd(r.usd))}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="tiny muted">${honesty("later", "Coming later")} Buying a real label here needs a shipping service account.</p>
    <p class="small" style="margin-top:8px">Open a prepaid label page:</p>
    <div class="row wrap" style="gap:8px">${links.slice(0, 6).map(l => `<a class="chiplink" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join("")}</div>
  </div>`;
}

function compsCard(item) {
  const links = soldLinks(item, getEnabledIds());
  const stats = loggedCompStats(item);
  const ai = item.comps && item.comps.ai;
  const logged = (item.comps && item.comps.logged) || [];
  const official = ebayOfficialAdapter;
  return `<div class="card" id="comps">
    <div class="row between"><h3>Sold price check</h3>${honesty("warn", "Estimate")}</div>
    <p class="small muted">Check what similar items actually sold for. AI estimates are not live sold data. The best public check is eBay's own sold and completed listings.</p>
    ${ai ? `<div class="estimate">
      <div class="row between"><strong>AI sold-price estimate</strong>${honesty("warn", "AI estimate")}</div>
      <p class="big-num">${esc(ai.low != null || ai.high != null ? `${formatUsd(ai.low)} to ${formatUsd(ai.high)}` : "—")}${ai.typical != null ? ` <span class="small muted">typical ${esc(formatUsd(ai.typical))}</span>` : ""}</p>
      <p class="small">${ai.reason ? esc(ai.reason) : ""}</p>
    </div>` : ""}
    ${stats ? `<div class="estimate">
      <div class="row between"><strong>Sold prices you logged</strong>${honesty("ok", "Working")}</div>
      <p class="big-num">${esc(formatUsd(stats.low))} to ${esc(formatUsd(stats.high))}</p>
      <p class="small">Average ${esc(formatUsd(stats.average))} · median ${esc(formatUsd(stats.median))} · ${stats.count} price${stats.count === 1 ? "" : "s"}</p>
      <ul class="tiny muted">${logged.map(c => `<li>${esc(formatUsd(c.price))}${c.siteId ? " on " + esc(siteName(c.siteId)) : ""}${c.note ? " — " + esc(c.note) : ""} <button type="button" class="btn sm dangerghost" data-act="delcomp" data-id="${esc(c.id)}">Remove</button></li>`).join("")}</ul>
    </div>` : ""}
    ${links.query ? `<div class="searchlinks"><span class="tiny muted">Open sold or search pages:</span><div class="row wrap">${links.links.map(l =>
      `<a class="chiplink ${l.realSoldFilter ? "soldfilter" : ""}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
    ).join("")}</div>
    <p class="tiny muted">Green-outlined links go to a real sold or sold-out filter. The others are regular searches — those sites don't offer a public sold filter we can link to.</p></div>` : `<p class="tiny muted">Add a title to get sold-price search links.</p>`}
    <div class="row wrap" style="margin-top:10px;gap:8px">
      <button type="button" class="btn sm soft" data-act="logcomp">Log a sold price you found</button>
      <button type="button" class="btn sm soft" data-act="aicomps">Get an AI sold-price estimate</button>
    </div>
    <p class="tiny muted" style="margin-top:10px">${honesty("later", "Coming later")} Official eBay sold prices: ${esc(official.needs)}.</p>
  </div>`;
}

function dropsCard(drops) {
  return `<div class="card" id="drops">
    <div class="row between"><h3>Price-drop ideas</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">This listing has been up a while. Each idea is a suggestion. You approve it, then change it on the site yourself.</p>
    ${drops.map(d => `<div class="advice-block">
      <div class="row between"><h4>${esc(d.siteName)} · ${esc(d.actionLabel)}</h4><span class="pill">${esc(String(d.daysListed))} days</span></div>
      <p class="big-num">${esc(formatUsd(d.fromPrice))} → ${esc(formatUsd(d.toPrice))}</p>
      <p class="small">${esc(d.reason)}</p>
      <div class="row wrap" style="gap:8px;margin-top:8px">
        <button type="button" class="btn sm" data-act="approvedrop" data-id="${esc(d.id)}">Approve</button>
        <button type="button" class="btn sm soft" data-act="dismissdrop" data-id="${esc(d.id)}">Not now</button>
      </div>
    </div>`).join("")}
  </div>`;
}

function priceUpdateCard(item, todos) {
  const map = item.priceUpdates || {};
  return `<div class="card alert" id="price-todos">
    <div class="row between"><h3>Update these prices</h3>${honesty("warn", "Needs you to post")}</div>
    <p class="small muted">You approved a new asking price of ${esc(formatUsd(item.askingPrice))}. Change it on each site, then check it off.</p>
    <ul class="delist">${todos.map(id => {
      const s = siteById(id);
      const u = map[id] || {};
      return `<li>
        <label class="check">
          <input type="checkbox" data-act="priceupdated" data-site="${esc(id)}" ${u.needed ? "" : "checked"}>
          <span>${esc(s ? s.name : id)} → ${esc(formatUsd(u.toPrice))}${u.action === "offers" ? " (or send offers)" : ""}</span>
        </label>
        <a class="btn sm soft" href="${esc(s ? s.manageUrl : "#")}" target="_blank" rel="noopener">Open ${esc(s ? (s.short || s.name) : id)}</a>
      </li>`;
    }).join("")}</ul>
  </div>`;
}

export { formatDuration };
