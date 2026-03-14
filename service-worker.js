/**
 * service-worker.js
 *
 * Caches the app shell for offline access.
 * Drive files are NOT cached (they're large and user-managed).
 */

const CACHE_NAME = 'catmantrio-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/drive.js',
  '/pdf-viewer.js',
  '/player.js',
  '/admin.js',
  '/lucide.min.js',
  '/manifest.json',
];

// Install: cache shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: shell-first, network fallback
self.addEventListener('fetch', (e) => {
  // Don't intercept Google API calls
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com') ||
      e.request.url.includes('accounts.google.com') ||
      e.request.url.includes('cdnjs.cloudflare.com')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(resp => {
        // Cache successful GET responses for shell assets
        if (e.request.method === 'GET' && resp.status === 200) {
          const url = new URL(e.request.url);
          if (SHELL_ASSETS.some(a => url.pathname.endsWith(a) || url.pathname === a)) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
        }
        return resp;
      });
    }).catch(() => {
      // Offline fallback for navigation
      if (e.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
