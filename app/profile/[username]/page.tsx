'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Loader2, Trophy, UserPlus, Users, Check, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import * as db from '@/lib/db';
import type { Catch, Profile, Friendship } from '@/lib/types';
import { formatWeight, totalOz } from '@/lib/util';
import { PageHeader } from '@/components/AppFrame';
import AvatarBubble from '@/components/AvatarBubble';
import AvatarLightbox from '@/components/AvatarLightbox';
import { SPECIES } from '@/components/CatchCard';
import { catchCoverUrl } from '@/lib/db';
import { useProfileByUsername, useCatchesForAngler, useFriendships } from '@/lib/queries';
import { QK } from '@/lib/queryKeys';

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  // `me` is one-shot (cached separately by TanStack Query for cross-page reuse).
  const meQuery = useQuery({ queryKey: QK.profiles.me, queryFn: db.getMe, staleTime: 5 * 60_000 });
  const profileQuery = useProfileByUsername(username);
  const catchesQuery = useCatchesForAngler(profileQuery.data?.id);
  const friendshipsQuery = useFriendships();
  const [busy, setBusy] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const me: Profile | null = meQuery.data || null;
  const profile = profileQuery.data;
  const profileMissing = profileQuery.isFetched && !profile;
  const catches = catchesQuery.data || [];

  const friendship = useMemo<Friendship | null>(() => {
    if (!me || !profile || !friendshipsQuery.data) return null;
    return friendshipsQuery.data.find(x =>
      (x.requester_id === me.id && x.addressee_id === profile.id) ||
      (x.requester_id === profile.id && x.addressee_id === me.id)
    ) || null;
  }, [me, profile, friendshipsQuery.data]);

  // First-load skeleton: wait until profileQuery has settled at least once.
  if (profileQuery.isLoading && !profile) return (
    <div className="app-root"><div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} /></div></div>
  );
  if (profileMissing || !profile) return (
    <div className="app-root">
      <PageHeader title="Not found" back />
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-3)' }}>No angler with username @{username}</p>
      </div>
    </div>
  );

  const isMe = me?.id === profile.id;
  const isFriend = friendship?.status === 'accepted';
  const isPending = friendship?.status === 'pending';
  // 'sent' = current user sent the request (we can cancel it)
  // 'incoming' = profile owner sent us a request (we can accept/decline)
  const sentByMe = friendship?.requester_id === me?.id && isPending;
  const incomingFromThem = friendship?.requester_id === profile.id && isPending;

  const stats = (() => {
    const landed = catches.filter(c => !c.lost);
    const biggest = landed.reduce<Catch | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    const totalOzAll = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
    const bySpecies = SPECIES.map(sp => ({ ...sp, count: landed.filter(c => c.species === sp.id).length })).filter(sp => sp.count > 0);
    return { biggest, count: landed.length, totalOzAll, bySpecies };
  })();

  async function addFriend() {
    if (!profile) return;
    setBusy(true);
    try {
      await db.requestFriend(profile.id);
      // Cache invalidate — the friendships query refetches itself in the background.
      friendshipsQuery.refetch();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }

  async function unfriend() {
    if (!profile) return;
    if (!confirm(`Unfriend ${profile.display_name}?`)) return;
    setBusy(true);
    try {
      await db.deleteFriendshipWith(profile.id);
      friendshipsQuery.refetch();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }
  async function cancelRequest() {
    if (!profile) return;
    if (!confirm(`Cancel friend request to ${profile.display_name}?`)) return;
    setBusy(true);
    try {
      await db.deleteFriendshipWith(profile.id);
      friendshipsQuery.refetch();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }
  async function acceptIncoming() {
    if (!friendship) return;
    setBusy(true);
    try {
      await db.acceptFriend(friendship.id);
      friendshipsQuery.refetch();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }
  async function declineIncoming() {
    if (!friendship) return;
    setBusy(true);
    try {
      await db.declineFriend(friendship.id);
      friendshipsQuery.refetch();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-root">
      <PageHeader title={profile.display_name} kicker={`@${profile.username}`} back />
      <div style={{ padding: '8px 20px 80px' }}>
        <div className="card" style={{ padding: 18, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="button"
            onClick={() => { if (profile.avatar_url) setLightboxOpen(true); }}
            disabled={!profile.avatar_url}
            aria-label="View profile picture"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: profile.avatar_url ? 'zoom-in' : 'default' }}
          >
            <AvatarBubble username={profile.username} displayName={profile.display_name} avatarUrl={profile.avatar_url} size={64} link={false} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="display-font" style={{ fontSize: 22, fontWeight: 500 }}>{profile.display_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={11} /> Joined {new Date(profile.created_at || Date.now()).toLocaleDateString([], { month: 'short', year: 'numeric' })}</div>
            {profile.bio && <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px 0 0', lineHeight: 1.4 }}>{profile.bio}</p>}
          </div>
        </div>

        {!isMe && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {isFriend ? (
              <button onClick={unfriend} disabled={busy} className="tap" style={{
                flex: 1, padding: '12px', borderRadius: 14, border: '1px solid var(--sage)',
                background: 'rgba(141,191,157,0.12)', color: 'var(--sage)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: busy ? 'wait' : 'pointer',
              }}>
                {busy ? <Loader2 size={14} className="spin" /> : <><Check size={14} /> Friends</>}
              </button>
            ) : sentByMe ? (
              <button onClick={cancelRequest} disabled={busy} className="tap" style={{
                flex: 1, padding: '12px', borderRadius: 14, border: '1px solid rgba(234,201,136,0.3)',
                background: 'rgba(212,182,115,0.08)', color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: busy ? 'wait' : 'pointer',
              }}>
                {busy ? <Loader2 size={14} className="spin" /> : <><Clock size={14} /> Request sent</>}
              </button>
            ) : incomingFromThem ? (
              <>
                <button onClick={acceptIncoming} disabled={busy} className="btn btn-primary tap" style={{ flex: 1, fontSize: 14 }}>
                  {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Accept
                </button>
                <button onClick={declineIncoming} disabled={busy} className="tap" style={{
                  flex: '0 0 auto', padding: '12px 16px', borderRadius: 14,
                  border: '1px solid rgba(234,201,136,0.18)', background: 'transparent',
                  color: 'var(--text-3)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer',
                }}>Decline</button>
              </>
            ) : (
              <button onClick={addFriend} disabled={busy} className="btn btn-primary tap" style={{ flex: 1, fontSize: 14 }}>
                {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Add friend
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 22 }}>
          <Stat label="Catches" value={stats.count} />
          <Stat label="Biggest" value={stats.biggest ? formatWeight(stats.biggest.lbs, stats.biggest.oz) : '—'} />
          <Stat label="Total" value={stats.totalOzAll ? `${Math.floor(stats.totalOzAll / 16)}lb` : '—'} />
        </div>

        {stats.bySpecies.length > 0 && (
          <>
            <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '8px 0 12px' }}>By species</h3>
            <div className="card" style={{ padding: 14, marginBottom: 22 }}>
              {stats.bySpecies.map(sp => {
                const pct = (sp.count / Math.max(1, stats.count)) * 100;
                return (
                  <div key={sp.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{sp.label}</span>
                      <span style={{ color: 'var(--text-3)' }}>{sp.count} · {pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(10,24,22,0.6)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: sp.hue, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '8px 0 12px' }}>Catches</h3>
        {catches.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No visible catches</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {catches.map(c => (
              <Link key={c.id} href={`/?catch=${c.id}&back=${encodeURIComponent(`/profile/${profile.username}`)}`} className="tap"
                style={{ aspectRatio: '1', borderRadius: 14, overflow: 'hidden', position: 'relative', background: 'rgba(10,24,22,0.5)', display: 'block', cursor: 'pointer' }}>
                {(() => {
                  const cover = catchCoverUrl(c);
                  return cover ? <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null;
                })()}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(5,14,13,0.92))' }} />
                <div style={{ position: 'absolute', bottom: 8, left: 10, right: 10 }}>
                  {c.lost ? (
                    <div style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700 }}>Lost</div>
                  ) : (
                    <div className="num-display" style={{ fontSize: 18, color: 'var(--text)', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                      {c.lbs}<span style={{ fontSize: 12 }}>lb</span>{c.oz > 0 && <> {c.oz}<span style={{ fontSize: 11 }}>oz</span></>}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {lightboxOpen && profile.avatar_url && (
        <AvatarLightbox src={profile.avatar_url} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
      <div className="num-display" style={{ fontSize: 22, color: 'var(--gold-2)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}
