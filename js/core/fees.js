// Approximate US seller fee tables, dated November 2026.
// These are estimates for an ordinary sale with no ads or promotions.
// Sites change their fees. Check your own account before you rely on a figure.
import { money } from "./inventory.js";
import { SITE_IDS, siteName, isKnownSite } from "./sites.js";

export const FEE_TABLE_AS_OF = "2026-11";
export const FEE_TABLE_NOTE = "Approximate US seller fees as of November 2026, for an ordinary sale with no ads. Sites change their fees. Check your own account before you rely on a figure.";

function pct(sale, rate, flat = 0) {
  const s = money(sale) ?? 0;
  return money(s * rate + flat);
}

export const FEE_TABLE = {
  ebay: {
    id: "ebay",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "Most categories: 13.6% of the sale plus $0.40 per order ($0.30 if $10 or less). Some categories differ.",
    compute(sale) {
      const s = money(sale) ?? 0;
      return money(s * 0.136 + (s <= 10 ? 0.30 : 0.40));
    }
  },
  poshmark: {
    id: "poshmark",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "$2.95 under $15; 20% at $15 or more, on the item price.",
    compute(sale) {
      const s = money(sale) ?? 0;
      return money(s < 15 ? (s <= 0 ? 0 : 2.95) : s * 0.20);
    }
  },
  mercari: {
    id: "mercari",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "10% selling fee on the item price (and on buyer-paid shipping, if any). Buyers may pay a separate protection fee.",
    compute(sale) { return pct(sale, 0.10); }
  },
  facebook: {
    id: "facebook",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "About 10% on shipped orders, $0.80 minimum. Local pickup is usually free of a selling fee.",
    compute(sale, { local = false } = {}) {
      if (local) return 0;
      const s = money(sale) ?? 0;
      if (s <= 0) return 0;
      return money(Math.max(0.80, s * 0.10));
    }
  },
  offerup: {
    id: "offerup",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "About 12.9% plus $0.40 on shipped sales. Local pickup may be lower. Approximate.",
    compute(sale, { local = false } = {}) {
      if (local) return 0;
      return pct(sale, 0.129, 0.40);
    }
  },
  craigslist: {
    id: "craigslist",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "Most everyday items can be posted at no charge. Some categories charge a posting fee.",
    compute() { return 0; }
  },
  depop: {
    id: "depop",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "No US selling fee; about 3.3% plus $0.45 payment processing. Boosted listings cost extra.",
    compute(sale) { return pct(sale, 0.033, 0.45); }
  },
  vinted: {
    id: "vinted",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "No seller fee in the US. The buyer usually pays a Vinted fee.",
    compute() { return 0; }
  },
  grailed: {
    id: "grailed",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "About 9% seller commission. Approximate.",
    compute(sale) { return pct(sale, 0.09); }
  },
  etsy: {
    id: "etsy",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "$0.20 listing fee, 6.5% transaction, and 3% + $0.25 payment processing. Offsite ads can add more.",
    compute(sale) { return pct(sale, 0.065 + 0.03, 0.20 + 0.25); }
  },
  shopify: {
    id: "shopify",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "About 2.9% + $0.30 payment processing, plus your Shopify plan. Approximate.",
    compute(sale) { return pct(sale, 0.029, 0.30); }
  },
  whatnot: {
    id: "whatnot",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "About 8% commission plus payment processing (roughly 10.9% + $0.30 together). Approximate.",
    compute(sale) { return pct(sale, 0.109, 0.30); }
  },
  kidizen: {
    id: "kidizen",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    note: "About 9.9% commission. Approximate.",
    compute(sale) { return pct(sale, 0.099); }
  },
  thredup: {
    id: "thredup",
    asOf: FEE_TABLE_AS_OF,
    approx: true,
    payoutShare: true,
    note: "thredUP pays you a share of the sale, which varies. That is not a typical seller fee, so we do not estimate it.",
    compute() { return 0; }
  }
};

export function feeFor(siteId, sale, opts = {}) {
  const row = FEE_TABLE[siteId];
  if (!row) return { siteId, fee: null, approx: true, note: "No fee table for this site.", asOf: FEE_TABLE_AS_OF };
  const fee = row.compute(sale, opts);
  return {
    siteId,
    name: siteName(siteId),
    fee,
    approx: true,
    asOf: row.asOf || FEE_TABLE_AS_OF,
    note: row.note,
    payoutShare: !!row.payoutShare
  };
}

/** Net after approximate seller fees (not shipping, not cost). */
export function netAfterFees(siteId, sale, opts = {}) {
  const s = money(sale);
  if (s == null) return null;
  const { fee } = feeFor(siteId, s, opts);
  if (fee == null) return null;
  return money(s - fee);
}

/** Per-site fee rows for a sale price, in known-site order. */
export function feeRows(sale, siteIds, opts = {}) {
  const ids = (siteIds && siteIds.length ? siteIds : SITE_IDS).filter(isKnownSite);
  return ids.map(id => {
    const row = feeFor(id, sale, opts);
    const s = money(sale);
    return { ...row, sale: s, net: s != null && row.fee != null ? money(s - row.fee) : null };
  });
}

export { money, isKnownSite };
