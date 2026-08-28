---
name: build
description: Implement an approved task spec. Delegates to the builder agent, enforces the retry ceiling, and records each attempt. Use after /mavci-core:plan.
argument-hint: "<task-id>"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *)
---

# Build

Task: `$ARGUMENTS`

State: !`node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --show 2>&1`

## Steps

1. Read `.mavci/control/tasks/<id>.json`.

   **If `status` is `blocked`, or `attempts >= max_attempts`, stop.** Do not
   delegate. Print the verdicts from `.mavci/control/verdicts/<id>-attempt-*.json`
   and offer exactly three moves:
   - `/mavci-core:retro <id>` — turn the failure into a system fix
   - `/mavci-core:waive <check_id> <path> <reason>` — if the check is wrong
   - `node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --reset-attempts <id>` — after
     the operator has changed something

   The ceiling exists so a loop ends with a decision. Do not talk yourself past it.

2. Set the phase to `build` if it is not already.

3. Delegate to `@agent-mavci-builder` with the task id, the spec path, and — if
   this is a retry — **the previous verdict's `failures[]` verbatim**. Those
   entries carry file paths and line numbers; making the builder rediscover them
   wastes the attempt it has left.

4. When it returns, read its JSON report.
   - `status: "done"` → tell the operator to run `/mavci-core:verify <id>`
   - `status: "failed"` → the attempt counter has advanced; report what failed
   - `status: "escalated"` → relay the question, do not answer it yourself
   - `blocked_by: "risk_tier_3:*"` → a tier-3 operation was required. That needs
     the operator, and no amount of retrying changes it.
