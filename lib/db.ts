'use client';
import { supabase } from './supabase';
import type { Angler, Catch, Comment, NotifyConfig, Trip, Weather, Moon } from './types';

// ============ ANGLERS ============
export async function listAnglers(): Promise<Angler[]> {
  const { data, error } = await supabase.from('anglers').select('*').order('created_at');
  if (error) throw error;
  return data as Angler[];
}
export async function bulkSetAnglers(anglers: { name: string; color: string }[]): Promise<Angler[]> {
  // Replace anglers wholesale (used during onboarding only).
  await supabase.from('anglers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { data, error } = await supabase.from('anglers').insert(anglers.map(a => ({ name: a.name, color: a.color }))).select();
  if (error) throw error;
  return data as Angler[];
}
export async function updateAnglers(rows: Angler[]): Promise<void> {
  for (const r of rows) {
    await supabase.from('anglers').update({ name: r.name, color: r.color }).eq('id', r.id);
  }
}

// ============ TRIPS ============
export async function listTrips(): Promise<Trip[]> {
  const { data, error } = await supabase.from('trips').select('*').order('start_date', { ascending: false });
  if (error) throw error;
  return data as Trip[];
}
export async function upsertTrip(t: Partial<Trip> & { name: string; start_date: string; end_date: string }): Promise<Trip> {
  const payload: any = {
    name: t.name, location: t.location ?? null,
    start_date: t.start_date, end_date: t.end_date, notes: t.notes ?? null,
  };
  if (t.id) {
    const { data, error } = await supabase.from('trips').update(payload).eq('id', t.id).select().single();
    if (error) throw error; return data as Trip;
  }
  const { data, error } = await supabase.from('trips').insert(payload).select().single();
  if (error) throw error; return data as Trip;
}
export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw error;
}

// ============ CATCHES ============
export async function listCatches(): Promise<Catch[]> {
  const { data, error } = await supabase.from('catches').select('*').order('date', { ascending: false });
  if (error) throw error;
  return (data || []) as Catch[];
}

export type CatchInput = {
  id?: string;
  angler_id: string;
  lost: boolean;
  lbs: number;
  oz: number;
  species: string | null;
  date: string;
  trip_id: string | null;
  lake?: string | null;
  swim?: string | null;
  bait?: string | null;
  rig?: string | null;
  notes?: string | null;
  has_photo: boolean;
  weather: Weather | null;
  moon: Moon | null;
  comments?: Comment[];
};

export async function upsertCatch(c: CatchInput): Promise<Catch> {
  const payload: any = { ...c };
  if (c.id) {
    const { data, error } = await supabase.from('catches').update(payload).eq('id', c.id).select().single();
    if (error) throw error; return data as Catch;
  }
  const { data, error } = await supabase.from('catches').insert(payload).select().single();
  if (error) throw error; return data as Catch;
}
export async function deleteCatch(id: string): Promise<void> {
  const { error } = await supabase.from('catches').delete().eq('id', id);
  if (error) throw error;
}

// Comments stored as jsonb on catches
export async function setComments(catchId: string, comments: Comment[]): Promise<void> {
  const { error } = await supabase.from('catches').update({ comments }).eq('id', catchId);
  if (error) throw error;
}

// ============ PHOTOS ============
export async function getPhoto(catchId: string): Promise<string | null> {
  const { data, error } = await supabase.from('photos').select('data').eq('catch_id', catchId).maybeSingle();
  if (error || !data) return null;
  return (data as any).data as string;
}
export async function setPhoto(catchId: string, dataUrl: string): Promise<void> {
  // upsert (one photo per catch)
  await supabase.from('photos').delete().eq('catch_id', catchId);
  const { error } = await supabase.from('photos').insert({ catch_id: catchId, data: dataUrl });
  if (error) throw error;
}

// ============ NOTIFY ============
export async function getNotify(): Promise<NotifyConfig> {
  const { data, error } = await supabase.from('notify_config').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return { token: null, chat_id: null, enabled: false };
  return { token: (data as any).token, chat_id: (data as any).chat_id, enabled: !!(data as any).enabled };
}
export async function setNotify(n: NotifyConfig): Promise<void> {
  await supabase.from('notify_config').upsert({ id: 1, token: n.token, chat_id: n.chat_id, enabled: n.enabled });
}
