---
description: List background agy review jobs (or inspect one by id).
argument-hint: "[jobId]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Background agy review jobs for this workspace:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" status $ARGUMENTS`

Relay the table verbatim. Each row is `<jobId> <status> <kind> (<scope>) <updatedAt>`. Use `result <jobId>` to fetch a finished job's verdict, or `cancel <jobId>` to stop a running one.
