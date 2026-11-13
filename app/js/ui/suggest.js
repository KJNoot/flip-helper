// "Send a suggestion" opens a pre-filled email (mailto) to this bot's inbox
// so a tester can send ideas without an account.
import { esc, $, closeSheets } from "./dom.js";

export const SUGGEST_TO = "kens.remi@mail.grokbot.com";
export const SUGGEST_SUBJECT = "Flip Side suggestion";

export function suggestMailto({ version = "", screen = "", text = "" } = {}) {
  const body = [
    `App version: ${version || ""}`,
    `Screen: ${screen || "(not specified)"}`,
    "",
    String(text || "").trim()
  ].join("\n");
  return `mailto:${SUGGEST_TO}?subject=${encodeURIComponent(SUGGEST_SUBJECT)}&body=${encodeURIComponent(body)}`;
}

export function openSuggest(ctx = {}) {
  closeSheets();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="suggest-title">
    <h2 id="suggest-title">Send a suggestion</h2>
    <p class="muted">Tell us what to change or add. This opens an email you can look over and send.</p>
    <label class="field"><span>Your suggestion</span>
      <textarea id="suggest-text" rows="5" maxlength="2000" required placeholder="What should we change or add?"></textarea>
    </label>
    <p class="tiny muted" id="suggest-need" hidden>Write a short suggestion first.</p>
    <div class="stack" style="margin-top:16px">
      <button type="button" class="btn" data-r="send">Send a suggestion</button>
      <button type="button" class="btn soft" data-r="0">Cancel</button>
    </div>
  </div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", e => {
    const b = e.target.closest("[data-r]");
    if (e.target === bg || (b && b.dataset.r === "0")) { close(); return; }
    if (!(b && b.dataset.r === "send")) return;
    const text = ($("#suggest-text", bg).value || "").trim();
    const need = $("#suggest-need", bg);
    if (!text) { if (need) need.hidden = false; $("#suggest-text", bg).focus(); return; }
    if (need) need.hidden = true;
    const href = suggestMailto({ version: ctx.version, screen: ctx.screen, text });
    bg.dataset.mailto = href;
    close();
    location.href = href;
  });
  document.body.appendChild(bg);
  const box = $("#suggest-text", bg); if (box) box.focus();
  return bg;
}
