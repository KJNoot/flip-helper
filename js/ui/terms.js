// Invite-only agreement overlay. Public visitors never see this.
import { esc } from "./dom.js";
import {
  TERMS_TITLE, TERMS_POINTS, TERMS_FULL_NOTE, TERMS_CHECK_LABEL, TERMS_VERSION,
  canAgree, setTermsAccepted, getAcceptance, agreeMailto
} from "../core/invite.js";

let root = null;
let onDone = null;
let accepted = null;

export function isTermsOpen() { return !!root; }

export function closeTerms({ completed = false } = {}) {
  if (root) { root.remove(); root = null; }
  document.body.classList.remove("terms-open");
  const html = document.documentElement;
  delete html.dataset.terms;
  if (onDone) {
    const fn = onDone;
    onDone = null;
    fn({ completed, acceptance: accepted });
  }
}

function summaryHtml() {
  return `<div class="terms-summary">
    ${TERMS_POINTS.map(p => `<p>${esc(p)}</p>`).join("")}
    <p class="muted">${esc(TERMS_FULL_NOTE)}</p>
  </div>`;
}

function agreeHtml() {
  return `<div class="terms-sheet" data-terms-step="agree">
    <h1 id="terms-title">${esc(TERMS_TITLE)}</h1>
    ${summaryHtml()}
    <label class="check terms-check">
      <input type="checkbox" id="terms-agree">
      <span>${esc(TERMS_CHECK_LABEL)}</span>
    </label>
    <label class="field">
      <span>Your name</span>
      <input type="text" id="terms-name" autocomplete="name" enterkeyhint="done" autocapitalize="words" spellcheck="false">
    </label>
    <button type="button" class="btn btn-main" data-act="accept" disabled>Agree and continue</button>
  </div>`;
}

function thanksHtml(rec) {
  const href = agreeMailto(rec);
  return `<div class="terms-sheet" data-terms-step="thanks">
    <h1 id="terms-title">You're in</h1>
    <p>Thanks. You can send Ken a quick OK from your own mail app, or just continue to the video.</p>
    <div class="stack">
      <a class="btn" data-act="mailto" href="${esc(href)}">Send my OK to Ken</a>
      <button type="button" class="btn soft" data-act="continue">Continue</button>
    </div>
  </div>`;
}

function readHtml() {
  return `<div class="terms-sheet" data-terms-step="read">
    <h1 id="terms-title">${esc(TERMS_TITLE)}</h1>
    ${summaryHtml()}
    <button type="button" class="btn" data-act="close">Close</button>
  </div>`;
}

function syncAcceptEnabled() {
  if (!root) return;
  const btn = root.querySelector('[data-act="accept"]');
  if (!btn) return;
  const agreed = !!(root.querySelector("#terms-agree") && root.querySelector("#terms-agree").checked);
  const name = root.querySelector("#terms-name") ? root.querySelector("#terms-name").value : "";
  btn.disabled = !canAgree({ agreed, name });
}

function paint(step) {
  if (!root) return;
  root.setAttribute("data-terms-step", step);
  document.documentElement.dataset.terms = step;
  if (step === "thanks") root.innerHTML = thanksHtml(accepted);
  else if (step === "read") root.innerHTML = readHtml();
  else root.innerHTML = agreeHtml();
  if (step === "agree") {
    const box = root.querySelector("#terms-agree");
    const name = root.querySelector("#terms-name");
    if (box) box.addEventListener("change", syncAcceptEnabled);
    if (name) {
      name.addEventListener("input", syncAcceptEnabled);
      name.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          const btn = root.querySelector('[data-act="accept"]');
          if (btn && !btn.disabled) onAct("accept");
        }
      });
    }
    syncAcceptEnabled();
  }
}

function onAct(act) {
  if (act === "accept") {
    const agreed = !!(root && root.querySelector("#terms-agree") && root.querySelector("#terms-agree").checked);
    const name = root && root.querySelector("#terms-name") ? root.querySelector("#terms-name").value : "";
    if (!canAgree({ agreed, name })) return;
    accepted = setTermsAccepted({
      name,
      acceptedAt: new Date().toISOString(),
      version: TERMS_VERSION
    });
    paint("thanks");
    return;
  }
  if (act === "mailto") {
    // The link opens the mail app. Never block continuing.
    return;
  }
  if (act === "continue" || act === "close") {
    closeTerms({ completed: act === "continue" || act === "close" });
  }
}

/**
 * mode: "agree" (first-open gate) or "read" (Settings reread).
 * After agree, a thanks step offers an optional mailto, then onDone fires.
 */
export function openTerms({ mode = "agree", onDone: done } = {}) {
  onDone = null;
  closeTerms({ completed: false });
  onDone = done || null;
  accepted = mode === "read" ? getAcceptance() : null;

  root = document.createElement("div");
  root.id = "terms-root";
  root.className = "terms-root";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "terms-title");
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.act === "mailto") return; // let the <a> open the mail app
    onAct(b.dataset.act);
  });
  document.body.classList.add("terms-open");
  document.body.appendChild(root);
  paint(mode === "read" ? "read" : "agree");
  return root;
}

export function getTermsAcceptance() { return accepted || getAcceptance(); }
