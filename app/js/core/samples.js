// Three built-in sample items for the "try it before you install" demo.
// Photos are original drawings (no real brands, no real products).
// Drafts, prices, and scan numbers are canned and labeled Sample.

import { normalizeDraft } from "./draft.js";

export const SAMPLE_OWN_PHOTO_NOTE = "This is a sample draft, not a read of your photo. Paste the AI key in Settings to get a real draft from a photo.";
export const SAMPLE_LABEL = "Sample";
export const SAMPLE_DRAFT_NOTE = "This is a realistic sample listing, not from a live sold-price check.";

/** Used when she tries her own photo but has no AI key, or the AI call fails. */
export const GENERIC_OWN_PHOTO = {
  title: "Item from your photo",
  description: "This is a sample listing so you can see every step, from a draft to a sale. It is not a read of your photo, and it does not invent a brand or a condition.",
  category: "Household",
  condition: "",
  brand: "",
  material: "",
  size: "",
  priceLow: 12,
  priceHigh: 22,
  priceReason: "Sample estimate, not from your photo and not from sold listings.",
  photoShows: { whatYouSee: "A photo you just took.", visibleText: "", visibleFlaws: "", visibleDetails: "" },
  bestPrice: { sites: ["ebay"], reason: "Sample suggestion: eBay often reaches more buyers. This is not from live listings." },
  fastestSale: { sites: ["facebook", "mercari"], reason: "Sample suggestion: local pickup or Mercari can be quicker. This is not from actual sale times." }
};

export const SAMPLES = [
  {
    id: "mug",
    name: "Speckled ceramic mug",
    photo: "media/samples/mug.jpg",
    costPaid: 4,
    weightOz: 16,
    desiredProfit: 6,
    salePrice: 18,
    soldOn: "mercari",
    shipCost: 5.54,
    binLocation: "A3",
    defaultSites: ["ebay", "poshmark", "mercari", "facebook"],
    draft: {
      title: "Speckled ceramic mug, cream and brown",
      description: "A sturdy cream ceramic mug with brown speckles and a rounded handle. No chips are drawn on the rim. No brand mark is visible.",
      category: "Kitchen",
      condition: "Good",
      brand: "",
      material: "Ceramic",
      size: "",
      priceLow: 16,
      priceHigh: 24,
      priceReason: "Sample estimate for a plain ceramic mug, from general knowledge, not from checking sold listings.",
      photoShows: {
        whatYouSee: "A cream mug with brown speckles and a rounded handle, on a plain background.",
        visibleText: "",
        visibleFlaws: "",
        visibleDetails: "Speckled glaze, rounded body, simple handle."
      },
      bestPrice: { sites: ["ebay", "etsy"], reason: "Sample suggestion: everyday kitchen items often bring a little more on eBay or Etsy. Not from live listings." },
      fastestSale: { sites: ["facebook", "mercari"], reason: "Sample suggestion: local pickup or Mercari can move a mug quickly. Not from actual sale times." }
    }
  },
  {
    id: "frame",
    name: "Wooden picture frame",
    photo: "media/samples/frame.jpg",
    costPaid: 2,
    weightOz: 22,
    desiredProfit: 5,
    salePrice: 12,
    soldOn: "mercari",
    shipCost: 6.15,
    binLocation: "B2",
    defaultSites: ["ebay", "facebook", "mercari", "craigslist"],
    draft: {
      title: "Wooden 8×10 picture frame",
      description: "A simple wooden picture frame with a cream mat and a printed landscape (hills and a sun). The wood is a medium brown. No brand is visible. A good everyday frame.",
      category: "Home decor",
      condition: "Good",
      brand: "",
      material: "Wood",
      size: "8×10",
      measurements: "About 8 by 10 inches for the opening.",
      priceLow: 10,
      priceHigh: 16,
      priceReason: "Sample estimate for a plain wooden frame, not from checking sold listings.",
      photoShows: {
        whatYouSee: "A rectangular wooden frame around a simple hill-and-sun picture, with a cream mat.",
        visibleText: "",
        visibleFlaws: "",
        visibleDetails: "Medium-brown wood, cream mat, landscape print."
      },
      bestPrice: { sites: ["ebay", "facebook"], reason: "Sample suggestion: frames often do well on eBay, or locally to avoid shipping. Not from live listings." },
      fastestSale: { sites: ["facebook", "craigslist"], reason: "Sample suggestion: a frame can sell faster with local pickup, since shipping is bulky. Not from actual sale times." }
    }
  },
  {
    id: "tote",
    name: "Navy canvas tote",
    photo: "media/samples/tote.jpg",
    costPaid: 4,
    weightOz: 12,
    desiredProfit: 6,
    salePrice: 16,
    soldOn: "mercari",
    shipCost: 5.14,
    binLocation: "C1",
    defaultSites: ["ebay", "poshmark", "mercari", "depop"],
    draft: {
      title: "Navy canvas tote bag",
      description: "A plain navy canvas tote with two strap handles and a front pocket. No logo or brand is visible. Looks clean and sturdy.",
      category: "Bags",
      condition: "Good",
      brand: "",
      material: "Canvas",
      size: "",
      priceLow: 14,
      priceHigh: 22,
      priceReason: "Sample estimate for a plain canvas tote, not from checking sold listings.",
      photoShows: {
        whatYouSee: "A navy tote bag with two handles and a front pocket, on a plain background.",
        visibleText: "",
        visibleFlaws: "",
        visibleDetails: "Navy canvas, two straps, stitched front pocket, no logo."
      },
      bestPrice: { sites: ["ebay", "poshmark"], reason: "Sample suggestion: a plain tote can reach more buyers on eBay or Poshmark. Not from live listings." },
      fastestSale: { sites: ["mercari", "depop"], reason: "Sample suggestion: Mercari and Depop can move everyday bags a bit faster. Not from actual sale times." }
    }
  }
];

export function sampleById(id) {
  return SAMPLES.find(s => s.id === id) || null;
}

export function sampleDraft(sample) {
  const raw = (sample && sample.draft) || GENERIC_OWN_PHOTO;
  return normalizeDraft(raw);
}

export function samplePhoto(sample) {
  if (!sample) return null;
  const src = typeof sample === "string" ? sample : sample.photo;
  if (!src) return null;
  return { dataUrl: src, addedAt: 0, sample: true };
}

/** Brand-like words we refuse to put on a built-in sample. */
export const FORBIDDEN_BRANDS = [
  "nike", "adidas", "apple", "gucci", "lv", "louis vuitton", "chanel",
  "prada", "supreme", "coach", "hero", "disney", "sony", "samsung",
  "lululemon", "patagonia", "north face", "levi", "zara", "hm", "h&m"
];

export function sampleHasBrand(text) {
  const t = String(text || "").toLowerCase();
  return FORBIDDEN_BRANDS.some(b => {
    const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(?:^|[^a-z0-9&])" + esc + "(?:$|[^a-z0-9&])").test(t);
  });
}

export { normalizeDraft };
