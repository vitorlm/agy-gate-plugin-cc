# Port Plan — `codex-gate` → `agy-gate`

**Date:** 2026-06-15 · **Method:** coupling scan (`codex|sdk|openai|outputSchema|Turn.usage|dropNulls|gpt|strict|api-key`) over every `.mjs`, cross-checked against the `agy-gate` tech-spec deltas. LOC = source lines (each file has a `.test.mjs` sibling that ports in the same tier).

## Headline

The "from scratch" surface is small. Of ~3,200 source LOC in `codex-gate`:
- **~40% (`~935 loc`) ports verbatim or whitespace-only** — transport-agnostic infrastructure.
- **~12% (`~394 loc`) ports with mechanical rename / one-line edits.**
- **The only genuine rewrite is the transport driver** (`codex-sdk-driver.mjs`, 320 loc → `agy-cli-driver.mjs`).
- **The only genuinely new file is `agy-sandbox.mjs`** (~120 loc, the OS read-only wrapper).
- Everything else in "edit" tier is **localized deltas** in otherwise-portable files (e.g. the 421-loc dispatcher is ~90% mechanical rename + driver-swap).

Net new logic to write from zero ≈ **450 loc** (CLI driver + sandbox). The rest is copy, rename, or surgical edit.

---

## Tier A — `cp` verbatim / whitespace-only (0 coupling, no delta)

| File | LOC | Note |
|---|---|---|
| `lib/args.mjs` | 58 | flag parser — no transport |
| `lib/git.mjs` | 53 | Git ops — identical §7.1 |
| `lib/scope.mjs` | 126 | scope resolution — identical §7.1 |
| `lib/quota.mjs` | 77 | quota guard / backoff — identical §6.3 |
| `lib/render.mjs` | 80 | **no error-code switch** (verified) — presentation only |
| `lib/state.mjs` | 37 | per-workspace slug+hash |
| `lib/statelock.mjs` | 122 | advisory lock + atomic write |
| `lib/session-tracker.mjs` | 58 | touched-files list |
| `session-tracker-hook.mjs` | 45 | PostToolUse append |
| `lib/loop-state.mjs` | 220 | **no token/budget refs** (verified — budget lives in the hook, not here) → fingerprint/severity/progress logic ports intact |
| `schemas/review-output.schema.json` | 30 | **verbatim — identical verdict contract (§9)** |
| `schemas/adversarial-output.schema.json` | 29 | **verbatim — identical verdict contract (§9)** |
| **Subtotal** | **~935** | + matching `.test.mjs` files |

> Only sed-level change across Tier A: the data-dir env var name if you rename `CLAUDE_PLUGIN_DATA` consumers — but that's plugin-host-provided and unchanged, so truly verbatim.

## Tier B — `cp` + mechanical rename / trivial edit

| File | LOC | Edit |
|---|---|---|
| `lib/jobs.mjs` | 224 | one string: `"CODEX_ERROR"` → `"CLI_ERROR"` (§8 rename) |
| `lib/pipeline.mjs` | 56 | drop/ignore the `usage` field threaded through `runReview` (token usage absent §3); one comment |
| `lib/prompts.mjs` | 44 | one comment; prompt-builder logic intact (the strict-JSON instruction goes in the `.md` content, below) |
| `session-lifecycle-hook.mjs` | 70 | one import rename: `sdk-install` → `dep-install` |
| `prompts/review.md` | — | **add the "strict JSON only, no fences" instruction** (§7.2) — content delta, not logic |
| `prompts/adversarial-review.md` | — | same |
| `agents/codex-reviewer.md` | — | rename `codex-reviewer`→`agy-reviewer`, `/codex-gate:`→`/agy-gate:`, "Codex"→"Gemini" |
| `commands/*.md` (6) | — | mechanical rename of namespace/labels |
| `skills/codex-reviewing/**` | — | rename dir + namespace + tool name |
| **Subtotal** | **~394** | + markdown surface |

## Tier C — real edit / rewrite (core deltas)

| File | LOC | Work | Effort |
|---|---|---|---|
| `lib/codex-sdk-driver.mjs` → **`agy-cli-driver.mjs`** | 320 | **REWRITE.** Spawn `agy --print` through `agy-sandbox.wrap` instead of the SDK; tolerant-parse stdout JSON; strip `GEMINI_API_KEY`/`GOOGLE_*`; empty-stdout-exit-0 guard; §8 mapping. **The one true rewrite.** | 🔴 high |
| `lib/codex-driver.mjs` → `agy-driver.mjs` | 21 | seam: contract minus `usage`; call the family-pin (§6.2) | 🟡 light |
| `lib/review-schema.mjs` | 104 | **drop** strict-subset shape + `dropNulls`; keep single-schema `validate` + tolerant normalize (§9) | 🟡 medium |
| `lib/models.mjs` | 17 | **rewrite** tiny file: Gemini aliases + **reject non-Gemini** guard (§6.2) — new logic | 🟡 light |
| `lib/sdk-install.mjs` → `dep-install.mjs` | 55 | install **ajv only** (drop the SDK spec) | 🟢 small |
| `lib/sdk-load.mjs` → `dep-load.mjs` | 48 | `loadAjv` only (drop `loadCodex`) | 🟢 small |
| `lib/setup.mjs` | 107 | probe via `agy --print`; add `AGY_NOT_INSTALLED`; **ignore startup "not logged in" noise** (§6.3) | 🟡 medium |
| `lib/auth.mjs` | 62 | `probeAuth` for the `agy` transport (reuse `classifyError` shape) | 🟡 medium |
| `codex-companion.mjs` → `agy-companion.mjs` | 421 | rename; swap driver import; drop `usage`; new error codes. **~90% mechanical** | 🟡 medium (bulk) |
| `stop-review-gate-hook.mjs` | 138 | **remove token-budget trip** (lines 23 `tokenBudget`, 104 `usage`) + budget logic; add OD-1 **fallback-to-codex-gate** hint | 🟡 medium |
| **Subtotal** | **~1,293** | of which only the driver (320) is from-scratch logic | |

## Tier D — NEW (no source)

| File | est. LOC | Note |
|---|---|---|
| `lib/agy-sandbox.mjs` | ~120 | Seatbelt (macOS) / bwrap (Linux) wrapper builder + `SANDBOX_UNAVAILABLE` + realpath (§5.6/§10). **Spec'd in detail; SP-1 proved the macOS profile.** |
| `lib/agy-sandbox.test.mjs` | ~80 | argv assertions per platform + sandbox-absent path |

## DROP (not needed in `agy-gate`)

| File | Why |
|---|---|
| `schemas/codex-output.review.strict.json` | no OpenAI strict subset — single-schema model (§9) |
| `schemas/codex-output.adversarial.strict.json` | same |

---

## Readiness verdict (spec → build)

**Implementation-ready to start the build**, with two cheap spikes recommended *during* build step 4 (driver/sandbox), not before:

| # | Gap | Severity | When |
|---|---|---|---|
| 1 | **Linux `bwrap` read-only path is UNVERIFIED.** SP-1 proved only macOS Seatbelt. The bwrap profile is research-`[Likely]`, not tested. | 🟠 Medium — blocks cross-platform claim, not macOS build | Spike at build step 4; until then mark Linux "experimental" |
| 2 | **Prompt-enforced JSON proven on ONE small file only** (cart.js, 22 loc). Large/multi-file diffs may induce fences or truncation. | 🟠 Medium — affects parse reliability at scale | Spike a multi-file scope at build step 4; the tolerant-parse + `SCHEMA_INVALID` fail-visible already backstops it |
| 3 | **V-1 cross-family thesis unvalidated for Gemini** (same open item as `codex-gate`). | 🟡 Low pre-1.0 | Reuse `codex-gate` V-1 harness, human-gated before 1.0 |
| 4 | **`agy` known-good version range undocumented** (tested 1.0.3 only). | 🟡 Low | Pin range in README at publish; `--version` check in setup (§6.4) |

No gap blocks starting the build on macOS. #1 and #2 are bounded spikes folded into the driver/sandbox step.
