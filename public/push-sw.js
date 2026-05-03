// Push notification handler — imported into the next-pwa generated service
// worker via `importScripts` (see next.config.mjs).

// Lifecycle timing — visible in `chrome://inspect` / Safari Web Inspector
// SW console. If install ever hangs again, the missing log line tells us
// exactly which step never completed.
console.log('[push-sw] script evaluated', new Date().toISOString());

self.addEventListener('install', (event) => {
  console.log('[push-sw] install event start', new Date().toISOString());
  self.skipWaiting();
  // Don't add anything to event.waitUntil here — next-pwa's workbox install
  // step is already in-flight, and we want install to settle as fast as
  // possible. skipWaiting() is fire-and-forget.
  console.log('[push-sw] install event done (skipWaiting called)');
});

self.addEventListener('activate', (event) => {
  console.log('[push-sw] activate event', new Date().toISOString());
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'Carp Log', body: event.data.text() }; }

  const title = payload.title || 'Carp Log';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || undefined,
    data: payload.data || {},
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Focus an existing tab if one is already open for this app.
      for (const w of wins) {
        if ('focus' in w) {
          try {
            const wUrl = new URL(w.url);
            const target = new URL(url, wUrl.origin);
            if (wUrl.origin === target.origin) {
              w.focus();
              if ('navigate' in w) { return w.navigate(target.href); }
              return;
            }
          } catch {}
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
