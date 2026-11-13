// First-open welcome (video or placeholder) and the sandboxed try-it demo.
import { toast } from "./dom.js";
import { demoHtml, busyHtml } from "./demo.js";
import {
  INTRO_VIDEO, INTRO_POSTER, VIDEO_COMING_SOON, SOUND_HINT, SOUND_ON,
  INTRO_VIDEO_READY, introVideoState, setIntroDone, isStandalone
} from "../core/intro.js";
import {
  emptySession, applySample, setDemoPhotos, draftForDemo, setDemoSites,
  startListing, revealNextListing, revealAllListings, pretendSold,
  startDemoTakedown, takeDownAllPretend, revealNextTakedown,
  markDemoPacked, markDemoShipped, gotoStep, demoDelay, PRETEND_BANNER
} from "../core/demo.js";
import { photoFromFile } from "../core/draft.js";
import { knownSiteIds } from "../core/sites.js";

let root = null;
let session = null;
let onDone = null;
let listingTimer = 0;

export function isIntroOpen() { return !!root; }

export function closeIntro({ completed = false } = {}) {
  clearTimeout(listingTimer);
  listingTimer = 0;
  const video = root && root.querySelector("#intro-vid");
  if (video) {
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) { /* ignore */ }
  }
  if (completed) setIntroDone(true);
  if (root) { root.remove(); root = null; }
  session = null;
  document.body.classList.remove("intro-open");
  const html = document.documentElement;
  delete html.dataset.intro;
  if (onDone) {
    const fn = onDone;
    onDone = null;
    fn({ completed });
  }
}

function paint() {
  if (!root || !session) return;
  const step = session.step || "welcome";
  root.setAttribute("data-intro-step", step);
  document.documentElement.dataset.intro = step;
  if (session._busy) {
    root.innerHTML = busyHtml(session._busy);
    return;
  }
  root.innerHTML = demoHtml(session, window);
  if (step === "welcome") bindVideo();
  if (step === "listing" && !session.listingDone) runListingAnimation();
  // Site checkboxes: live-update the session without a full confusing reset
  bindFiles();
}

function bindFiles() {
  const cam = root.querySelector("#demo-cam");
  const lib = root.querySelector("#demo-lib");
  const onFile = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const photo = await photoFromFile(f);
      session = setDemoPhotos(session, [photo]);
      session = gotoStep(session, "photo");
      paint();
    } catch (err) {
      toast(err && err.message ? err.message : "That photo couldn't be read.");
    }
  };
  if (cam) cam.addEventListener("change", onFile);
  if (lib) lib.addEventListener("change", onFile);
}

function bindVideo() {
  const video = root.querySelector("#intro-vid");
  const ph = root.querySelector("#intro-ph");
  const sound = root.querySelector('[data-act="sound"]');
  if (!video) return;
  const showPlaceholder = () => {
    const st = introVideoState({ exists: false });
    video.hidden = true;
    if (ph) {
      ph.hidden = false;
      const label = ph.querySelector(".intro-ph-label");
      if (label) label.textContent = st.label || VIDEO_COMING_SOON;
    }
    if (sound) sound.hidden = true;
  };
  const showVideo = () => {
    const st = introVideoState({ exists: true, readyState: video.readyState, error: video.error });
    if (st.mode !== "video") { showPlaceholder(); return; }
    video.hidden = false;
    if (ph) ph.hidden = true;
    if (sound) {
      sound.hidden = false;
      sound.textContent = video.muted ? SOUND_HINT : SOUND_ON;
    }
    video.play().catch(() => { /* autoplay may be blocked; poster stays */ });
  };
  video.addEventListener("loadeddata", showVideo);
  video.addEventListener("canplay", showVideo);
  video.addEventListener("error", showPlaceholder);
  // Lazy-load: set src only when the welcome is on screen AND the file has
  // been dropped in. Not precached. A missing file must not be requested
  // (that would 404 on every first open).
  video.poster = INTRO_POSTER;
  video.preload = "metadata";
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  if (!INTRO_VIDEO_READY) {
    showPlaceholder();
    return;
  }
  video.src = INTRO_VIDEO;
  video.load();
}

function runListingAnimation() {
  clearTimeout(listingTimer);
  const tick = () => {
    if (!session || session.step !== "listing") return;
    session = revealNextListing(session);
    paint();
    if (!session.listingDone) {
      listingTimer = setTimeout(tick, demoDelay(550));
    }
  };
  listingTimer = setTimeout(tick, demoDelay(200));
}

async function makeDraft() {
  session._busy = "Writing a draft from your photo…";
  paint();
  try {
    session = await draftForDemo(session);
  } finally {
    session._busy = "";
  }
  session = gotoStep(session, "draft");
  paint();
}

function readSitesFromDom() {
  if (!root) return session.siteIds;
  const boxes = [...root.querySelectorAll('[data-act="togglesite"]')];
  if (!boxes.length) return session.siteIds;
  const ids = boxes.filter(b => b.checked).map(b => b.dataset.site);
  return knownSiteIds(ids);
}

async function onAct(act, target) {
  if (!session) return;
  if (act === "sound") {
    const video = root.querySelector("#intro-vid");
    if (!video || video.hidden) return;
    video.muted = !video.muted;
    target.textContent = video.muted ? SOUND_HINT : SOUND_ON;
    video.play().catch(() => {});
    return;
  }
  if (act === "skip-video") {
    const video = root.querySelector("#intro-vid");
    if (video) { try { video.pause(); } catch (e) {} }
    const player = root.querySelector("#intro-player");
    if (player) player.classList.add("skipped");
    const ctas = root.querySelector(".intro-ctas");
    if (ctas) ctas.scrollIntoView({ behavior: window.__flipFast ? "auto" : "smooth", block: "start" });
    return;
  }
  if (act === "try-photo") {
    session = gotoStep(session || emptySession(), "photo");
    paint();
    return;
  }
  if (act === "try-sample" || act === "pick-sample") {
    if (act === "pick-sample" || target.dataset.sample) {
      const id = target.dataset.sample || target.closest("[data-sample]")?.dataset.sample;
      if (id) {
        session = applySample(emptySession(), id);
        paint();
        return;
      }
    }
    session = gotoStep(session.store ? session : emptySession(), "samples");
    paint();
    return;
  }
  if (act === "demo-cam" || act === "demo-lib") {
    const input = root.querySelector(act === "demo-cam" ? "#demo-cam" : "#demo-lib");
    if (input) input.click();
    return;
  }
  if (act === "make-draft") {
    await makeDraft();
    return;
  }
  if (act === "togglesite") {
    const boxes = [...root.querySelectorAll('[data-act="togglesite"]')];
    const ids = boxes.filter(b => b.checked).map(b => b.dataset.site);
    const next = knownSiteIds(ids);
    if (!next.length) {
      target.checked = true;
      toast("Pick at least one site.");
      return;
    }
    session = setDemoSites(session, next);
    return;
  }
  if (act === "list-pretend") {
    session = setDemoSites(session, readSitesFromDom());
    session = startListing(session);
    if (demoDelay(550) === 0) session = revealAllListings(session);
    paint();
    return;
  }
  if (act === "takedown-all") {
    session = startDemoTakedown(session);
    session = takeDownAllPretend(session);
    paint();
    return;
  }
  if (act === "packed") {
    session = markDemoPacked(session);
    session = gotoStep(session, "ship");
    paint();
    return;
  }
  if (act === "shipped") {
    session = markDemoShipped(session);
    session = gotoStep(session, "profit");
    paint();
    return;
  }
  if (act === "goto-end" || act === "skip-demo") {
    const video = root.querySelector("#intro-vid");
    if (video) { try { video.pause(); } catch (e) {} }
    session = gotoStep(session || emptySession(), "end");
    paint();
    return;
  }
  if (act === "start-real") {
    closeIntro({ completed: true });
    return;
  }
  if (act === "next") {
    await advance();
    return;
  }
}

async function advance() {
  const step = session.step;
  if (step === "draft") { session = gotoStep(session, "scan"); paint(); return; }
  if (step === "scan") { session = gotoStep(session, "sites"); paint(); return; }
  if (step === "sites") { await onAct("list-pretend", root); return; }
  if (step === "listing") { session = pretendSold(session); paint(); return; }
  if (step === "sold") {
    session = startDemoTakedown(session);
    paint();
    return;
  }
  if (step === "takedown") { session = gotoStep(session, "pack"); paint(); return; }
  if (step === "pack") { await onAct("packed", root); return; }
  if (step === "ship") { await onAct("shipped", root); return; }
  if (step === "profit") { session = gotoStep(session, "end"); paint(); return; }
}

/**
 * Open the welcome and/or demo overlay.
 * mode: "welcome" | "demo" | "end"
 * Opening from Settings should pass fromSettings: true so Start for real
 * just closes, without changing first-open memory if she already finished.
 */
export function openIntro({ mode = "welcome", onDone: done, fromSettings = false } = {}) {
  onDone = null; // don't fire a previous callback when replacing the overlay
  closeIntro({ completed: false });
  onDone = done || null;
  session = emptySession();
  if (mode === "demo") session = gotoStep(session, "samples");
  else if (mode === "end") session = gotoStep(session, "end");
  else session = gotoStep(session, "welcome");
  if (fromSettings) session.fromSettings = true;

  root = document.createElement("div");
  root.id = "intro-root";
  root.className = "intro-root";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Welcome to Jessika's Flip Side");
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b || !root.contains(b)) return;
    onAct(b.dataset.act, b);
  });
  document.body.classList.add("intro-open");
  document.body.appendChild(root);
  paint();
  return root;
}

export function getDemoSession() { return session; }

export { PRETEND_BANNER };
