/**
 * app.js — Main application logic
 */

const App = (() => {

  let _songs      = [];
  let _view       = 'list';
  let _activeSong = null;
  let _editSong   = null;
  let _editIsNew  = false;
  let _searchText = '';
  let _activeTag  = null;
  let _blobCache  = {};
  let _playerRefs = [];

  // ─── Utility ──────────────────────────────────────────────

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

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

  // ─── Data ──────────────────────────────────────────────────

  function _loadLocal() {
    try { return JSON.parse(localStorage.getItem('bb_songs') || '[]'); }
    catch { return []; }
  }

  function _saveLocal(songs) {
    localStorage.setItem('bb_songs', JSON.stringify(songs));
  }

  async function loadSongs() {
    if (Drive.isConfigured()) {
      try {
        const songs = await Drive.loadSongs();
        if (songs !== null) { _songs = songs; _saveLocal(songs); return; }
      } catch (e) {
        console.warn('Drive load failed, using local cache', e);
      }
    }
    _songs = _loadLocal();
  }

  async function saveSongs() {
    _saveLocal(_songs);
    if (Drive.isWriteConfigured()) {
      try {
        await Drive.saveSongs(_songs);
      } catch (e) {
        showToast('Saved locally. Drive sync failed.');
        return;
      }
    }
    showToast('Saved.');
  }

  // ─── View management ──────────────────────────────────────

  function _showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
    document.getElementById(`view-${name}`).scrollTop = 0;
    _view = name;
  }

  function _setTopbar(title, showBack) {
    document.getElementById('topbar-title').textContent = title;
    document.getElementById('btn-back').classList.toggle('hidden', !showBack);
    const addBtn = document.getElementById('btn-add-song');
    addBtn.classList.toggle('hidden', showBack || !Admin.isEditMode());
  }

  // ─── LIST VIEW ─────────────────────────────────────────────

  function _allTags() {
    const set = new Set();
    _songs.forEach(s => (s.tags || []).forEach(t => set.add(t)));
    return [...set].sort();
  }

  function _filteredSongs() {
    let list = [..._songs];
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
    _showView('list');
    _setTopbar('Catman Trio', false);

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
      container.appendChild(card);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function _songCardHTML(song) {
    const a = song.assets || {};
    const charts = (a.charts || []).length;
    const audio  = (a.audio  || []).length;
    const links  = (a.links  || []).length;

    const pills = [
      charts ? `<span class="asset-pill chart">${charts} chart${charts !== 1 ? 's' : ''}</span>` : '',
      audio  ? `<span class="asset-pill audio">${audio} demo${audio !== 1 ? 's' : ''}</span>`    : '',
      links  ? `<span class="asset-pill links">${links} link${links !== 1 ? 's' : ''}</span>`    : '',
    ].filter(Boolean).join('');

    const tagHtml = (song.tags || []).map(t => `<span class="song-tag">${esc(t)}</span>`).join('');
    const bpmHtml = song.bpm ? `<span class="song-card-bpm">${esc(String(song.bpm))} bpm</span>` : '';

    return `
      <span class="song-card-title">${esc(song.title) || '<em style="color:var(--text-3)">Untitled</em>'}</span>
      <span class="song-card-subtitle">${esc(song.subtitle)}</span>
      <div class="song-card-meta">
        <span class="song-card-key">${esc(song.key)}</span>
        ${bpmHtml}
      </div>
      <div class="song-card-footer">
        <div class="asset-pills">${pills}</div>
        <div class="song-tags">${tagHtml}</div>
      </div>`;
  }

  // ─── DETAIL VIEW ───────────────────────────────────────────

  function renderDetail(song) {
    _revokeBlobCache();
    Player.stopAll();
    _activeSong = song;
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

    // Audio players
    setTimeout(() => {
      container.querySelectorAll('[data-audio-container]').forEach(async el => {
        el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Loading…</p>`;
        try {
          el.innerHTML = '';
          const url = await _getBlobUrl(el.dataset.audioContainer);
          const ref = Player.create(el, { name: el.dataset.name, blobUrl: url });
          _playerRefs.push(ref);
        } catch {
          el.innerHTML = `<p class="muted" style="font-size:13px;padding:8px 0">Failed to load audio.</p>`;
        }
      });
    }, 0);
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
            <button class="file-item" data-open-chart="${esc(c.driveId)}" data-name="${esc(c.name)}">
              <div class="file-item-icon pdf">
                <i data-lucide="file-text"></i>
              </div>
              <span class="file-item-name">${esc(c.name)}</span>
              <i data-lucide="chevron-right" class="file-item-arrow"></i>
            </button>`).join('')}
        </div>
      </div>`;
    }

    if (audio.length) {
      html += `<div class="detail-section">
        <div class="detail-section-label">Demo Recordings</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${audio.map(a => `<div data-audio-container="${esc(a.driveId)}" data-name="${esc(a.name)}"></div>`).join('')}
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
        </div>
        <div class="form-field">
          <label class="form-label">Tags <span class="muted" style="font-weight:400">(Enter or comma)</span></label>
          <div class="tag-input-wrap" id="ef-tag-wrap">
            ${(song.tags||[]).map(t=>`<span class="tag-chip" data-tag="${esc(t)}">${esc(t)}<span class="tag-chip-remove" role="button">×</span></span>`).join('')}
            <input class="tag-inline-input" id="ef-tag-input" placeholder="rock, ballad…" type="text" autocomplete="off" />
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
    tagInput.addEventListener('keydown', e => {
      if (e.key==='Enter'||e.key===',') { e.preventDefault(); addTag(tagInput.value); tagInput.value=''; }
      else if (e.key==='Backspace'&&tagInput.value==='') {
        const chips=[...tagWrap.querySelectorAll('.tag-chip')];
        if (chips.length) removeTag(chips[chips.length-1].dataset.tag, chips[chips.length-1]);
      }
    });
    tagInput.addEventListener('blur', () => { if(tagInput.value.trim()){addTag(tagInput.value);tagInput.value='';} });
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
      _activeSong = song;
      renderDetail(song);
    });

    // Cancel
    document.getElementById('ef-cancel').addEventListener('click', () => {
      _editIsNew ? renderList() : renderDetail(_activeSong);
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

  function _isMobile() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Hide edit button entirely on mobile
    if (_isMobile()) {
      document.getElementById('btn-edit-mode').style.display = 'none';
    }

    document.getElementById('btn-back').addEventListener('click', () => {
      Player.stopAll();
      if (_view === 'detail') renderList();
      else if (_view === 'edit') _editIsNew ? renderList() : renderDetail(_activeSong);
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
      if (_isMobile()) return;
      if (Admin.isEditMode()) {
        Admin.exitEditMode();
        if (_view === 'list')        renderList();
        else if (_view === 'detail') renderDetail(_activeSong);
      } else {
        Admin.showPasswordModal(() => {
          Admin.enterEditMode();
          if (_view === 'list')        renderList();
          else if (_view === 'detail') renderDetail(_activeSong);
        });
      }
    });

    document.getElementById('btn-add-song').addEventListener('click', () => {
      if (_isMobile()) return;
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

    try { await loadSongs(); }
    catch (e) { console.error(e); showToast('Could not load songs.'); }

    renderList();
  }

  return { init, showToast, renderList, renderDetail, renderEdit };

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
