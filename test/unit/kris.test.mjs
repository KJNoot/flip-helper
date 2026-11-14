// v0.9.0 Ask Kris: setup code, memory + sync snapshot, context, fills (listing, record, expense), drafts.
// Never calls the real Kris server: every request goes to a fake fetch.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  KrisCore, KRIS_URL, KRIS_APP_ID, CODE_KEY, KV_PREFIX, SYNC_NAMES, CLOUD_PREFIX,
  normalizeCode, isPlausibleCode, getCode, setCode, clearCode, codeFromUrl, takeSetupLink,
  createKrisStore, krisKvSnapshot, applyKrisKv, onKrisChange, loadLog, saveLog,
  krisContext, siteIdFrom, parseDay, listingRows, makeListingItem, findItem, recordPlan,
  normalizeExpense, expenseRows, expensesTotal, expensesInYear, smsHref, changeMailto, friendlyError, pickMode
} from "../../app/js/core/kris.js";
import { emptyItem, setListed } from "../../app/js/core/inventory.js";
import { payloadHasKey, stripKeyish } from "../../app/js/core/sync.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FAKE = "FS-TESTCODE12345";
function mem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _m: m };
}

describe("Kris code and private setup link", () => {
  it("cleans and checks a typed code", () => {
    assert.equal(normalizeCode(" fs-ab c12!34 "), "FS-ABC1234");
    assert.equal(isPlausibleCode("FS-1"), false);
    assert.equal(isPlausibleCode(FAKE), true);
    const s = mem();
    assert.equal(setCode("short", s), "");
    assert.equal(setCode(FAKE.toLowerCase(), s), FAKE);
    assert.equal(getCode(s), FAKE);
    clearCode(s);
    assert.equal(getCode(s), "");
  });
  it("reads the code from #kris=, #/home?kris= or ?kris=, and ignores ?kris=1", () => {
    assert.equal(codeFromUrl("#kris=" + FAKE), FAKE);
    assert.equal(codeFromUrl("#/home?kris=" + FAKE), FAKE);
    assert.equal(codeFromUrl("", "?nosw&kris=" + FAKE), FAKE);
    assert.equal(codeFromUrl("", "?kris=1"), "");
    assert.equal(codeFromUrl("#/items"), "");
  });
  it("stores the link's code and removes it from the address bar", () => {
    const s = mem(); let replaced = null;
    const ok = takeSetupLink({ hash: "#kris=" + FAKE, search: "", pathname: "/flip-helper/" }, { replaceState: (a, b, u) => { replaced = u; } }, s);
    assert.equal(ok, true);
    assert.equal(s.getItem(CODE_KEY), FAKE);
    assert.equal(replaced, "/flip-helper/#/home");
    assert.ok(!replaced.includes(FAKE));
    let again = null;
    takeSetupLink({ hash: "", search: "?kris=" + FAKE + "&nosw", pathname: "/flip-helper/index.html" }, { replaceState: (a, b, u) => { again = u; } }, mem());
    assert.ok(!again.includes(FAKE)); assert.match(again, /nosw/);
    assert.equal(takeSetupLink({ hash: "#/home", search: "", pathname: "/" }, { replaceState: () => { throw new Error("should not run"); } }, mem()), false);
  });
});

describe("Kris memory store and sync", () => {
  it("kris-core keeps facts, topics and reminders in the store, with change events", async () => {
    const s = mem(), store = createKrisStore(s); let changed = 0;
    const off = onKrisChange(() => changed++);
    const K = KrisCore.create({ store, url: () => "", code: async () => FAKE, prefix: "kris" });
    assert.deepEqual(await K.addFacts(["Goes by Jess", "goes by jess", "My card number is 1234"]), ["Goes by Jess"]);
    await K.noteTopic("priced a lamp");
    await K.addReminder({ at: "2026-11-14T16:00", text: "Ship the lamp" });
    assert.equal((await K.facts()).length, 1);
    assert.ok(changed >= 3);
    off();
    assert.ok(s.getItem(KV_PREFIX + "krisFacts"));
  });
  it("the sync snapshot has the four memory lists plus her code (v0.9.1), and passes the key check", async () => {
    const s = mem(), store = createKrisStore(s);
    setCode(FAKE, s);
    await store.set("krisFacts", [{ t: "Sells on Mercari", ts: 1 }], 1000);
    await store.set("krisExpenses", [{ id: "ex_1", what: "Boxes", amount: 12 }], 2000);
    await store.set("somethingElse", ["x"]);
    const snap = krisKvSnapshot(s);
    assert.deepEqual(Object.keys(snap).sort(), ["kris:krisAccess", "kris:krisExpenses", "kris:krisFacts"]);
    assert.equal(snap["kris:krisFacts"].updatedAt, 1000);
    assert.deepEqual(snap["kris:krisAccess"].payload, { v: [FAKE] });
    assert.ok(!JSON.stringify({ ...snap, "kris:krisAccess": null }).includes(FAKE), "the code is only in krisAccess");
    for (const v of Object.values(snap)) { assert.equal(payloadHasKey(v.payload), false); assert.deepEqual(stripKeyish(v.payload), v.payload); }
    assert.deepEqual(SYNC_NAMES, ["krisFacts", "krisTopics", "krisReminders", "krisExpenses"]);
  });
  it("applies the other device's copy only for known lists", async () => {
    const s = mem(), store = createKrisStore(s);
    assert.equal(applyKrisKv(CLOUD_PREFIX + "krisFacts", { v: [{ t: "Call me Jess" }] }, 5000, s), true);
    assert.deepEqual(await store.get("krisFacts", []), [{ t: "Call me Jess" }]);
    assert.equal(krisKvSnapshot(s)["kris:krisFacts"].updatedAt, 5000);
    assert.equal(applyKrisKv("kris:code", { v: [FAKE] }, 1, s), false);
    assert.equal(applyKrisKv("prefs", { v: [] }, 1, s), false);
    assert.equal(applyKrisKv("kris:krisFacts", { v: "nope" }, 1, s), false);
    assert.equal(s.getItem(CODE_KEY), null);
  });
  it("the chat log drops photos and keeps the last 40", () => {
    const s = mem();
    const log = Array.from({ length: 45 }, (_, i) => ({ who: i % 2 ? "ai" : "me", text: "m" + i, img: i === 44 ? "data:image/jpeg;base64,AAA" : undefined, photo: "data:x" }));
    saveLog(log, s);
    const back = loadLog(s);
    assert.equal(back.length, 40);
    assert.ok(!JSON.stringify(back).includes("data:"));
    assert.equal(back[39].hadPhoto, true);
  });
});

describe("Kris context and fills", () => {
  const lamp = setListed(emptyItem({ id: "it_lamp1", title: "Vintage brass lamp", costPaid: 5, askingPrice: 30 }), "ebay");
  const mug = emptyItem({ id: "it_mug22", title: "Blue pottery mug", costPaid: 2 });
  const mug2 = emptyItem({ id: "it_mug33", title: "Blue pottery mug set", costPaid: 4 });
  it("context lists items with ids and stays under 3,000 characters", () => {
    const t = krisContext({ items: [lamp, mug], screen: "Items", name: "Jessika", openItem: lamp });
    assert.match(t, /User: Jessika/);
    assert.match(t, /Items: 2 \(/);
    assert.match(t, /Open item: "Vintage brass lamp" · Listed · cost \$5\.00 · asking \$30\.00 · listed on eBay \[it_lamp1\]/);
    assert.match(t, /Blue pottery mug/);
    const many = Array.from({ length: 200 }, (_, i) => emptyItem({ title: "A long item title number " + i + " ".repeat(10) + "x".repeat(40) }));
    assert.ok(krisContext({ items: many }).length <= 3000);
  });
  it("knows the sites by name", () => {
    assert.equal(siteIdFrom("Facebook Marketplace"), "facebook");
    assert.equal(siteIdFrom("FB"), "facebook");
    assert.equal(siteIdFrom("Mercari"), "mercari");
    assert.equal(siteIdFrom("posh"), "poshmark");
    assert.equal(siteIdFrom("my garage sale"), null);
  });
  it("reads dates", () => {
    const now = new Date(2026, 10, 14, 9);
    assert.equal(parseDay("2026-11-13", now).getDate(), 13);
    assert.equal(parseDay("11/12", now).getMonth(), 10);
    assert.equal(parseDay("yesterday", now).getDate(), 13);
    assert.equal(parseDay("", now), null);
  });
  it("a listing fill becomes a new Draft item with the photo, prices as estimates", () => {
    const data = { title: "Brass lamp", description: "Works.", priceLow: "20", priceHigh: "$35", price: "28", brand: "Stiffel", tags: ["vintage", "lamp"], platform: "eBay", color: "gold" };
    const rows = listingRows(data);
    assert.ok(rows.some(([k, v]) => k === "Price (estimate)" && /\$20\.00 – \$35\.00/.test(v)));
    assert.ok(rows.some(([k]) => k === "Brand (check it)"));
    const it2 = makeListingItem(data, { photo: "data:image/jpeg;base64,AAA", at: 1000 });
    assert.equal(it2.stage, "draft");
    assert.equal(it2.title, "Brass lamp");
    assert.equal(it2.priceLow, 20); assert.equal(it2.priceHigh, 35); assert.equal(it2.askingPrice, 28);
    assert.equal(it2.photos.length, 1);
    assert.match(it2.notes, /Tags: vintage, lamp/); assert.match(it2.notes, /Plan to list on: eBay/);
    assert.deepEqual(it2.listedOn, {}, "Kris never marks it listed; she posts it herself");
  });
  it("finds the item she means, or asks which one", () => {
    assert.equal(findItem([lamp, mug, mug2], "it_lamp1").item.id, "it_lamp1");
    assert.equal(findItem([lamp, mug, mug2], "the brass lamp").item.id, "it_lamp1");
    const amb = findItem([lamp, mug, mug2], "blue mug");
    assert.equal(amb.item, null);
    assert.ok(amb.candidates.length >= 2);
    assert.deepEqual(findItem([lamp], "snowboard"), { item: null, candidates: [] });
  });
  it("a record fill shows old → new and doesn't touch the saved item", () => {
    const before = JSON.stringify(lamp);
    const p = recordPlan(lamp, { item: "lamp", status: "Sold", soldPrice: "$42", platform: "Mercari", fees: "4.20", buyer: "Sam", date: "2026-11-13" }, { now: new Date(2026, 10, 14).getTime() });
    assert.equal(JSON.stringify(lamp), before);
    assert.equal(p.becameSold, true);
    assert.equal(p.next.stage, "sold");
    assert.equal(p.next.salePrice, 42);
    assert.equal(p.next.soldOn, "mercari");
    assert.equal(new Date(p.next.soldAt).getDate(), 13);
    const labels = p.changes.map(c => c.label);
    for (const l of ["Stage", "Sold price", "Sold on", "Fees"]) assert.ok(labels.includes(l), l);
    const stage = p.changes.find(c => c.label === "Stage");
    assert.equal(stage.from, "Listed"); assert.equal(stage.to, "Sold");
    assert.match(p.next.notes, /Buyer: Sam/);
  });
  it("record: listing needs a site, shipped marks sold first, cost alone is a small change", () => {
    const a = recordPlan(mug, { status: "Listed" });
    assert.equal(a.changes.length, 0); assert.equal(a.skipped.length, 1);
    const b = recordPlan(mug, { status: "Listed", platform: "Poshmark" });
    assert.equal(b.next.stage, "listed");
    const c = recordPlan(mug, { status: "Shipped", soldPrice: "15" });
    assert.equal(c.next.stage, "shipped"); assert.equal(c.becameSold, true);
    const d = recordPlan(mug, { cost: "3.50" });
    assert.deepEqual(d.changes.map(x => [x.label, x.from, x.to]), [["Cost", "$2.00", "$3.50"]]);
    const e = recordPlan(lamp, { status: "Returned", refund: "30" });
    assert.ok(e.changes.some(x => x.label === "Returned" && /refund \$30\.00/.test(x.to)));
  });
  it("expenses: cleaned, totaled, by year", () => {
    const now = new Date(2026, 10, 14).getTime();
    assert.equal(normalizeExpense({}, now), null);
    const e = normalizeExpense({ what: "Bubble wrap", amount: "$12.49", where: "Walmart", date: "11/10" }, now);
    assert.equal(e.date, "2026-11-10"); assert.equal(e.amount, 12.49);
    assert.ok(expenseRows(e).some(([k, v]) => k === "Amount" && v === "$12.49"));
    const f = normalizeExpense({ what: "Gas", amount: "20", date: "2025-12-01" }, now);
    assert.equal(expensesTotal([e, f]), 32.49);
    assert.deepEqual(expensesInYear([e, f], 2026).map(x => x.what), ["Bubble wrap"]);
  });
});

describe("Kris drafts she sends herself, errors, modes", () => {
  it("builds sms and change-request links but never sends", () => {
    assert.equal(smsHref("(317) 555-0100", "Hi! Still available."), "sms:3175550100?&body=Hi!%20Still%20available.");
    assert.equal(smsHref("Sam", "hi"), "");
    const m = changeMailto({ text: "Add a dark mode", version: "0.9.0" });
    assert.match(m, /^mailto:kens\.remi@mail\.grokbot\.com\?subject=/);
    assert.match(decodeURIComponent(m), /Add a dark mode/);
  });
  it("friendly errors and modes", () => {
    assert.match(friendlyError("code"), /Ask KJ/);
    assert.match(friendlyError("whatever"), /Try again/);
    assert.equal(pickMode(undefined, true), "listing");
    assert.equal(pickMode(undefined, false), "chat");
    assert.equal(pickMode("change", true), "change");
    assert.equal(pickMode("sheet", false), "chat");
  });
  it("asks the Kris server with the code, app id, memory and context (fake server)", async () => {
    const s = mem(), store = createKrisStore(s);
    const K = KrisCore.create({ store, url: () => "https://fake.example", code: async () => FAKE, prefix: "kris" });
    await K.addFacts(["Sells on Mercari"]);
    let sent = null, hit = "";
    const orig = globalThis.fetch;
    globalThis.fetch = async (u, opts) => {
      hit = u; sent = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ reply: "Here’s your listing, Jess.", change: "", actions: [{ type: "fill", target: "listing", data: { title: "Lamp" } }, { type: "bogus" }] }) };
    };
    try {
      const r = await K.ask({ text: "List this", mode: "listing", image: "data:image/jpeg;base64,AA", log: [{ who: "me", text: "hi" }, { who: "ai", text: "hello" }], context: "User: Jessika", app: { id: KRIS_APP_ID, version: "0.9.0" } });
      assert.equal(hit, "https://fake.example/chat");
      assert.equal(sent.code, FAKE); assert.equal(sent.app.id, "flip-side"); assert.equal(sent.mode, "listing");
      assert.deepEqual(sent.memory.facts, ["Sells on Mercari"]); assert.equal(sent.history.length, 2);
      assert.ok(sent.app.now);
      assert.equal(r.ok, true); assert.equal(r.actions.length, 1); assert.equal(r.actions[0].target, "listing");
      globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "code" }) });
      const bad = await K.ask({ text: "hi" });
      assert.equal(bad.ok, false); assert.equal(bad.error, "code");
    } finally { globalThis.fetch = orig; }
    assert.equal(KRIS_URL, "https://kris-chat.kens-remi.workers.dev");
  });
});

describe("Kris wiring and privacy", () => {
  const read = p => readFileSync(join(root, p), "utf8");
  it("caches the Kris files and syncs only through kv", () => {
    const sw = read("app/sw.js");
    for (const f of ["js/core/kris-core.js", "js/core/kris.js", "js/ui/kris.js"]) assert.ok(sw.includes("'" + f + "'"), f);
    const main = read("app/js/main.js");
    assert.match(main, /takeSetupLink\(location, history/);
    assert.match(main, /mountKris\(ctx\)/);
    assert.match(main, /getKv: \(\) => krisKvSnapshot\(\)/);
    const ui = read("app/js/ui/kris.js");
    const fetches = ui.match(/\bfetch\([^)]*\)/g) || [];
    assert.deepEqual(fetches, ["fetch(href)"], "the panel only talks to Kris through kris-core (its one fetch reads the app's own manifest)");
    assert.ok(!/navigator\.share\(\{[^}]*files/.test(ui));
  });
  it("kris-core is Shift Report's shared client, unchanged (when that copy is on this machine)", () => {
    const src = "/workspace/shift-report-publish/js/kris-core.js";
    if (!existsSync(src)) return;
    assert.equal(read("app/js/core/kris-core.js"), readFileSync(src, "utf8"));
  });
  it("the real Kris code is not anywhere in the repo", () => {
    const f = "/workspace/turnover-app/setups/flipside-access.json";
    let code = "";
    try { code = JSON.parse(readFileSync(f, "utf8")).code || ""; } catch (e) { }
    const codes = [code].filter(c => c && c.length >= 8);
    const hits = [];
    const walk = dir => {
      for (const n of readdirSync(dir)) {
        if (["node_modules", ".git", "out", "media", "vendor", "fixtures"].includes(n)) continue;
        const p = join(dir, n), st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(js|mjs|json|md|html|css|txt|sql|sh|py)$/.test(n)) { const t = readFileSync(p, "utf8"); for (const c of codes) if (t.includes(c)) hits.push(p); }
      }
    };
    walk(root);
    assert.deepEqual(hits, []);
  });
});
