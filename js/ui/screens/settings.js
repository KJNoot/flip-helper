import { esc, $, toast, bind, confirmSheet, download, honesty } from "../dom.js";
import { hasKey, setKey, removeKey, getKey } from "../../core/key.js";
import { checkKey } from "../../core/draft.js";
import { exportPayload, importPayload, importEnabledSites, monthKey } from "../../core/inventory.js";
import { SITES, SITE_GROUPS } from "../../core/sites.js";
import { getEnabledIds, setEnabledIds, clearEnabledIds } from "../../core/prefs.js";

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
      <p class="small">${honesty("ok", "Working")} Photo to a draft, your approval, inventory, profit, and a sold checklist. Works offline except for the AI draft.</p>
      <p class="small">${honesty("warn", "Needs you to post")} Posting and taking listings down is something you do in each site's own app. Flip Helper does not log into those accounts.</p>
      <p class="small">${honesty("later", "Coming later")} Official one-tap listing and take-down, starting with eBay, if that's set up later. Not promised for Poshmark, Mercari, or Facebook Marketplace unless those companies open an official door.</p>
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
      const payload = exportPayload(ctx.items, ctx.version, Date.now(), { enabledSites: getEnabledIds() });
      // Belt and suspenders: never let a key sneak into the file.
      const text = JSON.stringify(payload, null, 2);
      if (/sk-[a-zA-Z0-9_-]{10,}/.test(text)) {
        toast("Backup was not saved because it looked like it contained a key.");
        return;
      }
      download(`flip-helper-backup-${monthKey()}.json`, text);
      toast("Backup saved");
    },
    wipe: async () => {
      if (!(await confirmSheet({ title: "Delete everything?", body: "Every item and photo on this phone will be erased. The AI key will be removed too. Export a backup first if you want to keep your items.", ok: "Delete everything", danger: true }))) return;
      await ctx.store.wipe();
      removeKey();
      clearEnabledIds();
      ctx.work = null;
      toast("Everything deleted");
      await ctx.reload();
      ctx.go("#/home");
    }
  });
}
