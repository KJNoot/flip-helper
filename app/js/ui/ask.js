// Floating "Ask a question" button and a simple chat sheet.
import { esc, $, toast, closeSheets } from "./dom.js";
import { hasKey } from "../core/key.js";
import { askQuestion, ASK_NO_KEY, ASK_WELCOME } from "../core/ask.js";
import { suggestMailto } from "./suggest.js";

const HISTORY_KEY = "flip-helper.askHistory";

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-12) : [];
  } catch (e) { return []; }
}
function writeHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify((h || []).slice(-12))); } catch (e) { /* quota */ }
}
export function clearAskHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
}

export function mountAskButton({ version, getScreen } = {}) {
  if (document.getElementById("ask-fab")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "ask-fab";
  btn.className = "ask-fab";
  btn.setAttribute("aria-label", "Ask a question");
  btn.innerHTML = `<span class="ask-fab-icon" aria-hidden="true">?</span><span class="ask-fab-label">Ask a question</span>`;
  btn.addEventListener("click", () => openAsk({ version, screen: getScreen ? getScreen() : "" }));
  document.body.appendChild(btn);
}

export function openAsk({ version = "", screen = "" } = {}) {
  closeSheets();
  const history = readHistory();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.id = "ask-sheet";
  const noKey = !hasKey();
  bg.innerHTML = `<div class="sheet ask-sheet" role="dialog" aria-modal="true" aria-labelledby="ask-title">
    <h2 id="ask-title">Ask a question</h2>
    ${noKey
      ? `<p class="small">${esc(ASK_NO_KEY)}</p>
         <a class="btn" href="#/settings" id="ask-goto-settings">Open Settings</a>
         <button type="button" class="btn soft" data-r="0" style="margin-top:8px">Close</button>`
      : `<p class="small muted">${esc(ASK_WELCOME)}</p>
         <div class="ask-log" id="ask-log"></div>
         <form id="ask-form" class="ask-form">
           <label class="field"><span>Your question</span>
             <textarea id="ask-input" rows="2" maxlength="800" required placeholder="e.g. How do I take a listing down?"></textarea>
           </label>
           <div class="stack">
             <button type="submit" class="btn" id="ask-send">Ask</button>
             <button type="button" class="btn soft" data-r="0">Close</button>
           </div>
         </form>`}
  </div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", e => {
    if (e.target === bg || (e.target.closest("[data-r]") && e.target.closest("[data-r]").dataset.r === "0")) close();
  });
  const settings = bg.querySelector("#ask-goto-settings");
  if (settings) settings.addEventListener("click", () => close());
  document.body.appendChild(bg);
  if (noKey) return bg;

  const log = $("#ask-log", bg);
  const paintLog = () => {
    log.innerHTML = history.map(h => `<div class="ask-bubble ${esc(h.role)}">
      <p class="small">${esc(h.content)}</p>
      ${h.featureRequest && h.suggestion ? `<button type="button" class="btn sm" data-act="sendsug" data-sug="${esc(h.suggestion)}">Send this as a suggestion</button>` : ""}
    </div>`).join("") || `<p class="tiny muted">No questions yet.</p>`;
    log.scrollTop = log.scrollHeight;
  };
  paintLog();

  log.addEventListener("click", e => {
    const b = e.target.closest("[data-act='sendsug']");
    if (!b) return;
    const href = suggestMailto({ version, screen, text: b.dataset.sug || "" });
    close();
    location.href = href;
  });

  $("#ask-form", bg).addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#ask-input", bg);
    const q = (input.value || "").trim();
    if (!q) { toast("Type a question first"); return; }
    const send = $("#ask-send", bg);
    send.disabled = true;
    send.textContent = "Thinking…";
    history.push({ role: "user", content: q });
    paintLog();
    input.value = "";
    try {
      const prior = history.filter(h => h.role === "user" || h.role === "assistant").slice(0, -1);
      const res = await askQuestion({
        question: q,
        screen,
        version,
        history: prior.map(h => ({ role: h.role, content: h.content }))
      });
      history.push({
        role: "assistant",
        content: res.answer,
        featureRequest: res.featureRequest,
        suggestion: res.suggestion
      });
      write(history);
      paintLog();
    } catch (err) {
      history.pop(); // remove the unanswered user turn? keep it and show error
      history.push({ role: "user", content: q });
      const msg = err && err.message ? err.message : "The helper couldn't answer. Try again.";
      toast(msg);
      const errBubble = document.createElement("div");
      errBubble.className = "ask-bubble assistant";
      errBubble.innerHTML = `<p class="small attn">${esc(msg)}</p>`;
      log.appendChild(errBubble);
    }
    send.disabled = false;
    send.textContent = "Ask";
    input.focus();
  });
  const box = $("#ask-input", bg);
  if (box) box.focus();
  return bg;
}

function write(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify((h || []).slice(-12))); } catch (e) {}
}

export { ASK_NO_KEY, ASK_WELCOME };
