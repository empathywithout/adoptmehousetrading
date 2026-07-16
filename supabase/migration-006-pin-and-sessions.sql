-- Run this if you already ran schema.sql before PIN protection / multi-session
-- support existed. Fresh setups can just run schema.sql — it already includes this.

alter table profiles alter column session_token_hash drop not null;
alter table profiles add column if not exists pin_hash text;
alter table profiles add column if not exists pin_salt text;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists sessions_profile_idx on sessions(profile_id);
create index if not exists sessions_token_idx on sessions(token_hash);

alter table sessions enable row level security;

-- Migrate any existing single-session tokens into the new table so nobody
-- currently signed in gets logged out by this change.
insert into sessions (profile_id, token_hash)
select id, session_token_hash from profiles
where session_token_hash is not null
on conflict (token_hash) do nothing;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
