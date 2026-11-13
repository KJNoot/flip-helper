import { esc, $, toast, bind, confirmSheet, download, honesty } from "../dom.js";
import { hasKey, setKey, removeKey, getKey } from "../../core/key.js";
import { checkKey } from "../../core/draft.js";
import { exportPayload, importPayload, importEnabledSites, importMileage, importSettings, monthKey } from "../../core/inventory.js";
import { SITES, SITE_GROUPS } from "../../core/sites.js";
import { getEnabledIds, setEnabledIds, clearEnabledIds } from "../../core/prefs.js";
import {
  getSettings, setSettings, clearSettings, getTrips, setTrips, clearTrips,
  clearReminders, mileageRateFor, IRS_PAGE
} from "../../core/settings.js";
import { ebayOfficialAdapter } from "../../core/comps.js";

export function renderSettings(ctx, el) {
  const n = ctx.items.length;
  const enabled = new Set(getEnabledIds());
  el.innerHTML = `
    <div class="topbar"><a class="iconbtn" href="#/home" aria-label="Back">‹</a><h2>Settings</h2><span class="spacer48"></span></div>

    <div class="card" id="keycard">
      <h3>AI key</h3>
      <p class="small">Paste the key Ken sent you. It stays on this phone only. It is never put in a backup, and it is only sent to the AI service when you make a draft from a photo or tap Check key.</p>
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
    </div>

    <div class="card" id="dropcard">
      <h3>Price-drop ideas</h3>
      <p class="small muted">When a listing has been up this many days with no sale, Flip Helper will suggest a price drop or sending offers. You approve each one, then change it on the site yourself.</p>
      <label class="field"><span>Suggest a drop after this many days</span>
        <input id="dropdays" type="number" min="1" max="365" inputmode="numeric" value="${esc(getSettings().dropAfterDays)}">
      </label>
      <button type="button" class="btn soft sm" data-act="savedrop">Save</button>
    </div>

    <div class="card" id="taxcard">
      <h3>Mileage rate</h3>
      <p class="small muted">Used when you log a trip on the <a href="#/taxes">Taxes</a> screen. Leave this blank to use the official IRS business rate for the date of the trip. The current rate we have is ${esc(String(mileageRateFor(Date.now(), { irsMileageRate: null }).rate))} per mile (${esc(mileageRateFor(Date.now(), { irsMileageRate: null }).source)}). Confirm at <a href="${esc(IRS_PAGE)}" target="_blank" rel="noopener">IRS.gov</a>.</p>
      <label class="field"><span>Your rate per mile (optional)</span>
        <input id="irsrate" type="text" inputmode="decimal" value="${esc(getSettings().irsMileageRate ?? "")}" placeholder="Leave blank for the official rate">
      </label>
      <button type="button" class="btn soft sm" data-act="saverate">Save rate</button>
    </div>

    <div class="card" id="remindcard">
      <div class="row between"><h3>Take-down reminders</h3>${honesty("ok", "Working")}</div>
      <p class="small muted">When something sells and is still listed on other sites, Flip Helper shows a countdown and reminds you in the app. If you allow notifications, you'll also get a phone notification while the app is open. Reminders while the app is closed need a computer helper, which is coming later.</p>
      <button type="button" class="btn soft" data-act="notify">${getSettings().notifyDelist ? "Reminders are on — tap to check again" : "Turn on take-down reminders"}</button>
      <p class="tiny muted" id="notifystatus"></p>
    </div>

    <div class="card" id="ebaycard">
      <div class="row between"><h3>Official eBay sold prices</h3>${honesty("later", "Coming later")}</div>
      <p class="small muted">${esc(ebayOfficialAdapter.needs)}. When that's set up, Flip Helper will look up real sold prices through eBay's official API, with your permission. It will not scrape eBay, and it will not ask for your eBay password.</p>
      <label class="check" style="opacity:.7">
        <input type="checkbox" disabled ${getSettings().ebayOfficialComps ? "checked" : ""}>
        <span>Use official eBay sold prices (not available yet)</span>
      </label>
    </div>

    <div class="card">
      <h3>Your data</h3>
      <p class="small muted">${n} item${n === 1 ? "" : "s"} on this phone. No account needed. Everything stays here, except photos you send for an AI draft.</p>
      <div class="stack">
        <button type="button" class="btn soft" data-act="export">⬇️ Export a backup file</button>
        <label class="btn soft" style="cursor:pointer">⬆️ Restore from backup<input type="file" id="imp" accept="application/json,.json" hidden></label>
        <button type="button" class="btn danger" data-act="wipe">🗑️ Delete everything</button>
      </div>
    </div>

    <div class="card flat honesty-card">
      <h3>What this version does</h3>
      <p class="small">${honesty("ok", "Working")} Photo to a draft, Buy or pass, inventory, profit, a sold take-down checklist with reminders, price-drop ideas, basic photo clean-up, and a tax year view. Works offline except for AI checks.</p>
      <p class="small">${honesty("warn", "Estimate")} AI prices, sold-price estimates, fees, shipping costs, and Buy or pass verdicts.</p>
      <p class="small">${honesty("warn", "Needs you to post")} Posting, taking listings down, and changing a price is something you do in each site's own app. Flip Helper does not log into those accounts.</p>
      <p class="small">${honesty("later", "Coming later")} Official one-tap listing and take-down, official eBay sold prices, a computer helper, and buying shipping labels. Not promised for Poshmark, Mercari, or Facebook Marketplace unless those companies open an official door.</p>
    </div>

    <div class="card flat">
      <h3>Privacy</h3>
      <p class="small">Your items and photos stay on this phone. The AI key stays on this phone. A photo is sent to the AI service only when you ask for a draft. No account is required. Flip Helper will not ask for a selling-site password.</p>
    </div>
    <p class="tiny muted center">Flip Helper v${esc(ctx.version)}</p>
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
      toast(err && /Flip Helper|couldn't be read|no items/i.test(err.message) ? err.message : "That file couldn't be read.");
    }
  });

  bind(el, {
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
      if (!(await confirmSheet({ title: "Remove the AI key?", body: "Drafts from a photo will not work until a key is pasted again.", ok: "Remove key", danger: true }))) return;
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
      // Belt and suspenders: never let a key sneak into the file.
      const text = JSON.stringify(payload, null, 2);
      if (/sk-[a-zA-Z0-9_-]{10,}/.test(text)) {
        toast("Backup was not saved because it looked like it contained a key.");
        return;
      }
      download(`flip-helper-backup-${monthKey()}.json`, text);
      toast("Backup saved");
    },
    savedrop: () => {
      const n = Number(($("#dropdays", el).value || "").trim());
      if (!Number.isFinite(n) || n < 1 || n > 365) { toast("Enter a number of days from 1 to 365"); return; }
      setSettings({ dropAfterDays: n });
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
    wipe: async () => {
      if (!(await confirmSheet({ title: "Delete everything?", body: "Every item and photo on this phone will be erased. The AI key will be removed too. Export a backup first if you want to keep your items.", ok: "Delete everything", danger: true }))) return;
      await ctx.store.wipe();
      removeKey();
      clearEnabledIds();
      clearSettings();
      clearTrips();
      clearReminders();
      ctx.work = null;
      ctx.scanWork = null;
      toast("Everything deleted");
      await ctx.reload();
      ctx.go("#/home");
    }
  });
}
