// Jessika's Flip Side — iPhone-first PWA. No account. Inventory stays on the phone.
import { $, toast } from "./ui/dom.js";
import { openSuggest } from "./ui/suggest.js";
import { createStore } from "./core/storage.js";
import { normalizeItem } from "./core/inventory.js";
import { renderHome } from "./ui/screens/home.js";
import { renderAdd } from "./ui/screens/add.js";
import { renderItem } from "./ui/screens/item.js";
import { renderItems } from "./ui/screens/items.js";
import { renderSettings } from "./ui/screens/settings.js";
import { renderScan } from "./ui/screens/scan.js";
import { renderSecondLook, mountSecondLookBanner } from "./ui/screens/secondlook.js";
import { renderTaxes } from "./ui/screens/taxes.js";
import { renderCompat } from "./ui/screens/compat.js";
import { getJob as getSecondLookJob, loadScans, startSecondLook, saveScan, clearSecondLook, getScan } from "./core/secondlook.js";
import { badgeCount, attentionItems, shouldRemind, reminderBody, delistCountdown } from "./core/protect.js";
import { getSettings, setReminder, getReminders } from "./core/settings.js";
import { mountAskButton } from "./ui/ask.js";
import { shouldShowWalkthrough, walkthroughDone } from "./core/walkthrough.js";
import { openWalkthrough } from "./ui/walkthrough.js";
import { shouldShowIntro } from "./core/intro.js";
import { openIntro, closeIntro, isIntroOpen, getDemoSession } from "./ui/intro.js";
import { shouldShowTermsGate, rememberInviteIfValid } from "./core/invite.js";
import { openTerms, closeTerms, isTermsOpen } from "./ui/terms.js";

export const VERSION = "0.7.1";

const view = $("#view");
const store = await createStore();

const ctx = {
  version: VERSION,
  store,
  items: [],
  work: null,
  scanWork: null,
  screen: "Home",
  go(hash) { location.hash = hash; },
  async save(item) {
    const row = await store.put(normalizeItem(item));
    await ctx.reload();
    updateChrome();
    return row;
  },
  async remove(id) { await store.remove(id); await ctx.reload(); updateChrome(); },
  async reload() {
    ctx.items = await store.all();
    return ctx.items;
  },
  onSold(item) {
    // Immediate loud reminder at the moment of sale — unless Pause all is on.
    maybeNotify(item, { force: true });
    updateChrome();
  },
  render
};

await ctx.reload();

function parseHash() {
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  const [head, ...rest] = raw.split("/");
  return { head: head || "home", rest };
}

const SCREEN_NAMES = {
  home: "Home",
  add: "Add an item",
  items: "Items",
  item: "Item",
  settings: "Settings",
  scan: "Buy or pass",
  secondlook: "Second look",
  taxes: "Taxes",
  sites: "Site limits",
  welcome: "Welcome",
  demo: "Demo"
};

function render() {
  const { head, rest } = parseHash();
  const tab = head === "item" ? "items"
    : (head === "taxes" ? "home"
    : (head === "sites" ? "settings" : (head === "secondlook" ? "home" : (head || "home"))));
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
  ctx.screen = SCREEN_NAMES[head] || head;
  if (head === "item" && rest[0]) {
    const item = ctx.items.find(i => i.id === rest[0]);
    ctx.screen = item && item.title ? item.title : "Item";
    renderItem(ctx, view, item);
    if (item && rest[1] === "takedown") {
      // Drop the /takedown segment so a re-render doesn't retrigger, then start the guided flow.
      history.replaceState(null, "", "#/item/" + item.id);
      queueMicrotask(() => {
        const btn = document.getElementById("takedown-all");
        if (btn) btn.click();
        else toast("Open the item and use Take them all down automatically, or the checklist.");
      });
    }
  } else if (head === "add") {
    renderAdd(ctx, view);
  } else if (head === "items") {
    renderItems(ctx, view, rest[0] || "all");
  } else if (head === "settings") {
    renderSettings(ctx, view);
  } else if (head === "scan") {
    renderScan(ctx, view);
  } else if (head === "secondlook") {
    renderSecondLook(ctx, view, rest[0] || "", rest);
  } else if (head === "taxes") {
    renderTaxes(ctx, view, rest[0]);
  } else if (head === "sites") {
    renderCompat(ctx, view);
  } else if (head === "welcome" || head === "demo") {
    ctx.screen = SCREEN_NAMES[head];
    renderHome(ctx, view);
    queueMicrotask(() => {
      if (isTermsOpen()) return;
      if (!isIntroOpen()) {
        openIntro({
          mode: head === "demo" ? "demo" : "welcome",
          onDone: afterIntro
        });
      }
    });
  } else {
    ctx.screen = "Home";
    renderHome(ctx, view);
  }
  document.documentElement.dataset.ready = "1";
  document.documentElement.dataset.screen = head || "home";
  updateChrome();
  window.scrollTo(0, 0);
}

function updateChrome() {
  const n = badgeCount(ctx.items);
  const badge = document.getElementById("items-badge");
  if (badge) {
    if (n > 0) { badge.hidden = false; badge.textContent = String(n); }
    else { badge.hidden = true; badge.textContent = ""; }
  }
  const base = "Jessika's Flip Side";
  document.title = n > 0 ? `(${n}) ${base}` : base;
}

function maybeNotify(item, { force = false } = {}) {
  if (getSettings().pauseAutomation) return false;
  const last = (getReminders()[item.id] || {}).lastAt;
  if (!force && !shouldRemind(item, last, Date.now())) return false;
  const msg = reminderBody(item);
  if (!msg) return false;
  setReminder(item.id, Date.now());
  // In-app toast is a reminder she can always see while the app is open.
  // Tests can set __flipQuiet to keep screenshots clean.
  if (!window.__flipQuiet) toast(msg.body);
  const prefs = getSettings();
  if (prefs.notifyDelist && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const note = new Notification(msg.title, { body: msg.body, tag: msg.tag, silent: false });
      note.onclick = () => { try { window.focus(); } catch (e) {} location.hash = "#/item/" + item.id; try { note.close(); } catch (e) {} };
    } catch (e) { /* some browsers require a service worker for notifications */ }
  }
  return true;
}

function tickReminders() {
  updateChrome();
  if (getSettings().pauseAutomation) return;
  const items = attentionItems(ctx.items);
  if (!items.length) return;
  const reminders = getReminders();
  for (const item of items) {
    maybeNotify(item, { force: false });
    void reminders;
    void delistCountdown; // countdown is rendered on the item page
  }
}

let remindTimer = setInterval(tickReminders, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tickReminders(); });

window.addEventListener("hashchange", render);
$("#suggest-open").addEventListener("click", () => openSuggest({ version: VERSION, screen: ctx.screen }));

mountAskButton({
  version: VERSION,
  getScreen: () => ctx.screen
});

const swOK = "serviceWorker" in navigator && !/[?&]nosw\b/.test(location.search);
if (swOK) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

function afterIntro() {
  const raw = location.hash || "";
  if (/#\/?welcome\b/.test(raw) || /#\/?demo\b/.test(raw)) ctx.go("#/home");
  if (shouldShowWalkthrough() && !window.__flipQuiet && !/[?&]nowalk\b/.test(location.search)) {
    openWalkthrough();
  }
}

render();
tickReminders();
mountSecondLookBanner(ctx);

// First-open: private invite may show terms first, then the welcome video
// and try-it demo, then the short tips. Public visits (no token) skip terms.
// Tests can skip the video with ?nointro, and the terms with ?noterms.
const { head: firstHead } = parseHash();
const autoIntro = shouldShowIntro(undefined, {
  quiet: window.__flipQuiet,
  search: location.search,
  respectWalkthrough: true,
  walkthroughDone: walkthroughDone()
});

function startAfterTerms() {
  if (firstHead === "welcome" || firstHead === "demo") {
    if (!isIntroOpen()) {
      openIntro({
        mode: firstHead === "demo" ? "demo" : "welcome",
        onDone: afterIntro
      });
    }
    return;
  }
  if (autoIntro) openIntro({ onDone: afterIntro });
  else if (shouldShowWalkthrough() && !window.__flipQuiet && !/[?&]nowalk\b/.test(location.search)) {
    openWalkthrough();
  }
}

await rememberInviteIfValid(location.search);
const needsTerms = await shouldShowTermsGate(undefined, {
  quiet: window.__flipQuiet,
  search: location.search
});
if (needsTerms) {
  openTerms({ onDone: startAfterTerms });
} else if (firstHead === "welcome" || firstHead === "demo") {
  // render() already queued the overlay
} else if (autoIntro) {
  openIntro({ onDone: afterIntro });
} else if (shouldShowWalkthrough() && !window.__flipQuiet && !/[?&]nowalk\b/.test(location.search)) {
  openWalkthrough();
}

// Exposed for smoke tests only. Not a public API. Never includes the AI key.
window.__flip = {
  version: VERSION,
  get items() { return ctx.items; },
  get storeName() { return store.name; },
  reload: () => ctx.reload().then(() => ctx.render()),
  save: item => ctx.save(item),
  remove: id => ctx.remove(id),
  go: h => ctx.go(h),
  render,
  tickReminders,
  get scanWork() { return ctx.scanWork; },
  setScan(w) { ctx.scanWork = w; },
  get secondLookJob() { return getSecondLookJob(); },
  getScans: () => loadScans(),
  getScan,
  saveScan,
  startSecondLook,
  clearSecondLook,
  openIntro,
  closeIntro,
  isIntroOpen,
  getDemoSession,
  openTerms,
  closeTerms,
  isTermsOpen
};
