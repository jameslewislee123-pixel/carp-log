'use client';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(url, anon, {
  realtime: { params: { eventsPerSecond: 10 } },
  auth: { persistSession: false },
});

export const hasSupabase = Boolean(url && anon);
