// Settings → Listing style & SKUs (v0.10): her Depop format, the SKU prefix and next number per category,
// clothing vs. general merchandise, and what Kris has learned about her writing (she can delete any of it).
import { esc, toast } from "../dom.js";
import { bizStore } from "../../core/bizstore.js";
import { CATEGORIES, categoriesFor, formatSku, addRule, removeRule, styleFactsFrom, DEFAULT_LIST_PREFS } from "../../core/listing.js";

const B = bizStore();
export async function renderListStyle(ctx, el) {
  const prefs = await B.prefs(), sku = await B.sku(), style = await B.style(), facts = await B.facts();
  const kfacts = styleFactsFrom(facts);
  el.innerHTML = `<div class="topbar"><a class="iconbtn" href="#/settings" aria-label="Back">‹</a><h2>Listing style &amp; SKUs</h2><span class="spacer48"></span></div>
  <div class="card" id="ls-mode"><h3>What do you sell?</h3>
    <div class="seg"><button type="button" data-mode="clothing" class="${prefs.mode === "clothing" ? "on" : ""}">👗 Clothing</button><button type="button" data-mode="general" class="${prefs.mode === "general" ? "on" : ""}">📦 Clothing + general items</button></div>
    <p class="tiny muted">General adds home, toys, electronics and books, and doesn’t ask for measurements.</p></div>
  <div class="card" id="ls-depop"><h3>My Depop format</h3>
    <p class="small muted">No title. Keywords first, then the description, then hashtags, then your SKU alone on the last line.</p>
    <div class="row wrap" style="gap:10px">
      <label class="field grow"><span>Keywords (fewest)</span><input id="ls-kmin" inputmode="numeric" value="${prefs.keywordsMin}"></label>
      <label class="field grow"><span>Keywords (most)</span><input id="ls-kmax" inputmode="numeric" value="${prefs.keywordsMax}"></label>
      <label class="field grow"><span>Hashtags</span><input id="ls-tags" inputmode="numeric" value="${prefs.hashtags}"></label></div>
    <label class="field"><span>Between keywords</span><select id="ls-sep">${[[" | ", "Free People | boho top"], [" • ", "Free People • boho top"], [", ", "Free People, boho top"], [" ", "Free People boho top"]].map(([v, l]) => `<option value="${esc(v)}" ${prefs.keywordSep === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="ls-skulast" ${prefs.skuLastLine ? "checked" : ""}><span>SKU alone on the last line</span></label>
    <label class="check"><input type="checkbox" id="ls-meas" ${prefs.measurements ? "checked" : ""}><span>Put measurements in the description</span></label>
    <label class="field"><span>Always say at the end (optional)</span><input id="ls-always" value="${esc(prefs.alwaysSay)}" placeholder="Smoke-free home. Ships in 1–2 days."></label>
    <label class="field"><span>Other rules for Kris (optional)</span><textarea id="ls-extra" rows="2" placeholder="Short paragraphs. Mention the fit.">${esc(prefs.extraRules)}</textarea></label>
    <button type="button" class="btn" id="ls-save">Save my format</button>
    <button type="button" class="btn soft sm" id="ls-reset" style="margin-top:8px">Back to the defaults</button></div>
  <div class="card" id="ls-sku"><h3>SKU numbers</h3>
    <p class="small muted">Each category gets its own prefix and counter. Type your spreadsheet’s next number so they keep going from there.</p>
    <label class="field"><span>Between prefix and number</span><select id="ls-skusep">${[["", "WTOP014"], ["-", "WTOP-014"], ["_", "WTOP_014"]].map(([v, l]) => `<option value="${v}" ${sku.sep === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <table class="fin-table" id="ls-skutable"><tr><th>Category</th><th>Prefix</th><th>Next #</th><th>Digits</th><th>Next SKU</th></tr>
    ${categoriesFor(prefs.mode).map(c => { const r = sku.cats[c.id]; return `<tr data-cat="${c.id}"><td>${esc(c.label)}</td><td><input class="ls-pre" value="${esc(r.prefix)}" aria-label="${esc(c.label)} prefix"></td><td><input class="ls-next" inputmode="numeric" value="${r.next}" aria-label="${esc(c.label)} next number"></td><td><input class="ls-dig" inputmode="numeric" value="${r.digits}" aria-label="${esc(c.label)} digits"></td><td class="ls-prev">${esc(formatSku(sku, c.id, r.next))}</td></tr>`; }).join("")}</table>
    <button type="button" class="btn" id="ls-skusave" style="margin-top:10px">Save SKU numbers</button></div>
  <div class="card" id="ls-style"><h3>🧠 How Kris writes for you</h3>
    <p class="small muted">Your rules, and what I learned from your edits. Tap ✕ to delete one.</p>
    ${style.rules.length || kfacts.length ? `<ul class="kris-memlist" id="ls-rules">${style.rules.map((r, i) => `<li><span class="grow">${esc(r.t)}${r.from === "edit" ? ` <span class="tiny muted">(from your edits)</span>` : ""}</span><button type="button" class="kris-x" data-del="${i}" aria-label="Delete rule">✕</button></li>`).join("")}${kfacts.map(t => `<li><span class="grow">${esc(t)} <span class="tiny muted">(told Kris; delete in Kris remembers)</span></span></li>`).join("")}</ul>` : `<p class="small muted" id="ls-norules">Nothing yet.</p>`}
    <div class="field-with-act"><input id="ls-rule" placeholder="never say gorgeous"><button type="button" class="btn sm" id="ls-ruleadd">Add</button></div>
    ${style.edits.length ? `<details><summary class="small">Recent edits I learned from (${style.edits.length})</summary><ul class="kris-memlist">${style.edits.slice().reverse().map(e => `<li class="small">“${esc(e.from || "—")}” → “${esc(e.to || "removed")}”</li>`).join("")}</ul><button type="button" class="btn sm soft" id="ls-clearedits">Forget these edits</button></details>` : ""}</div>`;
  el.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", async () => { await B.setPrefs({ ...prefs, mode: b.dataset.mode }); toast("Saved."); renderListStyle(ctx, el); }));
  el.querySelector("#ls-save").addEventListener("click", async () => {
    await B.setPrefs({ ...prefs, keywordsMin: el.querySelector("#ls-kmin").value, keywordsMax: el.querySelector("#ls-kmax").value, hashtags: el.querySelector("#ls-tags").value, keywordSep: el.querySelector("#ls-sep").value, skuLastLine: el.querySelector("#ls-skulast").checked, measurements: el.querySelector("#ls-meas").checked, alwaysSay: el.querySelector("#ls-always").value, extraRules: el.querySelector("#ls-extra").value });
    toast("Saved. New listings use this format."); renderListStyle(ctx, el);
  });
  el.querySelector("#ls-reset").addEventListener("click", async () => { await B.setPrefs({ ...DEFAULT_LIST_PREFS, mode: prefs.mode }); toast("Back to the defaults."); renderListStyle(ctx, el); });
  const readSku = () => { const next = { sep: el.querySelector("#ls-skusep").value, cats: { ...sku.cats } }; el.querySelectorAll("#ls-skutable tr[data-cat]").forEach(tr => { next.cats[tr.dataset.cat] = { prefix: tr.querySelector(".ls-pre").value, next: tr.querySelector(".ls-next").value, digits: tr.querySelector(".ls-dig").value }; }); return next; };
  el.querySelectorAll("#ls-sku input, #ls-sku select").forEach(i => i.addEventListener("input", () => { const n = readSku(); el.querySelectorAll("#ls-skutable tr[data-cat]").forEach(tr => { tr.querySelector(".ls-prev").textContent = formatSku(n, tr.dataset.cat, Number(tr.querySelector(".ls-next").value) || 1); }); }));
  el.querySelector("#ls-skusave").addEventListener("click", async () => { await B.setSku(readSku()); toast("SKU numbers saved."); renderListStyle(ctx, el); });
  el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => { await B.setStyle(removeRule(style, Number(b.dataset.del))); renderListStyle(ctx, el); }));
  el.querySelector("#ls-ruleadd").addEventListener("click", async () => { const v = el.querySelector("#ls-rule").value.trim(); if (!v) return; await B.setStyle(addRule(style, v)); toast("Saved."); renderListStyle(ctx, el); });
  const ce = el.querySelector("#ls-clearedits"); if (ce) ce.addEventListener("click", async () => { await B.setStyle({ ...style, edits: [], avoid: {} }); renderListStyle(ctx, el); });
}
