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
const APP_VERSION = JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")).version;
const OUT = join(HERE, "out") + "/";
const SHOTS = "/workspace/flip-helper-shots/";
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync("/tmp/studio-model", { recursive: true });

const mugPath = join(HERE, "fixtures/mug.png");
const mug = "data:image/png;base64," + readFileSync(mugPath).toString("base64");
const tablePath = join(HERE, "fixtures/table.jpg");
const tableVideoPath = join(HERE, "fixtures/table.mp4");

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
// SMOKE_ONLY=kris runs only the steps whose name has that text (handy while working on one flow).
const step = async (name, fn) => {
  if (process.env.SMOKE_ONLY && !name.toLowerCase().includes(process.env.SMOKE_ONLY.toLowerCase())) return;
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

  await step("first-open welcome plays the intro video and offers a try-it demo", async () => {
    await page.waitForSelector("#intro-root");
    assert.ok(await page.isVisible("#intro-root"), "welcome opens on first open");
    assert.equal(await page.locator("#terms-root").count(), 0, "public link has no terms gate");
    assert.match(await intro(), /Jessika.?s/);
    assert.match(await intro(), /Flip Side/);
    // Wait for the lazy-loaded promo to replace the placeholder.
    await page.waitForFunction(() => {
      const v = document.querySelector("#intro-vid");
      return v && !v.hidden && v.readyState >= 2;
    }, { timeout: 15000 });
    assert.ok(await page.isVisible("#intro-vid"), "welcome plays the intro video");
    const src = await page.getAttribute("#intro-vid", "src");
    assert.match(src || "", /media\/intro\.mp4/);
    assert.equal(await page.isVisible("#intro-ph"), false, "placeholder is hidden once the video is ready");
    assert.ok(await page.isVisible('#intro-root [data-act="sound"]'), "tap-for-sound");
    assert.ok(await page.isVisible('#intro-root [data-act="try-photo"]'), "Try it with your own photo");
    assert.ok(await page.isVisible('#intro-root [data-act="try-sample"]'), "Try a sample item");
    assert.ok(await page.isVisible('#intro-root [data-act="skip-video"]'), "Skip on the video");
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
    assert.ok(await page.isVisible('[data-cta="secondlook"], a[href="#/secondlook"]'), "Second look is on Home");
    assert.match(await text(), /Second look: scan a table/);
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
    assert.ok((await text()).includes("Jessika's Flip Side v" + APP_VERSION), "settings shows the app version");
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


  const inviteFile = process.env.FLIP_SIDE_INVITE_FILE || "/home/box/.secrets/flip-side-invite-link.txt";
  const readInviteToken = () => {
    if (!existsSync(inviteFile)) return "";
    const raw = readFileSync(inviteFile, "utf8").trim();
    const m = raw.match(/[?&]invite=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  };

  const fresh = async (search, fn) => {
    const ctx2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    });
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(10000);
    p2.on("pageerror", e => { errors.push("pageerror: " + e.message); console.log("  page error:", e.message); });
    try {
      await p2.goto(`http://127.0.0.1:${srv.address().port}/index.html` + search);
      await p2.waitForSelector("html[data-ready='1']");
      await p2.evaluate(() => { window.__flipFast = true; });
      await fn(p2);
    } finally {
      await ctx2.close();
    }
  };

  const shotOn = async (p2, name, also) => {
    await p2.waitForTimeout(200);
    const file = `${OUT}${String(++n).padStart(2, "0")}-${name}.png`;
    await p2.screenshot({ path: file, fullPage: false });
    const aliases = also == null ? [] : (Array.isArray(also) ? also : [also]);
    for (const destName of aliases) {
      const dest = join(SHOTS, destName);
      copyFileSync(file, dest);
      console.log("  shot", destName);
    }
    return file;
  };

  await step("a bad or missing invite token does not show the terms gate", async () => {
    await fresh("?nosw&invite=not-a-real-invite-token-xxxxx", async p2 => {
      await p2.waitForSelector("#intro-root");
      assert.equal(await p2.locator("#terms-root").count(), 0, "bad token has no gate");
      assert.ok(await p2.isVisible("#intro-root"), "public welcome still opens");
      await p2.waitForFunction(() => {
        const v = document.querySelector("#intro-vid");
        return v && !v.hidden && v.readyState >= 1;
      });
      assert.ok(await p2.isVisible("#intro-vid"), "welcome video still plays");
      await shotOn(p2, "public-no-gate", "v5-public-welcome.png");
    });
  });

  await step("a valid invite shows the terms gate, then the welcome video after agree", async () => {
    const token = readInviteToken();
    assert.ok(token && token.length >= 24, "invite token file is missing; expected /home/box/.secrets/flip-side-invite-link.txt");
    await fresh("?nosw&invite=" + encodeURIComponent(token), async p2 => {
      await p2.waitForSelector("#terms-root");
      assert.ok(await p2.isVisible("#terms-root"), "valid token shows the terms gate");
      assert.equal(await p2.locator("#intro-root").count(), 0, "video waits until she agrees");
      const body = await p2.textContent("#terms-root");
      assert.match(body, /Before we start/);
      assert.match(body, /You and Teddy get half/);
      assert.match(body, /Ken carries all the costs/);
      assert.match(body, /you never owe anything/);
      assert.match(body, /Your ideas go into the app/);
      assert.match(body, /passes to your family/);
      assert.match(body, /full written agreement will come separately/);
      assert.match(body, /I've read this and I agree/);
      assert.doesNotMatch(body, /Hasier/i);
      const accept = p2.locator('#terms-root [data-act="accept"]');
      assert.equal(await accept.isDisabled(), true);
      await p2.check("#terms-agree");
      assert.equal(await accept.isDisabled(), true, "name is required");
      await p2.fill("#terms-name", "Jessika");
      assert.equal(await accept.isDisabled(), false);
      await shotOn(p2, "terms-gate", "v5-terms-gate.png");
      await accept.click();
      await p2.waitForSelector('#terms-root [data-terms-step="thanks"]');
      const thanks = await p2.textContent("#terms-root");
      assert.match(thanks, /You're in/);
      assert.ok(await p2.isVisible('#terms-root [data-act="mailto"]'));
      assert.match(await p2.textContent('#terms-root [data-act="mailto"]'), /Send my OK to Ken/);
      const href = await p2.getAttribute('#terms-root [data-act="mailto"]', "href");
      assert.match(href || "", /^mailto:kens\.remi@mail\.grokbot\.com\?/);
      assert.match(decodeURIComponent(href), /Flip Side: I agree to the terms/);
      assert.match(decodeURIComponent(href), /Name: Jessika/);
      assert.match(decodeURIComponent(href), /Terms version: 1/);
      assert.doesNotMatch(href, /kennethnootbaar6/i);
      const saved = await p2.evaluate(() => JSON.parse(localStorage.getItem("flip-helper.termsAccepted") || "null"));
      assert.equal(saved && saved.name, "Jessika");
      assert.equal(saved && saved.version, "1");
      assert.ok(saved && saved.acceptedAt);
      await shotOn(p2, "terms-thanks", "v5-terms-thanks.png");
      await p2.click('#terms-root [data-act="continue"]');
      await p2.waitForSelector("#terms-root", { state: "detached" });
      await p2.waitForSelector("#intro-root");
      assert.ok(await p2.isVisible("#intro-root"), "welcome video follows the agreement");
      await p2.waitForFunction(() => {
        const v = document.querySelector("#intro-vid");
        return v && !v.hidden && v.readyState >= 1;
      });
      const src = await p2.getAttribute("#intro-vid", "src");
      assert.match(src || "", /media\/intro\.mp4/);
      await shotOn(p2, "welcome-after-agree", "v5-welcome-after-agree.png");

      // Reload with the same token: no gate the second time, video still plays.
      await p2.reload();
      await p2.waitForSelector("html[data-ready='1']");
      await p2.waitForTimeout(400);
      assert.equal(await p2.locator("#terms-root").count(), 0, "accepted terms are not shown again");
      await p2.waitForSelector("#intro-root");
      assert.ok(await p2.isVisible("#intro-root"));

      // Finish intro so Settings is reachable, and reread the terms.
      await p2.evaluate(() => {
        localStorage.setItem("flip-helper.introDone", "1");
        localStorage.setItem("flip-helper.walkthroughDone", "1");
      });
      await p2.evaluate(() => { if (window.__flip && window.__flip.closeIntro) window.__flip.closeIntro({ completed: true }); });
      await p2.evaluate(() => { location.hash = "#/settings"; });
      await p2.waitForSelector("#introcard");
      assert.match(await p2.textContent("#view"), /Read the terms/);
      await p2.click('[data-act="readterms"]');
      await p2.waitForSelector('#terms-root [data-terms-step="read"]');
      assert.match(await p2.textContent("#terms-root"), /Before we start/);
      assert.match(await p2.textContent("#terms-root"), /You and Teddy get half/);
      await shotOn(p2, "settings-reread", "v5-settings-terms.png");
      await p2.click('#terms-root [data-act="close"]');
      await p2.waitForSelector("#terms-root", { state: "detached" });
    });
  });

  const mockLook = {
    items: [
      {
        name: "Speckled ceramic mug",
        why: "A handmade-looking mug that often resells. This is a guess from the photo.",
        priceLow: 12,
        priceHigh: 22,
        priceNote: "This is an estimate from the photo, not from checking sold listings.",
        confidence: "medium",
        frame: 1,
        box: { x: 0.04, y: 0.1, w: 0.28, h: 0.55 },
        where: "left side of the table, near the front",
        whatToCheck: ["maker's mark on the bottom", "chips or cracks", "completeness"]
      },
      {
        name: "Wooden picture frame",
        why: "A sturdy wooden frame, sometimes worth a closer look. This is a guess from the photo.",
        priceLow: 15,
        priceHigh: 30,
        priceNote: "This is an estimate from the photo, not from checking sold listings.",
        confidence: "medium",
        frame: 1,
        box: { x: 0.35, y: 0.08, w: 0.32, h: 0.58 },
        where: "middle of the table",
        whatToCheck: ["condition of the corners", "glass or backing complete"]
      },
      {
        name: "Navy canvas tote",
        why: "A sturdy tote that can resell if the fabric is clean. This is a guess from the photo.",
        priceLow: 10,
        priceHigh: 20,
        priceNote: "This is an estimate from the photo, not from checking sold listings.",
        confidence: "low",
        frame: 1,
        box: { x: 0.66, y: 0.1, w: 0.3, h: 0.55 },
        where: "right side of the table",
        whatToCheck: ["brand tag", "stains", "straps intact"]
      }
    ],
    skipped: [
      { name: "stack of papers", reason: "everyday paper, likely low value" },
      { name: "plastic bottle", reason: "common, low resale" }
    ],
    note: "A first pass from a wide photo. Check marks and condition yourself."
  };

  const fulfillLook = async (route, { delay = 0 } = {}) => {
    if (delay) await new Promise(r => setTimeout(r, delay));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(mockLook) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 }
      })
    });
  };

  const mockCloseup = {
    title: "Speckled ceramic mug",
    category: "Kitchen",
    condition: "Good",
    brand: "",
    priceLow: 18,
    priceHigh: 32,
    priceReason: "From the close-up: a well-made mug. This is an estimate, not from sold listings.",
    daysToSell: "medium",
    notes: "Looked at the bottom; no chips.",
    box: "small sturdy box",
    weightOz: 16
  };

  const fulfillCloseup = async (route, { delay = 0 } = {}) => {
    if (delay) await new Promise(r => setTimeout(r, delay));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(mockCloseup) } }],
        usage: { prompt_tokens: 8, completion_tokens: 8 }
      })
    });
  };

  await step("Second look: home button, no-key message, photo scan with a mocked AI, results and haggle", async () => {
    // Fresh page so we don't fight the welcome video or leftover state.
    const p3 = await context.newPage();
    p3.setDefaultTimeout(20000);
    p3.on("pageerror", e => { errors.push("pageerror sl: " + e.message); console.log("  sl page error:", e.message); });
    const slBase = `http://127.0.0.1:${srv.address().port}/index.html?nosw&nointro&nowalk&noterms`;
    await p3.goto(slBase);
    await p3.waitForSelector("html[data-ready='1']");
    await p3.evaluate(() => {
      window.__flipFast = true;
      window.__flipQuiet = true;
      localStorage.setItem("flip-helper.introDone", "1");
      localStorage.setItem("flip-helper.walkthroughDone", "1");
    });
    const shotSl = async (name, dest) => {
      await p3.waitForTimeout(200);
      await p3.evaluate(() => {
        const t = document.querySelector("#toast");
        if (t) { t.classList.remove("show"); t.textContent = ""; }
      });
      await p3.waitForTimeout(200);
      const file = `${OUT}${String(++n).padStart(2, "0")}-${name}.png`;
      await p3.screenshot({ path: file, fullPage: false });
      if (dest) {
        copyFileSync(file, join(SHOTS, dest));
        console.log("  shot", dest);
      }
      return file;
    };

    await p3.evaluate(h => { location.hash = h; }, "#/home");
    await p3.waitForTimeout(300);
    assert.ok(await p3.isVisible('[data-cta="secondlook"]'), "Second look button on Home");
    assert.ok(await p3.isVisible('[data-cta="add"]'), "Add is unchanged");
    assert.ok(await p3.isVisible('[data-cta="scan"]'), "Buy or pass is unchanged");
    await shotSl("v6-home", "v6-home.png");

    // No key: kind message, does not crash.
    await p3.evaluate(h => { location.hash = h; }, "#/secondlook");
    await p3.waitForTimeout(300);
    const startText = await p3.textContent("#view");
    assert.match(startText, /Second look|second set of eyes/i);
    assert.match(startText, /Paste the AI key|Settings first/i);
    assert.match(startText, /only to the AI service|not uploaded anywhere else/i);
    // File inputs are hidden; the big labels around them are the visible buttons.
    assert.equal(await p3.locator("#sl-record").count(), 1);
    assert.equal(await p3.locator("#sl-pick-video").count(), 1);
    assert.equal(await p3.locator("#sl-take-photo").count(), 1);
    assert.equal(await p3.locator("#sl-pick-photo").count(), 1);
    assert.match(startText, /Record a slow pan/);
    assert.match(startText, /Pick a video/);
    assert.match(startText, /Take a wide photo/);
    assert.match(startText, /Pick a photo/);

    // Existing Buy or pass is still its own screen, unchanged.
    await p3.evaluate(h => { location.hash = h; }, "#/scan");
    await p3.waitForTimeout(250);
    const scanText = await p3.textContent("#view");
    assert.match(scanText, /Buy or pass/);
    assert.match(scanText, /Identify and check/);
    assert.doesNotMatch(scanText, /Second look: scan a table/);

    // Photo path with a mocked AI. Delay the reply so we can screenshot "Looking…"
    await p3.evaluate(() => localStorage.setItem("flip-helper.openai.apiKey", "sk-this-is-a-fake-test-key-not-real"));
    await p3.route("https://api.openai.com/v1/chat/completions", route => fulfillLook(route, { delay: 1800 }));
    await p3.evaluate(h => { location.hash = h; }, "#/secondlook");
    await p3.waitForTimeout(300);
    await p3.locator("#sl-pick-photo").setInputFiles(tablePath);
    await p3.waitForSelector("#sl-running", { timeout: 8000 });
    assert.match(await p3.textContent("#view"), /Looking|keep shopping/i);
    await shotSl("v6-scanning", "v6-scanning.png");

    // She can leave and see a progress banner on Home.
    await p3.evaluate(h => { location.hash = h; }, "#/home");
    await p3.waitForTimeout(250);
    assert.ok(await p3.locator("#sl-banner, .sl-banner").count() > 0, "progress banner while browsing");
    assert.match(await p3.textContent("body"), /Looking|keep shopping|second look/i);

    await p3.waitForFunction(() => {
      const j = window.__flip && window.__flip.secondLookJob;
      return j && (j.status === "done" || j.status === "error");
    }, { timeout: 20000 });
    const job = await p3.evaluate(() => window.__flip.secondLookJob);
    assert.equal(job.status, "done", job.error || "job should finish");
    assert.ok(job.scanId);
    await p3.evaluate(h => { location.hash = h; }, "#/secondlook/" + job.scanId);
    await p3.waitForSelector("#sl-cards, #sl-results-head", { timeout: 8000 });
    const res = await p3.textContent("#view");
    assert.match(res, /Worth a closer look/);
    assert.match(res, /Speckled ceramic mug/);
    assert.match(res, /Wooden picture frame/);
    assert.match(res, /Navy canvas tote/);
    assert.match(res, /left side of the table/);
    assert.match(res, /Estimate/);
    assert.match(res, /What to check|maker/);
    assert.match(res, /likely low value|plastic bottle|stack of papers/i);
    assert.ok(await p3.isVisible('[data-act="closeup"]'));
    assert.ok(await p3.isVisible('[data-act="haggle"]'));
    assert.ok(await p3.isVisible('[data-act="listit"]'));
    assert.ok(await p3.isVisible('[data-act="dismiss"]'));
    assert.match(res, /0 of 3 checked/);
    assert.match(res, /First guess from the table: check it up close/);
    assert.match(res, /Go check this one/);
    assert.match(res, /Take a picture of just this item/);
    assert.match(res, /Find it/);
    assert.match(res, /List it/);
    assert.doesNotMatch(res, /Bought, on the way home/);
    assert.doesNotMatch(res, /I didn't buy it/);
    // Scans are saved locally.
    const saved = await p3.evaluate(() => window.__flip.getScans());
    assert.ok(saved.length >= 1);
    assert.match(saved[0].items[0].name, /mug|frame|tote/i);
    await shotSl("v61-results", "v61-results.png");

    // A single card: steps and Go check this one.
    const card = p3.locator(".sl-card").first();
    await card.scrollIntoViewIfNeeded();
    await shotSl("v61-card", "v61-card.png");

    // Haggle helper: numbers, lines, bundle tip, Coming later on the earbud.
    await p3.locator('[data-act="haggle"]').first().click();
    await p3.waitForSelector("#sl-haggle, #sl-haggle-sheet");
    const hag = await p3.textContent("#sl-haggle-sheet");
    assert.match(hag, /Help me haggle/);
    assert.match(hag, /Opening offer/);
    assert.match(hag, /Fair price/);
    assert.match(hag, /Walk away/);
    assert.match(hag, /Would you take|could go|no pressure/i);
    assert.match(hag, /Bundle tip/);
    assert.match(hag, /Coming later/);
    assert.match(hag, /earbud/i);
    assert.match(hag, /first guess from the table/i);
    await shotSl("v6-haggle", "v6-haggle.png");
    await p3.click('#sl-haggle-sheet [data-r="0"]');
    await p3.waitForSelector("#sl-haggle-sheet", { state: "detached" });

    // Go check this one: our close-up screen, not Buy or pass.
    await p3.locator('[data-act="closeup"]').first().click();
    await p3.waitForSelector("#sl-check", { timeout: 8000 });
    assert.match(await p3.evaluate(() => location.hash), /#\/secondlook\/.+\/check\//);
    const checkPage = await p3.textContent("#view");
    assert.match(checkPage, /Go check this one|Find it|Snap a close photo/);
    assert.match(checkPage, /Take a picture of just this item/);
    assert.match(checkPage, /Speckled ceramic mug|Wooden picture frame|Navy canvas tote/);
    assert.doesNotMatch(checkPage, /Buy or pass/);
    assert.doesNotMatch(checkPage, /Identify and check/);

    // Close-up photo runs existing single-item pricing, then returns Checked.
    await p3.unroute("https://api.openai.com/v1/chat/completions");
    await p3.route("https://api.openai.com/v1/chat/completions", route => fulfillCloseup(route));
    await p3.locator("#sl-check-cam").setInputFiles(tablePath);
    await p3.waitForFunction(() => {
      const b = document.querySelector('[data-act="runcloseup"]');
      return b && !b.disabled;
    }, { timeout: 8000 });
    await p3.locator('[data-act="runcloseup"]').click();
    await p3.waitForSelector(".sl-card-checked, [data-checked='1']", { timeout: 20000 });
    const after = await p3.textContent("#view");
    assert.match(after, /Checked/);
    assert.match(after, /1 of 3 checked/);
    assert.match(after, /\$18\.00 to \$32\.00/);
    assert.match(after, /List it/);

    // List it: existing listing flow, prefilled, no extra on-the-way status.
    await p3.locator(".sl-card-checked [data-act='listit'], [data-checked='1'] [data-act='listit']").first().click();
    await p3.waitForFunction(() => /#\/item\//.test(location.hash), { timeout: 8000 });
    const listing = await p3.textContent("#view");
    assert.match(listing, /Speckled ceramic mug/);
    assert.match(listing, /Post it|Needs you to post/);
    assert.doesNotMatch(listing, /Bought, on the way home/);
    assert.doesNotMatch(listing, /I didn't buy it/);
    assert.doesNotMatch(listing, /Confirm you bought/);
    await shotSl("v61-list-now", "v61-list-now.png");

    // Existing Buy or pass is still its own unchanged screen.
    await p3.evaluate(h => { location.hash = h; }, "#/scan");
    await p3.waitForTimeout(250);
    const scanAgain = await p3.textContent("#view");
    assert.match(scanAgain, /Buy or pass/);
    assert.match(scanAgain, /Identify and check/);

    await p3.unroute("https://api.openai.com/v1/chat/completions");
    await p3.close();
  });

  await step("Second look: video scan with a mocked AI, and the looking state runs in the background", async () => {
    const p4 = await context.newPage();
    p4.setDefaultTimeout(25000);
    p4.on("pageerror", e => { errors.push("pageerror slv: " + e.message); console.log("  slv page error:", e.message); });
    const slBase = `http://127.0.0.1:${srv.address().port}/index.html?nosw&nointro&nowalk&noterms`;
    await p4.goto(slBase);
    await p4.waitForSelector("html[data-ready='1']");
    await p4.evaluate(() => {
      window.__flipFast = true;
      window.__flipQuiet = true;
      localStorage.setItem("flip-helper.introDone", "1");
      localStorage.setItem("flip-helper.walkthroughDone", "1");
      localStorage.setItem("flip-helper.openai.apiKey", "sk-this-is-a-fake-test-key-not-real");
    });
    await p4.route("https://api.openai.com/v1/chat/completions", route => fulfillLook(route, { delay: 400 }));
    await p4.evaluate(h => { location.hash = h; }, "#/secondlook");
    await p4.waitForTimeout(300);
    await p4.locator("#sl-pick-video").setInputFiles(tableVideoPath);
    await p4.waitForSelector("#sl-running, #sl-cards, #sl-results-head", { timeout: 20000 });
    await p4.waitForFunction(() => {
      const j = window.__flip && window.__flip.secondLookJob;
      return j && (j.status === "done" || j.status === "error");
    }, { timeout: 25000 });
    const job = await p4.evaluate(() => window.__flip.secondLookJob);
    assert.equal(job.status, "done", job && job.error);
    assert.ok(job.scanId);
    if (!await p4.locator("#sl-cards, #sl-results-head").count()) {
      await p4.evaluate(h => { location.hash = h; }, "#/secondlook/" + job.scanId);
      await p4.waitForSelector("#sl-cards, #sl-results-head");
    }
    const res = await p4.textContent("#view");
    assert.match(res, /Worth a closer look/);
    assert.match(res, /Speckled ceramic mug/);
    assert.match(res, /0 of 3 checked|First guess from the table/);
    assert.match(res, /Go check this one/);
    assert.match(res, /List it/);
    const scans = await p4.evaluate(() => window.__flip.getScans());
    assert.ok(scans.some(s => s.kind === "video"));
    // Dismiss a card.
    const before = await p4.locator(".sl-card").count();
    if (before) {
      await p4.locator('[data-act="dismiss"]').first().click();
      await p4.waitForTimeout(300);
      const after = await p4.locator(".sl-card").count();
      assert.ok(after === before - 1 || await p4.locator("#sl-dismissed").count(), "dismiss hides the card");
    }
    await p4.unroute("https://api.openai.com/v1/chat/completions");
    await p4.close();
  });

  await step("v0.9.0 Ask Kris: setup link, chat, record fill confirm, memory, reminder, expense, photo listing, change, bad code", async () => {
    const pk = await context.newPage();
    pk.on("pageerror", e => { errors.push("pageerror kris: " + e.message); console.log("  kris page error:", e.message); });
    const calls = [];
    // Never the real server: block it, and answer a fake one.
    await pk.route("https://kris-chat.kens-remi.workers.dev/**", r => { calls.push("REAL"); return r.abort(); });
    await pk.route("https://fake-kris.test/**", async r => {
      const b = JSON.parse(r.request().postData() || "{}");
      calls.push(b);
      const t = String(b.text || "").toLowerCase();
      const json = o => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
      if (b.code === "FS-BADCODE0000") return r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "code" }) });
      if (t.includes("sold")) return json({ reply: "Congrats, Jess! Here’s the update for the lamp. Tap to save it.", actions: [
        { type: "fill", target: "record", summary: "Lamp sold on Mercari", data: { item: "brass lamp", status: "Sold", soldPrice: "42", platform: "Mercari" } },
        { type: "remember", facts: ["Sells mostly on Mercari"] },
        { type: "message", to: "Buyer", channel: "marketplace", text: "Thanks so much! It ships tomorrow." },
        { type: "reminder", at: "2020-01-01T09:00", text: "Ship the lamp" }] });
      if (t.includes("bubble wrap")) return json({ reply: "Got it.", actions: [{ type: "fill", target: "expense", data: { what: "Bubble wrap", amount: "12.49", where: "Walmart", date: "2026-11-10" } }] });
      if (t.includes("dark mode")) return json({ reply: "I can’t change the app, but KJ’s helper can. Tap below to send it.", change: "Add a dark mode switch", actions: [] });
      if (b.image) return json({ reply: "Cute mug! Here’s a listing.", actions: [{ type: "fill", target: "listing", summary: "Blue mug", data: { title: "Blue pottery mug", description: "Hand-thrown mug.", priceLow: "12", priceHigh: "18", condition: "Good" } }] });
      return json({ reply: "Hi!", actions: [] });
    });
    await pk.addInitScript(() => { window.__KRIS_URL = "https://fake-kris.test"; window.__flipQuiet = true; window.__flipFast = true; try { localStorage.setItem("flip-helper.introDone", "1"); localStorage.setItem("flip-helper.walkthroughDone", "1"); } catch (e) {} });
    const kBase = `http://127.0.0.1:${srv.address().port}/index.html?nosw&nointro&nowalk&noterms`;
    await pk.goto(kBase);
    await pk.waitForSelector("html[data-ready='1']");
    assert.equal(await pk.$("#kris-fab"), null, "no Ask Kris button without a code");
    assert.ok(await pk.$("#ask-fab"), "Ask a question is still there");

    await pk.goto(kBase + "#kris=FS-SMOKETEST1234");
    await pk.waitForSelector("#kris-fab");
    assert.ok(!(await pk.evaluate(() => location.href)).includes("FS-SMOKETEST1234"), "code removed from the address bar");
    assert.equal(await pk.evaluate(() => localStorage.getItem("flip-helper.kris.code")), "FS-SMOKETEST1234");

    await pk.evaluate(async () => {
      const { emptyItem, setListed } = await import("./js/core/inventory.js");
      await window.__flip.save(setListed(emptyItem({ id: "it_lampsmoke", title: "Vintage brass lamp", costPaid: 5, askingPrice: 30 }), "ebay"));
    });
    await pk.click("#kris-fab");
    await pk.waitForSelector("#kris-panel #kris-hello");
    await pk.screenshot({ path: join(SHOTS, "v9-kris-hello.png") });

    await pk.fill("#kris-text", "The lamp sold for 42 on Mercari");
    await pk.click("#kris-send");
    await pk.waitForSelector('.kris-card[data-target="record"] .kris-apply');
    const diff = await pk.textContent('.kris-card[data-target="record"]');
    assert.match(diff, /Stage: Listed → Sold/);
    assert.match(diff, /Sold price:/);
    assert.match(await pk.textContent("#kris-msgs"), /I’ll remember: Sells mostly on Mercari/);
    assert.match(await pk.textContent('.kris-card[data-type="message"]'), /paste it in the site’s chat/);
    let lamp = await pk.evaluate(() => window.__flip.items.find(i => i.id === "it_lampsmoke"));
    assert.equal(lamp.soldAt, null, "nothing saved before she taps");
    await pk.screenshot({ path: join(SHOTS, "v9-kris-record.png") });
    await pk.click('.kris-card[data-target="record"] .kris-apply');
    await pk.waitForSelector('.kris-card[data-target="record"] .kris-ok');
    lamp = await pk.evaluate(() => window.__flip.items.find(i => i.id === "it_lampsmoke"));
    assert.equal(lamp.stage, "sold"); assert.equal(lamp.salePrice, 42); assert.equal(lamp.soldOn, "mercari");
    const body1 = calls.find(c => c !== "REAL");
    assert.equal(body1.app.id, "flip-side"); assert.equal(body1.code, "FS-SMOKETEST1234");
    assert.match(body1.context, /Vintage brass lamp/);

    // reminder: set it, then the due check shows the in-app banner
    await pk.click('.kris-card[data-type="reminder"] .kris-apply');
    await pk.evaluate(async () => { const m = await import("./js/ui/kris.js"); await m.__kris.checkReminders(); });
    await pk.waitForSelector("#kris-rems .kris-rem");
    assert.match(await pk.textContent("#kris-rems"), /Ship the lamp/);
    await pk.click("#kris-rems .kris-rem .btn");

    // what Kris remembers: see it and delete it
    await pk.click("#kris-memory");
    await pk.waitForSelector("#kris-facts");
    assert.match(await pk.textContent("#kris-facts"), /Sells mostly on Mercari/);
    await pk.screenshot({ path: join(SHOTS, "v9-kris-remembers.png") });
    await pk.click("#kris-facts .kris-x");
    await pk.waitForSelector("#kris-facts-none");
    await pk.click("#kris-mem-close");

    // expense fill -> Taxes, Other expenses
    await pk.fill("#kris-text", "I spent 12.49 on bubble wrap at Walmart");
    await pk.click("#kris-send");
    await pk.waitForSelector('.kris-card[data-target="expense"] .kris-apply');
    await pk.click('.kris-card[data-target="expense"] .kris-apply');
    await pk.waitForSelector('.kris-card[data-target="expense"] .kris-ok');

    // change request -> an email she sends to KJ's helper
    await pk.fill("#kris-text", "Can you add a dark mode?");
    await pk.click("#kris-send");
    await pk.waitForSelector('[data-kris="change"]');
    assert.match(await pk.getAttribute('[data-kris="change"]', "href"), /^mailto:kens\.remi@mail\.grokbot\.com/);

    // photo -> listing draft with the photo
    await pk.setInputFiles("#kris-photo-file", mugPath);
    await pk.waitForSelector("#kris-thumb img");
    await pk.click("#kris-send");
    await pk.waitForSelector('.kris-card[data-target="listing"] .kris-apply');
    const photoCall = calls.filter(c => c !== "REAL").pop();
    assert.equal(photoCall.mode, "listing"); assert.match(photoCall.image, /^data:image\/jpeg;base64,/);
    await pk.screenshot({ path: join(SHOTS, "v9-kris-listing.png") });
    await pk.click('.kris-card[data-target="listing"] .kris-apply');
    await pk.waitForSelector('.kris-card[data-target="listing"] .kris-ok');
    const draft = await pk.evaluate(() => window.__flip.items.find(i => i.title === "Blue pottery mug"));
    assert.equal(draft.stage, "draft"); assert.equal(draft.photos.length, 1); assert.equal(draft.priceHigh, 18);

    await pk.click("#kris-close");
    await pk.evaluate(() => { location.hash = "#/taxes"; });
    await pk.waitForSelector("#kris-expenses:not([hidden])");
    assert.match(await pk.textContent("#kris-expenses"), /Bubble wrap[\s\S]*\$12\.49/);

    // settings card, and a bad code is cleared with a kind note
    await pk.evaluate(() => { location.hash = "#/settings"; });
    await pk.waitForSelector("#kriscard");
    assert.match(await pk.textContent("#kriscard"), /set up on this device/);
    await pk.evaluate(() => localStorage.setItem("flip-helper.kris.code", "FS-BADCODE0000"));
    await pk.click("#kris-fab");
    await pk.fill("#kris-text", "hello");
    await pk.click("#kris-send");
    await pk.waitForSelector(".kris-note");
    assert.match(await pk.textContent(".kris-note"), /Ask KJ for a new one/);
    assert.equal(await pk.evaluate(() => localStorage.getItem("flip-helper.kris.code")), null);
    assert.ok(!calls.includes("REAL"), "never called the real Kris server");
    await pk.close();
    console.log("  shot v9-kris-*.png");
  });


  await step("v0.9.1 Kris turns on by herself: invite-only button, cookie copy, iPhone manifest, notify asked once", async () => {
    const kBase = `http://127.0.0.1:${srv.address().port}/index.html?nosw&nointro&nowalk&noterms`;
    const krisHits = [];
    const fresh = async ({ cookie, init } = {}) => {
      const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
      if (cookie) await ctx2.addCookies([{ name: "flipkris", value: cookie, url: `http://127.0.0.1:${srv.address().port}/` }]);
      const pg = await ctx2.newPage();
      pg.on("pageerror", e => { errors.push("pageerror v091: " + e.message); console.log("  v091 page error:", e.message); });
      await pg.route("https://kris-chat.kens-remi.workers.dev/**", r => { krisHits.push("REAL"); return r.abort(); });
      await pg.route("https://fake-kris.test/**", r => { krisHits.push(JSON.parse(r.request().postData() || "{}")); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Okay!", actions: [{ type: "reminder", at: "2030-01-01T09:00", text: "Ship it" }] }) }); });
      await pg.addInitScript(extra => {
        window.__KRIS_URL = "https://fake-kris.test"; window.__flipQuiet = true;
        window.__permAsks = 0;
        window.Notification = class { constructor() {} static get permission() { return window.__perm || "default"; } static async requestPermission() { window.__permAsks++; window.__perm = "denied"; return "denied"; } };
        try { localStorage.setItem("flip-helper.introDone", "1"); localStorage.setItem("flip-helper.walkthroughDone", "1"); if (extra) for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v); } catch (e) {}
      }, init || null);
      return { ctx2, pg };
    };

    // 1. a public visitor: no button, nothing sent
    let { ctx2, pg } = await fresh();
    await pg.goto(kBase); await pg.waitForSelector("html[data-ready='1']");
    assert.equal(await pg.$("#kris-fab"), null);
    await ctx2.close();

    // 2. her invited phone before the code arrives: the button shows a friendly "almost ready" card, no chat box
    ({ ctx2, pg } = await fresh({ init: { "flip-helper.inviteSeen": "1" } }));
    await pg.goto(kBase); await pg.waitForSelector("#kris-fab");
    await pg.click("#kris-fab");
    await pg.waitForSelector("#kris-code-card");
    assert.match(await pg.textContent("#kris-code-card"), /almost ready/i);
    assert.equal(await pg.$("#kris-text"), null, "no chat box without a code, so nothing can reach the server");
    await ctx2.close();

    // 3. a Home Screen app that got Safari's cookie (iOS 17.2+): Kris is on at first launch, no typing
    ({ ctx2, pg } = await fresh({ cookie: "FS-COOKIECODE1234" }));
    await pg.goto(kBase); await pg.waitForSelector("#kris-fab");
    assert.equal(await pg.evaluate(() => localStorage.getItem("flip-helper.kris.code")), "FS-COOKIECODE1234");
    assert.equal(await pg.evaluate(() => window.__permAsks), 0, "no notification prompt on launch");
    // the iPhone Safari page now offers a manifest whose start_url carries the code (for Add to Home Screen)
    await pg.waitForFunction(() => /^blob:/.test(document.querySelector('link[rel="manifest"]').href));
    const man = await pg.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
    assert.match(man.start_url, /\/index\.html#kris=FS-COOKIECODE1234$/);
    assert.match(man.id, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(man.display, "standalone");
    // first reminder asks once; the second doesn't ask again
    await pg.click("#kris-fab");
    for (let i = 0; i < 2; i++) {
      await pg.fill("#kris-text", "remind me " + i);
      await pg.click("#kris-send");
      await pg.waitForFunction(n => document.querySelectorAll('.kris-card[data-type="reminder"] .kris-apply').length > 0 && document.querySelectorAll('.kris-card[data-type="reminder"]').length === n, i + 1);
      await pg.locator('.kris-card[data-type="reminder"] .kris-apply').last().click();
      await pg.waitForFunction(n => document.querySelectorAll('.kris-card[data-type="reminder"] .kris-ok').length === n, i + 1);
    }
    assert.equal(await pg.evaluate(() => window.__permAsks), 1, "asked exactly once, on the first reminder");
    await ctx2.close();
    assert.ok(!krisHits.includes("REAL"));
    assert.equal(krisHits.filter(x => x !== "REAL").length, 2);
  });

  await step("v0.7.0 studio photo: real U²-Netp model, sheet UI, and a 12MP timing run", async () => {
    const p7 = await context.newPage();
    p7.setDefaultTimeout(120000);
    p7.on("pageerror", e => { errors.push("pageerror v7: " + e.message); console.log("  v7 page error:", e.message); });
    const v7Base = `http://127.0.0.1:${srv.address().port}/index.html?nosw&nointro&nowalk&noterms`;
    await p7.goto(v7Base);
    await p7.waitForSelector("html[data-ready='1']");
    await p7.evaluate(() => {
      window.__flipFast = true;
      window.__flipQuiet = true;
      localStorage.setItem("flip-helper.introDone", "1");
      localStorage.setItem("flip-helper.walkthroughDone", "1");
    });

    // The original source photo lived in /tmp on the old box; fall back to the repo's mug fixture.
    const beforePath = existsSync("/tmp/studio-model/v7-before-src.png") ? "/tmp/studio-model/v7-before-src.png" : mugPath;
    const beforeB64 = readFileSync(beforePath).toString("base64");
    const beforeUrl = "data:image/png;base64," + beforeB64;

    const api = await p7.evaluate(async (beforeUrl) => {
      const { makeStudioPhoto } = await import("./js/core/segment.js");
      const mug = await makeStudioPhoto(beforeUrl, {
        background: "white", shadow: true, straighten: true, center: true, aspect: "square", edge: 2000
      });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = beforeUrl; });
      const c = document.createElement("canvas");
      c.width = 4032; c.height = 3024;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#6a4a32";
      ctx.fillRect(0, 0, 4032, 3024);
      for (let y = 0; y < 3024; y += 24) {
        ctx.fillStyle = y % 48 === 0 ? "#7a5a40" : "#5c3e28";
        ctx.fillRect(0, y, 4032, 20);
      }
      const side = 2000;
      ctx.drawImage(img, (4032 - side) / 2, (3024 - side) / 2, side, side);
      const bigUrl = c.toDataURL("image/jpeg", 0.85);
      const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : null;
      const t0 = performance.now();
      const big = await makeStudioPhoto(bigUrl, {
        background: "white", shadow: true, straighten: true, center: true, aspect: "square", edge: 2000
      });
      const wall = performance.now() - t0;
      const heapAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
      const toPng = src => new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = i.naturalWidth; cv.height = i.naturalHeight;
          cv.getContext("2d").drawImage(i, 0, 0);
          res(cv.toDataURL("image/png"));
        };
        i.onerror = rej;
        i.src = src;
      });
      return {
        mug: {
          ok: mug.ok, fallback: mug.fallback, kind: mug.kind, width: mug.width, height: mug.height,
          elapsedMs: mug.elapsedMs, error: mug.error || "", usedShadow: mug.usedShadow,
          usedStraighten: mug.usedStraighten, straightenDeg: mug.straightenDeg,
          dataUrl: mug.dataUrl, beforePng: await toPng(beforeUrl), afterPng: mug.dataUrl ? await toPng(mug.dataUrl) : null
        },
        big: {
          ok: big.ok, fallback: big.fallback, kind: big.kind, width: big.width, height: big.height,
          elapsedMs: big.elapsedMs, wall, error: big.error || "",
          heapMB: heapBefore != null ? { before: Math.round(heapBefore / 1e6), after: Math.round(heapAfter / 1e6) } : null
        }
      };
    }, beforeUrl);

    console.log("  studio mug:", JSON.stringify({ ...api.mug, dataUrl: undefined, beforePng: undefined, afterPng: undefined }));
    console.log("  studio 12MP:", JSON.stringify(api.big));
    assert.equal(api.mug.ok, true, "studio must succeed on the sample: " + api.mug.error);
    assert.equal(api.mug.fallback, false);
    assert.equal(api.mug.kind, "studio");
    assert.equal(api.mug.width, 2000);
    assert.equal(api.mug.height, 2000);
    assert.equal(api.mug.usedShadow, true);
    assert.ok(api.mug.elapsedMs > 0 && api.mug.elapsedMs < 60000, "per-photo time " + api.mug.elapsedMs);
    assert.equal(api.big.ok, true, "12MP studio must succeed: " + api.big.error);
    assert.equal(api.big.fallback, false);
    assert.equal(api.big.width, 2000);
    writeFileSync(join(SHOTS, "v7-before.png"), Buffer.from(api.mug.beforePng.split(",")[1], "base64"));
    writeFileSync(join(SHOTS, "v7-after.png"), Buffer.from(api.mug.afterPng.split(",")[1], "base64"));
    writeFileSync("/tmp/studio-model/timing.json", JSON.stringify({ mug: api.mug.elapsedMs, mugStraighten: api.mug.straightenDeg, big: api.big, at: Date.now() }, null, 2));
    console.log("  shot v7-before.png and v7-after.png");

    await p7.evaluate(({ photo, now }) => {
      return window.__flip.save({
        id: "it_studio_v7",
        createdAt: now,
        updatedAt: now,
        title: "Speckled ceramic mug",
        description: "A handmade speckled mug.",
        category: "Kitchen",
        condition: "Good",
        photos: [
          { dataUrl: photo, addedAt: now },
          { dataUrl: photo, addedAt: now }
        ]
      });
    }, { photo: beforeUrl, now: Date.now() });
    await p7.evaluate(() => window.__flip.go("#/item/it_studio_v7"));
    await p7.waitForSelector('[data-act="cleanup"]');
    const itemText = await p7.textContent("#view");
    assert.match(itemText, /Make it look pro/);
    assert.match(itemText, /Recommended/);
    assert.doesNotMatch(itemText, /Clean up photos \(basic\)/);
    await p7.click('[data-act="cleanup"]');
    await p7.waitForSelector(".studio-sheet");
    const sheetTxt = await p7.textContent(".studio-sheet");
    assert.match(sheetTxt, /Make it look pro/);
    assert.match(sheetTxt, /Recommended/);
    assert.match(sheetTxt, /Check that flaws are still visible/);
    assert.match(sheetTxt, /does not hide damage/i);
    assert.match(sheetTxt, /White studio/);
    assert.match(sheetTxt, /Soft gray/);
    assert.match(sheetTxt, /Square \(1:1\)/);
    assert.match(sheetTxt, /Tall \(4:5\)/);
    assert.match(sheetTxt, /Do all photos/);
    assert.match(sheetTxt, /Use a basic clean-up instead/);
    assert.match(sheetTxt, /Edges look off/);
    assert.match(sheetTxt, /Try again/);
    assert.match(sheetTxt, /Cover photo check|Paste the AI key/);
    assert.ok(await p7.locator("#studio-ba-range").count(), "before/after slider");
    await p7.waitForFunction(() => {
      const el = document.querySelector("#studio-progress");
      const img = document.querySelector("#studio-after");
      if (!el || !img || !img.naturalWidth) return false;
      return /Studio photo ready|Enhanced photo ready|basic clean-up/i.test(el.textContent);
    }, { timeout: 90000 });
    const progress = await p7.textContent("#studio-progress");
    assert.match(progress, /Studio photo ready|Enhanced photo ready/);
    assert.doesNotMatch(progress, /couldn't start/);
    await p7.evaluate(() => {
      const range = document.querySelector("#studio-ba-range");
      const ba = document.querySelector("#studio-ba");
      if (range && ba) {
        range.value = "50";
        ba.style.setProperty("--split", "50");
      }
    });
    await p7.waitForTimeout(300);
    const sheetShot = `${OUT}${String(++n).padStart(2, "0")}-v7-sheet.png`;
    await p7.locator(".studio-sheet").screenshot({ path: sheetShot });
    copyFileSync(sheetShot, join(SHOTS, "v7-sheet.png"));
    console.log("  shot v7-sheet.png");

    await p7.click('[data-r="basic"]');
    await p7.waitForFunction(() => {
      const el = document.querySelector("#studio-progress");
      return el && /Basic preview ready|basic/i.test(el.textContent);
    }, { timeout: 15000 });
    const basicPanel = await p7.textContent("#studio-basic-panel");
    assert.match(basicPanel, /not a studio cut-out/);
    await p7.click('[data-r="0"]');

    await p7.close();
  });

  if (errors.length) {
    throw new Error("Page errors:\\n" + errors.join("\\n"));
  }
  console.log("\nAll smoke steps passed. Screenshots in", OUT, "and", SHOTS);
} finally {
  await browser.close();
  srv.close();
}
