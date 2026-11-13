// Photo downscale, OpenAI vision draft, and parsing of the model's JSON.
// The key is read from localStorage at call time and never logged.
import { SITE_IDS, isKnownSite } from "./sites.js";
import { money, emptyItem, normalizeAdvice } from "./inventory.js";
import { seedConfirmsFromDraft, normalizePhotoShows, normalizeAiGuess } from "./honesty.js";
import { getKey } from "./key.js";

export const AI_MODEL = "gpt-4o-mini";
export const MAX_PHOTO_EDGE = 1024;
export const JPEG_QUALITY = 0.72;
export const MAX_PHOTOS = 8;
export const MAX_PHOTOS_FOR_AI = 3;

const SYSTEM = `You help a person write a listing for something they want to sell online.
Look at the photo(s) and any notes. Reply with a single JSON object only, no markdown, with these keys:
- title: a clear, honest listing title (under 80 characters)
- description: a friendly listing description (a short paragraph, honest about what you can see; do not invent flaws or features you cannot see)
- category: a simple category (for example "Women's shoes" or "Kitchen")
- condition: one of "New with tags", "New without tags", "Like new", "Good", "Fair", "Poor", or a short honest phrase
- brand: the brand if you can reasonably tell, otherwise ""
- priceLow: a number, suggested low asking price in US dollars
- priceHigh: a number, suggested high asking price in US dollars
- priceReason: one or two short sentences explaining the range. Say clearly this is a rough estimate from the photo, not from checking sold listings.
- siteTweaks: an object with optional keys from this list: ebay, poshmark, mercari, facebook, etsy, depop, vinted, grailed, shopify, offerup, craigslist, whatnot, kidizen, thredup. Each value is { "title", "description", "notes" }. Use these for small site-specific tweaks. Leave a site out if the main title and description are fine.
- bestPrice: { "sites": ["ebay", "..."], "reason": "one or two short sentences" }. Sites from the list above where she might get a better price. Prefer her enabled sites if they were given. Pick 1 to 3 sites.
- fastestSale: { "sites": ["facebook", "..."], "reason": "one or two short sentences" }. Sites from the list above where it might sell sooner (local pickup, lower fees, a matching audience). Pick 1 to 3 sites.
For both bestPrice and fastestSale: say clearly this is a rough estimate from the photo and general knowledge, not from checking live listings or actual sale times. Prefer a site that fits the item (Grailed for menswear, Kidizen for kids' clothes, Etsy for handmade or vintage, Whatnot for collectibles, Facebook or OfferUp or Craigslist for local bulky items, thredUP for a bag of everyday clothes). Do not invent sales data.
Also include these honesty keys:
- photoShows: { "whatYouSee": "only what is clearly visible", "visibleText": "any readable text, or empty", "visibleFlaws": "damage you can actually see, or empty if none is visible", "visibleDetails": "colors, shape, parts you can see" }
- material: only if clearly visible, otherwise ""
- size: only if clearly readable on a tag or label, otherwise ""
- measurements: only if you can read them, otherwise ""
If you cannot tell what the item is, say so in the title and description, give a wide price range or omit prices, and do not guess a brand.
Do not invent a brand. If the brand is not clearly visible or readable, leave brand empty.
Do not invent a condition. If you cannot reasonably tell, leave condition empty.
Never invent certificates, authenticity, measurements, flaws, or a price based on fake comps. Prices and site advice are estimates only.`;

export function downscaleDataUrl(dataUrl, max = MAX_PHOTO_EDGE, quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("That photo couldn't be read."));
    img.src = dataUrl;
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("That photo couldn't be read."));
    r.readAsDataURL(file);
  });
}

export async function photoFromFile(file) {
  const raw = await fileToDataUrl(file);
  const dataUrl = await downscaleDataUrl(raw);
  return { dataUrl, addedAt: Date.now() };
}

/** Pull a JSON object out of model output, even if it is wrapped in fences or prose. */
export function extractJson(text) {
  if (text == null) throw new Error("The draft came back empty.");
  let t = String(text).trim();
  if (!t) throw new Error("The draft came back empty.");
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The draft wasn't in a form we could use. Try again.");
  try { return JSON.parse(t.slice(start, end + 1)); }
  catch (e) { throw new Error("The draft wasn't in a form we could use. Try again."); }
}

export function normalizeDraft(raw = {}) {
  const siteTweaks = {};
  const tw = raw.siteTweaks || raw.site_tweaks || {};
  if (tw && typeof tw === "object") {
    for (const id of SITE_IDS) {
      const aliases = id === "facebook" ? ["facebook", "facebook_marketplace", "facebookMarketplace"] : [id];
      const v = aliases.map(k => tw[k]).find(x => x && typeof x === "object");
      if (!v) continue;
      const t = {
        title: String(v.title || "").trim(),
        description: String(v.description || "").trim(),
        notes: String(v.notes || "").trim()
      };
      if (t.title || t.description || t.notes) siteTweaks[id] = t;
    }
  }
  let condition = String(raw.condition || "").trim();
  const brand = String(raw.brand || "").trim();
  if (/^unknown$/i.test(brand)) { /* treat as empty below */ }
  const photoShows = raw.photoShows || raw.photo_shows || null;
  const material = /^unknown$/i.test(String(raw.material || "").trim()) ? "" : String(raw.material || "").trim();
  const size = /^unknown$/i.test(String(raw.size || "").trim()) ? "" : String(raw.size || "").trim();
  return {
    title: String(raw.title || "").trim(),
    description: String(raw.description || "").trim(),
    category: String(raw.category || "").trim(),
    condition: /^unknown$/i.test(condition) ? "" : condition,
    brand: /^unknown$/i.test(brand) ? "" : brand,
    material,
    size,
    measurements: String(raw.measurements || raw.measure || "").trim(),
    photoShows: photoShows && typeof photoShows === "object" ? {
      what: String(photoShows.whatYouSee || photoShows.what || "").trim(),
      visibleText: String(photoShows.visibleText || photoShows.text || "").trim(),
      visibleFlaws: String(photoShows.visibleFlaws || photoShows.flaws || "").trim(),
      visibleDetails: String(photoShows.visibleDetails || photoShows.details || "").trim()
    } : null,
    priceLow: money(raw.priceLow ?? raw.price_low),
    priceHigh: money(raw.priceHigh ?? raw.price_high),
    priceReason: String(raw.priceReason || raw.price_reason || "").trim(),
    siteTweaks,
    siteAdvice: normalizeAdvice({
      bestPrice: raw.bestPrice || raw.best_price,
      fastestSale: raw.fastestSale || raw.fastest_sale
    })
  };
}

export function applyDraft(item, draft, at = Date.now()) {
  const d = normalizeDraft(draft);
  const asking = item.askingPrice ?? d.priceHigh ?? d.priceLow;
  const aiGuess = normalizeAiGuess({
    brand: d.brand,
    condition: d.condition,
    material: d.material,
    size: d.size,
    category: d.category,
    priceLow: d.priceLow,
    priceHigh: d.priceHigh,
    note: d.priceReason
  });
  // Title, description, category, and prices fill in for her to review.
  // Brand, condition, material, and size are treated as AI guesses until she confirms them.
  let next = emptyItem({
    ...item,
    title: d.title || item.title,
    description: d.description || item.description,
    category: d.category || item.category,
    priceLow: d.priceLow,
    priceHigh: d.priceHigh,
    priceReason: d.priceReason,
    siteTweaks: d.siteTweaks,
    askingPrice: asking,
    siteAdvice: d.siteAdvice,
    photoShows: normalizePhotoShows(d.photoShows) || item.photoShows,
    aiGuess,
    measurements: d.measurements || item.measurements,
    updatedAt: at
  }, at);
  next = seedConfirmsFromDraft(next, { aiGuess, photoShows: next.photoShows }, at);
  return next;
}

export function friendlyApiError(status, bodyText) {
  if (status === 401 || status === 403) return "That key was not accepted. Check it in Settings and try again.";
  if (status === 429) return "The AI service is busy or the monthly limit was reached. Try again in a little while.";
  if (status >= 500) return "The AI service had a problem. Try again in a little while.";
  if (bodyText && /insufficient[_ ]quota/i.test(bodyText)) return "The AI account is out of credit. Check that in Settings later.";
  return "The draft couldn't be made. Check your connection and try again.";
}

/**
 * Call OpenAI vision. `key` is optional; by default the device-held key is used.
 * Never logs the key. `fetchImpl` is injectable for tests.
 */
export async function requestDraft({ photos, notes, costPaid, key, enabledSites, fetchImpl, model = AI_MODEL } = {}) {
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error("Paste the AI key in Settings first.");
    err.code = "no-key";
    throw err;
  }
  const shots = (photos || []).map(p => p.dataUrl || p).filter(Boolean).slice(0, MAX_PHOTOS_FOR_AI);
  if (!shots.length) {
    const err = new Error("Take a photo first.");
    err.code = "no-photo";
    throw err;
  }
  const enabled = Array.isArray(enabledSites) ? enabledSites.filter(Boolean).join(", ") : "";
  const userText = [
    "Please draft a listing from these photos.",
    notes ? `Seller notes: ${notes}` : "",
    costPaid != null && costPaid !== "" ? `What they paid for it: ${costPaid} US dollars.` : "",
    enabled ? `She currently sells on: ${enabled}. Prefer these for bestPrice and fastestSale, but you may mention another site if it clearly fits.` : ""
  ].filter(Boolean).join("\n");
  const content = [
    { type: "text", text: userText },
    ...shots.map(url => ({ type: "image_url", image_url: { url, detail: "low" } }))
  ];
  const fetchFn = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + k
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 1100,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content }
        ]
      })
    });
  } catch (e) {
    const err = new Error("Couldn't reach the AI service. Check your connection and try again.");
    err.code = "network";
    throw err;
  }
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(friendlyApiError(res.status, raw));
    err.code = "http-" + res.status;
    throw err;
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { throw new Error("The draft wasn't in a form we could use. Try again."); }
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content : "";
  const draft = normalizeDraft(extractJson(text));
  return { draft, usage: payload.usage || null, model: payload.model || model };
}


const SCAN_SYSTEM = `You help someone at a thrift store or garage sale decide whether to buy an item to resell.
Look at the photo(s) and any notes. Reply with a single JSON object only, no markdown, with these keys:
- title: a clear name for the item (under 80 characters)
- category, condition, brand ("" if you cannot reasonably tell)
- priceLow, priceHigh: expected resale asking prices in US dollars if listed in good, honest condition
- priceReason: one or two short sentences. Say clearly this is a rough estimate from the photo, not from checking sold listings.
- daysToSell: "fast" (about a week or less), "medium" (a few weeks), or "slow" (a month or more)
- speedReason: one short sentence
- box: a short package type (for example "poly mailer" or "small sturdy box")
- weightOz: estimated packed weight in ounces, a number
- notes: anything she should look for (flaws, authenticity) without inventing defects you cannot see
If you cannot tell what the item is, say so, give a wide price range or omit prices, and do not guess a brand.
Never invent certificates, exact sold comps, or measurements you cannot see.`;

const COMPS_SYSTEM = `You estimate what similar items typically sell for on US resale sites, from general knowledge only.
Reply with a single JSON object only, no markdown, with these keys:
- low: a number, conservative typical sold price in US dollars
- high: a number, optimistic typical sold price in US dollars
- typical: a number, a usual mid sold price in US dollars
- reason: one or two short sentences. You MUST say clearly this is an estimate from general knowledge, not from live sold listings.
- confidence: "low" or "medium" (never "high", because you are not checking live data)
Do not invent specific sold listings, dates, or exact comparable sales. If the description is vague, say so and give a wide range.`;

const SHIP_SYSTEM = `You suggest a packing box and a packed weight for shipping a used item in the US.
Reply with a single JSON object only, no markdown, with these keys:
- box: a short package type (for example "poly mailer" or "small sturdy box")
- lengthIn, widthIn, heightIn: numbers, inches, a reasonable box or mailer
- weightOz: a number, estimated packed weight in ounces including packing
- reason: one short sentence. Say this is a rough estimate; she should weigh the packed item.
Do not invent exact weights. Prefer a little extra room for padding on breakables.`;

/**
 * Shared OpenAI JSON chat. The key is never logged. fetchImpl is injectable.
 */
export async function chatJson({ system, userText, photos = [], key, fetchImpl, model = AI_MODEL, maxTokens = 700, temperature = 0.4 } = {}) {
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error("Paste the AI key in Settings first.");
    err.code = "no-key";
    throw err;
  }
  const shots = (photos || []).map(p => p.dataUrl || p).filter(Boolean).slice(0, MAX_PHOTOS_FOR_AI);
  const content = [{ type: "text", text: userText || "" }];
  for (const url of shots) content.push({ type: "image_url", image_url: { url, detail: "low" } });
  const fetchFn = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + k
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content }
        ]
      })
    });
  } catch (e) {
    const err = new Error("Couldn't reach the AI service. Check your connection and try again.");
    err.code = "network";
    throw err;
  }
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(friendlyApiError(res.status, raw));
    err.code = "http-" + res.status;
    throw err;
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { throw new Error("The answer wasn't in a form we could use. Try again."); }
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content : "";
  const json = extractJson(text);
  return { json, usage: payload.usage || null, model: payload.model || model };
}

export async function requestScan({ photos, notes, asking, key, enabledSites, fetchImpl, model = AI_MODEL } = {}) {
  const shots = (photos || []).map(p => p.dataUrl || p).filter(Boolean);
  if (!shots.length) {
    const err = new Error("Take a photo first.");
    err.code = "no-photo";
    throw err;
  }
  const enabled = Array.isArray(enabledSites) ? enabledSites.filter(Boolean).join(", ") : "";
  const userText = [
    "Please identify this item and estimate what it might resell for.",
    notes ? `Notes: ${notes}` : "",
    asking != null && asking !== "" ? `The store is asking ${asking} US dollars.` : "",
    enabled ? `She currently sells on: ${enabled}.` : ""
  ].filter(Boolean).join("\n");
  return chatJson({ system: SCAN_SYSTEM, userText, photos, key, fetchImpl, model, maxTokens: 700, temperature: 0.3 });
}

export async function requestCompsEstimate({ title, category, brand, condition, notes, photos, key, fetchImpl, model = AI_MODEL } = {}) {
  const userText = [
    "Estimate typical sold prices for this item.",
    title ? `Title: ${title}` : "",
    category ? `Category: ${category}` : "",
    brand ? `Brand: ${brand}` : "",
    condition ? `Condition: ${condition}` : "",
    notes ? `Notes: ${notes}` : "",
    "Say clearly this is an estimate, not live sold data."
  ].filter(Boolean).join("\n");
  if (!title && !(photos || []).length) {
    const err = new Error("Add a title or a photo first.");
    err.code = "no-input";
    throw err;
  }
  return chatJson({ system: COMPS_SYSTEM, userText, photos: photos || [], key, fetchImpl, model, maxTokens: 400, temperature: 0.3 });
}

export async function requestShipSuggest({ photos, title, category, condition, key, fetchImpl, model = AI_MODEL } = {}) {
  const userText = [
    "Suggest a box and a packed weight for shipping this item in the US.",
    title ? `Title: ${title}` : "",
    category ? `Category: ${category}` : "",
    condition ? `Condition: ${condition}` : ""
  ].filter(Boolean).join("\n");
  return chatJson({ system: SHIP_SYSTEM, userText, photos: photos || [], key, fetchImpl, model, maxTokens: 300, temperature: 0.2 });
}

/** A tiny, cheap request that only checks whether the key is accepted. */
export async function checkKey(key, fetchImpl) {
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error("Paste the key first.");
    err.code = "no-key";
    throw err;
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchFn("https://api.openai.com/v1/models/gpt-4o-mini", {
      headers: { Authorization: "Bearer " + k }
    });
  } catch (e) {
    const err = new Error("Couldn't reach the AI service. Check your connection.");
    err.code = "network";
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    const err = new Error("That key was not accepted. Check it and try again.");
    err.code = "bad-key";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(friendlyApiError(res.status, await res.text().catch(() => "")));
    err.code = "http-" + res.status;
    throw err;
  }
  return true;
}

export { isKnownSite };
