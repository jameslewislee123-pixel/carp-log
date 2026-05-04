'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, Plus, Search, X } from 'lucide-react';
import * as db from '@/lib/db';
import type { GearItem, GearType, Profile } from '@/lib/types';

const LABELS: Record<GearType, { single: string; placeholder: string }> = {
  rig:  { single: 'rig',  placeholder: 'Select a rig' },
  bait: { single: 'bait', placeholder: 'Select a bait' },
  hook: { single: 'hook', placeholder: 'Select a hook' },
};

// Combobox: shows current value as text; tap → dropdown to pick from gear DB OR add new.
// Writes the SELECTED ITEM'S NAME back via onChange (back-compat with text storage on catches).
export default function GearItemPicker({ type, value, onChange, meId }: {
  type: GearType;
  value: string;
  onChange: (name: string) => void;
  meId: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GearItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await db.listVisibleGear(type);
      setItems(list);
    } finally { setLoading(false); }
  }
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, type]);

  const { mine, crew } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter(i =>
      !q || i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)
    );
    return {
      mine: filtered.filter(i => i.angler_id === meId),
      crew: filtered.filter(i => i.angler_id !== meId && i.shared),
    };
  }, [items, query, meId]);

  function pick(item: GearItem) {
    onChange(item.name);
    setOpen(false);
  }

  async function saveNew() {
    if (!newName.trim()) return;
    setSavingNew(true);
    try {
      const created = await db.upsertGearItem({ type, name: newName.trim(), description: newDesc.trim() || null, shared: newShared });
      onChange(created.name);
      setOpen(false);
      setAdding(false); setNewName(''); setNewDesc(''); setNewShared(false);
    } catch (e: any) {
      alert(e?.message || 'Failed to add');
    } finally { setSavingNew(false); }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <button onClick={() => setOpen(true)} className="tap" style={{
          flex: 1, minWidth: 0, textAlign: 'left',
          padding: '14px 16px', borderRadius: 14,
          background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
          color: value ? 'var(--text)' : 'var(--text-3)', fontFamily: 'inherit', fontSize: 15,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value || LABELS[type].placeholder}
          </span>
          <ChevronDown size={16} style={{ color: 'var(--text-3)' }} />
        </button>
        {value && (
          <button onClick={() => onChange('')} aria-label={`Clear ${LABELS[type].single}`} className="tap" style={{
            width: 44, flexShrink: 0, padding: 0, borderRadius: 14,
            background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
            color: 'var(--text-3)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={16} />
          </button>
        )}
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(3,10,9,0.7)',
          backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          touchAction: 'none',
        }}>
          <div onClick={(e) => e.stopPropagation()} className="slide-up" style={{
            width: '100%', maxWidth: 480, maxHeight: '78vh',
            background: 'rgba(10,24,22,0.95)',
            backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            borderRadius: '24px 24px 0 0', border: '1px solid rgba(234,201,136,0.18)', borderBottom: 'none',
            padding: '14px 16px max(20px, env(safe-area-inset-bottom))',
            display: 'flex', flexDirection: 'column', minHeight: 0,
            touchAction: 'pan-y', overscrollBehavior: 'contain',
          }}>
            <div className="sheet-handle" style={{ position: 'static', transform: 'none', margin: '0 auto 8px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="display-font" style={{ fontSize: 18, fontWeight: 500, textTransform: 'capitalize' }}>Pick a {LABELS[type].single}</div>
              <button onClick={() => setOpen(false)} style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {!adding && (
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                <input className="input" placeholder="Search…" value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ paddingLeft: 38, fontSize: 14 }} autoCapitalize="none" />
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {loading && <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}><Loader2 size={14} className="spin" /></p>}

              {!loading && !adding && (
                <>
                  {!query.trim() && (
                    <button onClick={() => { onChange(''); setOpen(false); }} className="tap" style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
                      background: !value ? 'rgba(212,182,115,0.10)' : 'rgba(10,24,22,0.5)',
                      border: `1px solid ${!value ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
                      color: 'var(--text-3)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                      fontStyle: 'italic', width: '100%', marginBottom: 8,
                    }}>
                      <span style={{ flex: 1, fontSize: 13 }}>None</span>
                      {!value && <Check size={14} style={{ color: 'var(--gold)' }} />}
                    </button>
                  )}
                  {mine.length > 0 && <div className="label" style={{ marginTop: 6 }}>Yours</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {mine.map(it => <PickRow key={it.id} item={it} active={it.name === value} onClick={() => pick(it)} />)}
                  </div>
                  {crew.length > 0 && <div className="label">Crew (shared)</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {crew.map(it => <PickRow key={it.id} item={it} active={it.name === value} onClick={() => pick(it)} />)}
                  </div>
                  {!mine.length && !crew.length && (
                    <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No {LABELS[type].single}s yet — add one below.</p>
                  )}
                </>
              )}

              {!loading && adding && (
                <div className="fade-in" style={{ paddingTop: 4 }}>
                  <label className="label">Name</label>
                  <input className="input" autoFocus value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)}
                    placeholder={type === 'rig' ? 'e.g. Ronnie spinner' : type === 'bait' ? 'e.g. 18mm Mainline Cell pop-up' : 'e.g. Size 6 Korda Mugga'}
                    style={{ marginBottom: 12 }} />
                  <label className="label">Description (optional)</label>
                  <textarea className="input" rows={2} maxLength={500} value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="e.g. 8&quot; 25lb hooklink, 3oz lead, helicopter setup"
                    style={{ marginBottom: 12, resize: 'vertical', fontFamily: 'inherit' }} />
                  <label className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 12, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', marginBottom: 12, cursor: 'pointer' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Share with crew</span>
                    <input type="checkbox" checked={newShared} onChange={(e) => setNewShared(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setAdding(false); setNewName(''); setNewDesc(''); }}
                      className="btn btn-ghost" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}>Cancel</button>
                    <button onClick={saveNew} disabled={!newName.trim() || savingNew} className="btn btn-primary" style={{ flex: 1 }}>
                      {savingNew ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!adding && (
              <button onClick={() => setAdding(true)} className="tap" style={{
                marginTop: 8, padding: '12px 14px', borderRadius: 12,
                background: 'transparent', border: '1px dashed rgba(234,201,136,0.3)',
                color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Plus size={14} /> Add new {LABELS[type].single}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PickRow({ item, active, onClick }: { item: GearItem; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tap" style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 12,
      background: active ? 'rgba(212,182,115,0.10)' : 'rgba(10,24,22,0.5)',
      border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
      color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
        {item.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.3 }}>{item.description}</div>}
      </div>
      {active && <Check size={14} style={{ color: 'var(--gold)' }} />}
    </button>
  );
}
