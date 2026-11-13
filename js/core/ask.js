// "Ask a question" helper. Uses the device-held key and gpt-4o-mini.
// The key is never logged. Answers are short and plain.
import { getKey } from "./key.js";
import { extractJson, friendlyApiError, AI_MODEL } from "./draft.js";
import { FEATURE_GUIDE, ASK_SYSTEM } from "./guide.js";

export const ASK_MODEL = AI_MODEL; // gpt-4o-mini
export const ASK_NO_KEY = "To ask a question, paste the AI key in Settings first. It stays on this phone only.";
export const ASK_WELCOME = "Ask how to do something in Jessica's Flip Side, or a selling question. I'll give a short, plain answer, and I'll tell you which button to tap.";

export function normalizeAsk(raw = {}) {
  const answer = String(raw.answer || raw.text || raw.reply || "").trim();
  const featureRequest = raw.featureRequest === true || raw.feature_request === true || raw.featureRequest === "true";
  const suggestion = String(raw.suggestion || raw.suggestionText || "").trim();
  return {
    answer: answer || "I couldn't put an answer together. Try asking in a different way.",
    featureRequest,
    suggestion: featureRequest ? suggestion : ""
  };
}

/**
 * Ask a how-to or selling question. `history` is prior {role, content} pairs
 * (no keys, no photos). `screen` and `version` are passed to the model.
 */
export async function askQuestion({
  question,
  screen = "",
  version = "",
  history = [],
  key,
  fetchImpl,
  model = ASK_MODEL
} = {}) {
  const q = String(question || "").trim();
  if (!q) {
    const err = new Error("Type a question first.");
    err.code = "no-question";
    throw err;
  }
  const k = (key != null ? key : getKey()).trim();
  if (!k) {
    const err = new Error(ASK_NO_KEY);
    err.code = "no-key";
    throw err;
  }
  const context = [
    `App version: ${version || "unknown"}.`,
    `The person is on this screen: ${screen || "unknown"}.`,
    "",
    "Guide to the app:",
    FEATURE_GUIDE
  ].join("\n");
  const messages = [
    { role: "system", content: ASK_SYSTEM },
    { role: "system", content: context }
  ];
  for (const h of (history || []).slice(-6)) {
    if (!h || !h.content) continue;
    const role = h.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: String(h.content).slice(0, 1500) });
  }
  messages.push({ role: "user", content: q });

  const fetchFn = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + k
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 400,
        messages
      })
    });
  } catch (e) {
    const err = new Error("Couldn't reach the helper. Check your connection and try again.");
    err.code = "network";
    throw err;
  }
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(friendlyApiError(res.status, raw));
    err.code = "http-" + res.status;
    throw err;
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { throw new Error("The answer wasn't in a form we could use. Try again."); }
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content : "";
  const parsed = normalizeAsk(extractJson(text));
  return { ...parsed, usage: payload.usage || null, model: payload.model || model };
}

export { FEATURE_GUIDE, ASK_SYSTEM };
