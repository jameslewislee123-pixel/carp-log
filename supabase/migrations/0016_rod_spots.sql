-- ────────────────────────────────────────────────────────────────────────────
-- Carp Log v3.2 — rod_spots
--
-- Per-user, per-lake bookmarks for "swim → bait" lines. An angler sits at a
-- swim and casts to a spot; we store both points and the calculated wrap
-- count (12ft rod fixed, ~7.32m per round trip). User can override the
-- auto-calc with their measured value.
--
-- Private to the creator: no sharing yet, no friend visibility. RLS only
-- exposes own rows.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.rod_spots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lake_id uuid not null references public.lakes(id) on delete cascade,

  -- Swim (where the angler is)
  swim_latitude  numeric not null,
  swim_longitude numeric not null,
  swim_label     text,

  -- Spot (where the bait is)
  spot_latitude  numeric not null,
  spot_longitude numeric not null,
  spot_label     text,

  -- Wraps. wraps_calculated is what haversine gave us at save-time;
  -- wraps_actual is the angler's override after wrapping it for real.
  wraps_calculated int,
  wraps_actual     int,

  features text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rod_spots_user_lake
  on public.rod_spots(user_id, lake_id);

alter table public.rod_spots enable row level security;

drop policy if exists "users_read_own_rod_spots" on public.rod_spots;
create policy "users_read_own_rod_spots" on public.rod_spots
  for select using (auth.uid() = user_id);

drop policy if exists "users_insert_own_rod_spots" on public.rod_spots;
create policy "users_insert_own_rod_spots" on public.rod_spots
  for insert with check (auth.uid() = user_id);

drop policy if exists "users_update_own_rod_spots" on public.rod_spots;
create policy "users_update_own_rod_spots" on public.rod_spots
  for update using (auth.uid() = user_id);

drop policy if exists "users_delete_own_rod_spots" on public.rod_spots;
create policy "users_delete_own_rod_spots" on public.rod_spots
  for delete using (auth.uid() = user_id);
