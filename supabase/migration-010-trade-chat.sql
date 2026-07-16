-- Run this if you already ran schema.sql before trade chat existed.
-- Fresh setups can just run schema.sql — it already includes this.

create table if not exists trade_chat_messages (
  id uuid primary key default gen_random_uuid(),
  context_type text not null check (context_type in ('offer', 'commission')),
  context_id uuid not null,
  sender_profile_id uuid not null references profiles(id) on delete cascade,
  preset_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists trade_chat_messages_context_idx on trade_chat_messages(context_type, context_id);

alter table trade_chat_messages enable row level security;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
