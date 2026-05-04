'use client';
import type { MapLayer } from '@/lib/mapTiles';

// Floating top-right button that swaps the underlying tile layer.
// Liquid-glass styling matching the rest of the app. Parent must have
// `position: relative` for the absolute-positioned button to anchor.
export default function MapLayerToggle({ layer, onChange }: {
  layer: MapLayer;
  onChange: (next: MapLayer) => void;
}) {
  const next: MapLayer = layer === 'satellite' ? 'map' : 'satellite';
  const label = layer === 'satellite' ? '🗺️ Map' : '🛰️ Satellite';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(next); }}
      aria-label={layer === 'satellite' ? 'Switch to map view' : 'Switch to satellite view'}
      style={{
        position: 'absolute', top: 12, right: 12, zIndex: 1000,
        background: 'rgba(20, 42, 38, 0.85)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(234, 201, 136, 0.25)',
        borderRadius: 10,
        padding: '8px 12px',
        color: 'var(--text)',
        fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
      }}
    >
      {label}
    </button>
  );
}
