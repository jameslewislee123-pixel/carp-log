'use client';
import { useEffect, useState } from 'react';
import { Archive, Check, ChevronRight, Edit2, Eye, EyeOff, Loader2, Plus, X } from 'lucide-react';
import * as db from '@/lib/db';
import type { GearItem, GearType } from '@/lib/types';

const SECTIONS: { type: GearType; label: string; placeholder: string }[] = [
  { type: 'rig',  label: 'Rigs',  placeholder: 'e.g. Ronnie spinner' },
  { type: 'bait', label: 'Baits', placeholder: 'e.g. 18mm Mainline Cell pop-up' },
  { type: 'hook', label: 'Hooks', placeholder: 'e.g. Size 6 Korda Mugga' },
];

export default function GearManager() {
  const [items, setItems] = useState<GearItem[]>([]);
  const [open, setOpen] = useState<Record<GearType, boolean>>({ rig: false, bait: false, hook: false });
  const [editing, setEditing] = useState<{ type: GearType; item: GearItem | null } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setItems(await db.listMyGear()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ padding: 12, textAlign: 'center' }}><Loader2 size={16} className="spin" style={{ color: 'var(--text-3)' }} /></div>;

  return (
    <>
      {SECTIONS.map(s => {
        const list = items.filter(i => i.type === s.type);
        const isOpen = open[s.type];
        return (
          <div key={s.type} style={{ marginBottom: 10 }}>
            <button onClick={() => setOpen(o => ({ ...o, [s.type]: !o[s.type] }))} className="tap" style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
              color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
            }}>
              <span>{s.label}{list.length > 0 ? ` · ${list.length}` : ''}</span>
              <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
            {isOpen && (
              <div className="fade-in" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map(item => (
                  <GearRow key={item.id} item={item}
                    onEdit={() => setEditing({ type: s.type, item })}
                    onToggleShare={async () => { await db.setGearShared(item.id, !item.shared); load(); }}
                    onArchive={async () => { if (confirm('Archive this item?')) { await db.archiveGearItem(item.id); load(); } }}
                  />
                ))}
                <button onClick={() => setEditing({ type: s.type, item: null })} className="tap" style={{
                  padding: '10px 12px', borderRadius: 12,
                  background: 'transparent', border: '1px dashed rgba(234,201,136,0.3)',
                  color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <Plus size={12} /> Add {s.label.toLowerCase().slice(0, -1)}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {editing && (
        <GearForm
          type={editing.type} item={editing.item}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </>
  );
}

function GearRow({ item, onEdit, onToggleShare, onArchive }: {
  item: GearItem;
  onEdit: () => void;
  onToggleShare: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="card" style={{ padding: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
        {item.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{item.description}</div>}
      </div>
      <button onClick={onToggleShare} title={item.shared ? 'Shared with crew' : 'Private'} style={{
        background: 'transparent', border: 'none', color: item.shared ? 'var(--sage)' : 'var(--text-3)',
        cursor: 'pointer', padding: 4, display: 'inline-flex',
      }}>{item.shared ? <Eye size={14} /> : <EyeOff size={14} />}</button>
      <button onClick={onEdit} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
        <Edit2 size={14} />
      </button>
      <button onClick={onArchive} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
        <Archive size={14} />
      </button>
    </div>
  );
}

function GearForm({ type, item, onClose, onSaved }: {
  type: GearType; item: GearItem | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [desc, setDesc] = useState(item?.description || '');
  const [shared, setShared] = useState(item?.shared || false);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await db.upsertGearItem({ id: item?.id, type, name: name.trim(), description: desc.trim() || null, shared });
      onSaved();
    } catch (e: any) { alert(e?.message || 'Failed to save'); }
    finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(3,10,9,0.7)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', touchAction: 'none',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="slide-up" style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(10,24,22,0.95)',
        backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '24px 24px 0 0', border: '1px solid rgba(234,201,136,0.18)', borderBottom: 'none',
        padding: '20px 20px max(30px, env(safe-area-inset-bottom))',
        touchAction: 'pan-y', overscrollBehavior: 'contain',
      }}>
        <div className="sheet-handle" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 14 }}>
          <h3 className="display-font" style={{ fontSize: 18, margin: 0, fontWeight: 500, textTransform: 'capitalize' }}>{item ? `Edit ${type}` : `New ${type}`}</h3>
          <button onClick={onClose} style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 10, width: 32, height: 32, color: 'var(--text-2)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <label className="label">Name</label>
        <input className="input" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 12 }} />
        <label className="label">Description (optional)</label>
        <textarea className="input" rows={3} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} style={{ marginBottom: 12, resize: 'vertical', fontFamily: 'inherit' }} />
        <label className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 12, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', marginBottom: 16, cursor: 'pointer' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Share with crew</span>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
        </label>
        <button onClick={save} disabled={!name.trim() || busy} className="btn btn-primary" style={{ width: '100%', fontSize: 15, padding: 14 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {item ? 'Save changes' : 'Add'}
        </button>
      </div>
    </div>
  );
}
