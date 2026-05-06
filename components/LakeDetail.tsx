'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Calendar, Check, ChevronRight, Fish, Loader2, MapPin, MapPinned, MoreHorizontal, Navigation, Pencil, Plus, Trash2, X } from 'lucide-react';
import * as db from '@/lib/db';
import { useTripsAtLake } from '@/lib/queries';
import type { Catch, Lake, LakeAnnotation, LakeAnnotationType, Profile, Trip } from '@/lib/types';
import { tripStatus } from '@/lib/types';
import { geocodeLake } from '@/lib/weather';
import { directionsUrl } from '@/lib/osm';
import { VaulModalShell } from './CarpApp';

const AddLakeMapPane = dynamic(() => import('./AddLakeMapPane'), { ssr: false });

const ANN_TYPES: { id: LakeAnnotationType; label: string; emoji: string }[] = [
  { id: 'hot_spot',        label: 'Hot spot',   emoji: '🔥' },
  { id: 'productive_spot', label: 'Productive', emoji: '⭐' },
  { id: 'snag',            label: 'Snag',       emoji: '⚠️' },
  { id: 'note',            label: 'Note',       emoji: '📍' },
];

const MapInner = dynamic(() => import('./LakeMapInner'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '52vh', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

export default function LakeDetail({ lake, lakeCatches, profilesById, me, onClose, onOpenCatch, onOpenTrip, stackLevel = 0 }: {
  lake: Lake;
  lakeCatches: Catch[];
  profilesById: Record<string, Profile>;
  me: Profile;
  onClose: () => void;
  onOpenCatch: (c: Catch) => void;
  // Optional in PR1 for back-compat with any caller that hasn't passed it
  // through yet; the surface is wired up at the LakeDetailLoader site.
  onOpenTrip?: (t: Trip) => void;
  stackLevel?: number;
}) {
  const [annos, setAnnos] = useState<LakeAnnotation[]>([]);
  const [filter, setFilter] = useState<'all' | LakeAnnotationType>('all');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    lake.latitude != null && lake.longitude != null ? { lat: lake.latitude, lng: lake.longitude } : null
  );
  // Drop flow: tap FAB → pick a type → dropMode true with that type primed
  // → tap map → NewAnnotationForm opens with the type preselected.
  const [pendingType, setPendingType] = useState<LakeAnnotationType | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ lat: number; lng: number } | null>(null);
  const [openAnno, setOpenAnno] = useState<LakeAnnotation | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  // Header overflow menu (⋯) → Edit name / Edit location / Delete.
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [showEditLocation, setShowEditLocation] = useState(false);

  const qc = useQueryClient();
  // The user owns this row iff lakes.created_by === me — true for manual
  // and Nominatim creates, false for seed/legacy. Owned → edits mutate the
  // canonical row; not owned → edits land on user_saved_lakes.custom_*.
  const userOwnsLake = !!lake.created_by && lake.created_by === me.id;

  async function refreshAnnos() {
    setAnnos(await db.listLakeAnnotations(lake.id));
  }
  useEffect(() => { refreshAnnos(); /* eslint-disable-next-line */ }, [lake.id]);

  // Resolve a center if the lake has none yet (geocode by name).
  useEffect(() => {
    if (center) return;
    let cancelled = false;
    (async () => {
      const fromCatches = lakeCatches.find(c => c.latitude != null && c.longitude != null);
      if (fromCatches) {
        if (!cancelled) setCenter({ lat: fromCatches.latitude!, lng: fromCatches.longitude! });
        return;
      }
      const g = await geocodeLake(lake.name);
      if (!cancelled) setCenter(g || { lat: 52.05, lng: -0.7 });
    })();
    return () => { cancelled = true; };
  }, [lake.id]); // eslint-disable-line

  const visibleAnnos = useMemo(() => {
    if (filter === 'all') return annos;
    return annos.filter(a => a.type === filter);
  }, [annos, filter]);
  // Lake Map is the authoring surface for annotations — they always render
  // here (regardless of any visibility preference set on the Trip Map). The
  // filter chips below the map still narrow the rendered set by type.
  const mapAnnotations = visibleAnnos;

  const tripsQuery = useTripsAtLake(lake.id);
  const trips = tripsQuery.data || [];

  function startDrop(t: LakeAnnotationType) {
    setPendingType(t);
    setFabOpen(false);
  }
  function cancelDrop() {
    setPendingType(null);
    setFabOpen(false);
  }

  // Wholesale invalidation of every lake-scoped query — the rename or
  // re-locate touches the canonical name + bookmark overrides + every
  // place we render this lake (Lakes tab, Stats lakes, Trip Map …).
  function invalidateLakeCaches() {
    qc.invalidateQueries({ queryKey: ['lakes'] });
  }

  // Save a renamed lake. Owned rows → mutate lakes.name AND clear any
  // stale custom_name on the bookmark (canonical now reflects). Non-owned
  // rows → store the new name as user_saved_lakes.custom_name only.
  async function saveLakeName(nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    try {
      if (userOwnsLake) {
        await db.updateLake(lake.id, { name: trimmed });
        // Clear an outdated custom_name override so the canonical reads through.
        try { await db.updateMySavedLakeOverrides(lake.id, { custom_name: null }); } catch {/* RLS may block when no bookmark exists; ignore */}
      } else {
        await db.updateMySavedLakeOverrides(lake.id, { custom_name: trimmed });
      }
      invalidateLakeCaches();
      setShowEditName(false);
    } catch (e: any) {
      alert(e?.message || 'Failed to rename lake');
    }
  }

  // Save a re-located lake. Same branching as saveLakeName.
  async function saveLakeLocation(coords: { lat: number; lng: number }) {
    try {
      if (userOwnsLake) {
        await db.updateLake(lake.id, { latitude: coords.lat, longitude: coords.lng });
        try { await db.updateMySavedLakeOverrides(lake.id, { custom_latitude: null, custom_longitude: null }); } catch {/* see saveLakeName */}
      } else {
        await db.updateMySavedLakeOverrides(lake.id, { custom_latitude: coords.lat, custom_longitude: coords.lng });
      }
      invalidateLakeCaches();
      setCenter(coords);
      setShowEditLocation(false);
    } catch (e: any) {
      alert(e?.message || 'Failed to update location');
    }
  }

  // Delete / unsave path mirrors LakesView's swipe action: for an owner
  // with no foreign catches, hard-delete the row; otherwise unsave-only.
  async function handleDelete() {
    setHeaderMenuOpen(false);
    try {
      if (userOwnsLake) {
        const otherCount = await db.countOtherAnglerCatchesAtLake(lake.id);
        if (otherCount > 0) {
          alert(`Other anglers have catches at "${lake.name}", so it can't be deleted. Removed from your saved lakes instead.`);
          await db.unsaveLakeForUser(lake.id);
        } else {
          if (!confirm(`Delete "${lake.name}"? Your catches stay but lose their lake link. This can't be undone.`)) return;
          await db.deleteLake(lake.id);
        }
      } else {
        if (!confirm(`Remove "${lake.name}" from your lakes?`)) return;
        await db.unsaveLakeForUser(lake.id);
      }
      invalidateLakeCaches();
      onClose();
    } catch (e: any) {
      alert(e?.message || 'Action failed');
    }
  }

  return (
    <>
      <VaulModalShell hideTitle onClose={onClose} stackLevel={stackLevel}>
        {lake.photo_url ? (
          <div style={{
            position: 'relative', width: '100%', height: 200, marginBottom: 14,
            borderRadius: 18, overflow: 'hidden',
            border: '1px solid rgba(234,201,136,0.18)',
            background: 'rgba(10,24,22,0.6)',
          }}>
            <img src={lake.photo_url} alt="" style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(5,14,13,0.0) 30%, rgba(5,14,13,0.85) 100%)',
            }} />
            {lake.photo_source === 'satellite' && (
              <span style={{
                position: 'absolute', top: 10, left: 10,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                padding: '3px 7px', borderRadius: 6,
                background: 'rgba(5,14,13,0.85)', color: 'rgba(234,201,136,0.85)',
                border: '1px solid rgba(234,201,136,0.25)',
              }}>Satellite</span>
            )}
            <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
              {center && (
                <a
                  href={directionsUrl(center.lat, center.lng, lake.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Get directions to ${lake.name}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 10,
                    background: 'rgba(5,14,13,0.85)',
                    border: '1px solid rgba(234,201,136,0.3)',
                    backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                    color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                    textDecoration: 'none', cursor: 'pointer',
                  }}
                >
                  <Navigation size={13} /> Directions
                </a>
              )}
              <HeaderMenu
                open={headerMenuOpen}
                onToggle={() => setHeaderMenuOpen(o => !o)}
                onClose={() => setHeaderMenuOpen(false)}
                onEditName={() => { setHeaderMenuOpen(false); setShowEditName(true); }}
                onEditLocation={() => { setHeaderMenuOpen(false); setShowEditLocation(true); }}
                onDelete={handleDelete}
                deleteLabel={userOwnsLake ? 'Delete' : 'Remove from saved'}
                onPhoto
              />
            </div>
            <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700, marginBottom: 4, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>Lake</div>
              <h2 className="display-font" style={{ fontSize: 26, margin: 0, fontWeight: 500, lineHeight: 1.1, color: 'var(--text)', textShadow: '0 2px 12px rgba(0,0,0,0.7)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MapPinned size={18} style={{ color: 'var(--gold)' }} />
                {lake.name}
              </h2>
              {(lake.region || lake.country) && (
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                  {[lake.region, lake.country].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700, marginBottom: 4 }}>Lake</div>
              <h2 className="display-font" style={{ fontSize: 28, margin: 0, fontWeight: 500, lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MapPinned size={20} style={{ color: 'var(--gold)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lake.name}</span>
              </h2>
            </div>
            <div style={{ flexShrink: 0, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
              {center && (
                <a
                  href={directionsUrl(center.lat, center.lng, lake.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Get directions to ${lake.name}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 10,
                    background: 'rgba(234,201,136,0.12)',
                    border: '1px solid rgba(234,201,136,0.3)',
                    color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                    textDecoration: 'none', cursor: 'pointer',
                  }}
                >
                  <Navigation size={13} /> Directions
                </a>
              )}
              <HeaderMenu
                open={headerMenuOpen}
                onToggle={() => setHeaderMenuOpen(o => !o)}
                onClose={() => setHeaderMenuOpen(false)}
                onEditName={() => { setHeaderMenuOpen(false); setShowEditName(true); }}
                onEditLocation={() => { setHeaderMenuOpen(false); setShowEditLocation(true); }}
                onDelete={handleDelete}
                deleteLabel={userOwnsLake ? 'Delete' : 'Remove from saved'}
              />
            </div>
          </div>
        )}

        {/* Map + floating controls. The wrapper is position:relative so the
            FAB and visibility toggle stack at bottom-right of the map. */}
        {center && (
          <div style={{ position: 'relative' }}>
            <MapInner
              center={center}
              catches={lakeCatches}
              annotations={mapAnnotations}
              profilesById={profilesById}
              dropMode={pendingType !== null}
              dropHint={pendingType ? `Tap to drop ${ANN_TYPES.find(t => t.id === pendingType)?.label.toLowerCase()}` : undefined}
              onDropPick={(lat, lng) => {
                if (!pendingType) return;
                setPendingDrop({ lat, lng });
              }}
              onOpenCatch={onOpenCatch}
              onOpenAnnotation={setOpenAnno}
              lakeName={lake.name}
            />

            {/* Annotation type filters — overlay top-left of the map so
                they stay reachable even as the page scrolls long. */}
            <div
              className="scrollbar-thin"
              style={{
                position: 'absolute', top: 12, left: 12, zIndex: 1000,
                display: 'flex', gap: 4, overflowX: 'auto',
                maxWidth: 'calc(100% - 80px)',
                padding: '6px 8px', borderRadius: 12,
                background: 'rgba(20,42,38,0.85)',
                backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(234,201,136,0.18)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
              }}
            >
              <OverlayChip active={filter === 'all'} onClick={() => setFilter('all')}>All</OverlayChip>
              {ANN_TYPES.map(t => (
                <OverlayChip key={t.id} active={filter === t.id} onClick={() => setFilter(t.id)}>
                  {t.emoji} {t.label}
                </OverlayChip>
              ))}
            </div>

            {/* FAB — adds an annotation. Always available on the lake's
                authoring surface; recce trips and brand-new venues need
                to be annotated before any catches exist there. */}
            <FabAddAnnotation
              open={fabOpen}
              onToggle={() => {
                if (pendingType) { cancelDrop(); return; }
                setFabOpen(o => !o);
              }}
              onPick={startDrop}
              cancelLabel={pendingType ? 'Cancel' : null}
            />
          </div>
        )}

        {/* Trips at this lake */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Trips at this lake
          </div>
          {tripsQuery.isLoading && trips.length === 0 ? (
            <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              <Loader2 size={14} className="spin" />
            </div>
          ) : trips.length === 0 ? (
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'rgba(10,24,22,0.5)',
              border: '1px dashed rgba(234,201,136,0.18)',
              color: 'var(--text-3)', fontSize: 12, lineHeight: 1.4,
            }}>
              No trips here yet — create a trip to start tracking.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trips.map(t => (
                <TripAtLakeCard
                  key={t.id}
                  trip={t}
                  myCatchCount={lakeCatches.filter(c => c.trip_id === t.id && c.angler_id === me.id && !c.lost).length}
                  onOpen={() => onOpenTrip?.(t)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Annotation list — filter chips moved onto the map overlay so
            they stay visible regardless of how long the trips list grows. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
          {visibleAnnos.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
              No annotations{filter !== 'all' ? ' of this type' : ''} yet.
            </p>
          ) : visibleAnnos.map(a => {
            const author = profilesById[a.angler_id];
            const isMine = a.angler_id === me.id;
            const t = ANN_TYPES.find(x => x.id === a.type);
            return (
              <div key={a.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ fontSize: 18 }}>{t?.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</div>
                  {a.description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.3 }}>{a.description}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    by {author?.display_name || 'Unknown'}
                  </div>
                </div>
                {isMine && (
                  <button onClick={async () => {
                    if (confirm('Delete this annotation?')) { await db.deleteLakeAnnotation(a.id); refreshAnnos(); }
                  }} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </VaulModalShell>

      {pendingDrop && pendingType && (
        <NewAnnotationForm
          lakeId={lake.id}
          lat={pendingDrop.lat}
          lng={pendingDrop.lng}
          initialType={pendingType}
          onClose={() => { setPendingDrop(null); setPendingType(null); }}
          onSaved={() => { setPendingDrop(null); setPendingType(null); refreshAnnos(); }}
        />
      )}
      {openAnno && (
        <AnnotationDetail anno={openAnno} author={profilesById[openAnno.angler_id]} onClose={() => setOpenAnno(null)} />
      )}
      {showEditName && (
        <EditNameModal
          initial={lake.name}
          onClose={() => setShowEditName(false)}
          onSubmit={saveLakeName}
        />
      )}
      {showEditLocation && (
        <EditLocationModal
          initial={center || (lake.latitude != null && lake.longitude != null ? { lat: lake.latitude, lng: lake.longitude } : { lat: 52.05, lng: -0.7 })}
          onClose={() => setShowEditLocation(false)}
          onSubmit={saveLakeLocation}
        />
      )}
    </>
  );
}

function FabAddAnnotation({ open, onToggle, onPick, cancelLabel }: {
  open: boolean;
  onToggle: () => void;
  onPick: (t: LakeAnnotationType) => void;
  cancelLabel: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tap outside the popover to dismiss it. Skip when the popover isn't open.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      // Toggle off via the same handler so the FAB icon flips correctly.
      onToggle();
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open, onToggle]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 1000 }}>
      {open && (
        <div className="fade-in" style={{
          position: 'absolute', right: 0, bottom: 56,
          minWidth: 180,
          background: 'rgba(10,24,22,0.96)',
          border: '1px solid rgba(234,201,136,0.25)',
          borderRadius: 14, padding: 6,
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {ANN_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className="tap"
              style={{
                background: 'transparent', border: 'none',
                padding: '10px 12px', borderRadius: 10,
                color: 'var(--text)', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                textAlign: 'left',
                display: 'inline-flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 16 }}>{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={onToggle}
        aria-label={cancelLabel || 'Add annotation'}
        className="tap"
        style={{
          width: 52, height: 52, borderRadius: 999,
          background: cancelLabel ? 'rgba(220,107,88,0.95)' : 'var(--gold)',
          border: 'none', color: cancelLabel ? '#fff' : '#1A1004',
          cursor: 'pointer', padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 18px rgba(0,0,0,0.55)',
        }}
      >
        {cancelLabel ? <X size={22} /> : <Plus size={22} />}
      </button>
    </div>
  );
}

function TripAtLakeCard({ trip, myCatchCount, onOpen }: {
  trip: Trip;
  myCatchCount: number;
  onOpen: () => void;
}) {
  const status = tripStatus(trip);
  const dateLabel = formatDateRange(trip.start_date, trip.end_date);
  return (
    <button
      onClick={onOpen}
      className="card tap"
      style={{
        padding: 14,
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--text)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: 4,
            background: status === 'active' ? 'rgba(141,191,157,0.18)' : status === 'upcoming' ? 'rgba(234,201,136,0.15)' : 'rgba(234,201,136,0.08)',
            color: status === 'active' ? '#9DCFAE' : status === 'upcoming' ? 'var(--gold-2)' : 'var(--text-3)',
          }}>{status}</span>
        </div>
        <div className="display-font" style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trip.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Calendar size={11} /> {dateLabel}
          </span>
          {myCatchCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Fish size={11} /> {myCatchCount}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
    </button>
  );
}

function formatDateRange(s: string, e: string): string {
  const sd = new Date(s);
  const ed = new Date(e);
  const sameDay = sd.toDateString() === ed.toDateString();
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (sameDay) return sd.toLocaleDateString(undefined, opts);
  return `${sd.toLocaleDateString(undefined, opts)} – ${ed.toLocaleDateString(undefined, opts)}`;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="tap" style={{
      flexShrink: 0, padding: '6px 12px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
      background: active ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
      color: active ? 'var(--gold-2)' : 'var(--text-2)',
      fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

// Compact pill used by the on-map annotation filter row. Smaller than
// FilterChip so several fit comfortably without horizontal scroll on a
// narrow viewport.
function OverlayChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="tap" style={{
      flexShrink: 0, padding: '4px 10px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.22)'}`,
      background: active ? 'var(--gold)' : 'transparent',
      color: active ? '#1A1004' : 'var(--text-2)',
      fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

// ⋯ overflow menu in the Lake Detail header. `onPhoto` switches to the
// frosted-dark-on-image styling so the button reads on top of the lake
// photo when one is available.
function HeaderMenu({
  open, onToggle, onClose, onEditName, onEditLocation, onDelete, deleteLabel, onPhoto = false,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEditName: () => void;
  onEditLocation: () => void;
  onDelete: () => void;
  deleteLabel: string;
  onPhoto?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Click-outside dismiss. Skip when not open so we don't keep listening.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open, onClose]);

  const buttonStyle: React.CSSProperties = onPhoto
    ? {
        background: 'rgba(5,14,13,0.85)',
        border: '1px solid rgba(234,201,136,0.3)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        color: 'var(--gold-2)',
      }
    : {
        background: 'rgba(234,201,136,0.12)',
        border: '1px solid rgba(234,201,136,0.3)',
        color: 'var(--gold-2)',
      };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        aria-label="Lake actions"
        aria-expanded={open}
        className="tap"
        style={{
          ...buttonStyle,
          width: 36, height: 36, borderRadius: 10,
          padding: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="fade-in" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 1000,
          minWidth: 180,
          background: 'rgba(10,24,22,0.96)',
          border: '1px solid rgba(234,201,136,0.25)',
          borderRadius: 12, padding: 4,
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <MenuItem icon={<Pencil size={13} />} onClick={onEditName}>Edit name</MenuItem>
          <MenuItem icon={<MapPin size={13} />} onClick={onEditLocation}>Edit location</MenuItem>
          <MenuItem icon={<Trash2 size={13} />} onClick={onDelete} destructive>{deleteLabel}</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, onClick, children, destructive = false }: {
  icon: React.ReactNode; onClick: () => void; children: React.ReactNode; destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="tap"
      style={{
        background: 'transparent', border: 'none',
        padding: '9px 12px', borderRadius: 8,
        color: destructive ? '#ff8276' : 'var(--text)',
        fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', textAlign: 'left',
        display: 'inline-flex', alignItems: 'center', gap: 10,
      }}
    >
      {icon} {children}
    </button>
  );
}

function EditNameModal({ initial, onClose, onSubmit }: {
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function commit() {
    if (!name.trim() || name.trim() === initial.trim()) { onClose(); return; }
    setBusy(true);
    try { await onSubmit(name); }
    finally { setBusy(false); }
  }
  return (
    <VaulModalShell title="Edit name" onClose={onClose} stackLevel={1}>
      <label className="label">Lake name</label>
      <input
        className="input"
        autoFocus
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        style={{ marginBottom: 14 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="btn btn-ghost"
          style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}>Cancel</button>
        <button onClick={commit} disabled={!name.trim() || busy} className="btn btn-primary" style={{ flex: 2 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Save
        </button>
      </div>
    </VaulModalShell>
  );
}

function EditLocationModal({ initial, onClose, onSubmit }: {
  initial: { lat: number; lng: number };
  onClose: () => void;
  onSubmit: (coords: { lat: number; lng: number }) => void | Promise<void>;
}) {
  const [crosshair, setCrosshair] = useState<{ lat: number; lng: number }>(initial);
  const [busy, setBusy] = useState(false);
  async function commit() {
    setBusy(true);
    try { await onSubmit(crosshair); }
    finally { setBusy(false); }
  }
  return (
    <VaulModalShell title="Edit location" onClose={onClose} stackLevel={1}>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.4 }}>
        Pan the map so the pin sits over the lake, then save.
      </p>
      <AddLakeMapPane
        initialCenter={initial}
        initialZoom={14}
        target={null}
        onCenterChange={setCrosshair}
      />
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, marginBottom: 14, textAlign: 'center' }}>
        {crosshair.lat.toFixed(5)}, {crosshair.lng.toFixed(5)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="btn btn-ghost"
          style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}>Cancel</button>
        <button onClick={commit} disabled={busy} className="btn btn-primary" style={{ flex: 2 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Save location
        </button>
      </div>
    </VaulModalShell>
  );
}

function NewAnnotationForm({ lakeId, lat, lng, initialType, onClose, onSaved }: {
  lakeId: string; lat: number; lng: number; initialType: LakeAnnotationType;
  onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<LakeAnnotationType>(initialType);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await db.createLakeAnnotation({ lake_id: lakeId, type, latitude: lat, longitude: lng, title: title.trim(), description: desc.trim() || null });
      onSaved();
    } catch (e: any) { alert(e?.message || 'Failed to save'); }
    finally { setBusy(false); }
  }
  // Renders inside the vaul portal (stackLevel=1) so it sits above the
  // Lake Detail drawer AND escapes the Leaflet container's stacking
  // context — without the portal, hand-rolled overlays at zIndex < 700
  // got tap-through to Leaflet's marker/popup panes (z 600/700).
  return (
    <VaulModalShell title="New annotation" onClose={onClose} stackLevel={1}>
      <label className="label">Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 12 }}>
          {ANN_TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)} className="tap" style={{
              padding: '10px 6px', borderRadius: 12,
              border: `1px solid ${type === t.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: type === t.id ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
              color: type === t.id ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>{t.emoji} {t.label}</button>
          ))}
        </div>

        <label className="label">Title</label>
        <input className="input" autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Margin shelf, big-fish bay" style={{ marginBottom: 12 }} />

        <label className="label">Description (optional)</label>
        <textarea className="input" rows={3} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="Anything useful for next time…" style={{ marginBottom: 12, resize: 'vertical', fontFamily: 'inherit' }} />

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>{lat.toFixed(5)}, {lng.toFixed(5)}</div>

      <button onClick={save} disabled={!title.trim() || busy} className="btn btn-primary" style={{ width: '100%', fontSize: 15, padding: 14 }}>
        {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Drop pin
      </button>
    </VaulModalShell>
  );
}

function AnnotationDetail({ anno, author, onClose }: { anno: LakeAnnotation; author?: Profile; onClose: () => void }) {
  const t = ANN_TYPES.find(x => x.id === anno.type);
  // zIndex 1500 sits above Leaflet's popup pane (z 700) and any in-app
  // overlay we render. Without this, taps on the Close button and the
  // backdrop fell through to map markers underneath.
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(3,10,9,0.7)',
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
