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
