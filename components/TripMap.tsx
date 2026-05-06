'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, MapPinned, Pencil, Plus, Ruler, Trash2, X,
} from 'lucide-react';
import * as db from '@/lib/db';
import {
  useActiveSetupForTrip, usePastSetupsForTrip, useRodSpotsAtLake,
} from '@/lib/queries';
import { QK } from '@/lib/queryKeys';
import { useAnnotationsVisible } from '@/lib/annotationsVisible';
import type {
  Catch, LakeAnnotation, LakeAnnotationType, Profile, RodSpot, Trip, TripSwimGroup,
} from '@/lib/types';
import { catchCoverUrl } from '@/lib/db';
import { geocodeLake } from '@/lib/weather';
import { bottomTypeMeta } from '@/lib/bottomTypes';
import { calculateWraps } from '@/lib/wraps';
import { VaulModalShell } from './CarpApp';
import SwipeableRow from './SwipeableRow';

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

// RodSpotForm reuse — when adding a rod under the active setup we feed it
// the active setup's swim coords as draft.swim_*, the active swim_group_id
// as groupId so createRodSpot drops the new row into the same group, and
// the active setup's swim_label as initialSwimLabel.
const RodSpotForm = dynamic(() => import('./RodSpotForm'), { ssr: false });

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
// Drop-mode state machine. The CTA is the only way to enter await_swim
// (start a setup) or await_rod (add a rod under the active setup); the map
// banner reflects the current value.
type DropMode = 'idle' | 'await_swim' | 'await_rod';

// Trip Map tab — primary surface for swim/rod management. Renders catch
// markers (existing), lake annotations (read-only — authoring is on Lake
// Detail), and the active setup's swim + rod overlay. Setups are stored on
// trip_swim_groups; their rods are rod_spots joined by swim_group_id.
//
// Annotation creation is intentionally NOT available here — the eye toggle
// only controls visibility.
export default function TripMap({ trip, me, catches, profilesById, onOpenCatch }: {
  trip: Trip;
  me: Profile;
  catches: Catch[];
  profilesById: Record<string, Profile>;
  onOpenCatch: (c: Catch) => void;
}) {
  const qc = useQueryClient();
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [annotations, setAnnotations] = useState<LakeAnnotation[]>([]);
  const [annosVisible, toggleAnnosVisible] = useAnnotationsVisible();
  const [openAnno, setOpenAnno] = useState<LakeAnnotation | null>(null);
  const [tab, setTab] = useState<SetupTab>('active');

  // Setup placement state
  const [dropMode, setDropMode] = useState<DropMode>('idle');
  const [pendingSwimDrop, setPendingSwimDrop] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingRodDrop, setPendingRodDrop] = useState<{ lat: number; lng: number } | null>(null);
  // Edit a saved rod (tap on the rod row in the active card or on its map pin)
  const [editingRod, setEditingRod] = useState<RodSpot | null>(null);

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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trip.lake_id) { if (!cancelled) setAnnotations([]); return; }
      const list = await db.listLakeAnnotations(trip.lake_id);
      if (!cancelled) setAnnotations(list);
    })();
    return () => { cancelled = true; };
  }, [trip.lake_id]);

  // Setups + their rods (the rods at lake, filtered by swim_group_id).
  const activeQuery = useActiveSetupForTrip(trip.id, me.id);
  const pastQuery = usePastSetupsForTrip(trip.id, me.id);
  const rodSpotsQuery = useRodSpotsAtLake(trip.lake_id);
  const activeSetup = activeQuery.data || null;
  const pastSetups = pastQuery.data || [];
  const allRodSpots = rodSpotsQuery.data || [];

  const activeRods = useMemo(
    () => activeSetup ? allRodSpots.filter(r => r.swim_group_id === activeSetup.swim_group_id) : [],
    [activeSetup, allRodSpots],
  );

  // Catches counter — uses catches.swim_group_id (set at AddCatch time)
  // rather than walking rod_spot_id, so a catch that's lost its rod link
  // still counts towards the setup it belonged to.
  const activeCatches = useMemo(
    () => activeSetup ? catches.filter(c => c.trip_id === trip.id && c.swim_group_id === activeSetup.swim_group_id && !c.lost) : [],
    [activeSetup, catches, trip.id],
  );

  // Lookup helper for catch markers → original Catch row.
  const lookupCatch = (id: string) => catches.find(c => c.id === id) || null;

  const mapAnnotations = annosVisible ? annotations : [];
  const canStartSetup = !!trip.lake_id;

  function invalidateSetupCaches() {
    qc.invalidateQueries({ queryKey: ['trip_swim_groups', trip.id] });
    if (trip.lake_id) qc.invalidateQueries({ queryKey: QK.lakes.rodSpots(trip.lake_id) });
  }

  async function handleStartSetup() {
    if (!trip.lake_id) return;
    // One-active-per-user rule. If the user has another active setup
    // anywhere, ask permission to end it before starting here.
    try {
      const existing = await db.getMyActiveTripSwimGroup();
      if (existing && existing.trip_id !== trip.id) {
        const ok = window.confirm(
          'You have an active setup on another trip. Continue here will end that setup. Continue?'
        );
        if (!ok) return;
        await db.endTripSwimGroup(existing.id);
      }
    } catch (e: any) {
      alert(e?.message || 'Could not check existing setups');
      return;
    }
    setPendingRodDrop(null);
    setEditingRod(null);
    setDropMode('await_swim');
  }

  function handleAddRod() {
    if (!activeSetup) return;
    setPendingSwimDrop(null);
    setEditingRod(null);
    setDropMode('await_rod');
  }

  function cancelDrop() {
    setDropMode('idle');
    setPendingSwimDrop(null);
    setPendingRodDrop(null);
  }

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
            dropMode={dropMode !== 'idle'}
            dropHint={
              dropMode === 'await_swim' ? 'Tap your swim location' :
              dropMode === 'await_rod' ? 'Tap your rod spot' :
              undefined
            }
            onDropPick={(lat, lng) => {
              if (dropMode === 'await_swim') {
                setPendingSwimDrop({ lat, lng });
              } else if (dropMode === 'await_rod') {
                setPendingRodDrop({ lat, lng });
              }
            }}
            setupSwim={activeSetup && activeSetup.swim_latitude != null && activeSetup.swim_longitude != null
              ? { lat: activeSetup.swim_latitude, lng: activeSetup.swim_longitude, label: activeSetup.swim_label }
              : null}
            setupRods={activeRods}
            pendingSwim={pendingSwimDrop}
            onOpenRodSpot={setEditingRod}
          />

          {/* Cancel-placement chip on the map (in addition to the banner)
              so the user can back out without scrolling. */}
          {dropMode !== 'idle' && (
            <button
              onClick={cancelDrop}
              className="tap"
              style={{
                position: 'absolute', left: 12, top: 56, zIndex: 1000,
                padding: '8px 12px', borderRadius: 999,
                background: 'rgba(10,24,22,0.92)',
                border: '1px solid rgba(220,107,88,0.5)',
                color: '#ff8276',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            >
              <X size={12} /> Cancel
            </button>
          )}

          {/* Annotation visibility toggle — only control on this surface. */}
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

      {/* Big Set up / Add a rod CTA — disabled when not in idle drop mode
          since the user is mid-placement. */}
      <SetupCta
        canStart={canStartSetup && dropMode === 'idle'}
        hasActive={!!activeSetup}
        onClick={() => {
          if (activeSetup) handleAddRod();
          else handleStartSetup();
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
          Past setups{pastSetups.length > 0 ? ` · ${pastSetups.length}` : ''}
        </SetupTabBtn>
      </div>

      {tab === 'active' && (
        activeSetup ? (
          <ActiveSetupCard
            setup={activeSetup}
            rods={activeRods}
            catchesAtSetup={activeCatches}
            onEditRod={setEditingRod}
            onChanged={invalidateSetupCaches}
          />
        ) : (
          <ActiveSetupEmpty />
        )
      )}
      {tab === 'past' && (
        pastSetups.length === 0
          ? <PastSetupsEmpty />
          : <PastSetupsList
              setups={pastSetups}
              allRodSpots={allRodSpots}
              tripCatches={catches.filter(c => c.trip_id === trip.id)}
              onOpenCatch={onOpenCatch}
              onChanged={invalidateSetupCaches}
            />
      )}

      {/* New Setup modal — opens after the user taps the swim location
          while in await_swim mode. */}
      {pendingSwimDrop && dropMode === 'await_swim' && (
        <NewSetupForm
          tripId={trip.id}
          lat={pendingSwimDrop.lat}
          lng={pendingSwimDrop.lng}
          onClose={cancelDrop}
          onSaved={() => {
            setPendingSwimDrop(null);
            setDropMode('idle');
            invalidateSetupCaches();
          }}
        />
      )}

      {/* Add-rod form — fed the active setup's swim coords + group id. */}
      {pendingRodDrop && dropMode === 'await_rod' && activeSetup && trip.lake_id && (
        <RodSpotForm
          lakeId={trip.lake_id}
          draft={{
            swim_latitude: activeSetup.swim_latitude as number,
            swim_longitude: activeSetup.swim_longitude as number,
            spot_latitude: pendingRodDrop.lat,
            spot_longitude: pendingRodDrop.lng,
          }}
          groupId={activeSetup.swim_group_id}
          initialSwimLabel={activeSetup.swim_label}
          onClose={() => {
            setPendingRodDrop(null);
            setDropMode('idle');
          }}
          onSaved={() => {
            setPendingRodDrop(null);
            setDropMode('idle');
            invalidateSetupCaches();
          }}
        />
      )}

      {/* Edit existing rod (tap on the rod card or map pin). */}
      {editingRod && trip.lake_id && (
        <RodSpotForm
          lakeId={trip.lake_id}
          existing={editingRod}
          draft={{
            swim_latitude: editingRod.swim_latitude,
            swim_longitude: editingRod.swim_longitude,
            spot_latitude: editingRod.spot_latitude,
            spot_longitude: editingRod.spot_longitude,
          }}
          onClose={() => setEditingRod(null)}
          onSaved={() => {
            setEditingRod(null);
            invalidateSetupCaches();
          }}
        />
      )}

      {openAnno && (
        <AnnotationDetail anno={openAnno} author={profilesById[openAnno.angler_id]} onClose={() => setOpenAnno(null)} />
      )}
    </div>
  );
}

// ============================================================================
// Set up modal — vaul drawer (portal escapes Leaflet's stacking context).
// Step 2 of the placement flow: by the time we render, the user already
// tapped the swim location (lat/lng passed in).
// ============================================================================
function NewSetupForm({ tripId, lat, lng, onClose, onSaved }: {
  tripId: string;
  lat: number;
  lng: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  async function start() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await db.createTripSwimGroup({
        trip_id: tripId,
        swim_latitude: lat,
        swim_longitude: lng,
        swim_label: name.trim(),
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.message || 'Failed to start setup');
    } finally {
      setBusy(false);
    }
  }
  return (
    <VaulModalShell title="New setup" onClose={onClose} stackLevel={1}>
      <label className="label">Swim name</label>
      <input
        className="input"
        autoFocus
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Peg 12, Bay swim"
        style={{ marginBottom: 12 }}
      />

      <label className="label">Notes (optional)</label>
      <textarea
        className="input"
        rows={3}
        maxLength={300}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything useful for this session…"
        style={{ marginBottom: 12, resize: 'vertical', fontFamily: 'inherit' }}
      />

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="btn btn-ghost"
          style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}>Cancel</button>
        <button
          onClick={start}
          disabled={!name.trim() || busy}
          className="btn btn-primary"
          style={{ flex: 2 }}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Start
        </button>
      </div>
    </VaulModalShell>
  );
}

// ============================================================================
// Active Setup card — visible when an open trip_swim_groups row exists for
// the current user on this trip. Shows swim header (inline-editable name),
// summary stats, the rods list, and a destructive Delete button.
// ============================================================================
function ActiveSetupCard({ setup, rods, catchesAtSetup, onEditRod, onChanged }: {
  setup: TripSwimGroup;
  rods: RodSpot[];
  catchesAtSetup: Catch[];
  onEditRod: (s: RodSpot) => void;
  onChanged: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(setup.swim_label || '');
  useEffect(() => { setNameDraft(setup.swim_label || ''); }, [setup.swim_label]);

  async function saveName() {
    const next = nameDraft.trim() || null;
    setEditingName(false);
    if (next === (setup.swim_label || null)) return;
    try {
      await db.updateTripSwimGroupLabel(setup.id, next);
      onChanged();
    } catch (e: any) {
      alert(e?.message || 'Failed to rename swim');
    }
  }

  async function deleteSetup() {
    const msg = rods.length > 0
      ? `End this setup? ${rods.length} rod${rods.length === 1 ? '' : 's'} will be cleared. Catches keep their data but lose the rod link.`
      : 'End this setup?';
    if (!confirm(msg)) return;
    try {
      // Clear rods first so catches lose their FK gracefully (rod_spots
      // table cascades only the rod rows themselves; catches.rod_spot_id
      // is NULLed by ON DELETE SET NULL on that column).
      if (rods.length > 0) {
        await db.deleteSwimGroup(setup.swim_group_id);
      }
      await db.endTripSwimGroup(setup.id);
      onChanged();
    } catch (e: any) {
      alert(e?.message || 'Failed to end setup');
    }
  }

  const startedRel = relativeTime(setup.started_at);
  const totalCatches = catchesAtSetup.length;

  return (
    <div className="card" style={{
      padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
      background: 'rgba(10,24,22,0.6)', border: '1px solid rgba(234,201,136,0.22)',
    }}>
      {/* Header — name + meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {editingName ? (
          <input
            className="input"
            autoFocus
            value={nameDraft}
            maxLength={40}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(setup.swim_label || ''); setEditingName(false); } }}
            style={{ fontSize: 18, fontWeight: 500, fontFamily: 'inherit' }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="tap"
            style={{
              background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
              textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: 8,
              color: 'var(--text)', fontFamily: 'inherit',
            }}
          >
            <span className="display-font" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.1 }}>
              {setup.swim_label || 'Untitled swim'}
            </span>
            <Pencil size={13} style={{ color: 'var(--text-3)' }} />
          </button>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Started {startedRel}
          {totalCatches > 0 && ` · ${totalCatches} catch${totalCatches === 1 ? '' : 'es'}`}
        </div>
      </div>

      {/* Rods list */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Rods{rods.length > 0 ? ` · ${rods.length}` : ''}
        </div>
        {rods.length === 0 ? (
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'rgba(10,24,22,0.5)',
            border: '1px dashed rgba(234,201,136,0.18)',
            color: 'var(--text-3)', fontSize: 12, lineHeight: 1.4,
          }}>
            No rods placed yet. Tap <strong>Add a rod</strong> above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rods.map((s, i) => (
              <RodRow key={s.id} rod={s} index={i} onClick={() => onEditRod(s)} />
            ))}
          </div>
        )}
      </div>

      <button
        onClick={deleteSetup}
        className="tap"
        style={{
          marginTop: 4,
          width: '100%', padding: 12, borderRadius: 12,
          background: 'rgba(220,107,88,0.12)',
          border: '1px solid rgba(220,107,88,0.4)',
          color: '#ff8276',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <Trash2 size={14} /> End setup
      </button>
    </div>
  );
}

function RodRow({ rod, index, onClick }: { rod: RodSpot; index: number; onClick: () => void }) {
  const wraps = rod.wraps_actual ?? rod.wraps_calculated ?? calculateWraps(
    rod.swim_latitude, rod.swim_longitude, rod.spot_latitude, rod.spot_longitude,
  );
  const bottom = bottomTypeMeta(rod.bottom_type);
  const title = rod.spot_label || `Rod ${index + 1}`;
  return (
    <button
      onClick={onClick}
      className="card tap"
      style={{
        padding: 10, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        {rod.features && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rod.features}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="num-display" style={{ fontSize: 16, color: 'var(--gold-2)', lineHeight: 1 }}>{wraps}</div>
        <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginTop: 2 }}>wraps</div>
        {bottom && (
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, whiteSpace: 'nowrap' }}>
            {bottom.emoji} {bottom.label}
          </div>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// Past Setups list — collapsible rows for trip_swim_groups WHERE ended_at
// IS NOT NULL on this trip. Cross-trip ("setups at this lake from any of
// my trips") lands in PR3.
// ============================================================================
function PastSetupsList({ setups, allRodSpots, tripCatches, onOpenCatch, onChanged }: {
  setups: TripSwimGroup[];
  allRodSpots: RodSpot[];
  tripCatches: Catch[];
  onOpenCatch: (c: Catch) => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  async function deletePast(setup: TripSwimGroup) {
    const rods = allRodSpots.filter(r => r.swim_group_id === setup.swim_group_id);
    const msg = rods.length > 0
      ? `Delete this setup and its ${rods.length} rod${rods.length === 1 ? '' : 's'}? Catches keep their data but lose the rod link.`
      : 'Delete this setup?';
    if (!confirm(msg)) return;
    try {
      if (rods.length > 0) await db.deleteSwimGroup(setup.swim_group_id);
      await db.deleteTripSwimGroup(setup.id);
      setOpenRowId(null);
      onChanged();
    } catch (e: any) {
      alert(e?.message || 'Failed to delete setup');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {setups.map(s => {
        const rods = allRodSpots.filter(r => r.swim_group_id === s.swim_group_id);
        const cs = tripCatches.filter(c => c.swim_group_id === s.swim_group_id && !c.lost);
        const isOpen = expanded === s.id;
        const rowOpen = openRowId === s.id;
        return (
          <SwipeableRow
            key={s.id}
            isOpen={rowOpen}
            onOpen={() => setOpenRowId(s.id)}
            onClose={() => { if (rowOpen) setOpenRowId(null); }}
            onAction={() => deletePast(s)}
            actionLabel="Delete"
          >
            <div className="card" style={{
              background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
              borderRadius: 14, overflow: 'hidden',
            }}>
              <button
                onClick={() => { if (rowOpen) { setOpenRowId(null); return; } setExpanded(isOpen ? null : s.id); }}
                className="tap"
                style={{
                  width: '100%', padding: 12, background: 'transparent', border: 'none',
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.swim_label || 'Untitled swim'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {formatSetupRange(s.started_at, s.ended_at)} · {rods.length} rod{rods.length === 1 ? '' : 's'} · {cs.length} catch{cs.length === 1 ? '' : 'es'}
                  </div>
                </div>
                {isOpen ? <ChevronUp size={16} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-3)' }} />}
              </button>
              {isOpen && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(234,201,136,0.08)' }}>
                  {rods.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        Rods
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {rods.map((r, i) => {
                          const w = r.wraps_actual ?? r.wraps_calculated ?? calculateWraps(
                            r.swim_latitude, r.swim_longitude, r.spot_latitude, r.spot_longitude,
                          );
                          const bottom = bottomTypeMeta(r.bottom_type);
                          return (
                            <div key={r.id} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: 8, borderRadius: 10,
                              background: 'rgba(10,24,22,0.5)',
                              fontSize: 12, color: 'var(--text-2)',
                            }}>
                              <span style={{ fontWeight: 600 }}>{r.spot_label || `Rod ${i + 1}`}</span>
                              <span style={{ color: 'var(--text-3)' }}>· {w} wraps</span>
                              {bottom && <span style={{ color: 'var(--text-3)' }}>· {bottom.emoji} {bottom.label}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {cs.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        Catches
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {cs.map(c => (
                          <button
                            key={c.id}
                            onClick={() => onOpenCatch(c)}
                            className="tap"
                            style={{
                              background: 'transparent', border: 'none',
                              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                              color: 'var(--text)',
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px', borderRadius: 10,
                            }}
                          >
                            <span style={{ fontSize: 12, color: 'var(--gold-2)', fontWeight: 600 }}>{c.lbs}lb {c.oz}oz</span>
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.species || ''}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SwipeableRow>
        );
      })}
    </div>
  );
}

// ============================================================================
// Stateless presentation — empty states, tab buttons, CTA, annotation modal.
// ============================================================================
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

// ============================================================================
// Helpers
// ============================================================================
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function formatSetupRange(startedISO: string, endedISO: string | null): string {
  const s = new Date(startedISO);
  if (!endedISO) return s.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const e = new Date(endedISO);
  const sameDay = s.toDateString() === e.toDateString();
  const sf: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (sameDay) {
    const tf: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    return `${s.toLocaleString(undefined, sf)} → ${e.toLocaleTimeString(undefined, tf)}`;
  }
  return `${s.toLocaleString(undefined, sf)} → ${e.toLocaleString(undefined, sf)}`;
}
