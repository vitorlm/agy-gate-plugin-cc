import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The pinned runtime dep installed lazily into the plugin data dir (§5.4). Kept
 * in sync with the root `package.json`. Each entry is `[node_modules-subpath, spec]`.
 * Unlike codex-gate there is no SDK — `agy` is a user-installed system binary, not
 * an npm dep — so ajv is the only thing we install.
 * @type {ReadonlyArray<{ subpath: string[], spec: string }>}
 */
export const PINNED_DEPS = [{ subpath: ["ajv"], spec: "ajv@8.17.1" }];

/** The `name@version` specifiers to hand to `npm install`. */
export const PINNED_SPECS = PINNED_DEPS.map((d) => d.spec);

/**
 * Whether the pinned runtime dep (`ajv`) is already installed under the plugin
 * data dir (a cheap stat — safe inside the 5s SessionStart hook; §5.4).
 * @param {string} dataDir
 * @returns {boolean}
 */
export function depsInstalled(dataDir) {
  return PINNED_DEPS.every((d) =>
    existsSync(join(dataDir, "node_modules", ...d.subpath, "package.json")),
  );
}

/**
 * Lazily + idempotently ensure the pinned runtime dep is installed (on first
 * review, NOT in the SessionStart hook — an npm install cannot reliably finish in
 * 5s; §5.4). The `install` side-effect is injected so the decision logic stays
 * unit-testable (tests never run npm).
 * @param {string} dataDir
 * @param {{ installed?: () => boolean, install: () => Promise<void> }} deps
 * @returns {Promise<{ ok: true, installed: boolean } | { ok: false, error: { code: string, message: string, remediation: string } }>}
 */
export async function ensureDeps(dataDir, { installed = () => depsInstalled(dataDir), install }) {
  if (installed()) return { ok: true, installed: false };
  try {
    await install();
    return { ok: true, installed: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "CLI_ERROR",
        message: `Failed to install runtime deps (${PINNED_SPECS.join(", ")}): ${err instanceof Error ? err.message : String(err)}`,
        remediation:
          "Run /agy-gate:setup to pre-install ajv, or check npm connectivity.",
      },
    };
  }
}
