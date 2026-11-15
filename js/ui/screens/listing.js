// New clothing listing (v0.10). Three big steps, one item that keeps every fact:
//   1. Photos + facts (type or talk; "Read my photos" fills only the empty boxes)
//   2. Depop listing in her format (edit, checks, copy, Approve)
//   3. One button: Mercari, Vinted and eBay, each in its own tab with copy buttons.
// Everything is saved on the item as she goes, so leaving and coming back never asks twice.
import { esc, toast, confirmSheet } from "../dom.js";
import { emptyItem, money, formatUsd } from "../../core/inventory.js";
import { photoFromFile, MAX_PHOTOS } from "../../core/draft.js";
import { beginDictate } from "../dictation.js";
import { getCode, KRIS_URL } from "../../core/kris.js";
import { bizStore } from "../../core/bizstore.js";
import { withBiz, addEvent, normalizeBatches } from "../../core/business.js";
import {
  CATEGORIES, categoriesFor, categoryLabel, DEPOP_STYLES, DEPOP_OCCASIONS, DEPOP_CONDITIONS, TAG_MAX, tagName,
  normalizeFacts, mergeFacts, missingFacts, FACT_LABELS, guessCategory, peekSku, claimSku,
  garmentRequest, depopRequest, normalizeDepop, composeDepop, checkDepop, fixDepopText, validTags,
  xlistRequest, normalizeXlist, checkXlist, XSITES, styleText, learnFromEdit, addRule, listingAsk
} from "../../core/listing.js";

const B = bizStore();
let S = null; // { id, step, busy, tab, dict }
const kurl = () => (globalThis.__KRIS_URL != null ? globalThis.__KRIS_URL : KRIS_URL);

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it on the site."); return true; }
  catch (e) {
    try { const ta = Object.assign(document.createElement("textarea"), { value: text }); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied. Paste it on the site."); return true; }
    catch (e2) { toast("Couldn’t copy. Press and hold the text to copy it."); return false; }
  }
}
function aiError(e) {
  return ({ off: "Kris isn’t set up on this device yet. Settings → Ask Kris.", code: "That Kris code didn’t work. Ask KJ for a new one.", busy: "That’s a lot at once! Wait a minute, then try again.", network: "I can’t reach Kris. Check your signal and try again.", big: "Those photos are too big. Try fewer photos.", format: "Kris got mixed up. Tap it again." })[e] || "Kris isn’t working right now. Try again in a bit.";
}

/** #/listing (new), #/listing/<id>, #/listing/<id>/<step> */
export async function renderListing(ctx, el, rest = []) {
  const [id, step] = rest;
  if (!S || S.id !== (id || S.id) || !id) S = { id: id || null, step: step || "facts", busy: "", tab: "mercari" };
  if (step) S.step = step;
  if (id && !ctx.items.find(i => i.id === id)) { el.innerHTML = `<div class="card empty"><p>That listing isn’t on this phone.</p><a class="btn" href="#/listing">Start a new listing</a></div>`; return; }
  await paint(ctx, el);
}

function current(ctx) {
  const found = S.id && ctx.items.find(i => i.id === S.id);
  if (found) {
    const it = withBiz(found);
    // an item from before v0.10: start the facts from what's already on it (nothing is asked twice)
    if (!it.garment) it.garment = normalizeFacts({ brand: it.brand, size: it.size, condition: it.condition, material: it.material, measurements: it.measurements, category: guessCategory(it.category + " " + it.title), details: it.description ? it.description.slice(0, 400) : "" });
    return it;
  }
  if (!S.draft) {
    let batchId = null; try { batchId = sessionStorage.getItem("flip-helper.nextBatch"); sessionStorage.removeItem("flip-helper.nextBatch"); } catch (e) { }
    S.draft = withBiz(emptyItem({ garment: normalizeFacts({}), batchId: batchId || null }));
  }
  return S.draft;
}
let saveT = 0, saving = null;
async function save(ctx, item, { now = false } = {}) {
  const run = async () => {
    const f = normalizeFacts(item.garment);
    const firstLine = item.listings && item.listings.depop && item.listings.depop.text ? item.listings.depop.text.split("\n")[0] : "";
    const auto = [f.brand, f.color, categoryLabel(f.category).replace(/^(Women|Men|Kids)’s /, ""), f.size && "size " + f.size].filter(Boolean).join(" ");
    const next = { ...item, garment: f, brand: f.brand, size: f.size, condition: f.condition, material: f.material, measurements: f.measurements, category: categoryLabel(f.category) || item.category, flawsNoted: !!f.flaws, noFlaws: f.noFlaws, title: item.titleLocked ? item.title : (firstLine || auto || item.title || "New listing").slice(0, 140) };
    const row = await ctx.save(next);
    if (!S.id) { S.id = row.id; S.draft = null; history.replaceState(null, "", "#/listing/" + row.id + "/" + S.step); }
    return row;
  };
  clearTimeout(saveT);
  if (now) { saving = run(); return saving; }
  return new Promise(res => { saveT = setTimeout(() => { saving = run(); res(saving); }, 500); });
}

const stepNames = { facts: "1 · Details", depop: "2 · Depop", sites: "3 · Other sites" };
async function paint(ctx, el) {
  const item = current(ctx), f = normalizeFacts(item.garment), prefs = await B.prefs();
  const cats = categoriesFor(prefs.mode);
  const stepper = `<div class="seg lst-steps" role="tablist">${Object.entries(stepNames).map(([k, v]) => `<button type="button" data-step="${k}" class="${S.step === k ? "on" : ""}" ${!item.id || (k !== "facts" && !S.id) ? "" : ""}>${v}</button>`).join("")}</div>`;
  let body = "";
  if (S.step === "facts") body = factsHtml(item, f, cats, prefs);
  else if (S.step === "depop") body = await depopHtml(item, f, prefs);
  else body = sitesHtml(item, f);
  el.innerHTML = `<div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>${prefs.mode === "general" ? "New listing" : "New clothing listing"}</h2><span class="spacer48"></span></div>
    ${stepper}${S.busy ? `<div class="card okbox lst-busy" id="lst-busy">⏳ ${esc(S.busy)}</div>` : ""}${body}`;
  wire(ctx, el, item);
}

// ---------- step 1 ----------
function field(id, label, value, { rows = 0, mic = false, ph = "" } = {}) {
  const input = rows ? `<textarea id="${id}" data-fact="${id.replace("f-", "")}" rows="${rows}" placeholder="${esc(ph)}">${esc(value)}</textarea>` : `<input id="${id}" data-fact="${id.replace("f-", "")}" type="text" value="${esc(value)}" placeholder="${esc(ph)}">`;
  return `<label class="field"><span>${esc(label)}</span>${mic ? `<div class="field-with-act">${input}<button type="button" class="btn sm soft" data-mic="${id}" aria-label="Talk into ${esc(label)}">🎤</button></div>` : input}</label>`;
}
function factsHtml(item, f, cats, prefs) {
  const photos = item.photos || [];
  const miss = missingFacts(f, prefs.mode);
  return `
  <div class="card">
    <h3>📷 Photos</h3>
    <p class="small muted">Front, back, the tag, and any flaw.</p>
    <div class="photos">${photos.map((p, i) => `<div class="photo"><img src="${esc(p.dataUrl)}" alt="Photo ${i + 1}"><button type="button" class="iconbtn sm" data-delphoto="${i}" aria-label="Remove photo">×</button></div>`).join("")}
      ${photos.length < MAX_PHOTOS ? `<label class="photo add"><input id="lst-cam" type="file" accept="image/*" capture="environment" hidden><span>📷 Take</span></label><label class="photo add"><input id="lst-lib" type="file" accept="image/*" multiple hidden><span>🖼 Choose</span></label>` : ""}</div>
  </div>
  <div class="card">
    <h3>🎤 Tell me about it</h3>
    <p class="small muted">Talk like you would to a friend: brand, size, measurements, flaws. Then tap the big button and I’ll fill in the boxes (I never change what you typed).</p>
    <div class="field-with-act"><textarea id="lst-said" rows="3" placeholder="e.g. Free People, size medium, pit to pit 21, length 24, tiny snag on the left cuff">${esc(item.garmentSaid || "")}</textarea><button type="button" class="btn sm soft" data-mic="lst-said" aria-label="Talk">🎤</button></div>
    <button type="button" class="btn btn-main" id="lst-read" style="margin-top:10px">✨ Fill in from my photos${item.garmentSaid ? " + what I said" : ""}</button>
  </div>
  <div class="card" id="lst-facts">
    <h3>The details</h3>
    <label class="field"><span>Category</span><select id="f-category" data-fact="category"><option value="">Pick one</option>${cats.map(c => `<option value="${c.id}" ${f.category === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
    ${field("f-brand", "Brand", f.brand)}${prefs.mode === "general" && !["wtop", "wbtm", "wdrs", "wout", "wact", "wsho", "mtop", "mbtm", "mout", "msho", "kids"].includes(f.category) ? field("f-size", "Size (if it has one)", f.size) : field("f-size", "Size", f.size)}
    ${field("f-color", "Color", f.color)}${field("f-material", "Material", f.material)}
    <label class="field"><span>Condition</span><select id="f-condition" data-fact="condition"><option value="">Pick one</option>${DEPOP_CONDITIONS.map(c => `<option ${f.condition === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    ${field("f-measurements", "Measurements", f.measurements, { rows: 3, mic: true, ph: "Pit to pit 21 in, length 24 in" })}
    ${field("f-flaws", "Flaws", f.flaws, { rows: 2, mic: true, ph: "Tiny snag near the left cuff" })}
    <label class="check"><input type="checkbox" id="f-noflaws" ${f.noFlaws ? "checked" : ""}><span>I checked: no flaws</span></label>
    ${field("f-details", "Other details", f.details, { rows: 2, mic: true, ph: "Embroidered, balloon sleeves, runs small" })}
    ${field("f-era", "Era / style (optional)", f.era, { ph: "90s, Y2K, boho…" })}
    <div class="row wrap" style="gap:10px">
      <label class="field grow"><span>Your price ($)</span><input id="f-price" type="text" inputmode="decimal" value="${esc(item.askingPrice ?? "")}" placeholder="28"></label>
      <label class="field grow"><span>What you paid ($)</span><input id="f-cost" type="text" inputmode="decimal" value="${esc(item.costPaid ?? "")}" placeholder="4"></label>
    </div>
    <div id="lst-batch-slot"></div>
    ${miss.length ? `<p class="tiny muted" id="lst-missing">Still blank: ${esc(miss.map(m => (FACT_LABELS[m] || m).toLowerCase()).join(", "))}. You can go on anyway.</p>` : `<p class="tiny" id="lst-missing">✓ All the main details are in.</p>`}
    <p class="tiny muted">✓ Saved on this item as you type.</p>
  </div>
  <button type="button" class="btn btn-main" id="lst-next1">Next: write my Depop listing ›</button>`;
}

// ---------- step 2 ----------
async function depopHtml(item, f, prefs) {
  const d = (item.listings && item.listings.depop) || null;
  const skuCfg = await B.sku();
  const sku = item.sku || (f.category ? peekSku(skuCfg, f.category, []).sku : "");
  if (!d || !d.text) {
    return `<div class="card"><h3>Depop listing</h3>
      <p class="small">I’ll write it your way: no title, keywords first, the details and flaws, ${prefs.hashtags} hashtags, and your SKU alone on the last line.</p>
      <p class="small">SKU for this one: <b id="lst-sku-peek">${esc(sku || "pick a category first")}</b> <span class="tiny muted">(change numbers in Settings → Listing style)</span></p>
      <button type="button" class="btn btn-main" id="lst-write">✍️ Write my Depop listing</button></div>
      <button type="button" class="btn soft" data-step="facts">‹ Back to the details</button>`;
  }
  const chk = checkDepop(d.text, { sku: item.sku, prefs, styles: d.styles, occasions: d.occasions });
  const chips = (list, sel, kind) => list.map(t => `<button type="button" class="chip-tag ${sel.includes(t.id) ? "on" : ""}" data-tag="${kind}" data-id="${t.id}" aria-pressed="${sel.includes(t.id)}">${esc(t.name)}</button>`).join("");
  return `<div class="card" id="lst-depop">
    <div class="row between"><h3>Depop listing</h3>${d.approvedAt ? `<span class="honesty ok">Approved</span>` : `<span class="honesty warn">Check &amp; approve</span>`}</div>
    <textarea id="lst-depop-text" rows="16" class="lst-big">${esc(d.text)}</textarea>
    <div class="row wrap" style="gap:8px;margin-top:8px">
      <button type="button" class="btn sm" id="lst-copy-depop">📋 Copy description</button>
      <button type="button" class="btn sm soft" id="lst-fix">🔧 Fix the format for me</button>
      <button type="button" class="btn sm soft" id="lst-rewrite">↻ Write it again</button>
    </div>
    <ul class="lst-checks" id="lst-checks">${chk.checks.map(c => `<li class="${c.ok ? "ok" : "bad"}" data-check="${c.id}">${c.ok ? "✓" : "✗"} ${esc(c.label)}</li>`).join("")}</ul>
    <label class="field"><span>Depop price ($)</span><div class="field-with-act"><input id="lst-price" type="text" inputmode="decimal" value="${esc(item.askingPrice ?? "")}"><button type="button" class="btn sm soft" data-copy="${esc(item.askingPrice ?? "")}">📋</button></div></label>
    <h3 style="margin-top:14px">Style tags <span class="tiny muted">(pick 3)</span></h3>
    <div class="chips" id="lst-styles">${chips(DEPOP_STYLES, d.styles || [], "styles")}</div>
    ${(d.filledStyles || []).length ? `<p class="tiny muted">I picked ${esc(d.filledStyles.map(x => tagName(DEPOP_STYLES, x)).join(", "))} to make 3. Change them if they don’t fit.</p>` : ""}
    <h3 style="margin-top:14px">Occasion tags <span class="tiny muted">(pick 3)</span></h3>
    <div class="chips" id="lst-occasions">${chips(DEPOP_OCCASIONS, d.occasions || [], "occasions")}</div>
    ${(d.check || []).length ? `<p class="tiny muted">Double-check: ${esc(d.check.join(" · "))}</p>` : ""}
    <div class="card flat" style="margin-top:12px">
      <h3>Teach me your style</h3>
      <p class="tiny muted">Your edits teach me too. Or tell me a rule, like “never say gorgeous”.</p>
      <div class="field-with-act"><input id="lst-rule" type="text" placeholder="never say gorgeous"><button type="button" class="btn sm" id="lst-rule-add">Save rule</button></div>
    </div>
  </div>
  ${d.approvedAt ? `<button type="button" class="btn btn-main" id="lst-make">⚡ Make Mercari, Vinted &amp; eBay</button>` : `<button type="button" class="btn btn-main" id="lst-approve">✅ Approve my Depop listing</button>`}
  <button type="button" class="btn soft" data-step="facts" style="margin-top:10px">‹ Back to the details</button>`;
}

// ---------- step 3 ----------
function sitesHtml(item, f) {
  const L = item.listings || {};
  const have = XSITES.filter(x => L[x.id] && L[x.id].title != null);
  if (!L.depop || !L.depop.approvedAt) return `<div class="card"><p>Approve the Depop listing first. Then one tap makes the other three.</p><button type="button" class="btn" data-step="depop">Go to Depop</button></div>`;
  if (!have.length) return `<div class="card"><h3>Mercari, Vinted &amp; eBay</h3><p class="small">Same facts, each site’s own format and length.</p><button type="button" class="btn btn-main" id="lst-make">⚡ Make Mercari, Vinted &amp; eBay</button></div>`;
  const tab = XSITES.find(x => x.id === S.tab) ? S.tab : "mercari";
  const site = XSITES.find(x => x.id === tab), l = L[tab] || { title: "", description: "", price: "" };
  const problems = checkXlist(L, f);
  return `<div class="seg" id="lst-tabs">${XSITES.map(x => `<button type="button" data-tab="${x.id}" class="${tab === x.id ? "on" : ""}">${x.name}</button>`).join("")}</div>
  <div class="card" id="lst-site" data-site="${tab}">
    <p class="tiny muted">${esc(site.note)}</p>
    <label class="field"><span>Title <span class="tiny muted" id="lst-tcount">${l.title.length}/${site.titleMax}</span></span><div class="field-with-act"><input id="x-title" type="text" maxlength="${site.titleMax}" value="${esc(l.title)}"><button type="button" class="btn sm soft" data-copyfield="x-title" aria-label="Copy title">📋</button></div></label>
    <label class="field"><span>Description</span><textarea id="x-desc" rows="12" class="lst-big">${esc(l.description)}</textarea></label>
    <button type="button" class="btn sm" data-copyfield="x-desc">📋 Copy description</button>
    <label class="field"><span>Price ($)</span><div class="field-with-act"><input id="x-price" type="text" inputmode="decimal" value="${esc(l.price)}"><button type="button" class="btn sm soft" data-copyfield="x-price" aria-label="Copy price">📋</button></div></label>
    ${tab === "ebay" ? `<label class="field"><span>Custom label (SKU)</span><div class="field-with-act"><input id="x-sku" type="text" value="${esc(item.sku || "")}" readonly><button type="button" class="btn sm soft" data-copyfield="x-sku">📋</button></div></label>
      ${l.specifics ? `<h3>Item specifics</h3><dl class="kris-pre">${Object.entries(l.specifics).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)} <button type="button" class="btn small soft" data-copy="${esc(v)}">📋</button></dd>`).join("")}</dl>` : ""}` : ""}
  </div>
  ${problems.length ? `<p class="tiny muted" id="lst-xproblems">Check: ${esc(problems.join(" · "))}</p>` : ""}
  <button type="button" class="btn btn-main" id="lst-done">✓ All done</button>
  <button type="button" class="btn soft" id="lst-remake" style="margin-top:10px">↻ Make these again</button>
  <a class="btn soft" href="#/strategy/${esc(item.id)}" style="margin-top:10px">💲 Pricing &amp; offers for this item</a>`;
}

// ---------- events ----------
function wire(ctx, el, item) {
  el.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", async () => { await flushFacts(ctx, el, item); S.step = b.dataset.step; if (S.id) history.replaceState(null, "", "#/listing/" + S.id + "/" + S.step); paint(ctx, el); }));
  el.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => copyText(b.dataset.copy)));
  el.querySelectorAll("[data-copyfield]").forEach(b => b.addEventListener("click", () => { const i = el.querySelector("#" + b.dataset.copyfield); if (i) copyText(i.value); }));
  el.querySelectorAll("[data-mic]").forEach(b => b.addEventListener("click", () => {
    if (S.dict) { try { S.dict.stop(); } catch (e) { } S.dict = null; return; }
    const input = el.querySelector("#" + b.dataset.mic);
    S.dict = beginDictate(input, { onText: () => input.dispatchEvent(new Event("input", { bubbles: true })) });
  }));
  if (S.step === "facts") wireFacts(ctx, el, item);
  if (S.step === "depop") wireDepop(ctx, el, item);
  if (S.step === "sites") wireSites(ctx, el, item);
}
function readFacts(el, item) {
  const g = { ...normalizeFacts(item.garment) };
  el.querySelectorAll("[data-fact]").forEach(i => { g[i.dataset.fact] = i.value; });
  const nf = el.querySelector("#f-noflaws"); if (nf) g.noFlaws = nf.checked;
  const out = { ...item, garment: normalizeFacts(g) };
  const p = el.querySelector("#f-price"), c = el.querySelector("#f-cost"), said = el.querySelector("#lst-said"), bt = el.querySelector("#lst-batch");
  if (p) out.askingPrice = money(p.value);
  if (c) out.costPaid = money(c.value);
  if (said) out.garmentSaid = said.value.slice(0, 2500);
  if (bt) out.batchId = bt.value || null;
  return out;
}
async function flushFacts(ctx, el, item) {
  if (S.step !== "facts" || !el.querySelector("#lst-facts")) return;
  const next = readFacts(el, item);
  if (S.id || hasAnything(next)) await save(ctx, next, { now: true });
}
const hasAnything = it => (it.photos || []).length || Object.values(normalizeFacts(it.garment)).some(v => v && v !== false) || it.garmentSaid || it.askingPrice != null;

async function wireFacts(ctx, el, item) {
  // sourcing batch picker (Business manager)
  const batches = await B.batches();
  const slot = el.querySelector("#lst-batch-slot");
  if (slot) slot.innerHTML = `<label class="field"><span>From which haul / batch? (optional)</span><select id="lst-batch"><option value="">None</option>${batches.slice().reverse().map(b => `<option value="${esc(b.id)}" ${item.batchId === b.id ? "selected" : ""}>${esc(b.name)}${b.date ? " · " + esc(b.date) : ""}</option>`).join("")}</select></label>`;
  const onEdit = () => { const next = readFacts(el, item); Object.assign(item, next); if (S.id || hasAnything(next)) save(ctx, next); const miss = el.querySelector("#lst-missing"); if (miss) { const m = missingFacts(next.garment); miss.textContent = m.length ? "Still blank: " + m.map(x => (FACT_LABELS[x] || x).toLowerCase()).join(", ") + ". You can go on anyway." : "✓ All the main details are in."; } };
  el.querySelectorAll("#lst-facts input, #lst-facts textarea, #lst-facts select, #lst-said").forEach(i => { i.addEventListener("input", onEdit); i.addEventListener("change", onEdit); });
  const addFiles = async files => {
    const list = [...files].slice(0, MAX_PHOTOS - (item.photos || []).length);
    if (!list.length) return;
    const next = readFacts(el, item);
    for (const f of list) { try { next.photos = (next.photos || []).concat(await photoFromFile(f)); } catch (e) { toast("One photo couldn’t be read."); } }
    await save(ctx, next, { now: true }); paint(ctx, el);
  };
  const cam = el.querySelector("#lst-cam"), lib = el.querySelector("#lst-lib");
  if (cam) cam.addEventListener("change", () => addFiles(cam.files));
  if (lib) lib.addEventListener("change", () => addFiles(lib.files));
  el.querySelectorAll("[data-delphoto]").forEach(b => b.addEventListener("click", async () => { const next = readFacts(el, item); next.photos = next.photos.filter((_, i) => i !== Number(b.dataset.delphoto)); await save(ctx, next, { now: true }); paint(ctx, el); }));
  el.querySelector("#lst-read").addEventListener("click", async () => {
    const next = readFacts(el, item);
    if (!(next.photos || []).length && !next.garmentSaid) { toast("Add a photo or tell me about it first."); return; }
    const prefs = await B.prefs();
    S.busy = "Kris is looking at your photos…"; await save(ctx, next, { now: true }); await paint(ctx, el);
    const r = await listingAsk({ url: kurl(), code: getCode(), mode: "garment", text: garmentRequest(next.garment, next.garmentSaid, prefs.mode), images: (next.photos || []).slice(0, 4).map(p => p.dataUrl), version: ctx.version });
    S.busy = "";
    if (!r.ok) { toast(aiError(r.error)); paint(ctx, el); return; }
    const fresh = withBiz(ctx.items.find(i => i.id === S.id) || next);
    const raw = { ...r.data }; if (raw.category && !CATEGORIES.some(c => c.id === raw.category)) raw.category = guessCategory(raw.category);
    const m = mergeFacts(fresh.garment, raw);
    let saved = { ...fresh, garment: m.facts, garmentCheck: (Array.isArray(r.data.check) ? r.data.check : []).filter(Boolean).slice(0, 5) };
    saved = addEvent(saved, "ai", "Kris read the photos" + (m.filled.length ? " and filled: " + m.filled.join(", ") : ""));
    await save(ctx, saved, { now: true });
    toast(m.filled.length ? "Filled in " + m.filled.length + " boxes. Check them!" : "Nothing new to fill in.");
    paint(ctx, el);
  });
  el.querySelector("#lst-next1").addEventListener("click", async () => {
    const next = readFacts(el, item);
    if (!next.garment.category) { toast("Pick a category so I can make your SKU."); el.querySelector("#f-category").focus(); return; }
    await save(ctx, next, { now: true }); S.step = "depop"; history.replaceState(null, "", "#/listing/" + S.id + "/depop"); paint(ctx, el);
  });
}

async function styleFor() { return styleText(await B.style(), await B.facts()); }
async function writeDepop(ctx, el, item) {
  const fresh = withBiz(ctx.items.find(i => i.id === S.id) || item);
  const prefs = await B.prefs(), f = normalizeFacts(fresh.garment);
  if (!f.category) { toast("Pick a category first."); S.step = "facts"; paint(ctx, el); return; }
  let sku = fresh.sku;
  if (!sku) {
    const used = ctx.items.map(i => i.sku).filter(Boolean);
    const c = claimSku(await B.sku(), f.category, used); sku = c.sku; await B.setSku(c.cfg);
  }
  S.busy = "Kris is writing your Depop listing…"; await paint(ctx, el);
  const r = await listingAsk({ url: kurl(), code: getCode(), mode: "depop", text: depopRequest(f, { prefs, style: await styleFor(), price: fresh.askingPrice, mode: prefs.mode }), version: ctx.version });
  S.busy = "";
  const base = withBiz(ctx.items.find(i => i.id === S.id) || fresh);
  if (!r.ok) { await save(ctx, { ...base, sku }, { now: true }); toast(aiError(r.error)); paint(ctx, el); return; }
  const d = normalizeDepop(r.data, { facts: f, sku, prefs });
  const listings = { ...base.listings, depop: { text: d.text, aiText: d.text, styles: d.styles, occasions: d.occasions, filledStyles: d.filledStyles, filledOccasions: d.filledOccasions, check: d.check, approvedAt: null, writtenAt: Date.now(), tokens: r.tokens || null } };
  await save(ctx, addEvent({ ...base, sku, listings }, "listing", "Depop listing written (" + sku + ")"), { now: true });
  paint(ctx, el);
}
function wireDepop(ctx, el, item) {
  const w = el.querySelector("#lst-write"); if (w) w.addEventListener("click", () => writeDepop(ctx, el, item));
  const ta = el.querySelector("#lst-depop-text"); if (!ta) return;
  const d = () => ({ ...(withBiz(ctx.items.find(i => i.id === S.id) || item).listings.depop) });
  const put = async (patch, { repaint = false } = {}) => {
    const base = withBiz(ctx.items.find(i => i.id === S.id) || item);
    const nd = { ...base.listings.depop, ...patch };
    await save(ctx, { ...base, listings: { ...base.listings, depop: nd } }, { now: repaint });
    if (repaint) paint(ctx, el); else refreshChecks(ctx, el, base.sku, nd);
  };
  ta.addEventListener("input", () => put({ text: ta.value, approvedAt: null }));
  el.querySelector("#lst-copy-depop").addEventListener("click", () => copyText(ta.value));
  el.querySelector("#lst-fix").addEventListener("click", async () => { const base = withBiz(ctx.items.find(i => i.id === S.id) || item); const prefs = await B.prefs(); await put({ text: fixDepopText(ta.value, { sku: base.sku, prefs, facts: base.garment, styles: d().styles }) }, { repaint: true }); toast("Fixed: hashtags, SKU and the last line."); });
  el.querySelector("#lst-rewrite").addEventListener("click", async () => { if (await confirmSheet({ title: "Write it again?", body: "Your edits to this text will be replaced. Your SKU stays the same.", ok: "Write it again" })) writeDepop(ctx, el, item); });
  const price = el.querySelector("#lst-price");
  price.addEventListener("input", async () => { const base = withBiz(ctx.items.find(i => i.id === S.id) || item); save(ctx, { ...base, askingPrice: money(price.value) }); });
  el.querySelectorAll("[data-tag]").forEach(b => b.addEventListener("click", async () => {
    const kind = b.dataset.tag, cur = (d()[kind] || []).slice(), i = cur.indexOf(b.dataset.id);
    if (i >= 0) cur.splice(i, 1); else { if (cur.length >= TAG_MAX) { toast("Only 3. Tap one to take it off first."); return; } cur.push(b.dataset.id); }
    const list = kind === "styles" ? DEPOP_STYLES : DEPOP_OCCASIONS;
    await put({ [kind]: validTags(list, cur), approvedAt: null }, { repaint: true });
  }));
  el.querySelector("#lst-rule-add").addEventListener("click", async () => {
    const v = el.querySelector("#lst-rule").value.trim(); if (!v) return;
    await B.setStyle(addRule(await B.style(), v, "told")); el.querySelector("#lst-rule").value = ""; toast("Got it. I’ll follow that from now on.");
  });
  const ap = el.querySelector("#lst-approve");
  if (ap) ap.addEventListener("click", () => approveDepop(ctx, el, item));
  const mk = el.querySelector("#lst-make"); if (mk) mk.addEventListener("click", () => makeOthers(ctx, el, item));
}
async function approveDepop(ctx, el, item) {
    const ta = el.querySelector("#lst-depop-text");
    clearTimeout(saveT); await saving;
    const base = withBiz(ctx.items.find(i => i.id === S.id) || item), prefs = await B.prefs(), cur = { ...base.listings.depop, text: ta.value };
    const chk = checkDepop(ta.value, { sku: base.sku, prefs, styles: cur.styles, occasions: cur.occasions });
    if (!chk.ok) {
      const bad = chk.checks.filter(c => !c.ok).map(c => c.label).join("; ");
      if (!(await confirmSheet({ title: "Approve anyway?", body: "Not quite your format yet: " + bad + ". Tap “Fix the format for me” or approve as it is.", ok: "Approve as it is", cancel: "Let me fix it" }))) return;
    }
    // learn from her edits (what she changed from Kris's draft)
    const L = learnFromEdit(await B.style(), cur.aiText || "", ta.value, { facts: base.garment });
    await B.setStyle(L.style);
    await save(ctx, addEvent({ ...base, listings: { ...base.listings, depop: { ...cur, text: ta.value, approvedAt: Date.now() } } }, "listing", "Depop listing approved"), { now: true });
    toast(L.learned.length ? "Approved! I learned: " + L.learned.join("; ") : "Approved! Copy it into Depop.");
    paint(ctx, el);
}
function refreshChecks(ctx, el, sku, d) {
  B.prefs().then(prefs => {
    const chk = checkDepop(d.text, { sku, prefs, styles: d.styles, occasions: d.occasions });
    const ul = el.querySelector("#lst-checks"); if (!ul) return;
    ul.innerHTML = chk.checks.map(c => `<li class="${c.ok ? "ok" : "bad"}" data-check="${c.id}">${c.ok ? "✓" : "✗"} ${esc(c.label)}</li>`).join("");
    const btn = el.querySelector("#lst-make"); if (btn) { btn.outerHTML = `<button type="button" class="btn btn-main" id="lst-approve-again">✅ Approve my edits</button>`; el.querySelector("#lst-approve-again").addEventListener("click", () => approveDepop(ctx, el, null)); }
  });
}
async function makeOthers(ctx, el, item) {
  const base = withBiz(ctx.items.find(i => i.id === S.id) || item);
  const prefs = await B.prefs();
  S.step = "sites"; S.busy = "Kris is making Mercari, Vinted and eBay…"; history.replaceState(null, "", "#/listing/" + S.id + "/sites"); await paint(ctx, el);
  const r = await listingAsk({ url: kurl(), code: getCode(), mode: "xlist", text: xlistRequest(base.garment, base.listings.depop.text, { style: await styleFor(), mode: prefs.mode }), version: ctx.version });
  S.busy = "";
  if (!r.ok) { toast(aiError(r.error)); paint(ctx, el); return; }
  const fresh = withBiz(ctx.items.find(i => i.id === S.id) || base);
  const plan = fresh.strategy && fresh.strategy.perSite ? fresh.strategy.perSite : {};
  const x = normalizeXlist(r.data, { facts: fresh.garment, sku: fresh.sku, price: fresh.askingPrice, depop: fresh.listings.depop.text });
  for (const site of XSITES) if (plan[site.id] != null) x[site.id].price = String(plan[site.id]);
  await save(ctx, addEvent({ ...fresh, listings: { ...fresh.listings, ...x } }, "listing", "Mercari, Vinted and eBay listings made"), { now: true });
  paint(ctx, el);
}
function wireSites(ctx, el, item) {
  const mk = el.querySelector("#lst-make"); if (mk) mk.addEventListener("click", () => makeOthers(ctx, el, item));
  const rm = el.querySelector("#lst-remake"); if (rm) rm.addEventListener("click", async () => { if (await confirmSheet({ title: "Make them again?", body: "Your edits on these three will be replaced.", ok: "Make them again" })) makeOthers(ctx, el, item); });
  el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.tab; paint(ctx, el); }));
  const card = el.querySelector("#lst-site"); if (!card) return;
  const site = card.dataset.site, max = (XSITES.find(x => x.id === site) || {}).titleMax || 80;
  const upd = () => {
    const base = withBiz(ctx.items.find(i => i.id === S.id) || item);
    const t = el.querySelector("#x-title"), dsc = el.querySelector("#x-desc"), pr = el.querySelector("#x-price");
    el.querySelector("#lst-tcount").textContent = t.value.length + "/" + max;
    save(ctx, { ...base, listings: { ...base.listings, [site]: { ...base.listings[site], title: t.value.slice(0, max), description: dsc.value, price: pr.value } } });
  };
  ["#x-title", "#x-desc", "#x-price"].forEach(s => el.querySelector(s).addEventListener("input", upd));
  el.querySelector("#lst-done").addEventListener("click", async () => {
    await saving;
    const base = withBiz(ctx.items.find(i => i.id === S.id) || item);
    let st = await B.style(), learned = [];
    for (const x of XSITES) { const l = base.listings[x.id]; if (l && l.ai && !l.learnedAt) { const r = learnFromEdit(st, l.ai.description, l.description, { facts: base.garment }); st = r.style; learned = learned.concat(r.learned); base.listings[x.id] = { ...l, learnedAt: Date.now() }; } }
    await B.setStyle(st);
    await save(ctx, base, { now: true });
    toast("All saved on the item." + (learned.length ? " I learned: " + learned.join("; ") : ""));
    location.hash = "#/item/" + base.id;
  });
}
export const __listing = { state: () => S, reset: () => { S = null; } };
