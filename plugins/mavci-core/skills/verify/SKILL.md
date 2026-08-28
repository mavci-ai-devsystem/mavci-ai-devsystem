---
name: verify
description: Run the full standards checker, type check and build against the current working tree, record a verdict, and prune baseline entries that now pass. Use before committing, and at the end of a task.
argument-hint: "[task-id]"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(npm *), Bash(npx *), Bash(git *)
---

# Verify

Standards: !`node "$CLAUDE_PLUGIN_ROOT/scripts/verify.mjs" --format=human --record 2>&1`

Working tree: !`git status --porcelain 2>/dev/null | head -30`

## Steps

1. Read the checker output above. Every failure names a file, a line and a fix.
2. Run the type check: `npx tsc --noEmit`
3. If anything under `app/`, `lib/` or `next.config.*` changed, run `npm run build`.
4. If the project has tests, run them.
5. If a task id was given, check the diff against that task's acceptance criteria
   in `.mavci/tasks/<id>.md`, one criterion at a time, naming the file that
   satisfies each. **A green checker is a floor, not a ceiling** — it verifies
   standards, not that the code does what was asked.
6. Retire fixed debt:
   `node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --baseline-prune`
7. On a full pass with a task id, advance the phase:
   `node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --set-phase release`

## Reporting

State pass or fail in the first line. On failure, list what failed with file and
line, and stop — do not fix it here. Verification and implementation are separate
phases precisely so that the thing judging the work is not the thing that wrote it.

If a check looks like a false positive, say so explicitly and name
`/mavci-core:waive`. Do not work around it silently.
