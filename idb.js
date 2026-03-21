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
    const req = indexedDB.open('catmantrio-db', 6);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('practice')) db.createObjectStore('practice', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      // v2: pending writes store for Background Sync (bulk saves, one per type)
      if (!db.objectStoreNames.contains('pendingWrites')) db.createObjectStore('pendingWrites', { keyPath: 'type' });
      // v3: audio file cache for offline playback
      if (!db.objectStoreNames.contains('audioCache')) db.createObjectStore('audioCache', { keyPath: 'fileId' });
      // v5: mutation queue for offline discrete mutations (FIFO, auto-increment)
      if (!db.objectStoreNames.contains('mutationQueue')) db.createObjectStore('mutationQueue', { autoIncrement: true });
      // v6: Rename wikiCharts → sheets (migrate data, drop old store)
      if (!db.objectStoreNames.contains('sheets')) db.createObjectStore('sheets', { keyPath: 'id' });
      if (db.objectStoreNames.contains('wikiCharts') && e.oldVersion < 6) {
        const oldStore = tx.objectStore('wikiCharts');
        const cursorReq = oldStore.openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            tx.objectStore('sheets').put(cursor.value);
            cursor.continue();
          } else {
            // All data migrated — delete old store
            if (db.objectStoreNames.contains('wikiCharts')) db.deleteObjectStore('wikiCharts');
          }
        };
      } else if (db.objectStoreNames.contains('wikiCharts')) {
        db.deleteObjectStore('wikiCharts');
      }
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
async function loadSheets() { return _loadAll('sheets'); }
async function saveSheets(sheets) { return _saveAll('sheets', sheets); }

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

// ─── Mutation queue (offline discrete mutations) ──────

/**
 * Enqueue a discrete mutation for offline retry.
 * @param {Object} mutation - { path, method, body, headers }
 * @returns {Promise<number>} Auto-generated key
 */
async function enqueueMutation(mutation) {
  if (!_db) return -1;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('mutationQueue', 'readwrite');
      const req = tx.objectStore('mutationQueue').add({
        ...mutation,
        ts: Date.now(),
        retries: 0,
      });
      let key = -1;
      req.onsuccess = () => { key = req.result; };
      tx.oncomplete = () => resolve(key);
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Get all queued mutations in insertion order (FIFO via autoIncrement keys).
 * @returns {Promise<Array<{key: number, path: string, method: string, body: string, ts: number, retries: number}>>}
 */
async function getAllMutations() {
  if (!_db) return [];
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('mutationQueue', 'readonly');
      const store = tx.objectStore('mutationQueue');
      const results = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          results.push({ ...cursor.value, key: cursor.key });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Remove a mutation from the queue by its auto-increment key.
 * @param {number} key
 */
async function dequeueMutation(key) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('mutationQueue', 'readwrite');
      tx.objectStore('mutationQueue').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Update a mutation's retry count.
 * @param {number} key
 * @param {Object} updates - Fields to merge (e.g. { retries: 2 })
 */
async function updateMutation(key, updates) {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('mutationQueue', 'readwrite');
      const store = tx.objectStore('mutationQueue');
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        if (!getReq.result) { resolve(); return; }
        store.put({ ...getReq.result, ...updates }, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Clear the entire mutation queue.
 */
async function clearMutationQueue() {
  if (!_db) return;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('mutationQueue', 'readwrite');
      tx.objectStore('mutationQueue').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

/**
 * Count queued mutations.
 * @returns {Promise<number>}
 */
async function countMutations() {
  if (!_db) return 0;
  return new Promise((resolve, reject) => {
    try {
      const tx = _db.transaction('mutationQueue', 'readonly');
      const req = tx.objectStore('mutationQueue').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function clearAll() {
  if (!_db) return;
  const stores = ['songs', 'setlists', 'practice', 'sheets', 'meta', 'pendingWrites', 'audioCache', 'mutationQueue'];
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
  return { songs: await count('songs'), setlists: await count('setlists'), practice: await count('practice'), sheets: await count('sheets') };
}

export { open, isAvailable, loadSongs, saveSongs, loadSetlists, saveSetlists, loadPractice, savePractice, loadSheets, saveSheets, getMeta, setMeta, clearAll, getStorageInfo, savePendingWrite, loadPendingWrites, clearPendingWrite, clearAllPendingWrites, cacheAudio, getCachedAudio, removeCachedAudio, listCachedAudio, clearAudioCache, getAudioCacheSize, enqueueMutation, getAllMutations, dequeueMutation, updateMutation, clearMutationQueue, countMutations };
