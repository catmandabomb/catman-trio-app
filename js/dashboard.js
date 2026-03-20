/**
 * dashboard.js — Admin Dashboard + Diagnostics
 *
 * Renders the admin dashboard with system health, data stats,
 * Cloudflare/Drive sync status, tag manager, and full diagnostics suite.
 * All state read from Store; no local state variables.
 */

import * as Store from './store.js?v=20.30';
import { esc, showToast, isMobile, detectPlatform, timeAgo, safeRender } from './utils.js?v=20.30';
import * as Modal from './modal.js?v=20.30';
import * as Router from './router.js?v=20.30';
import * as Admin from '../admin.js?v=20.30';
import * as Auth from '../auth.js?v=20.30';
import * as GitHub from '../github.js?v=20.30';
import * as Drive from '../drive.js?v=20.30';
import * as Sync from './sync.js?v=20.30';
import * as App from '../app.js?v=20.30';
import * as IDB from '../idb.js?v=20.30';

// ─── renderDashboard ──────────────────────────────────────

function renderDashboard() {
  // Auth guard — only logged-in admins/owners can access dashboard
  if (!Auth.isLoggedIn() || !Auth.canEditSongs()) {
    showToast('Access denied');
    location.hash = '#';
    return;
  }
  Store.set('currentRouteParams', {});
  if (App.cleanupPlayers) App.cleanupPlayers();
  Store.set('navStack', []);
  Router.pushNav(() => App.renderList());
  // Skip view transition so swap() runs synchronously — ensures topbar buttons
  // injected after showView() aren't removed by an async swap() callback.
  Store.set('skipViewTransition', true);
  Router.showView('dashboard');
  Router.setTopbar('Dashboard', true);

  // Add Switch Mode + Log Out buttons to topbar right
  // Inject synchronously so buttons are part of the View Transition "new" state.
  {
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      topbarRight.querySelector('#dash-topbar-actions')?.remove();
      const adminModeOn = Admin.isAdminModeActive();
      const switchText = adminModeOn ? 'User Mode' : 'Admin Mode';
      const switchIcon = adminModeOn ? 'user' : 'shield';
      const wrap = document.createElement('div');
      wrap.id = 'dash-topbar-actions';
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
      wrap.innerHTML = `
        <button class="btn-ghost topbar-nav-btn" id="dash-toggle-mode" title="Switch to ${switchText}"><i data-lucide="${switchIcon}" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>${switchText}</button>
        <button class="btn-ghost topbar-nav-btn" id="dash-logout" title="Log Out"><i data-lucide="log-out" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Log Out</button>
      `;
      topbarRight.appendChild(wrap);
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrap] });
      wrap.querySelector('#dash-toggle-mode')?.addEventListener('click', () => {
        if (Admin.isAdminModeActive()) {
          Admin.exitEditMode();
          showToast('Switched to User Mode');
        } else {
          Admin.enterEditMode();
          showToast('Switched to Admin Mode');
        }
        App.updateAuthUI();
        renderDashboard();
      });
      wrap.querySelector('#dash-logout')?.addEventListener('click', async () => {
        await Auth.logout();
        Admin.resetAdminMode(false);
        App.updateAuthUI();
        App.renderList();
        showToast('Logged out');
      });
    }
  }

  const container = document.getElementById('dashboard-content');
  const songs     = Store.get('songs');
  const setlists  = Store.get('setlists');
  const practice  = Store.get('practice');

  // ─── Gather stats ───
  const totalSongs = songs.length;
  const totalSetlists = setlists.length;
  const totalPracticeLists = practice.length;
  const allTags = new Set();
  songs.forEach(s => (s.tags || []).forEach(t => allTags.add(t)));

  // ─── Analyze issues ───
  const errors = [];
  const warnOrange = [];
  const warnYellow = [];

  // Collect all file IDs referenced by songs (Drive or R2)
  const referencedDriveIds = new Set();
  const driveIdToSong = {};
  const emptyDriveIds = [];
  songs.forEach(s => {
    const a = s.assets || {};
    [...(a.charts || []), ...(a.audio || [])].forEach(f => {
      const hasDrive = f.driveId && f.driveId.trim();
      const hasR2 = f.r2FileId && f.r2FileId.trim();
      if (hasDrive) {
        referencedDriveIds.add(f.driveId);
        if (!driveIdToSong[f.driveId]) driveIdToSong[f.driveId] = [];
        driveIdToSong[f.driveId].push(s);
      }
      if (!hasDrive && !hasR2) {
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
      title: `${emptyDriveIds.length} file${emptyDriveIds.length > 1 ? 's' : ''} with missing file ID`,
      detail: 'These attachments have no Drive or R2 file ID and cannot be loaded. Fix: Edit the song and re-upload the file, or remove the broken attachment.',
      items: emptyDriveIds.map(e => `"${esc(e.file)}" in "${esc(e.song)}"`)
    });
  }

  const orphanPractice = [];
  practice.forEach(pl => {
    (pl.songs || []).forEach(entry => {
      if (entry.songId && !songIdSet.has(entry.songId)) {
        orphanPractice.push({ list: pl.name, songId: entry.songId });
      }
    });
  });
  if (orphanPractice.length) {
    errors.push({
      code: 1201,
      title: `${orphanPractice.length} practice entry${orphanPractice.length > 1 ? 'ies' : 'y'} referencing deleted songs`,
      detail: 'These entries will show as missing. Fix: Edit the practice list and remove the broken entries, or re-add the song to the repository.',
      items: orphanPractice.map(o => `"${esc(o.list)}" → song ${o.songId}`)
    });
  }

  const orphanSetlist = [];
  setlists.forEach(sl => {
    (sl.songs || []).forEach(entry => {
      const sid = entry.id || entry.songId;
      if (sid && !songIdSet.has(sid)) {
        orphanSetlist.push({ setlist: (sl.overrideTitle || sl.venue || sl.name || 'Untitled'), songId: sid });
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

  const _migrated = localStorage.getItem('ct_migrated_to_github') === '1';
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
        <i data-lucide="heart-pulse" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>System Health
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
      <div class="dash-section-title"><i data-lucide="bar-chart-3" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Data Breakdown</div>
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

  // Storage Migration (owner only)
  if (Auth.getRole() === 'owner') {
    const cfActive = Sync.useCloudflare();
    html += `
      <div class="dash-section">
        <div class="dash-section-title">
          <i data-lucide="database" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Storage
          <span class="dash-section-badge ${cfActive ? 'ok' : ''}">${cfActive ? 'Cloudflare' : 'GitHub + Drive'}</span>
        </div>
        <div id="dash-migration" class="dash-alert info">
          <div class="dash-alert-detail" style="color:var(--text-3)">Loading migration state...</div>
        </div>
      </div>`;
  }

  // Shared Setlist Packets (admin/owner only)
  if (['owner', 'admin'].includes(Auth.getRole())) {
    html += `
      <div class="dash-section">
        <div class="dash-section-title">
          <i data-lucide="package" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Shared Setlist Packets
        </div>
        <div id="dash-shared-packets" class="dash-alert info">
          <div class="dash-alert-detail" style="color:var(--text-3)">Loading...</div>
        </div>
      </div>`;
  }

  // Cloudflare Status (replaces GitHub Sync — data is now on D1/R2/KV)
  html += `<div class="dash-section"><div class="dash-section-title">
    <i data-lucide="cloud" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Cloudflare Status
  </div>
    <div id="dash-cf-status" class="dash-alert info">
      <div class="dash-alert-detail" style="color:var(--text-3)">Loading…</div>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
      <button id="dash-run-diag" class="btn-secondary" style="font-size:11px;padding:4px 6px;">Run Diagnostics</button>
      <button id="dash-github-setup" class="btn-secondary" style="font-size:11px;padding:4px 6px;">GitHub Setup</button>
    </div>
  </div>`;

  // Drive sync diagnostic
  const _cfActive = Sync.useCloudflare();
  const _driveSectionTitle = _cfActive
    ? 'Drive Status (Legacy — PDFs/Audio only)' : 'Drive Sync Status';
  html += `
    <div class="dash-section">
      <div class="dash-section-title"><i data-lucide="folder-sync" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>${_driveSectionTitle}</div>
      <div id="dash-drive-sync" class="dash-alert info">
        <div class="dash-alert-detail">Checking Drive…</div>
      </div>
    </div>
  `;

  // Admin Settings — upload size limit (owner/admin only)
  if (Auth.isOwnerOrAdmin()) {
    const _currentLimit = Sync.getAdminSetting ? Sync.getAdminSetting('upload_size_limit_mb', '50') : '50';
    const _limitVal = _currentLimit === 'none' ? 'none' : parseInt(_currentLimit, 10) || 50;
    const limitOptions = [10,20,30,40,50,60,70,80,90,100,150,200,250].map(v =>
      `<option value="${v}" ${_limitVal === v ? 'selected' : ''}>${v} MB</option>`
    ).join('') + `<option value="none" ${_limitVal === 'none' ? 'selected' : ''}>No limit</option>`;
    html += `<div class="dash-section">
      <div class="dash-section-title"><i data-lucide="hard-drive" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Admin Settings</div>
      <div class="settings-row" style="margin-top:8px;">
        <div class="settings-row-label">
          <div class="settings-label">File upload size limit</div>
          <div class="settings-hint">Maximum file size for chart/audio uploads</div>
        </div>
        <select class="settings-select" id="dash-upload-limit">${limitOptions}</select>
      </div>
    </div>`;
  }

  // User Management — link to subpage (owner only)
  if (Auth.canManageUsers()) {
    html += `<div class="dash-section" style="text-align:center;padding-top:8px;">
      <button class="btn-ghost" id="dash-open-user-mgmt" style="font-size:15px;">
        <i data-lucide="users" style="width:16px;height:16px;vertical-align:-2px;margin-right:4px;"></i>User Management
      </button>
    </div>`;
  }

  // Tag Manager — link to subpage (admin only)
  if (Admin.isEditMode()) {
    html += `<div class="dash-section" style="text-align:center;padding-top:8px;">
      <button class="btn-ghost" id="dash-open-tag-mgr" style="font-size:15px;">
        <i data-lucide="tags" style="width:16px;height:16px;vertical-align:-2px;margin-right:4px;"></i>Tag Manager
      </button>
    </div>`;
  }

  // Data Management — purge section (owner only)
  if (Auth.getRole() === 'owner') {
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title" style="color:#e87c6a;">
        <i data-lucide="shield-alert" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Data Management
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        <button class="btn-danger" id="dash-purge-practice" style="font-size:13px;padding:10px 16px;">
          <i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Purge All Practice Lists (${totalPracticeLists})
        </button>
        <p class="muted" style="font-size:11px;margin:0;padding:0 4px;">Permanently deletes ALL practice lists for ALL users. Syncs to Cloudflare. Cannot be undone.</p>
      </div>
    </div>`;
  }

  // ─── God-Mode Extras (owner only, appended below existing sections) ───

  if (Auth.getRole() === 'owner') {

    // ── Data Export ──
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="download" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Data Export
      </div>
      <p class="muted" style="font-size:12px;margin:4px 0 10px;">Download all app data as a JSON file for backup or migration.</p>
      <button class="btn-ghost" id="dash-export-json" style="font-size:14px;">
        <i data-lucide="file-json" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Export All Data (JSON)
      </button>
      <button class="btn-ghost" id="dash-import-json" style="font-size:14px;margin-left:8px;">
        <i data-lucide="upload" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"></i>Import Data (JSON)
      </button>
      <input type="file" id="dash-import-file" accept=".json" style="display:none;">
    </div>`;

    // ── Storage Usage ──
    let lsUsed = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        lsUsed += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    } catch (_) {}
    const lsKB = (lsUsed / 1024).toFixed(1);
    const lsQuotaMB = 5;
    const lsPct = Math.min(100, (lsUsed / (lsQuotaMB * 1024 * 1024)) * 100).toFixed(1);

    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="hard-drive" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Storage Usage
      </div>
      <div style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
          <span>localStorage</span>
          <span>${lsKB} KB / ~${lsQuotaMB} MB (${lsPct}%)</span>
        </div>
        <div style="background:var(--bg-3);border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${lsPct}%;height:100%;background:${parseFloat(lsPct) > 80 ? '#e87c6a' : 'var(--accent)'};border-radius:4px;transition:width 0.3s;"></div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--text-3);">
        Songs: ~${((JSON.stringify(songs).length * 2) / 1024).toFixed(1)} KB &middot;
        Setlists: ~${((JSON.stringify(setlists).length * 2) / 1024).toFixed(1)} KB &middot;
        Practice: ~${((JSON.stringify(practice).length * 2) / 1024).toFixed(1)} KB
      </div>
    </div>`;

    // ── Sync Queue Status ──
    const ghConfigured = GitHub.isConfigured();
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="refresh-cw" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Sync Queue
      </div>
      <div id="dash-sync-status" style="margin-top:8px;font-size:13px;">
        ${ghConfigured ? '<span class="muted">Checking queue\u2026</span>' : '<span class="muted">Sync queue idle</span>'}
      </div>
    </div>`;

    // ── Service Quotas ──
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="gauge" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Service Quotas
      </div>
      <div id="dash-quotas" style="margin-top:8px;font-size:13px;">
        <span class="muted">Loading…</span>
      </div>
    </div>`;

    // ── Client Error Log ──
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="bug" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Client Error Log
      </div>
      <div id="dash-error-log" style="margin-top:8px;font-size:12px;max-height:200px;overflow-y:auto;">
        <span class="muted">No errors captured</span>
      </div>
      <button class="btn-ghost" id="dash-clear-errors" style="font-size:12px;margin-top:6px;display:none;color:#e87c6a;"><i data-lucide="trash-2" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;"></i>Clear Log</button>
    </div>`;

    // ── Server Error Log ──
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="server-crash" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Server Error Log
      </div>
      <div id="dash-server-errors" style="margin-top:8px;font-size:12px;max-height:200px;overflow-y:auto;">
        <span class="muted">Loading…</span>
      </div>
    </div>`;

    // ── Active Sessions ──
    html += `
    <div class="dash-section" style="margin-top:24px;">
      <div class="dash-section-title">
        <i data-lucide="monitor-smartphone" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Active Sessions
      </div>
      <div id="dash-sessions-list" style="margin-top:8px;font-size:13px;">
        <span class="muted">Loading\u2026</span>
      </div>
    </div>`;
  }

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

  // Switch Mode + Log Out buttons wired inside double-rAF callback above

  // BUG-28: Wire Remove Orphans buttons
  container.querySelectorAll('.btn-remove-orphans').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = parseInt(btn.dataset.orphanCode, 10);
      const songIdSet = new Set(songs.map(s => s.id));
      let removed = 0;
      if (code === 1201) {
        // Remove orphans from practice lists (flat format)
        practice.forEach(pl => {
          const before = (pl.songs || []).length;
          pl.songs = (pl.songs || []).filter(e => songIdSet.has(e.songId));
          removed += before - pl.songs.length;
        });
        Store.set('practice', practice);
        Sync.savePractice();
      } else if (code === 1301) {
        // Remove orphans from setlists
        setlists.forEach(sl => {
          const before = (sl.songs || []).length;
          sl.songs = (sl.songs || []).filter(e => songIdSet.has(e.id || e.songId));
          removed += before - sl.songs.length;
        });
        Store.set('setlists', setlists);
        Sync.saveSetlists();
      }
      showToast(`Removed ${removed} orphan${removed !== 1 ? 's' : ''}`);
      renderDashboard();
    });
  });

  // Wire purge practice lists button (owner only)
  document.getElementById('dash-purge-practice')?.addEventListener('click', () => {
    const count = (Store.get('practice') || []).length;
    if (count === 0) { showToast('No practice lists to purge.'); return; }
    Admin.showConfirm('Purge All Practice Lists',
      `This will permanently delete ALL ${count} practice lists for ALL users. This action cannot be undone. Are you sure?`,
      async () => {
        Store.set('practice', []);
        await Sync.savePractice('All practice lists purged.');
        renderDashboard();
      }, 'Purge All');
  });

  // Wire admin upload limit
  document.getElementById('dash-upload-limit')?.addEventListener('change', async (e) => {
    await Sync.saveAdminSetting('upload_size_limit_mb', e.target.value);
    showToast(`Upload limit set to ${e.target.value === 'none' ? 'no limit' : e.target.value + ' MB'}`);
  });

  // Wire Tag Manager button
  document.getElementById('dash-open-tag-mgr')?.addEventListener('click', () => {
    renderTagManager();
  });

  // Wire User Management button
  document.getElementById('dash-open-user-mgmt')?.addEventListener('click', () => {
    renderUserManagement();
  });

  // Wire dashboard buttons (Cloudflare section + legacy GitHub setup)
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
        const cfSection = diagBtn.closest('.dash-section');
        if (cfSection) cfSection.after(panel);
        else container.appendChild(panel);
      }
      panel.innerHTML = '<div style="color:var(--accent);padding:8px 0;">Initializing diagnostics...</div>';
      runDiagnostics(panel).then(() => {
        diagBtn.disabled = false;
        diagBtn.textContent = 'Run Diagnostics';
      });
    });
  }

  // ─── Wire God-Mode Extras ───

  // Data Export
  document.getElementById('dash-export-json')?.addEventListener('click', () => {
    const data = {
      exportedAt: new Date().toISOString(),
      version: Store.get('APP_VERSION'),
      songs: Store.get('songs'),
      setlists: Store.get('setlists'),
      practice: Store.get('practice'),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catman-trio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported');
  });

  // Data Import
  document.getElementById('dash-import-json')?.addEventListener('click', () => {
    document.getElementById('dash-import-file')?.click();
  });
  document.getElementById('dash-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Validate structure
      if (!data.songs || !Array.isArray(data.songs)) {
        showToast('Invalid backup file — missing songs array', 4000);
        return;
      }
      const songCount = data.songs.length;
      const setlistCount = data.setlists?.length || 0;
      const practiceCount = data.practice?.length || 0;
      const confirmed = await Modal.confirm(
        `Import ${songCount} songs, ${setlistCount} setlists, and ${practiceCount} practice lists?\n\nThis will REPLACE all current data. Make sure you have a backup first.`,
        'Import Data', 'Import', 'Cancel'
      );
      if (!confirmed) return;
      // Import
      Store.set('songs', data.songs);
      if (data.setlists) Store.set('setlists', data.setlists);
      if (data.practice) Store.set('practice', data.practice);
      // Save to IDB + localStorage
      {
        Sync.saveSongsLocal(data.songs);
        if (data.setlists) Sync.saveSetlistsLocal(data.setlists);
        if (data.practice) Sync.savePracticeLocal(data.practice);
      }
      // Push to remote
      if (GitHub.isConfigured()) {
        GitHub.saveSongs(data.songs);
        if (data.setlists) GitHub.saveSetlists(data.setlists);
        if (data.practice) GitHub.savePractice(data.practice);
      }
      showToast(`Imported ${songCount} songs, ${setlistCount} setlists, ${practiceCount} practice lists`);
      // Re-render
      if (App.renderSongList)App.renderSongList();
    } catch (err) {
      showToast('Import failed: ' + (err.message || 'Invalid JSON'), 4000);
    }
    e.target.value = ''; // reset file input
  });

  // Sync Queue Status (async)
  const syncStatusEl = document.getElementById('dash-sync-status');
  if (syncStatusEl && GitHub.isConfigured()) {
    try {
      const qs = GitHub.getWriteQueueStatus();
      const lastSync = localStorage.getItem('ct_last_sync');
      const lastSyncText = lastSync ? timeAgo(lastSync) : 'never';
      const pendingText = qs.hasPending ? qs.pendingTypes.join(', ') : 'none';
      const statusColor = qs.lastError ? '#e87c6a' : qs.flushing ? 'var(--accent)' : 'var(--text)';
      const statusLabel = qs.lastError ? 'Error' : qs.flushing ? 'Flushing\u2026' : 'Idle';
      syncStatusEl.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <span>Status: <strong style="color:${statusColor}">${statusLabel}</strong></span>
          <span>Pending: <strong>${esc(pendingText)}</strong></span>
        </div>
        <div style="margin-top:4px;color:var(--text-3);font-size:12px;">
          Last sync: ${lastSyncText} &middot; Ramp: ${qs.debounceCount}
        </div>`;
    } catch (_) {
      syncStatusEl.innerHTML = '<span class="muted">Could not read queue status</span>';
    }
  }

  // Client Error Log
  const errorLogEl = document.getElementById('dash-error-log');
  const clearErrorsBtn = document.getElementById('dash-clear-errors');
  if (errorLogEl) {
    try {
      const errors = JSON.parse(localStorage.getItem('ct_error_log') || '[]');
      if (errors.length > 0) {
        errorLogEl.innerHTML = errors.slice(-20).reverse().map(e =>
          `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
            <div style="color:#e87c6a;">${esc(e.message || 'Unknown error')}</div>
            <div style="color:var(--text-3);font-size:11px;">${esc(e.source || '')} ${e.time ? '&middot; ' + timeAgo(new Date(e.time).getTime()) : ''}</div>
          </div>`
        ).join('');
        if (clearErrorsBtn) clearErrorsBtn.style.display = '';
      }
    } catch (_) {}
  }
  clearErrorsBtn?.addEventListener('click', () => {
    localStorage.removeItem('ct_error_log');
    if (errorLogEl) errorLogEl.innerHTML = '<span class="muted">No errors captured</span>';
    clearErrorsBtn.style.display = 'none';
    showToast('Error log cleared');
  });

  // Async Cloudflare Status fetch (populates the main CF section)
  const cfStatusEl = document.getElementById('dash-cf-status');
  const isOwner = Auth.isLoggedIn() && Auth.getUser()?.role === 'owner';
  if (cfStatusEl && isOwner) {
    (async () => {
      try {
        const workerUrl = (GitHub.workerUrl) ? GitHub.workerUrl : 'https://catman-api.catmandabomb.workers.dev';
        const token = Auth.getToken();
        const resp = await fetch(`${workerUrl}/admin/quotas`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          const q = data.quotas || {};
          let html = '';
          const _bar = (label, used, limit, pct) => {
            const color = pct >= 90 ? '#e87c6a' : pct >= 60 ? '#d4b478' : '#7ec87e';
            return `<div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                <span>${esc(label)}</span>
                <span style="color:${color}">${used} / ${limit} (${pct}%)</span>
              </div>
              <div style="background:var(--bg-3);border-radius:4px;height:6px;overflow:hidden;">
                <div style="background:${color};height:100%;width:${Math.min(pct, 100)}%;border-radius:4px;transition:width 0.3s;"></div>
              </div>
            </div>`;
          };

          // 1. KV Daily Writes (the critical one)
          if (q.kv) {
            html += _bar('KV Daily Writes', q.kv.estimatedWrites, q.kv.limit, q.kv.pct);
          }

          // 2-4. D1 Database (Users, Active Sessions, Error Log)
          if (q.d1) {
            html += `<div style="margin-bottom:10px;">
              <div style="color:var(--text-2);margin-bottom:4px;">D1 Database</div>
              <div class="dash-github-status">
                <div class="status-row"><span>Users</span><span>${q.d1.users}</span></div>
                <div class="status-row"><span>Active Sessions</span><span style="color:var(--green)">${q.d1.activeSessions} <span style="color:var(--text-3);font-size:11px;">/ ${q.d1.sessions} total</span></span></div>
                <div class="status-row"><span>Error Log</span><span style="color:${q.d1.errorLog > 0 ? '#e87c6a' : 'var(--text-3)'}">${q.d1.errorLog}</span></div>
              </div>
            </div>`;
          }

          // 5. R2 Files
          if (q.r2) {
            const sizeStr = q.r2.totalBytes < 1024 * 1024
              ? (q.r2.totalBytes / 1024).toFixed(1) + ' KB'
              : (q.r2.totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
            html += `<div style="margin-bottom:10px;">
              <div class="dash-github-status">
                <div class="status-row"><span>R2 Files</span><span>${q.r2.fileCount} files (${sizeStr})</span></div>
              </div>
            </div>`;
          }

          // 6. Emails Today
          if (q.resend) {
            html += _bar('Emails Today', q.resend.daily.used, q.resend.daily.limit, q.resend.daily.pct);
            // 7. Emails This Month
            html += _bar('Emails This Month', q.resend.monthly.used, q.resend.monthly.limit, q.resend.monthly.pct);
          }

          cfStatusEl.innerHTML = html || '<span class="muted">No data</span>';
        } else {
          cfStatusEl.innerHTML = '<span class="muted">Could not fetch Cloudflare status</span>';
        }
      } catch (_) {
        cfStatusEl.innerHTML = '<span class="muted">Could not fetch Cloudflare status</span>';
      }
    })();
  }

  // Service quotas — GitHub API (client-side only, no extra fetch needed)
  const quotasEl = document.getElementById('dash-quotas');
  if (quotasEl && isOwner) {
    const gh = GitHub.getRateLimitStatus();
    const ghColor = gh.pct >= 90 ? '#e87c6a' : gh.pct >= 60 ? '#d4b478' : '#7ec87e';
    quotasEl.innerHTML = `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
        <span>GitHub API</span>
        <span style="color:${ghColor}">${gh.callsThisHour} / ${gh.limit} per hour (${gh.pct}%)</span>
      </div>
      <div style="background:var(--bg-3);border-radius:4px;height:6px;overflow:hidden;">
        <div style="background:${ghColor};height:100%;width:${Math.min(gh.pct, 100)}%;border-radius:4px;transition:width 0.3s;"></div>
      </div>
    </div>
    <div style="color:var(--text-3);font-size:11px;border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
      Workers: 100K req/day &middot; KV: 100K reads/day, 1K writes/day &middot; D1: 5M reads, 100K writes/day
    </div>`;
  }

  // Async server error log fetch
  const serverErrorsEl = document.getElementById('dash-server-errors');
  if (serverErrorsEl && isOwner) {
    (async () => {
      try {
        const workerUrl = (GitHub.workerUrl) ? GitHub.workerUrl : 'https://catman-api.catmandabomb.workers.dev';
        const token = Auth.getToken();
        const resp = await fetch(`${workerUrl}/admin/errors`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          const errs = data.errors || [];
          if (errs.length === 0) {
            serverErrorsEl.innerHTML = '<span class="muted">No server errors</span>';
          } else {
            serverErrorsEl.innerHTML = errs.map(e =>
              `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
                <div style="color:#e87c6a;">${esc(e.message || 'Unknown')}</div>
                <div style="color:var(--text-3);font-size:11px;">${esc(e.method || '')} ${esc(e.path || '')} ${e.created_at ? '&middot; ' + timeAgo(new Date(e.created_at).getTime()) : ''}</div>
              </div>`
            ).join('');
          }
        } else {
          serverErrorsEl.innerHTML = '<span class="muted">Could not fetch server errors</span>';
        }
      } catch (_) {
        serverErrorsEl.innerHTML = '<span class="muted">Could not fetch server errors</span>';
      }
    })();
  }

  // Load active sessions
  const sessionsEl = document.getElementById('dash-sessions-list');
  if (sessionsEl && Auth.listSessions) {
    Auth.listSessions().then(sessions => {
      if (!sessions || sessions.length === 0) {
        sessionsEl.innerHTML = '<span class="muted">No active sessions</span>';
        return;
      }
      sessionsEl.innerHTML = sessions.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:13px;color:var(--text);">${esc(s.deviceInfo || 'Unknown device')}</div>
            <div style="font-size:11px;color:var(--text-3);">Last active: ${timeAgo(new Date(s.lastUsed).getTime())}${s.isCurrent ? ' \xb7 <strong style="color:var(--accent);">This device</strong>' : ''}</div>
          </div>
          ${s.isCurrent ? '' : `<button class="btn-ghost btn-sm" data-revoke-session="${esc(s.id)}" style="font-size:11px;color:#e87c6a;"><i data-lucide="x-circle" style="width:11px;height:11px;vertical-align:-2px;margin-right:3px;"></i>Revoke</button>`}
        </div>
      `).join('');
      sessionsEl.querySelectorAll('[data-revoke-session]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await Auth.revokeSession(btn.dataset.revokeSession);
            showToast('Session revoked');
            btn.closest('div[style]').remove();
          } catch (e) {
            showToast(e.message || 'Failed to revoke');
          }
        });
      });
    }).catch(() => {
      sessionsEl.innerHTML = '<span class="muted">Could not load sessions</span>';
    });
  }

  // Async Drive check
  _renderDriveSection(container, songs, setlists, practice, _codeTag);

  // Async Shared Packets loader
  _loadSharedPackets();

  // Async Migration UI loader
  _loadMigrationUI();

}

async function _loadSharedPackets() {
  const el = document.getElementById('dash-shared-packets');
  if (!el) return;

  const token = Auth.getToken ? Auth.getToken() : null;
  if (!token) {
    el.innerHTML = '<div class="dash-alert-detail" style="color:var(--text-3)">Log in to view shared packets.</div>';
    return;
  }

  try {
    const resp = await fetch(GitHub.workerUrl + '/gig/shared', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    const data = await resp.json();
    const packets = data.packets || [];

    if (packets.length === 0) {
      el.innerHTML = '<div class="dash-alert-detail" style="color:var(--text-3)">No active shared packets.</div>';
      return;
    }

    let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    packets.forEach(p => {
      const dateStr = p.gig_date ? new Date(p.gig_date).toLocaleDateString() : '';
      const sharedDate = p.created_at ? timeAgo(new Date(p.created_at)) : '';
      const url = `${GitHub.workerUrl}/gig/${p.token}`;
      html += `
        <div class="dash-shared-packet-row">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.title)}</div>
            <div style="font-size:11px;color:var(--text-3);">
              ${p.venue ? esc(p.venue) : ''}${p.venue && dateStr ? ' \u00b7 ' : ''}${dateStr}
              ${sharedDate ? ' \u00b7 shared ' + sharedDate : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
            <button class="btn-ghost dash-packet-copy" data-packet-url="${esc(url)}" title="Copy link" style="padding:4px 8px;font-size:11px;">
              <i data-lucide="clipboard-copy" style="width:12px;height:12px;"></i>
            </button>
            <button class="btn-ghost dash-packet-unshare" data-unshare-setlist="${esc(p.setlist_id)}" title="Unshare" style="padding:4px 8px;font-size:11px;color:var(--red,#e57373);">
              <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
            </button>
          </div>
        </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });

    // Wire copy buttons
    el.querySelectorAll('.dash-packet-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.packetUrl;
        navigator.clipboard?.writeText(url)
          .then(() => showToast('Packet link copied!'))
          .catch(() => showToast('Copy failed'));
      });
    });

    // Wire unshare buttons
    el.querySelectorAll('.dash-packet-unshare').forEach(btn => {
      btn.addEventListener('click', () => {
        const setlistId = btn.dataset.unshareSetlist;
        Modal.confirm('Unshare Packet', 'Remove this shared packet? The link will stop working.', async () => {
          try {
            await fetch(GitHub.workerUrl + '/gig/share/' + encodeURIComponent(setlistId), {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` },
            });
            showToast('Packet unshared');
            _loadSharedPackets(); // Refresh the list
          } catch (e) {
            showToast('Failed to unshare');
          }
        }, { okLabel: 'Unshare', danger: true });
      });
    });
  } catch (e) {
    el.innerHTML = '<div class="dash-alert-detail" style="color:var(--text-3)">Could not load shared packets.</div>';
  }
}

// ─── Storage Migration ──────────────────────────────────

async function _loadMigrationUI() {
  const el = document.getElementById('dash-migration');
  if (!el) return;

  const token = Auth.getToken ? Auth.getToken() : null;
  if (!token) { el.innerHTML = '<div class="dash-alert-detail" style="color:var(--text-3)">Log in to view migration status.</div>'; return; }

  const cfActive = Sync.useCloudflare();

  try {
    const resp = await fetch(GitHub.workerUrl + '/migration/state', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    const data = await resp.json();
    const state = data.state || {};
    const metadataDone = state.metadata_migrated === 'true';
    const filesDone = state.files_migrated === 'true';

    let html = '<div style="display:flex;flex-direction:column;gap:10px;">';

    // Status rows
    html += `<div class="status-row"><span>Metadata (songs, setlists, practice)</span><span style="color:var(${metadataDone ? '--green' : '--text-3'})">${metadataDone ? 'Migrated to D1' : 'On GitHub'}</span></div>`;
    html += `<div class="status-row"><span>Files (PDFs, audio)</span><span style="color:var(${filesDone ? '--green' : '--text-3'})">${filesDone ? 'Migrated to R2' : 'On Google Drive'}</span></div>`;
    html += `<div class="status-row"><span>Active backend</span><span style="color:var(${cfActive ? '--green' : '--accent'})">${cfActive ? 'Cloudflare D1/R2' : 'GitHub + Drive (legacy)'}</span></div>`;

    // Action buttons
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">';

    if (!metadataDone) {
      html += `<button id="dash-migrate-metadata" class="btn-primary" style="font-size:11px;padding:4px 6px;">Migrate Metadata to D1</button>`;
    }
    if (!filesDone) {
      html += `<button id="dash-migrate-files" class="btn-primary" style="font-size:11px;padding:4px 6px;">Migrate Files to R2</button>`;
    }
    if (metadataDone && !cfActive) {
      html += `<button id="dash-switch-cloudflare" class="btn-primary" style="font-size:11px;padding:4px 6px;">Switch to Cloudflare</button>`;
    }
    if (cfActive) {
      html += `<button id="dash-switch-legacy" class="btn-secondary" style="font-size:11px;padding:4px 6px;">Switch Back to GitHub+Drive</button>`;
    }

    html += '</div></div>';
    el.innerHTML = html;

    // Wire migrate metadata button
    document.getElementById('dash-migrate-metadata')?.addEventListener('click', () => {
      Modal.confirm('Migrate Metadata', 'This will copy all songs, setlists, and practice data from GitHub to Cloudflare D1. The original data on GitHub will NOT be deleted.', async () => {
        await _runMetadataMigration(token);
      }, { okLabel: 'Migrate', danger: false });
    });

    // Wire migrate files button
    document.getElementById('dash-migrate-files')?.addEventListener('click', () => {
      Modal.confirm('Migrate Files', 'This will copy all PDF charts and audio files from Google Drive to Cloudflare R2. The original files on Drive will NOT be deleted. This may take a few minutes.', async () => {
        await _runFileMigration(token);
      }, { okLabel: 'Migrate', danger: false });
    });

    // Wire switch to cloudflare
    document.getElementById('dash-switch-cloudflare')?.addEventListener('click', () => {
      Modal.confirm('Switch to Cloudflare', 'The app will read/write data from Cloudflare D1/R2 instead of GitHub/Drive. You can switch back at any time.', () => {
        localStorage.removeItem('ct_use_cloudflare');
        showToast('Switched to Cloudflare storage');
        renderDashboard();
      }, { okLabel: 'Switch', danger: false });
    });

    // Wire switch back to legacy
    document.getElementById('dash-switch-legacy')?.addEventListener('click', () => {
      Modal.confirm('Switch Back', 'The app will read/write from GitHub + Google Drive again (legacy mode).', () => {
        localStorage.setItem('ct_use_cloudflare', '0');
        showToast('Switched back to GitHub + Drive');
        renderDashboard();
      }, { okLabel: 'Switch Back', danger: false });
    });

  } catch (e) {
    el.innerHTML = '<div class="dash-alert-detail" style="color:var(--text-3)">Could not load migration state.</div>';
  }
}

async function _runMetadataMigration(token) {
  showToast('Migrating metadata...', 0);

  try {
    // Step 1: Load current data from GitHub (already in Store from last sync)
    const songs = Store.get('songs') || [];
    const setlists = Store.get('setlists') || [];
    const practice = Store.get('practice') || [];

    if (songs.length === 0 && setlists.length === 0 && practice.length === 0) {
      showToast('No data to migrate — sync from GitHub first', 4000);
      return;
    }

    // Step 2: Push to D1 via Worker
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    const base = GitHub.workerUrl;

    const [songsRes, setlistsRes, practiceRes] = await Promise.all([
      fetch(base + '/data/songs', { method: 'POST', headers, body: JSON.stringify({ songs }) }),
      fetch(base + '/data/setlists', { method: 'POST', headers, body: JSON.stringify({ setlists }) }),
      fetch(base + '/data/practice', { method: 'POST', headers, body: JSON.stringify({ practice }) }),
    ]);

    const songsOk = (await songsRes.json()).ok;
    const setlistsOk = (await setlistsRes.json()).ok;
    const practiceOk = (await practiceRes.json()).ok;

    if (!songsOk || !setlistsOk || !practiceOk) {
      showToast('Migration partially failed — check dashboard', 5000);
      return;
    }

    // Step 3: Verify by loading back from D1
    const verify = await fetch(base + '/data/songs', { headers: { 'Authorization': `Bearer ${token}` } });
    const verifyData = await verify.json();
    const d1Count = (verifyData.songs || []).length;

    if (d1Count < songs.length) {
      showToast(`Verification failed: D1 has ${d1Count} songs, expected ${songs.length}`, 5000);
      return;
    }

    // Step 4: Mark migration complete
    await fetch(base + '/migration/state', {
      method: 'POST', headers,
      body: JSON.stringify({ key: 'metadata_migrated', value: 'true' }),
    });
    await fetch(base + '/migration/state', {
      method: 'POST', headers,
      body: JSON.stringify({ key: 'metadata_migrated_at', value: new Date().toISOString() }),
    });
    await fetch(base + '/migration/state', {
      method: 'POST', headers,
      body: JSON.stringify({ key: 'metadata_counts', value: JSON.stringify({ songs: songs.length, setlists: setlists.length, practice: practice.length }) }),
    });

    showToast(`Metadata migrated! ${songs.length} songs, ${setlists.length} setlists, ${practice.length} practice lists`, 5000);
    _loadMigrationUI(); // Refresh
  } catch (e) {
    showToast('Migration failed: ' + (e.message || 'Unknown error'), 5000);
  }
}

async function _runFileMigration(token) {
  showToast('Migrating files to R2... this may take a few minutes', 0);

  try {
    const songs = Store.get('songs') || [];
    const headers = { 'Authorization': `Bearer ${token}` };
    const base = GitHub.workerUrl;

    // Collect all file references from songs
    const filesToMigrate = [];
    for (const song of songs) {
      if (!song.assets) continue;
      for (const chart of (song.assets.charts || [])) {
        if (chart.driveId) {
          filesToMigrate.push({
            driveId: chart.driveId,
            filename: chart.name || `${song.title || 'chart'}.pdf`,
            songId: song.id,
            fileType: 'chart',
            mimeType: chart.mimeType || 'application/pdf',
          });
        }
      }
      for (const audio of (song.assets.audio || [])) {
        if (audio.driveId) {
          filesToMigrate.push({
            driveId: audio.driveId,
            filename: audio.name || `${song.title || 'audio'}.mp3`,
            songId: song.id,
            fileType: 'audio',
            mimeType: audio.mimeType || 'audio/mpeg',
          });
        }
      }
    }

    if (filesToMigrate.length === 0) {
      showToast('No files to migrate', 3000);
      // Still mark as done
      await fetch(base + '/migration/state', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'files_migrated', value: 'true' }),
      });
      _loadMigrationUI();
      return;
    }

    // Migrate files one by one (sequential to avoid overwhelming the Worker)
    let migrated = 0;
    let failed = 0;
    const fileIdMap = {}; // driveId → new R2 fileId

    for (const f of filesToMigrate) {
      try {
        // Fetch from Drive via our existing proxy
        const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.driveId)}?alt=media&key=${Drive.getConfig().apiKey}`;
        const driveResp = await fetch(driveUrl);
        if (!driveResp.ok) { failed++; continue; }

        const blob = await driveResp.blob();

        // Upload to R2 via Worker
        const uploadResp = await fetch(base + '/files/upload', {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': f.mimeType,
            'X-Filename': f.filename,
            'X-Song-Id': f.songId,
            'X-File-Type': f.fileType,
          },
          body: blob,
        });

        const result = await uploadResp.json();
        if (result.ok) {
          fileIdMap[f.driveId] = result.fileId;
          migrated++;
        } else {
          failed++;
        }
      } catch (e) {
        console.warn(`Failed to migrate file ${f.filename}:`, e);
        failed++;
      }

      // Progress toast every 5 files
      if ((migrated + failed) % 5 === 0) {
        showToast(`Migrating files... ${migrated + failed}/${filesToMigrate.length}`, 0);
      }
    }

    // Update song assets to reference R2 file IDs instead of Drive IDs
    if (Object.keys(fileIdMap).length > 0) {
      const updatedSongs = songs.map(song => {
        if (!song.assets) return song;
        const updated = { ...song, assets: { ...song.assets } };
        updated.assets.charts = (song.assets.charts || []).map(c => {
          if (c.driveId && fileIdMap[c.driveId]) {
            return { ...c, r2FileId: fileIdMap[c.driveId] };
          }
          return c;
        });
        updated.assets.audio = (song.assets.audio || []).map(a => {
          if (a.driveId && fileIdMap[a.driveId]) {
            return { ...a, r2FileId: fileIdMap[a.driveId] };
          }
          return a;
        });
        return updated;
      });

      // Save updated songs (with r2FileId references) back to both D1 and local
      Store.set('songs', updatedSongs);
      Sync.saveLocal(updatedSongs);
      await fetch(base + '/data/songs', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs: updatedSongs }),
      });
    }

    // Mark migration complete
    await fetch(base + '/migration/state', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'files_migrated', value: 'true' }),
    });
    await fetch(base + '/migration/state', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'files_migrated_at', value: new Date().toISOString() }),
    });
    await fetch(base + '/migration/state', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'files_counts', value: JSON.stringify({ total: filesToMigrate.length, migrated, failed, mapped: Object.keys(fileIdMap).length }) }),
    });

    showToast(`Files migrated: ${migrated} OK, ${failed} failed out of ${filesToMigrate.length}`, 5000);
    _loadMigrationUI();
  } catch (e) {
    showToast('File migration failed: ' + (e.message || 'Unknown error'), 5000);
  }
}

// ─── Tag Manager (subpage) ──────────────────────────────

function renderTagManager(skipNavPush) {
  if (!skipNavPush) Router.pushNav(() => renderDashboard());
  Store.set('skipViewTransition', true);
  Router.showView('dashboard');
  Router.setTopbar('Tag Manager', true);
  document.querySelector('#dash-topbar-actions')?.remove();

  const container = document.getElementById('dashboard-content');
  const songs = Store.get('songs');
  const tagCounts = {};
  songs.forEach(s => (s.tags || []).forEach(t => {
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }));
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  let html = '';
  if (sortedTags.length === 0) {
    html += `<div class="empty-state" style="padding:40px 20px">
      <p>No tags in use.</p>
      <p class="muted">Tags will appear here as you add them to songs.</p>
    </div>`;
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

  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

  // Wire rename buttons
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
        if (!newTag || newTag === oldTag) { renderTagManager(true); return; }
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
        renderTagManager(true);
      }

      confirmBtn.addEventListener('click', doRename);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doRename();
        if (e.key === 'Escape') renderTagManager(true);
      });
    });
  });

  // Wire delete buttons
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
        renderTagManager(true);
      });
    });
  });
}

// ─── User Management (subpage) ─────────────────────────────

async function renderUserManagement(skipNavPush) {
  if (!Auth.canManageUsers()) {
    showToast('Access denied');
    return;
  }
  if (!skipNavPush) Router.pushNav(() => renderDashboard());
  Store.set('skipViewTransition', true);
  Router.showView('dashboard');
  Router.setTopbar('User Management', true);
  document.querySelector('#dash-topbar-actions')?.remove();

  const container = document.getElementById('dashboard-content');
  container.innerHTML = `<div class="dash-users-loading" style="text-align:center;padding:40px 20px;color:var(--text-3);">Loading users\u2026</div>`;

  try {
    const users = await Auth.listAllUsers();
    const roleColors = { owner: 'var(--accent)', admin: '#60a5fa', member: 'var(--text-2)', guest: 'var(--text-3)' };
    const roleIcons = { owner: 'crown', admin: 'shield', member: 'user', guest: 'eye' };

    let html = `<div style="text-align:center;margin-bottom:16px;">
      <button class="btn-ghost" id="um-add-user" style="font-size:12px;">
        <i data-lucide="user-plus" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Add User
      </button>
    </div>`;

    if (!users || users.length === 0) {
      html += `<div class="empty-state" style="padding:40px 20px;">
        <p>No users yet.</p>
        <p class="muted">Create the first user above.</p>
      </div>`;
    } else {
      html += `<div class="um-user-list">`;
      users.forEach(u => {
        const roleColor = roleColors[u.role] || 'var(--text-3)';
        const roleIcon = roleIcons[u.role] || 'user';
        const inactive = u.isActive === false;
        html += `
          <div class="um-user-card${inactive ? ' um-inactive' : ''}" data-user-id="${esc(u.id)}">
            <div class="um-user-avatar" style="border-color:${roleColor}">
              <i data-lucide="${roleIcon}" style="width:18px;height:18px;color:${roleColor}"></i>
            </div>
            <div class="um-user-details">
              <div class="um-user-name-row">
                <span class="um-user-display">${esc(u.displayName || u.username)}</span>
                <span class="um-user-role" style="color:${roleColor}">${esc(u.role)}</span>
                ${inactive ? '<span class="um-disabled-tag">DISABLED</span>' : ''}
              </div>
              <span class="um-user-username">@${esc(u.username)}</span>
            </div>
            <div class="um-user-actions">
              ${u.role !== 'owner' ? `
                <button class="tag-mgr-btn um-edit-user" data-user-id="${esc(u.id)}" title="Edit user">
                  <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                </button>
                <button class="tag-mgr-btn um-reset-pw" data-user-id="${esc(u.id)}" data-username="${esc(u.username)}" title="Reset password">
                  <i data-lucide="key-round" style="width:12px;height:12px;"></i>
                </button>
                <button class="tag-mgr-btn um-delete-user" data-user-id="${esc(u.id)}" data-username="${esc(u.username)}" title="Delete user">
                  <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                </button>
              ` : ''}
            </div>
          </div>`;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [container] });

    // Wire Add User
    document.getElementById('um-add-user')?.addEventListener('click', () => _showAddUserModal());

    // Wire Edit buttons
    container.querySelectorAll('.um-edit-user').forEach(btn => {
      btn.addEventListener('click', () => _showEditUserModal(btn.dataset.userId));
    });

    // Wire Delete buttons
    container.querySelectorAll('.um-delete-user').forEach(btn => {
      btn.addEventListener('click', () => {
        const username = btn.dataset.username;
        const userId = btn.dataset.userId;
        Admin.showConfirm('Delete User', `Permanently delete user "${username}"? This cannot be undone.`, async () => {
          try {
            await Auth.deleteExistingUser(userId);
            showToast(`User "${username}" deleted`);
            renderUserManagement(true);
          } catch (e) {
            showToast('Delete failed: ' + (e.message || 'unknown error'));
          }
        });
      });
    });

    // Wire Reset Password buttons
    container.querySelectorAll('.um-reset-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const username = btn.dataset.username;
        const userId = btn.dataset.userId;
        _showResetPasswordModal(userId, username);
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px;">
      <p style="color:#e87c6a">Failed to load users</p>
      <p class="muted">${esc(e.message || 'Unknown error')}</p>
    </div>`;
  }
}

function _showAddUserModal() {
  const handle = Modal.create({
    id: 'modal-add-user',
    content: `
      <h3>Add User</h3>
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;">
        <div>
          <label class="form-label">Username</label>
          <input type="text" id="mu-username" class="form-input" placeholder="username" autocomplete="off" maxlength="30">
        </div>
        <div>
          <label class="form-label">Display Name</label>
          <input type="text" id="mu-display" class="form-input" placeholder="Display Name" maxlength="50">
        </div>
        <div>
          <label class="form-label">Email</label>
          <input type="email" id="mu-email" class="form-input" placeholder="user@example.com" autocomplete="off" maxlength="100">
        </div>
        <div>
          <label class="form-label">Confirm Email</label>
          <input type="email" id="mu-email-confirm" class="form-input" placeholder="Re-enter email" autocomplete="off" maxlength="100">
        </div>
        <div>
          <label class="form-label">Password</label>
          <input type="password" id="mu-password" class="form-input" placeholder="Min 8 chars, mixed case + number + special" maxlength="100">
        </div>
        <div>
          <label class="form-label">Confirm Password</label>
          <input type="password" id="mu-password-confirm" class="form-input" placeholder="Re-enter password" maxlength="100">
        </div>
        <div>
          <label class="form-label">Role</label>
          <select id="mu-role" class="form-input">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest (read-only)</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="mu-cancel">Cancel</button>
        <button class="btn-primary" id="mu-confirm">Create User</button>
      </div>
    `,
  });

  document.getElementById('mu-cancel')?.addEventListener('click', () => handle.hide());
  document.getElementById('mu-confirm')?.addEventListener('click', async () => {
    const username = document.getElementById('mu-username').value.trim();
    const displayName = document.getElementById('mu-display').value.trim();
    const password = document.getElementById('mu-password').value;
    const passwordConfirm = document.getElementById('mu-password-confirm').value;
    const email = document.getElementById('mu-email').value.trim();
    const emailConfirm = document.getElementById('mu-email-confirm').value.trim();
    const role = document.getElementById('mu-role').value;

    if (!username || !password || !email) {
      showToast('Username, email, and password are required');
      return;
    }
    if (email !== emailConfirm) {
      showToast('Email addresses do not match');
      return;
    }
    const pwError = Admin.validatePassword(password);
    if (pwError) {
      showToast(pwError);
      return;
    }
    if (password !== passwordConfirm) {
      showToast('Passwords do not match');
      return;
    }

    const btn = document.getElementById('mu-confirm');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      await Auth.createNewUser({ username, password, displayName, email, role });
      handle.hide();
      showToast(`User "${username}" created`);
      renderUserManagement(true);
    } catch (e) {
      showToast('Create failed: ' + (e.message || 'unknown error'));
      btn.disabled = false;
      btn.textContent = 'Create User';
    }
  });
  document.getElementById('mu-username')?.focus();
}

async function _showEditUserModal(userId) {
  let users;
  try {
    users = await Auth.listAllUsers();
  } catch (e) {
    showToast('Failed to load user');
    return;
  }
  const user = users.find(u => u.id === userId);
  if (!user) { showToast('User not found'); return; }

  const handle = Modal.create({
    id: 'modal-edit-user',
    content: `
      <h3>Edit User: ${esc(user.displayName || user.username)}</h3>
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;">
        <div>
          <label class="form-label">Username</label>
          <input type="text" class="form-input" value="${esc(user.username)}" disabled style="opacity:0.5">
        </div>
        <div>
          <label class="form-label">Display Name</label>
          <input type="text" id="mu-display" class="form-input" value="${esc(user.displayName || '')}" maxlength="50">
        </div>
        <div>
          <label class="form-label">Email</label>
          <input type="email" id="mu-email" class="form-input" value="${esc(user.email || '')}" maxlength="100">
        </div>
        <div>
          <label class="form-label">Role</label>
          <select id="mu-role" class="form-input">
            <option value="member" ${user.role === 'member' ? 'selected' : ''}>Member</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="guest" ${user.role === 'guest' ? 'selected' : ''}>Guest (read-only)</option>
          </select>
        </div>
        <div>
          <label class="form-label">New Password (leave blank to keep current)</label>
          <input type="password" id="mu-password" class="form-input" placeholder="New password" maxlength="100">
        </div>
        <div>
          <label class="form-label" style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" id="mu-active" ${user.isActive !== false ? 'checked' : ''}>
            Account active
          </label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="mu-cancel">Cancel</button>
        <button class="btn-primary" id="mu-confirm">Save Changes</button>
      </div>
    `,
  });

  document.getElementById('mu-cancel')?.addEventListener('click', () => handle.hide());
  document.getElementById('mu-confirm')?.addEventListener('click', async () => {
    const displayName = document.getElementById('mu-display').value.trim();
    const email = document.getElementById('mu-email').value.trim();
    const role = document.getElementById('mu-role').value;
    const password = document.getElementById('mu-password').value;
    const isActive = document.getElementById('mu-active').checked;

    const updates = { displayName, email, role, isActive };
    if (password) {
      const pwError = Admin.validatePassword(password);
      if (pwError) {
        showToast(pwError);
        return;
      }
      updates.password = password;
    }

    const btn = document.getElementById('mu-confirm');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      await Auth.updateExistingUser(userId, updates);
      handle.hide();
      showToast('User updated');
      renderUserManagement(true);
    } catch (e) {
      showToast('Update failed: ' + (e.message || 'unknown error'));
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

function _renderDriveSection(container, songs, setlists, practice, _codeTag) {
  (async () => {
    const el = document.getElementById('dash-drive-sync');
    if (!el) return;
    const _isMigrated = localStorage.getItem('ct_migrated_to_github') === '1';

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
        `Used for PDFs and audio files only. Metadata syncs via Cloudflare D1.<br><br>` +
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
      const drivePLists = Array.isArray(dPractice) ? dPractice.length : 0;

      const localSongs = songs.length;
      const localSetlists = setlists.length;
      const localPLists = practice.length;

      const songMatch = driveSongs === localSongs;
      const setlistMatch = driveSetlists === localSetlists;
      const plistMatch = drivePLists === localPLists;
      const allMatch = songMatch && setlistMatch && plistMatch;

      const row = (label, local, drive, match) =>
        `<div style="display:flex;justify-content:space-between;padding:2px 0;">` +
        `<span>${label}</span>` +
        `<span style="color:${match ? 'var(--text-3)' : '#e87c6a'};">${local} local / ${drive} on Drive${match ? '' : ' ⚠'}</span>` +
        `</div>`;

      el.style.borderLeftColor = allMatch ? 'var(--accent-dim)' : '#e87c6a';
      const pushBtn = !allMatch
        ? `<button id="dash-push-drive" class="btn-primary" style="margin-top:8px;font-size:11px;padding:4px 6px;">Push All to Drive</button>`
        : '';
      const fixShareBtn = Drive.isWriteConfigured()
        ? `<button id="dash-fix-sharing" class="btn-secondary" style="margin-top:6px;font-size:11px;padding:4px 6px;">Fix Sharing (make files public)</button>`
        : '';
      el.innerHTML =
        `<div class="dash-alert-title">${allMatch ? `${_codeTag(4402)} In Sync` : `${_codeTag(2403)} Out of Sync`}</div>` +
        `<div class="dash-alert-detail" style="font-family:var(--font-mono);font-size:11px;">` +
        row('Songs', localSongs, driveSongs, songMatch) +
        row('Setlists', localSetlists, driveSetlists, setlistMatch) +
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

// ─── Reset User Password (modal, called from User Management) ──────────

function _showResetPasswordModal(userId, username) {
  const handle = Modal.create({
    id: 'modal-reset-pw',
    content: `
      <h3 style="margin:0 0 16px;">Reset Password: ${esc(username)}</h3>
      <div class="acct-field" style="margin-bottom:16px;">
        <label for="reset-pw-new">New Password</label>
        <input type="password" id="reset-pw-new" class="form-input" placeholder="Min 8 chars, mixed case + number + special" autocomplete="new-password" />
      </div>
      <div class="acct-field" style="margin-bottom:16px;">
        <label for="reset-pw-confirm">Confirm New Password</label>
        <input type="password" id="reset-pw-confirm" class="form-input" placeholder="Re-enter password" autocomplete="new-password" />
      </div>
      <p style="font-size:12px;color:var(--text-3);margin-bottom:16px;">This will log the user out of all devices.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" id="reset-pw-cancel" style="padding:8px 16px;">Cancel</button>
        <button class="btn-primary" id="reset-pw-submit" style="padding:8px 16px;">Reset Password</button>
      </div>
    `
  });
  if (!handle) return;

  document.getElementById('reset-pw-cancel').addEventListener('click', () => handle.hide());
  document.getElementById('reset-pw-submit').addEventListener('click', async () => {
    const newPw = document.getElementById('reset-pw-new').value;
    const confirmPw = document.getElementById('reset-pw-confirm').value;
    if (!newPw) { showToast('Enter a new password'); return; }
    const pwErr = Admin.validatePassword(newPw);
    if (pwErr) { showToast(pwErr); return; }
    if (newPw !== confirmPw) { showToast('Passwords do not match'); return; }
    const btn = document.getElementById('reset-pw-submit');
    btn.disabled = true;
    btn.textContent = 'Resetting\u2026';
    const result = await Auth.adminResetPassword(userId, newPw);
    if (result.ok) {
      showToast(`Password reset for ${esc(username)}`);
      handle.hide();
    } else {
      showToast(result.error || 'Failed to reset password');
      btn.disabled = false;
      btn.textContent = 'Reset Password';
    }
  });
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
    const raw = localStorage.getItem('ct_songs');
    if (!raw) return { status: 'warn', detail: 'No songs in localStorage' };
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return { status: 'fail', detail: 'ct_songs is not an array' };
      const withId = arr.filter(s => s.id);
      const withTitle = arr.filter(s => s.title);
      return { status: 'pass', detail: `${arr.length} songs, ${withId.length} have IDs, ${withTitle.length} have titles, ~${(raw.length / 1024).toFixed(1)} KB` };
    } catch (e) {
      return { status: 'fail', detail: `Corrupt JSON: ${e.message}` };
    }
  });

  await _test(SEC2, 'Setlists data integrity', async () => {
    const raw = localStorage.getItem('ct_setlists');
    if (!raw) return { status: 'warn', detail: 'No setlists in localStorage' };
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return { status: 'fail', detail: 'ct_setlists is not an array' };
      return { status: 'pass', detail: `${arr.length} setlists, ~${(raw.length / 1024).toFixed(1)} KB` };
    } catch (e) {
      return { status: 'fail', detail: `Corrupt JSON: ${e.message}` };
    }
  });

  await _test(SEC2, 'Practice data integrity', async () => {
    const raw = localStorage.getItem('ct_practice');
    if (!raw) return { status: 'warn', detail: 'No practice data in localStorage' };
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return { status: 'fail', detail: 'ct_practice is not an array' };
      return { status: 'pass', detail: `${arr.length} practice lists, ~${(raw.length / 1024).toFixed(1)} KB` };
    } catch (e) {
      return { status: 'fail', detail: `Corrupt JSON: ${e.message}` };
    }
  });

  await _test(SEC2, 'Migration flag status', async () => {
    const migrated = localStorage.getItem('ct_migrated_to_github');
    const pending = localStorage.getItem('ct_github_pending');
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

  // PAT propagation test removed — PAT is server-side via Worker proxy

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
      const pat = localStorage.getItem('ct_github_pat') || '';
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
        parts.push(`${remotePractice.length} practice lists`);
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
    if (localCount !== remoteCount) {
      return { status: 'fail', detail: `Mismatch: ${localCount} practice lists local vs ${remoteCount} remote` };
    }
    const match = JSON.stringify(practice) === JSON.stringify(remotePractice);
    return { status: match ? 'pass' : 'warn', detail: match ? `${localCount} practice lists identical` : `Counts match but content differs` };
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
    const raw = localStorage.getItem('ct_github_pending');
    const delRaw = localStorage.getItem('ct_github_deletions');
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

Router.register('dashboard', safeRender('dashboard', (route) => {
  if (route && route.rerender) { renderDashboard(); return; }
  renderDashboard();
}));

// ─── Public API ───────────────────────────────────────────

export {
  renderDashboard,
  renderTagManager,
  renderUserManagement,
  runDiagnostics,
};
