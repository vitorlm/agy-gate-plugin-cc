import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAjv, loadDep } from "./dep-load.mjs";

test("loadAjv resolves the Ajv class via the dev bare-specifier fallback", async () => {
  const Ajv = await loadAjv(null);
  assert.equal(typeof Ajv, "function");
  const ajv = new Ajv();
  assert.equal(typeof ajv.compile, "function");
});

test("loadDep falls back to the bare specifier when dataDir is null", async () => {
  const m = await loadDep(null, "ajv");
  assert.ok(m.Ajv ?? m.default);
});
