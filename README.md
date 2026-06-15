# agy-gate

Cross-model code review for Claude Code, powered by the Antigravity CLI (`agy`) on a Gemini subscription. A sibling of [`codex-gate`](https://github.com/vitorlm/codex-plugin-cc) with an identical verdict contract — the same JSON schema, the same stop-gate circuit-breaker, and the same fail-open philosophy.

> **Platform status:** macOS fully supported (Seatbelt sandbox verified). Linux experimental — the `bwrap` path compiles and runs but is unverified end-to-end on a real Linux host (port-plan gap #1). Windows is not supported.

---

## What it is

The **cross-model thesis**: Claude reviews its own code. A second, different model family (here: Google Gemini via Antigravity CLI) reviewing the same code catches defects the author model systemically misses. `agy-gate` wires this into Claude Code as a plugin — on demand and, optionally, automatically at every turn end.

Key properties:

- **Read-only sandbox** — every `agy --print` call runs inside a macOS Seatbelt (or Linux `bwrap`) profile. `agy` can read the project directory; it cannot write, open sockets, or spawn processes. The review is purely observational.
- **Fail-open** — if `agy` is unavailable, rate-limited, or the sandbox is absent, the gate warns visibly and allows the turn. It never blocks on infrastructure unavailability.
- **Iteration-cap stop-gate** — token budgets are unobservable via `agy --print` (§3/OD-12). Termination is by **iteration count only** (default: 3 rounds). The gate is a converging circuit-breaker, not a linter loop.
- **Gemini family enforcement** — the driver rejects non-Gemini model IDs at configuration time so the cross-family guarantee is never silently voided.
- **No token telemetry** — `agy --print` produces no usage metadata. There is no token counter, budget, or spend tracking in this plugin.

---

## Prerequisite: Antigravity CLI (`agy`)

Install and authenticate the Antigravity CLI before using this plugin:

```bash
# Install (check https://developers.google.com for current install instructions)
npm install -g @google/antigravity-cli   # or the recommended installer

# Authenticate
agy login
```

**Tested against:** `agy` version **1.0.3** — the only version verified against this plugin. Other versions may work but are unverified. Report compatibility results as issues.

**Trust & ToS posture:** This plugin drives `agy` in automated, non-interactive mode (`agy --print`). Automated use of a Gemini subscription carries ToS risk. The supported high-volume path for production use is a future `@google/genai` API-key integration (planned, not yet implemented). Use automated review at your own risk.

---

## Commands

| Command | What it does |
|---|---|
| `/agy-gate:review [files…]` | On-demand code review. Accepts file paths, `--session`, `--base <ref>`, `--text <inline>`, or no args (session scope). |
| `/agy-gate:adversarial-review [files…]` | Adversarial challenge — same scope options, adversarial prompt. |
| `/agy-gate:setup` | Auth probe + dep pre-install + effective config report. Run this first. |
| `/agy-gate:status [jobId]` | List background jobs or inspect a specific one. |
| `/agy-gate:result <jobId>` | Print the verdict of a completed background job. |
| `/agy-gate:cancel <jobId>` | Cancel a running background job. |

### Subagent

`agy-reviewer` — use as a Claude Code subagent type (`subagent_type: "agy-reviewer"`) to spawn an independent Gemini review from an orchestrator workflow. Returns a structured verdict.

### Scope options

| Flag | Meaning |
|---|---|
| `file1.ts file2.ts` | Review specific files (no Git required) |
| `--session` | Files edited by the current Claude Code session (via session tracker + Git augmentation) |
| `--base <ref>` | `git diff <ref>...HEAD` — review everything since a branch point |
| `--text <inline>` | Review a pasted snippet (no file I/O) |
| _(no args)_ | Session scope (same as `--session`) |

---

## Stop-gate (automatic review on turn end)

Enable the stop-gate to trigger a Gemini review automatically every time Claude Code ends a turn:

```json
// In your claude project config or plugin userConfig
{ "stopReviewGate": true }
```

The gate is a **converging circuit-breaker**:

1. A review runs at turn end.
2. If new blocking findings appear, the turn is blocked with a reason.
3. Claude fixes the findings, the turn ends again, another review runs.
4. If the open-blocking set strictly shrinks each round → progress → continue.
5. If no progress for 2 consecutive rounds, or the iteration cap is reached → fail-open (warn + allow).

Termination is by **iteration count** (`maxIterations`, default 3), not token budget.

---

## Configuration (`userConfig`)

Set via `/plugin` settings UI or `plugin.json` `userConfig` defaults.

| Key | Type | Default | Description |
|---|---|---|---|
| `stopReviewGate` | boolean | `false` | Enable the automatic stop-gate review on every turn end. |
| `stopGateOnUnavailable` | string | `"allow"` | `allow` (warn but don't block) or `block` (fail-closed on agy unavailability). |
| `notReviewedStreakLimit` | number | `3` | After this many consecutive unreviewed turns, escalate the warning with remediation steps. |
| `reviewModel` | string | `"Gemini 3.1 Pro (High)"` | Gemini model to use. Aliases: `"pro"` → Gemini 3.1 Pro (High), `"flash"` → Gemini 2.5 Flash. Non-Gemini models are rejected. |
| `maxIterations` | number | `3` | Hard ceiling on stop-gate review→fix rounds before the loop opens and hands off to human. |
| `maxReviewsPerDay` | number | `0` | `0` = no cap. Set `>0` to enforce a daily ceiling on automated reviews. |
| `severityThreshold` | string | `"blocker"` | Minimum gating severity: `blocker` \| `major` \| `minor` \| `info`. Severity is host-derived by finding category — the model's self-reported severity is advisory only. |
| `reviewTimeoutMs` | number | `300000` | Hard timeout (ms) on a single `agy --print` call. A hung review becomes a clean `TIMEOUT` error instead of a stuck shell. |

---

## Security model

- **Read-only sandbox** — macOS: `sandbox-exec` Seatbelt profile. Linux: `bwrap` with `--ro-bind` (experimental). The review process can read the project directory and the Gemini auth state (`~/.gemini`); it cannot write files, open network sockets, or spawn children.
- **Fail-closed on sandbox absence** — if the platform sandbox binary is not found, the review returns `SANDBOX_UNAVAILABLE` and no subprocess is spawned. `agy` never runs unsandboxed.
- **API key stripping** — `GEMINI_API_KEY`, `GOOGLE_API_KEY`, and `GOOGLE_GENAI_USE_VERTEXAI` are stripped from the environment passed to `agy`. Reviews authenticate via the Antigravity session (subscription), not via API keys in env.
- **No network in sandbox** — the Seatbelt profile does not include `network*` permits. Network calls come from `agy` itself, which is a pre-installed binary outside the sandbox's control scope.

---

## Install / local dev

```bash
# Run Claude Code with this plugin loaded
claude --plugin-dir ./plugins/agy-gate

# After editing, reload in a running Claude Code session
/reload-plugins

# Full check (lint + typecheck + tests + validate)
npm run check

# Individual checks
npm run lint        # Biome
npm run typecheck   # tsc via JSDoc (no build step)
npm test            # node --test (175 tests, no external framework)
npm run validate    # claude plugin validate ./plugins/agy-gate --strict
```

**Node.js requirement:** Node.js 22+ (ESM `.mjs`, `node:test`, `node:assert/strict`).

**Runtime dependency:** `ajv@8.17.1` is lazily installed into `CLAUDE_PLUGIN_DATA` on first review. No npm install required at plugin load time.

---

## Relation to codex-gate

`agy-gate` is a mechanical port of [`codex-gate`](https://github.com/vitorlm/codex-plugin-cc):

| Aspect | codex-gate | agy-gate |
|---|---|---|
| Transport | OpenAI Codex CLI (`codex --quiet`) | Antigravity CLI (`agy --print`) |
| Model family | GPT / o-series | Gemini |
| Token telemetry | `usage.totalTokens` observable | Unobservable — removed entirely |
| Stop-gate termination | Iteration cap + token budget | Iteration cap only |
| Auth file | `~/.codex/auth.json` | `~/.gemini/antigravity-cli` |
| Error codes | `CODEX_ERROR` | `CLI_ERROR` |
| Env prefix | `CODEX_*` | `AGY_*` |
| Verdict schema | Identical | Identical |

The verdict JSON schema is the same — a review produced by either plugin can be parsed by the same consumer.
