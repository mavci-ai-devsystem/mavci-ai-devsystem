# Connect plan v2 — AI Chatbot Widget SaaS, against committed `HEAD` `4cfb8b6`

2026-09-01. **No writes.** Supersedes `docs/chatbot-widget-connect-plan.md`, which
was measured against an uncommitted working tree and whose §0a correction still
matters as a record.

What changed since v1: eight commits landed, the tree is in git, three
unauthenticated endpoints are gone from production, the rate limit is restored,
and the remote is reachable with admin. **The working-tree/`HEAD` gap that made v1
unusable is closed for everything tracked.** Every number below was measured by
running the real rule set against a clean worktree at `4cfb8b6` — not against the
disk, which still carries the deliberate remainder.

---

## 1. What the checker finds against `HEAD` — measured

    scan: 36 files, 0.33 MB, walk 2ms          (v1 working tree: 56 files, 0.60 MB)
    TOTAL 20 findings, 0 critical              (v1: 25 findings, 0 critical)

    next.env_centralised        12  blocker
    legal.pages_present          5  blocker
    next.route_force_dynamic     1  blocker    NEW since v1
    next.no_service_role_client  1  blocker
    stripe.webhook_signature     1  blocker
    everything else              0

### How it differs from v1's 25, and why each moved

**`next.env_centralised` 18 → 12.** Six disappeared, none by being fixed:
two were in `chatbot-saas/`, the untracked third project, which is not in `HEAD`;
`app/api/debug/route.ts` was deleted; `app/api/telegram/setup` and
`.../subscribe` and `app/dashboard/telegram/page.tsx` were removed from the tree.
One arrived — `app/api/telegram/webhook/route.ts`, now committed. The twelve that
remain are the same real violations v1 found.

**`next.route_force_dynamic` 0 → 1, and this one is an artefact of our own
sequencing.** `app/api/stripe/webhook/route.ts` lacks `export const dynamic`. The
one-line addition that fixes it is sitting uncommitted, deliberately held for the
step 3 Stripe decision. **This finding disappears when step 3 commits.** Do not
baseline it and do not fix it separately.

**The other three are unchanged**, and `secrets.no_committed_secrets` and
`settings.marketplace_form` still report zero.

---

## 2. Which findings are real, and which exist only because a rule is wrong

This section exists because of the standing instruction: **do not propose
baselining a finding that only exists because a rule is defective.** Three of the
twenty are in that category, and two *absences* are as important as the findings.

### Real — 17 of 20

**`next.env_centralised` ×12.** Genuine. No `lib/env.ts` exists; twelve modules
read `process.env` directly:

    lib/admin-auth.ts:10      lib/anthropic.ts:5        lib/stripe-billing.ts:6
    lib/stripe.ts:4           lib/supabase.ts:5         app/onboarding/page.tsx:19
    app/api/widget.js/route.ts:9          app/api/telegram/webhook/route.ts:8
    app/api/stripe/webhook/route.ts:9     app/api/stripe/checkout/route.ts:22
    app/api/register/route.ts:89          app/api/admin/login/route.ts:48

**`legal.pages_present` ×5.** Genuine and materially serious: a live product
taking payment with no privacy policy, terms, KVKK aydınlatma metni, cookie
policy or contact page.

### Defective-rule artefacts — 3 of 20

**`stripe.webhook_signature` at `app/api/stripe/checkout/route.ts` — a pure false
positive.** The rule matches any API route whose **path** contains `stripe` or
`webhook` (`rules/index.mjs:346`). A Checkout Session creator has no business
calling `constructEvent`. Both routes that genuinely are webhooks verify their
signatures correctly and are not flagged. Filed as Finding 6, instance six.
**Not baseline material — this is a waiver or nothing.**

**`next.no_service_role_client` at `lib/supabase.ts:7` — right target, wrong
reason, and it cannot be cleanly resolved.** Covered in §3; it is the hardest item
in this plan.

**`next.route_force_dynamic` at `app/api/stripe/webhook/route.ts` — real rule,
correct finding, but it is our own held commit.** Resolves at step 3.

### The two silences that matter more than the findings

**`supabase.rls_enabled` reports 0 and has inspected nothing.** Both migrations
are `ALTER TABLE` only; zero `CREATE TABLE`, so the rule's input set is empty and
it returns green. Filed as Finding 5. **A pass here means "no migration created an
unprotected table", not "your tables are protected."** RLS status is still
unknown pending the `information_schema` lookup.

**`secrets.no_committed_secrets` reports 0, and that is correct here — by luck of
the extension list, not by coverage.** `SCANNABLE_EXT` excludes `.txt`, `.har`,
`.log`, `.csv` (Finding 1). The by-hand scan recorded in
`docs/chatbot-widget-connect-plan.md` §0 — every file regardless of extension,
plus every blob in both repositories' full history — is what actually establishes
that no credential is committed. The rule's zero is not that evidence.

---

## 3. Baseline proposal, file by file

`--baseline-init` runs **once, ever**, and is keyed by `check_id + path`. What
goes in is suppressed for that rule in that file permanently, including for
violations added later.

### Recommended: fix before connect — 12 findings

**Create `lib/env.ts` and retire all twelve `next.env_centralised` findings.** One
new file, twelve import changes, no behaviour change. This is the same
recommendation as v1 and it is stronger now: it takes the baseline from 17
entries to 5, which is small enough to read and small enough that nothing hides
in it. A 17-entry baseline on a 36-file project suppresses more than it reports.

### Recommended: baseline — 5 findings

    legal.pages_present   app/(legal)/privacy/page.tsx
                          app/(legal)/terms/page.tsx
                          app/(legal)/kvkk/page.tsx
                          app/(legal)/cookies/page.tsx
                          app/(legal)/contact/page.tsx

These are real, and baselining a real legal exposure on day one is exactly the
risk this system is built to notice — so it is stated rather than buried. The
argument for baselining anyway: they are `blocker`, they would stop every turn,
and they cannot be fixed in the same motion as connecting. The argument against:
"we filed our missing privacy policy as accepted technical debt" is a sentence
nobody wants to read later.

**Mitigation, and it must land in the same session:** these five become the first
remediation task, ordered ahead of everything else, and the entries are removed
with `--baseline-prune` as each page is written. Debt can only shrink; this is
the one group where shrinking it has a deadline that is not ours to set.

### Excluded from the baseline by standing decision — 1 finding

    next.no_service_role_client   lib/supabase.ts:7

Agreed and correct: baselining it silences the rule permanently on the one file
holding the service-role key.

**But excluding it does not resolve it, and there is no clean resolution.** The
file has nine importers, all server-side, and no client component touches it — so
the risk the rule names does not exist here. It is also not *provably* server-only:
there is no `import 'server-only'`, so nothing structurally prevents a future
client component importing it and shipping the key to browsers.

Three options, none good:

1. **Add `import 'server-only'`.** Fixes the real weakness. **The rule does not
   recognise it** (Finding 6), so the finding still fires and the project stays
   red forever.
2. **Rename to `lib/supabase/server.ts`.** Satisfies the rule's path allow-list
   and changes no behaviour — cargo-cult, but it makes the checker agree with
   reality. Note it also *un-baselines* nothing and moves the path, which is
   fine here precisely because we are not baselining it.
3. **Time-boxed waiver** naming Finding 6, expiring when the rule is fixed in
   0.1.15.

**Recommendation: 1 and 2 together** — add `import 'server-only'` because it is
the real fix, and rename because it makes the rule true rather than merely
quiet. That leaves nothing suppressed and nothing red.

### Waive, do not baseline — 1 finding

    stripe.webhook_signature   app/api/stripe/checkout/route.ts

A waiver is time-boxed, carries a reason and expires. A baseline entry is
permanent and silent. **Baseline is for debt you intend to pay; a rule that is
wrong about your code is not debt.** Reason: rule matches path substring; filed
as Finding 6; expires when 0.1.15 lands.

### Neither — 1 finding

    next.route_force_dynamic   app/api/stripe/webhook/route.ts

Resolves when step 3 commits the held one-line change. If connect runs before
step 3, this needs a waiver of days, not a baseline entry.

**Net: baseline 5 entries, waive 1, fix 13 (12 env + 1 server-only/rename),
1 resolves itself.**

---

## 4. Manifest values that are still unfillable

**`tenancy.model` — unanswerable, and it may stay unanswerable.** Waiting on the
RLS status. But note a problem the lookup will not solve: the enum is
`shared-schema-rls | schema-per-tenant | single-tenant`, and **none of them
describes this application.** It is a shared schema, multi-tenant, and isolation
is enforced by `.eq("id", companyId)` filters in application code running under a
service-role key that bypasses RLS entirely. `shared-schema-rls` asserts RLS is
the isolation mechanism. Even if RLS turns out to be enabled, it is not what is
protecting these paths.

So the honest options are to declare `shared-schema-rls` and accept that it
overstates, or to treat the missing enum value as a system finding.
**Recommendation: do not fill this field until the RLS status is in, and file the
enum gap either way.** Writing a value that overstates the isolation mechanism
into the file every rule reads is the ProToolHub trap in a subtler form.

**`compliance.entity` — five fields still needed from the operator:**
`legal_name`, `address`, `email`, `mersis`, `kep`. All schema-required, all
substituted into pages that do not yet exist. The repository is **private**, so
these do not become public by being committed.

**`ci.token_expires`** — needs the PAT to be created first.

### Now fillable, and worth recording

    project_id            ai-chatbot-widget-saas
    stack.framework       nextjs-14-app-router          (next 14.2.33 — exact)
    stack.db              supabase-postgres
    stack.auth            supabase-auth
    stack.payments        stripe
    stack.package_manager npm
    deploy.target         vercel
    deploy.prod_branch    master                         (remote default; main is the
                                                          abandoned unrelated line)
    deploy.site_url       https://ai-chatbot-widget-saa-s-chi.vercel.app
    risk_tier             standard
    environments.prod     supabase_ref ltjwsmiycijxrqxjsphq, protected: true
    env_sources.runtime   vercel-project-env
    standards.packs       nextjs-app-router, supabase-multitenant-rls, legal-tr-kvkk

`env_sources.required_keys` is now derivable — `vercel env ls` gives the
production names, `.env.example` was restored to `HEAD`'s accurate version, and
the code's twelve reads are enumerated in §2. It must include
`STRIPE_WEBHOOK_SECRET` and `VERCEL_OIDC_TOKEN`, which `.env.example` omits and
which `redact.mjs` will otherwise not scrub.

---

## 5. What is no longer a blocker

- **The remote is reachable and the account is right.** `gh` is authenticated as
  `mavcimavci1983-create`, the repo is **private** with `admin: true`, default
  branch `master`. `MAVCI_TOKEN` can be set.
- **`tsc --noEmit` exits 0** at `HEAD`; `next.config.mjs` sets no
  `output: "export"`; `package-lock.json` is present, so CI's three steps pass.
- **No hook-timeout risk.** 36 files, 0.33 MB, 2 ms walk against a 30 s budget.
- **The framework enum is exact.** No false value is required anywhere.

## 6. What to watch, unchanged from v1

- **Doctor will FAIL on the `gh` account** if the active account is
  `mavcimavci1983-create` while `SYSTEM_REPO` is owned by `mavci-ai-devsystem`.
  Correct behaviour, and it is Finding 8's argument for widening the check.
- **`.gitattributes`.** `render.mjs --config` does not write it, but connect's
  step 3.4 does if absent. `core.autocrlf` is `true` and ten files differ from
  the index in line endings only. Add it as its own commit on a clean tree, or
  not at all.
- **The baseline is taken over whatever tree exists at the moment it runs.** Nine
  paths are still uncommitted on purpose. `--baseline-init` runs once, ever.
  **Connect on a clean tree, after step 3, or the baseline records a state that
  is not the repository.** That is Finding 12, and it applies to us.
