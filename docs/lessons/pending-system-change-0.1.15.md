# Queued for 0.1.15 — apply with `/mavci-core:retro --apply`

Recorded: 2026-09-01, plugin 0.1.14, from read-only pre-connect analyses of **two**
real repositories — `protoolhub-main` (findings 1–4) and
`AI-Chatbot-Widget-SaaS` (findings 5–8). **No Gate ran and neither project was
connected.** Nothing was written to either repository at any point; every number
below came from running the real rule set in memory against the real tree.

Occurrence: ninth through fifteenth of the wrong-gate shape, plus the first
finding about the system's *scope* rather than its mechanism. Same shape as the
eight before: the half that was tested worked, and the half that mattered was never
connected.

**Finding 8 is the first one in this file with a body count.** The others are
defects the system would have reported wrongly. That one is a defect that had
already cost the operator a codebase's history before the system was ever pointed
at the project — and the system's own 0.1.13 lesson describes the identical
mechanism, on a different repository, on the same day this was found.

**What makes these different from findings 1–8 is where they were found.** Every
previous finding came from a synthetic gate project built to provoke it. These came
from pointing the checker at real repositories for the first time and reading what
it said. The system was correct about everything it was asked. It was asked the
wrong questions.

**And Finding 6 is what the second project bought that the first could not.** One
repository gives you defects. Two give you the *axis*: three of these findings, in
two unrelated codebases, are one error wearing different clothes. That is recorded
as a class in its own right, before its instances are fixed, because six point
fixes written against six symptoms is how the seventh instance ships.

---

## Build order

**0.1.15 is the release where the checker knows whose code it is reading.**

1. **Finding 4 — `--record` works with no control plane.** First, and the
   precedent is 0.1.12's own build order, which put `/mavci-core:retro` at
   position 1 on the reasoning that *nothing else in the release matters until the
   escalation channel does*. The same argument applies one layer in. 0.1.12 made
   the channel exist; it did not make it reachable from the window these findings
   were found in. **A fix for the other three that still cannot be reported from
   where it occurs is half a fix** — the next operator meeting a repository the
   checker is wrong about is in exactly the position this session was, and the
   only reason these findings survived is that someone chose to write them by
   hand. That is the sentence `docs/lessons/README.md` already governs this
   directory with: *luck with good manners*, twice now.
2. **Finding 6 — the class is written down before its instances are fixed.**
   No code of its own beyond the alias fix. It goes here because Findings 1, 2
   and 5 are all instances of it, and a fix written against a symptom
   (*"also read `.txt`"*, *"also match `SUPABASE_SERVICE_KEY`"*) closes one hole
   and leaves the axis intact. Each of those three fixes must be written against
   the class statement, not against the file that provoked it.
3. **Finding 2 — `walk()` respects `.gitignore` and excludes vendored trees.**
   Before Finding 1, because it is the precondition for Finding 1 being
   *testable*: while a scan yields 35,000 vendored files, any change to the
   secrets rule is measured against noise. It is also the cheaper half and it
   retires 470 of 478 findings on the first repository.
4. **Finding 1 — the secrets scanner scans by content and location, not by
   extension.** After 3, because "exclude vendored trees" is a dependency of
   "must not fire on code the operator does not own", and because its fixture
   needs a stable file list to assert against.
5. **Finding 5 — `supabase.rls_enabled` reports NOT CHECKED on an empty input
   set.** The smallest code change in the release and the one with the largest
   consequence, because it is currently returning green on a live multi-tenant
   product.
6. **Findings 7 and 8 together — `doctor` reports the publication gap.** They are
   one change in two halves and must be built together: 7 is *working tree vs
   `HEAD`*, 8 is *`HEAD` vs the remote*, and either alone still lets a project
   report on a state nobody else can see. 8's account half is the higher priority
   of the two, because it is the one already known to have caused a loss.
7. **Finding 3 — the single-stack limit is recorded as a Phase 2 scope finding.**
   No code. It is written down so the next person does not discover it by
   pointing the system at a repository it cannot model.

The order is not arbitrary. 3 and 4 are the same defect on two axes — *which files
do we open* and *whose files are they* — and fixing the second without the first
means asserting a credential scanner against a haystack that is 99.2% vendored
dependency. 2 precedes all three rule fixes so that each is written against the
class. 1 comes before everything, because the value of the other six is the report
they produce, and the report is what has no channel.

---

# Finding 1 — the credential scanner filters by extension, which is the wrong axis

Target: `scripts/rules/index.mjs:78`, `scripts/config.mjs:256`
Check: `secrets.no_committed_secrets`

`protoolhub-main` has a complete live Google session cookie jar committed to a
**public** repository since 2026-03-15: 19 entries, 15 session-bearing — `SID`,
`HSID`, `SSID`, `SAPISID`, `APISID`, `__Secure-1PSID`, `__Secure-3PSID`,
`LOGIN_INFO`, and the `PSIDTS`/`PSIDCC` pair — valid until 2027-04-12. That set
resumes an authenticated Google session with no password and no second factor.

`secrets.no_committed_secrets` did not see it, and reported two `critical`
findings elsewhere.

## Why it was missed

The file is `cookies/youtube.com_cookies.txt`. `.txt` is not in `SCANNABLE_EXT`
(`config.mjs:256`), so `walk()` never yields it (`lib/fsx.mjs:123` filters on
extension before `stat`), so the rule never opens it. The rule is not wrong about
the file's contents; it never had the file.

The extension list is a *performance* filter doing *coverage* work. It was chosen
to answer "which files plausibly contain code we can parse", and it is being used
to answer "which files plausibly contain a credential". Those sets barely overlap.
Credentials live in `.txt`, `.env.example`, `.json`, `.log`, `.har`, `.csv`,
`.pem`, `.p12`, `.yaml`, `.sql` dumps, and in files with no extension at all.
A `.har` file is a browser session capture; a `.log` is where a token gets echoed;
a `.csv` is how a credential export leaves a provider console. **A credential
scanner that filters by extension is scanning the wrong axis.**

Note also that `.gitignore` already listed `youtube-cookies.json` and
`youtube-cookies-netscape.txt`. The operator knew this class of file must not be
committed. This one was named differently and passed. The human control failed the
same way the machine one did — by matching a name instead of a shape.

## And the half that fired

Against the same repository the rule produced **two `critical` findings**, both
in:

    .cache/.bun/install/cache/zod@3.25.76@@@1/src/v4/mini/tests/string.test.ts
    .cache/.bun/install/cache/zod/3.25.76@@@1/src/v4/mini/tests/string.test.ts

A JWT literal in zod's own test suite, inside a committed Bun package cache. There
is no key. There is nothing to rotate. There is no edit the operator is entitled
to make — it is a vendored dependency's test fixture.

`critical` is in `UNSUPPRESSIBLE_SEVERITIES`. So:

- `classify()` (`verify.mjs:176`) refuses to baseline or waive it;
- `baselineInit()` (`state.mjs:266`) **throws and refuses to write a baseline at
  all**, halting `/mavci-core:connect` at step 5;
- the skill's instruction on that path is *"a secret is committed. Do not work
  around it. Report exactly which file, tell the operator to remove the value and
  rotate the key at the provider, and stop."*

Pointed at zod's test fixture, that is an instruction to rotate a credential that
does not exist. It is the third distinct instance in this one analysis of a remedy
addressed to someone who cannot carry it out, and the second time `critical` has
been aimed at something no one is empowered to fix.

**The principle, which is the finding:** *a rule that can be neither waived nor
baselined must not be able to fire on code the operator does not own.* An
unsuppressible severity is a promise that the only way out is to fix it. Aiming
one at a vendored dependency breaks that promise and leaves the operator with no
legitimate exit — the only routes out are `checks.exclude_paths` (see Finding 2,
which is itself an unaudited bypass) or deleting the finding's cause from someone
else's package. Both are worse than the rule not firing.

**The rule already contains this exact concept, applied only to itself.**
`rules/index.mjs:110`:

    if (under(rel, 'plugins/mavci-core/templates/fixtures')) continue; // fixtures carry fake keys on purpose

It knows that test fixtures carry fake keys and that firing on them is wrong. It
grants that exemption to precisely one directory: its own. Every other project's
vendored test fixtures get a `critical` that stops the connect.

## The change

1. **Scan by content and location, not by extension.** The secrets rule takes its
   own file list, independent of `SCANNABLE_EXT`: every file under
   `MAX_FILE_BYTES` that is not in an excluded tree, opened and sniffed for
   binary before reading. `SCANNABLE_EXT` stays where it belongs — as the parser
   filter for the twelve rules that parse source.
2. **Exclude vendored trees, for every rule.** Finding 2 delivers the mechanism.
   The secrets rule is the one that most needs it, because it is the one whose
   findings cannot be suppressed.
3. **Generalise the fixture exemption.** `plugins/mavci-core/templates/fixtures`
   stops being a hardcoded special case and becomes one entry in a
   not-the-operator's-code predicate that also covers vendored dependency trees.
4. **Add a cookie-jar detector to the redactor's class table.** A JSON array or
   Netscape-format file carrying `SID`/`HSID`/`SSID`/`SAPISID`/`__Secure-*PSID`
   /`LOGIN_INFO`, or a `Set-Cookie`/`Cookie:` header dump, is a credential. It is
   not high-entropy in the way the entropy class looks for and it carries no
   provider prefix, so neither existing class sees it.

## The assertion, and the broken build it must catch

**The broken build is the one shipping today**: a repository containing a
credential file the scanner never opens, and a vendored test fixture that stops
the connect. Both halves must be asserted, and both must be watched failing
against 0.1.14 before the fix is written.

The fixture is `templates/fixtures/secrets.no_committed_secrets/{bad,good}/` and
it contains **exactly this cookie-file shape** — a `cookies/*.txt` holding the
15-name session set in the same JSON layout, with **synthetic values**. Writing a
fixture from the real jar would commit a live credential to the system repository
in order to test that we detect committed live credentials, which is the defect
performing itself. The values are invented; only the *shape* is real, because the
shape is what was missed.

    bad/    cookies/session_cookies.txt      -> exactly 1 critical finding
            .cache/vendor/pkg/test/jwt.test.ts -> exactly 0 findings
    good/   cookies/session_cookies.txt.example with redacted placeholders -> 0

Three assertions, each independently load-bearing, each with its own negative
control:

1. **The `.txt` jar is found.** Negative control: restore the `SCANNABLE_EXT`
   filter on the secrets rule's file list and this assertion alone must fail.
   *If it still passes, the rule is finding the jar by some other path and the
   assertion is matching the wrong thing.*
2. **The vendored fixture produces nothing.** Negative control: remove the
   vendored-tree exclusion and this assertion alone must fail — and, critically,
   assertion 1 must stay green. Two braces, independently load-bearing, per the
   0.1.11 rule.
3. **A baseline can be written for the `bad/` tree.** This is the one that
   matters and the one most likely to be omitted, because it asserts the
   *consequence* rather than the finding count. `baselineInit()` must succeed
   where today it throws. Asserting only "2 criticals became 1" would pass
   against a build that still cannot complete a connect.

Do not assert on the finding **count** alone. A count of 1 is also what a build
produces that finds the vendored fixture and misses the jar — the exact inversion
shipping today, scoring identically.

---

# Finding 2 — `walk()` does not read `.gitignore`, so the checker audits its own dependencies

Target: `scripts/lib/fsx.mjs:123`, `scripts/config.mjs:250`

`protoolhub-main` tracks 47,829 files. 47,447 of them are `.cache/.bun` — a
committed Bun package cache, Replit residue. The application is about 121 files.

`walk()` takes `excludeDirs` from `DEFAULT_EXCLUDE_DIRS` (`config.mjs:250`), which
holds `node_modules`, `.next`, `.git`, `dist`, `build`, `out`, `coverage`,
`.turbo`, `.vercel`, `.claude`, `.mavci-system`. It does not read `.gitignore`, and
it does not skip dot-directories. `.cache` is in neither list.

Measured, on the real repository:

    walk() yields                     35,168 scannable files
      of which .cache/.local          35,023   (99.6%)
      of which application code           121
    bytes read on a cold pass         140.6 MB in 9.5 s
    Stop hook budget (hooks.json)     30 s

    total findings                       478
      inside .cache/.local               470   (98.3%)
      real                                 8

    next.env_centralised                 315   (312 vendored, 3 real)
    next.regex_no_template_literal       156   (156 vendored, 0 real)
    secrets.no_committed_secrets           2   (2 vendored, 0 real, both critical)
    legal.pages_present                    5   (5 real)

**The eight real findings are buried under 470 that are not the operator's code.**
Three scattered `process.env` reads and five missing legal pages — the entire
useful output of the checker on this project — arrive inside a report of 478.

Two consequences beyond the noise, and both are worse than the noise:

**It nearly took the gate offline.** 9.5 s of cold read against a 30 s Stop hook
budget, on Windows, before rule time. A hook that exceeds its timeout is cancelled
and renders no decision — the turn passes unverified, and the pass is silence
rather than a result. That failure is intermittent by nature, which is the
expensive kind: it would have been diagnosed as flakiness.

**The escape hatch is an unaudited bypass of `critical`.** The fix available today
is `checks.exclude_paths` in the manifest, applied at `verify.mjs:51-53`. It works
— `globToRegExp` handles `.cache/**` correctly. But it filters the file list
*before any rule runs*, so it suppresses `critical` findings, which neither
baseline nor waiver is permitted to do. It is a suppression channel for the one
severity class the system declares unsuppressible, it lives in the manifest, and
nothing checks it. On this repository it happens to be correct. It would be
equally effective at hiding a real key, and nothing would report that it had.

## The change

1. **Read `.gitignore`.** A file the repository has deliberately excluded from
   version control is not the operator's committed code. Respect it, and respect
   nested `.gitignore` files.
2. **Extend `DEFAULT_EXCLUDE_DIRS`** with `.cache`, `vendor`, `.yarn`, `.pnpm-store`,
   `.venv`, `venv`, `target`, `vendored`, `third_party`, and skip dot-directories
   by default with an explicit allow-list for the ones we care about.
3. **`.gitignore` is not sufficient on its own** and must not be the only
   mechanism: `.cache/.bun` here is *tracked*, so a gitignore-only fix would still
   have read all 35,000 files. Both halves are needed — ignore what git ignores,
   *and* exclude vendored trees whether or not they are tracked.
4. **Report what was skipped, on every run.** A checker that silently ignores
   35,000 files is asserting more than it verified. Print the excluded tree count
   and the reason, the way `check-pretag`'s `EXCLUDED_STEPS` prints its exemptions
   on every pass (0.1.14, item 2).
5. **`checks.exclude_paths` must not suppress `critical`.** Either it applies
   after the rules and is subject to `UNSUPPRESSIBLE_SEVERITIES` like every other
   suppression channel, or a check asserts that no `exclude_paths` entry hides a
   `critical` finding and reports it when one would.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, and the assertion must be watched failing against
it first. The fixture is a repository tree carrying a vendored cache with a
planted violation inside it and a real violation outside it.

    fixture/  .cache/vendor/pkg/index.ts   process.env read   -> must NOT be reported
              node_modules/pkg/index.ts    process.env read   -> must NOT be reported
              build-output/x.ts (gitignored, tracked)         -> must NOT be reported
              server/index.ts              process.env read   -> MUST be reported

Assertions:

1. **Exactly one finding**, and it names `server/index.ts`. Not "fewer findings" —
   a build that excludes too much also produces fewer.
2. **The skip is reported**, naming the count and the trees. Negative control: a
   build that excludes correctly and says nothing must fail this. *"Something was
   skipped somewhere" is not a pointer* — the 0.1.13 rule, applied here.
3. **A tracked-but-gitignored file is still excluded.** This is the assertion that
   separates the real fix from the gitignore-only half fix, and it is the one that
   passes against a wrong build if written carelessly.
4. **An `exclude_paths` entry that would hide a `critical` is refused or
   reported.** Fixture: a planted secret under an excluded path. Negative control:
   remove the guard and this assertion alone fails.

Do not assert on wall-clock time. It is the symptom that made this visible and it
is the one measurement that varies with the machine.

---

# Finding 3 — the system models exactly one stack, and says so only at the schema

Target: `templates/schemas/project.schema.json`
Phase: 2 — scope, not mechanism. **No code change is proposed here.**

`protoolhub-main` cannot be connected, and the place that says so is
`stack.framework`:

    "framework": { "enum": ["nextjs-14-app-router", "nextjs-15-app-router"] }

The project is Vite 7 + React 19 in `client/`, Express 5 in `server/`, Drizzle ORM
+ `pg` in `shared/`, built by `tsx script/build.ts`, deployed from a `Dockerfile`
to Railway. No `next` dependency, no `next.config.*`, no `app/`. `state.mjs --init`
calls `assertValid()` and throws at connect step 4, before the baseline.

**This is correct behaviour and is recorded as correct.** The operator's
instruction stands and is the finding's conclusion: *do not widen the enum to make
this project fit.* A project the system cannot model must fail loudly at init,
which is exactly what it did. A `additionalProperties: false` schema with a closed
enum is the system refusing to hold a premise it cannot act on, and that is the
design working.

What is worth recording is everything *around* that refusal.

## The failure is loud in the wrong register

`init` throws a JSON-schema validation error — `stack.framework: must be equal to
one of the allowed values`. That is a true statement about a manifest field. The
true statement about the situation is *this system does not cover your stack*, and
nothing says it. The operator learns it at step 4 of an eight-step command, after
approving a manifest, from a schema validator.

The connect skill's step 1 is "Detect, do not assume". It detects the framework
correctly and has nowhere to put the answer.

## The pressure it creates, which is the real risk

The enum offers two values, neither true, and every downstream step depends on
picking one. `next-themes` is in `package.json` — a standalone theme library, no
Next.js required — and is exactly the kind of near-miss evidence that makes
`nextjs-15-app-router` feel supported. `stack.db` applies the same pressure:
the enum is `supabase-postgres | none`, so a real Postgres database must be
declared `none`, which silently switches off `supabase.rls_enabled` and leaves a
database-backed project with no row-level-security rule at all.

**A schema that offers only wrong answers is an invitation to write a false one**,
and the manifest is the file every rule, hook and CI run reads. The cost of the
false value is not the value: it is that `rulesFor()` keys off `standards.packs`,
so the wrong packs produce findings that land in a baseline which
`baselineInit()` will not let anyone regenerate.

The measured consequence of the two Next.js packs on this project: 471 findings
from `next.env_centralised` and `next.regex_no_template_literal`, of which 3 are
real; and 0 findings from the five rules that would matter for an Express +
Drizzle application, because no such rules exist.

## Two secondary observations, recorded here so they are not rediscovered

**The protected-environment arm is inert without Supabase.**
`risk-guard.mjs:456-470` builds its protected set from `environments.*.supabase_ref`
and compares MCP payloads against it. A project on Railway Postgres has no such
ref, so the arm is empty. Marking `prod` as `protected: true` with no ref then
trips doctor's v0.1.6 FAIL — *"This environment reads as protected and is not."*
The operator's only choices are a permanent doctor FAIL or declaring production
unprotected, which is false. Whatever guards the real production database, nothing
in this system currently sees.

**The deploy surface is provider-shaped, not `deploy.target`-shaped.** The manifest
supports Railway properly — `deploy.target`, `env_sources.runtime: railway-env`,
`$defs.environment.railway_project` — but `HARD_BLOCK` (`risk-guard.mjs:384-386`)
covers `railway up` and nothing else, against two Vercel forms plus eight Vercel
MCP denials. Uncovered: `railway redeploy`, `railway run`, `railway variables --set`,
`railway down`, `railway link`, `railway environment`. And the trigger differs in
kind — Railway deploys on push, so `git push origin main` *is* a production deploy,
and risk-guard's answer to a prod-branch push is `confirm()`, the inert
`deferToUser` of carried-forward item 7. What actually stops it is
`Bash(git push *)` in the settings `ask` list: the belt holds because the braces
were already known to be cut. Separately, the scaffold's KVKK and privacy pages
name Vercel as the hosting sub-processor in fixed prose — wrong for any Railway
project, in a legally load-bearing sentence.

Both should derive from `deploy.target` rather than being written once per
provider. That is the 0.1.5 shape again: a value spelled once, then propagated.

## The assertion Phase 2 owes

There is no check to write for "the system covers one stack" — it is a scope fact,
not a defect. What Phase 2 owes is an assertion on the **refusal**, because the
refusal is the only part that is mechanism:

1. **`init` on an unmodellable stack fails, and the message names the stack rather
   than the field.** Fixture: a manifest for a Vite + Express project. The
   assertion is on the *text* the operator receives — that it says the framework
   is not one this system models, and names the two it does. Negative control:
   the bare schema error must fail this assertion.
2. **When a pack is added, the enum and the pack list change together.** The
   0.1.13 `findingHeading`/`FINDING_RE` rule and the 0.1.14 `deriveReleaseSuite()`
   rule, applied to the stack table: framework values and the packs that serve
   them derive from one declaration, or a check fails when they disagree. Adding
   `nextjs-16-app-router` to the enum and to nothing else is the same two-lists,
   one-edit defect that made `check-pretag` narrower than `release.yml`.

---

# Finding 4 — the escalation channel cannot carry a finding about an unconnected project

Target: `scripts/retro.mjs`
Check: filed while filing findings 1–3.

**Recorded because it was produced by the act of filing the three findings above,
and suppressing it would be absurd in this repository.** It is **first in the
0.1.15 build order** — see the reasoning there. It was initially filed outside the
order as the smallest of the four; that was wrong, and the correction is the
finding's own argument turned on itself. The other three are defects in what the
checker reads. This one is the defect in whether anyone ever hears about them, and
it is the only one of the four whose failure mode is silent.

`retro --record` writes to `PATHS.lessons` — `.mavci/lessons/` — under
`projectRoot()`. That requires a connected project. Findings 1, 2 and 3 are all
*about* `protoolhub-main`, which has no `.mavci/` because the connect it would
have been created by is the thing that failed, and which must not be written to
in any case.

So the three findings the system's first contact with a real repository produced
had **no channel**, and reached `docs/lessons/` the same way the Gate 4c findings
did before 0.1.12: by hand, because someone chose to.

The exposure is precise, and it is the worst possible placement: **the escalation
channel is unavailable exactly during `/mavci-core:connect`** — before step 4
creates the control plane. That is the window in which the system is most likely
to be wrong about a repository, because it is the only window in which it is
meeting one it has never seen. Every finding above was found in that window.

0.1.12 recorded the rule that *"a reporting channel an agent cannot reach is the
trap"*, and built `--record` to be agent-reachable. It is reachable by caller and
unreachable by *state*: the agent has the authority and there is nowhere to write.

The change is a fallback target when no control plane exists — the system repo's
own `docs/lessons/`, or an explicit `--out` — and `--record` naming where it wrote.
The assertion is behavioural, per the 0.1.13 rule: run `--record` in a directory
with no `.mavci/`, and assert a findings file exists and `--list` enumerates it.
Against 0.1.14 that must fail. Asserting that `--record` *exits non-zero* today
would pass against both the broken build and a build that silently writes nowhere.

---

# Finding 5 — `supabase.rls_enabled` returns a pass on an empty input set

Target: `scripts/rules/index.mjs:365`
Check: `supabase.rls_enabled`
Found in: `AI-Chatbot-Widget-SaaS` — Next.js 14 + Supabase + Stripe, **live, taking
payment, multi-tenant.**

The rule collects `CREATE TABLE` statements from `supabase/migrations/*.sql` and
reports the ones never given `ENABLE ROW LEVEL SECURITY`. Measured against that
project:

    supabase/migrations/20250423120000_companies_stripe_billing.sql   CREATE TABLE: 0
    supabase/migrations/20260507135600_add_whatsapp_fields...sql      CREATE TABLE: 0
    ENABLE ROW LEVEL SECURITY anywhere:                               0
    CREATE POLICY anywhere:                                           0

    supabase.rls_enabled                                              0 findings — PASS

Both migrations are `ALTER TABLE public.companies ADD COLUMN`. The `companies`
table — the **tenant** table — was created in the Supabase dashboard, so it never
appears in a migration and the rule never sees it. `created` is empty, the filter
runs over nothing, and the rule returns `[]`, which `summarise()` scores as a pass.

Meanwhile the application constructs a service-role client
(`getSupabaseAdminClient()`) whose key bypasses RLS entirely, and nine server
modules use it.

**So the one rule in the system built to protect tenant isolation inspected an
empty set and reported green, on a live multi-tenant SaaS.**

## Why this is narrower and worse than invariant 5

Invariant 5 says *a failed probe is never reported as a pass* — "could not check"
is WARN or FAIL, never OK. This is a step past that. The probe did not fail. It
ran exactly as written, correctly, over its whole input, and its input was empty.
There is no error to report and no exception to catch. **A probe with nothing to
probe is not a passing probe**, and the current code cannot tell the difference
because it expresses both as `[]`.

That distinction is the finding. Invariant 5 is written about *failure*; this is
about *vacuity*, and vacuity is more dangerous precisely because nothing anywhere
looks wrong. A crashed rule leaves a stack trace. This one leaves a green tick.

**A green `supabase.rls_enabled` currently means: no migration created a table
without RLS. Every reader will understand it as: your tables are protected.**
Those are different claims, and the gap between them is the entire population of
projects whose schema was made in a console — which, on this stack, is most of
them.

## The change

1. **Report `NOT CHECKED` when no table definitions were found**, as a distinct
   status from `pass`. It must be visible in the verdict, in the CI annotation and
   in `doctor`, and it must not count toward the passing tally in `summarise()`.
2. **Say why, and say what is invisible.** The message names the fact that tables
   created through the Supabase dashboard or `psql` never appear in
   `supabase/migrations/`, and that this rule can only see tables it watched being
   created. A reader who has 40 tables and no migrations needs to be told the
   rule is structurally blind to all 40, not given a tick.
3. **Point at the check the operator can actually run**, since this is
   `authority: operator` territory — the rule cannot reach the database:
   `select relname, relrowsecurity from pg_class where relnamespace =
   'public'::regnamespace;`
4. Consider the same treatment for every rule with a filterable input set.
   `legal.kvkk_structure` already returns `[]` when the page is absent, deferring
   to `legal.pages_present`; that one is deliberate and correct because another
   rule covers it. The test is whether *something else* reports the gap. For
   `supabase.rls_enabled`, nothing does.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, and this assertion must be watched failing against
it first — it will, because 0.1.14 returns a clean pass here.

The fixture is the shape of the real project, which is the point:

    bad/   supabase/migrations/001_alter_only.sql   ALTER TABLE only, no CREATE
           -> status MUST be `not_checked`, MUST NOT be `pass`
    good/  supabase/migrations/001_create.sql       CREATE TABLE + ENABLE RLS
           -> status `pass`
    ugly/  supabase/migrations/001_create.sql       CREATE TABLE, no ENABLE RLS
           -> 1 finding, `fail`

**Assert on the status, not on the finding count.** A count of zero is what
`not_checked` and `pass` both produce, and asserting `findings.length === 0` for
the `bad/` tree passes against the build shipping today. That is the
adjacent-but-wrong assertion for this finding, and it is the obvious one to write.

Negative controls, each independent: reverting the status change makes only the
`bad/` assertion fail while `good/` and `ugly/` stay green; and a build that
returns `not_checked` for *every* input — including `good/` — must fail the
`good/` assertion. The second control matters because "always say not checked" is
a cheap way to make assertion one pass.

---

# Finding 6 — rules match literal strings where they should match meaning

Target: the rule set as a whole. **Recorded as a class, before its instances are
fixed.**

Six occurrences, two unrelated repositories, one axis. Each was found
independently, and each looked like its own small bug until the second project
produced the same shape in a different rule.

    .txt not in SCANNABLE_EXT              a live Google session cookie jar was
    config.mjs:256                         never opened by the credential scanner
                                           (protoolhub-main, public repo)

    .gitignore not read by walk()          470 of 478 findings came from a
    lib/fsx.mjs:123                        committed dependency cache
                                           (protoolhub-main)

    indexOf('SUPABASE_SERVICE_ROLE_KEY')   HEAD calls it SUPABASE_SERVICE_KEY, so
    rules/index.mjs:293                    a real service-role client is invisible
                                           (AI-Chatbot-Widget-SaaS, live)

    isApiRoute requires ^app/api/          app/widget.js/route.ts is the only route
    rules/index.mjs:74                     on disk missing force-dynamic, and the
                                           rule cannot see it

    ALLOWED = ^lib/supabase/server          lib/supabase.ts is server-only in fact
    rules/index.mjs:288                    and flagged on filename; the remedy is a
                                           rename that changes no behaviour

    path contains 'stripe' or 'webhook'    fired on a Checkout route that has no
    rules/index.mjs:346                    business verifying a signature, while
                                           both real webhooks pass

    conname matched unqualified            a migration's idempotency guard:
    (production SQL, not our code)         `if not exists (select 1 from
                                           pg_constraint where conname = 'x')`.
                                           pg_constraint names are unique per
                                           SCHEMA, not globally, so a same-named
                                           constraint anywhere else makes the
                                           guard skip and the constraint is
                                           silently never created

    add column if not exists <name>        matches the NAME, never the type. A
    (production SQL, not our code)         column of that name with a different
                                           type is left alone and the schema
                                           diverges from the file without
                                           complaint

**The last two are not ours, and that is the point.** They are guards in a
customer project's migration, written by someone else, and they fail the same
way: a name stands in for the thing it names. Five contexts, three projects, and
one of them is production SQL that will be re-run by whoever runs migrations
next. This is not a habit of one codebase — it is what checking is like when the
cheap handle for a property is its name, and it is why the fix for each instance
has to be judged by whether the *next* spelling would also be caught.

**The class statement, which is what must be recorded and carried into each fix:**

> A rule that matches one spelling of a thing is checking a spelling, not the
> thing. Every one of these rules is correct about the string it was given and
> wrong about the property it was asked to establish. The string is a *proxy* —
> for "this file might hold a credential", "this is not our code", "this is the
> service-role key", "this is a request handler", "this module never reaches the
> client", "this endpoint receives untrusted callbacks". In each case the proxy
> was cheap, defensible when written, and silently wrong the first time reality
> spelled the thing differently.

Two properties make this class specifically dangerous, and both are visible above:

**It fails silently and asymmetrically.** A proxy that is too narrow produces a
*pass* — the cookie jar, the service-role key, the missing `force-dynamic`. A
proxy that is too broad produces a false positive that gets baselined or waived
away — the Checkout route, `lib/supabase.ts`. Neither direction announces itself,
and the narrow direction is the one that ships credentials.

**The fix for the instance strengthens the proxy and leaves the axis.** Adding
`.txt` to the extension list does not make the scanner content-based; the next
credential arrives in a `.har`. Adding `SUPABASE_SERVICE_KEY` to the `indexOf`
does not make the rule value-aware; the next project reads it through a config
helper. **This is why the class is filed before the fixes** — so each fix is
written against "match the thing" and is judged by whether the *next* spelling
would also be caught.

## The change

No single patch. What this finding requires is that each of Findings 1, 2 and 5,
and the two remedies noted below, is written and reviewed against the class
statement, and that the reviewer asks one question of each: **would this catch the
same violation spelled a different way?**

The concrete sub-fix that belongs to this finding alone:
`next.no_service_role_client` must match the service-role key by **provenance**,
not by one identifier — at minimum both documented aliases
(`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`), and better, any env read
whose value flows into a Supabase client's key argument.

Two remedies to correct at the same time, because both instruct the reader to
strengthen a proxy:

- `next.no_service_role_client` says *"Move the reference into
  lib/supabase/server.ts"*. That is a rename. The mechanism Next.js actually
  enforces is `import 'server-only'`, which makes the guarantee real and which the
  rule does not recognise. The allow-list should accept it, and the remedy should
  name it.
- `stripe.webhook_signature` should select handlers by shape — a route reading a
  raw body and a `stripe-signature` header — not by whether `stripe` appears in
  the path.

## The assertion, and the broken build it must catch

The class cannot be asserted directly; its instances can, and each instance's
fixture must contain **the same violation spelled two ways**, with the alternative
spelling being the one that fails against today's build:

    Finding 1   credential in .txt AND in .json — both reported
    Finding 2   vendored tree that is gitignored AND one that is tracked — both excluded
    Finding 5   (input-set vacuity; asserted on status, see Finding 5)
    alias fix   SUPABASE_SERVICE_KEY at lib/supabase.ts AND SUPABASE_SERVICE_ROLE_KEY
                at the same path — both reported
    server-only lib/supabase.ts WITH `import 'server-only'` -> pass
                the identical file WITHOUT it -> reported
                (a path-shaped rule cannot distinguish these two; that is the test)

**The negative control for the class as a whole**: for each fixture pair, revert
the fix and confirm that the *original* spelling still passes while the
*alternative* fails. A fix that makes both spellings pass has widened the proxy
into a hole, which is the failure mode of a relaxation and the reason 0.1.12's
item 5 required both directions every time a control is loosened.

---

# Finding 7 — every number in a report describes the working tree; CI checks `HEAD`

Target: `scripts/doctor.mjs`

`collectFiles()` walks the filesystem. `git` is consulted in exactly one place —
`gitChangedFiles()`, for `--changed` scope — and never to establish what is
committed. So every finding count, every baseline entry and every verdict
describes the **working tree**: uncommitted modifications, untracked files, and
anything else sitting on disk. CI runs `actions/checkout` and sees `HEAD`.

Measured on `AI-Chatbot-Widget-SaaS`:

    tracked files                          36
    modified, uncommitted (since 2026-08-19)  20   820 insertions, 747 deletions
    untracked paths                            8   incl. a nested second checkout
                                                   of the same repository
    local branch                          master, no upstream
    remote default                        main — NO COMMON ANCESTOR with master
                                          (10 commits vs 6, unrelated roots)

**The demonstration is Finding 6's third instance, and it is exact.** At `HEAD`,
`lib/supabase.ts:6` reads `process.env.SUPABASE_SERVICE_KEY`. The working copy
changes it to `SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_KEY`. The string
`SUPABASE_SERVICE_ROLE_KEY` appears **nowhere at `HEAD`**. Therefore:

    local checker, working tree   ->  1 next.no_service_role_client finding
    CI, HEAD                      ->  0 findings

Same repository, same plugin version, same rule, opposite answers, and **neither
run says which tree it read.** A connect report handed to an operator is a
statement about a state that CI will never see and that may not survive the next
`git checkout`.

This is the same family as 0.1.13's *"a component that reports on others needs a
test that exercises it"*, one level out: a report that does not name its own
subject. It is also why the baseline risk is sharper than it looks —
`--baseline-init` runs **once, ever**, and a baseline taken over this tree records
entries against 20 modified and 8 untracked paths, some of which do not exist in
the repository at all.

## The change

1. **`doctor` reports the divergence and its size**: count of modified tracked
   files, count of untracked non-ignored paths, whether the current branch has an
   upstream, and the ahead/behind counts against it. WARN when any is non-zero.
2. **FAIL when a baseline is about to be written over a dirty tree**, or at
   minimum have `--baseline-init` refuse without an explicit override. This is the
   one place where the consequence is permanent and unrepeatable.
3. **Every verdict records which tree it describes** — a `tree` field carrying
   `HEAD` sha plus dirty/clean, so a local verdict and a CI verdict that disagree
   can be told apart afterwards instead of read as a flapping rule.
4. **The connect report names it**, because that is the report an operator acts on.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, which reports the same numbers for a clean and a
dirty tree and never mentions the difference.

Fixture: a git repository with a committed clean state, then (a) a tracked file
modified in place to introduce a violation, and (b) an untracked file added
carrying a different violation.

1. **`doctor` names both counts** — `1 modified`, `1 untracked` — not merely that
   the tree is dirty. *"The tree is dirty" is not a pointer*, the 0.1.13 rule
   again; the operator needs the size to judge it.
2. **The verdict's `tree` field distinguishes the two runs.** Assert the sha and
   the dirty flag, not that the field exists.
3. **`--baseline-init` refuses on the dirty tree and succeeds after commit.** This
   is the assertion that protects the once-ever operation, and it must be watched
   failing first: today it writes cheerfully.
4. **A clean tree produces no warning.** Negative control against the cheap fix of
   warning unconditionally, which would pass assertions 1–3 on every repository.

---

# Finding 8 — a permission error reads as absence, and it has already destroyed history

Target: `scripts/doctor.mjs` — `checkGhAccount`, plus a new check
Found in: `AI-Chatbot-Widget-SaaS`. **The evidence is the repository's own shape.**

## The evidence, which is not a hypothetical

`git merge-base master origin/main` returns **empty**. There is no common
ancestor. Three histories exist for one product, each with its own root commit,
all created on 2026-04-23, all pointing at the same remote URL:

    chatbot-saas/ (nested)   3 commits   13:37 → 14:38   root fb084ac "Initial commit"
    origin/main              6 commits   15:00 → 17:39   root f2242de "supabase entegrasyonu"
    master (local)          10 commits   22:19 → 00:56   root a09c77c "admin panel eklendi"

    last successful fetch of origin   22:18:25
    master's root commit              22:19:28          — 63 seconds later

**Sixty-three seconds.** The operator contacted the remote, could not get what
they needed from it, and started a new history from scratch. Then did it again.
The reading the operator gives, and the timestamps support, is that the repository
could not be found — the same 404 that today made a private-or-inaccessible repo
indistinguishable from a deleted one, and that `docs/lessons/` already records as
having *"nearly"* caused the system repository to be recreated.

It was not "nearly" here. It happened, twice, and the cost is that ten commits of
admin panel, Stripe billing, company registration and onboarding **exist on one
disk and have never been pushed anywhere**, while the remote holds an earlier,
unrelated line of work.

GitHub returns `404 Not Found` for a repository you may not see and for one that
does not exist, deliberately, so that private names cannot be enumerated. That is
correct of GitHub and catastrophic for a human reading it at 22:18. **Nothing in
git's or `gh`'s message mentions accounts**, and this machine holds two logged-in
identities plus a credential manager that may present a third.

## Why 0.1.13's fix does not cover this

`checkGhAccount` (0.1.13, finding 3) compares the active `gh` login against
`SYSTEM_REPO`'s owner and FAILs with wording that says outright it compared names
and cannot see whether some other account holds a collaborator grant. That check is
correct and it is **scoped to the system repository only**.

Every project has its own remote, under its own owner, and that is where the
operator actually works. The check was written for the repository the plugin lives
in, and the loss happened in the repository the plugin is meant to protect. Same
defect, one scope narrower than it needed to be — which is `check-pretag` being
narrower than `release.yml` (0.1.14) in a different file.

## The change

**A — widen the account check to the project's own remote.** For a connected
project, resolve `origin`'s owner from the remote URL and compare it against the
active `gh` login, exactly as `checkGhAccount` already does for `SYSTEM_REPO`.
FAIL with the same wording, and it must say the thing the operator needed at
22:18:

> This is a permission error, not absence. GitHub returns 404 both for a
> repository you cannot see and for one that does not exist. Do not recreate it.
> Authenticate as `<owner>` and look before concluding anything.

Two overclaims to avoid, inherited from 0.1.13 and still right: the remedy is
`gh auth login`, not `gh auth switch --user <owner>`, when the owner has never
authenticated on this machine — `switch` errors for an account that is not logged
in. And the failure must state that it compared names only and cannot see a
collaborator grant held by some other account.

**B — a project that exists on one disk must be said out loud.** A new check,
WARN or FAIL:

- the current branch has **no upstream**; or
- it has commits the remote does not have; or
- `merge-base` against the remote's default branch is **empty**, which is the
  strong signal — unrelated histories mean a restart happened, and a restart is
  the fingerprint of this exact failure.

Report the counts and the branch names, not merely that something is unpushed.
The empty-merge-base case should name the roots, because that is what makes the
restart legible as a restart rather than as ordinary drift.

**Together with Finding 7 this is one idea in three tiers.** What the checker
measures is the **working tree**; what CI builds is **`HEAD`**; what survives the
loss of a laptop is **the remote**. The system currently reports on the first and
has never mentioned the other two. A connect report that says "25 findings, 0
critical, baseline written" while ten commits have never left the machine is
accurate about the wrong universe.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, which says nothing in any of these cases. Both
halves must be watched failing first.

Fixtures are local git repositories with a fake remote; no network is required and
none should be used — a check that needs the network fails differently when
offline, and offline is exactly when an operator is most likely to be confused
about whether a repo exists.

    A1  origin owner != active gh login          -> FAIL, and the reason text
                                                    contains "permission error, not absence"
    A2  origin owner == active gh login          -> pass, no warning
    A3  no origin remote at all                  -> not an error; nothing to compare
    B1  branch with no upstream                  -> reported, naming the branch
    B2  upstream set, 3 commits ahead            -> reported, naming the count 3
    B3  merge-base with remote default is empty  -> reported AS A RESTART, naming both roots
    B4  branch fully pushed, upstream set        -> silent

Assertions and their negative controls:

1. **A1 asserts the wording, not just the FAIL.** The whole value of this check is
   the sentence that stops someone recreating a repository. A test that asserts
   only the status passes against a build that FAILs with "repository not found",
   which is the message that caused the loss. Negative control: replace the reason
   text and A1 alone must fail.
2. **B2 asserts the count.** "Something is unpushed" is not a pointer — the
   0.1.13 rule, third application in this file. Negative control: a build that
   reports the condition without the number must fail.
3. **B3 asserts the empty-merge-base case names both roots**, and is separate from
   B2. This is the assertion that distinguishes a real fix from the cheap one: a
   check that only counts "commits ahead" reports **10** for this project and says
   nothing about the fact that those 10 share no ancestry with the remote's 6.
   Ten-ahead is ordinary. Ten-ahead-with-no-common-ancestor is a restart, and only
   the second one would have caught this. Negative control: remove the merge-base
   branch and B3 fails while B2 stays green.
4. **B4 and A2 are the silence controls.** Without them the cheap implementation —
   warn on every repository — passes 1 through 3.

**A note on scoring this one.** The natural assertion to write is *"doctor FAILs
when the account is wrong"*, and it would have passed against a build that FAILs
for the wrong reason with the wrong text. The thing being protected here is not a
status code; it is whether a human at 22:18 reads the message and looks for the
repository instead of starting a new one. **Assert the sentence.**

---

# Finding 9 — no rule looks for a route that returns data with no auth check

Target: `scripts/rules/index.mjs` — a rule that does not exist
Found in: `AI-Chatbot-Widget-SaaS`

**Numbering note.** The operator filed these as 12 and 13 and referred to an
existing "Finding 9". There is no Finding 9 — this queue ran 1–8. The gap is mine:
the cross-tenant read was written into `docs/chatbot-widget-connect-plan.md` §0a as
a *project* note and never filed as a *system* finding, so the thing the operator
was pointing at had no number to point at. Filed here as 9 and 10.

## The instance that is real, and in production

`app/api/chat/route.ts`, at `HEAD` — which is what Vercel builds and therefore what
is live:

    "Access-Control-Allow-Origin": "*"              // any origin
    const companyId = body.companyId?.trim();       // from the request body
    // no session, no token, no origin check
    getSupabaseAdminClient()                        // service role — bypasses RLS
      .select("id, name, system_prompt, knowledge_base, plan, message_count, ...")
      .eq("id", companyId)

Any caller, any origin, any company id → an answer generated from that tenant's
knowledge base, a row written to that tenant's `conversations`, and that tenant's
message counter incremented. The ids are public by design: the widget reads
`companyId` from its own script URL, so every customer's id is in the page source
of every site embedding it.

**Twenty-five findings, and this is not among them.** `supabase.rls_enabled`
passed on an empty input set (Finding 5). `next.route_force_dynamic` passed.
`next.no_service_role_client` fired on `lib/supabase.ts` for client-bundle
exposure — the wrong risk, at the wrong file. Nothing in the rule set asks the
question that matters: *does this handler return tenant-scoped data without
establishing who is asking?*

## What this finding does NOT claim, and why the correction is recorded

The operator's filing described a second instance — `app/api/debug/route.ts`
returning tenant ids, names, the Supabase URL and which credential vars are set —
as "live in production". **It is not.** That version exists only in the
uncommitted working tree. `HEAD`'s `app/api/debug/route.ts` is four lines of body
and returns `{ jwtSecret: 'VAR'|'YOK', adminToken: <caller's own cookie, first 20
chars> }`. That is the caller's *own* token, not another tenant's, and a
configuration oracle rather than a data leak. Worth deleting — it has no product
function — but it is not a second instance of this finding.

That correction is itself the evidence for Finding 10, and it is the second time in
two turns the same error was made. **So this finding rests on one production
instance, not two.** One is enough: the rule class is missing either way, and a
finding that overstates its evidence is the thing this queue exists to prevent.

## The change

A rule — call it `next.unauthenticated_tenant_read` — that flags an
`app/api/**/route.ts` which reaches a database client **and** derives its scoping
identifier from the request body, query string or an unvalidated header, **and**
performs no recognised authentication (no session read, no token verification, no
`authorization` header check). `checks.public_routes` already exists in the
manifest schema, described as *"API routes intentionally reachable without auth"*,
and is currently read by nothing — it is the exemption list this rule needs,
already specified and never wired up.

Severity `blocker`, not `critical`: a legitimately public endpoint exists and the
exemption must be declarable.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, which reports nothing here.

    bad/   route reads body.companyId -> db query, no auth        -> 1 finding
    bad/   same, but id from a query param                        -> 1 finding
    good/  same shape, id derived from a verified session         -> 0
    good/  bad/ shape, but listed in checks.public_routes         -> 0

Assert the **exemption path** as hard as the detection path: a rule whose
`public_routes` branch is untested is `settings.marketplace_form` before 0.1.5 —
a manifest field that looks load-bearing and is read by nothing. Negative control:
remove the `public_routes` lookup and the fourth case alone must fail.

---

# Finding 10 — a security report must state what leaves the system, by which path, and from which tree

Target: `agent-defs/_contract.md`, and the `mavci-verifier` contract

Twice in two turns, a security claim was reported from a partial reading:

1. *"The route returns the tenant's `system_prompt` and `knowledge_base`."* It does
   not. Those are selected and used server-side to build the model's system prompt,
   then discarded; the response is `{ reply, company: { id, name } }`. The claim came
   from reading the `select` and stopping before the `return` 70 lines later.
2. *"The debug endpoint returns tenant ids and names, live in production."* That is
   the **uncommitted working tree**. Production runs `HEAD`, where the same file
   returns a configuration oracle and the caller's own token prefix.

Neither error was harmful on its own, and the second was caught before filing. But
the operator acted on the first: two changes were authorised as security fixes, and
**both were void** — one a no-op against a field that was never returned, one
impossible against a column that does not exist. Work was scheduled on a false
premise, and the premise came from a confident report.

**The two errors are one error.** Both reported a *fragment* — a `select` clause, a
working-tree file — as though it were the *system's behaviour*. The first stopped
early in a file; the second stopped early in the repository.

## The rule for the contract

> A security finding is not reportable until you can state **what data leaves the
> system, by which path, to whom** — and **which tree you are describing**. Read
> the handler to its return statements before characterising a disclosure: what is
> queried is not what is returned. Establish whether the code you are reading is
> committed, pushed and deployed before calling anything "live in production";
> `HEAD` is what CI builds and what ships, and the working tree is neither.
> Report the exit path, not the alarming line in the middle of a handler.

This is Finding 7 promoted from a `doctor` check into an agent obligation. 7 makes
the divergence *visible*; 10 makes it the reporter's job to *look* — because
`doctor` will not have run at the moment an agent is reading a file and forming a
claim.

## The assertion, and the broken build it must catch

`check-agent-contracts.mjs` asserts the clause is present in `_contract.md` and in
every generated agent that can report a security finding — the same shape as
`check-remedy-authority.mjs`, which asserts an `AUTHORITY:` marker exists and names
an actor. A contract clause nothing checks is prose, and prose is what this system
replaces with checks.

The behavioural half cannot be asserted mechanically, and saying so is part of the
finding: no fixture proves an agent read to the end of a file. What can be asserted
is that the obligation is *stated*, in the contract, in the words above. The rest
is what Finding 9's rule is for — which is the correct division, and the reason 9
is the finding with code attached and 10 is the finding with a sentence attached.

---

# Finding 11 — the rule set checks file properties; nothing checks what a route does

Target: `scripts/rules/index.mjs`. **Widens Finding 9 from one missing rule to a
missing category.**

A four-month, 821/748-line uncommitted diff in `AI-Chatbot-Widget-SaaS` was
reviewed by hand. Every defect below was found by reading. **Thirteen rules found
none of them**, and could not have:

    unauthenticated route resolving its tenant as "most recent signup"
      -> telegram/setup attaches a caller-supplied bot token to that company
      -> telegram/subscribe opens a Stripe checkout for that company
    a metering control deleted end to end
      -> FREE_MESSAGE_LIMIT and every message_count read/write, no replacement
    two webhook routes writing different columns for one fact
      -> `plan` vs `is_subscribed`; `is_subscribed` is read by nothing
    an orphaned duplicate route
      -> app/widget.js/route.ts, superseded, still served
    a dependency added and never imported
      -> @supabase/ssr

The thirteen rules ask: does this file export a constant, sit at this path,
contain this string, match this schema. **Not one asks what a handler does with a
request.** They are lint rules with a security vocabulary.

## The distinction that matters, because it bounds the fix

`legal.pages_present` asks *does this file exist*. `next.route_force_dynamic` asks
*does this file contain this export*. Both are decidable by looking at one file
with no understanding of behaviour, which is why they are cheap and why they hold.

Everything in the list above requires following a value: where does this
identifier come from, is it attacker-controlled, what authority does the client
carry, does anything read this column. That is dataflow, not pattern-matching, and
pretending otherwise produces the `stripe.webhook_signature` failure — a rule that
matched the substring `stripe` in a path, fired on a Checkout route, and missed
nothing because both real webhook handlers were already correct.

**So the fix is not "more rules of the same kind."** It is a small number of rules
that follow a value from a request to a database call — Finding 9's
`next.unauthenticated_tenant_read` is the first and the template — plus an honest
statement of the boundary. A checker that cannot see behaviour must **say** it
cannot, or a green run reads as "this code is safe" when it means "these files are
shaped correctly."

## The change

1. Build Finding 9's rule as the first behavioural rule, and treat it as the
   pattern for two or three more, not as a one-off.
2. **State the boundary in the verdict.** The summary line must distinguish
   *checks that ran* from *properties nobody checks*. `doctor` and the connect
   report should carry one sentence: this rule set verifies file-level structure
   and does not analyse request handling; a pass is not a security review.
3. Candidates in priority order, each provoked by real code in this project:
   tenant identifier from an unvalidated request field reaching a DB call
   (Finding 9); a column written but never read; two routes handling the same
   external event; a route with no inbound reference in the tree.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14, which reports 25 findings on a codebase containing
all five defects above and names none of them.**

The fixture is a miniature of this project: a handler taking `companyId` from the
body, a `.order('created_at').limit(1)` tenant selection, a column written by one
route and read by none, and a duplicate route for one event.

1. Each behavioural rule reports its own defect and **no other rule reports it**.
   A rule that fires on all four is pattern-matching again.
2. **The boundary sentence is present in the verdict output.** Assert the text.
   This is the assertion most likely to be dropped as cosmetic, and it is the one
   that stops a green run being read as a clearance.
3. Negative control: a correct handler — identifier from a verified session —
   produces zero findings. Without this, "flag every handler that touches the
   database" passes assertion 1.

**Do not assert a total finding count.** 0.1.14 already produces 25 on this
codebase. Count is what makes this class invisible: the number looked healthy the
entire time.

---

# Finding 12 — the checker cannot see uncommitted work, and that is where the worst code was

Target: `scripts/doctor.mjs`, `scripts/state.mjs` (`baselineInit`).
**Sharpens Finding 7 from "report the divergence" to "refuse to certify across it."**

Measured in `AI-Chatbot-Widget-SaaS`:

    tracked, committed at HEAD          36 files   <- what CI builds, what deploys
    modified, uncommitted               20 files   821 insertions, 748 deletions
    untracked                            8 paths   incl. 4 unreviewed API routes

The two most serious defects in the entire project — `telegram/setup` and
`telegram/subscribe`, unauthenticated and writing to an arbitrary tenant — are in
the **untracked** set. They are not at `HEAD`. A connect run today baselines
`HEAD`, reports 25 findings, writes `baseline_debt: 25`, and describes a
repository that exists on no developer's disk and contains none of the code the
team is actually about to ship.

Finding 7 asked `doctor` to *report* the gap. This finding says that is not
enough, because `--baseline-init` **runs once, ever**. A baseline taken across a
material divergence is not merely inaccurate; it is permanently inaccurate, and it
is the artefact every later run compares against. The one irreversible operation
in the system is the one currently allowed to run against an unrepresentative
tree.

## The change

1. `doctor` reports the distance: modified count, untracked count, insertions and
   deletions, and whether the branch has an upstream. WARN on any non-zero.
2. **`--baseline-init` refuses on a materially dirty tree**, naming the counts and
   requiring either a commit or an explicit acknowledgement flag. "Materially" has
   to be defined and defensible — a single modified file is not the same as 20
   files and 8 untracked routes — and the threshold must be stated in the refusal,
   not hidden.
3. The connect report states which tree it describes, in the same sentence as the
   finding count. "25 findings" is not a fact about a project; it is a fact about
   a tree.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, where `--baseline-init` writes cheerfully over any
tree and says nothing.

    clean tree                      -> baseline written, no warning
    1 modified file                 -> baseline written, warning names it
    20 modified + 8 untracked       -> REFUSED, message names both counts
    same, with the acknowledge flag -> written, and the baseline records that it
                                       was taken over a dirty tree

1. Assert the **refusal**, not the warning. A build that warns and proceeds passes
   a warning-only assertion and still writes the permanent artefact.
2. Assert the acknowledgement is **recorded in `baseline.json`**. A baseline taken
   knowingly over a dirty tree must say so forever, because the once-ever
   constraint means nobody can retake it to find out.
3. Negative control: a clean tree must produce no warning and no refusal —
   otherwise "always refuse" passes 1 and 2.

## Addendum — "not committed" is not evidence of "not shipped"

Found after the above was written, by probing the live host. **The premise of
this finding was itself too weak.** It assumed `HEAD` is what deploys. In
`AI-Chatbot-Widget-SaaS`, `HEAD` is not what deploys: Vercel serves a **CLI
upload** (`.vercel/project.json` present), and `vercel --prod` ships the working
directory, untracked files included.

    GET /api/debug          -> {supabaseUrl, hasServiceRoleKey, hasServiceKey,
                                hasAnthropicKey, data:[3 companies], error}
                               = the WORKING-TREE version.
                               HEAD's returns {jwtSecret, adminToken}.
    GET /api/telegram/setup -> 405 (exists) — and that file is in NO git ref.

So the untracked, unauthenticated routes were not *pending*; they were **live**,
along with the deleted rate limit. The reviewer had told the operator the
`/api/debug` tenant-enumeration leak was *not* in production. It was.

**That is the third instance of the working-tree/`HEAD` confusion in one
engagement, and the first in the dangerous direction.** The first two overstated a
risk; this one understated one, and an operator planning a remediation was told a
live unauthenticated endpoint was merely queued. An error that resolves toward
"safer than it is" is worth more than the two that resolved the other way,
because nothing downstream corrects it — an overstatement gets challenged when
someone looks, and an understatement gets filed as handled.

### The rule, and the method that proved it

> An agent asserting what is **deployed** must establish it from the **deployed
> artefact**, not from any git ref. On a platform with CLI deploys, "not
> committed" is not evidence of "not shipped", and neither is "not on the default
> branch". Fetch the running system and compare its behaviour against the
> candidate trees.

The method is the assertion: production was proved by `GET`. Two public,
unauthenticated requests distinguished the trees definitively — one route whose
**response shape** differs between `HEAD` and the working tree, and one route that
**exists in only one** of them. That is repeatable, needs no credentials, and is
cheap enough that there is no excuse for asserting deployment state without it.

This belongs in Finding 10's contract clause as well: the clause already says
"establish which tree you are describing", and must add that the deployed tree is
a fourth thing — distinct from working tree, `HEAD`, and remote — established only
by observation.

### What this adds to the change

`doctor` cannot see a CLI deploy either, and must not imply otherwise. Where a
deploy target is declared in the manifest, `doctor` should either verify the
running artefact or **state plainly that it cannot**, rather than reporting on
`HEAD` as though `HEAD` were live. Invariant 5: an unchecked control is not a
working control, and an unobserved deployment is not a known deployment.

---

# Finding 13 — the deploy platform has the same account ambiguity, one layer out

Target: `scripts/doctor.mjs`. **Finding 8's shape, moved from the git host to the
deploy host.**

Finding 8 is: a permission error reads as absence, GitHub returns 404 for both,
nothing mentions accounts, and it cost this operator a codebase's history. The
same machine carries **four GitHub accounts and at least three Vercel accounts**,
and the deploy platform reproduces the defect with a different message.

`.vercel/project.json` is committed-adjacent config binding the directory to a
fixed `orgId`:

    {"projectId":"prj_Aa6…","orgId":"team_Y2d8…","projectName":"ai-chatbot-widget-saa-s"}

If the CLI's authenticated account does not belong to that org, Vercel answers
**"Could not retrieve Project Settings"** — which reads as a broken or stale link
and invites the fix of deleting `.vercel/` and re-linking. Re-linking while
signed in as the wrong account creates a **second project under the wrong org**,
and the deploy silently goes somewhere nobody is looking. That is Finding 8's
"nearly recreated a repository" with the noun changed.

The message is worse than GitHub's 404 in one respect: a 404 at least sounds like
absence. *"Could not retrieve Project Settings"* sounds like a corrupted local
file, and the local file is the thing it invites you to destroy — and that file is
the only record of which org the project belongs to.

**And the printed remedy is itself the hazard.** Vercel's own guidance on that
error is *"Remove the .vercel directory and deploy again"* — an instruction to
delete the only record of which org owns the project, issued at the exact moment
the operator is signed in as the wrong account. Follow it, and the re-link creates
a **second project under the wrong org**: the deploy succeeds, reports success,
and serves an application nobody is watching, while the real project sits
untouched. The platform's remedy is correct for the fault it names and
catastrophic for the fault that is actually present, and the two are
indistinguishable from the message.

That is what fixes the timing of this check. It is not enough for `doctor` to
explain the mismatch afterwards — **it has to fire before the operator reads that
sentence**, because the sentence is a documented, confident, official instruction
and it will win. This is the same shape as 0.1.12's item 6, where a check's own
remedy text sanctioned the cheap wrong path; here the sanctioning text belongs to
someone else and cannot be edited, so the only available control is to arrive
first.

## The change

`doctor` compares the CLI's authenticated account against the `orgId` in
`.vercel/project.json` and reports plainly which account owns the project and
which is logged in. On mismatch, **FAIL**, and the message must say: this is an
account mismatch, not a broken link; do not delete `.vercel/` and do not re-link;
switch accounts.

Same two restraints as Finding 8's git half. The remedy is `vercel login`, not
`vercel switch`, when the owning account has never authenticated on this machine.
And the check must state it compared an account against an org id and cannot see
whether some other account holds a team membership granting access.

Where the deploy target is `vercel`, `doctor` should also report **how the project
actually deploys** — this project has no git integration connected and every
deployment for 115 days was a CLI upload, which is why Finding 12's addendum
exists. A `doctor` that reports on `HEAD` while the platform ships a CLI artefact
is reporting on the wrong tree, confidently.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, which does not look at `.vercel/` at all.

    orgId matches the CLI account       -> pass, names the org
    orgId does not match                -> FAIL, and the reason contains
                                           "account mismatch, not a broken link"
                                           and "do not delete .vercel"
    no .vercel/project.json             -> not an error; nothing to compare
    .vercel present, CLI not logged in  -> WARN naming `vercel login`, not `switch`

Assert the **wording** of case 2, as in Finding 8: a FAIL that says "could not
retrieve project settings" is the message that causes the damage, and a
status-only assertion passes against it. Negative control: case 1 must produce no
warning, or "always warn" passes the rest.

---

# Finding 14 — when a diff shows a milder thing than what ran, the message must say so

Target: `agent-defs/_contract.md`. **Finding 12's shape as a commit convention
rather than a checker rule.**

Commit `d80c6c5` deletes `app/api/debug/route.ts`. The diff shows 11 lines that
return whether `ADMIN_JWT_SECRET` is set and the first 20 characters of the
caller's own session cookie — a configuration oracle, mildly embarrassing, not
serious.

**That is not what was running.** Production served a CLI upload of the working
tree, whose version of the same file returned the Supabase project URL, which
credential variables are set, and the id and name of up to five companies:
unauthenticated tenant enumeration. The severe version was never committed, so it
appears in no diff, and deleting the file removes it from the deployed artefact
without leaving any trace of what was removed.

A future reader doing the obvious thing — `git log` the security fix, read the
diff — concludes the endpoint was harmless. **The permanent record would preserve
exactly the confusion that caused the incident**, and it would do so in the one
artefact everyone trusts to be the history.

## The rule for the contract

> When the diff of a commit shows a **milder** version of the thing being changed
> than what was actually running, the commit message must describe **both**: what
> the diff shows, and what was live. State which tree each version came from. A
> diff is evidence about a git ref, never about production, and on a platform with
> CLI deploys those routinely differ.

The general form, which is why this is a convention and not a one-off: **the diff
is not the change.** The diff is the change *to the repository*. When the
repository and the running system have diverged, a commit records the first and is
routinely read as the second. Every fix landed while that divergence exists needs
the message to close the gap, because the code cannot.

This is Finding 12 one layer further out. 12 says a reporter must establish which
tree it describes. 14 says the *record* must too, and for longer — a report is
read once, a commit message is read by whoever is trying to understand this
decision in two years, with the working tree that produced it long gone.

## The assertion, and the broken build it must catch

There is no fixture for a habit, and pretending otherwise is how a convention
becomes decoration. What is checkable is the same as Finding 10:
`check-agent-contracts.mjs` asserts the clause is present in `_contract.md` and in
every generated agent that can author a commit, alongside Finding 10's clause,
with the same negative control — delete the clause and exactly that assertion
fails.

**The broken build for the behaviour is `d80c6c5` written the obvious way**: a
one-line subject and a diff, describing a config oracle, in a repository where the
live version leaked tenant data. That commit would have passed review, read
correctly, and been wrong about the only thing that mattered.

---

# Finding 15 — verifying one direction of a dependency is not verifying the dependency

Target: `agent-defs/_contract.md`. **The working-tree/`HEAD` class, in a new
costume: a true statement about one side taken as a statement about both.**

Splitting an uncommitted change into commits, the reviewer checked whether commit
(a) could precede commit (c). It could not: (a)'s files import `signAdminToken`,
which does not exist at `HEAD`. **An ordering was then recommended on that
evidence alone** — (c) first, then (a) — and the operator accepted it.

The reverse had not been checked, and it fails too. `HEAD`'s `verifyAdminToken` is
`async` and throws; the replacement is synchronous and returns `null`. Six
`HEAD`-side callers destructure the result directly, so (c) landing first produces
**seven type errors**:

    billing/page.tsx(30,17)          TS2531  Object is possibly 'null'
    billing/page.tsx(71,17)          TS18047 'authPayload' is possibly 'null'
    dashboard/page.tsx(28,15)        TS18047
    settings/page.tsx(24,15)         TS18047
    admin/company/route.ts(11,12)    TS18047
    onboarding/complete(67,13)       TS2339  'companyId' does not exist on '… | null'
    stripe/checkout(13,13)           TS2339

The two commits are **mutually** dependent. No ordering of them builds, and the
recommendation was impossible in both directions — which one direction of evidence
could not reveal and confidently appeared to settle.

## Why this is the same defect as the working-tree/`HEAD` errors

Each of those was a true observation about one thing, reported as a fact about
another: the `select` clause read as the response; `HEAD` read as production; a
committed file read as the deployed artefact. Here it is `(a) requires (c)` read
as `(c) then (a) works`. **A dependency is a relation, and checking it in one
direction establishes half of it.** The failure is not carelessness about the
facts — every individual finding was correct — it is treating an asymmetric check
as a symmetric conclusion.

That generalises past commit ordering, which is why it is filed separately from
Finding 14: any claim of the form *X works with Y* needs both directions
established, or the claim needs narrowing to the direction actually tested.

## The rule for the contract

> Before asserting that a proposed commit or commit ordering builds, **build it**.
> A throwaway `git worktree` at the target ref, with the candidate files copied in
> and the project's own typecheck run, settles it in under a minute. Reasoning
> about import graphs is a hypothesis, not evidence, and it is weakest exactly
> where it feels strongest — when one direction has just been checked and found
> conclusive.

The method is cheap enough that there is no case for skipping it:

    git worktree add --detach ../probe <ref>
    cp <candidate files> ../probe/…      # link node_modules if absent
    npx tsc --noEmit                      # or the project's build
    git worktree remove --force ../probe

It touches nothing: the working tree keeps its uncommitted state, no index is
staged, no branch moves. That is the same property that made it the right tool for
the security hotfix, where the concern was protecting four months of uncommitted
work rather than proving a build.

## The assertion, and the broken build it must catch

As with Findings 10 and 14, the behavioural half is a habit and no fixture proves
it. `check-agent-contracts.mjs` asserts the clause is present in `_contract.md`
and in every agent that can author or order commits, with the same negative
control.

**The broken build for the behaviour is the recommendation itself**: a confident,
well-argued, evidence-backed ordering that could not compile in either direction,
produced by an agent that had run exactly one of the two available checks.

---

# Finding 16 — a migrations directory describes intent, and is read as describing the database

Target: `scripts/rules/index.mjs` (`supabase.rls_enabled`), `scripts/doctor.mjs`

`supabase.rls_enabled` reads `supabase/migrations/*.sql`, collects `CREATE TABLE`,
and reports which tables never got `ENABLE ROW LEVEL SECURITY`. That is only
meaningful if the directory describes the database. **It describes what someone
intended to apply, and nothing records whether it was.**

## `AI-Chatbot-Widget-SaaS` is the proof, and it fails in three directions at once

    2 migration files in the repository
    0 CREATE TABLE among them          -> Finding 5: the rule passes on an empty set
    the `companies` table              -> created out of band, in no migration
    whatsapp_access_token,
    whatsapp_active,
    whatsapp_verify_token,
    whatsapp_phone_number_id           -> four columns the LIVE code depends on,
                                          created by no migration in the repo
    whatsapp_number,
    whatsapp_company_id                -> the one migration that does add columns
                                          adds these, which NOTHING in the code uses
    application status                 -> cannot be determined from inside the repo

So the directory omits the schema the application actually runs on, contains
schema the application does not use, and offers no way to tell which of it is
live. Every one of those is invisible to the checker, which reads the files and
reports on them as though they were the database.

**And the inference that looks safe is unsafe.** WhatsApp is live and working, so
the migration adding WhatsApp columns must have been applied — except the columns
the feature uses and the columns the migration adds are **disjoint sets**. The
working feature is evidence about four other columns. An agent reasoning from
"the feature works" to "the migration ran" reaches a confident wrong answer, and
would then treat the file as safely applied.

## Why "no ledger" is the load-bearing part

Supabase's CLI keeps a `supabase_migrations.schema_migrations` ledger when
migrations are applied through it. This project's schema was built in the
dashboard, so there is no ledger and no `supabase/config.toml` workflow — the
files are documentation someone wrote alongside changes they made by hand.

The consequence is precise: **the only safe action for whoever runs migrations
next is to read every file and check the live schema by hand.** That is the state
a checker is supposed to remove, and this one currently adds to it — a green
`supabase.rls_enabled` on a project in exactly this state reads as reassurance.

## The change

1. **`doctor` reports applied status as UNKNOWN rather than staying silent.** When
   `supabase/migrations/` is non-empty, doctor states that it cannot determine
   which have been applied, and names what would settle it: the Supabase CLI's
   ledger table, or `information_schema.columns` in the dashboard. Silence here
   reads as "fine".
2. **Detect the ledger and say which regime the project is in.** If migrations are
   applied through the CLI, a ledger exists and can be compared against the
   directory — report drift in both directions (a file never applied; an applied
   migration with no file). If no ledger exists, say *that*, because it is the
   more dangerous state and it is the one nothing currently mentions.
3. **`supabase.rls_enabled` must not imply the directory is the schema.** Its
   Finding 5 `NOT CHECKED` status needs to say why: no table definitions were
   found *and* the directory is not known to describe the live database.
4. Do not attempt to read the production schema from the checker. It has no
   credentials and must not acquire any; `doctor` reports the gap and names the
   command a human runs.

## The assertion, and the broken build it must catch

**The broken build is 0.1.14**, which reads two migration files, finds no
`CREATE TABLE`, reports a clean pass, and says nothing about application status.

    migrations present, no ledger     -> doctor reports UNKNOWN, names the two
                                         ways to settle it
    migrations present, ledger present,
      one file unapplied              -> reports the file by name
    ledger has an entry with no file  -> reports that too (drift is bidirectional)
    no migrations directory           -> silent; nothing to say

1. Assert doctor **names what would settle it**. A message saying "applied status
   unknown" and stopping is the "something is queued somewhere" defect from
   0.1.13 — not a pointer.
2. Assert **both** drift directions in case 2/3. A check that only finds unapplied
   files misses schema that exists and is undocumented, which is precisely this
   project's condition and the more common one.
3. Negative control: case 4 must be silent, or "always warn about migrations"
   passes 1 and 2.

---

# Finding 17 — a closed enum with no honest value is pressure to write a false one

Target: `templates/schemas/project.schema.json`, `scripts/rules/index.mjs`
**Second instance in two projects. Filed as the class, with the instance.**

## The class

`additionalProperties: false` plus a closed enum is the schema refusing to hold a
premise it cannot act on, and that is correct — Finding 3 records it working as
designed when ProToolHub's Vite + Express stack could not be described by
`stack.framework`. But the same construction has a second effect that is not a
design intent:

> When a closed enum offers no honest value, every downstream step still needs
> one. The operator is not choosing between right and wrong; they are choosing
> which wrong value to write into the file that every rule, hook and CI run
> reads. The pressure is structural, it is applied at exactly the moment someone
> wants to get on with the work, and the resulting false value is invisible
> afterwards because the schema validates it.

Two instances now, in two unrelated projects, in two different fields:

    stack.framework   ProToolHub is Vite+React+Express. The enum offers two
                      Next.js values. `next-themes` in package.json is the
                      near-miss evidence that makes the wrong one feel supported.

    tenancy.model     AI-Chatbot-Widget-SaaS is shared-schema and multi-tenant,
                      and its isolation is application-code filters under a
                      service-role key. The enum offers shared-schema-rls,
                      schema-per-tenant, single-tenant. None is true.

The first was caught because `--init` refused. **The second would not be caught by
anything**: `shared-schema-rls` validates, and nothing anywhere checks whether RLS
is what is actually enforcing isolation.

## The instance, and why it is the common case rather than an exotic one

`tenancy.model: shared-schema-rls` asserts that row level security is the
isolation mechanism. In this project all eight data-touching routes go through
`getSupabaseAdminClient()`, whose service-role key **bypasses RLS by design**.
Isolation is `.eq("id", companyId)` written by hand in each handler. Even if RLS
turns out to be enabled on every table, it is not what protects these paths.

**This is the ordinary shape of a Supabase application, not an edge case.** Any
project that reaches its data through a service-role client — which is what you
get the moment you need to read across users, run a webhook handler, or serve an
unauthenticated widget — is in exactly this position. The system currently has no
way to say so, and its most important rule (`supabase.rls_enabled`) is written as
though RLS were always the mechanism.

## The proposed value, and the design mistake underneath it

The enum conflates two orthogonal axes into one token. `shared-schema-rls` is
*schema shape* **and** *enforcement mechanism*. Splitting them fixes the instance
and the class together:

    tenancy: {
      model:         'shared-schema' | 'schema-per-tenant' | 'single-tenant',
      isolation:     'rls' | 'application-filters' | 'none',
      tenant_column: string
    }

    shared-schema-rls  ->  { model: 'shared-schema', isolation: 'rls' }

This is a breaking schema change under `additionalProperties: false` and needs a
migration or a one-version allowance, exactly as the `active_task` removal does
(CLAUDE.md carried-forward item 5). It should ride with that one.

### What it would imply for the rules

1. **`supabase.rls_enabled` becomes conditional.** It should run when
   `isolation === 'rls'` and not otherwise. Today it runs whenever the Supabase
   pack is enabled and returns a pass on an empty input set (Finding 5) — on a
   project where RLS is not the mechanism, that pass is meaningless twice over.
2. **THE RULE: a declaration of weaker enforcement turns on MORE checking, never
   less.**

   > `isolation: 'application-filters'` declares that there is no database
   > backstop. One missing `.eq()` is then a cross-tenant breach with nothing
   > behind it. A project that declares it must be checked **harder** than one
   > declaring `isolation: 'rls'` — the filter-presence rule becomes mandatory,
   > `doctor` states plainly that no database backstop exists, and the risk guard
   > treats data-path edits as deserving more care rather than less.

   This is written as a rule and not as a note because **every reader will assume
   the opposite.** Declared values normally narrow what runs: a pack you did not
   enable does not run, a framework you did not declare is not checked. The
   natural reading of `isolation: 'application-filters'` is therefore "RLS checks
   are off here", and the natural implementation is a subtraction. That reading is
   exactly backwards, and it would ship as an optimisation.

   The general form, worth carrying past this field: **a manifest value that
   describes a weaker control is a request for more scrutiny, not a smaller
   ruleset.** Anywhere the schema lets a project declare that it has less
   protection, the correct response is more checking of what remains — otherwise
   the schema hands every project a switch that quietly turns the checker down,
   and the projects that most need checking are the ones that flip it.
3. **It unlocks the question that actually matters here** — does every
   service-role query carry a tenant filter? — because the manifest would finally
   name the tenant column *and* say that filters are the mechanism.

## Is that question checkable? Honestly: half of it

This is Findings 9 and 11 made concrete, and the answer splits cleanly.

**The syntactic half IS a rule, and it is worth building.** Find the identifier
assigned from `getSupabaseAdminClient()`, find `.from("<table>")` builder chains
on it, and require the chain to contain an `.eq(<tenant_column>, …)` — or a
documented exemption. That catches the catastrophic case: a `.select()`,
`.update()` or `.delete()` on a tenant table with **no tenant predicate at all**,
which reads or writes every tenant's rows. It needs no dataflow, only the chain
and the manifest's `tenant_column`, and the false-positive surface is small
because it is scoped to chains rooted at the admin client.

**The provenance half is NOT a rule, and I do not think it can be made one here.**
The bug that actually happened in this project is:

    const companyId = body.companyId?.trim();   // from the request body
    …
      .eq("id", companyId)                      // filter present, and useless

The filter is there. The rule above passes. What makes it a vulnerability is
*where `companyId` came from*, and answering that means tracing an identifier back
to its origin and classifying the origin as trusted (a verified token) or
untrusted (body, query string, header). That is taint analysis, and:

- **It needs a real parser.** `lib/jsscan.mjs` says of itself, in its own header,
  *"Not a parser. It only needs to know where code is not."* It blanks strings and
  comments so regexes stop lying. Building a taint lattice on it is building on
  sand, and 0.1.12 already recorded it misreading a backtick inside a regex
  literal.
- **A parser breaks invariant 1.** `plugins/mavci-core/scripts/` has **zero**
  third-party imports today, verified. Parsing TS/TSX means `typescript`,
  `@babel/parser` or `acorn` plus a JSX/TS plugin. That is not a dependency the
  escape hatch survives — `selftest.yml` runs the checker with Claude Code absent
  and nothing installed, and that property is what makes ARCHITECTURE §11 a
  passing test rather than a promise.
- **Intra-procedural would cover this codebase and not the next one.** Handlers
  here are self-contained: the read and the `.eq()` are twenty lines apart in one
  function. The moment an id passes through a helper, or arrives already
  destructured, the analysis needs to follow it — and a checker that silently
  stops following is worse than one that never claimed to.

**So: the filter-presence rule is a rule. The filter-provenance question is a
guardian task.** It belongs to an agent that reads a handler and answers *where
does this identifier come from*, with the manifest's `isolation` field telling it
which handlers to read. That is Phase 2 work and it is the honest home for it —
recording it as a rule we will write later would be the fifth instance of
promising a check that pattern-matching cannot deliver.

### The rule's `description` must say what it does not do — in the rule, not here

The limitation belongs in the shipped text, because **the person who reads it at
2am reads the description, not this file.** Verbatim, for
`supabase.service_role_query_scoped`:

    description:
      'Every service-role query against a tenant table carries a tenant filter. '
      + 'CHECKS PRESENCE, NOT PROVENANCE - it verifies that a tenant predicate '
      + 'exists, and CANNOT verify that the value it compares against is '
      + 'trustworthy. A filter built from an unauthenticated request body passes '
      + 'this check and is still a cross-tenant read. That question needs dataflow '
      + 'analysis and is deliberately not attempted here.'

This is the same move as `legal.kvkk_structure`, whose description already says
*"STRUCTURAL CHECK ONLY - it does not and cannot assess legal sufficiency"* and
whose `authority` is `external` for precisely that reason: the check is real, and
a green tick is not the claim a reader would otherwise take from it. The pattern
is established; this rule needs it more, because the gap between "a filter is
present" and "tenants are isolated" is where the live bug on this product lives.

### The first concrete guardian task this project has produced

Guardian is unbuilt, and until now its justification has been an argument:
pattern matching cannot answer questions about meaning. **It now has a real bug on
a live product to point at**, which is worth more than any specification written
in advance:

    app/api/chat/route.ts        the filter is present:  .eq("id", companyId)
                                 the value is not trustworthy: body.companyId
                                 every rule in the set passes
                                 result: unauthenticated cross-tenant read

That is guardian's job stated concretely, with an input, an expected answer, and a
demonstration that thirteen rules and a human reviewer's first pass both missed
it. The task: **given a handler that reaches a tenant table under a service-role
client, determine whether each filter value originates from a verified caller
identity, and report the ones that do not.** The manifest's `isolation` field
tells it which projects to run on; the filter-presence rule tells it which
handlers already have a predicate worth interrogating.

Recording it here rather than in `ROADMAP` deliberately: it arrived as evidence,
and Phase 2 should design guardian around cases it was handed rather than cases we
imagined. When guardian is specified, this is the first acceptance case, and the
bug is preserved in `docs/chatbot-widget-connect-plan.md` §0a with the code quoted
so the case survives the fix.

## The assertion, and the broken build it must catch

For the schema split: **the broken build is 0.1.14**, where a project whose
isolation is application filters validates as `shared-schema-rls` and nothing
notices.

    manifest declares isolation: 'rls'                  -> supabase.rls_enabled runs
    manifest declares isolation: 'application-filters'  -> supabase.rls_enabled does
                                                           NOT run; doctor states
                                                           there is no DB backstop
    legacy 'shared-schema-rls'                          -> migrates, or fails with a
                                                           message naming both fields

For the filter-presence rule:

    bad/   admin client .from('conversations').select() with no .eq()   -> 1 finding
    bad/   .delete() on a tenant table with no .eq()                    -> 1 finding
    good/  .eq(tenant_column, …) present                                -> 0
    good/  a non-admin client with no .eq()                             -> 0

**And the assertion that keeps it honest:** a fixture with `.eq("id", companyId)`
where `companyId` comes from the request body must produce **zero** findings from
this rule, and the rule's own description must say it checks presence and not
provenance. A rule that is quietly believed to cover provenance is worse than no
rule, because it converts an unchecked property into a green tick — which is
Finding 5's defect, arriving by a different door.

---

## Provenance note

These findings did not come from a Gate. They came from reading two real
repositories before connecting them, which is the cheapest audit in the system and
had never been run. It cost one read-only afternoon and produced four mechanism
defects, one class finding, one scope finding, one channel gap, and —
incidentally, and worth more than all seven — a live Google session cookie jar in
a public repository that the checker was not built to see, plus a live
multi-tenant SaaS whose RLS rule was returning green without inspecting anything.

**The second repository is what made this worth a release rather than a patch.**
One project gives you a list of defects. Two gave the axis: Finding 6 is only
visible because the same error appeared in a different rule, in a different
codebase, on a different stack. Had the analysis stopped at ProToolHub, the fix
would have been "add `.txt` to the extension list" and the seventh instance would
have shipped.

The method that found them is the one already written down: *name the broken build
the assertion must catch, and show it failing first.* Applied here to a build
nobody had planted a defect in, because a real repository is a defect nobody
planted.
