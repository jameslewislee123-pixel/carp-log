import withPWAInit from 'next-pwa';

const isDev = process.env.NODE_ENV === 'development';

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  disable: isDev,
  // Disable precaching entirely. The default precache list includes
  // /_next/app-build-manifest.json which 404s in App Router builds; workbox's
  // install handler then retries it forever and the SW never reaches "active".
  // We don't need precache for offline-first — runtimeCaching covers live use,
  // and full offline support isn't a product requirement right now.
  buildExcludes: [/.*/],
  importScripts: ['/push-sw.js?v=3'],
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
  // TEMP: disable minification + enable source maps so unminified stack
  // traces appear in the browser console. REVERT after debugging.
  swcMinify: false,
  productionBrowserSourceMaps: true,
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
};

export default withPWA(nextConfig);
