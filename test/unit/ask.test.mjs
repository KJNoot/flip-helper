import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, normalizeAsk, ASK_NO_KEY, ASK_WELCOME, ASK_MODEL } from "../../app/js/core/ask.js";
import { FEATURE_GUIDE, ASK_SYSTEM } from "../../app/js/core/guide.js";
import { WALKTHROUGH_SCREENS, walkthroughDone, setWalkthroughDone, shouldShowWalkthrough, WALKTHROUGH_KEY } from "../../app/js/core/walkthrough.js";

describe("ask helper", () => {
  it("normalizes a short answer and a feature-request flag", () => {
    const a = normalizeAsk({ answer: "Tap Save this item.", featureRequest: true, suggestion: "Please add a dark mode." });
    assert.equal(a.answer, "Tap Save this item.");
    assert.equal(a.featureRequest, true);
    assert.equal(a.suggestion, "Please add a dark mode.");
    const b = normalizeAsk({ text: "  Open Settings.  " });
    assert.equal(b.answer, "Open Settings.");
    assert.equal(b.featureRequest, false);
    assert.equal(b.suggestion, "");
    const c = normalizeAsk({});
    assert.match(c.answer, /couldn't put an answer|try asking/i);
  });

  it("tells her to open Settings when there is no key, and does not call the network", async () => {
    let called = 0;
    await assert.rejects(
      () => askQuestion({ question: "How do I save?", key: "", fetchImpl: () => { called += 1; } }),
      e => e.code === "no-key" && e.message === ASK_NO_KEY
    );
    assert.equal(called, 0);
    assert.match(ASK_NO_KEY, /Settings/);
    assert.match(ASK_WELCOME, /which button/i);
  });

  it("asks for a question before calling the API", async () => {
    let called = 0;
    await assert.rejects(
      () => askQuestion({ question: "   ", key: "sk-test", fetchImpl: () => { called += 1; } }),
      e => e.code === "no-question"
    );
    assert.equal(called, 0);
  });

  it("sends the screen, version, and guide, and returns a parsed answer, without putting the key in the body", async () => {
    let captured;
    const fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: "gpt-4o-mini",
          usage: { prompt_tokens: 20, completion_tokens: 10 },
          choices: [{ message: { content: JSON.stringify({
            answer: "On this item, tap Take them all down automatically. That walks you through each site.",
            featureRequest: false,
            suggestion: ""
          }) } }]
        })
      };
    };
    const res = await askQuestion({
      question: "How do I take a listing down?",
      screen: "Item",
      version: "0.3.0",
      key: "sk-secret-test-key-not-real",
      fetchImpl
    });
    assert.match(res.answer, /Take them all down automatically/);
    assert.equal(res.featureRequest, false);
    assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, ASK_MODEL);
    assert.equal(body.model, "gpt-4o-mini");
    const blob = JSON.stringify(body);
    assert.doesNotMatch(blob, /sk-secret-test-key-not-real/);
    assert.match(blob, /App version: 0\.3\.0/);
    assert.match(blob, /The person is on this screen: Item/);
    assert.match(blob, /Take them all down automatically/);
    const auth = captured.opts.headers.Authorization;
    assert.equal(auth, "Bearer sk-secret-test-key-not-real");
  });

  it("flags a feature request so the UI can offer Send this as a suggestion", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"answer":"That isn\'t built yet. I can send this as a suggestion.","featureRequest":true,"suggestion":"Please add a barcode scanner."}' } }]
      })
    });
    const res = await askQuestion({ question: "Can you scan barcodes?", key: "sk-x", fetchImpl });
    assert.equal(res.featureRequest, true);
    assert.match(res.suggestion, /barcode/);
  });
});

describe("built-in feature guide", () => {
  it("names the main buttons and screens so answers can be exact", () => {
    assert.match(FEATURE_GUIDE, /Ask a question/);
    assert.match(FEATURE_GUIDE, /Take them all down automatically/);
    assert.match(FEATURE_GUIDE, /Make a draft from the photo/);
    assert.match(FEATURE_GUIDE, /Mark as sold/);
    assert.match(FEATURE_GUIDE, /Buy or pass/);
    assert.match(FEATURE_GUIDE, /Send a suggestion/);
    assert.match(FEATURE_GUIDE, /Settings/);
    assert.match(ASK_SYSTEM, /featureRequest/);
    assert.match(ASK_SYSTEM, /short/i);
  });
});

describe("first-run walkthrough", () => {
  it("has four short, skippable screens", () => {
    assert.equal(WALKTHROUGH_SCREENS.length, 4);
    const titles = WALKTHROUGH_SCREENS.map(s => s.title).join(" ");
    assert.match(titles, /Welcome/);
    assert.match(titles, /photo/i);
    assert.match(titles, /List|sold|take it down/i);
    assert.match(titles, /Help|Ask/i);
    for (const s of WALKTHROUGH_SCREENS) {
      assert.ok(s.body.length < 500, "keep each screen short");
    }
  });

  it("remembers when she has finished or skipped it", () => {
    const mem = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
    assert.equal(shouldShowWalkthrough(mem), true);
    assert.equal(walkthroughDone(mem), false);
    setWalkthroughDone(true, mem);
    assert.equal(mem.getItem(WALKTHROUGH_KEY), "1");
    assert.equal(shouldShowWalkthrough(mem), false);
    setWalkthroughDone(false, mem);
    assert.equal(shouldShowWalkthrough(mem), true);
  });
});
