-- Run this if you already ran schema.sql before theme tags existed.
-- Fresh setups can just run schema.sql — it already includes this.

alter table listings add column if not exists themes jsonb not null default '[]';
alter table listings add column if not exists theme_note text;
