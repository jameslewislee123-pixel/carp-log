'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Eye, EyeOff, Loader2, MapPinned, Plus, Ruler } from 'lucide-react';
import * as db from '@/lib/db';
import { useActiveSetupForTrip, usePastSetupsForTrip } from '@/lib/queries';
import { useAnnotationsVisible } from '@/lib/annotationsVisible';
import type { Catch, LakeAnnotation, LakeAnnotationType, Profile, Trip } from '@/lib/types';
import { catchCoverUrl } from '@/lib/db';
import { geocodeLake } from '@/lib/weather';

// Avatar palette → marker colors keyed by stable hash of angler_id
const COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4', '#B07A3F'];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

// Lake-annotation labels are looked up here for the popup detail view only.
// Trip Map is read-only for annotations — creation lives on Lake Detail.
const ANN_TYPES: { id: LakeAnnotationType; label: string; emoji: string }[] = [
  { id: 'hot_spot',        label: 'Hot spot',   emoji: '🔥' },
  { id: 'productive_spot', label: 'Productive', emoji: '⭐' },
  { id: 'snag',            label: 'Snag',       emoji: '⚠️' },
  { id: 'note',            label: 'Note',       emoji: '📍' },
];

const MapInner = dynamic(() => import('./TripMapInner'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

export type MarkerCatch = {
  id: string;
  lat: number;
  lng: number;
  lbs: number; oz: number;
  species: string | null;
  date: string;
  has_photo: boolean;
  cover_url: string | null;
  angler: Profile | null;
  color: string;
};

type SetupTab = 'active' | 'past';

// Trip Map tab — primary surface for swim/rod management. PR1 lays down the
// shell (map with read-only annotation visibility toggle, big "Set up" CTA,
// Active/Past tabs with empty states). PR2 wires up the Set up + Add a rod
// flows; PR3 adds cross-trip Past Setups library and Use this setup copy.
//
// Annotation creation is intentionally NOT available here — the Trip Map is
// a consuming context; authoring belongs on Lake Detail, the source of
// truth. The eye toggle controls only whether existing annotations render.
export default function TripMap({ trip, me, catches, profilesById, onOpenCatch }: {
  trip: Trip;
  me: Profile;
  catches: Catch[];
  profilesById: Record<string, Profile>;
  onOpenCatch: (c: Catch) => void;
}) {
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [annotations, setAnnotations] = useState<LakeAnnotation[]>([]);
  const [annosVisible, toggleAnnosVisible] = useAnnotationsVisible();
  const [openAnno, setOpenAnno] = useState<LakeAnnotation | null>(null);
  const [tab, setTab] = useState<SetupTab>('active');

  // Catch markers (existing behavior).
  const initialMarkers = useMemo<MarkerCatch[]>(() => catches
    .filter(c => c.latitude != null && c.longitude != null)
    .map(c => ({
      id: c.id, lat: c.latitude!, lng: c.longitude!,
      lbs: c.lbs, oz: c.oz, species: c.species, date: c.date, has_photo: c.has_photo,
      cover_url: catchCoverUrl(c),
      angler: profilesById[c.angler_id] || null,
      color: colorFor(c.angler_id),
    })), [catches, profilesById]);

  const [markers, setMarkers] = useState<MarkerCatch[]>(initialMarkers);
  useEffect(() => { setMarkers(initialMarkers); }, [initialMarkers]);

  // Center: prefer the trip's linked lake; fall back to marker centroid; else trip.location geocode; else UK midlands.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (trip.lake_id) {
        const lake = await db.getLake(trip.lake_id);
        if (lake?.latitude != null && lake?.longitude != null) {
          if (!cancelled) setCenter({ lat: lake.latitude, lng: lake.longitude });
          return;
        }
      }
      if (initialMarkers.length > 0) {
        const lat = initialMarkers.reduce((s, m) => s + m.lat, 0) / initialMarkers.length;
        const lng = initialMarkers.reduce((s, m) => s + m.lng, 0) / initialMarkers.length;
        if (!cancelled) setCenter({ lat, lng });
        return;
      }
      if (trip.location) {
        const g = await geocodeLake(trip.location);
        if (!cancelled) setCenter(g || { lat: 52.05, lng: -0.7 });
        return;
      }
      if (!cancelled) setCenter({ lat: 52.05, lng: -0.7 });
    })();
    return () => { cancelled = true; };
  /* eslint-disable-next-line */
  }, [trip.id, trip.lake_id]);

  // Lazy geocode catches that have a lake but no coords (cap at ~6).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const need = catches.filter(c => (c.latitude == null || c.longitude == null) && c.lake?.trim()).slice(0, 6);
      if (need.length === 0) return;
      const found: MarkerCatch[] = [];
      for (const c of need) {
        const g = await geocodeLake(c.lake!);
        if (g) found.push({
          id: c.id, lat: g.lat, lng: g.lng,
          lbs: c.lbs, oz: c.oz, species: c.species, date: c.date, has_photo: c.has_photo,
          cover_url: catchCoverUrl(c),
          angler: profilesById[c.angler_id] || null, color: colorFor(c.angler_id),
        });
      }
      if (!cancelled && found.length > 0) {
        setMarkers(prev => [...prev, ...found.filter(f => !prev.find(p => p.id === f.id))]);
      }
    })();
    return () => { cancelled = true; };
  /* eslint-disable-next-line */
  }, [trip.id]);

  // Annotations live on the lake the trip is linked to. Refresh on mount.
  // No write path on this surface — authoring is on Lake Detail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trip.lake_id) { if (!cancelled) setAnnotations([]); return; }
      const list = await db.listLakeAnnotations(trip.lake_id);
      if (!cancelled) setAnnotations(list);
    })();
    return () => { cancelled = true; };
  }, [trip.lake_id]);

  // Setups — empty in PR1; the queries return [] / null until trip_swim_groups
  // gets populated by the PR2 Set up flow.
  const activeQuery = useActiveSetupForTrip(trip.id, me.id);
  const pastQuery = usePastSetupsForTrip(trip.id, me.id);
  const activeSetup = activeQuery.data || null;
  const pastSetups = pastQuery.data || [];

  // Lookup helper for catch markers → original Catch row.
  const lookupCatch = (id: string) => catches.find(c => c.id === id) || null;

  const mapAnnotations = annosVisible ? annotations : [];
  const canStartSetup = !!trip.lake_id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Map block */}
      {!center ? (
        <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
          <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <MapInner
            center={center}
            markers={markers}
            onOpenCatch={(id) => { const c = lookupCatch(id); if (c) onOpenCatch(c); }}
            photoUrl={(m) => m.cover_url}
            annotations={mapAnnotations}
            onOpenAnnotation={setOpenAnno}
          />

          {/* Annotation visibility toggle — only control on this surface.
              Annotation creation belongs on Lake Detail. */}
          <button
            onClick={toggleAnnosVisible}
            aria-label={annosVisible ? 'Hide annotations' : 'Show annotations'}
            aria-pressed={annosVisible}
            className="tap"
            style={{
              position: 'absolute', right: 12, bottom: 12, zIndex: 1000,
              width: 44, height: 44, borderRadius: 999,
              background: 'rgba(10,24,22,0.92)',
              border: `1px solid ${annosVisible ? 'rgba(234,201,136,0.45)' : 'rgba(234,201,136,0.18)'}`,
              color: annosVisible ? 'var(--gold-2)' : 'var(--text-3)',
              cursor: 'pointer', padding: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            }}
          >
            {annosVisible ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
      )}

      {/* Big Set up / Add a rod CTA. PR1: not yet wired to any flow — tapping
          shows a lightweight placeholder so testers can see where the flow
          will live. PR2 replaces the onClick with the real implementation. */}
      <SetupCta
        canStart={canStartSetup}
        hasActive={!!activeSetup}
        onClick={() => {
          alert(activeSetup
            ? 'Add a rod — coming in PR2.'
            : 'Set up — coming in PR2.');
        }}
      />

      {!trip.lake_id && (
        <div style={{
          padding: '12px 14px', borderRadius: 12,
          background: 'rgba(10,24,22,0.5)',
          border: '1px dashed rgba(234,201,136,0.18)',
          color: 'var(--text-3)', fontSize: 12, lineHeight: 1.45,
        }}>
          This trip isn't linked to a lake yet. Edit the trip to set its lake — that unlocks setups and annotations on this map.
        </div>
      )}

      {/* Setup tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        <SetupTabBtn active={tab === 'active'} onClick={() => setTab('active')}>
          Active setup
        </SetupTabBtn>
        <SetupTabBtn active={tab === 'past'} onClick={() => setTab('past')}>
          Past setups
        </SetupTabBtn>
      </div>

      {tab === 'active' && (
        <ActiveSetupEmpty />
      )}
      {tab === 'past' && (
        pastSetups.length === 0
          ? <PastSetupsEmpty />
          : <div /> /* PR2 renders the list here */
      )}

      {openAnno && (
        <AnnotationDetail anno={openAnno} author={profilesById[openAnno.angler_id]} onClose={() => setOpenAnno(null)} />
      )}
    </div>
  );
}

function SetupCta({ canStart, hasActive, onClick }: {
  canStart: boolean;
  hasActive: boolean;
  onClick: () => void;
}) {
  const label = hasActive ? 'Add a rod' : 'Set up';
  return (
    <button
      onClick={canStart ? onClick : undefined}
      disabled={!canStart}
      className="tap"
      style={{
        width: '100%', padding: '14px 16px', borderRadius: 14,
        background: canStart ? 'var(--gold)' : 'rgba(212,182,115,0.15)',
        color: canStart ? '#1A1004' : 'var(--text-3)',
        border: 'none', fontFamily: 'inherit',
        fontSize: 15, fontWeight: 700,
        cursor: canStart ? 'pointer' : 'not-allowed',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: canStart ? '0 8px 24px rgba(212,182,115,0.25)' : 'none',
      }}
    >
      {hasActive ? <Plus size={16} /> : <Ruler size={16} />}
      {label}
    </button>
  );
}

function SetupTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="tap" style={{
      flex: 1, padding: '10px 14px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
      background: active ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.45)',
      color: active ? 'var(--gold-2)' : 'var(--text-2)',
      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    }}>
      {children}
    </button>
  );
}

function ActiveSetupEmpty() {
  return (
    <div style={{
      padding: '28px 18px', borderRadius: 14, textAlign: 'center',
      background: 'rgba(10,24,22,0.5)',
      border: '1px dashed rgba(234,201,136,0.18)',
    }}>
      <Ruler size={22} style={{ color: 'var(--text-3)', opacity: 0.5, marginBottom: 8 }} />
      <div style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600, marginBottom: 4 }}>No active setup</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.45 }}>
        Tap <strong>Set up</strong> to place your swim, then add rods to track wraps and gear.
      </div>
    </div>
  );
}

function PastSetupsEmpty() {
  return (
    <div style={{
      padding: '28px 18px', borderRadius: 14, textAlign: 'center',
      background: 'rgba(10,24,22,0.5)',
      border: '1px dashed rgba(234,201,136,0.18)',
    }}>
      <MapPinned size={22} style={{ color: 'var(--text-3)', opacity: 0.5, marginBottom: 8 }} />
      <div style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600, marginBottom: 4 }}>No past setups</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.45 }}>
        Past setups will appear here once you've ended a session.
      </div>
    </div>
  );
}

function AnnotationDetail({ anno, author, onClose }: { anno: LakeAnnotation; author?: Profile; onClose: () => void }) {
  const t = ANN_TYPES.find(x => x.id === anno.type);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(3,10,9,0.7)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, touchAction: 'none',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card fade-in" style={{ padding: 18, maxWidth: 360, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>{t?.emoji}</span>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-2)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t?.label}</div>
        </div>
        <div className="display-font" style={{ fontSize: 20, fontWeight: 500, marginBottom: 6 }}>{anno.title}</div>
        {anno.description && <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.4, margin: '0 0 10px' }}>{anno.description}</p>}
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>by {author?.display_name || 'Unknown'}</div>
        <button onClick={onClose} className="btn btn-ghost" style={{ width: '100%', marginTop: 14, border: '1px solid rgba(234,201,136,0.18)' }}>Close</button>
      </div>
    </div>
  );
}
