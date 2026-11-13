// Second look screen: scan a table, keep shopping while it runs, then review cards.
// Does not change Buy or pass, Add, the welcome video, or the agreement gate.
import { esc, $, toast, bind, honesty, copyText, closeSheets } from "../dom.js";
import { hasKey } from "../../core/key.js";
import {
  MSG_NO_KEY, MSG_NO_MEDIA, PRIVACY_NOTE, EARBUD_LATER,
  getJob, subscribeJob, startSecondLook, cancelJob, acknowledgeJob, resetJob,
  loadScans, getScan, saveScan, updateScan, dismissItem, markScanRead,
  removeScan, unreadScanCount,
  lookCardHtml, skippedHtml, haggleSheetHtml, bundleTip, decorateItem,
  scanWorkFromLookItem, haggleLines, formatUsd
} from "../../core/secondlook.js";
import { getSettings } from "../../core/settings.js";
import { getEnabledIds } from "../../core/prefs.js";

export function renderSecondLook(ctx, el, scanId) {
  paint(ctx, el, scanId);
  if (el._slUnsub) { try { el._slUnsub(); } catch (e) {} }
  el._slUnsub = subscribeJob(() => {
    // Only repaint if we're still on this screen.
    if (!el.isConnected) { try { el._slUnsub(); } catch (e) {} return; }
    const { head } = parseHead();
    if (head !== "secondlook") return;
    paint(ctx, el, currentScanId());
  });
}

function parseHead() {
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  const [head, ...rest] = raw.split("/");
  return { head: head || "home", rest };
}

function currentScanId() {
  const { head, rest } = parseHead();
  return head === "secondlook" ? (rest[0] || "") : "";
}

function paint(ctx, el, scanId) {
  const job = getJob();
  const id = scanId || (job.status === "done" && job.scanId) || "";
  const scan = id ? getScan(id) : null;
  if (scan && scan.unread) {
    markScanRead(scan.id);
    acknowledgeJob();
  }

  if (scan) {
    paintResults(ctx, el, scan, job);
    return;
  }
  if (job.status === "running") {
    paintRunning(ctx, el, job);
    return;
  }
  if (job.status === "error") {
    paintStart(ctx, el, job);
    return;
  }
  paintStart(ctx, el, job);
}

function top(title, back = "#/home") {
  return `<div class="topbar"><a class="iconbtn" href="${esc(back)}" aria-label="Back">‹</a><h2>${esc(title)}</h2><span class="spacer48"></span></div>`;
}

function privacy() {
  return `<p class="tiny muted sl-privacy">${esc(PRIVACY_NOTE)}</p>`;
}

function keyNote() {
  if (hasKey()) return "";
  return `<p class="attn" id="sl-nokey">${esc(MSG_NO_KEY)} <a href="#/settings">Open Settings</a></p>`;
}

function pastList(excludeId) {
  const scans = loadScans().filter(s => s.id !== excludeId);
  if (!scans.length) return "";
  const rows = scans.map(s => {
    const n = (s.items || []).filter(i => !i.dismissed).length;
    const when = formatWhen(s.createdAt);
    const thumb = s.coverThumb
      ? `<img class="thumb" src="${esc(s.coverThumb)}" alt="">`
      : `<span class="thumb ph" aria-hidden="true">👀</span>`;
    return `<li>
      <a class="li" href="#/secondlook/${esc(s.id)}">
        ${thumb}
        <span class="grow">
          <b>${s.kind === "video" ? "Video scan" : "Photo scan"}</b>
          <span class="tiny muted">${esc(when)} · ${n} ${n === 1 ? "thing" : "things"} to look at${s.unread ? " · new" : ""}</span>
        </span>
      </a>
    </li>`;
  }).join("");
  return `<div class="section-title"><h3>Your scans</h3></div>
    <ul class="itemlist" id="sl-scans">${rows}</ul>`;
}

function paintStart(ctx, el, job) {
  const err = job && job.status === "error" ? job.error : "";
  el.innerHTML = `
    ${top("Second look")}
    <div class="card">
      <div class="row between"><h3>A second set of eyes</h3>${honesty("ok", "Working")}</div>
      <p>At a flea market, garage sale, or thrift store, pan slowly across a table — or take one wide photo. The app picks out things that might be worth a closer look, while you keep browsing.</p>
      <p class="small muted">This is a first pass from a distance. Prices are estimates. You'll still want to walk back and check marks, tags, and condition yourself.</p>
      <div class="stack sl-start-actions">
        <label class="btn btn-main sl-filebtn">
          <input id="sl-record" type="file" accept="video/*" capture="environment" hidden>
          🎥 Record a slow pan
        </label>
        <label class="btn soft sl-filebtn">
          <input id="sl-pick-video" type="file" accept="video/*" hidden>
          Pick a video
        </label>
        <label class="btn soft sl-filebtn">
          <input id="sl-take-photo" type="file" accept="image/*" capture="environment" hidden>
          📷 Take a wide photo
        </label>
        <label class="btn soft sl-filebtn">
          <input id="sl-pick-photo" type="file" accept="image/*" hidden>
          Pick a photo
        </label>
      </div>
      ${keyNote()}
      ${err ? `<p class="attn" id="sl-error">${esc(err)}</p>` : ""}
      ${privacy()}
    </div>
    ${pastList()}
  `;
  wireFiles(ctx, el);
}

function paintRunning(ctx, el, job) {
  el.innerHTML = `
    ${top("Second look")}
    <div class="card" id="sl-running">
      <div class="row between"><h3>Looking…</h3>${honesty("ok", "Working")}</div>
      <p class="sl-progress-msg">${esc(job.progress || "Looking… you can keep shopping")}</p>
      <div class="sl-progress" role="progressbar" aria-label="Looking at your table"><span></span></div>
      <p class="small muted">You can go back to Home and keep shopping. We'll let you know when this is ready.</p>
      ${job.warning ? `<p class="small">${esc(job.warning)}</p>` : ""}
      <div class="stack" style="margin-top:14px">
        <a class="btn soft" href="#/home">Keep shopping</a>
        <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
      </div>
    </div>
  `;
  bind(el, {
    cancel: () => {
      cancelJob();
      toast("Cancelled.");
      paint(ctx, el, "");
    }
  });
}

function decorateScan(scan) {
  const settings = getSettings();
  const siteIds = getEnabledIds();
  const items = (scan.items || []).map(it => {
    if (it.haggle && it.haggle.ready) return it;
    return decorateItem(it, { desiredProfit: settings.desiredProfit, siteIds });
  });
  return { ...scan, items };
}

function paintResults(ctx, el, rawScan, job) {
  const scan = decorateScan(rawScan);
  const open = (scan.items || []).filter(it => !it.dismissed);
  const dismissed = (scan.items || []).filter(it => it.dismissed);
  const when = formatWhen(scan.createdAt);
  const cards = open.map(it => lookCardHtml(it)).join("");
  const empty = !open.length
    ? `<div class="card empty"><span class="em">👀</span><p>${(scan.items || []).length ? "You dismissed everything in this scan." : "Nothing jumped out as worth a closer look."}</p></div>`
    : "";
  el.innerHTML = `
    ${top("Second look")}
    <div class="card flat" id="sl-results-head">
      <div class="row between"><h3>Worth a closer look</h3>${honesty("warn", "Estimate")}</div>
      <p class="small muted">${esc(when)} · ${scan.kind === "video" ? "From a video" : "From a photo"}${scan.frameCount ? ` · ${scan.frameCount} still${scan.frameCount === 1 ? "" : "s"}` : ""}</p>
      ${scan.warning ? `<p class="small">${esc(scan.warning)}</p>` : ""}
      ${job && job.status === "running" ? `<p class="small">${esc(job.progress || "Looking… you can keep shopping")}</p><div class="sl-progress"><span></span></div>` : ""}
      <p class="tiny muted">These are AI guesses from a distance. Check each one yourself.</p>
    </div>
    <div id="sl-cards">${cards || empty}</div>
    ${dismissed.length ? `<details class="more-block" id="sl-dismissed" style="margin-top:14px"><summary>Not interested (${dismissed.length})</summary>
      ${dismissed.map(it => `<div class="row between" style="padding:10px 0;border-top:1px solid var(--line)">
        <span>${esc(it.name)}</span>
        <button type="button" class="btn sm soft" data-act="undismiss" data-id="${esc(it.id)}">Put back</button>
      </div>`).join("")}
    </details>` : ""}
    ${skippedHtml(scan.skipped, scan.note)}
    <div class="stack" style="margin-top:16px">
      <a class="btn soft" href="#/secondlook">Scan another table</a>
      <button type="button" class="btn ghost" data-act="deletescan">Delete this scan</button>
    </div>
    ${privacy()}
    ${pastList(scan.id)}
  `;
  bind(el, {
    closeup: b => takeCloseup(ctx, scan, b.dataset.id),
    haggle: b => openHaggle(ctx, el, scan, b.dataset.id),
    dismiss: b => {
      const next = dismissItem(scan.id, b.dataset.id, true);
      toast("Okay, hidden. You can put it back if you change your mind.");
      paint(ctx, el, next ? next.id : scan.id);
    },
    undismiss: b => {
      const next = dismissItem(scan.id, b.dataset.id, false);
      paint(ctx, el, next ? next.id : scan.id);
    },
    deletescan: () => {
      removeScan(scan.id);
      if (getJob().scanId === scan.id) resetJob();
      toast("Scan deleted. It was only on this phone.");
      ctx.go("#/secondlook");
    }
  });
}

function takeCloseup(ctx, scan, itemId) {
  const item = (scan.items || []).find(it => it.id === itemId);
  if (!item) { toast("That item isn't here any more."); return; }
  ctx.scanWork = scanWorkFromLookItem(item);
  toast("Take a close-up, then tap Identify and check. The guess is already filled in.");
  ctx.go("#/scan");
}

function openHaggle(ctx, el, scan, itemId) {
  const decorated = decorateScan(scan);
  const item = (decorated.items || []).find(it => it.id === itemId);
  if (!item) { toast("That item isn't here any more."); return; }
  const bundle = bundleTip(decorated.items);
  closeSheets();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.id = "sl-haggle-sheet";
  bg.innerHTML = `<div class="sheet sl-haggle-sheet" role="dialog" aria-modal="true" aria-labelledby="sl-haggle-title">
    <div id="sl-haggle-title" class="sr">Help me haggle</div>
    ${haggleSheetHtml(item, { bundle })}
    <div class="stack" style="margin-top:16px">
      <button type="button" class="btn soft" data-r="0">Close</button>
    </div>
  </div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", e => {
    if (e.target === bg || (e.target.closest("[data-r]") && e.target.closest("[data-r]").dataset.r === "0")) close();
  });
  bg.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "copyline") {
      const lines = haggleLines({ name: item.name, ...(item.haggle || {}) });
      const ok = await copyText(lines[+b.dataset.i] || "");
      toast(ok ? "Copied." : "Couldn't copy. You can select the text instead.");
    }
    if (b.dataset.act === "copybundle" && bundle) {
      const ok = await copyText(bundle.line);
      toast(ok ? "Copied." : "Couldn't copy. You can select the text instead.");
    }
  });
  document.body.appendChild(bg);
}

function wireFiles(ctx, el) {
  const start = async (input, kind) => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!hasKey()) {
      toast(MSG_NO_KEY);
      ctx.go("#/settings");
      return;
    }
    try {
      // Kick off and paint the running state immediately.
      const p = startSecondLook({ file, kind });
      paint(ctx, el, "");
      await p;
      const job = getJob();
      if (job.status === "done" && job.scanId) {
        // If she's still on this screen (or we send her here), the results are the notice.
        // A toast + banner fire from mountSecondLookBanner when she's shopping elsewhere.
        ctx.go("#/secondlook/" + job.scanId);
      } else if (job.status === "error") {
        paint(ctx, el, "");
      } else {
        paint(ctx, el, "");
      }
    } catch (e) {
      if (e && e.code === "no-key") {
        toast(MSG_NO_KEY);
        ctx.go("#/settings");
        return;
      }
      toast((e && e.message) || "The look-over couldn't be made. Try again.");
      paint(ctx, el, "");
    }
  };
  const rec = $("#sl-record", el);
  const pv = $("#sl-pick-video", el);
  const tp = $("#sl-take-photo", el);
  const pp = $("#sl-pick-photo", el);
  if (rec) rec.addEventListener("change", () => start(rec, "video"));
  if (pv) pv.addEventListener("change", () => start(pv, "video"));
  if (tp) tp.addEventListener("change", () => start(tp, "photo"));
  if (pp) pp.addEventListener("change", () => start(pp, "photo"));
}

function formatWhen(at) {
  if (!at) return "";
  try {
    return new Date(at).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  } catch (e) { return ""; }
}

/** A slim bar so she can see progress (or a ready badge) while browsing other screens. */
export function bannerHtml(job, { unread } = {}) {
  const j = job || getJob();
  if (j && j.status === "running") {
    return `<div class="sl-banner sl-banner-run" id="sl-banner" role="status">
      <a href="#/secondlook">${esc(j.progress || "Looking… you can keep shopping")}</a>
    </div>`;
  }
  if (j && j.status === "done" && j.unread !== false) {
    return `<div class="sl-banner sl-banner-done" id="sl-banner" role="status">
      <a href="#/secondlook/${esc(j.scanId || "")}">${esc(j.progress || "Your second look is ready.")}</a>
    </div>`;
  }
  if (j && j.status === "error" && j.error) {
    return `<div class="sl-banner sl-banner-err" id="sl-banner" role="status">
      <a href="#/secondlook">${esc(j.error)}</a>
    </div>`;
  }
  const n = unread != null ? unread : unreadScanCount();
  if (n > 0) {
    return `<div class="sl-banner sl-banner-done" id="sl-banner" role="status">
      <a href="#/secondlook">${n === 1 ? "A second look is ready." : n + " second looks are ready."} Tap to open.</a>
    </div>`;
  }
  return "";
}

export function mountSecondLookBanner(ctx) {
  let bar = document.getElementById("sl-chrome");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "sl-chrome";
    const view = document.getElementById("view");
    if (view && view.parentNode) view.parentNode.insertBefore(bar, view);
    else document.body.appendChild(bar);
  }
  const paint = () => {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const head = raw.split("/")[0] || "home";
    // On the Second look screen itself, the page already shows progress/results.
    if (head === "secondlook") {
      bar.innerHTML = "";
      document.body.classList.remove("sl-banner-on");
      return;
    }
    const html = bannerHtml(getJob());
    bar.innerHTML = html;
    document.body.classList.toggle("sl-banner-on", !!html);
  };
  paint();
  if (!mountSecondLookBanner._sub) {
    mountSecondLookBanner._sub = subscribeJob(() => {
      paint();
      const j = getJob();
      // Gentle in-app notice when a look finishes while she's on another screen.
      if (j && j.status === "done" && j.unread !== false && !window.__flipQuiet) {
        const raw = (location.hash || "").replace(/^#\/?/, "");
        const head = raw.split("/")[0] || "home";
        if (head !== "secondlook") toast(j.progress || "Your second look is ready.");
      }
    });
    window.addEventListener("hashchange", paint);
  }
  return paint;
}

export { formatWhen, EARBUD_LATER };
