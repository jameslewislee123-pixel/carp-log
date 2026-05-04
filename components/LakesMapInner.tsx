'use client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import type { EnrichedLake } from '@/lib/queries';

function pinIcon(fished: boolean) {
  const fill = fished ? '#EAC988' : '#7BA888';
  return L.divIcon({
    className: 'lake-pin',
    html: `<div style="
      width:30px;height:30px;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${fill};
      border:2px solid #050E0D;
      box-shadow:0 4px 10px rgba(0,0,0,0.5);
    "></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

function FitBounds({ lakes }: { lakes: EnrichedLake[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = lakes.filter(l => l.latitude != null && l.longitude != null)
      .map(l => [l.latitude!, l.longitude!] as [number, number]);
    if (pts.length === 0) return;
    if (pts.length === 1) { map.setView(pts[0], 11); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 12 });
  }, [lakes, map]);
  return null;
}

export default function LakesMapInner({ lakes, onOpen }: {
  lakes: EnrichedLake[];
  onOpen: (lake: EnrichedLake) => void;
}) {
  const pinned = useMemo(() => lakes.filter(l => l.latitude != null && l.longitude != null), [lakes]);
  const initial = pinned[0]
    ? { lat: pinned[0].latitude!, lng: pinned[0].longitude! }
    : { lat: 52.05, lng: -0.7 };

  return (
    <div style={{ height: '60vh', minHeight: 400, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.14)' }}>
      <MapContainer
        center={[initial.lat, initial.lng]}
        zoom={6}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        {pinned.map(l => (
          <Marker key={l.key} position={[l.latitude!, l.longitude!]} icon={pinIcon(l.catchCount > 0)}>
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 500, color: '#EAC988', lineHeight: 1.2 }}>
                  {l.name}
                </div>
                <div style={{ fontSize: 11, color: '#788C84', marginTop: 4 }}>
                  {l.catchCount > 0 ? `${l.catchCount} fish caught` : 'Saved venue · not fished yet'}
                  {l.source === 'osm' && ' · OSM'}
                </div>
                <button onClick={() => onOpen(l)} style={{
                  marginTop: 10, width: '100%', padding: '8px 12px', borderRadius: 10,
                  background: 'var(--gold)', color: '#1A1004', border: 'none',
                  fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>Open</button>
              </div>
            </Popup>
          </Marker>
        ))}
        <FitBounds lakes={pinned} />
      </MapContainer>
    </div>
  );
}
