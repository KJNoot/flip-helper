// Shared item-field form used on the add-review and item screens.
import { esc, $, honesty } from "../dom.js";
import { SITES, searchQuery, siteName, siteById } from "../../core/sites.js";
import { priceRangeLabel, formatUsd, hasAdvice, planSiteIds, SITE_PLAN_LABELS } from "../../core/inventory.js";
import { getEnabledIds } from "../../core/prefs.js";
import { HONESTY_NOTE, CONFIRM_FIELDS, CONFIRM_LABELS, guessFor } from "../../core/honesty.js";
import { dictateButton, dictateHint } from "../dictation.js";
import { tip } from "../tips.js";
import { catchMistakes, mistakeSummary, MISTAKE_NOTE } from "../../core/mistakes.js";
import { soldLinks, hasSoldData, soldDataMessage, NO_SOLD_DATA } from "../../core/comps.js";
import { compatLimitsNote } from "../../core/compat.js";

function tweakBlock(s, tweaks) {
  const t = tweaks[s.id] || {};
  const limit = compatLimitsNote(s.id);
  return `<details class="tweak" data-site="${esc(s.id)}">
    <summary>${esc(s.name)}</summary>
    ${s.note ? `<p class="tiny muted">${esc(s.note)}</p>` : ""}
    ${limit ? `<p class="tiny muted">${esc(limit)}</p>` : ""}
    <label class="field"><span>Title for ${esc(s.name)}</span><input data-tw="title" value="${esc(t.title || "")}" maxlength="120" placeholder="Leave blank to use the main title"></label>
    <label class="field"><span>Description for ${esc(s.name)}</span><textarea data-tw="description" rows="3" placeholder="Leave blank to use the main description">${esc(t.description || "")}</textarea></label>
    <label class="field"><span>Notes for you (not copied unless you leave them in)</span><textarea data-tw="notes" rows="2" placeholder="e.g. category, size, hashtags">${esc(t.notes || "")}</textarea></label>
  </details>`;
}

export function honestyBlock(item, { prefix = "" } = {}) {
  const p = prefix;
  const photo = item.photoShows;
  const guess = item.aiGuess;
  const confirm = item.youConfirm || {};
  const photoHtml = photo && (photo.what || photo.visibleText || photo.visibleFlaws || photo.visibleDetails)
    ? `<div class="honesty-split">
        <h4>Photo shows</h4>
        ${photo.what ? `<p class="small">${esc(photo.what)}</p>` : ""}
        ${photo.visibleDetails ? `<p class="small">${esc(photo.visibleDetails)}</p>` : ""}
        ${photo.visibleText ? `<p class="small">Readable text: ${esc(photo.visibleText)}</p>` : ""}
        ${photo.visibleFlaws ? `<p class="small attn">Visible flaws: ${esc(photo.visibleFlaws)}</p>` : `<p class="tiny muted">No damage was clearly visible in the photo. Please look yourself.</p>`}
      </div>`
    : "";
  const guessBits = [];
  if (guess) {
    if (guess.brand) guessBits.push(`Brand: ${guess.brand}`);
    if (guess.condition) guessBits.push(`Condition: ${guess.condition}`);
    if (guess.material) guessBits.push(`Material: ${guess.material}`);
    if (guess.size) guessBits.push(`Size: ${guess.size}`);
    if (guess.category) guessBits.push(`Category: ${guess.category}`);
  }
  const guessHtml = guessBits.length
    ? `<div class="honesty-split">
        <div class="row between"><h4>AI guess</h4>${honesty("warn", "AI guess")}</div>
        <p class="small">${esc(guessBits.join(" · "))}</p>
        ${guess.note ? `<p class="tiny muted">${esc(guess.note)}</p>` : ""}
        <p class="tiny muted">These are guesses. They are not facts until you confirm them below.</p>
      </div>`
    : "";
  const boxes = CONFIRM_FIELDS.map(k => {
    const row = confirm[k] || { confirmed: false, value: "" };
    const value = row.value || guessFor(item, k) || "";
    const label = CONFIRM_LABELS[k];
    const voice = (k === "flaws" || k === "size") ? dictateButton(`${p}confirm-${k}`, { label: "Speak" }) : "";
    return `<div class="confirm-row">
      <label class="check">
        <input type="checkbox" data-confirm="${esc(k)}" id="${p}confirm-${k}-on" ${row.confirmed ? "checked" : ""}>
        <span>I confirm the ${esc(label.toLowerCase())}</span>
      </label>
      <label class="field">
        <span>${esc(label)}</span>
        <div class="field-with-act">
          ${k === "flaws"
            ? `<textarea id="${p}confirm-${k}" data-confirm-val="${esc(k)}" rows="2" placeholder="${k === "flaws" ? "Chips, stains, wear — or leave blank and mark no flaws below" : ""}">${esc(value)}</textarea>`
            : `<input id="${p}confirm-${k}" data-confirm-val="${esc(k)}" value="${esc(value)}" maxlength="80" placeholder="${k === "brand" ? "Only if you know it" : k === "size" ? "e.g. M, 8, 32x30" : ""}">`}
          ${voice}
        </div>
      </label>
    </div>`;
  }).join("");
  return `<div class="card honesty-split-card" id="${p}honesty">
    <div class="row between"><h3>Be honest about the draft</h3>${honesty("ok", "Working")}</div>
    <p class="small muted">${esc(HONESTY_NOTE)}</p>
    ${photoHtml}
    ${guessHtml}
    <div class="honesty-split">
      <h4>You confirm</h4>
      <p class="tiny muted">Tick each one that's right. Unticked guesses are not treated as fact.</p>
      ${boxes}
      <label class="check"><input type="checkbox" id="${p}noflaws" ${item.noFlaws ? "checked" : ""}><span>No flaws that I can see</span></label>
      <label class="check"><input type="checkbox" id="${p}nobrand" ${item.noBrand ? "checked" : ""}><span>No brand</span></label>
      <label class="check"><input type="checkbox" id="${p}nosize" ${item.noSize ? "checked" : ""}><span>No size or measurements</span></label>
    </div>
    ${dictateHint()}
  </div>`;
}

export function mistakesBlock(item, { prefix = "" } = {}) {
  const issues = catchMistakes(item);
  if (!issues.length) return "";
  return `<div class="card alert" id="${prefix}mistakes" data-mistake-count="${issues.length}">
    <div class="row between"><h3>Quick check</h3>${honesty("warn", "Please review")}</div>
    <p class="small">${esc(mistakeSummary(issues))}</p>
    <p class="tiny muted">${esc(MISTAKE_NOTE)}</p>
    <ul class="mistakes">${issues.map(iss => `<li>
      <b>${esc(iss.title)}</b>
      <p class="small muted">${esc(iss.detail)}</p>
      ${iss.id !== "title" ? `<button type="button" class="btn sm soft" data-act="dismissmistake" data-id="${esc(iss.id)}">I'll skip this</button>` : ""}
    </li>`).join("")}</ul>
  </div>`;
}

export function fieldsHtml(item, { prefix = "", enabledIds, hideSearch = false, showHonesty = true } = {}) {
  const p = prefix;
  const tweaks = item.siteTweaks || {};
  const enabled = enabledIds || getEnabledIds();
  const enabledSet = new Set(enabled);
  const primary = SITES.filter(s => enabledSet.has(s.id));
  const rest = SITES.filter(s => !enabledSet.has(s.id));
  const sites = primary.map(s => tweakBlock(s, tweaks)).join("") +
    (rest.length ? `<details class="tweak more"><summary>More sites</summary>${rest.map(s => tweakBlock(s, tweaks)).join("")}</details>` : "");
  const range = priceRangeLabel(item);
  const soldMsg = hasSoldData(item) ? "" : `<p class="small" id="${p}nosold">${esc(NO_SOLD_DATA)}. The number below is an AI estimate, not a sold price.</p>`;
  return `
    <label class="field"><span>Title</span><input id="${p}title" maxlength="120" value="${esc(item.title)}" placeholder="What is it?"></label>
    <label class="field"><span>Description</span><textarea id="${p}desc" rows="5" maxlength="4000" placeholder="A short, honest description">${esc(item.description)}</textarea></label>
    <div class="grid2">
      <label class="field"><span>Category</span><input id="${p}category" maxlength="60" value="${esc(item.category)}" placeholder="e.g. Women's shoes"></label>
      <label class="field"><span>Brand</span><input id="${p}brand" maxlength="60" value="${esc(item.brand)}" placeholder="If you know it"></label>
    </div>
    <label class="field"><span>Condition</span><input id="${p}condition" maxlength="60" value="${esc(item.condition)}" placeholder="e.g. Good, Like new" list="${p}conds"></label>
    <datalist id="${p}conds">
      <option value="New with tags"><option value="New without tags"><option value="Like new">
      <option value="Good"><option value="Fair"><option value="Poor">
    </datalist>
    <div class="grid2">
      <label class="field"><span>Material</span><input id="${p}material" maxlength="60" value="${esc(item.material || "")}" placeholder="If you know it"></label>
      <label class="field"><span>Size</span>
        <div class="field-with-act">
          <input id="${p}size" maxlength="40" value="${esc(item.size || "")}" placeholder="e.g. M, 8, 32×30">
          ${dictateButton(p + "size", { label: "Speak" })}
        </div>
      </label>
    </div>
    <label class="field"><span>Measurements ${tip("Length, width, or other measurements. You can type or tap Speak and say them out loud.")}</span>
      <div class="field-with-act">
        <textarea id="${p}measurements" rows="2" placeholder="e.g. 12 in long, 8 in wide">${esc(item.measurements || "")}</textarea>
        ${dictateButton(p + "measurements", { label: "Speak" })}
      </div>
    </label>
    <label class="field"><span>Flaws or damage</span>
      <div class="field-with-act">
        <textarea id="${p}flaws" rows="2" placeholder="Chips, stains, wear, missing parts">${esc((item.youConfirm && item.youConfirm.flaws && item.youConfirm.flaws.value) || "")}</textarea>
        ${dictateButton(p + "flaws", { label: "Speak" })}
      </div>
    </label>
    ${dictateHint()}
    <div class="grid2">
      <label class="field"><span>What you paid</span><input id="${p}cost" type="text" inputmode="decimal" value="${esc(item.costPaid ?? "")}" placeholder="e.g. 8.00"></label>
      <label class="field"><span>Your asking price ${tip("This is the price you'll ask on the selling sites. You can pick from three options on the item page: sell quickly, balanced, or hold for more.")}</span><input id="${p}asking" type="text" inputmode="decimal" value="${esc(item.askingPrice ?? "")}" placeholder="e.g. 24.00"></label>
    </div>
    <label class="field"><span>Bin location ${tip("A short label for where this item sits, like A3 or shelf 2. When it sells, you'll see the photo, this bin, and a packing list.")}</span><input id="${p}bin" maxlength="40" value="${esc(item.binLocation || "")}" placeholder="e.g. A3, shelf 2"></label>
    <div class="estimate">
      <div class="row between"><strong>Suggested price</strong><span class="honesty warn">AI estimate</span></div>
      <p class="big-num">${range ? esc(range) : "—"}</p>
      <p class="small">${item.priceReason ? esc(item.priceReason) : "No estimate yet."}</p>
      ${soldMsg}
      <p class="tiny muted">This is an AI estimate from the photo. It was not checked against real sold listings. Please look at sold prices and change anything that's wrong.</p>
      ${hideSearch ? "" : searchLinks(item, enabled)}
    </div>
    <details class="more-block" id="${p}more-fields">
      <summary>More</summary>
      <div class="grid2" style="margin-top:8px">
        <label class="field"><span>Low estimate</span><input id="${p}plow" type="text" inputmode="decimal" value="${esc(item.priceLow ?? "")}"></label>
        <label class="field"><span>High estimate</span><input id="${p}phigh" type="text" inputmode="decimal" value="${esc(item.priceHigh ?? "")}"></label>
      </div>
      <label class="field"><span>Why this range</span><textarea id="${p}preason" rows="2">${esc(item.priceReason)}</textarea></label>
      <label class="field"><span>Your notes</span><textarea id="${p}notes" rows="2" placeholder="Anything you want to remember">${esc(item.notes)}</textarea></label>
      <h3 class="section-kicker">Change the wording for one site</h3>
      <p class="tiny muted">Optional. Change the title or description for a site, or leave a note for yourself.</p>
      <div id="${p}tweaks">${sites}</div>
    </details>
  `;
}

export function searchLinks(item, enabledIds) {
  const q = searchQuery(item);
  if (!q) return `<p class="tiny muted">Add a title to get sold-price search links.</p>`;
  const enabled = new Set(enabledIds || getEnabledIds());
  const list = [...SITES.filter(s => enabled.has(s.id)), ...SITES.filter(s => !enabled.has(s.id))];
  const links = list.map(s => `<a class="chiplink" href="${esc(s.soldSearch(q))}" target="_blank" rel="noopener">${esc(s.short || s.name)}</a>`).join("");
  return `<div class="searchlinks"><span class="tiny muted">Check real sold prices:</span><div class="row wrap">${links}</div></div>`;
}

export function adviceHtml(item) {
  if (!hasAdvice(item)) return "";
  const a = item.siteAdvice;
  const plan = item.sitePlan || "own";
  const chips = ids => (ids || []).map(id => `<span class="pill pill-listed">${esc(siteName(id))}</span>`).join(" ");
  const block = (title, data, planId) => {
    if (!data || !(data.sites || []).length) return "";
    const on = plan === planId;
    return `<div class="advice-block">
      <div class="row between"><h4>${esc(title)}</h4>${honesty("warn", "AI estimate")}</div>
      <div class="row wrap" style="margin:6px 0">${chips(data.sites)}</div>
      <p class="small">${data.reason ? esc(data.reason) : "No reason given."}</p>
      <button type="button" class="btn sm ${on ? "" : "soft"}" data-act="plan" data-plan="${esc(planId)}">${on ? "Using these sites" : "Use these sites"}</button>
    </div>`;
  };
  const planned = planSiteIds(item, plan);
  const bothOn = plan === "both";
  const ownOn = plan === "own";
  return `<div class="card advice" id="advice">
    <h3>Where to list it</h3>
    <p class="tiny muted">These are rough AI estimates from the photo, not from checking live listings or how fast things actually sell. You choose where to post.</p>
    ${block("Best price", a.bestPrice, "bestPrice")}
    ${block("Fastest sale", a.fastestSale, "fastestSale")}
    <div class="planbtns">
      <button type="button" class="btn sm ${bothOn ? "" : "soft"}" data-act="plan" data-plan="both">${bothOn ? "Using both" : "Both"}</button>
      <button type="button" class="btn sm ${ownOn ? "" : "soft"}" data-act="plan" data-plan="own">${ownOn ? "Picking my own" : "Pick my own"}</button>
    </div>
    ${!ownOn && planned.length ? `<p class="small" id="plan-summary">You'll post on: <b>${esc(planned.map(siteName).join(", "))}</b>. You can still tick other sites below.</p>` : `<p class="small muted" id="plan-summary">Pick any of your sites below.</p>`}
  </div>`;
}

export function readConfirms(el, prefix = "") {
  const p = prefix;
  const confirm = {};
  for (const k of CONFIRM_FIELDS) {
    const on = $(`#${p}confirm-${k}-on`, el);
    const val = $(`#${p}confirm-${k}`, el);
    confirm[k] = {
      confirmed: !!(on && on.checked),
      value: val ? String(val.value || "").trim() : ""
    };
  }
  const noFlaws = $(`#${p}noflaws`, el);
  const noBrand = $(`#${p}nobrand`, el);
  const noSize = $(`#${p}nosize`, el);
  const flawsField = $(`#${p}flaws`, el);
  if (flawsField && flawsField.value && confirm.flaws && !confirm.flaws.value) {
    confirm.flaws.value = flawsField.value.trim();
  }
  return {
    youConfirm: confirm,
    noFlaws: !!(noFlaws && noFlaws.checked),
    noBrand: !!(noBrand && noBrand.checked),
    noSize: !!(noSize && noSize.checked),
    flawsNoted: !!(noFlaws && noFlaws.checked) || !!(confirm.flaws && (confirm.flaws.confirmed || confirm.flaws.value))
  };
}

export function readFields(el, prefix = "") {
  const p = prefix;
  const val = id => { const n = $(`#${p}${id}`, el); return n ? n.value : ""; };
  const siteTweaks = {};
  el.querySelectorAll(`#${p}tweaks details[data-site]`).forEach(d => {
    const id = d.dataset.site;
    const get = k => { const n = d.querySelector(`[data-tw="${k}"]`); return n ? n.value.trim() : ""; };
    const t = { title: get("title"), description: get("description"), notes: get("notes") };
    if (t.title || t.description || t.notes) siteTweaks[id] = t;
  });
  const confirms = readConfirms(el, p);
  // Confirmed brand/material/size become the item fields if the main field is empty.
  const brand = val("brand").trim() || (confirms.youConfirm.brand.confirmed ? confirms.youConfirm.brand.value : val("brand").trim());
  const material = val("material").trim() || (confirms.youConfirm.material.confirmed ? confirms.youConfirm.material.value : "");
  const size = val("size").trim() || (confirms.youConfirm.size.confirmed ? confirms.youConfirm.size.value : "");
  return {
    title: val("title").trim(),
    description: val("desc"),
    category: val("category").trim(),
    brand,
    condition: val("condition").trim(),
    material,
    size,
    measurements: val("measurements"),
    costPaid: val("cost"),
    askingPrice: val("asking"),
    priceLow: val("plow"),
    priceHigh: val("phigh"),
    priceReason: val("preason").trim(),
    notes: val("notes"),
    binLocation: val("bin").trim(),
    siteTweaks,
    ...confirms
  };
}

export { formatUsd, siteById, catchMistakes, soldDataMessage };
