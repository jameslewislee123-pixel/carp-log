import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const VALID = /^[a-z0-9_]{3,20}$/;

export async function GET(req: NextRequest) {
  const u = (req.nextUrl.searchParams.get('u') || '').trim().toLowerCase();
  if (!VALID.test(u)) {
    return NextResponse.json({ available: false, reason: 'invalid' });
  }
  const supabase = createClient();
  const { data, error } = await supabase.from('profiles').select('id').eq('username', u).maybeSingle();
  if (error) return NextResponse.json({ available: false, reason: 'error' });
  return NextResponse.json({ available: !data });
}
