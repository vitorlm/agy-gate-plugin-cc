import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { classifyError, createCliDriver, stripApiKeys } from "./agy-cli-driver.mjs";
import { validate } from "./review-schema.mjs";

const VALID_REVIEW = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };

/** A fake child process that emits stdout then closes with a code. */
function fakeChild({ stdout = "", stderr = "", code = 0, signal = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code, signal);
  });
  return child;
}

/** Build a driver with injected spawn + sandbox + validator. */
function makeDriver({ child, sandboxOk = true, env = { PATH: "/bin" } } = {}) {
  const calls = { spawnCommand: null, spawnArgs: null, spawnOpts: null, wrapped: null };
  const spawn = (command, args, opts) => {
    calls.spawnCommand = command;
    calls.spawnArgs = args;
    calls.spawnOpts = opts;
    return child ?? fakeChild({ stdout: JSON.stringify(VALID_REVIEW) });
  };
  const sandboxWrap = (argv, o) => {
    calls.wrapped = { argv, o };
    return sandboxOk
      ? {
          ok: true,
          command: "sandbox-exec",
          args: ["-D", "PROJECT_DIR=/repo", "-f", "p.sb", ...argv],
        }
      : {
          ok: false,
          error: { code: "SANDBOX_UNAVAILABLE", message: "no sandbox", remediation: "install" },
        };
  };
  const driver = createCliDriver({
    spawn,
    sandboxWrap,
    env,
    validate,
    onProgress: () => {},
    timeoutMs: 300_000,
  });
  return { driver, calls };
}

test("stripApiKeys removes Gemini/Google keys + Vertex flag, non-mutating", () => {
  const env = {
    GEMINI_API_KEY: "g",
    GOOGLE_API_KEY: "x",
    GOOGLE_GENAI_USE_VERTEXAI: "1",
    PATH: "/bin",
  };
  const out = stripApiKeys(env);
  assert.equal("GEMINI_API_KEY" in out, false);
  assert.equal("GOOGLE_API_KEY" in out, false);
  assert.equal("GOOGLE_GENAI_USE_VERTEXAI" in out, false);
  assert.equal(out.PATH, "/bin");
  assert.equal(env.GEMINI_API_KEY, "g"); // original untouched
});

test("review spawns the sandboxed command with a stripped env and the project cwd", async () => {
  const { driver, calls } = makeDriver({ env: { GEMINI_API_KEY: "g", PATH: "/bin" } });
  await driver.review({
    kind: "review",
    prompt: "p",
    workingDirectory: "/repo",
    model: "Gemini 3.1 Pro (High)",
  });
  assert.equal(calls.spawnCommand, "sandbox-exec");
  assert.equal("GEMINI_API_KEY" in calls.spawnOpts.env, false);
  assert.equal(calls.spawnOpts.cwd, "/repo");
  // argv passed to the sandbox includes agy --print + the pinned model
  const j = calls.wrapped.argv.join(" ");
  assert.match(j, /agy --print/);
  assert.match(j, /Gemini 3\.1 Pro \(High\)/);
});

test("review happy path returns a validated payload and NO usage field", async () => {
  const { driver } = makeDriver({ child: fakeChild({ stdout: JSON.stringify(VALID_REVIEW) }) });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, VALID_REVIEW);
  assert.equal("usage" in r, false);
});

test("review tolerantly parses JSON wrapped in markdown fences", async () => {
  const fenced = `\`\`\`json\n${JSON.stringify(VALID_REVIEW)}\n\`\`\``;
  const { driver } = makeDriver({ child: fakeChild({ stdout: fenced }) });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, true);
});

test("review treats empty stdout + exit 0 as CLI_ERROR (non-TTY drop bug), never approves", async () => {
  const { driver } = makeDriver({ child: fakeChild({ stdout: "", code: 0 }) });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CLI_ERROR");
});

test("review maps unparseable stdout to CLI_ERROR", async () => {
  const { driver } = makeDriver({ child: fakeChild({ stdout: "total garbage no json" }) });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CLI_ERROR");
});

test("review maps a schema-invalid payload to SCHEMA_INVALID", async () => {
  const bad = JSON.stringify({ ...VALID_REVIEW, verdict: "lgtm" });
  const { driver } = makeDriver({ child: fakeChild({ stdout: bad }) });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SCHEMA_INVALID");
});

test("review returns SANDBOX_UNAVAILABLE and never spawns when the sandbox is missing", async () => {
  const { driver, calls } = makeDriver({ sandboxOk: false });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SANDBOX_UNAVAILABLE");
  assert.equal(calls.spawnCommand, null); // never spawned unsandboxed
});

test("review rejects a non-Gemini model with MODEL_UNAVAILABLE and never spawns", async () => {
  const { driver, calls } = makeDriver({});
  const r = await driver.review({
    kind: "review",
    prompt: "p",
    workingDirectory: "/repo",
    model: "Claude Sonnet 4.6",
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "MODEL_UNAVAILABLE");
  assert.equal(calls.spawnCommand, null);
});

test("review maps a nonzero exit with rate-limit stderr to RATE_LIMITED", async () => {
  const { driver } = makeDriver({
    child: fakeChild({ stdout: "", stderr: "429 rate limit", code: 1 }),
  });
  const r = await driver.review({ kind: "review", prompt: "p", workingDirectory: "/repo" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "RATE_LIMITED");
});

test("classifyError maps known transport errors", () => {
  assert.equal(classifyError(new Error("429 too many requests")).code, "RATE_LIMITED");
  assert.equal(classifyError(new Error("401 unauthorized")).code, "AUTH_REQUIRED");
  assert.equal(classifyError(new Error("ENOENT spawn agy")).code, "AGY_NOT_INSTALLED");
  assert.equal(classifyError(new Error("something else")).code, "CLI_ERROR");
});
