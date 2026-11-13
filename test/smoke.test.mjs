// Headless phone-sized smoke test: walks the main flows and saves screenshots.
// Run: cd test && node smoke.test.mjs   (fails on any page error)
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { serve } from "../tools/serve.mjs";
import { emptyItem, setListed, markSold } from "../app/js/core/inventory.js";
import { scanResult } from "../app/js/core/scanner.js";

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
  if (!keepFx) await page.evaluate(() => {
    const t = document.querySelector("#toast");
    if (t) { t.classList.remove("show"); t.textContent = ""; }
  });
  await page.waitForTimeout(keepFx ? 0 : 350);
  const file = `${OUT}${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  const aliases = also == null ? [] : (Array.isArray(also) ? also : [also]);
  for (const destName of aliases) {
    const dest = join(SHOTS, destName);
    copyFileSync(file, dest);
    console.log("  shot", destName);
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
  await page.evaluate(() => { window.__flipFast = true; });
  const intro = () => page.textContent("#intro-root");

  await step("first-open welcome plays a placeholder video and offers a try-it demo", async () => {
    await page.waitForSelector("#intro-root");
    assert.ok(await page.isVisible("#intro-root"), "welcome opens on first open");
    assert.match(await intro(), /Jessika.?s/);
    assert.match(await intro(), /Flip Side/);
    assert.match(await intro(), /Video coming soon/);
    assert.ok(await page.isVisible('#intro-root [data-act="try-photo"]'), "Try it with your own photo");
    assert.ok(await page.isVisible('#intro-root [data-act="try-sample"]'), "Try a sample item");
    assert.ok(await page.isVisible('#intro-root [data-act="skip-video"]'), "Skip on the video");
    assert.ok(await page.isVisible("#intro-ph"), "placeholder is shown until a video is dropped in");
    await shot("welcome", { also: "v4-welcome.png" });

    // Photo path is offered; then we take the sample path through the whole demo.
    await page.click('#intro-root [data-act="try-photo"]');
    await page.waitForSelector('#intro-root [data-step="photo"]');
    assert.match(await intro(), /Take a photo|Take or choose/i);
    assert.match(await intro(), /For real/);
    await shot("photo", { also: "v4-demo-photo.png" });

    await page.click('#intro-root [data-act="try-sample"]');
    await page.waitForSelector('#intro-root [data-step="samples"]');
    assert.equal(await page.locator("#intro-root [data-sample]").count(), 3);
    assert.match(await intro(), /Speckled ceramic mug/);
    assert.match(await intro(), /Wooden picture frame/);
    assert.match(await intro(), /Navy canvas tote/);
    await shot("samples", { also: "v4-samples.png" });

    await page.click('#intro-root [data-sample="mug"]');
    await page.waitForSelector('#intro-root [data-step="draft"][data-ready="1"]');
    assert.match(await intro(), /Sample/);
    assert.match(await intro(), /For real/);
    assert.match(await intro(), /Speckled ceramic mug/);
    assert.match(await intro(), /real items are left alone/i);
    await shot("draft", { also: "v4-demo-draft.png" });

    await page.click('#intro-root [data-act="next"]');
    await page.waitForSelector('#intro-root [data-step="scan"]');
    assert.match(await intro(), /Buy or pass|Buy up to/i);
    assert.match(await intro(), /For real/);
    await shot("scan", { also: "v4-demo-scan.png" });

    await page.click('#intro-root [data-act="next"]');
    await page.waitForSelector('#intro-root [data-step="sites"]');
    assert.match(await intro(), /Where to list|Best price|Fastest/i);
    await shot("sites", { also: "v4-demo-sites.png" });

    await page.click('#intro-root [data-act="list-pretend"]');
    await page.waitForSelector('#intro-root [data-step="listing"][data-ready="1"]');
    assert.match(await intro(), /Pretend: nothing was posted/);
    await shot("listing", { also: "v4-demo-listing.png" });

    await page.click('#intro-root [data-act="next"]');
    await page.waitForSelector('#intro-root [data-step="sold"]');
    assert.match(await intro(), /Sold on Mercari/);
    assert.match(await intro(), /Pretend/);
    await shot("sold", { also: "v4-demo-sold.png" });

    await page.click('#intro-root [data-act="next"]');
    await page.waitForSelector('#intro-root [data-step="takedown"]');
    assert.match(await intro(), /Take them all down|nothing was taken down/i);
    if (await page.isVisible('#intro-root [data-act="takedown-all"]')) {
      await shot("takedown", { also: "v4-demo-takedown.png" });
      await page.click('#intro-root [data-act="takedown-all"]');
      await page.waitForTimeout(250);
      assert.match(await intro(), /Removed/);
    }
    await shot("takedown-done", { also: "v4-demo-takedown-done.png" });

    await page.click('#intro-root [data-act="next"]');
    await page.waitForSelector('#intro-root [data-step="pack"]');
    assert.match(await intro(), /Pack/i);
    assert.match(await intro(), /Bin/i);
    await shot("pack", { also: "v4-demo-pack.png" });

    await page.click('#intro-root [data-act="packed"]');
    await page.waitForSelector('#intro-root [data-step="ship"]');
    assert.match(await intro(), /Ship|Estimate/i);
    await shot("ship", { also: "v4-demo-ship.png" });

    await page.click('#intro-root [data-act="shipped"]');
    await page.waitForSelector('#intro-root [data-step="profit"]');
    assert.match(await intro(), /profit|What you kept/i);
    await shot("profit", { also: "v4-demo-profit.png" });

    assert.equal(await page.evaluate(() => window.__flip.items.length), 0, "demo must not touch real inventory");

    await page.click('#intro-root [data-act="goto-end"]');
    await page.waitForSelector('#intro-root [data-step="end"]');
    assert.match(await intro(), /Add it to your Home Screen|already on your Home Screen/);
    assert.match(await intro(), /Share|Add to Home Screen|already/);
    assert.ok(await page.isVisible('#intro-root [data-act="start-real"]'));
    await shot("end", { also: "v4-end.png" });

    await page.click('#intro-root [data-act="start-real"]');
    await page.waitForSelector("#intro-root", { state: "detached" });
    assert.equal(await page.evaluate(() => window.__flip.items.length), 0);
  });

  await step("walkthrough is skippable and Ask a question is always visible", async () => {
    assert.ok(await page.isVisible("#walkthrough"), "tips open after Start for real");
    assert.match(await page.textContent("#walkthrough"), /Welcome to Jessika's Flip Side/);
    assert.match(await page.textContent("#walkthrough"), /1 of 4/);
    await shot("walkthrough", { also: "v3-walkthrough.png" });
    assert.ok(await page.isVisible('#walkthrough [data-r="skip"]'));
    await page.click('#walkthrough [data-r="skip"]');
    await page.waitForSelector("#walkthrough", { state: "detached" });
    await page.evaluate(() => { window.__flipQuiet = true; });
    assert.ok(await page.isVisible("#ask-fab"), "Ask a question is on every screen");
    await page.click("#ask-fab");
    await page.waitForSelector("#ask-sheet");
    assert.match(await page.textContent("#ask-sheet"), /Settings/);
    assert.match(await page.textContent("#ask-sheet"), /AI key|paste the AI key|To ask a question/i);
    await shot("ask-nokey", { also: "v3-ask.png" });
    await page.click('#ask-sheet [data-r="0"]');
    await page.waitForSelector("#ask-sheet", { state: "detached" });
  });

  await step("home: empty, suggestion, honesty, totals at zero", async () => {
    await go("#/home");
    assert.equal(await page.title(), "Jessika's Flip Side");
    assert.equal(await page.getAttribute(".apphead-brand", "aria-label"), "Jessika's Flip Side");
    assert.match(await page.textContent(".apphead-brand"), /Jessika.?s/);
    assert.match(await page.textContent(".apphead-brand"), /Flip Side/);
    assert.ok(await page.isVisible("#suggest-open"), "Send a suggestion is on every screen");
    assert.match(await text(), /Take a photo/);
    assert.match(await text(), /No items yet/);
    assert.match(await text(), /Needs you to post/);
    assert.match(await text(), /Coming later/);
    assert.ok(await page.isVisible('[data-cta="scan"], a[href="#/scan"]'), "Buy or pass is on Home");
    assert.match(await text(), /Taxes|taxes/);
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
    assert.match(await text(), /Jessika's Flip Side v0\.4\.0/);
    assert.match(await text(), /stays on this phone only/);
    assert.match(await text(), /will not ask for a selling-site password/i);
    assert.match(await text(), /Sites you sell on/);
    for (const name of ["eBay", "Poshmark", "Mercari", "Facebook Marketplace", "Etsy", "Depop", "Vinted", "Grailed", "Shopify", "OfferUp", "Craigslist", "Whatnot", "Kidizen", "thredUP"]) {
      assert.match(await text(), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // default six are ticked
    assert.equal(await page.locator('#sitescard input[data-act="togglesite"]:checked').count(), 6);
    assert.match(await text(), /Price-drop ideas/);
    assert.match(await text(), /Mileage rate/);
    assert.match(await text(), /Official eBay sold prices/);
    assert.match(await text(), /Needs eBay developer account/);
    assert.match(await text(), /Coming later/);
    assert.match(await text(), /Take-down reminders/);
    assert.ok(await page.isVisible("#dropdays"));
    assert.ok(await page.isVisible("#pause-all"), "Pause all automation");
    assert.match(await text(), /no subscription/i);
    assert.match(await text(), /See what each site allows/);
    assert.match(await text(), /Import items from a spreadsheet|CSV/);
    assert.ok(await page.isVisible("#ask-fab"));
    assert.match(await text(), /Watch the intro/);
    assert.match(await text(), /Try the demo/);
    await page.locator("#sitescard").scrollIntoViewIfNeeded();
    await shot("settings-sites", { also: "04-settings.png" });
    await page.locator("#pausecard").scrollIntoViewIfNeeded();
    await shot("settings-pause", { also: "v3-settings.png" });
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
    assert.match(await text(), /don't let them sell twice|Take these down/);
    assert.match(await text(), /Take them all down automatically/);
    const badge = await page.textContent("#items-badge");
    assert.ok(badge && Number(badge) >= 1, "Items tab shows a take-down badge");
    await shot("home", { also: ["01-home.png", "v32-home.png"] });
    await page.locator("#delist-alerts").scrollIntoViewIfNeeded();
    await shot("home-takedown", { also: "v3-home.png" });
  });

  await step("item: delist checklist, checking off clears the highlight", async () => {
    await go("#/item/it_mug_demo");
    assert.match(await text(), /Take it down/);
    assert.match(await text(), /not automatic/);
    assert.ok(await page.isVisible("#takedown-all"));
    assert.match(await text(), /Take them all down automatically/);
    assert.ok(await page.isVisible('#delist [data-site="poshmark"]'));
    assert.ok(await page.isVisible('#delist [data-site="mercari"]'));
    assert.equal(await page.locator('#delist [data-site="ebay"]').count(), 0, "the sale site is not a delist target");
    assert.ok(await page.isVisible('#delist a[href*="poshmark"]'));
    assert.match(await text(), /Profit/);
    assert.match(await text(), /\$14\.40/);
    assert.ok(await page.isVisible("#countdown-clock"));
    assert.match(await text(), /don't let it sell twice|Take it down now|Still listed/);
    await shot("item-delist", { also: "03-item-delist.png" });
    await page.locator("#delist").scrollIntoViewIfNeeded();
    await shot("item-delist-loud", { also: "v2-delist.png" });
    await page.locator("#comps").scrollIntoViewIfNeeded();
    assert.match(await text(), /Sold price check/);
    assert.match(await text(), /eBay sold/);
    assert.ok(await page.isVisible('[data-act="logcomp"]'));
    await shot("sold-prices", { also: "v2-sold-prices.png" });
    await page.locator("#shipsuggest").scrollIntoViewIfNeeded();
    assert.match(await text(), /One-tap shipping/);
    assert.match(await text(), /USPS Ground Advantage/);
    assert.match(await text(), /Coming later/);
    await shot("shipping", { also: "v2-shipping.png" });
    if (await page.locator("#sold-pack, #qr, #sale").count()) {
      await page.locator("#sold-pack, #sale").first().scrollIntoViewIfNeeded();
      await shot("item-pack", { also: "v3-item.png" });
    }
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
    assert.match(await text(), /Take it down/);
    assert.ok(await page.isVisible('#delist [data-site="poshmark"]'));
  });

  await step("scan: buy-or-pass screen with a seeded check and a verdict", async () => {
    const draft = {
      title: "Lakeview Pottery blue ceramic mug",
      description: "A handmade blue mug.",
      category: "Kitchen",
      condition: "Like new",
      brand: "Lakeview Pottery",
      priceLow: 20,
      priceHigh: 32,
      priceReason: "A rough estimate from the photo, not from checking sold listings.",
      daysToSell: "medium",
      speedReason: "Mugs like this often sell in a few weeks.",
      notes: "",
      ship: { boxLabel: "Small sturdy box", lengthIn: 8, widthIn: 8, heightIn: 8, weightOz: 24, weightLb: 1.5, reason: "Ceramics need a box and padding.", source: "heuristic", approx: true }
    };
    const result = scanResult({
      asking: 6,
      resaleLow: 20,
      resaleHigh: 32,
      siteIds: ["ebay", "poshmark", "mercari", "facebook", "etsy", "depop"],
      weightOz: 24
    });
    await go("#/scan");
    assert.ok(await page.isVisible("#suggest-open"));
    assert.match(await text(), /Buy or pass/);
    assert.equal(await page.locator("#cam").count(), 1);
    await page.evaluate(({ mug, draft, result }) => {
      window.__flip.setScan({
        photos: [{ dataUrl: mug, addedAt: Date.now() }],
        asking: "6",
        notes: "",
        busy: false,
        error: "",
        draft,
        result
      });
      window.__flip.render();
    }, { mug, draft, result });
    await page.waitForTimeout(300);
    assert.match(await text(), /Lakeview Pottery/);
    assert.match(await text(), /Buy|Maybe|Pass/);
    assert.match(await text(), /Likely profit/);
    assert.match(await text(), /Approximate|Estimate/);
    const verd = page.locator("#verdict, #verdict-live");
    if (await verd.count()) await verd.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot("scan", { also: "v2-scan.png" });
  });

  await step("price-drop idea appears for a listing that has sat", async () => {
    const listedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    await page.evaluate(({ mug, listedAt }) => {
      return window.__flip.save({
        id: "it_stale_jacket",
        createdAt: listedAt,
        updatedAt: listedAt,
        title: "Navy wool jacket",
        description: "A navy wool jacket, good condition.",
        category: "Women's coats",
        condition: "Good",
        askingPrice: 40,
        priceLow: 24,
        priceHigh: 48,
        costPaid: 12,
        photos: [{ dataUrl: mug, addedAt: listedAt }],
        listedOn: { ebay: { at: listedAt }, poshmark: { at: listedAt } }
      });
    }, { mug, listedAt });
    await page.evaluate(() => window.__flip.reload());
    await page.waitForTimeout(300);
    await go("#/home");
    assert.match(await text(), /Price-drop ideas/);
    assert.match(await text(), /Navy wool jacket/);
    await go("#/item/it_stale_jacket");
    assert.match(await text(), /Price-drop ideas|Drop the price/);
    assert.ok(await page.isVisible('[data-act="approvedrop"]'));
    await page.locator("#drops").scrollIntoViewIfNeeded();
    await shot("drops", { also: "v2-drops.png" });
  });

  await step("taxes year view, mileage log, and CSV, labeled not tax advice", async () => {
    await go("#/taxes");
    assert.ok(await page.isVisible("#suggest-open"));
    assert.match(await text(), /Not tax advice/i);
    assert.match(await text(), /Income/);
    assert.match(await text(), /Mileage/);
    assert.match(await text(), /IRS/);
    await page.click('[data-act="addtrip"]');
    await page.waitForSelector("#prompt-title");
    await page.fill("#miles", "12");
    await page.fill("#purpose", "Post office");
    await page.locator('.sheet-bg .sheet [data-r="1"]').click({ force: true });
    await page.waitForTimeout(400);
    assert.match(await text(), /Post office/);
    assert.match(await text(), /12/);
    await shot("taxes", { also: "v2-taxes.png" });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.click('[data-act="csv"]')
    ]);
    const dest = OUT + "taxes.csv";
    await download.saveAs(dest);
    const csv = readFileSync(dest, "utf8");
    assert.match(csv, /Not tax advice/);
    assert.doesNotMatch(csv, /sk-/);
    assert.match(csv, /Post office/);
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
