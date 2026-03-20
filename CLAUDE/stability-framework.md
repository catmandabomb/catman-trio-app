# Stability Framework -- Catman Trio App

**Version**: v20.21+
**Date**: 2026-03-20
**Scope**: Comprehensive stability, resilience, monitoring, and self-healing strategy
**Architecture**: Vanilla JS PWA, Cloudflare Worker + D1 + R2, no npm/build tools

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Gap Analysis](#2-gap-analysis)
3. [Error Handling & Boundaries](#3-error-handling--boundaries)
4. [Data Integrity Framework](#4-data-integrity-framework)
5. [Service Worker Resilience](#5-service-worker-resilience)
6. [Network Resilience & Retry Logic](#6-network-resilience--retry-logic)
7. [Client-Side Error Reporting](#7-client-side-error-reporting)
8. [Performance Budget & Monitoring](#8-performance-budget--monitoring)
9. [Recovery Patterns & Self-Healing](#9-recovery-patterns--self-healing)
10. [Storage Safety & Quota Management](#10-storage-safety--quota-management)
11. [Cross-Tab & Concurrency Safety](#11-cross-tab--concurrency-safety)
12. [Device & Browser Resilience](#12-device--browser-resilience)
13. [Security Hardening Checklist](#13-security-hardening-checklist)
14. [Monitoring Stack (Zero Dependencies)](#14-monitoring-stack-zero-dependencies)
15. [Implementation Priority Matrix](#15-implementation-priority-matrix)

---

## 1. Current State Assessment

### What We Already Have (Strengths)

The app has a surprisingly robust stability foundation for a vanilla JS PWA:

**Data Persistence -- 4-Tier Cascade**
```
Write: IDB (primary) -> localStorage (mirror) -> SW Cache (tertiary) -> D1 (remote, async)
Read:  IDB (first)   -> localStorage (fallback) -> SW Cache (last resort) -> D1 (background sync)
```
This is industry-leading for a PWA. Most apps use 1-2 tiers. The 4-tier approach means data survives IDB corruption, localStorage clear, SW eviction, and network outage independently.

**Offline-First Architecture**
- All views render from local data before network sync
- `loadSongsInstant()` et al. return cached data in <50ms on cold start
- Sync failures toast a user-friendly message with "last synced" timestamp
- Save operations write locally first, then fire-and-forget to D1

**Error Boundaries**
- `safeRender()` wrapper catches view render crashes with fallback UI
- Worker top-level `try/catch` returns 500 JSON on uncaught errors
- `_workerFetch()` parses error JSON and creates typed errors (409 vs generic)
- `syncAll()` always clears syncing flag in `finally` block
- Email sends, R2 cleanup, and file fetch failures are all fire-and-forget with `.catch(() => {})`

**Conflict Resolution**
- Optimistic locking via `version` column on all mutable D1 tables
- 409 conflict flow: re-fetch server data, merge (server wins by version), retry once
- Parallel fetch for all 4 data types on sync (songs, setlists, practice, wikicharts)
- Fingerprint comparison (hash of length + IDs + timestamps) skips re-render when data unchanged

**Security**
- PBKDF2 100k iterations for password hashing
- Session token rotation after 24h idle (X-New-Token header)
- Dual rate limiting: KV (primary, fail-open) + D1 (secondary, atomic)
- Per-username login lockout (10 fails/hour)
- Anti-enumeration on login and forgot-password (same error for wrong user/password)
- CORS whitelist with explicit allowed origins
- Timing-safe PIN comparison (SHA-256 hash compare)

**Service Worker**
- Version-aware cache busting (CACHE_NAME matches APP_VERSION)
- Stale-while-revalidate for shell assets with version mismatch override
- Network-first for navigation (ensures fresh index.html)
- Storage quota check before PDF caching
- Audio proxy for iOS Safari blob URL bug
- Background Sync registration (Chrome-only, graceful fallback)
- Push notification handling with notification click -> focus existing window
- Share Target API support for receiving PDFs from other apps

**UI Resilience**
- `prefers-reduced-motion` respected in both CSS and JS
- `prefers-contrast: more` support
- Feature detection for View Transitions, Wake Lock, AudioWorklet, OffscreenCanvas, vibrate, clipboard, storage.persist
- iOS-specific fallbacks: webkitAudioContext, preservesPitch triple prefix, audio proxy, safe area insets
- Input font-size 16px prevents iOS zoom
- `touch-action: manipulation` eliminates 300ms tap delay

**Error Logging**
- `window.onerror` + `unhandledrejection` capture to `ct_error_log` in localStorage (capped at 50)
- Worker `error_log` D1 table with path, method, IP, stack trace
- Dashboard shows last 50 server errors + 24h error count
- Admin quotas endpoint shows D1/R2/KV usage

---

## 2. Gap Analysis

### Critical Gaps (HIGH -- fix now)

| # | Gap | Risk | Current State | Impact |
|---|-----|------|---------------|--------|
| G1 | **No client error reporting to server** | Errors in the wild are invisible | `ct_error_log` stays in localStorage, never sent anywhere | Bugs in production go undetected. Owner must ask user to check localStorage. |
| G2 | **No service worker health monitoring** | SW can silently break | No heartbeat, no version verification after update | App could serve stale assets indefinitely with no alert. |
| G3 | **No persistent storage request** | iOS Safari 7-day eviction | `navigator.storage.persist()` not called | Non-installed PWA users lose all cached data after 7 days of non-use. |
| G4 | **No cross-tab auth sync** | Stale auth in other tabs | No `storage` event listener for `ct_auth` | User logs out in one tab, other tab continues with stale token until next API call fails. |
| G5 | **No IDB corruption recovery** | Data loss on corruption | IDB errors only `console.warn` | If IDB corrupts (known browser bug), no fallback read from localStorage triggers. |
| G6 | **Practice POST missing auth guard** | Security hole | Worker `/data/practice` POST has no role check | Any authenticated user (including guest) can write practice data. |
| G7 | **Missing `resp.ok` guards in dashboard** | Confusing errors | `_loadSharedPackets()` and `_loadMigrationUI()` don't check `resp.ok` | Dashboard shows cryptic JSON parse errors instead of graceful fallback. |

### Important Gaps (MEDIUM -- fix soon)

| # | Gap | Risk | Current State | Impact |
|---|-----|------|---------------|--------|
| G8 | **No Web Vitals measurement** | Performance regressions go unnoticed | No LCP, FID, CLS tracking | Can't detect when a code change makes the app measurably slower. |
| G9 | **No sync health indicator** | Users don't know if data is stale | Toast on failure, but no persistent "last synced" badge | Users assume data is current when it might be hours stale. |
| G10 | **Dead settings never cleaned up** | User confusion | `ct_pref_date_format`, `ct_pref_notif_sync_conflict` saved but never read | Users change settings that have no effect. |
| G11 | **`ct_last_played` unbounded growth** | Slow localStorage bloat | Never pruned, never read | Accumulates entries for deleted songs/setlists indefinitely. |
| G12 | **No foldable viewport handling** | Broken layout on fold/unfold | No `visualViewport.resize` listener | PDF viewer and live mode could break when viewport changes from 370px to 712px. |
| G13 | **Low-memory device handling** | Tab crashes on low-end Android | No `navigator.deviceMemory` check, no memory-aware cache sizing | Blob cache (30 entries) + PDF rendering can exhaust RAM on 2-3GB devices. |
| G14 | **Firefox slider/scrollbar styling** | Inconsistent UI | Only `-webkit-` prefixed slider/scrollbar styles | Firefox users see default browser styling for volume, progress, and scrollbars. |

### Low Gaps (nice to have)

| # | Gap | Risk |
|---|-----|------|
| G15 | No `manifest.json` `id` field | PWA identity instability if start_url changes |
| G16 | Combined `any maskable` icon purpose | Maskable icons look wrong as regular icons |
| G17 | No macOS Safari install hint | Mac Safari 17+ users don't know about "Add to Dock" |
| G18 | No Content Security Policy | XSS could exfiltrate tokens (mitigated by server-side token management) |

---

## 3. Error Handling & Boundaries

### Current Error Boundary Map

```
Layer 1: Worker top-level try/catch
  -> Returns 500 JSON + logs to error_log D1 table

Layer 2: _workerFetch() / _api()
  -> Parses error JSON, creates typed Error (409 vs generic)
  -> Network failures caught in calling function

Layer 3: Save operations (saveSongs, etc.)
  -> Local save always runs first (never fails silently)
  -> D1 save is fire-and-forget with .catch()
  -> 409 triggers _handleConflict() -> re-fetch + merge + retry

Layer 4: View rendering
  -> safeRender() wraps all render functions
  -> On crash: console.error + toast + fallback "reload" UI

Layer 5: Global uncaught
  -> window.onerror + unhandledrejection -> ct_error_log
```

### Recommended Additions

**A. Structured Error Types**

Create a lightweight error classification in `js/utils.js`:

```javascript
// Error severity levels for client-side logging
const ErrorSeverity = { CRITICAL: 'critical', ERROR: 'error', WARN: 'warn', INFO: 'info' };

function logError(severity, category, message, context = {}) {
  const entry = {
    ts: Date.now(),
    sev: severity,
    cat: category,        // 'sync', 'render', 'auth', 'storage', 'network'
    msg: message,
    ctx: context,
    v: Store.get('APP_VERSION'),
    ua: navigator.userAgent.slice(0, 100),
  };
  // Append to localStorage error log (capped)
  const log = JSON.parse(localStorage.getItem('ct_error_log') || '[]');
  log.push(entry);
  if (log.length > 100) log.splice(0, log.length - 100);
  localStorage.setItem('ct_error_log', JSON.stringify(log));
  // Flush critical errors to server (see Section 7)
  if (severity === 'critical') _flushErrorToServer(entry);
}
```

**B. IDB Error Recovery Wrapper**

Wrap all IDB operations with a fallback chain:

```javascript
async function safeIDBRead(storeName) {
  try {
    return await IDB.load(storeName);
  } catch (err) {
    logError('error', 'storage', `IDB read failed for ${storeName}`, { error: err.message });
    // Fallback to localStorage
    const lsKey = `ct_${storeName}`;
    const raw = localStorage.getItem(lsKey);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) {}
    }
    // Fallback to SW cache
    return await _requestFromSW(`GET_CACHED_${storeName.toUpperCase()}`);
  }
}
```

**C. Render Crash Counter**

If `safeRender()` catches more than 3 consecutive errors for the same view, show a "Reset App Data" option instead of an infinite crash loop:

```javascript
const _renderCrashCount = {};
function safeRender(viewName, renderFn) {
  try {
    renderFn();
    _renderCrashCount[viewName] = 0; // Reset on success
  } catch (err) {
    _renderCrashCount[viewName] = (_renderCrashCount[viewName] || 0) + 1;
    if (_renderCrashCount[viewName] >= 3) {
      _showFatalRecoveryUI(viewName); // Offer data reset
    } else {
      showToast('Something went wrong. Try refreshing.');
    }
  }
}
```

---

## 4. Data Integrity Framework

### Current Protections

| Layer | Protection | Status |
|---|---|---|
| D1 writes | Optimistic locking (version column) | ACTIVE |
| D1 conflicts | 409 -> re-fetch, merge (server wins), retry once | ACTIVE |
| Local writes | IDB primary + localStorage mirror + SW cache tertiary | ACTIVE |
| Sync | Fingerprint comparison skips no-op re-renders | ACTIVE |
| Sync polling | 30s lightweight `/data/changes` check | ACTIVE |
| Sync cooldown | Max 2 manual syncs per 10s, auto-sync 10-min cooldown | ACTIVE |
| Auth | Token rotation after 24h idle via X-New-Token header | ACTIVE |

### Recommended Additions

**A. Data Integrity Checksums**

Add a lightweight checksum to detect localStorage corruption:

```javascript
function _saveLocalWithChecksum(key, data) {
  const json = JSON.stringify(data);
  const checksum = _simpleHash(json); // FNV-1a or similar fast hash
  localStorage.setItem(key, json);
  localStorage.setItem(key + '_cs', checksum);
}

function _loadLocalWithChecksum(key) {
  const json = localStorage.getItem(key);
  if (!json) return null;
  const stored = localStorage.getItem(key + '_cs');
  const actual = _simpleHash(json);
  if (stored && stored !== actual) {
    logError('critical', 'storage', `Checksum mismatch on ${key}`, { stored, actual });
    return null; // Force re-sync from D1
  }
  return JSON.parse(json);
}
```

**B. Write-Ahead Log for Offline Mutations**

When the app saves data while offline, the D1 write fails silently. There is no explicit queue of pending mutations. The data is correct in IDB, but if the app crashes before the next `syncAll()`, the mutation is lost from D1's perspective.

Recommended: Maintain a lightweight mutation log in IDB:

```javascript
// On every save operation
async function _logMutation(type, data) {
  const mutations = await IDB.loadMeta('pending_mutations') || [];
  mutations.push({ type, ids: data.map(d => d.id), ts: Date.now() });
  await IDB.saveMeta('pending_mutations', mutations);
}

// On successful D1 sync
async function _clearMutations(type) {
  const mutations = await IDB.loadMeta('pending_mutations') || [];
  const remaining = mutations.filter(m => m.type !== type);
  await IDB.saveMeta('pending_mutations', remaining);
}
```

**C. Sync Conflict Resolution Improvements**

The current conflict resolution uses "server wins by version number." This is correct for multi-user scenarios but could lose local changes in edge cases (user edits offline for hours, then syncs).

Recommended enhancement: When a conflict is detected, check if the local item was modified after the server version's `updated_at`. If yes, surface a "your changes were overwritten" toast with an undo option (store the pre-merge local copy temporarily).

**D. Schema Migration Safety**

`Sync.migrateSchema()` runs on every app load. If a migration corrupts data, all users are affected immediately. Add a "canary" pattern:

```javascript
async function migrateSchema() {
  const currentVersion = localStorage.getItem('ct_schema_songs') || '0';
  if (currentVersion >= DATA_SCHEMA_VERSION) return;
  // Take a snapshot before migration
  const snapshot = JSON.parse(localStorage.getItem('ct_songs') || '[]');
  localStorage.setItem('ct_songs_premigration', JSON.stringify(snapshot));
  try {
    _runMigration(currentVersion, DATA_SCHEMA_VERSION);
    localStorage.setItem('ct_schema_songs', String(DATA_SCHEMA_VERSION));
    // Verify post-migration data is valid
    const migrated = JSON.parse(localStorage.getItem('ct_songs') || '[]');
    if (!Array.isArray(migrated)) throw new Error('Migration produced non-array');
  } catch (err) {
    // Rollback
    localStorage.setItem('ct_songs', JSON.stringify(snapshot));
    logError('critical', 'sync', 'Schema migration failed, rolled back', { error: err.message });
  }
  localStorage.removeItem('ct_songs_premigration');
}
```

---

## 5. Service Worker Resilience

### Current SW Strategy

| Request Type | Strategy | Status |
|---|---|---|
| Navigation (HTML) | Network-first, cache fallback | GOOD |
| Shell assets (JS/CSS) | SWR with version mismatch override | GOOD |
| External APIs | Bypass SW entirely | GOOD |
| Audio proxy | In-memory blob map with 30-min TTL | GOOD |
| PDF cache | Dedicated cache with storage quota check | GOOD |

### Recommended Additions

**A. SW Health Check on App Init**

On every app load, verify the SW is alive and running the correct version:

```javascript
// In app.js init
async function _verifySWHealth() {
  if (!navigator.serviceWorker?.controller) {
    logError('warn', 'sw', 'No active service worker controller');
    return;
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      logError('error', 'sw', 'SW health check timeout (5s)');
      resolve(false);
    }, 5000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timeout);
      if (e.data?.version !== Store.get('APP_VERSION')) {
        logError('warn', 'sw', 'SW version mismatch', {
          sw: e.data?.version, app: Store.get('APP_VERSION')
        });
        // Force SW update
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      resolve(true);
    };
    navigator.serviceWorker.controller.postMessage(
      { type: 'HEALTH_CHECK' },
      [channel.port2]
    );
  });
}
```

Add corresponding handler in `service-worker.js`:

```javascript
if (e.data && e.data.type === 'HEALTH_CHECK') {
  if (e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: CACHE_NAME.replace('catmantrio-v', ''), ok: true });
  }
  return;
}
```

**B. SW Registration Recovery**

If the service worker fails to register or update, attempt re-registration:

```javascript
async function _registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          showToast('App updated. Refresh for latest version.');
        }
      });
    });
  } catch (err) {
    logError('critical', 'sw', 'SW registration failed', { error: err.message });
    // Retry once after 5 seconds
    setTimeout(async () => {
      try {
        await navigator.serviceWorker.register('/service-worker.js');
      } catch (retryErr) {
        logError('critical', 'sw', 'SW retry registration failed', { error: retryErr.message });
      }
    }, 5000);
  }
}
```

**C. Stale Cache Detection**

If shell assets in the cache are older than 7 days and the app has network, force a cache refresh:

```javascript
// In SW activate handler, tag cache creation time
// In fetch handler, check age of cached response
// If Response date header > 7 days old AND network available, prefer network
```

---

## 6. Network Resilience & Retry Logic

### Current Retry Map

| Operation | Auto-Retry | Strategy | On Failure |
|---|---|---|---|
| D1 data save (409) | Yes | Re-fetch, merge, retry once | Toast: "Sync conflict" |
| D1 data save (other) | No | Fire-and-forget | Console.warn, data safe locally |
| syncAll | No | Single attempt | Toast with cached data timestamp |
| _pollForChanges | No | Silent, retries on next 30s interval | console.debug only |
| Login/Register | No | Single attempt | Return error to form |
| File upload | No | Single attempt | Toast error |

### Recommended Additions

**A. Exponential Backoff for Network Failures**

```javascript
async function fetchWithRetry(url, options, { maxRetries = 3, baseDelay = 1000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status >= 500 && attempt < maxRetries) {
        await _sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      return resp;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      if (!navigator.onLine) throw err; // Don't retry if offline
      await _sleep(baseDelay * Math.pow(2, attempt));
    }
  }
}
```

**B. Online/Offline State Tracking**

```javascript
let _isOnline = navigator.onLine;
window.addEventListener('online', () => {
  _isOnline = true;
  showToast('Back online');
  Sync.syncAll(true); // Trigger immediate sync
});
window.addEventListener('offline', () => {
  _isOnline = false;
  showToast('Offline -- changes saved locally');
});
```

**C. Sync Failure Escalation**

Track consecutive sync failures. After 3 consecutive failures, show a persistent banner (not just a toast):

```javascript
let _syncFailCount = 0;
// In syncAll catch block:
_syncFailCount++;
if (_syncFailCount >= 3) {
  _showPersistentSyncWarning(); // Banner: "Data may be out of date. Last synced: X ago."
}
// In syncAll success:
_syncFailCount = 0;
_hidePersistentSyncWarning();
```

---

## 7. Client-Side Error Reporting

### Current State

- `window.onerror` and `unhandledrejection` capture to `ct_error_log` (localStorage, 50 entries)
- Worker `error_log` D1 table captures server-side errors
- Dashboard shows server errors but NOT client errors

### Recommended: Flush Critical Client Errors to Server

Add a lightweight client error flush endpoint:

**Worker endpoint:**
```
POST /client-errors   (any-auth)
Body: { errors: [{ ts, sev, cat, msg, ctx, v, ua }] }
```

Stores in the existing `error_log` table with `source = 'client'`.

**Client flush logic:**

```javascript
async function _flushErrorsToServer() {
  const log = JSON.parse(localStorage.getItem('ct_error_log') || '[]');
  const critical = log.filter(e => e.sev === 'critical' && !e.flushed);
  if (critical.length === 0) return;
  try {
    await _workerFetch('/client-errors', {
      method: 'POST',
      body: JSON.stringify({ errors: critical }),
    });
    // Mark as flushed
    for (const e of critical) e.flushed = true;
    localStorage.setItem('ct_error_log', JSON.stringify(log));
  } catch (_) {
    // Will retry on next app load
  }
}

// Call on app init and every 5 minutes
_flushErrorsToServer();
setInterval(_flushErrorsToServer, 5 * 60 * 1000);
```

### Error Dashboard Enhancement

Show client errors alongside server errors in the admin dashboard:

```sql
SELECT * FROM error_log WHERE source IN ('server', 'client') ORDER BY created_at DESC LIMIT 100
```

---

## 8. Performance Budget & Monitoring

### Recommended Performance Budget

| Metric | Target | Measurement | Priority |
|---|---|---|---|
| **First Contentful Paint (FCP)** | < 1.5s | `PerformanceObserver` | HIGH |
| **Largest Contentful Paint (LCP)** | < 2.5s | `PerformanceObserver` | HIGH |
| **Cumulative Layout Shift (CLS)** | < 0.1 | `PerformanceObserver` | MEDIUM |
| **Interaction to Next Paint (INP)** | < 200ms | `PerformanceObserver` | HIGH |
| **Time to Interactive** | < 3s | Custom (first render + data loaded) | HIGH |
| **Song list render (500 songs)** | < 100ms | `performance.now()` | MEDIUM |
| **PDF page turn** | < 200ms | Custom timing | HIGH |
| **Sync cycle (full)** | < 5s | Custom timing | MEDIUM |
| **App shell from SW cache** | < 500ms | Navigation timing | HIGH |
| **JS bundle total** | < 200KB (compressed) | Measured | LOW |

### Web Vitals Monitoring (No NPM)

Collect Core Web Vitals using the native `PerformanceObserver` API:

```javascript
// In app.js, after DOMContentLoaded
function _observeWebVitals() {
  // LCP
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    _recordMetric('lcp', last.startTime);
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  // FID / INP
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      _recordMetric('inp', entry.duration);
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });

  // CLS
  let clsValue = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) clsValue += entry.value;
    }
    _recordMetric('cls', clsValue);
  }).observe({ type: 'layout-shift', buffered: true });
}

function _recordMetric(name, value) {
  const metrics = JSON.parse(sessionStorage.getItem('ct_metrics') || '{}');
  metrics[name] = Math.round(value * 100) / 100;
  sessionStorage.setItem('ct_metrics', JSON.stringify(metrics));
}
```

### Custom Timing Points

Add `performance.mark()` at key moments:

```javascript
// App init
performance.mark('app-init-start');
// After IDB.init()
performance.mark('idb-ready');
// After loadSongsInstant()
performance.mark('data-loaded');
// After first view render
performance.mark('first-render');
// After syncAll completes
performance.mark('sync-complete');
```

Measure spans:

```javascript
performance.measure('cold-start', 'app-init-start', 'first-render');
performance.measure('data-load', 'app-init-start', 'data-loaded');
performance.measure('sync-time', 'data-loaded', 'sync-complete');
```

---

## 9. Recovery Patterns & Self-Healing

### Pattern A: Automatic Sync Recovery

If `syncAll()` fails 3 consecutive times, try progressively more aggressive recovery:

1. **Attempt 1-3**: Normal sync (current behavior)
2. **Attempt 4**: Clear sync poll baseline, force full re-sync
3. **Attempt 5**: Re-authenticate (call `Auth.refreshSession()`) then sync
4. **Attempt 6**: Clear IDB and re-sync from D1 (nuclear option, with user confirmation)

### Pattern B: IDB Self-Healing

IDB can corrupt silently. Add a periodic integrity check:

```javascript
async function _verifyIDBIntegrity() {
  try {
    const songs = await IDB.loadSongs();
    if (!Array.isArray(songs)) throw new Error('songs not array');
    // Spot-check: verify each item has an id
    if (songs.length > 0 && !songs[0].id) throw new Error('songs missing ids');
    return true;
  } catch (err) {
    logError('critical', 'storage', 'IDB integrity check failed', { error: err.message });
    // Attempt recovery: delete and recreate IDB
    try {
      await IDB.deleteDatabase();
      await IDB.init();
      // Repopulate from localStorage
      const lsSongs = JSON.parse(localStorage.getItem('ct_songs') || '[]');
      if (lsSongs.length > 0) await IDB.saveSongs(lsSongs);
      logError('info', 'storage', 'IDB recovered from localStorage');
    } catch (recoveryErr) {
      logError('critical', 'storage', 'IDB recovery failed', { error: recoveryErr.message });
    }
    return false;
  }
}
```

### Pattern C: Auth Token Recovery

If an API call returns 401 and the user had a valid session:

```javascript
async function _handleAuthFailure() {
  // Try refreshing the session
  const refreshed = await Auth.refreshSession();
  if (refreshed && Auth.isLoggedIn()) {
    return true; // Retry the original request
  }
  // Token truly expired -- prompt re-login
  _showReAuthModal();
  return false;
}
```

### Pattern D: Graceful Degradation Ladder

When features fail, degrade gracefully rather than breaking:

| Feature | Failure | Degradation |
|---|---|---|
| D1 sync | Network timeout | Use cached data, show "last synced" badge |
| PDF rendering | PDF.js crash | Show "Download PDF" link instead of inline viewer |
| AudioWorklet | Not supported / crash | Fall back to setInterval metronome (already implemented) |
| Wake Lock | Not supported | No-op (already implemented) |
| View Transitions | Not supported | Instant swap (already implemented) |
| Push notifications | Not supported | No-op (already implemented) |
| IDB | Corrupt / unavailable | localStorage fallback (needs improvement -- see G5) |
| localStorage | Full (quota exceeded) | Toast warning, continue with IDB only |
| Service Worker | Failed to register | App works without offline support |

### Pattern E: "Reset App" Emergency Escape Hatch

Add a hidden reset option in Settings (long-press on version number):

```javascript
function _resetApp() {
  if (!confirm('This will clear all local data and re-sync from the server. Continue?')) return;
  // Clear all local storage
  const auth = localStorage.getItem('ct_auth'); // Preserve auth
  localStorage.clear();
  if (auth) localStorage.setItem('ct_auth', auth);
  // Clear IDB
  IDB.deleteDatabase();
  // Clear SW caches
  caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  // Reload
  location.reload();
}
```

---

## 10. Storage Safety & Quota Management

### Current Storage Inventory

| Storage | Current Usage | Limit | Risk |
|---|---|---|---|
| localStorage | ~50-300KB (see settings audit) | ~5MB | LOW |
| IndexedDB | ~50KB metadata + audio cache | ~50% of disk | LOW |
| SW Cache (shell) | ~2MB | Shared with IDB | LOW |
| SW Cache (PDFs) | Variable (checked before writes) | Shared with IDB | MEDIUM |
| SW Cache (songs data) | ~50KB | Shared | LOW |

### Recommended Storage Management

**A. Request Persistent Storage on App Init**

```javascript
async function _requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const granted = await navigator.storage.persist();
    if (!granted) {
      logError('warn', 'storage', 'Persistent storage not granted');
    }
  }
}
```

Call during `DOMContentLoaded`. Chrome auto-grants for installed PWAs. Safari may not honor it, but the call is zero-cost.

**B. Storage Quota Dashboard**

Surface storage usage in Settings page:

```javascript
async function _getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return {
    used: est.usage,
    quota: est.quota,
    percent: Math.round((est.usage / est.quota) * 100),
  };
}
```

Show as a colored bar: green (<50%), yellow (50-80%), red (>80%).

**C. PDF Cache Eviction Strategy**

Currently checks quota before each PDF write. Add an LRU eviction layer:

```javascript
// Maintain access timestamps in IDB meta store
async function _recordPDFAccess(cacheKey) {
  const accessed = await IDB.loadMeta('pdf_access') || {};
  accessed[cacheKey] = Date.now();
  await IDB.saveMeta('pdf_access', accessed);
}

async function _evictOldestPDFs(targetFreeBytes) {
  const accessed = await IDB.loadMeta('pdf_access') || {};
  const cache = await caches.open(PDF_CACHE);
  const keys = await cache.keys();
  // Sort by last access (oldest first)
  const sorted = keys.sort((a, b) => (accessed[a.url] || 0) - (accessed[b.url] || 0));
  let freed = 0;
  for (const req of sorted) {
    if (freed >= targetFreeBytes) break;
    const resp = await cache.match(req);
    if (resp) {
      const blob = await resp.blob();
      freed += blob.size;
      await cache.delete(req);
    }
  }
}
```

**D. Memory-Aware Blob Cache**

Reduce cache sizes on low-memory devices:

```javascript
const BLOB_CACHE_MAX = (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 10 : 30;
const PDF_RENDER_DPR = (navigator.deviceMemory && navigator.deviceMemory <= 4)
  ? Math.min(window.devicePixelRatio, 1.5)
  : window.devicePixelRatio;
```

---

## 11. Cross-Tab & Concurrency Safety

### Current State

- No `storage` event listener (tabs operate independently)
- No Web Locks usage (multiple tabs can sync simultaneously)
- BroadcastChannel created in `github.js` (legacy, for cross-tab sync coordination)

### Recommended: Web Locks for Sync Coordination

The Web Locks API (Baseline since March 2022) prevents two tabs from syncing simultaneously:

```javascript
async function syncAll(force = false) {
  if (!navigator.locks) {
    return _syncAllInner(force); // Fallback: no lock
  }
  return navigator.locks.request('catman-sync', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      console.debug('Another tab is syncing, skipping');
      return;
    }
    return _syncAllInner(force);
  });
}
```

### Recommended: Auth Sync Across Tabs

```javascript
window.addEventListener('storage', (e) => {
  if (e.key === 'ct_auth') {
    if (!e.newValue) {
      // Another tab logged out -- reload to show login
      location.reload();
    } else {
      // Another tab logged in or token rotated -- update in-memory state
      Auth._restore();
      _updateAuthUI();
    }
  }
});
```

---

## 12. Device & Browser Resilience

### Current Compatibility Score (from device audit)

| Platform | Score | Key Gap |
|---|---|---|
| iOS Safari | 9/10 | Volume slider (read-only on iOS) |
| Chrome Android | 9/10 | -- |
| Samsung Internet | 7/10 | Untested, Smart Anti-Tracking risk |
| Desktop Chrome/Edge | 9/10 | -- |
| Desktop Firefox | 7/10 | Unstyled scrollbars/sliders |
| Desktop Safari | 8/10 | No "Add to Dock" install hint |
| Firefox Android | 6/10 | No install hint + install gate = poor onboarding |
| Foldables | 5/10 | No viewport change handling |
| Low-end Android | 6/10 | Memory pressure from blob cache |

### Quick Fixes

**Firefox scrollbar (10 min):**
```css
html {
  scrollbar-width: thin;
  scrollbar-color: var(--border-light) transparent;
}
```

**Firefox slider styling (30 min):**
Add `::-moz-range-thumb` and `::-moz-range-track` alongside existing `-webkit-` selectors for volume and progress sliders.

**Foldable viewport (1 hour):**
```javascript
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', _debounce(() => {
    // Re-render PDF if in viewer
    // Recalculate carousel if in live mode
    if (Store.get('liveModeActive')) setlists._recalculateCarousel();
  }, 300));
}
```

**iOS volume slider (30 min):**
Detect iOS and hide or replace the master volume slider with a "Volume: Use device buttons" label.

---

## 13. Security Hardening Checklist

### Already Implemented

- [x] PBKDF2 100k iterations for password hashing
- [x] Session token rotation (24h idle)
- [x] Dual rate limiting (KV + D1)
- [x] Per-username login lockout
- [x] Anti-enumeration (login, forgot-password)
- [x] CORS whitelist
- [x] Timing-safe PIN comparison (SHA-256)
- [x] Role-based access control (owner/admin/conductr/member/guest)
- [x] Server-side permission enforcement on all write endpoints
- [x] Input validation (username length, password complexity, email format)
- [x] Error log sanitization (no PII in stack traces)

### Still TODO

- [ ] **Practice POST auth guard** (G6 -- 5 lines in Worker)
- [ ] **Content Security Policy** meta tag in index.html
- [ ] **Subresource Integrity** (SRI) on vendored scripts (pdf.js, Sortable.js, Lucide)
- [ ] **`Referrer-Policy: strict-origin-when-cross-origin`** header from Worker
- [ ] **Clear `ct_pref_*` on logout** to prevent data leakage between users on shared devices
- [ ] **Audit `ct_error_log` for PII** before flushing to server (strip tokens, passwords)

### CSP Recommendation

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self';
    script-src 'self';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com;
    connect-src 'self' https://catman-api.catmandabomb.workers.dev;
    img-src 'self' blob: data:;
    media-src 'self' blob: https://catman-api.catmandabomb.workers.dev;
    worker-src 'self';">
```

---

## 14. Monitoring Stack (Zero Dependencies)

### Recommended 4-Layer Stack

| Layer | Tool/Method | Cost | Coverage |
|---|---|---|---|
| 1. Uptime | UptimeRobot (free) or Better Stack (free tier) | $0 | Pings `/health` every 5 min, emails on downtime |
| 2. Server errors | D1 `error_log` table + Cron Trigger (15 min) | $0 | Emails owner via Resend when error count > 10 in 15 min |
| 3. Client errors | `ct_error_log` -> POST `/client-errors` -> D1 | $0 | Critical client errors visible in admin dashboard |
| 4. Performance | Web Vitals via PerformanceObserver -> sessionStorage -> periodic flush to D1 | $0 | LCP, INP, CLS tracked per session |

### Cron Trigger Error Alert (Already Documented)

In `wrangler.toml`:
```toml
[triggers]
crons = ["*/15 * * * *"]
```

In Worker `scheduled` handler: query `error_log` for last 15 min, email if count > threshold.

### Admin Dashboard Enhancements

Add to the existing Dashboard:

1. **Client Error Panel**: Last 20 client errors with severity, category, message, user agent
2. **Performance Panel**: Average LCP, INP, CLS across recent sessions
3. **Storage Panel**: D1 row counts, R2 object count, push subscription count
4. **Uptime Badge**: Link to UptimeRobot status page

---

## 15. Implementation Priority Matrix

### Phase 1: Critical (Next Push -- v20.22)

| # | Item | Gap | Effort | Impact |
|---|------|-----|--------|--------|
| 1 | Request persistent storage | G3 | 5 lines | Prevents iOS data eviction |
| 2 | Practice POST auth guard | G6 | 5 lines | Closes security hole |
| 3 | Add `resp.ok` guards in dashboard | G7 | 10 lines | Prevents confusing errors |
| 4 | Online/offline status listener | New | 15 lines | User knows if data will sync |
| 5 | Cross-tab auth sync | G4 | 10 lines | Consistent auth state |
| 6 | Firefox scrollbar styling | G14 | 5 lines CSS | Visual consistency |
| 7 | Manifest `id` field | G15 | 1 line | PWA identity stability |

**Total Phase 1 effort: ~1 hour**

### Phase 2: Important (v20.23)

| # | Item | Gap | Effort | Impact |
|---|------|-----|--------|--------|
| 8 | Client error flush to server | G1 | 50 lines + 20 line endpoint | Visibility into production errors |
| 9 | SW health check on app init | G2 | 30 lines | Detects stale SW |
| 10 | IDB corruption recovery | G5 | 40 lines | Self-healing data layer |
| 11 | Web Locks for sync coordination | G11 | 20 lines | Prevents multi-tab sync races |
| 12 | Web Vitals measurement | G8 | 40 lines | Performance regression detection |
| 13 | Sync failure escalation (persistent banner) | G9 | 30 lines | Users know when data is stale |
| 14 | CSP meta tag | G18 | 5 lines | XSS protection |
| 15 | Memory-aware blob cache | G13 | 10 lines | Prevents low-end device crashes |

**Total Phase 2 effort: ~4 hours**

### Phase 3: Hardening (v20.24+)

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 16 | Data integrity checksums | 40 lines | Detects localStorage corruption |
| 17 | Write-ahead log for offline mutations | 50 lines | Prevents mutation loss on crash |
| 18 | PDF cache LRU eviction | 60 lines | Better storage management |
| 19 | Render crash counter + recovery UI | 30 lines | Prevents infinite crash loops |
| 20 | Cron Trigger error alerting | 30 lines Worker | Proactive error notification |
| 21 | "Reset App" emergency escape | 20 lines | User self-service recovery |
| 22 | Foldable viewport handling | 30 lines | Samsung Fold/Flip support |
| 23 | Structured error types | 30 lines | Better error categorization |
| 24 | Schema migration safety (snapshot + rollback) | 40 lines | Prevents migration data loss |
| 25 | UptimeRobot setup | 10 min (no code) | External uptime monitoring |

**Total Phase 3 effort: ~6 hours**

---

## Appendix A: Files Most Relevant to Stability

| File | Stability Role |
|---|---|
| `service-worker.js` | Caching, offline, audio proxy, push, background sync |
| `js/sync.js` | Data persistence, conflict resolution, polling, D1 communication |
| `js/store.js` | Centralized state, constants, version |
| `idb.js` | IndexedDB wrapper, offline primary storage |
| `auth.js` | Token management, session refresh, role checks |
| `js/utils.js` | safeRender, showToast, error utilities |
| `js/router.js` | View transitions, cleanup hooks, navigation stack |
| `cloudflare-worker/src/index.js` | All API routes, auth, rate limiting |
| `cloudflare-worker/src/rate-limit.js` | Dual KV+D1 rate limiting |
| `cloudflare-worker/src/users.js` | Password hashing, session management |

## Appendix B: Known Open Security Items

From `CLAUDE/qa-audit-v20.05.md`, `CLAUDE/qa-audit-v20.06.md`, and `CLAUDE/3-20-at-320.md`:

1. Practice POST missing auth guard (Worker) -- **CRITICAL**
2. KV write estimation cross-day contamination (Worker `/admin/quotas`) -- LOW
3. `ct_use_cloudflare` localStorage pollution -- LOW
4. `_findR2FileId` O(n*m) performance -- LOW
5. Stale `ADMIN_HASH` comment in wrangler.toml -- COSMETIC
6. Dead migration key `bb_pw_hash -> ct_pw_hash` in migrate.js -- COSMETIC

## Appendix C: Test Scenarios for Stability

Key stability scenarios from `research/ARCHITECTURE AND SHORTHANDS/test-scenarios.md`:

- **I1-I3**: Offline load, offline edits, data load fallback chain
- **J1**: Rapid navigation (no render crashes, no orphaned buttons)
- **J2**: Concurrent tabs (sync conflicts resolved)
- **J3**: Role change mid-session (server enforces, client refreshes)
- **J4**: Delete while viewing (graceful redirect)
- **J5**: Large datasets (500+ songs, search <100ms)
- **J6**: Session expiry (transparent token rotation)
- **K1**: Full gig night walkthrough (the critical path)
- **L3**: Service worker update (new version installs, old cache cleaned)
- **M1-M3**: Auth boundary, input validation, PIN security

---

*This document should be updated whenever stability-relevant changes are made to the codebase. Use it as the reference for QA audits, barrel runs, and architecture decisions.*
