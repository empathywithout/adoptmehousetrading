-- Run this if you already ran schema.sql before item_values existed.
-- Fresh setups can just run schema.sql — it already includes this.

create table if not exists item_values (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  item_id text not null,
  variant text,
  potion text,
  value_unit text not null check (value_unit in ('shark', 'frost')),
  value_low numeric not null,
  value_high numeric not null,
  sample_size int not null default 0,
  updated_at timestamptz not null default now(),
  unique (category, item_id, variant, potion, value_unit)
);

create index if not exists item_values_lookup_idx on item_values(category, item_id, variant, potion);

alter table item_values enable row level security;
create policy "public can read item values" on item_values
  for select using (true);

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
