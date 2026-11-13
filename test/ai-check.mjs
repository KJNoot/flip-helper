// One tiny real OpenAI vision check. Pass the key file as argv[1] or OPENAI_API_KEY_FILE.
// Never prints the key. Writes a short result summary (no secrets) to stdout and test/out/ai-check.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson, normalizeDraft, AI_MODEL } from "../app/js/core/draft.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const keyFile = process.env.OPENAI_API_KEY_FILE || process.argv[2];
if (!keyFile) {
  console.error("Usage: OPENAI_API_KEY_FILE=/path/to/key node test/ai-check.mjs");
  process.exit(2);
}

function readKey(p) {
  let raw;
  try { raw = readFileSync(p, "utf8"); }
  catch (e) {
    console.error("Could not read the key file.");
    process.exit(1);
  }
  // Accept a bare key, or a single KEY= / OPENAI_API_KEY= line. Never log the value.
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  let v = lines[0] || "";
  const eq = v.match(/^(?:OPENAI_API_KEY|KEY|API_KEY)\s*=\s*(.*)$/);
  if (eq) v = eq[1].trim().replace(/^["']|["']$/g, "");
  if (!v) { console.error("The key file was empty."); process.exit(1); }
  return v;
}

const key = readKey(keyFile);
const mug = readFileSync(join(HERE, "fixtures/mug.png"));
const dataUrl = "data:image/png;base64," + mug.toString("base64");

const body = {
  model: AI_MODEL,
  response_format: { type: "json_object" },
  temperature: 0,
  max_tokens: 500,
  messages: [
    {
      role: "system",
      content: "Look at the photo and reply with a JSON object only, keys: title, description, category, condition, brand, priceLow, priceHigh, priceReason (short), siteTweaks (optional). Prices are rough USD estimates, not from sold listings. Be honest."
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Draft a short listing for this item." },
        { type: "image_url", image_url: { url: dataUrl, detail: "low" } }
      ]
    }
  ]
};

const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
  body: JSON.stringify(body)
});
const raw = await res.text();
// Strip any accidental key leakage from the body before we even parse logs
const sanitized = raw.includes(key) ? raw.split(key).join("[redacted]") : raw;
if (!res.ok) {
  console.error("AI check failed:", res.status, sanitized.slice(0, 300));
  process.exit(1);
}
const payload = JSON.parse(sanitized);
const text = payload.choices?.[0]?.message?.content || "";
const draft = normalizeDraft(extractJson(text));
const usage = payload.usage || {};
const inTok = usage.prompt_tokens || 0;
const outTok = usage.completion_tokens || 0;
// Published gpt-4o-mini rates as commonly listed (USD per 1M tokens).
const IN_RATE = 0.15, OUT_RATE = 0.60;
const cost = (inTok * IN_RATE + outTok * OUT_RATE) / 1e6;

const result = {
  ok: true,
  model: payload.model || AI_MODEL,
  title: draft.title,
  brand: draft.brand,
  category: draft.category,
  condition: draft.condition,
  priceLow: draft.priceLow,
  priceHigh: draft.priceHigh,
  priceReason: draft.priceReason,
  descriptionPreview: String(draft.description || "").slice(0, 240),
  sawLakeview: /lakeview/i.test(JSON.stringify(draft)),
  usage: { prompt_tokens: inTok, completion_tokens: outTok },
  costUsd: Number(cost.toFixed(6)),
  costRates: { inputPerMillion: IN_RATE, outputPerMillion: OUT_RATE, model: AI_MODEL },
  underBudget: cost < 0.05
};

mkdirSync(join(HERE, "out"), { recursive: true });
writeFileSync(join(HERE, "out/ai-check.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.underBudget) {
  console.error("Cost was over the $0.05 budget.");
  process.exit(1);
}
