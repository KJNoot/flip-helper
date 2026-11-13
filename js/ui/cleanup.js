// "Clean up photo (basic)" sheet: preview, options, apply.
import { esc, $, toast, closeSheets } from "./dom.js";
import { cleanupDataUrl, PHOTO_CLEANUP_NOTE } from "../core/photo.js";

export function openCleanup({ dataUrl, onApply } = {}) {
  closeSheets();
  if (!dataUrl) { toast("Take a photo first"); return null; }
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cleanup-title">
    <h2 id="cleanup-title">Clean up photo <span class="honesty ok">Working, basic</span></h2>
    <p class="small muted">${esc(PHOTO_CLEANUP_NOTE)}</p>
    <div class="cleanup-preview"><img id="cleanup-img" alt="Preview" src="${esc(dataUrl)}"></div>
    <label class="check"><input type="checkbox" id="cu-brighten" checked><span>Auto brighten and contrast</span></label>
    <label class="check"><input type="checkbox" id="cu-square" checked><span>Crop to a square</span></label>
    <label class="check"><input type="checkbox" id="cu-white"><span>Plain background (basic)</span></label>
    <p class="tiny muted" id="cleanup-status"></p>
    <div class="stack" style="margin-top:16px">
      <button type="button" class="btn" data-r="preview">Preview</button>
      <button type="button" class="btn" data-r="apply">Use this photo</button>
      <button type="button" class="btn soft" data-r="0">Cancel</button>
    </div>
  </div>`;
  let current = dataUrl;
  const opts = () => ({
    brighten: $("#cu-brighten", bg).checked,
    square: $("#cu-square", bg).checked,
    whiteBackground: $("#cu-white", bg).checked
  });
  const run = async () => {
    const status = $("#cleanup-status", bg);
    status.textContent = "Cleaning up…";
    try {
      current = await cleanupDataUrl(dataUrl, opts());
      $("#cleanup-img", bg).src = current;
      status.textContent = "Preview updated. This stays on your phone.";
    } catch (e) {
      status.textContent = e.message || "The clean-up couldn't be done.";
    }
  };
  bg.addEventListener("click", async e => {
    const b = e.target.closest("[data-r]");
    if (e.target === bg || (b && b.dataset.r === "0")) { bg.remove(); return; }
    if (!b) return;
    if (b.dataset.r === "preview") { b.disabled = true; await run(); b.disabled = false; return; }
    if (b.dataset.r === "apply") {
      b.disabled = true;
      if (current === dataUrl) await run();
      bg.remove();
      if (onApply && current) onApply(current);
    }
  });
  document.body.appendChild(bg);
  // Auto-preview once so she sees a result immediately.
  run();
  return bg;
}
