-- ============================================================
-- Carp Log v2.5 — avatars bucket + push prep
-- - avatars storage bucket (public read, write own folder)
-- - push_subscriptions table (per-device VAPID subs)
-- - notification_preferences table (per-type toggles)
-- ============================================================

-- 1. Avatars bucket -----------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own_path" on storage.objects;
create policy "avatars_insert_own_path" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. push_subscriptions -------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,
  p256dh_key  text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subs_self" on public.push_subscriptions;
create policy "push_subs_self" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. notification_preferences -------------------------------------------------
-- Per-user opt-ins. enabled is a jsonb of toggles like:
-- { "trip_new_catch": true, "trip_invite": true, ... }
create table if not exists public.notification_preferences (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  enabled     jsonb not null default '{
    "trip_new_catch": true,
    "trip_new_member": true,
    "trip_invite": true,
    "trip_chat": false,
    "trip_chat_mention": true,
    "friend_request": true,
    "friend_accepted": true,
    "comment_on_catch": true
  }'::jsonb,
  push_master boolean not null default false,
  updated_at  timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
drop policy if exists "notif_prefs_self" on public.notification_preferences;
create policy "notif_prefs_self" on public.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists notif_prefs_bump on public.notification_preferences;
create trigger notif_prefs_bump before update on public.notification_preferences
  for each row execute function public.bump_updated_at();
