/**
 * service-worker.js
 *
 * Caches the app shell for offline access.
 * Also caches the songs JSON for fast load + offline resilience.
 * Drive media files are NOT cached (they're large and user-managed).
 */

const CACHE_NAME = 'catmantrio-v18.2';
const SONGS_CACHE = 'catmantrio-songs';
const PDF_CACHE = 'catmantrio-pdfs';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/idb.js',
  '/app.js',
  '/drive.js',
  '/github.js',
  '/pdf-viewer.js',
  '/player.js',
  '/metronome.js',
  '/admin.js',
  '/lucide.min.js',
  '/workers/levenshtein-worker.js',
  '/workers/metronome-processor.js',
  '/workers/pdf-render-worker.js',
  '/manifest.json',
  '/img/icon-192.png',
  '/img/icon-512.png',
];

// Install: cache shell + skipWaiting so new SW activates immediately
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches (keep SONGS_CACHE and PDF_CACHE)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== SONGS_CACHE && k !== PDF_CACHE)
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

  // ─── PDF Cache handlers ─────────────────────────────────

  if (e.data && e.data.type === 'CACHE_PDF') {
    const { driveId, blob } = e.data;
    if (!driveId || !blob) return;
    // Check storage before caching
    (async () => {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          const remaining = est.quota - est.usage;
          if (remaining < blob.size * 2) {
            console.warn('SW: low storage, skipping PDF cache for', driveId);
            return;
          }
        }
        const resp = new Response(blob, {
          headers: { 'Content-Type': 'application/pdf' },
        });
        const cache = await caches.open(PDF_CACHE);
        await cache.put(`pdf-${driveId}`, resp);
      } catch (err) {
        console.warn('SW: cache PDF error', err);
      }
    })();
  }

  if (e.data && e.data.type === 'GET_CACHED_PDF') {
    const { driveId } = e.data;
    (async () => {
      try {
        const cache = await caches.open(PDF_CACHE);
        const resp = await cache.match(`pdf-${driveId}`);
        if (resp) {
          const blob = await resp.blob();
          if (e.source) e.source.postMessage({ type: 'CACHED_PDF', driveId, blob });
        } else {
          if (e.source) e.source.postMessage({ type: 'CACHED_PDF', driveId, blob: null });
        }
      } catch (err) {
        console.warn('SW: get cached PDF error', err);
        if (e.source) e.source.postMessage({ type: 'CACHED_PDF', driveId, blob: null });
      }
    })();
  }

  if (e.data && e.data.type === 'GET_CACHED_PDF_LIST') {
    (async () => {
      try {
        const cache = await caches.open(PDF_CACHE);
        const keys = await cache.keys();
        const driveIds = keys.map(req => {
          // Keys are stored as "pdf-{driveId}"
          const url = req.url || req;
          const match = String(url).match(/pdf-(.+)$/);
          return match ? match[1] : null;
        }).filter(Boolean);
        if (e.source) e.source.postMessage({ type: 'CACHED_PDF_LIST', driveIds });
      } catch (err) {
        console.warn('SW: get cached PDF list error', err);
        if (e.source) e.source.postMessage({ type: 'CACHED_PDF_LIST', driveIds: [] });
      }
    })();
  }

  if (e.data && e.data.type === 'CLEAR_PDF_CACHE') {
    caches.delete(PDF_CACHE)
      .then(() => { if (e.source) e.source.postMessage({ type: 'PDF_CACHE_CLEARED' }); })
      .catch(err => console.warn('SW: clear PDF cache error', err));
  }

  if (e.data && e.data.type === 'GET_PDF_CACHE_SIZE') {
    (async () => {
      try {
        const cache = await caches.open(PDF_CACHE);
        const keys = await cache.keys();
        let totalSize = 0;
        for (const req of keys) {
          const resp = await cache.match(req);
          if (resp) {
            const blob = await resp.blob();
            totalSize += blob.size;
          }
        }
        if (e.source) e.source.postMessage({ type: 'PDF_CACHE_SIZE', size: totalSize });
      } catch (err) {
        console.warn('SW: get PDF cache size error', err);
        if (e.source) e.source.postMessage({ type: 'PDF_CACHE_SIZE', size: 0 });
      }
    })();
  }
});

// Fetch strategy:
// - Navigation (HTML): network-first so new versions arrive immediately
// - Shell assets (JS/CSS): cache-first with ignoreSearch for offline resilience
// - External APIs: bypass SW entirely
self.addEventListener('fetch', (e) => {
  // Don't intercept external API calls
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com') ||
      e.request.url.includes('accounts.google.com') ||
      e.request.url.includes('cdnjs.cloudflare.com') ||
      e.request.url.includes('cdn.jsdelivr.net') ||
      e.request.url.includes('api.github.com')) {
    return;
  }

  // Navigation requests (HTML pages): network-first
  // This ensures users always get fresh index.html with latest cache-busting params
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Shell assets: cache-first (ignoreSearch so ?v= params match pre-cached files)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      return cached || fetch(e.request).then(resp => {
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
      // Offline fallback for any missed navigation
      if (e.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});
