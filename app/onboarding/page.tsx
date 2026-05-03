'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fish, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import UsernameInput from '@/components/UsernameInput';
import AvatarBubble from '@/components/AvatarBubble';
import { supabase } from '@/lib/supabase/client';

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email?: string; avatar?: string; fullName?: string } | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      console.log('[onboarding] checking session');
      const { data: { user }, error } = await supabase().auth.getUser();
      if (error) console.error('[onboarding] getUser error', error);
      if (!user) {
        console.warn('[onboarding] no user, redirecting to sign-in');
        window.location.assign('/auth/sign-in');
        return;
      }
      const meta = (user.user_metadata || {}) as any;
      console.log('[onboarding] session ok', { userId: user.id, email: user.email });
      setUser({ id: user.id, email: user.email, avatar: meta.avatar_url || meta.picture || null, fullName: meta.full_name || meta.name || '' });
      setDisplayName(meta.full_name || meta.name || '');
      const seedUsername = (meta.full_name || meta.name || (user.email || '').split('@')[0] || '')
        .toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20).replace(/^_+|_+$/g, '');
      if (seedUsername.length >= 3) setUsername(seedUsername);
    })();
  }, []);

  async function submit() {
    console.log('[onboarding] submit clicked', { availability, displayName: displayName.length });
    setErr(null);

    if (availability !== 'available') {
      console.warn('[onboarding] username not available', availability);
      setErr(availability === 'taken' ? 'That username is taken. Pick a different one.' : 'Pick a valid available username.');
      return;
    }
    if (!displayName.trim()) { setErr('Enter a display name'); return; }
    if (!user) { setErr('Session lost. Please sign in again.'); return; }

    setSaving(true);
    try {
      // Re-verify session right before insert. This catches the iOS case
      // where the cookie was evicted between page load and submit.
      console.log('[onboarding] re-checking session before insert');
      const { data: { user: currentUser }, error: sessErr } = await supabase().auth.getUser();
      if (sessErr || !currentUser) {
        console.error('[onboarding] session lost', sessErr);
        setErr('Sign-in session expired. Reloading…');
        setTimeout(() => window.location.assign('/auth/sign-in'), 1500);
        return;
      }
      console.log('[onboarding] session ok, inserting profile', { userId: currentUser.id });

      const payload = {
        id: currentUser.id,
        username: username.trim().toLowerCase(),
        display_name: displayName.trim().slice(0, 40),
        avatar_url: user.avatar || null,
        public_profile: false,
      };
      console.log('[onboarding] insert payload', payload);

      const { data, error } = await supabase().from('profiles').insert(payload).select().single();
      console.log('[onboarding] insert returned', { data, error });

      if (error) {
        // RLS / unique constraint / network error — surface verbatim.
        const friendly =
          error.code === '23505' ? 'That username was just taken. Try another.' :
          error.code === '42501' ? 'Permission denied creating profile. Sign out and back in.' :
          (error.message || 'Failed to create profile');
        setErr(friendly + ` (code: ${error.code || 'unknown'})`);
        setSaving(false);
        return;
      }

      if (!data) {
        setErr('Profile insert returned no data. Try again.');
        setSaving(false);
        return;
      }

      console.log('[onboarding] success, hard-navigating to /');
      // Use window.location.assign for a HARD navigation. router.replace
      // sometimes silently no-ops on iOS Safari after a state change.
      window.location.assign('/');
    } catch (e: any) {
      console.error('[onboarding] caught exception', e);
      setErr(`Unexpected error: ${e?.message || String(e)}`);
      setSaving(false);
    }
  }

  if (!user) return (
    <div className="app-root">
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
      </div>
    </div>
  );

  return (
    <div className="app-root">
      <div className="app-content" style={{ paddingTop: 'max(60px, calc(40px + env(safe-area-inset-top)))', paddingLeft: 24, paddingRight: 24, paddingBottom: 'max(40px, env(safe-area-inset-bottom))' }}>
        <Fish size={36} style={{ color: 'var(--gold)', marginBottom: 22 }} />
        <h1 className="display-font" style={{ fontSize: 32, lineHeight: 1.1, margin: '0 0 8px', fontWeight: 500, letterSpacing: '-0.02em' }}>
          Pick your handle
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 15, margin: '0 0 28px', lineHeight: 1.5 }}>
          This is how the rest of the crew will find and tag you.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)', borderRadius: 14, marginBottom: 22, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
          <AvatarBubble username={null} displayName={displayName || user.fullName} avatarUrl={user.avatar} size={42} link={false} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{user.fullName || 'Signed in'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{user.email}</div>
          </div>
        </div>

        <label className="label">Username</label>
        <UsernameInput value={username} onChange={setUsername} onAvailability={setAvailability} />

        <div style={{ marginTop: 18 }}>
          <label className="label">Display name</label>
          <input className="input" placeholder="e.g. Jim" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>{displayName.length}/40</div>
        </div>

        {err && (
          <div role="alert" style={{
            marginTop: 18, padding: 14, borderRadius: 12,
            background: 'rgba(220,107,88,0.14)',
            border: '1px solid rgba(220,107,88,0.45)',
            color: 'var(--danger)', fontSize: 13, lineHeight: 1.5,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{err}</div>
          </div>
        )}

        <button className="btn btn-primary"
          disabled={saving || availability !== 'available' || !displayName.trim()}
          onClick={submit}
          style={{ width: '100%', marginTop: 26, fontSize: 16, padding: '16px' }}>
          {saving ? <Loader2 size={18} className="spin" /> : <ChevronRight size={18} />}
          {saving ? 'Creating profile…' : 'Start tracking'}
        </button>

        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
          If this gets stuck, <a href="/auth/sign-out" style={{ color: 'var(--gold-2)' }}>sign out</a> and try again in Safari (not the home-screen app).
        </div>
      </div>
    </div>
  );
}
