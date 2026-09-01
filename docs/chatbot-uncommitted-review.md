# Review: the 20+8 uncommitted change in AI-Chatbot-Widget-SaaS

> ## CORRECTION, 2026-09-01, after live probing — READ FIRST
>
> **Production runs the uncommitted working tree, not `HEAD`.** Everything below
> that says "HEAD is what deploys" is wrong. Vercel is serving a CLI upload
> (`.vercel/project.json` is present), which includes untracked files.
>
> Evidence, from public GETs against the live host:
>
>     /api/debug          200, body = {supabaseUrl, hasServiceRoleKey, hasServiceKey,
>                              hasAnthropicKey, data:[3 companies: id,name], error}
>                              -> that is the WORKING-TREE version. HEAD's returns
>                                 {jwtSecret, adminToken}.
>     /api/telegram/setup 405 (exists, POST-only)
>                              -> that file is untracked and in NO git ref.
>
> So the severe findings in section B and C are **live now**, not pending:
> unauthenticated tenant enumeration via `/api/debug`, the two unauthenticated
> Telegram routes, and the deleted rate limit.
>
> **And the deployment hazard:** hotfix `d710845` does not reach production by
> being merged, because production does not come from git. Worse, deploying
> `master` from git would **roll production back to `HEAD`**, removing the admin
> refactor, WhatsApp and Telegram. Reconcile git and the deployed artefact before
> merging anything.
>
> This is the third instance of the working-tree/`HEAD` error in this engagement,
> and the first in the dangerous direction: it was reported that the `/api/debug`
> leak was *not* in production. It is.

2026-09-01. Read-only. Nothing staged, nothing committed, nothing discarded.
Baseline is `HEAD` = `master` = `1fcf12f`, which is what Vercel deploys.
Scope: 20 modified tracked files (821 insertions, 748 deletions) + 8 untracked
paths. Method: control **presence** compared at `HEAD` vs working tree, not diff
lines — a rewrite deletes and re-adds, so counting `-` lines reports refactors as
regressions.

**Verdict: this is not one commit.** It is at least five separable pieces, one of
which should not be committed at all in its current form.

---

## Y. Deployment: no Vercel git integration — ESTABLISHED, not assumed

Two pushes to `master` were observed, each checked twice at different wall-clock
times, with the production alias resolved independently:

    push 1  d80c6c5           1 file   -> no new deployment; alias unchanged
    push 2  d80c6c5..4cfb8b6  7 commits, 16 files
                                       -> no new deployment; alias unchanged

Across both, the newest deployment stayed `nctlkpyfm` (Production, Ready, created
18:47:51), and `/api/debug` 404, `/api/telegram/setup` 404,
`/api/telegram/webhook` 405, `/api/widget.js` 200 were unchanged throughout.

Supporting evidence: `vercel project inspect` lists no connected Git Repository,
and **every deployment for 115 days is CLI-attributed** to `mavcimavci1983-create`.

**Established: this project has no Vercel git integration. Production comes from
CLI uploads only, and git and the deployed artefact are independent.** That is
Finding 12's environment confirmed by observation rather than inferred from
configuration.

Two limits worth keeping attached. This is two pushes on one branch, not a proof
about all refs. And it would stop being true the moment someone connects the repo
in the Vercel dashboard — a change nothing in git would show, and which no check
in this repository would notice.

---

## Z. The anon key cannot read the tenant tables — the good finding, with its limits

Established 2026-09-01 by direct probe, not inferred. Using
`NEXT_PUBLIC_SUPABASE_ANON_KEY` — the key that ships in every browser bundle and
in the widget script served to third-party sites — against PostgREST, with
`limit=0` so no rows were requested:

    GET /rest/v1/companies?select=id&limit=0      -> 401 permission denied for table companies
    GET /rest/v1/conversations?select=id&limit=0  -> 401 permission denied for table conversations

**The `anon` role holds no table-level `GRANT` on either tenant table.** The
request is refused before row filtering is reached. So the worst available
scenario — a public key in every visitor's browser plus RLS disabled, equalling a
full read of every tenant's data — **does not apply to these two tables.** That is
the first hard evidence on the exposure question and it is genuinely good news.

**Its limits, recorded as carefully as the result:**

- **Grants and RLS are separate mechanisms.** This establishes that `anon` was
  never granted `SELECT`. It says *nothing* about whether row level security is
  enabled, or whether any policy exists. RLS remains unverified.
- **Two tables, one role.** `companies` and `conversations`, against `anon` only.
  Other tables, and the `authenticated` role, are untested.
- **Every service-role path bypasses both.** All eight data-touching routes use
  `getSupabaseAdminClient()`, whose key ignores grants and RLS alike. The
  cross-tenant read in `/api/chat` is entirely unaffected — it runs as service
  role and always could.
- It is also why the WhatsApp migration's application status could not be
  established from the repository: the same `401` arrives before schema
  resolution, so the probe cannot distinguish a missing column from a present one.

**It narrows the exposure question; it does not close it.** What it removes is the
possibility that the browser-side key is itself a tenant-data leak. What remains
is everything reached through the service role — which is where every real finding
in this document lives.

---

## A. Control removals

### A1. The free-plan rate limit is gone, with no replacement — REGRESSION

`FREE_MESSAGE_LIMIT = 100` and the entire `message_count` / `billing_cycle_month`
mechanism are removed from `app/api/chat/route.ts`. At `HEAD` the route reads the
counter, returns **403** past 100 messages on the free plan, resets it monthly and
increments after each reply. In the working tree:

    message_count written by ... nothing, anywhere in the tree
    FREE_MESSAGE_LIMIT          absent from every file

`app/admin/dashboard/billing/page.tsx` also loses the usage display that read it.
So this is not "moved" — it is deleted end to end.

Two consequences. Free accounts become unmetered, and every message is a paid
Anthropic call on an endpoint that (per the hotfix commit) still accepts an
unauthenticated `companyId` from any origin. **This is the single change that
should not ship as-is.**

### A2. `jose` removed; JWT verification hand-rolled — REVIEW, then probably keep

`package.json` drops `jose`; `lib/admin-auth.ts` is reimplemented on
`node:crypto`. The implementation is, on inspection, **correct**:

- HMAC-SHA256 over `header.payload`, signature recomputed from the *provided*
  header, so `alg` confusion is not reachable — verification never dispatches on
  `alg`. Safe, though safe by construction rather than by an explicit check.
- `timingSafeEqual` guarded by a length comparison first (required — it throws on
  length mismatch).
- `exp` present and enforced; returns `null` rather than throwing.
- All three callers (`admin/company`, `onboarding/complete`, `stripe/checkout`)
  handle `null` and fail closed.

The concern is category, not correctness: unreviewed hand-rolled crypto replacing
a maintained library, in the auth path, inside an unreviewed diff. It reads as
having been done to dodge an install problem. Worth a deliberate decision.

### A3. Lint weakened — minor

`.eslintrc.json` drops `next/typescript` from `extends` and turns off
`no-unused-vars` and `@next/next/no-assign-module-variable`. The second is
plausibly needed for the generated widget script; the first two reduce coverage.

### A4. `.env.example` regressed — minor but it misled the earlier analysis

`HEAD` documented `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_WIDGET_SCRIPT_BASE`. The working tree
**deletes all four** — all four are still used by the code — and adds three
`TWILIO_*` keys and `DEFAULT_COMPANY_ID`, none of which the code uses.

Note for the manifest step: the `.env.example` drift I reported earlier was
*introduced by this diff*. `HEAD`'s version is the more accurate one.

### A5. NOT a removal, though it looks exactly like one

All three admin pages lose `verifyAdminToken`, the `admin_token` cookie read,
`redirect("/admin")` and `getSupabaseAdminClient`. This is a **legitimate
refactor**: the pages became `"use client"` components that `fetch("/api/admin/company")`,
and that route verifies the cookie, returns 401 without it, and — importantly —
takes `companyId` **from the verified token**, never from the request. On the
tenant-scoping axis this is *better* than `HEAD`.

Counting deleted lines would have scored this as three auth removals. It is the
reason this review compares presence, not diffs.

---

## B. Auth, tenant filtering, service-role

### B1. `app/api/telegram/setup` and `.../subscribe` — no auth, and the wrong tenant

Both are untracked, both unauthenticated, and both select their tenant like this:

    const { data: company } = await supabase.from('companies')
      .select('id').order('created_at', { ascending: false }).limit(1).single();

**Whichever company signed up most recently.** Not the caller's. There is no
caller identity at all.

- `setup` attaches a caller-supplied Telegram bot token to that company.
- `subscribe` creates a **Stripe subscription checkout session** for that company.

So an unauthenticated request writes to, and starts billing flows against, an
arbitrary tenant chosen by registration order. This is placeholder tenant
resolution that reached working code.

**The author knew.** `app/api/whatsapp/route.ts:128` carries the comment
*"DEFAULT_COMPANY_ID fallback'i de KULLANILMAZ - yanlis"* — the same anti-pattern,
identified and rejected, in the file written later. The telegram routes were not
revisited.

### B2. Four routes bypass the Supabase factory

`telegram/setup`, `telegram/subscribe`, `telegram/webhook` and `webhooks/stripe`
each construct `createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)` inline
rather than calling `getSupabaseAdminClient()`. Same key, no shared configuration,
four more places to fix anything. All are inside handlers, so no module-scope
client — that part is fine.

### B3. Passwords are compared in plaintext — pre-existing, made stranger

`app/api/admin/login/route.ts` compares `company.password !== password` directly.
No hashing, at `HEAD` or now. The working tree adds a guard against an empty
stored password (an improvement) and a three-way column fallback:

    company.password ?? company.admin_password ?? company.login_password ?? ""

Three candidate column names in an authentication path means nobody was sure which
column holds the credential. Not a regression, but it is the auth path and it is
plaintext.

### B4. `app/api/chat` — unchanged in substance

Still takes `companyId` from the body, still `Access-Control-Allow-Origin: *`,
still service-role. The pushed hotfix removed the returned tenant name; the hole
itself waits on the token design.

---

## C. The 8 untracked paths

| path | lines | assessment |
|---|---|---|
| `app/api/whatsapp/route.ts` | 324 | **Best code in the diff.** Resolves the tenant by `whatsapp_phone_number_id`, verifies via `whatsapp_verify_token`, returns 403 correctly, scopes by `company_id` + `session_id`. Explicitly rejects the fallback anti-pattern in a comment. |
| `app/api/telegram/webhook/route.ts` | 107 | Resolves tenant by `telegram_bot_token` from the payload — a shared secret, so semi-authenticated. Gates on `telegram_subscribed`. Acceptable; no Telegram secret-token header check. |
| `app/api/telegram/setup/route.ts` | 71 | **B1.** Unauthenticated, wrong tenant. |
| `app/api/telegram/subscribe/route.ts` | 52 | **B1.** Unauthenticated, wrong tenant, creates Stripe checkout. |
| `app/api/webhooks/stripe/route.ts` | 75 | Duplicate — see D1. Signature *is* verified. |
| `app/dashboard/telegram/page.tsx` | 59 | Small client page; reads `telegram_subscribed`. Fine. |
| `supabase/migrations/2026...whatsapp...sql` | 33 | Adds `whatsapp_number`, `whatsapp_company_id`, a unique constraint, a self-referencing FK and two indexes. **No `ENABLE ROW LEVEL SECURITY`, no policies** — consistent with the rest of the schema and with why `supabase.rls_enabled` reports nothing. |
| `chatbot-saas/` | — | Third unrelated project (root `fb084ac`). Not part of this work; move it out of the tree. |

---

## D. Duplicated features — you were right to ask

### D1. Two Stripe webhooks, same two events, different columns

`app/api/stripe/webhook/route.ts` (tracked, exists at `HEAD`) and
`app/api/webhooks/stripe/route.ts` (untracked) both verify signatures and both
handle `checkout.session.completed` and `customer.subscription.deleted`.

They write **different columns for the same fact**: the tracked one sets `plan`
and `stripe_subscription_id`; the untracked one sets `is_subscribed`,
`telegram_subscribed` and `telegram_stripe_subscription_id`.

`is_subscribed` is **written by that route and read by nothing** in the entire
tree — `plan` is what the app reads. So if the untracked URL is the one registered
in Stripe, a Pro purchase updates a column no code consults, and the customer does
not get their plan. Only one of these can be the registered endpoint; if both are
registered they race.

### D2. Two widget scripts, one dead

`app/widget.js/route.ts` (136 lines, **no** `force-dynamic`) and
`app/api/widget.js/route.ts` (186 lines, has it). The onboarding page hands
customers `${BASE}/api/widget.js?id=...`, so the top-level one is **orphaned** —
an earlier implementation nobody deleted. It is also the only route on disk
missing `force-dynamic`, which is why that rule flagged nothing useful.

### D3. Two channel integrations at different maturities

Telegram and WhatsApp solve the same problem — bind an external messaging channel
to a tenant. WhatsApp does it correctly; Telegram uses "most recent company". The
second was written first and never brought up to the first's standard.

---

## E. Half-finished

- `@supabase/ssr` added to `package.json`, **imported nowhere**. An SSR auth
  migration that was started and abandoned.
- `DEFAULT_COMPANY_ID` documented in `.env.example`, used nowhere, and explicitly
  rejected in a code comment.
- `is_subscribed` written, never read (D1).
- The three-column password fallback (B3).
- `app/widget.js/route.ts` orphaned (D2).
- `.env.example` documents Twilio while WhatsApp is implemented against Meta's
  Cloud API (`whatsapp_phone_number_id`, `whatsapp_verify_token`) — the Twilio
  keys are from an abandoned first approach.

---

## F. Suggested split

1. **Admin refactor** — the three dashboard pages + `app/api/admin/company` +
   `lib/admin-auth.ts` + `package.json` (`jose` removal) + `.eslintrc.json`.
   Coherent, defensible; decide A2 deliberately.
2. **WhatsApp integration** — `app/api/whatsapp/route.ts` + the migration.
   Best-quality piece. The migration is a production DB change and is yours.
3. **Telegram integration** — hold. Fix B1 first: both routes need real caller
   identity before they are committed.
4. **Stripe webhook consolidation** — decide D1 before committing either. Which
   URL is registered in Stripe? Delete the loser; reconcile `is_subscribed`
   against `plan`.
5. **Rate limit** — restore A1, or make its removal an explicit, separate,
   labelled decision.
6. Housekeeping: `.env.example` (revert A4 and add the real keys), delete the
   orphaned widget route, drop `@supabase/ssr` or use it, move `chatbot-saas/`
   out of the tree.

The chat-route changes in this diff will conflict with the pushed hotfix
`d710845`; resolve by keeping both — the rewrite plus the removed `company` field.
