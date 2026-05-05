'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Bookmark, BookmarkCheck, Check, Fish, Loader2, MapPinned, Navigation, Plus, Ruler, Trash2, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as db from '@/lib/db';
import { useMySavedLakeIds, useRodSpotsAtLake } from '@/lib/queries';
import { QK } from '@/lib/queryKeys';
import type { Catch, Lake, LakeAnnotation, LakeAnnotationType, Profile, RodSpot } from '@/lib/types';
import { formatWeight, totalOz } from '@/lib/util';
import { geocodeLake } from '@/lib/weather';
import { directionsUrl } from '@/lib/osm';
import { calculateWraps } from '@/lib/wraps';
import { VaulModalShell } from './CarpApp';
import type { RodSpotDraft } from './RodSpotForm';

// Leaflet-using helpers live in their own files behind dynamic imports
// (matching how LakeMapInner is loaded) — keeps `import 'leaflet'` and
// 'react-leaflet' off the SSR module graph for this page.
const RodSpotMarkers = dynamic(() => import('./RodSpotMarkers'), { ssr: false });
const RodSpotForm = dynamic(() => import('./RodSpotForm'), { ssr: false });

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

export default function LakeDetail({ lake, lakeCatches, profilesById, me, onClose, onOpenCatch, stackLevel = 0 }: {
  lake: Lake;
  lakeCatches: Catch[];
  profilesById: Record<string, Profile>;
  me: Profile;
  onClose: () => void;
  onOpenCatch: (c: Catch) => void;
  stackLevel?: number;
}) {
  const [annos, setAnnos] = useState<LakeAnnotation[]>([]);
  const [filter, setFilter] = useState<'all' | LakeAnnotationType>('all');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    lake.latitude != null && lake.longitude != null ? { lat: lake.latitude, lng: lake.longitude } : null
  );
  const [dropMode, setDropMode] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ lat: number; lng: number } | null>(null);
  const [openAnno, setOpenAnno] = useState<LakeAnnotation | null>(null);

  // Rod-spot placement state machine.
  // 'idle'        — no placement in progress
  // 'await_swim'  — next map tap places the swim point
  // 'await_spot'  — swim is placed; next map tap places the spot, then opens form
  type RodPlaceMode = 'idle' | 'await_swim' | 'await_spot';
  const [rodMode, setRodMode] = useState<RodPlaceMode>('idle');
  const [pendingSwim, setPendingSwim] = useState<{ lat: number; lng: number } | null>(null);
  // When chaining additional rods to an already-saved swim, we carry the
  // existing group_id and swim_label forward so the new sibling rod joins
  // that swim group cleanly without forcing the user to re-type the label.
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [pendingSwimLabel, setPendingSwimLabel] = useState<string | null>(null);
  const [rodFormDraft, setRodFormDraft] = useState<RodSpotDraft | null>(null);
  const [editingSpot, setEditingSpot] = useState<RodSpot | null>(null);
  // The most recently saved swim — surfaces the inline "+ Add another rod
  // from this swim" prompt below the map.
  const [lastSavedSwim, setLastSavedSwim] = useState<{
    lat: number; lng: number; group_id: string; swim_label: string | null;
  } | null>(null);

  const rodSpotsQuery = useRodSpotsAtLake(lake.id);
  const rodSpots = rodSpotsQuery.data || [];

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

  const stats = useMemo(() => {
    const landed = lakeCatches.filter(c => !c.lost);
    const biggest = landed.reduce<Catch | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    const totalOzAll = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
    const distinctAnglers = new Set(landed.map(c => c.angler_id)).size;
    return { count: landed.length, biggest, totalOzAll, distinctAnglers };
  }, [lakeCatches]);

  const visibleAnnos = filter === 'all' ? annos : annos.filter(a => a.type === filter);
  const myCatchesHere = lakeCatches.filter(c => c.angler_id === me.id).length;
  const canAnnotate = myCatchesHere > 0;

  // Saved/Fishing status. Optimistic save/unsave via TanStack mutations.
  const qc = useQueryClient();
  const savedIdsQuery = useMySavedLakeIds();
  const isSaved = (savedIdsQuery.data || []).includes(lake.id);
  const saveMut = useMutation({
    mutationFn: () => db.saveLakeForUser(lake.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: QK.lakes.mySaved });
      const prev = qc.getQueryData<string[]>(QK.lakes.mySaved);
      qc.setQueryData<string[]>(QK.lakes.mySaved, (old) => (old || []).includes(lake.id) ? (old || []) : [...(old || []), lake.id]);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(QK.lakes.mySaved, ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: QK.lakes.mySaved }); qc.invalidateQueries({ queryKey: QK.lakes.all }); },
  });
  const unsaveMut = useMutation({
    mutationFn: () => db.unsaveLakeForUser(lake.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: QK.lakes.mySaved });
      const prev = qc.getQueryData<string[]>(QK.lakes.mySaved);
      qc.setQueryData<string[]>(QK.lakes.mySaved, (old) => (old || []).filter(id => id !== lake.id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(QK.lakes.mySaved, ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: QK.lakes.mySaved }); qc.invalidateQueries({ queryKey: QK.lakes.all }); },
  });
  function handleUnsave() {
    if (!confirm(`Remove "${lake.name}" from your saved lakes?`)) return;
    unsaveMut.mutate();
  }

  const statusPill = myCatchesHere > 0 ? (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: 'rgba(141,191,157,0.14)', color: 'var(--sage)',
      border: '1px solid rgba(141,191,157,0.4)',
    }}>
      <Fish size={12} /> Fishing here
    </span>
  ) : isSaved ? (
    <button onClick={handleUnsave} disabled={unsaveMut.isPending} className="tap" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
      background: 'rgba(212,182,115,0.14)', color: 'var(--gold-2)',
      border: '1px solid var(--gold)', cursor: 'pointer',
    }}>
      <BookmarkCheck size={12} /> Saved
    </button>
  ) : (
    <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="tap" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
      background: 'transparent', color: 'var(--gold-2)',
      border: '1px dashed rgba(234,201,136,0.4)', cursor: 'pointer',
    }}>
      <Bookmark size={12} /> Save
    </button>
  );

  return (
    <>
      <VaulModalShell hideTitle onClose={onClose} stackLevel={stackLevel}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          {statusPill}
        </div>

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
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700, marginBottom: 4 }}>Lake</div>
            <h2 className="display-font" style={{ fontSize: 28, margin: 0, fontWeight: 500, lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <MapPinned size={20} style={{ color: 'var(--gold)' }} />
              {lake.name}
            </h2>
          </div>
        )}

        {center && (
          <a
            href={directionsUrl(center.lat, center.lng, lake.name)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Get directions to ${lake.name}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', marginBottom: 14,
              background: 'rgba(234,201,136,0.12)',
              border: '1px solid rgba(234,201,136,0.3)',
              borderRadius: 12,
              color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              textDecoration: 'none', cursor: 'pointer',
            }}
          >
            <Navigation size={14} /> Directions
          </a>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          <Stat label="Fish" value={stats.count} />
          <Stat label="Biggest" value={stats.biggest ? formatWeight(stats.biggest.lbs, stats.biggest.oz) : '—'} />
          <Stat label="Anglers" value={stats.distinctAnglers} />
        </div>

        {center && (
          <MapInner
            center={center}
            catches={lakeCatches}
            annotations={annos}
            profilesById={profilesById}
            dropMode={dropMode || rodMode !== 'idle'}
            dropHint={
              rodMode === 'await_swim' ? 'Tap your swim location' :
              rodMode === 'await_spot' ? 'Tap your rod spot' :
              undefined
            }
            onDropPick={(lat, lng) => {
              if (rodMode === 'await_swim') {
                setPendingSwim({ lat, lng });
                setRodMode('await_spot');
              } else if (rodMode === 'await_spot' && pendingSwim) {
                setRodFormDraft({
                  swim_latitude: pendingSwim.lat,
                  swim_longitude: pendingSwim.lng,
                  spot_latitude: lat,
                  spot_longitude: lng,
                });
                setRodMode('idle');
              } else {
                setPendingDrop({ lat, lng });
                setDropMode(false);
              }
            }}
            onOpenCatch={onOpenCatch}
            onOpenAnnotation={setOpenAnno}
            lakeName={lake.name}
          >
            <RodSpotMarkers
              spots={rodSpots}
              onOpen={setEditingSpot}
              swimPreview={rodMode === 'await_spot' ? pendingSwim : null}
            />
          </MapInner>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {canAnnotate ? (
            <button
              onClick={() => {
                if (rodMode !== 'idle') { setRodMode('idle'); setPendingSwim(null); }
                setDropMode(d => !d);
              }}
              className="tap" style={{
                padding: '10px 14px', borderRadius: 999,
                border: `1px solid ${dropMode ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                background: dropMode ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
                color: dropMode ? 'var(--gold-2)' : 'var(--text-2)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
              <Plus size={12} /> {dropMode ? 'Tap map to place…' : 'Add annotation'}
            </button>
          ) : (
            <div style={{
              padding: '10px 14px', borderRadius: 12, background: 'rgba(10,24,22,0.5)',
              border: '1px dashed rgba(234,201,136,0.18)', color: 'var(--text-3)',
              fontSize: 12, lineHeight: 1.4,
            }}>
              You haven't fished here yet. Annotations are visible to anglers who have.
            </div>
          )}

          <button
            onClick={() => {
              if (rodMode !== 'idle') {
                setRodMode('idle');
                setPendingSwim(null);
                setPendingGroupId(null);
                setPendingSwimLabel(null);
              } else {
                // Starting a fresh swim+spot pair: clear any "last swim"
                // chaining context so the prompt doesn't reappear after
                // the user moves to a new location.
                setDropMode(false);
                setRodMode('await_swim');
                setLastSavedSwim(null);
                setPendingGroupId(null);
                setPendingSwimLabel(null);
              }
            }}
            className="tap" style={{
              padding: '10px 14px', borderRadius: 999,
              border: `1px solid ${rodMode !== 'idle' ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: rodMode !== 'idle' ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
              color: rodMode !== 'idle' ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            <Ruler size={12} /> {
              rodMode === 'await_swim' ? 'Cancel placement' :
              rodMode === 'await_spot' ? 'Cancel placement' :
              'Add a spot'
            }
          </button>
        </div>

        {/* Chain prompt — shown after a successful save while the user is
            idle, so adding a 2nd/3rd/4th rod from the same swim is a
            single tap. */}
        {rodMode === 'idle' && lastSavedSwim && (
          <div style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px dashed rgba(234,201,136,0.35)',
            background: 'rgba(212,182,115,0.06)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <Ruler size={14} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: 'var(--text-2)', flex: 1, minWidth: 0 }}>
              Saved{lastSavedSwim.swim_label ? ` at ${lastSavedSwim.swim_label}` : ''}.
              Tap to place another rod from this swim.
            </div>
            <button
              onClick={() => {
                setDropMode(false);
                setPendingSwim({ lat: lastSavedSwim.lat, lng: lastSavedSwim.lng });
                setPendingGroupId(lastSavedSwim.group_id);
                setPendingSwimLabel(lastSavedSwim.swim_label);
                setRodMode('await_spot');
              }}
              className="tap"
              style={{
                padding: '8px 12px', borderRadius: 999,
                background: 'var(--gold)', border: 'none',
                color: '#1A1004', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              }}
            >
              <Plus size={12} /> Add another rod
            </button>
            <button
              onClick={() => setLastSavedSwim(null)}
              aria-label="Dismiss"
              style={{
                background: 'transparent', border: 'none', color: 'var(--text-3)',
                cursor: 'pointer', padding: 4, flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* My spots list — only when there are saved spots. Grouped by
            swim_group_id so multi-rod swims show under one header. Tapping
            any rod opens the same edit/delete sheet as the map markers. */}
        {rodSpots.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              My spots
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(() => {
                const groups = new Map<string, RodSpot[]>();
                for (const s of rodSpots) {
                  const arr = groups.get(s.swim_group_id);
                  if (arr) arr.push(s);
                  else groups.set(s.swim_group_id, [s]);
                }
                return Array.from(groups.entries()).map(([groupId, members]) => {
                  const swimLabel = members.find(m => m.swim_label)?.swim_label || null;
                  // Group header only earns its row when there's more than
                  // one rod or a swim label worth showing — otherwise the
                  // single rod card stands alone like the v1 layout.
                  const showHeader = members.length > 1 || !!swimLabel;
                  return (
                    <div key={groupId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {showHeader && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 11, color: 'var(--text-3)',
                          textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700,
                        }}>
                          <span style={{ fontSize: 12 }}>⛺</span>
                          <span>{swimLabel || 'Swim'}</span>
                          {members.length > 1 && (
                            <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>· {members.length} rods</span>
                          )}
                        </div>
                      )}
                      {members.map(s => {
                        const wraps = s.wraps_actual ?? s.wraps_calculated ?? calculateWraps(
                          s.swim_latitude, s.swim_longitude, s.spot_latitude, s.spot_longitude,
                        );
                        const title = s.spot_label || (showHeader ? `Rod ${members.indexOf(s) + 1}` : (s.swim_label || 'Untitled spot'));
                        return (
                          <button
                            key={s.id}
                            onClick={() => setEditingSpot(s)}
                            className="card tap"
                            style={{
                              padding: 12, textAlign: 'left', cursor: 'pointer',
                              fontFamily: 'inherit', color: 'var(--text)',
                              display: 'flex', alignItems: 'center', gap: 12,
                            }}
                          >
                            <Ruler size={16} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {title}
                              </div>
                              {!showHeader && s.swim_label && s.spot_label && (
                                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                                  from {s.swim_label}
                                </div>
                              )}
                              {s.features && (
                                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.features}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div className="num-display" style={{ fontSize: 18, color: 'var(--gold-2)', lineHeight: 1 }}>{wraps}</div>
                              <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginTop: 2 }}>wraps</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* filter chips */}
        <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 14, paddingBottom: 4 }}>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
          {ANN_TYPES.map(t => (
            <FilterChip key={t.id} active={filter === t.id} onClick={() => setFilter(t.id)}>
              {t.emoji} {t.label}
            </FilterChip>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
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

      {pendingDrop && (
        <NewAnnotationForm lakeId={lake.id} lat={pendingDrop.lat} lng={pendingDrop.lng}
          onClose={() => setPendingDrop(null)}
          onSaved={() => { setPendingDrop(null); refreshAnnos(); }}
        />
      )}
      {openAnno && (
        <AnnotationDetail anno={openAnno} author={profilesById[openAnno.angler_id]} onClose={() => setOpenAnno(null)} />
      )}
      {/* Rod-spot create form (after two-step placement) */}
      {rodFormDraft && (
        <RodSpotForm
          lakeId={lake.id}
          draft={rodFormDraft}
          groupId={pendingGroupId}
          initialSwimLabel={pendingSwimLabel}
          onClose={() => {
            setRodFormDraft(null);
            setPendingSwim(null);
            setPendingGroupId(null);
            setPendingSwimLabel(null);
          }}
          onSaved={(saved) => {
            setRodFormDraft(null);
            setPendingSwim(null);
            setPendingGroupId(null);
            setPendingSwimLabel(null);
            setLastSavedSwim({
              lat: saved.swim_latitude,
              lng: saved.swim_longitude,
              group_id: saved.swim_group_id,
              swim_label: saved.swim_label,
            });
            qc.invalidateQueries({ queryKey: QK.lakes.rodSpots(lake.id) });
          }}
        />
      )}
      {/* Rod-spot edit/delete form (tap an existing spot) */}
      {editingSpot && (
        <RodSpotForm
          lakeId={lake.id}
          existing={editingSpot}
          draft={{
            swim_latitude: editingSpot.swim_latitude,
            swim_longitude: editingSpot.swim_longitude,
            spot_latitude: editingSpot.spot_latitude,
            spot_longitude: editingSpot.spot_longitude,
          }}
          onClose={() => setEditingSpot(null)}
          onSaved={(saved) => {
            // If the user just deleted, clear any chain prompt anchored
            // on this group — the saved row reference may now be stale.
            if (lastSavedSwim?.group_id === saved.swim_group_id) {
              setLastSavedSwim(null);
            }
            setEditingSpot(null);
            qc.invalidateQueries({ queryKey: QK.lakes.rodSpots(lake.id) });
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', borderRadius: 14, padding: 12, textAlign: 'center' }}>
      <div className="num-display" style={{ fontSize: 20, color: 'var(--gold-2)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
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

function NewAnnotationForm({ lakeId, lat, lng, onClose, onSaved }: {
  lakeId: string; lat: number; lng: number; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<LakeAnnotationType>('productive_spot');
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
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(3,10,9,0.7)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', touchAction: 'none',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="slide-up" style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(10,24,22,0.95)',
        backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '24px 24px 0 0', border: '1px solid rgba(234,201,136,0.18)', borderBottom: 'none',
        padding: '20px 20px max(30px, env(safe-area-inset-bottom))',
        touchAction: 'pan-y',
      }}>
        <div className="sheet-handle" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 14 }}>
          <h3 className="display-font" style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>New annotation</h3>
          <button onClick={onClose} style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 10, width: 32, height: 32, color: 'var(--text-2)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

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
