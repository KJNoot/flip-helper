import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  mergeRecords, pickWinner, recordTime, itemToCloudPayload, scanToCloudPayload,
  payloadHasKey, isSyncNotReadyError, friendlySyncError, ensurePhotoIds,
  newPhotoId, cloudPhotoPath, photoHash, enqueue, loadQueue, addTombstone,
  loadTombstones, syncStatusLabel, saveSyncStatus, loadSyncStatus,
  requestSignInCode, verifySignInCode, runSync, setSupabaseClient, resetSupabaseClient,
  SYNC_NOT_READY_MSG, KEY_STAYS_NOTE, SYNC_STEPS, QUEUE_KEY,
  noteLocalChange,
  normalizeSyncCode, formatSyncCode, classifySyncCode,
  PAIRING_CODE_LENGTH, RECOVERY_CODE_LENGTH, SYNC_ALPHABET, PAIRING_TTL_MS,
  EMAIL_SYNC_ENABLED, PENDING_RECOVERY_KEY,
  turnOnSync, createPairingCode, joinWithCode, rotateRecoveryCode,
  turnOffSyncOnThisDevice, signInAnonymously, resolveOwnerId,
  loadPendingRecovery, clearPendingRecovery
} from "../../app/js/core/sync.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, PHOTOS_BUCKET, SYNC_CLOUD_EDGE, EMAIL_SYNC_ENABLED as CFG_EMAIL } from "../../app/js/core/sync-config.js";
import {
  offCardHtml, recoveryCardHtml, enterCodeHtml, pairingCodeHtml,
  signedInCardHtml, recoveryDownloadText, recoveryPrintHtml, countdownLabel,
  syncCardShell
} from "../../app/js/ui/syncui.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDesktop, reorderPhotos, movePhotoToCover, gatherCandidates, applyGathered, bulkFields, DESKTOP_MIN_WIDTH } from "../../app/js/core/desktop.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }
  };
}

function memStore(seed = []) {
  const rows = new Map(seed.map(i => [i.id, { ...i }]));
  return {
    name: "memory",
    async all() { return [...rows.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); },
    async get(id) { return rows.has(id) ? { ...rows.get(id) } : null; },
    async put(item) { rows.set(item.id, { ...item }); return item; },
    async remove(id) { rows.delete(id); },
    async wipe() { rows.clear(); },
    get _rows() { return rows; }
  };
}

describe("v0.8.0 sync merge, tombstones, and privacy", () => {
  it("keeps the local item when it was written later, and the remote when it was", () => {
    const local = { id: "a", title: "Local mug", updatedAt: 200 };
    const remote = { id: "a", title: "Remote mug", updatedAt: 100 };
    assert.equal(pickWinner(local, remote).source, "local");
    assert.equal(pickWinner(local, remote).winner.title, "Local mug");
    assert.equal(pickWinner(local, { ...remote, updatedAt: 300 }).source, "remote");
    assert.equal(pickWinner(local, { ...remote, updatedAt: 200 }).source, "local"); // tie: don't stomp
    assert.equal(pickWinner(null, remote).source, "remote");
    assert.equal(pickWinner(local, null).source, "local");
  });

  it("merges two lists without wiping either side, and last-write-wins on a conflict", () => {
    const local = [
      { id: "only-local", title: "Phone only", updatedAt: 10 },
      { id: "both", title: "Phone version", updatedAt: 50 }
    ];
    const remote = [
      { id: "only-remote", title: "Computer only", updatedAt: 20 },
      { id: "both", title: "Computer version", updatedAt: 40 }
    ];
    const { next, push, pull } = mergeRecords(local, remote);
    const titles = next.map(r => r.title).sort();
    assert.deepEqual(titles, ["Computer only", "Phone only", "Phone version"]);
    assert.ok(push.some(r => r.id === "only-local"));
    assert.ok(push.some(r => r.id === "both" && r.title === "Phone version"));
    assert.ok(pull.some(r => r.id === "only-remote"));
    assert.ok(!pull.some(r => r.id === "both")); // local won, don't pull
    // Nothing from either side was dropped just because the other was missing.
    assert.equal(next.length, 3);
  });

  it("treats a newer tombstone as a deletion, and a newer edit as a restore", () => {
    const local = [{ id: "x", title: "Still here", updatedAt: 10 }];
    const remote = [{ id: "x", deletedAt: 30, updatedAt: 30 }];
    const { next, pull, tombstones } = mergeRecords(local, remote);
    assert.equal(next.length, 0);
    assert.equal(tombstones.length, 1);
    assert.ok(pull.some(r => r.id === "x" && r.deletedAt));

    const resurrect = mergeRecords(
      [{ id: "x", title: "Edited after delete", updatedAt: 50 }],
      [{ id: "x", deletedAt: 30, updatedAt: 30 }]
    );
    assert.equal(resurrect.next[0].title, "Edited after delete");
    assert.ok(resurrect.push.some(r => r.id === "x" && !r.deletedAt));
  });

  it("strips photo bytes and any key-like field from a cloud payload", () => {
    const item = ensurePhotoIds({
      id: "it_1",
      title: "Mug",
      updatedAt: 1,
      apiKey: "sk-this-must-never-leave",
      key: "nope",
      openai: { apiKey: "sk-nested" },
      photos: [{ dataUrl: "data:image/jpeg;base64,AAA", originalDataUrl: "data:image/jpeg;base64,BBB", addedAt: 1 }]
    });
    const payload = itemToCloudPayload(item);
    assert.equal(payload.title, "Mug");
    assert.ok(payload.photos[0].id);
    assert.equal(payload.photos[0].dataUrl, undefined);
    assert.equal(payload.photos[0].originalDataUrl, undefined);
    assert.equal(payload.apiKey, undefined);
    assert.equal(payload.key, undefined);
    assert.equal(payload.openai, undefined);
    assert.equal(payloadHasKey(payload), false);
    assert.equal(payloadHasKey({ apiKey: "sk-x" }), true);
    assert.equal(payloadHasKey({ notes: "sk-ish looking text" }), false);

    const scan = scanToCloudPayload({
      id: "sc_1",
      coverThumb: "data:image/jpeg;base64,CCC",
      items: [{ id: "li_1", thumbDataUrl: "data:image/jpeg;base64,DDD", name: "Mug" }],
      openai: "sk-no"
    });
    assert.equal(scan.coverThumb, undefined);
    assert.equal(scan.items[0].thumbDataUrl, undefined);
    assert.equal(scan.items[0].name, "Mug");
    assert.equal(scan.openai, undefined);
  });

  it("recognizes missing-table / missing-bucket errors as a kind not-ready state", () => {
    assert.equal(isSyncNotReadyError({ code: "42P01", message: "relation \"items\" does not exist" }), true);
    assert.equal(isSyncNotReadyError({ code: "PGRST205", message: "could not find the table" }), true);
    assert.equal(isSyncNotReadyError({ message: "Bucket not found" }), true);
    assert.equal(isSyncNotReadyError({ message: "Failed to fetch" }), false);
    assert.equal(friendlySyncError({ code: "42P01" }), SYNC_NOT_READY_MSG);
    assert.match(SYNC_NOT_READY_MSG, /Sync isn't ready yet/);
    assert.match(SYNC_NOT_READY_MSG, /still safe on this device/);
    assert.match(KEY_STAYS_NOTE, /never uploaded/);
    assert.match(KEY_STAYS_NOTE, /paste the key/i);
    assert.equal(SYNC_STEPS.length, 5);
    assert.ok(SYNC_STEPS.some(s => /8-character code/i.test(s)));
    assert.ok(SYNC_STEPS.some(s => /recovery code/i.test(s)));
    assert.ok(SYNC_STEPS.some(s => /nothing is wiped/i.test(s)));
    assert.ok(SYNC_STEPS.some(s => /first device/i.test(s)));
    assert.ok(SYNC_STEPS.some(s => /never uploaded/i.test(s)));
  });

  it("queues an upsert and a tombstone on delete, without touching a network", () => {
    const s = mem();
    enqueue({ kind: "item", id: "a", action: "upsert" }, s, 1);
    enqueue({ kind: "item", id: "a", action: "upsert" }, s, 2); // replace
    assert.equal(loadQueue(s).length, 1);
    assert.equal(loadQueue(s)[0].at, 2);
    addTombstone({ id: "a", kind: "item", at: 3 }, s);
    assert.equal(loadTombstones(s)[0].id, "a");
    assert.equal(syncStatusLabel({ state: "synced", lastSyncAt: 1 }, { signedIn: true }), "Synced");
    assert.equal(syncStatusLabel({ state: "not-ready", notReady: true }, { signedIn: true }), "Sync isn't ready yet");
    assert.equal(syncStatusLabel({ state: "synced" }, { signedIn: false }), "");
    const st = saveSyncStatus({ state: "syncing" }, s);
    assert.equal(loadSyncStatus(s).state, "syncing");
    void st;
  });

  it("signs in with email + a 6-digit code (verifyOtp type email), not a magic link", async () => {
    const calls = [];
    const sb = {
      auth: {
        async signInWithOtp(opts) { calls.push(["otp", opts]); return { data: {}, error: null }; },
        async verifyOtp(opts) {
          calls.push(["verify", opts]);
          if (opts.token === "123456" && opts.type === "email") {
            return { data: { session: { user: { id: "u1", email: opts.email } }, user: { id: "u1" } }, error: null };
          }
          return { data: {}, error: { message: "Invalid or expired code" } };
        }
      }
    };
    const sent = await requestSignInCode("Jess@Example.com", { sb });
    assert.equal(sent.email, "jess@example.com");
    const otp = calls[0][1];
    assert.equal(otp.email, "jess@example.com");
    assert.equal(otp.options.shouldCreateUser, true);
    assert.equal(otp.options.emailRedirectTo, undefined);

    await assert.rejects(() => verifySignInCode("jess@example.com", "12", { sb }), /6-digit/);
    const ok = await verifySignInCode("jess@example.com", "123456", { sb });
    assert.equal(ok.ok, true);
    assert.equal(calls[1][1].type, "email");
    await assert.rejects(() => verifySignInCode("jess@example.com", "000000", { sb }), /didn't work|Invalid|expired/i);
  });

  it("runSync merges, never wipes, and skips a missing table with a kind message", async () => {
    const store = memStore([
      { id: "phone", title: "On the phone", updatedAt: 10, createdAt: 10, photos: [] },
      { id: "both", title: "Phone wins", updatedAt: 50, createdAt: 10, photos: [] }
    ]);
    const tables = {
      items: [
        { id: "comp", payload: { id: "comp", title: "On the computer", photos: [] }, updated_at: "1970-01-01T00:00:00.020Z", created_at: "1970-01-01T00:00:00.020Z", deleted_at: null },
        { id: "both", payload: { id: "both", title: "Computer older", photos: [] }, updated_at: "1970-01-01T00:00:00.040Z", created_at: "1970-01-01T00:00:00.010Z", deleted_at: null }
      ]
    };
    const upserts = [];
    const sb = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1", email: "a@b.c" } } }, error: null }) },
      from(name) {
        return {
          select: async () => ({ data: tables[name] || [], error: null }),
          upsert: async row => { upserts.push({ name, row }); return { error: null }; }
        };
      },
      storage: { from() { return { upload: async () => ({ error: null }), download: async () => ({ data: new Blob(), error: null }) }; } }
    };
    resetSupabaseClient();
    setSupabaseClient(sb);
    const result = await runSync({ store, sb, user: { id: "u1" }, storage: mem() });
    assert.equal(result.ok, true);
    const ids = (await store.all()).map(i => i.id).sort();
    assert.deepEqual(ids, ["both", "comp", "phone"]);
    assert.equal((await store.get("both")).title, "Phone wins");
    assert.equal((await store.get("comp")).title, "On the computer");
    assert.ok(upserts.some(u => u.row.id === "phone"));
    assert.ok(upserts.some(u => u.row.id === "both"));
    assert.ok(!upserts.some(u => u.row.payload && u.row.payload.apiKey));

    // Missing tables: kind message, local store untouched.
    const store2 = memStore([{ id: "keep", title: "Stay", updatedAt: 1, photos: [] }]);
    const missing = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }) },
      from() { return { select: async () => ({ data: null, error: { code: "42P01", message: "relation \"items\" does not exist" } }) }; }
    };
    const r2 = await runSync({ store: store2, sb: missing, user: { id: "u1" }, storage: mem() });
    assert.equal(r2.ok, false);
    assert.equal(r2.notReady, true);
    assert.equal(r2.message, SYNC_NOT_READY_MSG);
    assert.equal((await store2.all()).length, 1);
    assert.equal((await store2.all())[0].id, "keep");
    resetSupabaseClient();
  });

  it("refuses to build a cloud row that would carry an OpenAI key", () => {
    const sneaky = itemToCloudPayload({
      id: "x",
      title: "Hat",
      updatedAt: 1,
      photos: [],
      token: "sk-abc",
      notes: "A nice hat"
    });
    assert.equal(sneaky.token, undefined);
    assert.equal(sneaky.notes, "A nice hat");
  });

  it("builds per-user private photo paths and a stable hash", () => {
    const p = cloudPhotoPath("uid-1", "it_9", "ph_a");
    assert.equal(p, "uid-1/it_9/ph_a.jpg");
    assert.match(cloudPhotoPath("uid-1", "sc_1", "ph_b", "scan"), /^uid-1\/scans\//);
    assert.equal(PHOTOS_BUCKET, "photos");
    assert.equal(SYNC_CLOUD_EDGE, 1600);
    assert.match(SUPABASE_URL, /novwnajwmsrrdgarvbry\.supabase\.co/);
    assert.match(SUPABASE_ANON_KEY, /^sb_publishable_/);
    assert.match(photoHash("data:image/jpeg;base64,ABC"), /^\d+:/);
    assert.ok(newPhotoId().startsWith("ph_"));
  });

  it("does not put last names, emails, or secret keys in the new modules", () => {
    const files = [
      "app/js/core/sync.js",
      "app/js/core/sync-config.js",
      "app/js/core/desktop.js",
      "app/js/ui/syncui.js",
      "supabase/schema.sql",
      "supabase/schema-v2.sql",
      "supabase/DASHBOARD-STEPS.md",
      "supabase/try-real-project.mjs"
    ];
    const deny = /Nootbaar|KennethNootbaar6|sk-proj-|sk-[A-Za-z0-9]{20,}|service_role/;
    for (const f of files) {
      let src;
      try { src = readFileSync(join(root, f), "utf8"); } catch { continue; }
      assert.doesNotMatch(src, deny, f);
    }
    const sql = readFileSync(join(root, "supabase/schema.sql"), "utf8");
    assert.match(sql, /user_id = auth\.uid\(\)/);
    assert.match(sql, /create table if not exists public\.items/i);
    assert.match(sql, /create table if not exists public\.scans/i);
    assert.match(sql, /bucket_id = 'photos'/);
    assert.match(sql, /force row level security/i);
    // Comments may say we do not store a key; there must be no column for one.
    assert.doesNotMatch(sql, /\b(api_key|openai_key|openai_api_key)\b\s+/i);
    assert.match(sql, /does not store/i);
    const steps = readFileSync(join(root, "supabase/DASHBOARD-STEPS.md"), "utf8");
    assert.match(steps, /https:\/\/kjnoot\.github\.io\/flip-helper\//);
    assert.match(steps, /\{\{ \.Token \}\}/);
    assert.match(steps, /OTP length/i);
    assert.match(steps, /not a (magic )?link/i);
    assert.match(steps, /Allow anonymous sign-ins/i);
    assert.match(steps, /CAPTCHA/i);
    assert.match(steps, /schema-v2\.sql/);
    assert.match(steps, /pairing code/i);
    const v2 = readFileSync(join(root, "supabase/schema-v2.sql"), "utf8");
    assert.match(v2, /current_owner_id\(\)/);
    assert.match(v2, /device_links/);
    assert.match(v2, /security definer/i);
    assert.match(v2, /sha256/i);
    assert.match(v2, /10 minutes/);
    assert.match(v2, /23456789ABCDEFGHJKLMNPQRSTUVWXYZ/);
    assert.match(v2, /ensure_sync_owner/);
    assert.match(v2, /create_pairing_code/);
    assert.match(v2, /redeem_pairing_code/);
    assert.match(v2, /redeem_recovery_code/);
    assert.match(v2, /cleanup_stale_sync/);
    assert.match(v2, /revoke_this_device/);
    assert.doesNotMatch(v2, /\b(api_key|openai_key|openai_api_key)\b\s+/i);
    assert.match(v2, /does not store/i);
    // Codes are stored hashed, never in plaintext.
    assert.match(v2, /code_hash/);
    assert.match(v2, /hash_sync_code\(raw_code\)/);
    assert.doesNotMatch(v2, /insert into public\.pairing_codes\s*\([^)]*\bcode\b\s*,/i);
  });
});


describe("v0.8.0 desktop helpers", () => {
  it("treats 1440 as desktop and 390 as the phone, without changing phone widths", () => {
    assert.equal(isDesktop(1440), true);
    assert.equal(isDesktop(1024), true);
    assert.equal(isDesktop(1023), false);
    assert.equal(isDesktop(390), false);
    assert.equal(DESKTOP_MIN_WIDTH, 1024);
  });

  it("reorders photos and can pick a cover (first photo)", () => {
    const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(reorderPhotos(photos, 2, 0).map(p => p.id), ["c", "a", "b"]);
    assert.deepEqual(movePhotoToCover(photos, 1).map(p => p.id), ["b", "a", "c"]);
    assert.deepEqual(reorderPhotos(photos, 0, 0).map(p => p.id), ["a", "b", "c"]);
    assert.equal(photos[0].id, "a"); // original not mutated
  });

  it("gathers copies of photos from other items and scans, leaving originals alone", () => {
    const items = [
      { id: "it_self", title: "Self", photos: [{ dataUrl: "data:self" }] },
      { id: "it_hat", title: "Wool hat", photos: [{ dataUrl: "data:hat1" }, { dataUrl: "data:hat2" }] }
    ];
    const scans = [{
      id: "sc_1",
      coverThumb: "data:cover",
      items: [{
        id: "li_1",
        name: "Mug",
        thumbDataUrl: "data:thumb",
        closeupPhotos: [{ dataUrl: "data:close" }]
      }]
    }];
    const found = gatherCandidates({ items, scans, excludeItemId: "it_self" });
    assert.ok(found.some(f => f.dataUrl === "data:hat1" && /Wool hat/.test(f.caption)));
    assert.ok(found.some(f => f.dataUrl === "data:close"));
    assert.ok(found.some(f => f.dataUrl === "data:cover"));
    assert.ok(!found.some(f => f.dataUrl === "data:self"));
    const next = applyGathered([{ dataUrl: "data:self" }], [found.find(f => f.dataUrl === "data:hat1")]);
    assert.equal(next.length, 2);
    assert.equal(next[1].dataUrl, "data:hat1");
    assert.equal(items[1].photos.length, 2); // original stays
  });

  it("only applies known bulk-edit fields", () => {
    const f = bulkFields({ category: "Kitchen", condition: "Good", binLocation: "A1", askingPrice: 99, title: "Nope", notes: "From a haul" });
    assert.equal(f.category, "Kitchen");
    assert.equal(f.binLocation, "A1");
    assert.equal(f.notes, "From a haul");
    assert.equal(f.askingPrice, undefined);
    assert.equal(f.title, undefined);
  });
});

// ---------------------------------------------------------------------------
// Fake Supabase: two anonymous devices, hashed pairing codes, shared owner,
// RLS on items keyed by owner, rate limits, single-use + expiry. Mirrors
// supabase/schema-v2.sql closely enough to exercise the client end-to-end.
// ---------------------------------------------------------------------------

function sha256hex(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

function genCode(len) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += SYNC_ALPHABET[bytes[i] % 32];
  return out;
}

class FakeWorld {
  constructor({ now = Date.now(), anonymousEnabled = true } = {}) {
    this.now = now;
    this.anonymousEnabled = anonymousEnabled;
    this.owners = new Map();
    this.links = new Map(); // userId -> { owner_id, revoked_at, last_seen, created_at }
    this.pairing = []; // { id, owner_id, created_by, code_hash, expires_at, used_at, used_by, failed_attempts, created_at }
    this.recovery = []; // { id, owner_id, code_hash, revoked_at, failed_attempts, locked_until, created_at }
    this.attempts = []; // { user_id, at, ok, kind }
    this.items = [];
    this.scans = [];
    this.kv = [];
    this.users = new Map();
    this.rpcLog = [];
    this.plaintexts = []; // only what was returned to a client, never stored in tables
  }

  client() {
    const world = this;
    const auth = {
      session: null,
      async signInAnonymously() {
        if (!world.anonymousEnabled) {
          return { data: {}, error: { message: "Anonymous sign-ins are disabled" } };
        }
        const user = { id: randomUUID(), is_anonymous: true };
        world.users.set(user.id, { ...user, created_at: world.now });
        auth.session = { user, access_token: "t-" + user.id };
        return { data: { user, session: auth.session }, error: null };
      },
      async getSession() { return { data: { session: auth.session }, error: null }; },
      async getUser() { return { data: { user: auth.session && auth.session.user }, error: null }; },
      async signOut() { auth.session = null; return { error: null }; },
      async signInWithOtp() { return { data: {}, error: { message: "email is disabled in this mock" } }; },
      async verifyOtp() { return { data: {}, error: { message: "email is disabled in this mock" } }; }
    };
    const calls = [];
    const client = {
      auth,
      calls,
      rpc: async (name, args = {}) => {
        world.rpcLog.push({ name, args, user: auth.session && auth.session.user && auth.session.user.id });
        calls.push(["rpc", name, args]);
        return world.rpc(auth.session && auth.session.user && auth.session.user.id, name, args);
      },
      from(name) { return world.table(auth, name); },
      storage: { from() { return { upload: async () => ({ error: null }), download: async () => ({ data: new Blob(), error: null }) }; } }
    };
    return client;
  }

  uid(uid) { return uid || null; }

  currentOwner(uid) {
    const link = this.links.get(uid);
    if (!link || link.revoked_at) return null;
    return link.owner_id;
  }

  fail(message, code = "P0001") {
    return { data: null, error: { message, code } };
  }
  // Mirrors schema-v2: redeem logs a guess and RETURNS an error
  // object so the log commits (a RAISE would roll it back).
  failReturn(message, code = "P0001") {
    return { data: { ok: false, error: message, code }, error: null };
  }

  rateLimit(uid, kind) {
    const window = 15 * 60 * 1000;
    const fails = this.attempts.filter(a => a.user_id === uid && a.kind === kind && !a.ok && a.at > this.now - window).length;
    if (fails >= 8) return this.fail("Please wait a few minutes and try again.", "P0003");
    return null;
  }

  rpc(uid, name, args) {
    if (!uid && name !== "current_owner_id") {
      return this.fail("Please turn on sync first.", "28000");
    }
    if (name === "current_owner_id") return { data: uid ? this.currentOwner(uid) : null, error: null };
    if (name === "ensure_sync_owner") return this.ensure(uid);
    if (name === "create_pairing_code") return this.createPairing(uid);
    if (name === "redeem_pairing_code") return this.redeemPairing(uid, args.p_code);
    if (name === "redeem_recovery_code") return this.redeemRecovery(uid, args.p_code);
    if (name === "rotate_recovery_code") return this.rotate(uid);
    if (name === "revoke_this_device") return this.revoke(uid);
    return this.fail("could not find the function " + name, "PGRST202");
  }

  ensure(uid) {
    const oid = this.currentOwner(uid);
    if (oid) return { data: { owner_id: oid, is_new: false, recovery_code: null }, error: null };
    if (this.links.has(uid)) {
      return this.fail("This device was turned off. Type a code from your other device, or your recovery code, to connect it again.", "P0004");
    }
    const owner = randomUUID();
    this.owners.set(owner, { id: owner, created_at: this.now });
    this.links.set(uid, { owner_id: owner, revoked_at: null, last_seen: this.now, created_at: this.now });
    const raw = genCode(16);
    this.recovery.push({
      id: randomUUID(), owner_id: owner, code_hash: sha256hex(normalizeSyncCode(raw)),
      revoked_at: null, failed_attempts: 0, locked_until: null, created_at: this.now
    });
    const pretty = formatSyncCode(raw);
    this.plaintexts.push({ kind: "recovery", code: pretty, at: this.now });
    return { data: { owner_id: owner, is_new: true, recovery_code: pretty }, error: null };
  }

  createPairing(uid) {
    const oid = this.currentOwner(uid);
    if (!oid) return this.fail("Please turn on sync first.", "28000");
    const hour = this.pairing.filter(c => c.owner_id === oid && c.created_at > this.now - 3600_000).length;
    if (hour >= 8) return this.fail("Please wait a few minutes and try again.", "P0003");
    for (const c of this.pairing) {
      if (c.owner_id === oid && !c.used_at && c.expires_at > this.now) c.expires_at = this.now;
    }
    const raw = genCode(8);
    this.pairing.push({
      id: randomUUID(), owner_id: oid, created_by: uid,
      code_hash: sha256hex(normalizeSyncCode(raw)),
      expires_at: this.now + PAIRING_TTL_MS, used_at: null, used_by: null,
      failed_attempts: 0, created_at: this.now
    });
    const pretty = formatSyncCode(raw);
    this.plaintexts.push({ kind: "pairing", code: pretty, at: this.now });
    return { data: { code: pretty, expires_at: new Date(this.now + PAIRING_TTL_MS).toISOString() }, error: null };
  }

  redeemPairing(uid, raw) {
    const limited = this.rateLimit(uid, "pairing");
    if (limited) return this.failReturn(limited.error.message, limited.error.code);
    const norm = normalizeSyncCode(raw);
    const existing = this.currentOwner(uid);
    if (norm.length !== 8) {
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "pairing" });
      return this.failReturn("That code didn't work or it expired. Ask the other device for a new one.");
    }
    const h = sha256hex(norm);
    const rec = this.pairing.find(c => c.code_hash === h && !c.used_at && c.expires_at > this.now);
    if (!rec || rec.failed_attempts >= 8) {
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "pairing" });
      if (rec) { rec.failed_attempts += 1; if (rec.failed_attempts >= 8) rec.expires_at = this.now; }
      return this.failReturn("That code didn't work or it expired. Ask the other device for a new one.");
    }
    if (existing) {
      if (existing === rec.owner_id) {
        rec.used_at = this.now; rec.used_by = uid;
        this.attempts.push({ user_id: uid, at: this.now, ok: true, kind: "pairing" });
        return { data: { owner_id: existing, already_linked: true }, error: null };
      }
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "pairing" });
      return this.failReturn("This device is already synced. Turn off sync on this device first if you want to connect it to a different one.", "P0004");
    }
    const count = [...this.links.values()].filter(l => l.owner_id === rec.owner_id && !l.revoked_at).length;
    if (count >= 6) {
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "pairing" });
      return this.failReturn("This account already has the maximum number of devices. Turn off sync on one you no longer use, then try again.", "P0005");
    }
    this.links.set(uid, { owner_id: rec.owner_id, revoked_at: null, last_seen: this.now, created_at: this.now });
    rec.used_at = this.now; rec.used_by = uid;
    this.attempts.push({ user_id: uid, at: this.now, ok: true, kind: "pairing" });
    return { data: { owner_id: rec.owner_id, already_linked: false }, error: null };
  }

  redeemRecovery(uid, raw) {
    const limited = this.rateLimit(uid, "recovery");
    if (limited) return this.failReturn(limited.error.message, limited.error.code);
    const norm = normalizeSyncCode(raw);
    const existing = this.currentOwner(uid);
    if (norm.length !== 16) {
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "recovery" });
      return this.failReturn("That recovery code didn't work. Check it and try again.");
    }
    const h = sha256hex(norm);
    const rec = this.recovery.find(c => c.code_hash === h && !c.revoked_at);
    if (!rec) {
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "recovery" });
      return this.failReturn("That recovery code didn't work. Check it and try again.");
    }
    if (existing) {
      if (existing === rec.owner_id) {
        this.attempts.push({ user_id: uid, at: this.now, ok: true, kind: "recovery" });
        return { data: { owner_id: existing, already_linked: true }, error: null };
      }
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "recovery" });
      return this.failReturn("This device is already synced. Turn off sync on this device first if you want to connect it to a different one.", "P0004");
    }
    const count = [...this.links.values()].filter(l => l.owner_id === rec.owner_id && !l.revoked_at).length;
    if (count >= 6) {
      this.attempts.push({ user_id: uid, at: this.now, ok: false, kind: "recovery" });
      return this.failReturn("This account already has the maximum number of devices. Turn off sync on one you no longer use, then try again.", "P0005");
    }
    this.links.set(uid, { owner_id: rec.owner_id, revoked_at: null, last_seen: this.now, created_at: this.now });
    this.attempts.push({ user_id: uid, at: this.now, ok: true, kind: "recovery" });
    return { data: { owner_id: rec.owner_id, already_linked: false }, error: null };
  }

  rotate(uid) {
    const oid = this.currentOwner(uid);
    if (!oid) return this.fail("Please turn on sync first.", "28000");
    const recent = this.recovery.filter(c => c.owner_id === oid && c.created_at > this.now - 3600_000).length;
    if (recent >= 4) return this.fail("Please wait a few minutes and try again.", "P0003");
    for (const c of this.recovery) if (c.owner_id === oid && !c.revoked_at) c.revoked_at = this.now;
    const raw = genCode(16);
    this.recovery.push({
      id: randomUUID(), owner_id: oid, code_hash: sha256hex(normalizeSyncCode(raw)),
      revoked_at: null, failed_attempts: 0, locked_until: null, created_at: this.now
    });
    const pretty = formatSyncCode(raw);
    this.plaintexts.push({ kind: "recovery", code: pretty, at: this.now });
    return { data: { recovery_code: pretty }, error: null };
  }

  revoke(uid) {
    const link = this.links.get(uid);
    if (link && !link.revoked_at) link.revoked_at = this.now;
    return { data: { ok: true, revoked: true }, error: null };
  }

  table(auth, name) {
    const world = this;
    const rows = () => world[name] || [];
    return {
      async select() {
        const uid = auth.session && auth.session.user && auth.session.user.id;
        const oid = world.currentOwner(uid);
        return { data: rows().filter(r => r.user_id === oid), error: null };
      },
      async upsert(row) {
        const uid = auth.session && auth.session.user && auth.session.user.id;
        const oid = world.currentOwner(uid);
        if (!oid || row.user_id !== oid) {
          return { error: { message: "row level security", code: "42501" } };
        }
        if (payloadHasKeySafe(row.payload)) {
          return { error: { message: "refusing a key" } };
        }
        const list = rows();
        const idKey = name === "kv" ? "key" : "id";
        const idx = list.findIndex(r => r.user_id === row.user_id && r[idKey] === row[idKey]);
        if (idx >= 0) list[idx] = { ...list[idx], ...row };
        else list.push({ ...row });
        return { error: null };
      }
    };
  }

  storedPlaintext() {
    const blobs = [
      JSON.stringify([...this.pairing]),
      JSON.stringify([...this.recovery]),
      JSON.stringify([...this.links]),
      JSON.stringify([...this.items])
    ].join("\n");
    return this.plaintexts.filter(p => blobs.includes(normalizeSyncCode(p.code)));
  }
}

function payloadHasKeySafe(obj) {
  if (!obj || typeof obj !== "object") return false;
  const KEYISH = /^(apiKey|api_key|openai|openaiKey|openai_api_key|key|token|secret|authorization|password)$/i;
  for (const [k, v] of Object.entries(obj)) {
    if (KEYISH.test(k)) return true;
    if (v && typeof v === "object" && payloadHasKeySafe(v)) return true;
  }
  return false;
}

describe("v0.8.0 pairing codes (no email)", () => {
  it("normalizes and formats codes, dropping look-alikes and dashes", () => {
    assert.equal(SYNC_ALPHABET.length, 32);
    assert.equal(SYNC_ALPHABET.includes("0"), false);
    assert.equal(SYNC_ALPHABET.includes("O"), false);
    assert.equal(SYNC_ALPHABET.includes("1"), false);
    assert.equal(SYNC_ALPHABET.includes("I"), false);
    // L is kept so the alphabet is 32 characters (uniform from bytes).
    // 0, O, 1, and I are the look-alikes that are left out and stripped.
    assert.equal(SYNC_ALPHABET.includes("L"), true);
    assert.equal(normalizeSyncCode("ab-cd ef"), "ABCDEF");
    assert.equal(normalizeSyncCode("AB0O1ILCD"), "ABLCD");
    assert.equal(formatSyncCode("abcdefgh"), "ABCD-EFGH");
    // I and O are stripped; L is a real letter and is kept.
    assert.equal(normalizeSyncCode("abcdefghijklmnop"), "ABCDEFGHJKLMNP");
    assert.equal(formatSyncCode("abcdefghijklmnop"), "ABCD-EFGH-JKLM-NP");
    const raw16 = "23456789ABCDEFGH";
    assert.equal(normalizeSyncCode(raw16).length, 16);
    assert.equal(formatSyncCode(raw16), "2345-6789-ABCD-EFGH");
    assert.equal(classifySyncCode("AB-CD-EF-GH"), "pairing");
    assert.equal(classifySyncCode(raw16), "recovery");
    assert.equal(classifySyncCode("short"), null);
    assert.equal(PAIRING_CODE_LENGTH, 8);
    assert.equal(RECOVERY_CODE_LENGTH, 16);
    assert.equal(PAIRING_TTL_MS, 10 * 60 * 1000);
  });

  it("EMAIL_SYNC_ENABLED is off, while email OTP functions still exist", () => {
    assert.equal(EMAIL_SYNC_ENABLED, false);
    assert.equal(CFG_EMAIL, false);
    assert.equal(typeof requestSignInCode, "function");
    assert.equal(typeof verifySignInCode, "function");
  });

  it("turns on sync on the first device, shows a recovery code once, and does not return it again", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const storage = mem();
    const first = await turnOnSync({ sb: phone, storage });
    assert.equal(first.ok, true);
    assert.equal(first.isNew, true);
    assert.equal(classifySyncCode(first.recoveryCode), "recovery");
    const pending = loadPendingRecovery(storage);
    assert.equal(normalizeSyncCode(pending.code), normalizeSyncCode(first.recoveryCode));
    const second = await turnOnSync({ sb: phone, storage });
    assert.equal(second.isNew, false);
    assert.equal(second.recoveryCode, null);
    assert.equal(second.ownerId, first.ownerId);
    // The table stores only a hash, never the plaintext.
    assert.equal(world.storedPlaintext().length, 0);
    assert.equal(world.recovery[0].code_hash, sha256hex(normalizeSyncCode(first.recoveryCode)));
    assert.ok(!JSON.stringify(world.recovery).includes(normalizeSyncCode(first.recoveryCode)));
  });

  it("pairs a second device with an 8-character code and shares items, without calling ensure_sync_owner on the join path", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const computer = world.client();
    const aStore = memStore([{ id: "mug", title: "Phone mug", updatedAt: 10, createdAt: 10, photos: [] }]);
    const bStore = memStore([{ id: "hat", title: "Computer hat", updatedAt: 20, createdAt: 20, photos: [] }]);

    const a = await turnOnSync({ sb: phone, storage: mem() });
    const pairing = await createPairingCode({ sb: phone });
    assert.equal(classifySyncCode(pairing.code), "pairing");
    assert.match(pairing.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);

    world.rpcLog.length = 0;
    const b = await joinWithCode(pairing.code, { sb: computer, storage: mem() });
    assert.equal(b.ok, true);
    assert.equal(b.kind, "pairing");
    assert.equal(b.ownerId, a.ownerId);
    assert.ok(!world.rpcLog.some(c => c.name === "ensure_sync_owner"), "join must not create a second owner");
    assert.ok(world.rpcLog.some(c => c.name === "redeem_pairing_code"));

    const r1 = await runSync({ store: aStore, sb: phone, storage: mem() });
    const r2 = await runSync({ store: bStore, sb: computer, storage: mem() });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    const r3 = await runSync({ store: aStore, sb: phone, storage: mem() });
    assert.equal(r3.ok, true);
    const aIds = (await aStore.all()).map(i => i.id).sort();
    const bIds = (await bStore.all()).map(i => i.id).sort();
    assert.deepEqual(aIds, ["hat", "mug"]);
    assert.deepEqual(bIds, ["hat", "mug"]);
    assert.equal((await aStore.get("hat")).title, "Computer hat");
    assert.equal((await bStore.get("mug")).title, "Phone mug");
    // Both upserts used the shared owner, not the auth uid.
    assert.ok(world.items.every(row => row.user_id === a.ownerId));
    assert.ok(world.items.every(row => row.user_id !== (phone.auth.session && phone.auth.session.user.id) || row.user_id === a.ownerId));
    // A used code cannot be used again.
    const extra = world.client();
    await assert.rejects(() => joinWithCode(pairing.code, { sb: extra, storage: mem() }), /didn't work or it expired/i);
  });

  it("rejects a wrong code with a generic error, then rate-limits after 8 guesses", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    await turnOnSync({ sb: phone, storage: mem() });
    await createPairingCode({ sb: phone });
    const other = world.client();
    // One shared anonymous session on `other`, then many wrong guesses.
    await signInAnonymously({ sb: other });
    for (let i = 0; i < 8; i++) {
      await assert.rejects(() => joinWithCode("2222-2222", { sb: other, storage: mem() }), /didn't work or it expired/i);
    }
    await assert.rejects(() => joinWithCode("2222-2222", { sb: other, storage: mem() }), /wait a few minutes/i);
    // Already-signed-in session: joinWithCode will reuse it (signInAnonymously is New=false).
  });

  it("lets a new device recover with the 16-character code after both devices are gone", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const first = await turnOnSync({ sb: phone, storage: mem() });
    const store = memStore([{ id: "lamp", title: "Lamp", updatedAt: 5, createdAt: 5, photos: [] }]);
    const pushed = await runSync({ store, sb: phone, storage: mem() });
    assert.equal(pushed.ok, true);
    await turnOffSyncOnThisDevice({ sb: phone, storage: mem() });

    const replacement = world.client();
    world.rpcLog.length = 0;
    const joined = await joinWithCode(first.recoveryCode, { sb: replacement, storage: mem() });
    assert.equal(joined.kind, "recovery");
    assert.equal(joined.ownerId, first.ownerId);
    assert.ok(!world.rpcLog.some(c => c.name === "ensure_sync_owner"));
    const fresh = memStore([]);
    const pulled = await runSync({ store: fresh, sb: replacement, storage: mem() });
    assert.equal(pulled.ok, true);
    assert.equal((await fresh.all()).length, 1);
    assert.equal((await fresh.all())[0].title, "Lamp");
  });

  it("rotates the recovery code (old one stops working) and re-links a revoked device", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const first = await turnOnSync({ sb: phone, storage: mem() });
    const rotated = await rotateRecoveryCode({ sb: phone, storage: mem() });
    assert.equal(classifySyncCode(rotated.recoveryCode), "recovery");
    assert.notEqual(normalizeSyncCode(rotated.recoveryCode), normalizeSyncCode(first.recoveryCode));

    const lost = world.client();
    await assert.rejects(() => joinWithCode(first.recoveryCode, { sb: lost, storage: mem() }), /didn't work/i);
    const ok = await joinWithCode(rotated.recoveryCode, { sb: lost, storage: mem() });
    assert.equal(ok.ownerId, first.ownerId);

    // Revoke the second device, then re-link with a pairing code (upsert, not a second owner).
    await turnOffSyncOnThisDevice({ sb: lost, storage: mem() });
    const pairing = await createPairingCode({ sb: phone });
    const again = await joinWithCode(pairing.code, { sb: lost, storage: mem() });
    assert.equal(again.ownerId, first.ownerId);
    const active = [...world.links.values()].filter(l => !l.revoked_at && l.owner_id === first.ownerId);
    assert.equal(active.length, 2);
  });

  it("never upserts an OpenAI key, and uses the owner id on the photo path", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const a = await turnOnSync({ sb: phone, storage: mem() });
    const store = memStore([{
      id: "x", title: "Hat", updatedAt: 1, createdAt: 1,
      apiKey: "sk-this-must-never-leave",
      photos: []
    }]);
    const r = await runSync({ store, sb: phone, storage: mem() });
    assert.equal(r.ok, true);
    assert.ok(world.items.length >= 1);
    const blob = JSON.stringify(world.items);
    assert.equal(blob.includes("sk-this-must-never-leave"), false);
    assert.equal(blob.includes("apiKey"), false);
    const { cloudPhotoPath } = await import("../../app/js/core/sync.js");
    assert.equal(cloudPhotoPath(a.ownerId, "x", "ph_a"), `${a.ownerId}/x/ph_a.jpg`);
  });

  it("treats anonymous-disabled and missing RPCs as a kind not-ready state", async () => {
    assert.equal(isSyncNotReadyError({ message: "Anonymous sign-ins are disabled" }), true);
    assert.equal(isSyncNotReadyError({ code: "PGRST202", message: "could not find the function ensure_sync_owner" }), true);
    assert.equal(friendlySyncError({ message: "Anonymous sign-ins are disabled" }), SYNC_NOT_READY_MSG);
    const world = new FakeWorld({ anonymousEnabled: false });
    const phone = world.client();
    await assert.rejects(() => turnOnSync({ sb: phone, storage: mem() }), /Sync isn't ready yet/);
  });

  it("does not wipe local items when the other device has a different set", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const computer = world.client();
    await turnOnSync({ sb: phone, storage: mem() });
    const code = await createPairingCode({ sb: phone });
    await joinWithCode(code.code, { sb: computer, storage: mem() });
    const aStore = memStore([{ id: "only-phone", title: "Phone only", updatedAt: 1, createdAt: 1, photos: [] }]);
    const bStore = memStore([{ id: "only-comp", title: "Comp only", updatedAt: 2, createdAt: 2, photos: [] }]);
    await runSync({ store: aStore, sb: phone, storage: mem() });
    await runSync({ store: bStore, sb: computer, storage: mem() });
    await runSync({ store: aStore, sb: phone, storage: mem() });
    assert.equal((await aStore.all()).length, 2);
    assert.equal((await bStore.all()).length, 2);
    // Original titles survive.
    assert.equal((await aStore.get("only-phone")).title, "Phone only");
    assert.equal((await bStore.get("only-comp")).title, "Comp only");
  });
});

describe("v0.8.0 sync UI copy (pairing, no email form)", () => {
  it("shows two big buttons, a once-only recovery code, and no email field", () => {
    const off = offCardHtml();
    assert.match(off, /Turn on sync/);
    assert.match(off, /I have a code/);
    assert.match(off, /first device/);
    assert.doesNotMatch(off, /<input[^>]*type="email"/i);
    assert.doesNotMatch(off, /6-digit/);
    const rec = recoveryCardHtml("2345-6789-ABCD-EFGH");
    assert.match(rec, /2345-6789-ABCD-EFGH/);
    assert.match(rec, /Save a copy/);
    assert.match(rec, /Print/);
    assert.match(rec, /I saved it/);
    assert.match(rec, /only see it/i);
    const enter = enterCodeHtml();
    assert.match(enter, /8-character/);
    assert.match(enter, /16-character recovery/);
    assert.match(enter, /Connect/);
    const pair = pairingCodeHtml("ABCD-EFGH", Date.now() + 9 * 60 * 1000, Date.now());
    assert.match(pair, /ABCD-EFGH/);
    assert.match(pair, /I have a code/);
    assert.match(countdownLabel(Date.now() + 90 * 1000, Date.now()), /1:30/);
    assert.match(countdownLabel(Date.now() - 1000, Date.now()), /expired/);
    const on = signedInCardHtml({ lastLabel: "Last synced just now." });
    assert.match(on, /This device is synced/);
    assert.match(on, /Connect another device/);
    assert.match(on, /Turn off sync on this device/);
    assert.match(on, /Get a new recovery code/);
    const shell = syncCardShell();
    assert.match(shell, /id="synccard"/);
    assert.match(shell, /Sync with my computer/);
    const txt = recoveryDownloadText("23456789ABCDEFGH");
    assert.match(txt, /2345-6789-ABCD-EFGH/);
    assert.match(txt, /I have a code/);
    assert.doesNotMatch(txt, /Nootbaar|KennethNootbaar6|sk-proj-/);
    const print = recoveryPrintHtml("23456789ABCDEFGH");
    assert.match(print, /2345-6789-ABCD-EFGH/);
    assert.doesNotMatch(off + rec + enter + pair + on + txt + print, /type="email"/i);
  });

  it("keeps email OTP out of the Settings card and documents the dashboard toggle", () => {
    const settings = readFileSync(join(root, "app/js/ui/screens/settings.js"), "utf8");
    assert.match(settings, /syncCardShell/);
    assert.match(settings, /bindSyncCard/);
    // Existing cards are still there, in the same order around the new one.
    assert.match(settings, /id="keycard"/);
    assert.match(settings, /id="pausecard"/);
    const keyAt = settings.indexOf('id="keycard"');
    const syncAt = settings.indexOf("syncCardShell()");
    const pauseAt = settings.indexOf('id="pausecard"');
    assert.ok(keyAt < syncAt && syncAt < pauseAt);
    const ui = readFileSync(join(root, "app/js/ui/syncui.js"), "utf8");
    assert.match(ui, /EMAIL_SYNC_ENABLED/);
    assert.doesNotMatch(ui, /requestSignInCode/);
    const cfg = readFileSync(join(root, "app/js/core/sync-config.js"), "utf8");
    assert.match(cfg, /EMAIL_SYNC_ENABLED = false/);
  });
});

describe("v0.8.0 version and service worker", () => {
  it("bumps the app to 0.9.0 and caches the sync modules", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "0.9.0");
    const main = readFileSync(join(root, "app/js/main.js"), "utf8");
    assert.match(main, /export const VERSION = "0\.9\.0"/);
    assert.match(main, /queueSync/);
    const sw = readFileSync(join(root, "app/sw.js"), "utf8");
    assert.match(sw, /flip-helper-v0\.9\.0/);
    assert.match(sw, /js\/core\/sync\.js/);
    assert.match(sw, /js\/core\/sync-config\.js/);
    assert.match(sw, /js\/ui\/syncui\.js/);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(readme, /0\.9\.0/);
    assert.match(readme, /Sync with my computer/);
    assert.match(readme, /8-character/);
    assert.match(readme, /recovery code/);
    assert.match(readme, /never uploaded/);
  });
});

describe("v0.8.0 delete is a tombstone", () => {
  it("a delete is a tombstone, so the other device drops the item instead of it coming back", async () => {
    const world = new FakeWorld();
    const phone = world.client();
    const computer = world.client();
    await turnOnSync({ sb: phone, storage: mem() });
    const code = await createPairingCode({ sb: phone });
    await joinWithCode(code.code, { sb: computer, storage: mem() });
    const aStore = memStore([{ id: "mug", title: "Mug", updatedAt: 10, createdAt: 10, photos: [] }]);
    const phoneMem = mem();
    await runSync({ store: aStore, sb: phone, storage: phoneMem });
    const bStore = memStore([]);
    const compMem = mem();
    await runSync({ store: bStore, sb: computer, storage: compMem });
    assert.equal((await bStore.get("mug")).title, "Mug");

    // This is what ctx.remove now does: tombstone, then drop locally, then sync.
    const { noteLocalChange } = await import("../../app/js/core/sync.js");
    await noteLocalChange({ kind: "item", id: "mug", action: "delete", at: 50, auto: false }, { storage: phoneMem });
    await aStore.remove("mug");
    const r = await runSync({ store: aStore, sb: phone, storage: phoneMem });
    assert.equal(r.ok, true);
    assert.ok(world.items.some(row => row.id === "mug" && row.deleted_at));

    const r2 = await runSync({ store: bStore, sb: computer, storage: compMem });
    assert.equal(r2.ok, true);
    assert.equal(await bStore.get("mug"), null);
    assert.equal((await bStore.all()).length, 0);
  });
});
