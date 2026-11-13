// Double-sale protection: countdown, reminder schedule, and badge counts.
// Pure logic. The UI and Notification API live in the screens and main.js.
import { pendingDelist, needsDelistHighlight, siteName, delistTargets } from "./inventory.js";

export const ACT_WITHIN_MS = 15 * 60 * 1000;

// After a sale, remind at these elapsed times, then every two hours.
export const REMIND_AT_MS = [
  0,
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000
];
export const REMIND_REPEAT_MS = 2 * 60 * 60 * 1000;

export function formatDuration(ms, { clock = false } = {}) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const s = Math.floor(n / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (clock && h < 24) {
    const mm = String(m % 60).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    if (h > 0) return `${h}:${mm}:${ss}`;
    return `${m}:${ss}`;
  }
  if (d >= 1) return d === 1 ? "1 day" : `${d} days`;
  if (h >= 1) {
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : (h === 1 ? "1 hour" : `${h} hours`);
  }
  if (m >= 1) {
    const rs = s % 60;
    if (clock) return `${m}m ${rs}s`;
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  return s <= 1 ? "1 second" : `${s} seconds`;
}

/**
 * Countdown / elapsed info for a sold item that still has listings up.
 * The 15-minute window is a target, not a guarantee.
 */
export function delistCountdown(item, at = Date.now()) {
  if (!item || !item.soldAt || !needsDelistHighlight(item)) return null;
  const elapsed = Math.max(0, at - Number(item.soldAt));
  const remain = ACT_WITHIN_MS - elapsed;
  const pending = pendingDelist(item);
  return {
    elapsedMs: elapsed,
    remainMs: remain,
    overdue: remain <= 0,
    elapsedLabel: formatDuration(elapsed),
    remainLabel: remain > 0 ? formatDuration(remain, { clock: true }) : null,
    pending,
    pendingNames: pending.map(siteName),
    soldOn: item.soldOn,
    soldOnName: item.soldOn ? siteName(item.soldOn) : "",
    soldAt: item.soldAt,
    headline: remain > 0
      ? `Take it down now — ${formatDuration(remain, { clock: true })} left in the first 15 minutes`
      : `Still listed on other sites — sold ${formatDuration(elapsed)} ago`,
    sub: pending.length === 1
      ? `Still up on ${siteName(pending[0])}. Take it down so it doesn't sell twice.`
      : `Still up on ${pending.map(siteName).join(", ")}. Take them down so it doesn't sell twice.`
  };
}

export function badgeCount(items) {
  return (items || []).filter(needsDelistHighlight).length;
}

export function attentionItems(items) {
  return (items || []).filter(needsDelistHighlight)
    .sort((a, b) => (a.soldAt || 0) - (b.soldAt || 0));
}

/**
 * Should we fire a reminder right now?
 * `lastAt` is the last time we already reminded for this item (device-local).
 * The immediate (0) reminder is for the loud in-app alert at the moment of sale;
 * later ticks skip 0 if lastAt is already set or if we just sold this second.
 */
export function shouldRemind(item, lastAt, at = Date.now()) {
  if (!needsDelistHighlight(item) || !item.soldAt) return false;
  const elapsed = at - Number(item.soldAt);
  if (elapsed < 0) return false;
  // The 0-slot is the moment-of-sale alert. If we open the app later and have
  // never reminded, skip 0 and only fire a slot that is actually due now.
  let lastElapsed = lastAt != null ? (lastAt - Number(item.soldAt)) : -1;
  if (lastAt == null && elapsed > 60 * 1000) lastElapsed = 0;
  // Walk the schedule and see if a slot has been reached since lastAt.
  const slots = REMIND_AT_MS.slice();
  // After the last preset, every REMIND_REPEAT_MS from soldAt.
  const lastPreset = REMIND_AT_MS[REMIND_AT_MS.length - 1];
  if (elapsed > lastPreset) {
    const k = Math.floor(elapsed / REMIND_REPEAT_MS) * REMIND_REPEAT_MS;
    if (k > lastPreset && !slots.includes(k)) slots.push(k);
  }
  for (const slot of slots) {
    if (elapsed >= slot && lastElapsed < slot) return true;
  }
  return false;
}

export function nextReminderAt(item, lastAt, at = Date.now()) {
  if (!needsDelistHighlight(item) || !item.soldAt) return null;
  const soldAt = Number(item.soldAt);
  const lastElapsed = lastAt != null ? (lastAt - soldAt) : -1;
  for (const slot of REMIND_AT_MS) {
    if (slot > lastElapsed) return soldAt + slot;
  }
  const lastPreset = REMIND_AT_MS[REMIND_AT_MS.length - 1];
  const start = Math.max(lastPreset, lastElapsed);
  const k = Math.floor(start / REMIND_REPEAT_MS) + 1;
  return soldAt + k * REMIND_REPEAT_MS;
}

export function reminderBody(item, at = Date.now()) {
  const c = delistCountdown(item, at);
  if (!c) return null;
  const title = "Take a listing down";
  const name = (item.title || "An item").trim();
  const body = `${name} sold${c.soldOnName ? " on " + c.soldOnName : ""}. ${c.sub}`;
  return { title, body, tag: "flip-helper-delist-" + item.id, itemId: item.id, pending: c.pending.length };
}

export { pendingDelist, needsDelistHighlight, delistTargets, siteName };
