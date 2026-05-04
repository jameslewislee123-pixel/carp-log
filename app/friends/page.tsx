'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Search, UserPlus, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import * as db from '@/lib/db';
import type { Friendship, Profile } from '@/lib/types';
import { PageHeader } from '@/components/AppFrame';
import AvatarBubble from '@/components/AvatarBubble';
import { useMe, useFriendships, useProfilesByIds } from '@/lib/queries';
import { QK } from '@/lib/queryKeys';

type Tab = 'friends' | 'requests' | 'find';

export default function FriendsPage() {
  const qc = useQueryClient();
  const meQuery = useMe();
  const friendshipsQuery = useFriendships();
  const me = meQuery.data || null;
  // Be defensive: a cache collision elsewhere shouldn't crash this page.
  const friendships: Friendship[] = Array.isArray(friendshipsQuery.data) ? friendshipsQuery.data : [];
  const [tab, setTab] = useState<Tab>('friends');

  const friendIds = useMemo(() => {
    const set = new Set<string>();
    friendships.forEach(f => { set.add(f.requester_id); set.add(f.addressee_id); });
    return Array.from(set);
  }, [friendships]);
  const profilesQuery = useProfilesByIds(friendIds);
  const profilesById: Record<string, Profile> =
    (profilesQuery.data && typeof profilesQuery.data === 'object' && !Array.isArray(profilesQuery.data))
      ? profilesQuery.data : {};

  // Instant refetch helper (used after accept/decline/remove); rather than a
  // full local reload, just invalidate the cached queries so cards re-render
  // without flashing the spinner.
  function reload() {
    qc.invalidateQueries({ queryKey: QK.friendships });
  }

  // Spinner only shows on FIRST visit when there's no cache at all. Repeat
  // visits within the staleTime window land instantly on cached data.
  const initialLoading = !me && meQuery.isLoading || (friendshipsQuery.isLoading && !friendshipsQuery.data);
  if (initialLoading || !me) return (
    <div className="app-root"><div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} /></div></div>
  );

  const accepted = friendships.filter(f => f.status === 'accepted');
  const incoming = friendships.filter(f => f.status === 'pending' && f.addressee_id === me.id);
  const outgoing = friendships.filter(f => f.status === 'pending' && f.requester_id === me.id);

  return (
    <div className="app-root">
      <PageHeader title="Friends" back />
      <div style={{ padding: '8px 20px 80px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {([
            { id: 'friends' as const, label: `Friends${accepted.length ? ` (${accepted.length})` : ''}` },
            { id: 'requests' as const, label: `Requests${incoming.length ? ` (${incoming.length})` : ''}` },
            { id: 'find' as const, label: 'Find anglers' },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className="tap" style={{
              flex: 1, padding: '10px 6px', borderRadius: 12,
              border: `1px solid ${tab === t.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: tab === t.id ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
              color: tab === t.id ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>{t.label}</button>
          ))}
        </div>

        {tab === 'friends' && (
          <>
            {accepted.length === 0 ? <Empty>No friends yet — switch to “Find anglers” to add some.</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {accepted.map(f => {
                  const otherId = f.requester_id === me.id ? f.addressee_id : f.requester_id;
                  const p = profilesById[otherId];
                  if (!p) return null;
                  return (
                    <FriendRow key={f.id} profile={p}
                      action={
                        <button onClick={async () => {
                          if (confirm(`Remove ${p.display_name} from friends?`)) { await db.removeFriend(f.id); await reload(); }
                        }} style={{
                          background: 'transparent', border: '1px solid rgba(234,201,136,0.18)',
                          borderRadius: 999, padding: '6px 12px', color: 'var(--text-3)',
                          fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Remove</button>
                      }
                    />
                  );
                })}
              </div>
            )}
            {outgoing.length > 0 && (
              <>
                <div className="label" style={{ marginTop: 24 }}>Sent</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {outgoing.map(f => {
                    const p = profilesById[f.addressee_id];
                    if (!p) return null;
                    return <FriendRow key={f.id} profile={p}
                      action={<span style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Pending</span>}
                    />;
                  })}
                </div>
              </>
            )}
          </>
        )}

        {tab === 'requests' && (
          incoming.length === 0 ? <Empty>No incoming requests</Empty> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {incoming.map(f => {
                const p = profilesById[f.requester_id];
                if (!p) return null;
                return (
                  <FriendRow key={f.id} profile={p}
                    action={
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={async () => { await db.acceptFriend(f.id); await reload(); }} className="tap" style={{
                          background: 'var(--gold)', color: '#1A1004', border: 'none',
                          borderRadius: 999, padding: '8px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}><Check size={12} /> Accept</button>
                        <button onClick={async () => { await db.declineFriend(f.id); await reload(); }} className="tap" style={{
                          background: 'transparent', color: 'var(--text-3)', border: '1px solid rgba(234,201,136,0.18)',
                          borderRadius: 999, padding: '8px 12px', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Decline</button>
                      </div>
                    }
                  />
                );
              })}
            </div>
          )
        )}

        {tab === 'find' && <FindAnglers me={me} onFriendChange={reload} />}
      </div>
    </div>
  );
}

function FriendRow({ profile, action }: { profile: Profile; action?: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
      <Link href={`/profile/${profile.username}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, color: 'var(--text)', textDecoration: 'none' }}>
        <AvatarBubble username={profile.username} displayName={profile.display_name} avatarUrl={profile.avatar_url} size={44} link={false} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{profile.display_name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>@{profile.username}</div>
        </div>
      </Link>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '40px 20px' }}>{children}</p>;
}

function FindAnglers({ me, onFriendChange }: { me: Profile; onFriendChange: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [statusById, setStatusById] = useState<Record<string, 'none' | 'requested' | 'friends'>>({});

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return; }
      setSearching(true);
      try {
        const profs = await db.searchProfiles(q);
        setResults(profs.filter(p => p.id !== me.id));
        const fs = await db.listFriendships();
        const map: Record<string, 'none' | 'requested' | 'friends'> = {};
        for (const p of profs) {
          const f = fs.find(x => (x.requester_id === me.id && x.addressee_id === p.id) || (x.requester_id === p.id && x.addressee_id === me.id));
          map[p.id] = !f ? 'none' : (f.status === 'accepted' ? 'friends' : 'requested');
        }
        setStatusById(map);
      } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, me.id]);

  return (
    <>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input className="input" placeholder="Search by username or name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 40 }} />
      </div>
      {searching && <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>Searching…</p>}
      {!searching && q && results.length === 0 && <Empty>No anglers found</Empty>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results.map(p => {
          const st = statusById[p.id] || 'none';
          return (
            <FriendRow key={p.id} profile={p}
              action={
                st === 'friends' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--sage)', fontSize: 12, fontWeight: 700 }}><Check size={12} /> Friends</span>
                ) : st === 'requested' ? (
                  <span style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Pending</span>
                ) : (
                  <button onClick={async () => {
                    try { await db.requestFriend(p.id); setStatusById(prev => ({ ...prev, [p.id]: 'requested' })); onFriendChange(); }
                    catch (e: any) { alert(e?.message || 'Failed'); }
                  }} className="tap" style={{
                    background: 'var(--gold)', color: '#1A1004', border: 'none',
                    borderRadius: 999, padding: '8px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}><UserPlus size={12} /> Add</button>
                )
              }
            />
          );
        })}
      </div>
    </>
  );
}
