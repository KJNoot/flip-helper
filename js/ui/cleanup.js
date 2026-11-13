// Studio-first photo sheet: “Make it look pro” is the recommended choice.
// The original basic clean-up is still here as a smaller option.
import { esc, $, toast, closeSheets } from "./dom.js";
import { cleanupDataUrl, PHOTO_CLEANUP_NOTE } from "../core/photo.js";
import {
  STUDIO_NOTE, STUDIO_BUTTON, STUDIO_BASIC_LINK, STUDIO_FALLBACK_MSG, STUDIO_EDGES_NOTE,
  STUDIO_PROGRESS_FIRST, STUDIO_PROGRESS_WORKING, STUDIO_RECOMMENDED,
  BACKGROUNDS, EXPORT_FRAMES, COVER_CHECK_NOTE, COVER_CHECK_LABEL,
  nextMattePreset, requestCoverCheck
} from "../core/studio.js";
import { ENHANCE_LOOK, ENHANCE_LABEL, ENHANCE_NOTE, ENHANCE_BLUR_LABEL, ENHANCE_CROP_LABEL, ENHANCE_PROGRESS, isEnhanceOptions } from "../core/enhance.js";
import { makeStudioPhoto, renderStudioJpeg } from "../core/segment.js";
import { hasKey, getKey } from "../core/key.js";

function photoList({ photos, dataUrl } = {}) {
  if (Array.isArray(photos) && photos.length) {
    return photos.map(p => {
      const url = typeof p === "string" ? p : (p.originalDataUrl || p.dataUrl);
      return { dataUrl: url, originalDataUrl: url };
    });
  }
  if (dataUrl) return [{ dataUrl, originalDataUrl: dataUrl }];
  return [];
}

function defaultOptions() {
  return { look: "enhance", background: "enhance", shadow: false, straighten: true, center: true, crop: true, blurBg: true, aspect: "photo", matte: "default" };
}

export function openCleanup({ dataUrl, photos, index = 0, onApply, onApplyAll } = {}) {
  closeSheets();
  const list = photoList({ photos, dataUrl });
  if (!list.length) { toast("Take a photo first"); return null; }
  let idx = Math.max(0, Math.min(index, list.length - 1));
  let opts = defaultOptions();
  let mode = "studio"; // or "basic"
  let cache = {}; // idx -> { source, dataUrl, fallback, message, elapsedMs }
  let basicUrl = "";
  let busy = false;
  let lastMsg = "";
  let coverTip = "";

  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  const originalOf = i => list[i].originalDataUrl || list[i].dataUrl;

  const paint = () => {
    const n = list.length;
    const cached = cache[idx];
    const after = (mode === "basic" ? basicUrl : (cached && cached.dataUrl)) || "";
    const before = originalOf(idx);
    const tall = opts.aspect === "portrait";
    const isEnhance = isEnhanceOptions(opts);
    const shadowOff = isEnhance || opts.background === "original";
    const progress = lastMsg ? `<p class="tiny" id="studio-progress">${esc(lastMsg)}</p>` : `<p class="tiny" id="studio-progress"></p>`;
    const thumbs = n > 1 ? `<div class="studio-thumbs" role="list">${list.map((p, i) =>
      `<button type="button" class="studio-thumb${i === idx ? " on" : ""}" data-r="thumb" data-i="${i}" aria-label="Photo ${i + 1}"${i === idx ? " aria-current=\"true\"" : ""}>
        <img src="${esc(p.originalDataUrl)}" alt="">
      </button>`).join("")}</div>` : "";

    bg.innerHTML = `<div class="sheet studio-sheet" role="dialog" aria-modal="true" aria-labelledby="cleanup-title">
      <h2 id="cleanup-title">${esc(STUDIO_BUTTON)} <span class="honesty ok">${esc(STUDIO_RECOMMENDED)}</span></h2>
      <p class="small muted">${esc(STUDIO_NOTE)}</p>
      ${progress}
      <div class="ba${tall ? " is-tall" : ""}" id="studio-ba" style="--split:50">
        <img class="ba-img ba-after" id="studio-after" alt="Studio photo" src="${esc(after || before)}">
        <div class="ba-clip" id="studio-clip">
          <img class="ba-img ba-before" id="studio-before" alt="Original photo" src="${esc(before)}">
        </div>
        <div class="ba-handle" aria-hidden="true"></div>
        <span class="ba-tag ba-tag-before">Original</span>
        <span class="ba-tag ba-tag-after">${mode === "basic" ? "Basic" : (isEnhanceOptions(opts) ? "Enhance" : "Studio")}</span>
        <input type="range" class="ba-range" id="studio-ba-range" min="0" max="100" value="50" aria-label="Slide between the original and the new photo">
      </div>
      ${thumbs}
      <p class="tiny muted" style="margin:10px 0 4px">Look</p>
      <div class="seg studio-bg-seg" id="studio-bg">
        ${["enhance", "white", "gray"].map(id => {
          const b = BACKGROUNDS[id];
          const on = (opts.look || opts.background) === id;
          return `<button type="button" class="${on ? "on" : ""}" data-r="bg" data-bg="${b.id}">${esc(b.label)}</button>`;
        }).join("")}
      </div>
      <p class="tiny muted" id="studio-bg-note">${esc((BACKGROUNDS[opts.look || opts.background] || BACKGROUNDS.enhance).note)}</p>
      ${isEnhance ? `<label class="check" id="studio-blur-wrap">
        <input type="checkbox" id="studio-blur"${opts.blurBg !== false ? " checked" : ""}>
        <span>${esc(ENHANCE_BLUR_LABEL)}</span>
      </label>
      <label class="check" id="studio-crop-wrap">
        <input type="checkbox" id="studio-crop"${opts.crop !== false ? " checked" : ""}>
        <span>${esc(ENHANCE_CROP_LABEL)}</span>
      </label>` : ""}
      <label class="check" id="studio-shadow-wrap"${shadowOff ? " style=\"display:none\"" : ""}>
        <input type="checkbox" id="studio-shadow"${opts.shadow ? " checked" : ""}>
        <span>Soft drop shadow</span>
      </label>
      <p class="tiny muted" style="margin:10px 0 4px">Size</p>
      <div class="seg studio-aspect-seg" id="studio-aspect">
        ${Object.values(EXPORT_FRAMES).map(f =>
          `<button type="button" class="${opts.aspect === f.id ? "on" : ""}" data-r="aspect" data-aspect="${f.id}">${esc(f.label)} (${esc(f.ratio)})</button>`
        ).join("")}
      </div>
      <p class="tiny muted" id="studio-aspect-note">${esc((EXPORT_FRAMES[opts.aspect] || EXPORT_FRAMES.square).note)}</p>
      <p class="tiny muted" style="margin-top:10px">${esc(STUDIO_EDGES_NOTE)}</p>
      <div class="row wrap" style="gap:8px;margin-top:6px">
        <button type="button" class="btn soft sm" data-r="retry">Try again</button>
        <button type="button" class="btn soft sm" data-r="basic">Use basic</button>
      </div>
      <div class="stack" style="margin-top:16px">
        <button type="button" class="btn btn-main" data-r="apply" ${busy ? "disabled" : ""}>Use this photo</button>
        ${n > 1 ? `<button type="button" class="btn soft" data-r="apply-all" ${busy ? "disabled" : ""}>Do all photos</button>` : ""}
        <button type="button" class="btn soft" data-r="0">Cancel</button>
      </div>
      <div class="studio-cover" id="cover-check">
        <p class="tiny muted" style="margin:14px 0 6px">${esc(COVER_CHECK_NOTE)}</p>
        ${hasKey()
          ? `<button type="button" class="btn soft sm" data-r="cover">${esc(COVER_CHECK_LABEL)}</button>`
          : `<p class="tiny muted">Paste the AI key in Settings to use this optional check.</p>`}
        <p class="small" id="cover-result">${coverTip ? esc(coverTip) : ""}</p>
      </div>
      <details class="more-block" id="studio-basic-panel"${mode === "basic" ? " open" : ""}>
        <summary>${esc(STUDIO_BASIC_LINK)}</summary>
        <p class="small muted">${esc(PHOTO_CLEANUP_NOTE)}</p>
        <label class="check"><input type="checkbox" id="cu-brighten" checked><span>Auto brighten and contrast</span></label>
        <label class="check"><input type="checkbox" id="cu-square" checked><span>Crop to a square</span></label>
        <label class="check"><input type="checkbox" id="cu-white"><span>Plain background (basic)</span></label>
        <div class="stack" style="margin-top:10px">
          <button type="button" class="btn soft" data-r="preview-basic">Preview basic</button>
          <button type="button" class="btn" data-r="apply-basic">Use this basic photo</button>
        </div>
      </details>
    </div>`;
    wireSlider();
    const sh = $("#studio-shadow", bg);
    if (sh) sh.addEventListener("change", async () => {
      opts.shadow = sh.checked;
      await rerender();
    });
    const bl = $("#studio-blur", bg);
    if (bl) bl.addEventListener("change", async () => {
      opts.blurBg = bl.checked;
      await rerender();
    });
    const cr = $("#studio-crop", bg);
    if (cr) cr.addEventListener("change", async () => {
      opts.crop = cr.checked;
      await rerender();
    });
    const panel = $("#studio-basic-panel", bg);
    if (panel) panel.addEventListener("toggle", () => {
      if (panel.open && !basicUrl) runBasic();
    });
  };

  const setProgress = msg => {
    lastMsg = msg || "";
    const el = $("#studio-progress", bg);
    if (el) el.textContent = lastMsg;
  };

  const wireSlider = () => {
    const range = $("#studio-ba-range", bg);
    const ba = $("#studio-ba", bg);
    if (!range || !ba) return;
    const apply = v => {
      const split = Math.max(0.5, Math.min(99.5, Number(v)));
      ba.style.setProperty("--split", String(split));
    };
    apply(range.value);
    range.addEventListener("input", () => apply(range.value));
  };

  const basicOpts = () => ({
    brighten: ($("#cu-brighten", bg) || { checked: true }).checked,
    square: ($("#cu-square", bg) || { checked: true }).checked,
    whiteBackground: ($("#cu-white", bg) || { checked: false }).checked
  });

  const runBasic = async () => {
    setProgress("Cleaning up…");
    try {
      basicUrl = await cleanupDataUrl(originalOf(idx), basicOpts());
      mode = "basic";
      setProgress("Basic preview ready. The original is kept. Check that flaws are still visible.");
      const after = $("#studio-after", bg);
      if (after) after.src = basicUrl;
      const tag = bg.querySelector(".ba-tag-after");
      if (tag) tag.textContent = "Basic";
    } catch (e) {
      setProgress(e.message || "The clean-up couldn't be done.");
    }
  };

  const runStudio = async ({ force = false } = {}) => {
    if (busy) return;
    const key = idx + ":" + JSON.stringify(opts);
    if (!force && cache[idx] && cache[idx].optionKey === key && cache[idx].dataUrl) {
      const after = $("#studio-after", bg);
      if (after) after.src = cache[idx].dataUrl;
      return;
    }
    busy = true;
    mode = "studio";
    setProgress(STUDIO_PROGRESS_FIRST);
    try {
      const result = await makeStudioPhoto(originalOf(idx), opts, {
        onProgress: p => setProgress(p && p.message ? p.message : STUDIO_PROGRESS_WORKING)
      });
      if (result.fallback) {
        cache[idx] = { ...result, optionKey: key };
        basicUrl = result.dataUrl;
        mode = "basic";
        setProgress(result.message || STUDIO_FALLBACK_MSG);
        paint();
        const panel = $("#studio-basic-panel", bg);
        if (panel) panel.open = true;
        if (result.dataUrl && $("#studio-after", bg)) $("#studio-after", bg).src = result.dataUrl;
      } else {
        cache[idx] = { ...result, optionKey: key };
        setProgress(isEnhanceOptions(opts)
          ? "Enhanced photo ready. The original is kept. Check that flaws are still visible."
          : "Studio photo ready. The original is kept. Check that flaws are still visible.");
        const after = $("#studio-after", bg);
        if (after) after.src = result.dataUrl;
        const tag = bg.querySelector(".ba-tag-after");
        if (tag) tag.textContent = isEnhanceOptions(opts) ? "Enhance" : "Studio";
        const before = $("#studio-before", bg);
        if (before) before.src = originalOf(idx);
      }
    } catch (e) {
      setProgress(e.message || STUDIO_FALLBACK_MSG);
      mode = "basic";
      await runBasic();
    } finally {
      busy = false;
    }
  };

  const rerender = async () => {
    const cached = cache[idx];
    if (cached && cached.source && !cached.fallback) {
      try {
        const result = renderStudioJpeg(cached.source, opts);
        cache[idx] = { ...cached, ...result, optionKey: idx + ":" + JSON.stringify(opts), fallback: false };
        const after = $("#studio-after", bg);
        if (after) after.src = result.dataUrl;
        const ba = $("#studio-ba", bg);
        if (ba) ba.classList.toggle("is-tall", opts.aspect === "portrait");
        const wrap = $("#studio-shadow-wrap", bg);
        if (wrap) wrap.style.display = (isEnhanceOptions(opts) || opts.background === "original") ? "none" : "";
        mode = "studio";
        const tag = bg.querySelector(".ba-tag-after");
        if (tag) tag.textContent = isEnhanceOptions(opts) ? "Enhance" : "Studio";
        return;
      } catch (_) { /* fall through to a full run */ }
    }
    await runStudio({ force: true });
  };

  const applyOne = (url, kind, i) => {
    if (onApply && url) onApply(url, { index: i == null ? idx : i, kind });
  };

  bg.addEventListener("click", async e => {
    const b = e.target.closest("[data-r]");
    if (e.target === bg || (b && b.dataset.r === "0")) { bg.remove(); return; }
    if (!b) return;
    const r = b.dataset.r;
    if (r === "thumb") {
      idx = +b.dataset.i;
      basicUrl = "";
      mode = "studio";
      paint();
      await runStudio();
      return;
    }
    if (r === "bg") {
      opts.background = b.dataset.bg;
      opts.look = b.dataset.bg;
      if (isEnhanceOptions(opts)) opts.shadow = false;
      else opts.shadow = true;
      paint();
      await rerender();
      return;
    }
    if (r === "aspect") {
      opts.aspect = b.dataset.aspect;
      paint();
      await rerender();
      return;
    }
    if (r === "retry") {
      opts.matte = nextMattePreset(opts.matte);
      setProgress("Trying a slightly different edge…");
      await rerender();
      return;
    }
    if (r === "basic") {
      mode = "basic";
      const panel = $("#studio-basic-panel", bg);
      if (panel) panel.open = true;
      await runBasic();
      return;
    }
    if (r === "preview-basic") { await runBasic(); return; }
    if (r === "apply-basic") {
      if (!basicUrl) await runBasic();
      bg.remove();
      applyOne(basicUrl, "basic");
      return;
    }
    if (r === "apply") {
      if (mode === "basic") {
        if (!basicUrl) await runBasic();
        bg.remove();
        applyOne(basicUrl, "basic");
        return;
      }
      if (!cache[idx] || !cache[idx].dataUrl) await runStudio({ force: true });
      const c = cache[idx];
      if (!c || !c.dataUrl) { toast("The studio photo couldn't be made."); return; }
      bg.remove();
      applyOne(c.dataUrl, c.fallback ? "basic" : "studio");
      return;
    }
    if (r === "apply-all") {
      if (!onApplyAll) {
        // Fall back to applying the current photo only.
        bg.querySelector('[data-r="apply"]')?.click();
        return;
      }
      b.disabled = true;
      const results = [];
      for (let i = 0; i < list.length; i++) {
        idx = i;
        setProgress(`Photo ${i + 1} of ${list.length}…`);
        if (!(cache[i] && cache[i].source && !cache[i].fallback)) {
          await runStudio({ force: true });
        } else if (!cache[i].dataUrl || cache[i].optionKey !== (i + ":" + JSON.stringify(opts))) {
          try {
            cache[i] = { ...cache[i], ...renderStudioJpeg(cache[i].source, opts), fallback: false };
          } catch (_) {
            await runStudio({ force: true });
          }
        }
        const c = cache[i];
        results.push(c && c.dataUrl ? { dataUrl: c.dataUrl, kind: c.fallback ? "basic" : "studio", fallback: !!c.fallback } : null);
      }
      bg.remove();
      onApplyAll(results, { kind: "studio" });
      return;
    }
    if (r === "cover") {
      b.disabled = true;
      setProgress("Looking at your photos…");
      try {
        const tip = await requestCoverCheck({
          photos: list.map(p => p.dataUrl),
          key: getKey()
        });
        const missing = tip.missing ? ` A missing angle that would help: ${tip.missing}.` : "";
        const cover = tip.cover && list.length > 1 ? ` Lead with photo ${tip.cover}.` : "";
        coverTip = (tip.tip || "Here's a suggestion.") + cover + missing + " This is a suggestion, not a requirement.";
        const el = $("#cover-result", bg);
        if (el) el.textContent = coverTip;
        setProgress("");
      } catch (err) {
        coverTip = err.message || "The cover photo check couldn't run. You can still use your photos as they are.";
        const el = $("#cover-result", bg);
        if (el) el.textContent = coverTip;
        setProgress("");
      } finally {
        b.disabled = false;
      }
    }
  });

  document.body.appendChild(bg);
  paint();
  // Auto-run the studio path so she sees a result. First time shows the friendly wait line.
  runStudio();
  return bg;
}
