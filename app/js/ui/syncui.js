// Settings card for "Sync with my computer". Pairing code, no email.
// Existing Settings cards are unchanged; this is an extra card after the AI key.
// The email OTP functions stay in sync.js but are hidden unless EMAIL_SYNC_ENABLED.

import { esc, toast, confirmSheet, download } from "./dom.js";
import {
  EMAIL_SYNC_ENABLED, KEY_STAYS_NOTE, SYNC_STEPS, SYNC_NOT_READY_MSG,
  PAIRING_TTL_MS, formatSyncCode, classifySyncCode, normalizeSyncCode,
  currentUser, turnOnSync, createPairingCode, joinWithCode,
  rotateRecoveryCode, turnOffSyncOnThisDevice, loadPendingRecovery,
  clearPendingRecovery, loadSyncStatus, friendlySyncError, runSync,
  getSupabase
} from "../core/sync.js";

export function syncCardShell() {
  return `<div class="card" id="synccard">
    <h3>Sync with my computer</h3>
    <div id="syncbody"><p class="small muted">Loading…</p></div>
  </div>`;
}

export function offCardHtml() {
  const steps = `<ol class="sync-steps">${SYNC_STEPS.map(s => `<li>${esc(s)}</li>`).join("")}</ol>`;
  return `
    <p class="small">Share your items with another phone or a computer. No email is needed.</p>
    ${steps}
    <p class="tiny muted">${esc(KEY_STAYS_NOTE)}</p>
    <div class="sync-actions">
      <button type="button" class="btn btn-main" data-sync="turn-on">Turn on sync</button>
      <button type="button" class="btn soft" data-sync="have-code">I have a code</button>
    </div>
    <p class="tiny muted" style="margin-top:10px">Only tap Turn on sync on the first device. If your other device already has Sync on, tap I have a code instead.</p>
  `;
}

export function recoveryCardHtml(code, { rotated = false } = {}) {
  const pretty = formatSyncCode(code);
  return `
    <p class="small">${rotated
      ? "Here is your new recovery code. The old one no longer works. Write this down, or save a copy. You'll only see it once."
      : "Write this recovery code down, or save a copy. If you lose both devices, this is how you get your items back. You'll only see it this once."}</p>
    <p class="sync-code" id="sync-recovery-code" aria-label="Recovery code">${esc(pretty)}</p>
    <div class="sync-actions">
      <button type="button" class="btn btn-main" data-sync="save-recovery">Save a copy</button>
      <button type="button" class="btn soft" data-sync="print-recovery">Print</button>
      <button type="button" class="btn soft" data-sync="saved-recovery">I saved it</button>
    </div>
  `;
}

export function enterCodeHtml({ error = "" } = {}) {
  return `
    <p class="small">Type the 8-character code from your other device. If you lost both devices, type your 16-character recovery code instead.</p>
    <label class="field"><span>Code</span>
      <input id="sync-code-input" class="sync-code-input" type="text" inputmode="text"
        autocomplete="off" autocapitalize="characters" spellcheck="false"
        maxlength="24" placeholder="XXXX-XXXX" aria-label="Pairing or recovery code">
    </label>
    ${error ? `<p class="small" style="color:var(--bad)">${esc(error)}</p>` : ""}
    <div class="sync-actions">
      <button type="button" class="btn btn-main" data-sync="join">Connect</button>
      <button type="button" class="btn ghost" data-sync="back">Back</button>
    </div>
  `;
}

export function countdownLabel(expiresAt, now = Date.now()) {
  const end = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(end)) return "";
  const sec = Math.max(0, Math.ceil((end - now) / 1000));
  if (sec <= 0) return "This code has expired. Tap below for a new one.";
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `This code works for ${m}:${s}, and only once.`;
}

export function pairingCodeHtml(code, expiresAt, now = Date.now()) {
  const pretty = formatSyncCode(code);
  const note = countdownLabel(expiresAt, now);
  return `
    <p class="small">On the other device, open Jessika's Flip Side, go to Settings, and tap <strong>I have a code</strong>. Then type this:</p>
    <p class="sync-code" id="sync-pairing-code" aria-label="Pairing code">${esc(pretty)}</p>
    <p class="small muted" id="sync-countdown">${esc(note)}</p>
    <div class="sync-actions">
      <button type="button" class="btn soft" data-sync="new-pairing">Get a new code</button>
      <button type="button" class="btn ghost" data-sync="back-signedin">Done</button>
    </div>
  `;
}

export function signedInCardHtml({ lastLabel = "", notReady = false } = {}) {
  return `
    <p class="small"><strong>This device is synced.</strong> ${esc(lastLabel)}</p>
    ${notReady ? `<p class="small">${esc(SYNC_NOT_READY_MSG)}</p>` : ""}
    <p class="tiny muted">${esc(KEY_STAYS_NOTE)}</p>
    <div class="sync-actions">
      <button type="button" class="btn btn-main" data-sync="connect-other">Connect another device</button>
      <button type="button" class="btn soft" data-sync="sync-now">Sync now</button>
      <button type="button" class="btn soft" data-sync="new-recovery">Get a new recovery code</button>
      <button type="button" class="btn dangerghost" data-sync="turn-off">Turn off sync on this device</button>
    </div>
    <p class="tiny muted" style="margin-top:10px">Turning off sync here only signs this device out. Your items stay on this device and on any other device that's still connected. Your recovery code still works.</p>
  `;
}

export function recoveryDownloadText(code) {
  const pretty = formatSyncCode(code);
  return [
    "Jessika's Flip Side — recovery code",
    "",
    pretty,
    "",
    "Keep this somewhere safe. If you lose both devices, open Jessika's Flip Side on a new device, go to Settings → Sync with my computer → I have a code, and type this code.",
    "The AI key is not part of this. It stays on each device.",
    ""
  ].join("\n");
}

export function recoveryPrintHtml(code) {
  const pretty = esc(formatSyncCode(code));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recovery code</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 32px; color: #111; }
      h1 { font-size: 1.2rem; }
      .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 2rem;
        letter-spacing: .12em; font-weight: 800; margin: 24px 0; }
      p { max-width: 36em; line-height: 1.45; }
    </style></head><body>
    <h1>Jessika's Flip Side — recovery code</h1>
    <p class="code">${pretty}</p>
    <p>Keep this somewhere safe. If you lose both devices, open Jessika's Flip Side on a new device, go to Settings, tap I have a code, and type this.</p>
    <p>The AI key is not part of this. It stays on each device.</p>
    </body></html>`;
}

function bodyEl(root) {
  return (root && root.querySelector) ? root.querySelector("#syncbody") : null;
}

function setBusy(root, on) {
  (root.querySelectorAll("button[data-sync]") || []).forEach(b => { b.disabled = !!on; });
}

export async function bindSyncCard(root, { runSyncNow, confirm = confirmSheet, saveFile = download, openPrint, onToast = toast } = {}) {
  const card = root && root.querySelector && root.querySelector("#synccard");
  if (!card) return { ok: false };
  const state = { view: "loading", pairing: null, tick: null, joining: false };

  function say(msg) { try { onToast(msg); } catch (e) { /* tests */ } }

  function stopTick() {
    if (state.tick) { clearInterval(state.tick); state.tick = null; }
  }

  function show(html) {
    const b = bodyEl(root);
    if (b) b.innerHTML = html;
  }

  async function paintSignedIn(status = loadSyncStatus()) {
    state.view = "signed-in";
    stopTick();
    const last = status && status.lastSyncAt
      ? "Last synced " + new Date(status.lastSyncAt).toLocaleString() + "."
      : "Tap Sync now to upload what's already on this device.";
    show(signedInCardHtml({ lastLabel: last, notReady: !!(status && status.notReady) }));
  }

  async function paint() {
    const pending = loadPendingRecovery();
    if (pending && pending.code) {
      state.view = "recovery";
      show(recoveryCardHtml(pending.code, { rotated: !!pending.rotated }));
      return;
    }
    let user = null;
    try { user = await currentUser(); } catch (e) { user = null; }
    if (!user) {
      state.view = "off";
      show(offCardHtml());
      return;
    }
    await paintSignedIn();
  }

  async function doTurnOn() {
    const ok = await confirm({
      title: "Turn on sync?",
      body: "Only do this on the first device. If your other device already has Sync on, go back and tap I have a code instead. You'll get a recovery code next — write it down or save a copy.",
      ok: "Turn on sync"
    });
    if (!ok) return;
    setBusy(card, true);
    try {
      const r = await turnOnSync();
      if (r.recoveryCode) {
        state.view = "recovery";
        show(recoveryCardHtml(r.recoveryCode, { isNew: !!r.isNew }));
      } else {
        await paintSignedIn();
      }
    } catch (e) {
      say(friendlySyncError(e));
      await paint();
    } finally {
      setBusy(card, false);
    }
  }

  async function showPairing(fresh = true) {
    setBusy(card, true);
    try {
      const r = fresh ? await createPairingCode() : state.pairing;
      state.pairing = r;
      state.view = "pairing";
      const expires = r.expiresAt || (Date.now() + PAIRING_TTL_MS);
      show(pairingCodeHtml(r.code, expires));
      stopTick();
      state.tick = setInterval(() => {
        const note = countdownLabel(expires);
        const el = card.querySelector("#sync-countdown");
        if (el) el.textContent = note;
        if (/expired/i.test(note)) stopTick();
      }, 1000);
    } catch (e) {
      say(friendlySyncError(e));
      await paintSignedIn();
    } finally {
      setBusy(card, false);
    }
  }

  async function doJoin() {
    const input = card.querySelector("#sync-code-input");
    const raw = (input && input.value) || "";
    if (!classifySyncCode(raw)) {
      show(enterCodeHtml({ error: "Type the 8-character code from your other device, or your 16-character recovery code." }));
      const again = card.querySelector("#sync-code-input");
      if (again) again.value = formatSyncCode(raw);
      return;
    }
    setBusy(card, true);
    try {
      await joinWithCode(raw);
      say("This device is synced.");
      if (typeof runSyncNow === "function") {
        try { await runSyncNow(); } catch (e) { say(friendlySyncError(e)); }
      }
      await paintSignedIn();
    } catch (e) {
      show(enterCodeHtml({ error: friendlySyncError(e) }));
    } finally {
      setBusy(card, false);
    }
  }

  async function doSyncNow() {
    setBusy(card, true);
    try {
      const fn = typeof runSyncNow === "function" ? runSyncNow : () => runSync();
      const r = await fn();
      if (r && r.notReady) say(SYNC_NOT_READY_MSG);
      else if (r && r.ok === false) say(r.message || friendlySyncError(r.error || r));
      else say("Synced.");
      await paintSignedIn();
    } catch (e) {
      say(friendlySyncError(e));
    } finally {
      setBusy(card, false);
    }
  }

  async function doNewRecovery() {
    const ok = await confirm({
      title: "Get a new recovery code?",
      body: "The old recovery code will stop working. You'll see the new one once. Write it down or save a copy.",
      ok: "Get a new code"
    });
    if (!ok) return;
    setBusy(card, true);
    try {
      const r = await rotateRecoveryCode();
      state.view = "recovery";
      show(recoveryCardHtml(r.recoveryCode, { rotated: true }));
    } catch (e) {
      say(friendlySyncError(e));
    } finally {
      setBusy(card, false);
    }
  }

  async function doTurnOff() {
    const ok = await confirm({
      title: "Turn off sync on this device?",
      body: "This device will stop sharing. Your items stay on this device. Other devices and your recovery code are not affected.",
      ok: "Turn off",
      danger: true
    });
    if (!ok) return;
    setBusy(card, true);
    try {
      await turnOffSyncOnThisDevice();
      say("Sync is off on this device.");
      await paint();
    } catch (e) {
      say(friendlySyncError(e));
    } finally {
      setBusy(card, false);
    }
  }

  function currentRecovery() {
    const pending = loadPendingRecovery();
    return pending && pending.code;
  }

  function doSaveRecovery() {
    const code = currentRecovery();
    if (!code) return;
    saveFile("flip-side-recovery-code.txt", recoveryDownloadText(code), "text/plain");
    say("Saved. Keep that file somewhere safe.");
  }

  function doPrintRecovery() {
    const code = currentRecovery();
    if (!code) return;
    if (typeof openPrint === "function") {
      openPrint(recoveryPrintHtml(code));
      return;
    }
    try {
      const w = window.open("", "_blank");
      if (!w) { say("Allow pop-ups to print, or tap Save a copy."); return; }
      w.document.write(recoveryPrintHtml(code));
      w.document.close();
      w.focus();
      w.print();
    } catch (e) {
      say("Couldn't print. Tap Save a copy instead.");
    }
  }

  card.addEventListener("click", async e => {
    const btn = e.target && e.target.closest && e.target.closest("[data-sync]");
    if (!btn) return;
    const act = btn.getAttribute("data-sync");
    if (act === "turn-on") return doTurnOn();
    if (act === "have-code") { state.view = "enter"; show(enterCodeHtml()); return; }
    if (act === "join") return doJoin();
    if (act === "back") { await paint(); return; }
    if (act === "save-recovery") return doSaveRecovery();
    if (act === "print-recovery") return doPrintRecovery();
    if (act === "saved-recovery") {
      clearPendingRecovery();
      if (typeof runSyncNow === "function") {
        try { await runSyncNow(); } catch (err) { say(friendlySyncError(err)); }
      }
      await paintSignedIn();
      return;
    }
    if (act === "connect-other" || act === "new-pairing") return showPairing(true);
    if (act === "back-signedin") return paintSignedIn();
    if (act === "sync-now") return doSyncNow();
    if (act === "new-recovery") return doNewRecovery();
    if (act === "turn-off") return doTurnOff();
  });

  card.addEventListener("input", e => {
    const input = e.target && e.target.id === "sync-code-input" ? e.target : null;
    if (!input) return;
    const n = normalizeSyncCode(input.value);
    const caretAtEnd = input.selectionStart === input.value.length;
    input.value = formatSyncCode(n);
    if (caretAtEnd) try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* */ }
  });

  card.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target && e.target.id === "sync-code-input") {
      e.preventDefault();
      doJoin();
    }
  });

  await paint();
  // EMAIL_SYNC_ENABLED is reserved for a later form; we never render it today.
  void EMAIL_SYNC_ENABLED;
  void getSupabase;
  return { ok: true, paint, state };
}
