import { esc, $, toast, bind, honesty } from "../dom.js";
import { emptyItem, applyFields, formatUsd, setSitePlan, newId } from "../../core/inventory.js";
import { photoFromFile, requestDraft, applyDraft, MAX_PHOTOS } from "../../core/draft.js";
import { hasKey } from "../../core/key.js";
import { fieldsHtml, readFields, adviceHtml, honestyBlock, mistakesBlock } from "./form.js";
import { getEnabledIds } from "../../core/prefs.js";
import { openCleanup } from "../cleanup.js";
import { saveWork, loadWork, clearWork, createHaulBatch, addPhotosToHaul, pendingHaulItems, markHaulItemSaved, saveBatch, loadBatch, clearBatch } from "../../core/autosave.js";
import { alreadyOwnedMatches, alreadyOwnedWarning } from "../../core/match.js";
import { applyCleanedPhoto, captureOriginals, pushHistory } from "../../core/history.js";
import { catchMistakes } from "../../core/mistakes.js";
import { beginDictate } from "../dictation.js";
import { STUDIO_NOTE, STUDIO_BUTTON } from "../../core/studio.js";
import { openTip } from "../tips.js";

export function renderAdd(ctx, el) {
  if (!ctx.work || ctx.work.saved) {
    const saved = loadWork();
    ctx.work = saved && saved.item ? { ...saved, saved: false, busy: false } : emptyWork();
  }
  if (!ctx.haul) {
    const b = loadBatch();
    ctx.haul = b && b.status !== "done" ? b : null;
  }
  paint(ctx, el);
}

function emptyWork() {
  return { item: emptyItem(), busy: false, error: "", step: "photos", haulMode: false };
}

let dictateSession = null;
let saveTimer = null;

function autosave(ctx) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveWork(ctx.work); }, 400);
}

function paint(ctx, el) {
  const w = ctx.work;
  const item = w.item;
  const photos = item.photos || [];
  const hasDraft = !!(item.title || item.description || item.priceLow || item.priceHigh);
  const haul = w.haulMode;
  const matches = item.title ? alreadyOwnedMatches(ctx.items, item.title, { excludeId: item.id }) : [];

  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>${haul ? "Photograph the whole haul" : "Add an item"}</h2><span class="spacer48"></span></div>
    <div class="card">
      <label class="check"><input type="checkbox" data-act="toggleghaul" ${haul ? "checked" : ""}><span>Photograph the whole haul — each photo becomes its own draft</span></label>
    </div>
    ${haul ? haulBlock(ctx) : `
    <div class="card">
      <h3>Photos</h3>
      <p class="small muted">Take a few shots — front, back, label, and any flaws. They stay on this phone unless you make an AI draft, which sends the pictures to the AI service.</p>
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
      ${photos.length ? `<button type="button" class="btn" data-act="cleanup" style="margin-top:10px">${esc(STUDIO_BUTTON)}</button>
        <p class="tiny muted"><span class="honesty ok">Recommended</span> ${esc(STUDIO_NOTE)}</p>` : ""}
    </div>
    <div class="card">
      <label class="field"><span>What you paid (optional)</span>
        <input id="cost0" type="text" inputmode="decimal" value="${esc(item.costPaid ?? "")}" placeholder="0.00">
      </label>
      <label class="field"><span>Anything the draft should know (optional)</span>
        <textarea id="ainotes" rows="2" placeholder="Brand, size, flaws, where you bought it">${esc(w.aiNotes || "")}</textarea>
      </label>
      <div class="stack">
        <button type="button" class="btn btn-main" data-act="aidraft" ${w.busy ? "disabled" : ""}>${w.busy ? "Looking at your photo…" : "✨ Make a draft from the photo"}</button>
        <button type="button" class="btn soft" data-act="manual" ${w.busy ? "disabled" : ""}>Write it myself</button>
      </div>
      ${!hasKey() ? `<p class="tiny muted" style="margin-top:10px">To use the photo draft, paste the AI key in <a href="#/settings">Settings</a> first.</p>` : ""}
      ${w.error ? `<p class="attn" id="ai-error">${esc(w.error)}</p>` : ""}
    </div>
    ${matches.length ? `<div class="card alert" id="already-own"><p class="small">${esc(alreadyOwnedWarning(matches))}</p>
      <ul class="itemlist">${matches.map(m => `<li><a class="li" href="#/item/${esc(m.id)}"><span class="grow"><b>${esc(m.title)}</b></span></a></li>`).join("")}</ul>
    </div>` : ""}
    ${hasDraft || w.step === "review" ? reviewBlock(item) : ""}
    `}
  `;

  const onFiles = async (input) => {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    try {
      if (ctx.work.haulMode) {
        const photos = [];
        for (const f of files) photos.push(await photoFromFile(f));
        ctx.haul = ctx.haul ? addPhotosToHaul(ctx.haul, photos) : createHaulBatch(photos);
        saveBatch(ctx.haul);
        paint(ctx, el);
        return;
      }
      for (const f of files) {
        if ((ctx.work.item.photos || []).length >= MAX_PHOTOS) break;
        const photo = await photoFromFile(f);
        ctx.work.item = { ...ctx.work.item, photos: [...(ctx.work.item.photos || []), photo] };
      }
      autosave(ctx);
      paint(ctx, el);
    } catch (e) { toast(e.message || "That photo couldn't be used."); }
  };
  const cam = $("#cam", el), lib = $("#lib", el);
  if (cam) cam.addEventListener("change", () => onFiles(cam));
  if (lib) lib.addEventListener("change", () => onFiles(lib));
  const cost0 = $("#cost0", el);
  if (cost0) cost0.addEventListener("change", () => { ctx.work.item = applyFields(ctx.work.item, { costPaid: cost0.value }); autosave(ctx); });
  const ainotes = $("#ainotes", el);
  if (ainotes) ainotes.addEventListener("input", () => { ctx.work.aiNotes = ainotes.value; autosave(ctx); });

  // Autosave as she types in the review form
  el.querySelectorAll("#review input, #review textarea").forEach(inp => {
    inp.addEventListener("input", () => {
      if ($("#review", el)) ctx.work.item = applyFields(ctx.work.item, readFields(el));
      autosave(ctx);
    });
  });

  bind(el, {
    toggleghaul: b => {
      ctx.work.haulMode = b.checked;
      paint(ctx, el);
    },
    delphoto: b => {
      const i = +b.dataset.i;
      ctx.work.item = { ...ctx.work.item, photos: (ctx.work.item.photos || []).filter((_, n) => n !== i) };
      autosave(ctx);
      paint(ctx, el);
    },
    delhaul: b => {
      if (!ctx.haul) return;
      ctx.haul = { ...ctx.haul, items: ctx.haul.items.filter(r => r.id !== b.dataset.id) };
      if (!ctx.haul.items.length) { clearBatch(); ctx.haul = null; }
      else saveBatch(ctx.haul);
      paint(ctx, el);
    },
    savedhaul: async () => {
      if (!ctx.haul) return;
      const pending = pendingHaulItems(ctx.haul, ctx.items);
      if (!pending.length) { toast("Every photo in this haul is already a draft"); return; }
      let last = null;
      for (const row of pending) {
        const it = emptyItem({
          id: row.id,
          photos: row.photo ? [row.photo] : [],
          title: row.title || "Haul photo",
          notes: "From a haul of photos."
        });
        last = await ctx.save(it);
        ctx.haul = markHaulItemSaved(ctx.haul, row.id);
      }
      saveBatch(ctx.haul);
      if (ctx.haul.status === "done") { clearBatch(); ctx.haul = null; }
      toast(pending.length === 1 ? "Saved a draft" : `Saved ${pending.length} drafts`);
      if (last) ctx.go("#/item/" + last.id);
      else paint(ctx, el);
    },
    cleanup: () => {
      const photos = ctx.work.item.photos || [];
      if (!photos.length) { toast("Take a photo first"); return; }
      const toastFor = (kind, many) => {
        if (kind === "studio") toast(many ? "Studio photos ready. The originals are kept. Check that flaws are still visible." : "Studio photo ready. The original is kept. Check that flaws are still visible.");
        else toast(many ? "Photos cleaned up (basic). The originals are kept." : "Photo cleaned up (basic). The original is kept.");
      };
      openCleanup({
        photos,
        index: 0,
        onApply: (dataUrl, { index = 0, kind = "studio" } = {}) => {
          const next = applyCleanedPhoto(ctx.work.item.photos || [], index, dataUrl, Date.now(), { kind });
          ctx.work.item = captureOriginals({ ...ctx.work.item, photos: next });
          toastFor(kind, false);
          autosave(ctx);
          paint(ctx, el);
        },
        onApplyAll: (results) => {
          let list = ctx.work.item.photos || [];
          const at = Date.now();
          (results || []).forEach((r, i) => {
            if (r && r.dataUrl) list = applyCleanedPhoto(list, i, r.dataUrl, at, { kind: r.kind || "studio" });
          });
          ctx.work.item = captureOriginals({ ...ctx.work.item, photos: list });
          const anyBasic = (results || []).some(r => r && r.kind === "basic");
          toastFor(anyBasic && !(results || []).some(r => r && r.kind === "studio") ? "basic" : "studio", true);
          autosave(ctx);
          paint(ctx, el);
        }
      });
    },
    manual: () => {
      syncTop(ctx, el);
      ctx.work.step = "review";
      autosave(ctx);
      paint(ctx, el);
      const t = $("#title", el); if (t) t.focus();
    },
    aidraft: async () => {
      syncTop(ctx, el);
      if (!(ctx.work.item.photos || []).length) { toast("Take a photo first"); return; }
      if (!hasKey()) { toast("Paste the AI key in Settings first"); ctx.go("#/settings"); return; }
      ctx.work.busy = true; ctx.work.error = ""; paint(ctx, el);
      try {
        const { draft } = await requestDraft({
          photos: ctx.work.item.photos,
          notes: ctx.work.aiNotes,
          costPaid: ctx.work.item.costPaid,
          enabledSites: getEnabledIds()
        });
        ctx.work.item = captureOriginals(applyDraft(ctx.work.item, draft));
        ctx.work.step = "review";
        ctx.work.busy = false;
        autosave(ctx);
        paint(ctx, el);
        toast("Draft ready. Please check it.");
        const t = $("#review", el); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        ctx.work.busy = false;
        ctx.work.error = e.message || "The draft couldn't be made.";
        ctx.work.step = "review";
        paint(ctx, el);
      }
    },
    plan: b => {
      syncTop(ctx, el);
      const fields = $("#review", el) ? readFields(el) : {};
      ctx.work.item = setSitePlan(applyFields(ctx.work.item, fields), b.dataset.plan);
      autosave(ctx);
      paint(ctx, el);
    },
    tip: b => openTip(b.dataset.tip || ""),
    dictate: b => {
      const id = b.dataset.input;
      const input = id ? document.getElementById(id) : null;
      if (dictateSession) { dictateSession.stop(); dictateSession = null; toast("Stopped listening."); return; }
      dictateSession = beginDictate(input, { onText() { autosave(ctx); } });
    },
    dismissmistake: b => {
      syncTop(ctx, el);
      const fields = $("#review", el) ? readFields(el) : {};
      let item = applyFields(ctx.work.item, fields);
      if (b.dataset.id === "brand") item.noBrand = true;
      if (b.dataset.id === "size") item.noSize = true;
      if (b.dataset.id === "flaws") { item.noFlaws = true; item.flawsNoted = true; }
      ctx.work.item = item;
      autosave(ctx);
      paint(ctx, el);
    },
    save: async () => {
      const fields = $("#review", el) ? readFields(el) : {};
      syncTop(ctx, el);
      let item = applyFields(ctx.work.item, fields);
      if (!item.title && !(item.photos || []).length) { toast("Add a photo or a title first"); return; }
      if (!item.title) item.title = "Untitled item";
      const issues = catchMistakes(item);
      if (issues.length) toast("Saved. Please look at the quick check — you can still add those later.");
      item = captureOriginals(item);
      const saved = await ctx.save(item);
      ctx.work.saved = true;
      clearWork();
      ctx.work = emptyWork();
      toast("Saved");
      ctx.go("#/item/" + saved.id);
    }
  });
}

function haulBlock(ctx) {
  const batch = ctx.haul;
  const items = (batch && batch.items) || [];
  const pending = pendingHaulItems(batch, ctx.items);
  return `<div class="card" id="haul">
    <div class="row between"><h3>The whole haul</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">Take a photo of each item. Jessika's Flip Side will make a separate draft for each one. If you leave and come back, it will pick up where you left off, without creating duplicates.</p>
    <div class="photos">
      ${items.map(r => `<div class="photo">
        <img src="${esc(r.photo && r.photo.dataUrl || "")}" alt="">
        ${r.saved ? `<span class="pill pill-sold" style="position:absolute;bottom:6px;left:6px">Saved</span>` : ""}
        <button type="button" class="iconbtn sm" data-act="delhaul" data-id="${esc(r.id)}" aria-label="Remove">×</button>
      </div>`).join("")}
      <label class="photo add">
        <input id="cam" type="file" accept="image/*" capture="environment" multiple hidden>
        <span>📷 Take</span>
      </label>
      <label class="photo add">
        <input id="lib" type="file" accept="image/*" multiple hidden>
        <span>🖼 Choose</span>
      </label>
    </div>
    ${pending.length ? `<button type="button" class="btn btn-main" data-act="savedhaul" style="margin-top:12px">Create ${pending.length} draft${pending.length === 1 ? "" : "s"}</button>` : (items.length ? `<p class="small ok">Every photo in this haul is already a draft.</p>` : "")}
  </div>`;
}

function syncTop(ctx, el) {
  const cost0 = $("#cost0", el);
  const ainotes = $("#ainotes", el);
  if (cost0) ctx.work.item = applyFields(ctx.work.item, { costPaid: cost0.value });
  if (ainotes) ctx.work.aiNotes = ainotes.value;
}

function reviewBlock(item) {
  return `${adviceHtml(item)}
    ${honestyBlock(item)}
    ${mistakesBlock(item)}
    <div class="card" id="review">
    <div class="row between"><h3>Check the draft</h3>${honesty("warn", "Please review")}</div>
    <p class="small muted">Fix anything that's wrong before you copy it to a selling site. Nothing is posted on its own.</p>
    ${fieldsHtml(item)}
    <button type="button" class="btn btn-main" data-act="save" style="margin-top:8px">Save this item</button>
  </div>`;
}

export { formatUsd, newId };
