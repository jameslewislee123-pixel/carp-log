'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as db from './db';
import { QK } from './queryKeys';
import type { Catch, Lake, Profile, Trip } from './types';

// ============================================================
// Read hooks — these power the cached, deduplicated UI fetches
// ============================================================
// Loading-overhaul defaults: every list-style query uses placeholderData so
// the previous snapshot stays on screen while a background refetch runs.
// staleTime ≥ 60s keeps tab-switch / cross-page navigation from triggering
// any network request at all when data is fresh.
export function useCatches() {
  return useQuery({
    queryKey: QK.catches.all,
    queryFn: db.listCatches,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useCatchesForAngler(anglerId: string | undefined) {
  return useQuery({
    queryKey: anglerId ? QK.catches.byAngler(anglerId) : ['catches', 'angler', 'none'],
    queryFn: () => anglerId ? db.listCatchesForAngler(anglerId) : Promise.resolve([] as Catch[]),
    enabled: !!anglerId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useTrips() {
  return useQuery({
    queryKey: QK.trips.all,
    queryFn: db.listTrips,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useProfileByUsername(username: string | undefined) {
  return useQuery({
    queryKey: username ? QK.profiles.byUsername(username) : ['profiles', 'u', 'none'],
    queryFn: () => username ? db.getProfileByUsername(username) : Promise.resolve(null),
    enabled: !!username,
    staleTime: 5 * 60_000, // profile stuff changes rarely
    placeholderData: (prev) => prev,
  });
}
export function useFriendships() {
  return useQuery({
    queryKey: QK.friendships,
    queryFn: db.listFriendships,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useNotifications() {
  return useQuery({
    queryKey: QK.notifications.list,
    queryFn: db.listNotifications,
    // Show cached results immediately; refetch happens in the background so
    // the page never shows a spinner after the first successful load.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
export function useUnreadCount() {
  return useQuery({
    queryKey: QK.notifications.unread,
    queryFn: db.unreadCount,
    staleTime: 30_000,
  });
}

// Warm the notification list cache so opening /notifications is instant.
export function prefetchNotifications(qc: QueryClient) {
  return qc.prefetchQuery({
    queryKey: QK.notifications.list,
    queryFn: db.listNotifications,
    staleTime: 30_000,
  });
}

// Same idea for the friends list — touching the Friends button warms the cache.
export function prefetchFriendships(qc: QueryClient) {
  return qc.prefetchQuery({
    queryKey: QK.friendships,
    queryFn: db.listFriendships,
    staleTime: 60_000,
  });
}
export function useCatchComments(catchId: string | undefined) {
  return useQuery({
    queryKey: catchId ? QK.comments.byCatch(catchId) : ['comments', 'none'],
    queryFn: () => catchId ? db.listCatchComments(catchId) : Promise.resolve([]),
    enabled: !!catchId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
export function useCommentCounts(catchIds: string[]) {
  const ids = useMemo(() => [...catchIds].sort(), [catchIds.join(',')]); // eslint-disable-line
  return useQuery({
    queryKey: QK.comments.countsForCatches(ids),
    queryFn: () => db.countCatchComments(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}

// Catch-likes: aggregated count + the current user's liked-set, both keyed
// on the (sorted) ids of the catches currently visible. Realtime invalidates
// these via QK.catchLikes whenever a row changes.
export function useCatchLikeCounts(catchIds: string[]) {
  const ids = useMemo(() => [...catchIds].sort(), [catchIds.join(',')]); // eslint-disable-line
  return useQuery({
    queryKey: QK.catchLikes.countsForCatches(ids),
    queryFn: () => db.listCatchLikeCounts(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
export function useMyCatchLikes(catchIds: string[]) {
  const ids = useMemo(() => [...catchIds].sort(), [catchIds.join(',')]); // eslint-disable-line
  return useQuery({
    queryKey: QK.catchLikes.myLikedFor(ids),
    queryFn: () => db.listMyCatchLikedIds(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

// Auth-bound singletons. `me` is loaded once and reused across pages.
export function useMe() {
  return useQuery({ queryKey: QK.profiles.me, queryFn: db.getMe, staleTime: 5 * 60_000 });
}

export function useMyNotifyConfig() {
  return useQuery({ queryKey: QK.notifyConfig, queryFn: db.getMyNotify, staleTime: 60_000 });
}

// A keyed lookup of {id -> Profile} for a list of ids. Used for catch cards,
// comment authors, trip members — anywhere we render someone's name + avatar.
// Returns a stable object keyed by id; new ids trigger a refetch.
export function useProfilesByIds(ids: string[]) {
  const sortedKey = useMemo(() => [...new Set(ids)].sort().join(','), [ids.join(',')]); // eslint-disable-line
  return useQuery({
    queryKey: ['profiles', 'ids', sortedKey],
    queryFn: async () => {
      const list = sortedKey ? sortedKey.split(',') : [];
      if (list.length === 0) return {} as Record<string, Profile>;
      const profs = await db.listProfilesByIds(list);
      const out: Record<string, Profile> = {};
      profs.forEach(p => { out[p.id] = p; });
      return out;
    },
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

// Trip-bound queries. Each tab inside TripDetail (Overview / Catches / Map /
// Chat / Activity) reads through these hooks, so caching once + showing
// previous-data while refetching makes tab switches instant.
export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: id ? QK.trips.detail(id) : ['trips', 'detail', 'none'],
    queryFn: () => id ? db.getTrip(id) : Promise.resolve(null),
    enabled: !!id,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useTripMembers(tripId: string | undefined) {
  return useQuery({
    queryKey: tripId ? QK.trips.members(tripId) : ['trips', 'members', 'none'],
    queryFn: () => tripId ? db.listTripMembers(tripId) : Promise.resolve([]),
    enabled: !!tripId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
export function useTripMessages(tripId: string | undefined) {
  return useQuery({
    queryKey: tripId ? QK.trips.messages(tripId) : ['trips', 'messages', 'none'],
    queryFn: () => tripId ? db.listTripMessages(tripId) : Promise.resolve([]),
    enabled: !!tripId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
export function useTripActivity(tripId: string | undefined) {
  return useQuery({
    queryKey: tripId ? QK.trips.activity(tripId) : ['trips', 'activity', 'none'],
    queryFn: () => tripId ? db.listTripActivity(tripId) : Promise.resolve([]),
    enabled: !!tripId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
export function useLakes() {
  return useQuery({
    queryKey: QK.lakes.all,
    queryFn: db.listLakes,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useMySavedLakeIds() {
  return useQuery({
    queryKey: QK.lakes.mySaved,
    queryFn: db.listMySavedLakeIds,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

// ============================================================
// useLakesEnriched: union of (lakes the user has caught at) and (rows in
// the lakes table — including 'osm' venues saved-but-unfished). Catches and
// lakes both live in the existing TanStack cache, so this is a pure
// client-side compute — no network call. Memoised on its inputs.
// ============================================================
export type EnrichedLake = {
  key: string;                 // canonical key (lake.id || lowercased name)
  id: string | null;           // lakes.id if a row exists, else null
  name: string;                // display name
  source: 'manual' | 'osm' | 'imported' | null;
  latitude: number | null;
  longitude: number | null;
  catchCount: number;          // by current user
  lastFishedAt: Date | null;
  pbCatch: Catch | null;       // biggest by total weight at this lake
  topBait: string | null;      // most-frequent bait at this lake
  monthlySparkline: number[];  // last 6 months, oldest → newest
  hasAnnotations: boolean;     // true iff lakeAnnotations cache has any entries
};

const norm = (s: string) => s.trim().toLowerCase();
function totalOzLocal(c: Catch) { return c.lbs * 16 + c.oz; }

export function useLakesEnriched() {
  const catches = useCatches().data || [];
  const lakes = useLakes().data || [];
  const trips = useTrips().data || [];
  const me = useMe().data || null;
  const savedIds = useMySavedLakeIds().data || [];
  // We don't list annotations for every lake here; the badge just reflects
  // whatever the cache currently knows about. This is intentionally
  // best-effort — it only matters for the "Add notes" badge hint.
  const qc = useQueryClient();

  return useMemo<EnrichedLake[]>(() => {
    const byKey: Record<string, EnrichedLake & { _baits: Record<string, number> }> = {};

    // Determine which lakes "belong" to the user. db.listLakes() returns
    // all lakes globally (no RLS), so without scoping we'd surface every
    // OSM venue any user has ever discovered. Sources of ownership:
    //   - lakes referenced by any catch I've logged (lake_id or by-name)
    //   - lakes referenced by any trip I'm a member of (trips.lake_id)
    //   - lakes I created (lakes.created_by = me.id)
    const myLakeIds = new Set<string>();
    const myLakeNames = new Set<string>();
    catches.forEach(c => {
      if ((c as any).lake_id) myLakeIds.add((c as any).lake_id);
      if (c.lake) myLakeNames.add(norm(c.lake));
    });
    trips.forEach(t => { if (t.lake_id) myLakeIds.add(t.lake_id); });
    if (me) lakes.forEach(l => { if (l.created_by === me.id) myLakeIds.add(l.id); });
    // Bookmarks (user_saved_lakes) — fourth ownership signal. Lets seed
    // and Nominatim picks (which have created_by IS NULL) appear in the
    // Lakes tab without the user having to log a catch first.
    savedIds.forEach(id => myLakeIds.add(id));

    const myLakes = lakes.filter(l => myLakeIds.has(l.id) || myLakeNames.has(norm(l.name)));
    // eslint-disable-next-line no-console
    console.log('[useLakesEnriched]', {
      catches: catches.length,
      lakesGlobal: lakes.length,
      trips: trips.length,
      savedIds: savedIds.length,
      savedSample: savedIds.slice(0, 3),
      myLakeIdsSize: myLakeIds.size,
      myLakeIdsSample: Array.from(myLakeIds).slice(0, 3),
      myLakesAfterFilter: myLakes.length,
      mePresent: !!me,
    });

    // Seed from MY lakes (subset of lakes table). Picks up trip-reserved
    // lakes and manually-saved lakes even when the user has zero catches.
    myLakes.forEach(l => {
      const key = l.id;
      byKey[key] = {
        key,
        id: l.id,
        name: l.name,
        source: (l.source as EnrichedLake['source']) || 'manual',
        latitude: l.latitude,
        longitude: l.longitude,
        catchCount: 0,
        lastFishedAt: null,
        pbCatch: null,
        topBait: null,
        monthlySparkline: new Array(6).fill(0),
        hasAnnotations: false,
        _baits: {},
      };
    });
    // Index ALL lake rows by lowercased name so catch-side merges resolve
    // even when a catch references a lake my filter would have skipped.
    const lakeByName: Record<string, Lake> = {};
    lakes.forEach(l => { lakeByName[norm(l.name)] = l; });

    // Merge catches.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgoStart = new Date(monthStart);
    sixMonthsAgoStart.setMonth(sixMonthsAgoStart.getMonth() - 5);

    catches.forEach(c => {
      const lakeName = c.lake?.trim();
      if (!lakeName) return;
      const matchedLake = lakeByName[norm(lakeName)];
      const key = matchedLake ? matchedLake.id : `name:${norm(lakeName)}`;
      let entry = byKey[key];
      if (!entry) {
        entry = byKey[key] = {
          key,
          id: matchedLake?.id || null,
          name: matchedLake?.name || lakeName,
          source: (matchedLake?.source as EnrichedLake['source']) || null,
          latitude: matchedLake?.latitude ?? c.latitude ?? null,
          longitude: matchedLake?.longitude ?? c.longitude ?? null,
          catchCount: 0,
          lastFishedAt: null,
          pbCatch: null,
          topBait: null,
          monthlySparkline: new Array(6).fill(0),
          hasAnnotations: false,
          _baits: {},
        };
      }
      // Lakes-only rows that didn't have coords inherit them from a catch.
      if (entry.latitude == null && c.latitude != null) entry.latitude = c.latitude;
      if (entry.longitude == null && c.longitude != null) entry.longitude = c.longitude;

      if (c.lost) return; // landed-only counts towards stats below
      entry.catchCount++;
      const d = new Date(c.date);
      if (!entry.lastFishedAt || d > entry.lastFishedAt) entry.lastFishedAt = d;
      if (!entry.pbCatch || totalOzLocal(c) > totalOzLocal(entry.pbCatch)) entry.pbCatch = c;
      if (c.bait) entry._baits[c.bait] = (entry._baits[c.bait] || 0) + 1;

      // Sparkline bucket
      if (d >= sixMonthsAgoStart) {
        const monthsDiff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        const idx = 5 - monthsDiff;
        if (idx >= 0 && idx <= 5) entry.monthlySparkline[idx]++;
      }
    });

    // Resolve top bait + annotation flag.
    const out: EnrichedLake[] = Object.values(byKey).map(e => {
      const baits = Object.entries(e._baits);
      baits.sort((a, b) => b[1] - a[1]);
      const annsCache = e.id ? qc.getQueryData<unknown[]>(QK.lakes.annotations(e.id)) : null;
      return {
        key: e.key,
        id: e.id,
        name: e.name,
        source: e.source,
        latitude: e.latitude,
        longitude: e.longitude,
        catchCount: e.catchCount,
        lastFishedAt: e.lastFishedAt,
        pbCatch: e.pbCatch,
        topBait: baits.length > 0 ? baits[0][0] : null,
        monthlySparkline: e.monthlySparkline,
        hasAnnotations: Array.isArray(annsCache) && annsCache.length > 0,
      };
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catches, lakes]);
}

// Single source of truth for the four lake-summary tiles. Used by both the
// Lakes top-level page (previously) and the Stats → Lakes sub-tab. Keeps the
// numbers identical across both surfaces.
export type LakeStatsTiles = {
  lakesFished: number;
  savedVenues: number;
  biggest: Catch | null;
  biggestLakeName: string | null;
  productiveName: string | null;
  productiveCount: number;
};
export function useLakeStatsTiles(): LakeStatsTiles {
  const enriched = useLakesEnriched();
  return useMemo(() => {
    const lakesFished = enriched.filter(l => l.catchCount > 0).length;
    const savedVenues = enriched.filter(l => l.catchCount === 0 && l.source === 'osm').length;
    const allMyPbs = enriched.filter(l => l.pbCatch).map(l => l.pbCatch!);
    const biggest = allMyPbs.reduce<Catch | null>((m, c) => !m || (c.lbs * 16 + c.oz) > (m.lbs * 16 + m.oz) ? c : m, null);
    const biggestLake = biggest ? enriched.find(l => l.pbCatch?.id === biggest.id) || null : null;
    const productive = [...enriched].sort((a, b) => b.catchCount - a.catchCount)[0] || null;
    return {
      lakesFished,
      savedVenues,
      biggest,
      biggestLakeName: biggestLake?.name || null,
      productiveName: (productive && productive.catchCount > 0) ? productive.name : null,
      productiveCount: (productive && productive.catchCount > 0) ? productive.catchCount : 0,
    };
  }, [enriched]);
}

// One-shot GPS fetch with cached result. Used by the "Closest to me" sort
// in LakesView. Resolves to null if the user denies / the device has no GPS.
export function useUserLocationOnce(): { coords: { lat: number; lng: number } | null; ready: boolean } {
  const [state, setState] = useState<{ coords: { lat: number; lng: number } | null; ready: boolean }>({ coords: null, ready: false });
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ coords: null, ready: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => setState({ coords: { lat: p.coords.latitude, lng: p.coords.longitude }, ready: true }),
      () => setState({ coords: null, ready: true }),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 600_000 },
    );
  }, []);
  return state;
}
export function useGearItems() {
  return useQuery({ queryKey: QK.gear, queryFn: () => db.listMyGear() });
}

// Prefetch helpers for touch-warm caches.
export function prefetchTrip(qc: QueryClient, id: string) {
  return Promise.all([
    qc.prefetchQuery({ queryKey: QK.trips.detail(id), queryFn: () => db.getTrip(id), staleTime: 30_000 }),
    qc.prefetchQuery({ queryKey: QK.trips.members(id), queryFn: () => db.listTripMembers(id), staleTime: 30_000 }),
    qc.prefetchQuery({ queryKey: QK.trips.activity(id), queryFn: () => db.listTripActivity(id), staleTime: 30_000 }),
  ]);
}
export function prefetchLake(qc: QueryClient, id: string) {
  return Promise.all([
    qc.prefetchQuery({ queryKey: QK.lakes.annotations(id), queryFn: () => db.listLakeAnnotations(id), staleTime: 30_000 }),
  ]);
}

// ============================================================
// Prefetch helpers — call from onTouchStart on links to warm the cache
// before navigation completes. Idempotent and cheap when already cached.
// ============================================================
export function prefetchProfile(qc: QueryClient, username: string) {
  return qc.prefetchQuery({
    queryKey: QK.profiles.byUsername(username),
    queryFn: () => db.getProfileByUsername(username),
    staleTime: 30_000,
  });
}
export function prefetchCatchesForAngler(qc: QueryClient, anglerId: string) {
  return qc.prefetchQuery({
    queryKey: QK.catches.byAngler(anglerId),
    queryFn: () => db.listCatchesForAngler(anglerId),
    staleTime: 30_000,
  });
}

export { useQueryClient };
