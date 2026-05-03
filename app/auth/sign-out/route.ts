import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/auth/sign-in', req.url), { status: 302 });
}

export async function GET(req: NextRequest) { return POST(req); }
