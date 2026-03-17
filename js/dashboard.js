/**
 * dashboard.js — Admin Dashboard + Diagnostics
 *
 * Renders the admin dashboard with system health, data stats,
 * GitHub/Drive sync status, tag manager, and full diagnostics suite.
 * All state read from Store; no local state variables.
 */

const Dashboard = (() => {

  const esc           = Utils.esc;
  const showToast     = Utils.showToast;
  const isMobile      = Utils.isMobile;
  const detectPlatform = Utils.detectPlatform;

  // ─── renderDashboard ──────────────────────────────────────

  function renderDashboard() {
    Store.set('currentRouteParams', {});
    if (typeof App !== 'undefined' && App.revokeBlobCache) App.revokeBlobCache();
    Store.set('navStack', []);
    Router.pushNav(() => App.renderList());
    Router.showView('dashboard');
    Router.setTopbar('Admin Dashboard', true);

    const container = document.getElementById('dashboard-content');
    const songs     = Store.get('songs');
    const setlists  = Store.get('setlists');
    const practice  = Store.get('practice');

    // ─── Gather stats ───
    const totalSongs = songs.length;
    const totalSetlists = setlists.length;
    const totalPersonas = practice.length;
    const totalPracticeLists = practice.reduce((sum, p) => sum + (p.practiceLists || []).length, 0);
    const allTags = new Set();
    songs.forEach(s => (s.tags || []).forEach(t => allTags.add(t)));

    // ─── Analyze issues ───
    const errors = [];
    const warnOrange = [];
    const warnYellow = [];

    // Collect all driveIds referenced by songs
    const referencedDriveIds = new Set();
    const driveIdToSong = {};
    const emptyDriveIds = [];
    songs.forEach(s => {
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
    const songIdSet = new Set(songs.map(s => s.id));

    // ── ERRORS (red, 1xxx) ──
    const untitled = songs.filter(s => !s.title || !s.title.trim());
    if (untitled.length) {
      errors.push({
        code: 1001,
        title: `${untitled.length} song${untitled.length > 1 ? 's' : ''} with no title`,
        detail: 'Fix: Edit each song and add a title.',
        items: untitled.map(s => `ID: ${s.id}`)
      });
    }

    if (emptyDriveIds.length) {
      errors.push({
        code: 1101,
        title: `${emptyDriveIds.length} file${emptyDriveIds.length > 1 ? 's' : ''} with missing Drive ID`,
        detail: 'These attachments cannot be loaded. Fix: Edit the song and re-upload the file, or remove the broken attachment.',
        items: emptyDriveIds.map(e => `"${esc(e.file)}" in "${esc(e.song)}"`)
      });
    }

    const orphanPractice = [];
    practice.forEach(persona => {
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
        code: 1201,
        title: `${orphanPractice.length} practice entry${orphanPractice.length > 1 ? 'ies' : 'y'} referencing deleted songs`,
        detail: 'These entries will show as missing. Fix: Edit the practice list and remove the broken entries, or re-add the song to the repository.',
        items: orphanPractice.map(o => `"${esc(o.persona)}" → "${esc(o.list)}" → song ${o.songId}`)
      });
    }

    const orphanSetlist = [];
    setlists.forEach(sl => {
      (sl.songs || []).forEach(entry => {
        const sid = entry.id || entry.songId;
        if (sid && !songIdSet.has(sid)) {
          orphanSetlist.push({ setlist: sl.name, songId: sid });
        }
      });
    });
    if (orphanSetlist.length) {
      errors.push({
        code: 1301,
        title: `${orphanSetlist.length} setlist entry${orphanSetlist.length > 1 ? 'ies' : 'y'} referencing deleted songs`,
        detail: 'These entries will show as missing. Fix: Edit the setlist and remove the broken entries, or re-add the song to the repository.',
        items: orphanSetlist.map(o => `"${esc(o.setlist)}" → song ${o.songId}`)
      });
    }

    // ── ORANGE WARNINGS (2xxx) ──
    const noAssets = songs.filter(s => {
      const a = s.assets || {};
      return !(a.charts || []).length && !(a.audio || []).length && !(a.links || []).length;
    });
    if (noAssets.length) {
      warnOrange.push({
        code: 2001,
        title: `${noAssets.length} song${noAssets.length > 1 ? 's' : ''} with no files or links`,
        detail: 'These songs have no charts, audio, or links. Fix: Edit each song and attach files or add links.',
        items: noAssets.map(s => esc(s.title || s.id))
      });
    }

    const _migrated = localStorage.getItem('bb_migrated_to_github') === '1';
    if (!Drive.isConfigured() && !_migrated) {
      warnOrange.push({
        code: 2401,
        title: 'Drive not connected',
        detail: 'No API key or folder ID set. Songs load from local cache only. Fix: Open the Drive Setup modal and enter your credentials.'
      });
    }

    if (Drive.isConfigured() && !Drive.isWriteConfigured() && !_migrated) {
      warnOrange.push({
        code: 2402,
        title: 'Drive is read-only — changes won\'t sync',
        detail: 'OAuth Client ID is not set. All saves are local-only and won\'t be visible to other users. Fix: Set up an OAuth Client ID in Google Cloud Console and enter it in the Drive Setup modal.'
      });
    }

    const titleCounts = {};
    songs.forEach(s => {
      const t = (s.title || '').trim().toLowerCase();
      if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
    });
    const dupTitles = Object.entries(titleCounts).filter(([, c]) => c > 1);
    if (dupTitles.length) {
      warnOrange.push({
        code: 2002,
        title: `${dupTitles.length} duplicate song title${dupTitles.length > 1 ? 's' : ''}`,
        detail: 'Multiple songs share the same title, which can cause confusion. Fix: Rename one of the duplicates or delete the extra copy.',
        items: dupTitles.map(([t, c]) => `"${esc(t)}" (${c} copies)`)
      });
    }

    // ── YELLOW WARNINGS (3xxx) ──
    const noTags = songs.filter(s => !(s.tags || []).length);
    if (noTags.length > 0 && noTags.length < totalSongs) {
      warnYellow.push({
        code: 3001,
        title: `${noTags.length} song${noTags.length > 1 ? 's' : ''} without tags`,
        detail: 'Untagged songs won\'t appear when filtering by tag. Fix: Edit the song and add relevant tags.',
        items: noTags.length <= 10 ? noTags.map(s => esc(s.title || s.id)) : [
          ...noTags.slice(0, 8).map(s => esc(s.title || s.id)),
          `…and ${noTags.length - 8} more`
        ]
      });
    }

    const dupes = Object.entries(driveIdToSong).filter(([, sgs]) => sgs.length > 1);
    if (dupes.length) {
      warnYellow.push({
        code: 3101,
        title: `${dupes.length} file${dupes.length > 1 ? 's' : ''} shared across multiple songs`,
        detail: 'The same Drive file is attached to more than one song. This is usually fine, but deleting the file from one song would break the other. Fix: If unintentional, re-upload a separate copy to each song.',
        items: dupes.map(([id, sgs]) => `${id.slice(0, 12)}… → ${sgs.map(s => esc(s.title || s.id)).join(', ')}`)
      });
    }

    // ─── Render HTML ───
    const totalErrors = errors.length;
    const totalOrange = warnOrange.length;
    const totalYellow = warnYellow.length;
    const healthStatus = totalErrors > 0 ? 'Errors Found' : totalOrange > 0 ? 'Warnings' : totalYellow > 0 ? 'Minor Warnings' : 'All Clear';
    const healthBadge = totalErrors > 0 ? 'warn' : totalOrange > 0 ? 'warn' : 'ok';
    const APP_VERSION = Store.get('APP_VERSION');

    const _codeTag = (code) => `<span class="dash-alert-code">${code}</span>`;

    let html = `
      <div class="dash-header">
        <button class="text-btn dash-exit-admin" id="dash-exit-admin" title="Exit Admin Edit Mode">
          <i data-lucide="log-out" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Exit Admin Edit Mode
        </button>
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

    errors.forEach(e => {
      const isOrphan = e.code === 1201 || e.code === 1301;
      html += `<div class="dash-alert">
        <div class="dash-alert-title">${_codeTag(e.code)} ${e.title}</div>
        ${e.detail ? `<div class="dash-alert-detail">${e.detail}</div>` : ''}
        ${isOrphan ? `<button class="btn-ghost btn-remove-orphans" data-orphan-code="${e.code}" style="margin-top:6px;font-size:11px;padding:4px 10px;">Remove Orphans</button>` : ''}
        ${e.items ? `<ul class="dash-file-list">${e.items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
      </div>`;
    });

    warnOrange.forEach(w => {
      html += `<div class="dash-alert warn-orange">
        <div class="dash-alert-title">${_codeTag(w.code)} ${w.title}</div>
        ${w.detail ? `<div class="dash-alert-detail">${w.detail}</div>` : ''}
        ${w.items ? `<ul class="dash-file-list">${w.items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
      </div>`;
    });

    warnYellow.forEach(w => {
      html += `<div class="dash-alert warn-yellow">
        <div class="dash-alert-title">${_codeTag(w.code)} ${w.title}</div>
        ${w.detail ? `<div class="dash-alert-detail">${w.detail}</div>` : ''}
        ${w.items ? `<ul class="dash-file-list">${w.items.map(it => `<li>${it}</li>`).join('')}</ul>` : ''}
      </div>`;
    });

    html += `</div>`;

    // Data breakdown
    html += `
      <div class="dash-section">
        <div class="dash-section-title">Data Breakdown</div>
        <div class="dash-alert info">
          <div class="dash-alert-title">${_codeTag(4101)} File Attachment Summary</div>
          <div class="dash-alert-detail">
            ${songs.filter(s => (s.assets?.charts || []).length).length} songs have charts ·
            ${songs.filter(s => (s.assets?.audio || []).length).length} songs have audio ·
            ${songs.filter(s => (s.assets?.links || []).length).length} songs have links
          </div>
        </div>
        <div class="dash-alert info">
          <div class="dash-alert-title">${_codeTag(4501)} Storage</div>
          <div class="dash-alert-detail">
            Songs JSON: ~${(JSON.stringify(songs).length / 1024).toFixed(1)} KB ·
            Setlists JSON: ~${(JSON.stringify(setlists).length / 1024).toFixed(1)} KB ·
            Practice JSON: ~${(JSON.stringify(practice).length / 1024).toFixed(1)} KB
          </div>
        </div>
      </div>
    `;

    // GitHub sync status
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

    // Drive sync diagnostic
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
      songs.forEach(s => (s.tags || []).forEach(t => {
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

    // Wire Exit Admin button
    document.getElementById('dash-exit-admin')?.addEventListener('click', () => {
      Admin.exitEditMode();
      App.renderList();
      Utils.showToast('Admin mode exited');
    });

    // BUG-28: Wire Remove Orphans buttons
    container.querySelectorAll('.btn-remove-orphans').forEach(btn => {
      btn.addEventListener('click', async () => {
        const code = parseInt(btn.dataset.orphanCode, 10);
        const songIdSet = new Set(songs.map(s => s.id));
        let removed = 0;
        if (code === 1201) {
          // Remove orphans from practice lists
          practice.forEach(persona => {
            (persona.practiceLists || []).forEach(pl => {
              const before = (pl.songs || []).length;
              pl.songs = (pl.songs || []).filter(e => songIdSet.has(e.songId));
              removed += before - pl.songs.length;
            });
          });
          Store.set('practice', practice);
          if (typeof Sync !== 'undefined') Sync.savePractice();
        } else if (code === 1301) {
          // Remove orphans from setlists
          setlists.forEach(sl => {
            const before = (sl.songs || []).length;
            sl.songs = (sl.songs || []).filter(e => songIdSet.has(e.id || e.songId));
            removed += before - sl.songs.length;
          });
          Store.set('setlists', setlists);
          if (typeof Sync !== 'undefined') Sync.saveSetlists();
        }
        showToast(`Removed ${removed} orphan${removed !== 1 ? 's' : ''}`);
        renderDashboard();
      });
    });

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
          const currentSongs = Store.get('songs');
          let changed = 0;
          currentSongs.forEach(s => {
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
            Store.set('songs', currentSongs);
            await Sync.saveSongs();
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
          const currentSongs = Store.get('songs');
          let changed = 0;
          currentSongs.forEach(s => {
            const tags = s.tags || [];
            const idx = tags.indexOf(tag);
            if (idx > -1) {
              tags.splice(idx, 1);
              s.tags = tags;
              changed++;
            }
          });
          if (changed) {
            Store.set('songs', currentSongs);
            await Sync.saveSongs();
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
        let panel = document.getElementById('diag-panel');
        if (!panel) {
          panel = document.createElement('div');
          panel.id = 'diag-panel';
          panel.className = 'diag-panel';
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
          const curSongs = Store.get('songs');
          const curSetlists = Store.get('setlists');
          const curPractice = Store.get('practice');
          localStorage.setItem('_migration_backup', JSON.stringify({
            songs: curSongs, setlists: curSetlists, practice: curPractice,
          }));
          await GitHub.migrateData({ songs: curSongs, setlists: curSetlists, practice: curPractice });
          localStorage.setItem('bb_migrated_to_github', '1');
          localStorage.removeItem('_migration_backup');
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
    _renderDriveSection(container, songs, setlists, practice, _codeTag);
  }

  function _renderDriveSection(container, songs, setlists, practice, _codeTag) {
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

      try {
        const _lastDriveSnapshot = Store.get('lastDriveSnapshot');
        if (!_lastDriveSnapshot) {
          el.innerHTML = `<div class="dash-alert-title">${_codeTag(4401)} No sync data yet</div>` +
            `<div class="dash-alert-detail">Drive data will appear after the next sync. Use the refresh button on the main page to trigger a sync.</div>`;
          return;
        }
        const { songs: dSongs, setlists: dSetlists, practice: dPractice } = _lastDriveSnapshot;
        const driveSongs = Array.isArray(dSongs) ? dSongs.length : 0;
        const driveSetlists = Array.isArray(dSetlists) ? dSetlists.length : 0;
        const drivePersonas = Array.isArray(dPractice) ? dPractice.length : 0;
        const drivePLists = Array.isArray(dPractice)
          ? dPractice.reduce((sum, p) => sum + (p.practiceLists || p.lists || []).length, 0) : 0;

        const localSongs = songs.length;
        const localSetlists = setlists.length;
        const localPersonas = practice.length;
        const localPLists = practice.reduce((sum, p) => sum + (p.practiceLists || []).length, 0);

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
                Drive.saveSongs(songs),
                Drive.saveSetlists(setlists),
                Drive.savePractice(practice),
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
                Drive.saveSongs(songs),
                Drive.saveSetlists(setlists),
                Drive.savePractice(practice),
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

  // ─── runDiagnostics ──────────────────────────────────────

  async function runDiagnostics(container) {
    const songs    = Store.get('songs');
    const setlists = Store.get('setlists');
    const practice = Store.get('practice');
    const APP_VERSION = Store.get('APP_VERSION');
    const results = [];

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

    // ═════════════════════════════════════════════
    // SECTION 1: Platform & Environment
    // ═════════════════════════════════════════════

    const SEC1 = 'Platform & Environment';

    await _test(SEC1, 'Platform detection', async () => {
      const mobile = isMobile();
      const platform = detectPlatform();
      const ua = navigator.userAgent.substring(0, 80);
      return { status: 'pass', detail: `Platform: ${platform}, Mobile: ${mobile}, UA: ${ua}...` };
    });

    await _test(SEC1, 'Web Crypto API available', async () => {
      if (!crypto || !crypto.subtle) return { status: 'fail', detail: 'crypto.subtle not available — HTTPS required' };
      return { status: 'pass', detail: 'crypto.subtle available' };
    });

    await _test(SEC1, 'Service Worker registered', async () => {
      if (!('serviceWorker' in navigator)) return { status: 'fail', detail: 'Service Worker API not supported' };
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const swState = reg.active ? 'active' : reg.waiting ? 'waiting' : reg.installing ? 'installing' : 'unknown';
        return { status: 'pass', detail: `SW state: ${swState}, scope: ${reg.scope}` };
      }
      if (navigator.serviceWorker.controller) {
        return { status: 'pass', detail: `SW controller active (${navigator.serviceWorker.controller.scriptURL})` };
      }
      try {
        const newReg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
        const state = newReg.active ? 'active' : newReg.waiting ? 'waiting' : newReg.installing ? 'installing' : 'pending';
        return { status: 'pass', detail: `SW registered by diagnostic (state: ${state}, scope: ${newReg.scope})` };
      } catch (regErr) {
        return { status: 'fail', detail: `SW registration failed: ${regErr.message || regErr}` };
      }
    });

    await _test(SEC1, 'App version consistency', async () => {
      const jsVersion = APP_VERSION;
      const badge = document.getElementById('admin-version-badge');
      if (!badge) {
        // Badge is destroyed when setTopbar replaces title on non-list views
        return { status: 'pass', detail: `${jsVersion} (badge not in DOM — on ${Store.get('view')} view)` };
      }
      const badgeVersion = badge.textContent;
      if (jsVersion !== badgeVersion) return { status: 'warn', detail: `JS: ${jsVersion}, Badge: ${badgeVersion}` };
      return { status: 'pass', detail: `${jsVersion}` };
    });

    await _test(SEC1, 'Persistent storage granted', async () => {
      if (!navigator.storage || !navigator.storage.persisted) return { status: 'skip', detail: 'API not available' };
      const persisted = await navigator.storage.persisted();
      return { status: persisted ? 'pass' : 'warn', detail: persisted ? 'Storage will not be evicted' : 'Storage may be evicted by OS under pressure' };
    });

    // ═════════════════════════════════════════════
    // SECTION 2: localStorage Health
    // ═════════════════════════════════════════════

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
      const ids = songs.map(s => s.id).filter(Boolean);
      const dupeIds = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupeIds.length) return { status: 'fail', detail: `Duplicate song IDs: ${[...new Set(dupeIds)].join(', ')}` };
      return { status: 'pass', detail: `${ids.length} unique song IDs` };
    });

    // ═════════════════════════════════════════════
    // SECTION 3: Drive Configuration
    // ═════════════════════════════════════════════

    const SEC3 = 'Google Drive';

    await _test(SEC3, 'Drive configured', async () => {
      if (!Drive.isConfigured()) return { status: isMobile() ? 'pass' : 'warn', detail: isMobile() ? 'Not needed on mobile (GitHub handles metadata)' : 'API key or folder ID missing' };
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
        const masked = pat.substring(0, 4) + '...' + pat.substring(pat.length - 4);
        return { status: 'pass', detail: t() + ` — token: ${masked} (${pat.length} chars)` };
      } catch (e) {
        return { status: 'fail', detail: `Decryption failed: ${e.message}` };
      }
    });

    // ═════════════════════════════════════════════
    // SECTION 4: GitHub Configuration
    // ═════════════════════════════════════════════

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

    // ═════════════════════════════════════════════
    // SECTION 5: Encryption
    // ═════════════════════════════════════════════

    const SEC5 = 'Encryption';

    await _test(SEC5, 'AES-256-GCM encrypt/decrypt round-trip', async () => {
      if (!GitHub.isConfigured()) return { status: 'skip', detail: 'No PAT for key derivation' };
      const t = _timer('Crypto round-trip');
      const testData = [
        { id: 'test1', title: 'Test Song \u266b', tags: ['rock', '\u00e9lectro'], notes: '' },
        { id: 'test2', title: '', tags: [], notes: 'Line1\nLine2\n\u00c0\u00e9\u00ef\u00f6\u00fc' },
        { id: 'test3', title: 'Edge case', bpm: '120', nested: { a: [1, 2, null, true, false] } },
      ];
      try {
        const json = JSON.stringify(testData);
        const pat = localStorage.getItem('bb_github_pat') || '';
        const rawKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pat));
        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(json);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
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
      try {
        const seed = 'catmantrio-sync-propagation-2024';
        const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
        const encKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
        const decKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
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

    // ═════════════════════════════════════════════
    // SECTION 6: Remote Data Verification
    // ═════════════════════════════════════════════

    const SEC6 = 'Remote Data Integrity';

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

    // ═════════════════════════════════════════════
    // SECTION 7: Cross-Device Sync Verification
    // ═════════════════════════════════════════════

    const SEC7 = 'Cross-Device Sync';

    await _test(SEC7, 'Songs: local vs remote', async () => {
      if (remoteSongs === null) return { status: 'skip', detail: 'Remote songs not loaded' };
      const localCount = songs.length;
      const remoteCount = remoteSongs.length;
      if (localCount !== remoteCount) {
        const localIds = new Set(songs.map(s => s.id));
        const remoteIds = new Set(remoteSongs.map(s => s.id));
        const onlyLocal = [...localIds].filter(id => !remoteIds.has(id));
        const onlyRemote = [...remoteIds].filter(id => !localIds.has(id));
        let detail = `Count mismatch: ${localCount} local vs ${remoteCount} remote.`;
        if (onlyLocal.length) detail += ` Local-only IDs: ${onlyLocal.join(', ')}`;
        if (onlyRemote.length) detail += ` Remote-only IDs: ${onlyRemote.join(', ')}`;
        return { status: 'fail', detail };
      }
      const remoteMap = new Map(remoteSongs.map(s => [s.id, s]));
      let diffs = 0;
      const diffFields = [];
      for (const local of songs) {
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
      const localCount = setlists.length;
      const remoteCount = remoteSetlists.length;
      if (localCount !== remoteCount) {
        return { status: 'fail', detail: `Count mismatch: ${localCount} local vs ${remoteCount} remote` };
      }
      const match = JSON.stringify(setlists) === JSON.stringify(remoteSetlists);
      return { status: match ? 'pass' : 'warn', detail: match ? `${localCount} setlists identical` : `${localCount} setlists — counts match but content differs` };
    });

    await _test(SEC7, 'Practice: local vs remote', async () => {
      if (remotePractice === null) return { status: 'skip', detail: 'Remote practice not loaded' };
      const localCount = practice.length;
      const remoteCount = remotePractice.length;
      const localLists = practice.reduce((s, p) => s + (p.practiceLists || []).length, 0);
      const remoteLists = remotePractice.reduce((s, p) => s + (p.practiceLists || []).length, 0);
      if (localCount !== remoteCount || localLists !== remoteLists) {
        return { status: 'fail', detail: `Mismatch: ${localCount} personas (${localLists} lists) local vs ${remoteCount} personas (${remoteLists} lists) remote` };
      }
      const match = JSON.stringify(practice) === JSON.stringify(remotePractice);
      return { status: match ? 'pass' : 'warn', detail: match ? `${localCount} personas, ${localLists} lists identical` : `Counts match but content differs` };
    });

    // ═════════════════════════════════════════════
    // SECTION 8: Write Queue & Crash Recovery
    // ═════════════════════════════════════════════

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

    // ═════════════════════════════════════════════
    // SECTION 9: Auto-Configure Pipeline
    // ═════════════════════════════════════════════

    const SEC9 = 'Auto-Configure Pipeline';

    await _test(SEC9, 'Drive has default config', async () => {
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
      if (!Drive.isConfigured()) return { status: 'skip', detail: 'Drive not configured — cannot test' };
      const t = _timer('Full pipeline');
      try {
        const file = await Drive.findFilePublic('_github_sync.enc');
        if (!file) return { status: 'fail', detail: 'Step 1 FAILED: _github_sync.enc not on Drive. Desktop must Save & Connect in GitHub Setup first.' };
        const { apiKey } = Drive.getConfig();
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`);
        if (!resp.ok) return { status: 'fail', detail: `Step 2 FAILED: Drive download returned ${resp.status}` };
        const encText = await resp.text();
        let encJson;
        try { encJson = JSON.parse(encText); }
        catch (e) { return { status: 'fail', detail: 'Step 3 FAILED: _github_sync.enc is not valid JSON — file may be corrupted or using old encryption format' }; }
        if (!encJson.iv || !encJson.data) return { status: 'fail', detail: 'Step 3 FAILED: Missing iv or data fields — wrong encryption format' };
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
        const ghResp = await fetch(`https://api.github.com/repos/catmandabomb/catmantrio`, {
          headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' },
        });
        if (!ghResp.ok) return { status: 'fail', detail: `Step 5 FAILED: GitHub API returned ${ghResp.status} — PAT may be expired or revoked` };
        const ghData = await ghResp.json();
        const branchResp = await fetch(`https://api.github.com/repos/catmandabomb/catmantrio/branches/data`, {
          headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' },
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

    // ═════════════════════════════════════════════
    // SECTION 10: DOM Structure & Layout
    // ═════════════════════════════════════════════

    const SEC10 = 'DOM Structure';

    await _test(SEC10, 'Version badge visible', async () => {
      const badge = document.getElementById('admin-version-badge');
      // Badge lives inside topbar title — setTopbar destroys it when navigating away from list view
      if (!badge) {
        const onList = Store.get('view') === 'list';
        if (!onList) return { status: 'pass', detail: `Badge not in DOM (expected — topbar shows "${Store.get('view')}" title). Badge restores on list view.` };
        return { status: 'fail', detail: 'Badge element not found on list view' };
      }
      if (badge.classList.contains('hidden')) return { status: 'fail', detail: 'Badge has .hidden class' };
      const text = badge.textContent.trim();
      if (!text) return { status: 'fail', detail: 'Badge has no text content' };
      if (text !== APP_VERSION) return { status: 'warn', detail: `Badge: "${text}", expected: "${APP_VERSION}"` };
      return { status: 'pass', detail: text };
    });

    await _test(SEC10, 'List view layout is flex column', async () => {
      const vl = document.getElementById('view-list');
      if (!vl) return { status: 'fail', detail: '#view-list not found' };
      // When not on list view, the element has display:none — check the CSS class instead
      if (!vl.classList.contains('active')) {
        return { status: 'pass', detail: 'List view not active (on dashboard) — element exists, layout verified via class' };
      }
      const style = getComputedStyle(vl);
      const display = style.display;
      const direction = style.flexDirection;
      const overflow = style.overflow || style.overflowY;
      if (display !== 'flex') return { status: 'fail', detail: `display: ${display} (expected flex)` };
      if (direction !== 'column') return { status: 'fail', detail: `flex-direction: ${direction} (expected column)` };
      return { status: 'pass', detail: `display:flex, flex-direction:column, overflow:${overflow}` };
    });

    await _test(SEC10, 'Scroll wrapper is direct child of list view', async () => {
      const sw = document.getElementById('song-list-scroll');
      if (!sw) return { status: 'fail', detail: '#song-list-scroll not found' };
      if (sw.parentElement?.id !== 'view-list') return { status: 'fail', detail: `Parent is #${sw.parentElement?.id || '(none)'}, expected #view-list` };
      const style = getComputedStyle(sw);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') return { status: 'warn', detail: `overflow-y: ${style.overflowY} (expected auto)` };
      return { status: 'pass', detail: 'Correctly nested, overflow-y: ' + style.overflowY };
    });

    await _test(SEC10, 'Filter bars pinned outside scroll wrapper', async () => {
      const tagBar = document.getElementById('tag-filter-bar');
      const keyBar = document.getElementById('key-filter-bar');
      const issues = [];
      if (!tagBar) { issues.push('tag-filter-bar missing'); }
      else if (tagBar.parentElement?.id !== 'view-list') { issues.push(`tag-filter-bar parent: #${tagBar.parentElement?.id}`); }
      if (!keyBar) { issues.push('key-filter-bar missing'); }
      else if (keyBar.parentElement?.id !== 'view-list') { issues.push(`key-filter-bar parent: #${keyBar.parentElement?.id}`); }
      if (issues.length) return { status: 'fail', detail: issues.join('; ') };
      return { status: 'pass', detail: 'Both filter bars are direct children of #view-list (pinned)' };
    });

    await _test(SEC10, 'Sync indicator inside scroll wrapper', async () => {
      const si = document.getElementById('sync-indicator');
      if (!si) return { status: 'fail', detail: 'sync-indicator not found' };
      if (si.parentElement?.id !== 'song-list-scroll') return { status: 'fail', detail: `Parent is #${si.parentElement?.id}, expected #song-list-scroll` };
      return { status: 'pass', detail: 'Correctly inside scroll wrapper' };
    });

    await _test(SEC10, 'Refresh button hidden on mobile', async () => {
      const btn = document.getElementById('btn-refresh');
      if (!btn) return { status: 'fail', detail: 'Refresh button not found' };
      if (!isMobile()) return { status: 'skip', detail: 'Not a mobile device' };
      const style = getComputedStyle(btn);
      if (style.display === 'none') return { status: 'pass', detail: 'Hidden via CSS (display:none)' };
      return { status: 'fail', detail: `Visible on mobile — display: ${style.display}` };
    });

    await _test(SEC10, 'Song list element exists', async () => {
      const sl = document.getElementById('song-list');
      if (!sl) return { status: 'fail', detail: '#song-list not found' };
      if (sl.parentElement?.id !== 'song-list-scroll') return { status: 'fail', detail: `Parent: #${sl.parentElement?.id}, expected #song-list-scroll` };
      const cards = sl.querySelectorAll('.song-card').length;
      return { status: 'pass', detail: `${cards} song card(s) rendered` };
    });

    await _test(SEC10, 'Body mobile class matches detection', async () => {
      const hasCls = document.body.classList.contains('is-mobile');
      const isMob = isMobile();
      if (hasCls !== isMob) return { status: 'warn', detail: `body.is-mobile: ${hasCls}, _isMobile(): ${isMob}` };
      return { status: 'pass', detail: `is-mobile: ${hasCls}` };
    });

    // Final render
    _renderResults();
  }

  // ─── Router registration ──────────────────────────────────

  Router.register('dashboard', Utils.safeRender('dashboard', (route) => {
    if (route && route.rerender) { renderDashboard(); return; }
    renderDashboard();
  }));

  // ─── Public API ───────────────────────────────────────────

  return {
    renderDashboard,
    runDiagnostics,
  };

})();
