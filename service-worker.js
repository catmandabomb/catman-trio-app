/**
 * service-worker.js
 *
 * Caches the app shell for offline access.
 * Also caches the songs JSON for fast load + offline resilience.
 * Drive media files are NOT cached (they're large and user-managed).
 */

const CACHE_NAME = 'catmantrio-v9';
const SONGS_CACHE = 'catmantrio-songs';

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

// Activate: remove old caches (keep SONGS_CACHE)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== SONGS_CACHE)
        .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Listen for messages from the app to cache/retrieve songs
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'CACHE_SONGS') {
    const resp = new Response(JSON.stringify(e.data.songs), {
      headers: { 'Content-Type': 'application/json' },
    });
    caches.open(SONGS_CACHE).then(cache => {
      cache.put('songs-data', resp);
    });
  }

  if (e.data && e.data.type === 'GET_CACHED_SONGS') {
    caches.open(SONGS_CACHE).then(cache =>
      cache.match('songs-data')
    ).then(resp => {
      if (resp) return resp.json();
      return null;
    }).then(songs => {
      e.source.postMessage({ type: 'CACHED_SONGS', songs });
    });
  }

  if (e.data && e.data.type === 'CACHE_SETLISTS') {
    const resp = new Response(JSON.stringify(e.data.setlists), {
      headers: { 'Content-Type': 'application/json' },
    });
    caches.open(SONGS_CACHE).then(cache => {
      cache.put('setlists-data', resp);
    });
  }

  if (e.data && e.data.type === 'GET_CACHED_SETLISTS') {
    caches.open(SONGS_CACHE).then(cache =>
      cache.match('setlists-data')
    ).then(resp => {
      if (resp) return resp.json();
      return null;
    }).then(setlists => {
      e.source.postMessage({ type: 'CACHED_SETLISTS', setlists });
    });
  }
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
