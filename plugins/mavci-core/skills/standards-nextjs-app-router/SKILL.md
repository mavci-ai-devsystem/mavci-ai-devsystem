---
name: standards-nextjs-app-router
description: Mandatory Next.js 14 App Router patterns for Mavci SaaS projects - dynamic rendering on API routes, centralised environment access, no static export, safe regex construction. Load before writing or reviewing any route, page, config or middleware.
---

# Next.js App Router standards

Every rule names the `check_id` that enforces it. A rule with no check is a rule
with no teeth, so if you add one here, add the check too.

## `next.route_force_dynamic` — every API route exports `dynamic`

```ts
// app/api/anything/route.ts
export const dynamic = 'force-dynamic'
```

Next.js will statically evaluate a route handler at build time when it cannot
prove the handler is dynamic. For a tenant-scoped SaaS this is not a performance
question: a handler evaluated once at build serves one tenant's data to everyone,
or serves stale data forever. The failure is silent and appears in production,
not in `next build`.

Add it to **every** file matching `app/api/**/route.ts`, including ones that look
obviously dynamic today. "Obviously dynamic" changes the moment someone removes
the `cookies()` call.

A genuinely static, tenant-independent endpoint — a health probe — is the one
good case for `/mavci-core:waive` on this check.

## `next.env_centralised` — `process.env` is read in exactly one file

```ts
// lib/env.ts - the ONLY file that reads process.env
import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
})

export const env = schema.parse(process.env)
```

Everywhere else: `import { env } from '@/lib/env'`.

Scattered reads mean a missing variable becomes `undefined` deep inside a
request, usually surfacing as a confusing downstream error hours after deploy.
Centralised and validated, it fails at boot and names the variable.
`next.config.*`, `middleware.ts` and `scripts/` are exempt because they run
before or outside the module graph.

## `next.no_static_export` — never set `output: 'export'`

A static export silently drops API routes, middleware, server actions and
revalidation. On this stack that means auth, Stripe webhooks and tenant
resolution stop existing. It builds successfully and fails in production, which
is the worst combination available.

## `next.regex_no_template_literal` — do not build a RegExp from a template literal

```ts
// wrong - slug can inject pattern syntax, and a dot or slash changes the meaning
const re = new RegExp(`^/${slug}/(.*)$`)

// right - escape the interpolated value
const ESCAPE = /[.*+?^${}()|[\]\\]/g
const re = new RegExp('^/' + slug.replace(ESCAPE, '\\$&') + '/(.*)$')

// better - do not use a regex for a path comparison at all
if (pathname.startsWith('/' + slug + '/')) { /* ... */ }
```

This has cost real debugging time on this stack. A tenant slug containing a `.`
becomes a wildcard, and one tenant's middleware rule starts matching another
tenant's paths. A template literal with no interpolation is harmless and is not
flagged.

## Related

- `/mavci-core:standards-supabase-multitenant-rls` — data access and RLS
- `/mavci-core:standards-legal-tr-kvkk` — required pages
