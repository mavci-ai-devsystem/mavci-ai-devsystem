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
   `MIN_NODE_MAJOR = 22`, and `templates/mavci-verify.yml` runs the cloned
   checker on 22 inside every downstream project. A development machine on a
   newer Node runs a 23+ or 24+ API happily and gives no local signal, and the
   failure then surfaces in a *project's* CI, not this repo's. Before using
   anything recent, check it against Node 22 — do not trust a local pass.

   Raised from 20 on 2026-08-28. Per the official `nodejs/Release`
   `schedule.json`, Node 20 (Iron) ended 2026-04-30 and is unpatched; 22 (Jod)
   runs to 2027-04-30, 24 (Krypton) to 2028-04-30. The cost of moving the floor
   is rewriting the committed workflow in every connected project, which is why
   it was done at zero connected projects rather than after the first
   `/mavci:connect`. Node 22 has been in maintenance since 2025-10-21, so the
   next move — to 24 — should happen well before April 2027.
2. **`plugins/mavci-core/agents/*.md` are generated.** Source of truth is
   `agent-defs/*.json` plus `agent-defs/_contract.md`. Never hand-edit a
   generated agent; edit the def and run `build-agents.mjs`. CI fails on drift.
3. **No binary files, no NUL bytes, UTF-8 without BOM, LF endings.** A file that
   shows as "Binary files differ" cannot be reviewed and is silently skipped by
   `grep -r`. Enforced by `check-plugin.mjs`.
4. **A new standard requires a new check.** A class-A change (missing standard)
   without a class-B check (nothing verifies it) is rejected — that is how the
   system decays back into prose. Every check needs `templates/fixtures/
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

Projects pull with `/plugin marketplace update` then `/plugin update
mavci-core@mavci`. No project file is edited. Rollback: see `ARCHITECTURE` §13 —
roll-forward is primary, because ref-pinning inside `extraKnownMarketplaces` is
unverified (6.16).

---

## Current state

Phase 1 built: `architect`, `builder`, `verifier`; 8+4 checker rules; the five
scripts; hooks; scaffold; CI. Not yet built, per plan: `guardian`, `scribe`,
`/release`, `/retro`, `/research`, five standards packs, nine further rules.

Distribution is **unproven** — local work used `--plugin-dir`, which takes
precedence over an installed plugin (6.9), so the real GitHub path (marketplace
add, install, trust dialog, version propagation) has never actually run.

---

## Ask me before

Renaming any locked identifier · adding an npm dependency · deleting or
rewriting a verdict, seal, or anything under `.mavci/control/` · weakening a
tier-3 rule in the risk table · changing the state-file format · pushing a tag ·
anything touching the GitHub repo's settings or visibility.
