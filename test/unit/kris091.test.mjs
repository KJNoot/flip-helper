// v0.9.1: Kris turns on by herself everywhere she uses the app: link, cookie (iPhone copies cookies into a
// Home Screen app), a manifest whose start_url carries the code, and her own sync data. No anonymous use.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CODE_KEY, NO_AUTO_KEY, NOTIFY_ASKED_KEY, COOKIE_NAME, getCode, setCode, clearCode, adoptCode, codeAt,
  codeFromCookie, codeCookie, appPath, krisManifest, isIOSDevice, isStandaloneDisplay, shouldAskNotify,
  takeSetupLink, krisKvSnapshot, applyKrisKv, KrisCore, createKrisStore
} from "../../app/js/core/kris.js";
import { mergeRecords, pickWinner, payloadHasKey, stripKeyish, runSync } from "../../app/js/core/sync.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = p => readFileSync(join(root, p), "utf8");
const FAKE = "FS-TESTCODE12345", OTHER = "FS-NEWERCODE6789";
function mem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
}

describe("v0.9.1 code: set on purpose vs. picked up by itself", () => {
  it("adoptCode only fills an empty device and respects a turned-away code", () => {
    const s = mem();
    assert.equal(adoptCode(FAKE, s, 10), FAKE);
    assert.equal(codeAt(s), 10);
    assert.equal(adoptCode(OTHER, s), "", "never replaces a code that is there");
    clearCode(s);
    assert.equal(s.getItem(NO_AUTO_KEY), FAKE);
    assert.equal(adoptCode(FAKE, s), "", "turned off here: not picked up again by itself");
    assert.equal(setCode(FAKE, s), FAKE, "she (or her link) can always set it again");
    assert.equal(s.getItem(NO_AUTO_KEY), null);
  });
  it("an installed app started from a #kris= start_url doesn't undo Turn off", () => {
    const s = mem(); setCode(FAKE, s); clearCode(s);
    let url = "";
    assert.equal(takeSetupLink({ hash: "#kris=" + FAKE, search: "", pathname: "/flip-helper/" }, { replaceState: (a, b, u) => { url = u; } }, s, { respectNoAuto: true }), true);
    assert.equal(getCode(s), "", "still off");
    assert.ok(!url.includes(FAKE), "but the code is still taken out of the address bar");
    takeSetupLink({ hash: "#kris=" + FAKE, search: "", pathname: "/flip-helper/" }, { replaceState() {} }, s);
    assert.equal(getCode(s), FAKE, "tapping her link in a browser turns it back on");
  });
});

describe("v0.9.1 cookie and manifest (carrying the code into a Home Screen app)", () => {
  it("reads and writes the cookie, scoped to the app folder, secure", () => {
    assert.equal(codeFromCookie(`a=1; ${COOKIE_NAME}=${FAKE}; b=2`), FAKE);
    assert.equal(codeFromCookie(`${COOKIE_NAME}=short`), "");
    assert.equal(codeFromCookie("other=FS-TESTCODE12345"), "");
    const c = codeCookie(FAKE, "/flip-helper/");
    assert.match(c, new RegExp(`^${COOKIE_NAME}=${FAKE}; Path=/flip-helper/; Max-Age=\\d+; Secure; SameSite=Strict$`));
    assert.match(codeCookie("", "/flip-helper/"), /Max-Age=0/);
    assert.equal(appPath("/flip-helper/index.html"), "/flip-helper/");
    assert.equal(appPath("/flip-helper/"), "/flip-helper/");
  });
  it("builds a same-app manifest whose start_url carries the code in the hash", () => {
    const base = JSON.parse(read("app/manifest.webmanifest"));
    const m = krisManifest(base, { pageUrl: "https://kjnoot.github.io/flip-helper/#/home", manifestUrl: "https://kjnoot.github.io/flip-helper/manifest.webmanifest", code: FAKE });
    assert.equal(m.id, "https://kjnoot.github.io/flip-helper/", "same id as the real manifest, so it's the same app");
    assert.equal(m.scope, "https://kjnoot.github.io/flip-helper/");
    assert.equal(m.start_url, "https://kjnoot.github.io/flip-helper/index.html#kris=" + FAKE);
    assert.ok(!m.start_url.includes("?"), "the code is never in the query, so it isn't sent to the web server");
    assert.ok(m.icons.every(i => i.src.startsWith("https://kjnoot.github.io/flip-helper/icons/")));
    assert.equal(m.display, "standalone"); assert.equal(m.name, base.name);
    assert.ok(!read("app/manifest.webmanifest").includes("kris="), "the real manifest file has no code");
  });
  it("knows an iPhone/iPad and a Home Screen launch", () => {
    assert.equal(isIOSDevice({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
    assert.equal(isIOSDevice({ ua: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true, "iPadOS");
    assert.equal(isIOSDevice({ ua: "Mozilla/5.0 (Linux; Android 14) Chrome/130" }), false);
    assert.equal(isStandaloneDisplay({ navigator: { standalone: true } }), true);
    assert.equal(isStandaloneDisplay({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
  });
});

describe("v0.9.1 sync brings Kris to a paired device", () => {
  it("a device with no code picks hers up from sync; a newer code replaces an older one", () => {
    const phone = mem(), computer = mem();
    setCode(FAKE, computer, 1000);
    const snap = krisKvSnapshot(computer)["kris:krisAccess"];
    assert.equal(payloadHasKey(snap.payload), false, "the sync key check doesn't block it");
    assert.deepEqual(stripKeyish(snap.payload), snap.payload);
    assert.equal(applyKrisKv(snap.key, snap.payload, snap.updatedAt, phone), "access");
    assert.equal(getCode(phone), FAKE);
    assert.equal(applyKrisKv("kris:krisAccess", { v: [OTHER] }, 500, phone), false, "older code ignored");
    assert.equal(applyKrisKv("kris:krisAccess", { v: [OTHER] }, 5000, phone), "access");
    assert.equal(getCode(phone), OTHER);
    assert.equal(applyKrisKv("kris:krisAccess", { v: ["bad"] }, 9000, phone), false);
  });
  it("a code turned away on this device (off, or the server said no) isn't brought back by sync", () => {
    const s = mem(); setCode(FAKE, s); clearCode(s);
    assert.equal(applyKrisKv("kris:krisAccess", { v: [FAKE] }, Date.now() + 1000, s), false);
    assert.equal(getCode(s), "");
  });
  it("runSync with the Kris kv hooks carries the code from one device to the other (fake cloud)", async () => {
    const rows = [];
    const table = name => ({
      select: async () => ({ data: name === "kv" ? rows : [], error: null }),
      upsert: async row => { if (name === "kv") { const i = rows.findIndex(r => r.key === row.key); if (i >= 0) rows[i] = row; else rows.push(row); } return { error: null }; }
    });
    const sb = { from: name => { const t = table(name); return { select: () => t.select(), upsert: r => t.upsert(r) }; } };
    const user = { id: "00000000-0000-0000-0000-000000000001" };
    const computer = mem(), phone = mem();
    setCode(FAKE, computer, 1000);
    const deps = st => ({ sb, user, storage: mem(), localItems: [], ownerId: user.id,
      getKv: () => krisKvSnapshot(st), setKv: (k, p, u) => applyKrisKv(k, p, u, st) });
    const r1 = await runSync(deps(computer));
    assert.equal(r1.ok, true, r1.message);
    assert.ok(rows.some(r => r.key === "kris:krisAccess"));
    assert.equal(getCode(phone), "");
    const r2 = await runSync(deps(phone));
    assert.equal(r2.ok, true);
    assert.equal(getCode(phone), FAKE);
  });
});

describe("v0.9.1 notifications and wiring", () => {
  it("asks for notification permission once ever, on the first reminder", () => {
    const s = mem();
    assert.equal(shouldAskNotify(s), true);
    assert.ok(s.getItem(NOTIFY_ASKED_KEY));
    assert.equal(shouldAskNotify(s), false);
    const ui = read("app/js/ui/kris.js");
    assert.match(ui, /shouldAskNotify\(\) \? await core\(\)\.askNotify\(\)/);
    assert.equal((ui.match(/askNotify\(/g) || []).length, 1, "the only permission prompt is behind the first reminder");
    assert.ok(!/requestPermission/.test(read("app/js/main.js")), "nothing asks on launch");
  });
  it("boots the code on launch, after a link, and after every sync; pairing in Settings brings Kris", () => {
    const main = read("app/js/main.js");
    assert.match(main, /takeSetupLink\(location, history, undefined, \{ respectNoAuto: isStandaloneDisplay\(window\) \}\);\nbootKrisAccess\(\);/);
    assert.match(main, /if \(r && r\.ok\) \{ bootKrisAccess\(\); mountKris\(ctx\); \}/);
    const st = read("app/js/ui/screens/settings.js");
    assert.match(st, /getKv: \(\) => krisKvSnapshot\(\)/);
    assert.match(st, /forgetCodeHere\(\)/);
    const ui = read("app/js/ui/kris.js");
    assert.match(ui, /isIOSDevice\(\{[^}]*\}\) && !isStandaloneDisplay\(win\)\) swapManifest/);
    assert.match(ui, /return !!getCode\(\) \|\| invited \|\| flag;/);
  });
  it("bumps to 0.9.1", () => {
    assert.equal(JSON.parse(read("package.json")).version, "0.9.1");
    assert.match(read("app/js/main.js"), /export const VERSION = "0\.9\.1"/);
    assert.match(read("app/sw.js"), /flip-helper-v0\.9\.1/);
  });
});
