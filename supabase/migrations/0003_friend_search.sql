-- ============================================================
-- Carp Log v2.1 — friend search fix
-- ============================================================
-- The previous profiles SELECT policy was chicken-and-egg:
-- to add a friend you need to find them, but you couldn't find
-- them via username search unless they were already a friend or
-- had public_profile=true.
--
-- Trade-off: any signed-in user can now read every profile's
-- id, username, display_name, avatar_url, bio, and
-- public_profile flag. This is the same model as Twitter / IG —
-- you can search anyone's handle. Detailed catch / trip data is
-- still gated by the catches/trips RLS policies.
-- ============================================================

drop policy if exists "profiles_select" on public.profiles;

create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated
  using (true);

-- Anonymous viewers (logged-out) still get only public_profile=true,
-- so /profile/[username] without auth still works for public profiles.
create policy "profiles_select_anon_public" on public.profiles
  for select to anon
  using (public_profile = true);
