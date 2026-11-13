// Marketplace compatibility chart, US only for now.
// What can be automated through an official API, what needs her tap, and
// what isn't available. Source links are official docs or published terms.
// This is general information, not legal advice. Terms can change.

export const COMPAT_REGION = "US";
export const COMPAT_AS_OF = "2026-11";
export const COMPAT_DISCLAIMER = "United States only, as of November 2026. This is a plain reading of each site's published programs and rules, not legal advice. Sites change their terms. Please check the linked page before you rely on it.";

export const COMPAT = [
  {
    id: "ebay",
    name: "eBay",
    officialApi: true,
    automate: "Official Sell APIs can create a listing and end one (EndItem or withdrawOffer), after you sign in with eBay and give permission.",
    needsTap: "Until that official connection is set up, you copy the listing and post or take it down yourself.",
    unavailable: "",
    path: "official",
    pathLabel: "Official API — coming later",
    sources: [
      { label: "eBay developer program", url: "https://developer.ebay.com/" },
      { label: "Sell APIs", url: "https://developer.ebay.com/develop/apis-by-business-function" }
    ]
  },
  {
    id: "etsy",
    name: "Etsy",
    officialApi: true,
    automate: "Official API v3 can create a draft listing and delete a listing. An app other sellers use needs Commercial Access, which Etsy reviews.",
    needsTap: "Until Etsy grants access and you give permission, you post and take listings down yourself.",
    unavailable: "",
    path: "official",
    pathLabel: "Official API — coming later",
    sources: [
      { label: "Etsy developers", url: "https://developers.etsy.com/" },
      { label: "Etsy Seller Policy", url: "https://www.etsy.com/legal/sellers/" }
    ]
  },
  {
    id: "shopify",
    name: "Shopify",
    officialApi: true,
    automate: "Official Admin API, with the shop owner's permission, can create and unpublish products.",
    needsTap: "Only applies if you have a Shopify shop. Until it's connected, you use Shopify yourself.",
    unavailable: "",
    path: "official",
    pathLabel: "Official API — coming later",
    sources: [
      { label: "Shopify Admin API", url: "https://shopify.dev/docs/api/admin-rest" },
      { label: "Shopify Partner program", url: "https://www.shopify.com/partners" }
    ]
  },
  {
    id: "depop",
    name: "Depop",
    officialApi: false,
    officialApiNote: "A Selling API exists, but it is partner-only. Approval is not guaranteed.",
    automate: "Not available unless Depop approves a partner connection.",
    needsTap: "You post and take listings down in Depop yourself.",
    unavailable: "Automatic posting is not available for a typical helper app today.",
    path: "apply",
    pathLabel: "Partner API — apply, don't assume",
    sources: [
      { label: "Depop", url: "https://www.depop.com/" }
    ]
  },
  {
    id: "vinted",
    name: "Vinted",
    officialApi: false,
    officialApiNote: "A Pro Integrations API exists for allowlisted Vinted Pro businesses.",
    automate: "Only realistic if you qualify and Vinted allowlists the app.",
    needsTap: "You post and take listings down in Vinted yourself.",
    unavailable: "Not a door for a typical individual helper app today.",
    path: "apply",
    pathLabel: "Pro Integrations — only if allowlisted",
    sources: [
      { label: "Vinted", url: "https://www.vinted.com/" }
    ]
  },
  {
    id: "facebook",
    name: "Facebook Marketplace",
    officialApi: false,
    automate: "Not available. Meta's Marketplace Item API is only for approved Marketplace partners.",
    needsTap: "You post and take listings down in the Facebook app yourself.",
    unavailable: "No public listing API we can use. We will only revisit this if Meta opens a real official door.",
    path: "manual",
    pathLabel: "Needs your tap",
    sources: [
      { label: "Meta for Developers", url: "https://developers.facebook.com/" }
    ]
  },
  {
    id: "poshmark",
    name: "Poshmark",
    officialApi: false,
    automate: "Not available. Poshmark's Community Guidelines (the “Be Real” section) do not allow unauthorized programs or other forms of automation, including deleting and reposting.",
    needsTap: "You post and take listings down in Poshmark yourself. A button that opens Poshmark so you can tap is fine.",
    unavailable: "No unofficial bot or computer clicker. Losing a closet is worse than a late listing.",
    path: "forbidden",
    pathLabel: "Automation not allowed",
    sources: [
      { label: "Poshmark Community Guidelines", url: "https://poshmark.com/guidelines" }
    ]
  },
  {
    id: "mercari",
    name: "Mercari",
    officialApi: false,
    automate: "Not available. Mercari's US prohibited-conduct policy does not allow unauthorized automated access.",
    needsTap: "You post and take listings down in Mercari yourself.",
    unavailable: "No public official seller API for the US marketplace. (Japan has a separate Mercari Shops API — a different product.)",
    path: "forbidden",
    pathLabel: "Unauthorized automation not allowed",
    sources: [
      { label: "Mercari prohibited conduct", url: "https://www.mercari.com/us/help_center/topics/account/policies/prohibited-conduct/" }
    ]
  },
  {
    id: "offerup",
    name: "OfferUp",
    officialApi: false,
    automate: "No public official third-party listing API found.",
    needsTap: "You post and take listings down in OfferUp yourself.",
    unavailable: "Automatic posting is not available.",
    path: "manual",
    pathLabel: "Needs your tap",
    sources: [
      { label: "OfferUp", url: "https://offerup.com/" }
    ]
  },
  {
    id: "craigslist",
    name: "Craigslist",
    officialApi: false,
    automate: "No official listing API. Their terms have long restricted automated posting. Posting is also city-specific.",
    needsTap: "You open the post page and post yourself.",
    unavailable: "A bot here is high risk. Jessica's Flip Side will not auto-post to Craigslist.",
    path: "forbidden",
    pathLabel: "Automated posting not allowed",
    sources: [
      { label: "Craigslist terms of use", url: "https://www.craigslist.org/about/terms.of.use" }
    ]
  },
  {
    id: "grailed",
    name: "Grailed",
    officialApi: false,
    automate: "No public official third-party listing API found.",
    needsTap: "You post and take listings down in Grailed yourself.",
    unavailable: "Automatic posting is not available.",
    path: "manual",
    pathLabel: "Needs your tap",
    sources: [
      { label: "Grailed", url: "https://www.grailed.com/" }
    ]
  },
  {
    id: "whatnot",
    name: "Whatnot",
    officialApi: false,
    automate: "No public official third-party listing API found. Live selling is often done in their app.",
    needsTap: "You post and sell in Whatnot yourself.",
    unavailable: "Automatic posting is not available.",
    path: "manual",
    pathLabel: "Needs your tap",
    sources: [
      { label: "Whatnot", url: "https://www.whatnot.com/" }
    ]
  },
  {
    id: "kidizen",
    name: "Kidizen",
    officialApi: false,
    automate: "No public official listing API found.",
    needsTap: "You post and take listings down in Kidizen yourself.",
    unavailable: "Automatic posting is not available.",
    path: "manual",
    pathLabel: "Needs your tap",
    sources: [
      { label: "Kidizen", url: "https://www.kidizen.com/" }
    ]
  },
  {
    id: "thredup",
    name: "thredUP",
    officialApi: false,
    automate: "Different model: you send a bag, they list the items. Not a usual copy-and-post listing.",
    needsTap: "A link to their clean-out sign-up is enough.",
    unavailable: "Jessica's Flip Side cannot post to thredUP the usual way.",
    path: "other",
    pathLabel: "Consignment — not a usual listing",
    sources: [
      { label: "thredUP cleanout", url: "https://www.thredup.com/cleanout" }
    ]
  }
];

export function compatFor(id) {
  return COMPAT.find(c => c.id === id) || null;
}

export function compatLimitsNote(id) {
  const c = compatFor(id);
  if (!c) return "";
  if (c.path === "official") return c.needsTap || c.pathLabel;
  // A short note for the item page: what she has to do, plus a one-line limit.
  if (c.path === "forbidden") return (c.needsTap ? c.needsTap + " " : "") + (c.pathLabel || c.automate);
  return c.needsTap || c.pathLabel;
}

export function pathKind(id) {
  const c = compatFor(id);
  return c ? c.path : "manual";
}
