// Box and weight suggestions, approximate shipping-cost tables, and links
// to each site's own prepaid-label page. This version does not buy labels.
import { money, formatUsd } from "./inventory.js";
import { SITES, siteById, siteName, isKnownSite } from "./sites.js";

export const SHIP_TABLE_AS_OF = "2026-11";
export const SHIP_TABLE_NOTE = "Approximate mid-US (about zone 5) domestic rates as of November 2026. Not a quote. The real price depends on the from and to ZIP codes, the package, and that day's rates.";

// Weight brackets in ounces, then approximate USD.
// Ground Advantage and Priority: USPS. UPS Ground is typically higher for small parcels.
export const SHIP_TABLE = {
  uspsGroundAdvantage: {
    id: "uspsGroundAdvantage",
    name: "USPS Ground Advantage",
    asOf: SHIP_TABLE_AS_OF,
    approx: true,
    rates: [
      { oz: 4, usd: 5.25 },
      { oz: 8, usd: 5.85 },
      { oz: 12, usd: 6.40 },
      { oz: 16, usd: 7.15 },
      { oz: 32, usd: 8.90 },
      { oz: 48, usd: 10.40 },
      { oz: 80, usd: 13.20 },
      { oz: 160, usd: 19.50 },
      { oz: 320, usd: 28.00 },
      { oz: 640, usd: 42.00 }
    ]
  },
  uspsPriority: {
    id: "uspsPriority",
    name: "USPS Priority Mail",
    asOf: SHIP_TABLE_AS_OF,
    approx: true,
    rates: [
      { oz: 16, usd: 9.50 },
      { oz: 32, usd: 11.20 },
      { oz: 48, usd: 12.80 },
      { oz: 80, usd: 16.50 },
      { oz: 160, usd: 24.00 },
      { oz: 320, usd: 36.00 },
      { oz: 640, usd: 55.00 }
    ]
  },
  upsGround: {
    id: "upsGround",
    name: "UPS Ground",
    asOf: SHIP_TABLE_AS_OF,
    approx: true,
    rates: [
      { oz: 16, usd: 12.50 },
      { oz: 32, usd: 13.80 },
      { oz: 80, usd: 18.50 },
      { oz: 160, usd: 26.00 },
      { oz: 320, usd: 38.00 },
      { oz: 640, usd: 58.00 }
    ]
  }
};

export const SHIP_SERVICES = ["uspsGroundAdvantage", "uspsPriority", "upsGround"];

/** Look up the first bracket that covers this packed weight. */
export function rateForWeight(serviceId, weightOz) {
  const svc = SHIP_TABLE[serviceId];
  if (!svc) return null;
  const oz = Number(weightOz);
  if (!Number.isFinite(oz) || oz <= 0) return null;
  for (const row of svc.rates) {
    if (oz <= row.oz) return { ...row, serviceId, name: svc.name, usd: money(row.usd), approx: true, asOf: svc.asOf };
  }
  const last = svc.rates[svc.rates.length - 1];
  return { ...last, serviceId, name: svc.name, usd: money(last.usd), approx: true, asOf: svc.asOf, over: true };
}

export function shippingEstimates(weightOz) {
  return SHIP_SERVICES.map(id => rateForWeight(id, weightOz)).filter(Boolean);
}

/** A reasonable default shipping cost: USPS Ground Advantage, or null. */
export function defaultShippingCost(weightOz) {
  const row = rateForWeight("uspsGroundAdvantage", weightOz || 16);
  return row ? row.usd : null;
}

/**
 * Heuristic box and weight from the title and category. Used when AI is
 * not available, and as a fallback. Always labeled an estimate.
 */
export function heuristicShip(item = {}) {
  const text = [item.category, item.title, item.description].filter(Boolean).join(" ").toLowerCase();
  const hit = (...words) => words.some(w => text.includes(w));
  if (hit("shirt", "dress", "scarf", "pants", "skirt", "sweater", "hoodie", "jacket", "coat", "jeans", "clothing", "apparel", "knit", "blouse", "tee", "top")) {
    return suggest("Poly mailer", 15, 12, 1, 8, "Clothes usually ship in a poly mailer. Weigh it with the mailer on.");
  }
  if (hit("shoe", "sneaker", "boot", "heel")) {
    return suggest("Shoebox or similar", 14, 9, 5, 32, "Shoes usually ship in a shoebox or a similar small box.");
  }
  if (hit("mug", "cup", "ceramic", "pottery", "glass", "vase", "dish", "plate", "bowl")) {
    return suggest("Small sturdy box", 8, 8, 8, 32, "Breakables need a sturdy box and padding. Weigh the packed box.");
  }
  if (hit("book", "paperback", "hardcover", "textbook")) {
    return suggest("Rigid mailer or small box", 11, 8, 3, 16, "A book often fits a rigid mailer. Add a box if there are several.");
  }
  if (hit("jewelry", "necklace", "earring", "ring", "bracelet")) {
    return suggest("Small padded envelope", 8, 6, 1, 3, "Jewelry is light. Use a padded envelope and a safe bag inside.");
  }
  if (hit("phone", "tablet", "laptop", "electronics", "console", "camera")) {
    return suggest("Padded box", 12, 9, 4, 24, "Electronics need padding and a sturdy box. Weigh the packed box.");
  }
  if (hit("bag", "purse", "handbag", "backpack", "tote")) {
    return suggest("Medium box or poly mailer", 14, 10, 6, 24, "A stuffed bag or a box both work. Weigh it packed.");
  }
  if (hit("toy", "game", "lego", "doll")) {
    return suggest("Small box", 12, 9, 5, 24, "A small box with a little padding is usually enough. Weigh it packed.");
  }
  if (hit("furniture", "chair", "table", "dresser", "sofa")) {
    return suggest("Large / freight — consider local pickup", 30, 20, 20, 320, "Bulky items are often better as local pickup. If you ship, get a real quote.");
  }
  return suggest("Small box", 10, 8, 4, 16, "A small box is a safe default until you weigh the packed item.");
}

function suggest(boxLabel, l, w, h, weightOz, reason) {
  return {
    boxLabel,
    lengthIn: l,
    widthIn: w,
    heightIn: h,
    weightOz,
    weightLb: money(weightOz / 16),
    reason,
    source: "heuristic",
    approx: true
  };
}

export function normalizeShipSuggest(raw = {}, source = "heuristic") {
  const weightOz = Number(raw.weightOz ?? raw.weight_oz);
  const l = Number(raw.lengthIn ?? raw.l ?? raw.length);
  const w = Number(raw.widthIn ?? raw.w ?? raw.width);
  const h = Number(raw.heightIn ?? raw.h ?? raw.height);
  return {
    boxLabel: String(raw.boxLabel || raw.box || "").trim() || "Small box",
    lengthIn: Number.isFinite(l) && l > 0 ? l : null,
    widthIn: Number.isFinite(w) && w > 0 ? w : null,
    heightIn: Number.isFinite(h) && h > 0 ? h : null,
    weightOz: Number.isFinite(weightOz) && weightOz > 0 ? Math.round(weightOz) : 16,
    weightLb: Number.isFinite(weightOz) && weightOz > 0 ? money(weightOz / 16) : 1,
    reason: String(raw.reason || "").trim(),
    source: raw.source || source,
    approx: true
  };
}

export function boxSizeLabel(s) {
  if (!s) return "";
  const dims = [s.lengthIn, s.widthIn, s.heightIn].filter(n => n != null);
  const dim = dims.length === 3 ? `${dims[0]}×${dims[1]}×${dims[2]} in` : "";
  const wt = s.weightOz >= 16 ? `${s.weightLb} lb` : `${s.weightOz} oz`;
  return [s.boxLabel, dim, wt].filter(Boolean).join(" · ");
}

/** Links to prepaid-label flows she already has, plus common ship-yourself sites. */
export const LABEL_LINKS = [
  { id: "ebay", name: "eBay shipping labels", url: "https://www.ebay.com/ship/usd", note: "If it sold on eBay, you can often buy a discounted label there." },
  { id: "etsy", name: "Etsy shipping labels", url: "https://www.etsy.com/your/orders/sold", note: "If it sold on Etsy and labels are turned on for your shop." },
  { id: "poshmark", name: "Poshmark (prepaid)", url: "https://poshmark.com/order/sales", note: "Poshmark usually emails a prepaid label after a sale." },
  { id: "mercari", name: "Mercari (prepaid)", url: "https://www.mercari.com/mypage/", note: "Mercari often provides a prepaid label in the app." },
  { id: "depop", name: "Depop orders", url: "https://www.depop.com/sellinghub/", note: "Depop may offer a prepaid label on the order." },
  { id: "usps", name: "USPS Click-N-Ship", url: "https://cns.usps.com/label-information", note: "Buy a USPS label yourself." },
  { id: "pirateship", name: "Pirate Ship", url: "https://ship.pirateship.com/", note: "A popular way to buy discounted USPS and UPS labels." },
  { id: "ups", name: "UPS", url: "https://www.ups.com/ship/guided/origin", note: "Buy a UPS label yourself." }
];

export function labelLinksFor(soldOn) {
  const preferred = soldOn && isKnownSite(soldOn) ? LABEL_LINKS.filter(l => l.id === soldOn) : [];
  const rest = LABEL_LINKS.filter(l => !preferred.some(p => p.id === l.id));
  return [...preferred, ...rest];
}

export function siteLabelUrl(siteId) {
  const s = siteById(siteId);
  if (s && s.labelUrl) return s.labelUrl;
  const l = LABEL_LINKS.find(x => x.id === siteId);
  return l ? l.url : (s ? s.manageUrl : "");
}

export { formatUsd, siteName, SITES };
