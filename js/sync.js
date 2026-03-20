/**
 * sync.js — Data load/save/sync layer
 *
 * Handles localStorage, IndexedDB, OPFS (write buffer), SW cache, and remote sync
 * (Cloudflare D1 primary, GitHub/Drive legacy fallback).
 * State lives in Store; re-renders via Router.
 *
 * @module sync
 */

import * as Store from './store.js?v=20.32';
import { showToast, isMobile, timeAgo, isHybridKey } from './utils.js?v=20.32';
import * as GitHub from '../github.js?v=20.32';
import * as Drive from '../drive.js?v=20.32';
import * as Router from './router.js?v=20.32';
import * as IDB from '../idb.js?v=20.32';
import * as OPFS from './opfs.js?v=20.32';
import * as Auth from '../auth.js?v=20.32';
import * as Admin from '../admin.js?v=20.32';
import * as MutationQueue from './mutation-queue.js?v=20.32';

// ─── Compression Streams (progressive enhancement) ──────────
// Gzip-compress JSON for localStorage to avoid ~5MB limit on large datasets.
// Falls back to raw JSON when CompressionStream is unavailable or on error.

const _compressionAvailable = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/**
 * Gzip-compress a JSON string and return a 'gz:'-prefixed base64 string.
 * Uses chunked btoa for strings > 1MB to avoid call stack overflow.
 * @param {string} str - Raw JSON string
 * @returns {Promise<string>} 'gz:' + base64-encoded gzip data
 */
async function _compress(str) {
  const blob = new Blob([str]);
  const cs = new CompressionStream('gzip');
  const stream = blob.stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked btoa to avoid "Maximum call stack size exceeded" on large arrays
  let binary = '';
  const CHUNK = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return 'gz:' + btoa(binary);
}

/**
 * Decompress a 'gz:'-prefixed base64 string back to the original JSON string.
 * @param {string} encoded - 'gz:' + base64 gzip data
 * @returns {Promise<string>} Original JSON string
 */
async function _decompress(encoded) {
  const b64 = encoded.slice(3); // remove 'gz:' prefix
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).text();
}

/**
 * Save a JSON string to localStorage, compressing if available.
 * @param {string} key - localStorage key
 * @param {string} jsonStr - JSON string to store
 */
async function _setCompressed(key, jsonStr) {
  if (_compressionAvailable) {
    try {
      const compressed = await _compress(jsonStr);
      localStorage.setItem(key, compressed);
      return;
    } catch (e) {
      console.warn('Compression failed, falling back to raw JSON', e);
    }
  }
  localStorage.setItem(key, jsonStr);
}

/**
 * Read from localStorage, decompressing if the value has a 'gz:' prefix.
 * @param {string} key - localStorage key
 * @returns {Promise<string|null>} Raw JSON string, or null if key doesn't exist
 */
async function _getDecompressed(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  if (raw.startsWith('gz:')) {
    try {
      return await _decompress(raw);
    } catch (e) {
      console.warn('Decompression failed, treating as raw JSON', e);
      return raw; // let the caller's JSON.parse handle it (will likely fail gracefully)
    }
  }
  return raw;
}

/**
 * Synchronous read from localStorage with gz: detection.
 * Used by _load*Local which are synchronous — returns raw JSON or null.
 * If compressed data is found, returns null so the caller falls through
 * to IDB or SW cache (which have the uncompressed data).
 * We also schedule a background decompression to re-populate.
 * @param {string} key - localStorage key
 * @returns {string|null} JSON string or null if compressed/missing
 */
function _getLocalSync(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  if (raw.startsWith('gz:')) {
    // Can't decompress synchronously — return null so caller falls through to IDB/SW cache
    return null;
  }
  return raw;
}

// ─── OPFS write buffer (fire-and-forget) ────────────────────
// Writes to OPFS are crash-resilient but not awaited in the save path
// to avoid blocking the UI. OPFS serves as a recovery source only.

function _opfsWrite(filename, data) {
  try {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    OPFS.writeData(filename, json).catch(() => {}); // fire-and-forget
  } catch { /* skip */ }
}

// ─── Storage backend toggle ─────────────────────────────────
// Use Cloudflare D1/R2 when the Worker is configured and the user hasn't
// explicitly opted out. The 'ct_use_cloudflare' flag can force '0' to
// revert to GitHub/Drive (legacy), but defaults to Cloudflare when Worker exists.

/**
 * Check if the app should use Cloudflare D1/R2 for data storage.
 * @returns {boolean}
 */
function useCloudflare() {
  const flag = localStorage.getItem('ct_use_cloudflare');
  if (flag === '0') return false;   // explicitly opted out
  if (flag === '1') return true;    // explicitly opted in
  return !!GitHub.workerUrl;        // default: use Cloudflare when Worker is configured
}

/**
 * Authenticated fetch to the Cloudflare Worker API.
 * @param {string} path - API path (e.g. '/data/songs')
 * @param {RequestInit} [options]
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} On non-OK response (409 errors include .status and .conflicts)
 */
// Brave Shields / aggressive content blockers: show a helpful toast once per session
let _braveShieldsToastShown = false;

async function _workerFetch(path, options = {}) {
  const token = Auth.getToken ? Auth.getToken() : null;
  if (!token) throw new Error('Not authenticated');
  let resp;
  try {
    resp = await fetch(GitHub.workerUrl + path, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    // TypeError from fetch() means the request was blocked (Brave Shields, ad blocker, CORS)
    if (err instanceof TypeError && !_braveShieldsToastShown) {
      _braveShieldsToastShown = true;
      showToast('Network request blocked — if using Brave, try disabling Shields for this site.', 8000);
    }
    throw err;
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 409) {
      const err = new Error('Version conflict');
      err.status = 409;
      err.conflicts = data.conflicts || [];
      throw err;
    }
    throw new Error(data.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

async function _loadFromD1() {
  const [songsRes, setlistsRes, practiceRes, wikiChartsRes] = await Promise.all([
    _workerFetch('/data/songs'),
    _workerFetch('/data/setlists'),
    _workerFetch('/data/practice'),
    _workerFetch('/data/wikicharts').catch(() => ({ wikiCharts: [] })),
  ]);
  return {
    songs: songsRes.songs || [],
    setlists: setlistsRes.setlists || [],
    practice: practiceRes.practice || [],
    wikiCharts: wikiChartsRes.wikiCharts || [],
  };
}

/**
 * Save data to D1 via the Worker API.
 * @param {'songs'|'setlists'|'practice'} type
 * @param {Array} data - Items to upsert (includes version for optimistic locking)
 * @param {string[]} [deletions] - IDs to delete
 * @returns {Promise<Object>}
 */
async function _saveToD1(type, data, deletions) {
  // Map type to API path (lowercase) and body key (camelCase for wikicharts)
  const pathMap = { wikicharts: 'wikicharts' };
  const keyMap = { wikicharts: 'wikiCharts' };
  const apiPath = pathMap[type] || type;
  const bodyKey = keyMap[type] || type;
  const body = { [bodyKey]: data };
  if (deletions && deletions.length > 0) body.deletions = deletions;
  return _workerFetch(`/data/${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Handle a 409 version conflict: re-fetch server data, merge with local,
 * update Store + local storage, then retry the save once.
 */
async function _handleConflict(type, localData, saveFn) {
  console.warn(`Version conflict on ${type} — re-fetching and merging`);
  try {
    const pathMap = { wikicharts: 'wikicharts' };
    const keyMap = { wikicharts: 'wikiCharts' };
    const apiPath = pathMap[type] || type;
    const bodyKey = keyMap[type] || type;
    const remote = await _workerFetch(`/data/${apiPath}`);
    const remoteItems = remote[bodyKey] || [];
    // Build lookup of remote items by ID
    const remoteMap = {};
    remoteItems.forEach(item => { remoteMap[item.id] = item; });
    // Merge: remote wins for version-tracked fields, keep local-only items
    const merged = [];
    const seen = new Set();
    for (const local of localData) {
      seen.add(local.id);
      const server = remoteMap[local.id];
      if (server && (server.version || 1) > (local.version || 1)) {
        // Server is newer — use server version
        merged.push(server);
      } else {
        // Local is same or newer (shouldn't happen but safe fallback) — use local with server version
        merged.push(server ? { ...local, version: server.version } : local);
      }
    }
    // Add remote-only items we don't have locally
    for (const item of remoteItems) {
      if (!seen.has(item.id)) merged.push(item);
    }
    // Retry save with updated versions FIRST — only update local if D1 succeeds
    await _saveToD1(type, merged);
    // D1 succeeded — now update store + local
    const storeKey = type === 'practice' ? 'practice' : type;
    Store.set(storeKey, merged);
    saveFn(merged);
    showToast('Sync conflict resolved.');
  } catch (retryErr) {
    console.error('Conflict resolution failed', retryErr);
    showToast('Sync conflict — please refresh.');
  }
}

// ─── Schema migration ──────────────────────────────────────

function migrateSchema(data, type) {
  const schemaVer = Store.get('DATA_SCHEMA_VERSION');
  const ver = parseInt(localStorage.getItem(`ct_schema_${type}`) || '0', 10);
  if (ver >= schemaVer) return data;
  try { localStorage.setItem(`ct_schema_${type}`, String(schemaVer)); } catch (_) {}
  return data;
}

// ─── Songs: local storage helpers ──────────────────────────

function _loadLocal() {
  try {
    const raw = _getLocalSync('ct_songs');
    return migrateSchema(JSON.parse(raw || '[]'), 'songs');
  } catch { return []; }
}

async function _saveLocal(songs) {
  // OPFS write-ahead (fire-and-forget, crash-resilient)
  _opfsWrite('songs.json', songs);
  // IDB first (primary), localStorage as fallback mirror
  if (IDB.isAvailable()) {
    try { await IDB.saveSongs(songs); }
    catch (e) { console.warn('IDB save songs failed', e); }
  }
  try {
    const jsonStr = JSON.stringify(songs);
    await _setCompressed('ct_songs', jsonStr);
  } catch (e) { console.warn('localStorage save failed (songs)', e); showToast('Storage full — data may not persist.'); }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_SONGS', songs });
  }
}

function _loadFromSWCache() {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return resolve(null);
    const handler = (e) => {
      if (e.data && e.data.type === 'CACHED_SONGS') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(e.data.songs);
      }
    };
    const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', handler); resolve(null); }, 500);
    navigator.serviceWorker.addEventListener('message', handler);
    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_SONGS' });
  });
}

async function loadSongsInstant() {
  if (IDB.isAvailable()) {
    try {
      const idbSongs = await IDB.loadSongs();
      if (idbSongs && idbSongs.length > 0) {
        Store.set('songs', migrateSchema(idbSongs, 'songs'));
        return;
      }
    } catch (e) { console.warn('IDB load songs failed', e); }
  }
  const local = _loadLocal();
  if (local.length > 0) {
    Store.set('songs', local);
    if (IDB.isAvailable()) {
      IDB.saveSongs(local).catch(() => {});
    }
    return;
  }
  const swSongs = await _loadFromSWCache();
  if (swSongs && swSongs.length > 0) {
    Store.set('songs', swSongs);
    _saveLocal(swSongs);
    return;
  }
  // OPFS recovery — last resort
  const opfsSongs = await OPFS.readData('songs.json');
  if (opfsSongs) {
    try {
      const parsed = JSON.parse(opfsSongs);
      if (parsed.length > 0) {
        Store.set('songs', migrateSchema(parsed, 'songs'));
        _saveLocal(parsed); // re-populate IDB + localStorage
      }
    } catch { /* corrupt OPFS data — skip */ }
  }
}

// ─── Setlists: local storage helpers ───────────────────────

function _loadSetlistsLocal() {
  try {
    const raw = _getLocalSync('ct_setlists');
    return migrateSchema(JSON.parse(raw || '[]'), 'setlists');
  } catch { return []; }
}

async function _saveSetlistsLocal(setlists) {
  // OPFS write-ahead (fire-and-forget, crash-resilient)
  _opfsWrite('setlists.json', setlists);
  // IDB first (primary), localStorage as fallback mirror
  if (IDB.isAvailable()) {
    try { await IDB.saveSetlists(setlists); }
    catch (e) { console.warn('IDB save setlists failed', e); }
  }
  try {
    const jsonStr = JSON.stringify(setlists);
    await _setCompressed('ct_setlists', jsonStr);
  } catch (e) { console.warn('localStorage save failed (setlists)', e); showToast('Storage full — data may not persist.'); }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_SETLISTS', setlists });
  }
}

function _loadSetlistsFromSWCache() {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return resolve(null);
    const handler = (e) => {
      if (e.data && e.data.type === 'CACHED_SETLISTS') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(e.data.setlists);
      }
    };
    const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', handler); resolve(null); }, 500);
    navigator.serviceWorker.addEventListener('message', handler);
    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_SETLISTS' });
  });
}

async function loadSetlistsInstant() {
  if (IDB.isAvailable()) {
    try {
      const idbSetlists = await IDB.loadSetlists();
      if (idbSetlists && idbSetlists.length > 0) {
        Store.set('setlists', migrateSchema(idbSetlists, 'setlists'));
        return;
      }
    } catch (e) { console.warn('IDB load setlists failed', e); }
  }
  const local = _loadSetlistsLocal();
  if (local.length > 0) {
    Store.set('setlists', local);
    if (IDB.isAvailable()) {
      IDB.saveSetlists(local).catch(() => {});
    }
    return;
  }
  const swSetlists = await _loadSetlistsFromSWCache();
  if (swSetlists && swSetlists.length > 0) {
    Store.set('setlists', swSetlists);
    _saveSetlistsLocal(swSetlists);
    return;
  }
  // OPFS recovery — last resort
  const opfsSetlists = await OPFS.readData('setlists.json');
  if (opfsSetlists) {
    try {
      const parsed = JSON.parse(opfsSetlists);
      if (parsed.length > 0) {
        Store.set('setlists', migrateSchema(parsed, 'setlists'));
        _saveSetlistsLocal(parsed);
      }
    } catch { /* corrupt OPFS data — skip */ }
  }
}

// ─── Practice: local storage helpers ───────────────────────

function _loadPracticeLocal() {
  try {
    const raw = _getLocalSync('ct_practice');
    return migrateSchema(JSON.parse(raw || '[]'), 'practice');
  } catch { return []; }
}

async function _savePracticeLocal(data) {
  // OPFS write-ahead (fire-and-forget, crash-resilient)
  _opfsWrite('practice.json', data);
  // IDB first (primary), localStorage as fallback mirror
  if (IDB.isAvailable()) {
    try { await IDB.savePractice(data); }
    catch (e) { console.warn('IDB save practice failed', e); }
  }
  try {
    const jsonStr = JSON.stringify(data);
    await _setCompressed('ct_practice', jsonStr);
  } catch (e) { console.warn('localStorage save failed (practice)', e); showToast('Storage full — data may not persist.'); }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_PRACTICE', practice: data });
  }
}

function _loadPracticeFromSWCache() {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return resolve(null);
    const handler = (e) => {
      if (e.data && e.data.type === 'CACHED_PRACTICE') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(e.data.practice);
      }
    };
    const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', handler); resolve(null); }, 500);
    navigator.serviceWorker.addEventListener('message', handler);
    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_PRACTICE' });
  });
}

async function loadPracticeInstant() {
  if (IDB.isAvailable()) {
    try {
      const idbPractice = await IDB.loadPractice();
      if (idbPractice && idbPractice.length > 0) {
        Store.set('practice', migrateSchema(idbPractice, 'practice'));
        return;
      }
    } catch (e) { console.warn('IDB load practice failed', e); }
  }
  const local = _loadPracticeLocal();
  if (local.length > 0) {
    Store.set('practice', local);
    if (IDB.isAvailable()) {
      IDB.savePractice(local).catch(() => {});
    }
    return;
  }
  const sw = await _loadPracticeFromSWCache();
  if (sw && sw.length > 0) {
    Store.set('practice', sw);
    _savePracticeLocal(sw);
    return;
  }
  // OPFS recovery — last resort
  const opfsPractice = await OPFS.readData('practice.json');
  if (opfsPractice) {
    try {
      const parsed = JSON.parse(opfsPractice);
      if (parsed.length > 0) {
        Store.set('practice', migrateSchema(parsed, 'practice'));
        _savePracticeLocal(parsed);
      }
    } catch { /* corrupt OPFS data — skip */ }
  }
}

// ─── WikiCharts: local storage helpers ──────────────────

function _loadWikiChartsLocal() {
  try {
    const raw = _getLocalSync('ct_wikicharts');
    return migrateSchema(JSON.parse(raw || '[]'), 'wikiCharts');
  } catch { return []; }
}

async function _saveWikiChartsLocal(data) {
  // OPFS write-ahead (fire-and-forget, crash-resilient)
  _opfsWrite('wikicharts.json', data);
  if (IDB.isAvailable()) {
    try { await IDB.saveWikiCharts(data); }
    catch (e) { console.warn('IDB save wikiCharts failed', e); }
  }
  try {
    const jsonStr = JSON.stringify(data);
    await _setCompressed('ct_wikicharts', jsonStr);
  } catch (e) { console.warn('localStorage save failed (wikiCharts)', e); showToast('Storage full — data may not persist.'); }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_WIKICHARTS', wikiCharts: data });
  }
}

function _loadWikiChartsFromSWCache() {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return resolve(null);
    const handler = (e) => {
      if (e.data && e.data.type === 'CACHED_WIKICHARTS') {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(e.data.wikiCharts);
      }
    };
    const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', handler); resolve(null); }, 500);
    navigator.serviceWorker.addEventListener('message', handler);
    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_WIKICHARTS' });
  });
}

async function loadWikiChartsInstant() {
  if (IDB.isAvailable()) {
    try {
      const idbData = await IDB.loadWikiCharts();
      if (idbData && idbData.length > 0) {
        Store.set('wikiCharts', migrateSchema(idbData, 'wikiCharts'));
        return;
      }
    } catch (e) { console.warn('IDB load wikiCharts failed', e); }
  }
  const local = _loadWikiChartsLocal();
  if (local.length > 0) {
    Store.set('wikiCharts', local);
    if (IDB.isAvailable()) {
      IDB.saveWikiCharts(local).catch(() => {});
    }
    return;
  }
  const sw = await _loadWikiChartsFromSWCache();
  if (sw && sw.length > 0) {
    Store.set('wikiCharts', sw);
    _saveWikiChartsLocal(sw);
    return;
  }
  // OPFS recovery — last resort
  const opfsWC = await OPFS.readData('wikicharts.json');
  if (opfsWC) {
    try {
      const parsed = JSON.parse(opfsWC);
      if (parsed.length > 0) {
        Store.set('wikiCharts', migrateSchema(parsed, 'wikiCharts'));
        _saveWikiChartsLocal(parsed);
      }
    } catch { /* corrupt OPFS data — skip */ }
  }
}

function migratePracticeData() {
  let changed = false;
  const practice = Store.get('practice');
  if (!Array.isArray(practice) || practice.length === 0) return;

  // Detect old nested persona format: items with `practiceLists` or `lists` key
  const isOldFormat = practice.some(item => item.practiceLists || item.lists);
  if (!isOldFormat) return;

  // Flatten: extract all practice lists from all personas
  const flat = [];
  practice.forEach(persona => {
    // Handle ancient format (persona.lists → single practice list)
    if (persona.lists && !persona.practiceLists) {
      persona.practiceLists = [{
        id: Admin.generateId(persona.lists),
        name: 'Practice List',
        archived: false,
        createdAt: new Date().toISOString(),
        songs: persona.lists,
      }];
    }
    (persona.practiceLists || []).forEach(pl => {
      flat.push({
        id: pl.id,
        name: pl.name || 'Untitled',
        songs: pl.songs || [],
        archived: !!pl.archived,
        createdAt: pl.createdAt || new Date().toISOString(),
        updatedAt: pl.updatedAt || new Date().toISOString(),
        // Best-guess createdBy: use logged-in user if available
        createdBy: (Auth.isLoggedIn() && Auth.getUser())
          ? Auth.getUser().id
          : 'unknown',
      });
    });
    changed = true;
  });

  if (changed) {
    Store.set('practice', flat);
    _savePracticeLocal(flat);
    console.info('Migrated practice data: flattened', practice.length, 'personas →', flat.length, 'lists');
  }
}

// ─── Data fingerprinting (avoids JSON.stringify for comparison) ──

function _fingerprint(arr) {
  if (!arr || !arr.length) return '0:0';
  let hash = arr.length;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    hash = (hash * 31 + (item._ts || 0)) | 0;
    if (item.id) {
      for (let j = 0; j < item.id.length; j++) {
        hash = (hash * 31 + item.id.charCodeAt(j)) | 0;
      }
    }
  }
  return arr.length + ':' + hash;
}

// ─── Sync helpers ──────────────────────────────────────────

function _shouldSync() {
  const last = parseInt(localStorage.getItem('ct_last_sync') || '0', 10);
  return Date.now() - last > Store.get('SYNC_COOLDOWN_MS');
}

function _markSynced() {
  localStorage.setItem('ct_last_sync', String(Date.now()));
}

function _syncDone() {
  const songs = Store.get('songs');
  if (songs.length === 0) {
    const t = document.getElementById('empty-title');
    const s = document.getElementById('empty-sub');
    if (t) t.textContent = 'No songs yet.';
    if (s) s.textContent = '';
  }
}

// ─── Auto-configure GitHub from Drive PAT ─────────────────

async function tryAutoConfigureGitHub() {
  // No-op — Worker proxy handles GitHub config server-side
}

// ─── Main sync orchestrator ────────────────────────────────

/**
 * Main sync orchestrator. Fetches remote data and updates local state.
 * @param {boolean} [force] - Skip cooldown timer (manual refresh)
 */
async function syncAll(force) {
  const _useCF = useCloudflare();
  const _useGitHub = !_useCF && GitHub.isConfigured();
  const _mobile = isMobile();
  if (!_useCF && !_useGitHub && _mobile) { _syncDone(); return; }
  if (!_useCF && !_useGitHub && !Drive.isConfigured()) { _syncDone(); return; }
  if (Store.get('syncing')) return;
  if (_useGitHub && GitHub.getWriteQueueStatus().hasPending && !force) { _syncDone(); return; }
  if (!force && Store.get('lastDriveSnapshot') && !_shouldSync()) { _syncDone(); return; }

  if (force) {
    const now = Date.now();
    const cooldown = Store.get('MANUAL_SYNC_COOLDOWN_MS');
    let history = Store.get('manualSyncHistory').filter(t => now - t < cooldown);
    if (history.length >= 2) {
      showToast('Please wait a moment before refreshing again.');
      _syncDone();
      return;
    }
    history.push(now);
    Store.set('manualSyncHistory', history);
  }

  Store.set('syncing', true);
  // Don't show "Syncing songs" if pull-to-refresh indicator is already visible
  const ptrEl = document.getElementById('ptr-indicator');
  const ptrActive = ptrEl && ptrEl.classList.contains('ptr-refreshing');
  const indicator = document.getElementById('sync-indicator');
  if (indicator && !ptrActive) indicator.classList.remove('hidden');

  try {
    const remoteData = useCloudflare()
      ? await _loadFromD1()
      : _useGitHub
        ? await GitHub.loadAllData()
        : await Drive.loadAllData();
    Store.set('lastDriveSnapshot', remoteData);
    const { songs, setlists, practice, wikiCharts } = remoteData;
    let dataChanged = false;

    if (songs !== null) {
      if (_fingerprint(songs) !== _fingerprint(Store.get('songs'))) dataChanged = true;
      Store.set('songs', songs);
      _saveLocal(songs);
      const activeKeys = Store.get('activeKeys');
      if (activeKeys.length) {
        const validKeys = new Set(songs.map(s => (s.key || '').trim()).filter(k => k && !isHybridKey(k)));
        Store.set('activeKeys', activeKeys.filter(k => validKeys.has(k)));
      }
    }
    if (setlists !== null) {
      if (_fingerprint(setlists) !== _fingerprint(Store.get('setlists'))) dataChanged = true;
      Store.set('setlists', setlists);
      _saveSetlistsLocal(setlists);
    }
    if (practice !== null) {
      if (_fingerprint(practice) !== _fingerprint(Store.get('practice'))) dataChanged = true;
      Store.set('practice', practice);
      migratePracticeData();
      _savePracticeLocal(Store.get('practice'));
    }
    if (wikiCharts !== null && wikiCharts !== undefined) {
      if (_fingerprint(wikiCharts) !== _fingerprint(Store.get('wikiCharts'))) dataChanged = true;
      Store.set('wikiCharts', wikiCharts);
      _saveWikiChartsLocal(wikiCharts);
    }

    if (_useGitHub && (songs !== null || setlists !== null || practice !== null)) {
      if (localStorage.getItem('ct_migrated_to_github') !== '1') {
        localStorage.setItem('ct_migrated_to_github', '1');
      }
    }

    // Re-render current view if data changed
    if (dataChanged) {
      _rerenderAfterSync();
      // App Badge API — show badge when data changed from remote
      navigator.setAppBadge?.(1)?.catch?.(() => {});
    }
    _markSynced();
  } catch (e) {
    const backend = _useGitHub ? 'GitHub' : 'Drive';
    console.warn(`${backend} sync failed, using local cache`, e);
    const msg = String(e.message || e || '');
    // Only toast for actionable errors — routine sync failures are silent
    // (data loads from local cache seamlessly)
    if (msg.includes('Decryption failed')) {
      showToast('Decryption failed — PAT may have changed.', 10000);
    } else if (msg.includes('403') || msg.includes('429') || msg.includes('rate')) {
      showToast('Temporarily rate-limited — try again in a moment.', 6000);
    }
  } finally {
    Store.set('syncing', false);
    if (indicator) indicator.classList.add('hidden');
    _syncDone();
  }
}

/**
 * Post-sync re-render: refresh active item references and re-render current view.
 * Uses Router registry for render calls.
 */
function _rerenderAfterSync() {
  const view = Store.get('view');
  const songs = Store.get('songs');
  const setlists = Store.get('setlists');
  const practice = Store.get('practice');

  if (view === 'list') {
    Router.rerenderCurrentView();
  } else if (view === 'detail' && Store.get('activeSong')) {
    const fresh = songs.find(s => s.id === Store.get('activeSong').id);
    if (fresh) Store.set('activeSong', fresh);
    Router.rerenderCurrentView();
  } else if (view === 'setlists') {
    Router.rerenderCurrentView();
  } else if (view === 'setlist-detail' && Store.get('activeSetlist')) {
    const fresh = setlists.find(s => s.id === Store.get('activeSetlist').id);
    if (fresh) Store.set('activeSetlist', fresh);
    Router.rerenderCurrentView();
  } else if (view === 'practice') {
    Router.rerenderCurrentView();
  } else if (view === 'practice-detail') {
    Router.rerenderCurrentView();
  } else if (view === 'dashboard') {
    Router.rerenderCurrentView();
  } else if (view === 'wikicharts' || view === 'wikichart-detail') {
    Router.rerenderCurrentView();
  }
}

async function doSyncRefresh(afterCallback) {
  showToast(useCloudflare() ? 'Syncing…' : GitHub.isConfigured() ? 'Syncing from GitHub…' : 'Syncing from Drive…');
  await syncAll(true);
  showToast('Sync complete.');
  if (afterCallback) afterCallback();
}

// ─── Save functions ────────────────────────────────────────

/**
 * Save songs to local storage and sync to remote backend.
 * @param {string} [toastMsg] - Custom toast message (default: "Saved.")
 */
async function saveSongs(toastMsg) {
  const songs = Store.get('songs');
  _saveLocal(songs);
  if (useCloudflare()) {
    _saveToD1('songs', songs).then(() => _markSynced()).catch(e => {
      if (e.status === 409) { _handleConflict('songs', songs, _saveLocal); return; }
      if (MutationQueue.isNetworkError(e)) {
        MutationQueue.enqueueBulkSave('songs', songs);
        return;
      }
      console.warn('D1 save songs failed', e);
    });
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (GitHub.isConfigured()) {
    GitHub.saveSongs(songs).then(() => _markSynced()).catch(() => {});
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (!isMobile() && Drive.isWriteConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Drive.saveSongs(songs);
        _markSynced();
        if (toastMsg) showToast(toastMsg);
        return;
      } catch (e) {
        console.error(`Drive songs save attempt ${attempt + 1} failed`, e);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.warn('Drive songs save failed after retries');
  }
  if (toastMsg) showToast(toastMsg);
}

/**
 * Save setlists to local storage and sync to remote backend.
 * @param {string} [toastMsg]
 */
async function saveSetlists(toastMsg) {
  const setlists = Store.get('setlists');
  _saveSetlistsLocal(setlists);
  if (useCloudflare()) {
    _saveToD1('setlists', setlists).then(() => _markSynced()).catch(e => {
      if (e.status === 409) { _handleConflict('setlists', setlists, _saveSetlistsLocal); return; }
      if (MutationQueue.isNetworkError(e)) {
        MutationQueue.enqueueBulkSave('setlists', setlists);
        return;
      }
      console.warn('D1 save setlists failed', e);
    });
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (GitHub.isConfigured()) {
    GitHub.saveSetlists(setlists).then(() => _markSynced()).catch(() => {});
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (!isMobile() && Drive.isWriteConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Drive.saveSetlists(setlists);
        _markSynced();
        if (toastMsg) showToast(toastMsg);
        return;
      } catch (e) {
        console.error(`Drive setlists save attempt ${attempt + 1} failed`, e);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.warn('Drive setlists save failed after retries');
  }
  if (toastMsg) showToast(toastMsg);
}

/**
 * Save practice lists to local storage and sync to remote backend.
 * @param {string} [toastMsg]
 */
async function savePractice(toastMsg) {
  const practice = Store.get('practice');
  _savePracticeLocal(practice);
  if (useCloudflare()) {
    _saveToD1('practice', practice).then(() => _markSynced()).catch(e => {
      if (e.status === 409) { _handleConflict('practice', practice, _savePracticeLocal); return; }
      if (MutationQueue.isNetworkError(e)) {
        MutationQueue.enqueueBulkSave('practice', practice);
        return;
      }
      console.warn('D1 save practice failed', e);
    });
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (GitHub.isConfigured()) {
    GitHub.savePractice(practice).then(() => _markSynced()).catch(() => {});
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (!isMobile() && Drive.isWriteConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Drive.savePractice(practice);
        _markSynced();
        if (toastMsg) showToast(toastMsg);
        return;
      } catch (e) {
        console.error(`Drive practice save attempt ${attempt + 1} failed`, e);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.warn('Drive practice save failed after retries');
  }
  if (toastMsg) showToast(toastMsg);
}

/**
 * Save WikiCharts to local storage and sync to remote backend.
 * @param {string} [toastMsg]
 */
async function saveWikiCharts(toastMsg) {
  const wikiCharts = Store.get('wikiCharts');
  _saveWikiChartsLocal(wikiCharts);
  if (useCloudflare()) {
    _saveToD1('wikicharts', wikiCharts).then(() => _markSynced()).catch(e => {
      if (e.status === 409) { _handleConflict('wikicharts', wikiCharts, _saveWikiChartsLocal); return; }
      if (MutationQueue.isNetworkError(e)) {
        MutationQueue.enqueueBulkSave('wikicharts', wikiCharts);
        return;
      }
      console.warn('D1 save wikiCharts failed', e);
    });
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (GitHub.isConfigured()) {
    GitHub.saveWikiCharts(wikiCharts).then(() => _markSynced()).catch(() => {});
    if (toastMsg) showToast(toastMsg);
    return;
  }
  if (toastMsg) showToast(toastMsg);
}

// ─── Real-time sync polling ─────────────────────────────────
// Lightweight polling — checks /data/changes for timestamp diffs,
// only does full sync when data has actually changed.

let _pollTimer = null;
let _lastChanges = null;
const POLL_INTERVAL_MS = 30000; // 30 seconds

function startSyncPolling() {
  if (_pollTimer) return; // already running
  if (!useCloudflare()) return; // only for D1 backend
  if (!Auth.getToken?.()) return; // need auth for polling
  _pollTimer = setInterval(_pollForChanges, POLL_INTERVAL_MS);
}

function stopSyncPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _lastChanges = null;
}

async function _pollForChanges() {
  if (!useCloudflare() || !Auth.getToken?.()) return;
  if (Store.get('syncing')) return; // don't poll during active sync
  try {
    const changes = await _workerFetch('/data/changes');
    if (!_lastChanges) {
      // First poll — just store baseline, don't sync
      _lastChanges = changes;
      return;
    }
    // Check if anything changed since last poll
    const changed = (
      changes.songs?.latest !== _lastChanges.songs?.latest ||
      changes.songs?.count !== _lastChanges.songs?.count ||
      changes.setlists?.latest !== _lastChanges.setlists?.latest ||
      changes.setlists?.count !== _lastChanges.setlists?.count ||
      changes.practice?.latest !== _lastChanges.practice?.latest ||
      changes.practice?.count !== _lastChanges.practice?.count ||
      changes.wikiCharts?.latest !== _lastChanges.wikiCharts?.latest ||
      changes.wikiCharts?.count !== _lastChanges.wikiCharts?.count
    );
    _lastChanges = changes;
    if (changed) {
      console.info('Remote data changed — syncing');
      await syncAll(true);
    }
  } catch (e) {
    // Silently ignore poll failures (network issues, etc.)
    console.debug('Sync poll failed:', e.message);
  }
}

// ─── Orchestra helpers ──────────────────────────────────────

/**
 * Load the user's orchestra list from the Worker.
 * @returns {Promise<Array>}
 */
async function loadOrchestras() {
  if (!useCloudflare() || !Auth.getToken?.()) return [];
  try {
    const res = await _workerFetch('/orchestras');
    const orchestras = res.orchestras || [];
    Store.set('orchestras', orchestras);
    return orchestras;
  } catch (e) {
    console.warn('Failed to load orchestras:', e.message);
    return Store.get('orchestras') || [];
  }
}

/**
 * Load the instrument hierarchy from the Worker.
 * @returns {Promise<Object|null>}
 */
async function loadInstrumentHierarchy() {
  if (!useCloudflare() || !Auth.getToken?.()) return null;
  try {
    const res = await _workerFetch('/instruments');
    const hierarchy = { sections: res.sections || [] };
    Store.set('instrumentHierarchy', hierarchy);
    // Cache in localStorage for offline
    try { localStorage.setItem('ct_instrument_hierarchy', JSON.stringify(hierarchy)); } catch (_) {}
    return hierarchy;
  } catch (e) {
    console.warn('Failed to load instruments:', e.message);
    // Try localStorage fallback
    try {
      const cached = localStorage.getItem('ct_instrument_hierarchy');
      if (cached) {
        const hierarchy = JSON.parse(cached);
        Store.set('instrumentHierarchy', hierarchy);
        return hierarchy;
      }
    } catch (_) {}
    return null;
  }
}

/**
 * Switch active orchestra: update server, clear local caches, full re-sync.
 * @param {string} orchestraId
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function switchOrchestra(orchestraId) {
  try {
    // 1. Update server
    const result = await Auth.setActiveOrchestra(orchestraId);
    if (!result.ok) return result;

    // 2. Clear local data caches (keep auth)
    Store.set('songs', []);
    Store.set('setlists', []);
    Store.set('practice', []);
    Store.set('wikiCharts', []);
    Store.set('activeOrchestraId', orchestraId);
    try {
      localStorage.removeItem('ct_songs');
      localStorage.removeItem('ct_setlists');
      localStorage.removeItem('ct_practice');
      localStorage.removeItem('ct_wikicharts');
      localStorage.removeItem('ct_sync_last');
      localStorage.removeItem('ct_sync_fingerprints');
    } catch (_) {}

    // 3. Clear IDB + OPFS
    try { await IDB.saveSongs([]); } catch (_) {}
    try { await IDB.saveSetlists([]); } catch (_) {}
    try { await IDB.savePractice([]); } catch (_) {}
    try { await IDB.saveWikiCharts([]); } catch (_) {}
    OPFS.clearAll().catch(() => {}); // fire-and-forget

    // 4. Reset poll baseline
    _lastChanges = null;

    // 5. Full re-sync
    await syncAll(true);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Switch failed' };
  }
}

// ─── Orchestra Settings ─────────────────────────────────────

/**
 * Load orchestra settings from the Worker (or localStorage cache).
 * @param {string} [orchestraId] - Defaults to active orchestra
 * @returns {Promise<Object>} Key-value settings object
 */
async function loadOrchestraSettings(orchestraId) {
  const orchId = orchestraId || Auth.getActiveOrchestraId?.();
  if (!orchId) return {};
  // Try localStorage cache first
  try {
    const cached = localStorage.getItem(`ct_orch_settings_${orchId}`);
    if (cached) {
      const settings = JSON.parse(cached);
      Store.set('orchestraSettings', settings);
    }
  } catch (_) {}

  if (!useCloudflare() || !Auth.getToken?.()) return Store.get('orchestraSettings') || {};
  try {
    const res = await _workerFetch(`/orchestras/${orchId}/settings`);
    const settings = res.settings || {};
    Store.set('orchestraSettings', settings);
    try { localStorage.setItem(`ct_orch_settings_${orchId}`, JSON.stringify(settings)); } catch (_) {}
    return settings;
  } catch (e) {
    console.warn('Failed to load orchestra settings:', e.message);
    return Store.get('orchestraSettings') || {};
  }
}

/**
 * Save a single orchestra setting.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<boolean>}
 */
async function saveOrchestraSetting(key, value) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId) return false;
  // Update local immediately
  const settings = Store.get('orchestraSettings') || {};
  settings[key] = value;
  Store.set('orchestraSettings', settings);
  try { localStorage.setItem(`ct_orch_settings_${orchId}`, JSON.stringify(settings)); } catch (_) {}

  if (!useCloudflare() || !Auth.getToken?.()) return true;
  return _queueableWrite(`/orchestras/${orchId}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

/**
 * Save multiple orchestra settings at once.
 * @param {Object} settings - Key-value pairs
 * @returns {Promise<boolean>}
 */
async function saveOrchestraSettingsBatch(settings) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId) return false;
  const current = Store.get('orchestraSettings') || {};
  Object.assign(current, settings);
  Store.set('orchestraSettings', current);
  try { localStorage.setItem(`ct_orch_settings_${orchId}`, JSON.stringify(current)); } catch (_) {}

  if (!useCloudflare() || !Auth.getToken?.()) return true;
  return _queueableWrite(`/orchestras/${orchId}/settings/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

/**
 * Load admin settings from the Worker.
 * @returns {Promise<Object>} Key-value settings object
 */
async function loadAdminSettings() {
  if (!useCloudflare() || !Auth.getToken?.()) {
    try {
      const cached = localStorage.getItem('ct_admin_settings');
      return cached ? JSON.parse(cached) : {};
    } catch (_) { return {}; }
  }
  try {
    const res = await _workerFetch('/admin/settings');
    const settings = res.settings || {};
    try { localStorage.setItem('ct_admin_settings', JSON.stringify(settings)); } catch (_) {}
    return settings;
  } catch (e) {
    console.warn('Failed to load admin settings:', e.message);
    try {
      const cached = localStorage.getItem('ct_admin_settings');
      return cached ? JSON.parse(cached) : {};
    } catch (_) { return {}; }
  }
}

/**
 * Save an admin setting.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<boolean>}
 */
async function saveAdminSetting(key, value) {
  if (!useCloudflare() || !Auth.getToken?.()) return false;
  // Update local cache immediately (optimistic)
  try {
    const cached = JSON.parse(localStorage.getItem('ct_admin_settings') || '{}');
    cached[key] = value;
    localStorage.setItem('ct_admin_settings', JSON.stringify(cached));
  } catch (_) {}
  return _queueableWrite('/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

/**
 * Get an admin setting with fallback (reads from localStorage cache).
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
function getAdminSetting(key, fallback) {
  try {
    const cached = JSON.parse(localStorage.getItem('ct_admin_settings') || '{}');
    return key in cached ? cached[key] : fallback;
  } catch (_) { return fallback; }
}

/**
 * Get an orchestra setting with fallback.
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
function getOrchestraSetting(key, fallback) {
  const settings = Store.get('orchestraSettings') || {};
  return key in settings ? settings[key] : fallback;
}

/**
 * Load song suggestions for the active orchestra.
 * @param {string} [status='pending']
 * @returns {Promise<Array>}
 */
async function loadSongSuggestions(status = 'pending') {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return [];
  try {
    const res = await _workerFetch(`/orchestras/${orchId}/suggestions?status=${status}`);
    return res.suggestions || [];
  } catch { return []; }
}

/**
 * Submit a song edit suggestion (member).
 */
async function submitSongSuggestion(songId, fieldName, oldValue, newValue) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return false;
  return _queueableWrite(`/orchestras/${orchId}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, fieldName, oldValue, newValue }),
  }, 'Suggestion queued — will send when back online');
}

/**
 * Review (approve/reject) a song suggestion (conductr).
 */
async function reviewSongSuggestion(suggestionId, status) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return false;
  return _queueableWrite(`/orchestras/${orchId}/suggestions/${suggestionId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }, 'Review queued — will sync when back online');
}

// ─── Queueable write helper ─────────────────────────────
// Wraps a _workerFetch write call so network failures get queued for offline retry.
// Returns true on success OR successful queue, false on non-queueable failure.

async function _queueableWrite(path, options, toastOnQueue) {
  try {
    await _workerFetch(path, options);
    return true;
  } catch (e) {
    if (MutationQueue.isNetworkError(e)) {
      const body = options.body ? JSON.parse(options.body) : null;
      await MutationQueue.enqueue(path, options.method || 'POST', body);
      if (toastOnQueue) showToast(toastOnQueue);
      return true; // Queued successfully — optimistic
    }
    return false;
  }
}

// ─── Orchestra Messages ─────────────────────────────────

/**
 * Load messages for the active orchestra.
 * @param {Object} [filters] - { status, category }
 * @returns {Promise<Array>}
 */
async function loadMessages(filters = {}) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return [];
  try {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.category && filters.category !== 'all') params.set('category', filters.category);
    const res = await _workerFetch(`/orchestras/${orchId}/messages?${params}`);
    return res.messages || [];
  } catch { return []; }
}

/**
 * Get unread message count for the active orchestra.
 * @returns {Promise<number>}
 */
async function getUnreadMessageCount() {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return 0;
  try {
    const res = await _workerFetch(`/orchestras/${orchId}/messages?status=open&count_only=true`);
    return res.count || 0;
  } catch { return 0; }
}

/**
 * Get a message thread (parent + replies).
 */
async function getMessageThread(messageId) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return null;
  try {
    return await _workerFetch(`/orchestras/${orchId}/messages/${messageId}`);
  } catch { return null; }
}

/**
 * Send a new message.
 */
async function sendMessage(subject, body, category = 'general') {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return false;
  return _queueableWrite(`/orchestras/${orchId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, body, category }),
  }, 'Message queued — will send when back online');
}

/**
 * Reply to a message thread.
 */
async function replyToMessage(messageId, body) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return false;
  return _queueableWrite(`/orchestras/${orchId}/messages/${messageId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }, 'Reply queued — will send when back online');
}

/**
 * Update message status (conductr/admin/owner).
 */
async function updateMessageStatus(messageId, status) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return false;
  return _queueableWrite(`/orchestras/${orchId}/messages/${messageId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }, 'Status update queued — will sync when back online');
}

/**
 * Delete a message thread (conductr/admin/owner).
 */
async function deleteMessage(messageId) {
  const orchId = Auth.getActiveOrchestraId?.();
  if (!orchId || !useCloudflare() || !Auth.getToken?.()) return false;
  return _queueableWrite(`/orchestras/${orchId}/messages/${messageId}`, {
    method: 'DELETE',
  }, 'Delete queued — will sync when back online');
}

// ─── Expose internal helpers for backward compat ───────────

export { migrateSchema, loadSongsInstant, loadSetlistsInstant, loadPracticeInstant, loadWikiChartsInstant, migratePracticeData, syncAll, doSyncRefresh, tryAutoConfigureGitHub, saveSongs, saveSetlists, savePractice, saveWikiCharts, useCloudflare, startSyncPolling, stopSyncPolling, loadOrchestras, loadInstrumentHierarchy, switchOrchestra, loadOrchestraSettings, saveOrchestraSetting, saveOrchestraSettingsBatch, getOrchestraSetting, loadAdminSettings, saveAdminSetting, getAdminSetting, loadSongSuggestions, submitSongSuggestion, reviewSongSuggestion, loadMessages, getUnreadMessageCount, getMessageThread, sendMessage, replyToMessage, updateMessageStatus, deleteMessage, MutationQueue };
export { _saveLocal as saveLocal, _saveSetlistsLocal as saveSetlistsLocal, _savePracticeLocal as savePracticeLocal, _saveWikiChartsLocal as saveWikiChartsLocal };
