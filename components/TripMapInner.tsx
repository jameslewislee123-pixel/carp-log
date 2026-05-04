'use client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import type { MarkerCatch } from './TripMap';
import { formatWeight } from '@/lib/util';
import { useMemo, useState } from 'react';
import { TILE_LAYERS, type MapLayer } from '@/lib/mapTiles';
import MapLayerToggle from './MapLayerToggle';

// Build a colored circular div-icon — avoids the default-icon webpack hassle entirely.
function pinIcon(color: string, label: string) {
  return L.divIcon({
    className: 'carp-pin',
    html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #050E0D;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#1A1004;font-weight:700;font-size:12px;font-family:'Fraunces',serif;"><span style="transform:rotate(45deg);">${label}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28],
  });
}

export default function TripMapInner({ center, markers, onOpenCatch, photoUrl }: {
  center: { lat: number; lng: number };
  markers: MarkerCatch[];
  onOpenCatch: (id: string) => void;
  photoUrl: (m: MarkerCatch) => string | null;
}) {
  // Auto-zoom to fit markers (or city-zoom if all the same point).
  const bounds = useMemo(() => {
    if (markers.length < 2) return null;
    return L.latLngBounds(markers.map(m => [m.lat, m.lng] as [number, number]));
  }, [markers]);

  const [layer, setLayer] = useState<MapLayer>('satellite');
  return (
    <div style={{ height: '60vh', minHeight: 380, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.14)', position: 'relative' }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={markers.length === 0 ? 11 : 13}
        bounds={bounds || undefined}
        boundsOptions={{ padding: [40, 40], maxZoom: 15 }}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          key={layer}
          url={TILE_LAYERS[layer].url}
          attribution={TILE_LAYERS[layer].attribution}
          maxZoom={TILE_LAYERS[layer].maxZoom}
        />
        {markers.map(m => {
          const url = photoUrl(m);
          const initial = (m.angler?.display_name || '?')[0]?.toUpperCase();
          return (
            <Marker key={m.id} position={[m.lat, m.lng]} icon={pinIcon(m.color, initial)}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  {url && <img src={url} alt="" style={{ width: '100%', maxWidth: 200, aspectRatio: '4/3', objectFit: 'cover', borderRadius: 10, marginBottom: 8 }} />}
                  <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: '#EAC988', lineHeight: 1 }}>
                    {m.lbs}<span style={{ fontSize: 14, color: '#F2EDDC' }}>lb</span>
                    {m.oz > 0 && <> {m.oz}<span style={{ fontSize: 12, color: '#F2EDDC' }}>oz</span></>}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#F2EDDC' }}>
                    {m.angler?.display_name || 'Unknown'}{m.species ? ` · ${m.species}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#788C84', marginTop: 2 }}>
                    {new Date(m.date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <button onClick={() => onOpenCatch(m.id)} style={{
                    marginTop: 10, width: '100%', padding: '8px 12px', borderRadius: 10,
                    background: 'var(--gold)', color: '#1A1004', border: 'none',
                    fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>Open catch</button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      <MapLayerToggle layer={layer} onChange={setLayer} />
    </div>
  );
}
