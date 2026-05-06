'use client';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { MarkerCatch } from './TripMap';
import type { LakeAnnotation } from '@/lib/types';
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

const ANN_STYLES: Record<LakeAnnotation['type'], { bg: string; emoji: string; label: string }> = {
  productive_spot: { bg: '#EAC988', emoji: '⭐', label: 'Productive' },
  hot_spot:        { bg: '#D4B673', emoji: '🔥', label: 'Hot spot' },
  snag:            { bg: '#DC6B58', emoji: '⚠️', label: 'Snag' },
  note:            { bg: '#8DBF9D', emoji: '📍', label: 'Note' },
};
function annoIcon(type: LakeAnnotation['type']) {
  const s = ANN_STYLES[type];
  return L.divIcon({
    className: 'carp-anno',
    html: `<div style="width:34px;height:34px;border-radius:18px;background:${s.bg};border:2px solid #050E0D;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:16px;">${s.emoji}</div>`,
    iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16],
  });
}

function ClickCapture({ enabled, onPick }: { enabled: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { if (enabled) onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export default function TripMapInner({
  center, markers, onOpenCatch, photoUrl,
  annotations = [], onOpenAnnotation,
  dropMode = false, dropHint, onDropPick,
}: {
  center: { lat: number; lng: number };
  markers: MarkerCatch[];
  onOpenCatch: (id: string) => void;
  photoUrl: (m: MarkerCatch) => string | null;
  // Lake annotations rendered on the trip map (PR1: read-only). Empty array
  // is the default so callers that don't care about annotations don't have
  // to pass anything.
  annotations?: LakeAnnotation[];
  onOpenAnnotation?: (a: LakeAnnotation) => void;
  // Annotation-placement mode. When true, taps on the map fire onDropPick
  // instead of being absorbed by the markers.
  dropMode?: boolean;
  dropHint?: string;
  onDropPick?: (lat: number, lng: number) => void;
}) {
  // Auto-zoom to fit markers + annotations (city-zoom if too few points).
  const bounds = useMemo(() => {
    const pts: [number, number][] = [];
    markers.forEach(m => pts.push([m.lat, m.lng]));
    annotations.forEach(a => pts.push([a.latitude, a.longitude]));
    return pts.length >= 2 ? L.latLngBounds(pts) : null;
  }, [markers, annotations]);

  const [layer, setLayer] = useState<MapLayer>('satellite');
  return (
    <div style={{ height: '60vh', minHeight: 380, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.14)', position: 'relative', cursor: dropMode ? 'crosshair' : 'auto' }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={markers.length === 0 ? 14 : 13}
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
        <ClickCapture enabled={dropMode} onPick={(lat, lng) => onDropPick?.(lat, lng)} />

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

        {annotations.map(a => (
          <Marker key={a.id} position={[a.latitude, a.longitude]} icon={annoIcon(a.type)}>
            <Popup>
              <div style={{ minWidth: 160 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#EAC988', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{ANN_STYLES[a.type].label}</div>
                <div style={{ fontSize: 14, color: '#F2EDDC', fontWeight: 600, marginTop: 2 }}>{a.title}</div>
                {a.description && <div style={{ fontSize: 12, color: '#B5B6A6', marginTop: 4, lineHeight: 1.3 }}>{a.description}</div>}
                {onOpenAnnotation && (
                  <button onClick={() => onOpenAnnotation(a)} style={{
                    marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8,
                    background: 'transparent', color: '#EAC988', border: '1px solid rgba(234,201,136,0.4)',
                    fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>Details</button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <MapLayerToggle layer={layer} onChange={setLayer} />

      {dropMode && (
        <div style={{
          position: 'absolute', top: 12, left: 12, right: 12, padding: 10, borderRadius: 12,
          background: 'rgba(212,182,115,0.92)', color: '#1A1004', textAlign: 'center',
          fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 700,
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)', zIndex: 1000, pointerEvents: 'none',
        }}>
          {dropHint || 'Tap on the map to drop a pin'}
        </div>
      )}
    </div>
  );
}
