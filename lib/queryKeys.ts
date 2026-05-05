// Single source of truth for TanStack Query keys.
// Anything that reads or invalidates query cache should use these — keeps
// keys consistent across query, mutation, prefetch, and realtime invalidate.

export const QK = {
  catches: {
    all: ['catches'] as const,
    detail: (id: string) => ['catches', id] as const,
    byAngler: (anglerId: string) => ['catches', 'angler', anglerId] as const,
    byTrip: (tripId: string) => ['catches', 'trip', tripId] as const,
  },
  comments: {
    byCatch: (catchId: string) => ['comments', catchId] as const,
    countsForCatches: (catchIds: string[]) => ['comments', 'counts', [...catchIds].sort().join(',')] as const,
  },
  catchLikes: {
    countsForCatches: (catchIds: string[]) => ['catch_likes', 'counts', [...catchIds].sort().join(',')] as const,
    myLikedFor: (catchIds: string[]) => ['catch_likes', 'mine', [...catchIds].sort().join(',')] as const,
  },
  trips: {
    all: ['trips'] as const,
    detail: (id: string) => ['trips', id] as const,
    members: (tripId: string) => ['trips', tripId, 'members'] as const,
    messages: (tripId: string) => ['trips', tripId, 'messages'] as const,
    activity: (tripId: string) => ['trips', tripId, 'activity'] as const,
    rolls: (tripId: string) => ['trips', tripId, 'rolls'] as const,
    stakes: (tripId: string) => ['trips', tripId, 'stakes'] as const,
  },
  profiles: {
    me: ['profiles', 'me'] as const,
    byId: (id: string) => ['profiles', 'id', id] as const,
    byUsername: (u: string) => ['profiles', 'u', u.toLowerCase()] as const,
    search: (q: string) => ['profiles', 'search', q.toLowerCase()] as const,
  },
  friendships: ['friendships'] as const,
  notifications: {
    list: ['notifications', 'list'] as const,
    unread: ['notifications', 'unread'] as const,
  },
  lakes: {
    all: ['lakes'] as const,
    byName: (name: string) => ['lakes', 'name', name.toLowerCase()] as const,
    annotations: (lakeId: string) => ['lakes', lakeId, 'annotations'] as const,
    mySaved: ['lakes', 'saved', 'mine'] as const,
    rodSpots: (lakeId: string) => ['lakes', lakeId, 'rod_spots'] as const,
  },
  gear: ['gear'] as const,
  notifyConfig: ['notify-config'] as const,
};
