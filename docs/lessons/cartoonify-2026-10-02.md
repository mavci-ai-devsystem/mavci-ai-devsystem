<!-- Applied by /mavci-core:retro --apply on 2026-10-02T14:01:31Z
     from project cartoonify, plugin 0.1.35, queued as .mavci/lessons/pending-system-change.md.
     Copied verbatim below this line. Paths inside are relative to the project it was
     filed from, not to this repository. -->

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

### Addendum to finding 3 - Second instance: a correct spec that pins the gate warning count cannot be seen by the router

Amended 2026-09-09T17:05:16Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

SECOND INSTANCE, AND IT BLOCKED A REAL CHAIN. Observed 2026-09-09, project
cartoonify, plugin 0.1.34, task 0004.

WHAT HAPPENED. The operator ran the ship chain with a style-library request. The
router returned `plan`, the architect wrote a complete spec to
`.mavci/tasks/0004-style-library-groups-and-the-picker.md` - 754 lines, 18
executable criteria, two ADRs - and the next router consultation returned:

    "action": "plan", "dispatch": "mavci-architect",
    "why": "task 0004 has no spec at .mavci/tasks/0004-style-library-groups-and-the-picker.md"

The file exists, is 56575 bytes, and was written eleven minutes earlier. The
mechanism is unchanged from the original filing and is `route.mjs:197`:

    if (String(specText).includes(REVIEW_MARKER)) return false;  // watermarked, not written

The spec contains the string once, at line 488.

WHAT IS NEW, AND IT IS NOT THAT IT HAPPENED TWICE. The original filing was
against task 0001, where the marker appeared incidentally. Here it appeared
NECESSARILY, and that changes the severity.

The spec's criterion 1 pins the standards gate at "0 blocking, 5 warning(s)". A
spec that pins a warning COUNT has to say what the warnings ARE, or the number
is a magic constant nobody can check. Saying what they are means naming the
scaffolded-legal-page marker. So:

  A CORRECT SPEC, DOING A NECESSARY THING, CANNOT BE SEEN BY THE ROUTER.

That is a different claim from the original filing. It is not that an author
might unluckily choose a phrase; it is that pinning the gate's own output makes
the spec unwritable. Every project this plugin governs that carries scaffolded
legal pages has five such warnings, so every one of them has a spec it cannot
write.

THE FAILURE IS SILENT AND READS AS SOMEONE ELSE'S FAULT. The router does not
report that it cannot see the spec; it reports that the spec does not exist, and
names the architect as the fix. An orchestrator following the ship skill as
written redispatches the architect, gets another spec, and consults again -
forever, or until the twelve-consultation ceiling ends it by exhaustion rather
than by diagnosis. Nothing in the output points at the marker. The only reason
this instance was diagnosed in one step is that finding 3 was already in the
queue and its title matched the symptom.

COST HERE. Two full architect turn-budgets, roughly 268k subagent tokens, and a
spec that cannot be approved. The chain stopped at the operator rather than
looping, but only because the queue was read.

WHAT THE FIX HAS TO SURVIVE, since the obvious one does not. Making the check
smarter about WHERE the marker appears - only in a heading, only at the top,
only outside a fenced block - fails on this instance: line 488 is ordinary prose
in an acceptance-criteria section, which is exactly where a spec would legitimately
explain what it is pinning. The marker means "this document is a watermarked
draft", and a spec MENTIONING the marker is not a watermarked draft. Those are
different facts and the current check cannot tell them apart because it looks for
a substring rather than for the watermark's own position and form.

A spec that IS a draft carries the marker the way the legal pages do - as its own
banner. A spec that DISCUSSES the marker carries it as a quoted token. Any fix
that does not distinguish those two will either keep this deadlock or stop
catching real drafts.

REPRODUCED BY: writing any spec that pins the standards gate's warning count and
explains what the warnings are. No unusual input required.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 3 - Fixed in 0.1.35 - banner versus mention, and the message that makes a prose heuristic affordable

Amended 2026-09-09T18:36:08Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

FIXED IN 0.1.35, ALONG THE LINE THE SECOND-INSTANCE ADDENDUM DREW.

hasSpec no longer asks whether the marker OCCURS. It asks whether the document
carries it as a BANNER: the marker must open the line, after banner punctuation
only - heading, bold, blockquote, bullet, rule, HTML or JSX comment opener -
outside a fenced block and outside a four-space indent, which are markdown's own
two ways of quoting one. A QUOTE CHARACTER IS DELIBERATELY ABSENT FROM THAT
PUNCTUATION SET, and that single omission is the whole discrimination: a line
reading `REVIEW REQUIRED` markers stay does not start with the marker, it starts
with the backtick. The line this project died on twice - the criterion pinning the
gate at five warnings - fails both tests, on position and on form, and is now
read as what it is.

THE FINDING'S OWN FIRST PREFERENCE WAS DECLINED, and the reason is recorded beside
the code so it is not tried again as an improvement. A second machine-only
sentinel would be a marker nothing writes: createTask does not stamp a spec stub
- that is the system's carried-forward item 6, still unbuilt - and the convention
item 6 settles on is explicitly this one, "a watermark first line in the REVIEW
REQUIRED shape the legal pages already use, one convention rather than two". A
sentinel with no writer is a mechanism present, correct-looking and never reached.

Position alone was declined for the reason the addendum gives: line 488 is
ordinary prose in an acceptance-criteria section, which is exactly where a spec
legitimately explains what it is pinning.

THE OTHER HALF, WHICH MATTERS MORE THAN THE HEURISTIC. The addendum's sharpest
observation is that the failure was silent and read as someone else's fault - the
router reported the spec as ABSENT and named the architect as the fix, so nothing
in the answer pointed at the marker. A rejection for the watermark now names the
marker, the line number, the line itself, and the one edit that clears it: quote
it, indent it, or fence it, and nothing else in the spec changes. That is what
makes a prose heuristic affordable at all.

THE RESIDUAL, STATED RATHER THAN CLOSED. An unquoted marker opening a bullet -
"- REVIEW REQUIRED markers must survive" - still reads as a banner. The author's
fix is to quote it, which is what they would write anyway. That trade is
acceptable only because of the message above; if the message is ever weakened the
heuristic has to be revisited with it.

THE ASSERTION THIS FINDING WAS FILED WITHOUT, supplied: check-route.mjs section W,
thirteen cases. W1 reproduces the live defect at the router - a spec quoting the
marker must route PAST plan - and W2-W5 and W13 are the mentions, W6-W9 the
banners. The two halves are each other's control and the mutation sets are
disjoint: restoring the shipped includes() reddens every mention and no banner;
deleting the marker test outright reddens every banner and no mention. Asserting
one half would have passed a build that had gone the other way entirely.

W13 exists because a mutation went green. Every case written before it answered
position and form the same way - a mention was mid-line AND quoted, a banner
line-leading AND bare - so making a quote count as banner punctuation reddened
nothing, and the form half was load-bearing in the code and asserted nowhere. A
marker quoted at the head of a bullet is where the two come apart.

The smaller note at the end of the body - two task records, surface and control,
and an agent reading one sees half the task - is untouched by this release.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

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

### Addendum to finding 4 - Third gap in the same seam: what the prose describes versus what the command executes - and two defects in one criterion, only one blocking

Amended 2026-09-13T10:04:16Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Finding 4 filed the gap between what a criterion ASSERTS and what it REQUIRES.
Finding 36 filed the gap between what a criterion asserts and what its own proof
table CONCEDES. Task 0004 criterion 18 is a third gap in the same seam, and it is
the one that actually stopped a task: what the criterion's prose DESCRIBES versus
what its command EXECUTES.

WHAT WAS OBSERVED

Project cartoonify, task 0004, verify attempt 1. Criterion 18 ("scope
containment", labelled discriminating) failed with:

    out of scope for task 0004: public/styles/.gitkeep

The criterion's command, in the executable block of the spec, runs:

    git status --porcelain --untracked-files=all -- ':!.mavci'

and filters its output against two hard-coded lists, both of which contain the
literal string 'public/':

    const allowed  = [..., 'public/', ...]
    const required = [..., 'public/']

Twenty lines above it, in the same criterion, the spec states its own limitation
in prose, under the heading "Known weakness, stated rather than hidden":

    git collapses untracked directories, so `public/` appears as one line and
    this criterion cannot see inside it.

That sentence is true of --untracked-files=normal. The command invokes
--untracked-files=all, which is the mode whose entire purpose is to DISABLE that
collapsing and list every file individually. The prose and the command, inside one
criterion, describe opposite git modes. The prose is the half a reviewer reads.

MEASURED, BOTH MODES, SAME TREE

    --untracked-files=all     ->  ?? public/styles/.gitkeep
    --untracked-files=normal  ->  ?? public/    and    ?? scripts/

Instrumenting the criterion's own script verbatim against the built tree:

    OUT-OF-SCOPE  -> ["public/styles/.gitkeep"]   (allowed check throws first)
    MISSING REQ.  -> ["public/"]                  (required check throws next)

TWO INDEPENDENT THROWS, ONE ROOT. Correcting the `allowed` list alone does not
turn the criterion green: `required` still demands a bare `public/` line that
--untracked-files=all cannot emit under any circumstances.

THE CRITERION IS UNSATISFIABLE, NOT MERELY WRONG ABOUT THIS BUILD

Under =all there is no builder output that passes:

  - public/styles/ holding .gitkeep      -> out-of-scope throw
  - public/styles/ holding .webp files   -> out-of-scope throw on each
  - public/ empty                        -> git tracks no empty directory, so
                                            the required check throws instead

A perfect implementation of the section the criterion exists to police fails it.
The failure is independent of the code under test, which is the property that
makes it a spec defect rather than a builder defect.

(=normal would not rescue it either: it emits `?? scripts/`, and `allowed`
contains only `scripts/check-styles.mjs`.)

THE SEPARATION THAT IS THE FINDING

This criterion carries TWO defects, and only one of them blocks:

  1. NON-BLOCKING, prose only. The criterion's narrative states "four of the seven
     required paths are absent from the status output", and the proof table
     repeats the count. The count appears nowhere in the command. A wrong number
     there cannot change what the criterion asserts. An earlier reading of this
     criterion found that count to be off by one and stopped there.

  2. BLOCKING, command and data. The unsatisfiable `public/` literal above.

Both are true. The first reading was accurate and incomplete. Stopping at "the
criterion is wrong" was never a sufficient answer, because the two defects imply
different remedies: a wrong count is corrected in prose at no cost, while an
unsatisfiable assertion has to be waived or the spec reopened for re-approval. A
waiver reason naming the count would have silenced the wrong thing and left the
record asserting that a countable, transient fact blocked the task.

The two defects touch at exactly one point, and that point is the mechanism:
whatever the total was, `public/` was counted among the paths that were
TEMPORARILY absent, pending the builder creating the directory. It is
PERMANENTLY absent under the flag the command uses. The prose misclassified one
entry, and the command encodes that same misclassification as an assertion. One
misreading of git's behaviour, surfacing once as a wrong number nobody need act
on and once as a criterion nothing can satisfy.

WHY THIS IS FINDING 4's SEAM AND NOT A NEW ONE

Finding 4 says spec review reads assertions and is silent about requirements.
This is the same silence one layer down. Review reads the criterion's PROSE -
its heading, its rationale, its stated weaknesses - because that is what is
written to be read. The command is a JSON-encoded shell string containing an
embedded heredoc containing a node script; it is written to be RUN. Nothing
compares the two, and here they disagreed about a flag while sitting eighteen
lines apart in one numbered item.

The spec was approved. The proof table had already recorded this criterion as
"red only - the green direction was not proven" (finding 36's subject), so the
one criterion whose passing direction rested on reading rather than execution
was also the one whose prose described the wrong git mode. The concession and the
contradiction were in the same item, and the gate read neither.

WHAT MUST BE ASSERTED

State it as a check over the spec's own executable block, not over the project:

  For every criterion, extract the command actually executed, and compare the
  flags and modes it names against the flags and modes named in that criterion's
  prose. Where the prose names a behaviour that a flag in the command disables,
  refuse the spec.

The narrow, cheap form that would have caught this exact case: if a criterion's
command passes --untracked-files=all, its prose must not claim directory
collapsing; if it passes =normal, its literals must not be individual file paths.

The broken build it must catch, stated concretely so the assertion can be tested
against it: a spec in which one criterion's rationale describes
--untracked-files=normal semantics while its command passes --untracked-files=all,
and whose allowed/required literals are therefore unmatchable - sealed, approved,
and failing on attempt 1 against a correct implementation. That is this document.

A stronger and more general form, if it is affordable: a criterion declared
DISCRIMINATING whose green direction was never demonstrated should be refused, or
at minimum stamped, at the approval gate rather than at verify. That overlaps
finding 36 and is recorded here only to note that the two checks would have
caught this from opposite ends - one by reading the flag, one by demanding the
proof.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 4 - Correction: the count IS verifiable, it is five not four, and section 2 quotes the evidence section 8 miscounts

Amended 2026-09-13T13:23:08Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

The previous addendum recorded the non-blocking half of criterion 18's defect -
the absent-path count in prose - as unverifiable, on the grounds that the
pre-build tree was not recoverable from git. That was wrong: it was recorded in
the spec itself, in a section the earlier reading did not consult.

Section 2 of the task file, "The state on disk when this spec was written",
quotes the exact command and its exact output at HEAD bc44bd7:

     M app/api/cartoonify/route.ts
     M lib/cartoon-styles.ts
     M lib/image-constraints.ts
     M package.json
    ?? docs/adr/README.md
    ?? scripts/check-styles.mjs

Criterion 18's `required` list holds seven paths. Counted against that recorded
output:

    components/cartoonify-form.tsx   ABSENT
    app/globals.css                  ABSENT
    lib/cartoon-styles.ts            present
    app/api/cartoonify/route.ts      present
    components/style-card.tsx        ABSENT
    lib/style-previews.ts            ABSENT
    public/                          ABSENT

FIVE absent. Section 8 states four, and section 9.1 row 18 repeats four. The
earlier reading was correct and the count is off by one, now established from
the spec's own recorded evidence rather than from inference.

This does not change which defect blocks - the unsatisfiable `public/` literal
still does, and the count still appears nowhere in the command. It changes the
standing of the two claims. Both halves of the finding are now verified facts
rather than one verified and one asserted, and the prose defect is confirmed to
be a genuine second defect rather than a possible misreading.

It also sharpens the mechanism. Section 2 records a real git status, and section
8 miscounts against it - two prose sections of one spec, disagreeing about
evidence one of them quotes verbatim. The count was checkable at approval time
by reading section 2 against section 8, with no execution required at all. The
approval gate did not, and neither did the first reading of the failure.

WHAT THIS ADDS TO THE ASSERTION

The previously stated assertion - compare a criterion's prose against the flags
its command actually passes - stands. Add the cheaper sibling it implies:

  Where a spec states a count of paths, files, or criteria, and elsewhere quotes
  the evidence that count is drawn from, recompute the count from the quoted
  evidence and refuse the spec on a mismatch.

The broken build it must catch: a spec whose section 2 quotes a six-line git
status, and whose section 8 says four of seven required paths are absent from
it, when five are. That is this document, and no execution is needed to catch
it - only reading two sections against each other, which is exactly the thing a
human reviewer is worst at and a checker is best at.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

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

### Addendum to finding 29 - The refresh worked, and every part of how it worked is the defect: four manual steps, a preserved copy nothing names, and a carry that failed at the remote

Amended 2026-09-06T14:18:08Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE REFRESH SUCCEEDED, AND HOW IT SUCCEEDED IS THE FINDING RESTATED AT FULL SIZE.

VERIFIED 2026-09-06T14:15:57Z. The new escrow matches the project queue exactly -
29 findings, 30 addenda, and the body below the provenance header is byte-for-byte
identical, sha256 7c539999f5db9fbd9dc929171e6be6fd072fc0dd749385a96a0c86737c846182
on both. The stale copy is preserved at 27 findings / 19 addenda, stamped
12:25:50Z. The system-repository copy was carried and committed, 842 lines added.

NOTE WHAT ESTABLISHING THAT REQUIRED: opening both files, stripping a header of
known length, and computing a digest by hand. That digest is precisely the fact
assertion one says the header should carry. The check was possible only because
someone already suspected the answer.

1. THE MANUAL DANCE IS THE FIX'S SHAPE IN MINIATURE. Keeping the record current
took FOUR OPERATOR STEPS: rename the stale copy, re-run --apply, carry the result,
commit it. Every one is exactly the kind of procedure finding 9 spent four
sessions establishing does not hold. The fix for a procedure that fails is not a
longer procedure.

AND THE CONDITIONS IT SUCCEEDED UNDER CANNOT BE RELIED ON. It worked today because
the divergence was detected by someone else and reported in the same minute it was
learned - the tightest feedback loop available, and one that exists only while a
second party happens to be reading the same file. Next time the drift will be
noticed, if at all, by whoever opens the copy in the system repository weeks later
and has no way to know what is missing. TODAY IS NOT EVIDENCE THE PROCEDURE HOLDS.
It is evidence that a procedure holds when someone is standing next to it.

2. THE PRESERVED COPY IS AN ARTEFACT NOTHING NAMES. The collision rule protects
the old copy and gives no way to tell the two apart. What is on disk now:

    cartoonify-2026-09-06.md     269832 bytes   29 findings   14:15:57Z  CURRENT
    cartoonify-2026-09-06-a.md   219162 bytes   27 findings   12:25:50Z  STALE

The -a suffix is the OPERATOR'S convention. No code produced it, no code will
recognise it, and nothing in either file points at the other. A reader arriving at
that directory sees two files with the same date and can order them only by size,
or by opening each and reading a timestamp out of a comment.

AND THE SUFFIX READS BACKWARDS. An alphabetical or sequence suffix normally
implies EITHER the first in a series OR a later revision; here it means the
superseded one. The current copy holds the unsuffixed canonical name only because
the operator chose to rename the old file rather than name the new one -b. Had
they done the reverse - the more natural reading of "add a suffix to the new
thing" - the STALE copy would now hold the name any tool would regenerate and any
reader would treat as canonical.

So the collision rule's protection is real and its bookkeeping is entirely
manual: it refuses to destroy evidence, and then leaves the operator to invent a
naming scheme, apply it under time pressure, and get the direction right. That is
a second procedure hanging off the first.

THE CONSTRAINT THIS ADDS TO THE FIX: whatever preserves the old copy must also
ORDER the copies without a human convention - a sequence the tool assigns, or
content addressing, or a pointer in each header naming its predecessor and
successor. Assertion two requires the earlier copy to survive a refresh; this
requires that surviving it be identifiable afterwards. Preserved and
indistinguishable is only marginally better than overwritten.

3. THE CARRY HAS ITS OWN FAILURE MODE, AND IT IS THE ONE THAT MATTERS MOST.
The push failed on the wrong active account - the tenth time this week. So
durability is not one property, it is three hops, and only two are held:

    survives the project directory being deleted    HELD, by the escrow
    survives the next propagation                   HELD, by the escrow's location
    reaches a remote                                NOT HELD

The escrow's own header claims exactly the first two and no more: it says the copy
"survives both the project being deleted and the next propagation". That is true,
and it is NARROWER THAN DURABLE. Both the escrow and the local commit live on ONE
MACHINE. If that machine is lost, twenty-nine findings go with it, and the escrow
mechanism will have performed perfectly throughout.

THE THIRD HOP IS THE ONLY ONE THAT MAKES THE RECORD AVAILABLE TO ANYONE ELSE, and
it is the only one with no mechanism at all - it fails for a reason unrelated to
this queue, silently as far as the queue is concerned, and repeatedly. Ten times
in a week is not an incident.

THE FAILURE MODES ALSO COMPOSE IN THE WORST ORDER. The refresh defect makes the
copy stale; the carry defect stops the copy moving. A stale copy that pushes
cleanly is wrong and visible to others. A current copy that does not push is right
and visible to nobody. Today produced the second, and the second is the one that
looks like success from inside the machine it is trapped on.

WHAT THIS DOES NOT CLAIM. The account failure is not established to be the
system's defect - it may be entirely environmental. It is recorded here because it
sets the ceiling on what this finding's fix can deliver: a mechanism that makes
the durable copy perfectly current still leaves the record on one machine. If the
recurrence has a cause in the tooling rather than the environment, that is a
separate finding and should be filed as one rather than folded in here.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

### Addendum to finding 29 - Third same-day instance: the escrow and the filing channel cannot both be satisfied inside one day, and the entry that could not travel is the plugin-registration finding

Amended 2026-09-10T11:55:58Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THIRD SAME-DAY INSTANCE, AND IT IS THE ONE THAT SHOWS THE TWO OPERATIONS ARE
MUTUALLY EXCLUSIVE WITHIN A DAY.

Observed 2026-09-10, plugin 0.1.35, project cartoonify, main session, in the
course of carrying out an operator instruction that asked for both operations in
one session.

WHAT HAPPENED, IN ORDER.

  10:44:57Z  escrow written, fresh path, no collision
             32 findings, 37 addenda, 325,643 bytes
  ~14:50Z    finding 33 filed - an unrecognised plugin registration found while
             propagating 0.1.35
  ~14:52Z    refresh attempted so the copy would carry finding 33
             REFUSED by the collision branch. Escrow on disk still 32/37.
             Live queue 33/37. Nothing written.

The refusal is verbatim: "could not locate the system repository, and the durable
copy already exists ... Nothing was written and nothing in the project was
touched. A lesson is evidence, so the escrow is not overwritten. Merge or rename
the copy above if this run is different."

WHAT IS NEW HERE, AND IT IS NOT THAT IT HAPPENED A THIRD TIME. The original
filing states the defect as a RATE mismatch - the queue moves continuously, the
escrow is written once per --apply. That is true and it understates the problem.
On any day when a finding is filed AND an escrow is taken, THERE IS NO ORDER OF
THE TWO THAT LEAVES A CURRENT DURABLE COPY:

  escrow, then file   -> the copy is behind by the filing, silently, and a
                         refresh the same day is refused
  file, then escrow   -> correct, but only if no escrow was taken earlier that
                         day; if one was, the refresh is refused identically

So the operator is not choosing badly or forgetting a procedure. The two
documented operations cannot both be satisfied inside one calendar day, and the
day on which both happen is precisely the day the queue changed - which is the
only day currency matters. The original filing's remedy note says a procedure
cannot carry this requirement. This instance says something narrower and harder:
there is no procedure available to carry it, because the collision rule and the
filing channel disagree at the granularity of the destination filename.

THE SELECTION IS AGAINST THE NEWEST ENTRY, AND THIS TIME AGAINST THE MOST
URGENT ONE. The finding that cannot travel is finding 33, which records that a
plugin nobody installed was registered on this machine with a marketplace entry
and an MCP server, and that nothing in this system enumerates the surface it was
registered on. The durable copy an operator would carry to the repository that
governs every project is behind by exactly that.

ASSERTION 4 IS STILL RED AT 0.1.35, MEASURED RATHER THAN ASSUMED. The two
messages still open with the identical clause. Fresh: "could not locate the
system repository. Looked for ..." Clash: "could not locate the system
repository, and the durable copy already exists ...". The load-bearing words -
"Nothing was written" - are still the second sentence, still unemphasised, still
arriving after a subordinate clause that reads as reassurance. 0.1.35 was
findings 3 and 32; nothing in this finding was built.

AND THE MESSAGE PRESCRIBES THE HAND-CARVE. "Merge or rename the copy above if
this run is different" is advice to do by hand the thing the mechanism refuses to
do, and the escrow directory already carries the result of somebody taking it:
cartoonify-2026-09-06-a.md sits beside cartoonify-2026-09-06.md, 219,162 bytes
against 269,832, two copies of the same day distinguished by a suffix a person
chose. That file is not a second queue; it is this defect's scar tissue.

WHAT WAS NOT DONE, AND WHY IT IS NAMED. The stale escrow was NOT deleted to force
a clean write. Deleting it is the one-line change the finding's second assertion
exists to forbid - "a lesson is evidence, so a second run on the same day must not
replace the first" - and the fact that the stale copy is four hours old and was
written by this same session does not make it less of a durable copy. The
collision rule was obeyed. The cost of obeying it is this addendum.

CARRY PATH FOR TODAY, so the instruction is not left half-done. The system
repository is checked out on this machine, so the current bytes can be carried
directly from the project queue rather than from the escrow. The escrow at 32/37
should be carried too, or left, but it should not be mistaken for current.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 29 - Fourth same-day instance, and the first that did not happen: the finding was read, the command was not run, and the rename carries a count instead of a letter

Amended 2026-09-10T14:32:38Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE FOURTH INSTANCE IS THE ONE THAT DID NOT OCCUR, AND THE REASON IT DID NOT IS
THE PROPERTY THIS FINDING SAYS CANNOT BE RELIED ON.

Two hours after the third addendum was written, the operator instruction arrived
asking for exactly the operation the third addendum had just recorded being
refused: refresh the durable copy so it carries finding 33. Running it would have
produced the silent no-op a fourth time, on the same day, against the same
destination filename, in the same session that had documented it.

It did not run. The collision branch was READ - in this finding, in this file -
and the rename was done first. The escrow at 32 findings was moved to
cartoonify-2026-09-10-32.md, which frees the destination the fresh write needs,
so the write is a fresh path rather than a clash and no evidence is overwritten.

A FINDING THAT STOPS ITS OWN NEXT INSTANCE IS THE QUEUE WORKING. That is worth
recording plainly, because most of what is in this file is the queue failing to
prevent anything. This entry predicted the operation, named the destination
collision, quoted the two messages that share an opening clause, and the
prediction was correct in every particular.

AND IT WORKED BY THE MECHANISM THIS FINDING ALREADY SAYS IS NOT AVAILABLE. It
worked because somebody read a 4,000-line queue before running a one-line
command. The original filing states it: "Re-running --apply after every amendment
is a PROCEDURE, and finding 9 is four consecutive sessions of evidence that
procedures do not hold." Reading the queue first is a procedure with a worse
success rate than that one, because it requires not just remembering to act but
remembering to go and look for a reason not to. This instance is a success and it
is not evidence of a fix; it is one operator, on one day, who happened to have the
finding in front of them. Assertion 1 is still red. Nothing reported the
divergence - a person went and counted.

THE SUFFIX SHOULD CARRY THE COUNT, NOT A LETTER, AND THIS IS THE CHEAP HALF OF
THE FIX. The third addendum names cartoonify-2026-09-06-a.md as this defect's
scar tissue - two copies of one day distinguished by a letter a person chose. A
letter is arbitrary: -a sorts before the unsuffixed name in some listings and
after it in others, and a reader holding both files cannot tell from the names
which one is current. They have to open both and count, or compare byte sizes and
guess.

  today       cartoonify-2026-09-10-32.md   32 findings, 325,643 bytes
              cartoonify-2026-09-10.md      the fresh write, 33 findings
  2026-09-06  cartoonify-2026-09-06-a.md    219,162 bytes, contents unstated
              cartoonify-2026-09-06.md      269,832 bytes, contents unstated

A COUNT IN THE FILENAME COSTS NOTHING AND MAKES THE COPIES ORDERABLE WITHOUT A
HUMAN CONVENTION. applyPlan() already knows the finding count at the moment it
writes - it is reading the queue. Naming the destination with it, or renaming the
incumbent with it on collision, means a reader with two copies can rank them from
the names alone and knows which is behind and by how much. That is not the fix
this finding asks for: the fix is that staleness is DETECTED, and a filename is
not a detector. It is the part of the fix that requires no new mechanism, no
digest, no comparison step and no operator, and it removes the specific hand-carve
the refusal message currently prescribes.

SO THE ASSERTION GAINS A SIXTH, AND IT IS SMALL. Two durable copies of the same
project must be orderable by their filenames alone. The broken build is the
2026-09-06 pair: give a reader those two names and require that they cannot say
which is current. The green direction is today's pair, where -32 against an
unsuffixed 33 answers it without opening either file.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 29 - Fifth same-day instance, and the first that destroyed evidence: the collision rule is inside escrowQueue, so a plain mv walks around it - and the count suffix was wrong for five minutes

Amended 2026-09-10T14:43:38Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE FIFTH INSTANCE IS THE FIRST IN WHICH THE EVIDENCE WAS ACTUALLY DESTROYED,
AND IT WAS DESTROYED BY THE STEP THE FOURTH ADDENDUM ADDED TO PREVENT IT.

Sequence, all on 2026-09-10, all timestamps from the files themselves:

  10:44Z  --apply escrows the queue at 32 findings, 325,643 bytes, as
          cartoonify-2026-09-10.md
  14:32Z  the fourth addendum is written. The 32-finding escrow is renamed to
          cartoonify-2026-09-10-32.md, freeing the destination, and the addendum
          records that "the write is a fresh path rather than a clash and no
          evidence is overwritten"
  14:33Z  --apply writes cartoonify-2026-09-10.md fresh, 33 findings, 341,675
          bytes. Both copies now exist. This is the finding working
  14:38Z  the main session, acting on an operator instruction that restated the
          fourth addendum's own plan, runs
            mv cartoonify-2026-09-10.md cartoonify-2026-09-10-32.md
          without listing the directory first. The destination held the 32-finding
          escrow. mv clobbers. The 10:44Z artifact ceases to exist, silently

THE PROTECTION IS INSIDE THE WRITER, SO IT PROTECTS ONLY THE WRITER'S PATH.
escrowQueue refuses when any destination exists, and that refusal is the entire
reason the fourth instance was safe. It has no purchase on any other route into
that directory. A rename typed at a shell is not a clash the escrow can see. The
rule is written as "a lesson is evidence, so the escrow is not overwritten"; what
it enforces is "escrowQueue does not overwrite". The gap between those two
sentences is this instance, and the queue has now recorded both halves of it on
one day: the guarded path holding, and the unguarded path beside it losing the
exact artifact the guarded path had just preserved.

WHAT IS RECOVERABLE: NOTHING, AND THE REASON IS WORTH STATING. The escrow lives
outside every git tree by design. HEAD's copy of the queue carries 23 findings and
189,800 bytes, so version control has no 32-finding state to return. No unique
CONTENT was lost - --amend appends a stamped addendum and never edits, so findings
1 to 32 as they stood at 10:44Z survive inside the 33-finding copy - but that is an
argument available only after the fact, and it is the same argument that would
excuse the next overwrite. What was lost is a dated artifact: the byte-exact record
of what this queue looked like at 10:44Z, which is the only thing an escrow is for.

THE COUNT SUFFIX INHERITED THE DEFECT IT WAS PROPOSED TO FIX. For five minutes the
directory held a file named -32 containing 33 findings. A letter suffix is
arbitrary; a count suffix is a CLAIM, and a claim maintained by hand is wrong the
moment a hand is wrong - which is the shape this file records under other headings
as a stamp asserting something nothing computed. The proposal in the fourth
addendum stands and needs one addition:

  THE COUNT MUST BE WRITTEN BY THE ESCROW WRITER, FROM THE FILE IT IS WRITING,
  never by an operator or an agent at a shell. escrowQueue already reads the bytes
  it copies; counting findings in them is one line, and it makes the name a
  derived fact instead of an assertion.

And a second limit the fourth addendum did not reach: two copies made on the same
day with the SAME count are not ordered by the count either. Today's directory
would have held -32 and -33 and been legible; tomorrow's may hold two 33s. The
escrow's own ISO timestamp is already inside the file, in the provenance comment,
and is absent from the name. If the writer names the file it should carry both.

THE ASSERTION, AND THE BROKEN BUILD IT MUST CATCH. The fourth addendum's fix is
testable and this instance supplies the test that would have gone red:

  1. escrowQueue names each file <project>-<date>-<n>.md where n is counted from
     the bytes being written, and the count is never accepted from a caller.
  2. A check over escrowDir(): for every file whose name carries -<n>, the number
     of `^# Finding ` headings in it equals n. Any mismatch is a FAIL naming both
     numbers.

BROKEN BUILD, AND IT WAS THIS DIRECTORY FOR FIVE MINUTES ON 2026-09-10: a file
named cartoonify-2026-09-10-32.md containing 33 findings, with nothing anywhere
reporting the discrepancy, and the operator holding a name that said 32. Reproduce
it exactly - write a 33-finding file under a -32 name - and require the check to
fail before writing the fix. Note what assertion 2 does NOT do: it cannot see the
copy that is gone. Nothing can. A check on names catches a false name; only the
writer owning the destination catches a clobber, and no check over a directory can
distinguish a file that was never made from one that was overwritten.

THE INSTRUCTION WAS CORRECT AND WAS FOLLOWED, WHICH IS THE PART THAT MATTERS. The
operator asked for a rename to a count-carrying name and then an --apply, in that
order, for exactly the right reason. The step that lost the artifact was the
mechanical one underneath: mv with no look at the target. This finding's subject is
that durable copies are protected by procedure rather than by mechanism; the fifth
instance narrows it to a sharper claim. The procedure held at every level where a
person was thinking about it and failed at the level where nobody was, which is
where procedures always fail and is why the count belongs in the writer.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 30 - The active gh account is one global per-machine setting governing fourteen repositories under eight owners, and doctor's account check is parameterised for the project's own origin but only ever asked about the system repo

Filed: 2026-09-06T14:25:42Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/doctor.mjs - checkGhAccount() and the unused owner parameter of ghAccountFinding()`

ONE GLOBAL SETTING SELECTS THE IDENTITY FOR EVERY REPOSITORY ON THE MACHINE, AND
THE CHECK THAT WOULD CATCH A MISMATCH IS ALREADY PARAMETERISED FOR IT AND IS ONLY
EVER ASKED ABOUT ONE REPOSITORY.

Filed after ten push failures in a week on the carry step of finding 29, with no
established cause. The cause is now established, and it is not carelessness.

THE MECHANISM, CONFIRMED ON THIS MACHINE. The active GitHub account is stored once
per HOST in a single file - one `user:` key under `github.com:`. There is no
per-directory and no per-repository binding; nothing in a project directory
carries an account, and the only override is an environment variable set per
invocation. So `gh auth switch` is a MACHINE MODE, and it persists across
projects, across sessions, and across reboots until it is changed again.

THE SCALE, WHICH IS WHY THIS IS NOT AN OPERATOR ERROR. Counted on this machine:

  14 local repositories with an origin, under 8 DISTINCT OWNERS
     mavcimavci1983-create  5     mavcuusa-png        2   (not authenticated)
     mavci-ai-devsystem     2     xoxonew-sys         1   (not authenticated)
     tarihsahnesimilat-gif  1     mavciaibusiness-oss 1   (not authenticated)
     globalmvpllc-oss       1     avcticaret-ai       1   (not authenticated)
  4 accounts authenticated, covering 9 of those 14 repositories.
  1 global key selecting which of the 4 is active.

A one-of-N global mode selector over an N-owner workspace is wrong most of the
time BY CONSTRUCTION. And the drift has a direction: the account owning the most
repositories (mavcimavci1983-create, 5) is the one most often left active, and the
system repository's owner (mavci-ai-devsystem, 2) is not it. The most-recently-used
account is systematically the wrong one for the repository that matters most,
because that repository is touched least.

FIVE OF THE FOURTEEN CANNOT BE PUSHED FROM ANY AUTHENTICATED ACCOUNT AT ALL -
their owners have no token on this machine. For those the remedy is not "switch",
it is "log in", and nothing distinguishes the two situations until a push fails.

WHAT THE TOOLING ALREADY DOES, AND IT IS ALMOST THIS. doctor.mjs has the check.
`readGhAccounts()` reads the active login and the full list. `ghAccountFinding()`
compares them and renders a FAIL naming the exact remedy, and it already
distinguishes the two cases - `gh auth switch --user X` when that owner is
authenticated, `gh auth login` when it is not. Its own text already explains that
the resulting error is "a permission error worded as absence".

AND ITS SIGNATURE ALREADY TAKES THE QUESTION THIS FINDING IS ABOUT:

    export function ghAccountFinding(accounts, owner = SYSTEM_REPO.split('/')[0])

The `owner` parameter exists. There is exactly one caller in the installed tree:

    function checkGhAccount(out, { network = true } = {}) {
      if (!network) return;
      out.push(ghAccountFinding(readGhAccounts()));
    }

It passes no owner, so the parameter is dead except for its default, and the
question asked is permanently "is the active account the SYSTEM repository's
owner?" It is never "is the active account the owner of the origin of the project
you are standing in?" - although doctor runs inside a project, the project has an
origin, and the comparison is a string equality the function already performs.

SO THE GAP IS NARROW AND EXACT: a per-machine global setting governs a
per-repository operation, and the one tool positioned to notice checks it against
a constant instead of against the repository at hand. The capability is built. It
is aimed at one repository out of fourteen.

WHY IT SURFACES AS SOMETHING ELSE ENTIRELY. A push or API call against a private
repository from the wrong account returns "Repository not found". Nothing in that
string mentions accounts or permissions; it reads as the repository having been
deleted or renamed. doctor.mjs states this in terms for the system repository. The
same wording is what the operator meets for a project repository, with no check
anywhere having warned them and no line in the output connecting it to identity.
Ten occurrences in a week produced no diagnosis, which is the expected result when
the error names the wrong thing and the one check that knows better is looking
elsewhere.

WHAT IS NOT ESTABLISHED, AND MUST NOT BE READ AS ESTABLISHED.
  - The ten failures were not individually diagnosed. What is established is the
    mechanism, the scale and the missing check; that this mechanism caused all ten
    is inference, not observation. Any one of them could have been something else.
  - LOGIN EQUALITY IS NOT ACCESS. ghAccountFinding says so itself: "Only logins
    were compared. If the active account is a collaborator with access to the
    repository, this line is wrong." A mismatch is a warning that identity is
    probably wrong, never proof a push would fail. The fix must keep that
    hedge - it is what makes the check honest on a machine with collaborators.
  - `gh` is not this system's to change. The global-per-host storage is gh's
    design and the fix is emphatically NOT to work around it, shell out a switch,
    or write to that file. The fix is to READ the project's origin owner and
    COMPARE, which is a report, not an intervention.
  - This project has no origin at all, so the check proposed here would not have
    fired here. cartoonify's carry is a hand copy into a different repository.
    The finding is about every governed project that does have one.

FIX, and it is small because the parts exist.
  1. Pass the project's origin owner to `ghAccountFinding`. Derive it from
     `git remote get-url origin`; the function already renders the finding, picks
     the right remedy, and carries the collaborator hedge.
  2. Report BOTH when they differ - the project's origin owner and the system
     repository's owner are different questions and both matter, one for the work
     and one for the carry. Today only the second is asked.
  3. Say it at session start, not at push time. The existing preflight already
     runs; a mismatch is knowable before any work is done, and the whole cost of
     this defect is that it is discovered at the moment of pushing, which is the
     end of the work rather than the beginning.

SCOPE NOTE ON WHY THIS IS FILED HERE. It reached this queue through finding 29's
third hop - a record that survives the project and survives propagation and then
does not reach a remote. That framing still holds and this is its cause, but the
defect is not specific to the lessons queue: it applies to every push from every
governed project on a machine with more than one owner, which is this one.

### The assertion, and the broken build it must catch

FOUR ASSERTIONS. The first is the defect; two guard the obvious wrong fixes; the
last is the green direction, and this machine can exercise both of its branches.

FIRST, AND RED TODAY: doctor, run inside a governed project whose origin owner is
NOT the active gh account, must report that mismatch. Construct it exactly -
active account A, project whose origin is owned by B - and require the current
tree to report NOTHING about the project's own origin. It will report only about
mavci-ai-devsystem/mavci-ai-devsystem, and it will report OK whenever the active
account happens to be that owner, which is precisely when a push to a project
owned by someone else is about to fail. Confirm that FIRST.

SECOND, SO IT DOES NOT BECOME AN ASSERTION OF ACCESS: the report must state that
only logins were compared and that a collaborator with access makes the line
wrong. ghAccountFinding already carries that sentence; assert it survives into the
project-origin path. A build that drops the hedge turns a useful warning into a
false claim about permissions, and on a machine with collaborators it would be
wrong routinely.

THIRD, SO IT DOES NOT FIRE WHERE THERE IS NOTHING TO COMPARE: a project with no
origin must produce the existing "no git remote" warning and NOT a spurious
account mismatch. cartoonify is that case and is the fixture. A build that treats
a missing origin as a mismatch passes assertion one and must fail this.

FOURTH, GREEN DIRECTION, BOTH BRANCHES, so this is proven both ways rather than
merely shown capable of failing. The remedy differs by whether the required owner
is authenticated at all, and both cases exist on this machine:
  - a project owned by an AUTHENTICATED account that is not active must yield
    `gh auth switch --user <owner>`;
  - a project owned by an owner with NO token here - mavcuusa-png, xoxonew-sys,
    mavciaibusiness-oss or avcticaret-ai - must yield `gh auth login`, because
    switching to an account that does not exist locally is not a remedy.
  And a project whose origin owner IS the active account must report OK, so the
  check is shown to discriminate rather than merely to fire.

NOT ASSERTED, DELIBERATELY: that a mismatch predicts a failed push, and that the
ten observed failures had this cause. The check answers "is the active identity
the one this repository expects", which is the narrow question that was going
unasked. Whether the push then succeeds is not its claim.

### Addendum to finding 30 - Confirmed live on the cartoonify push, and the error's diagnosability is a property of the repository, not of the mistake

Amended 2026-09-06T17:59:41Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

CONFIRMED LIVE, ON A REAL PUSH, AND ONE HALF OF THE MECHANISM TURNS OUT NOT TO BE
A PROPERTY OF THE MISTAKE AT ALL.

cartoonify was pushed to github.com/mavciaibusiness-oss/cartoonify. At the moment
of the push the active account was mavcimavci1983-create and the origin owner,
mavciaibusiness-oss, had NO token on this machine. That is the branch the body
predicted but had not seen: five of the fourteen where the remedy is `gh auth
login` and not `gh auth switch`. It is now observed rather than counted. No
amount of switching between the accounts present would have reached that
repository.

THE SAME ACCOUNT ERROR PRODUCES TWO DIFFERENT MESSAGES, AND WHICH ONE YOU GET IS
DECIDED BY THE VISIBILITY OF THE REPOSITORY YOU ARE PUSHING TO.

  private:  "Repository not found"
  public:   "Permission to mavciaibusiness-oss/cartoonify.git denied to
             mavcimavci1983-create"

One error. One cause. The private wording names nothing - not the account, not
the permission, not even that permission is the subject; it reads as the
repository having been deleted, renamed, or never created. The public wording
names the operation, the repository, AND BOTH PRINCIPALS: the one required and
the one active. The second message contains the whole diagnosis. The first
contains no diagnosis at all.

THIS IS NOT A DEFECT AND NO FIX HERE CAN TOUCH IT. It is GitHub's wording, and
the reason for it is sound: a private repository must not confirm its own
existence to a principal without access, so "not found" is the only thing it is
allowed to say. Nothing in this system gets to change that, and nothing should
try.

WHAT IT CHANGES IS THE ARGUMENT FOR WHERE THE CHECK RUNS. Diagnosability is a
property of the repository being pushed to, not of the operator and not of the
mistake. And the worse message attaches to the more common case: the private
repositories are the ones under governance here, the system repository is
private, and it is the one that produced every confusing failure this week. The
better message arrived only because cartoonify happens to be public.

So fix step 3 - say it at session start, not at push time - is not a convenience
argument any more. An error that names its cause makes a pre-check OPTIONAL: the
operator loses the time between starting the push and reading the message, and
then knows. An error that reads as absence makes a pre-check NECESSARY: there is
nothing in the message to diagnose from, so without a check beforehand the cause
is not available at any price. The ten failures cost what they cost because the
private wording is the one the common case gets.

OBSERVED AGAIN WHILE WRITING THIS, ON THIS MACHINE, ONE MINUTE APART:
  `gh repo view mavci-ai-devsystem/mavci-ai-devsystem` from the active account
  returns "Could not resolve to a Repository with the name
  'mavci-ai-devsystem/mavci-ai-devsystem'."
  `gh repo view mavciaibusiness-oss/cartoonify` from the same active account
  returns the repository.
The second is public; the first, per the operator, is private and exists. From
this account those two facts are indistinguishable from "it was deleted" and
"the name is wrong", which is the complaint stated in one command.

NOT ESTABLISHED, AND UNCHANGED FROM THE BODY: that the ten failures each carried
this message, and that a mismatch predicts a failed push. What the push
establishes is narrower and enough - the login-not-switch branch is real, and
the message the private case produces has nothing in it to reason from.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

### Addendum to finding 30 - Every fixture in this finding named a machine state, and the push that confirmed it changed all of them

Amended 2026-09-06T17:59:45Z, plugin 0.1.34. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

EVERY FIXTURE IN THIS FINDING NAMED A MACHINE STATE, AND THE PUSH THAT CONFIRMED
THE FINDING CHANGED ALL OF THEM. The act of acting on this finding invalidated
its own test material - which is the general hazard, not an accident of this
push.

RE-MEASURED 2026-09-06, after the push, same scan scope as the body
(repositories with an origin directly under the projects root):

  15 repositories with an origin, under 8 owners
     mavcimavci1983-create  5     tarihsahnesimilat-gif  1
     mavciaibusiness-oss    2     globalmvpllc-oss       1
     mavci-ai-devsystem     2     xoxonew-sys            1  (no token here)
     mavcuusa-png           2  (no token here)
     avcticaret-ai          1  (no token here)
  5 accounts authenticated, covering 11 of those 15 repositories.
  1 global key selecting which of the 5 is active. Active: mavcimavci1983-create.
  4 repositories under 3 owners cannot be pushed from any authenticated account.

WHAT THIS DOES NOT WEAKEN: one global key still selects one identity for 15
repositories under 8 owners, and the drift still has the same direction - the
account owning the most repositories is the one left active, and the system
repository's owner is not it. The ratio moved from 4-of-14 to 5-of-15. The
argument is unchanged; only the numbers are.

SUPERSEDED, AND MACHINE-VERIFIED BY --was BELOW: the claim that this project has
no origin. cartoonify's origin is
https://github.com/mavciaibusiness-oss/cartoonify.git. The check this finding
proposes WOULD fire here, and would have been RED here before the push: active
mavcimavci1983-create, origin owner mavciaibusiness-oss, no token for that owner
on this machine - the `gh auth login` branch. cartoonify has stopped being the
project the check does not apply to and become the project that demonstrates it.

THREE MORE PASSAGES ARE SUPERSEDED BY THE SAME PUSH. They are quoted verbatim
here and NOT machine-verified: `--amend --was` takes one quote, and one event
superseded four passages. A reader can resolve each by searching the body for
the quoted string; none of them is a line number, deliberately.

  1. Assertion three: "cartoonify is that case and is the fixture."
     RESTATED, naming no project: a project with no origin must produce the
     existing "no git remote" warning and NOT a spurious account mismatch. The
     assertion itself is untouched and still required - a build that treats a
     missing origin as a mismatch passes assertion one and must fail this one.
     Only the fixture is gone. Whoever builds it needs a different project with
     no origin, or a constructed one, and must derive it at test time rather
     than name it.

  2. Assertion four, the `gh auth login` branch: "a project owned by an owner
     with NO token here - mavcuusa-png, xoxonew-sys, mavciaibusiness-oss or
     avcticaret-ai - must yield `gh auth login`". mavciaibusiness-oss now HAS a
     token on this machine - it was logged in to complete the push that
     confirmed this finding. Using it as the login-branch fixture would now
     assert the wrong branch and pass for the wrong reason. Owners with no token
     here as of this amendment: mavcuusa-png, xoxonew-sys, avcticaret-ai. Both
     branches of assertion four still exist on this machine, so the assertion
     stands; its inventory does not.

  3. The scale block: "4 accounts authenticated, covering 9 of those 14
     repositories." and "FIVE OF THE FOURTEEN CANNOT BE PUSHED FROM ANY
     AUTHENTICATED ACCOUNT AT ALL". Superseded by the re-measurement above.

THE LESSON FOR WHOEVER APPLIES THIS, AND IT OUTLIVES THIS FINDING: a fixture that
names a repository or an account is a snapshot of the machine on the day it was
written, and for this finding in particular the remedy - logging in, switching -
is itself a machine change. Fixing what the finding is about breaks the fixture
that proves it. State fixtures as SHAPES ("a project with no origin", "an owner
with no token on this machine") and derive the instance at test time from `git
remote get-url origin` and `gh auth status`. Both are already read by the code
this finding is about.

**Superseded, quoted verbatim from the body above:** - This project has no origin at all, so the check proposed here would not have
    fired here. cartoonify's carry is a hand copy into a different repository.

---

### Addendum to finding 30 - The release path is guarded at the tag and unguarded at the branch push the tag gate itself requires first

Amended 2026-09-10T10:39:41Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

ELEVENTH INSTANCE, AND THE FIRST AGAINST THE SYSTEM REPOSITORY'S OWN RELEASE PATH
RATHER THAN A PROJECT. It caught a release, not a push from a governed project,
and that is what makes it worth an addendum rather than a tally mark: the release
path is guarded at its LAST step and unguarded at the step immediately before it.

WHO RAN THIS AND WHAT WAS OBSERVED BY WHOM. Filed from the main session in the
system repository at the operator's direction, on 2026-09-10, immediately after
pushing 0.1.35's commit. No `--agent` stamp is claimed: the risk guard's
provenance arm does not run for a main session (finding 24 in this queue), and a
stamp asserting enforcement that did not happen is worse than an unattributed
one. This paragraph is a claim in the body, visibly somebody's account, which is
what the tool's own refusal message advises.

  Reported by the operator, not observed here: a git or gh call against
  mavci-ai-devsystem/mavci-ai-devsystem from the wrong active account returned
  "Repository not found" roughly a minute before the push, which is the private
  wording the first addendum established has nothing in it to reason from.
  Observed here, after `gh auth switch`: active account mavci-ai-devsystem,
  `git ls-remote origin refs/heads/main` answered c88db8c, and
  `git push origin refs/heads/main:refs/heads/main` moved c88db8c..73671c3.

THE ASYMMETRY, AND IT IS STRUCTURAL RATHER THAN AN OMISSION.

  the TAG step      `check-pretag.mjs --cut` probes origin with `git ls-remote`
                    BEFORE the suite, refuses when it is silent and names which
                    of the two causes it is, pushes by explicit refspec INSIDE
                    the gate, and reads the tag back off origin. That arm is
                    `identityVerdict` at scripts/ci/check-pretag.mjs:339, and it
                    has exactly one definition and one call site, both in that
                    file.
  the BRANCH push   nothing. No probe, no comparison, no refusal, no read-back.
                    `git push origin main` consults nothing at all.

AND THE GUARDED GATE REQUIRES THE UNGUARDED STEP FIRST. scripts/ci/check-pretag.mjs:1777
refuses when HEAD is not origin/main, with the remedy "Push the commit BEFORE
tagging it." So the branch push is a PRECONDITION of entering the gate. The
ordering is not incidental: the unguarded step always runs first, it is the step
at which the wrong account is still possible, and the gate that would have caught
the wrong account is the one telling you to go and do it. That is adjacent to,
but not the same as, the pattern already on record in this system - a check that
detects a condition prescribing the tool that produced it. Here the gate
prescribes a step it does not guard.

WHY IT IS INVISIBLE, WHICH IS THE PART THAT GENERALISES. `--cut` is called "the
only door" in its own header and in the governing document, and that sentence is
true of TAGS and reads as true of RELEASING. A branch push is not thought of as a
release step at all, although nothing reaches any project without one: a project's
committed CI clones a tag, and a tag not on the mainline is refused by this same
gate. The guarded step is the one everybody thinks about, so the unguarded one is
not experienced as a gap - it is not experienced as a step.

WHAT THIS CORRECTS FOR A READER OF THE BODY, WITHOUT SUPERSEDING IT. The body says
there is "exactly one caller in the installed tree" and that the `owner` parameter
is "dead except for its default". That is true as written and correctly scoped -
scripts/ci/ is not the installed tree. A reader who takes it as "the parameter has
one caller" will be wrong, so the measurement is recorded here rather than left to
be rediscovered. Three callers across this repository:

  plugins/mavci-core/scripts/doctor.mjs:678   passes no owner
  scripts/ci/check-pretag.mjs:340             passes owner, defaulted to OWNER
  scripts/ci/check-doctor.mjs:552             a test, passes OWNER

ALL THREE RESOLVE TO THE SAME CONSTANT, `SYSTEM_REPO.split('/')[0]`. The parameter
is therefore not dead; it is exercised and never varied. Same consequence,
different defect, and it changes what fix 1 looks like at one of the sites: the
call to fix already passes an argument, so whoever goes looking for a missing one
will not find it.

AND THE GAP THIS INSTANCE ACTUALLY EXPOSES IS NOT PARAMETERISATION. For the system
repository, doctor's hardcoded owner is the RIGHT question - this session was
rooted in that repository, and `checkGhAccount` would have compared the correct
two names. It did not fire because nothing ran doctor. The probe that did happen
before the push happened because the governing document tells a reader to run one,
not because any check required it. That is check-pretag's own header argument one
layer out: a check nobody is required to run is the same failure one layer up. So
there are two gaps here, not one - the check asks the wrong question in a governed
project (the body), and nothing is required to ask it at all before a push (this
instance) - and fix 3, "say it at session start", is the one that answers both.

NOT RE-COUNTED, DELIBERATELY. The second addendum's lesson is that a fixture
naming a repository or an account is a snapshot, and that acting on this finding
changes the machine. The account inventory has moved again since that
re-measurement. It is not restated here: whoever builds the check derives it at
test time from `git remote get-url origin` and `gh auth status`, which is what
that addendum already requires.

NOT ESTABLISHED. That a mismatch predicts a failed push - unchanged, and still the
hedge that keeps the check honest. That the operator's "Repository not found"
today had this cause: that is their report, and what was observed here is only the
post-switch state, which is consistent with it and does not demonstrate it. And no
fix is designed here - this records that the asymmetry exists and where it is. In
particular it does NOT propose that a branch push acquire a gate shaped like
`--cut`. The negative control from 0.1.17 governs whatever is built: origin
answering must never be turned into a failure, because the release path is the
worst place in this system to refuse wrongly.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 31 - An amendment can correct a claim and cannot correct what advertises it: the title is written once, --was verifies one quote, and the queue's index is systematically its least-corrected surface

Filed: 2026-09-06T18:07:24Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/retro.mjs - amend() and its single --was, findingHeading() written once at --record, and the --list index that reads it`

AN AMENDMENT CAN CORRECT A CLAIM AND CANNOT CORRECT WHAT ADVERTISES IT.

Observed 2026-09-06 while filing two addenda on finding 30 of this queue -
"Confirmed live on the cartoonify push, and the error's diagnosability is a
property of the repository, not of the mistake" and "Every fixture in this
finding named a machine state, and the push that confirmed it changed all of
them". Cited by title and date rather than by line, per finding 24's second
addendum. Both limits below were hit in the act of using the tool correctly;
neither is a bug in what it does, and both are gaps in what it can express.

LIMIT ONE: ONE QUOTE PER AMENDMENT. `--was` takes a single string, checks it
against the finding's body, and refuses if it does not resolve. That check is the
best thing in the verb - it closes finding 17's shape, where a citation that does
not resolve is stored exactly like one that does. But one event superseded FOUR
passages of finding 30: the no-origin scope claim, assertion three's fixture,
assertion four's authenticated-owner list, and the scale counts. One of them got
the machine-verified citation. The other three are prose, in the same addendum,
in the same voice, in the same typeface.

So the record now holds one verified correction and three assertions of
correction, INDISTINGUISHABLE BY SHAPE. A reader cannot tell which the tool
checked. Finding 17's shape, one level over: there an unresolvable citation was
stored like a resolvable one; here a VERIFIED citation is stored like an
unverified one, and the verification silently stops applying after the first
quote with nothing marking the boundary.

The escape - file four amendments, one per quote - makes every citation resolve
and destroys the other fact: one event, four consequences, becomes four stamps,
four headings, four times in the index, with nothing saying they are the same
push. Neither shape can carry both truths.

LIMIT TWO: THE TITLE IS WRITTEN ONCE AND IS THE ONLY THING THE INDEX READS.
`--amend` appends inside a finding's block and never rewrites the body, which is
the reason the verb exists: a queue entry that reads as though it was filed at
the right width is worse than one that shows where it was wrong. But the heading
is part of the body it must not rewrite, and `--list` renders exactly the
heading. The title is therefore the one sentence in a finding that cannot be
corrected, and the one sentence every reader reads.

THE CORRECTION RATE AND THE VISIBILITY RATE RUN OPPOSITE. The more a finding is
amended, the further its title drifts from its content - and the title is what
anyone scanning the queue reads first, and what most readers read only. The
queue's INDEX is systematically its LEAST-CORRECTED SURFACE, which is the
opposite of what an index is for.

LIVE INSTANCE, IN THIS SAME QUEUE, SAME DAY. Finding 30's title says the active
gh account governs "fourteen repositories under eight owners". It is fifteen,
corrected in an addendum filed hours after the finding. `--list` prints the stale
count and prints "2 addendum(a), 0 unstamped" underneath it: the index KNOWS
corrections exist, reports how many, and still advertises the uncorrected
sentence without saying that any of them touched it.

And the title is not simply wrong. Its second half - that doctor's account check
is parameterised for the project's own origin and only ever asked about the
system repo - is exactly as true as the day it was filed. A partly-wrong title
with no way to mark which part is worse for a scanner than a wrong one: nothing
about it looks broken.

WHERE THIS SITS RELATIVE TO FINDING 24. Its second addendum, "Line numbers are
not identifiers in this file", established that citations by line went stale
within hours and that title-plus-timestamp is the stable reference. This is that
problem one level out. THERE THE IDENTIFIER WAS UNSTABLE; HERE THE IDENTIFIER IS
STABLE AND WRONG. Both make a reference unreliable, and the second is harder to
catch, because a stable reference that resolves cleanly to a stale sentence
gives a reader no signal at all.

THE OBVIOUS FIX IS NOT FREE, AND MUST NOT BE PROPOSED WITHOUT ITS COST. Making
titles amendable in place is the first thing anyone will reach for. A TITLE IS
HOW THIS QUEUE IS REFERENCED ACROSS DOCUMENTS - finding 24's addendum settled
title-plus-timestamp as the stable reference precisely because line numbers were
not, and the cartoonify carry names findings by number AND title. Rewriting a
heading breaks every external reference the same way mutable line numbers did,
and worse in one respect: a citation to a rewritten title still LOOKS like a
citation, and resolves to nothing or to a different sentence. Any fix here must
leave the title as filed resolvable.

DIRECTIONS THAT DO NOT PAY THAT COST. Not a decision - the applier's - and none
of them requires rewriting a byte of a filed body:
  - The number and the filed title stay the identifier, and `--list` renders a
    SUPERSEDED-BY line beneath any amended finding, from a short phrase supplied
    at amend time. The filed title still resolves; the index stops presenting it
    alone.
  - `--was` accepts repetition, each quote verified independently and each
    rendered as its own "Superseded" line. Unverified prose corrections stay
    possible and become visibly a different kind of statement.
  - The amendment stamp counts them. "4 superseded quotes, all verified" and
    "1 verified, 3 in prose" are facts `--list` can carry today, and they need no
    change to the body format at all.

WHAT IS NOT ESTABLISHED. That anyone has yet acted on a stale title or been
misled by an unverified prose correction. What is established is structural - the
index reads a field that cannot be corrected, and the verification stops after
the first quote - plus one live instance where a title's count is wrong while its
finding carries two addenda. The cost of this defect is unmeasured, and this
finding does not claim otherwise.

SCOPE. It applies to every finding in every queue, not to finding 30, and it gets
worse the better the queue is maintained: a finding nobody corrects has an
accurate title forever.

### The assertion, and the broken build it must catch

THREE ASSERTIONS. Two are the defect, one guards the fix that would trade this
problem for finding 24's.

FIRST, RED TODAY, THE INDEX HALF: file a finding, amend it with a correction that
supersedes a claim its title makes, then run `--list`. Require the index to show
that the title has been superseded. Today it prints the filed title verbatim and
an addendum COUNT, which says corrections exist and nothing about what they
touched. Confirm red against this queue as it stands: finding 30's title says
"fourteen repositories", its body has been corrected to fifteen, and `--list`
prints fourteen with "2 addendum(a), 0 unstamped" beneath it. That exact output
is the broken build.

SECOND, RED TODAY, THE CITATION HALF: file one amendment that supersedes two
passages. Require the record to distinguish a verified citation from an
unverified prose one. Today `--was` renders "Superseded, quoted verbatim from the
body above:" for the single quote it checked, and any further superseded passage
lives in the amendment text, rendered identically to every other sentence in it.
A build that merely ACCEPTS a second quote and renders it the same way asserts
nothing: the assertion is about the reader being able to tell them apart, not
about the flag being repeatable.

THIRD, THE COST GUARD - it must fail any fix that makes titles mutable in place.
Quote a finding's title in a document OUTSIDE the queue, which the cartoonify
carry does today, then amend that finding, then search the queue for the quoted
title. It must still be found. A build that rewrites the heading to fix
assertion one passes assertion one and MUST fail this. This is the assertion that
keeps the fix from being the thing finding 24's addendum ruled out.

GREEN DIRECTION, so this discriminates rather than merely fires: an UNAMENDED
finding must show no superseded-by line and no verification tally - a decoration
printed under every entry proves nothing. And an amendment carrying exactly one
`--was` and no other superseded passage must read exactly as it reads today, so
the common case is unchanged by the fix.

NOT ASSERTED, DELIBERATELY: that a stale title has misled anyone, and that an
unverified prose correction has ever been wrong. The check answers "does the
surface a reader meets first say that what it advertises has been corrected",
which is the question nothing in the queue asks today.

---

# Finding 32 - ship interpolates the operator request into a shell command unquoted, so a request describing code truncates it - and it takes the skill's own preflight with it

Filed: 2026-09-09T17:19:29Z, plugin 0.1.34.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `skills/ship/SKILL.md and the route.mjs invocation it prints`

THE SHIP SKILL INTERPOLATES THE OPERATOR REQUEST INTO A SHELL COMMAND WITHOUT
ESCAPING IT, SO ANY REQUEST CONTAINING A BACKTICK OR A QUOTE TRUNCATES THE
COMMAND. Observed 2026-09-09, project cartoonify, plugin 0.1.34. Two failures in
one session, on the same path, from the same cause.

FAILURE 1 - the invocation. /mavci-core:ship was called with a request describing
a code change. The request named files and identifiers in backticks, the way
prose about code normally does. The skill places the request inside a
double-quoted shell argument:

    node ".../scripts/route.mjs" --request "<request text>"

and the shell died before the router ran:

    Shell command failed for pattern
    /usr/bin/bash: eval: line 2: unexpected EOF while looking for matching '"'

FAILURE 2 - the skill's own preflight. The same interpolation appears in the
status block the skill prints at the top. That block also failed, so the skill
loaded with its routing decision replaced by an error string. The chain's first
instruction is to obey that block; it was not there.

MECHANISM. The request is operator prose. A backtick opens command substitution
and a quote unbalances the argument. Both are ordinary in a sentence about code:
you write a filename in backticks, and an English possessive supplies an
apostrophe without anyone deciding to.

WHY THIS IS WORSE THAN THE DEADLOCK IT WAS FOUND ALONGSIDE. Finding 3 returns a
WRONG ANSWER, loudly and repeatedly - the router says the spec does not exist and
you can read that and disbelieve it. This one TRUNCATES. The command dies, and
what survives is an error string sitting where a routing decision should be.

The skill does anticipate its preflight being absent, and says to treat it as
absent rather than as a pass. But it attributes absence to three causes - a
disableSkillShellExecution policy, a Cowork session, a read-only skill load - and
none of them is the request text. So the documented diagnosis points AWAY from
the actual cause, and the reader is told to run the router manually with the same
request that just broke it.

CONSEQUENCE, STATED PLAINLY: A REQUEST DESCRIBING CODE CANNOT BE SHIPPED. That is
most requests this plugin exists to serve.

THE LESSON IS ALREADY LEARNED ELSEWHERE IN THE SAME PLUGIN, WHICH IS WHY THIS IS
A DEFECT RATHER THAN A GAP. retro.mjs --amend documents its own interface as:

    --text and --was take a PATH or -, never prose - an argument goes through
    the shell

That is this exact hazard, named, in a sibling script, with the remedy applied.
The filing tool takes a path because prose through a shell is unsafe; the
orchestration entry point takes prose through a shell.

WORKAROUND USED TO GET PAST IT, so the next person is not stuck: the request was
rewritten to remove every backtick and apostrophe, and the router was then run by
hand. The chain proceeded. Rewriting the request to suit the shell is not a fix -
it silently narrows what an operator is allowed to ask for, and nothing tells
them that is happening.

FIX DIRECTIONS, in the order the plugin itself already prefers them: pass the
request on stdin, or write it to a file and pass the path (the retro.mjs remedy),
or single-quote with embedded-quote escaping. Any of the three removes the class.
A fix that escapes only backticks leaves the quote half of the bug.

### The assertion, and the broken build it must catch

A request containing a backtick, an apostrophe and a double quote reaches route.mjs byte-intact: the preflight block prints a routing decision rather than an error string, and the same request run through the documented manual fallback returns the same decision.

### Addendum to finding 32 - Fixed in 0.1.35 - and this finding's own diagnosis is one layer off: the block is cut before the shell sees it

Amended 2026-09-09T18:36:14Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

FIXED IN 0.1.35, AND THE DIAGNOSIS IN THE BODY ABOVE IS ONE LAYER OFF. The body
reads this as shell quoting - "a backtick opens command substitution and a quote
unbalances the argument" - and names three fix directions: stdin via a heredoc, a
path passed as an argument, single-quoting with embedded-quote escaping. ALL
THREE WOULD HAVE FAILED, and it is worth knowing why before anyone builds one of
them for the next skill.

NATIVE-CAPABILITIES 2.10 records the loader's assembly order, read out of the
binary: $ARGUMENTS is substituted FIRST, and Y4 - the inline shell executor -
extracts the blocks LAST. So the operator's text is already sitting in the
document when the block boundaries are found, and a backtick in it ENDS THE BLOCK
EARLY. What bash received was not a backtick; it was half a command with a
dangling double quote. That is why the error was "unexpected EOF while looking
for matching" rather than a command-substitution failure - and reading the exact
error is what separates the two, because a backtick reaching bash intact does
something else entirely.

Each of the three named fixes keeps the text INSIDE the block, and the block is
cut in half before any shell runs. The fix that works is the fourth thing: the
text leaves the block. route.mjs gained --request-file <path>; skills/ship/ writes
the request verbatim with the Write tool - not with echo or printf, which put it
back through a shell - and passes the path. That is this project's own
retro.mjs --amend rule, quoted in the body above, arrived at from the other side.

REPRODUCED AS A MECHANISM RATHER THAN ASSERTED AS A STYLE RULE.
check-skill-arguments.mjs PART 2 substitutes a hostile value the way k4 does,
extracts afterwards, and prints the truncation next to the block it came from -
--request "fix - which is the observed failure, from the source, with no shell
involved. Its third control passes a backtick-free request through the same block
and requires it to survive, so the check is reporting the loader and not merely
the presence of a placeholder.

THE PART THAT DID NOT GET FIXED, because it cannot be. The substitution reaches
the whole document, not only the blocks, so a request that literally contains an
inline-block opener creates one. No skill can prevent that. Removing $ARGUMENTS
from the plugin's own blocks removes the failure that HAPPENS - an ordinary
sentence about code - and not the one that would have to be typed on purpose. It
is recorded unasserted in 2.10 and in the check's header, because there is nothing
to assert against.

AND IT WAS NOT HYPOTHETICAL FOR THE LENGTH OF ONE EDIT. The paragraph written into
skills/ship/SKILL.md to explain this defect contained the words "the inline !
block" with the exclamation mark against a code span, and the check reported ship
as carrying a second inline block whose text was the middle of that sentence. The
prose describing the hazard had created one, in the file the hazard is about.

THE ASSERTION FINDING 32 ASKED FOR, and where it lives: check-ship-contract.mjs
C10, C11 and C12. C11 is the direct one - no inline block of ship interpolates
$ARGUMENTS. C10 and C12 are what stop the fix from re-opening 0.1.24: the request
must still reach the router by a named shell-free route, and ship's idle row must
send the orchestrator back with it rather than stopping, because the preflight now
routes on the control plane alone and idle is not an answer about a request nobody
passed.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

# Finding 33 - The one rule whose job is to establish that enforcement is on verifies only its own row: nothing enumerates the other plugins or marketplaces, and the user-scope registration that supplies every project on the machine is read for a single boolean

Filed: 2026-09-10T11:54:58Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/rules/index.mjs settings.marketplace_form, and doctor.mjs's user-scope settings read`

Check: `settings.marketplace_form`

Observed 2026-09-10, plugin 0.1.35, project cartoonify, main session, while propagating 0.1.35.

WHAT WAS FOUND ON THE MACHINE, AND IT IS NOT THE FINDING. A plugin the operator did not install was registered: notfair@nowork-studio, recorded 2026-09-07, with a user-scope marketplace entry pointing at nowork-studio/notfair-plugin and an MCP server at notfair.co. Its skills were loaded into this session's skill list. The operator has removed the plugin, the marketplace entry and both directories, and that removal is verified here: absent from the install database, from enabledPlugins, from extraKnownMarketplaces, and from both the marketplace and cache directories. HOW IT ARRIVED IS NOT KNOWN AND THIS FINDING DOES NOT GUESS.

WHAT IS FOR THIS QUEUE IS THAT MAVCI COULD NOT HAVE TOLD ANYONE. The registration surface is a file the operator owns, and the checking Mavci does over it is keyed to Mavci's own name.

THE CHECK'S SCOPE IS ITS OWN ROW. settings.marketplace_form opens the PROJECT's settings file and asks two questions: does extraKnownMarketplaces.mavci carry the git source form, and is enabledPlugins mavci-core@mavci true. Both are keyed to one marketplace name and one plugin id. The rule never enumerates the other entries in the same object. A second marketplace, or a second enabled plugin, sitting in the very file it has already parsed, is not read.

AND THE SEVERITY MAKES THIS SHARPER RATHER THAN SOFTER. The rule is critical and always:true, and its own comment says why - the other twelve ask whether a standard is met, this one asks whether checking happens at all, and suppressing it "is not a debt - it is the end of the system". So the single rule whose stated job is to establish that enforcement is on verifies that its own row is well-formed and is blind to every other row beside it.

THE USER SCOPE IS READ FOR ONE BOOLEAN. doctor does open the user-scope settings file, and takes exactly one value out of it: whether Mavci itself is enabled. It never looks at extraKnownMarketplaces there at all. That is the scope that matters most. A user-scope marketplace supplies plugins to EVERY project on this machine, including projects that carry no Mavci, no committed settings file and no gate.

SO THE COVERAGE IS THE WRONG WAY ROUND. The scope with the smallest blast radius - one project, one committed file - is checked by a critical rule that can be neither baselined nor waived. The scope with the largest blast radius is not enumerated at any severity.

WHAT IT WOULD HAVE COST TO CATCH THIS IS ONE ENUMERATION. doctor already opens both files and already holds the names it expects. Reporting the marketplaces and enabled plugins it did NOT expect, at both scopes, is a WARN with a list. No new mechanism, no new file, no new permission.

THE CROSS-REFERENCE, CHECKED RATHER THAN ASSERTED. This was put to me as finding 23's shape, the propagation procedure touching a file the check reads. Finding 23 is not that: it is the operator-override path closing a task without dispatching the scribe. The propagation-shaped one is FINDING 18 - the fetch fails, the checkout reports up to date, and the check that would have caught it lives in a tool nobody is required to run. This finding is a third shape and worth naming as its own: not a check in the wrong tool and not a step that skips a record, but a check whose QUESTION is narrower than its name. It asks "is my row correct", is titled and severity-rated as though it asked "is checking happening", and the gap between those two is where an unrecognised plugin sits unreported. Finding 23's closing observation still applies word for word: nothing notices.

RESIDUE FOUND WHILE CHECKING, RECORDED BECAUSE IT IS THE SAME BLIND SPOT AND NOT THE SAME EVENT. The plugin cache also holds probemkt/probeplug/0.0.1, described in its own manifest as an "inert probe plugin", dated 2026-09-02 and carrying an .orphaned_at marker. It is NOT in the install database, NOT in either settings file, and NOT in the marketplace directory - dead cache residue rather than a live registration, and on the evidence it belongs to the operator's own probing of plugin internals that day rather than to the 09-07 event. It is named here so the next reader does not have to re-derive that. Mavci reports it no more than it reported the other.

WHAT THIS FINDING DOES NOT CLAIM. It does not claim the plugin was hostile. It does not claim Mavci was the vector. It does not claim any check here would have PREVENTED an installation - the install path is Claude Code's, not this plugin's. It claims only that a registration which supplies code to every project on the machine was invisible to the health check that runs on every one of them, and that making it visible is a list doctor is already holding the inputs for.

### The assertion, and the broken build it must catch

doctor must enumerate, at BOTH the user scope and the project scope, the marketplaces and enabled plugins that Mavci did not put there, and NAME them. Not judge them - name them.

BROKEN BUILD, AND IT WAS THIS MACHINE FROM 2026-09-07 TO 2026-09-10: a user-scope marketplace entry and an enabled plugin, neither installed nor recognised by this system, with doctor reporting 17 ok, 6 warnings and 3 failures and not one line about either. Reproduce it exactly - add an unrelated marketplace and an unrelated enabled plugin to the user-scope settings file - and require doctor to stay SILENT about them. Confirm that FIRST, before writing the fix.

GREEN DIRECTION, so this is proven both ways rather than merely shown capable of failing: on a corrected build the same tree must NAME the unexpected entry, and a tree carrying only Mavci's own entries must say nothing at all. The second half is the one most likely to be got wrong, and it decides whether the fix survives contact: a check that lists Mavci's own marketplace among the unexpected is noise on every run, gets silenced inside a week, and is then silent on the case it was written for. That is the adjacent-assertion failure this queue has now recorded at six scales.

AND IT MUST NOT BE KEYED TO KNOWN-BAD NAMES. The question is "what is registered here that this system did not expect", never "is this particular plugin present". A deny-list answers a question nobody can ask in advance and would have been empty on 2026-09-07.

---

# Finding 34 - doctor fails every project for missing corpus evidence about an agent the manifest need not enable and the tenancy model may make unrunnable, so the FAIL is structurally unclearable where it fires

Filed: 2026-09-10T15:20:38Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/doctor.mjs`

Observed 2026-09-10, plugin 0.1.35, project cartoonify, main session.

doctor's checkGuardianCorpus (doctor.mjs:189) emits FAIL whenever
.mavci/control/guardian-corpus.json is absent. It is gated on nothing: not on
the project's tenancy model, not on whether the project enables mavci-guardian,
not on whether guardian could ever run there.

Cartoonify's manifest declares tenancy.isolation "none", tenancy.model
"single-tenant", stack.db "none", stack.auth "none", and agents.enabled as
[mavci-architect, mavci-builder, mavci-verifier, mavci-scribe] - no
mavci-guardian.

worklist.mjs:75 refuses to emit a worklist unless tenancy.isolation ===
'application-filters'. That check runs BEFORE stageIsActive at line 81, so the
corpus staging path cannot reach it. Demonstrated in both directions today:
the same refusal, byte for byte, on the bare tree and with case q3v7k staged
into corpus-run/ (3 files). Staging changes nothing because the refusal is
upstream of scope entirely.

SO THE ONLY ARTEFACT THAT CLEARS THE FAIL CANNOT BE PRODUCED IN THIS PROJECT.
Not by any sequence of commands that does not falsify the manifest.
state.mjs --migrate-manifest is privileged precisely because tenancy.isolation
decides which tenant-isolation rules run at all; editing it so the corpus
becomes runnable would be manufacturing the premise, and a green corpus
obtained that way is evidence about nothing. The correct move today was to
leave the manifest alone and let the FAIL stand, which is what happened - and
that is the state this finding is about.

A PERMANENT FAIL IS WORSE THAN NO CHECK. doctor's report on this project now
carries one line that can never go green. The operator learns to read past it,
and the next line to be read past is one that matters. This system has already
refused to ship a check on exactly this reasoning: checkInstallScope explicitly
does NOT fail on the presence of an auto-recorded project pin, because "failing
on that would fail on every correctly bootstrapped machine, in every project,
immediately." The corpus check fails every correctly configured single-tenant
project, in the same way, for the same reason, and was not held to it.

AND THE SCOPE IS WRONG ONE LEVEL UP. The corpus is evidence about the PLUGIN's
guardian - the agent definition, the worklist, the rule that feeds it and the
prompt, all of which ship in the plugin and none of which belong to a project.
But recordCorpus writes to the project root's control plane and stamps
project_id, and doctor reads the local copy. So every project must independently
obtain evidence about a component no project owns, and a project that cannot
exercise that component at all is nonetheless required to produce it.

TWO WAYS OUT, AND THIS FINDING DOES NOT CHOOSE BETWEEN THEM.

  1. Gate checkGuardianCorpus on the same predicate worklist.mjs already uses -
     tenancy.isolation === 'application-filters' AND mavci-guardian present in
     agents.enabled - and report not_applicable, with the reason, rather than
     FAIL. One predicate, stated once, read by both.

  2. Make the corpus result machine-scoped rather than project-scoped, since it
     is evidence about a plugin version. Then one run on one suitable host
     answers for every project on the machine, and a project that cannot host it
     is not asked to.

They are not equivalent: (1) leaves single-tenant projects with no guardian
evidence and correctly says so; (2) gives them evidence obtained elsewhere. (2)
is the larger change and is the one that matches what the artefact actually is.

### The assertion, and the broken build it must catch

checkGuardianCorpus must not emit FAIL on a project whose manifest does not enable mavci-guardian, or whose tenancy.isolation is not 'application-filters'. It reports the check as not applicable and names which of the two conditions excused it. The predicate is the one worklist.mjs:75 already enforces, read from one place by both.

Broken build: It is this project today: cartoonify, tenancy.isolation 'none', agents.enabled without mavci-guardian, doctor reporting FAIL 'no guardian acceptance corpus result for plugin 0.1.35' with no command that can clear it short of falsifying the manifest. Reproduce exactly - a single-tenant manifest with guardian absent - and require the corpus FAIL to be ABSENT before writing the fix.

### Addendum to finding 34 - The machine-scoped remedy is the larger claim, and it cuts both ways: one run would vouch for a version on behalf of projects that never exercised it

Amended 2026-09-10T15:45:55Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

THE SECOND REMEDY IS THE LARGER CLAIM, NOT THE CHEAPER ONE, AND THE ORIGINAL
FILING UNDERSOLD IT BY LISTING IT SECOND.

Machine-scoping the corpus result says something the first remedy does not: that
the artefact was never about a project. If that is right, two consequences follow
and only one of them is comfortable.

THE COMFORTABLE ONE. Every project on this machine is failing for the same
absent file. Five .mavci projects are installed here; four of them - cartoonify,
gate4c, gate5, AI-Chatbot-Widget-SaaS - would each be told by doctor to produce
corpus evidence for plugin 0.1.35, and the artefact each is asked for is
identical in everything that decides its content: the same three fixtures, the
same three expectations, the same scorer, the same agent definition, the same
prompt, all shipped in the plugin and byte-identical across every project. Under
per-project scope, four operators run the same three cases against the same
library to obtain the same answer four times. Clearing it once would clear it
everywhere, and that is not a shortcut - it is the recognition that there was
only ever one question.

THE UNCOMFORTABLE ONE, AND IT IS THE REASON THIS ENTRY EXISTS. One project's
corpus run would then vouch for a plugin version on behalf of projects that never
exercised it. Cartoonify would carry a passing corpus obtained on gate6: against
gate6's manifest, gate6's isolation model, gate6's code, gate6's worklist. The
sentence "guardian 0.1.35 answers correctly" would be true of the run that
produced it and asserted of a project where guardian is not enabled and cannot be.
That is a transfer of evidence across a boundary, which is the move this system
refuses everywhere else it appears.

WHICH READING IS RIGHT DEPENDS ENTIRELY ON WHAT THE CORPUS GRADES, AND THAT HAS
NEVER BEEN STATED.

  If it grades THE PLUGIN'S GUARDIAN - the agent definition, the prompt, the rule
  that feeds it, the worklist shape, the scorer - then all of that ships in the
  plugin, none of it varies by project, and the machine scope is the honest one.
  Per-project scope is then theatre: N operators obtaining one fact N times.

  If it grades GUARDIAN AS DEPLOYED - against this manifest, this isolation
  model, this project's enabled agents and this project's code - then the result
  is not transferable, per-project scope is correct, and the consequence is that
  some projects can never obtain it. That consequence is the body of this
  finding, and it is a cost of the correct answer rather than evidence against it.

THE RECORD ALREADY CONTAINS BOTH ANSWERS AND RECONCILES NEITHER. recordCorpus
stamps `project_id` - a project-scoped label - and `library_fingerprint`, which is
a hash of the plugin's own case library and is a machine-scoped fact. It also
stamps `recorded_for: pluginVersion()`, which is machine-scoped too. So two of the
three identifying fields describe the plugin and one describes the project, and
nothing in the schema says which of them the result is evidence about. doctor then
reads it as project evidence because of where the file sits, not because of
anything the file says.

THE ASSERTION THIS ADDS, AND IT HOLDS UNDER EITHER REMEDY: the corpus artefact
must name what it is evidence about, and doctor must refuse to read a result whose
declared scope disagrees with the claim doctor makes from it. A machine-scoped
result read as a project verdict is the same defect as a project-scoped result
copied between projects, and neither is currently detectable.

This entry does not choose. It records that the choice exists, that it is not a
choice between a strict and a lenient option, and that only one of the two makes
the FAIL go away - which is the worst possible reason to prefer it.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

# Finding 35 - A spec's file table allocates paths to an agent whose write scope forbids them, and nothing compares the two: the criterion asserting the result names the one role barred from producing it

Filed: 2026-09-10T16:25:09Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/criteria.mjs`

Observed 2026-09-10, plugin 0.1.35, project cartoonify, task 0004 build attempt 1.

Task 0004's §7 file table allocates two files to the builder that
agents/agent-scopes.json forbids the builder to write:

  docs/adr/README.md        docs/** is not in mavci-builder's allow list
  scripts/check-styles.mjs  scripts/** is not in it either

mavci-builder's allow list is: app/**, src/**, lib/**, components/**,
supabase/**, public/**, tests/**, *.ts, *.tsx, *.json, *.md,
.mavci/tasks/**, .mavci/lessons/**. The *.md entry does not cross a path
separator, so no phrasing of a nested markdown write succeeds. The builder
attempted the docs/adr/README.md edit and the PreToolUse hook denied it before
any bytes changed, which is the guard working exactly as designed.

THE SPEC NAMED THE ROLE THAT CANNOT DO IT, IN THE CRITERION THAT ASSERTS THE
RESULT. Criterion 15 requires `| 0006 |` and `| 0007 |` rows in BOTH indexes and
its own §8 commentary explains why: "the architect may not write outside
.mavci/tasks/** and .mavci/decisions/**, so the second copy of the index is the
builder's to update, and finding 27's dual-index cost is paid visibly rather
than silently." The same sentence is in .mavci/decisions/README.md, in the file
the builder DID write. The reasoning about the architect's boundary is correct.
The conclusion drawn from it - that the builder therefore can - was never
checked against the builder's own scope, and is false.

So docs/adr/README.md is writable by NEITHER of the two agents in the workflow.
It was resolved by the main session making the edit on the operator's
instruction, deliberately rather than by widening docs/adr/** for the builder: a
permanent permission is the wrong price for a one-time edit, and the question
finding 27 raises is who OWNS that file, not who may write it once.

WHY THIS IS NOT JUST TASK 0004'S MISTAKE. Nothing connects the two documents.
The architect writes a §7 file table naming paths; agent-scopes.json declares
what each agent may write; and no check compares them. The architect cannot read
the scope file - it is in the plugin, not the project - and the operator
approving the spec is reading a file table, not an allow list. The mismatch is
therefore invisible until a builder attempt burns on it, and it is only luck
that this one escalated instead of failing: had the builder retried, the same
denial would have consumed all three attempts against a wall no attempt can move.

A SECOND INSTANCE IN THE SAME SPEC, WHICH IS WHY IT IS STRUCTURAL AND NOT A
TYPO. scripts/check-styles.mjs is also in §7 and also outside scope. It did not
block only because no criterion asserts the additions §7 asked for there, so the
builder correctly left the file alone rather than forcing a denied write. One
spec, two paths, one cause.

### The assertion, and the broken build it must catch

A spec's §7 file table must be checkable against agents/agent-scopes.json before approval seals it. Every path the table assigns to a role is matched against that role's allow and deny lists, and a path no workflow agent may write is reported at the plan gate - named, with the role and the list that excludes it - rather than discovered by a builder attempt. The check is a glob match over two lists that already exist.

Broken build: It is task 0004 today: §7 assigns docs/adr/README.md and scripts/check-styles.mjs to the builder, mavci-builder's allow list contains neither docs/** nor scripts/**, the spec was approved, and the builder's Edit on docs/adr/README.md was denied by the PreToolUse hook on attempt 1. Reproduce exactly - a spec table naming a path outside the assigned role's scope - and require the plan gate to refuse or flag it BEFORE approval.

---

### Addendum to finding 35 - Recurred in task 0010: a resize script allocated to the builder, refused by its scope

Amended 2026-09-29T18:18:35Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Recurred 2026-09-29, plugin 0.1.35, project cartoonify, task 0010 build attempt 1 - the same shape as task 0004's scripts/check-styles.mjs, under the same scope file.

Task 0010's spec §8 allocated `scripts/resize-style-previews.mjs` to the build, and its criterion 10 asserts the file exists (`Error: scripts/resize-style-previews.mjs does not exist` when it does not). The builder's write was refused by the PreToolUse hook: its hand-back says "`.mjs` and `scripts/` are outside the builder's edit scope". The builder did not route around the guard. It produced the 31 outputs with an inline `node -e` run instead, and returned status blocked with `blocked_by: "scope_conflict: spec §8 requires scripts/resize-style-previews.mjs, builder deny-by-default scope excludes scripts/*.mjs"`, escalate true. The build passed 22 of 23 criteria, and criterion 10 was the only red.

The operator then explicitly authorised the main session to write the script. Run from the main session, it reproduced the builder's outputs exactly: `wrote 31 files, 1204102 bytes total`, the 31 file sha256s identical, and `lib/style-web-manifest.json` byte-identical.

Two observations this instance adds:

1. The spec was written by the main session acting as architect. It gave the file table no owner column, and nothing compared the table against agents/agent-scopes.json before the operator sealed it. The spec-writer did not check it, and the approval step did not either. The collision surfaced only after the builder had spent an attempt.

2. The instance before this one, task 0009's scripts/render-gallery.mjs, did NOT collide, only because that build ran in the main session rather than through mavci-builder. So whether a spec's scripts/ allocation works depends on who happens to execute the build, not on anything the spec states. The same approved spec is buildable or not depending on the path taken to build it.

The assertion this finding already asks for would have caught 0010 at approval: for each path in a spec's file table, the role the spec assigns it to must have it in its allow list in agents/agent-scopes.json. The broken build is 0.1.35, where a spec allocating scripts/*.mjs to the build is sealed and dispatched to mavci-builder.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 36 - The approval gate reads what a spec asserts and cannot read what it admits: a criterion whose own proof table concedes its passing direction was never demonstrated is sealed unremarked, and the verdict has no field to record it as a known red

Filed: 2026-09-10T16:26:10Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/criteria.mjs`

Check: `next.criteria_proof_status`

Observed 2026-09-10, plugin 0.1.35, project cartoonify, task 0004.

THE APPROVAL GATE READS WHAT A SPEC ASSERTS AND CANNOT READ WHAT IT ADMITS.

Task 0004 carried eighteen acceptance criteria and a §9.1 table stating, per
criterion, whether it had been proven in both directions or only one. Criterion
18 was labelled "red only", and the spec said this about it in plain words:

  "THE GREEN DIRECTION WAS NOT PROVEN. The corrected copy is not a git checkout,
   so the criterion cannot run there, and proving it would have meant committing
   stub application code into this repository. It is the one criterion in this
   spec whose passing direction rests on reading rather than on execution."

Criterion 18 is now proven unsatisfiable. Its script runs
`git status --porcelain --untracked-files=all`, which EXPANDS untracked
directories, while its allow list contains the collapsed string 'public/' and
its required list demands that same string. Under -uall the string 'public/'
never appears. Demonstrated in a throwaway repository, all three arrangements:

  public/styles/ empty          -> 0 lines            -> fails `required`
  public/styles/.gitkeep        -> ?? public/styles/.gitkeep -> fails `allowed`
  public/styles/classic.webp    -> ?? public/styles/classic.webp -> fails `allowed`

and criterion 10 in the same spec explicitly tolerates .gitkeep
(`if (e === '.gitkeep') continue`), so criteria 10 and 18 contradict each other
inside one approved document. No tree satisfies both. The spec's own §8
commentary asserts the opposite of the observed behaviour - "git collapses
untracked directories, so public/ appears as one line" - which is true of the
DEFAULT flag and false of the flag the criterion uses. The allow list mixes both
mental models in one array: 'public/' collapsed, 'scripts/check-styles.mjs'
expanded. That mixture is why scripts/ does not also fail.

THE SPEC IDENTIFIED THE EXACT CRITERION THAT WOULD FAIL, SAID SO PLAINLY, AND
THE APPROVAL PROCEEDED. The operator read that sentence before approving and has
said so. This finding is not about that reading. It is about the fact that
nothing else read it, and nothing could have.

THE STRUCTURAL CAUSE: THE REQUIREMENTS ARE MACHINE-READABLE AND THE CONCESSIONS
ARE PROSE. A spec's criteria live in a fenced ```mavci-criteria block that
parseCriteriaBlock reads as JSON. Each entry may carry id, needs, run,
expect_exit and timeout_ms. There is NO field in which a criterion can declare
that its passing direction has never been observed. §9.1's proof table - the
place where this spec was scrupulously honest - is markdown, adjacent to the
block and invisible to every reader but a person.

So approvalPreconditions(), which exists precisely to tell an operator what they
are authorising, reports this for task 0004:

  "18 criteria - 18 shell. All of them run as ordinary commands in this
   repository. Approving this authorises a program to EXECUTE those commands,
   so read them as a script."

Eighteen, all shell. Correct, and it is everything the machine can say. It cannot
say "three of these have never been observed passing" because no criterion can
declare it, and it cannot say "one of them contradicts another" because nothing
compares them. The gate reads the requirements and is structurally blind to the
admissions printed beside them.

A CRITERION THAT ANNOUNCES IT CANNOT PASS IS THE EASIEST POSSIBLE THING TO CATCH.
This is the part worth stating at full width. The general problem - deciding
whether an arbitrary set of shell predicates is jointly satisfiable - is
undecidable and nobody should attempt it. But that is not what was needed here.
What was needed was to read back a fact the author had already written down, in
the same document, one heading away. The spec did the hard part. The gate could
not receive it.

THIS IS FINDING 4 FROM THE OTHER SIDE. Finding 4 says an approval cannot see what
the criteria REQUIRE - which of them touch the network, spend money, write files.
This says it cannot see what they CONCEDE. The two are the same defect about the
same surface: an approval is a decision about a program, and the only channel
into that decision carries the program's declarations and none of its
self-assessment. Finding 4's fix - classify effects from the command strings -
and this one's fix - carry the proof status as data - are the same shape and
should land together, because both are answers to "what does the operator not
know at the moment they say yes".

AND THE CONCESSION IS UNRECORDABLE AFTERWARDS, WHICH CLOSES THE LOOP. Having
approved a criterion that cannot pass, the operator asked for the verdict to
record it as a KNOWN red, with §9.1's sentence beside it, so that 17/18 reads as
a documented state rather than as a defect. The verdict cannot carry that. A
criterion result is { id, status, mode, evidence }; status is the closed enum
pass | fail | not_run; and `evidence` is composed inside runCriteria from the
exit code and the command string. There is no operator field, no annotation, no
known_red. The only way to make criterion 18 record anything but `fail` is
expect_exit: 1 in the spec, which would record a false pass and requires editing
sealed bytes to do it.

So the same fact - "this criterion is red for a reason the spec predicted" - is
unreadable at the approval gate and unwritable in the verdict. It exists only in
prose in the spec and in this queue. A reader of the verdict six months from now
sees one failing criterion and no way to learn it was expected.

THE ASSERTIONS, AND THE BROKEN BUILD EACH MUST CATCH.

  1. A criterion entry may declare its proof status as data - proven: "both" |
     "green_only" | "red_only" - and approvalPreconditions() reports the counts
     in the approval prompt: "3 of 18 have never been observed passing; 1 has
     never been observed failing." No judgement, no satisfiability analysis:
     read back what the author already wrote.
  2. A criterion declared red_only must carry a stated reason, as data, for why
     the green direction was not demonstrated - the spec's §9.1 prose for
     criterion 18 is exactly the right content in exactly the wrong place.
  3. A verdict must be able to record a criterion as failing-and-expected, with
     the reason, WITHOUT recording it as passing. status stays `fail`; a
     separate field carries the operator's note and the spec's declaration. A
     system that cannot distinguish "red and known" from "red and surprising"
     teaches its operators to skim red.

BROKEN BUILD, AND IT IS TASK 0004 TODAY: eighteen criteria, one of them
unsatisfiable in principle, its §9.1 entry saying in plain English that its
passing direction was never demonstrated, approvalPreconditions() reporting
"18 criteria - 18 shell" and nothing else, and the resulting verdict able to say
only `fail`. Reproduce it exactly - a spec whose own proof table concedes an
unproven direction - and require the approval surface to SAY SO before the
approval is recorded. Confirm that first, before writing the fix.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

### Addendum to finding 36 - The assertion section reads NOT SUPPLIED and is wrong: the assertions are in the body, and the placeholder cannot be removed

Amended 2026-09-10T16:27:02Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

CORRECTION TO THIS ENTRY'S OWN STRUCTURE, NOT TO ITS CLAIM.

The "### The assertion, and the broken build it must catch" section of this
finding reads NOT SUPPLIED. That is false and it is a filing error: three
assertions and a named broken build are written in the body above, under the
heading "THE ASSERTIONS, AND THE BROKEN BUILD EACH MUST CATCH". They were
written as prose in --finding instead of being passed as --assertion and
--broken-build, so the structured field never received them and printed its
placeholder. --record offers no way to fill that field afterwards and --amend
appends rather than edits, so the stale placeholder stands above this note and
cannot be removed. Read the body, not the placeholder.

The three assertions, restated here so they sit under the right heading:

  1. A criterion entry may declare proof status as data - proven: "both" |
     "green_only" | "red_only" - and approvalPreconditions() reports the counts
     at the approval prompt.
  2. A criterion declared red_only must carry a stated reason, as data, for why
     the green direction was never demonstrated.
  3. A verdict must be able to record a criterion as failing-and-expected
     without recording it as passing: status stays `fail`, a separate field
     carries the note.

BROKEN BUILD: task 0004 as approved on 2026-09-10 - eighteen criteria, criterion
18 unsatisfiable in principle, §9.1 conceding in plain English that its passing
direction was never demonstrated, approvalPreconditions() reporting "18 criteria
- 18 shell" and nothing else, and the verdict able to say only `fail`.

AND NOTE WHAT JUST HAPPENED, BECAUSE IT IS THE SAME SHAPE ONE LEVEL DOWN. This
finding argues that a structured surface which cannot carry a fact forces that
fact into prose, where nothing reads it. Filing it produced exactly that: the
content went into prose, the structured field said NOT SUPPLIED, and an applier
trusting the field would conclude no assertion exists. The defect reproduced
itself inside the report about it, within one minute, by hand.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

# Finding 37 - probe-a-delete-me

Filed: 2026-09-18T09:22:40Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

names control/verdicts/x.json only

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

### Addendum to finding 37 - Not a finding - an accidental live probe, and what it established

Amended 2026-09-18T09:23:14Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

This finding is not a finding. It was filed by the main session on 2026-09-18 as a
live probe, to determine why `retro.mjs --record` had just been refused by the risk
guard, and it should have been run against a scratch project instead of this queue.

What it established, recorded here because the block cannot be deleted by an agent:
the risk guard refuses a `retro.mjs --record` call whose --finding prose contains the
literal string for the control-plane directory, and accepts the same call when the
prose names the same file without that prefix. The refusal text is:

  "the write target of this command could not be determined, and it names a path
  inside [the control-plane directory] ... Quoting a control-plane path inside a
  message or a string operand is fine and is not what this is about."

The last sentence describes the case that was in fact refused: --finding takes prose
as a command-line argument, never a path, so a finding about the control plane cannot
be filed in the words of the thing it is about.

Findings 39 onward in this file write control-plane paths relative to the .mavci
directory for this reason, not because the paths are uncertain.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

# Finding 38 - probe-b-delete-me

Filed: 2026-09-18T09:22:40Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

names no control plane path at all

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

### Addendum to finding 38 - Not a finding - an accidental live probe, and what it established

Amended 2026-09-18T09:23:15Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

This finding is not a finding. It was filed by the main session on 2026-09-18 as a
live probe, to determine why `retro.mjs --record` had just been refused by the risk
guard, and it should have been run against a scratch project instead of this queue.

What it established, recorded here because the block cannot be deleted by an agent:
the risk guard refuses a `retro.mjs --record` call whose --finding prose contains the
literal string for the control-plane directory, and accepts the same call when the
prose names the same file without that prefix. The refusal text is:

  "the write target of this command could not be determined, and it names a path
  inside [the control-plane directory] ... Quoting a control-plane path inside a
  message or a string operand is fine and is not what this is about."

The last sentence describes the case that was in fact refused: --finding takes prose
as a command-line argument, never a path, so a finding about the control plane cannot
be filed in the words of the thing it is about.

Findings 39 onward in this file write control-plane paths relative to the .mavci
directory for this reason, not because the paths are uncertain.

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

# Finding 39 - A verdict records no spec identity, so the verdict-to-spec link exists only through the task record

Filed: 2026-09-18T09:23:33Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs`

Paths below are written relative to the .mavci directory: the risk guard refuses a --record whose prose contains the full control-plane prefix. See the amendments on findings 37 and 38.

The recorded verdict control/verdicts/0004-attempt-02.json has these top-level keys, and only these: attempt, checks, criteria, plugin_version, project_id, run_at, schema_version, scope, summary, task_id, verdict. There is no spec_sha256 field and no spec_path field. Grepping that verdict for the approved spec hash 8b348449e8b1 returns 0 occurrences.

Two spec seals are present for task 0004: control/specs/0004-24cf669ad5e2.md and control/specs/0004-8b348449e8b1.md. Only the second matches spec_approved.spec_sha256 in control/tasks/0004.json.

The verdict carries no record of which of those two seals its 18 criteria were read from. The verdict-to-spec link exists only through control/tasks/0004.json spec_approved, one indirection away, in a file that is written after and independently of the verdict.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 40 - A criterion stored in a spec seal had its newline escapes collapsed to spaces, and executed anyway against the wrong delimiter

Filed: 2026-09-18T09:23:44Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs`

Criterion 18 of task 0004, as stored in the approved spec at 24cf669ad5e2, had its \n and \r collapsed to single spaces somewhere before it was sealed.

The damaged criterion still ran. It was recorded with mode: executed, not as an error and not as not_run. Having lost its delimiters, it split git status --porcelain output on spaces instead of on line endings, and reported fail. It never reached the comparison it exists to make, so scope containment was never tested, in either direction: the criterion could not have passed on a correct tree and could not have failed for the reason it names.

It was fixed at seal 8b348449e8b1 by building the delimiters with String.fromCharCode(10) and String.fromCharCode(13), which expresses them without a backslash anywhere in the criterion text.

The two facts that make this a system finding rather than a project one: a criterion damaged in transit is indistinguishable, in the recorded verdict, from one that ran as written; and the repair was to stop using the escape rather than to fix the transport.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 41 - A criterion whose guard clause only skips an assignment reports the exit code of the interpreter, not of the check

Filed: 2026-09-18T09:24:05Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs`

Criterion 14 of task 0004: when package-lock.json is dirty, the dirty state only causes the T assignment to be skipped. The criterion then exits with whatever code node returns, not with a code produced by the lock check itself.

The criterion is green today only because the lock file happens to be clean. A dirty lock file does not make it report fail; it makes it report the interpreter exit code, which on a run that does not otherwise throw is 0 - a pass produced by the check having been skipped rather than by the condition it asserts being true.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 42 - A parse-time death and a failed assertion are the same exit code, and nothing outside the run tells them apart

Filed: 2026-09-18T09:24:05Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs`

A criterion that dies at parse time and a criterion whose assertion legitimately failed produce the same exit code. Nothing recorded outside the run distinguishes the two.

Consequence for the record: a criterion that never executed a single statement is indistinguishable, in the verdict, from one that ran to completion and found the condition false. mode: executed does not separate them, because the process did start.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 43 - attempts and attempts_total diverge after --reset-attempts, and a ceiling read off the wrong field is off by one

Filed: 2026-09-18T09:24:49Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs`

Paths relative to the .mavci directory. In control/tasks/0004.json, after --reset-attempts, attempts reads 1 and attempts_total reads 2. The two fields diverge and both remain in the record.

A retry ceiling evaluated against attempts_total rather than attempts, or the reverse, is off by one. The file gives no indication which field the ceiling is meant to be read from, and max_attempts (3) sits beside both without naming its operand.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 44 - Finding 27 sharpened: the decisions directory is declared canonical, created once, and never read

Filed: 2026-09-18T09:24:49Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `.mavci/decisions`

Sharpening of finding 27 with what is now established.

The .mavci/decisions directory is declared canonical in the plugin configuration. It is referenced exactly once in the code, by an mkdir at connect time. Nothing reads it afterwards. No code path allocates a decision number.

So the directory is created, declared authoritative, and has no writer that can produce a correctly numbered entry and no reader that would notice if it were empty.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 45 - The two decision index README files diverge at line 28, and nothing explains which is current

Filed: 2026-09-18T09:24:58Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `.mavci/decisions`

There are two decision index README files. Their contents diverge at line 28.

The divergence is unexplained: nothing in either file, and nothing in the surrounding code, records which of the two is current, which is a copy, or when they parted.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 46 - No guardian acceptance corpus result exists for plugin 0.1.35

Filed: 2026-09-18T09:24:58Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Check: `guardian`

No guardian acceptance corpus result exists for plugin 0.1.35. Doctor reports this as a FAIL, not a warning.

The guardian judgement is the one component of the chain that no deterministic check verifies, so the acceptance corpus is the only evidence it works. With no recorded result for the version actually installed and pinned here (0.1.35 in installed_plugins.json, and ci_pinned_plugin_version 0.1.35), a passing guardian verdict on this project rests on nothing recorded.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 47 - baseline_debt 0 on a connected repo is reported identically whether the baseline is paid or absent

Filed: 2026-09-18T09:25:05Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/doctor.mjs`

state.mjs --show reports baseline_debt 0 and connected true for this project. Doctor, in the same session, reports "no baseline" and states that a greenfield project has an empty baseline while a connected repo should have one.

So the zero is most likely absence, not a debt that was paid down. The two surfaces disagree, and the numeric one - the one a caller is most likely to read programmatically - renders an absent baseline and a fully retired baseline as the same value, with nothing beside it to separate them.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 48 - The reporting channel for system findings cannot name control-plane paths in its own words

Filed: 2026-09-18T09:37:53Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/risk-guard.mjs`

Notation: control-plane paths are written here relative to the .mavci directory, and the full prefix is elided from the quoted refusal below, for the reason this finding records.

Mechanism. retro.mjs --record takes its finding text as a command-line argument: --finding has no path operand and no stdin form. (--amend --text differs: it takes a PATH or -, and refuses prose.) The risk guard, looking for the write target of the command, therefore scans the finding prose itself.

A quoted control-plane path in that prose leaves the target indeterminate and the command is refused, with:

  "the write target of this command could not be determined, and it names a path inside [control-plane dir] ... This is not a claim that it writes there - it is that the guard cannot tell, so it refuses rather than guess. Run it as a plain command whose target is visible (cat, jq, cp ... ), or use state.mjs if it really does need to write. Quoting a control-plane path inside a message or a string operand is fine and is not what this is about."

Dropping the .mavci prefix passes. The same --record naming control/verdicts/0004-attempt-02.json files normally.

Observed 2026-09-18, while attempting to file findings about verdict and seal contents during task 0004 verification. Findings 39, 43 and 44 write control-plane paths relative to .mavci for this reason, and say so in their first line.

The workaround appears in no usage text. The remedies the refusal names - cat, jq, cp, state.mjs - are not ways to file a finding.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 49 - mavci-scribe overstates its own output size in its hand-back, twice in a row and in the same direction

Filed: 2026-09-18T15:07:50Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `agents/mavci-scribe.md`

Two consecutive dispatches of mavci-scribe reported a line count for the task summary it had just written that was larger than the file on disk.

Task 0004: the hand-back stated 321 lines. `wc -l .mavci/tasks/0004.summary.md` reports 153.
Task 0005: the hand-back stated 503 lines. `wc -l .mavci/tasks/0005.summary.md` reports 111.

In both cases the file content verified against its named sources: the attempt history, the criteria counts, the verdict value and the timings all matched the recorded verdict. The defect is confined to the figure the agent reports about its own output.

Same direction both times, and by different factors, roughly 2.1x and 4.5x.

Nothing checks the figure. It appears only in the hand-back, which is model output; it is not written into the summary, not written into any control-plane record, and no check compares it to the file. An orchestrator that relayed the number without running wc would publish it unverified, and the second occurrence was caught only because the first had already been caught by hand.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 50 - The risk guard refuses a control-plane read once it is joined to the command that consumes the value, so a criterion cannot resolve the pinned plugin version

Filed: 2026-09-18T15:08:04Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/risk-guard.mjs`

Paths below are relative to the .mavci directory, for the reason finding 48 records.

Observed while writing task 0005 criterion 1, which needed the gate of the version recorded in control/state.json as ci_pinned_plugin_version.

The mechanism, in three measurements:

1. A bare read is allowed. `grep -o (the ci_pinned_plugin_version pattern) control/state.json` runs and returns "ci_pinned_plugin_version": "0.1.35".
2. The same read joined to its consumer is refused as one line. `P=$(grep ... control/state.json | cut -d(quote) -f4); G="$HOME/.claude/plugins/cache/mavci/mavci-core/$P/scripts/gate.mjs"; node "$G" --ci` is refused with: "the write target of this command could not be determined, and it names a path inside [control-plane dir]".
3. A node read of the same file is refused for the same reason, before it runs: `node -e "...readFileSync((control/state.json))..."` never executes.

So the value can be read, and cannot be used in the command that reads it. The guard scans the whole command line; a plain grep alone is visible enough to allow, and the same grep with a consumer attached is not.

Consequence recorded in that spec, section 8.1 item 5: criterion 1 carries 0.1.35 as a literal path with a guard clause, because the dynamic form cannot be written. A criterion that wants to run the version the control plane pins cannot ask the control plane which version that is.

Same family as finding 48: there the refused command was a finding about the control plane, here it is a command that reads one value out of it.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

---

# Finding 51 - Router sends a verify-phase task with zero attempts to the verifier, and verify.mjs refuses zero attempts: the named step can never succeed

Filed: 2026-09-29T16:13:49Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/route.mjs (verify branch, lines 794-800); scripts/verify.mjs:552`

Project cartoonify, task 0009, plugin 0.1.35, 2026-09-29. The task reached the verify phase with attempts 0 (see the next finding for how).

/mavci-core:verify 0009 printed the router block: "task 0009 is in the verify phase and no verdict names attempt 0. dispatch mavci-verifier - it runs verify.mjs --record --task 0009".

The verifier ran exactly that and verify.mjs refused: "--task 0009: attempts is 0, so no attempt has been made and there is nothing for a verdict to be about. Run `state.mjs --attempt 0009` before building." (scripts/verify.mjs:552-553).

Re-running route.mjs afterwards printed the same step with the same reason. The verifier cannot write the control plane, so it returned blocked; the loop was broken only by the operator running state.mjs --attempt by hand, which no router output had named.

Cause, read in scripts/lib/route.mjs: the build branch handles attempts === 0 (line 620: "is in the build phase with no attempt consumed" -> state.mjs --attempt), but the verify branch (lines 794-800) has no such arm and unconditionally returns "dispatch mavci-verifier" with attempt ${attempts} interpolated as 0.

### The assertion, and the broken build it must catch

Fixture: a task with phase "verify", attempts 0, attempts_total 0, a valid spec_approved and no verdicts. route() must NOT return "dispatch mavci-verifier" as a step; it must name state.mjs --attempt <id> (or refuse with that as the remedy).

Broken build it must catch: 0.1.35, which returns why "no verdict names attempt 0" with the single step dispatch mavci-verifier.

Stronger, general form: for every router state, executing the named step against the fixture must either change the state or the step the router names next. A step whose own executor refuses it, followed by the router naming it again unchanged, is a deadlock the router is reporting as progress.

---

# Finding 52 - The normal path never opens an attempt: no skill but ship names --attempt, and advance-phase build->verify accepts a task with zero attempts

Filed: 2026-09-29T16:13:50Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs advancePhase (line 580); skills/build/SKILL.md; skills/plan/SKILL.md step 5`

Project cartoonify, task 0009, plugin 0.1.35, 2026-09-29.

grep -rln -- "--attempt" over the installed plugin lists scripts (lib/route.mjs, risk-guard.mjs, state.mjs, verify.mjs) and exactly one skill: skills/ship/SKILL.md (line 104).

skills/plan/SKILL.md step 5 names --approve-spec, then --advance-phase <id> --from plan --to build, then tells the operator to run /mavci-core:build. skills/build/SKILL.md steps 1-4 never name --attempt, yet step 4 says "status: failed -> the attempt counter has advanced", as if something advanced it.

advancePhase (scripts/state.mjs:580) checks the current phase, that the step is legal, that spec_approved exists and that the spec hash matches. It does not look at attempts, so --from build --to verify succeeds on a task that never consumed one.

What happened: the operator approved the spec, ran --advance-phase plan->build, and had the builder work directly in the main session rather than through /mavci-core:build. Nothing on that path opened an attempt or warned that none was open. The phase reached verify with attempts 0, and the first verify dispatch was blocked (previous finding). After the operator intervened the task read attempts 2 / attempts_total 2; how it reached 2 rather than 1 was not observed by this agent. That left one retry of three where the task had consumed one build.

The router plan branch does list "state.mjs --attempt <id> --agent mavci-builder" after --advance-phase, and the build branch names it when attempts is 0, but only a caller who runs route.mjs sees that; the plan skill does not run it, and neither transition command enforces it.

### The assertion, and the broken build it must catch

State: advancePhase(root, id, "build", "verify") on a task with attempts 0 must throw, naming state.mjs --attempt <id> as the remedy. Broken build: 0.1.35, which advances.

Docs: every skill whose steps end in a mavci-builder dispatch must contain the string --attempt (or run a command that consumes one). Broken build: skills/build/SKILL.md at 0.1.35.

Either one alone would have stopped this session one step earlier; the state check is the one that cannot be bypassed by working outside the skill.

---

# Finding 53 - Agent hand-backs state counts about a file they cite without deriving them from it, and the numbers are wrong

Filed: 2026-09-29T16:13:50Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `agent-defs/verifier.json (agents/mavci-verifier.md); agent-defs/scribe.json`

Project cartoonify, task 0009, plugin 0.1.35, 2026-09-29. The source file is lib/gallery-manifest.json, field web_files, 20 entries. Actual distribution, computed from the file: widths 16 at 640, 3 at 560, 1 at 480; qualities 14 at q72, 5 at q60, 1 at q48.

mavci-verifier, first run: "lib/gallery-manifest.json web_files has 16 files at 640 px, 3 at 560 px and 1 at 480 px, all at quality 72." The quality clause is false.

mavci-verifier, second run, after being told the qualities were mixed: "Qualities are 13 at q72, 3 at q60 at 640 px, 1 each at q60 for 480 and 560 px, and 1 at q48 for 560 px. That is 14 at q72 and 5 at q60." The closing totals are right, but the itemised breakdown lists 13 + 3 + 1 + 1 + 1 = 19 files: it omits engraved-plate, the one file at 560 px q72. Reading "13 at q72" as "13 at q72 at 640 px" is the only reading under which the totals hold, and the sentence does not say it.

Same pattern, other agents, same task: mavci-scribe transcribed the size ladder as "640 at q72, then 560 at q60, then 480 at q48", which the manifest it cites contradicts (engraved-plate is 560/q72, retro-print 480/q60); and reported the summary as "1400 lines" when it is 143 (see finding 49). The main-session builder also first reported 14 files at 640 where there are 16.

None of these affected a criterion: criterion 5 bounds width to 480..640 and never reads quality. The risk is in what they are used for: the verifier hand-back is the evidence the operator reads, and the scribe text is the permanent record.

### The assertion, and the broken build it must catch

No mechanical assertion was found that catches a wrong count in free prose without also flagging correct ones; this is stated rather than left as a gap.

Closest checkable form: an agent eval fixture. Give the verifier a manifest whose web_files have a mixed, non-uniform quality distribution and ask for it. Pass only if the hand-back quotes the distribution together with the command that produced it and the numbers match. Broken build: 0.1.35 verifier, which reported "all at quality 72" for a file with three distinct qualities.

Contract change the fixture would enforce: any count or distribution about a file must be produced by a command in checks_run and quoted from its output, not summarised from reading.

---

# Finding 54 - Router cannot see a scribe summary already on disk: it keeps naming "document -> mavci-scribe" until phase or status move

Filed: 2026-09-29T20:10:18Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/route.mjs (document arm, lines 728-747)`

Project cartoonify, task 0010, plugin 0.1.35, 2026-09-29.

After the verdict for attempt 1 was recorded as pass, the router named "next: document -> mavci-scribe", then state.mjs --advance-phase 0010 --from verify --to release, then state.mjs --task-status 0010 --status done. The scribe was dispatched and wrote .mavci/tasks/0010.summary.md (on disk, 15 496 bytes, 21:22), a CHANGELOG.md entry and a decision record.

The operator then ran /mavci-core:verify 0010 again. The router block printed, unchanged: "next: document -> mavci-scribe (task 0010). task 0010 passed attempt 1 - 23 of 23 criteria executed. What is left is the record: a changelog entry and a task summary ... dispatch mavci-scribe". The summary it asks for existed.

Cause, read in scripts/lib/route.mjs:728-731, the comment on the document arm: "selectTask never returns a done task, so this branch is only ever reached while the task is still open - which is exactly when the record has not been written." That premise is false by the router's own ordering: the same arm tells the caller to dispatch the scribe FIRST and to advance the phase and close the task AFTER. Between the scribe finishing and the operator running the two state commands, the task is open and the record IS written, and the router says to write it again.

Consequence observed: re-dispatching the scribe as named would have overwritten a summary in which the main session had just corrected twelve factual errors. The main session declined to follow the router and said so; nothing in the router would have stopped a less careful caller.

### The assertion, and the broken build it must catch

Fixture: a task in phase verify, status in_progress, with a pass verdict for its current attempt AND .mavci/tasks/<id>.summary.md present. route() must NOT name "dispatch mavci-scribe"; it must name only the remaining state steps (--advance-phase ... --to release, then --task-status ... done).

Broken build it must catch: 0.1.35, which names dispatch mavci-scribe for that fixture.

The same fixture without the summary file must still name the scribe, so the assertion discriminates on the file, not on the verdict.

---

# Finding 55 - Closed tasks' acceptance criteria are never re-run: task 0004 criterion 11 was red on HEAD from cee3bea until it was noticed by hand

Filed: 2026-09-29T20:10:18Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs; scripts/gate.mjs (no current home for a regression run)`

Project cartoonify, plugin 0.1.35, observed 2026-09-29 while writing task 0010's spec.

Task 0004 criterion 11 requires, among other things, one [data-style-group="..."] rule per group in app/globals.css and the string STYLE_PREVIEW_IDS in components/style-card.tsx. On HEAD at the time (8be0200): grep -n "data-style-group" app/globals.css returned nothing, and components/style-card.tsx did not contain STYLE_PREVIEW_IDS (count 0). git log -S'data-style-group="cizgi"' -- app/globals.css shows the rules arrived in ce4b793 (task 0004) and left in cee3bea ("feat: migrate latest Cartoonify UX redesign"). The STYLE_PREVIEW_IDS reference left with task 0008.

Nothing reported either removal. The gate runs the standards packs, not closed tasks' mavci-criteria blocks; verify.mjs runs one task's block; the router reads one task's verdict. A criterion is enforced exactly once, at the verify of the task that wrote it, and is silent afterwards however its subject changes.

Second instance, same session: task 0010 criterion 18 compares the legal pages against their pre-move paths in HEAD. It passed at 0010's verify and fails on every later HEAD (fatal: path 'app/(legal)/kvkk/page.tsx' does not exist in 'HEAD'), so it could not be re-run even if something tried. Criteria written against "HEAD" are relative to a moment, not to a state, and nothing records which are which.

What each task has done instead is carry chosen criteria forward by hand (0009 carried 0008's; 0010 carried 0009's; 0011 carries 0010's), which re-runs exactly the ones someone remembered.

### The assertion, and the broken build it must catch

A regression mode: run every closed task's mavci-criteria block that does not declare itself task-relative, against the current tree, and report each red one with its task and id. Criteria must be able to declare themselves task-relative (for example a field such as "relative_to": "HEAD-at-verify") so the ones that cannot be re-run are named rather than failing noisily.

Broken build it must catch: 0.1.35 on this project at 8be0200, where task 0004 criterion 11 is red and nothing reports it. The mode must report it.

Discrimination: on a tree where the [data-style-group] rules and the STYLE_PREVIEW_IDS reference are restored, the same run must report 0004 criterion 11 green.

---

# Finding 56 - state.mjs begin-plan points every new task's spec at the same .mavci/tasks/pending.md, so the next task can overwrite the previous task's approved spec

Filed: 2026-09-29T20:10:41Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs (--begin-plan / --new-task default spec path, lines 1511 and 1518); skills/plan/SKILL.md step 2`

Project cartoonify, plugin 0.1.35, 2026-09-29.

scripts/state.mjs:1518: const id = beginPlan(root, { title, spec: arg('--spec', `${PATHS.tasks}/pending.md`) }); (the same default at 1511 for --new-task). skills/plan/SKILL.md step 2 invokes --begin-plan "<short title>" with no --spec.

Observed: task 0010's sidecar .mavci/tasks/0010.json has "spec": ".mavci/tasks/pending.md", and that file IS 0010's approved spec (its control-task approval hash 8b378c595b2167e91583eae8d78512e0a0de8178d7cb938961fe989a0be0161d matches it, and commit c451dc0 added it under that name). Task 0011 was then begun, and its sidecar .mavci/tasks/0011.json was created with the identical "spec": ".mavci/tasks/pending.md".

Nothing prevented the architect writing 0011's spec into that path, which would have overwritten task 0010's approved spec and silently broken the hash that ties 0010's verdict to what the operator approved. It was avoided only because the operator noticed and instructed the architect to write .mavci/tasks/0011-wide-layout-square-cards.md and repoint 0011.json by hand.

The sidecars of 0007, 0008 and 0009 each name a unique <id>-<slug>.md; 0010 names pending.md. For 0009 this session saw how: --begin-plan created the sidecar pointing at .mavci/tasks/pending.md, and the spec was written under a slug name with the sidecar repointed by hand. Whether 0007 and 0008 went the same way is not in git history (only their final sidecars are committed). 0010 was left at pending.md, so 0011 was the first to collide.

### The assertion, and the broken build it must catch

State: --begin-plan without --spec must allocate a path unique to the new task (for example .mavci/tasks/<id>.md or <id>-<slug>.md), never a shared name. And it must refuse to point a new task at any spec path already named by another task's sidecar.

Broken build it must catch: 0.1.35, where two consecutive --begin-plan calls produce two sidecars with the same "spec" value.

Integrity: writing to a spec file whose hash is recorded in any task's spec_approved should be refused or at least reported by the guard, since that write invalidates an approval after the fact.

---

# Finding 57 - The criterion runner hands each criterion to Git Bash as one -c argument, and on Windows that argument is cut at 8 186 characters: a longer criterion runs a prefix of itself, and can exit 0

Filed: 2026-09-30T07:22:10Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/criteria.mjs (runOne, line 314: execFileSync(bash.path, ['-c', criterion.run])); scripts/lib/shell.mjs (resolveBash); criteria parsing, where a length ceiling would be checked`

Project cartoonify, plugin 0.1.35, Windows 11 Pro 10.0.26200, node v24.13.0, Git Bash at C:\Program Files\Git\bin\bash.exe. Observed 2026-09-29, measured again 2026-09-30.

First instance (task 0010 spec, section 11.1): joining 0009 criteria 4, 5, 6, 9 and 10 into one shell line made bash report `unexpected EOF while looking for matching '"'`. Each part passed alone, and so did the first three joined. The spec records "The cause was not found" and carries them as four separate criteria (17, 21, 22, 23). The joined criterion was 11 207 characters (figure from the 0011 spec-writing session, not re-measured).

Second instance, and the measurement (session e708ab02, 2026-09-29 21:04, while writing task 0011's spec): a single command for criteria 29 and 31 was 8 488 characters and failed the same way. The main session reported, verbatim (operator's copy): "Bu makinede Node'dan çağrılan bash -c, yaklaşık 8 183 karakterden uzun komutları kesiyor. Sınırı ikiye bölerek ölçtüm: 8 140 geçiyor, 8 149 kırılıyor. 0010'daki açıklanamayan 'unexpected EOF' hatasının sebebi buydu." The probe (scratchpad len-probe.mjs) printed: "payload limit between 8140 and 8149 (command length about 8183)". That probe called spawnSync('bash', ['-c', cmd]) with no shell option, i.e. argv, not cmd.exe.

Call site. scripts/lib/criteria.mjs:314, runOne: execFileSync(bash.path, ['-c', criterion.run], { cwd, encoding, timeout, stdio }) - the criterion is ONE argv element, no shell option (so shell: false), no cmd.exe in the path. bash.path comes from scripts/lib/shell.mjs resolveBash(): on win32 the first candidate is %ProgramFiles%\Git\bin\bash.exe (the 46 992-byte launcher), then PATH bash. The only other child_process calls in scripts/ are execFileSync with argv arrays: shell.mjs:54 and :94 (bash -c "echo mavci-shell-probe"), gate.mjs:467 and :785 (node verify.mjs), verify.mjs:58 and doctor.mjs (git, gh, node risk-guard.mjs). None uses shell: true, exec or execSync.

Operator's hypothesis tested: "8 191 is the cmd.exe command-line limit; child_process shell:true goes through cmd.exe on Windows; calling bash -c with argv avoids it (CreateProcess limit ~32 767)." Genel deneme (general probe - harmless echo / node -e commands written for this, NOT the criteria that failed), scratchpad probe57.mjs, probe57b.mjs, probe57c.mjs, 2026-09-30:

1. ~8 300 characters, execSync(cmd, { shell: true }): echo, len 8 300 -> exit 1, stderr "The command line is too long." node -e, len 8 298 -> exit 1, same stderr.
2. Same commands, spawnSync(Git\bin\bash.exe, ['-c', cmd], { shell: false }): echo, len 8 300 -> exit 0 but output WRONG: 8 181 characters printed, the END57 marker and the tail missing. node -e, len 8 298 -> exit 2, stderr "/usr/bin/bash: -c: line 1: unexpected EOF while looking for matching `"'".
3. Original points (payload 8 140 / 8 149, node -e shape): shell:true -> len 8 183 exit 1 and len 8 192 exit 1, both "The command line is too long." bash argv -> len 8 183 exit 0 correct; len 8 192 exit 2 "unexpected EOF". Echo shape, payload 8 140 / 8 149 (len 8 151 / 8 160): shell:true exit 0 correct / exit 1 too long; bash argv both exit 0 correct.
4. Bisection to the character, both shapes: shell:true last good command length 8 152, first bad 8 153 (8 152 + the 39 characters Node adds, C:\WINDOWS\system32\cmd.exe /d /s /c "...", = 8 191, the cmd.exe limit). bash argv last good 8 186, first bad 8 187, identical for echo and node -e.
5. Launcher or bash? Same tests against C:\Program Files\Git\usr\bin\bash.exe (the real MSYS bash, 2 553 064 bytes): identical results at 8 151 / 8 160 / 8 183 / 8 192 / 8 311 / 20 011 / 30 011 characters. The cut is in MSYS bash / its runtime, not in the Git\bin launcher.
6. Can truncation turn a failure into a pass? Same call shape as criteria.mjs:314. ": <pad> ; exit 7": len 8 011 -> exit 7; len 8 311 -> exit 0. "test -n \"<pad>\" && false": len 8 019 -> exit 1; len 8 319 -> exit 2 (parse error instead of the assertion).

Result against the hypothesis: NOT supported for the path the plugin uses. cmd.exe's limit is real (8 191, loud: "The command line is too long.") but the plugin never goes through cmd.exe. The argv path does not reach the ~32 767 CreateProcess limit: Git Bash itself keeps only the first 8 186 characters of the -c argument, silently, with no error of its own. What happens next depends on where the cut lands: inside a quote -> "unexpected EOF" and exit 2 (both observed instances); between commands -> the prefix runs and its exit code is reported, which can be 0 for a criterion whose failing part was never executed (item 6).

Consequence for the runner: runOne maps exit 2 to fail (a parse-time death, same exit code as a failed assertion - see finding 42), and exit 0 to pass. Neither outcome is not_run, and nothing checks criterion.run.length. The 0011 spec's generator now refuses criteria over 7 800 characters, as a hand-built workaround in one project.

### The assertion, and the broken build it must catch

Fixture: a spec whose mavci-criteria block holds one criterion of the form ": <8 300 x characters> ; exit 7" (8 311 characters). On Windows with Git Bash, the runner must NOT report it pass. Broken build it must catch: 0.1.35, which reports it pass (exit 0, item 6).

Discrimination: the same criterion with 8 000 x characters (8 011 total) must report fail (exit 7), so the assertion bites on length, not on the command.

Two acceptable fixes, either makes the fixture go red-then-green: (a) pass the criterion to bash on stdin or in a temp script file (bash <file>) instead of as a -c argument, so there is no argv limit to hit; or (b) refuse any criterion longer than a stated ceiling (below 8 186) at parse time with a message naming the ceiling and the length, reported as not_run, never fail/pass. (a) needs a second fixture: a criterion that reads stdin must still see what it saw before.

Also: preflight (shell.mjs) proves bash starts, not that it receives its argument whole; a round trip of a long argument would have found this on the first run.

### Addendum to finding 57 - Silent truncation can produce a false pass: fix order, 8 000 ceiling, preflight round trip, retroactive audit

Amended 2026-09-30T07:29:51Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Operator's direction, 2026-09-30, transcribed by the main session. The title is written once and cannot be changed, so it is corrected here instead. The heading the operator wants: "Silent truncation: a criterion over 8 186 characters is cut without an error and can produce a false pass". That is the point of this finding. The "unexpected EOF" is the harmless case, because it fails loudly. The dangerous case is the one where the cut lands between commands and the run exits 0.

Order of fixes, which replaces the "either" in the assertion section:

(a) THE FIX. Hand the criterion to bash on stdin or in a temporary script file (bash <file>) instead of as a -c argument. Then there is no argv ceiling to hit. It needs the second fixture already named: a criterion that reads stdin must still see what it saw before.

(b) STOP-GAP until (a) ships. At parse time, refuse any criterion whose run field is longer than 8 000 characters (not "below 8 186": the margin is deliberate). The refusal message names the ceiling and the actual length, and the criterion reports not_run, never pass or fail.

(c) PREFLIGHT. shell.mjs preflight adds a round trip of a long argument: send an argument longer than the ceiling and check that it comes back whole. That turns this defect from silent into a preflight failure on any machine where it exists.

Retroactive audit, read-only, 2026-09-30 (scratchpad audit57.mjs). Every mavci-criteria block under .mavci/tasks/ was parsed with the plugin's own parseCriteriaBlock (0.1.35), and each run field was measured. That covers 0001 to 0011, with pending.md = 0010's spec. 0001 and 0002 have no block. Result: 174 criteria, NONE over 8 000. The longest is 0011 #29 at 7 727 characters (7 727 UTF-8 bytes), then 0011 #31 at 5 725, then 0009 #6 / 0010 #21 / 0011 #19 at 4 319. So no recorded pass verdict of this project rests on a truncated criterion, and no criterion was re-run. The audit measured the spec text as it stands now. It did not check that a sealed or previously executed copy was byte-identical (see finding 40).

A limit on what was proven: item 6 and the "Broken build it must catch" line were shown with the same call shape as criteria.mjs:314 (execFileSync(bash, ['-c', cmd])), not by running verify.mjs on a fixture spec. "0.1.35 reports it pass" is the expected result of that code path. It has not been observed through the runner.

**Superseded, quoted verbatim from the body above:** (b) refuse any criterion longer than a stated ceiling (below 8 186) at parse time

---

# Finding 58 - A criterion's evidence is its own command cut at 500 characters: on a pass the output is never recorded, so a browser criterion's measurements are not in the verdict (0011 criteria 29 and 31)

Filed: 2026-09-30T08:22:15Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/criteria.mjs (runOne evidence, lines 338-344; clip, lines 293-296); scripts/config.mjs (EVIDENCE_MAX_CHARS 500, CLAMP_MARKER); verdict.schema.json (evidence maxLength)`

Project cartoonify, task 0011, attempt 1, plugin 0.1.35, 2026-09-30.

The recorded verdict .mavci/control/verdicts/0011-attempt-01.json (verdict pass, run_at 2026-09-30T08:20:43Z, made by mavci-verifier with verify.mjs --record --task 0011 --run-criteria 0011 --have shell,server,browser) holds 31 criteria, all pass/executed. 27 of the 31 evidence strings are exactly 500 characters. The evidence for criterion 29 (a 7 727-character criterion that starts next start and headless Chrome and measures the workbench at 1280x624 and 1920x984) reads in full: "exit 0 in 3086 ms: node -e \"const fs=require('fs'); const os=require('os'); ... const until=async(fn,ms,what)=>{ const end=Date....". Criterion 31 (375x667) is the same shape: "exit 0 in 1170 ms: node -e ..." ending "const end=Date....". Neither holds a single measured value.

What the criteria actually printed, when the main session re-ran them from the same spec (bash <file>, exit 0 both): criterion 29 printed 17 lines, for example "1280x624 after generate: {\"sy\":306,\"res\":{\"t\":0,...},\"resImg\":{\"t\":66,\"b\":464,\"l\":614,\"w\":398,\"h\":398}}" and "generate requests answered locally, none sent upstream: 2". Criterion 31 printed "375x667 document end: {\"vh\":667,\"bar\":{\"t\":591,\"b\":667,...},\"pos\":\"fixed\",\"last\":{...\"b\":419...},\"foot\":{...\"b\":591...}}". None of that is in the record. The verdict proves that a command exited 0. It does not show what that command saw, and for a browser criterion what it saw is the whole point: the pass is only as good as the numbers, and a reader of the verdict cannot check them.

Cause, read in scripts/lib/criteria.mjs:

- Lines 338-344 (runOne): evidence is clip(passed ? `exit ${status} in ${ms} ms: ${criterion.run}` : `exit ${status}, expected ..., in ${ms} ms: ${criterion.run} -- ${out}`). On a pass, `out` (stdout+stderr) is discarded entirely. The criterion's own text, which the spec already holds and the spec seal already hashes, fills the field.
- On a FAIL the output is appended AFTER the command. Any criterion longer than about 480 characters therefore loses its whole failure message to the cut, and the recorded evidence of a failure is the first 480 characters of the command that failed. In this project 111 of 174 criteria (0003-0011, counted from the 2026-09-30 length audit filed under finding 57) exceed 480 characters, so this is the common case and not an edge. The failure case was not observed in a recorded verdict here. It follows from the same line and has not been run.
- Lines 293-296 (clip): cuts at EVIDENCE_MAX_CHARS (500, config.mjs:389) and appends "...". It does not use CLAMP_MARKER (" [...cut]", config.mjs:393), whose comment reads "Visible on purpose: a silent truncation is a lie." A "..." inside a JavaScript criterion reads as spread syntax or as a normal ellipsis, not as a cut.

Consequences seen in this session: the verifier's hand-back said evidence is "truncated at about 300 characters" and that it "looked only at status and mode". To see what criteria 29 and 31 measured, the main session had to re-run both outside the verifier. The verdict, the artefact meant to be the audit record, carries no measurement.

### The assertion, and the broken build it must catch

Fixture 1 (pass keeps its output): a spec with one criterion "printf 'MEASURED-%s\n' 42; : <600 x characters>" (exit 0). The recorded verdict's evidence for it must contain "MEASURED-42". Broken build it must catch: 0.1.35, whose evidence is "exit 0 in N ms: printf ..." cut at 500 and contains no output.

Fixture 2 (fail keeps its message): the same criterion ending in "; echo FAILED-BECAUSE-X >&2; exit 3". The recorded evidence must contain "FAILED-BECAUSE-X" and "exit 3". Broken build: 0.1.35, where the 600-character command fills the 500 characters and the message is cut away.

Fixture 3 (a cut is visible): any evidence that is cut must end with CLAMP_MARKER, not "...". Broken build: 0.1.35 clip().

Direction for the fix, for the applier to weigh: the command is already in the sealed spec, so the evidence should identify it (criterion id + spec sha) rather than repeat it, and spend its budget on the output (its tail for a failure, where the assertion message usually is). If 500 characters cannot hold a browser criterion's measurements, the full stdout should go to a file beside the verdict (for example verdicts/<id>-attempt-NN.criterion-<n>.log) and be named, with its hash, in the evidence.

Discrimination: fixtures 1 and 2 with a criterion under 100 characters must pass on both builds, so the assertion bites on the ordering and the discard, not on length alone.

### Addendum to finding 58 - Discrimination corrected: fixture 1 is red on 0.1.35 at any length

Amended 2026-09-30T08:22:27Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Correction by the main session, minutes after filing: the Discrimination paragraph is wrong for fixture 1. 0.1.35 discards the output of every passing criterion, whatever its length (runOne builds pass evidence from the command alone). So a SHORT fixture 1 is also red on 0.1.35, and fixture 1 discriminates on the discard, not on length. Only fixture 2 is length-dependent.

Corrected discrimination:
- Fixture 1 is red on 0.1.35 at any length, and green on a fixed build at any length.
- Fixture 2 with a criterion under 100 characters is green on both builds, because the message fits after the command. At 600 characters it is red on 0.1.35 and green on a fixed build. That pair shows the ordering defect, separately from the discard.
- In fixture 2, "exit 3" alone does not discriminate: 0.1.35 already puts "exit 3, expected 0" at the front. The discriminating string is FAILED-BECAUSE-X.

**Superseded, quoted verbatim from the body above:** Discrimination: fixtures 1 and 2 with a criterion under 100 characters must pass on both builds, so the assertion bites on the ordering and the discard, not on length alone.

---

# Finding 59 - The architect's prototype worktree reached the project's real node_modules through a junction, and deleting the worktree deleted the packages: every later criterion needing tsc or next went red

Filed: 2026-09-30T09:09:36Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `agents/mavci-architect.md (no guidance on prototype worktrees); scripts/risk-guard.mjs (junction creation into the project tree is not examined)`

Project cartoonify, task 0012 (phase plan), plugin 0.1.35, Windows 11, Git Bash, 2026-09-30. All times UTC, read from the mavci-architect transcript and from commands run by the main session.

Practice being followed: task 0011 §11.1 proved its criteria on "a prototype of this spec written in a scratch git worktree of c451dc0, not in the project tree". The architect repeated that for 0012.

Timeline:
- 08:45:00 mavci-architect: git worktree add --detach <scratchpad>/wt HEAD && cmd //c mklink //J <scratchpad>\wt\node_modules C:\Projelerim\cartoonify\node_modules. Output: "Junction created for ...\wt\node_modules <<===>> C:\Projelerim\cartoonify\no[de_modules]". The worktree used the project's real packages through a junction.
- 08:47-08:52 the architect built and probed the prototype in wt (npm run build, headless Chrome).
- 08:52:22 last successful architect command in wt. 08:52:28 "cd: wt: No such file or directory". The worktree was gone. No command in the architect's transcript deleted it. Who or what did is not recorded, and this finding does not assume.
- 08:52:58 architect: "ls: cannot access '/c/Projelerim/cartoonify/node_modules/.bin/': No such file or directory". The main session later counted 22 top-level entries left in the project's node_modules (next, node-domexception, node-fetch, openai, ... zod: everything alphabetically from "next" on). .bin and every package before "next" were gone. package-lock.json lists 105 node_modules entries.
- 08:52:43 the architect made a second worktree, wt-arch0012, again with mklink /J to the project's node_modules. At 08:53:21 it ran cmd //c rmdir on that junction and then npm ci inside the worktree. The main session stopped the agent during that install.

Consequence: the next run of the criteria on the project tree gave criterion 2 "'tsc' is not recognized as an internal or external command" and criterion 3 "'next' is not recognized...". Criteria 29, 31 and 32 failed with "Could not find node with given id" and "timed out waiting for next start". Those are tree-state failures that read like product failures. The main session restored the tree with npm ci (63 top-level entries, node_modules/.bin/tsc and next present), after which all 31 carried criteria were green.

Mechanism, stated as far as it is evidenced: a recursive delete of the worktree directory followed the junction into the real node_modules and stopped partway. A partial, alphabetical loss that ends just before "next" fits a delete that hit a path error inside next's deep tree. On the same machine, the main session's own `git worktree remove --force` of wt-arch0012 failed with "Filename too long" (that junction had already been removed at 08:53:21, and the project's node_modules was unaffected: 63 entries before and after). Whether the 08:52 deletion was git worktree remove, rm -rf or a manual delete is not known.

Correction recorded here, since it was said in the session: the main session first described the packages as "moved" into wt-arch0012, because that worktree held 63 entries. That was wrong. They were that worktree's own npm ci, interrupted.

Nothing in the plugin mentions worktrees, junctions or node_modules for prototypes, and the risk guard does not look at mklink or New-Item -ItemType Junction. The practice that led here is a spec pattern (0011 §11.1), not a plugin feature, so there is no code path to fix. There is also no guidance.

### The assertion, and the broken build it must catch

Operator's direction: a prototype worktree runs its own npm ci. If a link is used anyway, the removal step removes the link first (cmd //c rmdir on the junction, which removes the link and not its target) and only then deletes the worktree.

Checkable forms:

(1) Guidance: agents/mavci-architect.md states both rules. An agent eval fixture gives the architect a spec needing a built prototype. It passes only if the transcript shows either no mklink/junction to the project tree, or an rmdir of the link before any worktree removal. Broken build: 0.1.35, where the 0012 transcript shows mklink /J to C:\Projelerim\cartoonify\node_modules and no guidance exists.

(2) Guard, Windows: the risk guard refuses, or at least warns, a Bash/PowerShell command from an agent that creates a junction or symlink (mklink /J, mklink /D, New-Item -ItemType Junction|SymbolicLink) whose TARGET is inside the project root. Fixture: that exact 08:45:00 command must be refused. Discrimination: a junction between two scratch directories must pass.

(3) Cleanup safety: if the plugin ever ships a worktree helper, its remove step is tested with a worktree whose node_modules is a junction to a temp directory holding a marker file. After removal the marker must still exist. Broken build: a helper that calls git worktree remove --force or rm -rf first.

### Addendum to finding 59 - Deletion most likely the operator's git worktree remove --force, which followed the junction

Amended 2026-09-30T09:13:24Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Operator's account, 2026-09-30, transcribed by the main session. It replaces "who or what did is not recorded" in the timeline, and "whether the 08:52 deletion was git worktree remove, rm -rf or a manual delete is not known" in the mechanism paragraph.

The deletion of <scratchpad>/wt at about 08:52 was most likely triggered by the operator running `git worktree remove --force <wt>`, a command suggested by a chat assistant. The command stopped partway with "Filename too long". That matches what the project's node_modules showed afterwards: a delete that followed the junction into the real packages and stopped partway. The packages were removed alphabetically up to just before "next", and .bin was gone. The same error ended the main session's own `git worktree remove --force` of wt-arch0012 later that session. That one did no harm, because the architect had already removed that junction with rmdir at 08:53:21.

So the hazard is not only an agent's rm -rf. The standard, documented git command for this job, run by a human, follows the junction on this machine.

Addition to the direction in the assertion section: before a worktree is removed, every junction inside it must be removed with rmdir (cmd //c rmdir <link>, which deletes the link and not its target), because git worktree remove follows the junction. This applies to the operator's own cleanup as well as to agents'. Guidance that tells only the agent is not enough when the remover is a person with a suggested command.

Not independently tested here: that git worktree remove follows a junction in general. The evidence is this one incident, the operator's account, and the matching partial loss.

**Superseded, quoted verbatim from the body above:** Who or what did is not recorded, and this finding does not assume.

---

# Finding 60 - mavci-scribe produced invented content and reversed claims in three consecutive task records (0010: 12, 0011: 12, 0012: 15 corrections), including inverting "criteria 32-34 proven red only"

Filed: 2026-09-30T10:04:33Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `agents/mavci-scribe.md; scripts/lib/route.mjs (document arm, which dispatches the scribe and then closes the task with no check of its output)`

Project cartoonify, plugin 0.1.35, tasks 0010, 0011 and 0012, 2026-09-29/30. Related to finding 49 (scribe overstates its own output size) and finding 53 (agent hand-backs state counts not derived from their source). Filed separately because the failure here is not a miscount. It is content with no source, and claims turned into their opposite, in the document meant to be the task's record.

Correction counts. The main session found each error by checking the written file against the sources named in the dispatch:
- 0010: twelve factual errors corrected in .mavci/tasks/0010.summary.md before it was committed (recorded in finding 54: "a summary in which the main session had just corrected twelve factual errors").
- 0011: 11 errors in .mavci/tasks/0011.summary.md and 1 in CHANGELOG.md.
- 0012: 15 errors in .mavci/tasks/0012.summary.md and 3 in CHANGELOG.md.

Kinds of error, with instances from 0012 (dispatch 2026-09-30):
- A claim turned into its opposite. The spec (§11.1, §13 item 6) says criteria 32-34 were "proven red only", with their green direction first seen at the build. The scribe wrote "Criteria 32-34 are proven green only. Their red direction would be a future test, not in this verdict", twice. (In 0011, the corresponding error was a garbled prototype table, "27, 28 and 30 ... (29, 30, 31, 30 respectively)", not a reversal.)
- Reasoning with no source. For TS5097 the scribe wrote a diagnostic text that exists nowhere in the sources ("File '...' is not listed within the rootDirs option ...") and a rationale ("the spec's decision (§3.3) to make the module pure means ..."). The file's own comment and the dispatch gave the real reason.
- Queue state reversed. It wrote "finding 57 remains closed". 57 is queued and unapplied.
- An account turned into a fact. The finding 59 addendum says the deletion was "most likely" the operator's command and that junction-following was "not independently tested". The summary stated both as facts, and added "Cleanup is the operator's responsibility during verification", which is in no source.
- Numbers attached to the wrong thing. "22 of 105 top-level entries" joined a directory count to the lockfile's node_modules entry count. It put the prototype at c451dc0 when the transcript says HEAD f3a9faa. It placed the @ts-expect-error on line 3 when the grep given in the dispatch showed line 9. It called the recorded 1689 ms run "before the fix" when the verify ran after it.
- Measurement flow garbled. It said 29 and 32 run at 375x667 and that all three browser criteria generate a result. Only 29 generates, and 29 runs at 1280x624 and 1920x984.

The dispatch was already defensive. The 0012 prompt carried the command output verbatim, a list of hard rules (every number from the given output, the spec or the files; keep units; label re-runs; status "verified, not yet closed"; hand back the source line of every number), and the reason for the rules (findings 49 and 53). The hand-back then listed a source line for each number, including "verdict JSON line 271/258/220". The scribe was not given the verdict and has no Bash to read it. Those line citations cannot be checked, which makes them a second instance of finding 53 inside the hand-back that was meant to fix it.

Consequence: the record that --apply and the operator treat as the account of what a task did is reliable only when the main session re-derives every claim, which is the scribe's whole job done twice. The router's step ("dispatch mavci-scribe ... it transcribes from named sources; it does not reconstruct") asserts a property that three consecutive runs did not have.

### The assertion, and the broken build it must catch

Operator's direction: every number and quotation in scribe output must be traceable to a source (command output, spec section, file:line) and verified by a mechanical check. Until that exists, the main session writes the summaries or verifies them.

Checkable form: the scribe emits, beside the summary, a claims file. Each entry holds the exact substring as it appears in the summary, plus one source of type {command, spec, file}. A command source carries the command and the exact output line; a spec source carries a § id and a verbatim quote; a file source carries path:line and a verbatim quote. A checker, runnable by the router before the closing steps, confirms that (1) every digit-bearing token and every quoted span in the summary is covered by a claim, (2) every spec or file quote exists at the named place, and (3) every command claim's output line is present in the dispatch's supplied output (or, for a re-run, is reproduced).

Broken build it must catch: 0.1.35 on the 0012 record as first written. For example, the summary's "proven green only" has no matching spec quote (the spec says "proven red only"), "rootDirs" appears in no source, and "line 3" for the suppression contradicts the supplied grep, which says line 9.

Discrimination: the corrected .mavci/tasks/0012.summary.md, whose claims were each checked by hand against those sources, must pass the same checker once its claims file is written.

### Addendum to finding 60 - Fourth instance: task 0013, 6 + 4 corrections, invented task number and count, draft presented as live

Amended 2026-09-30T11:32:34Z, plugin 0.1.35. Amended by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Fourth consecutive instance: task 0013 (plan task, style catalogue), 2026-09-30, plugin 0.1.35. The dispatch carried the command output verbatim and the same hard rules as 0012, and added a ban on "verdict JSON line N" citations, since the scribe was not given the verdict.

Corrections the main session made by checking the written files against the spec and the supplied output: 6 in .mavci/tasks/0013.summary.md and 4 in CHANGELOG.md, 10 in all.

- An invented task number. "task 0014" was named as the task that will generate the previews: twice in the summary ("the data that task 0014 will use to generate new style previews"; §13 item 7 "This is planned; task 0014 carries it out") and once in the CHANGELOG ("the 70 new style previews will be generated in task 0014"). The spec numbers no generation task; it says only "0014+" (§7).
- An invented count. The summary said "classic is the default and is kept; the other 10 are fix or merge". The spec says 12 ids were named, classic is kept, and 11 are decided: 9 fix and 2 merge (§2, §3.2). The supplied criterion 6 line also reads "the 11 weak ones".
- A draft presented as live, twice in the CHANGELOG: "31 existing styles expanded to 99", and categories "replacing the four coordinate-derived picker groups". The spec is a plan: nothing on the site changed, and the categories are "for the future filter" (§1, §3.3).
- Also invented: "9 fixed for visual clarity" (no source), and in the summary a link, "unchanged by route A, spec §8", that §8 does not make.

Improvement on 0012: the hand-back contained no line citations it could not have checked. Every number it cited was traceable to the supplied output or a spec section. The errors were in claims and wording, not in the numbers themselves.

The pattern holds across four tasks: given verbatim sources and explicit rules, the scribe still adds plausible, unsourced specifics (task numbers, counts, reasons) and loses the modality of the source (plan becomes done, "0014+" becomes "0014").

No superseded text quoted: this amendment ADDS to the finding rather than correcting it.

---

# Finding 61 - A task whose only verdict is FAIL reaches release and done: advance-phase verify->release and task-status done never read the verdict

Filed: 2026-09-30T14:29:18Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs advancePhase (verify -> release edge), closeTask via --task-status done, incrementAttempt`

Observed on cartoonify task 0015, 2026-09-30. Attempt 1 was verified and the recorded verdict for that attempt is "fail" (criterion 50; the cause was environmental: a forgotten next dev process overwrote .next mid-run).

The operator then ran, by mistake, state.mjs --advance-phase 0015 --from verify --to release and state.mjs --task-status 0015 --status done. Both succeeded. The task record then said phase release, status done, with a verdicts list holding only the failing attempt-1 verdict, and that state was committed and pushed as 8d78561.

Source, plugin 0.1.35 scripts/state.mjs: advancePhase (lines 580-647) refuses on exactly four things, listed in its own header comment: the task phase is not --from; --to is not a legal step; no spec_approved; the spec hash changed. It never reads the task verdicts. PHASE_STEPS (lines 241-254) makes verify -> release a legal step, and the comment on the illegal-step refusal says skipping a phase "is how a task reaches release without being verified" - a verify that FAILED reaches release the same way and is not refused.

--task-status <id> --status done (CLI lines 1329-1345) calls closeTask (lines 447-450), which sets status and clears the active-task pointer and also never reads the verdicts.

Follow-on: state.mjs --attempt 0015 then ran incrementAttempt (lines 410-423). It has no phase check and no status check beyond the ceiling and assertSoleInProgress, so it reopened the done task as in_progress while the task and project phase stayed release. The project active-task pointer stayed null (closeTask cleared it; nothing sets it back), so the project state and the task record now disagree about whether a task is active.

route.mjs had correctly named the next step after the FAIL as "rework -> mavci-builder". The gate did not enforce what the router said, so the quality gate is skippable by one operator command, with no record that it was skipped.

### The assertion, and the broken build it must catch

Build a fixture task in phase verify whose verdicts list holds one verdict for the current attempt with verdict "fail". Assert that --advance-phase <id> --from verify --to release exits non-zero and leaves both the task phase and the project phase at verify; assert the same for a task with no verdict naming its current attempt.

Assert that --task-status <id> --status done exits non-zero on the same fixture, and exits zero only when the latest verdict names the current attempt and is "pass" (or when an explicit, recorded operator override flag is given, whose use is written into the task record).

Assert that --attempt <id> on a task whose status is done, or whose phase is release, exits non-zero unless an explicit reopen is requested, and that a reopen also restores the project active-task pointer.

The broken build these catch is 0.1.35 itself: on it all three commands succeed on the fixture.

---

# Finding 62 - verify has no guard against another process writing .next while criteria run, so an environment fault is recorded as a failed attempt

Filed: 2026-09-30T14:34:56Z, plugin 0.1.35.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/verify.mjs --run-criteria (preflight before the first criterion; and the build that criterion 3 makes)`

Observed on cartoonify task 0015, 2026-09-30. verify.mjs --run-criteria 0015 --have shell,server,browser --record ran attempt 1. Criterion 3 built .next with next build; later criteria start next start on that build.

At 17:20:36 local (during the run; the verdict run_at is 2026-09-30T14:19:29Z) a next dev process started in the same repository, outside the verification, and wrote its development output into .next: afterwards .next held static/development and no BUILD_ID.

Criterion 50 (a browser criterion on its own next start) then measured an unstyled page: .site-header at t=8, h=72, l=8 (the default body margin, so the stylesheet was not loaded) and not sticky, and the following navigation to /en timed out. The attempt was recorded as a failed attempt (verdict fail, 50 of 51 pass).

Re-running criterion 50 alone afterwards failed with ".next has no build; criterion 3 builds it". The code was unchanged; after the next dev process was stopped and a clean next build was made, attempt 2 passed 51 of 51 with the same code, criterion 50 included.

Nothing in verify.mjs checks, before or during the run, whether another next process is running in the project or whether .next still holds the production build criterion 3 made. The retry ceiling counts the environmental failure exactly like a code failure.

### The assertion, and the broken build it must catch

Proposal, either or both: (a) at the start of --run-criteria, refuse to record (exit non-zero with a named reason, not a fail verdict) when a node process whose command line runs next dev or next start is alive with the project as its working directory; after the build criterion, record .next/BUILD_ID and re-check it before each later criterion, refusing the run as "environment changed" if it differs or is missing. (b) run criteria against a separate distDir owned by the run, so an outside next dev cannot write into it.

Assertion against the broken build (0.1.35): start next dev in a fixture project, then run verify.mjs --run-criteria --record on a task whose criteria include a next build and a next start criterion. On 0.1.35 the run records a verdict (fail or pass, depending on timing) and consumes an attempt. The fixed build must instead refuse before the first criterion, record no verdict, and leave the attempt count unchanged; and a BUILD_ID change injected between two criteria must end the run as an environment refusal, not as a criterion failure.
