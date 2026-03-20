/**
 * mutation-queue.js — Offline Mutation Queue
 *
 * Queues failed write operations (POST/PUT/DELETE) to IDB when offline,
 * then flushes them in FIFO order when connectivity returns.
 *
 * Two queue types:
 * - Bulk saves (songs, setlists, practice, wikicharts): one-per-type in pendingWrites
 * - Discrete mutations (messages, settings, suggestions): FIFO in mutationQueue
 *
 * Flush triggers:
 * - `online` event
 * - `visibilitychange` (tab becomes visible while online)
 * - App init (leftover from crash/close)
 * - Background Sync API (if supported, even when app is closed)
 *
 * @module mutation-queue
 */

import * as IDB from '../idb.js?v=20.33';
import * as Auth from '../auth.js?v=20.33';
import { showToast } from './utils.js?v=20.33';

// ─── State ──────────────────────────────────────────────

let _flushing = false;
let _pendingCount = 0;
let _initialized = false;
let _workerUrl = '';  // Set by init()

// Max retries before dropping a discrete mutation
const MAX_RETRIES = 5;

// ─── Network detection ──────────────────────────────────

function isOffline() {
  return !navigator.onLine;
}

/**
 * Check if an error is a network failure (vs server error).
 * Network failures = TypeError from fetch() = request never reached server.
 */
function isNetworkError(err) {
  return err instanceof TypeError;
}

// ─── Badge UI ───────────────────────────────────────────

function _updateBadge() {
  const badge = document.getElementById('offline-queue-badge');
  if (!badge) return;
  if (_pendingCount > 0) {
    badge.textContent = _pendingCount > 99 ? '99+' : String(_pendingCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  // Offline indicator
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    indicator.classList.toggle('hidden', navigator.onLine);
  }
}

// ─── Bulk save queueing (one-per-type dedup) ────────────

/**
 * Queue a bulk data save for later sync.
 * Overwrites any previous pending save of the same type.
 * @param {'songs'|'setlists'|'practice'|'wikicharts'} type
 * @param {Array} data
 * @param {string[]} [deletions]
 */
async function enqueueBulkSave(type, data, deletions) {
  try {
    await IDB.savePendingWrite(type, { items: data, deletions: deletions || [] });
    await _refreshCount();
    _updateBadge();
    _registerBackgroundSync();
  } catch (e) {
    console.warn('Failed to queue bulk save:', e);
  }
}

// ─── Discrete mutation queueing (FIFO) ──────────────────

/**
 * Queue a discrete API mutation for later replay.
 * @param {string} path - API path (e.g. '/orchestras/x/messages')
 * @param {string} method - HTTP method
 * @param {Object} [body] - Request body (will be JSON stringified)
 * @returns {Promise<number>} Queue key
 */
async function enqueue(path, method, body) {
  try {
    const key = await IDB.enqueueMutation({
      path,
      method,
      body: body ? JSON.stringify(body) : null,
    });
    await _refreshCount();
    _updateBadge();
    _registerBackgroundSync();
    return key;
  } catch (e) {
    console.warn('Failed to queue mutation:', e);
    return -1;
  }
}

// ─── Flush logic ────────────────────────────────────────

/**
 * Flush all queued mutations to the server.
 * Processes bulk saves first (higher priority), then discrete mutations.
 * Stops on first network error (still offline).
 */
async function flush() {
  if (_flushing) return;
  if (isOffline()) return;
  if (!Auth.getToken?.()) return;

  _flushing = true;
  let flushedAny = false;

  try {
    // 1. Flush bulk saves (pendingWrites)
    const pendingWrites = await IDB.loadPendingWrites();
    for (const pw of pendingWrites) {
      try {
        await _rawWorkerFetch(`/data/${pw.type}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [_bodyKey(pw.type)]: pw.data.items, deletions: pw.data.deletions }),
        });
        await IDB.clearPendingWrite(pw.type);
        flushedAny = true;
      } catch (e) {
        if (isNetworkError(e)) break; // Still offline
        // Auth failure or "not initialized" — bail out entirely (don't drop data)
        if (!e.status || e.status === 401 || e.status === 429) break;
        // 5xx — retriable, keep in queue
        if (e.status >= 500) {
          console.warn(`Bulk save flush 5xx for ${pw.type}, will retry:`, e.message);
          continue;
        }
        // Permanent 4xx (400, 403, 404, 409) — drop this write, data is saved locally
        console.warn(`Bulk save flush failed for ${pw.type} (${e.status}):`, e.message);
        await IDB.clearPendingWrite(pw.type);
        flushedAny = true;
      }
    }

    // 2. Flush discrete mutations (mutationQueue — FIFO)
    const mutations = await IDB.getAllMutations();
    for (const m of mutations) {
      try {
        await _rawWorkerFetch(m.path, {
          method: m.method,
          headers: { 'Content-Type': 'application/json' },
          body: m.body,
        });
        await IDB.dequeueMutation(m.key);
        flushedAny = true;
      } catch (e) {
        if (isNetworkError(e)) break; // Still offline
        // Auth failure — bail out entirely (don't increment retries)
        if (!e.status || e.status === 401 || e.status === 429) break;
        // 5xx — retriable without counting against retry limit
        if (e.status >= 500) {
          console.warn(`Discrete mutation 5xx for ${m.path}, will retry`);
          continue;
        }
        // Permanent 4xx — increment retries, drop if exceeded
        const retries = (m.retries || 0) + 1;
        if (retries >= MAX_RETRIES) {
          console.warn(`Dropping mutation after ${MAX_RETRIES} retries:`, m.path);
          await IDB.dequeueMutation(m.key);
          flushedAny = true;
        } else {
          await IDB.updateMutation(m.key, { retries });
        }
      }
    }
  } catch (e) {
    console.warn('Mutation queue flush error:', e);
  } finally {
    _flushing = false;
    await _refreshCount();
    _updateBadge();
    if (flushedAny && _pendingCount === 0) {
      showToast('Offline changes synced.');
    }
  }
}

// ─── Raw fetch (bypasses queue, used by flush) ──────────

async function _rawWorkerFetch(path, options = {}) {
  if (!_workerUrl) throw new Error('MutationQueue not initialized');
  const token = Auth.getToken ? Auth.getToken() : null;
  if (!token) throw new Error('Not authenticated');
  const resp = await fetch(_workerUrl + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const err = new Error(data.error || `Request failed: ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

function _bodyKey(type) {
  return type === 'wikicharts' ? 'wikiCharts' : type;
}

// ─── Background Sync registration ──────────────────────

function _registerBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    if (reg.sync) {
      reg.sync.register('mutation-queue-flush').catch(() => {
        // Background Sync not supported — online event handles it
      });
    }
  }).catch(() => {});
}

// ─── Count helpers ──────────────────────────────────────

async function _refreshCount() {
  try {
    const bulkCount = (await IDB.loadPendingWrites()).length;
    const discreteCount = await IDB.countMutations();
    _pendingCount = bulkCount + discreteCount;
  } catch {
    _pendingCount = 0;
  }
}

/**
 * Get the current pending mutation count.
 * @returns {number}
 */
function getPendingCount() {
  return _pendingCount;
}

// ─── Initialization ─────────────────────────────────────

/**
 * Initialize the mutation queue.
 * @param {string} workerUrl - Base URL for the Cloudflare Worker
 */
async function init(workerUrl) {
  if (_initialized) return;
  _initialized = true;
  _workerUrl = workerUrl;

  // Load initial count
  await _refreshCount();
  _updateBadge();

  // Listen for online/offline events
  window.addEventListener('online', () => {
    _updateBadge();
    // Small delay to let network stabilize
    setTimeout(() => flush(), 1500);
  });

  window.addEventListener('offline', () => {
    _updateBadge();
  });

  // Flush on tab visibility (covers case where device reconnects while tab was hidden)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine && _pendingCount > 0) {
      flush();
    }
  });

  // Flush any leftovers from previous sessions
  if (navigator.onLine && _pendingCount > 0) {
    setTimeout(() => flush(), 3000);
  }

  // Listen for SW message to trigger flush (Background Sync)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'FLUSH_MUTATION_QUEUE') {
        flush();
      }
    });
  }
}

// ─── Public API ─────────────────────────────────────────

export { init, enqueue, enqueueBulkSave, flush, getPendingCount, isOffline, isNetworkError };
