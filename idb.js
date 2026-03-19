/**
 * idb.js — IndexedDB wrapper for Catman Trio PWA
 *
 * Primary offline storage. localStorage is kept as a write-through fallback.
 * All operations are async and fail gracefully — the app works without IDB.
 */

let _db = null;
let _available = false;

async function open() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
    const req = indexedDB.open('catmantrio-db', 4);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('practice')) db.createObjectStore('practice', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      // v2: pending writes store for Background Sync
      if (!db.objectStoreNames.contains('pendingWrites')) db.createObjectStore('pendingWrites', { keyPath: 'type' });
      // v3: audio file cache for offline playback
      if (!db.objectStoreNames.contains('audioCache')) db.createObjectStore('audioCache', { keyPath: 'fileId' });
      // v4: WikiCharts store
      if (!db.objectStoreNames.contains('wikiCharts')) db.createObjectStore('wikiCharts', { keyPath: 'id' });
    };
    req.onsuccess = (e) => { _db = e.target.result; _available = true;
        _db.onversionchange = () => { _db.close(); _available = false; };
        resolve(); };
    req.onblocked = () => { reject(new Error('IDB blocked by another tab')); };
    req.onerror = (e) => { reject(e.target.error); };
  });
}

function isAvailable() { return _available && _db !== null; }

// Generic helpers
async function _loadAll(storeName) {
  if (!_db) return [];
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function _saveAll(storeName, items) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      (items || []).forEach(item => { if (item && item.id) store.put(item); });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

// Public API
async function loadSongs() { return _loadAll('songs'); }
async function saveSongs(songs) { return _saveAll('songs', songs); }
async function loadSetlists() { return _loadAll('setlists'); }
async function saveSetlists(setlists) { return _saveAll('setlists', setlists); }
async function loadPractice() { return _loadAll('practice'); }
async function savePractice(practice) { return _saveAll('practice', practice); }
async function loadWikiCharts() { return _loadAll('wikiCharts'); }
async function saveWikiCharts(wikiCharts) { return _saveAll('wikiCharts', wikiCharts); }

async function getMeta(key) {
  if (!_db) return null;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function setMeta(key, value) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

// ─── Pending writes (Background Sync) ───────────────

async function savePendingWrite(type, data) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('pendingWrites', 'readwrite');
      tx.objectStore('pendingWrites').put({ type, data, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

async function loadPendingWrites() {
  if (!_db) return [];
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('pendingWrites', 'readonly');
      const req = tx.objectStore('pendingWrites').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function clearPendingWrite(type) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('pendingWrites', 'readwrite');
      tx.objectStore('pendingWrites').delete(type);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

async function clearAllPendingWrites() {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('pendingWrites', 'readwrite');
      tx.objectStore('pendingWrites').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

// ─── Audio cache (offline playback) ──────────────────

/**
 * Save an audio file blob to IDB for offline playback.
 * @param {string} fileId - File ID (R2 or Drive)
 * @param {Blob} blob - Audio file blob
 * @param {string} songId - Associated song ID
 * @param {string} filename - Original filename
 */
async function cacheAudio(fileId, blob, songId, filename) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('audioCache', 'readwrite');
      tx.objectStore('audioCache').put({
        fileId, blob, songId, filename,
        cachedAt: Date.now(),
        size: blob.size,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Get a cached audio blob by file ID.
 * @param {string} fileId
 * @returns {Promise<Blob|null>}
 */
async function getCachedAudio(fileId) {
  if (!_db) return null;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('audioCache', 'readonly');
      const req = tx.objectStore('audioCache').get(fileId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Remove a cached audio file.
 * @param {string} fileId
 */
async function removeCachedAudio(fileId) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('audioCache', 'readwrite');
      tx.objectStore('audioCache').delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * List all cached audio entries (without blob data for memory efficiency).
 * @returns {Promise<Array<{fileId: string, songId: string, filename: string, size: number, cachedAt: number}>>}
 */
async function listCachedAudio() {
  if (!_db) return [];
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('audioCache', 'readonly');
      const req = tx.objectStore('audioCache').getAll();
      req.onsuccess = () => {
        const entries = (req.result || []).map(e => ({
          fileId: e.fileId, songId: e.songId, filename: e.filename,
          size: e.size, cachedAt: e.cachedAt,
        }));
        resolve(entries);
      };
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Clear all cached audio files.
 */
async function clearAudioCache() {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('audioCache', 'readwrite');
      tx.objectStore('audioCache').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Get total size of cached audio files.
 * @returns {Promise<number>} Total bytes
 */
async function getAudioCacheSize() {
  if (!_db) return 0;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('audioCache', 'readonly');
      const req = tx.objectStore('audioCache').getAll();
      req.onsuccess = () => {
        const total = (req.result || []).reduce((sum, e) => sum + (e.size || 0), 0);
        resolve(total);
      };
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function clearAll() {
  if (!_db) return;
  const stores = ['songs', 'setlists', 'practice', 'wikiCharts', 'meta', 'pendingWrites', 'audioCache'];
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction(stores, 'readwrite');
      stores.forEach(s => tx.objectStore(s).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

async function getStorageInfo() {
  if (!_db) return { songs: 0, setlists: 0, practice: 0 };
  const count = async (name) => {
    return new Promise((resolve) => {
      try {
        const tx = _db.transaction(name, 'readonly');
        const req = tx.objectStore(name).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      } catch (_) { resolve(0); }
    });
  };
  return { songs: await count('songs'), setlists: await count('setlists'), practice: await count('practice'), wikiCharts: await count('wikiCharts') };
}

export { open, isAvailable, loadSongs, saveSongs, loadSetlists, saveSetlists, loadPractice, savePractice, loadWikiCharts, saveWikiCharts, getMeta, setMeta, clearAll, getStorageInfo, savePendingWrite, loadPendingWrites, clearPendingWrite, clearAllPendingWrites, cacheAudio, getCachedAudio, removeCachedAudio, listCachedAudio, clearAudioCache, getAudioCacheSize };
