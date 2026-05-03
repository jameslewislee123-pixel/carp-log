// Push notification handler — imported into the next-pwa generated service
// worker via `importScripts` (see next.config.mjs).
//
// We intentionally don't use any caching API or workbox features here —
// next-pwa already handles those.
//
// Belt-and-braces: take over the page on activate so a freshly-installed SW
// immediately controls open clients instead of sitting in "waiting" state.
// next-pwa's clientsClaim:true also does this; doing it again here is
// idempotent and protects us if next-pwa config drifts.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

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
