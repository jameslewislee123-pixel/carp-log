import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/';

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL(`/auth/sign-in?error=${encodeURIComponent(error.message)}`, req.url));
    }
    // After exchange, check profile existence to send to /onboarding if needed.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
      if (!profile) {
        return NextResponse.redirect(new URL('/onboarding', req.url));
      }
    }
  }
  return NextResponse.redirect(new URL(next, req.url));
}
