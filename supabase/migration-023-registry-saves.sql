-- Registry saves: one save per profile per build entry.
-- Anti-gaming design:
--   1. UNIQUE constraint on (profile_id, build_registry_id) -- one save per user per entry
--   2. Self-save prevention enforced in registry-save.js (Postgres CHECK constraints
--      cannot use subqueries, so this lives at the function layer where all writes go)
--   3. save_count is a materialized column on build_registry, updated by trigger --
--      sorting/filtering on count is a single index scan, not a COUNT subquery per row
--   4. No public-facing "who saved this" list -- reduces social pressure gaming
--   5. Rate limit (30 saves/hour) in registry-save.js

create table if not exists registry_saves (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  build_registry_id uuid not null references build_registry(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint registry_saves_unique unique (profile_id, build_registry_id)
);

create index if not exists registry_saves_entry_idx on registry_saves(build_registry_id);
create index if not exists registry_saves_profile_idx on registry_saves(profile_id);

alter table registry_saves enable row level security;
create policy "public can count saves via build_registry" on registry_saves
  for select using (true);

alter table build_registry add column if not exists save_count integer not null default 0;
create index if not exists build_registry_save_count_idx on build_registry(save_count desc);

create or replace function update_registry_save_count()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    update build_registry set save_count = save_count + 1 where id = NEW.build_registry_id;
    return NEW;
  elsif TG_OP = 'DELETE' then
    update build_registry set save_count = greatest(0, save_count - 1) where id = OLD.build_registry_id;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists registry_save_count_trigger on registry_saves;
create trigger registry_save_count_trigger
  after insert or delete on registry_saves
  for each row execute function update_registry_save_count();

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
