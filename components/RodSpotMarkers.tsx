'use client';
import { Fragment } from 'react';
import { Marker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import type { RodSpot } from '@/lib/types';
import { midpoint } from '@/lib/wraps';
import { bottomTypeMeta } from '@/lib/bottomTypes';

// Renders saved rod spots as a swim icon, a spot icon, a connecting line,
// and a centred "X wraps" label. Mounted as a child of MapContainer (via
// LakeMapInner's children prop) so it sits inside react-leaflet's context.

const SWIM_COLOR = '#7BA888';   // sage — matches active-trip indicator
const SPOT_COLOR = '#EAC988';   // gold
const LINE_COLOR = '#EAC988';

function swimIcon() {
  return L.divIcon({
    className: 'rod-spot-swim',
    html: `<div style="width:30px;height:30px;border-radius:8px;background:${SWIM_COLOR};border:2px solid #050E0D;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#0A1816;font-size:16px;line-height:1;">⛺</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16],
  });
}

function spotIcon() {
  return L.divIcon({
    className: 'rod-spot-spot',
    html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${SPOT_COLOR};border:2px solid #050E0D;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:14px;line-height:1;">🎣</span></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -28],
  });
}

function effectiveWraps(spot: RodSpot): number | null {
  if (spot.wraps_actual != null) return spot.wraps_actual;
  if (spot.wraps_calculated != null) return spot.wraps_calculated;
  return null;
}

export default function RodSpotMarkers({ spots, onOpen, swimPreview }: {
  spots: RodSpot[];
  onOpen: (s: RodSpot) => void;
  // Optional in-progress swim pin shown while the user is in the
  // 'await_spot' phase of placement, so they can see where they put the
  // swim before tapping the rod spot.
  swimPreview?: { lat: number; lng: number } | null;
}) {
  // Group spots by swim_group_id so multi-rod swims render as one swim
  // icon with several lines fanning out, rather than stacking duplicate
  // swim icons on the same coordinate.
  const groups = new Map<string, RodSpot[]>();
  for (const s of spots) {
    const arr = groups.get(s.swim_group_id);
    if (arr) arr.push(s);
    else groups.set(s.swim_group_id, [s]);
  }

  return (
    <>
      {Array.from(groups.entries()).map(([groupId, members]) => {
        // All siblings in a group share swim coords. Take the first as the
        // canonical swim and pick its label (first non-null wins).
        const head = members[0];
        const swim: [number, number] = [head.swim_latitude, head.swim_longitude];
        const swimLabel = members.find(m => m.swim_label)?.swim_label || null;
        // Tapping the shared swim icon opens the first rod's edit form —
        // a reasonable default; per-rod edits still work via spot-pin taps.
        return (
          <Fragment key={groupId}>
            <Marker position={swim} icon={swimIcon()} eventHandlers={{ click: () => onOpen(head) }}>
              {swimLabel && (
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                  {swimLabel}
                </Tooltip>
              )}
            </Marker>
            {members.map(s => {
              const spot: [number, number] = [s.spot_latitude, s.spot_longitude];
              const mid = midpoint(s.swim_latitude, s.swim_longitude, s.spot_latitude, s.spot_longitude);
              const wraps = effectiveWraps(s);
              return (
                <Fragment key={s.id}>
                  <Polyline
                    positions={[swim, spot]}
                    pathOptions={{ color: LINE_COLOR, weight: 3, opacity: 0.85, dashArray: '6 4' }}
                  />
                  <Marker position={spot} icon={spotIcon()} eventHandlers={{ click: () => onOpen(s) }} />
                  {wraps != null && (() => {
                    const bottom = bottomTypeMeta(s.bottom_type);
                    const text = `${wraps} wrap${wraps === 1 ? '' : 's'}${bottom ? ` · ${bottom.emoji}` : ''}`;
                    return (
                      <Marker
                        position={[mid.lat, mid.lng]}
                        interactive={false}
                        icon={L.divIcon({
                          className: 'rod-spot-wraps',
                          html: `<div style="padding:3px 8px;border-radius:999px;background:rgba(10,24,22,0.92);border:1px solid rgba(234,201,136,0.5);color:#EAC988;font-family:Manrope,sans-serif;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.45);">${text}</div>`,
                          iconSize: [80, 18], iconAnchor: [40, 9],
                        })}
                      />
                    );
                  })()}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
      {swimPreview && (
        <Marker
          position={[swimPreview.lat, swimPreview.lng]}
          interactive={false}
          icon={L.divIcon({
            className: 'rod-spot-swim-preview',
            html: `<div style="width:30px;height:30px;border-radius:8px;background:${SWIM_COLOR};border:2px dashed #050E0D;box-shadow:0 4px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#0A1816;font-size:16px;line-height:1;opacity:0.85;">⛺</div>`,
            iconSize: [30, 30], iconAnchor: [15, 15],
          })}
        />
      )}
    </>
  );
}
