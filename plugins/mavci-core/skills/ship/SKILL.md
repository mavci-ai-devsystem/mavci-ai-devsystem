---
name: ship
description: Run the whole Mavci chain from one request - architect to builder to verifier to scribe, with the rework loop, stopping at every operator gate. Use when the operator says what they want built rather than naming an agent or a phase.
argument-hint: "<what you want built>  (or nothing, to continue the open task)"
allowed-tools: Read, Grep, Glob, Bash(node *)
---

# Ship

Request: `$ARGUMENTS`

Next step: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" 2>&1`

## If the block above did not run

It is produced by inline shell substitution, which Claude Code does not execute
under the `disableSkillShellExecution` policy, in a Cowork session, or on a
read-only skill load on a coordinator — it substitutes a plain string — and which
leaves an error in place of the output when the command itself fails
(NATIVE-CAPABILITIES 2.11). Treat it as **absent** if it holds
`[shell command execution disabled by policy]`, `[shell command not executed:`,
`Shell command failed for pattern`, `Shell substitution failed for pattern`,
`Shell command permission check failed for pattern`, or a node error.

Absent is not a pass, and here it is not recoverable by reading a file: the whole
of this command is running the router and obeying it. Say the router did not run,
run it yourself as step 0, and stop if that also fails.

## What this is

Every other command in this plugin is one step. This one is the chain: it asks
the router what happens next, does exactly that, and asks again. **You decide
nothing about ordering.** The router is `scripts/lib/route.mjs`, it is a pure
function of the control plane, and it is asserted by `check-route.mjs` — which is
the only reason it is safe for you to follow it without re-deriving it.

If you find yourself reasoning about which agent should go next, stop: that is
the router's job, and a second opinion about it is a second writer for one fact.

## The loop

Repeat until an action is the operator's, or until **twelve** router
consultations in one invocation — whichever comes first.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --json --request "$ARGUMENTS"

Pass `--request` only while no task is open; once one is, drop it — a request
given to a router that already has a task is noise, and the router ignores it.

The answer has `action`, `dispatch`, `task_id`, `why` and `steps[]`. Run every
command in `steps[]`, in order, then dispatch the agent in `dispatch` if there is
one. **`dispatch: null` means no agent may proceed** — it is a statement, not an
omission.

| `action` | what you do |
|---|---|
| `plan` | run the steps, then delegate to `@agent-mavci-architect` with the task id, the request verbatim and the manifest path. When it returns, **print the acceptance criteria** before continuing. |
| `build` | run the steps, then delegate to `@agent-mavci-builder` with the task id and the spec path. |
| `rework` | run the steps, then delegate to `@agent-mavci-builder` with the task id, the spec path, **and the failing verdict's `checks[]` verbatim** — file paths and line numbers. Do not summarise them. |
| `verify` | run the steps, then delegate to `@agent-mavci-verifier` with the task id. It runs `verify.mjs --record --task <id>`; you do not run it for it. |
| `document` | run the steps, then delegate to `@agent-mavci-scribe` with the task id, the verdict path and the spec path, asking for a changelog entry and a task summary. Run the closing steps after it returns, not before. |
| `blocked` | **stop.** Print `why` and every step verbatim. Do not retry, do not reset attempts, do not waive. |
| `release_gate` | **stop.** Print `why` and the steps. The release gate and the deploy behind it are the operator's. |
| `unverified` | **stop.** Enforcement did not run. Print `why`. Nothing may be built on unchecked code. |
| `idle` | **stop.** Ask what to build. |
| `not_connected` | **stop.** Point at `/mavci-core:connect`. |

After each agent returns, run the router again. Do not assume the answer.

## The ceiling on this loop

Twelve consultations is roughly plan, three build/verify pairs, document, and
slack. If you reach it, **stop and say so**, naming the last action and the task
id. A loop that runs until something happens to end it is the failure mode this
system exists to prevent, and an orchestrator with no ceiling is a retry policy
with no ceiling one level up.

## What you must not do

- **Do not run `verify.mjs` yourself.** The verifier agent is the component that
  interprets a failing build, and until now no skill invoked it — so it shipped
  three times, was never once run, and looked identical to a working one. If you
  do its job, that stays true.
- **Do not fix a violation yourself** on a `rework`. The builder does that. You
  are the orchestrator; an orchestrator that edits application code is the
  builder with a different name and none of the builder's constraints.
- **Do not move the phase except through the steps the router names.** The phase
  gate is what decides whether application code is writable at all.
- **Do not run `--reset-attempts`, `--waive`, `--reseal`, `--baseline-init` or
  `retro.mjs --apply`.** Those are the operator's, they are gated by caller, and
  the router never names them as a step you take — only as a move the operator
  might make.
- **Do not continue past a `blocked`, `release_gate`, `unverified` or `idle`.**

## Why this is model-invocable when the other commands are not

`/mavci-core:plan`, `/mavci-core:build`, `/mavci-core:verify`,
`/mavci-core:waive`, `/mavci-core:release` and `/mavci-core:guardian` all carry
`disable-model-invocation: true`, because each is a step the operator chooses to
take. This one is the whole chain, and the point of it is that the operator says
what they want ONCE rather than naming five agents in order — so it has to be
reachable from an ordinary sentence.

**It loosens nothing, and the reason is where the gates live.** `risk-guard.mjs`
authorises `state.mjs` by CALLER, not by which command invoked it: the main
session is the main session whether the operator typed `/mavci-core:ship` or you
selected it, and every privileged flag stays denied to every subagent either way.
The three operator gates — `release_gate`, `blocked`, `unverified` — are returned
by the router with `dispatch: null` and are asserted to be, in
`check-route.mjs`. Nothing here routes around a control; it removes the operator
from the handoffs, which were never a control in the first place — only an
absence of automation that had been described as a design.

## The spec review, which this does NOT stop for

`/mavci-core:plan` step 4 stops and asks the operator whether the acceptance
criteria are right before building. This command prints them and continues, and
that is a deliberate difference rather than an oversight: a wrong spec is
recoverable — it surfaces as a failing verify and costs an attempt out of three —
so it is not in the set of things the operator must approve. An operator who
wants that gate has it: `/mavci-core:plan "<request>"` is unchanged and still
stops there. The gates this command does not touch are the irreversible ones.
