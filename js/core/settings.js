// App settings that live on this device only. Never touches the AI key.
// Mileage trips are stored separately and may be included in a backup.
import { money } from "./inventory.js";

/** Per-mile rates need tenths of a cent (e.g. 0.725), not 2-decimal money. */
export function mileRate(n) {
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : Number(String(n).trim().replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
}

const SETTINGS_KEY = "flip-helper.settings";
const MILEAGE_KEY = "flip-helper.mileage";
const REMIND_KEY = "flip-helper.delistReminders";

export const DEFAULT_DROP_DAYS = 14;

// IRS standard mileage rates for business use. Mid-year 2026 change is real:
// 72.5 cents Jan 1–June 30 (Notice 2026-10 / IR-2025-128),
// 76 cents July 1–Dec 31 (Announcement 2026-11 / IR-2026-29).
// Confirm at IRS.gov; she can set her own rate in Settings.
export const IRS_PAGE = "https://www.irs.gov/tax-professionals/standard-mileage-rates";
export const IRS_BUSINESS_RATES = [
  { start: "2026-01-01", end: "2026-06-30", rate: 0.725, source: "IRS Notice 2026-10 (IR-2025-128)", label: "January–June 2026" },
  { start: "2026-07-01", end: "2026-12-31", rate: 0.76, source: "IRS Announcement 2026-11 (IR-2026-29)", label: "July–December 2026" }
];

export function ymd(at = Date.now()) {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function irsBandForDate(at = Date.now()) {
  const key = typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : ymd(at);
  for (const b of IRS_BUSINESS_RATES) {
    if (key >= b.start && key <= b.end) return b;
  }
  // After the last published band, use the latest and say so.
  const last = IRS_BUSINESS_RATES[IRS_BUSINESS_RATES.length - 1];
  return { ...last, stale: true, source: last.source + ". Last published rate we have — please confirm at IRS.gov." };
}

export function defaultIrsRate(at = Date.now()) {
  return irsBandForDate(at).rate;
}

export const DEFAULT_PROFIT_FLOOR = 5;
export const DEFAULT_DESIRED_PROFIT = 10;

export const DEFAULT_SETTINGS = {
  dropAfterDays: DEFAULT_DROP_DAYS,
  // null means: use the official IRS rate for each trip's date
  irsMileageRate: null,
  notifyDelist: false,
  ebayOfficialComps: false,
  defaultProfitFloor: DEFAULT_PROFIT_FLOOR,
  desiredProfit: DEFAULT_DESIRED_PROFIT,
  pauseAutomation: false,
  boxes: []
};

export const PAUSE_NOTE_ON = "Reminders and notifications are paused. Automatic listing and take-down (coming later) will also pause here.";
export const PAUSE_NOTE_OFF = "Reminders can run. There is no automatic posting in this version. When official take-down is added, this same switch will pause it.";
export const NO_SUBSCRIPTION_NOTE = "There's no subscription in this test version. You have the complete app. Nothing essential is locked behind an upgrade.";


function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export function getSettings(storage) {
  const s = store(storage);
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    const raw = s.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}

export function normalizeSettings(raw = {}) {
  const drop = Number(raw.dropAfterDays);
  const rate = raw.irsMileageRate == null || raw.irsMileageRate === "" ? null : mileRate(raw.irsMileageRate);
  const floor = money(raw.defaultProfitFloor);
  const desired = money(raw.desiredProfit);
  return {
    dropAfterDays: Number.isFinite(drop) && drop >= 1 && drop <= 365 ? Math.round(drop) : DEFAULT_DROP_DAYS,
    irsMileageRate: rate != null && rate >= 0 && rate <= 10 ? rate : null,
    notifyDelist: !!raw.notifyDelist,
    ebayOfficialComps: !!raw.ebayOfficialComps,
    defaultProfitFloor: floor != null && floor >= 0 && floor <= 10000 ? floor : DEFAULT_PROFIT_FLOOR,
    desiredProfit: desired != null && desired >= 0 && desired <= 10000 ? desired : DEFAULT_DESIRED_PROFIT,
    pauseAutomation: !!raw.pauseAutomation,
    boxes: normalizeBoxes(raw.boxes)
  };
}

export function setSettings(partial, storage) {
  const s = store(storage);
  const next = normalizeSettings({ ...getSettings(s), ...partial });
  if (s) {
    try { s.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* quota */ }
  }
  return next;
}

export function clearSettings(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(SETTINGS_KEY); } catch (e) {}
}

/** The rate to use for a new trip on this date. */
export function mileageRateFor(at = Date.now(), settings) {
  const prefs = settings || getSettings();
  if (prefs.irsMileageRate != null) {
    return {
      rate: mileRate(prefs.irsMileageRate),
      source: "Set in Settings",
      overridden: true,
      date: typeof at === "string" ? at : ymd(at)
    };
  }
  const band = irsBandForDate(at);
  return {
    rate: band.rate,
    source: band.source,
    label: band.label,
    overridden: false,
    stale: !!band.stale,
    date: typeof at === "string" ? at : ymd(at)
  };
}

export function newTripId(at = Date.now()) {
  return "mi_" + at.toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newBoxId(at = Date.now()) {
  return "bx_" + at.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function normalizeBox(raw = {}, at = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const l = Number(raw.lengthIn ?? raw.l);
  const w = Number(raw.widthIn ?? raw.w);
  const h = Number(raw.heightIn ?? raw.h);
  const label = String(raw.label || "").trim();
  if (!label && !(l > 0) && !(w > 0) && !(h > 0)) return null;
  return {
    id: String(raw.id || newBoxId(at)),
    label: label || "Box",
    lengthIn: Number.isFinite(l) && l > 0 ? l : null,
    widthIn: Number.isFinite(w) && w > 0 ? w : null,
    heightIn: Number.isFinite(h) && h > 0 ? h : null
  };
}

export function normalizeBoxes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(b => normalizeBox(b)).filter(Boolean);
}


export function normalizeTrip(raw = {}, at = Date.now()) {
  const date = String(raw.date || ymd(raw.at || at));
  const miles = money(raw.miles);
  const rate = mileRate(raw.rate);
  const deduction = miles != null && rate != null ? money(miles * rate) : null;
  return {
    id: raw.id || newTripId(at),
    date,
    miles: miles != null && miles >= 0 ? miles : null,
    purpose: String(raw.purpose || "").trim(),
    rate,
    rateSource: String(raw.rateSource || ""),
    deduction,
    itemId: raw.itemId ? String(raw.itemId) : "",
    at: raw.at || at
  };
}

export function getTrips(storage) {
  const s = store(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(MILEAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(t => normalizeTrip(t)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at || 0) - (a.at || 0));
  } catch (e) { return []; }
}

export function setTrips(trips, storage) {
  const s = store(storage);
  const clean = (trips || []).map(t => normalizeTrip(t));
  if (s) {
    try { s.setItem(MILEAGE_KEY, JSON.stringify(clean)); } catch (e) { /* quota */ }
  }
  return clean;
}

export function addTrip(partial, storage, at = Date.now()) {
  const rateInfo = mileageRateFor(partial.date || at, getSettings(storage));
  const trip = normalizeTrip({
    rate: partial.rate != null ? partial.rate : rateInfo.rate,
    rateSource: partial.rateSource || rateInfo.source,
    ...partial
  }, at);
  const trips = [trip, ...getTrips(storage).filter(t => t.id !== trip.id)];
  setTrips(trips, storage);
  return trip;
}

export function removeTrip(id, storage) {
  const trips = getTrips(storage).filter(t => t.id !== id);
  setTrips(trips, storage);
  return trips;
}

export function clearTrips(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(MILEAGE_KEY); } catch (e) {}
}

export function getReminders(storage) {
  const s = store(storage);
  if (!s) return {};
  try {
    const raw = s.getItem(REMIND_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) { return {}; }
}

export function setReminder(itemId, at, storage) {
  const s = store(storage);
  const all = getReminders(s);
  all[itemId] = { lastAt: at };
  if (s) {
    try { s.setItem(REMIND_KEY, JSON.stringify(all)); } catch (e) {}
  }
  return all[itemId];
}

export function clearReminders(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(REMIND_KEY); } catch (e) {}
}

export { SETTINGS_KEY, MILEAGE_KEY, REMIND_KEY };
