-- Deprecates the 'commission' listing_type in favor of the Builder Profile
-- system (is_builder + commission_status on profiles, browsable at
-- commissions/index.html) — the two were redundant, and mixing "quote on
-- request" service posts into Browse Houses (a page about actual houses
-- being traded) was genuinely confusing.
--
-- Safe for existing data: this does NOT delete or touch any existing rows.
-- Any legacy listing_type='commission' rows simply stop being creatable
-- and are excluded from all public browse views by the application code
-- (listings-list.js, the homepage, list-a-house.html) — they just quietly
-- stop showing up anywhere. house_id is NOT forced to NOT NULL here even
-- though schema.sql has it that way for fresh installs, since an existing
-- database may have old commission rows with a null house_id and this
-- migration shouldn't fail on those.

alter table listings drop constraint if exists listings_listing_type_check;
alter table listings add constraint listings_listing_type_check
  check (listing_type in ('house_trade', 'looking_for'));

alter table listings drop constraint if exists house_id_required_for_house_listings;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
