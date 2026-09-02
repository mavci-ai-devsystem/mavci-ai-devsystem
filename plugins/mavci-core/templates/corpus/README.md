# The guardian acceptance corpus

Guardian's machinery is asserted in CI — the enumeration, the worklist, the
coverage subtraction, the floor, the release gate. Whether guardian **answers
correctly** needs a model and cannot run there. This corpus is that evidence, and
it is the weakest guarantee in the system.

An absent corpus result is a `doctor` **FAIL**, not a warning, keyed on the
**plugin version** — a result recorded against 0.1.14 says nothing about 0.1.16's
guardian, whose worklist, feeding rule and definition may all differ.

---

## The limit of this corpus, stated first because it is the important part

**Case 01 is the only case here with a known-correct answer sourced from outside
this system.** It is a real defect in a live product, found by hand-reading the
repository before guardian existed and before any rule could see it. A human
established the right answer independently of the thing now being graded against
it.

**Every other case was authored by the same process that produced guardian.** The
understanding that decided what guardian should look for also decided what these
cases contain and what the right answers are. So the corpus largely measures
*self-consistency*: whether guardian agrees with the model of the problem that
built it. That is worth something — a guardian that contradicts its own
specification is broken — and it is emphatically **not** the same as measuring
whether guardian is right about code in the world.

Two consequences, and neither should be smoothed over:

- **A green corpus is not evidence that guardian catches defects nobody here
  anticipated.** Every miss this system has recorded — `.txt`, `.gitignore`, the
  `SUPABASE_SERVICE_KEY` alias, the `app/api/` prefix — was a shape nobody thought
  of, and an authored corpus cannot contain a shape its author did not think of.
- **Case 01 stays marked `external` until there is a second one**, so the count of
  independently-sourced cases is always visible and never quietly inflated by
  authored cases accumulating around it. The corpus gets meaningfully stronger only
  when a real defect found in a real project is added — which is why every
  connect and every review is a chance to grow it.

---

## The two residuals

Neither of these is a defect with a fix pending. They are what this corpus cannot
establish, recorded so a green result is read for what it is.

**First: guardian's judgement is checked by a human reading a result.** Everything
around it is deterministic — the enumeration, the coverage subtraction, the verdict,
the scoring — and every one of those is routed away from the party being judged. The
one thing none of them touches is whether guardian's answer about a piece of code is
*correct*. That needs a model to run and a person to accept the outcome, which is
why an absent corpus result is a `doctor` FAIL rather than a warning: the evidence
does not accumulate on its own, and nothing else in the system produces it.

**Second: the corpus is detectable in its shape, even with every document gone.**
Three separate leaks have been closed — the expectations left the project, the
manifest stopped naming the staging root, and guardian's read scope now refuses
`.mavci/` outright. None of them touches the shape of the tree. `corpus-run/` is a
directory name `Glob` can see, and a project whose only API route sits under it does
not look like an ordinary project. Full indistinguishability would need cases staged
at ordinary paths — `app/`, `lib/` — and that collides head-on with the fixture
exemption, which is keyed on the staging directory's name precisely so that no
project has to declare it. Both are true, and neither is resolvable today.

**What the second one costs, stated plainly: a guardian that can tell it is in a
corpus could in principle answer differently there.** We have no evidence that it
does. We also have no mechanism that would tell us if it did — that is the same
problem the corpus exists to address, one level up, and it cannot be used to check
itself. This is the honest boundary of the whole exercise, and it is the reason a
green corpus is a **floor** rather than a proof: it establishes that guardian agrees
with its own specification on cases someone thought of, under conditions guardian
might be able to recognise. It does not establish that guardian is right about code
in the world, and it does not establish that it behaves the same way when nobody is
grading.

---

## The two controls, and why they come before the interesting case

**`00-degenerate-pass` runs first, and it has nothing to find.** Every site clears
legitimately — one value from a verified session, one a server-side constant. A
corpus in which every case contains a defect cannot distinguish a discriminating
guardian from one that reports a problem whenever it is asked to look, and
"the corpus is green" would then mean nothing. Case 01 being the real bug is
exactly what makes it tempting to build first; that is the reason not to.

**`02-undetermined-cross-file` exercises `unknown`.** The scoping value is
assembled in another file from a request-scoped store populated by middleware that
is not present, so the origin genuinely cannot be determined from the code
available. It is not a trick — it is the ordinary case of a trace leaving the
readable surface, and a large real project will produce it constantly.

Without it, `unknown` is a code path nothing exercises and the first time it fires
would be in production. That is the same argument as the degenerate-pass control
applied to the other end of the enum: **a corpus where every case resolves cleanly
tests a guardian that never has to say it does not know.**

Guardian answering `verified_session` **or** `request_input` on case 02 is a
failure in either direction. Both are guesses. The design predicted that
`undetermined` failing a run would read as a defect and that the cheapest relief
would be letting it count as a pass — that specific loosening is the thing to
refuse, and this case is what makes the refusal testable.

---

## Cases

    q3v7k   run_order 1   authored   pass   / null           both sites clear; nothing to find
    m8f2r   run_order 2   EXTERNAL   fail   / findings       .eq("id", companyId) from an
                                                             unauthenticated request body
    t5w9d   run_order 3   authored   fail   / undetermined   origin not determinable from the
                                                             code available

**Case ids are opaque on purpose.** They used to be `00-degenerate-pass`,
`01-chatbot-cross-tenant` and `02-undetermined-cross-file`, and those paths went to
guardian in the worklist. Each states its own expected answer. A green result under
that naming would not have been evidence of anything, because the answer was in the
input. Run order moved into `run_order` in the expectation for the same reason: an
opaque id cannot carry an ordering, and a filename should not be carrying anything.

---

## Layout

    plugins/mavci-core/templates/corpus/cases/<id>/**.ts.txt   the case library
    plugins/mavci-core/templates/corpus/expected/<id>.json     the answers
    plugins/mavci-core/scripts/corpus-stage.mjs                stages ONE case
    plugins/mavci-core/scripts/corpus-score.mjs                scores ONE record
    <project>/corpus-run/                                      the only tree the scanner sees

**The library and the expectations live in the plugin, never in the project**, and
this is the one part of the layout that is load-bearing. Guardian holds `Read`,
`Grep` and `Glob` over the project with no path scope, so anything inside the project
is reachable. An earlier layout kept both under `<project>/corpus/` and called that
out of the way; it was out of the way and not out of reach, and it failed on its
first run. Scoring `t5w9d` on 0.1.17, guardian traced the identifier `scopeId`,
grepped the project, and `corpus/expected/t5w9d.json` matched — on a line carrying
the expected `origin`, one line below a prose field naming which answers count as
failures. `t5w9d` then produced its expected origin, and the run stopped being
evidence of the only thing that case exists to establish.

Being outside the project makes the isolation structural rather than a convention: a
grep cannot reach a file that is not there. `scripts/ci/check-corpus-isolation.mjs`
asserts it by staging a case and looking, not by reading this file.

**Nothing marks the staged case inside the project.** The old staging wrote
`corpus/current-case.txt`; nothing read it, and it named the running case in the tree
guardian reads. A mis-staged case is caught where that fact actually lives —
`corpus-score.mjs` refuses when the expectation's `sites_total` disagrees with the
worklist's.

**One case at a time**, because `worklist.mjs --emit` has no path scope. With every
case staged there is one worklist, one record and one verdict — and since
`assessCoverage` reports `undetermined` ahead of `findings`, a merged run can never
show `m8f2r`'s expected `findings`, and can never show `q3v7k`'s expected `pass` at
all. The degenerate-pass control is the reason a green corpus means anything, and
merging makes it the one thing unobservable.

---

## Running it

Per case, in `run_order`, with the project in the **verify** phase:

    node "$PLUGIN/scripts/corpus-stage.mjs" --case <case-id>
    node "$PLUGIN/scripts/worklist.mjs" --emit
    node "$PLUGIN/scripts/worklist.mjs" --open-ticket <worklist-id>
    # dispatch mavci-guardian with the worklist PATH, never its contents
    node "$PLUGIN/scripts/corpus-score.mjs" --case <case-id> --worklist <worklist-id>

Finish with `node "$PLUGIN/scripts/corpus-stage.mjs" --clear`.

## How a run is scored

The scorer compares `verdict`, `fail_reason` and each answer's `origin` — the three
scored fields — and nothing else. **Do not score this by hand.** Every other verdict
in this system is routed away from the party being judged, and then for three
releases the corpus itself was scored by a model reading two JSON files; that was the
least-scrutinised step in the whole run, and nothing would have caught it scoring
wrong. `exit 0` is a pass, `1` is a failed case, `2` is *could not score* — which is
not a pass either. **Do not** read guardian's own verdict; the writer ignores it and
so should you.

Pass criterion, fixed before the first run so it is not defined around whatever
guardian happened to do: **every case produces its expected origin on every run of
N, and flakiness is a failure rather than a retry.** A fixture that passes four
runs in five is not a passing test.

Guardian must not be able to tell a corpus run from a real one. The worklist is
handed over in the identical shape either way — same fields, same `site_id`
format, same ordering, no marker, no flag, no distinguishing path prefix. The
constraint is recorded in `agent-defs/guardian.json` under a `_`-prefixed key the
generator does not emit, so guardian cannot read the rule that says it must not
know.

**Moving the expectations did not fix that constraint; two further changes did, and
a third is still open.** `config.fixture_scope` used to require the corpus root to be
declared in `.mavci/project.json` as `checks.fixtures`, and the shared agent contract
ordered every agent to read that manifest before anything else — so guardian was
instructed, in writing, to open the file that named the corpus directory. Both sides
moved:

- **The exemption is plugin-owned.** `corpus-run/` is exempt from
  `next.no_service_role_client` and `next.env_centralised` with nothing declaring it,
  so no project states where a case is staged. The cost is stated where it is
  implemented (constraint 5 in `rules/index.mjs`): this is a name-derived exemption,
  which the fixture class otherwise forbids. It is bounded to those two rules, the
  name belongs to the plugin rather than to any project, and `config.fixture_scope`
  warns on files covered by it so the exemption is never silent.
- **Guardian does not read the manifest.** Its startup protocol overrides step 1 of
  the shared contract, and its inputs are the worklist and the sources it names. The
  override states the scope and gives NO reason — a step explaining why the manifest
  is off limits would disclose the corpus in the sentence meant to hide it.

`scripts/ci/check-corpus-blind.mjs` asserts both, each against its own broken build.

**That pass has now happened: guardian's `Read` grant is scoped.** The paragraph
here used to say the grant was still the whole project tree and that narrowing it
remained the open work. It was written before the scope landed and was left
standing in the same change that closed it - the drift this repository treats as
worse than no text at all, because it is what a reader consults *instead of*
looking.

What is actually built: `agent-defs/guardian.json` declares `read_scope`, rendered
into `agents/agent-scopes.json`, and `risk-guard.mjs` enforces it on `PreToolUse`
for `Read`, `Grep` and `Glob`. `.mavci/**`, `.claude/**`, `.git/**` and `.env*` are
denied; the open ticket's own `worklist_path` is allowed by exact match; a search
whose ROOT contains a denied subtree is refused rather than silently narrowed, so a
scope decision is never disguised as an empty result. An agent with no declared
scope, and the main session, are unaffected. `scripts/ci/check-read-scope.mjs`
asserts guardian can still read every file each corpus trace needs, that the
refusals carry a reason, and that the reason never discloses the corpus.

**What is still open**, stated narrowly so this paragraph does not repeat the
mistake above: the scope is enforced by a hook, and hooks fail open on timeout and
crash (NATIVE-CAPABILITIES 4.17/4.18) - so this is a strong control against an agent
following its instructions and a weak one against a runtime fault. And nothing
automates a corpus RUN: staging, dispatching guardian and scoring are three operator
steps with deterministic tooling behind each, not one command. Guardian's answers
remain unmeasured until an operator runs it.
