/**
 * songs.js — Song list, detail, and edit views
 *
 * Extracted from app.js Phase 4d. IIFE module pattern.
 * All state via Store. Cross-module refs resolved at call time.
 */

const Songs = (() => {

  // ─── Utility aliases (loaded before us) ──────────────────────
  const esc             = Utils.esc;
  const deepClone       = Utils.deepClone;
  const highlight       = Utils.highlight;
  const haptic          = Utils.haptic;
  const showToast       = Utils.showToast;
  const _gradientText   = Utils.gradientText;
  const _getOrderedCharts = Utils.getOrderedCharts;
  const _getChartOrderNum = Utils.getChartOrderNum;
  const _isHybridKey    = Utils.isHybridKey;
  const _isIOS          = Utils.isIOS;

  // ─── Levenshtein worker (local to Songs) ────────────────────
  let _levWorker = null;
  try { _levWorker = new Worker('workers/levenshtein-worker.js'); } catch (_) {}

  function _findSimilarSongsAsync(title, excludeId) {
    return Utils.findSimilarSongsAsync(title, excludeId, Store.get('songs'), _levWorker);
  }
  function _findSimilarSongsSync(title, excludeId) {
    return Utils.findSimilarSongsSync(title, excludeId, Store.get('songs'));
  }

  // ─── Fingerprint state (local, not shared) ──────────────────
  let _lastListFingerprint = '';
  let _lastTagBarFP = '';
  let _lastKeyBarFP = '';

  // ─── Memoized filtering helpers ───────────────────────────
  // Invalidated when songs data changes (tracked by _songsTs)
  let _songsTs = 0;
  let _cachedSortedSongs = null;
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
    if (ts !== _songsTs) {
      _songsTs = ts;
      _cachedSortedSongs = null;
      _cachedAllTags = null;
      _cachedAllKeys = null;
    }
  }

  function _sortedSongs() {
    _invalidateCache();
    if (!_cachedSortedSongs) {
      _cachedSortedSongs = [...Store.get('songs')].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
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
      const counts = {};
      for (let i = 0; i < songs.length; i++) {
        const k = (songs[i].key || '').trim();
        if (k && !_isHybridKey(k)) counts[k] = (counts[k] || 0) + 1;
      }
      _cachedAllKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    }
    return _cachedAllKeys;
  }

  function filteredSongs() {
    const activeTags = Store.get('activeTags');
    const activeKeys = Store.get('activeKeys');
    const searchText = Store.get('searchText');

    let list = _sortedSongs();
    if (activeTags.length) list = list.filter(s => activeTags.every(t => (s.tags || []).includes(t)));
    if (activeKeys.length) list = list.filter(s => s.key && activeKeys.includes(s.key.trim()));
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
      (typeof Admin !== 'undefined' && Admin.isEditMode() ? '1' : '0') + '|' +
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
    if (addBtn) addBtn.classList.toggle('hidden', !Admin.isEditMode());

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
        `<button class="tag-filter-chip ${activeTags.includes(t) ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`
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
          `<button class="kf-chip ${activeKeys.includes(k) ? 'active' : ''}" data-key="${esc(k)}">${esc(k)}</button>`
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

    const scrollWrap = document.getElementById('song-list-scroll');
    const savedScroll = isDataRefresh && scrollWrap ? scrollWrap.scrollTop : 0;

    if (isDataRefresh) container.classList.add('no-animate');
    else container.classList.remove('no-animate');

    empty.classList.add('hidden');
    noResults.classList.add('hidden');

    if (songs.length === 0) {
      container.innerHTML = '';
      if (!GitHub.isConfigured() && !Drive.isConfigured()) {
        empty.innerHTML = '<p id="empty-title">Welcome to Catman Trio</p><p id="empty-sub" class="muted">Connect to GitHub to sync your songs and data.</p><button class="empty-action-btn" id="empty-setup-btn">Setup GitHub</button>';
        empty.classList.remove('hidden');
        empty.querySelector('#empty-setup-btn')?.addEventListener('click', () => Admin.showGitHubModal(() => { App.syncAll(true); }));
      } else {
        empty.innerHTML = '<p id="empty-title">No songs found</p><p id="empty-sub" class="muted">Try syncing to fetch your data.</p><button class="empty-action-btn" id="empty-sync-btn">Sync Now</button>';
        empty.classList.remove('hidden');
        empty.querySelector('#empty-sync-btn')?.addEventListener('click', () => { App.syncAll(true); });
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
      return (song._ts || 0) + '|' + (editMode ? '1' : '0') + '|' + (selectionMode ? '1' : '0') + '|' + (searchText || '');
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
      listFooter.classList.toggle('hidden', _preFiltered.length === 0);
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
            if (currentView === 'setlists') {
              const scroll = document.getElementById('setlists-list');
              if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              Setlists.renderSetlists();
            }
          } else if (target === 'practice') {
            if (currentView === 'practice') {
              const scroll = document.getElementById('practice-list');
              if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (typeof Practice !== 'undefined') {
              Practice.renderPractice();
            }
          } else if (target === 'dashboard') {
            if (Admin.isEditMode()) {
              Dashboard.renderDashboard();
            } else {
              Admin.showPasswordModal(() => {
                Admin.enterEditMode();
                Dashboard.renderDashboard();
              });
            }
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

    return `
      <div class="song-card-title-row"><span class="song-card-title">${highlight(song.title, q) || '<em style="color:var(--text-3)">Untitled</em>'}</span>${editIcon}</div>
      ${song.subtitle ? `<span class="song-card-subtitle">${highlight(song.subtitle, q)}</span>` : ''}
      <div class="song-card-meta">
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
    if (selectionMode) {
      card.addEventListener('click', () => {
        haptic.tap();
        _toggleSongSelection(song.id, card);
      });
    } else {
      card.addEventListener('click', () => {
        if (typeof Auth !== 'undefined' && !Auth.isLoggedIn()) { Utils.showToast('Log in to view song details'); return; }
        haptic.tap(); renderDetail(song);
      });
      // Long-press to enter selection mode — available to all authenticated users
      let lpTimer = null;
      card.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (typeof Auth !== 'undefined' && !Auth.isLoggedIn()) { Utils.showToast('Log in to select songs'); return; }
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
        selectedSongIds.forEach(function(songId) {
          if (!existingIds.has(songId)) {
            setlist.songs.push({ id: songId, comment: '' });
            added++;
          }
        });
        if (added === 0) {
          showToast('All songs already in ' + setlist.name);
        } else {
          Sync.saveSetlistsLocal(setlists);
          Sync.saveSetlists();
          haptic.success();
          showToast('Added ' + added + ' song' + (added !== 1 ? 's' : '') + ' to ' + setlist.name);
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
    if (typeof Practice !== 'undefined' && Practice.showBatchPracticeListPicker) {
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
    Router.showView('detail');
    Store.set('view', 'detail');
    Store.set('showViewCalled', true);
    Router.setTopbar(song.title || 'Song', true);

    const container = document.getElementById('detail-content');
    container.innerHTML = _buildDetailHTML(song);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Show volume slider only when song has audio files or streaming links
    const _a = song.assets || {};
    const hasAudio = (_a.audio || []).length > 0 || (_a.links || []).length > 0;
    if (typeof App !== 'undefined' && App.showVolume) App.showVolume(hasAudio);

    // Email verification gate: hide PDF charts and audio for unverified users
    // Owner is exempt, unverified non-owners see placeholder
    const _authUser = typeof Auth !== 'undefined' && Auth.getUser();
    const emailOk = !_authUser || _authUser.role === 'owner' || (typeof Auth !== 'undefined' && Auth.isEmailVerified());
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

    container.querySelector('.btn-add-to-setlist')?.addEventListener('click', () => {
      _showSetlistPicker(song);
    });

    // FEAT-26: Add to Practice List
    container.querySelector('.btn-add-to-practice-list')?.addEventListener('click', () => {
      if (typeof Practice !== 'undefined' && Practice.showPracticeListPicker) {
        Practice.showPracticeListPicker(song);
      } else {
        showToast('Practice module not loaded');
      }
    });

    // Pre-fetch all chart PDFs eagerly
    const chartDriveIds = (song.assets?.charts || []).map(c => c.driveId).filter(Boolean);
    chartDriveIds.forEach(id => {
      App.getBlobUrl(id).catch(() => {});
    });

    // Chart order star toggles (any logged-in user can favorite, max 6)
    const _canFavorite = Admin.isEditMode() || (typeof Auth !== 'undefined' && Auth.isLoggedIn());
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
          PDFViewer.open(url, btn.dataset.name);
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
        const url = _isIOS() ? Drive.getDirectUrl(driveId) : await App.getBlobUrl(driveId);
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
        <span class="setlist-pick-name">${esc(s.name)}</span>
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
          showToast('Already in ' + setlist.name);
          handle.hide();
          return;
        }

        if (!setlist.songs) setlist.songs = [];
        setlist.songs.push({ id: song.id, comment: '' });
        Sync.saveSetlistsLocal(setlists);
        Sync.saveSetlists();
        showToast('Added to ' + setlist.name);
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
        ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-song">Edit Song</button></div>` : ''}
        <div class="detail-title">${esc(song.title) || 'Untitled'}</div>
        ${song.subtitle ? `<div class="detail-subtitle">${esc(song.subtitle)}</div>` : ''}
        <div class="detail-meta-row">
          ${song.key ? `<div class="detail-meta-item"><span class="detail-meta-label">Key</span><span class="detail-meta-value">${esc(song.key)}</span></div>` : ''}
          ${song.bpm ? `<div class="detail-meta-item"><span class="detail-meta-label">BPM</span><span class="detail-meta-value">${esc(String(song.bpm))}</span></div>` : ''}
          ${song.timeSig ? `<div class="detail-meta-item"><span class="detail-meta-label">Time</span><span class="detail-meta-value">${esc(song.timeSig)}</span></div>` : ''}
        </div>
      </div>
      <div class="detail-quick-add">
        ${Admin.isEditMode() ? `<button class="btn-ghost btn-add-to-setlist detail-quick-add-btn">
          <i data-lucide="list-plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add to Setlist
        </button>` : `<button class="btn-ghost btn-add-to-practice-list detail-quick-add-btn">
          <i data-lucide="notebook-pen" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add to Practice List
        </button>`}
      </div>`;

    if (song.notes) {
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
            const orderNum = _getChartOrderNum(song, c.driveId);
            const _loggedIn = typeof Auth !== 'undefined' && Auth.isLoggedIn();
            const canStar = Admin.isEditMode() || _loggedIn;
            return `
            <div class="file-item-row">
              <button class="file-item" data-open-chart="${esc(c.driveId)}" data-name="${esc(c.name)}">
                <span class="chart-order-star${orderNum ? ' active' : ''}${canStar ? '' : ' readonly'}" data-star-chart="${esc(c.driveId)}" aria-label="Set chart order" title="Chart order for live mode">
                  <i data-lucide="star" style="width:16px;height:16px;${orderNum ? 'fill:var(--accent);' : ''}"></i>
                  ${orderNum ? `<span class="chart-order-num">${orderNum}</span>` : ''}
                </span>
                <div class="file-item-icon pdf">
                  <i data-lucide="file-text"></i>
                </div>
                <span class="file-item-name">${esc(c.name)}</span>
                <span class="pdf-cached-badge${_isPdfCached(c.driveId) ? ' cached' : ''}" data-cache-id="${esc(c.driveId)}" title="${_isPdfCached(c.driveId) ? 'Available offline' : 'Not cached'}">
                  <i data-lucide="${_isPdfCached(c.driveId) ? 'cloud-check' : 'cloud'}" style="width:14px;height:14px;"></i>
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
      html += `<div class="detail-section" id="detail-audio">
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
      html += `<div class="detail-section" id="detail-links">
        <div class="detail-section-label">Streaming & Links</div>
        <div class="embed-list">
          ${links.map(l => _buildEmbedHTML(l)).join('')}
        </div>
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
            <label class="form-label">BPM</label>
            <input class="form-input" id="ef-bpm" type="number" value="${esc(String(song.bpm||''))}" placeholder="120" min="1" max="999" />
          </div>
          <div class="form-field">
            <label class="form-label">Time</label>
            <input class="form-input" id="ef-timesig" type="text" value="${esc(song.timeSig||'')}" placeholder="4/4" />
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

  function _wireEditForm() {
    const song   = Store.get('editSong');
    const assets = song.assets;
    const editIsNew = Store.get('editIsNew');

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
        Admin.showConfirm('Remove Attachment', `Remove "${name}" from this song?`, () => {
          const removedId = row.dataset.driveId;
          assets[assetKey] = assets[assetKey].filter(a => a.driveId !== removedId);
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
        showToast('Uploading\u2026');
        for (const file of files) {
          try {
            const result = await Drive.uploadFile(file);
            const asset  = { driveId: result.id, name: result.name };
            assets[assetKey].push(asset);
            const tmp = document.createElement('div');
            tmp.innerHTML = `<div class="asset-edit-row" data-drive-id="${esc(asset.driveId)}"><span class="asset-edit-name">${esc(asset.name)}</span><button class="asset-edit-remove">\u00d7</button></div>`;
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

      // Auto-favorite first chart if song had no charts before and now has one+
      if (assets.charts.length > 0 && (!song.chartOrder || song.chartOrder.length === 0)) {
        song.chartOrder = [{ driveId: assets.charts[0].driveId, order: 1 }];
      }

      async function _doSaveSong() {
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
          renderList();
        } finally {
          Store.set('savingSongs', false);
        }
      }

      const similar = await _findSimilarSongsAsync(song.title, editIsNew ? null : song.id);
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
      const activeSong = Store.get('activeSong');
      (editIsNew || !activeSong) ? renderList() : renderDetail(activeSong, true);
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

  Router.register('list', Utils.safeRender('list', (route) => {
    if (route && route.rerender) {
      Songs.renderList(true);
      return;
    }
    Songs.renderList();
  }));

  Router.register('detail', Utils.safeRender('detail', (route) => {
    if (route && route.rerender) {
      const activeSong = Store.get('activeSong');
      if (activeSong) Songs.renderDetail(activeSong, true);
      return;
    }
    if (route && route.songId) {
      const songs = Store.get('songs');
      const s = songs.find(x => x.id === route.songId);
      if (s) Songs.renderDetail(s, true);
      else Songs.renderList();
    }
  }));

  // Register cleanup hook
  Router.registerHook('cleanupSelection', () => {
    if (Store.get('selectionMode')) _exitSelectionMode();
  });

  // ─── Public API ─────────────────────────────────────────────

  return {
    renderList,
    renderDetail,
    renderEdit,
    allTags,
    allKeys,
    filteredSongs,
    exitSelectionMode: _exitSelectionMode,
  };

})();
