-- Gear checklist — per-user packing list with UK/France filtering.
-- Seed defaults are inserted on first open by the client (see
-- DEFAULT_CHECKLIST_ITEMS in lib/db.ts). User can add custom items, tick
-- packed state, and reset all. RLS scopes everything to the owning user.

CREATE TABLE IF NOT EXISTS public.gear_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'both' CHECK (region IN ('uk', 'france', 'both')),
  is_packed BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  position INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gear_checklist_user ON public.gear_checklist(user_id);
CREATE INDEX IF NOT EXISTS idx_gear_checklist_user_category ON public.gear_checklist(user_id, category);

ALTER TABLE public.gear_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_checklist" ON public.gear_checklist FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_checklist" ON public.gear_checklist FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_checklist" ON public.gear_checklist FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_checklist" ON public.gear_checklist FOR DELETE USING (auth.uid() = user_id);
