// First-open welcome flags, Home Screen detection, and intro-video paths.
// The promo file, when Ken has approved it, is app/media/intro.mp4 (under ~15 MB).
// It is lazy-loaded and is not precached by the service worker.

export const INTRO_KEY = "flip-helper.introDone";
export const INTRO_VIDEO = "media/intro.mp4";
// Flip this to true when app/media/intro.mp4 is dropped in (tools/import-intro-video.sh does it).
// Kept false so a missing file is not requested on every first open.
export const INTRO_VIDEO_READY = false;
export const INTRO_POSTER = "media/intro-poster.jpg";
export const VIDEO_COMING_SOON = "Video coming soon";
export const INTRO_MAX_BYTES = 15 * 1024 * 1024;
export const SOUND_HINT = "Tap for sound";
export const SOUND_ON = "Sound is on";

function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export function introDone(storage) {
  const s = store(storage);
  if (!s) return false;
  try { return s.getItem(INTRO_KEY) === "1"; } catch (e) { return false; }
}

export function setIntroDone(done = true, storage) {
  const s = store(storage);
  if (!s) return;
  try {
    if (done) s.setItem(INTRO_KEY, "1");
    else s.removeItem(INTRO_KEY);
  } catch (e) { /* quota */ }
}

/**
 * Auto-show only on a true first open. If she already finished the older
 * welcome tips (v0.3), do not interrupt — she can watch from Settings.
 * Tests can pass quiet or ?nointro to skip.
 */
export function shouldShowIntro(storage, opts = {}) {
  if (opts.quiet) return false;
  if (opts.search && /[?&]nointro\b/.test(String(opts.search))) return false;
  if (introDone(storage)) return false;
  if (opts.respectWalkthrough && opts.walkthroughDone) return false;
  return true;
}

export function isStandalone(win = globalThis) {
  try {
    if (win && win.navigator && win.navigator.standalone === true) return true;
    if (win && typeof win.matchMedia === "function") {
      if (win.matchMedia("(display-mode: standalone)").matches) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

export function shouldShowAddToHomeScreen(win = globalThis) {
  return !isStandalone(win);
}

/**
 * Whether the welcome player should show the real video or the
 * "Video coming soon" placeholder. The file is optional until Ken drops it in.
 */
export function introVideoState({ exists, error, readyState, ready } = {}) {
  if (ready === false) return { mode: "placeholder", label: VIDEO_COMING_SOON };
  if (error || exists === false) return { mode: "placeholder", label: VIDEO_COMING_SOON };
  if (readyState != null && readyState < 1) return { mode: "placeholder", label: VIDEO_COMING_SOON };
  return { mode: "video", label: SOUND_HINT };
}

export { INTRO_KEY as KEY };
