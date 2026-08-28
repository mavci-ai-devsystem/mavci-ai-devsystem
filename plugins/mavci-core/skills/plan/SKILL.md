---
name: plan
description: Turn a feature request into an implementable task spec with objectively checkable acceptance criteria. Delegates to the architect agent. Use at the start of any feature.
argument-hint: "<what you want built>"
disable-model-invocation: true
allowed-tools: Read, Bash(node *)
---

# Plan

Request: `$ARGUMENTS`

State: !`node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --show 2>&1`

## Steps

1. If the project is not connected, stop and point at `/mavci-core:connect`.
2. Set the phase, so application code is frozen while planning:
   `node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --set-phase plan`
3. Allocate the task:
   `node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --new-task "<short title>"`
4. Delegate to `@agent-mavci-architect` with: the task id, the request verbatim,
   and the manifest path. It writes the spec to `.mavci/tasks/<id>-<slug>.md`.
5. When it returns, show the operator the acceptance criteria and **ask whether
   they are right before building**. A wrong spec is the most expensive thing in
   this system to discover late.
6. On approval: `node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --set-phase build`
   and tell them to run `/mavci-core:build <id>`.

If the architect escalates, relay the question rather than deciding for them.
