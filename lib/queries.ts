'use client';
import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as db from './db';
import { QK } from './queryKeys';
import type { Catch, Profile, Trip } from './types';

// ============================================================
// Read hooks — these power the cached, deduplicated UI fetches
// ============================================================
export function useCatches() {
  return useQuery({ queryKey: QK.catches.all, queryFn: db.listCatches });
}
export function useCatchesForAngler(anglerId: string | undefined) {
  return useQuery({
    queryKey: anglerId ? QK.catches.byAngler(anglerId) : ['catches', 'angler', 'none'],
    queryFn: () => anglerId ? db.listCatchesForAngler(anglerId) : Promise.resolve([] as Catch[]),
    enabled: !!anglerId,
  });
}
export function useTrips() {
  return useQuery({ queryKey: QK.trips.all, queryFn: db.listTrips });
}
export function useProfileByUsername(username: string | undefined) {
  return useQuery({
    queryKey: username ? QK.profiles.byUsername(username) : ['profiles', 'u', 'none'],
    queryFn: () => username ? db.getProfileByUsername(username) : Promise.resolve(null),
    enabled: !!username,
    staleTime: 5 * 60_000, // profile stuff changes rarely
  });
}
export function useFriendships() {
  return useQuery({ queryKey: QK.friendships, queryFn: db.listFriendships });
}
export function useNotifications() {
  return useQuery({ queryKey: QK.notifications.list, queryFn: db.listNotifications });
}
export function useUnreadCount() {
  return useQuery({
    queryKey: QK.notifications.unread,
    queryFn: db.unreadCount,
    staleTime: 30_000,
  });
}
export function useCatchComments(catchId: string | undefined) {
  return useQuery({
    queryKey: catchId ? QK.comments.byCatch(catchId) : ['comments', 'none'],
    queryFn: () => catchId ? db.listCatchComments(catchId) : Promise.resolve([]),
    enabled: !!catchId,
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
  });
}

// Trip-bound queries.
export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: id ? QK.trips.detail(id) : ['trips', 'detail', 'none'],
    queryFn: () => id ? db.getTrip(id) : Promise.resolve(null),
    enabled: !!id,
  });
}
export function useTripMembers(tripId: string | undefined) {
  return useQuery({
    queryKey: tripId ? QK.trips.members(tripId) : ['trips', 'members', 'none'],
    queryFn: () => tripId ? db.listTripMembers(tripId) : Promise.resolve([]),
    enabled: !!tripId,
  });
}
export function useTripMessages(tripId: string | undefined) {
  return useQuery({
    queryKey: tripId ? QK.trips.messages(tripId) : ['trips', 'messages', 'none'],
    queryFn: () => tripId ? db.listTripMessages(tripId) : Promise.resolve([]),
    enabled: !!tripId,
  });
}
export function useTripActivity(tripId: string | undefined) {
  return useQuery({
    queryKey: tripId ? QK.trips.activity(tripId) : ['trips', 'activity', 'none'],
    queryFn: () => tripId ? db.listTripActivity(tripId) : Promise.resolve([]),
    enabled: !!tripId,
  });
}
export function useLakes() {
  return useQuery({ queryKey: QK.lakes.all, queryFn: db.listLakes });
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
