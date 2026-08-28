---
name: waive
description: Grant a time-boxed exception for one check on one file. Operator-only. Use when a check is a false positive and blocking real work.
argument-hint: "<check_id> <path> <reason>"
disable-model-invocation: true
allowed-tools: Read, Bash(node *)
---

# Waive a check

**This command is operator-only.** `disable-model-invocation: true` means an
agent cannot reach it — only a human typing `/mavci-core:waive` can. That is the
control that makes the whole enforcement layer meaningful: an agent that could
waive its own blockers would have no constraints at all.

Arguments given: `$ARGUMENTS`

## Steps

1. Parse the arguments into `check_id`, `path`, and reason. If any is missing,
   ask — do not guess a reason on the operator's behalf.

2. Read the check's own description so the operator knows what they are
   switching off. The matching `standards-*` skill explains why the rule exists.

3. **Push back once, then comply.** A waiver is correct when the check is wrong.
   It is not correct as a way past a real problem. Ask directly: is this a false
   positive, or is it inconvenient? If they confirm it is a false positive, or
   they reaffirm the waiver after hearing the concern, proceed without further
   argument — it is their call.

4. Grant it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --waive <check_id> --path <path> --reason "<reason>" --days 90
```

The command refuses: a reason under 20 characters, a missing path, more than 180
days, an unknown check id, and any `critical` check. Those refusals are the
design, not obstacles — relay the message rather than working around it.

5. Confirm the expiry date and tell the operator it will start blocking again
   then. Suggest `/mavci-core:retro` if the check itself is wrong, because a
   waiver on one project leaves the same false positive in the other five.
