export const DEFAULT_MODEL = "Gemini 3.1 Pro (High)";

/** Short aliases resolved to canonical agy model names. @type {Record<string, string>} */
const ALIASES = {
  default: DEFAULT_MODEL,
  pro: "Gemini 3.1 Pro (High)",
  flash: "Gemini 3.5 Flash (High)",
};

/**
 * Resolve a model alias / explicit name to a canonical agy model name. Names may
 * contain spaces/parens — callers MUST pass the result as a single argv element,
 * never shell-interpolated (§6.2).
 * @param {string|null} [input]
 * @returns {string}
 */
export function resolveModel(input) {
  if (!input) return DEFAULT_MODEL;
  return ALIASES[input] ?? input;
}

/**
 * Enforce the cross-family thesis (§0/§6.2): `agy` can route to Claude and GPT-OSS
 * models, which would silently collapse cross-family review to same-family
 * self-review. The driver MUST pin a Gemini model and reject anything else.
 * @param {string} model resolved model name
 * @returns {{ ok: true } | { ok: false, error: { code: "MODEL_UNAVAILABLE", message: string, remediation: string } }}
 */
export function assertGemini(model) {
  if (model.startsWith("Gemini")) return { ok: true };
  return {
    ok: false,
    error: {
      code: "MODEL_UNAVAILABLE",
      message: `cross-family review requires a Gemini model; '${model}' would defeat independent review`,
      remediation: "Set userConfig.reviewModel (or --model) to a Gemini-family model, e.g. 'Gemini 3.1 Pro (High)'.",
    },
  };
}
