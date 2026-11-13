// Private invite-only terms gate. The public site stays unchanged.
// Only a SHA-256 hash of the invite token is stored here — never the token,
// last names, emails, or the written agreement.

export const TERMS_VERSION = "1";
export const TERMS_KEY = "flip-helper.termsAccepted";
export const INVITE_SEEN_KEY = "flip-helper.inviteSeen";
export const INVITE_TOKEN_SHA256 = "2c82eb657c5e27a55a19b6b29668091a824e86a9b5862c590b969113bfb7d791";
export const TERMS_MAILTO_TO = "kens.remi@mail.grokbot.com";
export const TERMS_MAILTO_SUBJECT = "Flip Side: I agree to the terms";
export const TERMS_TITLE = "Before we start";

export const TERMS_POINTS = [
  "You and Teddy get half of the app's profit every three months, and half if the app is ever sold.",
  "Ken carries all the costs and losses, and you never owe anything.",
  "Your ideas go into the app, and your share is your thanks for them.",
  "It lasts as long as the app makes money, and it passes to your family."
];

export const TERMS_FULL_NOTE = "The full written agreement will come separately for everyone to sign.";
export const TERMS_CHECK_LABEL = "I've read this and I agree";

function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("SHA-256 is not available");
  const buf = await subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function parseInviteToken(search = "") {
  const raw = String(search || "");
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  const hashIdx = q.indexOf("#");
  const query = hashIdx >= 0 ? q.slice(0, hashIdx) : q;
  try {
    return (new URLSearchParams(query).get("invite") || "").trim();
  } catch (e) {
    return "";
  }
}

export async function tokenMatches(token, expectedHash = INVITE_TOKEN_SHA256) {
  const value = String(token || "").trim();
  const want = String(expectedHash || "").trim().toLowerCase();
  if (!value || !want) return false;
  try {
    const got = (await sha256Hex(value)).toLowerCase();
    return got === want;
  } catch (e) {
    return false;
  }
}

export async function isValidInvite(search, expectedHash = INVITE_TOKEN_SHA256) {
  return tokenMatches(parseInviteToken(search), expectedHash);
}

export function termsAccepted(storage) {
  const rec = getAcceptance(storage);
  return !!(rec && rec.name && rec.acceptedAt && rec.version);
}

export function getAcceptance(storage) {
  const s = store(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(TERMS_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || typeof rec !== "object") return null;
    const name = String(rec.name || "").trim();
    const acceptedAt = String(rec.acceptedAt || rec.at || "").trim();
    const version = String(rec.version || "").trim();
    if (!name || !acceptedAt || !version) return null;
    return { name, acceptedAt, version };
  } catch (e) {
    return null;
  }
}

export function setTermsAccepted({ name, acceptedAt, version } = {}, storage) {
  const s = store(storage);
  if (!s) return null;
  const rec = {
    name: String(name || "").trim(),
    acceptedAt: String(acceptedAt || new Date().toISOString()),
    version: String(version || TERMS_VERSION)
  };
  if (!rec.name) return null;
  try {
    s.setItem(TERMS_KEY, JSON.stringify(rec));
    s.setItem(INVITE_SEEN_KEY, "1");
  } catch (e) { /* quota */ }
  return rec;
}

export function inviteSeen(storage) {
  const s = store(storage);
  if (!s) return false;
  try { return s.getItem(INVITE_SEEN_KEY) === "1" || termsAccepted(s); } catch (e) { return false; }
}

export function setInviteSeen(seen = true, storage) {
  const s = store(storage);
  if (!s) return;
  try {
    if (seen) s.setItem(INVITE_SEEN_KEY, "1");
    else s.removeItem(INVITE_SEEN_KEY);
  } catch (e) { /* quota */ }
}

export function clearTerms(storage) {
  const s = store(storage);
  if (!s) return;
  try {
    s.removeItem(TERMS_KEY);
    s.removeItem(INVITE_SEEN_KEY);
  } catch (e) { /* ignore */ }
}

export function shouldShowTermsInSettings(storage) {
  return inviteSeen(storage) || termsAccepted(storage);
}

/**
 * Show the agreement step only for a valid invite token, and only until accepted.
 * Public visits (no token or a bad token) never see it.
 */
export async function shouldShowTermsGate(storage, opts = {}) {
  if (opts.quiet) return false;
  const search = opts.search != null ? opts.search : "";
  if (search && /[?&]noterms\b/.test(String(search))) return false;
  if (termsAccepted(storage)) return false;
  return isValidInvite(search, opts.expectedHash || INVITE_TOKEN_SHA256);
}

export async function rememberInviteIfValid(search, storage, expectedHash) {
  if (await isValidInvite(search, expectedHash)) {
    setInviteSeen(true, storage);
    return true;
  }
  return false;
}

export function canAgree({ agreed, name } = {}) {
  return !!agreed && String(name || "").trim().length > 0;
}

export function formatAcceptedAt(iso, now = new Date()) {
  const d = iso ? new Date(iso) : now;
  if (Number.isNaN(d.getTime())) return String(iso || "");
  try {
    return d.toISOString();
  } catch (e) {
    return String(iso || "");
  }
}

export function agreeMailto({ name, acceptedAt, version } = {}) {
  const body = [
    "I agree to the Flip Side terms.",
    "",
    `Name: ${String(name || "").trim()}`,
    `Date: ${formatAcceptedAt(acceptedAt)}`,
    `Terms version: ${String(version || TERMS_VERSION)}`
  ].join("\n");
  return `mailto:${TERMS_MAILTO_TO}?subject=${encodeURIComponent(TERMS_MAILTO_SUBJECT)}&body=${encodeURIComponent(body)}`;
}
