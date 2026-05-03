'use client';
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
  const ids = [...catchIds].sort();
  return useQuery({
    queryKey: QK.comments.countsForCatches(ids),
    queryFn: () => db.countCatchComments(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
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
