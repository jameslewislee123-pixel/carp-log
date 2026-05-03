-- Tackle DB UI introduces a hook field on catches (optional, free text).
alter table public.catches add column if not exists hook text;
