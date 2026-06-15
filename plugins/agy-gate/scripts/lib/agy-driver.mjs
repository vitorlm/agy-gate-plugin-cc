import { createCliDriver } from "./agy-cli-driver.mjs";
import { validate as validateSchema } from "./review-schema.mjs";

/**
 * Thin seam over the single CLI implementation (no fallback transport — OD-5).
 * Binds the schema validator to the same `dataDir` and forwards spawn/sandbox
 * overrides for tests. Unlike codex-driver there is no SDK to lazy-load — the
 * transport is a spawned binary — and the result carries NO `usage` field
 * (token telemetry is unobservable on agy; §3).
 * @param {{ dataDir?: string|null, env?: Record<string, string|undefined>, spawn?: any, sandboxWrap?: any, onProgress?: (l: string) => void, timeoutMs?: number, platform?: NodeJS.Platform }} [overrides]
 */
export function createDriver(overrides = {}) {
  const { dataDir, ...rest } = overrides;
  const dir = dataDir ?? process.env.CLAUDE_PLUGIN_DATA ?? null;
  const validate = (/** @type {any} */ kind, /** @type {unknown} */ payload, /** @type {any} */ opts) =>
    validateSchema(kind, payload, { dataDir: opts?.dataDir ?? dir });
  return createCliDriver({ validate, dataDir: dir, ...rest });
}
