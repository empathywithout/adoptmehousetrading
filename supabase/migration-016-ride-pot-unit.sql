-- Adds Ride Pot (stored as 'rp') as a third valid value_unit, alongside
-- shark and frost, everywhere a value_unit exists. Run this against an
-- existing database. Fresh setups can just run schema.sql — it already
-- includes this.

alter table listings drop constraint if exists listings_value_unit_check;
alter table listings add constraint listings_value_unit_check
  check (value_unit in ('shark', 'frost', 'rp'));

alter table item_values drop constraint if exists item_values_value_unit_check;
alter table item_values add constraint item_values_value_unit_check
  check (value_unit in ('shark', 'frost', 'rp'));

alter table commission_requests drop constraint if exists commission_requests_offered_value_unit_check;
alter table commission_requests add constraint commission_requests_offered_value_unit_check
  check (offered_value_unit in ('shark', 'frost', 'rp'));

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
