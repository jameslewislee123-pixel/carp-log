'use client';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { TILE_LAYERS, type MapLayer } from '@/lib/mapTiles';
import MapLayerToggle from './MapLayerToggle';

export type OSMVenue = {
  id: string;          // composite "type-id" so duplicates from the api don't collide
  name: string;
  lat: number;
  lng: number;
  type: string;        // 'fishing' | 'water' | 'sport' etc
  distanceKm: number;
  added?: boolean;     // mutated in-place by parent when user adds it
};

// Gold rod-tip pin: bigger than the catch pins, with a subtle fishing-rod glyph.
function rodPinIcon(added: boolean) {
  const fill = added ? '#7BA888' : '#EAC988';      // gold, or sage green when added
  const stroke = added ? '#3F5E4B' : '#1A1004';
  const glyph = added ? '✓' : '🎣';
  return L.divIcon({
    className: 'osm-pin',
    html: `<div style="
      width:38px;height:38px;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${fill};
      border:2px solid ${stroke};
      box-shadow:0 4px 12px rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;
    "><span style="transform:rotate(45deg);font-size:18px;line-height:1;">${glyph}</span></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -34],
  });
}

function userDotIcon() {
  return L.divIcon({
    className: 'user-dot',
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:#5AAEFF;
      box-shadow:0 0 0 4px rgba(90,174,255,0.28),0 2px 6px rgba(0,0,0,0.5);
      border:2px solid #FFF;
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// Re-fit bounds when the venue set changes. Inside MapContainer.
function FitBounds({ center, venues, radiusMeters }: {
  center: { lat: number; lng: number };
  venues: OSMVenue[];
  radiusMeters: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (venues.length === 0) {
      map.setView([center.lat, center.lng], radiusMeters > 50000 ? 9 : radiusMeters > 30000 ? 10 : 11);
      return;
    }
    const bounds = L.latLngBounds([
      [center.lat, center.lng],
      ...venues.map(v => [v.lat, v.lng] as [number, number]),
    ]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [center.lat, center.lng, venues, map, radiusMeters]);
  return null;
}

export default function DiscoverVenuesMap({ center, venues, radiusKm, focusId, onAdd, onDirections }: {
  center: { lat: number; lng: number };
  venues: OSMVenue[];
  radiusKm: number;
  focusId: string | null;
  onAdd: (v: OSMVenue) => void;
  onDirections: (v: OSMVenue) => void;
}) {
  const radiusMeters = radiusKm * 1000;
  const focused = useMemo(() => venues.find(v => v.id === focusId) || null, [venues, focusId]);
  const [layer, setLayer] = useState<MapLayer>('satellite');

  return (
    <div style={{ height: '50vh', minHeight: 320, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.14)', position: 'relative' }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={11}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          key={layer}
          url={TILE_LAYERS[layer].url}
          attribution={TILE_LAYERS[layer].attribution}
          maxZoom={TILE_LAYERS[layer].maxZoom}
        />

        {/* Search radius outline */}
        <Circle
          center={[center.lat, center.lng]}
          radius={radiusMeters}
          pathOptions={{ color: '#EAC988', weight: 1, opacity: 0.4, dashArray: '6 6', fillOpacity: 0.04 }}
        />

        {/* User location */}
        <Marker position={[center.lat, center.lng]} icon={userDotIcon()}>
          <Popup>You are here</Popup>
        </Marker>

        {venues.map(v => (
          <Marker key={v.id} position={[v.lat, v.lng]} icon={rodPinIcon(!!v.added)}>
            <Popup>
              <div style={{ minWidth: 200 }}>
                <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 500, color: '#EAC988', lineHeight: 1.2 }}>
                  {v.name}
                </div>
                <div style={{ fontSize: 11, color: '#788C84', marginTop: 4, textTransform: 'capitalize' }}>
                  {v.type} · {v.distanceKm.toFixed(1)}km away
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button
                    onClick={() => onAdd(v)}
                    disabled={v.added}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 10,
                      background: v.added ? 'rgba(141,191,157,0.2)' : 'var(--gold)',
                      color: v.added ? '#7BA888' : '#1A1004',
                      border: v.added ? '1px solid #7BA888' : 'none',
                      fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700,
                      cursor: v.added ? 'default' : 'pointer',
                    }}>{v.added ? '✓ Added' : 'Add as venue'}</button>
                  <button
                    onClick={() => onDirections(v)}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 10,
                      background: 'transparent', color: '#F2EDDC',
                      border: '1px solid rgba(234,201,136,0.4)',
                      fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700,
                      cursor: 'pointer',
                    }}>Directions</button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        <FitBounds center={center} venues={venues} radiusMeters={radiusMeters} />
        <FocusOnMarker focused={focused} />
      </MapContainer>
      <MapLayerToggle layer={layer} onChange={setLayer} />
    </div>
  );
}

function FocusOnMarker({ focused }: { focused: OSMVenue | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focused) return;
    map.flyTo([focused.lat, focused.lng], Math.max(map.getZoom(), 13), { duration: 0.5 });
  }, [focused, map]);
  return null;
}
