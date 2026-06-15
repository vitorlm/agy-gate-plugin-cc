import assert from "node:assert/strict";
import { test } from "node:test";
import { createDriver } from "./agy-driver.mjs";

test("createDriver wires a working driver that validates a real payload", async () => {
  const VALID = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };
  // Inject a fake spawn via the seam's passthrough options.
  const { EventEmitter } = await import("node:events");
  const fakeChild = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => {};
    queueMicrotask(() => { c.stdout.emit("data", JSON.stringify(VALID)); c.emit("close", 0, null); });
    return c;
  };
  const driver = createDriver({
    dataDir: null,
    spawn: () => fakeChild(),
    sandboxWrap: (argv) => ({ ok: true, command: "sandbox-exec", args: argv }),
    env: { PATH: "/bin" },
  });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, VALID);
});
