-- ============================================================
-- Carp Log v2: multi-user with OAuth, friends, trip invites
-- WIPES old tables and rebuilds from scratch.
-- ============================================================

-- 0. Drop old objects ---------------------------------------------------------
drop table if exists public.notify_config cascade;
drop table if exists public.photos cascade;
drop table if exists public.catches cascade;
drop table if exists public.trips cascade;
drop table if exists public.anglers cascade;
drop table if exists public.app_config cascade;
drop function if exists public.bump_updated_at() cascade;

-- 1. Helpers ------------------------------------------------------------------
create extension if not exists "uuid-ossp";

create or replace function public.bump_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- 2. Enums --------------------------------------------------------------------
do $$ begin create type friendship_status as enum ('pending', 'accepted', 'blocked'); exception when duplicate_object then null; end $$;
do $$ begin create type trip_visibility as enum ('private', 'friends', 'invited_only'); exception when duplicate_object then null; end $$;
do $$ begin create type member_role as enum ('owner', 'contributor'); exception when duplicate_object then null; end $$;
do $$ begin create type member_status as enum ('invited', 'joined', 'declined'); exception when duplicate_object then null; end $$;
do $$ begin create type catch_visibility as enum ('public', 'friends', 'private'); exception when duplicate_object then null; end $$;
do $$ begin create type notification_type as enum ('friend_request', 'friend_accepted', 'trip_invite', 'comment_on_catch'); exception when duplicate_object then null; end $$;

-- 3. profiles -----------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text unique not null check (char_length(username) between 3 and 20 and username ~ '^[a-z0-9_]+$'),
  display_name    text not null check (char_length(display_name) <= 40),
  avatar_url      text,
  bio             text check (char_length(bio) <= 200),
  public_profile  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index profiles_username_idx on public.profiles (lower(username));
create trigger profiles_bump before update on public.profiles for each row execute function public.bump_updated_at();

-- 4. friendships --------------------------------------------------------------
create table public.friendships (
  id            uuid primary key default uuid_generate_v4(),
  requester_id  uuid not null references public.profiles(id) on delete cascade,
  addressee_id  uuid not null references public.profiles(id) on delete cascade,
  status        friendship_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
-- Symmetric uniqueness: only one row per unordered pair.
create unique index friendships_unique_pair_idx on public.friendships (
  least(requester_id, addressee_id), greatest(requester_id, addressee_id)
);
create index friendships_addressee_status_idx on public.friendships(addressee_id, status);
create index friendships_requester_status_idx on public.friendships(requester_id, status);
create trigger friendships_bump before update on public.friendships for each row execute function public.bump_updated_at();

-- 5. trips --------------------------------------------------------------------
create table public.trips (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  location      text,
  start_date    timestamptz not null,
  end_date      timestamptz not null,
  notes         text,
  visibility    trip_visibility not null default 'invited_only',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index trips_owner_idx on public.trips(owner_id);
create trigger trips_bump before update on public.trips for each row execute function public.bump_updated_at();

-- 6. trip_members -------------------------------------------------------------
create table public.trip_members (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  role        member_role not null default 'contributor',
  status      member_status not null default 'invited',
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trip_id, angler_id)
);
create index trip_members_trip_idx on public.trip_members(trip_id);
create index trip_members_angler_status_idx on public.trip_members(angler_id, status);
create trigger trip_members_bump before update on public.trip_members for each row execute function public.bump_updated_at();

-- 7. catches ------------------------------------------------------------------
create table public.catches (
  id          uuid primary key default uuid_generate_v4(),
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  trip_id     uuid references public.trips(id) on delete set null,
  lost        boolean not null default false,
  lbs         int not null default 0,
  oz          int not null default 0,
  species     text,
  date        timestamptz not null,
  lake        text, swim text, bait text, rig text, notes text,
  has_photo   boolean not null default false,
  weather     jsonb,
  moon        jsonb,
  visibility  catch_visibility not null default 'friends',
  comments    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index catches_angler_date_idx on public.catches(angler_id, date desc);
create index catches_trip_idx on public.catches(trip_id) where trip_id is not null;
create index catches_visibility_idx on public.catches(visibility);
create trigger catches_bump before update on public.catches for each row execute function public.bump_updated_at();

-- 8. notify_config (per-user) -------------------------------------------------
create table public.notify_config (
  id          uuid primary key default uuid_generate_v4(),
  angler_id   uuid not null unique references public.profiles(id) on delete cascade,
  token       text,
  chat_id     text,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger notify_config_bump before update on public.notify_config for each row execute function public.bump_updated_at();

-- 9. notifications ------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default uuid_generate_v4(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  type          notification_type not null,
  payload       jsonb not null default '{}'::jsonb,
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications(recipient_id, read, created_at desc);

-- ============================================================
-- 10. Helper SQL functions (used by RLS — must be SECURITY DEFINER + STABLE)
-- ============================================================

-- Are A and B accepted friends?
create or replace function public.is_friend(a uuid, b uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;

-- Is `viewer` a joined member of trip `t`?
create or replace function public.is_joined_member(t uuid, viewer uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.trip_members tm
    where tm.trip_id = t and tm.angler_id = viewer and tm.status = 'joined'
  );
$$;

-- Is `viewer` either owner OR joined member of trip `t`?
create or replace function public.can_view_trip(t uuid, viewer uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.trips tr where tr.id = t and tr.owner_id = viewer
  ) or public.is_joined_member(t, viewer)
    or exists (
      select 1 from public.trips tr where tr.id = t and tr.visibility = 'friends' and public.is_friend(tr.owner_id, viewer)
    );
$$;

-- Auto-create trip_member row for trip owner so RLS works uniformly.
create or replace function public.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, angler_id, role, status, invited_by)
  values (new.id, new.owner_id, 'owner', 'joined', new.owner_id)
  on conflict (trip_id, angler_id) do nothing;
  return new;
end $$;
drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner after insert on public.trips for each row execute function public.add_owner_as_member();

-- Auto-create notification on friend request / accept / trip invite.
create or replace function public.notify_on_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.status = 'pending') then
    insert into public.notifications (recipient_id, type, payload)
    values (new.addressee_id, 'friend_request', jsonb_build_object('friendship_id', new.id, 'requester_id', new.requester_id));
  elsif (tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted') then
    insert into public.notifications (recipient_id, type, payload)
    values (new.requester_id, 'friend_accepted', jsonb_build_object('friendship_id', new.id, 'addressee_id', new.addressee_id));
  end if;
  return new;
end $$;
drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify after insert or update on public.friendships for each row execute function public.notify_on_friendship();

create or replace function public.notify_on_trip_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.status = 'invited' and new.role = 'contributor') then
    insert into public.notifications (recipient_id, type, payload)
    values (new.angler_id, 'trip_invite', jsonb_build_object('trip_member_id', new.id, 'trip_id', new.trip_id, 'invited_by', new.invited_by));
  end if;
  return new;
end $$;
drop trigger if exists trip_members_notify on public.trip_members;
create trigger trip_members_notify after insert on public.trip_members for each row execute function public.notify_on_trip_invite();

-- ============================================================
-- 11. Row Level Security
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.friendships   enable row level security;
alter table public.trips         enable row level security;
alter table public.trip_members  enable row level security;
alter table public.catches       enable row level security;
alter table public.notify_config enable row level security;
alter table public.notifications enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (
  public_profile = true
  or id = auth.uid()
  or public.is_friend(id, auth.uid())
);
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update using (id = auth.uid());

-- friendships ----------------------------------------------------------------
drop policy if exists "friendships_select" on public.friendships;
create policy "friendships_select" on public.friendships for select using (
  requester_id = auth.uid() or addressee_id = auth.uid()
);
drop policy if exists "friendships_insert" on public.friendships;
create policy "friendships_insert" on public.friendships for insert with check (
  requester_id = auth.uid() and addressee_id <> auth.uid()
);
drop policy if exists "friendships_update" on public.friendships;
create policy "friendships_update" on public.friendships for update using (
  addressee_id = auth.uid() or requester_id = auth.uid()
);
drop policy if exists "friendships_delete" on public.friendships;
create policy "friendships_delete" on public.friendships for delete using (
  addressee_id = auth.uid() or requester_id = auth.uid()
);

-- trips ----------------------------------------------------------------------
drop policy if exists "trips_select" on public.trips;
create policy "trips_select" on public.trips for select using (
  owner_id = auth.uid()
  or public.is_joined_member(id, auth.uid())
  or (visibility = 'friends' and public.is_friend(owner_id, auth.uid()))
);
drop policy if exists "trips_insert" on public.trips;
create policy "trips_insert" on public.trips for insert with check (owner_id = auth.uid());
drop policy if exists "trips_update_owner" on public.trips;
create policy "trips_update_owner" on public.trips for update using (owner_id = auth.uid());
drop policy if exists "trips_delete_owner" on public.trips;
create policy "trips_delete_owner" on public.trips for delete using (owner_id = auth.uid());

-- trip_members ---------------------------------------------------------------
drop policy if exists "trip_members_select" on public.trip_members;
create policy "trip_members_select" on public.trip_members for select using (
  angler_id = auth.uid()
  or public.is_joined_member(trip_id, auth.uid())
  or exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
);
-- Insert: trip owner can invite, OR an invited user accepting (re-creating not needed since invite is the insert).
drop policy if exists "trip_members_insert" on public.trip_members;
create policy "trip_members_insert" on public.trip_members for insert with check (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
  or angler_id = auth.uid()
);
drop policy if exists "trip_members_update_self_or_owner" on public.trip_members;
create policy "trip_members_update_self_or_owner" on public.trip_members for update using (
  angler_id = auth.uid()
  or exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
);
drop policy if exists "trip_members_delete_self_or_owner" on public.trip_members;
create policy "trip_members_delete_self_or_owner" on public.trip_members for delete using (
  angler_id = auth.uid()
  or exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
);

-- catches --------------------------------------------------------------------
drop policy if exists "catches_select" on public.catches;
create policy "catches_select" on public.catches for select using (
  visibility = 'public'
  or angler_id = auth.uid()
  or (visibility = 'friends' and public.is_friend(angler_id, auth.uid()))
  or (trip_id is not null and public.is_joined_member(trip_id, auth.uid()))
);
drop policy if exists "catches_insert_own" on public.catches;
create policy "catches_insert_own" on public.catches for insert with check (angler_id = auth.uid());
drop policy if exists "catches_update_own" on public.catches;
create policy "catches_update_own" on public.catches for update using (angler_id = auth.uid());
drop policy if exists "catches_delete_own" on public.catches;
create policy "catches_delete_own" on public.catches for delete using (angler_id = auth.uid());

-- notify_config --------------------------------------------------------------
drop policy if exists "notify_config_self" on public.notify_config;
create policy "notify_config_self" on public.notify_config for all
  using (angler_id = auth.uid()) with check (angler_id = auth.uid());

-- notifications --------------------------------------------------------------
drop policy if exists "notifications_select_self" on public.notifications;
create policy "notifications_select_self" on public.notifications for select using (recipient_id = auth.uid());
drop policy if exists "notifications_update_self" on public.notifications;
create policy "notifications_update_self" on public.notifications for update using (recipient_id = auth.uid());
drop policy if exists "notifications_delete_self" on public.notifications;
create policy "notifications_delete_self" on public.notifications for delete using (recipient_id = auth.uid());
-- Inserts come from triggers (security definer); deny direct client inserts.
drop policy if exists "notifications_no_direct_insert" on public.notifications;
create policy "notifications_no_direct_insert" on public.notifications for insert with check (false);

-- ============================================================
-- 12. Realtime publication
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='catches') then
    alter publication supabase_realtime add table public.catches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trips') then
    alter publication supabase_realtime add table public.trips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_members') then
    alter publication supabase_realtime add table public.trip_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='friendships') then
    alter publication supabase_realtime add table public.friendships;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================
-- 13. Storage bucket: catch-photos (public-read; uploads gated by RLS)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('catch-photos', 'catch-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "catch_photos_select" on storage.objects;
create policy "catch_photos_select" on storage.objects for select
  using (bucket_id = 'catch-photos');

-- Upload only into your own user-id-prefixed path.
drop policy if exists "catch_photos_insert_own_path" on storage.objects;
create policy "catch_photos_insert_own_path" on storage.objects for insert
  with check (
    bucket_id = 'catch-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "catch_photos_update_own" on storage.objects;
create policy "catch_photos_update_own" on storage.objects for update
  using (bucket_id = 'catch-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "catch_photos_delete_own" on storage.objects;
create policy "catch_photos_delete_own" on storage.objects for delete
  using (bucket_id = 'catch-photos' and (storage.foldername(name))[1] = auth.uid()::text);
