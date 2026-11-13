export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function toast(msg) {
  const el = $("#toast") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "toast", className: "toast", role: "status" }));
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

export function topbar(title, { back } = {}) {
  const left = back
    ? `<a class="iconbtn" href="${esc(back)}" aria-label="Back">‹</a>`
    : `<span class="spacer48"></span>`;
  return `<div class="topbar">${left}<h2>${esc(title)}</h2><span class="spacer48"></span></div>`;
}

export function closeSheets() {
  document.querySelectorAll(".sheet-bg").forEach(el => el.remove());
}

export function confirmSheet({ title, body, ok = "OK", cancel = "Cancel", danger = false } = {}) {
  return new Promise(resolve => {
    closeSheets();
    const bg = document.createElement("div");
    bg.className = "sheet-bg";
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">${esc(title || "")}</h2>
      <p class="muted">${esc(body || "")}</p>
      <div class="stack" style="margin-top:16px">
        <button type="button" class="btn ${danger ? "danger" : ""}" data-r="1">${esc(ok)}</button>
        <button type="button" class="btn soft" data-r="0">${esc(cancel)}</button>
      </div>
    </div>`;
    const done = v => { bg.remove(); resolve(v); };
    bg.addEventListener("click", e => {
      const b = e.target.closest("[data-r]");
      if (e.target === bg || (b && b.dataset.r === "0")) done(false);
      else if (b && b.dataset.r === "1") done(true);
    });
    document.body.appendChild(bg);
  });
}

export function promptSheet({ title, body, fields = [], ok = "Save", cancel = "Cancel" } = {}) {
  return new Promise(resolve => {
    closeSheets();
    const bg = document.createElement("div");
    bg.className = "sheet-bg";
    const fieldsHtml = fields.map(f => {
      if (f.type === "select") {
        const opts = (f.options || []).map(o => `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.label)}</option>`).join("");
        return `<label class="field"><span>${esc(f.label)}</span><select id="${esc(f.id)}">${opts}</select></label>`;
      }
      const type = f.type || "text";
      return `<label class="field"><span>${esc(f.label)}</span><input id="${esc(f.id)}" type="${esc(type)}" inputmode="${esc(f.inputmode || "")}" value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder || "")}"></label>`;
    }).join("");
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
      <h2 id="prompt-title">${esc(title || "")}</h2>
      ${body ? `<p class="muted">${esc(body)}</p>` : ""}
      ${fieldsHtml}
      <p class="tiny muted" id="prompt-need" hidden>Fill in the required fields.</p>
      <div class="stack" style="margin-top:16px">
        <button type="button" class="btn" data-r="1">${esc(ok)}</button>
        <button type="button" class="btn soft" data-r="0">${esc(cancel)}</button>
      </div>
    </div>`;
    const done = v => { bg.remove(); resolve(v); };
    bg.addEventListener("click", e => {
      const b = e.target.closest("[data-r]");
      if (e.target === bg || (b && b.dataset.r === "0")) { done(null); return; }
      if (!(b && b.dataset.r === "1")) return;
      const values = {};
      for (const f of fields) {
        const el = $(`#${f.id}`, bg);
        values[f.id] = el ? el.value : "";
        if (f.required && !(values[f.id] || "").trim()) {
          const need = $("#prompt-need", bg);
          if (need) need.hidden = false;
          if (el) el.focus();
          return;
        }
      }
      done(values);
    });
    document.body.appendChild(bg);
    const first = bg.querySelector("input, select");
    if (first) first.focus();
  });
}

export function download(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyText(text) {
  const t = String(text || "");
  if (!t) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

export function pill(text, kind = "") {
  return `<span class="pill ${kind ? "pill-" + kind : ""}">${esc(text)}</span>`;
}

export function honesty(kind, text) {
  return `<span class="honesty ${kind}">${esc(text)}</span>`;
}

export function bind(el, handlers) {
  const run = (e, b) => {
    const fn = handlers[b.dataset.act];
    if (fn) fn(b, e);
  };
  if (el._flipBindClick) el.removeEventListener("click", el._flipBindClick);
  if (el._flipBindChange) el.removeEventListener("change", el._flipBindChange);
  el._flipBindClick = e => {
    const b = e.target.closest("[data-act]");
    if (!b || !el.contains(b)) return;
    if (b.tagName === "INPUT") return; // checkboxes fire on change so the new checked state is right
    e.preventDefault();
    run(e, b);
  };
  el._flipBindChange = e => {
    const b = e.target.closest("[data-act]");
    if (!b || !el.contains(b)) return;
    if (b.tagName === "INPUT") run(e, b);
  };
  el.addEventListener("click", el._flipBindClick);
  el.addEventListener("change", el._flipBindChange);
}

export function thumb(item, size = 56) {
  const src = item && item.photos && item.photos[0] && item.photos[0].dataUrl;
  if (src) return `<img class="thumb" src="${esc(src)}" alt="" width="${size}" height="${size}">`;
  return `<span class="thumb ph" aria-hidden="true">📷</span>`;
}
