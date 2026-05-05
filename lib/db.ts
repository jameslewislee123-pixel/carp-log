'use client';
import { supabase } from './supabase/client';
import type {
  AppNotification, Catch, CatchComment, CatchLike, CatchVisibility, Comment, CommentLike, FieldVisibility,
  Friendship, GearItem, GearType, Lake, LakeAnnotation, LakeAnnotationType, Moon,
  NotifyConfig, Profile, RodSpot, SwimRollResult, Trip, TripActivity, TripMember, TripMessage,
  TripStake, TripSwimRoll, TripVisibility, Weather,
} from './types';

// ============ PROFILES ============
export async function getMe(): Promise<Profile | null> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return null;
  const { data } = await supabase().from('profiles').select('*').eq('id', user.id).maybeSingle();
  return (data as Profile) || null;
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const { data } = await supabase().from('profiles').select('*').eq('username', username.toLowerCase()).maybeSingle();
  return (data as Profile) || null;
}

export async function updateProfile(patch: Partial<Profile>): Promise<Profile | null> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase().from('profiles').update(patch).eq('id', user.id).select().single();
  if (error) throw error;
  return data as Profile;
}

export async function searchProfiles(query: string, limit = 20): Promise<Profile[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { data } = await supabase()
    .from('profiles').select('*')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(limit);
  return (data || []) as Profile[];
}

export async function listProfilesByIds(ids: string[]): Promise<Profile[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase().from('profiles').select('*').in('id', ids);
  return (data || []) as Profile[];
}

// ============ FRIENDSHIPS ============
export async function listFriendships(): Promise<Friendship[]> {
  const { data } = await supabase().from('friendships').select('*').order('updated_at', { ascending: false });
  return (data || []) as Friendship[];
}

export async function listAcceptedFriends(myId: string): Promise<Profile[]> {
  const fs = await listFriendships();
  const friendIds = fs.filter(f => f.status === 'accepted').map(f => f.requester_id === myId ? f.addressee_id : f.requester_id);
  return listProfilesByIds(friendIds);
}

export async function requestFriend(addresseeId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase().from('friendships').insert({
    requester_id: user.id, addressee_id: addresseeId, status: 'pending',
  });
  if (error) throw error;
}

export async function acceptFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase().from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
  if (error) throw error;
}
export async function declineFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase().from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}
// Delete the friendship row between the current user and `otherUserId`,
// regardless of which direction the request was originally made. Used by
// both the "unfriend" and "cancel sent request" actions on profile pages.
export async function deleteFriendshipWith(otherUserId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return;
  await supabase().from('friendships').delete().or(
    `and(requester_id.eq.${user.id},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${user.id})`
  );
}

export async function removeFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase().from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}

// ============ TRIPS ============
export async function listTrips(): Promise<Trip[]> {
  const { data } = await supabase().from('trips').select('*').order('start_date', { ascending: false });
  return (data || []) as Trip[];
}
export async function getTrip(id: string): Promise<Trip | null> {
  const { data } = await supabase().from('trips').select('*').eq('id', id).maybeSingle();
  return (data as Trip) || null;
}
export async function upsertTrip(t: Partial<Trip> & { name: string; start_date: string; end_date: string; visibility?: TripVisibility }): Promise<Trip> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const payload: any = {
    owner_id: user.id,
    name: t.name, location: t.location ?? null,
    lake_id: t.lake_id ?? null,
    start_date: t.start_date, end_date: t.end_date, notes: t.notes ?? null,
    visibility: t.visibility || 'invited_only',
    wager_enabled: !!t.wager_enabled,
    wager_description: t.wager_description ?? null,
  };
  if (t.id) {
    const { data, error } = await supabase().from('trips').update(payload).eq('id', t.id).select().single();
    if (error) throw error; return data as Trip;
  }
  const { data, error } = await supabase().from('trips').insert(payload).select().single();
  if (error) throw error; return data as Trip;
}

// Create a trip and (atomically-ish) invite a list of anglers in a single user gesture.
export async function createTripWithInvites(
  t: Partial<Trip> & { name: string; start_date: string; end_date: string; visibility?: TripVisibility },
  inviteIds: string[],
): Promise<Trip> {
  const trip = await upsertTrip(t);
  if (inviteIds.length > 0) {
    await inviteToTrip(trip.id, inviteIds);
  }
  return trip;
}
export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase().from('trips').delete().eq('id', id);
  if (error) throw error;
}

// Remove the current user from a trip they joined. RLS allows an angler
// to delete their own trip_members row; the trip itself stays intact.
export async function leaveTrip(tripId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase().from('trip_members').delete()
    .eq('trip_id', tripId).eq('angler_id', user.id);
  if (error) throw error;
}

// ============ TRIP MEMBERS ============
export async function listTripMembers(tripId: string): Promise<TripMember[]> {
  const { data } = await supabase().from('trip_members').select('*').eq('trip_id', tripId);
  return (data || []) as TripMember[];
}

export async function listMyTripMemberships(): Promise<TripMember[]> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return [];
  const { data } = await supabase().from('trip_members').select('*').eq('angler_id', user.id);
  return (data || []) as TripMember[];
}

export async function inviteToTrip(tripId: string, anglerIds: string[]): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const rows = anglerIds.map(angler_id => ({
    trip_id: tripId, angler_id, role: 'contributor' as const, status: 'invited' as const, invited_by: user.id,
  }));
  if (rows.length === 0) return;
  const { error } = await supabase().from('trip_members').insert(rows);
  if (error) throw error;
}

export async function setTripMemberStatus(tripMemberId: string, status: 'joined' | 'declined'): Promise<void> {
  const { error } = await supabase().from('trip_members').update({ status }).eq('id', tripMemberId);
  if (error) throw error;
}
export async function removeTripMember(tripMemberId: string): Promise<void> {
  const { error } = await supabase().from('trip_members').delete().eq('id', tripMemberId);
  if (error) throw error;
}

// ============ CATCHES ============
export async function getCatchById(id: string): Promise<Catch | null> {
  const { data } = await supabase().from('catches').select('*').eq('id', id).maybeSingle();
  return (data as Catch) || null;
}

export async function listCatches(): Promise<Catch[]> {
  const { data } = await supabase().from('catches').select('*').order('date', { ascending: false });
  return (data || []) as Catch[];
}
export async function listCatchesForAngler(anglerId: string): Promise<Catch[]> {
  const { data } = await supabase().from('catches').select('*').eq('angler_id', anglerId).order('date', { ascending: false });
  return (data || []) as Catch[];
}

export type CatchInput = {
  id?: string;
  trip_id: string | null;
  lost: boolean;
  lbs: number; oz: number;
  species: string | null;
  date: string;
  lake?: string | null; lake_id?: string | null;
  swim?: string | null; bait?: string | null; rig?: string | null; hook?: string | null; notes?: string | null;
  has_photo: boolean;
  weather: Weather | null;
  moon: Moon | null;
  latitude?: number | null;
  longitude?: number | null;
  visibility: CatchVisibility;
  // Optional per-field privacy map. Defaults to {} (everything public) when
  // omitted. Persisted to the catches.field_visibility JSONB column.
  field_visibility?: FieldVisibility;
  // Ordered list of storage URLs for this catch. Pass through on update;
  // for inserts the photos are uploaded after the row exists and a
  // separate updateCatchPhotos call writes the array.
  photo_urls?: string[];
  comments?: Comment[];
};

export async function upsertCatch(c: CatchInput): Promise<Catch> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const payload: any = { ...c, angler_id: user.id };
  if (c.id) {
    const { data, error } = await supabase().from('catches').update(payload).eq('id', c.id).select().single();
    if (error) throw error; return data as Catch;
  }
  const { data, error } = await supabase().from('catches').insert(payload).select().single();
  if (error) throw error; return data as Catch;
}

export async function deleteCatch(id: string): Promise<void> {
  // also delete the photo from storage; failure is non-fatal.
  try { await deletePhoto(id); } catch {}
  const { error } = await supabase().from('catches').delete().eq('id', id);
  if (error) throw error;
}

// Legacy: comments used to live in a jsonb column. New code uses
// listCatchComments / addCatchComment / deleteCatchComment instead.

// ============ COMMENTS (dedicated table) ============
export async function listCatchComments(catchId: string): Promise<CatchComment[]> {
  const { data, error } = await supabase().from('catch_comments').select('*')
    .eq('catch_id', catchId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as CatchComment[];
}
export async function addCatchComment(catchId: string, text: string): Promise<CatchComment> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase().from('catch_comments')
    .insert({ catch_id: catchId, angler_id: user.id, text }).select().single();
  if (error) throw error;
  return data as CatchComment;
}
export async function deleteCatchComment(id: string): Promise<void> {
  const { error } = await supabase().from('catch_comments').delete().eq('id', id);
  if (error) throw error;
}
export async function countCatchComments(catchIds: string[]): Promise<Record<string, number>> {
  if (catchIds.length === 0) return {};
  const { data, error } = await supabase().from('catch_comments')
    .select('catch_id').in('catch_id', catchIds);
  if (error) return {};
  const out: Record<string, number> = {};
  (data || []).forEach((row: any) => { out[row.catch_id] = (out[row.catch_id] || 0) + 1; });
  return out;
}

// ============ COMMENT LIKES ============
export async function listCommentLikes(commentIds: string[]): Promise<CommentLike[]> {
  if (commentIds.length === 0) return [];
  const { data } = await supabase().from('comment_likes').select('*').in('comment_id', commentIds);
  return (data || []) as CommentLike[];
}
export async function likeComment(commentId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase().from('comment_likes')
    .insert({ comment_id: commentId, angler_id: user.id });
}
export async function unlikeComment(commentId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return;
  await supabase().from('comment_likes')
    .delete().eq('comment_id', commentId).eq('angler_id', user.id);
}

// ============ CATCH LIKES ============
// Per-catch thumbs-up. Composite primary key (catch_id, angler_id) — RLS
// lets anyone read counts but only the owning angler can insert/delete
// their own row.

// Aggregated counts for a list of catches in one round-trip. Returns
// { [catch_id]: count }. Implemented client-side over a SELECT because
// PostgREST doesn't expose group-by directly without an RPC.
export async function listCatchLikeCounts(catchIds: string[]): Promise<Record<string, number>> {
  if (catchIds.length === 0) return {};
  const { data } = await supabase()
    .from('catch_likes')
    .select('catch_id')
    .in('catch_id', catchIds);
  const out: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    out[row.catch_id] = (out[row.catch_id] || 0) + 1;
  });
  catchIds.forEach(id => { if (!(id in out)) out[id] = 0; });
  return out;
}

// Set of catch_ids the current user has liked (for any of the supplied
// ids). Returned as an array so it serializes through the cache cleanly.
export async function listMyCatchLikedIds(catchIds: string[]): Promise<string[]> {
  if (catchIds.length === 0) return [];
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return [];
  const { data } = await supabase()
    .from('catch_likes')
    .select('catch_id')
    .eq('angler_id', user.id)
    .in('catch_id', catchIds);
  return (data || []).map((r: any) => r.catch_id as string);
}

export async function likeCatch(catchId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase().from('catch_likes').insert({ catch_id: catchId, angler_id: user.id });
}

export async function unlikeCatch(catchId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return;
  await supabase().from('catch_likes')
    .delete().eq('catch_id', catchId).eq('angler_id', user.id);
}

// ============ PHOTOS (Supabase Storage) ============
const BUCKET = 'catch-photos';

export function photoPath(anglerId: string, catchId: string) {
  return `${anglerId}/${catchId}.jpg`;
}

export function photoPublicUrl(anglerId: string, catchId: string): string {
  const { data } = supabase().storage.from(BUCKET).getPublicUrl(photoPath(anglerId, catchId));
  return data.publicUrl;
}

// Resolve the cover photo URL for a catch. Multi-photo catches store an
// ordered photo_urls array (cover at index 0); legacy single-photo catches
// only set has_photo and live at the derived {anglerId}/{catchId}.jpg path.
// Returns null when the catch has no photo at all.
export function catchCoverUrl(c: { photo_urls?: string[] | null; has_photo?: boolean | null; angler_id: string; id: string }): string | null {
  if (c.photo_urls && c.photo_urls.length > 0) return c.photo_urls[0];
  if (c.has_photo) return photoPublicUrl(c.angler_id, c.id);
  return null;
}

export async function uploadPhotoFromDataUrl(catchId: string, dataUrl: string): Promise<string> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const blob = await (await fetch(dataUrl)).blob();
  const path = photoPath(user.id, catchId);
  const { error } = await supabase().storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg', upsert: true, cacheControl: '3600',
  });
  if (error) throw error;
  return photoPublicUrl(user.id, catchId);
}

// Multi-photo upload. Each call appends a new file at
// {anglerId}/{catchId}/{timestamp}-{rand}.jpg and returns the public URL.
// Order is tracked by the caller via the catches.photo_urls array.
export async function uploadCatchPhoto(catchId: string, dataUrl: string): Promise<string> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const blob = await (await fetch(dataUrl)).blob();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `${user.id}/${catchId}/${filename}`;
  const { error } = await supabase().storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg', upsert: false, cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = supabase().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Delete a photo by its public URL. Best-effort — failures are swallowed
// since a stuck file is far better than a stuck UI.
export async function deleteCatchPhotoByUrl(url: string): Promise<void> {
  // Public URL shape: .../object/public/<bucket>/<path>
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return;
  const path = url.slice(idx + marker.length).split('?')[0];
  if (!path) return;
  await supabase().storage.from(BUCKET).remove([path]);
}

// Persist the photo_urls array (and matching has_photo flag) for a catch
// after photo uploads / deletions complete. Called once per save.
export async function updateCatchPhotos(catchId: string, photoUrls: string[]): Promise<void> {
  await supabase().from('catches').update({
    photo_urls: photoUrls,
    has_photo: photoUrls.length > 0,
  }).eq('id', catchId);
}

// ============ PUSH NOTIFICATIONS (preferences) ============
export type NotifPrefRow = {
  user_id: string;
  enabled: Record<string, boolean>;
  push_master: boolean;
  updated_at?: string;
};

const DEFAULT_PREFS: Record<string, boolean> = {
  trip_new_catch: true, trip_new_member: true, trip_invite: true,
  trip_chat: false, trip_chat_mention: true,
  friend_request: true, friend_accepted: true, comment_on_catch: true,
  catch_liked: true,
};

export async function getMyNotifPrefs(): Promise<NotifPrefRow> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data } = await supabase().from('notification_preferences')
    .select('*').eq('user_id', user.id).maybeSingle();
  if (data) {
    const enabled = { ...DEFAULT_PREFS, ...(data.enabled || {}) };
    return { user_id: user.id, enabled, push_master: !!data.push_master };
  }
  // Lazy-create with defaults so subsequent updates have a row.
  await supabase().from('notification_preferences')
    .insert({ user_id: user.id, enabled: DEFAULT_PREFS, push_master: false })
    .then(() => {});
  return { user_id: user.id, enabled: { ...DEFAULT_PREFS }, push_master: false };
}

export async function setPushMaster(enabled: boolean): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase().from('notification_preferences')
    .upsert({ user_id: user.id, push_master: enabled }, { onConflict: 'user_id' });
}

export async function setPushTypePref(type: string, value: boolean): Promise<void> {
  const cur = await getMyNotifPrefs();
  const next = { ...cur.enabled, [type]: value };
  await supabase().from('notification_preferences')
    .upsert({ user_id: cur.user_id, enabled: next }, { onConflict: 'user_id' });
}

// ============ AVATARS ============
const AVATAR_BUCKET = 'avatars';
export async function uploadAvatarFromDataUrl(dataUrl: string): Promise<string> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${user.id}/avatar.jpg`;
  const { error } = await supabase().storage.from(AVATAR_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg', upsert: true, cacheControl: '60',
  });
  if (error) throw error;
  // bust the public URL cache by appending a timestamp
  const { data } = supabase().storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  await updateProfile({ avatar_url: url });
  return url;
}

export async function deletePhoto(catchId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return;
  await supabase().storage.from(BUCKET).remove([photoPath(user.id, catchId)]);
}

// ============ NOTIFY CONFIG (per-user) ============
export async function getMyNotify(): Promise<NotifyConfig | null> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return null;
  const { data } = await supabase().from('notify_config').select('*').eq('angler_id', user.id).maybeSingle();
  return (data as NotifyConfig) || null;
}
export async function getNotifyForAngler(anglerId: string): Promise<NotifyConfig | null> {
  const { data } = await supabase().from('notify_config').select('*').eq('angler_id', anglerId).maybeSingle();
  return (data as NotifyConfig) || null;
}
export async function saveMyNotify(n: { token: string | null; chat_id: string | null; enabled: boolean }): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase().from('notify_config').upsert({ angler_id: user.id, ...n }, { onConflict: 'angler_id' });
  if (error) throw error;
}

// ============ TRIP MESSAGES (chat) ============
export async function listTripMessages(tripId: string, limit = 200): Promise<TripMessage[]> {
  const { data } = await supabase().from('trip_messages').select('*')
    .eq('trip_id', tripId).order('created_at', { ascending: true }).limit(limit);
  return (data || []) as TripMessage[];
}
export async function sendTripMessage(tripId: string, text: string): Promise<TripMessage> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase().from('trip_messages')
    .insert({ trip_id: tripId, angler_id: user.id, text }).select().single();
  if (error) throw error;
  return data as TripMessage;
}
export async function deleteTripMessage(id: string): Promise<void> {
  const { error } = await supabase().from('trip_messages').delete().eq('id', id);
  if (error) throw error;
}

// ============ TRIP STAKES (per-member wager pledge) ============
export async function listTripStakes(tripId: string): Promise<TripStake[]> {
  const { data } = await supabase().from('trip_stakes').select('*').eq('trip_id', tripId);
  return (data || []) as TripStake[];
}
export async function setMyTripStake(tripId: string, stakeText: string): Promise<TripStake> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase().from('trip_stakes')
    .upsert({ trip_id: tripId, angler_id: user.id, stake_text: stakeText }, { onConflict: 'trip_id,angler_id' })
    .select().single();
  if (error) throw error;
  return data as TripStake;
}
export async function deleteMyTripStake(tripId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return;
  await supabase().from('trip_stakes').delete().eq('trip_id', tripId).eq('angler_id', user.id);
}

// ============ TRIP ACTIVITY ============
export async function listTripActivity(tripId: string, limit = 50): Promise<TripActivity[]> {
  const { data } = await supabase().from('trip_activity').select('*')
    .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(limit);
  return (data || []) as TripActivity[];
}

// ============ TRIP SWIM ROLLS (dice) ============
function rollD20(): number {
  // Cryptographic randomness for fairness; fallback to Math.random.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return (a[0] % 20) + 1;
  }
  return Math.floor(Math.random() * 20) + 1;
}

// Generate a roll for a list of anglers, breaking ties by re-rolling the tied set.
export function rollDiceForAnglers(anglerIds: string[]): SwimRollResult[] {
  if (anglerIds.length === 0) return [];
  const draft = anglerIds.map(id => ({ angler_id: id, value: rollD20() }));
  // Re-roll any group with the same value (recursive on tied subsets).
  const byValue: Record<number, SwimRollResult[]> = {};
  draft.forEach(r => { (byValue[r.value] ||= []).push(r); });
  for (const [val, group] of Object.entries(byValue)) {
    if (group.length > 1) {
      // re-roll only this tied group
      const reRolled = rollDiceForAnglers(group.map(g => g.angler_id));
      // splice rerolls back into draft preserving original positions
      const map = new Map(reRolled.map(r => [r.angler_id, r.value]));
      group.forEach(g => { g.value = map.get(g.angler_id) ?? g.value; });
    }
  }
  return draft.sort((a, b) => b.value - a.value);
}

export async function listTripRolls(tripId: string): Promise<TripSwimRoll[]> {
  const { data } = await supabase().from('trip_swim_rolls').select('*')
    .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(20);
  return (data || []) as TripSwimRoll[];
}
export async function getLatestTripRoll(tripId: string): Promise<TripSwimRoll | null> {
  const { data } = await supabase().from('trip_swim_rolls').select('*')
    .eq('trip_id', tripId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as TripSwimRoll) || null;
}
export async function createTripRoll(tripId: string, results: SwimRollResult[]): Promise<TripSwimRoll> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase().from('trip_swim_rolls')
    .insert({ trip_id: tripId, rolled_by: user.id, results }).select().single();
  if (error) throw error;
  return data as TripSwimRoll;
}

// ============ GEAR ITEMS (tackle) ============
export async function listMyGear(types?: GearType[]): Promise<GearItem[]> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return [];
  let q = supabase().from('gear_items').select('*')
    .eq('angler_id', user.id).eq('active', true).order('updated_at', { ascending: false });
  if (types && types.length) q = q.in('type', types);
  const { data } = await q;
  return (data || []) as GearItem[];
}

// Returns mine + shared-by-friends, deduped by (angler_id, name).
export async function listVisibleGear(type: GearType): Promise<GearItem[]> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return [];
  const { data } = await supabase().from('gear_items').select('*')
    .eq('type', type).eq('active', true).order('shared', { ascending: true });
  return (data || []) as GearItem[];
}

export async function upsertGearItem(input: { id?: string; type: GearType; name: string; description?: string | null; shared?: boolean }): Promise<GearItem> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (input.id) {
    const { data, error } = await supabase().from('gear_items')
      .update({ type: input.type, name: input.name, description: input.description ?? null, shared: !!input.shared })
      .eq('id', input.id).select().single();
    if (error) throw error; return data as GearItem;
  }
  const { data, error } = await supabase().from('gear_items')
    .insert({ angler_id: user.id, type: input.type, name: input.name, description: input.description ?? null, shared: !!input.shared })
    .select().single();
  if (error) throw error; return data as GearItem;
}
export async function archiveGearItem(id: string): Promise<void> {
  const { error } = await supabase().from('gear_items').update({ active: false }).eq('id', id);
  if (error) throw error;
}
export async function setGearShared(id: string, shared: boolean): Promise<void> {
  const { error } = await supabase().from('gear_items').update({ shared }).eq('id', id);
  if (error) throw error;
}

// ============ LAKES + ANNOTATIONS ============
export async function listLakes(): Promise<Lake[]> {
  const { data } = await supabase().from('lakes').select('*').order('name');
  return (data || []) as Lake[];
}

// Fetch a specific subset of lakes by id. Used by useLakes() to scope
// the cold-load payload to "my lakes" (~5–50 rows) instead of pulling
// the entire 2k+ row global table — which also tripped Supabase's
// default 1000-row hard cap on plain selects.
export async function listLakesByIds(ids: string[]): Promise<Lake[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase().from('lakes').select('*').in('id', ids).order('name');
  return (data || []) as Lake[];
}

// Insert a lake discovered via OSM Overpass into the lakes table. Marks the
// row with source='osm' so the UI can show an "OSM" pill and so we can later
// dedupe against manually-typed lakes. Returns the inserted row.
export async function createLakeFromOSM(input: {
  name: string; latitude: number; longitude: number;
}): Promise<Lake> {
  const { data: { user } } = await supabase().auth.getUser();
  const payload: any = {
    name: input.name.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    created_by: user?.id || null,
    source: 'osm',
  };
  const { data, error } = await supabase().from('lakes').insert(payload).select().single();
  if (error) throw error;
  return data as Lake;
}
export async function getLakeByName(name: string): Promise<Lake | null> {
  // case-insensitive lookup
  const { data } = await supabase().from('lakes').select('*').ilike('name', name.trim()).maybeSingle();
  return (data as Lake) || null;
}

// Resolve a typed lake name to a canonical lakes.id, creating a manual
// row if no existing lake matches. Always bookmarks the resolved lake
// for the current user so it surfaces in the Lakes tab afterwards.
//
// Used by AddCatch's save flow: user types "Linear" → we look up the
// lake row (matching seed lakes case-insensitively), or create a new
// manual row at fallback coords if nothing matches. This avoids the
// duplicate-row problem the ensure_lake_row trigger creates when a
// typed name doesn't exact-match a seed lake.
export async function resolveOrCreateLake(input: {
  name: string;
  fallbackLat?: number | null;
  fallbackLng?: number | null;
}): Promise<{ id: string; created: boolean }> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('Lake name required');

  // Case-insensitive exact match against ANY existing lake row (user's
  // related set, seed dataset, OSM/Nominatim picks). The lakes.name
  // column has a `lower(name)` index from migration 0007, so this is
  // a btree lookup, not a sequential scan.
  const { data: matches } = await supabase()
    .from('lakes').select('id').ilike('name', trimmed).limit(1);
  if (matches && matches[0]) {
    const id = (matches[0] as { id: string }).id;
    try { await saveLakeForUser(id); } catch (e) { console.warn('[resolveOrCreateLake] bookmark failed', e); }
    return { id, created: false };
  }

  // No match — create a manual lake at the fallback coords (caller
  // typically passes the catch's GPS or the device's cached location).
  const { data: created, error } = await supabase().from('lakes').insert({
    name: trimmed,
    latitude: input.fallbackLat ?? null,
    longitude: input.fallbackLng ?? null,
    created_by: user.id,
    source: 'manual',
  }).select('id').single();
  if (error) throw error;
  const id = (created as { id: string }).id;
  try { await saveLakeForUser(id); } catch (e) { console.warn('[resolveOrCreateLake] bookmark failed', e); }
  return { id, created: true };
}

// ============ USER-SAVED LAKES (bookmarks) ============
// A user can bookmark any lake row, even ones they didn't create or fish.
// The Lakes tab unions this set with catches/trips/created_by so seed
// lakes (which have created_by IS NULL) and Nominatim picks all surface.
export async function listMySavedLakeIds(): Promise<string[]> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return [];
  const { data } = await supabase().from('user_saved_lakes').select('lake_id').eq('user_id', user.id);
  return ((data || []) as { lake_id: string }[]).map((r) => r.lake_id);
}

export async function saveLakeForUser(lakeId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  // Idempotent: PK is (user_id, lake_id). ignoreDuplicates makes re-saving
  // an already-bookmarked lake a no-op.
  const { error } = await supabase().from('user_saved_lakes').upsert(
    { user_id: user.id, lake_id: lakeId },
    { onConflict: 'user_id,lake_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function unsaveLakeForUser(lakeId: string): Promise<void> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase().from('user_saved_lakes').delete()
    .eq('user_id', user.id).eq('lake_id', lakeId);
  if (error) throw error;
}

// Best-effort count of catches by other anglers at a lake. Bounded by RLS
// (catches_select) — we only see public catches + ours + friends'/trip-mates'.
// A non-zero result is a strong signal "other people have catches here";
// zero means no visible foreign catches, which is good enough to allow a
// creator-initiated lake delete.
export async function countOtherAnglerCatchesAtLake(lakeId: string): Promise<number> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return 0;
  const { count } = await supabase()
    .from('catches')
    .select('id', { count: 'exact', head: true })
    .eq('lake_id', lakeId)
    .neq('angler_id', user.id);
  return count || 0;
}

// Hard-delete a lake row. RLS (lakes_delete_creator) restricts this to
// the creator. catches.lake_id and trips.lake_id are both ON DELETE SET
// NULL so existing references survive as unlinked free-text entries.
export async function deleteLake(lakeId: string): Promise<void> {
  const { error } = await supabase().from('lakes').delete().eq('id', lakeId);
  if (error) throw error;
}

// Server-side ILIKE search across the seed dataset (UK + France imports).
// Bounded to source='seed' so we don't surface random user-created or
// OSM-discovered rows here — those flow through the existing saved /
// worldwide sections. Backed by idx_lakes_lower_name for fast substring
// scans at thousands of rows.
export async function searchSeedLakes(query: string, limit = 12): Promise<Lake[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  // Escape ILIKE wildcards so a user typing % or _ doesn't blow the query open.
  const safe = q.replace(/[%_\\]/g, (c) => '\\' + c);
  const { data, error } = await supabase()
    .from('lakes')
    .select('*')
    .eq('source', 'seed')
    .ilike('name', `%${safe}%`)
    .order('name')
    .limit(limit);
  if (error) return [];
  return (data || []) as Lake[];
}

// Persist a lake picked from the global Nominatim search. Carries the
// rich metadata (osm_id, country, region, importance, photo_url, etc.)
// so we don't have to re-resolve next time. Dedupes by osm_id — if the
// user picks a lake they (or anyone) already added, we return the
// existing row instead of creating a duplicate.
export async function createLakeFromGlobal(input: {
  osm_id: number;
  osm_type: string;
  name: string;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  importance: number | null;
  photo_url: string | null;
  photo_source: 'wikipedia' | 'satellite' | null;
}): Promise<Lake> {
  // Dedupe by osm_id (any source — could already be saved as 'osm' from
  // the nearby-discovery flow).
  const { data: existing } = await supabase()
    .from('lakes').select('*').eq('osm_id', input.osm_id).limit(1).maybeSingle();
  if (existing) return existing as Lake;

  const { data: { user } } = await supabase().auth.getUser();
  const payload: any = {
    name: input.name.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    created_by: user?.id || null,
    source: 'nominatim',
    osm_id: input.osm_id,
    osm_type: input.osm_type,
    country: input.country,
    region: input.region,
    importance: input.importance,
    photo_url: input.photo_url,
    photo_source: input.photo_source,
  };
  const { data, error } = await supabase().from('lakes').insert(payload).select().single();
  if (error) throw error;
  return data as Lake;
}

// Manually-created lake (no OSM source). User typed a name, optionally
// dropped a pin. Source='manual'. If a row with this name already
// exists (case-insensitive) we return it instead of erroring on the
// unique-name index.
export async function createManualLake(input: {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<Lake> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('Lake name required');
  const existing = await getLakeByName(trimmed);
  if (existing) return existing;
  const { data: { user } } = await supabase().auth.getUser();
  const payload: any = {
    name: trimmed,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    created_by: user?.id || null,
    source: 'manual',
  };
  const { data, error } = await supabase().from('lakes').insert(payload).select().single();
  if (error) throw error;
  return data as Lake;
}
export async function getLake(id: string): Promise<Lake | null> {
  const { data } = await supabase().from('lakes').select('*').eq('id', id).maybeSingle();
  return (data as Lake) || null;
}

export async function listLakeAnnotations(lakeId: string): Promise<LakeAnnotation[]> {
  const { data } = await supabase().from('lake_annotations').select('*')
    .eq('lake_id', lakeId).order('created_at', { ascending: false });
  return (data || []) as LakeAnnotation[];
}
export async function createLakeAnnotation(input: {
  lake_id: string; type: LakeAnnotationType; latitude: number; longitude: number; title: string; description?: string | null;
}): Promise<LakeAnnotation> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase().from('lake_annotations').insert({
    lake_id: input.lake_id, angler_id: user.id, type: input.type,
    latitude: input.latitude, longitude: input.longitude,
    title: input.title, description: input.description ?? null,
  }).select().single();
  if (error) throw error;
  return data as LakeAnnotation;
}
export async function deleteLakeAnnotation(id: string): Promise<void> {
  await supabase().from('lake_annotations').delete().eq('id', id);
}

// ============ ROD SPOTS ============
// Per-user, per-lake "swim → bait" line bookmarks. Private to the creator
// (RLS on rod_spots only exposes own rows).

export async function listRodSpotsAtLake(lakeId: string): Promise<RodSpot[]> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) return [];
  const { data } = await supabase().from('rod_spots').select('*')
    .eq('lake_id', lakeId).eq('user_id', user.id)
    .order('created_at', { ascending: true });
  return (data || []) as RodSpot[];
}

export type RodSpotInput = {
  id?: string;
  lake_id: string;
  // Optional on insert — when provided, this rod joins an existing swim
  // group (a sibling rod cast from the same swim). Omit for a solo rod;
  // the column default (gen_random_uuid()) gives it a fresh group.
  swim_group_id?: string | null;
  swim_latitude: number;
  swim_longitude: number;
  swim_label?: string | null;
  spot_latitude: number;
  spot_longitude: number;
  spot_label?: string | null;
  wraps_calculated?: number | null;
  wraps_actual?: number | null;
  features?: string | null;
};

export async function createRodSpot(input: RodSpotInput): Promise<RodSpot> {
  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('Not signed in');
  const payload: any = {
    user_id: user.id,
    lake_id: input.lake_id,
    swim_latitude: input.swim_latitude,
    swim_longitude: input.swim_longitude,
    swim_label: input.swim_label ?? null,
    spot_latitude: input.spot_latitude,
    spot_longitude: input.spot_longitude,
    spot_label: input.spot_label ?? null,
    wraps_calculated: input.wraps_calculated ?? null,
    wraps_actual: input.wraps_actual ?? null,
    features: input.features ?? null,
  };
  if (input.swim_group_id) payload.swim_group_id = input.swim_group_id;
  const { data, error } = await supabase().from('rod_spots').insert(payload).select().single();
  if (error) throw error;
  return data as RodSpot;
}

export async function updateRodSpot(id: string, patch: Partial<RodSpotInput>): Promise<RodSpot> {
  const payload: any = { ...patch, updated_at: new Date().toISOString() };
  delete payload.id;
  delete payload.lake_id; // never reassign lake
  const { data, error } = await supabase().from('rod_spots').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data as RodSpot;
}

export async function deleteRodSpot(id: string): Promise<void> {
  const { error } = await supabase().from('rod_spots').delete().eq('id', id);
  if (error) throw error;
}

// ============ NOTIFICATIONS ============
export async function listNotifications(): Promise<AppNotification[]> {
  const { data } = await supabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  return (data || []) as AppNotification[];
}
export async function unreadCount(): Promise<number> {
  const { count } = await supabase().from('notifications').select('*', { count: 'exact', head: true }).eq('read', false);
  return count || 0;
}
export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabase().from('notifications').update({ read: true }).in('id', ids);
}
export async function deleteNotification(id: string): Promise<void> {
  await supabase().from('notifications').delete().eq('id', id);
}
