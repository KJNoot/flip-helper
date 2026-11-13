// Selling sites Jessika's Flip Side knows about. "sellUrl" opens that site's own create-listing page.
// "manageUrl" opens a page where she can edit or take a listing down. There is no official
// public door for a small iPhone app to post or delist on most of these, so we only open links.
export const SITES = [
  {
    id: "ebay",
    name: "eBay",
    group: "marketplaces",
    sellUrl: "https://www.ebay.com/sl/prelist/suggest",
    manageUrl: "https://www.ebay.com/sh/lst/active",
    soldKind: "sold-completed",
    soldSearch: q => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Complete=1&LH_Sold=1`,
    activeSearch: q => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
    labelUrl: "https://www.ebay.com/ship/usd"
  },
  {
    id: "facebook",
    name: "Facebook Marketplace",
    short: "Facebook",
    group: "marketplaces",
    sellUrl: "https://www.facebook.com/marketplace/create/item",
    manageUrl: "https://www.facebook.com/marketplace/you/selling",
    soldKind: "search",
    soldSearch: q => `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(q)}`
  },
  {
    id: "mercari",
    name: "Mercari",
    group: "marketplaces",
    sellUrl: "https://www.mercari.com/sell/",
    manageUrl: "https://www.mercari.com/mypage/listings/active/",
    soldKind: "search",
    soldSearch: q => `https://www.mercari.com/search/?keyword=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.mercari.com/search/?keyword=${encodeURIComponent(q)}`,
    labelUrl: "https://www.mercari.com/mypage/"
  },
  {
    id: "offerup",
    name: "OfferUp",
    group: "marketplaces",
    sellUrl: "https://offerup.com/post/",
    manageUrl: "https://offerup.com/dashboard/selling/",
    soldKind: "search",
    soldSearch: q => `https://offerup.com/search/?q=${encodeURIComponent(q)}`,
    activeSearch: q => `https://offerup.com/search/?q=${encodeURIComponent(q)}`
  },
  {
    id: "craigslist",
    name: "Craigslist",
    group: "marketplaces",
    note: "Local listings. You'll pick your city on their site.",
    sellUrl: "https://post.craigslist.org/",
    manageUrl: "https://accounts.craigslist.org/",
    soldKind: "search",
    soldSearch: q => `https://www.craigslist.org/search/sss?query=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.craigslist.org/search/sss?query=${encodeURIComponent(q)}`
  },
  {
    id: "poshmark",
    name: "Poshmark",
    group: "fashion",
    sellUrl: "https://poshmark.com/create-listing",
    manageUrl: "https://poshmark.com/feed",
    soldKind: "sold-out",
    soldSearch: q => `https://poshmark.com/search?query=${encodeURIComponent(q)}&type=listings&availability=sold_out`,
    activeSearch: q => `https://poshmark.com/search?query=${encodeURIComponent(q)}`,
    labelUrl: "https://poshmark.com/order/sales"
  },
  {
    id: "depop",
    name: "Depop",
    group: "fashion",
    sellUrl: "https://www.depop.com/products/create/",
    manageUrl: "https://www.depop.com/sellinghub/",
    soldKind: "search",
    soldSearch: q => `https://www.depop.com/search/?q=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.depop.com/search/?q=${encodeURIComponent(q)}`,
    labelUrl: "https://www.depop.com/sellinghub/"
  },
  {
    id: "vinted",
    name: "Vinted",
    group: "fashion",
    sellUrl: "https://www.vinted.com/items/new",
    manageUrl: "https://www.vinted.com/inbox",
    soldKind: "search",
    soldSearch: q => `https://www.vinted.com/catalog?search_text=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.vinted.com/catalog?search_text=${encodeURIComponent(q)}`
  },
  {
    id: "grailed",
    name: "Grailed",
    group: "fashion",
    note: "Mostly menswear and streetwear.",
    sellUrl: "https://www.grailed.com/sell",
    manageUrl: "https://www.grailed.com/shop",
    soldKind: "search",
    soldSearch: q => `https://www.grailed.com/shop?query=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.grailed.com/shop?query=${encodeURIComponent(q)}`
  },
  {
    id: "etsy",
    name: "Etsy",
    group: "shops",
    note: "Handmade, vintage, and craft supplies.",
    sellUrl: "https://www.etsy.com/your/shops/me/listing-editor/create",
    manageUrl: "https://www.etsy.com/your/shops/me/tools/listings",
    soldKind: "search",
    soldSearch: q => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
    labelUrl: "https://www.etsy.com/your/orders/sold"
  },
  {
    id: "shopify",
    name: "Shopify",
    group: "shops",
    note: "Your own shop, if you have one.",
    sellUrl: "https://admin.shopify.com/",
    manageUrl: "https://admin.shopify.com/",
    soldKind: "search",
    soldSearch: q => `https://admin.shopify.com/`,
    activeSearch: q => `https://admin.shopify.com/`
  },
  {
    id: "whatnot",
    name: "Whatnot",
    group: "shops",
    note: "Live selling, often from their app.",
    sellUrl: "https://www.whatnot.com/",
    manageUrl: "https://www.whatnot.com/",
    soldKind: "search",
    soldSearch: q => `https://www.whatnot.com/search?q=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.whatnot.com/search?q=${encodeURIComponent(q)}`
  },
  {
    id: "kidizen",
    name: "Kidizen",
    group: "kids",
    note: "Kids' and baby clothes and gear.",
    sellUrl: "https://www.kidizen.com/listings/new",
    manageUrl: "https://www.kidizen.com/myshop",
    soldKind: "search",
    soldSearch: q => `https://www.kidizen.com/shop?search_term=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.kidizen.com/shop?search_term=${encodeURIComponent(q)}`
  },
  {
    id: "thredup",
    name: "thredUP",
    group: "kids",
    note: "Consignment: you send a bag of items, they list them. Not a usual copy-and-post listing.",
    sellUrl: "https://www.thredup.com/cleanout",
    manageUrl: "https://www.thredup.com/cleanout",
    soldKind: "search",
    soldSearch: q => `https://www.thredup.com/products?text=${encodeURIComponent(q)}`,
    activeSearch: q => `https://www.thredup.com/products?text=${encodeURIComponent(q)}`
  }
];

export const SITE_GROUPS = [
  { id: "marketplaces", label: "General marketplaces" },
  { id: "fashion", label: "Fashion and clothing" },
  { id: "shops", label: "Shops and live selling" },
  { id: "kids", label: "Kids and consignment" }
];

export const SITE_IDS = SITES.map(s => s.id);

/** The sites turned on when she hasn't picked yet: the usual first set. */
export const DEFAULT_ENABLED = ["ebay", "poshmark", "mercari", "facebook", "etsy", "depop"];

export function siteById(id) {
  return SITES.find(s => s.id === id) || null;
}

export function isKnownSite(id) {
  return SITE_IDS.includes(id);
}

export function siteName(id) {
  const s = siteById(id);
  return s ? (s.short || s.name) : String(id || "");
}

/** Unique known ids, original order of SITES. */
export function knownSiteIds(ids) {
  const want = new Set((ids || []).filter(isKnownSite));
  return SITE_IDS.filter(id => want.has(id));
}

/** Search phrase for sold-price links: title, or brand + category as a fallback. */
export function searchQuery(item) {
  const t = String(item && item.title || "").trim();
  if (t) return t;
  return [item && item.brand, item && item.category].filter(Boolean).join(" ").trim();
}
