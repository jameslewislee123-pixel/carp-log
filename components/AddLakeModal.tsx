'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Info, Loader2, MapPinned, Navigation, Search, X } from 'lucide-react';
import * as db from '@/lib/db';
import { QK } from '@/lib/queryKeys';
import { useLakes } from '@/lib/queries';
import { searchLakesGlobal, type GlobalLakeResult } from '@/lib/nominatim';
import { getCurrentLocation } from '@/lib/weather';
import type { Lake } from '@/lib/types';
import { VaulModalShell } from './CarpApp';

// Combined map + search lake picker. The map pane sits in the modal body
// with a fixed center crosshair; the user either:
//   (a) types a query → picks a result → confirms / pans to fine-tune
//        coords → save (Nominatim creates a new row, saved/seed lakes
//        already exist and just get bookmarked)
//   (b) pans the map manually → taps "Use this location" → name modal
//        → save (manual lake at crosshair coords)
//
// The map is dynamic-imported (ssr: false) so leaflet doesn't load on the
// server. AddLakeModal itself stays server-renderable — the heavy bits
// only ship to the client.
const AddLakeMapPane = dynamic(() => import('./AddLakeMapPane'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

// UK overview — lat/lng + zoom shown when the modal first opens. The
// crosshair sits over Britain so users in the UK see context immediately
// and users elsewhere can tap "locate me" to jump to themselves.
const FALLBACK_CENTER = { lat: 54.5, lng: -3.0 };
const INITIAL_ZOOM = 6;
// Zoom level used when search results auto-zoom (~5km area for context).
const SEARCH_ZOOM = 12;
// Zoom level used when the user picks a specific result (~1km area).
const PICK_ZOOM = 14;

type Picked =
  | { kind: 'saved'; lake: Lake }
  | { kind: 'seed'; lake: Lake }
  | { kind: 'global'; result: GlobalLakeResult };

function pickedName(p: Picked): string {
  return p.kind === 'global' ? p.result.name : p.lake.name;
}

// Used by:
//   - LakesView FAB → onPicked closes the modal; the new lake appears
//     in the list via React Query invalidation.
//   - AddTripModal → onPicked sets the trip's lake_id.
export default function AddLakeModal({ onClose, onPicked, stackLevel }: {
  onClose: () => void;
  onPicked?: (lake: Lake) => void;
  stackLevel?: number;
}) {
  const qc = useQueryClient();
  const lakesQuery = useLakes();
  const savedLakes = lakesQuery.data || [];

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  // The coords currently under the map's center crosshair. AddLakeMapPane
  // reports them on moveend; we use them for manual placement and for the
  // pan-adjust-after-pick path on Nominatim results.
  const [crosshair, setCrosshair] = useState<{ lat: number; lng: number }>(FALLBACK_CENTER);
  // Drives the map's flyTo. Setting a new object animates the map; the
  // initial position is the FALLBACK_CENTER baked into AddLakeMapPane.
  const [mapTarget, setMapTarget] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Saved-lakes filter — case-insensitive substring on the user's existing
  // saved set. No network call.
  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return savedLakes.filter(l => l.name.toLowerCase().includes(q)).slice(0, 8);
  }, [savedLakes, query]);

  // UK + France seed-table search (300ms debounce, 3+ chars).
  const [seedResults, setSeedResults] = useState<Lake[]>([]);
  const [seedSearching, setSeedSearching] = useState(false);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) { setSeedResults([]); setSeedSearching(false); return; }
    let cancelled = false;
    setSeedSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await db.searchSeedLakes(trimmed);
        if (!cancelled) setSeedResults(r);
      } finally {
        if (!cancelled) setSeedSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Worldwide Nominatim search (500ms debounce, 3+ chars).
  const [globalResults, setGlobalResults] = useState<GlobalLakeResult[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) { setGlobalResults([]); setGlobalSearching(false); setSearchedQuery(''); return; }
    let cancelled = false;
    setGlobalSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchLakesGlobal(trimmed);
        if (cancelled) return;
        setGlobalResults(r); setSearchedQuery(trimmed);
      } catch {
        if (cancelled) return;
        setGlobalResults([]); setSearchedQuery(trimmed);
      } finally {
        if (!cancelled) setGlobalSearching(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Suppress seed rows the user already has saved so we don't list a lake
  // twice (once as "Saved" and once as "UK & France fisheries").
  const savedIds = useMemo(() => new Set(savedLakes.map(l => l.id)), [savedLakes]);
  const seedToShow = useMemo(() => seedResults.filter(l => !savedIds.has(l.id)), [seedResults, savedIds]);

  // First-result auto-zoom: when search yields fresh results AND the user
  // hasn't picked anything, fly the map toward the top result so the
  // crosshair lands somewhere meaningful. Tracked via a ref so we only
  // zoom ONCE per query string — not every time React renders.
  const lastZoomedQueryRef = useRef('');
  useEffect(() => {
    if (picked) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) return;
    if (lastZoomedQueryRef.current === trimmed) return;
    let target: { lat: number; lng: number; zoom: number } | null = null;
    const firstSaved = filteredSaved.find(l => l.latitude != null && l.longitude != null);
    if (firstSaved) target = { lat: firstSaved.latitude!, lng: firstSaved.longitude!, zoom: SEARCH_ZOOM };
    else {
      const firstSeed = seedToShow.find(l => l.latitude != null && l.longitude != null);
      if (firstSeed) target = { lat: firstSeed.latitude!, lng: firstSeed.longitude!, zoom: SEARCH_ZOOM };
      else if (globalResults[0]) target = { lat: globalResults[0].lat, lng: globalResults[0].lon, zoom: SEARCH_ZOOM };
    }
    if (target) {
      lastZoomedQueryRef.current = trimmed;
      setMapTarget(target);
    }
  }, [filteredSaved, seedToShow, globalResults, picked, query]);

  async function locateMe() {
    setLocateBusy(true);
    setLocateError(null);
    try {
      const loc = await getCurrentLocation();
      if (!loc) {
        setLocateError("Couldn't access location");
        // Auto-clear after a few seconds so the toast doesn't linger.
        setTimeout(() => setLocateError(curr => curr === "Couldn't access location" ? null : curr), 3000);
        return;
      }
      setMapTarget({ lat: loc.lat, lng: loc.lng, zoom: 14 });
    } finally {
      setLocateBusy(false);
    }
  }

  function pickSaved(l: Lake) {
    setPicked({ kind: 'saved', lake: l });
    setQuery('');
    if (l.latitude != null && l.longitude != null) {
      setMapTarget({ lat: l.latitude, lng: l.longitude, zoom: PICK_ZOOM });
    }
  }
  function pickSeed(l: Lake) {
    setPicked({ kind: 'seed', lake: l });
    setQuery('');
    if (l.latitude != null && l.longitude != null) {
      setMapTarget({ lat: l.latitude, lng: l.longitude, zoom: PICK_ZOOM });
    }
  }
  function pickGlobal(g: GlobalLakeResult) {
    setPicked({ kind: 'global', result: g });
    setQuery('');
    setMapTarget({ lat: g.lat, lng: g.lon, zoom: PICK_ZOOM });
  }
  function clearPick() {
    setPicked(null);
  }

  async function bookmarkAndFinish(lake: Lake) {
    try { await db.saveLakeForUser(lake.id); }
    catch (e) { console.error('[saveLake] bookmark failed', e); }
    qc.invalidateQueries({ queryKey: ['lakes'] });
    onPicked?.(lake);
    onClose();
  }

  async function confirmCta() {
    if (busy) return;
    if (!picked) {
      // Manual placement — the name modal is the next step. The actual
      // create+bookmark happens in saveManual once the user confirms.
      setShowManualForm(true);
      return;
    }
    setBusy(true);
    try {
      if (picked.kind === 'saved' || picked.kind === 'seed') {
        // Already a DB row — bookmarking is enough. Pan-adjusted coords
        // are intentionally ignored here: the user picked an existing
        // lake, so its canonical coords are the source of truth. Pan
        // only matters for new manual / Nominatim creates.
        await bookmarkAndFinish(picked.lake);
      } else {
        // Nominatim — create the row with the crosshair-current coords so
        // the user's pan adjustment is honored.
        const created = await db.createLakeFromGlobal({
          osm_id: picked.result.osm_id,
          osm_type: picked.result.osm_type,
          name: picked.result.name,
          latitude: crosshair.lat,
          longitude: crosshair.lng,
          country: picked.result.country || null,
          region: picked.result.region,
          importance: picked.result.importance,
          photo_url: picked.result.photo_url,
          photo_source: picked.result.photo_source,
        });
        await bookmarkAndFinish(created);
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to save lake');
    } finally {
      setBusy(false);
    }
  }

  const hasResults = filteredSaved.length > 0 || seedToShow.length > 0 || globalResults.length > 0;
  const showResultsDropdown = !picked && query.trim().length >= 3 && (hasResults || globalSearching || seedSearching);

  return (
    <VaulModalShell title="Find a lake" onClose={onClose} stackLevel={stackLevel}>
      {/* Search input + locate-me */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            className="input"
            placeholder="Search lakes worldwide…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="words"
            style={{ paddingLeft: 38, paddingRight: 36, fontSize: 14 }}
          />
          {(globalSearching || seedSearching) && (
            <Loader2 size={14} className="spin" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          )}
        </div>
        <button
          onClick={locateMe}
          disabled={locateBusy}
          aria-label="Locate me"
          className="tap"
          style={{
            flexShrink: 0,
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.18)',
            color: 'var(--gold-2)', cursor: locateBusy ? 'wait' : 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {locateBusy ? <Loader2 size={16} className="spin" /> : <Navigation size={16} />}
        </button>
      </div>

      {/* Picked badge or live results dropdown */}
      {picked ? (
        <div style={{
          marginBottom: 10, padding: '10px 12px', borderRadius: 12,
          background: 'rgba(212,182,115,0.12)',
          border: '1px solid rgba(234,201,136,0.35)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <MapPinned size={14} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pickedName(picked)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {picked.kind === 'saved' ? 'Saved' : picked.kind === 'seed' ? 'Fishery' : 'Worldwide'} · pan to adjust
            </div>
          </div>
          <button
            onClick={clearPick}
            aria-label="Clear selection"
            className="tap"
            style={{
              flexShrink: 0,
              width: 28, height: 28, borderRadius: 999,
              background: 'transparent', border: '1px solid rgba(234,201,136,0.18)',
              color: 'var(--text-3)', cursor: 'pointer', padding: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={12} />
          </button>
        </div>
      ) : showResultsDropdown ? (
        <div style={{
          marginBottom: 10,
          maxHeight: 200, overflowY: 'auto',
          borderRadius: 12, border: '1px solid rgba(234,201,136,0.18)',
          background: 'rgba(10,24,22,0.6)',
        }}>
          {filteredSaved.length > 0 && (
            <ResultGroup label="Your saved lakes">
              {filteredSaved.map(l => (
                <ResultRow key={l.id} title={l.name} subtitle={[l.region, l.country].filter(Boolean).join(', ') || 'Saved'} onClick={() => pickSaved(l)} />
              ))}
            </ResultGroup>
          )}
          {seedToShow.length > 0 && (
            <ResultGroup label="UK & France fisheries">
              {seedToShow.map(l => (
                <ResultRow key={l.id} title={l.name} subtitle={[l.region, l.country].filter(Boolean).join(', ') || 'Fishery'} onClick={() => pickSeed(l)} />
              ))}
            </ResultGroup>
          )}
          {globalResults.length > 0 && (
            <ResultGroup label="Worldwide">
              {globalResults.map(g => (
                <ResultRow key={`${g.osm_type}-${g.osm_id}`} title={g.name} subtitle={[g.region, g.country].filter(Boolean).join(', ') || 'OpenStreetMap'} onClick={() => pickGlobal(g)} />
              ))}
            </ResultGroup>
          )}
          {!hasResults && !globalSearching && !seedSearching && searchedQuery && (
            <div style={{ padding: '14px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              No matches. Pan the map and use this location instead.
            </div>
          )}
          {!hasResults && (globalSearching || seedSearching) && (
            <div style={{ padding: '14px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              <Loader2 size={12} className="spin" /> Searching…
            </div>
          )}
        </div>
      ) : null}

      {/* Map pane */}
      <AddLakeMapPane
        initialCenter={FALLBACK_CENTER}
        initialZoom={INITIAL_ZOOM}
        target={mapTarget}
        onCenterChange={setCrosshair}
      />

      {/* Bottom CTA */}
      <button
        onClick={confirmCta}
        disabled={busy}
        className="btn btn-primary"
        style={{
          marginTop: 14, width: '100%', fontSize: 15, padding: 14,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {busy ? <Loader2 size={16} className="spin" />
          : picked ? <Check size={16} />
          : <MapPinned size={16} />}
        {picked
          ? `Add ${pickedName(picked)}`
          : `Use this location · ${crosshair.lat.toFixed(4)}, ${crosshair.lng.toFixed(4)}`}
      </button>

      {/* OSM attribution */}
      <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid rgba(234,201,136,0.10)', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <span>Search data © OpenStreetMap contributors</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
          aria-label="OpenStreetMap copyright" style={{ color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center' }}>
          <Info size={12} />
        </a>
      </div>

      {/* Manual-name vaul drawer (stack level 2 — sits above this modal). */}
      {showManualForm && (
        <NewManualLakeForm
          lat={crosshair.lat}
          lng={crosshair.lng}
          onClose={() => setShowManualForm(false)}
          onSaved={(lake) => {
            setShowManualForm(false);
            qc.invalidateQueries({ queryKey: ['lakes'] });
            onPicked?.(lake);
            onClose();
          }}
        />
      )}

      {/* Locate-me toast — fixed-position, dismisses itself after 3s. */}
      {locateError && (
        <div style={{
          position: 'fixed', top: 'max(20px, env(safe-area-inset-top))', left: '50%',
          transform: 'translateX(-50%)', zIndex: 1600,
          padding: '10px 16px', borderRadius: 999,
          background: 'rgba(220,107,88,0.95)', color: '#fff',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        }}>
          {locateError}
        </div>
      )}
    </VaulModalShell>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        padding: '8px 12px 4px',
        fontSize: 10, fontWeight: 700,
        color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ResultRow({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="tap"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 12px',
        background: 'transparent', border: 'none',
        color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      <MapPinned size={13} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}

// Vaul drawer for naming a manual lake. Renders inside the same Drawer.Portal
// pattern via VaulModalShell so taps don't fall through to the map behind.
function NewManualLakeForm({ lat, lng, onClose, onSaved }: {
  lat: number;
  lng: number;
  onClose: () => void;
  onSaved: (lake: Lake) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const lake = await db.createManualLake({ name: name.trim(), latitude: lat, longitude: lng });
      // Bookmark for the user so it lands in their "saved" set immediately.
      try { await db.saveLakeForUser(lake.id); } catch {/* idempotent — fall through */}
      onSaved(lake);
    } catch (e: any) {
      alert(e?.message || 'Failed to add lake');
    } finally {
      setBusy(false);
    }
  }
  return (
    <VaulModalShell title="Name this location" onClose={onClose} stackLevel={2}>
      <label className="label">Lake name</label>
      <input
        className="input"
        autoFocus
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Étang du Moulin, Pond at the back"
        style={{ marginBottom: 12 }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="btn btn-ghost"
          style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}>Cancel</button>
        <button onClick={save} disabled={!name.trim() || busy} className="btn btn-primary" style={{ flex: 2 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Add
        </button>
      </div>
    </VaulModalShell>
  );
}
