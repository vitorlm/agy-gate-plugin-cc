import assert from "node:assert/strict";
import { test } from "node:test";
import { assertGemini, DEFAULT_MODEL, resolveModel } from "./models.mjs";

test("resolveModel with no input returns the default Gemini model", () => {
  assert.equal(resolveModel(), DEFAULT_MODEL);
  assert.equal(resolveModel(null), DEFAULT_MODEL);
  assert.equal(resolveModel(""), DEFAULT_MODEL);
  assert.match(DEFAULT_MODEL, /^Gemini/);
});

test("resolveModel expands the 'pro' and 'flash' aliases to Gemini models", () => {
  assert.match(resolveModel("pro"), /^Gemini 3\.1 Pro/);
  assert.match(resolveModel("flash"), /^Gemini 3\.5 Flash/);
});

test("resolveModel passes through an explicit Gemini model id", () => {
  assert.equal(resolveModel("Gemini 3.1 Pro (High)"), "Gemini 3.1 Pro (High)");
});

test("assertGemini accepts a Gemini-family model", () => {
  assert.equal(assertGemini("Gemini 3.1 Pro (High)").ok, true);
});

test("assertGemini rejects a non-Gemini model with MODEL_UNAVAILABLE (defends §0)", () => {
  const r = assertGemini("Claude Sonnet 4.6");
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "MODEL_UNAVAILABLE");
  assert.match(r.error.message, /cross-family/i);
});
