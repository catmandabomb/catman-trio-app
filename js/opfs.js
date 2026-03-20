/**
 * opfs.js — Origin Private File System write buffer
 *
 * Crash-resilient persistence layer. OPFS survives sudden power loss
 * and browser crashes better than localStorage/IDB because the browser
 * flushes file writes to disk more aggressively.
 *
 * This is a SAFETY NET — not a replacement for IDB or localStorage.
 * All operations are fire-and-forget from the caller's perspective.
 *
 * Notes:
 * - createSyncAccessHandle() is Worker-only; we use createWritable() on main thread
 * - createWritable() requires Safari 17.0+ — we feature-detect it specifically
 * - All functions fail silently when OPFS is unavailable
 *
 * @module opfs
 */

const _OPFS_DIR = 'catmantrio-data';

/** @type {FileSystemDirectoryHandle|null|false} */
let _dirCache = undefined; // undefined = not checked yet, null/false = unavailable

/**
 * Get (or create) the app's OPFS directory handle. Cached after first call.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function _getDir() {
  if (_dirCache !== undefined) return _dirCache || null;
  if (!('storage' in navigator && 'getDirectory' in navigator.storage)) {
    _dirCache = false;
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    _dirCache = await root.getDirectoryHandle(_OPFS_DIR, { create: true });
    return _dirCache;
  } catch {
    _dirCache = false;
    return null;
  }
}

/** @type {boolean|null} */
let _writableSupported = null;

/**
 * Check if createWritable() is supported (Safari 17.0+, Chrome 86+, Firefox 111+).
 * Cached after first probe.
 * @returns {Promise<boolean>}
 */
async function _hasCreateWritable() {
  if (_writableSupported !== null) return _writableSupported;
  const dir = await _getDir();
  if (!dir) { _writableSupported = false; return false; }
  try {
    const probe = await dir.getFileHandle('_probe', { create: true });
    if (typeof probe.createWritable !== 'function') {
      _writableSupported = false;
      return false;
    }
    // Actually test it — some browsers expose the method but throw
    const w = await probe.createWritable();
    await w.write('ok');
    await w.close();
    // Clean up probe file
    try { await dir.removeEntry('_probe'); } catch { /* fine */ }
    _writableSupported = true;
    return true;
  } catch {
    _writableSupported = false;
    return false;
  }
}

/**
 * Write a JSON string to OPFS.
 * @param {string} filename - File name within the app directory (e.g. 'songs.json')
 * @param {string} jsonString - Serialized JSON data
 * @returns {Promise<boolean>} true if write succeeded
 */
async function writeData(filename, jsonString) {
  if (!(await _hasCreateWritable())) return false;
  const dir = await _getDir();
  if (!dir) return false;
  try {
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonString);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('OPFS write failed:', e.message);
    return false;
  }
}

/**
 * Read a JSON string from OPFS.
 * @param {string} filename
 * @returns {Promise<string|null>} Raw JSON string, or null if unavailable/missing
 */
async function readData(filename) {
  const dir = await _getDir();
  if (!dir) return null;
  try {
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const text = await file.text();
    // Sanity check: must be valid JSON
    if (!text || text[0] !== '[') return null;
    return text;
  } catch {
    return null; // File doesn't exist yet — expected
  }
}

/**
 * Check if OPFS + createWritable is available. Result is cached.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  return _hasCreateWritable();
}

/**
 * Clear all OPFS data (used during orchestra switch, logout, etc.).
 * @returns {Promise<void>}
 */
async function clearAll() {
  const dir = await _getDir();
  if (!dir) return;
  try {
    for await (const [name] of dir) {
      try { await dir.removeEntry(name); } catch { /* skip */ }
    }
  } catch { /* OPFS iteration not supported or empty — fine */ }
}

export { writeData, readData, isAvailable, clearAll };
