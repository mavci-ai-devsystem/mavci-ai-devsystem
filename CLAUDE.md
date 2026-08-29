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

Phase 1 built: `architect`, `builder`, `verifier`; 8+4 checker rules; the five
scripts; hooks; scaffold; CI. Not yet built, per plan: `guardian`, `scribe`,
`/release`, `/retro`, `/research`, five standards packs, nine further rules.

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

### 0.1.12 — recorded, not built

**None of these is built.** Items 1–4 were logged against 0.1.10 and moved when
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

3. **Suppress the benign failure-level annotation on a green release run.**
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

---

## Ask me before

Renaming any locked identifier · adding an npm dependency · deleting or
rewriting a verdict, seal, or anything under `.mavci/control/` · weakening a
tier-3 rule in the risk table · changing the state-file format · pushing a tag ·
anything touching the GitHub repo's settings or visibility.
