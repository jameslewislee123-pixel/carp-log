'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Navigation, Plus, RefreshCw, Info } from 'lucide-react';
import * as db from '@/lib/db';
import { QK } from '@/lib/queryKeys';
import { getCurrentLocation } from '@/lib/weather';
import { VaulModalShell } from './CarpApp';
import type { OSMVenue } from './DiscoverVenuesMap';

const DiscoverVenuesMap = dynamic(() => import('./DiscoverVenuesMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '50vh', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

type Status = 'idle' | 'fetching' | 'success' | 'error' | 'empty';

const RADIUS_OPTIONS = [25, 50, 100] as const;
type Radius = typeof RADIUS_OPTIONS[number];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
// Fired in parallel via Promise.any — first 2xx wins and the rest are
// aborted. Kumi (community mirror) is consistently fastest for our small
// queries; main and mail.ru are fallbacks with independent capacity so
// when one is busy another usually isn't.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

function cacheKey(lat: number, lng: number, radius: Radius) {
  return `osm_venues_${lat.toFixed(2)}_${lng.toFixed(2)}_${radius}`;
}

function readCache(key: string): OSMVenue[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.timestamp !== 'number') return null;
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.results)) return null;
    return parsed.results as OSMVenue[];
  } catch { return null; }
}

function writeCache(key: string, results: OSMVenue[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ results, timestamp: Date.now() }));
  } catch {}
}

// Haversine in km between two coords.
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildOverpassQuery(center: { lat: number; lng: number }, radiusKm: Radius): string {
  const r = radiusKm * 1000;
  const { lat, lng } = center;
  // Strictly fishing-tagged venues — leisure=fishing or sport=fishing, on
  // both nodes (point spots) and ways (polygon venues). Dropped the
  // natural=water-with-name clause: it returned every river/ditch/ornamental
  // pond and was the dominant cost in the query plan. `out center;` makes
  // ways emit a centroid we can pin.
  return `[out:json][timeout:15];
(
  node["leisure"="fishing"](around:${r},${lat},${lng});
  node["sport"="fishing"](around:${r},${lat},${lng});
  way["leisure"="fishing"](around:${r},${lat},${lng});
  way["sport"="fishing"](around:${r},${lat},${lng});
);
out center;`;
}

// Fire all mirrors in parallel and resolve with the first 2xx response.
// Promise.any throws AggregateError only when EVERY attempt rejects.
async function callOverpass(query: string, signal: AbortSignal): Promise<any> {
  const body = 'data=' + encodeURIComponent(query);
  const attempts = OVERPASS_ENDPOINTS.map((url) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch {}
        throw new Error(`${url}: ${res.status} ${res.statusText}${detail ? ` — ${detail.replace(/\s+/g, ' ').trim()}` : ''}`);
      }
      return res.json();
    }).catch((e) => {
      // Re-throw with the URL prefixed so AggregateError attribution is clear.
      if (e?.name === 'AbortError') throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.startsWith('http') ? msg : `${url}: ${msg}`);
    })
  );
  try {
    return await Promise.any(attempts);
  } catch (e: any) {
    if (e instanceof AggregateError) {
      const msgs = e.errors.map((er: any) => er instanceof Error ? er.message : String(er)).join('\n');
      throw new Error(`All Overpass mirrors failed:\n${msgs}`);
    }
    throw e;
  }
}

async function fetchOverpass(center: { lat: number; lng: number }, radiusKm: Radius): Promise<OSMVenue[]> {
  const query = buildOverpassQuery(center, radiusKm);
  const controller = new AbortController();
  let json: any;
  try {
    json = await callOverpass(query, controller.signal);
  } finally {
    // Cancel any in-flight requests to the slower mirrors as soon as one wins.
    controller.abort();
  }

  const elements: any[] = json?.elements || [];
  const seen = new Set<string>();
  const venues: OSMVenue[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const id = `${el.type}-${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = (el.tags?.name as string | undefined)?.trim()
      || `Unnamed venue (${lat.toFixed(3)},${lng.toFixed(3)})`;
    const type = el.tags?.leisure || el.tags?.sport || el.tags?.natural || 'venue';
    venues.push({
      id, name, lat, lng, type,
      distanceKm: distanceKm(center, { lat, lng }),
    });
  }
  venues.sort((a, b) => a.distanceKm - b.distanceKm);
  return venues;
}

function openDirections(v: OSMVenue) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const url = isIOS
    ? `https://maps.apple.com/?daddr=${v.lat},${v.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function DiscoverVenues({
  initialCenter, sourceLabel, onClose,
}: {
  initialCenter?: { lat: number; lng: number } | null;
  sourceLabel?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(initialCenter || null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [radius, setRadius] = useState<Radius>(25);
  const [venues, setVenues] = useState<OSMVenue[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lastSearchAt, setLastSearchAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  // 0..2 — escalates the "Searching…" message at 3s and 8s while a request is in-flight.
  const [loadingPhase, setLoadingPhase] = useState(0);
  const lastSearchedKey = useRef<string | null>(null);
  const phaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearPhaseTimers() {
    phaseTimersRef.current.forEach(clearTimeout);
    phaseTimersRef.current = [];
  }
  function startPhaseTimers() {
    clearPhaseTimers();
    setLoadingPhase(0);
    phaseTimersRef.current.push(setTimeout(() => setLoadingPhase(1), 3000));
    phaseTimersRef.current.push(setTimeout(() => setLoadingPhase(2), 8000));
  }
  useEffect(() => () => clearPhaseTimers(), []);

  // Tick "now" once a second so the cooldown countdown updates.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // GPS fallback when no initial center.
  useEffect(() => {
    if (center) return;
    let cancelled = false;
    getCurrentLocation().then(loc => {
      if (cancelled) return;
      if (loc) setCenter(loc);
      else setLocationDenied(true);
    });
    return () => { cancelled = true; };
  }, [center]);

  // Search effect: cache-first; falls through to Overpass only on miss.
  useEffect(() => {
    if (!center) return;
    const key = cacheKey(center.lat, center.lng, radius);
    // Avoid re-running on stale closure values
    if (lastSearchedKey.current === key && venues) return;
    const cached = readCache(key);
    if (cached) {
      setVenues(cached);
      setStatus(cached.length === 0 ? 'empty' : 'success');
      lastSearchedKey.current = key;
      return;
    }
    setStatus('fetching');
    setErrorMsg(null);
    lastSearchedKey.current = key;
    setLastSearchAt(Date.now());
    startPhaseTimers();
    let cancelled = false;
    fetchOverpass(center, radius)
      .then(results => {
        if (cancelled) return;
        clearPhaseTimers();
        writeCache(key, results);
        setVenues(results);
        setStatus(results.length === 0 ? 'empty' : 'success');
      })
      .catch(err => {
        if (cancelled) return;
        clearPhaseTimers();
        // eslint-disable-next-line no-console
        console.error('[discover] Overpass failed:', err);
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; clearPhaseTimers(); };
  }, [center, radius]); // eslint-disable-line react-hooks/exhaustive-deps

  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (now - lastSearchAt));
  const canSearch = cooldownRemaining === 0;

  function refresh() {
    if (!center || !canSearch) return;
    const key = cacheKey(center.lat, center.lng, radius);
    try { localStorage.removeItem(key); } catch {}
    lastSearchedKey.current = null;
    setVenues(null);
    setStatus('fetching');
    setErrorMsg(null);
    setLastSearchAt(Date.now());
    startPhaseTimers();
    fetchOverpass(center, radius)
      .then(results => { clearPhaseTimers(); writeCache(key, results); setVenues(results); setStatus(results.length === 0 ? 'empty' : 'success'); })
      .catch(err => {
        clearPhaseTimers();
        // eslint-disable-next-line no-console
        console.error('[discover] Overpass failed:', err);
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
  }

  async function addVenue(v: OSMVenue) {
    if (v.added) return;
    try {
      await db.createLakeFromOSM({ name: v.name, latitude: v.lat, longitude: v.lng });
      // Mutate the venue in-place so map + list both reflect added state.
      setVenues(curr => curr ? curr.map(x => x.id === v.id ? { ...x, added: true } : x) : curr);
      qc.invalidateQueries({ queryKey: QK.lakes.all });
    } catch (e: any) {
      alert(e?.message || 'Failed to add venue');
    }
  }

  return (
    <VaulModalShell title="Find Venues" onClose={onClose}>
      {/* Source row */}
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Navigation size={13} style={{ color: 'var(--gold-2)' }} />
        <span>{sourceLabel || 'Searching near you'}</span>
      </div>

      {/* Radius chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {RADIUS_OPTIONS.map(r => (
          <button key={r} onClick={() => setRadius(r)} className="tap" style={{
            flex: 1, padding: '10px 8px', borderRadius: 12,
            border: `1px solid ${radius === r ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
            background: radius === r ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
            color: radius === r ? 'var(--gold-2)' : 'var(--text-2)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{r}km</button>
        ))}
        <button onClick={refresh} disabled={!canSearch || !center} className="tap" aria-label="Refresh search" style={{
          padding: '10px 12px', borderRadius: 12,
          border: '1px solid rgba(234,201,136,0.18)',
          background: 'rgba(10,24,22,0.5)',
          color: canSearch ? 'var(--text-2)' : 'var(--text-3)',
          cursor: canSearch ? 'pointer' : 'not-allowed',
          opacity: canSearch ? 1 : 0.6,
          display: 'flex', alignItems: 'center',
        }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {!canSearch && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
          Try again in {Math.ceil(cooldownRemaining / 1000)}s
        </div>
      )}

      {/* States */}
      {!center && !locationDenied && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          <Loader2 size={18} className="spin" /> Getting your location…
        </div>
      )}

      {locationDenied && !center && (
        <div className="card" style={{ padding: 18, textAlign: 'center' }}>
          <MapPin size={28} style={{ color: 'var(--text-3)', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>Location access is needed</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>Enable location access in your device settings, or open this from a trip with a location set.</div>
        </div>
      )}

      {center && status === 'fetching' && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          <Loader2 size={18} className="spin" />
          <div style={{ marginTop: 10 }}>
            {loadingPhase === 0 && 'Searching OpenStreetMap…'}
            {loadingPhase === 1 && 'Searching OpenStreetMap… (this can take a few seconds)'}
            {loadingPhase === 2 && 'Still searching… trying alternative servers'}
          </div>
        </div>
      )}

      {center && status === 'error' && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600, marginBottom: 6 }}>Search failed</div>
          <div style={{
            fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5,
            padding: 10, borderRadius: 10,
            background: 'rgba(220,107,88,0.08)',
            border: '1px solid rgba(220,107,88,0.25)',
            wordBreak: 'break-word',
            fontFamily: 'ui-monospace, Menlo, monospace',
            marginBottom: 12,
          }}>
            {errorMsg || 'Unknown error'}
          </div>
          <button onClick={refresh} disabled={!canSearch} className="tap" style={{
            width: '100%', padding: '10px 14px', borderRadius: 12,
            background: canSearch ? 'var(--gold)' : 'rgba(212,182,115,0.15)',
            color: canSearch ? '#1A1004' : 'var(--text-3)',
            border: 'none',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            cursor: canSearch ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <RefreshCw size={14} />
            {canSearch ? 'Retry' : `Retry in ${Math.ceil(cooldownRemaining / 1000)}s`}
          </button>
        </div>
      )}

      {center && (status === 'success' || status === 'empty') && venues && (
        <>
          <DiscoverVenuesMap
            center={center}
            venues={venues}
            radiusKm={radius}
            focusId={focusId}
            onAdd={addVenue}
            onDirections={openDirections}
          />

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="label" style={{ marginBottom: 0 }}>{venues.length} {venues.length === 1 ? 'venue' : 'venues'} found</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Sorted by distance</div>
          </div>

          {venues.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
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
                  <button onClick={() => addVenue(v)} disabled={v.added} className="tap" aria-label={v.added ? 'Added' : 'Add venue'} style={{
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

      {/* OSM attribution — required by the OSM license. */}
      <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid rgba(234,201,136,0.10)', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <span>Venue data © OpenStreetMap contributors</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
          aria-label="OpenStreetMap copyright" style={{ color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center' }}>
          <Info size={12} />
        </a>
      </div>
    </VaulModalShell>
  );
}
