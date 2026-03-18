/**
 * admin.js — Edit mode, password gate, CRUD operations
 *
 * Password is stored as a SHA-256 hex hash in localStorage (ct_pw_hash).
 * Default password on first run: see DEFAULT_HASH — change it in the app.
 *
 * Generates 4-digit hex IDs for new songs (e.g. "3f9a").
 */

import * as Modal from './js/modal.js';
import * as Drive from './drive.js';
import * as GitHub from './github.js';
import * as Utils from './js/utils.js';
import * as Auth from './auth.js';
// Lazy import to break circular dependency (admin ↔ app)
let _App = null;
function _getApp() {
  if (!_App) _App = import('./app.js');
  return _App;
}

// Default password hash — SHA-256 of "Administraitor1!" (legacy, for migration)
const DEFAULT_HASH = 'e5c128a06031c45577c71b9a49a5fffa3a93e077354ce609bd616b5cf70d32f4';

let _adminModeActive = true; // Defaults to true on each login; toggle via dashboard

// ─── Brute Force Protection ─────────────────────────────────
let _failedAttempts = 0;
let _lockoutUntil = 0;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATIONS = [0, 0, 0, 0, 0, 15000, 30000, 60000, 120000, 300000]; // ms

function _getLockoutDuration() {
  const idx = Math.min(_failedAttempts, LOCKOUT_DURATIONS.length - 1);
  return LOCKOUT_DURATIONS[idx];
}

function _isLockedOut() {
  if (_lockoutUntil > 0 && Date.now() < _lockoutUntil) return true;
  if (_lockoutUntil > 0 && Date.now() >= _lockoutUntil) { _lockoutUntil = 0; }
  return false;
}

function _getRemainingLockout() {
  if (!_isLockedOut()) return 0;
  return Math.ceil((_lockoutUntil - Date.now()) / 1000);
}

// ─── Password (PBKDF2 with salt, legacy SHA-256 fallback) ───

async function _sha256(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function _randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _pbkdf2Hash(password, saltHex) {
  // Try Web Worker first to avoid blocking UI
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        const w = new Worker('./workers/crypto-worker.js');
        const timer = setTimeout(() => { w.terminate(); reject(new Error('timeout')); }, 10000);
        w.onmessage = (e) => {
          clearTimeout(timer);
          w.terminate();
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.hash);
        };
        w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(e); };
        w.postMessage({ password, saltHex, iterations: 100000 });
      });
    } catch (_) { /* fall through to main-thread */ }
  }
  // Fallback: main-thread PBKDF2
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'pbkdf2:' + saltHex + ':' + hashHex;
}

async function checkPassword(input) {
  // Brute force protection
  if (_isLockedOut()) return false;

  const stored = localStorage.getItem('ct_pw_hash') || DEFAULT_HASH;
  let ok = false;

  if (stored.startsWith('pbkdf2:')) {
    // New PBKDF2 format: "pbkdf2:<salt>:<hash>"
    const parts = stored.split(':');
    if (parts.length === 3) {
      const computed = await _pbkdf2Hash(input, parts[1]);
      ok = computed === stored;
    }
  } else {
    // Legacy SHA-256 format (unsalted)
    const hash = await _sha256(input);
    ok = hash === stored;
    // Auto-migrate to PBKDF2 on successful legacy login
    if (ok) {
      const salt = _randomSalt();
      const newHash = await _pbkdf2Hash(input, salt);
      localStorage.setItem('ct_pw_hash', newHash);
    }
  }

  if (ok) {
    _failedAttempts = 0;
    _lockoutUntil = 0;
  } else {
    _failedAttempts++;
    if (_failedAttempts >= MAX_ATTEMPTS) {
      _lockoutUntil = Date.now() + _getLockoutDuration();
    }
  }

  return ok;
}

async function setPassword(newPassword) {
  const salt = _randomSalt();
  const hash = await _pbkdf2Hash(newPassword, salt);
  localStorage.setItem('ct_pw_hash', hash);
}

// ─── Password Complexity Validation ────────────────────────

/**
 * Validate password meets complexity requirements.
 * @returns {string|null} Error message, or null if valid.
 */
function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  if (!/[^a-zA-Z0-9]/.test(password)) return 'Password must contain at least one special character.';
  return null;
}

// ─── Edit mode (Auth-based shim) ──────────────────────────

/** Backward-compat shim: all existing Admin.isEditMode() calls work without mass-renaming */
function isEditMode() {
  // When Worker/auth is configured, use session-based auth
  if (GitHub.useWorker) {
    return Auth.isLoggedIn() && Auth.canEditSongs() && _adminModeActive;
  }
  // Legacy fallback: password-based edit mode (when Worker not configured)
  return _adminModeActive && !!localStorage.getItem('ct_pw_hash');
}

function enterEditMode() {
  // Require auth when Worker is active
  if (GitHub.useWorker) {
    if (!Auth.isLoggedIn() || !Auth.canEditSongs()) return;
  }
  _adminModeActive = true;
  document.getElementById('btn-add-song')?.classList.remove('hidden');
}

function exitEditMode() {
  _adminModeActive = false;
  document.getElementById('btn-add-song')?.classList.add('hidden');
}

/** Reset admin mode — called on login (true) and logout (false) */
function resetAdminMode(active) {
  _adminModeActive = active !== false;
}

/** Expose internal toggle state for dashboard UI */
function isAdminModeActive() { return _adminModeActive; }

// ─── ID generation ────────────────────────────────────────

/**
 * Generate a unique 4-digit hex ID not already in the songs list.
 * Range: 0x0000–0xFFFF (65,536 possible values)
 */
function generateId(existingSongs) {
  const existing = new Set((existingSongs || []).map(s => s.id));
  let attempts = 0;
  while (attempts < 1000) {
    const id = Math.floor(Math.random() * 0xFFFF)
      .toString(16)
      .padStart(4, '0');
    if (!existing.has(id)) return id;
    attempts++;
  }
  throw new Error('Could not generate unique ID — song list may be full');
}

// ─── Empty song template ──────────────────────────────────

function newSong(existingSongs) {
  return {
    id:       generateId(existingSongs),
    title:    '',
    subtitle: '',
    key:      '',
    bpm:      '',
    timeSig:  '',
    duration: 0,
    tags:     [],
    notes:    '',
    chartOrder: [], // [{driveId, order}] ordered charts for live mode
    assets: {
      charts: [],   // [{ driveId, name }]
      audio:  [],   // [{ driveId, name }]
      links:  [],   // [{ type: 'youtube'|'spotify'|'applemusic', url, embedId }]
    },
  };
}

function newSetlist(existingSetlists) {
  const now = new Date();
  return {
    id:            generateId(existingSetlists),
    venue:         '',       // Required — free text
    gigDate:       '',       // Required — ISO date string or "TBD"
    overrideTitle: '',       // Optional — replaces venue in display title
    songs:         [],       // [{ id, comment }]
    archived:      false,
    createdAt:     now.toISOString(),
    updatedAt:     now.toISOString(),
  };
}

// ─── Password modal ───────────────────────────────────────

let _pwCleanup = null;
function showPasswordModal(onSuccess) {
  if (_pwCleanup) _pwCleanup(); // Clean up any prior open
  const overlay = document.getElementById('modal-password');
  const input   = document.getElementById('password-input');
  const error   = document.getElementById('password-error');

  input.value = '';
  input.disabled = false;
  document.getElementById('btn-password-confirm').disabled = false;
  error.classList.add('hidden');
  overlay.classList.remove('hidden');
  const _ft = _trapFocus(overlay);

  let _lockTimer = null;
  // Show lockout message if already locked out
  if (_isLockedOut()) {
    const secs = _getRemainingLockout();
    error.textContent = `Too many attempts. Try again in ${secs}s.`;
    error.classList.remove('hidden');
    input.disabled = true;
    document.getElementById('btn-password-confirm').disabled = true;
    _lockTimer = setInterval(() => {
      if (!_isLockedOut()) {
        clearInterval(_lockTimer);
        _lockTimer = null;
        error.classList.add('hidden');
        error.textContent = 'Incorrect password.';
        input.disabled = false;
        document.getElementById('btn-password-confirm').disabled = false;
        input.focus();
      } else {
        error.textContent = `Too many attempts. Try again in ${_getRemainingLockout()}s.`;
      }
    }, 1000);
  }

  let _confirming = false;
  const confirm = async () => {
    if (_confirming) return;
    if (_isLockedOut()) return;
    _confirming = true;
    try {
      const ok = await checkPassword(input.value);
      if (ok) {
        input.value = '';
        overlay.classList.add('hidden');
        if (_ft) _ft.release();
        cleanup();
        onSuccess();
      } else {
        if (_isLockedOut()) {
          const secs = _getRemainingLockout();
          error.textContent = `Too many attempts. Try again in ${secs}s.`;
          input.disabled = true;
          document.getElementById('btn-password-confirm').disabled = true;
          if (_lockTimer) clearInterval(_lockTimer);
          _lockTimer = setInterval(() => {
            if (!_isLockedOut()) {
              clearInterval(_lockTimer);
              _lockTimer = null;
              error.textContent = 'Incorrect password.';
              input.disabled = false;
              document.getElementById('btn-password-confirm').disabled = false;
              input.focus();
            } else {
              error.textContent = `Too many attempts. Try again in ${_getRemainingLockout()}s.`;
            }
          }, 1000);
        } else {
          error.textContent = 'Incorrect password.';
        }
        error.classList.remove('hidden');
        input.value = '';
        input.focus();
      }
    } finally {
      _confirming = false;
    }
  };

  const cancel = () => {
    overlay.classList.add('hidden');
    if (_ft) _ft.release();
    cleanup();
  };

  const keydown = (e) => {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') cancel();
  };

  // Dismiss on backdrop click (outside the modal card)
  const backdropClick = (e) => {
    if (e.target === overlay) cancel();
  };

  document.getElementById('btn-password-confirm').addEventListener('click', confirm);
  document.getElementById('btn-password-cancel').addEventListener('click', cancel);
  input.addEventListener('keydown', keydown);
  overlay.addEventListener('click', backdropClick);

  function cleanup() {
    if (_lockTimer) { clearInterval(_lockTimer); _lockTimer = null; }
    document.getElementById('btn-password-confirm').removeEventListener('click', confirm);
    document.getElementById('btn-password-cancel').removeEventListener('click', cancel);
    input.removeEventListener('keydown', keydown);
    overlay.removeEventListener('click', backdropClick);
    _pwCleanup = null;
  }
  _pwCleanup = cleanup;
}

// ─── Confirm modal ────────────────────────────────────────

let _confirmCleanup = null;
function showConfirm(title, message, onConfirm, okLabel) {
  if (_confirmCleanup) _confirmCleanup();
  const overlay = document.getElementById('modal-confirm');
  const okBtn = document.getElementById('btn-confirm-ok');
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').textContent = message;
  okBtn.textContent = okLabel || 'Delete';
  okBtn.className = okLabel ? 'btn-primary' : 'btn-danger';
  overlay.classList.remove('hidden');
  const _ft = _trapFocus(overlay);

  const ok     = () => { overlay.classList.add('hidden'); if (_ft) _ft.release(); cleanup(); _getApp().then(App => App.hapticHeavy()); onConfirm(); };
  const cancel = () => { overlay.classList.add('hidden'); if (_ft) _ft.release(); cleanup(); };
  const keydown = (e) => { if (e.key === 'Escape') cancel(); };

  document.getElementById('btn-confirm-ok').addEventListener('click', ok);
  document.getElementById('btn-confirm-cancel').addEventListener('click', cancel);
  document.addEventListener('keydown', keydown);

  function cleanup() {
    document.getElementById('btn-confirm-ok').removeEventListener('click', ok);
    document.getElementById('btn-confirm-cancel').removeEventListener('click', cancel);
    document.removeEventListener('keydown', keydown);
    _confirmCleanup = null;
  }
  _confirmCleanup = cleanup;
}

// ─── Drive setup modal ────────────────────────────────────

let _driveCleanup = null;
function showDriveModal(onSave) {
  if (_driveCleanup) _driveCleanup();
  const overlay  = document.getElementById('modal-drive');
  const cfg      = Drive.getConfig();
  document.getElementById('drive-api-key').value   = cfg.apiKey;
  document.getElementById('drive-client-id').value = cfg.clientId;
  document.getElementById('drive-folder-id').value = cfg.folderId;
  overlay.classList.remove('hidden');
  const _ft = _trapFocus(overlay);

  const save = () => {
    Drive.saveConfig({
      apiKey:   document.getElementById('drive-api-key').value,
      clientId: document.getElementById('drive-client-id').value,
      folderId: document.getElementById('drive-folder-id').value,
    });
    overlay.classList.add('hidden');
    if (_ft) _ft.release();
    cleanup();
    if (onSave) onSave();
  };

  const cancel = () => { overlay.classList.add('hidden'); if (_ft) _ft.release(); cleanup(); };

  document.getElementById('btn-drive-save').addEventListener('click', save);
  document.getElementById('btn-drive-cancel').addEventListener('click', cancel);

  function cleanup() {
    document.getElementById('btn-drive-save').removeEventListener('click', save);
    document.getElementById('btn-drive-cancel').removeEventListener('click', cancel);
    _driveCleanup = null;
  }
  _driveCleanup = cleanup;
}

// ─── GitHub setup modal ──────────────────────────────────

let _ghCleanup = null;
function showGitHubModal(onSave) {
  if (_ghCleanup) _ghCleanup();
  const overlay = document.getElementById('modal-github');
  const patInput   = document.getElementById('github-pat');
  const ownerInput = document.getElementById('github-owner');
  const repoInput  = document.getElementById('github-repo');
  const testBtn    = document.getElementById('btn-github-test');
  const resultEl   = document.getElementById('github-test-result');

  // When Worker proxy is active, hide PAT field and show status
  const patField = patInput.closest('.github-field');
  if (GitHub.useWorker) {
    if (patField) patField.style.display = 'none';
    resultEl.className = 'github-test-result success';
    resultEl.textContent = 'Connected via secure Worker proxy — no PAT needed on this device.';
  } else {
    if (patField) patField.style.display = '';
  }

  // Snapshot original config to restore on cancel
  const origPat   = localStorage.getItem('ct_github_pat')   || '';
  const origOwner = localStorage.getItem('ct_github_owner') || '';
  const origRepo  = localStorage.getItem('ct_github_repo')  || '';

  patInput.value   = origPat;
  // Pre-fill owner/repo with defaults from GitHub module (user only needs PAT)
  const ghConfig = GitHub.getConfig();
  ownerInput.value = origOwner || ghConfig.owner;
  repoInput.value  = origRepo || ghConfig.repo;
  if (!GitHub.useWorker) {
    resultEl.className = 'github-test-result hidden';
    resultEl.textContent = '';
  }
  overlay.classList.remove('hidden');
  const _ft = _trapFocus(overlay);
  if (!GitHub.useWorker) setTimeout(() => patInput.focus(), 50);

  let _testing = false;

  const test = async () => {
    if (_testing) return;
    const pat   = patInput.value.trim();
    const owner = ownerInput.value.trim();
    const repo  = repoInput.value.trim();
    if (!pat) {
      resultEl.className = 'github-test-result error';
      resultEl.textContent = 'Personal Access Token is required.';
      return;
    }
    _testing = true;
    testBtn.disabled = true;
    resultEl.className = 'github-test-result';
    resultEl.textContent = 'Testing…';
    // Temporarily save for test, restore originals after
    GitHub.saveConfig({ pat, owner, repo });
    try {
      const result = await GitHub.testConnection();
      if (result.ok) {
        resultEl.className = 'github-test-result success';
        resultEl.textContent = `Connected to ${result.repoName}` +
          (result.hasBranch ? ' — data branch found' : ' — data branch not yet created');
      } else {
        resultEl.className = 'github-test-result error';
        resultEl.textContent = result.error;
        // Restore original config on failed test
        GitHub.saveConfig({ pat: origPat, owner: origOwner, repo: origRepo });
      }
    } catch (e) {
      resultEl.className = 'github-test-result error';
      resultEl.textContent = e.message || 'Test failed';
      GitHub.saveConfig({ pat: origPat, owner: origOwner, repo: origRepo });
    } finally {
      _testing = false;
      testBtn.disabled = false;
    }
  };

  const save = async () => {
    const pat   = patInput.value.trim();
    const owner = ownerInput.value.trim();
    const repo  = repoInput.value.trim();
    if (!pat && !GitHub.useWorker) {
      resultEl.className = 'github-test-result error';
      resultEl.textContent = 'Personal Access Token is required.';
      return;
    }
    GitHub.saveConfig({ pat, owner, repo });
    overlay.classList.add('hidden');
    if (_ft) _ft.release();
    cleanup();
    if (onSave) onSave();
    // Publish encrypted PAT to Drive for other devices to auto-detect
    try {
      await GitHub.publishPat();
    } catch (e) {
      console.warn('Could not publish PAT', e);
      Utils.showToast('GitHub config saved locally — PAT sync to Drive failed.');
    }
  };

  const cancel = () => {
    // Restore original config (test may have temporarily changed it)
    GitHub.saveConfig({ pat: origPat, owner: origOwner, repo: origRepo });
    overlay.classList.add('hidden');
    if (_ft) _ft.release();
    cleanup();
  };

  const keydown = (e) => {
    if (e.key === 'Escape') cancel();
  };

  const overlayClick = (e) => {
    if (e.target === overlay) cancel();
  };

  testBtn.addEventListener('click', test);
  document.getElementById('btn-github-save').addEventListener('click', save);
  document.getElementById('btn-github-cancel').addEventListener('click', cancel);
  document.addEventListener('keydown', keydown);
  overlay.addEventListener('click', overlayClick);

  function cleanup() {
    testBtn.removeEventListener('click', test);
    document.getElementById('btn-github-save').removeEventListener('click', save);
    document.getElementById('btn-github-cancel').removeEventListener('click', cancel);
    document.removeEventListener('keydown', keydown);
    overlay.removeEventListener('click', overlayClick);
    _ghCleanup = null;
  }
  _ghCleanup = cleanup;
}

// ─── Login modal (user accounts) ─────────────────────────

let _loginCleanup = null;
async function showLoginModal(onSuccess, opts) {
  if (_loginCleanup) _loginCleanup();
  const overlay  = document.getElementById('modal-login');
  if (!overlay) {
    showPasswordModal(onSuccess);
    return;
  }
  const titleEl    = document.getElementById('modal-login-title');
  const subtextEl  = document.getElementById('login-subtext');
  const username   = document.getElementById('login-username');
  const password   = document.getElementById('login-password');
  const confirmPw  = document.getElementById('login-confirm-password');
  const emailInput = document.getElementById('login-email');
  const confirmEmail = document.getElementById('login-confirm-email');
  const honeypot   = document.getElementById('login-hp');
  const error      = document.getElementById('login-error');
  const confirmBtn = document.getElementById('btn-login-confirm');
  const forgotLink = document.getElementById('login-forgot');
  const forgotBtn  = document.getElementById('btn-login-forgot');
  const confirmPwRow = document.getElementById('login-confirm-pw-row');
  const emailRow     = document.getElementById('login-email-row');
  const confirmEmailRow = document.getElementById('login-confirm-email-row');
  const toggleModeDiv = document.getElementById('login-toggle-mode');
  const toggleBtn  = document.getElementById('btn-login-toggle');

  // Detect first-run setup
  let _setupMode = false;
  if (Auth.checkNeedsSetup) {
    try { _setupMode = await Auth.checkNeedsSetup(); } catch (_) {}
  }

  // Register mode toggle (separate from setup mode)
  let _registerMode = false;

  function _applyMode() {
    // Reset error state
    error.classList.add('hidden');
    error.textContent = '';
    error.style.color = '';

    if (_setupMode) {
      // Owner setup — no toggle shown
      titleEl.textContent = 'Create Your Account';
      subtextEl.textContent = 'First-time setup — choose a username and password.';
      confirmBtn.textContent = 'Create Account';
      confirmPwRow?.classList.remove('hidden');
      emailRow?.classList.add('hidden');
      confirmEmailRow?.classList.add('hidden');
      forgotLink?.classList.add('hidden');
      toggleModeDiv?.classList.add('hidden');
    } else if (_registerMode) {
      // Self-registration mode
      titleEl.textContent = 'Create Account';
      subtextEl.textContent = 'Sign up to join Catman Trio.';
      confirmBtn.textContent = 'Create Account';
      confirmPwRow?.classList.remove('hidden');
      emailRow?.classList.remove('hidden');
      confirmEmailRow?.classList.remove('hidden');
      forgotLink?.classList.add('hidden');
      toggleModeDiv?.classList.remove('hidden');
      if (toggleBtn) toggleBtn.innerHTML = 'Already have an account? <b>Sign In</b>';
    } else {
      // Normal sign-in mode
      titleEl.textContent = 'Sign In';
      subtextEl.textContent = 'Sign in to access edit mode and sync.';
      confirmBtn.textContent = 'Sign In';
      confirmPwRow?.classList.add('hidden');
      emailRow?.classList.add('hidden');
      confirmEmailRow?.classList.add('hidden');
      forgotLink?.classList.remove('hidden');
      toggleModeDiv?.classList.remove('hidden');
      if (toggleBtn) toggleBtn.innerHTML = 'Don\'t have an account? <b>Sign Up</b>';
    }
  }

  // Reset all fields
  username.value = '';
  password.value = '';
  confirmPw.value = '';
  if (emailInput) emailInput.value = '';
  if (confirmEmail) confirmEmail.value = '';
  if (honeypot) honeypot.value = '';

  // Apply initial mode
  _applyMode();

  // Bot detection: record when modal was opened (mutable — reset on toggle)
  let _openedAt = Date.now();

  overlay.classList.remove('hidden');
  const _ft = _trapFocus(overlay);
  setTimeout(() => username.focus(), 50);

  // Toggle handler
  const toggleClick = (e) => {
    e.preventDefault();
    _registerMode = !_registerMode;
    // Clear field values on mode switch
    password.value = '';
    confirmPw.value = '';
    if (emailInput) emailInput.value = '';
    if (confirmEmail) confirmEmail.value = '';
    _openedAt = Date.now(); // Reset timing check for bot protection
    _applyMode();
    username.focus();
  };

  let _submitting = false;
  let _cancelled = false;
  const submit = async () => {
    if (_submitting) return;

    // Honeypot check — bots fill hidden fields
    if (honeypot && honeypot.value) {
      error.textContent = 'Something went wrong. Please try again.';
      error.classList.remove('hidden');
      return;
    }

    // Timing check — reject if submitted in under 2 seconds
    if (Date.now() - _openedAt < 2000) {
      error.textContent = 'Please wait a moment before submitting.';
      error.classList.remove('hidden');
      return;
    }

    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) {
      error.textContent = 'Username and password are required.';
      error.classList.remove('hidden');
      return;
    }

    if (_setupMode || _registerMode) {
      // Password complexity
      const pwError = validatePassword(p);
      if (pwError) {
        error.textContent = pwError;
        error.classList.remove('hidden');
        return;
      }
      // Confirm password
      if (p !== confirmPw.value) {
        error.textContent = 'Passwords do not match.';
        error.classList.remove('hidden');
        confirmPw.value = '';
        confirmPw.focus();
        return;
      }
    }

    if (_registerMode) {
      // Email validation
      const em = (emailInput?.value || '').trim();
      if (!em) {
        error.textContent = 'Email is required.';
        error.classList.remove('hidden');
        emailInput?.focus();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        error.textContent = 'Invalid email format.';
        error.classList.remove('hidden');
        emailInput?.focus();
        return;
      }
      // Confirm email
      const cem = (confirmEmail?.value || '').trim();
      if (em.toLowerCase() !== cem.toLowerCase()) {
        error.textContent = 'Email addresses do not match.';
        error.classList.remove('hidden');
        if (confirmEmail) confirmEmail.value = '';
        confirmEmail?.focus();
        return;
      }
      // Username format
      if (u.length < 2) {
        error.textContent = 'Username must be at least 2 characters.';
        error.classList.remove('hidden');
        username.focus();
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(u)) {
        error.textContent = 'Username may only contain letters, numbers, and underscores.';
        error.classList.remove('hidden');
        username.focus();
        return;
      }
      if (u.length > 25) {
        error.textContent = 'Username must be 25 characters or less.';
        error.classList.remove('hidden');
        username.focus();
        return;
      }
    }

    _submitting = true;
    const actionLabel = (_setupMode || _registerMode) ? 'Creating account\u2026' : 'Signing in\u2026';
    error.textContent = actionLabel;
    error.className = 'error-msg';
    error.style.color = 'var(--text-2)';
    error.classList.remove('hidden');

    try {
      let result;
      if (_setupMode) {
        const displayName = u.charAt(0).toUpperCase() + u.slice(1).toLowerCase();
        const email = 'christianatremblay@gmail.com';
        result = await Auth.setupInit(u, p, displayName, email);
      } else if (_registerMode) {
        const displayName = u.charAt(0).toUpperCase() + u.slice(1).toLowerCase();
        const em = emailInput.value.trim();
        result = await Auth.register(u, p, displayName, em);
      } else {
        result = await Auth.login(u, p);
      }
      if (_cancelled) return;
      if (result.ok) {
        let successLabel;
        if (result.needsLogin) {
          successLabel = 'Account created! Please log in.';
        } else if (_registerMode && result.emailSent === false) {
          successLabel = 'Account created! Verify email from your profile.';
        } else if (_setupMode || _registerMode) {
          successLabel = 'Account created!';
        } else {
          successLabel = 'Signed in!';
        }
        error.textContent = successLabel;
        error.style.color = '#7ec87e';
        await new Promise(r => setTimeout(r, 1800));
        if (_cancelled) return;
        if (result.needsLogin) {
          // Session creation failed — switch to sign-in mode
          password.value = '';
          confirmPw.value = '';
          _registerMode = false;
          _applyMode();
          username.focus();
        } else {
          overlay.classList.add('hidden');
          // Clear sensitive fields after modal is hidden
          password.value = '';
          confirmPw.value = '';
          if (emailInput) emailInput.value = '';
          if (confirmEmail) confirmEmail.value = '';
          if (_ft) _ft.release();
          cleanup();
          onSuccess();
        }
      } else {
        const failLabel = (_setupMode || _registerMode) ? 'Registration failed.' : 'Invalid credentials.';
        error.textContent = result.error || failLabel;
        error.className = 'error-msg';
        error.style.color = '';
        error.classList.remove('hidden');
        password.value = '';
        confirmPw.value = '';
        password.focus();
      }
    } catch (e) {
      error.textContent = 'Network error \u2014 check connection.';
      error.className = 'error-msg';
      error.style.color = '';
      error.classList.remove('hidden');
    } finally {
      _submitting = false;
    }
  };

  const cancel = () => {
    _cancelled = true;
    overlay.classList.add('hidden');
    if (_ft) _ft.release();
    cleanup();
  };

  // Forgot password handler
  const forgotClick = (e) => {
    e.preventDefault();
    overlay.classList.add('hidden');
    if (_ft) _ft.release();
    cleanup();
    _getApp().then(App => { if (App.showForgotPasswordModal) App.showForgotPasswordModal(); });
  };

  const keydown = (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') cancel();
  };

  const backdropClick = (e) => {
    if (e.target === overlay) cancel();
  };

  confirmBtn.addEventListener('click', submit);
  document.getElementById('btn-login-cancel').addEventListener('click', cancel);
  forgotBtn?.addEventListener('click', forgotClick);
  toggleBtn?.addEventListener('click', toggleClick);
  username.addEventListener('keydown', keydown);
  password.addEventListener('keydown', keydown);
  confirmPw?.addEventListener('keydown', keydown);
  emailInput?.addEventListener('keydown', keydown);
  confirmEmail?.addEventListener('keydown', keydown);
  overlay.addEventListener('click', backdropClick);

  function cleanup() {
    confirmBtn.removeEventListener('click', submit);
    document.getElementById('btn-login-cancel').removeEventListener('click', cancel);
    forgotBtn?.removeEventListener('click', forgotClick);
    toggleBtn?.removeEventListener('click', toggleClick);
    username.removeEventListener('keydown', keydown);
    password.removeEventListener('keydown', keydown);
    confirmPw?.removeEventListener('keydown', keydown);
    emailInput?.removeEventListener('keydown', keydown);
    confirmEmail?.removeEventListener('keydown', keydown);
    overlay.removeEventListener('click', backdropClick);
    // Reset field visibility
    confirmPwRow?.classList.add('hidden');
    emailRow?.classList.add('hidden');
    confirmEmailRow?.classList.add('hidden');
    toggleModeDiv?.classList.add('hidden');
    _loginCleanup = null;
  }
  _loginCleanup = cleanup;
}

// ─── Focus trap (delegated to Modal module) ──────────────
const _trapFocus = Modal.trapFocus;

export { isEditMode, enterEditMode, exitEditMode, resetAdminMode, isAdminModeActive, generateId, newSong, newSetlist, checkPassword, setPassword, showPasswordModal, showLoginModal, showConfirm, showDriveModal, showGitHubModal, validatePassword, _trapFocus };
