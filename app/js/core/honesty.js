// AI honesty: split a draft into what the photo shows, what she confirms,
// and what the AI is guessing. Never invent a brand or a condition.
export const HONESTY_NOTE = "The AI can only talk about what is visible in the photo. Brand, material, size, and flaws need your OK before they are treated as fact. If something isn't clear, it is left blank rather than guessed.";

export const CONFIRM_FIELDS = ["brand", "material", "size", "flaws"];

export const CONFIRM_LABELS = {
  brand: "Brand",
  material: "Material",
  size: "Size",
  flaws: "Flaws or damage"
};

export function emptyConfirm() {
  const out = {};
  for (const k of CONFIRM_FIELDS) out[k] = { confirmed: false, value: "" };
  return out;
}

export function normalizeConfirm(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = emptyConfirm();
  for (const k of CONFIRM_FIELDS) {
    const v = src[k];
    if (v && typeof v === "object") {
      out[k] = { confirmed: !!v.confirmed, value: String(v.value || "").trim() };
    } else if (typeof v === "string") {
      out[k] = { confirmed: false, value: v.trim() };
    }
  }
  return out;
}

export function normalizePhotoShows(raw) {
  if (!raw || typeof raw !== "object") return null;
  const what = String(raw.whatYouSee || raw.what || raw.visible || raw.summary || "").trim();
  const text = String(raw.visibleText || raw.text || raw.labels || "").trim();
  const flaws = String(raw.visibleFlaws || raw.flaws || raw.damage || "").trim();
  const details = String(raw.visibleDetails || raw.details || raw.colors || "").trim();
  if (!what && !text && !flaws && !details) return null;
  return { what, visibleText: text, visibleFlaws: flaws, visibleDetails: details };
}

export function normalizeAiGuess(raw) {
  if (!raw || typeof raw !== "object") return null;
  const brand = blankUnknown(raw.brand);
  const condition = blankUnknown(raw.condition);
  const material = blankUnknown(raw.material);
  const size = blankUnknown(raw.size);
  const category = String(raw.category || "").trim();
  const note = String(raw.note || raw.reason || "").trim();
  if (!brand && !condition && !material && !size && !category && !note
      && raw.priceLow == null && raw.priceHigh == null) return null;
  return {
    brand,
    condition,
    material,
    size,
    category,
    note,
    priceLow: raw.priceLow ?? null,
    priceHigh: raw.priceHigh ?? null,
    confidence: String(raw.confidence || "").trim()
  };
}

function blankUnknown(v) {
  const s = String(v || "").trim();
  if (!s || /^unknown$/i.test(s) || /^n\/?a$/i.test(s) || /^not sure$/i.test(s) || /^unsure$/i.test(s) || /^cannot tell$/i.test(s) || /^can't tell$/i.test(s)) return "";
  return s;
}

/** Refuse invented brand/condition: empty if the model said unknown or left a guess flag. */
export function honestValue(value, { invented = false } = {}) {
  if (invented) return "";
  return blankUnknown(value);
}

export function setConfirm(confirm, field, { confirmed, value } = {}) {
  if (!CONFIRM_FIELDS.includes(field)) return normalizeConfirm(confirm);
  const next = normalizeConfirm(confirm);
  if (value !== undefined) next[field].value = String(value || "").trim();
  if (confirmed !== undefined) next[field].confirmed = !!confirmed;
  return next;
}

/**
 * Apply confirmations onto the item. Confirmed values become the item's
 * brand / material / size, and flaws go into notes if not already there.
 * Unconfirmed guesses stay only in aiGuess / youConfirm.
 */
export function applyConfirms(item, confirm, at = Date.now()) {
  const c = normalizeConfirm(confirm);
  const next = { ...item, youConfirm: c, updatedAt: at };
  next.brand = c.brand.confirmed ? c.brand.value : (item.brand && c.brand.confirmed === false && !c.brand.value ? item.brand : (c.brand.confirmed ? c.brand.value : ""));
  // If she confirmed, use that value. If she never had a confirm record and
  // typed a brand herself (manual listing), keep it.
  if (c.brand.confirmed) next.brand = c.brand.value;
  else if (!c.brand.value && item.brand && !item.aiGuess) next.brand = item.brand;
  else if (!c.brand.confirmed) {
    // Keep a self-typed brand if it doesn't match the AI guess (she typed it).
    const guessed = item.aiGuess && item.aiGuess.brand;
    if (item.brand && item.brand !== guessed && !c.brand.value) next.brand = item.brand;
    else next.brand = "";
  }
  if (c.material.confirmed) next.material = c.material.value;
  else if (!item.aiGuess && item.material) next.material = item.material;
  else next.material = item.material && c.material.confirmed ? c.material.value : (c.material.confirmed ? c.material.value : (item.material && !item.aiGuess ? item.material : ""));
  if (c.size.confirmed) next.size = c.size.value;
  else next.size = item.size && !item.aiGuess ? item.size : (c.size.confirmed ? c.size.value : "");
  if (c.flaws.confirmed && c.flaws.value) {
    const note = String(item.notes || "");
    if (!note.toLowerCase().includes(c.flaws.value.toLowerCase())) {
      next.notes = note ? (note + "\n" + c.flaws.value) : c.flaws.value;
    }
  }
  return next;
}

/**
 * Simpler apply used by the form: checkboxes + values the user can edit.
 * A checked box means she stands behind the value. Unchecked guesses do
 * not become the item's brand or condition.
 */
export function confirmedFields(confirm) {
  const c = normalizeConfirm(confirm);
  const out = { brand: "", material: "", size: "", flaws: "" };
  for (const k of CONFIRM_FIELDS) {
    if (c[k].confirmed) out[k] = c[k].value;
  }
  return out;
}

export function guessFor(item, field) {
  const c = item && item.youConfirm && item.youConfirm[field];
  if (c && c.value) return c.value;
  const g = item && item.aiGuess;
  if (g && g[field]) return g[field];
  if (field === "flaws" && item && item.photoShows) return item.photoShows.visibleFlaws || "";
  if (item && item[field]) return item[field];
  return "";
}

/**
 * Seed youConfirm values from an AI draft without marking them confirmed.
 * Brand and condition stay empty on the item until she checks the box,
 * except a condition she typed herself.
 */
export function seedConfirmsFromDraft(item, draft, at = Date.now()) {
  const c = normalizeConfirm(item.youConfirm);
  const g = draft && (draft.aiGuess || draft);
  const photo = draft && draft.photoShows;
  if (g) {
    if (g.brand && !c.brand.value) c.brand.value = blankUnknown(g.brand);
    if (g.material && !c.material.value) c.material.value = blankUnknown(g.material);
    if (g.size && !c.size.value) c.size.value = blankUnknown(g.size);
  }
  if (photo && photo.visibleFlaws && !c.flaws.value) c.flaws.value = photo.visibleFlaws;
  return { ...item, youConfirm: c, updatedAt: at };
}
