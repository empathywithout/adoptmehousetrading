-- Run this if you already ran schema.sql before the commission system existed.
-- Fresh setups can just run schema.sql — it already includes this.

alter table profiles add column if not exists is_builder boolean not null default false;
alter table profiles add column if not exists builder_bio text;
alter table profiles add column if not exists commission_status text not null default 'closed'
  check (commission_status in ('open', 'closed'));
alter table profiles add column if not exists portfolio_photos jsonb not null default '[]';
alter table profiles add column if not exists builder_themes jsonb not null default '[]';

create table if not exists commission_requests (
  id uuid primary key default gen_random_uuid(),
  builder_profile_id uuid not null references profiles(id) on delete cascade,
  requester_profile_id uuid not null references profiles(id) on delete cascade,
  description text not null,
  agreed_scope text,
  themes jsonb not null default '[]',
  offered_items jsonb not null default '[]',
  offered_value_amount numeric,
  offered_value_unit text check (offered_value_unit in ('shark', 'frost')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'delivered', 'verified', 'cancelled')),
  delivery_photos jsonb not null default '[]',
  builder_confirmed boolean not null default false,
  requester_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commission_requests_builder_idx on commission_requests(builder_profile_id);
create index if not exists commission_requests_requester_idx on commission_requests(requester_profile_id);
create index if not exists commission_requests_status_idx on commission_requests(status);

alter table commission_requests enable row level security;

-- Re-run the Data API grants so the new table is reachable (same fix as
-- migration-003 — Supabase doesn't auto-expose new tables by default).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
