/**
 * setlists.js — Setlist list, detail, edit, and live mode views
 *
 * Extracted from app.js. All state flows through Store; persistence
 * via Sync.saveSetlists(). Navigation via Router helpers.
 */

const Setlists = (() => {

  // ─── Utility aliases ──────────────────────────────────────────
  const esc             = Utils.esc;
  const showToast       = Utils.showToast;
  const haptic          = Utils.haptic;
  const deepClone       = Utils.deepClone;
  const _formatDuration = Utils.formatDuration;
  const _fallbackCopy   = Utils.fallbackCopy;
  const _getOrderedCharts = Utils.getOrderedCharts;
  const _getChartOrderNum = Utils.getChartOrderNum;

  // ─── Local state (synced to/from Store) ───────────────────────
  let _setlists          = [];
  let _activeSetlist     = null;
  let _editSetlist       = null;
  let _editSetlistIsNew  = false;
  let _savingSetlists    = false;
  let _showArchived      = false;
  let _liveModeActive    = false;
  let _exitLiveModeRef   = null;
  let _sortableSetlist   = null;

  // ─── State helpers ────────────────────────────────────────────

  function _syncFromStore() {
    _setlists = Store.get('setlists');
  }

  function _syncToStore() {
    Store.set('setlists', _setlists);
  }

  async function _saveSetlists(toastMsg) {
    _syncToStore();
    return Sync.saveSetlists(toastMsg);
  }

  function _saveSetlistsLocal() {
    Sync.saveSetlistsLocal(_setlists);
  }

  // ─── Navigation helpers (delegate to Router / App) ────────────

  function _showView(name) {
    Router.showView(name);
  }

  function _setTopbar(title, showBack) {
    Router.setTopbar(title, showBack);
  }

  function _pushNav(fn) {
    Router.pushNav(fn);
  }

  function _navigateBack() {
    Router.navigateBack();
  }

  function _setRouteParams(p) {
    Store.set('currentRouteParams', p);
  }

  function _revokeBlobCache() {
    if (typeof App !== 'undefined' && App.revokeBlobCache) App.revokeBlobCache();
  }

  function _getBlobUrl(driveId) {
    return App.getBlobUrl(driveId);
  }

  function _doSyncRefresh(afterCallback) {
    return Sync.doSyncRefresh(afterCallback).then(() => {
      _syncFromStore();
    });
  }

  // ─── SETLIST SONG PICKER (from song detail / batch) ───────────

  /**
   * Show a modal picker to add a single song to a setlist.
   * Called from the song detail view's "Add to Setlist" button.
   */
  function showSetlistPicker(song) {
    if (!Admin.isEditMode()) return;
    _syncFromStore();
    const available = _setlists.filter(s => !s.archived);
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
        _saveSetlistsLocal();
        _saveSetlists();
        showToast('Added to ' + setlist.name);
        handle.hide();
      });
    });
  }

  /**
   * Batch-add selected songs to a setlist.
   * Called from the batch selection bar in song list view.
   */
  function batchAddToSetlist() {
    if (!Admin.isEditMode()) return;
    const selectedSongIds = Store.get('selectedSongIds');
    if (!selectedSongIds || selectedSongIds.size === 0) { showToast('No songs selected'); return; }
    _syncFromStore();
    var available = _setlists.filter(function(s) { return !s.archived; });
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
          _saveSetlistsLocal();
          _saveSetlists();
          haptic.success();
          showToast('Added ' + added + ' song' + (added !== 1 ? 's' : '') + ' to ' + setlist.name);
        }
        overlay.remove();
        // Exit selection mode — call back into App
        if (typeof App !== 'undefined' && App._exitSelectionMode) {
          App._exitSelectionMode();
        }
      });
    });
  }

  // ─── SETLISTS LIST VIEW ──────────────────────────────────────

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
    if (changed) _saveSetlistsLocal();
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
    _setRouteParams({});
    _syncFromStore();
    if (!skipNavReset) {
      Store.set('navStack', []);
      _pushNav(() => App.renderList());
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
          _saveSetlistsLocal();
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

  // ─── SETLIST DETAIL VIEW ─────────────────────────────────────

  function _buildSetlistTimingHTML(songEntries) {
    if (!songEntries || songEntries.length === 0) return '';
    const songs = Store.get('songs');
    let totalSecs = 0;
    let missingCount = 0;
    songEntries.forEach(entry => {
      const s = songs.find(x => x.id === entry.id);
      if (s && s.duration && s.duration > 0) {
        totalSecs += s.duration;
      } else if (s) {
        missingCount++;
      }
    });
    if (totalSecs === 0 && missingCount === 0) return '';
    let timeStr;
    if (totalSecs >= 3600) {
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      timeStr = h + 'h ' + m + 'm';
    } else {
      const m = Math.floor(totalSecs / 60);
      const s = Math.floor(totalSecs % 60);
      timeStr = m + ':' + String(s).padStart(2, '0');
    }
    let html = '<div style="color:var(--text-2);font-size:0.85rem;margin-top:4px;">';
    html += 'Total: ' + (totalSecs > 0 ? timeStr : '?');
    if (missingCount > 0) {
      html += ' <span class="muted">(' + missingCount + ' song' + (missingCount !== 1 ? 's' : '') + ' missing duration)</span>';
    }
    html += '</div>';
    return html;
  }

  function renderSetlistDetail(setlist, skipNavPush) {
    _revokeBlobCache();
    Player.stopAll();
    _activeSetlist = setlist;
    Store.set('activeSetlist', setlist);
    _setRouteParams({ setlistId: setlist.id });
    if (!skipNavPush) _pushNav(() => renderSetlists());
    _showView('setlist-detail');
    _setTopbar(setlist.name || 'Setlist', true);

    const _songs = Store.get('songs');
    const container = document.getElementById('setlist-detail-content');
    const songs = setlist.songs || [];

    let html = `<div class="detail-header">
      ${Admin.isEditMode() ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-setlist">Edit Setlist</button><button class="btn-ghost btn-duplicate-setlist"><i data-lucide="copy" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Duplicate</button></div>` : ''}
      <div class="detail-title">${esc(setlist.name) || 'Untitled Setlist'}</div>
      <div class="detail-subtitle">${songs.length} song${songs.length !== 1 ? 's' : ''}${songs.length > 0 ? ' <button class="btn-live-mode"><i data-lucide="monitor" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Live Mode</button><button class="btn-copy-setlist"><i data-lucide="clipboard-copy" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Copy</button><button class="btn-print-setlist" title="Print setlist"><i data-lucide="printer" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Print</button>' : ''}</div>
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
          App.renderDetail(song, true);
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
      _saveSetlists('Setlist duplicated');
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

    // Wire Print Setlist button
    container.querySelector('.btn-print-setlist')?.addEventListener('click', () => {
      _printSetlist(setlist, _songs);
    });
  }

  // ─── PRINT SETLIST ──────────────────────────────────────────

  function _printSetlist(setlist, allSongs) {
    const songs = setlist.songs || [];
    if (!songs.length) return;

    // Build print-friendly HTML
    let rows = '';
    songs.forEach((entry, i) => {
      const song = allSongs.find(s => s.id === entry.id);
      if (!song) return;
      const meta = [];
      if (song.key) meta.push(esc(song.key));
      if (song.bpm) meta.push(esc(String(song.bpm)) + ' bpm');
      if (song.timeSig) meta.push(esc(song.timeSig));
      rows += `<tr>
        <td class="psl-num">${i + 1}</td>
        <td class="psl-title">${esc(song.title)}</td>
        <td class="psl-meta">${meta.join(' &middot; ')}</td>
        ${entry.comment ? `</tr><tr><td></td><td colspan="2" class="psl-comment">${esc(entry.comment)}</td>` : ''}
      </tr>`;
    });

    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    const printHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(setlist.name || 'Setlist')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px 32px; color: #111; }
  .psl-header { margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
  .psl-title-main { font-size: 22px; font-weight: 700; }
  .psl-sub { font-size: 13px; color: #666; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  tr { border-bottom: 1px solid #e0e0e0; }
  td { padding: 7px 8px; vertical-align: top; font-size: 14px; }
  .psl-num { width: 28px; text-align: right; color: #999; font-size: 13px; padding-right: 12px; }
  .psl-title { font-weight: 600; }
  .psl-meta { color: #666; font-size: 13px; white-space: nowrap; text-align: right; }
  .psl-comment { font-size: 12px; color: #888; font-style: italic; padding-top: 0; padding-bottom: 10px; }
  .psl-footer { margin-top: 24px; font-size: 11px; color: #aaa; text-align: center; }
  @media print { body { padding: 16px 20px; } }
</style></head><body>
  <div class="psl-header">
    <div class="psl-title-main">${esc(setlist.name || 'Setlist')}</div>
    <div class="psl-sub">${songs.length} song${songs.length !== 1 ? 's' : ''} &middot; ${dateStr}</div>
  </div>
  <table>${rows}</table>
  <div class="psl-footer">Catman Trio</div>
</body></html>`;

    // Open print window
    const win = window.open('', '_blank', 'width=700,height=900');
    if (!win) {
      showToast('Popup blocked — allow popups to print.');
      return;
    }
    try {
      win.document.write(printHtml);
      win.document.close();
    } catch (_) {
      showToast('Failed to prepare print view.');
      try { win.close(); } catch (_e) {}
      return;
    }
    // Print when content is rendered; close on completion
    win.onload = () => {
      try { win.print(); } catch (_) {}
    };
    if (win.onafterprint !== undefined) {
      win.onafterprint = () => { try { win.close(); } catch (_) {} };
    }
  }

  // ─── SETLIST LIVE MODE (ForScore-style charts + pedal support) ──

  function _renderLiveMode(setlist) {
    if (_liveModeActive) return; // double-entry guard
    const _songs = Store.get('songs');
    const songs = (setlist.songs || []).map(entry => {
      const song = _songs.find(s => s.id === entry.id);
      return song ? { ...song, comment: entry.comment || '' } : null;
    }).filter(Boolean);

    if (songs.length === 0) return;

    _liveModeActive = true;
    Store.set('liveModeActive', true);
    _revokeBlobCache();
    Player.stopAll();

    let _startTime = null; // null until user starts the timer
    let _clockInterval = null;
    let _zpHandle = null; // zoom/pan handle for chart canvas
    let _overlayTimer = null;
    let _wakeLock = null;

    // Screen Wake Lock -- keep screen on during Live Mode only
    function _updateWakeLockIndicator(active) {
      const el = document.getElementById('lm-wake-lock');
      if (!el) return;
      const icon = el.querySelector('i, svg');
      if (icon) icon.style.opacity = active ? '0.4' : '0.15';
    }
    async function _requestWakeLock() {
      try {
        if ('wakeLock' in navigator && _liveModeActive) {
          _wakeLock = await navigator.wakeLock.request('screen');
          _updateWakeLockIndicator(true);
        }
      } catch (_) { _updateWakeLockIndicator(false); }
    }
    function _onVisibilityChange() {
      if (document.visibilityState === 'visible' && _liveModeActive && !_wakeLock) _requestWakeLock();
    }
    document.addEventListener('visibilitychange', _onVisibilityChange);
    _requestWakeLock();

    // -- Build flat page list --
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

    // -- Session restore --
    let currentPageIdx = 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem('bb_live_state') || 'null');
      if (saved && saved.setlistId === setlist.id && typeof saved.pageIdx === 'number') {
        currentPageIdx = Math.max(0, Math.min(saved.pageIdx, _pages.length - 1));
      } else if (saved && saved.setlistId === setlist.id && typeof saved.idx === 'number') {
        // Legacy format -- find first page of that song index
        const target = _pages.findIndex(p => p.songIdx === saved.idx);
        if (target >= 0) currentPageIdx = target;
      }
    } catch (_) {}

    function _persistPage() {
      try { sessionStorage.setItem('bb_live_state', JSON.stringify({ setlistId: setlist.id, pageIdx: currentPageIdx })); } catch (_) {}
    }

    _showView('setlist-live');
    document.body.classList.add('live-mode-active');
    document.documentElement.classList.add('live-mode-active');

    // Try Fullscreen API
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    }

    const container = document.getElementById('setlist-live-content');

    // -- Build persistent DOM --
    container.innerHTML = `
      <div class="lm-loading-overlay">
        <div class="lm-loading-spinner"></div>
        <div class="lm-loading-text">Loading Live Mode\u2026</div>
      </div>
      <div class="lm-header" style="opacity:0">
        <button class="lm-jump-btn" aria-label="Song picker"><i data-lucide="list" style="width:20px;height:20px;"></i></button>
        <span class="lm-progress"></span><span id="lm-wake-lock" class="lm-wake-indicator" title="Screen stay awake"><i data-lucide="eye" style="width:12px;height:12px;opacity:0.15;"></i></span>
        <div class="lm-clock-group">
          <span class="lm-clock"></span>
          <button class="lm-timer-btn" aria-label="Start timer"><i data-lucide="play" style="width:12px;height:12px;"></i> <span class="lm-timer">Start</span></button>
        </div>
        <button class="lm-close-btn" aria-label="Exit Live Mode"><i data-lucide="x" style="width:22px;height:22px;"></i></button>
      </div>
      <div class="lm-jump-overlay hidden">
        <div class="lm-jump-list"></div>
      </div>
      <div class="lm-carousel" style="opacity:0">
        <div class="lm-slide" data-slot="0">
          <div class="lm-slide-chart hidden">
            <canvas class="lm-slide-canvas"></canvas>
          </div>
          <div class="lm-slide-meta hidden"></div>
          <div class="lm-slide-loading hidden">
            <div class="lm-loading-spinner"></div>
            <div class="lm-loading-text">Loading chart\u2026</div>
          </div>
        </div>
        <div class="lm-slide" data-slot="1">
          <div class="lm-slide-chart hidden">
            <canvas class="lm-slide-canvas"></canvas>
          </div>
          <div class="lm-slide-meta hidden"></div>
          <div class="lm-slide-loading hidden">
            <div class="lm-loading-spinner"></div>
            <div class="lm-loading-text">Loading chart\u2026</div>
          </div>
        </div>
        <div class="lm-slide" data-slot="2">
          <div class="lm-slide-chart hidden">
            <canvas class="lm-slide-canvas"></canvas>
          </div>
          <div class="lm-slide-meta hidden"></div>
          <div class="lm-slide-loading hidden">
            <div class="lm-loading-spinner"></div>
            <div class="lm-loading-text">Loading chart\u2026</div>
          </div>
        </div>
        <div class="lm-chart-overlay"></div>
      </div>
      <div class="lm-nav" style="opacity:0">
        <button class="lm-nav-btn lm-prev" aria-label="Previous">
          <i data-lucide="chevron-left" style="width:32px;height:32px;"></i>
        </button>
        <button class="lm-nav-btn lm-next" aria-label="Next">
          <i data-lucide="chevron-right" style="width:32px;height:32px;"></i>
        </button>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    const carousel       = container.querySelector('.lm-carousel');
    const slideDoms      = Array.from(container.querySelectorAll('.lm-slide'));
    let slots            = [slideDoms[0], slideDoms[1], slideDoms[2]]; // [prev, current, next]
    const chartOverlay   = container.querySelector('.lm-chart-overlay');
    const progressEl     = container.querySelector('.lm-progress');
    const prevBtn        = container.querySelector('.lm-prev');
    const nextBtn        = container.querySelector('.lm-next');
    let _currentChartArea = slots[1].querySelector('.lm-slide-chart');
    let _currentCanvas    = slots[1].querySelector('.lm-slide-canvas');

    // Wire buttons
    prevBtn.addEventListener('click', () => _goPage(-1));
    nextBtn.addEventListener('click', () => _goPage(1));
    container.querySelector('.lm-close-btn').addEventListener('click', _exitLiveMode);

    // -- Quick-Jump Song Picker --
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
        _updateSlots();
        _checkSongBoundary();
        _persistPage();
      }
      _closeJumpPicker();
    });

    // Dismiss overlay by tapping outside the list
    jumpOverlay.addEventListener('click', (e) => {
      if (e.target === jumpOverlay) _closeJumpPicker();
    });

    // -- Navigation --
    let _lastRenderedSongIdx = -1;
    let _isAnimating = false;

    function _renderPageIntoSlide(slide, pageIdx) {
      const page = _pages[pageIdx];
      const chartArea = slide.querySelector('.lm-slide-chart');
      const canvas = slide.querySelector('.lm-slide-canvas');
      const metaArea = slide.querySelector('.lm-slide-meta');
      const loadArea = slide.querySelector('.lm-slide-loading');

      slide.dataset.pageIdx = pageIdx;

      if (!page) {
        // No page (edge) -- show empty black
        chartArea.classList.add('hidden');
        metaArea.classList.add('hidden');
        loadArea.classList.add('hidden');
        return Promise.resolve();
      }

      chartArea.classList.toggle('hidden', page.type !== 'chart');
      metaArea.classList.toggle('hidden', page.type !== 'metadata');
      loadArea.classList.toggle('hidden', page.type !== 'loading');

      if (page.type === 'chart') {
        // Force reflow after un-hiding chartArea
        void chartArea.offsetWidth;
        let cw = chartArea.clientWidth;
        if (cw <= 0) cw = carousel.clientWidth || 0;
        if (cw <= 0) return Promise.resolve();
        return PDFViewer.renderToCanvasCached(page.pdfDoc, page.pageNum, canvas, chartArea, cw)
          .catch(err => {
            console.error('Live mode chart render error', err);
            if (_pages[pageIdx] === page) {
              _pages[pageIdx] = { type: 'metadata', songIdx: page.songIdx, song: page.song };
              _renderPageIntoSlide(slide, pageIdx);
            }
          });
      } else if (page.type === 'metadata') {
        const song = page.song;
        metaArea.innerHTML = `
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
        return Promise.resolve();
      }
      return Promise.resolve();
    }

    function _updateSlots() {
      // Carousel always shows the middle slot (index 1)
      carousel.style.transition = 'none';
      carousel.style.transform = 'translateX(-100%)';

      // Render current page into center slot
      _renderPageIntoSlide(slots[1], currentPageIdx);

      // Render prev page into left slot (or empty if at start)
      if (currentPageIdx > 0) {
        _renderPageIntoSlide(slots[0], currentPageIdx - 1);
      } else {
        _renderPageIntoSlide(slots[0], -1);
      }

      // Render next page into right slot (or empty if at end)
      if (currentPageIdx < _pages.length - 1) {
        _renderPageIntoSlide(slots[2], currentPageIdx + 1);
      } else {
        _renderPageIntoSlide(slots[2], -1);
      }

      // Re-attach zoom/pan to the current center slide
      if (_zpHandle) _zpHandle.destroy();
      _currentChartArea = slots[1].querySelector('.lm-slide-chart');
      _currentCanvas = slots[1].querySelector('.lm-slide-canvas');
      _zpHandle = PDFViewer.attachZoomPan(_currentCanvas, _currentChartArea);

      _updateProgress();
    }

    function _updateProgress() {
      const page = _pages[currentPageIdx];
      if (!page) return;
      const songNum = page.songIdx + 1;
      const totalSongs = _songEntries.length;
      if (page.type === 'chart') {
        progressEl.textContent = `Song ${songNum}/${totalSongs} \u00b7 Page ${page.pageNum}/${page.totalSongPages}`;
      } else {
        progressEl.textContent = `Song ${songNum}/${totalSongs}`;
      }
      prevBtn.disabled = currentPageIdx === 0;
      nextBtn.disabled = currentPageIdx === _pages.length - 1;
    }

    function _goPage(delta, animate) {
      if (_isAnimating) return;
      if (_zpHandle && _zpHandle.getZoom() > 1.05) _zpHandle.resetZoom();
      const newIdx = currentPageIdx + delta;
      if (newIdx < 0 || newIdx >= _pages.length) return;
      haptic.light();

      if (animate === false) {
        currentPageIdx = newIdx;
        _updateSlots();
        _checkSongBoundary();
        _persistPage();
        return;
      }

      // Animated transition using the pre-rendered adjacent slide
      _isAnimating = true;
      const targetX = delta > 0 ? '-200%' : '0%'; // slide left or right

      carousel.style.transition = 'transform 0.25s ease-out';
      carousel.style.transform = `translateX(${targetX})`;

      function _afterSnap() {
        carousel.removeEventListener('transitionend', _afterSnap);
        _isAnimating = false;

        // Recycle slides
        if (delta > 0) {
          const recycled = slots.shift();
          slots.push(recycled);
          currentPageIdx = newIdx;
          carousel.insertBefore(recycled, chartOverlay);
        } else {
          const recycled = slots.pop();
          slots.unshift(recycled);
          currentPageIdx = newIdx;
          carousel.insertBefore(recycled, slots[1]);
        }

        // Reset position to show center (no transition)
        carousel.style.transition = 'none';
        carousel.style.transform = 'translateX(-100%)';

        // Re-attach zoom/pan to the new center slide
        if (_zpHandle) _zpHandle.destroy();
        _currentChartArea = slots[1].querySelector('.lm-slide-chart');
        _currentCanvas = slots[1].querySelector('.lm-slide-canvas');
        _zpHandle = PDFViewer.attachZoomPan(_currentCanvas, _currentChartArea);

        // Re-render center slide ONLY if its page index is stale
        if ((parseInt(slots[1].dataset.pageIdx, 10) || 0) !== currentPageIdx) {
          _renderPageIntoSlide(slots[1], currentPageIdx);
        }

        // Pre-render the new adjacent page into the recycled slot
        if (delta > 0 && currentPageIdx < _pages.length - 1) {
          _renderPageIntoSlide(slots[2], currentPageIdx + 1);
        } else if (delta > 0) {
          _renderPageIntoSlide(slots[2], -1);
        }
        if (delta < 0 && currentPageIdx > 0) {
          _renderPageIntoSlide(slots[0], currentPageIdx - 1);
        } else if (delta < 0) {
          _renderPageIntoSlide(slots[0], -1);
        }

        _updateProgress();
        _checkSongBoundary();
        _persistPage();
      }

      carousel.addEventListener('transitionend', _afterSnap, { once: true });
      setTimeout(() => { if (_isAnimating) _afterSnap(); }, 500);
    }

    function _checkSongBoundary() {
      const page = _pages[currentPageIdx];
      if (!page) return;
      const isNewSong = page.songIdx !== _lastRenderedSongIdx;
      _lastRenderedSongIdx = page.songIdx;
      if (isNewSong) _showOverlay(page.song);
    }

    function _showOverlay(song) {
      haptic.medium(); // song boundary feedback
      if (_overlayTimer) clearTimeout(_overlayTimer);
      const meta = [song.key, song.bpm ? song.bpm + ' BPM' : '', song.timeSig].filter(Boolean).join(' \u00b7 ');
      chartOverlay.innerHTML = `<div class="lm-overlay-title">${esc(song.title)}</div>${meta ? `<div class="lm-overlay-meta">${esc(meta)}</div>` : ''}`;
      chartOverlay.classList.add('lm-overlay-visible');
      _overlayTimer = setTimeout(() => {
        chartOverlay.classList.remove('lm-overlay-visible');
      }, 3000);
    }

    // -- Zoom/Pan for chart canvas --
    _zpHandle = PDFViewer.attachZoomPan(_currentCanvas, _currentChartArea);

    // -- Progressive PDF loading (serialized mutations to prevent race conditions) --
    let _spliceLock = Promise.resolve();

    async function _loadChartPDF(songIdx, chartDriveId) {
      try {
        const blobUrl = await _getBlobUrl(chartDriveId);
        if (!_liveModeActive) return; // exited during load
        const pdfDoc = await pdfjsLib.getDocument(blobUrl).promise;
        if (!_liveModeActive) { pdfDoc.destroy(); return; } // exited during load
        const numPages = pdfDoc.numPages;

        // Zero-page PDFs -- fall back to metadata
        if (numPages === 0) {
          pdfDoc.destroy();
          _spliceLock = _spliceLock.then(() => {
            const idx = _pages.findIndex(p => p.songIdx === songIdx && p.type === 'loading' && p.chartDriveId === chartDriveId);
            if (idx !== -1) {
              _pages[idx] = { type: 'metadata', songIdx, song: _pages[idx].song };
              if (idx === currentPageIdx) _updateSlots();
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
          const cw = _currentChartArea ? _currentChartArea.clientWidth : 0;
          if (cw > 0) {
            PDFViewer.preRenderPage(pdfDoc, 1, cw).catch(() => {});
          }

          if (wasBeforeCurrent) {
            currentPageIdx += (chartPages.length - 1);
          }

          if (wasAtCurrent) {
            _updateSlots();
          }
        });
      } catch (err) {
        console.error('Failed to load chart for song', songIdx, err);
        _spliceLock = _spliceLock.then(() => {
          const idx = _pages.findIndex(p => p.songIdx === songIdx && p.type === 'loading' && p.chartDriveId === chartDriveId);
          if (idx !== -1) {
            const song = _pages[idx].song;
            _pages[idx] = { type: 'metadata', songIdx, song };
            if (idx === currentPageIdx) _updateSlots();
          }
        });
      }
    }

    // -- Loading overlay reveal logic --
    let _lmRevealed = false;
    const _loadingOverlay = container.querySelector('.lm-loading-overlay');
    const _loadingTextEl = _loadingOverlay.querySelector('.lm-loading-text');
    const _lmHeader = container.querySelector('.lm-header');
    const _lmCarousel = container.querySelector('.lm-carousel');
    const _lmNav = container.querySelector('.lm-nav');

    // Count total charts to load for progress display
    let _totalCharts = 0, _loadedCharts = 0;
    for (let si = 0; si < _songEntries.length; si++) {
      _totalCharts += _getOrderedCharts(_songEntries[si]).length;
    }

    function _updateLoadingProgress() {
      if (_lmRevealed || !_loadingTextEl) return;
      if (_totalCharts > 0) {
        _loadingTextEl.textContent = `Loading charts\u2026 ${_loadedCharts}/${_totalCharts}`;
      }
    }

    function _revealLiveMode() {
      if (_lmRevealed) return;
      _lmRevealed = true;
      // Update slots now that current page is loaded
      _updateSlots();
      // Fade out loading overlay, fade in content
      if (_loadingOverlay) {
        _loadingOverlay.style.transition = 'opacity 0.2s ease-out';
        _loadingOverlay.style.opacity = '0';
        setTimeout(() => _loadingOverlay.remove(), 200);
      }
      _lmHeader.style.transition = 'opacity 0.25s ease-in';
      _lmCarousel.style.transition = 'opacity 0.25s ease-in';
      _lmNav.style.transition = 'opacity 0.25s ease-in';
      _lmHeader.style.opacity = '1';
      _lmCarousel.style.opacity = '1';
      _lmNav.style.opacity = '1';
      // Clean up inline styles after transition
      setTimeout(() => {
        _lmHeader.style.removeProperty('transition');
        _lmCarousel.style.removeProperty('transition');
        _lmNav.style.removeProperty('transition');
        // Restore carousel transition for swipe navigation
        carousel.style.transition = 'none';
        carousel.style.transform = 'translateX(-100%)';
      }, 300);
    }

    // Check if current page needs loading
    const _initialPage = _pages[currentPageIdx];
    if (!_initialPage || _initialPage.type !== 'loading') {
      requestAnimationFrame(() => _revealLiveMode());
    } else {
      // Safety timeout -- never stay stuck on loading (5s)
      const _revealTimeout = setTimeout(_revealLiveMode, 5000);
      // Patch _updateSlots to detect when current page is ready
      const _origUpdateSlots = _updateSlots;
      _updateSlots = function() {
        _origUpdateSlots();
        if (!_lmRevealed) {
          const curPage = _pages[currentPageIdx];
          if (curPage && curPage.type !== 'loading') {
            clearTimeout(_revealTimeout);
            _revealLiveMode();
          }
        }
      };
    }

    // Fire all PDF loads in parallel
    const loadPromises = [];
    for (let si = 0; si < _songEntries.length; si++) {
      const orderedCharts = _getOrderedCharts(_songEntries[si]);
      orderedCharts.forEach(chart => {
        loadPromises.push(_loadChartPDF(si, chart.driveId).then(() => {
          _loadedCharts++;
          _updateLoadingProgress();
        }));
      });
    }

    // After all charts load, pre-render every page for instant swiping
    Promise.all(loadPromises).then(async () => {
      if (!_liveModeActive) return;
      const cw = carousel.clientWidth || window.innerWidth;
      if (cw <= 0) return;
      // Collect unique chart pages to pre-render
      const toRender = [];
      const seenKeys = new Set();
      for (const pg of _pages) {
        if (pg.type !== 'chart' || !pg.pdfDoc) continue;
        const key = (pg.pdfDoc.fingerprints?.[0] || pg.pdfDoc._transport?.docId || String(Math.random())) + '-' + pg.pageNum;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          toRender.push(pg);
        }
      }
      // Batch pre-renders in groups of 4 to avoid memory spikes
      for (let i = 0; i < toRender.length; i += 4) {
        if (!_liveModeActive) return;
        await Promise.all(toRender.slice(i, i + 4).map(pg =>
          PDFViewer.preRenderPage(pg.pdfDoc, pg.pageNum, cw).catch(() => {})
        ));
      }
    }).catch(() => {});

    // -- Exit Live Mode --
    function _exitLiveMode() {
      if (!_liveModeActive) return;
      _liveModeActive = false;
      Store.set('liveModeActive', false);
      _exitLiveModeRef = null;
      Store.set('exitLiveModeRef', null);
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
      if (_wakeLock) { try { _wakeLock.release(); } catch (_) {} _wakeLock = null; _updateWakeLockIndicator(false); }
      document.body.classList.remove('live-mode-active');
      document.documentElement.classList.remove('live-mode-active');
      document.removeEventListener('keydown', _onKey);
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      carousel.removeEventListener('touchstart', _onDragStart);
      carousel.removeEventListener('touchmove', _onDragMove);
      carousel.removeEventListener('touchend', _onDragEnd);
      carousel.removeEventListener('touchstart', _onTapStart);
      carousel.removeEventListener('touchend', _onTapEnd);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitFullscreenElement) {
        document.webkitExitFullscreen();
      }
      renderSetlistDetail(setlist, true);
    }
    _exitLiveModeRef = _exitLiveMode;
    Store.set('exitLiveModeRef', _exitLiveMode);

    // -- Keyboard navigation (with pedal support) --
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

    // -- Carousel swipe navigation (drag-follow + snap) --
    let _dragX0 = 0, _dragY0 = 0, _dragging = false, _dragLocked = false, _edgeBuzzed = false;
    const SWIPE_THRESHOLD = Math.max(40, Math.min(60, window.innerWidth * 0.15));

    function _onDragStart(e) {
      if (_isAnimating) return;
      // If zoomed, let zoom/pan handle the touch
      if (_zpHandle && _zpHandle.getZoom() > 1.05) return;
      const t = e.touches[0];
      _dragX0 = t.clientX;
      _dragY0 = t.clientY;
      _dragging = true;
      _dragLocked = false;
      _edgeBuzzed = false;
      carousel.style.transition = 'none';
      // Claim touch on iOS Safari
      e.preventDefault();
    }

    function _onDragMove(e) {
      if (!_dragging || _isAnimating) return;
      // If zoom changed during drag, abort carousel
      if (_zpHandle && _zpHandle.getZoom() > 1.05) { _dragging = false; carousel.style.transform = 'translateX(-100%)'; return; }
      if (e.touches.length > 1) { _dragging = false; carousel.style.transform = 'translateX(-100%)'; return; } // multi-touch -- abort
      const t = e.touches[0];
      const dx = t.clientX - _dragX0;
      const dy = t.clientY - _dragY0;

      // Lock direction on first significant movement
      if (!_dragLocked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical -- abort carousel, block scroll
          _dragging = false;
          carousel.style.transform = 'translateX(-100%)';
          e.preventDefault();
          return;
        }
        _dragLocked = true;
      }

      // Prevent native scroll while carousel-dragging horizontally
      e.preventDefault();

      // Convert dx pixels to percentage of one slide width
      const slideWidth = carousel.clientWidth;
      let offsetPct = (dx / slideWidth) * 100;

      // Rubber-band effect at edges
      if ((dx > 0 && currentPageIdx === 0) || (dx < 0 && currentPageIdx === _pages.length - 1)) {
        if (!_edgeBuzzed) { haptic.medium(); _edgeBuzzed = true; } // edge bounce
        offsetPct *= 0.25; // resist at edges
      }

      carousel.style.transform = `translateX(calc(-100% + ${offsetPct}%))`;
    }

    function _onDragEnd(e) {
      if (!_dragging) return;
      _dragging = false;
      if (_isAnimating) { carousel.style.transform = 'translateX(-100%)'; return; }

      const t = e.changedTouches[0];
      const dx = t ? t.clientX - _dragX0 : 0;

      if (Math.abs(dx) >= SWIPE_THRESHOLD) {
        const delta = dx < 0 ? 1 : -1;
        const canGo = dx < 0 ? currentPageIdx < _pages.length - 1 : currentPageIdx > 0;
        if (canGo) {
          haptic.light();
          _goPage(delta);
          return;
        }
      }

      // Snap back
      carousel.style.transition = 'transform 0.2s ease-out';
      carousel.style.transform = 'translateX(-100%)';
      setTimeout(() => { carousel.style.transition = ''; }, 250);
    }

    carousel.addEventListener('touchstart', _onDragStart, { passive: false });
    carousel.addEventListener('touchmove', _onDragMove, { passive: false });
    carousel.addEventListener('touchend', _onDragEnd, { passive: true });

    // -- Tap zones for page turning --
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

      const currentChartArea = slots[1].querySelector('.lm-slide-chart');
      const rect = currentChartArea.getBoundingClientRect();
      const x = (t.clientX - rect.left) / rect.width;

      // Show tap flash feedback
      const flash = document.createElement('div');
      flash.className = 'lm-tap-flash';
      if (x >= 0.45) {
        flash.style.right = '0';
        flash.style.width = '55%';
        currentChartArea.appendChild(flash);
        setTimeout(() => { if (flash.parentNode) flash.remove(); }, 200);
        _goPage(1);
      } else if (x <= 0.30) {
        flash.style.left = '0';
        flash.style.width = '30%';
        currentChartArea.appendChild(flash);
        setTimeout(() => { if (flash.parentNode) flash.remove(); }, 200);
        _goPage(-1);
      }
    }

    carousel.addEventListener('touchstart', _onTapStart, { passive: true });
    carousel.addEventListener('touchend', _onTapEnd, { passive: true });

    // -- Initial render --
    _updateSlots();
    _checkSongBoundary();
    _persistPage();

    // -- Clock + timer --
    const clockEl = container.querySelector('.lm-clock');
    let timerEl = container.querySelector('.lm-timer');
    const timerBtn = container.querySelector('.lm-timer-btn');

    function _updateClock() {
      const now = new Date();
      let h = now.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      const m = String(now.getMinutes()).padStart(2, '0');
      if (clockEl) clockEl.textContent = h + ':' + m + ' ' + ampm;

      if (_startTime) {
        const elapsed = Math.floor((Date.now() - _startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = String(elapsed % 60).padStart(2, '0');
        if (timerEl) timerEl.textContent = mins + ':' + secs;
      }
    }

    function _toggleTimer() {
      if (_startTime) {
        // Stop / reset
        _startTime = null;
        if (timerBtn) {
          timerBtn.innerHTML = '<i data-lucide="play" style="width:12px;height:12px;"></i> <span class="lm-timer">Start</span>';
          timerEl = timerBtn.querySelector('.lm-timer');
          if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [timerBtn] });
          timerBtn.classList.remove('lm-timer-running');
        }
      } else {
        // Start
        _startTime = Date.now();
        if (timerBtn) {
          timerBtn.innerHTML = '<i data-lucide="clock" style="width:12px;height:12px;"></i> <span class="lm-timer">0:00</span>';
          timerEl = timerBtn.querySelector('.lm-timer');
          if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [timerBtn] });
          timerBtn.classList.add('lm-timer-running');
          // Re-sync interval so 0:01 appears exactly 1s after start
          if (_clockInterval) clearInterval(_clockInterval);
          _clockInterval = setInterval(_updateClock, 1000);
        }
      }
    }

    if (timerBtn) timerBtn.addEventListener('click', _toggleTimer);

    _updateClock();
    _clockInterval = setInterval(_updateClock, 1000);
  }

  // ─── SETLIST EDIT VIEW ───────────────────────────────────────

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
          <label class="form-label">Gig Date <span class="muted" style="font-weight:400">(optional \u2014 auto-archives 2 days after)</span></label>
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
          <input class="form-input" id="slf-picker-search" type="text" placeholder="Search songs to add\u2026" autocomplete="off" />
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
    const _songs = Store.get('songs');

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
                  value="${esc(entry.comment || '')}" placeholder="Add note\u2026"
                  maxlength="300" data-comment-idx="${i}" />
              </div>
            </div>
            <div class="setlist-edit-row-actions">
              <button class="icon-btn sl-remove" data-idx="${i}" style="color:var(--red)" aria-label="Remove song"><i data-lucide="x"></i></button>
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
              ${s.key ? esc(s.key) : ''}${s.key && s.bpm ? ' \u00b7 ' : ''}${s.bpm ? esc(String(s.bpm)) + ' bpm' : ''}${(s.key || s.bpm) && s.timeSig ? ' \u00b7 ' : ''}${s.timeSig ? esc(s.timeSig) : ''}
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
        await _saveSetlists();
        _activeSetlist = null;
        Store.set('activeSetlist', null);
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
        await _saveSetlists();
        _activeSetlist = null;
        Store.set('activeSetlist', null);
        renderSetlists();
      });
    });
  }

  // ─── Getters for app.js backward compat ───────────────────────

  function isLiveModeActive() {
    return _liveModeActive;
  }

  function getExitLiveModeRef() {
    return _exitLiveModeRef;
  }

  // ─── Router hook: clean up live mode on view change ──────────
  Router.registerHook('cleanupLiveMode', () => {
    if (_liveModeActive && _exitLiveModeRef) _exitLiveModeRef();
  });

  // ─── Router registrations ────────────────────────────────────

  Router.register('setlists', Utils.safeRender('setlists', (route) => {
    if (route && route.rerender) {
      _syncFromStore();
      renderSetlists(true);
      return;
    }
    renderSetlists();
  }));

  Router.register('setlist-detail', Utils.safeRender('setlist-detail', (route) => {
    if (route && route.rerender) {
      _activeSetlist = Store.get('activeSetlist') || _activeSetlist;
      _syncFromStore();
      if (_activeSetlist) renderSetlistDetail(_activeSetlist, true);
      return;
    }
    if (route && route.setlistId) {
      _syncFromStore();
      const s = _setlists.find(x => x.id === route.setlistId);
      if (s) renderSetlistDetail(s, true);
      else renderSetlists();
    }
  }));

  // ─── Public API ──────────────────────────────────────────────

  return {
    renderSetlists,
    renderSetlistDetail,
    renderSetlistEdit,
    showSetlistPicker,
    batchAddToSetlist,
    isLiveModeActive,
    getExitLiveModeRef,
  };

})();
