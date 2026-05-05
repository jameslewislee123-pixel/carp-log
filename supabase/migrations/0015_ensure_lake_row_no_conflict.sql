-- ============================================================
-- Carp Log v3.2 — ensure_lake_row: drop ON CONFLICT path
--
-- The prior version (defined in 0007_polish_and_likes.sql) used
--   INSERT INTO lakes ... ON CONFLICT (lower(name)) DO UPDATE ...
-- which depends on a partial unique index on lower(name). That index
-- was dropped during a manual seed-import fix-up, so every catch
-- insert now fails with Postgres 42P10 ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification").
--
-- Rewrites the function to use a SELECT-then-INSERT pattern with no
-- constraint dependency, and re-binds the trigger as BEFORE so that
-- assigning NEW.lake_id actually persists onto the row (the AFTER
-- registration in 0005 ignored the returned NEW and relied on a
-- recursive UPDATE).
--
-- Idempotent: safe to re-run.
-- ============================================================

drop trigger if exists catches_ensure_lake on public.catches;

create or replace function public.ensure_lake_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_lake_id uuid;
begin
  -- Client (AddCatch.handleSave -> db.resolveOrCreateLake) already
  -- linked the canonical lake. Trust it.
  if new.lake_id is not null then
    return new;
  end if;

  -- Nothing to resolve.
  if new.lake is null or btrim(new.lake) = '' then
    return new;
  end if;

  -- Case-insensitive, trim-tolerant lookup against any existing lake
  -- (user-related, seed dataset, OSM/Nominatim picks).
  select id into existing_lake_id
  from public.lakes
  where lower(btrim(name)) = lower(btrim(new.lake))
  limit 1;

  if existing_lake_id is not null then
    new.lake_id := existing_lake_id;
    return new;
  end if;

  -- No match -- create a manual lake row at the catch's coords.
  -- created_by is the angler so RLS policies that gate by ownership
  -- stay happy.
  insert into public.lakes (name, latitude, longitude, source, created_by)
  values (
    btrim(new.lake),
    new.latitude,
    new.longitude,
    'manual',
    new.angler_id
  )
  returning id into existing_lake_id;

  new.lake_id := existing_lake_id;
  return new;
end;
$$;

create trigger catches_ensure_lake
  before insert or update of lake, latitude, longitude on public.catches
  for each row execute function public.ensure_lake_row();
