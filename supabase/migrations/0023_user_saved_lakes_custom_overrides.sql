-- Per-user overrides on a saved lake. Lets users rename / re-locate a seed
-- or OSM lake for themselves without mutating the canonical row that
-- everyone else sees. The columns are NULLable; NULL means "use the
-- lakes-table canonical value".
--
-- The ALTER below was applied manually before this file landed; mirroring
-- it here keeps repo history honest. The CREATE POLICY for UPDATE is NEW —
-- 0013 only added SELECT / INSERT / DELETE policies, so an upsert to set
-- overrides on an existing bookmark would fail RLS without it. Apply this
-- file via the Supabase SQL editor before deploying clients that write
-- the overrides.

ALTER TABLE public.user_saved_lakes
  ADD COLUMN IF NOT EXISTS custom_name TEXT,
  ADD COLUMN IF NOT EXISTS custom_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS custom_longitude NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_saved_lakes'
      AND policyname = 'users_can_update_own_saves'
  ) THEN
    CREATE POLICY "users_can_update_own_saves" ON public.user_saved_lakes
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
