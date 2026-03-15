/**
 * app.js — Main application logic
 */

const App = (() => {

  const APP_VERSION = 'v17.85';

  let _songs      = [];
  let _setlists   = [];
  let _view       = 'list';
  let _activeSong = null;
  let _editSong   = null;
  let _editIsNew  = false;
  let _searchText = '';
  let _activeTags = [];  // Array of selected tag names, pinned order
  let _activeKeys = [];  // Array of selected key names for key filtering
  let _blobCache  = {};
  let _playerRefs = [];
  let _navStack   = [];
  let _activeSetlist = null;
  let _editSetlist   = null;
  let _editSetlistIsNew = false;
  let _savingSongs = false;
  let _savingSetlists = false;
  let _savingPractice = false;
  let _cachedPdfSet = new Set();

  // ─── Batch selection mode ──────────────────────────────────
  let _selectionMode = false;
  let _selectedSongIds = new Set();

  // ─── Utility ──────────────────────────────────────────────

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function _timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ─── Haptic feedback ─────────────────────────────────────
  // Gracefully degrades on iOS / unsupported browsers (no-op)
  const _canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  function haptic(pattern) {
    if (_canVibrate) try { navigator.vibrate(pattern); } catch (_) {}
  }
  haptic.tap       = () => haptic(8);        // light tap — card press, toggle
  haptic.light     = () => haptic(10);       // drag pickup, swipe snap
  haptic.medium    = () => haptic(25);       // edge bounce, threshold reached
  haptic.heavy     = () => haptic(50);       // destructive action confirm
  haptic.double    = () => haptic([12, 30, 12]); // mode change, refresh trigger
  haptic.success   = () => haptic([10, 40, 15]); // save complete, action done

  function _gradientText(str, from, to) {
    const chars = str.split('');
    const visible = chars.filter(c => c !== ' ');
    let vi = 0;
    return chars.map(c => {
      if (c === ' ') return ' ';
      const t = visible.length > 1 ? vi / (visible.length - 1) : 0;
      vi++;
      const r = Math.round(from[0] + (to[0] - from[0]) * t);
      const g = Math.round(from[1] + (to[1] - from[1]) * t);
      const b = Math.round(from[2] + (to[2] - from[2]) * t);
      return `<span style="color:rgb(${r},${g},${b})">${esc(c)}</span>`;
    }).join('');
  }

  function highlight(text, query) {
    if (!query) return esc(text);
    const escaped = esc(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(`(${q})`, 'gi'), '<mark class="search-hi">$1</mark>');
  }

  // ─── Ordered charts helper ────────────────────────────────

  function _getOrderedCharts(song) {
    const charts = song.assets?.charts || [];
    if (!charts.length) return [];
    // Migration: convert legacy primaryChartId to chartOrder
    if (song.primaryChartId && !song.chartOrder) {
      song.chartOrder = [{ driveId: song.primaryChartId, order: 1 }];
      delete song.primaryChartId;
    }
    const order = song.chartOrder || [];
    if (!order.length) return [charts[0]]; // fallback: first chart only
    // Return charts in order, only those that still exist
    return order
      .sort((a, b) => a.order - b.order)
      .map(o => charts.find(c => c.driveId === o.driveId))
      .filter(Boolean);
  }

  function _getChartOrderNum(song, driveId) {
    const order = song.chartOrder || [];
    const entry = order.find(o => o.driveId === driveId);
    return entry ? entry.order : 0;
  }

  // ─── Duplicate detection helpers ──────────────────────────

  let _levWorker = null;
  try { _levWorker = new Worker('levenshtein-worker.js'); } catch (_) {}

  function _findSimilarSongsAsync(title, excludeId) {
    if (!title) return Promise.resolve([]);
    if (!_levWorker) return Promise.resolve(_findSimilarSongsSync(title, excludeId));
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(_findSimilarSongsSync(title, excludeId)), 2000);
      _levWorker.onmessage = (e) => { clearTimeout(timeout); resolve(e.data.similar); };
      _levWorker.postMessage({
        title,
        excludeId,
        songs: _songs.map(s => ({ id: s.id, title: s.title })),
      });
    });
  }

  function _findSimilarSongsSync(title, excludeId) {
    if (!title) return [];
    const norm = title.trim().toLowerCase();
    return _songs.filter(s => {
      if (s.id === excludeId) return false;
      const other = (s.title || '').trim().toLowerCase();
      if (!other) return false;
      if (norm === other) return true;
      if (norm.length >= 4 && other.length >= 4 && Math.abs(norm.length - other.length) <= 3) {
        return _levenshtein(norm, other) <= 2;
      }
      return false;
    });
  }

  function _levenshtein(a, b) {
    const la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    const dp = Array.from({ length: la + 1 }, (_, i) => i);
    for (let j = 1; j <= lb; j++) {
      let prev = dp[0];
      dp[0] = j;
      for (let i = 1; i <= la; i++) {
        const tmp = dp[i];
        dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
        prev = tmp;
      }
    }
    return dp[la];
  }

  // ─── Toast ─────────────────────────────────────────────────

  let _toastTimer = null;
  function showToast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    if (!el) return;
    haptic.tap();
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 200);
    }, duration);
  }

  function _fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Setlist copied!');
    } catch (_) {
      showToast('Copy failed \u2014 try manually.');
    }
    document.body.removeChild(ta);
  }

  // ─── Blob cache ───────────────────────────────────────────

  function _revokeBlobCache() {
    Object.values(_blobCache).forEach(u => URL.revokeObjectURL(u));
    _blobCache = {};
    _playerRefs.forEach(p => { try { p.destroy(); } catch(e) {} });
    _playerRefs = [];
    Player.stopAll();
  }

  async function _getBlobUrl(driveId) {
    if (_blobCache[driveId]) return _blobCache[driveId];

    // Try PDF cache from service worker first
    const cachedBlob = await _getCachedPdfBlob(driveId);
    if (cachedBlob) {
      const url = URL.createObjectURL(cachedBlob);
      _blobCache[driveId] = url;
      return url;
    }

    // Fetch from Drive
    const url = await Drive.fetchFileAsBlob(driveId);
    _blobCache[driveId] = url;

    // Cache the PDF blob in the service worker (fire and forget)
    _cachePdfBlob(driveId, url);

    return url;
  }

  /**
   * Send a blob URL's data to the SW for offline PDF caching.
   */
  async function _cachePdfBlob(driveId, blobUrl) {
    try {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_PDF', driveId, blob,
      });
      _cachedPdfSet.add(driveId);
      // Update any visible badges for this driveId
      document.querySelectorAll(`.pdf-cached-badge[data-cache-id="${driveId}"]`).forEach(el => {
        el.classList.add('cached');
      });
    } catch (err) {
      console.warn('PDF cache send failed:', err);
    }
  }

  /**
   * Retrieve a cached PDF blob from the service worker.
   */
  function _getCachedPdfBlob(driveId) {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return resolve(null);
      const handler = (e) => {
        if (e.data && e.data.type === 'CACHED_PDF' && e.data.driveId === driveId) {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', handler);
          resolve(e.data.blob || null);
        }
      };
      const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', handler); resolve(null); }, 1000);
      navigator.serviceWorker.addEventListener('message', handler);
      navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_PDF', driveId });
    });
  }

  /**
   * Fetch the list of cached PDF driveIds from the SW and populate the local Set.
   */
  function _loadCachedPdfList() {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return resolve();
      const handler = (e) => {
        if (e.data && e.data.type === 'CACHED_PDF_LIST') {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', handler);
          _cachedPdfSet = new Set(e.data.driveIds || []);
          resolve();
        }
      };
      const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', handler); resolve(); }, 1000);
      navigator.serviceWorker.addEventListener('message', handler);
      navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_PDF_LIST' });
    });
  }

  /**
   * Check if a PDF is cached for offline access.
   */
  function _isPdfCached(driveId) {
    return _cachedPdfSet.has(driveId);
  }

  // ─── Download helper ────────────────────────────────────

  function _isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  async function _downloadFile(driveId, filename, btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="dl-spinner"></span>';

    try {
      if (!driveId) throw new Error('No file ID');
      if (_isIOS()) {
        // Use direct Drive URL on iOS — blob URLs don't work reliably
        const url = Drive.getDirectUrl(driveId);
        if (!url) throw new Error('No download URL');
        const w = window.open(url, '_blank');
        if (!w) showToast('Popup blocked — allow popups for this site');
        else showToast('Tap and hold to save');
      } else {
        const url = await _getBlobUrl(driveId);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      btnEl.innerHTML = '<i data-lucide="check" class="dl-icon"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btnEl] });
      setTimeout(() => {
        btnEl.innerHTML = '<i data-lucide="download" class="dl-icon"></i><span class="dl-spinner hidden"></span>';
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btnEl] });
        btnEl.disabled = false;
      }, 1500);
    } catch (e) {
      btnEl.innerHTML = '<i data-lucide="x" class="dl-icon"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btnEl] });
      showToast('Download failed');
      setTimeout(() => {
        btnEl.innerHTML = '<i data-lucide="download" class="dl-icon"></i><span class="dl-spinner hidden"></span>';
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btnEl] });
        btnEl.disabled = false;
      }, 1500);
    }
  }

  // ─── Data ──────────────────────────────────────────────────

  const DATA_SCHEMA_VERSION = 1;

  function _migrateSchema(data, type) {
    const ver = parseInt(localStorage.getItem(`bb_schema_${type}`) || '0', 10);
    if (ver >= DATA_SCHEMA_VERSION) return data;
    // Future migrations go here as switch cases:
    // if (ver < 2) { data.forEach(item => { ... }); }
    try { localStorage.setItem(`bb_schema_${type}`, String(DATA_SCHEMA_VERSION)); } catch (_) {}
    return data;
  }

  function _loadLocal() {
    try { return _migrateSchema(JSON.parse(localStorage.getItem('bb_songs') || '[]'), 'songs'); }
    catch { return []; }
  }

  function _saveLocal(songs) {
    try { localStorage.setItem('bb_songs', JSON.stringify(songs)); }
    catch (e) { console.warn('localStorage save failed (songs)', e); showToast('Storage full — data may not persist.'); }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_SONGS', songs,
      });
    }
  }

  /**
   * Load from service worker cache (fallback if localStorage is empty).
   * Returns a promise that resolves with songs array or null.
   */
  function _loadFromSWCache() {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
        return resolve(null);
      }
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

  /**
   * Load songs instantly: try localStorage first, then SW cache fallback.
   */
  async function loadSongsInstant() {
    const local = _loadLocal();
    if (local.length > 0) {
      _songs = local;
      return;
    }
    // localStorage empty — try service worker cache
    const swSongs = await _loadFromSWCache();
    if (swSongs && swSongs.length > 0) {
      _songs = swSongs;
      _saveLocal(swSongs); // repopulate localStorage
    }
  }

  const SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

  function _shouldSync() {
    const last = parseInt(localStorage.getItem('bb_last_sync') || '0', 10);
    return Date.now() - last > SYNC_COOLDOWN_MS;
  }

  function _markSynced() {
    localStorage.setItem('bb_last_sync', String(Date.now()));
  }

  let _syncing = false;
  let _lastDriveSnapshot = null; // cached Drive data from last sync
  const MANUAL_SYNC_COOLDOWN_MS = 10 * 1000; // 10 seconds per 2 clicks
  let _manualSyncHistory = []; // timestamps of recent manual syncs

  /**
   * Silently auto-configure GitHub from encrypted PAT stored on Drive.
   * No user interaction needed — loads PAT, configures GitHub, triggers sync.
   */
  let _autoConfigAttempted = false;
  async function _tryAutoConfigureGitHub() {
    if (_autoConfigAttempted) return;
    _autoConfigAttempted = true;
    try {
      const pat = await GitHub.loadPublishedPat();
      if (!pat) return; // No published PAT found — manual setup needed
      GitHub.saveConfig({ pat, owner: '', repo: '' }); // owner/repo use defaults
      console.info('GitHub auto-configured from Drive');
      showToast('Sync connected.');
      _syncAllFromDrive(true); // Trigger immediate sync
    } catch (e) {
      console.warn('GitHub auto-detect failed:', e);
    }
  }

  async function _syncAllFromDrive(force) {
    // GitHub is the primary metadata backend when configured — no migration flag needed.
    // Drive is ONLY used for metadata sync on desktop when GitHub is NOT configured (legacy/pre-migration).
    // Mobile NEVER reads metadata from Drive (avoids stale data overwriting local edits).
    const _useGitHub = GitHub.isConfigured();
    const _mobile = _isMobile();
    if (!_useGitHub && _mobile) {
      // Mobile without GitHub: use local cache only, never Drive for metadata
      _syncDone();
      return;
    }
    if (!_useGitHub && !Drive.isConfigured()) {
      _syncDone();
      return;
    }
    if (_syncing) return; // already syncing, ignore
    // Skip sync if GitHub has pending writes (avoid overwriting in-flight edits)
    if (_useGitHub && GitHub.getWriteQueueStatus().hasPending && !force) {
      _syncDone();
      return;
    }
    // Always sync on first load (no snapshot yet), respect cooldown otherwise
    if (!force && _lastDriveSnapshot && !_shouldSync()) {
      _syncDone();
      return;
    }
    if (force) {
      const now = Date.now();
      _manualSyncHistory = _manualSyncHistory.filter(t => now - t < MANUAL_SYNC_COOLDOWN_MS);
      if (_manualSyncHistory.length >= 2) {
        showToast('Please wait a moment before refreshing again.');
        _syncDone();
        return;
      }
      _manualSyncHistory.push(now);
    }
    _syncing = true;
    const indicator = document.getElementById('sync-indicator');
    if (indicator) indicator.classList.remove('hidden');
    try {
      const remoteData = _useGitHub
        ? await GitHub.loadAllData()
        : await Drive.loadAllData();
      _lastDriveSnapshot = remoteData; // cache for dashboard diagnostic
      const { songs, setlists, practice } = remoteData;
      let dataChanged = false;
      if (songs !== null) {
        if (JSON.stringify(songs) !== JSON.stringify(_songs)) dataChanged = true;
        _songs = songs;
        _saveLocal(songs);
        // Prune stale or hybrid key filters
        if (_activeKeys.length) {
          const validKeys = new Set(_songs.map(s => (s.key || '').trim()).filter(k => k && !_isHybridKey(k)));
          _activeKeys = _activeKeys.filter(k => validKeys.has(k));
        }
      }
      if (setlists !== null) {
        if (JSON.stringify(setlists) !== JSON.stringify(_setlists)) dataChanged = true;
        _setlists = setlists;
        _saveSetlistsLocal(setlists);
      }
      if (practice !== null) {
        if (JSON.stringify(practice) !== JSON.stringify(_practice)) dataChanged = true;
        _practice = practice;
        _migratePracticeData();
        _savePracticeLocal(_practice);
      }
      // Auto-detect migration: if GitHub returned data, flag this device as migrated
      if (_useGitHub && (songs !== null || setlists !== null || practice !== null)) {
        if (localStorage.getItem('bb_migrated_to_github') !== '1') {
          localStorage.setItem('bb_migrated_to_github', '1');
        }
      }
      // Re-render whatever view the user is currently on
      if (dataChanged) {
        if (_view === 'list')              renderList();
        else if (_view === 'detail' && _activeSong) {
          _activeSong = _songs.find(s => s.id === _activeSong.id) || _activeSong;
          renderDetail(_activeSong, true);
        }
        else if (_view === 'setlists')     renderSetlists(true);
        else if (_view === 'setlist-detail' && _activeSetlist) {
          _activeSetlist = _setlists.find(s => s.id === _activeSetlist.id) || _activeSetlist;
          renderSetlistDetail(_activeSetlist, true);
        }
        else if (_view === 'practice')     renderPractice(true);
        else if (_view === 'practice-detail' && _activePersona) {
          _activePersona = _practice.find(p => p.id === _activePersona.id) || _activePersona;
          renderPracticeDetail(_activePersona, true);
        }
        else if (_view === 'dashboard')    renderDashboard();
      }
      _markSynced();
    } catch (e) {
      const backend = _useGitHub ? 'GitHub' : 'Drive';
      console.warn(`${backend} sync failed, using local cache`, e);
      const msg = String(e.message || e || '');
      if (msg.includes('403') || msg.includes('429') || msg.includes('rate')) {
        showToast(`${backend} is temporarily rate-limited. Using cached data.`, 4000);
      } else if (msg.includes('timed out')) {
        showToast(`${backend} request timed out. Using cached data.`, 4000);
      } else if (msg.includes('Decryption failed')) {
        showToast('Decryption failed — PAT may have changed.', 5000);
      }
    } finally {
      _syncing = false;
      if (indicator) indicator.classList.add('hidden');
      _syncDone();
    }
  }

  function _syncDone() {
    if (_songs.length === 0) {
      const t = document.getElementById('empty-title');
      const s = document.getElementById('empty-sub');
      if (t) t.textContent = 'No songs yet.';
      if (s) s.textContent = '';
    }
  }

  /** Lightweight sync + re-render for non-main-page views */
  async function _doSyncRefresh(afterCallback) {
    showToast(GitHub.isConfigured() ? 'Syncing from GitHub…' : 'Syncing from Drive…');
    await _syncAllFromDrive(true);
    showToast('Sync complete.');
    if (afterCallback) afterCallback();
  }

  async function saveSongs(toastMsg) {
    _saveLocal(_songs);
    if (GitHub.isConfigured()) {
      GitHub.saveSongs(_songs); // queued, non-blocking
      showToast(toastMsg || 'Saved. Syncing to GitHub…');
      _markSynced();
      return;
    }
    // Drive metadata saves: desktop-only, pre-migration only
    if (!_isMobile() && Drive.isWriteConfigured()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await Drive.saveSongs(_songs);
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

  // ─── Setlists data ─────────────────────────────────────

  function _loadSetlistsLocal() {
    try { return _migrateSchema(JSON.parse(localStorage.getItem('bb_setlists') || '[]'), 'setlists'); }
    catch { return []; }
  }

  function _saveSetlistsLocal(setlists) {
    try { localStorage.setItem('bb_setlists', JSON.stringify(setlists)); }
    catch (e) { console.warn('localStorage save failed (setlists)', e); showToast('Storage full — data may not persist.'); }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_SETLISTS', setlists,
      });
    }
  }

  function _loadSetlistsFromSWCache() {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
        return resolve(null);
      }
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
    const local = _loadSetlistsLocal();
    if (local.length > 0) {
      _setlists = local;
      return;
    }
    const swSetlists = await _loadSetlistsFromSWCache();
    if (swSetlists && swSetlists.length > 0) {
      _setlists = swSetlists;
      _saveSetlistsLocal(swSetlists);
    }
  }

  async function saveSetlists(toastMsg) {
    _saveSetlistsLocal(_setlists);
    if (GitHub.isConfigured()) {
      GitHub.saveSetlists(_setlists);
      showToast(toastMsg || 'Saved. Syncing to GitHub…');
      _markSynced();
      return;
    }
    // Drive metadata saves: desktop-only, pre-migration only
    if (!_isMobile() && Drive.isWriteConfigured()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await Drive.saveSetlists(_setlists);
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

  // ─── View management & nav stack ─────────────────────────

  function _showView(name) {
    const swap = () => {
      document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.removeAttribute('aria-current');
      });
      const el = document.getElementById(`view-${name}`);
      if (el) { el.classList.add('active'); el.scrollTop = 0; el.setAttribute('aria-current', 'page'); }
      _view = name;
    };
    if (document.startViewTransition) {
      try { document.startViewTransition(swap); } catch (_) { swap(); }
    } else {
      swap();
    }
  }

  function _setTopbar(title, showBack, isHtml, isHome) {
    const el = document.getElementById('topbar-title');
    if (el) {
      if (isHtml) el.innerHTML = title; else el.textContent = title;
      el.classList.toggle('title-home', !!isHome);
    }
    document.getElementById('btn-back')?.classList.toggle('hidden', !showBack);
    document.getElementById('btn-setlists')?.classList.toggle('hidden', showBack);
    document.getElementById('btn-practice')?.classList.toggle('hidden', showBack);
    // Version badge visible on home page for all users
    const vBadge = document.getElementById('admin-version-badge');
    if (vBadge) vBadge.classList.toggle('hidden', !isHome);
  }

  function _pushNav(renderFn) {
    _navStack.push(renderFn);
  }

  function _navigateBack() {
    Player.stopAll();
    // Clean up live mode if active
    if (_liveModeActive && _exitLiveModeRef) { _exitLiveModeRef(); return; }
    document.body.classList.remove('live-mode-active');
    // Always clear practice mode body class when navigating away
    document.body.classList.remove('practice-mode-active');
    if (_navStack.length > 0) {
      const prev = _navStack.pop();
      if (typeof prev === 'function') prev();
      else renderList();
    } else {
      renderList();
    }
  }

  // ─── LIST VIEW ─────────────────────────────────────────────

  function _allTags() {
    const counts = {};
    _songs.forEach(s => (s.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }

  function _isHybridKey(k) {
    if (k.includes('/')) return true;
    const low = k.toLowerCase();
    return low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed';
  }

  function _allKeys() {
    const counts = {};
    _songs.forEach(s => {
      const k = (s.key || '').trim();
      if (k && !_isHybridKey(k)) counts[k] = (counts[k] || 0) + 1;
    });
    // Sort by usage count (most used first), like tags
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  }

  function _filteredSongs() {
    let list = [..._songs].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (_activeTags.length) list = list.filter(s => _activeTags.every(t => (s.tags || []).includes(t)));
    if (_activeKeys.length) list = list.filter(s => s.key && _activeKeys.includes(s.key.trim()));
    if (_searchText) {
      const q = _searchText.toLowerCase();
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.subtitle || '').toLowerCase().includes(q) ||
        (s.key || '').toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (s.notes || '').toLowerCase().includes(q)
      );
    }
    return list;
  }

  function renderList() {
    _revokeBlobCache();
    // If not explicitly in selection mode re-render, clear selection state
    if (!_selectionMode) { _selectedSongIds = new Set(); _removeSelectionBar(); }
    _navStack = [];
    _showView('list');
    // Two-line title: CATMAN gradient 1→6, TRIO gradient matching positions 2→5
    const catmanGrad = _gradientText('Catman', [215,175,90], [240,220,165]);
    const trioGrad   = _gradientText('Trio', [220,184,105], [235,211,150]);
    _setTopbar(
      `<span class="title-catman">${catmanGrad}</span><span class="title-trio">${trioGrad}</span>`,
      false, true, true
    );
    // Sync admin bar button state
    const addBtn = document.getElementById('btn-add-song');
    if (addBtn) addBtn.classList.toggle('hidden', !Admin.isEditMode());

    const tagBar = document.getElementById('tag-filter-bar');
    const allTags = _allTags();
    // Pin selected tags to the left in selection order, then unselected
    const pinned = _activeTags.filter(t => allTags.includes(t));
    const unpinned = allTags.filter(t => !_activeTags.includes(t));
    const orderedTags = [...pinned, ...unpinned];
    tagBar.innerHTML = orderedTags.map(t =>
      `<button class="tag-filter-chip ${_activeTags.includes(t) ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`
    ).join('');
    tagBar.querySelectorAll('.tag-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        const idx = _activeTags.indexOf(tag);
        if (idx > -1) _activeTags.splice(idx, 1);
        else _activeTags.push(tag);
        renderList();
      });
    });

    // Key filter chips
    const allKeys = _allKeys();
    if (allKeys.length > 0) {
      let keyBar = document.getElementById('key-filter-bar');
      if (!keyBar) {
        keyBar = document.createElement('div');
        keyBar.id = 'key-filter-bar';
        keyBar.className = 'key-filter-bar';
        tagBar.parentNode.insertBefore(keyBar, tagBar.nextSibling);
      }
      // Keep stable sort order (by usage count) — don't reorder on selection
      // to prevent the multi-select glitch where pills shift under the user's finger
      keyBar.innerHTML = allKeys.map(k =>
        `<button class="kf-chip ${_activeKeys.includes(k) ? 'active' : ''}" data-key="${esc(k)}">${esc(k)}</button>`
      ).join('');
      keyBar.querySelectorAll('.kf-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const idx = _activeKeys.indexOf(key);
          if (idx > -1) _activeKeys.splice(idx, 1);
          else _activeKeys.push(key);
          renderList();
        });
      });
    } else {
      const existing = document.getElementById('key-filter-bar');
      if (existing) existing.remove();
    }

    const container = document.getElementById('song-list');
    const empty     = document.getElementById('list-empty');
    const noResults = document.getElementById('list-no-results');
    const filtered  = _filteredSongs();

    container.innerHTML = '';
    empty.classList.add('hidden');
    noResults.classList.add('hidden');

    if (_songs.length === 0)   { empty.classList.remove('hidden');     return; }
    if (filtered.length === 0) { noResults.classList.remove('hidden'); return; }

    filtered.forEach((song, i) => {
      const card = document.createElement('div');
      card.className  = 'song-card' + (_selectionMode && _selectedSongIds.has(song.id) ? ' song-card-selected' : '');
      card.dataset.songId = song.id;
      card.style.animationDelay = `${i * 30}ms`;
      card.innerHTML  = (_selectionMode ? _selectionCheckboxHTML(song.id) : '') + _songCardHTML(song);

      if (_selectionMode) {
        card.addEventListener('click', () => {
          haptic.tap();
          _toggleSongSelection(song.id, card);
        });
      } else {
        card.addEventListener('click', () => { haptic.tap(); renderDetail(song); });
        if (Admin.isEditMode()) {
          let lpTimer = null;
          card.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            lpTimer = setTimeout(() => { lpTimer = null; e.preventDefault(); _enterSelectionMode(song.id); }, 500);
          });
          const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
          card.addEventListener('pointerup', cancelLp);
          card.addEventListener('pointercancel', cancelLp);
          card.addEventListener('pointermove', (e) => { if (lpTimer && (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5)) cancelLp(); });
          card.addEventListener('contextmenu', (e) => e.preventDefault());
        }
      }
      if (!_selectionMode && Admin.isEditMode()) {
        card.querySelector('.song-card-edit-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          renderEdit(song, false);
        });
      }
      container.appendChild(card);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
    if (_selectionMode) {
      _showSelectionBar();
      // Ensure back-button can exit selection mode after any re-render
      if (!_navStack.length) _navStack.push(function() { _exitSelectionMode(); });
    } else {
      _removeSelectionBar();
    }
  }

  function _songCardHTML(song) {
    const a = song.assets || {};
    const charts = (a.charts || []).length;
    const audio  = (a.audio  || []).length;
    const links  = (a.links  || []).length;
    const q = _searchText || '';

    const pills = [
      charts ? `<span class="asset-pill chart">${charts} chart${charts !== 1 ? 's' : ''}</span>` : '',
      audio  ? `<span class="asset-pill audio">${audio} demo${audio !== 1 ? 's' : ''}</span>`    : '',
      links  ? `<span class="asset-pill links">${links} link${links !== 1 ? 's' : ''}</span>`    : '',
    ].filter(Boolean).join('');

    const tagHtml = (song.tags || []).map(t => `<span class="song-tag">${highlight(t, q)}</span>`).join('');
    const bpmStr = song.bpm ? `${highlight(String(song.bpm), q)} bpm${song.timeSig ? ' (' + highlight(song.timeSig, q) + ')' : ''}` : '';
    const bpmHtml = bpmStr ? `<span class="song-card-bpm">${bpmStr}</span>` : '';

    const editIcon = Admin.isEditMode() ? '<button class="song-card-edit-btn"><i data-lucide="pencil"></i></button>' : '';

    return `
      <div class="song-card-title-row"><span class="song-card-title">${highlight(song.title, q) || '<em style="color:var(--text-3)">Untitled</em>'}</span>${editIcon}</div>
      <span class="song-card-subtitle">${highlight(song.subtitle, q)}</span>
      <div class="song-card-meta">
        <span class="song-card-key">${highlight(song.key, q)}</span>
        ${bpmHtml}
      </div>
      <div class="song-card-footer">
        <div class="asset-pills">${pills}</div>
        <div class="song-tags">${tagHtml}</div>
      </div>`;
  }

  // ─── BATCH SELECTION MODE ──────────────────────────────────

  function _selectionCheckboxHTML(songId) {
    const checked = _selectedSongIds.has(songId);
    return '<div class="sel-checkbox ' + (checked ? 'sel-checked' : '') + '">' + (checked ? '<i data-lucide="check"></i>' : '') + '</div>';
  }

  function _enterSelectionMode(firstSongId) {
    if (_selectionMode) return;
    _selectionMode = true;
    _selectedSongIds = new Set([firstSongId]);
    haptic.medium();
    renderList();
    // Push after renderList (which clears _navStack) so back-button exits selection
    _navStack.push(function() { _exitSelectionMode(); });
  }

  function _exitSelectionMode() {
    if (!_selectionMode) return;
    _selectionMode = false;
    _selectedSongIds = new Set();
    _removeSelectionBar();
    renderList();
  }

  function _toggleSongSelection(songId, card) {
    if (_selectedSongIds.has(songId)) {
      _selectedSongIds.delete(songId);
      card.classList.remove('song-card-selected');
      var cb = card.querySelector('.sel-checkbox');
      if (cb) { cb.classList.remove('sel-checked'); cb.innerHTML = ''; }
    } else {
      _selectedSongIds.add(songId);
      card.classList.add('song-card-selected');
      var cb2 = card.querySelector('.sel-checkbox');
      if (cb2) { cb2.classList.add('sel-checked'); cb2.innerHTML = '<i data-lucide="check"></i>'; }
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [card] });
    }
    _updateSelectionCount();
  }

  function _showSelectionBar() {
    _removeSelectionBar();
    var bar = document.createElement('div');
    bar.id = 'batch-selection-bar';
    bar.className = 'batch-selection-bar';
    bar.innerHTML = '<span class="batch-sel-count">' + _selectedSongIds.size + ' selected</span>' +
      '<button class="batch-sel-add-btn">Add to Setlist</button>' +
      '<button class="batch-sel-cancel" aria-label="Cancel selection"><i data-lucide="x"></i></button>';
    document.body.appendChild(bar);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bar] });
    bar.querySelector('.batch-sel-add-btn').addEventListener('click', function() { _batchAddToSetlist(); });
    bar.querySelector('.batch-sel-cancel').addEventListener('click', function() { _exitSelectionMode(); });
    var escHandler = function(e) { if (e.key === 'Escape' && _selectionMode) _exitSelectionMode(); };
    document.addEventListener('keydown', escHandler);
    bar._escHandler = escHandler;
    requestAnimationFrame(function() { bar.classList.add('batch-bar-visible'); });
  }

  function _removeSelectionBar() {
    var bar = document.getElementById('batch-selection-bar');
    if (!bar) return;
    if (bar._escHandler) document.removeEventListener('keydown', bar._escHandler);
    bar.remove();
  }

  function _updateSelectionCount() {
    var el = document.querySelector('.batch-sel-count');
    if (el) el.textContent = _selectedSongIds.size + ' selected';
    var addBtn = document.querySelector('.batch-sel-add-btn');
    if (addBtn) addBtn.disabled = _selectedSongIds.size === 0;
  }

  function _batchAddToSetlist() {
    if (_selectedSongIds.size === 0) { showToast('No songs selected'); return; }
    var available = _setlists.filter(function(s) { return !s.archived; });
    if (!available.length) { showToast('No setlists yet'); return; }
    var existing = document.getElementById('batch-setlist-picker');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'batch-setlist-picker';
    overlay.className = 'modal-overlay';
    var selCount = _selectedSongIds.size;
    var rows = available.map(function(s, i) {
      var count = (s.songs || []).length;
      return '<div class="setlist-pick-row" data-sl-idx="' + i + '">' +
        '<span class="setlist-pick-name">' + esc(s.name) + '</span>' +
        '<span class="setlist-pick-count">' + count + ' song' + (count !== 1 ? 's' : '') + '</span>' +
        '</div>';
    }).join('');
    overlay.innerHTML = '<div class="setlist-picker">' +
      '<h3>Add ' + selCount + ' song' + (selCount !== 1 ? 's' : '') + ' to Setlist</h3>' +
      rows +
      '<button class="setlist-picker-cancel">Cancel</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.setlist-picker-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelectorAll('.setlist-pick-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var idx = parseInt(row.dataset.slIdx, 10);
        var setlist = available[idx];
        if (!setlist) return;
        if (!setlist.songs) setlist.songs = [];
        var existingIds = new Set(setlist.songs.map(function(e) { return e.id; }));
        var added = 0;
        _selectedSongIds.forEach(function(songId) {
          if (!existingIds.has(songId)) {
            setlist.songs.push({ id: songId, comment: '' });
            added++;
          }
        });
        if (added === 0) {
          showToast('All songs already in ' + setlist.name);
        } else {
          _saveSetlistsLocal(_setlists);
          saveSetlists();
          haptic.success();
          showToast('Added ' + added + ' song' + (added !== 1 ? 's' : '') + ' to ' + setlist.name);
        }
        overlay.remove();
        _exitSelectionMode();
      });
    });
  }

  // ─── DETAIL VIEW ───────────────────────────────────────────

  function renderDetail(song, skipNavPush) {
    _revokeBlobCache();
    Player.stopAll();
    _activeSong = song;
    if (!skipNavPush) _pushNav(() => renderList());
    _showView('detail');
    _setTopbar(song.title || 'Song', true);

    const container = document.getElementById('detail-content');
    container.innerHTML = _buildDetailHTML(song);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    if (Admin.isEditMode()) {
      container.querySelector('.btn-edit-song')?.addEventListener('click', () => renderEdit(song, false));
    } else {
      container.querySelector('.detail-edit-bar')?.remove();
    }

    // Quick-add to setlist
    container.querySelector('.btn-add-to-setlist')?.addEventListener('click', () => {
      _showSetlistPicker(song);
    });

    // Pre-fetch all chart PDFs eagerly (small files, prevents Drive contention with audio)
    const chartDriveIds = (song.assets?.charts || []).map(c => c.driveId).filter(Boolean);
    chartDriveIds.forEach(id => {
      if (!_blobCache[id]) _getBlobUrl(id).catch(() => {});
    });

    // Chart order star toggles (edit mode only)
    if (Admin.isEditMode()) {
      container.querySelectorAll('.chart-order-star').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.preventDefault();
          haptic.tap();
          const driveId = btn.dataset.starChart;
          if (!song.chartOrder) song.chartOrder = [];
          const existing = song.chartOrder.findIndex(o => o.driveId === driveId);
          if (existing !== -1) {
            // Remove from order and renumber remaining
            song.chartOrder.splice(existing, 1);
            song.chartOrder.sort((a, b) => a.order - b.order).forEach((o, i) => o.order = i + 1);
          } else {
            // Add with next available number
            const maxOrder = song.chartOrder.reduce((m, o) => Math.max(m, o.order), 0);
            song.chartOrder.push({ driveId, order: maxOrder + 1 });
          }
          song._ts = Date.now();
          const idx = _songs.findIndex(s => s.id === song.id);
          if (idx > -1) _songs[idx] = song;
          await saveSongs();
          renderDetail(song, true); // re-render to update star states
        });
      });
    }

    // Chart buttons
    container.querySelectorAll('[data-open-chart]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const url = await _getBlobUrl(btn.dataset.openChart);
          PDFViewer.open(url, btn.dataset.name);
        } catch (e) {
          showToast('Failed to load chart.');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Audio players — show skeleton placeholder while loading
    setTimeout(() => {
      container.querySelectorAll('[data-audio-container]').forEach(async el => {
        const driveId = el.dataset.audioContainer;
        if (!driveId) { el.innerHTML = ''; return; }
        el.innerHTML = `
          <div class="audio-player audio-skeleton">
            <div class="skeleton-text" style="width:40%;height:13px"></div>
            <div class="audio-controls">
              <div class="skeleton-circle"></div>
              <div class="audio-progress-wrap">
                <div class="skeleton-bar"></div>
                <div style="display:flex;justify-content:space-between">
                  <div class="skeleton-text" style="width:28px;height:10px"></div>
                  <div class="skeleton-text" style="width:28px;height:10px"></div>
                </div>
              </div>
            </div>
          </div>`;
        try {
          // iOS Safari can't play blob URLs — use direct Drive URL; others use blob for caching
          const url = _isIOS() ? Drive.getDirectUrl(driveId) : await _getBlobUrl(driveId);
          if (!url) throw new Error('No audio URL');
          el.innerHTML = '';
          const ref = Player.create(el, { name: el.dataset.name || 'Audio', blobUrl: url, songTitle: el.dataset.songTitle || '' });
          _playerRefs.push(ref);
        } catch {
          el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`;
        }
      });
    }, 0);

    // Download buttons
    container.querySelectorAll('.dl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _downloadFile(btn.dataset.dlId, btn.dataset.dlName, btn);
      });
    });
  }

  function _showSetlistPicker(song) {
    const available = _setlists.filter(s => !s.archived);
    if (!available.length) {
      showToast('No setlists yet');
      return;
    }

    document.getElementById('setlist-picker-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'setlist-picker-overlay';
    overlay.className = 'modal-overlay';

    const rows = available.map((s, i) => {
      const count = (s.songs || []).length;
      return `<div class="setlist-pick-row" data-sl-idx="${i}">
        <span class="setlist-pick-name">${esc(s.name)}</span>
        <span class="setlist-pick-count">${count} song${count !== 1 ? 's' : ''}</span>
      </div>`;
    }).join('');

    overlay.innerHTML = `<div class="setlist-picker">
      <h3>Add to Setlist</h3>
      ${rows}
      <button class="setlist-picker-cancel">Cancel</button>
    </div>`;

    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Cancel button
    overlay.querySelector('.setlist-picker-cancel').addEventListener('click', () => overlay.remove());

    // Setlist row clicks
    overlay.querySelectorAll('.setlist-pick-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.slIdx, 10);
        const setlist = available[idx];
        if (!setlist) return;

        const already = (setlist.songs || []).some(entry => entry.id === song.id);
        if (already) {
          showToast('Already in ' + setlist.name);
          overlay.remove();
          return;
        }

        if (!setlist.songs) setlist.songs = [];
        setlist.songs.push({ id: song.id, comment: '' });
        _saveSetlistsLocal(_setlists);
        saveSetlists();
        showToast('Added to ' + setlist.name);
        overlay.remove();
      });
    });
  }

  function _buildDetailHTML(song) {
    const a      = song.assets || {};
    const charts = a.charts || [];
    const audio  = a.audio  || [];
    const links  = a.links  || [];

    let html = `
      <div class="detail-header">
        ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-song">Edit Song</button></div>` : ''}
        <div class="detail-title">${esc(song.title) || 'Untitled'}</div>
        ${song.subtitle ? `<div class="detail-subtitle">${esc(song.subtitle)}</div>` : ''}
        <div class="detail-meta-row">
          ${song.key ? `<div class="detail-meta-item"><span class="detail-meta-label">Key</span><span class="detail-meta-value">${esc(song.key)}</span></div>` : ''}
          ${song.bpm ? `<div class="detail-meta-item"><span class="detail-meta-label">BPM</span><span class="detail-meta-value">${esc(String(song.bpm))}</span></div>` : ''}
          ${song.timeSig ? `<div class="detail-meta-item"><span class="detail-meta-label">Time</span><span class="detail-meta-value">${esc(song.timeSig)}</span></div>` : ''}
        </div>
        ${(song.tags||[]).length ? `<div class="detail-tags">${song.tags.map(t=>`<span class="detail-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="detail-quick-add">
        <button class="btn-ghost btn-add-to-setlist">
          <i data-lucide="list-plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add to Setlist
        </button>
      </div>`;

    if (song.notes) {
      html += `<div class="detail-section">
        <div class="detail-section-label">Notes & Directions</div>
        <div class="detail-notes">${esc(song.notes)}</div>
      </div>`;
    }

    if (charts.length) {
      html += `<div class="detail-section">
        <div class="detail-section-label">Charts</div>
        <div class="file-list">
          ${charts.map(c => {
            const orderNum = _getChartOrderNum(song, c.driveId);
            return `
            <div class="file-item-row">
              <button class="file-item" data-open-chart="${esc(c.driveId)}" data-name="${esc(c.name)}">
                <span class="chart-order-star${orderNum ? ' active' : ''}${Admin.isEditMode() ? '' : ' readonly'}" data-star-chart="${esc(c.driveId)}" aria-label="Set chart order" title="Chart order for live mode">
                  <i data-lucide="star" style="width:16px;height:16px;${orderNum ? 'fill:var(--accent);' : ''}"></i>
                  ${orderNum ? `<span class="chart-order-num">${orderNum}</span>` : ''}
                </span>
                <div class="file-item-icon pdf">
                  <i data-lucide="file-text"></i>
                </div>
                <span class="file-item-name">${esc(c.name)}</span>
                <span class="pdf-cached-badge${_isPdfCached(c.driveId) ? ' cached' : ''}" data-cache-id="${esc(c.driveId)}" title="${_isPdfCached(c.driveId) ? 'Available offline' : 'Not cached'}">
                  <i data-lucide="cloud-download" style="width:14px;height:14px;"></i>
                </span>
                <i data-lucide="chevron-right" class="file-item-arrow"></i>
              </button>
              <button class="dl-btn" data-dl-id="${esc(c.driveId)}" data-dl-name="${esc(c.name)}" aria-label="Download">
                <i data-lucide="download" class="dl-icon"></i>
                <span class="dl-spinner hidden"></span>
              </button>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    if (audio.length) {
      html += `<div class="detail-section">
        <div class="detail-section-label">Demo Recordings</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${audio.map(a => `
            <div class="audio-row">
              <div class="audio-row-player" data-audio-container="${esc(a.driveId)}" data-name="${esc(a.name)}" data-song-title="${esc(song.title || '')}"></div>
              <button class="dl-btn" data-dl-id="${esc(a.driveId)}" data-dl-name="${esc(a.name)}" aria-label="Download">
                <i data-lucide="download" class="dl-icon"></i>
                <span class="dl-spinner hidden"></span>
              </button>
            </div>`).join('')}
        </div>
      </div>`;
    }

    if (links.length) {
      html += `<div class="detail-section">
        <div class="detail-section-label">Streaming & Links</div>
        <div class="embed-list">
          ${links.map(l => _buildEmbedHTML(l)).join('')}
        </div>
      </div>`;
    }

    return html;
  }

  function _buildEmbedHTML(link) {
    const meta = {
      youtube:    { label: 'YouTube',     icon: '▶', cls: 'youtube'    },
      spotify:    { label: 'Spotify',     icon: '♫', cls: 'spotify'    },
      applemusic: { label: 'Apple Music', icon: '♪', cls: 'applemusic' },
    };
    const m = meta[link.type] || { label: link.type, icon: '🔗', cls: '' };

    let embedHTML = '';
    if (link.type === 'youtube' && link.embedId) {
      embedHTML = `<iframe src="https://www.youtube.com/embed/${esc(link.embedId)}" height="200"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen loading="lazy" style="display:block;width:100%;border:none;"></iframe>`;
    } else if (link.type === 'spotify' && link.embedId) {
      embedHTML = `<iframe src="https://open.spotify.com/embed/track/${esc(link.embedId)}?utm_source=generator&theme=0"
        height="80" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy" style="display:block;width:100%;border:none;"></iframe>`;
    } else if (link.type === 'applemusic' && link.embedId) {
      embedHTML = `<iframe src="https://embed.music.apple.com/us/album/${esc(link.embedId)}"
        height="150" allow="autoplay *; encrypted-media *; fullscreen *"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
        loading="lazy" style="display:block;width:100%;border:none;"></iframe>`;
    }

    return `
      <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
        ${embedHTML ? `<div style="overflow:hidden;${embedHTML ? 'border-bottom:1px solid var(--border);' : ''}">${embedHTML}</div>` : ''}
        <div class="embed-external-row">
          <div class="embed-external-info">
            <div class="embed-platform-icon ${m.cls}">${m.icon}</div>
            <span class="embed-platform-name">${m.label}</span>
          </div>
          <a href="${esc(link.url)}" target="_blank" rel="noopener" class="embed-open-btn">Open ↗</a>
        </div>
      </div>`;
  }

  // ─── EDIT VIEW ─────────────────────────────────────────────

  function renderEdit(song, isNew) {
    _revokeBlobCache();
    Player.stopAll();
    _editSong  = deepClone(song);
    _editIsNew = isNew;
    if (!_editSong.assets) _editSong.assets = { charts: [], audio: [], links: [] };
    if (!isNew && _activeSong) {
      _pushNav(() => renderDetail(_activeSong, true));
    }
    _showView('edit');
    _setTopbar(isNew ? 'New Song' : 'Edit Song', true);
    const editContainer = document.getElementById('edit-content');
    editContainer.innerHTML = _buildEditHTML(_editSong);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [editContainer] });
    _wireEditForm();
  }

  function _buildEditHTML(song) {
    const assets = song.assets;
    return `
      <div class="edit-section">
        <div class="edit-section-title">Song Info</div>
        <div class="form-field">
          <label class="form-label">Title</label>
          <input class="form-input" id="ef-title" type="text" value="${esc(song.title)}" placeholder="Song title" />
        </div>
        <div class="form-field">
          <label class="form-label">Subtitle</label>
          <input class="form-input" id="ef-subtitle" type="text" value="${esc(song.subtitle)}" placeholder="Short description, vibe, structure…" />
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label">Key</label>
            <input class="form-input" id="ef-key" type="text" value="${esc(song.key)}" placeholder="e.g. Bm, F#" />
          </div>
          <div class="form-field">
            <label class="form-label">BPM</label>
            <input class="form-input" id="ef-bpm" type="number" value="${esc(String(song.bpm||''))}" placeholder="120" min="1" max="999" />
          </div>
          <div class="form-field">
            <label class="form-label">Time Sig</label>
            <input class="form-input" id="ef-timesig" type="text" value="${esc(song.timeSig||'')}" placeholder="4/4" />
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Tags <span class="muted" style="font-weight:400">(Enter or comma)</span></label>
          <div class="tag-input-wrap" id="ef-tag-wrap">
            ${(song.tags||[]).map(t=>`<span class="tag-chip" data-tag="${esc(t)}">${esc(t)}<span class="tag-chip-remove" role="button">×</span></span>`).join('')}
            <input class="tag-inline-input" id="ef-tag-input" placeholder="rock, ballad…" type="text" autocomplete="off" />
            <div class="tag-suggest-dropdown hidden" id="ef-tag-suggest"></div>
          </div>
        </div>
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Notes & Directions</div>
        <div class="form-field">
          <textarea class="form-input" id="ef-notes" rows="6" placeholder="Performance notes, arrangement directions, key changes, feel…">${esc(song.notes)}</textarea>
        </div>
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Charts (PDF)</div>
        <div class="asset-edit-list" id="ef-chart-list">
          ${(assets.charts||[]).map(c => {
            const orderNum = _getChartOrderNum(song, c.driveId);
            return `<div class="asset-edit-row" data-drive-id="${esc(c.driveId)}"><button class="chart-order-star${orderNum ? ' active' : ''}" data-star-chart="${esc(c.driveId)}" aria-label="Set chart order" title="Chart order for live mode"><i data-lucide="star" style="width:14px;height:14px;${orderNum ? 'fill:var(--accent);' : ''}"></i>${orderNum ? `<span class="chart-order-num">${orderNum}</span>` : ''}</button><span class="asset-edit-name">${esc(c.name)}</span><button class="asset-edit-remove asset-delete-btn" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button></div>`;
          }).join('')}
        </div>
        <button class="btn-ghost" id="ef-add-chart">+ Add Chart PDF</button>
        <input type="file" id="ef-chart-file" accept=".pdf,application/pdf" style="display:none" multiple />
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Demo Recordings</div>
        <div class="asset-edit-list" id="ef-audio-list">
          ${(assets.audio||[]).map(a=>`<div class="asset-edit-row" data-drive-id="${esc(a.driveId)}"><span class="asset-edit-name">${esc(a.name)}</span><button class="asset-edit-remove asset-delete-btn" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button></div>`).join('')}
        </div>
        <button class="btn-ghost" id="ef-add-audio">+ Add Audio File</button>
        <input type="file" id="ef-audio-file" accept="audio/*" style="display:none" multiple />
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Streaming Links</div>
        <div id="ef-link-list">
          ${(assets.links||[]).map(l=>_linkEditRowHTML(l)).join('')}
        </div>
        <button class="btn-ghost" id="ef-add-link">+ Add Link</button>
      </div>

      <div class="edit-form-actions">
        <button class="btn-primary" id="ef-save">Save Song</button>
        <button class="btn-secondary" id="ef-cancel">Cancel</button>
      </div>

      ${!_editIsNew ? `<div class="delete-zone"><button class="btn-danger" id="ef-delete">Delete Song</button></div>` : ''}
    `;
  }

  function _linkEditRowHTML(link) {
    const types = ['youtube','spotify','applemusic'];
    const opts  = types.map(t =>
      `<option value="${t}" ${link.type===t?'selected':''}>${t==='applemusic'?'Apple Music':t.charAt(0).toUpperCase()+t.slice(1)}</option>`
    ).join('');
    return `<div class="link-edit-row">
      <select class="link-platform-select form-input">${opts}</select>
      <input class="form-input link-url-input" type="url" value="${esc(link.url)}" placeholder="Paste full URL…" />
      <button class="asset-delete-btn link-remove" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
    </div>`;
  }

  function _wireEditForm() {
    const song   = _editSong;
    const assets = song.assets;

    // Tags
    const tagWrap  = document.getElementById('ef-tag-wrap');
    const tagInput = document.getElementById('ef-tag-input');

    function addTag(raw) {
      const tag = raw.trim().replace(/,/g,'');
      if (!tag || (song.tags||[]).includes(tag)) return;
      song.tags = [...(song.tags||[]), tag];
      const chip = document.createElement('span');
      chip.className   = 'tag-chip';
      chip.dataset.tag = tag;
      chip.innerHTML   = `${esc(tag)}<span class="tag-chip-remove" role="button">×</span>`;
      chip.querySelector('.tag-chip-remove').addEventListener('click', () => removeTag(tag, chip));
      tagWrap.insertBefore(chip, tagInput);
    }
    function removeTag(tag, el) { song.tags=(song.tags||[]).filter(t=>t!==tag); el.remove(); }

    tagWrap.querySelectorAll('.tag-chip-remove').forEach(btn =>
      btn.addEventListener('click', () => removeTag(btn.parentElement.dataset.tag, btn.parentElement))
    );
    // Tag autocomplete
    const tagSuggest = document.getElementById('ef-tag-suggest');
    function updateTagSuggestions() {
      const val = tagInput.value.trim().toLowerCase();
      if (!val) { tagSuggest.classList.add('hidden'); return; }
      const current = new Set(song.tags || []);
      const matches = _allTags().filter(t => !current.has(t) && t.toLowerCase().includes(val));
      if (matches.length === 0) { tagSuggest.classList.add('hidden'); return; }
      tagSuggest.innerHTML = matches.slice(0, 6).map(t =>
        `<button class="tag-suggest-item" type="button">${esc(t)}</button>`
      ).join('');
      tagSuggest.classList.remove('hidden');
      tagSuggest.querySelectorAll('.tag-suggest-item').forEach(btn => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          addTag(btn.textContent);
          tagInput.value = '';
          tagSuggest.classList.add('hidden');
        });
      });
    }
    tagInput.addEventListener('input', updateTagSuggestions);

    tagInput.addEventListener('keydown', e => {
      if (e.key==='Enter'||e.key===',') { e.preventDefault(); addTag(tagInput.value); tagInput.value=''; tagSuggest.classList.add('hidden'); }
      else if (e.key==='Backspace'&&tagInput.value==='') {
        const chips=[...tagWrap.querySelectorAll('.tag-chip')];
        if (chips.length) removeTag(chips[chips.length-1].dataset.tag, chips[chips.length-1]);
      }
    });
    tagInput.addEventListener('blur', () => { if(tagInput.value.trim()){addTag(tagInput.value);tagInput.value='';} tagSuggest.classList.add('hidden'); });
    tagWrap.addEventListener('click', () => tagInput.focus());

    // Chart order star toggles in edit view
    document.getElementById('ef-chart-list').addEventListener('click', e => {
      const starBtn = e.target.closest('.chart-order-star');
      if (starBtn) {
        haptic.tap();
        const driveId = starBtn.dataset.starChart;
        if (!song.chartOrder) song.chartOrder = [];
        const existing = song.chartOrder.findIndex(o => o.driveId === driveId);
        if (existing !== -1) {
          // Remove from order and renumber remaining
          song.chartOrder.splice(existing, 1);
          song.chartOrder.sort((a, b) => a.order - b.order).forEach((o, i) => o.order = i + 1);
        } else {
          // Add with next available number
          const maxOrder = song.chartOrder.reduce((m, o) => Math.max(m, o.order), 0);
          song.chartOrder.push({ driveId, order: maxOrder + 1 });
        }
        // Update all star visuals
        document.querySelectorAll('#ef-chart-list .chart-order-star').forEach(s => {
          const id = s.dataset.starChart;
          const num = _getChartOrderNum(song, id);
          s.classList.toggle('active', !!num);
          const icon = s.querySelector('i[data-lucide]');
          if (icon) icon.style.fill = num ? 'var(--accent)' : '';
          // Update or create/remove number overlay
          let numSpan = s.querySelector('.chart-order-num');
          if (num) {
            if (!numSpan) {
              numSpan = document.createElement('span');
              numSpan.className = 'chart-order-num';
              s.appendChild(numSpan);
            }
            numSpan.textContent = num;
          } else if (numSpan) {
            numSpan.remove();
          }
        });
        return;
      }
    });

    // Asset removes (with confirm)
    ['chart','audio'].forEach(type => {
      const assetKey = type === 'chart' ? 'charts' : 'audio';
      document.getElementById(`ef-${type}-list`).addEventListener('click', e => {
        const btn = e.target.closest('.asset-edit-remove, .asset-delete-btn');
        if (!btn) return;
        const row = btn.closest('.asset-edit-row');
        const name = row.querySelector('.asset-edit-name')?.textContent || 'this file';
        Admin.showConfirm('Remove Attachment', `Remove "${name}" from this song?`, () => {
          const removedId = row.dataset.driveId;
          assets[assetKey] = assets[assetKey].filter(a => a.driveId !== removedId);
          // Remove from chartOrder if present and renumber
          if (type === 'chart' && song.chartOrder) {
            song.chartOrder = song.chartOrder.filter(o => o.driveId !== removedId);
            song.chartOrder.sort((a, b) => a.order - b.order).forEach((o, i) => o.order = i + 1);
          }
          row.remove();
        });
      });
    });

    // Uploads
    function wireUpload(btnId, inputId, assetKey, listId) {
      document.getElementById(btnId).addEventListener('click', () => {
        // File uploads always go to Drive — require Drive write access
        if (!Drive.isWriteConfigured()) {
          Admin.showDriveModal(() => {});
          showToast('Drive write access needed for file uploads.');
          return;
        }
        document.getElementById(inputId).click();
      });
      document.getElementById(inputId).addEventListener('change', async e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        showToast('Uploading…');
        for (const file of files) {
          try {
            const result = await Drive.uploadFile(file);
            const asset  = { driveId: result.id, name: result.name };
            assets[assetKey].push(asset);
            const tmp = document.createElement('div');
            tmp.innerHTML = `<div class="asset-edit-row" data-drive-id="${esc(asset.driveId)}"><span class="asset-edit-name">${esc(asset.name)}</span><button class="asset-edit-remove">×</button></div>`;
            document.getElementById(listId).appendChild(tmp.firstElementChild);
          } catch { showToast(`Upload failed: ${file.name}`); }
        }
        showToast('Upload complete.');
        e.target.value = '';
      });
    }
    wireUpload('ef-add-chart', 'ef-chart-file', 'charts', 'ef-chart-list');
    wireUpload('ef-add-audio', 'ef-audio-file', 'audio',  'ef-audio-list');

    // Links
    function wireOneLinkRow(rowEl, linkObj) {
      rowEl.querySelector('.link-platform-select').addEventListener('change', e => { linkObj.type=e.target.value; });
      rowEl.querySelector('.link-url-input').addEventListener('input', e => {
        linkObj.url     = e.target.value;
        linkObj.embedId = _extractEmbedId(linkObj.type, e.target.value);
      });
      rowEl.querySelector('.link-remove').addEventListener('click', () => {
        const idx = assets.links.indexOf(linkObj);
        if (idx > -1) assets.links.splice(idx, 1);
        rowEl.remove();
      });
    }
    document.querySelectorAll('#ef-link-list .link-edit-row').forEach((el, i) => wireOneLinkRow(el, assets.links[i]));

    document.getElementById('ef-add-link').addEventListener('click', () => {
      const blank = { type: 'youtube', url: '', embedId: '' };
      assets.links.push(blank);
      const tmp = document.createElement('div');
      tmp.innerHTML = _linkEditRowHTML(blank);
      const el = tmp.firstElementChild;
      document.getElementById('ef-link-list').appendChild(el);
      wireOneLinkRow(el, blank);
    });

    // Save
    document.getElementById('ef-save').addEventListener('click', async () => {
      if (_savingSongs) return;
      song.title    = document.getElementById('ef-title').value.trim();
      song.subtitle = document.getElementById('ef-subtitle').value.trim();
      song.key      = document.getElementById('ef-key').value.trim();
      song.bpm      = parseInt(document.getElementById('ef-bpm').value) || null;
      song.timeSig  = document.getElementById('ef-timesig').value.trim();
      song.notes    = document.getElementById('ef-notes').value.trim();
      assets.links  = assets.links
        .map(l => ({ ...l, url: l.url||'', embedId: _extractEmbedId(l.type, l.url||'') }))
        .filter(l => l.url);

      if (!song.title) { showToast('Title is required.'); document.getElementById('ef-title').focus(); return; }

      async function _doSaveSong() {
        _savingSongs = true;
        song._ts = Date.now();
        try {
          if (_editIsNew) {
            _songs.push(song);
          } else {
            const idx = _songs.findIndex(s => s.id === song.id);
            if (idx > -1) _songs[idx] = song;
          }
          await saveSongs();
          _activeSong = null;
          renderList();
        } finally {
          _savingSongs = false;
        }
      }

      // Duplicate check (async — offloaded to Web Worker)
      const similar = await _findSimilarSongsAsync(song.title, _editIsNew ? null : song.id);
      if (similar.length > 0) {
        const names = similar.map(s => s.title).join(', ');
        Admin.showConfirm(
          'Similar Song Exists',
          `A similar song already exists: "${names}". Save anyway?`,
          () => _doSaveSong(),
          'Save'
        );
        return;
      }
      _doSaveSong();
    });

    // Cancel
    document.getElementById('ef-cancel').addEventListener('click', () => {
      (_editIsNew || !_activeSong) ? renderList() : renderDetail(_activeSong, true);
    });

    // Delete
    document.getElementById('ef-delete')?.addEventListener('click', () => {
      Admin.showConfirm('Delete Song', `Permanently delete "${song.title||'this song'}"?`, async () => {
        if (GitHub.isConfigured()) GitHub.trackDeletion('songs', song.id);
        _songs = _songs.filter(s => s.id !== song.id);
        await saveSongs();
        _activeSong = null;
        renderList();
      });
    });
  }

  // ─── Embed ID extraction ──────────────────────────────────

  function _extractEmbedId(type, url) {
    if (!url) return '';
    try {
      if (type === 'youtube') {
        const u = new URL(url);
        if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
        return u.searchParams.get('v') || '';
      }
      if (type === 'spotify') {
        const m = url.match(/spotify\.com\/track\/([A-Za-z0-9]+)/);
        return m ? m[1] : '';
      }
      if (type === 'applemusic') {
        const m = url.match(/apple\.com\/[a-z-]+\/album\/[^/]+\/(\d+)/);
        return m ? m[1] : '';
      }
    } catch {}
    return '';
  }

  // ─── SETLISTS LIST VIEW ──────────────────────────────────

  let _showArchived = false;

  function _autoArchiveSetlists() {
    const now = Date.now();
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    let changed = false;
    _setlists.forEach(sl => {
      if (sl.gigDate && !sl.archived) {
        const gigTime = new Date(sl.gigDate).getTime();
        if (!isNaN(gigTime) && now - gigTime > twoDays) {
          sl.archived = true;
          changed = true;
        }
      }
    });
    if (changed) _saveSetlistsLocal(_setlists);
  }

  function _setlistCardHTML(sl) {
    const count = (sl.songs || []).length;
    const editBtn = Admin.isEditMode()
      ? `<button class="song-card-edit-btn setlist-edit-btn" data-edit-setlist="${esc(sl.id)}"><i data-lucide="pencil"></i></button>`
      : '';
    const dateStr = sl.gigDate ? `<span class="setlist-card-date">${esc(sl.gigDate)}</span>` : '';
    return `
      <div class="setlist-card" data-setlist-id="${esc(sl.id)}">
        <div class="setlist-card-title-row">
          <span class="setlist-card-name">${esc(sl.name) || '<em style="color:var(--text-3)">Untitled</em>'}</span>
          ${editBtn}
        </div>
        <span class="setlist-card-count">${count} song${count !== 1 ? 's' : ''}${dateStr ? ' · ' : ''}${dateStr}</span>
      </div>`;
  }

  function renderSetlists(skipNavReset) {
    _revokeBlobCache();
    if (!skipNavReset) {
      _navStack = [];
      _pushNav(() => renderList());
      _showArchived = false;
    }
    _showView('setlists');
    _setTopbar('Setlists', true);

    _autoArchiveSetlists();

    const container = document.getElementById('setlists-list');
    const active = _setlists.filter(sl => !sl.archived).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const archived = _setlists.filter(sl => sl.archived).sort((a, b) => (b.gigDate || b.updatedAt || '').localeCompare(a.gigDate || a.updatedAt || ''));

    let html = `<div class="view-refresh-row">
      <button class="icon-btn view-refresh-btn" id="btn-refresh-setlists" title="Sync from Drive" aria-label="Refresh">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>`;

    if (Admin.isEditMode()) {
      html += `<button class="btn-ghost setlist-add-btn" id="btn-new-setlist">+ New Setlist</button>`;
    }

    if (!_showArchived) {
      if (active.length === 0) {
        html += `<div class="empty-state" style="padding:40px 20px">
          <p>No active setlists.</p>
          <p class="muted">${Admin.isEditMode() ? 'Create one above.' : 'Setlists will appear here.'}</p>
        </div>`;
      } else {
        active.forEach(sl => { html += _setlistCardHTML(sl); });
      }
      if (archived.length > 0) {
        html += `<button class="btn-ghost archive-toggle-btn" id="btn-toggle-archive">
          <i data-lucide="archive" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>
          Archived <span class="archive-badge">${archived.length}</span>
        </button>`;
      }
    } else {
      html += `<button class="btn-ghost archive-toggle-btn" id="btn-toggle-archive">
        <i data-lucide="chevron-left" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>
        Back to Active
      </button>`;
      if (archived.length === 0) {
        html += `<div class="empty-state" style="padding:40px 20px"><p>No archived setlists.</p></div>`;
      } else {
        archived.forEach(sl => {
          html += `<div class="archive-card-wrap">${_setlistCardHTML(sl)}
            <button class="btn-ghost unarchive-btn" data-unarchive-id="${esc(sl.id)}" style="font-size:11px;padding:4px 10px;margin-top:-6px;margin-bottom:10px;">Unarchive</button>
          </div>`;
        });
      }
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire refresh
    document.getElementById('btn-refresh-setlists')?.addEventListener('click', () => {
      _doSyncRefresh(() => renderSetlists(true));
    });

    // Wire card clicks
    container.querySelectorAll('.setlist-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.setlist-edit-btn')) return;
        const sl = _setlists.find(s => s.id === card.dataset.setlistId);
        if (sl) renderSetlistDetail(sl);
      });
    });

    // Wire edit buttons
    container.querySelectorAll('.setlist-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sl = _setlists.find(s => s.id === btn.dataset.editSetlist);
        if (sl) renderSetlistEdit(sl, false, true);
      });
    });

    // Wire archive toggle
    document.getElementById('btn-toggle-archive')?.addEventListener('click', () => {
      _showArchived = !_showArchived;
      renderSetlists(true);
    });

    // Wire unarchive buttons
    container.querySelectorAll('.unarchive-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sl = _setlists.find(s => s.id === btn.dataset.unarchiveId);
        if (sl) {
          sl.archived = false;
          _saveSetlistsLocal(_setlists);
          renderSetlists(true);
          showToast('Setlist unarchived.');
        }
      });
    });

    // Wire new setlist
    document.getElementById('btn-new-setlist')?.addEventListener('click', () => {
      if (!Drive.isWriteConfigured() && !GitHub.isConfigured()) {
        Admin.showGitHubModal(() => {});
        showToast('Configure GitHub to sync data, then try again.');
        return;
      }
      renderSetlistEdit(Admin.newSetlist(_setlists), true);
    });
  }

  // ─── SETLIST DETAIL VIEW ─────────────────────────────────

  function renderSetlistDetail(setlist, skipNavPush) {
    _revokeBlobCache();
    Player.stopAll();
    _activeSetlist = setlist;
    if (!skipNavPush) _pushNav(() => renderSetlists());
    _showView('setlist-detail');
    _setTopbar(setlist.name || 'Setlist', true);

    const container = document.getElementById('setlist-detail-content');
    const songs = setlist.songs || [];

    let html = `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-setlist">Edit Setlist</button><button class="btn-ghost btn-duplicate-setlist"><i data-lucide="copy" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Duplicate</button></div>` : ''}
      <div class="detail-title">${esc(setlist.name) || 'Untitled Setlist'}</div>
      <div class="detail-subtitle">${songs.length} song${songs.length !== 1 ? 's' : ''}${songs.length > 0 ? ' <button class="btn-live-mode"><i data-lucide="monitor" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Live Mode</button><button class="btn-copy-setlist"><i data-lucide="clipboard-copy" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Copy</button>' : ''}</div>
    </div>`;

    if (songs.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>Empty setlist.</p>
        <p class="muted">${Admin.isEditMode() ? 'Edit to add songs.' : 'No songs added yet.'}</p>
      </div>`;
    } else {
      html += `<div class="setlist-song-list">`;
      songs.forEach((entry, i) => {
        const song = _songs.find(s => s.id === entry.id);
        if (song) {
          html += `
            <div class="setlist-song-row" data-song-id="${esc(song.id)}">
              <span class="setlist-song-num">${i + 1}</span>
              <div class="setlist-song-info">
                <span class="setlist-song-title">${esc(song.title)}</span>
                <span class="setlist-song-meta">
                  ${song.key ? esc(song.key) : ''}${song.key && song.bpm ? ' · ' : ''}${song.bpm ? esc(String(song.bpm)) + ' bpm' : ''}${(song.key || song.bpm) && song.timeSig ? ' · ' : ''}${song.timeSig ? esc(song.timeSig) : ''}
                </span>
                ${entry.comment ? `<span class="setlist-song-comment">${esc(entry.comment)}</span>` : ''}
              </div>
              <i data-lucide="chevron-right" class="file-item-arrow"></i>
            </div>`;
        } else {
          html += `
            <div class="setlist-song-row setlist-song-missing">
              <span class="setlist-song-num">${i + 1}</span>
              <div class="setlist-song-info">
                <span class="setlist-song-title" style="color:var(--text-3);font-style:italic">Song not found</span>
              </div>
            </div>`;
        }
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire song clicks
    container.querySelectorAll('.setlist-song-row:not(.setlist-song-missing)').forEach(row => {
      row.addEventListener('click', () => {
        const song = _songs.find(s => s.id === row.dataset.songId);
        if (song) {
          _pushNav(() => renderSetlistDetail(setlist));
          renderDetail(song, true);
        }
      });
    });

    // Wire edit button
    container.querySelector('.btn-edit-setlist')?.addEventListener('click', () => {
      renderSetlistEdit(setlist, false);
    });

    // Wire duplicate button
    container.querySelector('.btn-duplicate-setlist')?.addEventListener('click', () => {
      haptic.success();
      const dupe = deepClone(setlist);
      dupe.id = 'sl_' + Date.now();
      dupe.name = (setlist.name || 'Setlist') + ' (Copy)';
      dupe._ts = Date.now();
      _setlists.push(dupe);
      saveSetlists('Setlist duplicated');
      renderSetlistEdit(dupe, false);
    });

    if (!Admin.isEditMode()) {
      container.querySelector('.detail-edit-bar')?.remove();
    }

    // Wire Live Mode button
    container.querySelector('.btn-live-mode')?.addEventListener('click', () => {
      _renderLiveMode(setlist);
    });

    // Wire Copy Setlist button
    container.querySelector('.btn-copy-setlist')?.addEventListener('click', () => {
      const lines = [];
      lines.push((setlist.name || 'Setlist') + ' (' + songs.length + ' song' + (songs.length !== 1 ? 's' : '') + ')');
      lines.push('');
      songs.forEach((entry, i) => {
        const song = _songs.find(s => s.id === entry.id);
        if (!song) return;
        let line = (i + 1) + '. ' + (song.title || 'Untitled');
        const meta = [];
        if (song.key) meta.push(song.key);
        if (song.bpm) meta.push(song.bpm + ' BPM');
        if (song.timeSig) meta.push(song.timeSig);
        if (meta.length) line += ' \u2014 ' + meta.join(' \u00b7 ');
        lines.push(line);
        if (entry.comment) lines.push('   ' + entry.comment);
      });
      const text = lines.join('\n');

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Setlist copied!');
        }).catch(() => {
          _fallbackCopy(text);
        });
      } else {
        _fallbackCopy(text);
      }
    });
  }

  // ─── SETLIST LIVE MODE (ForScore-style charts + pedal support) ──

  let _liveModeActive = false;
  let _exitLiveModeRef = null; // stored so navigateBack can call it

  function _renderLiveMode(setlist) {
    if (_liveModeActive) return; // double-entry guard
    const songs = (setlist.songs || []).map(entry => {
      const song = _songs.find(s => s.id === entry.id);
      return song ? { ...song, comment: entry.comment || '' } : null;
    }).filter(Boolean);

    if (songs.length === 0) return;

    _liveModeActive = true;
    _revokeBlobCache();
    Player.stopAll();

    const _startTime = Date.now();
    let _clockInterval = null;
    let _zpHandle = null; // zoom/pan handle for chart canvas
    let _overlayTimer = null;
    let _wakeLock = null;

    // Screen Wake Lock — keep screen on during Live Mode only
    async function _requestWakeLock() {
      try {
        if ('wakeLock' in navigator && _liveModeActive) _wakeLock = await navigator.wakeLock.request('screen');
      } catch (_) {}
    }
    function _onVisibilityChange() {
      if (document.visibilityState === 'visible' && _liveModeActive && !_wakeLock) _requestWakeLock();
    }
    document.addEventListener('visibilitychange', _onVisibilityChange);
    _requestWakeLock();

    // ── Build flat page list ──
    // Start with one placeholder per song; chart songs get expanded as PDFs load
    let _pages = [];
    const _songEntries = songs; // keep reference to original song list

    function _buildInitialPages() {
      _pages = [];
      for (let si = 0; si < _songEntries.length; si++) {
        const song = _songEntries[si];
        const orderedCharts = _getOrderedCharts(song);
        if (orderedCharts.length) {
          orderedCharts.forEach(chart => {
            _pages.push({ type: 'loading', songIdx: si, song, chartDriveId: chart.driveId, chartName: chart.name });
          });
        } else {
          _pages.push({ type: 'metadata', songIdx: si, song });
        }
      }
    }
    _buildInitialPages();

    // ── Session restore ──
    let currentPageIdx = 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem('bb_live_state') || 'null');
      if (saved && saved.setlistId === setlist.id && typeof saved.pageIdx === 'number') {
        currentPageIdx = Math.max(0, Math.min(saved.pageIdx, _pages.length - 1));
      } else if (saved && saved.setlistId === setlist.id && typeof saved.idx === 'number') {
        // Legacy format — find first page of that song index
        const target = _pages.findIndex(p => p.songIdx === saved.idx);
        if (target >= 0) currentPageIdx = target;
      }
    } catch (_) {}

    function _persistPage() {
      try { sessionStorage.setItem('bb_live_state', JSON.stringify({ setlistId: setlist.id, pageIdx: currentPageIdx })); } catch (_) {}
    }

    _showView('setlist-live');
    document.body.classList.add('live-mode-active');

    // Try Fullscreen API
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    }

    const container = document.getElementById('setlist-live-content');

    // ── Build persistent DOM ──
    container.innerHTML = `
      <div class="lm-header">
        <button class="lm-jump-btn" aria-label="Song picker"><i data-lucide="list" style="width:20px;height:20px;"></i></button>
        <span class="lm-progress"></span>
        <div class="lm-clock-group">
          <span class="lm-clock"></span>
          <span class="lm-timer">0:00</span>
        </div>
        <button class="lm-close-btn" aria-label="Exit Live Mode"><i data-lucide="x" style="width:22px;height:22px;"></i></button>
      </div>
      <div class="lm-jump-overlay hidden">
        <div class="lm-jump-list"></div>
      </div>
      <div class="lm-page-wrapper">
        <div class="lm-canvas-area hidden">
          <canvas class="lm-chart-canvas"></canvas>
          <div class="lm-chart-overlay"></div>
        </div>
        <div class="lm-metadata-slide hidden">
          <div class="lm-body"></div>
        </div>
        <div class="lm-loading-slide hidden">
          <div class="lm-loading-spinner"></div>
          <div class="lm-loading-text">Loading chart…</div>
        </div>
      </div>
      <div class="lm-nav">
        <button class="lm-nav-btn lm-prev" aria-label="Previous">
          <i data-lucide="chevron-left" style="width:32px;height:32px;"></i>
        </button>
        <button class="lm-nav-btn lm-next" aria-label="Next">
          <i data-lucide="chevron-right" style="width:32px;height:32px;"></i>
        </button>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    const pageWrapper    = container.querySelector('.lm-page-wrapper');
    const canvasArea     = container.querySelector('.lm-canvas-area');
    const chartCanvas    = container.querySelector('.lm-chart-canvas');
    const chartOverlay   = container.querySelector('.lm-chart-overlay');
    const metadataSlide  = container.querySelector('.lm-metadata-slide');
    const metadataBody   = container.querySelector('.lm-metadata-slide .lm-body');
    const loadingSlide   = container.querySelector('.lm-loading-slide');
    const progressEl     = container.querySelector('.lm-progress');
    const prevBtn        = container.querySelector('.lm-prev');
    const nextBtn        = container.querySelector('.lm-next');

    // Wire buttons
    prevBtn.addEventListener('click', () => _goPage(-1));
    nextBtn.addEventListener('click', () => _goPage(1));
    container.querySelector('.lm-close-btn').addEventListener('click', _exitLiveMode);

    // ── Quick-Jump Song Picker ──
    const jumpBtn = container.querySelector('.lm-jump-btn');
    const jumpOverlay = container.querySelector('.lm-jump-overlay');
    const jumpList = container.querySelector('.lm-jump-list');

    function _openJumpPicker() {
      const curSongIdx = _pages[currentPageIdx] ? _pages[currentPageIdx].songIdx : -1;
      jumpList.innerHTML = _songEntries.map((song, idx) => {
        const isActive = idx === curSongIdx ? ' active' : '';
        return `<button class="lm-jump-item${isActive}" data-song-idx="${idx}"><span class="lm-jump-item-num">${idx + 1}.</span> ${esc(song.title)}</button>`;
      }).join('');
      jumpOverlay.classList.remove('hidden');
      // Scroll current song into view
      const activeItem = jumpList.querySelector('.lm-jump-item.active');
      if (activeItem) activeItem.scrollIntoView({ block: 'center', behavior: 'instant' });
    }

    function _closeJumpPicker() {
      jumpOverlay.classList.add('hidden');
    }

    function _toggleJumpPicker() {
      if (jumpOverlay.classList.contains('hidden')) {
        _openJumpPicker();
      } else {
        _closeJumpPicker();
      }
    }

    jumpBtn.addEventListener('click', _toggleJumpPicker);

    // Tap a song to jump
    jumpList.addEventListener('click', (e) => {
      const item = e.target.closest('.lm-jump-item');
      if (!item) return;
      const targetSongIdx = parseInt(item.dataset.songIdx, 10);
      if (isNaN(targetSongIdx)) return;
      haptic.tap();
      const targetPageIdx = _pages.findIndex(p => p.songIdx === targetSongIdx);
      if (targetPageIdx >= 0 && targetPageIdx !== currentPageIdx) {
        currentPageIdx = targetPageIdx;
        _renderCurrentPage();
      }
      _closeJumpPicker();
    });

    // Dismiss overlay by tapping outside the list
    jumpOverlay.addEventListener('click', (e) => {
      if (e.target === jumpOverlay) _closeJumpPicker();
    });

    // ── Navigation ──
    let _lastRenderedSongIdx = -1;
    let _isAnimating = false;

    function _goPage(delta, animate) {
      if (_isAnimating) return;
      const newIdx = currentPageIdx + delta;
      if (newIdx < 0 || newIdx >= _pages.length) return;
      haptic.light();
      if (animate !== false) {
        _slideTransition(delta > 0 ? 'left' : 'right', () => {
          currentPageIdx = newIdx;
          _renderCurrentPage();
        });
      } else {
        currentPageIdx = newIdx;
        _renderCurrentPage();
      }
    }

    function _slideTransition(direction, onMid) {
      _isAnimating = true;
      const slideOut = direction === 'left' ? '-100%' : '100%';
      const slideIn  = direction === 'left' ? '100%' : '-100%';

      // Slide current page out
      pageWrapper.style.transition = 'transform 0.2s ease-in';
      pageWrapper.style.transform = `translateX(${slideOut})`;

      function _afterSlideOut() {
        pageWrapper.removeEventListener('transitionend', _afterSlideOut);
        // Render new page off-screen on the opposite side
        pageWrapper.style.transition = 'none';
        pageWrapper.style.transform = `translateX(${slideIn})`;
        onMid();
        // Force reflow before animating in
        void pageWrapper.offsetWidth;
        pageWrapper.style.transition = 'transform 0.2s ease-out';
        pageWrapper.style.transform = 'translateX(0)';

        function _afterSlideIn() {
          pageWrapper.removeEventListener('transitionend', _afterSlideIn);
          pageWrapper.style.transition = '';
          pageWrapper.style.transform = '';
          _isAnimating = false;
        }
        pageWrapper.addEventListener('transitionend', _afterSlideIn, { once: true });
        // Safety timeout in case transitionend doesn't fire
        setTimeout(() => { if (_isAnimating) { _afterSlideIn(); } }, 500);
      }
      pageWrapper.addEventListener('transitionend', _afterSlideOut, { once: true });
      // Safety timeout
      setTimeout(() => {
        if (_isAnimating && pageWrapper.style.transform.includes(slideOut)) {
          _afterSlideOut();
        }
      }, 500);
    }

    function _renderCurrentPage() {
      _persistPage();
      const page = _pages[currentPageIdx];
      if (!page) return;

      // Update progress
      const songNum = page.songIdx + 1;
      const totalSongs = _songEntries.length;
      if (page.type === 'chart') {
        progressEl.textContent = `Song ${songNum}/${totalSongs} · Page ${page.pageNum}/${page.totalSongPages}`;
      } else {
        progressEl.textContent = `Song ${songNum}/${totalSongs}`;
      }

      // Update nav buttons
      prevBtn.disabled = currentPageIdx === 0;
      nextBtn.disabled = currentPageIdx === _pages.length - 1;

      // Show appropriate panel
      canvasArea.classList.toggle('hidden', page.type !== 'chart');
      metadataSlide.classList.toggle('hidden', page.type !== 'metadata');
      loadingSlide.classList.toggle('hidden', page.type !== 'loading');

      if (page.type === 'chart') {
        _renderChartPage(page);
      } else if (page.type === 'metadata') {
        _renderMetadataPage(page);
      }

      // Show overlay at song boundaries or first page
      const isNewSong = page.songIdx !== _lastRenderedSongIdx;
      _lastRenderedSongIdx = page.songIdx;
      if (isNewSong) {
        _showOverlay(page.song);
      }
    }

    function _renderChartPage(page) {
      const capturedIdx = currentPageIdx;
      PDFViewer.renderToCanvasCached(page.pdfDoc, page.pageNum, chartCanvas, canvasArea).then(() => {
        if (capturedIdx === currentPageIdx && _zpHandle) _zpHandle.resetZoom();
      }).catch(err => {
        console.error('Live mode chart render error', err);
        // Fallback: convert to metadata page — only if we're still on the same page
        if (_pages[capturedIdx] === page) {
          _pages[capturedIdx] = { type: 'metadata', songIdx: page.songIdx, song: page.song };
          if (capturedIdx === currentPageIdx) _renderCurrentPage();
        }
      });
    }

    function _renderMetadataPage(page) {
      const song = page.song;
      metadataBody.innerHTML = `
        <div class="lm-song-num">${page.songIdx + 1}</div>
        <div class="lm-song-title">${esc(song.title)}</div>
        ${song.subtitle ? `<div class="lm-song-subtitle">${esc(song.subtitle)}</div>` : ''}
        <div class="lm-song-meta">
          ${song.key ? `<span class="lm-meta-item">${esc(song.key)}</span>` : ''}
          ${song.bpm ? `<span class="lm-meta-item">${esc(String(song.bpm))} BPM</span>` : ''}
          ${song.timeSig ? `<span class="lm-meta-item">${esc(song.timeSig)}</span>` : ''}
        </div>
        ${song.comment ? `<div class="lm-comment">${esc(song.comment)}</div>` : ''}
        ${song.notes ? `<div class="lm-notes">${esc(song.notes)}</div>` : ''}
      `;
    }

    function _showOverlay(song) {
      haptic.medium(); // song boundary feedback
      if (_overlayTimer) clearTimeout(_overlayTimer);
      const meta = [song.key, song.bpm ? song.bpm + ' BPM' : '', song.timeSig].filter(Boolean).join(' · ');
      chartOverlay.innerHTML = `<div class="lm-overlay-title">${esc(song.title)}</div>${meta ? `<div class="lm-overlay-meta">${esc(meta)}</div>` : ''}`;
      chartOverlay.classList.add('lm-overlay-visible');
      _overlayTimer = setTimeout(() => {
        chartOverlay.classList.remove('lm-overlay-visible');
      }, 3000);
    }

    // ── Zoom/Pan for chart canvas ──
    _zpHandle = PDFViewer.attachZoomPan(chartCanvas, canvasArea);

    // ── Progressive PDF loading (serialized mutations to prevent race conditions) ──
    let _spliceLock = Promise.resolve();

    async function _loadChartPDF(songIdx, chartDriveId) {
      try {
        const blobUrl = await _getBlobUrl(chartDriveId);
        if (!_liveModeActive) return; // exited during load
        const pdfDoc = await pdfjsLib.getDocument(blobUrl).promise;
        if (!_liveModeActive) { pdfDoc.destroy(); return; } // exited during load
        const numPages = pdfDoc.numPages;

        // Zero-page PDFs — fall back to metadata
        if (numPages === 0) {
          pdfDoc.destroy();
          _spliceLock = _spliceLock.then(() => {
            const idx = _pages.findIndex(p => p.songIdx === songIdx && p.type === 'loading' && p.chartDriveId === chartDriveId);
            if (idx !== -1) {
              _pages[idx] = { type: 'metadata', songIdx, song: _pages[idx].song };
              if (idx === currentPageIdx) _renderCurrentPage();
            }
          });
          return;
        }

        // Serialize mutation to prevent concurrent splice races
        _spliceLock = _spliceLock.then(() => {
          if (!_liveModeActive) { pdfDoc.destroy(); return; }

          const placeholderIdx = _pages.findIndex(p => p.songIdx === songIdx && p.type === 'loading' && p.chartDriveId === chartDriveId);
          if (placeholderIdx === -1) { pdfDoc.destroy(); return; }

          const song = _pages[placeholderIdx].song;
          const chartPages = [];
          for (let p = 1; p <= numPages; p++) {
            chartPages.push({ type: 'chart', songIdx, song, pdfDoc, pageNum: p, totalSongPages: numPages });
          }

          const wasBeforeCurrent = placeholderIdx < currentPageIdx;
          const wasAtCurrent = placeholderIdx === currentPageIdx;

          _pages.splice(placeholderIdx, 1, ...chartPages);

          // Pre-render first chart page for this song
          const cw = canvasArea.clientWidth;
          if (cw > 0) {
            PDFViewer.preRenderPage(pdfDoc, 1, cw).catch(() => {});
          }

          if (wasBeforeCurrent) {
            currentPageIdx += (chartPages.length - 1);
          }

          if (wasAtCurrent) {
            _renderCurrentPage();
          }
        });
      } catch (err) {
        console.error('Failed to load chart for song', songIdx, err);
        _spliceLock = _spliceLock.then(() => {
          const idx = _pages.findIndex(p => p.songIdx === songIdx && p.type === 'loading' && p.chartDriveId === chartDriveId);
          if (idx !== -1) {
            const song = _pages[idx].song;
            _pages[idx] = { type: 'metadata', songIdx, song };
            if (idx === currentPageIdx) _renderCurrentPage();
          }
        });
      }
    }

    // Fire all PDF loads in parallel
    const loadPromises = [];
    for (let si = 0; si < _songEntries.length; si++) {
      const orderedCharts = _getOrderedCharts(_songEntries[si]);
      orderedCharts.forEach(chart => {
        loadPromises.push(_loadChartPDF(si, chart.driveId));
      });
    }

    // ── Exit Live Mode ──
    function _exitLiveMode() {
      if (!_liveModeActive) return;
      _liveModeActive = false;
      _exitLiveModeRef = null;
      _isAnimating = false;
      try { sessionStorage.removeItem('bb_live_state'); } catch (_) {}
      if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
      if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
      if (_zpHandle) { _zpHandle.destroy(); _zpHandle = null; }
      PDFViewer.clearRenderCache();
      // Destroy all loaded PDF documents to free memory
      const seenDocs = new Set();
      for (const pg of _pages) {
        if (pg.pdfDoc && !seenDocs.has(pg.pdfDoc)) {
          seenDocs.add(pg.pdfDoc);
          try { pg.pdfDoc.destroy(); } catch (e) { console.warn('PDF destroy failed', e); }
        }
      }
      _pages = [];
      // Release wake lock
      if (_wakeLock) { try { _wakeLock.release(); } catch (_) {} _wakeLock = null; }
      document.body.classList.remove('live-mode-active');
      document.removeEventListener('keydown', _onKey);
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      pageWrapper.removeEventListener('touchstart', _onDragStart);
      pageWrapper.removeEventListener('touchmove', _onDragMove);
      pageWrapper.removeEventListener('touchend', _onDragEnd);
      canvasArea.removeEventListener('touchstart', _onTapStart);
      canvasArea.removeEventListener('touchend', _onTapEnd);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitFullscreenElement) {
        document.webkitExitFullscreen();
      }
      renderSetlistDetail(setlist, true);
    }
    _exitLiveModeRef = _exitLiveMode;

    // ── Keyboard navigation (with pedal support) ──
    function _onKey(e) {
      // Close jump picker on any navigation key
      if (!jumpOverlay.classList.contains('hidden')) _closeJumpPicker();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        _goPage(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        _goPage(-1);
      } else if (e.key === 'Escape') {
        if (!jumpOverlay.classList.contains('hidden')) {
          _closeJumpPicker();
        } else {
          _exitLiveMode();
        }
      }
    }
    document.addEventListener('keydown', _onKey);

    // ── Carousel swipe navigation (drag-follow + snap) ──
    let _dragX0 = 0, _dragY0 = 0, _dragging = false, _dragLocked = false, _edgeBuzzed = false;
    const SWIPE_THRESHOLD = 60;

    function _onDragStart(e) {
      if (_isAnimating) return;
      if (_zpHandle && _zpHandle.getZoom() > 1.05) return;
      const t = e.touches[0];
      _dragX0 = t.clientX;
      _dragY0 = t.clientY;
      _dragging = true;
      _dragLocked = false;
      _edgeBuzzed = false;
      pageWrapper.style.transition = 'none';
    }

    function _onDragMove(e) {
      if (!_dragging || _isAnimating) return;
      if (_zpHandle && _zpHandle.getZoom() > 1.05) { _dragging = false; return; }
      if (e.touches.length > 1) { _dragging = false; pageWrapper.style.transform = ''; return; } // multi-touch — abort
      const t = e.touches[0];
      const dx = t.clientX - _dragX0;
      const dy = t.clientY - _dragY0;

      // Lock direction on first significant movement
      if (!_dragLocked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical — abort carousel, let page scroll
          _dragging = false;
          pageWrapper.style.transform = '';
          return;
        }
        _dragLocked = true;
      }

      // Prevent native scroll while carousel-dragging horizontally
      e.preventDefault();

      // Rubber-band effect at edges
      let tx = dx;
      if ((dx > 0 && currentPageIdx === 0) || (dx < 0 && currentPageIdx === _pages.length - 1)) {
        if (!_edgeBuzzed) { haptic.medium(); _edgeBuzzed = true; } // edge bounce
        tx = dx * 0.25; // resist at edges
      }
      pageWrapper.style.transform = `translateX(${tx}px)`;
    }

    function _onDragEnd(e) {
      if (!_dragging) return;
      _dragging = false;
      if (_isAnimating) { pageWrapper.style.transform = ''; return; }

      const t = e.changedTouches[0];
      const dx = t ? t.clientX - _dragX0 : 0;

      if (Math.abs(dx) >= SWIPE_THRESHOLD) {
        // Complete the swipe with animation
        const direction = dx < 0 ? 'left' : 'right';
        const canGo = dx < 0 ? currentPageIdx < _pages.length - 1 : currentPageIdx > 0;
        if (canGo) {
          haptic.light(); // swipe snap
          _isAnimating = true;
          const slideOut = direction === 'left' ? '-100%' : '100%';
          const slideIn  = direction === 'left' ? '100%' : '-100%';
          pageWrapper.style.transition = 'transform 0.18s ease-in';
          pageWrapper.style.transform = `translateX(${slideOut})`;

          function _afterOut() {
            pageWrapper.removeEventListener('transitionend', _afterOut);
            pageWrapper.style.transition = 'none';
            pageWrapper.style.transform = `translateX(${slideIn})`;
            currentPageIdx += (dx < 0 ? 1 : -1);
            _renderCurrentPage();
            void pageWrapper.offsetWidth;
            pageWrapper.style.transition = 'transform 0.18s ease-out';
            pageWrapper.style.transform = 'translateX(0)';
            function _afterIn() {
              pageWrapper.removeEventListener('transitionend', _afterIn);
              pageWrapper.style.transition = '';
              pageWrapper.style.transform = '';
              _isAnimating = false;
            }
            pageWrapper.addEventListener('transitionend', _afterIn, { once: true });
            setTimeout(() => { if (_isAnimating) _afterIn(); }, 400);
          }
          pageWrapper.addEventListener('transitionend', _afterOut, { once: true });
          setTimeout(() => {
            if (_isAnimating && pageWrapper.style.transform.includes(slideOut)) _afterOut();
          }, 400);
          return;
        }
      }
      // Snap back
      pageWrapper.style.transition = 'transform 0.2s ease-out';
      pageWrapper.style.transform = 'translateX(0)';
      setTimeout(() => { pageWrapper.style.transition = ''; pageWrapper.style.transform = ''; }, 250);
    }

    pageWrapper.addEventListener('touchstart', _onDragStart, { passive: true });
    pageWrapper.addEventListener('touchmove', _onDragMove, { passive: false });
    pageWrapper.addEventListener('touchend', _onDragEnd, { passive: true });

    // ── Tap zones for page turning ──
    let _tapStartX = 0, _tapStartY = 0, _tapStartTime = 0;
    function _onTapStart(e) {
      if (e.touches.length !== 1) return;
      _tapStartX = e.touches[0].clientX;
      _tapStartY = e.touches[0].clientY;
      _tapStartTime = Date.now();
    }

    function _onTapEnd(e) {
      if (_isAnimating) return;
      if (_zpHandle && _zpHandle.getZoom() > 1.05) return;
      const page = _pages[currentPageIdx];
      if (!page || page.type !== 'chart') return;

      const t = e.changedTouches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - _tapStartX);
      const dy = Math.abs(t.clientY - _tapStartY);
      const duration = Date.now() - _tapStartTime;

      // Only fire on quick taps with minimal movement
      if (duration > 300 || dx > 10 || dy > 10) return;

      const rect = canvasArea.getBoundingClientRect();
      const x = (t.clientX - rect.left) / rect.width;

      // Show tap flash feedback
      const flash = document.createElement('div');
      flash.className = 'lm-tap-flash';
      if (x >= 0.45) {
        flash.style.right = '0';
        flash.style.width = '55%';
        canvasArea.appendChild(flash);
        setTimeout(() => { if (flash.parentNode) flash.remove(); }, 200);
        _goPage(1);
      } else if (x <= 0.30) {
        flash.style.left = '0';
        flash.style.width = '30%';
        canvasArea.appendChild(flash);
        setTimeout(() => { if (flash.parentNode) flash.remove(); }, 200);
        _goPage(-1);
      }
    }

    canvasArea.addEventListener('touchstart', _onTapStart, { passive: true });
    canvasArea.addEventListener('touchend', _onTapEnd, { passive: true });

    // ── Initial render ──
    _renderCurrentPage();

    // ── Clock + timer ──
    const clockEl = container.querySelector('.lm-clock');
    const timerEl = container.querySelector('.lm-timer');
    function _updateClock() {
      const now = new Date();
      let h = now.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      const m = String(now.getMinutes()).padStart(2, '0');
      if (clockEl) clockEl.textContent = h + ':' + m + ' ' + ampm;

      const elapsed = Math.floor((Date.now() - _startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = String(elapsed % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = mins + ':' + secs;
    }
    _updateClock();
    _clockInterval = setInterval(_updateClock, 1000);
  }

  // ─── SETLIST EDIT VIEW ───────────────────────────────────

  function renderSetlistEdit(setlist, isNew, backToList) {
    _revokeBlobCache();
    Player.stopAll();
    _editSetlist = deepClone(setlist);
    _editSetlistIsNew = isNew;
    if (!_editSetlist.songs) _editSetlist.songs = [];

    if (isNew || backToList) {
      _pushNav(() => renderSetlists());
    } else {
      _pushNav(() => renderSetlistDetail(setlist));
    }
    _showView('setlist-edit');
    _setTopbar(isNew ? 'New Setlist' : 'Edit Setlist', true);

    const container = document.getElementById('setlist-edit-content');
    container.innerHTML = _buildSetlistEditHTML();
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
    _wireSetlistEditForm();
  }

  function _buildSetlistEditHTML() {
    const sl = _editSetlist;
    return `
      <div class="edit-section">
        <div class="edit-section-title">Setlist Info</div>
        <div class="form-field">
          <label class="form-label">Name</label>
          <input class="form-input" id="slf-name" type="text" value="${esc(sl.name)}" placeholder="e.g. Sally's Bar 12/3/25 Setlist" maxlength="200" />
        </div>
        <div class="form-field">
          <label class="form-label">Gig Date <span class="muted" style="font-weight:400">(optional — auto-archives 2 days after)</span></label>
          <input class="form-input" id="slf-gig-date" type="date" value="${esc(sl.gigDate || '')}" />
        </div>
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Songs in Setlist</div>
        <div id="slf-selected-songs" class="setlist-edit-selected"></div>
        <div class="setlist-empty-msg ${sl.songs.length ? 'hidden' : ''}" id="slf-empty-msg">No songs added yet. Use the picker below.</div>
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Add Songs</div>
        <div class="form-field">
          <input class="form-input" id="slf-picker-search" type="text" placeholder="Search songs to add…" autocomplete="off" />
        </div>
        <div id="slf-picker-list" class="setlist-picker-list"></div>
      </div>

      <div class="edit-form-actions">
        <button class="btn-primary" id="slf-save">Save Setlist</button>
        <button class="btn-secondary" id="slf-cancel">Cancel</button>
      </div>

      ${!_editSetlistIsNew ? `<div class="delete-zone"><button class="btn-danger" id="slf-delete">Delete Setlist</button></div>` : ''}
    `;
  }

  let _sortableSetlist = null;

  function _wireSetlistEditForm() {
    const sl = _editSetlist;

    function _renderSelectedSongs() {
      const container = document.getElementById('slf-selected-songs');
      const emptyMsg = document.getElementById('slf-empty-msg');
      emptyMsg.classList.toggle('hidden', sl.songs.length > 0);

      container.innerHTML = sl.songs.map((entry, i) => {
        const song = _songs.find(s => s.id === entry.id);
        const title = song ? esc(song.title) : '<em style="color:var(--text-3)">Song not found</em>';
        const key = song && song.key ? esc(song.key) : '';
        return `
          <div class="setlist-edit-row" data-idx="${i}">
            <div class="drag-handle"><i data-lucide="grip-vertical" style="width:16px;height:16px;"></i></div>
            <span class="setlist-song-num">${i + 1}</span>
            <div class="setlist-edit-row-info">
              <div class="setlist-edit-row-header">
                <span class="setlist-edit-row-title">${title}</span>
                ${key ? `<span class="setlist-edit-row-key">${key}</span>` : ''}
              </div>
              <div class="setlist-edit-comment-wrap">
                <input class="form-input setlist-comment-input" type="text"
                  value="${esc(entry.comment || '')}" placeholder="Add note…"
                  maxlength="300" data-comment-idx="${i}" />
              </div>
            </div>
            <div class="setlist-edit-row-actions">
              <button class="icon-btn sl-remove" data-idx="${i}" style="color:var(--red)"><i data-lucide="x"></i></button>
            </div>
          </div>`;
      }).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

      // Init SortableJS (destroy previous instance first)
      if (_sortableSetlist) { try { _sortableSetlist.destroy(); } catch(_){} _sortableSetlist = null; }
      if (typeof Sortable !== 'undefined' && sl.songs.length > 1) {
        _sortableSetlist = Sortable.create(container, {
          handle: '.drag-handle',
          animation: 150,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onStart: () => { haptic.light(); },
          onEnd: (evt) => {
            haptic.tap();
            const moved = sl.songs.splice(evt.oldIndex, 1)[0];
            sl.songs.splice(evt.newIndex, 0, moved);
            _renderSelectedSongs();
            _renderPicker();
          }
        });
      }

      // Wire actions
      container.querySelectorAll('.sl-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          sl.songs.splice(parseInt(btn.dataset.idx, 10), 1);
          _renderSelectedSongs();
          _renderPicker();
        });
      });
      container.querySelectorAll('.setlist-comment-input').forEach(input => {
        input.addEventListener('input', () => {
          const idx = parseInt(input.dataset.commentIdx, 10);
          if (sl.songs[idx]) sl.songs[idx].comment = input.value;
        });
      });
    }

    function _renderPicker() {
      const search = (document.getElementById('slf-picker-search')?.value || '').toLowerCase();
      const selectedIds = new Set(sl.songs.map(e => e.id));
      let available = [..._songs]
        .filter(s => !selectedIds.has(s.id))
        .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

      if (search) {
        available = available.filter(s =>
          (s.title || '').toLowerCase().includes(search) ||
          (s.key || '').toLowerCase().includes(search) ||
          (s.tags || []).some(t => t.toLowerCase().includes(search))
        );
      }

      const container = document.getElementById('slf-picker-list');
      if (available.length === 0) {
        container.innerHTML = `<div class="muted" style="font-size:13px;padding:8px 0">${search ? 'No matching songs.' : 'All songs added.'}</div>`;
        return;
      }

      container.innerHTML = available.map(s => `
        <div class="setlist-picker-row" data-pick-id="${esc(s.id)}">
          <div class="setlist-picker-info">
            <span class="setlist-picker-title">${esc(s.title)}</span>
            <span class="setlist-picker-meta">
              ${s.key ? esc(s.key) : ''}${s.key && s.bpm ? ' · ' : ''}${s.bpm ? esc(String(s.bpm)) + ' bpm' : ''}${(s.key || s.bpm) && s.timeSig ? ' · ' : ''}${s.timeSig ? esc(s.timeSig) : ''}
            </span>
          </div>
          <button class="btn-ghost sl-add-btn" data-pick-id="${esc(s.id)}">Add</button>
        </div>
      `).join('');

      container.querySelectorAll('.sl-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          sl.songs.push({ id: btn.dataset.pickId, comment: '' });
          _renderSelectedSongs();
          _renderPicker();
        });
      });
    }

    _renderSelectedSongs();
    _renderPicker();

    document.getElementById('slf-picker-search').addEventListener('input', () => _renderPicker());

    // Save
    document.getElementById('slf-save').addEventListener('click', async () => {
      if (_savingSetlists) return;
      sl.name = document.getElementById('slf-name').value.trim();
      if (!sl.name) { showToast('Name is required.'); document.getElementById('slf-name').focus(); return; }
      _savingSetlists = true;
      sl._ts = Date.now();
      try {
        sl.gigDate = document.getElementById('slf-gig-date').value || '';
        if (typeof sl.archived === 'undefined') sl.archived = false;
        sl.updatedAt = new Date().toISOString();
        if (_editSetlistIsNew) {
          _setlists.push(sl);
        } else {
          const idx = _setlists.findIndex(s => s.id === sl.id);
          if (idx > -1) _setlists[idx] = sl;
        }
        await saveSetlists();
        _activeSetlist = null;
        renderSetlists();
      } finally {
        _savingSetlists = false;
      }
    });

    // Cancel
    document.getElementById('slf-cancel').addEventListener('click', () => {
      _navigateBack();
    });

    // Delete
    document.getElementById('slf-delete')?.addEventListener('click', () => {
      Admin.showConfirm('Delete Setlist', `Permanently delete "${sl.name || 'this setlist'}"?`, async () => {
        if (GitHub.isConfigured()) GitHub.trackDeletion('setlists', sl.id);
        _setlists = _setlists.filter(s => s.id !== sl.id);
        await saveSetlists();
        _activeSetlist = null;
        renderSetlists();
      });
    });
  }

  // ─── ADMIN DASHBOARD ────────────────────────────────────────

  function renderDashboard() {
    _revokeBlobCache();
    _navStack = [];
    _pushNav(() => renderList());
    _showView('dashboard');
    _setTopbar('Admin Dashboard', true);

    const container = document.getElementById('dashboard-content');

    // ─── Gather stats ───
    const totalSongs = _songs.length;
    const totalSetlists = _setlists.length;
    const totalPersonas = _practice.length;
    const totalPracticeLists = _practice.reduce((sum, p) => sum + (p.practiceLists || []).length, 0);
    const allTags = new Set();
    _songs.forEach(s => (s.tags || []).forEach(t => allTags.add(t)));

    // ─── Analyze issues ───
    // Severity levels & diagnostic codes:
    //   errors       = broken data that WILL cause errors (red, 1xxx)
    //   warnOrange   = degraded state that SHOULD be fixed (orange, 2xxx)
    //   warnYellow   = cosmetic / low-priority (yellow, 3xxx)
    //   infoBlue     = purely informational, no action (blue, 4xxx)
    // Every actionable item MUST include a "Fix:" hint.
    const errors = [];
    const warnOrange = [];
    const warnYellow = [];
    const infoBlue = [];

    // Collect all driveIds referenced by songs (used by multiple checks)
    const referencedDriveIds = new Set();
    const driveIdToSong = {};
    const emptyDriveIds = [];
    _songs.forEach(s => {
      const a = s.assets || {};
      [...(a.charts || []), ...(a.audio || [])].forEach(f => {
        if (f.driveId && f.driveId.trim()) {
          referencedDriveIds.add(f.driveId);
          if (!driveIdToSong[f.driveId]) driveIdToSong[f.driveId] = [];
          driveIdToSong[f.driveId].push(s);
        } else {
          emptyDriveIds.push({ song: s.title || s.id, file: f.name || '(unnamed)' });
        }
      });
    });
    const songIdSet = new Set(_songs.map(s => s.id));

    // ── ERRORS (red, 1xxx) — broken data that WILL cause errors ──

    // 1001: Songs with no title
    const untitled = _songs.filter(s => !s.title || !s.title.trim());
    if (untitled.length) {
      errors.push({
        code: 1001, // Red-Songs-NoTitle
        title: `${untitled.length} song${untitled.length > 1 ? 's' : ''} with no title`,
        detail: 'Fix: Edit each song and add a title.',
        items: untitled.map(s => `ID: ${s.id}`)
      });
    }

    // 1002: File references with empty Drive IDs
    if (emptyDriveIds.length) {
      errors.push({
        code: 1101, // Red-Files-MissingDriveID
        title: `${emptyDriveIds.length} file${emptyDriveIds.length > 1 ? 's' : ''} with missing Drive ID`,
        detail: 'These attachments cannot be loaded. Fix: Edit the song and re-upload the file, or remove the broken attachment.',
        items: emptyDriveIds.map(e => `"${esc(e.file)}" in "${esc(e.song)}"`)
      });
    }

    // 1003: Practice lists referencing deleted songs
    const orphanPractice = [];
    _practice.forEach(persona => {
      (persona.practiceLists || []).forEach(pl => {
        (pl.songs || []).forEach(entry => {
          if (entry.songId && !songIdSet.has(entry.songId)) {
            orphanPractice.push({ persona: persona.name, list: pl.name, songId: entry.songId });
          }
        });
      });
    });
    if (orphanPractice.length) {
      errors.push({
        code: 1201, // Red-Practice-OrphanRefs
        title: `${orphanPractice.length} practice entry${orphanPractice.length > 1 ? 'ies' : 'y'} referencing deleted songs`,
        detail: 'These entries will show as missing. Fix: Edit the practice list and remove the broken entries, or re-add the song to the repository.',
        items: orphanPractice.map(o => `"${esc(o.persona)}" → "${esc(o.list)}" → song ${o.songId}`)
      });
    }

    // 1004: Setlists referencing deleted songs
    const orphanSetlist = [];
    _setlists.forEach(sl => {
      (sl.songs || []).forEach(entry => {
        const sid = entry.id || entry.songId;
        if (sid && !songIdSet.has(sid)) {
          orphanSetlist.push({ setlist: sl.name, songId: sid });
        }
      });
    });
    if (orphanSetlist.length) {
      errors.push({
        code: 1301, // Red-Setlists-OrphanRefs
        title: `${orphanSetlist.length} setlist entry${orphanSetlist.length > 1 ? 'ies' : 'y'} referencing deleted songs`,
        detail: 'These entries will show as missing. Fix: Edit the setlist and remove the broken entries, or re-add the song to the repository.',
        items: orphanSetlist.map(o => `"${esc(o.setlist)}" → song ${o.songId}`)
      });
    }

    // ── ORANGE WARNINGS (2xxx) — degraded state, should address ──

    // 2001: Songs with no assets
    const noAssets = _songs.filter(s => {
      const a = s.assets || {};
      return !(a.charts || []).length && !(a.audio || []).length && !(a.links || []).length;
    });
    if (noAssets.length) {
      warnOrange.push({
        code: 2001, // Orange-Songs-NoAssets
        title: `${noAssets.length} song${noAssets.length > 1 ? 's' : ''} with no files or links`,
        detail: 'These songs have no charts, audio, or links. Fix: Edit each song and attach files or add links.',
        items: noAssets.map(s => esc(s.title || s.id))
      });
    }

    // 2002: Drive not connected (suppress post-migration — Drive is only for PDFs/audio)
    const _migrated = localStorage.getItem('bb_migrated_to_github') === '1';
    if (!Drive.isConfigured() && !_migrated) {
      warnOrange.push({
        code: 2401, // Orange-Drive-NotConnected
        title: 'Drive not connected',
        detail: 'No API key or folder ID set. Songs load from local cache only. Fix: Open the Drive Setup modal and enter your credentials.'
      });
    }

    // 2003: Drive is read-only (suppress post-migration — metadata syncs via GitHub now)
    if (Drive.isConfigured() && !Drive.isWriteConfigured() && !_migrated) {
      warnOrange.push({
        code: 2402, // Orange-Drive-ReadOnly
        title: 'Drive is read-only — changes won\'t sync',
        detail: 'OAuth Client ID is not set. All saves are local-only and won\'t be visible to other users. Fix: Set up an OAuth Client ID in Google Cloud Console and enter it in the Drive Setup modal.'
      });
    }

    // 2004: Duplicate song titles
    const titleCounts = {};
    _songs.forEach(s => {
      const t = (s.title || '').trim().toLowerCase();
      if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
    });
    const dupTitles = Object.entries(titleCounts).filter(([, c]) => c > 1);
    if (dupTitles.length) {
      warnOrange.push({
        code: 2002, // Orange-Songs-DuplicateTitles
        title: `${dupTitles.length} duplicate song title${dupTitles.length > 1 ? 's' : ''}`,
        detail: 'Multiple songs share the same title, which can cause confusion. Fix: Rename one of the duplicates or delete the extra copy.',
        items: dupTitles.map(([t, c]) => `"${esc(t)}" (${c} copies)`)
      });
    }

    // ── YELLOW WARNINGS (3xxx) — low priority, cosmetic ──────

    // 3001: Songs without tags
    const noTags = _songs.filter(s => !(s.tags || []).length);
    if (noTags.length > 0 && noTags.length < totalSongs) {
      warnYellow.push({
        code: 3001, // Yellow-Songs-NoTags
        title: `${noTags.length} song${noTags.length > 1 ? 's' : ''} without tags`,
        detail: 'Untagged songs won\'t appear when filtering by tag. Fix: Edit the song and add relevant tags.',
        items: noTags.length <= 10 ? noTags.map(s => esc(s.title || s.id)) : [
          ...noTags.slice(0, 8).map(s => esc(s.title || s.id)),
          `…and ${noTags.length - 8} more`
        ]
      });
    }

    // 3002: Files shared across multiple songs
    const dupes = Object.entries(driveIdToSong).filter(([, songs]) => songs.length > 1);
    if (dupes.length) {
      warnYellow.push({
        code: 3101, // Yellow-Files-SharedAcrossSongs
        title: `${dupes.length} file${dupes.length > 1 ? 's' : ''} shared across multiple songs`,
        detail: 'The same Drive file is attached to more than one song. This is usually fine, but deleting the file from one song would break the other. Fix: If unintentional, re-upload a separate copy to each song.',
        items: dupes.map(([id, songs]) => `${id.slice(0, 12)}… → ${songs.map(s => esc(s.title || s.id)).join(', ')}`)
      });
    }

    // ─── Render ───
    const totalErrors = errors.length;
    const totalOrange = warnOrange.length;
    const totalYellow = warnYellow.length;
    const healthStatus = totalErrors > 0 ? 'Errors Found' : totalOrange > 0 ? 'Warnings' : totalYellow > 0 ? 'Minor Warnings' : 'All Clear';
    const healthBadge = totalErrors > 0 ? 'warn' : totalOrange > 0 ? 'warn' : 'ok';

    const _codeTag = (code) => `<span class="dash-alert-code">${code}</span>`;

    let html = `
      <div class="dash-header">
        <h2>Admin Dashboard</h2>
        <p>System health and data integrity overview</p>
        <span class="dash-version">${APP_VERSION}</span>
      </div>

      <div class="dash-summary">
        <div class="dash-stat">
          <div class="dash-stat-value">${totalSongs}</div>
          <div class="dash-stat-label">Songs</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value">${allTags.size}</div>
          <div class="dash-stat-label">Tags</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value">${totalSetlists}</div>
          <div class="dash-stat-label">Setlists</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value">${totalPersonas}</div>
          <div class="dash-stat-label">Personas</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value">${totalPracticeLists}</div>
          <div class="dash-stat-label">Practice Lists</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value">${referencedDriveIds.size}</div>
          <div class="dash-stat-label">Drive Files</div>
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">
          System Health
          <span class="dash-section-badge ${healthBadge}">${healthStatus}</span>
        </div>`;

    if (totalErrors === 0 && totalOrange === 0 && totalYellow === 0) {
      html += `<div class="dash-ok">All ${totalSongs} songs, ${totalSetlists} setlists, and ${totalPracticeLists} practice lists checked — no problems found.</div>`;
    }

    // Red errors (1xxx)
    errors.forEach(e => {
      html += `<div class="dash-alert">
        <div class="dash-alert-title">${_codeTag(e.code)} ${e.title}</div>
        ${e.detail ? `<div class="dash-alert-detail">${e.detail}</div>` : ''}
        ${e.items ? `<ul class="dash-file-list">${e.items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
      </div>`;
    });

    // Orange warnings (2xxx)
    warnOrange.forEach(w => {
      html += `<div class="dash-alert warn-orange">
        <div class="dash-alert-title">${_codeTag(w.code)} ${w.title}</div>
        ${w.detail ? `<div class="dash-alert-detail">${w.detail}</div>` : ''}
        ${w.items ? `<ul class="dash-file-list">${w.items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
      </div>`;
    });

    // Yellow warnings (3xxx)
    warnYellow.forEach(w => {
      html += `<div class="dash-alert warn-yellow">
        <div class="dash-alert-title">${_codeTag(w.code)} ${w.title}</div>
        ${w.detail ? `<div class="dash-alert-detail">${w.detail}</div>` : ''}
        ${w.items ? `<ul class="dash-file-list">${w.items.map(it => `<li>${it}</li>`).join('')}</ul>` : ''}
      </div>`;
    });

    html += `</div>`; // close dash-section

    // Data breakdown
    html += `
      <div class="dash-section">
        <div class="dash-section-title">Data Breakdown</div>
        <div class="dash-alert info">
          <div class="dash-alert-title">${_codeTag(4101)} File Attachment Summary</div>
          <div class="dash-alert-detail">
            ${_songs.filter(s => (s.assets?.charts || []).length).length} songs have charts ·
            ${_songs.filter(s => (s.assets?.audio || []).length).length} songs have audio ·
            ${_songs.filter(s => (s.assets?.links || []).length).length} songs have links
          </div>
        </div>
        <div class="dash-alert info">
          <div class="dash-alert-title">${_codeTag(4501)} Storage</div>
          <div class="dash-alert-detail">
            Songs JSON: ~${(JSON.stringify(_songs).length / 1024).toFixed(1)} KB ·
            Setlists JSON: ~${(JSON.stringify(_setlists).length / 1024).toFixed(1)} KB ·
            Practice JSON: ~${(JSON.stringify(_practice).length / 1024).toFixed(1)} KB
          </div>
        </div>
      </div>
    `;

    // GitHub sync status — always visible
    html += `<div class="dash-section"><div class="dash-section-title">GitHub Sync</div>`;
    if (GitHub.isConfigured()) {
      const rl = GitHub.getRateLimitStatus();
      const wq = GitHub.getWriteQueueStatus();
      const migrated = localStorage.getItem('bb_migrated_to_github') === '1';
      const fillClass = rl.warnLevel === 'critical' ? 'critical' : rl.warnLevel === 'warning' ? 'warning' : '';
      html += `
          <div class="dash-alert info">
            <div class="dash-alert-title">${_codeTag(4601)} GitHub Connection</div>
            <div class="dash-github-status">
              <div class="status-row"><span>Repository</span><span>${esc(GitHub.getConfig().owner + '/' + GitHub.getConfig().repo)}</span></div>
              <div class="status-row"><span>Data Branch</span><span>data</span></div>
              <div class="status-row"><span>Migrated</span><span style="color:${migrated ? 'var(--green)' : 'var(--text-3)'}">${migrated ? 'Yes' : 'No'}</span></div>
              <div class="status-row"><span>Write Queue</span><span>${wq.hasPending ? wq.pendingTypes.join(', ') + (wq.flushing ? ' (flushing)' : ' (pending)') : 'Empty'}</span></div>
            </div>
            <div style="margin-top:8px;">
              <div class="dash-alert-detail" style="font-size:11px;margin-bottom:4px;">API Usage: ${rl.callsThisHour} / ${rl.limit} (${rl.pct}%)</div>
              <div class="dash-rate-bar"><div class="dash-rate-fill ${fillClass}" style="width:${Math.min(rl.pct, 100)}%"></div></div>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button id="dash-github-push" class="btn-primary" style="font-size:11px;padding:6px 14px;">Push Now</button>
              <button id="dash-github-setup" class="btn-secondary" style="font-size:11px;padding:6px 14px;">GitHub Setup</button>
              <button id="dash-run-diag" class="btn-secondary" style="font-size:11px;padding:6px 14px;">Run Diagnostics</button>
              ${!migrated ? '<button id="dash-github-migrate" class="btn-primary" style="font-size:11px;padding:6px 14px;background:var(--green);color:#000;">Migrate to GitHub</button>' : ''}
            </div>
          </div>`;
    } else {
      html += `
          <div class="dash-alert warn-orange">
            <div class="dash-alert-title">${_codeTag(2501)} GitHub not configured</div>
            <div class="dash-alert-detail">Connect GitHub for encrypted metadata sync across all devices (including mobile).</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button id="dash-github-setup" class="btn-primary" style="font-size:11px;padding:6px 14px;">Configure GitHub</button>
              <button id="dash-run-diag" class="btn-secondary" style="font-size:11px;padding:6px 14px;">Run Diagnostics</button>
            </div>
          </div>`;
    }
    html += `</div>`;

    // Drive sync diagnostic — runs async after initial render
    const _driveSectionTitle = (GitHub.isConfigured() && localStorage.getItem('bb_migrated_to_github') === '1')
      ? 'Drive Status (Legacy — PDFs/Audio only)' : 'Drive Sync Status';
    html += `
      <div class="dash-section">
        <div class="dash-section-title">${_driveSectionTitle}</div>
        <div id="dash-drive-sync" class="dash-alert info">
          <div class="dash-alert-detail">Checking Drive…</div>
        </div>
      </div>
    `;

    // Tag Manager section (admin only)
    if (Admin.isEditMode()) {
      const tagCounts = {};
      _songs.forEach(s => (s.tags || []).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }));
      const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

      html += `<div class="dash-section"><div class="dash-section-title">Tag Manager</div>`;
      if (sortedTags.length === 0) {
        html += `<p class="muted" style="font-size:13px">No tags in use.</p>`;
      } else {
        html += `<div class="tag-manager-list">`;
        sortedTags.forEach(([tag, count]) => {
          html += `<div class="tag-mgr-row" data-tag="${esc(tag)}">
            <span class="tag-mgr-name">${esc(tag)}</span>
            <span class="tag-mgr-count">${count} song${count !== 1 ? 's' : ''}</span>
            <button class="tag-mgr-btn tag-mgr-rename" data-tag="${esc(tag)}" title="Rename">
              <i data-lucide="pencil" style="width:12px;height:12px;"></i>
            </button>
            <button class="tag-mgr-btn tag-mgr-delete" data-tag="${esc(tag)}" title="Delete">
              <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
            </button>
          </div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire Tag Manager
    container.querySelectorAll('.tag-mgr-rename').forEach(btn => {
      btn.addEventListener('click', () => {
        const oldTag = btn.dataset.tag;
        const row = btn.closest('.tag-mgr-row');
        const nameEl = row.querySelector('.tag-mgr-name');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input tag-mgr-input';
        input.value = oldTag;
        input.style.cssText = 'font-size:13px;padding:4px 8px;width:120px;';
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'tag-mgr-btn tag-mgr-confirm';
        confirmBtn.title = 'Confirm rename';
        confirmBtn.innerHTML = '<i data-lucide="check" style="width:12px;height:12px;"></i>';
        btn.replaceWith(confirmBtn);
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [confirmBtn] });

        async function doRename() {
          const newTag = input.value.trim();
          if (!newTag || newTag === oldTag) { renderDashboard(); return; }
          let changed = 0;
          _songs.forEach(s => {
            const tags = s.tags || [];
            const idx = tags.indexOf(oldTag);
            if (idx > -1) {
              tags.splice(idx, 1);
              if (!tags.includes(newTag)) tags.push(newTag);
              s.tags = tags;
              changed++;
            }
          });
          if (changed) {
            await saveSongs();
            showToast('Renamed "' + oldTag + '" to "' + newTag + '" in ' + changed + ' song' + (changed !== 1 ? 's' : ''));
          }
          renderDashboard();
        }

        confirmBtn.addEventListener('click', doRename);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doRename();
          if (e.key === 'Escape') renderDashboard();
        });
      });
    });

    container.querySelectorAll('.tag-mgr-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        Admin.showConfirm('Delete Tag', 'Remove "' + tag + '" from all songs?', async () => {
          let changed = 0;
          _songs.forEach(s => {
            const tags = s.tags || [];
            const idx = tags.indexOf(tag);
            if (idx > -1) {
              tags.splice(idx, 1);
              s.tags = tags;
              changed++;
            }
          });
          if (changed) {
            await saveSongs();
            showToast('Removed "' + tag + '" from ' + changed + ' song' + (changed !== 1 ? 's' : ''));
          }
          renderDashboard();
        });
      });
    });

    // Wire GitHub dashboard buttons
    const ghPushBtn = document.getElementById('dash-github-push');
    if (ghPushBtn) {
      ghPushBtn.addEventListener('click', async () => {
        ghPushBtn.disabled = true;
        ghPushBtn.textContent = 'Pushing…';
        try {
          await GitHub.flushNow();
          showToast('GitHub push complete.');
          renderDashboard();
        } catch (e) {
          showToast('GitHub push failed: ' + (e.message || 'unknown error'));
          ghPushBtn.disabled = false;
          ghPushBtn.textContent = 'Push Now';
        }
      });
    }
    const ghSetupBtn = document.getElementById('dash-github-setup');
    if (ghSetupBtn) {
      ghSetupBtn.addEventListener('click', () => Admin.showGitHubModal(() => renderDashboard()));
    }
    const diagBtn = document.getElementById('dash-run-diag');
    if (diagBtn) {
      diagBtn.addEventListener('click', () => {
        diagBtn.disabled = true;
        diagBtn.textContent = 'Running...';
        // Insert diag panel after the GitHub section
        let panel = document.getElementById('diag-panel');
        if (!panel) {
          panel = document.createElement('div');
          panel.id = 'diag-panel';
          panel.className = 'diag-panel';
          // Insert after the GitHub sync section
          const ghSection = diagBtn.closest('.dash-section');
          if (ghSection) ghSection.after(panel);
          else container.appendChild(panel);
        }
        panel.innerHTML = '<div style="color:var(--accent);padding:8px 0;">Initializing diagnostics...</div>';
        runDiagnostics(panel).then(() => {
          diagBtn.disabled = false;
          diagBtn.textContent = 'Run Diagnostics';
        });
      });
    }
    let _migrating = false;
    const ghMigrateBtn = document.getElementById('dash-github-migrate');
    if (ghMigrateBtn) {
      ghMigrateBtn.addEventListener('click', async () => {
        if (_migrating) return;
        _migrating = true;
        ghMigrateBtn.disabled = true;
        ghMigrateBtn.textContent = 'Migrating…';
        try {
          // Backup
          localStorage.setItem('_migration_backup', JSON.stringify({
            songs: _songs, setlists: _setlists, practice: _practice,
          }));
          // Migrate
          await GitHub.migrateData({ songs: _songs, setlists: _setlists, practice: _practice });
          localStorage.setItem('bb_migrated_to_github', '1');
          localStorage.removeItem('_migration_backup'); // Cleanup
          // Publish encrypted PAT to Drive so other devices can auto-configure
          GitHub.publishPat().catch(e => console.warn('Could not publish PAT to Drive', e));
          showToast('Migration complete! Data is now syncing via GitHub.');
          renderDashboard();
        } catch (e) {
          console.error('Migration failed', e);
          showToast('Migration failed: ' + (e.message || 'unknown error'));
          ghMigrateBtn.disabled = false;
          ghMigrateBtn.textContent = 'Migrate to GitHub';
        } finally {
          _migrating = false;
        }
      });
    }

    // Async Drive check
    (async () => {
      const el = document.getElementById('dash-drive-sync');
      if (!el) return;
      const _isMigrated = localStorage.getItem('bb_migrated_to_github') === '1';

      if (!Drive.isConfigured()) {
        el.style.borderLeftColor = _isMigrated ? 'var(--accent-dim)' : '#f59e0b';
        el.innerHTML = _isMigrated
          ? `<div class="dash-alert-title">${_codeTag(4401)} Drive not connected</div>` +
            `<div class="dash-alert-detail">Drive is optional post-migration. Connect it only if you need to manage PDFs and audio files.</div>`
          : `<div class="dash-alert-title">${_codeTag(2401)} Drive not connected</div>` +
            `<div class="dash-alert-detail">No API key or folder ID configured.</div>`;
        return;
      }

      // Post-migration: simplified Drive status (PDFs/audio only, no sync comparison)
      if (_isMigrated) {
        const cfg = Drive.getConfig();
        el.style.borderLeftColor = 'var(--accent-dim)';
        el.innerHTML =
          `<div class="dash-alert-title">${_codeTag(4402)} Drive Connected</div>` +
          `<div class="dash-alert-detail" style="font-size:11px;color:var(--text-3);">` +
          `Used for PDFs and audio files only. Metadata syncs via GitHub.<br><br>` +
          `API Key: ${cfg.apiKey ? '✓ set' : '✗ missing'} · ` +
          `Client ID: ${cfg.clientId ? '✓ set' : '✗ missing'} · ` +
          `Folder ID: ${cfg.folderId ? '✓ set' : '✗ missing'}</div>`;
        return;
      }

      // Pre-migration: full Drive sync comparison with action buttons
      try {
        if (!_lastDriveSnapshot) {
          el.innerHTML = `<div class="dash-alert-title">${_codeTag(4401)} No sync data yet</div>` +
            `<div class="dash-alert-detail">Drive data will appear after the next sync. Use the refresh button on the main page to trigger a sync.</div>`;
          return;
        }
        const { songs, setlists, practice } = _lastDriveSnapshot;
        const driveSongs = Array.isArray(songs) ? songs.length : 0;
        const driveSetlists = Array.isArray(setlists) ? setlists.length : 0;
        const drivePersonas = Array.isArray(practice) ? practice.length : 0;
        const drivePLists = Array.isArray(practice)
          ? practice.reduce((sum, p) => sum + (p.practiceLists || p.lists || []).length, 0) : 0;

        const localSongs = _songs.length;
        const localSetlists = _setlists.length;
        const localPersonas = _practice.length;
        const localPLists = _practice.reduce((sum, p) => sum + (p.practiceLists || []).length, 0);

        const songMatch = driveSongs === localSongs;
        const setlistMatch = driveSetlists === localSetlists;
        const personaMatch = drivePersonas === localPersonas;
        const plistMatch = drivePLists === localPLists;
        const allMatch = songMatch && setlistMatch && personaMatch && plistMatch;

        const row = (label, local, drive, match) =>
          `<div style="display:flex;justify-content:space-between;padding:2px 0;">` +
          `<span>${label}</span>` +
          `<span style="color:${match ? 'var(--text-3)' : '#e87c6a'};">${local} local / ${drive} on Drive${match ? '' : ' ⚠'}</span>` +
          `</div>`;

        el.style.borderLeftColor = allMatch ? 'var(--accent-dim)' : '#e87c6a';
        const pushBtn = !allMatch
          ? `<button id="dash-push-drive" class="btn-primary" style="margin-top:8px;font-size:11px;padding:6px 14px;">Push All to Drive</button>`
          : '';
        const fixShareBtn = Drive.isWriteConfigured()
          ? `<button id="dash-fix-sharing" class="btn-secondary" style="margin-top:6px;font-size:11px;padding:6px 14px;">Fix Sharing (make files public)</button>`
          : '';
        el.innerHTML =
          `<div class="dash-alert-title">${allMatch ? `${_codeTag(4402)} In Sync` : `${_codeTag(2403)} Out of Sync`}</div>` +
          `<div class="dash-alert-detail" style="font-family:var(--font-mono);font-size:11px;">` +
          row('Songs', localSongs, driveSongs, songMatch) +
          row('Setlists', localSetlists, driveSetlists, setlistMatch) +
          row('Personas', localPersonas, drivePersonas, personaMatch) +
          row('Practice Lists', localPLists, drivePLists, plistMatch) +
          `</div>` +
          `<div class="dash-alert-detail" style="margin-top:6px;font-size:11px;color:var(--text-3);">` +
          `Write access: ${Drive.isWriteConfigured() ? 'Yes' : 'No (read-only)'}<br>` +
          `API Key: ${Drive.getConfig().apiKey ? '✓ set' : '✗ missing'} · ` +
          `Client ID: ${Drive.getConfig().clientId ? '✓ set' : '✗ missing'} · ` +
          `Folder ID: ${Drive.getConfig().folderId ? '✓ set' : '✗ missing'}</div>` +
          pushBtn + fixShareBtn;
        const pushEl = document.getElementById('dash-push-drive');
        if (pushEl) {
          pushEl.addEventListener('click', async () => {
            pushEl.disabled = true;
            pushEl.textContent = 'Pushing…';
            try {
              await Promise.all([
                Drive.saveSongs(_songs),
                Drive.saveSetlists(_setlists),
                Drive.savePractice(_practice),
              ]);
              showToast('All data pushed to Drive. File sharing permissions updated.');
              renderDashboard();
            } catch (e) {
              console.error('Push to Drive failed', e);
              showToast('Push failed: ' + (e.message || 'unknown error'));
              pushEl.disabled = false;
              pushEl.textContent = 'Push All to Drive';
            }
          });
        }
        const fixEl = document.getElementById('dash-fix-sharing');
        if (fixEl) {
          fixEl.addEventListener('click', async () => {
            fixEl.disabled = true;
            fixEl.textContent = 'Fixing…';
            try {
              await Promise.all([
                Drive.saveSongs(_songs),
                Drive.saveSetlists(_setlists),
                Drive.savePractice(_practice),
              ]);
              showToast('All Drive files re-shared as public. Other devices should now sync.');
              renderDashboard();
            } catch (e) {
              showToast('Fix sharing failed: ' + (e.message || 'unknown error'));
              fixEl.disabled = false;
              fixEl.textContent = 'Fix Sharing';
            }
          });
        }
      } catch (e) {
        el.style.borderLeftColor = '#e87c6a';
        el.innerHTML = `<div class="dash-alert-title">${_codeTag(1401)} Drive check failed</div>` +
          `<div class="dash-alert-detail" style="font-size:12px;word-break:break-all;">${esc(String(e.message || e))}<br><br>` +
          `If this persists, try: close and reopen the app, or clear site data in Safari settings.</div>`;
      }
    })();
  }

  // ─── PRACTICE LISTS — Data ─────────────────────────────────

  let _practice = [];   // Array of persona objects
  let _activePersona = null;
  let _editPersona = null;
  let _editPersonaIsNew = false;
  let _activePracticeList = null;
  let _editPracticeList = null;
  let _editPracticeListIsNew = false;

  function _hslFromName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const h = ((hash % 360) + 360) % 360;
    return `hsl(${h}, 60%, 55%)`;
  }

  function _safeColor(color) {
    return /^hsl\(\d+,\s*\d+%,\s*\d+%\)$/.test(color) ? color : _hslFromName('default');
  }

  function _personaInitials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  }

  function _loadPracticeLocal() {
    try { return _migrateSchema(JSON.parse(localStorage.getItem('bb_practice') || '[]'), 'practice'); }
    catch { return []; }
  }

  function _savePracticeLocal(data) {
    try { localStorage.setItem('bb_practice', JSON.stringify(data)); }
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
    const local = _loadPracticeLocal();
    if (local.length > 0) { _practice = local; return; }
    const sw = await _loadPracticeFromSWCache();
    if (sw && sw.length > 0) { _practice = sw; _savePracticeLocal(sw); }
  }

  function _migratePracticeData() {
    let changed = false;
    _practice.forEach(persona => {
      if (persona.lists && !persona.practiceLists) {
        persona.practiceLists = [{
          id: Admin.generateId(persona.lists),
          name: 'Practice List',
          archived: false,
          createdAt: new Date().toISOString(),
          songs: persona.lists
        }];
        delete persona.lists;
        changed = true;
      }
      if (!persona.practiceLists) {
        persona.practiceLists = [];
        changed = true;
      }
    });
    if (changed) _savePracticeLocal(_practice);
  }

  async function savePractice(toastMsg) {
    _savePracticeLocal(_practice);
    if (GitHub.isConfigured()) {
      GitHub.savePractice(_practice);
      showToast(toastMsg || 'Saved. Syncing to GitHub…');
      _markSynced();
      return;
    }
    // Drive metadata saves: desktop-only, pre-migration only
    if (!_isMobile() && Drive.isWriteConfigured()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await Drive.savePractice(_practice);
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

  // ─── PRACTICE — Persona List View ────────────────────────

  function renderPractice(skipNavReset) {
    _revokeBlobCache();
    if (!skipNavReset) {
      _navStack = [];
      _pushNav(() => renderList());
    }
    _showView('practice');
    _setTopbar('Practice Lists', true);

    const container = document.getElementById('practice-list');
    let html = `<div class="view-refresh-row">
      <button class="icon-btn view-refresh-btn" id="btn-refresh-practice" title="Sync from Drive" aria-label="Refresh">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>`;

    if (Admin.isEditMode()) {
      html += `<button class="btn-ghost setlist-add-btn" id="btn-new-persona">+ New Persona</button>`;
    }

    if (_practice.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No practice personas yet.</p>
        <p class="muted">${Admin.isEditMode() ? 'Create one above.' : 'Practice personas will appear here.'}</p>
      </div>`;
    } else {
      _practice.forEach(p => {
        const color = _safeColor(p.color || _hslFromName(p.name));
        const pLists = (p.practiceLists || []).filter(l => !l.archived);
        const listCount = pLists.length;
        const adminBtns = Admin.isEditMode()
          ? `<button class="song-card-edit-btn persona-edit-btn" data-edit-persona="${esc(p.id)}" title="Edit"><i data-lucide="pencil"></i></button>` +
            `<button class="song-card-edit-btn persona-delete-btn" data-delete-persona="${esc(p.id)}" title="Delete"><i data-lucide="trash-2"></i></button>`
          : '';
        html += `
          <div class="persona-card" data-persona-id="${esc(p.id)}">
            <div class="persona-avatar" style="background:${color}">${_personaInitials(p.name)}</div>
            <div class="persona-card-info">
              <div class="persona-card-title-row">
                <span class="persona-card-name">${esc(p.name)}</span>
                ${adminBtns}
              </div>
              <span class="persona-card-count">${listCount} practice list${listCount !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
      });
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire refresh
    document.getElementById('btn-refresh-practice')?.addEventListener('click', () => {
      _doSyncRefresh(() => renderPractice(true));
    });

    container.querySelectorAll('.persona-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.persona-edit-btn') || e.target.closest('.persona-delete-btn')) return;
        const p = _practice.find(x => x.id === card.dataset.personaId);
        if (p) renderPracticeDetail(p);
      });
    });

    container.querySelectorAll('.persona-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = _practice.find(x => x.id === btn.dataset.editPersona);
        if (p) renderPracticeEdit(p, false);
      });
    });

    container.querySelectorAll('.persona-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_savingPractice) return;
        const p = _practice.find(x => x.id === btn.dataset.deletePersona);
        if (!p) return;
        Admin.showConfirm('Delete Persona', `Permanently delete "${esc(p.name || 'this persona')}" and all their practice lists?`, async () => {
          if (_savingPractice) return;
          _savingPractice = true;
          if (GitHub.isConfigured()) GitHub.trackDeletion('practice', p.id);
          const backup = [..._practice];
          try {
            _practice = _practice.filter(x => x.id !== p.id);
            await savePractice('Persona deleted.');
            _activePersona = null;
            renderPractice(true);
          } catch (err) {
            console.error('Delete persona failed', err);
            _practice = backup;
            showToast('Delete failed.');
            renderPractice(true);
          } finally {
            _savingPractice = false;
          }
        });
      });
    });

    document.getElementById('btn-new-persona')?.addEventListener('click', () => {
      const newP = {
        id: Admin.generateId(_practice),
        name: '',
        color: '',
        practiceLists: [],
      };
      renderPracticeEdit(newP, true);
    });
  }

  // ─── PRACTICE — Persona Practice Lists Selection ─────────

  function renderPracticeDetail(persona, skipNavPush) {
    _revokeBlobCache();
    Player.stopAll();
    _activePersona = persona;
    _activePracticeList = null;
    if (!skipNavPush) _pushNav(() => renderPractice());
    _showView('practice-detail');
    _setTopbar(persona.name || 'Persona', true);

    const container = document.getElementById('practice-detail-content');
    const color = _safeColor(persona.color || _hslFromName(persona.name));
    const allLists = persona.practiceLists || [];
    const activeLists = allLists.filter(l => !l.archived);
    const archivedLists = allLists.filter(l => l.archived);

    let html = `<div class="view-refresh-row">
      <button class="icon-btn view-refresh-btn" id="btn-refresh-practice-detail" title="Sync from Drive" aria-label="Refresh">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>`;
    html += `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-persona">Edit Persona</button></div>` : ''}
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
        <div class="persona-avatar persona-avatar-lg" style="background:${color}">${_personaInitials(persona.name)}</div>
        <div class="detail-title" style="margin-bottom:0">${esc(persona.name) || 'Unnamed'}</div>
      </div>
      <div class="detail-subtitle">${activeLists.length} practice list${activeLists.length !== 1 ? 's' : ''}</div>
    </div>`;

    // New Practice List button — NOT admin-gated
    html += `<button class="btn-ghost setlist-add-btn" id="btn-new-practice-list">
      <i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>New Practice List
    </button>`;

    // Active practice lists
    if (activeLists.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No practice lists yet.</p>
        <p class="muted">Create one above to get started.</p>
      </div>`;
    } else {
      activeLists.forEach(pl => {
        const songCount = (pl.songs || []).length;
        const created = pl.createdAt ? new Date(pl.createdAt).toLocaleDateString() : '';
        html += `
          <div class="practice-list-card" data-pl-id="${esc(pl.id)}">
            <div class="practice-list-card-info">
              <span class="practice-list-card-name">${esc(pl.name)}</span>
              <span class="practice-list-card-meta">${songCount} song${songCount !== 1 ? 's' : ''}${created ? ' · ' + created : ''}</span>
            </div>
            <button class="practice-archive-btn" data-archive-id="${esc(pl.id)}" title="Archive"><i data-lucide="archive"></i></button>
            <i data-lucide="chevron-right" class="file-item-arrow"></i>
          </div>`;
      });
    }

    // Archived section
    if (archivedLists.length > 0) {
      html += `<button class="btn-ghost practice-archive-toggle" id="btn-show-archived" style="width:100%;margin-top:16px;">
        Show Archived (${archivedLists.length})
      </button>`;
      html += `<div id="archived-practice-lists" class="hidden" style="margin-top:8px;">`;
      archivedLists.forEach(pl => {
        const songCount = (pl.songs || []).length;
        html += `
          <div class="practice-list-card practice-list-card-archived" data-pl-id="${esc(pl.id)}">
            <div class="practice-list-card-info">
              <span class="practice-list-card-name" style="opacity:0.6">${esc(pl.name)}</span>
              <span class="practice-list-card-meta">${songCount} song${songCount !== 1 ? 's' : ''} · Archived</span>
            </div>
            <button class="practice-unarchive-btn" data-unarchive-id="${esc(pl.id)}" title="Unarchive"><i data-lucide="archive-restore"></i></button>
          </div>`;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire refresh
    document.getElementById('btn-refresh-practice-detail')?.addEventListener('click', () => {
      _doSyncRefresh(() => {
        const updated = _practice.find(p => p.id === persona.id);
        if (updated) renderPracticeDetail(updated, true);
        else renderPractice(true);
      });
    });

    // Wire practice list card clicks
    container.querySelectorAll('.practice-list-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.practice-archive-btn') || e.target.closest('.practice-unarchive-btn')) return;
        const pl = allLists.find(l => l.id === card.dataset.plId);
        if (pl) renderPracticeListDetail(persona, pl);
      });
    });

    // Wire archive buttons
    container.querySelectorAll('.practice-archive-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pl = allLists.find(l => l.id === btn.dataset.archiveId);
        if (pl) {
          Admin.showConfirm('Archive Practice List',
            `Are you sure you want to archive "${pl.name}"? You can unarchive it later.`,
            async () => {
              pl.archived = true;
              const idx = _practice.findIndex(p => p.id === persona.id);
              if (idx > -1) _practice[idx] = persona;
              await savePractice();
              renderPracticeDetail(persona, true);
            }, 'Archive');
        }
      });
    });

    // Wire unarchive buttons
    container.querySelectorAll('.practice-unarchive-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pl = allLists.find(l => l.id === btn.dataset.unarchiveId);
        if (pl) {
          pl.archived = false;
          const idx = _practice.findIndex(p => p.id === persona.id);
          if (idx > -1) _practice[idx] = persona;
          await savePractice();
          renderPracticeDetail(persona, true);
        }
      });
    });

    // Wire show archived toggle
    document.getElementById('btn-show-archived')?.addEventListener('click', () => {
      const section = document.getElementById('archived-practice-lists');
      const btn = document.getElementById('btn-show-archived');
      const isHidden = section.classList.contains('hidden');
      section.classList.toggle('hidden');
      btn.textContent = isHidden ? `Hide Archived (${archivedLists.length})` : `Show Archived (${archivedLists.length})`;
    });

    // Wire edit persona button
    container.querySelector('.btn-edit-persona')?.addEventListener('click', () => {
      renderPracticeEdit(persona, false);
    });

    // Wire new practice list button — shows name prompt
    document.getElementById('btn-new-practice-list')?.addEventListener('click', () => {
      _showNewPracticeListPrompt(persona);
    });
  }

  function _showNewPracticeListPrompt(persona) {
    const container = document.getElementById('practice-detail-content');
    // Remove existing prompt if any
    document.getElementById('new-pl-prompt')?.remove();

    const div = document.createElement('div');
    div.id = 'new-pl-prompt';
    div.className = 'edit-section';
    div.style.marginTop = '12px';
    div.innerHTML = `
      <div class="edit-section-title">New Practice List</div>
      <div class="form-field">
        <input class="form-input" id="new-pl-name" type="text" placeholder="Practice list name…" autocomplete="off" maxlength="100" />
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn-primary" id="new-pl-create" style="flex:1">Create</button>
        <button class="btn-secondary" id="new-pl-cancel" style="flex:1">Cancel</button>
      </div>
    `;
    container.appendChild(div);
    document.getElementById('new-pl-name').focus();

    document.getElementById('new-pl-create').addEventListener('click', async () => {
      const name = document.getElementById('new-pl-name').value.trim();
      if (!name) { showToast('Name is required.'); document.getElementById('new-pl-name').focus(); return; }
      if (!persona.practiceLists) persona.practiceLists = [];
      const newPL = {
        id: Admin.generateId(persona.practiceLists),
        name,
        archived: false,
        createdAt: new Date().toISOString(),
        songs: []
      };
      persona.practiceLists.push(newPL);
      const idx = _practice.findIndex(p => p.id === persona.id);
      if (idx > -1) _practice[idx] = persona;
      await savePractice();
      renderPracticeDetail(persona, true);
    });

    document.getElementById('new-pl-cancel').addEventListener('click', () => {
      div.remove();
    });
  }

  // ─── PRACTICE — Practice List Detail ───────────────────────

  function renderPracticeListDetail(persona, practiceList, skipNavPush) {
    _revokeBlobCache();
    Player.stopAll();
    _activePersona = persona;
    _activePracticeList = practiceList;
    if (!skipNavPush) _pushNav(() => renderPracticeDetail(persona));
    _showView('practice-edit');
    _setTopbar(practiceList.name || 'Practice List', true);

    const container = document.getElementById('practice-edit-content');
    const songs = practiceList.songs || [];

    let html = `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-practice-list">Edit List</button></div>` : ''}
      <div class="detail-title" style="margin-bottom:4px">${esc(practiceList.name)}</div>
      <div class="detail-subtitle">${songs.length} song${songs.length !== 1 ? 's' : ''}</div>
    </div>`;

    // Add song button (all users)
    html += `<button class="btn-ghost" id="btn-add-practice-song" style="width:100%;text-align:center;margin-bottom:16px;">
      <i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add Song
    </button>`;

    // Practice mode button
    if (songs.length > 0) {
      html += `<button class="btn-primary practice-enter-btn" id="btn-enter-practice-mode" style="width:100%;margin-bottom:20px;">
        <i data-lucide="play" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Enter Practice Mode
      </button>`;
    }

    if (songs.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No songs yet.</p>
        <p class="muted">Add songs to this practice list.</p>
      </div>`;
    } else {
      html += `<div class="practice-song-list">`;
      songs.forEach((entry, i) => {
        const song = _songs.find(s => s.id === entry.songId);
        if (song) {
          html += `
            <div class="setlist-song-row" data-song-id="${esc(song.id)}">
              <span class="setlist-song-num">${i + 1}</span>
              <div class="setlist-song-info">
                <span class="setlist-song-title">${esc(song.title)}</span>
                <span class="setlist-song-meta">
                  ${song.key ? esc(song.key) : ''}${song.key && song.bpm ? ' · ' : ''}${song.bpm ? esc(String(song.bpm)) + ' bpm' : ''}
                </span>
                ${entry.comment ? `<span class="setlist-song-comment">${esc(entry.comment)}</span>` : ''}
              </div>
              <i data-lucide="chevron-right" class="file-item-arrow"></i>
            </div>`;
        }
      });
      html += `</div>`;
    }

    // Delete practice list button at bottom (all users)
    html += `<div class="delete-zone" style="margin-top:32px;">
      <button class="btn-danger" id="btn-delete-practice-list" style="font-size:12px;">
        <i data-lucide="trash-2" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;"></i>Delete Practice List
      </button>
    </div>`;

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire song clicks
    container.querySelectorAll('.setlist-song-row').forEach(row => {
      row.addEventListener('click', () => {
        const song = _songs.find(s => s.id === row.dataset.songId);
        if (song) {
          _pushNav(() => renderPracticeListDetail(persona, practiceList));
          renderDetail(song, true);
        }
      });
    });

    // Wire edit button (admin only)
    container.querySelector('.btn-edit-practice-list')?.addEventListener('click', () => {
      _renderPracticeListEdit(persona, practiceList, false);
    });

    // Wire add song button — shows picker
    document.getElementById('btn-add-practice-song')?.addEventListener('click', () => {
      _showPracticeSongPicker(persona, practiceList);
    });

    // Wire practice mode
    document.getElementById('btn-enter-practice-mode')?.addEventListener('click', () => {
      _enterPracticeMode(persona, practiceList);
    });

    // Wire delete practice list (all users)
    document.getElementById('btn-delete-practice-list')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Practice List', `Permanently delete "${esc(practiceList.name || 'this practice list')}"?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        try {
          const pIdx = _practice.findIndex(p => p.id === persona.id);
          if (pIdx > -1) {
            _practice[pIdx].practiceLists = (_practice[pIdx].practiceLists || []).filter(l => l.id !== practiceList.id);
          }
          await savePractice('Practice list deleted.');
          _activePracticeList = null;
          const updated = _practice.find(p => p.id === persona.id);
          if (updated) {
            renderPracticeDetail(updated, true);
          } else {
            _navigateBack();
          }
        } catch (err) {
          console.error('Delete practice list failed', err);
          showToast('Delete failed.');
        } finally {
          _savingPractice = false;
        }
      });
    });
  }

  function _showPracticeSongPicker(persona, practiceList) {
    const container = document.getElementById('practice-edit-content');
    let pickerHtml = `<div class="edit-section" id="practice-picker-section">
      <div class="edit-section-title">Add Song</div>
      <div class="form-field">
        <input class="form-input" id="practice-picker-search" type="text" placeholder="Search songs…" autocomplete="off" />
      </div>
      <div id="practice-picker-list" class="setlist-picker-list"></div>
      <button class="btn-secondary" id="practice-picker-close" style="margin-top:10px;width:100%">Close</button>
    </div>`;
    const div = document.createElement('div');
    div.innerHTML = pickerHtml;
    container.appendChild(div.firstElementChild);

    function renderPickerResults(search) {
      const existingIds = new Set((practiceList.songs || []).map(e => e.songId));
      const available = [..._songs].filter(s => !existingIds.has(s.id)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      let filtered = available;
      if (search) {
        const q = search.toLowerCase();
        filtered = available.filter(s =>
          (s.title || '').toLowerCase().includes(q) ||
          (s.key || '').toLowerCase().includes(q) ||
          (s.tags || []).some(t => t.toLowerCase().includes(q))
        );
      }
      const pickerList = document.getElementById('practice-picker-list');
      if (!filtered.length) {
        pickerList.innerHTML = `<div class="muted" style="font-size:13px;padding:8px 0">${search ? 'No matching songs.' : 'All songs added.'}</div>`;
        return;
      }
      pickerList.innerHTML = filtered.map(s => `
        <div class="setlist-picker-row" data-pick-id="${esc(s.id)}">
          <div class="setlist-picker-info">
            <span class="setlist-picker-title">${esc(s.title)}</span>
            <span class="setlist-picker-meta">${s.key ? esc(s.key) : ''}${s.key && s.bpm ? ' · ' : ''}${s.bpm ? esc(String(s.bpm)) + ' bpm' : ''}</span>
          </div>
          <button class="btn-ghost sl-add-btn" data-pick-id="${esc(s.id)}">Add</button>
        </div>
      `).join('');
      pickerList.querySelectorAll('.sl-add-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          practiceList.songs = practiceList.songs || [];
          practiceList.songs.push({ songId: btn.dataset.pickId, comment: '', addedAt: new Date().toISOString() });
          const idx = _practice.findIndex(p => p.id === persona.id);
          if (idx > -1) _practice[idx] = persona;
          await savePractice();
          document.getElementById('practice-picker-section')?.remove();
          renderPracticeListDetail(persona, practiceList, true);
        });
      });
    }

    renderPickerResults('');
    document.getElementById('practice-picker-search')?.addEventListener('input', (e) => {
      renderPickerResults(e.target.value.trim());
    });
    document.getElementById('practice-picker-close')?.addEventListener('click', () => {
      document.getElementById('practice-picker-section')?.remove();
    });
  }

  // ─── PRACTICE — Persona Edit View ─────────────────────────

  function renderPracticeEdit(persona, isNew) {
    _revokeBlobCache();
    Player.stopAll();
    _editPersona = deepClone(persona);
    _editPersonaIsNew = isNew;
    if (!_editPersona.practiceLists) _editPersona.practiceLists = [];

    if (isNew) {
      _pushNav(() => renderPractice());
    } else {
      _pushNav(() => renderPracticeDetail(persona));
    }
    _showView('practice-edit');
    _setTopbar(isNew ? 'New Persona' : 'Edit Persona', true);

    const container = document.getElementById('practice-edit-content');
    const p = _editPersona;

    let html = `
      <div class="edit-section">
        <div class="edit-section-title">Persona Info</div>
        <div class="form-field">
          <label class="form-label">Name</label>
          <input class="form-input" id="pf-name" type="text" value="${esc(p.name)}" placeholder="e.g. Cat, Marc, Jeff…" maxlength="100" />
        </div>
      </div>

      <div class="edit-form-actions">
        <button class="btn-primary" id="pf-save">Save</button>
        <button class="btn-secondary" id="pf-cancel">Cancel</button>
      </div>

      ${!isNew ? `<div class="delete-zone"><button class="btn-danger" id="pf-delete">Delete Persona</button></div>` : ''}
    `;

    container.innerHTML = html;

    // Save
    document.getElementById('pf-save').addEventListener('click', async () => {
      if (_savingPractice) return;
      p.name = document.getElementById('pf-name').value.trim();
      if (!p.name) { showToast('Name is required.'); document.getElementById('pf-name').focus(); return; }
      _savingPractice = true;
      try {
        p._ts = Date.now();
        p.color = p.color || _hslFromName(p.name);
        const isNew = _editPersonaIsNew;
        if (isNew) {
          _practice.push(p);
        } else {
          const idx = _practice.findIndex(x => x.id === p.id);
          if (idx > -1) _practice[idx] = p;
        }
        await savePractice(isNew ? 'Persona created.' : 'Persona saved.');
        _activePersona = null;
        renderPractice();
      } catch (err) {
        console.error('Save persona failed', err);
        showToast('Save failed.');
      } finally {
        _savingPractice = false;
      }
    });

    document.getElementById('pf-cancel').addEventListener('click', () => _navigateBack());

    document.getElementById('pf-delete')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Persona', `Permanently delete "${p.name || 'this persona'}" and all their practice lists?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        const backup = [..._practice];
        try {
          if (GitHub.isConfigured()) GitHub.trackDeletion('practice', p.id);
          _practice = _practice.filter(x => x.id !== p.id);
          await savePractice();
          _activePersona = null;
          renderPractice();
        } catch (err) {
          console.error('Delete persona failed', err);
          _practice = backup;
          showToast('Delete failed.');
        } finally {
          _savingPractice = false;
        }
      });
    });
  }

  // ─── PRACTICE — Practice List Edit ────────────────────────

  function _renderPracticeListEdit(persona, practiceList, isNew) {
    _revokeBlobCache();
    Player.stopAll();
    _editPracticeList = deepClone(practiceList);
    _editPracticeListIsNew = isNew;

    _pushNav(() => renderPracticeListDetail(persona, practiceList));
    _showView('practice-edit');
    _setTopbar(isNew ? 'New Practice List' : 'Edit Practice List', true);

    const container = document.getElementById('practice-edit-content');
    const pl = _editPracticeList;
    if (!pl.songs) pl.songs = [];

    let html = `
      <div class="edit-section">
        <div class="edit-section-title">Practice List Info</div>
        <div class="form-field">
          <label class="form-label">Name</label>
          <input class="form-input" id="pl-name" type="text" value="${esc(pl.name)}" placeholder="e.g. Jazz Standards Set…" maxlength="100" />
        </div>
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Songs</div>
        <div id="pl-selected-songs" class="setlist-edit-selected"></div>
        <div class="setlist-empty-msg ${pl.songs.length ? 'hidden' : ''}" id="pl-empty-msg">No songs yet. Add songs from the list detail view.</div>
      </div>

      <div class="edit-form-actions">
        <button class="btn-primary" id="pl-save">Save</button>
        <button class="btn-secondary" id="pl-cancel">Cancel</button>
      </div>

      ${!isNew ? `<div class="delete-zone"><button class="btn-danger" id="pl-delete">Delete Practice List</button></div>` : ''}
    `;

    container.innerHTML = html;

    let _sortablePL = null;
    function _renderPLSongs() {
      const songContainer = document.getElementById('pl-selected-songs');
      document.getElementById('pl-empty-msg')?.classList.toggle('hidden', pl.songs.length > 0);

      songContainer.innerHTML = pl.songs.map((entry, i) => {
        const song = _songs.find(s => s.id === entry.songId);
        const title = song ? esc(song.title) : '<em style="color:var(--text-3)">Song not found</em>';
        const key = song && song.key ? esc(song.key) : '';
        return `
          <div class="setlist-edit-row" data-idx="${i}">
            <div class="drag-handle"><i data-lucide="grip-vertical" style="width:16px;height:16px;"></i></div>
            <span class="setlist-song-num">${i + 1}</span>
            <div class="setlist-edit-row-info">
              <div class="setlist-edit-row-header">
                <span class="setlist-edit-row-title">${title}</span>
                ${key ? `<span class="setlist-edit-row-key">${key}</span>` : ''}
              </div>
              <div class="setlist-edit-comment-wrap">
                <textarea class="form-input practice-comment-input" rows="3"
                  placeholder="Practice notes, tips…" data-comment-idx="${i}" style="font-size:12px;min-height:60px;">${esc(entry.comment || '')}</textarea>
              </div>
            </div>
            <div class="setlist-edit-row-actions">
              <button class="icon-btn sl-remove" data-idx="${i}" style="color:var(--red)"><i data-lucide="x"></i></button>
            </div>
          </div>`;
      }).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [songContainer] });

      if (_sortablePL) { try { _sortablePL.destroy(); } catch(_){} _sortablePL = null; }
      if (typeof Sortable !== 'undefined' && pl.songs.length > 1) {
        _sortablePL = Sortable.create(songContainer, {
          handle: '.drag-handle',
          animation: 150,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onStart: () => { haptic.light(); },
          onEnd: (evt) => {
            haptic.tap();
            const moved = pl.songs.splice(evt.oldIndex, 1)[0];
            pl.songs.splice(evt.newIndex, 0, moved);
            _renderPLSongs();
          }
        });
      }

      songContainer.querySelectorAll('.sl-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          pl.songs.splice(parseInt(btn.dataset.idx, 10), 1);
          _renderPLSongs();
        });
      });
      songContainer.querySelectorAll('.practice-comment-input').forEach(input => {
        input.addEventListener('input', () => {
          const idx = parseInt(input.dataset.commentIdx, 10);
          if (pl.songs[idx]) pl.songs[idx].comment = input.value;
        });
      });
    }

    _renderPLSongs();

    // Save
    document.getElementById('pl-save').addEventListener('click', async () => {
      if (_savingPractice) return;
      pl.name = document.getElementById('pl-name').value.trim();
      if (!pl.name) { showToast('Name is required.'); document.getElementById('pl-name').focus(); return; }
      _savingPractice = true;
      try {
        // Update the practice list inside the persona
        const pIdx = _practice.findIndex(p => p.id === persona.id);
        if (pIdx > -1) {
          const plIdx = (_practice[pIdx].practiceLists || []).findIndex(l => l.id === pl.id);
          if (plIdx > -1) {
            _practice[pIdx].practiceLists[plIdx] = pl;
          }
        }
        await savePractice();
        // Navigate back to the updated list detail
        const updatedPersona = _practice.find(p => p.id === persona.id) || persona;
        const updatedPL = (updatedPersona.practiceLists || []).find(l => l.id === pl.id) || pl;
        renderPracticeListDetail(updatedPersona, updatedPL, true);
      } catch (err) {
        console.error('Save practice list failed', err);
        showToast('Save failed.');
      } finally {
        _savingPractice = false;
      }
    });

    document.getElementById('pl-cancel').addEventListener('click', () => _navigateBack());

    document.getElementById('pl-delete')?.addEventListener('click', () => {
      if (_savingPractice) return;
      Admin.showConfirm('Delete Practice List', `Permanently delete "${pl.name || 'this practice list'}"?`, async () => {
        if (_savingPractice) return;
        _savingPractice = true;
        try {
          const pIdx = _practice.findIndex(p => p.id === persona.id);
          if (pIdx > -1) {
            _practice[pIdx].practiceLists = (_practice[pIdx].practiceLists || []).filter(l => l.id !== pl.id);
          }
          await savePractice();
          _activePracticeList = null;
          renderPracticeDetail(_practice.find(p => p.id === persona.id) || persona);
        } catch (err) {
          console.error('Delete practice list failed', err);
          showToast('Delete failed.');
        } finally {
          _savingPractice = false;
        }
      });
    });
  }

  // ─── PRACTICE MODE ────────────────────────────────────────

  let _practicePersona = null;
  let _practiceList = null;

  function _enterPracticeMode(persona, practiceList) {
    _practicePersona = persona;
    _practiceList = practiceList;
    _revokeBlobCache();
    Player.stopAll();
    _pushNav(() => renderPracticeListDetail(persona, practiceList));
    _showView('practice-detail');
    document.body.classList.add('practice-mode-active');
    _setTopbar('Practice Mode', true);

    const container = document.getElementById('practice-detail-content');
    const songs = practiceList.songs || [];

    let html = `<div class="practice-mode-header">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div class="persona-avatar" style="background:${_safeColor(persona.color || _hslFromName(persona.name))}">${_personaInitials(persona.name)}</div>
        <div>
          <div class="detail-title" style="font-size:22px;margin-bottom:0">${esc(practiceList.name)}</div>
          <div class="muted" style="font-size:12px">${esc(persona.name)} · ${songs.length} songs</div>
        </div>
      </div>
      <button class="btn-secondary" id="btn-exit-practice-mode" style="width:100%;margin-bottom:16px;">Exit Practice Mode</button>
    </div>`;

    html += `<div class="practice-accordion">`;
    songs.forEach((entry, i) => {
      const song = _songs.find(s => s.id === entry.songId);
      if (!song) return;
      const a = song.assets || {};
      html += `
        <div class="practice-accordion-item" data-practice-idx="${i}">
          <div class="practice-accordion-header" data-toggle-idx="${i}">
            <span class="setlist-song-num" style="font-size:12px;min-width:24px;height:24px;line-height:24px;">${i + 1}</span>
            <div style="flex:1;min-width:0">
              <span class="setlist-song-title">${esc(song.title)}</span>
              <span class="setlist-song-meta" style="display:block">${song.key ? esc(song.key) : ''}${song.key && song.bpm ? ' · ' : ''}${song.bpm ? esc(String(song.bpm)) + ' bpm' : ''}</span>
            </div>
            <i data-lucide="chevron-down" class="accordion-chevron rotated" style="width:16px;height:16px;flex-shrink:0;transition:transform 0.2s;"></i>
          </div>
          <div class="practice-accordion-body">
            ${entry.comment ? `<div class="detail-notes" style="margin-bottom:12px;font-size:13px;">${esc(entry.comment)}</div>` : ''}
            ${(a.charts || []).length ? `<div class="detail-section" style="margin-bottom:12px">
              <div class="detail-section-label">Charts</div>
              <div class="file-list">${(a.charts || []).map(c => `
                <div class="file-item-row"><button class="file-item" data-open-chart="${esc(c.driveId)}" data-name="${esc(c.name)}">
                  <div class="file-item-icon pdf"><i data-lucide="file-text"></i></div>
                  <span class="file-item-name">${esc(c.name)}</span>
                  <i data-lucide="chevron-right" class="file-item-arrow"></i>
                </button></div>`).join('')}
              </div>
            </div>` : ''}
            ${(a.audio || []).length ? `<div class="detail-section" style="margin-bottom:12px">
              <div class="detail-section-label">Audio</div>
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${(a.audio || []).map(au => `<div data-audio-container="${esc(au.driveId)}" data-name="${esc(au.name)}" data-song-title="${esc(song.title || '')}"></div>`).join('')}
              </div>
            </div>` : ''}
            ${(a.links || []).length ? `<div class="detail-section" style="margin-bottom:12px">
              <div class="detail-section-label">Links</div>
              <div class="embed-list">${(a.links || []).map(l => _buildEmbedHTML(l)).join('')}</div>
            </div>` : ''}
          </div>
        </div>`;
    });
    html += `</div>`;

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Pre-fetch all chart PDFs eagerly (prevents Drive contention with audio)
    songs.forEach(entry => {
      const song = _songs.find(s => s.id === entry.songId);
      if (!song) return;
      (song.assets?.charts || []).forEach(c => {
        if (c.driveId && !_blobCache[c.driveId]) _getBlobUrl(c.driveId).catch(() => {});
      });
    });

    // Auto-load all audio/charts since all items are expanded
    function _loadAccordionAssets(body) {
      body.querySelectorAll('[data-audio-container]').forEach(async el => {
        if (el.dataset.loaded) return;
        const driveId = el.dataset.audioContainer;
        if (!driveId) return;
        el.dataset.loaded = 'true';
        el.innerHTML = `<div class="audio-player audio-skeleton">
          <div class="skeleton-text" style="width:40%;height:13px"></div>
          <div class="audio-controls"><div class="skeleton-circle"></div><div class="audio-progress-wrap"><div class="skeleton-bar"></div></div></div>
        </div>`;
        try {
          const url = _isIOS() ? Drive.getDirectUrl(driveId) : await _getBlobUrl(driveId);
          if (!url) throw new Error('No audio URL');
          el.innerHTML = '';
          const ref = Player.create(el, { name: el.dataset.name || 'Audio', blobUrl: url, songTitle: el.dataset.songTitle || '', loopMode: true });
          _playerRefs.push(ref);
        } catch { el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`; }
      });

      body.querySelectorAll('[data-open-chart]').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = 'true';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const url = await _getBlobUrl(btn.dataset.openChart);
            PDFViewer.open(url, btn.dataset.name);
          } catch { showToast('Failed to load chart.'); }
          finally { btn.disabled = false; }
        });
      });
    }

    // Load all accordion bodies immediately (auto-expanded)
    container.querySelectorAll('.practice-accordion-body').forEach(body => {
      _loadAccordionAssets(body);
    });

    // Wire accordion toggle (collapse/expand)
    container.querySelectorAll('.practice-accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.practice-accordion-item');
        const body = item.querySelector('.practice-accordion-body');
        const chevron = header.querySelector('.accordion-chevron, svg');
        const isOpen = !body.classList.contains('hidden');
        body.classList.toggle('hidden');
        if (chevron) {
          chevron.classList.toggle('rotated', isOpen);
          chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        }

        // Load assets when re-expanding
        if (!isOpen) _loadAccordionAssets(body);
      });
    });

    // Wire exit
    document.getElementById('btn-exit-practice-mode')?.addEventListener('click', () => {
      _exitPracticeMode();
    });
  }

  function _exitPracticeMode() {
    document.body.classList.remove('practice-mode-active');
    _practicePersona = null;
    _practiceList = null;
    _navigateBack();
  }

  // ─── Init ──────────────────────────────────────────────────

  // ─── PWA Install Gate ──────────────────────────────────────

  function _isPWAInstalled() {
    // iOS standalone (works on Safari home screen apps)
    if (window.navigator.standalone === true) return true;
    // Standard display-mode check (Android Chrome, Edge, Samsung Internet, Firefox)
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (_) {}
    // TWA (Trusted Web Activity)
    if (document.referrer.includes('android-app://')) return true;
    return false;
  }

  function _isMobile() {
    // UA-based detection
    if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
    // iPad running as "desktop" Safari (reports MacIntel but has touch)
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    // Fallback: touch-capable small screen (catches "Request Desktop Site" mode)
    if (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024) return true;
    return false;
  }

  function _detectPlatform() {
    const ua = navigator.userAgent;
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ipad';
    if (/iPhone|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    // Fallback for touch devices with unrecognized UA
    if (navigator.maxTouchPoints > 1) return 'other';
    return 'desktop';
  }

  function _showInstallGate() {
    const platform = _detectPlatform();

    let steps = '';
    if (platform === 'ios' || platform === 'ipad') {
      steps = `
        <div class="install-steps">
          <div class="install-step">
            <span class="install-step-num">1</span>
            <span>Tap the <strong>Share</strong> button <span class="install-icon-hint">(the square with an arrow)</span> at the bottom of Safari</span>
          </div>
          <div class="install-step">
            <span class="install-step-num">2</span>
            <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
          </div>
          <div class="install-step">
            <span class="install-step-num">3</span>
            <span>Tap <strong>"Add"</strong> in the top right</span>
          </div>
          <div class="install-step">
            <span class="install-step-num">4</span>
            <span>Open <strong>Catman Trio</strong> from your home screen</span>
          </div>
        </div>
        <p class="install-note">Note: You must use <strong>Safari</strong> for this to work. If you're in Chrome or another browser, open this page in Safari first.</p>`;
    } else if (platform === 'android') {
      steps = `
        <div class="install-steps">
          <div class="install-step">
            <span class="install-step-num">1</span>
            <span>Tap the <strong>menu</strong> button <span class="install-icon-hint">( &#8942; )</span> in the top right of Chrome</span>
          </div>
          <div class="install-step">
            <span class="install-step-num">2</span>
            <span>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></span>
          </div>
          <div class="install-step">
            <span class="install-step-num">3</span>
            <span>Tap <strong>"Install"</strong> to confirm</span>
          </div>
          <div class="install-step">
            <span class="install-step-num">4</span>
            <span>Open <strong>Catman Trio</strong> from your home screen</span>
          </div>
        </div>`;
    } else {
      steps = `
        <div class="install-steps">
          <div class="install-step">
            <span class="install-step-num">1</span>
            <span>Look for an <strong>"Install"</strong> option in your browser's menu or address bar</span>
          </div>
          <div class="install-step">
            <span class="install-step-num">2</span>
            <span>Follow the prompts to add to your home screen</span>
          </div>
          <div class="install-step">
            <span class="install-step-num">3</span>
            <span>Open <strong>Catman Trio</strong> from your home screen</span>
          </div>
        </div>`;
    }

    // Hide the real app, show the install gate
    document.getElementById('topbar')?.classList.add('hidden');
    document.getElementById('app')?.classList.add('hidden');

    const gate = document.createElement('div');
    gate.id = 'install-gate';
    gate.innerHTML = `
      <div class="install-gate-content">
        <span class="install-gate-version">${APP_VERSION}</span>
        <div class="install-gate-logo">CT</div>
        <h1 class="install-gate-title">Catman Trio</h1>
        <p class="install-gate-subtitle">Welcome to the Catman Trio App. To access this app, add it to your home screen by following the steps below.</p>
        <div class="install-gate-card">
          <h2 class="install-gate-card-title">How to install</h2>
          ${steps}
        </div>
        <p class="install-gate-footer">Once installed, the app launches in full screen and works offline — just like a native app.</p>
      </div>`;
    document.body.appendChild(gate);
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    // Register SW early so the install prompt can work
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .then(reg => console.info('SW registered:', reg.scope))
        .catch(e => console.warn('SW registration failed:', e));
      // Load cached PDF list once SW is ready
      navigator.serviceWorker.ready.then(() => _loadCachedPdfList()).catch(() => {});
    }

    // Request persistent storage to prevent eviction
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // Show loading skeleton
    const songList = document.getElementById('song-list');
    if (songList) songList.innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');

    // PWA install gate — mobile browsers only
    if (_isMobile() && !_isPWAInstalled()) {
      _showInstallGate();
      return; // Don't load the app
    }

    // Load display fonts dynamically (bypasses SW cache of old index.html)
    ['Audiowide', 'Oxanium:wght@600;700', 'Chakra+Petch:wght@600;700'].forEach(f => {
      if (!document.querySelector(`link[href*="${f.split(':')[0]}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${f}&display=swap`;
        document.head.appendChild(link);
      }
    });
    if (typeof lucide !== 'undefined') {
      const topbar = document.getElementById('topbar');
      const modals = document.querySelectorAll('.modal-overlay');
      const nodes = [topbar, ...modals].filter(Boolean);
      if (nodes.length) lucide.createIcons({ nodes });
    }

    // Populate version badge (shown on home page for all users)
    const vBadge = document.getElementById('admin-version-badge');
    if (vBadge) vBadge.textContent = APP_VERSION;

    document.getElementById('btn-back').addEventListener('click', () => {
      _navigateBack();
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
      haptic.double(); // mode toggle
      if (Admin.isEditMode()) {
        Admin.exitEditMode();
        if (_view === 'list')              renderList();
        else if (_view === 'detail' && _activeSong) renderDetail(_activeSong, true);
        else if (_view === 'detail' || _view === 'edit') { _activeSong = null; renderList(); }
        else if (_view === 'setlists')     renderSetlists(true);
        else if (_view === 'setlist-detail' && _activeSetlist) renderSetlistDetail(_activeSetlist, true);
        else if (_view === 'setlist-edit') renderSetlists();
        else if (_view === 'practice')     renderPractice(true);
        else if (_view === 'practice-detail' && _activePersona) renderPracticeDetail(_activePersona, true);
        else if (_view === 'practice-edit' && _activePersona && _activePracticeList) renderPracticeListDetail(_activePersona, _activePracticeList, true);
        else if (_view === 'practice-edit') renderPractice();
      } else {
        Admin.showPasswordModal(() => {
          Admin.enterEditMode();
          if (_view === 'list')              renderList();
          else if (_view === 'detail' && _activeSong) renderDetail(_activeSong, true);
          else if (_view === 'detail')       renderList();
          else if (_view === 'setlists')     renderSetlists(true);
          else if (_view === 'setlist-detail' && _activeSetlist) renderSetlistDetail(_activeSetlist, true);
          else if (_view === 'practice')     renderPractice(true);
          else if (_view === 'practice-detail' && _activePersona) renderPracticeDetail(_activePersona, true);
          else if (_view === 'practice-edit' && _activePersona && _activePracticeList) renderPracticeListDetail(_activePersona, _activePracticeList, true);
        });
      }
    });

    document.getElementById('btn-add-song').addEventListener('click', () => {
      if (!Admin.isEditMode()) return;
      if (!Drive.isWriteConfigured() && !GitHub.isConfigured()) {
        Admin.showGitHubModal(() => {});
        showToast('Configure GitHub to sync data, then try again.');
        return;
      }
      renderEdit(Admin.newSong(_songs), true);
    });

    let _searchTimer = null;
    document.getElementById('search-input').addEventListener('input', e => {
      _searchText = e.target.value;
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => renderList(), 80);
    });

    // Refresh button — full hard refresh: clear SW cache + reload for fresh source + data
    // Throttle: max 2 refreshes per 10 seconds
    const REFRESH_WINDOW = 10000;
    const REFRESH_MAX = 2;
    let _refreshTimes = [];
    try {
      const raw = sessionStorage.getItem('bb_refresh_times');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) _refreshTimes = parsed.filter(t => typeof t === 'number' && isFinite(t));
      }
    } catch (_) { /* corrupted or unavailable — start fresh */ }
    document.getElementById('btn-refresh').addEventListener('click', async () => {
      const now = Date.now();
      _refreshTimes = _refreshTimes.filter(t => now - t < REFRESH_WINDOW);
      if (_refreshTimes.length >= REFRESH_MAX) {
        showToast('Slow down — too many refreshes. Try again in a few seconds.');
        return;
      }
      _refreshTimes.push(now);
      try { sessionStorage.setItem('bb_refresh_times', JSON.stringify(_refreshTimes)); } catch (_) {}

      const wasPtr = _ptrTriggered;
      _ptrTriggered = false;
      if (!wasPtr) showToast('Refreshing app…');
      try {
        // Wipe all service worker caches so fresh files are fetched on reload
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        // If there's a waiting SW, skip waiting so the new one activates on reload
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      } catch (e) {
        console.warn('Cache clear failed', e);
      }
      // Brief delay so toast is visible before reload
      await new Promise(r => setTimeout(r, 800));
      location.reload();
    });

    // Pull-to-refresh with visual indicator
    let _ptrTriggered = false; // suppress toast when refresh comes from PTR
    {
      const appEl = document.getElementById('app');
      const ptrEl = document.getElementById('ptr-indicator');
      const ptrText = ptrEl?.querySelector('.ptr-text');
      let _ptrStartY = 0, _ptrActive = false, _ptrPulling = false;
      const PTR_THRESHOLD = 310;
      const PTR_MAX = 375;

      function _getScrollTop() {
        const activeView = appEl.querySelector('.view.active');
        return activeView ? activeView.scrollTop : 0;
      }

      appEl.addEventListener('touchstart', (e) => {
        if (_view !== 'list' || _selectionMode || _getScrollTop() > 5) return;
        _ptrStartY = e.touches[0].clientY;
        _ptrActive = true;
        _ptrPulling = false;
      }, { passive: true });

      appEl.addEventListener('touchmove', (e) => {
        if (!_ptrActive || !ptrEl) return;
        const dy = e.touches[0].clientY - _ptrStartY;
        if (dy <= 0 || _getScrollTop() > 5) {
          if (_ptrPulling) {
            _ptrPulling = false;
            ptrEl.style.height = '0';
            ptrEl.classList.remove('ptr-pulling', 'ptr-ready');
          }
          return;
        }
        _ptrPulling = true;
        const clamped = Math.min(dy, PTR_MAX);
        const h = Math.round(clamped * 0.5);
        ptrEl.style.height = h + 'px';
        ptrEl.classList.add('ptr-pulling');
        if (dy >= PTR_THRESHOLD) {
          if (!ptrEl.classList.contains('ptr-ready')) haptic.medium(); // threshold reached
          ptrEl.classList.add('ptr-ready');
          if (ptrText) ptrText.textContent = 'Release to refresh';
        } else {
          ptrEl.classList.remove('ptr-ready');
          if (ptrText) ptrText.textContent = 'Pull down to refresh';
        }
      }, { passive: true });

      appEl.addEventListener('touchend', (e) => {
        if (!_ptrActive || !ptrEl) return;
        const wasPulling = _ptrPulling;
        _ptrActive = false;
        _ptrPulling = false;

        const dy = (e.changedTouches[0]?.clientY || 0) - _ptrStartY;
        if (wasPulling && dy >= PTR_THRESHOLD && _getScrollTop() <= 5) {
          haptic.double(); // refresh triggered
          // Show refreshing state
          ptrEl.classList.remove('ptr-ready');
          ptrEl.classList.add('ptr-refreshing');
          if (ptrText) ptrText.textContent = 'Refreshing…';
          ptrEl.style.height = '40px';
          // Trigger the actual refresh (suppress toast — PTR indicator is visible)
          _ptrTriggered = true;
          document.getElementById('btn-refresh').click();
          // Safety reset: if page doesn't reload within 5s (e.g. rate-limited), clear indicator
          setTimeout(() => {
            ptrEl.style.height = '0';
            ptrEl.classList.remove('ptr-pulling', 'ptr-ready', 'ptr-refreshing');
            if (ptrText) ptrText.textContent = 'Pull down to refresh';
          }, 5000);
        } else {
          // Snap back
          ptrEl.style.height = '0';
          ptrEl.classList.remove('ptr-pulling', 'ptr-ready', 'ptr-refreshing');
          if (ptrText) ptrText.textContent = 'Pull down to refresh';
        }
      }, { passive: true });
    }

    // Setlists button
    document.getElementById('btn-setlists').addEventListener('click', () => {
      if (_selectionMode) _exitSelectionMode();
      renderSetlists();
    });

    // Practice button
    document.getElementById('btn-practice').addEventListener('click', () => {
      if (_selectionMode) _exitSelectionMode();
      renderPractice();
    });

    // Admin Dashboard button
    document.getElementById('btn-admin-dashboard')?.addEventListener('click', () => {
      renderDashboard();
    });

    // Master volume slider (hidden on mobile — iOS audio.volume is read-only, Android has system volume)
    const isMobile = _isMobile();
    const volWrap   = document.getElementById('master-volume');
    const volSlider = document.getElementById('volume-slider');
    if (!volWrap || !volSlider) { /* elements missing, skip volume setup */ }
    else if (isMobile) {
      volWrap.style.display = 'none';
    } else {
      volSlider.value = Player.getVolume();
      function _updateVolFill() {
        const pct = (parseFloat(volSlider.value) / parseFloat(volSlider.max)) * 100;
        volSlider.style.background = `linear-gradient(to right, var(--accent-dim) 0%, var(--accent) ${pct}%, var(--bg-4) ${pct}%)`;
      }
      function _updateVolIcon() {
        const v = parseFloat(volSlider.value);
        const name = v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2';
        const oldIcon = volWrap.querySelector('[data-lucide]') || volWrap.querySelector('svg');
        const newIcon = document.createElement('i');
        newIcon.setAttribute('data-lucide', name);
        newIcon.style.cssText = 'width:14px;height:14px;opacity:0.6;flex-shrink:0;';
        if (oldIcon) oldIcon.replaceWith(newIcon);
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [volWrap] });
        _updateVolFill();
      }
      _updateVolIcon();
      volSlider.addEventListener('input', function() {
        Player.setVolume(parseFloat(this.value));
        _updateVolIcon();
      });
    }

    await loadSongsInstant();
    await loadSetlistsInstant();
    await loadPracticeInstant();
    _migratePracticeData();
    renderList();
    Admin.restoreEditMode();
    _initQueueIndicator();

    // Auto-detect GitHub PAT from Drive if not configured locally
    if (!GitHub.isConfigured() && Drive.isConfigured()) {
      _tryAutoConfigureGitHub();
    }

    _syncAllFromDrive();
  }

  // ─── Sync Diagnostics ─────────────────────────────────────

  /**
   * Comprehensive sync diagnostic suite.
   * Tests every layer of the sync pipeline — crypto, API, data integrity,
   * auto-configure, service worker, localStorage, platform detection.
   * Renders results into the given container element.
   */
  async function runDiagnostics(container) {
    const results = [];
    let _testIdx = 0;

    const _icon = (status) => {
      if (status === 'pass') return '\u2713';
      if (status === 'fail') return '\u2717';
      if (status === 'warn') return '!';
      if (status === 'skip') return '-';
      return '\u2026';
    };

    function _renderResults() {
      let html = '';
      let currentSection = null;
      for (const r of results) {
        if (r.section && r.section !== currentSection) {
          currentSection = r.section;
          html += `<div class="diag-header">${esc(currentSection)}</div>`;
        }
        const cls = `diag-test diag-${r.status}`;
        html += `<div class="${cls}">`;
        html += `<div class="diag-icon">${_icon(r.status)}</div>`;
        html += `<div><div class="diag-name">${esc(r.name)}</div>`;
        if (r.detail) html += `<div class="diag-detail">${esc(r.detail)}</div>`;
        html += `</div></div>`;
      }
      // Summary
      const passed = results.filter(r => r.status === 'pass').length;
      const failed = results.filter(r => r.status === 'fail').length;
      const warned = results.filter(r => r.status === 'warn').length;
      const skipped = results.filter(r => r.status === 'skip').length;
      const total = results.length;
      const cls = failed > 0 ? 'has-fail' : warned > 0 ? 'has-warn' : 'all-pass';
      html += `<div class="diag-summary ${cls}">${passed}/${total} passed` +
        (failed ? ` \u00b7 ${failed} failed` : '') +
        (warned ? ` \u00b7 ${warned} warnings` : '') +
        (skipped ? ` \u00b7 ${skipped} skipped` : '') +
        `</div>`;
      container.innerHTML = html;
    }

    function _add(section, name, status, detail) {
      results.push({ section, name, status, detail: detail || '' });
      _renderResults();
    }

    function _update(idx, status, detail) {
      if (results[idx]) {
        results[idx].status = status;
        if (detail !== undefined) results[idx].detail = detail;
        _renderResults();
      }
    }

    async function _test(section, name, fn) {
      const idx = results.length;
      _add(section, name, 'running', 'Running...');
      try {
        const result = await fn();
        _update(idx, result.status, result.detail);
      } catch (e) {
        _update(idx, 'fail', `Exception: ${e.message || e}`);
      }
    }

    const _timer = (label) => {
      const t0 = performance.now();
      return () => `${label} (${(performance.now() - t0).toFixed(0)}ms)`;
    };

    // ═══════════════════════════════════════════════════════
    // SECTION 1: Platform & Environment
    // ═══════════════════════════════════════════════════════

    const SEC1 = 'Platform & Environment';

    await _test(SEC1, 'Platform detection', async () => {
      const mobile = _isMobile();
      const platform = _detectPlatform();
      const ua = navigator.userAgent.substring(0, 80);
      return { status: 'pass', detail: `Platform: ${platform}, Mobile: ${mobile}, UA: ${ua}...` };
    });

    await _test(SEC1, 'Web Crypto API available', async () => {
      if (!crypto || !crypto.subtle) return { status: 'fail', detail: 'crypto.subtle not available — HTTPS required' };
      return { status: 'pass', detail: 'crypto.subtle available' };
    });

    await _test(SEC1, 'Service Worker registered', async () => {
      if (!('serviceWorker' in navigator)) return { status: 'fail', detail: 'Service Worker API not supported' };
      // Check existing registration
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const swState = reg.active ? 'active' : reg.waiting ? 'waiting' : reg.installing ? 'installing' : 'unknown';
        return { status: 'pass', detail: `SW state: ${swState}, scope: ${reg.scope}` };
      }
      // Check controller (SW running but getRegistration is flaky on iOS)
      if (navigator.serviceWorker.controller) {
        return { status: 'pass', detail: `SW controller active (${navigator.serviceWorker.controller.scriptURL})` };
      }
      // No existing SW — try registering now and capture the actual error
      try {
        const newReg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
        const state = newReg.active ? 'active' : newReg.waiting ? 'waiting' : newReg.installing ? 'installing' : 'pending';
        return { status: 'pass', detail: `SW registered by diagnostic (state: ${state}, scope: ${newReg.scope})` };
      } catch (regErr) {
        // This is the actual error — show it
        return { status: 'fail', detail: `SW registration failed: ${regErr.message || regErr}` };
      }
    });

    await _test(SEC1, 'App version consistency', async () => {
      const jsVersion = APP_VERSION;
      const badge = document.getElementById('admin-version-badge');
      const badgeVersion = badge ? badge.textContent : '(no badge)';
      if (jsVersion !== badgeVersion) return { status: 'warn', detail: `JS: ${jsVersion}, Badge: ${badgeVersion}` };
      return { status: 'pass', detail: `${jsVersion}` };
    });

    await _test(SEC1, 'Persistent storage granted', async () => {
      if (!navigator.storage || !navigator.storage.persisted) return { status: 'skip', detail: 'API not available' };
      const persisted = await navigator.storage.persisted();
      return { status: persisted ? 'pass' : 'warn', detail: persisted ? 'Storage will not be evicted' : 'Storage may be evicted by OS under pressure' };
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 2: localStorage Health
    // ═══════════════════════════════════════════════════════

    const SEC2 = 'localStorage Health';

    await _test(SEC2, 'localStorage accessible', async () => {
      try {
        localStorage.setItem('_diag_test', '1');
        localStorage.removeItem('_diag_test');
        return { status: 'pass', detail: 'Read/write OK' };
      } catch (e) {
        return { status: 'fail', detail: `localStorage blocked: ${e.message}` };
      }
    });

    await _test(SEC2, 'Songs data integrity', async () => {
      const raw = localStorage.getItem('bb_songs');
      if (!raw) return { status: 'warn', detail: 'No songs in localStorage' };
      try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return { status: 'fail', detail: 'bb_songs is not an array' };
        const withId = arr.filter(s => s.id);
        const withTitle = arr.filter(s => s.title);
        return { status: 'pass', detail: `${arr.length} songs, ${withId.length} have IDs, ${withTitle.length} have titles, ~${(raw.length / 1024).toFixed(1)} KB` };
      } catch (e) {
        return { status: 'fail', detail: `Corrupt JSON: ${e.message}` };
      }
    });

    await _test(SEC2, 'Setlists data integrity', async () => {
      const raw = localStorage.getItem('bb_setlists');
      if (!raw) return { status: 'warn', detail: 'No setlists in localStorage' };
      try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return { status: 'fail', detail: 'bb_setlists is not an array' };
        return { status: 'pass', detail: `${arr.length} setlists, ~${(raw.length / 1024).toFixed(1)} KB` };
      } catch (e) {
        return { status: 'fail', detail: `Corrupt JSON: ${e.message}` };
      }
    });

    await _test(SEC2, 'Practice data integrity', async () => {
      const raw = localStorage.getItem('bb_practice');
      if (!raw) return { status: 'warn', detail: 'No practice data in localStorage' };
      try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return { status: 'fail', detail: 'bb_practice is not an array' };
        const totalLists = arr.reduce((s, p) => s + (p.practiceLists || []).length, 0);
        return { status: 'pass', detail: `${arr.length} personas, ${totalLists} practice lists, ~${(raw.length / 1024).toFixed(1)} KB` };
      } catch (e) {
        return { status: 'fail', detail: `Corrupt JSON: ${e.message}` };
      }
    });

    await _test(SEC2, 'Migration flag status', async () => {
      const migrated = localStorage.getItem('bb_migrated_to_github');
      const pending = localStorage.getItem('bb_github_pending');
      let pendingInfo = 'none';
      if (pending) {
        try {
          const p = JSON.parse(pending);
          const types = Object.keys(p).filter(k => p[k] !== null);
          pendingInfo = types.length ? types.join(', ') : 'none';
        } catch (_) { pendingInfo = 'corrupt'; }
      }
      return { status: 'pass', detail: `Migrated: ${migrated === '1' ? 'Yes' : 'No'}, Pending writes: ${pendingInfo}` };
    });

    await _test(SEC2, 'Duplicate ID check', async () => {
      const ids = _songs.map(s => s.id).filter(Boolean);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupes.length) return { status: 'fail', detail: `Duplicate song IDs: ${[...new Set(dupes)].join(', ')}` };
      return { status: 'pass', detail: `${ids.length} unique song IDs` };
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 3: Drive Configuration
    // ═══════════════════════════════════════════════════════

    const SEC3 = 'Google Drive';

    await _test(SEC3, 'Drive configured', async () => {
      if (!Drive.isConfigured()) return { status: _isMobile() ? 'pass' : 'warn', detail: _isMobile() ? 'Not needed on mobile (GitHub handles metadata)' : 'API key or folder ID missing' };
      const cfg = Drive.getConfig();
      const writeOk = Drive.isWriteConfigured();
      return { status: 'pass', detail: `API Key: set, Folder: set, Write access: ${writeOk ? 'Yes' : 'No (read-only)'}` };
    });

    await _test(SEC3, 'Drive API reachable', async () => {
      if (!Drive.isConfigured()) return { status: 'skip', detail: 'Drive not configured' };
      const t = _timer('Drive list files');
      try {
        const cfg = Drive.getConfig();
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q='${cfg.folderId}'+in+parents+and+trashed=false&pageSize=1&fields=files(id)&key=${cfg.apiKey}`);
        if (!resp.ok) return { status: 'fail', detail: `API returned ${resp.status}: ${await resp.text()}` };
        const data = await resp.json();
        return { status: 'pass', detail: t() + ` — folder accessible, ${data.files?.length || 0} files sampled` };
      } catch (e) {
        return { status: 'fail', detail: `Network error: ${e.message}` };
      }
    });

    await _test(SEC3, 'PAT propagation file on Drive', async () => {
      if (!Drive.isConfigured()) return { status: 'skip', detail: 'Drive not configured' };
      try {
        const file = await Drive.findFilePublic('_github_sync.enc');
        if (!file) return { status: 'warn', detail: 'No _github_sync.enc found — other devices cannot auto-configure. Run GitHub Setup > Save & Connect on desktop to publish.' };
        return { status: 'pass', detail: `Found: ${file.id}` };
      } catch (e) {
        return { status: 'fail', detail: `Search failed: ${e.message}` };
      }
    });

    await _test(SEC3, 'PAT propagation file decryptable', async () => {
      if (!Drive.isConfigured()) return { status: 'skip', detail: 'Drive not configured' };
      const t = _timer('Decrypt PAT');
      try {
        const pat = await GitHub.loadPublishedPat();
        if (!pat) return { status: 'warn', detail: 'Could not load/decrypt PAT — file may be missing or encrypted with old key. Re-save GitHub Setup on desktop.' };
        // Don't log the PAT, just verify it's a non-empty string that looks like a token
        const masked = pat.substring(0, 4) + '...' + pat.substring(pat.length - 4);
        return { status: 'pass', detail: t() + ` — token: ${masked} (${pat.length} chars)` };
      } catch (e) {
        return { status: 'fail', detail: `Decryption failed: ${e.message}` };
      }
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 4: GitHub Configuration
    // ═══════════════════════════════════════════════════════

    const SEC4 = 'GitHub Sync';

    await _test(SEC4, 'GitHub PAT configured', async () => {
      if (!GitHub.isConfigured()) return { status: 'fail', detail: 'No PAT in localStorage — run GitHub Setup or verify auto-configure from Drive' };
      const cfg = GitHub.getConfig();
      return { status: 'pass', detail: `Owner: ${cfg.owner}, Repo: ${cfg.repo}` };
    });

    await _test(SEC4, 'GitHub API reachable', async () => {
      if (!GitHub.isConfigured()) return { status: 'skip', detail: 'GitHub not configured' };
      const t = _timer('GitHub API');
      try {
        const result = await GitHub.testConnection();
        if (!result.ok) return { status: 'fail', detail: result.error };
        return { status: 'pass', detail: t() + ` — ${result.repoName}, data branch: ${result.hasBranch ? 'exists' : 'MISSING'}` };
      } catch (e) {
        return { status: 'fail', detail: `Connection test exception: ${e.message}` };
      }
    });

    await _test(SEC4, 'Data branch exists', async () => {
      if (!GitHub.isConfigured()) return { status: 'skip', detail: 'GitHub not configured' };
      try {
        const result = await GitHub.testConnection();
        if (!result.ok) return { status: 'skip', detail: 'API unreachable' };
        if (!result.hasBranch) return { status: 'fail', detail: 'data branch not found — run migration from Admin Dashboard' };
        return { status: 'pass', detail: 'data branch present' };
      } catch (e) {
        return { status: 'fail', detail: e.message };
      }
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 5: Encryption
    // ═══════════════════════════════════════════════════════

    const SEC5 = 'Encryption';

    await _test(SEC5, 'AES-256-GCM encrypt/decrypt round-trip', async () => {
      if (!GitHub.isConfigured()) return { status: 'skip', detail: 'No PAT for key derivation' };
      const t = _timer('Crypto round-trip');
      // Test with various data types including Unicode, empty arrays, nested objects
      const testData = [
        { id: 'test1', title: 'Test Song \u266b', tags: ['rock', '\u00e9lectro'], notes: '' },
        { id: 'test2', title: '', tags: [], notes: 'Line1\nLine2\n\u00c0\u00e9\u00ef\u00f6\u00fc' },
        { id: 'test3', title: 'Edge case', bpm: '120', nested: { a: [1, 2, null, true, false] } },
      ];
      try {
        // Use internal encrypt/decrypt via saveSongs + loadSongs would alter state,
        // so we simulate by encrypting/decrypting through the GitHub module internals
        // We'll do a quick round-trip test via migrateData's approach
        const json = JSON.stringify(testData);

        // Derive key same way GitHub does
        const pat = localStorage.getItem('bb_github_pat') || '';
        const rawKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pat));
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

        // Encrypt
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(json);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

        // Decrypt
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        const decrypted = new TextDecoder().decode(plaintext);
        const parsed = JSON.parse(decrypted);

        if (JSON.stringify(parsed) !== json) {
          return { status: 'fail', detail: 'Decrypted data does not match original' };
        }
        return { status: 'pass', detail: t() + ` — ${encoded.byteLength} bytes plaintext, ${ciphertext.byteLength} bytes cipher, perfect match` };
      } catch (e) {
        return { status: 'fail', detail: `Crypto error: ${e.message}` };
      }
    });

    await _test(SEC5, 'Base64 encode/decode round-trip', async () => {
      // Test the _toBase64/_fromBase64 equivalents
      try {
        const testBytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) testBytes[i] = i;
        let binary = '';
        for (let i = 0; i < testBytes.length; i++) binary += String.fromCharCode(testBytes[i]);
        const b64 = btoa(binary);
        const decoded = atob(b64);
        const outBytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) outBytes[i] = decoded.charCodeAt(i);
        for (let i = 0; i < 256; i++) {
          if (outBytes[i] !== i) return { status: 'fail', detail: `Mismatch at byte ${i}: expected ${i}, got ${outBytes[i]}` };
        }
        return { status: 'pass', detail: '256-byte full range encode/decode: perfect match' };
      } catch (e) {
        return { status: 'fail', detail: e.message };
      }
    });

    await _test(SEC5, 'PAT propagation key derivation', async () => {
      // Verify the propagation key can be derived (same seed as github.js)
      try {
        const seed = 'catmantrio-sync-propagation-2024';
        const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
        const encKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
        const decKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
        // Quick round-trip
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const testPlain = new TextEncoder().encode('test-pat-value');
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, testPlain);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decKey, ct);
        const result = new TextDecoder().decode(pt);
        if (result !== 'test-pat-value') return { status: 'fail', detail: 'Propagation key round-trip mismatch' };
        return { status: 'pass', detail: 'Propagation key derivation + round-trip OK' };
      } catch (e) {
        return { status: 'fail', detail: e.message };
      }
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 6: Remote Data Verification
    // ═══════════════════════════════════════════════════════

    const SEC6 = 'Remote Data Integrity';

    // Use peekAllData (read-only) so diagnostics don't corrupt the SHA cache
    // and cause 409 conflicts with in-flight writes
    let remoteSongs = null, remoteSetlists = null, remotePractice = null;

    await _test(SEC6, 'Load + decrypt all data from GitHub', async () => {
      if (!GitHub.isConfigured()) return { status: 'skip', detail: 'GitHub not configured' };
      const t = _timer('Peek all data');
      try {
        const peek = await GitHub.peekAllData();
        remoteSongs = peek.songs;
        remoteSetlists = peek.setlists;
        remotePractice = peek.practice;
        const parts = [];
        if (remoteSongs !== null) {
          if (!Array.isArray(remoteSongs)) return { status: 'fail', detail: 'songs.enc decrypted but is not an array' };
          parts.push(`${remoteSongs.length} songs`);
        } else { parts.push('songs: not found'); }
        if (remoteSetlists !== null) {
          if (!Array.isArray(remoteSetlists)) return { status: 'fail', detail: 'setlists.enc decrypted but is not an array' };
          parts.push(`${remoteSetlists.length} setlists`);
        } else { parts.push('setlists: not found'); }
        if (remotePractice !== null) {
          if (!Array.isArray(remotePractice)) return { status: 'fail', detail: 'practice.enc decrypted but is not an array' };
          const totalLists = remotePractice.reduce((s, p) => s + (p.practiceLists || []).length, 0);
          parts.push(`${remotePractice.length} personas (${totalLists} lists)`);
        } else { parts.push('practice: not found'); }
        const anyNull = remoteSongs === null || remoteSetlists === null || remotePractice === null;
        return { status: anyNull ? 'warn' : 'pass', detail: t() + ' — ' + parts.join(' · ') };
      } catch (e) {
        return { status: 'fail', detail: `Load/decrypt failed: ${e.message}` };
      }
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 7: Cross-Device Sync Verification
    // ═══════════════════════════════════════════════════════

    const SEC7 = 'Cross-Device Sync';

    await _test(SEC7, 'Songs: local vs remote', async () => {
      if (remoteSongs === null) return { status: 'skip', detail: 'Remote songs not loaded' };
      const localCount = _songs.length;
      const remoteCount = remoteSongs.length;
      if (localCount !== remoteCount) {
        // Find which IDs are missing
        const localIds = new Set(_songs.map(s => s.id));
        const remoteIds = new Set(remoteSongs.map(s => s.id));
        const onlyLocal = [...localIds].filter(id => !remoteIds.has(id));
        const onlyRemote = [...remoteIds].filter(id => !localIds.has(id));
        let detail = `Count mismatch: ${localCount} local vs ${remoteCount} remote.`;
        if (onlyLocal.length) detail += ` Local-only IDs: ${onlyLocal.join(', ')}`;
        if (onlyRemote.length) detail += ` Remote-only IDs: ${onlyRemote.join(', ')}`;
        return { status: 'fail', detail };
      }
      // Deep compare by ID
      const remoteMap = new Map(remoteSongs.map(s => [s.id, s]));
      let diffs = 0;
      const diffFields = [];
      for (const local of _songs) {
        const remote = remoteMap.get(local.id);
        if (!remote) { diffs++; continue; }
        if (JSON.stringify(local) !== JSON.stringify(remote)) {
          diffs++;
          if (diffFields.length < 3) diffFields.push(local.title || local.id);
        }
      }
      if (diffs > 0) {
        return { status: 'warn', detail: `${diffs} song(s) differ between local and remote: ${diffFields.join(', ')}${diffs > 3 ? '...' : ''}` };
      }
      return { status: 'pass', detail: `${localCount} songs identical on both sides` };
    });

    await _test(SEC7, 'Setlists: local vs remote', async () => {
      if (remoteSetlists === null) return { status: 'skip', detail: 'Remote setlists not loaded' };
      const localCount = _setlists.length;
      const remoteCount = remoteSetlists.length;
      if (localCount !== remoteCount) {
        return { status: 'fail', detail: `Count mismatch: ${localCount} local vs ${remoteCount} remote` };
      }
      const match = JSON.stringify(_setlists) === JSON.stringify(remoteSetlists);
      return { status: match ? 'pass' : 'warn', detail: match ? `${localCount} setlists identical` : `${localCount} setlists — counts match but content differs` };
    });

    await _test(SEC7, 'Practice: local vs remote', async () => {
      if (remotePractice === null) return { status: 'skip', detail: 'Remote practice not loaded' };
      const localCount = _practice.length;
      const remoteCount = remotePractice.length;
      const localLists = _practice.reduce((s, p) => s + (p.practiceLists || []).length, 0);
      const remoteLists = remotePractice.reduce((s, p) => s + (p.practiceLists || []).length, 0);
      if (localCount !== remoteCount || localLists !== remoteLists) {
        return { status: 'fail', detail: `Mismatch: ${localCount} personas (${localLists} lists) local vs ${remoteCount} personas (${remoteLists} lists) remote` };
      }
      const match = JSON.stringify(_practice) === JSON.stringify(remotePractice);
      return { status: match ? 'pass' : 'warn', detail: match ? `${localCount} personas, ${localLists} lists identical` : `Counts match but content differs` };
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 8: Write Queue & Crash Recovery
    // ═══════════════════════════════════════════════════════

    const SEC8 = 'Write Queue';

    await _test(SEC8, 'Current queue status', async () => {
      const wq = GitHub.getWriteQueueStatus();
      if (wq.flushing) return { status: 'warn', detail: 'Flush in progress — test may not be accurate' };
      if (wq.hasPending) return { status: 'warn', detail: `Pending writes: ${wq.pendingTypes.join(', ')} — debounce #${wq.debounceCount}` };
      return { status: 'pass', detail: `Queue empty, debounce count: ${wq.debounceCount}` };
    });

    await _test(SEC8, 'Crash recovery data', async () => {
      const raw = localStorage.getItem('bb_github_pending');
      const delRaw = localStorage.getItem('bb_github_deletions');
      if (!raw && !delRaw) return { status: 'pass', detail: 'No crash recovery data (clean state)' };
      let pendingTypes = [];
      let deletionCount = 0;
      try {
        if (raw) {
          const p = JSON.parse(raw);
          pendingTypes = Object.keys(p).filter(k => p[k] !== null);
        }
        if (delRaw) {
          const d = JSON.parse(delRaw);
          deletionCount = Object.values(d).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
        }
      } catch (_) {
        return { status: 'warn', detail: 'Crash recovery data exists but is malformed' };
      }
      if (pendingTypes.length) return { status: 'warn', detail: `Unsynced data from previous session: ${pendingTypes.join(', ')}, ${deletionCount} pending deletions` };
      return { status: 'pass', detail: `Recovery data present but clean (${deletionCount} deletion records)` };
    });

    await _test(SEC8, 'Rate limit status', async () => {
      const rl = GitHub.getRateLimitStatus();
      if (rl.paused) return { status: 'fail', detail: `PAUSED — ${rl.callsThisHour}/${rl.limit} (${rl.pct}%)` };
      if (rl.warnLevel === 'warning') return { status: 'warn', detail: `High usage: ${rl.callsThisHour}/${rl.limit} (${rl.pct}%)` };
      return { status: 'pass', detail: `${rl.callsThisHour}/${rl.limit} calls this hour (${rl.pct}%)` };
    });

    // ═══════════════════════════════════════════════════════
    // SECTION 9: Auto-Configure Pipeline (the full chain)
    // ═══════════════════════════════════════════════════════

    const SEC9 = 'Auto-Configure Pipeline';

    await _test(SEC9, 'Drive has default config', async () => {
      // Verify Drive defaults are set (new device will have these from drive.js)
      const cfg = Drive.getConfig();
      if (!cfg.apiKey) return { status: 'fail', detail: 'No API key — Drive defaults may be broken' };
      if (!cfg.folderId) return { status: 'fail', detail: 'No folder ID — Drive defaults may be broken' };
      return { status: 'pass', detail: `API key: ${cfg.apiKey.substring(0, 6)}..., Folder: ${cfg.folderId.substring(0, 8)}...` };
    });

    await _test(SEC9, 'GitHub has default owner/repo', async () => {
      const cfg = GitHub.getConfig();
      if (cfg.owner !== 'catmandabomb') return { status: 'warn', detail: `Owner is "${cfg.owner}" (expected "catmandabomb")` };
      if (cfg.repo !== 'catmantrio') return { status: 'warn', detail: `Repo is "${cfg.repo}" (expected "catmantrio")` };
      return { status: 'pass', detail: `${cfg.owner}/${cfg.repo}` };
    });

    await _test(SEC9, 'Full auto-configure simulation', async () => {
      // Simulate what a brand-new device would do without touching real config
      if (!Drive.isConfigured()) return { status: 'skip', detail: 'Drive not configured — cannot test' };
      const t = _timer('Full pipeline');
      try {
        // Step 1: Find the PAT file
        const file = await Drive.findFilePublic('_github_sync.enc');
        if (!file) return { status: 'fail', detail: 'Step 1 FAILED: _github_sync.enc not on Drive. Desktop must Save & Connect in GitHub Setup first.' };

        // Step 2: Download and decrypt
        const { apiKey } = Drive.getConfig();
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`);
        if (!resp.ok) return { status: 'fail', detail: `Step 2 FAILED: Drive download returned ${resp.status}` };
        const encText = await resp.text();

        // Step 3: Parse encrypted JSON
        let encJson;
        try {
          encJson = JSON.parse(encText);
        } catch (e) {
          return { status: 'fail', detail: 'Step 3 FAILED: _github_sync.enc is not valid JSON — file may be corrupted or using old encryption format' };
        }
        if (!encJson.iv || !encJson.data) return { status: 'fail', detail: 'Step 3 FAILED: Missing iv or data fields — wrong encryption format' };

        // Step 4: Decrypt with app-level key
        const seed = 'catmantrio-sync-propagation-2024';
        const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
        const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
        const ivBytes = Uint8Array.from(atob(encJson.iv), c => c.charCodeAt(0));
        const dataBytes = Uint8Array.from(atob(encJson.data), c => c.charCodeAt(0));
        let pat;
        try {
          const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, dataBytes);
          pat = new TextDecoder().decode(plaintext);
        } catch (e) {
          return { status: 'fail', detail: 'Step 4 FAILED: Decryption failed — PAT was encrypted with a different key (likely old admin-password method). Desktop must re-save GitHub Setup on v17.60+.' };
        }

        if (!pat || pat.length < 10) return { status: 'fail', detail: `Step 4 FAILED: Decrypted PAT is invalid (${pat ? pat.length : 0} chars)` };

        // Step 5: Verify PAT works against GitHub API
        const ghResp = await fetch(`https://api.github.com/repos/catmandabomb/catmantrio`, {
          headers: {
            'Authorization': `Bearer ${pat}`,
            'Accept': 'application/vnd.github+json',
          },
        });
        if (!ghResp.ok) return { status: 'fail', detail: `Step 5 FAILED: GitHub API returned ${ghResp.status} — PAT may be expired or revoked` };
        const ghData = await ghResp.json();

        // Step 6: Verify data branch
        const branchResp = await fetch(`https://api.github.com/repos/catmandabomb/catmantrio/branches/data`, {
          headers: {
            'Authorization': `Bearer ${pat}`,
            'Accept': 'application/vnd.github+json',
          },
        });

        const masked = pat.substring(0, 4) + '...' + pat.substring(pat.length - 4);
        return {
          status: 'pass',
          detail: t() + ` — ALL 6 STEPS PASSED. PAT: ${masked}, Repo: ${ghData.full_name}, Data branch: ${branchResp.ok ? 'exists' : 'MISSING'}`
        };
      } catch (e) {
        return { status: 'fail', detail: `Pipeline exception: ${e.message}` };
      }
    });

    // Final render
    _renderResults();
  }

  // ─── Offline Queue Indicator ─────────────────────────────────

  function _initQueueIndicator() {
    const badge = document.getElementById('qi-badge');
    if (!badge) return;

    function _updateQueueBadge() {
      const online = navigator.onLine;
      const ghOk = typeof GitHub !== 'undefined' && GitHub.isConfigured();
      let status = null; // null = hidden

      if (!online) {
        status = 'offline';
      } else if (ghOk) {
        const wq = GitHub.getWriteQueueStatus();
        if (wq.flushing) {
          status = 'syncing';
        } else if (wq.hasPending) {
          status = 'pending';
          badge.dataset.count = wq.pendingTypes.length;
        }
      }

      if (!status) {
        const lastSync = parseInt(localStorage.getItem('bb_last_synced') || '0', 10);
        if (lastSync && navigator.onLine) {
          const ago = _timeAgo(lastSync);
          badge.classList.remove('hidden');
          badge.className = 'qi-badge qi-synced';
          badge.innerHTML = '<span class="qi-dot"></span>Synced ' + ago;
        } else {
          badge.className = 'qi-badge hidden';
        }
        return;
      }

      badge.classList.remove('hidden');
      badge.className = 'qi-badge qi-' + status;

      if (status === 'offline') {
        badge.innerHTML = '<span class="qi-dot"></span>Offline';
      } else if (status === 'pending') {
        const count = badge.dataset.count || '';
        badge.innerHTML = '<span class="qi-dot"></span>Pending' + (count ? ' (' + count + ')' : '');
      } else if (status === 'syncing') {
        badge.innerHTML = '<span class="qi-dot"></span>Syncing';
      }
    }

    let _onlineDebounce = null;
    window.addEventListener('online', () => {
      _updateQueueBadge();
      clearTimeout(_onlineDebounce);
      _onlineDebounce = setTimeout(() => {
        showToast('Back online');
        if (typeof GitHub !== 'undefined' && GitHub.hasPendingWrites && GitHub.hasPendingWrites()) {
          GitHub.flush && GitHub.flush();
        }
      }, 1500);
    });
    window.addEventListener('offline', () => {
      clearTimeout(_onlineDebounce);
      _updateQueueBadge();
      showToast('Offline — changes saved locally', 4000);
    });
    setInterval(_updateQueueBadge, 2000);
    _updateQueueBadge();
  }

  // ─── Keyboard shortcut help overlay ──────────────────────────
  (function _initKeyboardHelp() {
    const overlay = document.createElement('div');
    overlay.className = 'kb-help-overlay';
    overlay.innerHTML = `<div class="kb-help-content">
      <h2>Keyboard Shortcuts</h2>
      <div class="kb-help-group">
        <h3>General</h3>
        <div class="kb-help-row"><span>Show/hide this help</span><span class="kb-help-key">?</span></div>
        <div class="kb-help-row"><span>Go back</span><span class="kb-help-key">Esc</span></div>
      </div>
      <div class="kb-help-group">
        <h3>PDF Viewer</h3>
        <div class="kb-help-row"><span>Next page</span><span class="kb-help-key">\u2192</span></div>
        <div class="kb-help-row"><span>Previous page</span><span class="kb-help-key">\u2190</span></div>
        <div class="kb-help-row"><span>Zoom in</span><span class="kb-help-key">+</span></div>
        <div class="kb-help-row"><span>Zoom out</span><span class="kb-help-key">-</span></div>
        <div class="kb-help-row"><span>Reset zoom</span><span class="kb-help-key">0</span></div>
      </div>
      <div class="kb-help-group">
        <h3>Live Mode</h3>
        <div class="kb-help-row"><span>Next page</span><span class="kb-help-key">\u2192</span> <span class="kb-help-key">Space</span> <span class="kb-help-key">PgDn</span></div>
        <div class="kb-help-row"><span>Previous page</span><span class="kb-help-key">\u2190</span> <span class="kb-help-key">PgUp</span></div>
        <div class="kb-help-row"><span>Exit</span><span class="kb-help-key">Esc</span></div>
        <div class="kb-help-row" style="margin-top:8px;opacity:0.6;font-size:11px"><span>Bluetooth page turners work via keyboard events (PgUp/PgDn)</span></div>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('visible');
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === '?') {
        // Don't show help when PDF modal or Live Mode is active
        if (!document.getElementById('modal-pdf').classList.contains('hidden')) return;
        if (document.body.classList.contains('live-mode-active')) return;
        e.preventDefault();
        overlay.classList.toggle('visible');
      }
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        overlay.classList.remove('visible');
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    });
  })();

  return { init, showToast, renderList, renderDetail, renderEdit, renderSetlists, renderPractice, renderPracticeDetail, renderPracticeListDetail, renderDashboard, runDiagnostics, hapticHeavy: haptic.heavy, hapticSuccess: haptic.success, hapticTap: haptic.tap };

})();

document.addEventListener('DOMContentLoaded', () => {
  // GIS only on desktop — mobile never writes to Drive (uses GitHub for metadata)
  const isMobile = /iPad|iPhone|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isMobile && Drive.isWriteConfigured() && !document.getElementById('gis-script')) {
    const s = document.createElement('script');
    s.id    = 'gis-script';
    s.src   = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }

  // Wire GitHub callbacks and init crash recovery
  if (typeof GitHub !== 'undefined') {
    GitHub.onFlushError = (msg) => App.showToast(msg, 4000);
    GitHub.onFlushSuccess = () => { localStorage.setItem('bb_last_synced', Date.now().toString()); };
    GitHub.onRateLimitWarning = (msg) => App.showToast(msg, 5000);
    GitHub.init(); // Restore pending writes from crash recovery
  }

  App.init();
});
