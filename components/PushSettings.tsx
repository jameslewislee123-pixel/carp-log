'use client';
import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Smartphone } from 'lucide-react';
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

export default function PushSettings() {
  const [standalone, setStandalone] = useState(false);
  const [iOS, setIos] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
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
      if (!VAPID_PUBLIC) throw new Error('VAPID public key not configured on this deploy.');
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setErr('Permission was not granted.'); setBusy(null); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC).buffer as ArrayBuffer,
        });
      }
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `subscribe ${r.status}`);
      }
      await db.setPushMaster(true);
      setPrefs(p => p ? { ...p, push_master: true } : p);
    } catch (e: any) {
      setErr(e?.message || 'Failed to enable push');
    } finally { setBusy(null); }
  }

  async function disable() {
    setBusy('master'); setErr(null);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
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
        <div role="alert" style={{ marginBottom: 12, padding: 10, borderRadius: 10, fontSize: 12, background: 'rgba(220,107,88,0.14)', border: '1px solid rgba(220,107,88,0.4)', color: 'var(--danger)' }}>
          {err}
        </div>
      )}

      {prefs?.push_master && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid rgba(234,201,136,0.12)' }}>
          {TYPES.map(t => {
            const on = !!prefs.enabled[t.key];
            return (
              <button key={t.key} onClick={() => toggleType(t.key)} disabled={busy === t.key}
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
      )}
    </div>
  );
}
