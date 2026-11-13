import { esc, $, toast, bind, confirmSheet, promptSheet, download, honesty } from "../dom.js";
import { hasKey, setKey, removeKey, getKey } from "../../core/key.js";
import { checkKey } from "../../core/draft.js";
import { exportPayload, importPayload, importEnabledSites, importMileage, importSettings, monthKey, normalizeItem } from "../../core/inventory.js";
import { SITES, SITE_GROUPS } from "../../core/sites.js";
import { getEnabledIds, setEnabledIds, clearEnabledIds } from "../../core/prefs.js";
import {
  getSettings, setSettings, clearSettings, getTrips, setTrips, clearTrips,
  clearReminders, mileageRateFor, IRS_PAGE, newBoxId, normalizeBox,
  PAUSE_NOTE_ON, PAUSE_NOTE_OFF, NO_SUBSCRIPTION_NOTE
} from "../../core/settings.js";
import { ebayOfficialAdapter } from "../../core/comps.js";
import { getActionLog, failedActions, clearActionLog, formatActionTime } from "../../core/actions.js";
import { parseCsv, suggestMapping, rowsToItems, findDuplicateGroups, mergeItems, itemsToCsv, CSV_FIELDS } from "../../core/csv.js";
import { setWalkthroughDone } from "../../core/walkthrough.js";
import { openWalkthrough } from "../walkthrough.js";
import { openIntro } from "../intro.js";
import { openTerms } from "../terms.js";
import { shouldShowTermsInSettings, clearTerms } from "../../core/invite.js";
import { clearAskHistory } from "../ask.js";
import { clearWork, clearScanWork, clearBatch } from "../../core/autosave.js";
import { clearSecondLook } from "../../core/secondlook.js";
import { tip, openTip } from "../tips.js";
import { PHOTO_CLEANUP_NOTE } from "../../core/photo.js";

export function renderSettings(ctx, el) {
  const n = ctx.items.length;
  const enabled = new Set(getEnabledIds());
  const settings = getSettings();
  const failed = failedActions();
  const boxes = settings.boxes || [];
  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>Settings</h2><span class="spacer48"></span></div>

    <div class="card" id="keycard">
      <h3>AI key</h3>
      <p class="small">Paste the key Ken sent you. It stays on this phone only. It is never put in a backup, and it is only sent to the AI service when you make a draft from a photo, ask a question, or tap Check key.</p>
      <label class="field"><span>AI key</span>
        <input id="apikey" type="password" autocomplete="off" spellcheck="false" placeholder="${hasKey() ? "A key is saved on this phone" : "Paste the key here"}">
      </label>
      <p class="tiny muted" id="keystatus">${hasKey() ? "A key is saved on this phone. Paste a new one to replace it, or tap Remove key." : "No key saved."}</p>
      <div class="row wrap" style="margin-top:8px;gap:6px">
        <button type="button" class="btn soft sm" data-act="savekey">Save key</button>
        <button type="button" class="btn soft sm" data-act="checkkey">Check key</button>
        <button type="button" class="btn dangerghost sm" data-act="removekey">Remove key</button>
      </div>
    </div>

    <div class="card" id="pausecard">
      <div class="row between"><h3>Pause all automation</h3>${honesty("ok", "Working")} ${tip("Today this pauses reminders and notifications. When automatic listing and take-down are added, this same switch will pause those too.")}</div>
      <p class="small muted">${esc(settings.pauseAutomation ? PAUSE_NOTE_ON : PAUSE_NOTE_OFF)}</p>
      <label class="check switch-row">
        <input type="checkbox" data-act="pause" id="pause-all" ${settings.pauseAutomation ? "checked" : ""}>
        <span>${settings.pauseAutomation ? "Automation is paused" : "Automation is on"}</span>
      </label>
    </div>

    <div class="card" id="sitescard">
      <h3>Sites you sell on</h3>
      <p class="small muted">Tick the sites you actually use. The post list and AI advice will focus on these. You can still open any other site from an item if you want.</p>
      ${SITE_GROUPS.map(g => {
        const sites = SITES.filter(s => s.group === g.id);
        return `<h4 class="group-label">${esc(g.label)}</h4>
          <ul class="sitelist">${sites.map(s => `<li>
            <label class="check">
              <input type="checkbox" data-act="togglesite" data-site="${esc(s.id)}" ${enabled.has(s.id) ? "checked" : ""}>
              <span>${esc(s.name)}${s.note ? `<span class="tiny muted" style="display:block;font-weight:400">${esc(s.note)}</span>` : ""}</span>
            </label>
          </li>`).join("")}</ul>`;
      }).join("")}
      <p class="tiny muted" id="sitecount">${enabled.size} site${enabled.size === 1 ? "" : "s"} turned on.</p>
      <a class="btn soft sm" href="#/sites" style="margin-top:8px">See what each site allows</a>
    </div>

    <div class="card" id="dropcard">
      <h3>Price-drop ideas</h3>
      <p class="small muted">When a listing has been up this many days with no sale, Jessika's Flip Side will suggest a price drop or sending offers. You approve each one, then change it on the site yourself. A drop will not go below your profit floor.</p>
      <label class="field"><span>Suggest a drop after this many days</span>
        <input id="dropdays" type="number" min="1" max="365" inputmode="numeric" value="${esc(settings.dropAfterDays)}">
      </label>
      <label class="field"><span>Default profit floor ${tip("The lowest asking price Jessika's Flip Side will suggest. Each item can have its own floor. A price-drop idea will never go below this.")}</span>
        <input id="profitfloor" type="text" inputmode="decimal" value="${esc(settings.defaultProfitFloor ?? "")}" placeholder="5.00">
      </label>
      <label class="field"><span>Profit you want when buying ${tip("Used by “Buy up to” on the Buy or pass screen: estimated resale minus fees, shipping, and this amount.")}</span>
        <input id="desiredprofit" type="text" inputmode="decimal" value="${esc(settings.desiredProfit ?? "")}" placeholder="10.00">
      </label>
      <button type="button" class="btn soft sm" data-act="savedrop">Save</button>
    </div>

    <div class="card" id="boxcard">
      <div class="row between"><h3>Your boxes</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">Save the box sizes you use often. On an item, you can pick one, then enter the packed weight and the actual shipping cost.</p>
      ${boxes.length ? `<ul class="itemlist">${boxes.map(b => `<li>
        <div class="li">
          <span class="grow"><b>${esc(b.label)}</b><span class="tiny muted">${esc([b.lengthIn, b.widthIn, b.heightIn].filter(v => v != null).join(" × "))} in</span></span>
          <button type="button" class="btn sm dangerghost" data-act="delbox" data-id="${esc(b.id)}">Remove</button>
        </div>
      </li>`).join("")}</ul>` : `<p class="tiny muted">No boxes saved yet.</p>`}
      <button type="button" class="btn soft sm" data-act="addbox">+ Add a box</button>
    </div>

    <div class="card" id="taxcard">
      <h3>Mileage rate</h3>
      <p class="small muted">Used when you log a trip on the <a href="#/taxes">Taxes</a> screen. Leave this blank to use the official IRS business rate for the date of the trip. The current rate we have is ${esc(String(mileageRateFor(Date.now(), { irsMileageRate: null }).rate))} per mile (${esc(mileageRateFor(Date.now(), { irsMileageRate: null }).source)}). Confirm at <a href="${esc(IRS_PAGE)}" target="_blank" rel="noopener">IRS.gov</a>.</p>
      <label class="field"><span>Your rate per mile (optional)</span>
        <input id="irsrate" type="text" inputmode="decimal" value="${esc(settings.irsMileageRate ?? "")}" placeholder="Leave blank for the official rate">
      </label>
      <button type="button" class="btn soft sm" data-act="saverate">Save rate</button>
    </div>

    <div class="card" id="remindcard">
      <div class="row between"><h3>Take-down reminders</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">When something sells and is still listed on other sites, Jessika's Flip Side shows a countdown and reminds you in the app. If you allow notifications, you'll also get a phone notification while the app is open. Reminders while the app is closed need a computer helper, which is coming later. The Pause all switch above turns these off.</p>
      <button type="button" class="btn soft" data-act="notify">${settings.notifyDelist ? "Reminders are on — tap to check again" : "Turn on take-down reminders"}</button>
      <p class="tiny muted" id="notifystatus"></p>
    </div>

    <div class="card" id="ebaycard">
      <div class="row between"><h3>Official eBay sold prices</h3>${honesty("later", "Coming later")}</div>
      <p class="small muted">${esc(ebayOfficialAdapter.needs)}. When that's set up, Jessika's Flip Side will look up real sold prices through eBay's official API, with your permission. It will not scrape eBay, and it will not ask for your eBay password.</p>
      <label class="check" style="opacity:.7">
        <input type="checkbox" disabled ${settings.ebayOfficialComps ? "checked" : ""}>
        <span>Use official eBay sold prices (not available yet)</span>
      </label>
    </div>

    <div class="card">
      <h3>Your data</h3>
      <p class="small muted">${n} item${n === 1 ? "" : "s"} on this phone. No account needed. Everything stays here, except photos you send for an AI draft. ${esc(NO_SUBSCRIPTION_NOTE)}</p>
      <div class="stack">
        <button type="button" class="btn soft" data-act="export">⬇️ Export a backup file</button>
        <label class="btn soft" style="cursor:pointer">⬆️ Restore from backup<input type="file" id="imp" accept="application/json,.json" hidden></label>
        <button type="button" class="btn soft" data-act="exportcsv">⬇️ Export items as a spreadsheet (CSV)</button>
        <label class="btn soft" style="cursor:pointer">⬆️ Import items from a spreadsheet (CSV)<input type="file" id="impcsv" accept="text/csv,.csv,text/plain" hidden></label>
        <button type="button" class="btn danger" data-act="wipe">🗑️ Delete everything</button>
      </div>
      <div id="csv-import" hidden></div>
      <div id="csv-dupes" hidden></div>
    </div>

    ${failed.length ? `<div class="card" id="actionlog">
      <div class="row between"><h3>Things that didn't work</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">A short log of failed actions on this phone. It never includes your AI key or photos.</p>
      <ul class="tiny">${failed.slice(0, 20).map(a => `<li>${esc(formatActionTime(a.at))} — ${esc(a.message || a.kind)}${a.siteId ? " (" + esc(a.siteId) + ")" : ""}</li>`).join("")}</ul>
      <button type="button" class="btn soft sm" data-act="clearlog">Clear this log</button>
    </div>` : ""}

    <div class="card" id="introcard">
      <h3>Intro and demo</h3>
      <p class="small muted">Watch the short video, or try a pretend listing with a photo. Nothing is posted, and your real items are left alone.</p>
      <div class="stack">
        <button type="button" class="btn soft" data-act="watchintro">Watch the intro</button>
        <button type="button" class="btn soft" data-act="trydemo">Try the demo</button>
        <button type="button" class="btn soft" data-act="rewalk">Show the welcome tips</button>
        ${shouldShowTermsInSettings() ? `<button type="button" class="btn soft" data-act="readterms">Read the terms</button>` : ""}
      </div>
    </div>

    <details class="more-block" style="margin-top:14px">
      <summary>More</summary>
      <div class="card">
        <h3>Welcome tips</h3>
        <p class="small muted">See the short first-run walkthrough again.</p>
        <button type="button" class="btn soft sm" data-act="rewalk">Show the welcome tips</button>
      </div>
      <div class="card">
        <h3>Photo clean-up</h3>
        <p class="small muted">${esc(PHOTO_CLEANUP_NOTE)}</p>
      </div>
    </details>

    <div class="card flat honesty-card">
      <h3>What this version does</h3>
      <p class="small">${honesty("ok", "Working")} A first-open welcome and a “try it before you install” demo (sandboxed — nothing is posted, and your real items are left alone), photo to a draft, Buy or pass with a “Buy up to” amount, Second look (scan a table), inventory with bins and QR labels, full profit, a sold take-down checklist with a guided walk-through, price-drop ideas that respect your profit floor, a morning list, taxes, CSV import and export, and an Ask-a-question helper. Works offline except for AI checks. The first-open welcome plays a short promo video (muted, with tap-for-sound and a skip button). A private invite can show a short terms summary before that video; the public link does not.</p>
      <p class="small">${honesty("warn", "Estimate")} AI prices, sold-price estimates, fees, shipping costs, pricing options, Buy or pass verdicts, and Second look guesses.</p>
      <p class="small">${honesty("warn", "Needs you to post")} Posting, taking listings down, and changing a price is something you do in each site's own app. The guided take-down opens each site and ticks it off when you say you did it. Jessika's Flip Side does not log into those accounts.</p>
      <p class="small">${honesty("later", "Coming later")} Official one-tap listing and take-down (eBay, Etsy, Shopify first), official eBay sold prices, a computer helper, buying shipping labels, and a live “coach me in my earbud” mode for haggling. Some sites will always need your tap. Not promised for Poshmark, Mercari, or Facebook Marketplace unless those companies open an official door.</p>
    </div>

    <div class="card flat">
      <h3>Privacy</h3>
      <p class="small">Your items and photos stay on this phone. The AI key stays on this phone. A photo is sent to the AI service only when you ask for a draft, a Buy or pass check, or a Second look scan. Second look frames are not uploaded anywhere else, and thumbnails stay on this phone. No account is required. Jessika's Flip Side will not ask for a selling-site password.</p>
    </div>
    <p class="tiny muted center" id="no-sub">${esc(NO_SUBSCRIPTION_NOTE)}</p>
    <p class="tiny muted center">Jessika's Flip Side v${esc(ctx.version)}</p>
  `;

  $("#imp", el).addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = "";
    try {
      const data = JSON.parse(await f.text());
      importPayload(data); // validate first
      if (!(await confirmSheet({ title: "Restore this backup?", body: "This replaces every item on this phone with the backup. The AI key is not in the backup and will stay as it is.", ok: "Restore" }))) return;
      const items = importPayload(data);
      await ctx.store.wipe();
      for (const item of items) await ctx.store.put(item);
      const sites = importEnabledSites(data);
      if (sites) setEnabledIds(sites);
      const trips = importMileage(data);
      if (trips) setTrips(trips);
      const st = importSettings(data);
      if (st) setSettings(st);
      toast("Restored");
      await ctx.reload();
      ctx.render();
    } catch (err) {
      toast(err && /Flip Side|Jessika|couldn't be read|no items/i.test(err.message) ? err.message : "That file couldn't be read.");
    }
  });

  $("#impcsv", el).addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = "";
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (!parsed.headers.length || !parsed.rows.length) { toast("That spreadsheet is empty, or we couldn't read it."); return; }
      openCsvMapper(ctx, el, parsed);
    } catch (err) {
      toast("That file couldn't be read as a spreadsheet.");
    }
  });

  bind(el, {
    tip: b => openTip(b.dataset.tip || ""),
    pause: b => {
      const on = b.checked;
      setSettings({ pauseAutomation: on });
      toast(on ? "Automation is paused" : "Automation is on");
      ctx.render();
    },
    togglesite: b => {
      const current = new Set(getEnabledIds());
      if (b.checked) current.add(b.dataset.site);
      else current.delete(b.dataset.site);
      if (!current.size) {
        toast("Leave at least one site on");
        b.checked = true;
        return;
      }
      const ids = setEnabledIds([...current]);
      const count = $("#sitecount", el);
      if (count) count.textContent = `${ids.length} site${ids.length === 1 ? "" : "s"} turned on.`;
    },
    savekey: () => {
      const v = ($("#apikey", el).value || "").trim();
      if (!v) { toast("Paste the key first"); return; }
      if (!setKey(v)) { toast("Couldn't save the key on this phone"); return; }
      $("#apikey", el).value = "";
      $("#keystatus", el).textContent = "A key is saved on this phone. Paste a new one to replace it, or tap Remove key.";
      toast("Key saved on this phone");
    },
    checkkey: async () => {
      const typed = ($("#apikey", el).value || "").trim();
      if (typed) setKey(typed);
      if (!hasKey()) { toast("Paste the key first"); return; }
      toast("Checking…");
      try {
        await checkKey(getKey());
        toast("That key works");
        if (typed) $("#apikey", el).value = "";
        $("#keystatus", el).textContent = "A key is saved on this phone. Paste a new one to replace it, or tap Remove key.";
      } catch (err) { toast(err.message || "That key couldn't be checked."); }
    },
    removekey: async () => {
      if (!hasKey()) { toast("No key saved"); return; }
      if (!(await confirmSheet({ title: "Remove the AI key?", body: "Drafts from a photo and Ask a question will not work until a key is pasted again.", ok: "Remove key", danger: true }))) return;
      removeKey();
      $("#apikey", el).value = "";
      $("#keystatus", el).textContent = "No key saved.";
      toast("Key removed");
    },
    export: async () => {
      const payload = exportPayload(ctx.items, ctx.version, Date.now(), {
        enabledSites: getEnabledIds(),
        mileage: getTrips(),
        settings: getSettings()
      });
      const text = JSON.stringify(payload, null, 2);
      if (/sk-[a-zA-Z0-9_-]{10,}/.test(text)) {
        toast("Backup was not saved because it looked like it contained a key.");
        return;
      }
      download(`flip-helper-backup-${monthKey()}.json`, text);
      toast("Backup saved");
    },
    exportcsv: () => {
      const text = itemsToCsv(ctx.items);
      if (/sk-[a-zA-Z0-9_-]{10,}/.test(text)) {
        toast("The spreadsheet was not saved because it looked like it contained a key.");
        return;
      }
      download(`flip-helper-items-${monthKey()}.csv`, text, "text/csv");
      toast("Spreadsheet saved");
    },
    savedrop: () => {
      const n = Number(($("#dropdays", el).value || "").trim());
      if (!Number.isFinite(n) || n < 1 || n > 365) { toast("Enter a number of days from 1 to 365"); return; }
      const floorRaw = ($("#profitfloor", el).value || "").trim();
      const desiredRaw = ($("#desiredprofit", el).value || "").trim();
      const floor = floorRaw === "" ? getSettings().defaultProfitFloor : Number(String(floorRaw).replace(/[^0-9.]/g, ""));
      const desired = desiredRaw === "" ? getSettings().desiredProfit : Number(String(desiredRaw).replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(floor) || floor < 0 || floor > 10000) { toast("Enter a profit floor, or leave the default"); return; }
      if (!Number.isFinite(desired) || desired < 0 || desired > 10000) { toast("Enter the profit you want when buying"); return; }
      setSettings({ dropAfterDays: n, defaultProfitFloor: floor, desiredProfit: desired });
      toast("Saved");
    },
    saverate: () => {
      const v = ($("#irsrate", el).value || "").trim();
      if (!v) { setSettings({ irsMileageRate: null }); toast("Using the official IRS rate"); return; }
      const n = Number(String(v).replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 10) { toast("Enter a rate per mile, or leave it blank"); return; }
      setSettings({ irsMileageRate: n });
      toast("Rate saved");
    },
    addbox: async () => {
      const values = await promptSheet({
        title: "Add a box",
        body: "Give it a name you'll recognize, and the inside measurements in inches.",
        ok: "Save box",
        fields: [
          { id: "label", type: "text", label: "Name", placeholder: "e.g. Shoebox", required: true },
          { id: "l", type: "text", inputmode: "decimal", label: "Length (in)", placeholder: "14" },
          { id: "w", type: "text", inputmode: "decimal", label: "Width (in)", placeholder: "9" },
          { id: "h", type: "text", inputmode: "decimal", label: "Height (in)", placeholder: "5" }
        ]
      });
      if (!values) return;
      const box = normalizeBox({ id: newBoxId(), label: values.label, lengthIn: values.l, widthIn: values.w, heightIn: values.h });
      const boxes = [...(getSettings().boxes || []), box];
      setSettings({ boxes });
      toast("Box saved");
      ctx.render();
    },
    delbox: b => {
      const boxes = (getSettings().boxes || []).filter(x => x.id !== b.dataset.id);
      setSettings({ boxes });
      ctx.render();
    },
    notify: async () => {
      const status = $("#notifystatus", el);
      if (!("Notification" in window)) {
        if (status) status.textContent = "This phone doesn't support notifications in the browser. In-app reminders will still work while the app is open.";
        toast("Notifications aren't available here");
        return;
      }
      try {
        const perm = await Notification.requestPermission();
        setSettings({ notifyDelist: perm === "granted" });
        if (status) status.textContent = perm === "granted"
          ? "Phone notifications are on, while the app is open."
          : perm === "denied"
            ? "Notifications are blocked. You can turn them on in this phone's settings for Safari. In-app reminders will still work."
            : "Notifications were not allowed. In-app reminders will still work.";
        toast(perm === "granted" ? "Reminders are on" : "In-app reminders will still work");
      } catch (e) {
        if (status) status.textContent = "Couldn't ask for notifications. In-app reminders will still work.";
      }
    },
    clearlog: async () => {
      if (!(await confirmSheet({ title: "Clear the log?", body: "This only clears the list of things that didn't work. Your items stay.", ok: "Clear" }))) return;
      clearActionLog();
      toast("Log cleared");
      ctx.render();
    },
    rewalk: () => {
      setWalkthroughDone(false);
      openWalkthrough({ onDone: () => toast("You can open this again any time from Settings.") });
    },
    watchintro: () => {
      openIntro({ mode: "welcome", fromSettings: true });
    },
    trydemo: () => {
      openIntro({ mode: "demo", fromSettings: true });
    },
    readterms: () => {
      openTerms({ mode: "read" });
    },
    csvimport: async () => {
      await runCsvImport(ctx, el);
    },
    mergegroup: async b => {
      const raw = b.dataset.ids || "";
      const ids = raw.split(",").filter(Boolean);
      const group = ctx.items.filter(i => ids.includes(i.id));
      if (group.length < 2) { toast("Those items aren't here any more."); return; }
      let merged = group[0];
      for (const other of group.slice(1)) merged = mergeItems(merged, other);
      await ctx.save(merged);
      for (const other of group.slice(1)) await ctx.remove(other.id);
      toast("Merged into one item");
      ctx.render();
    },
    wipe: async () => {
      if (!(await confirmSheet({ title: "Delete everything?", body: "Every item, photo, and Second look scan on this phone will be erased. The AI key will be removed too. Export a backup first if you want to keep your items.", ok: "Delete everything", danger: true }))) return;
      await ctx.store.wipe();
      removeKey();
      clearEnabledIds();
      clearSettings();
      clearTrips();
      clearReminders();
      clearActionLog();
      clearWork();
      clearScanWork();
      clearBatch();
      clearAskHistory();
      clearSecondLook();
      setWalkthroughDone(false);
      clearTerms();
      ctx.work = null;
      ctx.scanWork = null;
      toast("Everything deleted");
      await ctx.reload();
      ctx.go("#/home");
    }
  });
}

function openCsvMapper(ctx, el, parsed) {
  const box = $("#csv-import", el);
  if (!box) return;
  const suggested = suggestMapping(parsed.headers);
  box.hidden = false;
  const options = `<option value="">(skip this column)</option>` + CSV_FIELDS.map(f => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  box.innerHTML = `<h4 style="margin-top:16px">Match the columns</h4>
    <p class="small muted">We guessed some matches. Change any that are wrong, then import. ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} will be added as drafts. Existing items are not replaced.</p>
    <div class="tablewrap"><table class="fee-table" id="csv-map">
      <thead><tr><th>Column in your file</th><th>Use as</th></tr></thead>
      <tbody>${parsed.headers.map((h, i) => `<tr>
        <td>${esc(h || "(column " + (i + 1) + ")")}</td>
        <td><select data-csv-head="${esc(h)}">${options.replace(`value="${esc(suggested[h] || "")}"`, `value="${esc(suggested[h] || "")}" selected`)}</select></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <button type="button" class="btn" data-act="csvimport" style="margin-top:10px">Import these items</button>`;
  box._parsed = parsed;
  box.scrollIntoView({ block: "nearest" });
}

async function runCsvImport(ctx, el) {
  const box = $("#csv-import", el);
  const parsed = box && box._parsed;
  if (!parsed) { toast("Choose a spreadsheet first"); return; }
  const mapping = {};
  box.querySelectorAll("[data-csv-head]").forEach(sel => {
    mapping[sel.dataset.csvHead] = sel.value || "";
  });
  if (!Object.values(mapping).includes("title")) {
    toast("Please match at least one column to Title.");
    return;
  }
  const items = rowsToItems(parsed.rows, mapping);
  if (!items.length) { toast("No rows could be turned into items."); return; }
  for (const item of items) await ctx.store.put(normalizeItem(item));
  await ctx.reload();
  toast(`Imported ${items.length} item${items.length === 1 ? "" : "s"}`);
  const all = ctx.items;
  const groups = findDuplicateGroups(all);
  const dupeBox = $("#csv-dupes", el);
  box.hidden = true;
  if (groups.length && dupeBox) {
    dupeBox.hidden = false;
    dupeBox.innerHTML = `<h4>Possible duplicates</h4>
      <p class="small muted">These look similar. You can merge a group into one item. The first one keeps its photos; details from the others fill in any blanks.</p>
      ${groups.map(g => `<div class="advice-block">
        <p class="small">${(g.items || g).map(i => esc(i.title || "Untitled item")).join(" · ")}</p>
        <button type="button" class="btn sm soft" data-act="mergegroup" data-ids="${esc((g.items || g).map(i => i.id).join(","))}">Merge these</button>
      </div>`).join("")}`;
    dupeBox.scrollIntoView({ block: "nearest" });
  } else {
    ctx.render();
  }
}
