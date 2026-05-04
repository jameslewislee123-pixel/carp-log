'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Info, Loader2, MapPin, MapPinned, Navigation, Plus, RefreshCw, Search } from 'lucide-react';
import * as db from '@/lib/db';
import { QK } from '@/lib/queryKeys';
import { getCurrentLocation } from '@/lib/weather';
import { useLakes } from '@/lib/queries';
import {
  RADIUS_OPTIONS, type Radius, COOLDOWN_MS,
  osmCacheKey, readOsmCache, writeOsmCache,
  fetchOverpassVenues, openDirections, type OSMVenue,
} from '@/lib/osm';
import type { Lake } from '@/lib/types';
import { VaulModalShell } from './CarpApp';

const DiscoverVenuesMap = dynamic(() => import('./DiscoverVenuesMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '40vh', minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

type Status = 'idle' | 'fetching' | 'success' | 'error' | 'empty';

// Shared lake-picker modal. Used by:
//   - LakesView FAB → onPicked closes the modal; the new lake appears
//     in the list via React Query invalidation.
//   - AddTripModal → onPicked sets the trip's lake_id.
// onPicked is optional; the modal still works as a "save and close" flow.
export default function AddLakeModal({ onClose, onPicked, stackLevel }: {
  onClose: () => void;
  onPicked?: (lake: Lake) => void;
  stackLevel?: number;
}) {
  const qc = useQueryClient();
  const lakesQuery = useLakes();
  const savedLakes = lakesQuery.data || [];

  const [query, setQuery] = useState('');
  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return savedLakes.slice(0, 30);
    return savedLakes.filter(l => l.name.toLowerCase().includes(q)).slice(0, 30);
  }, [savedLakes, query]);

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [radius, setRadius] = useState<Radius>(25);
  const [venues, setVenues] = useState<OSMVenue[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lastSearchAt, setLastSearchAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const lastSearchedKey = useRef<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (now - lastSearchAt));
  const canSearch = cooldownRemaining === 0;

  async function runSearch(pos: { lat: number; lng: number }, r: Radius, force = false) {
    const key = osmCacheKey(pos.lat, pos.lng, r);
    if (!force) {
      const cached = readOsmCache(key);
      if (cached) {
        setVenues(cached);
        setStatus(cached.length === 0 ? 'empty' : 'success');
        lastSearchedKey.current = key;
        return;
      }
    } else {
      try { localStorage.removeItem(key); } catch {}
    }
    setStatus('fetching');
    setErrorMsg(null);
    setLastSearchAt(Date.now());
    lastSearchedKey.current = key;
    try {
      const results = await fetchOverpassVenues(pos, r);
      writeOsmCache(key, results);
      setVenues(results);
      setStatus(results.length === 0 ? 'empty' : 'success');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function findNearby() {
    if (!canSearch) return;
    setErrorMsg(null);
    let pos = center;
    if (!pos) {
      setStatus('fetching');
      const loc = await getCurrentLocation();
      if (!loc) {
        setLocationDenied(true);
        setStatus('error');
        setErrorMsg('Location access denied. Enable in device settings to find lakes nearby.');
        return;
      }
      pos = loc;
      setCenter(pos);
    }
    await runSearch(pos, radius);
  }

  // Re-run when radius changes after the first successful fetch.
  useEffect(() => {
    if (!center || !venues) return;
    const key = osmCacheKey(center.lat, center.lng, radius);
    if (lastSearchedKey.current === key) return;
    runSearch(center, radius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  function pickSaved(l: Lake) {
    onPicked?.(l);
    onClose();
  }

  async function pickOSM(v: OSMVenue) {
    if (v.added) return;
    try {
      const created = await db.createLakeFromOSM({ name: v.name, latitude: v.lat, longitude: v.lng });
      qc.invalidateQueries({ queryKey: QK.lakes.all });
      setVenues(curr => curr ? curr.map(x => x.id === v.id ? { ...x, added: true } : x) : curr);
      onPicked?.(created);
      onClose();
    } catch (e: any) {
      alert(e?.message || 'Failed to add lake');
    }
  }

  async function saveManual() {
    const name = manualName.trim();
    if (!name) return;
    setSavingManual(true);
    try {
      const created = await db.createManualLake({ name, latitude: null, longitude: null });
      qc.invalidateQueries({ queryKey: QK.lakes.all });
      onPicked?.(created);
      onClose();
    } catch (e: any) {
      alert(e?.message || 'Failed to add lake');
    } finally { setSavingManual(false); }
  }

  return (
    <VaulModalShell title="Add a lake" onClose={onClose} stackLevel={stackLevel}>
      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input
          className="input"
          placeholder="Search saved lakes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="words"
          style={{ paddingLeft: 38, fontSize: 14 }}
        />
      </div>

      {/* Saved lakes list */}
      {filteredSaved.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 6 }}>Saved</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {filteredSaved.map(l => (
              <button key={l.id} onClick={() => pickSaved(l)} className="tap" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
                background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
                color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <MapPinned size={14} style={{ color: l.source === 'osm' ? 'var(--sage)' : 'var(--gold-2)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {filteredSaved.length === 0 && query.trim() && (
        <div style={{ padding: '14px 0 18px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
          No saved lakes match "{query}".
        </div>
      )}

      {/* Manual entry */}
      {!manualOpen ? (
        <button onClick={() => { setManualOpen(true); if (query.trim()) setManualName(query.trim()); }} className="tap" style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          background: 'transparent', border: '1px dashed rgba(234,201,136,0.3)',
          color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          marginBottom: 14,
        }}>
          <Plus size={14} /> Add a custom lake by name
        </button>
      ) : (
        <div className="card fade-in" style={{ padding: 14, marginBottom: 14 }}>
          <label className="label">Lake name</label>
          <input className="input" autoFocus value={manualName} maxLength={120}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="e.g. Étang du Moulin" style={{ marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setManualOpen(false); setManualName(''); }} className="btn btn-ghost"
              style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}>Cancel</button>
            <button onClick={saveManual} disabled={!manualName.trim() || savingManual} className="btn btn-primary" style={{ flex: 1 }}>
              {savingManual ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save
            </button>
          </div>
        </div>
      )}

      {/* Find Lakes Nearby */}
      <div style={{ borderTop: '1px solid rgba(234,201,136,0.12)', paddingTop: 16, marginTop: 4 }}>
        <div className="label" style={{ marginBottom: 8 }}>Discover nearby</div>

        {/* Radius chips + Find button */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {RADIUS_OPTIONS.map(r => (
            <button key={r} onClick={() => setRadius(r)} className="tap" style={{
              flex: 1, padding: '10px 8px', borderRadius: 12,
              border: `1px solid ${radius === r ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: radius === r ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
              color: radius === r ? 'var(--gold-2)' : 'var(--text-2)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{r}km</button>
          ))}
        </div>

        {(!venues || status === 'idle' || status === 'error') && (
          <button onClick={findNearby} disabled={!canSearch} className="tap" style={{
            width: '100%', padding: '12px 14px', borderRadius: 12, marginBottom: 10,
            background: canSearch ? 'var(--gold)' : 'rgba(212,182,115,0.15)',
            color: canSearch ? '#1A1004' : 'var(--text-3)',
            border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            cursor: canSearch ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Navigation size={14} />
            {canSearch ? 'Find lakes nearby' : `Try again in ${Math.ceil(cooldownRemaining / 1000)}s`}
          </button>
        )}

        {status === 'fetching' && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            <Loader2 size={16} className="spin" />
            <div style={{ marginTop: 8 }}>Searching OpenStreetMap…</div>
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div style={{
            fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5,
            padding: 10, borderRadius: 10,
            background: 'rgba(220,107,88,0.08)',
            border: '1px solid rgba(220,107,88,0.25)',
            wordBreak: 'break-word', marginBottom: 10,
          }}>
            {errorMsg}
          </div>
        )}

        {center && venues && (status === 'success' || status === 'empty') && (
          <>
            <DiscoverVenuesMap
              center={center}
              venues={venues}
              radiusKm={radius}
              focusId={focusId}
              onAdd={pickOSM}
              onDirections={openDirections}
            />

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="label" style={{ marginBottom: 0 }}>
                {venues.length} {venues.length === 1 ? 'venue' : 'venues'} found
              </div>
              <button onClick={() => center && runSearch(center, radius, true)} disabled={!canSearch} className="tap" aria-label="Refresh"
                style={{ padding: 6, borderRadius: 10, background: 'transparent', border: 'none', color: canSearch ? 'var(--text-2)' : 'var(--text-3)', cursor: canSearch ? 'pointer' : 'not-allowed' }}>
                <RefreshCw size={14} />
              </button>
            </div>

            {venues.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                No venues found within {radius}km. Try a wider radius.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {venues.map(v => (
                  <div key={v.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => setFocusId(v.id)} className="tap" style={{
                      flex: 1, minWidth: 0,
                      background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                      color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, textTransform: 'capitalize' }}>{v.type} · {v.distanceKm.toFixed(1)}km away</div>
                    </button>
                    <button onClick={() => pickOSM(v)} disabled={v.added} className="tap" aria-label={v.added ? 'Added' : 'Add'}
                      style={{
                        padding: '8px 12px', borderRadius: 999, flexShrink: 0,
                        background: v.added ? 'rgba(141,191,157,0.15)' : 'var(--gold)',
                        color: v.added ? 'var(--sage)' : '#1A1004',
                        border: v.added ? '1px solid rgba(141,191,157,0.4)' : 'none',
                        fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                        cursor: v.added ? 'default' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                      {v.added ? '✓ Added' : <><Plus size={12} /> Add</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* OSM attribution */}
      <div style={{ marginTop: 22, paddingTop: 12, borderTop: '1px solid rgba(234,201,136,0.10)', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <span>Venue data © OpenStreetMap contributors</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
          aria-label="OpenStreetMap copyright" style={{ color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center' }}>
          <Info size={12} />
        </a>
      </div>
    </VaulModalShell>
  );
}
