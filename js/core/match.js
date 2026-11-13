// Fuzzy title match: "You may already own this."
export function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "by"]);

export function tokens(s) {
  return normalizeTitle(s).split(" ").filter(w => w && w.length > 1 && !STOP.has(w));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (a.length < b.length) return levenshtein(b, a);
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Similarity 0–1. Combines token overlap (Jaccard) with whole-string
 * edit distance, and a boost if one title contains the other.
 */
export function titleSimilarity(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a), tb = tokens(b);
  const setB = new Set(tb);
  const inter = ta.filter(t => setB.has(t)).length;
  const union = new Set([...ta, ...tb]).size || 1;
  const jaccard = inter / union;
  const maxLen = Math.max(na.length, nb.length) || 1;
  const edit = 1 - levenshtein(na, nb) / maxLen;
  const contains = na.includes(nb) || nb.includes(na) ? 0.15 : 0;
  let score = Math.max(jaccard, edit * 0.85) + contains;
  if (jaccard >= 0.5 && edit >= 0.6) score = Math.max(score, 0.72);
  if (score > 1) score = 1;
  if (score < 0) score = 0;
  return Math.round(score * 1000) / 1000;
}

export const DEFAULT_MATCH_THRESHOLD = 0.55;

/**
 * Inventory items whose titles look like `title`. Skips empty titles and
 * the item with `excludeId`. Sold and shipped items are included — she
 * may still have a duplicate in a bin, or a past listing of the same thing.
 */
export function alreadyOwnedMatches(items, title, { excludeId, threshold = DEFAULT_MATCH_THRESHOLD, limit = 5 } = {}) {
  const q = normalizeTitle(title);
  if (!q) return [];
  const out = [];
  for (const item of items || []) {
    if (!item || item.id === excludeId) continue;
    const t = item.title || "";
    if (!normalizeTitle(t)) continue;
    const score = titleSimilarity(q, t);
    if (score >= threshold) out.push({ item, score, title: t, id: item.id, stage: item.stage });
  }
  out.sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)));
  return out.slice(0, limit);
}

export function alreadyOwnedWarning(matches) {
  if (!matches || !matches.length) return "";
  if (matches.length === 1) {
    const m = matches[0];
    return `You may already own this: “${m.title}” is already in your items.`;
  }
  return `You may already own this. ${matches.length} similar items are already in your list, including “${matches[0].title}”.`;
}
