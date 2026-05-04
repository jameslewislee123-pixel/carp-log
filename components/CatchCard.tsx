'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Anchor, MapPin, MessageCircle, Tent } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Catch, Profile, Trip } from '@/lib/types';
import { formatDate } from '@/lib/util';
import { photoPublicUrl } from '@/lib/db';
import { prefetchProfile, prefetchCatchesForAngler } from '@/lib/queries';
import AvatarBubble from './AvatarBubble';
import CatchPhotoCarousel from './CatchPhotoCarousel';

const SPECIES = [
  { id: 'common',  label: 'Common',  hue: '#B07A3F' },
  { id: 'mirror',  label: 'Mirror',  hue: '#C9A961' },
  { id: 'leather', label: 'Leather', hue: '#7A5A2E' },
  { id: 'ghost',   label: 'Ghost',   hue: '#D8D2C0' },
  { id: 'koi',     label: 'Koi',     hue: '#D85B47' },
  { id: 'other',   label: 'Other',   hue: '#8A9D96' },
];

function PBPeel() {
  return (
    <span title="Personal best" style={{
      position: 'absolute', top: 8, right: 8, zIndex: 3,
      padding: '4px 10px', borderRadius: 999,
      background: 'linear-gradient(180deg, #EAC988, #C9A961)',
      color: '#1A1004', fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 11,
      letterSpacing: '0.08em',
      boxShadow: '0 4px 12px rgba(212,182,115,0.45), inset 0 1px 0 rgba(255,255,255,0.55)',
      border: '1px solid rgba(255,255,255,0.35)',
    }}>PB</span>
  );
}

export default function CatchCard({
  catchData, angler, trip, onClick, commentCount: commentCountProp, pb,
}: {
  catchData: Catch;
  angler: Profile | null;
  trip: Trip | null;
  onClick?: () => void;
  commentCount?: number;
  pb?: boolean;
}) {
  const species = SPECIES.find(s => s.id === catchData.species);
  const commentCount = typeof commentCountProp === 'number' ? commentCountProp : 0;
  const [photoErr, setPhotoErr] = useState(false);
  // Photo URLs for the card. Prefer photo_urls (multi-photo); fall back to
  // the legacy derived single-photo path. The carousel hides itself for 1
  // photo (just renders the image) so this works in both cases.
  const cardPhotoUrls: string[] =
    (catchData.photo_urls && catchData.photo_urls.length > 0)
      ? catchData.photo_urls
      : (catchData.has_photo && angler ? [photoPublicUrl(angler.id, catchData.id)] : []);
  const qc = useQueryClient();

  if (catchData.lost) {
    return (
      <div className="card tap fade-in" onClick={onClick} style={{ position: 'relative', padding: 14, cursor: 'pointer', borderColor: 'rgba(220,107,88,0.32)', display: 'flex', alignItems: 'center', gap: 12 }}>
        {pb && <PBPeel />}
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(220,107,88,0.15)', border: '1px solid rgba(220,107,88,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Anchor size={18} style={{ color: 'var(--danger)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
            {angler && (
              <Link href={`/profile/${angler.username}`} onClick={(e) => e.stopPropagation()}
                onTouchStart={() => { prefetchProfile(qc, angler.username); prefetchCatchesForAngler(qc, angler.id); }}
                onMouseEnter={() => { prefetchProfile(qc, angler.username); prefetchCatchesForAngler(qc, angler.id); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', textDecoration: 'none' }}>
                <AvatarBubble username={angler.username} displayName={angler.display_name} avatarUrl={angler.avatar_url} size={20} link={false} fontWeight={700} />
                <strong style={{ fontWeight: 600 }}>{angler.display_name}</strong>
              </Link>
            )}
            <span style={{ color: 'var(--text-3)' }}>lost one</span>
            {commentCount > 0 && <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={11} />{commentCount}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {formatDate(catchData.date)}
            {catchData.swim && ` · Swim ${catchData.swim}`}
            {catchData.rig && ` · ${catchData.rig}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card tap fade-in" onClick={onClick} style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
      {pb && <PBPeel />}
      {catchData.has_photo && cardPhotoUrls.length > 0 && !photoErr && (
        <div style={{ position: 'relative' }}>
          <CatchPhotoCarousel
            urls={cardPhotoUrls}
            variant="card"
            // For card variant, any photo tap should open the catch detail.
            onOpenLightbox={() => onClick?.()}
            onError={() => setPhotoErr(true)}
          />
          {/* Static overlays sit above the carousel (above any photo). The
              carousel itself stops swipe propagation so feed scroll isn't
              hijacked. */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(5,14,13,0.9))', borderRadius: '22px 22px 0 0', pointerEvents: 'none' }} />
          {trip && (
            <div style={{ position: 'absolute', top: 12, left: 12, pointerEvents: 'none' }}>
              <span className="pill" style={{ background: 'rgba(5,14,13,0.7)', color: 'var(--gold-2)', border: '1px solid rgba(212,182,115,0.4)', backdropFilter: 'blur(8px)' }}>
                <Tent size={10} /> {trip.name}
              </span>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 14, left: 16, right: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, pointerEvents: 'none' }}>
            <div className="num-display" style={{ fontSize: 38, lineHeight: 0.95, color: 'var(--text)', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
              {catchData.lbs}<span style={{ fontSize: 22 }}>lb</span>
              {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 18 }}>oz</span></>}
            </div>
            {species && <span className="pill" style={{ background: `${species.hue}33`, color: species.hue, border: `1px solid ${species.hue}66` }}>{species.label}</span>}
          </div>
        </div>
      )}

      <div style={{ padding: catchData.has_photo && !photoErr ? '14px 16px' : '18px' }}>
        {(!catchData.has_photo || photoErr) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
            <div className="num-display" style={{ fontSize: 34, lineHeight: 0.95 }}>
              {catchData.lbs}<span style={{ fontSize: 18, color: 'var(--text-3)' }}>lb</span>
              {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 16, color: 'var(--text-3)' }}>oz</span></>}
            </div>
            {species && <span className="pill" style={{ background: `${species.hue}33`, color: species.hue, border: `1px solid ${species.hue}66` }}>{species.label}</span>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          {angler && (
            <Link href={`/profile/${angler.username}`} onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', textDecoration: 'none' }}>
              <AvatarBubble username={angler.username} displayName={angler.display_name} avatarUrl={angler.avatar_url} size={22} link={false} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{angler.display_name}</span>
            </Link>
          )}
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{formatDate(catchData.date)}</span>
          {commentCount > 0 && <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={12} />{commentCount}</span>}
        </div>
        {(catchData.lake || catchData.swim || catchData.bait) && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
            {catchData.lake && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />{catchData.lake}{catchData.swim ? ` · Swim ${catchData.swim}` : ''}</span>}
            {!catchData.lake && catchData.swim && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />Swim {catchData.swim}</span>}
            {catchData.bait && <span>{'🎣'} {catchData.bait}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Compute a map { angler_id -> id of their PB catch }. PB = heaviest non-lost catch.
export function computePBMap(catches: Catch[]): Record<string, string> {
  const best: Record<string, { id: string; oz: number }> = {};
  for (const c of catches) {
    if (c.lost) continue;
    const oz = (c.lbs || 0) * 16 + (c.oz || 0);
    if (oz <= 0) continue;
    const cur = best[c.angler_id];
    if (!cur || oz > cur.oz) best[c.angler_id] = { id: c.id, oz };
  }
  const out: Record<string, string> = {};
  for (const k in best) out[k] = best[k].id;
  return out;
}

export { SPECIES };
