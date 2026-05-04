'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, Check, Loader2, MapPinned, Plus, Trash2, X } from 'lucide-react';
import * as db from '@/lib/db';
import type { Catch, Lake, LakeAnnotation, LakeAnnotationType, Profile } from '@/lib/types';
import { formatWeight, totalOz } from '@/lib/util';
import { geocodeLake } from '@/lib/weather';

const ANN_TYPES: { id: LakeAnnotationType; label: string; emoji: string }[] = [
  { id: 'hot_spot',        label: 'Hot spot',   emoji: '🔥' },
  { id: 'productive_spot', label: 'Productive', emoji: '⭐' },
  { id: 'snag',            label: 'Snag',       emoji: '⚠️' },
  { id: 'note',            label: 'Note',       emoji: '📍' },
];

const MapInner = dynamic(() => import('./LakeMapInner'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '52vh', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div>
  ),
});

export default function LakeDetail({ lake, lakeCatches, profilesById, me, onClose, onOpenCatch }: {
  lake: Lake;
  lakeCatches: Catch[];
  profilesById: Record<string, Profile>;
  me: Profile;
  onClose: () => void;
  onOpenCatch: (c: Catch) => void;
}) {
  const [annos, setAnnos] = useState<LakeAnnotation[]>([]);
  const [filter, setFilter] = useState<'all' | LakeAnnotationType>('all');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    lake.latitude != null && lake.longitude != null ? { lat: lake.latitude, lng: lake.longitude } : null
  );
  const [dropMode, setDropMode] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ lat: number; lng: number } | null>(null);
  const [openAnno, setOpenAnno] = useState<LakeAnnotation | null>(null);

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  async function refreshAnnos() {
    setAnnos(await db.listLakeAnnotations(lake.id));
  }
  useEffect(() => { refreshAnnos(); /* eslint-disable-next-line */ }, [lake.id]);

  // Resolve a center if the lake has none yet (geocode by name).
  useEffect(() => {
    if (center) return;
    let cancelled = false;
    (async () => {
      const fromCatches = lakeCatches.find(c => c.latitude != null && c.longitude != null);
      if (fromCatches) {
        if (!cancelled) setCenter({ lat: fromCatches.latitude!, lng: fromCatches.longitude! });
        return;
      }
      const g = await geocodeLake(lake.name);
      if (!cancelled) setCenter(g || { lat: 52.05, lng: -0.7 });
    })();
    return () => { cancelled = true; };
  }, [lake.id]); // eslint-disable-line

  const stats = useMemo(() => {
    const landed = lakeCatches.filter(c => !c.lost);
    const biggest = landed.reduce<Catch | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    const totalOzAll = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
    const distinctAnglers = new Set(landed.map(c => c.angler_id)).size;
    return { count: landed.length, biggest, totalOzAll, distinctAnglers };
  }, [lakeCatches]);

  const visibleAnnos = filter === 'all' ? annos : annos.filter(a => a.type === filter);
  const myCatchesHere = lakeCatches.filter(c => c.angler_id === me.id).length;
  const canAnnotate = myCatchesHere > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(3,10,9,0.85)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      touchAction: 'none',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="slide-up" style={{
        width: '100%', maxWidth: 480, maxHeight: '94vh',
        background: 'rgba(10,24,22,0.95)',
        backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '28px 28px 0 0', border: '1px solid rgba(234,201,136,0.14)', borderBottom: 'none',
        overflowY: 'auto', overflowX: 'hidden',
        padding: '20px 20px max(40px, env(safe-area-inset-bottom))',
        touchAction: 'pan-y', overscrollBehavior: 'contain',
      }}>
        <div className="sheet-handle" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingTop: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, padding: 4, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer' }}>
            <ArrowLeft size={18} /> Back
          </button>
        </div>

        {lake.photo_url ? (
          <div style={{
            position: 'relative', width: '100%', height: 200, marginBottom: 14,
            borderRadius: 18, overflow: 'hidden',
            border: '1px solid rgba(234,201,136,0.18)',
            background: 'rgba(10,24,22,0.6)',
          }}>
            <img src={lake.photo_url} alt="" style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(5,14,13,0.0) 30%, rgba(5,14,13,0.85) 100%)',
            }} />
            {lake.photo_source === 'satellite' && (
              <span style={{
                position: 'absolute', top: 10, left: 10,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                padding: '3px 7px', borderRadius: 6,
                background: 'rgba(5,14,13,0.85)', color: 'rgba(234,201,136,0.85)',
                border: '1px solid rgba(234,201,136,0.25)',
              }}>Satellite</span>
            )}
            <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700, marginBottom: 4, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>Lake</div>
              <h2 className="display-font" style={{ fontSize: 26, margin: 0, fontWeight: 500, lineHeight: 1.1, color: 'var(--text)', textShadow: '0 2px 12px rgba(0,0,0,0.7)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MapPinned size={18} style={{ color: 'var(--gold)' }} />
                {lake.name}
              </h2>
              {(lake.region || lake.country) && (
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                  {[lake.region, lake.country].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700, marginBottom: 4 }}>Lake</div>
            <h2 className="display-font" style={{ fontSize: 28, margin: 0, fontWeight: 500, lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <MapPinned size={20} style={{ color: 'var(--gold)' }} />
              {lake.name}
            </h2>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          <Stat label="Fish" value={stats.count} />
          <Stat label="Biggest" value={stats.biggest ? formatWeight(stats.biggest.lbs, stats.biggest.oz) : '—'} />
          <Stat label="Anglers" value={stats.distinctAnglers} />
        </div>

        {center && (
          <MapInner
            center={center}
            catches={lakeCatches}
            annotations={annos}
            profilesById={profilesById}
            dropMode={dropMode}
            onDropPick={(lat, lng) => { setPendingDrop({ lat, lng }); setDropMode(false); }}
            onOpenCatch={onOpenCatch}
            onOpenAnnotation={setOpenAnno}
          />
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {canAnnotate ? (
            <button onClick={() => setDropMode(d => !d)} className="tap" style={{
              padding: '10px 14px', borderRadius: 999,
              border: `1px solid ${dropMode ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: dropMode ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
              color: dropMode ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Plus size={12} /> {dropMode ? 'Tap map to place…' : 'Add annotation'}
            </button>
          ) : (
            <div style={{
              padding: '10px 14px', borderRadius: 12, background: 'rgba(10,24,22,0.5)',
              border: '1px dashed rgba(234,201,136,0.18)', color: 'var(--text-3)',
              fontSize: 12, lineHeight: 1.4,
            }}>
              You haven't fished here yet. Annotations are visible to anglers who have.
            </div>
          )}
        </div>

        {/* filter chips */}
        <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 14, paddingBottom: 4 }}>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
          {ANN_TYPES.map(t => (
            <FilterChip key={t.id} active={filter === t.id} onClick={() => setFilter(t.id)}>
              {t.emoji} {t.label}
            </FilterChip>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {visibleAnnos.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
              No annotations{filter !== 'all' ? ' of this type' : ''} yet.
            </p>
          ) : visibleAnnos.map(a => {
            const author = profilesById[a.angler_id];
            const isMine = a.angler_id === me.id;
            const t = ANN_TYPES.find(x => x.id === a.type);
            return (
              <div key={a.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ fontSize: 18 }}>{t?.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</div>
                  {a.description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.3 }}>{a.description}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    by {author?.display_name || 'Unknown'}
                  </div>
                </div>
                {isMine && (
                  <button onClick={async () => {
                    if (confirm('Delete this annotation?')) { await db.deleteLakeAnnotation(a.id); refreshAnnos(); }
                  }} style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {pendingDrop && (
        <NewAnnotationForm lakeId={lake.id} lat={pendingDrop.lat} lng={pendingDrop.lng}
          onClose={() => setPendingDrop(null)}
          onSaved={() => { setPendingDrop(null); refreshAnnos(); }}
        />
      )}
      {openAnno && (
        <AnnotationDetail anno={openAnno} author={profilesById[openAnno.angler_id]} onClose={() => setOpenAnno(null)} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', borderRadius: 14, padding: 12, textAlign: 'center' }}>
      <div className="num-display" style={{ fontSize: 20, color: 'var(--gold-2)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="tap" style={{
      flexShrink: 0, padding: '6px 12px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
      background: active ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
      color: active ? 'var(--gold-2)' : 'var(--text-2)',
      fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

function NewAnnotationForm({ lakeId, lat, lng, onClose, onSaved }: {
  lakeId: string; lat: number; lng: number; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<LakeAnnotationType>('productive_spot');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await db.createLakeAnnotation({ lake_id: lakeId, type, latitude: lat, longitude: lng, title: title.trim(), description: desc.trim() || null });
      onSaved();
    } catch (e: any) { alert(e?.message || 'Failed to save'); }
    finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(3,10,9,0.7)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', touchAction: 'none',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="slide-up" style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(10,24,22,0.95)',
        backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '24px 24px 0 0', border: '1px solid rgba(234,201,136,0.18)', borderBottom: 'none',
        padding: '20px 20px max(30px, env(safe-area-inset-bottom))',
        touchAction: 'pan-y',
      }}>
        <div className="sheet-handle" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 14 }}>
          <h3 className="display-font" style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>New annotation</h3>
          <button onClick={onClose} style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 10, width: 32, height: 32, color: 'var(--text-2)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <label className="label">Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 12 }}>
          {ANN_TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)} className="tap" style={{
              padding: '10px 6px', borderRadius: 12,
              border: `1px solid ${type === t.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: type === t.id ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
              color: type === t.id ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>{t.emoji} {t.label}</button>
          ))}
        </div>

        <label className="label">Title</label>
        <input className="input" autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Margin shelf, big-fish bay" style={{ marginBottom: 12 }} />

        <label className="label">Description (optional)</label>
        <textarea className="input" rows={3} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="Anything useful for next time…" style={{ marginBottom: 12, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>{lat.toFixed(5)}, {lng.toFixed(5)}</div>

        <button onClick={save} disabled={!title.trim() || busy} className="btn btn-primary" style={{ width: '100%', fontSize: 15, padding: 14 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Drop pin
        </button>
      </div>
    </div>
  );
}

function AnnotationDetail({ anno, author, onClose }: { anno: LakeAnnotation; author?: Profile; onClose: () => void }) {
  const t = ANN_TYPES.find(x => x.id === anno.type);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(3,10,9,0.7)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, touchAction: 'none',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card fade-in" style={{ padding: 18, maxWidth: 360, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>{t?.emoji}</span>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-2)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t?.label}</div>
        </div>
        <div className="display-font" style={{ fontSize: 20, fontWeight: 500, marginBottom: 6 }}>{anno.title}</div>
        {anno.description && <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.4, margin: '0 0 10px' }}>{anno.description}</p>}
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>by {author?.display_name || 'Unknown'}</div>
        <button onClick={onClose} className="btn btn-ghost" style={{ width: '100%', marginTop: 14, border: '1px solid rgba(234,201,136,0.18)' }}>Close</button>
      </div>
    </div>
  );
}
