#!/usr/bin/env node
// Try the real Supabase project with the publishable key ONLY.
//
// Run this AFTER you have:
//   1. Run supabase/schema-v2.sql in the SQL Editor (success, no red error)
//   2. Turned Authentication → Sign In / Providers → Anonymous →
//      "Allow anonymous sign-ins" ON, and Saved
//   3. Confirmed CAPTCHA is OFF
//
// Then:
//   node supabase/try-real-project.mjs --i-applied-the-sql
//
// This creates two anonymous sessions, pairs them with a one-time code,
// upserts a throwaway item, checks the second device can read it, tries
// a wrong code, redeems the recovery code on a third session, and
// revokes. It never uses a service-role key, never prints the
// publishable key or any recovery/pairing code in full, and never
// touches the OpenAI key. It talks to the public Auth and REST APIs
// over HTTPS with the publishable key already in the app.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../app/js/core/sync-config.js";

const FLAG = "--i-applied-the-sql";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function mask(code) {
  const s = String(code || "").replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/gi, "");
  if (s.length < 4) return "(none)";
  return s.slice(0, 2) + "…" + s.slice(-2) + ` (${s.length} chars)`;
}

async function req(method, path, { token, body, headers } = {}) {
  const url = SUPABASE_URL.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + (token || SUPABASE_ANON_KEY),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function signInAnonymously() {
  // GoTrue anonymous sign-in: POST /auth/v1/signup with no email,
  // when "Allow anonymous sign-ins" is on.
  const r = await req("POST", "/auth/v1/signup", { body: { data: {} } });
  if (!r.ok) {
    const msg = (r.data && (r.data.error_description || r.data.msg || r.data.message || r.data.error)) || ("HTTP " + r.status);
    fail("signInAnonymously: " + msg + " — is 'Allow anonymous sign-ins' ON? Is CAPTCHA off?");
  }
  const user = r.data && (r.data.user || r.data);
  const token = r.data && r.data.access_token;
  if (!token || !user || !user.id) fail("signInAnonymously returned no session");
  return { user, token };
}

async function rpc(token, name, args) {
  const r = await req("POST", "/rest/v1/rpc/" + name, { token, body: args || {} });
  if (!r.ok) {
    const msg = (r.data && (r.data.message || r.data.hint || r.data.details || r.data.error)) || ("HTTP " + r.status);
    const code = r.data && r.data.code;
    return { data: null, error: { message: msg, code, status: r.status } };
  }
  return { data: r.data, error: null };
}

async function main() {
  if (!process.argv.includes(FLAG)) {
    console.log("Not run. After you apply schema-v2.sql and turn on anonymous sign-ins, run:\n");
    console.log("  node supabase/try-real-project.mjs " + FLAG + "\n");
    console.log("Uses only the publishable key. Will not run against the project without that flag.");
    process.exit(0);
  }

  if (!/^sb_publishable_/.test(SUPABASE_ANON_KEY)) {
    fail("Refusing to run: the configured key is not a publishable key.");
  }

  const steps = [];
  const note = s => { steps.push(s); console.log("•", s); };

  const a = await signInAnonymously();
  note("First device signed in anonymously");

  const { data: ensured, error: eErr } = await rpc(a.token, "ensure_sync_owner");
  if (eErr) fail("ensure_sync_owner: " + eErr.message + " — has schema-v2.sql been run?");
  if (!ensured || !ensured.owner_id) fail("ensure_sync_owner returned no owner");
  const owner = ensured.owner_id;
  const recovery = ensured.recovery_code;
  if (ensured.is_new && !recovery) fail("a new owner should return a recovery code once");
  note("ensure_sync_owner ok, owner " + String(owner).slice(0, 8) + "…, recovery " + mask(recovery));

  const { data: again } = await rpc(a.token, "ensure_sync_owner");
  if (again && again.recovery_code) fail("recovery code was returned a second time");
  note("second ensure_sync_owner did not return the recovery code again");

  const { data: pairing, error: pErr } = await rpc(a.token, "create_pairing_code");
  if (pErr) fail("create_pairing_code: " + pErr.message);
  if (!pairing || !pairing.code) fail("no pairing code");
  note("pairing code issued " + mask(pairing.code));

  const b = await signInAnonymously();
  // Must not call ensure_sync_owner on the join path.
  const { data: redeemed, error: rErr } = await rpc(b.token, "redeem_pairing_code", { p_code: pairing.code });
  if (rErr) fail("redeem_pairing_code: " + rErr.message);
  if (!redeemed || redeemed.owner_id !== owner) fail("second device linked to a different owner");
  note("second device redeemed the pairing code and shares the owner");

  const c = await signInAnonymously();
  const usedRes = await rpc(c.token, "redeem_pairing_code", { p_code: pairing.code });
  const usedFail = usedRes.error || (usedRes.data && usedRes.data.ok === false);
  if (!usedFail) fail("a used pairing code should not be redeemable again");
  note("used pairing code was rejected");

  const wrongRes = await rpc(c.token, "redeem_pairing_code", { p_code: "22222222" });
  const wrong = wrongRes.error || (wrongRes.data && wrongRes.data.ok === false && { message: wrongRes.data.error });
  if (!wrong) fail("a wrong pairing code should be rejected");
  const wrongMsg = wrong.message || (wrongRes.data && wrongRes.data.error) || "";
  if (/exist|invalid hash|not found/i.test(wrongMsg) && !/didn't work or it expired/i.test(wrongMsg)) {
    fail("wrong-code error should be generic, got: " + wrongMsg);
  }
  note("wrong code was rejected with a generic message");

  const itemId = "try_real_" + Date.now();
  const payload = { id: itemId, title: "Throwaway test item", photos: [], notes: "safe to delete" };
  const up = await req("POST", "/rest/v1/items", {
    token: a.token,
    body: {
      user_id: owner,
      id: itemId,
      payload,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      deleted_at: null
    },
    headers: { Prefer: "resolution=merge-duplicates,return=representation" }
  });
  if (!up.ok) fail("items upsert: " + JSON.stringify(up.data) + " HTTP " + up.status);

  const seen = await req("GET", "/rest/v1/items?id=eq." + encodeURIComponent(itemId) + "&select=id,payload,user_id", { token: b.token });
  if (!seen.ok) fail("items select from second device: " + JSON.stringify(seen.data));
  const rows = Array.isArray(seen.data) ? seen.data : [];
  if (!rows.length || !rows[0].payload || rows[0].payload.title !== "Throwaway test item") {
    fail("second device could not read the item the first device just wrote");
  }
  if (JSON.stringify(rows).includes("sk-")) fail("a key-like field showed up in the row");
  note("second device can read the first device's item");

  if (recovery) {
    const { data: recovered, error: recErr } = await rpc(c.token, "redeem_recovery_code", { p_code: recovery });
    if (recErr) fail("redeem_recovery_code: " + recErr.message);
    if (!recovered || recovered.owner_id !== owner) fail("recovery did not link to the same owner");
    note("third session recovered with the recovery code");
    await rpc(c.token, "revoke_this_device");
  }

  await req("DELETE", "/rest/v1/items?id=eq." + encodeURIComponent(itemId), { token: a.token });
  await rpc(b.token, "revoke_this_device");
  await rpc(a.token, "revoke_this_device");
  note("throwaway item removed, devices revoked");

  console.log("\nOK. Pairing-code sync works on the real project.");
  console.log("Steps:", steps.length);
}

main().catch(err => fail(err && err.message || err));
