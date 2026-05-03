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
// fires and the spinner stops. This is the fix for navigator.serviceWorker.ready
// hanging silently when the SW failed to register.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

type Diag = {
  hasNotification: boolean;
  permission: string;
  hasServiceWorker: boolean;
  swRegistered: boolean;
  swRegCount: number;
  swScope: string | null;
  swRegError: string | null;
  swState: string;
  controllerPresent: 'yes' | 'no';
  controllerScriptURL: string;
  activeScriptURL: string;
  activeState: string;
  vapidLen: number;
  standalone: boolean;
  ua: string;
  swJsStatus: string;
  pushSwJsStatus: string;
  hasExistingSubscription: 'true' | 'false' | 'unknown';
};

export default function PushSettings() {
  const [standalone, setStandalone] = useState(false);
  const [iOS, setIos] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<string>('default');
  const [prefs, setPrefs] = useState<db.NotifPrefRow | null>(null);
  const [busy, setBusy] = useState<'master' | string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  async function refreshDiag() {
    const d: Diag = {
      hasNotification: typeof window !== 'undefined' && 'Notification' in window,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      swRegistered: false,
      swRegCount: 0,
      swScope: null,
      swRegError: typeof window !== 'undefined' ? (window as any).__swRegError ?? null : null,
      swState: 'none',
      controllerPresent: 'no',
      controllerScriptURL: '—',
      activeScriptURL: '—',
      activeState: '—',
      vapidLen: VAPID_PUBLIC.length,
      standalone: detectStandalone(),
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      swJsStatus: 'pending',
      pushSwJsStatus: 'pending',
      hasExistingSubscription: 'unknown',
    };
    if (d.hasServiceWorker) {
      try {
        try {
          const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          d.swRegError = null;
          d.swRegistered = true;
          d.swScope = reg.scope;
        } catch (e: any) {
          d.swRegError = e?.message || e?.name || String(e);
        }
        const regs = await navigator.serviceWorker.getRegistrations();
        d.swRegCount = regs.length;
        if (regs.length > 0) {
          d.swRegistered = true;
          const reg = await navigator.serviceWorker.getRegistration() || regs.find(r => r.active) || regs[0];
          d.swScope = reg?.scope || d.swScope || null;
          d.swState = reg?.installing ? 'installing'
                    : reg?.waiting ? 'waiting'
                    : reg?.active ? 'active'
                    : 'none';
          d.activeScriptURL = reg?.active?.scriptURL || '—';
          d.activeState = reg?.active?.state || '—';
          if (reg) {
            try {
              const sub = await reg.pushManager.getSubscription();
              d.hasExistingSubscription = sub ? 'true' : 'false';
            } catch { d.hasExistingSubscription = 'unknown'; }
          }
        }
        d.controllerPresent = navigator.serviceWorker.controller ? 'yes' : 'no';
        d.controllerScriptURL = navigator.serviceWorker.controller?.scriptURL || '—';
      } catch (e: any) { d.swRegError = e?.message || String(e); }
    }
    // Probe the SW asset URLs without redirects so we know if middleware is intercepting.
    try {
      const r = await fetch('/sw.js', { redirect: 'manual', cache: 'no-store' });
      d.swJsStatus = `${r.status}${r.type === 'opaqueredirect' ? ' (opaqueredirect)' : ''}`;
    } catch (e: any) { d.swJsStatus = `error: ${e?.message || 'fetch failed'}`; }
    try {
      const r = await fetch('/push-sw.js', { redirect: 'manual', cache: 'no-store' });
      d.pushSwJsStatus = `${r.status}${r.type === 'opaqueredirect' ? ' (opaqueredirect)' : ''}`;
    } catch (e: any) { d.pushSwJsStatus = `error: ${e?.message || 'fetch failed'}`; }
    setDiag(d);
  }

  useEffect(() => {
    setStandalone(detectStandalone());
    setIos(isIOS());
    setSupported(typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window);
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
    db.getMyNotifPrefs().then(setPrefs).catch(() => setPrefs(null));
    refreshDiag();
  }, []);

  async function subscribeAndEnable() {
    setBusy('master'); setErr(null);
    try {
      // ---- Step 1: permission ----
      console.log('[push] Step 1: requestPermission');
      if (typeof Notification === 'undefined') throw new Error('Notification API not available in this browser.');
      const perm = await Notification.requestPermission();
      console.log('[push] Step 1 result:', perm);
      setPermission(perm);
      if (perm !== 'granted') throw new Error(`Permission ${perm}. Open iOS Settings → Notifications → Carp Log → Allow.`);

      // ---- Step 2: service worker ----
      console.log('[push] Step 2: serviceWorker.ready (10s timeout)');
      if (!('serviceWorker' in navigator)) throw new Error('Service workers not supported in this browser.');
      // Hard timeout — without this, .ready hangs forever if SW failed to register
      // (which is the actual silent-hang bug in the previous version).
      const reg = await withTimeout(navigator.serviceWorker.ready, 10000, 'serviceWorker.ready');
      console.log('[push] Step 2 done, scope:', reg.scope);

      // ---- Step 3: VAPID key + subscribe ----
      console.log('[push] Step 3: pushManager.subscribe');
      const vapidKey = VAPID_PUBLIC;
      if (!vapidKey) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY undefined at runtime — env var missing on this deploy.');
      console.log('[push] VAPID key length:', vapidKey.length);

      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        console.log('[push] Step 3 reusing existing subscription, endpoint:', sub.endpoint.slice(0, 50));
      } else {
        sub = await withTimeout(reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
        }), 15000, 'pushManager.subscribe');
        console.log('[push] Step 3 done, endpoint:', sub.endpoint.slice(0, 50));
      }

      // ---- Step 4: persist ----
      console.log('[push] Step 4: POST /api/push/subscribe');
      const res = await withTimeout(fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      }), 10000, 'POST /api/push/subscribe');
      console.log('[push] Step 4 result:', res.status);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(`Subscribe API returned ${res.status}${j?.error ? `: ${j.error}` : ''}`);
      }

      // ---- Step 5: master toggle ----
      console.log('[push] Step 5: setPushMaster(true)');
      await db.setPushMaster(true);
      setPrefs(p => p ? { ...p, push_master: true } : p);
      console.log('[push] All done');
      refreshDiag();
    } catch (e: any) {
      console.error('[push] FAILED:', e?.message, e);
      setErr(e?.message || 'Failed to enable push');
    } finally {
      // CRITICAL: spinner stops even on exception or timeout.
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
      refreshDiag();
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
        <Diagnostics diag={diag} expanded={showDiag} onToggle={() => setShowDiag(v => !v)} />
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
        <Diagnostics diag={diag} expanded={showDiag} onToggle={() => setShowDiag(v => !v)} />
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

      <Diagnostics diag={diag} expanded={showDiag} onToggle={() => { setShowDiag(v => !v); refreshDiag(); }} />
    </div>
  );
}

function Diagnostics({ diag, expanded, onToggle }: { diag: Diag | null; expanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(234,201,136,0.12)' }}>
      <button onClick={onToggle} className="tap" style={{
        width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontFamily: 'inherit',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        <ChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
        Diagnostic info
      </button>
      {expanded && diag && (
        <pre style={{
          marginTop: 8, padding: 10, borderRadius: 10,
          background: 'rgba(10,24,22,0.6)', border: '1px solid rgba(234,201,136,0.12)',
          color: 'var(--text-2)', fontSize: 10.5, lineHeight: 1.6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace', margin: '8px 0 0',
        }}>
{`typeof window.Notification : ${diag.hasNotification ? 'function' : 'undefined'}
Notification.permission     : ${diag.permission}
typeof navigator.serviceWorker : ${diag.hasServiceWorker ? 'object' : 'undefined'}
ServiceWorker registered    : ${diag.swRegistered}
ServiceWorker regs count    : ${diag.swRegCount}
SW scope                    : ${diag.swScope || '—'}
SW state                    : ${diag.swState}
SW registration error       : ${diag.swRegError || '(none)'}
Active SW scriptURL         : ${diag.activeScriptURL}
Active SW state             : ${diag.activeState}
SW controller present       : ${diag.controllerPresent}
SW controller scriptURL     : ${diag.controllerScriptURL}
SW file fetch /sw.js        : ${diag.swJsStatus}
SW file fetch /push-sw.js   : ${diag.pushSwJsStatus}
Push subscription exists    : ${diag.hasExistingSubscription}
VAPID public key length     : ${diag.vapidLen} ${diag.vapidLen === 0 ? '⚠ MISSING' : ''}
Standalone (PWA)            : ${diag.standalone}
User-Agent                  : ${diag.ua.slice(0, 110)}`}
        </pre>
      )}
    </div>
  );
}
