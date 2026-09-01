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

    00-degenerate-pass          authored   pass          both sites clear; nothing to find
    01-chatbot-cross-tenant     EXTERNAL   fail          .eq("id", companyId) from an
                                                         unauthenticated request body
    02-undetermined-cross-file  authored   undetermined  origin not determinable from the
                                                         code available

## How a run is scored

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
