-- ============================================================
-- Carp Log v2.3 — mega upgrade
-- New: trip swim rolls (dice), gear database, lakes + annotations
-- ============================================================

-- 1. trip_swim_rolls ---------------------------------------------------------
-- One row per re-roll. The roll itself is an array of {angler_id, value} pairs.
create table if not exists public.trip_swim_rolls (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  rolled_by   uuid not null references public.profiles(id) on delete cascade,
  -- results: jsonb array of { angler_id: uuid, value: int }, sorted desc by value.
  results     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists trip_swim_rolls_trip_idx on public.trip_swim_rolls(trip_id, created_at desc);

alter table public.trip_swim_rolls enable row level security;
drop policy if exists "trip_swim_rolls_select" on public.trip_swim_rolls;
create policy "trip_swim_rolls_select" on public.trip_swim_rolls for select
  using (public.is_joined_member(trip_id, auth.uid()));
drop policy if exists "trip_swim_rolls_insert" on public.trip_swim_rolls;
create policy "trip_swim_rolls_insert" on public.trip_swim_rolls for insert
  with check (
    rolled_by = auth.uid()
    and exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
  );
drop policy if exists "trip_swim_rolls_delete" on public.trip_swim_rolls;
create policy "trip_swim_rolls_delete" on public.trip_swim_rolls for delete
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_swim_rolls') then
    alter publication supabase_realtime add table public.trip_swim_rolls;
  end if;
end $$;

-- 2. gear_items --------------------------------------------------------------
do $$ begin create type gear_type as enum ('rig', 'bait', 'hook'); exception when duplicate_object then null; end $$;

create table if not exists public.gear_items (
  id           uuid primary key default uuid_generate_v4(),
  angler_id    uuid not null references public.profiles(id) on delete cascade,
  type         gear_type not null,
  name         text not null check (char_length(name) between 1 and 80),
  description  text check (char_length(description) <= 500),
  shared       boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists gear_items_angler_type_idx on public.gear_items(angler_id, type, active);
create index if not exists gear_items_shared_idx on public.gear_items(shared) where shared = true;
drop trigger if exists gear_items_bump on public.gear_items;
create trigger gear_items_bump before update on public.gear_items for each row execute function public.bump_updated_at();

alter table public.gear_items enable row level security;
drop policy if exists "gear_items_select" on public.gear_items;
create policy "gear_items_select" on public.gear_items for select
  using (
    angler_id = auth.uid()
    or (shared = true and public.is_friend(angler_id, auth.uid()))
  );
drop policy if exists "gear_items_insert_own" on public.gear_items;
create policy "gear_items_insert_own" on public.gear_items for insert with check (angler_id = auth.uid());
drop policy if exists "gear_items_update_own" on public.gear_items;
create policy "gear_items_update_own" on public.gear_items for update using (angler_id = auth.uid());
drop policy if exists "gear_items_delete_own" on public.gear_items;
create policy "gear_items_delete_own" on public.gear_items for delete using (angler_id = auth.uid());

-- 3. lakes -------------------------------------------------------------------
create table if not exists public.lakes (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  latitude    numeric,
  longitude   numeric,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- Case-insensitive uniqueness via expression index.
create unique index if not exists lakes_name_lower_idx on public.lakes (lower(name));

alter table public.lakes enable row level security;
drop policy if exists "lakes_select_auth" on public.lakes;
create policy "lakes_select_auth" on public.lakes for select to authenticated using (true);
drop policy if exists "lakes_insert_auth" on public.lakes;
create policy "lakes_insert_auth" on public.lakes for insert to authenticated with check (true);
drop policy if exists "lakes_update_creator" on public.lakes;
create policy "lakes_update_creator" on public.lakes for update using (created_by = auth.uid());
drop policy if exists "lakes_delete_creator" on public.lakes;
create policy "lakes_delete_creator" on public.lakes for delete using (created_by = auth.uid());

-- Auto-create lakes row when a catch lands a never-seen-before lake name.
create or replace function public.ensure_lake_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.lake is null or btrim(new.lake) = '' then return new; end if;
  v_name := btrim(new.lake);
  insert into public.lakes (name, latitude, longitude, created_by)
  values (v_name, new.latitude, new.longitude, new.angler_id)
  on conflict (lower(name)) do update set
    latitude  = coalesce(public.lakes.latitude, excluded.latitude),
    longitude = coalesce(public.lakes.longitude, excluded.longitude);
  return new;
end $$;
drop trigger if exists catches_ensure_lake on public.catches;
create trigger catches_ensure_lake
  after insert or update of lake, latitude, longitude on public.catches
  for each row execute function public.ensure_lake_row();

-- 4. lake_annotations --------------------------------------------------------
do $$ begin create type lake_annotation_type as enum ('productive_spot', 'snag', 'note', 'hot_spot'); exception when duplicate_object then null; end $$;

create table if not exists public.lake_annotations (
  id           uuid primary key default uuid_generate_v4(),
  lake_id      uuid not null references public.lakes(id) on delete cascade,
  angler_id    uuid not null references public.profiles(id) on delete cascade,
  type         lake_annotation_type not null,
  latitude     numeric not null,
  longitude    numeric not null,
  title        text not null check (char_length(title) between 1 and 60),
  description  text check (char_length(description) <= 300),
  created_at   timestamptz not null default now()
);
create index if not exists lake_annotations_lake_idx on public.lake_annotations(lake_id);

-- "Has fished this lake" check: any catch by viewer at that lake (by name match).
create or replace function public.has_fished_lake(p_lake_id uuid, p_viewer uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.catches c
    join public.lakes l on lower(l.name) = lower(c.lake)
    where l.id = p_lake_id and c.angler_id = p_viewer
  );
$$;

alter table public.lake_annotations enable row level security;
drop policy if exists "lake_annotations_select" on public.lake_annotations;
create policy "lake_annotations_select" on public.lake_annotations for select
  using (angler_id = auth.uid() or public.has_fished_lake(lake_id, auth.uid()));
drop policy if exists "lake_annotations_insert_self" on public.lake_annotations;
create policy "lake_annotations_insert_self" on public.lake_annotations for insert
  with check (angler_id = auth.uid() and public.has_fished_lake(lake_id, auth.uid()));
drop policy if exists "lake_annotations_update_self" on public.lake_annotations;
create policy "lake_annotations_update_self" on public.lake_annotations for update using (angler_id = auth.uid());
drop policy if exists "lake_annotations_delete_self" on public.lake_annotations;
create policy "lake_annotations_delete_self" on public.lake_annotations for delete using (angler_id = auth.uid());

-- 5. Backfill: ensure lakes rows exist for existing catches.
insert into public.lakes (name, latitude, longitude, created_by)
select btrim(c.lake) as name,
       (array_agg(c.latitude  order by c.created_at) filter (where c.latitude is not null))[1],
       (array_agg(c.longitude order by c.created_at) filter (where c.longitude is not null))[1],
       (array_agg(c.angler_id order by c.created_at))[1]
from public.catches c
where c.lake is not null and btrim(c.lake) <> ''
group by lower(btrim(c.lake)), btrim(c.lake)
on conflict (lower(name)) do nothing;
