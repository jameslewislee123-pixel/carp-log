'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Crown, Trophy } from 'lucide-react';
import type { Catch, Profile, TripMember } from '@/lib/types';
import { formatWeight, totalOz } from '@/lib/util';
import AvatarBubble from './AvatarBubble';

const SPECIES_LABEL: Record<string, string> = {
  common: 'Common', mirror: 'Mirror', leather: 'Leather', ghost: 'Ghost', koi: 'Koi', other: 'Other',
};

export default function TripLeaderboard({ tripCatches, members, profilesById, wagerEnabled, onOpenCatch }: {
  tripCatches: Catch[];
  members: TripMember[];
  profilesById: Record<string, Profile>;
  wagerEnabled: boolean;
  onOpenCatch?: (c: Catch) => void;
}) {
  const [metric, setMetric] = useState<'biggest' | 'count' | 'total'>('biggest');
  const landed = tripCatches.filter(c => !c.lost);
  const joined = members.filter(m => m.status === 'joined');

  const stats = useMemo(() => {
    const byAngler: Record<string, { profile: Profile | null; biggest: Catch | null; count: number; totalOz: number; }> = {};
    joined.forEach(jm => { byAngler[jm.angler_id] = { profile: profilesById[jm.angler_id] || null, biggest: null, count: 0, totalOz: 0 }; });
    landed.forEach(c => {
      let s = byAngler[c.angler_id];
      if (!s) {
        // catch by an angler not in members (rare — could happen via RLS edge case)
        s = byAngler[c.angler_id] = { profile: profilesById[c.angler_id] || null, biggest: null, count: 0, totalOz: 0 };
      }
      const oz = totalOz(c.lbs, c.oz);
      s.count++; s.totalOz += oz;
      if (!s.biggest || oz > totalOz(s.biggest.lbs, s.biggest.oz)) s.biggest = c;
    });
    return Object.values(byAngler);
  }, [landed, joined, profilesById]);

  const ranked = useMemo(() => {
    const arr = [...stats];
    if (metric === 'biggest') return arr.sort((a, b) => (b.biggest ? totalOz(b.biggest.lbs, b.biggest.oz) : 0) - (a.biggest ? totalOz(a.biggest.lbs, a.biggest.oz) : 0));
    if (metric === 'count') return arr.sort((a, b) => b.count - a.count);
    return arr.sort((a, b) => b.totalOz - a.totalOz);
  }, [stats, metric]);

  if (joined.length === 0) return null;
  const rankColors = ['var(--gold)', '#B5B6A6', '#A06D3D'];

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([{ id: 'biggest', label: 'Biggest' }, { id: 'count', label: 'Most caught' }, { id: 'total', label: 'Total weight' }] as const).map(m => (
          <button key={m.id} onClick={() => setMetric(m.id)} className="tap" style={{
            flex: 1, padding: '10px 8px', borderRadius: 12,
            border: `1px solid ${metric === m.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
            background: metric === m.id ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
            color: metric === m.id ? 'var(--gold-2)' : 'var(--text-2)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{m.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ranked.map((entry, i) => {
          const rank = i + 1;
          const noCatches = entry.count === 0 && !entry.biggest;
          const value = metric === 'biggest' ? (entry.biggest ? formatWeight(entry.biggest.lbs, entry.biggest.oz) : '—')
            : metric === 'count' ? `${entry.count}` : (entry.totalOz ? `${Math.floor(entry.totalOz / 16)}lb` : '—');
          const subtext = metric === 'biggest'
            ? (entry.biggest && entry.biggest.species ? SPECIES_LABEL[entry.biggest.species] || 'Caught' : (noCatches ? 'No catches yet' : 'banked'))
            : (noCatches ? 'No catches yet' : 'this trip');
          const showCrown = wagerEnabled && rank === 1 && entry.biggest;
          const tappable = metric === 'biggest' && entry.biggest && onOpenCatch;
          const inner = (
            <div className="card" style={{
              padding: 12, display: 'flex', alignItems: 'center', gap: 12,
              opacity: noCatches ? 0.55 : 1,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: rank <= 3 ? `${rankColors[rank - 1]}22` : 'rgba(10,24,22,0.55)',
                border: rank <= 3 ? `1px solid ${rankColors[rank - 1]}` : '1px solid rgba(234,201,136,0.18)',
                color: rank <= 3 ? rankColors[rank - 1] : 'var(--text-3)',
                fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 16, flexShrink: 0,
              }}>{rank}</div>
              {entry.profile ? (
                <AvatarBubble username={entry.profile.username} displayName={entry.profile.display_name} avatarUrl={entry.profile.avatar_url} size={36} link={false} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(20,42,38,0.7)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {entry.profile?.display_name || 'Unknown'}
                  {showCrown && <Crown size={14} style={{ color: 'var(--gold)' }} />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{subtext}</div>
              </div>
              <div className="num-display" style={{ fontSize: 20, color: 'var(--text)' }}>{value}</div>
              {tappable && <ChevronRight size={14} style={{ color: 'var(--text-3)', marginLeft: -4 }} />}
            </div>
          );
          if (tappable) {
            return (
              <button key={entry.profile?.id || i} onClick={() => onOpenCatch!(entry.biggest!)}
                style={{ background: 'transparent', border: 'none', padding: 0, width: '100%', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                {inner}
              </button>
            );
          }
          return entry.profile?.username ? (
            <Link key={entry.profile.id} href={`/profile/${entry.profile.username}`} style={{ textDecoration: 'none' }}>{inner}</Link>
          ) : <div key={i}>{inner}</div>;
        })}
      </div>
    </>
  );
}
