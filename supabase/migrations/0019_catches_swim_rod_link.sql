-- ────────────────────────────────────────────────────────────────────────────
-- Carp Log v3.5 — link catches to swim_group_id + rod_spot_id
--
-- Adds two optional columns to catches so a logged fish can reference the
-- specific rod (and the swim it was cast from) the angler had pinned. The
-- existing free-text `swim` column stays — text-only swims still work and
-- legacy rows render unchanged.
--
-- swim_group_id is NOT a foreign key. rod_spots.swim_group_id isn't unique
-- (sibling rods share it), so we just store + index a UUID for lookups.
-- rod_spot_id IS a real FK; on rod_spot delete the catch keeps the row but
-- the link goes null (matches catches.lake_id semantics).
-- ────────────────────────────────────────────────────────────────────────────

alter table public.catches
  add column if not exists swim_group_id uuid,
  add column if not exists rod_spot_id   uuid references public.rod_spots(id) on delete set null;

create index if not exists idx_catches_rod_spot_id
  on public.catches(rod_spot_id);
create index if not exists idx_catches_swim_group_id
  on public.catches(swim_group_id);
