---
name: agy-reviewing
description: Internal — how the agy-reviewer subagent drives the agy companion and relays results. Not user-invocable.
user-invocable: false
---

# agy-reviewing

How to run a Gemini cross-model review through the companion and return the result. This skill is for the `agy-reviewer` subagent (and the stop-gate); it is not a user command.

## The one call

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" <subcommand> [flags]
```

- `<subcommand>`: `review` (defect-oriented) or `adversarial-review` (design challenge).
- The companion resolves scope, runs agy **read-only on the Gemini subscription**, validates the structured output, and prints either a rendered verdict or a `⚠ <CODE>` error envelope.
- Run it **once**. Do not poll, retry, or wrap it in a loop.

## Scope flags (precedence: explicit > text > session > base > default)

| Intent | Flag |
|---|---|
| Files/dirs the caller named | `<path> [<path>...]` |
| Pasted code or a single document | `--text "<content>"` |
| "Code this session produced" | `--session` |
| Compare against a branch/ref | `--base <ref>` |
| Adversarial focus | `--focus "<aspect>"` (adversarial-review only) |
| Pick model | `--model pro` or `--model flash` or `--model <id>` (default `Gemini 3.1 Pro (High)`) |
| Machine-readable result | `--json` |

If nothing is specified and the cwd is a Git repo, the companion reviews the working-tree diff; otherwise it returns `NO_SCOPE`.

## Returning results

- Relay the companion's stdout **verbatim** — it is already the rendered verdict (verdict line, findings/challenges, next steps) or a structured error.
- A `⚠ <CODE>` line (`RATE_LIMITED`, `AUTH_REQUIRED`, `AGY_NOT_INSTALLED`, `MODEL_UNAVAILABLE`, `TIMEOUT`, `SCHEMA_INVALID`, `CLI_ERROR`, `NO_SCOPE`, `QUOTA_GUARD`) is **never** an approval — surface it as-is with its remediation.
- Never invent a verdict, never drop or soften findings, never re-judge. The point is the independent model's view.
- A `⚠ Coverage:` note means scope may be incomplete (e.g. tracker-only outside Git) — keep it visible.

For prompt/scope nuances and failure handling, see `references/prompting.md`.
