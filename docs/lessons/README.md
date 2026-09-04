# Lessons

Gate findings, promoted out of the project they were found in.

A Gate runs in a throwaway project — `gate4`, `gate4-verify`, `gate4c`. The
project gets deleted; the finding must not. Anything under a project's
`.mavci/lessons/` is written by an agent that had no other way to record what it
saw, and it lives on a disk nobody is committed to keeping. Promoting a lesson
here is what makes it survive.

Each file is copied **byte-identical** from its origin. The paths inside them are
relative to the project that produced them, not to this repository, and that is
deliberate: a lesson edited to fit its new home stops being evidence.

    gate-4-closed.md                  gate4c, plugin 0.1.11, 2026-09-01
                                      Gate 4's result. Enforcement PASSED end to
                                      end, including fix-in-place. Records four
                                      declined cheap paths, because an enforcement
                                      pass is worth nothing without them.

    pending-system-change-0.1.12.md   gate4c, plugin 0.1.11, 2026-09-01
                                      Findings 1-5 and the build order 0.1.12 was
                                      built from. Also the Phase 2 design
                                      constraint for Guardian and /release.

    pending-system-change-0.1.15.md   NO ORIGIN PROJECT. plugin 0.1.14,
                                      2026-09-01. Read-only pre-connect analyses
                                      of TWO real repositories, neither connected
                                      nor written to: protoolhub-main (1-4) and
                                      AI-Chatbot-Widget-SaaS (5-7).
                                      1, 2, 5 are mechanism: the credential
                                      scanner filters by extension, walk()
                                      ignores .gitignore, and rls_enabled passes
                                      on an empty input set. 3 is scope - the
                                      system models exactly one stack. 4 is the
                                      channel gap that made this file manual.
                                      6 is the CLASS the second project revealed:
                                      rules match spellings, not meanings, in six
                                      places. 7 and 8 are the publication gap in
                                      three tiers - working tree vs HEAD vs the
                                      remote. 8 is the only finding here with a
                                      realised cost: a 404 that reads as absence
                                      had already caused two history restarts and
                                      left ten commits on one disk.
                                      The file holds SEVENTEEN findings; the
                                      summary above describes 1-8. 0.1.15 and
                                      0.1.16 were built from a subset of them and
                                      the rest are still queued, which is why the
                                      file is still here.

    0.1.16-fixture-class-and-actor-aware-gate.md
                                      gate4c, plugin 0.1.15, 2026-09-01.
                                      Findings 3, 6 and 7 from one guardian
                                      dispatch that looped ten times and produced
                                      nothing. The corpus deadlock: an exemption
                                      that existed as a concept, in the wrong
                                      rule, naming a path no project tree could
                                      match.

    0.1.17-identity-at-the-moment-of-the-push.md
                                      NO ORIGIN PROJECT. plugin 0.1.16,
                                      2026-09-01. The account check existed, was
                                      correct, and fired where it was convenient
                                      to compute rather than where the loss
                                      occurs. Fourth `Repository not found`
                                      against the system repo in one day.

    pending-system-change-0.1.18.md   NO ORIGIN PROJECT. plugin 0.1.17 and
                                      0.1.18, 2026-09-02. TWO findings, neither
                                      built. 1: state.schema_valid judges every
                                      control file by the CURRENT schema and
                                      never reads the schema_version the file
                                      declares, so 55 correct pre-0.1.15
                                      verdicts in gate4c read as 55 blockers -
                                      and the remedy sends the operator to
                                      --reseal, which launders the evidence of a
                                      condition that was never tampering.
                                      2: check-read-scope.mjs deletes and
                                      rewrites the tracked agent-scopes.json to
                                      test the unreadable-file path. The finally
                                      restores it; a SIGKILL between the two
                                      does not. Bounded - risk-guard fails
                                      CLOSED on an unreadable scopes file - but
                                      it is the one place a normal CI run writes
                                      to tracked source.

    0.1.18-the-clone-is-generated-state.md
                                      NO ORIGIN PROJECT. plugin 0.1.17,
                                      2026-09-02. 43 files and 2510 insertions
                                      of 0.1.18 found uncommitted in
                                      ~/.claude/plugins/marketplaces/mavci, a
                                      directory every propagation overwrites
                                      with `git checkout -B main origin/main`.
                                      Recovered intact with 27 minutes to spare.
                                      The first finding about a place the system
                                      does not look at all: doctor has read the
                                      clone's VERSION since 0.1.5 and walked
                                      past its working tree every time. Also
                                      records the recovery - git to git, never
                                      through a patch file - and why the
                                      PowerShell patch round-trip failed on
                                      every hunk.

## The exception to "copied from its origin"

`pending-system-change-0.1.15.md` was **authored here**, not copied. It has no
origin project, and the paths inside it are relative to this repository except
where they name `protoolhub-main` or `AI-Chatbot-Widget-SaaS` explicitly.

That is not a lapse in the rule above; it is the rule meeting a case it did not
anticipate. The findings are about a repository that was analysed **before**
`/mavci-core:connect` and deliberately never written to, so there was no
`.mavci/lessons/` to copy from and there must not have been one. `retro --record`
writes under `projectRoot()`'s control plane, which does not exist until connect
step 4 — the step these findings explain the failure of.

So the escalation channel was unavailable precisely because the findings were
found early enough to be cheap. That is Finding 4 in the file itself, and it is
why this promotion was manual for a second time, for a different reason than the
first.

    0.1.23-the-chain-had-no-middle.md gate5, plugin 0.1.22, 2026-09-03
                                      The orchestration gap, and the two agents
                                      that had never run. mavci-verifier was named
                                      by no skill; mavci-scribe had no skill and
                                      could not have started if it had. The rework
                                      loop was not unautomated - it had no
                                      entrance. Four more defects found by RUNNING
                                      the chain, including a release gate that
                                      deadlocked every RLS project. Also records
                                      what bounds any session: a subagent cannot
                                      be rooted at another project, so the
                                      multi-agent half must run in a session
                                      rooted there.

    0.1.24-the-caller-was-never-asserted.md
                                      gate5, plugin 0.1.23, 2026-09-03.
                                      NOT byte-identical, and the only file here
                                      that is not: finding 1 was applied in the
                                      same pass that recorded it, and finding 2
                                      was filed by nobody because it is about the
                                      filing.
                                      1 is the caller nothing asserts -
                                      /mavci-core:ship called route.mjs with no
                                      --request, got `release_gate`, and stopped,
                                      on a request that routes to `plan`. Three
                                      checks read that line and none asked whether
                                      it was handed anything.
                                      2 is the claim-versus-state gap, in both
                                      directions on one day: a fix reported
                                      released as 0.1.24 that was never written to
                                      the repository, and two migrations reported
                                      applied that were not. Every layer verifies
                                      OUTPUT; nothing verifies either party's
                                      REPORT, and the report is the input to the
                                      next decision. No assertion is proposed,
                                      and the record says why.

    0.1.29-the-step-after-the-only-door.md
                                      system repo, plugin 0.1.28, 2026-09-04.
                                      Finding 22. --cut was the only door to a
                                      tag and everything after the tag existed
                                      was advice: it can cut in the marketplace
                                      clone, which propagation resets, and the
                                      push can answer "Everything up-to-date"
                                      and send nothing - neither visible from
                                      the other. The push and the release watch
                                      both moved inside the gate.
                                      Two things worth reading for themselves:
                                      ATOMICITY - every arm up to the push
                                      leaves the tag on origin or no tag at all,
                                      so a failure is retryable and nobody has
                                      to work out where the tag is; and the
                                      BOUND - ten minutes, after which a running
                                      job is UNKNOWN, exit 3, tag left standing.
                                      P12 is the entry worth reading twice: the
                                      refusal was placed ahead of --selftest, so
                                      an over-firing predicate took its own
                                      detector offline and the mutation reported
                                      nothing. That rule now lives in
                                      check-pretag.mjs above selftest(), because
                                      a lesson file in the right directory has
                                      already failed to bind once.

**Not indexed above: 0.1.25, 0.1.26 and 0.1.27.** Those files are in this
directory and their entries were never added. Named rather than left to be
inferred from a gap - an index that is silently partial is read as complete.

## Why this copy was manual

`/mavci-core:retro` — the command whose whole job is to carry a finding out of a
project and into this repository — did not exist when these were written. That
absence is itself Finding 4 in the second file, and it is why the first file ends
on the sentence that governs this directory:

> They survived because an agent thought to. That is not a channel; that is luck
> with good manners.

`/mavci-core:retro` ships in 0.1.12. The next promotion is a command, not a `cp`.
