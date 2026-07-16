-- Run this if you already ran migration-013 before the Data Team existed.
-- Fresh setups can just run schema.sql — it already includes this.

-- item_values already exists with a unique constraint missing `source` —
-- drop and recreate that constraint to include it.
alter table item_values add column if not exists source text not null default 'verified'
  check (source in ('verified', 'data_team'));
alter table item_values drop constraint if exists item_values_category_item_id_variant_potion_value_unit_key;
alter table item_values add constraint item_values_category_item_id_variant_potion_value_unit_source_key
  unique (category, item_id, variant, potion, value_unit, source);

alter table profiles add column if not exists is_data_team_member boolean not null default false;

create table if not exists data_team_applications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists data_team_applications_status_idx on data_team_applications(status);

alter table data_team_applications enable row level security;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
