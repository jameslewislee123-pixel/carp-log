-- ============================================================
-- Carp Log v2.9 — seed lake support + ILIKE-friendly search
--
-- Once we bulk-import UK fisheries (and later France), `lakes` grows
-- from ~dozens to ~thousands of rows. Two things this migration does:
--
--   1. Unique constraint on (name, latitude, longitude). The importer
--      upserts with onConflict='lakes_name_coords_unique' so re-runs
--      are idempotent and don't create duplicates.
--
--   2. Functional btree index on lower(name) so the AddLakeModal seed
--      search (`ilike '%query%'`) stays fast at 2,000+ rows. ILIKE
--      with a leading wildcard can't use a regular index, but the
--      planner still prefers the lower(name) index for prefix scans
--      and for sort-after-filter cases. For ~5K rows even a full scan
--      is sub-100ms; the index buys headroom for future growth.
--
-- Note: 'seed' is added as a permitted value at the application layer
-- (lib/types.ts LakeSource); the lakes.source column is text, so no
-- check constraint changes are needed here.
-- ============================================================

-- 1. Unique constraint for upsert dedupe
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lakes_name_coords_unique'
  ) then
    alter table public.lakes
      add constraint lakes_name_coords_unique
      unique (name, latitude, longitude);
  end if;
end $$;

-- 2. lower(name) index for ILIKE search after seed import
create index if not exists idx_lakes_lower_name
  on public.lakes (lower(name));
