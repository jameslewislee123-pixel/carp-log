import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Explicit defaults for iOS Safari: sameSite='lax' (NOT 'strict' or 'none'), secure on prod, path='/'.
function withDefaults(opts?: CookieOptions): CookieOptions {
  return {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(opts || {}),
  };
}

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, withDefaults(options));
          });
        } catch {
          // In Server Components, set() is a no-op; middleware handles refresh.
        }
      },
    },
  });
}

export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, supabase };
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return { user, profile, supabase };
}
