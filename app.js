/**
 * app.js — Main application logic
 */

const App = (() => {

  let _songs      = [];
  let _setlists   = [];
  let _view       = 'list';
  let _activeSong = null;
  let _editSong   = null;
  let _editIsNew  = false;
  let _searchText = '';
  let _activeTag  = null;
  let _blobCache  = {};
  let _playerRefs = [];
  let _navStack   = [];
  let _activeSetlist = null;
  let _editSetlist   = null;
  let _editSetlistIsNew = false;

  // ─── Utility ──────────────────────────────────────────────

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

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

  // ─── Toast ─────────────────────────────────────────────────

  let _toastTimer = null;
  function showToast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 200);
    }, duration);
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
    const url = await Drive.fetchFileAsBlob(driveId);
    _blobCache[driveId] = url;
    return url;
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
      const url = await _getBlobUrl(driveId);
      if (_isIOS()) {
        window.open(url, '_blank');
        showToast('Tap and hold to save');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      btnEl.innerHTML = '<i data-lucide="check" class="dl-icon"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      setTimeout(() => {
        btnEl.innerHTML = '<i data-lucide="download" class="dl-icon"></i><span class="dl-spinner hidden"></span>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        btnEl.disabled = false;
      }, 1500);
    } catch (e) {
      btnEl.innerHTML = '<i data-lucide="x" class="dl-icon"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      showToast('Download failed');
      setTimeout(() => {
        btnEl.innerHTML = '<i data-lucide="download" class="dl-icon"></i><span class="dl-spinner hidden"></span>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        btnEl.disabled = false;
      }, 1500);
    }
  }

  // ─── Data ──────────────────────────────────────────────────

  function _loadLocal() {
    try { return JSON.parse(localStorage.getItem('bb_songs') || '[]'); }
    catch { return []; }
  }

  function _saveLocal(songs) {
    localStorage.setItem('bb_songs', JSON.stringify(songs));
    // Also push to service worker cache (separate, more resilient on iOS)
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
  const MANUAL_SYNC_COOLDOWN_MS = 10 * 1000; // 10 seconds per 2 clicks
  let _manualSyncHistory = []; // timestamps of recent manual syncs

  async function _syncAllFromDrive(force) {
    if (!Drive.isConfigured()) {
      _syncDone();
      return;
    }
    if (_syncing) return; // already syncing, ignore
    if (!force && !_shouldSync()) {
      _syncDone();
      return;
    }
    if (force) {
      const now = Date.now();
      // Keep only clicks within the cooldown window
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
      const { songs, setlists, practice } = await Drive.loadAllData();
      if (songs !== null) {
        const changed = JSON.stringify(songs) !== JSON.stringify(_songs);
        _songs = songs;
        _saveLocal(songs);
        if (changed && _view === 'list') renderList();
      }
      if (setlists !== null) {
        _setlists = setlists;
        _saveSetlistsLocal(setlists);
      }
      if (practice !== null) {
        _practice = practice;
        _savePracticeLocal(practice);
      }
      _markSynced();
    } catch (e) {
      console.warn('Drive sync failed, using local cache', e);
      const msg = String(e.message || e || '');
      if (msg.includes('403') || msg.includes('429')) {
        showToast('Drive is temporarily rate-limited. Using cached data — try again in a few minutes.', 4000);
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

  async function saveSongs() {
    _saveLocal(_songs);
    if (Drive.isWriteConfigured()) {
      try {
        await Drive.saveSongs(_songs);
        _markSynced();
      } catch (e) {
        showToast('Saved locally. Drive sync failed.');
        return;
      }
    }
    showToast('Saved.');
  }

  // ─── Setlists data ─────────────────────────────────────

  function _loadSetlistsLocal() {
    try { return JSON.parse(localStorage.getItem('bb_setlists') || '[]'); }
    catch { return []; }
  }

  function _saveSetlistsLocal(setlists) {
    localStorage.setItem('bb_setlists', JSON.stringify(setlists));
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

  async function saveSetlists() {
    _saveSetlistsLocal(_setlists);
    if (Drive.isWriteConfigured()) {
      try {
        await Drive.saveSetlists(_setlists);
        _markSynced();
      } catch (e) {
        showToast('Saved locally. Drive sync failed.');
        return;
      }
    }
    showToast('Setlist saved.');
  }

  // ─── View management & nav stack ─────────────────────────

  function _showView(name) {
    const swap = () => {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const el = document.getElementById(`view-${name}`);
      if (el) { el.classList.add('active'); el.scrollTop = 0; }
      _view = name;
    };
    if (document.startViewTransition) {
      try { document.startViewTransition(swap); } catch (_) { swap(); }
    } else {
      swap();
    }
  }

  function _setTopbar(title, showBack, isHtml) {
    const el = document.getElementById('topbar-title');
    if (isHtml) el.innerHTML = title;
    else el.textContent = title;
    document.getElementById('btn-back').classList.toggle('hidden', !showBack);
    document.getElementById('btn-setlists').classList.toggle('hidden', showBack);
    document.getElementById('btn-practice').classList.toggle('hidden', showBack);
  }

  function _pushNav(renderFn) {
    _navStack.push(renderFn);
  }

  function _navigateBack() {
    Player.stopAll();
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

  function _filteredSongs() {
    let list = [..._songs].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (_activeTag) list = list.filter(s => (s.tags || []).includes(_activeTag));
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
    _navStack = [];
    _showView('list');
    _setTopbar(_gradientText('Catman Trio', [215,175,90], [240,220,165]), false, true);
    // Sync admin bar button state
    const addBtn = document.getElementById('btn-add-song');
    if (addBtn) addBtn.classList.toggle('hidden', !Admin.isEditMode());

    const tagBar = document.getElementById('tag-filter-bar');
    tagBar.innerHTML = _allTags().map(t =>
      `<button class="tag-filter-chip ${_activeTag === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`
    ).join('');
    tagBar.querySelectorAll('.tag-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTag = _activeTag === btn.dataset.tag ? null : btn.dataset.tag;
        renderList();
      });
    });

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
      card.className  = 'song-card';
      card.style.animationDelay = `${i * 30}ms`;
      card.innerHTML  = _songCardHTML(song);
      card.addEventListener('click', () => renderDetail(song));
      if (Admin.isEditMode()) {
        card.querySelector('.song-card-edit-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          renderEdit(song, false);
        });
      }
      container.appendChild(card);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (Admin.isEditMode()) {
      container.querySelector('.btn-edit-song')?.addEventListener('click', () => renderEdit(song, false));
    } else {
      container.querySelector('.detail-edit-bar')?.remove();
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
          const url = await _getBlobUrl(el.dataset.audioContainer);
          el.innerHTML = '';
          const ref = Player.create(el, { name: el.dataset.name, blobUrl: url });
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
          ${charts.map(c => `
            <div class="file-item-row">
              <button class="file-item" data-open-chart="${esc(c.driveId)}" data-name="${esc(c.name)}">
                <div class="file-item-icon pdf">
                  <i data-lucide="file-text"></i>
                </div>
                <span class="file-item-name">${esc(c.name)}</span>
                <i data-lucide="chevron-right" class="file-item-arrow"></i>
              </button>
              <button class="dl-btn" data-dl-id="${esc(c.driveId)}" data-dl-name="${esc(c.name)}" aria-label="Download">
                <i data-lucide="download" class="dl-icon"></i>
                <span class="dl-spinner hidden"></span>
              </button>
            </div>`).join('')}
        </div>
      </div>`;
    }

    if (audio.length) {
      html += `<div class="detail-section">
        <div class="detail-section-label">Demo Recordings</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${audio.map(a => `
            <div class="audio-row">
              <div class="audio-row-player" data-audio-container="${esc(a.driveId)}" data-name="${esc(a.name)}"></div>
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
    document.getElementById('edit-content').innerHTML = _buildEditHTML(_editSong);
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
          ${(assets.charts||[]).map(c=>`<div class="asset-edit-row" data-drive-id="${esc(c.driveId)}"><span class="asset-edit-name">${esc(c.name)}</span><button class="asset-edit-remove asset-delete-btn" aria-label="Remove"><i data-lucide="x" style="width:12px;height:12px;"></i></button></div>`).join('')}
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

    // Asset removes (with confirm)
    ['chart','audio'].forEach(type => {
      const assetKey = type === 'chart' ? 'charts' : 'audio';
      document.getElementById(`ef-${type}-list`).addEventListener('click', e => {
        const btn = e.target.closest('.asset-edit-remove, .asset-delete-btn');
        if (!btn) return;
        const row = btn.closest('.asset-edit-row');
        const name = row.querySelector('.asset-edit-name')?.textContent || 'this file';
        Admin.showConfirm('Remove Attachment', `Remove "${name}" from this song?`, () => {
          assets[assetKey] = assets[assetKey].filter(a => a.driveId !== row.dataset.driveId);
          row.remove();
        });
      });
    });

    // Uploads
    function wireUpload(btnId, inputId, assetKey, listId) {
      document.getElementById(btnId).addEventListener('click', () => {
        if (!Drive.isWriteConfigured()) {
          Admin.showDriveModal(() => {});
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

      if (_editIsNew) {
        _songs.push(song);
      } else {
        const idx = _songs.findIndex(s => s.id === song.id);
        if (idx > -1) _songs[idx] = song;
      }
      await saveSongs();
      _activeSong = null;
      renderList();
    });

    // Cancel
    document.getElementById('ef-cancel').addEventListener('click', () => {
      (_editIsNew || !_activeSong) ? renderList() : renderDetail(_activeSong, true);
    });

    // Delete
    document.getElementById('ef-delete')?.addEventListener('click', () => {
      Admin.showConfirm('Delete Song', `Permanently delete "${song.title||'this song'}"?`, async () => {
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

    let html = '';

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
    if (typeof lucide !== 'undefined') lucide.createIcons();

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
      if (!Drive.isWriteConfigured()) {
        Admin.showDriveModal(() => {});
        showToast('Configure Drive, then try again.');
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
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-setlist">Edit Setlist</button></div>` : ''}
      <div class="detail-title">${esc(setlist.name) || 'Untitled Setlist'}</div>
      <div class="detail-subtitle">${songs.length} song${songs.length !== 1 ? 's' : ''}</div>
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
    if (typeof lucide !== 'undefined') lucide.createIcons();

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
    if (!Admin.isEditMode()) {
      container.querySelector('.detail-edit-bar')?.remove();
    }
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
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
      if (typeof lucide !== 'undefined') lucide.createIcons();

      // Init SortableJS (destroy previous instance first)
      if (_sortableSetlist) { try { _sortableSetlist.destroy(); } catch(_){} _sortableSetlist = null; }
      if (typeof Sortable !== 'undefined' && sl.songs.length > 1) {
        _sortableSetlist = Sortable.create(container, {
          handle: '.drag-handle',
          animation: 150,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onEnd: (evt) => {
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
          sl.songs.splice(parseInt(btn.dataset.idx), 1);
          _renderSelectedSongs();
          _renderPicker();
        });
      });
      container.querySelectorAll('.setlist-comment-input').forEach(input => {
        input.addEventListener('input', () => {
          const idx = parseInt(input.dataset.commentIdx);
          sl.songs[idx].comment = input.value;
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
      sl.name = document.getElementById('slf-name').value.trim();
      if (!sl.name) { showToast('Name is required.'); document.getElementById('slf-name').focus(); return; }
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
    });

    // Cancel
    document.getElementById('slf-cancel').addEventListener('click', () => {
      _navigateBack();
    });

    // Delete
    document.getElementById('slf-delete')?.addEventListener('click', () => {
      Admin.showConfirm('Delete Setlist', `Permanently delete "${sl.name || 'this setlist'}"?`, async () => {
        _setlists = _setlists.filter(s => s.id !== sl.id);
        await saveSetlists();
        _activeSetlist = null;
        renderSetlists();
      });
    });
  }

  // ─── PRACTICE LISTS — Data ─────────────────────────────────

  let _practice = [];   // Array of persona objects
  let _activePersona = null;
  let _editPersona = null;
  let _editPersonaIsNew = false;

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
    try { return JSON.parse(localStorage.getItem('bb_practice') || '[]'); }
    catch { return []; }
  }

  function _savePracticeLocal(data) {
    localStorage.setItem('bb_practice', JSON.stringify(data));
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

  async function savePractice() {
    _savePracticeLocal(_practice);
    if (Drive.isWriteConfigured()) {
      try { await Drive.savePractice(_practice); } catch (e) {
        showToast('Saved locally. Drive sync failed.');
        return;
      }
    }
    showToast('Practice list saved.');
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
    let html = '';

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
        const count = (p.lists || []).length;
        const editBtn = Admin.isEditMode()
          ? `<button class="song-card-edit-btn persona-edit-btn" data-edit-persona="${esc(p.id)}"><i data-lucide="pencil"></i></button>`
          : '';
        html += `
          <div class="persona-card" data-persona-id="${esc(p.id)}">
            <div class="persona-avatar" style="background:${color}">${_personaInitials(p.name)}</div>
            <div class="persona-card-info">
              <div class="persona-card-title-row">
                <span class="persona-card-name">${esc(p.name)}</span>
                ${editBtn}
              </div>
              <span class="persona-card-count">${count} song${count !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
      });
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    container.querySelectorAll('.persona-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.persona-edit-btn')) return;
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

    document.getElementById('btn-new-persona')?.addEventListener('click', () => {
      const newP = {
        id: Admin.generateId(_practice),
        name: '',
        color: '',
        lists: [],
      };
      renderPracticeEdit(newP, true);
    });
  }

  // ─── PRACTICE — Detail View ───────────────────────────────

  function renderPracticeDetail(persona, skipNavPush) {
    _revokeBlobCache();
    Player.stopAll();
    _activePersona = persona;
    if (!skipNavPush) _pushNav(() => renderPractice());
    _showView('practice-detail');
    _setTopbar(persona.name || 'Practice List', true);

    const container = document.getElementById('practice-detail-content');
    const lists = persona.lists || [];
    const color = _safeColor(persona.color || _hslFromName(persona.name));

    let html = `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-persona">Edit Practice List</button></div>` : ''}
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
        <div class="persona-avatar persona-avatar-lg" style="background:${color}">${_personaInitials(persona.name)}</div>
        <div class="detail-title" style="margin-bottom:0">${esc(persona.name) || 'Unnamed'}</div>
      </div>
      <div class="detail-subtitle">${lists.length} song${lists.length !== 1 ? 's' : ''} in practice list</div>
    </div>`;

    // Add song button (visible on ALL platforms, not edit-mode restricted)
    html += `<button class="btn-ghost" id="btn-add-practice-song" style="width:100%;text-align:center;margin-bottom:16px;">
      <i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add Song to Practice
    </button>`;

    // Practice mode button
    if (lists.length > 0) {
      html += `<button class="btn-primary practice-enter-btn" id="btn-enter-practice-mode" style="width:100%;margin-bottom:20px;">
        <i data-lucide="play" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Enter Practice Mode
      </button>`;
    }

    if (lists.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No songs yet.</p>
        <p class="muted">Add songs from the song list.</p>
      </div>`;
    } else {
      html += `<div class="practice-song-list">`;
      lists.forEach((entry, i) => {
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

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Wire song clicks
    container.querySelectorAll('.setlist-song-row').forEach(row => {
      row.addEventListener('click', () => {
        const song = _songs.find(s => s.id === row.dataset.songId);
        if (song) {
          _pushNav(() => renderPracticeDetail(persona));
          renderDetail(song, true);
        }
      });
    });

    // Wire edit button
    container.querySelector('.btn-edit-persona')?.addEventListener('click', () => {
      renderPracticeEdit(persona, false);
    });
    if (!Admin.isEditMode()) {
      container.querySelector('.detail-edit-bar')?.remove();
    }

    // Wire add song button — shows picker
    document.getElementById('btn-add-practice-song')?.addEventListener('click', () => {
      _showPracticeSongPicker(persona);
    });

    // Wire practice mode
    document.getElementById('btn-enter-practice-mode')?.addEventListener('click', () => {
      _enterPracticeMode(persona);
    });
  }

  function _showPracticeSongPicker(persona) {

    const container = document.getElementById('practice-detail-content');
    let pickerHtml = `<div class="edit-section" id="practice-picker-section">
      <div class="edit-section-title">Add Song to Practice</div>
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
      const existingIds = new Set((persona.lists || []).map(e => e.songId));
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
          persona.lists = persona.lists || [];
          persona.lists.push({ songId: btn.dataset.pickId, comment: '', addedAt: new Date().toISOString() });
          const idx = _practice.findIndex(p => p.id === persona.id);
          if (idx > -1) _practice[idx] = persona;
          await savePractice();
          document.getElementById('practice-picker-section')?.remove();
          renderPracticeDetail(persona, true);
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

  // ─── PRACTICE — Edit View ─────────────────────────────────

  function renderPracticeEdit(persona, isNew) {
    _revokeBlobCache();
    Player.stopAll();
    _editPersona = deepClone(persona);
    _editPersonaIsNew = isNew;
    if (!_editPersona.lists) _editPersona.lists = [];

    if (isNew) {
      _pushNav(() => renderPractice());
    } else {
      _pushNav(() => renderPracticeDetail(persona));
    }
    _showView('practice-edit');
    _setTopbar(isNew ? 'New Persona' : 'Edit Practice List', true);

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

      <div class="edit-section">
        <div class="edit-section-title">Songs in Practice List</div>
        <div id="pf-selected-songs" class="setlist-edit-selected"></div>
        <div class="setlist-empty-msg ${p.lists.length ? 'hidden' : ''}" id="pf-empty-msg">No songs yet. Add songs from the detail view.</div>
      </div>

      <div class="edit-form-actions">
        <button class="btn-primary" id="pf-save">Save</button>
        <button class="btn-secondary" id="pf-cancel">Cancel</button>
      </div>

      ${!isNew ? `<div class="delete-zone"><button class="btn-danger" id="pf-delete">Delete Persona</button></div>` : ''}
    `;

    container.innerHTML = html;

    let _sortablePractice = null;
    function _renderPracticeSongs() {
      const songContainer = document.getElementById('pf-selected-songs');
      document.getElementById('pf-empty-msg')?.classList.toggle('hidden', p.lists.length > 0);

      songContainer.innerHTML = p.lists.map((entry, i) => {
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
      if (typeof lucide !== 'undefined') lucide.createIcons();

      // SortableJS for practice list
      if (_sortablePractice) { try { _sortablePractice.destroy(); } catch(_){} _sortablePractice = null; }
      if (typeof Sortable !== 'undefined' && p.lists.length > 1) {
        _sortablePractice = Sortable.create(songContainer, {
          handle: '.drag-handle',
          animation: 150,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onEnd: (evt) => {
            const moved = p.lists.splice(evt.oldIndex, 1)[0];
            p.lists.splice(evt.newIndex, 0, moved);
            _renderPracticeSongs();
          }
        });
      }

      songContainer.querySelectorAll('.sl-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          p.lists.splice(parseInt(btn.dataset.idx), 1);
          _renderPracticeSongs();
        });
      });
      songContainer.querySelectorAll('.practice-comment-input').forEach(input => {
        input.addEventListener('input', () => {
          p.lists[parseInt(input.dataset.commentIdx)].comment = input.value;
        });
      });
    }

    _renderPracticeSongs();

    // Save
    document.getElementById('pf-save').addEventListener('click', async () => {
      p.name = document.getElementById('pf-name').value.trim();
      if (!p.name) { showToast('Name is required.'); document.getElementById('pf-name').focus(); return; }
      p.color = p.color || _hslFromName(p.name);
      if (_editPersonaIsNew) {
        _practice.push(p);
      } else {
        const idx = _practice.findIndex(x => x.id === p.id);
        if (idx > -1) _practice[idx] = p;
      }
      await savePractice();
      _activePersona = null;
      renderPractice();
    });

    document.getElementById('pf-cancel').addEventListener('click', () => _navigateBack());

    document.getElementById('pf-delete')?.addEventListener('click', () => {
      Admin.showConfirm('Delete Persona', `Permanently delete "${p.name || 'this persona'}" and their practice list?`, async () => {
        _practice = _practice.filter(x => x.id !== p.id);
        await savePractice();
        _activePersona = null;
        renderPractice();
      });
    });
  }

  // ─── PRACTICE MODE ────────────────────────────────────────

  let _practicePersona = null;

  function _enterPracticeMode(persona) {
    _practicePersona = persona;
    _revokeBlobCache();
    Player.stopAll();
    _pushNav(() => renderPracticeDetail(persona));
    _showView('practice-detail');
    document.body.classList.add('practice-mode-active');
    _setTopbar('Practice Mode', true);

    const container = document.getElementById('practice-detail-content');
    const lists = persona.lists || [];

    let html = `<div class="practice-mode-header">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div class="persona-avatar" style="background:${_safeColor(persona.color || _hslFromName(persona.name))}">${_personaInitials(persona.name)}</div>
        <div>
          <div class="detail-title" style="font-size:22px;margin-bottom:0">${esc(persona.name)}</div>
          <div class="muted" style="font-size:12px">${lists.length} songs</div>
        </div>
      </div>
      <button class="btn-secondary" id="btn-exit-practice-mode" style="width:100%;margin-bottom:16px;">Exit Practice Mode</button>
    </div>`;

    html += `<div class="practice-accordion">`;
    lists.forEach((entry, i) => {
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
            <i data-lucide="chevron-down" class="accordion-chevron" style="width:16px;height:16px;flex-shrink:0;transition:transform 0.2s;"></i>
          </div>
          <div class="practice-accordion-body hidden">
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
                ${(a.audio || []).map(au => `<div data-audio-container="${esc(au.driveId)}" data-name="${esc(au.name)}"></div>`).join('')}
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
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Wire accordion
    container.querySelectorAll('.practice-accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.practice-accordion-item');
        const body = item.querySelector('.practice-accordion-body');
        const chevron = header.querySelector('.accordion-chevron, svg');
        const isOpen = !body.classList.contains('hidden');
        body.classList.toggle('hidden');
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';

        // Load audio players when expanding
        if (!isOpen) {
          body.querySelectorAll('[data-audio-container]').forEach(async el => {
            if (el.dataset.loaded) return;
            el.dataset.loaded = 'true';
            el.innerHTML = `<div class="audio-player audio-skeleton">
              <div class="skeleton-text" style="width:40%;height:13px"></div>
              <div class="audio-controls"><div class="skeleton-circle"></div><div class="audio-progress-wrap"><div class="skeleton-bar"></div></div></div>
            </div>`;
            try {
              const url = await _getBlobUrl(el.dataset.audioContainer);
              el.innerHTML = '';
              const ref = Player.create(el, { name: el.dataset.name, blobUrl: url });
              _playerRefs.push(ref);
            } catch { el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`; }
          });

          // Wire chart buttons in this body
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
    document.getElementById('topbar').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');

    const gate = document.createElement('div');
    gate.id = 'install-gate';
    gate.innerHTML = `
      <div class="install-gate-content">
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
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }

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
    if (typeof lucide !== 'undefined') lucide.createIcons();

    document.getElementById('btn-back').addEventListener('click', () => {
      _navigateBack();
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
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
        });
      }
    });

    document.getElementById('btn-add-song').addEventListener('click', () => {
      if (!Admin.isEditMode()) return;
      if (!Drive.isWriteConfigured()) {
        Admin.showDriveModal(() => {});
        showToast('Configure Drive, then try again.');
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

    // Request persistent storage (prevents iOS/Android from evicting cache)
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // Refresh button — full hard refresh: clear SW cache + reload for fresh source + data
    document.getElementById('btn-refresh').addEventListener('click', async () => {
      showToast('Refreshing app…');
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
      // Hard reload — bypasses any remaining cache
      location.reload();
    });

    // Setlists button
    document.getElementById('btn-setlists').addEventListener('click', () => {
      renderSetlists();
    });

    // Practice button
    document.getElementById('btn-practice').addEventListener('click', () => {
      renderPractice();
    });

    // Master volume slider (hidden on iOS — audio.volume is read-only there)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const volWrap   = document.getElementById('master-volume');
    const volSlider = document.getElementById('volume-slider');
    if (isIOS) {
      volWrap.style.display = 'none';
    } else {
      volSlider.value = Player.getVolume();
      function _updateVolIcon() {
        const v = parseFloat(volSlider.value);
        const name = v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2';
        // Lucide replaces <i> with <svg>, so we must swap the element each time
        const oldIcon = volWrap.querySelector('[data-lucide]') || volWrap.querySelector('svg');
        const newIcon = document.createElement('i');
        newIcon.setAttribute('data-lucide', name);
        newIcon.style.cssText = 'width:14px;height:14px;opacity:0.6;flex-shrink:0;';
        if (oldIcon) oldIcon.replaceWith(newIcon);
        if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', nodes: [volWrap] });
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
    renderList();
    _syncAllFromDrive();
  }

  return { init, showToast, renderList, renderDetail, renderEdit, renderSetlists, renderPractice, renderPracticeDetail };

})();

document.addEventListener('DOMContentLoaded', () => {
  if (Drive.isWriteConfigured() && !document.getElementById('gis-script')) {
    const s = document.createElement('script');
    s.id    = 'gis-script';
    s.src   = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }
  App.init();
});
