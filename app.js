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
      const timeout = setTimeout(() => resolve(null), 500);
      const handler = (e) => {
        if (e.data && e.data.type === 'CACHED_SONGS') {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', handler);
          resolve(e.data.songs);
        }
      };
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
      const { songs, setlists } = await Drive.loadAllData();
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
      const timeout = setTimeout(() => resolve(null), 500);
      const handler = (e) => {
        if (e.data && e.data.type === 'CACHED_SETLISTS') {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', handler);
          resolve(e.data.setlists);
        }
      };
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
      document.getElementById(`view-${name}`).classList.add('active');
      document.getElementById(`view-${name}`).scrollTop = 0;
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
    const addBtn = document.getElementById('btn-add-song');
    addBtn.classList.toggle('hidden', showBack || !Admin.isEditMode());
    document.getElementById('btn-setlists').classList.toggle('hidden', showBack);
  }

  function _pushNav(renderFn) {
    _navStack.push(renderFn);
  }

  function _navigateBack() {
    Player.stopAll();
    if (_navStack.length > 0) {
      const prev = _navStack.pop();
      prev();
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

    filtered.forEach(song => {
      const card = document.createElement('div');
      card.className  = 'song-card';
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
          ${(assets.charts||[]).map(c=>`<div class="asset-edit-row" data-drive-id="${esc(c.driveId)}"><span class="asset-edit-name">${esc(c.name)}</span><button class="asset-edit-remove">×</button></div>`).join('')}
        </div>
        <button class="btn-ghost" id="ef-add-chart">+ Add Chart PDF</button>
        <input type="file" id="ef-chart-file" accept=".pdf,application/pdf" style="display:none" multiple />
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Demo Recordings</div>
        <div class="asset-edit-list" id="ef-audio-list">
          ${(assets.audio||[]).map(a=>`<div class="asset-edit-row" data-drive-id="${esc(a.driveId)}"><span class="asset-edit-name">${esc(a.name)}</span><button class="asset-edit-remove">×</button></div>`).join('')}
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
      <button class="asset-edit-remove link-remove" aria-label="Remove">×</button>
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

    // Asset removes
    ['chart','audio'].forEach(type => {
      const assetKey = type === 'chart' ? 'charts' : 'audio';
      document.getElementById(`ef-${type}-list`).addEventListener('click', e => {
        const btn = e.target.closest('.asset-edit-remove');
        if (!btn) return;
        const row = btn.closest('.asset-edit-row');
        assets[assetKey] = assets[assetKey].filter(a => a.driveId !== row.dataset.driveId);
        row.remove();
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
      song.bpm      = parseInt(document.getElementById('ef-bpm').value) || '';
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
      _editIsNew ? renderList() : renderDetail(_activeSong, true);
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

  // ─── Platform detection ───────────────────────────────────

  function _isAdmin() {
    return localStorage.getItem('bb_admin') === 'catmandabomb';
  }

  // ─── SETLISTS LIST VIEW ──────────────────────────────────

  function renderSetlists(skipNavReset) {
    _revokeBlobCache();
    if (!skipNavReset) {
      _navStack = [];
      _pushNav(() => renderList());
    }
    _showView('setlists');
    _setTopbar('Setlists', true);

    const container = document.getElementById('setlists-list');
    const sorted = [..._setlists].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    let html = '';

    if (Admin.isEditMode()) {
      html += `<button class="btn-ghost setlist-add-btn" id="btn-new-setlist">+ New Setlist</button>`;
    }

    if (sorted.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>No setlists yet.</p>
        <p class="muted">${Admin.isEditMode() ? 'Create one above.' : 'Setlists will appear here.'}</p>
      </div>`;
    } else {
      sorted.forEach(sl => {
        const count = (sl.songs || []).length;
        const editBtn = Admin.isEditMode()
          ? `<button class="song-card-edit-btn setlist-edit-btn" data-edit-setlist="${esc(sl.id)}"><i data-lucide="pencil"></i></button>`
          : '';
        html += `
          <div class="setlist-card" data-setlist-id="${esc(sl.id)}">
            <div class="setlist-card-title-row">
              <span class="setlist-card-name">${esc(sl.name) || '<em style="color:var(--text-3)">Untitled</em>'}</span>
              ${editBtn}
            </div>
            <span class="setlist-card-count">${count} song${count !== 1 ? 's' : ''}</span>
          </div>`;
      });
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
              <button class="icon-btn sl-move-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}><i data-lucide="chevron-up"></i></button>
              <button class="icon-btn sl-move-down" data-idx="${i}" ${i === sl.songs.length - 1 ? 'disabled' : ''}><i data-lucide="chevron-down"></i></button>
              <button class="icon-btn sl-remove" data-idx="${i}" style="color:var(--red)"><i data-lucide="x"></i></button>
            </div>
          </div>`;
      }).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons();

      // Wire actions
      container.querySelectorAll('.sl-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          if (idx > 0) { [sl.songs[idx - 1], sl.songs[idx]] = [sl.songs[idx], sl.songs[idx - 1]]; _renderSelectedSongs(); _renderPicker(); }
        });
      });
      container.querySelectorAll('.sl-move-down').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          if (idx < sl.songs.length - 1) { [sl.songs[idx], sl.songs[idx + 1]] = [sl.songs[idx + 1], sl.songs[idx]]; _renderSelectedSongs(); _renderPicker(); }
        });
      });
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

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
    // Load display fonts dynamically (bypasses SW cache of old index.html)
    ['Audiowide', 'Oxanium:wght@600;700', 'Aldrich'].forEach(f => {
      if (!document.querySelector(`link[href*="${f.split(':')[0]}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${f}&display=swap`;
        document.head.appendChild(link);
      }
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Hide edit button unless admin token is set on this machine
    if (!_isAdmin()) {
      document.getElementById('btn-edit-mode').style.display = 'none';
    }

    document.getElementById('btn-back').addEventListener('click', () => {
      _navigateBack();
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
      if (!_isAdmin()) return;
      if (Admin.isEditMode()) {
        Admin.exitEditMode();
        if (_view === 'list')              renderList();
        else if (_view === 'detail')       renderDetail(_activeSong, true);
        else if (_view === 'edit')         { _activeSong = null; renderList(); }
        else if (_view === 'setlists')     renderSetlists(true);
        else if (_view === 'setlist-detail' && _activeSetlist) renderSetlistDetail(_activeSetlist, true);
        else if (_view === 'setlist-edit') renderSetlists();
      } else {
        Admin.showPasswordModal(() => {
          Admin.enterEditMode();
          if (_view === 'list')              renderList();
          else if (_view === 'detail')       renderDetail(_activeSong, true);
          else if (_view === 'setlists')     renderSetlists(true);
          else if (_view === 'setlist-detail' && _activeSetlist) renderSetlistDetail(_activeSetlist, true);
        });
      }
    });

    document.getElementById('btn-add-song').addEventListener('click', () => {
      if (!_isAdmin()) return;
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

    // Refresh button (force sync, bypass cooldown)
    document.getElementById('btn-refresh').addEventListener('click', () => {
      _syncAllFromDrive(true);
    });

    // Setlists button
    document.getElementById('btn-setlists').addEventListener('click', () => {
      renderSetlists();
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
    renderList();
    _syncAllFromDrive();
  }

  return { init, showToast, renderList, renderDetail, renderEdit, renderSetlists };

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
