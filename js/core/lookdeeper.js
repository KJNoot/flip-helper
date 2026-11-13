// Look deeper (v0.7.2): a closer Second look at a busy wide photo.
// The cheap first pass (gpt-4o-mini, one 1024px image, detail low) is unchanged.
// This module tiles the EXIF-corrected full-resolution photo, sends the crops
// to gpt-4o at detail high, maps each box from tile space to photo space in
// code (the model's full-photo coordinates are not trusted), refines loose
// boxes with a second crop-and-locate pass, merges and dedupes, groups
// matching repeats into one lot, can combine several photos of the same load
// into one inventory, and skips people, work vehicles, trailers, fenders,
// tires on trailers, straps, and racks.
//
// About three cents of the device-held key per look. Nothing is emailed.

import { chatJson, fileToDataUrl } from "./draft.js";
import { getKey } from "./key.js";
import {
  MSG_NO_KEY, MSG_NO_MEDIA, MSG_BAD_PHOTO, MSG_NETWORK,
  normalizeBox, normalizeLookItem, normalizeSecondLook, dedupeItems,
  namesSimilar, nameKey, whereFromBox, attachThumbs, cropDataUrl,
  decorateItem, updateScan, getScan, getJob, loadScans,
  setJob, isJobCancelled, resetCancelFlag
} from "./secondlook.js";
import { getSettings } from "./settings.js";
import { getEnabledIds } from "./prefs.js";

export const LOOK_DEEPER_BUTTON = "Look deeper";
export const LOOK_DEEPER_NOTE = "Takes a closer look at the full photo, in smaller pieces, so things in the back of a barn or a busy shot are less likely to be missed. Uses a bit more of your AI key (about three cents).";
export const LOOK_DEEPER_PROGRESS = "Looking more closely at this photo… you can keep shopping";
export const LOOK_DEEPER_REFINE_PROGRESS = "Tightening the boxes so you can find each thing…";
export const LOOK_DEEPER_MODEL = "gpt-4o";
export const LOOK_DEEPER_DETAIL = "high";
export const LOOK_DEEPER_GRID = 3;
export const LOOK_DEEPER_OVERLAP = 0.10;
export const LOOK_DEEPER_TILE_EDGE = 1280;
export const LOOK_DEEPER_TILE_QUALITY = 0.85;
export const LOOK_DEEPER_OVERVIEW_EDGE = 1024;
export const LOOK_DEEPER_MAX_PHOTOS = 16;
export const LOOK_DEEPER_REFINE_PAD = 0.35;
export const LOOK_DEEPER_MAX_REFINE = 8;
export const LOAD_WINDOW_MS = 2 * 60 * 60 * 1000;
export const TILE_EDGE_EPS = 0.05;

export const MSG_NEED_PHOTO = "To look deeper, scan this photo again, then tap Look deeper.";
export const MSG_BUSY = "A look is already running. Please wait for it to finish, or cancel it.";
export const MSG_VIDEO = "Look deeper is for a still photo. For a video, the first pass already used several stills.";

export const LOOK_DEEPER_SYSTEM = `You are a picky, experienced US reseller walking a barn, garage, yard, or job site. You are looking at overlapping high-resolution tiles of one photograph, plus a smaller whole-photo overview.

Find EVERY item that might be worth a closer look for resale — including things in the background, along the walls, under other objects, or only visible in one tile.

Do NOT skip chairs, mowers (including riding mowers and tractors), standalone tires (a pile or stack of tires is worth listing), doors, windows, or pipe just because they seem ordinary or "low value." Those are often worth a closer look.

Do NOT skip stoves, ranges, ovens, cooktops, fireplace inserts, wood stoves, furnaces, or other heavy household pieces — even if they look built-in, rusty, sitting against a wall, or half-hidden. Call them by the right name (for example "fireplace insert", "electric range"), and read the brand on the badge if you can.

Name objects correctly:
- A countertop slab with a sink, especially several strapped on a trailer or rack, is a "vanity top" (or "vanity tops with undermount sinks" for a lot) — not "white sinks" and not just "sinks."
- Fluorescent shop lights, tube-light boxes, and ceiling fixtures are "light fixtures" — not "appliances."
- Finished kitchen cabinets (oak, painted, or similar) are "cabinets" — not "lumber" or "boards." Lumber is rough or milled boards that are not a finished cabinet.
- Read what the object actually is.

Read brand decals, logos, model plates, box labels, and lettering when you can actually see them. Put the exact visible text in brand or in the name (for example a "Cty J" street sign, or a Philips T12 lamp-box label). Name a brand only if you can reasonably read the text or clearly recognize the logo; otherwise leave brand empty and do not guess. Attach a brand only to the object it is actually printed on: a Pfister mark on a drain or faucet belongs to the drain or faucet, not to the sink basin; "BENCHTOP" printed as a product type on a saw is not a brand. If a box or label names a brand (Philips, Kobalt, DeWalt, Ridgid, and so on), put that brand on that box or tool.

Ignore people. Ignore cars, trucks, SUVs, and vans that are clearly someone's parked transportation or a work truck, not merchandise being sold. Ignore trailers that are just the bed carrying the goods, trailer fenders, tires that are mounted on a trailer, ratchet straps, and truck-bed or cargo racks. Do list riding mowers, tractors, boats, ATVs, golf carts, a pile of tires that are themselves for sale, and any vehicle that is clearly for sale (a for-sale sign, sitting in a goods pile, or similarly offered).

If you see several of the same thing (for example six matching vanity tops with sinks, a stack of the same chair, a pile of the same window, a stack of fluorescent light fixtures), group them into ONE lot, with the count in the name, like "6 vanity tops with undermount sinks." Do not list each copy separately.

Do not invent items that are not visible. Do not claim you can read a mark you cannot read. If something is only partly visible, say so. Price ranges are rough estimates, not from live sold listings, and you must say so.

Reply with a single JSON object only, no markdown, with these keys:
- items: an array of resale-worthy things (lots count as one item). Each object:
  - name: a short plain, correct name (under 80 characters). For a lot, start with the count.
  - brand: brand or logo or label text if readable and attached to THIS object, otherwise ""
  - quantity: how many of this thing (a number; 1 if it is a single piece)
  - why: one short sentence on why it might be valuable. Say this is a guess from the photo.
  - priceLow, priceHigh: rough resale estimates in US dollars for the lot or the piece, or omit if you truly cannot tell
  - priceNote: one short sentence. You MUST say this is an estimate, not from checking sold listings.
  - confidence: "low" or "medium" (never "high")
  - tile: the image number of the tiled crop this was clearest in (a 1-based integer matching the image numbers you were given), or 0 if only the overview
  - box: { "x", "y", "w", "h" } as fractions from 0 to 1 of THAT TILE (or of the overview if tile is 0). Left, top, width, height of the item inside the image you are looking at. Do NOT convert to the full photograph — we will do that in code. Give a tight box around the item itself, not the whole tile, and not the floor, ground, ceiling, or empty wall. Do not invent precise corners; a reasonable tight box is enough.
  - where: plain words a person can use to find it, like "far back left, next to the tire stack"
  - whatToCheck: an array of short phrases — what to look for up close, including any lettering to confirm
- skipped: an array of { "name", "reason" } for things you passed over that are truly everyday trash or clutter, or that you ignored as a work vehicle, trailer, strap, or rack. Keep this brief. Do not put chairs, mowers, doors, windows, pipe, stoves, ranges, or fireplace inserts here.
- note: one short honest sentence about the look-over.

If the same item (or the same lot) appears in several tiles, list it once, using the clearest tile, with a tight box in that tile's coordinates. Two different kinds of thing should both be listed.`;

export const REFINE_SYSTEM = `You are tightening bounding boxes on close-up crops taken from a larger photograph, so a person can walk back and find each item.

For each image you are given, the item's name (and brand, if any) is in the labels. Return a tight box around ONLY that named item, as fractions from 0 to 1 of THAT crop (left, top, width, height).

Rules:
- Box the item itself. Exclude floor, ground, grass, ceiling, sky, empty wall, and other objects.
- Do not snap the box to the crop edges unless the item actually goes to that edge.
- If the item is a vanity top, box the slab (and its sink), not the trailer or the straps.
- If the item is a fireplace insert, stove, or range, box that appliance, not the whole chimney or wall.
- If you cannot see the item, return a reasonable box around what is there and set "found" to false.
- Do not change the name. Do not add items.

Reply with a single JSON object only: { "boxes": [ { "index": 1, "name": "...", "box": { "x", "y", "w", "h" }, "found": true } ] }.`;

/* ---------- session cache of the original photo (not written to storage) ---------- */

const sources = new Map();

export function rememberScanSource(scanId, file) {
  if (scanId && file) sources.set(String(scanId), file);
}

export function getScanSource(scanId) {
  return (scanId && sources.get(String(scanId))) || null;
}

export function forgetScanSource(scanId) {
  if (scanId) sources.delete(String(scanId));
}

/* ---------- tile layout (pure) ---------- */

/**
 * Split a photo into an overlapping grid of tiles.
 * Each tile is centered on a grid cell, then clamped to the image.
 * Matches the 3×3-with-10% overlap used on Ken's barn photos.
 */
export function photoTiles(width, height, { grid = LOOK_DEEPER_GRID, overlap = LOOK_DEEPER_OVERLAP } = {}) {
  const W = Math.max(1, Math.round(Number(width) || 0));
  const H = Math.max(1, Math.round(Number(height) || 0));
  const g = Math.max(1, Math.min(6, Math.round(Number(grid) || LOOK_DEEPER_GRID)));
  const ov = Math.min(0.5, Math.max(0, Number(overlap)));
  const cellW = W / g;
  const cellH = H / g;
  const tileW = Math.max(1, Math.round(cellW * (1 + ov)));
  const tileH = Math.max(1, Math.round(cellH * (1 + ov)));
  const tiles = [];
  for (let r = 0; r < g; r++) {
    for (let c = 0; c < g; c++) {
      const cx = (c + 0.5) * cellW;
      const cy = (r + 0.5) * cellH;
      let x0 = Math.round(cx - tileW / 2);
      let y0 = Math.round(cy - tileH / 2);
      x0 = tileW < W ? Math.max(0, Math.min(x0, W - tileW)) : 0;
      y0 = tileH < H ? Math.max(0, Math.min(y0, H - tileH)) : 0;
      const x1 = Math.min(W, x0 + tileW);
      const y1 = Math.min(H, y0 + tileH);
      const index = r * g + c + 1;
      tiles.push({
        row: r,
        col: c,
        index,
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
        frac: {
          x: x0 / W,
          y: y0 / H,
          w: (x1 - x0) / W,
          h: (y1 - y0) / H
        },
        label: `Image ${index} is the tile at row ${r + 1}, column ${c + 1} of a ${g}×${g} grid (row 1 is the top, column 1 is the left). Report box coordinates as fractions of THIS tile, from 0 to 1 — not of the full photograph. Give a tight box around the item, not the whole tile.`
      });
    }
  }
  return { width: W, height: H, grid: g, overlap: ov, tiles };
}

/**
 * Map a box given in a tile's 0–1 space into 0–1 of the full photograph.
 * The model's "full photo" coordinates, if any, are ignored here — only the
 * local box and the tile's known coverage are used. See photoBoxFromTile
 * for the case where the model clearly ignored that instruction.
 */
export function mapBoxToPhoto(localBox, tileFrac) {
  const local = normalizeBox(localBox);
  const t = tileFrac && typeof tileFrac === "object"
    ? { x: Number(tileFrac.x) || 0, y: Number(tileFrac.y) || 0, w: Number(tileFrac.w) || 0, h: Number(tileFrac.h) || 0 }
    : null;
  if (!local || !t || t.w <= 0 || t.h <= 0) return local;
  return normalizeBox({
    x: t.x + local.x * t.w,
    y: t.y + local.y * t.h,
    w: local.w * t.w,
    h: local.h * t.h
  });
}

export function tileByIndex(tiles, index) {
  const list = tiles || [];
  const n = Math.round(Number(index));
  if (!Number.isFinite(n) || n <= 0) return null; // 0 = overview (full photo)
  return list.find(t => t.index === n) || null;
}

export function boxTouchesTileEdge(box, { eps = TILE_EDGE_EPS } = {}) {
  const b = normalizeBox(box);
  if (!b) return false;
  return b.x <= eps || b.y <= eps || (b.x + b.w) >= 1 - eps || (b.y + b.h) >= 1 - eps;
}

export function isNearlyFullTile(box, { area = 0.55, edge = 0.82 } = {}) {
  const b = normalizeBox(box);
  if (!b) return false;
  return (b.w * b.h) >= area || (b.w >= edge && b.h >= edge);
}

function near(a, b, eps = 0.04) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function boxIou(a, b) {
  const aa = normalizeBox(a), bb = normalizeBox(b);
  if (!aa || !bb) return 0;
  const ax2 = aa.x + aa.w, ay2 = aa.y + aa.h;
  const bx2 = bb.x + bb.w, by2 = bb.y + bb.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(aa.x, bb.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(aa.y, bb.y));
  const inter = ix * iy;
  const union = aa.w * aa.h + bb.w * bb.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * True when a raw box looks like the model reported full-photo (or whole-tile)
 * coordinates instead of the tile-local fractions we asked for. Those boxes
 * often snap to the 3×3 grid and cover empty floor or ceiling.
 */
export function looksLikePhotoSpaceBox(box, tileFrac) {
  const b = normalizeBox(box);
  const t = tileFrac && typeof tileFrac === "object"
    ? { x: Number(tileFrac.x) || 0, y: Number(tileFrac.y) || 0, w: Number(tileFrac.w) || 0, h: Number(tileFrac.h) || 0 }
    : null;
  if (!b || !t || t.w <= 0 || t.h <= 0) return false;
  const iou = boxIou(b, t);
  if (iou >= 0.55 && b.w >= t.w * 0.7 && b.h >= t.h * 0.7) return true;
  const anchors = [0, 1 / 3, 0.317, 2 / 3, 0.633, 1 - t.w];
  const sizes = [1 / 3, 0.367, 0.366, 0.368, 0.683, 2 / 3, 1];
  const gridX = anchors.some(a => near(b.x, a));
  const gridW = sizes.some(s => near(b.w, s));
  if (gridX && gridW && iou >= 0.3) return true;
  return false;
}

/**
 * Choose the photo-space box: prefer mapping tile-local coordinates in code.
 * If the raw box is clearly already in photo space (the whole tile, or a
 * grid-aligned photo box), use it as photo space rather than shrinking it.
 * Either way, a later refine pass tightens it.
 */
export function photoBoxFromTile(rawBox, tile) {
  const raw = normalizeBox(rawBox);
  if (!raw) return null;
  const frac = tile && tile.frac;
  if (!frac) return raw;
  if (looksLikePhotoSpaceBox(raw, frac)) return raw;
  return mapBoxToPhoto(raw, frac);
}

export function needsBoxRefine(item, tile, rawBox) {
  const raw = normalizeBox(rawBox || (item && item.box));
  if (!raw) return true;
  if (boxTouchesTileEdge(raw)) return true;
  if (isNearlyFullTile(raw)) return true;
  const photo = item && item.box && normalizeBox(item.box);
  if (photo && photo.w * photo.h >= 0.28) return true;
  if (tile && looksLikePhotoSpaceBox(raw, tile.frac)) return true;
  return false;
}

/**
 * Pad a photo-space box into a crop used for the locate-refine pass.
 * If the original local box touched a tile edge, pad more on that side
 * so the crop includes the rest of the item in the overlapping neighbor.
 */
export function refineCropFrac(photoBox, { pad = LOOK_DEEPER_REFINE_PAD, edges, minSize = 0.08 } = {}) {
  const b = normalizeBox(photoBox);
  if (!b) return { x: 0, y: 0, w: 1, h: 1 };
  const e = edges || {};
  const padX = Math.max(pad, e.left || 0, e.right || 0);
  const padY = Math.max(pad, e.top || 0, e.bottom || 0);
  const extraL = e.left ? pad : 0;
  const extraR = e.right ? pad : 0;
  const extraT = e.top ? pad : 0;
  const extraB = e.bottom ? pad : 0;
  let x = b.x - b.w * padX - extraL * 0.15;
  let y = b.y - b.h * padY - extraT * 0.15;
  let x2 = b.x + b.w + b.w * padX + extraR * 0.15;
  let y2 = b.y + b.h + b.h * padY + extraB * 0.15;
  if (x2 - x < minSize) {
    const mid = (x + x2) / 2;
    x = mid - minSize / 2;
    x2 = mid + minSize / 2;
  }
  if (y2 - y < minSize) {
    const mid = (y + y2) / 2;
    y = mid - minSize / 2;
    y2 = mid + minSize / 2;
  }
  return normalizeBox({ x, y, w: x2 - x, h: y2 - y }) || { x: 0, y: 0, w: 1, h: 1 };
}

export function edgesTouched(box, { eps = TILE_EDGE_EPS } = {}) {
  const b = normalizeBox(box);
  if (!b) return {};
  return {
    left: b.x <= eps,
    top: b.y <= eps,
    right: (b.x + b.w) >= 1 - eps,
    bottom: (b.y + b.h) >= 1 - eps
  };
}

export function applyRefinedBoxes(items, refined, crops) {
  const list = items || [];
  const refs = refined || [];
  const cuts = crops || [];
  return list.map((it, i) => {
    const crop = cuts[i];
    const hit = refs.find(r => Number(r.index) === i + 1)
      || refs.find(r => r.name && nameKey(r.name) === nameKey(it.name));
    if (!hit || !crop || hit.found === false) return it;
    const box = mapBoxToPhoto(hit.box, crop.frac);
    if (!box) return it;
    // A refined box that is still nearly the whole crop is not an improvement.
    const local = normalizeBox(hit.box);
    if (local && isNearlyFullTile(local, { area: 0.92, edge: 0.95 })) return it;
    const where = (it.where && it.where !== "on the table") ? it.where : whereFromBox(box);
    return { ...it, box, where, boxRefined: true };
  });
}

/* ---------- auto-run when the cheap pass found little on a busy frame ---------- */

/**
 * Run Look deeper automatically when the cheap pass came back nearly empty
 * on a photo. Tight table photos that already found several things are
 * left on the cheap pass (the button is still there).
 */
export function shouldLookDeeper(result, { kind, itemCount } = {}) {
  if (kind === "video") return false;
  const items = ((result && result.items) || []).filter(it => it && !it.dismissed);
  const skipped = (result && result.skipped) || [];
  const n = itemCount != null ? Number(itemCount) : items.length;
  if (!Number.isFinite(n) || n < 0) return false;
  if (n === 0) return true;
  if (n >= 3) return false;
  const area = items.reduce((s, it) => {
    const b = normalizeBox(it.box);
    return s + (b ? b.w * b.h : 0);
  }, 0);
  if (n <= 1 && skipped.length >= 1) return true;
  if (n <= 1 && area > 0 && area < 0.18) return true;
  if (n <= 2 && skipped.length >= 3) return true;
  return false;
}

/* ---------- people, work vehicles, trailers, parts; brands; lot grouping ---------- */

const PEOPLE_RE = /\b(person|people|a man|a woman|a child|someone|customer|shopper|bystander|pedestrian|worker standing)\b/i;
const IGNORE_PART_RE = /\b((orange\s+)?(ratchet\s+)?straps?|\bbuckles?\b|(truck(\s+bed)?|cargo|bed)\s+racks?|(rusty\s+)?((red|white|black|blue|green)\s+)?(trailer\s+)?fenders?)\b/i;
const TRAILER_SELF_RE = /\b((utility|car|equipment|dump|boat)\s+)?trailers?(\s+with\s+(dual\s+)?wheels?)?\b/i;
const TRAILER_TIRE_RE = /\b(trailer\s+tires?|tires?\s+(on|mounted\s+on|under)\s+(the\s+)?(trailer|fender)|tires?\s+under\s+the\s+fender)\b/i;
const KEEP_MACHINE_RE = /\b(mower|tractor|boat|canoe|kayak|atv|utv|golf cart|camper|forklift|skid steer|generator|snowmobile|dirt bike|jet ski)\b/i;
const ROAD_VEHICLE_RE = /\b((pickup\s*)?trucks?|pickups?|\bsuvs?\b|\bsedans?\b|\bvans?\b|automobiles?|\bcars?\b|gmc\s+sierra|ford\s+f-?1[45]0|silverado|sierra\s+truck)\b/i;
const NOT_ROAD_VEHICLE_RE = /\b(hand truck|dolly|sack truck|appliance dolly|truck bed(?!\s+rack)|toolbox|tool box|tonneau)\b/i;
const FOR_SALE_SIGN_RE = /\b(for sale|forsale|sale sign|with a sign)\b/i;

const NOT_A_BRAND_RE = /^(benchtop|decorative|vintage|wooden|white|black|orange|red|blue|green|plastic|metal|large|small|assorted|reclaimed|stacked|double|granite|ceramic|street|rusty|used|old|new|heavy|portable|electric|manual|commercial|industrial|household|fluorescent)$/i;

export function cleanBrand(brand, name) {
  const b = String(brand || "").trim();
  if (!b) return "";
  if (NOT_A_BRAND_RE.test(b)) return "";
  // A word that is only a generic type from the name ("Benchtop" on a benchtop saw).
  const nk = nameKey(name);
  if (nk && nameKey(b) && nk.includes(nameKey(b)) && NOT_A_BRAND_RE.test(b.split(/\s+/)[0])) return "";
  return b.slice(0, 40);
}

export function notForSaleReason(item) {
  const name = String((item && item.name) || "");
  const text = [name, item && item.why, item && item.where].filter(Boolean).join(" ");
  if (PEOPLE_RE.test(text)) return "A person, not something for sale.";
  if (IGNORE_PART_RE.test(name) || IGNORE_PART_RE.test(text)) {
    if (/\bstrap/i.test(text)) return "A strap holding the load, not something to sell on its own.";
    if (/\frack|\brack/i.test(text)) return "A rack on a work truck or trailer, not merchandise.";
    if (/\bfender/i.test(text)) return "Part of the trailer, not merchandise.";
    return "Part of the truck or trailer, not merchandise.";
  }
  if (TRAILER_TIRE_RE.test(text) || (/\btires?\b/i.test(name) && /\b(trailer|fender)\b/i.test(text))) {
    return "Tires mounted on a trailer, not a pile of tires for sale.";
  }
  if (TRAILER_SELF_RE.test(name) && !/\bon\s+(a|the)\s+trailer\b/i.test(name)) {
    return "The trailer carrying the goods, not merchandise on it.";
  }
  if (isParkedRoadVehicle(item)) return "Looks like a work or parked vehicle, not something for sale.";
  return "Not something that looks like it is for sale.";
}

function isParkedRoadVehicle(item) {
  const name = String((item && item.name) || "");
  const text = [name, item && item.why, item && item.where].filter(Boolean).join(" ");
  if (NOT_ROAD_VEHICLE_RE.test(name) || KEEP_MACHINE_RE.test(name)) return false;
  if (!ROAD_VEHICLE_RE.test(name)) return false;
  if (FOR_SALE_SIGN_RE.test(text)) return false;
  return true;
}

export function isNotForSale(item) {
  if (!item) return false;
  const name = String(item.name || "");
  const text = [name, item.why, item.where].filter(Boolean).join(" ");
  if (PEOPLE_RE.test(text)) return true;
  if (IGNORE_PART_RE.test(name)) return true;
  if (TRAILER_TIRE_RE.test(text) || (/\btires?\b/i.test(name) && /\b(trailer|fender)\b/i.test(text))) return true;
  if (TRAILER_SELF_RE.test(name) && !/\bon\s+(a|the)\s+trailer\b/i.test(name) && !KEEP_MACHINE_RE.test(name)) return true;
  if (KEEP_MACHINE_RE.test(name)) return false;
  if (isParkedRoadVehicle(item)) return true;
  return false;
}

export function filterForSale(items) {
  return (items || []).filter(it => !isNotForSale(it));
}

export function partitionForSale(items) {
  const kept = [], skipped = [];
  for (const it of (items || [])) {
    if (isNotForSale(it)) skipped.push({ name: it.name, reason: notForSaleReason(it) });
    else kept.push(it);
  }
  return { items: kept, skipped };
}

export function preferredName(name) {
  let n = String(name || "").trim();
  if (!n) return n;
  // Set2 lesson: "white sinks" on a trailer of slabs are vanity tops.
  if (/^(a\s+)?(\d+\s+)?white\s+sinks$/i.test(n) || /^(a\s+)?(\d+\s+)?(white\s+)?sinks$/i.test(n)) {
    const m = n.match(/^(\d+)\s+/);
    return (m ? m[1] + " " : "") + "vanity tops with sinks";
  }
  if (/^white appliances$/i.test(n) || /^white appliance$/i.test(n)) {
    return "light fixtures";
  }
  return n;
}

export function nameScore(name) {
  const n = String(name || "");
  let s = 0;
  if (/\b(vanity|countertop|undermount)\b/i.test(n)) s += 6;
  if (/\b(light fixture|fluorescent|shop light|t12|t8)\b/i.test(n)) s += 6;
  if (/\b(cabinet|cupboard)\b/i.test(n)) s += 6;
  if (/\b(fireplace insert|wood stove|range|oven|cooktop)\b/i.test(n)) s += 6;
  if (/^(white sinks|white appliances|reclaimed lumber|assorted reclaimed lumber)$/i.test(n)) s -= 4;
  if (/^(white|black|old|rusty|wooden|plastic|metal|large|small|assorted|reclaimed|decorative|vintage)\s+/i.test(n)) s -= 1;
  s += Math.min(3, n.split(/\s+/).length / 2);
  return s;
}

export function pickBetterName(a, b) {
  const sa = nameScore(a), sb = nameScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  return String(a || "").length >= String(b || "").length ? a : b;
}

export function lotType(name) {
  const n = stripLeadingCount(name);
  if (/\b(vanity|countertop|undermount)\b/i.test(n) || /^(white\s+)?sinks$/i.test(n) || /\bvanity tops?\b/i.test(n)) return "vanity";
  if (/\b(light fixtures?|fluorescent|shop lights?|\bt12\b|\bt8\b)\b/i.test(n)) return "lights";
  if (/\b(french doors?|glass-pane doors?)\b/i.test(n)) return "french-door";
  if (/\b(cabinets?|cupboards?)\b/i.test(n)) return "cabinet";
  if (/\b(hand trucks?|doll(?:y|ies))\b/i.test(n)) return "dolly";
  if (/\b((riding|lawn)\s+mowers?|tractors?)\b/i.test(n)) return "mower";
  if (/\b(fireplace inserts?|wood stoves?|electric (ranges?|stoves?)|ranges?|ovens?)\b/i.test(n)) return "stove";
  if (/\b(window frames?|windows?)\b/i.test(n) && !/\bwindows?\s+of\b/i.test(n)) return "window";
  return nameKey(n);
}

export function sameLotType(a, b) {
  const na = typeof a === "string" ? a : (a && a.name);
  const nb = typeof b === "string" ? b : (b && b.name);
  const ta = lotType(na), tb = lotType(nb);
  return !!(ta && tb && ta === tb);
}

function parseLeadingCount(name) {
  const m = String(name || "").trim().match(/^(\d+)\s+/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

function stripLeadingCount(name) {
  return String(name || "").trim().replace(/^\d+\s+/, "").replace(/^stack of\s+/i, "").trim();
}

function capLike(sample, replacement) {
  const s = String(sample || "");
  const r = String(replacement || "");
  if (!s || !r) return r;
  if (s[0] === s[0].toUpperCase() && s.slice(1) === s.slice(1).toLowerCase()) {
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  if (s === s.toUpperCase()) return r.toUpperCase();
  return r;
}

function simplePlural(phrase) {
  let s = String(phrase || "").trim();
  if (!s) return s;
  const pairs = [
    [/\bvanity tops?\b/i, "vanity tops"],
    [/\bcountertops?\b/i, "countertops"],
    [/\bundermount sinks?\b/i, "undermount sinks"],
    [/\bsinks?\b/i, "sinks"],
    [/\blight fixtures?\b/i, "light fixtures"],
    [/\bfixtures?\b/i, "fixtures"],
    [/\bcabinets?\b/i, "cabinets"],
    [/\bfrench doors?\b/i, "French doors"],
    [/\bdoors?\b/i, "doors"],
    [/\bwindows?\b/i, "windows"],
    [/\bwindow frames?\b/i, "window frames"],
    [/\btires?\b/i, "tires"],
    [/\bchairs?\b/i, "chairs"],
    [/\bmowers?\b/i, "mowers"],
    [/\bframes?\b/i, "frames"],
    [/\bstoves?\b/i, "stoves"],
    [/\branges?\b/i, "ranges"],
    [/\binserts?\b/i, "inserts"],
    [/\bhand trucks?\b/i, "hand trucks"],
    [/\bshelves\b|\bshelf\b/i, "shelves"]
  ];
  let changed = false;
  for (const [re, pl] of pairs) {
    s = s.replace(re, (m) => {
      changed = true;
      return capLike(m, pl);
    });
  }
  if (changed) return s;
  // Fall back: pluralize the last word only, never the leading adjective.
  return s.replace(/([A-Za-z]+)(?![A-Za-z]*[A-Za-z]\w*)(?=\s*$)/, (word) => {
    if (/s$/i.test(word)) return word;
    if (/y$/i.test(word) && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
    if (/(ch|sh|x|z|ss)$/i.test(word)) return word + "es";
    return word + "s";
  });
}

function unionBox(a, b) {
  const aa = normalizeBox(a), bb = normalizeBox(b);
  if (!aa) return bb;
  if (!bb) return aa;
  const x = Math.min(aa.x, bb.x);
  const y = Math.min(aa.y, bb.y);
  const x2 = Math.max(aa.x + aa.w, bb.x + bb.w);
  const y2 = Math.max(aa.y + aa.h, bb.y + bb.h);
  return normalizeBox({ x, y, w: x2 - x, h: y2 - y });
}

function lotsMatch(a, b) {
  return namesSimilar(stripLeadingCount(a.name), stripLeadingCount(b.name)) || sameLotType(a, b);
}

/**
 * Collapse matching repeats into one lot ("6 vanity tops with sinks").
 * `quantity`: "sum" (default) for several detections in one photo;
 * "max" when combining several photos of the same load, so the same
 * slab photographed twice is not counted twice.
 */
export function groupRepeatLots(items, { quantity = "sum" } = {}) {
  const out = [];
  for (const it of (items || [])) {
    const named = { ...it, name: preferredName(it.name), brand: cleanBrand(it.brand, it.name) };
    const hit = out.findIndex(x => lotsMatch(x, named));
    if (hit < 0) {
      out.push({ ...named, quantity: named.quantity || parseLeadingCount(named.name) });
      continue;
    }
    const a = out[hit];
    const qa = Number(a.quantity) || parseLeadingCount(a.name);
    const qb = Number(named.quantity) || parseLeadingCount(named.name);
    const q = quantity === "max" ? Math.max(qa, qb) : qa + qb;
    const base = stripLeadingCount(pickBetterName(a.name, named.name));
    const name = q > 1 ? `${q} ${simplePlural(stripLeadingCount(base))}` : (pickBetterName(a.name, named.name));
    const lows = [a.priceLow, named.priceLow].filter(v => v != null && Number.isFinite(Number(v)));
    const highs = [a.priceHigh, named.priceHigh].filter(v => v != null && Number.isFinite(Number(v)));
    const checks = [...(a.whatToCheck || [])];
    for (const c of (named.whatToCheck || [])) {
      if (!checks.some(x => nameKey(x) === nameKey(c))) checks.push(c);
    }
    out[hit] = {
      ...a,
      name,
      quantity: q,
      why: (nameScore(named.name) > nameScore(a.name) ? (named.why || a.why) : (a.why || named.why)),
      priceLow: lows.length ? Math.min(...lows.map(Number)) : a.priceLow,
      priceHigh: highs.length ? Math.max(...highs.map(Number)) : a.priceHigh,
      priceNote: a.priceNote || named.priceNote,
      where: (a.where && a.where !== "on the table") ? a.where : (named.where || a.where),
      whatToCheck: checks.slice(0, 10),
      box: a.boxRefined && !named.boxRefined ? a.box : (named.boxRefined && !a.boxRefined ? named.box : unionBox(a.box, named.box)),
      brand: a.brand || named.brand || "",
      confidence: a.confidence === "medium" || named.confidence === "medium" ? "medium" : (a.confidence || named.confidence),
      boxRefined: !!(a.boxRefined || named.boxRefined),
      lookedDeeper: !!(a.lookedDeeper || named.lookedDeeper),
      sourceScanIds: Array.from(new Set([...(a.sourceScanIds || []), ...(named.sourceScanIds || [])]))
    };
  }
  return out;
}

/* ---------- map model output (tile-space boxes) into photo space ---------- */

export function mapDeeperItems(raw, tiles, { overviewIsFull = true } = {}) {
  const parsed = normalizeSecondLook(raw, tiles);
  const items = [];
  for (const [i, it] of (parsed.items || []).entries()) {
    const rawItem = raw && raw.items && raw.items[i];
    const tileIdx = Number(
      (rawItem && (rawItem.tile ?? rawItem.frame))
      ?? (it.tile != null ? it.tile : it.frame)
    );
    const rawBox = (rawItem && (rawItem.box || rawItem.bbox)) || it.box;
    const tile = tileByIndex(tiles, tileIdx);
    let box;
    if (tile) {
      box = photoBoxFromTile(rawBox, tile);
    } else if (!Number.isFinite(tileIdx) || tileIdx <= 0) {
      box = overviewIsFull ? normalizeBox(rawBox) : it.box;
    } else {
      box = normalizeBox(rawBox);
    }
    const where = (it.where && it.where !== "on the table") ? it.where : whereFromBox(box);
    const quantity = Number(it.quantity) || (rawItem && Number(rawItem.quantity)) || parseLeadingCount(it.name) || 1;
    const name = preferredName(it.name);
    const brand = cleanBrand((rawItem && rawItem.brand) || it.brand, name);
    items.push({
      ...it,
      id: it.id || ("li_d_" + (i + 1)),
      name,
      brand,
      box,
      where,
      frame: 1,
      tile: Number.isFinite(tileIdx) ? tileIdx : 0,
      rawBox,
      quantity,
      lookedDeeper: true,
      needsRefine: needsBoxRefine({ box }, tile, rawBox)
    });
  }
  const { items: kept, skipped: dropped } = partitionForSale(dedupeItems(items));
  const cleaned = groupRepeatLots(kept, { quantity: "sum" });
  const skipped = [...(parsed.skipped || []), ...dropped];
  return {
    items: cleaned,
    skipped,
    note: parsed.note || "",
    ok: parsed.ok !== false
  };
}

export function mergeDeeperWithFirst(firstItems, deeperItems) {
  const deeper = (deeperItems || []).map((it, i) => ({
    ...it,
    id: it.id || ("li_d_" + (i + 1)),
    lookedDeeper: true
  }));
  const first = (firstItems || []).map(it => ({ ...it }));
  return groupRepeatLots(filterForSale(dedupeItems([...deeper, ...first])), { quantity: "sum" });
}

/* ---------- same-load merge across several photos ---------- */

export function looksLikeSameLoad(a, b, { now, windowMs = LOAD_WINDOW_MS } = {}) {
  if (!a || !b || a.id === b.id) return false;
  if (a.kind === "video" || b.kind === "video") return false;
  if (a.mergedInto && a.mergedInto !== (b.id || "")) return false;
  if (b.mergedInto && b.mergedInto !== (a.id || "")) return false;
  const ta = a.createdAt || 0, tb = b.createdAt || 0;
  if (Math.abs(ta - tb) > windowMs) return false;
  const ia = filterForSale((a.items || []).filter(it => !it.dismissed));
  const ib = filterForSale((b.items || []).filter(it => !it.dismissed));
  if (!ia.length || !ib.length) return false;
  let hits = 0;
  for (const x of ia) {
    if (ib.some(y => lotsMatch(x, y))) hits++;
  }
  return hits >= 1;
}

/**
 * Combine several photos of the same load into one inventory.
 * Counts use max, not sum, so the same vanity top photographed from two
 * angles is still one piece. Better names win (vanity tops, not "white sinks").
 */
export function mergeLoadInventories(scans) {
  const list = (scans || []).filter(Boolean);
  const sourceScanIds = list.map(s => s.id).filter(Boolean);
  const flat = [];
  for (const s of list) {
    for (const it of filterForSale((s.items || []).filter(x => !x.dismissed))) {
      flat.push({
        ...it,
        sourceScanIds: Array.from(new Set([...(it.sourceScanIds || []), s.id].filter(Boolean)))
      });
    }
  }
  const items = groupRepeatLots(flat, { quantity: "max" });
  const skipped = [];
  const seen = new Set();
  for (const s of list) {
    for (const sk of (s.skipped || [])) {
      const k = nameKey(sk.name);
      if (k && !seen.has(k)) { seen.add(k); skipped.push(sk); }
    }
  }
  const n = list.length;
  const note = n > 1
    ? `Combined with ${n - 1} other photo${n - 1 === 1 ? "" : "s"} of this load.`
    : "";
  return { items, skipped, note, sourceScanIds };
}

export function recentSameLoadScans(scan, storage, { windowMs = LOAD_WINDOW_MS } = {}) {
  if (!scan) return [];
  const all = loadScans(storage) || [];
  return all.filter(s => s && s.id !== scan.id && looksLikeSameLoad(scan, s, { windowMs }));
}

export function applyLoadMerge(scan, others) {
  const peers = (others || []).filter(Boolean);
  if (!peers.length) {
    return { ...scan, loadScanIds: scan.loadScanIds || [scan.id], loadNote: scan.loadNote || "" };
  }
  const merged = mergeLoadInventories([scan, ...peers]);
  return {
    ...scan,
    items: merged.items,
    skipped: merged.skipped,
    loadScanIds: merged.sourceScanIds,
    loadNote: merged.note,
    note: [scan.note, merged.note].filter(Boolean).join(" ")
  };
}

/* ---------- EXIF-upright decode and tile cutting (browser) ---------- */

async function decodeUpright(fileOrUrl) {
  if (typeof createImageBitmap === "function" && (fileOrUrl instanceof Blob || (typeof File !== "undefined" && fileOrUrl instanceof File))) {
    try {
      return await createImageBitmap(fileOrUrl, { imageOrientation: "from-image" });
    } catch (e) { /* fall through */ }
  }
  let dataUrl = typeof fileOrUrl === "string" ? fileOrUrl : null;
  if (!dataUrl && fileOrUrl) dataUrl = await fileToDataUrl(fileOrUrl);
  if (typeof Image === "undefined") {
    throw new Error(MSG_BAD_PHOTO);
  }
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(MSG_BAD_PHOTO));
    im.src = dataUrl;
  });
  return img;
}

function canvasToJpeg(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

function drawCrop(source, sx, sy, sw, sh, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return { dataUrl: canvasToJpeg(c, quality), width: w, height: h };
}

/**
 * Cut overlapping tiles from an EXIF-corrected full-resolution photo,
 * plus a smaller whole-photo overview. Used by Look deeper only.
 */
export async function tilesFromPhoto(file, {
  grid = LOOK_DEEPER_GRID,
  overlap = LOOK_DEEPER_OVERLAP,
  maxEdge = LOOK_DEEPER_TILE_EDGE,
  quality = LOOK_DEEPER_TILE_QUALITY,
  overviewEdge = LOOK_DEEPER_OVERVIEW_EDGE
} = {}) {
  if (!file) throw Object.assign(new Error(MSG_NO_MEDIA), { code: "no-photo" });
  if (typeof document === "undefined") {
    throw new Error("Look deeper cuts tiles on the phone.");
  }
  const bmp = await decodeUpright(file);
  const W = bmp.width || bmp.naturalWidth;
  const H = bmp.height || bmp.naturalHeight;
  if (!W || !H) throw new Error(MSG_BAD_PHOTO);
  const layout = photoTiles(W, H, { grid, overlap });
  const tiles = [];
  for (const t of layout.tiles) {
    const cut = drawCrop(bmp, t.x, t.y, t.w, t.h, maxEdge, quality);
    tiles.push({ ...t, dataUrl: cut.dataUrl, width: cut.width, height: cut.height });
  }
  const overview = drawCrop(bmp, 0, 0, W, H, overviewEdge, 0.72);
  try { if (bmp.close) bmp.close(); } catch (e) { /* Image has no close */ }
  return {
    width: W,
    height: H,
    grid: layout.grid,
    overlap: layout.overlap,
    tiles,
    overview: { dataUrl: overview.dataUrl, width: overview.width, height: overview.height, frac: { x: 0, y: 0, w: 1, h: 1 }, index: 0 },
    bitmapSize: { width: W, height: H }
  };
}

export async function cropsForRefine(file, items, packed, { max = LOOK_DEEPER_MAX_REFINE } = {}) {
  const list = (items || []).slice(0, max);
  if (!list.length) return [];
  let source = null;
  let W, H;
  if (packed && packed.overview && packed.overview.dataUrl && typeof document !== "undefined") {
    // Prefer a fresh decode of the original so the crop is sharp.
  }
  if (file && typeof document !== "undefined") {
    try {
      source = await decodeUpright(file);
      W = source.width || source.naturalWidth;
      H = source.height || source.naturalHeight;
    } catch (e) { source = null; }
  }
  const crops = [];
  for (const [i, it] of list.entries()) {
    const raw = it.rawBox || it.box;
    const edges = edgesTouched(raw);
    const frac = refineCropFrac(it.box, { pad: LOOK_DEEPER_REFINE_PAD, edges });
    let dataUrl = "";
    let width = 0, height = 0;
    if (source && W && H) {
      const cut = drawCrop(
        source,
        Math.round(frac.x * W), Math.round(frac.y * H),
        Math.max(1, Math.round(frac.w * W)), Math.max(1, Math.round(frac.h * H)),
        LOOK_DEEPER_TILE_EDGE, 0.88
      );
      dataUrl = cut.dataUrl;
      width = cut.width;
      height = cut.height;
    } else if (packed && packed.overview && packed.overview.dataUrl) {
      dataUrl = packed.overview.dataUrl;
      width = packed.overview.width;
      height = packed.overview.height;
    }
    crops.push({
      index: i + 1,
      name: it.name,
      brand: it.brand || "",
      frac,
      dataUrl,
      width,
      height,
      label: `Image ${i + 1} is a close-up crop around “${it.name}”${it.brand ? ` (brand mark to confirm: ${it.brand})` : ""}. Report a tight box as fractions of THIS crop.`
    });
  }
  try { if (source && source.close) source.close(); } catch (e) { /* Image has no close */ }
  return crops;
}

/* ---------- API ---------- */

export function deeperUserText(tiles, { grid = LOOK_DEEPER_GRID } = {}) {
  const list = tiles || [];
  const lines = list.map(t => t.label || `Image ${t.index} is a tile of the photograph. Report box coordinates as fractions of THIS tile.`);
  return [
    `This is one photograph, shown first as a smaller overview of the whole scene (Image 0), then as ${list.length} overlapping ${grid}×${grid} tiles of the same photo at much higher resolution.`,
    "When you report a box, use fractions from 0 to 1 of THAT TILE (the image the item was clearest in), and set tile to that image's number. Do not convert to the full photograph — we will do that in code. Give a tight box around the item, not the whole tile, and not the floor or ceiling.",
    "Do not skip chairs, mowers, tires (a pile of tires), doors, windows, pipe, stoves, fireplace inserts, or ranges. Read brand decals, box labels, and sign lettering you can actually see, and attach a brand only to the object it is printed on.",
    "Name vanity tops (not “white sinks”), light fixtures (not “appliances”), and cabinets (not “lumber”). Group matching repeats into one lot, with the count in the name.",
    "Ignore people, parked or work cars and trucks, trailers that are only carrying the goods, trailer fenders, tires mounted on a trailer, straps, and racks.",
    "Image 0 is the downscaled overview of the entire photograph. If you only see something there, set tile to 0 and give a box as fractions of the overview (which is the full photo).",
    ...lines,
    "Reply with a single JSON object."
  ].join("\n");
}

export async function requestLookDeeper({ tiles, overview, key, fetchImpl, model = LOOK_DEEPER_MODEL } = {}) {
  const shots = [];
  if (overview && (overview.dataUrl || typeof overview === "string")) {
    shots.push({ dataUrl: overview.dataUrl || overview, index: 0 });
  }
  for (const t of (tiles || [])) {
    if (t && (t.dataUrl || typeof t === "string")) shots.push({ dataUrl: t.dataUrl || t, index: t.index });
  }
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
  const { json, usage, model: used } = await chatJson({
    system: LOOK_DEEPER_SYSTEM,
    userText: deeperUserText(tiles),
    photos: shots,
    key: k,
    fetchImpl,
    model,
    maxTokens: 2800,
    temperature: 0.2,
    maxPhotos: LOOK_DEEPER_MAX_PHOTOS,
    imageDetail: LOOK_DEEPER_DETAIL
  });
  const mapped = mapDeeperItems(json, tiles);
  return { result: mapped, usage, model: used || model, raw: json };
}

export function refineUserText(crops) {
  const lines = (crops || []).map(c => c.label || `Image ${c.index} is a close-up of “${c.name}”.`);
  return [
    "Tighten the box around each named item. Report fractions of THAT crop, from 0 to 1. Exclude floor, ceiling, and empty space.",
    ...lines,
    "Reply with a single JSON object: { \"boxes\": [ { \"index\": 1, \"name\": \"...\", \"box\": { \"x\", \"y\", \"w\", \"h\" }, \"found\": true } ] }."
  ].join("\n");
}

export async function requestBoxRefine({ crops, key, fetchImpl, model = LOOK_DEEPER_MODEL } = {}) {
  const shots = (crops || []).filter(c => c && (c.dataUrl || typeof c === "string"));
  if (!shots.length) return { boxes: [], usage: null, model };
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(MSG_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  const { json, usage, model: used } = await chatJson({
    system: REFINE_SYSTEM,
    userText: refineUserText(shots),
    photos: shots,
    key: k,
    fetchImpl,
    model,
    maxTokens: 1200,
    temperature: 0.1,
    maxPhotos: LOOK_DEEPER_MAX_REFINE,
    imageDetail: LOOK_DEEPER_DETAIL
  });
  const raw = (json && (json.boxes || json.items)) || [];
  const boxes = raw.map((r, i) => ({
    index: Number(r && r.index) || (i + 1),
    name: String((r && r.name) || ""),
    box: normalizeBox(r && (r.box || r.bbox)),
    found: r && r.found !== false
  })).filter(r => r.box);
  return { boxes, usage, model: used || model, raw: json };
}

function getSettingsSafe() {
  try { return getSettings() || {}; } catch (e) { return {}; }
}
function getEnabledSafe() {
  try { return getEnabledIds() || []; } catch (e) { return []; }
}

function addUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    prompt_tokens: (Number(a.prompt_tokens) || 0) + (Number(b.prompt_tokens) || 0),
    completion_tokens: (Number(a.completion_tokens) || 0) + (Number(b.completion_tokens) || 0)
  };
}

/**
 * Run Look deeper on a photo, merge with the first-pass items, refine boxes,
 * and return the combined result. Does not touch the job or storage — the
 * caller does.
 */
export async function runLookDeeper({
  file, scan, key, fetchImpl, chatImpl, refineImpl, cropFn, tiles: readyTiles, onProgress, cancelled
} = {}) {
  if (cancelled && cancelled()) {
    const err = new Error("Cancelled.");
    err.code = "cancelled";
    throw err;
  }
  let packed = readyTiles;
  if (!packed) {
    if (onProgress) onProgress({ stage: "tiles", progress: "Cutting closer looks from your photo…" });
    packed = await tilesFromPhoto(file);
  }
  if (cancelled && cancelled()) {
    const err = new Error("Cancelled.");
    err.code = "cancelled";
    throw err;
  }
  if (onProgress) onProgress({ stage: "ai", progress: LOOK_DEEPER_PROGRESS });
  const chat = chatImpl || requestLookDeeper;
  const { result, usage, model } = await chat({
    tiles: packed.tiles,
    overview: packed.overview,
    key,
    fetchImpl
  });
  let items = result.items || [];
  let refineUsage = null;
  const toRefine = items.filter(it => it.needsRefine !== false).slice(0, LOOK_DEEPER_MAX_REFINE);
  if (toRefine.length) {
    if (cancelled && cancelled()) {
      const err = new Error("Cancelled.");
      err.code = "cancelled";
      throw err;
    }
    try {
      if (onProgress) onProgress({ stage: "refine", progress: LOOK_DEEPER_REFINE_PROGRESS });
      const crops = await cropsForRefine(file, items.slice(0, LOOK_DEEPER_MAX_REFINE), packed);
      const usable = crops.filter(c => c.dataUrl);
      if (usable.length) {
        const refine = refineImpl || requestBoxRefine;
        const refined = await refine({ crops: usable, key, fetchImpl });
        refineUsage = refined && refined.usage;
        items = applyRefinedBoxes(items, refined && refined.boxes, crops);
      }
    } catch (e) {
      // A failed refine must not lose the items we already found.
      if (e && e.code === "cancelled") throw e;
    }
  }
  const first = (scan && scan.items) || [];
  const merged = mergeDeeperWithFirst(first, items);
  const skipped = [...((result.skipped) || [])];
  for (const s of ((scan && scan.skipped) || [])) {
    if (!skipped.some(x => nameKey(x.name) === nameKey(s.name))) skipped.push(s);
  }
  const added = Math.max(0, merged.length - first.filter(it => !it.dismissed).length);
  const note = added
    ? `Looked more closely — found ${merged.length} ${merged.length === 1 ? "thing" : "things"} worth a closer look.`
    : (result.note || (scan && scan.note) || "Looked more closely. Nothing new jumped out.");
  const withThumbs = await attachThumbs(
    { items: merged, skipped, note },
    packed.overview ? [packed.overview] : (packed.tiles || []),
    cropFn || cropDataUrl
  );
  const settings = getSettingsSafe();
  const siteIds = getEnabledSafe();
  const decorated = (withThumbs.items || []).map(it => {
    const d = decorateItem(it, { desiredProfit: settings.desiredProfit, siteIds });
    return { ...d, lookedDeeper: true, boxRefined: !!it.boxRefined, quantity: it.quantity, brand: it.brand || d.brand || "" };
  });
  return {
    items: decorated,
    skipped: withThumbs.skipped,
    note: withThumbs.note,
    coverThumb: withThumbs.coverThumb || (scan && scan.coverThumb) || "",
    added,
    usage: addUsage(usage, refineUsage),
    model,
    photoWidth: packed.width,
    photoHeight: packed.height
  };
}

export function deeperReadyLabel(scan) {
  const n = ((scan && scan.items) || []).filter(it => !it.dismissed).length;
  if (scan && scan.lookedDeeper) {
    const load = scan.loadNote ? ` ${scan.loadNote}` : "";
    return n
      ? `Looked more closely — ${n} ${n === 1 ? "thing" : "things"} to check.${load}`
      : `Looked more closely. Nothing jumped out, but you can read what was skipped.${load}`;
  }
  return scan && scan.loadNote ? scan.loadNote : "";
}


/**
 * Run Look deeper in the background, update the saved scan, and (when
 * recent photos look like the same load) combine them into one inventory.
 */
export async function startLookDeeper({
  scanId, file, key, fetchImpl, chatImpl, refineImpl, cropFn, onProgress, auto, storage, tiles
} = {}) {
  if (getJob() && getJob().status === "running") {
    const err = new Error(MSG_BUSY);
    err.code = "busy";
    throw err;
  }
  const scan = getScan(scanId, storage);
  if (!scan) {
    const err = new Error("That scan couldn't be found.");
    err.code = "no-scan";
    throw err;
  }
  if (scan.kind === "video") {
    const err = new Error(MSG_VIDEO);
    err.code = "video";
    throw err;
  }
  const src = file || getScanSource(scanId);
  if (!src) {
    const err = new Error(MSG_NEED_PHOTO);
    err.code = "need-photo";
    throw err;
  }
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(MSG_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  resetCancelFlag();
  const startedAt = Date.now();
  setJob({
    status: "running",
    progress: LOOK_DEEPER_PROGRESS,
    stage: "deeper",
    kind: "photo",
    startedAt,
    error: "",
    warning: "",
    scanId: scan.id,
    lookingDeeper: true,
    auto: !!auto
  });
  try {
    const result = await runLookDeeper({
      file: src,
      scan,
      key: k,
      fetchImpl,
      chatImpl,
      refineImpl,
      cropFn,
      tiles,
      onProgress: p => {
        setJob({
          ...getJob(),
          status: "running",
          lookingDeeper: true,
          progress: (p && p.progress) || LOOK_DEEPER_PROGRESS,
          stage: (p && p.stage) || "deeper",
          scanId: scan.id
        });
        if (onProgress) onProgress(getJob());
      },
      cancelled: () => isJobCancelled()
    });
    if (isJobCancelled()) {
      setJob({ status: "cancelled", progress: "Cancelled.", startedAt, error: "", scanId: scan.id, lookingDeeper: false });
      return getJob();
    }
    let next = {
      items: result.items,
      skipped: result.skipped,
      note: result.note,
      coverThumb: result.coverThumb || scan.coverThumb,
      lookedDeeper: true,
      lookedDeeperAt: Date.now(),
      unread: true
    };
    const draft = { ...scan, ...next };
    const peers = recentSameLoadScans(draft, storage);
    if (peers.length) {
      const combined = applyLoadMerge(draft, peers);
      const settings = getSettingsSafe();
      const siteIds = getEnabledSafe();
      next = {
        ...next,
        items: (combined.items || []).map(it => decorateItem(it, { desiredProfit: settings.desiredProfit, siteIds })),
        skipped: combined.skipped,
        note: combined.note,
        loadScanIds: combined.loadScanIds,
        loadNote: combined.loadNote
      };
      for (const p of peers) {
        try {
          updateScan(p.id, { mergedInto: scan.id, loadScanIds: next.loadScanIds, loadNote: "Combined into a later photo of this load." }, storage);
        } catch (e) { /* keep going */ }
      }
    }
    const saved = updateScan(scan.id, next, storage);
    setJob({
      status: "done",
      progress: deeperReadyLabel(saved) || "Looked more closely.",
      stage: "done",
      kind: "photo",
      startedAt,
      doneAt: Date.now(),
      error: "",
      scanId: scan.id,
      lookingDeeper: false,
      lookedDeeper: true,
      result: saved,
      unread: true
    });
    return getJob();
  } catch (e) {
    if (e && e.code === "cancelled") {
      setJob({ status: "cancelled", progress: "Cancelled.", startedAt, error: "", scanId: scan.id, lookingDeeper: false });
      return getJob();
    }
    const message = (e && e.message) ? e.message : "The closer look couldn't be finished. Try again.";
    setJob({
      status: "error",
      progress: "",
      stage: "error",
      kind: "photo",
      startedAt,
      error: message,
      scanId: scan.id,
      lookingDeeper: false
    });
    throw e;
  }
}

export { MSG_NETWORK };
