import { esc, $, toast, bind, honesty, pill, copyText, confirmSheet, promptSheet, download } from "../dom.js";
import {
  applyFields, setListed, markSold, markDelisted, markShipped, setShipCheck,
  listingCopy, listedSiteIds, delistTargets, pendingDelist, isDelisted,
  needsDelistHighlight, isFullyDelisted, profit, formatUsd, statusLine,
  SHIP_CHECKS, siteName, STAGE_LABELS, setSitePlan, planSiteIds, money
} from "../../core/inventory.js";
import { SITES, SITE_IDS, siteById } from "../../core/sites.js";
import { photoFromFile, requestCompsEstimate, requestShipSuggest, MAX_PHOTOS } from "../../core/draft.js";
import { fieldsHtml, readFields, adviceHtml, honestyBlock, mistakesBlock } from "./form.js";
import { getEnabledIds, sitesForItem } from "../../core/prefs.js";
import { delistCountdown, formatDuration } from "../../core/protect.js";
import { soldLinks, addLoggedComp, removeLoggedComp, loggedCompStats, setAiComps, normalizeAiComps, ebayOfficialAdapter, hasSoldData, NO_SOLD_DATA } from "../../core/comps.js";
import { suggestionsForItem, recordDropDecision, markPriceUpdated, pendingPriceUpdates } from "../../core/drops.js";
import { getSettings, addTrip, mileageRateFor, ymd, PAUSE_NOTE_ON } from "../../core/settings.js";
import { heuristicShip, normalizeShipSuggest, shippingEstimates, boxSizeLabel, labelLinksFor, SHIP_TABLE_NOTE, effectiveShipCost, packedDims, applyBoxToItem } from "../../core/shipping.js";
import { hasKey } from "../../core/key.js";
import { openCleanup } from "../cleanup.js";
import { PHOTO_CLEANUP_NOTE } from "../../core/photo.js";
import {
  SITE_STATUS_NOTE, siteStatusList, siteStatusOf, confirmSiteDone, retrySiteStatus,
  startGuidedTakedown, guidedCurrent, advanceGuidedTakedown,
  GUIDED_TAKEDOWN_NOTE, GUIDED_TAKEDOWN_PAUSED, DOUBLE_SALE_CAVEAT, formatLastCheck, statusLabel
} from "../../core/sitestatus.js";
import { profitBreakdown, PROFIT_NOTE } from "../../core/profit.js";
import { itemQrSvg, printLabelHtml, itemQrPayload } from "../../core/qr.js";
import { pricingOptions, applyPricingChoice, PRICING_NOTE } from "../../core/pricing.js";
import { pushHistory, undoLast, canUndo, applyCleanedPhoto, restorePhotoOriginal, photoHasOriginal, restoreOriginals, captureOriginals, previewSnapshot } from "../../core/history.js";
import { catchMistakes, dismissMistake } from "../../core/mistakes.js";
import { beginDictate } from "../dictation.js";
import { openTip, tip } from "../tips.js";
import { compatLimitsNote } from "../../core/compat.js";
import { closeSheets } from "../dom.js";

let clockTimer = null;
let dictateSession = null;
let guidedState = null;

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
  const settings = getSettings();
  const drops = suggestionsForItem(item, { days: settings.dropAfterDays, defaultFloor: settings.defaultProfitFloor });
  const priceTodos = pendingPriceUpdates(item);
  const mainAction = alert ? "delist" : (!item.soldAt && !listed.length ? "post" : (item.soldAt && !item.shippedAt ? "ship" : ""));

  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/items" aria-label="Back">‹</a><h2 class="clamp2">${esc(item.title || "Untitled item")}</h2><span class="spacer48"></span></div>
    <div class="row wrap" style="margin-bottom:8px">${pill(STAGE_LABELS[item.stage] || item.stage, item.stage)} ${alert ? pill("Take it down", "warn") : ""} ${item.unavailable && item.soldAt ? pill("Unavailable", "warn") : ""} ${item.binLocation ? pill("Bin " + item.binLocation) : ""}</div>

    <div class="photos">
      ${photos.map((ph, i) => `<div class="photo">
        <img src="${esc(ph.dataUrl)}" alt="Photo ${i + 1}">
        <button type="button" class="iconbtn sm" data-act="delphoto" data-i="${i}" aria-label="Remove photo">×</button>
      </div>`).join("")}
      ${photos.length < MAX_PHOTOS ? `
        <label class="photo add"><input id="cam" type="file" accept="image/*" capture="environment" hidden><span>📷</span></label>
        <label class="photo add"><input id="lib" type="file" accept="image/*" multiple hidden><span>🖼</span></label>` : ""}
    </div>
    ${photos.length ? `<div class="row wrap" style="margin-top:10px;gap:8px">
      <button type="button" class="btn soft sm" data-act="cleanup">Clean up photos (basic)</button>
      ${photos.some(photoHasOriginal) ? `<button type="button" class="btn soft sm" data-act="restorephoto">Restore original photo</button>` : ""}
    </div>` : ""}

    ${alert ? delistCard(item, targets, pending, countdown, settings) : (item.soldAt && targets.length && isFullyDelisted(item) ? `<div class="card okbox"><p>All other listings are checked off. Nice work.</p></div>` : "")}

    ${item.soldAt ? packAndSale(item, p) : ""}

    ${!item.soldAt ? pricingCard(item, listed) : ""}

    ${!item.soldAt ? adviceHtml(item) : ""}

    ${!item.soldAt && drops.length ? dropsCard(drops) : ""}
    ${priceTodos.length ? priceUpdateCard(item, priceTodos) : ""}

    ${mistakesBlock(item)}

    ${compsCard(item)}

    <div class="card" id="post">
      <div class="row between"><h3>Post it</h3>${honesty("warn", "Needs you to post")} ${tip("Copy the listing, open the site, paste it, and post it yourself. Then tick the site so Flip Helper can keep track. This app does not post for you.")}</div>
      <p class="small muted">Copy the listing, open the site's own selling page, paste it, and post it yourself. Then tick the site so Flip Helper can keep track.</p>
      ${siteLists(item, listed)}
    </div>

    ${statusCard(item, listed)}

    ${!item.soldAt ? `<div class="card">
      <h3>It sold</h3>
      <p class="small muted">When it sells on one site, mark it here. You'll get a loud take-down checklist for the others, with a countdown and reminders, so it doesn't sell twice. ${esc(DOUBLE_SALE_CAVEAT)}</p>
      <button type="button" class="btn ${mainAction === "" && listed.length ? "btn-main" : ""}" data-act="sold">Mark as sold</button>
    </div>` : ""}

    ${shipSuggestCard(item, settings)}

    ${honestyBlock(item)}

    <div class="card" id="fields">
      <h3>Listing details</h3>
      ${fieldsHtml(item, { hideSearch: true })}
      <div class="row wrap" style="margin-top:10px;gap:8px">
        <button type="button" class="btn" data-act="savefields">Save changes</button>
        ${canUndo(item) ? `<button type="button" class="btn soft" data-act="undo">Undo last edit</button>` : ""}
        ${item.originals ? `<button type="button" class="btn soft" data-act="restoretext">Restore original text</button>` : ""}
      </div>
    </div>

    <details class="more-block" id="more-item">
      <summary>More</summary>
      ${receiptsCard(item)}
      ${returnsCard(item)}
      ${mileageCard(item)}
      ${historyCard(item)}
      ${qrCard(item)}
    </details>

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
  const rec = $("#receipt-file", el);
  if (rec) rec.addEventListener("change", async () => {
    const files = [...(rec.files || [])];
    rec.value = "";
    try {
      let next = item;
      for (const f of files) {
        const photo = await photoFromFile(f);
        const receipts = [...(next.receipts || []), { id: "rc_" + Date.now().toString(36), dataUrl: photo.dataUrl, addedAt: Date.now(), note: "" }];
        next = { ...next, receipts };
      }
      await ctx.save(next);
      toast("Receipt saved on this phone");
      ctx.render();
    } catch (e) { toast(e.message || "That photo couldn't be used."); }
  });

  bind(el, {
    tip: b => openTip(b.dataset.tip || ""),
    delphoto: async b => {
      const next = { ...item, photos: (item.photos || []).filter((_, n) => n !== +b.dataset.i) };
      await ctx.save(next); ctx.render();
    },
    cleanup: () => {
      const first = (item.photos || [])[0];
      if (!first) { toast("Take a photo first"); return; }
      openCleanup({
        dataUrl: first.originalDataUrl || first.dataUrl,
        onApply: async (dataUrl) => {
          const photos = applyCleanedPhoto(item.photos || [], 0, dataUrl);
          await ctx.save(captureOriginals({ ...item, photos }));
          toast("Photo cleaned up (basic). The original is kept.");
          ctx.render();
        }
      });
    },
    restorephoto: async () => {
      const photos = (item.photos || []).map((_, i) => restorePhotoOriginal(item.photos, i)[i] ? restorePhotoOriginal(item.photos, i)[i] : item.photos[i]);
      // restore each that has an original
      let list = item.photos.slice();
      for (let i = 0; i < list.length; i++) {
        if (photoHasOriginal(list[i])) list = restorePhotoOriginal(list, i);
      }
      await ctx.save({ ...item, photos: list });
      toast("Original photo restored");
      ctx.render();
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
      const issues = catchMistakes(readMerged(el, item));
      if (issues.length) toast("Quick check: " + issues[0].title + " You can still paste and add it on the site.");
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
    "i-did-it": async b => {
      const next = confirmSiteDone(item, b.dataset.site);
      await ctx.save(markDelisted(next, b.dataset.site, true));
      toast("Marked as taken down on " + siteName(b.dataset.site));
      ctx.render();
    },
    retrystatus: async b => {
      const next = retrySiteStatus(item, b.dataset.site);
      await ctx.save(next);
      toast("Ready to try again. Automatic checks are coming later.");
      ctx.render();
    },
    takedownall: async () => {
      if (getSettings().pauseAutomation) {
        toast(GUIDED_TAKEDOWN_PAUSED);
        return;
      }
      const started = startGuidedTakedown(item);
      await ctx.save(started.item);
      if (started.done) { toast("There's nothing left to take down."); ctx.render(); return; }
      guidedState = started;
      ctx.render();
      openGuidedSheet(ctx, started);
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
          { id: "shipping", type: "text", inputmode: "decimal", label: "Shipping you paid (optional)", placeholder: "0.00", value: item.actualShipCost ?? item.shippingPaid ?? "" }
        ]
      });
      if (!values) return;
      const next = markSold(readMerged(el, item), { siteId: values.site, salePrice: values.sale, fees: values.fees, shippingPaid: values.shipping });
      await ctx.save(next);
      toast("Marked as sold. It's now unavailable everywhere.");
      ctx.render();
      if (pendingDelist(next).length) {
        if (ctx.onSold) ctx.onSold(next);
      }
    },
    savefields: async () => {
      let next = pushHistory(item, { kind: "edit", label: "Before editing details" });
      next = applyFields(next, readFields(el));
      await ctx.save(captureOriginals(next));
      toast("Saved");
      ctx.render();
    },
    undo: async () => {
      const next = undoLast(item);
      await ctx.save(next);
      toast("Undid the last edit");
      ctx.render();
    },
    restoretext: async () => {
      if (!(await confirmSheet({ title: "Restore the original text?", body: "This puts back the title and description from when the draft was first made. You can undo this.", ok: "Restore" }))) return;
      const next = restoreOriginals(item, { photos: false });
      await ctx.save(next);
      toast("Original text restored");
      ctx.render();
    },
    delete: async () => {
      if (!(await confirmSheet({ title: "Delete this item?", body: "It will be removed from this phone. This cannot be undone.", ok: "Delete", danger: true }))) return;
      await ctx.remove(item.id);
      toast("Item deleted");
      ctx.go("#/items");
    },
    dictate: b => {
      const id = b.dataset.input;
      const input = id ? document.getElementById(id) : null;
      if (dictateSession) { dictateSession.stop(); dictateSession = null; toast("Stopped listening."); return; }
      dictateSession = beginDictate(input);
    },
    dismissmistake: async b => {
      const next = dismissMistake(item, b.dataset.id);
      await ctx.save(next);
      ctx.render();
    },
    pricechoice: async b => {
      const next = applyPricingChoice(item, b.dataset.choice);
      await ctx.save(next);
      toast("Asking price set to " + formatUsd(next.askingPrice) + ". You still change it on each site yourself.");
      ctx.render();
    },
    logcomp: async () => {
      const enabled = getEnabledIds();
      const options = [{ value: "", label: "Not sure" }, ...SITES.filter(s => enabled.includes(s.id) || s.id === "ebay").map(s => ({ value: s.id, label: s.name }))];
      const values = await promptSheet({
        title: "Log a sold price you found",
        body: "Type a sold price you actually saw, for example on eBay sold listings. If you don't have this, leave it — the app will say “No sold data yet” rather than make up a number.",
        ok: "Save",
        fields: [
          { id: "price", type: "text", inputmode: "decimal", label: "Sold price", placeholder: "0.00", required: true },
          { id: "site", type: "select", label: "Where you saw it", options, value: "ebay" },
          { id: "date", type: "date", label: "Date (optional)", value: "" },
          { id: "condition", type: "text", label: "Condition (optional)", placeholder: "e.g. Good" },
          { id: "confidence", type: "select", label: "How sure are you it's the same item?", options: [
            { value: "high", label: "Pretty sure" },
            { value: "medium", label: "Somewhat sure" },
            { value: "low", label: "Just similar" }
          ], value: "medium" },
          { id: "note", type: "text", label: "Note (optional)", placeholder: "Anything else" }
        ]
      });
      if (!values) return;
      if (money(values.price) == null) { toast("Enter a sold price"); return; }
      const next = addLoggedComp(item, { price: values.price, siteId: values.site, note: values.note, date: values.date, condition: values.condition, confidence: values.confidence });
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
          title: item.title, category: item.category, brand: item.brand, condition: item.condition, photos: item.photos
        });
        const next = setAiComps(item, normalizeAiComps(json));
        await ctx.save(next);
        toast("Estimate ready. This is not sold data. Please check real sold listings.");
        ctx.render();
      } catch (e) { toast(e.message || "The estimate couldn't be made."); }
    },
    approvedrop: async b => {
      const sug = drops.find(d => d.id === b.dataset.id);
      if (!sug) return;
      if (!(await confirmSheet({
        title: `Drop the price on ${sug.siteName}?`,
        body: `This will change your asking price in Flip Helper to ${formatUsd(sug.toPrice)}. You'll still need to change it on ${sug.siteName} yourself. It will not go below your profit floor.`,
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
          const { json } = await requestShipSuggest({ photos: item.photos, title: item.title, category: item.category, condition: item.condition });
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
    },
    saveship: async () => {
      const w = $("#packed-oz", el);
      const l = $("#packed-l", el);
      const wi = $("#packed-w", el);
      const h = $("#packed-h", el);
      const actual = $("#actual-ship", el);
      const floor = $("#profit-floor", el);
      const next = applyFields(item, {
        packedWeightOz: w ? w.value : item.packedWeightOz,
        packedLengthIn: l ? l.value : item.packedLengthIn,
        packedWidthIn: wi ? wi.value : item.packedWidthIn,
        packedHeightIn: h ? h.value : item.packedHeightIn,
        actualShipCost: actual ? actual.value : item.actualShipCost,
        profitFloor: floor ? floor.value : item.profitFloor
      });
      await ctx.save(next);
      toast("Shipping details saved");
      ctx.render();
    },
    pickbox: async b => {
      const boxes = getSettings().boxes || [];
      const box = boxes.find(x => x.id === b.dataset.id);
      if (!box) return;
      await ctx.save(applyBoxToItem(item, box));
      toast("Using your " + box.label);
      ctx.render();
    },
    printqr: () => {
      const html = printLabelHtml(item);
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
      else toast("Couldn't open a print window. Try again, or allow pop-ups.");
    },
    delreceipt: async b => {
      const receipts = (item.receipts || []).filter(r => r.id !== b.dataset.id);
      await ctx.save({ ...item, receipts });
      ctx.render();
    },
    returnitem: async () => {
      const values = await promptSheet({
        title: "A return or refund",
        body: "If this item came back or you refunded the buyer, enter what happened. This is a record, not tax advice.",
        ok: "Save",
        fields: [
          { id: "refund", type: "text", inputmode: "decimal", label: "Refund amount", placeholder: "0.00", value: (item.returns && item.returns.refundAmount) ?? item.refunds ?? "", required: true },
          { id: "reason", type: "text", label: "Reason (optional)", placeholder: "Didn't fit, damaged…" }
        ]
      });
      if (!values) return;
      const next = applyFields(item, {
        refunds: values.refund,
        returns: { returned: true, refundAmount: values.refund, reason: values.reason, returnedAt: Date.now() }
      });
      await ctx.save(next);
      toast("Return recorded");
      ctx.render();
    },
    moneytaken: async () => {
      const values = await promptSheet({
        title: "Money you actually received",
        body: "What landed in your account, after fees. This can be different from the estimated profit.",
        ok: "Save",
        fields: [{ id: "got", type: "text", inputmode: "decimal", label: "Money received", placeholder: "0.00", value: item.moneyReceived ?? "", required: true }]
      });
      if (!values) return;
      await ctx.save(applyFields(item, { moneyReceived: values.got }));
      toast("Saved");
      ctx.render();
    },
    additemtrip: async () => {
      const rate = mileageRateFor(Date.now());
      const values = await promptSheet({
        title: "Add a trip for this item",
        body: `The rate for today is ${rate.rate} per mile (${rate.source}).`,
        ok: "Add trip",
        fields: [
          { id: "date", type: "date", label: "Date", value: ymd(), required: true },
          { id: "miles", type: "text", inputmode: "decimal", label: "Miles", placeholder: "12", required: true },
          { id: "purpose", type: "text", label: "Purpose (optional)", placeholder: "Post office, pickup…", value: item.title || "" }
        ]
      });
      if (!values) return;
      const trip = addTrip({ date: values.date, miles: values.miles, purpose: values.purpose, itemId: item.id });
      const ids = [...(item.mileageTripIds || []), trip.id];
      await ctx.save({ ...item, mileageTripIds: ids });
      toast("Trip saved");
      ctx.render();
    },
    saveprofit: async () => {
      const next = applyFields(item, {
        marketplaceFees: ($("#mfees", el) || {}).value,
        paymentFees: ($("#pfees", el) || {}).value,
        supplies: ($("#supplies", el) || {}).value,
        discounts: ($("#discounts", el) || {}).value,
        refunds: ($("#refunds", el) || {}).value,
        moneyReceived: ($("#received", el) || {}).value,
        actualShipCost: ($("#sale-ship", el) || {}).value || item.actualShipCost,
        costPaid: ($("#sale-cost", el) || {}).value || item.costPaid,
        salePrice: ($("#sale-price", el) || {}).value || item.salePrice
      });
      await ctx.save(next);
      toast("Profit details saved");
      ctx.render();
    }
  });
}

function openGuidedSheet(ctx, state) {
  closeSheets();
  const step = () => {
    const cur = guidedCurrent(state);
    if (cur.done) {
      closeSheets();
      toast("That's every site in the list.");
      ctx.render();
      return;
    }
    const bg = document.querySelector(".sheet-bg") || document.createElement("div");
    bg.className = "sheet-bg";
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <h2 id="guide-title">Take it down: ${esc(cur.number)} of ${esc(String(cur.total))}</h2>
      <p>Open <b>${esc(cur.name)}</b>, take the listing down or mark it sold, then come back and tap “I did it”.</p>
      <p class="small muted">${esc(GUIDED_TAKEDOWN_NOTE)}</p>
      <p class="tiny muted">${esc(DOUBLE_SALE_CAVEAT)}</p>
      <div class="stack" style="margin-top:16px">
        <a class="btn btn-main" href="${esc(cur.manageUrl)}" target="_blank" rel="noopener" data-r="open">Open ${esc(cur.short)}</a>
        <button type="button" class="btn" data-r="did">I did it</button>
        <button type="button" class="btn soft" data-r="skip">Skip for now</button>
        <button type="button" class="btn soft" data-r="stop">Stop</button>
      </div>
    </div>`;
    if (!bg.parentNode) document.body.appendChild(bg);
    bg.onclick = async e => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      if (b.dataset.r === "open") return; // let the link work
      if (b.dataset.r === "stop") { bg.remove(); ctx.render(); return; }
      const did = b.dataset.r === "did";
      const item = (ctx.items || []).find(i => i.id === (state.item && state.item.id)) || state.item;
      const advanced = advanceGuidedTakedown(item, state, { didIt: did });
      await ctx.save(advanced.item);
      state = { ...advanced.state, item: advanced.item };
      guidedState = state;
      if (state.done) { bg.remove(); toast(did ? "All other listings are checked off" : "Stopped. You can finish the rest from the checklist."); ctx.render(); return; }
      step();
    };
  };
  step();
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
  const st = siteStatusOf(item, s.id);
  const limit = compatLimitsNote(s.id);
  return `<li class="siterow${suggested ? " suggested" : ""}">
    <label class="check">
      <input type="checkbox" data-act="listed" data-site="${esc(s.id)}" ${on ? "checked" : ""}>
      <span>${esc(s.name)}${suggested ? ' <span class="pill pill-listed">Suggested</span>' : ""} ${on ? `<span class="pill pill-${esc(st.status)}">${esc(statusLabel(st.status))}</span>` : ""}
        ${s.note ? `<span class="tiny muted" style="display:block;font-weight:400">${esc(s.note)}</span>` : ""}
        ${limit ? `<span class="tiny muted" style="display:block;font-weight:400">${esc(limit)}</span>` : ""}
      </span>
    </label>
    <div class="row wrap siteacts">
      <button type="button" class="btn sm soft" data-act="copy" data-site="${esc(s.id)}">Copy for ${esc(s.short || s.name)}</button>
      <a class="btn sm ghost" href="${esc(s.sellUrl)}" target="_blank" rel="noopener">Open ${esc(s.short || s.name)} sell page</a>
    </div>
  </li>`;
}

function delistCard(item, targets, pending, countdown, settings) {
  const c = countdown || delistCountdown(item);
  const paused = settings && settings.pauseAutomation;
  return `<div class="card alert loud" id="delist">
    <div class="row between"><h3>Take it down — don't let it sell twice</h3>${honesty("ok", "Working")}</div>
    <p class="countdown ${c && c.overdue ? "overdue" : ""}" id="countdown-clock">${esc(c ? c.headline : "Take it down on the other sites now.")}</p>
    <p class="small">${c ? esc(c.sub) : "It sold" + (item.soldOn ? " on " + siteName(item.soldOn) : "") + ". Open each site, mark the listing sold or remove it, then check it off."} This is a checklist, not automatic. ${esc(DOUBLE_SALE_CAVEAT)} Reminders will keep coming until every site is checked off.</p>
    ${paused
      ? `<p class="small attn">${esc(GUIDED_TAKEDOWN_PAUSED)}</p>`
      : `<button type="button" class="btn btn-main" data-act="takedownall" id="takedown-all">Take them all down automatically</button>
         <p class="tiny muted">${esc(GUIDED_TAKEDOWN_NOTE)}</p>`}
    <ul class="delist">${targets.map(id => {
      const s = SITES.find(x => x.id === id);
      const done = isDelisted(item, id);
      const st = siteStatusOf(item, id);
      return `<li class="${done ? "done" : ""}">
        <label class="check">
          <input type="checkbox" data-act="delist" data-site="${esc(id)}" ${done ? "checked" : ""}>
          <span>${esc(s ? s.name : id)} <span class="pill">${esc(statusLabel(st.status))}</span></span>
        </label>
        <a class="btn sm" href="${esc(s ? s.manageUrl : "#")}" target="_blank" rel="noopener">Open to take it down</a>
      </li>`;
    }).join("")}</ul>
    ${pending.length === 0 ? `<p class="small ok">All checked off.</p>` : `<p class="small attn">${pending.length} still to take down.</p>`}
    <p class="tiny muted">A computer helper that can take listings down for you, the legal way, is coming later. See the roadmap.</p>
  </div>`;
}

function packAndSale(item, p) {
  const b = profitBreakdown(item);
  const photo = item.photos && item.photos[0];
  return `
    <div class="card" id="sold-pack">
      <div class="row between"><h3>It sold — pack it</h3>${honesty("ok", "Working")}</div>
      <div class="row" style="gap:12px;align-items:flex-start">
        ${photo ? `<img class="thumb" src="${esc(photo.dataUrl)}" alt="" width="88" height="88" style="width:88px;height:88px;border-radius:14px">` : ""}
        <div class="grow">
          <p class="small"><b>${esc(item.title || "Untitled item")}</b></p>
          <p class="small">${item.binLocation ? `Bin <b>${esc(item.binLocation)}</b>` : "No bin set — add one in the details below so you can find it."}</p>
        </div>
      </div>
      ${qrInline(item)}
      <h4 style="margin-top:12px">Packing checklist</h4>
      <ul class="checks" id="ship">${SHIP_CHECKS.map(c => `<li>
        <label class="check"><input type="checkbox" data-act="shipcheck" data-check="${esc(c.id)}" ${item.shipChecks && item.shipChecks[c.id] ? "checked" : ""}><span>${esc(c.label)}</span></label>
      </li>`).join("")}</ul>
      <button type="button" class="btn soft sm" data-act="shipped" style="margin-top:10px">${item.shippedAt ? "Clear shipped mark" : "Mark as shipped"}</button>
    </div>
    <div class="card" id="sale">
      <div class="row between"><h3>Sale and profit</h3>${honesty("ok", "Working")} ${tip(PROFIT_NOTE)}</div>
      <div class="stats tight">
        <div><span class="tiny muted">Sold on</span><b>${esc(item.soldOn ? siteName(item.soldOn) : "—")}</b></div>
        <div><span class="tiny muted">Sale price</span><b>${esc(formatUsd(item.salePrice))}</b></div>
        <div><span class="tiny muted">What you paid</span><b>${esc(formatUsd(b.cost))}</b></div>
        <div><span class="tiny muted">Marketplace fees</span><b>${esc(formatUsd(b.marketplaceFees))}</b></div>
        <div><span class="tiny muted">Payment fees</span><b>${esc(formatUsd(b.paymentFees))}</b></div>
        <div><span class="tiny muted">Postage</span><b>${esc(formatUsd(b.postage))}${b.postageIsActual ? "" : " <span class='tiny muted'>est.</span>"}</b></div>
        <div><span class="tiny muted">Supplies</span><b>${esc(formatUsd(b.supplies))}</b></div>
        <div><span class="tiny muted">Discounts</span><b>${esc(formatUsd(b.discounts))}</b></div>
        <div><span class="tiny muted">Refunds</span><b>${esc(formatUsd(b.refunds))}</b></div>
        <div><span class="tiny muted">Estimated profit</span><b>${esc(b.estimatedProfit == null ? "—" : formatUsd(b.estimatedProfit))}</b></div>
        <div><span class="tiny muted">Money received</span><b>${esc(b.moneyReceived == null ? "—" : formatUsd(b.moneyReceived))}</b></div>
        <div><span class="tiny muted">Profit from money received</span><b>${esc(b.receivedProfit == null ? "—" : formatUsd(b.receivedProfit))}</b></div>
      </div>
      <p class="tiny muted">${esc(PROFIT_NOTE)}</p>
      <p class="tiny muted">The headline profit figure is ${esc(p == null ? "—" : formatUsd(p))}.</p>
      <details class="more-block"><summary>Edit the numbers</summary>
        <div class="grid2">
          <label class="field"><span>Sale price</span><input id="sale-price" inputmode="decimal" value="${esc(item.salePrice ?? "")}"></label>
          <label class="field"><span>What you paid</span><input id="sale-cost" inputmode="decimal" value="${esc(item.costPaid ?? "")}"></label>
          <label class="field"><span>Marketplace fees</span><input id="mfees" inputmode="decimal" value="${esc(item.marketplaceFees ?? "")}"></label>
          <label class="field"><span>Payment fees</span><input id="pfees" inputmode="decimal" value="${esc(item.paymentFees ?? "")}"></label>
          <label class="field"><span>Postage (actual)</span><input id="sale-ship" inputmode="decimal" value="${esc(item.actualShipCost ?? item.shippingPaid ?? "")}"></label>
          <label class="field"><span>Supplies</span><input id="supplies" inputmode="decimal" value="${esc(item.supplies ?? "")}"></label>
          <label class="field"><span>Discounts</span><input id="discounts" inputmode="decimal" value="${esc(item.discounts ?? "")}"></label>
          <label class="field"><span>Refunds</span><input id="refunds" inputmode="decimal" value="${esc(item.refunds ?? "")}"></label>
          <label class="field"><span>Money received</span><input id="received" inputmode="decimal" value="${esc(item.moneyReceived ?? "")}"></label>
        </div>
        <button type="button" class="btn soft sm" data-act="saveprofit">Save profit details</button>
      </details>
    </div>`;
}

function qrInline(item) {
  const svg = itemQrSvg(item, { module: 4, margin: 2 });
  return `<div class="qr-block" id="qr">
    <div class="row between"><h4>QR label</h4>${honesty("ok", "Working")}</div>
    <div class="qr-svg">${svg}</div>
    <p class="tiny muted">${item.binLocation ? "Bin " + esc(item.binLocation) + " · " : ""}${esc(itemQrPayload(item))}</p>
    <button type="button" class="btn soft sm" data-act="printqr">Print this label</button>
  </div>`;
}

function qrCard(item) {
  return `<div class="card">${qrInline(item)}
    <label class="field"><span>Bin location</span><input id="bin-more" value="${esc(item.binLocation || "")}" placeholder="e.g. A3" disabled>
    <p class="tiny muted">Change the bin in Listing details above, then Save changes.</p></label>
  </div>`;
}

function pricingCard(item, listed) {
  const ids = listed.length ? listed : getEnabledIds();
  const { options, note } = pricingOptions(item, ids);
  if (options.every(o => o.asking == null)) return "";
  return `<div class="card" id="pricing">
    <div class="row between"><h3>Three asking prices</h3>${honesty("warn", "Estimate")} ${tip(note)}</div>
    <p class="small muted">${esc(note)}</p>
    <div class="pricing-grid">
      ${options.map(o => `<div class="price-option ${item.pricingChoice === o.id ? "on" : ""}">
        <h4>${esc(o.label)}</h4>
        <p class="big-num">${esc(formatUsd(o.asking))}</p>
        <p class="tiny muted">${esc(o.blurb)}</p>
        <div class="tablewrap"><table class="fee-table">
          <thead><tr><th>Site</th><th>You keep</th></tr></thead>
          <tbody>${o.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${esc(formatUsd(r.proceeds))}</td></tr>`).join("")}</tbody>
        </table></div>
        <button type="button" class="btn sm ${item.pricingChoice === o.id ? "" : "soft"}" data-act="pricechoice" data-choice="${esc(o.id)}">${item.pricingChoice === o.id ? "Using this" : "Use this price"}</button>
      </div>`).join("")}
    </div>
  </div>`;
}

function statusCard(item, listed) {
  const ids = [...new Set([...listed, item.soldOn].filter(Boolean))];
  if (!ids.length && !item.soldAt) return "";
  const rows = siteStatusList(item, ids.length ? ids : listed);
  return `<div class="card" id="sitestatus">
    <div class="row between"><h3>Status on each site</h3>${honesty("ok", "Working")} ${tip(SITE_STATUS_NOTE)}</div>
    <p class="small muted">${esc(SITE_STATUS_NOTE)}</p>
    <ul class="status-list">${rows.map(r => `<li>
      <div class="row between"><b>${esc(r.fullName)}</b><span class="pill pill-${esc(r.status)}">${esc(r.label)}</span></div>
      <p class="tiny muted">Last check: ${esc(formatLastCheck(r.lastCheckAt))}${r.note ? " · " + esc(r.note) : ""}</p>
      <div class="row wrap" style="gap:8px">
        ${r.status !== "removed" && r.status !== "sold" && r.status !== "draft" ? `<button type="button" class="btn sm soft" data-act="i-did-it" data-site="${esc(r.siteId)}">I did it</button>` : ""}
        ${r.status === "failed" || r.status === "needsManual" ? `<button type="button" class="btn sm soft" data-act="retrystatus" data-site="${esc(r.siteId)}">Retry</button>` : ""}
        ${r.manageUrl ? `<a class="btn sm ghost" href="${esc(r.manageUrl)}" target="_blank" rel="noopener">Open ${esc(r.name)}</a>` : ""}
      </div>
    </li>`).join("")}</ul>
    <p class="tiny muted">${honesty("later", "Coming later")} Automatic checks that a listing is really live or gone.</p>
  </div>`;
}

function soldCardLegacy() { return ""; }

function shipSuggestCard(item, settings) {
  const saved = item.shipSuggest || null;
  const s = saved || heuristicShip(item);
  const dims = packedDims(item, (settings && settings.boxes) || []);
  const weight = dims.weightOz || s.weightOz;
  const estimates = shippingEstimates(weight);
  const links = labelLinksFor(item.soldOn);
  const eff = effectiveShipCost(item, weight);
  const boxes = (settings && settings.boxes) || [];
  return `<div class="card" id="shipsuggest">
    <div class="row between"><h3>One-tap shipping</h3>${honesty("warn", "Estimate")} ${tip(SHIP_TABLE_NOTE)}</div>
    <p class="small">${esc(boxSizeLabel({ ...s, ...dims, weightOz: weight }))}${saved ? "" : " <span class=\"tiny muted\">(simple estimate)</span>"}</p>
    <p class="tiny muted">${s.reason ? esc(s.reason) + " " : ""}${esc(SHIP_TABLE_NOTE)}</p>
    ${eff.actual ? `<p class="small">Actual shipping you entered: <b>${esc(formatUsd(eff.usd))}</b> — this replaces the estimate.</p>` : ""}
    <button type="button" class="btn soft sm" data-act="aiship" style="margin-top:6px">${saved ? "Suggest again" : "Ask AI to suggest a box"}</button>
    <div class="tablewrap" style="margin-top:12px"><table class="fee-table">
      <thead><tr><th>Service</th><th>Estimate</th></tr></thead>
      <tbody>${estimates.map(r => `<tr><td>${esc(r.name)}${r.over ? " (heavy)" : ""}</td><td class="num">${esc(formatUsd(r.usd))}</td></tr>`).join("")}</tbody>
    </table></div>
    <details class="more-block"><summary>Packed size, actual cost, and your boxes</summary>
      ${boxes.length ? `<p class="small">Your boxes:</p><div class="row wrap" style="gap:8px">${boxes.map(b => `<button type="button" class="btn sm soft" data-act="pickbox" data-id="${esc(b.id)}">${esc(b.label)}</button>`).join("")}</div>` : `<p class="tiny muted">Add saved box sizes in Settings.</p>`}
      <div class="grid2">
        <label class="field"><span>Packed weight (oz)</span><input id="packed-oz" inputmode="decimal" value="${esc(item.packedWeightOz ?? "")}"></label>
        <label class="field"><span>Actual shipping cost</span><input id="actual-ship" inputmode="decimal" value="${esc(item.actualShipCost ?? "")}" placeholder="Replaces the estimate"></label>
        <label class="field"><span>Length (in)</span><input id="packed-l" inputmode="decimal" value="${esc(item.packedLengthIn ?? "")}"></label>
        <label class="field"><span>Width (in)</span><input id="packed-w" inputmode="decimal" value="${esc(item.packedWidthIn ?? "")}"></label>
        <label class="field"><span>Height (in)</span><input id="packed-h" inputmode="decimal" value="${esc(item.packedHeightIn ?? "")}"></label>
        <label class="field"><span>Profit floor for this item</span><input id="profit-floor" inputmode="decimal" value="${esc(item.profitFloor ?? "")}" placeholder="Default is in Settings"></label>
      </div>
      <button type="button" class="btn soft sm" data-act="saveship">Save shipping details</button>
    </details>
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
  const noData = !hasSoldData(item);
  return `<div class="card" id="comps">
    <div class="row between"><h3>Sold price check</h3>${honesty("warn", "Estimate")} ${tip("Only sold prices you log, or official eBay data later, count as sold data. An AI estimate is not sold data.")}</div>
    <p class="small muted">Check what similar items actually sold for. AI estimates are not live sold data. The best public check is eBay's own sold and completed listings.</p>
    ${noData ? `<p class="small attn" id="no-sold-data">${esc(NO_SOLD_DATA)}. We will not make up a number.</p>` : ""}
    ${ai ? `<div class="estimate">
      <div class="row between"><strong>AI sold-price estimate</strong>${honesty("warn", "AI estimate")}</div>
      <p class="big-num">${esc(ai.low != null || ai.high != null ? `${formatUsd(ai.low)} to ${formatUsd(ai.high)}` : "—")}${ai.typical != null ? ` <span class="small muted">typical ${esc(formatUsd(ai.typical))}</span>` : ""}</p>
      <p class="small">${ai.reason ? esc(ai.reason) : ""}</p>
    </div>` : ""}
    ${stats ? `<div class="estimate">
      <div class="row between"><strong>Sold prices you logged</strong>${honesty("ok", "Working")}</div>
      <p class="big-num">${esc(formatUsd(stats.low))} to ${esc(formatUsd(stats.high))}</p>
      <p class="small">Average ${esc(formatUsd(stats.average))} · median ${esc(formatUsd(stats.median))} · ${stats.count} price${stats.count === 1 ? "" : "s"}</p>
      <ul class="tiny">${logged.map(c => `<li>${esc(formatUsd(c.price))}${c.siteId ? " on " + esc(siteName(c.siteId)) : ""}${c.date ? " · " + esc(c.date) : ""}${c.condition ? " · " + esc(c.condition) : ""}${c.confidence ? " · " + esc(c.confidence) : ""}${c.note ? " — " + esc(c.note) : ""} <button type="button" class="btn sm dangerghost" data-act="delcomp" data-id="${esc(c.id)}">Remove</button></li>`).join("")}</ul>
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
    <p class="small muted">This listing has been up a while. Each idea is a suggestion. You approve it, then change it on the site yourself. A drop will not go below your profit floor.</p>
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

function receiptsCard(item) {
  const list = item.receipts || [];
  return `<div class="card" id="receipts">
    <div class="row between"><h3>Receipts</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">Attach a photo of a receipt. It stays on this phone and is tied to this item.</p>
    ${list.length ? `<div class="photos">${list.map(r => `<div class="photo"><img src="${esc(r.dataUrl)}" alt="Receipt"><button type="button" class="iconbtn sm" data-act="delreceipt" data-id="${esc(r.id)}" aria-label="Remove">×</button></div>`).join("")}</div>` : ""}
    <label class="btn soft sm" style="margin-top:8px;cursor:pointer">Add a receipt photo<input type="file" id="receipt-file" accept="image/*" hidden></label>
  </div>`;
}

function returnsCard(item) {
  const r = item.returns;
  return `<div class="card">
    <div class="row between"><h3>Returns and refunds</h3>${honesty("ok", "Working")}</div>
    ${r && r.returned ? `<p class="small">Returned${r.returnedAt ? "" : ""}. Refund ${esc(formatUsd(r.refundAmount))}${r.reason ? " — " + esc(r.reason) : ""}.</p>` : `<p class="small muted">If this item comes back, record it here. It's a record, not tax advice.</p>`}
    <button type="button" class="btn soft sm" data-act="returnitem">${r && r.returned ? "Update the return" : "Record a return or refund"}</button>
    <button type="button" class="btn soft sm" data-act="moneytaken">Enter money received</button>
  </div>`;
}

function mileageCard(item) {
  return `<div class="card">
    <div class="row between"><h3>Mileage for this item</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">Log a trip to the post office or a pickup, tied to this item. You can also see all trips on the Taxes screen. Not tax advice.</p>
    <button type="button" class="btn soft sm" data-act="additemtrip">+ Add a trip</button>
    ${(item.mileageTripIds || []).length ? `<p class="tiny muted">${item.mileageTripIds.length} trip${item.mileageTripIds.length === 1 ? "" : "s"} tied to this item.</p>` : ""}
  </div>`;
}

function historyCard(item) {
  const hist = item.editHistory || [];
  if (!hist.length && !item.originals) return "";
  return `<div class="card">
    <div class="row between"><h3>Edit history</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">You can undo the last change, or restore the original text and photos.</p>
    ${item.originals ? `<p class="tiny muted">Original title: ${esc(item.originals.title || "(none)")}</p>` : ""}
    ${hist.length ? `<ul class="tiny">${hist.slice().reverse().slice(0, 8).map(h => `<li>${esc(h.label || h.kind)} — ${esc(h.at ? new Date(h.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "")}</li>`).join("")}</ul>` : ""}
  </div>`;
}

export { formatDuration, guidedState };
