// Marketplace compatibility chart, US only.
import { esc, honesty } from "../dom.js";
import { COMPAT, COMPAT_DISCLAIMER, COMPAT_AS_OF, COMPAT_REGION } from "../../core/compat.js";

const PATH_KIND = {
  official: "ok",
  apply: "later",
  manual: "warn",
  forbidden: "warn",
  other: "later"
};

export function renderCompat(ctx, el) {
  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/settings" aria-label="Back">‹</a><h2>Site limits</h2><span class="spacer48"></span></div>
    <div class="card">
      <div class="row between"><h3>What each site allows</h3>${honesty("ok", "Working")}</div>
      <p class="small">${esc(COMPAT_DISCLAIMER)}</p>
      <p class="tiny muted">${esc(COMPAT_REGION)} · as of ${esc(COMPAT_AS_OF)}</p>
    </div>
    ${COMPAT.map(row).join("")}
  `;
}

function row(c) {
  const kind = PATH_KIND[c.path] || "warn";
  return `<div class="card compat-row" id="compat-${esc(c.id)}">
    <div class="row between"><h3>${esc(c.name)}</h3>${honesty(kind, c.pathLabel)}</div>
    ${c.officialApi
      ? `<p class="small"><b>Can be automated (official API):</b> ${esc(c.automate)}</p>`
      : `<p class="small"><b>Official automation:</b> ${esc(c.automate)}</p>`}
    <p class="small"><b>Needs your tap:</b> ${esc(c.needsTap)}</p>
    ${c.unavailable ? `<p class="small"><b>Not available:</b> ${esc(c.unavailable)}</p>` : ""}
    <p class="tiny muted">Sources:
      ${(c.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ")}
    </p>
  </div>`;
}
