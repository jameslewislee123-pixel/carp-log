-- ============================================================
-- Carp Log v2.7 — trips.lake_id foreign key
--
-- Trips currently store a free-text `location` column. New trips also
-- pin to a row in the `lakes` table so the Lakes tab can include
-- "lakes you have a trip at, even if no catches yet" and so the trip
-- detail can render lake name + map without geocoding the free text.
--
-- Existing trips keep their `location` text — the column is preserved
-- and the new lake_id is nullable. Trip detail prefers lake_id when
-- set, falls back to location text otherwise.
-- ============================================================

alter table public.trips
  add column if not exists lake_id uuid references public.lakes(id) on delete set null;

create index if not exists trips_lake_id_idx on public.trips (lake_id);
