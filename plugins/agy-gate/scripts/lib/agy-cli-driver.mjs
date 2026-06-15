import { spawn as nodeSpawn } from "node:child_process";
import { wrap as sandboxWrapDefault } from "./agy-sandbox.mjs";
import { assertGemini, resolveModel } from "./models.mjs";

/**
 * @typedef {{ code: string, message: string, remediation?: string }} ErrorEnvelope
 * @typedef {{ ok: true, payload: unknown } | { ok: false, error: ErrorEnvelope }} ReviewResult
 */

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Force the Antigravity subscription login: strip any inherited Gemini/Google API
 * key and the Vertex flag (an exported key would silently bill the API and defeat
 * the subscription-only premise; §6.3). Non-mutating.
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string|undefined>}
 */
export function stripApiKeys(env) {
  const out = { ...env };
  delete out.GEMINI_API_KEY;
  delete out.GOOGLE_API_KEY;
  delete out.GOOGLE_GENAI_USE_VERTEXAI;
  return out;
}

/**
 * Map a thrown/observed transport error to a structured §8 envelope.
 * @param {unknown} err
 * @returns {ErrorEnvelope}
 */
export function classifyError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const low = message.toLowerCase();
  if (low.includes("enoent") || low.includes("command not found")) {
    return {
      code: "AGY_NOT_INSTALLED",
      message,
      remediation: "Install the Antigravity CLI (`agy`) and run it once to log in.",
    };
  }
  if (
    low.includes("429") ||
    low.includes("rate limit") ||
    low.includes("too many requests") ||
    low.includes("quota")
  ) {
    return {
      code: "RATE_LIMITED",
      message,
      remediation: "Wait for the cooldown, then retry; consider lowering automated review volume.",
    };
  }
  if (
    low.includes("401") ||
    low.includes("unauthorized") ||
    low.includes("not logged in") ||
    low.includes("login")
  ) {
    return {
      code: "AUTH_REQUIRED",
      message,
      remediation: "Run `agy login` to authenticate to your Antigravity (Gemini) subscription.",
    };
  }
  if (
    low.includes("model") &&
    (low.includes("not found") || low.includes("unavailable") || low.includes("unknown"))
  ) {
    return {
      code: "MODEL_UNAVAILABLE",
      message,
      remediation: "Pick a supported Gemini model via --model or userConfig.reviewModel.",
    };
  }
  if (low.includes("timed out") || low.includes("timeout")) return { code: "TIMEOUT", message };
  return { code: "CLI_ERROR", message };
}

/**
 * Tolerant JSON extraction: strip markdown fences / leading prose defensively,
 * then JSON.parse. Returns null when nothing parseable is found.
 * @param {string} raw
 * @returns {unknown|null}
 */
export function tolerantParse(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const candidates = [text];
  // ```json ... ``` or ``` ... ``` fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  // first {...} or [...] span
  const span = text.match(/[{[][\s\S]*[}\]]/);
  if (span) candidates.push(span[0]);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Default progress sink: stderr, so structured stdout stays clean. */
function defaultProgress(/** @type {string} */ line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Create the CLI-backed agy driver (sole transport — OD-5). Collaborators are
 * injected so the orchestration is unit-testable without spawning real `agy`.
 * @param {{
 *   spawn?: typeof nodeSpawn,
 *   sandboxWrap?: typeof sandboxWrapDefault,
 *   env?: Record<string, string|undefined>,
 *   validate: (kind: any, payload: unknown, opts: any) => Promise<{ ok: boolean, value?: unknown, code?: string }>,
 *   dataDir?: string|null,
 *   onProgress?: (line: string) => void,
 *   timeoutMs?: number,
 *   platform?: NodeJS.Platform,
 * }} deps
 */
export function createCliDriver({
  spawn = nodeSpawn,
  sandboxWrap = sandboxWrapDefault,
  env = process.env,
  validate,
  dataDir = process.env.CLAUDE_PLUGIN_DATA ?? null,
  onProgress = defaultProgress,
  timeoutMs = Number(process.env.AGY_GATE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  platform = process.platform,
}) {
  return {
    /**
     * @param {{ kind: "review"|"adversarial", prompt: string, workingDirectory: string, skipGitRepoCheck?: boolean, model?: string }} req
     * @returns {Promise<ReviewResult>}
     */
    async review({ kind, prompt, workingDirectory, model }) {
      // 1. Pin a Gemini model — reject Claude/GPT-OSS BEFORE spending a call (§6.2).
      const resolved = resolveModel(model ?? null);
      const fam = assertGemini(resolved);
      if (!fam.ok) return { ok: false, error: fam.error };

      // 2. Wrap the spawn in the OS read-only sandbox — never run unsandboxed (§10).
      const timeoutSec = Math.round(timeoutMs / 1000);
      const argv = [
        "agy",
        "--print",
        prompt,
        "--model",
        resolved,
        "--print-timeout",
        `${timeoutSec}s`,
      ];
      const wrapped = sandboxWrap(argv, { projectDir: workingDirectory, platform, env });
      if (!wrapped.ok) return { ok: false, error: wrapped.error };

      // 3. Spawn with the API-key-stripped env (subscription forced; §6.3).
      let stdout = "";
      let stderr = "";
      const result = await new Promise((resolve) => {
        let settled = false;
        const child = spawn(wrapped.command, wrapped.args, {
          cwd: workingDirectory,
          env: stripApiKeys(env),
          stdio: ["ignore", "pipe", "pipe"],
        });
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
          resolve({ kind: "timeout" });
        }, timeoutMs);
        child.stdout?.on("data", (d) => {
          stdout += d.toString();
        });
        child.stderr?.on("data", (d) => {
          stderr += d.toString();
          onProgress(d.toString().trimEnd());
        });
        child.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "spawn-error", err });
        });
        child.on("close", (code, signal) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "closed", code, signal });
        });
      });

      if (result.kind === "timeout") {
        return {
          ok: false,
          error: {
            code: "TIMEOUT",
            message: `agy review timed out after ${timeoutMs}ms.`,
            remediation:
              "Raise userConfig.reviewTimeoutMs or narrow the review scope (fewer files / a tighter --base).",
          },
        };
      }
      if (result.kind === "spawn-error") {
        return { ok: false, error: classifyError(result.err) };
      }

      // 4. Nonzero exit → classify from stderr (rate-limit/auth/etc.).
      if (result.code !== 0) {
        return {
          ok: false,
          error: classifyError(new Error(stderr || `agy exited with code ${result.code}`)),
        };
      }

      // 5. Empty stdout + exit 0 → the non-TTY drop bug (SP-1 caveat). NEVER an approval.
      if (!stdout.trim()) {
        return {
          ok: false,
          error: {
            code: "CLI_ERROR",
            message:
              "agy returned empty output on exit 0 (non-TTY response drop) — treated as unavailable, never an approval.",
            remediation: "Retry; if persistent, run /agy-gate:setup to re-check the agy login.",
          },
        };
      }

      // 6. Tolerant-parse the JSON, then validate against the draft-07 schema.
      const parsed = tolerantParse(stdout);
      if (parsed === null) {
        return {
          ok: false,
          error: { code: "CLI_ERROR", message: "agy returned an unparseable (non-JSON) payload." },
        };
      }
      const validated = await validate(kind, parsed, { dataDir });
      if (!validated.ok) {
        return {
          ok: false,
          error: {
            code: "SCHEMA_INVALID",
            message: "agy payload failed schema validation after normalization.",
          },
        };
      }
      return { ok: true, payload: validated.value };
    },
  };
}
