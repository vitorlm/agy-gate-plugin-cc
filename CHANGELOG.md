# Changelog

All notable changes to agy-gate are documented here. Format: [Keep a Changelog](https://keepachangelog.com/); versioning: [SemVer](https://semver.org/).

## [0.1.0] - 2026-06-15

### Added

- **Cross-model code review** via `/agy-gate:review` — on-demand Gemini review of files, session scope, base-diff, or pasted text. Identical verdict schema to `codex-gate`.
- **Adversarial review** via `/agy-gate:adversarial-review` — adversarial-prompt variant challenging assumptions in the current code changes.
- **Setup command** (`/agy-gate:setup`) — auth probe (probes `agy --print` to distinguish AUTH_REQUIRED from RATE_LIMITED), runtime dep pre-install (ajv@8.17.1), effective config report.
- **Background jobs** — `/agy-gate:status`, `/agy-gate:result`, `/agy-gate:cancel` for async review dispatch with pid-tracked lifecycle and statelock atomicity.
- **`agy-reviewer` subagent** — Claude Code subagent type for orchestrator-driven independent review spawning.
- **`agy-reviewing` skill** — skill surface for direct Gemini review invocation from conversations.
- **Converging stop-gate** (`stopReviewGate: true`) — automatic Gemini review at every Claude Code turn end. Circuit-breaker terminates by iteration cap (default 3 rounds); no token budget (token usage is unobservable via `agy --print`). New-findings-only gating with fingerprint-based oscillation detection (contested findings excluded permanently).
- **OS read-only sandbox** — macOS: `sandbox-exec` Seatbelt profile; Linux: `bwrap` (experimental, unverified on real Linux host). Fail-closed: returns `SANDBOX_UNAVAILABLE` rather than running unsandboxed.
- **Gemini family enforcement** — `assertGemini()` guard rejects non-Gemini model IDs at configuration time. `pro`/`flash` aliases expand to canonical Gemini model strings.
- **API key stripping** — `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` stripped from the subprocess environment. Reviews use the Antigravity subscription session, not API keys.
- **`AGY_NOT_INSTALLED` error code** — distinct from `CLI_ERROR`; emitted when `agy` is not on PATH, with install remediation.
- **Tolerant JSON parsing** — strips markdown fences and falls back to first-brace-span extraction before failing with `CLI_ERROR`.
- **Session tracker hook** — records files edited via Write/Edit/NotebookEdit for session-scope review augmentation.
- **Lifecycle hook** — SessionStart records session metadata; SessionEnd cancels orphaned background jobs and cleans session state.
- **Full test suite** — 175 unit tests, zero external test framework (`node:test` + `node:assert/strict`). Seam-injection pattern: all I/O collaborators injected so tests run without filesystem, network, or subprocess access.
- **Dev tooling** — Biome 2.5.0 (lint + format), TypeScript 6 JSDoc typecheck (no build step), `claude plugin validate --strict`.

### Architecture notes

- Transport: `agy --print` (subprocess, not SDK). No token telemetry — `usage` fields removed entirely from all types and logic.
- Runtime dep: `ajv@8.17.1` lazily installed into `CLAUDE_PLUGIN_DATA` on first review; no install at plugin load time.
- Port base: mechanical rename of `codex-gate`. `CODEX_*` env vars → `AGY_*`; `ensureSdk` → `ensureDeps`; `sdk-install.mjs` → `dep-install.mjs`; `CODEX_ERROR` → `CLI_ERROR`; auth file `~/.codex/auth.json` → `~/.gemini/antigravity-cli`.

## [Unreleased]

_(future changes go here)_
