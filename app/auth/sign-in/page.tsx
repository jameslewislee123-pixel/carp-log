'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Fish } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.4 4 9.8 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.9 35.7 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

function SignInBody() {
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (error) { alert(error.message); setBusy(false); }
  }

  return (
    <div className="app-root">
      <div className="app-content" style={{ padding: '80px 24px 60px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 22, background: 'rgba(212,182,115,0.12)', border: '1px solid rgba(212,182,115,0.3)', marginBottom: 24 }}>
          <Fish size={36} style={{ color: 'var(--gold)' }} />
        </div>
        <h1 className="display-font" style={{ fontSize: 38, lineHeight: 1.05, margin: '0 0 12px', fontWeight: 500, letterSpacing: '-0.02em' }}>The Carp Log</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 15, margin: '0 0 36px', lineHeight: 1.5 }}>
          Track every fish, every trip. Connect with your crew.
        </p>
        <button onClick={signIn} disabled={busy} className="tap" style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          width: '100%', maxWidth: 360,
          padding: '16px 24px',
          background: '#FFFFFF', color: '#1A1004',
          border: 'none', borderRadius: 14,
          fontFamily: 'inherit', fontSize: 16, fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
          boxShadow: '0 6px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}>
          <GoogleLogo /> Continue with Google
        </button>
        <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 32, lineHeight: 1.5 }}>
          By continuing you agree to share your name, email and avatar with the crew.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return <Suspense fallback={null}><SignInBody /></Suspense>;
}
