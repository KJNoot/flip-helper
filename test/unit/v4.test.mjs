import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyItem } from "../../app/js/core/inventory.js";
import { normalizeDraft, applyDraft } from "../../app/js/core/draft.js";
import {
  INTRO_KEY, INTRO_VIDEO, INTRO_POSTER, VIDEO_COMING_SOON, INTRO_MAX_BYTES, INTRO_VIDEO_READY,
  introDone, setIntroDone, shouldShowIntro, isStandalone, shouldShowAddToHomeScreen,
  introVideoState
} from "../../app/js/core/intro.js";
import {
  createDemoStore, emptySession, applySample, setDemoPhotos, applyCannedDraft,
  applyAiDraft, draftForDemo, setDemoSites, startListing, revealNextListing,
  revealAllListings, pretendSold, startDemoTakedown, takeDownAllPretend,
  markDemoPacked, markDemoShipped, gotoStep, demoScan, demoProfit, demoShipSuggest,
  listingRows, takedownRows, soldHeadline, soldSiteId, isDemoItemId, demoDelay,
  demoSourceLabel, PRETEND_POSTED, PRETEND_SOLD, PRETEND_TAKEDOWN, PRETEND_BANNER,
  DEMO_STEPS, DEMO_EXPLAIN, newDemoId
} from "../../app/js/core/demo.js";
import { SAMPLES, sampleById, sampleDraft, sampleHasBrand, GENERIC_OWN_PHOTO, SAMPLE_OWN_PHOTO_NOTE, SAMPLE_LABEL } from "../../app/js/core/samples.js";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "../../app");

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

describe("welcome / intro flags", () => {
  it("remembers when the welcome has been finished, and honors quiet and ?nointro", () => {
    const s = mem();
    assert.equal(introDone(s), false);
    assert.equal(shouldShowIntro(s), true);
    assert.equal(shouldShowIntro(s, { quiet: true }), false);
    assert.equal(shouldShowIntro(s, { search: "?nosw&nointro" }), false);
    assert.equal(shouldShowIntro(s, { search: "#/home" }), true);
    setIntroDone(true, s);
    assert.equal(s.getItem(INTRO_KEY), "1");
    assert.equal(shouldShowIntro(s), false);
    setIntroDone(false, s);
    assert.equal(shouldShowIntro(s), true);
  });
  it("does not auto-show for someone who already finished the old welcome tips", () => {
    const s = mem();
    assert.equal(shouldShowIntro(s, { respectWalkthrough: true, walkthroughDone: true }), false);
    assert.equal(shouldShowIntro(s, { respectWalkthrough: true, walkthroughDone: false }), true);
  });
  it("detects standalone (already on the Home Screen) and hides the add steps", () => {
    assert.equal(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
    assert.equal(shouldShowAddToHomeScreen({ navigator: {}, matchMedia: () => ({ matches: false }) }), true);
    assert.equal(isStandalone({ navigator: { standalone: true }, matchMedia: () => ({ matches: false }) }), true);
    assert.equal(shouldShowAddToHomeScreen({ navigator: { standalone: true } }), false);
    assert.equal(isStandalone({
      navigator: {},
      matchMedia: q => ({ matches: String(q).includes("standalone") })
    }), true);
  });
  it("ships the reviewed intro video and falls back to a poster if it fails", () => {
    assert.equal(INTRO_VIDEO, "media/intro.mp4");
    assert.equal(INTRO_POSTER, "media/intro-poster.jpg");
    assert.equal(INTRO_VIDEO_READY, true, "v0.4.1 ships the reviewed welcome video");
    assert.equal(introVideoState({ ready: false }).mode, "placeholder");
    assert.equal(introVideoState({ exists: false }).mode, "placeholder");
    assert.equal(introVideoState({ exists: false }).label, VIDEO_COMING_SOON);
    assert.equal(introVideoState({ error: new Error("404") }).mode, "placeholder");
    assert.equal(introVideoState({ exists: true, readyState: 0 }).mode, "placeholder");
    assert.equal(introVideoState({ exists: true, readyState: 2 }).mode, "video");
    assert.ok(INTRO_MAX_BYTES >= 15 * 1024 * 1024);
    const poster = join(APP, INTRO_POSTER);
    assert.equal(existsSync(poster), true, "poster should be in the app");
    assert.ok(statSync(poster).size < 500_000);
    const video = join(APP, INTRO_VIDEO);
    assert.equal(existsSync(video), true, "intro.mp4 should be in the app");
    assert.ok(statSync(video).size <= INTRO_MAX_BYTES, "intro.mp4 must stay under ~15 MB");
  });
});

describe("built-in sample items", () => {
  it("has three original samples with canned drafts and no real brands", () => {
    assert.equal(SAMPLES.length, 3);
    for (const s of SAMPLES) {
      assert.ok(s.id && s.name && s.photo && s.draft);
      assert.equal(existsSync(join(APP, s.photo)), true, s.photo);
      const blob = JSON.stringify(s).toLowerCase();
      assert.equal(sampleHasBrand(blob), false, "no real brands in " + s.id);
      assert.equal(s.draft.brand, "");
      const d = sampleDraft(s);
      assert.ok(d.title);
      assert.ok(d.siteAdvice.bestPrice.sites.length);
      assert.ok(d.siteAdvice.fastestSale.sites.length);
      assert.match(d.priceReason, /sample|not from|estimate/i);
    }
    assert.ok(sampleById("mug"));
    assert.ok(sampleById("frame"));
    assert.ok(sampleById("tote"));
    assert.equal(sampleById("nope"), null);
  });
  it("has a generic own-photo sample draft that admits it is not a read of the photo", () => {
    assert.match(SAMPLE_OWN_PHOTO_NOTE, /not a read of your photo/i);
    assert.match(GENERIC_OWN_PHOTO.description, /not a read of your photo/i);
    assert.equal(GENERIC_OWN_PHOTO.brand, "");
  });
});

describe("sandboxed demo store and session", () => {
  it("the demo store is in-memory and does not write to a real store", async () => {
    const realItems = [];
    const real = {
      name: "real",
      async all() { return realItems.slice(); },
      async put(i) { realItems.push(i); return i; },
      async wipe() { realItems.length = 0; }
    };
    const demo = createDemoStore();
    assert.equal(demo.name, "demo-memory");
    assert.equal(demo.isDemo, true);
    await demo.put(emptyItem({ id: "demo_x", title: "Mug" }));
    assert.equal((await real.all()).length, 0);
    assert.equal((await demo.all()).length, 1);
    assert.equal((await demo.all())[0].title, "Mug");
    await demo.wipe();
    assert.equal((await demo.all()).length, 0);
    assert.equal((await real.all()).length, 0);
  });
  it("demo item ids are clearly marked, and every step has a plain 'for real' explanation", () => {
    assert.equal(isDemoItemId(newDemoId()), true);
    assert.equal(isDemoItemId("it_abc"), false);
    for (const step of DEMO_STEPS) {
      assert.ok(DEMO_EXPLAIN[step] && DEMO_EXPLAIN[step].length > 10, step);
    }
    assert.match(PRETEND_POSTED, /Pretend: nothing was posted/);
    assert.match(PRETEND_SOLD, /Pretend|nothing really sold/i);
    assert.match(PRETEND_TAKEDOWN, /Pretend: nothing was taken down/);
    assert.match(PRETEND_BANNER, /real items are left alone/i);
  });
  it("walks a sample mug from photo to profit without touching a real store, sold on Mercari", async () => {
    const real = createDemoStore(); // a stand-in "real" we just won't write to
    const before = await real.all();
    let s = applySample(emptySession(), "mug");
    assert.equal(s.step, "draft");
    assert.equal(s.draftSource, "sample");
    assert.equal(demoSourceLabel(s), SAMPLE_LABEL);
    assert.ok(isDemoItemId(s.item.id));
    assert.match(s.item.title, /mug/i);
    assert.ok(s.item.siteAdvice.bestPrice.sites.length);
    assert.equal(s.item.costPaid, 4);

    const scan = demoScan(s);
    assert.ok(scan.buyUpTo != null || scan.buyUpToLabel);
    assert.ok(scan.verdict);

    s = setDemoSites(s, ["ebay", "poshmark", "mercari", "facebook"]);
    s = startListing(s);
    s = revealAllListings(s);
    assert.equal(s.listingDone, true);
    assert.equal(s.listingShown, 4);
    const rows = listingRows(s);
    assert.equal(rows.filter(r => r.visible && r.status === "live").length, 4);
    assert.ok(rows.every(r => r.pretend));

    s = pretendSold(s);
    assert.equal(s.soldOn, "mercari");
    assert.match(soldHeadline(s), /Sold on Mercari/);
    assert.equal(s.item.salePrice, 18);
    assert.ok(s.takedownIds.includes("ebay"));
    assert.ok(!s.takedownIds.includes("mercari"));

    s = startDemoTakedown(s);
    s = takeDownAllPretend(s);
    assert.equal(s.takedownDone, true);
    const taken = takedownRows(s);
    assert.ok(taken.every(r => r.done));
    assert.equal(taken.every(r => r.pretend), true);

    s = markDemoPacked(s);
    assert.equal(s.packed, true);
    const ship = demoShipSuggest(s);
    assert.ok(ship.suggest || ship.boxLabel);
    s = markDemoShipped(s);
    assert.equal(s.shipped, true);

    s = gotoStep(s, "profit");
    const profit = demoProfit(s);
    assert.ok(profit);
    assert.equal(profit.sale, 18);
    assert.equal(profit.cost, 4);
    assert.ok(profit.estimatedProfit != null);
    assert.ok(profit.estimatedProfit > 0);
    assert.match(profit.note, /not tax advice/i);

    assert.deepEqual(await real.all(), before);
    // The demo store itself does hold the pretend item — that's fine, it is not the real one.
    assert.equal((await s.store.all()).length, 1);
    assert.ok(isDemoItemId((await s.store.all())[0].id));
  });
  it("own photo without a key gets a canned draft labeled Sample", async () => {
    let s = setDemoPhotos(emptySession(), [{ dataUrl: "data:image/png;base64,aaa", addedAt: 1 }]);
    s = await draftForDemo(s, { key: "", request: async () => { throw new Error("should not be called"); } });
    assert.equal(s.draftSource, "sample");
    assert.match(s.draftNote, /not a read of your photo/i);
    assert.match(s.item.title, /Item from your photo|sample/i);
  });
  it("uses a real AI draft when a key is passed, and falls back to Sample on failure", async () => {
    let s = setDemoPhotos(emptySession(), [{ dataUrl: "data:image/png;base64,aaa", addedAt: 1 }]);
    s = await draftForDemo(s, {
      key: "sk-test-not-real",
      request: async ({ key }) => {
        assert.equal(key, "sk-test-not-real");
        return { draft: normalizeDraft({ title: "Blue scarf", priceLow: 10, priceHigh: 18, bestPrice: { sites: ["ebay"], reason: "Estimate." }, fastestSale: { sites: ["facebook"], reason: "Estimate." } }) };
      }
    });
    assert.equal(s.draftSource, "ai");
    assert.equal(s.item.title, "Blue scarf");
    assert.deepEqual(s.item.siteAdvice.bestPrice.sites, ["ebay"]);

    s = setDemoPhotos(emptySession(), [{ dataUrl: "data:image/png;base64,aaa", addedAt: 1 }]);
    s = await draftForDemo(s, {
      key: "sk-test-not-real",
      request: async () => { throw new Error("network down"); }
    });
    assert.equal(s.draftSource, "sample");
    assert.match(s.draftNote, /couldn't be reached|sample/i);
  });
  it("Sold on Mercari if Mercari is a chosen site, otherwise the first chosen site", () => {
    let s = setDemoSites(emptySession(), ["ebay", "poshmark"]);
    assert.equal(soldSiteId(s), "ebay");
    s = setDemoSites(s, ["ebay", "mercari"]);
    assert.equal(soldSiteId(s), "mercari");
  });
  it("demoDelay is zero in tests and for reduced motion", () => {
    assert.equal(demoDelay(550, { __flipFast: true }), 0);
    assert.equal(demoDelay(550, { __flipQuiet: true }), 0);
    assert.equal(demoDelay(550, { matchMedia: () => ({ matches: true }) }), 0);
    assert.equal(demoDelay(550, { matchMedia: () => ({ matches: false }) }), 550);
  });
});

describe("double normalizeDraft (Apply on a draft) keeps site advice", () => {
  it("applyDraft after a pre-normalized draft does not empty siteAdvice", () => {
    const once = normalizeDraft({
      title: "Navy tote",
      bestPrice: { sites: ["ebay", "poshmark"], reason: "Often more here." },
      fastest_sale: { sites: ["mercari"], reason: "Can move faster." }
    });
    const twice = normalizeDraft(once);
    assert.deepEqual(twice.siteAdvice, once.siteAdvice);
    const item = applyDraft(emptyItem({ id: "it_t" }), once);
    assert.deepEqual(item.siteAdvice.bestPrice.sites, ["ebay", "poshmark"]);
    assert.deepEqual(item.siteAdvice.fastestSale.sites, ["mercari"]);
  });
});

describe("service worker does not precache the intro video", () => {
  it("lists the poster and samples, skips intro.mp4, and skips runtime caching of mp4", () => {
    const sw = readFileSync(join(APP, "sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.5\.0/);
    assert.match(sw, /media\/intro-poster\.jpg/);
    assert.match(sw, /media\/samples\/mug\.jpg/);
    assert.doesNotMatch(sw, /media\/intro\.mp4/);
    assert.match(sw, /\\.mp4\$/);
  });
});
