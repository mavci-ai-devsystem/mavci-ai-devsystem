# __DISPLAY_NAME__

Multi-tenant SaaS on Next.js 14 App Router, Supabase, Stripe and Resend.
Deployed to __DEPLOY_TARGET__.

## How this project is governed

This project is governed by the **mavci-core** plugin. The standards are not in
this file — they live in skills that load when relevant, and they are enforced by
a checker that runs when a turn ends and in CI:

- `/mavci-core:standards-nextjs-app-router`
- `/mavci-core:standards-supabase-multitenant-rls`
- `/mavci-core:standards-legal-tr-kvkk`

Read the relevant pack before writing code in its area. The checker will fail the
turn otherwise, and reading the pack first is faster than being told twice.

## Commands

| Command | Use |
|---|---|
| `/mavci-core:plan "<request>"` | Turn a request into a spec with checkable criteria |
| `/mavci-core:build <id>` | Implement an approved spec |
| `/mavci-core:verify [id]` | Full checker, types, build, and criteria review |
| `/mavci-core:doctor` | Health, drift, baseline debt, expiring waivers |
| `/mavci-core:waive <check> <path> <reason>` | Operator-only exception for a false positive |

## Non-negotiables

These are enforced, not requested. Each names the check that enforces it.

- **Supabase clients are created inside functions, never at module scope.**
  `next.supabase_client_in_function`
- **Every `app/api/**/route.ts` exports `const dynamic = 'force-dynamic'`.**
  `next.route_force_dynamic`
- **`process.env` is read only in `lib/env.ts`.** `next.env_centralised`
- **`next.config` never sets `output: 'export'`.** `next.no_static_export`
- **No RegExp built from a template literal.** `next.regex_no_template_literal`
- **Every table enables RLS in the migration that creates it.** `supabase.rls_enabled`
- **`SUPABASE_SERVICE_ROLE_KEY` never leaves server-only modules.** `next.no_service_role_client`
- **The Stripe webhook verifies its signature before trusting the payload.** `stripe.webhook_signature`
- **No secret value is ever committed.** `secrets.no_committed_secrets` — critical,
  and the only check that can be neither baselined nor waived.

## State

`.mavci/` holds the project manifest, task specs and lessons.
`.mavci/control/` is the **control plane** — phase, retry ceiling, verdicts,
baseline and waivers. It is written only by `state.mjs` and is denied to every
agent, including by a permission rule. If you are blocked, escalate; do not try
to edit what governs you.

## Pre-existing debt

Violations that existed when this repo was connected are recorded in
`.mavci/control/baseline.json`. They do not block. **New violations do.** The
baseline can only shrink: `/mavci-core:verify` retires entries automatically as
they are fixed.

## Legal text

The pages under `app/(legal)/` are drafts carrying a `REVIEW REQUIRED` marker.
The checker verifies the required sections are present; it cannot judge legal
sufficiency and does not claim to. A lawyer must review them before launch.
