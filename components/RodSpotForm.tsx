'use client';
import { useMemo, useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import * as db from '@/lib/db';
import type { RodSpot, GearItem, GearType } from '@/lib/types';
import { calculateWraps, haversineMeters } from '@/lib/wraps';
import { BOTTOM_TYPES, type BottomType } from '@/lib/bottomTypes';
import { useGearItems } from '@/lib/queries';
import { VaulModalShell } from './CarpApp';

// Combined create / edit form for a single rod spot. Lives in a vaul sheet
// so it stacks above the lake-detail modal. The placement step (picking
// the swim and spot lat/lng) happens upstream — by the time this renders
// we already have both points.

export type RodSpotDraft = {
  swim_latitude: number;
  swim_longitude: number;
  spot_latitude: number;
  spot_longitude: number;
};

export default function RodSpotForm({
  lakeId, draft, existing, groupId, initialSwimLabel, onClose, onSaved,
}: {
  lakeId: string;
  draft: RodSpotDraft;
  existing?: RodSpot | null;        // present → edit mode
  // For "add another rod from this swim" — preassign the new row's group
  // id and seed the swim label so sibling rods share both fields.
  groupId?: string | null;
  initialSwimLabel?: string | null;
  onClose: () => void;
  // After a successful save (insert or update) the form passes the saved
  // RodSpot back so the parent can read swim_group_id and offer to add
  // another rod from the same swim.
  onSaved: (saved: RodSpot) => void;
}) {
  const [swimLabel, setSwimLabel] = useState(existing?.swim_label || initialSwimLabel || '');
  const [spotLabel, setSpotLabel] = useState(existing?.spot_label || '');
  const [features, setFeatures] = useState(existing?.features || '');
  const [bottomType, setBottomType] = useState<BottomType | ''>(
    (existing?.bottom_type as BottomType) || '',
  );
  const [defaultBaitId, setDefaultBaitId] = useState<string>(existing?.default_bait_id || '');
  const [defaultRigId, setDefaultRigId] = useState<string>(existing?.default_rig_id || '');
  const [defaultHookId, setDefaultHookId] = useState<string>(existing?.default_hook_id || '');

  const gearQuery = useGearItems();
  const gearByType = useMemo(() => {
    const all = gearQuery.data || [];
    const out: Record<GearType, GearItem[]> = { bait: [], rig: [], hook: [] };
    for (const g of all) {
      if (g.type in out) out[g.type as GearType].push(g);
    }
    return out;
  }, [gearQuery.data]);

  const calculatedWraps = calculateWraps(
    draft.swim_latitude, draft.swim_longitude,
    draft.spot_latitude, draft.spot_longitude,
  );
  const meters = haversineMeters(
    draft.swim_latitude, draft.swim_longitude,
    draft.spot_latitude, draft.spot_longitude,
  );

  // If editing a spot that already has an override, surface it on open so
  // the user sees their saved value (and doesn't silently lose it on save).
  const [editingWraps, setEditingWraps] = useState(existing?.wraps_actual != null);
  const initialActual = existing?.wraps_actual ?? calculatedWraps;
  const [wrapsActual, setWrapsActual] = useState<number | ''>(
    existing?.wraps_actual != null ? existing.wraps_actual : '',
  );

  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const overrideUsed = editingWraps && wrapsActual !== '' && wrapsActual !== calculatedWraps;
      const payload = {
        lake_id: lakeId,
        swim_latitude: draft.swim_latitude,
        swim_longitude: draft.swim_longitude,
        swim_label: swimLabel.trim() || null,
        spot_latitude: draft.spot_latitude,
        spot_longitude: draft.spot_longitude,
        spot_label: spotLabel.trim() || null,
        wraps_calculated: calculatedWraps,
        wraps_actual: overrideUsed ? Number(wrapsActual) : null,
        features: features.trim() || null,
        bottom_type: bottomType || null,
        default_bait_id: defaultBaitId || null,
        default_rig_id: defaultRigId || null,
        default_hook_id: defaultHookId || null,
      };
      let saved: RodSpot;
      if (existing) {
        saved = await db.updateRodSpot(existing.id, payload);
      } else {
        // Inherit caller's group_id when adding a sibling rod; otherwise
        // let the column default mint a fresh group for this solo spot.
        saved = await db.createRodSpot({ ...payload, swim_group_id: groupId || undefined });
      }
      onSaved(saved);
    } catch (e: any) {
      alert(e?.message || 'Failed to save spot');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    if (!confirm('Delete this rod spot?')) return;
    setBusy(true);
    try {
      await db.deleteRodSpot(existing.id);
      onSaved(existing); // pass the row that was deleted so caller can react
    } catch (e: any) {
      alert(e?.message || 'Failed to delete');
    } finally {
      setBusy(false);
    }
  }

  return (
    <VaulModalShell title={existing ? 'Edit rod spot' : 'New rod spot'} onClose={onClose} stackLevel={1}>
      <label className="label">Swim label (optional)</label>
      <input
        className="input"
        value={swimLabel}
        maxLength={40}
        onChange={(e) => setSwimLabel(e.target.value)}
        placeholder="e.g. Peg 12"
        style={{ marginBottom: 12 }}
      />

      <label className="label">Rod spot label (optional)</label>
      <input
        className="input"
        value={spotLabel}
        maxLength={40}
        onChange={(e) => setSpotLabel(e.target.value)}
        placeholder="e.g. Left margin, gravel patch"
        style={{ marginBottom: 14 }}
      />

      <div style={{
        background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.18)',
        borderRadius: 14, padding: 14, marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Distance
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span className="num-display" style={{ fontSize: 28, color: 'var(--gold-2)', lineHeight: 1 }}>
            {editingWraps && wrapsActual !== '' ? wrapsActual : calculatedWraps}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>wraps</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>
            ~{Math.round(meters)}m · 12ft rod
          </span>
        </div>
        {!editingWraps ? (
          <button onClick={() => setEditingWraps(true)} style={{
            background: 'transparent', border: 'none', color: 'var(--gold-2)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0,
            fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3,
          }}>
            Override with measured wraps
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={300}
              value={wrapsActual === '' ? '' : wrapsActual}
              onChange={(e) => {
                const v = e.target.value;
                setWrapsActual(v === '' ? '' : Math.max(1, Math.min(300, Number(v))));
              }}
              placeholder={String(initialActual)}
              className="input"
              style={{ flex: 1 }}
            />
            <button onClick={() => { setEditingWraps(false); setWrapsActual(''); }} style={{
              background: 'transparent', border: '1px solid rgba(234,201,136,0.18)',
              color: 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              padding: '6px 10px', borderRadius: 8, fontFamily: 'inherit',
            }}>
              Use calc
            </button>
          </div>
        )}
      </div>

      <label className="label">Bottom type (optional)</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 14 }}>
        {BOTTOM_TYPES.map(t => {
          const selected = bottomType === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setBottomType(selected ? '' : t.value)}
              className="tap"
              style={{
                padding: '10px 6px', borderRadius: 12,
                border: `1px solid ${selected ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                background: selected ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
                color: selected ? 'var(--gold-2)' : 'var(--text-2)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                minHeight: 56,
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{t.emoji}</span>
              <span style={{ lineHeight: 1.1 }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      <DefaultGearSelect label="Default bait"  type="bait" items={gearByType.bait} value={defaultBaitId} onChange={setDefaultBaitId} />
      <DefaultGearSelect label="Default rig"   type="rig"  items={gearByType.rig}  value={defaultRigId}  onChange={setDefaultRigId}  />
      <DefaultGearSelect label="Default hook"  type="hook" items={gearByType.hook} value={defaultHookId} onChange={setDefaultHookId} />

      <label className="label">Features (optional)</label>
      <textarea
        className="input"
        rows={3}
        maxLength={300}
        value={features}
        onChange={(e) => setFeatures(e.target.value)}
        placeholder="e.g. Gravel patch, weed edge at 47 wraps"
        style={{ marginBottom: 14, resize: 'vertical', fontFamily: 'inherit' }}
      />

      <button onClick={save} disabled={busy} className="btn btn-primary" style={{ width: '100%', fontSize: 15, padding: 14, marginBottom: existing ? 8 : 0 }}>
        {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {existing ? 'Save changes' : 'Save spot'}
      </button>

      {existing && (
        <button onClick={handleDelete} disabled={busy} className="btn btn-ghost" style={{
          width: '100%', fontSize: 13, padding: 12,
          color: '#ff3b30', border: '1px solid rgba(255,59,48,0.4)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Trash2 size={14} /> Delete spot
        </button>
      )}
    </VaulModalShell>
  );
}

function DefaultGearSelect({ label, type, items, value, onChange }: {
  label: string;
  type: GearType;
  items: GearItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <label className="label">{label} (optional)</label>
      {items.length === 0 ? (
        <div style={{
          padding: '10px 12px', borderRadius: 12, marginBottom: 12,
          background: 'rgba(10,24,22,0.5)', border: '1px dashed rgba(234,201,136,0.18)',
          color: 'var(--text-3)', fontSize: 12, lineHeight: 1.4,
        }}>
          No saved {type === 'bait' ? 'baits' : type === 'rig' ? 'rigs' : 'hooks'}. Add some in Settings → Tackle Box.
        </div>
      ) : (
        <select
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ marginBottom: 12, appearance: 'auto', fontFamily: 'inherit' }}
        >
          <option value="">None</option>
          {items.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      )}
    </>
  );
}
