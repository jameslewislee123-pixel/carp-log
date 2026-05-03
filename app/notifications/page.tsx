'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Loader2, Tent, UserPlus, X } from 'lucide-react';
import * as db from '@/lib/db';
import type { AppNotification, Profile, Trip, TripMember } from '@/lib/types';
import { PageHeader } from '@/components/AppFrame';
import AvatarBubble from '@/components/AvatarBubble';

type RowData = {
  notif: AppNotification;
  actor?: Profile;
  trip?: Trip;
  tripMember?: TripMember;
};

export default function NotificationsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<RowData[] | null>(null);

  async function load() {
    const notifs = await db.listNotifications();
    const actorIds = new Set<string>(), tripIds = new Set<string>(), tmIds = new Set<string>();
    notifs.forEach(n => {
      if (n.payload?.requester_id) actorIds.add(n.payload.requester_id);
      if (n.payload?.addressee_id) actorIds.add(n.payload.addressee_id);
      if (n.payload?.invited_by)   actorIds.add(n.payload.invited_by);
      if (n.payload?.trip_id)      tripIds.add(n.payload.trip_id);
      if (n.payload?.trip_member_id) tmIds.add(n.payload.trip_member_id);
    });
    const [actors, trips] = await Promise.all([
      db.listProfilesByIds(Array.from(actorIds)),
      Promise.all(Array.from(tripIds).map(id => db.getTrip(id))).then(arr => arr.filter((x): x is Trip => !!x)),
    ]);
    const aMap: Record<string, Profile> = {}; actors.forEach(a => aMap[a.id] = a);
    const tMap: Record<string, Trip> = {}; trips.forEach(t => tMap[t.id] = t);
    const out: RowData[] = notifs.map(n => ({
      notif: n,
      actor: aMap[n.payload?.requester_id || n.payload?.invited_by || n.payload?.addressee_id || ''],
      trip: tMap[n.payload?.trip_id || ''],
    }));
    setRows(out);
    if (notifs.length > 0) {
      const unread = notifs.filter(n => !n.read).map(n => n.id);
      if (unread.length) await db.markRead(unread);
    }
  }
  useEffect(() => { load(); }, []);

  if (!rows) return (
    <div className="app-root"><div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} /></div></div>
  );

  return (
    <div className="app-root">
      <PageHeader title="Notifications" back />
      <div style={{ padding: '8px 20px 80px' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Bell size={48} style={{ color: 'var(--text-3)', opacity: 0.4, margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-3)' }}>You're all caught up</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(({ notif, actor, trip }) => {
              if (notif.type === 'friend_request') {
                if (!actor) return null;
                return (
                  <NotifCard key={notif.id} icon={<UserPlus size={16} style={{ color: 'var(--gold-2)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        <strong>{actor.display_name}</strong> wants to be friends
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <ActionBtn primary onClick={async () => {
                        // friendship_id was stored in payload
                        await db.acceptFriend(notif.payload.friendship_id);
                        await db.deleteNotification(notif.id); load();
                      }}><Check size={12} /> Accept</ActionBtn>
                      <ActionBtn onClick={async () => {
                        await db.declineFriend(notif.payload.friendship_id);
                        await db.deleteNotification(notif.id); load();
                      }}>Decline</ActionBtn>
                    </div>
                  </NotifCard>
                );
              }
              if (notif.type === 'friend_accepted') {
                if (!actor) return null;
                return (
                  <NotifCard key={notif.id} icon={<Check size={16} style={{ color: 'var(--sage)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        <strong>{actor.display_name}</strong> accepted your friend request
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <ActionBtn onClick={() => { db.deleteNotification(notif.id); load(); }}>
                      <X size={12} />
                    </ActionBtn>
                  </NotifCard>
                );
              }
              if (notif.type === 'trip_invite') {
                return (
                  <NotifCard key={notif.id} icon={<Tent size={16} style={{ color: 'var(--gold-2)' }} />}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>
                        {actor ? <><strong>{actor.display_name}</strong> invited you to </> : 'Invited to '}
                        <strong>{trip?.name || 'a trip'}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{relTime(notif.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <ActionBtn primary onClick={async () => {
                        await db.setTripMemberStatus(notif.payload.trip_member_id, 'joined');
                        await db.deleteNotification(notif.id);
                        load();
                      }}><Check size={12} /> Join</ActionBtn>
                      <ActionBtn onClick={async () => {
                        await db.setTripMemberStatus(notif.payload.trip_member_id, 'declined');
                        await db.deleteNotification(notif.id); load();
                      }}>Decline</ActionBtn>
                    </div>
                  </NotifCard>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NotifCard({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(212,182,115,0.10)', border: '1px solid rgba(234,201,136,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      {children}
    </div>
  );
}

function ActionBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
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
