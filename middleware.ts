import { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(req: NextRequest) {
  return updateSession(req);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/.*|splash/.*|manifest.json|sw.js|workbox-.*|fallback-.*).*)'],
};
