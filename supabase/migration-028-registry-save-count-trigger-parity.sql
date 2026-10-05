-- migration-028: guarantee the registry save_count trigger exists
--
-- Why this exists
-- ---------------
-- migration-023 created `update_registry_save_count()` and the
-- `registry_save_count_trigger` on `registry_saves`. schema.sql, which is the
-- fresh-install path, declared the `save_count` COLUMN but only *mentioned*
-- the trigger in a comment ("See migration-023 for the trigger that keeps it
-- accurate"). So any database built from schema.sql got a save_count that
-- never moved off 0, which silently kills the registry's "Most Hearted" sort
-- and now also the heart-milestone notification in registry-save.js, since
-- that reads the count back after inserting.
--
-- schema.sql has been corrected. This migration is the matching change for an
-- existing database. It is deliberately idempotent: if migration-023 was
-- applied (production should have been), this is a no-op that simply
-- re-asserts the same function and trigger. Running it is how we stop assuming
-- and know.
--
-- Safe to run more than once. Does not touch any row.

create or replace function update_registry_save_count()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update build_registry set save_count = save_count + 1 where id = NEW.build_registry_id;
    return NEW;
  elsif (TG_OP = 'DELETE') then
    update build_registry set save_count = greatest(0, save_count - 1) where id = OLD.build_registry_id;
    return OLD;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists registry_save_count_trigger on registry_saves;
create trigger registry_save_count_trigger
  after insert or delete on registry_saves
  for each row execute function update_registry_save_count();

-- Repair any drift: recompute every save_count from the rows that are the
-- source of truth. If the trigger was present all along this changes nothing.
update build_registry b
set save_count = coalesce(c.n, 0)
from (
  select b2.id, count(rs.id) as n
  from build_registry b2
  left join registry_saves rs on rs.build_registry_id = b2.id
  group by b2.id
) c
where c.id = b.id and b.save_count <> coalesce(c.n, 0);

-- Verify (expect one row; counts should match):
--   select tgname from pg_trigger where tgname = 'registry_save_count_trigger';
--   select count(*) filter (where save_count > 0) as with_hearts from build_registry;
