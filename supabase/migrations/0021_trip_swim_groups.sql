-- Trip ↔ swim_group junction. A single trip can use multiple swims when
-- anglers move during a session; each angler tracks their own usage so
-- shared trips don't conflate movement between members.
-- Not yet referenced in app code — wired up in a follow-up PR.

CREATE TABLE IF NOT EXISTS public.trip_swim_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  swim_group_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_swim_groups_trip ON public.trip_swim_groups(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_swim_groups_swim ON public.trip_swim_groups(swim_group_id);
CREATE INDEX IF NOT EXISTS idx_trip_swim_groups_user ON public.trip_swim_groups(user_id);

ALTER TABLE public.trip_swim_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_swim_groups_read" ON public.trip_swim_groups
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_swim_groups.trip_id
        AND tm.angler_id = auth.uid()
        AND tm.status = 'joined'
    )
  );

CREATE POLICY "trip_swim_groups_insert" ON public.trip_swim_groups
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "trip_swim_groups_update" ON public.trip_swim_groups
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "trip_swim_groups_delete" ON public.trip_swim_groups
  FOR DELETE USING (auth.uid() = user_id);
