'use client';
import { useMemo, useState, useEffect } from 'react';
import { useRodSpotsAtLake } from '@/lib/queries';
import { calculateWraps } from '@/lib/wraps';
import { bottomTypeMeta } from '@/lib/bottomTypes';
import type { RodSpot } from '@/lib/types';

// Cascading swim → rod picker for AddCatch / EditCatch.
//
// Behaviour:
//   • Lake not set → component renders nothing.
//   • Lake set, no rod_spots at this lake → free-text swim input only.
//   • Lake set with rod_spots → swim pills (one per swim_group_id) above
//     a "Or type a swim name" toggle. Picking a swim reveals rod pills
//     (one per spot in that group). Picking a rod sets rod_spot_id.
//   • Free-text swim never sets swim_group_id or rod_spot_id.
//
// Parent owns the value; this component is fully controlled.

export type SwimRodValue = {
  swim: string | null;
  swim_group_id: string | null;
  rod_spot_id: string | null;
};

export default function SwimRodPicker({ lakeId, value, onChange }: {
  lakeId: string | null;
  value: SwimRodValue;
  onChange: (v: SwimRodValue) => void;
}) {
  const rodSpotsQuery = useRodSpotsAtLake(lakeId);
  const rodSpots = rodSpotsQuery.data || [];

  // Group rod_spots by swim_group_id. Each group becomes one swim pill.
  const swimGroups = useMemo(() => {
    const map = new Map<string, RodSpot[]>();
    for (const s of rodSpots) {
      const arr = map.get(s.swim_group_id);
      if (arr) arr.push(s);
      else map.set(s.swim_group_id, [s]);
    }
    return Array.from(map.entries()).map(([gid, members]) => ({
      groupId: gid,
      members,
      swimLabel: members.find(m => m.swim_label)?.swim_label || null,
    }));
  }, [rodSpots]);

  // Local UI state: are we in free-text mode? Three triggers flip this on:
  //   • parent value has swim text but no swim_group_id (legacy text catches)
  //   • parent value has neither (fresh catch) AND no swim groups exist
  //   • user explicitly toggles via the "Or type a swim name" link
  const noPinnedSwims = swimGroups.length === 0 && rodSpotsQuery.isFetched;
  const hasPinnedSelection = !!value.swim_group_id;
  const hasFreeText = !!value.swim && !value.swim_group_id;
  const [freeText, setFreeText] = useState<boolean>(noPinnedSwims || hasFreeText);

  // Sync freeText when external state changes (e.g. picker resets between catches).
  useEffect(() => {
    if (noPinnedSwims) { setFreeText(true); return; }
    if (hasFreeText) setFreeText(true);
    if (hasPinnedSelection) setFreeText(false);
  }, [noPinnedSwims, hasFreeText, hasPinnedSelection]);

  if (!lakeId) return null;

  // The currently-selected swim group, if any.
  const selectedGroup = value.swim_group_id
    ? swimGroups.find(g => g.groupId === value.swim_group_id) || null
    : null;

  function pickSwimGroup(groupId: string, swimLabel: string | null) {
    onChange({
      swim: swimLabel,
      swim_group_id: groupId,
      rod_spot_id: null,
    });
  }

  function pickRodSpot(spot: RodSpot) {
    onChange({
      // Keep the swim label in `swim` for display fallback even when the
      // user later switches to a different rod from the same group.
      swim: spot.swim_label || value.swim,
      swim_group_id: spot.swim_group_id,
      rod_spot_id: spot.id,
    });
  }

  function setFreeTextValue(text: string) {
    onChange({
      swim: text || null,
      swim_group_id: null,
      rod_spot_id: null,
    });
  }

  return (
    <>
      {/* Swim label is provided by the caller (e.g. AddCatch's PrivacyLabel)
          so this component can drop in next to existing form sections. */}
      {!freeText && swimGroups.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 8 }}>
            {swimGroups.map(g => {
              const selected = value.swim_group_id === g.groupId;
              const label = g.swimLabel || 'Swim';
              const subtitle = g.members.length > 1 ? `${g.members.length} rods` : null;
              return (
                <button
                  key={g.groupId}
                  type="button"
                  onClick={() => pickSwimGroup(g.groupId, g.swimLabel)}
                  className="tap"
                  style={{
                    padding: '10px 8px', borderRadius: 12,
                    border: `1px solid ${selected ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                    background: selected ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
                    color: selected ? 'var(--gold-2)' : 'var(--text-2)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    minHeight: 52,
                  }}
                >
                  <span>⛺ {label}</span>
                  {subtitle && (
                    <span style={{ fontSize: 10, color: selected ? 'var(--gold-2)' : 'var(--text-3)', opacity: 0.85, fontWeight: 500 }}>
                      {subtitle}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { setFreeText(true); setFreeTextValue(value.swim || ''); }}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-3)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0,
              fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3,
              marginBottom: 14,
            }}
          >
            Or type a swim name
          </button>
        </>
      )}

      {freeText && (
        <>
          <input
            className="input"
            value={value.swim || ''}
            onChange={(e) => setFreeTextValue(e.target.value)}
            placeholder="e.g. Peg 12, Old tree swim"
            maxLength={60}
            style={{ marginBottom: 8 }}
          />
          {swimGroups.length > 0 && (
            <button
              type="button"
              onClick={() => { setFreeText(false); setFreeTextValue(''); }}
              style={{
                background: 'transparent', border: 'none', color: 'var(--text-3)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0,
                fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3,
                marginBottom: 14,
              }}
            >
              Or pick a saved swim
            </button>
          )}
          {!swimGroups.length && <div style={{ marginBottom: 14 }} />}
        </>
      )}

      {/* Rod section — only when a swim group is picked. Free-text swims
          can't have rods because there's no group to enumerate from. */}
      {selectedGroup && (
        <>
          <label className="label">Rod (optional)</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 14 }}>
            {selectedGroup.members.map((spot, idx) => {
              const selected = value.rod_spot_id === spot.id;
              const wraps = spot.wraps_actual ?? spot.wraps_calculated ?? calculateWraps(
                spot.swim_latitude, spot.swim_longitude, spot.spot_latitude, spot.spot_longitude,
              );
              const bottom = bottomTypeMeta(spot.bottom_type);
              const title = spot.spot_label || `Rod ${idx + 1}`;
              return (
                <button
                  key={spot.id}
                  type="button"
                  onClick={() => selected
                    ? onChange({ ...value, rod_spot_id: null })
                    : pickRodSpot(spot)
                  }
                  className="tap"
                  style={{
                    padding: '10px 8px', borderRadius: 12,
                    border: `1px solid ${selected ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                    background: selected ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
                    color: selected ? 'var(--gold-2)' : 'var(--text-2)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    minHeight: 52, textAlign: 'left',
                  }}
                >
                  <span>{title}</span>
                  <span style={{ fontSize: 10, color: selected ? 'var(--gold-2)' : 'var(--text-3)', opacity: 0.85, fontWeight: 500 }}>
                    {wraps} wraps{bottom ? ` · ${bottom.emoji}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
