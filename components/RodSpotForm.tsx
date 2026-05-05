'use client';
import { useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import * as db from '@/lib/db';
import type { RodSpot } from '@/lib/types';
import { calculateWraps, haversineMeters } from '@/lib/wraps';
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
  lakeId, draft, existing, onClose, onSaved,
}: {
  lakeId: string;
  draft: RodSpotDraft;
  existing?: RodSpot | null;        // present → edit mode
  onClose: () => void;
  onSaved: () => void;
}) {
  const [swimLabel, setSwimLabel] = useState(existing?.swim_label || '');
  const [spotLabel, setSpotLabel] = useState(existing?.spot_label || '');
  const [features, setFeatures] = useState(existing?.features || '');

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
      };
      if (existing) {
        await db.updateRodSpot(existing.id, payload);
      } else {
        await db.createRodSpot(payload);
      }
      onSaved();
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
      onSaved();
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
