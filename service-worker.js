/**
 * service-worker.js
 *
 * Caches the app shell for offline access.
 * Also caches the songs JSON for fast load + offline resilience.
 * Drive media files are NOT cached (they're large and user-managed).
 */

const CACHE_NAME = 'catmantrio-v17.68';
const SONGS_CACHE = 'catmantrio-songs';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/drive.js',
  '/github.js',
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
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (e.data && e.data.type === 'CACHE_SONGS') {
    const resp = new Response(JSON.stringify(e.data.songs), {
      headers: { 'Content-Type': 'application/json' },
    });
    caches.open(SONGS_CACHE).then(cache => {
      cache.put('songs-data', resp);
    }).catch(err => console.warn('SW: cache songs error', err));
  }

  if (e.data && e.data.type === 'GET_CACHED_SONGS') {
    caches.open(SONGS_CACHE).then(cache =>
      cache.match('songs-data')
    ).then(resp => {
      if (resp) return resp.json();
      return null;
    }).then(songs => {
      if (e.source) e.source.postMessage({ type: 'CACHED_SONGS', songs });
    }).catch(err => console.warn('SW: get cached songs error', err));
  }

  if (e.data && e.data.type === 'CACHE_SETLISTS') {
    const resp = new Response(JSON.stringify(e.data.setlists), {
      headers: { 'Content-Type': 'application/json' },
    });
    caches.open(SONGS_CACHE).then(cache => {
      cache.put('setlists-data', resp);
    }).catch(err => console.warn('SW: cache setlists error', err));
  }

  if (e.data && e.data.type === 'GET_CACHED_SETLISTS') {
    caches.open(SONGS_CACHE).then(cache =>
      cache.match('setlists-data')
    ).then(resp => {
      if (resp) return resp.json();
      return null;
    }).then(setlists => {
      if (e.source) e.source.postMessage({ type: 'CACHED_SETLISTS', setlists });
    }).catch(err => console.warn('SW: get cached setlists error', err));
  }

  if (e.data && e.data.type === 'CACHE_PRACTICE') {
    const resp = new Response(JSON.stringify(e.data.practice), {
      headers: { 'Content-Type': 'application/json' },
    });
    caches.open(SONGS_CACHE).then(cache => {
      cache.put('practice-data', resp);
    }).catch(err => console.warn('SW: cache practice error', err));
  }

  if (e.data && e.data.type === 'GET_CACHED_PRACTICE') {
    caches.open(SONGS_CACHE).then(cache =>
      cache.match('practice-data')
    ).then(resp => {
      if (resp) return resp.json();
      return null;
    }).then(practice => {
      if (e.source) e.source.postMessage({ type: 'CACHED_PRACTICE', practice });
    }).catch(err => console.warn('SW: get cached practice error', err));
  }
});

// Fetch: shell-first, network fallback
self.addEventListener('fetch', (e) => {
  // Don't intercept Google API calls
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com') ||
      e.request.url.includes('accounts.google.com') ||
      e.request.url.includes('cdnjs.cloudflare.com') ||
      e.request.url.includes('cdn.jsdelivr.net') ||
      e.request.url.includes('api.github.com')) {
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
