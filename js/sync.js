/**
 * sync.js — Data load/save/sync layer
 *
 * Handles localStorage, IndexedDB, SW cache, and remote sync
 * (GitHub primary, Drive legacy fallback).
 * State lives in Store; re-renders via Router.
 */

import * as Store from './store.js';
import { showToast, isMobile, timeAgo, isHybridKey } from './utils.js';
import * as GitHub from '../github.js';
import * as Drive from '../drive.js';
import * as Router from './router.js';
import * as IDB from '../idb.js';
import * as Auth from '../auth.js';
import * as Admin from '../admin.js';

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
  try { return migrateSchema(JSON.parse(localStorage.getItem('ct_songs') || '[]'), 'songs'); }
  catch { return []; }
}

async function _saveLocal(songs) {
  // IDB first (primary), localStorage as fallback mirror
  if (IDB.isAvailable()) {
    try { await IDB.saveSongs(songs); }
    catch (e) { console.warn('IDB save songs failed', e); }
  }
  try { localStorage.setItem('ct_songs', JSON.stringify(songs)); }
  catch (e) { console.warn('localStorage save failed (songs)', e); showToast('Storage full — data may not persist.'); }
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
  }
}

// ─── Setlists: local storage helpers ───────────────────────

function _loadSetlistsLocal() {
  try { return migrateSchema(JSON.parse(localStorage.getItem('ct_setlists') || '[]'), 'setlists'); }
  catch { return []; }
}

async function _saveSetlistsLocal(setlists) {
  // IDB first (primary), localStorage as fallback mirror
  if (IDB.isAvailable()) {
    try { await IDB.saveSetlists(setlists); }
    catch (e) { console.warn('IDB save setlists failed', e); }
  }
  try { localStorage.setItem('ct_setlists', JSON.stringify(setlists)); }
  catch (e) { console.warn('localStorage save failed (setlists)', e); showToast('Storage full — data may not persist.'); }
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
  }
}

// ─── Practice: local storage helpers ───────────────────────

function _loadPracticeLocal() {
  try { return migrateSchema(JSON.parse(localStorage.getItem('ct_practice') || '[]'), 'practice'); }
  catch { return []; }
}

async function _savePracticeLocal(data) {
  // IDB first (primary), localStorage as fallback mirror
  if (IDB.isAvailable()) {
    try { await IDB.savePractice(data); }
    catch (e) { console.warn('IDB save practice failed', e); }
  }
  try { localStorage.setItem('ct_practice', JSON.stringify(data)); }
  catch (e) { console.warn('localStorage save failed (practice)', e); showToast('Storage full — data may not persist.'); }
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
  if (Store.get('autoConfigAttempted')) return;
  Store.set('autoConfigAttempted', true);
  // When Worker proxy is active, GitHub is always configured server-side
  if (GitHub.useWorker) return;
  try {
    const pat = await GitHub.loadPublishedPat();
    if (!pat) return;
    GitHub.saveConfig({ pat, owner: '', repo: '' });
    console.info('GitHub auto-configured from Drive');
    showToast('Sync connected.');
    syncAll(true);
  } catch (e) {
    console.warn('GitHub auto-detect failed:', e);
  }
}

// ─── Main sync orchestrator ────────────────────────────────

async function syncAll(force) {
  const _useGitHub = GitHub.isConfigured();
  const _mobile = isMobile();
  if (!_useGitHub && _mobile) { _syncDone(); return; }
  if (!_useGitHub && !Drive.isConfigured()) { _syncDone(); return; }
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
    const remoteData = _useGitHub
      ? await GitHub.loadAllData()
      : await Drive.loadAllData();
    Store.set('lastDriveSnapshot', remoteData);
    const { songs, setlists, practice } = remoteData;
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
    const lastSync = parseInt(localStorage.getItem('ct_last_synced') || '0', 10);
    const cachedLine = lastSync
      ? 'Using cached data. Last synced ' + timeAgo(lastSync) + '.'
      : 'Using cached data.';
    if (msg.includes('403') || msg.includes('429') || msg.includes('rate')) {
      showToast(`Temporary rate-limiting (${backend}).<br>${cachedLine}`, 10000);
    } else if (msg.includes('Decryption failed')) {
      showToast('Decryption failed.<br>PAT may have changed.', 10000);
    } else {
      showToast(`Sync failed.<br>${cachedLine}`, 10000);
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
  }
}

async function doSyncRefresh(afterCallback) {
  showToast(GitHub.isConfigured() ? 'Syncing from GitHub…' : 'Syncing from Drive…');
  await syncAll(true);
  showToast('Sync complete.');
  if (afterCallback) afterCallback();
}

// ─── Save functions ────────────────────────────────────────

async function saveSongs(toastMsg) {
  const songs = Store.get('songs');
  _saveLocal(songs);
  if (GitHub.isConfigured()) {
    GitHub.saveSongs(songs).then(() => _markSynced()).catch(() => {});
    showToast(toastMsg || 'Saved. Syncing to GitHub…');
    return;
  }
  if (!isMobile() && Drive.isWriteConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Drive.saveSongs(songs);
        _markSynced();
        showToast(toastMsg || 'Saved.');
        return;
      } catch (e) {
        console.error(`Drive songs save attempt ${attempt + 1} failed`, e);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
    showToast((toastMsg || 'Saved') + ' — Drive sync failed, will retry on next save.');
  } else {
    showToast((toastMsg || 'Saved') + ' (local only — configure GitHub in Admin Dashboard to sync)');
  }
}

async function saveSetlists(toastMsg) {
  const setlists = Store.get('setlists');
  _saveSetlistsLocal(setlists);
  if (GitHub.isConfigured()) {
    GitHub.saveSetlists(setlists).then(() => _markSynced()).catch(() => {});
    showToast(toastMsg || 'Saved. Syncing to GitHub…');
    return;
  }
  if (!isMobile() && Drive.isWriteConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Drive.saveSetlists(setlists);
        _markSynced();
        showToast(toastMsg || 'Saved.');
        return;
      } catch (e) {
        console.error(`Drive setlists save attempt ${attempt + 1} failed`, e);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
    showToast((toastMsg || 'Saved') + ' — Drive sync failed, will retry on next save.');
  } else {
    showToast((toastMsg || 'Saved') + ' (local only — configure GitHub in Admin Dashboard to sync)');
  }
}

async function savePractice(toastMsg) {
  const practice = Store.get('practice');
  _savePracticeLocal(practice);
  if (GitHub.isConfigured()) {
    GitHub.savePractice(practice).then(() => _markSynced()).catch(() => {});
    showToast(toastMsg || 'Saved. Syncing to GitHub…');
    return;
  }
  if (!isMobile() && Drive.isWriteConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Drive.savePractice(practice);
        _markSynced();
        showToast(toastMsg || 'Saved.');
        return;
      } catch (e) {
        console.error(`Drive practice save attempt ${attempt + 1} failed`, e);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }
    showToast((toastMsg || 'Saved') + ' — Drive sync failed, will retry on next save.');
  } else {
    showToast((toastMsg || 'Saved') + ' (local only — configure GitHub in Admin Dashboard to sync)');
  }
}

// ─── Expose internal helpers for backward compat ───────────

export { migrateSchema, loadSongsInstant, loadSetlistsInstant, loadPracticeInstant, migratePracticeData, syncAll, doSyncRefresh, tryAutoConfigureGitHub, saveSongs, saveSetlists, savePractice };
export { _saveLocal as saveLocal, _saveSetlistsLocal as saveSetlistsLocal, _savePracticeLocal as savePracticeLocal };
