-- ============================================================
-- Carp Log v2.4 — polish sprint
-- - catch_comments table (replaces jsonb pattern; fixes RLS bug)
-- - comment_likes table
-- - trip_chat notification type + trigger
-- - catches.lake_id FK
-- - activity cleanup: stop logging joined_chat
-- ============================================================

-- 1. catch_comments (dedicated table) -----------------------------------------
create table if not exists public.catch_comments (
  id          uuid primary key default uuid_generate_v4(),
  catch_id    uuid not null references public.catches(id) on delete cascade,
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists catch_comments_catch_idx on public.catch_comments(catch_id, created_at);

alter table public.catch_comments enable row level security;
-- SELECT: authenticated users can read all comments. Catch IDs are unguessable
-- and to know an ID you typically already have access to the catch row.
drop policy if exists "catch_comments_select" on public.catch_comments;
create policy "catch_comments_select" on public.catch_comments for select to authenticated using (true);
drop policy if exists "catch_comments_insert_own" on public.catch_comments;
create policy "catch_comments_insert_own" on public.catch_comments for insert
  with check (angler_id = auth.uid());
drop policy if exists "catch_comments_delete_own" on public.catch_comments;
create policy "catch_comments_delete_own" on public.catch_comments for delete
  using (angler_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='catch_comments') then
    alter publication supabase_realtime add table public.catch_comments;
  end if;
end $$;

-- Backfill: pull existing jsonb comments into the new table.
-- Skip on conflict (idempotent if re-run).
insert into public.catch_comments (id, catch_id, angler_id, text, created_at)
select
  case when (cm->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (cm->>'id')::uuid else uuid_generate_v4() end,
  c.id,
  (cm->>'anglerId')::uuid,
  cm->>'text',
  case when (cm->>'ts') ~ '^\d+$' then to_timestamp(((cm->>'ts')::bigint) / 1000.0) else now() end
from public.catches c, jsonb_array_elements(c.comments) cm
where jsonb_typeof(c.comments) = 'array'
  and (cm->>'anglerId') is not null
  and (cm->>'text') is not null
  and exists (select 1 from public.profiles p where p.id = (cm->>'anglerId')::uuid)
on conflict (id) do nothing;

-- 2. comment_likes ------------------------------------------------------------
create table if not exists public.comment_likes (
  id          uuid primary key default uuid_generate_v4(),
  comment_id  uuid not null references public.catch_comments(id) on delete cascade,
  angler_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (comment_id, angler_id)
);
create index if not exists comment_likes_comment_idx on public.comment_likes(comment_id);

alter table public.comment_likes enable row level security;
drop policy if exists "comment_likes_select" on public.comment_likes;
create policy "comment_likes_select" on public.comment_likes for select to authenticated using (true);
drop policy if exists "comment_likes_insert_own" on public.comment_likes;
create policy "comment_likes_insert_own" on public.comment_likes for insert with check (angler_id = auth.uid());
drop policy if exists "comment_likes_delete_own" on public.comment_likes;
create policy "comment_likes_delete_own" on public.comment_likes for delete using (angler_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='comment_likes') then
    alter publication supabase_realtime add table public.comment_likes;
  end if;
end $$;

-- 3. catches.lake_id -----------------------------------------------------------
alter table public.catches add column if not exists lake_id uuid references public.lakes(id) on delete set null;
create index if not exists catches_lake_id_idx on public.catches(lake_id) where lake_id is not null;

-- Extend ensure_lake_row to also write back the lake_id onto the catch.
create or replace function public.ensure_lake_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_lake_id uuid;
begin
  if new.lake is null or btrim(new.lake) = '' then return new; end if;
  v_name := btrim(new.lake);
  insert into public.lakes (name, latitude, longitude, created_by)
  values (v_name, new.latitude, new.longitude, new.angler_id)
  on conflict (lower(name)) do update set
    latitude  = coalesce(public.lakes.latitude, excluded.latitude),
    longitude = coalesce(public.lakes.longitude, excluded.longitude)
  returning id into v_lake_id;
  if v_lake_id is null then
    select id into v_lake_id from public.lakes where lower(name) = lower(v_name);
  end if;
  -- write lake_id onto the row IF it changed (avoid recursion: trigger is BEFORE→AFTER on insert/update of lake)
  if new.lake_id is distinct from v_lake_id then
    update public.catches set lake_id = v_lake_id where id = new.id;
  end if;
  return new;
end $$;

-- Backfill lake_id on existing catches.
update public.catches c
set lake_id = l.id
from public.lakes l
where c.lake is not null
  and lower(c.lake) = lower(l.name)
  and c.lake_id is distinct from l.id;

-- 4. trip_chat notification type + trigger -----------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_type' and e.enumlabel = 'trip_chat'
  ) then
    alter type notification_type add value 'trip_chat';
  end if;
end $$;

-- Replace chat trigger:
--  - notify all OTHER joined members (trip_chat) with snippet
--  - emit trip_chat_mention for any @username matches (existing behaviour)
--  - DO NOT emit joined_chat to trip_activity any more (removed for "Recent activity" cleanup)
create or replace function public.log_chat_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_word text;
  v_username text;
  v_recipient uuid;
  v_mentioned uuid[] := '{}';
  v_snippet text;
begin
  v_snippet := left(new.text, 60);

  -- @mentions -> stronger notification + collect to suppress duplicate trip_chat
  for v_word in
    select (regexp_matches(new.text, '@([a-z0-9_]{3,20})', 'gi'))[1]
  loop
    v_username := lower(v_word);
    select id into v_recipient from public.profiles where username = v_username;
    if v_recipient is not null and v_recipient <> new.angler_id then
      insert into public.notifications (recipient_id, type, payload)
      values (v_recipient, 'trip_chat_mention',
              jsonb_build_object('trip_id', new.trip_id, 'message_id', new.id, 'angler_id', new.angler_id, 'preview', v_snippet));
      v_mentioned := array_append(v_mentioned, v_recipient);
    end if;
  end loop;

  -- Generic trip_chat for everyone else who's joined
  insert into public.notifications (recipient_id, type, payload)
  select tm.angler_id, 'trip_chat',
         jsonb_build_object('trip_id', new.trip_id, 'message_id', new.id, 'angler_id', new.angler_id, 'snippet', v_snippet)
  from public.trip_members tm
  where tm.trip_id = new.trip_id
    and tm.status = 'joined'
    and tm.angler_id <> new.angler_id
    and tm.angler_id <> all(v_mentioned);

  return new;
end $$;

-- Backfill: clean out any prior joined_chat activity rows (no longer surfaced)
delete from public.trip_activity where type = 'joined_chat';
