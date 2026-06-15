import { readFileSync } from "node:fs";
import { loadAjv } from "./dep-load.mjs";

const SCHEMA_DIR = new URL("../../schemas/", import.meta.url);

/** @param {string} name */
function load(name) {
  return JSON.parse(readFileSync(new URL(name, SCHEMA_DIR), "utf8"));
}

const INTERNAL = {
  review: load("review-output.schema.json"),
  adversarial: load("adversarial-output.schema.json"),
};

/**
 * Compiled validators, memoized per data dir. ajv is loaded lazily and
 * dynamically (§5.6) — it lives in `${CLAUDE_PLUGIN_DATA}/node_modules` in a
 * distributed install, not on this file's static resolution path.
 * @type {Map<string, Promise<{ review: (v: unknown) => boolean, adversarial: (v: unknown) => boolean }>>}
 */
const validatorsByDir = new Map();

/**
 * @param {string|null} dataDir
 * @returns {Promise<{ review: (v: unknown) => boolean, adversarial: (v: unknown) => boolean }>}
 */
function getValidators(dataDir) {
  const key = dataDir ?? "";
  let compiled = validatorsByDir.get(key);
  if (!compiled) {
    compiled = (async () => {
      const Ajv = await loadAjv(dataDir);
      // Tolerant normalization: strip unknown keys (additionalProperties:false)
      // and coerce obvious type deviations, instead of hard-failing on verbosity.
      // Unlike codex-gate there is no strict-subset schema, so no null-stripping
      // is needed — the prompt produces genuine optionals, not present-but-null.
      const ajv = new Ajv({ allErrors: true, removeAdditional: true, coerceTypes: true });
      return {
        review: ajv.compile(INTERNAL.review),
        adversarial: ajv.compile(INTERNAL.adversarial),
      };
    })();
    validatorsByDir.set(key, compiled);
  }
  return compiled;
}

/**
 * Normalize then validate an agy payload against the internal draft-07 schema.
 * @param {"review"|"adversarial"} kind
 * @param {unknown} payload
 * @param {{ dataDir?: string|null }} [opts]
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, code: "SCHEMA_INVALID", errors: unknown}>}
 */
export async function validate(kind, payload, opts = {}) {
  if (kind !== "review" && kind !== "adversarial") {
    throw new Error(`unknown schema kind: ${kind}`);
  }
  const dataDir = opts.dataDir ?? process.env.CLAUDE_PLUGIN_DATA ?? null;
  const validators = await getValidators(dataDir);
  const fn = validators[kind];
  // ajv mutates `value` in place under removeAdditional/coerceTypes; clone first
  // so the caller's payload object is never silently rewritten.
  const value = structuredClone(payload);
  if (!fn(value))
    return { ok: false, code: "SCHEMA_INVALID", errors: /** @type {any} */ (fn).errors };
  return { ok: true, value };
}
