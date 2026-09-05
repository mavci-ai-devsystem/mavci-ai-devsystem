---
name: ship
description: Run the whole Mavci chain from one request - architect to builder to verifier to scribe, with the rework loop, stopping at every operator gate. Use when the operator says what they want built rather than naming an agent or a phase.
argument-hint: "<what you want built>  (or nothing, to continue the open task)"
allowed-tools: Read, Grep, Glob, Bash(node *)
---

# Ship

Request: `$ARGUMENTS`

Next step: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --request "$ARGUMENTS" 2>&1`

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

## Read your own outputs

**Never ask the operator to paste in something you can run.** Terminal output, a
server log, the result of a command, the response of an endpoint: if you can
obtain it, obtain it.

This is not a convenience. On 2026-09-05 an operator hand-carried a 502 and its
timing, a `route.ts:104` server log and a probe result into the session, and the
diagnosis still took **two rounds and eight candidate causes, none correct** -
settled in the end by a probe that answered `429 insufficient_quota` **in 0.58
seconds** and had been available from the first minute. None of those relays
required a decision from anybody.

- **To see the application running, start it in the BACKGROUND and read from
  there.** A dev server never exits, so a foreground call blocks the turn - which
  is the only reason this was ever the operator's job. It is a constraint of the
  tool, not of the risk policy: `Bash(npm run *)` is in the project's allow list
  and no rule in `risk-guard.mjs` touches it.
- **Before a SECOND round of diagnosis on the same symptom, name the cheapest
  probe that DISCRIMINATES between your candidates, and run that first.** Two
  rounds that inherit the first round's frame are one round with more words. A
  transport error is not evidence of a transport problem.
- **Ask the operator only for what is genuinely outside your reach** - a browser
  viewport, a provider's console, a live credential, another repository, the
  contents of a `.env` - and say which of those it is when you ask, so they can
  tell a real limit from a missing capability.

## Ask in the session. Hand over only what must be handed over

When the router returns an operator action, **do not print a command and fall
silent.** Ask the question, in one sentence, with what is needed to answer it -
then act on the answer:

- **If the next step's authority is already on disk, RUN IT.** That is the whole
  of `WORKFLOW_MOVES` (`--begin-plan`, `--advance-phase`, `--attempt`,
  `--task-status`, `--block`), and `risk-guard.mjs` exempts those from the
  operator confirm precisely because carrying out a recorded decision is not
  making one.
- **If the step RECORDS the decision itself, hand the operator the command.**
  Today that is `--approve-spec` and `--waive`, and the reason is not authority
  but evidence: `state.mjs` writes `by: 'operator'` as a constant, so the file is
  byte-identical whether the operator ran it or you did. Until the record can
  carry who was asked and what they answered, running it for them would replace a
  weak guarantee with none.
- **You MAY run `doctor --sync` and `state.mjs --record-corpus`.** Neither
  records a decision. `--sync` writes the installed plugin version so CI clones
  the matching tag; `--record-corpus` records an outcome that is COMPUTED, and
  refuses seven different ways for a caller to supply the answer
  (`state.mjs:1431-1443`). `--record-corpus` is still tier 2 and will prompt -
  that prompt is the operator seeing it happen, not the operator deciding it.

## The loop

Repeat until an action is the operator's, or until **twelve** router
consultations in one invocation — whichever comes first.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --json --request "$ARGUMENTS"

Pass `--request` only while no task is open; once one is, drop it — a request
given to a router that already has a task is noise, and the router ignores it.
The preflight above passes it unconditionally, which is the same statement from
the other side: every request-sensitive branch sits in the no-task-open arm, so
the router discards `--request` exactly when this paragraph says to. Bare
`/mavci-core:ship` expands to `--request ""`, which is falsy and routes as no
request at all.

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
| `incomplete` | **stop.** The verdict does not say whether the acceptance criteria were met. Run step 1 — `verify.mjs --run-criteria <id>` EXECUTES them and computes the answer — and consult the router again. If it refuses because the spec declares no `mavci-criteria` block, **stop and say so**: nothing can execute that spec's criteria, retrofitting it would break its approval, and the remaining exit is the operator's `--task-status <id> --status done`, which closes the task on evidence the control plane does not hold. That is theirs to spend, not yours. |
| `awaiting_approval` | **stop.** A spec is written and the operator has not approved it, or it changed after approval. Print `why` and the acceptance criteria. **You may not run `--approve-spec` yourself** - it records the operator's decision, and a decision recorded without them is not a record of anything. |
| `blocked` | **stop.** Print `why` and every step verbatim. Do not retry, do not reset attempts, do not waive. |
| `release_gate` | **stop.** Print `why` and the steps. The release gate and the deploy behind it are the operator's. |
| `unverified` | **stop.** Enforcement did not run. Print `why`. Nothing may be built on unchecked code. |
| `idle` | **stop.** Ask what to build. |
| `not_connected` | **stop.** Point at `/mavci-core:connect`. |

**One of those six stopping actions is new, and it is the point of the chain**
**rather than an interruption to it.** `awaiting_approval` is where a written spec
waits on a person. Everything downstream of it - the build, the verdict, the
rework loop, the release gate - is the system carrying out a decision that is on
disk. Without it the orchestrator would be deciding what to build, which is a
different act with the same shape.

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
- **Do not move the phase except through the steps the router names**, and never
  with `--set-phase`. The router names `--advance-phase <id> --from <x> --to <y>`,
  which is scoped to one task, refuses a step that is not the next one, refuses a
  task whose spec the operator has not approved, and refuses again if the spec
  changed after that approval. `--set-phase` is the free override with none of
  those refusals; it is the operator's and it confirms. If a router step ever
  reads `--set-phase`, that is a defect in the router - report it, do not run it.
- **Do not run `--approve-spec`.** It is the one command in the chain whose whole
  purpose is to record that a person decided something.
- **Do not run `--reset-attempts`, `--waive`, `--reseal`, `--baseline-init`,
  `--set-phase` or `retro.mjs --apply`.** Those are the operator's, they are gated
  by caller, and the router never names them as a step you take — only as a move
  the operator might make.

  **`--reseal` is on that list for a different reason from the rest, and it is
  worth knowing which.** The others record or override a decision. `--reseal` is
  mechanics whose legitimacy depends on a decision recorded NOWHERE: it launders
  whatever preceded it, and unlike `--block` and `--waive` it takes no `--reason`.
  There is no question anyone could ask you whose answer would land in the
  record, so there is nothing here for you to carry out.

- **`doctor --sync` and `state.mjs --record-corpus` are NOT on that list**, and
  their absence is deliberate rather than an oversight. See "Ask in the session"
  above. If you find yourself printing either of them for the operator to paste,
  that is the copy-paste this command exists to remove.
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
The four operator gates — `awaiting_approval`, `release_gate`, `blocked`,
`unverified` — are returned by the router with `dispatch: null` and are asserted
to be, in `check-route.mjs`. Nothing here routes around a control; it removes the operator
from the handoffs, which were never a control in the first place — only an
absence of automation that had been described as a design.

## The spec review, which this DOES stop for

**This section said the opposite until the operator ruled otherwise, and the
reversal is worth reading rather than quietly overwriting.** The argument for
continuing was that a wrong spec is recoverable: it surfaces as a failing verify
and costs one attempt out of three. That is true and it was the wrong test. The
question is not whether the mistake is recoverable — it is whether the
orchestrator is *deciding what to build*. It has no business doing that however
cheap the mistake would be, and the cost of an error is a separate matter from
who is entitled to make it.

So `awaiting_approval` is a real stop. The operator reads the acceptance criteria
and runs `--approve-spec <id>`, which records the decision on the task with the
spec's content hash. Everything after that point — the build, the verdict, the
rework loop, the close — is the chain carrying out a decision that is on disk,
and `--advance-phase` refuses on any task where that decision is absent or where
the spec has changed since. The hash is what stops an approval becoming a
permanent unlock.

This is the difference between one prompt that runs the engineering process and
one prompt that also chooses the work. The first is what this command is for.
