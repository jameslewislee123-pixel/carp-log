'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fish, ChevronRight, Loader2 } from 'lucide-react';
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
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) { router.replace('/auth/sign-in'); return; }
      const meta = (user.user_metadata || {}) as any;
      setUser({ id: user.id, email: user.email, avatar: meta.avatar_url || meta.picture || null, fullName: meta.full_name || meta.name || '' });
      setDisplayName(meta.full_name || meta.name || '');
      const seedUsername = (meta.full_name || meta.name || (user.email || '').split('@')[0] || '')
        .toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20).replace(/^_+|_+$/g, '');
      if (seedUsername.length >= 3) setUsername(seedUsername);
    })();
  }, [router]);

  async function submit() {
    setErr(null);
    if (availability !== 'available') { setErr('Pick an available username'); return; }
    if (!displayName.trim()) { setErr('Enter a display name'); return; }
    setSaving(true);
    try {
      const { error } = await supabase().from('profiles').insert({
        id: user!.id,
        username: username.trim().toLowerCase(),
        display_name: displayName.trim().slice(0, 40),
        avatar_url: user!.avatar || null,
        public_profile: false,
      });
      if (error) throw error;
      router.replace('/');
    } catch (e: any) {
      setErr(e?.message || 'Failed to create profile');
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
      <div className="app-content" style={{ padding: '60px 24px 40px' }}>
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

        {err && <div style={{ marginTop: 16, padding: 10, borderRadius: 10, background: 'rgba(220,107,88,0.12)', border: '1px solid rgba(220,107,88,0.3)', color: 'var(--danger)', fontSize: 13 }}>{err}</div>}

        <button className="btn btn-primary" disabled={saving || availability !== 'available' || !displayName.trim()}
          onClick={submit}
          style={{ width: '100%', marginTop: 26, fontSize: 16, padding: '16px' }}>
          {saving ? <Loader2 size={18} className="spin" /> : <ChevronRight size={18} />}
          Start tracking
        </button>
      </div>
    </div>
  );
}
