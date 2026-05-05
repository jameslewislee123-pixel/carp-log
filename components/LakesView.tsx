'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { List as ListIcon, Loader2, Map as MapIcon, MapPinned } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import * as db from '@/lib/db';
import { useCatches, useLakes, useLakesEnriched, useUserLocationOnce, prefetchLake, type EnrichedLake } from '@/lib/queries';
import { QK } from '@/lib/queryKeys';
import { formatWeight, totalOz } from '@/lib/util';
import SwipeableRow from './SwipeableRow';

const LakesMapInner = dynamic(() => import('./LakesMapInner'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '60vh', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

type Filter = 'all' | 'fished' | 'saved';
type Sort = 'count' | 'biggest' | 'recent' | 'closest' | 'alpha';
type ViewMode = 'list' | 'map';

const VIEW_PREF_KEY = 'lakes_view_mode_v1';

function readViewPref(): ViewMode {
  if (typeof window === 'undefined') return 'list';
  try { return (localStorage.getItem(VIEW_PREF_KEY) as ViewMode) === 'map' ? 'map' : 'list'; } catch { return 'list'; }
}
function writeViewPref(v: ViewMode) {
  try { localStorage.setItem(VIEW_PREF_KEY, v); } catch {}
}

function relTime(d: Date | null): string {
  if (!d) return 'Never fished';
  const ms = Date.now() - d.getTime();
  const weeks = Math.floor(ms / (7 * 24 * 3600 * 1000));
  if (weeks < 1) return 'This week';
  if (weeks < 8) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(ms / (30 * 24 * 3600 * 1000));
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa = Math.sin(dLat / 2);
  const sb = Math.sin(dLng / 2);
  const h = sa * sa + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sb * sb;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function LakesView({ meId, onOpenLake }: { meId: string; onOpenLake: (name: string) => void }) {
  const qc = useQueryClient();
  const enriched = useLakesEnriched();
  const lakesQuery = useLakes();
  const catchesQuery = useCatches();
  const { coords: myCoords, ready: gpsReady } = useUserLocationOnce();

  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('count');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  // Decide what the swipe action should do for a given lake.
  //  - Owner of a manual lake with no other anglers' catches → hard delete
  //  - Anyone else (saved seed/OSM lakes, lakes with foreign catches) → unsave
  // Lake rows that are name-only (no lakes.id row) can't be swiped — there's
  // nothing to delete or unsave.
  async function handleLakeAction(lake: EnrichedLake) {
    if (!lake.id) return;
    const isOwner = !!lake.createdBy && lake.createdBy === meId;
    setOpenRowId(null);
    try {
      if (isOwner) {
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
      qc.invalidateQueries({ queryKey: QK.lakes.all });
      qc.invalidateQueries({ queryKey: QK.lakes.mySaved });
      qc.invalidateQueries({ queryKey: QK.catches.all });
    } catch (e: any) {
      alert(e?.message || 'Action failed');
    }
  }

  useEffect(() => { setViewMode(readViewPref()); }, []);

  // Filter
  const filtered = useMemo(() => {
    if (filter === 'all') return enriched;
    if (filter === 'fished') return enriched.filter(l => l.catchCount > 0);
    return enriched.filter(l => l.catchCount === 0);
  }, [enriched, filter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case 'count':
        arr.sort((a, b) => b.catchCount - a.catchCount);
        break;
      case 'biggest':
        arr.sort((a, b) => (b.pbCatch ? totalOz(b.pbCatch.lbs, b.pbCatch.oz) : 0) - (a.pbCatch ? totalOz(a.pbCatch.lbs, a.pbCatch.oz) : 0));
        break;
      case 'recent':
        arr.sort((a, b) => (b.lastFishedAt?.getTime() || 0) - (a.lastFishedAt?.getTime() || 0));
        break;
      case 'closest': {
        if (!myCoords) {
          arr.sort((a, b) => b.catchCount - a.catchCount); // graceful fallback
        } else {
          arr.sort((a, b) => {
            const da = a.latitude != null && a.longitude != null
              ? haversineKm(myCoords, { lat: a.latitude, lng: a.longitude })
              : Number.POSITIVE_INFINITY;
            const dbb = b.latitude != null && b.longitude != null
              ? haversineKm(myCoords, { lat: b.latitude, lng: b.longitude })
              : Number.POSITIVE_INFINITY;
            return da - dbb;
          });
        }
        break;
      }
      case 'alpha':
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return arr;
  }, [filtered, sort, myCoords]);

  const isInitialLoad = !lakesQuery.isFetched && !catchesQuery.isFetched;

  if (isInitialLoad) {
    return (
      <div style={{ height: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
      </div>
    );
  }

  // Brand-new user empty state
  if (enriched.length === 0) {
    return (
      <div style={{ padding: '8px 20px 20px' }}>
        <div style={{ padding: '50px 20px 30px', textAlign: 'center' }}>
          <MapPinned size={48} style={{ color: 'var(--text-3)', opacity: 0.4, margin: '0 auto 14px' }} />
          <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '0 0 6px' }}>No lakes yet</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1.5, margin: '0 0 18px' }}>
            Tap the <strong>+</strong> button to add your first lake, log a catch, or plan a trip.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 20px 20px' }}>
      {/* FILTER CHIPS */}
      <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
        {([
          { id: 'all' as const,    label: 'All' },
          { id: 'fished' as const, label: 'Fished' },
          { id: 'saved' as const,  label: 'Saved' },
        ]).map(f => {
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} className="tap" style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 999,
              border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: active ? 'var(--gold)' : 'rgba(10,24,22,0.45)',
              color: active ? '#1A1004' : 'var(--text-2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>{f.label}</button>
          );
        })}
      </div>

      {/* SORT + VIEW TOGGLE */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="input"
          style={{ flex: 1, fontSize: 12, padding: '8px 10px', appearance: 'auto' }}
        >
          <option value="count">Most caught</option>
          <option value="biggest">Biggest fish</option>
          <option value="recent">Most recent visit</option>
          <option value="closest" disabled={!gpsReady || !myCoords}>
            Closest to me{gpsReady && !myCoords ? ' (GPS denied)' : ''}
          </option>
          <option value="alpha">Alphabetical</option>
        </select>

        <div style={{ display: 'inline-flex', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.18)', flexShrink: 0 }}>
          <button onClick={() => { setViewMode('list'); writeViewPref('list'); }} aria-label="List view" style={{
            padding: '8px 10px',
            background: viewMode === 'list' ? 'rgba(212,182,115,0.2)' : 'rgba(10,24,22,0.5)',
            color: viewMode === 'list' ? 'var(--gold-2)' : 'var(--text-3)',
            border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center',
          }}><ListIcon size={14} /></button>
          <button onClick={() => { setViewMode('map'); writeViewPref('map'); }} aria-label="Map view" style={{
            padding: '8px 10px',
            background: viewMode === 'map' ? 'rgba(212,182,115,0.2)' : 'rgba(10,24,22,0.5)',
            color: viewMode === 'map' ? 'var(--gold-2)' : 'var(--text-3)',
            border: 'none', cursor: 'pointer', borderLeft: '1px solid rgba(234,201,136,0.18)',
            display: 'inline-flex', alignItems: 'center',
          }}><MapIcon size={14} /></button>
        </div>
      </div>

      {/* MAP VIEW */}
      {viewMode === 'map' && (
        <LakesMapInner
          lakes={sorted}
          onOpen={(l) => onOpenLake(l.name)}
        />
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <>
          {sorted.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              {filter === 'saved'
                ? <>No saved venues. Use <strong>Find venues nearby</strong> to discover and save spots for future trips.</>
                : 'No lakes match this filter.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sorted.map(l => {
                const isOwner = !!l.createdBy && l.createdBy === meId;
                const actionLabel = isOwner ? 'Delete' : 'Remove';
                const actionColor = isOwner ? '#ff3b30' : '#ff9500';
                const rowOpen = openRowId === l.key;
                const card = (
                  <LakeCard
                    lake={l}
                    myCoords={myCoords}
                    onOpen={() => { if (rowOpen) { setOpenRowId(null); return; } onOpenLake(l.name); }}
                    onPrefetch={async () => {
                      if (l.id) prefetchLake(qc, l.id);
                      else { const row = await db.getLakeByName(l.name); if (row) prefetchLake(qc, row.id); }
                    }}
                  />
                );
                // Name-only entries (no lakes.id row) can't be deleted or unsaved.
                if (!l.id) return <div key={l.key}>{card}</div>;
                return (
                  <SwipeableRow
                    key={l.key}
                    isOpen={rowOpen}
                    onOpen={() => setOpenRowId(l.key)}
                    onClose={() => { if (rowOpen) setOpenRowId(null); }}
                    onAction={() => handleLakeAction(l)}
                    actionLabel={actionLabel}
                    actionColor={actionColor}
                  >
                    {card}
                  </SwipeableRow>
                );
              })}
            </div>
          )}
        </>
      )}

    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const W = 60, H = 18, gap = 2;
  const barW = (W - gap * (values.length - 1)) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {values.map((v, i) => {
        const h = (v / max) * H;
        return (
          <rect key={i}
            x={i * (barW + gap)}
            y={H - h}
            width={barW}
            height={h || 1}
            fill={v > 0 ? 'rgba(141,191,157,0.85)' : 'rgba(141,191,157,0.18)'}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function LakeCard({ lake, myCoords, onOpen, onPrefetch }: {
  lake: EnrichedLake;
  myCoords: { lat: number; lng: number } | null;
  onOpen: () => void;
  onPrefetch: () => void;
}) {
  const isSaved = lake.catchCount === 0;
  const distance = (myCoords && lake.latitude != null && lake.longitude != null)
    ? haversineKm(myCoords, { lat: lake.latitude, lng: lake.longitude })
    : null;
  return (
    <button onClick={onOpen} onTouchStart={onPrefetch} onMouseEnter={onPrefetch}
      className="card tap" style={{
        padding: 14,
        display: 'flex', flexDirection: 'column', gap: 8,
        background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--text)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <MapPinned size={18} style={{ color: isSaved ? 'var(--sage)' : 'var(--gold)', flexShrink: 0 }} />
        <h3 className="display-font" style={{ fontSize: 18, margin: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{lake.name}</h3>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {isSaved ? 'Never fished' : `Last visit: ${relTime(lake.lastFishedAt)}`}
        {distance != null && ` · ${distance.toFixed(1)}km`}
      </div>

      {lake.pbCatch && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          <span style={{ color: 'var(--gold-2)', fontWeight: 600 }}>PB here:</span>{' '}
          {formatWeight(lake.pbCatch.lbs, lake.pbCatch.oz)}{lake.pbCatch.species ? ` ${lake.pbCatch.species}` : ''}
        </div>
      )}

      {lake.topBait && (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          <span style={{ color: 'var(--gold-2)', fontWeight: 600 }}>Best bait:</span> {lake.topBait}
        </div>
      )}

      {lake.catchCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {lake.catchCount} catch{lake.catchCount === 1 ? '' : 'es'} · last 6mo
          </div>
          <Sparkline values={lake.monthlySparkline} />
        </div>
      )}
    </button>
  );
}
