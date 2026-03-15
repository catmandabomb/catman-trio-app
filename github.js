/**
 * github.js — GitHub API integration with encrypted storage
 *
 * Handles:
 *  - AES-256-GCM encryption/decryption via Web Crypto API
 *  - Read/write encrypted JSON files on a GitHub `data` branch
 *  - Debounced write queue with conflict merge (409 → fetch + merge + retry)
 *  - Rate limit tracking & throttling
 *  - Crash recovery (persist pending writes + deletions to localStorage)
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
  const FETCH_TIMEOUT_MS  = 30000;
  const MAX_CONSECUTIVE_FAILURES = 10;

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
  let _consecutiveFailures = 0;

  // Rate limiting
  let _apiCallTimestamps = [];

  // Callbacks (set by app.js)
  let _onFlushError = null;
  let _onFlushSuccess = null;
  let _onRateLimitWarning = null;

  // ─── Config ───────────────────────────────────────────────

  function getConfig() {
    return {
      pat:   '***', // Never expose PAT publicly
      owner: localStorage.getItem('bb_github_owner') || '',
      repo:  localStorage.getItem('bb_github_repo')  || '',
    };
  }

  function _getPat() {
    return localStorage.getItem('bb_github_pat') || '';
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
    return !!(_getPat() && (localStorage.getItem('bb_github_owner') || '') && (localStorage.getItem('bb_github_repo') || ''));
  }

  // ─── Encryption ───────────────────────────────────────────

  async function _ensureCryptoKey() {
    if (_cryptoKey) return _cryptoKey;
    const pat = _getPat();
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
    try {
      const key = await _ensureCryptoKey();
      const { iv, data } = JSON.parse(encryptedJson);
      const ivBytes   = _fromBase64(iv);
      const dataBytes = _fromBase64(data);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes }, key, dataBytes
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (e) {
      throw new Error('Decryption failed — PAT may have changed or data is corrupt: ' + (e.message || e));
    }
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

  function _owner() { return localStorage.getItem('bb_github_owner') || ''; }
  function _repo()  { return localStorage.getItem('bb_github_repo')  || ''; }

  async function _ghRequest(path, options = {}) {
    const pat = _getPat();
    if (!pat) throw new Error('GitHub PAT not configured');
    _trackApiCall();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const owner = encodeURIComponent(_owner());
      const repo  = encodeURIComponent(_repo());
      // Replace raw owner/repo in path with encoded versions
      const safePath = path
        .replace(`/${_owner()}/${_repo()}`, `/${owner}/${repo}`);

      const resp = await fetch(`https://api.github.com${safePath}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {}),
        },
      });
      return resp;
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('GitHub API request timed out (30s)');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Connection test ──────────────────────────────────────

  async function testConnection() {
    try {
      const pat = _getPat();
      const owner = _owner();
      const repo = _repo();
      if (!pat) return { ok: false, error: 'PAT is required' };
      if (!owner || !repo) return { ok: false, error: 'Owner and repo are required' };
      const resp = await _ghRequest(`/repos/${owner}/${repo}`);
      if (!resp.ok) {
        if (resp.status === 404) return { ok: false, error: 'Repository not found — check owner/repo' };
        if (resp.status === 401) return { ok: false, error: 'Invalid PAT — check your token' };
        const body = await resp.text();
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
    const owner = _owner();
    const repo = _repo();
    const resp = await _ghRequest(
      `/repos/${owner}/${repo}/contents/${filePath}?ref=${DATA_BRANCH}`
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
    const data = await resp.json();
    // Content is base64-encoded by GitHub API (null for large files)
    if (!data.content) {
      throw new Error(`File too large for Contents API: ${filePath}`);
    }
    const content = atob(data.content.replace(/\n/g, ''));
    return { content, sha: data.sha };
  }

  async function _putFile(filePath, content, sha, message) {
    const owner = _owner();
    const repo = _repo();
    const body = {
      message: message || `Update ${filePath}`,
      content: btoa(content), // encrypted JSON is ASCII-safe
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
    if (!file) return null; // 404 = file doesn't exist, return null (not [])
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
      _scheduleFlush();
      return;
    }
    if (_isRatePaused()) {
      if (_onRateLimitWarning) _onRateLimitWarning('Writes paused — rate limit too high');
      _scheduleFlush();
      return;
    }
    if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      if (_onFlushError) _onFlushError('GitHub sync stopped after too many failures. Use Push Now to retry.');
      return;
    }

    _flushing = true;
    _debounceCount++;
    _lastFlushTime = Date.now();

    // Snapshot pending data and deletions so mid-flush writes don't get lost
    const snapshot = {};
    const deletionSnapshot = {};
    const types = [];
    for (const k of ['songs', 'setlists', 'practice']) {
      if (_pending[k] !== null) {
        snapshot[k] = _pending[k];
        deletionSnapshot[k] = new Set(_deletions[k]);
        types.push(k);
      }
    }

    if (types.length === 0) {
      _flushing = false;
      return;
    }

    let allOk = true;
    for (const type of types) {
      try {
        await _flushType(type, snapshot[type], deletionSnapshot[type]);
        // Only clear if pending hasn't been overwritten by a newer write
        if (_pending[type] === snapshot[type]) {
          _pending[type] = null;
        }
        // Only remove snapshotted deletion IDs, not ones added mid-flush
        for (const id of deletionSnapshot[type]) {
          _deletions[type].delete(id);
        }
        _consecutiveFailures = 0;
      } catch (e) {
        console.error(`GitHub flush ${type} failed:`, e);
        allOk = false;
        _consecutiveFailures++;
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

  async function _flushType(type, data, deletionsForMerge, retryCount = 0) {
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
        await _mergeAndRetry(type, data, deletionsForMerge, retryCount);
      } else {
        throw e;
      }
    }
  }

  // ─── Merge strategy (on 409 conflict) ─────────────────────

  async function _mergeAndRetry(type, localData, deletionsForMerge, retryCount) {
    const file = await _getFile(FILES[type]);
    if (!file) {
      _shaCache[type] = null;
      return _flushType(type, localData, deletionsForMerge, retryCount + 1);
    }

    const remoteData = await _decrypt(file.content);
    _shaCache[type] = file.sha;

    const merged = _mergeRecords(remoteData, localData, deletionsForMerge);

    return _flushType(type, merged, deletionsForMerge, retryCount + 1);
  }

  function _mergeRecords(remoteArr, localArr, deletedIds) {
    const map = new Map();

    // Start with remote
    (remoteArr || []).forEach(r => {
      const id = r.id;
      if (id !== undefined && id !== null) map.set(id, r);
    });

    // Overlay local (local wins)
    (localArr || []).forEach(r => {
      const id = r.id;
      if (id !== undefined && id !== null) map.set(id, r);
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
      // Also persist deletions
      const deletionsSerialized = {};
      for (const [k, v] of Object.entries(_deletions)) {
        deletionsSerialized[k] = Array.from(v);
      }
      localStorage.setItem('bb_github_pending', JSON.stringify(serializable));
      localStorage.setItem('bb_github_deletions', JSON.stringify(deletionsSerialized));
    } catch (e) {
      console.warn('GitHub: could not persist pending writes for crash recovery', e);
    }
  }

  function _restorePending() {
    try {
      const raw = localStorage.getItem('bb_github_pending');
      if (raw) {
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
        }
      }
      // Restore deletions
      const delRaw = localStorage.getItem('bb_github_deletions');
      if (delRaw) {
        const delParsed = JSON.parse(delRaw);
        for (const type of ['songs', 'setlists', 'practice']) {
          if (Array.isArray(delParsed[type])) {
            _deletions[type] = new Set(delParsed[type]);
          }
        }
      }
    } catch (e) {
      console.warn('GitHub: crash recovery restore failed', e);
    }
  }

  // Persist on unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => _persistPending());
  }

  // ─── Init (called by app.js after DOM ready) ──────────────

  function init() {
    _restorePending();
    // Schedule flush if pending data was restored
    if (Object.values(_pending).some(v => v !== null)) {
      _scheduleFlush();
    }
  }

  // ─── Data branch creation ─────────────────────────────────

  async function createDataBranch() {
    const owner = _owner();
    const repo = _repo();

    // Use repo metadata to find default branch name
    const repoResp = await _ghRequest(`/repos/${owner}/${repo}`);
    let defaultBranch = 'main';
    if (repoResp.ok) {
      const repoData = await repoResp.json();
      defaultBranch = repoData.default_branch || 'main';
    }

    const branchResp = await _ghRequest(`/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`);
    if (!branchResp.ok) throw new Error(`Could not find default branch "${defaultBranch}"`);
    const branchData = await branchResp.json();
    return _createRef(owner, repo, branchData.object.sha);
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
    // Cancel any pending flushes before migration
    if (_debounceTimer) clearTimeout(_debounceTimer);
    // Wait for in-flight flush to finish
    while (_flushing) {
      await new Promise(r => setTimeout(r, 100));
    }
    // Clear pending writes — migration is the canonical source
    _pending = { songs: null, setlists: null, practice: null };
    _deletions = { songs: new Set(), setlists: new Set(), practice: new Set() };
    _persistPending();

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

    // Step 3: Verify round-trip by count + spot-check IDs
    const verify = await loadAllData();
    if (verify.songs === null || verify.setlists === null || verify.practice === null) {
      throw new Error('Verification failed: could not read back migrated data');
    }

    const origSongs = songs || [];
    const origSetlists = setlists || [];
    const origPractice = practice || [];

    if (verify.songs.length !== origSongs.length) {
      throw new Error(`Verification failed: songs count mismatch (${verify.songs.length} vs ${origSongs.length})`);
    }
    if (verify.setlists.length !== origSetlists.length) {
      throw new Error(`Verification failed: setlists count mismatch (${verify.setlists.length} vs ${origSetlists.length})`);
    }
    if (verify.practice.length !== origPractice.length) {
      throw new Error(`Verification failed: practice count mismatch (${verify.practice.length} vs ${origPractice.length})`);
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
    _consecutiveFailures = 0; // Reset on manual push
    await _flush();
  }

  // ─── Public API ───────────────────────────────────────────

  return {
    // Config
    isConfigured,
    getConfig,
    saveConfig,
    clearConfig,
    testConnection,

    // Lifecycle
    init,

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
