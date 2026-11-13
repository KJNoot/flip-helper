// First-run walkthrough: 4 short, skippable screens.
import { esc, closeSheets } from "./dom.js";
import { WALKTHROUGH_SCREENS, setWalkthroughDone } from "../core/walkthrough.js";

export function openWalkthrough({ onDone } = {}) {
  closeSheets();
  let i = 0;
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.id = "walkthrough";
  const paint = () => {
    const s = WALKTHROUGH_SCREENS[i];
    const last = i === WALKTHROUGH_SCREENS.length - 1;
    bg.innerHTML = `<div class="sheet walk-sheet" role="dialog" aria-modal="true" aria-labelledby="walk-title">
      <p class="tiny muted">${i + 1} of ${WALKTHROUGH_SCREENS.length}</p>
      <h2 id="walk-title">${esc(s.title)}</h2>
      <p>${esc(s.body)}</p>
      ${s.extra ? `<p class="small muted">${esc(s.extra)}</p>` : ""}
      <div class="stack" style="margin-top:16px">
        <button type="button" class="btn btn-main" data-r="next">${last ? "Get started" : "Next"}</button>
        ${last ? "" : `<button type="button" class="btn soft" data-r="skip">Skip</button>`}
      </div>
    </div>`;
  };
  const finish = () => {
    setWalkthroughDone(true);
    bg.remove();
    if (onDone) onDone();
  };
  bg.addEventListener("click", e => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    if (b.dataset.r === "skip") { finish(); return; }
    if (b.dataset.r === "next") {
      if (i >= WALKTHROUGH_SCREENS.length - 1) { finish(); return; }
      i += 1;
      paint();
    }
  });
  document.body.appendChild(bg);
  paint();
  return bg;
}
