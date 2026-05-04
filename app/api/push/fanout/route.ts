// Receives a Supabase Database Webhook on `notifications INSERT` and fans
// out web-push deliveries to that recipient's subscribed devices.
//
// Security: the webhook must include header `x-webhook-secret: <WEBHOOK_SECRET>`.
// On Supabase's side configure the webhook with this header.

import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient as createSb } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// We use the service-role key here because the trigger comes from Supabase,
// not from a logged-in user — RLS would otherwise block reads.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:nobody@example.com';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

type NotifRow = {
  id: string;
  recipient_id: string;
  type: string;
  payload: Record<string, any>;
  read: boolean;
  created_at: string;
};

function sb() { return createSb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }

async function fetchProfile(id: string) {
  const { data } = await sb().from('profiles').select('id,username,display_name').eq('id', id).maybeSingle();
  return data as { id: string; username: string; display_name: string } | null;
}
async function fetchTrip(id: string) {
  const { data } = await sb().from('trips').select('id,name,start_date,end_date').eq('id', id).maybeSingle();
  return data as { id: string; name: string; start_date: string; end_date: string } | null;
}
async function fetchCatch(id: string) {
  const { data } = await sb().from('catches').select('id,lbs,oz,species,lake,trip_id,angler_id').eq('id', id).maybeSingle();
  return data as { id: string; lbs: number; oz: number; species: string | null; lake: string | null; trip_id: string | null; angler_id: string } | null;
}

function fmtWeight(lbs: number, oz: number) {
  if (!lbs && !oz) return '0lb';
  if (!oz) return `${lbs}lb`;
  return `${lbs}lb ${oz}oz`;
}
function fmtDateRange(s: string, e: string) {
  const sd = new Date(s), ed = new Date(e);
  return `${sd.getDate()} ${sd.toLocaleString('en', { month: 'short' })} – ${ed.getDate()} ${ed.toLocaleString('en', { month: 'short' })}`;
}

// Per-type payload field mapping. Triggers write the actor under a
// type-specific key (liker_*, commenter_*, sender_*, etc.). Older rows
// may only have angler_id / angler_name as a fallback.
function payloadActorId(type: string, p: any): string | undefined {
  switch (type) {
    case 'catch_liked':       return p.liker_id || p.angler_id;
    case 'comment_on_catch':  return p.commenter_id || p.angler_id;
    case 'trip_new_catch':    return p.angler_id;
    case 'friend_request':    return p.requester_id;
    case 'friend_accepted':   return p.addressee_id || p.accepter_id;
    case 'trip_invite':       return p.invited_by || p.inviter_id;
    case 'trip_chat':
    case 'trip_chat_mention': return p.sender_id || p.angler_id;
    case 'trip_new_member':   return p.joiner_id || p.angler_id;
    default:                  return p.actor_id || p.angler_id;
  }
}
function payloadActorName(type: string, p: any): string | undefined {
  switch (type) {
    case 'catch_liked':       return p.liker_name || p.angler_name;
    case 'comment_on_catch':  return p.commenter_name || p.angler_name;
    case 'trip_new_catch':    return p.angler_name;
    case 'friend_request':    return p.requester_name;
    case 'friend_accepted':   return p.accepter_name;
    case 'trip_invite':       return p.inviter_name;
    case 'trip_chat':
    case 'trip_chat_mention': return p.sender_name || p.angler_name;
    case 'trip_new_member':   return p.joiner_name || p.angler_name;
    default:                  return p.angler_name;
  }
}

// Resolve the actor name for a notification: prefer the name embedded
// in the trigger payload, fall back to fetching the profile by id.
// Profile is also returned so friend_accepted can build the URL from
// profile.username.
async function resolveActor(n: NotifRow): Promise<{ name: string; profile: { id: string; username: string; display_name: string } | null }> {
  const p = n.payload || {};
  const namePayload = payloadActorName(n.type, p);
  const id = payloadActorId(n.type, p);
  const profile = id ? await fetchProfile(id) : null;
  const name = namePayload || profile?.display_name || profile?.username || 'Someone';
  return { name, profile };
}

async function buildPayload(n: NotifRow): Promise<{ title: string; body: string; url: string; tag?: string } | null> {
  const p = n.payload || {};
  switch (n.type) {
    case 'trip_new_catch': {
      const { name } = await resolveActor(n);
      const cat = p.catch_id ? await fetchCatch(p.catch_id) : null;
      const trip = cat?.trip_id ? await fetchTrip(cat.trip_id) : null;
      const species = cat?.species || p.species || '';
      const w = cat ? fmtWeight(cat.lbs, cat.oz) : (p.lbs != null ? fmtWeight(p.lbs, p.oz || 0) : '');
      return {
        title: `${name} banked ${w}${species ? ` ${species}` : ''}`,
        body: [cat?.lake, trip?.name].filter(Boolean).join(' · ') || (trip ? 'New catch in your trip' : 'Tap to view'),
        url: `/?catch=${cat?.id || ''}`,
        tag: `trip-catch-${cat?.id || n.id}`,
      };
    }
    case 'trip_new_member': {
      const { name } = await resolveActor(n);
      const trip = p.trip_id ? await fetchTrip(p.trip_id) : null;
      return {
        title: `${name} joined ${trip?.name || 'your trip'}`,
        body: 'Tap to open the trip',
        url: '/notifications',
        tag: `trip-member-${p.trip_id || n.id}`,
      };
    }
    case 'trip_invite': {
      const { name } = await resolveActor(n);
      const trip = p.trip_id ? await fetchTrip(p.trip_id) : null;
      return {
        title: `${name} invited you to ${trip?.name || 'a trip'}`,
        body: trip ? fmtDateRange(trip.start_date, trip.end_date) : 'Tap to view',
        url: '/notifications',
        tag: `trip-invite-${p.trip_id || n.id}`,
      };
    }
    case 'friend_request': {
      const { name } = await resolveActor(n);
      return {
        title: `Friend request from ${name}`,
        body: 'Tap to view',
        url: '/notifications',
        tag: `friend-req-${p.friendship_id || n.id}`,
      };
    }
    case 'friend_accepted': {
      const { name, profile } = await resolveActor(n);
      return {
        title: `${name} accepted your friend request`,
        body: 'Tap to see their profile',
        url: profile?.username ? `/profile/${profile.username}` : '/notifications',
        tag: `friend-acc-${n.id}`,
      };
    }
    case 'comment_on_catch': {
      const { name } = await resolveActor(n);
      const cat = p.catch_id ? await fetchCatch(p.catch_id) : null;
      const w = cat ? `${fmtWeight(cat.lbs, cat.oz)}${cat.species ? ` ${cat.species}` : ''}` : 'your catch';
      return {
        title: `${name} commented on your ${w}`,
        body: (p.snippet || p.preview || 'Tap to read').toString().slice(0, 100),
        url: `/?catch=${cat?.id || ''}`,
        tag: `catch-comment-${cat?.id || n.id}`,
      };
    }
    case 'catch_liked': {
      const { name } = await resolveActor(n);
      const cat = p.catch_id ? await fetchCatch(p.catch_id) : null;
      const w = cat ? `${fmtWeight(cat.lbs, cat.oz)}${cat.species ? ` ${cat.species}` : ''}` : 'your catch';
      return {
        title: `${name} liked your ${w}`,
        body: 'Tap to view',
        url: `/?catch=${cat?.id || ''}`,
        tag: `catch-liked-${cat?.id || n.id}`,
      };
    }
    case 'trip_chat_mention': {
      const { name } = await resolveActor(n);
      const trip = p.trip_id ? await fetchTrip(p.trip_id) : null;
      return {
        title: `${name} mentioned you${trip ? ` in ${trip.name}` : ''}`,
        body: (p.preview || 'Tap to view').toString().slice(0, 100),
        url: '/',
        tag: `chat-mention-${p.message_id || n.id}`,
      };
    }
    case 'trip_chat': {
      const { name } = await resolveActor(n);
      const trip = p.trip_id ? await fetchTrip(p.trip_id) : null;
      return {
        title: `${name}${trip ? ` in ${trip.name}` : ''}`,
        body: (p.snippet || p.preview || '').toString().slice(0, 100),
        url: '/',
        tag: `chat-${p.trip_id || n.id}`,
      };
    }
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return NextResponse.json({ error: 'vapid_not_configured' }, { status: 500 });
  if (!SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'service_role_missing' }, { status: 500 });

  const provided = req.headers.get('x-webhook-secret') || '';
  if (provided !== WEBHOOK_SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Supabase webhook payload format: { type: "INSERT", table, record, old_record, schema }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  if (body?.type !== 'INSERT' || body?.table !== 'notifications') return NextResponse.json({ skipped: true });
  const n = body.record as NotifRow;
  if (!n?.recipient_id) return NextResponse.json({ skipped: 'no_recipient' });

  // Check the recipient's preferences for this notif type.
  const { data: prefRow } = await sb().from('notification_preferences')
    .select('enabled, push_master').eq('user_id', n.recipient_id).maybeSingle();
  const prefs = (prefRow as any) || { enabled: {}, push_master: false };
  if (!prefs.push_master) return NextResponse.json({ skipped: 'push_master_off' });
  const typeAllowed = prefs.enabled?.[n.type];
  // Default to true ONLY for explicitly-known opt-ins; trip_chat defaults to false (noisy).
  if (typeAllowed === false) return NextResponse.json({ skipped: 'type_disabled' });
  if (n.type === 'trip_chat' && typeAllowed !== true) return NextResponse.json({ skipped: 'chat_default_off' });

  const payload = await buildPayload(n);
  if (!payload) return NextResponse.json({ skipped: 'unknown_type' });

  const { data: subs } = await sb().from('push_subscriptions')
    .select('id,endpoint,p256dh_key,auth_key').eq('user_id', n.recipient_id);
  if (!subs || subs.length === 0) return NextResponse.json({ skipped: 'no_subscriptions' });

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url, notif_id: n.id, type: n.type },
  });

  const results = await Promise.allSettled(subs.map(async (s: any) => {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } };
    try {
      await webpush.sendNotification(sub as any, message, { TTL: 60 });
      return { ok: true, id: s.id };
    } catch (e: any) {
      const status = e?.statusCode || e?.status || 0;
      // 404/410 → subscription is gone; remove it. Others → keep, log.
      if (status === 404 || status === 410) {
        await sb().from('push_subscriptions').delete().eq('id', s.id);
        return { ok: false, id: s.id, removed: true, status };
      }
      return { ok: false, id: s.id, status, error: e?.message || String(e) };
    }
  }));

  const summary = results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) });
  return NextResponse.json({ delivered: summary, count: summary.length });
}

export async function GET() {
  // Health check
  return NextResponse.json({
    ready: !!(VAPID_PUBLIC && VAPID_PRIVATE && WEBHOOK_SECRET && SUPABASE_SERVICE_ROLE_KEY),
  });
}
