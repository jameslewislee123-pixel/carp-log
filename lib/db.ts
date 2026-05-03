'use client';
import { supabase } from './supabase/client';
import type {
  AppNotification, Catch, CatchVisibility, Comment, Friendship, Moon, NotifyConfig,
  Profile, Trip, TripMember, TripVisibility, Weather,
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
    start_date: t.start_date, end_date: t.end_date, notes: t.notes ?? null,
    visibility: t.visibility || 'invited_only',
  };
  if (t.id) {
    const { data, error } = await supabase().from('trips').update(payload).eq('id', t.id).select().single();
    if (error) throw error; return data as Trip;
  }
  const { data, error } = await supabase().from('trips').insert(payload).select().single();
  if (error) throw error; return data as Trip;
}
export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase().from('trips').delete().eq('id', id);
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
  lake?: string | null; swim?: string | null; bait?: string | null; rig?: string | null; notes?: string | null;
  has_photo: boolean;
  weather: Weather | null;
  moon: Moon | null;
  visibility: CatchVisibility;
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

export async function setComments(catchId: string, comments: Comment[]): Promise<void> {
  const { error } = await supabase().from('catches').update({ comments }).eq('id', catchId);
  if (error) throw error;
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
