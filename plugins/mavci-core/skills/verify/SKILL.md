---
name: verify
description: Verify a task against its acceptance criteria and the standards checker. Delegates to the verifier agent, which runs the checker, the type check, the build and the tests, and records an attributed verdict. Use after /mavci-core:build reports done.
argument-hint: "<task-id>"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(git *)
---

# Verify

Task: `$ARGUMENTS`

Gate: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" --mark-dirty --session="${CLAUDE_SESSION_ID}" 2>&1`

Next step: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" 2>&1`

Working tree: !`git status --porcelain 2>/dev/null | head -30`

## First: did those blocks run?

Inline shell substitution has three paths on which Claude Code does not run the
command at all and substitutes a plain string — the `disableSkillShellExecution`
policy, a Cowork session, and a read-only skill load on a coordinator — and a
fourth on which the command runs and fails, leaving an error where the output
should be. None is visible to this skill and none is under its control
(NATIVE-CAPABILITIES 2.11). Treat a block as **absent** if it holds
`[shell command execution disabled by policy]`, `[shell command not executed:`,
`Shell command failed for pattern`, `Shell substitution failed for pattern`,
`Shell command permission check failed for pattern`, or a node error.

If the **Gate** block did not print `gate armed`, say so: the Stop-hook backstop
is not armed for this session, and the verifier's own recorded run is then the
only thing that will record anything.

**A probe that did not run is not a pass.** Say which block was absent, in your
first line, and read the file yourself before continuing.

## Steps

1. If no task id was given, take it from the router block above. If there is
   still none, stop: an unattributed verification is not a verification, and
   `verify.mjs --task` refuses rather than writing an anonymous verdict.

2. **Delegate to `@agent-mavci-verifier`**, giving it the task id and the spec
   path. It runs the checker with `--record --task <id>`, the type check, the
   build and the tests, then checks every acceptance criterion against the diff.

   **You do not run the checker for it.** That is the whole of this change: for
   three releases this command did the verifier's work inline, so the agent
   shipped, was installed, was never once invoked, and was indistinguishable from
   a working one. Doing its job here makes that true again.

   The verifier cannot edit anything — `Edit`, `Write` and `NotebookEdit` are
   absent from its context — which is exactly why it is the component that judges.

3. When it returns, read the verdict it recorded. Then run the router:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs"`

   It reads that verdict and says what happens next. **Do it, or report it.**
   On a pass it names the scribe and the closing steps; on a failure under the
   ceiling it names the rework, which is `/mavci-core:build <id>` with the
   failing checks carried over; at the ceiling it names `--block` and stops.

4. Retire fixed debt on a pass:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --baseline-prune`

## Reporting

State pass or fail in the first line, sourced from the verdict the verifier
recorded — not from any preview and not from your own reading of the code.

On failure, list what failed with file and line, and **do not fix it here**.
Verification and implementation are separate phases precisely so that the thing
judging the work is not the thing that wrote it. The rework is a builder
dispatch, and the router names it.

If the verifier reports `blocked_by: "no_task_id"`, that is this command's fault,
not the agent's: it was dispatched without the one input it cannot proceed
without. Supply the id and dispatch again.

If a check looks like a false positive, say so explicitly and name
`/mavci-core:waive`. Do not work around it silently.
