<!-- ESCROWED by /mavci-core:retro --apply on 2026-09-06T14:15:57Z
     from project cartoonify, plugin 0.1.34, queued as .mavci/lessons/pending-system-change.md.
     THIS IS NOT AN APPLY. The system repository could not be located from this install,
     so the finding was written here to survive the project directory being deleted.
     It has NOT reached the repository that governs every project; carrying it there is
     still owed. Copied verbatim below this line; paths inside are relative to the
     project it was filed from. -->

# Queued for the next system release - apply with `/mavci-core:retro --apply`

Recorded: 2026-09-05, plugin 0.1.32, project cartoonify.

Each finding below was filed from inside a project, by whoever hit it, at the moment
they hit it. Nothing here is fixed. `/mavci-core:retro --apply` carries this file into
the system repository; only an operator can run that, and only an operator can delete
this file.

---

# Finding 1 - Product type is not declarable: architectural fields required of projects they do not describe

Filed: 2026-09-05T08:57:15Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `.mavci/project.json`

PRODUCT TYPE IS NOT DECLARABLE, SO ARCHITECTURAL FIELDS ARE REQUIRED OF PROJECTS THEY DO NOT DESCRIBE.

Context: cartoonify - a public image utility. No accounts, no tenants, no database, no
persistence. Upload -> server -> OpenAI images API -> response -> browser.

The manifest handled this BETTER than expected. tenancy.model/isolation split (finding 17)
means `isolation: "none"` is a first-class, documented value, tenant_column is optional, and
all four consumers gate on isolation correctly (rules/index.mjs:513, :980,
lib/release-gate.mjs:224, worklist.mjs:75). No value had to be invented. That part works.

Two places where it does not.

1. stack.ai enum is ["anthropic","none"]. There is no "openai". This product's entire
   function is an OpenAI call. The field is optional, so the only honest move is to omit it -
   the manifest then says nothing about the one dependency that matters, and env_sources
   carries OPENAI_API_KEY while stack says no AI. A closed vendor enum on a field describing
   an integration will be wrong for every provider not on the list, and the list is one long.

   THIS IS THE FORCED MISSTATEMENT, AND IT SURVIVES ONLY BY LUCK. Omitting stack.ai is the
   honest move for exactly one reason: the field is not in stack.required. Had it been
   required - and there is no principle in the schema that says an integration field should
   not be - this project could not have been initialised truthfully at all. Every available
   value would have been false, and the operator's only options would have been to declare
   "anthropic" for a product that calls OpenAI, or "none" for a product that is nothing but
   an AI call. The correct behaviour of the system in that case is to refuse, and it would
   not have refused; it would have accepted whichever falsehood was typed. The optionality
   of one field is the whole margin between a truthful manifest and an untruthful one, and
   nothing about the design makes that margin deliberate.

   The operator reports this as the same defect that stack.framework's enum produced on
   ProToolHub and Fida (not verified here - those projects were not inspected for this
   finding). Same mechanism, different field: a closed enum naming vendors, on a project
   that is otherwise a clean fit for the system. That is what makes it structural rather
   than a missing list entry. Adding "openai" to stack.ai closes this instance and leaves
   the class open - the next provider, the next framework, the next db reopens it. The
   generalisable fix is that vendor identity should not be a closed enum in a schema that
   validates architecture; { provider: string, key_env: string } states the same fact,
   admits any provider, and ties the declaration to env_sources where redact.mjs can use it.

2. stack.db is required, enum ["supabase-postgres","none"]. "none" is honest here and takes
   the correct doctor branch. But the pressure to declare supabase-postgres anyway (to look
   like a normal project) is a trap with teeth: doctor.mjs:1020 is the ONLY consumer of
   stack.db, and declaring supabase-postgres makes checkProtectedEnvironments demand a
   supabase_ref on every protected environment or FAIL. With no Supabase project there is no
   ref, so the only way to clear the FAIL is to invent a project ref - fabricating an
   infrastructure identifier to satisfy a check about protecting infrastructure that does not
   exist. Same shape as tenancy.isolation "application-filters" turning on a rule that hunts
   for filters that are not there: a check that cannot pass honestly is worse than a field
   that overstates.

SHAPE OF THE FIX, taken from the architecture rather than invented.

The system already works by conditional activation from a declared discriminator, everywhere
except schema.required: tenancy.isolation decides which isolation rules run,
compliance.required_pages decides which legal rules run, standards.packs decides which packs
run. Each is a value the project declares, and the machinery downstream adapts. schema.required
is the one place that is a universal floor instead - it asks every project the same questions
regardless of what the project is.

So: a `product_type` discriminator at the top of the manifest, in the same idiom -
e.g. "saas-multi-tenant" | "public-utility" | "internal-tool" - gating which fields are
required rather than requiring the SaaS set of everything. "public-utility" would not require
tenancy at all, and its absence would be a stronger statement than isolation:"none" because it
could not be misread as "tenants exist and are unseparated" (which is exactly the misreading
this project had to write an ADR to prevent).

That needs one enabling change: lib/schema.mjs validates a fixed keyword list
('type','enum','const','required','properties','additionalProperties','items','minItems',
'uniqueItems','pattern','minLength','maxLength','minimum','maximum','format','$ref') and has
no conditional construct. dependentRequired is the smallest addition that expresses this -
smaller than if/then/else and sufficient for a discriminator. Without it the schema cannot
say "required, given what this project is", which is why the floor is universal today.

Narrower fixes that stand alone if the above is too large:
  - open stack.ai, or replace the vendor enum with { provider: string, key_env: string }
  - make stack.db's doctor branch key on environments/supabase_ref presence rather than on
    the declared db value, so the declaration cannot create an unsatisfiable check
  - templates/scaffold is copied unconditionally by render.mjs:renderScaffold with no manifest
    awareness: a db:none project still receives lib/supabase/*, app/api/stripe/webhook,
    supabase/migrations, Supabase+Stripe+Resend deps in package.json, and a lib/env.ts whose
    z.object(...).parse(process.env) hard-requires five keys this product does not have and
    throws at boot. "Green from commit one" is not true for any project that is not
    multi-tenant SaaS.
  - compliance.entity requires five non-empty strings (render.mjs throws on empty), so a
    project with no registered legal entity cannot render at all. There is no drafted/
    unpublishable state for the identity block, though the legal TEXT has REVIEW REQUIRED.

ORDERING NOTE: this finding could not be filed when it was found. retro.mjs refuses with
"not a Mavci project: .mavci/project.json not found", so a finding about the manifest schema
obstructing project creation cannot be recorded until the manifest exists. Filed immediately
after state.mjs --init instead.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

### Addendum to finding 1 - Finding 15 is this finding from the other direction - the entry gap and the exit gap

Amended 2026-09-05T14:41:49Z, plugin 0.1.33. Amended by: **main-session** (agent). Provenance enforced at the risk guard, not self-declared. It attests to who RAN this command, and to nothing about who directed it.

CROSS-REFERENCE, added 2026-09-05 on plugin 0.1.33 from project cartoonify.

FINDING 15 IS THIS FINDING FROM THE OTHER DIRECTION, AND THE PAIR IS THE WORK.

This finding is the entry gap: architectural fields are required of projects they do not
describe, so a project outside the multi-tenant SaaS shape cannot be declared accurately on
the way in.

Finding 15 is the exit gap. cartoonify DID declare accurately - tenancy.model single-tenant,
tenancy.isolation none, stack.db none, stack.auth none - using the one value the mould
permits for a project with no tenants. The consequence is that doctor's guardian corpus
check FAILs permanently and unclearably, because the corpus needs a worklist, the worklist
emitter refuses on any isolation other than "application-filters", and the refusal is
correct. The only remedy reachable from inside the project is to edit that field to a value
that is false.

So the two findings close a loop: misdescribe on entry, or carry a permanent FAIL whose
cheapest cure is to misdescribe after the fact. A fix to declarability alone leaves the FAIL
standing on every legitimately "none" project. A fix to doctor's branch alone leaves this
finding untouched. Whoever applies either should read both.

Recorded here rather than only on 15 because a reader who arrives at this finding first
would otherwise fix half of it and see nothing to suggest the other half exists.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 1 - The stamp on this finding's addendum is false: main-session is not an agent and nothing enforced it

Amended 2026-09-06T13:28:56Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

ONE FALSELY STAMPED ADDENDUM IN THIS FINDING. It is:

  "Finding 15 is this finding from the other direction - the entry gap and the
   exit gap", Amended 2026-09-05T14:41:49Z, plugin 0.1.33,
   stamped: Amended by: **main-session** (agent).

WHY THE STAMP IS FALSE. It reads "Provenance enforced at the risk guard, not
self-declared." Nothing enforced it. The guard's comparison lives in
risk-guard.mjs and is gated on `agent_type`, which is present for a subagent and
ABSENT for the main session; a main-session caller therefore passes any value it
likes and the comparison never runs. Worse, `main-session` IS NOT AN AGENT:
agents/agent-scopes.json declares exactly five - mavci-architect, mavci-builder,
mavci-guardian, mavci-scribe, mavci-verifier. Had a subagent declared
`--agent main-session`, the guard would have DENIED it as "not itself". It was
not denied because there was no caller identity to compare against.

HOW TO READ THESE BLOCKS. Treat them exactly as if they said "Amended by: not
recorded ... Treat it as unattributed", which is what the other thirteen addenda
in this queue say and what these should have said. Specifically, the stamp is
NOT evidence that an agent authored the block, and NOT evidence that anything
verified who did. It is a string that was typed and echoed.

THE STAMPS ARE NOT EDITED, AND MUST NOT BE. This queue is append-only -
"no path here edits a filed byte" - and rewriting a stamp would erase the fact
that it was ever wrong, which is the same objection the queue raises against
replacing a filed sentence. This addendum is the correction; the bytes stay.

IDENTIFIED BY TITLE AND TIMESTAMP, NOT BY LINE NUMBER. Finding 24's addendum
cited line numbers, and they are already stale: amending finding 9 inserted text
inside an earlier block and shifted every line after it. In a file that appends
inside blocks, a line number is not an identifier.

Full analysis, both holes and the driven reproductions: finding 24.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 2 - .env.example is unmaintainable by an agent though it holds no secrets

Filed: 2026-09-05T08:57:41Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `.env.example`

.env.example IS UNMAINTAINABLE BY AN AGENT, IN BOTH DIRECTIONS, THOUGH IT HOLDS NO SECRETS.

Hit while adapting the rendered scaffold for a project whose only key is OPENAI_API_KEY.

The command was a WRITE. The rule that fired is a READ rule:

  risk-guard.mjs:1065
    /^(cat|head|tail|type|less|more|strings|xxd|od)\b[^|;]*\.env\b/
    -> deny('reading a .env file is tier 3. Secrets are never shown to an agent.')

  Verified:  "cat > .env.example <<EOF"  -> matches, denied
             "cat   .env.example"        -> matches, denied (correctly, if it were a secret)

The regex cannot tell `cat file` from `cat > file`, so writing the template is denied
with a message about reading secrets. The denial text is not merely imprecise, it is
false about the act it blocked - an operator reading the transcript is told an agent
tried to exfiltrate a secret when it tried to document a variable name.

The Write/Edit path is closed too, and by a different rule:

  risk-guard.mjs:749
    /^\.env(\.|$)/.test(path.basename(rel))
    -> ".env.example" matches, verified

So neither tool can touch it. Net effect on THIS project: render.mjs writes
.env.example as a subprocess (not a tool call, so unguarded), and it lands listing
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY and ANTHROPIC_API_KEY - seven
keys this project does not use - while omitting OPENAI_API_KEY, the only key it does.
The file is committed, is the first thing a new contributor copies to .env.local, and
is now actively wrong with no agent able to correct it.

WHY THIS IS NOT JUST A MISSING EXCEPTION. .env.example is secret-free BY CONSTRUCTION:
it is committed, it is the one .env* path .gitignore deliberately un-ignores
("!.env.example" in the scaffold's own .gitignore), and secrets.no_committed_secrets
already scans it as critical and cannot be waived or baselined. So the file that the
secrets checker guarantees is clean is the file the risk guard treats as a secret. Two
controls in the same system hold opposite beliefs about one path, and the stricter one
wins by accident of pattern order rather than by decision.

FIX, smallest first:
  1. Exempt the literal basename ".env.example" (and ".env.sample", ".env.template")
     at risk-guard.mjs:749 and in the command patterns. It is the path .gitignore
     already exempts, so the exemption is not a new judgement - it is the existing one,
     spelled in the second place that needs it.
  2. Split the command rule so a redirect INTO a path is classified as a write, not a
     read. `cat > x` and `cat x` are different acts and currently share a denial
     message that describes only one of them. Even where the denial is right, the
     reason given should match what happened.
  3. If .env.example is to stay guarded, then render.mjs should not be the only thing
     able to write it - a project whose keys change has no supported path to update
     the template, and the operator is not told that they must do it by hand.

OPERATOR ACTION REQUIRED ON THIS PROJECT: .env.example must be replaced by hand with
the OPENAI_API_KEY-only version. An agent cannot do it. Content supplied in the
session transcript.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

### Addendum to finding 2 - Write-once generation is the defect; the guard must learn direction

Amended 2026-09-05T09:20:17Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

The original finding framed this as a blocked write. That framing is too small, and the
half that generalises was left in the project's ADR instead of here. Correcting that.

THE ACTUAL DEFECT IS WRITE-ONCE GENERATION, NOT A BLOCKED WRITE.

`render.mjs` writes `.env.example` as a SUBPROCESS. A subprocess is not a tool call, so no
PreToolUse guard sees it. The file is therefore created unguarded — and from the instant it
exists, every path that could maintain it is closed: `risk-guard.mjs:1065` blocks the
`cat >` form, `risk-guard.mjs:749` blocks Write/Edit by basename.

So the system generates a file and immediately locks itself out of maintaining it. It is
correct on the day it is written and drifts from then on, with no mechanism to correct it.

A blocked write is an inconvenience. A write-once file that the generator cannot revisit is
a GUARANTEED DIVERGENCE — not a risk of one. Nothing in the system can notice the drift,
nothing can repair it, and the file's whole purpose is to tell a new contributor which
variables the project needs. It is the first thing anyone copies to `.env.local`.

Observed on cartoonify: rendered from the multi-tenant SaaS scaffold listing seven keys the
project does not use, omitting `OPENAI_API_KEY`, the only one it does. The operator fixed it
by hand. THE AGENT CANNOT EVEN CONFIRM THE FIX — reading the file is correctly tier 3, so
the repair is unverifiable from inside the system that caused the problem. Generation,
maintenance, and verification are all severed from each other on the same path.

THE FIX IS NOT WIDENING THE GUARD.

Stated plainly because it is the tempting fix and it is wrong. The regex cannot distinguish
`cat file` from `cat > file`. Loosening it enough to permit the write necessarily opens the
read it correctly blocks — and that read is a real control, not an accident. Trading a
genuine secret-read protection for the ability to edit a template is a bad trade, and an
exemption list of literal basenames (`.env.example`, `.env.sample`, `.env.template`) only
narrows the same trade without changing its shape: any file matching the basename rule is
still write-once, and the next generated-and-guarded file reopens the problem.

TWO REAL FIXES. THE SECOND IS THE ONE THAT GENERALISES.

1. Render `.env.example` from a source the guard permits. Keep the authoring surface at a
   path the guard has no opinion about — e.g. `templates/env.example.txt` maintained
   normally, with `render.mjs` as the only writer of the dotfile. Maintenance moves to a
   path an agent can touch; the dotfile stays guarded. This solves `.env.example` and only
   `.env.example`.

2. TEACH THE GUARD DIRECTION. This is the real fix. The guard currently classifies by PATH
   and by COMMAND SHAPE, and infers intent from neither. `cat x` and `cat > x` are opposite
   acts — one discloses the contents to the agent, one does not read them at all — and they
   are presently answered with one rule and one denial message that describes only the read.
   A guard that knows the direction of an operation can permit the write while still
   refusing the read, on the same path, with no exemption list and no widened pattern.

   The same defect reaches EVERY file the guard matches by basename, not just this one.
   Each is generated-then-frozen by the same mechanism, and each will be discovered
   separately, worked around locally, and re-encountered on the next project. Fixing
   direction fixes the class; fixing `.env.example` fixes one instance and leaves the class
   open.

A SMALLER POINT THAT STILL MATTERS. Even where the denial is correct, the message should
describe the act it blocked. `cat > .env.example` was refused with "reading a .env file is
tier 3. Secrets are never shown to an agent." An operator reading that transcript is told an
agent tried to read a secret when it tried to document a variable name. A denial that
misreports what happened corrupts the audit trail it exists to produce — and the transcript
is the artefact an operator uses to decide whether an agent is behaving.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 2 - Headline: divergence nothing can measure - generation, maintenance and verification all severed

Amended 2026-09-05T09:23:38Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

HEADLINE CORRECTION. The previous amendment buried its sharpest point in the middle of a
paragraph about maintenance. The operator moved it to the front, and it belongs there,
because it is one step past the claim the amendment leads with.

THE SYSTEM PRODUCED A FILE IT CAN NEITHER FIX NOR CHECK.

Generation, maintenance and verification are all severed on the same path:

  GENERATION     `render.mjs` writes `.env.example` as a SUBPROCESS. No PreToolUse guard
                 sees a subprocess, so the file is created unguarded.
  MAINTENANCE    From that instant, `risk-guard.mjs:1065` blocks the `cat >` form and
                 `risk-guard.mjs:749` blocks Write/Edit by basename. Nothing in the system
                 can change the file it just wrote.
  VERIFICATION   Reading it is correctly tier 3. So after the operator repairs it by hand,
                 the agent CANNOT CONFIRM THE REPAIR. Observed directly on cartoonify: the
                 attempt to read back the corrected key list was refused, correctly, by the
                 same control.

"Guaranteed divergence" was the previous framing and it is still true, but it understates
this. Divergence that something can measure is a bug with a detection path. THIS IS
DIVERGENCE NOTHING CAN MEASURE. There is no state of the system in which the drift becomes
visible to the system: not at render time (it is correct then), not later (nothing may read
it), not after a fix (nothing may confirm it). The file can only ever be checked by a human
who already knows what it should say — which is precisely the reader the file exists to
inform.

That is the argument for fixing it, and it is stronger than convenience. A control that
produces an unmeasurable state has stopped being a control over that state; it is only a
control over the agent's access to it. The secret-read protection is real and must stay.
What must change is that it currently also guarantees a blind spot, and the blind spot was
created by the system's own generator.

Everything below stands as written; the direction-aware-guard fix is still the one that
generalises, for the reasons given.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 3 - Router deadlock: a spec mentioning REVIEW REQUIRED is permanently classified as unwritten

Filed: 2026-09-05T09:10:27Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `.mavci/tasks/0001.md`

Check: `route.hasSpec`

ROUTER DEADLOCK: A SPEC THAT MENTIONS "REVIEW REQUIRED" IS PERMANENTLY CLASSIFIED AS UNWRITTEN.

Severity: this is an infinite loop in the orchestrator, not a warning. It was caught only
because /mavci-core:ship has a twelve-consultation ceiling.

WHAT HAPPENED. Task 0001, project cartoonify. The architect wrote a complete 19,976-byte
spec with 32 acceptance criteria to .mavci/tasks/0001.md. The router then answered:

  action: "plan", dispatch: "mavci-architect"
  why: "task 0001 has no spec at .mavci/tasks/0001.md."

The file exists, is non-empty, and is correct. Re-dispatching the architect would produce
the same spec and the same answer, indefinitely.

THE MECHANISM.

  route.mjs:86    export const REVIEW_MARKER = 'REVIEW REQUIRED';
  route.mjs:130   export function hasSpec(task, specText) {
  route.mjs:133     if (String(specText).includes(REVIEW_MARKER)) return false;  // watermarked, not written

It is an unanchored substring test over the ENTIRE spec body. The intent is sound - catch a
spec that is still a watermarked template. The implementation cannot tell a watermark from
a mention.

WHY THIS PROJECT COULD NOT AVOID IT. The same literal is the legal-page watermark:

  rules/index.mjs:597   const REVIEW_MARKER = /REVIEW REQUIRED/i;

legal.pages_present emits one warning per legal page still carrying it, and the correct
state of a freshly scaffolded project is five such warnings that MUST NOT be deleted -
removing one would make a page assert a legal review that never happened. So the spec's
first acceptance criterion is necessarily:

  "0 blocking findings, and exactly 5 warnings, every one of them a REVIEW REQUIRED legal
   marker on a scaffolded legal page."

A spec cannot state the project's own gate expectation without naming the marker, and
naming it makes the router discard the spec. THE TWO USES OF THIS STRING ARE IN DIRECT
CONFLICT: one says "this legal page is not reviewed", the other says "this spec is not
written". They share a literal and share nothing else.

THE CLASS, WHICH IS WIDER THAN THIS PROJECT. Any project declaring the legal-tr-kvkk pack
hits this the moment a spec discusses the legal pages, which is exactly when the spec is
doing its job. It is not specific to greenfield: it fires on any task whose criteria
reference the legal gate.

FIX, in order of preference.

  1. Make the two markers different strings. The spec watermark should be something a spec
     would never discuss - e.g. "<!-- MAVCI SPEC PLACEHOLDER -->" - rather than a phrase
     that is legitimate subject matter. A sentinel that can occur in real content is not a
     sentinel.
  2. Anchor the test. A watermarked spec carries the marker as its whole content or as a
     leading line; a real spec mentions it mid-body inside prose or a code span. Testing
     only the first N lines, or requiring the marker to be the entire trimmed body, would
     discriminate. `includes()` over 20 KB cannot.
  3. Have createTask stamp a spec stub with an explicit machine marker and have hasSpec
     test THAT, rather than inferring "unwritten" from natural-language content. The stub
     path is already special-cased two lines above (STUB_SPEC at route.mjs:131), so the
     mechanism exists and this case simply does not use it.

WHY THE FAILURE IS BAD BEYOND THE LOOP. The router is described in ship/SKILL.md as "a pure
function of the control plane ... asserted by check-route.mjs - which is the only reason it
is safe for you to follow it without re-deriving it." Here it is not a pure function of the
control plane: it is a function of the spec's PROSE. An orchestrator told never to second-
guess the router will re-dispatch the architect until it hits its ceiling, and the ceiling
message will name the wrong cause ("last action: plan"), because nothing in the answer says
the spec was rejected for its wording.

ALSO NOTE, SEPARATE AND SMALLER: there are two task records and the split is not obvious.
The architect wrote .mavci/tasks/0001.json with spec/title/artifacts/notes; the authoritative
control record is .mavci/control/tasks/0001.json and carries attempts/status/phase. The
router merges them, but an agent reading only one sees half the task. Worth documenting at
minimum.

WORKAROUND APPLIED ON THIS PROJECT: the architect was asked to rephrase the spec so the
literal two-word string does not appear, while still stating the criterion. This is a
workaround, it makes the spec read worse, and it is recorded in the spec itself so nobody
"corrects" the phrasing back and silently re-deadlocks the chain.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 4 - Spec review surfaces what criteria assert and is silent about what they require

Filed: 2026-09-05T09:37:53Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `.mavci/tasks/0001.md`

Check: `state.approve-spec`

THE SPEC REVIEW SURFACES WHAT CRITERIA ASSERT AND IS SILENT ABOUT WHAT THEY REQUIRE.

The approval gate is the one place the chain deliberately stops for a human. ship/SKILL.md
argues for it at length: "the question is not whether the mistake is recoverable - it is
whether the orchestrator is DECIDING WHAT TO BUILD." That reasoning is right and is not
what this finding disputes.

What the gate presents to the operator is the criteria's CLAIMS. What it never states is
their PRECONDITIONS. Those are different, and only one of them is a thing a human reading
prose can evaluate.

OBSERVED. Task 0001, cartoonify. 32 acceptance criteria, approved by the operator after
reading them. Of those 32:

  - criteria 11, 12, 13, 14, 15, 18 require a RUNNING HTTP SERVER and four FIXTURE FILES
    created OUTSIDE THE REPOSITORY ($TMPDIR)
  - criteria 20, 25, 29 require a BROWSER with a real viewport, not a shell
  - criterion 32 requires a LIVE API KEY (this one is marked - it is the only precondition
    the spec makes visible, and it is visible only because the operator had already raised
    the missing key as a constraint)

So 9 of 32 criteria need capabilities beyond "run a shell command in the repo", and the
spec's text says so for exactly one of them.

WHY THIS IS NOT THE ARCHITECT'S MISTAKE. The architect wrote checkable criteria and
audited them for FAILABILITY - it re-derived two (30 and 22) after checking them against a
hypothetical violating repo, which is more rigour than the format asks for. It had no
field in which to declare a precondition, and no convention telling it to. The one it did
declare (criterion 32) it invented ad hoc, in prose, in capital letters, because the
operator had made the missing key salient. Nothing would have made it do the same for
"needs a running server" or "needs to write outside the tree".

THE OPERATOR'S OWN WORDS, which are the finding: "I read 32 criteria and could not have
told you that six of them needed something the verifier cannot do."

WHY IT MATTERS, IN BOTH DIRECTIONS. This was noticed because mavci-verifier is scoped
`allow: [], deny: ["**"]` and the criteria need files created before they can run. Both
outcomes are bad and they are bad differently:

  IF THE $TMPDIR WRITE SUCCEEDS - the containment has a documented bypass that nobody
  decided to grant. Worse than an undiscovered one: it entered the system inside a spec
  the operator READ AND APPROVED, so the hole now carries an operator signature on a
  question that was never put to them. Ratified without being decided.

  IF IT FAILS - the criteria were unexecutable from the moment they were written, the
  architect could not tell, and the approval gate could not tell either. The one gate the
  chain stops at passed something it STRUCTURALLY CANNOT EVALUATE. A gate that reads what
  a human can judge and is silent about what only the machine knows.

Either way the same fix follows, which is why this is worth fixing before knowing which
way it lands.

THE FIX. The spec review has to surface what the criteria REQUIRE, not only what they
assert. Concretely: give each criterion a declared precondition set, and have the approval
surface print the aggregate before the operator decides. A small closed vocabulary is
enough to carry the whole weight -

  shell        a command in the repo working tree (the default; needs no declaration)
  server       a running application server
  browser      a real viewport / DOM
  network      an outbound call to a third party
  live-key     a credential the project does not have in CI
  write-outside-tree   creates state outside the repository

Then `--approve-spec` prints, e.g.:

  task 0001: 32 criteria
    22 shell
     6 server + write-outside-tree
     3 browser
     1 live-key   (declared non-blocking)
  6 criteria require writes outside the repository. The verifier's scope is
  allow: [], deny: ["**"]. Confirm that these are intended to run.

That is a sentence an operator can act on. "Read the acceptance criteria before approving"
is not, when the thing that matters is not in them.

SECOND-ORDER POINT, and the reason to treat this as structural rather than cosmetic: a
precondition the spec does not declare becomes a precondition the VERIFIER silently
substitutes around. It cannot create the fixture, so it reads the handler instead and
records "passing". The verdict is then a claim about inspection wearing the word the
system reserves for execution - and nothing downstream can tell the two apart. That is the
gate6 task 0002 failure ("execution evidence exists only from the builder agent"), and it
recurs here for the same reason: nothing in the pipeline ever states what executing a
criterion would have taken.

RELATED: finding 1 (product type is not declarable) and finding 3 (router deadlock) are
both instances of the same larger pattern - the system's declarations describe the SaaS
shape it was built for, and everything outside that shape is expressed by working around a
field rather than by declaring a fact.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 5 - Scaffold ships an npm run lint script with no eslint dependency, so it has never run

Filed: 2026-09-05T09:40:49Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `package.json`

THE SCAFFOLD SHIPS AN `npm run lint` SCRIPT WITH NO ESLINT DEPENDENCY, SO IT HAS NEVER RUN.

templates/scaffold/package.json:9

    "lint": "next lint",

and eslint is in neither `dependencies` nor `devDependencies`, and therefore not in the
generated lockfile either. Verified on a freshly rendered cartoonify:

    grep -c eslint package.json        -> 0
    grep -c eslint package-lock.json   -> 0
    ls node_modules/.bin/eslint        -> does not exist

    $ npm run lint
    > next lint
    ? How would you like to configure ESLint? https://nextjs.org/docs/basic-features/eslint
    > Strict (recommended)
      Base
      Cancel
    exit 1

IT DOES NOT FAIL CLEANLY - IT PROMPTS. `next lint` with no eslint config drops into an
INTERACTIVE WIZARD. On a terminal it exits 1 after drawing a menu. Given a stdin that stays
open it waits. An agent or a script that runs it without redirecting stdin can hang rather
than fail, and a hang is the worse failure because nothing reports it.

WHY IT SURVIVED THIS LONG. `.github/workflows/mavci-verify.yml` runs `npm ci` and
`npm run build`. It does not run `npm run lint`. So CI is green, the scaffold is described
as "green from commit one" (ARCHITECTURE 6.8), and the one script that cannot run is the
one nothing runs. The claim and the gap do not intersect until somebody writes an acceptance
criterion against the script the scaffold advertises - which is exactly what happened here.

THE COLLISION IT PRODUCED, which is the reason this is not cosmetic. On cartoonify task 0001
the architect wrote, in good faith, from the scripts the scaffold declares:

    criterion  4: `npm run lint` exits 0
    criterion 31: `git diff --exit-code -- package.json` exits 0 (no new dependencies)

THESE TWO CRITERIA CANNOT BOTH BE SATISFIED in a scaffolded project. Making lint run
requires adding eslint + eslint-config-next to devDependencies, which dirties package.json
and fails 31. Leaving package.json alone fails 4. The builder hit this on attempt 1 of 3,
correctly refused to resolve it by breaking the other criterion, and escalated. It was right
to. But note the cost: one of three attempts was consumed discovering a defect that predates
the task, and a rework cycle cannot fix it - there is no edit to application code that makes
both criteria pass.

An architect has no way to know this. It reads package.json, sees a `lint` script, and
writes a criterion asserting it exits 0 - which is the correct inference from a declared
script. The scaffold lies about its own capabilities and nothing in the system contradicts it.

FIX, and the first is the whole fix:

  1. Add eslint and eslint-config-next to templates/scaffold/package.json devDependencies,
     and ship a `.eslintrc.json` with `{ "extends": "next/core-web-vitals" }`. Then the
     declared script works and no criterion has to choose between two of them.

  2. Or remove the `lint` script from the scaffold. A script that cannot run is worse than
     an absent one: absent, nobody writes a criterion against it.

  3. Either way, add `npm run lint` to mavci-verify.yml, or the next script that stops
     working will survive exactly as long as this one did. A declared script that CI never
     invokes is an untested claim in the file every downstream project inherits.

  4. Consider a scaffold self-test that runs every script in package.json's `scripts` block
     on a freshly rendered project and asserts each exits 0. Three of the five (`build`,
     `typecheck`, `lint`) are checkable in seconds and one of them has been broken since the
     template was written. `dev` and `start` need a server and can be probed with a timeout.

RELATION TO OTHER FINDINGS. Same family as finding 1: the scaffold asserts things about a
project that are true for the shape it was built for and unverified for anything else. Here
it is not even shape-specific - `npm run lint` has never worked for ANY Mavci project, SaaS
or otherwise. The scaffold's correctness has been assumed rather than measured, and the one
place it is measured (CI) checks a strict subset of what it claims.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 6 - Recorded verdict cannot express acceptance-criteria results, so the router closes tasks whose spec is not satisfied

Filed: 2026-09-05T09:47:26Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Check: `verify.record`

THE RECORDED VERDICT CANNOT EXPRESS ACCEPTANCE-CRITERIA RESULTS, SO THE ROUTER CLOSES TASKS
WHOSE SPEC IS NOT SATISFIED.

This is the most serious finding of the cartoonify run. It is not a false positive or a
blocked command - it is the control plane recording, and then acting on, a statement that is
not true.

WHAT HAPPENED. Task 0001. The verifier ran, executed 29 of 32 acceptance criteria, and found
criterion 4 (`npm run lint` exits 0) genuinely and reproducibly FAILING. Its own overall
judgement, in its report, was:

    "my overall verdict on task 0001 is FAIL, with the single root cause being the
     criterion 4 / criterion 31 conflict"

The verdict it recorded says the opposite:

    .mavci/control/verdicts/0001-attempt-01.json
      verdict: "pass"
      checks:  5 entries, ALL check_id "legal.pages_present"
      acceptance-criterion entries: NONE

And the router, reading that:

    action: "document"
    why:    "task 0001 passed attempt 1."

Next steps would have been: dispatch the scribe, `--advance-phase 0001 --from verify --to
release`, `--task-status 0001 --status done`. A task with a failing acceptance criterion
would have been closed as done and handed to the release gate, and NOTHING DOWNSTREAM WOULD
HAVE KNOWN. I stopped the chain manually instead of running those steps.

THE MECHANISM. `verify.mjs --record` writes a verdict whose `checks[]` are STANDARDS-CHECKER
findings - the 11-15 rules in scripts/rules/index.mjs. The verdict schema has no field for
acceptance criteria at all. So:

  - the SPEC defines what "done" means for this task (32 criteria, operator-approved,
    content-hashed, and the hash is enforced by --advance-phase)
  - the VERDICT defines what the router and the release gate believe
  - and the two have NO CONNECTION

The spec's criteria are the thing the operator read and approved. They are also the only
thing in the system with no machine representation after approval. The approval hash proves
the operator approved THOSE criteria; nothing then checks that those criteria were met.

WHY THE VERIFIER IS NOT AT FAULT. It did its job well: it executed nearly everything,
distinguished executed from inspected without being asked twice, refused to fabricate a
browser observation it could not make, correctly skipped the operator-verified criterion,
independently confirmed the 4/31 conflict, and stated a FAIL verdict in plain words. It had
NO WAY to record that verdict. `verify.mjs --record` is the only writer it is permitted to
invoke, that writer emits gate findings, and the verifier is scoped `allow: [], deny: ["**"]`
so it cannot write a verdict file itself. IT REPORTED FAIL AND THE SYSTEM RECORDED PASS,
and the gap between those is not visible to anything except a human reading the prose.

THE SHAPE. A verdict that is a strict subset of the acceptance criteria will always be
MORE OPTIMISTIC than the truth, never less. Every criterion the gate does not cover is a
criterion that cannot fail the verdict. So the error is not random - IT IS BIASED TOWARDS
PASS, on exactly the criteria that are project-specific rather than standard, which are the
ones the operator spent their review on.

Note also that `verdict: "pass"` was recorded despite `checks[]` containing five entries each
with `"status": "fail"`. They are warnings, and warnings do not fail a verdict - which is
correct. But it means the artefact's own top-level word does not summarise its contents, and
a reader (human or router) who trusts `verdict` learns nothing about what was and was not
examined.

FIX.

  1. THE VERDICT MUST CARRY THE ACCEPTANCE CRITERIA. Give the verdict schema a
     `criteria[]` alongside `checks[]`: one entry per numbered criterion, with
     `{ id, status: pass|fail|skipped|not_run, mode: executed|inspected, evidence }`.
     `verdict: "pass"` requires every criterion `pass` or explicitly `skipped`, AND
     no blocking check. A criterion that is `not_run` must make the verdict
     `incomplete`, never `pass` - the unverified.schema.json precedent already exists
     for "enforcement did not run"; this is the same idea one level down.

  2. THE `mode` FIELD IS NOT DECORATION. It is what makes finding 4's problem visible:
     a criterion recorded as `inspected` is a criterion nobody executed, and the release
     gate should be able to say "3 of 32 criteria were never executed" instead of leaving
     that in prose. On this run criteria 20 and 29 were inspected-only (no browser tool)
     and criterion 32 was skipped by design - three facts that currently survive only in a
     subagent's message to its coordinator.

  3. THE VERIFIER NEEDS A WAY TO WRITE ITS VERDICT. Either `verify.mjs --record` grows
     arguments for per-criterion results, or the verifier gets a single narrowly-scoped
     write path for `.mavci/control/verdicts/<task>-attempt-NN.json` and nothing else.
     Today the only agent qualified to judge the task is the only one that cannot record
     its judgement.

  4. THE ROUTER MUST NOT SAY "passed attempt 1" ON A VERDICT THAT DID NOT EXAMINE THE
     ACCEPTANCE CRITERIA. Until (1) exists, `route.mjs` should treat a verdict with no
     `criteria[]` as `incomplete` rather than `pass`, which fails closed instead of open.

RELATION TO OTHER FINDINGS. This is finding 4's second half arriving at the other end of the
chain. Finding 4: the approval gate shows what criteria ASSERT and not what they REQUIRE, so
the operator cannot tell which are executable. Finding 6: the verdict does not record what
criteria RETURNED, so nobody can tell which were executed or whether they passed. Between
them, the acceptance criteria - the artefact the whole ceremony is built around, the one the
operator is asked to read carefully and approve by hash - are invisible to the machine on
BOTH sides of the work. They are checked by a human at the start, checked by an agent in
prose in the middle, and represented nowhere the system can read.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

### Addendum to finding 6 - Widest statement, finding 4 linkage, and a third face: an acceptance criterion cannot be waived

Amended 2026-09-05T09:50:16Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

STATE IT AT ITS WIDEST, AND ADD THE THIRD FACE DISCOVERED WHILE ACTING ON IT.

THE FINDING, AT FULL WIDTH:

  A TASK WITH A FAILING ACCEPTANCE CRITERION CLOSES AS DONE AND REACHES THE RELEASE GATE
  WITH NOTHING DOWNSTREAM AWARE. The bias is ONE-DIRECTIONAL: a verdict that covers a
  strict subset of the criteria is always more optimistic than the truth and never less.
  Every criterion the standards gate does not cover is a criterion that cannot fail the
  verdict - and those are exactly the project-specific criteria the operator spent their
  review on. The system is blind in the direction that lets work through, on the criteria
  that were written because the standard checks do not cover them.

THIS IS FINDING 4'S OTHER HALF, and the pair should be read together rather than as two
issues that happen to be adjacent:

  BEFORE the work: nothing tells the operator what the criteria REQUIRE. They read 32
  assertions and cannot tell that six need a running server, three need a browser, six need
  a write outside the repository, one needs a live key. (finding 4)

  AFTER the work: nothing records what the criteria RETURNED. The verdict carries standards
  findings only; whether a criterion passed, failed, was executed, was merely inspected, or
  was never run at all is absent from every artefact the machine reads. (finding 6)

  SO: THE ONE THING THE OPERATOR IS ASKED TO JUDGE IS THE ONE THING THE MACHINE CANNOT SEE,
  ON BOTH SIDES OF THE GATE. The acceptance criteria are content-hashed at approval - the
  system takes exact cryptographic care that the operator approved THOSE WORDS - and then
  never reads them again. The hash protects the document's integrity and nothing protects
  its meaning.

THIRD FACE, FOUND WHILE CARRYING OUT THE OPERATOR'S DECISION ON THIS VERY TASK:

AN ACCEPTANCE CRITERION CANNOT BE WAIVED. The operator decided to waive criterion 4. The
attempt:

    state.mjs --waive spec.acceptance_criterion_4 --path package.json --reason "..."
    -> unknown check "spec.acceptance_criterion_4". A waiver for a check that does not
       exist would do nothing.
       Known checks: secrets.no_committed_secrets, next.supabase_client_in_function,
       next.route_force_dynamic, ... (15 standards checks)

The refusal is CORRECT and well-built: a waiver that silently does nothing is worse than a
refused one, and this fails closed. But the consequence is that the waiver vocabulary, like
the verdict schema, speaks only the standards checker's language. So acceptance criteria
can be:

    declared, with no way to state what they require       (finding 4)
    approved, with a cryptographic hash                    (works)
    executed, by an agent that cannot record the result    (finding 6)
    recorded, only as prose in a subagent's message        (finding 6)
    waived - NOT AT ALL                                    (this amendment)

Every operation the lifecycle performs on an acceptance criterion is unsupported except the
one that proves the operator read it. The system is rigorous about consent and silent about
outcome.

CONSEQUENCE ON THIS PROJECT: the operator's waiver decision - deliberate, reasoned, and
naming its own expiry condition - had to be recorded as a project ADR
(docs/adr/0003-criterion-4-waived.md) because the control plane has nowhere to put it. That
ADR is not enforced by anything. Nothing will notice if it is deleted, nothing checks it at
release, and nothing will remind anyone to remove it when the scaffold is fixed. The
operator asked for the waiver's removal to be the signal that finding 5 was applied; the
system cannot carry that signal, so a human must remember it.

ADDITION TO THE FIX. Alongside `criteria[]` with `status` and `mode`, and `not_run` forcing
`incomplete`, and the router failing closed on a verdict with no `criteria[]`:

  5. `--waive` must accept an acceptance-criterion id (e.g. `0001#4`) as well as a check id,
     record it against the task rather than the project, and require a reason. A criterion
     waiver should surface at the release gate in the same breath as the criteria summary,
     so "31 of 32 passing, 1 waived, reason: ..." is a sentence the gate can say rather than
     something a human reconstructs from an ADR nobody is required to read.

  6. A criterion waiver should support a CONDITIONAL expiry, not only `--days N`. The
     decision here expires when the scaffold stops shipping an orphan lint script - an event,
     not a date. A dated waiver on a condition-triggered fact either expires while still
     needed or outlives the defect silently.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 6 - Rigorous about consent and silent about outcome - and a criterion failed by the artefact recording its own waiver

Amended 2026-09-05T10:14:51Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE SENTENCE FOR THE WHOLE FINDING, WHICH BELONGS AT THE TOP RATHER THAN IN THE BODY:

    THE SYSTEM IS RIGOROUS ABOUT CONSENT AND SILENT ABOUT OUTCOME.

An acceptance criterion passes through five stages in this lifecycle. Consent is the only
one that is instrumented:

    1. DECLARED    with no way to state what it requires        - not instrumented (finding 4)
    2. APPROVED    cryptographically, content-hashed, and the
                   hash re-checked on every phase transition    - INSTRUMENTED
    3. EXECUTED    by an agent that cannot record the result    - not instrumented (finding 6)
    4. RECORDED    as prose in a subagent's message, nowhere
                   the machine reads                            - not instrumented (finding 6)
    5. WAIVED      not at all; --waive knows only the 15
                   standards check ids                          - not possible

Stage 2 is built with real care: `approvalCurrent()` compares a SHA-256 of the spec on disk
against the recorded approval, `--advance-phase` refuses when the spec changed after
approval, and the whole `awaiting_approval` gate exists to guarantee a human decided. That
care is correct and should not be reduced. THE POINT IS THAT IT IS THE ONLY PLACE THE CARE
IS SPENT. The system proves beyond doubt that the operator approved THOSE EXACT WORDS, and
then never checks whether the words came true.

SIXTH FACE, AND IT IS THE SAME BLINDNESS FROM THE OTHER DIRECTION:

A CRITERION CAN PASS AT VERIFICATION AND THEN BE FAILED BY THE ARTEFACT THAT RECORDS ITS OWN
WAIVER.

Criterion 30 (scope containment) asserts that `git status --porcelain --untracked-files=all`
lists no path outside an enumerated set: the six feature files, `package-lock.json`, and
paths under `.mavci/`. The verifier EXECUTED it and it PASSED.

The operator then waived criterion 4. Because an acceptance criterion cannot be waived
(stage 5 above), the decision had to be written as `docs/adr/0003-criterion-4-waived.md`.
`docs/` is not in criterion 30's allowed set. So:

    - criterion 30 passed at verification
    - recording the operator's decision about criterion 4 made criterion 30 fail
    - and nothing detected that, because the verdict does not carry criteria at all

The waiver of one criterion silently broke another, and the only reason it is known is that
a human happened to run `git status` afterwards and read the output. Had the chain continued
to `document` -> `release` as the router directed, the release gate would have seen
`verdict: "pass"` and known nothing about either criterion.

This closes the loop on the finding. The gaps are not at one end of the pipeline:

    BEFORE the work - the operator cannot see what the criteria REQUIRE       (finding 4)
    AFTER the work  - the machine cannot see what the criteria RETURNED       (finding 6)
    ACROSS the work - a decision recorded about one criterion can invalidate
                      another, and nothing correlates them                    (this addendum)

The acceptance criteria are treated as a document to be consented to rather than as state to
be tracked. Every mechanism the system has - the hash, the phase refusal, the approval
record - protects the DOCUMENT'S INTEGRITY. Nothing protects its MEANING, and nothing knows
the relationship between one criterion and another.

ADDITION TO THE FIX. Alongside `criteria[]` with `status` and `mode`, `not_run` forcing
`incomplete`, the router failing closed on a verdict with no `criteria[]`, `--waive`
accepting a criterion id, and conditional expiry:

  7. A criterion waiver must trigger RE-EVALUATION of the criteria set, not just suppression
     of one entry. Recording a waiver is a change to the working tree in the general case
     (it writes a decision record somewhere), and any criterion asserting facts about the
     working tree - scope containment, file counts, diff cleanliness - can be invalidated by
     it. The cheap version: re-run the criteria after a waiver is recorded and before the
     release gate reads the verdict. The system currently records a waiver and re-checks
     nothing.

  8. Criterion 30's allowed-path set should be able to name a class ("decision records and
     control-plane artefacts") rather than an explicit file list, or every operator action
     that leaves a trace becomes a scope violation. The criterion is right to be strict about
     FEATURE scope; it has no vocabulary for artefacts the LIFECYCLE itself produces.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

### Addendum to finding 6 - Third face: every criterion decays, 30 is only the one that was about paths

Amended 2026-09-05T11:54:01Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

GENERALISATION: A CRITERION CHECKED ONCE AT VERIFICATION SAYS NOTHING ABOUT THE TREE AT
COMMIT TIME. EVERY CRITERION HAS THIS PROPERTY. CRITERION 30 IS ONLY THE ONE THAT HAPPENED
TO BE ABOUT PATHS.

The `body.json` incident made this visible, and reading it as a scope problem would be
reading it too narrowly. A probe payload was written at the repo root during diagnosis,
`git add -A` staged it, and criterion 30 - which asserts that `git status --porcelain
--untracked-files=all` lists nothing outside an enumerated set - did not fire. It could not:
it was executed at verification, hours before the file existed. It passed, correctly, about a
tree that no longer exists.

THAT IS NOT A PROPERTY OF CRITERION 30. IT IS A PROPERTY OF EVERY CRITERION IN THE SPEC.
Each of the 32 was executed once, against one state of one working tree, and nothing
re-executes any of them. Several are invariants that a later commit can silently violate:

   5  only `lib/env.ts` reads `process.env`     - one added `process.env` anywhere breaks it
   6  key absent from `.next/static`            - one client-side import of lib/env breaks it
   7  `lib/env` imported by at most one route   - same
  10  no module-scope OpenAI client or getEnv() - one refactor breaks it
  16  no `err.message` / stack in the route     - one debugging line breaks it
  17  no fs / localStorage / indexedDB          - one convenience import breaks it
  22  limits live only in image-constraints.ts  - one inlined literal breaks it
  24  UTF-8, no mojibake                        - one Windows-encoded edit breaks it
  31  package.json unchanged                    - any dependency added breaks it

Every one of those would break silently. The verdict already says `pass`; nothing recomputes
it; and per this finding's main text the verdict could not record the result even if
something did. THE ACCEPTANCE CRITERIA DESCRIBE A MOMENT AND ARE READ AS IF THEY DESCRIBED A
STATE.

WHY THIS IS THE SAME FINDING RATHER THAN A NEW ONE. The main text said the verdict cannot
express what the criteria returned. The first addendum said a decision recorded about one
criterion can invalidate another, with nothing correlating them. This is the third face: even
a criterion that was correctly executed and correctly recorded decays the moment the tree
changes, and nothing anywhere notices. All three are the same absence - THE CRITERIA ARE
TREATED AS A DOCUMENT CONSENTED TO AT A POINT IN TIME, NOT AS STATE THAT IS TRACKED.

The standards checker does not have this problem, and the contrast is instructive: `gate.mjs`
re-runs on every hook, every commit, every CI job, so a regression in one of its 15 rules is
caught within one action. The acceptance criteria - the project-SPECIFIC assertions, the ones
written precisely because the standard rules do not cover them - run exactly once, by hand,
by one agent, and never again.

ADDITION TO THE FIX. Alongside `criteria[]` with `status` and `mode`:

  9. CRITERIA THAT ARE MECHANICALLY RE-RUNNABLE SHOULD DECLARE THEMSELVES SO AND BE RE-RUN.
     Most of the list above is a grep or a git command - the same shape as a standards rule.
     A criterion carrying its own command and a `rerunnable: true` flag can be executed by
     the gate on every run, and a task's criteria then become part of the project's standing
     checks rather than a one-time interview. The ones that cannot - `server`, `browser`,
     `live-key` from finding 4's precondition vocabulary - stay one-time, and the verdict
     should say which kind each was, so "verified" carries a shelf life.

 10. AT MINIMUM, RE-RUN THE RE-RUNNABLE CRITERIA AT THE RELEASE GATE. The gate already
     refuses on stale guardian records - it has the concept of evidence going out of date. It
     applies that concept to guardian and not to the acceptance criteria of the work being
     released.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 6 - Not a gap in the verdict schema: the wrong thing is being continuous

Amended 2026-09-05T11:56:35Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

RESTATEMENT: THIS IS NOT A GAP IN THE VERDICT SCHEMA. IT IS THE WRONG THING BEING CONTINUOUS.

The previous addendum ended with fixes - declare re-runnable criteria, re-run them at the
release gate. Those are worth doing and they are not the point, and framing them as the point
understates what was found. Stated as the contrast instead:

  THE GATE RE-RUNS 15 GENERIC RULES ON EVERY HOOK, EVERY COMMIT, EVERY CI JOB.
  THE PROJECT-SPECIFIC ASSERTIONS - WRITTEN PRECISELY BECAUSE THE GENERIC RULES DO NOT
  COVER THEM - RUN ONCE, BY HAND, BY ONE AGENT, AND NEVER AGAIN.
  THE SYSTEM RE-VERIFIES THE GENERIC THING CONTINUOUSLY AND THE SPECIFIC THING NEVER.

Read that way, the earlier framing was too small. A missing `criteria[]` array is a schema
defect and could be fixed by adding a field. THE CONTINUITY BEING POINTED AT THE WRONG LAYER
IS AN ARCHITECTURAL CHOICE, and no field addition changes it.

The 15 standards rules are, by construction, THE THINGS THAT ARE TRUE OF EVERY MAVCI PROJECT.
They are the least project-specific assertions in the system. They get a hook, a gate, a CI
job, a baseline, a waiver mechanism with expiry, and a release-gate refusal on staleness -
five separate mechanisms keeping them current.

The 32 acceptance criteria are, by construction, THE THINGS THAT ARE TRUE OF THIS PROJECT AND
NOTHING ELSE. They are the entire reason the task was specified rather than assumed. They get
a content hash proving someone read them, one execution, and a verdict that cannot hold the
result.

SO THE EFFORT IS INVERTED RELATIVE TO THE INFORMATION. The rules that could be checked once
per release of the plugin - because they change only when the plugin changes - are checked
continuously. The assertions that describe work in flight, in a tree that changes hourly, are
checked at a single instant and then trusted indefinitely. Whichever way round is correct, it
is not this one.

AND IT EXPLAINS THE SHAPE OF THE DAY. Findings 4, 6, 7, 8 and 9 all sit on the specific side
of that line: what these criteria require, what they returned, what these scopes constrain,
what this project's release needs, where this project's lessons go. Every one of them is a
place where the system has a strong continuous mechanism for the general case and nothing at
all for the particular one. The system is well built for the part of the problem that is the
same everywhere, and the part that differs per project is carried by prose, by one-time
execution, and by the operator's memory.

That is the finding. The `criteria[]` array is a step toward fixing it, not a description
of it.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 6 - The concrete case the decay argument needed: criterion 4 was false nine minutes after passing, falsified by the pipeline's own mandated next step

Amended 2026-09-05T19:07:08Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE DECAY FACE OF THIS FINDING HAS BEEN ARGUED THREE TIMES AND NEVER DEMONSTRATED. Here is
the demonstration. It is narrower than the argument and it is more convincing than the
argument, because nothing in it went wrong.

THE CASE. Task 0003, criterion 4, scope containment:

    git diff --exit-code -- package.json package-lock.json
      && [ "$(git status --porcelain --untracked-files=all -- ':!.mavci' | wc -l)" -eq 1 ]
      && git status --porcelain --untracked-files=all -- ':!.mavci' | grep -qxF " M app/api/cartoonify/route.ts"

  .mavci/control/verdicts/0003-attempt-01.json, run_at 2026-09-05T18:50:20Z:
      { "id": "4", "mode": "executed", "status": "pass" }   exit 0 in 122 ms

  commit 85028cb, 2026-09-05T18:59:26Z, "task 0003: UPSTREAM_ERROR stops instructing a retry"

  the same command, re-run against the tree after that commit:
      EXIT 1   - `git status --porcelain --untracked-files=all -- ':!.mavci'` prints ZERO lines
                 where the criterion requires exactly one

NINE MINUTES AND SIX SECONDS FROM PASS TO FALSE, AND NOBODY DID ANYTHING WRONG.

THE STEP THAT FALSIFIED IT IS THE PIPELINE'S OWN MANDATED NEXT STEP. It is item 1 of the
task's outstanding operator actions, in the summary the scribe wrote minutes earlier:
"Commit the change. It is unstaged by design (criterion 4)." The criterion pins the working
tree at exactly one modified, unstaged file. Committing is what the record instructs the
operator to do next, and committing is the single act that must make the criterion false.
The operator committed. The criterion was already recorded pass. Both are correct.

SO THIS IS NOT DECAY AND NOT CARELESSNESS. THE CRITERION IS SATISFIABLE ONLY IN THE WINDOW
BEFORE THE STEP THE PIPELINE MANDATES IMMEDIATELY AFTER IT.

WHY THIS IS BETTER EVIDENCE THAN THE EARLIER FRAMING, AND WHY THE EARLIER FRAMING INVITED
THE WRONG FIX. The third-face addendum reached for criterion 30 and a `body.json` probe
payload left at the repo root during diagnosis. That is an accident - a stray artefact
somebody dropped - and an accident invites the answer "then be more careful". It also puts
the decay on a timescale: a later refactor, a Windows-encoded edit, a dependency added next
month. Read that way the finding is a risk, and a risk can be discounted.

None of those readings survives this case:

  - NO CARELESSNESS. Every actor did exactly what the record told them to do.
  - NO INTERVAL. Nine minutes. There was no window in which anyone could have re-run it and
    got the recorded answer, because the mandated step closed the window.
  - NOT A RISK, A CERTAINTY. This criterion cannot survive the pipeline's own next step. Not
    "might decay" - guaranteed false, by design, immediately, on every task that uses this
    shape. Task 0002's criterion 4 is structurally identical and the 0003 spec cites it as
    precedent at 7.3. The queue already holds two of them.

AND THE VERDICT STILL SAYS PASS. It says so now, it will say so at the release gate, and it
will say so a year from now, because nothing recomputes it, nothing dates it, and the
verdict carries no statement of which tree the criterion was true of. That last absence is
filed tonight as its own finding: a criterion recorded without its subject.

WHAT THIS CHANGES IN THE FIX - AND IT IS A CORRECTION TO ITEMS 9 AND 10, NOT AN ADDITION.
Items 9 and 10 propose that mechanically re-runnable criteria declare themselves and be
re-run at the release gate. ADOPTED AS WRITTEN, THAT WOULD MAKE THIS CASE WORSE. Criterion 4
is mechanically re-runnable - it is two git commands - so it would be flagged `rerunnable`
and re-run, and it would fail every release from the first commit onward, reporting
truthfully that the tree no longer matches, about an assertion whose entire purpose was to
constrain the tree at a moment that has passed. A gate that fails on every release is
switched off within a week, and it would take the genuine regression pins with it.

 11. A CRITERION MUST DECLARE WHAT IT IS TRUE OF: A MOMENT, OR A STATE. Criterion 4 is a
     MOMENT criterion. It constrains the tree the verifier saw, it is how the operator knows
     the agent did not smuggle in a dependency, and it is meaningless the instant the tree
     moves. Criterion 5 of the same task - `UPSTREAM_ERROR` is bound to the pinned wording -
     is a STATE criterion: it should hold on every later tree, and a later commit breaking it
     IS a real regression worth failing a release over. The two sit side by side in one
     numbered list, in the same prose format, indistinguishable to any reader or runner.
     `rerunnable: true` is the wrong axis - both are trivially re-runnable. THE AXIS IS
     WHETHER THE ASSERTION IS ABOUT A TRANSITION OR AN INVARIANT, and only the operator
     approving the spec can say which, which is an argument for asking them at approval time.

 12. A MOMENT CRITERION SHOULD RECORD ITS SUBJECT RATHER THAN BE RE-RUN. Criterion 4's
     honest record is not `pass`; it is `true of tree <sha> at <time>`. Give the record the
     tree sha and a moment criterion becomes permanently checkable by anyone who wants to:
     check out the sha it names, run the command, get the recorded answer. Without it, a
     moment criterion is a claim whose subject was discarded, and re-running it later is not
     verification - it is asking the same question about a different tree and recording the
     answer as though it were about this one.

THE SHAPE, STATED ONCE. The standards checker asserts invariants, which is why re-running it
continuously is right. The acceptance criteria mix invariants with transitions and mark
neither, which is why "re-run them continuously" is not the fix and "run them once and trust
forever" is not either. The list needs the distinction before it needs the schedule.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it, and
corrects only the fix items 9 and 10 that it names.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 7 - Verifier write scope is enforced against the tools it does not have and unenforced against the one it uses

Filed: 2026-09-05T10:23:15Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `agents/agent-scopes.json`

Check: `risk-guard.edit_scope`

THE VERIFIER'S WRITE SCOPE IS ENFORCED AGAINST THE TOOLS IT DOES NOT HAVE AND UNENFORCED
AGAINST THE ONE IT USES.

Not a bypass. A bypass implies a boundary that was gone around. THE CONSTRAINT NEVER FIRES
ON THE PATH THE AGENT ACTUALLY WORKS ON.

THE TWO FACTS, BOTH VERIFIED.

  agents/agent-scopes.json
    "mavci-verifier": { "phase": "verify", "allow": [], "deny": ["**"],
                        "native_constraint": true }

  agents/mavci-verifier.md
    tools: Read, Grep, Glob, Skill, Bash
    disallowedTools: Edit, Write, NotebookEdit

  scripts/risk-guard.mjs:674
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
      ...
      :774   if (scope.deny?.length && matchesAny(rel, scope.deny)) deny(...)
      :783   if (scope.allow && !matchesAny(rel, scope.allow)) deny(...)
    }

The per-agent scope check at 774-784 is INSIDE the Edit/Write/NotebookEdit branch. Bash does
not enter that branch. It is not scope-checked at all.

So `allow: [], deny: ["**"]` is enforced exclusively against Edit, Write and NotebookEdit -
the exact three tools `disallowedTools` already denies the verifier at the agent-definition
layer, before the guard is consulted. THE SCOPE CONSTRAINS NOTHING THE AGENT CAN DO. Its
only effect on this agent is to be present.

OBSERVED, NOT INFERRED. cartoonify task 0001. mavci-verifier ran the spec's fixture setup
verbatim - `mkdir -p "$T"`, two `node -e` writers, two `printf >` writers - and reported:

    "Fixture creation: SUCCEEDED, not denied. All exit 0, no prompt, no denial.
     A Bash write outside the repo is not blocked by deny: ['**']."

It also bound a TCP port, ran `npm run build` (which writes .next/), and terminated a
process with `taskkill /F /IM node.exe`. None of that is edit-scoped.

WHAT ACTUALLY CONSTRAINS BASH WRITES, which is a much shorter list:
  - the `.mavci/control/` heuristic: if the write target cannot be determined AND the
    command names a control-plane path, refuse (observed firing twice this run)
  - the `.env` command patterns (risk-guard.mjs:1065-1067)
  - the tier-3 command rules (MCP calls, deploys, protected refs)
Everything else in the repository is writable by any agent holding Bash. The verifier could
have written application code - in the verify phase, whose entire purpose is that it cannot.

WHY THIS IS WORSE THAN A BYPASS. A bypass is a hole in a wall; you can measure it, and its
existence confirms the wall. Here there is no wall on that path, and the roster, the scopes
file and the agent contract all read as though there is. The architect of task 0001 wrote
its fixtures to `$TMPDIR` and annotated them "written outside the repository" - CAUTION
EXERCISED AGAINST A CONSTRAINT THAT DOES NOT EXIST ON THAT PATH. An agent reasoned carefully
about a boundary that was never going to stop it. That is the cost: the documentation
produces behaviour, the mechanism produces none, and nobody can tell from the inside.

Note the corollary for the OTHER agents. The same structure applies to every scoped agent
that holds Bash. mavci-architect is denied `app/**`, `lib/**`, `components/**`; mavci-builder
is denied `.mavci/control/**`. Those denials hold for Edit and Write and do not hold for
Bash beyond the control-plane heuristic. The builder's control-plane denial is partially
backstopped because the heuristic names that directory specifically; the architect's
application-code denial is not backstopped at all.

THE FIX, AND ITS HONEST COST. There are two, and only one is cheap.

  A. SCOPE-CHECK BASH WRITES. This is real work and it is harder than it looks. Determining
     the write targets of an arbitrary shell command is undecidable in general: redirects,
     heredocs, `tee`, `cp`, `mv`, `install`, `sed -i`, `node -e`, `python -c`, subshells,
     command substitution, and anything that writes a path it computed at runtime. The guard
     ALREADY CONCEDES THIS - the message "the write target of this command could not be
     determined" exists precisely because the analysis fails, and it fails open everywhere
     except the one directory it names. Doing this properly means either
       (i) deny-by-default for any Bash command whose write target cannot be proven, which
           would refuse most legitimate agent commands and is a large behavioural change; or
       (ii) enforcement below the shell - a sandbox, an overlay filesystem, a container with
           a read-only bind mount per agent scope - which is infrastructure work, not a
           regex, and is the only version that is actually sound.
     Either way this is weeks, not an afternoon, and (i) is not obviously an improvement.

  B. STOP CLAIMING CONTAINMENT THE MECHANISM DOES NOT PROVIDE. Change the roster, the scopes
     file comment, and the agent contract to say what is true: per-agent path scope applies
     to file-editing tools only; an agent holding Bash can write anywhere except the
     control plane and .env. Add it to agent-scopes.json as a comment beside
     `native_constraint`, since that field's name currently implies more than it delivers.

  B IS CHEAPER AND IT IS NOT THE LESSER FIX. A document that overstates containment is how
  gate6's verifier row read for eleven versions: the claim was load-bearing for reasoning
  that was never true, and every reader who trusted it reasoned wrongly for eleven releases.
  An accurate doc with a weaker guarantee lets the next person decide whether to build A. An
  inaccurate doc with a strong guarantee stops them ever asking. Fixing the claim is the
  prerequisite for fixing the mechanism, not a substitute for it.

  C. A PARTIAL MIDDLE, offered only because it is consistent with what already exists:
     extend the control-plane heuristic to the agent's declared deny globs - if the write
     target cannot be determined AND the command names a path inside the agent's deny scope,
     refuse. It is incomplete by construction (a command that never names the path literally
     still passes) and it must NOT be described as scope enforcement. It raises the cost of
     an accident without preventing an intent.

RELATION TO OTHER FINDINGS. Same family as 1, 4 and 6: the system's DECLARATIONS are richer
than its ENFORCEMENT, and the gap is invisible from inside. Finding 6 said the machine cannot
see what the criteria returned. This one says the machine does not check what the scopes
claim. In both cases a human reading the artefacts would conclude the opposite.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

### Addendum to finding 7 - Corollary first: the architect is the case that costs something. Fix B, with exact wording. C rejected.

Amended 2026-09-05T10:34:02Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

REORDERED: THE COROLLARY IS THE FINDING. THE VERIFIER IS THE ILLUSTRATION.

The original text led with mavci-verifier because that is where the defect was noticed. That
is the wrong order. THE VERIFIER IS THE CASE WHERE THE DEFECT COSTS NOTHING - the agent has
no reason to write, so an unenforced write scope changes no outcome. THE ARCHITECT IS THE
CASE WHERE IT COSTS SOMETHING, and it is the version that matters.

  mavci-architect is DENIED `app/**`, `src/**`, `lib/**`, `components/**`, `supabase/**` -
  the application code it must never write, because "it never writes application code" is the
  entire premise of separating planning from building. It holds Edit, Write AND Bash.
  risk-guard.mjs:674 runs the scope check only for Edit/Write/NotebookEdit, so THE DENIAL
  THAT DEFINES THE ROLE IS UNENFORCED ON BASH. An architect that wrote `app/page.tsx` with a
  heredoc would not be refused. Nothing in the system would notice, and the phase freeze does
  not help: the freeze is inside the same Edit/Write branch.

  mavci-builder is denied `.mavci/control/**`. That one is PARTIALLY backstopped, and only by
  accident of a different mechanism - the "write target could not be determined AND the
  command names a control-plane path" heuristic names that directory literally. It is the one
  denial with a Bash-side check, and it exists because someone hardened the control plane
  specifically, not because scopes are enforced.

  mavci-verifier is denied everything and needs to write nothing. Its scope is enforced only
  against Edit/Write/NotebookEdit, which its own `disallowedTools` already removes. The scope
  is dead code for this agent - which is why it was safe to discover here.

SO THE FINDING IS: PER-AGENT WRITE SCOPE IS ENFORCED ON THE TOOLS AND UNENFORCED ON THE
SHELL, FOR EVERY SCOPED AGENT. The verifier merely made it visible at zero cost. The
architect is where an unenforced denial would actually breach a role boundary the system is
built around.

DECISION: FIX B. NOT C. NOT AS AN INTERIM.

C - extending the control-plane heuristic to declared deny globs - IS REJECTED, and the
warning attached to it is the argument against it. A partial mechanism under a name that
implies completeness is how this class of defect starts; C would be found later by whoever
attempts A and mistaken for a foundation to build on. It would make the next fix harder while
appearing to make it easier.

B IS THE FIX. Correct the documentation to what the mechanism provides. The exact edits:

1. scripts/build-agents.mjs, constraintNote(), the `native_constraint: true` branch.

   NOW (false):
     'These limits are **natively enforced**: the `Edit`, `Write` and `NotebookEdit` tools
      are absent from your context entirely. There is nothing to resist - you could not edit
      a file if you decided to.'

   The last clause is untrue for any agent holding Bash. Proposed:
     'The `Edit`, `Write` and `NotebookEdit` tools are absent from your context entirely, so
      these limits cannot be reached with a file tool. THEY ARE NOT ENFORCED ON `Bash`: the
      per-agent scope check runs only for the file tools, so a shell command can write
      anywhere except `.mavci/control/` and `.env*`. Treat the scope as a rule you follow,
      not a wall that stops you.'

2. scripts/build-agents.mjs, HOOK_NOTE (rendered into mavci-architect and mavci-builder).

   NOW (false):
     'A write outside that list is refused with a reason.'

   Proposed:
     'A write outside that list THROUGH `Edit` OR `Write` is refused with a reason. THE HOOK
      DOES NOT SEE `Bash`: a shell command that writes outside your allow list is not
      refused, except under `.mavci/control/` and `.env*`. The allow list is the boundary and
      you are the thing enforcing it on the shell.'

   This is the important one. The current sentence tells the architect its application-code
   denial is enforced. It is not.

3. agents/agent-scopes.json - the field name `native_constraint` PROMISES WHAT IT DOES NOT
   DELIVER. It reads as "this agent is natively contained"; it means only "the file tools are
   absent from its tool list". Rename it to `file_tools_absent`, which is exactly what it
   asserts and cannot be misread as containment. If a rename is too invasive, add a sibling
   `"_note": "file tools only; Bash writes are not scope-checked"` to each entry - the file is
   JSON and cannot carry comments, which is itself why the overstatement went unannotated.

4. scripts/gate.mjs:50 repeats the claim in a design note - "`Edit` is absent from its context
   entirely. It could not fix one of those files if it decided to." True of Edit, false as
   stated: guardian holds no Bash, so the sentence happens to be correct FOR GUARDIAN, but it
   is written as though absence of Edit implies inability to write. Add the qualifier so the
   next reader does not generalise it, because generalising it is precisely what produced this
   finding's wrong first framing.

WHY B IS NOT THE LESSER FIX. An accurate doc with a weak guarantee lets someone choose to
build A. An inaccurate doc with a strong guarantee stops them asking. gate6's verifier row
read wrong for eleven versions for exactly that reason: the claim was load-bearing for
reasoning that was never true, and every reader who trusted it reasoned wrongly for eleven
releases. Correcting the claim is the PREREQUISITE for anyone sanely scoping A - not a
substitute for it, and not an interim measure pending it.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 7 - The rename is the fix; the _note sibling is the fallback, not the reverse

Amended 2026-09-05T10:38:54Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

ON POINT 3, THE RENAME: THE RENAME IS THE FIX. THE `_note` SIBLING IS THE FALLBACK.

The previous amendment listed these as alternatives of roughly equal standing, with the
`_note` offered "if a rename is too invasive". That ordering is wrong and is corrected here.

  RENAME `native_constraint` -> `file_tools_absent`.  THIS IS THE FIX.
  Add a `_note` sibling only if the rename genuinely cannot be done.  THIS IS A FALLBACK.

THE FIELD NAME IS THE CLAIM. Every reader of agent-scopes.json sees the key before they see
anything else, and most see only the key. `native_constraint: true` asserts that the agent is
natively constrained; what it actually records is that three tools are absent from a tool
list. A NAME THAT DESCRIBES THE MECHANISM CANNOT OVERSTATE IT - `file_tools_absent` says
exactly what is true and leaves no room for a reader to infer containment that is not there.

A NAME THAT LIES WITH A COMMENT EXPLAINING THE LIE IS WORSE THAN A PLAIN NAME. The `_note`
fallback leaves the false claim in the position of authority and adds a correction beside it.
That configuration is strictly worse than either a true name or an unannotated false one:

  - the reader who skims sees only the key, and is misled exactly as before;
  - the reader who reads both now has to decide which to believe, and the field name carries
    more weight than a sibling string because it is what every other tool keys on;
  - and the presence of a note makes the file LOOK annotated and careful, which lowers the
    chance anyone re-examines it.

This is the same failure as gate.mjs:50 in point 4, one level up: a statement that is locally
qualified and globally misleading is harder to find than a plain error, because nothing about
it reads as wrong.

So: rename. Take the fallback only under a real constraint - a downstream consumer keying on
the old name that cannot be updated in the same change - and if the fallback is taken, treat
it as debt with the rename still owed, not as the matter settled.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

### Addendum to finding 7 - The criteria path: the agent qualified to judge is the one denied the tool to record - the plumbing half shipped and the agent half did not

Amended 2026-09-05T14:31:35Z, plugin 0.1.33. Amended by: **main-session** (agent). Provenance enforced at the risk guard, not self-declared. It attests to who RAN this command, and to nothing about who directed it.

Observed: 2026-09-05, plugin 0.1.33, cartoonify task 0002, attempt 1, during /mavci-core:ship.

THE SAME SHAPE AS FINDING 7, ONE LAYER ALONG: THE AGENT THAT MUST PRODUCE THE EVIDENCE IS
THE ONE DENIED THE TOOL TO RECORD IT.

Finding 7 is about the verifier's write scope being enforced against Edit, Write and
NotebookEdit - the three tools it does not have - and not against Bash, the one it uses. This
is the same asymmetry arriving somewhere it costs a stop rather than a wall that is not there.

WHAT WAS OBSERVED, NOT CONCLUDED.

mavci-verifier was dispatched on task 0002, ran verify.mjs --record --task 0002, and worked
all fifteen acceptance criteria including the five that need a fault-injection dev-server
harness. It reported fifteen passes with per-criterion evidence: exact HTTP statuses
(502 in 0.303s refused, 502 in 0.345s degraded, 502 in 51.02s hang against a 44-57s window),
exact log markers (result=unreachable, result=reached status=200, and result= absent on the
refusing path), exact file:line for every structural grep.

The verdict it recorded has no criteria key at all. Its top-level keys are attempt, checks,
plugin_version, project_id, run_at, schema_version, scope, summary, task_id, verdict.

The router then returned action incomplete, dispatch null, operator true, with: "attempt 1 of
task 0002 has a verdict that does not say whether the acceptance criteria were met: it
records no criteria at all."

So the fifteen judgements exist. They were made by the only component qualified to make them.
They are in a subagent transcript and nowhere else.

THE REASON IS NARROWER THAN "NOTHING WRITES THE CRITERIA FILE", AND THE DIFFERENCE IS THE
FINDING.

verify.mjs:413-421 already states it exactly, in the comment above the --criteria parser:

    THIS IS THE PLUMBING HALF OF FINDING 6 FIX 3, AND NOT THE AGENT HALF. It
    makes criteria populable at all - without some writer the fail-closed
    router is a deadlock with no key. What it does NOT do is give the verifier
    a way to produce this file: mavci-verifier holds no Write and no Edit, so
    today only the main session can supply it. The agent that is qualified to
    judge the task still cannot record its judgement.

"There is no criteria writer" would be a missing feature, and it is not what is happening.
The writer is specified, is dispatched, is the single component the system trusts to
interpret a failing build, and is denied the two tools that would let it write a JSON file.
The half that shipped is the half that reads the file. The half that did not is the half that
could produce one.

WHY THIS IS FINDING 7 AND NOT ONLY FINDING 6. Finding 6 is about the verdict schema being
unable to express criteria results. That was fixed - the schema takes them now. What remains
is a tool-scope fact: the agent's capability set and the agent's job do not intersect at the
point where the job produces a record. Finding 7 named that mismatch for writes to the
repository; this is the same mismatch for the agent's own verdict.

THE WORKAROUND THAT MUST NOT BECOME THE FIX. The main session can write the file, and the
comment says so. Doing it means the record would assert that fifteen criteria were examined
and passed, on the strength of a subagent's prose summary transcribed by a component that ran
none of the probes. That is not a record of the verification; it is a record of the
orchestrator's confidence in a report, wearing the verification's name. It was not done here
and the stop was left standing.

Note also that mavci-verifier holds Bash, so it CAN write this file - that is precisely
finding 7's original observation, and it is not a solution. A boundary honoured by tool
roster and bypassable by heredoc is not a boundary; it is an instruction that the careful
agent follows and the careless one does not.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 7 - The assertion for the criteria path, and the broken build it must catch

Amended 2026-09-05T14:31:42Z, plugin 0.1.33. Amended by: **main-session** (agent). Provenance enforced at the risk guard, not self-declared. It attests to who RAN this command, and to nothing about who directed it.

NAME THE BROKEN BUILD FIRST, WHICH IS THIS ONE.

The broken build is the build shipping today: mavci-verifier.md declares
tools: Read, Grep, Glob, Skill, Bash and disallowedTools: Edit, Write, NotebookEdit, while
verify.mjs offers a --criteria path whose only legitimate producer is that agent. Nothing in
the plugin fails when those two facts sit side by side. The gap surfaces one layer downstream
as a router stop on a task whose code is correct.

ASSERT THE INTERSECTION, NOT EITHER SIDE OF IT.

check-agents.mjs (or check-route.mjs, wherever the agent roster is already parsed) asserts:
for every agent the router can dispatch, if that agent is instructed to run a command whose
recording flag consumes a file path, the agent's tool roster must contain a tool that can
create a file at that path.

Concretely, for mavci-verifier: it is told to run verify.mjs --record, verify.mjs accepts
--criteria <path>, therefore mavci-verifier must hold Write, or the assertion fails naming
both the flag and the missing tool.

WOULD IT CATCH TODAY'S BUILD? Yes, and it fails on the first run against 0.1.33 without any
change - which is the point of writing it before the fix rather than after. An assertion that
passes on its first run against the broken build is matching the wrong thing.

WHAT IT MUST NOT ACCEPT AS SATISFACTION. Bash must not count as the tool that can create the
file. If it does, the assertion passes today, the finding is recorded as closed, and the
system is asserting exactly the shape finding 7 filed: a write path that is unscoped, and a
scope enforced only against the tools the agent does not hold.

THE ADJACENT ASSERTION THAT WOULD NOT HAVE CAUGHT IT, recorded so the next reader does not
write it by mistake: asserting that verify.mjs rejects a malformed --criteria file. That is
input validation on the reading half. It passes on this build, it has always passed, and the
half that is missing is never exercised by it.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 7 - Two addenda here carry a false provenance stamp; read both as unattributed

Amended 2026-09-06T13:28:56Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

TWO FALSELY STAMPED ADDENDA IN THIS FINDING. They are:

  1. "The criteria path: the agent qualified to judge is the one denied the tool
     to record - the plumbing half shipped and the agent half did not",
     Amended 2026-09-05T14:31:35Z, plugin 0.1.33.
  2. "The assertion for the criteria path, and the broken build it must catch",
     Amended 2026-09-05T14:31:42Z, plugin 0.1.33.

Both stamped: Amended by: **main-session** (agent). The finding's other two
addenda (2026-09-05T10:34:02Z and 10:38:54Z) are correctly unattributed and are
not affected.

NOTE THE SECOND ONE PARTICULARLY. It supplies an ASSERTION - the thing an
applier acts on - and it is the block whose apparent provenance most invites
trust. Its content stands or falls on its own; the attribution beneath it
attests to nothing.

WHY THE STAMP IS FALSE. It reads "Provenance enforced at the risk guard, not
self-declared." Nothing enforced it. The guard's comparison lives in
risk-guard.mjs and is gated on `agent_type`, which is present for a subagent and
ABSENT for the main session; a main-session caller therefore passes any value it
likes and the comparison never runs. Worse, `main-session` IS NOT AN AGENT:
agents/agent-scopes.json declares exactly five - mavci-architect, mavci-builder,
mavci-guardian, mavci-scribe, mavci-verifier. Had a subagent declared
`--agent main-session`, the guard would have DENIED it as "not itself". It was
not denied because there was no caller identity to compare against.

HOW TO READ THESE BLOCKS. Treat them exactly as if they said "Amended by: not
recorded ... Treat it as unattributed", which is what the other thirteen addenda
in this queue say and what these should have said. Specifically, the stamp is
NOT evidence that an agent authored the block, and NOT evidence that anything
verified who did. It is a string that was typed and echoed.

THE STAMPS ARE NOT EDITED, AND MUST NOT BE. This queue is append-only -
"no path here edits a filed byte" - and rewriting a stamp would erase the fact
that it was ever wrong, which is the same objection the queue raises against
replacing a filed sentence. This addendum is the correction; the bytes stay.

IDENTIFIED BY TITLE AND TIMESTAMP, NOT BY LINE NUMBER. Finding 24's addendum
cited line numbers, and they are already stale: amending finding 9 inserted text
inside an earlier block and shifted every line after it. In a file that appends
inside blocks, a line number is not an identifier.

Full analysis, both holes and the driven reproductions: finding 24.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 8 - Release gate is a plugin-release gate wearing the name of a project-release gate

Filed: 2026-09-05T10:49:02Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Check: `release-check.closing_text`

THE RELEASE GATE IS A PLUGIN-RELEASE GATE WEARING THE NAME OF A PROJECT-RELEASE GATE.

Run from a project, it prints instructions for a repository the operator is not in.

OBSERVED. cartoonify, phase `release`, all preconditions holding. `release-check.mjs` exits 0
and prints:

    release preconditions: all hold.

    That means the preconditions hold, NOT that the release is done. The version in
    plugin.json IS the release action; nothing propagates until it changes:

      edit -> build-agents.mjs if a def changed -> bump plugin.json -> commit ->
      push -> tag vX.Y.Z -> push tag

Every line after the first is about the MAVCI PLUGIN's release. Cartoonify has no
`plugin.json` in that sense, no `build-agents.mjs`, no agent definitions, and nothing
propagates from it to anywhere. Its release is a Vercel deploy. An operator who followed
these steps literally would go looking for files that do not exist in the repository they
are standing in.

WHAT IS ACTUALLY CORRECT HERE. The first sentence - "the preconditions hold, NOT that the
release is done" - is exactly right and is the sentence that matters. The refusal machinery
is right. `skills/release/SKILL.md` is right that the bump, commit, tag and push stay with
the operator. THE DEFECT IS ONLY THAT THE CLOSING TEXT NAMES THE PLUGIN'S ARTEFACTS
UNCONDITIONALLY, in a command that is documented as "Use before releasing a project" and is
routed to by `route.mjs` for any project reaching the release phase.

SAME CLASS AS THE FOUR CONSTRAINT SITES IN FINDING 7: TEXT THAT IS TRUE WHERE IT WAS WRITTEN
AND FALSE WHERE IT IS READ. It was written by someone releasing the plugin, for whom every
line is correct. It is read by an operator releasing a project, for whom only the first line
is. Nothing about it reads as an error, which is what makes this class expensive: a plainly
wrong instruction gets questioned, a locally-correct one gets followed.

A SECOND, QUIETER CONSEQUENCE. Because the closing text describes the plugin's release, the
gate never says what a PROJECT's release actually requires. For cartoonify that is: the
Vercel deploy, and `OPENAI_API_KEY` present in the deployment environment - without which the
one thing the product does returns 503. The gate checked guardian provenance and verdict
freshness and said nothing about the environment variable the application cannot run without.
The gate is thorough about the concerns of the repository it was written in and silent about
the concerns of the repository it is run in.

FIX.

  1. Branch the closing text on what is being released. If the project IS the mavci system
     repo (detectable the same way `retro.mjs systemRepo()` does it - a
     `.claude-plugin/marketplace.json` marker), print the plugin sequence. Otherwise print
     the project's own, derived from `deploy.target` in the manifest: for
     `target: "vercel"` that is the deploy and the environment variables in
     `env_sources.required_keys`; for `railway` the equivalent; for `none`, say that no
     deploy target is declared.

  2. At minimum, if branching is too much, say WHOSE release the sequence describes. One
     clause - "if you are releasing the mavci plugin itself:" - removes the whole defect,
     because the operator can then see the instruction does not apply to them.

  3. Have the gate check `env_sources.required_keys` against the declared deployment
     environment, or state plainly that it does not. cartoonify passed a release gate while
     its only required key was unset. That is not a failure of this run - the key is
     deliberately absent and criterion 32 records it - but the gate did not know, did not
     ask, and would have said the same thing if nobody had noticed.

RELATION. Finding 1 (product type not declarable), finding 5 (scaffold ships a lint script it
cannot run), and this one are the same shape from three angles: the system's artefacts are
correct for the multi-tenant-SaaS-plus-plugin shape they were written in, and quietly wrong
for anything else, with no mechanism that notices the difference.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 9 - retro --apply cannot reach the system repo from a normal install - third consecutive session

Filed: 2026-09-05T10:49:35Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Check: `retro.apply`

`retro --apply` CANNOT REACH THE SYSTEM REPO FROM A NORMAL INSTALL. THIRD CONSECUTIVE SESSION.

THE COUNT IS THE FINDING. Three sessions in a row, the command whose entire purpose is
carrying findings out of a disposable project could not do it, and the findings reached
durability because THE OPERATOR REMEMBERED TO COPY THEM BY HAND. On this run that is seven
findings - now nine - from a project directory that exists to be thrown away.

REPRODUCED THIS SESSION, verbatim:

    $ retro.mjs --apply
    retro: could not locate the system repository. Looked for
    .claude-plugin/marketplace.json in:
      C:\Users\Mehmet AVCI\.claude\plugins\cache\mavci
    It is NOT written to the marketplace clone, which propagation resets:
      C:\Users\Mehmet AVCI\.claude\plugins\marketplaces\mavci
    Copy .mavci/lessons/pending-system-change.md into the system repo's docs/lessons/ by
    hand instead.

THE MECHANISM. `systemRepo()` has exactly one candidate:

    const candidates = [path.resolve(here, '..', '..', '..')];
    for (const c of candidates)
      if (exists(path.join(c, '.claude-plugin', 'marketplace.json'))) return c;
    return null;

From a cache install `here` is `.../plugins/cache/mavci/mavci-core/0.1.32/scripts`, so the
candidate is `.../plugins/cache/mavci` - which holds no marketplace.json. The marketplace
clone is DELIBERATELY excluded, and that exclusion is correct: gate5 2026-09-03 records that
writing there looked like success and was erased by the next propagation, and the documented
apply-then-clear workflow would then destroy the only durable copy. REFUSING IS THE RIGHT
BEHAVIOUR.

SO THE COMMAND IS NOT BROKEN IN ITS LOGIC. IT IS UNREACHABLE IN ITS TOPOLOGY. The source
comment says "A normal install makes those the same directory - the plugin runs from inside
the clone - so the order is invisible there." THAT IS NOT TRUE OF A CACHE INSTALL, which is
what a normal install actually is here: Claude Code caches `plugins/mavci-core/` under
`plugins/cache/<marketplace>/<plugin>/<version>/`, three levels deep with no marker anywhere
above it. The design accounted for two topologies - development checkout, and clone-as-install
- and the one that ships is a third.

WHY THIS MATTERS MORE THAN A BROKEN COMMAND. The retro loop is the system's mechanism for
improving itself: findings are filed against a project, the project is disposable, and
`--apply` is the only thing that moves them somewhere permanent. With `--apply` unreachable,
THE SELF-IMPROVEMENT LOOP IS CLOSED BY HUMAN MEMORY. That is the single dependency the whole
apparatus exists to remove. Every other control here is built so a tired operator cannot lose
something: the hash on the spec, the phase refusals, the fail-closed schema check, the
insistence that a waiver name its own expiry. And the artefact carrying the lessons from all
of it survives only if someone remembers, three sessions running.

The failure is also SILENT IN THE DIRECTION THAT LOSES WORK. `doctor` reports queued findings
every run, so the queue is visible - but only from inside the project. Delete the project
directory and the queue goes with it, with no warning, and nothing anywhere else ever knew
those findings existed.

FIX, cheapest first.

  1. LET THE OPERATOR DECLARE THE SYSTEM REPO PATH, once, in `~/.claude/settings.json` or a
     `mavci` config key. Path shape cannot be inferred from a cache install, so stop trying
     to infer it. `--apply` then has a target on every machine, and the marker-file check
     still confirms it before writing. This is the same pattern the manifest already uses for
     everything else that cannot be derived.

  2. ADD THE CACHE TOPOLOGY AS A RECOGNISED CASE, and when the candidate is under
     `plugins/cache/`, say so specifically: "this is a cache install; the source checkout
     cannot be located from here - declare it with <setting>". The current message names two
     paths and neither is where the operator should look.

  3. FAIL DURABLY RATHER THAN REFUSING. If no system repo can be found, write the queue to a
     path OUTSIDE the project - e.g. `~/.claude/mavci-lessons/<project>-<date>.md` - and say
     so. The operator is currently told to copy a file by hand, which works only while they
     are paying attention; a durable write outside the disposable directory removes the
     memory dependency even when the repo is genuinely unavailable. THIS IS THE ONE THAT
     ACTUALLY FIXES THE THREE-SESSION PROBLEM, because it does not depend on the operator
     doing anything.

  4. Have `doctor` warn when queued findings exist AND `--apply` cannot resolve a target, so
     the unreachability is reported at the start of a session rather than discovered at the
     end of one, when the project is about to be discarded.

NOTE ON THIS SESSION: the operator copied the queue into the system repo by hand as
`cartoonify-2026-09-05.md`. The findings survived. They survived because a person remembered,
for the third time.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

### Addendum to finding 9 - Fix 3 shipped as escrow and the loss half is closed on evidence; the resolution half is untouched and is now quieter, not gone

Amended 2026-09-06T12:28:27Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

FOURTH CONSECUTIVE SESSION, AND THE COUNT IS STILL THE FINDING - BUT IT NOW COUNTS
A DIFFERENT THING. Fix 3 has shipped. Fixes 1 and 2 have not. The half that was
losing work is closed on evidence; the half the command is named after is
untouched.

WHAT SHIPPED, AND IT IS EXACTLY FIX 3. The main text ranked four fixes and said of
the third - write the queue somewhere outside the disposable project when no repo
can be found - "THIS IS THE ONE THAT ACTUALLY FIXES THE THREE-SESSION PROBLEM,
because it does not depend on the operator doing anything." That is the escrow,
and it behaved to specification on 2026-09-06:
  - the file was written BEFORE the message, so the copy exists whether or not
    anyone reads the output;
  - the refusal reads as a NOTIFICATION rather than a failure;
  - `--clear` is explicitly forbidden in that state, so the documented
    apply-then-clear workflow cannot destroy the only durable copy;
  - 219 KB, 27 findings, intact.
THE LOSS HALF OF THIS FINDING IS CLOSED ON EVIDENCE, and closed in the manner fix
3 required: it did not depend on the operator doing anything.

WHAT DID NOT SHIP. Re-verified 2026-09-06 against plugin 0.1.34, unchanged from
the 0.1.32 reproduction in the main text. `systemRepo()` still has one candidate,
`path.resolve(here,'..','..','..')`. From this cache install that resolves to
`~/.claude/plugins/cache/mavci`, which holds no `.claude-plugin/marketplace.json`,
so it returns null and refuses. The only tree on this machine carrying that marker
is the marketplace clone, which remains deliberately and CORRECTLY excluded (gate5
2026-09-03). Nothing about the topology changed. Neither fix 1 (an operator-declared
path) nor fix 2 (naming the cache case in the message) is present.

THE RESULTING STATE, STATED PRECISELY BECAUSE IT IS EASY TO MISREAD AS DONE. The
command whose entire purpose is carrying findings into the system repository still
cannot reach it, and now says so honestly instead of failing silently. That is
strictly better and is NOT the intended end state. Escrow made the failure SAFE.
It did not make it ABSENT.

THE NEW RISK, AND IT IS THE REASON THIS ADDENDUM EXISTS: SAFETY RETIRES URGENCY.
The main text's central claim was that the self-improvement loop is closed by
human memory - "the single dependency the whole apparatus exists to remove". Escrow
removes the LOSS. It does not remove the MEMORY. On 2026-09-06 the operator again
carried the queue into the system repo by hand and pushed; that is the fourth time.
The dependency has changed shape rather than gone:
  before - remember to copy it, or the findings are DESTROYED
  after  - remember to copy it, or the findings never ARRIVE
The second is quieter. A destroyed queue is a visible catastrophe that forces a
fix; a queue sitting safely in escrow on one machine, arriving in the system repo
only when a person carries it, produces no pressure at all. THIS FINDING IS MORE
LIKELY TO BE FORGOTTEN NOW THAN IT WAS WHEN IT WAS DANGEROUS.

THREE COPIES, ONE DURABLE. The queue currently exists in the project, in the
escrow, and in the source repository. Only the last survives all three failure
modes - the project is disposable by design, and the escrow is on this machine.
The escrow's existence must not be read as the queue being safe in general; it is
safe against ONE failure mode, the one that was destroying work.

STATUS: this finding is NOT closed. Its loss half is discharged and should be
recorded as such when it is applied; its resolution half - fixes 1, 2 and 4 - is
open, and the assertion below is supplied against that half, the main text's
assertion section having been left NOT SUPPLIED.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 9 - The assertion finding 9 was filed without, supplied against the resolution half

Amended 2026-09-06T12:28:55Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

The main text's assertion section reads NOT SUPPLIED. It is supplied here, against
the RESOLUTION half, because no sanctioned route writes into a finding's own body
(finding 25). A reader who stops at the assertion section will see the placeholder
and not this. That is the defect finding 25 records, and this block is an instance
of it rather than a workaround for it.

FOUR ASSERTIONS. The first is the fix; the rest exist so it cannot be satisfied
carelessly, and one of them protects what already works.

FIRST, AND RED TODAY: `--apply` must resolve a target from a CACHE INSTALL. Drive
`systemRepo()` with `here` set to a path of the shipping shape -
`<...>/plugins/cache/<marketplace>/<plugin>/<version>/scripts` - and require a
non-null result once an operator has declared the repo path (fix 1).
  THE BROKEN BUILD: 0.1.34 as it stands. Run it there FIRST and require null.
  An implementation that returns non-null on 0.1.34 is resolving something else.

SECOND, SO THE OBVIOUS WRONG FIX IS EXCLUDED: it must NOT resolve to the
marketplace clone. Assert that a build which restores the clone as a candidate
FAILS. That build makes assertion one pass and re-creates the gate5 2026-09-03
regression exactly - a write that reports success and is erased by the next
propagation, under a documented apply-then-clear workflow that would then destroy
the only durable copy. Demonstrate that failure before accepting any fix. If
assertions one and two cannot both hold, KEEP REFUSING: a refusal plus escrow is
recoverable, and a silent write into a tree that gets reset is not.

THIRD, SO THE FIX DOES NOT REGRESS WHAT NOW WORKS: the escrow write must survive
the resolution change. Assert that the escrow copy is written BEFORE the queue is
read for transfer, on BOTH paths - when a repo resolves and when it does not - so
an apply that dies midway cannot leave the queue neither escrowed nor applied.
  THE BROKEN BUILD THIS CATCHES: the natural refactor that treats escrow as the
  else-branch of resolution and writes it only when no repo is found. That build
  passes assertions one and two and silently removes the guarantee that closed
  this finding's loss half.

FOURTH, FIX 4, AND IT IS THE ONE THAT KEEPS THE FINDING VISIBLE: `doctor` must
report, at session start, that queued findings exist AND that no apply target
resolves - as one statement, not two. Red today: doctor reports the queued file
and says nothing about reachability, so the unreachability is discovered at the
end of a session rather than the start.

GREEN DIRECTION, so these are proven both ways rather than merely shown capable of
failing: on a corrected copy carrying a declared repo path, assertion one passes,
two still refuses the clone, three still writes escrow first, and four reports
nothing because a target resolves. A check only ever demonstrated red proves it
can fail, not that it discriminates.

WHAT NO ASSERTION HERE COVERS, stated so it is not mistaken for covered: none of
these detects whether a queue that reached escrow ever reached the system
repository. That transfer is currently a person, and a check cannot assert a
person remembered. It is the residue of this finding and the reason it stays open.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 9 - First real use: what one clean exercise proves about the mechanism, and what it does not

Amended 2026-09-06T13:46:40Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

FIRST USE, AND THE DISTINCTION IS THE POINT. The escrow write on 2026-09-06 was
its FIRST REAL EXERCISE. That is evidence about the MECHANISM rather than about
the incident, and it supports a narrower claim than a track record does: a
mechanism that worked on its first real use is not a mechanism that has worked.

WHAT IS ACTUALLY PROVEN. One path, once: no system repository resolved, the
escrow file was written BEFORE the message, the message read as a notification
rather than a failure, `--clear` was refused in the same breath, and 219 KB of
queue with 27 findings came through intact. For a mechanism whose entire purpose
is to hold when nobody is watching, a clean first exercise is strong evidence -
the failure mode it replaces used to require the operator to notice, and this one
did not.

WHAT IS NOT PROVEN, LISTED SO A LATER READER DOES NOT READ ONE SUCCESS AS A
GUARANTEE:
  - the path where a repository DOES resolve. The escrow-write-first ordering has
    never been exercised on the success path, and that ordering is exactly what
    assertion three in this finding's supplied assertion protects. The natural
    refactor - escrow as the else-branch of resolution - would pass every other
    check and silently remove the guarantee, and nothing has yet demonstrated it
    holds when a target exists.
  - repeat runs against an existing escrow file: overwrite, append, or refuse is
    unobserved.
  - a queue materially larger than 219 KB, a full or read-only destination, and
    an interrupted write.

SO THE HONEST STATEMENT FOR AN APPLIER: fix 3 worked on the one path that has
ever been taken, on its first real use, and that is the basis for calling this
finding's loss half discharged. It is a first data point, not a history. The
resolution half remains untouched, and the operator carried the queue into the
system repository by hand again on 2026-09-06 - the fourth time.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 10 - Upload allow-list and upstream model are independent constants that align by coincidence

Filed: 2026-09-05T11:14:43Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `lib/image-constraints.ts`

THE UPLOAD CONTRACT AND THE UPSTREAM ENDPOINT ARE TWO INDEPENDENT CONSTANTS THAT ALIGN BY
COINCIDENCE.

This is a PROJECT-level finding about cartoonify, filed with the system findings because the
gap it exposes is the same shape as findings 4, 6, 7, 8 and 9: a declaration that nothing
tests against the thing it is supposed to describe.

THE TWO CONSTANTS.

  lib/image-constraints.ts:11
    export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

  app/api/cartoonify/route.ts:91
    model: 'gpt-image-1'      // on client.images.edit -> POST /v1/images/edits

NOTHING CONNECTS THEM. `ALLOWED_MIME_TYPES` governs what the client offers, what the server
accepts, and what `sniffImageType()` will confirm. The model string governs what the upstream
endpoint will actually take. They are declared in different files, by different concerns, and
no code, test, type or acceptance criterion asserts that the first is a subset of what the
second accepts.

THEY AGREE TODAY BY COINCIDENCE. `gpt-image-1` on `/v1/images/edits` accepts PNG, JPEG and
WEBP, which happens to be exactly the allow-list. That is luck, not design.

CHANGE ONE STRING AND THE PRODUCT BREAKS SILENTLY. `dall-e-2` on the same endpoint accepts
PNG ONLY. Swapping the model - a plausible edit for cost, availability, or an access problem
with `gpt-image-1` - leaves validation cheerfully accepting JPEG and WEBP uploads that the
endpoint will reject every single time.

AND THE FAILURE MODE IS THE WORST AVAILABLE ONE. route.ts:104 catches everything and returns
the generic `UPSTREAM_ERROR` with a fixed Turkish message. That is CORRECT behaviour per
criterion 16 and §5.2 - no upstream text, no exception detail, nothing leaked. But it means a
deterministic validation bug presents to the operator as an intermittent-looking outage:
every JPEG upload fails, every PNG upload works, and the user-facing message is identical to
the one shown for a genuine upstream incident. Nobody would think to look at the allow-list.

WHY THE SPEC COULD NOT HAVE CAUGHT THIS, WHICH IS THE SHARPER HALF. The spec has 32 criteria
and none of them assert this coupling. It could not have: THE CRITERION NEEDS A LIVE KEY TO
FAIL. With no key the route returns 503 at step 6 and never reaches the upstream call at step
7, so no key-free test can distinguish an allow-list that matches the endpoint from one that
does not. This is exactly what finding 4 says the approval gate cannot surface - the operator
reads 32 assertions and cannot see that the one criterion which would have caught this is
unwritable without a credential the project does not have. The gap was structurally invisible
at every point where it could have been noticed.

FIX.

  1. DERIVE ONE FROM THE OTHER, or at minimum make the dependency explicit and checked. A
     per-model capability map in lib/image-constraints.ts:

       const MODEL_ACCEPTS: Record<string, readonly AllowedMimeType[]> = {
         'gpt-image-1': ['image/png', 'image/jpeg', 'image/webp'],
         'dall-e-2':    ['image/png'],
       }

     with the model name exported from the same module and ALLOWED_MIME_TYPES computed from
     it. Then changing the model changes the allow-list, the client hint and the server check
     together, and the failure becomes impossible rather than merely unlikely.

  2. ADD THE ACCEPTANCE CRITERION TO TASK 0002, marked with the precondition finding 4 asks
     for: `live-key`. Something checkable: for each type in ALLOWED_MIME_TYPES, a real upload
     of that type returns 200. It cannot run in CI without a credential, and saying so in the
     criterion is the point - an unrunnable criterion that DECLARES itself unrunnable is
     honest, where an absent one is invisible.

  3. Distinguish the upstream failure codes. `UPSTREAM_ERROR` currently covers a rejected
     format, an unverified organisation, an exhausted quota and a genuine outage. The
     user-facing message should stay generic - that is criterion 12's reasoning and it is
     right - but the SERVER-SIDE log and the `code` field could separate "the request was
     invalid" from "the upstream is unavailable". A 400 from the API is our bug; a 5xx is
     theirs, and today they are indistinguishable to whoever is on call.

SEPARATE, SMALLER, AND WORTH FIXING REGARDLESS OF TODAY'S CAUSE:

  route.ts:89   const uploadable = await toFile(bytes, 'upload', { type: sniffed })

  The filename `'upload'` carries NO EXTENSION. The MIME type is passed correctly via
  `type`, but an extensionless filename in an OpenAI multipart upload is a known trigger for
  `400 invalid_request_error` responses about file format, independent of the declared type.
  Deriving the extension from `sniffed` is a one-line change that removes a whole class of
  upstream 400s, and it is worth making whether or not it is the cause of the failure
  observed on 2026-09-05.

  IT HAS DELIBERATELY NOT BEEN CHANGED YET. The operator is retrieving the terminal output.
  If the actual error turns out to be a 403 (organisation verification) or a 429 (quota),
  changing the filename first would leave a fix that cannot be attributed to anything - a
  change that may have fixed nothing, sitting in the tree, indistinguishable from one that
  mattered. Establish the cause, then fix both, and record which one did what.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

### Addendum to finding 10 - The ranked candidates were all wrong: sound reasoning, wrong layer

Amended 2026-09-05T11:30:06Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE RANKED CANDIDATES WERE ALL WRONG, AND THE WAY THEY WERE WRONG IS WORTH RECORDING.

Before the terminal output arrived, four causes were ranked for the observed failure:

  1. gpt-image-1 organisation verification (403)
  2. extensionless filename in toFile() (400 invalid_request_error)
  3. quota / billing (429)
  4. bad or wrong-project key (401)

The actual cause:

  APIConnectionError: Connection error.
  cause: FetchError: ... reason: read ECONNRESET
  status: undefined, request_id: undefined
  POST /api/cartoonify 502 in 34248ms

A TCP reset. No HTTP response at all. Not one of the four, and not adjacent to them.

THE REASONING WAS SOUND AND THE LAYER WAS WRONG. Every candidate was derived from reading the
route and the endpoint's documented behaviour - which is the correct method for the layers
that code and documentation describe, and reaches nothing below them. All four presuppose
that a request arrived at OpenAI and was answered. None of them can be true when nothing was
answered. The method had no term for the transport, so the transport was not in the ranking,
and its absence was not visible from inside the ranking.

THE DISCRIMINATOR WAS IN THE OUTPUT AND SHOULD HAVE BEEN THE FIRST THING ASKED FOR:

  status: undefined, request_id: undefined

An HTTP status means the provider answered; the cause is then at the application layer and
the four candidates are the right shortlist. NO STATUS AND NO REQUEST ID MEANS NO ROUND TRIP
COMPLETED, WHICH RULES OUT EVERY APPLICATION-LAYER CAUSE AT ONCE. That single check partitions
the search space before any hypothesis is worth forming, and it costs nothing.

GENERALISABLE RULE: for any upstream failure, establish WHETHER A RESPONSE WAS RECEIVED
before reasoning about WHAT THE RESPONSE MEANT. Ranking causes without that partition
produces a confident, well-argued shortlist drawn entirely from one layer, with no signal
that the layer itself might be the wrong one.

WHY THIS SITS BESIDE FINDING 10 RATHER THAN ON ITS OWN. Finding 10 is about a coupling
nothing tests - the allow-list and the endpoint agreeing by coincidence. The JPG hypothesis
that prompted it was ALSO wrong (gpt-image-1 accepts JPEG; the PNG-only rule is dall-e-2's),
and finding 10 remains correct anyway, because it was never contingent on being today's
cause. That is the useful contrast: a finding about a structural gap survives a wrong
diagnosis, while a ranked list of causes does not. THE FINDING WAS RIGHT FOR REASONS
INDEPENDENT OF THE INCIDENT THAT SURFACED IT; THE CANDIDATE LIST WAS WRONG FOR REASONS
INTERNAL TO HOW IT WAS BUILT.

The extensionless filename (finding 10, final section) is now known NOT to be today's cause.
It remains worth fixing on its own merits, and it is now unambiguously attributable: with
the transport failure identified, a filename fix can be made without confusing what it did.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 10 - Full width: eight candidates, two rounds, none correct - change the request, do not reason harder

Amended 2026-09-05T11:47:31Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE CANDIDATE-RANKING LESSON AT FULL WIDTH: TWO ROUNDS, BOTH WRONG, THE SAME WAY.

ROUND ONE. Four candidates ranked from the route source and the endpoint's documented
behaviour: organisation verification (403), extensionless filename (400), quota (429), bad
key (401). All four presuppose a request that ARRIVED AND WAS ANSWERED. The actual error had
`status: undefined, request_id: undefined` - no round trip completed - which excluded all
four at once. The frame was "what did the API answer"; nothing had answered.

ROUND TWO. Given the ECONNRESET, the frame moved to the transport, and finding 11 named four
more possibilities: a local network path, a proxy or inspection appliance, an ISP-level block,
an upstream edge problem. ALL FOUR WRONG AGAIN. The cause was billing - no credits - and the
reset was a SYMPTOM of the rejection, not a network fault at all. The frame was "what broke
the connection"; nothing had broken it, it was cut deliberately.

EIGHT CANDIDATES ACROSS TWO ROUNDS, NONE CORRECT. Each round's reasoning was sound inside its
frame, and each round's frame was too narrow. Worse, ROUND TWO'S FRAME WAS ADOPTED FROM ROUND
ONE'S EVIDENCE: the ECONNRESET was treated as identifying the layer, when it only identified
that no response arrived. A transport error is not evidence of a transport problem
(finding 12).

BOTH TIMES THE DISCRIMINATOR WAS CHEAP AND AVAILABLE BEFORE ANY HYPOTHESIS.

  Round one: `status` and `request_id` were in the output already. Present means the provider
  answered and the application-layer shortlist is right; absent means it did not and the
  entire shortlist is void. Reading two fields partitions the search space.

  Round two: a small-body request to a different endpoint. `/v1/images/generations` returned
  `429 insufficient_quota` with the cause named, IN 0.58 SECONDS. That probe was available
  from the first minute, costs nothing, and would have skipped both rounds.

THE RULE, STATED SO IT IS USABLE NEXT TIME:

  WHEN AN ERROR NAMES NO CAUSE, DO NOT REASON HARDER ABOUT THE ERROR. CHANGE THE REQUEST
  UNTIL ONE NAMES A CAUSE.

  Vary the cheapest dimension - a smaller body, a different endpoint, an unauthenticated
  call - and find a variant whose failure is diagnosable. An error that carries no
  information cannot be interpreted, only replaced. Ranking hypotheses against a silent error
  produces a confident, well-argued list drawn entirely from whichever layer the analyst
  happened to be looking at, with no signal from inside the list that the layer is wrong -
  which is exactly what happened twice.

WHAT SURVIVED AND WHAT DID NOT, which is the part worth carrying:

  The FINDINGS survived both wrong diagnoses. Finding 10 was prompted by a JPG hypothesis
  that was wrong; it is still correct, because the coupling it describes was never contingent
  on being the cause. Finding 11 was prompted by a transport diagnosis that was wrong; its
  timeout defect is still real, because a route calling a paid remote API needs a timeout
  inside its own ceiling whatever the failure was. Both were written to be independent of the
  incident that surfaced them, and that is why they held.

  The CANDIDATE LISTS did not survive, either time, and nothing about them could have. A
  ranked list of causes is a claim about one specific incident and is worth nothing the
  moment the frame moves.

  So: file findings about structure, which outlive the diagnosis. Hold hypotheses about
  causes loosely, and buy a discriminator before buying a ranking.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 10 - Outcome: fix parts 1 and 4 shipped and were verified both directions; part 2 is blocked by a sealed spec and part 3 is a contract decision

Amended 2026-09-06T13:48:28Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

FIX PARTS 1 AND 4 SHIPPED IN THIS PROJECT, 2026-09-06. Parts 2 and 3 did not, for
reasons that are not "not yet".

PART 1, DONE. `lib/image-constraints.ts` now exports `IMAGE_MODEL` and holds a
per-model capability map:

    const MODEL_ACCEPTS = {
      'gpt-image-1': ['image/png', 'image/jpeg', 'image/webp'],
      'dall-e-2':    ['image/png'],
    } as const
    export const ALLOWED_MIME_TYPES = MODEL_ACCEPTS[IMAGE_MODEL]

`route.ts` imports `IMAGE_MODEL` instead of carrying the literal `'gpt-image-1'`
at the call site. The sniffer's return type was widened to a separate
`DetectableMimeType`, because what magic bytes can RECOGNISE is a property of the
sniffer and not of the model: under a narrower model a JPEG is still identified
as a JPEG and then refused by the allow-list, rather than becoming unrecognisable.

VERIFIED IN BOTH DIRECTIONS, not merely typechecked. Setting `IMAGE_MODEL` to
`'dall-e-2'` narrows `ALLOWED_MIME_TYPES` to `['image/png']` automatically - the
client's `accept` attribute, the server's allow-list check and the upstream call
all move together - and the tree still typechecks. Restored to `'gpt-image-1'`,
allow-list confirmed back to all three. Under the previous code the allow-list
would have stayed at three types and every JPEG upload would have been accepted
and then rejected upstream, presenting as an intermittent outage. The drift this
finding describes can no longer be expressed.

PART 4, DONE. The multipart filename is now derived from the sniffed type -
`upload.png`, `upload.jpg`, `upload.webp` - replacing the extensionless
`'upload'`. This finding deliberately withheld that change pending the cause of
the 2026-09-05 failure; finding 12 established it (the account had no credits and
the connection was cut mid-upload), so the condition this finding set is met.

`npm run typecheck` and `npm run build` exit 0; the standards checker reports
0 blockers. The five reported failures are the pre-existing legal REVIEW REQUIRED
warnings, untouched.

PART 2, BLOCKED, NOT DEFERRED. It asks for a `live-key` acceptance criterion on
task 0002. All three task specs are approved by content hash and are immutable to
an agent, and task 0002 is closed - so the criterion has nowhere to go. It also
depends on the `live-key` precondition finding 4 asks for, which does not exist.
This part cannot be discharged from the project at all.

PART 3, NOT DONE BY CHOICE. Splitting a 400 from a 5xx in the `code` field
changes the response contract, and task 0002 §5.2 settled the neighbouring
question deliberately - "502 for both, deliberately. The status is not the
discriminator; `code` is." Reopening it is a decision with its own approval, not
a drive-by edit while nearby.

WHY THIS FINDING STAYS QUEUED: part 2 needs a system capability that does not
exist, and the general shape - a declaration nothing tests against the thing it
describes - is the system lesson.

NO TASK, NO CRITERION, NO VERDICT. This work was directed by the operator and
done outside the task pipeline, so nothing states what it was meant to achieve
and no recorded verdict covers it. That absence is deliberate - manufacturing a
spec afterwards would be a reconstruction reading as contemporaneous - and it is
itself filed as finding 28. This addendum is the durable statement that exists
instead, which is exactly the substitute finding 28 says the system should not
have to rely on prose for.

THIS FINDING IS NOT CLOSED.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 11 - No transport timeout, and could-not-reach is indistinguishable from refused

Filed: 2026-09-05T11:29:29Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `app/api/cartoonify/route.ts`

NO TRANSPORT TIMEOUT, AND "COULD NOT REACH" IS INDISTINGUISHABLE FROM "REFUSED".

Project-level finding against cartoonify, belongs to task 0002.

OBSERVED, 2026-09-05, operator running criterion 32 by hand with a live key:

  cartoonify: upstream call failed APIConnectionError: Connection error.
  cause: FetchError: request to https://api.openai.com/v1/images/edits
         failed, reason: read ECONNRESET
  type: 'system', errno: 'ECONNRESET'
  status: undefined, request_id: undefined
  POST /api/cartoonify 502 in 34248ms

A user waited 34 seconds and received a generic message. No HTTP response was ever
received - `status: undefined`, `request_id: undefined`. The request did not complete a
round trip.

PART 1: NO TIMEOUT IS CONFIGURED, AND THE ONE THAT APPLIES CONTRADICTS THE ROUTE.

  route.ts:9    export const maxDuration = 60
  route.ts:88   new OpenAI({ apiKey: ... })          // no timeout, no maxRetries

  openai@4.104.0 core.js:138   maxRetries = 2, timeout = 600000   // 10 minutes

So the SDK is willing to wait TEN MINUTES per attempt and will retry TWICE - up to roughly
thirty minutes - inside a route that declares a sixty-second ceiling. These two numbers were
written by different concerns and never reconciled.

THE CONSEQUENCE IS WORSE IN PRODUCTION THAN IT WAS LOCALLY. Today the connection died on its
own after 34s and the catch at route.ts:104 ran, returning a clean 502 with the fixed Turkish
message. On Vercel, a slow-but-alive upstream would hit `maxDuration` first: the platform
kills the function at 60s, the catch block NEVER RUNS, and the user gets a platform error
page instead of the designed error state. THE ENTIRE ERROR-HANDLING PATH THIS TASK WAS BUILT
AROUND IS BYPASSED IN THE ONE ENVIRONMENT THAT MATTERS. Criterion 14 asserts the server "does
not hang and does not return a platform 413" for oversize uploads; nothing asserts the
equivalent for a slow upstream, and that is the case that will actually occur.

  FIX: set an explicit client timeout well inside maxDuration - e.g. `timeout: 45_000` with
  `maxRetries: 1`, or `timeout: 25_000, maxRetries: 2` - so the SDK always gives up before
  the platform does and the designed catch block is what the user meets. Derive it from
  maxDuration rather than writing a second literal, so the two cannot drift apart again.

PART 2: TWO DIFFERENT FAILURES WEAR ONE FACE.

`UPSTREAM_ERROR` currently covers, indistinguishably:
  - the provider could not be REACHED (ECONNRESET, DNS, TLS, timeout - no HTTP response)
  - the provider REFUSED (400 bad format, 401 bad key, 403 unverified org, 429 quota)
  - the provider FAILED (5xx)

To the user that is one message, and CRITERION 16'S NO-LEAKAGE RULE DOES NOT REQUIRE THAT.
Criterion 16 forbids forwarding `err.message`, stack traces and upstream text. It says
nothing about distinguishing CLASSES of failure with our own fixed constants. Two additional
codes with their own Turkish messages leak nothing:

  UPSTREAM_UNREACHABLE  - "Servise şu anda ulaşılamıyor. Bağlantınızı kontrol edip tekrar
                          deneyin."   (retryable, possibly the user's own network)
  UPSTREAM_ERROR        - existing generic, for a provider that answered and refused/failed

The distinction matters in both directions. The USER is told whether retrying is worth it -
a reset is often transient, a rejected format never is. THE OPERATOR gets a code that says
which layer failed, instead of one bucket covering everything from a bad API key to a dropped
TCP connection. `APIConnectionError` is already a distinct SDK class, so this is an
instanceof check, not a heuristic.

  Note the server-side log is already correct: route.ts:104 logs the full error, which is how
  today's cause was identified at all. The gap is only in the classification returned.

PART 3: WHAT THIS DOES NOT ESTABLISH. The underlying network cause is NOT diagnosed. An
ECONNRESET with no HTTP response is consistent with a local network path, a proxy or
inspection appliance, an ISP-level block, or an upstream edge problem. The operator is
testing key and connectivity independently before anything is changed. NOTHING ABOVE DEPENDS
ON THAT ANSWER - a route that calls a paid remote API needs a timeout inside its own ceiling
and needs to distinguish unreachable from refused, whatever today's packet-level cause turns
out to be.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

### Addendum to finding 11 - Correction: unreachable does not mean transient, and the message must not invite a retry

Amended 2026-09-05T11:47:31Z, plugin 0.1.32. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

CORRECTION TO PART 2: THE `UPSTREAM_UNREACHABLE` MESSAGE MUST NOT INVITE A RETRY.

The original draft proposed:

  UPSTREAM_UNREACHABLE - "Servise şu anda ulaşılamıyor. Bağlantınızı kontrol edip tekrar
                          deneyin."   (retryable, possibly the user's own network)

BOTH PARENTHETICAL CLAIMS ARE WRONG, and today's incident is the counterexample. The
ECONNRESET was NOT transient and was NOT the user's network: the account had no credits, and
`/v1/images/edits` cut the connection mid-upload rather than returning the 429 it had already
computed. See finding 12. Retrying would have failed identically for as long as the balance
stayed at zero, at 34 seconds per attempt, and "check your connection" would have sent the
user to debug a network that was working.

A transport error from a large-body endpoint IS NOT EVIDENCE OF A TRANSPORT PROBLEM. It is
evidence that no response arrived, and the reason may be permanent, account-level, and
entirely outside anything the user can act on.

REVISED. The message should describe what is known and claim nothing about cause or
remedy:

  UPSTREAM_UNREACHABLE - "Karikatür servisine ulaşılamadı. Sorun geçici olabilir; bir süre
                          sonra tekrar deneyebilirsiniz."

  ("The service could not be reached. The problem may be temporary; you can try again
   later.") - "may be" rather than "is", no instruction to check anything, and no implication
  that a retry will work.

The distinction from `UPSTREAM_ERROR` is still worth keeping - it tells the operator which
layer failed, which is the half of the value that survives. What does not survive is the
inference that unreachable means transient.

CONSEQUENT CHANGE TO THE TIMEOUT FIX IN PART 1. `maxRetries` should be set to 0 or 1, not
left at the SDK default of 2, on this endpoint specifically. Retrying a multipart upload that
was reset costs the full timeout again and, in the case actually observed, could never
succeed. The retry budget should be bounded by wall clock inside `maxDuration`, not by
attempt count.

AND A DIAGNOSTIC ADDITION, worth more than either: BEFORE the multipart call, or on the
`APIConnectionError` path, issue a minimal small-body request to a cheap endpoint and log its
result server-side. A JSON request that returns `429 insufficient_quota` in half a second
answers the question the multipart request structurally cannot. This is not a fallback for
the user - it is server-side evidence so that the next occurrence is diagnosable from the log
alone rather than from two rounds of hypotheses.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 11 - Outcome: discharged in this project by task 0002, including the addendum's revised message and all three consequent changes

Amended 2026-09-06T13:49:05Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

DISCHARGED IN THIS PROJECT, INCLUDING THIS FINDING'S OWN CORRECTION. Confirmed
2026-09-06 against `app/api/cartoonify/route.ts` at plugin 0.1.34. Task 0002
built it.

PART 1 - THE TIMEOUT. Present and derived, not a second literal:

    export const maxDuration = 60
    const UPSTREAM_TIMEOUT_MS = Math.floor(maxDuration * 1000 * 0.75)   // 45 s
    const UPSTREAM_MAX_RETRIES = 0

and the client is constructed with both. The SDK now gives up at 45 s, inside the
60 s platform ceiling, so the designed catch block is what a user meets rather
than a platform error page - which was this finding's sharpest point, that the
entire error path was bypassed in the one environment that matters. The comment
in the source names this finding as the reason.

PART 2 - THE DISCRIMINATION. `UPSTREAM_UNREACHABLE` exists as its own code with
its own fixed Turkish constant, selected in the catch block by
`unknownError instanceof OpenAI.APIConnectionError`, with `UPSTREAM_ERROR`
retained for a provider that answered and refused or failed.

THE ADDENDUM'S CORRECTION WAS HONOURED, AND THIS IS THE PART WORTH CHECKING
RATHER THAN ASSUMING. The shipped message is the REVISED wording from this
finding's amendment - "Karikatur servisine ulasilamadi. Sorun gecici olabilir;
bir sure sonra tekrar deneyebilirsiniz." (accents stripped here only to keep this
block encoding-safe) - and NOT the original draft, which said "Baglantinizi
kontrol edip tekrar deneyin." and which the amendment retracted for claiming both
that the failure was transient and that it was the user's network. The shipped
text says "may be" rather than "is" and instructs the user to check nothing,
which is exactly what the amendment asked for.

The amendment's two other consequent changes also shipped: `maxRetries` is 0
rather than the SDK default of 2, and the retry budget is bounded by wall clock
through `UPSTREAM_TIMEOUT_MS` rather than by attempt count. The diagnostic
addition it called "worth more than either" shipped as well - see finding 12.

WHAT REMAINS, AND IT IS THE SYSTEM HALF: nothing in the standards requires a
transport budget bounded by the route's own ceiling on any other project. This
was found by a live incident, fixed here, and the next project starts with the
same SDK defaults - ten minutes per attempt, two retries - inside whatever
ceiling it declares.

HOW THIS WAS ESTABLISHED, STATED SO IT IS NOT MISTAKEN FOR A VERDICT. By reading
the tree on 2026-09-06, not by running a criterion. No acceptance criterion
asserts any of the above, and no recorded verdict covers it - this is an
inspection result written down, which is the substitute finding 28 says the
system should not have to rely on.

THIS FINDING IS NOT CLOSED. Its project half is discharged; the system half is
not, and that half is the reason it was filed with the system findings rather
than fixed and forgotten.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 12 - Provider error surface degrades with request size: same rejection, clean 429 small-body, TCP reset large-body

Filed: 2026-09-05T11:46:50Z, plugin 0.1.32.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `app/api/cartoonify/route.ts`

THE PROVIDER'S ERROR SURFACE DEGRADES WITH REQUEST SIZE: THE SAME REJECTION IS DIAGNOSABLE
WITH A SMALL BODY AND A TCP RESET WITH A LARGE ONE.

The sharpest thing observed on 2026-09-05, and the one with consequences beyond this project.

TWO REQUESTS, ONE ACCOUNT STATE, TWO INCOMPATIBLE ERROR SURFACES.

  POST /v1/images/generations   (small JSON body)
    HTTP 429 in 0.58s
    {"error":{"message":"You have no credits remaining...",
              "type":"insufficient_quota",
              "code":"credit_balance_exhausted"}}

  POST /v1/images/edits         (multipart body, a real photograph)
    APIConnectionError: FetchError: read ECONNRESET
    status: undefined, request_id: undefined
    34 seconds, no HTTP response at all

THE ACCOUNT WAS OUT OF CREDIT IN BOTH CASES. The key was valid, the network was fine, the
format was fine, the filename was irrelevant, organisation verification was never involved.

THE MECHANISM. `/v1/images/edits` begins receiving a multipart upload, the quota check fails
partway through, and the connection is cut MID-UPLOAD rather than draining the body and
returning a clean 429. `/v1/images/generations` has a JSON body small enough to arrive
completely before the check runs, so the check can answer properly. Same rejection, same
cause, and whether the client learns the reason depends on how many bytes it was sending.

WHY THIS IS THE INTERESTING ONE. Everything else found today is a gap between what a system
declares and what it enforces. This is a gap between what a REJECTION IS and what it can be
OBSERVED TO BE, and it is not in our code at all. An application cannot distinguish
"we are out of credit" from "the network broke" for any request large enough to trigger it -
the information does not reach the process. No amount of care on this side recovers it,
because it was never sent.

AND IT IS INVISIBLE IN THE DIRECTION THAT MISLEADS. The failure presents as the most
transient-looking error class there is. Every instinct - and the SDK's own default
`maxRetries: 2` - says retry a connection reset. Retrying was guaranteed to fail here, for
as long as the balance stayed at zero, at 34 seconds per attempt.

CONSEQUENCES FOR ANY CLIENT OF THIS API, NOT ONLY THIS PROJECT:

  1. AN `APIConnectionError` ON A LARGE-BODY ENDPOINT MUST NOT BE TREATED AS TRANSIENT. It
     may be a permanent, account-level refusal wearing a transport error's clothes. This
     directly corrects the fix drafted in finding 11, where `UPSTREAM_UNREACHABLE` was
     described as "retryable, possibly the user's own network". See the amendment there.

  2. A HEALTH OR PREFLIGHT PROBE SHOULD USE THE SMALLEST-BODY ENDPOINT AVAILABLE, not the one
     the feature uses. A one-line JSON request to a cheap endpoint answers the question that
     the real request structurally cannot. That is what identified today's cause after two
     rounds of wrong hypotheses, in 0.58 seconds.

  3. RETRY BUDGETS SHOULD BE BOUNDED BY WALL CLOCK, not attempt count, on multipart uploads.
     Two retries of a 34-second reset is 100 seconds spent learning nothing, inside a route
     that declares a 60-second ceiling (finding 11).

  4. WORTH REPORTING UPSTREAM. Cutting a connection mid-upload instead of draining and
     returning the 429 the check already computed is a server-side choice, and the 429 exists
     - `/v1/images/generations` returns it. The information is available at the moment the
     connection is cut and is discarded.

WHAT THIS DOES NOT CLAIM. It is not established whether the cut happens at the API edge, a
load balancer, or somewhere else in the path, nor whether it is deliberate (shedding a body
that will be discarded anyway) or incidental. The observable fact is sufficient for every
consequence above: same account state, same rejection, and diagnosability depends on body
size.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

### Operator disposition of finding 12 consequence 4 - permanently out of scope, not pending

Recorded: 2026-09-05, by the operator, during task 0002.

CONSEQUENCE 4 ("worth reporting upstream") IS CLOSED AS OUT OF SCOPE FOR THIS PROJECT, AND
IT IS CLOSED PERMANENTLY RATHER THAN LEFT UNACTIONED.

The distinction matters and is the whole of this note. Consequences 1, 2 and 3 are code in
this repository and are being built now as task 0002. Consequence 4 is an action against a
third-party account - opening a report with the provider, from a person with standing to
open it - and NO TASK IN THIS SYSTEM CAN CARRY IT. There is no file to edit, no criterion
that could be checked, and no agent that could perform it. A backlog entry that no possible
task can discharge is not a backlog entry; it is a line that reads as pending forever and
teaches the reader to discount everything next to it.

So it is not "unactioned". It is dispositioned: this project will not carry it, and its
absence from every future task list is the recorded decision rather than an oversight.

WHAT IS NOT BEING CLAIMED. Consequence 4 is not withdrawn as an observation - cutting a
connection mid-upload instead of draining and returning the 429 the check already computed
is still a server-side choice that discards information it holds. Whether anyone reports it
upstream is the operator's, outside this repository, and unrecorded here either way. The
finding itself stays pending on consequences 1-3 until they are applied in the system repo.

DO NOT re-open this as a task, and do not count it against finding 12 when finding 12 is
cleared.

---

### Addendum to finding 12 - Outcome: consequences 1-3 discharged in this project; consequence 4 stays dispositioned; the client-facing lessons remain unheld by the standards

Amended 2026-09-06T13:49:05Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

CONSEQUENCES 1-3 DISCHARGED IN THIS PROJECT; CONSEQUENCE 4 WAS DISPOSITIONED BY
THE OPERATOR. Confirmed 2026-09-06 against `app/api/cartoonify/route.ts`.

CONSEQUENCE 1 - an `APIConnectionError` on a large-body endpoint must not be
treated as transient. Honoured: the `UPSTREAM_UNREACHABLE` message claims only
that the problem "may be" temporary, instructs the user to check nothing, and the
same branch fires the probe rather than a retry. See the outcome addendum on
finding 11 for the exact wording and why it is the revised one.

CONSEQUENCE 2 - a probe should use the smallest-body endpoint available, not the
one the feature uses. Shipped as `logSmallBodyProbe()`, and it matches this
consequence precisely: its own client, `models.list()` (GET /v1/models, not the
edits endpoint the feature calls), `PROBE_TIMEOUT_MS` of 6 s derived from
`maxDuration`, `maxRetries: 0`. It treats ANY HTTP response - including 401,
429 and 400 - as `result=reached`, which is the whole diagnostic point: the
question it answers is whether a response arrived at all, which the large request
structurally cannot answer. It swallows every error and returns void, so a probe
failure can never replace the designed 502, and it writes only to the server-side
log; nothing about it reaches the response body.

CONSEQUENCE 3 - retry budgets bounded by wall clock, not attempt count, on
multipart uploads. Shipped: `UPSTREAM_TIMEOUT_MS` is 0.75 of `maxDuration` and
`UPSTREAM_MAX_RETRIES` is 0, so the two-retries-of-a-34-second-reset case this
consequence describes cannot occur.

CONSEQUENCE 4 - report upstream. Closed permanently as out of scope for this
project by operator disposition, recorded 2026-09-05 in this finding's own block.
Not unactioned; dispositioned. It is not to be re-opened as a task and not to be
counted against this finding.

WHAT REMAINS, AND IT IS THE SYSTEM HALF: the header of these four says
"CONSEQUENCES FOR ANY CLIENT OF THIS API, NOT ONLY THIS PROJECT". They are
standards guidance and the standards do not carry them. Consequence 2 in
particular - diagnose with the smallest-body endpoint, never the feature's -
identified the real cause in 0.58 seconds after two rounds of wrong hypotheses,
and there is nowhere in the system that a future project would learn it.

HOW THIS WAS ESTABLISHED, STATED SO IT IS NOT MISTAKEN FOR A VERDICT. By reading
the tree on 2026-09-06, not by running a criterion. No acceptance criterion
asserts any of the above, and no recorded verdict covers it - this is an
inspection result written down, which is the substitute finding 28 says the
system should not have to rely on.

THIS FINDING IS NOT CLOSED. Its project half is discharged; the system half is
not, and that half is the reason it was filed with the system findings rather
than fixed and forgotten.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 13 - Router gained the incomplete action at 0.1.33 and the ship skill's action table did not

Filed: 2026-09-05T14:27:11Z, plugin 0.1.33.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `skills/ship/SKILL.md`

Observed on cartoonify task 0002, plugin 0.1.33, 2026-09-05. The attempt-1 verdict for task 0002 recorded verdict pass with five legal.pages_present warnings and NO criteria array. route.mjs returned: action incomplete, dispatch null, operator true, exit code 1, why 'attempt 1 of task 0002 has a verdict that does not say whether the acceptance criteria were met: it records no criteria at all.' The fail-closed arm worked exactly as designed - running the orphaned 0.1.32 route.mjs against the SAME project state returned action document, dispatch mavci-scribe, operator false, exit 0, why 'task 0002 passed attempt 1', with steps that would have advanced 0002 to release and marked it done. That counterfactual is the fix demonstrated. THE DEFECT IS ONE LEVEL UP. skills/ship/SKILL.md is the document that tells the orchestrator what to do with each action, and its table at lines 111-123 has rows for plan, build, rework, verify, document, awaiting_approval, blocked, release_gate, unverified, idle and not_connected. There is no row for incomplete. The prose above the table still reads 'One of those six stopping actions is new' and means awaiting_approval, and the 'Do not continue past' line names only blocked, release_gate, unverified and idle. So 0.1.33 added an action to route.mjs ACTIONS and did not add it to the only skill that consumes ACTIONS. I stopped correctly, but I stopped by INFERRING it from dispatch null plus operator true, not because the table told me to. An orchestrator that follows the table literally - which is what the table is for - finds no instruction and falls through. SECOND OBSERVATION, same run. The verdict had no criteria array because nothing could write one. 0.1.33 shipped the plumbing half of finding 6 fix 3 as verify.mjs with a criteria flag taking a path, and its own comment at verify.mjs lines 413-421 states the agent half is absent: mavci-verifier holds no Write and no Edit, so only the main session can supply that file, and ship/SKILL.md separately forbids the main session from running verify.mjs at all. The result is that no permitted actor in the chain can populate criteria today. That is the intended fail-closed state and it is also a closed loop: the only named exit is the operator override that closes the task on evidence the control plane does not hold.

### The assertion, and the broken build it must catch

Enumerate ACTIONS from scripts/lib/route.mjs and assert every member has a row in the action table of skills/ship/SKILL.md, and that every action which route.mjs can return with operator true and dispatch null also appears by name in that skill's 'Do not continue past' list. Against the 0.1.33 tree as shipped this assertion MUST FAIL on incomplete, which is present in ACTIONS and absent from both places - that is the broken build it has to catch. check-route.mjs already asserts route.mjs's own behaviour, so the gap is specifically between the router's action set and the skill that dispatches on it, and nothing today reads both files.

---

# Finding 14 - Risk guard refuses retro --record when the finding PROSE quotes a control-plane path, contradicting its own refusal message

Filed: 2026-09-05T14:27:33Z, plugin 0.1.33.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/risk-guard.mjs`

Observed on cartoonify, plugin 0.1.33, 2026-09-05, immediately before filing finding 13. I ran retro.mjs --record with a --finding string that mentioned the attempt-1 verdict file for task 0002 by its full repository-relative path. The guard refused with: 'mavci risk policy: the write target of this command could not be determined, and it names a path inside DOT-mavci slash control slash (node ... retro.mjs --record "Router gained the incomplete action at 0.1.33 and the ship). This is not a claim that it writes there - it is that the guard cannot tell, so it refuses rather than guess. Run it as a plain command whose target is visible (cat, jq, cp ...), or use state.mjs if it really does need to write. Quoting a control-plane path inside a message or a string operand is fine and is not what this is about.' THE LAST SENTENCE DESCRIBES EXACTLY WHAT I DID, AND THE GUARD REFUSED IT ANYWAY. The path appeared only inside the --finding operand. retro.mjs --record writes to the lessons directory, which is agent-writable by design, and the retro skill states that filing is within an agent's authority. Note also that the quoted echo of my command in the refusal is truncated mid-string at 'and the ship', which suggests the scanner is matching against a raw substring of the argv join rather than against a parsed operand. THE CONSEQUENCE IS THE ONE THAT MATTERS: this is the reporting channel seven other places in the plugin send a blocked agent to, and it refuses precisely the findings that are ABOUT the control plane - which, given that the control plane is what most findings are about, is the class of report most likely to need filing. I worked around it by paraphrasing the path out of the prose. A less stubborn caller files a vaguer finding, or none.

### The assertion, and the broken build it must catch

Assert that retro.mjs --record succeeds when a control-plane path appears ONLY inside the --record, --finding, --target or --assertion operand and nowhere as a redirect or write target. The broken build to catch is the 0.1.33 guard as shipped: run retro.mjs --record with a finding string containing a verdicts path under the control directory and confirm the guard currently DENIES it. The assertion must distinguish an operand from a write target, so it also needs the negative case - a genuine redirect into the control directory must still be refused, or the fix has simply disabled the rule.

---

# Finding 15 - Doctor demands a guardian corpus result on projects where the worklist emitter refuses to produce one, and the only reachable remedy is falsifying the manifest

Filed: 2026-09-05T14:34:32Z, plugin 0.1.33.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/doctor.mjs`

C:/Users/MEHMET~1/AppData/Local/Temp/claude/C--Projelerim-cartoonify/551fe325-9565-4fc7-bf07-9d289b42678b/scratchpad/corpus-finding.txt

### The assertion, and the broken build it must catch

C:/Users/MEHMET~1/AppData/Local/Temp/claude/C--Projelerim-cartoonify/551fe325-9565-4fc7-bf07-9d289b42678b/scratchpad/corpus-assert.txt

### Addendum to finding 15 - The finding text, supplied - the body as filed was a path, not the observation

Amended 2026-09-05T14:35:01Z, plugin 0.1.33. Amended by: **main-session** (agent). Provenance enforced at the risk guard, not self-declared. It attests to who RAN this command, and to nothing about who directed it.

THE BODY OF THIS FINDING WAS FILED AS A FILE PATH INSTEAD OF ITS TEXT, AND THIS AMENDMENT
SUPPLIES WHAT SHOULD HAVE BEEN THERE.

The cause is a defect in retro.mjs itself and is filed separately: --record --finding and
--record --assertion take PROSE, while --amend --text and --was take a PATH. Passing a path
to --record is accepted silently and stored verbatim as the body. Nothing refused, and the
queue held a finding whose entire content was an absolute path into a session-scoped
scratchpad directory that will not exist tomorrow.

The text below is the observation as it should have been recorded. Nothing in it has been
changed to suit the correction.

---

Observed: 2026-09-05, plugin 0.1.33, project cartoonify, project phase verify.

DOCTOR OPENS WITH A FAIL THIS PROJECT CANNOT CLEAR BY ANY LEGITIMATE ACTION, BECAUSE THE
EVIDENCE IT DEMANDS CANNOT BE PRODUCED HERE AT ALL.

WHAT WAS RUN, IN THE ORDER THE CORPUS README GIVES.

  corpus-stage.mjs --list
    q3v7k, m8f2r, t5w9d

  corpus-stage.mjs --case q3v7k
    staged case q3v7k -> corpus-run/ (3 file(s))

  worklist.mjs --emit
    exit 2
    ::error::tenancy.isolation is "none", not "application-filters". Guardian answers a
    question about application-code filters; on any other isolation it would be asking
    about a mechanism this project does not use.

That refusal is CORRECT. The manifest is not wrong and must not be edited: cartoonify
declares tenancy.model single-tenant, tenancy.isolation none, and stack.db none, stack.auth
none, stack.payments none. It has no Supabase, no tenants and no tenancy filters. There is
no query site for guardian to ask its one question about, and the emitter says so precisely.

The staging was cleared afterwards and the tree left as found.

THE DEADLOCK, STATED AS THE TWO STATEMENTS THAT CANNOT BOTH BE SATISFIED.

  doctor, on every run, first line, FAIL:
    "no guardian acceptance corpus result for plugin 0.1.33 ... an absent result is a FAIL,
     never a silence. The operator runs the guardian acceptance corpus and records the
     outcome at the guardian corpus path. Until then, a passing guardian verdict on this
     project rests on nothing."

  worklist.mjs --emit, on this project, always:
    exit 2, because tenancy.isolation is "none".

Recording a corpus result requires scoring every case in one invocation; scoring a case
requires a worklist; emitting a worklist requires an isolation this project does not have
and should not claim. The FAIL is therefore not a task anybody can complete. It is a
permanent red line on a health report, produced by a project being accurately described.

THE THIRD FACT, WHICH SETTLES WHAT THE FIX IS. This project does not enable guardian.
.mavci/project.json agents.enabled is mavci-architect, mavci-builder, mavci-verifier,
mavci-scribe. Guardian is absent from it.

So doctor is failing this project for missing evidence about the judgement of an agent the
project does not run, cannot run, and has correctly declared it has no work for. The final
clause of doctor's own message - "a passing guardian verdict on this project rests on
nothing" - is true and empty here: there is no guardian verdict on this project and there
never will be one.

WHY THIS MATTERS MORE THAN ONE NOISY LINE. It is the top line of every doctor run on this
project, marked FAIL where everything else is WARN, and it will never go away. The cheapest
relief available to whoever gets tired of it is a one-word edit - tenancy.isolation from
"none" to "application-filters" - which clears the line by making the manifest describe a
mechanism the project does not use. That edit would then feed every rule that reads
tenancy. A health check whose only reachable remedy is falsifying the manifest is worse
than an absent check, and this one is reachable in a single word.

Recorded so the next reader does not have to rediscover it: the corpus was NOT run and NOT
recorded on this project, and that is not an omission by whoever last looked at it.

RELATED, AND NOT THE SAME. Finding 1 (product type is not declarable) is about
architectural fields being REQUIRED of projects they do not describe. This is the
consequence one layer on: the field is declared correctly, and a health check keyed to a
different value of it fails forever. Finding 3 (router deadlock) is the same shape in the
router. This one is in doctor, and unlike those two it cannot be cleared by any command in
the plugin.

---

### The assertion, and the broken build it must catch — supplied here for the same reason

THE BROKEN BUILD IS 0.1.33 AS INSTALLED, AND IT IS OBSERVABLE WITHOUT A MODEL.

Broken build: a project manifest with tenancy.isolation "none" and guardian absent from
agents.enabled. doctor emits the corpus FAIL. worklist.mjs --emit exits 2. Both are current
behaviour and they contradict each other.

ASSERTION. doctor's corpus check must be conditioned on guardian being runnable on the
project, by the same predicate worklist.mjs --emit uses to refuse - not by a second, parallel
reading of the manifest, which is how the two got out of step. Concretely: if
worklist.mjs would refuse to emit on this manifest, doctor must not FAIL for an absent
corpus result. It should report that guardian does not apply to this project and say why,
which is a different line and a different colour from "the operator has not run it yet".

check-doctor.mjs (or wherever doctor's branches are already exercised) asserts, on a fixture
manifest with tenancy.isolation "none": doctor's output contains no corpus FAIL, and
contains the not-applicable line.

WOULD IT CATCH TODAY'S BUILD? Yes. It fails on first run against 0.1.33 with no other
change, which is the point of writing it now rather than after the fix.

THE ADJACENT ASSERTION THAT WOULD NOT CATCH IT, recorded so it is not written by mistake:
asserting that doctor FAILs when the corpus result is absent. That is the check that exists,
it passes today, and it is the half that is wrong here - it is right about every project
where guardian runs and wrong about every project where it cannot.

WHAT THE ASSERTION MUST NOT ACCEPT AS SATISFACTION. Downgrading the corpus FAIL to a WARN
everywhere. The FAIL is correct on a project that does use application filters, and it is
the only thing standing behind guardian's judgement there. The condition is
applicability, not severity. A fix that makes the line quieter on the projects where it is
load-bearing has traded the finding for its opposite.

**Superseded, quoted verbatim from the body above:** C:/Users/MEHMET~1/AppData/Local/Temp/claude/C--Projelerim-cartoonify/551fe325-9565-4fc7-bf07-9d289b42678b/scratchpad/corpus-finding.txt

---

### Addendum to finding 15 - Stated at full width: a check that cannot pass honestly creates pressure to pass it dishonestly, and finding 1 is this finding from the other direction

Amended 2026-09-05T14:41:35Z, plugin 0.1.33. Amended by: **main-session** (agent). Provenance enforced at the risk guard, not self-declared. It attests to who RAN this command, and to nothing about who directed it.

STATED AT ITS FULL WIDTH BY THE OPERATOR, 2026-09-05, AND RECORDED HERE BECAUSE THE FILING
ABOVE UNDERSTATES IT AS A DOCTOR BUG.

A CHECK THAT CANNOT PASS HONESTLY CREATES PRESSURE TO PASS IT DISHONESTLY, AND HERE THE
DISHONEST PASS IS ONE WORD.

That is the finding. Not that doctor prints a red line it should not print - that doctor
prints, on every run, permanently, a FAIL whose only reachable remedy from inside the
project is to change tenancy.isolation from "none" to "application-filters" in the manifest.
That edit takes seconds, requires no argument with anybody, produces a green health report,
and makes the manifest assert that this project isolates tenants with application-code
filters. It has no tenants. It has no database. The edit is a lie that looks like
maintenance, and the system asks for it every time the operator runs doctor.

Everything else in this queue is a system that fails to enforce what it declares. This is a
system applying steady pressure toward a false declaration, and being the party that will
then read that declaration and act on it. The manifest is an input to the standards packs
and to the rules; a project that has claimed application-filters to clear a health check has
also changed what every subsequent check believes about it.

THE SEVERITY IS IN THE ASYMMETRY. Honest state: a permanent FAIL, forever, on a project
where nothing is wrong. Dishonest state: green, instantly, with no warning and no reviewer.
The system offers no third option and no way to record "guardian does not apply here" -
which is the true statement, and the one thing that cannot currently be said.

FINDING 1 AND FINDING 15 ARE THE SAME DEFECT FROM TWO DIRECTIONS, AND NEITHER IS COMPLETE
WITHOUT THE OTHER.

Finding 1 is the entry gap: architectural fields are REQUIRED of projects they do not
describe, so a project that does not fit the mould cannot be declared accurately in the
first place. Finding 15 is the exit gap: a project that IS declared accurately, in the one
field the mould permits it to say "none" in, then fails a health check permanently and can
only clear it by retracting the accurate declaration.

Read together they say: the system has a product shape, projects that differ from it must
either misdescribe themselves on the way in or carry a permanent FAIL afterwards, and the
cheapest exit from the second is the first. Fixing doctor's branch alone leaves finding 1
standing. Fixing declarability alone leaves this FAIL wherever a legitimately "none" project
lands. The pair is the work.

HOW THIS SURFACED, WHICH IS THE ONLY REASON IT SURFACED AT ALL. cartoonify is the first
project connected to this system that genuinely does not fit: single-tenant, no database, no
auth, no payments, one image route and five legal pages. Every earlier project matched the
multi-tenant SaaS shape the plugin was built around, so the corpus requirement and the
tenancy fields agreed with reality by coincidence rather than by design. The defect is not
new; today is the first time anything stood in a position to observe it. Expect the same for
the other architectural fields the moment a project declines the next assumption.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 15 - Two addenda here carry a false provenance stamp, including the one that supplies this finding's body

Amended 2026-09-06T13:28:56Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

TWO FALSELY STAMPED ADDENDA IN THIS FINDING. They are:

  1. "The finding text, supplied - the body as filed was a path, not the
     observation", Amended 2026-09-05T14:35:01Z, plugin 0.1.33.
  2. "Stated at full width: a check that cannot pass honestly creates pressure to
     pass it dishonestly, and finding 1 is this finding's entry gap",
     Amended 2026-09-05T14:41:35Z, plugin 0.1.33.

Both stamped: Amended by: **main-session** (agent).

NOTE THE FIRST ONE PARTICULARLY. It exists to SUPPLY THE FINDING'S BODY, which
had been filed as a path rather than the observation (finding 16). So the block
carrying this finding's actual evidence is one of the blocks whose attribution is
false. The evidence is unaffected; only the claim about who recorded it is wrong.

WHY THE STAMP IS FALSE. It reads "Provenance enforced at the risk guard, not
self-declared." Nothing enforced it. The guard's comparison lives in
risk-guard.mjs and is gated on `agent_type`, which is present for a subagent and
ABSENT for the main session; a main-session caller therefore passes any value it
likes and the comparison never runs. Worse, `main-session` IS NOT AN AGENT:
agents/agent-scopes.json declares exactly five - mavci-architect, mavci-builder,
mavci-guardian, mavci-scribe, mavci-verifier. Had a subagent declared
`--agent main-session`, the guard would have DENIED it as "not itself". It was
not denied because there was no caller identity to compare against.

HOW TO READ THESE BLOCKS. Treat them exactly as if they said "Amended by: not
recorded ... Treat it as unattributed", which is what the other thirteen addenda
in this queue say and what these should have said. Specifically, the stamp is
NOT evidence that an agent authored the block, and NOT evidence that anything
verified who did. It is a string that was typed and echoed.

THE STAMPS ARE NOT EDITED, AND MUST NOT BE. This queue is append-only -
"no path here edits a filed byte" - and rewriting a stamp would erase the fact
that it was ever wrong, which is the same objection the queue raises against
replacing a filed sentence. This addendum is the correction; the bytes stay.

IDENTIFIED BY TITLE AND TIMESTAMP, NOT BY LINE NUMBER. Finding 24's addendum
cited line numbers, and they are already stale: amending finding 9 inserted text
inside an earlier block and shifted every line after it. In a file that appends
inside blocks, a line number is not an identifier.

Full analysis, both holes and the driven reproductions: finding 24.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 16 - retro.mjs --record silently stores a file path as the finding body, while --amend refuses prose and demands a path - the same input in opposite forms, one of them unchecked

Filed: 2026-09-05T14:35:21Z, plugin 0.1.33.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/retro.mjs`

Observed: 2026-09-05, plugin 0.1.33, project cartoonify, filing finding 15 from the main session. The two halves of this command take the same conceptual input in opposite forms. --amend takes --text and --was as a PATH or -, never prose, and the skill states the reason: an argument goes through the shell, and on 2026-09-04 a finding reached a queue having lost four backticked words to command substitution, one of them the exact word the finding was about. --record takes --finding and --assertion as PROSE. A caller who has just read the --amend rule, or who reaches --record after using --amend, passes a path. THE PATH IS ACCEPTED AND STORED VERBATIM AS THE BODY. Nothing warned and nothing refused. Finding 15 was queued with a body reading in its entirety: an absolute path into a session-scoped scratchpad that will not exist tomorrow, and a second one under the assertion heading. It was repaired by amendment, which is the only route available since the finding text is deliberately immutable - so the queue now permanently carries a finding whose body is a dead path and whose real content is in an addendum below it. THE ASYMMETRY IS THE DEFECT, NOT THE CALLER. Both halves write the same file. One of them was hardened against shell mangling by taking a path, and the hardening was not carried across, so the safe form is refused where it is unsafe and the unsafe form is unchecked where it is safe. Note also what makes this worse than a usage error: --record is the channel seven blocked paths in the plugin send an agent to, and its failure mode is silent corruption of the record rather than a refusal the agent could act on.

### The assertion, and the broken build it must catch

THE BROKEN BUILD IS 0.1.33 AS INSTALLED. Assertion: retro.mjs --record refuses a --finding or --assertion argument that resolves to an existing file on disk, with a message naming the flag and saying that --record takes prose while --amend takes a path. check-retro.mjs asserts it by calling --record with a --finding argument that is a real path and requiring a non-zero exit and an empty queue. WOULD IT CATCH TODAY'S BUILD? Yes - it fails on first run against 0.1.33 with no other change. Stronger and better: make --record accept a path the way --amend does, and then the assertion is that both halves accept the same form, exercised by filing the same finding through each and comparing the stored bodies. THE ADJACENT ASSERTION THAT WOULD NOT CATCH IT: asserting that --record stores the --finding argument verbatim. That passes today and is exactly the behaviour that caused this. WHAT IT MUST NOT ACCEPT AS SATISFACTION: documenting the difference in the skill. The skill already documents the --amend rule clearly, and that is what led the caller to pass a path to the other half.

---

# Finding 17 - Acceptance criteria written as inline node -e one-liners cannot run as written: the shell strips the escaping before node sees it, so the criterion that passes is never the criterion the spec states

Filed: 2026-09-05T14:41:07Z, plugin 0.1.33.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `agents/mavci-architect.md`

Observed: 2026-09-05, plugin 0.1.33, project cartoonify, task 0002, during verification of criteria 7, 12 and 14. THE SPEC'S STATED COMMANDS WERE NOT THE COMMANDS RUN, THE CRITERIA WERE MET ANYWAY, AND NOTHING IN EITHER ARTEFACT RECORDS THE DIFFERENCE. Task 0002's architect wrote several acceptance criteria as inline node -e one-liners carrying regex escaping - double-backslash sequences such as backslash-backslash-dot and backslash-backslash-open-paren. mavci-verifier reported that these could not be run verbatim: the Bash tool collapses the double-backslash sequences before they reach node -e's inline argument, which breaks the regex construction regardless of what the file being checked contains. It reproduced the mechanism independently rather than inferring it: node -e printing JSON.stringify of a two-character escaped string returned the collapsed single-character form, not the escaped one. THE VERIFIER HANDLED IT CORRECTLY, AND THAT IS PART OF THE PROBLEM. It wrote equivalent checks to a file, avoiding the argument-passing path entirely, used string search in place of regex escaping, and ran them with node against the file. Criteria 7, 12 and 14 passed on those equivalents: the derived budget arithmetic came out at 45000, 6000 and 0 retries; the message text was exact and the banned phrasing absent; the probe was confirmed to contain no response-returning call. The judgements are sound. WHAT IS LOST IS THE CORRESPONDENCE BETWEEN THE APPROVED SPEC AND THE EXECUTED CHECK. The operator approved a spec by content hash. Three of its criteria name commands that cannot execute as written on this platform. A different verifier writing a different equivalent could check something adjacent to what was specified and report the same pass, and no artefact would show it: the spec still states the one-liner, and the recorded verdict carries no per-criterion detail at all, so neither end holds the substitution. It survived here because the verifier volunteered the methodology note in prose. THIS IS ARCHITECT-SIDE, NOT VERIFIER-SIDE, AND IT WILL RECUR. Nothing in the plan step stops a criterion being written this way, and inline node -e is the natural form for an assertion about file contents - it is how a person tests an idea at a prompt. Every spec written that way carries the same trap, and the trap fires at verify time on a different agent, one approval later, where the cheapest response is a silent workaround.

### The assertion, and the broken build it must catch

THE BROKEN BUILD IS TASK 0002'S SPEC AS APPROVED, WHICH IS ON DISK AND UNMODIFIED. Assertion: a spec check rejects any acceptance criterion whose command is an inline node -e (or python -c) invocation carrying a backslash in its argument, naming the criterion number and saying that the escaping will not survive the shell and the check must be written to a file and run as node <file>. It runs at plan time, before the operator is asked to approve, because approval by content hash is exactly the moment the spec's commands become the thing being agreed to. WOULD IT CATCH TODAY'S BUILD? Yes. Run against task 0002's spec it fails immediately on criteria 7, 12 and 14, with no other change to the plugin - which is the point of writing it against the spec that already exists rather than a fixture invented afterwards. THE ADJACENT ASSERTIONS THAT WOULD NOT CATCH IT, recorded so they are not written by mistake. First: asserting that every acceptance criterion is executable, by executing it. That is what verification already does, and it passed - because the verifier substituted a working equivalent, which is the behaviour being described rather than a defect it would surface. Second: asserting the spec's criteria are syntactically well-formed shell. They are well-formed shell; they are well-formed shell that means something other than what was written. WHAT IT MUST NOT ACCEPT AS SATISFACTION: instructing the verifier to write equivalents to files when a one-liner fails. It already does that, it did it correctly here, and the result is a passing verdict whose relationship to the approved spec is recorded nowhere. Pushing the handling further down makes the substitution more routine and no more visible. The criterion has to be executable as written, or the spec has to say what file to run.

---

# Finding 18 - Propagation reports success after a failed fetch: git checkout -B main origin/main says up to date about a stale ref

Filed: 2026-09-05T17:52:05Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `ARCHITECTURE section 2 step 5 - the propagation procedure, the fetch and git checkout -B main origin/main pair`

Observed 2026-09-05, plugin 0.1.34, while propagating 0.1.34 to the marketplace clone. The propagation procedure runs a fetch and then git checkout -B main origin/main in the marketplace clone. THE FETCH FAILED. NOTHING STOPPED. The checkout then ran against the origin/main ref already on disk from the previous propagation, succeeded, and printed: Your branch is up to date with origin/main. THAT STATEMENT IS TRUE AND USELESS. Local main did equal the ref named origin/main. But origin/main was the stale ref the failed fetch was supposed to update, so the pair reported a successful synchronisation while having synchronised nothing. The step that would have caught the staleness is the one that silently failed before it, and the step that reported success has no way to know that. TWO COMMANDS, ONE REPORTING SUCCESS ABOUT THE OTHER FAILURE. Note the direction, which is the same as every finding filed this week: a reader takes a true NARROW statement (local main equals the ref named origin/main) for the WIDER one they came for (the clone holds what the remote holds). The narrow statement is never wrong, which is why it is never questioned. PARTIAL MITIGATION ALREADY PRESENT, AND WHY IT IS NOT ENOUGH: doctor checks this at the line reading marketplace clone current with origin/main, and on this machine it now reports ok at df3b356. But doctor is a separate command run later at the operator discretion. Between a propagation that silently did nothing and the next doctor run, the operator has been told in the propagation output itself that the propagation worked. The check exists in the tool nobody is required to run, and not in the procedure that produced the wrong impression.

### The assertion, and the broken build it must catch

ASSERT ON THE FETCH EXIT STATUS, NOT ON ITS OUTPUT AND NOT ON THE CHECKOUT. The propagation must abort loudly when the fetch fails, rather than proceeding to a checkout that will report up to date regardless. THE BROKEN BUILD IT MUST CATCH: a propagation in which the fetch runs without set -e, or as a link in a chain whose failure is swallowed, or whose failure appears only in stderr the caller does not read - and which therefore completes, prints up to date, and leaves the clone at the previous release. CONFIRM THE ASSERTION FAILS AGAINST THAT BUILD FIRST: point the clone at an unreachable remote so the fetch genuinely fails, run the propagation, and require the assertion to FAIL. An assertion that passes on its first run against that build is watching the checkout - which will always say up to date - and not the fetch, and it is the adjacent assertion rather than the one that matters, which is the Gate 4 failure mode. SECOND, WEAKER ASSERTION WORTH HAVING ALONGSIDE: after propagation, require the clone HEAD sha to equal the sha the release tag names, and treat an inability to make the comparison as a failure rather than as a pass.

---

# Finding 19 - Risk guard denies a pure sed read of the control plane with a message asserting it writes, and closing: reading it is allowed

Filed: 2026-09-05T17:53:49Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/risk-guard.mjs, WRITE_ALL_OPERANDS at line 138 (sed, awk, perl) and the denial message it produces`

Observed 2026-09-05, plugin 0.1.34, project cartoonify, from the main session while reading a task spec. Paths below are written descriptively rather than literally, for a reason recorded as a separate finding. THE COMMAND: sed -n 1,120p on the task 0002 spec file in the control plane specs directory - a print-range read, no -i, no in-place flag of any kind, no redirect. THE RESPONSE, verbatim apart from the path: mavci risk policy: this command WRITES to [the spec file], inside the control plane directory, outside state.mjs. The control plane holds the phase, retry ceiling, baseline and waivers; writing it directly bypasses validation, redaction and the integrity seal. The seal will detect it anyway. Use state.mjs. READING IT IS ALLOWED AND NEEDS NO WORKAROUND. That last sentence is true, and it is printed at the exact moment a read is being refused. ISOLATED AND CONFIRMED, two commands, same file, same session: head -n 2 on the control plane state file SUCCEEDED and printed the file; sed -n 1,2p on that same file was DENIED with the message above. The difference is the command name and nothing else. CAUSE, LOCATED: risk-guard.mjs line 138 places sed, awk and perl in WRITE_ALL_OPERANDS, whose own comment reads Every operand is a write target. cat and head sit in READ_HEADS at line 129. Every sed invocation is therefore classified as writing every operand it names, whatever its flags. THIS IS NOT THE FAIL-CLOSED-ON-UNRECOGNISED PATH defended by the block comment at line 122, and that path should not be weakened. sed here is RECOGNISED and deliberately over-approximated, which is a defensible policy. What is not defensible is the message: it states as a FACT that the command writes to the file - something the guard never determined and which was false here - and then closes by describing the very operation it refused as permitted. THE SHAPE OF THIS WEEK, INVERTED: elsewhere a true NARROW statement is taken for a wider one; here a true GENERAL statement (reads are allowed) is printed where it contradicts the specific action being refused, so the reader concludes the fault is in their own command and rewrites one that was already correct. WORKAROUND USED: cat, then awk for line ranges - and awk is in the same set, so it would have been refused identically had that path been under the control plane. The set of read-only tools an agent may use on the control plane is narrower than the message claims and narrower than it needs to be.

### The assertion, and the broken build it must catch

TWO ASSERTIONS; THE FIRST IS THE ONE TO SHIP. FIRST, ON THE MESSAGE. When a command is refused by CLASSIFICATION rather than by a determined write target, the message must say so - that sed, awk and perl are treated as writers because they CAN write, not that this invocation DOES write - and it must not close with a sentence stating that the refused operation is allowed. Assert on the refusal text produced for a classified-writer denial: it must NOT contain the phrase reading it is allowed, and must not assert that the command writes to a path unless a write target was actually determined. THE BROKEN BUILD IT MUST CATCH: precisely the build shipped as 0.1.34, in which the sed denial and a genuine write denial share one message template. Run the assertion against 0.1.34 FIRST and require it to FAIL. An assertion that passes there is matching the template text rather than the classification that selected it, which is the Gate 4 adjacent-assertion failure. SECOND, ON THE CLASSIFICATION, only if sed is to be made readable. In-place detection must be exact and fail closed. The assertion must cover sed -i, sed -i.bak, sed --in-place, sed -n -i, the -i bundled in a combined short flag such as sed -ni, and a w command inside the script body such as sed -n 2w out.txt, and must refuse any form it does not recognise. THE BROKEN BUILD IT MUST CATCH: the naive fix that admits sed whenever the argument list contains -n, which lets sed -ni through and converts a false positive into a hole in the control plane. Require the assertion to FAIL against that naive fix before accepting it. IF THAT EXACTNESS CANNOT BE REACHED, KEEP THE DENIAL AND FIX ONLY THE MESSAGE. Over-refusing a read costs one workaround; that is why this finding is filed against the message first.

---

# Finding 20 - The reporting channel cannot report on the control plane: retro --record is refused when the finding text names a control-plane path, by a message saying that is fine

Filed: 2026-09-05T18:09:41Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/risk-guard.mjs, the INTERPRETERS undetermined-target rule as it applies to scripts/retro.mjs, and the caller-authorisation mechanism at line 203`

Observed 2026-09-05, plugin 0.1.34, project cartoonify, main session, WHILE FILING FINDING 19. Paths are written descriptively below because writing them literally is what triggers the defect. THE COMMAND: node [plugin root] slash scripts slash retro.mjs --record [title] --target [target] --finding [prose] --assertion [prose], where the finding prose quoted the literal path of a spec file and of the state file, both inside the control plane directory, as evidence for the observation being filed. THE RESPONSE, verbatim apart from elided paths: mavci risk policy: the write target of this command could not be determined, and it names a path inside [the control plane directory] ([the truncated command string]). This is not a claim that it writes there - it is that the guard cannot tell, so it refuses rather than guess. Run it as a plain command whose target is visible (cat, jq, cp ...), or use state.mjs if it really does need to write. QUOTING A CONTROL-PLANE PATH INSIDE A MESSAGE OR A STRING OPERAND IS FINE AND IS NOT WHAT THIS IS ABOUT. The final sentence describes exactly and only what the command did, and denies that it is the cause of the refusal. This is the SECOND denial message in one session whose closing sentence disclaims the case it is refusing; finding 19 is the first, and the two are independent code paths. THE CONSEQUENCE IS LARGER THAN THE FALSE POSITIVE. retro --record is the plugin sanctioned reporting channel. It is the one privileged command deliberately left reachable by an agent, and the retro skill states that seven places in the plugin stop an agent and send it here, every one of them a point where the agent has authority to report and none to fix. AS SHIPPED IN 0.1.34 THAT CHANNEL CANNOT CARRY A FINDING ABOUT THE CONTROL PLANE, because naming the control plane in the evidence is what trips the interpreter rule. A reporting channel that refuses reports about one subsystem is not a channel for that subsystem, and the subsystem it excludes is the one an agent is least able to fix and most likely to be blocked by. WHAT REMOVES THE ESCAPE HATCH: --record takes its body as PROSE only. --amend takes --text and --was as a PATH or stdin. Finding 15 filed that asymmetry as a shell-mangling defect and it is the same asymmetry here with a second consequence - there is NO file route into --record, so the body must pass along the command line, which is the only place the guard can see it. Had --record accepted a path the way --amend does, the body would never have been scanned. WHAT IT ACTUALLY COST, RECORDED SO THE DAMAGE IS VISIBLE: findings 19 and 20 were both rewritten to describe control-plane paths in words rather than name them. The queue now permanently holds two findings whose evidence is deliberately imprecise about which files were involved. That is the identical loss finding 15 was filed about - a finding whose body is not the evidence - reached by a different route and, this time, knowingly. THE GUARD RULE ITSELF IS NOT WRONG. Failing closed on an interpreter whose write target cannot be read from the command line is correct and must not be weakened, and the fix is emphatically NOT to start parsing node arguments. retro.mjs is a sanctioned channel and should be authorised BY CALLER, which is the mechanism the guard already uses for state.mjs at line 203.

### The assertion, and the broken build it must catch

TWO ASSERTIONS, AND THE SECOND EXISTS TO STOP THE FIRST BEING FIXED CARELESSLY. FIRST: retro.mjs --record must succeed when its body names a path inside the control plane directory. Assert it end to end - run --record with a control-plane path in the --finding prose, require exit 0, and require the queued body to contain that path VERBATIM, not merely that the command was permitted. THE BROKEN BUILD IT MUST CATCH: the build shipped as 0.1.34. Run the assertion against 0.1.34 FIRST and require it to FAIL; an assertion that passes there is testing that retro.mjs runs at all, which it does, rather than that it runs on the input that matters. SECOND, THE GUARD ON THE FIX: authorising retro.mjs by caller must authorise --record and --list ONLY. --apply and --clear are operator acts and risk-guard.mjs refuses them to an agent by caller today; the retro skill states this in terms - filing is not fixing, and clearing without applying loses the only record that the problem exists. Assert that after the change an agent caller invoking --apply and an agent caller invoking --clear are still BOTH refused. THE BROKEN BUILD THAT ASSERTION MUST CATCH: the obvious and wrong fix, which whitelists scripts/retro.mjs wholesale in the same way a path is whitelisted rather than authorising the two safe subcommands, and thereby hands an agent the operator authority to delete the queue while fixing its ability to write to it. Require this assertion to FAIL against that wholesale-whitelist build before accepting any fix. If the two assertions cannot both be satisfied, KEEP THE REFUSAL - a channel that over-refuses is recoverable by an operator, and an agent that can clear the queue is not.

---

### Addendum to finding 20 - The cost paid a third time, and asymmetrically: the guard scans the argument and never the file, so precision depends on the verb

Amended 2026-09-05T19:27:21Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE COST HAS NOW BEEN PAID A THIRD TIME, AND THE THIRD PAYMENT EXPOSES SOMETHING THE FIRST TWO
DID NOT: THE REFUSAL IS ASYMMETRIC BY VERB, AND THE ASYMMETRY IS DEMONSTRABLE INSIDE A FOUR
MINUTE WINDOW ON ONE BUILD.

The main text recorded two findings - 19 and 20 - rewritten to describe control-plane paths in
words. Tonight there are four. Finding 22, filed 2026-09-05T19:09:48Z on plugin 0.1.34, opens
with "PATHS BELOW ARE WRITTEN DESCRIPTIVELY RATHER THAN LITERALLY" and states in terms that it
is "the third finding in two days whose evidence is deliberately imprecise for that reason".
Finding 23, filed 19:11:09Z on the same build, carries the same disclaimer. Both went through
`--record`.

THE ASYMMETRY, WITH THE TWO ARTEFACTS THAT PROVE IT. Two minutes BEFORE finding 22 was filed,
the addendum to finding 6 was amended into this same queue file at 2026-09-05T19:07:08Z, on the
same plugin 0.1.34, in the same session. It names

    .mavci/control/verdicts/0003-attempt-01.json, run_at 2026-09-05T18:50:20Z:

LITERALLY, and quotes the file's contents. Finding 22, two minutes later, is ABOUT THAT EXACT
FILE - the attempt-1 verdict for task 0003 - and cannot name it, calling it "the attempt-1
verdict for task 0003" and disclaiming the imprecision in its first sentence. Same guard, same
build, same session, same subject, four minutes apart. THE ONLY VARIABLE IS WHICH SUBCOMMAND WAS
USED.

THE MECHANISM IS THE ASYMMETRY ALREADY IN THE MAIN TEXT, NOW WITH ITS SECOND CONSEQUENCE
MEASURED. `--record` takes its body as prose on the command line, which is the one place the
interpreter rule can see it. `--amend` takes `--text` as a PATH or stdin, and the guard never
opens the file. So THE GUARD'S COVERAGE TRACKS THE TRANSPORT AND NOT THE CONTENT: identical
bytes are refused as an argument and admitted as a file.

WHAT THIS CHANGES ABOUT THE FINDING. The main text filed the missing file route as a lost escape
hatch. The sharper statement is that THE QUEUE'S EVIDENTIAL PRECISION NOW DEPENDS ON WHICH VERB
HAPPENED TO BE AVAILABLE FOR THE THING BEING WRITTEN. An observation that fits an existing
finding is amendable, so it gets a literal path. The same observation, if it is new, must be
recorded, so it does not. THAT SELECTION IS THE WRONG WAY ROUND, in the same shape as finding
23's: a new finding is the one whose evidence has never been written down anywhere, and it is
the one forced to be vague, while an amendment restating a subject the queue already holds is
allowed to be exact.

AND IT MAKES THE DEFECT INVISIBLE TO ANYONE WHO TRIES TO MEASURE IT. Grepping this queue for
`.mavci/control/` returns nine hits, one of them written tonight, and a reader would reasonably
conclude the channel carries control-plane paths fine. Every one of the nine arrived by
hand-edit, by amendment, or on a build before this defect existed. NOTHING IN THE FILE
DISTINGUISHES A PATH THAT IS ABSENT BECAUSE IT WAS IRRELEVANT FROM A PATH THAT IS ABSENT BECAUSE
IT WAS REFUSED, except the disclaimer sentences that findings 19, 20, 22 and 23 each had to
write by hand - four hand-written apologies standing in for a fact the tool should have
recorded.

THE FIX IS UNCHANGED, AND THIS ADDENDUM ADDS ONE GUARD AGAINST A CARELESS ONE. Authorising
`retro.mjs` BY CALLER for `--record` and `--list` only, as the main text says, still fixes this.
A FILE ROUTE INTO `--record` WOULD ALSO MAKE THE SYMPTOM GO AWAY AND IS NOT THE FIX. It would
launder the body past the guard exactly as `--amend` does today, leaving the refusal standing for
anyone who passes prose, and promoting an accident of transport into the designed behaviour of
the control-plane rule. Add a file route if the shell-mangling half of finding 15 warrants one,
but do not let it be scored as closing this finding: assert the caller authorisation on the
PROSE path specifically, with the body still passed as an argument.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 21 - Plan half-move: begin-plan makes phase and allocation atomic, and the delegation that follows is outside that guarantee

Filed: 2026-09-05T18:24:05Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `skills/plan/SKILL.md step 3, and the state written by state.mjs --begin-plan`

Observed 2026-09-05, plugin 0.1.34, project cartoonify. state.mjs --begin-plan allocated task 0003 and moved the phase to plan in a single write, exactly as designed - it printed: phase = plan, active_task = 0003. The architect delegation that is step 3 of the plan skill then terminated on an API rate limit before writing anything. THE RESULTING STATE: active_task 0003, phase plan, and no spec - the tasks directory holds no 0003 file. Nothing reports the discrepancy. doctor prints the phase and the active task and has no check that the allocated task has a spec, so the project reads as mid-plan whether the architect wrote a spec or died on its first tool call. THIS IS NOT A DEFECT IN THE GUARANTEE. --begin-plan exists because on 2026-09-02 the phase moved and the allocation was then denied, leaving the project frozen with nothing to plan against, and it prevents that correctly. IT IS A GAP IN WHAT THE GUARANTEE COVERS: allocation and phase are atomic with each other and not with the work they authorise, so the half-move was not eliminated, it relocated one step later. An external rate limit was the trigger here; an architect crash, a denied tool call or an operator interrupt produce the same state.

### The assertion, and the broken build it must catch

doctor must report an allocated task that has no spec. ASSERT: when phase is plan and active_task is N, a file matching N-*.md exists in the tasks directory; if it does not, say so, and name it as a task allocated against an empty spec rather than as a task in progress. THE BROKEN BUILD IT MUST CATCH IS SITTING ON THIS MACHINE RIGHT NOW: 0.1.34, cartoonify, active_task 0003, phase plan, no 0003 spec, and a doctor run that reports 19 ok and says nothing about it. Run the assertion against that state FIRST and require it to FAIL. The broken build needs no reconstruction here, which is rare enough to be worth using before the state is cleared by the architect finishing.

---

# Finding 22 - The record cannot say what it checked, nor that a check has been retired: a criterion result with no tree sha and no superseded_by is a claim with no subject

Filed: 2026-09-05T19:09:48Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs --record and the verdict schema it writes; scripts/state.mjs for the criterion-retirement write path`

Check: `verify.record`

Observed 2026-09-05, plugin 0.1.34, project cartoonify, main session, while recording the operator's decision on the task 0003 supersession. PATHS BELOW ARE WRITTEN DESCRIPTIVELY RATHER THAN LITERALLY: naming them is what the reporting channel refuses, filed as finding 20, and this is the third finding in two days whose evidence is deliberately imprecise for that reason. WHAT IS NOT WRONG, STATED FIRST BECAUSE IT CHANGES THE FINDING: finding 6 fix item 1 HAS LANDED. The attempt-1 verdict for task 0003, written by 0.1.34, carries a criteria array beside checks - ten entries, each with id, mode, status and evidence, all ten mode executed. The acceptance criteria are now in the record. That is why the two absences below are precise rather than speculative: they are what is missing from a record that otherwise now works. THE RECORD AS 0.1.34 WRITES IT. Verdict top-level keys, complete: attempt, checks, criteria, plugin_version, project_id, run_at, schema_version, scope, summary, task_id, verdict. Criterion entry keys, complete: evidence, id, mode, status. FACE 1 - THE RECORD CANNOT SAY WHAT IT CHECKED. A verdict states that a criterion passed and does not state what it passed against. There is no tree sha, no commit id, no working-tree digest - no field of any kind naming the subject. run_at is a time, and a working tree is not recoverable from a timestamp. Worse, the verified tree may never have had a name: task 0003 was verified against a deliberately UNCOMMITTED tree, because its criterion 4 requires exactly one modified unstaged file. The subject of that verdict is a tree that had no name then and does not exist now. THE COST, OBSERVED TWICE IN ONE TASK. (a) The task 0003 spec's pre-build transcript header names HEAD 0ffea3f. The verifier established that the run must in fact have been against 11a26a4 - a commit that landed mid-task and added a seventh error code - by counting ERROR_MESSAGES entries at both trees, 7 against 6, and observing that criterion 8 requires exactly 7 and would have thrown at the sha the header names. That correction is correct and it survives only in the task summary's prose, because the verdict has no field that could confirm or contradict it. THE RECORD CANNOT ADJUDICATE A DISPUTE ABOUT ITS OWN SUBJECT. (b) Criterion 4 of task 0003 passed at 18:50:20Z and was false at 18:59:26Z, falsified by the commit the task's own summary instructs the operator to make next; filed tonight as an addendum to finding 6. Had the verdict named the tree, that pass would remain permanently checkable by anyone who restored it. Without a subject the claim is not merely stale, IT IS UNFALSIFIABLE - nobody can re-run it and nobody can demonstrate it was wrong either. That is the same bias finding 6's main text named: an unfalsifiable pass is a pass that can never become a fail. FACE 2 - THE RECORD CANNOT SAY A CHECK HAS BEEN RETIRED. Task 0003 deliberately supersedes ONE assertion inside task 0002's criterion 12 - the clause pinning the old UPSTREAM_ERROR wording, pinned there on purpose so the question stayed open rather than being closed by a task that was not about it. Task 0003 is that question answered, with its own spec and its own operator approval. Nothing in the record can say so. A criterion entry has no superseded_by. The status enum offers nothing usable: fail asserts the work is broken, which is false and would be read as a regression in task 0002; skipped asserts nobody looked, which is also false. The task record carries no relation to another task. LIVE CONSEQUENCE, VERIFIED TONIGHT: re-running task 0002's criteria as a regression suite reports a false failure on criterion 12 every time, throwing at the keep clause with "UPSTREAM_ERROR message was changed; it is out of scope". It throws at that line and not before, which means the three surviving assertions in the same criterion passed - the exact UPSTREAM_UNREACHABLE wording and the two banned phrasings - so the criterion is three-quarters live and reports as wholly failed. WHAT THE OPERATOR DID, AND WHY IT IS THE RIGHT DECISION AND STILL LEAVES THE HOLE. The remediation named by the task summary had two parts: an ADR, and a superseded_by marker in the sealed plane. Only the ADR was made, at .mavci/decisions/0005-upstream-error-supersedes-0002-criterion-12.md. The marker was refused deliberately: making it would mean hand-editing a sealed file and re-sealing, writing a key that nothing validates into a file whose seal exists to attest that state.mjs wrote it and it passed validation. The operator's statement of the trade: a false failure a reader can trace, rather than a true statement nothing can verify. THE SYSTEM OFFERED ITS OPERATOR A CHOICE BETWEEN A KNOWN-FALSE RECORD AND A DEGRADED SEAL, and the cost of the degraded seal falls not on the new field but on every other field in the file, because the seal is what made them trustworthy as a set. That is why this is filed as a system finding rather than left as a project ADR. WHY THIS IS ONE FINDING AND NOT TWO. Both faces are the same absence: THE RECORD STATES A CLAIM AND NOT WHAT THE CLAIM IS ABOUT. Face 1 is missing the tree the claim is about. Face 2 is missing which claims are still being asserted about it. A criterion result is a proposition, and a proposition needs a subject and a scope of validity; the record carries neither. They cannot be fixed apart: a tree sha alone lets a re-runner find the right tree and re-run retired assertions against it, and a superseded_by alone lets it skip retired assertions without knowing which tree the survivors were ever true of. FIX. 1. THE VERDICT CARRIES THE TREE IT WAS COMPUTED AGAINST - a tree id from git write-tree, or the commit sha, PLUS a porcelain digest when the verified tree was dirty. Not the HEAD sha alone: the case that produced this finding is precisely the one where the verified tree was not HEAD and was not any commit. 2. THE SPEC TRANSCRIPT CONVENTION RECORDS THE SAME IDENTIFIER so the two can be mechanically compared. Today the mismatch between the header and the real tree was caught by an alert verifier counting error codes by hand, which is not a mechanism. 3. CRITERIA GAIN superseded_by NAMING THE TASK THAT RETIRES THEM, written by state.mjs like every other control write. A criterion carrying it is neither run nor counted; it is reported as retired by task N, with the decision path if one was recorded. 4. RETIREMENT MUST BE PER-ASSERTION OR THE FIELD IS UNUSABLE AT THE GRANULARITY THAT ACTUALLY OCCURS. Criterion 12 holds four assertions; one is retired and three are live and carried forward by task 0003's criterion 5. A whole-criterion superseded_by would silently discard three working checks - trading a loud false failure for a quiet false pass, which is the worse of the two. Either criteria decompose into individually addressable assertions, or the retirement record quotes the exact text it retires and the runner skips only that. 5. NOTHING MAY RECORD A SUPERSESSION WITHOUT NAMING BOTH THE TASK THAT CAUSES IT AND THE DECISION THAT AUTHORISES IT.

### The assertion, and the broken build it must catch

TWO ASSERTIONS, AND THE SECOND EXISTS TO STOP THE FIRST BEING FIXED CARELESSLY. FIRST, ON THE SUBJECT. Assert that a recorded verdict names the tree its criteria were evaluated against AND THAT THE NAME RESOLVES: take the recorded tree identifier, restore that tree, re-run a criterion the verdict marks mode executed, and require the same result it recorded. THE BROKEN BUILD IT MUST CATCH IS 0.1.34 AS SHIPPED, and it does not need reconstructing - it is on this machine right now: the task 0003 attempt-1 verdict, ten criteria all recorded executed and passing, and no field anywhere in the file naming a tree. Run the assertion against that file FIRST and require it to FAIL. THEN THE PART THAT MATTERS, because the obvious assertion passes against the wrong fix: an assertion that merely checks that a tree-identifier key EXISTS will pass against a build that writes the HEAD sha unconditionally, and HEAD is wrong for exactly the case that produced this finding. So the assertion must include the uncommitted-tree case end to end - verify a task whose criteria require a modified unstaged file, commit it, then re-check that the recorded subject still resolves to the tree that was actually verified and not to the new HEAD. Require that to FAIL against a HEAD-only implementation before accepting it. SECOND, ON THE RETIREMENT. Assert that a criterion carrying superseded_by is reported as retired rather than run, that the task id it names resolves to a real task, that the decision it cites exists, and that a criterion WITHOUT the field is still run and still counted. THE BROKEN BUILD THAT ASSERTION MUST CATCH is the tempting cheap fix: any mechanism that lets a criterion be silenced without naming what supersedes it - an ignore list, a skip flag, a bare status value "retired" with no referent. Require the assertion to FAIL against that, because a silenceable criterion with no referent is STRICTLY WORSE THAN TODAY'S FALSE FAILURE. Today the failure is loud, reproducible, and traceable to a written decision. A nameless skip is a pin that quietly disappears the moment it becomes inconvenient, which is the exact failure task 0002 pinned that string to prevent.

---

# Finding 23 - The one task closed by operator override is the one with no record of what it did: the override path skips the scribe, and nothing anywhere notices

Filed: 2026-09-05T19:11:09Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs --task-status and closeTask; skills/ship/SKILL.md action table, the document row; scripts/doctor.mjs`

Observed 2026-09-05, plugin 0.1.34, project cartoonify, main session. Where this touches the sealed plane the paths are written descriptively rather than literally, for the reason filed as finding 20. THE OBSERVATION. Three tasks are done in this project. Two have a record of what they did. The one that does not is the one that was closed by operator override. Task 0001: phase release, status done - .mavci/tasks/0001.summary.md exists, CHANGELOG.md entry exists. Task 0003: phase release, status done - .mavci/tasks/0003.summary.md exists, CHANGELOG.md entry exists. TASK 0002: PHASE VERIFY, STATUS DONE - no .mavci/tasks/0002.summary.md, no changelog entry. THE MECHANISM, AND IT IS NOT AN ACCIDENT OF ORDERING. The scribe is dispatched from exactly one place in the plugin: the ship skill's action table, the row for the router action "document", reached when the router reports a passed verify. That row reads "delegate to the scribe with the task id, the verdict path and the spec path, asking for a changelog entry and a task summary. Run the closing steps after it returns, not before." The closing steps are advance-phase verify to release, then task-status done. state.mjs --task-status <id> --status done DOES NOT CONSULT THE PHASE. It validates the status against a closed enum, calls closeTask, sets the status, releases the active-task pointer and returns. An operator who has read the verifier's report, agrees with it, and closes the task directly gets a correctly closed task from any phase, with no document step and no indication that one was skipped. Task 0002's record carries the fingerprint of exactly that: phase verify, status done - closed without ever entering release, therefore closed without passing the one row that dispatches the scribe. SO THE ABSENCE IS NOT A TASK THAT WAS DOCUMENTED LATE OR SLOPPILY. IT IS WHAT THE OVERRIDE PATH OMITS, EVERY TIME, BY CONSTRUCTION. WHAT WAS LOST, AND IT IS NOT SMALL. Task 0002 is the largest change this project's route has had: the request timeout derived from maxDuration, maxRetries set to 0, the APIConnectionError branch that discriminates an unreachable provider from a size-degraded refusal, the small-body diagnostic probe, and the message contract for two error codes. CHANGELOG.md documents task 0001 under Added and task 0003 under Changed. It does not document task 0002 anywhere. Task 0002 appears in that file exactly once, in the Notes, AS THE OBJECT OF TASK 0003'S SUPERSESSION - so a reader learns that one of 0002's criteria has been retired before they learn that 0002 happened at all. A reader of this changelog would conclude the route went from task 0001 straight to task 0003, and that the derived timeout, the probe and the unreachable-versus-refused split arrived from nowhere. AND THE REST OF THE RECORD DEPENDS ON THE MISSING PIECE. Task 0003's criterion 7 pins task 0002's derived timeout budget as a regression check - the record pins work it never describes. Task 0003's criterion 5 carries forward three surviving assertions from 0002's criterion 12. WHY THE GAP IS EASY TO MISS: task 0002 does have an ADR, .mavci/decisions/0004-the-small-body-probe-is-server-side-evidence.md, so at a glance it looks documented. That ADR records the two decisions the spec could not express as criteria, says so explicitly, and covers nothing else. An ADR is not a summary and does not claim to be. WHY THE OVERRIDE IS NOT THE DEFECT. The override is correct behaviour and must stay reachable. The operator had the verdict and the verifier's report in front of them, agreed with both, and closed the task. What the override must not do is silently drop the only step that writes down what happened. AND THE SELECTION IS THE WRONG WAY ROUND: a task closed by override is, by definition, one whose closure a human made a JUDGEMENT about rather than one the router waved through - so it is the task whose reasoning most needs recording, and it is the one path that records nothing. THE PATH THAT SKIPS THE RECORD IS SELECTED FOR BY THE CASES THAT MOST NEED IT. AND NOTHING NOTICES. Tonight's health check on this project reports one failure, about the guardian acceptance corpus, and six warnings - version skew, no git remote, no recorded CI token expiry, no baseline, five unreviewed legal pages, and one queued system-change file. Not one of them is about a completed task with no record of what it did. There is no check at doctor, at the release gate, or anywhere else, that a task which reached status done left any description of the work behind. The release gate refuses on stale guardian records, so it already holds the concept that some evidence must exist and be current before a release - and it does not apply that concept to the description of the work being released. FIX. 1. --task-status done SHOULD WARN, LOUDLY AND BY NAME, WHEN THE TASK HAS NO SUMMARY. Not refuse: refusing turns an operator's override into a trap, which is the shape of a third of this queue already. Warn, name the file that does not exist, and print the one command that produces it. 2. doctor SHOULD REPORT A DONE TASK WITH NO SUMMARY, in the same way it reports queued lessons and unreviewed legal pages. It is the same class of thing - an act only an operator can complete, which nothing currently repeats until they do. 3. THE DOCUMENT STEP SHOULD NOT HANG OFF ONE ROUTER ACTION. Every path that reaches status done should either pass through it or record that it did not. A documented flag on the closed task, set false when the task was closed without one, makes the absence visible and queryable instead of leaving it to be discovered by someone listing a directory two days later. 4. IF A TASK IS CLOSED WITHOUT A SUMMARY, THE TASK RECORD SHOULD SAY SO. This finding exists only because somebody happened to notice a missing file while looking for something else, which is not a mechanism.

### The assertion, and the broken build it must catch

TWO ASSERTIONS, AND THE SECOND IS THE ONE THAT IS EASY TO GET WRONG. FIRST: assert that closing a task without a summary is reported. Concretely - close a task with --task-status done while its phase is verify and no summary file exists for it, then require doctor to name that task and that missing file in its output. THE BROKEN BUILD IT MUST CATCH IS ON THIS MACHINE RIGHT NOW and needs no reconstruction: cartoonify, task 0002, phase verify, status done, no summary file, no changelog entry, and a health check that reports one failure and six warnings, not one of which is about it. Run the assertion against that state FIRST and require it to FAIL. Use it before the state is cleared - the moment somebody writes 0002's summary by hand, the broken build is gone and only the prose above remains. SECOND, AND IT DECIDES WHETHER THE FIX IS WORTH SHIPPING: the warning must fire on the OVERRIDE path specifically, not merely wherever a summary is absent. A check that fires whenever a done task has no summary will also fire in the window between a passed verify and the document step - the window in which a summary is legitimately absent on EVERY task, including every task travelling the normal route. That check is noisy on the common path, gets silenced within a week, and is then silent on the override, which is the only case it was written for. It is the Gate 4 adjacent-assertion failure exactly: an assertion next to the one that matters, passing for releases while the thing it was meant to catch goes through. So assert both directions - QUIET on a task moving normally through document, LOUD on a task closed from verify without one - and require the naive absence-only check to FAIL the quiet half before accepting it.

---

# Finding 24 - The --agent provenance stamp asserts guard enforcement on paths the guard never checks

Filed: 2026-09-06T11:53:25Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/retro.mjs, scripts/risk-guard.mjs`

retro.mjs stamps every declared --agent with "Provenance enforced at the risk
guard, not self-declared." (record: retro.mjs:344; amend: retro.mjs:567). The
claim is categorical; the enforcement behind it is not.

Real enforcement exists at risk-guard.mjs:1008-1031 - it reads agent_type from
the hook payload, compares it to the declared value, and denies a mismatch.
Verified: a payload with agent_type mavci-core:mavci-builder and a command
declaring --agent mavci-scribe is DENIED ("which is not itself"). So the value
is not merely echoed, and the check is genuine on the path it covers.

It covers one path. Two holes, both driven end to end:

HOLE 1 - the main session is never checked. The block is gated
`if (agent && (flags.includes('--record') || flags.includes('--amend')))`, and
agent = bareAgentName(input.agent_type), which is absent for the main session
(stated at risk-guard.mjs:855 and :974). A main-session caller may declare any
value. Driven: CLAUDE_PROJECT_DIR=<throwaway> retro.mjs --record ... --agent
mavci-architect, run from the main session, wrote:
  Filed by: **mavci-architect** (agent). Provenance enforced at the risk guard,
  not self-declared. Weigh it accordingly before applying.
Nothing validated that value. The omission NOTICE does not fire either - it is
inside the same `if (agent)`.

HOLE 2 - a quoted value defeats the check for a real subagent. The guard reads
the declared value off the raw command string with
  /--agent[= ]+([A-Za-z0-9:_-]+)/
which cannot match a quoted value. A subagent writing --agent "mavci-scribe" or
--agent='mavci-scribe' yields declared=null, is classified as an OMISSION, and
is allowed with the notice "This block is going in unattributed, which is
allowed". That notice is false as it is printed: retro.mjs receives argv after
the shell has stripped the quotes, and writes
  Filed by: **mavci-scribe** (agent). Provenance enforced at the risk guard...
Both halves driven separately. The guard reports unattributed while the queue
records attributed-and-enforced.

Duplicate flags are NOT a gap: arg() (retro.mjs:280) uses indexOf and takes the
first occurrence, as does the regex.

CONSEQUENCE. The stamp is the field an operator uses to decide how much scrutiny
a finding needs before it changes how every downstream project is built. On most
callable paths it asserts an enforcement that did not occur. A self-declared
value wearing a guard-enforced stamp is worse than no stamp, because the absent
stamp is honest about being unknown and this one is not.

NOT A DOCUMENTATION DEFECT. The sentence is not imprecise, it is wrong on the
main-session path always and on any subagent path where two quote characters are
present. A prose tidy that keeps the claim does not fix it.

OPERATOR DECISION (recorded 2026-09-06): narrow the CLAIM, not widen the CHECK.
Recommended fix is to the stamp text - emit the enforcement sentence only where
the guard actually performed the comparison, and otherwise say only what is
known. Widening the enforcement was considered and not chosen: covering the main
session and unquoting the value both add ways for the escalation channel to
refuse a report, and PROVENANCE MUST NEVER COST THE CHANNEL (risk-guard.mjs:1019)
is the older and more important rule. Hole 2's notice text needs the same
treatment: it must not assert "unattributed" about a call it did not parse.

The twenty-one existing unstamped addenda are the HONEST state and must not be
retro-stamped. Their "Filed by: not recorded ... treat it as unattributed" is
accurate. The fix does not create a reason to start passing the flag.

### The assertion, and the broken build it must catch

A class-B check in the system repo (check-retro.mjs / check-risk-guard.mjs) that
drives both layers and fails on the current code:
1. record() with a declared --agent, invoked with NO agent_type in the payload,
   must NOT produce a stamp containing "enforced at the risk guard". Red today.
2. risk-guard, given agent_type=mavci-builder and a command containing
   --agent "mavci-scribe" (quoted), must not emit the "going in unattributed"
   notice, because the value IS attributed downstream. Red today.
3. The existing mismatch-deny case must stay green, proving the check was
   narrowed and not removed.
Each must be shown red on current code and green on a corrected copy; 1 and 2
green-only would pass on a build that simply deleted the stamp, which is why 3
is in the list.

### Addendum to finding 24 - Not latent: hole 1 has already produced five false stamps in this file, naming a principal that does not exist

Amended 2026-09-06T11:54:57Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

The finding was filed on driven probes in throwaway roots. It did not need to be:
hole 1 has ALREADY FIRED FIVE TIMES in this file, and the false stamps are in the
queue that `--apply` will carry into the system repo.

Counted in pending-system-change.md at the time of this addendum:
  18 addenda total
  13 carry "Amended by: not recorded ... Treat it as unattributed"  - HONEST
   5 carry "Amended by: **main-session** (agent). Provenance enforced at the
     risk guard, not self-declared."                                - FALSE
  (lines 120, 1359, 1429, 2164, 2291; all plugin 0.1.33, all 2026-09-05)

`main-session` IS NOT AN AGENT. agents/agent-scopes.json declares exactly five:
mavci-architect, mavci-builder, mavci-guardian, mavci-scribe, mavci-verifier.
Had a subagent declared `--agent main-session`, the guard would have denied it as
"not itself". It was not denied, because the caller WAS the main session and the
comparison is gated behind `if (agent && ...)` on an agent_type the main session
does not have. The declaration named a caller that does not exist in the system's
own registry, and the queue recorded it as guard-enforced.

This raises the severity and narrows the fix.

SEVERITY. The defect is not latent. Five blocks of applier-facing evidence in the
queue assert an enforcement that never ran, and they assert it about a principal
the system does not define. An operator triaging this file sees five entries that
look more accountable than the thirteen beside them, and the relationship is
inverted: the thirteen unattributed ones are the trustworthy records.

FIX. The recommended direction - narrow the claim, do not widen the check - now
has a second obligation. Changing the text going forward leaves these five
in place, and they will be applied. Whoever fixes this must also decide what
happens to already-written false stamps. The queue's own append-only rule
(retro.mjs:380-397, "no path here edits a filed byte") forbids rewriting them,
which is correct and should not be relaxed for this. The consistent remedy is an
addendum on each, not an edit - the same instrument this block is using.

WHAT THIS DOES NOT LICENSE. It is not a reason to start passing --agent, and not
a reason to retro-stamp the thirteen. Their absent stamp is accurate.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

### Addendum to finding 24 - Line numbers are not identifiers in this file: the first addendum's citations were stale within hours, and title-plus-timestamp is the only stable reference

Amended 2026-09-06T13:46:39Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

CORRECTION TO THIS FINDING'S FIRST ADDENDUM, AND IT IS A CORRECTION AN APPLIER
NEEDS BEFORE THEY GO LOOKING. That addendum located the five false stamps by LINE
NUMBER - "lines 120, 1359, 1429, 2164, 2291". Two of those were wrong within
hours. The stamps are now at 2285 and 2412.

WHAT MOVED THEM. Nothing was edited. `--amend` inserts an addendum AT THE END OF
ITS TARGET'S BLOCK, not at the end of the file - a deliberate design choice, and
the right one, since tail-appending is what left the addenda to findings 17, 20
and 22 buried hundreds of lines from what they amend. But it means every
amendment to finding N displaces every line in findings N+1 onward. Two addenda
were added to finding 9 later the same session, and everything after finding 9
shifted by about 121 lines.

SO IN THIS FILE A LINE NUMBER IS NOT AN IDENTIFIER. It is a coordinate valid only
until the next amendment to any EARLIER finding, and it decays silently - the
number still resolves, it just resolves to different text. Note the asymmetry
that makes this easy to get wrong: filing a NEW finding appends at the end of the
file and shifts nothing, so line numbers can appear stable across several
operations and then move all at once.

THE STABLE REFERENCE IS TITLE AND TIMESTAMP. Every addendum carries a
`### Addendum to finding N - <title>` heading and an `Amended <ISO 8601>, plugin
<version>.` line. Both are written once, never rewritten, and travel with the
content they name. The corrections filed on findings 1, 7 and 15 use exactly that
form, and an applier should read those rather than the line numbers above.

The five stamps, addressed properly:
  finding 1  - "Finding 15 is this finding from the other direction - the entry
                gap and the exit gap", Amended 2026-09-05T14:41:49Z
  finding 7  - "The criteria path: the agent qualified to judge is the one denied
                the tool to record - the plumbing half shipped and the agent half
                did not", Amended 2026-09-05T14:31:35Z
  finding 7  - "The assertion for the criteria path, and the broken build it must
                catch", Amended 2026-09-05T14:31:42Z
  finding 15 - "The finding text, supplied - the body as filed was a path, not
                the observation", Amended 2026-09-05T14:35:01Z
  finding 15 - "Stated at full width: a check that cannot pass honestly creates
                pressure to pass it dishonestly, and finding 1 is this finding's
                entry gap", Amended 2026-09-05T14:41:35Z

GENERAL, NOT SPECIFIC TO THIS FINDING: any block anywhere in this queue that
cites a line number into this queue has the same defect, and so does any tooling
that would. If the applier-facing surface of finding 25 is ever built, whatever
it emits must address blocks by finding number plus timestamp, never by offset.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 25 - The queue has a place for what was observed and none for what the applier must read first; the missing surface has already been hand-carved once

Filed: 2026-09-06T11:56:43Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/retro.mjs - the emitted section vocabulary in record() and amend(), and --list`

THE QUEUE HAS NO APPLIER-FACING SURFACE. Every route into a finding is
chronological and evidential; content whose whole purpose is "read this before
you apply it" has nowhere structural to go, so it is carried by hand-written
convention instead - and the reader it is written for is the one reader the
format does not serve.

WHAT THE TOOL CAN EMIT. Exactly two heading kinds:
  ### The assertion, and the broken build it must catch     (retro.mjs:364)
  ### Addendum to finding N - <title>                        (retro.mjs:203)
Both are records of what was seen or later realised. Neither is an instruction
to whoever acts on it. There is no third.

WHAT THE FILE ACTUALLY CONTAINS. Counted by heading kind in the queue:
  25  ### The assertion...
  19  ### Addendum to finding...
   1  ### Operator disposition of finding 12 consequence 4 - permanently out of
       scope, not pending
The third is emitted by NO code path in the plugin - grep the whole 0.1.34 tree
for "Operator disposition" and it appears only in the queue file. It was carved
by hand, into an append-only artefact whose own stated rule is that "no path here
edits a filed byte" (retro.mjs:380-397). The surface was needed badly enough that
the rule was set aside to get it. That block is purely applier-facing: it records
a decision rather than an observation, and it closes with "DO NOT re-open this as
a task, and do not count it against finding 12 when finding 12 is cleared."

THE THREE HOMES THIS CONTENT HAS TODAY, ALL WRONG:

1. SMUGGLED INTO THE ASSERTION SECTION. Finding 20 carries a SECOND assertion
   whose stated job is not to check anything but to stop a careless fix: "THE
   GUARD ON THE FIX ... Require this assertion to FAIL against that
   wholesale-whitelist build before accepting any fix." That is an instruction to
   the applier, filed under a heading that announces itself as being about a
   check. A reader scanning for constraints does not look inside an assertion.

2. SHOUTED IN CAPS MID-PROSE. "A FILE ROUTE INTO --record WOULD ALSO MAKE THE
   SYMPTOM GO AWAY AND IS NOT THE FIX" (finding 20 addendum). "WHAT THIS DOES NOT
   LICENSE" (finding 24 addendum). "THE GUARD RULE ITSELF IS NOT WRONG ... the fix
   is emphatically NOT to start parsing node arguments" (finding 20 body). Caps is
   a convention, not a structure: it cannot be counted, cannot be surfaced by
   --list, and cannot be required of a filer who does not know the convention.

3. HAND-CARVED HEADINGS, as above - which means editing the queue.

CHRONOLOGY IS THE SECOND HALF OF THE DEFECT. --record fixes the body at filing
time; --amend appends inside the target's block in time order. So the applier
reads in the order things were WRITTEN, never in the order they must be READ. The
warning that most changes what an applier should do may be the sixth addendum,
hundreds of lines below the body - finding 6 carries five, finding 7 four. The
code already concedes the reader-side cost in terms: "a reader who reads the body
and stops acts on the uncorrected claim ... Nothing writes into a body to announce
a correction" (retro.mjs:394-397). That cost was accepted for CORRECTIONS. It was
never argued for INSTRUCTIONS, and it is not the same trade: a stale claim read
too early is a wrong belief, an unread "do not fix it this way" is a wrong action.

THIS IS FINDING 20'S SHAPE ONE LEVEL ALONG. Finding 20: the channel cannot carry
evidence about one subsystem, and the loss is invisible in the artefact except
through disclaimer sentences four findings had to write by hand. Here: the channel
cannot carry applier-facing instruction, and the need is invisible except through
caps and one hand-carved heading. Both are a fact the tool should have recorded
being carried by hand instead; both are diagnosed only by noticing the workaround.
Finding 20's addendum says it exactly - "four hand-written apologies standing in
for a fact the tool should have recorded". This is the fifth, and it is a heading.

WHY IT MATTERS MOST HERE. --apply copies this file verbatim into the system
repository. The applier is the entire reason the queue exists. Twenty-four
findings are about to be acted on by someone reading a document that has a
sanctioned place for what was observed, a sanctioned place for how to check the
fix, and no sanctioned place for what not to do while fixing it.

NOT A REQUEST TO MAKE FINDINGS EDITABLE. The append-only rule is right and this
must not be the reason it is relaxed. A caveat surface must append like everything
else; what it must NOT do is sort by filing time.

### The assertion, and the broken build it must catch

THREE ASSERTIONS. The first is the discriminating one; the second and third exist
so it cannot be satisfied by deletion or by a second assertion section.

FIRST: every "### " heading in a queued lessons file must be one retro.mjs can
emit. Enumerate the headings in the queue, enumerate the heading forms the code
produces, and require the first set to be a subset of the second.
  RED TODAY, and the specific reason it is red: "### Operator disposition of
  finding 12 consequence 4" is present and unproducible. Run this against 0.1.34
  first and require FAILURE. An implementation that passes on 0.1.34 is comparing
  the wrong things.

SECOND, SO THE FIX IS NOT DELETION. The hand-carved block's CONTENT must still be
present and reachable after the fix, carried by a tool-emitted heading rather than
removed. Assert that a queued finding can hold an applier-facing block, that it
round-trips through --record/--amend, and that the finding-12 disposition text
survives verbatim. A build that deletes the offending heading passes assertion one
and must fail this.

THIRD, SO IT IS NOT A SECOND ASSERTION SECTION. --list must report applier-facing
blocks the way it already reports amendment counts - a reader must learn a finding
carries a caveat WITHOUT reading the finding. Assert --list output names the count
for a finding that has one.
  THE BROKEN BUILD ALL THREE MUST CATCH: the obvious wrong fix, which adds a
  --caveat flag that appends one more chronological block at the end of the target
  block and surfaces nowhere. That build satisfies assertions one and two and must
  FAIL assertion three; require that failure to be demonstrated before the fix is
  accepted. If three cannot be met, the surface is not worth adding - an
  instruction that is merely filed in a new shape is the defect with a new name.

---

# Finding 26 - A spec deferred work citing a criterion that does not exist; the citation was the reason for the deferral and nothing checks that a spec's cross-references resolve

Filed: 2026-09-06T11:59:56Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `the standards checker rule set, and lib/criteria.mjs`

A SPEC DEFERRED WORK ON THE AUTHORITY OF A CRITERION THAT DOES NOT EXIST, THE
CITATION WAS THE STATED REASON FOR THE DEFERRAL, AND IT PASSED VERIFICATION.
(The verdict path is described rather than named; naming it literally is finding
20's defect, which fired twice while gathering this evidence.)

THE CITATION. Task 0002 section 8 ("Out of scope, deliberately"), first bullet,
defers rewriting UPSTREAM_ERROR's user-facing message. Its stated authority,
verbatim:

  "But it is asserted by task 0001's criteria, the addendum's revision is
   explicitly about UPSTREAM_UNREACHABLE, and changing a message task 0001
   verified is a separate decision with a separate approval."

Two assertions of fact about task 0001: that its CRITERIA assert this message,
and that task 0001 VERIFIED it. Both are false.

WHAT TASK 0001 ACTUALLY CONTAINS. Section 6 is its acceptance criteria: 32 of
them, enumerated. None asserts the UPSTREAM_ERROR message. Stronger, and this is
the decisive measurement: the message string
"Karikatur olusturulurken bir sorun olustu. Lutfen tekrar deneyin." (accents
stripped here only to keep this report encoding-safe) appears ZERO times in the
whole of task 0001 - not in a criterion, not in a contract, not in prose. Task
0001 never states the message, so it cannot have verified it.

What task 0001 does say is in section 5.2, its CONTRACTS: `message` is "a fixed
Turkish constant per code", and no upstream error text, err.message, stack or key
name reaches the body - cross-referenced to its criterion 16. That constrains the
message's SHAPE and forbids what must not be in it. It never fixes its WORDING.
Any Turkish constant satisfies it.

SO THE DISTINCTION THE DEFERRAL TURNED ON IS EXACTLY THE ONE THAT WAS COLLAPSED:
a CONTRACT stated in a spec is not a CRITERION, and only criteria are executed.
Section 5.2 is prose the operator approved; section 6 is what gets run. "Asserted
by task 0001's criteria" silently upgraded the former into the latter, and the
upgrade is what made the deferral sound like deference to a prior verification
rather than a fresh scope choice needing its own justification.

IT PASSED. Task 0002 attempt 1 recorded verdict `pass`, 2026-09-05T14:23:57Z. The
recorded verdict carries no criteria field at all - finding 6 - so nothing in the
pipeline could have surfaced this even in principle.

IT THEN PROPAGATED. Task 0003 quotes task 0002 section 8 verbatim as the
statement of intent ("Task 0002 section 8, first bullet, states the intent
plainly...") and builds its own scope decision on top of it: "0003 is the answer
to that open question, by operator decision." A false citation became the
recorded reason for scope in two consecutive tasks, and the second one cites the
first rather than the source, so re-reading task 0003 cannot detect it.

NOTHING CHECKS THAT A SPEC'S CROSS-REFERENCES RESOLVE. The plugin defines fifteen
checks: config.fixture_scope, legal.kvkk_structure, legal.pages_present,
next.env_centralised, next.no_service_role_client, next.no_static_export,
next.regex_no_template_literal, next.route_force_dynamic,
next.supabase_client_in_function, secrets.no_committed_secrets,
settings.marketplace_form, state.schema_valid, stripe.webhook_signature,
supabase.rls_enabled, supabase.service_role_query_scoped. Every one reads code,
config, legal pages or the state schema. NONE READS SPEC PROSE. lib/criteria.mjs
executes criteria; it does not validate references. A spec may cite any section,
any criterion, in any task, existing or not, and nothing looks.

WHY THIS IS DURABLE AND NOT SELF-CORRECTING. Task 0002 pinned the message itself,
in its OWN criterion 12 (the `keep` clause asserting the UPSTREAM_ERROR string is
unchanged). So the outcome was correct - the message stayed put, the question
stayed open, task 0003 later answered it deliberately. THE DEFECT IS INVISIBLE
PRECISELY BECAUSE THE DEFERRAL WAS HARMLESS IN EFFECT. What failed is the
AUTHORITY, not the outcome, and at verification time a deferral justified by a
nonexistent prior verification is indistinguishable from one justified by a real
one. Every artefact downstream reads as though a prior task had already settled
the question.

THE GENERAL SHAPE. A citation is the one construct in a spec that makes a claim
about a document the reader is not reading. The system approves specs by content
hash, which fixes WHAT a spec says and says nothing about whether what it says is
true of anything else. Out-of-scope bullets are where citations concentrate,
because deferring work is exactly when a spec needs to point at authority it does
not itself carry - so the least-checked construct sits in the section that
decides what does not get built.

### The assertion, and the broken build it must catch

A check - proposed id `spec.references_resolve` - that extracts references from
an approved spec's prose and requires each to resolve. Two reference classes, and
the second is the one that matters:
  (a) intra-document: "section N" / "§N" must name a section the same spec has.
  (b) cross-document: "task NNNN's criteria", "task NNNN criterion N", "task NNNN
      section N" must resolve to a section or an enumerated criterion that exists
      in that task's spec.

FIRST, AND IT MUST BE RED TODAY. Run it against task 0002 and require FAILURE,
naming section 8's "asserted by task 0001's criteria" as the unresolved
reference. Confirm the failure reproduces before building the fix. An
implementation that passes on the current tree is matching the wrong thing.

SECOND, SO IT IS NOT SATISFIED BY THE INTRA-DOCUMENT HALF ALONE. Task 0002's
section 8 EXISTS, and every "see §8" in the tree resolves fine. A check that
validates only class (a) passes this case while the defect stands. Require a
build implementing (a) only to FAIL this assertion, and demonstrate that failure.

THIRD, SO IT IS NOT LAUNDERED THROUGH A MODEL. The resolver must be a PROGRAM:
extract the reference, look up the target, report present or absent. It must not
ask an agent whether a citation looks right. lib/criteria.mjs settles this in its
own words - "The agent interprets; the program records" - and a model asked to
judge whether task 0001 "asserts" a message would very plausibly answer yes on
the strength of section 5.2, which is the exact collapse that produced the
defect. Assert the check reaches its verdict with no model in the path.

GREEN DIRECTION, so this is proven both ways and not merely capable of failing:
on a corrected copy where the bullet cites task 0001's section 5.2 contract, or
cites task 0002's own criterion 12, the check must PASS. A check only ever shown
red proves it can fail, not that it discriminates.

SCOPE GUARD. Resolving a reference is not judging whether the cited text supports
the claim. This check answers "does the target exist", nothing more. Do not widen
it into a semantic reviewer; that is a different and much weaker instrument, and
the narrow version would have caught this one.

---

# Finding 27 - One ADR sequence split across two authorised directories, no allocator and no index; the only note explaining it is inside the fifth document

Filed: 2026-09-06T12:02:24Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/config.mjs PATHS.decisions, agents/mavci-scribe.md write scope, and the absence of a decision-number allocator`

ONE NUMBER SEQUENCE, TWO DIRECTORIES, AND THE ONLY NOTE ABOUT IT IS REACHABLE
ONLY BY A READER WHO NO LONGER NEEDS IT.

THE STATE. The ADR sequence 0001-0005 is one series interleaved across two
locations:
  docs/adr/           0001, 0003          titled "ADR NNNN"
  .mavci/decisions/   0002, 0004, 0005    titled "Decision NNNN"
Neither directory holds a contiguous run, and neither contains an index, a README
or a stub for the numbers it does not have. A reader who opens docs/adr/ sees
0001 and 0003 and a hole where 0002 should be, with nothing to distinguish
"0002 was never written" from "0002 is in a directory you have not been told
about". Two artefact names for one series compounds it: searching the tree for
"ADR 0002" finds nothing, because that document calls itself "Decision 0002".

THE NOTE, AND WHY IT DOES NOT HELP. Exactly one document explains the split.
`.mavci/decisions/0005-...` carries a section headed "Where this document lives":
"The ADR sequence is one series across two directories: docs/adr/ holds 0001 and
0003, .mavci/decisions/ holds 0002, 0004 and this one. A reader looking for an
ADR by number must check both." That is correct, well written, and in the wrong
place. It is the FIFTH document of the series, inside ONE of the two directories,
under a heading a reader scanning for the sequence has no reason to open. To find
it you must already have found the directory whose existence it exists to tell
you about. The reader it is written for - someone in docs/adr/ looking for 0002 -
cannot reach it by any path.

THE MECHANISM, AND IT IS THE SYSTEM'S, NOT THE OPERATOR'S:

1. TWO HOMES ARE AUTHORISED FOR ONE ARTEFACT CLASS. The scribe's write scope is
   `docs/**`, `README.md`, `CHANGELOG.md`, `.mavci/decisions/**`, ... - so an ADR
   may be written to either, and nothing chooses between them. The split is not a
   mistake anyone made; it is the scope working as declared.

2. THE CANONICAL PATH IS DECLARED AND NEVER USED. config.mjs defines
   `decisions: ${MAVCI_DIR}/decisions`. It is referenced in exactly ONE place in
   the whole plugin - state.mjs:991, inside init(), which mkdirs it during
   connect. Nothing else reads it. No check asserts a decision lives there, no
   command writes there by default, nothing enumerates it. The system creates a
   home for decisions at connect time and then never mentions it again, which is
   how it ends up holding three of five.

3. NOTHING ALLOCATES THE NUMBER. There is no next-ADR-number function anywhere in
   the plugin. Compare retro.mjs, which HAS one - nextFindingNumber() scans the
   queue and returns max+1, which is why the 26 findings are contiguous and the 5
   ADRs are not. The sequence is maintained by whoever remembers what the last
   number was, across two directories, by reading.

WHY IT MATTERS MORE THAN A TIDINESS COMPLAINT. An ADR's entire function is to be
found LATER, by someone deciding whether to reverse a choice - the scribe's own
brief says exactly this: "read months later as evidence of what someone thought,
by someone deciding whether to reverse it, and it will be believed." A decision
record that cannot be located by its number has failed at the one thing it is
for, and it fails SILENTLY: the reader who checks docs/adr/ for 0002, finds a
gap, and concludes no such decision was recorded gets a wrong answer with no
indication anything is missing. That reader then makes the choice afresh, unaware
it was already settled and why.

AND THE FAILURE IS SELF-CONCEALING IN THE SAME SHAPE AS FINDING 20. Nothing in
either directory distinguishes a number that is absent because it was never
allocated from a number that is absent because it is in the other directory,
except a hand-written note in one file - the same "hand-written apology standing
in for a fact the tool should have recorded". Here the tool could record it
trivially: it already knows the canonical path, it just never reads it.

NOT AN ARGUMENT FOR MOVING THE FILES. Relocating 0001 and 0003 into
.mavci/decisions/ would break every reference to them - task 0001 section 8,
0001.summary.md, 0002.json, 0002.md and Decision 0005 all cite `docs/adr/...`
paths literally - and would rewrite history to look tidier than it was, which is
the queue's own append-only objection one scale up. The defect is that the
sequence is UNNAVIGABLE, not that it is untidy.

### The assertion, and the broken build it must catch

TWO ASSERTIONS. The first makes the sequence navigable; the second stops the
first being satisfied by moving files.

FIRST: a decision record must be locatable by its number without knowing which
directory it is in. Concretely - a check (proposed `decisions.sequence_navigable`)
that enumerates decision records across every authorised location, and requires
that for every number in the range 1..max, exactly one record exists and is
reachable from a single index the check can name.
  RED TODAY, and name the reason: enumerating docs/adr/ alone yields {1,3} with a
  hole at 2; enumerating .mavci/decisions/ alone yields {2,4,5} with a hole at 1;
  no index exists in either. Run this against the current tree FIRST and require
  FAILURE. An implementation that passes here is enumerating only one directory
  and calling a gap-free subset a gap-free sequence.

SECOND, SO THE FIX IS NOT A MASS RENAME. Every existing reference must still
resolve after the change. Assert that each literal `docs/adr/...` path cited in
the task specs, in 0001.summary.md, in 0002.json and in Decision 0005 still
points at a file that exists.
  THE BROKEN BUILD THIS MUST CATCH: the obvious wrong fix, which relocates 0001
  and 0003 into the canonical directory. That build satisfies assertion one - one
  directory, contiguous 1..5 - and must FAIL this one. Demonstrate that failure
  before accepting any fix.

GREEN DIRECTION, so the check is proven both ways and not merely shown capable of
failing: on a corrected copy carrying an index that lists all five numbers with
their actual locations, both assertions must PASS with the files left where they
are.

AND THE ALLOCATION HALF, which is what stops it recurring: whatever writes a
decision must allocate its number by scanning ALL authorised locations, the way
retro.mjs's nextFindingNumber() scans the queue. Assert that allocating a number
while a record exists only in the non-canonical directory returns max+1 across
both, not max+1 of the canonical one - the broken build being one that scans
`PATHS.decisions` only and reissues a number already used in docs/adr/.

---

### Addendum to finding 27 - Outcome: an index shipped in both directories; the allocator, the dual authorisation and the unread canonical path are untouched

Amended 2026-09-06T13:48:28Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

AN INDEX SHIPPED IN THIS PROJECT, 2026-09-06. It is the navigability half only.

WHAT WAS WRITTEN. Identical `README.md` files in BOTH authorised directories -
`docs/adr/` and `.mavci/decisions/` - each carrying the full table of 0001
through 0005 with real titles and actual locations, both naming conventions
("ADR NNNN" and "Decision NNNN") called out, and an explicit warning that a gap
in one directory does NOT mean the number was never allocated. A reader who lands
in either directory now learns the other exists without having to already know.

NO FILES WERE MOVED, which was this finding's own stipulation. Every literal
`docs/adr/...` citation in the tree still resolves; all ten paths named by the
index were checked to exist after writing it.

WHAT THIS DOES NOT FIX, AND IT IS MOST OF THE FINDING. The index is a DOCUMENT,
not a check. Nothing enumerates the sequence, so this finding's first assertion
would still be RED against the tooling: no code reads the canonical path
(`PATHS.decisions` is still referenced exactly once, an `mkdir` at connect, and
never read), two locations are still authorised for one artefact class, and there
is still no allocator - the next number is still whatever a person remembers.

THE DUPLICATION IS ITSELF A SYMPTOM. Two hand-maintained copies of one table can
drift, and nothing detects it if they do. That is a worse property than the
system half would have, and it is accepted only because the alternative - a
single index in one directory - leaves the reader in the other exactly as
stranded as before. Both copies say so in the file.

NO TASK, NO CRITERION, NO VERDICT. This work was directed by the operator and
done outside the task pipeline, so nothing states what it was meant to achieve
and no recorded verdict covers it. That absence is deliberate - manufacturing a
spec afterwards would be a reconstruction reading as contemporaneous - and it is
itself filed as finding 28. This addendum is the durable statement that exists
instead, which is exactly the substitute finding 28 says the system should not
have to rely on prose for.

THIS FINDING IS NOT CLOSED.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 28 - Work that never becomes a task carries no statement of what it was for, and a bare standards pass is the only artefact it leaves

Filed: 2026-09-06T13:47:39Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs --changed and the verdict it writes; the absence of any non-task route for recording intent`

WORK THAT NEVER BECOMES A TASK HAS NO DURABLE STATEMENT OF WHAT IT WAS FOR, AND
NOTHING ANYWHERE NOTICES. The checker passing the tree is not that statement and
does not claim to be, but it is the only artefact produced, so it becomes the
record by default.

OBSERVED 2026-09-06, project cartoonify, plugin 0.1.34. Two substantive changes
landed in the working tree:
  - `lib/image-constraints.ts` and `app/api/cartoonify/route.ts` - the upload
    allow-list is now derived from an exported model constant through a
    per-model capability map, and the multipart filename now carries an
    extension (system finding 10, fix parts 1 and 4).
  - `docs/adr/README.md` and `.mavci/decisions/README.md` - a decision-record
    index in both authorised locations (system finding 27).
Both were deliberate, both were directed by the operator, both discharge parts
of queued findings. NEITHER IS A TASK. There is no spec, no acceptance criterion,
and no recorded verdict about them.

WHAT THE SYSTEM SAID ABOUT THEM. `verify.mjs --changed` returned:

    "scope": "changed", "task_id": null, "verdict": "pass",
    "summary": { "blockers": 0, "pass": 11, "fail": 5, ... }

That verdict is TRUE and it is about standards compliance in the changed files.
It says nothing about whether the changes achieved anything, because nothing ever
stated what they were meant to achieve. A reader six months from now sees `pass`
against a diff and CANNOT DISTINGUISH "nothing was being attempted here" from
"something specific was attempted and nobody wrote down what". Those are very
different states and the artefact renders them identically.

THIS IS NOT FINDING 6, AND NOT FINDING 22. Both describe this gap one step
later, and both PRESUPPOSE A TASK EXISTS. Finding 6: the recorded verdict cannot
express acceptance-criteria results, so the router closes tasks whose spec is not
satisfied. Finding 22: a criterion result with no tree sha and no superseded_by
is a claim with no subject. Each is about a criterion that exists and is
mis-recorded. HERE THERE IS NO CRITERION TO MIS-RECORD. The pipeline has no entry
point at all for "a change was made on purpose, to achieve X, and here is what
would show it did" unless that change is first promoted to a task.

AND THE QUEUE IS WHERE THIS CONCENTRATES, STRUCTURALLY. A finding's fix is small,
well understood, and already justified in writing by the finding itself - which
is precisely the profile of work nobody opens a task for. Opening one feels like
ceremony when the finding already explains the problem and names the remedy. So
THE SYSTEM'S OWN IMPROVEMENT LOOP IS THE WORK LEAST LIKELY TO BE SPECIFIED, and
the more disciplined the queue gets, the more true that becomes: a well-written
finding makes its fix feel too obvious to spec.

THE ASYMMETRY THAT MAKES THIS SHARP. `retro.mjs` will not let a finding be filed
quietly without an assertion. It does not refuse - it writes the absence into the
document in the words the next reader needs: "NOT SUPPLIED. Whoever applies this
must write one before building the fix: name the broken build the assertion
catches, and confirm the assertion FAILS against it first." The queue therefore
has a DESIGNED SLOT for "the check this needs", and marks it when empty. THE FIX
HAS NO SLOT AT ALL. The report is held to a standard the remedy is not, and it is
the remedy that changes how the software behaves.

CONSEQUENCES, BOTH DIRECTIONS.
  1. A fix that shipped and does not say so gets implemented twice. The queue is
     carried into the system repository and applied by someone who was not
     present when the fix landed; nothing in the finding records that its project
     half is already done.
  2. WORSE, AND LESS OBVIOUS: a fix that did NOT achieve its aim leaves no
     statement to check it against. Reimplementation is recoverable. A change
     that was supposed to close a gap, did not, and passed the checker anyway is
     recorded as a success with no way back to the intent it failed.

NOT AN ARGUMENT FOR RETRO-SPECCING, AND THIS MATTERS. Writing a spec after the
change is manufacturing a record that reads as contemporaneous when it is a
reconstruction from the diff - the same laundering that was refused on 2026-09-06
for task 0002's missing summary, and refusing it there while doing it here would
be incoherent. What is missing is not a task. It is a LIGHTWEIGHT STATEMENT OF
INTENT, recorded AT THE TIME the change is made, naming what the change is for
and what would show it worked. A task is one way to carry that. It should not be
the only way, because the cost of the only way is that most of this work carries
nothing.

### The assertion, and the broken build it must catch

FOUR ASSERTIONS. The first is the defect; the next two stop it being "fixed" by
closing the escape hatch or by laundering; the fourth is the green direction.

FIRST, AND RED TODAY: a standards run over changed files with no task in scope
must not report an UNQUALIFIED `"verdict": "pass"`. It must be distinguishable -
a distinct verdict value, or an explicit field - meaning "standards pass; no
statement of intent exists for these changes".
  THE BROKEN BUILD: 0.1.34 as it stands. Reproduce today's run - a working tree
  with substantive source changes and no task - and require the output to be
  bare `"verdict": "pass", "task_id": null`. Confirm that FIRST. An
  implementation that already reports something else is reading a different tree.

SECOND, SO THE FIX IS NOT "REFUSE UNTASKED WORK": an untasked change must still
be ALLOWED. Assert that the run completes and does not block. The ability to make
a small fix without opening a task is the same escape hatch the reporting channel
depends on, and closing it would reproduce finding 20's shape - a control that
protects the record by making the work unreachable. If the two cannot both hold,
KEEP ALLOWING and report the gap loudly; an unrecorded change is recoverable and
a blocked fix is not.

THIRD, SO THE FIX IS NOT RETRO-SPECCING: the statement of intent must be
recordable WITHOUT creating a task or a spec, and no code path may DERIVE its
text from the diff.
  THE BROKEN BUILD THIS MUST CATCH: a command that generates the intent note by
  summarising the change. That build satisfies assertions one and two, produces a
  document that reads as a contemporaneous statement of purpose, and is a
  reconstruction - exactly the artefact refused for task 0002's summary. Assert
  the intent text originates from the author at change time and is never
  synthesised from the tree.

FOURTH, GREEN DIRECTION, so this is proven both ways rather than merely shown
capable of failing: on a corrected copy where the change carries a statement of
intent, the run must report a clean qualified pass, name the statement, and not
warn. A check only ever demonstrated red proves it can fail, not that it
discriminates.

SCOPE NOTE: none of these asserts the intent statement is TRUE, or that the
change achieved it. That is the same boundary finding 26's reference check draws
- existence, not sufficiency. The narrow version is what was missing today.

---

# Finding 29 - Durable copies of the queue are correct only at the instant they are written, nothing detects the drift, and the refresh is refused by a message that opens exactly like the one meaning success

Filed: 2026-09-06T14:00:43Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/retro.mjs - escrowQueue() collision branch, applyPlan() destination naming, and the escrow provenance header`

THE DURABLE COPIES ARE CORRECT AT A MOMENT AND DRIFT FROM THEN ON, NOTHING
DETECTS IT, AND THE REFRESH PATH REFUSES IN A MESSAGE THAT READS LIKE THE ONE
MEANING SUCCESS.

Finding 9 made the queue SURVIVABLE. Survivable and current are different
properties, and only the first was delivered.

THE RATES DO NOT MATCH, WHICH IS THE WHOLE DEFECT. The project queue moves
continuously - every --record and every --amend. The escrow is written once per
--apply. The system-repository copy is written once per hand carry. Two snapshots
against a continuously moving source, with no comparison between them.

MEASURED 2026-09-06, AND THE MEASUREMENT ITSELF WILL BE STALE, WHICH IS THE POINT:
  project queue                          28 findings, 30 addenda
  escrow copy cartoonify-2026-09-06.md   27 findings, 19 addenda, no finding 28
  escrow provenance header stamped       2026-09-06T12:25:50Z
Eleven addenda and one finding behind, roughly ninety minutes after it was
written. Nothing in either artefact reports the difference.

IT RECURRED INSIDE THE HOUR, AND THE SECOND TIME IS THE INSTRUCTIVE ONE. After the
divergence was noticed, the escrow was re-run to refresh it. IT DID NOT REFRESH.
applyPlan() names the destination <project_id>-<YYYY-MM-DD>.md, so a second run on
the same day targets the file the first run created, and escrowQueue() takes its
clash branch: "Nothing was written and nothing in the project was touched." The
escrow on disk is still the 12:25:50Z copy.

AND THE REFUSAL IS MISREADABLE AS THE SUCCESS. Compare the two messages the same
command produces, at their openings:

  fresh:  "could not locate the system repository. Looked for ... THE FINDINGS
           ARE SAFE. They were written, before this message, to: ..."
  clash:  "could not locate the system repository, and the durable copy already
           exists: ... Nothing was written and nothing in the project was
           touched."

Both open with the identical clause. The operator has by now been trained -
correctly, by finding 9's fix - that this clause introduces a NOTIFICATION and
that the findings are safe. In the clash case the same opening introduces a
refusal, and the load-bearing words are "Nothing was written", unemphasised, after
a subordinate clause that reads as reassurance ("the durable copy already
exists"). One means your work is preserved and the other means your newest work is
not, and they are distinguished by a clause arriving after the part that looks
like the answer.

THE COLLISION RULE IS NOT WRONG AND MUST NOT BE WEAKENED. Its reason is stated in
the source: "a lesson is evidence, so a second run on the same day must not
replace the first." That is correct. Overwriting an escrow would destroy evidence,
which is the failure mode this whole mechanism exists to prevent. The defect is
that PRESERVING THE OLD COPY AND TRACKING A GROWING QUEUE were treated as one
operation, so choosing the first silently forfeited the second.

THE PROVENANCE HEADER IS THE NATURAL HOME FOR THE MISSING FACT AND DOES NOT CARRY
IT. Each escrow copy is written with a header naming the command, the ISO
timestamp, the project, the plugin version and the source path. It records WHEN it
was taken and WHERE it came from. It records nothing about WHAT it contains - no
digest of the source, no finding count, no addendum count. A reader who opens
cartoonify-2026-09-06.md in the system repository can see the date and cannot
determine that eleven addenda were added to the source after it. The header
already tells that reader the copy is "NOT APPLIED" and that carrying it is "still
owed"; it cannot tell them it is also not current.

THIS IS FINDING 2'S SHAPE ON THE SYSTEM'S OWN RECORD. Finding 2's addendum states
it: "Write-once generation is the defect." An artefact generated once from a
source that keeps moving is correct at creation and wrong forever after, with
nothing to notice. The difference is what is drifting. .env.example describes one
project's configuration; THIS FILE IS THE RECORD OF THE SYSTEM'S OWN DEFECTS, and
it is the artefact carried into the repository that governs how every downstream
project is built. A stale .env.example misconfigures one project. A stale lessons
copy means the fixes applied to the system are chosen from a list missing its
newest entries - and the missing entries are systematically the CORRECTIONS,
because amendments are how this queue records that an earlier claim was wrong.
Finding 24's five stamp corrections and finding 9's own first-use qualification
are both among the eleven that did not travel.

WHAT THE FIX IS NOT. Re-running --apply after every amendment is a PROCEDURE, and
finding 9 is four consecutive sessions of evidence that procedures do not hold -
the whole argument for fix 3 was that it "does not depend on the operator doing
anything". A currency requirement that depends on the operator remembering
reintroduces exactly the dependency fix 3 removed. It is worse than that here: the
procedure does not merely go unperformed, it is REFUSED by the collision rule, on
the same-day timescale amendments actually happen.

THE TWO SHAPES THAT WOULD WORK. Either the durable write is TRIGGERED BY THE
AMENDMENT rather than by --apply, so the copy cannot lag by construction; or the
copies CARRY A DIGEST OF THEIR SOURCE and something compares them and reports the
divergence - --list, doctor, or the header itself. The first removes the gap; the
second makes it visible and dated. Either satisfies the constraint a procedure
cannot.

### The assertion, and the broken build it must catch

FIVE ASSERTIONS. The first is the defect, three are guards on the obvious wrong
fixes, and the last is the green direction.

FIRST, AND RED TODAY: the staleness of a durable copy must be DETECTABLE without
opening both files and counting. Something - --list, doctor, or the copy's own
header - must report that the escrow does not match the queue it was taken from.
  THE BROKEN BUILD: the current tree. Reproduce it exactly - an escrow written,
  then any --amend - and require that NOTHING anywhere reports a divergence.
  Confirm that FIRST. Today's instance: escrow at 27 findings / 19 addenda,
  project at 28 / 30, and no command reports it.

SECOND, SO IT IS NOT FIXED BY OVERWRITING: a refresh must not destroy the earlier
copy. Assert that after a refresh the previous escrow content is still
retrievable. The collision rule's reason - "a lesson is evidence, so a second run
on the same day must not replace the first" - is correct, and must not be traded
away to buy currency. The broken build here is the one-line change that drops the
clash check.

THIRD, SO IT IS NOT A PROCEDURE: the currency signal must not depend on anyone
running a command after an amendment. Assert that --amend ALONE is sufficient to
make the divergence detectable - either it updates the durable copy or it marks it
stale. A build in which the operator must run --apply to learn that --apply is
owed satisfies assertion one and fails this, and it is the fix most likely to be
written.

FOURTH, THE MESSAGE, AND IT IS SEPARABLE FROM THE REST: an operator reading only
the first line must be able to tell a completed escrow from a refused one.
  RED TODAY: both messages open with the identical clause "could not locate the
  system repository". Assert the clash path LEADS with what did not happen.

FIFTH, GREEN DIRECTION, so this is proven both ways rather than merely shown
capable of failing: on a corrected copy, escrow then amend, and require the
divergence to be REPORTED, the earlier copy to still exist, and no command to have
been run in between. Then refresh, and require the report to clear. A check only
ever demonstrated red proves it can fail, not that it discriminates.

SCOPE NOTE: none of this asserts the system-repository copy is current - that one
is written by a person on another machine and no check here can see it. What a
digest in the header WOULD give that reader is the ability to compare it against a
queue when they next hold both, which is the most available across a manual carry.
