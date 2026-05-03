-- ============================================================
-- Carp Log v2.2 — trips upgrade
-- Adds: catch coords, wager mode, group chat, stakes, activity feed,
-- auto-friend on trip-accept, new notification types.
-- ============================================================

-- 1. Schema additions ---------------------------------------------------------
alter table public.catches add column if not exists latitude  numeric;
alter table public.catches add column if not exists longitude numeric;
create index if not exists catches_geo_idx on public.catches (latitude, longitude) where latitude is not null;

alter table public.trips add column if not exists wager_enabled boolean not null default false;
alter table public.trips add column if not exists wager_description text check (char_length(wager_description) <= 200);

-- 2. New tables ---------------------------------------------------------------
create table if not exists public.trip_messages (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists trip_messages_trip_idx on public.trip_messages(trip_id, created_at);

create table if not exists public.trip_stakes (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  stake_text  text not null check (char_length(stake_text) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trip_id, angler_id)
);
create index if not exists trip_stakes_trip_idx on public.trip_stakes(trip_id);
drop trigger if exists trip_stakes_bump on public.trip_stakes;
create trigger trip_stakes_bump before update on public.trip_stakes for each row execute function public.bump_updated_at();

do $$ begin
  create type trip_activity_type as enum ('joined', 'caught', 'lost_fish', 'commented', 'joined_chat', 'set_wager', 'became_leader');
exception when duplicate_object then null; end $$;

create table if not exists public.trip_activity (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  type        trip_activity_type not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists trip_activity_trip_idx on public.trip_activity(trip_id, created_at desc);

-- 3. New notification types ---------------------------------------------------
do $$
declare v text;
begin
  for v in select unnest(array['trip_new_catch','trip_new_member','trip_chat_mention']) loop
    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'notification_type' and e.enumlabel = v
    ) then
      execute format('alter type notification_type add value %L', v);
    end if;
  end loop;
end $$;

-- 4. RLS ---------------------------------------------------------------------
alter table public.trip_messages enable row level security;
alter table public.trip_stakes   enable row level security;
alter table public.trip_activity enable row level security;

-- trip_messages: any joined member can read, write own; sender or trip owner can delete.
drop policy if exists "trip_messages_select" on public.trip_messages;
create policy "trip_messages_select" on public.trip_messages for select
  using (public.is_joined_member(trip_id, auth.uid()));

drop policy if exists "trip_messages_insert" on public.trip_messages;
create policy "trip_messages_insert" on public.trip_messages for insert
  with check (
    angler_id = auth.uid()
    and public.is_joined_member(trip_id, auth.uid())
  );

drop policy if exists "trip_messages_delete" on public.trip_messages;
create policy "trip_messages_delete" on public.trip_messages for delete
  using (
    angler_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
  );

-- trip_stakes: any joined member can read; member can insert/update own; owner can delete any.
drop policy if exists "trip_stakes_select" on public.trip_stakes;
create policy "trip_stakes_select" on public.trip_stakes for select
  using (public.is_joined_member(trip_id, auth.uid()));

drop policy if exists "trip_stakes_insert_self" on public.trip_stakes;
create policy "trip_stakes_insert_self" on public.trip_stakes for insert
  with check (angler_id = auth.uid() and public.is_joined_member(trip_id, auth.uid()));

drop policy if exists "trip_stakes_update_self" on public.trip_stakes;
create policy "trip_stakes_update_self" on public.trip_stakes for update
  using (angler_id = auth.uid());

drop policy if exists "trip_stakes_delete" on public.trip_stakes;
create policy "trip_stakes_delete" on public.trip_stakes for delete
  using (
    angler_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid())
  );

-- trip_activity: read-only for joined members; inserted exclusively by triggers.
drop policy if exists "trip_activity_select" on public.trip_activity;
create policy "trip_activity_select" on public.trip_activity for select
  using (public.is_joined_member(trip_id, auth.uid()));

drop policy if exists "trip_activity_no_direct_insert" on public.trip_activity;
create policy "trip_activity_no_direct_insert" on public.trip_activity for insert
  with check (false);

-- 5. Realtime ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_messages') then
    alter publication supabase_realtime add table public.trip_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_activity') then
    alter publication supabase_realtime add table public.trip_activity;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_stakes') then
    alter publication supabase_realtime add table public.trip_stakes;
  end if;
end $$;

-- 6. Triggers ----------------------------------------------------------------

-- 6a. Auto-friend on trip-accept --------------------------------------------
create or replace function public.auto_friend_on_trip_join() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_existing_status friendship_status;
begin
  if new.status = 'joined' and (tg_op = 'INSERT' or old.status is distinct from 'joined') then
    select owner_id into v_owner from public.trips where id = new.trip_id;
    if v_owner is null or v_owner = new.angler_id then return new; end if;

    -- existing friendship in either direction?
    select status into v_existing_status from public.friendships
      where (requester_id = v_owner and addressee_id = new.angler_id)
         or (requester_id = new.angler_id and addressee_id = v_owner)
      limit 1;

    if v_existing_status = 'blocked' then return new; end if;
    if v_existing_status = 'accepted' then return new; end if;

    if v_existing_status = 'pending' then
      update public.friendships set status = 'accepted'
        where (requester_id = v_owner and addressee_id = new.angler_id)
           or (requester_id = new.angler_id and addressee_id = v_owner);
    else
      insert into public.friendships (requester_id, addressee_id, status)
      values (v_owner, new.angler_id, 'accepted')
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trip_members_auto_friend on public.trip_members;
create trigger trip_members_auto_friend
  after insert or update on public.trip_members
  for each row execute function public.auto_friend_on_trip_join();

-- 6b. Activity logging on catches -------------------------------------------
create or replace function public.log_catch_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  current_top_oz int;
  this_oz int;
begin
  if new.trip_id is null then return new; end if;

  if new.lost then
    insert into public.trip_activity (trip_id, angler_id, type, payload)
    values (new.trip_id, new.angler_id, 'lost_fish',
            jsonb_build_object('catch_id', new.id, 'rig', new.rig, 'swim', new.swim));
  else
    insert into public.trip_activity (trip_id, angler_id, type, payload)
    values (new.trip_id, new.angler_id, 'caught',
            jsonb_build_object('catch_id', new.id, 'lbs', new.lbs, 'oz', new.oz, 'species', new.species));

    -- new leader?
    this_oz := (new.lbs * 16) + new.oz;
    select coalesce(max((c.lbs * 16) + c.oz), 0) into current_top_oz
      from public.catches c
      where c.trip_id = new.trip_id and not c.lost and c.id <> new.id;
    if this_oz > current_top_oz and this_oz > 0 then
      insert into public.trip_activity (trip_id, angler_id, type, payload)
      values (new.trip_id, new.angler_id, 'became_leader',
              jsonb_build_object('catch_id', new.id, 'lbs', new.lbs, 'oz', new.oz, 'previous_top_oz', current_top_oz));
    end if;

    -- notify all other joined members of new catch
    insert into public.notifications (recipient_id, type, payload)
    select tm.angler_id, 'trip_new_catch',
           jsonb_build_object('trip_id', new.trip_id, 'catch_id', new.id, 'angler_id', new.angler_id, 'lbs', new.lbs, 'oz', new.oz)
    from public.trip_members tm
    where tm.trip_id = new.trip_id and tm.status = 'joined' and tm.angler_id <> new.angler_id;
  end if;
  return new;
end $$;
drop trigger if exists catches_log_activity on public.catches;
create trigger catches_log_activity
  after insert on public.catches
  for each row execute function public.log_catch_activity();

-- 6c. Activity logging on trip_members joining ------------------------------
create or replace function public.log_join_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'joined' and (tg_op = 'INSERT' or old.status is distinct from 'joined') then
    insert into public.trip_activity (trip_id, angler_id, type, payload)
    values (new.trip_id, new.angler_id, 'joined', '{}'::jsonb);

    -- notify trip owner of new member (skip if joiner IS the owner)
    insert into public.notifications (recipient_id, type, payload)
    select t.owner_id, 'trip_new_member',
           jsonb_build_object('trip_id', t.id, 'angler_id', new.angler_id)
    from public.trips t
    where t.id = new.trip_id and t.owner_id <> new.angler_id;
  end if;
  return new;
end $$;
drop trigger if exists trip_members_log_join on public.trip_members;
create trigger trip_members_log_join
  after insert or update on public.trip_members
  for each row execute function public.log_join_activity();

-- 6d. First chat message -> joined_chat activity ----------------------------
create or replace function public.log_chat_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first boolean;
  v_word text;
  v_username text;
  v_recipient uuid;
begin
  -- joined_chat: only for the angler's first message in the trip
  select not exists (
    select 1 from public.trip_messages tm
    where tm.trip_id = new.trip_id and tm.angler_id = new.angler_id and tm.id <> new.id
  ) into v_first;
  if v_first then
    insert into public.trip_activity (trip_id, angler_id, type, payload)
    values (new.trip_id, new.angler_id, 'joined_chat', '{}'::jsonb);
  end if;

  -- @mentions -> notifications. Parse out @username tokens (3-20 chars: a-z 0-9 _).
  for v_word in select regexp_matches(new.text, '@([a-z0-9_]{3,20})', 'gi') loop
    v_username := lower(v_word);
    select id into v_recipient from public.profiles where username = v_username;
    if v_recipient is not null and v_recipient <> new.angler_id then
      insert into public.notifications (recipient_id, type, payload)
      values (v_recipient, 'trip_chat_mention',
              jsonb_build_object('trip_id', new.trip_id, 'message_id', new.id, 'angler_id', new.angler_id, 'preview', left(new.text, 80)));
    end if;
  end loop;

  return new;
end $$;
drop trigger if exists trip_messages_activity on public.trip_messages;
create trigger trip_messages_activity
  after insert on public.trip_messages
  for each row execute function public.log_chat_activity();

-- 6e. Stake set/changed -> set_wager activity -------------------------------
create or replace function public.log_stake_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_activity (trip_id, angler_id, type, payload)
  values (new.trip_id, new.angler_id, 'set_wager',
          jsonb_build_object('stake_text', new.stake_text));
  return new;
end $$;
drop trigger if exists trip_stakes_activity on public.trip_stakes;
create trigger trip_stakes_activity
  after insert on public.trip_stakes
  for each row execute function public.log_stake_activity();
