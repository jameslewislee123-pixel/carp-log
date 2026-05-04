'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, Bell, BellOff, ChevronRight, Loader2, Smartphone, X } from 'lucide-react';
import * as db from '@/lib/db';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

const TYPES: { key: string; label: string; help: string }[] = [
  { key: 'trip_new_catch',    label: 'Trip catches',          help: 'When someone in your trip banks a fish' },
  { key: 'trip_new_member',   label: 'Trip joins',            help: 'When someone joins a trip you own' },
  { key: 'trip_invite',       label: 'Trip invites',          help: 'When you\'re invited to a trip' },
  { key: 'trip_chat_mention', label: 'Chat mentions',         help: 'When someone @-mentions you in trip chat' },
  { key: 'trip_chat',         label: 'Chat messages',         help: 'Every chat message in your trips (noisy)' },
  { key: 'friend_request',    label: 'Friend requests',       help: 'When someone wants to be your friend' },
  { key: 'friend_accepted',   label: 'Friend accepted',       help: 'When someone accepts your request' },
  { key: 'comment_on_catch',  label: 'Comments on your catches', help: 'When someone comments on a fish you banked' },
  { key: 'catch_liked',       label: 'Likes on your catches',    help: 'When someone likes a fish you banked' },
];

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
function isIOS() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

// Race a promise against a timeout. Throws on timeout so the caller's catch
// fires and the spinner stops. This guards against navigator.serviceWorker.ready
// hanging silently when the SW failed to register.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

export default function PushSettings() {
  const [standalone, setStandalone] = useState(false);
  const [iOS, setIos] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<string>('default');
  const [prefs, setPrefs] = useState<db.NotifPrefRow | null>(null);
  const [busy, setBusy] = useState<'master' | string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setStandalone(detectStandalone());
    setIos(isIOS());
    setSupported(typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window);
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
    db.getMyNotifPrefs().then(setPrefs).catch(() => setPrefs(null));
  }, []);

  async function subscribeAndEnable() {
    setBusy('master'); setErr(null);
    try {
      if (typeof Notification === 'undefined') throw new Error('Notification API not available in this browser.');
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') throw new Error(`Permission ${perm}. Open iOS Settings → Notifications → Carp Log → Allow.`);

      if (!('serviceWorker' in navigator)) throw new Error('Service workers not supported in this browser.');
      const reg = await withTimeout(navigator.serviceWorker.ready, 10000, 'serviceWorker.ready');

      const vapidKey = VAPID_PUBLIC;
      if (!vapidKey) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY undefined at runtime — env var missing on this deploy.');

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await withTimeout(reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
        }), 15000, 'pushManager.subscribe');
      }

      const res = await withTimeout(fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      }), 10000, 'POST /api/push/subscribe');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(`Subscribe API returned ${res.status}${j?.error ? `: ${j.error}` : ''}`);
      }

      await db.setPushMaster(true);
      setPrefs(p => p ? { ...p, push_master: true } : p);
    } catch (e: any) {
      setErr(e?.message || 'Failed to enable push');
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy('master'); setErr(null);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await withTimeout(navigator.serviceWorker.ready, 5000, 'serviceWorker.ready (disable)');
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
          await sub.unsubscribe();
        }
      }
      await db.setPushMaster(false);
      setPrefs(p => p ? { ...p, push_master: false } : p);
    } catch (e: any) {
      setErr(e?.message || 'Failed to disable push');
    } finally { setBusy(null); }
  }

  async function toggleType(key: string) {
    if (!prefs) return;
    setBusy(key);
    try {
      const next = !prefs.enabled[key];
      await db.setPushTypePref(key, next);
      setPrefs({ ...prefs, enabled: { ...prefs.enabled, [key]: next } });
    } catch (e: any) {
      setErr(e?.message || 'Failed to update preference');
    } finally { setBusy(null); }
  }

  // ---------------------------------------- UI

  if (!supported) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
          This browser doesn't support push notifications.
        </p>
      </div>
    );
  }

  if (iOS && !standalone) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Smartphone size={18} style={{ color: 'var(--gold-2)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Add to Home Screen first</div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
              iOS only delivers push notifications to PWAs launched from the home screen. Tap the Share icon → Add to Home Screen, then re-open Carp Log from the icon.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 12, background: prefs?.push_master ? 'rgba(141,191,157,0.15)' : 'rgba(10,24,22,0.5)', border: `1px solid ${prefs?.push_master ? 'var(--sage)' : 'rgba(234,201,136,0.18)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {prefs?.push_master ? <Bell size={16} style={{ color: 'var(--sage)' }} /> : <BellOff size={16} style={{ color: 'var(--text-3)' }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Push notifications</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {permission === 'denied' ? 'Permission blocked — change in your device Settings'
              : prefs?.push_master ? 'On — pushes will arrive even when the app is closed' : 'Off'}
          </div>
        </div>
        <button
          onClick={prefs?.push_master ? disable : subscribeAndEnable}
          disabled={busy === 'master' || permission === 'denied'}
          className="tap" style={{
            padding: '8px 14px', borderRadius: 999,
            background: prefs?.push_master ? 'transparent' : 'var(--gold)',
            border: prefs?.push_master ? '1px solid rgba(234,201,136,0.18)' : 'none',
            color: prefs?.push_master ? 'var(--text-3)' : '#1A1004',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          {busy === 'master' ? <Loader2 size={12} className="spin" /> : null}
          {prefs?.push_master ? 'Disable' : 'Enable'}
        </button>
      </div>

      {err && (
        <div role="alert" style={{
          marginBottom: 12, padding: 12, borderRadius: 12, fontSize: 12, lineHeight: 1.5,
          background: 'rgba(220,107,88,0.14)', border: '1px solid rgba(220,107,88,0.45)', color: 'var(--danger)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{err}</div>
          <button onClick={() => setErr(null)} aria-label="Dismiss"
            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {prefs?.push_master && (
        <CollapsiblePrefs
          prefs={prefs}
          types={TYPES}
          busyKey={typeof busy === 'string' && busy !== 'master' ? busy : null}
          onToggle={toggleType}
        />
      )}
    </div>
  );
}

function CollapsiblePrefs({ prefs, types, busyKey, onToggle }: {
  prefs: db.NotifPrefRow;
  types: { key: string; label: string; help: string }[];
  busyKey: string | null;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const enabledCount = types.filter(t => prefs.enabled[t.key]).length;
  return (
    <div style={{ paddingTop: 8, borderTop: '1px solid rgba(234,201,136,0.12)' }}>
      <button onClick={() => setOpen(o => !o)} className="tap" style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px',
        background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        color: 'var(--text)', textAlign: 'left',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Notification preferences</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{enabledCount} of {types.length} enabled</div>
        </div>
        <ChevronRight size={14} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      <div style={{
        overflow: 'hidden',
        maxHeight: open ? 1000 : 0,
        transition: 'max-height 0.3s var(--spring)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
          {types.map(t => {
            const on = !!prefs.enabled[t.key];
            return (
              <button key={t.key} onClick={() => onToggle(t.key)} disabled={busyKey === t.key}
                className="tap" style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                  background: 'transparent', border: 'none', borderBottom: '1px solid rgba(234,201,136,0.06)',
                  color: 'var(--text)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.help}</div>
                </div>
                <span style={{
                  width: 38, height: 22, borderRadius: 999, position: 'relative',
                  background: on ? 'var(--gold)' : 'rgba(20,42,38,0.7)',
                  border: `1px solid ${on ? 'var(--gold)' : 'rgba(234,201,136,0.18)'}`,
                  transition: 'background 0.18s',
                }}>
                  <span style={{
                    position: 'absolute', top: 1, left: on ? 17 : 1,
                    width: 18, height: 18, borderRadius: 999, background: '#FFF',
                    transition: 'left 0.18s var(--spring)',
                  }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
