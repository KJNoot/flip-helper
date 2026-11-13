// Year-end totals: income, cost of goods, fees, shipping, and mileage.
// This is a record-keeper, not tax advice.
import { money, formatUsd, profit as itemProfit } from "./inventory.js";
import { siteName } from "./sites.js";
import { ymd } from "./settings.js";

export const TAX_DISCLAIMER = "This is a record of what you entered, not tax advice. Please check the numbers and talk to a tax professional if you need advice.";

export function yearOf(at) {
  if (typeof at === "string" && /^\d{4}/.test(at)) return Number(at.slice(0, 4));
  return new Date(at).getFullYear();
}

export function itemSoldInYear(item, year) {
  if (!item || !item.soldAt) return false;
  return yearOf(item.soldAt) === Number(year);
}

export function tripInYear(trip, year) {
  if (!trip) return false;
  return yearOf(trip.date || trip.at) === Number(year);
}

/**
 * Totals for a calendar year on the device's local clock.
 * Mileage deduction uses each trip's stored rate (frozen when it was logged).
 */
export function yearTotals(items, trips, year, at = Date.now()) {
  const y = Number(year) || new Date(at).getFullYear();
  const sold = (items || []).filter(i => itemSoldInYear(i, y));
  let income = 0, cogs = 0, fees = 0, shipping = 0, supplies = 0, discounts = 0, refunds = 0, received = 0, receivedCount = 0;
  for (const item of sold) {
    income = money(income + (money(item.salePrice) ?? 0));
    cogs = money(cogs + (money(item.costPaid) ?? 0));
    const hasM = item.marketplaceFees != null && item.marketplaceFees !== "";
    const hasP = item.paymentFees != null && item.paymentFees !== "";
    const feeAmt = (hasM || hasP)
      ? (money(item.marketplaceFees) ?? 0) + (money(item.paymentFees) ?? 0)
      : (money(item.fees) ?? 0);
    fees = money(fees + feeAmt);
    const ship = (item.actualShipCost != null && item.actualShipCost !== "")
      ? (money(item.actualShipCost) ?? 0)
      : (money(item.shippingPaid) ?? 0);
    shipping = money(shipping + ship);
    supplies = money(supplies + (money(item.supplies) ?? 0));
    discounts = money(discounts + (money(item.discounts) ?? 0));
    const ref = money(item.refunds) ?? (item.returns ? money(item.returns.refundAmount) ?? 0 : 0);
    refunds = money(refunds + ref);
    if (item.moneyReceived != null) {
      received = money(received + (money(item.moneyReceived) ?? 0));
      receivedCount += 1;
    }
  }
  const yearTrips = (trips || []).filter(t => tripInYear(t, y) && t.miles != null);
  let miles = 0, mileageDeduction = 0;
  for (const t of yearTrips) {
    miles = money(miles + (t.miles || 0));
    const d = t.deduction != null ? t.deduction : (t.miles != null && t.rate != null ? money(t.miles * t.rate) : 0);
    mileageDeduction = money(mileageDeduction + (d || 0));
  }
  const goodsProfit = money(income - cogs - fees - shipping - supplies - discounts - refunds);
  return {
    year: y,
    soldCount: sold.length,
    tripCount: yearTrips.length,
    income,
    cogs,
    fees,
    shipping,
    supplies,
    discounts,
    refunds,
    received,
    receivedCount,
    miles,
    mileageDeduction,
    goodsProfit,
    // Shown separately. Whether and how mileage can be deducted is for her and a tax pro.
    sold,
    trips: yearTrips
  };
}

export function yearsFrom(items, trips, at = Date.now()) {
  const set = new Set();
  set.add(new Date(at).getFullYear());
  for (const i of items || []) if (i.soldAt) set.add(yearOf(i.soldAt));
  for (const t of trips || []) {
    const y = yearOf(t.date || t.at);
    if (y) set.add(y);
  }
  return [...set].sort((a, b) => b - a);
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function soldDate(item) {
  if (!item || !item.soldAt) return "";
  return ymd(item.soldAt);
}

export function yearCsv(totals) {
  const lines = [];
  lines.push("Jessica's Flip Side tax summary");
  lines.push(`Year,${totals.year}`);
  lines.push("Not tax advice. This is a record of what you entered.");
  lines.push("");
  lines.push("Totals");
  lines.push("Income (sale prices)," + money(totals.income));
  lines.push("Cost of goods," + money(totals.cogs));
  lines.push("Fees," + money(totals.fees));
  lines.push("Shipping you paid," + money(totals.shipping));
  lines.push("Supplies," + money(totals.supplies ?? 0));
  lines.push("Discounts," + money(totals.discounts ?? 0));
  lines.push("Returns and refunds," + money(totals.refunds ?? 0));
  lines.push("Income minus cost, fees, shipping, supplies, discounts, and refunds," + money(totals.goodsProfit));
  lines.push("Money received (where entered)," + money(totals.received ?? 0));
  lines.push("Mileage (miles)," + money(totals.miles));
  lines.push("Mileage at the rate you logged," + money(totals.mileageDeduction));
  lines.push("");
  lines.push("Sold items");
  lines.push(["Date", "Title", "Sold on", "Sale price", "Cost of goods", "Fees", "Shipping", "Supplies", "Discounts", "Refunds", "Money received", "Profit"].join(","));
  for (const item of totals.sold || []) {
    const profit = itemProfit(item);
    const hasM = item.marketplaceFees != null && item.marketplaceFees !== "";
    const hasP = item.paymentFees != null && item.paymentFees !== "";
    const feeAmt = (hasM || hasP)
      ? money((money(item.marketplaceFees) ?? 0) + (money(item.paymentFees) ?? 0))
      : money(item.fees);
    const ship = (item.actualShipCost != null && item.actualShipCost !== "") ? money(item.actualShipCost) : money(item.shippingPaid);
    lines.push([
      soldDate(item),
      csvEscape(item.title || "Untitled item"),
      csvEscape(item.soldOn ? siteName(item.soldOn) : ""),
      money(item.salePrice) ?? "",
      money(item.costPaid) ?? "",
      feeAmt ?? "",
      ship ?? "",
      money(item.supplies) ?? "",
      money(item.discounts) ?? "",
      (money(item.refunds) ?? (item.returns ? money(item.returns.refundAmount) : null)) ?? "",
      money(item.moneyReceived) ?? "",
      profit ?? ""
    ].join(","));
  }
  lines.push("");
  lines.push("Mileage log");
  lines.push(["Date", "Miles", "Rate", "Amount", "Purpose", "Rate source"].join(","));
  for (const t of totals.trips || []) {
    lines.push([
      t.date || "",
      t.miles ?? "",
      t.rate ?? "",
      t.deduction ?? "",
      csvEscape(t.purpose || ""),
      csvEscape(t.rateSource || "")
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

export function yearSummaryText(totals) {
  const t = totals;
  const rows = [
    `Jessica's Flip Side — ${t.year} summary`,
    "",
    TAX_DISCLAIMER,
    "",
    `Items sold: ${t.soldCount}`,
    `Income (sale prices): ${formatUsd(t.income)}`,
    `Cost of goods: ${formatUsd(t.cogs)}`,
    `Fees: ${formatUsd(t.fees)}`,
    `Shipping you paid: ${formatUsd(t.shipping)}`,
    `Supplies: ${formatUsd(t.supplies ?? 0)}`,
    `Discounts: ${formatUsd(t.discounts ?? 0)}`,
    `Returns and refunds: ${formatUsd(t.refunds ?? 0)}`,
    `Income minus cost, fees, shipping, supplies, discounts, and refunds: ${formatUsd(t.goodsProfit)}`,
    `Mileage: ${t.miles} miles`,
    `Mileage at the rate you logged: ${formatUsd(t.mileageDeduction)}`,
    ""
  ];
  return rows.join("\n");
}

export { money, formatUsd };
