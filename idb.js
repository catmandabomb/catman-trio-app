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
    const req = indexedDB.open('catmantrio-db', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('practice')) db.createObjectStore('practice', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      // v2: pending writes store for Background Sync
      if (!db.objectStoreNames.contains('pendingWrites')) db.createObjectStore('pendingWrites', { keyPath: 'type' });
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

async function clearAll() {
  if (!_db) return;
  const stores = ['songs', 'setlists', 'practice', 'meta', 'pendingWrites'];
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
  return { songs: await count('songs'), setlists: await count('setlists'), practice: await count('practice') };
}

export { open, isAvailable, loadSongs, saveSongs, loadSetlists, saveSetlists, loadPractice, savePractice, getMeta, setMeta, clearAll, getStorageInfo, savePendingWrite, loadPendingWrites, clearPendingWrite, clearAllPendingWrites };
