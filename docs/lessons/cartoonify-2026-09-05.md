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

## Addendum - 2026-09-05, plugin 0.1.32 -> 0.1.33: WHAT LANDED AND WHAT DID NOT

Written by hand from the main session, and saying so because 0.1.31's finding 12
is that a hand block is typographically identical to a writer-stamped one.
`retro --amend` could not write this: it reads `.mavci/lessons/` inside a
project, and this is the APPLIED copy in the system repository. Not enforced at
the risk guard, therefore self-declared.

**LANDED.**

1. `criteria[]` on the verdict. `verdict.schema.json` gains `$defs.criterion`
   with `{id, status, mode, evidence}`; `id`, `status` and `mode` are REQUIRED,
   so a result recorded without saying whether it was run or read fails the
   schema rather than reporting inspection as execution.
2. The two closed enums, in `config.mjs` and asserted against the schema by
   `check-schemas.mjs`: `status` ∈ pass|fail|skipped|not_run, `mode` ∈
   executed|inspected.
3. `verdict` ∈ pass|fail|**incomplete**. A locked-format change (ROADMAP
   data-format constraint 4, updated in the same commit) made on the operator's
   ruling.
4. `not_run` forces `incomplete`. One criterion nobody ran and the verdict
   cannot be a pass.
5. **A verdict with no `criteria[]` reads as `incomplete`.** Fail-closed, which
   is the expensive half: every verdict on disk today lacks the field, so every
   project stops at the new `incomplete` action instead of closing tasks. That
   is the intended cost - the alternative is that all of them silently become
   passes.
6. A new router action, `incomplete`, `dispatch: null`, placed AHEAD of the
   `passed` arm. On the broken build this state WAS `passed`, so an arm placed
   after it would be unreachable and would look exactly like a fix.
7. `mode` reaches the operator rather than only the file: the `document`
   action's `why` now reads `29 of 32 criteria executed, 2 inspected (READ, not
   run), 1 skipped by decision`.
8. `verify.mjs --record --criteria <path>` - the PLUMBING half of fix 3. A path,
   never inline JSON (0.1.31: an argument goes through the shell). Without some
   writer, item 5 is a fail-closed gate with no key.

**DID NOT LAND. THIS FINDING IS NOT DONE.**

- **The verifier still cannot record its own judgement.** `mavci-verifier` holds
  no `Write` and no `Edit`, and `--criteria` is a flag on a command the main
  session runs. The agent that is qualified to judge the task remains the one
  agent that cannot write down what it judged - which is fix 3, and it is the
  sentence this finding opened with.
- **Nothing produces the criteria file.** No skill, no agent and no rule derives
  per-criterion results from a spec; today a human writes that JSON. So `criteria[]`
  is populable and not populated.
- **Re-runnability is untouched** - out of scope by the operator's ruling on
  2026-09-05. Nothing here makes a criterion mechanically re-executable, and
  finding 4's precondition vocabulary (shell/server/browser/network/live-key/
  write-outside-tree) is not built.
- **The release gate was not changed.** `lib/release-gate.mjs` does not read
  `criteria[]`; it still reasons about guardian records and verdict freshness.
  A task closed through the operator override at the `incomplete` arm reaches
  the release gate with the same evidence it would have had before.

**The consequence to expect, stated so it is not read as a regression:** until a
writer exists, the chain stops at `incomplete` after every verify. The named
exits are `/mavci-core:verify` with a criteria file, `/mavci-core:retro`, and the
operator's `--task-status <id> --status done`, which the router prints with its
cost attached rather than hiding.


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
