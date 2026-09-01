---
name: retro
description: File a finding against the Mavci system itself - a checker bug, a false positive, a rule that is wrong, a command that traps you. Use when the fix is in the system, not in this project's code.
argument-hint: "<what went wrong>"
allowed-tools: Read, Grep, Glob, Bash(node *)
---

# Retro — file it against the system

What happened: `$ARGUMENTS`

Queued now: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/retro.mjs" --list 2>&1`

## If the block above did not run

It is inline shell substitution, and Claude Code does not execute it under the
`disableSkillShellExecution` policy, in a Cowork session, or on a read-only skill
load on a coordinator — it substitutes a plain string — and it leaves an error in
place of the output when the command itself fails (NATIVE-CAPABILITIES 2.11).
Treat it as **absent** if it holds `[shell command execution disabled by policy]`,
`[shell command not executed:`, `Shell command failed for pattern`, `Shell
substitution failed for pattern`, `Shell command permission check failed for
pattern`, or a node error.

Absent is not "nothing is queued". Say so in your first line and read
`.mavci/lessons/` yourself before appending to it — the queue is that whole
directory, not one file. Anything named `pending-system-change*.md` is queued,
whoever wrote it and whatever they called it.

## This command is deliberately reachable by an agent

Every other privileged command in this plugin sets
`disable-model-invocation: true`. This one does not, and that is the design.

Seven places in the plugin stop an agent and tell it to run this command: the
gate's crash arm, the gate's retry ceiling, the task retry ceiling, a crashed
check's remedy, `doctor`'s queued-lesson warning, `/mavci-core:build` at the
ceiling, and `/mavci-core:waive`. Every one is a point where the agent has
authority to **report** and no authority to **fix**. A reporting channel an agent
cannot reach is not a channel — it is the trap those seven messages describe, and
until 0.1.12 that is exactly what it was: all seven pointed at a command that did
not exist.

Filing is not fixing. `--record` writes to `.mavci/lessons/`, which is
agent-writable surface. `--apply` and `--clear` carry the finding into the system
repository and delete the record, and both are operator acts — `risk-guard.mjs`
refuses them to an agent by caller, the same way it refuses
`state.mjs --set-phase`.

## When to use this instead of something else

| what you have | where it goes |
|---|---|
| the checker crashed, or a rule fired on correct code | here |
| a rule is right and this one file is a genuine exception | `/mavci-core:waive` |
| your code violates a standard | fix the code |
| the project's config is wrong | `/mavci-core:doctor` |

A waiver silences one check on one file in one project. A retro is for when the
same false positive is sitting in every other project too.

## Steps

1. **Say what you observed, not what you concluded.** The exact message, the file
   and line, the command you ran. A finding that reads "the gate is broken" is
   not actionable a month later; one that quotes
   `verify.mjs crashed: ... failed schema validation:` is.

2. **Name the target** if you know it — the file or the check id. If you do not,
   leave it out rather than guessing; a wrong target sends the next reader to the
   wrong file.

3. **Write the assertion, and name the broken build it must catch.** This is the
   part that matters and the part everyone skips. Not "there should be a test" —
   *what would a broken build look like, and would this assertion say so?* Six
   times in Gate 4 the assertion that existed was adjacent to the one that
   mattered: `check-gate.mjs` asserted the gate's payload shape and never its
   exit status, and passed for seven releases while the gate blocked nothing.

   If you cannot state one, file it anyway and say so. The command records that
   it was not supplied, in those words, rather than leaving a gap that reads like
   an oversight.

4. File it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/retro.mjs" --record "<title>" \
  --finding "<what you observed, verbatim where possible>" \
  --target "<file or check id>" \
  --assertion "<what must be asserted, and against which broken build>"
```

5. **Then stop, if you were sent here by a block.** Filing is the whole of your
   authority. Do not go on to fix the system: `CLAUDE.md` in the system repo says
   an agent does not edit what governs it, and Gate 4 recorded an agent staying
   trapped for three turns rather than making a four-character fix it could see.
   That rule cost three turns and held anyway, and it is the reason this channel
   exists at all.

6. Tell the operator it is queued and unapplied. `doctor` will keep saying so on
   every run until they act, which is intended: an escalation nobody is reminded
   about is an escalation that decays into a file.

## For the operator

`--apply` copies every queued file into the system repository's `docs/lessons/`
and prints the next steps. It does not commit, bump `plugin.json`, push or tag —
nothing reaches any project until the version is bumped by hand, and that is
deliberate.

`--clear <name>` deletes one queued file. Do it after applying, never instead of
it: the file is the record of an unfixed problem. The name is required whenever
more than one file is queued, and that is 0.1.13's finding rather than caution —
0.1.12 deleted one fixed path and `doctor` watched the same one, so clearing an
applied file while a hand-written one was still open removed the only thing
pointing at the open one.
