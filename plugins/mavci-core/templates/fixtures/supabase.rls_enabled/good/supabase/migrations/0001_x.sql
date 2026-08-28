create table widgets (id uuid primary key, org_id uuid not null);
alter table widgets enable row level security;
create policy widgets_tenant on widgets for all using (org_id = auth.uid());
