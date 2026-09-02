# Phase 2 — `mavci-guardian` and `mavci-scribe`: design

**Status:** design only. No code, no schema edits, nothing built.
**Date:** 2026-09-01 · **Against:** v0.1.14 · **Companion to:** `ARCHITECTURE.md` §1,
`ROADMAP.md` Phase 2, `docs/lessons/pending-system-change-0.1.15.md` findings 9, 11, 17.

This document argues guardian from evidence that already exists in two real
repositories, not from the roster line that reserved a slot for it. Where the
roster's justification still holds it is confirmed and cited; where the evidence
contradicts it, the roster is wrong and it is said so.

---

## 0. The evidence this is built on

Two repositories were read before connecting them — `ProToolHub` and
`AI-Chatbot-Widget-SaaS`. That read produced seventeen system findings, queued in
`docs/lessons/pending-system-change-0.1.15.md`. Three of them are load-bearing here:

- **Finding 9** — no rule looks for a route that returns data with no auth check.
  One live production instance.
- **Finding 11** — the rule set checks file properties; nothing checks what a route
  does. Widens 9 from a missing rule to a missing category.
- **Finding 17** — the filter-presence question is a rule; the filter-provenance
  question is not, and cannot be made one under invariant 1.

Finding 17 closes with the sentence this design starts from: *"Phase 2 should
design guardian around cases it was handed rather than cases we imagined."*

---

## 1. What guardian is for

### 1.1 The roster's argument, and why it is not good enough

`ARCHITECTURE` §1 justifies guardian as: *"Multi-tenant isolation, RLS correctness,
Stripe webhook idempotency, KVKK and ToS completeness, ad-policy. A miss here is a
data breach, a legal exposure, or a payment bug."*

That is a **topic list**, and a topic list is not a boundary. Every item on it
overlaps something that already exists: `supabase.rls_enabled` claims RLS,
`stripe.webhook_signature` claims webhooks, `legal.kvkk_structure` claims KVKK.
Justifying an opus agent by naming topics the checker already names produces an
agent that re-runs the checker in prose, which is the most expensive way to learn
nothing. The boundary has to be drawn on **the shape of the question**, not the
subject matter.

### 1.2 The evidence: thirteen rules met a live multi-tenant SaaS and found none of its three real defects

`AI-Chatbot-Widget-SaaS`, reviewed by hand across a 821/748-line four-month
uncommitted diff plus `HEAD`. The checker produced **25 findings**. None of them
was any of these:

**Defect 1 — an unauthenticated route resolving its tenant as "most recent
signup."** The handler selects a company with `.order('created_at').limit(1)` and
proceeds to attach a caller-supplied Telegram bot token to it, and to open a Stripe
checkout for it. Every literal in that line is ordinary. `.order` is what a listing
does; `.limit(1)` is what a lookup does. Nothing distinguishes *the newest row in a
list I am showing you* from *the tenant this request now belongs to* except what the
value is subsequently used for. The defect exists in the relationship between two
statements, and a rule that reads one file for one token cannot see a relationship.

**Defect 2 — an unauthenticated endpoint returning tenant ids.** A debug route
returning tenant ids, names, the Supabase URL and which credential variables are
set. To flag it, a checker must know what is *in the response body* and that no
caller identity was established before it was assembled. Both are properties of the
handler's behaviour. `next.route_force_dynamic` asks whether a file contains an
export. There is no export whose presence or absence distinguishes a health check
from a tenant directory.

**Defect 3 — a metering control deleted end to end.** `FREE_MESSAGE_LIMIT` and
every `message_count` read and write, removed, with no replacement. This is the
sharpest of the three, because it is the one a rule is not merely bad at but
**structurally incapable of**: a rule set can only check for the presence of things
it was told to expect. Nothing in `project.json` declares that this product meters
free messages. There is no `check_id` whose fixture is "the control that used to be
here." A deterministic checker cannot flag an absence nobody declared, and declaring
every control in advance is the prose-standards failure the brief already rules out.

All three were found by **reading**, in one read-only afternoon.

### 1.3 The class statement

The thirteen rules answer questions **decidable from one file with no model of what
the code does**: does this path exist, does this file contain this token, does this
document match this schema. That is why they are cheap, deterministic, safe to run
on every turn, and safe to block a turn on. They are load-bearing and nothing here
reduces them.

Guardian answers the questions that survive that filter. There are exactly three
shapes, and each has a real instance above:

1. **Provenance** — where does this value come from, and is its origin trusted?
   (Defect 1; §2 of this document.) Requires following an identifier backwards.
2. **Purpose** — what does this handler do with what it read, and what leaves the
   process? (Defect 2.) Requires reading a whole function and classifying its
   output, not matching a token.
3. **Absence relative to intent** — was a control removed, and is anything left
   standing in its place? (Defect 3.) Requires holding a model of what the product
   is supposed to enforce, which only a reader can construct.

Stated in one line: **a rule decides a property of a file; guardian decides a
property of a behaviour, and behaviours are not spelled out in any single file.**

That formulation is what makes guardian's scope refusable. "Is this SQL injectable"
is a guardian question. "Does this route export `force-dynamic`" is not, and if
guardian is ever asked it, the answer is to write a rule.

### 1.4 Where the line is — the honest half

This is the section that has to survive contact with a green guardian report, so it
is stated before any of the mechanism.

1. **Guardian is not deterministic, so it must never block a turn.** Two runs on
   one tree may differ. A nondeterministic blocker is the risk-guard false-positive
   lesson (0.1.12 item 5) with higher stakes: a control that fires wrongly and often
   trains everyone to turn it off, and the documented escape is a bypass flag.
   Guardian reports; the deterministic layer blocks.

2. **A guardian pass is not evidence of absence.** It is evidence that a named set
   of questions was asked about a named set of files. That is why the record carries
   **coverage as data** (§4.4) and not merely a verdict — "reviewed 11 of 11 sites
   in 8 files; did not read `lib/**`" is a claim that can be checked. "Pass" is not.

3. **Guardian reads code, and code is not the system.** It cannot say RLS is
   enabled — that is a property of a database, and a migrations directory describes
   intent (finding 16). It cannot say an environment variable is set in the deploy
   target. Any guardian sentence that asserts a runtime fact is out of contract.

4. **Guardian's own miss rate is unknown and unmeasurable from inside.** Its first
   pass over this same repository missed defect 2's scope and had to be corrected
   (finding 9's numbering note). The mitigation is an external corpus (§5.5), not a
   claim of thoroughness.

5. **Guardian does not replace `/security-review`.** ARCHITECTURE §1.2 already
   records the overlap as near-total. Guardian is the *scoped, recorded, tenancy-
   aware* half; the bundled command remains the broad sweep. Guardian's record must
   not be read as having run one.

6. **Where a question becomes cheaply decidable, it leaves guardian.** Finding 17's
   filter-presence rule is exactly this: it was a guardian question until the
   manifest named `tenant_column`, and then it became a rule. Guardian's scope
   shrinks over time by design, and any question that stays in guardian for two
   releases without a rule attempt is a question nobody has tried hard enough to
   make cheap.

---

## 2. The first concrete task: provenance

### 2.1 The case, quoted

`app/api/chat/route.ts` at `HEAD` — what Vercel builds, therefore what is live:

    "Access-Control-Allow-Origin": "*"          // any origin
    const companyId = body.companyId?.trim();   // from the request body
    // no session, no token, no origin check
    getSupabaseAdminClient()                    // service role - bypasses RLS
      .select("id, name, system_prompt, knowledge_base, plan, message_count, ...")
      .eq("id", companyId)

The tenant ids are public by design: the widget reads `companyId` from its own
script URL, so every customer's id is in the page source of every site embedding the
widget.

**The filter is present.** `.eq("id", companyId)` is exactly what a correct handler
looks like. The proposed rule `supabase.service_role_query_scoped` passes it, and
must pass it — finding 17 requires a fixture asserting that this exact code produces
**zero** findings from that rule, and requires the rule's own `description` to say
it checks presence and not provenance, because a rule quietly believed to cover
provenance converts an unchecked property into a green tick.

Guardian is the second half.

### 2.2 Why provenance cannot be a rule here

Recorded in finding 17 and not re-argued: it needs a real parser; `lib/jsscan.mjs`
says of itself *"Not a parser. It only needs to know where code is not"*; a real
parser means `typescript` / `@babel/parser` / `acorn` + a TS-JSX plugin, which
breaks **invariant 1** and with it the escape hatch that `selftest.yml` proves;
and an intra-procedural approximation would cover this codebase and silently stop
following the moment an id passes through a helper. A checker that silently stops
following is worse than one that never claimed to.

### 2.3 The worklist — guardian does not choose what to read

**This is the single most important mechanism in the design**, and it is what makes
guardian affordable, bounded, and — critically — *auditable by arithmetic*.

Guardian is not pointed at a repository. It is handed a **worklist** produced by the
deterministic layer, in the same run that produces the verdict:

    worklist id            guardian-<iso8601>
    produced by            verify.mjs, from supabase.service_role_query_scoped
    reviewed_ref           the commit sha
    tree_state             clean | dirty        (findings 12 and 14)
    sites[]                { path, line, table, predicate_column, value_identifier }

One entry per admin-client builder chain that **already carries a tenant predicate**
— the ones the presence rule passed. Those are precisely the sites where the cheap
layer has nothing left to say and the expensive question begins.

Three consequences, each doing real work:

- **Guardian's input is finite and enumerated before it starts.** Its cost is
  proportional to a number a script computed, not to repository size.
- **Coverage is decidable without judgement.** `sites_answered` versus
  `sites_total` is arithmetic, computed by something that is not guardian. §5.4.
- **The scope of the question is set by the manifest, not by the agent.** Finding
  17's `tenancy.isolation` split decides whether this runs at all, and the rule
  written there governs: *a declaration of weaker enforcement turns on MORE
  checking, never less.* `isolation: 'application-filters'` means there is no
  database backstop behind a missing filter, so provenance review becomes
  **mandatory** on that project rather than skipped.

### 2.4 The answer form

For each site, guardian answers one closed-enum question — *where does
`value_identifier` come from?*

    verified-session    read from a validated session/JWT/auth helper on this request
    verified-token      a signed token verified in this handler before use
    server-derived      a constant, an env value, or a value read from the DB using
                        an already-verified identity
    request-supplied    body, query string, path segment, or an unvalidated header
    undetermined        the trace leaves the handler and guardian did not resolve it

Plus: `evidence` (≤500 chars, path and line, per format constraint 8), and the
`authority` of any remedy (`agent` | `operator` | `external`, per 0.1.12 item 6).

Two rules on this enum, both of which will be under pressure:

- **`undetermined` is not a pass.** Invariant 5: a failed probe is never reported as
  a pass. An `undetermined` site makes the run's verdict `fail` with reason
  `coverage_incomplete`. It is *not* the same as `request-supplied` and the report
  must never merge them — one is a defect, the other is an unanswered question, and
  collapsing them is how a review starts producing findings it cannot support.
- **The verdict enum stays `{pass, fail}`.** The locked format (constraint 4) does
  not have `incomplete`, and this design deliberately does not widen it. An
  incomplete review is a failed review.

### 2.5 Cost per invocation

Method, so the number can be corrected rather than argued about. Take
`AI-Chatbot-Widget-SaaS` as the worked case: ~20 API routes, of which the presence
rule would flag roughly 12 sites across 8 handler files.

    agent contract + role                      ~4k
    two standards packs                        ~4k
    project.json + state.json + worklist       ~1k
    8 handler files @ ~1.5k                    ~12k
    auth helpers / middleware they reference   ~3k
    ---------------------------------------------
    input                                      ~24k
    output (12 site answers + coverage)        ~3k

So **≈25–30k tokens on opus, one call, a few minutes of wall clock** — roughly one
architect planning call, on a project of this size.

**And this number is the one I least believe.** §7 prediction 4: the trace that
leaves the handler is what sets the real cost, and it is unbounded in principle. The
budget must be enforced by the worklist and by a read ceiling, with guardian
returning `undetermined` rather than reading further — which means the honest
failure mode of a large project is a **failing** guardian run on healthy code. That
is correct behaviour and it will be experienced as a defect.

### 2.6 What guardian must refuse to do on this task

- **Not re-run the presence rule.** If a site has no tenant predicate at all, that
  is `supabase.service_role_query_scoped`'s finding and guardian must not restate
  it. Finding 11's assertion 1: each behavioural rule reports its own defect and no
  other reports it; a component that fires on everything is pattern-matching again.
- **Not propose a fix.** Same reason the verifier does not (`verifier.json`: *"your
  guess would anchor it"*), doubled by the fact that guardian cannot apply one.
- **Not count.** Finding 11: *do not assert a total finding count.* 0.1.14 already
  produced 25 on this codebase and the number looked healthy the entire time.

---

## 3. When guardian runs

### 3.1 The roster's claim

`ARCHITECTURE` §1: *"Runs once per release."* The tier justification for opus rests
on that volume, and on nothing else.

### 3.2 Confirmed — the volume argument holds, and §2.3 strengthens it

Nothing found here pushes guardian toward higher frequency. The worklist bounds
each invocation to a set the cheap layer already enumerated, so per-invocation cost
is stable rather than growing with the repository. Opus at this volume remains
correct and is confirmed.

### 3.3 What changed — one trigger was missing, and it is the one that found everything in this document

The roster's *"once per release, once per new project"* undersells the second half
by making it sound like scaffolding hygiene. The provenance note on the 0.1.15 queue
is blunt about it: reading two real repositories before connecting them is *"the
cheapest audit in the system and had never been run."* It cost one afternoon and
produced four mechanism defects, one class finding, one channel gap, a live session
cookie jar in a public repo, and a live multi-tenant SaaS whose RLS rule was
returning green without inspecting anything.

**So connect-time is not a lesser trigger than release-time; on the existing-repo
path it is the more valuable one**, because that is the moment a codebase with four
months of unreviewed history first meets the system. `ROADMAP` already says the
existing-repo path *"is the one that matters for all six real projects."*

### 3.4 The trigger set

    1. /mavci-core:connect         after the manifest exists and the first verify
                                   run has produced a worklist. Its findings become
                                   the project's opening debt, not a blocker.
    2. /mavci-core:release         mandatory. /release REFUSES on an absent, stale,
                                   or failing guardian record. This is the same
                                   half of fail-closed that /release already owes
                                   for control/unverified.json (ROADMAP Phase 2).
    3. /mavci-core:guard           on demand, operator-invoked, main session.

**Deliberately absent: a per-turn or per-edit trigger.** But staleness is *not*
absent, and the distinction is the design:

    invocation is expensive and rare
    staleness bookkeeping is cheap and continuous

When any file named in the last worklist changes, the control plane records that the
guardian record no longer describes the tree. That costs one path comparison in a
hook that already runs; guardian is not invoked. `/release` then refuses on a stale
record exactly as it refuses on an absent one. A guardian pass is bound to
`reviewed_ref` **and** `tree_state`, so a pass taken on a dirty tree, or on a sha
that is no longer `HEAD`, is not a pass — findings 12 and 14, where every number in
a report described the working tree while CI checked `HEAD`.

---

## 4. What guardian can and cannot edit; the verdict; who acts

### 4.1 The honest constraint table

**REVISED after §4.2's probe.** Guardian does not copy `mavci-verifier`'s grant. It
takes `disallowedTools: ["Edit", "Write", "NotebookEdit"]`,
`edit_scope: { allow: [], deny: ["**"] }`, `native_constraint: true` — **and no
`Bash`**, which is what changes the table below from the verifier's.

| Boundary | Enforced by | Survives `disableAllHooks`? |
|---|---|---|
| Cannot `Edit`/`Write`/`NotebookEdit` | native — the tools are absent from context | **yes** |
| Cannot write app code **by any route** | native — no `Bash`, so no shell, so no write path exists | **yes** |
| Cannot write `.mavci/control/**` | native — as above; it never reaches the writer at all | **yes** |
| Cannot forge or suppress its own record | structural — the `SubagentStop` handler writes it, guardian only emits text | **yes** |
| Phase gate (`verify` / release only) | `risk-guard.mjs` only | **no** |

Only the phase gate is hook-only, and it governs *when guardian may be invoked*
rather than what it can reach. Every containment boundary on guardian's own reach is
native. For contrast, the same table for `mavci-verifier` — which needs `Bash` to run
`tsc`, the build and the tests — has *"cannot write app code"* at `risk-guard.mjs`
target matching and **no**, and that difference is the deliberate asymmetry recorded
in `ARCHITECTURE` §1.1.

### 4.2 The Bash grant — REVISITED, and the answer is: guardian should not have it

The original text read *"Guardian has `Bash`, because it must run `git`,
`grep`-shaped reads, and the sanctioned writer."* Two of those three do not survive
being asked directly.

    git reads       -> not needed. The worklist is ENUMERATED BY THE PRESENCE RULE
                       and handed to guardian with `reviewed_ref` already resolved
                       (§2.3). Guardian never chooses what to read, so it never
                       needs to ask git what changed.
    grep-shaped     -> not needed. `Read`, `Grep` and `Glob` cover reading files it
                       was pointed at, which is the whole of its input.
    the writer      -> the only real one. §4.3.

**And dropping `Bash` makes §4.3's two required properties stronger, not weaker.**
If guardian returns its report as its final message and a `SubagentStop` hook
invokes the privileged writer, then guardian cannot forge a record — it never
touches the writer at all — and it cannot silently fail to file one, because the
hook fires whatever guardian did and the ticket stays open if no parseable report
came back. That is §2.3's argument applied to the write channel: **the expensive
component must not be the only witness to its own output.**

The prize is worth naming. Guardian is the most capable model in the roster, it is
the one component whose judgement nothing deterministic can check, and dropping one
tool moves it from *"weakest enforced containment"* to *natively contained on the
write side* — `Read, Grep, Glob`, no filesystem write path of any kind, surviving
`disableAllHooks`. That is the strongest write guarantee this system can give any
agent, and guardian is the agent that most needs it.

> **Superseded in part.** This section said *fully* natively contained, and that was
> true when it was written. Guardian's **reads** are now scoped by `risk-guard.mjs`
> so that the acceptance corpus can be run against an agent that is prevented from
> opening the manifest rather than merely asked not to. Reads are therefore
> hook-enforced and `disableAllHooks` removes them. The trade is recorded in
> `agent-defs/guardian.json` under `_note_tools` and in ARCHITECTURE 1.1.

**PROBE RUN 2026-09-01. VERIFIED — guardian ships with no `Bash`.** The
documentation was loaded rather than recalled, on the same evidence class as
4.5/4.6, and it settles this outright (NATIVE-CAPABILITIES **4.23**):

> *"Hooks that need the final assistant text of the current turn should use
> `last_assistant_message` on Stop and SubagentStop instead of reading the
> transcript"*

`SubagentStop` also carries `agent_id` and `agent_type`, so the handler can tell
**which** subagent stopped — required, because the event fires for every subagent,
not only guardian.

**The probe was worth running for the opposite reason to the one expected.** It did
not merely confirm the plan; it replaced the mechanism. The draft above proposed
reading `transcript_path`, and the same sentence documents that as the **wrong**
channel: the transcript *"is written asynchronously and may lag the in-memory
conversation, so it may not yet include the current turn's most recent messages
when a hook fires."* A verdict writer built on it would have worked most of the
time and silently recorded nothing the rest — an intermittent, invisible failure in
the component whose whole purpose is to be the witness guardian cannot be. That is
the 4.5 nested-`stopReason` defect one step from shipping, and one documentation
load stopped it.

**So the grant is settled:**

    mavci-guardian   tools: Read, Grep, Glob
                     disallowedTools: Edit, Write, NotebookEdit
                     NO Bash. No filesystem write path of any kind.

Guardian becomes the only agent with **no write path of any kind** — write
containment that survives `disableAllHooks`, on the most capable model, in the one
component whose judgement nothing deterministic can check. (It was *"the only fully
natively contained agent"* until its reads were scoped by a hook; see the note
above and ARCHITECTURE 1.1.) `mavci-verifier` keeps
`Bash` because it genuinely needs it (it runs `tsc`, the build and the tests), and
that asymmetry is now correct rather than accidental: the agent that must execute
things holds the weaker containment, and the agent that only reads and reasons
holds the stronger one.

One thing deliberately left unverified: whether `transcript_path` on `SubagentStop`
resolves to the subagent's transcript or the parent's. It no longer matters, and
guessing it would add an unsupported claim to a row that is otherwise quotation.

What follows describes the **fallback that is no longer taken for guardian**, and
is what remains true today of `mavci-verifier`, which does need `Bash`: `disallowedTools: Edit` does not stop `node -e` from writing a
file. `risk-guard.mjs`'s 0.1.12 rewrite matches the **write target** rather than the
command text, and an unrecognised command with an unquoted control path, or any
interpreter doing arbitrary I/O, is refused — so the control plane is held. App code
is held only by the hook, and only while hooks are on.

**This is worth saying loudly because ARCHITECTURE §1's roster table marks guardian
"No (natively enforced)" in the *App code?* column, and §1.1 marks it "Same" as the
verifier.** Both are true about `Edit`, and both read as if guardian is fully
contained. It is not — it is the most capable model in the roster holding the
weakest *enforced* containment story, and §1.1 exists precisely because a previous
revision made this class of overclaim. That correction is owed to §1.1 when guardian
ships, whether or not anything else in this design survives review.

### 4.3 The write channel

**Guardian has no write path at all — not `Write`, not `Bash`.** It returns its
report as its final assistant message. The `SubagentStop` handler reads that message
from `last_assistant_message` (4.23), checks `agent_type` to confirm it was guardian
and not some other subagent, and invokes the privileged writer itself:

    hooks.json  SubagentStop -> node scripts/guardian-record.mjs
                (reads last_assistant_message from the hook payload on stdin)

which schema-validates, redacts (`redactDeep`), stamps `project_id`,
`plugin_version` and `run_at`, allocates the id, and writes atomically.

**This inverts the `retro.mjs --record` precedent, and the inversion is the point.**
0.1.12's rule is *a reporting channel an agent cannot reach is the trap* — retro
needed `--record` reachable by an agent because the agent is the only one who knows
what happened. Guardian is the opposite case: **the channel does not need to be
reachable by guardian, because the hook fires whether or not guardian cooperates.**
Making it agent-reachable would only add a way for guardian to influence its own
record. So `guardian-record.mjs` is invoked by the runtime, not by the agent, and
nothing in `AGENT_OK` grants access to it. Anything that would *resolve* a guardian
finding — accepting it, exempting a route into `checks.public_routes` — stays
`PRIVILEGED` and operator-only.

The two required properties are now structural rather than enforced:

- **Guardian cannot forge a record.** Not "is denied by the guard" — it has no
  mechanism. It emits text; something else decides what becomes a record.
- **Guardian cannot silently fail to file one.** The handler runs on every
  `SubagentStop`. If the final message is missing, unparseable, or fails schema
  validation, the writer rejects loudly and the ticket stays open (§5.3). Guardian
  returning nothing is indistinguishable, to the ticket, from guardian never
  running — which is the correct treatment and is what §5.2 item 3 requires.

### 4.3a The degenerate case, and its control — written before the happy path

`SubagentStop` fires for **every** subagent in the session. The handler must key on
`agent_type`/`agent_id` to know that guardian stopped, and not some unrelated
`Explore` or `general-purpose` run.

**The failure to design against is the empty guardian record that reads as a clean
pass.** It is this component's degenerate case, exactly as the always-passing corpus
is prediction 2b's: a record exists, it is schema-valid, `verdict: pass`, and
nothing was examined. Everything downstream — `doctor`, `/release`, the operator —
treats a present passing record as evidence, and a green tick produced by a
component that never ran is worse than an absent record, because absence is already
a FAIL (§5.2 item 1) and a false pass is silence.

Four ways it can be produced, all of them cheap accidents:

    another subagent stops        -> handler fires, no guardian report, writes an empty record
    guardian returns prose        -> unparseable, writer coerces rather than rejects
    guardian returns valid JSON
      with an empty sites[]       -> schema-valid, coverage 0/0, arithmetic passes trivially
    worklist itself was empty     -> nothing to answer, so nothing unanswered

**The controls, and they are written and watched failing before the handler works
at all:**

1. **`agent_type` mismatch writes nothing** — not an empty record, nothing. Assert
   with a fixture payload from a different subagent; the assertion is *no file
   created*, not *a record marked skipped*.
2. **An unparseable or schema-invalid final message is a LOUD rejection**, leaving
   the ticket open (§5.3). Never a coerced default. This is the v0.1.2 zero-hooks
   shape — a silent rejection that looks like success.
3. **`sites_total === 0` is `not_checked`, never `pass`.** Finding 5's rule applied
   to guardian's own output: a probe with nothing to probe is not a passing probe.
   Coverage arithmetic that divides by zero and reports 100% is the specific defect.
4. **`sites_answered < sites_total` fails the run**, and the failure names the
   unanswered sites. This is §5.4, and it is the assertion prediction 2a exists for:
   a writer that records `sites_answered` without comparing it against `sites_total`
   is the fifteen-times shape.

Control 3 is the one most likely to be omitted, because an empty worklist looks like
good news. It is the same sentence as `supabase.rls_enabled` returning green over
zero `CREATE TABLE`s, and the same sentence as a corpus that always passes: **the
absence of findings and the absence of examination are different facts, and only one
of them is a pass.**

### 4.4 The record

`.mavci/control/guardian/<id>.json`, write-once, sealed, one file per entity
(format constraint 6). Not the verdict schema — a guardian record is a different
entity and reusing `verdict.schema.json` would put non-deterministic judgements into
the file CI treats as the deterministic audit trail.

    schema_version, project_id, plugin_version, run_at        format constraints 1,2,3,12
    reviewed_ref            commit sha
    tree_state              clean | dirty
    worklist_id             which enumerated question set this answers
    trigger                 connect | release | manual
    verdict                 pass | fail                        locked enum, no third value
    fail_reason             findings | coverage_incomplete | null
    coverage                { sites_total, sites_answered, files_read[] }
    sites[]                 { path, line, value_identifier,
                              origin <closed enum, 2.4>,
                              evidence <=500, authority, remedy <=300 }

`files_read[]` matters more than it looks: it is the difference between *"guardian
found nothing"* and *"guardian did not look there"*, and §1.4 item 2 is unenforceable
without it.

### 4.5 Who acts

The verdict is a **verdict, not a fix**, and each finding names who can act on it —
0.1.12 item 6, which exists because a remedy only the operator can perform, written
as if the reader could perform it, is an instruction to fabricate.

    origin: request-supplied, route is genuinely private
      -> authority: agent      builder fixes it, in the build phase, as a task.
                               Guardian's finding becomes the spec input; guardian
                               does not write the task.
    origin: request-supplied, route is intentionally public
      -> authority: operator   the operator adds it to checks.public_routes.
                               An agent that can exempt itself has no constraint.
    origin: undetermined
      -> authority: operator   read it yourself, or raise the read ceiling. Not a
                               finding about the code; a finding about the review.
    the rule set could not have caught this class
      -> authority: operator   /mavci-core:retro --record, which is the channel that
                               already exists for "the fix is in the system".

Guardian's own report is the agent-report JSON block (§4 of `_contract.md`) with
`status: "done" | "failed" | "blocked" | "escalated"`. The *record* is the durable
artefact; the report is the turn's summary. They must agree, and §5.3 is what makes
disagreement visible instead of silent.

### 4.6 What the verdict is not

It is not a clearance, and the record must say so in shipped text, not here.
Finding 11's assertion 2: **the boundary sentence is present in the verdict output;
assert the text.** It is flagged there as *"the assertion most likely to be dropped
as cosmetic, and the one that stops a green run being read as a clearance."* The
same sentence belongs in `doctor`'s guardian line and in the connect report: this
review answers provenance questions on an enumerated set of database call sites; it
is not a security audit, and a pass is not one.

---

## 5. The Phase 2 assertion, applied to guardian

> **Kill the component, and assert the operator is told within one turn, by
> something that is not the component.** — `ROADMAP` Phase 2

Guardian is the hardest case for this in the whole system, for the reason Phase 2
already states: its entire value is a judgement about whether something is safe,
which means it will be trusted exactly when it is least able to say it is broken.

### 5.1 The five ways guardian breaks

    1  never invoked          skill missing, agent unregistered, /release forgets
    2  invoked, dies          crash, timeout, empty turn, model refusal
    3  invoked, files garbage report rejected by the writer's schema
    4  invoked, answers few   3 of 12 sites, verdict pass
    5  invoked, answers all,  well-formed, complete, and WRONG
       and is wrong

### 5.2 The witnesses, none of which is guardian

    1  ->  check-command-refs.mjs at build time (a /mavci-core:guard reference with
           no skill fails the build, and has since 0.1.12);
           at runtime: absent record -> doctor FAIL + /release refuses.
           ABSENCE IS A FAIL, NEVER A PASS. (Phase 2 constraint.)
    2  ->  the open ticket, seen by the SubagentStop gate. §5.3.
    3  ->  the writer rejects, LOUDLY, and the ticket stays open -> as 2.
           A silent rejection here is the v0.1.2 zero-hooks failure again.
    4  ->  coverage arithmetic. §5.4. No judgement required.
    5  ->  nothing at runtime. §5.5.

### 5.3 The open-ticket protocol

Guardian's invocation is not "an agent was asked nicely." It is bracketed:

1. Before guardian is spawned, the deterministic layer writes the worklist **and**
   `control/guardian/pending-<id>.json` — an open ticket naming `reviewed_ref`,
   `tree_state` and `sites_total`.
2. Guardian runs. Submitting an accepted record closes the ticket.
3. `gate.mjs`, already registered on `SubagentStop` and `Stop`, finds the open
   ticket at turn end and reports it — **on the delivery path 0.1.11 proved**:
   `{"decision":"block","reason":detail}` on stdout *and* `detail` on stderr before
   `exit 2`, so the reason actually reaches the agent by either carrier.

The ticket is what converts *"guardian said nothing"* — which is indistinguishable
from success in a chat transcript — into a fact a script can see.

**It blocks once, then lets the turn end and marks the session UNVERIFIED.** This
reuses 0.1.12 item 2 rather than inventing a second fail-closed mechanism: an
endlessly-blocking gate on a guardian that will never succeed is the loop where
`GATE_MAX_CONTINUES` becomes the exit path for every real problem. Fail-closed then
moves to the ship gate — `doctor` FAILs and `/release` refuses — which is precisely
the arrangement `ROADMAP` Phase 2 already commits `/release` to for
`control/unverified.json`. Guardian does not need a new one, and must not get one.
The counter keys on the **fault signature**, not `prompt_id` (0.1.12's ceiling that
could never be reached).

### 5.4 Coverage arithmetic — the witness that needs no judgement

Failure 4 is the dangerous one, because a partial review that reports `pass` looks
exactly like a thorough one, and this system has shipped that shape eleven times.

The worklist makes it decidable by subtraction. **The deterministic layer knows how
many questions it asked.** `sites_total` is written into the ticket by a script
before guardian starts; `sites_answered` comes back in the record; a record where
they differ, or where any site's `origin` is `undetermined`, is `verdict: "fail"`
with `fail_reason: "coverage_incomplete"` — computed by the writer at submission
time, **not by guardian**. Guardian cannot mark its own incomplete review as a pass,
because it is not the thing that decides.

That is `no component is the only witness to its own health`, made arithmetic rather
than aspirational.

### 5.5 The failure nothing at runtime can catch

Failure 5 — a complete, well-formed, wrong answer — has no runtime witness, and no
design should claim one. The only instrument is an **acceptance corpus**: real
defects from real repositories, with the expected answer recorded.

Case 1 is already handed to us and preserved with the code quoted, in
`docs/chatbot-widget-connect-plan.md` §0a:

    app/api/chat/route.ts    .eq("id", companyId)         filter present
                             companyId <- body.companyId  origin: request-supplied
                             expected: 1 finding, this site, this origin
    negative control         same handler, companyId from a verified session
                             expected: 0 findings

Plus the degenerate-pass control that finding 11 requires: a correct handler must
produce **zero**, or "flag every handler that touches the database" passes the
positive case.

**And here is the problem, stated rather than deferred: this test cannot run in
`selftest.yml`.** That workflow runs with Claude Code absent and nothing installed —
which is what makes the escape hatch (`ARCHITECTURE` §11) a passing test rather than
a promise, and it is invariant 1. Every other component in this system is tested by
a `node` script. Guardian cannot be. §7 prediction 2.

The arrangement that keeps it inside the Phase 2 constraint anyway: the corpus run
is an **operator-run gate step whose result is a control record**, carrying the
`plugin_version` it was run against; `doctor` FAILs when the recorded corpus result
is older than the running plugin version, exactly as `checkHookRegistration` already
FAILs on *"the registered hooks are from plugin X, not Y."* The witness is a
version comparison performed by `doctor`, which is not guardian. It is weaker than a
CI assertion and is recorded as weaker.

### 5.6 The kill test, concretely

Run in a connected project with a planted defect — **plant, predict, verify the rule
covers the path, then run** (0.1.10's method, which is the only reason the gate
inversion was ever found).

    kill      point the guardian agent at a role that returns an empty turn
    predict   SubagentStop gate blocks in the SAME turn, naming the open ticket,
              reason delivered by BOTH carriers
    then      turn ends; unverified.json stands; next SessionStart preflight FAILs;
              /release refuses

Four negative controls, each of which must fail **exactly one** assertion — the
0.1.11 two-carriers rule, because a test that passes on whichever brace happens to
win is how belt-and-braces decays into one belt and a decorative brace:

    remove the stderr write            -> only the stderr-delivery assertion fails
    have guardian file a record with
      sites_answered = 3 of 12         -> only the coverage assertion fails
    delete the ticket-writing step     -> only the open-ticket assertion fails
                                          (and this is the one that would ship,
                                          because everything else still looks fine)
    unwire doctor's staleness check    -> only the release-refusal assertion fails

**The assertion is that the operator is TOLD, and by name.** 0.1.13's rule: assert
that `doctor` **names** the file, not that it WARNs — "something is wrong somewhere"
passes against the broken build and against a build that counts without saying
which.

---

## 6. `mavci-scribe` — shorter, because it is

### 6.1 What it is for

Haiku. Changelogs, ADRs, task summaries, SEO copy, lesson drafts. `ARCHITECTURE` §1:
*"Mechanical, high-volume, low-stakes. The tier that makes the roster affordable."*
Confirmed — nothing found contradicts the tier. Scribe exists so that the opus and
sonnet agents never spend a token on prose that restates a record.

### 6.2 The real risk, which is not prose quality

Scribe's danger is not that it writes badly. It is that it writes **authoritative-
looking prose about system state it did not verify**. A changelog line reading
"added tenant isolation" is a claim about behaviour; a haiku agent is in no position
to make it, and once written it is read by everyone downstream as established.

The contract line that bounds this: **scribe may only restate facts that exist in a
machine-readable record** — a verdict, a control task record, a guardian record, a
git log, the diff. It may not assert a property of the system that no record
contains. When it needs one and has none, it reports `blocked` with `blocked_by`
naming the missing record, exactly as every other agent does.

This is the same shape as guardian's §4.6 boundary sentence and the same shape as
`legal.kvkk_structure`'s *"STRUCTURAL CHECK ONLY"*: the artefact must not imply a
claim nobody checked.

### 6.3 Write channel, and the one path that is not low-stakes

Scribe has `Edit`/`Write` for `docs/**`, `README.md`, `.mavci/lessons/**` and SEO
metadata — **hook-enforced only** (`ARCHITECTURE` §1.1). Under `disableAllHooks` it
can write application code. That is stated, not designed around; the operator
disabling hooks is a deliberate act.

**The lessons entry deserves a second look.** `.mavci/lessons/` is the retro
queue, and `/mavci-core:retro --apply` copies from it into the **system
repo** — the thing every downstream project is built from. A file dropped there by a
haiku agent is one operator command away from changing how every project is built.
0.1.13's finding is the reason this is not hypothetical: both readers of that queue
composed a fixed filename and could not see the file that was actually queued.

So: **scribe files lessons through `retro.mjs --record`, and does not write files
into `.mavci/lessons/` directly.** One writer for one fact. Two writers for one fact
is the failure this system has now found five times, and the sanctioned channel
already exists and is already agent-reachable by design.

### 6.4 The kill test for scribe

Lower stakes, so the witness is a release-gate check rather than a per-turn one, and
that is a deliberate proportionality call rather than an oversight:

    kill      scribe returns nothing
    told by   /release refuses: no changelog entry for this version.
              A script reads the changelog and the tag. Not scribe.
    absence   an unwritten summary is an ABSENT record, and absent is a FAIL.
              A task closing with no summary is visible in the control record,
              which scribe cannot write and therefore cannot fake.

Scribe's one genuinely dangerous failure is 6.2 — a confident false sentence — and
nothing detects that either. The mitigation is structural, not detective: if scribe
can only restate records, a false sentence requires a false record, and records are
written by `state.mjs`, which scribe cannot run privileged.

---

## 7. Predictions — what I expect to be harder than the roster made it sound

`ROADMAP` calls the deferred roster *"All additive — a YAML file, a `SKILL.md`, or a
rule function. None require rework of Phase 1."* Ranked by how wrong I think that is.

**1. Guardian is not additive. It is third in a chain of three, and the first two
are breaking changes.** It needs `supabase.service_role_query_scoped` (a rule that
does not exist) to produce its worklist, and it needs finding 17's
`tenancy.model`/`isolation` split to know whether to run — which is a breaking
schema change under `additionalProperties: false`, needing a migration or a
one-version allowance, and finding 17 says it should ride with the `active_task`
removal (carried-forward item 5). Guardian cannot be built first, and building the
schema split without guardian leaves a manifest field read by nothing —
`checks.public_routes` is already that, specified and wired to nothing.
*Falsified if:* a useful worklist can be produced without the manifest split.

**2. Guardian has two properties and only one of them needs a model. Assert them
separately.** The earlier framing — *guardian's behavioural test cannot live in CI* —
was true of the wrong noun. It is true of guardian's **judgement**. It is false of
guardian's **machinery**, and the machinery is where the failure modes this session
actually found live.

**2a. The deterministic half runs in CI, and must.** The worklist construction, the
coverage subtraction, the verdict schema, the staleness bookkeeping and the
`SubagentStop` witness are all `node` scripts with no model in the loop. They run
under `selftest.yml` with Claude Code absent and zero dependencies, exactly like
`check-gate.mjs` and `check-retro.mjs`. And they are the likely defect surface: **a
writer that records `sites_answered` without comparing it against `sites_total` is
the shape this system has hit fifteen times** — a mechanism present, correct-looking,
and never connected to the thing it claims to cover. That is a `check-guardian.mjs`
assertion, watched failing first, and there is no excuse for deferring it to a
corpus.

**2b. Whether guardian answers *correctly* needs a model and cannot run in CI.
Accept it.** No amount of scripting establishes that an opus agent traced a
provenance chain properly. That is an operator-run acceptance corpus.

**The move that keeps 2b from decaying into nothing: its ABSENCE is a failure, not a
silence.** `doctor` **FAILs** — not WARN — when no corpus result exists for the
installed plugin version, and prints the command that produces one. This is the same
construction as the hook receipt in 0.1.12: `control/hook-run.json` is an artefact
only a real run can produce, and doctor treats its absence as a fail rather than
inferring health from the scripts behaving. A corpus result is the same kind of
artefact, and version-keying it means a plugin bump invalidates the evidence rather
than inheriting it.

*Falsified if:* the deterministic half cannot be exercised without a model — which
would mean the worklist and the coverage arithmetic are entangled with judgement,
and §2.3's whole argument is wrong.

### The residual, named rather than papered over

Splitting the assertion does not remove the weak part; it isolates it, and the
isolated part must be stated plainly because everything around it is stronger:

> **Guardian's judgement is the only thing in this system whose correctness rests on
> a human looking at a corpus result and deciding it seems right.** Every other
> control here is verified by a deterministic check that fails on a broken build —
> the gate, the risk guard, the retro channel, the pre-tag gate, the placeholder
> scan. Guardian's machinery joins them. Guardian's answers do not, and cannot.

**This is the boundary of what the escape hatch covers.** `ARCHITECTURE` §11's claim
is that the system's guarantees survive Claude Code's absence, because the checker
is `node` scripts a stranger can run. That claim remains true of everything
deterministic and it is **false of guardian's findings** — with Claude Code absent,
guardian produces nothing, and the corpus that establishes it works cannot be run at
all. The escape hatch covers guardian's *plumbing* and not its *judgement*.

Two consequences worth carrying rather than discovering:

- **Do not let the corpus be graded by the thing it grades.** A future convenience —
  having an agent score the corpus run — closes the loop and destroys the only
  independent signal. The human read is the entire guarantee.
- **A corpus that always passes is indistinguishable from a corpus that is not
  discriminating.** It needs a degenerate-pass negative control: a run where guardian
  is fed a handler with no defect and must return clean, and a run where the planted
  defect is removed mid-corpus and the result must change. Without those, "corpus
  green" means nothing, which is invariant 5 arriving in the one place it cannot be
  checked automatically.

**3. Invariant 4 does not fit a nondeterministic component.** *"A new standard
requires a new check"*, with `fixtures/<check_id>/{bad,good}/` asserted in CI.
Guardian's findings are not `check_id`s in the deterministic set, and a fixture that
passes four runs in five is not a passing test. A pass criterion has to be defined
before the first corpus run — my proposal is *finds the planted defect on every run
of N, and flakiness is a failure, not a retry* — because defining it afterwards
means defining it around whatever guardian happened to do.
*Falsified if:* the corpus is stable across runs from the start.

**4. The cost estimate in §2.5 is low, and the correct behaviour will read as a
defect.** Provenance is cheap while the trace stays inside the handler and unbounded
the moment it does not. The read ceiling forces `undetermined`, `undetermined` fails
the run, and so a large healthy project produces a **failing** guardian verdict.
That is finding 17's closed-enum pressure arriving from a new direction: a state
with no honest value is pressure to write a false one, and the cheapest relief is to
let `undetermined` count as a pass. **That specific loosening is the thing to
refuse**, and predicting it here is most of the defence.

**5. CLOSED — `disallowedTools: Edit` was quoted as if it contained guardian, and it
does not.** Corrected in `ARCHITECTURE` ahead of guardian shipping rather than with
it, in five places: both roster rows now read *"No via `Edit`/`Write` (native);
**`Bash` hook-only**"*, §1.1's verifier and guardian rows name the `Bash` grant and
its consequence, §1.1 gained a paragraph stating that **`disallowedTools` constrains
the tools, not the agent** — an agent with `Bash` writes files with `node -e`, a
heredoc or a redirect — and §8's *"physically cannot change code"* is narrowed to the
file tools. What actually contains such an agent is `risk-guard.mjs`'s write-target
matching (0.1.12), which is a real control and **hook-only**; the tool grant and the
prompt merely narrow.

The correction was owed to `mavci-verifier` too, not only guardian: it ships today
with `tools: Read, Grep, Glob, Bash`, and §1.1 claimed it *"cannot modify anything,
including under `disableAllHooks`"*. That was false for the whole of Phase 1.

**6. Scribe's tier justification is about content, and its riskiest path is not
about content.** "Low-stakes" describes changelogs. It does not describe a write
path into the queue that `/mavci-core:retro --apply` promotes into the system repo.
§6.3 routes around it; if that routing is dropped as ceremony, a haiku agent has a
two-step path to every downstream project.

**7. Guardian and `/release` are mutually dependent and `ROADMAP` lists them as
separate bullets.** `/release` refuses on a stale or absent guardian record;
guardian's staleness has no consequence unless `/release` enforces it. Building
either alone ships half a control — and a half-enforced control is the shape this
system has spent five releases removing. They are one unit of work.

**8. The three defects in §1.2 are one project's worth of evidence.** Finding 11's
candidate list — a column written but never read, two routes handling one external
event, a route with no inbound reference — is drawn from the same repository. The
0.1.15 provenance note is explicit that the *second* repository is what turned a
list of defects into an axis. Guardian's scope should be re-read against the second
real project it meets, and I expect at least one of the three shapes in §1.3 to be
wrong or to need splitting.

---

## 8. Build order, and what must exist first

Nothing here is built. When it is, the order is forced by prediction 1, and by
0.1.12's rule that the escalation channel comes first:

    1  tenancy.model / isolation split + migration        (rides with active_task)
    2  supabase.service_role_query_scoped, with the
       description that says presence-not-provenance
       and the zero-findings fixture for the live bug
    3  the worklist + the open ticket + coverage
       arithmetic at the writer                           (§2.3, §5.3, §5.4)
    3b check-guardian.mjs — the DETERMINISTIC half, in
       selftest.yml: worklist construction, coverage
       subtraction, verdict schema, staleness, the
       SubagentStop witness. Watched failing first.       (prediction 2a)
    3c doctor FAILs on an absent corpus result for the
       installed plugin version, naming the command       (prediction 2b)
    4  the guardian agent def and skill
    5  /mavci-core:release, refusing on absent, stale,
       failing guardian records and on unverified.json
    6  the acceptance corpus, with the chatbot bug as
       case 1 and a degenerate-pass negative control
    7  scribe

Steps 3, 3b, 3c and 5 are guardian's witnesses. **They are built and watched failing before
step 4** — 3b is the CI half prediction 2a requires, and 3c is what stops the corpus
in step 6 from being optional, because a component whose whole job is judgement must not be the first
thing in its own stack that works — and because every assertion in this system that
was written after the thing it tests has, so far, passed against the broken build.
