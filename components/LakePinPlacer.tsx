'use client';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { TILE_LAYERS, type MapLayer } from '@/lib/mapTiles';
import MapLayerToggle from './MapLayerToggle';

// Gold tear-drop matching the existing lake-centre pin in LakeMapInner so
// the manual-entry preview reads the same as the saved lake's marker.
function lakeIcon() {
  return L.divIcon({
    className: 'lake-pin-placer',
    html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:linear-gradient(180deg,#EAC988,#D4B673);border:2px solid #1A1004;box-shadow:0 6px 14px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:16px;">🎣</span></div>`,
    iconSize: [34, 34], iconAnchor: [17, 34],
  });
}

function ClickToMove({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

// Recenter the map when the parent supplies a new `flyTo` (e.g. GPS arrives
// after we've started rendering at a fallback location). Doesn't run on
// every position change — only when `flyTo` itself becomes a new object.
function FlyTo({ to }: { to: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!to) return;
    map.flyTo([to.lat, to.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [to, map]);
  return null;
}

export default function LakePinPlacer({ position, onChange, flyTo }: {
  position: { lat: number; lng: number };
  onChange: (pos: { lat: number; lng: number }) => void;
  flyTo?: { lat: number; lng: number } | null;
}) {
  const markerRef = useRef<L.Marker>(null);
  const [layer, setLayer] = useState<MapLayer>('satellite');

  return (
    <div style={{ position: 'relative', width: '100%', height: 280, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.18)' }}>
      <MapContainer
        center={[position.lat, position.lng]}
        zoom={13}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          key={layer}
          url={TILE_LAYERS[layer].url}
          attribution={TILE_LAYERS[layer].attribution}
          maxZoom={TILE_LAYERS[layer].maxZoom}
        />
        <ClickToMove onPick={(lat, lng) => onChange({ lat, lng })} />
        <FlyTo to={flyTo || null} />
        <Marker
          position={[position.lat, position.lng]}
          icon={lakeIcon()}
          draggable
          ref={markerRef as any}
          eventHandlers={{
            dragend: () => {
              const m = markerRef.current;
              if (!m) return;
              const ll = m.getLatLng();
              onChange({ lat: ll.lat, lng: ll.lng });
            },
          }}
        />
      </MapContainer>
      <MapLayerToggle layer={layer} onChange={setLayer} />
    </div>
  );
}
