# Mavci AI Development System — system repo

This repo **is** a Claude Code plugin marketplace. It is not an application.
Work here changes how every downstream SaaS project is built, so a mistake
propagates. Read `docs/ARCHITECTURE.md` before changing structure.

Governing docs: `docs/ARCHITECTURE.md` (design + rationale),
`docs/NATIVE-CAPABILITIES.md` (what Claude Code verifiably does, with URLs
and version), `docs/ROADMAP.md` (phases, acceptance test, locked formats).

---

## Locked identifiers — never change these

    owner/repo        mavci-ai-devsystem/mavci-ai-devsystem   (private, User account)
    default branch    main
    marketplace       mavci
    plugin            mavci-core
    state directory   .mavci/
    CI secret         MAVCI_TOKEN   (fine-grained PAT, Contents: read-only)

These are written into every project's committed `.claude/settings.json` and CI
workflow. Changing one means hand-editing every project repo. `check-plugin.mjs`
asserts they agree across manifests. Do not propose renaming them.

The account is a **User**, not an Organization: org-level Actions secrets do not
exist here. Every project repo needs its own `MAVCI_TOKEN`.

---

## Working discipline

The expensive thing is not reading files — it is putting what you read into the
main session, where it is re-sent on every later turn and dilutes attention.

- **Delegate work whose byproducts are large and whose conclusion is small.**
  Repo-wide greps, audits, reading test/CI output, surveying files to answer a
  question — use `Explore` or a subagent and return the conclusion, not the
  transcript.
- **Keep narrow, targeted edits in the main session.** A subagent starts cold
  and re-gathers context; delegating a two-line fix costs more than it saves.
- **Read the smallest useful slice.** Name the function or line range, not the
  whole file, unless you genuinely need all of it.
- **Reports: plain prose, under ~10 lines, no ASCII tables.** If a report needs
  to be long, write it to a file and give me the path.
- **Say plainly when a discrete task is finished**, so I know it is safe to
  `/clear` before the next one.

This governs work on the system itself. It is not a standard the plugin
enforces on projects, and it never justifies less care in the control plane,
the risk policy, or the checker.

---

## Invariants — a change that breaks one of these is wrong

1. **Zero npm dependencies** in `plugins/mavci-core/scripts/`. Node ESM only,
   Node 22+. This is what makes the escape hatch (`ARCHITECTURE` §11) a passing
   test rather than a promise. `selftest.yml` runs with Claude Code absent.

   **Node 22 is the API floor, and CI is the authority — not your local Node.**
   Every workflow pins `node-version: '22'`, `config.mjs` sets
   `MIN_NODE_MAJOR = 22`, and `plugins/mavci-core/templates/mavci-verify.yml` runs the cloned
   checker on 22 inside every downstream project. A development machine on a
   newer Node runs a 23+ or 24+ API happily and gives no local signal, and the
   failure then surfaces in a *project's* CI, not this repo's. Before using
   anything recent, check it against Node 22 — do not trust a local pass.

   Raised from 20 on 2026-08-28. Per the official `nodejs/Release`
   `schedule.json`, Node 20 (Iron) ended 2026-04-30 and is unpatched; 22 (Jod)
   runs to 2027-04-30, 24 (Krypton) to 2028-04-30. The cost of moving the floor
   is rewriting the committed workflow in every connected project, which is why
   it was done at zero connected projects rather than after the first
   `/mavci-core:connect`. Node 22 has been in maintenance since 2025-10-21, so the
   next move — to 24 — should happen well before April 2027.
2. **`plugins/mavci-core/agents/*.md` are generated.** Source of truth is
   `agent-defs/*.json` plus `agent-defs/_contract.md`. Never hand-edit a
   generated agent; edit the def and run `build-agents.mjs`. CI fails on drift.
3. **No binary files, no NUL bytes, UTF-8 without BOM, LF endings.** A file that
   shows as "Binary files differ" cannot be reviewed and is silently skipped by
   `grep -r`. Enforced by `check-plugin.mjs`.
4. **A new standard requires a new check.** A class-A change (missing standard)
   without a class-B check (nothing verifies it) is rejected — that is how the
   system decays back into prose. Every check needs `plugins/mavci-core/templates/fixtures/
   <check_id>/{bad,good}/`, asserted in CI.
5. **A failed probe is never reported as a pass.** In `doctor.mjs` and anywhere
   else, "could not check" is WARN or FAIL, never OK. An unchecked control is
   not a working control.
6. **Hooks fail open on timeout and crash** (NATIVE-CAPABILITIES 4.17/4.18).
   Every hook script catches its own errors and blocks; timeouts are covered by
   the completion sentinel, not by hope.
7. **State-file format rules are locked** (`ROADMAP`, "Data-format constraints"):
   `schema_version`, `project_id`, ISO-8601 UTC, closed enums, repo-relative
   POSIX paths, one file per entity, prose in sibling `.md`.

---

## Release

The version in `plugins/mavci-core/.claude-plugin/plugin.json` **is** the release
action — nothing propagates to any project until it is bumped. `release.yml`
fails a tag that disagrees with it.

    edit → build-agents.mjs if a def changed → bump plugin.json → commit →
    push → node scripts/ci/check-pretag.mjs vX.Y.Z --cut

`--cut` is the only door to a tag, and since 0.1.29 it is the only door to a
RELEASED one: it runs the release suite, creates the annotated tag, pushes it by
explicit refspec, reads it back off origin, and then watches the release run for
up to **10 minutes**. Do not tag or push a tag by hand — a hand-cut tag skips
every arm of that gate, and a hand `git push` or `git push --follow-tags` can
answer "Everything up-to-date" and send nothing.

It refuses to run in `~/.claude/plugins/marketplaces/mavci` at all: a release cut
in generated state is not a release, because the next propagation destroys it.

**Three exit statuses, and they are three different answers.** `0` the tag is on
origin and CI passed. `2` a refusal — and up to and including the push, nothing
was released; **no tag exists anywhere**, so re-running the same command is the
whole recovery. `3` the tag IS on origin and the verdict could not be read (the
run has not appeared, is still going, or `gh` could not be reached): finish the
watch by hand, and never move the tag.

Nothing propagates when a tag is pushed. That is the next paragraph, and `--cut`
names it on every green run.

Propagation is **manual at both links** and costs one operator visit per
machine per release: `git fetch origin` + `checkout -B main origin/main` in
`~/.claude/plugins/marketplaces/mavci`, then `claude plugin uninstall
mavci-core@mavci` + `claude plugin install mavci-core@mavci --scope user`,
then restart. `/plugin marketplace update` does not move the clone (4 of 4)
and `claude plugin update` does not move the install (1 of 1) — 6.21, and
`ARCHITECTURE` §2 step 5. No project file is edited.
roll-forward is primary, because ref-pinning inside `extraKnownMarketplaces` is
unverified (6.16).

---

## Current state

**Counts refreshed 2026-09-03, at 0.1.23; the prose below it is from the
0.1.17 rewrite and still governs.** Two of the five agents in that roster had
never run when 0.1.23 was cut - `mavci-verifier` was named by no skill and
`mavci-scribe` had none at all and could not have started if it had. THAT IS THE
EXACT FAILURE THIS SUMMARY WAS REWRITTEN TO PREVENT, one level down: the counts
were right and a count is not a claim that the thing runs. A roster line means
five agent files exist. It does not mean five agents are reachable, and after
0.1.23 the thing that means that is `check-route.mjs`'s assertion that every
agent except guardian is named by the router.

**Rewritten 2026-09-02, at 0.1.17.** It had said guardian, scribe and
`/release` were unbuilt for two releases after they shipped, and named a script
list that was six of thirteen. A summary that is wrong about what exists is
worse than no summary: it is the thing a new session reads *instead of* looking,
so it does not merely fail to help — it actively misinforms, and it is the same
drift the release log was called out for below. Every count here is checkable
from the tree, and the check is named beside it.

**Phase 1 and Phase 2's roster are built.**

    5 agents      architect, builder, verifier, guardian, scribe   agents/*.md
    15 rules      RULES in scripts/rules/index.mjs                 rules/index.mjs
    15 skills     3 of them the standards packs                    skills/
                  FIFTEEN as of 0.1.23, not the 13 at 0.1.22:
                  `ship` is the chain, and `scribe` is the skill
                  that agent shipped without. Both counts are
                  `ls plugins/mavci-core/skills/`.
    16 scripts    state, redact, verify, gate, risk-guard,         scripts/*.mjs
                  doctor, retro, release-check, guardian-record,
                  worklist, render, build-agents, config,
                  0.1.18's corpus-stage and corpus-score, and
                  0.1.23's route. `lib/route.mjs` holds the
                  decision and is not counted here - lib/ never is.
    9 hooks       every one silent outside a Mavci project         hooks.json
                  (6.23). NINE, not the eight this file and
                  check-hooks-quiet's header both still said:
                  0.1.15 added guardian-record on SubagentStop.
                  Entries below that name eight are dated
                  observations and correct as history.
    ?? checks     the release suite, DERIVED from release.yml      check-pretag.mjs
                  The number is PRINTED BY THE GATE on every pass
                  and is deliberately not written here: 0.1.23
                  added two checks and the only honest way to know
                  the total is to read a run. Every previous value
                  in this line was maintained by hand and every
                  one of them went stale. It was 33 at 0.1.22, and
                  THIRTY-THREE was not the 28 this file
                  said at 0.1.21. The count is printed by the gate
                  on every pass, so it is read from a run, never
                  maintained here by hand. It was 24 at 0.1.17 and
                  the entry below explains the jump to 28: 0.1.18
                  added four, to selftest.yml only, where no
                  release gate ever ran them. See the 0.1.18 entry.
    34 scripts    every check script in scripts/ci/                check-ci-gates.mjs
                  Larger than the suite above: the suite is what
                  release.yml runs, and check-pretag declares four
                  excluded steps with reasons on every pass.

`/mavci-core:release` exists, which is carried-forward item 8's condition met:
the fourteen references that were reworded to name the operator may name the
command again, and `check-command-refs.mjs` is what makes restoring them safe.

**Not built, per plan:** `/research`, two of the five standards packs, and nine
further checker rules — `supabase.rls_policy_per_table` and
`supabase.tenant_column` among them, deferred for the stated reason that they
need a real SQL statement parser rather than regex.

**Guardian's machinery is covered by CI; guardian's ANSWERS are not.** The
acceptance corpus is operator-run and there is no result for it —
`check-corpus.mjs` asserts the corpus is well-formed, which is a different
question and must not be read as the first. `doctor` FAILs on every project
until a result exists, deliberately: an absent corpus result is a failure, not a
silence. This is the largest unproven claim in the system, and it is load-bearing
— guardian is the component whose output the release gate reads.

**Gate 4 is CLOSED** (2026-09-01, project gate4c, against v0.1.11). Enforcement
passed end to end: detection, verdict, exact line number, refusal, and
**fix-in-place** — the agent named the check and the file from the Stop reason
alone and repaired it in the same turn, without opening
`.mavci/control/verdicts/`. Post-repair the verdict was clean and the file was
byte-identical to HEAD. Full record in `docs/lessons/gate-4-closed.md`; the
findings it produced are `docs/lessons/pending-system-change-0.1.12.md`, and
0.1.12 is what was built from them.

The lesson worth carrying past the result: **the gate can report a violation and
cannot report itself.** Every one of the eight occurrences of the wrong-gate
shape lived in a component's self-report. Gate 4 tested enforcement; it did not
test enforcement's self-report, and 0.1.12 is the release that closes that for
the gate specifically. Guardian and `/release` inherit the same problem, and the
design constraint they must be built under is in `ROADMAP` Phase 2.

Distribution is **partly proven.** Gate 4's re-run (2026-08-28) settled the
shape of it: the plugin is installed **once per machine** with
`claude plugin install mavci-core@mavci --scope user`, and after that a project's
committed `settings.json` loads it with no per-project install — verified by a
brand-new session in a project carrying only that settings block answering
`/context` with three agents and 32 skills. The state that breaks it is a
**project-scoped** install record with no user-scope anchor: it pins the plugin
to one directory and answers for that directory everywhere else, silently
(6.20). Never `/plugin install` from inside a session — it has no scope
argument. `doctor` FAILs the anchorless state and names the pinned repo.

It also found the defect that mattered. v0.1.2 put the argv array in `command`
in `hooks.json`; Claude Code rejected all eight entries and installed the plugin
with **zero hooks** — no risk guard, no standards gate, no phase gate — cleanly
and silently. Fixed in 0.1.3, along with the three checks that should have
caught it: `claude plugin validate --strict` in CI, strict hooks-schema
validation in `check-plugin.mjs`, and `doctor` proving hook registration from
`control/hook-run.json` instead of inferring it from the scripts behaving.

**The lesson, which generalises past this bug:** `--plugin-dir` does not run the
plugin loader's schema validation (4.22), so local development cannot see this
whole class of fault. Before any release, `claude plugin validate --strict` is
the authority — not our reading of the docs, and not a local run.

0.1.4 completes it: `control/hook-run.json` now carries `schema_version` and
`project_id`, has a schema under `plugins/mavci-core/templates/schemas/`, and is covered by
`state.schema_valid`. `check-schemas.mjs` asserts its closed enum agrees with
`config.mjs`, so the duplicated enum cannot drift.

**Gate 3 PASSED against v0.1.4** (2026-08-28). With `settings.json` alone and no
`/plugin install`, `/reload-plugins` reported *2 plugins · 16 skills · 9 agents ·
8 hooks*, and `/context` listed `mavci-core:mavci-architect`, `-builder`,
`-verifier` plus the three `standards-*` packs. Eight hooks registered — the
0.1.2 defect is closed, and the onboarding protocol's core assumption holds.
(That run happened on a machine with an **empty plugin registry**. It is the one
observation of the anchorless path working, and it is recorded as unspecified
behaviour rather than the supported route — the supported route is the
per-machine `--scope user` install. See 6.20 and its session table.)

0.1.5 fixes the two things that pass revealed, both of which are the same shape:
a value that was written down once, wrongly, and then copied everywhere.

1. **The command namespace was the marketplace name, not the plugin name.**
   Claude Code namespaces plugin components by the **plugin** (6.11), so every
   command is `/mavci-core:<skill>` and every agent is `mavci-core:<agent>`.
   `mavci` is only the marketplace, and appears solely in `enabledPlugins` and
   `/plugin update`. 105 references across docs, skills, agent contracts, hook
   messages and schema descriptions named commands nobody could type. No code
   constructed a name from `MARKETPLACE_NAME` — they were all prose literals,
   which is why nothing caught them. `config.mjs` now exports `COMMAND_PREFIX`
   derived from `PLUGIN_NAME`, and `check-plugin.mjs` sweeps the whole tree for
   the marketplace form and fails on it, with a negative control on both halves
   of the needle.

2. **The marketplace `source` form was wrong, and `doctor` demanded the wrong
   one.** Of the four documented forms only `{"source":"git","url":"https://….git"}`
   resolves. `github` clones over SSH (6.18, known since 0.1.3); `url` fetches a
   remote `marketplace.json` over HTTP and 404s on a `.git` address — and `url`
   is what 0.1.3 and 0.1.4 shipped in `plugins/mavci-core/templates/project.settings.json` *and*
   what `doctor` failed every other form into. A checker that drives every
   project into the broken configuration is worse than no checker. `doctor` now
   fails `github`, `url`, an unsubstituted placeholder, and a `git` form pointing
   anywhere else, and every one of those failures prints the working form.
   `check-doctor.mjs` asserts all four, asserts the good form passes, and asserts
   the template and `doctor` agree — the drift that went unnoticed for two
   releases. NATIVE-CAPABILITIES 6.4 carries the full matrix.

0.1.7 is the Gate 4 re-run's finding, and it is about the **machine**, not the
project. The plugin is installed once per machine with
`claude plugin install mavci-core@mavci --scope user`; after that a project's
committed `settings.json` loads it with no per-project step. Never
`/plugin install` from inside a session: it has no `--scope` argument, so it
records `{"scope":"project","projectPath":"<one directory>"}`, and a pin with no
user-scope anchor behind it is the only answer the resolver has for every other
project on the machine — silently (6.20). Two consequences are now enforced,
because both were invisible:

1. `doctor` reports which record holds the plugin up, **FAILs** the anchorless
   state, names every pinned directory, and prints the scoped uninstall before
   the user-scope install (`plugin uninstall` defaults to `--scope user`, so the
   obvious command leaves the pin in place). A project pin *alongside* the
   anchor is written automatically by Claude Code at session start (6.22) and is
   reported as an OK detail — failing on it would fail on every healthy machine.
2. User scope means the plugin resolves in **every repository on the machine**,
   so all eight hooks run in repos that have nothing to do with Mavci. Seven
   were already silent without `.mavci/project.json`; the SessionStart preflight
   was not, and was reporting into unrelated repositories (6.23).
   `check-hooks-quiet.mjs` asserts all eight, both directions, and counts the
   entries in `hooks.json` so a ninth hook fails the test until it is covered.

Still unproven: version propagation across a bump — the four-command manual
procedure above, end to end, from a pushed tag to a restarted session running
the new code — and hooks actually **firing**: 8 hooks are registered, but no
`control/hook-run.json` receipt has been checked in a connected project yet.
Both are Gate 4, restarting from step 3 in a clean project **against v0.1.7**.
`gate4` and `gate4-verify` are contaminated — an emptied `enabledPlugins` in one,
an auto-recorded project pin and an untracked settings file in the other — and
are not valid starting states.

### Gate 4 enforcement step — FAILED on 0.1.9

**A real standards violation never blocked a turn; a checker malfunction did.**
`gate.mjs`'s violations path emitted its Stop payload and then `process.exit(0)`.
The payload carries no decision Claude Code is documented to act on — 4.5
asserted that `{"hookSpecificOutput":{...,"continue":true,"stopReason":"..."}}`
"continues the conversation", and that claim was never verified — so exit 0 was
the entire decision and the turn ended. `failClosed`, used for a timed-out,
crashed or unreadable checker, followed the same payload with `process.exit(2)`,
which the exit-code-2 table does guarantee. **So the gate blocked when it broke
and passed when your code broke.** That is the inversion.

Observed in gate4c, 2026-08-29: eight Stop-hook verdicts in one session, every
one `"verdict": "fail"` carrying a `critical` blocker, and not one turn stopped.
It shipped in every release from 0.1.2 through 0.1.9 — seven releases.

`check-gate.mjs` had a case for this and it passed the whole time, because it
asserted the payload's SHAPE and never the exit status. The acceptance test
claimed the behaviour and never ran it. **An assertion that cannot fail is not
coverage**, and this one hid a dead enforcement layer for seven releases.

The assertion was not merely weak — it was **adjacent**. A correctly-shaped
payload is a real thing to assert; it simply was not the thing that mattered.
That is the sixth instance of the adjacent-but-wrong signal this Gate found, and
the test that separates them is the one already written down: *what would a
broken build look like, and would this say so?* A gate that emits the right JSON
and exits 0 looks exactly like a gate that works.

### 0.1.10 — cut mid-Gate, deliberately

**Cut 2026-08-29 while Gate 4 was live. This is an exception to the rule below
and is recorded as one.** The rule protects a Gate run from having the thing
under test moved beneath it. Here the Gate's own finding was that the thing
under test cannot produce the observation at all: no code path in 0.1.9's gate
stops a turn, so the enforcement step is unrunnable on 0.1.9 and re-running it
changes nothing. The rule was protecting a result that had already been
produced. The step is recorded FAILED on 0.1.9 above, and re-runs against
0.1.10.

0.1.10 is one thing: **the gate can now stop a turn.** Contents: `exit 2` on the
violations path; `check-gate.mjs` asserting exit status before shape; 4.5 and
4.6 corrected, with `continue` marked UNVERIFIED rather than resolved;
`settings.marketplace_form`'s claim narrowed to what the rule can actually see;
`$comment2` likewise. Nothing else. The items previously logged here are NOT in
it — see 0.1.11. Shipping an untested command surface and a schema migration
alongside a critical gate fix is how the gate bug shipped in the first place.

**How the exception was even detectable — record the method, not the incident.**
The finding came from a controlled test designed to fail. A defect was planted
deliberately, the rule expected to catch it was named in advance, and the rule
was then read to confirm it actually covered the path before the test ran —
which is how the first candidate defect was discarded: `next.route_force_dynamic`
matches `app/api/**/route.ts` only and would never have fired on a page, so
planting a missing `force-dynamic` there would have proved nothing and been
scored as a pass. The substitute was chosen for coverage *and* for blast radius:
criterion 9's module-scope client over criterion 10's service-role key, because
if the gate did not hold, the defect left in the tree must not be the one that
bypasses RLS. Only then was it run — and the gate's silence became evidence
instead of reassurance. **Without that sequence the gate would have kept passing
turns and the inversion would have reached the first real project.** Build the
next Gate the same way: plant, predict, verify the rule covers the path, then
run.

**The rule, restated:** do not move the plugin mid-Gate — *unless the Gate's own
finding is that the plugin under test cannot produce the observation the Gate
exists to make*. Then the run is already over: record its result and cut. That
is the only exception, and it requires a finding, not an inconvenience.

### 0.1.11 — the gate can speak

**Cut 2026-08-29. Single-purpose, deliberately, for the same reason 0.1.10 was:
the next Gate step is the fix-in-place test, and it can only be attributed to a
release whose only change is that the gate can speak.** The doctor fix and the
lifecycle items were held back to 0.1.12 — see "recorded, not built" below.

0.1.10 made the gate block. It blocked in silence: exit 2 refused the turn and
the entire Stop feedback was `No stderr output`, while `detail` — check id, path,
line, evidence, remedy — sat in a field nothing reads. **Blocking without a
reason is close to not blocking, and in one respect worse than 0.1.9: 0.1.9
failed loudly in a verdict file a person might open. 0.1.10 refused in silence.**
An agent that is refused and not told why cannot fix the violation, so it stops
again identically until `GATE_MAX_CONTINUES` is spent and the gate gives up —
the loop guard becomes the exit path for every real violation.

Contents: `emitBlock` replaces `emitContinue`, writing top-level
`{"decision":"block","reason":detail}` to stdout **and** `detail` to stderr before
`exit 2`, on the violations path, in `failClosed`, and in `main().catch`.
`emitMessage` stays for the two non-blocking notes. `continue` and the nested
`stopReason` are gone. 4.5 and 4.6 are rewritten from a table that loaded in
full; ARCHITECTURE's blocking-verdict example and ROADMAP's A8 criterion are
corrected. Nothing else.

**The contract is quoted, not inferred.** 0.1.10's condition for touching this
payload again was "do not change the string until the decision-control table
loads and it can be quoted verbatim". It loaded on 2026-08-29 — 316,753 bytes,
no truncation — and settled three things, two of them against us:

1. **`continue` was never the inversion we recorded.** It is a universal field:
   *"`continue` | `true` | If `false`, Claude stops processing entirely after the
   hook runs."* It defaults to true and acts only when false, so `continue: true`
   was **inert**, not contradictory. The 0.1.10 note calling it "the literal
   opposite of the intent" was wrong. It is removed anyway — inert noise in a
   blocking payload is one more thing a future reader must work out is
   meaningless — but removing it fixed no bug.
2. **The nesting was the whole defect**, and 0.1.10's note claiming *"the nesting
   was right"* was the load-bearing error. For `Stop` the only
   `hookSpecificOutput` field honoured is `additionalContext`, so a `stopReason`
   nested there renders **no decision at all** — and because no JSON decision was
   made, resolution fell through to *"your stderr text otherwise"*, which
   `gate.mjs` never wrote. `No stderr output` was the contract working exactly as
   documented.
3. Top-level `stopReason` would not have helped either: *"Message shown to the
   user when `continue` is `false`. Not shown to Claude."*

**The self-test was written first and watched fail — the first application of
0.1.10's rule, and it holds.** `check-gate.mjs` gained
`deliveredBlockingMessage`, which resolves *what the agent actually receives* by
the documented order (*"The blocking message is the reason from your JSON's
blocking decision when it makes one, and your stderr text otherwise"*) rather
than by our own convention. Against 0.1.10 it reported `NOTHING reached the
agent` — **while the two assertions directly above it, `exit 2` and `the payload
names the failing check`, both still passed.** That is the adjacent-but-wrong
signal caught in the act rather than seven releases later, and it is why the
rule is written down.

**Two carriers means two assertions.** The first green run resolved *both*
delivery assertions via `decision.reason`: stderr was written and never
exercised, because the JSON decision wins whenever it is present. A test that
depends on which carrier happens to win is how belt-and-braces decays into one
belt and a decorative brace — which is precisely what 0.1.10 shipped.
`assertDelivered` now resolves twice, the second time with stdout removed, which
is the documented fallback (*"A hook that exits 2 while printing JSON that fails
JSON output schema validation still blocks: Claude Code uses stderr as the
blocking reason"*), and requires `decision.reason` then `stderr`. Negative
control: deleting the single `process.stderr.write` makes only the second half
fail. **Each brace is independently load-bearing, and that is now asserted, not
asserted-and-always-true.**

**The same wrong payload had been copied into three more documents**, which is
the 0.1.5 shape again — a value written down once, wrongly, then propagated.
ARCHITECTURE's example asserted `continue: true` was "verified (4.5)". Worse,
**ROADMAP's A8 acceptance criterion required the dead shape**: Gate 4 would have
scored a gate that blocks nothing as a PASS. An acceptance test that certifies
the defect is the same failure one level up from the defect.

Still untested, and the only claim left in Gate 4's enforcement step:
**fix-in-place** — whether an agent reads the reason and repairs the violation in
the same turn, with nobody opening `.mavci/control/verdicts/` by hand. That path
did not exist before this release, so it has never been exercised. It runs in
gate4c against v0.1.11.

### 0.1.12 — the system can report its own failure

**Cut 2026-09-01, against Gate 4's findings.** Gate 4 is CLOSED: enforcement
passed end to end, including fix-in-place — the agent read the Stop reason,
named the check and the file from it alone, and repaired the violation in the
same turn without opening `.mavci/control/verdicts/`. Both lesson files are
promoted to `docs/lessons/`, byte-identical, with `docs/lessons/README.md`
carrying their provenance. That copy was manual because `/mavci-core:retro` did
not exist, which is the first item below; the next promotion is a command.

Build order was 4, 3, 1, 2, then the risk-guard finding as 5. Item 4 first
because nothing else matters until the escalation channel does.

**1 (finding 4) — `/mavci-core:retro` exists, and every command reference now
resolves.** `scripts/retro.mjs` plus `skills/retro/`. The authority split is the
design: `--record` is reachable by an **agent**, because a reporting channel an
agent cannot reach is the trap; `--apply` and `--clear` are the operator's, gated
by caller in `risk-guard.mjs` exactly as `state.mjs --set-phase` is.
`check-command-refs.mjs` asserts every `/mavci-core:<name>` the plugin ships
resolves to a real skill.

**Confirmed failing against 0.1.11 first, and it found more than the finding
predicted.** `/mavci-core:retro`: **exactly seven**, all seven inside `scripts/`
and `skills/` — the prediction holds precisely. But the same check found
**`/mavci-core:release` fourteen times** (7 in the finding's scope, plus three
generated agents and four scaffold legal pages). That command is equally unbuilt
and equally named. The finding counted only `retro` because `retro` was the one
that trapped someone; `release` is the same defect that had not been stepped on
yet. All 14 were reworded to name what exists — the operator — because an
exception list for "we will build it later" is where this class of defect goes
to live. When `/release` ships, the names come back.

**2 (finding 3) — a checker fault blocks once, then lets the turn end and marks
the session UNVERIFIED.** New `control/unverified.json`, its schema, and its
enum asserted against `config.mjs`. `doctor` **FAILs** on it; the `PreToolUse`
guard repeats it every tool call; it clears only on a gate run that **passes**,
never on a fail and never on a turn merely ending. The counter keys on the fault
**signature**, not `prompt_id` — each turn is a new prompt, so the old counter
reset every turn and could never reach any ceiling, which is why the crash arm
was uncapped in practice as well as in code.

The assertion that separates a working build from the broken one is *the agent
reaches a turn end within N turns*, not *the gate blocks on a crash* — the
second passes against 0.1.11, where the gate blocks perfectly, forever.
Confirmed failing first: `statuses=2,2,2,2  kinds=block,block,block,block`.

**3 (finding 1) — the crash reason arrives with its contents.**
`interpretRunError` ended `.split('\n')[0]`; `assertValid` puts every error on
lines 2..N, so line 1 was the label and a colon. `check-gate.mjs` now asserts the
delivered reason contains a `\n  - ` line, and the fixture **throws through the
real `assertValid`** rather than imitating its format — a hand-written expected
string would keep passing if the separator ever changed, which is the same
adjacent-but-wrong shape. Proved both ways: green with the fix, red with the one
line restored.

**4 (finding 2) — caps are enforced where they can be fixed.**
`EVIDENCE_MAX_CHARS`/`REMEDY_MAX_CHARS` move into `config.mjs`;
`check-schemas.mjs` asserts they still equal the schema's `maxLength`;
`check-evidence-caps.mjs` holds `scripts/rules/` under them at authoring time;
`clamp` in `verify.mjs` truncates **with a visible marker** instead of throwing,
for the interpolated string a static check cannot see. The 583-character
`settings.marketplace_form` evidence was rewritten to fit — reproduced at exactly
583 before the change.

**This check passed against the broken build on its first run.** Two reasons,
both instructive: the static half measured `rule.remedy`, which was never the
problem, and the runtime fixture wrote `source: "github"`, tripping the same rule
one branch earlier with a short string. Fixed by measuring the **evidence
chains** and by pointing the fixture at the branch that actually produced 583.
Two further versions of the chain scanner reported five false positives for one
true one — first from a regex matching a quote inside a string, then because
`blankSource` is documented "not a parser" and reads a backtick inside a regex
literal as a template literal. It is anchored on `evidence:`, `remedy:` and
`finding(` now. A check that cries wolf five times per real finding gets edited
until it stops, and the real finding leaves with the noise.

**5 (the risk-guard finding) — the guard matches the write TARGET, not the
command text.** Two false positives in one session, both on commands that wrote
nothing to the control plane: a `node -e` whose only mention was a cosmetic label
string, and a `printf >> .mavci/lessons/` whose only offence was quoting a
control-plane path in English prose. The literal consequence is that the control
plane could not be documented from Bash — every lesson file describing how it
fails tripped the guard by naming the thing it describes.

The reason this ranks above its severity is behavioural. **A guard that fires
wrongly and often trains everyone to turn it off**, and the documented escape is
a bypass flag. Rewording and re-running twice, which is what happened in gate4c,
is politeness rather than a control and must not be designed around.

The fix distinguishes naming a path from writing to one: redirection targets and
the operand positions of known writers are targets whatever their quoting; a path
appearing only inside a quoted operand of a non-writer is data. Fail-closed is
preserved — an unrecognised command with an **unquoted** control path, or any
interpreter doing arbitrary I/O, is still refused. What changed there is the
message: it now says the target could not be determined, instead of asserting
*"this command targets .mavci/control/"*, which the guard had not established and
which was false both times it fired. `check-risk-guard.mjs` asserts both halves;
the `allow` half failed four times against 0.1.11 and the `deny` half never
regressed. 80 cases now, up from 62.

**6 — remedy authority is in the rule text, and in a check.** That check is
**`check-evidence-caps.mjs` PART 2**, not a separate file. Both properties are
answered by reading `rules/index.mjs` and neither needs a project, so they share
one script. Named here because `rules/index.mjs` referred to a
`check-remedy-authority.mjs` that was never committed, and an audit had to open
`git log` to find out which of the two cases it was. One name for one check. A rule declares
`authority: 'agent' | 'operator' | 'external'`, and anything but `agent` must
carry an `AUTHORITY:` note naming who can act. Four rules declare one.

This is Gate 4c's fourth declined path made structural. *"Have the text reviewed,
then delete the REVIEW REQUIRED marker"* asked an agent to do one thing it cannot
and one thing it must not, and the cheap path was **sanctioned by the check's own
remedy text**. The agent declined, which is the only reason it is a design note
and not an incident. A remedy that only the operator or an outside party can
perform, written as if the reader could perform it, is not advice — it is an
instruction to fabricate. The same wording is now in `doctor`'s legal-watermark
warning and in the four scaffold legal pages.

**Also fixed, found while reading:** ARCHITECTURE 6.4's `hooks.json` example
still showed `"command": ["node", …]` — the array form that made v0.1.2 install
with **zero hooks**. A governing document showing the broken form as canonical is
how that comes back.

**Still open, deliberately.** The `deferToUser` finding (item 7 of the old list,
below) is **not** in this release. Its condition stands unmet: the decision-control
table has not loaded this session, so the accepted value cannot be quoted
verbatim, and `ask` versus `defer` is exactly the adjacent-but-wrong distinction
this Gate keeps finding. Guessing at a hook payload value is how both this and the
Stop gate happened. Tier 3 is unaffected — `deny()` is valid and was observed
hard-blocking.

**Not built, and now written down where it cannot be lost:** `/mavci-core:release`
must refuse while `control/unverified.json` stands. That is the half of
fail-closed that moves to the ship gate when the turn is allowed to end, and
until `/release` exists only `doctor` and the `PreToolUse` notice hold it. It is
recorded in ROADMAP Phase 2 as a gap, not described as a design. The dangling
`/release` references it shares a name with are finding 8 below.

### The method earned its place three times in this release — record it

Each of these is `CLAUDE.md`'s rule — *name the broken build the assertion must
catch, and show it failing first* — producing a result nothing else would have
produced. They are recorded as method, not as incidents.

**1. Three tries to find the assertion that discriminates (item 4/finding 2).**
The evidence-cap check **passed against the broken build on its first run.** It
measured `rule.remedy`, which was never the problem, and its runtime fixture
tripped the rule one branch early with a short string. Two further versions of
the chain scanner then reported **five false positives for every true one** —
first a regex opening a phantom literal at a quote inside a string, then
`blankSource` reading a backtick inside a regex literal as a template literal.
Only the fourth version discriminated. **Without "show it failing first", version
one ships as coverage** and the 583-character string is caught by nobody until it
takes another project's checker offline. Note also that five-false-positives-per-
true-one is not a cosmetic defect: it is item 5's lesson one layer up, and a check
in that state gets edited until it stops complaining.

**2. A ceiling that cannot be reached is the same shape as an assertion that
cannot fail (item 2/finding 3).** `readContinues` keys on `prompt_id`. Every turn
is a new prompt, so the counter reset to zero every turn — the crash arm was
uncapped *in practice* as well as in code, and reading the code alone would have
shown a ceiling sitting right there. It was only visible from the outside, as
`statuses=2,2,2,2`. The same family as `check-gate.mjs` asserting payload shape
for seven releases: a mechanism that is present, correct-looking, and never
reached.

**3. Loosening a guard without proving the denials survived is how the loosening
becomes the hole (item 5).** The `allow` half failed four times against 0.1.11 and
the `deny` half never regressed once — which is the only reason the rewrite from
string-matching to target-matching is trustworthy. A test of the `allow` half
alone would have gone green on a guard that had stopped denying anything, and the
whole change is a *relaxation*: that is precisely the direction where one-sided
evidence is worthless. Both directions, every time a control is loosened.

### 0.1.13 — the escalation channel could not read its own queue

**Cut 2026-09-01, from `/mavci-core:retro`'s own first run.** 0.1.12 shipped the
channel and the first real use of it found two defects inside it, both the shape
of the eight before: a mechanism present, correct-looking, and never connected to
the thing it claimed to cover. Built first, before anything else in this release,
for the reason item 4 came first in 0.1.12 — **the escalation channel has to work
before the findings it carries mean anything.**

**1 — the queue is a directory, and both readers tested one path inside it.**
`doctor.mjs:911` and `retro.mjs:61` each composed
`.mavci/lessons/pending-system-change.md` for themselves. So doctor answered *is
anything queued?* with *does the name I picked in advance exist?* — and what was
actually queued was `pending-system-change-0.1.12.md`, written by hand before the
command existed. It was invisible. `--clear` would have deleted the applied file
and left the open one with the only pointer to it gone, silently, because doctor
watched the same fixed path.

`queuedLessons()` in `retro.mjs` is now the one definition of the queue and
`doctor` imports it. `--list`, `--show`, `--apply` and `--clear` all enumerate;
`--apply` checks every destination before writing any of them, and keeps each
file's suffix so two files from one project on one day cannot collide; `--clear`
requires a name whenever more than one is queued.

**The assertion is that doctor NAMES the file, not that it WARNs.** Asserting on
the warning passes against the broken build — and against a build that counts
files without saying which, which is the same defect one step later. "Something
is queued somewhere" is not a pointer.

**2 — the writer and the parser disagreed on a character.** `record()` wrote
`# Finding 3 - x` with U+002D; every hand-written heading used U+2014. The parser
counted machine-written findings, missed human ones, reported zero for a file
holding two, and would have appended a **second `# Finding 1`** under an existing
one. Reproduced exactly by the negative control: `filed finding 1`.

**Widening the regex was the wrong half, and that is the point.** Accepting both
dashes fixes the count and leaves the disagreement standing for the next
divergence in spacing or wording. `findingHeading()` now writes the heading and
`FINDING_RE` is built from the same pieces, so the two change together or neither
does; reading normalises the dash family to U+002D on a **copy**, and the title
is sliced out of the original by index. Normalising on write would have edited a
human's punctuation inside the file that is the evidence — that is asserted
separately, and the negative control fires exactly one failure.

**3 — `doctor` FAILs when the active `gh` account cannot own the system repo.**
This machine holds two `gh` accounts, the active one was `globalmvpllc-oss`, and
every git and gh call against `SYSTEM_REPO` returned `Repository not found`. A
private repo is invisible to an account without access and GitHub does not
distinguish *you may not see this* from *this does not exist*; nothing in the
message mentions accounts. The operator nearly recreated a repository that had
never gone anywhere. `checkGhAccount` runs **before** `checkReleaseRun`, which is
the check that makes that exact 404 and explains it as "gh is unavailable,
unauthenticated, or offline" — three wrong answers for one right one.

It compares logins and nothing else: no network, no rate limit, and it answers
the only question the 404 leaves open. Two things it deliberately does not
overclaim — the remedy is `gh auth login`, not `gh auth switch --user <owner>`,
when the owner has never authenticated here (switch errors for an account that is
not logged in, which is the adjacent-but-wrong remedy), and the failure says
outright that it compared names and cannot see whether some other account holds a
collaborator grant.

**Found while fixing 1 and 2, and worth more than either.** The house main guard
compares `process.argv[1].endsWith('<script>.mjs')`. `scripts/ci/check-retro.mjs`
ends with `retro.mjs`, so writing retro's first self-test ran retro's CLI on
import — usage printed, exit 2, before one assertion executed. **A suffix test
standing in for an identity test**, which is finding 2 in a different costume: it
works until something legitimate sits just outside it. It is the eleventh
instance of that shape, and the first to occur **inside a test harness** — the
self-test invoked the thing it was testing before one assertion ran, so the
harness could not have reported anything, in either direction.

All five guards now compare the basename, not the one that collided: an identity
test that is wrong in four places and right in one is the same defect on a delay,
waiting for the next `check-<script>.mjs` to be written. `check-plugin.mjs` fails
any script that reintroduces the suffix form, naming the `check-<script>.mjs`
that would collide.

**Coverage.** `check-retro.mjs` is new — 0.1.12 shipped the channel with no
behavioural self-test at all, only the risk guard's authority cases. Every
assertion in it was watched failing against 0.1.12 first, and three negative
controls confirm the braces are independently load-bearing: a parser blind to
U+2014 fails four assertions and not the round trip; normalising on write fails
exactly one; unwiring `checkGhAccount` fails only the wiring assertion while all
four decision assertions stay green. One assertion went green against the broken
build on its first run and was rewritten — it matched `does not exist`, which is
also what `nothing queued (…/pending-system-change.md does not exist)` says.

**The rule this makes explicit — a component that reports on others needs a test
that exercises it, not only checks that construct it.** 0.1.12's escalation
channel shipped with no behavioural self-test. It was not untested in the loose
sense: `check-command-refs.mjs` asserted every command it names resolves, the
risk guard's authority cases covered who may call `--apply` and `--clear`, and
`check-schemas.mjs` covered the records it writes. Every one of those checks
asks *is this thing built correctly?* Not one of them asks *does it answer
correctly?* — and the first real run found it reporting **zero findings in a
file holding two**, and a queue reader that could not see the one file actually
queued. Both defects were fully present, and fully invisible, behind a green
build.

The distinction is the whole rule. A check that constructs a component proves it
exists and is well-formed; only a test that runs it against known input and
compares the answer can catch a component that is well-formed and wrong. That
gap is widest exactly where it matters most — in a component whose output is *a
report about other components*, because its answer is what everyone else reads
instead of looking. A miscounting reporter does not fail; it reassures. **That
is why `check-retro.mjs` exists**, and why it is behavioural throughout: it
files findings and reads the count back, enumerates a queue with a file in it,
and asserts what doctor NAMES rather than that doctor WARNs.

It applies forward without amendment. `guardian` and `/release` are both
reporters, both unbuilt, and neither ships on construction checks alone. This is
the same shape as the gate's — *the gate can report a violation and cannot
report itself* — one level out: a reporter's own correctness is the one thing
its own reports never cover.

### 0.1.14 — the only door was narrower than the one behind it

**Cut 2026-09-01.** Found by reading the release pipeline immediately after
0.1.13's own green run, not by anything failing. `check-pretag.mjs` carried a
hardcoded array of checks under a comment claiming it was *"everything
release.yml would run"*. It ran **13 of release.yml's 17**. Absent:
`redact.mjs --selftest`, `check-retro.mjs`, `check-escape-hatch.mjs` and
`check-command-invocation.mjs`. Only `check-tags.mjs` had its absence explained;
the other four read as decisions and were omissions, **and those two are
indistinguishable when an exclusion is expressed by not appearing in a list.**

`check-retro.mjs` is how it happened: added to `release.yml` in 0.1.13 and to
that array never. Two lists, one edit. **A gate that admits what the next gate
rejects is not a gate** — it is a slower way of finding out. This one is the
door that `check-pretag`'s own header calls *the only door*, and it was narrower
than the one behind it. Nothing was shipped broken by it, which is the only
reason this is a finding rather than an incident: every missing check was
passing anyway. That is luck, not a control.

**1 — the suite is derived, not listed.** `deriveReleaseSuite()` reads
`release.yml` and the suite IS what `release.yml` runs. Adding a check to the
workflow adds it to the gate with no second edit. Same move as
`findingHeading()` and `FINDING_RE` sharing their pieces in 0.1.13: writer and
reader change together or neither does. Deriving was possible, so the fallback
the operator authorised — a check that fails when the two lists differ — was not
needed and not built; a check comparing two lists still leaves two lists.

**2 — and the half that makes drift impossible rather than merely unlikely.** A
step the gate can neither run nor name is a **failure**, not a skip. So
`release.yml` cannot grow a step this gate silently ignores: either it is a
`node <script>.mjs` check, and is run automatically, or it goes in
`EXCLUDED_STEPS` with a reason. The four exclusions are declared with their
reasons and **printed on every pass** — a gate that does not name what it did
not check is asserting more than it verified. Each is asserted to still name a
real step, so a renamed step fails here rather than leaving a stale exemption
that quietly excuses its replacement.

**3 — the gate had no behavioural test at all, which is why it could drift.**
This is 0.1.13's rule applied to the component that most needed it: a reporter
tested only by construction. `--selftest`, nine assertions, wired into both
workflows. Four negative controls, each failing independently: a derivation
blind to block-form `run: |` fails five assertions and names all 17 orphans; a
renamed exclusion fails exactly one; an undeclared shell step fails exactly one;
a workflow naming a script that does not exist fails exactly one.

**The self-test's own first gap is the more useful record.** Assertion 4 tested
the undeclared arm against a *fixture* only, so adding a shell step to the real
`release.yml` changed nothing — the control fired zero failures. That is the
blind spot this whole release is about, reproduced one level down inside the
test written to prevent it, and it was visible only because the control was run
rather than assumed. Assertion 3b tests the real file, and the control then
fires.

**4 — `check-pretag` executed its entire gate on import.** It had no main guard
in any form, so its self-test could not exist: importing it ran it. 0.1.13 fixed
five `endsWith` guards in `plugins/mavci-core/scripts/`; this file is in
`scripts/ci/` and had no guard to fix. **A suffix test standing in for an
identity test and no test at all are the same defect at different depths**, and
the second is why this gate went untested for its whole life.

**5 — a check must not annotate its own green run.** Carried-forward item 3,
closed. `execFileSync` forwards a child's stderr to the parent unless `stdio`
says otherwise; `check-packaging`'s section 3 fails `render.mjs` **on purpose**,
and `render.mjs` reports failures with `::error::`. So the deliberate ENOENT
travelled into the runner log and GitHub rendered it as a red ✗ on a release job
exiting 0 — on every release run from v0.1.9 to v0.1.13. Reproduced locally,
byte-for-byte against run 33505830491, and removed by one pinned `stdio`.

Fixed as a class, not an instance: **nine call sites across seven CI scripts**
forwarded child stderr, and a new rule in `check-plugin.mjs` fails any
`exec*Sync` in `scripts/ci/` that does not pin `stdio`. Verified safe before
changing anything — every one of those catch blocks already reads `err.stdout` /
`err.stderr`, so capturing silences no diagnostic. `check-escape-hatch:108` is
left inheriting deliberately: it is reporting a real failure.

The rule scans **blanked** source via the repo's own `jsscan`, and an
unreadable call is a failure rather than an unexamined pass. Zero false
positives across all 19 CI scripts on its first run — which, after 0.1.12's
five-false-positives-per-true-one, was the thing to check before trusting it.

**A red mark on a green run is not cosmetic.** It trains precisely the habit
that let run 33265540461 — a real failure — go unread for an entire release.
That is the argument for spending a release on it.

### 0.1.17 — the identity that will push, checked at the moment it matters

**Cut 2026-09-01.** Fourth occurrence in one day of `Repository not found`
against the system repo, and the first one worth a finding — because **the check
existed and did not help.**

`checkGhAccount` has compared the active `gh` account against `SYSTEM_REPO`'s
owner since 0.1.13, and it is correct. It fires when someone runs `doctor`. The
damage happens at `git push`, which consults no doctor. *A control placed where
it is convenient to compute rather than where the loss occurs is not a control;
it is a coincidence that sometimes fires first.*

**And `check-pretag` was not merely silent about the account — it had the answer
and misread it.** `git ls-remote origin` is a live authorisation probe made with
the exact credential that is about to push, which is strictly better evidence
than a login comparison because it tests the thing rather than a proxy for it.
The gate called it twice and, when it failed, said *"could not reach origin …
Check the network and re-run"*: this file's own copy of the misleading message
doctor was fixed for, one layer further down, at the moment the operator is least
inclined to doubt it. The second consumer — `HEAD` vs `origin/main` — downgraded
the same failure to a **note**, which does not block. A gate whose own header
argues that a check nobody is required to read is a failure one layer up, and
which then names the wrong cause.

**Reachability is the ground truth; the account comparison explains its
silence.** One `ls-remote`, read twice. Origin answers ⇒ pass whatever `gh`
reports, as a note, never a failure — git's credential helper need not be gh, and
a release gate is the most expensive place in this system to refuse wrongly
(0.1.12 item 5: a guard that fires wrongly and often trains everyone to turn it
off). Origin is silent ⇒ refuse, name **which** of the two causes it is, and
stop **before the suite**, saying what was skipped: every arm below would
volunteer its own confident wrong explanation for the one cause already named.
Offline checks — dirty tree, branch — run first, so a machine that cannot reach
origin is still told what is wrong with its tree.

**Imported, not reimplemented.** `readGhAccounts` and `ghAccountFinding` are
doctor's and check-pretag renders them; doctor's caveat narrowed in the same
commit, because *"doctor compares logins … the only thing checkable without a
network call"* was true only of doctor. Two gates that disagree about one machine
is this system's oldest defect shape.

**Nine assertions, five negative controls, each failing exactly one.** The
summary line is now counted rather than written down — a hardcoded total is a
second list of the same thing. The end-to-end assertion is that the gate
**STOPPED**, not merely that it failed, which needed a marker for the line the
run must never reach: a build whose identity arm does not stop the run reaches
the suite, which runs `check-pretag.mjs --selftest`, which spawns the gate again,
so without `MAVCI_PRETAG_NO_SUITE` the negative control would have been a fork
bomb rather than a failed assertion. That variable can only **add** a refusal;
no value of it lets a tag be cut.

**Not covered, and said out loud:** the gate proves the credential can READ the
repository, never that it can write. A read-only token — `MAVCI_TOKEN` is
exactly that shape — passes this and fails the push, with the tag still local and
recoverable. Full record: `docs/lessons/0.1.17-identity-at-the-moment-of-the-push.md`.

**Note on this log:** 0.1.15 and 0.1.16 have no entry here. They are in the
commit log and in `docs/lessons/`, and the gap is named rather than stepped over,
because a release log that skips two releases silently reads as two releases in
which nothing happened. Both now have entries — that is what the state summary
rewrite at the top of this section was for.

**They have no TAG, and as of 2026-09-02 that is PERMANENT rather than pending.**
`618069b` set the condition: `release-check.mjs` refuses on an absent guardian
record, and *the version exists to give the working-tree install a distinct
identity, not to claim a release. The tag comes after the corpus passes.*

**The corpus has now passed — twice, at 0.1.19 and at 0.1.20 — and it does not
discharge that condition for these two versions.** It cannot, and the reason is
not a technicality about ordering:

- **There was no corpus at 0.1.15 or 0.1.16.** `corpus-stage.mjs` and
  `corpus-score.mjs` first appear at `2ed0e80` (0.1.18). The case library the
  passing runs were graded against did not exist when either version was built,
  so there is no run of it that either version could ever have had.
- **What passed is a different agent.** At `7397629` guardian is told to read
  `.mavci/project.json` and `.mavci/control/state.json` at startup and to work
  from the manifest and the phase. The worklist-file protocol — *the worklist is
  the complete statement of what you were asked*, the single `.mavci/` read, the
  hook-bounded read scope — arrived afterwards. The corpus graded THAT agent. It
  is not the one 0.1.15 and 0.1.16 shipped.
- **The agent they shipped is the one findings 14 and 20 describe as defective**:
  ordered to invoke a skill with no tool that can invoke one, and ordered to make
  two reads its own scope refuses. A tag on those commits would claim a release
  point for it, on the strength of a measurement taken on its replacement.

So the condition is met chronologically and unmet substantively, and the
substantive half is the one that decides. Neither version can be covered
retroactively by a corpus run: coverage runs forward from the library and the
agent that were current when it ran. **v0.1.15 and v0.1.16 will not be cut.**
They stay as they are — versions in the log and in `docs/lessons/`, with no tag,
permanently.

This paragraph replaces "owed after the corpus run" rather than satisfying it. A
pending condition that can never be met should stop being described as pending:
left standing, it reads as work queued, and every later reader spends the same
hour rediscovering that the thing it waits for cannot arrive.

Checked on 2026-09-02, because the reason offered for back-tagging them was that
`check-tags` would keep failing until they existed. **It would not.** Its only
failing arm is *the newest tag reachable from main IS main* — nothing in it asks
whether every version in the log was ever tagged — and `v0.1.17` alone satisfies
it, verified by cutting `v0.1.17` with both absent and watching `check-tags`
accept it. The premise was the whole argument, and it was checkable in one run.

What back-tagging would change is not in this repository at all.
`plugins/mavci-core/templates/mavci-verify.yml` clones
`v<state.json.plugin_version>`, so a project whose control plane records 0.1.15
fails loudly at checkout today and would silently succeed afterwards, on a
version this repository declined to release, with guardian's answers still
unmeasured. That is carried-forward items 1 and 2 arriving through a third door:
a forward-looking version value steering a project's CI at a rule set nobody
chose. That argument did not expire when the corpus passed — it is the reason the
decision above is permanent rather than deferred. **The loud checkout failure is
the correct behaviour and stays.** A project whose control plane records 0.1.15
or 0.1.16 is pinned at a version this repository declined to release; failing at
checkout tells it so, and a tag would replace that with a silent success. The fix
for such a project is `/mavci-core:doctor --sync`, not a tag here.

**Not the reason, and recorded so it is not mistaken for one.** `release-check.mjs`
also refuses in this project today, but for an unrelated defect: it reads the
newest file in `.mavci/control/guardian/records/`, the corpus writes its records
into that same directory, and the corpus's last case is an expected-`fail`
control — so a PASSING corpus leaves a failing record as the gate's input. Filed
as finding 25 in the retro queue. It is a real defect and it is not what settles
the tags: the argument above holds whatever that gate returns, and fixing the
gate would not make a 0.1.20 corpus run into evidence about a 0.1.16 agent.

### 0.1.18 — the corpus becomes measurable, and the clone stops being invisible

**Cut 2026-09-02.** Three things, in the order they were found rather than the
order they were built.

**1 — the corpus can be staged, run blind, and scored by a program.** Guardian's
answers have been the largest unproven claim in this system since Phase 2
shipped, and the reason was never that nobody ran the corpus: it was that a
corpus run's *result* was a model reading two JSON files and reporting agreement.
The least-scrutinised step in the run produced the only evidence guardian's
correctness has.

`corpus-stage.mjs` (`--case`, `--list`, `--clear`) copies exactly one case into a
project's `corpus-run/`, stripping the `.txt` suffix, refusing any write that
escapes the stage and refusing a case with no expectation; there is no partial
stage. `corpus-score.mjs` compares three fields only — `record.verdict`,
`record.fail_reason`, and per-site `origin` — and exits 0/1/2 for pass / case
failed / **could not score**. That third exit is the point: an ambiguous join, an
id mismatch or a `sites_total` disagreement is `CannotScore`, never a pass.

The cases were renamed to opaque ids (`m8f2r`, `q3v7k`, `t5w9d`) because the old
names — `00-degenerate-pass`, `01-chatbot-cross-tenant` — **stated their own
expected answer**, and those paths went to guardian in the worklist. A green
result against a case called `degenerate-pass` proves nothing about guardian and
everything about the label. Run order moved into `run_order` in the expectation,
because an opaque id cannot carry ordering. Expectations moved out of the project
entirely after a recorded 0.1.17 incident in which guardian grepped `scopeId` and
hit `corpus/expected/t5w9d.json` on the line carrying the expected origin.

**2 — guardian's read grant is scoped, and the paragraph saying it wasn't is
gone.** `read_scope` is declared in `agent-defs/guardian.json`, rendered into
`agents/agent-scopes.json`, and enforced by `risk-guard.mjs` on `PreToolUse` for
`Read`, `Grep` and `Glob`. A search whose ROOT contains a denied subtree is
**refused, not silently narrowed** — a scope decision disguised as an empty
result is the same fail-quiet shape as a gate that exits 0. Unscoped agents and
the main session are unaffected, and an unreadable scopes file refuses rather
than falling open.

`templates/corpus/README.md` still carried *"What is still open: guardian's Read
grant is the whole project tree. Nothing above narrows it"* — written before the
scope landed and left standing **in the same commit that closed it.** Corrected,
and the replacement states the residual narrowly: the scope is enforced by a
hook, and hooks fail open on timeout and crash (4.17/4.18), so it is a strong
control against an agent following instructions and a weak one against a runtime
fault. `check-read-scope.mjs`'s header enumerated N1-N10 while the file
implemented an unlisted N11; documented.

**3 — the release gate was narrower than the workflow behind it, again.** Found
while verifying the recovered work, not by anything failing. The four new checks
— `check-corpus-score`, `check-corpus-isolation`, `check-corpus-blind` and
`check-read-scope` — were added to `selftest.yml` and to `release.yml` **never**.
This gate derives its suite from `release.yml` alone, so all four were checks no
release gate had ever executed, and they looked covered because CI is green on
every push.

That is 0.1.14's finding through a third door. 0.1.14 fixed *check-pretag vs
release.yml* by deriving one from the other; it never occurred to that fix that
`selftest.yml` is a **second list of the same kind**, and the derivation made the
gate exactly as wide as `release.yml` and not one check wider. Every prior check
in `selftest.yml` — all eight — is also in `release.yml`, so "selftest is a
subset of release" was an invariant held by every file in the repository and
written down nowhere.

`selftestCoverage()` now asserts it, `SELFTEST_ONLY` is the declared escape valve
with a reason, and stale keys in it are a failure. The two recognisers became one
shared `NODE_STEP_RE` rather than a second copy of the same pattern.
**Confirmed failing first**, naming all four, while every other assertion in the
file stayed green — which is the whole reason the arm is trustworthy: the suite
was being derived perfectly, from a file that did not mention them.

**4 — `doctor` FAILs when the marketplace clone has uncommitted changes.** The
most dangerous near-miss so far, and the first finding about **a place the system
does not look at all.** 43 files and 2510 insertions of this release sat
uncommitted in `~/.claude/plugins/marketplaces/mavci` — a directory whose whole
contract is that propagation overwrites it with `git checkout -B main
origin/main`, which discards a dirty tree with no prompt, no error, and no reflog
entry for content never committed. The work survived because the next fetch had
not run. Twenty-seven minutes.

Every failure before this one left a trace someone could eventually read. This
one leaves none, and its first symptom is the worst signal the system has to
give: **CI passing on a version that does not contain the fix** — the tag cut,
the suite derived, every check green, because the checks are real and the code is
simply absent.

`doctor` has read the clone's *version* since 0.1.5. It walked past the working
tree every time — the evidence in hand, the question never asked, the same shape
as `check-pretag` calling `git ls-remote` twice and misreading the answer. It now
names the clone, the files, the command that will destroy them, and the recovery.
FAIL, not WARN: a dirty clone is always either work about to be lost or a
consumer someone hand-edited, and both need a person. Asserted in **both**
directions, because a control that fires on a clean clone gets turned off.

**The recovery is recorded because it is not obvious.** `git apply` on a
PowerShell-produced patch failed on every hunk — the redirection re-encodes the
bytes, and the diff contained renames, which a patch round-trip flattens. What
worked with no transformation was clone to repo `fetch` plus `cherry-pick`. **Git
to git, never through a file.** A clone is already a git remote. Verified by tree
hash rather than by diffstat: source and cherry-pick both resolve to
`30b0101f...` on parent `6af89de`, which is the only form of that proof that
asserts anything about content.

Full record: `docs/lessons/0.1.18-the-clone-is-generated-state.md`.

**Not built, deliberately.** The stronger prevention — a hook refusing edits
under `~/.claude/plugins/` when the source repo exists on this machine — is
filed, not guessed at. It would run on every write on the machine, `hooks.json`
is the surface that shipped **zero hooks** in v0.1.2 silently, and "refuse edits
here" is not yet a decidable predicate while `git rm` inside the clone is a
legitimate operation. Also not built: nothing automates a corpus RUN. Staging,
dispatch and scoring are three operator steps with deterministic tooling behind
each, so **guardian's answers remain unmeasured** and `doctor` still FAILs every
project until a corpus result exists. This release makes that measurement
possible; it does not perform it, and the tag it earns is still owed to 0.1.15
and 0.1.16 first.

### 0.1.21 — the record says what it is about, and the contract stops ordering the impossible

**Cut 2026-09-02.** Six findings, and two of them were only visible because
fixing another one required mutating a suite nobody suspected.

#### THE PROPAGATION WINDOW — READ THIS BEFORE PROPAGATING

**This release changes what the writer produces AND what the shared contract
orders, so the window cuts in both directions.** Propagation replaces the plugin
on disk; a session already running keeps the hooks it registered at
`SessionStart`. For the rest of that session the hooks are one version behind
the writers the operator invokes by path — and that is exactly when the work
following a propagation happens. It is not a race. It lasts until the next
session start.

- **Old checker, new record.** A guardian record written by 0.1.21's writer
  carries `source` and `suggested_next`. 0.1.20's `guardian.schema.json` sets
  `additionalProperties: false`, so to hooks still registered from 0.1.20 those
  are not unknown fields, they are violations. This is finding 24's exact case,
  one release later, and the reason `state.schema_valid` now says RESTART THE
  SESSION instead of `--reseal`.
- **New checker, old record.** Every guardian record written before 0.1.21 has
  no `source`. 0.1.21's schema still accepts them — the field is deliberately
  optional — so they stay schema-valid, but `release-check.mjs` refuses them as
  `guardian_record_undeclared`, because a record that never declared what it was
  about is not project evidence. **That is not a malfunction and must not be
  cleared by hand-editing a record.** It clears when guardian next runs.

**So: restart the session after propagating, before writing any control file.**
Everything below assumes that.

#### 1. Finding 25 — one directory, two purposes

`.mavci/control/guardian/records/` held evidence about the PROJECT and evidence
about GUARDIAN ITSELF, written by the same writer, validated by the same schema,
with nothing saying which was which. `release-check.mjs` read "the newest
record". The corpus's last case, `t5w9d`, is the unknown control and its expected
verdict is `fail`. **So a corpus that PASSED left a failing record as the release
gate's input, and passing the corpus was the act that closed the gate.**

Neither side was wrong alone, which is why it survived three releases. Taking the
newest file was the only thing a reader could do given records with no
provenance; running the corpus through the real writer is deliberate, because a
corpus that wrote through another path would not be grading the writer that
ships. The defect was the shared namespace and it was invisible from inside
either component.

**The marker is in the document, not in a second directory.** Moving corpus
records elsewhere would create a path the schema sweep, the absolute-path sweep
and the integrity seal each have to be told about independently — three sets
where every reader assumes one, which is finding 23's shape. One directory, one
schema, one seal.

`source` is derived at `openTicket` from whether a case is staged, never passed
as an argument a dispatcher could forget, and the `SubagentStop` writer copies it
without re-deriving — one derivation per run, no way for two to disagree. A
ticket written before 0.1.21 yields `source: null`, never a defaulted `'real'`.

**`source` is optional in the schema and required by the reader, and that is
tighter, not looser.** A schema `required` entry under `additionalProperties:
false` invalidates every record written before it — the window above, in the
direction that breaks the live tree — and it would only bind records that already
carry the field. At the reader, absent, `null` and any unrecognised value all
refuse, so an enum that grows cannot promote its new value to project evidence.
The reasoning is written beside the field in `guardian.schema.json`, because the
next reader to notice the inconsistency will want to "fix" it.

Selection moved out of `release-check.mjs` into a pure `selectProjectRecord()`.
It had lived in the CLI where no test could reach it, **which is where finding 25
sat for three releases.**

#### 2. Finding 26 — 31 assertions, green since 0.1.15, structurally unable to fail

**`check-guardian.mjs` had its only failure gate at line 176 of 429.** Everything
below it — the entire `SubagentStop` writer suite (design 4.3, "the three ways it
manufactures a pass"), the two prose constraints on the skill text, the hot-path
ordering check — pushed into a `failures` array nothing read again. They printed
`FAIL` and the process exited 0.

**This is the largest single instance of the shape CLAUDE.md lists eight of, and
it is the limit case.** The others were probes testing the half that worked. This
was a probe whose result was never read at all. The assertions were correct;
every one would have caught a real defect; the harness discarded them.

It was found by mutation, not by reading — removing the record's `source` field
made seven writer assertions print FAIL while the suite still exited 0. The
mutation was run only to satisfy the house rule that an assertion be demonstrated
failing before it counts. **That rule, applied mechanically to a suite nobody
suspected, is the only reason this was found.**

**Second untrue green from this file.** The first was the containment overclaim:
the Bash assertion's message read "fully natively contained" after guardian's
reads had become hook-enforced, so a green check made a false claim. Both times
the file was right about guardian and wrong about itself. A note to that effect
now sits at the top of it, because a file that has produced two of these has
earned one.

`check-ci-gates.mjs` generalises it: every assertion in every check script must
sit ahead of a gate that can fail. A structural probe over all 30 scripts found
this one file only — measured, not assumed. **It states what it cannot see:** it
proves an assertion CAN fail, never that it discriminates. An assertion passing
for the wrong reason is still invisible to it. Mutation is the only thing that
covers that, it is manual, and there is no static substitute.

#### 3. Findings 19 and 20 — two defects concealing each other

**This is a class we had not named.** Finding 19 alone looked like a formatting
problem: `guardian-record.mjs` sliced `evidence` to 500 characters silently, so
records ended mid-word. Half the evidence fields in the 0.1.18 corpus run were
truncated, one mid-path at `corpus-run/ap`, with nothing saying so.

It was not losing detail. **It was deleting the only channel by which an agent
reports a contract it cannot satisfy.** `suggested_next` was dropped by the
writer entirely, and `suggested_next` is where the shared agent contract tells
every agent to report a blocked or out-of-scope condition and stop. Guardian used
it twice during that run to say it could not invoke the skill its own startup
protocol ordered. Both disclosures went nowhere.

So finding 20 — **the contract has ordered an impossible step since the contract
existed** — stayed invisible, because the component being broken reported the
break, twice, into a field the writer discarded. Fixing 19 is what made 20
findable. Neither is severe alone; together they form a channel that reports
faults into a hole, and a fault that is only reported through that channel does
not exist as far as the system is concerned.

**Finding 20's expansion is the finding, not the fix.** It was filed against
guardian because that is where it was observed. `check-agent-contract.mjs`, run
against the pre-fix tree, found the same contradiction in **four more agents** —
architect, builder, scribe and verifier, none of which held a tool that could
invoke a skill either. Five of five. Guardian was not the exception; it was the
one that said so.

The fix is four different actions, which "fix the contradiction" hides:

| Agent | Action | Why |
|---|---|---|
| guardian | drop the instruction | containment is load-bearing; its standard is one question already inlined in its role |
| architect, builder, verifier | **grant `Skill`** | loading the packs is what the architecture says they do — the instruction was right and the grant was missing |
| scribe | neither | declares no packs; `build-agents` no longer renders an order for an empty list |

**THIS IS A GRANT WIDENING ON THREE AGENTS, AND HERE IS WHY IT IS NOT A
LOOSENING.** An audit seeing three agents gain a tool in one release should find
the reasoning next to it rather than reconstruct it. The check
(`check-agent-contract.mjs`) was written strict and stayed strict; what changed
was the subject, so that it complies. The alternative — narrowing the check to
stop noticing — was available and is the move this repository exists to refuse.
The three that gained `Skill` already hold `Bash`, `Write` and `Edit`, which
dwarf it; every skill they can reach is prose or a read-only report; and the
privileged operations are `state.mjs` flags, gated by risk-guard on `Bash` by
caller, which no skill exposes. Guardian, the one agent whose containment the
corpus depends on, gained nothing.

Also fixed in 20: the contract's section 8 ordered a read of
`.mavci/control/tasks/<id>.json`, which guardian's `read_scope` denies and
risk-guard enforces — a refusal on its first instruction after the report format.
Guardian has no retry semantics at all, and its section 8 now says so.

#### 4. Finding 24 — a remedy that fits the failure

`state.schema_valid` printed one remedy for everything: "it needs `state.mjs
--reseal`". It fired on a file the sanctioned writer had produced minutes
earlier, rejected by a schema one version older than the writer. The file was not
hand-edited, and **resealing recomputes a hash — it has no bearing on schema
validity**, so an operator who ran it would have spent a privileged action and
arrived back at the same block. A remedy that cannot work is worse than no
remedy: it costs an action and teaches the reader the message is unreliable.

Three failures, three remedies. Seal → `--reseal`, the one failure it answers.
Schema under version skew → **RESTART THE SESSION**, naming both versions. Schema
with no skew → `--validate`, and file a retro if a Mavci writer produced the
file. `--reseal` appears in exactly one of the three.

The skew remedy carries an AUTHORITY marker, and that was `check-evidence-caps`
Part 2 catching a real error rather than a formality: **an agent cannot restart
its own session.** Without the marker it was finding 16's shape — an instruction
addressed to the one party who cannot carry it out.

Both new remedies came in over the 300-character cap on the first attempt (302
and 345). The explanation was cut and the action kept first, which is finding
13's lesson applied to the writing of its own fix. And because these remedies are
built per-finding rather than stored on the rule, **Part 1's static-string cap
cannot see them at all** — the cap is re-asserted on `remedyFor`'s output, or
finding 2 walks straight back in through a dynamic door.

#### Verification

Every fix in this release was demonstrated failing before it was written.

| Mutation | Restores | Assertions that go red |
|---|---|---|
| M7 | 0.1.20's release-gate reader | 9, incl. a corpus fixture read as `guardian_failed` — finding 25 reproduced |
| M8 | 0.1.20's record writer (no `source`) | 7 — **and exposed finding 26: exit status 0** |
| M9 | the silent `slice(0, 500)` | 6 — while `evidence.length === 500` stayed **green**, the adjacent assertion finding 19 named |
| M10 | one `--reseal` remedy for every failure | 6 |

M9's green control is kept in the suite, labelled as a control, so nobody
mistakes it for coverage.

**28 CI checks, two of them new, both of which found their instance on the first
run they were given:** `check-ci-gates.mjs` (31 dead assertions in
`check-guardian.mjs`) and `check-agent-contract.mjs` (four agents beyond the one
the finding named).


### 0.1.22 — the check answered a question about the operator's shell

**Cut 2026-09-02.** The release gate refused `v0.1.22` and the refusal is the
entry: `check-command-invocation.mjs` reported both of its controls down at once,
and its own message says what that means — *this check cannot detect the defect it
exists for, so nothing it reports means anything.* Twenty-eight green checks had
just passed. This one caught it because it is the only check that RUNS anything.

**The three questions, answered in order, because two of them were dead ends and
the order is what made the third cheap.**

**1. 0.1.22 did not break it.** `check-command-invocation.mjs` is byte-identical
between `6b7c081` and `8316792` — 0.1.22 touched `state.mjs`, `doctor.mjs`,
`risk-guard.mjs`, the plan skill and a new `check-state-transition.mjs`, and
nothing the check reads. Confirmed positively rather than by diff alone: a
worktree at `6b7c081` reproduces the **identical six failures**. It was already
broken, and the suite had passed before the branch because it had been run from a
different shell.

**2. The scaffold did not regress, and `verify: exited 1` was not what it said.**
That line reads as a freshly scaffolded project failing its own checker, which
would have made the two control failures downstream and the diagnosis a different
one entirely. A probe that re-ran both controls after **every one of the 22
blocks** showed `state.mjs --show` and `verify.mjs --format=human` exiting 0
throughout, with no block mutating the shared temp project. `verify.mjs` never
ran. Nothing in the project was wrong.

**3. So the controls did not break independently — and they did not break at
all.** One cause, and it was the harness: *the check had stopped exercising the
thing rather than the thing changing.*

**The cause.** The check spawned a bare `bash` and trusted PATH. Which binary
that is depends on **which shell launched the check**. From Git Bash it is Git
Bash and everything the check reports is real. From PowerShell — the operator's
primary shell — `bash` resolves to
`%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`, the WSL app-execution alias,
which on a machine with no distribution installed prints an error and **exits 1
without running the command**. Same tree, same commit, two different verdicts.

**The severity is not that the gate failed. It is what the gate said on the way
down.** Of the 22 blocks, only 4 objected — the ones matched by `MUST_EXIT_ZERO`,
which noticed a non-zero exit. The other **18 were scored `ok` while executing
nothing**, and the run printed `invoked 22 inline block(s) across 13 skill(s)`,
which was false. The reason is `neverRan()`: it answers *did this command run?*
by matching a list of **English** error strings. The WSL stub answered in Turkish,
in UTF-16LE. Nothing matched, so a command that never started was scored as one
that started and behaved.

**That list fails open, and a longer list in more languages is the same
assertion with more ways to be almost right.** The fix is not lexical. It is to
prove the interpreter executes AT ALL before trusting any per-block verdict from
it — invariant 5 (*a failed probe is never reported as a pass*) applied to the
harness rather than to the thing under test.

**The controls ran last, and that was the second half of it.** They are the right
probes and they did fire; the process exited 2 and no tag was cut, so the gate
held. But they ran as a postscript, underneath a summary line that had already
claimed 22 successful invocations, and neither of them named the interpreter —
which was the entire cause and the only fact that would have shortened the
diagnosis. **A control that can invalidate every line above it belongs above
them.**

**What shipped.**

- `resolveBash()`: `MAVCI_BASH` if pinned, else Git Bash at its known locations on
  win32, else PATH. The WindowsApps alias is never a candidate — it is a launcher
  for a different operating system, not a shell. The interpreter is **named on
  every run, pass or fail**, because a check that does not say which interpreter
  it used is asserting more than it verified.
- A **preflight** ahead of the loop: an `echo` round-trip, then both controls. On
  failure the check refuses having invoked nothing and says so — `no block was
  invoked, and no claim is made about any` — instead of reporting 22 invocations
  that did not happen.
- `legible()`, which strips the NULs out of a UTF-16LE answer read as utf8. The
  difference between a diagnosable failure and a wall of mojibake.
- The header now carries the whole of this, next to the paragraph enumerating
  what a green run does **not** prove, which this is now one of.

**Verified in both directions, and the negative controls are independent.**
Pinning the WSL stub yields **one** failure naming the interpreter, the probe, its
answer and the fix; pinning a path that does not exist yields the same arm with
different evidence (`exit -1`, `(nothing)`). Under Git Bash and under PowerShell
the check now returns the **same verdict**, which is the property that was missing.

**Also fixed: the gate truncated its own evidence, and kept the wrong half.**
`check-pretag` reproduced `err.stdout` and discarded `err.stderr` — but every
check in the suite writes its running commentary to stdout and its
**authoritative failure list to stderr**. It then kept the last **4** lines. So a
six-failure run was read as a three-failure one, and the three dropped were the
ones naming `build`, `plan` and `verify`, which is what made the surviving
`verify: exited 1` look like a scaffold regression. Now: stderr preferred, 40
lines, and **the number of dropped lines is printed**. A gate that truncates its
own evidence must say that it did, or the reader diagnoses the part that survived.

**One thing deliberately not done.** `check-plugin.mjs`'s stdio rule fired on a
new **doc comment** that quoted a call: `blankSource` is documented "not a
parser", read the backticked prose as code, and reported *calls exec\*Sync without
pinning stdio* about a line that calls nothing. The rule was right to fail closed
and the prose was reworded. **Narrowing a checker to stop noticing is the move
this repository exists to refuse** — but the message names a cause it has not
established, which is finding 5's shape from 0.1.12, and it is worth a retro when
someone is in that file for another reason.

#### The tags — v0.1.21 joins v0.1.15 and v0.1.16, for a DIFFERENT reason

**v0.1.21 was never tagged, and once `v0.1.22` is cut it never will be.**
`check-tags.mjs` has exactly three failing arms — mixed lightweight/annotated
forms at or above v0.1.7, no tag reachable from the mainline, and the mainline
ahead of the newest tag. Verified by reading them, not assumed. **Not one of them
asks whether every version in this log was ever tagged.** `v0.1.22` at main's tip
satisfies all three, and 0.1.21 stays untagged with nothing objecting, exactly as
0.1.15 and 0.1.16 do.

**The reason is not the same reason, and conflating them would invent a principle
that does not exist.** v0.1.15 and v0.1.16 are untagged **on principle**: the
corpus that would have graded them did not exist when they were built, what
passed later was a different agent, and a tag would claim a release point for an
agent findings 14 and 20 describe as defective. That decision was argued and is
permanent because the argument cannot expire.

v0.1.21 is untagged **by sequencing**. It was cut, committed, and superseded by
0.1.22 before a tag was pushed. Nothing was withheld and nothing was judged. It is
an accident of ordering that the tag arm is structurally unable to notice, and it
is recorded here for the same reason the 0.1.15/0.1.16 note was: **a version in
the log with no tag reads, to the next person, as a version whose tag is owed.**
It is not owed. There is no work queued behind this paragraph.

**What this costs, and it is the same cost as before.**
`plugins/mavci-core/templates/mavci-verify.yml` clones
`v<state.json.plugin_version>`, so a project whose control plane records 0.1.21
fails loudly at checkout. **That is correct behaviour and stays.** The fix for
such a project is `/mavci-core:doctor --sync`, not a tag here.

### 0.1.23 — the chain had no middle, and two of its five agents had never run

**Cut 2026-09-03.** The brief was one top-level prompt driving five agents end to
end. What the inventory found is that the chain was **three of its four edges and
none of its counters**, and that two agents had shipped, installed, and never run.

#### 1. Two agents were unreachable, and being unreachable is what hid it

`mavci-verifier` was named by **no skill in the plugin**. `/mavci-core:verify` did
the verifier's work inline — checker, type check, build, tests, criteria, phase
move — in the main session. The agent appeared in `/context` on every machine and
had never once been invoked.

`mavci-scribe` had **no skill at all**, and could not have started if it had. Its
def declares `phase: "any"`, meaning *not phase-scoped*; the shared contract
rendered that into "If `phase` is not `any`, **stop**" against a closed enum of
`plan|build|verify|release`. It would have reported `wrong_phase` on every
possible invocation since it shipped.

**Neither was observable.** An agent nothing dispatches cannot be seen failing,
and an unrun component is indistinguishable from a working one — this file has
said so for four releases, and here are the two components it was true of.

**It is also the defect 0.1.21 fixed one step lower, in the same agent.**
`NO_STANDARDS_STEP_3` exists because step 3 ordered an agent with no packs to
invoke an empty list. Step 2, directly above it, was telling that same agent to
wait for a phase that cannot occur. Fixing the instance and not the class is what
let the fix walk past it. `check-agent-contract.mjs` gained rule 3 — a phase gate
must name a value in `PHASES` — and it found a second case nobody predicted:
guardian renders **no** gate at all. That one is deliberate (the check moved to
its dispatcher) and is now a **declared** `phase_gate` asserted against the skill
that carries it, rather than an exemption expressed by absence, which 0.1.14
established is indistinguishable from a block that was lost.

#### 2. The rework loop was not unautomated. It had no entrance.

`/mavci-core:verify` on a failure said "stop — do not fix it here" and set no
phase. The builder refuses unless the phase is `build`. A failed verify leaves it
at `verify`. So the loop `max_attempts: 3` bounds could only be entered by a
privileged `--set-phase build` that nothing instructed anyone to run.

Underneath it, the machinery was modelled and inert. `incrementAttempt` and
`blockTask` were exported from `state.mjs` and called from **nowhere**: no task's
`status` ever left `pending`, `owner_agent` was never set, `attempts` was always
0. And `recordVerdict` has always named a verdict `<id>-attempt-NN.json` and
appended it to `verdicts[]` **when given a `task_id`** — which nothing ever gave
it. `evaluate` and `buildVerdict` accepted `task_id` and `attempt`, defaulted both
to null, and `verify.mjs` had no flag to pass. The branch existed, was correct,
and had never once been taken.

`AI-Chatbot-Widget-SaaS`: **24 verdicts, every one `adhoc-<epoch>.json`, and
`control/tasks/0001.verdicts[]` empty.** An audit trail written correctly,
schema-validated and sealed, recording nothing about anything.

**The two concealed each other.** No attempt counter moving means no attempt
number for a verdict to name; no attribution means nobody reads `verdicts[]` and
notices that it is always empty.

#### 3. The router — the decision, not a framework

ROADMAP forbids an orchestration framework, a message bus and an agent registry.
Nothing here breaches that: native delegation already dispatches, the main session
already is the orchestrator, `SubagentStop` already fires. What was missing was
**the decision of what to dispatch next**, and it was living in prose, recalled by
a model, across five skills that each knew one edge.

`scripts/lib/route.mjs` is a pure function of the control plane — reads no files,
spawns nothing, dispatches nothing. `route.mjs` gathers and prints; `skills/ship/`
obeys. Exit status is part of the answer, because the caller is a model reading a
transcript: 0 an agent may proceed, 1 the operator owns it, 2 unreadable.

**The gates are unmoved.** Every step is a command the caller still runs, still
through `risk-guard`. `release_gate`, `blocked` and `unverified` return
`dispatch: null` — a statement, not an omission, and asserted. `/mavci-core:ship`
is model-invocable while every other command is not, because otherwise "one
prompt" is impossible; it loosens nothing, since `risk-guard` authorises by
**caller** and the main session is the main session whichever way the command was
selected.

`--set-phase` now moves the project **and** the in-progress task in one call. Two
writers for one fact had already produced the divergence on the first real
project: `state.json` at `verify` over `control/tasks/0001.json` at `plan`, by
sanctioned command.

#### 4. Four defects found by RUNNING the chain, not by anything failing

**a. The release gate deadlocked every RLS project.** `gate5` declares
`tenancy.isolation: "rls"`, completed a task, passed the checker, and was refused
with `guardian_record_absent` — told to run guardian, whose own step 1 says *"If
`tenancy.isolation` is not `application-filters`, stop."* The gate demanded
evidence the command producing it refuses to produce, and both exits were worse
than the deadlock: run guardian against a mechanism it does not evaluate, or
hand-write a record, which the gate's own closing line forbids. Neither component
was wrong alone; one was conditional on a manifest field and the other had never
been shown the manifest. The exemption is **derived** by `isolationOf(manifest)`
and never assertable by a caller — null, empty and non-string all refuse as
before — and it covers **absence only**: a corpus, failed, stale or unreadable
record still refuses, as does an unverified session. The skipped arm is printed on
every run.

**b. The router named the shared `pending.md` stub as the architect's
destination**, which would have every task in a project overwrite one file.

**c. `active_task` gained a writer in 0.1.22 and never a clearer**, so a task that
was built, verified, documented and closed was still the project's active one.
Terminal statuses release it now. That makes the field truthful; it does not
settle whether it should exist — item 5's decision to delete it is a state-file
format change and stays queued as finding 4.

**d. The close path reproduced the divergence the phase fix had just closed.**
Closing the task before the phase move left it at `verify` while the project went
to `release`. Phase first, close second.

#### 5. What bounds any session, established by observation

A subagent's working directory is **the session's**, and `CLAUDE_PROJECT_DIR` is
**not set** in its environment. Dispatched at `gate5` from a session rooted here,
`mavci-scribe` correctly stopped at `not_connected` — startup step 1, before its
phase gate, so **the phase defect in section 1 was not observed live** and nothing
more is claimed for it than `check-agent-contract` rule 3 establishes.

The consequence is structural. The hooks resolve their root from `input.cwd`, also
the session's, so redirecting agents at another project by hand would run the
chain with `risk-guard` **silent** — no phase gate, no edit scope, no
control-plane guard. **A chain proven with the gates off is not the chain.** So a
multi-agent run must happen in a session rooted at the project. Gate 3 and Gate 4
did this implicitly by running inside `gate4c`; it was never written down as a
requirement, which is how it reads as a convenience until someone tries the other
thing. Now in ARCHITECTURE 8.1, and filed as finding 3.

#### 6. Verified on gate5, and the method earned it four more times

The chain ran `idle -> plan -> build -> verify(FAIL, 3 blockers) -> rework ->
build -> verify(PASS) -> document -> release_gate`, driven by **obeying the
router's own `steps[]`** rather than by knowing the order, over a real Next.js
tree and the real checker. Attempt 1's three violations were unrigged. End state:
`attempts: 2`, `status: done`, `phase: release` on both halves, `active_task:
null`, both attributed verdicts linked, seal intact, release gate passing.

| Mutation | Restores | What goes red |
|---|---|---|
| M1 | pre-fix `verify.mjs` | 5, incl. `adhoc-*` and `verdicts[] = []` — the live defect reproduced |
| M2 | `--task` falling back to adhoc | A4/A4b only — attribution vs. the appearance of it |
| M5 | the verbs unclassified in risk-guard | **nothing at first** — see below |
| N1-N5 | each router property in turn | N5 (`--set-phase` moving one half) breaks **five** end-to-end assertions |
| P1-P4 | each half of the guardian exemption | P2 (the loose exemption) lets a project with **no manifest** pass |
| Q1-Q2 | the stale pointer, the close order | Q2 reproduces gate5's exact bad state |

**Four occasions the house rule returned something reading alone would not:**

1. **M5 went fully green.** Deleting all three lifecycle verbs from `PRIVILEGED`
   left the whole privilege section passing, because the guard also fails closed
   on unrecognised flags — so an unclassified verb is denied by the wrong arm,
   with the wrong message, and with no confirm on the main-session side. Decision
   and reason are two facts and only one discriminates. Eighth instance.
2. **An unreachable enum member.** Requiring every action in `ACTIONS` to be
   reached by some case found `release_gate` unreachable: `selectTask` correctly
   excludes closed tasks, so the branch sat behind a selection that could never
   return one.
3. **An adjacent assertion inside the end-to-end walk.** Reordering the router's
   `document` steps failed the ordering assertion while the walk's own "both
   halves agree" assertion stayed green — it was running a hardcoded order,
   asserting that *my* order works, which was never in question. The walk now
   executes `steps[]` verbatim, and the mutation reproduces gate5's exact bad
   state.
4. **How much one defect cost.** Reverting `--set-phase` to move one half broke
   five end-to-end assertions, not the one about the phase.

34 CI check scripts, two of them new — `check-provenance.mjs` and
`check-route.mjs` — plus rule 3 in `check-agent-contract.mjs`. All wired into
`release.yml` and `selftest.yml`, and `check-pretag` derives the suite from
`release.yml` as before.

#### 7. And the queued finding it turned out to be making worse

`pending-system-change-0.1.23.md` finding 1, filed the day before by another
session: `blankSource` has **no notion of a regex literal at all**, so a backtick
inside one - `/!`([^`]+)`/g` - opens a template-literal state and every byte after
it in the file is blanked. Not a false positive; a silent false NEGATIVE, because
an empty match set is indistinguishable from a clean file.

It was filed at **2 of 34** CI scripts scanning differently than they read. It was
**4 of 36** when this release measured it, and one of the two new ones was a regex
added earlier in this same session, by the fix for something else. The finding
predicted its own growth and was right, which is the argument for its priority.

**The root fix was chosen over the narrow one, and the finding left that open
deliberately.** The narrow fix - have `check-plugin` detect the desynchronisation
and refuse - has no remedy: the only way to satisfy it is to rewrite the regex,
which is contorting source to suit a broken scanner, and is finding 16's shape.
So `blankSource` now recognises a regex literal and **skips it whole, leaving the
contents untouched**. Skipping rather than blanking is the conservative half:
blanking would be consistent with how strings are treated and would also mean
every rule suddenly sees LESS inside a regex, which is a loosening in shipped code
that decides enforcement on every project. Skipping changes nothing a rule sees
inside a regex; the only change is that the rest of the file stops disappearing.

**The rule found its own live instance the moment it could see.**
`check-scribe-refs.mjs:182` called `execFileSync` with no `stdio` - a real
violation of the class 0.1.14 declared *"fixed as a class, not an instance"*,
standing in the tree, unreported, because the rule that polices it was blind in
that file. The rule came back blind and the class came back with it.

Assertion A shipped anyway and was watched failing against the reverted scanner:
`check-plugin` counts the same needle in raw and blanked text, and a mismatch is a
FAILURE naming both counts, with the stdio rule not consulted for that file. It is
not made redundant by the root fix - it is what catches the scanner desynchronising
again for a reason nobody has met yet. Measured after: **0 of 60 scanned files
desynchronised.** Assertion B, the honest wording on an unestablished match, is
NOT shipped and stays open.

#### 8. The phase authority split, and the evidence chain under it

**Operator ruling, mid-release: phase transitions are not a flat grant.** The
orchestrator shipped holding `--set-phase` - any phase, any time, no
precondition, no task - which is not a transition but the absence of a phase
gate. It now holds `--advance-phase <id> --from <x> --to <y>`, which refuses four
ways: the task is not in `--from`, the step is not in `PHASE_STEPS`, the task has
no recorded `spec_approved`, or the spec has changed since that approval. Free
`--set-phase` keeps only the override role and confirms. **This is the only line
in the risk table that got stricter rather than looser in this release.**

`spec_approved` is what separates *executing* an operator decision from *making*
one, which makes the field load-bearing and it says so where it is defined.
`--approve-spec` is operator-only and writes it with the spec's content **hash** -
without the hash an approval is a permanent unlock and the architect could
rewrite the spec afterwards. The router gained `awaiting_approval`, so a written
but unapproved spec stops at a person instead of the router emitting a step it
knows will be refused - which would have burned the ship loop's ceiling and
reported "the orchestrator gave up" instead of "nobody approved the spec".

**`skills/ship/` reversed a position it had argued for, and the reversal is
recorded rather than overwritten.** It had said it does NOT stop for spec review,
because a wrong spec is recoverable - true, and the wrong test. The question is
not whether the mistake is cheap; it is whether the orchestrator is entitled to
decide what to build.

**The operator filed a finding against their own instruction, and it is the
sharpest thing in this release.** The instruction said the approval is "recorded
in the task record" and there was no field to record it in - so
`--advance-phase` would have refused every transition and looked like a working
gate, while the flat `--set-phase` underneath went on working and hid it. That is
finding 16's shape arriving in a specification rather than in code. The durable
consequence is the assertion PAIRING: D1 asserts the refusal, D3b asserts the
permission, because a gate that always refuses satisfies either one alone.
`check-route.mjs` A5-GATE/A5 is the same pairing one layer out, and mutation V2 -
the always-refusing gate - is caught only by the permission half.

#### 9. Write-once verdicts, and one counter that was doing two jobs

`recordVerdict` wrote atomically over whatever was there, so verifying the same
attempt twice replaced the earlier verdict with no trace - and `verdicts[]`
dedupes by path, so the control task could not show it either. ARCHITECTURE 4.3
calls verdicts the audit trail and says they are never deleted; nothing enforced
it. It now REFUSES and names the move that earns a second verdict: consume an
attempt. That is what keeps "the attempt counter bounds the loop" true rather
than aspirational.

**Enforcing it exposed a defect the silence had been hiding.** `--reset-attempts`
zeroes `attempts`, so the next try was "attempt 1" again and its verdict path was
a historical file's - the old writer overwrote it, destroying the record of
exactly the failures the operator had just reset past. Before write-once, that
collision was a successful write. `attempts_total` is now the verdict identity
(tries ever, never reset) and `attempts` remains the retry policy. **The router
had to be split the same way and was not**: it keyed the verdict lookup on
`attempts`, correct until a reset and then sending the builder back over verified
work. Every pure-function case passed while that was broken; the end-to-end walk
caught it, and R-RESET now asserts it directly.

**The assertion rule that came out of it, from the operator:** *a counter test at
attempt 1 cannot distinguish correct from off-by-one, so the assertion has to be
at attempt 2 or it is decoration.* At attempt 1 both counters read 1, and a build
writing either, or a hardcoded 1, or `verdicts.length + 1`, produce identical
output. Moving A1-A3 to attempt 2 is what makes mutations S1 (off-by-one low) and
S2 (hardcoded 1) visible at all; S3, the ceiling counter used as identity, is
caught by the reset section alone.

#### 10. The verifier and the scribe ran on real work

Both had shipped without ever running. On `gate5`:

**`mavci-verifier`, twice, on task 0002.** Attempt 1: it recorded
`0002-attempt-01.json` - **attributed, not `adhoc-*`, which is the test that the
provenance work landed** - reported two blockers with file and line, checked all
six acceptance criteria individually, and reported `tsc` and `npm build` as **NOT
CHECKED rather than passed** when they could not run. It wrote nothing: it holds
no `Edit` or `Write`, natively. Attempt 2 passed, and it independently confirmed
the numbering - `0002-attempt-02.json` with `attempt: 2`, `0002-attempt-01.json`
untouched. A foreign reader verifying the fix, which is stronger than the fix's
own test.

**`mavci-scribe`, on a changelog entry and an ADR.** The ADR transcribes the
operator's phase-authority decision from the five files that carry its reasoning,
quotes each with a line range, and **every citation resolves**. It also recorded
the thing it was asked to notice rather than paper over: *"There is no prior
design document or ADR preceding this implementation. The earliest written form
of this decision is the code that implements it."* It wrote only the two paths it
was given.

**What these runs do NOT establish, measured rather than assumed.** `gate-run.json`
and `hook-run.json` in gate5 are still ABSENT after both dispatches: the hooks
resolved their root to the session's `cwd` - the system repository - found no
manifest and stayed silent. So neither run exercised the hook layer. The
verifier's containment held anyway because it is NATIVE; the scribe's write scope
is hook-only and was checked after the fact by inspection instead of enforced.
That is weaker and is said plainly.

#### 11. Two more found by running it

**`--advance-phase` moved the project phase out from under another task.**
Advancing 0002 succeeded while 0001 was `in_progress`, and the project phase is
shared - the in-progress task owns it. The invariant was enforced at `--attempt`
and `--task-status` and not here: a rule with a door.

**And it delegated to `setPhase`, which GUESSES the task** by `in_progress`
status. That heuristic is right for a global override and wrong for a command
handed a task id: it moved the project and left a `pending` task behind -
the exact divergence this release closed, reintroduced by the scoped command
built to make transitions precise. Caught by D3b, which asserts both halves
rather than the command's exit status.

#### What is NOT in this release, and is filed rather than guessed at

`pending-system-change-0.1.23.md` findings 2-4: the risk guard reading every flag
as a command (a **relaxation**, and not one to make opportunistically in the
middle of something else); the subagent-rooting fact, which has no assertion
available because it is a property of the harness; and `active_task`'s deletion,
which is a state-file format change. Guardian's answers remain unmeasured and
`doctor` still FAILs every project until a corpus result exists — nothing here
changes that.

### Carried forward — still not built

**Items 1–4 and 5–6 below remain unbuilt; item 7 is held deliberately, for the
reason given in the 0.1.12 entry above.** The list is kept verbatim rather than
rewritten, because each entry carries the reasoning that made it a decision.

Items 1–4 were logged against 0.1.10 and moved when
0.1.10 was cut as a single-purpose gate fix; 5 and 6 are from Gate 4c; 7 is the
risk-guard `deferToUser` finding. They moved again at 0.1.11, for the same reason
and by the same rule: 0.1.11 exists so that the fix-in-place result can be
attributed to one change. **Item 1 (doctor cannot see the version it is running)
is the priority of 0.1.12 and rides with the lifecycle items** — it is invisible
from inside a session, so it costs nothing to defer only in the sense that
nobody will notice, which is also the argument for not deferring it twice.

1. **`doctor` must FAIL when a pin's version differs from the anchor's.** Gate 4c
   found `mavci-core@mavci` holding two records — `{scope:"user", version:"0.1.9"}`
   and a stale `{scope:"project", projectPath:"C:\Projelerim\gate4c", version:"0.1.7"}`
   — and the project one won: **0.1.7 is what ran**, enforcing a Gate with a
   superseded rule set. `doctor` printed `plugin 0.1.7` and
   `[ok  ] … anchored at user scope (0.1.9)` three lines apart. Both lines are
   correct — the banner is `pluginVersion()`, which reads the *running*
   `PLUGIN_ROOT`, and the scope line reads the registry — and together they are
   unreadable. Fix: compare `pluginVersion()` against every record's `version`;
   **FAIL** on a mismatch, naming the pinned directory, the fact that the
   reported and running versions disagree, and the scoped uninstall — because
   `plugin uninstall --scope user` does not remove a pin, only `--scope project`
   from the directory it names does. The anchor line must then name the pin as
   the reason rather than list it as an OK detail. Two comments carry the wrong
   claim and change with it: `checkInstallScope`'s "A pinned record ALONGSIDE a
   user-scope one is normal and harmless", and 6.22's "harmless while the anchor
   stands". Full finding: NATIVE-CAPABILITIES **6.25**, with 6.22 corrected.

2. **The stale value outlives the pin, and it is the one CI follows.**
   `control/state.json.plugin_version` is written **once**, by `init()` at
   connect, and changed by nothing afterwards except `doctor --sync`. Every
   other version stamp in the system is rewritten on its next run;  this one is
   not. `templates/mavci-verify.yml` reads it and clones that tag:
   `v=$(node -p "require('./.mavci/control/state.json').plugin_version")` →
   `ref=v$v`. gate4c still records `0.1.7` — written by the shadowed run — while
   0.1.9 is what loads, so the shadowing did not merely confuse one session: it
   wrote a forward-looking value into the control plane that **persists after
   the pin is removed** and steers this project's CI at a rule set the project
   is no longer running. `checkVersionSkew` already names `--sync` as the fix and
   already prints `(CI clones tag v<recorded>)`; what it does not say is the
   consequence. The message must state that CI is pinned to a version this
   project is not running, and that the value can have been written by a session
   whose plugin was shadowed — nobody chose it. `checkHookRegistration` is the
   precedent to copy, in this same file: it already FAILs on
   `the registered hooks are from plugin X, not Y`.

   **Audit of every other `pluginVersion()` writer — none inherits the defect,
   and the reason is worth keeping.** Self-healing, rewritten on the next run,
   so a stale value cannot survive: `integrity.sealed_by_plugin_version` (every
   control write), `integrity.last_gate.plugin_version` (every gate),
   `control/hook-run.json.plugin_version` (every SessionStart — and already
   FAIL-checked at doctor.mjs:962), and `gate.mjs:226`, which reads
   `plugin.json` directly per run rather than any recorded value. Backward-looking
   provenance, where a stale value is the truth and must not be synced:
   `baseline.json.created_by_plugin_version`, a waiver's
   `created_by_plugin_version`, and a verdict's `plugin_version` — each records
   which rule set produced that artefact. gate4c's two adhoc verdicts correctly
   carry `0.1.7`. **`state.json.plugin_version` is the only field that is both
   write-once and forward-looking**, which is exactly why it is the only one that
   captured the shadowing.

3. **CLOSED in 0.1.14 — suppress the benign failure-level annotation on a green
   release run.** Fixed as a class: nine unpinned `exec*Sync` call sites, plus a
   `check-plugin.mjs` rule that fails any of them in `scripts/ci/`. The original
   entry follows, because its reasoning is why it was worth a release.
   `check-packaging.mjs`'s deliberate negative control removes `templates/` from a
   staged copy and asserts the renderer fails; the `ENOENT …/mavci-core/templates/scaffold`
   it provokes surfaces as a red ✗ annotation on a job that exits 0. It is new
   because `check-packaging` only entered `release.yml` in `c78267c` — v0.1.7's
   release ran without it and v0.1.8's died before reaching it, so **v0.1.9's is
   the first release run ever to execute it**. A red mark on a green run trains
   exactly the habit that let run 33265540461 go unread.

4. **Recorded, no work — v0.1.6's protected-environment check is live, not dead
   code.** `doctor`'s FAIL on a protected environment with no `supabase_ref`
   (`9d62c45`, shipped in v0.1.6) fired for the first time against a real project
   in gate4c, wording intact: *"This environment reads as protected and is not."*
   Both risk-guard arms it protects were inert and the environment read as
   protected. The `4 of 4` / `1 of 1` propagation counters in the version-skew
   warning (6.21) also rendered as intended.

5. **One task-lifecycle command surface — `--abandon`, activation, and a phase
   transition that also moves the task record.** Gate 4c found three lifecycle
   transitions the data model can represent and no command can express. A task
   that died before writing a spec cannot be retired: `status` has no
   `abandoned` (and `blocked` must NOT be pressed into meaning dead — it means
   waiting on something), and `state.mjs` has no command that closes a task.
   `active_task` is assigned by nothing — it appears once, in `--init`, set to
   `null` — yet `mavci-builder` read it and cited it as evidence a task had not
   been advanced. `--set-phase` moves the global phase while leaving the task
   record at its old phase, producing **by sanctioned command** the exact
   surface/control divergence we refused to create by hand for task 0001. A
   fourth symptom: `recordVerdict` keys a verdict file by task id when it has
   one and it never has one, so gate runs verifying a task's own artefacts land
   as `adhoc-<timestamp>.json` with `"task_id": null` and are not attributable
   to the task. Three patches would be wrong; this is one missing verb set.
   Decisions already taken: **`--abandon` records who and why in the control
   record**, not just a status flip — a terminal state with no reason is a
   future mystery — and its schema fields must land in the same change because
   `additionalProperties: false` rejects them otherwise. Note `writeControl`
   runs `redactDeep`, so a reason quoting an error string that contains a key
   comes back scrubbed: correct behaviour, documented so nobody reports it as
   corruption. **`active_task` is deleted, not wired**: the fact is already held
   per task by `status: "in_progress"` on the sanctioned path, and a second
   writer for one fact is the failure this Gate found four times. Removing it
   from `state.schema.json` is a breaking read under `additionalProperties:
   false`, so it needs a migration step or a one-version allowance —
   `state.schema_valid` is itself a rule and a stale `state.json` would light up
   the checker rather than fail quietly. `mavci-builder.md`'s "phase, active
   task, retry counters" (line 64) changes in the same commit, or the next
   builder cites the dead field again. The invariant that replaces the pointer —
   at most one task `in_progress` — is enforced at the transition, not
   maintained as state.

6. **`createTask` must not write a spec pointer to a file it never creates.**
   Both gate4c tasks carried `spec: ".mavci/tasks/pending.md"` for a file that
   does not exist, which is indistinguishable from a pointer to a deleted spec
   and is what made an orphaned task unreadable to the next agent that opened
   it. Write a real stub at that path with a watermark first line in the
   `REVIEW REQUIRED` shape the legal pages already use — one convention rather
   than two, greppable by the checker — and the builder must refuse to build
   from a file carrying it. Not `spec: null`: null reports the spec's absence
   but dead-ends the only reflex a reader has, which is to open the path the
   pointer names. Cheapest item here, and the one that makes an orphaned task
   self-describing with no tooling at all.

7. **`risk-guard`'s tier-2 confirm emits a value Claude Code rejects.** `confirm()`
   sends `permissionDecision: "deferToUser"`; the runtime validator accepts
   `"allow"|"deny"|"ask"|"defer"` and rejects the whole payload, so no decision is
   applied and the call falls through to the normal permission flow. Same failure
   shape as the Stop gate: a correct decision computed and discarded. **Tier 3 is
   unaffected** - `deny()` sends `"deny"`, which is valid and was observed
   hard-blocking two live calls during the investigation that found this.
   **The unparseable-input fail-safe also routes through `confirm()`, so the one
   path whose entire purpose is to stop and ask a human is inert too** - found by
   accident, from a malformed probe that came back `deferToUser` carrying "the tool
   call could not be read ... Approve only if you know what this call does."
   `check-risk-guard.mjs` compares the emitted value against a case table whose
   expected value is the literal string `'deferToUser'`: it asserts that the guard
   emits what the guard emits, and never that the value is one Claude Code accepts.
   5 of its 62 cases assert the invalid string and all 62 pass. NATIVE-CAPABILITIES
   4.3 carries the same wrong value. **The fix is not a one-word swap.** The
   validator lists four values, and `ask` versus `defer` is exactly the
   adjacent-but-wrong distinction this Gate keeps finding - one prompts the
   operator, the other may hand the call back to the normal permission flow, which
   is what already happens. Do not change the string until the decision-control
   table loads and it can be quoted verbatim; guessing at a hook payload value is
   how both this and the Stop gate happened. **The enum assertion must compare
   against Claude Code's accepted set, not against our own case table.** Every one
   of the seven instances this session found shares that shape: the assertion was
   internally consistent and never checked against the thing outside it.

8. **`/mavci-core:release` was named 14 times and did not exist — the same defect
   as `retro`, undetected only because nobody stepped on it.** Found by
   `check-command-refs.mjs` on its first run against 0.1.11, in the same sweep
   that confirmed retro's seven. Seven references in `scripts/` and `skills/`,
   three in the generated agents, four in the scaffold legal pages that ship into
   every project.

   Retro's absence was discovered by an agent being trapped by it. `/release`'s
   absence was discovered by a check, before anyone hit it — which is the whole
   argument for the check, and the reason this is logged as a finding rather than
   as a footnote to the retro fix. **A dangling reference is not a smaller defect
   because nobody has reached it yet; it is the same defect earlier.** The
   `legal.pages_present` remedy told an agent a warning "blocks
   /mavci-core:release", the risk guard told it "deploys go through
   /mavci-core:release", and both were instructions to use a door that is a wall.

   **The fix was to name the operator, not to add an exception list.** An
   allowance for "planned, not built yet" is where exactly this class of defect
   goes to live: it converts a build failure into a list entry, and a list entry
   into a permanent condition. All 14 were reworded to name what exists.

   **What is owed when `/release` ships:** the names come back — the remedy, the
   risk-guard deploy message, the agent contract line and the four scaffold
   watermarks should say `/mavci-core:release` again, because that will then be
   the true and most useful thing to say. `check-command-refs.mjs` is what makes
   restoring them safe *and* what forbids restoring them early: the moment
   `skills/release/` exists the references resolve and the build stays green, and
   until then any one of them fails it. The check is the enforcement in both
   directions, which is why no reminder is needed here beyond this paragraph.

### 0.1.24 — the caller was never asserted, and neither was the report

**Cut 2026-09-03**, the same day as 0.1.23 and because of it: the first
end-to-end run of the chain on a real request died on its first line.

#### 1. `/mavci-core:ship` threw the request away

`skills/ship/SKILL.md` line 12 called `route.mjs` with no `--request` and no
`$ARGUMENTS`. The router took its no-request branch, printed `release_gate`, and
ship's own action table says that means **stop** — so the chain terminated before
its first consultation, on a request that routes to `plan` the moment the argument
is passed. Line 45, the loop body inside a fenced block, carried
`--json --request "$ARGUMENTS"` and was always correct. The line that EXECUTES was
not the line written to be right.

It reads as a legitimate verdict, which is why it is expensive: `release_gate` is
a real action with a plausible explanation attached, and from `idle` the same drop
yields `idle`. There is no input for which the bare call is right and no output
that says it was wrong.

**Three checks read that line and none asked the question.**
`check-route.mjs` asserts every router case as a pure function *with a request
already in hand* — callee asserted, caller assumed. `check-command-invocation.mjs`
substitutes `$ARGUMENTS` with the empty string **by construction**, because it
asks whether a block runs. `check-skill-placeholders.mjs` asserts the placeholder
is spelled right, and it was. Same shape as 0.1.23's counter split: each side
right alone, the seam between them asserted by nothing.

`check-skill-arguments.mjs` is the seam. For every `SKILL.md` declaring
`$ARGUMENTS`, each inline `` !`...` `` block either receives them or is in
`EXEMPT` with a reason. **The allowlist is load-bearing, not an escape hatch:**
`verify` calls `route.mjs` bare and is CORRECT — its `$ARGUMENTS` is a task id and
the router has no task-id parameter — so exemptions are keyed by SKILL and each
records what that skill's arguments MEAN. Without it the rule would "fix" a
correct call into a bug. Nine exemptions, each asserted to still match a block, so
one that outlives its call fails rather than excusing its replacement.
Demonstrated failing against the reverted line and green against the fix, with
both controls ahead of the loop.

#### 2. The report is the last uncontrolled input, and both parties feed it

The 0.1.24 fix was reported done, committed and released — by a session that had
written it nowhere. `plugin.json` read 0.1.23, `git log` ended on a docs commit,
and the reflog was empty of it, which is the part that settles it: a commit made
and then reset still appears there. It was not lost. It was never written. At
most it reached the plugin CACHE — generated state — which was re-populated twelve
minutes later, erasing the question along with the edit.

The same day, twice, the operator reported a migration applied that was not.

**Every layer here verifies OUTPUT** — the checker reads the tree, the verifier
reads the criteria, `check-pretag` reads the manifest against the tag, `doctor`
reads the control plane against the installed build. **Nothing reads a REPORT**,
and a report is the single input to the next decision: to propagate, to move on,
to build the next thing. A false "this landed" does not fail — it succeeds against
the wrong tree, which here produced a propagation that reinstalled the version
being replaced and a run that failed for the reason already diagnosed.

**The evidence for "this landed" is the filesystem**: `git log`, `git status`, the
tag list, the version in the manifest. Not a transcript and not the other party's
summary. Whoever acts on such a claim checks it; whoever makes it shows the
command. **No assertion is proposed, deliberately** — nothing in this repository
can read a transcript, and a check that appeared to would be the house failure
mode exactly. The full record is
`docs/lessons/0.1.24-the-caller-was-never-asserted.md`.


### 0.1.25 — a lesson that was written down and did not bind

**Cut 2026-09-03, and it has no entry here until now.** The record was in the
commit message and in `docs/lessons/gate5-2026-09-03.md`, and this file said
nothing — which reads, to the next person, as a release in which nothing
happened. The same omission was named for 0.1.15 and 0.1.16 and it recurred
inside one day, so it is written down here rather than left to be noticed a third
time.

`retro.mjs --apply` resolved its write target through the plugin root and
accepted the **marketplace clone** as a fallback. An agent running from
`~/.claude/plugins/cache/` misses the first candidate, so the clone won, and the
finding landed in generated state that the next propagation resets. The command
reported success.

**Three things were already in place and not one of them bound**: the lesson file
`docs/lessons/0.1.18-the-clone-is-generated-state.md`, sitting in the very
directory being written into; the refusal at the `!repo` branch, already written
and already naming the manual step, unreachable while the clone counted as a
valid target; and the comment above `systemRepo()` recording that the FIRST draft
preferred the clone, that this was fixed to prefer the running copy, and that the
clone was left as a fallback. Nothing was lost only because `--clear` had not run
yet — and the documented workflow is apply THEN clear, so an operator following
it destroys the only durable copy.

The fix removes one element from a candidates list. **The assertion is a round
trip and not an exit code**: `--apply` exited 0 on the broken build and the file
existed, just in a directory that gets reset, so asserting either passes on the
bug. `check-retro.mjs` case 7 builds a tree where only the clone carries the
marker and requires the resolver to refuse.

### 0.1.26 — the writer, not the order

**Cut 2026-09-04**, against gate5 findings 7 and 8. Both strand the next task,
and they concealed each other in the way 0.1.21's findings 19 and 20 did: the
deadlock was reported, and the report went into a hole.

#### 1. Finding 7 — the document action deadlocked its own closing step

`route.mjs`'s `document` action names three steps: dispatch `mavci-scribe`, then
`state.mjs --advance-phase <id> --from verify --to release`, then
`--task-status <id> --status done`. On gate5 task 0003 the scribe wrote a
"Completion Summary" into `.mavci/tasks/0003.md` — **the spec, which is the
document the operator's approval is hashed against.** The spec's sha256 went
`2dd65597ac15` to `054a570a32b5`, and step 2 refused: *the approval was of a
specific document.* The router's own prescribed sequence broke itself.

**THE FIX IS THE REMOVAL OF A WRITER'S ABILITY, NOT AN ARRANGEMENT AROUND IT, AND
THIS SECTION IS LONG ON PURPOSE.** This is the third ordering defect at that step
list. The first had `--task-status` before the phase move, which left the task
frozen at `verify` while the project went to `release`. The second — the fix for
it, with a comment explaining the order — did not anticipate this one. A reader
arriving at that step list now sees an ordering that looks fragile and will want
to make it robust by sequencing. That instinct is wrong twice over, and the
reasoning is recorded here and beside the step list so it does not have to be
re-derived on the fourth occasion.

**Reordering — advance first, dispatch second — was available, is smaller, and
makes the failure worse.** The sequence would exit 0. The scribe's write would
then land *after* the last thing that reads the approval hash, so the approved
document is still mutated, permanently and unrecoverably (that is finding 8), and
**the refusal that told us about it never fires again.** The deadlock would be
gone and the damage would not. That converts a working control into a silent one,
which is the failure this repository has named more often than any other — the
Stop gate exiting 0 for seven releases, the corpus record read as project
evidence, thirty-one assertions printing FAIL behind a process that exited 0.

**The deadlock was the better failure because it was loud.** It cost an
afternoon, it named the file, the two hashes and the command, and it stopped
before anything else was built on top of a document nobody had agreed to. A
reorder buys back that afternoon by spending the only signal that the document
was damaged. Measured on the axis that matters — what does a broken build look
like, and would this say so — the loud version is the better one, and a change
that trades it for silence is a regression whatever the step list looks like
afterwards.

**Making the dependencies explicit was the other candidate, and it is
adjacent-but-wrong in the exact sense this file keeps recording.** It would have
each step carry its preconditions and let the router order them, so
`--advance-phase` declares that it needs the spec hash intact. But that is not a
scheduling constraint. The invariant is *the approved document does not change*,
full stop — and encoding it as an ordering asserts the opposite: that changing it
is fine as long as you sequence around it. It would also be machinery ROADMAP
forbids, added to a function whose whole definition is that it is a pure decision
over the control plane, in order to **hold** a hazard rather than remove it. A
dependency graph would have made the third defect impossible and left the
fourth — a second writer, a later step, another precondition — exactly as
available as it was.

So neither. `spec_approved` records an operator decision about a **specific**
document and the sha256 is what makes "specific" mean anything; `--advance-phase`
refusing on a changed hash is that control working correctly, and finding 7 is not
a defect in it. The defect is that an agent held the ability to invalidate an
operator's recorded decision. Two mechanisms remove it, and they shipped together
because neither covers the other's case:

- **The class control.** `risk-guard.mjs` denies **every** agent a write to a spec
  that carries a recorded approval, matched against `spec_approved.spec_path` in
  the control task rather than against a convention about where specs live. Not
  the scribe's rule: the architect and the builder both hold `.mavci/tasks/**`
  legitimately — the architect authors the spec before anyone approves it — and
  both would have deadlocked identically on an approved one. Fixing the instance
  and not the class is what let 0.1.21's fix walk past 0.1.23's phase gate.
- **The scope.** `mavci-scribe` no longer holds `.mavci/tasks/**` at all; it holds
  `.mavci/tasks/*.summary.md`. The reasoning is the one already written in its own
  definition for `.mavci/lessons/`: ask whether the job needs it before asking how
  to contain it. `.mavci/tasks/<id>.md` was a **source** for this agent, named as
  one in `skills/scribe/SKILL.md` step 1 — the same path was a read source and a
  write destination, which is the whole defect stated in one line.

The class control reads the control plane and is therefore silent on a project
with no approvals, and fails open on an unreadable one — deliberately, because a
rule that denied every write under `.mavci/tasks/` on an unreadable control plane
would stop the architect authoring a spec at all. The scope is what holds in both
of those cases. **Two braces, two assertions**, 0.1.11's rule applied to the pair:
`check-risk-guard.mjs` asserts the scribe is refused a spec on a project with **no
approval recorded**, and asserts the summary path is writable, because a scope
that denies everything satisfies the first case alone.

What is left in the step list is the one real dependency — phase before close —
which was already right, and is now right **because nothing can invalidate it**
rather than because the order was guessed a third time.

#### 2. Finding 8 — an agent write to an approved spec was unrecoverable

Follow-on, and it is why finding 7 could not be waited out. After the scribe broke
the hash it was dispatched again, told to restore the file to exactly the approved
bytes, and given the target sha256 verbatim. It reported success and produced a
**third** distinct document, `4af04f42aef1`. It could not have known: it holds
`Write` and `Edit` and no shell, so it cannot hash what it has written. Recovery
was absent rather than difficult — `.mavci/tasks/` was untracked, `git log` on the
file was empty, and no snapshot or backup existed anywhere under `.mavci`. **The
approved bytes were gone**, so the only remaining moves were an operator
re-approving a spec in order to record that it is finished, or the free override.

`--approve-spec` now writes the approved bytes to
`.mavci/control/specs/<id>-<sha12>.md`, **before** it records the approval, so
there is never a recorded approval whose bytes were not kept. The path is
**derived** from `spec_approved.spec_sha256` rather than stored in a field — a
second name for one fact is what drifts, and the record already carries the hash
under a seal.

**The snapshot is verified, not trusted.** It is content-addressed by a hash that
lives in a sealed record, so a tampered copy fails its own restore rather than
restoring a document nobody approved; without that it would be an unsealed second
authority over the operator's decision, carrying the operator's name — a worse
defect than the one it fixes. `--restore-spec` checks the snapshot **before**
writing, then re-reads the written file and hashes it again, because "I wrote it"
and "it is on disk with those bytes" are two facts and only the second matters.
That second check is the gap the scribe fell into, made structural.

`--restore-spec` is **operator-only** and is in the privilege table by name. It
overwrites a whole document, and the situation calling for it is one where an
agent has already written that document once; restoring is executing a recorded
decision exactly, which is `--advance-phase`'s category, not `--approve-spec`'s.
And the changed-hash refusal now names **both** exits, restore first: a message
offering only "re-approve" teaches re-approving, and re-approving a spec in order
to close the task it describes empties the gate of its meaning.

The other half of the finding's ask is asserted and is honest about its reach: the
scaffold's `.gitignore` does not exclude `.mavci/`, so a checkout **is** a second
recovery path — once someone commits. Nobody had, which is why gate5's `git log`
was empty. The assertion keeps that path open. It cannot assert that a project
committed, and it does not pretend to.

#### 3. The failing test had to run the whole action, and that is where it had never run

`check-route.mjs`'s end-to-end walk did `if (!m) continue` on `dispatch
mavci-scribe` and executed only the two `state.mjs` lines — so it asserted the
closing sequence against a project **in which the scribe had never run.** Every
check on the scribe's own result passes on this bug: it exited 0, it wrote a
correct-looking changelog, its citations resolved. The failure is entirely in what
its write did to the next step, and only a test that runs dispatch *and* the
transition can see it.

A subagent cannot be dispatched from a CI script, so the dispatch is replayed as
the one act that had a consequence — an `Edit` of the approved spec, submitted to
the real guard under the real agent name and **honoured**: allowed means the write
happens, denied means it does not. **What that does not claim** is written beside
it. It says nothing about whether a scribe would attempt the write (one did, once,
unprompted); it says that if one does, the guard refuses and the action completes.
Against the pre-fix tree: guard allowed, `--advance-phase` exited 1, the spec's
sha moved, both halves stranded at `verify`, and the project fell back to `idle` —
five red, the live defect reproduced.

#### 4. E6 went green on its first mutation run, and that is the fourth scale

**An assertion written to catch M5's shape reproduced M5's shape inside itself.**

0.1.23's mutation M5 is the one where deleting three lifecycle verbs from
`risk-guard`'s privilege table changed **nothing observable**: the guard also fails
closed on an unrecognised flag, so an unclassified verb is denied by the wrong arm,
with the wrong message, and with no operator confirm on the main-session side.
Decision and reason are two facts and only the reason discriminates. E6 was
written to hold `--restore-spec` to exactly that: deny, *and* denied by the
privilege table rather than by the fail-closed arm.

Removing `--restore-spec` from the table left **E6 green.** The decision assertion
was right and inert — the verb is denied either way — and the reason matcher, the
half that was supposed to discriminate, looked for `unrecognised|not recognised|
fails closed|could not be` against a message that actually reads *"may only run
state.mjs with … which is not classified as agent-safe."* Adjacent wording, no
match, green. Fixed to match the text the guard emits, after which the mutation
fails both E6 cases and names the arm.

**Only running the mutation exposed it.** Reading E6 shows an assertion that
plainly separates the two arms; it separates them in intent and matched neither in
fact. There is no static reading of that file which reveals it, and `check-ci-gates`
cannot see it either — it proves an assertion *can* fail, never that it
discriminates, and it says so.

**This is the fourth scale we have hit this pattern at — the operator's framing,
and it is the useful part of the finding.** The pattern is: *the artefact written
to prevent a defect contains the defect.*

- **Comment.** ARCHITECTURE 6.4's `hooks.json` example still showed
  `"command": ["node", …]` — the array form that made v0.1.2 install with **zero
  hooks** — as canonical, in the governing document. And `check-guardian.mjs`'s
  Bash assertion read "fully natively contained" after guardian's reads had become
  hook-enforced, so a green check made a false claim.
- **Fixture.** 0.1.14's assertion 4 tested the undeclared-step arm against a
  fixture only, so adding a shell step to the real `release.yml` changed nothing —
  the blind spot that release was about, reproduced inside the test written to
  prevent it. 0.1.12's evidence-cap fixture did the same thing one branch early.
- **Lesson file.** 0.1.25: `docs/lessons/0.1.18-the-clone-is-generated-state.md`
  sat **in the directory being written into** while `retro --apply` wrote into it,
  and did not bind.
- **Assertion about the pattern.** This one.

Each scale is further from the code and closer to the thing that is supposed to
catch the code, and the defect survives the move every time. The only instrument
that has caught any of them is the same one: name the broken build the assertion
must catch, produce it, and watch. **A green mutation is a finding about the
assertion, always** — it is never evidence that the fix was unnecessary.

#### Verification

Every fix was demonstrated failing first, and each mutation is independent.

| Mutation | Restores | What goes red |
|---|---|---|
| the pre-fix guard | no approved-spec rule | 5 in the end-to-end walk — finding 7 reproduced live |
| no snapshot at `--approve-spec` | 0.1.25's approval | E1, E3, E4 |
| one exit in the refusal | 0.1.25's message | E2b only |
| `--restore-spec` unclassified | no table entry | E6 only — **and this is the mutation that was green first** |
| a trusted snapshot | no pre-write check | E5b only — the exit status stays right, the tree does not |
| scribe keeps `.mavci/tasks/**` | 0.1.25's scope | `check-risk-guard` only; the walk stays green, which is why both are asserted |

33 CI check scripts, all passing. No new check file: finding 7's assertions belong
to the walk that owns the chain and to the guard's own case table, and finding 8's
to `check-state-transition.mjs`, which owns the approval gate. A fifth file
asserting the same three components would be a second list.

---

**Note on this log:** 0.1.27 and 0.1.28 have no entry here. They are in the commit
log and, for 0.1.27, in `docs/lessons/`. The gap is named rather than stepped over,
for the reason given at 0.1.17 and again at 0.1.25 — a release log that skips a
release silently reads as a release in which nothing happened. This is the fourth
occurrence, which is itself the observation: the entry is written by whoever cuts
the release and nothing checks that one exists.

### 0.1.29 — the step after the only door

**Cut 2026-09-04**, against finding 22. `check-pretag.mjs --cut` has been the only
door to a tag since 0.1.9, for the reason its own header gives: *a check nobody is
required to run is the same failure one layer up.* It created the tag, printed
`git push origin <tag>` and a `gh run watch` line as advice, and exited.
Everything after the tag existed was advice, and today both halves of it failed.

**`--cut` can create a tag in a directory that gets reset.** The marketplace clone
is a real checkout of this repository — same remote, same branch, same workflows,
same manifest — so every arm of the gate passes there, and propagation is
`git checkout -B main origin/main`, which discards it.

**And a push can report nothing to send.** `git push --follow-tags` from the
repository the operator IS editing answers `Everything up-to-date`, because the
tag is not in it.

**Neither is visible from the other's output**, which is what makes the pair worse
than either. The first symptom is the signal 0.1.18 named as the worst this system
has: CI green on a version that does not exist.

#### 1. Where the assertion lives — the push and the watch moved inside the gate

`--cut` cannot assert after it exits, so the choice was a second mode the operator
runs afterwards, or the push. A second command is advice with a different shape,
and this file's own header settled what those are worth two releases before it had
a name for it. So `--cut` **pushes** — by EXPLICIT refspec, never a bare `push` and
never `--tags`, both of which can answer "Everything up-to-date" — reads the tag
back off origin, and then **watches the release run**.

**0.1.17's paragraph saying it deliberately did NOT push is rewritten, not left
standing.** Its argument was that a read-only credential should fail loudly with
the tag still local and deletable — `MAVCI_TOKEN` is exactly that shape. That was
right about the property and wrong about who holds it: the `push-failed` arm
preserves it exactly and performs the rollback, instead of relying on the operator
to remember `git tag -d`.

#### 2. Atomicity is the property, and it is what makes a failure survivable

**Every arm up to and including the push leaves either the tag on origin or NO TAG
AT ALL — never a local tag origin does not have.** A failed `--cut` is retryable by
re-running the same command, and nobody has to work out which of three places the
tag is in before they can act.

That reverses a decision inside this release. The first build kept the tag on
`absent` and `unknown`, reasoning that it was the evidence. It is not worth much as
evidence — the commit is still HEAD and re-cutting produces an identical tag — and
it costs the one thing that matters at that moment, which is a state with one
possibility in it rather than three. `unknown` deletes too, and says exactly what
that establishes and what it does not: *either on origin or nowhere, and this gate
has NOT established which.*

**From the watch onward the direction reverses and nothing is rolled back.** The
tag is on origin, immutable and possibly fetched; a moved tag means one name and
two commits on two machines. `watchRelease` is not even given a git runner, and
every non-passing arm says the tag stands.

#### 3. The bound, and what it says at the bound

Ten minutes total, two of them for the run to appear at all, polled every fifteen
seconds. Still running when that is spent is **UNKNOWN — not a pass and not a
failure.** Three exit statuses, because they are three different answers:

| exit | meaning |
|---|---|
| 0 | the tag is on origin and its release run passed |
| 2 | a refusal — up to and including the push, nothing was released |
| 3 | the tag is on origin and the verdict could not be read |

Collapsing 3 into 2 would report a released version as a failed cut and invite the
one repair that must never happen. The message at the bound names the elapsed
bound, says the tag was NOT deleted and must not be, gives `gh run watch <id>`, and
says what each outcome means: *if it passes the release is good; if it fails the
tag stands and the fix is a NEW version.*

Five watch verdicts, because collapsing them is how a message explains one cause
confidently and wrongly: `passed`, `failed`, `unfinished`, `no-run` (and it says
outright that this is **not** evidence the workflow failed to trigger — a queue can
exceed the bound), `unavailable`.

#### 4. The refusal names what it refuses and why, in its first sentence

*A release cut in generated state is not a release* — followed, before any path, by
the consequence: the tag you are about to create would be destroyed by the next
propagation, unread by anybody. Someone who hits this needs to understand that, not
that a path check failed. The predicate refuses the **class**: anything under
`<config>/plugins`, with the clone also matched by canonical path so a junctioned
clone is caught. 0.1.25's `retro --apply` fix at the irreversible step.

#### 5. Verification — 21 mutations, and three of them found defects in the fix

Nine assertions were red against 0.1.28 before anything was implemented, with the
guard that a source checkout is NOT refused green throughout — the half that
matters when a control is being added. Then 21 mutations, each producing labelled
red. **Three of them were findings rather than confirmations:**

**P21 — nothing asserted the sentence.** Replacing the whole first line with
`REFUSING: generated state.` left every assertion green: they all read the body,
where the path and the propagation command still sat. The requirement the operator
stated had no assertion behind it until P21 said so. Assertion 17b now anchors on
the first line and requires the consequence to appear *before* the path.

**P11 crashed the suite instead of failing it.** Assertion 27 was written before
`cutTag` took a `watch`, so killing the check-tags arm walked into an undefined
call — and a crash reports nothing about which arm broke. Fixed, and the assertion
now also requires that a rejected tag is never watched.

**P19b could not be caught at all.** A poll loop with no bound does not fail an
assertion, it *hangs the suite* — the one shape of "no bound" the bound assertion
most needs to catch. The fake `gh` now refuses to answer past a ceiling and every
watch assertion routes through one helper, so an unbounded loop is four labelled
reds instead of a stalled run.

**And P12, from the first build, is the one that generalises.** The generated-state
refusal was placed first in `main()`, ahead of the `--selftest` dispatch — which is
what a control placed early looks like. Mutating the predicate to fire on every
tree made the gate refuse to run its own self-test, so assertion 16, which exists
precisely to catch an over-firing predicate, was the first thing the defect took
offline; the mutation reported *no failures at all*. `--selftest` is dispatched
first now.

**That note is no longer only in the day record.** It sits above `selftest()` in
`check-pretag.mjs`, where the next person adding an assertion reads it: *a green
mutation is a finding about the assertion, always — never evidence the fix was
unnecessary*, with the five scales on record (comment, fixture, lesson, assertion,
placement) and the closing line that `check-ci-gates.mjs` proves an assertion CAN
fail and says outright it cannot prove any of them discriminates.

**The tail was extracted from the CLI to be testable at all.** Through 0.1.28 the
tag-create / check-tags / push sequence lived inline in `main()` — where 0.1.26
found finding 25 sitting for three releases. `cutTag` is that sequence with all
three runners injected, and the two ordering properties are asserted directly: the
rollback fires before anything is pushed, and the watch fires only after the tag is
confirmed on origin (watching a tag that is not there polls to the bound and
reports UNKNOWN, burying the one thing that IS known).

**The residual is named rather than covered.** `cutTag`'s sequence is asserted with
every runner faked; `main()` calling it is not — a release gate cannot cut and push
a real tag to prove that it does. That is one line, commented at the call site.

45 assertions in `check-pretag --selftest`, up from 22. All 36 checks `release.yml`
runs pass.
---

## Ask me before

Renaming any locked identifier · adding an npm dependency · deleting or
rewriting a verdict, seal, or anything under `.mavci/control/` · weakening a
tier-3 rule in the risk table · changing the state-file format · pushing a tag ·
anything touching the GitHub repo's settings or visibility.
