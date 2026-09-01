# Plan: connecting AI Chatbot Widget SaaS — pre-run analysis against v0.1.14

> **SUPERSEDED by `docs/chatbot-connect-plan-2.md` (2026-09-01).** This plan was
> measured against an uncommitted working tree; the tree is now committed at
> `4cfb8b6` and the finding counts here are stale. Kept for two things that are
> still current: the by-hand secret scan in §0, which is what actually
> establishes that no credential is committed, and the §0a correction, which is
> the record of production being a CLI artefact rather than `HEAD`.

Written 2026-09-01, before any command is run. **Nothing has been written to
`C:\Projelerim\AI-Chatbot-Widget-SaaS`.** Every number below was measured by
running the real rule set in memory against the real repository.

Companion to `docs/protoolhub-connect-plan.md`, which is the negative case. This
one is the honest test: Next.js 14.2.33 App Router, `@supabase/ssr` +
`supabase-js`, Stripe 18.5, Anthropic SDK, TypeScript, npm, deployed to **Vercel**.
It is the stack the system was designed for, and the manifest can describe it
without a single false value.

---

## 0a. STOP — unauthenticated cross-tenant read, found 2026-09-01 during connect prep

**Connect was halted here. This is a production finding, not a system finding, and
no rule in the checker reports it.**

`app/api/chat/route.ts` — the endpoint the public widget calls:

    export const dynamic = "force-dynamic";        // rule-compliant
    "Access-Control-Allow-Origin": "*"             // any origin
    const companyId = body.companyId?.trim();      // from the REQUEST BODY
    // no authentication, no session, no origin check
    const supabaseAdmin = getSupabaseAdminClient(); // SERVICE ROLE - bypasses RLS
    await supabaseAdmin.from("companies")
      .select("id, name, system_prompt, knowledge_base")
      .eq("id", companyId)                          // scoping is app-code only

Any caller, from any origin, supplying any company's id, receives that company's
`system_prompt` and `knowledge_base`.

**The ids are not secret.** `app/widget.js/route.ts` builds the embed script so
that `companyId` is read from the script tag's own URL
(`src.searchParams.get("id")`) — so every customer's id is in the page source of
every site running the widget. An attacker does not need to guess a UUID; they
harvest it.

**RLS is irrelevant to this path, which is why checking the dashboard would not
have settled it.** All eight data-touching routes use `getSupabaseAdminClient()`,
whose service-role key bypasses row level security by design. Tenant isolation in
this product rests entirely on each `.eq("id", companyId)` in application code
being correct *and* on `companyId` coming from a trusted source. On this route it
does not.

**What the checker said about it: nothing.** `supabase.rls_enabled` passed
(Finding 5 — empty input set). `next.route_force_dynamic` passed. The one finding
near it, `next.no_service_role_client` at `lib/supabase.ts`, is about client-bundle
exposure and points at the wrong risk. Twenty-five findings, and the live
cross-tenant read is not among them. That is worth recording as the honest measure
of what the Phase 1 rule set does and does not cover.

---

## 0. The secret scan, by hand — done first, and it is clean

Scanned by content and location across every file on disk regardless of
extension, plus the complete git history of both repositories present. Not
through `secrets.no_committed_secrets`, for the reason that rule is now Finding 1
in `pending-system-change-0.1.15.md`.

**Result: no committed credential, in the working tree or in any historical blob.**

What I checked and what I found:

- **Live keys exist and are correctly contained.** `.env.local` holds
  `ANTHROPIC_API_KEY` (`sk-ant-…`), `STRIPE_SECRET_KEY` (`sk_test_…`),
  `STRIPE_WEBHOOK_SECRET` (`whsec_…`), `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and a
  `VERCEL_OIDC_TOKEN`. The file is **untracked and gitignored** (`.env*.local`
  and `.env` are both in `.gitignore`). No value is printed anywhere in this
  document.
- **Never committed.** `git log --diff-filter=A` across all refs shows exactly one
  `.env*` path ever added: `.env.example`, which contains key names only. I then
  walked **every blob in the full object graph** of both repos and grepped for
  `sk_live_`, `sk-ant-api03`, `whsec_`, `sk_test_`, and the Supabase HS256 JWT
  header. Zero hits outside `.env.local`, which is not in the graph.
- **No hardcoded fallbacks.** The only `process.env.X ?? "literal"` in the tree is
  `app/onboarding/page.tsx:19`, falling back to the public Vercel URL. Not a
  secret.
- **No inline credential assignments**, no private keys, no database URL with an
  embedded password, no Telegram bot-token shape, no AWS/GitHub/Slack/Google key
  shapes.
- **One self-inflicted false positive, recorded because it is instructive.** My
  first pass flagged `chatbot-saas/package-lock.json:4983` on `eyJ`. It is the
  base64 tail of a `sha512-` integrity hash. `eyJ` is `{"` in base64 and appears
  inside hashes by chance — which is exactly why the redactor's entropy class
  deliberately excludes lockfile digests. My hand-written grep reproduced, in one
  line, the false-positive class the real scanner already handles.
- **`.vercel/project.json`** carries `projectId` and `orgId`. Those are
  identifiers, not credentials, and the file is gitignored anyway.
- **The Supabase project ref is `ltjwsmiycijxrqxjsphq`.** Public by construction —
  it ships in the client bundle and in the widget script served to third-party
  sites. You will need it for the manifest; it is not a secret.

**One thing to fix that is not a leak.** `.env.example` names
`SUPABASE_SERVICE_KEY` and `ADMIN_JWT_SECRET` and three `TWILIO_*` keys that
`.env.local` does not define, while `.env.local` defines four keys
`.env.example` does not. The two files have drifted in both directions. That
matters for the manifest, because `env_sources.required_keys` is read by
`redact.mjs` to build the class-3 redaction value set — a key missing from that
list is a key the redactor will not scrub out of logs and verdicts. Reconcile the
two files before writing the manifest.

---

## 1. Repository state — the real blocker, and it is not the checker

The code is in good shape. The *repository* is not, in three ways that all have to
be settled before connect, because connect writes files whose whole value depends
on being committed to the branch CI builds.

**The remote is unreachable.** `git ls-remote origin` and `gh api` both return
`Repository not found` for `mavcimavci1983-create/AI-Chatbot-Widget-SaaS`, from
**both** logged-in accounts (`mavci-ai-devsystem`, `globalmvpllc-oss`). GitHub does
not distinguish *you may not see this* from *this does not exist*, so the 404 has
two readings: the repo is private and neither account has access, or it was
renamed, transferred or deleted. This is the identical failure `doctor`'s
`checkGhAccount` was built for in 0.1.13 — the lesson file records the operator
"nearly recreated a repository that had never gone anywhere." Do not conclude the
repo is gone. Log in as `mavcimavci1983-create` and look.

Until that is resolved: you cannot push, you cannot set `MAVCI_TOKEN`, and CI
cannot run. Connect's steps 1–7 work entirely offline; step 8 does not.

**The local branch and the remote default share no history at all.** This is
stronger than divergence and I initially reported it wrongly as a 10/6 split,
which implied a common ancestor. `git merge-base master origin/main` returns
**empty**: neither is an ancestor of the other, and each has its own root commit.

    chatbot-saas/  (nested)   3 commits  13:37 → 14:38   root fb084ac "Initial commit"
    origin/main              6 commits  15:00 → 17:39   root f2242de "supabase entegrasyonu"
    master  (local)         10 commits  22:19 → 00:56   root a09c77c "admin panel eklendi"

Three unrelated root commits, three successive restarts on the same day
(2026-04-23), all pointing at the same remote. The last successful fetch was
22:18; `master`'s root commit is 22:19 — the history was restarted one minute
after the last contact with GitHub.

**The consequence is the most serious fact in this document.** Local `master` —
the admin panel, Stripe billing, company registration and onboarding flow, ten
commits — **has never been pushed anywhere.** Add the 20 uncommitted
modifications and 8 untracked paths on top, and the current state of this product
exists in exactly one place: this disk. The remote holds an earlier, smaller,
unrelated line of work whose newest commit is `widget.js embed script`.

There is no merge to perform here. `git merge` would refuse without
`--allow-unrelated-histories`, and using it would splice two codebases that
re-implemented the same features independently. The realistic choice is that
`master` *becomes* the published history, which is a force-push — a tier-3
operation, hard-blocked for agents, and yours alone.

**Twenty tracked files carry uncommitted modifications, dating to 2026-08-19** —
`lib/supabase.ts`, `lib/admin-auth.ts`, `lib/anthropic.ts`, nine route handlers,
four dashboard pages, `package.json`, `next.config.mjs`, `tsconfig.json` and
others: 820 insertions, 747 deletions across 20 files. This is real uncommitted
work, weeks old, not a stray touch.

**And eight paths are untracked.**

    app/api/telegram/setup/route.ts          app/api/whatsapp/route.ts
    app/api/telegram/subscribe/route.ts      app/dashboard/telegram/page.tsx
    app/api/telegram/webhook/route.ts        supabase/migrations/20260507135600_add_whatsapp_fields_to_companies.sql
    app/api/webhooks/stripe/route.ts

Plus `chatbot-saas/` — a third Next.js project with its own `.git`, sitting
untracked inside the working tree. It points at the *same remote URL* but shares
no history with either branch (root `fb084ac`, 3 commits, the original
create-next-app scaffold). It is 14 of the 56
files the checker scans and contributes 2 of the 25 findings.

This matters far more than it looks, because **`walk()` is filesystem-based, not
git-based** (Finding 2 in the 0.1.15 queue). **Every number in §3 describes the
working tree. CI checks `HEAD`, and they are not the same codebase.** The checker
audits 20 modified files, 8 untracked paths and a nested repository that CI will
never see. I verified no tracked file imports an untracked one, so CI's tree is at
least self-consistent and `tsc --noEmit` passes on it.

**The clearest demonstration is the service-role finding itself.** At `HEAD`,
`lib/supabase.ts:6` reads `process.env.SUPABASE_SERVICE_KEY`. The working copy
changes it to `SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_KEY`. The string
`SUPABASE_SERVICE_ROLE_KEY` **does not appear anywhere at `HEAD`**. So:

- run the checker locally → 1 `next.no_service_role_client` finding;
- run it in CI against `HEAD` → **0 findings**, because
  `rules/index.mjs:293` does `text.indexOf('SUPABASE_SERVICE_ROLE_KEY')` and the
  committed code calls the variable something else.

The committed code constructs a real service-role client that bypasses RLS, and
the rule built to police service-role placement is blind to it **because of the
variable's name**. That is the same axis error as the `.txt` miss and the
`app/api/` path prefix — a third instance, and the first one where the blind spot
sits on the committed code of a live product. It is a sixth candidate for the
0.1.15 queue: the rule must match the *value's provenance*, or at minimum the
known aliases, not one spelling.

**Settle all three before connect.** Commit or discard the 20 modifications,
commit or delete the 7 untracked paths, remove `chatbot-saas/` from the tree, and
decide `master` vs `main`. A baseline taken over this tree records findings
against code that is not in the repository, and `--baseline-init` runs once, ever.

---

## 2. What connect does, step by step

Same eight steps as the ProToolHub plan; only the deltas that matter here are
called out.

**Preflight** — the skill body runs `cat package.json`, `ls next.config.*`,
`find app`, `ls supabase/migrations`, `ls .mavci/project.json`, `git remote -v`.
No `.mavci` exists, so this is a fresh connect.

**Step 1, detect.** Framework, package manager, Supabase/Stripe/Resend presence,
deploy target, tenant column. It will grep the migrations for a tenant column and
find `public.companies` — see §3, because what it finds there is the most
important thing in this analysis.

**Step 2, propose the manifest.** Asks you for jurisdictions, required pages, the
five `compliance.entity` fields, `deploy.site_url`, risk tier, Supabase refs and
which environments are `protected: true`. Shows it, waits for approval. No writes.

**Step 3, write config.** `.mavci/project.json` first, then `render.mjs --config`,
which writes exactly three files: `.claude/settings.json`, `.claude/CLAUDE.md`,
`.github/workflows/mavci-verify.yml`. Then `.gitattributes` if absent — it is
absent here, **and this is not as safe as it looks: `core.autocrlf` is `true` on
this machine**, and git already warns "LF will be replaced by CRLF the next time
Git touches it" on six of the modified files. Writing `* text=auto eol=lf` on top
of 20 uncommitted modifications is how a line-ending renormalisation gets mixed
into real work in one commit. Commit or discard the modifications first. **Step
3.3 does not apply**: there is no existing `.claude/`, so nothing is overwritten
and no merge is needed.

**Step 4, `state.mjs --init`.** Validates the manifest, creates the control plane,
writes `state.json`, `waivers.json` and the integrity seal. **This will succeed** —
every field this project needs is expressible: `framework: nextjs-14-app-router`,
`db: supabase-postgres`, `auth: supabase-auth`, `payments: stripe`,
`package_manager: npm`, `deploy.target: vercel`. No false value is required
anywhere. That is the whole reason this is the right first project.

**Step 5, `--baseline-init`.** **This will succeed**: 25 findings, none `critical`.
Contrast ProToolHub, which refuses here.

**Step 6, `gate.mjs --ci`** must exit 0. It will, once the baseline covers all 25.

**Step 7, backlog.** Four tasks, one per `check_id` group.

**Step 8, report** plus the `MAVCI_TOKEN` step, which is blocked on §1.

Footprint: `.mavci/`, `.claude/`, `.github/workflows/mavci-verify.yml`,
`.gitattributes`. Nothing under `app/`, `lib/` or `supabase/` is touched.

---

## 3. What I measured — 25 findings, and what the checker does not see

Run in memory with packs `nextjs-app-router`, `supabase-multitenant-rls`,
`legal-tr-kvkk`, all five legal pages, tier `standard`.

    walk()                     56 files, 0.60 MB, 9 ms      (ProToolHub: 35,168 / 140 MB / 9.5 s)
    total findings             25       critical: 0

    next.env_centralised       18   blocker   16 outer, 2 in the untracked nested repo
    legal.pages_present         5   blocker   all five pages absent
    next.no_service_role_client 1   blocker   lib/supabase.ts:7
    stripe.webhook_signature    1   blocker   app/api/stripe/checkout/route.ts
    all other rules             0

**No hook-timeout risk.** 9 ms against a 30 s Stop budget. Finding 2 of the 0.1.15
queue does not bite here — the repository is small and mostly clean.

### Which rules dominate, and which are wrong

**`next.env_centralised` — 18, and they are true.** The project has no
`lib/env.ts`; every module reads `process.env` directly — `lib/supabase.ts:5`,
`lib/stripe.ts:4`, `lib/stripe-billing.ts:6`, `lib/anthropic.ts:5`,
`lib/admin-auth.ts:10`, and eleven route handlers. This is a real standard, really
violated, and it is the group I would fix first: it is mechanical, it is one new
file plus imports, and it retires 72% of the debt. Two of the 18 are in
`chatbot-saas/` and vanish when that directory goes.

**`legal.pages_present` — 5, and they are the most serious findings here.** This
is a **live product that takes payment** and has no privacy policy, no terms, no
KVKK aydınlatma metni, no cookie policy and no contact page. For a Turkish
entity processing personal data and running Stripe, that is a legal exposure, not
a checker complaint. The rule is right, and it is right for the reason the rule
exists rather than by accident.

**`stripe.webhook_signature` — 1, and it is a false positive.** It fired on
`app/api/stripe/checkout/route.ts`, which creates Checkout Sessions and has no
business calling `constructEvent`. The rule matches any API route whose **path**
contains `stripe` or `webhook` (`rules/index.mjs:346`), so a checkout endpoint
under `app/api/stripe/` is indistinguishable from a webhook handler. Meanwhile
the two routes that genuinely are webhooks — `app/api/stripe/webhook/route.ts`
and `app/api/webhooks/stripe/route.ts` — **both call `constructEvent` correctly**
and are not flagged. So the rule scored one finding, zero true positives, and the
two things it was built to check are already right. Path-shaped, not
content-shaped: the same axis error as the `.txt` miss, in a rule that is
otherwise sound.

*(Separately, and no rule sees it: there are two Stripe webhook routes serving
the same purpose at different paths. Only one can be the URL registered in
Stripe. The other is dead code that looks live, which is worse than dead code.)*

**`next.no_service_role_client` — 1, and it is technically true and practically
misdirected.** `lib/supabase.ts:7` reads
`process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY`. The
rule's allow-list is `lib/supabase/server*`, `src/lib/supabase/server*`,
`app/api/**/route.ts`, `lib/env.ts`, `supabase/**`. This file is `lib/supabase.ts`
— one directory level away from an allowed path.

I checked the actual risk rather than the rule's opinion: **nine importers, all of
them server-side** (eight API routes and `lib/stripe-billing.ts`), and none of the
eight `"use client"` components touches it. The service key does not reach a
client bundle. The file is also a correct factory — `getSupabaseAdminClient()`
creates the client *inside* the function, which is why
`next.supabase_client_in_function` correctly reports nothing.

But the finding is not baseless, and this is the part worth getting right: the
file is not *provably* server-only. There is no `import 'server-only'` at the top,
so nothing prevents a future client component from importing it and shipping the
service key to browsers. The rule is pointing at a real structural weakness with
the wrong remedy — *"Move the reference into lib/supabase/server.ts"* is a rename
that changes nothing except a regex match. **The fix that actually helps is
`import 'server-only'`, and the rule does not recognise it.** Worth a fifth
finding in the 0.1.15 queue when you next apply it.

### And the finding the checker does not make, which matters most

**`supabase.rls_enabled` reports 0 findings and a pass, having verified nothing.**

The rule collects `CREATE TABLE` statements from `supabase/migrations/*.sql` and
reports the ones never given `ENABLE ROW LEVEL SECURITY`. Both migrations here
contain **zero `CREATE TABLE`** — they are `ALTER TABLE public.companies ADD
COLUMN` only. The `companies` table was created outside migrations, in the
Supabase dashboard. Neither migration contains `ENABLE ROW LEVEL SECURITY`, and
neither contains a single `CREATE POLICY`.

So on a **live multi-tenant SaaS**, where `companies` is the tenant table and
`getSupabaseAdminClient()` uses the service-role key that bypasses RLS entirely,
the one rule in the system built to protect tenant isolation inspected an empty
set and returned green.

This is invariant 5 in its most dangerous form. The invariant says a *failed*
probe must never be reported as a pass. Here the probe did not fail — it ran
correctly, found nothing to look at, and reported a pass. **A rule that can only
see tables it watched being born is blind to every project that created its
schema in a console**, which is most projects, and it says "pass" rather than
"nothing to check". A green `supabase.rls_enabled` currently means *no migration
created an unprotected table*. Everyone will read it as *your tables are
protected*.

**I cannot tell you from the repository whether RLS is on.** Check it directly in
the Supabase dashboard, or with `select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace;`, before you trust anything the
checker says about this project. That is a today action, independent of connect.

*(Two smaller blind spots, same family: `app/widget.js/route.ts` is the only route
on disk missing `force-dynamic`, and `next.route_force_dynamic` cannot see it
because `isApiRoute` requires the `app/api/` prefix. All 14 routes that are under
`app/api/` do export it — genuinely, which is a real credit to whoever wrote
them.)*

---

## 4. The baseline question, for this project specifically

25 findings, none `critical`, so `--baseline-init` succeeds and writes **25
entries**, keyed by `check_id + path` — not line, not evidence, not count.
`state.json.baseline_debt` reads 25.

**The single sharpest risk, and it is exactly the scenario you asked about:**

> baselining `next.no_service_role_client` at `lib/supabase.ts` switches that
> rule off, permanently, for the one file in the repository that holds the
> service-role key.

`isBaselined()` compares `check_id` and `path` and nothing else. After connect,
that file can grow any number of new service-role references and the rule will
never speak again. The finding was arguably a false positive *today*, on the
strength of a fact the baseline does not record — that all nine importers are
server-side. The day someone adds a tenth importer with `"use client"` at the top,
the rule that exists to catch precisely that is already suppressed for that file,
and it was suppressed on day one, by a command that was correct to suppress it.

The same shape, less acutely, applies to `next.env_centralised` at
`lib/supabase.ts` and `lib/stripe.ts`: the rule reports only the *first*
`process.env` in a file, so one entry retires the whole file for that rule.

**What I would do instead, and it costs one afternoon:** fix `env_centralised`
*before* connecting. Create `lib/env.ts`, move the reads, and the baseline drops
from 25 entries to 7. Combined with deleting `chatbot-saas/`, connect then starts
from a baseline of 5 legal pages + 1 stripe false positive + 1 service-role
finding — small enough to read, small enough to argue with, and small enough that
nothing important hides in it. A 25-entry baseline on a 56-file project is
suppressing more than it reports.

For the two false positives — the checkout route and, if you accept the reasoning
above, `lib/supabase.ts` — **a waiver is the better instrument than the baseline**.
A waiver is time-boxed, carries a reason, and expires; a baseline entry is
permanent and silent. Baseline is for *debt you intend to pay*; a rule that is
wrong about your code is not debt.

What protects you regardless: `critical` is never suppressible; entries can only
be removed, never added; new files and new rules are fully checked. What does not:
nothing re-reads a baselined finding, and **renaming a file un-baselines it** —
which will happen the moment you move `lib/supabase.ts` to `lib/supabase/server.ts`
as the remedy tells you to.

---

## 5. What you have to prepare

**Resolve the remote first.** Everything CI-shaped is blocked until
`git ls-remote origin` succeeds. Log in as `mavcimavci1983-create`
(`gh auth login`), confirm the repository exists and its visibility, and confirm
you hold **admin** — you need admin to set a secret, and on ProToolHub the active
account had only READ.

**MAVCI_TOKEN.** Fine-grained PAT, resource owner `mavci-ai-devsystem`, repository
access limited to `mavci-ai-devsystem/mavci-ai-devsystem`, permissions Contents →
Read-only, nothing else. Set it on *this* repository —
`gh secret set MAVCI_TOKEN` — and record the expiry as `ci.token_expires` in the
manifest, since GitHub exposes no API for it and that date is the only thing
doctor can warn on.

**Decide the production branch.** `master` or `main`. This sets
`deploy.prod_branch`, which is what risk-guard matches on a `git push`, and it
decides which of two diverged codebases CI verifies. There is no merge: the histories are unrelated (§1). Decide which line is
the product before connect, not after.

**Supabase refs.** One project: `ltjwsmiycijxrqxjsphq`. There is no staging
project, and that is the awkward part. `environments.prod.protected: true` is the
truthful declaration, and it means `risk-guard` hard-blocks every agent
`execute_sql` and `apply_migration` against the only database that exists. That
is the correct policy for a live product; just know that it means no agent can
touch the database at all, and every migration goes through you. Do not mark it
unprotected to make agent work convenient — that inverts the one control that is
actually wired up on this stack.

**Entity details.** `legal_name`, `address`, `email`, `mersis`, `kep` — all five
schema-required, all five substituted into pages you do not yet have. Since all
five legal pages are missing and this is a live product, these are needed for real
work and not just to satisfy the schema.

**`env_sources.required_keys`.** Reconcile `.env.example` against `.env.local`
first (§0). This list is what `redact.mjs` uses to build its redaction value set;
a key omitted here is a key that will not be scrubbed from logs and verdicts.
Include at minimum: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`,
`ADMIN_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and the three `TWILIO_*` keys if WhatsApp
ships.

**Risk tier: `standard`.** Not `sandbox` — this is live and takes payment. At
sandbox, `risk-guard.mjs:761` downgrades deploys to `confirm()`, which emits
`deferToUser`, which Claude Code rejects (carried-forward item 7), leaving only the
settings deny list. `standard` gives a real `deny()`.

**Deploy target: `vercel`** — and here, unlike ProToolHub, the system's assumptions
hold. `vercel --prod` and `vercel deploy --prod` are in `HARD_BLOCK`, eight Vercel
MCP tools are denied in `project.settings.json`, and the scaffold's legal pages
naming Vercel as hosting sub-processor would be **correct** for this project. Site
URL is `https://ai-chatbot-widget-saa-s-chi.vercel.app` unless a custom domain is
live.

**CI will run clean once it can run.** `npm ci` (lockfile present ✓),
`npx tsc --noEmit` (**exits 0 today — I ran it**), `npm run build` (`next build`,
standard). `next.config.mjs` is three lines and sets no `output: 'export'`. This
is the opposite of ProToolHub, where CI fails on 30 pre-existing type errors. Add
a branch filter to `on: push` regardless.

---

## 6. What would be expensive to undo, and the revert

**The revert is complete and cheap, before commit.** Nothing connect writes exists
in this repository today:

    rm -rf .mavci .claude .github/workflows/mavci-verify.yml .gitattributes

No file under `app/`, `lib/` or `supabase/` is touched at any point.

**One correction to an earlier reading of `.gitattributes`.** I first judged it
safe here because there is no vendored tree. That was wrong in a way worth
recording: `core.autocrlf` is `true` on this machine, and six modified files
already carry the "LF will be replaced by CRLF" warning. `* text=auto eol=lf`
therefore *does* change what git stores, on a tree with 20 uncommitted
modifications. The risk is not ProToolHub's 35,000-file diff; it is a
renormalisation folded silently into a commit of real work, which is harder to
spot and harder to unpick. Commit or discard first, then add `.gitattributes` as
its own commit.

**The four things that are not cheap:**

1. **A baseline taken over the current tree.** `--baseline-init` runs **once,
   ever**; there is no regenerate. Taken today it records entries for seven
   untracked files and a nested repository that should not be there — paths that
   do not exist in the repository CI builds. The only revert is deleting the whole
   `.mavci/` directory and re-running connect, which is fine before you commit and
   unpleasant after. **Settle §1 first.** This is the one I would actually worry
   about.

2. **Baselining `next.no_service_role_client` at `lib/supabase.ts`.** Permanent,
   silent, and it covers the file holding the service-role key. Undoing it means
   `--baseline-prune`, which only removes entries whose violation has *stopped
   occurring* — so you cannot simply un-baseline it while the finding still fires.
   You would have to fix the underlying finding to clear the entry, which is
   backwards. Prefer a waiver, or fix it before connecting.

3. **Marking `prod` unprotected to make agent work convenient.** Reversible in the
   manifest, but a manifest write raises a tier-2 confirm and re-seals the control
   plane, and in the meantime every guard on the only production database is off.
   On a live product with a service-role client, this is the highest-consequence
   field in the file.

4. **Committing the workflow onto the wrong branch.** `mavci-verify.yml` reads
   `.mavci/control/state.json` for the tag to clone. If `.mavci/` lands on
   `master` and CI runs on `main`, the workflow fails at "Resolve the pinned
   system version" with a message about a missing state file — which reads as a
   Mavci bug and is a branch problem.

---

## 7. Predictions — what I expect to break, named before the run

1. **Connect completes steps 1–7.** The manifest validates with no false value,
   the baseline is written, `gate.mjs --ci` exits 0. This is the first prediction
   in three attempts that the command *works*, and it is the point of choosing
   this project. High confidence — measured end to end except the writes.
2. **Step 8 blocks on the remote.** `MAVCI_TOKEN` cannot be set; `git ls-remote`
   returns `Repository not found` from both authenticated accounts. Certain,
   measured. Watch for this being misread as "the repo is gone" — it is the exact
   404 ambiguity 0.1.13 documented.
3. **`stripe.webhook_signature` false-positives on the checkout route.** Certain,
   measured. Both real webhook handlers verify signatures correctly.
4. **`next.no_service_role_client` fires on `lib/supabase.ts`**, and the remedy
   asks for a rename that improves nothing. Certain, measured. The useful fix —
   `import 'server-only'` — is not recognised by the rule.
5. **`supabase.rls_enabled` reports a pass having checked nothing.** Certain,
   measured: zero `CREATE TABLE` in either migration. This is the prediction I
   most want to be wrong about at the database level, and the repository cannot
   tell me. **Check the dashboard.**
6. **The agent proposes baselining all 25** rather than fixing the 18
   `env_centralised` findings first. The skill's step 5 makes baselining the
   default path and step 7 writes the backlog afterwards; nothing in the flow
   suggests fixing before baselining, and "the baseline is what makes this usable"
   is the framing it is given. Watch for it — the cheaper and better sequence is
   fix, then baseline what remains.
7. **`doctor` reports a `gh` account mismatch**, comparing the active login
   against `SYSTEM_REPO`'s owner. `mavci-ai-devsystem` is currently active and
   *does* own the system repo, so this should pass — but if you `gh auth switch`
   to `mavcimavci1983-create` to set the secret and leave it active, doctor will
   FAIL on the next run. Correct behaviour, surprising timing.
8. **A `verify` run reads `.env.local` into the checker's file cache.** It is not
   reported — the secrets rule skips `.env*` by design and only checks that
   `.gitignore` covers them, which it does. Not a defect; noted so that seeing the
   path in a debug trace does not read as a leak.

What I expect **not** to break, with evidence:

- **Hook timeouts.** 56 files, 0.60 MB, 9 ms against a 30 s budget.
- **The framework enum.** `nextjs-14-app-router` is exact; `next` is 14.2.33.
- **CI type-check and build.** `tsc --noEmit` exits 0 today; `next.config.mjs` sets
  no `output: 'export'`.
- **Version shadowing and the CI tag pin.** One clean user-scope record,
  `mavci-core@mavci` 0.1.14 at `f2a22ba`, no project pin; `v0.1.14` is on the
  remote.
- **`.gitattributes` renormalising a vendored tree.** There is none. *(But see §6:
  `core.autocrlf` is `true`, so it is not risk-free — I revised this one after
  measuring rather than assuming.)*
- **`settings.marketplace_form`.** No existing `.claude/settings.json` to conflict
  with; `render.mjs` writes the `git` source form.

---

## 8. Recommended sequence

1. **Today, independent of Mavci:** verify RLS is enabled on `public.companies` and
   every other public table, in the dashboard. The checker will not tell you, and
   this is a live multi-tenant product using a service-role client.
2. Resolve the remote: log in as `mavcimavci1983-create`, confirm the repository
   and your permission on it.
3. **Back the work up first** — `git bundle create ../chatbot-master.bundle --all`
   plus a copy of the untracked files. Ten unpushed commits and 28 uncommitted
   paths currently exist on one disk.
4. Decide which history is the product (`§1` — they are unrelated, not diverged).
   Commit or discard the 20 modifications, commit or delete the 8 untracked paths,
   move `chatbot-saas/` out of the tree.
4. Reconcile `.env.example` with `.env.local`.
5. **Optional but strongly recommended:** create `lib/env.ts` and retire the 18
   `next.env_centralised` findings. Baseline drops from 25 to 7 and stops hiding
   things worth seeing.
6. Then `/mavci-core:connect`, with `standard` tier, `prod` protected, and a
   waiver rather than a baseline entry for the checkout-route false positive.
7. `MAVCI_TOKEN`, branch filter on the workflow, commit `.mavci/`, `.claude/` and
   the workflow, push, and watch the first CI run.

The legal pages are the largest real finding and the one with a deadline that is
not yours to set. They are also the one group the agents are genuinely good at
drafting, with `standards-legal-tr-kvkk` loaded and the entity details in the
manifest — which is, finally, the system doing the thing it was built to do.

---

## Note for the 0.1.15 queue

This analysis produced a fifth candidate finding, not yet filed:
**`next.no_service_role_client` does not recognise `import 'server-only'`** and its
remedy asks for a path rename that changes no behaviour. The rule should treat an
explicit `server-only` import as the allow condition, because that is the
mechanism Next.js actually enforces, and a path convention is only a proxy for it.
The assertion is a fixture where the same file passes with the import and fails
without it, at an identical path — which a path-shaped rule cannot distinguish and
must be watched failing first.

A sixth, from §1 and sharper than the fifth: **`next.no_service_role_client`
matches one spelling of the key.** `rules/index.mjs:293` does
`text.indexOf('SUPABASE_SERVICE_ROLE_KEY')`. The committed code at `HEAD` uses
`SUPABASE_SERVICE_KEY` — the name Supabase's own dashboard has used — builds a
real service-role client with it, and the rule reports nothing. The finding I
measured exists only because the *uncommitted* working copy added the other
spelling. The assertion is a fixture with each alias in turn at the same path,
both of which must be reported, watched failing on the alias first.

Related and worth recording with it: **`supabase.rls_enabled` reports "pass" when
it inspected nothing.** A rule whose finding set is empty because its *input* was
empty must say so, not return green — invariant 5, one level out from where it is
currently written. The assertion is a fixture with migrations containing only
`ALTER TABLE`: today it returns a pass, and it must return "not checked".
