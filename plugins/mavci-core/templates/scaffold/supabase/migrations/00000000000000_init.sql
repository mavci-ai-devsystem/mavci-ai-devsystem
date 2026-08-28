-- Every table enables RLS in the SAME migration that creates it.
-- A follow-up migration is a window, and windows get shipped.
-- Enforced by supabase.rls_enabled.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table orgs enable row level security;

create table members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  unique (org_id, user_id)
);
alter table members enable row level security;

create policy members_self on members
  for select using (user_id = auth.uid());

create policy orgs_tenant_isolation on orgs
  for all using (
    id in (select org_id from members where user_id = auth.uid())
  );

-- Webhook idempotency: Stripe retries, and a retried
-- checkout.session.completed must not grant the plan twice.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
