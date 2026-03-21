/**
 * songs.js — Song list, detail, and edit views
 *
 * Extracted from app.js Phase 4d. ES module.
 * All state via Store. Cross-module refs resolved at call time.
 */

import * as Store from './store.js?v=20.43';
import { esc, deepClone, highlight, haptic, showToast, gradientText as _gradientText, getOrderedCharts as _getOrderedCharts, getChartOrderNum as _getChartOrderNum, isHybridKey as _isHybridKey, isIOS as _isIOS, findSimilarSongsAsync, findSimilarSongsSync, safeRender, createDirtyTracker, trackFormInputs, ALL_CANONICAL_KEYS, parseKeyField, songMatchesKey } from './utils.js?v=20.43';
import * as Modal from './modal.js?v=20.43';
import * as Router from './router.js?v=20.43';
import * as Admin from '../admin.js?v=20.43';
import * as Auth from '../auth.js?v=20.43';
import * as Sync from './sync.js?v=20.43';
import * as Drive from '../drive.js?v=20.43';
import * as GitHub from '../github.js?v=20.43';
import * as Player from '../player.js?v=20.43';
import * as PDFViewer from '../pdf-viewer.js?v=20.43';
import * as Metronome from '../metronome.js?v=20.43';
import * as App from '../app.js?v=20.43';
import * as Setlists from './setlists.js?v=20.43';
import * as Practice from './practice.js?v=20.43';
import * as Dashboard from './dashboard.js?v=20.43';
import * as IDB from '../idb.js?v=20.43';

// ─── Background audio conversion ────────────────────────────
// After uploading audio to R2, silently convert to WebM/Opus if the
// user's audio_format preference is 'opus' (default). Conversion runs
// in a Web Worker to avoid blocking the UI. On success, the converted
// file replaces the original in R2. On failure, the original is kept.

let _audioConverterWorker = null;

/**
 * Feature-detect whether background Opus conversion is supported.
 * Requires: Web Workers, OfflineAudioContext, MediaRecorder with opus.
 */
function _canConvertAudio() {
  if (typeof Worker === 'undefined') return false;
  if (typeof OfflineAudioContext === 'undefined' && typeof webkitOfflineAudioContext === 'undefined') return false;
  if (typeof MediaRecorder === 'undefined') return false;
  try {
    return MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
  } catch (_) {
    return false;
  }
}

/**
 * Get or create the audio converter Web Worker (singleton).
 */
function _getConverterWorker() {
  if (!_audioConverterWorker) {
    try {
      _audioConverterWorker = new Worker('/workers/audio-converter.js');
    } catch (_) {
      return null;
    }
  }
  return _audioConverterWorker;
}

/**
 * Trigger background audio conversion after a successful upload.
 * This is fire-and-forget from the user's perspective.
 *
 * @param {string} r2FileId - The R2 file ID of the uploaded original
 * @param {string} songId - The song this audio belongs to
 * @param {string} fileName - Original file name (for logging)
 */
function _triggerBackgroundConversion(r2FileId, songId, fileName) {
  // Check preference
  try {
    const pref = localStorage.getItem('ct_pref_audio_format');
    if (pref === 'original') return; // User wants originals kept
  } catch (_) {}

  // Feature detection
  if (!_canConvertAudio()) {
    console.info('Audio conversion: browser does not support WebM/Opus encoding, keeping original');
    return;
  }

  // Skip if already a WebM/Opus file (no need to convert)
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'webm' || ext === 'opus') {
    console.info('Audio conversion: file is already WebM/Opus, skipping');
    return;
  }

  // Fetch the original file from R2, then send to worker
  const token = Auth.getToken ? Auth.getToken() : null;
  if (!token || !GitHub.workerUrl) return;

  console.info(`Audio conversion: starting background conversion for ${fileName} (${r2FileId})`);

  (async () => {
    try {
      // 1. Download the original file from R2
      const resp = await fetch(GitHub.workerUrl + '/files/' + r2FileId, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Failed to fetch original file: ' + resp.status);
      const arrayBuffer = await resp.arrayBuffer();

      // 2. Send to Web Worker for conversion
      const worker = _getConverterWorker();
      if (!worker) throw new Error('Could not create converter worker');

      const conversionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Conversion timed out (5 minutes)'));
        }, 5 * 60 * 1000);

        const handler = (ev) => {
          if (ev.data?.fileId !== r2FileId) return; // Not our conversion
          if (ev.data.type === 'PROGRESS') {
            console.info(`Audio conversion [${r2FileId}]: ${ev.data.stage}`);
            return;
          }
          if (ev.data.type === 'RESULT') {
            clearTimeout(timeout);
            worker.removeEventListener('message', handler);
            if (ev.data.ok) {
              resolve(ev.data.blob);
            } else {
              reject(new Error(ev.data.error));
            }
          }
        };
        worker.addEventListener('message', handler);
      });

      worker.postMessage({
        type: 'CONVERT',
        buffer: arrayBuffer,
        targetFormat: 'opus',
        fileId: r2FileId,
      }, [arrayBuffer]); // Transfer ownership for zero-copy

      const convertedBlob = await conversionPromise;

      // 3. Upload the converted file back to R2, replacing the original
      const uploadResp = await fetch(GitHub.workerUrl + '/files/' + r2FileId, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'audio/webm;codecs=opus',
        },
        body: convertedBlob,
      });

      if (!uploadResp.ok) throw new Error('Failed to upload converted file: ' + uploadResp.status);

      // 4. Clear any cached version of this audio in IDB so next play gets the new one
      try { await IDB.removeCachedAudio(r2FileId); } catch (_) {}

      console.info(`Audio conversion: successfully converted ${fileName} to Opus (${(convertedBlob.size / 1024).toFixed(0)} KB)`);
    } catch (err) {
      // Conversion failed — original file remains intact in R2
      console.warn(`Audio conversion failed for ${fileName}: ${err.message}. Original file kept.`);
    }
  })();
}

// ─── Setlist display title helper ─────────────────────────────
function _slTitle(sl) {
  const label = (sl.overrideTitle || '').trim() || (sl.venue || '').trim() || sl.name || 'Untitled';
  const d = sl.gigDate;
  if (!d) return label;
  if (d === 'TBD') return `${label} (TBD)`;
  const dt = new Date(d + 'T00:00:00');
  const dateStr = isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${label} (${dateStr})`;
}

// ─── Levenshtein worker (local to Songs) ────────────────────
let _levWorker = null;
try { _levWorker = new Worker('workers/levenshtein-worker.js'); } catch (_) {}

function _findSimilarSongsAsync(title, excludeId) {
  return findSimilarSongsAsync(title, excludeId, Store.get('songs'), _levWorker);
}
function _findSimilarSongsSync(title, excludeId) {
  return findSimilarSongsSync(title, excludeId, Store.get('songs'));
}

// ─── Fingerprint state (local, not shared) ──────────────────
let _lastListFingerprint = '';
let _lastTagBarFP = '';
let _lastKeyBarFP = '';

// ─── Sort mode ────────────────────────────────────────────
let _sortMode = 'title'; // 'title' | 'difficulty'

// ─── Memoized filtering helpers ───────────────────────────
// Invalidated when songs data changes (tracked by _songsTs)
let _songsTs = 0;
let _cachedSortedSongs = null;
let _cachedSortMode = 'title';
let _cachedAllTags = null;
let _cachedAllKeys = null;

function _getSongsTs() {
  const songs = Store.get('songs');
  // Use a lightweight fingerprint: length + newest timestamp
  if (!songs.length) return 0;
  let max = 0;
  for (let i = 0; i < songs.length; i++) {
    if ((songs[i]._ts || 0) > max) max = songs[i]._ts || 0;
  }
  return songs.length * 1e13 + max;
}

function _invalidateCache() {
  const ts = _getSongsTs();
  if (ts !== _songsTs || _cachedSortMode !== _sortMode) {
    _songsTs = ts;
    _cachedSortMode = _sortMode;
    _cachedSortedSongs = null;
    _cachedAllTags = null;
    _cachedAllKeys = null;
  }
}

function _sortedSongs() {
  _invalidateCache();
  if (!_cachedSortedSongs) {
    const songs = [...Store.get('songs')];
    if (_sortMode === 'difficulty') {
      songs.sort((a, b) => {
        const da = a.difficulty || 0;
        const db = b.difficulty || 0;
        if (db !== da) return db - da; // highest difficulty first
        return (a.title || '').localeCompare(b.title || '');
      });
    } else {
      songs.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }
    _cachedSortedSongs = songs;
  }
  return _cachedSortedSongs;
}

function allTags() {
  _invalidateCache();
  if (!_cachedAllTags) {
    const songs = Store.get('songs');
    const counts = {};
    for (let i = 0; i < songs.length; i++) {
      const tags = songs[i].tags;
      if (tags) for (let j = 0; j < tags.length; j++) { counts[tags[j]] = (counts[tags[j]] || 0) + 1; }
    }
    _cachedAllTags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }
  return _cachedAllTags;
}

function allKeys() {
  _invalidateCache();
  if (!_cachedAllKeys) {
    const songs = Store.get('songs');
    // Count songs per canonical key (a song can count for multiple keys)
    const counts = {};
    for (const k of ALL_CANONICAL_KEYS) counts[k] = 0;
    for (let i = 0; i < songs.length; i++) {
      const parsed = parseKeyField(songs[i].key);
      for (const k of parsed) {
        if (counts[k] !== undefined) counts[k]++;
      }
    }
    // All 24 keys, ordered by frequency (highest first), then by canonical order for ties
    _cachedAllKeys = [...ALL_CANONICAL_KEYS].sort((a, b) => {
      const diff = counts[b] - counts[a];
      if (diff !== 0) return diff;
      return ALL_CANONICAL_KEYS.indexOf(a) - ALL_CANONICAL_KEYS.indexOf(b);
    });
  }
  return _cachedAllKeys;
}

function filteredSongs() {
  const activeTags = Store.get('activeTags');
  const activeKeys = Store.get('activeKeys');
  const searchText = Store.get('searchText');

  let list = _sortedSongs();
  if (activeTags.length) list = list.filter(s => activeTags.every(t => (s.tags || []).includes(t)));
  if (activeKeys.length) list = list.filter(s => s.key && activeKeys.some(k => songMatchesKey(s.key, k)));
  if (searchText) {
    const q = searchText.toLowerCase();
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

// ─── PDF cache check (delegates to App) ─────────────────────

function _isPdfCached(driveId) {
  return App.isPdfCached ? App.isPdfCached(driveId) : false;
}

// ─── LIST VIEW ──────────────────────────────────────────────

function renderList(force) {
  const APP_VERSION = Store.get('APP_VERSION');
  const songs = Store.get('songs');
  const view = Store.get('view');
  const showViewCalled = Store.get('showViewCalled');
  const activeTags = Store.get('activeTags');
  const activeKeys = Store.get('activeKeys');
  const searchText = Store.get('searchText');
  const selectionMode = Store.get('selectionMode');
  const selectedSongIds = Store.get('selectedSongIds');

  const _preFiltered = filteredSongs();
  const fp = (selectionMode ? '1' : '0') + '|' +
    (Admin.isEditMode() ? '1' : '0') + '|' +
    activeTags.join(',') + '|' + activeKeys.join(',') + '|' +
    (searchText ? '1' : '0') + '|' +
    _preFiltered.map(s => s.id).join(',');

  if (!force && view === 'list' && fp === _lastListFingerprint) return;
  _lastListFingerprint = fp;

  const isDataRefresh = view === 'list' && showViewCalled;

  App.cleanupPlayers();
  // Clear loading skeleton cards (they have no data-song-id)
  const songListEl = document.getElementById('song-list');
  if (songListEl) songListEl.querySelectorAll('.skeleton-card').forEach(el => el.remove());
  if (!selectionMode) { Store.set('selectedSongIds', new Set()); _removeSelectionBar(); }

  if (!isDataRefresh) {
    Store.set('currentRouteParams', {});
    Store.set('navStack', []);
    Router.showView('list');
    Store.set('view', 'list');
    Store.set('showViewCalled', true);
    const catmanGrad = _gradientText('Catman', [215,175,90], [240,220,165]);
    const trioGrad   = _gradientText('Trio', [220,184,105], [235,211,150]);
    Router.setTopbar(
      `<span class="title-catman">${catmanGrad}</span><span class="title-trio">${trioGrad}<span id="admin-version-badge" class="admin-version-badge">${esc(APP_VERSION)}</span></span>`,
      false, true, true
    );
  }

  const addBtn = document.getElementById('btn-add-song');
  if (addBtn) addBtn.classList.toggle('hidden', !Auth.canEditSongs());

  // Tag filter bar
  const tagBar = document.getElementById('tag-filter-bar');
  const allT = allTags();
  const pinned = activeTags.filter(t => allT.includes(t));
  const unpinned = allT.filter(t => !activeTags.includes(t));
  const orderedTags = [...pinned, ...unpinned];
  const hasActiveFilters = searchText || activeTags.length > 0 || activeKeys.length > 0;

  const tagFP = orderedTags.join(',') + '|' + activeTags.join(',');
  if (tagFP !== _lastTagBarFP) {
    _lastTagBarFP = tagFP;
    tagBar.innerHTML = orderedTags.map(t =>
      `<button class="tag-filter-chip ${activeTags.includes(t) ? 'active' : ''}" data-tag="${esc(t)}" aria-pressed="${activeTags.includes(t)}">${esc(t)}</button>`
    ).join('');
    tagBar.querySelectorAll('.tag-filter-chip:not(.clear-chip)').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        const tags = Store.get('activeTags');
        const idx = tags.indexOf(tag);
        if (idx > -1) tags.splice(idx, 1);
        else tags.push(tag);
        Store.set('activeTags', tags);
        renderList();
      });
    });
  }

  const scBtn = document.getElementById('search-clear');
  if (scBtn) scBtn.classList.toggle('hidden', !hasActiveFilters);

  // Sort toggle button
  const sortBtn = document.getElementById('btn-sort-toggle');
  if (sortBtn) {
    sortBtn.title = _sortMode === 'difficulty' ? 'Sort: Difficulty' : 'Sort: A-Z';
    // Update icon based on mode
    const sortIcon = sortBtn.querySelector('i[data-lucide]');
    if (sortIcon) {
      sortIcon.setAttribute('data-lucide', _sortMode === 'difficulty' ? 'gauge' : 'arrow-down-a-z');
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [sortBtn] });
    }
    if (!sortBtn.dataset.wired) {
      sortBtn.dataset.wired = '1';
      sortBtn.addEventListener('click', () => {
        _sortMode = _sortMode === 'title' ? 'difficulty' : 'title';
        _cachedSortedSongs = null;
        _lastListFingerprint = '';
        renderList(true);
      });
    }
  }

  // Key filter bar
  const allK = allKeys();
  const pinnedKeys = activeKeys.filter(k => allK.includes(k));
  const unpinnedKeys = allK.filter(k => !activeKeys.includes(k));
  const orderedKeys = [...pinnedKeys, ...unpinnedKeys];
  const keyFP = orderedKeys.join(',') + '|' + activeKeys.join(',');
  const keyBar = document.getElementById('key-filter-bar');
  if (allK.length > 0 && keyBar) {
    if (keyFP !== _lastKeyBarFP) {
      _lastKeyBarFP = keyFP;
      keyBar.innerHTML = orderedKeys.map(k =>
        `<button class="kf-chip ${activeKeys.includes(k) ? 'active' : ''}" data-key="${esc(k)}" aria-pressed="${activeKeys.includes(k)}">${esc(k)}</button>`
      ).join('');
      keyBar.querySelectorAll('.kf-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const keys = Store.get('activeKeys');
          const idx = keys.indexOf(key);
          if (idx > -1) keys.splice(idx, 1);
          else keys.push(key);
          Store.set('activeKeys', keys);
          renderList();
        });
      });
    }
  } else if (keyBar) {
    _lastKeyBarFP = '';
    keyBar.innerHTML = '';
  }

  const container = document.getElementById('song-list');
  const empty     = document.getElementById('list-empty');
  const noResults = document.getElementById('list-no-results');
  const filtered  = _preFiltered;

  // Apply list density preference
  const scrollWrap = document.getElementById('song-list-scroll');
  try {
    const density = localStorage.getItem('ct_pref_list_density') || 'normal';
    if (scrollWrap) scrollWrap.setAttribute('data-density', density);
  } catch (_) {}
  const savedScroll = isDataRefresh && scrollWrap ? scrollWrap.scrollTop : 0;

  if (isDataRefresh) container.classList.add('no-animate');
  else container.classList.remove('no-animate');

  empty.classList.add('hidden');
  noResults.classList.add('hidden');

  if (songs.length === 0) {
    container.innerHTML = '';
    if (!Auth.isLoggedIn()) {
      empty.innerHTML = '<p id="empty-title">Welcome to Catman Trio</p><p id="empty-sub" class="muted">Log in to access your songs and data.</p>';
      empty.classList.remove('hidden');
    } else if (Store.get('syncing')) {
      empty.innerHTML = '<p id="empty-title">Loading songs\u2026</p><p id="empty-sub" class="muted">Syncing from the cloud.</p>';
      empty.classList.remove('hidden');
    } else {
      empty.innerHTML = '<p id="empty-title">No songs yet</p><p id="empty-sub" class="muted">Songs will appear once data is synced.</p>';
      empty.classList.remove('hidden');
    }
    return;
  }
  if (filtered.length === 0) {
    container.innerHTML = '';
    noResults.innerHTML = '<p>No results.</p><p class="muted">Try a different search or filter.</p>' +
      (searchText || activeTags.length || activeKeys.length ? '<button class="empty-action-btn" id="empty-clear-btn">Clear all filters</button>' : '');
    noResults.classList.remove('hidden');
    noResults.querySelector('#empty-clear-btn')?.addEventListener('click', () => {
      Store.set('searchText', '');
      Store.set('activeTags', []);
      Store.set('activeKeys', []);
      const si = document.getElementById('search-input');
      if (si) si.value = '';
      const sc = document.getElementById('search-clear');
      if (sc) sc.classList.add('hidden');
      renderList();
    });
    return;
  }

  // ─── Keyed DOM reconciliation ───
  // Build map of existing cards by song ID for reuse
  const existingCards = new Map();
  container.querySelectorAll('.song-card[data-song-id]').forEach(el => {
    existingCards.set(el.dataset.songId, el);
  });

  const editMode = Admin.isEditMode();
  const filteredIds = new Set(filtered.map(s => s.id));
  const newCardNodes = [];

  // Card fingerprint: determines if content needs updating
  function _cardFP(song) {
    return (song._ts || 0) + '|' + (editMode ? '1' : '0') + '|' + (selectionMode ? '1' : '0') + '|' + (searchText || '') + '|' + (song.difficulty || 0);
  }

  filtered.forEach((song, i) => {
    let card = existingCards.get(song.id);
    const cfp = _cardFP(song);
    let needsContent = false;

    if (card) {
      // Reuse existing card — check if content changed
      existingCards.delete(song.id);
      if (card.dataset.cfp !== cfp) {
        needsContent = true;
      }
      // Update selection state
      card.className = 'song-card' + (selectionMode && selectedSongIds.has(song.id) ? ' song-card-selected' : '');
      // Ensure accessibility attributes are present on reused cards
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Song: ${song.title || 'Untitled'}`);
    } else {
      // Create new card
      card = document.createElement('div');
      card.dataset.songId = song.id;
      if (!isDataRefresh) card.style.animationDelay = `${i * 30}ms`;
      needsContent = true;
    }

    if (needsContent) {
      // Clone-replace to drop stale event listeners from previous renders
      const fresh = document.createElement('div');
      fresh.dataset.songId = song.id;
      fresh.dataset.cfp = cfp;
      fresh.className = 'song-card' + (selectionMode && selectedSongIds.has(song.id) ? ' song-card-selected' : '');
      fresh.setAttribute('tabindex', '0');
      fresh.setAttribute('role', 'button');
      fresh.setAttribute('aria-label', `Song: ${song.title || 'Untitled'}`);
      fresh.innerHTML = (selectionMode ? _selectionCheckboxHTML(song.id) : '') + _songCardHTML(song);
      if (card.parentNode) card.parentNode.replaceChild(fresh, card);
      card = fresh;
      _wireCardEvents(card, song, selectionMode, editMode);
    }

    newCardNodes.push(card);
  });

  // Remove cards no longer in the filtered list
  existingCards.forEach(el => el.remove());

  // Reconcile order: only move/append if needed
  let prevNode = null;
  for (const node of newCardNodes) {
    if (node.parentNode !== container) {
      // New node — insert in correct position
      if (prevNode && prevNode.nextSibling) {
        container.insertBefore(node, prevNode.nextSibling);
      } else if (!prevNode) {
        container.insertBefore(node, container.firstChild);
      } else {
        container.appendChild(node);
      }
    }
    prevNode = node;
  }

  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });
  if (savedScroll && scrollWrap) scrollWrap.scrollTop = savedScroll;
  if (selectionMode) {
    _showSelectionBar();
    const navStack = Store.get('navStack');
    if (!navStack.length) { navStack.push(function() { _exitSelectionMode(); }); Store.set('navStack', navStack); }
  } else {
    _removeSelectionBar();
  }
  const listFooter = document.getElementById('list-footer');
  if (listFooter) {
    const isLoggedIn = Auth.isLoggedIn();
    // Always show footer on the main song list page
    listFooter.classList.remove('hidden');
    // Wire footer nav links (once — check for data attribute to avoid duplicate listeners)
    if (!listFooter.dataset.wired) {
      listFooter.dataset.wired = '1';
      listFooter.addEventListener('click', (e) => {
        const link = e.target.closest('[data-footer-nav]');
        if (!link) return;
        e.preventDefault();
        const target = link.dataset.footerNav;
        const currentView = Store.get('view');
        if (target === 'list') {
          if (currentView === 'list') {
            // Already on songs list — scroll to top
            const scroll = document.getElementById('song-list-scroll');
            if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            App.renderList();
          }
        } else if (target === 'setlists') {
          if (!Auth.isLoggedIn()) {
            showToast('Log in to view setlists');
            return;
          }
          if (currentView === 'setlists') {
            const scroll = document.getElementById('setlists-list');
            if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            Setlists.renderSetlists();
          }
        } else if (target === 'practice') {
          if (!Auth.isLoggedIn()) {
            showToast('Log in to view practice lists');
            return;
          }
          if (currentView === 'practice') {
            const scroll = document.getElementById('practice-list');
            if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            Practice.renderPractice();
          }
        } else if (target === 'sync') {
          if (!Auth.isLoggedIn()) {
            showToast('Log in to sync');
            return;
          }
          App.syncAll(true);
        } else if (target === 'dashboard') {
          if (!Auth.isLoggedIn() || !Auth.isOwnerOrAdmin()) {
            showToast('Log in as admin to access Dashboard');
            return;
          }
          Dashboard.renderDashboard();
        }
      });
    }
  }
}

function _songCardHTML(song) {
  const a = song.assets || {};
  const charts = (a.charts || []).length;
  const audio  = (a.audio  || []).length;
  const links  = (a.links  || []).length;
  const q = Store.get('searchText') || '';

  const pills = [
    charts ? `<span class="asset-pill chart">${charts} chart${charts !== 1 ? 's' : ''}</span>` : '',
    audio  ? `<span class="asset-pill audio">${audio} demo${audio !== 1 ? 's' : ''}</span>`    : '',
    links  ? `<span class="asset-pill links">${links} link${links !== 1 ? 's' : ''}</span>`    : '',
  ].filter(Boolean).join('');

  const tagHtml = (song.tags || []).map(t => `<span class="song-tag">${highlight(t, q)}</span>`).join('');
  const bpmStr = song.bpm ? `${highlight(String(song.bpm), q)} bpm${song.timeSig ? ' (' + highlight(song.timeSig, q) + ')' : ''}` : '';
  const bpmHtml = bpmStr ? `<span class="song-card-bpm">${bpmStr}</span>` : '';

  const editIcon = Admin.isEditMode() ? '<button class="song-card-edit-btn" aria-label="Edit song"><i data-lucide="pencil"></i></button>' : '';
  const diffBadge = song.difficulty ? `<span class="song-difficulty-badge" data-diff="${song.difficulty}" title="Difficulty ${song.difficulty}/5">${song.difficulty}</span>` : '';

  return `
    <div class="song-card-title-row"><span class="song-card-title">${highlight(song.title, q) || '<em style="color:var(--text-3)">Untitled</em>'}</span>${editIcon}</div>
    ${song.subtitle ? `<span class="song-card-subtitle">${highlight(song.subtitle, q)}</span>` : ''}
    <div class="song-card-meta">
      ${diffBadge}
      <span class="song-card-key">${highlight(song.key, q)}</span>
      ${bpmHtml}
    </div>
    <div class="song-card-footer">
      <div class="asset-pills">${pills}</div>
      <div class="song-tags">${tagHtml}</div>
    </div>`;
}

/**
 * Wire event listeners on a song card node.
 */
function _wireCardEvents(card, song, selectionMode, editMode) {
  // Keyboard accessibility: Enter/Space triggers click
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.click();
    }
  });
  if (selectionMode) {
    card.addEventListener('click', () => {
      haptic.tap();
      _toggleSongSelection(song.id, card);
    });
  } else {
    card.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) { showToast('Log in to view song details'); return; }
      haptic.tap(); renderDetail(song);
    });
    // Long-press to enter selection mode — available to all authenticated users
    let lpTimer = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (!Auth.isLoggedIn()) { showToast('Log in to select songs'); return; }
      lpTimer = setTimeout(() => { lpTimer = null; e.preventDefault(); _enterSelectionMode(song.id); }, 500);
    });
    const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    card.addEventListener('pointerup', cancelLp);
    card.addEventListener('pointercancel', cancelLp);
    card.addEventListener('pointermove', (e) => { if (lpTimer && (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5)) cancelLp(); });
    card.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  if (!selectionMode && editMode) {
    card.querySelector('.song-card-edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      renderEdit(song, false);
    });
  }
}

// ─── BATCH SELECTION MODE ────────────────────────────────────

function _selectionCheckboxHTML(songId) {
  const checked = Store.get('selectedSongIds').has(songId);
  return '<div class="sel-checkbox ' + (checked ? 'sel-checked' : '') + '">' + (checked ? '<i data-lucide="check"></i>' : '') + '</div>';
}

function _enterSelectionMode(firstSongId) {
  if (Store.get('selectionMode')) return;
  Store.set('selectionMode', true);
  Store.set('selectedSongIds', new Set([firstSongId]));
  haptic.medium();
  const navStack = Store.get('navStack');
  navStack.push(function() { _exitSelectionMode(); });
  Store.set('navStack', navStack);
  renderList(); // render AFTER navStack push so renderList's guard sees it
}

function _exitSelectionMode() {
  if (!Store.get('selectionMode')) return;
  Store.set('selectionMode', false);
  Store.set('selectedSongIds', new Set());
  _removeSelectionBar();
  renderList();
}

function _toggleSongSelection(songId, card) {
  const selectedSongIds = Store.get('selectedSongIds');
  if (selectedSongIds.has(songId)) {
    selectedSongIds.delete(songId);
    card.classList.remove('song-card-selected');
    var cb = card.querySelector('.sel-checkbox');
    if (cb) { cb.classList.remove('sel-checked'); cb.innerHTML = ''; }
  } else {
    selectedSongIds.add(songId);
    card.classList.add('song-card-selected');
    var cb2 = card.querySelector('.sel-checkbox');
    if (cb2) { cb2.classList.add('sel-checked'); cb2.innerHTML = '<i data-lucide="check"></i>'; }
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [card] });
  }
  Store.set('selectedSongIds', selectedSongIds);
  _updateSelectionCount();
}

function _showSelectionBar() {
  _removeSelectionBar();
  const selectedSongIds = Store.get('selectedSongIds');
  const isAdmin = Admin.isEditMode();
  var bar = document.createElement('div');
  bar.id = 'batch-selection-bar';
  bar.className = 'batch-selection-bar';
  bar.innerHTML = '<span class="batch-sel-count">' + selectedSongIds.size + ' selected</span>' +
    (isAdmin
      ? '<button class="batch-sel-add-btn">Add to Setlist</button>'
      : '<button class="batch-sel-add-btn">Add to Practice List</button>') +
    '<button class="batch-sel-cancel" aria-label="Cancel selection"><i data-lucide="x"></i></button>';
  document.body.appendChild(bar);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bar] });
  bar.querySelector('.batch-sel-add-btn').addEventListener('click', function() {
    if (isAdmin) {
      _batchAddToSetlist();
    } else {
      _batchAddToPractice();
    }
  });
  bar.querySelector('.batch-sel-cancel').addEventListener('click', function() { _exitSelectionMode(); });
  var escHandler = function(e) { if (e.key === 'Escape' && Store.get('selectionMode')) _exitSelectionMode(); };
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
  if (el) el.textContent = Store.get('selectedSongIds').size + ' selected';
  var addBtn = document.querySelector('.batch-sel-add-btn');
  if (addBtn) addBtn.disabled = Store.get('selectedSongIds').size === 0;
}

function _batchAddToSetlist() {
  if (!Admin.isEditMode()) return;
  const selectedSongIds = Store.get('selectedSongIds');
  if (selectedSongIds.size === 0) { showToast('No songs selected'); return; }
  const setlists = Store.get('setlists');
  var available = setlists.filter(function(s) { return !s.archived; });
  if (!available.length) { showToast('No setlists yet'); return; }
  var existing = document.getElementById('batch-setlist-picker');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'batch-setlist-picker';
  overlay.className = 'modal-overlay';
  var selCount = selectedSongIds.size;
  var rows = available.map(function(s, i) {
    var count = (s.songs || []).length;
    return '<div class="setlist-pick-row" data-sl-idx="' + i + '">' +
      '<span class="setlist-pick-name">' + esc(_slTitle(s)) + '</span>' +
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
      selectedSongIds.forEach(function(songId) {
        if (!existingIds.has(songId)) {
          setlist.songs.push({ id: songId, comment: '' });
          added++;
        }
      });
      if (added === 0) {
        showToast('All songs already in ' + _slTitle(setlist));
      } else {
        Sync.saveSetlistsLocal(setlists);
        Sync.saveSetlists();
        haptic.success();
        showToast('Added ' + added + ' song' + (added !== 1 ? 's' : '') + ' to ' + _slTitle(setlist));
      }
      overlay.remove();
      _exitSelectionMode();
    });
  });
}

function _batchAddToPractice() {
  if (Admin.isEditMode()) return; // safety guard — non-admin function only
  const selectedSongIds = Store.get('selectedSongIds');
  if (selectedSongIds.size === 0) { showToast('No songs selected'); return; }
  if (Practice.showBatchPracticeListPicker) {
    Practice.showBatchPracticeListPicker(selectedSongIds);
    _exitSelectionMode();
  } else {
    showToast('Practice module not loaded');
  }
}

// ─── DETAIL VIEW ────────────────────────────────────────────

// Detail anchor bar removed — sidebar scroll shortcuts no longer used in song detail

function renderDetail(song, skipNavPush) {
  App.cleanupPlayers();
  Player.stopAll();
  Store.set('activeSong', song);
  Store.set('currentRouteParams', { songId: song.id });
  if (!skipNavPush) {
    Router.pushNav(() => renderList());
  }
  Store.set('skipViewTransition', true);
  Router.showView('detail');
  Store.set('view', 'detail');
  Store.set('showViewCalled', true);
  Router.setTopbar(song.title || 'Song', true);

  // Add to Setlist (admin) or Add to Practice List (non-admin) in topbar
  // Inject synchronously so buttons are part of the View Transition "new" state.
  if (Auth.isLoggedIn()) {
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      topbarRight.querySelector('#song-detail-topbar-actions')?.remove();
      const wrap = document.createElement('div');
      wrap.id = 'song-detail-topbar-actions';
      wrap.className = 'topbar-actions-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;';
      if (Admin.isEditMode()) {
        wrap.innerHTML = `<button class="btn-ghost topbar-nav-btn btn-add-to-setlist" aria-label="Add to Setlist" title="Add to Setlist"><i data-lucide="list-plus" style="width:14px;height:14px;vertical-align:-2px;"></i><span class="topbar-btn-label">Add to Setlist</span></button>`;
      } else {
        wrap.innerHTML = `<button class="btn-ghost topbar-nav-btn btn-add-to-practice-list" aria-label="Add to Practice" title="Add to Practice"><i data-lucide="notebook-pen" style="width:14px;height:14px;vertical-align:-2px;"></i><span class="topbar-btn-label">Add to Practice</span></button>`;
      }
      topbarRight.appendChild(wrap);
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrap] });
      wrap.querySelector('.btn-add-to-setlist')?.addEventListener('click', () => {
        _showSetlistPicker(song);
      });
      wrap.querySelector('.btn-add-to-practice-list')?.addEventListener('click', () => {
        if (Practice.showPracticeListPicker) {
          Practice.showPracticeListPicker(song);
        } else {
          showToast('Practice module not loaded');
        }
      });
    }
  }

  const container = document.getElementById('detail-content');
  container.innerHTML = _buildDetailHTML(song);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

  // Show volume slider only when song has audio files or streaming links
  const _a = song.assets || {};
  const hasAudio = (_a.audio || []).length > 0 || (_a.links || []).length > 0;
  if (App.showVolume) App.showVolume(hasAudio);

  // Email verification gate: hide PDF charts and audio for unverified users
  // Owner is exempt, unverified non-owners see placeholder
  const _authUser = Auth.getUser();
  const emailOk = !_authUser || _authUser.role === 'owner' || (Auth.isEmailVerified());
  if (!emailOk) {
    // Hide chart and audio sections, show verify message
    container.querySelectorAll('#detail-charts, #detail-audio').forEach(el => {
      el.innerHTML = '<p class="muted" style="padding:12px;text-align:center;font-size:13px;">Verify your email to access charts and audio files.</p>';
    });
  }

  // Detail anchor bar removed (user requested)

  if (Admin.isEditMode()) {
    container.querySelector('.btn-edit-song')?.addEventListener('click', () => renderEdit(song, false));
  } else {
    container.querySelector('.detail-edit-bar')?.remove();
  }

  // Setlist history: toggle + click to navigate
  container.querySelector('.detail-section-toggle[data-toggle="setlist-history-list"]')?.addEventListener('click', () => {
    const list = document.getElementById('setlist-history-list');
    if (!list) return;
    const icon = container.querySelector('.detail-section-toggle[data-toggle="setlist-history-list"] i, .detail-section-toggle[data-toggle="setlist-history-list"] svg');
    list.classList.toggle('collapsed');
    if (icon) icon.style.transform = list.classList.contains('collapsed') ? '' : 'rotate(180deg)';
  });
  container.querySelectorAll('.setlist-history-row').forEach(row => {
    row.addEventListener('click', () => {
      const sl = (Store.get('setlists') || []).find(s => s.id === row.dataset.slId);
      if (sl && Setlists.renderSetlistDetail) {
        Router.pushNav(() => renderDetail(song, true));
        Setlists.renderSetlistDetail(sl, true);
      }
    });
  });

  // Pre-fetch all chart PDFs eagerly
  const chartFileIds = (song.assets?.charts || []).map(c => c.r2FileId || c.driveId).filter(Boolean);
  chartFileIds.forEach(id => {
    App.getBlobUrl(id).catch(() => {});
  });

  // Chart order star toggles (any logged-in user can favorite, max 6)
  const _canFavorite = Admin.isEditMode() || (Auth.isLoggedIn());
  if (_canFavorite) {
    container.querySelectorAll('.chart-order-star').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        haptic.tap();
        const driveId = btn.dataset.starChart;
        if (!song.chartOrder) song.chartOrder = [];
        const existing = song.chartOrder.findIndex(o => o.driveId === driveId);
        if (existing !== -1) {
          // Unfavorite: remove and renumber
          song.chartOrder.splice(existing, 1);
          song.chartOrder.sort((a, b) => a.order - b.order).forEach((o, i) => o.order = i + 1);
        } else {
          // Favorite: enforce max 6 cap
          if (song.chartOrder.length >= 6) {
            showToast('Max 6 favorites per song');
            return;
          }
          const maxOrder = song.chartOrder.reduce((m, o) => Math.max(m, o.order), 0);
          song.chartOrder.push({ driveId, order: maxOrder + 1 });
        }
        song._ts = Date.now();
        const songs = Store.get('songs');
        const idx = songs.findIndex(s => s.id === song.id);
        if (idx > -1) songs[idx] = song;
        Store.set('songs', songs);
        await Sync.saveSongs();
        renderDetail(song, true);
      });
    });
  }

  // Chart buttons
  container.querySelectorAll('[data-open-chart]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      // Don't open PDF when clicking the star toggle
      if (e.target.closest('.chart-order-star')) return;
      btn.disabled = true;
      try {
        const url = await App.getBlobUrl(btn.dataset.openChart);
        const activeSong = Store.get('activeSong');
        PDFViewer.open(url, btn.dataset.name, {
          songId: activeSong?.id || null,
          songNotes: activeSong?.notes || null,
        });
      } catch (e) {
        showToast('Failed to load chart.');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Audio players — load synchronously (no setTimeout) to avoid race with blob cache
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
      const url = (_isIOS() && !Sync.useCloudflare()) ? Drive.getDirectUrl(driveId) : await App.getBlobUrl(driveId);
      if (!url) throw new Error('No audio URL');
      el.innerHTML = '';
      const ref = Player.create(el, { name: el.dataset.name || 'Audio', blobUrl: url, songTitle: el.dataset.songTitle || '', songId: driveId });
      App.trackPlayerRef(ref);
    } catch (err) {
      console.error('Audio load failed:', driveId, err);
      el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`;
    }
  });

  // Download buttons
  container.querySelectorAll('.dl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      App.downloadFile(btn.dataset.dlId, btn.dataset.dlName, btn);
    });
  });

  // Audio offline cache buttons — update state to show cached/uncached
  _updateAudioCacheButtons(container);

  container.querySelectorAll('.btn-cache-audio').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fileId = btn.dataset.cacheId;
      const filename = btn.dataset.cacheName;
      const songId = btn.dataset.songId;
      if (!IDB.isAvailable()) { showToast('Offline storage not available'); return; }
      // Check if already cached — toggle
      const existing = await IDB.getCachedAudio(fileId);
      if (existing) {
        await IDB.removeCachedAudio(fileId);
        btn.classList.remove('cached');
        btn.title = 'Save for offline';
        showToast('Removed from offline cache');
      } else {
        btn.disabled = true;
        btn.innerHTML = '<span class="dl-spinner"></span>';
        try {
          const url = await App.getBlobUrl(fileId);
          const resp = await fetch(url);
          const blob = await resp.blob();
          await IDB.cacheAudio(fileId, blob, songId, filename);
          btn.classList.add('cached');
          btn.title = 'Saved offline (tap to remove)';
          showToast('Saved for offline playback');
        } catch (e) {
          console.error('Audio cache failed:', e);
          showToast('Failed to cache audio');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="hard-drive-download" style="width:14px;height:14px;"></i>';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      }
    });
  });

  // "Download all for offline" section button
  container.querySelectorAll('.btn-cache-all-audio').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!IDB.isAvailable()) { showToast('Offline storage not available'); return; }
      const audioBtns = container.querySelectorAll('.btn-cache-audio:not(.cached)');
      if (!audioBtns.length) { showToast('All audio already cached'); return; }
      btn.disabled = true;
      btn.textContent = 'Caching...';
      let cached = 0;
      for (const ab of audioBtns) {
        try { ab.click(); cached++; } catch (_) {}
        await new Promise(r => setTimeout(r, 200)); // stagger fetches
      }
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="hard-drive-download" style="width:12px;height:12px;vertical-align:-2px;margin-right:3px;"></i>Offline';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  });
}

async function _updateAudioCacheButtons(container) {
  if (!IDB.isAvailable()) return;
  try {
    const cached = await IDB.listCachedAudio();
    const cachedIds = new Set(cached.map(c => c.fileId));
    container.querySelectorAll('.btn-cache-audio').forEach(btn => {
      if (cachedIds.has(btn.dataset.cacheId)) {
        btn.classList.add('cached');
        btn.title = 'Saved offline (tap to remove)';
      }
    });
  } catch (_) {}
}

function _showSetlistPicker(song) {
  if (!Admin.isEditMode()) return;
  const setlists = Store.get('setlists');
  const available = setlists.filter(s => !s.archived);
  if (!available.length) {
    showToast('No setlists yet');
    return;
  }

  const rows = available.map((s, i) => {
    const count = (s.songs || []).length;
    return `<div class="setlist-pick-row" data-sl-idx="${i}">
      <span class="setlist-pick-name">${esc(_slTitle(s))}</span>
      <span class="setlist-pick-count">${count} song${count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');

  const handle = Modal.create({
    id: 'setlist-picker-overlay',
    cls: 'setlist-picker',
    content: `<h3>Add to Setlist</h3>${rows}<button class="setlist-picker-cancel">Cancel</button>`,
  });
  if (!handle) return;

  handle.overlay.querySelector('.setlist-picker-cancel').addEventListener('click', () => handle.hide());

  handle.overlay.querySelectorAll('.setlist-pick-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.slIdx, 10);
      const setlist = available[idx];
      if (!setlist) return;

      const already = (setlist.songs || []).some(entry => entry.id === song.id);
      if (already) {
        showToast('Already in ' + _slTitle(setlist));
        handle.hide();
        return;
      }

      if (!setlist.songs) setlist.songs = [];
      setlist.songs.push({ id: song.id, comment: '' });
      Sync.saveSetlistsLocal(setlists);
      Sync.saveSetlists();
      showToast('Added to ' + _slTitle(setlist));
      handle.hide();
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
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-song"><i data-lucide="pencil" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Edit Song</button></div>` : ''}
      <div class="detail-title">${esc(song.title) || 'Untitled'}</div>
      ${song.subtitle ? `<div class="detail-subtitle">${esc(song.subtitle)}</div>` : ''}
      <div class="detail-meta-row">
        ${song.key ? `<div class="detail-meta-item"><span class="detail-meta-label">Key</span><span class="detail-meta-value">${esc(song.key)}</span></div>` : ''}
        ${song.bpm ? `<div class="detail-meta-item"><span class="detail-meta-label">BPM</span><span class="detail-meta-value">${esc(String(song.bpm))}</span></div>` : ''}
        ${song.timeSig ? `<div class="detail-meta-item"><span class="detail-meta-label">Time</span><span class="detail-meta-value">${esc(song.timeSig)}</span></div>` : ''}
        ${song.difficulty && !(Sync.getOrchestraSetting('hide_difficulty_from_members', 'false') === 'true' && !Auth.canEditSongs?.()) ? `<div class="detail-meta-item"><span class="detail-meta-label">Difficulty</span><span class="detail-meta-value"><span class="song-difficulty-badge" data-diff="${song.difficulty}">${song.difficulty}</span></span></div>` : ''}
      </div>
    </div>
    `;

  // Hide notes from members if conductr setting is enabled
  const _hideNotes = Sync.getOrchestraSetting('hide_notes_from_members', 'false') === 'true' && !Auth.canEditSongs?.();
  if (song.notes && !_hideNotes) {
    html += `<div class="detail-section" id="detail-notes">
      <div class="detail-section-label">Notes & Directions</div>
      <div class="detail-notes">${esc(song.notes)}</div>
    </div>`;
  }

  if (charts.length) {
    html += `<div class="detail-section" id="detail-charts">
      <div class="detail-section-label">Charts</div>
      <div class="file-list">
        ${charts.map(c => {
          const fid = c.r2FileId || c.driveId;
          const orderNum = _getChartOrderNum(song, c.driveId || c.r2FileId);
          const _loggedIn = Auth.isLoggedIn();
          const canStar = Admin.isEditMode() || _loggedIn;
          return `
          <div class="file-item-row">
            <button class="file-item" data-open-chart="${esc(fid)}" data-name="${esc(c.name)}">
              <span class="chart-order-star${orderNum ? ' active' : ''}${canStar ? '' : ' readonly'}" data-star-chart="${esc(fid)}" aria-label="Set chart order" title="Chart order for live mode">
                <i data-lucide="star" style="width:16px;height:16px;${orderNum ? 'fill:var(--accent);' : ''}"></i>
                ${orderNum ? `<span class="chart-order-num">${orderNum}</span>` : ''}
              </span>
              <div class="file-item-icon pdf">
                <i data-lucide="file-text"></i>
              </div>
              <span class="file-item-name">${esc(c.name)}</span>
              <span class="pdf-cached-badge${_isPdfCached(fid) ? ' cached' : ''}" data-cache-id="${esc(fid)}" title="${_isPdfCached(fid) ? 'Available offline' : 'Not cached'}">
                <i data-lucide="${_isPdfCached(fid) ? 'cloud-check' : 'cloud'}" style="width:14px;height:14px;"></i>
              </span>
              <i data-lucide="chevron-right" class="file-item-arrow"></i>
            </button>
            <button class="dl-btn" data-dl-id="${esc(fid)}" data-dl-name="${esc(c.name)}" aria-label="Download">
              <i data-lucide="download" class="dl-icon"></i>
              <span class="dl-spinner hidden"></span>
            </button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if (audio.length) {
    html += `<div class="detail-section" id="detail-audio">
      <div class="detail-section-label" style="display:flex;justify-content:space-between;align-items:center;">
        Demo Recordings
        <button class="btn-ghost btn-cache-all-audio" data-song-id="${esc(song.id)}" style="font-size:11px;padding:2px 8px;" title="Save all audio for offline">
          <i data-lucide="hard-drive-download" style="width:12px;height:12px;vertical-align:-2px;margin-right:3px;"></i>Offline
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${audio.map(a => {
          const fid = a.r2FileId || a.driveId;
          return `
          <div class="audio-row">
            <div class="audio-row-player" data-audio-container="${esc(fid)}" data-name="${esc(a.name)}" data-song-title="${esc(song.title || '')}"></div>
            <div class="audio-row-actions">
              <button class="btn-cache-audio" data-cache-id="${esc(fid)}" data-cache-name="${esc(a.name)}" data-song-id="${esc(song.id)}" aria-label="Save for offline" title="Save for offline">
                <i data-lucide="hard-drive-download" style="width:14px;height:14px;"></i>
              </button>
              <button class="dl-btn" data-dl-id="${esc(fid)}" data-dl-name="${esc(a.name)}" aria-label="Download" title="Download to device">
                <i data-lucide="download" class="dl-icon"></i>
                <span class="dl-spinner hidden"></span>
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if (links.length) {
    html += `<div class="detail-section" id="detail-links">
      <div class="detail-section-label">Streaming & Links</div>
      <div class="embed-list">
        ${links.map(l => _buildEmbedHTML(l)).join('')}
      </div>
    </div>`;
  }

  // Setlist history — show which setlists contain this song
  const setlists = Store.get('setlists') || [];
  const containingSl = setlists.filter(sl =>
    (sl.songs || []).some(e => !e.freetext && e.id === song.id)
  );
  if (containingSl.length) {
    const slRows = containingSl.map(sl => {
      const dateStr = sl.gigDate && sl.gigDate !== 'TBD'
        ? (() => { const d = new Date(sl.gigDate + 'T00:00:00'); return isNaN(d) ? sl.gigDate : `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`; })()
        : (sl.gigDate || '');
      return `<div class="setlist-history-row" data-sl-id="${esc(sl.id)}">
        <span class="setlist-history-name">${esc(_slTitle(sl))}</span>
        ${sl.archived ? '<span class="setlist-history-badge archived">archived</span>' : ''}
      </div>`;
    }).join('');
    html += `<div class="detail-section detail-setlist-history">
      <button class="detail-section-label detail-section-toggle" data-toggle="setlist-history-list">
        Setlist History <span class="muted" style="font-weight:400">(${containingSl.length})</span>
        <i data-lucide="chevron-down" style="width:14px;height:14px;margin-left:4px;vertical-align:-2px;transition:transform 0.2s;"></i>
      </button>
      <div class="setlist-history-list collapsed" id="setlist-history-list">${slRows}</div>
    </div>`;
  }

  if ((song.tags||[]).length) {
    html += `<div class="detail-section">
      <div class="detail-section-label">Tags</div>
      <div class="detail-tags">${song.tags.map(t=>`<span class="detail-tag">${esc(t)}</span>`).join('')}</div>
    </div>`;
  }

  return html;
}

function _buildEmbedHTML(link) {
  const meta = {
    youtube:    { label: 'YouTube',     icon: '\u25b6', cls: 'youtube'    },
    spotify:    { label: 'Spotify',     icon: '\u266b', cls: 'spotify'    },
    applemusic: { label: 'Apple Music', icon: '\u266a', cls: 'applemusic' },
  };
  const m = meta[link.type] || { label: link.type, icon: '\ud83d\udd17', cls: '' };

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
        <a href="${esc(link.url)}" target="_blank" rel="noopener" class="embed-open-btn">Open \u2197</a>
      </div>
    </div>`;
}

// ─── EDIT VIEW ──────────────────────────────────────────────

function renderEdit(song, isNew) {
  App.cleanupPlayers();
  Player.stopAll();
  const editSong = deepClone(song);
  Store.set('editSong', editSong);
  Store.set('editIsNew', isNew);
  if (!editSong.assets) editSong.assets = { charts: [], audio: [], links: [] };
  if (!isNew && Store.get('activeSong')) {
    const activeSong = Store.get('activeSong');
    Router.pushNav(() => renderDetail(activeSong, true));
  }
  Store.set('skipViewTransition', true);
  Router.showView('edit');
  Store.set('view', 'edit');
  Store.set('showViewCalled', true);
  Router.setTopbar(isNew ? 'New Song' : 'Edit Song', true);
  const editContainer = document.getElementById('edit-content');
  editContainer.innerHTML = _buildEditHTML(editSong, isNew);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [editContainer] });
  _wireEditForm();
}

function _buildEditHTML(song, isNew) {
  const assets = song.assets;
  return `
    <div class="edit-section">
      <div class="edit-section-title">Song Info</div>
      <div class="form-field">
        <label class="form-label">Title</label>
        <input class="form-input" id="ef-title" type="text" value="${esc(song.title)}" placeholder="Song title" />
        <div id="ef-duplicate-warning" class="hidden" style="background:rgba(212,180,120,0.15);border:1px solid var(--accent);border-radius:8px;padding:8px 12px;margin-top:4px;color:var(--accent);font-size:0.85rem;"></div>
      </div>
      <div class="form-field">
        <label class="form-label">Subtitle</label>
        <input class="form-input" id="ef-subtitle" type="text" value="${esc(song.subtitle)}" placeholder="Short description, vibe, structure\u2026" />
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Key</label>
          <input class="form-input" id="ef-key" type="text" value="${esc(song.key)}" placeholder="e.g. Bm, F#" />
        </div>
        <div class="form-field">
          <label class="form-label">BPM${(assets.audio||[]).length > 0 ? ' <button class="btn-bpm-detect" id="ef-bpm-detect" title="Auto-detect BPM from audio"><i data-lucide="activity" style="width:11px;height:11px;"></i></button>' : ''}</label>
          <input class="form-input" id="ef-bpm" type="number" value="${esc(String(song.bpm||''))}" placeholder="120" min="1" max="999" />
        </div>
        <div class="form-field">
          <label class="form-label">Time</label>
          <input class="form-input" id="ef-timesig" type="text" value="${esc(song.timeSig||'')}" placeholder="4/4" />
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Difficulty</label>
        <div class="difficulty-picker" id="ef-difficulty">
          ${[1,2,3,4,5].map(n => `<button type="button" class="difficulty-picker-btn${song.difficulty === n ? ' active' : ''}" data-diff="${n}">${n}</button>`).join('')}
          <button type="button" class="difficulty-picker-clear" id="ef-diff-clear">Clear</button>
        </div>
      </div>
    </div>

    <div class="edit-section">
      <div class="edit-section-title">Notes & Directions</div>
      <div class="form-field">
        <textarea class="form-input" id="ef-notes" rows="6" placeholder="Performance notes, arrangement directions, key changes, feel\u2026">${esc(song.notes)}</textarea>
      </div>
    </div>

    <div class="edit-section">
      <div class="edit-section-title">Charts (PDF)</div>
      <div class="asset-edit-list" id="ef-chart-list">
        ${(assets.charts||[]).map(c => {
          const fid = c.r2FileId || c.driveId;
          const orderNum = _getChartOrderNum(song, c.driveId || c.r2FileId);
          return `<div class="asset-edit-row" data-drive-id="${esc(fid)}"><button class="chart-order-star${orderNum ? ' active' : ''}" data-star-chart="${esc(fid)}" aria-label="Set chart order" title="Chart order for live mode"><i data-lucide="star" style="width:14px;height:14px;${orderNum ? 'fill:var(--accent);' : ''}"></i>${orderNum ? `<span class="chart-order-num">${orderNum}</span>` : ''}</button><span class="asset-edit-name">${esc(c.name)}</span><button class="asset-edit-remove asset-delete-btn" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button></div>`;
        }).join('')}
      </div>
      <button class="btn-ghost" id="ef-add-chart">+ Add Chart PDF</button>
      <input type="file" id="ef-chart-file" accept=".pdf,application/pdf" style="display:none" multiple />
    </div>

    <div class="edit-section">
      <div class="edit-section-title">Demo Recordings</div>
      <div class="asset-edit-list" id="ef-audio-list">
        ${(assets.audio||[]).map(a=>`<div class="asset-edit-row" data-drive-id="${esc(a.r2FileId || a.driveId)}"><span class="asset-edit-name">${esc(a.name)}</span><button class="asset-edit-remove asset-delete-btn" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button></div>`).join('')}
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

    <div class="edit-section">
      <div class="edit-section-title">Tags</div>
      <div class="form-field">
        <div class="tag-input-wrap" id="ef-tag-wrap">
          ${(song.tags||[]).map(t=>`<span class="tag-chip" data-tag="${esc(t)}">${esc(t)}<span class="tag-chip-remove" role="button">\u00d7</span></span>`).join('')}
          <input class="tag-inline-input" id="ef-tag-input" placeholder="rock, ballad\u2026" type="text" autocomplete="off" />
          <div class="tag-suggest-dropdown hidden" id="ef-tag-suggest"></div>
        </div>
      </div>
    </div>

    <div class="edit-form-actions">
      <button class="btn-primary" id="ef-save">Save</button>
      ${!isNew ? `<button class="btn-danger" id="ef-delete">Delete</button>` : ''}
      <button class="btn-secondary" id="ef-cancel">Cancel</button>
    </div>
  `;
}

function _linkEditRowHTML(link) {
  const types = ['youtube','spotify','applemusic'];
  const opts  = types.map(t =>
    `<option value="${t}" ${link.type===t?'selected':''}>${t==='applemusic'?'Apple Music':t.charAt(0).toUpperCase()+t.slice(1)}</option>`
  ).join('');
  return `<div class="link-edit-row">
    <select class="link-platform-select form-input">${opts}</select>
    <input class="form-input link-url-input" type="url" value="${esc(link.url)}" placeholder="Paste full URL\u2026" />
    <button class="asset-delete-btn link-remove" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
  </div>`;
}

let _editDirtyTracker = null;

function _wireEditForm() {
  const song   = Store.get('editSong');
  const assets = song.assets;
  const editIsNew = Store.get('editIsNew');

  // Dirty tracking for unsaved changes confirmation
  _editDirtyTracker = createDirtyTracker();
  const editContainer = document.getElementById('edit-content');
  if (editContainer) trackFormInputs(editContainer, _editDirtyTracker);

  // Difficulty picker
  const diffPicker = document.getElementById('ef-difficulty');
  if (diffPicker) {
    diffPicker.querySelectorAll('.difficulty-picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.diff);
        song.difficulty = (song.difficulty === val) ? null : val;
        diffPicker.querySelectorAll('.difficulty-picker-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.diff) === song.difficulty));
        if (_editDirtyTracker) _editDirtyTracker.markDirty();
      });
    });
    const diffClear = document.getElementById('ef-diff-clear');
    if (diffClear) diffClear.addEventListener('click', () => {
      song.difficulty = null;
      diffPicker.querySelectorAll('.difficulty-picker-btn').forEach(b => b.classList.remove('active'));
      if (_editDirtyTracker) _editDirtyTracker.markDirty();
    });
  }

  // Duplicate detection on title input
  const titleInput = document.getElementById('ef-title');
  const dupWarning = document.getElementById('ef-duplicate-warning');
  let _dupTimer = null;
  titleInput.addEventListener('input', () => {
    clearTimeout(_dupTimer);
    _dupTimer = setTimeout(() => {
      const val = titleInput.value.trim();
      if (!val) { dupWarning.classList.add('hidden'); return; }
      const excludeId = editIsNew ? null : song.id;
      const similar = _findSimilarSongsSync(val, excludeId);
      if (similar.length > 0) {
        const names = similar.map(s => s.title).join(', ');
        dupWarning.textContent = 'Similar song found: ' + names + '. Is this a duplicate?';
        dupWarning.classList.remove('hidden');
      } else {
        dupWarning.classList.add('hidden');
      }
    }, 300);
  });

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
    chip.innerHTML   = `${esc(tag)}<span class="tag-chip-remove" role="button">\u00d7</span>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => removeTag(tag, chip));
    tagWrap.insertBefore(chip, tagInput);
  }
  function removeTag(tag, el) { song.tags=(song.tags||[]).filter(t=>t!==tag); el.remove(); }

  tagWrap.querySelectorAll('.tag-chip-remove').forEach(btn =>
    btn.addEventListener('click', () => removeTag(btn.parentElement.dataset.tag, btn.parentElement))
  );

  const tagSuggest = document.getElementById('ef-tag-suggest');
  function updateTagSuggestions() {
    const val = tagInput.value.trim().toLowerCase();
    if (!val) { tagSuggest.classList.add('hidden'); return; }
    const current = new Set(song.tags || []);
    const matches = allTags().filter(t => !current.has(t) && t.toLowerCase().includes(val));
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
      const existingIdx = song.chartOrder.findIndex(o => o.driveId === driveId);
      if (existingIdx !== -1) {
        song.chartOrder.splice(existingIdx, 1);
        song.chartOrder.sort((a, b) => a.order - b.order).forEach((o, i) => o.order = i + 1);
      } else {
        if (song.chartOrder.length >= 6) { showToast('Max 6 favorites per song'); return; }
        const maxOrder = song.chartOrder.reduce((m, o) => Math.max(m, o.order), 0);
        song.chartOrder.push({ driveId, order: maxOrder + 1 });
      }
      document.querySelectorAll('#ef-chart-list .chart-order-star').forEach(s => {
        const id = s.dataset.starChart;
        const num = _getChartOrderNum(song, id);
        s.classList.toggle('active', !!num);
        const icon = s.querySelector('i[data-lucide]');
        if (icon) icon.style.fill = num ? 'var(--accent)' : '';
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

  // Asset removes
  ['chart','audio'].forEach(type => {
    const assetKey = type === 'chart' ? 'charts' : 'audio';
    document.getElementById(`ef-${type}-list`).addEventListener('click', e => {
      const btn = e.target.closest('.asset-edit-remove, .asset-delete-btn');
      if (!btn) return;
      const row = btn.closest('.asset-edit-row');
      const name = row.querySelector('.asset-edit-name')?.textContent || 'this file';
      Admin.showConfirm('Remove Attachment', `Remove "${name}" from this song?`, async () => {
        const removedId = row.dataset.driveId;
        assets[assetKey] = assets[assetKey].filter(a => (a.driveId || a.r2FileId) !== removedId);
        if (type === 'chart' && song.chartOrder) {
          song.chartOrder = song.chartOrder.filter(o => o.driveId !== removedId && o.r2FileId !== removedId);
          song.chartOrder.sort((a, b) => a.order - b.order).forEach((o, i) => o.order = i + 1);
        }
        // Delete from R2 if it's an R2 file
        if (Sync.useCloudflare()) {
          try {
            const token = Auth.getToken ? Auth.getToken() : null;
            if (token) {
              await fetch(GitHub.workerUrl + '/files/' + encodeURIComponent(removedId), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
              });
            }
          } catch (_) { /* best-effort cleanup */ }
        }
        row.remove();
      });
    });
  });

  // Uploads
  function wireUpload(btnId, inputId, assetKey, listId) {
    document.getElementById(btnId).addEventListener('click', () => {
      if (!Sync.useCloudflare() && !Drive.isWriteConfigured()) {
        Admin.showDriveModal(() => {});
        showToast('Drive write access needed for file uploads.');
        return;
      }
      document.getElementById(inputId).click();
    });
    document.getElementById(inputId).addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      showToast('Uploading\u2026');
      const fileType = assetKey === 'audio' ? 'audio' : 'chart';
      for (const file of files) {
        try {
          let asset;
          if (Sync.useCloudflare()) {
            // Upload to R2 via Worker
            const token = Auth.getToken ? Auth.getToken() : null;
            if (!token) throw new Error('Not authenticated');
            const resp = await fetch(GitHub.workerUrl + '/files/upload', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': file.type || 'application/octet-stream',
                'X-Filename': file.name,
                'X-Song-Id': song.id,
                'X-File-Type': fileType,
              },
              body: file,
            });
            if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
            const result = await resp.json();
            asset = { r2FileId: result.fileId, name: file.name };
          } else {
            // Legacy: upload to Google Drive
            const result = await Drive.uploadFile(file);
            asset = { driveId: result.id, name: result.name };
          }
          assets[assetKey].push(asset);
          const assetId = asset.r2FileId || asset.driveId;
          const tmp = document.createElement('div');
          tmp.innerHTML = `<div class="asset-edit-row" data-drive-id="${esc(assetId)}"><span class="asset-edit-name">${esc(asset.name)}</span><button class="asset-edit-remove">\u00d7</button></div>`;
          document.getElementById(listId).appendChild(tmp.firstElementChild);
          // Trigger background audio conversion (fire-and-forget)
          if (assetKey === 'audio' && asset.r2FileId) {
            _triggerBackgroundConversion(asset.r2FileId, song.id, file.name);
          }
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

  // BPM auto-detect
  const bpmDetectBtn = document.getElementById('ef-bpm-detect');
  if (bpmDetectBtn) {
    bpmDetectBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const firstAudio = (assets.audio || [])[0];
      if (!firstAudio) { showToast('No audio file to analyze'); return; }
      bpmDetectBtn.disabled = true;
      bpmDetectBtn.innerHTML = '<i data-lucide="loader" style="width:11px;height:11px;" class="spin"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bpmDetectBtn] });
      try {
        const fileId = firstAudio.r2FileId || firstAudio.driveId;
        let blob;
        if (firstAudio.r2FileId && GitHub.workerUrl) {
          const token = Auth.getToken ? Auth.getToken() : null;
          const resp = await fetch(`${GitHub.workerUrl}/files/${fileId}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          });
          if (!resp.ok) throw new Error('Could not fetch audio');
          blob = await resp.blob();
        } else {
          blob = await Drive.downloadFile(fileId);
        }
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let result;
        try {
          const arrayBuf = await blob.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
          // Mix to mono
          const mono = new Float32Array(audioBuffer.length);
          for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
            const chData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < audioBuffer.length; i++) mono[i] += chData[i];
          }
          const channels = audioBuffer.numberOfChannels;
          if (channels > 1) for (let i = 0; i < mono.length; i++) mono[i] /= channels;

          // Use worker for BPM detection
          const worker = new Worker('./workers/bpm-detect-worker.js');
          result = await new Promise((resolve, reject) => {
            worker.onmessage = (ev) => {
              worker.terminate();
              if (ev.data.type === 'RESULT') resolve(ev.data);
              else reject(new Error(ev.data.error || 'Detection failed'));
            };
            worker.onerror = (err) => { worker.terminate(); reject(err); };
            worker.postMessage({ type: 'DETECT', samples: mono, sampleRate: audioBuffer.sampleRate });
          });
        } finally {
          audioCtx.close();
        }

        if (result.bpm > 0) {
          const bpmInput = document.getElementById('ef-bpm');
          bpmInput.value = result.bpm;
          bpmInput.dispatchEvent(new Event('input', { bubbles: true }));
          showToast(`Detected ${result.bpm} BPM (${Math.round(result.confidence * 100)}% confidence)`);
        } else {
          showToast('Could not detect BPM');
        }
      } catch (err) {
        showToast('BPM detect failed: ' + err.message);
      }
      bpmDetectBtn.disabled = false;
      bpmDetectBtn.innerHTML = '<i data-lucide="activity" style="width:11px;height:11px;"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bpmDetectBtn] });
    });
  }

  // Save
  document.getElementById('ef-save').addEventListener('click', async () => {
    if (Store.get('savingSongs')) return;
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

    // Required fields validation from orchestra settings
    const _reqFields = (() => { try { return JSON.parse(Sync.getOrchestraSetting('required_fields', '[]')); } catch { return []; } })();
    const _reqMap = { key: { el: 'ef-key', label: 'Key', val: song.key }, bpm: { el: 'ef-bpm', label: 'BPM', val: song.bpm }, timeSig: { el: 'ef-timesig', label: 'Time Signature', val: song.timeSig }, tags: { el: 'ef-tag-input', label: 'Tags', val: (song.tags || []).length > 0 } };
    for (const f of _reqFields) {
      const r = _reqMap[f];
      if (r && !r.val) { showToast(`${r.label} is required.`); document.getElementById(r.el)?.focus(); return; }
    }

    // Auto-favorite first chart if song had no charts before and now has one+
    if (assets.charts.length > 0 && (!song.chartOrder || song.chartOrder.length === 0)) {
      song.chartOrder = [{ driveId: assets.charts[0].driveId, order: 1 }];
    }

    async function _doSaveSong() {
      if (_editDirtyTracker) _editDirtyTracker.reset();
      Store.set('savingSongs', true);
      song._ts = Date.now();
      try {
        const songs = Store.get('songs');
        if (editIsNew) {
          songs.push(song);
        } else {
          const idx = songs.findIndex(s => s.id === song.id);
          if (idx > -1) songs[idx] = song;
        }
        Store.set('songs', songs);
        await Sync.saveSongs();
        Store.set('activeSong', null);
        // Quick-add mode: if enabled and this was a new song, reopen the add form
        if (editIsNew && Sync.getOrchestraSetting('quick_add_mode', 'false') === 'true') {
          renderEdit(Admin.newSong(Store.get('songs')), true);
          showToast('Song saved! Add another.');
        } else {
          renderList();
        }
      } finally {
        Store.set('savingSongs', false);
      }
    }

    const dupMode = Sync.getOrchestraSetting('duplicate_detection', 'warn');
    if (dupMode !== 'allow') {
      const similar = await _findSimilarSongsAsync(song.title, editIsNew ? null : song.id);
      if (similar.length > 0) {
        const names = similar.map(s => s.title).join(', ');
        if (dupMode === 'block') {
          showToast(`Duplicate blocked: "${names}" already exists.`);
          return;
        }
        // 'warn' — confirm dialog
        Admin.showConfirm(
          'Similar Song Exists',
          `A similar song already exists: "${names}". Save anyway?`,
          () => _doSaveSong(),
          'Save'
        );
        return;
      }
    }
    _doSaveSong();
  });

  // Cancel — confirm discard if form has unsaved changes
  document.getElementById('ef-cancel').addEventListener('click', () => {
    const go = () => {
      const activeSong = Store.get('activeSong');
      (editIsNew || !activeSong) ? renderList() : renderDetail(activeSong, true);
    };
    if (_editDirtyTracker) { _editDirtyTracker.confirmDiscard(go); }
    else { go(); }
  });

  // Delete
  document.getElementById('ef-delete')?.addEventListener('click', () => {
    Admin.showConfirm('Delete Song', `Permanently delete "${song.title||'this song'}"?`, async () => {
      if (GitHub.isConfigured()) GitHub.trackDeletion('songs', song.id);
      const songs = Store.get('songs');
      const updated = songs.filter(s => s.id !== song.id);
      Store.set('songs', updated);
      await Sync.saveSongs();
      Store.set('activeSong', null);
      renderList();
    });
  });
}

// ─── Embed ID extraction ────────────────────────────────────

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

// ─── Router registration ────────────────────────────────────

Router.register('list', safeRender('list', (route) => {
  if (route && route.rerender) {
    renderList(true);
    return;
  }
  renderList();
}));

Router.register('detail', safeRender('detail', (route) => {
  if (route && route.rerender) {
    const activeSong = Store.get('activeSong');
    if (activeSong) renderDetail(activeSong, true);
    return;
  }
  if (route && route.songId) {
    const songs = Store.get('songs');
    const s = songs.find(x => x.id === route.songId);
    if (s) renderDetail(s, true);
    else renderList();
  }
}));

// Register cleanup hook
Router.registerHook('cleanupSelection', () => {
  if (Store.get('selectionMode')) _exitSelectionMode();
});

// ─── Public API ─────────────────────────────────────────────

export {
  renderList,
  renderDetail,
  renderEdit,
  allTags,
  allKeys,
  filteredSongs,
  _exitSelectionMode as exitSelectionMode,
};
