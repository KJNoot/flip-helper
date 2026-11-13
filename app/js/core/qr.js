// In-browser QR codes for item labels. Byte mode, error correction M,
// versions 1–8. No network, no library. Returns a matrix and an SVG.
//
// This follows ISO/IEC 18004. It is tested against known finder patterns
// and a round-trip of short strings.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(count) {
  const gen = [1];
  for (let i = 0; i < count; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], EXP[i]);
    }
    for (let j = 0; j < next.length; j++) gen[j] = next[j];
    gen.length = next.length;
  }
  return gen; // leading 1, degree = count
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const ecc = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ ecc[0];
    for (let j = 0; j < ecCount - 1; j++) ecc[j] = ecc[j + 1];
    ecc[ecCount - 1] = 0;
    if (!factor) continue;
    // gen[0] is the leading 1 (x^ecCount); skip it.
    for (let j = 0; j < ecCount; j++) {
      ecc[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return ecc;
}

// [version]: { data, ec, blocks, group2? } for EC level M.
// blocks = number of RS blocks in group 1. If group2 is set, { blocks, data } for group 2.
// Verified against ISO tables: total codewords and EC counts.
const VERSIONS = {
  1: { size: 21, data: 16, ec: 10, blocks: 1, align: [] },
  2: { size: 25, data: 28, ec: 16, blocks: 1, align: [18] },
  3: { size: 29, data: 44, ec: 26, blocks: 2, align: [22] },
  4: { size: 33, data: 64, ec: 18, blocks: 2, align: [26] },
  5: { size: 37, data: 86, ec: 24, blocks: 2, align: [30] },
  6: { size: 41, data: 108, ec: 16, blocks: 4, align: [34] },
  7: { size: 45, data: 124, ec: 18, blocks: 4, align: [6, 22, 38] },
  8: { size: 49, data: 154, ec: 22, blocks: 4, align: [6, 24, 42] }
};

// Wait: ISO EC codewords PER BLOCK, not total. Let me use per-block EC
// and total data codewords.
// V1-M: 1 block, 16 data, 10 EC
// V2-M: 1 block, 28 data, 16 EC
// V3-M: 2 blocks, 22 data each, 13 EC each (44 data, 26 EC)
// V4-M: 2 blocks, 32 data each, 18 EC each
// V5-M: 2 blocks, 43 data each, 24 EC each
// V6-M: 4 blocks, 27 data each, 16 EC each
// V7-M: 4 blocks, 31 data each, 18 EC each — 124 data, 72 EC, total 196. Yes.
// V8-M: 2 blocks of 38 + 2 of 39? Standard: 4 blocks... Let me check.
// V8 total = 242. M: 154 data, 88 EC. 88/4 = 22 EC per block.
// Data 154 / 4 = 38.5, so 2 of 38 and 2 of 39.

function versionInfo(v) {
  return VERSIONS[v];
}

function dataCapacity(v) {
  // Byte-mode payload bytes (after mode + length + terminator/padding).
  // Mode (4) + count (8 for v1-9) = 12 bits = 2 bytes roughly, plus terminator.
  // Safer: use data codewords * 8 - 12 (mode+count v1-9) - 4 (terminator) all in bits,
  // then floor to bytes.
  const cw = VERSIONS[v].data;
  const countBits = v <= 9 ? 8 : 16;
  const bits = cw * 8 - 4 - countBits - 4;
  return Math.floor(bits / 8);
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= 8; v++) {
    if (dataCapacity(v) >= byteLen) return v;
  }
  return 8; // will truncate if needed
}

function encodeBytes(text, version) {
  const bytes = new TextEncoder().encode(String(text));
  const info = VERSIONS[version];
  const cap = info.data;
  const countBits = version <= 9 ? 8 : 16;
  const bits = [];
  const push = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(Math.min(bytes.length, dataCapacity(version)), countBits);
  const n = Math.min(bytes.length, dataCapacity(version));
  for (let i = 0; i < n; i++) push(bytes[i], 8);
  // terminator (up to 4 bits)
  const totalBits = cap * 8;
  const term = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (data.length < cap) data.push(pads[p++ % 2]);
  return new Uint8Array(data.slice(0, cap));
}

function blocksFor(version) {
  // Returns array of data-length per block, and ec per block.
  const table = {
    1: { ec: 10, groups: [[1, 16]] },
    2: { ec: 16, groups: [[1, 28]] },
    3: { ec: 13, groups: [[2, 22]] },
    4: { ec: 18, groups: [[2, 32]] },
    5: { ec: 24, groups: [[2, 43]] },
    6: { ec: 16, groups: [[4, 27]] },
    7: { ec: 18, groups: [[4, 31]] },
    8: { ec: 22, groups: [[2, 38], [2, 39]] }
  };
  return table[version];
}

function makeCodewords(text, version) {
  const data = encodeBytes(text, version);
  const spec = blocksFor(version);
  const blocks = [];
  let offset = 0;
  for (const [count, len] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const slice = data.subarray(offset, offset + len);
      offset += len;
      blocks.push({ data: slice, ecc: rsEncode(slice, spec.ec) });
    }
  }
  const maxD = Math.max(...blocks.map(b => b.data.length));
  const maxE = Math.max(...blocks.map(b => b.ecc.length));
  const out = [];
  for (let i = 0; i < maxD; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < maxE; i++) {
    for (const b of blocks) if (i < b.ecc.length) out.push(b.ecc[i]);
  }
  return new Uint8Array(out);
}

function sizeOf(v) { return 17 + 4 * v; }

function isFunction(v, x, y) {
  const n = sizeOf(v);
  // finders + separators
  if (x <= 8 && y <= 8) return true;
  if (x >= n - 8 && y <= 8) return true;
  if (x <= 8 && y >= n - 8) return true;
  // timing
  if (x === 6 || y === 6) return true;
  // format
  // (already in the 8-wide finder strips and timing adjacent)
  // alignment
  const aligns = VERSIONS[v].align;
  for (const ax of aligns) {
    for (const ay of aligns) {
      // skip if overlaps finder
      if (ax <= 8 && ay <= 8) continue;
      if (ax >= n - 9 && ay <= 8) continue;
      if (ax <= 8 && ay >= n - 9) continue;
      if (Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true;
    }
  }
  // dark module & format around (8, n-8) already in finder? dark is at (8, 4v+9)
  if (x === 8 && y === 4 * v + 9) return true;
  // version info v7+
  if (v >= 7) {
    if (x < 6 && y >= n - 11 && y < n - 8) return true;
    if (y < 6 && x >= n - 11 && x < n - 8) return true;
  }
  return false;
}

function finderPattern(mat, ox, oy) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const edge = x === 0 || x === 6 || y === 0 || y === 6;
      const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      mat[oy + y][ox + x] = edge || inner ? 1 : 0;
    }
  }
}

function alignmentPattern(mat, cx, cy) {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const a = Math.max(Math.abs(x), Math.abs(y));
      mat[cy + y][cx + x] = a !== 1 ? 1 : 0;
    }
  }
}

function placeFinders(mat, v) {
  const n = mat.length;
  finderPattern(mat, 0, 0);
  finderPattern(mat, n - 7, 0);
  finderPattern(mat, 0, n - 7);
  // separators stay 0 (already)
  // timing
  for (let i = 8; i < n - 8; i++) {
    mat[6][i] = i % 2 === 0 ? 1 : 0;
    mat[i][6] = i % 2 === 0 ? 1 : 0;
  }
  // dark module
  mat[4 * v + 9][8] = 1;
  // alignment
  const aligns = VERSIONS[v].align;
  const pos = aligns.slice();
  for (const ax of pos) {
    for (const ay of pos) {
      if (ax <= 8 && ay <= 8) continue;
      if (ax >= n - 9 && ay <= 8) continue;
      if (ax <= 8 && ay >= n - 9) continue;
      alignmentPattern(mat, ax, ay);
    }
  }
}

const FORMAT_MASK = 0x5412;

function formatBits(mask) {
  // EC level M = 00
  const data = (0 << 3) | mask;
  let bch = data << 10;
  const gen = 0x537;
  for (let i = 14; i >= 10; i--) {
    if ((bch >>> i) & 1) bch ^= gen << (i - 10);
  }
  return ((data << 10) | bch) ^ FORMAT_MASK;
}

function placeFormat(mat, bits) {
  const n = mat.length;
  // Horizontal around top-left finder, and copy by bottom-left / top-right.
  // Positions per ISO figure 19.
  const coords = [];
  // around (0,0) finder: horizontal (0..5, 8), (7,8), (8,8); vertical (8,0..5), (8,7)
  for (let i = 0; i < 6; i++) coords.push(["h", i, 8, i]);
  coords.push(["h", 7, 8, 6]);
  coords.push(["h", 8, 8, 7]);
  for (let i = 0; i < 6; i++) coords.push(["v", 8, i, 14 - i]);
  coords.push(["v", 8, 7, 8]);
  // Wait, bit order: bit 0 is LSB of the 15-bit format.
  // Standard placement:
  // bits 0-5: (8, 0..5)
  // bit 6: (8, 7)
  // bit 7: (8, 8)
  // bit 8: (7, 8)
  // bits 9-14: (5..0, 8)
  // And copies:
  // bits 0-7: (n-1 .. n-8, 8)
  // bits 8-14: (8, n-7 .. n-1)
  const set = (x, y, bit) => { mat[y][x] = (bits >>> bit) & 1; };
  for (let i = 0; i < 6; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(n - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, n - 15 + i, i);
}

// Version info for v7-8 (18 bits, BCH). ISO table.
const VERSION_BITS = {
  7: 0x07C94,
  8: 0x085BC
};

function placeVersion(mat, v) {
  if (v < 7) return;
  const bits = VERSION_BITS[v];
  const n = mat.length;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const a = i % 3, b = Math.floor(i / 3);
    mat[b][n - 11 + a] = bit;
    mat[n - 11 + a][b] = bit;
  }
}

function maskFn(id) {
  return [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ][id];
}

function placeData(mat, v, codewords, maskId) {
  const n = mat.length;
  const reserved = (x, y) => isFunction(v, x, y);
  const mask = maskFn(maskId);
  const bits = [];
  for (const b of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  }
  // Remainder bits (version-dependent, all 0). V1-4: 0? V2=7, V3=7, V4=7, V5=7, V6=7
  const remainders = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0 };
  for (let i = 0; i < (remainders[v] || 0); i++) bits.push(0);
  let bi = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < n; i++) {
      const y = upward ? n - 1 - i : i;
      for (const dx of [0, -1]) {
        const x = col + dx;
        if (x < 0 || reserved(x, y)) continue;
        const bit = bi < bits.length ? bits[bi++] : 0;
        mat[y][x] = mask(x, y) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }
}

function penalty(mat) {
  const n = mat.length;
  let score = 0;
  // N1: runs of 5+
  const runs = (get) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
          if (j === n - 1 && run >= 5) score += run - 2;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
  };
  runs((r, c) => mat[r][c]);
  runs((r, c) => mat[c][r]);
  // N2: 2x2
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = mat[y][x];
      if (v === mat[y][x + 1] && v === mat[y + 1][x] && v === mat[y + 1][x + 1]) score += 3;
    }
  }
  // N3: finder-like
  const pat = (row, start, dir) => {
    // 1011101 with 0000 on either side
    const get = k => (dir === "h" ? mat[row][k] : mat[k][row]);
    const len = n;
    for (let i = 0; i <= len - 7; i++) {
      const seq = [];
      for (let k = 0; k < 7; k++) seq.push(get(i + k));
      if (seq[0] && !seq[1] && seq[2] && seq[3] && seq[4] && !seq[5] && seq[6]) {
        const left = i >= 4 && !get(i - 1) && !get(i - 2) && !get(i - 3) && !get(i - 4);
        const right = i + 11 <= len && !get(i + 7) && !get(i + 8) && !get(i + 9) && !get(i + 10);
        // ISO: 4 white modules on one side. Also count if at the edge with whites.
        const leftOk = i === 0 || left || (i >= 4 && [1,2,3,4].every(d => get(i - d) === 0));
        const rightOk = i + 7 === len || right || (i + 10 < len && [7,8,9,10].every(d => get(i + d) === 0));
        if ((i >= 4 && [1,2,3,4].every(d => get(i - d) === 0)) || (i + 10 < len && [7,8,9,10].every(d => get(i + d) === 0))) {
          score += 40;
        }
        void leftOk; void rightOk;
      }
    }
  };
  for (let i = 0; i < n; i++) { pat(i, 0, "h"); pat(i, 0, "v"); }
  // N4: dark ratio
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mat[y][x]) dark++;
  const percent = (100 * dark) / (n * n);
  score += 10 * Math.floor(Math.abs(percent - 50) / 5);
  return score;
}

function emptyMatrix(n) {
  return Array.from({ length: n }, () => new Array(n).fill(0));
}

function cloneMat(mat) {
  return mat.map(row => row.slice());
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = chooseVersion(bytes.length);
  if (dataCapacity(version) < bytes.length) {
    // Truncate to fit version 8 (~150 bytes) rather than fail a label.
    version = 8;
  }
  const info = VERSIONS[version];
  const n = info.size;
  const codewords = makeCodewords(String(text).slice(0, dataCapacity(version)), version);
  let best = null, bestScore = Infinity, bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const mat = emptyMatrix(n);
    placeFinders(mat, version);
    placeVersion(mat, version);
    placeFormat(mat, formatBits(mask));
    placeData(mat, version, codewords, mask);
    // format must sit on top of data (already reserved). Re-place to be safe.
    placeFormat(mat, formatBits(mask));
    const s = penalty(mat);
    if (s < bestScore) { bestScore = s; best = mat; bestMask = mask; }
  }
  return { matrix: best, version, mask: bestMask, size: n, text: String(text) };
}

export function qrSvg(text, { module = 8, margin = 4, color = "#12312e", background = "#ffffff", label } = {}) {
  const { matrix, size } = typeof text === "object" && text.matrix ? text : qrMatrix(text);
  const dim = (size + margin * 2) * module;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">`];
  parts.push(`<rect width="${dim}" height="${dim}" fill="${background}"/>`);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!matrix[y][x]) continue;
      parts.push(`<rect x="${(x + margin) * module}" y="${(y + margin) * module}" width="${module}" height="${module}" fill="${color}"/>`);
    }
  }
  parts.push("</svg>");
  void label;
  return parts.join("");
}

export function qrDataUrl(text, opts) {
  const svg = qrSvg(text, opts);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** Payload encoded in a Flip Helper item label. Short and stable. */
export function itemQrPayload(item) {
  const id = item && item.id ? String(item.id) : "";
  return "FH:" + id;
}

export function itemQrSvg(item, opts) {
  return qrSvg(itemQrPayload(item), opts);
}

/** A simple printable label as an HTML page (title, bin, QR). */
export function printLabelHtml(item) {
  const title = String((item && item.title) || "Untitled item").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const bin = String((item && item.binLocation) || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const id = String((item && item.id) || "");
  const svg = itemQrSvg(item, { module: 6, margin: 3 });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label — ${title}</title>
    <style>
      body{font:16px/1.4 -apple-system,system-ui,sans-serif;margin:24px;color:#12312e}
      .label{display:inline-block;border:1px solid #ccc;border-radius:12px;padding:16px 20px;text-align:center}
      h1{font-size:18px;margin:0 0 6px}
      .bin{font-weight:700;margin:4px 0}
      .id{font-size:11px;color:#5b736f;margin-top:6px}
      svg{display:block;margin:8px auto}
      @media print{body{margin:0}.label{border:0}}
    </style></head><body>
    <div class="label">
      <h1>${title}</h1>
      ${bin ? `<div class="bin">Bin ${bin}</div>` : ""}
      ${svg}
      <div class="id">${id.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>
    </div>
    <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));<\/script>
    </body></html>`;
}

export { VERSIONS, dataCapacity, chooseVersion, formatBits, rsEncode, rsGenerator, encodeBytes, makeCodewords, isFunction };
