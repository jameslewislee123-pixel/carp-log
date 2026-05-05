-- ────────────────────────────────────────────────────────────────────────────
-- Carp Log v3.4 — rod_spots.bottom_type
--
-- Anglers describe what's under the bait — gravel, silt, weed, snags. The
-- existing free-text `features` column is for nuance ("gravel patch with
-- weed surround, drop-off behind"); bottom_type is the categorical
-- baseline used for at-a-glance icons on the map and for grouping/filter
-- in future iterations.
--
-- Optional column (nullable). No CHECK constraint — the canonical list
-- lives in lib/bottomTypes.ts so we can extend it without a migration.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.rod_spots
  add column if not exists bottom_type text;

create index if not exists idx_rod_spots_bottom_type
  on public.rod_spots(bottom_type);
