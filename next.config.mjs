import withPWAInit from 'next-pwa';

const isDev = process.env.NODE_ENV === 'development';

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  clientsClaim: true, // critical — new SW takes control of open clients on activate
  disable: isDev,
  // Adds our push/notificationclick handlers to the generated sw.js.
  // Bump the cache-buster query when push-sw.js changes so workbox sees a
  // byte-different sw.js and triggers a fresh install.
  importScripts: ['/push-sw.js?v=2'],
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/[^/]+\.supabase\.co\/realtime\/.*$/i,
      handler: 'NetworkOnly',
    },
    {
      urlPattern: /^https:\/\/[^/]+\.supabase\.co\/.*$/i,
      handler: 'NetworkFirst',
      options: { cacheName: 'supabase', networkTimeoutSeconds: 5 },
    },
    {
      urlPattern: /^\/api\/.*$/i,
      handler: 'NetworkFirst',
      options: { cacheName: 'api', networkTimeoutSeconds: 5 },
    },
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*$/i,
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'google-fonts' },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'images' },
    },
    {
      urlPattern: /\.(?:js|css|woff2?)$/i,
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'static' },
    },
    {
      urlPattern: /^\/$/,
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'shell' },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
};

export default withPWA(nextConfig);
