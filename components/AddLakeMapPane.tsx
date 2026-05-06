'use client';
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { TILE_LAYERS, type MapLayer } from '@/lib/mapTiles';
import MapLayerToggle from './MapLayerToggle';

// Map pane with a fixed center crosshair — used by AddLakeModal for both
// search-driven and manual lake placement. The crosshair is an absolutely-
// positioned SVG sitting OVER the Leaflet container, NOT a Leaflet marker:
// keeping it as a CSS overlay means it stays put while the map pans
// underneath, which is exactly the "drop pin at map center" UX we want.
//
// The parent owns the crosshair coords. We report them on every Leaflet
// `moveend` (animation end) and once on mount via the controller's flyTo.

// flyTo target — when this prop changes, the map animates to the target.
// Passing the same object reference repeatedly is a no-op since useEffect
// runs on dependency change.
function MapController({ target }: { target: { lat: number; lng: number; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], target.zoom, { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return null;
}

function CrosshairTracker({ onMove }: { onMove: (c: { lat: number; lng: number }) => void }) {
  // useMapEvents returns the map instance — no need for a separate useMap.
  const map = useMapEvents({
    moveend() {
      const c = map.getCenter();
      onMove({ lat: c.lat, lng: c.lng });
    },
  });
  // Initial reading so the parent has crosshair coords before the user pans.
  useEffect(() => {
    const c = map.getCenter();
    onMove({ lat: c.lat, lng: c.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function AddLakeMapPane({ initialCenter, initialZoom, target, onCenterChange, height = 320 }: {
  initialCenter: { lat: number; lng: number };
  initialZoom: number;
  target: { lat: number; lng: number; zoom: number } | null;
  onCenterChange: (c: { lat: number; lng: number }) => void;
  height?: number;
}) {
  const [layer, setLayer] = useState<MapLayer>('satellite');
  return (
    <div style={{ position: 'relative', width: '100%', height, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(234,201,136,0.18)' }}>
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={initialZoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          key={layer}
          url={TILE_LAYERS[layer].url}
          attribution={TILE_LAYERS[layer].attribution}
          maxZoom={TILE_LAYERS[layer].maxZoom}
        />
        <MapController target={target} />
        <CrosshairTracker onMove={onCenterChange} />
      </MapContainer>

      {/* Center crosshair pin — sits OVER the Leaflet container so it stays
          fixed at the visual centre while the map pans underneath. Anchored
          at translate(-50%, -100%) so the tip of the pin marks the centre
          (the circle base is at center + 0px X, base of pin at center). */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'none', zIndex: 1000,
        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.55))',
      }}>
        <svg width="32" height="40" viewBox="0 0 32 40" aria-hidden>
          <path
            d="M16 2C9 2 4 7 4 14c0 8 12 24 12 24s12-16 12-24c0-7-5-12-12-12z"
            fill="#EAC988"
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />
          <circle cx="16" cy="14" r="4.5" fill="#FFFFFF" />
        </svg>
      </div>

      <MapLayerToggle layer={layer} onChange={setLayer} />
    </div>
  );
}
