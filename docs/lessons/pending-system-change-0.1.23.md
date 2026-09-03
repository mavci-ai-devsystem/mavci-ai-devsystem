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

# Finding 1 — APPLIED in 0.1.23 — the checker that polices the checkers is blind in exactly the files whose regexes contain a backtick

> **Applied 2026-09-03.** The ROOT fix was chosen, not the narrow one, and the
> reason is that the narrow one had no remedy: a rule that fails a file for
> containing a backtick inside a regex can only be satisfied by rewriting the
> regex, which is contorting source to suit a broken scanner and is finding 16's
> shape - an instruction addressed to someone who cannot reasonably carry it out.
>
> `blankSource` had **no notion of a regex literal at all**, which is why every
> delimiter inside one opened a state. It now recognises a regex and **skips it
> whole, leaving the contents untouched**. Skipping rather than blanking is
> deliberate: blanking would be consistent with strings and would also mean every
> rule suddenly sees LESS inside a regex than it does today - a loosening, in
> shipped code that decides enforcement on every project. Skipping changes nothing
> a rule sees inside a regex; the only change is that the rest of the file stops
> being blanked, which is strictly more visible.
>
> Assertion A shipped anyway, in `check-plugin.mjs`, and was watched failing
> against the reverted scanner: it names both counts and refuses to consult the
> stdio rule for a file it cannot see. It is not made redundant by the root fix -
> it is what catches the scanner desynchronising again for a reason nobody has met.
>
> The live instance is fixed: `check-scribe-refs.mjs:182` now pins `stdio`. It was
> found by the rule itself the moment the scanner could see the file, which is the
> proof the fix works. Measured after: **0 of 60 scanned files desynchronised**,
> across `scripts/ci/`, `scripts/`, `lib/` and `rules/`.
>
> Assertion B - the honest wording for a match that cannot be established - is NOT
> shipped and stays open below. The `end === -1` arm it concerns is unchanged and
> still reachable.
>
> The count in the finding was 2 of 34 when it was written. It was **4 of 36** by
> the time it was applied, and one of the two new ones was a regex added earlier in
> the same session that fixed it. The finding predicted its own growth and was
> right.

---

## The original finding follows, unedited.

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

---

# Finding 2 — the risk guard reads every flag as a command; state.mjs dispatches on the first

Target: `plugins/mavci-core/scripts/risk-guard.mjs`, the `state.mjs` classifier
(~line 781), against `plugins/mavci-core/scripts/state.mjs` `main()` (~line 900).

Recorded 2026-09-03, plugin 0.1.22, from the session that built the chain router.
**Filed rather than fixed, deliberately: it is a RELAXATION of a guard, and the
one change this repository will not make opportunistically in the middle of
something else.**

## The disagreement

`state.mjs` dispatches on the FIRST `--` token:

    const cmd = argv.find((a) => a.startsWith('--'));

`risk-guard` reads EVERY `--` token and treats each as a command:

    const flags = cmd.match(/--[a-z-]+/g) ?? [];
    ...
    if (!known.length || flags.some((f) => !AGENT_OK.includes(f))) { deny(...) }

So an agent running the **agent-safe**

    node scripts/state.mjs --new-task "add a health endpoint" --spec .mavci/tasks/0007.md

is denied — on `--spec`, which is not a command at all but the value flag of the
command that was already classified agent-safe. The same holds for `--path`,
`--reason` and `--days` on `--waive`, and for the three lifecycle verbs added in
0.1.23 (`--agent`, `--status`, `--reason`).

It is 0.1.13's `findingHeading()`/`FINDING_RE` lesson unlearned one file over: a
writer and a reader with two independent notions of the same thing, which agree
until an argument is added.

## Why it is not urgent, and why it must still be fixed

Not urgent: the orchestrator runs in the MAIN SESSION, where the sub-flag arm is
never consulted — the main-session path only looks for a privileged flag to
confirm. Nothing in the chain is blocked today.

Must be fixed: the architect is the agent that writes specs, and the moment
anything wants an agent to allocate its own task with a spec pointer, this denies
it with a message about a flag the operator will read as a bug in the command.
And a guard that denies correct usage is 0.1.12 item 5's finding exactly — **a
guard that fires wrongly and often trains everyone to turn it off**.

### The assertion, and the broken build it must catch

`check-risk-guard.mjs` has 80 cases. Add both halves, and **watch the deny half
against the fixed build, not only the allow half**:

**A — the allow half.** `--new-task "x" --spec p` from an agent is ALLOWED.
*Broken build: today's tree.* It denies, naming `--spec`.

**B — the deny half, which is where a relaxation goes wrong.** Every one of these
must STILL be denied to an agent after the change, and each is a distinct way the
looser reading could leak:

- `--set-phase build` — a privileged command in first position.
- `--new-task "x" --set-phase build` — a privileged flag in a LATER position.
  The command is agent-safe and the tail is not; the scan for privileged flags
  must stay over the whole command even after the unknown-flag scan narrows.
- `--new-task "x" --demolish` — an unrecognised flag that is not a declared value
  flag of `--new-task`. Fail-closed must survive: a subcommand added later is
  classified deliberately or not at all.
- `--waive x --path p --reason r --days 5` — still privileged, still confirmed.

**The shape of the fix that satisfies both.** The command is `flags[0]`, the same
rule the dispatcher uses. Value flags are declared PER COMMAND, in a table beside
`AGENT_OK` and `PRIVILEGED`, so an undeclared flag still denies. The scan for
privileged flags stays over the whole command text — it is the deny direction and
it is cheap to keep broad.

**Do not narrow the privileged scan while widening the value-flag one.** They
look like one change and they are opposite in sign.

---

# Finding 3 — a subagent cannot be rooted at another project, and nothing says so

Target: `docs/ARCHITECTURE.md` (section 2 or 3), and the Gate protocol wherever it
is written down.

Recorded 2026-09-03, plugin 0.1.22. **Documentation, not code — filed so the next
session does not spend the same hour discovering it.**

## The observation

Established by dispatching `mavci-core:mavci-scribe` from a session rooted in the
system repository, with a prompt naming an absolute path to a connected project:

- the subagent's working directory is **the session's**, not the target's;
- `CLAUDE_PROJECT_DIR` is **not set** in the subagent's environment.

Scribe read `.mavci/project.json` relative to its cwd, did not find one, and
correctly reported `blocked_by: "not_connected"` — its startup step 1, before its
phase gate.

## Why it matters more than it looks

`projectRoot()` is `process.env.CLAUDE_PROJECT_DIR || process.cwd()`, so an agent
resolves the project from its cwd. The hooks resolve it separately, from
`input.cwd` in the hook payload — also the session's. So a run that redirected an
agent at another project by hand would be a run with **`risk-guard` silent**: no
phase gate, no edit scope, no control-plane guard, because the hooks would
conclude they are not in a Mavci project and stay quiet, which is correct
behaviour (6.23) and exactly wrong for that use.

**A chain proven with the gates off is not the chain.** So:

> A multi-agent end-to-end run must happen in a session whose working directory
> IS the project. A session elsewhere can drive the deterministic half — router,
> state machine, attribution, rework, ceiling, release gate — and cannot dispatch
> the agents.

This is what Gate 3 and Gate 4 did implicitly, by running in `gate4c`. It was
never written down as a requirement, so it reads as a convenience until someone
tries the other thing.

### The assertion

None available. This is a property of the harness, not of our code, and there is
nothing in the plugin that can observe it. Recording it in ARCHITECTURE is the
whole of the fix, and the honest note is that it will go stale silently if the
harness changes.

---

# Finding 4 — `active_task` is a second copy of a fact the task records already carry

Target: `plugins/mavci-core/templates/schemas/state.schema.json`,
`plugins/mavci-core/scripts/state.mjs`.

Recorded 2026-09-03, plugin 0.1.22. **This is carried-forward item 5's
`active_task` decision, restated because 0.1.23 made the field truthful without
settling whether it should exist — and a half-fixed field is exactly the thing a
later reader mistakes for a finished one.**

0.1.22 gave the field a writer (`beginPlan`) and no clearer, so after a task
closed it went on naming it. 0.1.23 clears it on every terminal status, which
stops it lying. It does not stop it being a **second writer for one fact**:
"which task is in progress" is already carried by `status: "in_progress"` on the
control task and enforced at the transition by `assertSoleInProgress`.

Item 5's decision stands: **delete it.** What blocks that is not the decision but
the mechanics — `state.schema.json` has `additionalProperties: false`, so removing
the field is a breaking read against every existing `state.json`, and
`state.schema_valid` is itself a checker rule, so a stale state file lights up the
checker rather than failing quietly. It needs a migration step or a one-version
allowance, and it is a **state-file format change**, which is on the ask-first
list.

### The assertion

That no reader consults `active_task`. `lib/route.mjs` deliberately does not —
it selects on `status` — and `mavci-builder.md` line 64 still names "phase, active
task, retry counters" in its inputs, which must change in the same commit or the
next builder cites the deleted field.

---

# Finding 5 — the operator's own instruction had no field to land in, and the fallback would have hidden it

Recorded 2026-09-03, plugin 0.1.23. **Filed by the operator, about the operator's
own instruction, and kept because the shape generalises past this instance.**

The instruction was: `--advance-phase` refuses unless the task's spec is approved,
and "the approval that unlocks it is the operator's, recorded in the task record".
There was no field in the task record to record it in. In the operator's words:

> The instruction was correct in intent and unimplementable as written, and only
> the first real use would have shown it — advance-phase would have refused every
> time and looked like a working gate. That is a rule that cannot be satisfied,
> which is finding 16's shape arriving in something I specified rather than
> something the system did.

**It was worse than "no field", and the reason is worth keeping.** The orchestrator
had already shipped holding a FLAT `--set-phase` grant. So a `--advance-phase`
reading a field that did not exist would have refused every transition while the
free command underneath went on working - the chain would have kept running, the
new gate would have looked correct, and nothing would have surfaced. A gate that
always refuses is indistinguishable from a gate that works until someone has a
legitimate transition to make, and a working fallback path is what stops anyone
ever having one.

**Closed in the same turn** by `spec_approved` on the control task, and the pairing
is the durable part: `check-provenance.mjs` D1 asserts the refusal and D3b asserts
the permission, because either alone is satisfied by a build that is wrong in one
direction. `check-route.mjs` A5-GATE and A5 are the same pairing one layer out.

### What is still owed, and it is not the field

The tier-2 confirm this design leans on is **inert**. `confirm()` emits
`permissionDecision: "deferToUser"`, which carried-forward item 7 records as a
value Claude Code's validator REJECTS - so the payload is discarded and the call
falls through to the normal permission flow. `check-provenance.mjs` C5 asserts the
guard COMPUTES a tier-2 decision for `--set-phase` and deliberately does not
assert that anyone is prompted.

So the classification is right and its delivery is a known-broken channel. The
practical consequence: **free `--set-phase` is classified operator-only and is not
actually gated at runtime.** What holds today is that the router never emits it,
`skills/ship/` is told to report it as a router defect if it ever appears, and
`check-route.mjs` A5b asserts the router names the scoped command and never the
free one. Those are three prompt-and-test controls standing in for one runtime
control, which is the honest description and not a good one.

### PRIORITY CHANGE: carried-forward item 7 moves up, and the reason matters

**Item 7 is now the next thing in this queue after gap 1's remainder.** It was
filed as a correctness fix on a payload value nothing was reading; it is now the
missing runtime control that three prompt-and-test controls are standing in for.

**Its severity changed because something started depending on it, not because the
defect changed.** The operator's wording, and the distinction is the point: the
`deferToUser` bug is byte-for-byte what it was when it was filed. What changed is
that the phase-authority split was built on top of a tier-2 confirm, so a value
the runtime rejects now sits underneath the control that keeps the orchestrator
from deciding what to build. Nothing about the defect is worse. The consequence of
leaving it is.

That is a class of priority change worth naming, because a queue ordered only by
severity-at-filing never re-orders: a defect's cost is a function of what has been
built over it since, and nothing in this system re-reads the queue when a new
dependency lands. **Every other item in this file should be re-read the same way
whenever something is built on it.**

Item 7's own condition is unchanged and still binding: do not change the string
until the decision-control table loads and the accepted value can be quoted
verbatim. `ask` versus `defer` is exactly the adjacent-but-wrong distinction that
produced both this and the Stop gate, and moving an item up the queue is not
permission to guess at it faster.

---

# Finding 6 — one counter cannot be both a retry ceiling and a verdict identity

Recorded 2026-09-03, plugin 0.1.23. **Closed in the same release; filed because
the sequence that found it is the reusable part.**

`--reset-attempts` zeroes `attempts`, so the next try was "attempt 1" again and
its verdict path was the path of a historical file. The writer overwrote it -
destroying the record of exactly the failures the operator had just reset past.

**It was invisible until write-once was enforced.** Before that, the collision was
a successful write. Enforcing write-once turned it into a refusal, and the refusal
is the only reason it was found at all. That is the same sequence as every finding
in this repository: the guard that fires is what reveals the defect the silence
was hiding, and a guard added for one reason keeps paying for itself in reasons
nobody predicted.

The fix is `attempts_total` - tries ever, never reset - as the verdict identity,
with `attempts` remaining the retry policy. Two facts, two fields, one writer
each. The router had to be split the same way and was not: it keyed the verdict
lookup on `attempts`, which is correct until a reset and then sends the builder
back over work already verified. **Every pure-function case passed while that was
broken**, because none had been through a reset; the end-to-end walk caught it.
`check-route.mjs` R-RESET now asserts it so it does not depend on the walk
happening to reset.

### The assertion rule this produced, which is the general lesson

The operator, on the attribution assertions:

> a counter test at attempt 1 cannot distinguish correct from off-by-one, so the
> assertion has to be at attempt 2 or it is decoration.

At attempt 1, `attempts` is 1, `attempts_total` is 1, and a build writing either,
or a hardcoded 1, or `verdicts.length + 1`, all produce the same file with the
same field. The assertion passes against four candidate implementations and
discriminates between none. Two is the smallest value where the answers separate.

Demonstrated: mutations writing `attemptsTotal(control) - 1` and a hardcoded `1`
are both caught by A2/A3/A3b **only because those now run at attempt 2**. A third
mutation - the ceiling counter used as identity, which is the pre-fix reader - is
caught by A7 alone and is green everywhere else.

**Applies to every counter in this system**, and `attempts`/`attempts_total`/
`max_attempts`/`GATE_MAX_CONTINUES` are four of them. A test at the first value of
a counter is a test of the constant, not of the counter.

### The finding under the finding, which is larger than the counter

The operator, on what this actually was:

> I pointed at verdict identity; the actual hole was one counter doing retry
> policy and evidence identity at once, and the router keyed on the wrong half -
> correct until a reset, then sending builder back over verified work. Every
> pure-function case passing while that was broken is the shape this session keeps
> producing, and it is worth its own line: **a test suite over pure functions
> cannot see a caller reading the wrong field.**

That is a general limit and it applies to every `lib/` module in this repository,
which is the direction the architecture has deliberately been moving:
`lib/release-gate.mjs`, `lib/route.mjs` and `lib/coverage.mjs` are all pure
decisions extracted so they can be asserted without running the real thing. The
extraction is right. What it cannot see is the ONE THING it moved out of view -
which field the caller passes into it.

`route(input)` was correct for every input `check-route.mjs` handed it, including
inputs where `attempts` and `attempts_total` differed, because the test built
those inputs the same way the router wanted them. `route.mjs`'s CLI - the
gatherer, which is not pure and is not covered by those cases - read `attempts`
and passed it as identity. **The decision was right and the argument was wrong**,
and no amount of case coverage over the decision reaches that.

Two consequences, and only the first is cheap:

1. **A pure module needs at least one end-to-end case that goes through its real
   caller**, over real files, in a state where the fields being conflated actually
   DIFFER. `check-route.mjs`'s F walk is that case, and it is the only thing that
   caught this; every one of the 40-odd pure cases was green. A walk that never
   resets never separates the counters, which is why R-RESET now asserts it
   directly rather than relying on the walk to wander through it.

2. **Extracting a decision moves the defect to the boundary; it does not remove
   it.** Every `lib/` extraction in this repository should be read as having
   traded a hard-to-test decision for an untested argument list. That trade is
   still worth making - a decision nobody can assert is worse - but the ledger
   should say what was bought and what was moved. Nothing currently checks that
   `release-check.mjs` passes the right `isolation`, or that `guardian-record.mjs`
   passes the right coverage numbers, for exactly the same reason.

**A candidate check, not yet written and deliberately not guessed at:** for each
pure module, assert that every field its decision reads is one the CLI demonstrably
writes, over a fixture where those fields hold DIFFERENT values. Whether that is
expressible without a type system is an open question - the honest note is that
the property is clear and the mechanism is not.
