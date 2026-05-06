'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, MapPinned, Plus, Search } from 'lucide-react';
import * as db from '@/lib/db';
import { QK } from '@/lib/queryKeys';
import { useLakes } from '@/lib/queries';
import { searchLakesGlobal, type GlobalLakeResult } from '@/lib/nominatim';
import type { Lake } from '@/lib/types';
import { VaulModalShell } from './CarpApp';

// Lake search modal — single-purpose. Manual lake creation and "Discover
// nearby" (Overpass) were both removed in the lake/trip redesign: setups
// are now a Trip-level concern, so all the user needs from this modal is
// to find a lake they have in mind and bookmark it.
//
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
  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return savedLakes.slice(0, 30);
    return savedLakes.filter(l => l.name.toLowerCase().includes(q)).slice(0, 30);
  }, [savedLakes, query]);

  // Seed-table search (UK + France fisheries imports) — server-side ILIKE,
  // debounced 300ms. Faster than the worldwide Nominatim trip and we own
  // the data so we don't have to respect rate limits.
  const [seedResults, setSeedResults] = useState<Lake[]>([]);
  const [seedSearching, setSeedSearching] = useState(false);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSeedResults([]);
      setSeedSearching(false);
      return;
    }
    let cancelled = false;
    setSeedSearching(true);
    const t = setTimeout(async () => {
      try {
        const results = await db.searchSeedLakes(trimmed);
        if (!cancelled) setSeedResults(results);
      } finally {
        if (!cancelled) setSeedSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Global Nominatim search — debounced 500ms, 3+ chars, single in-flight at a time.
  const [globalResults, setGlobalResults] = useState<GlobalLakeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setGlobalResults([]);
      setSearching(false);
      setSearchedQuery('');
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchLakesGlobal(trimmed);
        if (cancelled) return;
        setGlobalResults(results);
        setSearchedQuery(trimmed);
      } catch {
        if (cancelled) return;
        setGlobalResults([]);
        setSearchedQuery(trimmed);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Seed lakes the user already has in their saved set (catches/trips/created)
  // are surfaced via the "Your saved lakes" section, so suppress them here to
  // avoid showing the same lake twice.
  const savedIds = useMemo(() => new Set(savedLakes.map((l) => l.id)), [savedLakes]);
  const seedToShow = useMemo(() => seedResults.filter((l) => !savedIds.has(l.id)), [seedResults, savedIds]);

  // Bookmark + finish. Idempotent — calling on a lake the user already
  // has saved is a no-op. Failure to bookmark isn't fatal: the lake row
  // exists, the user can re-tap from saved/seed search to retry.
  async function bookmarkAndFinish(lake: Lake) {
    try { await db.saveLakeForUser(lake.id); }
    catch (e) { console.error('[saveLake] bookmark failed', e); }
    qc.invalidateQueries({ queryKey: QK.lakes.mySaved });
    qc.invalidateQueries({ queryKey: QK.lakes.all });
    onPicked?.(lake);
    onClose();
  }

  async function pickSaved(l: Lake) {
    await bookmarkAndFinish(l);
  }

  async function pickGlobal(g: GlobalLakeResult) {
    try {
      const created = await db.createLakeFromGlobal({
        osm_id: g.osm_id,
        osm_type: g.osm_type,
        name: g.name,
        latitude: g.lat,
        longitude: g.lon,
        country: g.country || null,
        region: g.region,
        importance: g.importance,
        photo_url: g.photo_url,
        photo_source: g.photo_source,
      });
      await bookmarkAndFinish(created);
    } catch (e: any) {
      alert(e?.message || 'Failed to add lake');
    }
  }

  return (
    <VaulModalShell title="Find a lake" onClose={onClose} stackLevel={stackLevel}>
      {/* Search input — global. Spinner shows while debounced fetch is in flight. */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input
          className="input"
          placeholder="Search lakes worldwide…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="words"
          style={{ paddingLeft: 38, paddingRight: 36, fontSize: 14 }}
        />
        {searching && (
          <Loader2 size={14} className="spin" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.4 }}>
        Type 3+ characters to search OpenStreetMap. Wikipedia photos when available, satellite tile otherwise.
      </div>

      {/* Saved matches — only when query is non-empty and matches saved lakes */}
      {query.trim() && filteredSaved.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 0 }}>Your saved lakes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {filteredSaved.map(l => (
              <button key={l.id} onClick={() => pickSaved(l)} className="tap" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
                background: 'rgba(212,182,115,0.10)', border: '1px solid rgba(234,201,136,0.3)',
                color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <MapPinned size={14} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saved</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* UK & France fisheries (seed dataset) */}
      {query.trim().length >= 3 && (seedSearching || seedToShow.length > 0) && (
        <>
          <div className="label">UK & France fisheries</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {seedSearching && seedToShow.length === 0 && (
              <div style={{ padding: '8px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                <Loader2 size={12} className="spin" /> Searching imports…
              </div>
            )}
            {seedToShow.map((l) => (
              <button key={l.id} onClick={() => pickSaved(l)} className="tap" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
                background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
                color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <MapPinned size={14} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                  {(l.region || l.country) && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[l.region, l.country].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Worldwide cards */}
      {query.trim().length >= 3 && (
        <>
          <div className="label">Worldwide</div>
          {searching && globalResults.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {[0, 1, 2].map(i => (
                <div key={i} className="card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.5 }}>
                  <div style={{ width: 80, height: 80, borderRadius: 10, background: 'rgba(10,24,22,0.6)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 14, width: '60%', background: 'rgba(10,24,22,0.6)', borderRadius: 4, marginBottom: 6 }} />
                    <div style={{ height: 11, width: '40%', background: 'rgba(10,24,22,0.6)', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!searching && globalResults.length === 0 && searchedQuery && (
            <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12, marginBottom: 6 }}>
              No matches worldwide. Try a different spelling or fewer words.
            </div>
          )}
          {globalResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {globalResults.map(g => (
                <GlobalResultCard key={`${g.osm_type}-${g.osm_id}`} result={g} onAdd={() => pickGlobal(g)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* OSM attribution */}
      <div style={{ marginTop: 22, paddingTop: 12, borderTop: '1px solid rgba(234,201,136,0.10)', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <span>Search data © OpenStreetMap contributors</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
          aria-label="OpenStreetMap copyright" style={{ color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center' }}>
          <Info size={12} />
        </a>
      </div>
    </VaulModalShell>
  );
}

function GlobalResultCard({ result, onAdd }: { result: GlobalLakeResult; onAdd: () => void }) {
  const [imgErr, setImgErr] = useState(false);
  const subtitle = [result.region, result.country].filter(Boolean).join(', ');
  return (
    <div className="card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        position: 'relative', width: 80, height: 80, borderRadius: 10, overflow: 'hidden',
        flexShrink: 0, background: 'rgba(10,24,22,0.7)',
      }}>
        {!imgErr && result.photo_url && (
          <img src={result.photo_url} alt="" onError={() => setImgErr(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
        {imgErr && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MapPinned size={20} style={{ color: 'var(--text-3)' }} />
          </div>
        )}
        {result.photo_source === 'satellite' && !imgErr && (
          <span style={{
            position: 'absolute', top: 4, left: 4,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            padding: '2px 5px', borderRadius: 4,
            background: 'rgba(5,14,13,0.85)', color: 'rgba(234,201,136,0.85)',
          }}>Sat</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.name}</div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
        )}
      </div>
      <button onClick={onAdd} className="tap" aria-label="Add"
        style={{
          padding: '8px 12px', borderRadius: 999, flexShrink: 0,
          background: 'var(--gold)', color: '#1A1004', border: 'none',
          fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
        <Plus size={12} /> Add
      </button>
    </div>
  );
}
