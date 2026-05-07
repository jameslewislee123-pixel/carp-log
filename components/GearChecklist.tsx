'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import * as db from '@/lib/db';
import { CHECKLIST_CATEGORIES } from '@/lib/db';
import type { ChecklistItem, ChecklistRegion } from '@/lib/types';
import SwipeableRow from './SwipeableRow';

type RegionFilter = 'all' | 'uk' | 'france';
type CategoryFilter = 'all' | string;

const REGION_PILLS: Record<Exclude<ChecklistRegion, 'both'>, string> = {
  uk: '🇬🇧',
  france: '🇫🇷',
};

// Body of the gear-checklist screen. Designed to live inside a
// VaulModalShell at stackLevel:1 from Settings — the parent renders the
// header / X. We render: progress bar, filter button, grouped sections,
// add-custom-item, sticky reset.
export default function GearChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [region, setRegion] = useState<RegionFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [showPacked, setShowPacked] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  // Swipe-row state. Only one row reveals its action at a time. The
  // two-tap arming flow mirrors TripMap's Past Setups list: first tap
  // flips the action label to "Confirm?" and starts a 4s auto-revert
  // timer; second tap within that window commits the delete.
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);

  function armConfirm(id: string) {
    setConfirmingId(id);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingId((curr) => curr === id ? null : curr);
    }, 4000);
  }

  async function load() {
    setLoading(true);
    try {
      const seeded = await db.seedChecklistDefaults();
      setItems(seeded);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function togglePacked(item: ChecklistItem) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_packed: !i.is_packed } : i));
    try { await db.setChecklistPacked(item.id, !item.is_packed); }
    catch { setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_packed: item.is_packed } : i)); }
  }

  async function commitDelete(item: ChecklistItem) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingId(null);
    setOpenSwipeId(null);
    setItems(prev => prev.filter(i => i.id !== item.id));
    try { await db.deleteChecklistItem(item.id); } catch { load(); }
  }

  async function doReset() {
    setResetConfirm(false);
    setItems(prev => prev.map(i => ({ ...i, is_packed: false })));
    try { await db.resetChecklistPacked(); } catch { load(); }
  }

  // Filter pipeline: region → category → packed visibility.
  const filtered = useMemo(() => {
    return items.filter(i => {
      if (region === 'uk' && i.region === 'france') return false;
      if (region === 'france' && i.region === 'uk') return false;
      if (category !== 'all' && i.category !== category) return false;
      if (!showPacked && i.is_packed) return false;
      return true;
    });
  }, [items, region, category, showPacked]);

  // Visible total uses the region/category filters but ignores
  // showPacked — the progress count should not lie about how much is
  // left when "show packed" is off.
  const progressScope = useMemo(() => {
    return items.filter(i => {
      if (region === 'uk' && i.region === 'france') return false;
      if (region === 'france' && i.region === 'uk') return false;
      if (category !== 'all' && i.category !== category) return false;
      return true;
    });
  }, [items, region, category]);
  const packedCount = progressScope.filter(i => i.is_packed).length;
  const totalCount = progressScope.length;
  const progressPct = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0;

  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const i of filtered) {
      if (!map.has(i.category)) map.set(i.category, []);
      map.get(i.category)!.push(i);
    }
    // Order: known categories first (in canonical order), then any
    // user-created custom categories alphabetised.
    const known = CHECKLIST_CATEGORIES.filter(c => map.has(c));
    const custom = [...map.keys()].filter(c => !CHECKLIST_CATEGORIES.includes(c)).sort();
    return [...known, ...custom].map(c => ({ category: c, items: map.get(c)! }));
  }, [filtered]);

  const filterCount = (region !== 'all' ? 1 : 0) + (category !== 'all' ? 1 : 0) + (showPacked ? 0 : 1);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600, marginBottom: 6 }}>
            {packedCount} / {totalCount} packed
          </div>
          <div style={{ height: 6, borderRadius: 999, background: 'rgba(20,42,38,0.7)', overflow: 'hidden' }}>
            <div style={{
              width: `${progressPct}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--gold-2), var(--gold))',
              transition: 'width 220ms ease',
            }} />
          </div>
        </div>
        <button
          onClick={() => setFilterOpen(true)}
          aria-label={filterCount > 0 ? `Filter (${filterCount} active)` : 'Filter'}
          className="tap"
          style={{
            position: 'relative', flexShrink: 0,
            width: 40, height: 40, borderRadius: 999,
            background: filterCount > 0 ? 'rgba(212,182,115,0.15)' : 'rgba(239,233,217,0.06)',
            border: `1px solid ${filterCount > 0 ? 'var(--gold)' : 'rgba(239,233,217,0.12)'}`,
            color: filterCount > 0 ? 'var(--gold-2)' : 'var(--text-2)',
            cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <SlidersHorizontal size={18} />
          {filterCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 999, background: 'var(--gold)', color: '#1A1004',
              fontSize: 11, fontWeight: 700, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1.5px solid var(--bg, #050E0D)',
            }}>{filterCount}</span>
          )}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Loader2 size={16} className="spin" style={{ color: 'var(--text-3)' }} /></div>
      ) : grouped.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          No items match these filters.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {grouped.map(({ category: cat, items: list }) => {
            const sectionPacked = list.filter(i => i.is_packed).length;
            const isCollapsed = collapsed[cat];
            return (
              <div key={cat} style={{
                borderRadius: 14, background: 'rgba(10,24,22,0.5)',
                border: '1px solid rgba(234,201,136,0.14)', overflow: 'hidden',
              }}>
                <button
                  onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}
                  className="tap"
                  style={{
                    width: '100%', padding: '12px 14px',
                    background: 'transparent', border: 'none',
                    color: 'var(--text)', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  }}>
                  {isCollapsed
                    ? <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
                    : <ChevronDown size={16} style={{ color: 'var(--text-3)' }} />}
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 600 }}>{cat}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>
                    {sectionPacked} / {list.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div>
                    {list.map(item => {
                      const rowOpen = openSwipeId === item.id;
                      const isConfirming = confirmingId === item.id;
                      return (
                        <SwipeableRow
                          key={item.id}
                          isOpen={rowOpen}
                          onOpen={() => { setOpenSwipeId(item.id); if (confirmingId && confirmingId !== item.id) setConfirmingId(null); }}
                          onClose={() => {
                            if (rowOpen) setOpenSwipeId(null);
                            if (isConfirming) {
                              if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                              setConfirmingId(null);
                            }
                          }}
                          onAction={() => {
                            if (!isConfirming) { armConfirm(item.id); return; }
                            commitDelete(item);
                          }}
                          actionLabel={isConfirming ? 'Confirm?' : 'Delete'}
                          actionColor={isConfirming ? '#ff8276' : '#ff3b30'}
                        >
                          <ChecklistRow
                            item={item}
                            rowOpen={rowOpen}
                            onToggle={() => togglePacked(item)}
                            onCloseSwipe={() => setOpenSwipeId(null)}
                          />
                        </SwipeableRow>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button onClick={() => setShowAdd(true)} className="tap" style={{
        width: '100%', marginTop: 12, padding: '12px 14px', borderRadius: 12,
        background: 'transparent', border: '1px dashed rgba(234,201,136,0.3)',
        color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <Plus size={14} /> Add custom item
      </button>

      <button onClick={() => setResetConfirm(true)} className="tap" style={{
        width: '100%', marginTop: 12, padding: '12px 14px', borderRadius: 12,
        background: 'transparent', border: '1px solid rgba(220,107,88,0.3)',
        color: 'var(--danger)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <RotateCcw size={14} /> Reset all
      </button>

      {filterOpen && (
        <FilterSheet
          region={region} onRegion={setRegion}
          category={category} onCategory={setCategory}
          showPacked={showPacked} onShowPacked={setShowPacked}
          categories={[...new Set(items.map(i => i.category))]}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {showAdd && (
        <AddItemSheet
          onClose={() => setShowAdd(false)}
          onSaved={async (input) => {
            const created = await db.addCustomChecklistItem(input);
            setItems(prev => [...prev, created]);
            setShowAdd(false);
          }}
        />
      )}

      {resetConfirm && (
        <ConfirmSheet
          title="Reset all items?"
          message="Every item on your checklist will be unchecked."
          confirmLabel="Reset"
          danger
          onCancel={() => setResetConfirm(false)}
          onConfirm={doReset}
        />
      )}
    </>
  );
}

// Single row. Tap toggles packed; if the row is currently swiped open
// the first tap closes the swipe instead of toggling — same idiom as
// TripMap / LakesView so users don't accidentally re-tick an item while
// dismissing the delete affordance.
function ChecklistRow({ item, rowOpen, onToggle, onCloseSwipe }: {
  item: ChecklistItem;
  rowOpen: boolean;
  onToggle: () => void;
  onCloseSwipe: () => void;
}) {
  const pill = item.region !== 'both' ? REGION_PILLS[item.region] : null;
  return (
    <button
      onClick={() => { if (rowOpen) { onCloseSwipe(); return; } onToggle(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', width: '100%',
        background: 'rgba(10,24,22,0.5)', border: 'none',
        borderTop: '1px solid rgba(234,201,136,0.08)',
        color: 'inherit', fontFamily: 'inherit',
        cursor: 'pointer', textAlign: 'left',
      }}>
      <span aria-hidden style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        border: `1.5px solid ${item.is_packed ? 'var(--gold)' : 'rgba(234,201,136,0.4)'}`,
        background: item.is_packed ? 'var(--gold)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 160ms ease',
      }}>
        {item.is_packed && <Check size={14} style={{ color: '#1A1004' }} strokeWidth={3} />}
      </span>
      <span style={{
        flex: 1, fontSize: 14,
        color: item.is_packed ? 'var(--text-3)' : 'var(--text)',
        textDecoration: item.is_packed ? 'line-through' : 'none',
        transition: 'color 160ms ease',
      }}>
        {item.name}
      </span>
      {pill && (
        <span style={{
          fontSize: 14, lineHeight: 1, padding: '4px 8px', borderRadius: 999,
          background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)',
        }}>{pill}</span>
      )}
    </button>
  );
}

function FilterSheet({ region, onRegion, category, onCategory, showPacked, onShowPacked, categories, onClose }: {
  region: RegionFilter; onRegion: (r: RegionFilter) => void;
  category: CategoryFilter; onCategory: (c: CategoryFilter) => void;
  showPacked: boolean; onShowPacked: (v: boolean) => void;
  categories: string[];
  onClose: () => void;
}) {
  return (
    <SheetShell title="Filters" onClose={onClose}>
      <div className="label">Region</div>
      <PillRow
        value={region}
        options={[{ id: 'all', label: 'All' }, { id: 'uk', label: '🇬🇧 UK' }, { id: 'france', label: '🇫🇷 France' }]}
        onChange={(v) => onRegion(v as RegionFilter)}
      />

      <div className="label" style={{ marginTop: 16 }}>Category</div>
      <PillRow
        value={category}
        options={[{ id: 'all', label: 'All' }, ...categories.map(c => ({ id: c, label: c }))]}
        onChange={(v) => onCategory(v)}
      />

      <label className="tap" style={{
        marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 12, borderRadius: 12,
        background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
        cursor: 'pointer',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Show packed items</span>
        <input type="checkbox" checked={showPacked} onChange={(e) => onShowPacked(e.target.checked)}
          style={{ accentColor: 'var(--gold)' }} />
      </label>
    </SheetShell>
  );
}

function PillRow({ value, options, onChange }: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} className="tap" style={{
            padding: '8px 12px', borderRadius: 999,
            border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
            background: active ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
            color: active ? 'var(--gold-2)' : 'var(--text-2)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function AddItemSheet({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: (input: { name: string; category: string; region: ChecklistRegion }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(CHECKLIST_CATEGORIES[0]);
  const [region, setRegion] = useState<ChecklistRegion>('both');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onSaved({ name: name.trim(), category, region }); }
    catch (e: any) { alert(e?.message || 'Failed to add'); }
    finally { setBusy(false); }
  }

  return (
    <SheetShell title="New item" onClose={onClose}>
      <label className="label">Name</label>
      <input className="input" autoFocus value={name} maxLength={80}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. My lucky hat"
        style={{ marginBottom: 12 }} />

      <label className="label">Category</label>
      <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}
        style={{ marginBottom: 12 }}>
        {CHECKLIST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <label className="label">Region</label>
      <PillRow
        value={region}
        options={[
          { id: 'both', label: 'Both' },
          { id: 'uk', label: '🇬🇧 UK' },
          { id: 'france', label: '🇫🇷 France' },
        ]}
        onChange={(v) => setRegion(v as ChecklistRegion)}
      />

      <button onClick={save} disabled={!name.trim() || busy} className="btn btn-primary"
        style={{ marginTop: 18, width: '100%', fontSize: 15, padding: 14 }}>
        {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Add
      </button>
    </SheetShell>
  );
}

function ConfirmSheet({ title, message, confirmLabel, danger, onCancel, onConfirm }: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <SheetShell title={title} onClose={onCancel}>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 18px', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="tap" style={{
          flex: 1, padding: 12, borderRadius: 12,
          background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)',
          color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={onConfirm} className="tap" style={{
          flex: 1, padding: 12, borderRadius: 12,
          background: danger ? 'rgba(220,107,88,0.14)' : 'var(--gold)',
          border: `1px solid ${danger ? 'rgba(220,107,88,0.4)' : 'var(--gold)'}`,
          color: danger ? 'var(--danger)' : '#1A1004',
          fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          {danger && <Trash2 size={14} />} {confirmLabel}
        </button>
      </div>
    </SheetShell>
  );
}

// Lightweight bottom-sheet shell. Mirrors the inline pattern used by
// GearForm in GearManager — sits above the parent VaulModalShell at a
// higher z-index so it stacks correctly.
function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 130,
      background: 'rgba(3,10,9,0.7)',
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
          <h3 className="display-font" style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 10, width: 32, height: 32, color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
