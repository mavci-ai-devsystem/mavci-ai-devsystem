---
name: plan
description: Turn a feature request into an implementable task spec with objectively checkable acceptance criteria. Delegates to the architect agent. Use at the start of any feature.
argument-hint: "<what you want built>"
disable-model-invocation: true
allowed-tools: Read, Bash(node *)
---

# Plan

Request: `$ARGUMENTS`

State: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --show 2>&1`

## If the block above did not run

It is produced by inline shell substitution, which Claude Code does not execute
at all under the `disableSkillShellExecution` policy, in a Cowork session, or on
a read-only skill load on a coordinator — it substitutes a plain string — and
which leaves an error in place of the output when the command itself fails
(NATIVE-CAPABILITIES 2.11). Treat it as **absent** if it holds
`[shell command execution disabled by policy]`, `[shell command not executed:`,
`Shell command failed for pattern`, `Shell substitution failed for pattern`,
`Shell command permission check failed for pattern`, or a node error where the
output should be.

Absent is not a pass. Say in your first line that the state probe did not run,
and read `.mavci/control/state.json` yourself before step 1. Do not assume the
project is connected, and do not assume a phase.

## Steps

1. If the project is not connected, stop and point at `/mavci-core:connect`.
2. Enter the plan phase and allocate the task, as one command:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --begin-plan "<short title>"`

   It freezes application code and hands back a task id in a single write to
   `state.json`. This was two commands until 0.1.22. On 2026-09-02 an external
   classifier denied the second one after the first had already moved the phase,
   and the project sat frozen with nothing to plan against until a human ran the
   blocked command by hand. If `--begin-plan` is refused, **nothing has moved** —
   report that and stop. Do not fall back to `--set-phase plan` followed by
   `--new-task`: that is the sequence this command exists to replace, and running
   it by hand rebuilds the gap.
3. Delegate to `@agent-mavci-architect` with: the task id, the request verbatim,
   and the manifest path. It writes the spec to `.mavci/tasks/<id>-<slug>.md`.
4. When it returns, show the operator the acceptance criteria and **ask whether
   they are right before building**. A wrong spec is the most expensive thing in
   this system to discover late.
5. On approval, RECORD it rather than acting on it directly:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --approve-spec <id>`

   That writes `spec_approved` on the control task, with the spec's content hash.
   It is what turns step 4's conversation into a fact the rest of the system can
   read - and it is the difference between the orchestrator executing a decision
   and making one. Nothing advances a phase without it.

   Then the transition, which is scoped to the task and refuses if the approval
   is missing or if the spec has changed since:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --advance-phase <id> --from plan --to build`

   Do NOT use `--set-phase build` here. That is the free override - any phase, any
   time, no precondition - and it is the operator's, confirmed. The scoped command
   is the one the normal path uses.

   Then tell them to run `/mavci-core:build <id>`, or `/mavci-core:ship` to let the
   chain carry it the rest of the way.

If the architect escalates, relay the question rather than deciding for them.
