/**
 * app.js — Main application logic (ES module entry point)
 */

import * as Store from './js/store.js';
import { esc, haptic, showToast, isIOS, isPWAInstalled, isMobile as isMobileUtil, detectPlatform } from './js/utils.js';
import * as Modal from './js/modal.js';
import * as Router from './js/router.js';
import * as Sync from './js/sync.js';
import * as Drive from './drive.js';
import * as GitHub from './github.js';
import * as Admin from './admin.js';
import * as Auth from './auth.js';
import * as Player from './player.js';
import * as Songs from './js/songs.js';
import * as Setlists from './js/setlists.js';
import * as Practice from './js/practice.js';
import * as Dashboard from './js/dashboard.js';
import * as Migrate from './js/migrate.js';
import * as IDB from './idb.js';

const APP_VERSION = Store.get('APP_VERSION');

let _songs      = [];
let _setlists   = [];
let _view       = 'list';
let _showViewCalled = false;
let _searchText = '';
let _activeTags = [];
let _activeKeys = [];
let _blobCache  = {};
let _playerRefs = [];
let _navStack   = [];
let _activeSetlist = null;
let _practice = [];
let _activePracticeList = null;

// ─── Hash routing (delegated to Router module) ──────────────
let _isPopstateNavigation = false;
let _currentRouteParams = {};
function _setRouteParams(p) { _currentRouteParams = p; Store.set('currentRouteParams', p); }
const _viewToHash      = Router.viewToHash;
const _resolveHash     = Router.resolveHash;
function _navigateToRoute(route) { Router.navigateToRoute(route); }
let _cachedPdfSet = new Set();

  // ─── Blob cache (LRU, max 30 entries) ────────────────────

  const BLOB_CACHE_MAX = 30;
  let _blobCacheOrder = []; // LRU tracking: oldest first

  function _revokeBlobCache() {
    Object.values(_blobCache).forEach(u => URL.revokeObjectURL(u));
    _blobCache = {};
    _blobCacheOrder = [];
    _cleanupPlayers();
  }

  /**
   * Destroy player instances and stop audio WITHOUT revoking the blob cache.
   * Use this on view transitions — the LRU cache handles memory management.
   * Only use _revokeBlobCache() for hard resets (e.g., leaving live mode).
   */
  function _cleanupPlayers() {
    _playerRefs.forEach(p => { try { p.destroy(); } catch(e) {} });
    _playerRefs = [];
    Player.stopAll();
  }

  // ─── Auth UI helper ─────────────────────────────────────────
  function _updateAuthUI() {
    const btn = document.getElementById('btn-auth-toggle');
    const addBtn = document.getElementById('btn-add-song');
    const accountBtn = document.getElementById('btn-account');
    const setlistsBtn = document.getElementById('btn-setlists');
    const practiceBtn = document.getElementById('btn-practice');
    const loggedIn = Auth.isLoggedIn();

    // Toggle body classes for CSS-driven auth gating
    document.body.classList.toggle('authed', loggedIn);
    const isAdmin = loggedIn && Auth.canEditSongs();
    document.body.classList.toggle('is-admin', isAdmin);
    document.body.classList.toggle('is-mobile', 'ontouchstart' in window || navigator.maxTouchPoints > 0);

    if (loggedIn) {
      if (btn) { btn.textContent = 'Log Out'; btn.title = 'Log Out'; btn.setAttribute('aria-label', 'Log Out'); }
      addBtn?.classList.toggle('hidden', !Auth.canEditSongs());
      accountBtn?.classList.remove('hidden');
      setlistsBtn?.classList.remove('hidden');
      practiceBtn?.classList.remove('hidden');
      setlistsBtn?.classList.remove('disabled-nav');
      practiceBtn?.classList.remove('disabled-nav');
    } else {
      if (btn) { btn.textContent = 'Log In'; btn.title = 'Log In'; btn.setAttribute('aria-label', 'Log In'); }
      addBtn?.classList.add('hidden');
      accountBtn?.classList.add('hidden');
      // Keep buttons visible but styled as disabled for unauth users
      setlistsBtn?.classList.remove('hidden');
      practiceBtn?.classList.remove('hidden');
      setlistsBtn?.classList.add('disabled-nav');
      practiceBtn?.classList.add('disabled-nav');
    }

    // Show/hide the unauth message on the main page
    const unauthMsg = document.getElementById('unauth-message');
    if (unauthMsg) unauthMsg.classList.toggle('hidden', loggedIn);
  }

  function _evictBlobCache() {
    // Collect blob URLs actively used by players — never evict these
    const activeUrls = new Set();
    _playerRefs.forEach(ref => {
      if (ref && ref.audio && ref.audio.src) activeUrls.add(ref.audio.src);
    });
    let skipped = 0;
    while (_blobCacheOrder.length > BLOB_CACHE_MAX && skipped < _blobCacheOrder.length) {
      const oldest = _blobCacheOrder.shift();
      if (_blobCache[oldest] && activeUrls.has(_blobCache[oldest])) {
        // Still in use — re-add to end, track to prevent infinite loop
        _blobCacheOrder.push(oldest);
        skipped++;
        continue;
      }
      skipped = 0;
      if (_blobCache[oldest]) {
        URL.revokeObjectURL(_blobCache[oldest]);
        delete _blobCache[oldest];
      }
    }
  }

  async function _getBlobUrl(fileId) {
    if (_blobCache[fileId]) {
      // Move to end (most recently used)
      const idx = _blobCacheOrder.indexOf(fileId);
      if (idx > -1) _blobCacheOrder.splice(idx, 1);
      _blobCacheOrder.push(fileId);
      return _blobCache[fileId];
    }

    // Try PDF cache from service worker first
    const cachedBlob = await _getCachedPdfBlob(fileId);
    if (cachedBlob) {
      const url = URL.createObjectURL(cachedBlob);
      _blobCache[fileId] = url;
      _blobCacheOrder.push(fileId);
      _evictBlobCache();
      return url;
    }

    // Determine R2 file ID: either directly an R2 ID, or look up from a Drive ID
    let url;
    const r2Id = _findR2FileId(fileId) || (_isR2FileId(fileId) ? fileId : null);
    if (Sync.useCloudflare() && r2Id) {
      const token = Auth.getToken ? Auth.getToken() : null;
      const resp = await fetch(GitHub.workerUrl + '/files/' + r2Id, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error('R2 fetch failed: ' + resp.status);
      const blob = await resp.blob();
      url = URL.createObjectURL(blob);
    } else {
      try {
        url = await Drive.fetchFileAsBlob(fileId);
      } catch (firstErr) {
        console.warn('Drive fetch failed, retrying in 2s:', fileId, firstErr);
        await new Promise(r => setTimeout(r, 2000));
        url = await Drive.fetchFileAsBlob(fileId);
      }
    }
    _blobCache[fileId] = url;
    _blobCacheOrder.push(fileId);
    _evictBlobCache();

    // Cache the PDF blob in the service worker (fire and forget)
    _cachePdfBlob(fileId, url);

    return url;
  }

  // Check if an ID looks like an R2 file ID (16-char hex from app-data.js _generateId)
  function _isR2FileId(id) {
    return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id);
  }

  // Look up R2 file ID for a given Drive ID across all songs
  function _findR2FileId(driveId) {
    const songs = Store.get('songs') || [];
    for (const song of songs) {
      if (!song.assets) continue;
      for (const c of (song.assets.charts || [])) {
        if (c.driveId === driveId && c.r2FileId) return c.r2FileId;
      }
      for (const a of (song.assets.audio || [])) {
        if (a.driveId === driveId && a.r2FileId) return a.r2FileId;
      }
    }
    return null;
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
      document.querySelectorAll(`.pdf-cached-badge[data-cache-id="${CSS.escape(driveId)}"]`).forEach(el => {
        el.classList.add('cached');
        el.title = 'Available offline';
        // Swap icon from cloud to cloud-check
        const icon = el.querySelector('[data-lucide]');
        if (icon) {
          icon.setAttribute('data-lucide', 'cloud-check');
          if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
        }
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

  const _isIOS = isIOS;

  async function _downloadFile(driveId, filename, btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="dl-spinner"></span>';

    try {
      if (!driveId) throw new Error('No file ID');
      if (_isIOS() && !Sync.useCloudflare()) {
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

  // ─── Data layer (delegated to Sync module) ──────────────────
  const DATA_SCHEMA_VERSION = Store.get('DATA_SCHEMA_VERSION');
  const _migrateSchema = Sync.migrateSchema;
  const _saveLocal = Sync.saveLocal;

  async function loadSongsInstant() {
    await Sync.loadSongsInstant();
    _songs = Store.get('songs');
  }

  // ─── Sync (delegated to Sync module) ─────────────────────────
  const _tryAutoConfigureGitHub = Sync.tryAutoConfigureGitHub;

  async function _syncAllFromDrive(force) {
    await Sync.syncAll(force);
    // Refresh local state from Store after sync
    _songs = Store.get('songs');
    _setlists = Store.get('setlists');
    _practice = Store.get('practice');
    _activeKeys = Store.get('activeKeys');
  }

  function _doSyncRefresh(afterCallback) {
    return Sync.doSyncRefresh(afterCallback).then(() => {
      _songs = Store.get('songs');
      _setlists = Store.get('setlists');
      _practice = Store.get('practice');
    });
  }

  async function saveSongs(toastMsg) {
    Store.set('songs', _songs);
    return Sync.saveSongs(toastMsg);
  }

  // ─── Setlists data (delegated to Sync) ──────────────────────
  const _saveSetlistsLocal = Sync.saveSetlistsLocal;

  async function loadSetlistsInstant() {
    await Sync.loadSetlistsInstant();
    _setlists = Store.get('setlists');
  }

  async function saveSetlists(toastMsg) {
    Store.set('setlists', _setlists);
    return Sync.saveSetlists(toastMsg);
  }

  // ─── View management (delegated to Router) ──────────────────
  function _showView(name)  { _view = name; _showViewCalled = true; Router.showView(name); }
  const _setTopbar     = Router.setTopbar;
  function _pushNav(fn) { _navStack.push(fn); Router.pushNav(fn); }
  function _navigateBack() { Router.navigateBack(); _view = Store.get('view'); }

  // ─── SONGS (delegated to Songs module) ──────────────────────
  function renderList(force) { Songs.renderList(force); }
  function renderDetail(song, skipNavPush) { Songs.renderDetail(song, skipNavPush); }
  function renderEdit(song, isNew) { Songs.renderEdit(song, isNew); }
  function _allTags() { return Songs.allTags(); }
  function _allKeys() { return Songs.allKeys(); }
  function _filteredSongs() { return Songs.filteredSongs(); }
  function _exitSelectionMode() { Songs.exitSelectionMode(); }


  // (Song list/detail/edit code extracted to js/songs.js)

  // ─── SETLISTS (delegated to Setlists module) ──────────────
  function renderSetlists(skipNavReset) { Setlists.renderSetlists(skipNavReset); }
  function renderSetlistDetail(setlist, skipNavPush) { Setlists.renderSetlistDetail(setlist, skipNavPush); }
  function renderSetlistEdit(setlist, isNew, backToList) { Setlists.renderSetlistEdit(setlist, isNew, backToList); }

  // ─── ACCOUNT MANAGEMENT ─────────────────────────────────────

  function renderAccount() {
    _cleanupPlayers();
    Store.set('navStack', []);
    Router.pushNav(() => renderList());
    Router.showView('account');
    Router.setTopbar('My Account', true);

    // Add logout button to topbar right (mirrors back button on left)
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      // Remove any previous account-logout-topbar button
      topbarRight.querySelector('#acct-logout-topbar')?.remove();
      const logoutBtn = document.createElement('button');
      logoutBtn.id = 'acct-logout-topbar';
      logoutBtn.className = 'btn-ghost topbar-nav-btn';
      logoutBtn.title = 'Log Out';
      logoutBtn.setAttribute('aria-label', 'Log Out');
      logoutBtn.innerHTML = 'Log Out <i data-lucide="log-out" style="width:14px;height:14px;vertical-align:-2px;margin-left:4px;"></i>';
      topbarRight.appendChild(logoutBtn);
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [logoutBtn] });
      logoutBtn.addEventListener('click', async () => {
        await Auth.logout();
        Admin.resetAdminMode(false);
        _updateAuthUI();
        renderList();
        showToast('Logged out');
      });
    }

    const user = Auth.getUser();
    if (!user) return;

    const container = document.getElementById('account-content');

    container.innerHTML = `
      <div class="acct-page">
        <div class="acct-avatar">
          <i data-lucide="circle-user" style="width:64px;height:64px;color:var(--accent);"></i>
        </div>
        <div class="acct-username" style="font-size:18px;font-weight:600;margin-top:8px;">@${esc(user.username)}</div>
        <div class="acct-verify-status">
          ${user.emailVerified
            ? '<span class="acct-verified"><i data-lucide="badge-check" style="width:14px;height:14px;"></i> Verified</span>'
            : '<span class="acct-unverified">Unverified</span><button id="acct-resend-verify" class="btn-secondary acct-verify-btn">Resend Verification Email</button>'}
        </div>

        <div class="acct-section">
          <button class="acct-section-toggle" id="acct-toggle-email"><i data-lucide="mail" style="width:16px;height:16px;"></i> Change Email <i data-lucide="chevron-down" style="width:14px;height:14px;"></i></button>
          <div class="acct-section-body" id="acct-email-body" style="display:none;">
            <div class="acct-field">
              <label for="acct-new-email">New Email</label>
              <input type="email" id="acct-new-email" class="form-input" placeholder="new@email.com" autocomplete="email" maxlength="100" />
            </div>
            <div class="acct-field">
              <label for="acct-confirm-email">Confirm Email</label>
              <input type="email" id="acct-confirm-email" class="form-input" placeholder="Re-enter email" autocomplete="email" maxlength="100" />
            </div>
            <div class="acct-field">
              <label for="acct-email-pw">Current Password</label>
              <input type="password" id="acct-email-pw" class="form-input" placeholder="Verify your identity" autocomplete="current-password" />
            </div>
            <button class="btn-primary" id="acct-change-email">Update Email</button>
          </div>
        </div>

        <div class="acct-section">
          <button class="acct-section-toggle" id="acct-toggle-pw"><i data-lucide="lock" style="width:16px;height:16px;"></i> Change Password <i data-lucide="chevron-down" style="width:14px;height:14px;"></i></button>
          <div class="acct-section-body" id="acct-pw-body" style="display:none;">
            <div class="acct-field">
              <label for="acct-current-pw">Current Password</label>
              <input type="password" id="acct-current-pw" class="form-input" placeholder="Enter current password" autocomplete="current-password" />
            </div>
            <div class="acct-field">
              <label for="acct-new-pw">New Password</label>
              <input type="password" id="acct-new-pw" class="form-input" placeholder="Min 8 characters" autocomplete="new-password" />
            </div>
            <div class="acct-field">
              <label for="acct-confirm-pw">Confirm New Password</label>
              <input type="password" id="acct-confirm-pw" class="form-input" placeholder="Repeat new password" autocomplete="new-password" />
            </div>
            <button class="btn-primary" id="acct-change-pw">Change Password</button>
          </div>
        </div>

        <div class="acct-section">
          <button class="acct-section-toggle" id="acct-toggle-username"><i data-lucide="at-sign" style="width:16px;height:16px;"></i> Change Username <i data-lucide="chevron-down" style="width:14px;height:14px;"></i></button>
          <div class="acct-section-body" id="acct-username-body" style="display:none;">
            <div class="acct-field">
              <label for="acct-new-username">New Username</label>
              <input type="text" id="acct-new-username" class="form-input" placeholder="New username" maxlength="25" autocomplete="username" />
            </div>
            <div class="acct-field">
              <label for="acct-username-pw">Current Password</label>
              <input type="password" id="acct-username-pw" class="form-input" placeholder="Verify your identity" autocomplete="current-password" />
            </div>
            <button class="btn-primary" id="acct-change-username">Update Username</button>
          </div>
        </div>

        ${user.role !== 'owner' ? `
        <div class="acct-danger-zone" style="margin-top:40px;padding-top:20px;border-top:1px solid var(--border);">
          <button class="btn-secondary" id="acct-delete-account" style="color:var(--red);border-color:var(--red);width:100%;"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;"></i>Delete Account</button>
        </div>` : ''}

      </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Section toggle handlers
    container.querySelector('#acct-toggle-email')?.addEventListener('click', () => {
      const body = container.querySelector('#acct-email-body');
      const btn = container.querySelector('#acct-toggle-email');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      btn.classList.toggle('open', !open);
    });
    container.querySelector('#acct-toggle-pw')?.addEventListener('click', () => {
      const body = container.querySelector('#acct-pw-body');
      const btn = container.querySelector('#acct-toggle-pw');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      btn.classList.toggle('open', !open);
    });

    // Resend verification handler
    const resendBtn = container.querySelector('#acct-resend-verify');
    resendBtn?.addEventListener('click', async () => {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending\u2026';
      const result = await Auth.resendVerification();
      showToast(result.ok ? 'Verification email sent!' : (result.error || 'Failed to send email'));
      resendBtn.textContent = result.ok ? 'Sent!' : 'Resend Verification Email';
      if (!result.ok) resendBtn.disabled = false;
    });

    // Change email handler
    container.querySelector('#acct-change-email')?.addEventListener('click', async () => {
      const newEmail = document.getElementById('acct-new-email').value.trim();
      const confirmEmail = document.getElementById('acct-confirm-email').value.trim();
      const emailPw = document.getElementById('acct-email-pw').value;
      if (!newEmail) { showToast('Enter a new email'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { showToast('Enter a valid email address'); return; }
      if (newEmail !== confirmEmail) { showToast('Email addresses do not match'); return; }
      if (!emailPw) { showToast('Enter your current password to change email'); return; }
      const btn = container.querySelector('#acct-change-email');
      btn.disabled = true;
      btn.textContent = 'Updating...';
      try {
        const result = await Auth.changeEmail(newEmail, emailPw);
        if (result.ok) {
          showToast('Email updated — check your inbox to verify');
          renderAccount(); // re-render to show new status
        } else {
          showToast(result.error || 'Failed to update email');
          btn.disabled = false;
          btn.textContent = 'Update Email';
        }
      } catch (e) {
        showToast('Network error — check connection');
        btn.disabled = false;
        btn.textContent = 'Update Email';
      }
    });

    // Change password handler
    container.querySelector('#acct-change-pw')?.addEventListener('click', async () => {
      const currentPw = document.getElementById('acct-current-pw').value;
      const newPw = document.getElementById('acct-new-pw').value;
      const confirmPw = document.getElementById('acct-confirm-pw').value;

      if (!currentPw || !newPw) {
        showToast('Please fill in all password fields');
        return;
      }
      const pwError = Admin.validatePassword(newPw);
      if (pwError) {
        showToast(pwError);
        return;
      }
      if (newPw !== confirmPw) {
        showToast('New passwords do not match');
        return;
      }

      const btn = container.querySelector('#acct-change-pw');
      btn.disabled = true;
      btn.textContent = 'Changing...';

      try {
        const result = await Auth.changePassword(currentPw, newPw);
        if (result.ok) {
          showToast('Password changed — please log in again');
          _updateAuthUI();
          renderList();
        } else {
          showToast(result.error || 'Failed to change password');
          btn.disabled = false;
          btn.textContent = 'Change Password';
        }
      } catch (e) {
        showToast('Network error — check connection');
        btn.disabled = false;
        btn.textContent = 'Change Password';
      }
    });

    // Change username toggle + handler
    container.querySelector('#acct-toggle-username')?.addEventListener('click', () => {
      const body = container.querySelector('#acct-username-body');
      const btn = container.querySelector('#acct-toggle-username');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      btn.classList.toggle('open', !open);
    });
    container.querySelector('#acct-change-username')?.addEventListener('click', async () => {
      const newUsername = document.getElementById('acct-new-username').value.trim();
      const pw = document.getElementById('acct-username-pw').value;
      if (!newUsername) { showToast('Enter a new username'); return; }
      if (newUsername.length > 25) { showToast('Username must be 25 characters or less'); return; }
      if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) { showToast('Username can only contain letters, numbers, hyphens, and underscores'); return; }
      if (!pw) { showToast('Enter your current password'); return; }
      const btn = container.querySelector('#acct-change-username');
      btn.disabled = true;
      btn.textContent = 'Updating...';
      try {
        const result = await Auth.changeUsername(newUsername, pw);
        if (result.ok) {
          showToast('Username updated');
          renderAccount();
        } else {
          showToast(result.error || 'Failed to update username');
          btn.disabled = false;
          btn.textContent = 'Update Username';
        }
      } catch (e) {
        showToast('Network error — check connection');
        btn.disabled = false;
        btn.textContent = 'Update Username';
      }
    });

    // Delete account handler (non-admin only, 3-click confirmation)
    container.querySelector('#acct-delete-account')?.addEventListener('click', async () => {
      const confirmed1 = await Modal.confirm('Are you sure you want to delete your account? This cannot be undone.', 'Delete Account', 'Cancel');
      if (!confirmed1) return;
      const confirmed2 = await Modal.confirm('This is your final confirmation. Your account and all associated data will be permanently deleted.', 'Yes, Delete My Account', 'Go Back');
      if (!confirmed2) return;
      try {
        const result = await Auth.deleteAccount();
        if (result.ok) {
          showToast('Account deleted');
          Admin.resetAdminMode(false);
          _updateAuthUI();
          renderList();
        } else {
          showToast(result.error || 'Failed to delete account');
        }
      } catch (e) {
        showToast('Network error — check connection');
      }
    });

  }

  // ─── RESET PASSWORD VIEW ────────────────────────────────────

  function renderResetPassword(token) {
    Router.showView('account');
    Router.setTopbar('Reset Password', false);

    const container = document.getElementById('account-content');
    container.innerHTML = `
      <div class="acct-page">
        <div class="acct-avatar">
          <i data-lucide="key-round" style="width:48px;height:48px;color:var(--accent);"></i>
        </div>
        <div class="acct-name" style="margin-bottom:16px;">Set a New Password</div>
        <div class="acct-section">
          <div class="acct-field">
            <label for="reset-new-pw">New Password</label>
            <input type="password" id="reset-new-pw" class="form-input" placeholder="Min 8 chars, mixed case + number + special" autocomplete="new-password" />
          </div>
          <div class="acct-field">
            <label for="reset-confirm-pw">Confirm Password</label>
            <input type="password" id="reset-confirm-pw" class="form-input" placeholder="Re-enter password" autocomplete="new-password" />
          </div>
          <button class="btn-primary" id="reset-submit">Reset Password</button>
          <div id="reset-error" style="color:#e87c6a;margin-top:8px;display:none;"></div>
        </div>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    container.querySelector('#reset-submit')?.addEventListener('click', async () => {
      const newPw = document.getElementById('reset-new-pw').value;
      const confirmPw = document.getElementById('reset-confirm-pw').value;
      const errorEl = document.getElementById('reset-error');
      errorEl.style.display = 'none';

      const pwError = Admin.validatePassword(newPw);
      if (pwError) {
        errorEl.textContent = pwError;
        errorEl.style.display = 'block';
        return;
      }
      if (newPw !== confirmPw) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
      }

      const btn = container.querySelector('#reset-submit');
      btn.disabled = true;
      btn.textContent = 'Resetting...';

      try {
        const result = await Auth.resetPassword(token, newPw);
        if (result.ok) {
          showToast('Password reset! Please log in.');
          location.hash = '#';
          renderList();
        } else {
          errorEl.textContent = result.error || 'Reset failed';
          errorEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Reset Password';
        }
      } catch (e) {
        errorEl.textContent = 'Network error — check connection';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Reset Password';
      }
    });
  }

  // ─── VERIFY EMAIL VIEW ──────────────────────────────────────

  async function handleVerifyEmail(token) {
    showToast('Verifying email...');
    const result = await Auth.verifyEmailToken(token);
    location.hash = '#';
    renderList();
    _updateAuthUI();
    if (result.ok) {
      showToast('Email verified! You\'re all set.', 5000);
    } else {
      showToast(result.error || 'Verification failed', 5000);
    }
  }

  // ─── FORGOT PASSWORD MODAL ─────────────────────────────────

  function showForgotPasswordModal() {
    const handle = Modal.create({
      id: 'modal-forgot-password',
      content: `
        <h3>Forgot Password</h3>
        <p class="muted" style="margin:8px 0 16px;">Enter your email and we'll send a reset link.</p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <input type="email" id="forgot-email" class="form-input" placeholder="your@email.com" autocomplete="email" maxlength="100" />
          <div id="forgot-msg" style="display:none;margin-top:4px;"></div>
        </div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn-secondary" id="forgot-cancel">Cancel</button>
          <button class="btn-primary" id="forgot-submit">Send Reset Link</button>
        </div>
      `,
    });

    document.getElementById('forgot-cancel')?.addEventListener('click', () => handle.hide());
    document.getElementById('forgot-submit')?.addEventListener('click', async () => {
      const email = document.getElementById('forgot-email').value.trim();
      const msgEl = document.getElementById('forgot-msg');
      if (!email) {
        msgEl.textContent = 'Please enter your email';
        msgEl.style.color = '#e87c6a';
        msgEl.style.display = 'block';
        return;
      }
      const btn = document.getElementById('forgot-submit');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const result = await Auth.forgotPassword(email);
        if (result.ok) {
          msgEl.textContent = result.message || 'If that email is registered, a reset link has been sent.';
          msgEl.style.color = '#7ec87e';
        } else {
          msgEl.textContent = result.error || 'Something went wrong';
          msgEl.style.color = '#e87c6a';
        }
        msgEl.style.display = 'block';
      } catch (e) {
        msgEl.textContent = 'Network error — check connection';
        msgEl.style.color = '#e87c6a';
        msgEl.style.display = 'block';
      }
      btn.textContent = 'Send Reset Link';
      btn.disabled = false;
    });
    document.getElementById('forgot-email')?.focus();
  }

  // ─── EMAIL VERIFICATION GUARD ──────────────────────────────

  function _checkEmailVerified(featureName) {
    if (!Auth.isLoggedIn()) return false;
    if (Auth.isEmailVerified()) return true;
    // Owner with hardcoded email is auto-verified
    const user = Auth.getUser();
    if (user && user.role === 'owner') return true;
    showToast(`Please verify your email to access ${featureName}`);
    return false;
  }

  // ─── PASSWORD EXPIRY CHECK ────────────────────────────────

  function _checkPasswordExpiry() {
    if (!Auth.isLoggedIn()) return;
    if (!Auth.isPasswordExpired()) return;
    // Show a one-time toast and redirect to account page
    showToast('Your password has expired — please change it');
    renderAccount();
  }

  // ─── ADMIN DASHBOARD ────────────────────────────────────────

  function renderDashboard() { Dashboard.renderDashboard(); }


  // ─── PRACTICE (delegated to Practice module) ──────────────
  function renderPractice(skipNavReset) { Practice.renderPractice(skipNavReset); }
  function renderPracticeListDetail(practiceList, skipNavPush) { Practice.renderPracticeListDetail(practiceList, skipNavPush); }
  async function loadPracticeInstant() { await Practice.loadPracticeInstant(); _practice = Store.get('practice'); }
  function _migratePracticeData() { Practice.migratePracticeData(); _practice = Store.get('practice'); }
  async function savePractice(toastMsg) { return Practice.savePractice(toastMsg); }

  // ─── Init ──────────────────────────────────────────────────

  // ─── PWA Install Gate ──────────────────────────────────────

  const _isPWAInstalled = isPWAInstalled;
  const _isMobile       = isMobileUtil;
  const _detectPlatform = detectPlatform;

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

  // ─── Install Banner (Feature 2) ─────────────────────────────

  let _deferredInstallPrompt = null;

  function _showInstallBanner() {
    if (localStorage.getItem('ct_install_dismissed')) return;
    if (_isPWAInstalled()) return;
    if (document.querySelector('.install-banner')) return;
    const searchBar = document.getElementById('search-bar');
    if (!searchBar) return;
    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `
      <i data-lucide="download" style="width:20px;height:20px;color:var(--accent);flex-shrink:0;"></i>
      <span class="install-banner-text">Install Catman Trio for quick access and offline use.</span>
      <button class="install-banner-btn">Install</button>
      <button class="install-banner-dismiss" aria-label="Dismiss"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
    `;
    searchBar.insertAdjacentElement('afterend', banner);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [banner] });
    banner.querySelector('.install-banner-btn').addEventListener('click', async () => {
      if (_deferredInstallPrompt) {
        _deferredInstallPrompt.prompt();
        const result = await _deferredInstallPrompt.userChoice;
        if (result.outcome === 'accepted') showToast('App installed!');
        _deferredInstallPrompt = null;
      }
      banner.remove();
    });
    banner.querySelector('.install-banner-dismiss').addEventListener('click', () => {
      localStorage.setItem('ct_install_dismissed', '1');
      banner.remove();
    });
  }

  function _showIOSInstallHint() {
    if (localStorage.getItem('ct_install_dismissed')) return;
    if (document.querySelector('.install-banner')) return;
    const searchBar = document.getElementById('search-bar');
    if (!searchBar) return;
    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `
      <i data-lucide="share" style="width:20px;height:20px;color:var(--accent);flex-shrink:0;"></i>
      <span class="install-banner-text">Tap <strong>Share</strong> then <strong>"Add to Home Screen"</strong> for the best experience.</span>
      <button class="install-banner-dismiss" aria-label="Dismiss"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
    `;
    searchBar.insertAdjacentElement('afterend', banner);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [banner] });
    banner.querySelector('.install-banner-dismiss').addEventListener('click', () => {
      localStorage.setItem('ct_install_dismissed', '1');
      banner.remove();
    });
  }

  // ─── Welcome Overlay (Feature 9) ──────────────────────────

  function _showWelcomeOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'welcome-overlay';
    overlay.innerHTML = `
      <div class="welcome-content">
        <div class="welcome-logo">CT</div>
        <div class="welcome-title">Catman Trio</div>
        <div class="welcome-subtitle">Your band's song repository, setlists, and practice lists - all in one place.</div>
        <div class="welcome-steps">
          <div class="welcome-step">
            <span class="welcome-step-num">1</span>
            <span>Connect to <strong>GitHub</strong> to sync your data across devices</span>
          </div>
          <div class="welcome-step">
            <span class="welcome-step-num">2</span>
            <span>Add songs with charts, audio demos, and streaming links</span>
          </div>
          <div class="welcome-step">
            <span class="welcome-step-num">3</span>
            <span>Create setlists and practice lists for your gigs</span>
          </div>
        </div>
        <button class="welcome-start-btn" id="welcome-start">Get Started</button>
        <button class="welcome-skip-btn" id="welcome-skip">Skip for now</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#welcome-start').addEventListener('click', () => {
      localStorage.setItem('ct_welcome_seen', '1');
      overlay.remove();
      Admin.showGitHubModal(() => { _syncAllFromDrive(true); });
    });
    overlay.querySelector('#welcome-skip').addEventListener('click', () => {
      localStorage.setItem('ct_welcome_seen', '1');
      overlay.remove();
    });
  }

  // ─── Init ──────────────────────────────────────────────────

  async function init() {
    // Clear app badge on open (user has seen the app)
    navigator.clearAppBadge?.()?.catch?.(() => {});

    // Run one-time storage migrations (bb_ → ct_, etc.) before anything else
    Migrate.runAll();
    // Safety: dismiss splash after 2.5s no matter what (don't strand user)
    const _splashSafety = setTimeout(() => {
      const s = document.getElementById('splash-screen');
      if (s) { s.classList.add('fade-out'); setTimeout(() => s.remove(), 300); }
    }, 2500);

    // Show loading skeleton immediately so the user sees activity on cold start
    // (must happen before any await to avoid black-screen perception)
    const songList = document.getElementById('song-list');
    if (songList && !songList.children.length) {
      songList.innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');
    }

    // Refresh auth session (non-blocking — uses cached data if offline)
    Auth.refreshSession().catch(e => console.warn('Auth refresh failed:', e));

    // Initialize IndexedDB (before loading data) — with timeout to prevent hanging
    try {
      await Promise.race([
        IDB.open(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 5000))
      ]);
    } catch (e) { console.warn('IDB init failed, using localStorage fallback', e); }

    // Restore pending writes AFTER IDB is open (avoids race where IDB data is missed)
    await GitHub.init();

    // Register SW early so the install prompt can work
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' })
        .then(reg => {
          console.info('SW registered:', reg.scope);
          // ── Update notification helpers ──
          function _promptSkipWaiting(waitingSW) {
            const el = document.getElementById('toast');
            showToast('Update available \u2014 tap to refresh', 5000);
            // Allow tap-to-refresh
            function _onTap() {
              if (el) el.removeEventListener('click', _onTap);
              waitingSW.postMessage({ type: 'SKIP_WAITING' });
            }
            if (el) el.addEventListener('click', _onTap, { once: true });
            // Auto-refresh after 5s if user doesn't tap
            setTimeout(() => {
              if (el) el.removeEventListener('click', _onTap);
              waitingSW.postMessage({ type: 'SKIP_WAITING' });
            }, 5000);
          }

          // If a SW is already waiting when we register (e.g. installed in background)
          if (reg.waiting && navigator.serviceWorker.controller) {
            _promptSkipWaiting(reg.waiting);
          }

          // Notify user when a new version finishes installing
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                _promptSkipWaiting(newWorker);
              }
              if (newWorker.state === 'redundant') {
                console.warn('SW update failed (became redundant)');
              }
            });
          });
          // Reload page once the new SW takes control
          let _refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (_refreshing) return;
            _refreshing = true;
            showToast('App updated to ' + APP_VERSION + ' \u2014 refreshing\u2026', 2000);
            setTimeout(() => location.reload(), 1500);
          });
          // Proactively check for updates on every page load
          reg.update().catch(() => {});
        })
        .catch(e => console.warn('SW registration failed:', e));
      // Load cached PDF list once SW is ready
      navigator.serviceWorker.ready.then(() => _loadCachedPdfList()).catch(() => {});
    }

    // ─── Hash-based routing listener ────────────────────────
    window.addEventListener('popstate', (e) => {
      // Live Mode pushes its own history state — let its handler deal with it
      if (Setlists.isLiveModeActive()) return;
      _isPopstateNavigation = true;
      Store.set('isPopstateNavigation', true);
      // Pop one entry from navStack (mirrors the browser going back one page)
      // instead of wiping the entire stack, so in-app back still works after.
      const navStack = Store.get('navStack');
      if (navStack.length > 0) navStack.pop();
      _navStack = [...navStack]; // sync local shadow copy
      try {
        const route = _resolveHash(location.hash);
        if (route.view === 'verify-email' && route.token) {
          handleVerifyEmail(route.token);
        } else if (route.view === 'reset-password' && route.token) {
          renderResetPassword(route.token);
        } else {
          _navigateToRoute(route);
        }
      } finally {
        _isPopstateNavigation = false;
        Store.set('isPopstateNavigation', false);
      }
    });

    // Feature 2: beforeinstallprompt handler
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      _deferredInstallPrompt = e;
      _showInstallBanner();
      // Also show the install button in the admin bar
      const ib = document.getElementById('btn-install-app');
      if (ib) ib.classList.remove('hidden');
    });

    // Hide install UI after the app is installed
    window.addEventListener('appinstalled', () => {
      _deferredInstallPrompt = null;
      const ib = document.getElementById('btn-install-app');
      if (ib) ib.classList.add('hidden');
      const banner = document.querySelector('.install-banner');
      if (banner) banner.remove();
    });

    // Request persistent storage to prevent eviction
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // PWA install gate — mobile browsers only
    if (_isMobile() && !_isPWAInstalled()) {
      _showInstallGate();
      return; // Don't load the app
    }

    // Tag body for mobile-specific CSS (backup for @media pointer/hover queries)
    if (_isMobile()) document.body.classList.add('is-mobile');

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

    document.getElementById('btn-back').addEventListener('click', () => {
      _navigateBack();
    });

    // Auth toggle: Log In / Log Out
    document.getElementById('btn-auth-toggle').addEventListener('click', async () => {
      haptic.double();
      if (Auth.isLoggedIn()) {
        // Logged in — log out
        await Auth.logout();
        Admin.resetAdminMode(false);
        _updateAuthUI();
        renderList();
        showToast('Logged out');
      } else if (GitHub.useWorker) {
        // User accounts available — show login modal
        Admin.showLoginModal(() => {
          Admin.resetAdminMode();
          _updateAuthUI();
          renderList();
        });
      } else {
        // Legacy password flow
        Admin.showPasswordModal(() => {
          Admin.enterEditMode();
          _updateAuthUI();
          renderList();
        });
      }
    });

    // Title click: admin on desktop + songs page → dashboard; otherwise → home
    document.getElementById('topbar-title').addEventListener('click', () => {
      const onSongList = Store.get('view') === 'list';
      const isAdmin = Auth.isLoggedIn() && Auth.canEditSongs();
      if (onSongList && isAdmin) {
        renderDashboard();
      } else {
        renderList();
      }
    });

    document.getElementById('btn-account').addEventListener('click', () => {
      if (Auth.isLoggedIn()) {
        renderAccount();
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

    // PWA Install button in admin bar
    const installBtn = document.getElementById('btn-install-app');
    if (installBtn) {
      // Show if beforeinstallprompt already fired before this listener was attached
      if (_deferredInstallPrompt && !_isPWAInstalled()) {
        installBtn.classList.remove('hidden');
      }
      installBtn.addEventListener('click', async () => {
        if (_deferredInstallPrompt) {
          _deferredInstallPrompt.prompt();
          const result = await _deferredInstallPrompt.userChoice;
          if (result.outcome === 'accepted') {
            showToast('App installed!');
          }
          _deferredInstallPrompt = null;
          installBtn.classList.add('hidden');
        }
      });
    }

    let _searchTimer = null;
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear');

    // Unauth: clicking the search bar area shows a login prompt
    document.getElementById('search-bar')?.addEventListener('click', (e) => {
      if (!Auth.isLoggedIn()) {
        showToast('Log in to search and browse songs');
      }
    });

    // Show/hide the X whenever any filter is active (search text, tags, or keys)
    function _updateClearBtnVisibility() {
      if (searchClearBtn) {
        const hasAny = _searchText || _activeTags.length > 0 || _activeKeys.length > 0;
        searchClearBtn.classList.toggle('hidden', !hasAny);
      }
    }

    searchInput.addEventListener('input', e => {
      _searchText = e.target.value;
      Store.set('searchText', _searchText);
      _updateClearBtnVisibility();
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => renderList(), 30);
    });
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        _searchText = '';
        _activeTags = [];
        _activeKeys = [];
        Store.set('searchText', '');
        Store.set('activeTags', []);
        Store.set('activeKeys', []);
        searchInput.value = '';
        // Scroll pill bars back to start
        const tagBar = document.getElementById('tag-filter-bar');
        const keyBar = document.getElementById('key-filter-bar');
        if (tagBar) tagBar.scrollLeft = 0;
        if (keyBar) keyBar.scrollLeft = 0;
        _updateClearBtnVisibility();
        renderList();
        searchInput.focus();
      });
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [searchClearBtn] });
    }

    // Refresh button — full hard refresh: clear SW cache + reload for fresh source + data
    // Throttle: max 2 refreshes per 10 seconds
    const REFRESH_WINDOW = 10000;
    const REFRESH_MAX = 2;
    let _refreshTimes = [];
    try {
      const raw = sessionStorage.getItem('ct_refresh_times');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) _refreshTimes = parsed.filter(t => typeof t === 'number' && isFinite(t));
      }
    } catch (_) { /* corrupted or unavailable — start fresh */ }
    // (clear-filters merged into search-clear X button above)

    document.getElementById('btn-refresh').addEventListener('click', async () => {
      const now = Date.now();
      _refreshTimes = _refreshTimes.filter(t => now - t < REFRESH_WINDOW);
      if (_refreshTimes.length >= REFRESH_MAX) {
        showToast('Please wait a moment before refreshing again.');
        return;
      }
      _refreshTimes.push(now);
      try { sessionStorage.setItem('ct_refresh_times', JSON.stringify(_refreshTimes)); } catch (_) {}

      const wasPtr = _ptrTriggered;
      _ptrTriggered = false;
      await Sync.doSyncRefresh(() => {
        // Re-render current view after sync
        Router.rerenderCurrentView();
      });
    });

    // Topbar refresh button (shown on setlists/practice views — syncs data only)
    document.getElementById('btn-topbar-refresh')?.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) return;
      Sync.doSyncRefresh();
    });

    // Pull-to-refresh with visual indicator
    // _ptrTriggered is declared here so the refresh handler closure above can access it
    var _ptrTriggered = false; // suppress toast when refresh comes from PTR
    {
      const songListScroll = document.getElementById('song-list-scroll');
      const ptrEl = document.getElementById('ptr-indicator');
      const ptrText = ptrEl?.querySelector('.ptr-text');
      let _ptrStartY = 0, _ptrActive = false, _ptrPulling = false;
      const PTR_THRESHOLD = 220;
      const PTR_MAX = 270;

      function _getScrollTop() {
        return songListScroll ? songListScroll.scrollTop : 0;
      }

      songListScroll.addEventListener('touchstart', (e) => {
        if (!Auth.isLoggedIn() || _view !== 'list' || Store.get('selectionMode') || _getScrollTop() > 5) return;
        _ptrStartY = e.touches[0].clientY;
        _ptrActive = true;
        _ptrPulling = false;
      }, { passive: true });

      songListScroll.addEventListener('touchmove', (e) => {
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

      songListScroll.addEventListener('touchend', (e) => {
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
          // Data-only refresh — no page reload, UI stays stable
          (async () => {
            try {
              await _syncAllFromDrive(true);
            } catch (e) {
              console.warn('PTR sync failed', e);
            } finally {
              ptrEl.style.height = '0';
              ptrEl.classList.remove('ptr-pulling', 'ptr-ready', 'ptr-refreshing');
              if (ptrText) ptrText.textContent = 'Pull down to refresh';
            }
          })();
        } else {
          // Snap back
          ptrEl.style.height = '0';
          ptrEl.classList.remove('ptr-pulling', 'ptr-ready', 'ptr-refreshing');
          if (ptrText) ptrText.textContent = 'Pull down to refresh';
        }
      }, { passive: true });
    }

    // Feature 8: PTR first-use hint for mobile
    if (_isMobile() && !localStorage.getItem('ct_ptr_seen')) {
      setTimeout(() => {
        const ptrEl = document.getElementById('ptr-indicator');
        if (!ptrEl || _view !== 'list') return;
        ptrEl.classList.add('ptr-hint');
        ptrEl.style.height = '40px';
        const ptrText = ptrEl.querySelector('.ptr-text');
        if (ptrText) ptrText.textContent = 'Pull down to refresh';
        setTimeout(() => {
          ptrEl.style.height = '0';
          ptrEl.classList.remove('ptr-hint');
          localStorage.setItem('ct_ptr_seen', '1');
        }, 2500);
      }, 4000);
    }

    // ─── Swipe-to-go-back (iOS-style edge swipe) ──────────────
    {
      const appEl = document.getElementById('app');
      let _swStartX = 0, _swStartY = 0, _swSwiping = false, _swLocked = false;
      const SW_MIN_DIST = 80;       // minimum horizontal px to trigger back
      const SW_EDGE_ZONE = 0.4;     // left 40% of screen

      appEl.addEventListener('touchstart', (e) => {
        if (!_navStack.length || Setlists.isLiveModeActive()) return;
        const t = e.touches[0];
        // Only start from the left edge zone
        if (t.clientX > window.innerWidth * SW_EDGE_ZONE) return;
        // Don't swipe when interacting with audio player controls (scrubbing, sliders)
        const target = e.target;
        if (target.closest('.audio-player') || target.closest('.audio-progress') ||
            target.closest('input[type="range"]') || target.closest('.volume-slider')) return;
        _swStartX = t.clientX;
        _swStartY = t.clientY;
        _swSwiping = true;
        _swLocked = false;
      }, { passive: true });

      appEl.addEventListener('touchmove', (e) => {
        if (!_swSwiping) return;
        const t = e.touches[0];
        const dx = t.clientX - _swStartX;
        const dy = t.clientY - _swStartY;

        // Once we know direction, lock it in
        if (!_swLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
          if (Math.abs(dy) > Math.abs(dx)) {
            // Vertical scroll — abort swipe
            _swSwiping = false;
            return;
          }
          _swLocked = true; // horizontal confirmed
        }

        if (!_swLocked) return;

        // Prevent vertical scroll while swiping back
        e.preventDefault();

        // Visual feedback on the active view
        const activeView = appEl.querySelector('.view.active');
        if (activeView && dx > 0) {
          activeView.classList.add('swipe-back-active');
          activeView.classList.remove('swipe-back-snap');
          const clamped = Math.min(dx, 200);
          const opacity = 1 - (clamped / 600); // subtle fade
          activeView.style.transform = 'translateX(' + clamped + 'px)';
          activeView.style.opacity = opacity;
        }
      }, { passive: false });

      appEl.addEventListener('touchend', (e) => {
        if (!_swSwiping) return;
        _swSwiping = false;
        const dx = (e.changedTouches[0]?.clientX || 0) - _swStartX;
        const dy = (e.changedTouches[0]?.clientY || 0) - _swStartY;
        const activeView = appEl.querySelector('.view.active');

        // Check if swipe qualifies: enough distance, more horizontal than vertical
        if (_swLocked && dx >= SW_MIN_DIST && Math.abs(dx) > Math.abs(dy) && _navStack.length) {
          haptic.tap();
          // Snap off-screen then navigate
          if (activeView) {
            activeView.classList.remove('swipe-back-active');
            activeView.classList.add('swipe-back-snap');
            activeView.style.transform = 'translateX(100%)';
            activeView.style.opacity = '0';
            setTimeout(() => {
              // Navigate while outgoing view is still sliding out — skip view transition animation
              Store.set('skipViewTransition', true);
              _navigateBack();
              // Clean up styles after navigation renders the new view
              requestAnimationFrame(() => {
                activeView.style.transform = '';
                activeView.style.opacity = '';
                activeView.classList.remove('swipe-back-snap');
              });
            }, 180);
          } else {
            _navigateBack();
          }
        } else {
          // Cancel — snap back
          if (activeView) {
            activeView.classList.remove('swipe-back-active');
            activeView.classList.add('swipe-back-snap');
            activeView.style.transform = '';
            activeView.style.opacity = '';
            setTimeout(() => activeView.classList.remove('swipe-back-snap'), 250);
          }
        }
        _swLocked = false;
      }, { passive: true });
    }

    // Setlists button (auth-gated + email verification)
    document.getElementById('btn-setlists').addEventListener('click', () => {
      if (!Auth.isLoggedIn()) {
        showToast('Log in to view setlists');
        return;
      }
      if (!_checkEmailVerified('Setlists')) return;
      if (Store.get('selectionMode')) _exitSelectionMode();
      renderSetlists();
    });

    // Practice button (auth-gated + email verification)
    document.getElementById('btn-practice').addEventListener('click', () => {
      if (!Auth.isLoggedIn()) {
        showToast('Log in to view practice lists');
        return;
      }
      if (!_checkEmailVerified('Practice')) return;
      if (Store.get('selectionMode')) _exitSelectionMode();
      renderPractice();
    });

    // (Admin Dashboard button removed — "Admin" button now goes directly to dashboard)

    // Master volume slider (hidden on mobile — iOS audio.volume is read-only, Android has system volume)
    // Hidden by default on desktop too — shown only on detail view when song has audio/links
    const isMobile = _isMobile();
    const volWrap   = document.getElementById('master-volume');
    const volSlider = document.getElementById('volume-slider');
    if (!volWrap || !volSlider) { /* elements missing, skip volume setup */ }
    else if (isMobile) {
      // Keep hidden on mobile (iOS audio.volume is read-only)
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

    // Load all data sources in parallel for faster cold start
    await Promise.all([loadSongsInstant(), loadSetlistsInstant(), loadPracticeInstant()]);
    _migratePracticeData();

    // Feature 9: Welcome overlay for brand-new users
    if (_songs.length === 0 && !GitHub.isConfigured() && !Drive.isConfigured() && !localStorage.getItem('ct_welcome_seen')) {
      _showWelcomeOverlay();
    }

    // Capture deep link BEFORE renderList (which clears the hash)
    const startHash = location.hash;
    const startRoute = (startHash && startHash !== '#') ? _resolveHash(startHash) : null;

    renderList();

    // Dismiss splash immediately — fade out and remove
    clearTimeout(_splashSafety);
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 300);
    }

    // Deep link: navigate to captured hash route after data loads
    if (startRoute) {
      if (startRoute.view === 'reset-password' && startRoute.token) {
        setTimeout(() => renderResetPassword(startRoute.token), 0);
      } else if (startRoute.view === 'verify-email' && startRoute.token) {
        setTimeout(() => handleVerifyEmail(startRoute.token), 0);
      } else if (startRoute.view !== 'list') {
        setTimeout(() => _navigateToRoute(startRoute), 0);
      }
    }
    // Restore auth UI from Auth login state (replaces old sessionStorage restore)
    _updateAuthUI();
    // Check password expiry after auth restore
    setTimeout(() => _checkPasswordExpiry(), 500);
    _initQueueIndicator();

    // Feature 2: iOS Safari install hint (no beforeinstallprompt support)
    if (_isIOS() && !_isPWAInstalled() && !_deferredInstallPrompt) {
      setTimeout(() => _showIOSInstallHint(), 3000);
    }

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
  async function runDiagnostics(container) { return Dashboard.runDiagnostics(container); }

  // ─── Offline Queue Indicator ─────────────────────────────────

  function _initQueueIndicator() {
    const badge = document.getElementById('qi-badge');
    if (!badge) return;

    function _updateQueueBadge() {
      const online = navigator.onLine;
      const ghOk = GitHub.isConfigured();
      let status = null; // null = hidden

      if (!online) {
        status = 'offline';
      } else if (ghOk) {
        const wq = GitHub.getWriteQueueStatus();
        if (wq.lastError) {
          status = 'error';
        } else if (wq.flushing) {
          status = 'syncing';
        } else if (wq.hasPending) {
          status = 'pending';
          badge.dataset.count = wq.pendingTypes.length;
        }
      }

      if (!status) {
        badge.className = 'qi-badge hidden';
        return;
      }

      badge.classList.remove('hidden');
      badge.className = 'qi-badge qi-' + status;

      if (status === 'offline') {
        badge.innerHTML = '<span class="qi-dot"></span>Offline';
        badge.title = 'You are offline — changes saved locally';
      } else if (status === 'error') {
        badge.innerHTML = '<span class="qi-dot"></span>Sync error — tap to retry';
        badge.title = 'Sync failed — tap to retry';
      } else if (status === 'pending') {
        const count = badge.dataset.count || '';
        const wq = ghOk ? GitHub.getWriteQueueStatus() : {};
        const retryIn = wq.retryInMs ? Math.ceil(wq.retryInMs / 1000) : 0;
        const retryLabel = retryIn > 0 ? ` (retry ${retryIn}s)` : '';
        badge.innerHTML = '<span class="qi-dot"></span>Pending' + (count ? ' (' + count + ')' : '') + retryLabel;
        badge.title = 'Changes waiting to sync' + retryLabel;
      } else if (status === 'syncing') {
        badge.innerHTML = '<span class="qi-dot"></span>Syncing';
        badge.title = 'Syncing changes to GitHub…';
      }
    }

    // Tap-to-retry on error/pending state
    badge.addEventListener('click', () => {
      if (GitHub.flushNow) {
        GitHub.flushNow();
        showToast('Retrying sync…');
        _updateQueueBadge();
      }
    });

    let _onlineDebounce = null;
    window.addEventListener('online', () => {
      _updateQueueBadge();
      clearTimeout(_onlineDebounce);
      _onlineDebounce = setTimeout(() => {
        showToast('Back online');
        if (GitHub.getWriteQueueStatus && GitHub.getWriteQueueStatus().hasPending) {
          GitHub.flushNow();
        }
      }, 1500);
    });
    window.addEventListener('offline', () => {
      clearTimeout(_onlineDebounce);
      _updateQueueBadge();
      showToast('Offline — changes saved locally', 4000);
    });
    // Smart polling: poll every 2s only while queue has pending writes, else 10s idle check
    let _qiInterval = null;
    let _qiActive = false;
    function _scheduleQueuePoll() {
      const ghOk = GitHub.isConfigured();
      const wq = ghOk ? GitHub.getWriteQueueStatus() : {};
      const needsActive = !!(wq.hasPending || wq.flushing || wq.lastError || !navigator.onLine);
      if (needsActive && !_qiActive) {
        clearInterval(_qiInterval);
        _qiInterval = setInterval(_updateQueueBadge, 2000);
        _qiActive = true;
      } else if (!needsActive && _qiActive) {
        clearInterval(_qiInterval);
        _qiInterval = setInterval(_updateQueueBadge, 10000);
        _qiActive = false;
      }
    }
    const _origUpdate = _updateQueueBadge;
    _updateQueueBadge = function() { _origUpdate(); _scheduleQueuePoll(); };
    _qiInterval = setInterval(_updateQueueBadge, 10000);
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
        <h3>Audio Player</h3>
        <div class="kb-help-row"><span>Play / Pause</span><span class="kb-help-key">Space</span></div>
        <div class="kb-help-row"><span>Seek back 5s</span><span class="kb-help-key">\u2190</span></div>
        <div class="kb-help-row"><span>Seek forward 5s</span><span class="kb-help-key">\u2192</span></div>
        <div class="kb-help-row"><span>Volume up</span><span class="kb-help-key">\u2191</span></div>
        <div class="kb-help-row"><span>Volume down</span><span class="kb-help-key">\u2193</span></div>
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

  // ─── Router registrations ──────────────────────────────────
  // list, detail registrations handled by js/songs.js
  // setlists, setlist-detail registrations handled by js/setlists.js
  // practice, practice-detail registrations handled by js/practice.js
  // dashboard registration handled by js/dashboard.js

// ─── Public API (exported for other modules) ──────────────
function updateAuthUI() { _updateAuthUI(); }
const hapticHeavy = haptic.heavy;
const hapticSuccess = haptic.success;
const hapticTap = haptic.tap;
function showVolume(visible) {
  const vw = document.getElementById('master-volume');
  if (vw && !_isMobile()) vw.classList.toggle('visible', visible);
}
function revokeBlobCache() { _revokeBlobCache(); }
function cleanupPlayers() { _cleanupPlayers(); }
function getBlobUrl(driveId) { return _getBlobUrl(driveId); }
function trackPlayerRef(ref) { _playerRefs.push(ref); }
function downloadFile(driveId, filename, btnEl) { return _downloadFile(driveId, filename, btnEl); }
function isPdfCached(driveId) { return _isPdfCached(driveId); }
function syncAll(force) { return _syncAllFromDrive(force); }
function checkEmailVerified(featureName) { return _checkEmailVerified(featureName); }

export {
  init, showToast, updateAuthUI,
  renderList, renderDetail, renderEdit,
  renderSetlists, renderPractice, renderPracticeListDetail,
  renderDashboard, renderAccount, renderResetPassword, showForgotPasswordModal,
  handleVerifyEmail, checkEmailVerified, runDiagnostics,
  hapticHeavy, hapticSuccess, hapticTap,
  showVolume,
  revokeBlobCache, cleanupPlayers, getBlobUrl, trackPlayerRef,
  downloadFile, isPdfCached, syncAll,
};

// ─── Global error capture for dashboard error log ──────────
window.onerror = function(msg, source, line) {
  try {
    const log = JSON.parse(localStorage.getItem('ct_error_log') || '[]');
    log.push({ message: String(msg), source: (source || '').split('/').pop() + ':' + line, time: new Date().toISOString() });
    if (log.length > 50) log.splice(0, log.length - 50);
    localStorage.setItem('ct_error_log', JSON.stringify(log));
  } catch (_) {}
};
window.addEventListener('unhandledrejection', (e) => {
  try {
    const log = JSON.parse(localStorage.getItem('ct_error_log') || '[]');
    log.push({ message: 'Unhandled promise: ' + (e.reason?.message || String(e.reason)), source: 'promise', time: new Date().toISOString() });
    if (log.length > 50) log.splice(0, log.length - 50);
    localStorage.setItem('ct_error_log', JSON.stringify(log));
  } catch (_) {}
});

// ─── Bootstrap (module scripts are deferred, DOM is parsed) ──────
document.addEventListener('DOMContentLoaded', () => {
  // GIS only on desktop — mobile never writes to Drive (uses GitHub for metadata)
  const isMobileBoot = /iPad|iPhone|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isMobileBoot && Drive.isWriteConfigured() && !document.getElementById('gis-script')) {
    const s = document.createElement('script');
    s.id    = 'gis-script';
    s.src   = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }

  // Wire GitHub callbacks
  GitHub.setOnFlushError((msg) => showToast(msg, 4000));
  GitHub.setOnFlushSuccess(() => { localStorage.setItem('ct_last_synced', Date.now().toString()); });
  GitHub.setOnRateLimitWarning((msg) => showToast(msg, 5000));
  GitHub.setOnDataChanged((types) => {
    showToast('Data synced from another tab — pull down to refresh', 3000);
  });
  GitHub.setOnMergeApplied((type, mergedData) => {
    // Update in-memory data when a merge was applied during write
    if (type === 'songs')    { Store.set('songs', mergedData); }
    if (type === 'setlists') { Store.set('setlists', mergedData); }
    if (type === 'practice') { Store.set('practice', mergedData); }
    showToast('Sync conflict auto-resolved', 2000);
  });

  init();
});
