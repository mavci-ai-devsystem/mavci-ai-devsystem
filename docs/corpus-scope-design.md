# Corpus scope - design for gate6 finding 10

Status: DESIGN. Nothing here is built. Written before implementation at the
operator's instruction.

Finding: `.mavci/lessons/pending-system-change.md` in gate6, finding 10, with its
2026-09-04 addendum on the park.

---

## 1. The question, and the architecture's answer

> Does `--emit` take a path scope, or does staging tell it what to enumerate?

**Staging tells it.** Not an argument.

This is not a preference. The architecture decided this exact question once
already, for this exact fact, in this exact file, and wrote down why.
`worklist.mjs:88-110`, above `stageIsActive`:

> THE ONE PLACE THIS IS DECIDED, and it is derived rather than declared. An
> argument the dispatcher has to remember to pass is an argument the dispatcher
> will one day forget, and the failure would be silent in the direction that
> matters - a corpus record counted as project evidence.

And `openTicket` at `worklist.mjs:131` derives `source` from `stageIsActive(root)`,
with the note that the `SubagentStop` writer copies it and does not re-derive,
"so there is one answer per run and no way for two derivations to disagree."

*Is a corpus case staged right now* is therefore already a single derived fact
with one writer. The scope of the enumeration is a **consequence of that same
fact** - it is not a second question that happens to have a similar answer.

## 2. Why a path argument is the wrong mechanism, stated as the failure it produces

A `--scope` argument would put a second answer to "is this a corpus run" in a
different party's hands (the dispatcher's) at a different moment (emit, before
the ticket). Two writers for one fact. Both disagreements are live:

- **Scope passed, stage empty.** A worklist over an empty directory:
  `sites_total 0` - which `worklist.mjs:156` already says in its own words is
  "NOT a pass ... more likely to mean the scan is not seeing sites than that the
  project has none". `openTicket` then records `source: real`, because the stage
  is empty. A corpus-shaped run recorded as project evidence, which is the
  precise failure `stageIsActive`'s comment says it exists to prevent.
- **Scope omitted, stage active.** Finding 10, unchanged. The argument mechanism
  does not remove the defect; it makes removing it the caller's option.

This is the failure shape this repository has recorded more often than any
other - 0.1.23 section 3, the phase written by two writers and diverging on the
first real project; 0.1.26 section 2, the spec snapshot path *derived* from the
hash rather than stored, because "a second name for one fact is what drifts".

## 3. The operator's test: "only one survives a project that stages nothing"

It does not survive, and the unstaged project is where it fails worst.

**Derived.** `stageIsActive` is false, `ctx.files` is unfiltered, `--emit`
behaves exactly as it does today. Nothing is added to the ordinary path: no
argument, no default, no branch a caller can get wrong.
`skills/guardian/SKILL.md:46` runs `--emit` bare and stays correct with no edit.
The fix is invisible to every project that never runs a corpus.

**Argument.** On an unstaged project a scope **narrows a real guardian run**, and
narrows it silently: fewer sites enumerated, full coverage over the smaller list,
a clean verdict, `source: real`, and `release-check.mjs` accepts it as project
evidence. A green record about a question nobody asked, arriving through the
sanctioned path. That is invariant 5 - a failed probe is never reported as a
pass - inverted, with the flag doing the inverting.

So the argument mechanism has a value for which it reports a silent pass on the
common case. The derived mechanism has no such value, because there is no
argument to hold one.

## 4. The fair objection to the derived mechanism, and why it does not stand

**Objection:** making enumeration conditional on a directory's contents means a
leftover `corpus-run/` - an interrupted stage, a `--clear` that never ran -
silently narrows every real run afterwards.

**Answer: that hazard is already taken, and it is already loud.** `stageIsActive`
already treats any non-empty `corpus-run/` as a corpus run, so a leftover stage
*already* stamps every subsequent record `source: corpus`, and `release-check.mjs`
already refuses a corpus record as project evidence (0.1.21 finding 25). The
standards checker also already reports staged code as a visible exemption -
`rules/index.mjs:1154`, whose remedy names `corpus-stage.mjs --clear`.

The fix adds no new silent class. It makes one already-detected fact govern both
what is enumerated and what the record claims to be about, which is strictly
better than having it govern only the second. The degradation moves in the safe
direction: today a leftover stage yields a **wide** worklist labelled corpus and
refused at the gate; after the fix a **narrow** worklist labelled corpus and
refused at the gate, by the same arm. What changes is the site count, not whether
anybody notices.

## 5. The seam, and why both halves of the scan must move together

`ctx.files` is the single seam. `ctxFor` builds it from `walk(root)`
(`worklist.mjs:28`); `scanProject` iterates it (`lib/sitescan.mjs:375`) and
`discoverAdminFactories` iterates it (`lib/sitescan.mjs:182`). Filtering
`ctx.files` in `ctxFor` therefore scopes enumeration and admin-factory discovery
in one place, with no second decision.

**Scoping both is required, not incidental.** gate6 finding 6 records that
`discoverAdminFactories` attributes admin identity per MODULE. Leaving discovery
project-wide while scoping enumeration would let the host's factory - the
scaffold's `createAdminClient`, say - decide whether a staged fixture's client is
service-role. That is finding 10's contamination arriving through the other half
of the scan, and it would be harder to see because the site count would look
right.

The cases need nothing from the host: each is self-contained and ships its own
`lib/supabase.ts.txt` (`templates/corpus/cases/*/lib/`). Verified, not assumed.

## 6. Filter the list; do not re-root

Do not implement this as `emitWorklist(abs(root, CORPUS_STAGE_DIR))`. Re-rooting
would emit `app/api/workspaces/route.ts` where the expectations declare
`corpus-run/app/api/workspaces/route.ts`, and would move `readOrNull`'s base.
Paths stay project-relative POSIX (state-format rule 7), the expectations already
are, and the only thing that changes is which entries of `ctx.files` survive.

`scan.residue` follows automatically, since it is computed inside `scanProject`
from the same list. **The consequence must be stated rather than inherited:**
during a corpus run the residue check no longer covers the host's code. That is
correct - the host is not what is being graded - and it means a corpus run is not
also a residue check on the project. One line in the README, because the README
currently overclaims in the other direction: the Layout section at
`templates/corpus/README.md:208` says `corpus-run/` is "the only tree the scanner
sees", which is the sentence finding 10 proves false and which this fix makes
true for the first time. It should not silently become correct - the note beside
it should say it was aspirational until this release.

## 7. What `--emit` must print

Every run, pass or fail, names which tree it enumerated: the whole project, or
`corpus-run/` only because a case is staged. 0.1.14 - a gate that does not name
what it did not check asserts more than it verified; 0.1.22 - the interpreter is
named on every run.

It also splits the `sites_total is 0` message, which currently has one
explanation for two causes. Unstaged, zero means the scan is probably not seeing
sites. Staged, zero means the stage is empty or the case did not copy. Naming the
wrong one is the `--reseal` trap (0.1.21 finding 24) and the pattern 0.1.30
section 3 generalises: a check that detects a condition tends to prescribe the
tool that produced it.

## 8. The assertion, and the broken build it must catch

All of it in `check-corpus-score.mjs`. That is where the `sites_total` guard's
coverage already lives, and the finding requires both halves in one file so a
scoping fix cannot pass while leaving the message wrong. No new check file -
0.1.26: a fifth file asserting the same three components would be a second list.

**Fixture: a host project WITH its own service-role site**, not a case with the
wrong count. The existing adjacent assertion covers the guard, and the guard
fires correctly here - a correct refusal is indistinguishable from a correct
refusal for the wrong reason, which is why the host is the fixture.

- **A1.** Host has its own site; case `q3v7k` staged; the enumerated
  `sites_total` equals the expectation's 2 and the case scores. **Demonstrated
  failing first** against today's unfiltered `emitWorklist`: this is gate6 as it
  stands - `app/api/activity/route.ts:46` present, worklist 3, expectation 2,
  `CannotScore`.
- **A2.** A genuine mis-stage still refuses, with the existing message. Otherwise
  the fix silences the guard rather than fixing what feeds it.
- **A3.** An UNSTAGED project still enumerates the whole tree, host site included.

A3 is not optional and it is not covered by A1 or A2. Without it, a scope that
always narrows satisfies both - which is 0.1.26's E6 pairing exactly: a gate that
always refuses satisfies the refusal case alone, and only the permission half
separates them. Section 3's whole argument is that the unstaged path is where the
damage is silent, so it is the path that gets its own assertion.

Mutation list to run, each expected to redden a named assertion alone: revert the
filter (A1); scope enumeration but not `discoverAdminFactories` (A1, via a
misclassified fixture client); scope unconditionally, ignoring `stageIsActive`
(A3 only); re-root instead of filtering (A1, on the joined site paths).

## 9. What this does NOT fix, named rather than implied

- **The stale-worklist residual from the addendum.** A scoped emit removes the
  structural route - it never enumerates a host site, so no question about a host
  site can outlive the tree it was asked about - but a worklist emitted over the
  stage and re-dispatched after the stage changes is still stale, and
  `SCORED_FIELDS = ['verdict', 'fail_reason', 'origin']` does not compare
  `reason_if_unknown`, so the field carrying the true cause is not read by the
  scorer at all. Unchanged by this work.
- **What a green corpus is evidence about.** Scoping lets a mature project HOST
  the run. It does not widen what the run establishes: the corpus grades guardian
  on fixtures, and a green corpus recorded on a project says nothing about that
  project's own sites. Finding 10's closing sentence asks for this to be stated
  in the README's residuals section; it is not stated there today.
- **Nothing here measures guardian.** `doctor` still FAILs every project until a
  corpus result exists. This removes the bind that made the demanded run
  impossible on any project mature enough to need it; it does not perform one.
