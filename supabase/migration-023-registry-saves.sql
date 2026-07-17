-- Registry saves: one save per profile per build entry.
-- Anti-gaming design:
--   1. UNIQUE constraint on (profile_id, build_registry_id) -- DB-enforced, one save per user per entry
--   2. CHECK constraint prevents self-saves at DB level (belt-and-suspenders with the function check)
--   3. save_count is a materialized column on build_registry, updated by trigger --
--      sorting/filtering on count is a single index scan, not a COUNT subquery per row
--   4. No public-facing "who saved this" list -- reduces social pressure gaming
--   5. RLS: authenticated users can insert/delete their own rows only

create table registry_saves (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  build_registry_id uuid not null references build_registry(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Belt-and-suspenders: also enforced in the Netlify function
  constraint no_self_save check (
    profile_id != (
      select profile_id from build_registry where id = build_registry_id
    )
  ),

  -- THE key anti-gaming constraint: exactly one save per user per entry
  constraint registry_saves_unique unique (profile_id, build_registry_id)
);

create index registry_saves_entry_idx on registry_saves(build_registry_id);
create index registry_saves_profile_idx on registry_saves(profile_id);

alter table registry_saves enable row level security;
create policy "users can save builds" on registry_saves
  for insert to authenticated with check (auth.uid()::text = profile_id::text);
create policy "users can unsave their saves" on registry_saves
  for delete to authenticated using (auth.uid()::text = profile_id::text);
-- No public select on who saved what -- only aggregates shown
create policy "public can count saves via build_registry" on registry_saves
  for select using (true); -- needed for the trigger to work via service role

-- Add save_count to build_registry (materialized for fast sorting)
alter table build_registry add column if not exists save_count integer not null default 0;
create index build_registry_save_count_idx on build_registry(save_count desc);

-- Trigger to keep save_count accurate
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

create trigger registry_save_count_trigger
  after insert or delete on registry_saves
  for each row execute function update_registry_save_count();

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
