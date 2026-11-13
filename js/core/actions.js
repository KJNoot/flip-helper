// Support / history log of actions, especially failures.
// Stored only on this device. Never includes an AI key or photos.
const LOG_KEY = "flip-helper.actionLog";
const MAX = 200;

function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export function newActionId(at = Date.now()) {
  return "ac_" + at.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function normalizeAction(raw = {}, at = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const message = String(raw.message || "").replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[redacted]").trim();
  return {
    id: String(raw.id || newActionId(at)),
    at: raw.at || at,
    kind: String(raw.kind || "action"),
    itemId: String(raw.itemId || ""),
    siteId: String(raw.siteId || ""),
    status: raw.status === "ok" ? "ok" : (raw.status === "skipped" ? "skipped" : "failed"),
    message
  };
}

export function getActionLog(storage) {
  const s = store(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(a => normalizeAction(a)).filter(Boolean);
  } catch (e) { return []; }
}

export function setActionLog(list, storage) {
  const s = store(storage);
  const clean = (list || []).map(a => normalizeAction(a)).filter(Boolean).slice(0, MAX);
  if (s) {
    try { s.setItem(LOG_KEY, JSON.stringify(clean)); } catch (e) { /* quota */ }
  }
  return clean;
}

export function logAction(partial, storage, at = Date.now()) {
  const row = normalizeAction(partial, at);
  const all = [row, ...getActionLog(storage).filter(a => a.id !== row.id)].slice(0, MAX);
  setActionLog(all, storage);
  return row;
}

export function failedActions(storage) {
  return getActionLog(storage).filter(a => a.status === "failed");
}

export function clearActionLog(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(LOG_KEY); } catch (e) {}
}

export function formatActionTime(at) {
  if (!at) return "";
  try {
    return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) { return ""; }
}

export { LOG_KEY };
