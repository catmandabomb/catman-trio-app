/**
 * service-worker.test.js — Tests for service-worker.js (cache versioning, URL routing)
 */

const { describe, it, assert } = require('./test-runner');

// ─── Replicate service worker logic for testing ──────────────

const CACHE_NAME = 'catmantrio-v20.29';
const SONGS_CACHE = 'catmantrio-songs';
const PDF_CACHE = 'catmantrio-pdfs';

const SHELL_ASSETS = [
  '/', '/index.html', '/app.css', '/idb.js', '/js/store.js', '/js/utils.js',
  '/js/modal.js', '/js/router.js', '/js/sync.js', '/js/dashboard.js',
  '/js/practice.js', '/js/setlists.js', '/js/migrate.js', '/js/songs.js',
  '/js/wikicharts.js', '/app.js', '/drive.js', '/github.js',
  '/pdf-viewer.js', '/player.js', '/metronome.js', '/auth.js', '/admin.js',
  '/js/orchestra.js', '/js/instruments.js', '/js/messages.js',
  '/js/annotations.js', '/js/opfs.js',
  '/lucide.min.js', '/workers/levenshtein-worker.js',
  '/workers/metronome-processor.js', '/workers/pdf-render-worker.js',
  '/workers/crypto-worker.js', '/workers/audio-converter.js',
  '/lib/pdf.min.js', '/lib/pdf.worker.min.js',
  '/lib/Sortable.min.js', '/manifest.json', '/img/icon-192.png', '/img/icon-512.png',
];

function shouldBypassSW(url) {
  return url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('accounts.google.com') ||
    url.includes('api.github.com') ||
    url.includes('catman-api.catmandabomb.workers.dev');
}

function isAudioProxy(url) {
  return url.includes('/audio-proxy/');
}

function extractAudioProxyId(url) {
  const match = url.match(/audio-proxy\/(.+)$/);
  return match ? match[1] : null;
}

function isShareTarget(method, url) {
  return method === 'POST' && url.includes('/share-target');
}

function getSWVersion() {
  return CACHE_NAME.replace('catmantrio-v', '');
}

function hasVersionMismatch(requestUrl, swVersion) {
  try {
    const url = new URL(requestUrl);
    const reqVersion = url.searchParams.get('v');
    return reqVersion && reqVersion !== swVersion;
  } catch (_) { return false; }
}

function shouldDeleteOldCache(cacheName) {
  return cacheName !== CACHE_NAME && cacheName !== SONGS_CACHE && cacheName !== PDF_CACHE;
}

const AUDIO_PROXY_TTL_MS = 30 * 60 * 1000;

function isAudioProxyExpired(entry) {
  return entry.expires < Date.now();
}

// ─── Tests ───────────────────────────────────────────────────

describe('Service Worker — cache naming', () => {
  it('CACHE_NAME contains version', () => {
    assert.match(CACHE_NAME, /catmantrio-v\d+\.\d+/);
  });

  it('version can be extracted from CACHE_NAME', () => {
    const ver = getSWVersion();
    assert.match(ver, /^\d+\.\d+$/);
  });

  it('SONGS_CACHE is a stable name', () => {
    assert.equal(SONGS_CACHE, 'catmantrio-songs');
  });

  it('PDF_CACHE is a stable name', () => {
    assert.equal(PDF_CACHE, 'catmantrio-pdfs');
  });
});

describe('Service Worker — shell assets', () => {
  it('includes index.html', () => {
    assert.includes(SHELL_ASSETS, '/index.html');
  });

  it('includes app.css', () => {
    assert.includes(SHELL_ASSETS, '/app.css');
  });

  it('includes app.js', () => {
    assert.includes(SHELL_ASSETS, '/app.js');
  });

  it('includes all JS modules', () => {
    const jsModules = ['/js/store.js', '/js/utils.js', '/js/modal.js', '/js/router.js',
      '/js/sync.js', '/js/songs.js', '/js/setlists.js', '/js/practice.js', '/js/wikicharts.js',
      '/js/orchestra.js', '/js/instruments.js', '/js/messages.js', '/js/annotations.js', '/js/opfs.js'];
    jsModules.forEach(mod => assert.includes(SHELL_ASSETS, mod, `Missing: ${mod}`));
  });

  it('includes auth.js', () => {
    assert.includes(SHELL_ASSETS, '/auth.js');
  });

  it('includes PDF.js library', () => {
    assert.includes(SHELL_ASSETS, '/lib/pdf.min.js');
    assert.includes(SHELL_ASSETS, '/lib/pdf.worker.min.js');
  });

  it('includes manifest.json', () => {
    assert.includes(SHELL_ASSETS, '/manifest.json');
  });

  it('includes icons', () => {
    assert.includes(SHELL_ASSETS, '/img/icon-192.png');
    assert.includes(SHELL_ASSETS, '/img/icon-512.png');
  });

  it('root / is included', () => {
    assert.includes(SHELL_ASSETS, '/');
  });
});

describe('Service Worker — URL bypass rules', () => {
  it('bypasses googleapis.com', () => {
    assert.ok(shouldBypassSW('https://www.googleapis.com/something'));
  });

  it('bypasses gstatic.com', () => {
    assert.ok(shouldBypassSW('https://fonts.gstatic.com/s/inter'));
  });

  it('bypasses accounts.google.com', () => {
    assert.ok(shouldBypassSW('https://accounts.google.com/oauth'));
  });

  it('bypasses api.github.com', () => {
    assert.ok(shouldBypassSW('https://api.github.com/repos'));
  });

  it('bypasses catman-api worker', () => {
    assert.ok(shouldBypassSW('https://catman-api.catmandabomb.workers.dev/data/songs'));
  });

  it('does not bypass local assets', () => {
    assert.notOk(shouldBypassSW('https://localhost/app.js'));
    assert.notOk(shouldBypassSW('/index.html'));
    assert.notOk(shouldBypassSW('/js/store.js'));
  });
});

describe('Service Worker — audio proxy routing', () => {
  it('detects audio proxy URLs', () => {
    assert.ok(isAudioProxy('/audio-proxy/audio-proxy-1-123456'));
  });

  it('does not match non-proxy URLs', () => {
    assert.notOk(isAudioProxy('/js/store.js'));
    assert.notOk(isAudioProxy('/index.html'));
  });

  it('extracts proxy ID from URL', () => {
    assert.equal(extractAudioProxyId('/audio-proxy/audio-proxy-1-123456'), 'audio-proxy-1-123456');
  });

  it('returns null for non-proxy URL', () => {
    assert.isNull(extractAudioProxyId('/index.html'));
  });
});

describe('Service Worker — share target detection', () => {
  it('detects POST share target', () => {
    assert.ok(isShareTarget('POST', '/share-target'));
  });

  it('does not detect GET share target', () => {
    assert.notOk(isShareTarget('GET', '/share-target'));
  });

  it('does not detect non-share POST', () => {
    assert.notOk(isShareTarget('POST', '/data/songs'));
  });
});

describe('Service Worker — version mismatch detection', () => {
  const swVersion = getSWVersion();

  it('detects mismatch when versions differ', () => {
    assert.ok(hasVersionMismatch('https://localhost/app.js?v=19.99', swVersion));
  });

  it('no mismatch when versions match', () => {
    assert.notOk(hasVersionMismatch(`https://localhost/app.js?v=${swVersion}`, swVersion));
  });

  it('no mismatch when no version param', () => {
    assert.notOk(hasVersionMismatch('https://localhost/app.js', swVersion));
  });

  it('no mismatch for URLs without query string', () => {
    assert.notOk(hasVersionMismatch('https://localhost/app.css', swVersion));
  });
});

describe('Service Worker — old cache deletion', () => {
  it('deletes old versioned caches', () => {
    assert.ok(shouldDeleteOldCache('catmantrio-v19.00'));
    assert.ok(shouldDeleteOldCache('catmantrio-v20.00'));
  });

  it('keeps current cache', () => {
    assert.notOk(shouldDeleteOldCache(CACHE_NAME));
  });

  it('keeps SONGS_CACHE', () => {
    assert.notOk(shouldDeleteOldCache(SONGS_CACHE));
  });

  it('keeps PDF_CACHE', () => {
    assert.notOk(shouldDeleteOldCache(PDF_CACHE));
  });

  it('deletes unrelated caches', () => {
    assert.ok(shouldDeleteOldCache('some-other-cache'));
    assert.ok(shouldDeleteOldCache('catmantrio-shared'));
  });
});

describe('Service Worker — audio proxy TTL', () => {
  it('unexpired entry is not expired', () => {
    const entry = { blob: {}, expires: Date.now() + AUDIO_PROXY_TTL_MS };
    assert.notOk(isAudioProxyExpired(entry));
  });

  it('expired entry is detected', () => {
    const entry = { blob: {}, expires: Date.now() - 1000 };
    assert.ok(isAudioProxyExpired(entry));
  });

  it('TTL is 30 minutes', () => {
    assert.equal(AUDIO_PROXY_TTL_MS, 30 * 60 * 1000);
  });
});

module.exports = {};
