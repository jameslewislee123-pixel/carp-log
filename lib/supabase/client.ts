'use client';
import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const hasSupabase = Boolean(url && anon);

export function createClient() {
  return createBrowserClient(url, anon);
}

// Cached singleton (the SSR client manages token refresh internally).
let _supabase: ReturnType<typeof createClient> | null = null;
export function supabase() {
  if (!_supabase) _supabase = createClient();
  return _supabase;
}
