'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Bell, Check, Fish, Loader2, MessageCircle, Tent, ThumbsUp, UserPlus, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as db from '@/lib/db';
import type { AppNotification, Catch as CatchT, Profile, Trip } from '@/lib/types';
import { PageHeader } from '@/components/AppFrame';
import { useNotifications, useProfilesByIds, useMe, useTrips, useCatches } from '@/lib/queries';
import { QK } from '@/lib/queryKeys';
import { CatchDetail } from '@/components/CarpApp';
import PullToRefresh from '@/components/PullToRefresh';

type RowData = {
  notif: AppNotification;
  actor?: Profile;
  trip?: Trip;
};

// Triggers store the actor under a type-specific payload key (liker_*,
// commenter_*, sender_*, etc.). These helpers pick the right field per
// type and fall back to legacy keys (angler_id / angler_name) so older
// rows written before the rename still render correctly.
function actorIdForType(n: AppNotification): string | undefined {
  const p: any = n.payload || {};
  switch (n.type) {
    case 'catch_liked':       return p.liker_id || p.angler_id;
    case 'comment_on_catch':  return p.commenter_id || p.angler_id;
    case 'trip_new_catch':    return p.angler_id;
    case 'friend_request':    return p.requester_id;
    case 'friend_accepted':   return p.addressee_id || p.accepter_id;
    case 'trip_invite':       return p.invited_by || p.inviter_id;
    case 'trip_chat':
    case 'trip_chat_mention': return p.sender_id || p.angler_id;
    case 'trip_new_member':   return p.joiner_id || p.angler_id;
    default:                  return p.actor_id || p.angler_id;
  }
}
function actorNameFromPayload(n: AppNotification): string | undefined {
  const p: any = n.payload || {};
  switch (n.type) {
    case 'catch_liked':       return p.liker_name || p.angler_name;
    case 'comment_on_catch':  return p.commenter_name || p.angler_name;
    case 'trip_new_catch':    return p.angler_name;
    case 'friend_request':    return p.requester_name;
    case 'friend_accepted':   return p.accepter_name;
    case 'trip_invite':       return p.inviter_name;
    case 'trip_chat':
    case 'trip_chat_mention': return p.sender_name || p.angler_name;
    case 'trip_new_member':   return p.joiner_name || p.angler_name;
    default:                  return p.angler_name;
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const notifsQuery = useNotifications();
  // Belt-and-braces: TanStack Query in placeholder/initial state may yield
  // undefined; a stale cache entry under a colliding key could yield non-array.
  const notifs: AppNotification[] | undefined = Array.isArray(notifsQuery.data) ? notifsQuery.data : undefined;

  // Data needed by the inline CatchDetail modal. Hooks are cached across
  // pages so visiting /notifications after the home page is essentially free.
  const me = useMe().data || null;
  const trips = useTrips().data || [];
  const catches = useCatches().data || [];
  const allActorIdsFromCatches = useMemo(() => {
    const set = new Set<string>();
    catches.forEach(c => set.add(c.angler_id));
    return Array.from(set);
  }, [catches]);
  const profilesByIdsQuery = useProfilesByIds(allActorIdsFromCatches);
  const profilesById: Record<string, Profile> = (profilesByIdsQuery.data && typeof profilesByIdsQuery.data === 'object' && !Array.isArray(profilesByIdsQuery.data))
    ? profilesByIdsQuery.data
    : {};

  const [detailCatch, setDetailCatch] = useState<CatchT | null>(null);

  async function openCatchById(catchId: string) {
    // Cache-first: skip the network if the catch is already loaded via useCatches
    // (CarpApp's cache reaches here too) or via QK.catches.detail.
    let c: CatchT | null =
      qc.getQueryData<CatchT>(QK.catches.detail(catchId)) ||
      catches.find(x => x.id === catchId) ||
      null;
    if (!c) {
      try {
        c = await qc.fetchQuery({
          queryKey: QK.catches.detail(catchId),
          queryFn: () => db.getCatchById(catchId),
        });
      } catch { c = null; }
    }
    if (!c) {
      alert('This catch is no longer available');
      return;
    }
    setDetailCatch(c);
  }

  // Resolve actor profiles & referenced trips for this batch of notifications.
  const actorIds = useMemo(() => {
    if (!notifs) return [] as string[];
    const set = new Set<string>();
    notifs.forEach(n => {
      const id = actorIdForType(n);
      if (id) set.add(id);
    });
    return Array.from(set);
  }, [notifs]);
  const tripIds = useMemo(() => {
    if (!notifs) return [] as string[];
    const set = new Set<string>();
    notifs.forEach(n => { if (n.payload?.trip_id) set.add(n.payload.trip_id); });
    return Array.from(set);
  }, [notifs]);

  // Use the canonical useProfilesByIds hook from lib/queries (returns a
  // Record<id, Profile> map). Defining a local useQuery with the same
  // ['profiles','ids',...] key collided with that hook's cache shape and
  // caused the production crash on this page.
  const actorsQuery = useProfilesByIds(actorIds);
  const tripsQuery = useQuery({
    queryKey: ['notifs', 'trips', [...tripIds].sort().join(',')],
    queryFn: () => Promise.all(tripIds.map(id => db.getTrip(id))).then(arr => arr.filter((x): x is Trip => !!x)),
    enabled: tripIds.length > 0,
    staleTime: 60_000,
  });

  const aMap: Record<string, Profile> = (actorsQuery.data && typeof actorsQuery.data === 'object' && !Array.isArray(actorsQuery.data))
    ? actorsQuery.data
    : {};
  const tMap = useMemo(() => {
    const m: Record<string, Trip> = {};
    const arr = Array.isArray(tripsQuery.data) ? tripsQuery.data : [];
    arr.forEach(t => { m[t.id] = t; });
    return m;
  }, [tripsQuery.data]);

  const rows: RowData[] | null = notifs ? notifs.map(n => ({
    notif: n,
    actor: aMap[actorIdForType(n) || ''],
    trip: tMap[n.payload?.trip_id || ''],
  })) : null;

  // ----- Mutations: all optimistic so taps feel instant -----

  // Mark a batch of ids as read. Used on initial load to clear the badge.
  const markReadMut = useMutation({
    mutationFn: (ids: string[]) => db.markRead(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: QK.notifications.list });
      const prev = qc.getQueryData<AppNotification[]>(QK.notifications.list);
      qc.setQueryData<AppNotification[]>(QK.notifications.list, (old) =>
        old ? old.map(n => ids.includes(n.id) ? { ...n, read: true } : n) : old);
      qc.setQueryData<number>(QK.notifications.unread, (old) => Math.max(0, (old ?? 0) - ids.length));
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(QK.notifications.list, ctx.prev);
      qc.invalidateQueries({ queryKey: QK.notifications.unread });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => db.deleteNotification(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QK.notifications.list });
      const prev = qc.getQueryData<AppNotification[]>(QK.notifications.list);
      const removed = prev?.find(n => n.id === id);
      qc.setQueryData<AppNotification[]>(QK.notifications.list, (old) => old ? old.filter(n => n.id !== id) : old);
      if (removed && !removed.read) {
        qc.setQueryData<number>(QK.notifications.unread, (old) => Math.max(0, (old ?? 0) - 1));
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(QK.notifications.list, ctx.prev);
      qc.invalidateQueries({ queryKey: QK.notifications.unread });
    },
  });

  // Mark all unread as read on first view of the page.
  useEffect(() => {
    if (!notifs) return;
    const unread = notifs.filter(n => !n.read).map(n => n.id);
    if (unread.length === 0) return;
    markReadMut.mutate(unread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifs?.length]);

  // Per-type click routing. Returns true if the notification was handled
  // (so the row's onClick can also mark-read + dismiss).
  function handleNotifClick(n: AppNotification, trip?: Trip, actor?: Profile) {
    switch (n.type) {
      case 'trip_new_catch':
      case 'comment_on_catch':
      case 'catch_liked': {
        const catchId = n.payload?.catch_id;
        if (catchId) {
          // Mount CatchDetail INLINE on this page (no route change). Closing
          // the modal returns the user to /notifications with the list intact.
          openCatchById(catchId);
          return true;
        }
        return false;
      }
      case 'friend_accepted': {
        if (actor?.username) { router.push(`/profile/${actor.username}`); return true; }
        return false;
      }
      case 'friend_request': {
        router.push('/friends');
        return true;
      }
      case 'trip_invite':
      case 'trip_new_member':
      case 'trip_chat':
      case 'trip_chat_mention': {
        if (trip?.id) {
          router.push(`/?trip=${trip.id}&back=${encodeURIComponent('/notifications')}`);
          return true;
        }
        return false;
      }
      default: return false;
    }
  }

  // Initial-load skeleton: only show spinner when there is genuinely no data
  // available yet. Subsequent visits hit the cache and render instantly.
  if (!rows && notifsQuery.isLoading) return (
    <div className="app-root"><div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} /></div></div>
  );

  return (
    <PullToRefresh onRefresh={async () => {
      await qc.invalidateQueries({ queryKey: QK.notifications.list });
    }}>
    <div className="app-root">
      <PageHeader title="Notifications" back />
      <div style={{ padding: '8px 20px 80px' }}>
        {!rows || rows.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Bell size={48} style={{ color: 'var(--text-3)', opacity: 0.4, margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-3)' }}>You're all caught up</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(({ notif, actor, trip }) => {
              const handleClick = () => {
                handleNotifClick(notif, trip, actor);
              };
              if (notif.type === 'friend_request') {
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                if (!actorName) return null;
                return (
                  <NotifCard key={notif.id} icon={<UserPlus size={16} style={{ color: 'var(--gold-2)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        <strong>{actorName}</strong> wants to be friends
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <ActionBtn primary onClick={async () => {
                        await db.acceptFriend(notif.payload.friendship_id);
                        deleteMut.mutate(notif.id);
                      }}><Check size={12} /> Accept</ActionBtn>
                      <ActionBtn onClick={async () => {
                        await db.declineFriend(notif.payload.friendship_id);
                        deleteMut.mutate(notif.id);
                      }}>Decline</ActionBtn>
                    </div>
                  </NotifCard>
                );
              }
              if (notif.type === 'friend_accepted') {
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                if (!actorName) return null;
                return (
                  <NotifCard key={notif.id} clickable onClick={handleClick} icon={<Check size={16} style={{ color: 'var(--sage)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        <strong>{actorName}</strong> accepted your friend request
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <ActionBtn onClick={(e) => { e.stopPropagation(); deleteMut.mutate(notif.id); }}>
                      <X size={12} />
                    </ActionBtn>
                  </NotifCard>
                );
              }
              if (notif.type === 'trip_invite') {
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                return (
                  <NotifCard key={notif.id} icon={<Tent size={16} style={{ color: 'var(--gold-2)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        {actorName ? <><strong>{actorName}</strong> invited you to </> : 'Invited to '}
                        <strong>{trip?.name || 'a trip'}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <ActionBtn primary onClick={async () => {
                        await db.setTripMemberStatus(notif.payload.trip_member_id, 'joined');
                        deleteMut.mutate(notif.id);
                      }}><Check size={12} /> Join</ActionBtn>
                      <ActionBtn onClick={async () => {
                        await db.setTripMemberStatus(notif.payload.trip_member_id, 'declined');
                        deleteMut.mutate(notif.id);
                      }}>Decline</ActionBtn>
                    </div>
                  </NotifCard>
                );
              }
              if (notif.type === 'trip_new_catch' || notif.type === 'comment_on_catch' || notif.type === 'catch_liked') {
                const lbs = notif.payload?.lbs ?? 0;
                const oz = notif.payload?.oz ?? 0;
                const species = notif.payload?.species as string | undefined;
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                const icon = notif.type === 'catch_liked'
                  ? <ThumbsUp size={16} style={{ color: 'var(--gold-2)' }} />
                  : <Fish size={16} style={{ color: 'var(--gold-2)' }} />;
                return (
                  <NotifCard key={notif.id} clickable onClick={handleClick} icon={icon}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        {notif.type === 'comment_on_catch' ? (
                          <>{actorName ? <><strong>{actorName}</strong> commented on your catch</> : 'New comment on your catch'}</>
                        ) : notif.type === 'catch_liked' ? (
                          <>{actorName ? <><strong>{actorName}</strong> liked your catch</> : 'Your catch was liked'}</>
                        ) : (
                          <>{actorName ? <><strong>{actorName}</strong> banked </> : 'New catch '}
                          <strong>{lbs}lb{oz ? ` ${oz}oz` : ''}</strong>
                          {species ? <> {species}</> : null}
                          {trip ? <> on <strong>{trip.name}</strong></> : null}</>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <ActionBtn onClick={(e) => { e.stopPropagation(); deleteMut.mutate(notif.id); }}><X size={12} /></ActionBtn>
                  </NotifCard>
                );
              }
              if (notif.type === 'trip_new_member') {
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                return (
                  <NotifCard key={notif.id} clickable onClick={handleClick} icon={<UserPlus size={16} style={{ color: 'var(--sage)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        {actorName ? <><strong>{actorName}</strong> joined </> : 'New member on '}
                        <strong>{trip?.name || 'your trip'}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <ActionBtn onClick={(e) => { e.stopPropagation(); deleteMut.mutate(notif.id); }}><X size={12} /></ActionBtn>
                  </NotifCard>
                );
              }
              if (notif.type === 'trip_chat') {
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                return (
                  <NotifCard key={notif.id} clickable onClick={handleClick} icon={<MessageCircle size={16} style={{ color: 'var(--text-2)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        {actorName ? <><strong>{actorName}</strong></> : 'New message'} {trip ? <>in <strong>{trip.name}</strong></> : null}
                      </div>
                      {notif.payload?.snippet && (
                        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{notif.payload.snippet}"</div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <ActionBtn onClick={(e) => { e.stopPropagation(); deleteMut.mutate(notif.id); }}><X size={12} /></ActionBtn>
                  </NotifCard>
                );
              }
              if (notif.type === 'trip_chat_mention') {
                const actorName = actor?.display_name || actor?.username || actorNameFromPayload(notif);
                return (
                  <NotifCard key={notif.id} clickable onClick={handleClick} icon={<AtSign size={16} style={{ color: 'var(--gold-2)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        {actorName ? <><strong>{actorName}</strong> mentioned you{trip ? <> in <strong>{trip.name}</strong></> : ''}</> : 'You were mentioned'}
                      </div>
                      {notif.payload?.preview && (
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{notif.payload.preview}"</div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <ActionBtn onClick={(e) => { e.stopPropagation(); deleteMut.mutate(notif.id); }}><X size={12} /></ActionBtn>
                  </NotifCard>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>

      {detailCatch && me && (
        <CatchDetail
          catchData={detailCatch}
          me={me}
          profilesById={profilesById}
          trips={trips}
          onClose={() => setDetailCatch(null)}
          onDelete={async () => {
            if (!confirm('Delete this catch?')) return;
            await db.deleteCatch(detailCatch.id);
            qc.invalidateQueries({ queryKey: QK.catches.all });
            setDetailCatch(null);
          }}
          onUpdate={async (data, slots) => {
            const saved = await db.upsertCatch({ ...data, id: detailCatch.id });
            // Multi-photo reconciliation mirrors saveCatch in CarpApp.
            const previous = (await db.getCatchById(saved.id))?.photo_urls || [];
            const finalUrls: string[] = [];
            for (const s of slots) {
              if (s.url) finalUrls.push(s.url);
              else if (s.dataUrl) {
                try { finalUrls.push(await db.uploadCatchPhoto(saved.id, s.dataUrl)); } catch {}
              }
            }
            const keep = new Set(finalUrls);
            await Promise.all(previous.filter((u: string) => !keep.has(u)).map((u: string) => db.deleteCatchPhotoByUrl(u).catch(() => {})));
            await db.updateCatchPhotos(saved.id, finalUrls);
            qc.invalidateQueries({ queryKey: QK.catches.all });
            setDetailCatch({ ...saved, photo_urls: finalUrls, has_photo: finalUrls.length > 0 });
          }}
          onOpenTrip={(t) => {
            setDetailCatch(null);
            router.push(`/?trip=${t.id}&back=${encodeURIComponent('/notifications')}`);
          }}
        />
      )}
    </div>
    </PullToRefresh>
  );
}

function NotifCard({ icon, children, clickable, onClick }: { icon: React.ReactNode; children: React.ReactNode; clickable?: boolean; onClick?: () => void }) {
  return (
    <div className={clickable ? 'card tap' : 'card'}
      onClick={clickable ? onClick : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor: clickable ? 'pointer' : 'default' }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(212,182,115,0.10)', border: '1px solid rgba(234,201,136,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      {children}
    </div>
  );
}

function ActionBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className="tap" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
      fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
      background: primary ? 'var(--gold)' : 'transparent',
      color: primary ? '#1A1004' : 'var(--text-3)',
      border: primary ? 'none' : '1px solid rgba(234,201,136,0.18)',
    }}>{children}</button>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
