// cloud-claude service worker — Sprint 0.
// Minimal offline shell cache. Kept intentionally simple; refine when screens exist.
const CACHE = 'cc-shell-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache API/dynamic calls (healthz now; ingest/rollup/pty later).
  if (url.pathname.startsWith('/healthz') || url.pathname.startsWith('/api') || url.pathname === '/pty') return;
  // Cache-first for the static shell, network fallback.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
