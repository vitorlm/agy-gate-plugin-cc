---
description: Fetch a completed background agy review's structured verdict.
argument-hint: "<jobId>"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Result of background agy review job `$ARGUMENTS`:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" result $ARGUMENTS`

Relay the output verbatim — it is the rendered verdict for a finished job, a "still running" notice, or a structured `⚠ <CODE>` error. Do **not** re-judge or summarize the findings away; this is an independent reviewer's verdict. If the job is still running, check again later with `status <jobId>`.
