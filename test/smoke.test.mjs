// Headless phone-sized smoke test: walks the main flows and saves screenshots.
// Run: cd test && node smoke.test.mjs   (fails on any page error)
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { serve } from "../tools/serve.mjs";
import { emptyItem, setListed, markSold } from "../app/js/core/inventory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out") + "/";
const SHOTS = "/workspace/flip-helper-shots/";
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const mugPath = join(HERE, "fixtures/mug.png");
const mug = "data:image/png;base64," + readFileSync(mugPath).toString("base64");

const srv = await serve(0);
const base = `http://127.0.0.1:${srv.address().port}/index.html?nosw`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
});
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", e => { errors.push("pageerror: " + e.message); console.log("  page error:", e.message); });
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

let n = 0;
const shot = async (name, { keepFx = false, also } = {}) => {
  await page.waitForTimeout(200);
  if (!keepFx) await page.evaluate(() => { document.querySelector("#toast")?.classList.remove("show"); });
  await page.waitForTimeout(keepFx ? 0 : 280);
  const file = `${OUT}${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  if (also) {
    const dest = join(SHOTS, also);
    copyFileSync(file, dest);
    console.log("  shot", also);
  }
  return file;
};
const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(280); };
const text = () => page.textContent("#view");
const step = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); }
  catch (e) {
    console.log("FAIL", name);
    await page.screenshot({ path: `${OUT}FAIL-${name.replace(/\s+/g, "-")}.png` }).catch(() => {});
    throw e;
  }
};

const now = Date.now();

try {
  await page.goto(base);
  await page.waitForSelector("html[data-ready='1']");

  await step("home: empty, suggestion, honesty, totals at zero", async () => {
    assert.equal(await page.title(), "Flip Helper");
    assert.ok(await page.isVisible("#suggest-open"), "Send a suggestion is on every screen");
    assert.match(await text(), /Take a photo/);
    assert.match(await text(), /No items yet/);
    assert.match(await text(), /Needs you to post/);
    assert.match(await text(), /Coming later/);
    const stats = await page.$$eval(".stats .card.stat b", bs => bs.map(b => b.textContent.trim()));
    assert.equal(stats[0], "0");
    assert.equal(stats[1], "0");
    assert.match(stats[2], /\$0\.00/);
    assert.ok(await page.isVisible('[data-cta="add"], a[href="#/add"]'));
    await shot("home-empty");
  });

  await step("suggestion form is one tap from the header", async () => {
    await page.click("#suggest-open");
    await page.waitForSelector("#suggest-text");
    assert.match(await page.textContent(".sheet"), /Send a suggestion/);
    await page.click('.sheet [data-r="send"]');
    assert.equal(await page.locator("#suggest-text").count(), 1);
    assert.equal(await page.locator("#suggest-need").getAttribute("hidden"), null);
    await page.fill("#suggest-text", "Please add Grailed");
    // Cancel so we do not leave the page via mailto
    await page.click('.sheet [data-r="0"]');
    await page.waitForSelector("#suggest-text", { state: "detached" });
  });

  await step("settings: key, export, wipe, suggestion still visible", async () => {
    await go("#/settings");
    assert.ok(await page.isVisible("#suggest-open"));
    assert.ok(await page.isVisible("#apikey"));
    assert.match(await text(), /No key saved/);
    assert.match(await text(), /Flip Helper v0\.1\.0/);
    assert.match(await text(), /stays on this phone only/);
    assert.match(await text(), /will not ask for a selling-site password/i);
    assert.match(await text(), /Sites you sell on/);
    for (const name of ["eBay", "Poshmark", "Mercari", "Facebook Marketplace", "Etsy", "Depop", "Vinted", "Grailed", "Shopify", "OfferUp", "Craigslist", "Whatnot", "Kidizen", "thredUP"]) {
      assert.match(await text(), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // default six are ticked
    assert.equal(await page.locator('#sitescard input[data-act="togglesite"]:checked').count(), 6);
    await page.locator("#sitescard").scrollIntoViewIfNeeded();
    await shot("settings-sites", { also: "04-settings.png" });
  });

  await step("add: write a listing myself, save, then copy and mark listed", async () => {
    await go("#/add");
    assert.ok(await page.isVisible("#suggest-open"));
    assert.match(await text(), /Take a few shots/);
    assert.equal(await page.locator("#cam").count(), 1);
    assert.equal(await page.locator("#lib").count(), 1);
    assert.match(await text(), /Take/);
    assert.match(await text(), /Choose/);
    await shot("add", { also: "02-add.png" });
    await page.click('[data-act="manual"]');
    await page.waitForSelector("#review");
    await page.fill("#title", "Yellow knit scarf");
    await page.fill("#desc", "A warm yellow knit scarf. No stains. From a thrift shop.");
    await page.fill("#category", "Women's accessories");
    await page.fill("#condition", "Good");
    await page.fill("#cost", "4");
    await page.fill("#asking", "16");
    await page.click('[data-act="save"]');
    await page.waitForFunction(() => location.hash.includes("#/item/"));
    assert.match(await text(), /Yellow knit scarf/);
    assert.match(await text(), /Needs you to post/);
    // mark listed on two sites
    await page.check('[data-act="listed"][data-site="ebay"]');
    await page.waitForTimeout(200);
    await page.check('[data-act="listed"][data-site="poshmark"]');
    await page.waitForTimeout(300);
    assert.match(await page.textContent(".pill-listed, .topbar + .row, #view"), /Listed/i);
    // copy
    await page.click('[data-act="copy"][data-site="ebay"]');
    await page.waitForTimeout(400);
    const copied = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch (e) { return ""; }
    });
    if (copied) {
      assert.match(copied, /Yellow knit scarf/);
      assert.match(copied, /\$16\.00/);
    }
    // sell-page link exists
    const href = await page.getAttribute('a[href*="ebay.com"]', "href");
    assert.match(href, /ebay\.com/);
  });

  await step("seed a sold item that still needs taking down, then check home totals", async () => {
    await page.evaluate(({ mug, now }) => {
      // Built on the device using the same helpers the app uses, through a minimal shape
      // that storage.normalize will accept. We go through __flip.save.
      return window.__flip.save({
        id: "it_mug_demo",
        createdAt: now,
        updatedAt: now,
        title: "Lakeview Pottery blue ceramic mug",
        description: "A handmade blue ceramic mug from Lakeview Pottery. Like new, no chips. Smoke-free home.",
        category: "Kitchen",
        condition: "Like new",
        brand: "Lakeview Pottery",
        priceLow: 18,
        priceHigh: 28,
        priceReason: "A rough estimate from the photo only. Not checked against real sold listings.",
        askingPrice: 24,
        costPaid: 6,
        salePrice: 24,
        fees: 3.6,
        soldOn: "ebay",
        soldAt: now,
        photos: [{ dataUrl: mug, addedAt: now }],
        listedOn: { ebay: { at: now }, poshmark: { at: now }, mercari: { at: now } },
        delistedOn: {},
        siteTweaks: { ebay: { title: "Lakeview Pottery Handmade Blue Ceramic Coffee Mug" } },
        notes: ""
      });
    }, { mug, now });
    await page.evaluate(() => window.__flip.reload());
    await page.waitForTimeout(350);
    await go("#/home");
    const body = await text();
    assert.match(body, /Lakeview Pottery/);
    assert.match(body, /Take these down|Take it down/);
    // listed this month: scarf + mug = 2; sold: mug = 1; profit 24-6-3.60 = 14.40
    const stats = await page.$$eval(".stats .card.stat b", bs => bs.map(b => b.textContent.trim()));
    assert.equal(stats[0], "2", "two items listed this month");
    assert.equal(stats[1], "1", "one sold this month");
    assert.match(stats[2], /\$14\.40/);
    assert.ok(await page.isVisible("#delist-alerts"));
    await shot("home", { also: "01-home.png" });
  });

  await step("item: delist checklist, checking off clears the highlight", async () => {
    await go("#/item/it_mug_demo");
    assert.match(await text(), /Take it down on these sites/);
    assert.match(await text(), /not automatic/);
    assert.ok(await page.isVisible('#delist [data-site="poshmark"]'));
    assert.ok(await page.isVisible('#delist [data-site="mercari"]'));
    assert.equal(await page.locator('#delist [data-site="ebay"]').count(), 0, "the sale site is not a delist target");
    assert.ok(await page.isVisible('#delist a[href*="poshmark"]'));
    assert.match(await text(), /Profit/);
    assert.match(await text(), /\$14\.40/);
    await shot("item-delist", { also: "03-item-delist.png" });
    await page.check('#delist [data-act="delist"][data-site="poshmark"]');
    await page.waitForTimeout(250);
    await page.check('#delist [data-act="delist"][data-site="mercari"]');
    await page.waitForTimeout(400);
    const after = await text();
    assert.match(after, /All (other listings are )?checked off/i);
    await go("#/home");
    assert.equal(await page.locator("#delist-alerts").count(), 0, "home highlight clears when delist is done");
  });

  await step("items list filters and mark the scarf sold from the sheet", async () => {
    await go("#/items");
    assert.ok(await page.isVisible("#suggest-open"));
    const titles = await page.$$eval(".itemlist b", bs => bs.map(b => b.textContent));
    assert.ok(titles.some(t => /Lakeview/.test(t)));
    assert.ok(titles.some(t => /scarf/.test(t)));
    await page.click('[data-filter="listed"]');
    await page.waitForTimeout(250);
    assert.match(await text(), /Yellow knit scarf/);
    // open scarf, mark sold
    const scarfId = await page.evaluate(() => window.__flip.items.find(i => /scarf/i.test(i.title)).id);
    await go("#/item/" + scarfId);
    // default post list is her enabled sites, not all 14 at the top
    assert.ok(await page.isVisible('[data-act="listed"][data-site="ebay"]'));
    assert.ok(await page.isVisible('[data-act="listed"][data-site="poshmark"]'));
    assert.ok(await page.isVisible("details.more-sites"), "extra sites are folded away");
    await page.click('[data-act="sold"]');
    await page.waitForSelector("#prompt-title");
    assert.equal(await page.locator(".sheet-bg").count(), 1, "only one sheet is open");
    await page.selectOption("#site", "ebay");
    await page.fill("#sale", "16");
    await page.fill("#fees", "2");
    await page.locator('.sheet-bg .sheet [data-r="1"]').click({ force: true });
    await page.waitForTimeout(400);
    assert.match(await text(), /Sold/);
    // listed on ebay and poshmark, sold on ebay -> poshmark is a delist target
    assert.match(await text(), /Take it down on these sites/);
    assert.ok(await page.isVisible('#delist [data-site="poshmark"]'));
  });

  await step("export backup has items and no key, then wipe restores empty home", async () => {
    await go("#/settings");
    // Put a fake key on the phone and make sure it is not in the backup
    await page.evaluate(() => localStorage.setItem("flip-helper.openai.apiKey", "sk-this-is-a-fake-test-key-not-real"));
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.click('[data-act="export"]')
    ]);
    const dest = OUT + "backup.json";
    await download.saveAs(dest);
    const raw = readFileSync(dest, "utf8");
    assert.doesNotMatch(raw, /sk-this-is-a-fake/);
    assert.doesNotMatch(raw, /apiKey/);
    const data = JSON.parse(raw);
    assert.equal(data.app, "flip-helper");
    assert.ok(Array.isArray(data.enabledSites));
    assert.ok(data.items.length >= 2);
    assert.ok(data.items.some(i => /Lakeview/.test(i.title)));

    await page.click('[data-act="wipe"]');
    await page.waitForSelector("#confirm-title");
    await page.click('.sheet [data-r="1"]');
    await page.waitForTimeout(400);
    await go("#/home");
    assert.match(await text(), /No items yet/);
    const stats = await page.$$eval(".stats .card.stat b", bs => bs.map(b => b.textContent.trim()));
    assert.equal(stats[0], "0");
    // key should be gone too
    const hasKey = await page.evaluate(() => !!localStorage.getItem("flip-helper.openai.apiKey"));
    assert.equal(hasKey, false);
    await go("#/settings");
    assert.match(await text(), /No key saved/);
  });

  if (errors.length) {
    throw new Error("Page errors:\n" + errors.join("\n"));
  }
  console.log("\nAll smoke steps passed. Screenshots in", OUT, "and", SHOTS);
} finally {
  await browser.close();
  srv.close();
}
