-- Run this if you already ran migration-016 before notifications existed.
-- Fresh setups can just run schema.sql — it already includes this.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  message text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_unread_idx on notifications(profile_id, read, created_at desc);

alter table notifications enable row level security;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
