# Queued for 0.1.12 — apply with `/mavci-core:retro --apply`

Recorded: 2026-09-01, plugin 0.1.11, project gate4c.
Result of the run that produced these: `gate-4-closed.md`.

Does not supersede `pending-system-change.md`. That file's change 2 — the gate can
speak — **shipped and works.** 0.1.11 delivered a Stop reason to the agent five
times, and that is the only reason any of the findings below exist. These are the
next layer.

Occurrence: fifth through eighth of the wrong-gate shape. Same shape as all four
before: the half that was tested worked, and the half that mattered was never
connected.

---

## Build order

**0.1.12 is the release where the system can report its own failure.**

1. **Finding 4 — `/mavci-core:retro` exists.** Nothing else in 0.1.12 matters until
   the escalation channel does. This session's findings survived only because an
   agent chose to write a file by hand.
2. **Finding 3 — the crash arm gets the ceiling, and a sticky UNVERIFIED marker.**
3. **Finding 1 — `gate.mjs:249`, with the assertion on `\n  - `.**
4. **Finding 2 — evidence capped at authoring time, in CI, across every rule.**

The order is not arbitrary. 1 and 2 make the gate's own failures legible; 3 makes
them reportable; 4 gives the report somewhere to go. Built in any other order, each
fix lands in a system that still cannot tell anyone it worked.

---

# Finding 4 — `/mavci-core:retro` does not exist

Target: `skills/`

The command the plugin names as its escalation channel is not implemented. There is
no `skills/retro/`, and the plugin ships no `commands/` directory at all:

    $ ls skills/
    build  connect  doctor  new-project  plan
    standards-legal-tr-kvkk  standards-nextjs-app-router
    standards-supabase-multitenant-rls  verify  waive

It is referenced in seven places, and every one of them is a path where the agent
has just been told to stop and hand over:

    gate.mjs:359      the crash message — "Run /mavci-core:doctor, and
                      /mavci-core:retro to file it"
    gate.mjs:405      the retry-ceiling-reached message
    state.mjs:224     "It cannot be retried. Use /mavci-core:retro..."
    verify.mjs:130    the remedy attached to a crashed check
    doctor.mjs:912    "apply it in the system repo with /mavci-core:retro --apply"
    skills/build/SKILL.md:39
    skills/waive/SKILL.md:43

This is what makes Finding 3 total rather than merely awkward. The gate traps the
agent and directs it to a command that does not exist. Both halves of the operator
channel are absent at once: the turn cannot end, and the escalation cannot be filed.

This file and `gate-4-closed.md` were written by hand into `.mavci/lessons/` because
there was no other way to record them. **They survived because an agent thought to.
That is not a channel; that is luck with good manners.**

### The change

1. Implement `skills/retro/`. It must at minimum: take a finding, write it to
   `.mavci/lessons/` in the house format, and — for `--apply` — carry it into the
   system repo. Every call site above is a place where the agent has authority to
   report and no authority to fix, which is exactly the shape this command serves.
2. Add the reference check: **assert every `/mavci-core:<name>` string appearing in
   `scripts/` and `skills/` resolves to a directory under `skills/`.** Static, cheap,
   runs in CI.

### The assertion, and the broken build it must catch

Broken build: 0.1.11. The reference check fails **seven times** against it. Confirm
that before implementing the command — a check that passes on first write against
this build is matching the wrong thing.

---

# Finding 3 — a blocking gate closes the operator channel

Target: `scripts/gate.mjs:344-362` (the `crash` and `timeout` arms), `failClosed`

### Decision: on ENFORCEMENT DID NOT RUN, block once, then let the turn end and mark the session UNVERIFIED.

Not "keep blocking." Not "allow silently."

`failClosed` is right to block a violation it cannot verify, because that block has
an exit condition the agent can reach: fix the code, the violation goes, the gate
passes. A checker **crash** has no such exit. The fault is in the checker, which the
agent is forbidden to edit. The gate's own message says so — *"This is a bug in the
checker, not in your code"* — and then refuses to let the turn end anyway. It
correctly identifies that the agent cannot fix this, and traps the agent until it
does.

That is not fail-closed. Fail-closed is a property about **not shipping unverified
code**, and blocking the turn is not what secures it — `/mavci-core:release` refusing
and `doctor` FAILing are, and those hold whether or not the turn ends. What trapping
the agent actually produces is no verification *and* no report: strictly worse than
ending the turn, because the operator never hears about the crash at all. A gate that
cannot be escalated past converts a checker bug into a total work stoppage and buys
zero safety with it.

Observed: three consecutive turns ended in the identical crash with no way to hand
the decision back to the operator. The fourth escaped only because the agent fixed an
unrelated in-project finding that happened to remove the offending string. That was
luck, and it must not be the exit path.

### The mechanism exists and is wired to the wrong arm

`readContinues` / `GATE_MAX_CONTINUES` exist precisely so an unsatisfiable gate
cannot spin forever. The violation path stamps `continues` (`gate.mjs:386`). **The
crash path returns `failClosed` at :356-359 without consulting the ceiling at all.**
The one arm the agent provably cannot satisfy is the only arm with no ceiling; the
arm it can satisfy is capped. That is inverted.

### The change

1. Put the crash, timeout and unreadable-verdict arms under the same `continues`
   ceiling as the violation arm — ceiling 1 for a checker fault. One block gives the
   agent its chance to diagnose, which in this session was genuinely valuable.
2. On the second consecutive fault with the same signature, **let the turn end** and
   write a sticky `unverified` marker into the control plane.
3. Make the marker loud and persistent: SessionStart reports it, `doctor` FAILs on
   it, `/mavci-core:release` refuses while it stands. It clears only on a clean gate
   run — never on a turn merely ending.
4. Keep the full crash detail in the reason (Finding 1), so the escalation the agent
   is finally permitted to make is one it can actually write.

### The assertion, and the broken build it must catch

Broken build: 0.1.11 with a checker that always throws. Assertion: the agent
**reaches a turn end** within N turns, and the session is marked unverified. Today it
never does. An assertion that the gate blocks on a crash passes against this build —
the gate blocks perfectly, forever.

---

# Finding 1 — the reason is generated correctly and lost in transit

Target: `scripts/gate.mjs:249` (`interpretRunError`)

    const stderr = (err.stderr?.toString?.() ?? err.message ?? '').trim().split('\n')[0];

`assertValid` (`scripts/lib/schema.mjs:149-153`) is documented *"Throw with every
error at once - fixing one field at a time is miserable"* and puts every error on
lines 2..N:

    `${label} failed schema validation:\n  - ${errors.join('\n  - ')}`

`.split('\n')[0]` keeps line 1. Line 1 is the label and a colon. Every error the
validator exists to produce is discarded one function call before it reaches the
agent. Observed four times this session, identically:

    The standards checker crashed: verify.mjs crashed: Error:
    .mavci/control/verdicts/adhoc-1788254362466.json failed schema validation:.

Reproduced against the real verdict:

    === full message ===
    <verdict-file> failed schema validation:
      - checks[4].evidence: longer than maxLength 500
    === after gate.mjs:249 split ===
    <verdict-file> failed schema validation:

This is `pending-system-change.md` change 2 one layer down. That bug was "the reason
never arrived." This one is "the reason arrived with its contents removed." The fix
there wired stderr through; nothing checked what stderr was carrying.

Note that the violation path does **not** route through `interpretRunError`, which is
why Gate 4 passed this session. Only the gate's report of its *own* failure is
truncated. The system can describe your bug and not its own.

### The change

Carry the whole message. If a single line is wanted for a log, take the first line
*and* append the rest, or send the full `err.stack` as `verify.mjs:305` already does.

### The assertion, and the broken build it must catch

Broken build: 0.1.11 as it stands. Assertion: for a checker that throws a multi-error
validation failure, the Stop reason delivered to the agent **contains a `\n  - `
line**. Not that a reason exists — one exists today, and it is empty past the colon.
Confirm the assertion fails against 0.1.11 before writing the fix.

---

# Finding 2 — evidence is capped at write time, which is far too late

Target: the rule set (`scripts/rules/`), CI, `templates/schemas/verdict.schema.json`

`verdict.schema.json` caps `evidence` at `maxLength: 500` and `remedy` at 300.
Nothing checks a rule's evidence against those caps when the rule is written. The cap
fires at `writeControl` (`state.mjs:146`) — after the run, inside the gate, against a
string already assembled from live project data.

Consequence, observed: `settings.marketplace_form` produced 583 characters. The
verdict could not be written. `verify.mjs --record` — the only mode the gate uses —
threw every time. **One verbose string took the entire checker offline for every turn
in the project.** Plain `verify.mjs` was healthy throughout: 11 pass, 5 fail, 1
blocker. Only recording was broken, and recording is the path enforcement runs on.

Note the shape: the checker's most detailed finding is the one that disabled the
checker. Length correlates with importance, so the cap bites hardest exactly where
the evidence is most worth having.

### The change

1. Check every rule's evidence and remedy **templates** against the schema's caps at
   authoring time, in CI, over `scripts/rules/`. A rule whose template can exceed the
   cap fails the build.
2. Templates interpolate project data, so a static check is necessary and not
   sufficient. At write time, **truncate with an explicit marker** rather than
   throwing. A finding reported at 500 characters and visibly cut is worth
   incomparably more than a checker that does not run.
3. Raise the caps if 500 is too small for a rule that needs the room — deliberately,
   not by a throw.

### The assertion, and the broken build it must catch

Broken build: 0.1.11 with `settings.marketplace_form` failing. Assertion: with every
rule failing at once against a fixture project, `verify.mjs --record` **exits 0 and
writes a schema-valid verdict**. Today it throws. A test that runs `verify.mjs`
without `--record` passes against this build — that is the wrong half, and it is the
half that was tested.

---

# Finding 5 — risk-guard matches the command text, not the write target

Target: `scripts/risk-guard.mjs`

Found while filing this file, not during the gate run. Ranked **below** findings 4,
3, 1 and 2 — it is a false positive, not an outage. It is recorded because of the
direction it pushes an agent, not its severity.

The guard refused both of these:

    node -e "... assertValid(v, schema, '.mavci/control/verdicts/adhoc-XXXX.json') ..."
    printf '%s\n' '... without opening `.mavci/control/verdicts/`.' >> .mavci/lessons/pending-system-change.md

The first was a pure in-memory validation whose only mention of the control plane was
a **cosmetic label string**. The second was an append to `.mavci/lessons/` — an
agent-writable path, explicitly allowed by `settings.json` — whose only offence was
**quoting a control-plane path in English prose**. Neither reads or writes the
control plane.

The guard's own message says *"a read is allowed - run it as its own command (cat,
head, grep, jq ...)"*. `printf >> lessons/file.md` is not a read *or* a control-plane
write, and it was refused anyway. The advice does not cover the case, because the
matcher is looking at the wrong thing: the command string rather than the target.

### Why it matters more than its severity suggests

The literal consequence is that **the control plane cannot be documented from Bash.**
Every file in this directory describing how the control plane fails — including this
one — trips the guard by naming the thing it describes. The system is hardest to
write about exactly where writing about it matters most.

The real cost is behavioural. A guard that fires wrongly and often teaches agents and
operators that its refusals are noise, and the documented escape is a bypass flag.
Two false positives in one session, both on commands that touched nothing, is enough
to start that. **The failure mode of a noisy guard is not that it blocks too much; it
is that it trains everyone to turn it off.** This session the agent reworded and
re-ran twice instead — see `gate-4-closed.md`, declined path 3 — but that is
politeness, not a control.

### The change

Match the **write target**, not the command text. Parse redirections and the argument
positions of known writers (`>`, `>>`, `tee`, `cp`, `mv`, `sed -i`); treat a path
appearing only inside a quoted string as data. When the target genuinely cannot be
determined — `node -e` doing arbitrary I/O — refuse as today, but say *"target
undeterminable"* rather than *"this command targets .mavci/control/"*, which is a
claim the guard has not established and which was false both times here.

### The assertion, and the broken build it must catch

Broken build: 0.1.11. Assertion: a command that writes to `.mavci/lessons/` while
mentioning a control-plane path in a quoted string is **allowed**, and a command that
actually writes to `.mavci/control/` is refused. The first half fails against 0.1.11
today. A test that only asserts the second half — that control-plane writes are
blocked — passes against this build, and is once again the half that works.

---

# Note for Phase 2 — Guardian and `/mavci-core:release`

**This session's whole finding, in one line: the gate can report a violation and
cannot report itself.**

Every one of the eight occurrences of the wrong-gate shape is the same failure:
a component was the only witness to its own health, and it reported itself healthy.
0.1.2 registered zero hooks and reported a clean start. The hook self-test printed
"5 cases passed" while agent scope denied every edit. `doctor` compared the running
plugin against its own copy of itself. 0.1.10 blocked correctly and told the agent
nothing. This session: the checker crashed on every turn and could say only that it
had crashed, and the command it named for reporting that did not exist.

Guardian and `/release` inherit this exactly. They are both components whose entire
value is a judgement about whether something is safe, which means both will be
trusted precisely when they are least able to say they are broken.

### The design constraint

**No component may be the only witness to its own failure.** Concretely, for anything
built in Phase 2:

1. **Liveness is external.** Every enforcement component writes a run record, and an
   authority *outside that component* checks it. `pending-system-change.md` change 1
   already established the shape: `doctor` must compare against
   `installed_plugins.json`, not against itself. Apply the same rule to Guardian and
   `/release` from the first commit rather than discovering it fifth.
2. **Absence is a FAIL, never a pass.** "No record found" must never be silence. Every
   one of the eight occurrences reported green from a component that had not run.
3. **The report path must not depend on the component that failed.** Guardian must not
   be the thing that reports Guardian is down, and `/release` must not be the only
   thing that knows it never ran.
4. **Self-report is the first thing built and the first thing tested.** Not the last.
   The failing case — the component down, silent, or crashed — is written and watched
   to fail before the component's happy path is written at all.
5. **Nothing load-bearing depends on an agent choosing to write a file by hand.** That
   is how this session's findings survived. It worked once. It is not a mechanism.

### The assertion Phase 2 owes

For Guardian and for `/release`, the test that earns its place is not "it blocks the
unsafe thing." That test passes against a component that blocks everything, including
by being broken. The test that earns its place is: **kill the component, and assert
the operator is told within one turn, by something that is not the component.**
