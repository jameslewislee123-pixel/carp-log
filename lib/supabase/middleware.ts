import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const PUBLIC_PATHS = ['/auth/sign-in', '/auth/callback', '/auth/sign-out', '/api/detect-species', '/api/username-check', '/api/push/fanout'];

function isPublicPath(p: string) {
  if (PUBLIC_PATHS.some(s => p === s || p.startsWith(s + '/'))) return true;
  if (p.startsWith('/_next') || p.startsWith('/favicon') || p.startsWith('/icons') || p.startsWith('/splash')) return true;
  // All service-worker-related paths must NEVER be redirected — the SW import
  // chain breaks if any of these returns a 307 to the sign-in page.
  if (
    p === '/manifest.json' ||
    p === '/sw.js' ||
    p === '/push-sw.js' ||
    p.startsWith('/workbox-') ||
    p.startsWith('/worker-') ||
    p.startsWith('/fallback-')
  ) return true;
  return false;
}

function withDefaults(opts?: CookieOptions): CookieOptions {
  return {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(opts || {}),
  };
}

export async function updateSession(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() { return req.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, withDefaults(options));
        });
      },
    },
  });

  // CRITICAL: must call getUser() (not getSession) to refresh the session cookie
  // on every request. This keeps the JWT fresh for iOS Safari which is aggressive
  // about evicting cookies that look "stale".
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
