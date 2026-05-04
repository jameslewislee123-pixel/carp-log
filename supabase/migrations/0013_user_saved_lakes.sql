-- ============================================================
-- Carp Log v3.0 — user_saved_lakes (bookmark) table
--
-- Until now, "lakes I see in the Lakes tab" was the union of:
--   lakes I have catches at + lakes from my trips + lakes I created.
--
-- Seed lakes (UK fishery imports, source='seed') and Nominatim hits
-- have created_by IS NULL by design — no individual user owns them.
-- Tapping a seed result in AddLakeModal therefore had no effect: the
-- modal closed, the lake stayed unowned, and nothing surfaced in the
-- Lakes tab.
--
-- This table introduces a "save" relationship: any user can bookmark
-- any existing lake row. Lakes-tab and lake-detail then read this set
-- together with catches/trips/created_by.
-- ============================================================

create table if not exists public.user_saved_lakes (
  user_id  uuid references public.profiles(id) on delete cascade,
  lake_id  uuid references public.lakes(id)   on delete cascade,
  saved_at timestamptz default now(),
  primary key (user_id, lake_id)
);

create index if not exists idx_user_saved_lakes_user on public.user_saved_lakes(user_id);
create index if not exists idx_user_saved_lakes_lake on public.user_saved_lakes(lake_id);

alter table public.user_saved_lakes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_saved_lakes' and policyname='users_can_read_own_saves'
  ) then
    create policy "users_can_read_own_saves" on public.user_saved_lakes
      for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_saved_lakes' and policyname='users_can_save_lakes'
  ) then
    create policy "users_can_save_lakes" on public.user_saved_lakes
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_saved_lakes' and policyname='users_can_unsave_lakes'
  ) then
    create policy "users_can_unsave_lakes" on public.user_saved_lakes
      for delete using (auth.uid() = user_id);
  end if;
end $$;
