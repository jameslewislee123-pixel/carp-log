'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Camera, Plus, Trophy, Images, Settings, X, Check, Fish, MapPin, Calendar,
  Edit2, Trash2, ChevronRight, Loader2, Download, ArrowLeft, Sparkles, Crown,
  Cloud, Wind, Thermometer, MessageCircle, Bell, Send, Anchor, BarChart3,
  Clock, Tent, MapPinned, Star, Users as UsersIcon, Lock, LogOut, UserPlus, Mail,
  Activity as ActivityIcon, Map as MapIcon, MessageSquare, ThumbsUp, Search,
} from 'lucide-react';
import { Drawer } from 'vaul';
import nextDynamic from 'next/dynamic';
const DiscoverVenues = nextDynamic(() => import('./DiscoverVenues'), { ssr: false });
const LakesView = nextDynamic(() => import('./LakesView'), { ssr: false });
import InvitePicker from './InvitePicker';
import TripChat from './TripChat';
import TripActivityFeed from './TripActivity';
import TripMap from './TripMap';
import TripLeaderboard from './TripLeaderboard';
import TripStatusPill from './TripStatusPill';
import SwimRollModal, { SwimRollResultCard } from './SwimRollModal';
import WeatherForecastCard, { WeatherLocationSearch, readWxOverride, writeWxOverride, type WxLoc } from './WeatherForecastCard';
import GearItemPicker from './GearItemPicker';
import GearManager from './GearManager';
import LakeDetail from './LakeDetail';
import PushSettings from './PushSettings';
import { readBgAnimationEnabled, writeBgAnimationEnabled } from './UnderwaterLottie';
import type { TripSwimRoll } from '@/lib/types';
import { Dices } from 'lucide-react';

import { useQueryClient } from '@tanstack/react-query';
import { hasSupabase, supabase } from '@/lib/supabase/client';
import * as db from '@/lib/db';
import {
  useMe, useCatches, useTrips, useMyNotifyConfig, useUnreadCount,
  useProfilesByIds, useCommentCounts, useLakes, prefetchTrip, prefetchLake, prefetchNotifications,
} from '@/lib/queries';
import { QK } from '@/lib/queryKeys';
import type {
  Profile, Catch as CatchT, Comment, Moon as MoonT, NotifyConfig, Trip, TripMember, Weather, CatchVisibility, TripVisibility,
} from '@/lib/types';
import {
  formatDate, formatDateRange, formatWeight, totalOz, compressImage, sendTelegram,
  isoToLocalDateTimeInput, isoToLocalDateInput, nowLocalDateTimeInput, todayLocalDateInput, tomorrowLocalDateInput,
} from '@/lib/util';
import {
  getMoonIllumination, getMoonPhaseLabel, getSolunarWindows,
  isInSolunarWindow, getBiteRating,
} from '@/lib/suncalc';
import { fetchWeatherFor, geocodeLake, getCurrentLocation } from '@/lib/weather';
import AvatarBubble from './AvatarBubble';
import CatchCard, { SPECIES, computePBMap } from './CatchCard';

const ANGLER_COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4'];
const WEATHER_CONDITIONS = [
  { id: 'sunny',    label: 'Sunny',    icon: '☀️' },
  { id: 'cloudy',   label: 'Cloudy',   icon: '☁️' },
  { id: 'overcast', label: 'Overcast', icon: '🌥️' },
  { id: 'rain',     label: 'Rain',     icon: '🌧️' },
  { id: 'storm',    label: 'Storm',    icon: '⛈️' },
  { id: 'mist',     label: 'Mist',     icon: '🌫️' },
];
const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LOC_KEY = 'carp_log_loc_v1';

export default function CarpApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  // ───── data layer (TanStack Query — cached, deduped, revalidated) ─────
  const meQuery       = useMe();
  const catchesQuery  = useCatches();
  const tripsQuery    = useTrips();
  const notifyQuery   = useMyNotifyConfig();
  const unreadQuery   = useUnreadCount();

  const me      = meQuery.data || null;
  const catches = catchesQuery.data || [];
  const trips   = tripsQuery.data || [];
  const notify  = notifyQuery.data || null;
  const unread  = unreadQuery.data || 0;

  // Derive the union of profile ids referenced by catches+trips+comments+me,
  // then batch-fetch them as a single keyed cache entry.
  const profileIds = useMemo(() => {
    const s = new Set<string>();
    if (me) s.add(me.id);
    catches.forEach(c => {
      s.add(c.angler_id);
      (c.comments || []).forEach(cm => cm.anglerId && s.add(cm.anglerId));
    });
    trips.forEach(t => s.add(t.owner_id));
    return Array.from(s);
  }, [me, catches, trips]);
  const profilesQuery = useProfilesByIds(profileIds);
  const profilesById = profilesQuery.data || {};

  // Comment counts derived from currently-loaded catches.
  const catchIds = useMemo(() => catches.map(c => c.id), [catches]);
  const commentCountsQuery = useCommentCounts(catchIds);
  const commentCounts = commentCountsQuery.data || {};

  // ───── ephemeral UI state (kept as useState — these are not server data) ─────
  const [view, setView] = useState<'feed' | 'trips' | 'stats' | 'lakes'>('feed');
  // Migration: previous versions stored 'gallery' (Photos tab) — silently
  // redirect anyone arriving with that state to the new Lakes tab.
  useEffect(() => {
    if ((view as string) === 'gallery') setView('lakes');
  }, [view]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailCatch, setDetailCatch] = useState<CatchT | null>(null);
  const [detailTrip, setDetailTrip] = useState<Trip | null>(null);
  const [detailLakeName, setDetailLakeName] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Auth gate: if /me has resolved to null, send to sign-in.
  useEffect(() => {
    if (!hasSupabase) {
      setSetupError('Supabase env vars are missing. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }
    if (meQuery.isFetched && !me) router.replace('/auth/sign-in');
  }, [meQuery.isFetched, me, router]);

  // Open a catch by ?catch=<id> query param (deep link from /profile or
  // /notifications). Optional ?back=/foo: closing the modal navigates back.
  const [catchBackTo, setCatchBackTo] = useState<string | null>(null);
  useEffect(() => {
    const id = searchParams?.get('catch');
    if (!id || catches.length === 0) return;
    const c = catches.find(x => x.id === id);
    if (c) {
      setDetailCatch(c);
      const back = searchParams?.get('back');
      if (back && back.startsWith('/')) setCatchBackTo(back);
      const u = new URL(window.location.href);
      u.searchParams.delete('catch');
      u.searchParams.delete('back');
      window.history.replaceState({}, '', u.toString());
    }
  }, [searchParams, catches]);

  // Open a trip by ?trip=<id> (deep link from /notifications).
  useEffect(() => {
    const id = searchParams?.get('trip');
    if (!id || trips.length === 0) return;
    const t = trips.find(x => x.id === id);
    if (t) {
      setDetailTrip(t);
      const u = new URL(window.location.href);
      u.searchParams.delete('trip');
      window.history.replaceState({}, '', u.toString());
    }
  }, [searchParams, trips]);

  // ───── realtime → cache merge (no full refetches) ─────
  // INSERT: prepend / append to cache via setQueryData (instant UI update).
  // UPDATE: map the changed row in-place.
  // DELETE: filter out, OR invalidate so a fetch reconciles. Both are cheap.
  useEffect(() => {
    if (!hasSupabase || !me) return;
    const ch = supabase()
      .channel('carp-log-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'catches' }, (payload) => {
        const row = payload.new as CatchT;
        qc.setQueryData<CatchT[]>(QK.catches.all, (old) => {
          if (!old) return [row];
          if (old.find(c => c.id === row.id)) return old;
          return [row, ...old];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'catches' }, (payload) => {
        const row = payload.new as CatchT;
        qc.setQueryData<CatchT[]>(QK.catches.all, (old) => old?.map(c => c.id === row.id ? row : c));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'catches' }, (payload) => {
        const old_id = (payload.old as { id?: string }).id;
        if (!old_id) return;
        qc.setQueryData<CatchT[]>(QK.catches.all, (old) => old?.filter(c => c.id !== old_id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
        qc.invalidateQueries({ queryKey: QK.trips.all });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me.id}` }, () => {
        qc.invalidateQueries({ queryKey: QK.notifications.unread });
        qc.invalidateQueries({ queryKey: QK.notifications.list });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catch_comments' }, (payload) => {
        const row = (payload.new || payload.old) as { catch_id?: string };
        if (!row?.catch_id) return;
        // Only the count for this one catch needs to refresh; the comment list
        // for an open catch detail re-syncs via its own per-catch subscription.
        qc.invalidateQueries({ queryKey: ['comments', 'counts'] });
      })
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  }, [me, qc]);

  const meAngler = me;
  const activeTrips = useMemo(() => trips.filter(t => {
    const now = Date.now();
    return new Date(t.start_date).getTime() <= now && new Date(t.end_date).getTime() >= now - 86400000;
  }), [trips]);

  async function saveCatch(input: db.CatchInput, photoDataUrl: string | null, isNew: boolean) {
    const saved = await db.upsertCatch(input);
    if (photoDataUrl) {
      try { await db.uploadPhotoFromDataUrl(saved.id, photoDataUrl); } catch (e) { console.warn('photo upload failed', e); }
    }
    // Realtime usually beats us to the cache, but invalidate for safety so
    // edits and photo-uploads always reconcile.
    qc.invalidateQueries({ queryKey: QK.catches.all });
    if (isNew) {
      // 1) Personal Telegram alert if user has notify enabled
      if (notify?.enabled) {
        const species = SPECIES.find(s => s.id === saved.species);
        const msg = saved.lost
          ? `💔 <b>${me?.display_name || ''}</b> lost one${saved.swim ? ` at swim ${saved.swim}` : ''}${saved.rig ? ` on a ${saved.rig}` : ''}`
          : `🎣 <b>${me?.display_name || ''}</b> just banked <b>${formatWeight(saved.lbs, saved.oz)}</b>${species ? ` ${species.label.toLowerCase()}` : ''}${saved.lake ? ` at ${saved.lake}` : ''}${saved.swim ? ` (swim ${saved.swim})` : ''}${saved.bait ? `\n🎯 Bait: ${saved.bait}` : ''}`;
        sendTelegram({ token: notify.token, chat_id: notify.chat_id, enabled: notify.enabled }, msg);
      }
      // 2) If trip-attached, ping the trip owner's Telegram (different person than me).
      if (saved.trip_id) {
        const trip = trips.find(t => t.id === saved.trip_id);
        if (trip && trip.owner_id !== me?.id) {
          const ownerCfg = await db.getNotifyForAngler(trip.owner_id).catch(() => null);
          if (ownerCfg?.enabled) {
            const msg = saved.lost
              ? `💔 <b>${me?.display_name || ''}</b> lost one on your trip <b>${trip.name}</b>`
              : `🎣 <b>${me?.display_name || ''}</b> banked <b>${formatWeight(saved.lbs, saved.oz)}</b> on your trip <b>${trip.name}</b>`;
            sendTelegram({ token: ownerCfg.token, chat_id: ownerCfg.chat_id, enabled: ownerCfg.enabled }, msg);
          }
        }
      }
    }
    return saved;
  }

  async function deleteCatchHandler(id: string) {
    await db.deleteCatch(id);
    qc.invalidateQueries({ queryKey: QK.catches.all });
  }

  async function deleteTripHandler(id: string) {
    await db.deleteTrip(id);
    qc.invalidateQueries({ queryKey: QK.trips.all });
    // Catches lose their trip_id, so refresh the catches cache too.
    qc.invalidateQueries({ queryKey: QK.catches.all });
  }
  async function saveNotifyHandler(n: { token: string | null; chat_id: string | null; enabled: boolean }) {
    await db.saveMyNotify(n);
    qc.invalidateQueries({ queryKey: QK.notifyConfig });
  }

  if (setupError) return (
    <div className="app-root"><div className="app-content" style={{ padding: 24 }}>
      <h1 className="display-font" style={{ fontSize: 28, color: 'var(--gold-2)' }}>Carp Log</h1>
      <p style={{ color: 'var(--text-2)' }}>{setupError}</p>
    </div></div>
  );

  // First-load spinner: only when nothing is in cache yet. Subsequent visits
  // render cached data immediately and fade in any new data via background refetch.
  const initialLoading = (meQuery.isLoading && !me) || (catchesQuery.isLoading && catches.length === 0);
  if (initialLoading || !me) return (
    <div className="app-root"><div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <Fish size={48} style={{ color: 'var(--gold)' }} />
      <Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} />
    </div></div>
  );

  return (
    <div className="app-root">
      <div className="app-content">
        <Header me={meAngler} unread={unread} onSettings={() => setShowSettings(true)} view={view} />

        {view === 'feed' && (
          <Feed
            me={me} catches={catches} trips={trips} profilesById={profilesById}
            commentCounts={commentCounts}
            onOpen={setDetailCatch} onOpenTrip={setDetailTrip}
          />
        )}
        {view === 'trips' && (
          <TripsView
            me={me} trips={trips} catches={catches} profilesById={profilesById}
            onOpenTrip={setDetailTrip}
            onAddTrip={() => { setEditTrip(null); setShowAddTrip(true); }}
          />
        )}
        {view === 'stats' && (
          <Stats catches={catches} profilesById={profilesById} me={me} onOpen={setDetailCatch} />
        )}
        {view === 'lakes' && (
          <LakesView onOpenLake={(name) => setDetailLakeName(name)} />
        )}
      </div>

      <FAB onClick={() => setShowAdd(true)} />
      <BottomNav view={view} onChange={setView} />

      {showAdd && (
        <AddCatchModal
          me={me} trips={trips} activeTrips={activeTrips}
          onClose={() => setShowAdd(false)}
          onSave={async (data, photo) => { await saveCatch(data, photo, true); setShowAdd(false); }}
        />
      )}
      {detailLakeName && (
        <LakeDetailLoader name={detailLakeName} catches={catches} profilesById={profilesById} me={me}
          onClose={() => setDetailLakeName(null)} onOpenCatch={setDetailCatch} />
      )}
      {detailTrip && (
        <TripDetail
          me={me} trip={detailTrip} catches={catches} profilesById={profilesById}
          onClose={() => setDetailTrip(null)}
          onEdit={() => { setEditTrip(detailTrip); setShowAddTrip(true); setDetailTrip(null); }}
          onDelete={async () => {
            if (confirm('Delete this trip? Catches will stay but become unlinked.')) { await deleteTripHandler(detailTrip.id); setDetailTrip(null); }
          }}
          onOpenCatch={setDetailCatch}
        />
      )}
      {/* CatchDetail renders AFTER TripDetail in JSX so it stacks ABOVE the trip
          modal. Closing the catch detail leaves the trip modal mounted underneath. */}
      {detailCatch && (
        <CatchDetail
          catchData={detailCatch} me={me} profilesById={profilesById} trips={trips}
          stackLevel={detailTrip ? 1 : 0}
          onClose={() => {
            setDetailCatch(null);
            if (catchBackTo) { const dest = catchBackTo; setCatchBackTo(null); router.push(dest); }
          }}
          onDelete={async () => { if (confirm('Delete this catch?')) { await deleteCatchHandler(detailCatch.id); setDetailCatch(null); } }}
          onUpdate={async (data, photo) => {
            const saved = await saveCatch({ ...data, id: detailCatch.id }, photo, false);
            setDetailCatch(saved);
          }}
          onOpenTrip={(t) => { setDetailCatch(null); setDetailTrip(t); }}
        />
      )}
      {showAddTrip && (
        <AddTripModal
          existing={editTrip} me={me}
          onClose={() => { setShowAddTrip(false); setEditTrip(null); }}
          onSave={async (data, inviteIds) => {
            if (editTrip) {
              await db.upsertTrip({ ...data, id: editTrip.id });
            } else {
              await db.createTripWithInvites(data, inviteIds);
            }
            setShowAddTrip(false); setEditTrip(null);
          }}
        />
      )}
      {showSettings && (
        <SettingsModal
          me={me} catches={catches} trips={trips} notify={notify}
          onClose={() => setShowSettings(false)}
          onSaveProfile={async (patch) => { await db.updateProfile(patch); qc.invalidateQueries({ queryKey: QK.profiles.me }); }}
          onSaveNotify={saveNotifyHandler}
        />
      )}
    </div>
  );
}

// ============ HEADER ============
function Header({ me, unread, onSettings, view }: { me: Profile | null; unread: number; onSettings: () => void; view: string }) {
  const qc = useQueryClient();
  const titles: Record<string, string> = { feed: 'The Log', trips: 'Trips', stats: 'The Board', lakes: 'Lakes' };
  return (
    <div style={{ paddingTop: 'max(24px, env(safe-area-inset-top))', paddingLeft: 20, paddingRight: 20, paddingBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>Carp Tracker</div>
        <h1 className="display-font" style={{ fontSize: 30, margin: '2px 0 0', fontWeight: 500, letterSpacing: '-0.02em' }}>{titles[view]}</h1>
      </div>
      <Link href="/notifications" className="tap"
        onMouseEnter={() => prefetchNotifications(qc)}
        onTouchStart={() => prefetchNotifications(qc)}
        style={{
        position: 'relative', width: 42, height: 42, borderRadius: 14,
        background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-2)', textDecoration: 'none',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      }}>
        <Bell size={18} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: 'var(--danger)', color: '#FFF', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
      <Link href="/friends" className="tap" style={{
        width: 42, height: 42, borderRadius: 14,
        background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-2)', textDecoration: 'none',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      }}>
        <UsersIcon size={18} />
      </Link>
      <button onClick={onSettings} className="tap" style={{
        width: 42, height: 42, borderRadius: 14,
        background: me?.avatar_url ? `center/cover no-repeat url("${me.avatar_url}")` : (me ? 'var(--gold)' : 'rgba(10,24,22,0.55)'),
        border: '1px solid rgba(234,201,136,0.18)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#1A1004', fontWeight: 700, fontSize: 16,
        boxShadow: '0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3)',
      }}>
        {!me?.avatar_url && (me?.display_name?.[0]?.toUpperCase() || <Settings size={18} />)}
      </button>
    </div>
  );
}

// ============ FEED ============
function Feed({ me, catches, trips, profilesById, commentCounts, onOpen, onOpenTrip }: {
  me: Profile;
  catches: CatchT[]; trips: Trip[]; profilesById: Record<string, Profile>;
  commentCounts: Record<string, number>;
  onOpen: (c: CatchT) => void; onOpenTrip: (t: Trip) => void;
}) {
  const pbByAngler = useMemo(() => computePBMap(catches), [catches]);
  const [filter, setFilter] = useState<'all' | 'mine' | string>('all');
  const filtered = useMemo(() => {
    const sorted = [...catches].sort((a, b) => +new Date(b.date) - +new Date(a.date));
    if (filter === 'all') return sorted;
    if (filter === 'mine') return sorted.filter(c => c.angler_id === me.id);
    return sorted.filter(c => c.angler_id === filter);
  }, [catches, filter, me.id]);

  const activeTrip = useMemo(() => {
    const now = Date.now();
    return trips.find(t => +new Date(t.start_date) <= now && +new Date(t.end_date) >= now - 86400000);
  }, [trips]);

  // chips show distinct anglers visible in the feed (sorted: me first, then others by recency)
  const anglerChips = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const c of catches) {
      if (!seen.has(c.angler_id)) { seen.add(c.angler_id); order.push(c.angler_id); }
    }
    return order
      .map(id => profilesById[id])
      .filter((p): p is Profile => !!p && p.id !== me.id);
  }, [catches, profilesById, me.id]);

  return (
    <div style={{ padding: '8px 20px' }}>
      <ForecastCarousel catches={catches} />
      {activeTrip && <ActiveTripBanner trip={activeTrip} catches={catches} onClick={() => onOpenTrip(activeTrip)} />}
      <div className="scrollbar-thin" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        <Chip active={filter === 'all'}  onClick={() => setFilter('all')}>All visible</Chip>
        <Chip active={filter === 'mine'} onClick={() => setFilter('mine')}>My catches</Chip>
        {anglerChips.map(p => (
          <Chip key={p.id} active={filter === p.id} onClick={() => setFilter(p.id)}>{p.display_name}</Chip>
        ))}
      </div>
      {filtered.length === 0 ? <EmptyState /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map(c => (
            <CatchCard key={c.id} catchData={c}
              angler={profilesById[c.angler_id] || null}
              trip={c.trip_id ? trips.find(t => t.id === c.trip_id) || null : null}
              commentCount={commentCounts[c.id] || 0}
              pb={pbByAngler[c.angler_id] === c.id}
              onClick={() => onOpen(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ BITE & WEATHER CAROUSEL ============
function useFeedCoords(catches: CatchT[]) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(LOC_KEY) : null;
      if (stored) { try { const j = JSON.parse(stored); if (!cancelled) setCoords(j); return; } catch {} }
      const gps = await getCurrentLocation();
      if (gps) { if (!cancelled) { setCoords(gps); localStorage.setItem(LOC_KEY, JSON.stringify(gps)); } return; }
      const lastWithLake = [...catches].reverse().find(c => c.lake);
      if (lastWithLake?.lake) {
        const g = await geocodeLake(lastWithLake.lake);
        if (g && !cancelled) { setCoords(g); localStorage.setItem(LOC_KEY, JSON.stringify(g)); return; }
      }
      if (!cancelled) setCoords({ lat: 52.05, lng: -0.7 });
    })();
    return () => { cancelled = true; };
  }, [catches.length]); // eslint-disable-line
  return coords;
}

function ForecastCarousel({ catches }: { catches: CatchT[] }) {
  const coords = useFeedCoords(catches);
  const ref = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<'bite' | 'weather' | null>(null);
  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    setPage(Math.round(el.scrollLeft / Math.max(1, w)));
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <div ref={ref} onScroll={onScroll}
        className="scrollbar-thin"
        style={{
          display: 'grid', gridAutoFlow: 'column', gap: 10,
          gridAutoColumns: '100%',
          overflowX: 'auto', scrollSnapType: 'x mandatory',
          touchAction: 'pan-x pan-y',
        }}>
        <TappableSlide onTap={() => setExpanded('bite')} style={{ scrollSnapAlign: 'center', height: 92 }}>
          <BiteForecastCard coords={coords} compact />
        </TappableSlide>
        <TappableSlide onTap={() => setExpanded('weather')} style={{ scrollSnapAlign: 'center', height: 92 }}>
          <WeatherForecastCard coords={coords} compact />
        </TappableSlide>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 6 }}>
        {[0, 1].map(i => (
          <span key={i} style={{
            width: i === page ? 18 : 6, height: 6, borderRadius: 999,
            background: i === page ? 'var(--gold-2)' : 'rgba(234,201,136,0.25)',
            transition: 'width 0.25s var(--spring), background 0.25s var(--spring)',
          }} />
        ))}
      </div>

      {expanded === 'bite' && coords && (
        <BiteForecastModal coords={coords} onClose={() => setExpanded(null)} />
      )}
      {expanded === 'weather' && coords && (
        <WeatherForecastModal coords={coords} onClose={() => setExpanded(null)} />
      )}
    </div>
  );
}

// Tap-vs-swipe detector for cards inside the horizontal carousel.
// Swipe (>10px movement) → bubble up to the scroll container; tap (<10px) → fire onTap.
function TappableSlide({ onTap, style, children }: { onTap: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const handledTouchRef = useRef(false);
  return (
    <div
      style={{ ...style, cursor: 'pointer' }}
      onTouchStart={(e) => { startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => {
        const s = startRef.current;
        startRef.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.hypot(dx, dy) < 10) {
          handledTouchRef.current = true;
          setTimeout(() => { handledTouchRef.current = false; }, 500);
          onTap();
        }
      }}
      onClick={() => { if (!handledTouchRef.current) onTap(); }}
    >
      {children}
    </div>
  );
}

function BiteForecastCard({ coords, compact }: { coords: { lat: number; lng: number } | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
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
  if (!data) return (
    <div style={{ height: '100%', padding: 14, borderRadius: 22, border: '1px solid rgba(234,201,136,0.18)', background: 'rgba(28,60,54,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Loading bite forecast…</span>
    </div>
  );
  const { phaseInfo, ill, rating, windows, cur, upcoming } = data;
  const showExpansion = open && !compact;
  return (
    <div onClick={() => !compact && setOpen(o => !o)} className="fade-in" style={{
      height: compact ? '100%' : 'auto',
      padding: 14, borderRadius: 22,
      background: 'linear-gradient(135deg, rgba(234,201,136,0.18), rgba(212,182,115,0.06))',
      border: '1px solid rgba(234, 201, 136, 0.35)',
      backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      cursor: compact ? 'default' : 'pointer', position: 'relative', overflow: 'hidden',
      boxShadow: '0 10px 30px -10px rgba(212,182,115,0.25)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>{phaseInfo.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Bite Forecast</div>
          <div className="display-font" style={{ fontSize: 18, color: 'var(--text)', fontWeight: 500 }}>{phaseInfo.label} · {(ill.fraction * 100).toFixed(0)}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>{rating.reason}</div>
        </div>
        <div style={{ display: 'flex', gap: 1 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} size={14} fill={i < rating.stars ? 'var(--gold-2)' : 'transparent'}
              style={{ color: i < rating.stars ? 'var(--gold-2)' : 'var(--text-3)' }} />
          ))}
        </div>
        {!compact && <ChevronRight size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />}
      </div>
      {showExpansion && (
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
              ) : <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>None today</div>}
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
                  <div style={{ width: 8, height: 8, borderRadius: 999, background: w.kind === 'major' ? 'var(--gold-2)' : 'var(--sage)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, minWidth: 50 }}>{w.kind === 'major' ? 'Major' : 'Minor'}</span>
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

// ============ BITE FORECAST EXPANDED MODAL ============
function BiteForecastModal({ coords, onClose }: { coords: { lat: number; lng: number }; onClose: () => void }) {
  const now = new Date();
  const ill = useMemo(() => getMoonIllumination(now), []);
  const phaseInfo = useMemo(() => getMoonPhaseLabel(ill.phase), [ill.phase]);
  const rating = useMemo(() => getBiteRating(now, coords.lat, coords.lng), [coords.lat, coords.lng]);
  const windows = useMemo(() => getSolunarWindows(now, coords.lat, coords.lng), [coords.lat, coords.lng]);
  const cur = useMemo(() => isInSolunarWindow(now, windows), [windows]);
  const upcoming = useMemo(() => windows.filter(w => w.start.getTime() > now.getTime()).slice(0, 1)[0] || null, [windows]);

  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i);
    const il = getMoonIllumination(d);
    const lab = getMoonPhaseLabel(il.phase);
    const r = getBiteRating(d, coords.lat, coords.lng);
    return { date: d, ill: il, label: lab, rating: r };
  }), [coords.lat, coords.lng]);

  const ratingTone = rating.stars >= 4 ? 'var(--sage)' : rating.stars >= 3 ? 'var(--gold-2)' : 'var(--text-3)';

  return (
    <VaulModalShell title="Bite Forecast" onClose={onClose}>
      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '12px 0 18px' }}>
        <div style={{ fontSize: 80, lineHeight: 1, filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.45))' }}>{phaseInfo.emoji}</div>
        <div className="display-font" style={{ fontSize: 26, fontWeight: 500, marginTop: 10 }}>{phaseInfo.label}</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          {(ill.fraction * 100).toFixed(0)}% illuminated
        </div>
        <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="pill" style={{ background: `color-mix(in srgb, ${ratingTone} 20%, transparent)`, color: ratingTone, border: `1px solid ${ratingTone}` }}>
            <Star size={11} fill="currentColor" /> {rating.label}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>{rating.reason}</div>
      </div>

      {/* Today's windows */}
      <div className="label">Today's solunar windows</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {windows.map((w, i) => {
          const isCur = cur === w;
          const isNext = !cur && upcoming === w;
          const tone = w.kind === 'major' ? 'var(--gold-2)' : 'var(--sage)';
          return (
            <div key={i} className="card" style={{
              padding: 12, display: 'flex', alignItems: 'center', gap: 10,
              borderColor: isCur ? 'var(--gold)' : isNext ? 'rgba(234,201,136,0.3)' : 'rgba(234,201,136,0.14)',
              background: isCur ? 'rgba(212,182,115,0.16)' : 'rgba(10,24,22,0.55)',
            }}>
              <span className="pill" style={{
                background: `color-mix(in srgb, ${tone} 15%, transparent)`,
                color: tone, border: `1px solid ${tone}`, minWidth: 56, justifyContent: 'center',
              }}>{w.kind === 'major' ? 'Major' : 'Minor'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>
                  {w.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {w.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{w.centerLabel}</div>
              </div>
              {isCur && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Now</span>}
              {isNext && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Next</span>}
            </div>
          );
        })}
      </div>

      {/* 7-day mini calendar */}
      <div className="label">Next 7 days</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {days.map((d, i) => {
          const tone = d.rating.stars >= 4 ? 'var(--sage)' : d.rating.stars >= 3 ? 'var(--gold-2)' : 'var(--text-3)';
          return (
            <div key={i} className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 56, fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {i === 0 ? 'Today' : d.date.toLocaleDateString('en', { weekday: 'short' })}
              </div>
              <div style={{ fontSize: 24, lineHeight: 1 }}>{d.label.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{(d.ill.fraction * 100).toFixed(0)}% illum.</div>
              </div>
              <div style={{ display: 'flex', gap: 1 }}>
                {Array.from({ length: 5 }).map((_, n) => (
                  <Star key={n} size={10}
                    fill={n < d.rating.stars ? tone : 'transparent'}
                    style={{ color: n < d.rating.stars ? tone : 'var(--text-3)' }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 10px' }}>
        Major windows: moon overhead or underfoot. Minor windows: moonrise / moonset. Best fishing typically lines up with new and full moons.
      </p>
    </VaulModalShell>
  );
}

// ============ WEATHER EXPANDED MODAL ============
function WeatherForecastModal({ coords, onClose }: { coords: { lat: number; lng: number }; onClose: () => void }) {
  // Honour the saved location override so the modal stays in sync with the
  // compact card. If the user picks a new location from inside the modal we
  // update both this state and localStorage so the compact card sees it on
  // re-mount.
  const [override, setOverride] = useState<WxLoc | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { setOverride(readWxOverride()); }, []);
  const effective = override ? { lat: override.lat, lng: override.lng } : coords;
  const locationName = override?.name || null;

  // Reuse the same fetcher (cached for 30 min in lib/weather).
  const [data, setData] = useState<import('@/lib/weather').ForecastBundle | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    import('@/lib/weather').then(({ fetchExtendedForecast }) => fetchExtendedForecast(effective.lat, effective.lng))
      .then(r => { if (!cancelled) setData(r); });
    return () => { cancelled = true; };
  }, [effective.lat, effective.lng]);

  // Magnifier rendered inline next to the title (avoids iOS notch clipping
  // that the previous absolutely-positioned variant suffered).
  const headerSearchBtn = (
    <button
      onClick={() => setSearchOpen(true)}
      aria-label="Change location"
      style={{
        background: 'rgba(239, 233, 217, 0.10)',
        border: '1px solid rgba(239, 233, 217, 0.18)',
        borderRadius: 999,
        width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--text-2)',
        flexShrink: 0,
      }}>
      <Search size={14} />
    </button>
  );

  if (!data) {
    return (
      <VaulModalShell title={locationName || 'Weather'} onClose={onClose} headerAction={headerSearchBtn}>
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-3)', fontSize: 13 }}>
          <Loader2 size={18} className="spin" /> Loading forecast…
        </div>
        {searchOpen && (
          <WeatherLocationSearch
            onClose={() => setSearchOpen(false)}
            onPick={(loc) => { writeWxOverride(loc); setOverride(loc); setSearchOpen(false); }}
            onReset={() => { writeWxOverride(null); setOverride(null); setSearchOpen(false); }}
            canReset={!!override}
          />
        )}
      </VaulModalShell>
    );
  }

  const c = data.current;
  // Slice the hourly arrays starting from the current hour, take next 24.
  const hourlyStart = data.hourly.time.findIndex(t => t.getTime() >= Date.now());
  const hi = hourlyStart === -1 ? 0 : hourlyStart;
  const hours = data.hourly.time.slice(hi, hi + 24).map((t, i) => ({
    t,
    temp: data.hourly.temp[hi + i],
    pop:  data.hourly.pop[hi + i],
    code: data.hourly.code[hi + i],
  }));

  const today = data.daily.time[0];
  const sunrise = data.daily.sunrise[0];
  const sunset  = data.daily.sunset[0];
  const tMax    = data.daily.tMax[0];
  const tMin    = data.daily.tMin[0];

  // Pressure trend: 24h past + 24h future.
  const pSeries = (() => {
    const now = Date.now();
    const fromIdx = data.hourly.time.findIndex(t => t.getTime() >= now - 24 * 3600_000);
    const toIdx   = data.hourly.time.findIndex(t => t.getTime() >  now + 24 * 3600_000);
    const start = fromIdx === -1 ? 0 : fromIdx;
    const end   = toIdx === -1 ? data.hourly.time.length : toIdx;
    const times = data.hourly.time.slice(start, end);
    const pres  = data.hourly.pressure.slice(start, end);
    if (times.length < 2) return null;
    const min = Math.min(...pres), max = Math.max(...pres);
    const span = Math.max(4, max - min);
    const nowIdx = times.findIndex(t => t.getTime() >= now);
    return { times, pres, min, max, span, nowIdx: nowIdx === -1 ? times.length - 1 : nowIdx };
  })();
  const pTrend = (() => {
    if (data.hourly.pressure.length < 8) return null;
    const i = hi;
    const a = data.hourly.pressure[i];
    const b = data.hourly.pressure[i + 6];
    if (a == null || b == null) return null;
    const delta = b - a;
    if (delta < -1.5) return 'falling';
    if (delta >  1.5) return 'rising';
    return 'steady';
  })();

  return (
    <VaulModalShell title={locationName || 'Weather'} onClose={onClose} headerAction={headerSearchBtn}>
      {searchOpen && (
        <WeatherLocationSearch
          onClose={() => setSearchOpen(false)}
          onPick={(loc) => { writeWxOverride(loc); setOverride(loc); setSearchOpen(false); }}
          onReset={() => { writeWxOverride(null); setOverride(null); setSearchOpen(false); }}
          canReset={!!override}
        />
      )}
      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '8px 0 14px' }}>
        <div style={{ fontSize: 80, lineHeight: 1 }}>{c.code != null ? weatherEmoji(c.code, c.isDay) : '☁️'}</div>
        <div className="num-display" style={{ fontSize: 56, lineHeight: 1, marginTop: 6, color: 'var(--gold-2)' }}>
          {c.temp != null ? `${c.temp}°` : '—'}<span style={{ fontSize: 26, color: 'var(--text-2)' }}>C</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 6 }}>
          {c.code != null ? weatherLabel(c.code) : '—'} · feels like {c.apparent != null ? `${c.apparent}°C` : '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          High {Math.round(tMax || 0)}° · Low {Math.round(tMin || 0)}°
        </div>
      </div>

      {/* Hourly next 24h */}
      <div className="label">Next 24 hours</div>
      <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
        {hours.map((h, i) => {
          const isNow = i === 0;
          return (
            <div key={i} style={{
              flex: '0 0 56px', padding: '8px 4px', borderRadius: 12,
              background: isNow ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.55)',
              border: `1px solid ${isNow ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase' }}>
                {isNow ? 'Now' : h.t.getHours().toString().padStart(2, '0') + ':00'}
              </div>
              <div style={{ fontSize: 18, marginTop: 2 }}>{weatherEmoji(h.code ?? 0, h.t.getHours() >= 6 && h.t.getHours() < 20)}</div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 14, color: 'var(--text)' }}>{Math.round(h.temp ?? 0)}°</div>
              <div style={{ fontSize: 10, color: 'var(--sage)' }}>{Math.round(h.pop ?? 0)}%</div>
            </div>
          );
        })}
      </div>

      {/* 7-day forecast */}
      <div className="label">7-day forecast</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {data.daily.time.slice(0, 7).map((d, i) => (
          <div key={i} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 56, fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {i === 0 ? 'Today' : d.toLocaleDateString('en', { weekday: 'short' })}
            </div>
            <div style={{ fontSize: 22 }}>{weatherEmoji(data.daily.code[i] ?? 0, true)}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-3)' }}>
              <span style={{ color: 'var(--sage)' }}>{Math.round(data.daily.pop[i] || 0)}% rain</span>
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 15, color: 'var(--text)' }}>
              {Math.round(data.daily.tMax[i] || 0)}°
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 13, color: 'var(--text-3)' }}>
              {Math.round(data.daily.tMin[i] || 0)}°
            </div>
          </div>
        ))}
      </div>

      {/* Pressure */}
      {pSeries && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="label" style={{ marginBottom: 0 }}>Pressure trend</div>
            {pTrend && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, letterSpacing: '0.06em', textTransform: 'uppercase',
                background: pTrend === 'falling' ? 'rgba(141,191,157,0.16)' : pTrend === 'rising' ? 'rgba(220,107,88,0.12)' : 'rgba(120,140,132,0.15)',
                color: pTrend === 'falling' ? 'var(--sage)' : pTrend === 'rising' ? 'var(--danger)' : 'var(--text-3)',
                border: `1px solid ${pTrend === 'falling' ? 'rgba(141,191,157,0.45)' : pTrend === 'rising' ? 'rgba(220,107,88,0.3)' : 'rgba(120,140,132,0.3)'}`,
              }}>
                {pTrend} {pTrend === 'falling' ? '— bites likely' : pTrend === 'rising' ? '— slow' : ''}
              </span>
            )}
          </div>
          <div className="card" style={{ padding: 12, marginTop: 8, marginBottom: 6 }}>
            <PressureLine series={pSeries} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>
              <span>-24h</span><span>now</span><span>+24h</span>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, margin: '0 0 18px' }}>
            Falling pressure ahead of low-pressure systems often triggers feeding. Carp anglers fish the drop.
          </p>
        </>
      )}

      {/* Wind + sun */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="label" style={{ marginBottom: 8 }}>Wind</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CompassDial dir={c.windDir || 'N'} />
            <div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, color: 'var(--text)' }}>{c.windDir || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.windSpeed != null ? `${c.windSpeed} km/h` : '—'}</div>
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="label" style={{ marginBottom: 8 }}>Sun</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>↑ {sunrise ? sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>↓ {sunset ? sunset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
          </div>
        </div>
      </div>
    </VaulModalShell>
  );
}

// Inline helpers for the modal — pulled from lib/weather to avoid awaiting an import inside JSX.
function weatherEmoji(code: number, isDay = true) {
  if (code === 0)        return isDay ? '☀️' : '🌙';
  if (code <= 2)         return isDay ? '🌤️' : '☁️';
  if (code === 3)        return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 86) return '🌧️';
  if (code >= 95) return '⛈️';
  return '☁️';
}
function weatherLabel(code: number) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Mist';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 86) return 'Showers';
  if (code >= 95) return 'Thunderstorm';
  return '—';
}

function CompassDial({ dir }: { dir: string }) {
  const angles: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  const a = angles[dir] ?? 0;
  return (
    <div style={{ width: 44, height: 44, borderRadius: 999, border: '1px solid rgba(234,201,136,0.3)', position: 'relative' }}>
      <span style={{ position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)', fontSize: 8, color: 'var(--text-3)' }}>N</span>
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: `translate(-50%, -50%) rotate(${a}deg)`, width: 2, height: 18, background: 'var(--gold-2)', borderRadius: 2, transformOrigin: 'center bottom', marginTop: -9 }} />
    </div>
  );
}

function PressureLine({ series }: { series: { times: Date[]; pres: number[]; min: number; max: number; span: number; nowIdx: number } }) {
  const W = 320, H = 70;
  const n = series.times.length;
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (p: number) => H - ((p - series.min) / series.span) * (H - 8) - 4;
  const path = series.pres.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const nowX = x(series.nowIdx);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 70 }}>
      <defs>
        <linearGradient id="pres-modal" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(212,182,115,0.55)" />
          <stop offset="100%" stopColor="rgba(212,182,115,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={nowX} height={H} fill="rgba(141,191,157,0.06)" />
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="url(#pres-modal)" />
      <path d={path} fill="none" stroke="var(--gold-2)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1={nowX} y1="0" x2={nowX} y2={H} stroke="var(--gold)" strokeWidth="1" strokeDasharray="2 3" />
    </svg>
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
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{total} fish{biggest ? ` · biggest ${formatWeight(biggest.lbs, biggest.oz)}` : ''}</div>
      </div>
      <ChevronRight size={18} style={{ color: 'var(--text-3)' }} />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="tap" style={{
      flexShrink: 0, padding: '8px 14px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
      background: active ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.45)',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      color: active ? 'var(--gold-2)' : 'var(--text-2)',
      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }}>{children}</button>
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
function TripsView({ me, trips, catches, profilesById, onOpenTrip, onAddTrip }: {
  me: Profile; trips: Trip[]; catches: CatchT[]; profilesById: Record<string, Profile>;
  onOpenTrip: (t: Trip) => void; onAddTrip: () => void;
}) {
  const qc = useQueryClient();
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
            const owner = profilesById[t.owner_id];
            return (
              <div key={t.id} className="card tap fade-in"
                onClick={() => onOpenTrip(t)}
                onTouchStart={() => prefetchTrip(qc, t.id)}
                onMouseEnter={() => prefetchTrip(qc, t.id)}
                style={{ padding: 16, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {active && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--sage)', boxShadow: '0 0 8px var(--sage)' }} />}
                    <h3 className="display-font" style={{ fontSize: 19, margin: 0, fontWeight: 500 }}>{t.name}</h3>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Calendar size={11} /> {formatDateRange(t.start_date, t.end_date)}
                  {t.location && <><span>·</span><MapPin size={11} />{t.location}</>}
                  {owner && owner.id !== me.id && <span>· hosted by {owner.display_name}</span>}
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

type TripTab = 'overview' | 'catches' | 'map' | 'chat' | 'activity';

function TripDetail({ me, trip, catches, profilesById, onClose, onEdit, onDelete, onOpenCatch }: {
  me: Profile; trip: Trip; catches: CatchT[]; profilesById: Record<string, Profile>;
  onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenCatch: (c: CatchT) => void;
}) {
  const [tab, setTab] = useState<TripTab>('overview');
  const [members, setMembers] = useState<TripMember[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, Profile>>(profilesById);
  const [stakes, setStakes] = useState<import('@/lib/types').TripStake[]>([]);
  const [myStakeDraft, setMyStakeDraft] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [activityPreview, setActivityPreview] = useState<import('@/lib/types').TripActivity[]>([]);
  const [latestRoll, setLatestRoll] = useState<TripSwimRoll | null>(null);
  const [rollViewer, setRollViewer] = useState<{ roll: TripSwimRoll; mode: 'animate' | 'replay' } | null>(null);
  const [rolling, setRolling] = useState(false);
  const [discoverFromTrip, setDiscoverFromTrip] = useState<{ center: { lat: number; lng: number } | null; ready: boolean } | null>(null);
  const isOwner = trip.owner_id === me.id;

  async function openTripDiscover() {
    setDiscoverFromTrip({ center: null, ready: false });
    if (trip.location) {
      try {
        const { geocodeLake } = await import('@/lib/weather');
        const g = await geocodeLake(trip.location);
        setDiscoverFromTrip({ center: g, ready: true });
      } catch {
        setDiscoverFromTrip({ center: null, ready: true });
      }
    } else {
      setDiscoverFromTrip({ center: null, ready: true });
    }
  }

  async function refreshMembers() {
    const m = await db.listTripMembers(trip.id);
    setMembers(m);
    const need = m.map(x => x.angler_id).filter(id => !memberProfiles[id]);
    if (need.length > 0) {
      const profs = await db.listProfilesByIds(need);
      setMemberProfiles(prev => { const out = { ...prev }; profs.forEach(p => out[p.id] = p); return out; });
    }
  }
  async function refreshStakes() {
    const s = await db.listTripStakes(trip.id);
    setStakes(s);
    const mine = s.find(x => x.angler_id === me.id);
    setMyStakeDraft(mine?.stake_text || '');
  }

  useEffect(() => {
    refreshMembers(); refreshStakes();
    db.listTripActivity(trip.id, 5).then(setActivityPreview);
    db.getLatestTripRoll(trip.id).then(setLatestRoll);
  /* eslint-disable-next-line */ }, [trip.id]);

  // Realtime: any new swim_roll → open animation for everyone (except the roller, who already opened it locally)
  useEffect(() => {
    const ch = supabase()
      .channel(`trip-rolls-${trip.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trip_swim_rolls', filter: `trip_id=eq.${trip.id}` },
        async (payload) => {
          const r = payload.new as TripSwimRoll;
          setLatestRoll(r);
          // Don't double-open for the roller; their handler already triggered it.
          if (r.rolled_by !== me.id) setRollViewer({ roll: r, mode: 'animate' });
        })
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  /* eslint-disable-next-line */ }, [trip.id, me.id]);

  async function startRoll() {
    if (!isOwner || rolling) return;
    if (latestRoll && !confirm('All members will see a new roll. Continue?')) return;
    setRolling(true);
    try {
      const joinedIds = members.filter(m => m.status === 'joined').map(m => m.angler_id);
      if (joinedIds.length < 2) { alert('Need at least 2 joined members to roll.'); return; }
      const results = db.rollDiceForAnglers(joinedIds);
      const created = await db.createTripRoll(trip.id, results);
      setLatestRoll(created);
      setRollViewer({ roll: created, mode: 'animate' });
    } catch (e: any) {
      alert(e?.message || 'Failed to roll');
    } finally { setRolling(false); }
  }

  const tripCatches = useMemo(() => catches.filter(c => c.trip_id === trip.id).sort((a, b) => +new Date(b.date) - +new Date(a.date)), [catches, trip.id]);
  const landed = tripCatches.filter(c => !c.lost);
  const lost = tripCatches.filter(c => c.lost);
  const biggest = landed.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
  const totalWeightOz = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
  const joinedMembers = members.filter(m => m.status === 'joined');
  const myStake = stakes.find(s => s.angler_id === me.id);

  const tabs: { id: TripTab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: Trophy },
    { id: 'catches',  label: 'Catches',  icon: Fish },
    { id: 'map',      label: 'Map',      icon: MapIcon },
    { id: 'chat',     label: 'Chat',     icon: MessageSquare },
    { id: 'activity', label: 'Activity', icon: ActivityIcon },
  ];

  return (
    <VaulModalShell hideTitle onClose={onClose}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Trip</div>
        <TripStatusPill trip={trip} />
      </div>
      <h2 className="display-font" style={{ fontSize: 30, margin: 0, fontWeight: 500, lineHeight: 1.05, marginBottom: 6 }}>{trip.name}</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={12} /> {formatDateRange(trip.start_date, trip.end_date)}</span>
        {trip.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>· <MapPin size={12} />{trip.location}</span>}
      </div>

      {/* Tab bar */}
      <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="tap" style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 999,
              border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: active ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.45)',
              color: active ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            }}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <>
          {trip.wager_enabled && (
            <div className="fade-in" style={{
              marginBottom: 16, padding: 14, borderRadius: 18,
              background: 'linear-gradient(135deg, rgba(234,201,136,0.18), rgba(212,182,115,0.06))',
              border: '1px solid rgba(234,201,136,0.4)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Trophy size={16} style={{ color: 'var(--gold-2)' }} />
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Wager</div>
              </div>
              {trip.wager_description && <p style={{ fontSize: 14, color: 'var(--text)', margin: '0 0 12px', lineHeight: 1.4 }}>{trip.wager_description}</p>}
              <label className="label">Your stake</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" placeholder="e.g. First round at the airport"
                  value={myStakeDraft} onChange={(e) => setMyStakeDraft(e.target.value)}
                  maxLength={200} style={{ flex: 1, fontSize: 13, padding: '10px 14px' }} />
                <button onClick={async () => {
                  const t = myStakeDraft.trim();
                  if (!t) {
                    if (myStake) { await db.deleteMyTripStake(trip.id); }
                  } else {
                    await db.setMyTripStake(trip.id, t);
                  }
                  await refreshStakes();
                }} className="tap" style={{
                  padding: '10px 14px', borderRadius: 12,
                  background: myStakeDraft.trim() === (myStake?.stake_text || '') ? 'rgba(20,42,38,0.7)' : 'var(--gold)',
                  color: myStakeDraft.trim() === (myStake?.stake_text || '') ? 'var(--text-3)' : '#1A1004',
                  border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>{myStake ? 'Update' : 'Pledge'}</button>
              </div>
              {stakes.filter(s => s.angler_id !== me.id).length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stakes.filter(s => s.angler_id !== me.id).map(s => {
                    const p = memberProfiles[s.angler_id];
                    return (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                        <AvatarBubble username={p?.username} displayName={p?.display_name} avatarUrl={p?.avatar_url} size={20} link={false} />
                        <strong style={{ fontWeight: 600 }}>{p?.display_name || 'Someone'}:</strong> <span style={{ color: 'var(--text)' }}>{s.stake_text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            <StatCard label="Caught" value={landed.length} />
            <StatCard label="Biggest" value={biggest ? formatWeight(biggest.lbs, biggest.oz) : '—'} />
            <StatCard label="Total" value={totalWeightOz ? `${Math.floor(totalWeightOz / 16)}lb` : '—'} />
          </div>

          {/* Swim roll */}
          {latestRoll ? (
            <div style={{ marginBottom: 16 }}>
              <SwimRollResultCard roll={latestRoll} profilesById={memberProfiles} onReplay={() => setRollViewer({ roll: latestRoll, mode: 'replay' })} />
              {isOwner && (
                <button onClick={startRoll} disabled={rolling} className="tap" style={{
                  marginTop: 8, width: '100%', padding: '10px 14px', borderRadius: 12,
                  background: 'transparent', border: '1px dashed rgba(234,201,136,0.3)',
                  color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
                }}>
                  {rolling ? <Loader2 size={12} className="spin" /> : <RotateCcwIcon />} Re-roll
                </button>
              )}
            </div>
          ) : isOwner && joinedMembers.length >= 2 ? (
            <button onClick={startRoll} disabled={rolling} className="tap" style={{
              marginBottom: 16, width: '100%', padding: '14px 16px', borderRadius: 18,
              background: 'linear-gradient(135deg, rgba(234,201,136,0.18), rgba(212,182,115,0.06))',
              border: '1px solid rgba(234,201,136,0.4)',
              color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
            }}>
              {rolling ? <Loader2 size={16} className="spin" /> : <Dices size={16} />}
              Roll for swims
            </button>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="label" style={{ marginBottom: 0 }}>Members ({joinedMembers.length})</div>
            {isOwner && (
              <button onClick={() => setShowInvite(true)} className="tap" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 999, border: '1px solid var(--gold)',
                background: 'rgba(212,182,115,0.12)', color: 'var(--gold-2)',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}><UserPlus size={12} /> Invite angler</button>
            )}
          </div>
          {(() => {
            // After a roll, order members by roll value desc and label "1st pick" / "2nd pick" / …
            const rollResults = latestRoll?.results || [];
            const rollIndex: Record<string, number> = {};
            rollResults.forEach((r, idx) => { rollIndex[r.angler_id] = idx; });
            const orderedMembers = latestRoll
              ? [...joinedMembers].sort((a, b) => {
                  const ai = rollIndex[a.angler_id]; const bi = rollIndex[b.angler_id];
                  if (ai == null && bi == null) return 0;
                  if (ai == null) return 1;
                  if (bi == null) return -1;
                  return ai - bi;
                })
              : [...joinedMembers].sort((a, b) =>
                  (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1)
                  || +new Date(a.created_at || 0) - +new Date(b.created_at || 0)
                );
            const ordSuffix = (n: number) => {
              const v = n % 100;
              if (v >= 11 && v <= 13) return 'th';
              const last = n % 10;
              return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
            };
            return (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {orderedMembers.map(m => {
                  const p = memberProfiles[m.angler_id];
                  if (!p) return null;
                  let label: React.ReactNode = null;
                  if (latestRoll) {
                    const idx = rollIndex[m.angler_id];
                    if (idx != null) {
                      const pick = idx + 1;
                      label = <span style={{ color: 'var(--gold-2)', fontSize: 10, fontWeight: 700 }}>·{pick}{ordSuffix(pick)} pick</span>;
                    }
                  } else if (m.role === 'owner') {
                    label = <span style={{ color: 'var(--gold-2)', fontSize: 10, fontWeight: 700 }}>·OWNER</span>;
                  }
                  return (
                    <Link key={m.id} href={`/profile/${p.username}`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 6px',
                      borderRadius: 999, border: '1px solid rgba(234,201,136,0.18)',
                      background: 'rgba(10,24,22,0.5)', color: 'var(--text)', textDecoration: 'none',
                      fontSize: 12, fontWeight: 600,
                    }}>
                      <AvatarBubble username={p.username} displayName={p.display_name} avatarUrl={p.avatar_url} size={22} link={false} />
                      {p.display_name}{label}
                    </Link>
                  );
                })}
              </div>
            );
          })()}

          {/* Leaderboard */}
          <div className="label">Leaderboard</div>
          <div style={{ marginBottom: 20 }}>
            <TripLeaderboard tripCatches={tripCatches} members={members} profilesById={memberProfiles} wagerEnabled={trip.wager_enabled} onOpenCatch={onOpenCatch} />
          </div>

          {/* Recent activity preview */}
          {activityPreview.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="label" style={{ marginBottom: 0 }}>Recent activity</div>
                <button onClick={() => setTab('activity')} className="tap" style={{ background: 'transparent', border: 'none', color: 'var(--gold-2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>See all</button>
              </div>
              <div style={{ marginTop: 8, marginBottom: 16 }}>
                <TripActivityFeed tripId={trip.id} profilesById={memberProfiles} />
              </div>
            </>
          )}

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

          {isOwner && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={onEdit} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}><Edit2 size={16} /> Edit</button>
              <button onClick={onDelete} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)', color: 'var(--danger)' }}><Trash2 size={16} /> Delete</button>
            </div>
          )}
        </>
      )}

      {tab === 'catches' && (
        tripCatches.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No catches yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tripCatches.map(c => (
              <CatchCard key={c.id} catchData={c}
                angler={memberProfiles[c.angler_id] || profilesById[c.angler_id] || null}
                trip={null} onClick={() => onOpenCatch(c)} />
            ))}
          </div>
        )
      )}

      {tab === 'map' && (
        <>
          <button onClick={openTripDiscover} className="card tap" style={{
            padding: 12, marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(212,182,115,0.08)',
            border: '1px solid rgba(234,201,136,0.3)',
            cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit',
            color: 'var(--text)',
          }}>
            <Search size={14} style={{ color: 'var(--gold-2)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Find more venues nearby</span>
            <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
          </button>
          <TripMap trip={trip} catches={tripCatches} profilesById={memberProfiles} onOpenCatch={onOpenCatch} />
        </>
      )}

      {discoverFromTrip?.ready && (
        <DiscoverVenues
          initialCenter={discoverFromTrip.center}
          sourceLabel={discoverFromTrip.center ? `Searching near ${trip.name}` : 'Searching near you'}
          onClose={() => setDiscoverFromTrip(null)}
        />
      )}

      {tab === 'chat' && (
        <TripChat tripId={trip.id} me={me} profilesById={memberProfiles} ownerId={trip.owner_id} />
      )}

      {tab === 'activity' && (
        <TripActivityFeed tripId={trip.id} profilesById={memberProfiles} />
      )}

      {showInvite && (
        <InviteAnglerModal me={me} tripId={trip.id} existingMemberIds={members.map(m => m.angler_id)}
          onClose={() => setShowInvite(false)}
          onInvited={async () => { setShowInvite(false); await refreshMembers(); }}
        />
      )}

      {rollViewer && (
        <SwimRollModal
          roll={rollViewer.roll}
          profilesById={memberProfiles}
          mode={rollViewer.mode}
          isOwner={isOwner}
          onClose={() => setRollViewer(null)}
          onReroll={async () => { setRollViewer(null); await startRoll(); }}
        />
      )}
    </VaulModalShell>
  );
}

// Tiny inline icon for the re-roll button (matches lucide style without import).
function RotateCcwIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function InviteAnglerModal({ me, tripId, existingMemberIds, onClose, onInvited }: {
  me: Profile; tripId: string; existingMemberIds: string[]; onClose: () => void; onInvited: () => void;
}) {
  const [selected, setSelected] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await db.inviteToTrip(tripId, selected.map(p => p.id));
      onInvited();
    } catch (e: any) { alert(e?.message || 'Failed to invite'); }
    finally { setBusy(false); }
  }
  return (
    <VaulModalShell title="Invite anglers" onClose={onClose}>
      <InvitePicker meId={me.id} excludeIds={existingMemberIds} selected={selected} onChange={setSelected} />
      <button className="btn btn-primary" onClick={submit} disabled={busy || selected.length === 0}
        style={{ width: '100%', fontSize: 16, padding: 16, marginTop: 16 }}>
        {busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
        Send {selected.length} invite{selected.length === 1 ? '' : 's'}
      </button>
    </VaulModalShell>
  );
}

function AddTripModal({ existing, me, onClose, onSave }: {
  existing: Trip | null;
  me: Profile;
  onClose: () => void;
  onSave: (data: Partial<Trip> & { name: string; start_date: string; end_date: string; visibility: TripVisibility }, inviteIds: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [location, setLocation] = useState(existing?.location || '');
  const [startDate, setStartDate] = useState(existing?.start_date ? isoToLocalDateInput(existing.start_date) : todayLocalDateInput());
  const [endDate, setEndDate]     = useState(existing?.end_date   ? isoToLocalDateInput(existing.end_date)   : tomorrowLocalDateInput());
  const [notes, setNotes] = useState(existing?.notes || '');
  const [visibility, setVisibility] = useState<TripVisibility>(existing?.visibility || 'invited_only');
  const [wagerEnabled, setWagerEnabled] = useState(existing?.wager_enabled || false);
  const [wagerDescription, setWagerDescription] = useState(existing?.wager_description || '');
  const [showInvite, setShowInvite] = useState(!existing);
  const [showWager, setShowWager] = useState(!!existing?.wager_enabled);
  const [invitees, setInvitees] = useState<Profile[]>([]);
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
        visibility,
        wager_enabled: wagerEnabled,
        wager_description: wagerEnabled ? (wagerDescription.trim() || null) : null,
      }, invitees.map(p => p.id));
    } finally { setSaving(false); }
  }

  return (
    <VaulModalShell title={existing ? 'Edit trip' : 'New trip'} onClose={onClose}>
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
      <label className="label">Visibility</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([
          { id: 'invited_only', label: 'Invited only', icon: Mail },
          { id: 'friends',      label: 'Friends',      icon: UsersIcon },
          { id: 'private',      label: 'Just me',      icon: Lock },
        ] as const).map(o => {
          const active = visibility === o.id;
          const Icon = o.icon;
          return (
            <button key={o.id} onClick={() => setVisibility(o.id)} className="tap" style={{
              flex: 1, padding: '10px 6px', borderRadius: 12,
              border: `1px solid ${active ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
              background: active ? 'rgba(212,182,115,0.15)' : 'rgba(10,24,22,0.5)',
              color: active ? 'var(--gold-2)' : 'var(--text-2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Icon size={12} /> {o.label}
            </button>
          );
        })}
      </div>
      <label className="label">Notes</label>
      <textarea className="input" rows={3} placeholder="Lake conditions, expectations, plan…" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ marginBottom: 16, resize: 'vertical', fontFamily: 'inherit' }} />

      {/* Invite anglers (creation only) */}
      {!existing && (
        <>
          <button onClick={() => setShowInvite(s => !s)} className="tap" style={{
            width: '100%', padding: '14px 16px', borderRadius: 14,
            background: 'rgba(10,24,22,0.55)', border: '1px solid rgba(234,201,136,0.14)',
            color: 'var(--text-2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><UserPlus size={15} /> Invite anglers{invitees.length > 0 ? ` (${invitees.length})` : ''}</span>
            <ChevronRight size={16} style={{ transform: showInvite ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          {showInvite && (
            <div className="fade-in" style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
              <InvitePicker meId={me.id} excludeIds={[me.id]} selected={invitees} onChange={setInvitees} />
            </div>
          )}
        </>
      )}

      {/* Wager */}
      <button onClick={() => setShowWager(s => !s)} className="tap" style={{
        width: '100%', padding: '14px 16px', borderRadius: 14,
        background: 'rgba(10,24,22,0.55)',
        border: `1px solid ${wagerEnabled ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
        color: 'var(--text-2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Trophy size={15} style={{ color: wagerEnabled ? 'var(--gold-2)' : 'var(--text-3)' }} />
          {wagerEnabled ? 'Wager on' : 'Set up a wager (optional)'}
        </span>
        <ChevronRight size={16} style={{ transform: showWager ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {showWager && (
        <div className="fade-in" style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)' }}>
          <label className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 12, background: 'rgba(10,24,22,0.5)', marginBottom: 10, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Enable wager</span>
            <input type="checkbox" checked={wagerEnabled} onChange={(e) => setWagerEnabled(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
          </label>
          {wagerEnabled && (
            <>
              <label className="label">Rules / what's at stake</label>
              <textarea className="input" rows={2} maxLength={200}
                placeholder="e.g. Biggest fish wins first round at the airport"
                value={wagerDescription} onChange={(e) => setWagerDescription(e.target.value)}
                style={{ resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>{wagerDescription.length}/200 · each member can pledge their own stake on the trip page</div>
            </>
          )}
        </div>
      )}

      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ width: '100%', fontSize: 16, padding: 16, marginTop: 6 }}>
        {saving ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
        {existing ? 'Save changes' : invitees.length > 0 ? `Create trip & invite ${invitees.length}` : 'Create trip'}
      </button>
    </VaulModalShell>
  );
}

// ============ STATS ============
function Stats({ catches, profilesById, me, onOpen }: {
  catches: CatchT[]; profilesById: Record<string, Profile>; me: Profile;
  onOpen: (c: CatchT) => void;
}) {
  const [tab, setTab] = useState<'personal' | 'crew' | 'time' | 'bait'>('personal');
  if (catches.length === 0) return <div style={{ padding: '40px 20px' }}><EmptyState /></div>;
  const tabs = [
    { id: 'personal' as const, label: 'Personal', icon: Sparkles },
    { id: 'crew' as const,     label: 'Crew',     icon: Trophy },
    { id: 'time' as const,     label: 'Time',     icon: Clock },
    { id: 'bait' as const,     label: 'Bait',     icon: BarChart3 },
  ];
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
      {tab === 'personal' && <StatsPersonal catches={catches} profilesById={profilesById} me={me} onOpen={onOpen} />}
      {tab === 'crew' && <StatsCrew catches={catches} profilesById={profilesById} me={me} onOpen={onOpen} />}
      {tab === 'time' && <StatsTime catches={catches} />}
      {tab === 'bait' && <StatsBait catches={catches} />}
    </div>
  );
}

function StatsPersonal({ catches, profilesById, me, onOpen }: { catches: CatchT[]; profilesById: Record<string, Profile>; me: Profile; onOpen: (c: CatchT) => void }) {
  const mine = useMemo(() => catches.filter(c => c.angler_id === me.id), [catches, me.id]);
  const landed = mine.filter(c => !c.lost);
  const lost = mine.filter(c => c.lost);
  const biggest = landed.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
  const totalOzAll = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
  const bySpecies = SPECIES.map(sp => ({ ...sp, count: landed.filter(c => c.species === sp.id).length })).filter(sp => sp.count > 0);

  // Monthly trend for the last 12 months (newest at right).
  const months = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString('default', { month: 'short' }),
        count: 0,
      });
    }
    landed.forEach(c => {
      const d = new Date(c.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const b = buckets.find(x => x.key === key);
      if (b) b.count++;
    });
    return buckets;
  }, [landed]);
  const monthMax = Math.max(1, ...months.map(m => m.count));

  // Top bait, rig, lake (count-based).
  function topOf(field: 'bait' | 'rig' | 'lake') {
    const counts: Record<string, number> = {};
    landed.forEach(c => {
      const v = (c[field] || '').trim();
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
    const arr = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return arr[0]?.[0] || '—';
  }
  const topBait = topOf('bait');
  const topRig  = topOf('rig');
  const topLake = topOf('lake');

  if (mine.length === 0) {
    return <EmptyState icon={<Fish size={48} />} title="No catches yet" subtitle="Bank your first one to fill out your stats" />;
  }

  return (
    <>
      {biggest && (
        <HeroCatch
          catchData={biggest}
          angler={profilesById[biggest.angler_id] || me}
          onClick={() => onOpen(biggest)}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 22, marginBottom: 22 }}>
        <StatCard label="Catches" value={landed.length} />
        <StatCard label="Total weight" value={`${Math.floor(totalOzAll / 16)}lb`} />
        <StatCard label="Biggest" value={biggest ? formatWeight(biggest.lbs, biggest.oz) : '—'} />
        <StatCard label="Lost" value={lost.length} />
      </div>

      {bySpecies.length > 0 && (
        <>
          <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '8px 0 12px' }}>By species</h3>
          <div className="card" style={{ padding: 14, marginBottom: 22 }}>
            {bySpecies.map(sp => {
              const pct = (sp.count / landed.length) * 100;
              return (
                <div key={sp.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{sp.label}</span>
                    <span style={{ color: 'var(--text-3)' }}>{sp.count} · {pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 5, background: 'rgba(10,24,22,0.6)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: sp.hue, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '8px 0 12px' }}>Last 12 months</h3>
      <div className="card" style={{ padding: 14, marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 90, gap: 4 }}>
          {months.map(m => {
            const pct = (m.count / monthMax) * 100;
            return (
              <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', height: `${pct}%`, background: m.count > 0 ? 'linear-gradient(180deg, var(--gold-2), var(--gold))' : 'rgba(10,24,22,0.4)', borderRadius: '3px 3px 0 0', minHeight: m.count > 0 ? 4 : 0 }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', marginTop: 6, gap: 4 }}>
          {months.map(m => (
            <div key={m.key} style={{ flex: 1, fontSize: 9, color: 'var(--text-3)', textAlign: 'center', fontWeight: 600 }}>{m.label[0]}</div>
          ))}
        </div>
      </div>

      <h3 className="display-font" style={{ fontSize: 18, fontWeight: 500, margin: '8px 0 12px' }}>Most productive</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PersonalRow label="Top bait" value={topBait} />
        <PersonalRow label="Top rig"  value={topRig} />
        <PersonalRow label="Top lake" value={topLake} />
      </div>
    </>
  );
}

function PersonalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, color: 'var(--gold-2)' }}>{value}</div>
    </div>
  );
}

function StatsCrew({ catches, profilesById, me, onOpen }: { catches: CatchT[]; profilesById: Record<string, Profile>; me: Profile; onOpen: (c: CatchT) => void }) {
  const [metric, setMetric] = useState<'biggest' | 'count' | 'total'>('biggest');
  const landed = useMemo(() => catches.filter(c => !c.lost), [catches]);
  // anglers visible in catches list (= "people you've fished with" + me)
  const anglerIds = useMemo(() => Array.from(new Set([me.id, ...landed.map(c => c.angler_id)])), [landed, me.id]);
  const stats = useMemo(() => {
    const byAngler: Record<string, { profile: Profile; totalOz: number; biggest: CatchT | null; count: number }> = {};
    anglerIds.forEach(id => { const p = profilesById[id]; if (p) byAngler[id] = { profile: p, totalOz: 0, biggest: null, count: 0 }; });
    landed.forEach(c => {
      const s = byAngler[c.angler_id]; if (!s) return;
      s.count++; const oz = totalOz(c.lbs, c.oz); s.totalOz += oz;
      if (!s.biggest || oz > totalOz(s.biggest.lbs, s.biggest.oz)) s.biggest = c;
    });
    const biggest = landed.reduce<CatchT | null>((m, c) => !m || totalOz(c.lbs, c.oz) > totalOz(m.lbs, m.oz) ? c : m, null);
    const totalOzAll = landed.reduce((s, c) => s + totalOz(c.lbs, c.oz), 0);
    const bySpecies = SPECIES.map(sp => ({ ...sp, count: landed.filter(c => c.species === sp.id).length })).filter(sp => sp.count > 0);
    return { byAngler, biggest, count: landed.length, totalOzAll, bySpecies };
  }, [landed, profilesById, anglerIds]);
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
          angler={profilesById[stats.biggest.angler_id] || null}
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
        {ranked.map((s, i) => <LeaderRow key={s.profile.id} entry={s} rank={i + 1} metric={metric} />)}
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
    landed.forEach(c => { const d = new Date(c.date); let dow = d.getDay() - 1; if (dow < 0) dow = 6; g[dow][d.getHours()] += 1; });
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
                  style={{ aspectRatio: '1', borderRadius: 3, background: v === 0 ? 'rgba(10,24,22,0.6)' : `rgba(212,182,115, ${0.15 + intensity * 0.85})`, border: v > 0 ? `1px solid rgba(212,182,115, ${0.3 + intensity * 0.5})` : 'none' }} />;
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

function HeroCatch({ catchData, angler, onClick }: { catchData: CatchT; angler: Profile | null; onClick: () => void }) {
  const photoUrl = catchData.has_photo && angler ? db.photoPublicUrl(angler.id, catchData.id) : null;
  return (
    <div className="card tap fade-in" onClick={onClick} style={{ overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 2 }}>
        <span className="pill" style={{ background: 'rgba(212,182,115,0.18)', color: 'var(--gold-2)', border: '1px solid var(--gold)' }}>
          <Crown size={11} /> All-time PB
        </span>
      </div>
      {photoUrl && (
        <div style={{ width: '100%', aspectRatio: '5/4', position: 'relative' }}>
          <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(5,14,13,0.95))' }} />
          <div style={{ position: 'absolute', bottom: 18, left: 18, right: 18 }}>
            <div className="num-display" style={{ fontSize: 56, lineHeight: 0.9, color: 'var(--gold-2)', textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
              {catchData.lbs}<span style={{ fontSize: 30, color: 'var(--text)' }}>lb</span>
              {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 24, color: 'var(--text)' }}>oz</span></>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, color: 'var(--text)' }}>
              {angler && <>
                <AvatarBubble username={angler.username} displayName={angler.display_name} avatarUrl={angler.avatar_url} size={24} link={false} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{angler.display_name}</span>
              </>}
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>· {formatDate(catchData.date)}</span>
            </div>
          </div>
        </div>
      )}
      {!photoUrl && (
        <div style={{ padding: '40px 20px' }}>
          <div className="num-display" style={{ fontSize: 56, lineHeight: 0.9, color: 'var(--gold-2)' }}>
            {catchData.lbs}<span style={{ fontSize: 28, color: 'var(--text)' }}>lb</span>
            {catchData.oz > 0 && <> {catchData.oz}<span style={{ fontSize: 22, color: 'var(--text)' }}>oz</span></>}
          </div>
          {angler && <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-2)' }}>{angler.display_name} · {formatDate(catchData.date)}</div>}
        </div>
      )}
    </div>
  );
}

function LeaderRow({ entry, rank, metric }: { entry: { profile: Profile; biggest: CatchT | null; count: number; totalOz: number }; rank: number; metric: 'biggest' | 'count' | 'total' }) {
  const value = metric === 'biggest' ? (entry.biggest ? formatWeight(entry.biggest.lbs, entry.biggest.oz) : '—')
    : metric === 'count' ? `${entry.count}` : `${Math.floor(entry.totalOz / 16)}lb`;
  const subtext = metric === 'biggest' ? (entry.biggest ? SPECIES.find(s => s.id === entry.biggest!.species)?.label : '') : metric === 'count' ? 'fish landed' : 'banked';
  const rankColors = ['var(--gold)', '#B5B6A6', '#A06D3D'];
  return (
    <Link href={`/profile/${entry.profile.username}`} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, color: 'var(--text)', textDecoration: 'none' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: rank <= 3 ? `${rankColors[rank - 1]}22` : 'rgba(10,24,22,0.55)',
        border: rank <= 3 ? `1px solid ${rankColors[rank - 1]}` : '1px solid rgba(234,201,136,0.18)',
        color: rank <= 3 ? rankColors[rank - 1] : 'var(--text-3)',
        fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 18, flexShrink: 0,
      }}>{rank}</div>
      <AvatarBubble username={entry.profile.username} displayName={entry.profile.display_name} avatarUrl={entry.profile.avatar_url} size={38} link={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{entry.profile.display_name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{subtext}</div>
      </div>
      <div className="num-display" style={{ fontSize: 22, color: 'var(--text)' }}>{value}</div>
    </Link>
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

// ============ ADD CATCH MODAL ============
export function AddCatchModal({ me, trips, activeTrips, onClose, onSave, existing, photoExisting }: {
  me: Profile; trips: Trip[]; activeTrips: Trip[];
  onClose: () => void;
  onSave: (data: db.CatchInput, photoDataUrl: string | null) => Promise<void>;
  existing?: CatchT; photoExisting?: string | null;
}) {
  const [lost, setLost] = useState(existing?.lost || false);
  const [photo, setPhoto] = useState<string | null>(photoExisting || null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [lbs, setLbs] = useState<string>(existing ? String(existing.lbs) : '');
  const [oz, setOz] = useState<string>(existing ? String(existing.oz) : '');
  const [species, setSpecies] = useState<string>(existing?.species || 'mirror');
  const [date, setDate] = useState(existing?.date ? isoToLocalDateTimeInput(existing.date) : nowLocalDateTimeInput());
  const [trip_id, setTripId] = useState<string | null>(existing?.trip_id || activeTrips[0]?.id || null);
  const [lake, setLake] = useState(existing?.lake || '');
  const [swim, setSwim] = useState(existing?.swim || '');
  const [bait, setBait] = useState(existing?.bait || '');
  const [rig, setRig] = useState(existing?.rig || '');
  const [hook, setHook] = useState(existing?.hook || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [tempC, setTempC] = useState<string>(existing?.weather?.tempC != null ? String(existing.weather.tempC) : '');
  const [conditions, setConditions] = useState(existing?.weather?.conditions || '');
  const [wind, setWind] = useState(existing?.weather?.wind || '');
  const [pressure, setPressure] = useState<string>(existing?.weather?.pressure != null ? String(existing.weather.pressure) : '');
  // Visibility UI removed; new catches default to 'friends'. Existing catches preserve their value.
  const visibility: CatchVisibility = existing?.visibility || 'friends';
  const [showMore, setShowMore] = useState(!!(existing?.lake || existing?.swim || existing?.bait || existing?.rig || existing?.notes));
  const [showWeather, setShowWeather] = useState(!!(existing?.weather?.tempC != null || existing?.weather?.conditions));
  const [autoStatus, setAutoStatus] = useState<{ wx: 'idle' | 'fetching' | 'done' | 'failed'; sp: 'idle' | 'detecting' | 'done' | 'failed' }>({ wx: 'idle', sp: 'idle' });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    existing?.latitude != null && existing?.longitude != null ? { lat: existing.latitude, lng: existing.longitude } : null
  );
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // trips this user can attach to: own trips + trips where they're a joined member.
  // Owned trips: trips.owner_id === me.id. Joined trips already in `trips` array (RLS exposes trips that include trip_member rows for me).
  const eligibleTrips = trips;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const compressed = await compressImage(file);
      setPhoto(compressed);
      setAutoStatus({ wx: 'fetching', sp: 'detecting' });
      Promise.all([
        (async () => {
          try {
            let c: { lat: number; lng: number } | null = null;
            const cached = localStorage.getItem(LOC_KEY);
            if (cached) { try { c = JSON.parse(cached); } catch {} }
            if (!c) {
              const gps = await getCurrentLocation();
              if (gps) { c = gps; localStorage.setItem(LOC_KEY, JSON.stringify(gps)); }
            }
            if (!c && lake.trim()) c = await geocodeLake(lake);
            if (!c) { setAutoStatus(s => ({ ...s, wx: 'failed' })); return; }
            setCoords(c);
            const w = await fetchWeatherFor(new Date(date), c.lat, c.lng);
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
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: compressed }),
            });
            const j = await r.json();
            if (j?.species && SPECIES.find(s => s.id === j.species)) {
              setSpecies(j.species); setAutoStatus(s => ({ ...s, sp: 'done' }));
            } else setAutoStatus(s => ({ ...s, sp: 'failed' }));
          } catch { setAutoStatus(s => ({ ...s, sp: 'failed' })); }
        })(),
      ]);
    } catch { alert('Failed to process image'); }
    finally { setPhotoLoading(false); }
  }

  async function handleSave() {
    if (!lost && !lbs && !oz) { alert('Add a weight'); return; }
    setSaving(true);
    try {
      const weather: Weather | null = (tempC || conditions || wind || pressure) ? {
        tempC: tempC ? parseFloat(tempC) : null,
        conditions: conditions || null, wind: wind || null,
        pressure: pressure ? parseFloat(pressure) : null,
      } : null;
      let moon: MoonT | null = existing?.moon || null;
      try {
        const cached = typeof window !== 'undefined' ? localStorage.getItem(LOC_KEY) : null;
        const coords = cached ? JSON.parse(cached) : null;
        if (coords?.lat != null) {
          const ill = getMoonIllumination(new Date(date));
          const lab = getMoonPhaseLabel(ill.phase);
          moon = { phase: ill.phase, fraction: ill.fraction, label: lab.label, emoji: lab.emoji };
        }
      } catch {}

      // Resolve coordinates: explicit state, else cached location, else null.
      let lat: number | null = coords?.lat ?? null;
      let lng: number | null = coords?.lng ?? null;
      if (lat == null || lng == null) {
        try {
          const cached = typeof window !== 'undefined' ? localStorage.getItem(LOC_KEY) : null;
          if (cached) { const c = JSON.parse(cached); if (c?.lat != null) { lat = c.lat; lng = c.lng; } }
        } catch {}
      }

      const payload: db.CatchInput = {
        ...(existing ? { id: existing.id } : {}),
        lost, lbs: lost ? 0 : (parseInt(lbs) || 0), oz: lost ? 0 : (parseInt(oz) || 0),
        species: lost ? null : species,
        date: new Date(date).toISOString(), trip_id,
        lake: lake.trim() || null, swim: swim.trim() || null,
        bait: bait.trim() || null, rig: rig.trim() || null, hook: hook.trim() || null, notes: notes.trim() || null,
        weather, moon,
        latitude: lat, longitude: lng,
        has_photo: !lost && !!photo,
        visibility, comments: existing?.comments || [],
      };
      await onSave(payload, !lost && photo && photo !== photoExisting ? photo : null);
    } finally { setSaving(false); }
  }

  return (
    <VaulModalShell title={existing ? 'Edit catch' : 'New catch'} onClose={onClose}>
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
            width: '100%',
            // Compact placeholder when empty so the form below stays reachable;
            // expand to 4:3 once a photo is shown so the image isn't squished.
            ...(photo || photoLoading
              ? { aspectRatio: '4/3' as const }
              : { height: 160 }),
            borderRadius: 18,
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
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-3)' }}>
                <Camera size={32} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Add a photo</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>Tap to capture or upload</div>
              </div>
            )}
          </div>
          {(autoStatus.wx !== 'idle' || autoStatus.sp !== 'idle') && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-3)' }}>
              {autoStatus.wx !== 'idle' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Cloud size={11} />
                {autoStatus.wx === 'fetching' && 'Fetching weather…'}
                {autoStatus.wx === 'done' && <span style={{ color: 'var(--sage)' }}>Weather added</span>}
                {autoStatus.wx === 'failed' && <span>Weather unavailable</span>}
              </span>}
              {autoStatus.sp !== 'idle' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={11} />
                {autoStatus.sp === 'detecting' && 'Identifying species…'}
                {autoStatus.sp === 'done' && <span style={{ color: 'var(--sage)' }}>Species detected</span>}
                {autoStatus.sp === 'failed' && <span>Species detection skipped</span>}
              </span>}
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

      {eligibleTrips.length > 0 && (
        <>
          <label className="label">Trip (optional)</label>
          <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 20, paddingBottom: 4 }}>
            <Chip active={!trip_id} onClick={() => setTripId(null)}>None</Chip>
            {eligibleTrips.map(t => (
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
          <div style={{ marginBottom: 14 }}><GearItemPicker type="bait" value={bait} onChange={setBait} meId={me.id} /></div>
          <label className="label">Rig</label>
          <div style={{ marginBottom: 14 }}><GearItemPicker type="rig" value={rig} onChange={setRig} meId={me.id} /></div>
          <label className="label">Hook</label>
          <div style={{ marginBottom: 14 }}><GearItemPicker type="hook" value={hook} onChange={setHook} meId={me.id} /></div>
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
    </VaulModalShell>
  );
}

// ============ CATCH DETAIL ============
export function CatchDetail({ catchData, me, profilesById, trips, stackLevel, onClose, onDelete, onUpdate, onOpenTrip }: {
  catchData: CatchT; me: Profile; profilesById: Record<string, Profile>; trips: Trip[];
  stackLevel?: number;
  onClose: () => void; onDelete: () => void;
  onUpdate: (data: db.CatchInput, photoDataUrl: string | null) => Promise<void>;
  onOpenTrip: (t: Trip) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<import('@/lib/types').CatchComment[]>([]);
  const [likes, setLikes] = useState<import('@/lib/types').CommentLike[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, Profile>>(profilesById);
  const [commentErr, setCommentErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const angler = profilesById[catchData.angler_id] || null;
  const species = SPECIES.find(s => s.id === catchData.species);
  const trip = catchData.trip_id ? trips.find(t => t.id === catchData.trip_id) : null;
  const weather = catchData.weather;
  const moon = catchData.moon;
  const photoUrl = catchData.has_photo && angler ? db.photoPublicUrl(angler.id, catchData.id) : null;
  const [photoErr, setPhotoErr] = useState(false);

  async function refreshComments() {
    try {
      const cs = await db.listCatchComments(catchData.id);
      setComments(cs);
      const need = Array.from(new Set(cs.map(c => c.angler_id))).filter(id => !commentProfiles[id]);
      if (need.length > 0) {
        const ps = await db.listProfilesByIds(need);
        setCommentProfiles(prev => { const out = { ...prev }; ps.forEach(p => out[p.id] = p); return out; });
      }
      const ids = cs.map(c => c.id);
      if (ids.length) setLikes(await db.listCommentLikes(ids));
      else setLikes([]);
    } catch (e: any) {
      setCommentErr(e?.message || 'Failed to load comments');
    }
  }
  useEffect(() => { refreshComments(); /* eslint-disable-next-line */ }, [catchData.id]);

  // Realtime subscription: any comment / like change for this catch.
  useEffect(() => {
    const ch = supabase()
      .channel(`catch-${catchData.id}-comments`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catch_comments', filter: `catch_id=eq.${catchData.id}` }, () => refreshComments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comment_likes' }, () => refreshComments())
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  /* eslint-disable-next-line */ }, [catchData.id]);

  async function submitComment() {
    const t = commentText.trim();
    if (!t || posting) return;
    setPosting(true); setCommentErr(null);
    try {
      await db.addCatchComment(catchData.id, t);
      setCommentText('');
      // realtime will fire, but optimistically refresh now too in case the channel hasn't connected yet
      refreshComments();
    } catch (e: any) {
      setCommentErr(e?.message || 'Failed to post comment');
    } finally { setPosting(false); }
  }
  async function removeComment(id: string) {
    if (!confirm('Delete comment?')) return;
    try { await db.deleteCatchComment(id); refreshComments(); }
    catch (e: any) { setCommentErr(e?.message || 'Failed to delete'); }
  }
  async function toggleLike(commentId: string) {
    const liked = likes.some(l => l.comment_id === commentId && l.angler_id === me.id);
    try {
      if (liked) await db.unlikeComment(commentId);
      else await db.likeComment(commentId);
      refreshComments();
    } catch (e: any) {
      setCommentErr(e?.message || 'Failed');
    }
  }

  if (editing) {
    return (
      <AddCatchModal
        me={me} trips={trips} activeTrips={[]}
        existing={catchData} photoExisting={photoUrl}
        onClose={() => setEditing(false)}
        onSave={async (data, ph) => { await onUpdate(data, ph); setEditing(false); }}
      />
    );
  }
  const isMyCatch = catchData.angler_id === me.id;

  return (
    <VaulModalShell title="" onClose={onClose} hideTitle stackLevel={stackLevel}>
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
          {photoUrl && !photoErr && (
            <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 18, overflow: 'hidden', marginBottom: 20, background: 'rgba(10,24,22,0.5)' }}>
              <img src={photoUrl} alt="" onError={() => setPhotoErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
        {angler && (
          <Link href={`/profile/${angler.username}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text)', textDecoration: 'none' }}>
            <AvatarBubble username={angler.username} displayName={angler.display_name} avatarUrl={angler.avatar_url} size={32} link={false} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{angler.display_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatDate(catchData.date)}</div>
            </div>
          </Link>
        )}
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

      <BanterSection
        comments={comments}
        commentProfiles={commentProfiles}
        likes={likes}
        meId={me.id}
        commentText={commentText}
        setCommentText={setCommentText}
        commentErr={commentErr}
        posting={posting}
        onSubmit={submitComment}
        onRemove={removeComment}
        onToggleLike={toggleLike}
      />
      {/* The legacy block below is unreachable but kept as a no-op fallback; the modular component does the work above. */}
      {false && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <MessageCircle size={14} style={{ color: 'var(--text-3)' }} />
          <div className="label" style={{ marginBottom: 0 }}>Banter ({comments.length})</div>
        </div>
        {comments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {comments.map(c => {
              const ca = commentProfiles[c.angler_id];
              const mine = c.angler_id === me.id;
              const myLike = likes.some(l => l.comment_id === c.id && l.angler_id === me.id);
              const likeCount = likes.filter(l => l.comment_id === c.id).length;
              return (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <AvatarBubble username={ca?.username} displayName={ca?.display_name} avatarUrl={ca?.avatar_url} size={26} link={!!ca?.username} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{ca?.display_name || 'Unknown'}</strong>
                        <span> · {new Date(c.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                      <button onClick={() => toggleLike(c.id)} aria-label={myLike ? 'Unlike' : 'Like'} style={{
                        minWidth: 32, height: 32, padding: '0 8px', borderRadius: 999,
                        background: myLike ? 'rgba(212,182,115,0.18)' : 'transparent',
                        border: `1px solid ${myLike ? 'var(--gold)' : 'transparent'}`,
                        color: myLike ? 'var(--gold-2)' : 'var(--text-3)',
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        fontFamily: 'inherit', fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>
                        <ThumbsUp size={12} fill={myLike ? 'var(--gold-2)' : 'transparent'} />
                        {likeCount > 0 && <span>{likeCount}</span>}
                      </button>
                      {mine && (
                        <button onClick={() => removeComment(c.id)} aria-label="Delete comment"
                          style={{ minWidth: 32, height: 32, padding: 0, background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {commentErr && (
          <div role="alert" style={{
            marginBottom: 10, padding: 10, borderRadius: 10, fontSize: 12,
            background: 'rgba(220,107,88,0.14)', border: '1px solid rgba(220,107,88,0.4)', color: 'var(--danger)',
          }}>{commentErr}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Add a comment…" value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
            style={{ flex: 1, padding: '10px 14px', fontSize: 14 }} />
          <button onClick={submitComment}
            disabled={!commentText.trim() || posting} className="tap" style={{
              width: 44, height: 44, borderRadius: 12,
              background: commentText.trim() && !posting ? 'var(--gold)' : 'rgba(20,42,38,0.7)',
              color: commentText.trim() && !posting ? '#1A1004' : 'var(--text-3)',
              border: 'none', cursor: commentText.trim() && !posting ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{posting ? <Loader2 size={14} className="spin" /> : <Send size={16} />}</button>
        </div>
      </div>
      )}

      {isMyCatch && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => setEditing(true)} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }}><Edit2 size={16} /> Edit</button>
          <button onClick={onDelete} className="btn btn-ghost tap" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)', color: 'var(--danger)' }}><Trash2 size={16} /> Delete</button>
        </div>
      )}
    </VaulModalShell>
  );
}

function BanterSection({
  comments, commentProfiles, likes, meId, commentText, setCommentText,
  commentErr, posting, onSubmit, onRemove, onToggleLike,
}: {
  comments: import('@/lib/types').CatchComment[];
  commentProfiles: Record<string, Profile>;
  likes: import('@/lib/types').CommentLike[];
  meId: string;
  commentText: string;
  setCommentText: (v: string) => void;
  commentErr: string | null;
  posting: boolean;
  onSubmit: () => void;
  onRemove: (id: string) => void;
  onToggleLike: (id: string) => void;
}) {
  // 0–2 comments → expanded; 3+ → collapsed by default. User can override.
  const [expanded, setExpanded] = useState<boolean>(comments.length < 3);
  // If a new comment arrives that pushes count to ≥3 we keep current state.
  const showThread = expanded || comments.length < 3;
  const last = comments[comments.length - 1];
  const lastAuthor = last ? commentProfiles[last.angler_id] : null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <button onClick={() => setExpanded(e => !e)} className="tap" style={{
        width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: showThread ? 12 : 0,
        color: 'var(--text)', fontFamily: 'inherit', textAlign: 'left',
      }}>
        <MessageCircle size={14} style={{ color: 'var(--text-3)' }} />
        <div className="label" style={{ marginBottom: 0, flex: 1 }}>Banter ({comments.length}){comments.length >= 3 && !expanded ? ' — tap to expand' : ''}</div>
        {comments.length >= 3 && (
          <ChevronRight size={14} style={{ color: 'var(--text-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
        )}
      </button>

      {!showThread && last && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 4 }}>
          <AvatarBubble username={lastAuthor?.username} displayName={lastAuthor?.display_name} avatarUrl={lastAuthor?.avatar_url} size={24} link={false} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-3)' }}>
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{lastAuthor?.display_name || 'Unknown'}: </strong>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '70%', verticalAlign: 'bottom' }}>{last.text}</span>
          </div>
        </div>
      )}

      {showThread && (
        <>
          {comments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {comments.map(c => {
                const ca = commentProfiles[c.angler_id];
                const mine = c.angler_id === meId;
                const myLike = likes.some(l => l.comment_id === c.id && l.angler_id === meId);
                const likeCount = likes.filter(l => l.comment_id === c.id).length;
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <AvatarBubble username={ca?.username} displayName={ca?.display_name} avatarUrl={ca?.avatar_url} size={26} link={!!ca?.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{ca?.display_name || 'Unknown'}</strong>
                          <span> · {new Date(c.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </span>
                        <button onClick={() => onToggleLike(c.id)} aria-label={myLike ? 'Unlike' : 'Like'} style={{
                          minWidth: 32, height: 32, padding: '0 8px', borderRadius: 999,
                          background: myLike ? 'rgba(212,182,115,0.18)' : 'transparent',
                          border: `1px solid ${myLike ? 'var(--gold)' : 'transparent'}`,
                          color: myLike ? 'var(--gold-2)' : 'var(--text-3)',
                          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          fontFamily: 'inherit', fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>
                          <ThumbsUp size={12} fill={myLike ? 'var(--gold-2)' : 'transparent'} />
                          {likeCount > 0 && <span>{likeCount}</span>}
                        </button>
                        {mine && (
                          <button onClick={() => onRemove(c.id)} aria-label="Delete comment"
                            style={{ minWidth: 32, height: 32, padding: 0, background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {commentErr && (
            <div role="alert" style={{
              marginBottom: 10, padding: 10, borderRadius: 10, fontSize: 12,
              background: 'rgba(220,107,88,0.14)', border: '1px solid rgba(220,107,88,0.4)', color: 'var(--danger)',
            }}>{commentErr}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="Add a comment…" value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
              style={{ flex: 1, padding: '10px 14px', fontSize: 14 }} />
            <button onClick={onSubmit}
              disabled={!commentText.trim() || posting} className="tap" style={{
                width: 44, height: 44, borderRadius: 12,
                background: commentText.trim() && !posting ? 'var(--gold)' : 'rgba(20,42,38,0.7)',
                color: commentText.trim() && !posting ? '#1A1004' : 'var(--text-3)',
                border: 'none', cursor: commentText.trim() && !posting ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{posting ? <Loader2 size={14} className="spin" /> : <Send size={16} />}</button>
          </div>
        </>
      )}
    </div>
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
function SettingsModal({ me, catches, trips, notify, onClose, onSaveProfile, onSaveNotify }: {
  me: Profile; catches: CatchT[]; trips: Trip[]; notify: NotifyConfig | null;
  onClose: () => void;
  onSaveProfile: (patch: Partial<Profile>) => Promise<void>;
  onSaveNotify: (n: { token: string | null; chat_id: string | null; enabled: boolean }) => Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftDisplay, setDraftDisplay] = useState(me.display_name);
  const [draftBio, setDraftBio] = useState(me.bio || '');
  const [publicProfile, setPublicProfile] = useState(me.public_profile);
  const [showNotify, setShowNotify] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => { (async () => { const { data: { user } } = await supabase().auth.getUser(); setEmail(user?.email || null); })(); }, []);

  function exportCSV() {
    const rows = [['Date', 'Angler', 'Lost', 'Species', 'Lbs', 'Oz', 'Trip', 'Lake', 'Swim', 'Bait', 'Rig', 'TempC', 'Conditions', 'Wind', 'Pressure', 'MoonPhase', 'MoonIllum', 'Visibility', 'Notes']];
    catches.forEach(c => {
      const t = c.trip_id ? trips.find(x => x.id === c.trip_id) : null;
      const w = c.weather || ({} as Weather);
      const m = c.moon || ({} as MoonT);
      rows.push([
        c.date, me.display_name, c.lost ? 'yes' : '', c.species || '', String(c.lbs || ''), String(c.oz || ''),
        t?.name || '', c.lake || '', c.swim || '', c.bait || '', c.rig || '',
        String(w.tempC ?? ''), w.conditions || '', w.wind || '', String(w.pressure ?? ''),
        m.label || '', m.fraction != null ? Math.round(m.fraction * 100) + '%' : '',
        c.visibility, (c.notes || '').replace(/\n/g, ' '),
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `carp-log-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  }

  async function signOut() {
    await fetch('/auth/sign-out', { method: 'POST' });
    router.replace('/auth/sign-in');
  }

  return (
    <VaulModalShell title="Settings" onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', marginBottom: 18 }}>
        <AvatarUploader me={me} onSaved={(url) => onSaveProfile({ avatar_url: url })} />
        <Link href={`/profile/${me.username}`} onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, color: 'var(--text)', textDecoration: 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{me.display_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{me.username}</div>
            {email && <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
          </div>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </Link>
      </div>

      <div className="label">Profile</div>
      {!editing ? (
        <button onClick={() => setEditing(true)} className="tap" style={{ width: '100%', padding: 14, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: 24 }}>
          <span>Edit display name & bio</span>
          <ChevronRight size={16} />
        </button>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <label className="label">Display name</label>
          <input className="input" value={draftDisplay} maxLength={40} onChange={(e) => setDraftDisplay(e.target.value)} style={{ marginBottom: 12 }} />
          <label className="label">Bio</label>
          <textarea className="input" rows={3} maxLength={200} placeholder="A line about you" value={draftBio} onChange={(e) => setDraftBio(e.target.value)}
            style={{ marginBottom: 6, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>{draftBio.length}/200</div>
          <label className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 12, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', marginBottom: 12, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Public profile</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: publicProfile ? 'var(--sage)' : 'var(--text-3)' }}>
              <input type="checkbox" checked={publicProfile} onChange={(e) => setPublicProfile(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
              {publicProfile ? 'Anyone can see' : 'Friends only'}
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1, border: '1px solid rgba(234,201,136,0.18)' }} onClick={() => { setDraftDisplay(me.display_name); setDraftBio(me.bio || ''); setPublicProfile(me.public_profile); setEditing(false); }}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }}
              onClick={async () => { await onSaveProfile({ display_name: draftDisplay.trim().slice(0, 40), bio: draftBio.trim() || null, public_profile: publicProfile }); setEditing(false); }}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className="label">Push notifications</div>
      <div style={{ marginBottom: 24 }}>
        <PushSettings />
      </div>

      <div className="label">My gear</div>
      <div style={{ marginBottom: 24 }}>
        <GearManager />
      </div>

      <div className="label">Appearance</div>
      <BgAnimationToggle />

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
      {showNotify && <div className="fade-in" style={{ marginBottom: 24 }}><TelegramSetup notify={notify} onSaveNotify={onSaveNotify} /></div>}

      <div className="label">Data</div>
      <button onClick={exportCSV} className="tap" style={{ width: '100%', padding: 14, borderRadius: 14, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        <Download size={16} /> Export catches as CSV
      </button>

      <div className="label" style={{ marginTop: 24 }}>Account</div>
      <button onClick={signOut} className="tap" style={{
        width: '100%', padding: 14, borderRadius: 14, background: 'rgba(220,107,88,0.08)',
        border: '1px solid rgba(220,107,88,0.3)', color: 'var(--danger)',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
      }}>
        <LogOut size={16} /> Sign out
      </button>

      <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid rgba(234,201,136,0.1)', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
        {catches.length} catches · {trips.length} trips
      </div>
    </VaulModalShell>
  );
}

function BgAnimationToggle() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { setEnabled(readBgAnimationEnabled()); }, []);
  return (
    <label className="tap" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 14, borderRadius: 14,
      background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
      cursor: 'pointer', marginBottom: 24,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>Background animation</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Underwater scene behind the app</div>
      </div>
      <input type="checkbox" checked={enabled} onChange={(e) => {
        const next = e.target.checked;
        setEnabled(next);
        writeBgAnimationEnabled(next);
      }} style={{ accentColor: 'var(--gold)' }} />
    </label>
  );
}

function TelegramSetup({ notify, onSaveNotify }: { notify: NotifyConfig | null; onSaveNotify: (n: { token: string | null; chat_id: string | null; enabled: boolean }) => Promise<void> }) {
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '🎣 <b>Carp Log</b> connected! Ready to ping with every catch.', parse_mode: 'HTML' }),
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
        Pings your group chat every time you bank (or lose) a fish. Each angler configures their own bot.
      </p>
      <details style={{ marginBottom: 14 }}>
        <summary style={{ fontSize: 12, color: 'var(--gold-2)', cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>How to set up (tap)</summary>
        <ol style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, paddingLeft: 18, margin: '8px 0 0' }}>
          <li>Open Telegram, search <strong>@BotFather</strong>, send <code>/newbot</code>. Copy the bot token.</li>
          <li>Create a group chat with your mates, add the bot to it.</li>
          <li>Send any message in the group, then visit <code>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> to find the <code>chat.id</code> (negative for groups).</li>
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
            padding: '12px 16px', borderRadius: 12, background: 'transparent',
            border: '1px solid rgba(234,201,136,0.18)', color: 'var(--text-3)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
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
// Module-scoped store: VaulModalShell increments while mounted; BottomNav
// and FAB subscribe and hide themselves when count > 0. Stacks naturally if
// multiple modals are open — they only reappear once the last has closed.
let modalOpenCount = 0;
const modalListeners = new Set<() => void>();
function subscribeModal(cb: () => void) { modalListeners.add(cb); return () => { modalListeners.delete(cb); }; }
function getModalSnapshot() { return modalOpenCount; }
function getModalServerSnapshot() { return 0; }
function useAnyModalOpen() {
  return React.useSyncExternalStore(subscribeModal, getModalSnapshot, getModalServerSnapshot) > 0;
}

// Shared scroll-dim store so BottomNav and FAB fade together as a unit.
let scrollDimmed = false;
const dimListeners = new Set<() => void>();
let dimTimer: ReturnType<typeof setTimeout> | null = null;
let dimConsumers = 0;
let dimScrollHandler: (() => void) | null = null;
function setScrollDimmed(next: boolean) {
  if (scrollDimmed === next) return;
  scrollDimmed = next;
  dimListeners.forEach(l => l());
}
function subscribeDim(cb: () => void) { dimListeners.add(cb); return () => { dimListeners.delete(cb); }; }
function getDimSnapshot() { return scrollDimmed; }
function getDimServerSnapshot() { return false; }
function useScrollDim() {
  // Install the window scroll listener the first time any consumer mounts;
  // tear it down when the last consumer unmounts. Counted refcount avoids
  // double-installs and avoids leaks if multiple components use this hook.
  useEffect(() => {
    dimConsumers++;
    if (dimConsumers === 1) {
      dimScrollHandler = () => {
        setScrollDimmed(true);
        if (dimTimer) clearTimeout(dimTimer);
        dimTimer = setTimeout(() => setScrollDimmed(false), 300);
      };
      window.addEventListener('scroll', dimScrollHandler, { passive: true });
    }
    return () => {
      dimConsumers--;
      if (dimConsumers === 0) {
        if (dimScrollHandler) window.removeEventListener('scroll', dimScrollHandler);
        dimScrollHandler = null;
        if (dimTimer) { clearTimeout(dimTimer); dimTimer = null; }
        scrollDimmed = false;
      }
    };
  }, []);
  return React.useSyncExternalStore(subscribeDim, getDimSnapshot, getDimServerSnapshot);
}

// ============================================================
// VaulModalShell — vaul-backed sheet used by every modal in the app.
// Same visual language as iOS sheets (handle pill, sticky header,
// scrollable body) but vaul handles drag-to-dismiss properly: drag is
// constrained to the handle area via `handleOnly`, body scrolling is
// uninterrupted, and snap-back physics are spring-based.
// ============================================================
export function VaulModalShell({ title, onClose, hideTitle, headerAction, stackLevel = 0, children }: {
  title?: string; onClose: () => void; hideTitle?: boolean;
  headerAction?: React.ReactNode; stackLevel?: number; children: React.ReactNode;
}) {
  // Lock the body scroll + count this modal towards the FAB/BottomNav-hide store.
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  useEffect(() => {
    modalOpenCount++;
    modalListeners.forEach(l => l());
    return () => {
      modalOpenCount--;
      modalListeners.forEach(l => l());
    };
  }, []);

  const z = 100 + stackLevel * 10;

  return (
    <Drawer.Root open onOpenChange={(o) => { if (!o) onClose(); }} handleOnly>
      <Drawer.Portal>
        <Drawer.Overlay style={{
          position: 'fixed', inset: 0, zIndex: z,
          background: 'rgba(3, 10, 9, 0.7)',
          backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        }} />
        <Drawer.Content
          aria-describedby={undefined}
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            zIndex: z + 1,
            display: 'flex', justifyContent: 'center',
            outline: 'none',
          }}>
          <div style={{
            width: '100%', maxWidth: 480,
            maxHeight: '92vh' as any,
            height: 'min(92vh, calc(100dvh - 24px))' as any,
            background: 'rgba(10, 24, 22, 0.92)',
            backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            borderRadius: '28px 28px 0 0', border: '1px solid rgba(234,201,136,0.14)', borderBottom: 'none',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', minHeight: 0,
          }}>
            {/* vaul's Drawer.Handle is the ONLY draggable region thanks to handleOnly. */}
            <div style={{
              height: 28, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none',
            }}>
              <Drawer.Handle style={{
                width: 44, height: 5, borderRadius: 999,
                background: 'rgba(255,255,255,0.22)',
                margin: 0,
              }} />
            </div>

            {/* HEADER — sticky outside the scroll region. */}
            <div style={{
              flexShrink: 0,
              padding: hideTitle ? '0 20px 8px' : '0 20px 12px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}>
              {!hideTitle && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Drawer.Title asChild>
                    <h2 className="display-font" style={{ fontSize: 22, margin: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
                  </Drawer.Title>
                  {headerAction}
                </div>
              )}
              {hideTitle ? (
                <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, padding: 4, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer' }}>
                  <ArrowLeft size={18} /> Back
                </button>
              ) : (
                <button onClick={onClose} aria-label="Close" style={{ background: 'rgba(20,42,38,0.7)', border: '1px solid rgba(234,201,136,0.18)', borderRadius: 12, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)', flexShrink: 0, padding: 0 }}>
                  <X size={18} />
                </button>
              )}
            </div>

            {/* SCROLLABLE BODY — vaul does NOT intercept gestures here when handleOnly is set. */}
            <div style={{
              flex: 1, minHeight: 0,
              overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
              touchAction: 'pan-y',
              WebkitOverflowScrolling: 'touch' as any,
              padding: '0 20px max(40px, calc(env(safe-area-inset-bottom) + 24px))',
            }}>
              {children}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function FAB({ onClick }: { onClick: () => void }) {
  const modalOpen = useAnyModalOpen();
  const dimmed = useScrollDim();
  const opacity = modalOpen ? 0 : (dimmed ? 0.5 : 1);
  return (
    <button onClick={onClick} className="tap" aria-hidden={modalOpen} tabIndex={modalOpen ? -1 : 0} style={{
      position: 'fixed',
      bottom: 'calc(92px + env(safe-area-inset-bottom))',
      left: '50%', transform: 'translateX(-50%)',
      width: 64, height: 64, borderRadius: 999,
      background: 'linear-gradient(180deg, var(--gold-2), var(--gold))',
      border: '3px solid rgba(5,14,13,0.9)',
      boxShadow: '0 12px 28px rgba(212,182,115,0.4), 0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#1A1004', cursor: 'pointer', zIndex: 50,
      opacity,
      pointerEvents: modalOpen ? 'none' : 'auto',
      transition: 'opacity 0.2s ease',
    }}>
      <Plus size={28} strokeWidth={2.5} />
    </button>
  );
}

function BottomNav({ view, onChange }: { view: string; onChange: (v: 'feed' | 'trips' | 'stats' | 'lakes') => void }) {
  // Shared dim state with FAB so they fade together while user is scrolling.
  const dimmed = useScrollDim();
  const modalOpen = useAnyModalOpen();
  const items = [
    { id: 'feed' as const,    label: 'Log',    icon: Fish },
    { id: 'trips' as const,   label: 'Trips',  icon: Tent },
    { id: 'stats' as const,   label: 'Stats',  icon: Trophy },
    { id: 'lakes' as const,   label: 'Lakes',  icon: MapPinned },
  ];
  const opacity = modalOpen ? 0 : (dimmed ? 0.5 : 1);
  return (
    <div
      aria-hidden={modalOpen}
      style={{
      position: 'fixed',
      bottom: 'calc(16px + env(safe-area-inset-bottom))',
      left: 16, right: 16,
      maxWidth: 448, margin: '0 auto',
      background: 'rgba(28, 60, 54, 0.55)',
      backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      border: '1px solid rgba(234,201,136,0.16)', borderRadius: 28,
      padding: '10px 8px', zIndex: 40,
      display: 'flex', justifyContent: 'space-around',
      boxShadow: '0 12px 36px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)',
      opacity,
      pointerEvents: modalOpen ? 'none' : 'auto',
      transition: 'opacity 0.2s ease',
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

function LakeDetailLoader({ name, catches, profilesById, me, onClose, onOpenCatch }: {
  name: string; catches: CatchT[]; profilesById: Record<string, Profile>; me: Profile;
  onClose: () => void; onOpenCatch: (c: CatchT) => void;
}) {
  const [lake, setLake] = useState<import('@/lib/types').Lake | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const l = await db.getLakeByName(name);
      if (!cancelled) setLake(l);
    })();
    return () => { cancelled = true; };
  }, [name]);
  if (!lake) return null;
  const lakeCatches = catches.filter(c => (c.lake || '').trim().toLowerCase() === lake.name.trim().toLowerCase());
  return <LakeDetail lake={lake} lakeCatches={lakeCatches} profilesById={profilesById} me={me} onClose={onClose} onOpenCatch={onOpenCatch} />;
}

function AvatarUploader({ me, onSaved }: { me: Profile; onSaved: (url: string) => Promise<void> | void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      // Square-crop + resize to 512px JPEG.
      const dataUrl = await squareCompress(file, 512, 0.86);
      const url = await db.uploadAvatarFromDataUrl(dataUrl);
      await onSaved(url);
    } catch (err: any) {
      alert(err?.message || 'Failed to upload avatar');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  return (
    <button onClick={() => fileRef.current?.click()} aria-label="Change avatar"
      style={{ position: 'relative', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
      <AvatarBubble username={me.username} displayName={me.display_name} avatarUrl={me.avatar_url} size={48} link={false} />
      <span style={{
        position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 999,
        background: 'var(--gold)', color: '#1A1004',
        border: '2px solid rgba(10,24,22,0.95)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{busy ? <Loader2 size={10} className="spin" /> : <Camera size={10} />}</span>
      <input ref={fileRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
    </button>
  );
}

// Square-crop centered, downscale to maxDim, return JPEG data URL.
function squareCompress(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const out = Math.min(maxDim, side);
        const canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
