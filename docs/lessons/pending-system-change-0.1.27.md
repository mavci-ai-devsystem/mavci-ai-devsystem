# Queued for the next system release - apply with `/mavci-core:retro --apply`

Recorded: 2026-09-04, plugin 0.1.27, filed from the system repository.

Filed by hand rather than by `retro.mjs --record`: that command reads a project
manifest and this repository has no `.mavci/`, so the escalation channel does not
run here at all. Noted as provenance, not as a second finding.

---

# Finding 1 - `retro --apply` cannot find a system repository from any installed session, and the skill still describes it as working

Filed: 2026-09-04, plugin 0.1.27.

Filed by: the main session, in the system repository.

Target: `plugins/mavci-core/skills/retro/SKILL.md`, and `systemRepo()` in
`plugins/mavci-core/scripts/retro.mjs`

`systemRepo()` has exactly one candidate - `path.resolve(HERE, '..', '..', '..')`,
the checkout the running file lives in - confirmed by a `.claude-plugin/marketplace.json`
marker. From the installed plugin that resolves to `~/.claude/plugins/cache/mavci`,
which carries no such marker. Measured today against the copy actually installed on
this machine: importing
`~/.claude/plugins/cache/mavci/mavci-core/0.1.26/scripts/retro.mjs` and calling
`systemRepo()` returns `null`. So `--apply` refuses in every session that runs the
installed plugin - which is every session that matters, because a finding is filed
from a project and the plugin is what a project loads. The one arrangement where it
works is a session rooted in a source checkout, running that checkout's own file.

**The refusal itself is correct and is not the finding.** 0.1.25 removed the
marketplace clone from the candidate list precisely because an agent running from
the cache wrote a finding into `~/.claude/plugins/marketplaces/mavci`, which the
next propagation resets, and reported success; the documented workflow is apply
THEN clear, so an operator following it would have destroyed the only durable copy.
Refusing is the right answer to "no source checkout found", and the message names
the path it declined to write to and spells out the manual copy.

**This is that same fact from the other side.** 0.1.25 was *it wrote to the wrong
tree*; this is *it can now find no tree at all*, from the only place the command is
ever invoked. What is wrong in the tree today is not the resolver's answer but the
promise made about it: `skills/retro/SKILL.md`, "For the operator", says `--apply`
"copies every queued file into the system repository's `docs/lessons/` and prints
the next steps", unconditionally, with no precondition stated anywhere. An operator
reading the skill has no way to know the command works from one directory on the
machine and refuses everywhere else.

Two exits, and the choice is the operator's because they cost different things.

1. **The resolver learns to find a source checkout.** This must be an explicit,
   recorded location - a flag, an environment variable, a path in operator config -
   and NOT a search of the filesystem for a `marketplace.json`. The candidates are
   marker-confirmed rather than shape-guessed for the stated reason that a wrong
   guess writes a lesson into an unrelated repository; a scan reintroduces exactly
   that, and a machine holding a checkout, a clone and twelve cached versions has
   several trees that would answer the marker test.
2. **The skill says plainly that `--apply` requires a session rooted in the system
   repository**, and that the operator copies the queued file by hand otherwise.
   Cheaper, loses nothing but the provenance header the command writes, and makes
   the true reach of the command readable before it is run rather than after it
   refuses.

### The assertion, and the broken build it must catch

Assert that `skills/retro/SKILL.md`'s operator section states the precondition
`systemRepo()` actually enforces - i.e. that the documented reach of `--apply` and
the resolver's candidate list agree. Under exit 2 that is a text assertion tied to
the candidate list; under exit 1 it is an assertion that the recorded location is
consulted and that an unset one still refuses.

The broken build it must catch is the current tree: one candidate that no installed
session can satisfy, and a skill promising unconditional behaviour.

Two assertions already exist that stay GREEN on this bug, and they are the reason
it was invisible. `check-command-refs.mjs` asserts every `/mavci-core:<name>` the
plugin ships resolves to a real skill - `retro` does. `check-retro.mjs` case 7
builds a tree where only the clone carries the marker and asserts the resolver
REFUSES - it does. Both test the half that works. Neither asks whether the command
can succeed from where it is actually invoked, or whether the skill describes what
it does. That is the same shape as 0.1.24: callee asserted, caller assumed.
