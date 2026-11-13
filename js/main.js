// Flip Helper — iPhone-first PWA. No account. Inventory stays on the phone.
import { $, toast } from "./ui/dom.js";
import { openSuggest } from "./ui/suggest.js";
import { createStore } from "./core/storage.js";
import { normalizeItem } from "./core/inventory.js";
import { renderHome } from "./ui/screens/home.js";
import { renderAdd } from "./ui/screens/add.js";
import { renderItem } from "./ui/screens/item.js";
import { renderItems } from "./ui/screens/items.js";
import { renderSettings } from "./ui/screens/settings.js";

export const VERSION = "0.1.0";

const view = $("#view");
const store = await createStore();

const ctx = {
  version: VERSION,
  store,
  items: [],
  work: null,
  screen: "Home",
  go(hash) { location.hash = hash; },
  async save(item) {
    const row = await store.put(normalizeItem(item));
    await ctx.reload();
    return row;
  },
  async remove(id) { await store.remove(id); await ctx.reload(); },
  async reload() {
    ctx.items = await store.all();
    return ctx.items;
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
  settings: "Settings"
};

function render() {
  const { head, rest } = parseHash();
  const tab = head === "item" ? "items" : (head || "home");
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
  ctx.screen = SCREEN_NAMES[head] || head;
  if (head === "item" && rest[0]) {
    const item = ctx.items.find(i => i.id === rest[0]);
    ctx.screen = item && item.title ? item.title : "Item";
    renderItem(ctx, view, item);
  } else if (head === "add") {
    renderAdd(ctx, view);
  } else if (head === "items") {
    renderItems(ctx, view, rest[0] || "all");
  } else if (head === "settings") {
    renderSettings(ctx, view);
  } else {
    ctx.screen = "Home";
    renderHome(ctx, view);
  }
  document.documentElement.dataset.ready = "1";
  document.documentElement.dataset.screen = head || "home";
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", render);
$("#suggest-open").addEventListener("click", () => openSuggest({ version: VERSION, screen: ctx.screen }));

const swOK = "serviceWorker" in navigator && !/[?&]nosw\b/.test(location.search);
if (swOK) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

render();

// Exposed for smoke tests only. Not a public API. Never includes the AI key.
window.__flip = {
  version: VERSION,
  get items() { return ctx.items; },
  get storeName() { return store.name; },
  reload: () => ctx.reload().then(() => ctx.render()),
  save: item => ctx.save(item),
  remove: id => ctx.remove(id),
  go: h => ctx.go(h),
  render
};
