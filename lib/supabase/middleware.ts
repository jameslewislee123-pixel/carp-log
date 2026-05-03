import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const PUBLIC_PATHS = ['/auth/sign-in', '/auth/callback', '/auth/sign-out', '/api/detect-species'];

function isPublicPath(p: string) {
  if (PUBLIC_PATHS.some(s => p === s || p.startsWith(s + '/'))) return true;
  if (p.startsWith('/_next') || p.startsWith('/favicon') || p.startsWith('/icons') || p.startsWith('/splash')) return true;
  if (p === '/manifest.json' || p === '/sw.js' || p.startsWith('/workbox-') || p.startsWith('/fallback-')) return true;
  return false;
}

export async function updateSession(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) { return req.cookies.get(name)?.value; },
      set(name: string, value: string, options: any) {
        req.cookies.set({ name, value, ...options });
        res = NextResponse.next({ request: { headers: req.headers } });
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: any) {
        req.cookies.set({ name, value: '', ...options });
        res = NextResponse.next({ request: { headers: req.headers } });
        res.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (!user && !isPublicPath(path)) {
    const dest = req.nextUrl.clone();
    dest.pathname = '/auth/sign-in';
    dest.searchParams.set('next', path);
    return NextResponse.redirect(dest);
  }

  if (user) {
    const needsProfileCheck = path === '/' || path === '/auth/sign-in' || path.startsWith('/profile') || path.startsWith('/friends') || path.startsWith('/notifications');
    if (needsProfileCheck && path !== '/onboarding') {
      const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
      if (!profile) {
        const dest = req.nextUrl.clone();
        dest.pathname = '/onboarding';
        return NextResponse.redirect(dest);
      }
      if (path === '/auth/sign-in') {
        const dest = req.nextUrl.clone();
        dest.pathname = '/';
        return NextResponse.redirect(dest);
      }
    }
  }

  return res;
}
