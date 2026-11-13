// Second look: a second set of eyes at a flea market, garage sale, or thrift store.
// She films a slow pan, or takes one wide photo. The app pulls stills on this
// phone, sends them to the same AI used for pricing, and points out things
// worth a closer look. Pure helpers here are safe to unit-test in Node.
// Frames are sent only to OpenAI, and only for this look. Thumbnails stay
// on the phone. The key is never logged.

import { money, formatUsd } from "./inventory.js";
import { getKey } from "./key.js";
import { chatJson, extractJson, fileToDataUrl, downscaleDataUrl, AI_MODEL, requestScan } from "./draft.js";
import { buyUpTo, buyUpToLabel } from "./profit.js";
import { scanResult, normalizeScanDraft, itemFromScan } from "./scanner.js";
import { getSettings } from "./settings.js";
import { getEnabledIds } from "./prefs.js";
import { feeFor } from "./fees.js";
import { defaultShippingCost } from "./shipping.js";

export const FRAME_INTERVAL = 1.25;
export const MAX_FRAMES = 16;
export const PLAN_FRAMES = 24;
export const MAX_VIDEO_SECONDS = 120;
export const REFUSE_VIDEO_SECONDS = 300;
export const FRAME_MAX_EDGE = 768;
export const FRAME_JPEG_QUALITY = 0.68;
export const THUMB_MAX_EDGE = 320;
export const THUMB_JPEG_QUALITY = 0.72;
export const SCANS_KEY = "flip-helper.secondlook.scans";
export const MAX_SAVED_SCANS = 30;

export const MSG_NO_KEY = "To scan a table, paste the AI key in Settings first. It stays on this phone only.";
export const MSG_NO_MEDIA = "Take a video or a wide photo of the table first.";
export const MSG_TOO_LONG = "This video is too long to check. Try a clip under two minutes, or take a wide photo.";
export const MSG_BAD_VIDEO = "That video couldn't be read. Try taking it again, or use a wide photo instead.";
export const MSG_BAD_PHOTO = "That photo couldn't be read. Try taking it again.";
export const MSG_EMPTY = "The look-over wasn't in a form we could use. Try again.";
export const MSG_NETWORK = "Couldn't reach the AI service. Check your connection and try again.";
export const PRIVACY_NOTE = "Pictures are sent only to the AI service to look at the table, and are not uploaded anywhere else. Thumbnails stay on this phone.";
export const EARBUD_LATER = "Coming later. A quiet tip in your earbud while you talk isn't ready in this version — it needs to work reliably on an iPhone, and we would rather wait than ship something that might fail at a stall. For now, use the lines below. Be upfront and respectful when you haggle; this is a helper, not a trick.";

export const SECOND_LOOK_SYSTEM = `You are a second set of eyes for someone walking a flea market, garage sale, or thrift store. They filmed a slow pan or took one wide photo of a table or shelf of mixed items, many of which they may not recognize.

Look at every still. Pick out ONLY items that might be worth a closer look for resale in the US (vintage, brand-name, sterling or other metal, collectible, designer, tools, electronics, quality housewares, instruments, jewelry, unusual decor, and similar). Skip everyday clutter that is almost certainly low value (plain plastic hangers, chipped mugs with no mark, mass-market paperbacks, tangled cables, generic plastic toys in poor shape) — list those under "skipped".

This is a first pass from a distance. Do not give a firm price from a wide shot. Ranges are rough estimates, not from live sold listings, and you must say so. Prefer "take a closer look" over a confident identification. If a maker's mark, hallmark ("sterling", "925", "14K"), brand tag, or model number might be there, say to check for it — do not invent that you can already read it.

Reply with a single JSON object only, no markdown, with these keys:
- items: an array of things worth a closer look. Each object:
  - name: a short plain name or best guess (under 80 characters)
  - why: one short sentence on why it might be valuable. Say this is a guess from the photo.
  - priceLow, priceHigh: rough resale estimates in US dollars, numbers, or omit if you truly cannot tell
  - priceNote: one short sentence. You MUST say this is an estimate, not from checking sold listings.
  - confidence: "low" or "medium" (never "high" — you are looking from a distance)
  - frame: which still this is most visible in, a 1-based integer matching the image numbers you were given
  - box: { "x", "y", "w", "h" } as fractions from 0 to 1 of that frame (left, top, width, height). Approximate is fine.
  - where: plain words a person can use to find it again, like "left side of the table, near the clocks"
  - whatToCheck: an array of short phrases — what to look for up close (maker's marks, hallmarks such as sterling or 925, brand tags, model numbers, condition, completeness, chips, working order)
- skipped: an array of { "name", "reason" } for likely low-value things you passed over, or a short group ("plastic hangers and tangled cords"). Keep this brief.
- note: one short honest sentence about the look-over (blur, crowding, or "nothing jumped out").

If you cannot tell what is on the table, return an empty items array and say so in note. Do not invent brands, certificates, or exact sold prices. If the same item appears in several frames, list it once (use the clearest frame). Two similar items in different places should both be listed.`;

/* ---------- frame sampling (pure) ---------- */

export function planFrameTimes(duration, {
  interval = FRAME_INTERVAL,
  maxFrames = PLAN_FRAMES,
  maxDuration = MAX_VIDEO_SECONDS
} = {}) {
  const raw = Number(duration);
  if (!Number.isFinite(raw) || raw <= 0) return [];
  const d = Math.min(raw, maxDuration);
  if (d <= 0.5) return [Math.max(0, Math.min(d * 0.4, d - 0.01))];
  const times = [];
  // Skip a sliver at the start (often a black or jerky first frame) and the very end.
  let t = Math.min(0.4, d * 0.08);
  const last = Math.max(t, d - 0.12);
  while (t <= last + 1e-9 && times.length < maxFrames) {
    times.push(Math.round(t * 100) / 100);
    t += interval;
  }
  // Always try to include a frame near the end of the (capped) clip, without going over the cap.
  const end = Math.round(last * 100) / 100;
  if (times.length && (end - times[times.length - 1]) > interval * 0.45) {
    if (times.length < maxFrames) times.push(end);
    else times[times.length - 1] = end;
  }
  if (!times.length) times.push(Math.round((d / 2) * 100) / 100);
  // Deduplicate any rounding collisions, keep order.
  const out = [];
  for (const x of times) {
    if (!out.length || Math.abs(out[out.length - 1] - x) > 0.04) out.push(x);
  }
  return out;
}

export function videoLimit(duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return { ok: false, refuse: false, used: 0, warning: MSG_BAD_VIDEO };
  if (d > REFUSE_VIDEO_SECONDS) {
    return { ok: false, refuse: true, used: 0, warning: MSG_TOO_LONG };
  }
  if (d > MAX_VIDEO_SECONDS) {
    return {
      ok: true,
      refuse: false,
      used: MAX_VIDEO_SECONDS,
      warning: `This video is ${Math.round(d)} seconds, which is a bit long. I'll look at the first two minutes. A shorter clip or a wide photo is quicker.`
    };
  }
  return { ok: true, refuse: false, used: d, warning: "" };
}

/** Block-average luminance grid, used to skip near-duplicate frames. */
export function blockMeans(data, width, height, size = 8) {
  const bytes = data instanceof Uint8ClampedArray || data instanceof Uint8Array ? data : Uint8Array.from(data || []);
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const s = Math.max(2, size | 0);
  const out = new Array(s * s);
  for (let by = 0; by < s; by++) {
    for (let bx = 0; bx < s; bx++) {
      const x0 = Math.floor(bx * w / s);
      const x1 = Math.max(x0 + 1, Math.floor((bx + 1) * w / s));
      const y0 = Math.floor(by * h / s);
      const y1 = Math.max(y0 + 1, Math.floor((by + 1) * h / s));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * w + x) * 4;
          if (o + 2 >= bytes.length) continue;
          sum += 0.2126 * bytes[o] + 0.7152 * bytes[o + 1] + 0.0722 * bytes[o + 2];
          n++;
        }
      }
      out[by * s + bx] = n ? sum / n : 0;
    }
  }
  return out;
}

export function signatureDistance(a, b) {
  const aa = a && a.blocks ? a.blocks : a;
  const bb = b && b.blocks ? b.blocks : b;
  if (!aa || !bb || !aa.length || aa.length !== bb.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < aa.length; i++) sum += Math.abs((aa[i] || 0) - (bb[i] || 0));
  return sum / aa.length;
}

export function isNearDuplicate(a, b, { maxAvg = 10 } = {}) {
  if (!a || !b) return false;
  return signatureDistance(a, b) <= maxAvg;
}

/**
 * Drop near-duplicate frames, then keep at most `maxFrames`, spaced evenly
 * across the surviving unique frames so the end of a pan is not cut off.
 */
export function selectFrames(candidates, { maxFrames = MAX_FRAMES, maxAvg = 10 } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const unique = [];
  for (const c of list) {
    const sig = c && (c.hash || c.signature || c.blocks);
    if (sig && unique.some(p => isNearDuplicate(p.hash || p.signature || p.blocks, sig, { maxAvg }))) continue;
    unique.push(c);
  }
  if (unique.length <= maxFrames) return unique;
  if (maxFrames <= 1) return [unique[0]];
  const out = [];
  const used = new Set();
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round(i * (unique.length - 1) / (maxFrames - 1));
    if (used.has(idx)) continue;
    used.add(idx);
    out.push(unique[idx]);
  }
  return out;
}

/* ---------- boxes, crops, "where" (pure) ---------- */

export function normalizeBox(raw) {
  if (!raw) return null;
  let x, y, w, h;
  if (Array.isArray(raw) && raw.length >= 4) {
    [x, y, w, h] = raw;
  } else if (typeof raw === "object") {
    x = raw.x ?? raw.left ?? raw.l;
    y = raw.y ?? raw.top ?? raw.t;
    w = raw.w ?? raw.width ?? raw.wd;
    h = raw.h ?? raw.height ?? raw.ht;
    // x2/y2 form
    if (w == null && raw.x2 != null && x != null) w = Number(raw.x2) - Number(x);
    if (h == null && raw.y2 != null && y != null) h = Number(raw.y2) - Number(y);
  } else {
    return null;
  }
  x = Number(x); y = Number(y); w = Number(w); h = Number(h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  // If values look like percentages (0–100) rather than fractions, scale down.
  const max = Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h));
  if (max > 1.5 && max <= 100.5) {
    x /= 100; y /= 100; w /= 100; h /= 100;
  }
  // If values look like pixel coordinates without a size, we cannot scale — reject huge numbers.
  if (Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h)) > 1.5) return null;
  if (w < 0) { x = x + w; w = -w; }
  if (h < 0) { y = y + h; h = -h; }
  // Clamp to 0–1, keep a little area.
  const x2 = Math.min(1, Math.max(0, x) + Math.max(0, w));
  const y2 = Math.min(1, Math.max(0, y) + Math.max(0, h));
  const cx = Math.max(0, Math.min(1, x));
  const cy = Math.max(0, Math.min(1, y));
  const cw = Math.max(0.04, x2 - cx);
  const ch = Math.max(0.04, y2 - cy);
  if (cx >= 1 || cy >= 1) return null;
  return {
    x: Math.round(cx * 1000) / 1000,
    y: Math.round(cy * 1000) / 1000,
    w: Math.round(Math.min(1 - cx, cw) * 1000) / 1000,
    h: Math.round(Math.min(1 - cy, ch) * 1000) / 1000
  };
}

export function pixelCropBounds(width, height, box, pad = 0.08) {
  const W = Math.max(1, width | 0);
  const H = Math.max(1, height | 0);
  const b = normalizeBox(box) || { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.max(0, (b.x - pad) * W);
  const y = Math.max(0, (b.y - pad) * H);
  const r = Math.min(W, (b.x + b.w + pad) * W);
  const btm = Math.min(H, (b.y + b.h + pad) * H);
  const w = Math.max(1, r - x);
  const h = Math.max(1, btm - y);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function whereFromBox(box) {
  const b = normalizeBox(box);
  if (!b) return "on the table";
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const lr = cx < 0.33 ? "left side" : cx > 0.67 ? "right side" : "middle";
  const fb = cy < 0.33 ? "toward the back" : cy > 0.67 ? "toward the front" : "";
  if (fb) return `${lr} of the table, ${fb}`;
  return `${lr} of the table`;
}

/* ---------- JSON parse / validate / dedupe (pure) ---------- */

function asConfidence(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "low") return "low";
  if (s === "medium" || s === "med" || s === "moderate") return "medium";
  // From a distance we never treat a "high" as high.
  if (s === "high") return "medium";
  return "medium";
}

function asCheckList(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map(x => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") return String(x.text || x.item || x.check || "").trim();
      return String(x || "").trim();
    }).filter(Boolean).slice(0, 10);
  }
  return String(raw).split(/[;•\n]|(?<=\w)\.\s+/).map(s => s.replace(/^[-*]\s*/, "").trim()).filter(Boolean).slice(0, 10);
}

function asFrameIndex(raw, frameCount) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  // Accept 0-based if it looks like it (0, and count would make 0 valid).
  let i = Math.round(n);
  if (i === 0 && frameCount) return 1;
  if (i < 1) i = 1;
  if (frameCount && i > frameCount) i = frameCount;
  return i;
}

export function nameKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function namesSimilar(a, b) {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka))) return true;
  const ta = ka.split(" ").filter(t => t.length > 2);
  const tb = new Set(kb.split(" ").filter(t => t.length > 2));
  if (!ta.length || !tb.size) return false;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  const min = Math.min(ta.length, tb.size);
  return min > 0 && n / min >= 0.7;
}

export function boxesOverlap(a, b, minIou = 0.35) {
  const aa = normalizeBox(a), bb = normalizeBox(b);
  if (!aa || !bb) return false;
  const ax2 = aa.x + aa.w, ay2 = aa.y + aa.h;
  const bx2 = bb.x + bb.w, by2 = bb.y + bb.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(aa.x, bb.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(aa.y, bb.y));
  const inter = ix * iy;
  const union = aa.w * aa.h + bb.w * bb.h - inter;
  return union > 0 && inter / union >= minIou;
}

function confRank(c) { return c === "medium" ? 2 : c === "low" ? 1 : 0; }

export function mergeLookItems(a, b) {
  const checks = [...(a.whatToCheck || [])];
  for (const c of (b.whatToCheck || [])) {
    if (!checks.some(x => nameKey(x) === nameKey(c))) checks.push(c);
  }
  const pickA = confRank(a.confidence) >= confRank(b.confidence);
  const primary = pickA ? a : b;
  const other = pickA ? b : a;
  const low = [money(a.priceLow), money(b.priceLow)].filter(v => v != null);
  const high = [money(a.priceHigh), money(b.priceHigh)].filter(v => v != null);
  return {
    ...primary,
    why: primary.why || other.why,
    priceLow: low.length ? Math.min(...low) : primary.priceLow,
    priceHigh: high.length ? Math.max(...high) : primary.priceHigh,
    priceNote: primary.priceNote || other.priceNote,
    where: (primary.where && primary.where !== "on the table") ? primary.where : (other.where || primary.where),
    whatToCheck: checks.slice(0, 10),
    box: primary.box || other.box
  };
}

/** Same item if the names match and they share a place or a frame. Two similar things in different places are kept. */
export function isSameLookItem(a, b) {
  if (!a || !b || !namesSimilar(a.name, b.name)) return false;
  if (a.where && b.where && nameKey(a.where) && nameKey(a.where) === nameKey(b.where)) return true;
  if (boxesOverlap(a.box, b.box)) return true;
  if (a.frame != null && b.frame != null && a.frame === b.frame) return true;
  return false;
}

export function dedupeItems(items) {
  const out = [];
  for (const it of (items || [])) {
    const hit = out.findIndex(x => isSameLookItem(x, it));
    if (hit < 0) out.push(it);
    else out[hit] = mergeLookItems(out[hit], it);
  }
  return out;
}

export function normalizeLookItem(raw, index = 0, frames = []) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const name = raw.trim();
    if (!name) return null;
    return {
      id: "li_" + (index + 1),
      name,
      why: "",
      priceLow: null,
      priceHigh: null,
      priceNote: "",
      confidence: "low",
      frame: 1,
      box: null,
      where: "on the table",
      whatToCheck: [],
      thumbDataUrl: "",
      dismissed: false,
      checked: false,
      checkedAt: null,
      firstGuess: null,
      verified: null,
      closeupPhotos: []
    };
  }
  if (typeof raw !== "object") return null;
  const name = String(raw.name || raw.title || raw.guess || raw.item || "").trim();
  if (!name) return null;
  let low = money(raw.priceLow ?? raw.price_low ?? raw.resaleLow ?? raw.low);
  let high = money(raw.priceHigh ?? raw.price_high ?? raw.resaleHigh ?? raw.high);
  if (low != null && high != null && low > high) { const t = low; low = high; high = t; }
  if (low != null && low < 0) low = 0;
  if (high != null && high < 0) high = 0;
  const box = normalizeBox(raw.box || raw.bbox || raw.location || raw.bounds);
  const frame = asFrameIndex(raw.frame ?? raw.frameIndex ?? raw.image, frames.length);
  const where = String(raw.where || raw.place || raw.spot || "").trim() || whereFromBox(box);
  const priceNote = String(raw.priceNote || raw.price_note || raw.priceReason || raw.price_reason || "").trim();
  return {
    id: String(raw.id || ("li_" + (index + 1))),
    name: name.slice(0, 120),
    why: String(raw.why || raw.reason || raw.whyItMightBeValuable || "").trim(),
    priceLow: low,
    priceHigh: high,
    priceNote,
    confidence: asConfidence(raw.confidence),
    frame,
    box,
    where,
    whatToCheck: asCheckList(raw.whatToCheck || raw.what_to_check || raw.check || raw.checks),
    thumbDataUrl: typeof raw.thumbDataUrl === "string" ? raw.thumbDataUrl : "",
    dismissed: !!raw.dismissed,
    brand: String(raw.brand || "").trim(),
    category: String(raw.category || "").trim(),
    condition: String(raw.condition || "").trim(),
    checked: !!raw.checked,
    checkedAt: raw.checkedAt || null,
    firstGuess: normalizeFirstGuess(raw.firstGuess),
    verified: normalizeVerified(raw.verified),
    closeupPhotos: normalizeCloseupPhotos(raw.closeupPhotos),
    closeupDraft: raw.closeupDraft && typeof raw.closeupDraft === "object" ? raw.closeupDraft : null,
    listedItemId: String(raw.listedItemId || ""),
    listNowAt: raw.listNowAt || null,
    quantity: Number(raw.quantity) > 0 ? Math.round(Number(raw.quantity)) : (raw.quantity == null ? undefined : 1),
    lookedDeeper: !!raw.lookedDeeper,
    tile: raw.tile != null && Number.isFinite(Number(raw.tile)) ? Number(raw.tile) : undefined,
    boxRefined: !!raw.boxRefined,
    sourceScanIds: Array.isArray(raw.sourceScanIds) ? raw.sourceScanIds.map(String) : undefined
  };
}

function normalizeSkipped(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string" && raw.trim()) return [{ name: raw.trim(), reason: "" }];
    return [];
  }
  return raw.map(s => {
    if (typeof s === "string") {
      const name = s.trim();
      return name ? { name, reason: "" } : null;
    }
    if (!s || typeof s !== "object") return null;
    const name = String(s.name || s.title || s.item || s.group || "").trim();
    const reason = String(s.reason || s.why || s.note || "").trim();
    if (!name && !reason) return null;
    return { name: name || "Something on the table", reason };
  }).filter(Boolean).slice(0, 20);
}

export function normalizeSecondLook(raw, frames = []) {
  if (raw == null) return { items: [], skipped: [], note: "", ok: false, error: MSG_EMPTY };
  if (typeof raw === "string") {
    try { raw = extractJson(raw); }
    catch (e) { return { items: [], skipped: [], note: "", ok: false, error: MSG_EMPTY }; }
  }
  if (typeof raw !== "object") return { items: [], skipped: [], note: "", ok: false, error: MSG_EMPTY };
  const list = Array.isArray(raw.items) ? raw.items
    : Array.isArray(raw.worthALook) ? raw.worthALook
    : Array.isArray(raw.worth_a_look) ? raw.worth_a_look
    : Array.isArray(raw) ? raw
    : [];
  const items = dedupeItems(list.map((it, i) => normalizeLookItem(it, i, frames)).filter(Boolean));
  const skipped = normalizeSkipped(raw.skipped || raw.skippedItems || raw.skipped_items || raw.lowValue);
  const note = String(raw.note || raw.notes || raw.summary || "").trim();
  return { items, skipped, note, ok: true, error: "" };
}

export function parseSecondLookResponse(text, frames = []) {
  try {
    if (text && typeof text === "object" && !Array.isArray(text) && (text.items || text.skipped || text.note || text.worthALook)) {
      return normalizeSecondLook(text, frames);
    }
    const json = extractJson(text);
    return normalizeSecondLook(json, frames);
  } catch (e) {
    return { items: [], skipped: [], note: "", ok: false, error: MSG_EMPTY };
  }
}

/* ---------- haggle math (pure) ---------- */

export function friendlyRound(n) {
  const v = money(n);
  if (v == null) return null;
  if (v <= 0) return 0;
  if (v < 5) return money(Math.round(v * 2) / 2);
  if (v < 25) return money(Math.round(v));
  if (v < 100) return money(Math.round(v / 5) * 5);
  return money(Math.round(v / 10) * 10);
}

/**
 * Opening offer, fair price, and walk-away, from Buy up to (and an optional asking price).
 * Walk-away is the most she should pay: Buy up to, which already holds back fees,
 * shipping, and the profit she wants. Opening is a polite first number below that.
 * Never suggests paying more than they're asking.
 */
export function haggleNumbers({ priceLow, priceHigh, buyUpTo: buy, asking, profitFloor } = {}) {
  const buyV = money(buy);
  const low = money(priceLow);
  const high = money(priceHigh);
  const mid = (low != null && high != null) ? money((low + high) / 2) : (low ?? high);
  const ask = money(asking);
  void profitFloor; // walk-away already reflects desired profit via Buy up to

  let walkAway = buyV;
  if (walkAway == null && mid != null) {
    // No fee math available: a conservative fraction of mid resale.
    walkAway = money(mid * 0.35);
  }
  if (walkAway == null) {
    return { opening: null, fair: null, walkAway: null, ready: false };
  }
  if (walkAway < 0) walkAway = 0;

  // If they're already asking at or under her max, she need not go higher than asking.
  if (ask != null && ask >= 0 && (walkAway <= 0 || ask <= walkAway)) {
    walkAway = ask;
  }

  if (walkAway === 0) {
    return { opening: 0, fair: 0, walkAway: 0, ready: true };
  }

  let opening = friendlyRound(walkAway * 0.55);
  let fair = friendlyRound(walkAway * 0.8);
  if (opening == null) opening = money(Math.max(0, walkAway * 0.55));
  if (fair == null) fair = money(Math.max(opening, walkAway * 0.8));

  if (ask != null && ask > 0 && ask <= (money(buy) ?? ask)) {
    opening = friendlyRound(Math.min(opening, Math.max(0, ask * 0.8)));
    fair = friendlyRound(Math.min(Math.max(fair, opening), ask));
  }

  // Keep opening < fair <= walkAway when there's room.
  if (fair > walkAway) fair = friendlyRound(walkAway) ?? walkAway;
  if (opening > fair) opening = fair;
  if (opening >= fair && walkAway > 0) {
    const step = walkAway >= 10 ? 1 : 0.5;
    opening = friendlyRound(Math.max(0, fair - step));
    if (opening >= fair && fair > 0) opening = money(Math.max(0, fair - step));
  }
  if (fair >= walkAway && walkAway > opening) {
    // fair can equal walk-away when the range is tight
    fair = walkAway;
  }
  return {
    opening: money(opening) ?? 0,
    fair: money(fair) ?? walkAway,
    walkAway: money(walkAway) ?? 0,
    ready: true
  };
}

export function haggleLines({ name, opening, fair, walkAway } = {}) {
  const item = String(name || "this").trim() || "this";
  if (walkAway === 0 && opening === 0) {
    return [
      `I love it, but I don't think I could resell this for enough to pay for it. I might only be able to take it if it were free or almost free.`,
      `No worries at all if that doesn't work — thank you for letting me look.`,
      `I'll leave it with you. Thanks either way.`
    ];
  }
  const o = formatUsd(opening);
  const f = formatUsd(fair);
  const w = formatUsd(walkAway);
  return [
    `Hi, would you take ${o} for the ${item}?`,
    `I could go to ${f} if that helps.`,
    `I need to stick to about ${w} as my highest. Thanks either way — no pressure.`
  ];
}

export function bundleTip(items) {
  const list = (items || []).filter(it => it && !it.dismissed && it.haggle && it.haggle.ready && it.haggle.walkAway > 0);
  if (list.length < 2) return null;
  const sum = (fn) => list.reduce((s, it) => s + (money(fn(it)) ?? 0), 0);
  const offer = friendlyRound(sum(it => it.haggle.opening) * 0.9);
  const fair = friendlyRound(sum(it => it.haggle.fair) * 0.92);
  const walk = friendlyRound(Math.min(sum(it => it.haggle.walkAway) * 0.95, sum(it => it.haggle.walkAway)));
  const names = list.map(it => it.name);
  const who = names.length === 2
    ? `${names[0]} and the ${names[1]}`
    : names.length === 3
      ? `${names[0]}, the ${names[1]}, and the ${names[2]}`
      : `${names.slice(0, -1).join(", ")}, and the ${names[names.length - 1]}`;
  return {
    count: list.length,
    names,
    ids: list.map(it => it.id),
    offer: offer ?? 0,
    fair: fair ?? 0,
    walkAway: walk ?? 0,
    line: `Would you do ${formatUsd(offer)} for these ${list.length} together — the ${who}?`
  };
}

/**
 * Buy-up-to (and optional fee math) from a table-scan estimate, using the
 * same helpers as Buy or pass. Labeled as an estimate — no close-up yet.
 */
export function estimatesForItem(item, { desiredProfit, siteIds, weightOz = 16 } = {}) {
  const settings = (desiredProfit == null) ? getSettingsSafe() : { desiredProfit };
  const desired = money(settings.desiredProfit) ?? 10;
  const ids = siteIds && siteIds.length ? siteIds : getEnabledSafe();
  const low = money(item && item.priceLow);
  const high = money(item && item.priceHigh);
  const mid = (low != null && high != null) ? money((low + high) / 2) : (low ?? high);
  // scanResult's Buy up to falls back to the first site when there's no asking
  // price (so every net is null). For a table scan we don't have an asking
  // price yet, so pick the best Buy up to among her sites — including local
  // pickup, which has no fees and no shipping.
  let buy = null;
  let bestId = null;
  for (const id of (ids && ids.length ? ids : ["ebay", "facebook"])) {
    const local = id === "facebook" || id === "offerup" || id === "craigslist";
    const fee = mid != null ? (feeFor(id, mid, { local }).fee ?? 0) : 0;
    const ship = local ? 0 : (defaultShippingCost(weightOz) ?? 0);
    const b = buyUpTo({ resale: mid, fees: fee, shipping: ship, desiredProfit: desired });
    if (b != null && (buy == null || b > buy)) { buy = b; bestId = id; }
  }
  const result = scanResult({
    asking: null,
    resaleLow: low,
    resaleHigh: high,
    siteIds: ids,
    weightOz,
    desiredProfit: desired
  });
  const haggle = haggleNumbers({
    priceLow: low,
    priceHigh: high,
    buyUpTo: buy,
    profitFloor: settings.defaultProfitFloor
  });
  return {
    buyUpTo: buy,
    buyUpToLabel: buyUpToLabel(buy),
    result: { ...result, buyUpTo: buy, buyUpToLabel: buyUpToLabel(buy), bestSite: bestId || result.bestSite },
    haggle,
    desiredProfit: desired
  };
}

function getSettingsSafe() {
  try { return getSettings(); } catch (e) { return { desiredProfit: 10, defaultProfitFloor: 5 }; }
}
function getEnabledSafe() {
  try { return getEnabledIds(); } catch (e) { return ["ebay", "poshmark", "mercari", "facebook"]; }
}

export function decorateItem(item, opts) {
  const est = estimatesForItem(item, opts);
  return { ...item, buyUpTo: est.buyUpTo, buyUpToLabel: est.buyUpToLabel, haggle: est.haggle };
}

export const FIRST_GUESS_LABEL = "First guess from the table: check it up close";

export function normalizeFirstGuess(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    name: String(raw.name || "").trim(),
    priceLow: money(raw.priceLow),
    priceHigh: money(raw.priceHigh),
    priceNote: String(raw.priceNote || "").trim(),
    why: String(raw.why || "").trim(),
    buyUpTo: money(raw.buyUpTo),
    buyUpToLabel: String(raw.buyUpToLabel || "").trim(),
    haggle: raw.haggle || null,
    confidence: raw.confidence || "medium"
  };
}

export function normalizeVerified(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    name: String(raw.name || raw.title || "").trim(),
    priceLow: money(raw.priceLow),
    priceHigh: money(raw.priceHigh),
    priceNote: String(raw.priceNote || raw.priceReason || "").trim(),
    brand: String(raw.brand || "").trim(),
    condition: String(raw.condition || "").trim(),
    category: String(raw.category || "").trim(),
    at: raw.at || null
  };
}

export function normalizeCloseupPhotos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    if (typeof p === "string" && p.startsWith("data:")) return { dataUrl: p };
    if (p && typeof p === "object" && typeof p.dataUrl === "string") {
      return { dataUrl: p.dataUrl, name: p.name || "", addedAt: p.addedAt || null };
    }
    return null;
  }).filter(Boolean).slice(0, 8);
}

/** Keep the original table-scan guess if we already have one; otherwise snapshot the current fields. */
export function snapshotFirstGuess(item) {
  if (!item || typeof item !== "object") return null;
  if (item.firstGuess && typeof item.firstGuess === "object") {
    const snap = normalizeFirstGuess(item.firstGuess);
    if (snap && (snap.name || snap.priceLow != null || snap.priceHigh != null)) return snap;
  }
  return normalizeFirstGuess(item);
}

/** After a close-up is priced (existing requestScan + normalizeScanDraft), mark the card Checked and replace the first guess on the card. */
export function applyCloseupResult(item, { draft, result, photos } = {}, at = Date.now(), opts) {
  const it = item || {};
  const first = snapshotFirstGuess(it);
  const d = draft || {};
  const photosList = normalizeCloseupPhotos(photos);
  const firstPhoto = photosList[0];
  const thumb = (firstPhoto && firstPhoto.dataUrl) || it.thumbDataUrl || "";
  const low = money(d.priceLow);
  const high = money(d.priceHigh);
  const next = {
    ...it,
    name: String(d.title || it.name || "").trim() || it.name,
    brand: String(d.brand || it.brand || "").trim(),
    category: String(d.category || it.category || "").trim(),
    condition: String(d.condition || "").trim(),
    priceLow: low,
    priceHigh: high,
    priceNote: String(d.priceReason || d.priceNote || "").trim() || "This is an estimate from the close-up, not from checking sold listings.",
    why: String(d.notes || d.description || it.why || "").trim(),
    confidence: "medium",
    firstGuess: first,
    checked: true,
    checkedAt: at,
    closeupPhotos: photosList,
    closeupDraft: d && typeof d === "object" ? d : null,
    verified: {
      name: String(d.title || it.name || "").trim(),
      priceLow: low,
      priceHigh: high,
      priceNote: String(d.priceReason || "").trim(),
      brand: String(d.brand || "").trim(),
      condition: String(d.condition || "").trim(),
      category: String(d.category || "").trim(),
      at
    },
    thumbDataUrl: thumb
  };
  return decorateItem(next, opts);
}

export function closeupNotes(item) {
  return [
    "This is a close-up of just this item, to verify a first guess from a table scan.",
    item && item.name ? "First guess name: " + item.name + "." : "",
    item && item.where ? "Found at: " + item.where + "." : "",
    item && item.whatToCheck && item.whatToCheck.length ? "Please look for: " + item.whatToCheck.join("; ") + "." : "",
    "Identify the item and estimate what it might resell for. Look at any marks, tags, or labels in the photos."
  ].filter(Boolean).join(" ");
}

/** Run the existing single-item pricing (requestScan + normalizeScanDraft). Does not change that flow. */
export async function runCloseupCheck(item, { photos, key, fetchImpl, enabledSites, desiredProfit, model } = {}) {
  if (!photos || !photos.length) {
    const err = new Error("Take a picture of just this item first.");
    err.code = "no-photo";
    throw err;
  }
  const sites = enabledSites || getEnabledSafe();
  const { json } = await requestScan({
    photos,
    notes: closeupNotes(item),
    key,
    fetchImpl,
    enabledSites: sites,
    model
  });
  const draft = normalizeScanDraft(json);
  return applyCloseupResult(item, { draft, photos }, Date.now(), {
    desiredProfit,
    siteIds: sites
  });
}

export function setItemOnScan(scanId, item, storage) {
  if (!item) return getScan(scanId, storage);
  const scan = getScan(scanId, storage);
  if (!scan) return null;
  const items = (scan.items || []).map(it => it.id === item.id ? item : it);
  return updateScan(scanId, { items }, storage);
}

/** Unchecked (and not dismissed) first, then checked, then dismissed. */
export function sortLookItems(items) {
  const list = Array.isArray(items) ? items.slice() : [];
  const open = list.filter(i => !i.dismissed);
  const dismissed = list.filter(i => i.dismissed);
  const unchecked = open.filter(i => !i.checked);
  const checked = open.filter(i => i.checked);
  return [...unchecked, ...checked, ...dismissed];
}

export function checkedSummary(items) {
  const open = (items || []).filter(i => !i.dismissed);
  const checked = open.filter(i => i.checked).length;
  const total = open.length;
  return {
    checked,
    total,
    label: `${checked} of ${total} checked`
  };
}


function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function honesty(kind, text) {
  return `<span class="honesty ${kind}">${esc(text)}</span>`;
}

export function priceRangeLabel(item) {
  const lo = money(item && item.priceLow);
  const hi = money(item && item.priceHigh);
  if (lo == null && hi == null) return "No estimate yet";
  if (lo == null) return formatUsd(hi);
  if (hi == null) return formatUsd(lo);
  if (lo === hi) return formatUsd(lo);
  return `${formatUsd(lo)} to ${formatUsd(hi)}`;
}

/** Prefill a normal inventory item from a close-up (if checked) or the first table guess. Hands data to the existing listing flow; does not change it. */
export function itemFromLookItem(look, { at = Date.now(), scanId } = {}) {
  const checked = !!(look && look.checked);
  const v = (look && look.verified) || {};
  const d = (look && look.closeupDraft) || {};
  const first = (look && look.firstGuess) || {};
  const draft = {
    title: (checked && (d.title || v.name)) || (look && look.name) || first.name || "Item from a second look",
    description: (checked && d.description) || "",
    category: (checked && (d.category || v.category)) || (look && look.category) || "",
    condition: (checked && (d.condition || v.condition)) || (look && look.condition) || "",
    brand: (checked && (d.brand || v.brand)) || (look && look.brand) || "",
    priceLow: checked
      ? (d.priceLow != null ? d.priceLow : look && look.priceLow)
      : (look && look.priceLow),
    priceHigh: checked
      ? (d.priceHigh != null ? d.priceHigh : look && look.priceHigh)
      : (look && look.priceHigh),
    priceReason: (checked && (d.priceReason || (look && look.priceNote))) || (look && look.priceNote) || "",
    notes: (checked && d.notes) || (look && look.why) || "",
    daysToSell: (d && d.daysToSell) || "medium",
    speedReason: (d && d.speedReason) || "",
    ship: (d && d.ship) || null
  };
  const photos = (checked && look.closeupPhotos && look.closeupPhotos.length)
    ? look.closeupPhotos
    : (look && look.thumbDataUrl ? [{ dataUrl: look.thumbDataUrl }] : []);
  const notes = [
    look && look.where ? "Found at: " + look.where + "." : "",
    checked ? "From a close-up." : "First guess from a table scan.",
    look && look.why ? look.why : ""
  ].filter(Boolean).join("\n");
  const item = itemFromScan({ photos, draft, asking: null, result: null, notes }, at);
  return {
    ...item,
    secondLookScanId: scanId || (look && look.scanId) || "",
    secondLookItemId: (look && look.id) || "",
    askingPrice: money(draft.priceHigh) ?? money(draft.priceLow) ?? item.askingPrice
  };
}

function listItButton(it) {
  return `<button type="button" class="btn soft" data-act="listit" data-id="${esc(it.id || "")}">List it</button>`;
}

export function lookCardHtml(item, { showActions = true } = {}) {
  const it = item || {};
  const checked = !!it.checked;
  const first = snapshotFirstGuess(it) || {};
  const checks = (it.whatToCheck || []).map(c => `<li>${esc(c)}</li>`).join("");
  const imgSrc = it.thumbDataUrl;
  const img = imgSrc
    ? `<img class="sl-thumb" src="${esc(imgSrc)}" alt="${esc(it.name || "Item")}">`
    : `<div class="sl-thumb sl-thumb-ph" aria-hidden="true">👀</div>`;

  const steps = `<ol class="sl-steps">
    <li><b>Find it.</b> ${esc(it.where || "on the table")}</li>
    <li><b>Check.</b> ${checks ? `<ul>${checks}</ul>` : "Look it over for marks, tags, and condition."}</li>
    <li><b>Snap a close photo</b> of just this item, and of any mark, tag or label.</li>
  </ol>`;

  const guessItem = checked ? first : it;
  const guessRange = priceRangeLabel(guessItem);
  const guessBuy = (checked ? first.buyUpToLabel : it.buyUpToLabel) || "";
  const guessWhy = checked ? (first.priceNote || first.why || "") : (it.priceNote || it.why || "");
  const guessBlock = `<details class="more-block sl-guess">
    <summary>${esc(FIRST_GUESS_LABEL)}</summary>
    <p class="small sl-guess-range">${esc(guessRange)}</p>
    ${guessBuy ? `<p class="small">${esc(guessBuy)} ${honesty("warn", "Estimate")}</p>` : ""}
    ${guessWhy ? `<p class="tiny muted">${esc(guessWhy)}</p>` : ""}
  </details>`;

  if (checked) {
    return `<article class="card sl-card sl-card-checked" data-look="${esc(it.id || "")}" id="look-${esc(it.id || "")}" data-checked="1">
      <div class="row between wrap"><h3 class="sl-name">${esc(it.name || "Something on the table")}</h3>${honesty("ok", "Checked")}</div>
      ${img}
      <p class="small muted">From your close-up. ${honesty("warn", "Estimate")} Still check it yourself.</p>
      <p class="sl-range">${esc(priceRangeLabel(it))}</p>
      ${it.buyUpToLabel ? `<p class="small"><b>${esc(it.buyUpToLabel)}</b> ${honesty("warn", "Estimate")}</p>` : ""}
      ${it.priceNote ? `<p class="small muted">${esc(it.priceNote)}</p>` : ""}
      ${it.why ? `<p class="small">${esc(it.why)}</p>` : ""}
      ${showActions ? `<div class="stack sl-actions">
        <button type="button" class="btn btn-main" data-act="haggle" data-id="${esc(it.id || "")}">💬 Help me haggle</button>
        <p class="tiny muted sl-haggle-rec">Recommended — this is from your close-up, not the first table guess.</p>
        ${listItButton(it)}
        <button type="button" class="btn soft" data-act="closeup" data-id="${esc(it.id || "")}">📷 Take another close-up</button>
        <button type="button" class="btn ghost" data-act="dismiss" data-id="${esc(it.id || "")}">Not interested</button>
      </div>` : ""}
      ${guessBlock}
    </article>`;
  }

  return `<article class="card sl-card" data-look="${esc(it.id || "")}" id="look-${esc(it.id || "")}" data-checked="0">
    <div class="row between wrap"><h3 class="sl-name">${esc(it.name || "Something on the table")}</h3>${honesty("warn", "First guess")}</div>
    ${img}
    ${steps}
    ${showActions ? `<div class="stack sl-actions">
      <button type="button" class="btn btn-main" data-act="closeup" data-id="${esc(it.id || "")}">Go check this one</button>
      <p class="tiny muted">Take a picture of just this item — and of any mark, tag or label.</p>
    </div>` : ""}
    ${guessBlock}
    ${showActions ? `<div class="stack sl-secondary">
      <button type="button" class="btn soft" data-act="haggle" data-id="${esc(it.id || "")}">💬 Help me haggle</button>
      <p class="tiny muted">This is a first guess. Best used after you check it up close — you can still use it now.</p>
      ${listItButton(it)}
      <button type="button" class="btn ghost" data-act="dismiss" data-id="${esc(it.id || "")}">Not interested</button>
    </div>` : ""}
  </article>`;
}

export function skippedHtml(skipped, note) {
  const list = skipped || [];
  if (!list.length && !note) return "";
  const rows = list.map(s => `<li>${esc(s.name)}${s.reason ? ` — ${esc(s.reason)}` : ""}</li>`).join("");
  return `<div class="card flat" id="sl-skipped">
    <div class="row between"><h3>What I skipped as likely low value</h3>${honesty("warn", "AI guess")}</div>
    ${note ? `<p class="small">${esc(note)}</p>` : ""}
    ${rows ? `<ul class="sl-skip-list">${rows}</ul>` : ""}
    <p class="tiny muted">This is a first pass. You might still want to look yourself.</p>
  </div>`;
}

export function haggleSheetHtml(item, { bundle } = {}) {
  const h = (item && item.haggle) || {};
  const lines = haggleLines({ name: item && item.name, opening: h.opening, fair: h.fair, walkAway: h.walkAway });
  const nums = h.ready
    ? `<div class="stats sl-haggle-nums">
        <div class="card stat"><span class="tiny muted">Opening offer</span><b>${esc(formatUsd(h.opening))}</b></div>
        <div class="card stat"><span class="tiny muted">Fair price</span><b>${esc(formatUsd(h.fair))}</b></div>
        <div class="card stat"><span class="tiny muted">Walk away</span><b>${esc(formatUsd(h.walkAway))}</b></div>
      </div>`
    : `<p class="small">There isn't enough of an estimate yet to suggest a number. Go check this one up close, then come back.</p>`;
  const lineRows = lines.map((ln, i) => `<div class="sl-line">
    <p>${esc(ln)}</p>
    <button type="button" class="btn sm soft" data-act="copyline" data-i="${i}">Copy</button>
  </div>`).join("");
  const bundleBlock = bundle
    ? `<div class="card flat" id="sl-bundle">
        <h3>Bundle tip</h3>
        <p class="small">${esc(bundle.line)}</p>
        <p class="tiny muted">Opening ${esc(formatUsd(bundle.offer))} · fair ${esc(formatUsd(bundle.fair))} · walk away ${esc(formatUsd(bundle.walkAway))}. ${honesty("warn", "Estimate")}</p>
        <button type="button" class="btn sm soft" data-act="copybundle">Copy this line</button>
      </div>`
    : "";
  const guessNote = item && item.checked
    ? `<p class="small" id="sl-haggle-status">${honesty("ok", "Checked")} These numbers are from your close-up. Prices are still estimates — check them yourself.</p>`
    : `<p class="small attn" id="sl-haggle-guess">This is a first guess from the table. Check it up close for a better number. You can still use these lines if you want.</p>`;
  return `<div class="sl-haggle" id="sl-haggle">
    <div class="row between"><h2>Help me haggle</h2>${honesty("warn", "Estimate")}</div>
    <p class="small muted">Based on the estimated resale, approximate fees and shipping, and the profit you want to keep. Check the numbers yourself. Be polite — never pushy or deceptive.</p>
    ${guessNote}
    ${item && item.name ? `<p class="small"><b>${esc(item.name)}</b>${item.buyUpToLabel ? " · " + esc(item.buyUpToLabel) : ""}</p>` : ""}
    ${nums}
    <p class="tiny muted" id="sl-earbud-note" style="margin:10px 0 0">${honesty("later", "Coming later")} Coach me in my earbud. Use the lines below for now.</p>
    <h3 style="margin-top:16px">Things you could say</h3>
    ${lineRows}
    ${bundleBlock}
    <div class="card flat" id="sl-earbud">
      <div class="row between"><h3>Coach me in my earbud</h3>${honesty("later", "Coming later")}</div>
      <p class="small">${esc(EARBUD_LATER)}</p>
    </div>
  </div>`;
}

/* ---------- storage ---------- */

function ls(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

function newScanId(at = Date.now()) {
  return "sl_" + at.toString(36) + Math.random().toString(36).slice(2, 8);
}

export function normalizeScan(raw, at = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const framesHint = raw.frameCount || (raw.frames && raw.frames.length) || 0;
  const parsed = raw.items || raw.skipped || raw.note
    ? normalizeSecondLook({ items: raw.items, skipped: raw.skipped, note: raw.note }, new Array(framesHint).fill(0))
    : { items: [], skipped: [], note: "", ok: true };
  const items = (parsed.items || []).map((it, i) => {
    const src = (raw.items && raw.items[i]) || it;
    return {
      ...it,
      id: String((src && src.id) || it.id || ("li_" + (i + 1))),
      thumbDataUrl: (src && src.thumbDataUrl) || it.thumbDataUrl || "",
      dismissed: !!(src && src.dismissed),
      buyUpTo: src && src.buyUpTo != null ? money(src.buyUpTo) : it.buyUpTo,
      buyUpToLabel: (src && src.buyUpToLabel) || it.buyUpToLabel || "",
      haggle: (src && src.haggle) || it.haggle || null,
      checked: !!(src && src.checked),
      checkedAt: (src && src.checkedAt) || it.checkedAt || null,
      firstGuess: normalizeFirstGuess((src && src.firstGuess) || it.firstGuess),
      verified: normalizeVerified((src && src.verified) || it.verified),
      closeupPhotos: normalizeCloseupPhotos((src && src.closeupPhotos) || it.closeupPhotos),
      closeupDraft: (src && src.closeupDraft) || it.closeupDraft || null,
      listedItemId: String((src && src.listedItemId) || it.listedItemId || ""),
      listNowAt: (src && src.listNowAt) || it.listNowAt || null,
      condition: (src && src.condition) || it.condition || "",
      quantity: src && Number(src.quantity) > 0 ? Math.round(Number(src.quantity)) : it.quantity,
      lookedDeeper: !!(src && src.lookedDeeper) || !!it.lookedDeeper,
      tile: src && src.tile != null ? src.tile : it.tile,
      boxRefined: !!(src && src.boxRefined) || !!it.boxRefined,
      brand: String((src && src.brand) || it.brand || ""),
      sourceScanIds: Array.isArray(src && src.sourceScanIds) ? src.sourceScanIds.map(String) : it.sourceScanIds
    };
  });
  return {
    id: String(raw.id || newScanId(at)),
    createdAt: raw.createdAt || at,
    kind: raw.kind === "video" ? "video" : "photo",
    duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : null,
    frameCount: Number(raw.frameCount) || items.length || 0,
    items,
    skipped: parsed.skipped,
    note: parsed.note || String(raw.note || "").trim(),
    warning: String(raw.warning || "").trim(),
    unread: raw.unread !== false,
    coverThumb: typeof raw.coverThumb === "string" ? raw.coverThumb : "",
    lookedDeeper: !!raw.lookedDeeper,
    lookedDeeperAt: raw.lookedDeeperAt || null,
    loadScanIds: Array.isArray(raw.loadScanIds) ? raw.loadScanIds.map(String) : [],
    mergedInto: String(raw.mergedInto || ""),
    loadNote: String(raw.loadNote || "")
  };
}

export function loadScans(storage) {
  const s = ls(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(SCANS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(r => normalizeScan(r)).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (e) { return []; }
}

function writeScans(scans, storage) {
  const s = ls(storage);
  if (!s) return false;
  const list = (scans || []).slice(0, MAX_SAVED_SCANS);
  const dump = list => JSON.stringify(list.map(sc => ({
    ...sc,
    // never persist full-resolution frames — thumbs only
    frames: undefined
  })));
  try {
    s.setItem(SCANS_KEY, dump(list));
    return true;
  } catch (e) {
    // Quota: drop thumbs from the oldest, then drop oldest scans.
    try {
      const trimmed = list.map((sc, i) => {
        if (i < 8) return sc;
        return { ...sc, items: (sc.items || []).map(it => ({ ...it, thumbDataUrl: "", closeupPhotos: [] })), coverThumb: "" };
      });
      s.setItem(SCANS_KEY, dump(trimmed));
      return true;
    } catch (e2) {
      try {
        s.setItem(SCANS_KEY, dump(list.slice(0, 5).map(sc => ({
          ...sc,
          items: (sc.items || []).map(it => ({ ...it, thumbDataUrl: "", closeupPhotos: [] })),
          coverThumb: ""
        }))));
        return true;
      } catch (e3) { return false; }
    }
  }
}

export function saveScan(scan, storage, at = Date.now()) {
  const row = normalizeScan(scan, at);
  if (!row) return null;
  const all = loadScans(storage).filter(s => s.id !== row.id);
  all.unshift(row);
  writeScans(all, storage);
  return row;
}

export function getScan(id, storage) {
  return loadScans(storage).find(s => s.id === id) || null;
}

export function updateScan(id, patch, storage) {
  const all = loadScans(storage);
  const i = all.findIndex(s => s.id === id);
  if (i < 0) return null;
  const next = normalizeScan({ ...all[i], ...(typeof patch === "function" ? patch(all[i]) : patch) });
  all[i] = next;
  writeScans(all, storage);
  return next;
}

export function dismissItem(scanId, itemId, dismissed = true, storage) {
  return updateScan(scanId, sc => ({
    ...sc,
    items: (sc.items || []).map(it => it.id === itemId ? { ...it, dismissed } : it)
  }), storage);
}

export function markScanRead(id, storage) {
  return updateScan(id, { unread: false }, storage);
}

export function removeScan(id, storage) {
  const all = loadScans(storage).filter(s => s.id !== id);
  writeScans(all, storage);
}

export function unreadScanCount(storage) {
  return loadScans(storage).filter(s => s.unread).length;
}

export function clearSecondLook(storage) {
  const s = ls(storage);
  if (!s) return;
  try { s.removeItem(SCANS_KEY); } catch (e) {}
  resetJob();
}

/* ---------- API ---------- */

export async function requestSecondLook({ frames, key, fetchImpl, model = AI_MODEL } = {}) {
  const shots = (frames || []).filter(f => f && (f.dataUrl || typeof f === "string"));
  if (!shots.length) {
    const err = new Error(MSG_NO_MEDIA);
    err.code = "no-photo";
    throw err;
  }
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(MSG_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  const labels = shots.map((f, i) => {
    const t = f && f.time != null && Number.isFinite(Number(f.time)) ? ` at ${Number(f.time).toFixed(1)} seconds` : "";
    return `Image ${i + 1} is frame ${i + 1}${t}.`;
  }).join(" ");
  const kind = shots.length === 1 ? "This is one wide photo of a table or shelf." : `These are stills from a slow pan across a table or shelf, in time order.`;
  const userText = `${kind} Pick out things that might be worth a closer look for resale. ${labels} Reply with a single JSON object.`;
  const { json, usage, model: used } = await chatJson({
    system: SECOND_LOOK_SYSTEM,
    userText,
    photos: shots,
    key: k,
    fetchImpl,
    model,
    maxTokens: 2000,
    temperature: 0.2,
    maxPhotos: MAX_FRAMES
  });
  const result = normalizeSecondLook(json, shots);
  return { result, usage, model: used || model, raw: json };
}

/* ---------- thumbs (browser; injectable crop for tests) ---------- */

export function frameByIndex(frames, frame) {
  const list = frames || [];
  if (!list.length) return null;
  const i = Math.max(1, Math.round(Number(frame) || 1)) - 1;
  return list[Math.min(list.length - 1, Math.max(0, i))] || list[0];
}

export async function attachThumbs(result, frames, cropFn) {
  const items = [];
  for (const item of (result && result.items) || []) {
    const frame = frameByIndex(frames, item.frame);
    let thumb = item.thumbDataUrl || "";
    if (!thumb && frame && (frame.dataUrl || frame) && cropFn) {
      try { thumb = await cropFn(frame.dataUrl || frame, item.box, { width: frame.width, height: frame.height }); }
      catch (e) { thumb = frame.dataUrl || ""; }
    } else if (!thumb && frame) {
      thumb = frame.dataUrl || "";
    }
    items.push({ ...item, thumbDataUrl: thumb || "" });
  }
  const cover = (frames && frames[0] && frames[0].dataUrl) || (items[0] && items[0].thumbDataUrl) || "";
  return { ...result, items, coverThumb: result && result.coverThumb || cover };
}

export async function cropDataUrl(dataUrl, box, { maxEdge = THUMB_MAX_EDGE, quality = THUMB_JPEG_QUALITY, pad = 0.08 } = {}) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return dataUrl || "";
  }
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const b = pixelCropBounds(W, H, box, pad);
  const scale = Math.min(1, maxEdge / Math.max(b.w, b.h));
  const w = Math.max(1, Math.round(b.w * scale));
  const h = Math.max(1, Math.round(b.h * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

function loadImg(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(MSG_BAD_PHOTO));
    img.src = dataUrl;
  });
}

/* ---------- on-device frame extraction (browser) ---------- */

function signatureFromCanvas(canvas, size = 8) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return { blocks: blockMeans(data, size, size, size) };
}

function captureVideoFrame(video, { maxEdge = FRAME_MAX_EDGE, quality = FRAME_JPEG_QUALITY } = {}) {
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (!vw || !vh) throw new Error(MSG_BAD_VIDEO);
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  return {
    dataUrl: c.toDataURL("image/jpeg", quality),
    width: w,
    height: h,
    hash: signatureFromCanvas(c)
  };
}

function waitEvent(el, ev, { timeout = 8000, errorMessage } = {}) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { cleanup(); reject(new Error(errorMessage || "That took too long.")); }, timeout);
    const ok = () => { cleanup(); resolve(); };
    const err = () => { cleanup(); reject(new Error(errorMessage || MSG_BAD_VIDEO)); };
    const cleanup = () => {
      clearTimeout(to);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", err);
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", err, { once: true });
  });
}

async function seekTo(video, t) {
  if (Math.abs((video.currentTime || 0) - t) < 0.05) return;
  const p = waitEvent(video, "seeked", { timeout: 2500, errorMessage: MSG_BAD_VIDEO }).catch(() => {});
  try { video.currentTime = t; } catch (e) { /* some browsers throw if not ready; wait anyway */ }
  await p;
}

export async function extractFrames(file, {
  interval = FRAME_INTERVAL,
  maxFrames = MAX_FRAMES,
  maxEdge = FRAME_MAX_EDGE,
  quality = FRAME_JPEG_QUALITY,
  onProgress,
  cancelled
} = {}) {
  if (!file) throw Object.assign(new Error(MSG_NO_MEDIA), { code: "no-photo" });
  if (typeof document === "undefined") {
    throw new Error("Frame extraction runs on the phone.");
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(MSG_BAD_VIDEO)), 12000);
      const ok = () => { clearTimeout(to); resolve(); };
      video.onloadeddata = ok;
      video.onloadedmetadata = () => {
        // metadata is enough if data also arrived, otherwise keep waiting
        if (video.videoWidth) { /* wait for data for a reliable first frame */ }
      };
      video.onerror = () => { clearTimeout(to); reject(new Error(MSG_BAD_VIDEO)); };
    });
    const duration = Number(video.duration);
    const limit = videoLimit(duration);
    if (limit.refuse || !limit.ok) {
      const err = new Error(limit.warning || MSG_TOO_LONG);
      err.code = "too-long";
      throw err;
    }
    // Unlock seeking on some iOS versions.
    try { await video.play(); video.pause(); } catch (e) { /* autoplay may be blocked; seeking can still work */ }
    const times = planFrameTimes(limit.used, { interval, maxFrames: PLAN_FRAMES, maxDuration: MAX_VIDEO_SECONDS });
    const raw = [];
    for (let i = 0; i < times.length; i++) {
      if (cancelled && cancelled()) {
        const err = new Error("Cancelled.");
        err.code = "cancelled";
        throw err;
      }
      if (onProgress) onProgress({ stage: "frames", current: i + 1, total: times.length, duration, warning: limit.warning });
      await seekTo(video, times[i]);
      try {
        const cap = captureVideoFrame(video, { maxEdge, quality });
        raw.push({ ...cap, time: times[i], index: raw.length });
      } catch (e) {
        // Skip a single bad frame; fail only if we get none.
      }
    }
    const picked = selectFrames(raw, { maxFrames });
    if (!picked.length) throw new Error(MSG_BAD_VIDEO);
    return { frames: picked.map((f, i) => ({ ...f, index: i })), duration, usedDuration: limit.used, warning: limit.warning };
  } finally {
    try { video.removeAttribute("src"); video.load(); } catch (e) {}
    URL.revokeObjectURL(url);
  }
}

export async function frameFromPhoto(file, { maxEdge = 1024, quality = 0.72 } = {}) {
  if (!file) throw Object.assign(new Error(MSG_NO_MEDIA), { code: "no-photo" });
  const raw = await fileToDataUrl(file);
  const dataUrl = await downscaleDataUrl(raw, maxEdge, quality);
  let width = 0, height = 0, hash = null;
  if (typeof Image !== "undefined" && typeof document !== "undefined") {
    const img = await loadImg(dataUrl);
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    c.getContext("2d").drawImage(img, 0, 0);
    hash = signatureFromCanvas(c);
  }
  return { frames: [{ dataUrl, time: 0, index: 0, width, height, hash }], duration: null, usedDuration: null, warning: "" };
}

/* ---------- background job ---------- */

let job = { status: "idle" };
const listeners = new Set();
let cancelFlag = false;

export function getJob() { return job; }

export function subscribeJob(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(job); } catch (e) { /* listener errors must not break the job */ }
  }
}

function setJob(next) {
  job = next;
  notify();
}

export { setJob };

export function isJobCancelled() { return cancelFlag; }

export function resetCancelFlag() { cancelFlag = false; }

export function resetJob() {
  cancelFlag = false;
  job = { status: "idle" };
  notify();
}

export function cancelJob() {
  cancelFlag = true;
  if (job && job.status === "running") {
    setJob({ ...job, status: "cancelled", progress: "Cancelled.", error: "" });
  }
}

/**
 * Run a Second look in the background. She can leave the screen.
 * `chatImpl` is injectable (defaults to requestSecondLook).
 */
export async function startSecondLook({ file, kind = "photo", key, fetchImpl, chatImpl, cropFn, onProgress } = {}) {
  if (job && job.status === "running") {
    const err = new Error("A look is already running. Please wait for it to finish, or cancel it.");
    err.code = "busy";
    throw err;
  }
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(MSG_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  if (!file) {
    const err = new Error(MSG_NO_MEDIA);
    err.code = "no-photo";
    throw err;
  }
  cancelFlag = false;
  const startedAt = Date.now();
  setJob({
    status: "running",
    progress: "Looking… you can keep shopping",
    stage: "start",
    kind,
    startedAt,
    error: "",
    warning: "",
    scanId: null
  });
  try {
    if (onProgress) onProgress(getJob());
    const extract = kind === "video" ? extractFrames : frameFromPhoto;
    const extracted = await extract(file, {
      onProgress: p => {
        const msg = p.stage === "frames"
          ? `Pulling stills from your video… ${p.current} of ${p.total}. You can keep shopping.`
          : "Looking… you can keep shopping";
        setJob({ ...getJob(), status: "running", progress: msg, stage: "frames", warning: p.warning || "" });
        if (onProgress) onProgress(getJob());
      },
      cancelled: () => cancelFlag
    });
    if (cancelFlag) {
      setJob({ status: "cancelled", progress: "Cancelled.", startedAt, error: "" });
      return getJob();
    }
    setJob({
      ...getJob(),
      status: "running",
      progress: "Looking at the table… you can keep shopping",
      stage: "ai",
      warning: extracted.warning || "",
      frameCount: (extracted.frames || []).length
    });
    const chat = chatImpl || requestSecondLook;
    const { result } = await chat({ frames: extracted.frames, key: k, fetchImpl });
    if (cancelFlag) {
      setJob({ status: "cancelled", progress: "Cancelled.", startedAt, error: "" });
      return getJob();
    }
    const withThumbs = await attachThumbs(result, extracted.frames, cropFn || cropDataUrl);
    const settings = getSettingsSafe();
    const siteIds = getEnabledSafe();
    const items = (withThumbs.items || []).map(it => decorateItem(it, {
      desiredProfit: settings.desiredProfit,
      siteIds
    }));
    const scan = saveScan({
      kind: kind === "video" ? "video" : "photo",
      duration: extracted.duration,
      frameCount: (extracted.frames || []).length,
      items,
      skipped: withThumbs.skipped,
      note: withThumbs.note,
      warning: extracted.warning || "",
      unread: true,
      coverThumb: withThumbs.coverThumb || (items[0] && items[0].thumbDataUrl) || (extracted.frames[0] && extracted.frames[0].dataUrl) || "",
      createdAt: Date.now()
    });
    setJob({
      status: "done",
      progress: items.length
        ? `Your second look is ready — ${items.length} ${items.length === 1 ? "thing" : "things"} to check.`
        : "Your second look is ready. Nothing jumped out, but you can read what was skipped.",
      stage: "done",
      kind,
      startedAt,
      doneAt: Date.now(),
      error: "",
      warning: extracted.warning || "",
      scanId: scan.id,
      result: { ...withThumbs, items },
      unread: true
    });
    return getJob();
  } catch (e) {
    if (e && e.code === "cancelled") {
      setJob({ status: "cancelled", progress: "Cancelled.", startedAt, error: "" });
      return getJob();
    }
    const message = (e && e.message) ? e.message : "The look-over couldn't be made. Try again.";
    setJob({
      status: "error",
      progress: "",
      stage: "error",
      kind,
      startedAt,
      error: message,
      scanId: null
    });
    throw e;
  }
}

export function acknowledgeJob() {
  if (job && (job.status === "done" || job.status === "error" || job.status === "cancelled")) {
    if (job.scanId) {
      try { markScanRead(job.scanId); } catch (e) {}
    }
    setJob({ ...job, unread: false });
  }
}

// Used by Buy-or-pass handoff. Builds the work object the existing scan screen already understands.
export function scanWorkFromLookItem(item, { photos } = {}) {
  const it = item || {};
  const checks = (it.whatToCheck || []).join(". ");
  const notes = [
    it.name ? `Close-up of: ${it.name}.` : "",
    it.where ? `Where: ${it.where}.` : "",
    checks ? `What to check: ${checks}` : "",
    it.why ? `Why it might be worth a look: ${it.why}` : ""
  ].filter(Boolean).join("\n");
  const draft = {
    title: it.name || "Item from a second look",
    description: "",
    category: it.category || "",
    condition: "",
    brand: it.brand || "",
    priceLow: money(it.priceLow),
    priceHigh: money(it.priceHigh),
    priceReason: [
      it.why || "",
      it.priceNote || "",
      "This is a rough estimate from a table scan, not from a close-up and not from checking sold listings. Take a close-up and tap Identify and check for a better look."
    ].filter(Boolean).join(" "),
    daysToSell: "medium",
    speedReason: "",
    notes: checks,
    ship: null
  };
  const settings = getSettingsSafe();
  const est = estimatesForItem(it, { desiredProfit: settings.desiredProfit, siteIds: getEnabledSafe() });
  const result = est.result;
  const pics = Array.isArray(photos) ? photos : (
    it.thumbDataUrl ? [{ dataUrl: it.thumbDataUrl, addedAt: Date.now() }] : []
  );
  return {
    photos: pics,
    asking: "",
    notes,
    busy: false,
    error: "",
    draft,
    result,
    assumptions: { resale: "", fees: "", shipping: "", desiredProfit: "" }
  };
}

export { money, formatUsd, extractJson, buyUpTo, buyUpToLabel, getKey };
