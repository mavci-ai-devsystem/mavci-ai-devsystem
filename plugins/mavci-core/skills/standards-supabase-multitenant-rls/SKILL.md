---
name: standards-supabase-multitenant-rls
description: Mandatory Supabase patterns for multi-tenant Mavci SaaS - per-request client construction, row level security on every table, and strict service-role key containment. Load before writing any data access, migration or Supabase client code.
---

# Supabase multi-tenant standards

## `next.supabase_client_in_function` — never create a client at module scope

```ts
// WRONG - one client shared by every request in the process
export const supabase = createServerClient(url, key, { cookies })

// RIGHT - a factory, called per request
export function createClient() {
  const cookieStore = cookies()
  return createServerClient(url, anonKey, { cookies: { /* ... */ } })
}
```

A module-scope client captures whatever auth context existed when the module was
first evaluated, then serves it to every subsequent request in that process. In a
multi-tenant app that is a cross-tenant data leak, and it only appears under
concurrency — so it passes local testing and fails in production under load.

This is the most expensive mistake available on this stack. The rule has no
exceptions.

## `supabase.rls_enabled` — every table has row level security enabled

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null
);

alter table projects enable row level security;

create policy projects_tenant_isolation on projects
  for all
  using (org_id = (select org_id from members where user_id = auth.uid()));
```

Without RLS the anon key reads every row. Supabase's default is permissive: a
table you create and forget about is a table every authenticated user can read.
Enable RLS **in the same migration that creates the table** — a follow-up
migration is a window, and windows get shipped.

Phase 1 checks that RLS is enabled. Checking that a matching *policy* exists and
references the tenant column needs real SQL parsing and arrives in Phase 2. Until
then: enabling RLS with no policy denies everything, which is loud and safe. Do
not stop at enabling it.

## `next.no_service_role_client` — the service-role key never leaves the server

The service-role key **bypasses RLS completely**. It may appear only in:

- `lib/supabase/server.ts` (or `src/lib/supabase/server.ts`)
- `app/api/**/route.ts`
- `lib/env.ts`, for validation

Never in a component, a page, a hook, or anything reachable from a client bundle.
A `NEXT_PUBLIC_` prefix on it is an immediate incident: rotate the key.

When a route needs elevated access, construct an admin client inside the handler,
use it for the one operation that needs it, and never return it or pass it
outward.

## Tenant column

The manifest declares `tenancy.tenant_column`, usually `org_id`. Every
tenant-scoped table carries it, `not null`, with a foreign key. A nullable tenant
column is a row that belongs to nobody and is visible to everybody.

## Related

- `/mavci-core:standards-nextjs-app-router` — where these clients get used
