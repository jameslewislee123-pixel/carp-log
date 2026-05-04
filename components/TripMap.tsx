'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPinned, Loader2 } from 'lucide-react';
import type { Catch, Profile, Trip } from '@/lib/types';
import { formatWeight } from '@/lib/util';
import { catchCoverUrl } from '@/lib/db';
import { geocodeLake } from '@/lib/weather';

// Avatar palette → marker colors keyed by stable hash of angler_id
const COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4', '#B07A3F'];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

// dynamic import: react-leaflet must not load on the server
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

export default function TripMap({ trip, catches, profilesById, onOpenCatch }: {
  trip: Trip;
  catches: Catch[];
  profilesById: Record<string, Profile>;
  onOpenCatch: (c: Catch) => void;
}) {
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(true);

  // Build markers from catches that already have coords.
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

  // Center: use trip location geocode if available; otherwise centroid of markers; otherwise UK midlands.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      if (markers.length > 0) {
        const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
        const lng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
        if (!cancelled) setCenter({ lat, lng });
      } else if (trip.location) {
        const g = await geocodeLake(trip.location);
        if (!cancelled) setCenter(g || { lat: 52.05, lng: -0.7 });
      } else {
        if (!cancelled) setCenter({ lat: 52.05, lng: -0.7 });
      }
      // Lazy geocode catches that have a lake but no coords (cap at ~6 to avoid hammering the API).
      const needGeocode = catches.filter(c => (c.latitude == null || c.longitude == null) && c.lake?.trim()).slice(0, 6);
      if (needGeocode.length > 0) {
        const found: MarkerCatch[] = [];
        for (const c of needGeocode) {
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
      }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
  /* eslint-disable-next-line */
  }, [trip.id]);

  const lookupCatch = (id: string) => catches.find(c => c.id === id) || null;

  if (!center) return (
    <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  );
  if (markers.length === 0) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px dashed rgba(234,201,136,0.18)' }}>
      <MapPinned size={32} style={{ color: 'var(--text-3)', opacity: 0.5, marginBottom: 10 }} />
      <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>No mappable catches yet.<br />Add a catch with a lake name or while location services are on.</p>
    </div>
  );

  return (
    <MapInner
      center={center}
      markers={markers}
      onOpenCatch={(id) => { const c = lookupCatch(id); if (c) onOpenCatch(c); }}
      photoUrl={(m) => m.cover_url}
    />
  );
}
