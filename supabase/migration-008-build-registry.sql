-- Run this if you already ran schema.sql before the build registry existed.
-- Fresh setups can just run schema.sql — it already includes this.

create table if not exists build_registry (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text,
  photos jsonb not null default '[]',
  themes jsonb not null default '[]',
  house_id text,
  possible_duplicate_of uuid references build_registry(id),
  status text not null default 'active' check (status in ('active', 'disputed', 'confirmed_clone', 'confirmed_original')),
  created_at timestamptz not null default now()
);

create index if not exists build_registry_profile_idx on build_registry(profile_id);
create index if not exists build_registry_status_idx on build_registry(status);

alter table build_registry enable row level security;
create policy "public can read build registry entries" on build_registry
  for select using (true);

create table if not exists build_registry_disputes (
  id uuid primary key default gen_random_uuid(),
  build_registry_id uuid not null references build_registry(id) on delete cascade,
  disputer_profile_id uuid not null references profiles(id) on delete cascade,
  claim text not null,
  claimed_original_entry_id uuid references build_registry(id),
  status text not null default 'pending' check (status in ('pending', 'upheld', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists build_registry_disputes_entry_idx on build_registry_disputes(build_registry_id);

alter table build_registry_disputes enable row level security;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
