// v0.10.0: listing engine (Depop format, cross-listing, SKUs, writing memory) and business manager / strategist.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as L from "../../app/js/core/listing.js";
import * as Bz from "../../app/js/core/business.js";
import { emptyItem, setListed, markSold } from "../../app/js/core/inventory.js";
import { applyKrisKv, krisKvSnapshot, SYNC_NAMES } from "../../app/js/core/kris.js";
import { bizStore } from "../../app/js/core/bizstore.js";

const facts = { category: "wtop", brand: "Free People", size: "M", color: "Ivory", material: "Cotton", condition: "excellent", measurements: "Pit to pit: 21 in\nLength: 24 in", flaws: "Tiny snag near left cuff", details: "Embroidered peasant blouse, balloon sleeves" };
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

describe("Depop tag lists", () => {
  it("are Depop's active lists (32 styles, 15 occasions) with no duplicates", () => {
    assert.equal(L.DEPOP_STYLES.length, 32); assert.equal(L.DEPOP_OCCASIONS.length, 15);
    assert.equal(new Set(L.DEPOP_STYLES.map(t => t.id)).size, 32);
    assert.ok(L.DEPOP_STYLES.some(t => t.id === "y2_k" && t.name === "Y2K"));
    assert.ok(!L.DEPOP_OCCASIONS.some(t => t.id === "wedding" || t.id === "prom"), "deactivated values are left out");
  });
  it("matches names, ids and common words, and drops anything not on the list", () => {
    assert.deepEqual(L.validTags(L.DEPOP_STYLES, ["Y2K", "cottagecore", "made up", "boho", "Boho"]), ["y2_k", "cottage", "boho"]);
    assert.deepEqual(L.validTags(L.DEPOP_OCCASIONS, ["brunch", "Date night", "Going out", "nope"]), ["daytime", "going-out-evening"]);
  });
});

describe("Depop listing", () => {
  const raw = { keywords: ["Free People peasant blouse", "boho embroidered top", "cottagecore blouse", "SKU"], body: "Title: Blouse\nSweet ivory blouse. #boho\nSKU WTOP001", hashtags: ["#freepeople", "boho", "Boho", "cottagecore", "a b c", "extra1", "extra2"], styles: ["Boho", "Fake"], occasions: ["Casual", "brunch", "Work", "Summer"] };
  const d = L.normalizeDepop(raw, { facts, sku: "WTOP014" });
  const lines = d.text.split("\n");
  it("has no title, starts with keywords, and has no SKU word", () => {
    assert.ok(!/^title/i.test(lines[0])); assert.match(lines[0], /^Free People peasant blouse \| /);
    assert.ok(!/\bsku\b/i.test(d.text)); assert.equal(d.keywords.length, 3);
  });
  it("has exactly 5 hashtags and the SKU alone on the last line", () => {
    assert.equal((d.text.match(/#\w+/g) || []).length, 5);
    assert.equal(lines[lines.length - 1], "WTOP014");
  });
  it("has exactly 3 real style and 3 real occasion tags", () => {
    assert.equal(d.styles.length, 3); assert.equal(d.occasions.length, 3);
    assert.ok(d.styles.every(id => L.DEPOP_STYLES.some(t => t.id === id)));
    assert.ok(d.occasions.every(id => L.DEPOP_OCCASIONS.some(t => t.id === id)));
    assert.ok(d.droppedTags.includes("Fake"));
  });
  it("passes its own checks, and the checks catch a broken edit; Fix repairs it", () => {
    const ok = L.checkDepop(d.text, { sku: "WTOP014", styles: d.styles, occasions: d.occasions });
    assert.ok(ok.ok, JSON.stringify(ok.checks));
    const broken = "Title: Cute top\nLovely.\n#a #b\nSKU: WTOP014\nmore text";
    const bad = L.checkDepop(broken, { sku: "WTOP014", styles: d.styles, occasions: d.occasions });
    assert.ok(!bad.ok);
    const fixed = L.fixDepopText(broken, { sku: "WTOP014", facts });
    const c = L.checkDepop(fixed, { sku: "WTOP014", styles: d.styles, occasions: d.occasions });
    assert.ok(c.ok, fixed + JSON.stringify(c.checks));
  });
  it("stays under 1,000 characters without cutting the tags or SKU", () => {
    const long = L.normalizeDepop({ ...raw, body: "Very long sentence about the blouse. ".repeat(60) }, { facts, sku: "WTOP014" });
    assert.ok(long.text.length <= 1000); assert.ok(long.text.endsWith("WTOP014"));
  });
  it("the request lists the real tags and the facts", () => {
    const q = L.depopRequest(facts, { style: "HER RULES:\n- never say gorgeous" });
    assert.match(q, /Whimsygoth/); assert.match(q, /Special Occasion/); assert.match(q, /Pit to pit: 21 in/); assert.match(q, /never say gorgeous/);
  });
});

describe("cross-listing", () => {
  const x = L.normalizeXlist({ mercari: { title: "Free People Ivory Embroidered Peasant Blouse Balloon Sleeve Boho Top Womens Medium Cotton", description: "Nice. #tag" }, vinted: { title: "Free People ivory blouse", description: "Ivory blouse." }, ebay: { title: "", description: "Desc" } }, { facts, sku: "WTOP014", price: 28 });
  it("keeps each title in its limit and puts the SKU last", () => {
    assert.ok(x.mercari.title.length <= 80); assert.ok(x.ebay.title.length <= 80 && x.ebay.title.length > 0); assert.ok(x.vinted.title.length <= 100);
    for (const s of ["mercari", "vinted", "ebay"]) assert.ok(x[s].description.endsWith("WTOP014"));
    assert.ok(!/#tag/.test(x.mercari.description)); assert.equal(x.ebay.specifics.Brand, "Free People"); assert.equal(x.mercari.price, "28");
    assert.deepEqual(L.checkXlist(x, facts), []);
  });
});

describe("SKUs", () => {
  it("counts up per category, skips used numbers, and follows her settings", () => {
    let cfg = L.defaultSkuConfig();
    let r = L.claimSku(cfg, "wtop", ["WTOP001"]); assert.equal(r.sku, "WTOP002");
    r = L.claimSku(r.cfg, "wtop"); assert.equal(r.sku, "WTOP003");
    assert.equal(L.claimSku(r.cfg, "wbtm").sku, "WBTM001");
    cfg = L.normalizeSkuConfig({ sep: "-", cats: { wtop: { prefix: "top", next: 214, digits: 4 } } });
    assert.equal(L.peekSku(cfg, "wtop").sku, "TOP-0214");
  });
  it("guesses a category from words", () => {
    assert.equal(L.guessCategory("women's blouse"), "wtop"); assert.equal(L.guessCategory("men's jeans"), "mbtm"); assert.equal(L.guessCategory("maxi dress"), "wdrs");
  });
});

describe("writing-style memory", () => {
  it("keeps her corrections and turns a twice-deleted word into a rule", () => {
    let st = L.emptyStyle();
    st = L.learnFromEdit(st, "This gorgeous blouse is lovely", "This blouse is lovely").style;
    const r = L.learnFromEdit(st, "A gorgeous top", "A soft top");
    assert.ok(r.learned.some(t => /gorgeous/.test(t)));
    assert.match(L.styleText(r.style, [{ t: "Listing style: always mention smoke-free home" }]), /smoke-free/);
  });
  it("does not learn facts like the brand", () => {
    const r = L.learnFromEdit(L.emptyStyle(), "Free People blouse soft", "blouse soft", { facts });
    assert.ok(!r.style.avoid.free && !r.style.avoid.people);
  });
  it("an AI 'none noted' never becomes a no-flaws claim", () => {
    assert.equal(L.normalizeFacts({ flaws: "None noted" }).flaws, "");
    assert.match(L.factsText({ flaws: "" }), /don't say it has no flaws/);
    assert.match(L.factsText({ noFlaws: true }), /none \(she checked\)/);
  });
  it("merges AI facts only into empty boxes", () => {
    const m = L.mergeFacts({ brand: "Zara" }, { brand: "H&M", size: "S" });
    assert.equal(m.facts.brand, "Zara"); assert.equal(m.facts.size, "S"); assert.deepEqual(m.filled, ["size"]);
  });
});

describe("business manager and strategist", () => {
  const now = Date.UTC(2026, 10, 15, 16);
  const base = Bz.withBiz(setListed(emptyItem({ id: "it_a", title: "Blouse", costPaid: 4, askingPrice: 30 }, now - 40 * 864e5), "depop", true, now - 30 * 864e5));
  it("plans strategies with per-site prices that keep about the same take-home", () => {
    const p = Bz.planStrategy(base, "max");
    assert.ok(p.target > 30 && p.minOffer < p.target);
    assert.ok(p.perSite.ebay > p.perSite.depop, "eBay fees are higher, so the price is higher");
    const fast = Bz.planStrategy(base, "fast"); assert.ok(fast.target < 30);
  });
  it("reviews an offer against the target and lowest OK offer", () => {
    const it = Bz.applyStrategy(base, { mode: "balanced", target: 30, minOffer: 24, perSite: {}, reviewAt: now }, now);
    assert.equal(Bz.reviewOffer(it, 26, "depop").verdict, "accept");
    const low = Bz.reviewOffer(it, 15, "depop"); assert.equal(low.verdict, "counter"); assert.ok(low.counter >= 24);
    const logged = Bz.logOffer(it, { amount: 15, site: "depop", decision: "declined" }, now);
    assert.equal(logged.offers.length, 1);
    assert.match(Bz.reviewOffer(logged, 14, "depop").reason, /turned down/);
  });
  it("keeps a history with source, offers, promos, relists and the outcome", () => {
    let it = { ...base, batchId: "b1" };
    it = Bz.logPromo(it, { kind: "Sale / % off", percent: 10, site: "depop" }, now - 5 * 864e5);
    it = Bz.logRelist(it, "depop", now - 2 * 864e5);
    it = Bz.recordPriceChange(it, 30, 26, { at: now - 864e5 });
    it = markSold(it, { siteId: "depop", salePrice: 26, at: now });
    const h = Bz.itemHistory(it, [{ id: "b1", name: "Bins", where: "Goodwill" }]).map(e => e.text).join("\n");
    for (const w of ["From batch", "Cost $4.00", "Listed on Depop", "10% off", "Relisted", "$30.00 → $26.00", "Sold for $26.00"]) assert.ok(h.includes(w), w + " in\n" + h);
    assert.match(Bz.outcome(it), /^Sold, profit/);
  });
  it("puts due reviews on the calendar and in Needs attention", () => {
    const cal = Bz.calendarDays([base], { from: now });
    assert.equal(cal.overdue.length, 1, "listed 30 days ago with a 21-day review");
    assert.ok(Bz.needsAttention([base], { now }).some(a => a.kind === "review"));
    assert.match(Bz.reviewsIcs([Bz.setReview(base, now, now + 3 * 864e5)], { now }), /BEGIN:VALARM/);
  });
  it("reports totals, platforms and batch performance", () => {
    const a = markSold({ ...base, batchId: "b1" }, { siteId: "depop", salePrice: 30, at: now });
    const b = markSold(Bz.withBiz(emptyItem({ id: "it_b", costPaid: 6, batchId: "b1" }, now)), { siteId: "ebay", salePrice: 40, at: now });
    const c = Bz.withBiz(emptyItem({ id: "it_c", costPaid: 2, batchId: "b1" }, now));
    const f = Bz.finance([a, b, c], { batches: [{ id: "b1", name: "Bins", cost: 12 }] });
    assert.equal(f.sold, 2); assert.equal(f.revenue, 70); assert.equal(f.byPlatform.length, 2);
    assert.equal(f.batches[0].sold, 2); assert.equal(f.batches[0].items, 3); assert.equal(f.inventory.count, 1);
  });
  it("notices when she changes her mind", () => {
    let d = [];
    d = Bz.noteDecision(d, { topic: "Pricing strategy", value: "Balanced" }).decisions;
    d = Bz.noteDecision(d, { topic: "Pricing strategy", value: "Balanced" }).decisions;
    const r = Bz.noteDecision(d, { topic: "Pricing strategy", value: "Faster sales" });
    assert.deepEqual([r.changed.from, r.changed.to], ["Balanced", "Faster sales"]);
    assert.match(Bz.decisionsText(r.decisions), /usually Balanced, but last time Faster sales/);
  });
  it("old items get safe defaults and keep every field", () => {
    const old = { id: "x", title: "Lamp", costPaid: 5, weird: 1 };
    const w = Bz.withBiz(old); assert.equal(w.weird, 1); assert.deepEqual(w.offers, []); assert.equal(w.strategy.mode, null);
  });
});

describe("settings ride along with sync", () => {
  it("listing prefs, SKU counters, style, batches and decisions are synced lists", async () => {
    for (const n of ["listPrefs", "listSku", "listStyle", "bizBatches", "bizDecisions"]) assert.ok(SYNC_NAMES.includes(n));
    const s = mem(), st = bizStore(s);
    await st.setSku(L.claimSku(L.defaultSkuConfig(), "wtop").cfg);
    await st.setBatches([{ name: "Bins", cost: 10 }]);
    const snap = krisKvSnapshot(s);
    assert.ok(snap["kris:listSku"] && snap["kris:bizBatches"]);
    const s2 = mem(); for (const [k, v] of Object.entries(snap)) applyKrisKv(k, v.payload, v.updatedAt, s2);
    const st2 = bizStore(s2);
    assert.equal(L.peekSku(await st2.sku(), "wtop").sku, "WTOP002");
    assert.equal((await st2.batches())[0].name, "Bins");
  });
});

describe("v0.10.1 app change requests go to the builder by her own email", async () => {
  const { changeMailto, deviceName, CHANGE_TO, CHANGE_SUBJECT } = await import("../../app/js/core/kris.js");
  it("addresses the builder with the right subject and every detail", () => {
    const href = changeMailto({ request: "Please change my app: make the Depop button bigger, I keep missing it", summary: "Make the Write my Depop listing button bigger", version: "0.10.1", device: "iPhone · iOS 18.0 · Safari", label: "FS-99" });
    assert.equal(CHANGE_TO, "kens.remi@mail.grokbot.com"); assert.equal(CHANGE_SUBJECT, "Flip Side change request");
    assert.ok(href.startsWith("mailto:kens.remi@mail.grokbot.com?subject=Flip%20Side%20change%20request&body="));
    const body = decodeURIComponent(href.split("&body=")[1]);
    assert.match(body, /in my words:\nmake the Depop button bigger, I keep missing it/);
    assert.ok(!/Please change my app/.test(body), "the quick-button prefix is dropped");
    assert.match(body, /one-line summary:\nMake the Write my Depop listing button bigger/);
    assert.match(body, /App version: 0\.10\.1/); assert.match(body, /Device: iPhone · iOS 18\.0 · Safari/); assert.match(body, /Kris code: FS-99/);
  });
  it("names the device from the browser", () => {
    assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "iPhone · iOS 18.0 · Safari");
    assert.equal(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"), "Android phone · Android 14 · Chrome");
  });
  it("old saved replies (just a summary) still make a valid email", () => {
    assert.match(decodeURIComponent(changeMailto({ text: "Add dark mode", version: "0.10.1" })), /summary:\nAdd dark mode[\s\S]*Kris code: unknown/);
  });
});
