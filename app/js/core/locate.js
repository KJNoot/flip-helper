// Grid-cell localization + a yes/no verify for Look deeper boxes (v0.7.4).
// Models are much better at naming a labeled cell (B4–C6) than at raw 0–1
// coordinates. After a cell range is mapped to a photo box in code, we crop
// that region with padding and ask whether the named item is really there,
// plus a tighter box. A crop that fails verification is dropped — we would
// rather leave the exact spot unknown than send someone to an empty wall.
// About a cent and a half on top of the first deeper look, well under six
// cents for the whole scan. Nothing is emailed.

import { chatJson } from "./draft.js";
import { getKey } from "./key.js";
import { MSG_NO_KEY, normalizeBox } from "./secondlook.js";

export const LOCATE_MODEL = "gpt-4o";
export const LOCATE_DETAIL = "high";
export const LOCATE_PROGRESS = "Pinning where each thing is in the photo…";
export const VERIFY_PROGRESS = "Checking that each box is really on the item…";
export const GRID_MAX_EDGE = 1536;
export const GRID_QUALITY = 0.9;
export const GRID_PAD = 0.10;
export const GRID_MAX_ITEMS = 8;
export const CROP_GRID = { cols: "ABCD", rows: 4 };
export const BOX_DROPPED_NOTE = "We couldn't pin the exact spot. Look around this area.";
export const BOX_APPROX_NOTE = "Approximate area — look around this part of the photo.";

export function gridSpec(width, height) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  // Roughly square cells: 6×8 on a tall photo, 8×6 on a wide one.
  if (w >= h) return { cols: "ABCDEFGH", rows: 6 };
  return { cols: "ABCDEF", rows: 8 };
}

export function parseCell(raw, spec) {
  const g = spec || gridSpec(1, 2);
  const s = String(raw == null ? "" : raw).trim().toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = m[1];
  const row = Number(m[2]);
  const ci = g.cols.indexOf(col);
  if (ci < 0 || row < 1 || row > g.rows) return null;
  return { col: ci, row: row - 1, label: g.cols[ci] + String(row) };
}

export function parseCellRange(raw, spec) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    const parts = s.split(/\s*(?:[-–—to]+|\.\.)\s*/i).filter(Boolean);
    if (parts.length >= 2) return { from: parts[0], to: parts[1] };
    if (parts.length === 1) return { from: parts[0], to: parts[0] };
    return null;
  }
  if (Array.isArray(raw) && raw.length) {
    return { from: raw[0], to: raw[raw.length - 1] };
  }
  if (typeof raw === "object") {
    const frm = raw.from || raw.start || raw.tl || raw.topLeft;
    const to = raw.to || raw.end || raw.br || raw.bottomRight;
    if (frm && !to) {
      const asRange = typeof frm === "string" ? parseCellRange(frm, spec) : null;
      if (asRange) return asRange;
      return { from: frm, to: frm };
    }
    if (frm) return { from: frm, to: to || frm };
    if (raw.cells) return parseCellRange(raw.cells, spec);
    if (raw.cell) return parseCellRange(raw.cell, spec);
    if (raw.range) return parseCellRange(raw.range, spec);
  }
  return null;
}

/**
 * Inclusive cell range → a photo-space box (fractions 0–1), mapped in code.
 * The model's raw coordinates are not used.
 */
export function cellsToBox(from, to, spec) {
  const g = spec || gridSpec(1, 2);
  const a = parseCell(from, g);
  const b = parseCell(to, g) || a;
  if (!a) return null;
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const nc = g.cols.length;
  const nr = g.rows;
  const x = c0 / nc;
  const y = r0 / nr;
  const w = (c1 - c0 + 1) / nc;
  const h = (r1 - r0 + 1) / nr;
  return clampBox({ x, y, w, h });
}

export function clampBox(box) {
  if (!box) return null;
  let x = Number(box.x), y = Number(box.y), w = Number(box.w), h = Number(box.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  w = Math.max(0.02, Math.min(1 - x, w));
  h = Math.max(0.02, Math.min(1 - y, h));
  return { x, y, w, h };
}

export function padBox(box, pad = GRID_PAD) {
  const b = clampBox(box);
  if (!b) return null;
  const p = Number(pad);
  const extra = Number.isFinite(p) ? Math.max(0, p) : GRID_PAD;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const w = Math.min(1, b.w + extra);
  const h = Math.min(1, b.h + extra);
  const x = Math.max(0, Math.min(1 - w, cx - w / 2));
  const y = Math.max(0, Math.min(1 - h, cy - h / 2));
  return { x, y, w, h };
}

/** Map a box given in a crop's local 0–1 space back to the photograph. */
export function mapLocalToPhoto(local, cropFrac) {
  const b = clampBox(local);
  const f = clampBox(cropFrac);
  if (!b || !f) return null;
  return clampBox({
    x: f.x + b.x * f.w,
    y: f.y + b.y * f.h,
    w: b.w * f.w,
    h: b.h * f.h
  });
}

export const GRID_SYSTEM = `You locate objects in a photograph that has a labeled grid drawn on it. Columns are letters left to right, rows are numbers top to bottom. Each cell is marked with its label (for example B4) in the top-left corner of the cell.

For each named item, report the inclusive cell range that covers the item: the top-left cell and the bottom-right cell. Use only cells where you can actually see the item. If the item is a lot (several of the same thing), cover the whole group. If you cannot find the item, set missing to true.

Do not guess a range on empty wall, floor, ceiling, or rafters. Read the labels on the grid; do not estimate coordinates.

Reply with one JSON object only.`;

export const VERIFY_SYSTEM = `You check whether a named item is actually in a crop taken from a larger photograph, so a person can walk back and find it.

Each crop has a labeled grid drawn on it. Columns are letters left to right, rows are numbers top to bottom. Each cell is marked with its label (for example B2) in the top-left corner of the cell.

Look at the WHOLE crop, including small or distant objects in the background and at the edges.

Set found to true if the named item is visible and recognizable in this crop, even if it is small, distant, at the edge, partly cropped, or the count is slightly off:
- Empty wall, floor, ceiling, rafters, or ground — with no sign of the named item — means found is false.
- A different object, and no sign of the named item, means found is false.
- If you are not sure, found is false.

If found is true, report the inclusive cell range that covers just that item: the top-left cell and the bottom-right cell. Use the printed labels. Do not estimate raw coordinates. Set centered to true only if the item is reasonably in the middle of the crop.

Reply with one JSON object only.`;

export function gridLocateUserText(items, spec) {
  const g = spec || gridSpec(1, 2);
  const list = (items || []).slice(0, GRID_MAX_ITEMS);
  const lines = [
    `The grid has columns ${g.cols.split("").join(", ")} (left to right) and rows 1–${g.rows} (top to bottom).`,
    "For each item, give the top-left and bottom-right cells that cover it. Use the printed labels.",
    "Items:"
  ];
  list.forEach((it, i) => {
    const where = it.where && it.where !== "on the table" ? ` (a first look said: ${it.where} — this is only a hint, trust what you see)` : "";
    lines.push(`${i + 1}. ${it.name}${where}`);
  });
  lines.push('Reply: { "items": [ { "index": 1, "name": "...", "from": "B4", "to": "C6", "missing": false } ] }');
  return lines.join("\n");
}

export function verifyUserText(crops) {
  const list = crops || [];
  const lines = [
    "Each image is a crop with a labeled grid (columns A, B, C, D left to right, rows 1–4 top to bottom).",
    "For that crop, say whether the named item is really there.",
    "If it is, give the top-left and bottom-right cells that cover it. If it is not, set found to false.",
    "Look at the whole crop, including small or distant objects. Do not estimate raw coordinates."
  ];
  list.forEach((c, i) => {
    const n = c.index || (i + 1);
    const g = c.cropSpec || c.spec || CROP_GRID;
    lines.push(`Image ${n} is a crop that should contain “${c.name}”. Its grid is columns ${g.cols.split("").join(", ")} and rows 1–${g.rows}.`);
  });
  lines.push('Reply: { "checks": [ { "index": 1, "name": "...", "found": true, "centered": true, "from": "B2", "to": "C3" } ] }');
  return lines.join("\n");
}

export function parseGridLocate(json, items, spec) {
  const g = spec || gridSpec(1, 2);
  const raw = (json && (json.items || json.boxes || json.locations)) || [];
  return (items || []).map((it, i) => {
    const hit = raw.find(r => Number(r && r.index) === i + 1)
      || raw.find(r => r && String(r.name || "").trim().toLowerCase() === String(it.name || "").trim().toLowerCase())
      || {};
    const missing = !!(hit.missing || hit.notFound || hit.found === false);
    const range = parseCellRange(hit, g)
      || parseCellRange(hit.cells, g)
      || parseCellRange(hit.cell, g)
      || parseCellRange(hit.range, g)
      || (hit.from ? { from: hit.from, to: hit.to || hit.from } : null);
    const box = (!missing && range) ? cellsToBox(range.from, range.to, g) : null;
    return {
      ...it,
      cells: range ? `${String(range.from).toUpperCase()}-${String(range.to).toUpperCase()}` : "",
      cellFrom: range ? range.from : "",
      cellTo: range ? range.to : "",
      gridBox: box,
      box: box || it.box || null,
      locateMissing: missing || !box
    };
  });
}

export function parseVerify(json, crops) {
  const raw = (json && (json.checks || json.items || json.boxes)) || [];
  return (crops || []).map((c, i) => {
    const idx = c.index || (i + 1);
    const hit = raw.find(r => Number(r && r.index) === idx)
      || raw.find(r => r && String(r.name || "").trim().toLowerCase() === String(c.name || "").trim().toLowerCase())
      || {};
    const g = c.cropSpec || c.spec || CROP_GRID;
    const range = parseCellRange(hit, g)
      || parseCellRange(hit.cells, g)
      || parseCellRange(hit.cell, g)
      || parseCellRange(hit.range, g)
      || (hit.from ? { from: hit.from, to: hit.to || hit.from } : null);
    // Map cells in code. Do not trust the model's raw 0–1 coordinates —
    // those are the same guesses that put boxes on empty walls.
    const local = range ? cellsToBox(range.from, range.to, g) : null;
    const foundExplicit = hit.found;
    const found = foundExplicit === false ? false : (foundExplicit === true || !!local);
    return {
      index: idx,
      name: c.name,
      found: !!found,
      centered: !!hit.centered,
      confidence: Number(hit.confidence),
      cells: range ? `${String(range.from).toUpperCase()}-${String(range.to).toUpperCase()}` : "",
      localBox: found && local ? local : null,
      frac: c.frac,
      cropSpec: g,
      raw: hit
    };
  });
}

/**
 * Apply verify results. A failed check DROPS the box so we never show a
 * crop of empty wall. The item itself is kept (with its "where" text).
 */
export function applyVerifiedBoxes(items, checks, crops) {
  const list = items || [];
  const refs = checks || [];
  const cuts = crops || [];
  return list.map((it, i) => {
    const crop = cuts.find(c => c && (c.index === i + 1 || c.name === it.name)) || cuts[i];
    const hit = refs.find(r => r && r.index === (crop && crop.index))
      || refs.find(r => r && r.index === i + 1)
      || refs.find(r => r && String(r.name || "").toLowerCase() === String(it.name || "").toLowerCase());
    if (it.locateMissing && !hit) {
      return { ...it, box: null, boxVerified: false, boxDropped: true, boxStatus: "unknown", thumbDataUrl: "" };
    }
    if (!hit || hit.found === false) {
      return { ...it, box: null, boxVerified: false, boxDropped: true, boxStatus: "unknown", gridBox: it.gridBox || it.box, thumbDataUrl: "" };
    }
    // The padded crop was already confirmed to contain the item. A tighter
    // cell box is used only when the model says the item is centered — raw
    // or off-center cell guesses otherwise snap to a nearby wall or a
    // different object. When not centered, we keep the padded region and
    // call it a verified-loose / approximate area.
    let box = (crop && crop.frac) ? clampBox(crop.frac) : (it.gridBox || it.box);
    const tight = !!(hit.localBox && hit.centered && crop && crop.frac);
    if (tight) {
      const mapped = mapLocalToPhoto(hit.localBox, crop.frac);
      if (mapped) box = mapped;
    }
    if (!box) {
      return { ...it, box: null, boxVerified: false, boxDropped: true, boxStatus: "unknown", thumbDataUrl: "" };
    }
    return {
      ...it,
      box,
      boxVerified: true,
      boxDropped: false,
      boxStatus: tight ? "verified" : "verified-loose",
      boxRefined: tight,
      boxCentered: !!hit.centered
    };
  });
}

export async function requestGridLocate({
  image, items, key, fetchImpl, model = LOCATE_MODEL, spec, chatImpl
} = {}) {
  const list = (items || []).slice(0, GRID_MAX_ITEMS);
  const dataUrl = typeof image === "string" ? image : (image && image.dataUrl);
  if (!list.length || !dataUrl) return { items: parseGridLocate({}, list, spec), usage: null, model };
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(MSG_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  const g = spec || (image && image.spec) || gridSpec((image && image.width) || 1, (image && image.height) || 2);
  const chat = chatImpl || chatJson;
  const { json, usage, model: used } = await chat({
    system: GRID_SYSTEM,
    userText: gridLocateUserText(list, g),
    photos: [{ dataUrl, label: "This is the photograph with the labeled grid." }],
    key: k,
    fetchImpl,
    model,
    maxTokens: 1400,
    temperature: 0.1,
    maxPhotos: 2,
    imageDetail: LOCATE_DETAIL
  });
  return {
    items: parseGridLocate(json, list, g),
    usage,
    model: used || model,
    raw: json,
    spec: g
  };
}

export async function requestBoxVerify({
  crops, key, fetchImpl, model = LOCATE_MODEL, chatImpl
} = {}) {
  const shots = (crops || []).filter(c => c && c.dataUrl);
  if (!shots.length) return { checks: [], usage: null, model };
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(MSG_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  const chat = chatImpl || chatJson;
  const { json, usage, model: used } = await chat({
    system: VERIFY_SYSTEM,
    userText: verifyUserText(shots),
    photos: shots,
    key: k,
    fetchImpl,
    model,
    maxTokens: 1600,
    temperature: 0.1,
    maxPhotos: GRID_MAX_ITEMS,
    imageDetail: LOCATE_DETAIL
  });
  return {
    checks: parseVerify(json, shots),
    usage,
    model: used || model,
    raw: json
  };
}

/**
 * Draw a labeled A1… grid on a source image (browser canvas). Cell
 * geometry is the full frame divided evenly — labels sit inside cells.
 * Returns null when canvas is not available (Node tests).
 */
export function drawLabeledGrid(source, { maxEdge = GRID_MAX_EDGE, quality = GRID_QUALITY, spec } = {}) {
  if (typeof document === "undefined" || !source) return null;
  const W0 = source.width || source.naturalWidth;
  const H0 = source.height || source.naturalHeight;
  if (!W0 || !H0) return null;
  const g = spec || gridSpec(W0, H0);
  const scale = Math.min(1, maxEdge / Math.max(W0, H0));
  const W = Math.max(1, Math.round(W0 * scale));
  const H = Math.max(1, Math.round(H0 * scale));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.drawImage(source, 0, 0, W, H);
  const nc = g.cols.length;
  const nr = g.rows;
  const cw = W / nc;
  const ch = H / nr;
  ctx.strokeStyle = "rgba(255, 230, 0, 0.88)";
  ctx.lineWidth = Math.max(2, Math.round(Math.min(cw, ch) * 0.015));
  for (let i = 0; i <= nc; i++) {
    const x = Math.round(i * cw);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let j = 0; j <= nr; j++) {
    const y = Math.round(j * ch);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const fontPx = Math.max(16, Math.round(Math.min(cw, ch) * 0.22));
  ctx.font = `bold ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const label = g.cols[i] + String(j + 1);
      const x = i * cw + 6;
      const y = j * ch + 4;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
      ctx.fillRect(x - 4, y - 3, tw + 8, fontPx + 8);
      ctx.fillStyle = "rgb(255, 230, 0)";
      ctx.fillText(label, x, y);
    }
  }
  return {
    dataUrl: c.toDataURL("image/jpeg", quality),
    width: W,
    height: H,
    spec: g
  };
}

/**
 * Full locate+verify for a list of already-found items. Callers inject
 * crop and draw so this stays testable in Node without a document.
 */
export async function locateAndVerify({
  items,
  gridImage,
  makeCrops,
  key,
  fetchImpl,
  locateImpl,
  verifyImpl,
  chatImpl,
  cancelled
} = {}) {
  const list = (items || []).slice(0, GRID_MAX_ITEMS);
  if (!list.length) return { items: items || [], usage: null };
  if (cancelled && cancelled()) {
    const err = new Error("Cancelled.");
    err.code = "cancelled";
    throw err;
  }
  const locFn = locateImpl || ((opts) => requestGridLocate({ ...opts, chatImpl }));
  const located = await locFn({
    image: gridImage,
    items: list,
    key,
    fetchImpl,
    spec: gridImage && gridImage.spec
  });
  const withGrid = located.items || located;
  const usage1 = located.usage || null;
  const needing = withGrid.filter(it => it && it.gridBox && !it.locateMissing);
  let checks = [];
  let crops = [];
  let usage2 = null;
  if (needing.length && typeof makeCrops === "function") {
    if (cancelled && cancelled()) {
      const err = new Error("Cancelled.");
      err.code = "cancelled";
      throw err;
    }
    // Crops in the same order as `withGrid`, with empty slots for missing.
    crops = await makeCrops(withGrid);
    const usable = (crops || []).filter(c => c && c.dataUrl);
    if (usable.length) {
      const verFn = verifyImpl || ((opts) => requestBoxVerify({ ...opts, chatImpl }));
      const verified = await verFn({ crops: usable, key, fetchImpl });
      checks = (verified && verified.checks) || verified || [];
      usage2 = verified && verified.usage;
    }
  }
  const applied = applyVerifiedBoxes(withGrid, checks, crops);
  // Items past GRID_MAX_ITEMS are kept but their untrusted first-pass boxes are dropped.
  const rest = (items || []).slice(GRID_MAX_ITEMS).map(it => ({
    ...it, box: null, boxDropped: true, boxVerified: false, boxStatus: "unknown", thumbDataUrl: ""
  }));
  return {
    items: [...applied, ...rest],
    usage: addUsage(usage1, usage2)
  };
}

function addUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    prompt_tokens: (Number(a.prompt_tokens) || 0) + (Number(b.prompt_tokens) || 0),
    completion_tokens: (Number(a.completion_tokens) || 0) + (Number(b.completion_tokens) || 0)
  };
}
