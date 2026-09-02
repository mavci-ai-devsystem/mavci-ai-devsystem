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
    push → tag vX.Y.Z → push tag

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
    13 skills     3 of them the standards packs                    skills/
    15 scripts    state, redact, verify, gate, risk-guard,         scripts/*.mjs
                  doctor, retro, release-check, guardian-record,
                  worklist, render, build-agents, config, and
                  0.1.18's corpus-stage and corpus-score
    9 hooks       every one silent outside a Mavci project         hooks.json
                  (6.23). NINE, not the eight this file and
                  check-hooks-quiet's header both still said:
                  0.1.15 added guardian-record on SubagentStop.
                  Entries below that name eight are dated
                  observations and correct as history.
    28 checks     the release suite, DERIVED from release.yml      check-pretag.mjs
                  TWENTY-EIGHT, not the 24 this file said: 0.1.18
                  added four, to selftest.yml only, where no
                  release gate ever ran them. See the 0.1.18 entry.

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

---

## Ask me before

Renaming any locked identifier · adding an npm dependency · deleting or
rewriting a verdict, seal, or anything under `.mavci/control/` · weakening a
tier-3 rule in the risk table · changing the state-file format · pushing a tag ·
anything touching the GitHub repo's settings or visibility.
