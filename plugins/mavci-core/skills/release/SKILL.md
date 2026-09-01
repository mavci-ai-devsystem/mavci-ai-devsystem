---
name: release
description: Checks every precondition for cutting a release and refuses if any fails. Reports what is blocking; never bumps, commits, tags or pushes. Use before releasing a project.
argument-hint: ""
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(git status*), Bash(git log*)
---

# Release preconditions

This command **decides whether a release may be cut**. It does not cut one. The
bump, the commit, the tag and the push stay with the operator — they are listed
under "Ask me before" in the system repository's own `CLAUDE.md`, and a command
that performed them would be an agent editing what governs it through a longer
pipe.

## Current state

- Unverified session? !`ls .mavci/control/unverified.json 2>/dev/null || echo "no"`
- Guardian records: !`ls .mavci/control/guardian/records/ 2>/dev/null | tail -3 || echo "none"`
- Open guardian ticket? !`ls .mavci/control/guardian/ticket.json 2>/dev/null || echo "no"`
- Plugin version: !`node -p "require(process.env.CLAUDE_PLUGIN_ROOT + '/.claude-plugin/plugin.json').version" 2>/dev/null`

## Steps

### 1. Run the gate

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/release-check.mjs"
```

It reports every refusal at once rather than the first, so one run tells the
operator everything that is blocking rather than one thing at a time.

### 2. Report the refusals verbatim, and do not re-score them

Each refusal carries a code and a message. Print them as given. Do not summarise a
`fail` as advisory, do not describe `not_checked` as "mostly fine", and do not
weigh one refusal against another — this command has no authority to decide that a
blocked release is acceptable, and neither do you.

The refusal that most invites re-scoring is `guardian_not_checked`: a guardian
record that exists, is current, and reports that it checked **nothing**. It reads
like a clean run and it is the opposite. Its message names where to look — the
scan residue and the exclusion classes — because an empty worklist is far more
likely to mean the scan is not seeing sites than that the project has none.

### 3. If everything passes, say what the operator does next

The gate passing means the preconditions hold, not that the release is done. Print
the sequence and stop:

    edit → build-agents.mjs if a def changed → bump plugin.json → commit →
    push → tag vX.Y.Z → push tag

### 4. What this command must never do

- Never bump `plugin.json`. The version **is** the release action, and nothing
  propagates to any project until it changes.
- Never commit, tag or push.
- Never run `state.mjs --reseal`, `--baseline-init` or `retro.mjs --apply` to clear
  a refusal. Those are operator-only for the same reason this is: clearing the
  evidence is not the same as fixing the problem.
- Never re-run guardian to get a different answer. If the record is stale, say so
  and let the operator decide; a second run to replace a `fail` is the loop this
  system exists to prevent.
