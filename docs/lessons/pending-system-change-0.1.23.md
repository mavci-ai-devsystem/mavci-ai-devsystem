# Queued for 0.1.23 — apply with `/mavci-core:retro --apply`

Recorded: 2026-09-02, plugin 0.1.22, from a false positive raised while building
0.1.22's own fix. The reported symptom is cosmetic. **The cause is not, and the
same cause fails in the opposite direction, which is the half that matters.**

Filed by: main session. Hand-written into `docs/lessons/` rather than through
`retro.mjs --record`, because this repository has no `.mavci/` control plane for
the command to write into — the system repo is not a connected Mavci project.
Format mirrors what `record()` produces so `--apply` and the queue reader see it
the same way.

---

# Finding 1 — the checker that polices the checkers is blind in exactly the files whose regexes contain a backtick

Target: `scripts/ci/check-plugin.mjs` (the `exec*Sync` stdio rule, ~line 440-468)
and `plugins/mavci-core/scripts/lib/jsscan.mjs` (`blankSource`).

## What was reported

While writing 0.1.22, a new **doc comment** in `check-command-invocation.mjs`
quoted a call in prose. `check-plugin.mjs` failed it with:

> `check-command-invocation.mjs:126 calls exec*Sync without pinning stdio.`

There is no call on that line. There is a sentence about one. The rule asserted
a cause it had not established — 0.1.12 finding 5's shape (*the guard matches the
command text, not the write target*), now in the checker that polices the other
checkers. It also had an honest arm available and did not use it: the branch at
`end === -1` says *"has an exec\*Sync call whose arguments could not be read to
the closing paren, so it cannot be shown to pin stdio. Refusing rather than
assuming."* That is the true statement about this match. It was not reached,
because the prose happened to contain balanced parentheses, so `end` was found
and control fell through to the confident branch.

The prose was reworded rather than the rule narrowed. **Narrowing a checker to
stop noticing is the move this repository exists to refuse**, and the rule failing
closed on something it cannot read is correct behaviour.

## What it actually is, and why the reported symptom is the smaller half

`blankSource` is documented "not a parser". CLAUDE.md already records one
instance: it *"reads a backtick inside a regex literal as a template literal"*
(0.1.12). That is precisely what is happening here, and the consequence was never
followed through.

`check-command-invocation.mjs` carries this line:

    const INLINE = /!`([^`]+)`/g;

Three backticks inside a regex literal. `blankSource` opens a template-literal
state on the first, and **every byte after that point is misread**. Reduced to a
six-line file, the scanner returns:

     1 | "const INLINE = /!`   `]+)`   "
     2 | "            "
     3 | "   "
     4 | "                                      "
     5 | "   "
     6 | "                                               "

Line 6 of that input is a real, unpinned `execFileSync(...)` call. The scanner
blanked it to whitespace. **The rule cannot match what it cannot see, so it
reports nothing and the file passes.**

So the desynchronisation produces *either* a false positive *or* a false
negative, depending on backtick parity at the point the rule happens to look.
The false positive is loud and was fixed in a minute. The false negative is
silent and has been standing.

## Measured, not asserted

Comparing `exec*Sync(` occurrences in raw source against occurrences the scanner
can see, across every CI script:

    check-command-invocation.mjs    raw=3   scanner sees=0
    check-scribe-refs.mjs           raw=3   scanner sees=0
    ---
    2 of 34 CI scripts scan differently than they read

Six real calls are currently invisible to the rule that exists to police them.

## The live instance, which is the argument for the priority

`scripts/ci/check-scribe-refs.mjs:182`:

    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })

**No `stdio`.** This is an actual violation of the rule, in the tree, today,
unreported. It is the same class 0.1.14 declared *"fixed as a class, not an
instance"* — nine call sites across seven CI scripts, plus a new rule to stop it
coming back. The rule came back blind, and the class came back with it.

Note what this means for the fix that provoked the finding: the three
`execFileSync` calls now in `check-command-invocation.mjs` are all pinned, but
**the rule is not what proves that.** A future edit unpinning any of them passes.

## Why it ranks above its cosmetic symptom

Invariant 5: *a failed probe is never reported as a pass; "could not check" is
WARN or FAIL, never OK.* The rule's own header claims this property —
*"an unreadable call FAILS rather than passing unexamined"* — and it holds only
for the one unreadability the author anticipated (unbalanced parens). The
unreadability that actually occurs, a desynchronised scanner, produces an empty
match set, and an empty match set is indistinguishable from a clean file.

This is the eleventh-plus instance of the shape CLAUDE.md catalogues: a mechanism
present, correct-looking, and never reached. Here it is one level worse than
usual, because the mechanism is *the thing that checks the other checks*.

### The assertion, and the broken build it must catch

Two assertions. They are independent and both must be watched failing first.

**A — the scanner must prove it can see the file (the fail-open half).** For
every `scripts/ci/*.mjs`, the count of `exec*Sync(` matches in blanked source
must equal the count in raw source. A mismatch is a **FAILURE** naming the file
and both counts — never a silent pass. *Broken build: today's tree.* It reports
`check-command-invocation.mjs` and `check-scribe-refs.mjs` at `raw=3 seen=0`,
while today's rule reports neither. Confirm the assertion fires on both and that
the other 32 stay green — a version that flags all 34 is measuring nothing.

**B — a match that cannot be established as a call must not be described as
one (the false-positive half).** When the scanner cannot show that a match is
real code, the message must be the existing *"arguments could not be read"*
wording, not *"calls exec\*Sync without pinning stdio"*. *Broken build:* a
fixture CI script containing a backtick-bearing regex literal followed by a
block comment that mentions the call with balanced parens — the exact 0.1.22
shape. Today's rule reports the confident message; the assertion requires the
honest one.

**The decision this needs, which is why it is filed rather than patched.**
There are two places to fix it and they are not equivalent. Repairing
`blankSource`'s regex/template disambiguation is the root fix, but `jsscan` is
shared by the rules engine and is deliberately not a parser — changing its state
machine changes what every rule sees, and that is a blast radius no CI fix should
take unasked. Having `check-plugin` detect the desynchronisation and refuse is
narrow, local, and satisfies invariant 5 without touching anything the rules
engine reads. Assertion A is written for the second. If the first is chosen
instead, A still holds and becomes the regression test for it.

Also owed either way, and independent of both: pin `stdio` at
`check-scribe-refs.mjs:182`. Do not fix it before assertion A is watched failing
— it is currently the only live instance, and removing it first leaves the
assertion nothing to catch.
