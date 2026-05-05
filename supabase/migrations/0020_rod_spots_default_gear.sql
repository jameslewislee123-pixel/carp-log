-- ────────────────────────────────────────────────────────────────────────────
-- Carp Log v3.6 — rod_spots default gear
--
-- Each rod spot can carry default gear (bait, rig, hook) the angler
-- typically uses there. AddCatch's SwimRodPicker auto-fills the catch's
-- bait/rig/hook from these defaults when a rod is picked, so logging a
-- repeat catch from a known spot becomes one tap.
--
-- All three are nullable FKs to gear_items with ON DELETE SET NULL — if
-- the angler retires the gear, the rod spot keeps working with the link
-- nulled out.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.rod_spots
  add column if not exists default_bait_id uuid references public.gear_items(id) on delete set null,
  add column if not exists default_rig_id  uuid references public.gear_items(id) on delete set null,
  add column if not exists default_hook_id uuid references public.gear_items(id) on delete set null;

create index if not exists idx_rod_spots_bait on public.rod_spots(default_bait_id);
create index if not exists idx_rod_spots_rig  on public.rod_spots(default_rig_id);
create index if not exists idx_rod_spots_hook on public.rod_spots(default_hook_id);
