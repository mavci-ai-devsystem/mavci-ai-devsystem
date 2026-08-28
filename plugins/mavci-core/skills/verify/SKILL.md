---
name: verify
description: Run the full standards checker, type check and build against the current working tree, record a verdict, and prune baseline entries that now pass. Use before committing, and at the end of a task.
argument-hint: "[task-id]"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(npm *), Bash(npx *), Bash(git *)
---

# Verify

Gate: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" --mark-dirty --session="${CLAUDE_SESSION_ID}" 2>&1`

Preview: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" --format=human 2>&1`

Working tree: !`git status --porcelain 2>/dev/null | head -30`

## First: did the preview actually run?

The block above is an **optimisation, not the verdict.** It carries no `--record`
on purpose. Inline shell substitution has three paths on which Claude Code does
not run the command at all and substitutes a plain string instead — the
`disableSkillShellExecution` policy, a Cowork session, and a read-only skill load
on a coordinator — and a fourth on which the command runs and fails, leaving an
error where the report should be. None of them are visible to this skill, and
none of them are under its control (NATIVE-CAPABILITIES 2.11).

The same three paths apply to the **Gate** block: if it did not print
`gate armed`, the Stop-hook backstop was not armed and step 1 is the only
recorder for this turn. Say so.

Treat the preview as **absent** — never as a pass — if it holds any of:

- `[shell command execution disabled by policy]`
- `[shell command not executed: read-only skill load on the coordinator`
- `Shell command failed for pattern`
- `Shell substitution failed for pattern`
- `Shell command permission check failed for pattern`
- a node error where a report should be (`Cannot find module`, a stack trace)

**If it is absent, say so in the first line of your reply** — "the inline
standards preview did not run" — then continue to step 1, which is authoritative
regardless. Do not infer a verdict from an empty or broken block, and do not
report a pass on the strength of one. **A probe that did not run is not a pass.**
If you cannot tell whether the preview is a real report or a failed one, say
exactly that and rely on step 1.

## Steps

1. **Record the verdict. This run, not the preview, is what counts:**

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" --format=human --record`

   State pass or fail from **this** run. It writes to `.mavci/control/verdicts/`.
   Recording from the preview instead would mean a preview that silently did not
   run leaves no verdict, and no trace that none was taken.

   The Stop-hook gate is the enforced backstop: it runs `verify.mjs --record`
   itself, and the turn cannot end without it. It would normally skip a
   `/mavci-core:verify` turn, because such a turn writes no files and is not in
   the build phase — which is exactly why the **Gate** block above arms it for
   this session. If that block did not print `gate armed`, the backstop is not in
   place and this step is the only thing that will record anything.

2. Read the checker output from step 1. Every failure names a file, a line and a fix.
3. Run the type check: `npx tsc --noEmit`
4. If anything under `app/`, `lib/` or `next.config.*` changed, run `npm run build`.
5. If the project has tests, run them.
6. If a task id was given, check the diff against that task's acceptance criteria
   in `.mavci/tasks/<id>.md`, one criterion at a time, naming the file that
   satisfies each. **A green checker is a floor, not a ceiling** — it verifies
   standards, not that the code does what was asked.
7. Retire fixed debt:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --baseline-prune`
8. On a full pass with a task id, advance the phase:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --set-phase release`

## Reporting

State pass or fail in the first line, sourced from step 1. On failure, list what
failed with file and line, and stop — do not fix it here. Verification and
implementation are separate phases precisely so that the thing judging the work
is not the thing that wrote it.

If step 1 itself could not run, report that as a failure to verify. It is not a
pass, and it is not a small thing: it means nothing checked this working tree.

If a check looks like a false positive, say so explicitly and name
`/mavci-core:waive`. Do not work around it silently.
