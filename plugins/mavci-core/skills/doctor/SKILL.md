---
name: doctor
description: Report the health of a Mavci project - control-plane seal, schema validity, settings drift, baseline debt, expiring waivers, version skew between local and CI, and a live self-test proving the risk hooks still block. Run when something feels wrong, or after a Claude Code upgrade.
argument-hint: "[--sync]"
disable-model-invocation: true
allowed-tools: Read, Bash(node *), Bash(git *)
---

# Mavci doctor

!`node "$CLAUDE_PLUGIN_ROOT/scripts/doctor.mjs" $ARGUMENTS`

## How to read this

Report the output to the operator, then interpret it. Priority order:

1. **`HOOK SELF-TEST FAILED`** — the most serious line this tool can print.
   It means a command that must be denied was not denied. Enforcement is not
   working, most likely because a Claude Code upgrade changed the hook output
   schema. Say plainly that the system is not currently protecting them, and
   that tier-3 deny rules in `.claude/settings.json` are the only layer left.

2. **`control plane seal BROKEN`** — the files that govern agent behaviour were
   changed outside `state.mjs`. Show `git diff .mavci/control/` before suggesting
   `state.mjs --reseal`. Reseal is for a deliberate operator edit, not a way to
   silence the alarm.

3. **`version skew`** — local hooks and CI are running different rule sets, so a
   green local run means nothing about CI. `--sync` fixes it; the change must
   then be committed.

4. **`allow rule(s) added outside the template`** — on Windows, "Yes, and don't
   ask again" writes into the committed settings file. Walk through each one and
   ask whether it was intended. Deleting an unintended one is a one-line diff.

5. **baseline debt and waivers** — not failures. Report the trend. If debt is not
   shrinking across sessions, say so; that is the signal the backlog is being
   ignored rather than worked.

If everything is `ok`, say so in one line. Do not pad it.
