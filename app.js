/**
 * app.js — Main application logic
 */

const App = (() => {

  // Phase 1: Version + schema live in Store; local alias for backward compat
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
  let _activePersona = null;
  let _activePracticeList = null;

  // ─── Hash routing (delegated to Router module) ──────────────
  let _isPopstateNavigation = false;
  let _currentRouteParams = {};
  function _setRouteParams(p) { _currentRouteParams = p; Store.set('currentRouteParams', p); }
  const _viewToHash      = Router.viewToHash;
  const _resolveHash     = Router.resolveHash;
  function _navigateToRoute(route) { Router.navigateToRoute(route); }
  let _cachedPdfSet = new Set();

  // ─── Utility (delegated to Utils module) ────────────────────
  const esc           = Utils.esc;
  const deepClone     = Utils.deepClone;
  const _timeAgo      = Utils.timeAgo;
  const haptic        = Utils.haptic;
  const showToast     = Utils.showToast;

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

  async function _getBlobUrl(driveId) {
    if (_blobCache[driveId]) {
      // Move to end (most recently used)
      const idx = _blobCacheOrder.indexOf(driveId);
      if (idx > -1) _blobCacheOrder.splice(idx, 1);
      _blobCacheOrder.push(driveId);
      return _blobCache[driveId];
    }

    // Try PDF cache from service worker first
    const cachedBlob = await _getCachedPdfBlob(driveId);
    if (cachedBlob) {
      const url = URL.createObjectURL(cachedBlob);
      _blobCache[driveId] = url;
      _blobCacheOrder.push(driveId);
      _evictBlobCache();
      return url;
    }

    // Fetch from Drive with 1 retry after 2s delay
    let url;
    try {
      url = await Drive.fetchFileAsBlob(driveId);
    } catch (firstErr) {
      console.warn('Drive fetch failed, retrying in 2s:', driveId, firstErr);
      await new Promise(r => setTimeout(r, 2000));
      url = await Drive.fetchFileAsBlob(driveId);
    }
    _blobCache[driveId] = url;
    _blobCacheOrder.push(driveId);
    _evictBlobCache();

    // Cache the PDF blob in the service worker (fire and forget)
    _cachePdfBlob(driveId, url);

    return url;
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
      document.querySelectorAll(`.pdf-cached-badge[data-cache-id="${driveId}"]`).forEach(el => {
        el.classList.add('cached');
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

  const _isIOS = Utils.isIOS;

  async function _downloadFile(driveId, filename, btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="dl-spinner"></span>';

    try {
      if (!driveId) throw new Error('No file ID');
      if (_isIOS()) {
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
  function _cleanupDetailAnchors() { Songs.cleanupDetailAnchors(); }

  const _isHybridKey = Utils.isHybridKey;


  // (Song list/detail/edit code extracted to js/songs.js)

  // ─── SETLISTS (delegated to Setlists module) ──────────────
  function renderSetlists(skipNavReset) { Setlists.renderSetlists(skipNavReset); }
  function renderSetlistDetail(setlist, skipNavPush) { Setlists.renderSetlistDetail(setlist, skipNavPush); }
  function renderSetlistEdit(setlist, isNew, backToList) { Setlists.renderSetlistEdit(setlist, isNew, backToList); }
  async function loadSetlistsInstant() { await Sync.loadSetlistsInstant(); _setlists = Store.get('setlists'); }
  async function saveSetlists(toastMsg) { Store.set('setlists', _setlists); return Sync.saveSetlists(toastMsg); }

  // ─── ADMIN DASHBOARD ────────────────────────────────────────

  function renderDashboard() { Dashboard.renderDashboard(); }


  // ─── PRACTICE (delegated to Practice module) ──────────────
  function renderPractice(skipNavReset) { Practice.renderPractice(skipNavReset); }
  function renderPracticeDetail(persona, skipNavPush) { Practice.renderPracticeDetail(persona, skipNavPush); }
  function renderPracticeListDetail(persona, practiceList, skipNavPush) { Practice.renderPracticeListDetail(persona, practiceList, skipNavPush); }
  function renderPracticeEdit(persona, isNew) { Practice.renderPracticeEdit(persona, isNew); }
  async function loadPracticeInstant() { await Practice.loadPracticeInstant(); _practice = Store.get('practice'); }
  function _migratePracticeData() { Practice.migratePracticeData(); _practice = Store.get('practice'); }
  async function savePractice(toastMsg) { Store.set('practice', _practice); return Practice.savePractice(toastMsg); }

  // ─── Init ──────────────────────────────────────────────────

  // ─── PWA Install Gate ──────────────────────────────────────

  const _isPWAInstalled = Utils.isPWAInstalled;
  const _isMobile       = Utils.isMobile;
  const _detectPlatform = Utils.detectPlatform;

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
    // Run one-time storage migrations (bb_ → ct_, etc.) before anything else
    if (typeof Migrate !== 'undefined') Migrate.runAll();
    const _splashStart = Date.now();
    // Safety: dismiss splash screen after 6s no matter what (don't strand user)
    const _splashSafety = setTimeout(() => {
      const s = document.getElementById('splash-screen');
      if (s) { s.classList.add('fade-out'); setTimeout(() => s.remove(), 300); }
    }, 6000);

    // Show loading skeleton immediately so the user sees activity on cold start
    // (must happen before any await to avoid black-screen perception)
    const songList = document.getElementById('song-list');
    if (songList && !songList.children.length) {
      songList.innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');
    }

    // Initialize IndexedDB (before loading data) — with timeout to prevent hanging
    if (typeof IDB !== 'undefined') {
      try {
        await Promise.race([
          IDB.open(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 5000))
        ]);
      } catch (e) { console.warn('IDB init failed, using localStorage fallback', e); }
    }

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
    window.addEventListener('popstate', () => {
      _isPopstateNavigation = true;
      Store.set('isPopstateNavigation', true);
      _navStack = []; // Clear in-app nav stack to prevent desync with browser history
      try {
        const route = _resolveHash(location.hash);
        _navigateToRoute(route);
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

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
      haptic.double(); // mode toggle
      if (Admin.isEditMode()) {
        // Already authenticated — go straight to dashboard
        renderDashboard();
      } else {
        Admin.showPasswordModal(() => {
          Admin.enterEditMode();
          renderDashboard();
        });
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
        if (_view !== 'list' || Store.get('selectionMode') || _getScrollTop() > 5) return;
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
        if (!_navStack.length || _liveModeActive) return;
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

    // Setlists button
    document.getElementById('btn-setlists').addEventListener('click', () => {
      if (Store.get('selectionMode')) _exitSelectionMode();
      renderSetlists();
    });

    // Practice button
    document.getElementById('btn-practice').addEventListener('click', () => {
      if (Store.get('selectionMode')) _exitSelectionMode();
      renderPractice();
    });

    // (Admin Dashboard button removed — "Admin" button now goes directly to dashboard)

    // Master volume slider (hidden on mobile — iOS audio.volume is read-only, Android has system volume)
    const isMobile = _isMobile();
    const volWrap   = document.getElementById('master-volume');
    const volSlider = document.getElementById('volume-slider');
    if (!volWrap || !volSlider) { /* elements missing, skip volume setup */ }
    else if (isMobile) {
      volWrap.style.display = 'none';
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

    renderList();

    // BUG-01: Dismiss splash with minimum hold time + double-rAF paint settling
    clearTimeout(_splashSafety);
    const splash = document.getElementById('splash-screen');
    if (splash) {
      const elapsed = Date.now() - _splashStart;
      const minHold = Math.max(0, 800 - elapsed);
      setTimeout(() => {
        // Double-rAF ensures layout reflow is complete before fade
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            splash.classList.add('fade-out');
            setTimeout(() => splash.remove(), 300);
          });
        });
      }, minHold);
    }

    // Deep link: if URL has a hash, navigate to it after data loads
    if (location.hash && location.hash !== '#') {
      const route = _resolveHash(location.hash);
      if (route.view !== 'list') {
        setTimeout(() => _navigateToRoute(route), 0);
      }
    }
    Admin.restoreEditMode();
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
      const ghOk = typeof GitHub !== 'undefined' && GitHub.isConfigured();
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
      if (typeof GitHub !== 'undefined' && GitHub.flushNow) {
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
        if (typeof GitHub !== 'undefined' && GitHub.getWriteQueueStatus && GitHub.getWriteQueueStatus().hasPending) {
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
      const ghOk = typeof GitHub !== 'undefined' && GitHub.isConfigured();
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

  return {
    init, showToast,
    renderList, renderDetail, renderEdit,
    renderSetlists, renderPractice, renderPracticeDetail, renderPracticeListDetail,
    renderDashboard, runDiagnostics,
    hapticHeavy: haptic.heavy, hapticSuccess: haptic.success, hapticTap: haptic.tap,
    revokeBlobCache: _revokeBlobCache,
    cleanupPlayers: _cleanupPlayers,
    getBlobUrl: _getBlobUrl,
    trackPlayerRef(ref) { _playerRefs.push(ref); },
    downloadFile: _downloadFile,
    isPdfCached: _isPdfCached,
    syncAll: _syncAllFromDrive,
  };

})();

document.addEventListener('DOMContentLoaded', () => {
  // GIS only on desktop — mobile never writes to Drive (uses GitHub for metadata)
  const isMobile = /iPad|iPhone|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isMobile && Drive.isWriteConfigured() && !document.getElementById('gis-script')) {
    const s = document.createElement('script');
    s.id    = 'gis-script';
    s.src   = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }

  // Wire GitHub callbacks and init crash recovery
  if (typeof GitHub !== 'undefined') {
    GitHub.onFlushError = (msg) => App.showToast(msg, 4000);
    GitHub.onFlushSuccess = () => { localStorage.setItem('ct_last_synced', Date.now().toString()); };
    GitHub.onRateLimitWarning = (msg) => App.showToast(msg, 5000);
    GitHub.onDataChanged = (types) => {
      App.showToast('Data synced from another tab — pull down to refresh', 3000);
    };
    GitHub.init(); // Restore pending writes from crash recovery
  }

  App.init();
});
