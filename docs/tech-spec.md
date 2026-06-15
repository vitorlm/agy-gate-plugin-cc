# Tech Spec — Gemini/Antigravity Code Review Plugin for Claude Code

| | |
|---|---|
| **Status** | **SP-1 PASSED (2026-06-15)** — `agy --print` confirmed as a viable subscription-headless transport: runs on the cached Antigravity login (no API key), emits clean parseable JSON from a prompt-enforced shape (no dual-schema needed), read-only achieved via an OS sandbox (Seatbelt on macOS — *proven* kernel-blocked write while review still ran; bwrap on Linux). Token usage **not** observable → stop-gate falls to the iteration cap only. Evidence: `spike/sp-1/FINDINGS.md`. **Design phase — not yet built.** |
| **Date** | 2026-06-15 |
| **Owner** | Vitor Mendonça |
| **Plugin name** | `agy-gate` (namespace `/agy-gate:*`) |
| **Sibling of** | `codex-gate` (`~/git-pessoal/codex-plugin-cc`) — this spec mirrors its architecture section-for-section; deltas are called out inline. |
| **Gemini transport** | `agy --print` (Antigravity CLI, **subscription headless**; SP-1 confirmed; sole transport — no API-key/SDK fallback), behind an `agy-driver` abstraction, wrapped in an OS read-only sandbox. |

---

## 0. Why this exists (value thesis)

**Generate code with one LLM (Claude), review it with a different-family LLM (Gemini 3).** A model is a weaker judge of its own output: it shares the generator's blind spots, training biases, and a confirmation bias toward what it just produced. An independent model from a different family is *expected* to catch some error classes the generator misses in itself.

This is the load-bearing justification for all the cost this plugin carries (external CLI, subscription auth, version churn, rate limits, ToS exposure). It is also **why a Claude subagent reviewer is not a substitute** — it would inherit the generator's blind spots. If cross-model review stops being the goal, the simpler answer is a Claude subagent and this plugin should not exist.

**Relationship to `codex-gate`.** `agy-gate` is a *sibling*, not a replacement. Together they give two independent cross-family reviewers (GPT via Codex, Gemini via Antigravity), which an orchestrator can use three ways:
1. **Substitute** — use Gemini when the user has an Antigravity subscription but no ChatGPT one (or vice-versa).
2. **Fallback** — when one gate is rate-limited/unavailable, route to the other (§8).
3. **Triangulation** — run both and treat a finding confirmed by *two* different families as higher-confidence.
To make 2 and 3 possible the **verdict contract is byte-for-byte identical to `codex-gate`'s** (§9) so the orchestrator treats the two gates as interchangeable.

**Cross-family is a hypothesis, not a fact (must be validated).** Claude and Gemini are both transformer LLMs trained on heavily overlapping corpora; *shared* blind spots are real. The cross-family premise buys *partial* independence, not orthogonality.

> **Gemini-specific risk to the thesis (load-bearing):** `agy` can route to **multiple model families** — `agy models` lists Gemini 3.x, **Claude Sonnet/Opus 4.6**, and GPT-OSS. If the driver let a review run on a Claude model, the cross-family premise would silently collapse to same-family self-review. **The driver MUST pin a Gemini-family model and reject any non-Gemini selection** (§6.2). This guard does not exist in `codex-gate` (Codex is single-family) and is unique to this plugin.

- **V-1 (validation, post-SP-1, pre-1.0):** on a fixed fixture set of seeded-defect diffs, compare Gemini cross-model review against a Claude same-model subagent reviewer. Success criterion: Gemini finds ≥1 distinct true-positive class the Claude reviewer misses, on ≥30% of fixtures, at acceptable false-positive rate. Reuse the `codex-gate` V-1 harness (`spike/v-1/`) verbatim — only the `geminiReviewer` injection differs. If this fails, the thesis — and the plugin — is not justified.

---

## 1. Overview

A Claude Code plugin that delegates **code review** and **adversarial review** to Google's **Antigravity CLI (`agy`)**, using the user's **Antigravity subscription** (cached `agy` login) — never a `GEMINI_API_KEY` / Vertex API key.

It mirrors the proven architecture of `codex-gate` (thin command/agent/hook markdown over a single Node "companion" that drives an external tool and parses structured output), adapting the transport to `agy`, which is driven **one-shot per review** via `agy --print` through an `agy-driver` abstraction, with **prompt-enforced** structured output (Gemini honours a strict JSON-shape instruction; SP-1 confirmed) and an **OS-level read-only sandbox** around the subprocess.

Primary consumers:
1. An **orchestrator** in a Claude Code session (e.g. `epic-orchestrator`) that reviews after each implementation story, via a dedicated **subagent** (isolated context).
2. A **stop-gate** `Stop` hook with a bounded review→fix loop (circuit breaker, §7.4).
3. Manual user commands for ad-hoc review.

---

## 2. Goals / Non-goals

### Goals
- Cross-model review (§0): delegate review/adversarial-review to Gemini via the Antigravity subscription — **subject to V-1 validating the premise**.
- Invokable automatically from within a session by an orchestrator, in **isolated context** (subagent), returning only the verdict.
- A `Stop` review-gate that **provably terminates** (bounded loop, §7.4) — termination guaranteed via the **iteration cap** (token budget is *not* available on this transport — §7.4); *quality* convergence is not claimed.
- **Scope = code the session actually produced** (§7.1), tracked via `PostToolUse`, with explicit, *visible* handling of changes the tracker cannot see (Bash-driven edits) — never a silent miss.
- **Work without a Git repository:** review arbitrary files, dirs, or pasted text. Git enables diff-based scoping but is **never required**.
- Read-only **for the `agy` subprocess** by construction — but, unlike `codex-gate`, this is **not free from the transport**. `agy --sandbox` confines writes *into* the workspace (wrong direction); read-only is enforced by an **external OS sandbox** (§10) the companion wraps around the subprocess.
- Verdict contract **identical to `codex-gate`** so the two gates are interchangeable for fallback/triangulation (§0, §9).
- Single-source-of-truth structured output, with **distinct schemas for review vs adversarial** (§9).
- **Fail visibly, never falsely approve** (§8) — including silent-scope-miss, parse failures, and schema-validation failures.
- Resilient to `agy` CLI version churn via the `agy-driver` seam + version detection (§6.4).

### Non-goals
- No "review + auto-fix" mode (read-only only).
- No `GEMINI_API_KEY` / Vertex AI auth path (subscription only) for v0.1. The structured-output-via-API-key path (`@google/genai`) is an explicit future OD (§6.3) for ToS-safe high volume.
- No MCP server (avoids always-on token cost; §4.3).
- No `gemini-cli` ACP transport (the prior `abiswas97-gemini` approach): the `gemini-cli` subscription tier sunsets 2026-06-18 in favour of Antigravity; building on it is building on a deprecated surface (§3).
- No interactive `agy` slash-command reuse (not reachable headlessly; review is driven via `--print` + a JSON-shape prompt).
- No cross-family review on a **Claude or GPT** model exposed by `agy` (would defeat §0); the driver pins Gemini (§6.2).

---

## 3. Transport decision (`agy --print` sole transport — SP-1 confirmed)

The premise of `codex-gate` — **structured output + subscription auth, zero marginal cost** — does not map cleanly onto Gemini, because Google splits those two capabilities across **mutually exclusive auth planes** and actively bans third-party use of the subscription plane:

| Capability | How you get it on Gemini |
|---|---|
| Structured JSON (`responseSchema`/`responseJsonSchema`) | **Only** via API key (AI Studio) or Vertex AI |
| Subscription auth ("Login with Google", Pro/Ultra) | **Only** via the Code Assist plane (`cloudcode-pa.googleapis.com`), first-party |

Three candidate transports were evaluated for **subscription viability + structured output + stability**; SP-1 resolved the decision (`spike/sp-1/FINDINGS.md`):

| Transport | Subscription? | Structured output | Stability | Verdict |
|---|---|---|---|---|
| **`agy --print`** (Antigravity CLI) | **Yes** (cached login, no API key) | **Yes — prompt-enforced** (SP-1: clean parseable JSON, no fences) | Official Google binary; **we own CLI churn** (no SDK pins a binary) | **Sole transport (SP-1 confirmed)** |
| `@google/genai` SDK | **No** — API key / Vertex only | Yes — first-class `responseJsonSchema` (better than OpenAI strict subset) | Versioned HTTP API, very stable | **Dropped** for v0.1 (defeats zero-cost premise); future OD for high-volume/ToS-safe use |
| `gemini-cli --acp` | Yes (today) | No (ACP is an interactive agent protocol; CLI JSON is envelope-only) | **Deprecated** — subscription tier sunsets 2026-06-18 | Rejected (the `abiswas97-gemini` approach; dying surface) |

**Decision (resolved):** `agy --print` is the **sole** transport. SP-1 proved it runs on the cached Antigravity subscription login (no API key) and follows a strict JSON-shape prompt. The `agy-driver` abstraction (§5.6) is retained as a thin seam so a future transport swap (e.g. to `@google/genai` under an API-key OD) stays a one-file change, but there is no runtime fallback in v0.1.

> **SP-1 results (closed; full report `spike/sp-1/FINDINGS.md`):**
> - **`agy --print` on subscription: PASS.** Exit 0 on the cached login; endpoint `daily-cloudcode-pa.googleapis.com` (the subscription daily-quota plane). Startup logs transient `"not logged into Antigravity"` singleflight races that self-resolve — **must not** be misread as `AUTH_REQUIRED` by the probe (§6.3).
> - **Structured output via prompt: PASS.** A real review prompt returned clean JSON (no markdown fences, no prose), parsed first try; 3/3 seeded defects found with correct severity. **No OpenAI-strict-subset dance** → the `codex-gate` dual-schema model collapses to a **single internal draft-07 schema** + tolerant parse (§9).
> - **Read-only: PASS via OS sandbox (not the transport).** `agy --sandbox` does *not* make the project read-only (it confines writes *into* the workspace — wrong direction). A 3-line Seatbelt profile (`(allow default)(deny file-write* (subpath PROJECT_DIR))`) **kernel-blocked** `agy`'s write attempt while the review still completed (exit 0). Same mechanism the Codex SDK uses internally; we do it explicitly (§10).
> - **Token usage: NOT observable.** No parseable per-turn token counts in stdout/log (internal `quota_manager` only). → the §7.4 stop-gate `TOKEN_BUDGET` trip is **dropped**; the iteration cap is the sole hard termination guarantee.
> - **Model family hazard:** `agy models` exposes Claude + GPT-OSS alongside Gemini → the driver must pin a Gemini family (§6.2).

**Lessons inherited from `codex-gate`'s analysis of the `abiswas97-gemini` plugin** (same corrections apply; some are design, some are hygiene we won't repeat):

| Prior-plugin finding | This design | Type |
|---|---|---|
| Broad trust boundary (auto-approved `fs/write`) | **OS read-only sandbox** around the `agy` subprocess (§10) — the prior plugin's exact weakness | design |
| Triplicated review-output validation | prompt-enforced output + single `review-schema.mjs` validator | design |
| Tight coupling to a fast-moving CLI | `agy-driver` seam + version detection (§6.4) | design |
| Heuristic auth detection (file parsing) | `/agy-gate:setup` real `agy --print` probe (distinguishes not-authed from throttled, ignoring startup noise) | design |
| Hard Git dependency | Git-optional scope (§7.1) | design |
| Inconsistent timeouts + dead code | aligned timeouts; no dead code | hygiene |
| Sparse manifest | rich `plugin.json` | hygiene |
| Unclear bump discipline | SemVer + CHANGELOG, bumped per release | hygiene |

---

## 4. Architecture

### 4.1 High-level flow

```
Claude Code session
  ├─ orchestrator ──(Task)──► agents/agy-reviewer (isolated ctx, tools: Bash)
  ├─ user ──(/agy-gate:review | /agy-gate:adversarial-review)──┐
  │                                                     ▼
  │                                 node agy-companion.mjs <subcommand>
  └─ Stop hook ──► stop-review-gate-hook.mjs ────────────┤
        (reads loop-state + session-touched files)       │
                                                          ▼
                  ┌───────────────┬───────────────┬───────────────┐
                  ▼               ▼               ▼               ▼
               scope.mjs       agy-driver     review-schema   loop-state.mjs
            (session/diff/    (agy --print,   (parse+validate, (circuit-breaker
             files/text)       Gemini-pinned,  2 schemas)       state, fingerprints;
                               OS-sandboxed)        │           NO token budget)
                                    │               │
                                    ▼               │
                       agy-sandbox.mjs (Seatbelt/bwrap wrapper)
                                    │
                                    ▼
                    agy --print (Antigravity subscription login,
                       read-only via OS sandbox, prompt-enforced JSON)
```

### 4.2 Repository layout

```
agy-gate/
├── .claude-plugin/
│   └── marketplace.json
├── README.md   LICENSE (Apache-2.0)   CHANGELOG.md
├── docs/tech-spec.md
├── package.json            # private; Biome, tsc-via-JSDoc; ajv pinned (the only runtime dep)
├── package-lock.json       # committed; pins ajv (reproducible installs)
├── tsconfig.scripts.json
└── plugins/agy-gate/
    ├── .claude-plugin/plugin.json
    ├── agents/agy-reviewer.md
    ├── commands/
    │   ├── review.md   adversarial-review.md   setup.md
    │   ├── status.md   result.md   cancel.md
    ├── hooks/hooks.json
    ├── prompts/
    │   ├── review.md   adversarial-review.md   stop-review-gate.md
    ├── schemas/
    │   ├── review-output.schema.json        # internal draft-07 (validation) — IDENTICAL to codex-gate
    │   └── adversarial-output.schema.json    # internal draft-07 (validation) — IDENTICAL to codex-gate
    ├── scripts/
    │   ├── agy-companion.mjs
    │   ├── session-lifecycle-hook.mjs      # SessionStart/End
    │   ├── session-tracker-hook.mjs        # PostToolUse: record touched files
    │   ├── stop-review-gate-hook.mjs       # Stop: circuit breaker
    │   └── lib/
    │       ├── agy-driver.mjs              # thin seam + single agy --print implementation
    │       ├── agy-cli-driver.mjs          # sole transport: spawns agy --print under the sandbox
    │       ├── agy-sandbox.mjs             # OS read-only sandbox wrapper (Seatbelt / bwrap) — NEW vs codex-gate
    │       ├── review-schema.mjs           # single validator for BOTH schemas (no strict-subset shape)
    │       ├── scope.mjs   git.mjs
    │       ├── session-tracker.mjs
    │       ├── loop-state.mjs              # circuit-breaker state + fingerprints (no token budget)
    │       ├── statelock.mjs               # advisory file lock for shared state (§4.4)
    │       ├── jobs.mjs   state.mjs        # background job lifecycle + per-workspace state
    │       ├── dep-load.mjs                # dynamic loader for ajv from ${CLAUDE_PLUGIN_DATA}
    │       ├── dep-install.mjs             # lazy pinned install of ajv
    │       ├── render.mjs  models.mjs  args.mjs  auth.mjs
    └── skills/agy-reviewing/
        ├── SKILL.md
        └── references/prompting.md
```

Convention compliance: only `plugin.json` in `.claude-plugin/`; components at plugin root; bundled paths via `${CLAUDE_PLUGIN_ROOT}`; persistent state in `${CLAUDE_PLUGIN_DATA}`; no absolute paths / no `../`.

**Delta from `codex-gate`:** `agy-sandbox.mjs` is **new** (the transport doesn't give read-only for free). `agy` itself is a **user-installed system binary** (a prerequisite, like `codex login`), *not* an npm dep — so there is no SDK to install into `${CLAUDE_PLUGIN_DATA}`. The **only** runtime npm dep is `ajv` (schema validation), so `sdk-install.mjs`/`sdk-load.mjs` shrink to `dep-install.mjs`/`dep-load.mjs` (ajv only).

### 4.3 Why no MCP / no always-on token cost

Identical to `codex-gate`: no `.mcp.json`; all capability via skills/commands/agent, paying *token* cost only on invocation (progressive disclosure). The `PostToolUse` tracker hook runs on every Write/Edit/NotebookEdit (small *latency* cost, not token) — minimal work (append a path), tight timeout, becomes opt-in if measured latency is material.

### 4.4 Shared-state concurrency

Identical to `codex-gate`: file-based state, `loop-state` keyed by `session_id`; cross-session/shared state (jobs, pruning) under an advisory lock (`statelock.mjs`: lockfile + stale-break by pid/mtime); atomic write-temp-then-rename; stop-gate relies on `stop_hook_active` for re-entrancy.

---

## 5. Components

### 5.1 `agy-companion.mjs` (dispatcher)

| Subcommand | Purpose |
|---|---|
| `review` | Review the resolved scope (foreground or `--background`) |
| `adversarial-review` | Same pipeline, adversarial prompt + adversarial schema |
| `setup` | Login probe (authed vs throttled) + agy-binary presence + stop-gate toggle |
| `status [jobId]` | Inspect background job(s) |
| `result <jobId>` | Fetch a completed job's structured result |
| `cancel <jobId>` | Cancel/terminate a background job |
| `task-worker` | Internal: detached background executor (not user-facing) |

Invoked as `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" <subcommand> [args]`. Flags (`args.mjs`): `--session`, `--base <ref>`, `<file>...`, `--text`/stdin, `--model <m>`, `--focus <text>` (adversarial), `--background`, `--json`.

### 5.2 `agents/agy-reviewer.md` (primary model-invocable surface)

- Frontmatter: `name: agy-reviewer`, third-person `description` with orchestrator trigger phrases, `tools: Bash`. **No** `mcpServers`/`hooks`/`permissionMode` (disallowed for plugin agents).
- Thin forwarding wrapper: exactly one companion call; no repo spelunking, no polling, no summarizing findings away; return the structured verdict verbatim.
- Accepts a scope from the caller (`--session`, `--base`, files).
- Isolated context ⇒ orchestrator context stays clean.

### 5.3 Commands

| Command | Model-invocable | allowed-tools | Notes |
|---|---|---|---|
| `review` | `disable-model-invocation: true` | `Bash(node:*)`, `Bash(git:*)`, `Read`, `Glob`, `Grep`, `AskUserQuestion` | Manual; scope via args |
| `adversarial-review` | `disable-model-invocation: true` | same | Manual; `--focus` text |
| `setup` | model-invocable | `Bash(node:*)`, `AskUserQuestion` | Login probe + agy presence + gate toggle |
| `status` | `disable-model-invocation: true` | `Bash(node:*)` | Inline `!`-exec; background jobs |
| `result` | `disable-model-invocation: true` | `Bash(node:*)` | Inline `!`-exec |
| `cancel` | `disable-model-invocation: true` | `Bash(node:*)` | — |

Automatic path is the subagent; manual commands are user-only to avoid double exposure.

### 5.4 Hooks (`hooks/hooks.json`)

| Event | Script | Timeout | Behavior |
|---|---|---|---|
| `SessionStart` | `session-lifecycle-hook.mjs SessionStart` | 5s | Persist session id + data path + runtime-deps presence flag; init loop-state. **Does not** install ajv (see install note). |
| `PostToolUse` (Write/Edit/NotebookEdit) | `session-tracker-hook.mjs` | 3s | Append touched file path to session-touched list. Minimal work only. |
| `SessionEnd` | `session-lifecycle-hook.mjs SessionEnd` | 5s | Clean up this session's state. |
| `Stop` | `stop-review-gate-hook.mjs` | aligned w/ script (§8) | Opt-in circuit-breaker review-gate (§7.4) |

**Runtime-deps install (simplified vs `codex-gate`):** the only runtime dep is **`ajv`** (schema validation; not on the static module-resolution path in a distributed install, so it lives in `${CLAUDE_PLUGIN_DATA}`). It is **never** installed inside the 5s `SessionStart` hook. Instead:
- Installed **lazily and idempotently on first review** (`ensureDeps`), with a realistic timeout owned by the driver/hook.
- `SessionStart` only *checks* presence (`depsInstalled` — a stat over `ajv`) and records a flag; if absent, the first `review`/`setup`/stop-gate installs it (with progress + its own timeout) or returns a structured error.
- Install pins the version: `npm install --prefix <dataDir> --no-save ajv@8.17.1` (`PINNED_SPECS`, kept in sync with the root `package.json`/lockfile).
- **`agy` itself is NOT installed by the plugin** — it is a user prerequisite probed by `/agy-gate:setup` (which directs the user to install/login if missing).

### 5.5 `skills/agy-reviewing/SKILL.md`

Internal, `user-invocable: false`. Tells the subagent how to call the companion and return results. ≤ 2,000 words; detail in `references/prompting.md`; referenced explicitly from the agent.

### 5.6 lib modules

- **`agy-sandbox.mjs`** (NEW) — builds the OS read-only sandbox wrapper around the `agy --print` spawn (§10). `wrap(argv, { projectDir, platform }) → { command, args }`: on **macOS** emits `sandbox-exec -D PROJECT_DIR=<real abs path> -f <profile.sb> agy …` with the profile `(version 1)(allow default)(deny file-write* (subpath (param "PROJECT_DIR")))`; on **Linux** emits `bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind $HOME/.gemini $HOME/.gemini --ro-bind /etc/resolv.conf /etc/resolv.conf --share-net --die-with-parent --new-session --chdir <projectDir> -- agy …`. **`projectDir` is resolved to its real path** (Seatbelt matches resolved paths; `/tmp`→`/private/tmp`). If the platform sandbox binary is missing, `wrap` returns a structured `SANDBOX_UNAVAILABLE` so the driver **fails visibly** rather than running `agy` unsandboxed (§8). Defense-in-depth (optional, config): also write a transient `permissions.deny: ["write_file(*)"]` + `strict` mode — agent-layer guardrail under the kernel boundary.
- **`agy-driver.mjs`** — `createDriver(overrides?)` thin seam over a **single** `agy --print` implementation in `agy-cli-driver.mjs`. Contract (mirrors `codex-driver`): `review({kind, prompt, workingDirectory, skipGitRepoCheck?, model}) → {ok:true, payload} | {ok:false, error}`, where `kind` (`"review"|"adversarial"`) selects the internal validator and the prompt template. Binds the injected `validate` to the same `dataDir`. **Pins a Gemini-family model** and rejects non-Gemini (§6.2). Read-only via `agy-sandbox.mjs`; **no `usage` field** (token telemetry unavailable — §3).
- **`agy-cli-driver.mjs`** — sole transport. Spawns `agy --print "<prompt>"` **through `agy-sandbox.wrap`**, with `--model <resolved Gemini model>` and `--print-timeout`. Strips any `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_GENAI_USE_VERTEXAI` from the child env so the **subscription login is always used** (mirrors `codex-gate`'s API-key strip; prevents an exported key from silently billing the API). Reads stdout, **tolerant-parses** the JSON (strips any stray fences/prose defensively, then `JSON.parse`), and hands the payload to the validator. **Guards the non-TTY empty-stdout-with-exit-0 bug** (SP-1 caveat): empty stdout on success is treated as `CLI_ERROR`, never an approval. On spawn/timeout/parse failure → §8 envelope via `classifyError`.
- **`review-schema.mjs`** — single authority over the schema model. **Delta from `codex-gate`: no strict-subset shape, no `dropNulls`.** API: `async validate(kind, payload, { dataDir }) → Promise<{ok, value} | {ok:false, code:"SCHEMA_INVALID", errors}>`. ajv loaded **lazily and dynamically** via `dep-load.mjs` `loadAjv(dataDir)`; validators memoized per `dataDir`. Runs **tolerant normalization** (ajv `removeAdditional` + `coerceTypes` to strip unknown keys / coerce obvious deviations) before validating against the **draft-07** internal schema — but does **not** need to strip nulls (no strict schema forces them here). The schemas (`review-output.schema.json`, `adversarial-output.schema.json`) are **copied verbatim from `codex-gate`** (§9) — identical verdict contract.
- **`scope.mjs`** + **`git.mjs`** — Git-optional scope resolution (§7.1); identical to `codex-gate`. Computes/surfaces the coverage gap between tracked files and Git diff.
- **`session-tracker.mjs`** — per-session touched-files list (written by the PostToolUse hook). Identical.
- **`loop-state.mjs`** — circuit-breaker state: iteration count, finding fingerprints + status (open/addressed/contested). **Delta: no `token_budget_spent` field / no budget trip** (§7.4). Keyed by `session_id`.
- **`statelock.mjs`** — advisory lock + atomic write helpers. Identical.
- **`jobs.mjs` / `state.mjs`** — background job lifecycle + per-workspace state; detached `task-worker`, pruning, `status`/`result`/`cancel`. Identical (state writes via `statelock.mjs`).
- **`dep-load.mjs` / `dep-install.mjs`** — `loadAjv(dataDir)` dynamic import of ajv by absolute file URL (dev bare-specifier fallback); `ensureDeps`/`depsInstalled` for the lazy pinned ajv install. (The `codex-gate` `sdk-load`/`sdk-install` minus the SDK.)
- **`render.mjs` / `models.mjs` / `args.mjs` / `auth.mjs`** — rendering; model aliases (§6.2); arg parsing; login probe.

---

## 6. Gemini/Antigravity integration details

### 6.1 Driver contract

The driver enforces: **read-only OS sandbox** (`agy-sandbox.wrap`), **subscription login** (strips inherited `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_GENAI_USE_VERTEXAI`), a **pinned Gemini-family model** (§6.2), and a **prompt-enforced JSON shape** matching the review/adversarial schema. It returns a validated payload or a structured error (§8). Unlike `codex-gate` it surfaces **no token usage** (unavailable). It **never** emits a verdict on failure.

Invocation (sole transport):
```js
const { command, args } = agySandbox.wrap(
  ["agy", "--print", prompt, "--model", geminiModel, "--print-timeout", `${timeoutSec}s`],
  { projectDir: realpath(workingDirectory), platform: process.platform }
);                                                   // SANDBOX_UNAVAILABLE → §8, never run unsandboxed
const child = spawn(command, args, { env: stripApiKeys(env), cwd: workingDirectory });
// stdout → tolerant-parse JSON → review-schema.validate(kind, payload)
// empty stdout + exit 0 → CLI_ERROR (non-TTY drop bug), never approve
```
On any spawn/timeout/parse/sandbox error the driver returns a §8 envelope via `classifyError` (RATE_LIMITED / AUTH_REQUIRED / MODEL_UNAVAILABLE / TIMEOUT / SANDBOX_UNAVAILABLE / CLI_ERROR); an unparseable payload → `CLI_ERROR`; a payload that fails validation → `SCHEMA_INVALID`.

### 6.2 Models (family-pinned)

`agy models` exposes multiple families (Gemini 3.x, Claude 4.6, GPT-OSS). For the cross-family thesis (§0) the driver **MUST** run review on a **Gemini** model. `models.mjs`:
- Default: `gemini-pro` → `"Gemini 3.1 Pro (High)"` (review quality).
- Aliases: `flash` → `"Gemini 3.5 Flash (High)"` (faster/cheaper), `pro` → `"Gemini 3.1 Pro (High)"`.
- **Rejects** any model whose resolved name does not start with `Gemini` → `MODEL_UNAVAILABLE` with remediation ("cross-family review requires a Gemini model; '<x>' would defeat independent review"). This guard is unique to `agy-gate`.
- Model names contain spaces/parens → passed as a single `--model` argv element, never shell-interpolated.

### 6.3 Auth, quota & ToS (subscription only)

- Relies on the cached Antigravity login (`~/.gemini/antigravity-cli`).
- **The driver strips** `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_GENAI_USE_VERTEXAI` from the child env ⇒ `agy` always uses the subscription. Mirrors `codex-gate`'s mandatory API-key strip — an exported key would otherwise silently bill the API and defeat the subscription-only premise.
- `/agy-gate:setup` real probe runs a trivial `agy --print` and classifies: **agy-binary-missing** (`AGY_NOT_INSTALLED` → "install Antigravity CLI"), **not-authenticated** (`AUTH_REQUIRED` → "run `agy` and log in"), **authenticated-but-throttled** (`RATE_LIMITED`), or `OK`. **SP-1 caveat (load-bearing):** `agy` startup logs transient `"You are not logged into Antigravity"` singleflight errors that self-resolve — the probe must key off the **final result / exit + parseable output**, not those startup log lines, or it will false-negative on a working login.
- **Setup config single source of truth:** stop-gate/quota knobs live only in `plugin.json` `userConfig` (edited via `/plugin`); Claude Code exports them as env to the `Stop` hook; `setup` *reports* the live effective values (`gateConfigFromEnv`) and uses `AskUserQuestion` to guide intent — never persists a parallel config.

**Quota & ToS risk — mitigation, not just acknowledgement.** High-volume automated use can exhaust the subscription quota, and headless programmatic use under an Antigravity subscription may carry ToS exposure. **This is sharper than `codex-gate`'s:** Google's ecosystem is mid-transition (`gemini-cli` → `agy`, sunset 2026-06-18) and *recently banned third-party tools routing the Code Assist OAuth token* (Feb 2026, with account suspensions). Driving the **official `agy` binary** as a subprocess is the legitimate path (we use Google's own client, we do **not** extract or replay its token), but automated/headless volume still carries risk. Controls in v0.1 (identical posture to `codex-gate` §6.3):
1. **Daily review cap — OFF by default (user choice).** `userConfig.maxReviewsPerDay` (0 = no cap). When > 0, exceeding it returns `QUOTA_GUARD` with remediation (never a silent drop).
2. **Rate-limit backoff & detection (always on):** repeated `RATE_LIMITED` within a window short-circuits further automated calls for a cooldown + visible warning. With the cap off, this is the primary guard.
3. **ToS posture documented:** README states plainly that automated/headless subscription use is at the user's risk; the supported high-volume path is the **future API-key OD** (`@google/genai`).
4. **Escape hatch:** an API-key/Vertex path for high-volume/ToS-safe use is an explicit future OD (not v0.1).

### 6.4 Version-churn handling

Unlike `codex-gate` (whose SDK pins/bundles its own binary), **we drive the `agy` CLI directly and own the churn.** Mitigation:
- The `agy-driver` seam isolates every CLI-shape assumption (flag names, output format) to one file.
- **Version detection** at probe time (`agy --version`); if the detected version is outside a known-good range, `/agy-gate:setup` warns and the driver logs a reduced-confidence note (does not hard-fail unless a contract assumption actually breaks).
- The `--print` contract (single prompt → stdout response) is the **most stable** surface `agy` exposes (vs. the envelope/stream-json formats, which we deliberately do not parse).
- CLI version pinning is out of our control (user-installed binary); the README documents the known-good `agy` version range per plugin release.

---

## 7. Feature designs

### 7.1 Scope resolution (session-first, Git-optional, gap-visible)

**Identical to `codex-gate` §7.1.** Precedence: explicit paths → pasted text/diff → `--session` (PostToolUse tracker, intersected with working-tree/diff when in Git) → `--base <ref>` (`git diff merge-base`) → default (stop-gate=`--session`; manual-in-Git=working-tree diff; else `NO_SCOPE`). Tracker blind spot (Bash-driven edits) made visible: inside Git, the working-tree/tracker set-difference adds Bash-edited files to scope with `coverage:"git-augmented"` + `coverageNote`; outside Git, `coverage:"tracker-only"` + a visible warning. `resolveScope(input, deps) → {ok:true, scope} | {ok:false, error:{code:"NO_SCOPE",…}}`; `scope.coverage` typed enum (`explicit|text|git-augmented|tracker-only|diff`); Git ops + tracker injected.

> **`agy`-specific scope note:** `agy --print` defaults to a scratch workspace at `~/.gemini/antigravity-cli/scratch/` when no workspace is given (SP-1/research caveat) — so the companion **always** runs `agy` with `cwd = workingDirectory` (and the OS sandbox bound to that real path), never relying on the default. For file/text scopes outside a repo, the resolved scope files are placed under a real working directory the sandbox is scoped to.

### 7.2 Review

`prompts/review.md` — correctness / quality / security review → `review-output` schema (§9.1). The prompt **explicitly instructs strict JSON-only output** (no markdown, no fences) matching the schema shape (SP-1 confirmed Gemini honours this).

### 7.3 Adversarial review

`prompts/adversarial-review.md` — "challenge the design; question assumptions and trade-offs; find where it breaks under real conditions; assume it is wrong." Accepts `--focus`. Produces the **adversarial** schema (§9.2).

**`sound` vs "did not run" (per §8).** A `sound` verdict means Gemini ran and found no blocking challenges. It must never be inferred from an empty/failed run. Distinguish: a completed run returning zero challenges → `verdict:"sound"`; a run that failed/timed-out/empty-stdout/unparseable → a structured §8 error, **never** `sound`. `review-schema.mjs` rejects a payload lacking an explicit model-emitted `verdict`.

### 7.4 Stop-gate circuit breaker

Opt-in via `userConfig.stopReviewGate` (default off). A bounded review→fix loop that **provably terminates** and is *designed* to converge on quality but **does not claim guaranteed convergence** — when it cannot make progress it stops and hands to a human (fail open + visible). Grounded in: Self-Refine / debugging-decay (gains plateau past 2–3 iterations); "the stop decision must be external, never the model's"; SonarQube/SARIF fingerprinting; Claude Code's `stop_hook_active` + 8-block backstop.

**Per-`Stop` decision logic:**
```
1. If stop_hook_active == true            → ALLOW (reentrancy guard).
2. Acquire loop-state (keyed by session_id; advisory lock §4.4). iteration += 1.
3. scope = session-touched files (git-augmented when possible, §7.1).
   If empty / diff unchanged since last pass → ALLOW.
4. TRIP CHECKS (any true → OPEN: ALLOW + visible systemMessage summary of unresolved findings):
     - iteration > MAX_ITERATIONS (default 3)
     - no-progress: the set of OPEN blocking fingerprints has not strictly shrunk for 2 rounds
       (set-based, not count-based)
     - oscillation: a fingerprint went addressed → reappeared
   [DELTA vs codex-gate: NO token-budget trip — token usage is not observable on agy (§3).]
5. Run Gemini review. For each finding:
     fp = hash("v1:" + category + normalize(message) + normalize(code_context))
     baselineState vs seen-set: new | unchanged | updated | absent
6. severity = host-derived (category→severity map), NOT the raw model field.
   blocking = findings WHERE severity >= THRESHOLD (default BLOCKER only)
              AND baselineState == new AND status != contested
7. If blocking empty → record clean diff hash → ALLOW.
   Else → mark touched prior findings 'addressed'; any 'addressed' that reappears → 'contested' (excluded);
          return {decision:"block", reason: formatted blocking findings only}.
```

**Severity ownership.** Exactly one source of truth for *gating* severity: **the host**, derived by category. The model-emitted `severity` field (§9.1) is **advisory only**. Identical to `codex-gate`.

**No-progress is set-based, not count-based.** Progress iff `open_blocking_now ⊊ open_blocking_prev`. Identical to `codex-gate`.

**Defaults:**

| Parameter | Default | Rationale |
|---|---|---|
| `MAX_ITERATIONS` | 3 | refinement plateaus past 2–3 |
| `SEVERITY_THRESHOLD` | BLOCKER only | reviewers over-report; raise the bar |
| gate basis | **new findings only** | pre-existing nits never block |
| ~~`TOKEN_BUDGET`~~ | **N/A — removed** | **token usage not observable on `agy --print` (§3); iteration cap is the sole hard termination guarantee** |
| fingerprint | `hash(v1:category+norm(msg)+norm(context))` | location-independent, versioned; `category` from a schema-enforced enum |
| oscillation | addressed→reappeared ⇒ contested | kills the A→B→A quota sink |
| trip behavior | **fail open + visible summary**, hand to human | breaker can't converge ⇒ get out of the way, visibly |
| reentrancy | `stop_hook_active` guard + `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=8` | defense in depth |

**Termination guarantee (delta).** `codex-gate` has two independent hard ceilings (iteration cap **and** token budget). `agy-gate` has **one** (iteration cap) because token usage is unobservable. The iteration cap alone still *provably* terminates the loop; we lose the secondary defense against a single pathologically long review burning quota. Mitigation: `--print-timeout` bounds any single review's wall-clock, and the rate-limit backoff (§6.3) bounds runaway volume.

**Fingerprint stability.** The `category` enum (schema-enforced, §9.1) anchors the fingerprint; per-finding message/titles churn run-to-run, so oscillation/no-progress works at the category-cluster level. Degradation path: if a future `agy`/Gemini regresses on category stability, **disable** oscillation/no-progress trips and rely solely on the iteration cap (logged as reduced-precision mode). Same as `codex-gate`.

### 7.5 Background jobs (v0.1)

Identical to `codex-gate` §7.5: `review --background` → `jobs.mjs` job record in `${CLAUDE_PLUGIN_DATA}/state/<workspace-slug>-<hash>/` (writes via `statelock.mjs`), detached `task-worker` (`{detached:true, stdio:"ignore"}`, `unref`), returns a `jobId`; `status`/`result`/`cancel`; jobs pruned newest-first; `SessionEnd` terminates this session's jobs. The orchestrator subagent and stop-gate remain **synchronous**; background is for ad-hoc manual use only.

---

## 8. Error & failure policy

Structured error envelope from the driver:
```jsonc
{ "code": "RATE_LIMITED | QUOTA_GUARD | MODEL_UNAVAILABLE | AUTH_REQUIRED | AGY_NOT_INSTALLED | SANDBOX_UNAVAILABLE | CLI_ERROR | TIMEOUT | NO_SCOPE | SCHEMA_INVALID",
  "message": "string", "remediation": "string?" }
```
*(Delta vs `codex-gate`: adds `AGY_NOT_INSTALLED` and `SANDBOX_UNAVAILABLE`; renames `CODEX_ERROR`→`CLI_ERROR`.)*

**Principle: fail visibly, never falsely approve.** Failure classes:

1. **Gemini unavailable** (rate-limit / quota-guard / auth / agy-missing / sandbox-missing / CLI error — *not* a finding):
   - **Subagent / orchestrator / manual:** hard fail — propagate the structured error; the caller aborts the story/epic rather than proceeding unreviewed. **An orchestrator with both gates wired MAY fall back to `codex-gate` here** (§0) — the identical verdict contract makes this a drop-in swap.
   - **Stop-gate:** ALLOW the turn to end **with a loud `systemMessage` "⚠ TURN NOT REVIEWED: <reason>"**. Explicitly unreviewed, never "approved".
2. **Parse failure / schema-validation failure** (`CLI_ERROR`/`SCHEMA_INVALID`): tolerant normalization first; if the payload *still* fails, treated as **Gemini unavailable** (class 1). A malformed/empty payload never becomes a passing verdict (guards the non-TTY empty-stdout bug).
3. **Breaker can't converge** (§7.4): fail open + visible summary, hand to human.
4. **Scope coverage gap** (§7.1): a **visible annotation** (`coverage` enum + `coverageNote`), not an error.
5. **`SANDBOX_UNAVAILABLE`** (the platform sandbox binary is missing/blocked): **hard fail with remediation** — the driver never runs `agy` without the read-only sandbox (would breach §10). This is a class-1 failure, not a degrade-to-unsafe.

**Gate degradation under load (mirrors `codex-gate` OD-1).** Single transient failure → ALLOW + visible "NOT REVIEWED". **Persistent** unavailability (N consecutive, `userConfig.notReviewedStreakLimit`, default 3) → escalate the message + actionable remediation (`run /agy-gate:setup` / raise quota / disable gate / **switch to codex-gate**). Hard fail-closed remains user-selectable (`userConfig.stopGateOnUnavailable: "allow"|"block"`, default `"allow"`).

**Timeout policy:** single source of truth for the stop-gate timeout; the value in `hooks.json` matches the spawn timeout in the script and the `agy --print-timeout`. No dead constants.

---

## 9. Output schemas

**Single-schema model (delta from `codex-gate`).** `codex-gate` carried a **dual-schema** design forced by OpenAI's strict structured-output backend (all-required, nullable optionals, no bounds). `agy --print` has **no backend-enforced schema** — the JSON is produced by a prompt instruction — so there is no strict-subset shape. The pipeline is: **prompt instructs strict JSON matching the schema → receive payload → tolerant normalization (strip unknown keys, coerce obvious deviations) → validate against the internal draft-07 schema.** Normalization is best-effort (no forced nulls to strip). A payload that fails validation → `SCHEMA_INVALID` → treated as Gemini-unavailable (§8), never a passing verdict.

> **The two schemas below are byte-for-byte identical to `codex-gate`'s** (§0 verdict-contract requirement). This is intentional and load-bearing: it is what lets an orchestrator treat the two gates as interchangeable for fallback/triangulation. **Do not diverge them** without updating both plugins.

### 9.1 `review-output.schema.json` (defect-oriented)

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object", "additionalProperties": false,
  "required": ["verdict", "summary", "findings", "next_steps"],
  "properties": {
    "verdict": { "enum": ["approve", "request_changes", "comment"] },
    "summary": { "type": "string" },
    "findings": { "type": "array", "items": {
      "type": "object", "additionalProperties": false,
      "required": ["category", "severity", "file", "title", "detail"],
      "properties": {
        "category": { "type": "string" },                 // stable id for fingerprinting (§7.4)
        "severity": { "enum": ["blocker", "major", "minor", "info"] },  // ADVISORY ONLY — not used for gating (§7.4)
        "file": { "type": "string" },
        "line_start": { "type": "integer", "minimum": 1 },
        "line_end": { "type": "integer", "minimum": 1 },
        "title": { "type": "string" },
        "detail": { "type": "string" },
        "suggestion": { "type": "string" }
      }
    }},
    "next_steps": { "type": "array", "items": { "type": "string" } }
  }
}
```
`severity` is **advisory** — gating severity is host-derived from `category` (§7.4). `category` powers fingerprinting; the **prompt constrains it to the closed enum** (`correctness`, `security`, `concurrency`, `performance`, `data-integrity`, `error-handling`, `api-misuse`, `style`, `other`). (Where `codex-gate` enforced the enum via the strict `outputSchema`, `agy-gate` enforces it via the prompt + validates against the draft-07 enum here.)

### 9.2 `adversarial-output.schema.json` (design-oriented)

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object", "additionalProperties": false,
  "required": ["verdict", "summary", "challenges"],
  "properties": {
    "verdict": { "enum": ["sound", "request_changes", "reconsider"] },  // must be model-emitted; absence = error (§7.3)
    "summary": { "type": "string" },
    "challenges": { "type": "array", "items": {
      "type": "object", "additionalProperties": false,
      "required": ["severity", "title", "argument"],
      "properties": {
        "severity": { "enum": ["blocker", "major", "minor", "info"] },  // advisory
        "title": { "type": "string" },
        "target": { "type": "string" },
        "argument": { "type": "string" },
        "failure_mode": { "type": "string" },
        "file": { "type": "string" },
        "recommendation": { "type": "string" }
      }
    }},
    "next_steps": { "type": "array", "items": { "type": "string" } }
  }
}
```

`review-schema.mjs` validates/normalizes both against their files. Errors use the §8 envelope, never mixed into payloads. An empty `challenges` array with explicit `verdict:"sound"` is valid; a missing/failed payload is an error, not `sound` (§7.3).

---

## 10. Security model

- **Read-only via an external OS sandbox** (the core delta from `codex-gate`): the `agy` subprocess runs inside a kernel-enforced read-only sandbox that **denies all writes to the project directory** while leaving `agy`'s own state dirs (`~/.gemini`), temp, and network writable.
  - **macOS:** `sandbox-exec` (Seatbelt) with `(version 1)(allow default)(deny file-write* (subpath (param "PROJECT_DIR")))`. SP-1 **proved** this blocks `agy`'s write at the kernel level (`Operation not permitted`) while the review still completes. `PROJECT_DIR` is the **real resolved path** (Seatbelt matches resolved paths).
  - **Linux:** `bwrap --ro-bind / / … --bind $HOME/.gemini … --share-net` — the whole tree is read-only, only state dirs are re-bound writable, network shared (DNS via `/etc/resolv.conf`).
  - This is the **same mechanism the Codex SDK uses internally** for `sandboxMode:"read-only"` (Seatbelt/Landlock); `agy-gate` does it explicitly because the transport doesn't.
  - **`agy --sandbox` is NOT used for this** — it confines writes *into* the workspace (protects everything *outside*), the opposite of what we need.
  - **Defense-in-depth (optional, config):** a transient `permissions.deny: ["write_file(*)"]` + Tool Permission mode `strict` in the `agy` settings (precedence `Deny > Ask > Allow`). This is an *agent-layer* guardrail (bypassable by prompt-injection/bug); the OS sandbox is the hard boundary.
  - **Fail-closed on sandbox absence:** if the platform sandbox binary is missing, the driver returns `SANDBOX_UNAVAILABLE` (§8) and **refuses to run `agy` unsandboxed** — read-only is a construction guarantee, not best-effort.
- **Trust-boundary scope (clarified).** "Read-only by construction" applies to the **`agy` subprocess**, not the whole plugin. The companion runs via `Bash` with the user's full privileges — a buggy/compromised companion can do anything the user can. Mitigations: minimal audited companion code; no `../`/absolute paths; no secret writes; pinned `ajv`; never invoking `agy` with `--dangerously-skip-permissions` or write-enabling flags; always wrapping the subprocess in the OS sandbox.
- No API-key handling; subscription token owned by `agy`. The driver strips inherited `GEMINI_API_KEY`/`GOOGLE_API_KEY` so a stray env var can't downgrade to API billing. No secrets written to `${CLAUDE_PLUGIN_ROOT}` or session state.
- Subagent has `tools: Bash` only; no `mcpServers`/`hooks`/`permissionMode`.
- Stop-gate runs an external service synchronously on turn end — opt-in, bounded (§7.4), volume-capped (§6.3), fails visibly (§8).
- Shared state writes are locked + atomic (§4.4).

---

## 11. Configuration

### 11.1 `plugin.json`

```jsonc
{
  "name": "agy-gate",
  "version": "0.1.0",
  "description": "Cross-model code review for Claude Code: review, adversarial review, and a converging stop-gate, powered by the Antigravity CLI (agy) on your Gemini subscription.",
  "author": { "name": "Vitor Mendonça" },
  "homepage": "https://github.com/vitorlm/agy-gate-plugin-cc",
  "repository": "https://github.com/vitorlm/agy-gate-plugin-cc",
  "license": "Apache-2.0",
  "keywords": ["gemini", "antigravity", "agy", "code-review", "adversarial-review", "cross-model"],
  "userConfig": {
    "stopReviewGate":        { "type": "boolean", "title": "Enable stop review-gate",
                               "description": "Run a converging Gemini review when a turn ends.", "default": false },
    "stopGateOnUnavailable": { "type": "string",  "title": "Stop-gate behavior when Gemini is unavailable",
                               "description": "allow (warn, NOT REVIEWED) | block (fail-closed)", "default": "allow" },
    "notReviewedStreakLimit":{ "type": "number",  "title": "Escalate after N consecutive NOT REVIEWED turns",
                               "description": "After this many consecutive unreviewed turns, escalate the warning with an actionable remediation.", "default": 3, "min": 1, "max": 20 },
    "reviewModel":           { "type": "string",  "title": "Review model (Gemini family only)",
                               "description": "Gemini model used for review (e.g. 'Gemini 3.1 Pro (High)'). Non-Gemini models are rejected to preserve cross-family review.", "default": "Gemini 3.1 Pro (High)" },
    "maxIterations":         { "type": "number",  "title": "Stop-gate max iterations",
                               "description": "Hard ceiling on stop-gate review->fix rounds before the loop opens and hands to a human.", "default": 3, "min": 1, "max": 10 },
    "maxReviewsPerDay":      { "type": "number",  "title": "Daily automated-review cap (quota guard)",
                               "description": "0 = no cap (default). Set >0 to enforce a daily ceiling on automated reviews.", "default": 0, "min": 0 },
    "severityThreshold":     { "type": "string",  "title": "Stop-gate block threshold",
                               "description": "blocker | major | minor | info", "default": "blocker" }
  }
}
```
`defaultEnabled` omitted (enabled): no always-on token cost; external side effects (stop-gate, quota use) are opt-in/bounded. `claude plugin validate --strict` requires a `description` on **every** `userConfig` field — all populated. *(Delta: no `TOKEN_BUDGET` config — not observable.)*

### 11.2 `marketplace.json`

```jsonc
{
  "name": "vitorlm-agy-gate",
  "description": "Cross-model code review for Claude Code, powered by the Antigravity CLI (agy) on a Gemini subscription.",
  "owner": { "name": "Vitor Mendonça" },
  "plugins": [ { "name": "agy-gate", "source": "./plugins/agy-gate",
                 "description": "Cross-model code review for Claude Code." } ]
}
```

---

## 12. Testing strategy (TDD)

Runner: Node's built-in `node:test` + `node:assert/strict`. `npm run check` = Biome → `tsc` (JSDoc) → `node --test` → `claude plugin validate --strict`. Collaborators are dependency-injected so unit tests need no real `agy`/Git/network/sandbox.

- **Unit (injected fakes, fixture payloads):**
  - `scope.mjs` / `git.mjs` / `session-tracker.mjs` / `session-tracker-hook.mjs` — **identical coverage to `codex-gate`** (explicit/text/session/base/default scopes, `NO_SCOPE`, git-augmented gap, tracker-only coverage, typed enum, empty-session no-op; porcelain parsing; tracker append/de-dup/clear; extractTouched).
  - `review-schema.mjs`: both schemas — valid, missing fields, bad enum, **tolerant normalization (extra keys stripped, no null-stripping needed)**, strict failure → `SCHEMA_INVALID`, **verdict never inferred** (missing/unparseable → error, never approve/sound).
  - **`agy-sandbox.mjs` (NEW):** macOS branch emits correct `sandbox-exec -D PROJECT_DIR=<realpath> -f <profile>` argv; Linux branch emits correct `bwrap` argv with state-dir binds + `--share-net`; **`SANDBOX_UNAVAILABLE`** when the platform binary is absent; `projectDir` realpath resolution; **profile content asserted** (`deny file-write* (subpath …)`). *(Real-sandbox enforcement is covered by an opt-in integration test, gated like SP-1.)*
  - `agy-cli-driver.mjs` / `agy-driver.mjs`: **wraps the spawn via `agy-sandbox`**; **strips `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_GENAI_USE_VERTEXAI`**; **pins a Gemini model and rejects non-Gemini → `MODEL_UNAVAILABLE`**; tolerant-parses stdout JSON; **empty-stdout+exit-0 → `CLI_ERROR` (never approve)**; maps spawn/timeout/parse/sandbox throws → §8 envelope; seam wires the real validator (fake spawn injected).
  - `models.mjs`: alias/default resolution; **non-Gemini rejection**; names with spaces/parens passed as a single argv element.
  - `loop-state.mjs` + stop-gate: new-finding blocks, nit/pre-existing don't, fingerprint dedup, oscillation→contested, **set-based no-progress**, iteration trip, **NO budget trip (absent by design)**, `stop_hook_active` allow, **host-derived severity gating**.
  - failure policy (§8): unavailable → hard fail (caller, **incl. fallback-to-codex-gate hint**) vs visible-allow (gate); streak escalation; `stopGateOnUnavailable:block`; **`SANDBOX_UNAVAILABLE` → hard fail, never unsandboxed run**; breaker trip → visible summary; `sound` never inferred from failed adversarial run.
  - `quota.mjs`: `maxPerDay=0` → no cap; `>0` → `QUOTA_GUARD` with daily reset; rate-limit cooldown.
  - `auth.mjs` / `setup.mjs`: `probeAuth` classification — `OK` / `AUTH_REQUIRED` / `RATE_LIMITED` (throttled ≠ not-authed) / **`AGY_NOT_INSTALLED`** / `CLI_ERROR`; **ignores startup `"not logged into Antigravity"` singleflight noise, keys off final result**; `runSetup` authed/not-authed/throttled/agy-missing/gate-config surfacing; `gateConfigFromEnv` env→view. Injected probe — never touches `agy`/network/`~/.gemini`.
  - `dep-install.mjs` / `dep-load.mjs`: `depsInstalled` false unless `ajv` present; `ensureDeps` skip/install-once/structured-error (injected install, no real npm); `loadAjv` resolves from a fake data-dir package + bare-specifier dev fallback.
  - `statelock.mjs` / `state.mjs` / `jobs.mjs` — **identical coverage to `codex-gate`** (serialization, stale-break, atomic write; per-workspace slug+hash; background lifecycle + orphan recovery + SessionEnd cleanup, injected spawn/clock/id).
  - `render.mjs` / `args.mjs` / `pipeline.mjs` — verdict/challenge/error presentation; flag parser; `runReview` (quota gate short-circuit, `NO_SCOPE` without a CLI call, happy path composes prompt + inverts `skipGitRepoCheck`, `RATE_LIMITED` backoff record, adversarial focus forwarded).
  - **fingerprint degradation (§7.4):** category-unstable → oscillation/no-progress disabled, iteration cap still terminates, reduced-precision logged.
- **Spike harnesses (gated on real `agy` login):**
  - **SP-1 ✓ (done):** `agy --print` on subscription; prompt-enforced JSON parseability; OS-sandbox read-only enforcement (Seatbelt write-block proven); token-usage observability (negative); model-family enumeration. `spike/sp-1/FINDINGS.md`.
  - **V-1 (reuse `codex-gate` harness):** cross-model (Gemini) vs same-model (Claude) reviewer on the seeded-defect fixtures; pure deterministic scoring → §0 verdict. `geminiReviewer` wired to the shipped driver (read-only/subscription); `claudeReviewer` human-supplied. Live run + 1.0 gate decision manual/quota-gated.
- **Integration (opt-in):** end-to-end review of a tiny fixture **under the real OS sandbox**, asserting (a) a correct verdict and (b) the project tree is byte-identical after the run (no writes leaked).
- **Tooling:** `node:test`; Biome + `tsc` via JSDoc; ajv loaded dynamically via `loadAjv(dataDir)` (resolves from `${CLAUDE_PLUGIN_DATA}` in a distributed install); runtime dep pinned in the lockfile (`ajv@8.17.1`); CHANGELOG discipline; red→green TDD.

---

## 13. Versioning & distribution

- SemVer from `0.1.0`; bump every release; CHANGELOG per release.
- Runtime `ajv` pinned via committed `package-lock.json`.
- **`agy` is a user-installed prerequisite** — the README documents the known-good `agy` version range per plugin release (§6.4); the plugin does not bundle or install it.
- Marketplace source by branch initially; pin by `sha` once published.
- `claude plugin validate --strict` in CI.
- Local dev: `claude --plugin-dir ./plugins/agy-gate`; `/reload-plugins`.

---

## 14. Open decisions

| ID | Decision | Adopted default | Alternative |
|---|---|---|---|
| OD-1 | Stop-gate on Gemini **unavailability** | **Allow + loud "NOT REVIEWED"**, streak escalation, user-selectable `block` mode, **fallback-to-codex-gate hint** (§8) | Hard fail-closed by default |
| OD-2 | Manual commands model-invocability | **`disable-model-invocation: true`** (auto path = subagent) | Also model-invocable |
| OD-3 | `defaultEnabled` | **Enabled** | `false` |
| OD-4 | License | **Apache-2.0** | MIT |
| OD-5 | Transport | **`agy --print` sole transport (subscription headless) — SP-1 confirmed; no API-key/SDK fallback** | `@google/genai` (API key); `gemini-cli --acp` (deprecated) |
| OD-6 | Background jobs | **Included in v0.1** | Defer |
| OD-7 | Scope default for stop-gate | **Session-touched files, git-augmented** (§7.1) | Working-tree diff |
| OD-8 | High-volume auth / quota cap | **Subscription only; `maxReviewsPerDay` cap OFF by default** | Default-on cap; future `@google/genai` API-key path for ToS-safe high volume |
| OD-9 | Cross-model value | **Validate via V-1 before 1.0** (reuse `codex-gate` harness) | Assume the premise (rejected) |
| **OD-10** | **Read-only mechanism** | **External OS sandbox (Seatbelt/bwrap), fail-closed on absence (§10); `agy --sandbox` rejected (wrong direction)** | Disposable APFS/reflink clone (fast-path fallback); agy `permissions.deny` alone (agent-layer only) |
| **OD-11** | **Model family** | **Pin Gemini; reject non-Gemini (§6.2)** | Allow any `agy` model (rejected — defeats §0) |
| **OD-12** | **Token-budget stop-gate trip** | **Removed — token usage not observable (§3/§7.4); iteration cap is sole hard ceiling** | (n/a — would require an observable usage signal) |
| **OD-13** | **Coupling to `codex-gate`** | **Sibling by copy; verdict contract identical (§0/§9); no shared core (Rule of Three — 2 gates, not 3+)** | Extract `gate-core` shared package |

---

## 15. Build sequence (informative; full plan via writing-plans)

1. ~~**SP-1 spike**~~ **DONE (2026-06-15)** — `agy --print` on subscription + prompt-enforced JSON + OS-sandbox read-only (Seatbelt write-block proven) + token-usage (negative) + model-family enumeration. Deltas folded into §3/§5.6/§6/§7.4/§9/§10. Evidence: `spike/sp-1/FINDINGS.md`.
2. Repo scaffold: `marketplace.json`, `plugin.json`, README/LICENSE/CHANGELOG, dev tooling (Biome, `tsc`, `node:test`), committed lockfile (pins `ajv`).
3. Schemas (§9): **copy `review-output.schema.json` + `adversarial-output.schema.json` verbatim from `codex-gate`** + `review-schema.mjs` (single-schema `validate` with tolerant normalization, no `dropNulls`).
4. **`agy-sandbox.mjs` (NEW)** — Seatbelt/bwrap wrapper builder + `SANDBOX_UNAVAILABLE`; profile content; realpath resolution. Then `agy-driver.mjs` (seam) + `agy-cli-driver.mjs` (spawn-through-sandbox; strips API-key env; Gemini-pin; tolerant parse; empty-stdout guard; §8 mapping).
5. `scope.mjs` (+ `git.mjs`) with git-augmented gap detection + `session-tracker.mjs` + `session-tracker-hook.mjs` PostToolUse hook — **port from `codex-gate`**.
6. `statelock.mjs` — port from `codex-gate`.
7. `review` / `adversarial-review` foreground pipeline (`pipeline.mjs`) + prompts (**strict-JSON-only instruction**) + `render.mjs` + `args.mjs` + `models.mjs` (**Gemini-pin**) + quota guard + `agy-companion.mjs` dispatcher + command files.
8. `agents/agy-reviewer.md` (thin forwarder) + `skills/agy-reviewing` (SKILL.md + references/prompting.md).
9. `loop-state.mjs` (**no token budget**) + `stop-review-gate-hook.mjs` (opt-in, fail-open, OD-1 + fallback hint) + `session-lifecycle-hook.mjs` + `dep-install.mjs` (lazy pinned ajv) + `dep-load.mjs`; SessionStart/Stop/SessionEnd wired.
10. Background jobs: `state.mjs` + `jobs.mjs` + detached `task-worker` + `status`/`result`/`cancel` + `SessionEnd` termination — port from `codex-gate`.
11. `/agy-gate:setup` probe (authed vs throttled vs **agy-missing**, ignoring startup noise) + gate/quota config: `auth.mjs` + `setup.mjs` + `setup` subcommand + `commands/setup.md`.
12. V-1 validation harness — **reuse `codex-gate` `spike/v-1/`**, swap the reviewer injection to the `agy` driver.
13. `claude plugin validate --strict` (plugin + marketplace) + README (full `/agy-gate:` surface, install, ToS/trust posture §6.3, known-good `agy` version range, `userConfig` table, dev `npm run check`) + CHANGELOG; secret scan; publish (human `git push`).
