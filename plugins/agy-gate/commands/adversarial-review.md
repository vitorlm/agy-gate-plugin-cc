---
description: Adversarial cross-model review of a design or document via Antigravity CLI / Gemini (read-only).
argument-hint: "[files...] | --text <content> [--focus <text>] [--model pro|flash|<id>] [--json]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Glob, Grep, AskUserQuestion
disable-model-invocation: true
---

Run a Gemini adversarial review — challenge the design's assumptions, trade-offs, and failure modes. Works on a standalone file or pasted text (no Git required).

1. Run the companion:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" adversarial-review $ARGUMENTS
   ```

   Use `--focus <text>` to steer the challenge at a specific assumption or decision.

2. Relay its output verbatim — the rendered challenges (or a structured `⚠ <CODE>` error). Do **not** soften or dismiss the challenges; the point is an independent model trying to break the design.
3. On `NO_SCOPE`, ask the user for a file or `--text` to review.
