import assert from "node:assert/strict";
import { test } from "node:test";
import { wrap } from "./agy-sandbox.mjs";

const ARGV = ["agy", "--print", "hello", "--model", "Gemini 3.1 Pro (High)"];

test("macOS branch emits sandbox-exec with -D PROJECT_DIR + -f profile + the argv", () => {
  const r = wrap(ARGV, {
    projectDir: "/tmp/proj",
    platform: "darwin",
    realpath: (p) => (p === "/tmp/proj" ? "/private/tmp/proj" : p),
    binExists: () => true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.command, "sandbox-exec");
  // -D PROJECT_DIR uses the RESOLVED real path (Seatbelt matches resolved paths).
  assert.ok(r.args.includes("-D"));
  assert.ok(r.args.includes("PROJECT_DIR=/private/tmp/proj"));
  assert.ok(r.args.includes("-f"));
  // the profile path is bundled and ends in readonly.sb
  const profileIdx = r.args.indexOf("-f") + 1;
  assert.match(r.args[profileIdx], /readonly\.sb$/);
  // the original argv is appended intact, in order
  assert.deepEqual(r.args.slice(-ARGV.length), ARGV);
});

test("Linux branch emits bwrap with ro-bind, gemini state bind, share-net, chdir + argv", () => {
  const r = wrap(ARGV, {
    projectDir: "/home/u/proj",
    platform: "linux",
    home: "/home/u",
    realpath: (p) => p,
    binExists: () => true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.command, "bwrap");
  const j = r.args.join(" ");
  assert.match(j, /--ro-bind \/ \//);
  assert.match(j, /--bind \/home\/u\/\.gemini \/home\/u\/\.gemini/);
  assert.match(j, /--share-net/);
  assert.match(j, /--chdir \/home\/u\/proj/);
  // argv comes after the `--` separator
  const sep = r.args.indexOf("--");
  assert.ok(sep > 0);
  assert.deepEqual(r.args.slice(sep + 1), ARGV);
});

test("returns SANDBOX_UNAVAILABLE when the platform sandbox binary is missing", () => {
  const r = wrap(ARGV, { projectDir: "/tmp/proj", platform: "darwin", realpath: (p) => p, binExists: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SANDBOX_UNAVAILABLE");
  assert.ok(r.error.remediation);
});

test("returns SANDBOX_UNAVAILABLE on an unsupported platform (no unsandboxed run)", () => {
  const r = wrap(ARGV, { projectDir: "/tmp/proj", platform: "win32", realpath: (p) => p, binExists: () => true });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SANDBOX_UNAVAILABLE");
});
