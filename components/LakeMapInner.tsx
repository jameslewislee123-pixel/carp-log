'use client';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useMemo } from 'react';
import type { Catch, LakeAnnotation, Profile } from '@/lib/types';
import { formatWeight } from '@/lib/util';

// Tear-drop pin for the lake itself. Gold, distinct from the angler-coloured
// catch pins and the round annotation badges. Always rendered at `center`
// so a freshly-bookmarked seed lake with zero catches/annotations still
// shows where it is.
function lakeCenterIcon() {
  return L.divIcon({
    className: 'lake-center-pin',
    html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:linear-gradient(180deg,#EAC988,#D4B673);border:2px solid #1A1004;box-shadow:0 6px 14px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:16px;">🎣</span></div>`,
    iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30],
  });
}

const COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4', '#B07A3F'];
function colorFor(seed: string) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function pinIcon(color: string, label: string) {
  return L.divIcon({
    className: 'carp-pin',
    html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #050E0D;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#1A1004;font-weight:700;font-size:12px;font-family:'Fraunces',serif;"><span style="transform:rotate(45deg);">${label}</span></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -28],
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

export default function LakeMapInner({
  center, catches, annotations, profilesById, dropMode, onDropPick, onOpenCatch, onOpenAnnotation, lakeName,
}: {
  center: { lat: number; lng: number };
  catches: Catch[];
  annotations: LakeAnnotation[];
  profilesById: Record<string, Profile>;
  dropMode: boolean;
  onDropPick: (lat: number, lng: number) => void;
  onOpenCatch: (c: Catch) => void;
  onOpenAnnotation: (a: LakeAnnotation) => void;
  lakeName?: string;
}) {
  const bounds = useMemo(() => {
    const pts: [number, number][] = [];
    catches.forEach(c => { if (c.latitude != null && c.longitude != null) pts.push([c.latitude, c.longitude]); });
    annotations.forEach(a => pts.push([a.latitude, a.longitude]));
    return pts.length >= 2 ? L.latLngBounds(pts) : null;
  }, [catches, annotations]);

  return (
    <div style={{ height: '52vh', minHeight: 320, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.14)', position: 'relative', cursor: dropMode ? 'crosshair' : 'auto' }}>
      <MapContainer
        center={[center.lat, center.lng]} zoom={14}
        bounds={bounds || undefined} boundsOptions={{ padding: [30, 30], maxZoom: 16 }}
        scrollWheelZoom style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <ClickCapture enabled={dropMode} onPick={onDropPick} />

        <Marker position={[center.lat, center.lng]} icon={lakeCenterIcon()}>
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, color: '#EAC988', lineHeight: 1.2 }}>
                {lakeName || 'Lake'}
              </div>
              <div style={{ fontSize: 11, color: '#B5B6A6', marginTop: 2 }}>
                {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
              </div>
            </div>
          </Popup>
        </Marker>

        {catches.filter(c => c.latitude != null && c.longitude != null).map(c => {
          const p = profilesById[c.angler_id];
          const initial = (p?.display_name || '?')[0]?.toUpperCase();
          return (
            <Marker key={c.id} position={[c.latitude!, c.longitude!]} icon={pinIcon(colorFor(c.angler_id), initial)}>
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: '#EAC988', lineHeight: 1 }}>
                    {c.lost ? 'Lost' : formatWeight(c.lbs, c.oz)}
                  </div>
                  <div style={{ fontSize: 12, color: '#F2EDDC', marginTop: 2 }}>
                    {p?.display_name || 'Unknown'}{c.species ? ` · ${c.species}` : ''}
                  </div>
                  <button onClick={() => onOpenCatch(c)} style={{
                    marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8,
                    background: '#D4B673', color: '#1A1004', border: 'none',
                    fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer',
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
                <button onClick={() => onOpenAnnotation(a)} style={{
                  marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8,
                  background: 'transparent', color: '#EAC988', border: '1px solid rgba(234,201,136,0.4)',
                  fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>Details</button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {dropMode && (
        <div style={{
          position: 'absolute', top: 12, left: 12, right: 12, padding: 10, borderRadius: 12,
          background: 'rgba(212,182,115,0.92)', color: '#1A1004', textAlign: 'center',
          fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 700,
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)', zIndex: 1000, pointerEvents: 'none',
        }}>
          Tap on the map to drop a pin
        </div>
      )}
    </div>
  );
}

export { ANN_STYLES };
