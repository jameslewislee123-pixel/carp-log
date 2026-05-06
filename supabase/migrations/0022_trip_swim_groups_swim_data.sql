-- Store swim coords + label directly on trip_swim_groups so a "Setup"
-- exists as soon as the row is created — no rod_spots needed yet for
-- swim marker rendering on the trip Map tab.
-- Already applied manually; this file mirrors that change for repo history.

ALTER TABLE public.trip_swim_groups
  ADD COLUMN IF NOT EXISTS swim_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS swim_longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS swim_label TEXT;
