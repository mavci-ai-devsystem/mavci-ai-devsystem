---
name: scribe
description: Write the record of work that is already done - a changelog entry, a task summary, an ADR transcribing a decision the operator has already made, or SEO metadata. Delegates to the scribe agent, which transcribes from named sources and never reconstructs. Use after a task passes.
argument-hint: "<task-id>  [changelog|summary|adr|seo]"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(git *)
---

# Scribe

Arguments: `$ARGUMENTS`

State: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --show 2>&1`

Recent commits: !`git log --oneline -10 2>/dev/null`

## First: did those blocks run?

Inline shell substitution does not run at all under the
`disableSkillShellExecution` policy, in a Cowork session, or on a read-only skill
load on a coordinator, and leaves an error in place of the output when the
command itself fails (NATIVE-CAPABILITIES 2.11). Treat a block holding
`[shell command execution disabled by policy]`, `[shell command not executed:`,
`Shell command failed for pattern`, `Shell substitution failed for pattern`,
`Shell command permission check failed for pattern`, or a node error as
**absent** — say so, and read the files yourself.

## This command exists because the agent did not have one

`mavci-scribe` shipped in 0.1.15 and no skill invoked it, in this plugin, ever.
It was also unable to run: its definition declares `phase: "any"`, the shared
contract rendered that as a literal phase gate, and the phase enum is
`plan|build|verify|release` — so it read `state.json`, found no phase equal to
`any`, and reported `blocked_by: "wrong_phase:<actual>"` on every possible
invocation. Both facts survived three releases because they hid each other: an
agent nothing dispatches cannot be observed failing, and an unrun component looks
exactly like a working one.

## Steps

1. Name the **sources**, before dispatching. Scribe transcribes; it does not
   reconstruct, and a dispatch with no source is a request to invent. For a task
   the sources are:

   - `.mavci/tasks/<id>.md` — the spec, which says what was asked
   - `.mavci/control/tasks/<id>.json` — status, attempts, and `verdicts[]`
   - the verdict files that array names — what passed, and what failed on the way
   - `git log` / `git diff` for the commits — what actually changed

   If a source does not exist, say so and do not substitute another. A summary
   built from a source that was not there is the failure mode this agent's role
   is written to prevent.

2. **Delegate to `@agent-mavci-scribe`** with the task id, the list of source
   paths, and the document to write. Its write scope is `docs/**`, `README.md`,
   `CHANGELOG.md`, `.mavci/decisions/**`, `.mavci/tasks/*.summary.md` and SEO
   metadata files, enforced by a `PreToolUse` hook; anything else is refused.

   **A task summary goes in `.mavci/tasks/<id>.summary.md`, never in
   `.mavci/tasks/<id>.md`.** That second path is the SPEC, and step 1 above names
   it as a SOURCE — it was a read source and a write destination at once, and it
   is the document the operator approved. On gate5 the scribe appended a
   completion summary to it, the approval hash changed, and `--advance-phase` —
   the very next step the router names in the `document` action — refused. The
   scope no longer includes it, and `risk-guard` separately denies every agent a
   write to an APPROVED spec, so this is refused twice rather than remembered.

3. When it returns, check the **citations resolve**. Every task id, verdict file,
   commit sha and path it names must exist. `check-scribe-refs.mjs` asserts this
   in CI for documents in this repository; in a project it is your check.

   This is the only property of scribe's output anything verifies. Nothing checks
   whether the prose is *accurate* — that is the accepted cost of the tier, and it
   is why the role is transcription from a named source rather than
   summarisation: a citation can be checked by a human in seconds, and a summary
   cannot be checked at all.

## What this command must not do

- **Do not write the document yourself** because it would be quicker. That
  reproduces exactly the state this command was created to end.
- **Do not ask scribe for an ADR whose rationale is not written down anywhere.**
  An ADR records a decision a human made. If the reason was not recorded, the
  correct ADR says the reason was not recorded — and a scribe that supplies a
  plausible one has produced a document that will be believed months later by
  somebody deciding whether to reverse it.
- **Do not ask it to write into `.mavci/lessons/`.** It is denied that path
  deliberately. A finding about the system goes through `/mavci-core:retro`,
  which files it as a finding and records that an agent wrote it.
- **Do not close the task here.** `state.mjs --task-status <id> --status done` is
  the caller's step, and under `/mavci-core:ship` the router names it.
