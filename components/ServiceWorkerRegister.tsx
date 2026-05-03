'use client';
import { useEffect } from 'react';

// next-pwa@5.6 wires its auto-registration through `pages/_app.tsx`. In the
// App Router there's no _app.tsx, so the registration call never fires —
// that's why navigator.serviceWorker.getRegistrations() returns [] in
// production. We register it manually here on first mount.
//
// Errors are captured to a global window.__swRegError so the Push Settings
// diagnostics panel can surface them.

declare global {
  interface Window {
    __swRegError?: string | null;
    __swReg?: ServiceWorkerRegistration | null;
  }
}

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) {
      window.__swRegError = 'serviceWorker not supported';
      return;
    }
    // Don't try to register on localhost over HTTP (only over https or localhost itself).
    const insecure = location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    if (insecure) { window.__swRegError = 'insecure context'; return; }

    (async () => {
      try {
        console.log('[sw-register] navigator.serviceWorker.register("/sw.js") …');
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[sw-register] registered, scope:', reg.scope, 'state:',
          reg.installing ? 'installing' : reg.waiting ? 'waiting' : reg.active ? 'active' : 'unknown');
        window.__swReg = reg;
        window.__swRegError = null;
        // Surface installation lifecycle errors for the diagnostic panel.
        const onWorkerErr = (e: any) => {
          window.__swRegError = `worker error: ${e?.message || e?.type || 'unknown'}`;
          console.error('[sw-register] worker error', e);
        };
        if (reg.installing) reg.installing.addEventListener('error', onWorkerErr);
        if (reg.waiting)    reg.waiting.addEventListener('error', onWorkerErr);
        if (reg.active)     reg.active.addEventListener('error', onWorkerErr);
      } catch (e: any) {
        const msg = e?.message || e?.name || 'register() rejected';
        window.__swRegError = msg;
        console.error('[sw-register] register failed:', msg, e);
      }
    })();
  }, []);
  return null;
}
