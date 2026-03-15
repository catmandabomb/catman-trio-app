/**
 * github.js — GitHub API integration with encrypted storage
 *
 * Handles:
 *  - AES-256-GCM encryption/decryption via Web Crypto API
 *  - Read/write encrypted JSON files on a GitHub `data` branch
 *  - Debounced write queue with conflict merge (409 → fetch + merge + retry)
 *  - Rate limit tracking & throttling
 *  - Crash recovery (persist pending writes to localStorage)
 *  - Migration from Drive to GitHub
 *
 * Config stored in localStorage:
 *   bb_github_pat, bb_github_repo, bb_github_owner
 *
 * File format on GitHub: { "iv": "<base64>", "data": "<base64>" }
 */

const GitHub = (() => {

  // ─── Constants ────────────────────────────────────────────

  const DATA_BRANCH = 'data';
  const FILES = {
    songs:    'data/songs.enc',
    setlists: 'data/setlists.enc',
    practice: 'data/practice.enc',
  };

  const DEBOUNCE_BASE_MS  = 1500;
  const DEBOUNCE_MAX_MS   = 9000;
  const DEBOUNCE_RESET_MS = 60000;
  const MAX_CONFLICT_RETRIES = 3;

  // Rate limit thresholds (GitHub allows 5000/hr for authenticated)
  const RATE_WARN_THRESHOLD  = 4000; // 80%
  const RATE_PAUSE_THRESHOLD = 4500; // 90%

  // ─── State ────────────────────────────────────────────────

  let _cryptoKey = null;
  let _shaCache = { songs: null, setlists: null, practice: null };
  let _pending  = { songs: null, setlists: null, practice: null };
  let _deletions = { songs: new Set(), setlists: new Set(), practice: new Set() };

  let _debounceTimer = null;
  let _debounceCount = 0;
  let _lastFlushTime = 0;
  let _flushing = false;

  // Rate limiting
  let _apiCallTimestamps = [];

  // Callbacks (set by app.js)
  let _onFlushError = null;
  let _onFlushSuccess = null;
  let _onRateLimitWarning = null;

  // ─── Config ───────────────────────────────────────────────

  function getConfig() {
    return {
      pat:   localStorage.getItem('bb_github_pat')   || '',
      owner: localStorage.getItem('bb_github_owner') || '',
      repo:  localStorage.getItem('bb_github_repo')  || '',
    };
  }

  function saveConfig({ pat, owner, repo }) {
    localStorage.setItem('bb_github_pat',   pat.trim());
    localStorage.setItem('bb_github_owner', owner.trim());
    localStorage.setItem('bb_github_repo',  repo.trim());
    _cryptoKey = null; // Force re-derive on next use
    _shaCache = { songs: null, setlists: null, practice: null };
  }

  function clearConfig() {
    localStorage.removeItem('bb_github_pat');
    localStorage.removeItem('bb_github_owner');
    localStorage.removeItem('bb_github_repo');
    _cryptoKey = null;
    _shaCache = { songs: null, setlists: null, practice: null };
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.pat && c.owner && c.repo);
  }

  // ─── Encryption ───────────────────────────────────────────

  async function _ensureCryptoKey() {
    if (_cryptoKey) return _cryptoKey;
    const { pat } = getConfig();
    if (!pat) throw new Error('GitHub PAT not configured');
    const rawKey = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(pat)
    );
    _cryptoKey = await crypto.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
    return _cryptoKey;
  }

  async function _encrypt(data) {
    const key = await _ensureCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoded
    );
    return JSON.stringify({
      iv:   _toBase64(iv),
      data: _toBase64(new Uint8Array(ciphertext)),
    });
  }

  async function _decrypt(encryptedJson) {
    const key = await _ensureCryptoKey();
    const { iv, data } = JSON.parse(encryptedJson);
    const ivBytes   = _fromBase64(iv);
    const dataBytes = _fromBase64(data);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes }, key, dataBytes
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function _toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function _fromBase64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ─── GitHub API ───────────────────────────────────────────

  function _trackApiCall() {
    const now = Date.now();
    _apiCallTimestamps.push(now);
    // Prune older than 1 hour
    const cutoff = now - 3600000;
    _apiCallTimestamps = _apiCallTimestamps.filter(t => t > cutoff);

    const count = _apiCallTimestamps.length;
    if (count >= RATE_PAUSE_THRESHOLD && _onRateLimitWarning) {
      _onRateLimitWarning('GitHub API rate limit critical (90%). Writes paused.');
    } else if (count >= RATE_WARN_THRESHOLD && _onRateLimitWarning) {
      _onRateLimitWarning('GitHub API usage high (80%). Debounce increased.');
    }
  }

  function _isRatePaused() {
    return _apiCallTimestamps.length >= RATE_PAUSE_THRESHOLD;
  }

  function _getMinDebounce() {
    if (_apiCallTimestamps.length >= RATE_WARN_THRESHOLD) return 30000;
    return DEBOUNCE_BASE_MS;
  }

  async function _ghRequest(path, options = {}) {
    const { pat } = getConfig();
    if (!pat) throw new Error('GitHub PAT not configured');
    _trackApiCall();
    const resp = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    });
    return resp;
  }

  // ─── Connection test ──────────────────────────────────────

  async function testConnection() {
    try {
      const { owner, repo } = getConfig();
      if (!owner || !repo) return { ok: false, error: 'Owner and repo are required' };
      const resp = await _ghRequest(`/repos/${owner}/${repo}`);
      if (!resp.ok) {
        const body = await resp.text();
        if (resp.status === 404) return { ok: false, error: 'Repository not found — check owner/repo' };
        if (resp.status === 401) return { ok: false, error: 'Invalid PAT — check your token' };
        return { ok: false, error: `GitHub API ${resp.status}: ${body}` };
      }
      const data = await resp.json();
      // Check if data branch exists
      const branchResp = await _ghRequest(`/repos/${owner}/${repo}/branches/${DATA_BRANCH}`);
      const hasBranch = branchResp.ok;
      return {
        ok: true,
        repoName: data.full_name,
        hasBranch,
        permissions: data.permissions,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // ─── File operations ──────────────────────────────────────

  async function _getFile(filePath) {
    const { owner, repo } = getConfig();
    const resp = await _ghRequest(
      `/repos/${owner}/${repo}/contents/${filePath}?ref=${DATA_BRANCH}`
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
    const data = await resp.json();
    // Content is base64-encoded by GitHub API
    const content = atob(data.content.replace(/\n/g, ''));
    return { content, sha: data.sha };
  }

  async function _putFile(filePath, content, sha, message) {
    const { owner, repo } = getConfig();
    const body = {
      message: message || `Update ${filePath}`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: DATA_BRANCH,
    };
    if (sha) body.sha = sha;
    const resp = await _ghRequest(
      `/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (resp.status === 409) {
      const err = new Error('Conflict');
      err.status = 409;
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub PUT ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return data.content.sha;
  }

  // ─── Load data ────────────────────────────────────────────

  async function _loadType(type) {
    const file = await _getFile(FILES[type]);
    if (!file) return [];
    const decrypted = await _decrypt(file.content);
    _shaCache[type] = file.sha;
    return decrypted;
  }

  async function loadSongs()    { return _loadType('songs'); }
  async function loadSetlists() { return _loadType('setlists'); }
  async function loadPractice() { return _loadType('practice'); }

  async function loadAllData() {
    const [songs, setlists, practice] = await Promise.all([
      _loadType('songs').catch(e => { console.warn('GitHub loadSongs failed:', e); return null; }),
      _loadType('setlists').catch(e => { console.warn('GitHub loadSetlists failed:', e); return null; }),
      _loadType('practice').catch(e => { console.warn('GitHub loadPractice failed:', e); return null; }),
    ]);
    return { songs, setlists, practice };
  }

  // ─── Save data (queued + debounced) ───────────────────────

  function saveSongs(data)    { _queueWrite('songs', data); }
  function saveSetlists(data) { _queueWrite('setlists', data); }
  function savePractice(data) { _queueWrite('practice', data); }

  function _queueWrite(type, data) {
    _pending[type] = data;
    _persistPending();
    _scheduleFlush();
  }

  function _scheduleFlush() {
    if (_debounceTimer) clearTimeout(_debounceTimer);

    // Reset ramp after idle
    if (Date.now() - _lastFlushTime > DEBOUNCE_RESET_MS) {
      _debounceCount = 0;
    }

    // Arithmetic ramp: 1.5, 3, 4.5, 6, 7, 8, 9 (capped)
    const rampMs = Math.min(
      DEBOUNCE_BASE_MS * (_debounceCount + 1),
      DEBOUNCE_MAX_MS
    );
    const delay = Math.max(rampMs, _getMinDebounce());

    _debounceTimer = setTimeout(() => _flush(), delay);
  }

  async function _flush() {
    if (_flushing) {
      // Already flushing — reschedule
      _scheduleFlush();
      return;
    }
    if (_isRatePaused()) {
      if (_onRateLimitWarning) _onRateLimitWarning('Writes paused — rate limit too high');
      _scheduleFlush();
      return;
    }

    _flushing = true;
    _debounceCount++;
    _lastFlushTime = Date.now();

    const types = Object.keys(_pending).filter(k => _pending[k] !== null);
    if (types.length === 0) {
      _flushing = false;
      return;
    }

    let allOk = true;
    for (const type of types) {
      const data = _pending[type];
      if (data === null) continue;
      try {
        await _flushType(type, data);
        _pending[type] = null;
        _deletions[type] = new Set();
      } catch (e) {
        console.error(`GitHub flush ${type} failed:`, e);
        allOk = false;
        if (_onFlushError) _onFlushError(`GitHub sync failed for ${type}: ${e.message}`);
      }
    }

    _persistPending();
    _flushing = false;

    if (allOk && _onFlushSuccess) _onFlushSuccess();

    // If any pending remain, reschedule
    if (Object.values(_pending).some(v => v !== null)) {
      _scheduleFlush();
    }
  }

  async function _flushType(type, data, retryCount = 0) {
    const encrypted = await _encrypt(data);
    try {
      const newSha = await _putFile(
        FILES[type],
        encrypted,
        _shaCache[type],
        `Update ${type}`
      );
      _shaCache[type] = newSha;
    } catch (e) {
      if (e.status === 409 && retryCount < MAX_CONFLICT_RETRIES) {
        // Conflict — merge and retry
        await _mergeAndRetry(type, data, retryCount);
      } else {
        throw e;
      }
    }
  }

  // ─── Merge strategy (on 409 conflict) ─────────────────────

  async function _mergeAndRetry(type, localData, retryCount) {
    // Fetch remote version
    const file = await _getFile(FILES[type]);
    if (!file) {
      // File was deleted remotely — just create it
      _shaCache[type] = null;
      return _flushType(type, localData, retryCount + 1);
    }

    const remoteData = await _decrypt(file.content);
    _shaCache[type] = file.sha;

    // Merge: remote as base, overlay local by ID, apply deletions
    const merged = _mergeRecords(remoteData, localData, _deletions[type]);

    return _flushType(type, merged, retryCount + 1);
  }

  function _mergeRecords(remoteArr, localArr, deletedIds) {
    // Build map keyed by record ID
    const map = new Map();

    // Start with remote
    (remoteArr || []).forEach(r => {
      const id = r.id;
      if (id) map.set(id, r);
    });

    // Overlay local (local wins)
    (localArr || []).forEach(r => {
      const id = r.id;
      if (id) map.set(id, r);
    });

    // Apply deletions
    if (deletedIds) {
      deletedIds.forEach(id => map.delete(id));
    }

    return Array.from(map.values());
  }

  // ─── Deletion tracking ────────────────────────────────────

  function trackDeletion(type, id) {
    if (_deletions[type]) {
      _deletions[type].add(id);
    }
  }

  // ─── Crash recovery ──────────────────────────────────────

  function _persistPending() {
    try {
      const serializable = {};
      for (const [k, v] of Object.entries(_pending)) {
        serializable[k] = v;
      }
      localStorage.setItem('bb_github_pending', JSON.stringify(serializable));
    } catch (_) {}
  }

  function _restorePending() {
    try {
      const raw = localStorage.getItem('bb_github_pending');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      let hasPending = false;
      for (const type of ['songs', 'setlists', 'practice']) {
        if (parsed[type] !== null && parsed[type] !== undefined) {
          _pending[type] = parsed[type];
          hasPending = true;
        }
      }
      if (hasPending) {
        console.info('GitHub: restoring pending writes from crash recovery');
        _scheduleFlush();
      }
    } catch (_) {}
  }

  // Persist on unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => _persistPending());
  }

  // ─── Data branch creation ─────────────────────────────────

  async function createDataBranch() {
    const { owner, repo } = getConfig();

    // Get main branch HEAD SHA
    const mainResp = await _ghRequest(`/repos/${owner}/${repo}/git/refs/heads/main`);
    if (!mainResp.ok) {
      // Try 'master' as fallback
      const masterResp = await _ghRequest(`/repos/${owner}/${repo}/git/refs/heads/master`);
      if (!masterResp.ok) throw new Error('Could not find main or master branch');
      const masterData = await masterResp.json();
      return _createRef(owner, repo, masterData.object.sha);
    }
    const mainData = await mainResp.json();
    return _createRef(owner, repo, mainData.object.sha);
  }

  async function _createRef(owner, repo, sha) {
    const resp = await _ghRequest(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${DATA_BRANCH}`,
        sha: sha,
      }),
    });
    if (resp.status === 422) {
      // Branch already exists — that's fine
      return true;
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Create branch failed: ${resp.status} ${text}`);
    }
    return true;
  }

  // ─── Migration ────────────────────────────────────────────

  async function migrateData({ songs, setlists, practice }) {
    // Step 1: Create data branch
    await createDataBranch();

    // Step 2: Encrypt and upload all 3 files
    const encSongs    = await _encrypt(songs || []);
    const encSetlists = await _encrypt(setlists || []);
    const encPractice = await _encrypt(practice || []);

    // Upload sequentially to avoid conflicts on new branch
    _shaCache.songs = await _putFile(FILES.songs, encSongs, _shaCache.songs, 'Initial songs migration');
    _shaCache.setlists = await _putFile(FILES.setlists, encSetlists, _shaCache.setlists, 'Initial setlists migration');
    _shaCache.practice = await _putFile(FILES.practice, encPractice, _shaCache.practice, 'Initial practice migration');

    // Step 3: Verify round-trip
    const verify = await loadAllData();
    if (verify.songs === null || verify.setlists === null || verify.practice === null) {
      throw new Error('Verification failed: could not read back migrated data');
    }

    const origSongsStr = JSON.stringify(songs || []);
    const origSetlistsStr = JSON.stringify(setlists || []);
    const origPracticeStr = JSON.stringify(practice || []);

    if (JSON.stringify(verify.songs) !== origSongsStr) {
      throw new Error('Verification failed: songs data mismatch after round-trip');
    }
    if (JSON.stringify(verify.setlists) !== origSetlistsStr) {
      throw new Error('Verification failed: setlists data mismatch after round-trip');
    }
    if (JSON.stringify(verify.practice) !== origPracticeStr) {
      throw new Error('Verification failed: practice data mismatch after round-trip');
    }

    return true;
  }

  // ─── Status ───────────────────────────────────────────────

  function getRateLimitStatus() {
    const now = Date.now();
    const cutoff = now - 3600000;
    const recent = _apiCallTimestamps.filter(t => t > cutoff);
    return {
      callsThisHour: recent.length,
      limit: 5000,
      pct: Math.round((recent.length / 5000) * 100),
      paused: _isRatePaused(),
      warnLevel: recent.length >= RATE_PAUSE_THRESHOLD ? 'critical'
               : recent.length >= RATE_WARN_THRESHOLD ? 'warning'
               : 'ok',
    };
  }

  function getWriteQueueStatus() {
    const pendingTypes = Object.keys(_pending).filter(k => _pending[k] !== null);
    return {
      hasPending: pendingTypes.length > 0,
      pendingTypes,
      flushing: _flushing,
      debounceCount: _debounceCount,
    };
  }

  async function flushNow() {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    await _flush();
  }

  // ─── Init: restore crash recovery on load ─────────────────

  _restorePending();

  // ─── Public API ───────────────────────────────────────────

  return {
    // Config
    isConfigured,
    getConfig,
    saveConfig,
    clearConfig,
    testConnection,

    // Load
    loadSongs,
    loadSetlists,
    loadPractice,
    loadAllData,

    // Save (queued + debounced)
    saveSongs,
    saveSetlists,
    savePractice,

    // Deletion
    trackDeletion,

    // Migration
    createDataBranch,
    migrateData,

    // Status
    getRateLimitStatus,
    getWriteQueueStatus,
    flushNow,

    // Callbacks
    set onFlushError(fn)       { _onFlushError = fn; },
    set onFlushSuccess(fn)     { _onFlushSuccess = fn; },
    set onRateLimitWarning(fn) { _onRateLimitWarning = fn; },
  };

})();
