// Local-first sync: the device store is the source of truth. A background
// queue talks to Supabase when she is signed in. Last-write-wins per item
// (updated_at). Deletions are tombstones. First sign-in uploads what's
// already here and merges — it never wipes. The AI key is never uploaded.

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS, PHOTOS_BUCKET, SYNC_CLOUD_EDGE, SYNC_JPEG_QUALITY, EMAIL_SYNC_ENABLED } from "./sync-config.js";
import { normalizeItem } from "./inventory.js";
import { normalizeScan } from "./secondlook.js";
import { downscaleDataUrl } from "./draft.js";

export const SYNC_NOT_READY_MSG = "Sync isn't ready yet. Your items are still safe on this device.";
export const KEY_STAYS_NOTE = "The AI key stays on each device and is never uploaded. If you want drafts on this computer, paste the key in Settings here too.";
export const SYNC_STEPS = [
  "On this device, tap Turn on sync. That's the first device.",
  "Write down the recovery code, or save a copy. That's how you get your items back if you lose this phone. You'll only see it once.",
  "On the other device, tap I have a code, and type the 8-character code from this device.",
  "Your items, photos, scans, listings, and statuses will show up on both. What's already here is uploaded and merged. Nothing is wiped.",
  "The AI key stays on each device and is never uploaded."
];

export const SYNC_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 8;
export const RECOVERY_CODE_LENGTH = 16;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PENDING_RECOVERY_KEY = "flip-helper.sync.pendingRecovery";
export { EMAIL_SYNC_ENABLED };

export const QUEUE_KEY = "flip-helper.sync.queue";
export const TOMBSTONE_KEY = "flip-helper.sync.tombstones";
export const STATUS_KEY = "flip-helper.sync.status";

const KEYISH = /^(apiKey|api_key|openai|openaiKey|openai_api_key|key|token|secret|authorization|password)$/i;

export function isSyncNotReadyError(err) {
  if (!err) return false;
  const code = String(err.code || err.status || err.statusCode || "");
  const msg = String(err.message || err.error_description || err.details || err.hint || err);
  const blob = (code + " " + msg).toLowerCase();
  if (code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "404") return true;
  return /42p01|pgrst205|pgrst202|does not exist|relation .* does not exist|could not find the table|could not find the function|schema cache|not found|bucket.*(not|missing)|no such table|sync isn't ready|anonymous.*disabled|captcha required/i.test(blob);
}

export function friendlySyncError(err) {
  if (isSyncNotReadyError(err)) return SYNC_NOT_READY_MSG;
  const msg = String((err && (err.message || err.error_description)) || err || "");
  if (/failed to fetch|network|offline|load failed/i.test(msg)) {
    return "You're offline. We'll sync when you're back online.";
  }
  if (/anonymous.*disabled|sign-?ins are disabled|captcha/i.test(msg)) {
    return SYNC_NOT_READY_MSG;
  }
  if (/didn't work or it expired|recovery code didn't work/i.test(msg)) {
    return /recovery/i.test(msg)
      ? "That recovery code didn't work. Check it and try again."
      : "That code didn't work or it expired. Ask the other device for a new one.";
  }
  if (/already synced/i.test(msg)) {
    return "This device is already synced. Turn off sync on this device first if you want to connect it to a different one.";
  }
  if (/maximum number of devices/i.test(msg)) {
    return "This account already has the maximum number of devices. Turn off sync on one you no longer use, then try again.";
  }
  if (/wait a few minutes|rate|too many/i.test(msg)) {
    return "Please wait a few minutes and try again.";
  }
  if (/invalid|expired|otp|token/i.test(msg) && /otp|token|code|email/i.test(msg)) {
    return "That code didn't work. Check the 6 digits, or send a new code. Codes expire after about an hour.";
  }
  if (/invalid.*email|valid email/i.test(msg)) {
    return "Please enter a real email address.";
  }
  return msg || "Sync couldn't finish. Your items are still safe on this device.";
}

/** Last-write-wins. Equal timestamps keep the local copy (don't stomp). Tombstones included. */
export function recordTime(row) {
  if (!row) return 0;
  const del = row.deletedAt || row.deleted_at || 0;
  const upd = row.updatedAt || row.updated_at || 0;
  const cr = row.createdAt || row.created_at || 0;
  const t = n => {
    if (!n) return 0;
    if (typeof n === "number" && Number.isFinite(n)) return n;
    const p = Date.parse(n);
    return Number.isFinite(p) ? p : 0;
  };
  return Math.max(t(del), t(upd), t(cr));
}

export function pickWinner(local, remote) {
  if (!local && !remote) return { winner: null, source: "none" };
  if (!local) return { winner: remote, source: "remote" };
  if (!remote) return { winner: local, source: "local" };
  const lt = recordTime(local);
  const rt = recordTime(remote);
  if (lt > rt) return { winner: local, source: "local" };
  if (rt > lt) return { winner: remote, source: "remote" };
  return { winner: local, source: "local" };
}

/**
 * Merge two lists of records by id. Returns { next, push, pull, tombstones }.
 * `next` is the merged local list (without records whose winner is a tombstone).
 * `push` should be uploaded. `pull` are remote winners to apply locally
 * (including tombstones, so the caller can delete). Never wipes either side.
 */
export function mergeRecords(localList = [], remoteList = [], { idKey = "id" } = {}) {
  const locals = new Map();
  for (const r of localList || []) {
    if (r && r[idKey]) locals.set(String(r[idKey]), r);
  }
  const remotes = new Map();
  for (const r of remoteList || []) {
    if (r && r[idKey]) remotes.set(String(r[idKey]), r);
  }
  const ids = new Set([...locals.keys(), ...remotes.keys()]);
  const next = [];
  const push = [];
  const pull = [];
  const tombstones = [];
  for (const id of ids) {
    const local = locals.get(id) || null;
    const remote = remotes.get(id) || null;
    const { winner, source } = pickWinner(local, remote);
    if (!winner) continue;
    const dead = !!(winner.deletedAt || winner.deleted_at);
    if (dead) {
      tombstones.push(winner);
      if (source === "local" && (!remote || recordTime(local) > recordTime(remote))) push.push(winner);
      if (source === "remote") pull.push(winner);
      continue;
    }
    next.push(winner);
    if (source === "local" && (!remote || recordTime(local) > recordTime(remote))) push.push(winner);
    if (source === "remote") pull.push(winner);
  }
  return { next, push, pull, tombstones };
}

function stripKeyish(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripKeyish);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (KEYISH.test(k)) continue;
    if (/dataUrl|data_url|thumbDataUrl|coverThumb/i.test(k) && typeof v === "string" && v.startsWith("data:")) {
      continue;
    }
    out[k] = (v && typeof v === "object") ? stripKeyish(v) : v;
  }
  return out;
}

export function newPhotoId(at = Date.now()) {
  return "ph_" + at.toString(36) + Math.random().toString(36).slice(2, 8);
}

export function ensurePhotoIds(item, at = Date.now()) {
  if (!item || typeof item !== "object") return item;
  const photos = (item.photos || []).map((p, i) => {
    if (!p || typeof p !== "object") return p;
    return { ...p, id: p.id || newPhotoId(at + i) };
  });
  const receipts = (item.receipts || []).map((r, i) => {
    if (!r || typeof r !== "object") return r;
    return { ...r, id: r.id || ("rc_" + (at + i).toString(36)) };
  });
  return { ...item, photos, receipts };
}

/** Cloud payload: item fields minus image bytes and any key-like field. */
export function itemToCloudPayload(item) {
  const src = ensurePhotoIds(item || {});
  const photos = (src.photos || []).map(p => ({
    id: p.id,
    path: p.cloudPath || null,
    originalPath: p.cloudOriginalPath || null,
    cleaned: p.cleaned || null,
    cleanedAt: p.cleanedAt || null,
    addedAt: p.addedAt || 0,
    hash: p.cloudHash || null
  }));
  const receipts = (src.receipts || []).map(r => ({
    id: r.id,
    path: r.cloudPath || null,
    addedAt: r.addedAt || 0,
    note: r.note || ""
  }));
  const { photos: _p, receipts: _r, ...rest } = src;
  const payload = stripKeyish({ ...rest, photos, receipts });
  return payload;
}

export function scanToCloudPayload(scan) {
  const src = scan || {};
  const items = (src.items || []).map(it => {
    const closeup = (it.closeupPhotos || []).map(p => ({
      id: p.id || "",
      path: p.cloudPath || null,
      addedAt: p.addedAt || 0,
      hash: p.cloudHash || null
    }));
    const { thumbDataUrl, closeupPhotos, ...rest } = it;
    return stripKeyish({
      ...rest,
      thumbPath: it.thumbPath || it.cloudThumbPath || null,
      closeupPhotos: closeup
    });
  });
  const { items: _i, coverThumb, ...rest } = src;
  return stripKeyish({ ...rest, items, coverPath: src.coverPath || null });
}

export function payloadHasKey(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return false;
  for (const [k, v] of Object.entries(obj)) {
    if (KEYISH.test(k)) return true;
    // Real OpenAI keys are long tokens after "sk-". A casual "sk-ish" note
    // in a listing must not look like a key and block a sync.
    if (typeof v === "string" && /^sk-[A-Za-z0-9_-]{16,}$/.test(v.trim())) return true;
    if (v && typeof v === "object" && payloadHasKey(v, depth + 1)) return true;
  }
  return false;
}

export function cloudPhotoPath(userId, itemId, photoId, kind = "photo") {
  const uid = String(userId);
  const iid = String(itemId || "item");
  const pid = String(photoId || newPhotoId());
  if (kind === "scan") return `${uid}/scans/${iid}/${pid}.jpg`;
  if (kind === "receipt") return `${uid}/${iid}/receipts/${pid}.jpg`;
  if (kind === "original") return `${uid}/${iid}/${pid}-original.jpg`;
  return `${uid}/${iid}/${pid}.jpg`;
}

export function photoHash(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  const n = dataUrl.length;
  return n + ":" + dataUrl.slice(0, 24) + ":" + dataUrl.slice(-16);
}

// ----- queue & tombstones (injectable storage for tests) -----

function ls(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

function readJson(storage, key, fallback) {
  const s = ls(storage);
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}

function writeJson(storage, key, value) {
  const s = ls(storage);
  if (!s) return;
  try { s.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
}

export function loadQueue(storage) {
  const arr = readJson(storage, QUEUE_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

export function saveQueue(queue, storage) {
  writeJson(storage, QUEUE_KEY, Array.isArray(queue) ? queue : []);
  return loadQueue(storage);
}

export function enqueue(op, storage, at = Date.now()) {
  const queue = loadQueue(storage);
  const row = { ...op, at: op.at || at, id: op.id, kind: op.kind, action: op.action };
  // Replace an older pending op on the same record.
  const next = queue.filter(q => !(q.kind === row.kind && q.id === row.id && q.action === row.action));
  next.push(row);
  return saveQueue(next, storage);
}

export function loadTombstones(storage) {
  const arr = readJson(storage, TOMBSTONE_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

export function saveTombstones(list, storage) {
  writeJson(storage, TOMBSTONE_KEY, Array.isArray(list) ? list : []);
  return loadTombstones(storage);
}

export function addTombstone({ id, kind = "item", at = Date.now() }, storage) {
  const list = loadTombstones(storage).filter(t => !(t.id === id && t.kind === kind));
  list.push({ id, kind, deletedAt: at, updatedAt: at });
  return saveTombstones(list, storage);
}

export function loadSyncStatus(storage) {
  const raw = readJson(storage, STATUS_KEY, null) || {};
  return {
    lastSyncAt: raw.lastSyncAt || null,
    lastError: raw.lastError || "",
    notReady: !!raw.notReady,
    ownerId: raw.ownerId || null,
    state: raw.state || "idle" // idle | syncing | synced | error | not-ready | offline | signed-out | signed-in
  };
}

export function saveSyncStatus(partial, storage) {
  const next = { ...loadSyncStatus(storage), ...partial };
  writeJson(storage, STATUS_KEY, next);
  return next;
}

export function syncStatusLabel(status, { signedIn = false } = {}) {
  if (!signedIn) return "";
  const s = status || {};
  if (s.notReady || s.state === "not-ready") return "Sync isn't ready yet";
  if (s.state === "syncing") return "Syncing…";
  if (s.state === "offline") return "Will sync when you're back online";
  if (s.state === "error") return s.lastError ? "Couldn't sync — items are safe here" : "Couldn't sync";
  if (s.state === "synced" || s.lastSyncAt) return "Synced";
  return "Signed in";
}

// ----- supabase client (lazy, injectable) -----

let clientImpl = null;
let clientPromise = null;

export function setSupabaseClient(client) {
  clientImpl = client;
  clientPromise = client ? Promise.resolve(client) : null;
}

export function resetSupabaseClient() {
  clientImpl = null;
  clientPromise = null;
}

export async function getSupabase({ createClient, fetchImpl } = {}) {
  if (clientImpl) return clientImpl;
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const factory = createClient || (await loadSupabaseLib()).createClient;
    const client = factory(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // we use a typed 6-digit code, not a magic-link redirect
        storage: typeof localStorage !== "undefined" ? localStorage : undefined
      },
      global: fetchImpl ? { fetch: fetchImpl } : undefined
    });
    clientImpl = client;
    return client;
  })();
  try {
    return await clientPromise;
  } catch (err) {
    clientPromise = null;
    throw err;
  }
}

async function loadSupabaseLib() {
  return import(SUPABASE_JS);
}

export async function getSession(sb) {
  const client = sb || await getSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return (data && data.session) || null;
}

export async function currentUser(sb) {
  const session = await getSession(sb);
  return session && session.user ? session.user : null;
}

/** Send a 6-digit email code. Not a magic link (the dashboard template must use {{ .Token }}). */

function asError(err) {
  if (err instanceof Error) return err;
  const e = new Error(friendlySyncError(err) || (err && err.message) || "Something went wrong.");
  if (err && err.code) e.code = err.code;
  e.cause = err;
  return e;
}

export async function requestSignInCode(email, { sb, shouldCreateUser = true } = {}) {
  const address = String(email || "").trim().toLowerCase();
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    const err = new Error("Please enter a real email address.");
    err.code = "bad-email";
    throw err;
  }
  const client = sb || await getSupabase();
  const { data, error } = await client.auth.signInWithOtp({
    email: address,
    options: {
      shouldCreateUser,
      // Deliberately no emailRedirectTo: we do not want a magic-link flow.
    }
  });
  if (error) throw asError(error);
  return { ok: true, email: address, data };
}

export async function verifySignInCode(email, token, { sb } = {}) {
  const address = String(email || "").trim().toLowerCase();
  const code = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) {
    const err = new Error("Please enter the 6-digit code from your email.");
    err.code = "bad-code";
    throw err;
  }
  const client = sb || await getSupabase();
  const { data, error } = await client.auth.verifyOtp({
    email: address,
    token: code,
    type: "email"
  });
  if (error) throw asError(error);
  return { ok: true, session: data && data.session, user: data && data.user };
}

export async function signOut({ sb } = {}) {
  const client = sb || await getSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  saveSyncStatus({ state: "signed-out", lastError: "", notReady: false });
}


/** Strip dashes and look-alikes; uppercase. Matches normalize_sync_code in SQL. */
export function normalizeSyncCode(raw) {
  return String(raw == null ? "" : raw)
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, "");
}

export function formatSyncCode(raw) {
  const s = normalizeSyncCode(raw);
  return (s.match(/.{1,4}/g) || []).join("-");
}

export function classifySyncCode(raw) {
  const s = normalizeSyncCode(raw);
  if (s.length === PAIRING_CODE_LENGTH) return "pairing";
  if (s.length === RECOVERY_CODE_LENGTH) return "recovery";
  return null;
}

export function isValidPairingCode(raw) {
  return classifySyncCode(raw) === "pairing";
}

export function isValidRecoveryCode(raw) {
  return classifySyncCode(raw) === "recovery";
}

export function loadPendingRecovery(storage) {
  const v = readJson(storage, PENDING_RECOVERY_KEY, null);
  return v && v.code ? v : null;
}

export function clearPendingRecovery(storage) {
  const s = ls(storage);
  if (!s) return;
  try { s.removeItem(PENDING_RECOVERY_KEY); } catch (e) { /* quota */ }
}

function rememberRecovery(code, storage, extra = {}) {
  if (!code) return;
  writeJson(storage, PENDING_RECOVERY_KEY, { code, at: Date.now(), ...extra });
}

function classifyAuthError(error) {
  const msg = String((error && (error.message || error.error_description)) || error || "");
  if (/anonymous.*disabled|sign-?ins are disabled|captcha/i.test(msg)) {
    const err = new Error(SYNC_NOT_READY_MSG);
    err.code = "not-ready";
    err.cause = error;
    return err;
  }
  return asError(error);
}

/** Sign in anonymously, or reuse a session that is already here. */
export async function signInAnonymously({ sb } = {}) {
  const client = sb || await getSupabase();
  const existing = await currentUser(client);
  if (existing) return { ok: true, user: existing, isNew: false };
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw classifyAuthError(error);
  return { ok: true, user: data && data.user, session: data && data.session, isNew: true };
}

/**
 * First device: anonymous session + a new owner, and a recovery code
 * returned only this once. The plaintext is also stored on this device
 * until she taps "I saved it," so a refresh doesn't lose it.
 */
export async function turnOnSync({ sb, storage } = {}) {
  const client = sb || await getSupabase();
  await signInAnonymously({ sb: client });
  const { data, error } = await client.rpc("ensure_sync_owner");
  if (error) throw classifyAuthError(error);
  const row = data && typeof data === "object" ? data : {};
  const ownerId = row.owner_id || null;
  saveSyncStatus({ state: row.is_new ? "signed-in" : "synced", ownerId, lastError: "", notReady: false }, storage);
  if (row.recovery_code) rememberRecovery(row.recovery_code, storage, { ownerId, isNew: true });
  return { ok: true, ownerId, isNew: !!row.is_new, recoveryCode: row.recovery_code || null };
}

/** Ask the server for a fresh 8-character one-time code (about 10 minutes). */
export async function createPairingCode({ sb } = {}) {
  const client = sb || await getSupabase();
  const { data, error } = await client.rpc("create_pairing_code");
  if (error) throw classifyAuthError(error);
  const row = data && typeof data === "object" ? data : {};
  return {
    ok: true,
    code: formatSyncCode(row.code || ""),
    expiresAt: row.expires_at || null
  };
}

/**
 * Second device (or a replacement after a loss): type the 8-character
 * pairing code or the 16-character recovery code. Signs in anonymously
 * first, then links this auth user to the same owner.
 */

/** RPCs that log a guess return {ok:false,error,code} instead of raising,
 *  so the log row commits. Treat that as an error for the rest of the app. */
function throwIfRpcFailed(data, error) {
  if (error) throw classifyAuthError(error);
  if (data && typeof data === "object" && data.ok === false) {
    const err = new Error(data.error || "Sync couldn't finish. Your items are still safe on this device.");
    err.code = data.code || "P0001";
    throw classifyAuthError(err);
  }
  return data && typeof data === "object" ? data : {};
}

export async function joinWithCode(rawCode, { sb, storage } = {}) {
  const kind = classifySyncCode(rawCode);
  if (!kind) {
    const err = new Error("Type the 8-character code from your other device, or your 16-character recovery code.");
    err.code = "bad-code";
    throw err;
  }
  const client = sb || await getSupabase();
  await signInAnonymously({ sb: client });
  // If this device just got a brand-new anonymous session, do not call
  // ensure_sync_owner — that would create a second, empty account.
  const rpc = kind === "recovery" ? "redeem_recovery_code" : "redeem_pairing_code";
  const { data, error } = await client.rpc(rpc, { p_code: normalizeSyncCode(rawCode) });
  const row = throwIfRpcFailed(data, error);
  const ownerId = row.owner_id || null;
  saveSyncStatus({ state: "signed-in", ownerId, lastError: "", notReady: false }, storage);
  return { ok: true, ownerId, kind, alreadyLinked: !!row.already_linked };
}

export async function rotateRecoveryCode({ sb, storage } = {}) {
  const client = sb || await getSupabase();
  const { data, error } = await client.rpc("rotate_recovery_code");
  if (error) throw classifyAuthError(error);
  const row = data && typeof data === "object" ? data : {};
  if (row.recovery_code) rememberRecovery(row.recovery_code, storage, { rotated: true });
  return { ok: true, recoveryCode: row.recovery_code || null };
}

/** Sign out on this device only. Other devices and the cloud data stay. */
export async function turnOffSyncOnThisDevice({ sb, storage } = {}) {
  const client = sb || await getSupabase();
  if (client && typeof client.rpc === "function") {
    try { await client.rpc("revoke_this_device"); } catch (e) { /* still sign out */ }
  }
  try { await signOut({ sb: client }); } catch (e) { /* local sign-out still happens */ }
  saveSyncStatus({ state: "signed-out", ownerId: null, lastError: "", notReady: false }, storage);
  clearPendingRecovery(storage);
  return { ok: true };
}

export async function resolveOwnerId(client, deps = {}, user = null) {
  if (deps && deps.ownerId) return deps.ownerId;
  if (user && user.ownerId) return user.ownerId;
  if (client && typeof client.rpc === "function") {
    try {
      const { data, error } = await client.rpc("current_owner_id");
      if (!error) {
        const id = typeof data === "string" ? data
          : (data && (data.owner_id || data.id)) || null;
        if (id) return id;
      } else if (isSyncNotReadyError(error)) {
        throw error;
      }
    } catch (e) {
      if (isSyncNotReadyError(e)) throw e;
    }
  }
  return (user && user.id) || null;
}

export async function compressForCloud(dataUrl, { maxEdge = SYNC_CLOUD_EDGE, quality = SYNC_JPEG_QUALITY, downscale = downscaleDataUrl } = {}) {
  if (!dataUrl) return "";
  if (typeof downscale !== "function") return dataUrl;
  return downscale(dataUrl, maxEdge, quality);
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) throw new Error("That photo couldn't be prepared for sync.");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || "image/jpeg" });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("That photo couldn't be read back."));
    r.readAsDataURL(blob);
  });
}

async function uploadPhoto(client, userId, itemId, photo, { kind = "photo", dataUrl } = {}) {
  const bytes = dataUrl || photo.dataUrl;
  if (!bytes) return photo;
  const hash = photoHash(bytes);
  if (photo.cloudPath && photo.cloudHash === hash) return photo;
  const compressed = await compressForCloud(bytes);
  const path = photo.cloudPath || cloudPhotoPath(userId, itemId, photo.id || newPhotoId(), kind);
  const blob = dataUrlToBlob(compressed);
  const { error } = await client.storage.from(PHOTOS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600"
  });
  if (error) throw error;
  return { ...photo, cloudPath: path, cloudHash: hash };
}

async function downloadPhoto(client, path) {
  if (!path) return "";
  const { data, error } = await client.storage.from(PHOTOS_BUCKET).download(path);
  if (error) throw error;
  return blobToDataUrl(data);
}

function asRemoteItem(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const deletedAt = row.deleted_at ? Date.parse(row.deleted_at) || row.deleted_at : (payload.deletedAt || null);
  const updatedAt = row.updated_at ? Date.parse(row.updated_at) || Date.parse(String(row.updated_at)) : (payload.updatedAt || 0);
  return {
    ...payload,
    id: row.id,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : payload.updatedAt,
    createdAt: payload.createdAt || (row.created_at ? Date.parse(row.created_at) : undefined),
    deletedAt: deletedAt || null
  };
}

function asRemoteScan(row) {
  return asRemoteItem(row);
}

/**
 * Full merge + upload + download. Local store is never wiped.
 * `deps` is injectable for tests (store, scans, supabase, storage).
 */
export async function runSync(deps = {}) {
  const storage = deps.storage;
  saveSyncStatus({ state: "syncing", lastError: "" }, storage);
  try {
    const client = deps.sb || await getSupabase({ createClient: deps.createClient, fetchImpl: deps.fetchImpl });
    const user = deps.user || await currentUser(client);
    if (!user) {
      saveSyncStatus({ state: "signed-out" }, storage);
      return { ok: true, signedIn: false, pushed: 0, pulled: 0 };
    }
    // user_id on a cloud row is the shared owner id, not auth.uid().
    const userId = await resolveOwnerId(client, deps, user);
    if (!userId) {
      const err = new Error("Please turn on sync first.");
      err.code = "not-linked";
      throw err;
    }

    // ----- items -----
    const localItems = deps.localItems || (deps.store ? await deps.store.all() : []);
    const localTombs = loadTombstones(storage).filter(t => t.kind === "item");
    const localForMerge = [
      ...localItems.map(i => ensurePhotoIds(i)),
      ...localTombs.map(t => ({ id: t.id, deletedAt: t.deletedAt, updatedAt: t.updatedAt || t.deletedAt }))
    ];

    const { data: itemRows, error: itemErr } = await client
      .from("items")
      .select("id, payload, updated_at, created_at, deleted_at");
    if (itemErr) throw itemErr;
    const remoteItems = (itemRows || []).map(asRemoteItem);

    const merged = mergeRecords(localForMerge, remoteItems);

    // Upload photos for local winners, then upsert rows.
    let pushed = 0;
    for (const rec of merged.push) {
      if (rec.deletedAt) {
        const { error } = await client.from("items").upsert({
          user_id: userId,
          id: rec.id,
          payload: stripKeyish({ id: rec.id }),
          updated_at: new Date(recordTime(rec)).toISOString(),
          deleted_at: new Date(rec.deletedAt).toISOString()
        });
        if (error) throw error;
        pushed++;
        continue;
      }
      let item = ensurePhotoIds(rec);
      const photos = [];
      for (const p of item.photos || []) {
        photos.push(await uploadPhoto(client, userId, item.id, p, { kind: "photo" }));
      }
      const receipts = [];
      for (const r of item.receipts || []) {
        if (r.dataUrl) receipts.push(await uploadPhoto(client, userId, item.id, r, { kind: "receipt" }));
        else receipts.push(r);
      }
      item = { ...item, photos, receipts };
      const payload = itemToCloudPayload(item);
      if (payloadHasKey(payload)) {
        throw new Error("Refusing to sync: a key was about to leave this device.");
      }
      const { error } = await client.from("items").upsert({
        user_id: userId,
        id: item.id,
        payload,
        updated_at: new Date(item.updatedAt || Date.now()).toISOString(),
        created_at: new Date(item.createdAt || Date.now()).toISOString(),
        deleted_at: null
      });
      if (error) throw error;
      // Persist cloud paths locally so we don't re-upload every time.
      if (deps.store) await deps.store.put(item);
      pushed++;
    }

    // Apply remote winners locally, downloading photos as needed.
    let pulled = 0;
    for (const rec of merged.pull) {
      if (rec.deletedAt) {
        if (deps.store) await deps.store.remove(rec.id);
        addTombstone({ id: rec.id, kind: "item", at: recordTime(rec) }, storage);
        pulled++;
        continue;
      }
      const item = await hydrateItemPhotos(client, rec, deps);
      if (deps.store) {
        const existing = await deps.store.get(item.id);
        // Never wipe extras: put merges by id. If we already have higher-res local pixels
        // for the same hash, keep them (hydrate prefers existing dataUrls).
        await deps.store.put(existing ? { ...item, photos: preferLocalPixels(existing.photos, item.photos) } : item);
      }
      pulled++;
    }

    // ----- scans -----
    let scanPush = 0, scanPull = 0;
    if (deps.loadScans && deps.saveScan) {
      const localScans = (deps.loadScans() || []).map(s => ({ ...s, updatedAt: s.updatedAt || s.createdAt }));
      const scanTombs = loadTombstones(storage).filter(t => t.kind === "scan");
      const { data: scanRows, error: scanErr } = await client
        .from("scans")
        .select("id, payload, updated_at, created_at, deleted_at");
      if (scanErr) throw scanErr;
      const remoteScans = (scanRows || []).map(asRemoteScan);
      const sm = mergeRecords(
        [...localScans, ...scanTombs.map(t => ({ id: t.id, deletedAt: t.deletedAt, updatedAt: t.updatedAt }))],
        remoteScans
      );
      for (const rec of sm.push) {
        const payload = rec.deletedAt ? stripKeyish({ id: rec.id }) : scanToCloudPayload(rec);
        if (payloadHasKey(payload)) throw new Error("Refusing to sync: a key was about to leave this device.");
        const { error } = await client.from("scans").upsert({
          user_id: userId,
          id: rec.id,
          payload,
          updated_at: new Date(recordTime(rec)).toISOString(),
          created_at: new Date(rec.createdAt || Date.now()).toISOString(),
          deleted_at: rec.deletedAt ? new Date(rec.deletedAt).toISOString() : null
        });
        if (error) throw error;
        scanPush++;
      }
      for (const rec of sm.pull) {
        if (rec.deletedAt) {
          if (deps.removeScan) deps.removeScan(rec.id);
          addTombstone({ id: rec.id, kind: "scan", at: recordTime(rec) }, storage);
        } else if (deps.saveScan) {
          deps.saveScan(hydrateScanShallow(rec));
        }
        scanPull++;
      }
    }

    // ----- kv: settings & prefs (never a key) -----
    if (deps.getKv && deps.setKv) {
      await syncKv(client, userId, deps, storage);
    }

    saveQueue([], storage);
    saveSyncStatus({
      state: "synced",
      lastSyncAt: Date.now(),
      lastError: "",
      notReady: false
    }, storage);
    return {
      ok: true,
      signedIn: true,
      pushed,
      pulled,
      scanPush,
      scanPull,
      merged: merged.next.length
    };
  } catch (err) {
    if (isSyncNotReadyError(err)) {
      saveSyncStatus({ state: "not-ready", notReady: true, lastError: SYNC_NOT_READY_MSG }, storage);
      return { ok: false, notReady: true, message: SYNC_NOT_READY_MSG };
    }
    const message = friendlySyncError(err);
    const offline = /offline|network|failed to fetch/i.test(message);
    saveSyncStatus({ state: offline ? "offline" : "error", lastError: message, notReady: false }, storage);
    return { ok: false, message, error: err && err.message };
  }
}

async function hydrateItemPhotos(client, rec, deps) {
  const photos = [];
  for (const p of rec.photos || []) {
    if (p.dataUrl) { photos.push(p); continue; }
    if (!p.path && !p.cloudPath) { photos.push(p); continue; }
    const path = p.path || p.cloudPath;
    try {
      const dataUrl = await downloadPhoto(client, path);
      let originalDataUrl = p.originalDataUrl || null;
      if (p.originalPath || p.cloudOriginalPath) {
        try { originalDataUrl = await downloadPhoto(client, p.originalPath || p.cloudOriginalPath); } catch (_) { /* keep */ }
      }
      photos.push({ ...p, dataUrl, originalDataUrl, cloudPath: path });
    } catch (_) {
      photos.push(p);
    }
  }
  const receipts = [];
  for (const r of rec.receipts || []) {
    if (r.dataUrl || !(r.path || r.cloudPath)) { receipts.push(r); continue; }
    try {
      const dataUrl = await downloadPhoto(client, r.path || r.cloudPath);
      receipts.push({ ...r, dataUrl, cloudPath: r.path || r.cloudPath });
    } catch (_) { receipts.push(r); }
  }
  const raw = { ...rec, photos, receipts, deletedAt: null };
  try { return normalizeItem(raw); } catch (_) { return raw; }
}

function preferLocalPixels(localPhotos = [], incoming = []) {
  const byId = new Map((localPhotos || []).filter(p => p && p.id).map(p => [p.id, p]));
  return (incoming || []).map(p => {
    const loc = byId.get(p.id);
    if (loc && loc.dataUrl && (!p.dataUrl || (loc.cloudHash && loc.cloudHash === p.cloudHash))) {
      return { ...p, dataUrl: loc.dataUrl, originalDataUrl: loc.originalDataUrl || p.originalDataUrl };
    }
    return p;
  });
}

function hydrateScanShallow(rec) {
  try { return normalizeScan({ ...rec, updatedAt: rec.updatedAt || rec.createdAt }); } catch (_) { return rec; }
}

async function syncKv(client, userId, deps, storage) {
  const local = deps.getKv() || {};
  const { data, error } = await client.from("kv").select("key, payload, updated_at, deleted_at");
  if (error) throw error;
  const remote = {};
  for (const row of data || []) {
    remote[row.key] = {
      key: row.key,
      payload: row.payload,
      updatedAt: Date.parse(row.updated_at) || 0,
      deletedAt: row.deleted_at
    };
  }
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key];
    const r = remote[key];
    const { winner, source } = pickWinner(l, r);
    if (!winner || winner.deletedAt) continue;
    const payload = stripKeyish(winner.payload || winner);
    if (payloadHasKey(payload)) continue; // never push a key
    if (source === "local") {
      const { error: upErr } = await client.from("kv").upsert({
        user_id: userId,
        key,
        payload,
        updated_at: new Date(recordTime(winner) || Date.now()).toISOString(),
        deleted_at: null
      });
      if (upErr) throw upErr;
    } else if (source === "remote" && deps.setKv) {
      deps.setKv(key, payload, winner.updatedAt);
    }
  }
}

/** Enqueue a local change and try to flush if signed in. */
export async function noteLocalChange({ kind = "item", id, action = "upsert", item, at = Date.now() }, deps = {}) {
  enqueue({ kind, id, action, at }, deps.storage, at);
  if (action === "delete") addTombstone({ id, kind, at }, deps.storage);
  if (deps.auto !== false) {
    // Fire-and-forget; errors are recorded on the status pill.
    return runSync(deps).catch(() => {});
  }
}

export { stripKeyish, KEYISH, PHOTOS_BUCKET, SYNC_CLOUD_EDGE };
