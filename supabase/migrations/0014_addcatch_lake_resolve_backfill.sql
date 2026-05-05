-- ============================================================
-- Carp Log v3.1 — AddCatch lake_id link backfill
--
-- catches.lake_id was added in 0007 alongside the ensure_lake_row
-- trigger and an initial backfill UPDATE. AddCatch now also resolves
-- and links lake_id at save-time client-side (db.resolveOrCreateLake)
-- so a typed "Linear" links to the existing seed lake "Linear" instead
-- of triggering creation of a duplicate manual row.
--
-- This migration:
--   1. Re-runs the lake_id backfill so any catches that landed without
--      a lake_id since 0007 are linked to their canonical lake row by
--      case-insensitive name match. Idempotent.
--   2. Bookmarks every (angler, lake) pair the user has caught at, so
--      catches surfaced via lake_id all show up in the angler's Lakes
--      tab — matching the implicit relationship that a catch at a lake
--      means the angler considers that lake theirs.
-- ============================================================

-- 1. Backfill catch.lake_id from matching lake names (case-insensitive,
--    trim-tolerant). Only touches rows where lake_id is currently null.
update public.catches c
set lake_id = l.id
from public.lakes l
where c.lake_id is null
  and c.lake is not null
  and lower(btrim(c.lake)) = lower(btrim(l.name));

-- 2. Auto-bookmark lakes for anglers that have caught there. on conflict
--    do nothing so re-running this migration is safe.
insert into public.user_saved_lakes (user_id, lake_id)
select distinct c.angler_id, c.lake_id
from public.catches c
where c.lake_id is not null
on conflict (user_id, lake_id) do nothing;
