// "Ask Kris": Jessika's reselling helper (an AI). One button opens a chat where she can type, talk, or add a photo.
// Kris remembers her (on this device, and on her computer too when Sync is on), drafts listings, buyer messages and
// emails she sends herself, sets reminders, and offers one-tap fills for listings, item records and expenses.
// Nothing is saved, sent or posted until she taps. Mirrors Shift Report's js/ask.js on top of kris-core.js.
import { toast, download, confirmSheet } from "./dom.js";
import { getAcceptance } from "../core/invite.js";
import { fileToDataUrl, downscaleDataUrl } from "../core/draft.js";
import {
  KrisCore, KRIS_URL, KRIS_APP_ID, KRIS_TITLE, getCode, setCode, clearCode, isPlausibleCode,
  createKrisStore, loadLog, saveLog, clearLog, krisContext, listingRows, makeListingItem, findItem, recordPlan,
  normalizeExpense, expenseRows, smsHref, changeMailto, friendlyError, pickMode
} from "../core/kris.js";

let C = null, K = null, panel = null, fab = null, busy = false, pending = null, rec = null, remTimer = null;
const log = [];
const url = () => (globalThis.__KRIS_URL != null ? globalThis.__KRIS_URL : KRIS_URL); // tests point this at a fake server
export const krisStore = createKrisStore();

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "onclick") el.addEventListener("click", v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(3)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  // Later .append() calls skip null/false too (the native one would print "null").
  const add = el.append.bind(el);
  el.append = (...k) => add(...k.flat(3).filter(x => x != null && x !== false));
  return el;
}
const core = () => (K || (K = KrisCore.create({ store: krisStore, url, code: async () => getCode(), prefix: "kris" })));
export function krisCore() { return core(); }

function firstName() {
  const a = getAcceptance();
  return a && a.name ? String(a.name).trim().split(/\s+/)[0] : "";
}

/** Show the button only on a device that has her code (from the setup link or typed in Settings), or with ?kris=1. */
export function krisEnabled() {
  try {
    const q = new URLSearchParams(location.search).get("kris");
    if (q === "1") localStorage.setItem("flip-helper.kris.on", "1");
    if (q === "0") localStorage.removeItem("flip-helper.kris.on");
    return !!getCode() || localStorage.getItem("flip-helper.kris.on") === "1";
  } catch (e) { return !!getCode(); }
}

export function mountKris(ctx) {
  C = ctx;
  core();
  if (!krisEnabled()) { if (fab) { fab.remove(); fab = null; } document.body.classList.remove("has-kris"); return; }
  document.body.classList.add("has-kris");
  if (!fab && !document.getElementById("kris-fab")) {
    fab = h("button", { type: "button", id: "kris-fab", class: "kris-fab", "aria-label": "Ask Kris, your reselling helper", onclick: () => openKris() },
      h("span", { class: "kris-fab-icon", "aria-hidden": "true" }, "💬"), h("span", { class: "kris-fab-label" }, "Ask Kris"));
    document.body.append(fab);
  }
  startReminders();
}

// ---------- panel ----------
export async function openKris() {
  if (panel) panel.remove();
  if (!log.length) log.push(...loadLog());
  const code = getCode();
  panel = h("div", { class: "kris-panel", id: "kris-panel", role: "dialog", "aria-modal": "true", "aria-label": KRIS_TITLE });
  const head = h("div", { class: "kris-head" },
    h("button", { type: "button", class: "btn sm soft kris-back", id: "kris-close", onclick: closeKris }, "‹ Done"),
    h("div", { class: "kris-title" }, "Kris", h("span", { class: "kris-sub" }, "Your reselling helper")),
    code ? h("button", { type: "button", class: "btn sm soft", id: "kris-memory", onclick: memorySheet, "aria-label": "What Kris remembers" }, "🧠 Remembers") : h("span"));
  const msgs = h("div", { class: "kris-msgs", id: "kris-msgs", "aria-live": "polite" });
  panel.append(head, msgs);
  if (!code) {
    msgs.append(codeCard(() => openKris()));
  } else {
    const nm = firstName();
    if (!log.length) msgs.append(h("div", { class: "kris-msg kris-ai", id: "kris-hello" }, h("div", { class: "kris-txt" },
      `Hi${nm ? " " + nm : ""}! I’m Kris, your reselling helper. Snap a photo and I’ll write the listing. I can help price things, answer a buyer, keep your records straight, log an expense, or remind you of something. What are we working on?`)));
    msgs.append(h("div", { class: "kris-quick", id: "kris-quick" },
      quick("📷 List it from a photo", "listing", "Make a listing from this photo.", true),
      quick("💲 What’s it worth?", "chat", "What could I sell this for? "),
      quick("💬 Answer a buyer", "chat", "Help me answer a buyer. They said: "),
      quick("🧾 Log a sale or expense", "chat", "I sold "),
      quick("⏰ Remind me", "chat", "Remind me at "),
      quick("❓ How do I…", "help", "How do I "),
      quick("🛠 Change my app", "change", "Please change my app: ")));
  }
  for (const m of log) msgs.append(bubble(m));
  if (code) {
    const ta = h("textarea", { class: "kris-text", id: "kris-text", rows: "2", maxlength: "4000", placeholder: "Type, or tap 🎤 to talk…", "aria-label": "Message to Kris" });
    const photoIn = h("input", { type: "file", id: "kris-photo-file", accept: "image/*", hidden: true });
    photoIn.addEventListener("change", async () => { const f = photoIn.files[0]; photoIn.value = ""; if (f) await addPhoto(f); });
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    const mic = SR ? h("button", { type: "button", class: "kris-ic", id: "kris-mic", "aria-label": "Talk", onclick: () => dictate(SR, ta, mic) }, "🎤") : null;
    const cam = h("button", { type: "button", class: "kris-ic", id: "kris-cam", "aria-label": "Add a photo", onclick: () => photoIn.click() }, "📷");
    const thumb = h("div", { class: "kris-thumb", id: "kris-thumb", hidden: true });
    const send = h("button", { type: "button", class: "btn kris-send", id: "kris-send", onclick: () => sendChat(ta) }, "Send");
    panel.append(h("div", { class: "kris-bar" }, thumb, h("div", { class: "kris-row" }, ta, mic, cam, photoIn), send));
  }
  document.body.append(panel);
  document.body.classList.add("kris-open");
  msgs.scrollTop = msgs.scrollHeight;
  return panel;
}
export function closeKris() {
  if (rec) try { rec.stop(); } catch (e) { }
  if (panel) panel.remove();
  panel = null;
  document.body.classList.remove("kris-open");
}
function quick(label, mode, text, photo) {
  return h("button", { type: "button", class: "btn sm soft kris-q", "data-mode": mode, onclick: () => {
    const ta = document.getElementById("kris-text"); if (!ta) return;
    ta.value = text; ta.dataset.mode = mode; ta.focus();
    if (photo && !pending) document.getElementById("kris-photo-file").click();
  } }, label);
}
export function codeCard(after) {
  const f = h("input", { class: "kris-input", id: "kris-code-in", placeholder: "Your code", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", "aria-label": "Your Kris code" });
  return h("div", { class: "card kris-card", id: "kris-code-card" },
    h("h3", null, "Enter your code (just once)"),
    h("p", { class: "small muted" }, "KJ gives you this code. Type it once and this device remembers it."), f,
    h("button", { type: "button", class: "btn", id: "kris-code-save", style: "margin-top:10px", onclick: () => {
      if (!isPlausibleCode(f.value)) { toast("That code looks too short"); return; }
      setCode(f.value); toast("Saved. Kris is ready!"); mountKris(C); if (after) after();
    } }, "Save my code"));
}

// ---------- messages and action cards ----------
function bubble(m) {
  const b = h("div", { class: "kris-msg kris-" + m.who },
    m.img ? h("img", { src: m.img, alt: "Photo", class: "kris-img" }) : (m.hadPhoto && m.who === "me" ? h("div", { class: "tiny muted" }, "📷 (photo)") : null),
    m.text ? h("div", { class: "kris-txt" }, m.text) : null);
  if (m.who === "ai" && (m.remembered || []).length) b.append(h("div", { class: "kris-mem" }, "📌 I’ll remember: " + m.remembered.join(" · ")));
  if (m.who === "ai") (m.actions || []).forEach(a => { const c = actionCard(m, a); if (c) b.append(c); });
  if (m.who === "ai" && m.change) b.append(h("div", { class: "kris-acts" },
    h("a", { class: "btn sm", href: changeMailto({ text: m.change, version: C && C.version }), "data-kris": "change" }, "✉ Send this to KJ’s helper")));
  return b;
}
function push(m) {
  log.push(m);
  const box = document.getElementById("kris-msgs");
  if (box) { box.append(bubble(m)); box.scrollTop = box.scrollHeight; }
  saveLog(log);
}
function redraw(m, card) {
  saveLog(log);
  const old = card && card.closest(".kris-msg");
  if (old) old.replaceWith(bubble(m));
}
const copyBtn = (label, text) => h("button", { type: "button", class: "btn sm soft", onclick: () => core().copy(text()).then(ok => toast(ok ? "Copied. Paste it and send it yourself." : "Couldn’t copy")) }, label);
async function shareText(title, text) {
  try { if (navigator.share) { await navigator.share({ title, text }); return true; } } catch (e) { if (e && e.name === "AbortError") return true; }
  return false;
}
const rowsEl = rows => h("dl", { class: "kris-pre" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]));

function actionCard(m, a) {
  const done = !!a.done, card = h("div", { class: "kris-card" + (done ? " done" : ""), "data-type": a.type, "data-target": a.target || "" });
  const btns = h("div", { class: "kris-acts" });
  const mark = label => { a.done = label || true; redraw(m, card); };
  const okLine = t => h("div", { class: "kris-ok" }, "✓ " + t);
  if (a.type === "fill" && a.target === "listing") {
    card.append(h("div", { class: "kris-ct" }, "🏷 A new listing draft"), a.summary ? h("div", { class: "tiny muted" }, a.summary) : null, rowsEl(listingRows(a.data)),
      m.photo ? h("div", { class: "tiny muted" }, "📷 Your photo goes with it.") : null,
      h("div", { class: "tiny muted" }, "Prices are estimates. Check the brand and condition before you post."));
    if (done) btns.append(okLine(typeof a.done === "string" ? a.done : "Saved"), a.itemId ? h("a", { class: "btn sm soft", href: "#/item/" + a.itemId, onclick: closeKris }, "Open it") : null);
    else btns.append(h("button", { type: "button", class: "btn sm kris-apply", onclick: async () => {
      const item = makeListingItem(a.data || {}, { photo: m.photo || null });
      if (!item.title && !item.description) { toast("There’s nothing to save yet"); return; }
      const row = await C.save(item); a.itemId = row.id; toast("Saved as a draft in Items"); mark("Saved as a draft");
    } }, "Save as a draft"), h("button", { type: "button", class: "btn sm soft", onclick: () => mark("Skipped") }, "No thanks"));
  } else if (a.type === "fill" && a.target === "record") {
    card.append(h("div", { class: "kris-ct" }, "📦 Update an item"), a.summary ? h("div", { class: "tiny muted" }, a.summary) : null);
    if (done) { card.append(okLine(typeof a.done === "string" ? a.done : "Saved")); return card; }
    const d = a.data || {};
    const pickId = a.pickId || null;
    const found = pickId ? { item: C.items.find(i => i.id === pickId) || null, candidates: [] } : findItem(C.items, d.item);
    if (!found.item) {
      if (found.candidates.length) {
        card.append(h("p", { class: "small" }, "Which one do you mean?"));
        for (const it of found.candidates) btns.append(h("button", { type: "button", class: "btn sm soft", onclick: () => { a.pickId = it.id; redraw(m, card); } }, it.title || "Untitled item"));
      } else card.append(h("p", { class: "small" }, `I couldn’t find “${d.item || "that item"}” in your items. Tell me its name the way it’s saved.`));
      btns.append(h("button", { type: "button", class: "btn sm soft", onclick: () => mark("Skipped") }, "No thanks"));
    } else {
      const plan = recordPlan(found.item, d);
      card.append(h("div", { class: "small" }, h("b", null, found.item.title || "Untitled item")));
      if (plan.changes.length) card.append(h("div", { class: "kris-pre kris-diff" }, plan.changes.map(c => h("div", null, h("b", null, c.label + ": "), h("s", null, c.from), " → ", h("span", null, c.to)))));
      else card.append(h("p", { class: "small muted" }, "Nothing would change."));
      if (plan.skipped.length) card.append(h("p", { class: "tiny muted" }, "Not changed: " + plan.skipped.join("; ")));
      if (plan.changes.length) btns.append(h("button", { type: "button", class: "btn sm kris-apply", onclick: async () => {
        const fresh = C.items.find(i => i.id === found.item.id) || found.item;
        const again = recordPlan(fresh, d);
        await C.save(again.next);
        if (again.becameSold && C.onSold) C.onSold(again.next);
        toast("Saved. Check it on the item page."); mark("Saved to " + (fresh.title || "the item"));
      } }, "Yes, save these changes"));
      btns.append(h("a", { class: "btn sm soft", href: "#/item/" + found.item.id, onclick: closeKris }, "Open the item"),
        h("button", { type: "button", class: "btn sm soft", onclick: () => mark("Skipped") }, "No thanks"));
    }
  } else if (a.type === "fill" && a.target === "expense") {
    const e = normalizeExpense(a.data || {});
    card.append(h("div", { class: "kris-ct" }, "🧾 Log an expense"), e ? rowsEl(expenseRows(e)) : h("p", { class: "small" }, "I didn’t catch the amount."));
    if (done) btns.append(okLine(typeof a.done === "string" ? a.done : "Saved"), h("a", { class: "btn sm soft", href: "#/taxes", onclick: closeKris }, "See it in Taxes"));
    else if (e) btns.append(h("button", { type: "button", class: "btn sm kris-apply", onclick: async () => {
      const list = await krisStore.get("krisExpenses", []); const arr = Array.isArray(list) ? list : [];
      arr.push(e); await krisStore.set("krisExpenses", arr.slice(-500)); toast("Expense saved. It’s under Taxes → Other expenses."); mark("Expense saved");
    } }, "Save this expense"), h("button", { type: "button", class: "btn sm soft", onclick: () => mark("Skipped") }, "No thanks"));
  } else if (a.type === "fill") {
    return h("div", { class: "kris-card" }, "Kris made something this version of the app can’t use yet.");
  } else if (a.type === "email") {
    const to = h("input", { class: "kris-input", value: a.to || "", placeholder: "To (email)", "aria-label": "To" });
    const sub = h("input", { class: "kris-input", value: a.subject || "", placeholder: "Subject", "aria-label": "Subject" });
    const body = h("textarea", { class: "kris-input", rows: "6", "aria-label": "Email" }); body.value = a.body || "";
    [to, sub, body].forEach(el => el.addEventListener("change", () => { a.to = to.value; a.subject = sub.value; a.body = body.value; saveLog(log); }));
    card.append(h("div", { class: "kris-ct" }, "✉ Email draft (you press Send)"), to, a.cc ? h("div", { class: "tiny muted" }, "Cc: " + a.cc) : null, sub, body);
    if (done) btns.append(okLine("Opened in your mail app"));
    btns.append(h("a", { class: "btn sm kris-apply", href: "#", onclick: ev => { ev.preventDefault(); a.to = to.value; a.subject = sub.value; a.body = body.value; core().openEmail({ to: a.to, cc: a.cc, subject: a.subject, body: a.body, toast }); mark("Opened in your mail app"); } }, done ? "Open again" : "Open in my mail app"),
      navigator.share ? h("button", { type: "button", class: "btn sm soft", onclick: () => shareText(sub.value, (to.value ? "To: " + to.value + "\n" : "") + body.value) }, "Share…") : null,
      copyBtn("Copy", () => (to.value ? "To: " + to.value + "\n" : "") + "Subject: " + sub.value + "\n\n" + body.value));
  } else if (a.type === "message") {
    const where = a.channel === "marketplace" ? " (paste it in the site’s chat)" : "";
    card.append(h("div", { class: "kris-ct" }, "💬 Message for " + (a.to || "you to send") + where), h("div", { class: "kris-pre" }, a.text || ""));
    const sms = a.channel === "text" ? smsHref(a.to, a.text) : "";
    btns.append(copyBtn("Copy message", () => a.text || ""), sms ? h("a", { class: "btn sm soft", href: sms }, "Open in Messages") : null,
      navigator.share ? h("button", { type: "button", class: "btn sm soft", onclick: () => shareText("Message", a.text || "") }, "Share…") : null);
  } else if (a.type === "reminder") {
    const when = KrisCore.niceWhen(a.at);
    card.append(h("div", { class: "kris-ct" }, "⏰ Reminder"), h("div", { class: "kris-pre" }, (a.text || "") + "\n" + (when || "time not clear")));
    if (done) btns.append(okLine("Reminder set"));
    else btns.append(h("button", { type: "button", class: "btn sm kris-apply", onclick: async () => {
      const r = await core().addReminder(a); if (!r) { toast("I couldn’t read that time. Tell me again, like “at 4 PM”."); return; }
      const p = await core().askNotify(); a.remId = r.id; mark("Reminder set");
      toast(p === "granted" ? "Set! I’ll pop up " + when + " if the app is open. For a sure alarm, tap Add to calendar." : "Set! You’ll see it here " + when + ". For a sure alarm, tap Add to calendar.");
    } }, "Set reminder"));
    btns.append(h("button", { type: "button", class: "btn sm soft", onclick: () => {
      const txt = core().ics({ id: a.remId || "r" + Date.now(), at: a.at, text: a.text }, "Flip Side");
      download("reminder.ics", txt, "text/calendar"); toast("Open reminder.ics to add it to your calendar.");
    } }, "📅 Add to calendar"));
  } else return null;
  card.append(btns);
  return card;
}

// ---------- reminders: checked while the app is open; a phone notification only if she allowed it ----------
function startReminders() {
  if (remTimer) return;
  const tick = () => checkReminders().catch(() => { });
  remTimer = setInterval(tick, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  setTimeout(tick, 1500);
}
export async function checkReminders(now) {
  const due = await core().due(now);
  for (const r of due) {
    await core().updateReminder(r.id, { shown: true });
    core().notify("Kris reminder", r.text);
    showReminder(r);
  }
  return due.length;
}
function showReminder(r) {
  let box = document.getElementById("kris-rems");
  if (!box) { box = h("div", { class: "kris-rems", id: "kris-rems" }); document.body.append(box); }
  const el = h("div", { class: "kris-rem", role: "alert", "data-id": r.id },
    h("div", { class: "grow" }, h("b", null, "⏰ Kris reminder"), h("div", null, r.text)),
    h("button", { type: "button", class: "btn sm", onclick: async () => { await core().updateReminder(r.id, { done: true, doneAt: Date.now() }); el.remove(); } }, "Done"),
    h("button", { type: "button", class: "btn sm soft", onclick: async () => { await core().snooze(r.id, 15); el.remove(); toast("I’ll remind you again in 15 minutes."); } }, "In 15 min"));
  box.append(el);
}

// ---------- "Kris remembers" ----------
async function memorySheet() {
  const old = document.getElementById("kris-mem-sheet"); if (old) old.remove();
  const K2 = core(), facts = await K2.facts(), rems = (await K2.reminders()).filter(r => !r.done), topics = await K2.topics();
  const sheet = h("div", { class: "kris-panel kris-memsheet", id: "kris-mem-sheet", role: "dialog", "aria-label": "What Kris remembers" });
  const add = h("input", { class: "kris-input", id: "kris-mem-add", placeholder: "e.g. I sell mostly on Mercari. Sign messages “Jess”." });
  const body = h("div", { class: "kris-msgs" },
    h("div", { class: "card kris-card" }, h("h3", null, "🧠 What I remember about you"),
      h("p", { class: "small muted" }, "Kept on this device (and on your computer if Sync is on). I use it to help you faster. Tap ✕ to make me forget something."),
      facts.length ? h("ul", { class: "kris-memlist", id: "kris-facts" }, facts.map((f, i) => h("li", null, h("span", { class: "grow" }, f.t),
        h("button", { type: "button", class: "kris-x", "aria-label": "Forget this", onclick: async () => { await K2.removeFact(i); memorySheet(); } }, "✕"))))
        : h("p", { class: "small muted", id: "kris-facts-none" }, "Nothing yet. Tell me things like where you sell, how you like to price, or how you sign your messages."),
      h("div", { class: "kris-row" }, add, h("button", { type: "button", class: "btn sm", id: "kris-mem-add-btn", onclick: async () => { if (!add.value.trim()) return; await K2.addFacts([add.value]); memorySheet(); } }, "Add"))),
    h("div", { class: "card kris-card" }, h("h3", null, "⏰ Reminders"),
      rems.length ? h("ul", { class: "kris-memlist", id: "kris-rem-list" }, rems.map(r => h("li", null, h("span", { class: "grow" }, r.text + " — " + KrisCore.niceWhen(r.at)),
        h("button", { type: "button", class: "kris-x", "aria-label": "Delete reminder", onclick: async () => { await K2.removeReminder(r.id); memorySheet(); } }, "✕"))))
        : h("p", { class: "small muted" }, "None yet. Say “remind me at 4 to ship the lamp.”"),
      h("p", { class: "tiny muted" }, "Phones only let me pop up while the app is open or was used lately. For a sure alarm, use “Add to calendar” on the reminder.")),
    topics.length ? h("div", { class: "card kris-card" }, h("h3", null, "Recent chats"), h("ul", { class: "kris-memlist" }, topics.slice().reverse().map(t => h("li", null, t.d + ": " + t.t)))) : null,
    h("button", { type: "button", class: "btn soft", id: "kris-forget-all", onclick: async () => {
      if (!(await confirmSheet({ title: "Forget everything?", body: "Kris forgets what she remembers and this chat is cleared. Reminders and expenses stay.", ok: "Forget everything", danger: true }))) return;
      await K2.clearMemory(); log.length = 0; clearLog(); sheet.remove(); openKris(); toast("Done. I forgot everything.");
    } }, "Forget everything and clear the chat"),
    h("button", { type: "button", class: "btn soft", id: "kris-remove-code", style: "margin-top:8px", onclick: async () => {
      if (!(await confirmSheet({ title: "Turn off Kris on this device?", body: "This removes your code from this device. You can type it again any time in Settings → Ask Kris.", ok: "Turn off" }))) return;
      clearCode(); sheet.remove(); closeKris(); mountKris(C); toast("Kris is off on this device.");
    } }, "Turn off Kris on this device"));
  sheet.append(h("div", { class: "kris-head" }, h("button", { type: "button", class: "btn sm soft", id: "kris-mem-close", onclick: () => sheet.remove() }, "‹ Back"), h("div", { class: "kris-title" }, "Kris remembers"), h("span", { class: "kris-spacer" })), body);
  document.body.append(sheet);
}

// ---------- photo and talk ----------
async function addPhoto(file) {
  try {
    const data = await downscaleDataUrl(await fileToDataUrl(file), 1600, 0.8);
    pending = data;
    const t = document.getElementById("kris-thumb");
    if (t) { t.innerHTML = ""; t.append(h("img", { src: data, alt: "Photo to send" }), h("button", { type: "button", class: "kris-x", "aria-label": "Remove photo", onclick: () => { pending = null; t.hidden = true; } }, "✕")); t.hidden = false; }
  } catch (e) { toast("I couldn’t read that photo"); }
}
function dictate(SR, ta, btn) {
  if (rec) { try { rec.stop(); } catch (e) { } return; }
  try {
    rec = new SR(); rec.lang = navigator.language || "en-US"; rec.interimResults = false; rec.continuous = false;
    const start = ta.value;
    rec.onresult = ev => { const t = [...ev.results].map(r => r[0].transcript).join(" "); ta.value = (start ? start.trim() + " " : "") + t; };
    rec.onend = () => { rec = null; btn.classList.remove("on"); };
    rec.onerror = () => { rec = null; btn.classList.remove("on"); toast("Talking didn’t work here. Type it instead."); };
    btn.classList.add("on"); rec.start(); toast("I’m listening…");
  } catch (e) { rec = null; toast("Talking isn’t available here. Type it instead."); }
}

// ---------- send ----------
function openItemFromHash() {
  const m = /^#\/item\/([^/]+)/.exec(location.hash || "");
  return m ? (C.items || []).find(i => i.id === m[1]) || null : null;
}
async function sendChat(ta) {
  if (busy) return;
  const text = ta.value.trim(), img = pending;
  if (!text && !img) { toast("Type something or add a photo"); return; }
  const mode = pickMode(ta.dataset.mode, !!img);
  const prior = log.slice();
  busy = true;
  push({ who: "me", text, img: img || undefined });
  ta.value = ""; delete ta.dataset.mode; pending = null;
  const t = document.getElementById("kris-thumb"); if (t) t.hidden = true;
  const hello = document.getElementById("kris-hello"); if (hello) hello.remove();
  const wait = h("div", { class: "kris-msg kris-ai kris-wait", id: "kris-wait" }, "Kris is thinking…");
  const box = document.getElementById("kris-msgs"); if (box) { box.append(wait); box.scrollTop = box.scrollHeight; }
  try {
    const expenses = await krisStore.get("krisExpenses", []);
    const context = krisContext({ items: C.items || [], screen: C.screen, openItem: openItemFromHash(), name: firstName(), expenses });
    const r = await core().ask({ text, image: img || null, mode, log: prior, context, app: { id: KRIS_APP_ID, version: C.version || "", view: C.screen || "" } });
    wait.remove();
    if (!r.ok) { if (r.error === "code") clearCode(); push({ who: "note", text: friendlyError(r.error) }); return; }
    let remembered = [];
    for (const a of r.actions.filter(a => a.type === "remember")) remembered = remembered.concat(await core().addFacts(a.facts || []));
    for (const a of r.actions.filter(a => a.type === "forget")) { const n = await core().forget(a.match); if (n) toast("Forgot " + n + " thing" + (n > 1 ? "s" : "") + "."); }
    const actions = r.actions.filter(a => a.type !== "remember" && a.type !== "forget");
    // The photo stays with this reply only while the app is open, so "Save as a draft" can keep it.
    const msg = { who: "ai", text: r.reply || "", mode, actions, remembered, change: r.change ? [r.change, text].filter(Boolean).join("\n\nIn my words: ") : "" };
    if (img && actions.some(a => a.type === "fill" && a.target === "listing")) msg.photo = img;
    push(msg);
  } catch (e) { wait.remove(); push({ who: "note", text: friendlyError("network") }); }
  finally { busy = false; }
}

// For tests only.
export const __kris = { log, checkReminders, core: () => core() };
