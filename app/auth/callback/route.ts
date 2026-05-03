import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/';

  console.log('[auth/callback] hit', { hasCode: !!code, next, ua: req.headers.get('user-agent')?.slice(0, 80) });

  if (!code) {
    console.warn('[auth/callback] no code provided');
    return NextResponse.redirect(new URL('/auth/sign-in?error=no_code', req.url));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth/callback] exchange failed', error.message);
    return NextResponse.redirect(new URL(`/auth/sign-in?error=${encodeURIComponent(error.message)}`, req.url));
  }

  const { data: { user } } = await supabase.auth.getUser();
  console.log('[auth/callback] exchange ok, user=', user?.id);
  if (!user) return NextResponse.redirect(new URL('/auth/sign-in?error=no_user', req.url));

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  console.log('[auth/callback] profile=', !!profile);

  return NextResponse.redirect(new URL(profile ? next : '/onboarding', req.url));
}
