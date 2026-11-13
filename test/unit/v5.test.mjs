import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TERMS_VERSION, TERMS_KEY, INVITE_SEEN_KEY, INVITE_TOKEN_SHA256,
  TERMS_MAILTO_TO, TERMS_MAILTO_SUBJECT, TERMS_TITLE, TERMS_POINTS,
  TERMS_FULL_NOTE, TERMS_CHECK_LABEL,
  sha256Hex, parseInviteToken, tokenMatches, isValidInvite,
  termsAccepted, getAcceptance, setTermsAccepted, inviteSeen, setInviteSeen,
  clearTerms, shouldShowTermsInSettings, shouldShowTermsGate,
  rememberInviteIfValid, canAgree, agreeMailto, formatAcceptedAt
} from "../../app/js/core/invite.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const APP = join(ROOT, "app");
const INVITE_FILE = process.env.FLIP_SIDE_INVITE_FILE || "/home/box/.secrets/flip-side-invite-link.txt";

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

function readInviteToken() {
  if (!existsSync(INVITE_FILE)) return "";
  const raw = readFileSync(INVITE_FILE, "utf8").trim();
  const m = raw.match(/[?&]invite=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function walkFiles(dir, out = [], { skip = [] } = {}) {
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out, { skip });
    else out.push(p);
  }
  return out;
}

describe("SHA-256 and invite token matching", () => {
  it("hashes UTF-8 text to a lowercase hex digest", async () => {
    // FIPS 180-2 test vector: sha256("abc")
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.match(INVITE_TOKEN_SHA256, /^[a-f0-9]{64}$/);
  });
  it("parses ?invite= from a search string and ignores other params", () => {
    assert.equal(parseInviteToken(""), "");
    assert.equal(parseInviteToken("?nosw"), "");
    assert.equal(parseInviteToken("?invite="), "");
    assert.equal(parseInviteToken("?invite=abc123"), "abc123");
    assert.equal(parseInviteToken("?nosw&invite=tok_one-TWO"), "tok_one-TWO");
    assert.equal(parseInviteToken("invite=naked"), "naked");
    assert.equal(parseInviteToken("https://example.com/app/?invite=xyz&x=1"), "xyz");
  });
  it("accepts only a token whose SHA-256 matches the expected hash", async () => {
    const token = "unit-test-invite-token-xxxxx";
    const hash = await sha256Hex(token);
    assert.equal(await tokenMatches(token, hash), true);
    assert.equal(await tokenMatches("nope", hash), false);
    assert.equal(await tokenMatches("", hash), false);
    assert.equal(await isValidInvite("?invite=" + token, hash), true);
    assert.equal(await isValidInvite("?nosw&invite=" + token, hash), true);
    assert.equal(await isValidInvite("?invite=not-it", hash), false);
    assert.equal(await isValidInvite("?nosw", hash), false);
    assert.equal(await isValidInvite("", hash), false);
  });
});

describe("terms gate rules", () => {
  it("shows the gate only for a valid unused invite, never for a missing or bad token", async () => {
    const s = mem();
    const token = "unit-test-invite-token-xxxxx";
    const hash = await sha256Hex(token);
    const opts = { expectedHash: hash };
    assert.equal(await shouldShowTermsGate(s, { ...opts, search: "" }), false);
    assert.equal(await shouldShowTermsGate(s, { ...opts, search: "?nosw" }), false);
    assert.equal(await shouldShowTermsGate(s, { ...opts, search: "?invite=bad-token-value-here" }), false);
    assert.equal(await shouldShowTermsGate(s, { ...opts, search: "?nosw&invite=" + token }), true);
    assert.equal(await shouldShowTermsGate(s, { ...opts, search: "?invite=" + token, quiet: true }), false);
    assert.equal(await shouldShowTermsGate(s, { ...opts, search: "?invite=" + token + "&noterms" }), false);
  });
  it("does not show the gate again once the terms have been accepted", async () => {
    const s = mem();
    const token = "unit-test-invite-token-xxxxx";
    const hash = await sha256Hex(token);
    const rec = setTermsAccepted({ name: "Jessika", acceptedAt: "2026-11-12T21:30:00.000Z", version: "1" }, s);
    assert.equal(rec.name, "Jessika");
    assert.equal(termsAccepted(s), true);
    assert.equal(await shouldShowTermsGate(s, { expectedHash: hash, search: "?invite=" + token }), false);
    assert.equal(getAcceptance(s).version, "1");
    assert.equal(getAcceptance(s).acceptedAt, "2026-11-12T21:30:00.000Z");
  });
  it("remembers a valid invite so Settings can offer a reread, and clearTerms wipes it", async () => {
    const s = mem();
    const token = "unit-test-invite-token-xxxxx";
    const hash = await sha256Hex(token);
    assert.equal(shouldShowTermsInSettings(s), false);
    assert.equal(await rememberInviteIfValid("?invite=nope", s, hash), false);
    assert.equal(inviteSeen(s), false);
    assert.equal(await rememberInviteIfValid("?invite=" + token, s, hash), true);
    assert.equal(inviteSeen(s), true);
    assert.equal(shouldShowTermsInSettings(s), true);
    setTermsAccepted({ name: "Teddy", version: TERMS_VERSION }, s);
    assert.equal(shouldShowTermsInSettings(s), true);
    clearTerms(s);
    assert.equal(termsAccepted(s), false);
    assert.equal(inviteSeen(s), false);
    assert.equal(shouldShowTermsInSettings(s), false);
    assert.equal(s.getItem(TERMS_KEY), null);
    assert.equal(s.getItem(INVITE_SEEN_KEY), null);
  });
  it("canAgree needs the checkbox and a typed name", () => {
    assert.equal(canAgree({ agreed: false, name: "Jessika" }), false);
    assert.equal(canAgree({ agreed: true, name: "" }), false);
    assert.equal(canAgree({ agreed: true, name: "   " }), false);
    assert.equal(canAgree({ agreed: true, name: "Jessika" }), true);
  });
});

describe("agreement summary and mailto", () => {
  it("uses a short plain-English summary with first names only", () => {
    assert.equal(TERMS_TITLE, "Before we start");
    assert.equal(TERMS_CHECK_LABEL, "I've read this and I agree");
    assert.equal(TERMS_VERSION, "1");
    const blob = TERMS_POINTS.join(" ") + " " + TERMS_FULL_NOTE;
    assert.match(blob, /You and Teddy get half of the app's profit every three months/);
    assert.match(blob, /half if the app is ever sold/);
    assert.match(blob, /Ken carries all the costs and losses/);
    assert.match(blob, /you never owe anything/);
    assert.match(blob, /Your ideas go into the app/);
    assert.match(blob, /your share is your thanks/);
    assert.match(blob, /lasts as long as the app makes money/);
    assert.match(blob, /passes to your family/);
    assert.match(TERMS_FULL_NOTE, /full written agreement will come separately/);
    assert.doesNotMatch(blob, /Hasier/i);
    assert.doesNotMatch(blob, /Nootbaar/i);
    assert.doesNotMatch(blob, /@/);
  });
  it("builds an optional mailto to the bot inbox, not a personal address", () => {
    const href = agreeMailto({
      name: "Jessika",
      acceptedAt: "2026-11-13T03:30:00.000Z",
      version: "1"
    });
    assert.ok(href.startsWith(`mailto:${TERMS_MAILTO_TO}?`));
    assert.equal(TERMS_MAILTO_TO, "kens.remi@mail.grokbot.com");
    assert.equal(TERMS_MAILTO_SUBJECT, "Flip Side: I agree to the terms");
    assert.match(href, /subject=/);
    const q = href.slice(href.indexOf("?") + 1);
    const params = new URLSearchParams(q);
    assert.equal(params.get("subject"), TERMS_MAILTO_SUBJECT);
    const body = params.get("body") || "";
    assert.match(body, /Name: Jessika/);
    assert.match(body, /Date: 2026-11-13T03:30:00\.000Z/);
    assert.match(body, /Terms version: 1/);
    assert.doesNotMatch(href, /kennethnootbaar6/i);
    assert.doesNotMatch(href, /gmail\.com/i);
    assert.equal(formatAcceptedAt("2026-11-13T03:30:00.000Z"), "2026-11-13T03:30:00.000Z");
  });
});

describe("privacy: no personal data or invite token in the public repo", () => {
  const skip = new Set(["node_modules", ".git", "out", "media"]);
  const textExt = new Set([".js", ".mjs", ".css", ".html", ".md", ".json", ".webmanifest", ".txt", ".svg"]);

  function collect(dir) {
    const files = [];
    const st = statSync(dir);
    if (st.isDirectory()) walkFiles(dir, files, { skip: [...skip] });
    else files.push(dir);
    return files;
  }

  function readTextFiles(files) {
    const out = [];
    for (const file of files) {
      if (/\.(png|jpg|jpeg|mp4|woff|ttf|ico)$/i.test(file)) continue;
      const ext = extname(file).toLowerCase();
      if (ext && !textExt.has(ext) && !file.endsWith("sw.js")) continue;
      try { out.push([file, readFileSync(file, "utf8")]); } catch (e) { /* skip */ }
    }
    return out;
  }

  it("does not contain last names, personal email, or the plaintext invite token", async () => {
    // Shipped app and docs — not test files, which mention forbidden strings only to assert they are absent.
    const shipped = [
      ...collect(APP),
      ...collect(join(ROOT, "tools")),
      join(ROOT, "README.md"),
      join(ROOT, "ROADMAP.md"),
      join(ROOT, "package.json")
    ];
    const forbidden = [
      /Hasi(?:e|ie)r/i,
      /kennethnootbaar6/i,
      /gmail\.com/i
    ];
    const hits = [];
    for (const [file, text] of readTextFiles(shipped)) {
      for (const re of forbidden) {
        if (re.test(text)) hits.push(file + " matched " + String(re));
      }
    }
    assert.equal(hits.length, 0, hits.join("\n"));

    const token = readInviteToken();
    if (token) {
      assert.ok(token.length >= 24, "invite token should be at least 24 characters");
      assert.equal(await sha256Hex(token), INVITE_TOKEN_SHA256);
      const whole = [];
      for (const name of readdirSync(ROOT)) {
        if (skip.has(name)) continue;
        whole.push(...collect(join(ROOT, name)));
      }
      const tokenHits = [];
      for (const [file, text] of readTextFiles(whole)) {
        if (text.includes(token)) tokenHits.push(file);
      }
      assert.equal(tokenHits.length, 0, "invite token leaked into " + tokenHits.join(", "));
    }
  });
  it("service worker caches the new terms modules under the current version", () => {
    const sw = readFileSync(join(APP, "sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.8\.0/);
    assert.match(sw, /js\/core\/invite\.js/);
    assert.match(sw, /js\/ui\/terms\.js/);
  });
});
