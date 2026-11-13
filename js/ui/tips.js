// A small "?" on a tricky control. Opens a short, plain explanation.
import { esc, closeSheets } from "./dom.js";

export function tip(text, { label = "What is this?" } = {}) {
  const t = String(text || "").trim();
  if (!t) return "";
  return `<button type="button" class="tip-btn" data-act="tip" data-tip="${esc(t)}" aria-label="${esc(label)}">?</button>`;
}

export function openTip(text) {
  closeSheets();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="tip-title">
    <h2 id="tip-title">A quick tip</h2>
    <p class="small">${esc(text)}</p>
    <button type="button" class="btn" data-r="0" style="margin-top:12px">Got it</button>
  </div>`;
  bg.addEventListener("click", e => {
    if (e.target === bg || e.target.closest("[data-r]")) bg.remove();
  });
  document.body.appendChild(bg);
  return bg;
}

/** Bind data-act="tip" inside el. Safe to call along with other bind() handlers
 *  if you also handle "tip" there — this is a standalone helper. */
export function bindTips(el) {
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-act='tip']");
    if (!b || !el.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    openTip(b.dataset.tip || "");
  });
}
