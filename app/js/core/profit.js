// Full profit: cost, marketplace and payment fees, postage, supplies,
// discounts, returns and refunds. Estimated profit vs money actually received.
// Pure logic. Safe to unit-test in Node.
import { money, formatUsd } from "./inventory.js";

export const PROFIT_NOTE = "Estimated profit is the sale price minus what you entered for cost, fees, postage, supplies, discounts, and refunds. Money received is what actually arrived, which can be different. This is a record of what you entered, not tax advice.";

function splitFees(item) {
  const hasSplit = item && (item.marketplaceFees != null && item.marketplaceFees !== "") || (item && item.paymentFees != null && item.paymentFees !== "");
  // The expression above has operator precedence issues if I'm not careful.
  // hasSplit if either split field is set.
  return hasSplit;
}

export function feeParts(item) {
  const hasM = item && item.marketplaceFees != null && item.marketplaceFees !== "";
  const hasP = item && item.paymentFees != null && item.paymentFees !== "";
  const hasSplit = hasM || hasP;
  const marketplaceFees = hasSplit ? (money(item.marketplaceFees) ?? 0) : (money(item && item.fees) ?? 0);
  const paymentFees = hasSplit ? (money(item.paymentFees) ?? 0) : 0;
  const combined = money(marketplaceFees + paymentFees);
  return { marketplaceFees, paymentFees, combined, split: hasSplit };
}

export function postageOf(item) {
  if (!item) return 0;
  if (item.actualShipCost != null && item.actualShipCost !== "") return money(item.actualShipCost) ?? 0;
  return money(item.shippingPaid) ?? 0;
}

export function refundOf(item) {
  if (!item) return 0;
  if (item.refunds != null && item.refunds !== "") return money(item.refunds) ?? 0;
  if (item.returns && item.returns.refundAmount != null) return money(item.returns.refundAmount) ?? 0;
  return 0;
}

/**
 * Full breakdown. Missing amounts count as 0, except sale price and
 * money received, which stay null until set.
 */
export function profitBreakdown(item) {
  const sale = item ? money(item.salePrice) : null;
  const cost = money(item && item.costPaid) ?? 0;
  const fees = feeParts(item);
  const postage = postageOf(item);
  const supplies = money(item && item.supplies) ?? 0;
  const discounts = money(item && item.discounts) ?? 0;
  const refunds = refundOf(item);
  const costs = money(cost + fees.combined + postage + supplies + discounts + refunds);
  const estimatedProfit = sale == null ? null : money(sale - costs);
  const moneyReceived = item ? money(item.moneyReceived) : null;
  // Money received is usually a payout already after marketplace and payment
  // fees (and sometimes postage). Received profit is payout minus cost,
  // supplies, discounts, and any refunds, unless she also subtracted those
  // in the payout figure. We subtract cost, supplies, discounts, and refunds,
  // and we do not subtract fees or postage a second time.
  const receivedProfit = moneyReceived == null ? null : money(moneyReceived - cost - supplies - discounts - refunds);
  return {
    sale,
    cost,
    marketplaceFees: fees.marketplaceFees,
    paymentFees: fees.paymentFees,
    fees: fees.combined,
    postage,
    postageIsActual: !!(item && item.actualShipCost != null && item.actualShipCost !== ""),
    supplies,
    discounts,
    refunds,
    costs,
    estimatedProfit,
    moneyReceived,
    receivedProfit
  };
}

/** Same number monthTotals already uses, now including the new cost fields. */
export function estimatedProfit(item) {
  return profitBreakdown(item).estimatedProfit;
}

/**
 * The lowest asking price that still leaves her chosen profit floor,
 * after cost, a fee estimate, and a shipping estimate.
 */
export function askingFloor(item, { defaultFloor = 0, feeEstimate = 0, shipEstimate = 0 } = {}) {
  const cost = money(item && item.costPaid) ?? 0;
  const floor = money(item && item.profitFloor != null && item.profitFloor !== "" ? item.profitFloor : defaultFloor) ?? 0;
  const fees = money(feeEstimate) ?? 0;
  const ship = money(item && item.actualShipCost) ?? money(shipEstimate) ?? 0;
  return money(cost + fees + ship + floor);
}

/**
 * "Buy up to $X": estimated resale minus fees, shipping, and her desired profit.
 * Assumptions are passed in so the scanner can let her edit them.
 */
export function buyUpTo({ resale, fees, shipping, desiredProfit } = {}) {
  const r = money(resale);
  if (r == null) return null;
  return money(r - (money(fees) ?? 0) - (money(shipping) ?? 0) - (money(desiredProfit) ?? 0));
}

export function buyUpToLabel(amount) {
  const v = money(amount);
  if (v == null) return "";
  if (v <= 0) return "Don't buy unless it's free (or almost free)";
  return `Buy up to ${formatUsd(v)}`;
}

export function normalizeReturn(raw = {}, at = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const refundAmount = money(raw.refundAmount ?? raw.refunds);
  const returned = raw.returned == null ? !!(refundAmount != null || raw.returnedAt) : !!raw.returned;
  if (!returned && refundAmount == null && !raw.note && !raw.reason && !raw.returnedAt) return null;
  return {
    returned,
    refundAmount,
    returnedAt: raw.returnedAt || (returned ? at : null),
    reason: String(raw.reason || "").trim(),
    note: String(raw.note || "").trim()
  };
}

export function normalizeReceipt(raw = {}, at = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.dataUrl && !raw.note) return null;
  return {
    id: String(raw.id || ("rc_" + at.toString(36) + Math.random().toString(36).slice(2, 6))),
    dataUrl: raw.dataUrl || "",
    note: String(raw.note || "").trim(),
    addedAt: raw.addedAt || at
  };
}

export function normalizeReceipts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(r => normalizeReceipt(r)).filter(Boolean);
}

export { money, formatUsd };
