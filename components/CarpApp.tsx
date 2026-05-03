'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Camera, Plus, Trophy, Images, Settings, X, Check, Fish, MapPin, Calendar,
  Edit2, Trash2, ChevronRight, Loader2, Download, ArrowLeft, Sparkles, Crown,
  Cloud, Wind, Thermometer, MessageCircle, Bell, Send, Anchor, BarChart3,
  Clock, Tent, MapPinned, Moon as MoonIcon, Star,
} from 'lucide-react';

import { hasSupabase, supabase } from '@/lib/supabase';
import * as db from '@/lib/db';
import type {
  Angler, Catch as CatchT, Comment, Moon as MoonT, NotifyConfig, Trip, Weather,
} from '@/lib/types';
import {
  formatDate, formatDateRange, formatWeight, totalOz, compressImage, sendTelegram,
} from '@/lib/util';
import {
  getMoonIllumination, getMoonPhaseLabel, getMoonTimes, getSolunarWindows,
  isInSolunarWindow, getBiteRating,
} from '@/lib/suncalc';
import { fetchWeatherFor, geocodeLake, getCurrentLocation } from '@/lib/weather';

// ============ CONSTANTS ============
const SPECIES = [
  { id: 'common',  label: 'Common',  hue: '#B07A3F' },
  { id: 'mirror',  label: 'Mirror',  hue: '#C9A961' },
  { id: 'leather', label: 'Leather', hue: '#7A5A2E' },
  { id: 'ghost',   label: 'Ghost',   hue: '#D8D2C0' },
  { id: 'koi',     label: 'Koi',     hue: '#D85B47' },
  { id: 'other',   label: 'Other',   hue: '#8A9D96' },
];
const ANGLER_COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4'];
const WEATHER_CONDITIONS = [
  { id: 'sunny',     label: 'Sunny',     icon: '☀️' },
  { id: 'cloudy',    label: 'Cloudy',    icon: '☁️' },
  { id: 'overcast',  label: 'Overcast',  icon: '🌥️' },
  { id: 'rain',      label: 'Rain',      icon: '🌧️' },
  { id: 'storm',     label: 'Storm',     icon: '⛈️' },
  { id: 'mist',      label: 'Mist',      icon: '🌫️' },
];
const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ME_KEY = 'carp_log_me_v1';
const LOC_KEY = 'carp_log_loc_v1'; // recent geo cache

// ============ ROOT ============
export default function CarpApp() {
  const [loading, setLoading] = useState(true);
  const [anglers, setAnglers] = useState<Angler[]>([]);
  const [me, setMe] = useState<{ anglerId: string } | null>(null);
  const [catches, setCatches] = useState<CatchT[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [notify, setNotify] = useState<NotifyConfig | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [view, setView] = useState<'feed' | 'trips' | 'stats' | 'gallery'>('feed');
  const [showAdd, setShowAdd] = useState(false);
  const [detailCatch, setDetailCatch] = useState<CatchT | null>(null);
  const [detailTrip, setDetailTrip] = useState<Trip | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    if (!hasSupabase) {
      setSetupError('Supabase env vars are missing. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [a, t, c, n] = await Promise.all([
          db.listAnglers(), db.listTrips(), db.listCatches(), db.getNotify(),
        ]);
        setAnglers(a); setTrips(t); setCatches(c); setNotify(n);
        const meRaw = typeof window !== 'undefined' ? localStorage.getItem(ME_KEY) : null;
        const meParsed = meRaw ? JSON.parse(meRaw) : null;
        const meValid = meParsed && a.find(x => x.id === meParsed.anglerId) ? meParsed : null;
        setMe(meValid);
        if (a.length === 0 || !meValid) setShowOnboard(true);
      } catch (e: any) {
        setSetupError(e?.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Realtime subscriptions
  useEffect(() => {
    if (!hasSupabase) return;
    const ch = supabase
      .channel('carp-log-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catches' }, async () => {
        try { setCatches(await db.listCatches()); } catch {}
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, async () => {
        try { setTrips(await db.listTrips()); } catch {}
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'anglers' }, async () => {
        try { setAnglers(await db.listAnglers()); } catch {}
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notify_config' }, async () => {
        try { setNotify(await db.getNotify()); } catch {}
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const getPhoto = useCallback(async (id: string) => {
    if (photos[id]) return photos[id];
    const p = await db.getPhoto(id);
    if (p) setPhotos(prev => ({ ...prev, [id]: p }));
    return p;
  }, [photos]);

  const meAngler = anglers.find(a => a.id === me?.anglerId) || null;

  const activeTrips = useMemo(() => trips.filter(t => {
    const now = Date.now();
    return new Date(t.start_date).getTime() <= now && new Date(t.end_date).getTime() >= now - 86400000;
  }), [trips]);

  // Save catch (with telegram + photo)
  async function saveCatch(input: db.CatchInput, photo: string | null, isNew: boolean) {
    const saved = await db.upsertCatch(input);
    if (photo) {
      await db.setPhoto(saved.id, photo);
      setPhotos(prev => ({ ...prev, [saved.id]: photo }));
    }
    if (isNew && notify?.enabled) {
      const angler = anglers.find(a => a.id === saved.angler_id);
      const species = SPECIES.find(s => s.id === saved.species);
      let msg: string;
      if (saved.lost) {
        msg = `💔 <b>${angler?.name || ''}</b> lost one${saved.swim ? ` at swim ${saved.swim}` : ''}${saved.rig ? ` on a ${saved.rig}` : ''}`;
      } else {
        msg = `🎣 <b>${angler?.name || ''}</b> just banked <b>${formatWeight(saved.lbs, saved.oz)}</b>${species ? ` ${species.label.toLowerCase()}` : ''}${saved.lake ? ` at ${saved.lake}` : ''}${saved.swim ? ` (swim ${saved.swim})` : ''}`;
        if (saved.bait) msg += `\n🎯 Bait: ${saved.bait}`;
      }
      sendTelegram({ token: notify.token, chat_id: notify.chat_id, enabled: notify.enabled }, msg);
    }
    return saved;
  }
  async function deleteCatchHandler(id: string) {
    await db.deleteCatch(id);
    setPhotos(prev => { const n = { ...prev }; delete n[id]; return n; });
  }
  async function addComment(catchId: string, text: string) {
    if (!me) return;
    const angler = anglers.find(a => a.id === me.anglerId);
    if (!angler) return;
    const cur = catches.find(c => c.id === catchId);
    const next: Comment[] = [...(cur?.comments || []), {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      anglerId: me.anglerId, anglerName: angler.name, text, ts: Date.now(),
    }];
    await db.setComments(catchId, next);
    if (detailCatch?.id === catchId) setDetailCatch(d => d ? { ...d, comments: next } : d);
  }
  async function deleteComment(catchId: string, commentId: string) {
    const cur = catches.find(c => c.id === catchId);
    const next = (cur?.comments || []).filter(x => x.id !== commentId);
    await db.setComments(catchId, next);
    if (detailCatch?.id === catchId) setDetailCatch(d => d ? { ...d, comments: next } : d);
  }
  async function saveTripHandler(input: Partial<Trip> & { name: string; start_date: string; end_date: string }) {
    await db.upsertTrip(input);
  }
  async function deleteTripHandler(id: string) { await db.deleteTrip(id); }
  async function saveNotifyHandler(n: NotifyConfig) { await db.setNotify(n); setNotify(n); }
  async function saveMeHandler(m: { anglerId: string }) {
    setMe(m); localStorage.setItem(ME_KEY, JSON.stringify(m));
  }
  async function saveAnglersHandler(rows: Angler[]) {
    await db.updateAnglers(rows);
    setAnglers(await db.listAnglers());
  }

  if (setupError) {
    return (
      <div className="app-root">
        <div className="app-content" style={{ padding: 24 }}>
          <h1 className="display-font" style={{ fontSize: 28, color: 'var(--gold-2)' }}>Carp Log</h1>
          <p style={{ color: 'var(--text-2)' }}>{setupError}</p>
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
            Add your env vars on Vercel and redeploy, or copy <code>.env.local.example</code> to <code>.env.local</code>.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-root">
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <Fish size={48} style={{ color: 'var(--gold)' }} />
          <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
        </div>
      </div>
    );
  }

  if (showOnboard) {
    return (
      <Onboarding
        existingAnglers={anglers}
        onComplete={async (newAnglers, meId) => {
          if (anglers.length === 0) {
            const created = await db.bulkSetAnglers(newAnglers.map(a => ({ name: a.name, color: a.color })));
            setAnglers(created);
            const target = created.find(c => c.name === newAnglers.find(x => x.tempId === meId)?.name);
            if (target) {
              const m = { anglerId: target.id };
              setMe(m); localStorage.setItem(ME_KEY, JSON.stringify(m));
            }
          } else {
            const m = { anglerId: meId };
            setMe(m); localStorage.setItem(ME_KEY, JSON.stringify(m));
          }
          setShowOnboard(false);
        }}
      />
    );
  }

  return (
    <div className="app-root">
      <div className="app-content">
        <Header me={meAngler} onSettings={() => setShowSettings(true)} view={view} />

        {view === 'feed' && (
          <Feed
            catches={catches} trips={trips} anglers={anglers} photos={photos} getPhoto={getPhoto}
            onOpen={setDetailCatch} onOpenTrip={setDetailTrip}
          />
        )}
        {view === 'trips' && (
          <TripsView
            trips={trips} catches={catches}
            onOpenTrip={setDetailTrip}
            onAddTrip={() => { setEditTrip(null); setShowAddTrip(true); }}
          />
        )}
        {view === 'stats' && (
          <Stats catches={catches} anglers={anglers} photos={photos} getPhoto={getPhoto} onOpen={setDetailCatch} />
        )}
        {view === 'gallery' && (
          <Gallery catches={catches} photos={photos} getPhoto={getPhoto} onOpen={setDetailCatch} />
        )}
      </div>

      <FAB onClick={() => setShowAdd(true)} />
      <BottomNav view={view} onChange={setView} />

      {showAdd && me && (
        <AddCatchModal
          anglers={anglers} me={me} trips={trips} activeTrips={activeTrips}
          onClose={() => setShowAdd(false)}
          onSave={async (data, photo) => { await saveCatch(data, photo, true); setShowAdd(false); }}
        />
      )}

      {detailCatch && me && (
        <CatchDetail
          catchData={detailCatch} photo={photos[detailCatch.id]}
          getPhoto={getPhoto} anglers={anglers} me={me} trips={trips}
          onClose={() => setDetailCatch(null)}
          onDelete={async () => {
            if (confirm('Delete this catch?')) { await deleteCatchHandler(detailCatch.id); setDetailCatch(null); }
          }}
          onUpdate={async (data, photo) => {
            const saved = await saveCatch({ ...data, id: detailCatch.id }, photo, false);
            setDetailCatch(saved);
          }}
          onAddComment={(text) => addComment(detailCatch.id, text)}
          onDeleteComment={(cid) => deleteComment(detailCatch.id, cid)}
          onOpenTrip={(t) => { setDetailCatch(null); setDetailTrip(t); }}
        />
      )}

      {detailTrip && (
        <TripDetail
          trip={detailTrip} catches={catches} anglers={anglers} photos={photos} getPhoto={getPhoto}
          onClose={() => setDetailTrip(null)}
          onEdit={() => { setEditTrip(detailTrip); setShowAddTrip(true); setDetailTrip(null); }}
          onDelete={async () => {
            if (confirm('Delete this trip? Catches will stay but become unlinked.')) {
              await deleteTripHandler(detailTrip.id); setDetailTrip(null);
            }
          }}
          onOpenCatch={setDetailCatch}
        />
      )}

      {showAddTrip && (
        <AddTripModal
          existing={editTrip}
          onClose={() => { setShowAddTrip(false); setEditTrip(null); }}
          onSave={async (data) => { await saveTripHandler(data); setShowAddTrip(false); setEditTrip(null); }}
        />
      )}

      {showSettings && me && (
        <SettingsModal
          anglers={anglers} me={me} catches={catches} trips={trips} notify={notify}
          onClose={() => setShowSettings(false)}
          onSaveAnglers={saveAnglersHandler}
          onSaveMe={saveMeHandler}
          onSaveNotify={saveNotifyHandler}
        />
      )}
    </div>
  );
}

// ============ ONBOARDING ============
function Onboarding({
  existingAnglers,
  onComplete,
}: {
  existingAnglers: Angler[];
  onComplete: (anglers: { tempId: string; name: string; color: string }[], meId: string) => void;
}) {
  const [step, setStep] = useState(existingAnglers.length > 0 ? 1 : 0);
  const initial = existingAnglers.length > 0
    ? existingAnglers.map(a => ({ tempId: a.id, name: a.name, color: a.color }))
    : [
        { tempId: 'a1', name: '', color: ANGLER_COLORS[0] },
        { tempId: 'a2', name: '', color: ANGLER_COLORS[1] },
        { tempId: 'a3', name: '', color: ANGLER_COLORS[2] },
      ];
  const [anglers, setAnglers] = useState(initial);
  const [meTempId, setMeTempId] = useState<string | null>(null);

  return (
    <div className="app-root">
      <div className="app-content" style={{ padding: '60px 24px 40px' }}>
        {step === 0 && (
          <div className="fade-in">
            <Fish size={40} style={{ color: 'var(--gold)', marginBottom: 24 }} />
            <h1 className="display-font" style={{ fontSize: 38, lineHeight: 1.05, margin: '0 0 12px', fontWeight: 500, letterSpacing: '-0.02em' }}>The Carp Log</h1>
            <p style={{ color: 'var(--text-2)', fontSize: 16, margin: '0 0 32px', lineHeight: 1.5 }}>
              Track every fish, every trip. Shared between you and your mates in real time.
            </p>
            <label className="label">Your fishing crew</label>
            <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: -4, marginBottom: 16 }}>
              Add the names of everyone in your group. You can edit these later.
            </p>
            {anglers.map((a, i) => (
              <div key={a.tempId} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: a.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1A1004', fontWeight: 700 }}>
                  {a.name ? a.name[0].toUpperCase() : '?'}
                </div>
                <input
                  className="input" placeholder={`Angler ${i + 1}`} value={a.name}
                  onChange={(e) => { const n = [...anglers]; n[i] = { ...n[i], name: e.target.value }; setAnglers(n); }}
                />
              </div>
            ))}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 24, fontSize: 16, padding: '16px' }}
              disabled={!anglers.every(a => a.name.trim())}
              onClick={() => setStep(1)}
            >
              Continue <ChevronRight size={18} />
            </button>
          </div>
        )}
        {step === 1 && (
          <div className="fade-in">
            <Sparkles size={32} style={{ color: 'var(--gold)', marginBottom: 24 }} />
            <h1 className="display-font" style={{ fontSize: 32, lineHeight: 1.1, margin: '0 0 12px', fontWeight: 500, letterSpacing: '-0.02em' }}>Which one are you?</h1>
            <p style={{ color: 'var(--text-2)', fontSize: 15, margin: '0 0 32px' }}>We'll attribute your catches automatically on this device.</p>
            {anglers.map(a => (
              <button
                key={a.tempId} className="tap"
                onClick={() => setMeTempId(a.tempId)}
                style={{
                  width: '100%', padding: 16, marginBottom: 10,
                  background: meTempId === a.tempId ? 'rgba(212,182,115,0.10)' : 'rgba(20,42,38,0.55)',
                  border: `1px solid ${meTempId === a.tempId ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
                  backdropFilter: 'blur(12px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(12px) saturate(180%)',
                  borderRadius: 16, display: 'flex', alignItems: 'center', gap: 14,
                  cursor: 'pointer', textAlign: 'left', color: 'var(--text)', fontFamily: 'inherit',
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1A1004', fontWeight: 700, fontSize: 18 }}>
                  {a.name[0]?.toUpperCase()}
                </div>
                <span style={{ flex: 1, fontSize: 17, fontWeight: 500 }}>{a.name}</span>
                {meTempId === a.tempId && <Check size={20} style={{ color: 'var(--gold)' }} />}
              </button>
            ))}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 24, fontSize: 16, padding: '16px' }}
              disabled={!meTempId}
              onClick={() => meTempId && onComplete(anglers, meTempId)}
            >
              Start tracking <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ HEADER ============
function Header({ me, onSettings, view }: { me: Angler | null; onSettings: () => void; view: string }) {
  const titles: Record<string, string> = { feed: 'The Log', trips: 'Trips', stats: 'The Board', gallery: 'Gallery' };
  return (
    <div style={{ padding: '24px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>Carp Tracker</div>
        <h1 className="display-font" style={{ fontSize: 30, margin: '2px 0 0', fontWeight: 500, letterSpacing: '-0.02em' }}>{titles[view]}</h1>
      </div>
      <button
        onClick={onSettings} className="tap"
        style={{
          width: 42, height: 42, borderRadius: 14,
          background: me?.color || 'var(--bg-2)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#1A1004', fontWeight: 700, fontSize: 16,
          boxShadow: '0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3)',
        }}
      >
        {me?.name?.[0]?.toUpperCase() || <Settings size={18} />}
      </button>
    </div>
  );
}

// ============ FEED ============
function Feed({
  catches, trips, anglers, photos, getPhoto, onOpen, onOpenTrip,
}: {
  catches: CatchT[]; trips: Trip[]; anglers: Angler[]; photos: Record<string, string>;
  getPhoto: (id: string) => Promise<string | null>;
  onOpen: (c: CatchT) => void; onOpenTrip: (t: Trip) => void;
}) {
  const [filter, setFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    const sorted = [...catches].sort((a, b) => +new Date(b.date) - +new Date(a.date));
    if (filter === 'all') return sorted;
    return sorted.filter(c => c.angler_id === filter);
  }, [catches, filter]);

  const activeTrip = useMemo(() => {
    const now = Date.now();
    return trips.find(t => +new Date(t.start_date) <= now && +new Date(t.end_date) >= now - 86400000);
  }, [trips]);

  return (
    <div style={{ padding: '8px 20px' }}>
      <BiteForecast catches={catches} />
      {activeTrip && (
        <ActiveTripBanner trip={activeTrip} catches={catches} onClick={() => onOpenTrip(activeTrip)} />
      )}
      <div className="scrollbar-thin" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All catches</Chip>
        {anglers.map(a => (
          <Chip key={a.id} active={filter === a.id} onClick={() => setFilter(a.id)} color={a.color}>{a.name}</Chip>
        ))}
      </div>
      {filtered.length === 0 ? <EmptyState /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map(c => (
            <CatchCard
              key={c.id} catchData={c}
              angler={anglers.find(a => a.id === c.angler_id) || null}
              trip={c.trip_id ? trips.find(t => t.id === c.trip_id) || null : null}
              photo={photos[c.id]} getPhoto={getPhoto}
              onClick={() => onOpen(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ BITE FORECAST ============
function BiteForecast({ catches }: { catches: CatchT[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Pick coords: prefer GPS, fallback to last lake from catches, fallback London
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(LOC_KEY) : null;
      if (stored) { try { const j = JSON.parse(stored); if (!cancelled) setCoords(j); return; } catch {} }
      const gps = await getCurrentLocation();
      if (gps) {
        if (!cancelled) {
          setCoords(gps);
          localStorage.setItem(LOC_KEY, JSON.stringify(gps));
        }
        return;
      }
      const lastWithLake = [...catches].reverse().find(c => c.lake);
      if (lastWithLake?.lake) {
        const g = await geocodeLake(lastWithLake.lake);
        if (g && !cancelled) {
          setCoords(g);
          localStorage.setItem(LOC_KEY, JSON.stringify(g));
          return;
        }
      }
      if (!cancelled) setCoords({ lat: 52.05, lng: -0.7 }); // UK midlands fallback
    })();
    return () => { cancelled = true; };
  }, [catches.length]);

  const data = useMemo(() => {
    if (!coords) return null;
    const now = new Date();
    const ill = getMoonIllumination(now);
    const phaseInfo = getMoonPhaseLabel(ill.phase);
    const rating = getBiteRating(now, coords.lat, coords.lng);
    const windows = getSolunarWindows(now, coords.lat, coords.lng);
    const cur = isInSolunarWindow(now, windows);
    const upcoming = windows.filter(w => w.start.getTime() > now.getTime()).slice(0, 1)[0] || null;
    return { ill, phaseInfo, rating, windows, cur, upcoming };
  }, [coords]);

  if (!data) return null;
  const { phaseInfo, ill, rating, windows, cur, upcoming } = data;

  return (
    <div
      onClick={() => setOpen(o => !o)}
      className="fade-in"
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 22,
        background: 'linear-gradient(135deg, rgba(234,201,136,0.18), rgba(212,182,115,0.06))',
        border: '1px solid rgba(234, 201, 136, 0.35)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 10px 30px -10px rgba(212,182,115,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>{phaseInfo.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Bite Forecast</div>
          <div className="display-font" style={{ fontSize: 18, color: 'var(--text)', fontWeight: 500 }}>
            {phaseInfo.label} · {(ill.fraction * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>{rating.reason}</div>
        </div>
        <div style={{ display: 'flex', gap: 1 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} size={14}
              fill={i < rating.stars ? 'var(--gold-2)' : 'transparent'}
              style={{ color: i < rating.stars ? 'var(--gold-2)' : 'var(--text-3)' }}
            />
          ))}
        </div>
        <ChevronRight size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {open && (
        <div className="fade-in" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(234,201,136,0.2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ padding: 10, borderRadius: 12, background: 'rgba(10,24,22,0.5)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Now</div>
              <div style={{ fontSize: 13, color: cur ? 'var(--gold-2)' : 'var(--text-2)', fontWeight: 600, marginTop: 2 }}>
                {cur ? `${cur.kind === 'major' ? 'Major' : 'Minor'} window` : 'Between windows'}
              </div>
              {cur && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{cur.centerLabel}</div>}
            </div>
            <div style={{ padding: 10, borderRadius: 12, background: 'rgba(10,24,22,0.5)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Next window</div>
              {upcoming ? (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>
                    {upcoming.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {upcoming.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{upcoming.kind === 'major' ? 'Major' : 'Minor'} · {upcoming.centerLabel}</div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>None today</div>
              )}
            </div>
          </div>
          <div className="label" style={{ marginBottom: 8 }}>Today's windows</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {windows.map((w, i) => {
              const isCur = cur === w;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 10, background: isCur ? 'rgba(234,201,136,0.16)' : 'rgba(10,24,22,0.4)',
                  border: `1px solid ${isCur ? 'var(--gold)' : 'transparent'}`,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 999,
                    background: w.kind === 'major' ? 'var(--gold-2)' : 'var(--sage)',
                  }} />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, minWidth: 50 }}>
                    {w.kind === 'major' ? 'Major' : 'Minor'}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, fontWeight: 500 }}>
                    {w.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {w.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{w.centerLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveTripBanner({ trip, catches, onClick }: { trip: Trip; catches: CatchT[]; onClick: () => void }) {
  const tripCatches = catches.filter(c => c.trip_id === trip.id && !c.lost);
  const total = tripCatches.length;
  const biggest = tripCatches.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
  return (
    <div onClick={onClick} className="tap fade-in" style={{
      background: 'linear-gradient(135deg, rgba(212,182,115,0.18), rgba(141,191,157,0.12))',
      border: '1px solid rgba(212,182,115,0.4)', borderRadius: 18, padding: 14, marginBottom: 14,
      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
      backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(212,182,115,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Tent size={18} style={{ color: 'var(--gold-2)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Active Trip</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {total} fish{biggest ? ` · biggest ${formatWeight(biggest.lbs, biggest.oz)}` : ''}
        </div>
      </div>
      <ChevronRight size={18} style={{ color: 'var(--text-3)' }} />
    </div>
  );
}

function Chip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="tap" style={{
      flexShrink: 0, padding: '8px 14px', borderRadius: 999,
      border: `1px solid ${active ? (color || 'var(--gold)') : 'rgba(234,201,136,0.18)'}`,
      background: active ? (color ? `${color}22` : 'rgba(212,182,115,0.12)') : 'rgba(10,24,22,0.45)',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      color: active ? (color || 'var(--gold-2)') : 'var(--text-2)',
      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

function CatchCard({ catchData, angler, trip, photo, getPhoto, onClick }: {
  catchData: CatchT; angler: Angler | null; trip: Trip | null;
  photo?: string; getPhoto: (id: string) => Promise<string | null>; onClick: () => void;
}) {
  useEffect(() => { if (!photo && catchData.has_photo) getPhoto(catchData.id); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [catchData.id]);
  const species = SPECIES.find(s => s.id === catchData.species);
  const commentCount = (catchData.comments || []).length;

  if (catchData.lost) {
    return (
      <div className="card tap fade-in" onClick={onClick} style={{ padding: 14, cursor: 'pointer', borderColor: 'rgba(220,107,88,0.32)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(220,107,88,0.15)', border: '1px solid rgba(220,107,88,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Anchor size={18} style={{ color: 'var(--danger)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
            {angler && <>
              <div style={{ width: 18, height: 18, borderRadius: 6, background: angler.color, color: '#1A1004', fontWeight: 700, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{angler.name[0].toUpperCase()}</div>
              <strong style={{ fontWeight: 600 }}>{angler.name}</strong>
            </>}
            <span style={{ color: 'var(--text-3)' }}>lost one</span>
            {commentCount > 0 && <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={11} />{commentCount}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {formatDate(catchData.date)}
            {catchData.swim && ` · Swim ${catchData.swim}`}
            {catchData.rig && ` · ${catchData.rig}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card tap fade-in" onClick={onClick} style={{ overflow: 'hidden', cursor: 'pointer' }}>
      {catchData.has_photo && (
        <div style={{ width: '100%', aspectRatio: '4/3', background: 'rgba(10,24,22,0.5)', position: 'relative', overflow: 'hidden', borderRadius: '22px 22px 0 0' }}>
          {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                 : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(5,14,13,0.9))' }} />
          {trip && (
            <div style={{ position: 'absolute', top: 12, left: 12 }}>
              <span className="pill" style={{ background: 'rgba(5,14,13,0.7)', color: 'var(--gold-2)', border: '1px solid rgba(212,182,115,0.4)', backdropFilter: 'blur(8px)' }}>
                <Tent size={10} /> {trip.name}
              </span>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 14, left: 16, right: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <div className="num-display" style={{ fontSize: 38, lineHeight: 0.95, color: 'var(--text)', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
              {catchData.lbs}<span style={{ fontSize: 22 }}>lb</span>
              {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 18 }}>oz</span></>}
            </div>
            {species && (
              <span className="pill" style={{ background: `${species.hue}33`, color: species.hue, border: `1px solid ${species.hue}66` }}>{species.label}</span>
            )}
          </div>
        </div>
      )}
      <div style={{ padding: catchData.has_photo ? '14px 16px' : '18px' }}>
        {!catchData.has_photo && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
            <div className="num-display" style={{ fontSize: 34, lineHeight: 0.95 }}>
              {catchData.lbs}<span style={{ fontSize: 18, color: 'var(--text-3)' }}>lb</span>
              {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 16, color: 'var(--text-3)' }}>oz</span></>}
            </div>
            {species && <span className="pill" style={{ background: `${species.hue}33`, color: species.hue, border: `1px solid ${species.hue}66` }}>{species.label}</span>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          {angler && <>
            <div style={{ width: 22, height: 22, borderRadius: 7, background: angler.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1A1004', fontWeight: 700, fontSize: 11 }}>{angler.name[0].toUpperCase()}</div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{angler.name}</span>
          </>}
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>· {formatDate(catchData.date)}</span>
          {commentCount > 0 && <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={12} />{commentCount}</span>}
        </div>
        {(catchData.lake || catchData.swim || catchData.bait) && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
            {catchData.lake && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />{catchData.lake}{catchData.swim ? ` · Swim ${catchData.swim}` : ''}</span>}
            {!catchData.lake && catchData.swim && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />Swim {catchData.swim}</span>}
            {catchData.bait && <span>{'🎣'} {catchData.bait}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title = 'No catches yet', subtitle = 'Tap the + button when you bank your first one' }: { icon?: React.ReactNode; title?: string; subtitle?: string }) {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-3)', opacity: 0.4, margin: '0 auto 16px' }}>{icon || <Fish size={48} />}</div>
      <p className="display-font" style={{ fontSize: 22, color: 'var(--text-2)', margin: '0 0 6px', fontWeight: 500 }}>{title}</p>
      <p style={{ color: 'var(--text-3)', fontSize: 14, margin: 0 }}>{subtitle}</p>
    </div>
  );
}

// ============ TRIPS ============
function TripsView({ trips, catches, onOpenTrip, onAddTrip }: { trips: Trip[]; catches: CatchT[]; onOpenTrip: (t: Trip) => void; onAddTrip: () => void }) {
  const sorted = useMemo(() => [...trips].sort((a, b) => +new Date(b.start_date) - +new Date(a.start_date)), [trips]);
  const tripStats = (id: string) => {
    const tc = catches.filter(c => c.trip_id === id);
    const landed = tc.filter(c => !c.lost);
    const lost = tc.filter(c => c.lost);
    const biggest = landed.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    const totalWeightOz = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
    return { count: landed.length, lost: lost.length, biggest, totalWeightOz };
  };
  const isActive = (t: Trip) => { const now = Date.now(); return +new Date(t.start_date) <= now && +new Date(t.end_date) >= now - 86400000; };

  return (
    <div style={{ padding: '8px 20px' }}>
      <button onClick={onAddTrip} className="tap" style={{
        width: '100%', padding: 14, borderRadius: 16,
        background: 'transparent', border: '1.5px dashed rgba(234,201,136,0.3)',
        color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: 16,
      }}>
        <Plus size={16} /> New trip
      </button>
      {sorted.length === 0 ? <EmptyState icon={<Tent size={48} />} title="No trips yet" subtitle="Plan your annual France trip or any session" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(t => {
            const s = tripStats(t.id);
            const active = isActive(t);
            return (
              <div key={t.id} className="card tap fade-in" onClick={() => onOpenTrip(t)} style={{ padding: 16, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {active && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--sage)', boxShadow: '0 0 8px var(--sage)' }} />}
                    <h3 className="display-font" style={{ fontSize: 19, margin: 0, fontWeight: 500 }}>{t.name}</h3>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Calendar size={11} /> {formatDateRange(t.start_date, t.end_date)}
                  {t.location && <><span>·</span><MapPin size={11} />{t.location}</>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <MiniStat label="Fish" value={s.count} />
                  <MiniStat label="Biggest" value={s.biggest ? formatWeight(s.biggest.lbs, s.biggest.oz) : '—'} />
                  <MiniStat label="Total" value={s.totalWeightOz ? `${Math.floor(s.totalWeightOz / 16)}lb` : '—'} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'rgba(10,24,22,0.45)', borderRadius: 12, padding: '8px 10px', textAlign: 'center' }}>
      <div className="num-display" style={{ fontSize: 17, color: 'var(--gold-2)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function TripDetail({ trip, catches, anglers, photos, getPhoto, onClose, onEdit, onDelete, onOpenCatch }: {
  trip: Trip; catches: CatchT[]; anglers: Angler[];
  photos: Record<string, string>; getPhoto: (id: string) => Promise<string | null>;
  onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenCatch: (c: CatchT) => void;
}) {
  const tripCatches = useMemo(() => catches.filter(c => c.trip_id === trip.id).sort((a, b) => +new Date(b.date) - +new Date(a.date)), [catches, trip.id]);
  const landed = tripCatches.filter(c => !c.lost);
  const lost = tripCatches.filter(c => c.lost);
  const biggest = landed.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
  const totalWeightOz = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
  const perAngler = useMemo(() => anglers.map(a => {
    const ac = landed.filter(c => c.angler_id === a.id);
    const big = ac.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    return { angler: a, count: ac.length, biggest: big, totalOz: ac.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0) };
  }).sort((a, b) => b.count - a.count), [landed, anglers]);

  return (
    <ModalShell hideTitle onClose={onClose}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700, marginBottom: 4 }}>Trip</div>
        <h2 className="display-font" style={{ fontSize: 30, margin: 0, fontWeight: 500, lineHeight: 1.05 }}>{trip.name}</h2>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={12} /> {formatDateRange(trip.start_date, trip.end_date)}</span>
        {trip.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>· <MapPin size={12} />{trip.location}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label="Caught" value={landed.length} />
        <StatCard label="Biggest" value={biggest ? formatWeight(biggest.lbs, biggest.oz) : '—'} />
        <StatCard label="Total" value={totalWeightOz ? `${Math.floor(totalWeightOz / 16)}lb` : '—'} />
      </div>
      {lost.length > 0 && (
        <div style={{ background: 'rgba(220,107,88,0.08)', border: '1px solid rgba(220,107,88,0.25)', borderRadius: 12, padding: 10, marginBottom: 16, fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Anchor size={14} style={{ color: 'var(--danger)' }} />
          {lost.length} {lost.length === 1 ? 'fish' : 'fish'} lost
        </div>
      )}
      {trip.notes && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div className="label">Notes</div>
          <p style={{ fontSize: 14, color: 'var(--text)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{trip.notes}</p>
        </div>
      )}
      {perAngler.some(p => p.count > 0) && (
        <>
          <div className="label">Crew breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {perAngler.filter(p => p.count > 0).map(p => (
              <div key={p.angler.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: p.angler.color, color: '#1A1004', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.angler.name[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.angler.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.count} fish · biggest {p.biggest ? formatWeight(p.biggest.lbs, p.biggest.oz) : '—'}</div>
                </div>
                <div className="num-display" style={{ fontSize: 18, color: 'var(--text)' }}>{Math.floor(p.totalOz / 16)}<span style={{ fontSize: 12, color: 'var(--text-3)' }}>lb</span></div>
              </div>
            ))}
          </div>
        </>
      )}
      {tripCatches.length > 0 && (
        <>
          <div className="label">Catch list</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {tripCatches.map(c => (
              <CatchCard key={c.id} catchData={c}
                angler={anglers.find(a => a.id === c.angler_id) || null}
                trip={null} photo={photos[c.id]} getPhoto={getPhoto}
                onClick={() => onOpenCatch(c)}
              />
            ))}
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onEdit} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}><Edit2 size={16} /> Edit</button>
        <button onClick={onDelete} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)', color: 'var(--danger)' }}><Trash2 size={16} /> Delete</button>
      </div>
    </ModalShell>
  );
}

function AddTripModal({ existing, onClose, onSave }: {
  existing: Trip | null;
  onClose: () => void;
  onSave: (data: Partial<Trip> & { name: string; start_date: string; end_date: string }) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [location, setLocation] = useState(existing?.location || '');
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(existing?.start_date ? existing.start_date.slice(0, 10) : today);
  const [endDate, setEndDate] = useState(existing?.end_date ? existing.end_date.slice(0, 10) : tomorrow);
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { alert('Trip needs a name'); return; }
    setSaving(true);
    try {
      await onSave({
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        location: location.trim() || null,
        start_date: new Date(startDate + 'T00:00:00').toISOString(),
        end_date: new Date(endDate + 'T23:59:59').toISOString(),
        notes: notes.trim() || null,
      });
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title={existing ? 'Edit trip' : 'New trip'} onClose={onClose}>
      <label className="label">Name</label>
      <input className="input" placeholder="e.g. France 2026" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 16 }} />
      <label className="label">Location</label>
      <input className="input" placeholder="e.g. Étang du Moulin, Burgundy" value={location} onChange={(e) => setLocation(e.target.value)} style={{ marginBottom: 16 }} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Start</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">End</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <label className="label">Notes</label>
      <textarea className="input" rows={3} placeholder="Lake conditions, expectations, plan…" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ marginBottom: 20, resize: 'vertical', fontFamily: 'inherit' }} />
      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ width: '100%', fontSize: 16, padding: 16 }}>
        {saving ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
        {existing ? 'Save changes' : 'Create trip'}
      </button>
    </ModalShell>
  );
}

// ============ STATS (4 sub-tabs) ============
function Stats({ catches, anglers, photos, getPhoto, onOpen }: {
  catches: CatchT[]; anglers: Angler[]; photos: Record<string, string>;
  getPhoto: (id: string) => Promise<string | null>; onOpen: (c: CatchT) => void;
}) {
  const [tab, setTab] = useState<'crew' | 'time' | 'bait' | 'lakes'>('crew');
  if (catches.length === 0) return <div style={{ padding: '40px 20px' }}><EmptyState /></div>;
  const tabs = [
    { id: 'crew', label: 'Crew', icon: Trophy },
    { id: 'time', label: 'Time', icon: Clock },
    { id: 'bait', label: 'Bait', icon: BarChart3 },
    { id: 'lakes', label: 'Lakes', icon: MapPinned },
  ] as const;
  return (
    <div style={{ padding: '8px 20px' }}>
      <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="tap" style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 999,
              border: `1px solid ${tab === t.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: tab === t.id ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.45)',
              color: tab === t.id ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            }}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'crew' && <StatsCrew catches={catches} anglers={anglers} photos={photos} getPhoto={getPhoto} onOpen={onOpen} />}
      {tab === 'time' && <StatsTime catches={catches} />}
      {tab === 'bait' && <StatsBait catches={catches} />}
      {tab === 'lakes' && <StatsLakes catches={catches} anglers={anglers} photos={photos} getPhoto={getPhoto} onOpen={onOpen} />}
    </div>
  );
}

function StatsCrew({ catches, anglers, photos, getPhoto, onOpen }: { catches: CatchT[]; anglers: Angler[]; photos: Record<string, string>; getPhoto: (id: string) => Promise<string | null>; onOpen: (c: CatchT) => void }) {
  const [metric, setMetric] = useState<'biggest' | 'count' | 'total'>('biggest');
  const landed = useMemo(() => catches.filter(c => !c.lost), [catches]);
  const stats = useMemo(() => {
    const byAngler: Record<string, { angler: Angler; totalOz: number; biggest: CatchT | null; count: number }> = {};
    anglers.forEach(a => { byAngler[a.id] = { angler: a, totalOz: 0, biggest: null, count: 0 }; });
    landed.forEach(c => {
      const s = byAngler[c.angler_id]; if (!s) return;
      s.count++; const oz = totalOz(c.lbs, c.oz); s.totalOz += oz;
      if (!s.biggest || oz > totalOz(s.biggest.lbs, s.biggest.oz)) s.biggest = c;
    });
    const biggest = landed.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    const totalOzAll = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
    const bySpecies = SPECIES.map(sp => ({ ...sp, count: landed.filter(c => c.species === sp.id).length })).filter(sp => sp.count > 0);
    return { byAngler, biggest, count: landed.length, totalOzAll, bySpecies };
  }, [landed, anglers]);
  const ranked = useMemo(() => {
    const arr = Object.values(stats.byAngler);
    if (metric === 'biggest') return arr.sort((a, b) => (b.biggest ? totalOz(b.biggest.lbs, b.biggest.oz) : 0) - (a.biggest ? totalOz(a.biggest.lbs, a.biggest.oz) : 0));
    if (metric === 'count') return arr.sort((a, b) => b.count - a.count);
    return arr.sort((a, b) => b.totalOz - a.totalOz);
  }, [stats, metric]);

  return (
    <>
      {stats.biggest && (
        <HeroCatch
          catchData={stats.biggest}
          angler={anglers.find(a => a.id === stats.biggest!.angler_id) || null}
          photo={photos[stats.biggest.id]} getPhoto={getPhoto}
          onClick={() => onOpen(stats.biggest!)}
        />
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, marginTop: 24 }}>
        {([{ id: 'biggest', label: 'Biggest' }, { id: 'count', label: 'Most caught' }, { id: 'total', label: 'Total weight' }] as const).map(m => (
          <button key={m.id} onClick={() => setMetric(m.id)} className="tap" style={{
            flex: 1, padding: '10px 8px', borderRadius: 12,
            border: `1px solid ${metric === m.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
            background: metric === m.id ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
            color: metric === m.id ? 'var(--gold-2)' : 'var(--text-2)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{m.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {ranked.map((s, i) => <LeaderRow key={s.angler.id} entry={s} rank={i + 1} metric={metric} />)}
      </div>
      <h3 className="display-font" style={{ fontSize: 20, fontWeight: 500, margin: '24px 0 12px' }}>Group totals</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 }}>
        <StatCard label="Catches" value={stats.count} />
        <StatCard label="Total weight" value={`${Math.floor(stats.totalOzAll / 16)}lb`} />
        <StatCard label="Biggest" value={stats.biggest ? formatWeight(stats.biggest.lbs, stats.biggest.oz) : '—'} />
      </div>
      {stats.bySpecies.length > 0 && (
        <>
          <h3 className="display-font" style={{ fontSize: 20, fontWeight: 500, margin: '8px 0 12px' }}>By species</h3>
          <div className="card" style={{ padding: 16, marginBottom: 24 }}>
            {stats.bySpecies.map(sp => {
              const pct = (sp.count / stats.count) * 100;
              return (
                <div key={sp.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{sp.label}</span>
                    <span style={{ color: 'var(--text-3)' }}>{sp.count} · {pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(10,24,22,0.6)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: sp.hue, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function StatsTime({ catches }: { catches: CatchT[] }) {
  const landed = catches.filter(c => !c.lost);
  const grid = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    landed.forEach(c => {
      const d = new Date(c.date);
      let dow = d.getDay() - 1; if (dow < 0) dow = 6;
      g[dow][d.getHours()] += 1;
    });
    return g;
  }, [landed]);
  const max = useMemo(() => Math.max(1, ...grid.flat()), [grid]);
  const byHour = useMemo(() => { const a = Array(24).fill(0); landed.forEach(c => { a[new Date(c.date).getHours()]++; }); return a; }, [landed]);
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const byDay = useMemo(() => { const a = Array(7).fill(0); landed.forEach(c => { let d = new Date(c.date).getDay() - 1; if (d < 0) d = 6; a[d]++; }); return a; }, [landed]);
  const peakDay = byDay.indexOf(Math.max(...byDay));

  if (landed.length === 0) return <EmptyState icon={<Clock size={48} />} title="Need some catches" subtitle="Patterns emerge after a few sessions" />;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
        <StatCard label="Peak hour" value={`${peakHour}:00`} />
        <StatCard label="Best day" value={DAYS[peakDay]} />
      </div>
      <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '8px 0 4px' }}>When the bites come</h3>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 16px' }}>Day of week × hour. Brighter = more catches.</p>
      <div className="card" style={{ padding: 12, marginBottom: 20, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 2, minWidth: 360 }}>
          <div></div>
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} style={{ fontSize: 8, color: 'var(--text-3)', textAlign: 'center', fontWeight: 600 }}>{h % 6 === 0 ? h : ''}</div>
          ))}
          {grid.map((row, dow) => (
            <React.Fragment key={dow}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, paddingRight: 4, display: 'flex', alignItems: 'center' }}>{DAYS[dow]}</div>
              {row.map((v, h) => {
                const intensity = v / max;
                return <div key={h} title={`${DAYS[dow]} ${h}:00 — ${v} catch${v === 1 ? '' : 'es'}`}
                  style={{
                    aspectRatio: '1', borderRadius: 3,
                    background: v === 0 ? 'rgba(10,24,22,0.6)' : `rgba(212,182,115, ${0.15 + intensity * 0.85})`,
                    border: v > 0 ? `1px solid rgba(212,182,115, ${0.3 + intensity * 0.5})` : 'none',
                  }} />;
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '24px 0 12px' }}>Catches by hour</h3>
      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 100, gap: 2 }}>
          {byHour.map((v, h) => {
            const max2 = Math.max(1, ...byHour);
            const pct = (v / max2) * 100;
            return (
              <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', height: `${pct}%`, background: v > 0 ? 'linear-gradient(180deg, var(--gold-2), var(--gold))' : 'rgba(10,24,22,0.5)', borderRadius: '3px 3px 0 0', minHeight: v > 0 ? 4 : 0 }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--text-3)', fontWeight: 600 }}>
          <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
        </div>
      </div>
    </>
  );
}

function StatsBait({ catches }: { catches: CatchT[] }) {
  const [view, setView] = useState<'bait' | 'rig'>('bait');
  const [sortBy, setSortBy] = useState<'count' | 'weight' | 'biggest'>('count');
  const data = useMemo(() => {
    const grouped: Record<string, { name: string; catches: CatchT[]; lost: number; totalOz: number; biggest: CatchT | null }> = {};
    catches.forEach(c => {
      const key = (view === 'bait' ? c.bait : c.rig)?.trim();
      if (!key) return;
      if (!grouped[key]) grouped[key] = { name: key, catches: [], lost: 0, totalOz: 0, biggest: null };
      if (c.lost) grouped[key].lost++;
      else {
        grouped[key].catches.push(c);
        grouped[key].totalOz += totalOz(c.lbs, c.oz);
        if (!grouped[key].biggest || totalOz(c.lbs, c.oz) > totalOz(grouped[key].biggest!.lbs, grouped[key].biggest!.oz)) grouped[key].biggest = c;
      }
    });
    let arr = Object.values(grouped);
    if (sortBy === 'count') arr.sort((a, b) => b.catches.length - a.catches.length);
    else if (sortBy === 'weight') arr.sort((a, b) => b.totalOz - a.totalOz);
    else arr.sort((a, b) => (b.biggest ? totalOz(b.biggest.lbs, b.biggest.oz) : 0) - (a.biggest ? totalOz(a.biggest.lbs, a.biggest.oz) : 0));
    return arr;
  }, [catches, view, sortBy]);
  const totalCatches = catches.filter(c => !c.lost).length;
  if (data.length === 0) return <EmptyState icon={<BarChart3 size={48} />} title={`No ${view} data yet`} subtitle="Add bait/rig to your catches to see what's working" />;

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['bait', 'rig'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} className="tap" style={{
            flex: 1, padding: '10px 8px', borderRadius: 12,
            border: `1px solid ${view === v ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
            background: view === v ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
            color: view === v ? 'var(--gold-2)' : 'var(--text-2)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{v === 'bait' ? 'Bait' : 'Rig'}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([{ id: 'count', label: 'Most caught' }, { id: 'weight', label: 'Total weight' }, { id: 'biggest', label: 'Biggest' }] as const).map(s => (
          <button key={s.id} onClick={() => setSortBy(s.id)} className="tap" style={{
            flex: 1, padding: '8px 4px', borderRadius: 10,
            border: `1px solid ${sortBy === s.id ? 'var(--border-bright)' : 'transparent'}`,
            background: sortBy === s.id ? 'rgba(20,42,38,0.55)' : 'transparent',
            color: sortBy === s.id ? 'var(--text)' : 'var(--text-3)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{s.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map(item => {
          const pct = totalCatches ? (item.catches.length / totalCatches) * 100 : 0;
          const avgOz = item.catches.length ? item.totalOz / item.catches.length : 0;
          return (
            <div key={item.name} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.catches.length} caught · {pct.toFixed(0)}% of all catches{item.lost > 0 ? ` · ${item.lost} lost` : ''}</div>
                </div>
                <div className="num-display" style={{ fontSize: 22, color: 'var(--gold-2)' }}>{item.biggest ? formatWeight(item.biggest.lbs, item.biggest.oz) : '—'}</div>
              </div>
              <div style={{ height: 4, background: 'rgba(10,24,22,0.6)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)' }}>
                <span>Avg {Math.floor(avgOz / 16)}lb {avgOz % 16 ? Math.round(avgOz % 16) + 'oz' : ''}</span>
                <span>Total {Math.floor(item.totalOz / 16)}lb</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StatsLakes({ catches, anglers, photos, getPhoto, onOpen }: { catches: CatchT[]; anglers: Angler[]; photos: Record<string, string>; getPhoto: (id: string) => Promise<string | null>; onOpen: (c: CatchT) => void }) {
  const landed = useMemo(() => catches.filter(c => !c.lost && c.lake), [catches]);
  const lakes = useMemo(() => {
    const grouped: Record<string, { name: string; catches: CatchT[]; totalOz: number; biggest: CatchT | null }> = {};
    landed.forEach(c => {
      const key = c.lake!.trim();
      if (!grouped[key]) grouped[key] = { name: key, catches: [], totalOz: 0, biggest: null };
      grouped[key].catches.push(c); grouped[key].totalOz += totalOz(c.lbs, c.oz);
      if (!grouped[key].biggest || totalOz(c.lbs, c.oz) > totalOz(grouped[key].biggest!.lbs, grouped[key].biggest!.oz)) grouped[key].biggest = c;
    });
    return Object.values(grouped).sort((a, b) => (b.biggest ? totalOz(b.biggest.lbs, b.biggest.oz) : 0) - (a.biggest ? totalOz(a.biggest.lbs, a.biggest.oz) : 0));
  }, [landed]);
  if (lakes.length === 0) return <EmptyState icon={<MapPinned size={48} />} title="No lake data yet" subtitle="Add lake names to your catches to track records by venue" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {lakes.map(lake => <LakeCard key={lake.name} lake={lake} anglers={anglers} photos={photos} getPhoto={getPhoto} onOpen={onOpen} />)}
    </div>
  );
}

function LakeCard({ lake, anglers, photos, getPhoto, onOpen }: { lake: { name: string; catches: CatchT[]; totalOz: number; biggest: CatchT | null }; anglers: Angler[]; photos: Record<string, string>; getPhoto: (id: string) => Promise<string | null>; onOpen: (c: CatchT) => void }) {
  const top3 = [...lake.catches].sort((a, b) => totalOz(b.lbs, b.oz) - totalOz(a.lbs, a.oz)).slice(0, 3);
  useEffect(() => { top3.forEach(c => { if (c.has_photo && !photos[c.id]) getPhoto(c.id); }); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [lake.name]);
  const rankColors = ['var(--gold)', '#B5B6A6', '#A06D3D'];
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <MapPinned size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
          <h3 className="display-font" style={{ fontSize: 18, margin: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lake.name}</h3>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{lake.catches.length} fish</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {top3.map((c, i) => {
          const a = anglers.find(x => x.id === c.angler_id);
          return (
            <div key={c.id} className="tap" onClick={() => onOpen(c)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, background: 'rgba(10,24,22,0.5)', cursor: 'pointer' }}>
              <div style={{
                width: 24, height: 24, borderRadius: 8, flexShrink: 0,
                background: `${rankColors[i]}22`, color: rankColors[i],
                border: `1px solid ${rankColors[i]}66`,
                fontFamily: 'Fraunces, serif', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
              }}>{i + 1}</div>
              {c.has_photo && photos[c.id] && <img src={photos[c.id]} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="num-display" style={{ fontSize: 16, color: 'var(--text)', lineHeight: 1 }}>{formatWeight(c.lbs, c.oz)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{a?.name} · {new Date(c.date).toLocaleDateString([], { month: 'short', year: 'numeric' })}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeroCatch({ catchData, angler, photo, getPhoto, onClick }: { catchData: CatchT; angler: Angler | null; photo?: string; getPhoto: (id: string) => Promise<string | null>; onClick: () => void }) {
  useEffect(() => { if (!photo && catchData.has_photo) getPhoto(catchData.id); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [catchData.id]);
  return (
    <div className="card tap fade-in" onClick={onClick} style={{ overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 2 }}>
        <span className="pill" style={{ background: 'rgba(212,182,115,0.18)', color: 'var(--gold-2)', border: '1px solid var(--gold)' }}>
          <Crown size={11} /> All-time PB
        </span>
      </div>
      {catchData.has_photo && photo && (
        <div style={{ width: '100%', aspectRatio: '5/4', position: 'relative' }}>
          <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(5,14,13,0.95))' }} />
          <div style={{ position: 'absolute', bottom: 18, left: 18, right: 18 }}>
            <div className="num-display" style={{ fontSize: 56, lineHeight: 0.9, color: 'var(--gold-2)', textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
              {catchData.lbs}<span style={{ fontSize: 30, color: 'var(--text)' }}>lb</span>
              {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 24, color: 'var(--text)' }}>oz</span></>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, color: 'var(--text)' }}>
              {angler && <>
                <div style={{ width: 24, height: 24, borderRadius: 8, background: angler.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1A1004', fontWeight: 700, fontSize: 12 }}>{angler.name[0].toUpperCase()}</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{angler.name}</span>
              </>}
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>· {formatDate(catchData.date)}</span>
            </div>
          </div>
        </div>
      )}
      {!catchData.has_photo && (
        <div style={{ padding: '40px 20px' }}>
          <div className="num-display" style={{ fontSize: 56, lineHeight: 0.9, color: 'var(--gold-2)' }}>
            {catchData.lbs}<span style={{ fontSize: 28, color: 'var(--text)' }}>lb</span>
            {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 22, color: 'var(--text)' }}>oz</span></>}
          </div>
          {angler && <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-2)' }}>{angler.name} · {formatDate(catchData.date)}</div>}
        </div>
      )}
    </div>
  );
}

function LeaderRow({ entry, rank, metric }: { entry: { angler: Angler; biggest: CatchT | null; count: number; totalOz: number }; rank: number; metric: 'biggest' | 'count' | 'total' }) {
  const value = metric === 'biggest' ? (entry.biggest ? formatWeight(entry.biggest.lbs, entry.biggest.oz) : '—')
    : metric === 'count' ? `${entry.count}` : `${Math.floor(entry.totalOz / 16)}lb`;
  const subtext = metric === 'biggest' ? (entry.biggest ? SPECIES.find(s => s.id === entry.biggest!.species)?.label : '')
    : metric === 'count' ? 'fish landed' : 'banked';
  const rankColors = ['var(--gold)', '#B5B6A6', '#A06D3D'];
  return (
    <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: rank <= 3 ? `${rankColors[rank - 1]}22` : 'rgba(10,24,22,0.55)',
        border: rank <= 3 ? `1px solid ${rankColors[rank - 1]}` : '1px solid rgba(234,201,136,0.18)',
        color: rank <= 3 ? rankColors[rank - 1] : 'var(--text-3)',
        fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 18, flexShrink: 0,
      }}>{rank}</div>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: entry.angler.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1A1004', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
        {entry.angler.name[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{entry.angler.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{subtext}</div>
      </div>
      <div className="num-display" style={{ fontSize: 22, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', borderRadius: 14, padding: 14, textAlign: 'center', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <div className="num-display" style={{ fontSize: 22, color: 'var(--gold-2)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ============ GALLERY ============
function Gallery({ catches, photos, getPhoto, onOpen }: { catches: CatchT[]; photos: Record<string, string>; getPhoto: (id: string) => Promise<string | null>; onOpen: (c: CatchT) => void }) {
  const withPhotos = useMemo(() => catches.filter(c => c.has_photo && !c.lost).sort((a, b) => +new Date(b.date) - +new Date(a.date)), [catches]);
  useEffect(() => { withPhotos.forEach(c => { if (!photos[c.id]) getPhoto(c.id); }); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [withPhotos.length]);
  if (withPhotos.length === 0) return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <Images size={48} style={{ color: 'var(--text-3)', opacity: 0.4, margin: '0 auto 16px' }} />
      <p style={{ color: 'var(--text-3)' }}>No photos yet</p>
    </div>
  );
  return (
    <div style={{ padding: '8px 8px 20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {withPhotos.map(c => (
          <div key={c.id} className="tap fade-in" onClick={() => onOpen(c)} style={{ aspectRatio: '1', borderRadius: 14, overflow: 'hidden', position: 'relative', cursor: 'pointer', background: 'rgba(10,24,22,0.5)' }}>
            {photos[c.id] ? <img src={photos[c.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(5,14,13,0.9))' }} />
            <div style={{ position: 'absolute', bottom: 8, left: 10, right: 10 }}>
              <div className="num-display" style={{ fontSize: 18, color: 'var(--text)', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {c.lbs}<span style={{ fontSize: 12 }}>lb</span>
                {c.oz > 0 && <> {c.oz}<span style={{ fontSize: 11 }}>oz</span></>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ ADD CATCH MODAL ============
function AddCatchModal({
  anglers, me, trips, activeTrips, onClose, onSave, existing, photoExisting,
}: {
  anglers: Angler[]; me: { anglerId: string }; trips: Trip[]; activeTrips: Trip[];
  onClose: () => void;
  onSave: (data: db.CatchInput, photo: string | null) => Promise<void>;
  existing?: CatchT; photoExisting?: string;
}) {
  const [lost, setLost] = useState(existing?.lost || false);
  const [photo, setPhoto] = useState<string | null>(photoExisting || null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [lbs, setLbs] = useState<string>(existing ? String(existing.lbs) : '');
  const [oz, setOz] = useState<string>(existing ? String(existing.oz) : '');
  const [species, setSpecies] = useState<string>(existing?.species || 'mirror');
  const [angler_id, setAnglerId] = useState(existing?.angler_id || me.anglerId);
  const [date, setDate] = useState(existing?.date ? existing.date.slice(0, 16) : new Date().toISOString().slice(0, 16));
  const [trip_id, setTripId] = useState<string | null>(existing?.trip_id || activeTrips[0]?.id || null);
  const [lake, setLake] = useState(existing?.lake || '');
  const [swim, setSwim] = useState(existing?.swim || '');
  const [bait, setBait] = useState(existing?.bait || '');
  const [rig, setRig] = useState(existing?.rig || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [tempC, setTempC] = useState<string>(existing?.weather?.tempC != null ? String(existing.weather.tempC) : '');
  const [conditions, setConditions] = useState(existing?.weather?.conditions || '');
  const [wind, setWind] = useState(existing?.weather?.wind || '');
  const [pressure, setPressure] = useState<string>(existing?.weather?.pressure != null ? String(existing.weather.pressure) : '');
  const [showMore, setShowMore] = useState(!!(existing?.lake || existing?.swim || existing?.bait || existing?.rig || existing?.notes));
  const [showWeather, setShowWeather] = useState(!!(existing?.weather?.tempC != null || existing?.weather?.conditions));
  const [autoStatus, setAutoStatus] = useState<{ wx: 'idle' | 'fetching' | 'done' | 'failed'; sp: 'idle' | 'detecting' | 'done' | 'failed' }>({ wx: 'idle', sp: 'idle' });
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const compressed = await compressImage(file);
      setPhoto(compressed);
      // Auto-fetch weather + species detection in parallel.
      setAutoStatus({ wx: 'fetching', sp: 'detecting' });
      Promise.all([
        (async () => {
          try {
            // Pick coords: GPS first if recent (memo), then geocode lake.
            let coords: { lat: number; lng: number } | null = null;
            const cached = localStorage.getItem(LOC_KEY);
            if (cached) { try { coords = JSON.parse(cached); } catch {} }
            if (!coords) {
              const gps = await getCurrentLocation();
              if (gps) { coords = gps; localStorage.setItem(LOC_KEY, JSON.stringify(gps)); }
            }
            if (!coords && lake.trim()) coords = await geocodeLake(lake);
            if (!coords) { setAutoStatus(s => ({ ...s, wx: 'failed' })); return; }
            const w = await fetchWeatherFor(new Date(date), coords.lat, coords.lng);
            if (!w) { setAutoStatus(s => ({ ...s, wx: 'failed' })); return; }
            if (w.tempC != null) setTempC(String(w.tempC));
            if (w.pressure != null) setPressure(String(w.pressure));
            if (w.wind) setWind(w.wind);
            if (w.conditions) setConditions(w.conditions);
            setShowWeather(true);
            setAutoStatus(s => ({ ...s, wx: 'done' }));
          } catch { setAutoStatus(s => ({ ...s, wx: 'failed' })); }
        })(),
        (async () => {
          try {
            const r = await fetch('/api/detect-species', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: compressed }),
            });
            const j = await r.json();
            if (j?.species && SPECIES.find(s => s.id === j.species)) {
              setSpecies(j.species);
              setAutoStatus(s => ({ ...s, sp: 'done' }));
            } else {
              setAutoStatus(s => ({ ...s, sp: 'failed' }));
            }
          } catch { setAutoStatus(s => ({ ...s, sp: 'failed' })); }
        })(),
      ]);
    } catch {
      alert('Failed to process image');
    } finally {
      setPhotoLoading(false);
    }
  }

  async function handleSave() {
    if (!lost && !lbs && !oz) { alert('Add a weight'); return; }
    setSaving(true);
    try {
      const weather: Weather | null = (tempC || conditions || wind || pressure) ? {
        tempC: tempC ? parseFloat(tempC) : null,
        conditions: conditions || null,
        wind: wind || null,
        pressure: pressure ? parseFloat(pressure) : null,
      } : null;

      // Compute moon snapshot at catch date if we know coords.
      let moon: MoonT | null = existing?.moon || null;
      try {
        const cached = typeof window !== 'undefined' ? localStorage.getItem(LOC_KEY) : null;
        const coords = cached ? JSON.parse(cached) : null;
        if (coords?.lat != null) {
          const dt = new Date(date);
          const ill = getMoonIllumination(dt);
          const lab = getMoonPhaseLabel(ill.phase);
          moon = { phase: ill.phase, fraction: ill.fraction, label: lab.label, emoji: lab.emoji };
        }
      } catch {}

      const payload: db.CatchInput = {
        ...(existing ? { id: existing.id } : {}),
        angler_id, lost,
        lbs: lost ? 0 : (parseInt(lbs) || 0),
        oz: lost ? 0 : (parseInt(oz) || 0),
        species: lost ? null : species,
        date: new Date(date).toISOString(),
        trip_id,
        lake: lake.trim() || null,
        swim: swim.trim() || null,
        bait: bait.trim() || null,
        rig: rig.trim() || null,
        notes: notes.trim() || null,
        weather, moon,
        has_photo: !lost && !!photo,
        comments: existing?.comments || [],
      };
      await onSave(payload, !lost && photo && photo !== photoExisting ? photo : null);
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title={existing ? 'Edit catch' : 'New catch'} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, padding: 4, background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)', borderRadius: 14 }}>
        <button onClick={() => setLost(false)} className="tap" style={{
          flex: 1, padding: '10px', borderRadius: 10, border: 'none',
          background: !lost ? 'var(--gold)' : 'transparent',
          color: !lost ? '#1A1004' : 'var(--text-2)',
          fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}><Fish size={14} /> Landed</button>
        <button onClick={() => setLost(true)} className="tap" style={{
          flex: 1, padding: '10px', borderRadius: 10, border: 'none',
          background: lost ? 'var(--danger)' : 'transparent',
          color: lost ? '#FFF' : 'var(--text-2)',
          fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}><Anchor size={14} /> Lost</button>
      </div>

      {!lost && (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
          <div onClick={() => fileInputRef.current?.click()} className="tap" style={{
            width: '100%', aspectRatio: '4/3', borderRadius: 18,
            background: photo ? 'transparent' : 'rgba(10,24,22,0.55)',
            border: `2px dashed ${photo ? 'transparent' : 'rgba(234,201,136,0.3)'}`,
            marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', overflow: 'hidden', position: 'relative',
          }}>
            {photoLoading ? <Loader2 size={32} className="spin" style={{ color: 'var(--gold)' }} /> :
             photo ? (
              <>
                <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button onClick={(e) => { e.stopPropagation(); setPhoto(null); }}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(5,14,13,0.85)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 999, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)' }}>
                  <X size={16} />
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                <Camera size={32} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Add a photo</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>Tap to capture or upload</div>
              </div>
            )}
          </div>

          {/* Auto-status row */}
          {(autoStatus.wx !== 'idle' || autoStatus.sp !== 'idle') && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-3)' }}>
              {autoStatus.wx !== 'idle' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Cloud size={11} />
                  {autoStatus.wx === 'fetching' && 'Fetching weather…'}
                  {autoStatus.wx === 'done' && <span style={{ color: 'var(--sage)' }}>Weather added</span>}
                  {autoStatus.wx === 'failed' && <span style={{ color: 'var(--text-3)' }}>Weather unavailable</span>}
                </span>
              )}
              {autoStatus.sp !== 'idle' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={11} />
                  {autoStatus.sp === 'detecting' && 'Identifying species…'}
                  {autoStatus.sp === 'done' && <span style={{ color: 'var(--sage)' }}>Species detected</span>}
                  {autoStatus.sp === 'failed' && <span>Species detection skipped</span>}
                </span>
              )}
            </div>
          )}

          <label className="label">Weight</label>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <div style={{ flex: 2, position: 'relative' }}>
              <input className="input" type="number" inputMode="numeric" placeholder="0" value={lbs} onChange={(e) => setLbs(e.target.value)}
                style={{ fontSize: 28, fontFamily: 'Fraunces, serif', fontWeight: 500, paddingRight: 50, height: 64 }} />
              <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, fontWeight: 600, letterSpacing: '0.05em' }}>LBS</span>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <input className="input" type="number" inputMode="numeric" placeholder="0" value={oz} onChange={(e) => setOz(e.target.value)}
                style={{ fontSize: 28, fontFamily: 'Fraunces, serif', fontWeight: 500, paddingRight: 42, height: 64 }} />
              <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, fontWeight: 600, letterSpacing: '0.05em' }}>OZ</span>
            </div>
          </div>

          <label className="label">Species</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 20 }}>
            {SPECIES.map(s => (
              <button key={s.id} onClick={() => setSpecies(s.id)} className="tap" style={{
                padding: '10px 6px', borderRadius: 12,
                border: `1px solid ${species === s.id ? s.hue : 'rgba(234,201,136,0.18)'}`,
                background: species === s.id ? `${s.hue}1F` : 'rgba(10,24,22,0.5)',
                color: species === s.id ? s.hue : 'var(--text-2)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>{s.label}</button>
            ))}
          </div>
        </>
      )}

      <label className="label">Angler</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {anglers.map(a => (
          <button key={a.id} onClick={() => setAnglerId(a.id)} className="tap" style={{
            flex: '1 1 30%', padding: '10px 6px', borderRadius: 12,
            border: `1px solid ${angler_id === a.id ? a.color : 'rgba(234,201,136,0.18)'}`,
            background: angler_id === a.id ? `${a.color}1F` : 'rgba(10,24,22,0.5)',
            color: angler_id === a.id ? 'var(--text)' : 'var(--text-2)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <div style={{ width: 18, height: 18, borderRadius: 6, background: a.color, color: '#1A1004', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a.name[0].toUpperCase()}</div>
            {a.name}
          </button>
        ))}
      </div>

      {trips.length > 0 && (
        <>
          <label className="label">Trip (optional)</label>
          <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
            <Chip active={!trip_id} onClick={() => setTripId(null)}>None</Chip>
            {trips.map(t => (
              <Chip key={t.id} active={trip_id === t.id} onClick={() => setTripId(t.id)}>
                <Tent size={11} style={{ marginRight: 2 }} /> {t.name}
              </Chip>
            ))}
          </div>
        </>
      )}

      <label className="label">When</label>
      <input className="input" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 20 }} />

      <button onClick={() => setShowMore(!showMore)} className="tap" style={{
        width: '100%', padding: '14px 16px', borderRadius: 14,
        background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
        color: 'var(--text-2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
      }}>
        <span>Lake, swim, bait, rig, notes</span>
        <ChevronRight size={16} style={{ transform: showMore ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {showMore && (
        <div className="fade-in" style={{ marginBottom: 6 }}>
          <label className="label">Lake</label>
          <input className="input" placeholder="e.g. Étang du Moulin" value={lake} onChange={(e) => setLake(e.target.value)} style={{ marginBottom: 14 }} />
          <label className="label">Swim / Peg</label>
          <input className="input" placeholder="e.g. 12" value={swim} onChange={(e) => setSwim(e.target.value)} style={{ marginBottom: 14 }} />
          <label className="label">Bait</label>
          <input className="input" placeholder="e.g. 18mm Mainline Cell pop-up" value={bait} onChange={(e) => setBait(e.target.value)} style={{ marginBottom: 14 }} />
          <label className="label">Rig</label>
          <input className="input" placeholder="e.g. Ronnie / Spinner" value={rig} onChange={(e) => setRig(e.target.value)} style={{ marginBottom: 14 }} />
          <label className="label">Notes</label>
          <textarea className="input" placeholder="Any details about the session, the fight, the conditions…" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            style={{ marginBottom: 8, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
      )}

      <button onClick={() => setShowWeather(!showWeather)} className="tap" style={{
        width: '100%', padding: '14px 16px', borderRadius: 14,
        background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
        color: 'var(--text-2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Cloud size={15} /> Weather</span>
        <ChevronRight size={16} style={{ transform: showWeather ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {showWeather && (
        <div className="fade-in" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <label className="label">Temp</label>
              <input className="input" type="number" inputMode="numeric" placeholder="—" value={tempC} onChange={(e) => setTempC(e.target.value)} style={{ paddingRight: 40 }} />
              <span style={{ position: 'absolute', right: 14, bottom: 14, color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}>°C</span>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <label className="label">Pressure</label>
              <input className="input" type="number" inputMode="numeric" placeholder="—" value={pressure} onChange={(e) => setPressure(e.target.value)} style={{ paddingRight: 44 }} />
              <span style={{ position: 'absolute', right: 14, bottom: 14, color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}>mb</span>
            </div>
          </div>
          <label className="label">Conditions</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 14 }}>
            {WEATHER_CONDITIONS.map(w => (
              <button key={w.id} onClick={() => setConditions(conditions === w.id ? '' : w.id)} className="tap" style={{
                padding: '10px 6px', borderRadius: 12,
                border: `1px solid ${conditions === w.id ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                background: conditions === w.id ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
                color: conditions === w.id ? 'var(--gold-2)' : 'var(--text-2)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}><span>{w.icon}</span> {w.label}</button>
            ))}
          </div>
          <label className="label">Wind direction</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, marginBottom: 8 }}>
            {WIND_DIRS.map(d => (
              <button key={d} onClick={() => setWind(wind === d ? '' : d)} className="tap" style={{
                padding: '8px 0', borderRadius: 10,
                border: `1px solid ${wind === d ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                background: wind === d ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
                color: wind === d ? 'var(--gold-2)' : 'var(--text-2)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>{d}</button>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}
        style={{ width: '100%', fontSize: 16, padding: '16px', marginTop: 14 }}>
        {saving ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
        {existing ? 'Save changes' : (lost ? 'Log lost fish' : 'Bank this fish')}
      </button>
    </ModalShell>
  );
}

// ============ CATCH DETAIL ============
function CatchDetail({
  catchData, photo, getPhoto, anglers, me, trips, onClose, onDelete, onUpdate, onAddComment, onDeleteComment, onOpenTrip,
}: {
  catchData: CatchT; photo?: string;
  getPhoto: (id: string) => Promise<string | null>;
  anglers: Angler[]; me: { anglerId: string }; trips: Trip[];
  onClose: () => void; onDelete: () => void;
  onUpdate: (data: db.CatchInput, photo: string | null) => Promise<void>;
  onAddComment: (text: string) => void; onDeleteComment: (cid: string) => void;
  onOpenTrip: (t: Trip) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [commentText, setCommentText] = useState('');
  const angler = anglers.find(a => a.id === catchData.angler_id);
  const species = SPECIES.find(s => s.id === catchData.species);
  const trip = catchData.trip_id ? trips.find(t => t.id === catchData.trip_id) : null;
  const weather = catchData.weather;
  const moon = catchData.moon;
  const comments = catchData.comments || [];
  useEffect(() => { if (!photo && catchData.has_photo) getPhoto(catchData.id); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [catchData.id]);

  if (editing) {
    return (
      <AddCatchModal
        anglers={anglers} me={me} trips={trips} activeTrips={[]}
        existing={catchData} photoExisting={photo}
        onClose={() => setEditing(false)}
        onSave={async (data, ph) => { await onUpdate(data, ph); setEditing(false); }}
      />
    );
  }
  return (
    <ModalShell title="" onClose={onClose} hideTitle>
      {catchData.lost ? (
        <div style={{ textAlign: 'center', padding: '20px 0 30px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(220,107,88,0.15)', border: '1px solid rgba(220,107,88,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Anchor size={28} style={{ color: 'var(--danger)' }} />
          </div>
          <div className="display-font" style={{ fontSize: 26, fontWeight: 500, marginBottom: 4 }}>Fish lost</div>
          <div style={{ color: 'var(--text-3)', fontSize: 14 }}>The one that got away</div>
        </div>
      ) : (
        <>
          {catchData.has_photo && (
            <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 18, overflow: 'hidden', marginBottom: 20, background: 'rgba(10,24,22,0.5)' }}>
              {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
                       <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
            </div>
          )}
          <div className="num-display" style={{ fontSize: 64, lineHeight: 0.9, color: 'var(--gold-2)', marginBottom: 4 }}>
            {catchData.lbs}<span style={{ fontSize: 32, color: 'var(--text)' }}>lb</span>
            {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 26, color: 'var(--text)' }}>oz</span></>}
          </div>
          {species && (
            <div style={{ marginBottom: 16 }}>
              <span className="pill" style={{ background: `${species.hue}33`, color: species.hue, border: `1px solid ${species.hue}66` }}>{species.label} carp</span>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {angler && <>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: angler.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1A1004', fontWeight: 700 }}>{angler.name[0].toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{angler.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatDate(catchData.date)}</div>
          </div>
        </>}
      </div>

      {trip && (
        <button onClick={() => onOpenTrip(trip)} className="tap" style={{
          width: '100%', padding: 12, borderRadius: 14,
          background: 'rgba(212,182,115,0.08)', border: '1px solid rgba(212,182,115,0.25)',
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit',
          color: 'var(--text)', textAlign: 'left', marginBottom: 16,
        }}>
          <Tent size={16} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Trip</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{trip.name}</div>
          </div>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </button>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {catchData.lake && <DetailRow icon={<MapPin size={14} />} label="Lake" value={catchData.lake} />}
        {catchData.swim && <DetailRow icon={<MapPin size={14} />} label="Swim" value={catchData.swim} />}
        {catchData.bait && <DetailRow label="Bait" value={catchData.bait} />}
        {catchData.rig && <DetailRow label="Rig" value={catchData.rig} />}
        {!catchData.lake && !catchData.swim && !catchData.bait && !catchData.rig && (
          <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>No additional details</div>
        )}
      </div>

      {weather && (weather.tempC != null || weather.conditions || weather.wind || weather.pressure != null) && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 12 }}>Weather</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {weather.tempC != null && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Thermometer size={14} style={{ color: 'var(--text-3)' }} /><span style={{ fontSize: 14, fontWeight: 600 }}>{weather.tempC}°C</span></div>}
            {weather.conditions && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 16 }}>{WEATHER_CONDITIONS.find(w => w.id === weather.conditions)?.icon}</span><span style={{ fontSize: 14, fontWeight: 600 }}>{WEATHER_CONDITIONS.find(w => w.id === weather.conditions)?.label}</span></div>}
            {weather.wind && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Wind size={14} style={{ color: 'var(--text-3)' }} /><span style={{ fontSize: 14, fontWeight: 600 }}>{weather.wind}</span></div>}
            {weather.pressure != null && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>P</span><span style={{ fontSize: 14, fontWeight: 600 }}>{weather.pressure} mb</span></div>}
          </div>
        </div>
      )}

      {moon && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 12 }}>Moon</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 38 }}>{moon.emoji}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{moon.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{(moon.fraction * 100).toFixed(0)}% illuminated</div>
            </div>
          </div>
        </div>
      )}

      {catchData.notes && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="label">Notes</div>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text)', margin: 0, whiteSpace: 'pre-wrap' }}>{catchData.notes}</p>
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <MessageCircle size={14} style={{ color: 'var(--text-3)' }} />
          <div className="label" style={{ marginBottom: 0 }}>Banter ({comments.length})</div>
        </div>
        {comments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {comments.map(c => {
              const ca = anglers.find(a => a.id === c.anglerId);
              const mine = c.anglerId === me.anglerId;
              return (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: ca?.color || 'rgba(20,42,38,0.8)', color: '#1A1004', fontWeight: 700, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {(ca?.name || c.anglerName || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>
                      <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{ca?.name || c.anglerName}</strong>
                      <span> · {new Date(c.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
                  </div>
                  {mine && (
                    <button onClick={() => { if (confirm('Delete comment?')) onDeleteComment(c.id); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Add a comment…" value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim()) { onAddComment(commentText.trim()); setCommentText(''); } }}
            style={{ flex: 1, padding: '10px 14px', fontSize: 14 }}
          />
          <button onClick={() => { if (commentText.trim()) { onAddComment(commentText.trim()); setCommentText(''); } }}
            disabled={!commentText.trim()} className="tap" style={{
              width: 44, height: 44, borderRadius: 12,
              background: commentText.trim() ? 'var(--gold)' : 'rgba(20,42,38,0.7)',
              color: commentText.trim() ? '#1A1004' : 'var(--text-3)',
              border: 'none', cursor: commentText.trim() ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}><Send size={16} /></button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => setEditing(true)} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}><Edit2 size={16} /> Edit</button>
        <button onClick={onDelete} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)', color: 'var(--danger)' }}><Trash2 size={16} /> Delete</button>
      </div>
    </ModalShell>
  );
}

function DetailRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(234,201,136,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13 }}>{icon}{label}</div>
      <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{value}</div>
    </div>
  );
}

// ============ SETTINGS ============
function SettingsModal({
  anglers, me, catches, trips, notify, onClose, onSaveAnglers, onSaveMe, onSaveNotify,
}: {
  anglers: Angler[]; me: { anglerId: string }; catches: CatchT[]; trips: Trip[];
  notify: NotifyConfig | null;
  onClose: () => void;
  onSaveAnglers: (rows: Angler[]) => Promise<void>;
  onSaveMe: (m: { anglerId: string }) => Promise<void>;
  onSaveNotify: (n: NotifyConfig) => Promise<void>;
}) {
  const [editingAnglers, setEditingAnglers] = useState(false);
  const [draft, setDraft] = useState<Angler[]>([...anglers]);
  const [showNotify, setShowNotify] = useState(false);

  function exportCSV() {
    const rows = [['Date', 'Angler', 'Lost', 'Species', 'Lbs', 'Oz', 'Trip', 'Lake', 'Swim', 'Bait', 'Rig', 'TempC', 'Conditions', 'Wind', 'Pressure', 'MoonPhase', 'MoonIllum', 'Notes']];
    catches.forEach(c => {
      const a = anglers.find(x => x.id === c.angler_id);
      const t = c.trip_id ? trips.find(x => x.id === c.trip_id) : null;
      const w = c.weather || {} as Weather;
      const m = c.moon || {} as MoonT;
      rows.push([
        c.date, a?.name || '', c.lost ? 'yes' : '', c.species || '', String(c.lbs || ''), String(c.oz || ''),
        t?.name || '', c.lake || '', c.swim || '', c.bait || '', c.rig || '',
        String(w.tempC ?? ''), w.conditions || '', w.wind || '', String(w.pressure ?? ''),
        m.label || '', m.fraction != null ? Math.round(m.fraction * 100) + '%' : '',
        (c.notes || '').replace(/\n/g, ' '),
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `carp-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }

  return (
    <ModalShell title="Settings" onClose={onClose}>
      <div className="label">You are</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {anglers.map(a => (
          <button key={a.id} onClick={() => onSaveMe({ anglerId: a.id })} className="tap" style={{
            padding: 12, borderRadius: 14,
            background: me.anglerId === a.id ? 'rgba(212,182,115,0.10)' : 'rgba(10,24,22,0.5)',
            border: `1px solid ${me.anglerId === a.id ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)', textAlign: 'left',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: a.color, color: '#1A1004', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a.name[0].toUpperCase()}</div>
            <span style={{ flex: 1, fontWeight: 500 }}>{a.name}</span>
            {me.anglerId === a.id && <Check size={18} style={{ color: 'var(--gold)' }} />}
          </button>
        ))}
      </div>

      <div className="label">Crew</div>
      {!editingAnglers ? (
        <button onClick={() => setEditingAnglers(true)} className="tap" style={{ width: '100%', padding: 14, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: 24 }}>
          <span>Edit angler names</span>
          <ChevronRight size={16} />
        </button>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {draft.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: a.color, color: '#1A1004', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{a.name[0]?.toUpperCase() || '?'}</div>
              <input className="input" value={a.name} onChange={(e) => { const n = [...draft]; n[i] = { ...n[i], name: e.target.value }; setDraft(n); }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }} onClick={() => { setDraft([...anglers]); setEditingAnglers(false); }}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={async () => { await onSaveAnglers(draft); setEditingAnglers(false); }}>Save</button>
          </div>
        </div>
      )}

      <div className="label">Telegram alerts</div>
      <button onClick={() => setShowNotify(!showNotify)} className="tap" style={{
        width: '100%', padding: 14, borderRadius: 14,
        background: 'rgba(10,24,22,0.5)',
        border: `1px solid ${notify?.enabled ? 'var(--sage)' : 'rgba(234,201,136,0.14)'}`,
        color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: showNotify ? 12 : 24,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Bell size={15} style={{ color: notify?.enabled ? 'var(--sage)' : 'var(--text-3)' }} />
          {notify?.enabled ? 'Enabled' : 'Setup'}
        </span>
        <ChevronRight size={16} style={{ transform: showNotify ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {showNotify && (
        <div className="fade-in" style={{ marginBottom: 24 }}>
          <TelegramSetup notify={notify} onSaveNotify={onSaveNotify} />
        </div>
      )}

      <div className="label">Data</div>
      <button onClick={exportCSV} className="tap" style={{ width: '100%', padding: 14, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        <Download size={16} />
        Export catches as CSV
      </button>

      <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid rgba(234,201,136,0.1)', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
        {catches.length} catches · {trips.length} trips logged across the crew
      </div>
    </ModalShell>
  );
}

function TelegramSetup({ notify, onSaveNotify }: { notify: NotifyConfig | null; onSaveNotify: (n: NotifyConfig) => Promise<void> }) {
  const [token, setToken] = useState(notify?.token || '');
  const [chatId, setChatId] = useState(notify?.chat_id || '');
  const [enabled, setEnabled] = useState(notify?.enabled || false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function save(newEnabled: boolean) {
    await onSaveNotify({ token: token || null, chat_id: chatId || null, enabled: newEnabled });
    setEnabled(newEnabled);
  }
  async function test() {
    if (!token || !chatId) return;
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '🎣 <b>Carp Log</b> connected! Ready to ping the group with every catch.', parse_mode: 'HTML' }),
      });
      const data = await r.json();
      if (data.ok) { setTestResult({ ok: true, msg: 'Test message sent — check your group chat' }); await save(true); }
      else setTestResult({ ok: false, msg: data.description || 'Failed to send' });
    } catch { setTestResult({ ok: false, msg: 'Network error — check token/chat ID' }); }
    finally { setTesting(false); }
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Pings the group chat every time anyone banks (or loses) a fish. One person sets it up, all 3 get the alerts.
      </p>
      <details style={{ marginBottom: 14 }}>
        <summary style={{ fontSize: 12, color: 'var(--gold-2)', cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>How to set up (tap)</summary>
        <ol style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, paddingLeft: 18, margin: '8px 0 0' }}>
          <li>Open Telegram, search <strong>@BotFather</strong>, send <code>/newbot</code>, follow prompts. Copy the bot token.</li>
          <li>Create a group chat with your mates, add the bot to it.</li>
          <li>Send any message in the group, then visit <code>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> in a browser to find the <code>chat.id</code> (negative for groups).</li>
          <li>Paste both below and tap Test.</li>
        </ol>
      </details>
      <label className="label">Bot token</label>
      <input className="input" type="password" placeholder="123456:ABC-DEF..." value={token} onChange={(e) => setToken(e.target.value)} style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 13 }} />
      <label className="label">Chat ID</label>
      <input className="input" placeholder="-100123456..." value={chatId} onChange={(e) => setChatId(e.target.value)} style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 13 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={test} disabled={!token || !chatId || testing} className="btn tap" style={{
          flex: 1, padding: '12px', borderRadius: 12,
          background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.2)',
          color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          {testing ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          Test &amp; enable
        </button>
        {enabled && (
          <button onClick={() => save(false)} className="btn tap" style={{
            padding: '12px 16px', borderRadius: 12,
            background: 'transparent', border: '1px solid rgba(234,201,136,0.18)',
            color: 'var(--text-3)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Disable</button>
        )}
      </div>
      {testResult && (
        <div style={{
          padding: 10, borderRadius: 10, fontSize: 12,
          background: testResult.ok ? 'rgba(141,191,157,0.15)' : 'rgba(220,107,88,0.12)',
          border: `1px solid ${testResult.ok ? 'rgba(141,191,157,0.4)' : 'rgba(220,107,88,0.3)'}`,
          color: testResult.ok ? 'var(--sage)' : 'var(--danger)',
        }}>{testResult.msg}</div>
      )}
    </div>
  );
}

// ============ SHELL ============
function ModalShell({ title, onClose, hideTitle, children }: { title?: string; onClose: () => void; hideTitle?: boolean; children: React.ReactNode }) {
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(3, 10, 9, 0.7)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div className="slide-up" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, maxHeight: '92vh',
        background: 'rgba(10, 24, 22, 0.92)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '28px 28px 0 0',
        border: '1px solid rgba(234,201,136,0.14)', borderBottom: 'none',
        overflowY: 'auto', position: 'relative', padding: '20px 20px 40px',
        boxShadow: '0 -10px 40px rgba(0,0,0,0.45)',
      }}>
        <div className="sheet-handle" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hideTitle ? 8 : 16, position: 'sticky', top: 0, paddingTop: 8, paddingBottom: 8, zIndex: 10, background: 'transparent' }}>
          {!hideTitle && <h2 className="display-font" style={{ fontSize: 22, margin: 0, fontWeight: 500 }}>{title}</h2>}
          {hideTitle ? (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, padding: 4, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer' }}>
              <ArrowLeft size={18} /> Back
            </button>
          ) : (
            <button onClick={onClose} style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 12, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}>
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function FAB({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="tap" style={{
      position: 'fixed', bottom: 92, left: '50%', transform: 'translateX(-50%)',
      width: 64, height: 64, borderRadius: 999,
      background: 'linear-gradient(180deg, var(--gold-2), var(--gold))',
      border: '3px solid rgba(5,14,13,0.9)',
      boxShadow: '0 12px 28px rgba(212,182,115,0.4), 0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#1A1004', cursor: 'pointer', zIndex: 50,
    }}>
      <Plus size={28} strokeWidth={2.5} />
    </button>
  );
}

function BottomNav({ view, onChange }: { view: string; onChange: (v: 'feed' | 'trips' | 'stats' | 'gallery') => void }) {
  const items = [
    { id: 'feed' as const,    label: 'Log',    icon: Fish },
    { id: 'trips' as const,   label: 'Trips',  icon: Tent },
    { id: 'stats' as const,   label: 'Stats',  icon: Trophy },
    { id: 'gallery' as const, label: 'Photos', icon: Images },
  ];
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, right: 16,
      maxWidth: 448, margin: '0 auto',
      background: 'rgba(28, 60, 54, 0.55)',
      backdropFilter: 'blur(40px) saturate(180%)',
      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      border: '1px solid rgba(234,201,136,0.16)',
      borderRadius: 28,
      padding: '10px 8px', zIndex: 40,
      display: 'flex', justifyContent: 'space-around',
      boxShadow: '0 12px 36px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)',
    }}>
      {items.map(item => {
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <button key={item.id} onClick={() => onChange(item.id)} className="tap" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '6px 12px', minWidth: 60,
            color: active ? 'var(--gold-2)' : 'var(--text-3)',
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
          }}>
            <Icon size={20} strokeWidth={active ? 2.4 : 2} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
