-- ────────────────────────────────────────────────────────────────────────────
-- Carp Log v3.3 — rod_spots.swim_group_id
--
-- Carp anglers usually fish 2-4 rods from a single swim. The original
-- rod_spots schema (0016) was one rod per row with no concept of sibling
-- rods. Adding swim_group_id lets us collapse multiple rods cast from the
-- same swim under one swim icon and one "My spots" group header.
--
-- DEFAULT gen_random_uuid() means existing rows each get a unique group
-- on backfill — they're treated as solo-rod swims, no behaviour change.
-- New multi-rod placements share a swim_group_id explicitly assigned
-- client-side from the first spot in the group.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.rod_spots
  add column if not exists swim_group_id uuid not null default gen_random_uuid();

create index if not exists idx_rod_spots_swim_group
  on public.rod_spots(swim_group_id);
