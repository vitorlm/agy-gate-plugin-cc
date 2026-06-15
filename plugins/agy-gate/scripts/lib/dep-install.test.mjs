import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureDeps, PINNED_DEPS, PINNED_SPECS } from "./dep-install.mjs";

test("PINNED_SPECS is ajv only (no SDK)", () => {
  assert.deepEqual(PINNED_SPECS, ["ajv@8.17.1"]);
  assert.equal(PINNED_DEPS.length, 1);
});

test("ensureDeps skips install when already installed", async () => {
  let installed = false;
  const r = await ensureDeps("/data", {
    installed: () => true,
    install: async () => {
      installed = true;
    },
  });
  assert.deepEqual(r, { ok: true, installed: false });
  assert.equal(installed, false);
});

test("ensureDeps installs once when absent", async () => {
  let count = 0;
  const r = await ensureDeps("/data", {
    installed: () => false,
    install: async () => {
      count += 1;
    },
  });
  assert.deepEqual(r, { ok: true, installed: true });
  assert.equal(count, 1);
});

test("ensureDeps returns a CLI_ERROR envelope when install throws", async () => {
  const r = await ensureDeps("/data", {
    installed: () => false,
    install: async () => {
      throw new Error("npm exploded");
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CLI_ERROR");
  assert.match(r.error.message, /ajv@8\.17\.1/);
  assert.ok(r.error.remediation);
});
