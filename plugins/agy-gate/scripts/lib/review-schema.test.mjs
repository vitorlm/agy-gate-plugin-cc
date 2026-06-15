import assert from "node:assert/strict";
import { test } from "node:test";
import { validate } from "./review-schema.mjs";

const VALID_REVIEW = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };
const VALID_ADVERSARIAL = { verdict: "sound", summary: "ok", challenges: [] };

test("validate accepts a valid review payload", async () => {
  const r = await validate("review", VALID_REVIEW, { dataDir: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, VALID_REVIEW);
});

test("validate accepts a valid adversarial payload", async () => {
  const r = await validate("adversarial", VALID_ADVERSARIAL, { dataDir: null });
  assert.equal(r.ok, true);
});

test("validate rejects a bad verdict enum with SCHEMA_INVALID", async () => {
  const r = await validate("review", { ...VALID_REVIEW, verdict: "lgtm" }, { dataDir: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, "SCHEMA_INVALID");
});

test("validate rejects a payload missing a required field", async () => {
  const r = await validate("review", { verdict: "approve", summary: "x" }, { dataDir: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, "SCHEMA_INVALID");
});

test("tolerant normalization strips unknown top-level keys (additionalProperties:false)", async () => {
  const r = await validate("review", { ...VALID_REVIEW, extraneous: "garbage" }, { dataDir: null });
  assert.equal(r.ok, true);
  assert.equal("extraneous" in r.value, false);
});

test("validate throws on an unknown kind", async () => {
  await assert.rejects(() => validate("nope", VALID_REVIEW, { dataDir: null }), /unknown schema kind/);
});
