'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Anchor, Crown, Fish, MessageCircle, Tent, Trophy, Users } from 'lucide-react';
import * as db from '@/lib/db';
import type { Profile, TripActivity as TA } from '@/lib/types';
import { formatWeight } from '@/lib/util';
import { supabase } from '@/lib/supabase/client';
import AvatarBubble from './AvatarBubble';

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function iconFor(type: TA['type']) {
  switch (type) {
    case 'joined':         return <Users size={14} style={{ color: 'var(--sage)' }} />;
    case 'caught':         return <Fish size={14} style={{ color: 'var(--gold-2)' }} />;
    case 'lost_fish':      return <Anchor size={14} style={{ color: 'var(--danger)' }} />;
    case 'commented':      return <MessageCircle size={14} style={{ color: 'var(--text-3)' }} />;
    case 'joined_chat':    return <MessageCircle size={14} style={{ color: 'var(--sage)' }} />;
    case 'set_wager':      return <Trophy size={14} style={{ color: 'var(--gold-2)' }} />;
    case 'became_leader':  return <Crown size={14} style={{ color: 'var(--gold)' }} />;
    default:               return <Tent size={14} style={{ color: 'var(--text-3)' }} />;
  }
}

function sentenceFor(a: TA, name: string): React.ReactNode {
  const p = a.payload || {};
  switch (a.type) {
    case 'joined':        return <><strong>{name}</strong> joined the trip</>;
    case 'caught':        return <><strong>{name}</strong> banked <strong>{formatWeight(p.lbs || 0, p.oz || 0)}</strong>{p.species ? ` ${p.species}` : ''}</>;
    case 'lost_fish':     return <><strong>{name}</strong> lost one{p.swim ? ` at swim ${p.swim}` : ''}</>;
    case 'joined_chat':   return <><strong>{name}</strong> said hello in chat</>;
    case 'set_wager':     return <><strong>{name}</strong> staked: <em style={{ color: 'var(--gold-2)' }}>{p.stake_text}</em></>;
    case 'became_leader': return <><strong>{name}</strong> took the lead with <strong>{formatWeight(p.lbs || 0, p.oz || 0)}</strong></>;
    case 'commented':     return <><strong>{name}</strong> commented on a catch</>;
  }
}

export default function TripActivityFeed({ tripId, profilesById }: {
  tripId: string;
  profilesById: Record<string, Profile>;
}) {
  const [items, setItems] = useState<TA[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>(profilesById);

  async function load() {
    const list = await db.listTripActivity(tripId);
    setItems(list);
    const need = Array.from(new Set(list.map(a => a.angler_id))).filter(id => !profiles[id]);
    if (need.length > 0) {
      const ps = await db.listProfilesByIds(need);
      setProfiles(prev => { const out = { ...prev }; ps.forEach(p => out[p.id] = p); return out; });
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tripId]);

  useEffect(() => {
    const ch = supabase()
      .channel(`trip-activity-${tripId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_activity', filter: `trip_id=eq.${tripId}` }, () => load())
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  /* eslint-disable-next-line */ }, [tripId]);

  if (!items) return <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Loading…</p>;
  if (items.length === 0) return <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No activity yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(a => {
        const p = profiles[a.angler_id];
        const name = p?.display_name || 'Someone';
        const inner = (
          <>
            <AvatarBubble username={p?.username} displayName={p?.display_name} avatarUrl={p?.avatar_url} size={32} link={false} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>{sentenceFor(a, name)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {iconFor(a.type)} {relTime(a.created_at)}
              </div>
            </div>
          </>
        );
        const cardStyle: React.CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
          background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
          color: 'var(--text)', textDecoration: 'none',
        };
        return p?.username ? (
          <Link key={a.id} href={`/profile/${p.username}`} style={cardStyle}>{inner}</Link>
        ) : <div key={a.id} style={cardStyle}>{inner}</div>;
      })}
    </div>
  );
}
