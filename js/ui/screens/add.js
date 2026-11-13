import { esc, $, toast, bind, honesty } from "../dom.js";
import { emptyItem, applyFields, formatUsd, setSitePlan } from "../../core/inventory.js";
import { photoFromFile, requestDraft, applyDraft, MAX_PHOTOS } from "../../core/draft.js";
import { hasKey } from "../../core/key.js";
import { fieldsHtml, readFields, adviceHtml } from "./form.js";
import { getEnabledIds } from "../../core/prefs.js";
import { openCleanup } from "../cleanup.js";

export function renderAdd(ctx, el) {
  if (!ctx.work || ctx.work.saved) ctx.work = emptyWork();
  paint(ctx, el);
}

function emptyWork() {
  return { item: emptyItem(), busy: false, error: "", step: "photos" };
}

function paint(ctx, el) {
  const w = ctx.work;
  const item = w.item;
  const photos = item.photos || [];
  const hasDraft = !!(item.title || item.description || item.priceLow || item.priceHigh);

  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>Add an item</h2><span class="spacer48"></span></div>
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
      ${photos.length ? `<button type="button" class="btn soft sm" data-act="cleanup" style="margin-top:10px">Clean up photos (basic)</button>` : ""}
    </div>
    <div class="card">
      <label class="field"><span>What you paid (optional)</span>
        <input id="cost0" type="text" inputmode="decimal" value="${esc(item.costPaid ?? "")}" placeholder="0.00">
      </label>
      <label class="field"><span>Anything the draft should know (optional)</span>
        <textarea id="ainotes" rows="2" placeholder="Brand, size, flaws, where you bought it">${esc(w.aiNotes || "")}</textarea>
      </label>
      <div class="stack">
        <button type="button" class="btn" data-act="aidraft" ${w.busy ? "disabled" : ""}>${w.busy ? "Looking at your photo…" : "✨ Make a draft from the photo"}</button>
        <button type="button" class="btn soft" data-act="manual" ${w.busy ? "disabled" : ""}>Write it myself</button>
      </div>
      ${!hasKey() ? `<p class="tiny muted" style="margin-top:10px">To use the photo draft, paste the AI key in <a href="#/settings">Settings</a> first.</p>` : ""}
      ${w.error ? `<p class="attn" id="ai-error">${esc(w.error)}</p>` : ""}
    </div>
    ${hasDraft || w.step === "review" ? reviewBlock(item) : ""}
  `;

  const onFiles = async (input) => {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    try {
      for (const f of files) {
        if ((ctx.work.item.photos || []).length >= MAX_PHOTOS) break;
        const photo = await photoFromFile(f);
        ctx.work.item = { ...ctx.work.item, photos: [...(ctx.work.item.photos || []), photo] };
      }
      paint(ctx, el);
    } catch (e) { toast(e.message || "That photo couldn't be used."); }
  };
  const cam = $("#cam", el), lib = $("#lib", el);
  if (cam) cam.addEventListener("change", () => onFiles(cam));
  if (lib) lib.addEventListener("change", () => onFiles(lib));
  const cost0 = $("#cost0", el);
  if (cost0) cost0.addEventListener("change", () => { ctx.work.item = applyFields(ctx.work.item, { costPaid: cost0.value }); });
  const ainotes = $("#ainotes", el);
  if (ainotes) ainotes.addEventListener("input", () => { ctx.work.aiNotes = ainotes.value; });

  bind(el, {
    delphoto: b => {
      const i = +b.dataset.i;
      ctx.work.item = { ...ctx.work.item, photos: (ctx.work.item.photos || []).filter((_, n) => n !== i) };
      paint(ctx, el);
    },
    cleanup: () => {
      const first = (ctx.work.item.photos || [])[0];
      if (!first) { toast("Take a photo first"); return; }
      openCleanup({
        dataUrl: first.dataUrl,
        onApply: (dataUrl) => {
          const photos = (ctx.work.item.photos || []).slice();
          photos[0] = { ...photos[0], dataUrl, cleanedAt: Date.now(), cleaned: "basic" };
          ctx.work.item = { ...ctx.work.item, photos };
          toast("Photo cleaned up (basic)");
          paint(ctx, el);
        }
      });
    },
    manual: () => {
      syncTop(ctx, el);
      ctx.work.step = "review";
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
        ctx.work.item = applyDraft(ctx.work.item, draft);
        ctx.work.step = "review";
        ctx.work.busy = false;
        paint(ctx, el);
        toast("Draft ready. Please check it.");
        const t = $("#review", el); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        ctx.work.busy = false;
        ctx.work.error = e.message || "The draft couldn't be made.";
        ctx.work.step = "review"; // still allow writing it herself
        paint(ctx, el);
      }
    },
    plan: b => {
      syncTop(ctx, el);
      const fields = $("#review", el) ? readFields(el) : {};
      ctx.work.item = setSitePlan(applyFields(ctx.work.item, fields), b.dataset.plan);
      paint(ctx, el);
    },
    save: async () => {
      const fields = $("#review", el) ? readFields(el) : {};
      syncTop(ctx, el);
      const item = applyFields(ctx.work.item, fields);
      if (!item.title && !(item.photos || []).length) { toast("Add a photo or a title first"); return; }
      if (!item.title) item.title = "Untitled item";
      const saved = await ctx.save(item);
      ctx.work.saved = true;
      ctx.work = emptyWork();
      toast("Saved");
      ctx.go("#/item/" + saved.id);
    }
  });
}

function syncTop(ctx, el) {
  const cost0 = $("#cost0", el);
  const ainotes = $("#ainotes", el);
  if (cost0) ctx.work.item = applyFields(ctx.work.item, { costPaid: cost0.value });
  if (ainotes) ctx.work.aiNotes = ainotes.value;
}

function reviewBlock(item) {
  return `${adviceHtml(item)}
    <div class="card" id="review">
    <div class="row between"><h3>Check the draft</h3>${honesty("warn", "Please review")}</div>
    <p class="small muted">Fix anything that's wrong before you copy it to a selling site. Nothing is posted on its own.</p>
    ${fieldsHtml(item)}
    <button type="button" class="btn" data-act="save" style="margin-top:8px">Save this item</button>
  </div>`;
}

export { formatUsd };
