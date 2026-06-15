import { probeAuth } from "./auth.mjs";
import { renderError } from "./render.mjs";

/**
 * @typedef {{
 *   stopReviewGate: boolean,
 *   onUnavailable: string,
 *   maxReviewsPerDay: number,
 *   maxIterations: number,
 *   severityThreshold: string,
 *   reviewModel: string|null,
 *   reviewTimeoutMs: number,
 * }} GateConfig
 */

/**
 * Read the *effective* stop-gate / quota config from the env the hooks actually
 * consume. This is the honest single-source-of-truth: the user edits the values via
 * `plugin.json` `userConfig` (the `/plugin` settings UI), Claude Code exports them as
 * env to the hooks, and setup reports what those hooks will see — it does NOT persist
 * a parallel config of its own (which would silently diverge from userConfig).
 * @param {Record<string, string|undefined>} [env]
 * @returns {GateConfig}
 */
export function gateConfigFromEnv(env = process.env) {
  return {
    stopReviewGate: env.AGY_GATE_STOP_REVIEW === "true",
    onUnavailable: env.AGY_GATE_ON_UNAVAILABLE ?? "allow",
    maxReviewsPerDay: Number(env.AGY_MAX_REVIEWS_PER_DAY ?? 0),
    maxIterations: Number(env.AGY_GATE_MAX_ITER ?? 3),
    severityThreshold: env.AGY_GATE_SEVERITY ?? "blocker",
    reviewModel: env.AGY_GATE_MODEL ?? null,
    reviewTimeoutMs: Number(env.AGY_GATE_TIMEOUT_MS) || 300_000,
  };
}

/** @param {GateConfig} c @returns {string} */
function renderGateConfig(c) {
  const lines = [
    "",
    "Stop review-gate (userConfig → env, edit via /plugin):",
    `  stop-gate:          ${c.stopReviewGate ? "enabled (on)" : "disabled (off)"}`,
    `  on-unavailable:     ${c.onUnavailable}`,
    `  maxReviewsPerDay:   ${c.maxReviewsPerDay === 0 ? "0 (no cap)" : c.maxReviewsPerDay}`,
    `  maxIterations:      ${c.maxIterations}`,
    `  severityThreshold:  ${c.severityThreshold}`,
    `  reviewTimeout:      ${Math.round(c.reviewTimeoutMs / 1000)}s`,
  ];
  return lines.join("\n");
}

/**
 * `/agy-gate:setup` core: run the auth probe, ensure the pinned runtime deps are
 * present (pre-install when absent), and report the effective stop-gate config. All
 * side effects (`probe`, `ensureDeps`, `readAuthFile`, clock, output) are injected so
 * this is unit-tested without ever touching agy/network/`~/.gemini`.
 * @param {{
 *   probe: () => Promise<unknown>,
 *   ensureDeps: () => Promise<{ ok: true, installed: boolean } | { ok: false, error: { code: string, message: string, remediation?: string } }>,
 *   readAuthFile?: () => boolean,
 *   config: GateConfig,
 *   write: (s: string) => void,
 * }} deps
 * @returns {Promise<number>} exit code (0 ok / throttled; 1 needs user action)
 */
export async function runSetup({ probe, ensureDeps, readAuthFile, config, write }) {
  const out = (/** @type {string} */ s) => write(`${s}\n`);

  // 1. Runtime dep presence + pre-install (explicit, per §5.4).
  const deps = await ensureDeps();
  if (!deps.ok) {
    out(renderError(deps.error));
    out(renderGateConfig(config));
    return 1;
  }
  out(`Runtime deps: ${deps.installed ? "installed (pinned) just now" : "present"}.`);

  // 2. Auth probe (authoritative auth-vs-throttled distinction, §6.3).
  const auth = await probeAuth({ probe, readAuthFile });
  let code = 0;
  switch (auth.state) {
    case "OK":
      out("Auth: authenticated — a probe call to agy succeeded.");
      break;
    case "AGY_NOT_INSTALLED":
      out("Auth: agy CLI not found.");
      out(`  → ${auth.remediation ?? "Install Antigravity CLI and ensure it is on PATH."}`);
      code = 1;
      break;
    case "AUTH_REQUIRED":
      out("Auth: NOT authenticated.");
      out(`  → ${auth.remediation ?? "Run `agy login` to authenticate."}`);
      code = 1;
      break;
    case "RATE_LIMITED":
      // Load-bearing (§6.3): authenticated but throttled — never "not logged in".
      out("Auth: authenticated but RATE_LIMITED (throttled, not an auth problem).");
      out(`  → ${auth.remediation ?? "Wait for the cooldown, then retry."}`);
      break;
    default:
      out(`Auth: probe failed (${auth.state}): ${auth.message ?? "unknown error"}.`);
      if (auth.remediation) out(`  → ${auth.remediation}`);
      code = 1;
  }
  if (auth.authFilePresent === false && auth.state !== "AUTH_REQUIRED") {
    out("  (note: ~/.gemini/antigravity-cli not found, but the probe is authoritative.)");
  }

  // 3. Effective stop-gate config (the env the hooks read).
  out(renderGateConfig(config));
  return code;
}
