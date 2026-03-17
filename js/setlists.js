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
    const isAdmin = Admin.isEditMode();

    let html = `<div class="detail-header">
      ${isAdmin ? `<div class="detail-edit-bar"><button class="btn-ghost btn-edit-setlist">Edit Setlist</button><button class="btn-ghost btn-duplicate-setlist"><i data-lucide="copy" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Duplicate</button></div>` : ''}
      <div class="detail-title">${esc(setlist.name) || 'Untitled Setlist'}</div>
      <div class="detail-subtitle">${songs.length} song${songs.length !== 1 ? 's' : ''}${songs.length > 0 ? ' <button class="btn-live-mode"><i data-lucide="monitor" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Live Mode</button><button class="btn-copy-setlist"><i data-lucide="clipboard-copy" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Copy</button><button class="btn-print-setlist" title="Print setlist"><i data-lucide="printer" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Print</button><button class="btn-share-setlist" title="Share setlist"><i data-lucide="share-2" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;"></i>Share</button>' : ''}</div>
    </div>`;

    if (songs.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px">
        <p>Empty setlist.</p>
        <p class="muted">${isAdmin ? 'Edit to add songs.' : 'No songs added yet.'}</p>
      </div>`;
    } else {
      html += `<div class="setlist-song-list">`;
      songs.forEach((entry, i) => {
        if (entry.freetext) {
          // Freetext song — ad-hoc entry not in the song DB
          html += `
            <div class="setlist-song-row setlist-song-freetext" data-idx="${i}">
              <span class="setlist-song-num">${i + 1}</span>
              <div class="setlist-song-info">
                <span class="setlist-song-title">${esc(entry.title || 'Untitled')}</span>
                <span class="setlist-song-meta">
                  ${entry.key ? esc(entry.key) : ''}${entry.key && entry.bpm ? ' \u00b7 ' : ''}${entry.bpm ? esc(String(entry.bpm)) + ' bpm' : ''}
                </span>
                ${entry.notes ? `<span class="setlist-song-comment">${esc(entry.notes)}</span>` : ''}
                ${entry.comment ? `<span class="setlist-song-comment">${esc(entry.comment)}</span>` : ''}
              </div>
              ${isAdmin ? `<button class="icon-btn ft-edit-btn" data-idx="${i}" aria-label="Edit freetext song" title="Edit"><i data-lucide="pencil" style="width:14px;height:14px;"></i></button>` : ''}
            </div>`;
        } else {
          const song = _songs.find(s => s.id === entry.id);
          if (song) {
            html += `
              <div class="setlist-song-row" data-song-id="${esc(song.id)}">
                <span class="setlist-song-num">${i + 1}</span>
                <div class="setlist-song-info">
                  <span class="setlist-song-title">${esc(song.title)}</span>
                  <span class="setlist-song-meta">
                    ${song.key ? esc(song.key) : ''}${song.key && song.bpm ? ' \u00b7 ' : ''}${song.bpm ? esc(String(song.bpm)) + ' bpm' : ''}${(song.key || song.bpm) && song.timeSig ? ' \u00b7 ' : ''}${song.timeSig ? esc(song.timeSig) : ''}
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
        }
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire song clicks (skip freetext and missing rows)
    container.querySelectorAll('.setlist-song-row:not(.setlist-song-missing):not(.setlist-song-freetext)').forEach(row => {
      row.addEventListener('click', () => {
        const song = _songs.find(s => s.id === row.dataset.songId);
        if (song) {
          _pushNav(() => renderSetlistDetail(setlist));
          App.renderDetail(song, true);
        }
      });
    });

    // Wire freetext edit buttons (admin only)
    container.querySelectorAll('.ft-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const entry = songs[idx];
        if (!entry || !entry.freetext) return;
        _showFreetextEditModal(entry, () => {
          // Re-fetch fresh setlist from store in case background sync updated _setlists
          _syncFromStore();
          const freshSetlist = _setlists.find(s => s.id === setlist.id);
          if (!freshSetlist) { showToast('Setlist not found.'); return; }
          // Apply freetext edits to the fresh copy
          const freshEntry = (freshSetlist.songs || [])[idx];
          if (freshEntry && freshEntry.freetext && freshEntry.id === entry.id) {
            freshEntry.title = entry.title;
            freshEntry.key = entry.key;
            freshEntry.bpm = entry.bpm;
            freshEntry.notes = entry.notes;
          }
          freshSetlist._ts = Date.now();
          freshSetlist.updatedAt = new Date().toISOString();
          _saveSetlists();
          renderSetlistDetail(freshSetlist, true);
        });
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
        if (entry.freetext) {
          let line = (i + 1) + '. ' + (entry.title || 'Untitled');
          const meta = [];
          if (entry.key) meta.push(entry.key);
          if (entry.bpm) meta.push(entry.bpm + ' BPM');
          if (meta.length) line += ' \u2014 ' + meta.join(' \u00b7 ');
          lines.push(line);
          if (entry.notes) lines.push('   ' + entry.notes);
          if (entry.comment) lines.push('   ' + entry.comment);
          return;
        }
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

    // Wire Share Setlist button
    container.querySelector('.btn-share-setlist')?.addEventListener('click', () => {
      _shareSetlist(setlist, _songs);
    });
  }

  // ─── PRINT SETLIST ──────────────────────────────────────────

  function _printSetlist(setlist, allSongs) {
    const songs = setlist.songs || [];
    if (!songs.length) return;

    // Build print-friendly HTML
    let rows = '';
    songs.forEach((entry, i) => {
      if (entry.freetext) {
        const meta = [];
        if (entry.key) meta.push(esc(entry.key));
        if (entry.bpm) meta.push(esc(String(entry.bpm)) + ' bpm');
        rows += `<tr>
          <td class="psl-num">${i + 1}</td>
          <td class="psl-title">${esc(entry.title || 'Untitled')}</td>
          <td class="psl-meta">${meta.join(' &middot; ')}</td>
          ${entry.notes ? `</tr><tr><td></td><td colspan="2" class="psl-comment">${esc(entry.notes)}</td>` : ''}
          ${entry.comment ? `</tr><tr><td></td><td colspan="2" class="psl-comment">${esc(entry.comment)}</td>` : ''}
        </tr>`;
        return;
      }
      const song = allSongs.find(s => s.id === entry.id);
      if (!song) return;
      const meta = [];
      if (song.key) meta.push(esc(song.key));
      if (song.bpm) meta.push(esc(String(song.bpm)) + ' bpm');
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

    // Use a hidden iframe instead of window.open() — avoids the iOS bug where
    // a popup opens a new Safari tab with no back button and no print dialog.
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:700px;height:900px;border:none;';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    document.body.appendChild(iframe);

    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(printHtml);
      doc.close();
    } catch (_) {
      showToast('Failed to prepare print view.');
      document.body.removeChild(iframe);
      return;
    }

    // Wait for content to render, then trigger print from the iframe's window context
    const iframeWin = iframe.contentWindow;
    const _triggerPrint = () => {
      try {
        iframeWin.focus();
        iframeWin.print();
      } catch (_) {
        // iOS Safari may not support iframe print — fall back to main window print
        // by temporarily injecting the content into a printable div
        _printFallback(printHtml);
      }
      // Clean up iframe after a short delay (print dialog is modal)
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch (_) {}
      }, 1000);
    };

    // iframe onload fires when doc.close() completes
    if (iframe.contentDocument.readyState === 'complete') {
      _triggerPrint();
    } else {
      iframe.onload = _triggerPrint;
    }
  }

  // Fallback for iOS Safari: inject print content into a full-screen overlay,
  // trigger window.print(), then remove. Works when iframe.print() is blocked.
  function _printFallback(html) {
    const overlay = document.createElement('div');
    overlay.id = 'print-fallback-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow:auto;';
    overlay.innerHTML = `<div style="padding:24px 32px;max-width:700px;margin:0 auto;">
      <button id="print-fallback-close" style="position:fixed;top:12px;right:16px;z-index:10000;padding:8px 16px;font-size:14px;font-weight:600;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">Close</button>
      <button id="print-fallback-print" style="position:fixed;top:12px;right:90px;z-index:10000;padding:8px 16px;font-size:14px;font-weight:600;background:#f0cc80;color:#111;border:none;border-radius:8px;cursor:pointer;">Print</button>
    </div>`;
    // Extract body content from the full HTML
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      overlay.querySelector('div').insertAdjacentHTML('beforeend', bodyMatch[1]);
    }
    document.body.appendChild(overlay);

    overlay.querySelector('#print-fallback-close').addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    overlay.querySelector('#print-fallback-print').addEventListener('click', () => {
      window.print();
    });
  }

  // ─── SHARE SETLIST (Web Share API + fallback) ────────────────

  function _shareSetlist(setlist, allSongs) {
    const songs = setlist.songs || [];
    if (!songs.length) return;

    // Build shareable text
    const lines = [];
    lines.push((setlist.name || 'Setlist').toUpperCase());
    if (setlist.gigDate) lines.push(setlist.gigDate);
    lines.push('─'.repeat(30));
    lines.push('');

    let totalSecs = 0;
    songs.forEach((entry, i) => {
      if (entry.freetext) {
        let line = (i + 1) + '. ' + (entry.title || 'Untitled');
        const meta = [];
        if (entry.key) meta.push(entry.key);
        if (entry.bpm) meta.push(entry.bpm + ' BPM');
        if (meta.length) line += '  (' + meta.join(' · ') + ')';
        lines.push(line);
        if (entry.notes) lines.push('   ' + entry.notes);
        if (entry.comment) lines.push('   → ' + entry.comment);
        return;
      }
      const song = allSongs.find(s => s.id === entry.id);
      if (!song) return;
      let line = (i + 1) + '. ' + (song.title || 'Untitled');
      const meta = [];
      if (song.key) meta.push(song.key);
      if (song.bpm) meta.push(song.bpm + ' BPM');
      if (song.timeSig) meta.push(song.timeSig);
      if (meta.length) line += '  (' + meta.join(' · ') + ')';
      lines.push(line);
      if (entry.comment) lines.push('   → ' + entry.comment);
      if (song.duration && song.duration > 0) totalSecs += song.duration;
    });

    lines.push('');
    lines.push('─'.repeat(30));
    const countLine = songs.length + ' song' + (songs.length !== 1 ? 's' : '');
    if (totalSecs > 0) {
      const mins = Math.floor(totalSecs / 60);
      const secs = Math.floor(totalSecs % 60);
      lines.push(countLine + ' · ' + mins + ':' + String(secs).padStart(2, '0') + ' total');
    } else {
      lines.push(countLine);
    }

    const text = lines.join('\n');
    const title = setlist.name || 'Setlist';

    // Try Web Share API first (native share sheet — AirDrop, Messages, Mail, etc.)
    if (navigator.share) {
      navigator.share({ title, text }).catch(err => {
        // User cancelled share — not an error
        if (err.name !== 'AbortError') {
          // Fallback to clipboard
          _copyToClipboard(text);
        }
      });
    } else {
      // No Share API — copy to clipboard
      _copyToClipboard(text);
    }
  }

  function _copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Setlist copied to clipboard');
      }).catch(() => {
        _fallbackCopy(text);
      });
    } else {
      _fallbackCopy(text);
    }
  }

  // ─── SETLIST LIVE MODE (ForScore-style charts + pedal support) ──

  function _renderLiveMode(setlist) {
    if (_liveModeActive) return; // double-entry guard
    const _songs = Store.get('songs');
    const songs = (setlist.songs || []).map(entry => {
      if (entry.freetext) {
        // Freetext song — build a song-like object for Live Mode
        return {
          id: entry.id,
          title: entry.title || 'Untitled',
          key: entry.key || '',
          bpm: entry.bpm || '',
          notes: entry.notes || '',
          comment: entry.comment || '',
          _freetext: true,
        };
      }
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

    // Feature: Dark/Inverted Score Mode
    let _darkMode = false;
    try { _darkMode = sessionStorage.getItem('bb_live_dark_mode') === '1'; } catch (_) {}

    // Feature: Half-Page Turns
    let _halfPageMode = false;
    try { _halfPageMode = sessionStorage.getItem('bb_live_half_page') === '1'; } catch (_) {}

    // Feature: Auto-Advance
    let _autoAdvance = false;
    let _autoAdvanceTimer = null;
    let _autoAdvanceSecs = 30;
    let _autoAdvanceStart = 0; // timestamp for progress bar
    let _autoAdvanceRaf = null;
    try {
      const savedSecs = parseInt(sessionStorage.getItem('bb_live_auto_secs'), 10);
      if (savedSecs > 0) _autoAdvanceSecs = savedSecs;
    } catch (_) {}

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
          // Check if live mode exited during the async await — release if so
          if (!_liveModeActive) {
            try { _wakeLock.release(); } catch (_) {}
            _wakeLock = null;
            return;
          }
          _updateWakeLockIndicator(true);
        }
      } catch (_) { _updateWakeLockIndicator(false); }
    }
    function _onVisibilityChange() {
      if (document.visibilityState === 'visible' && _liveModeActive) {
        // Clear stale ref — OS releases wake lock on background, ref may linger
        _wakeLock = null;
        _requestWakeLock();
        // B7: retry failed charts when app becomes visible again (e.g. after network restore)
        if (_failedCharts && _failedCharts.length > 0) {
          setTimeout(() => { if (_liveModeActive) _retryFailedCharts(); }, 500);
        }
      }
    }
    document.addEventListener('visibilitychange', _onVisibilityChange);
    // Re-acquire wake lock after fullscreen toggle (Android Chrome releases it)
    function _onFullscreenChange() {
      if (_liveModeActive && !_wakeLock) _requestWakeLock();
    }
    document.addEventListener('fullscreenchange', _onFullscreenChange);
    // Android back button support — push history state so back exits Live Mode
    history.pushState({ liveMode: true }, '');
    function _onPopState() {
      if (_liveModeActive) _exitLiveMode();
    }
    window.addEventListener('popstate', _onPopState);
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

    // CLASSIC 4 FIX: Skip View Transition API for live mode entry.
    // startViewTransition() defers the swap() callback asynchronously, which means
    // the .active class may not be applied when rendering starts (especially with
    // cached PDFs that load almost instantly). Force synchronous swap.
    Store.set('skipViewTransition', true);
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
        <div class="lm-header-row1">
          <button class="lm-jump-btn" aria-label="Song picker"><i data-lucide="list" style="width:18px;height:18px;"></i></button>
          <span class="lm-progress"></span><span id="lm-wake-lock" class="lm-wake-indicator" title="Screen stay awake"><i data-lucide="eye" style="width:10px;height:10px;opacity:0.15;"></i></span>
          <button class="lm-close-btn" aria-label="Exit Live Mode"><i data-lucide="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="lm-header-row2">
          <div class="lm-tools">
            <button class="lm-dark-toggle${_darkMode ? ' active' : ''}" aria-label="Dark mode (D)" aria-pressed="${_darkMode}" title="Dark mode (D)"><i data-lucide="${_darkMode ? 'sun' : 'moon'}" style="width:16px;height:16px;"></i></button>
            <button class="lm-half-toggle${_halfPageMode ? ' active' : ''}" aria-label="Half-page turns (H)" aria-pressed="${_halfPageMode}" title="Half-page turns (H)"><i data-lucide="rows-2" style="width:16px;height:16px;"></i></button>
            <button class="lm-auto-toggle" aria-label="Auto-advance (A)" aria-pressed="false" title="Auto-advance (A)"><i data-lucide="timer" style="width:16px;height:16px;"></i><span class="lm-auto-label">${_autoAdvanceSecs}s</span></button>
          </div>
          <div class="lm-clock-group">
            <span class="lm-clock"></span>
            <button class="lm-timer-btn" aria-label="Start timer"><i data-lucide="play" style="width:10px;height:10px;"></i><span class="lm-timer">Start</span></button>
          </div>
        </div>
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
        <div class="lm-auto-progress"></div>
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
    const autoProgressBar = container.querySelector('.lm-auto-progress');

    // Restore dark mode class on carousel
    if (_darkMode) carousel.classList.add('lm-dark-mode');

    // Wire buttons
    prevBtn.addEventListener('click', () => { if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); } _goPage(-1); });
    nextBtn.addEventListener('click', () => { if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); } _goPage(1); });
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
      if (_isAnimating) return; // prevent jump during slide animation
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

    // -- Feature: Dark Mode Toggle --
    const darkToggleBtn = container.querySelector('.lm-dark-toggle');
    function _toggleDarkMode() {
      _darkMode = !_darkMode;
      carousel.classList.toggle('lm-dark-mode', _darkMode);
      darkToggleBtn.classList.toggle('active', _darkMode);
      darkToggleBtn.setAttribute('aria-pressed', String(_darkMode));
      darkToggleBtn.innerHTML = `<i data-lucide="${_darkMode ? 'sun' : 'moon'}" style="width:18px;height:18px;"></i>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [darkToggleBtn] });
      try { sessionStorage.setItem('bb_live_dark_mode', _darkMode ? '1' : '0'); } catch (_) {}
      haptic.tap();
    }
    darkToggleBtn.addEventListener('click', _toggleDarkMode);

    // -- Feature: Half-Page Turn Toggle --
    const halfToggleBtn = container.querySelector('.lm-half-toggle');
    function _rebuildPagesForHalfMode() {
      const curPage = _pages[currentPageIdx];
      const curSongIdx = curPage ? curPage.songIdx : 0;
      const curPageNum = curPage ? (curPage.pageNum || 1) : 1;
      const curHalf = curPage ? curPage.half : undefined;

      const newPages = [];
      const seen = new Set();
      for (const pg of _pages) {
        if (pg.type === 'chart') {
          const key = `${pg.songIdx}-${pg.pdfDoc ? 'p' : 'x'}-${pg.pageNum}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (_halfPageMode) {
            newPages.push({ ...pg, half: 'top' });
            newPages.push({ ...pg, half: 'bottom' });
          } else {
            const clean = { ...pg };
            delete clean.half;
            newPages.push(clean);
          }
        } else {
          newPages.push(pg);
        }
      }
      _pages = newPages;

      // Restore closest page position
      let bestIdx = 0;
      for (let i = 0; i < _pages.length; i++) {
        if (_pages[i].songIdx === curSongIdx && (_pages[i].pageNum || 0) === curPageNum) {
          bestIdx = i;
          if (!_halfPageMode || _pages[i].half === 'top' || _pages[i].half === curHalf) break;
        }
      }
      currentPageIdx = Math.min(bestIdx, _pages.length - 1);
      _updateSlots();
      _persistPage();
    }

    function _toggleHalfPage() {
      if (_isAnimating) return; // prevent toggle during slide animation — corrupts slot state
      _halfPageMode = !_halfPageMode;
      halfToggleBtn.classList.toggle('active', _halfPageMode);
      halfToggleBtn.setAttribute('aria-pressed', String(_halfPageMode));
      try { sessionStorage.setItem('bb_live_half_page', _halfPageMode ? '1' : '0'); } catch (_) {}
      // B8: reset zoom when entering half-page mode (zoom breaks clipping)
      if (_halfPageMode && _zpHandle) _zpHandle.resetZoom();
      _rebuildPagesForHalfMode();
      haptic.tap();
    }
    halfToggleBtn.addEventListener('click', _toggleHalfPage);

    // -- Feature: Auto-Advance --
    const autoToggleBtn = container.querySelector('.lm-auto-toggle');
    const autoLabel = autoToggleBtn.querySelector('.lm-auto-label');
    let _autoIntervalPickerOpen = false;

    function _startAutoAdvance() {
      _autoAdvance = true;
      _autoAdvanceStart = Date.now();
      autoToggleBtn.classList.add('active');
      autoToggleBtn.setAttribute('aria-pressed', 'true');
      _autoAdvanceTimer = setInterval(() => {
        if (!_isAnimating && currentPageIdx < _pages.length - 1) {
          // B9: set timestamp BEFORE _goPage for atomicity (progress bar stays in sync)
          _autoAdvanceStart = Date.now();
          _goPage(1);
          _updateAutoProgress();
        } else if (currentPageIdx >= _pages.length - 1) {
          _stopAutoAdvance();
        }
      }, _autoAdvanceSecs * 1000);
      _updateAutoProgress();
    }

    function _stopAutoAdvance() {
      _autoAdvance = false;
      _autoAdvanceStart = 0;
      autoToggleBtn.classList.remove('active');
      autoToggleBtn.setAttribute('aria-pressed', 'false');
      if (_autoAdvanceTimer) { clearInterval(_autoAdvanceTimer); _autoAdvanceTimer = null; }
      if (_autoAdvanceRaf) { cancelAnimationFrame(_autoAdvanceRaf); _autoAdvanceRaf = null; }
      if (autoProgressBar) { autoProgressBar.style.width = '0'; }
    }

    function _toggleAutoAdvance() {
      if (_autoAdvance) {
        _stopAutoAdvance();
      } else {
        _startAutoAdvance();
      }
      haptic.tap();
    }

    function _updateAutoProgress() {
      if (!_autoAdvance || !autoProgressBar) return;
      const elapsed = Date.now() - _autoAdvanceStart;
      const total = _autoAdvanceSecs * 1000;
      const pct = Math.min(100, (elapsed / total) * 100);
      autoProgressBar.style.width = pct + '%';
      if (_autoAdvance) {
        _autoAdvanceRaf = requestAnimationFrame(_updateAutoProgress);
      }
    }

    function _setAutoAdvanceInterval(secs) {
      _autoAdvanceSecs = secs;
      if (autoLabel) autoLabel.textContent = secs + 's';
      try { sessionStorage.setItem('bb_live_auto_secs', String(secs)); } catch (_) {}
      if (_autoAdvance) {
        _stopAutoAdvance();
        _startAutoAdvance();
      }
    }

    let _autoPickerDelayTimer = null;
    let _autoPickerClickHandler = null; // B10: explicit handler ref to prevent zombie listeners

    function _showAutoIntervalPicker() {
      if (_autoIntervalPickerOpen) return;
      // B10: remove any orphaned listener from a previous open/close cycle
      if (_autoPickerClickHandler) {
        document.removeEventListener('click', _autoPickerClickHandler);
        _autoPickerClickHandler = null;
      }
      _autoIntervalPickerOpen = true;
      const intervals = [10, 15, 20, 30, 45, 60];
      const pickerEl = document.createElement('div');
      pickerEl.className = 'lm-auto-picker';
      pickerEl.innerHTML = intervals.map(s =>
        `<button class="lm-auto-pick-item${s === _autoAdvanceSecs ? ' active' : ''}" data-secs="${s}">${s}s</button>`
      ).join('');
      container.appendChild(pickerEl);

      pickerEl.addEventListener('click', (e) => {
        const item = e.target.closest('.lm-auto-pick-item');
        if (!item) return;
        const secs = parseInt(item.dataset.secs, 10);
        if (secs > 0) _setAutoAdvanceInterval(secs);
        haptic.tap();
        _closeAutoIntervalPicker();
      });

      // B10: create a new handler ref each time, store it for explicit cleanup
      _autoPickerClickHandler = function _outsideClick(e) {
        const picker = container.querySelector('.lm-auto-picker');
        if (picker && !picker.contains(e.target) && !autoToggleBtn.contains(e.target)) {
          _closeAutoIntervalPicker();
        }
      };

      // Close on outside click (delayed to avoid capturing the open click)
      _autoPickerDelayTimer = setTimeout(() => {
        _autoPickerDelayTimer = null;
        document.addEventListener('click', _autoPickerClickHandler, { once: true });
      }, 50);
    }

    function _closeAutoIntervalPicker() {
      if (_autoPickerDelayTimer) { clearTimeout(_autoPickerDelayTimer); _autoPickerDelayTimer = null; }
      _autoIntervalPickerOpen = false;
      const picker = container.querySelector('.lm-auto-picker');
      if (picker) picker.remove();
      // B10: explicitly remove the tracked handler reference
      if (_autoPickerClickHandler) {
        document.removeEventListener('click', _autoPickerClickHandler);
        _autoPickerClickHandler = null;
      }
    }

    // Tap = toggle, long-press = open interval picker
    let _autoLongPressTimer = null;
    autoToggleBtn.addEventListener('pointerdown', () => {
      _autoLongPressTimer = setTimeout(() => {
        _autoLongPressTimer = null;
        _showAutoIntervalPicker();
      }, 500);
    });
    autoToggleBtn.addEventListener('pointerup', () => {
      if (_autoLongPressTimer) {
        clearTimeout(_autoLongPressTimer);
        _autoLongPressTimer = null;
        _toggleAutoAdvance();
      }
    });
    autoToggleBtn.addEventListener('pointerleave', () => {
      if (_autoLongPressTimer) {
        clearTimeout(_autoLongPressTimer);
        _autoLongPressTimer = null;
      }
    });
    // iOS Safari doesn't fire pointerleave on drag-off — use pointercancel as fallback
    autoToggleBtn.addEventListener('pointercancel', () => {
      if (_autoLongPressTimer) {
        clearTimeout(_autoLongPressTimer);
        _autoLongPressTimer = null;
      }
    });

    // -- Navigation --
    let _lastRenderedSongIdx = -1;
    let _isAnimating = false;
    let _animStartTime = 0; // timestamp when animation started — for stuck detection
    let _renderGen = 0; // B1: generation counter to detect stale renders
    let _queuedDelta = 0; // B1: queued swipe delta during animation
    const _renderErrorSongs = new Set(); // B6: track songs that failed to render (toast once per song)
    const _failedCharts = []; // B7: track failed chart loads for retry

    function _renderPageIntoSlide(slide, pageIdx) {
      const page = _pages[pageIdx];
      const chartArea = slide.querySelector('.lm-slide-chart');
      const canvas = slide.querySelector('.lm-slide-canvas');
      const metaArea = slide.querySelector('.lm-slide-meta');
      const loadArea = slide.querySelector('.lm-slide-loading');

      slide.dataset.pageIdx = pageIdx;
      // B1: stamp render generation for stale-render detection
      const gen = ++_renderGen;
      slide.dataset.renderGen = gen;

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
        // B12: clear canvas before render to avoid stale partial content
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // CLASSIC 4 NUCLEAR FIX: Use window.innerWidth directly as primary width.
        // In Live Mode the carousel is ALWAYS 100% viewport width, so reading
        // clientWidth (which depends on CSS layout being computed, view.active being
        // set, and visibility/opacity tricks) is fragile and the root cause of ALL
        // Classic 4 bugs. window.innerWidth is always valid and always correct here.
        let cw = window.innerWidth;
        // Ultra-paranoid fallback — should never trigger on any device with a screen
        if (cw <= 0) {
          const retry = () => {
            if (parseInt(slide.dataset.renderGen, 10) === gen) {
              _renderPageIntoSlide(slide, pageIdx);
            }
          };
          requestAnimationFrame(retry);
          setTimeout(retry, 200);
          return Promise.resolve();
        }
        // Half-page mode: set alignment class on chart area for top/bottom clipping
        chartArea.classList.remove('half-top', 'half-bottom');
        if (page.half === 'top') chartArea.classList.add('half-top');
        else if (page.half === 'bottom') chartArea.classList.add('half-bottom');
        return PDFViewer.renderToCanvasCached(page.pdfDoc, page.pageNum, canvas, chartArea, cw)
          .then(() => {
            // B1: verify this render is still current (not stale from rapid navigation)
            if (parseInt(slide.dataset.renderGen, 10) !== gen) return;
          })
          .catch(err => {
            console.error('Live mode chart render error', err);
            // B1: don't apply stale error fallback
            if (parseInt(slide.dataset.renderGen, 10) !== gen) return;
            // B6: toast once per song on render failure
            const songKey = page.song?.title || `song-${page.songIdx}`;
            if (!_renderErrorSongs.has(songKey)) {
              _renderErrorSongs.add(songKey);
              showToast(`Chart failed to load: ${page.song?.title || 'Unknown'}`);
            }
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
      // CLASSIC 4 FIX: The old A1 visibility:hidden reflow trick is no longer needed.
      // We now use window.innerWidth directly in _renderPageIntoSlide(), which
      // completely sidesteps the zero-width problem regardless of CSS layout state.
      // Just ensure carousel is positioned correctly.
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

      // 3B: retarget zoom/pan to the new center slide (avoids destroy/create churn)
      _currentChartArea = slots[1].querySelector('.lm-slide-chart');
      _currentCanvas = slots[1].querySelector('.lm-slide-canvas');
      try {
        if (_zpHandle && typeof _zpHandle.retarget === 'function') {
          _zpHandle.retarget(_currentCanvas, _currentChartArea);
        } else {
          throw new Error('retarget unavailable');
        }
      } catch (_) {
        if (_zpHandle) try { _zpHandle.destroy(); } catch (__) {}
        _zpHandle = PDFViewer.attachZoomPan(_currentCanvas, _currentChartArea);
      }

      _updateProgress();
    }

    function _updateProgress() {
      const page = _pages[currentPageIdx];
      if (!page) return;
      const songNum = page.songIdx + 1;
      const totalSongs = _songEntries.length;
      if (page.type === 'chart') {
        const halfLabel = page.half ? (page.half === 'top' ? '\u25B2' : '\u25BC') : '';
        progressEl.textContent = `Song ${songNum}/${totalSongs} \u00b7 Page ${page.pageNum}/${page.totalSongPages}${halfLabel ? ' ' + halfLabel : ''}`;
      } else {
        progressEl.textContent = `Song ${songNum}/${totalSongs}`;
      }
      prevBtn.disabled = currentPageIdx === 0;
      nextBtn.disabled = currentPageIdx === _pages.length - 1;
    }

    function _goPage(delta, animate) {
      // Clear snap-back timer to prevent it from killing our transition
      if (_snapBackTimer) { clearTimeout(_snapBackTimer); _snapBackTimer = null; }
      // B4: deterministic stuck detection — no more unreliable transitionend
      if (_isAnimating && _animStartTime && (Date.now() - _animStartTime > 1000)) {
        console.warn('Live mode: animation stuck, force-clearing');
        _isAnimating = false;
      }
      // B1: if animating, queue the delta for processing after animation completes
      if (_isAnimating) { _queuedDelta = delta; return; }
      if (_zpHandle && _zpHandle.getZoom() > 1.05) _zpHandle.resetZoom();
      const newIdx = currentPageIdx + delta;
      if (newIdx < 0 || newIdx >= _pages.length) return;
      haptic.light();
      // B9: set auto-advance timestamp BEFORE page change for atomicity
      if (_autoAdvance) _autoAdvanceStart = Date.now();

      if (animate === false) {
        currentPageIdx = newIdx;
        _updateSlots();
        _checkSongBoundary();
        _persistPage();
        return;
      }

      // Animated transition using the pre-rendered adjacent slide
      _isAnimating = true;
      _animStartTime = Date.now();
      _queuedDelta = 0; // clear any queued delta
      const targetX = delta > 0 ? '-200%' : '0%'; // slide left or right

      // Set transition first, force reflow, THEN change transform.
      // Without the reflow, some browsers batch both changes and skip the animation.
      // 3A: 150ms transition for near-instant page turns (was 250ms)
      carousel.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1)';
      void carousel.offsetWidth; // force style recalc so transition is registered
      carousel.style.transform = `translateX(${targetX})`;

      function _afterSnap() {
        // B4: prevent double-fire (both transitionend and setTimeout)
        if (!_isAnimating) return;
        carousel.removeEventListener('transitionend', _onTransitionEnd);
        try {
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

          // 3B: retarget zoom/pan to the new center slide (avoids destroy/create churn)
          _currentChartArea = slots[1].querySelector('.lm-slide-chart');
          _currentCanvas = slots[1].querySelector('.lm-slide-canvas');
          try {
            if (_zpHandle && typeof _zpHandle.retarget === 'function') {
              _zpHandle.retarget(_currentCanvas, _currentChartArea);
            } else {
              throw new Error('retarget unavailable');
            }
          } catch (_) {
            if (_zpHandle) try { _zpHandle.destroy(); } catch (__) {}
            _zpHandle = PDFViewer.attachZoomPan(_currentCanvas, _currentChartArea);
          }

          // A3: ALWAYS re-render center slot after page turn — guarantees correctness.
          // The render cache makes this near-instant for already-cached pages.
          _renderPageIntoSlide(slots[1], currentPageIdx);

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
        } finally {
          // ALWAYS clear animation lock, even if recycle/render throws
          _isAnimating = false;
          _animStartTime = 0;
          // B1: process queued swipe delta from rapid navigation
          if (_queuedDelta !== 0) {
            const qd = _queuedDelta;
            _queuedDelta = 0;
            requestAnimationFrame(() => _goPage(qd));
          }
        }
      }

      // B4: use BOTH transitionend AND deterministic timeout.
      // First one to fire wins; _afterSnap guards against double-fire.
      // Filter transitionend by property to avoid premature fire from opacity transitions.
      function _onTransitionEnd(e) {
        if (e.propertyName !== 'transform') return;
        _afterSnap();
      }
      carousel.addEventListener('transitionend', _onTransitionEnd);
      // 350ms = 150ms anim + 200ms margin for slow devices / CPU load
      setTimeout(() => {
        carousel.removeEventListener('transitionend', _onTransitionEnd);
        _afterSnap();
      }, 350);
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
      // B5: show chrome on song boundary transitions
      if (typeof _showChrome === 'function') _showChrome();
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

    async function _loadChartPDF(songIdx, chartDriveId, _retryCount) {
      _retryCount = _retryCount || 0;
      try {
        const blobUrl = await _getBlobUrl(chartDriveId);
        if (!_liveModeActive) return; // exited during load
        // B2: 10-second timeout on PDF load to prevent indefinite hangs
        const loadTask = pdfjsLib.getDocument(blobUrl);
        const pdfDoc = await Promise.race([
          loadTask.promise,
          new Promise((_, reject) => setTimeout(() => {
            try { loadTask.destroy(); } catch (_) {}
            reject(new Error('PDF load timeout (10s)'));
          }, 10000))
        ]);
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
          }).catch(e => console.warn('Splice lock error', e));
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
            if (_halfPageMode) {
              chartPages.push({ type: 'chart', songIdx, song, pdfDoc, pageNum: p, half: 'top', totalSongPages: numPages });
              chartPages.push({ type: 'chart', songIdx, song, pdfDoc, pageNum: p, half: 'bottom', totalSongPages: numPages });
            } else {
              chartPages.push({ type: 'chart', songIdx, song, pdfDoc, pageNum: p, totalSongPages: numPages });
            }
          }

          const wasBeforeCurrent = placeholderIdx < currentPageIdx;
          const wasAtCurrent = placeholderIdx === currentPageIdx;

          _pages.splice(placeholderIdx, 1, ...chartPages);

          // Pre-render first chart page for this song
          const cw = window.innerWidth;
          if (cw > 0) {
            PDFViewer.preRenderPage(pdfDoc, 1, cw).catch(() => {});
          }

          if (wasBeforeCurrent) {
            currentPageIdx += (chartPages.length - 1);
          }

          if (wasAtCurrent) {
            // Don't reset carousel mid-animation — defer until animation completes
            if (_isAnimating) {
              const _checkAfterAnim = setInterval(() => {
                if (!_liveModeActive) { clearInterval(_checkAfterAnim); return; }
                if (!_isAnimating) {
                  clearInterval(_checkAfterAnim);
                  if (!_liveModeActive) return; // double-check after clearing interval
                  _updateSlots();
                }
              }, 50);
              // Safety: clear after 2s no matter what
              setTimeout(() => clearInterval(_checkAfterAnim), 2000);
            } else {
              _updateSlots();
            }
          }
        }).catch(e => console.warn('Splice lock error', e));
      } catch (err) {
        console.error('Failed to load chart for song', songIdx, err);
        // B2: retry once on network/timeout errors (not corrupt PDF)
        const isNetworkError = err.message && (err.message.includes('timeout') || err.message.includes('fetch') || err.message.includes('network') || err.message.includes('NetworkError'));
        if (_retryCount < 1 && isNetworkError && _liveModeActive) {
          console.warn('Live mode: retrying chart load for song', songIdx);
          return _loadChartPDF(songIdx, chartDriveId, _retryCount + 1);
        }
        // B7: track failed charts for later retry
        _failedCharts.push({ songIdx, chartDriveId });
        // B2: toast on failure
        const songName = _songEntries[songIdx]?.title || `Song ${songIdx + 1}`;
        showToast(`Chart failed to load: ${songName}`);
        _spliceLock = _spliceLock.then(() => {
          const idx = _pages.findIndex(p => p.songIdx === songIdx && p.type === 'loading' && p.chartDriveId === chartDriveId);
          if (idx !== -1) {
            const song = _pages[idx].song;
            _pages[idx] = { type: 'metadata', songIdx, song };
            if (idx === currentPageIdx) _updateSlots();
          }
        }).catch(e => console.warn('Splice lock error', e));
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
      // Clean up inline opacity styles after fade-in.
      // IMPORTANT: Do NOT reset carousel.style.transition here — _goPage may
      // have started a slide animation during the 300ms window, and overwriting
      // the transition kills it (transitionend never fires, _isAnimating sticks).
      setTimeout(() => {
        _lmHeader.style.removeProperty('transition');
        _lmHeader.style.removeProperty('opacity');
        _lmNav.style.removeProperty('transition');
        _lmNav.style.removeProperty('opacity');
        // Only clean carousel opacity — carousel transition is managed by
        // _updateSlots() and _goPage(), which set it to 'none' / 'transform ...'
        // as needed. Removing it here is safe; setting it to 'none' is not.
        _lmCarousel.style.removeProperty('transition');
        _lmCarousel.style.removeProperty('opacity');
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

    // 3C: Priority-queue PDF loading — current song first, then adjacent, then rest.
    // This ensures _revealLiveMode fires as soon as the current song is ready,
    // not blocked by a distant song's large PDF.
    const _currentSongIdx = _pages[currentPageIdx]?.songIdx ?? 0;
    const _p0 = []; // P0: current song (load immediately, await before reveal)
    const _p1 = []; // P1: adjacent songs (±3)
    const _p2 = []; // P2: remaining songs (load during idle)
    for (let si = 0; si < _songEntries.length; si++) {
      const dist = Math.abs(si - _currentSongIdx);
      const orderedCharts = _getOrderedCharts(_songEntries[si]);
      orderedCharts.forEach(chart => {
        const entry = { si, driveId: chart.driveId };
        if (dist === 0) _p0.push(entry);
        else if (dist <= 3) _p1.push(entry);
        else _p2.push(entry);
      });
    }
    // Sort P1 by proximity
    _p1.sort((a, b) => Math.abs(a.si - _currentSongIdx) - Math.abs(b.si - _currentSongIdx));

    const _trackLoad = (entry) => _loadChartPDF(entry.si, entry.driveId).then(() => {
      _loadedCharts++;
      _updateLoadingProgress();
    });

    // Load P0 first (await all), then P1 in parallel, then P2 in parallel.
    // _allChartsLoaded rejects if live mode exits during loading (prevents post-exit work).
    const _allChartsLoaded = (async () => {
      await Promise.all(_p0.map(_trackLoad)).catch(() => {});
      if (!_liveModeActive) throw new Error('exited');
      await Promise.all(_p1.map(_trackLoad)).catch(() => {});
      if (!_liveModeActive) throw new Error('exited');
      await Promise.all(_p2.map(_trackLoad)).catch(() => {});
    })();

    // After all charts load, pre-render every page for instant swiping
    _allChartsLoaded.then(async () => {
      if (!_liveModeActive) return;
      const cw = window.innerWidth;
      if (cw <= 0) return;
      // Collect unique chart pages to pre-render
      const toRender = [];
      const seenKeys = new Set();
      for (let pi = 0; pi < _pages.length; pi++) {
        const pg = _pages[pi];
        if (pg.type !== 'chart' || !pg.pdfDoc) continue;
        const key = (pg.pdfDoc.fingerprints?.[0] || pg.pdfDoc._transport?.docId || String(Math.random())) + '-' + pg.pageNum;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          toRender.push({ pg, dist: Math.abs(pi - currentPageIdx) });
        }
      }
      // B11: sort by proximity to current page (nearest pages render first)
      toRender.sort((a, b) => a.dist - b.dist);
      // Limit pre-renders on low-memory devices to avoid OOM
      const mem = navigator.deviceMemory || 4;
      const batchSize = mem <= 2 ? 2 : 4;
      const maxPreRender = mem <= 2 ? 8 : toRender.length;
      const limited = toRender.slice(0, maxPreRender);
      // Batch pre-renders to avoid memory spikes
      for (let i = 0; i < limited.length; i += batchSize) {
        if (!_liveModeActive) return;
        await Promise.all(limited.slice(i, i + batchSize).map(item =>
          PDFViewer.preRenderPage(item.pg.pdfDoc, item.pg.pageNum, cw).catch(() => {})
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
      // Stop auto-advance
      _stopAutoAdvance();
      // Close interval picker if open
      _closeAutoIntervalPicker();
      // B5: clear auto-hide chrome timer
      if (_chromeHideTimer) { clearTimeout(_chromeHideTimer); _chromeHideTimer = null; }
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
      carousel.removeEventListener('touchstart', _onInteraction);
      carousel.removeEventListener('mousedown', _onInteraction);
      carousel.removeEventListener('click', _onClickTapZone);
      document.removeEventListener('fullscreenchange', _onFullscreenChange);
      window.removeEventListener('popstate', _onPopState);
      window.removeEventListener('resize', _onResize);
      if (_resizeTimer) { clearTimeout(_resizeTimer); _resizeTimer = null; }
      if (_snapBackTimer) { clearTimeout(_snapBackTimer); _snapBackTimer = null; }
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
      // Don't capture shortcuts when typing in an input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      // Close jump picker on any navigation key
      if (!jumpOverlay.classList.contains('hidden')) _closeJumpPicker();
      // 4C: Enter/Backspace added for BT page turner compatibility
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); } // reset timer on manual nav
        _goPage(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Backspace') {
        e.preventDefault();
        if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); }
        _goPage(-1);
      } else if (e.key === 'Escape') {
        if (_autoIntervalPickerOpen) {
          _closeAutoIntervalPicker();
        } else if (!jumpOverlay.classList.contains('hidden')) {
          _closeJumpPicker();
        } else {
          _exitLiveMode();
        }
      } else if (e.key === 'd' || e.key === 'D') {
        _toggleDarkMode();
      } else if (e.key === 'h' || e.key === 'H') {
        _toggleHalfPage();
      } else if (e.key === 'a' || e.key === 'A') {
        _toggleAutoAdvance();
      } else if (e.key === '+' || e.key === '=') {
        // Increase auto-advance interval
        const next = Math.min(120, _autoAdvanceSecs + 5);
        _setAutoAdvanceInterval(next);
      } else if (e.key === '-' || e.key === '_') {
        // Decrease auto-advance interval
        const next = Math.max(5, _autoAdvanceSecs - 5);
        _setAutoAdvanceInterval(next);
      } else if (e.key === 'c' || e.key === 'C') {
        // B5: toggle chrome visibility
        _toggleChrome();
      } else if (e.key === 'r' || e.key === 'R') {
        // B7: retry failed chart loads
        _retryFailedCharts();
      }
    }
    document.addEventListener('keydown', _onKey);

    // -- Orientation/resize handler — re-render on viewport change --
    let _resizeTimer = null;
    function _onResize() {
      if (!_liveModeActive || _isAnimating) return;
      // Debounce to avoid thrashing during resize drag or orientation animation
      if (_resizeTimer) clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        _resizeTimer = null;
        if (!_liveModeActive) return;
        // Clear render cache (dimensions changed) and re-render visible slots
        PDFViewer.clearRenderCache();
        _updateSlots();
      }, 300);
    }
    window.addEventListener('resize', _onResize);

    // -- B5: Auto-hide chrome (header + nav fade after 4s of no interaction) --
    let _chromeHideTimer = null;
    let _chromeHidden = false;
    const _chromeElements = [_lmHeader, _lmNav]; // elements to auto-hide

    function _showChrome() {
      if (_chromeHidden) {
        _chromeHidden = false;
        _chromeElements.forEach(el => {
          el.style.opacity = '1';
          el.style.pointerEvents = '';
        });
      }
      _resetChromeTimer();
    }

    function _hideChrome() {
      _chromeHidden = true;
      _chromeElements.forEach(el => {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      });
    }

    function _resetChromeTimer() {
      if (_chromeHideTimer) clearTimeout(_chromeHideTimer);
      _chromeHideTimer = setTimeout(_hideChrome, 4000);
    }

    function _toggleChrome() {
      if (_chromeHidden) _showChrome(); else _hideChrome();
    }

    // Show chrome on any touch/mouse/key interaction
    function _onInteraction() { _showChrome(); }
    carousel.addEventListener('touchstart', _onInteraction, { passive: true });
    carousel.addEventListener('mousedown', _onInteraction, { passive: true });
    // 'C' key or center-tap toggles chrome (handled in _onKey for 'C', tap zones for center)
    // Start the auto-hide timer
    _resetChromeTimer();

    // -- B7: Offline recovery — retry failed charts on visibility change or 'R' key --
    function _retryFailedCharts() {
      if (_failedCharts.length === 0) return;
      showToast(`Retrying ${_failedCharts.length} failed chart(s)\u2026`);
      const toRetry = _failedCharts.splice(0);
      toRetry.forEach(({ songIdx, chartDriveId }) => {
        _loadChartPDF(songIdx, chartDriveId);
      });
    }

    // -- Carousel swipe navigation (drag-follow + snap) --
    let _dragX0 = 0, _dragY0 = 0, _dragging = false, _dragLocked = false, _edgeBuzzed = false;
    let _snapBackTimer = null; // track snap-back transition cleanup timer
    const SWIPE_THRESHOLD = Math.max(40, Math.min(60, window.innerWidth * 0.15));

    function _onDragStart(e) {
      if (_isAnimating) return;
      // If zoomed, let zoom/pan handle the touch
      if (_zpHandle && _zpHandle.getZoom() > 1.05) return;
      // Clear any pending snap-back timer to prevent it from killing our transition
      if (_snapBackTimer) { clearTimeout(_snapBackTimer); _snapBackTimer = null; carousel.style.transition = 'none'; }
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

      // CLASSIC 4 FIX: Use window.innerWidth directly — same reasoning as render fix.
      // carousel.clientWidth can be 0 if layout hasn't computed, producing NaN transforms.
      const slideWidth = window.innerWidth;
      if (slideWidth <= 0) return;
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
          if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); } // reset timer
          _goPage(delta);
          return;
        }
      }

      // Snap back — use tracked timer so next drag can cancel it
      if (_snapBackTimer) { clearTimeout(_snapBackTimer); _snapBackTimer = null; }
      carousel.style.transition = 'transform 0.2s ease-out';
      carousel.style.transform = 'translateX(-100%)';
      _snapBackTimer = setTimeout(() => { _snapBackTimer = null; carousel.style.transition = ''; }, 250);
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

      // Reset auto-advance timer on manual tap navigation
      if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); }

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

    // -- Desktop click tap zones (mouse users have no touchstart/touchend) --
    let _lastTouchEnd = 0;
    function _onClickTapZone(e) {
      // Suppress click events that fire right after touchend (prevent double-fire on touch devices)
      if (Date.now() - _lastTouchEnd < 400) return;
      if (_isAnimating) return;
      if (_zpHandle && _zpHandle.getZoom() > 1.05) return;
      const page = _pages[currentPageIdx];
      if (!page || page.type !== 'chart') return;
      // Don't trigger on button/control clicks
      if (e.target.closest('button, .lm-nav, .lm-header, .lm-jump-overlay')) return;

      const currentChartArea = slots[1].querySelector('.lm-slide-chart');
      const rect = currentChartArea.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;

      if (_autoAdvance) { _stopAutoAdvance(); _startAutoAdvance(); }

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
    // Track last touchend to suppress duplicate click
    carousel.addEventListener('touchend', () => { _lastTouchEnd = Date.now(); }, { passive: true });
    carousel.addEventListener('click', _onClickTapZone);

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

  // ─── FREETEXT SONG EDIT MODAL ──────────────────────────────────

  function _showFreetextEditModal(entry, onSave) {
    const triggerEl = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ft-modal-title');
    overlay.innerHTML = `
      <div class="modal">
        <h2 id="ft-modal-title">Edit Freetext Song</h2>
        <div class="form-field">
          <label class="form-label" for="ft-title">Title</label>
          <input class="form-input" id="ft-title" type="text" value="${esc(entry.title || '')}" placeholder="e.g. Brown Eyed Girl - cover in Amaj" maxlength="300" />
        </div>
        <div class="form-field">
          <label class="form-label" for="ft-key">Key <span class="muted" style="font-weight:400">(optional)</span></label>
          <input class="form-input" id="ft-key" type="text" value="${esc(entry.key || '')}" placeholder="e.g. A, Bbm, G" maxlength="20" />
        </div>
        <div class="form-field">
          <label class="form-label" for="ft-bpm">BPM <span class="muted" style="font-weight:400">(optional)</span></label>
          <input class="form-input" id="ft-bpm" type="number" value="${entry.bpm || ''}" placeholder="e.g. 120" min="20" max="400" />
        </div>
        <div class="form-field">
          <label class="form-label" for="ft-notes">Notes <span class="muted" style="font-weight:400">(optional)</span></label>
          <textarea class="form-input" id="ft-notes" rows="3" placeholder="Chord changes, arrangement notes…" maxlength="2000">${esc(entry.notes || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="ft-cancel">Cancel</button>
          <button class="btn-primary" id="ft-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const titleInput = overlay.querySelector('#ft-title');
    titleInput.focus();

    function _closeModal() {
      if (document.activeElement) document.activeElement.blur();
      overlay.remove();
      if (triggerEl && triggerEl.isConnected) triggerEl.focus();
    }

    overlay.querySelector('#ft-save').addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) { showToast('Title is required.'); titleInput.focus(); return; }
      entry.title = title;
      entry.key = overlay.querySelector('#ft-key').value.trim();
      const bpmVal = parseInt(overlay.querySelector('#ft-bpm').value, 10);
      entry.bpm = (bpmVal > 0 && bpmVal <= 400) ? bpmVal : '';
      entry.notes = overlay.querySelector('#ft-notes').value.trim();
      _closeModal();
      if (onSave) onSave();
    });

    overlay.querySelector('#ft-cancel').addEventListener('click', _closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeModal();
    });

    // Escape key closes modal
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); _closeModal(); return; }
      // Focus trap: Tab wraps between first and last focusable elements
      if (e.key === 'Tab') {
        const focusable = overlay.querySelectorAll('input, textarea, button');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
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
        <div class="setlist-empty-msg ${sl.songs.length ? 'hidden' : ''}" id="slf-empty-msg">No songs added yet. Use the picker below or add a freetext song.</div>
        <button class="btn-ghost slf-add-freetext" id="slf-add-freetext" style="margin-top:8px;font-size:13px;">
          <i data-lucide="text-cursor-input" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Add Freetext Song
        </button>
      </div>

      <div class="edit-section">
        <div class="edit-section-title">Add Songs from Library</div>
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
        if (entry.freetext) {
          const ftTitle = esc(entry.title || 'Untitled freetext');
          const ftMeta = [entry.key, entry.bpm ? entry.bpm + ' bpm' : ''].filter(Boolean).join(' \u00b7 ');
          return `
            <div class="setlist-edit-row setlist-edit-freetext" data-idx="${i}">
              <div class="drag-handle"><i data-lucide="grip-vertical" style="width:16px;height:16px;"></i></div>
              <span class="setlist-song-num">${i + 1}</span>
              <div class="setlist-edit-row-info">
                <div class="setlist-edit-row-header">
                  <span class="setlist-edit-row-title">${ftTitle}</span>
                  ${ftMeta ? `<span class="setlist-edit-row-key">${esc(ftMeta)}</span>` : ''}
                </div>
                ${entry.notes ? `<div class="setlist-edit-row-notes muted" style="font-size:12px;margin-top:2px;">${esc(entry.notes)}</div>` : ''}
                <div class="setlist-edit-comment-wrap">
                  <input class="form-input setlist-comment-input" type="text"
                    value="${esc(entry.comment || '')}" placeholder="Add note\u2026"
                    maxlength="300" data-comment-idx="${i}" />
                </div>
              </div>
              <div class="setlist-edit-row-actions">
                <button class="icon-btn sl-ft-edit" data-idx="${i}" aria-label="Edit freetext song" title="Edit"><i data-lucide="pencil" style="width:14px;height:14px;"></i></button>
                <button class="icon-btn sl-remove" data-idx="${i}" style="color:var(--red)" aria-label="Remove song"><i data-lucide="x"></i></button>
              </div>
            </div>`;
        }
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
      // Wire freetext edit buttons
      container.querySelectorAll('.sl-ft-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const entry = sl.songs[idx];
          if (!entry || !entry.freetext) return;
          _showFreetextEditModal(entry, () => {
            _renderSelectedSongs();
          });
        });
      });
    }

    function _renderPicker() {
      const search = (document.getElementById('slf-picker-search')?.value || '').toLowerCase();
      const selectedIds = new Set(sl.songs.filter(e => !e.freetext).map(e => e.id));
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

    // Wire "Add Freetext Song" button
    document.getElementById('slf-add-freetext').addEventListener('click', () => {
      const newFt = {
        id: 'ft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        freetext: true,
        title: '',
        key: '',
        bpm: '',
        notes: '',
        comment: '',
      };
      _showFreetextEditModal(newFt, () => {
        sl.songs.push(newFt);
        _renderSelectedSongs();
        _renderPicker();
      });
    });

    // Save
    document.getElementById('slf-save').addEventListener('click', async () => {
      if (_savingSetlists) return;
      if (_sortableSetlist) { try { _sortableSetlist.destroy(); } catch(_){} _sortableSetlist = null; }
      sl.name = document.getElementById('slf-name').value.trim();
      if (!sl.name) { showToast('Name is required.'); document.getElementById('slf-name').focus(); return; }
      const emptyFt = sl.songs.find(e => e.freetext && !(e.title || '').trim());
      if (emptyFt) { showToast('All freetext songs need a title.'); return; }
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
      if (_sortableSetlist) { try { _sortableSetlist.destroy(); } catch(_){} _sortableSetlist = null; }
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
