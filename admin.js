/**
 * admin.js — Edit mode, password gate, CRUD operations
 *
 * Password is stored as a SHA-256 hex hash in localStorage (bb_pw_hash).
 * Default password on first run: see DEFAULT_HASH — change it in the app.
 *
 * Generates 4-digit hex IDs for new songs (e.g. "3f9a").
 */

const Admin = (() => {

  // Default password hash — SHA-256 of "Administraitor1!"
  const DEFAULT_HASH = 'e5c128a06031c45577c71b9a49a5fffa3a93e077354ce609bd616b5cf70d32f4';

  let _editMode = false;

  // ─── Password ─────────────────────────────────────────────

  async function _sha256(str) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function checkPassword(input) {
    const hash = await _sha256(input);
    const stored = localStorage.getItem('bb_pw_hash') || DEFAULT_HASH;
    return hash === stored;
  }

  async function setPassword(newPassword) {
    const hash = await _sha256(newPassword);
    localStorage.setItem('bb_pw_hash', hash);
  }

  // ─── Edit mode ────────────────────────────────────────────

  function isEditMode() { return _editMode; }

  function enterEditMode() {
    _editMode = true;
    try { sessionStorage.setItem('bb_admin_active', '1'); } catch (_) {}
    document.getElementById('btn-add-song')?.classList.remove('hidden');
    document.getElementById('admin-dashboard-bar')?.classList.remove('hidden');
    const btn = document.getElementById('btn-edit-mode');
    if (btn) { btn.innerHTML = 'Exit Admin<br>Edit Mode'; btn.classList.add('exit-mode'); }
  }

  function exitEditMode() {
    _editMode = false;
    try { sessionStorage.removeItem('bb_admin_active'); } catch (_) {}
    document.getElementById('btn-add-song')?.classList.add('hidden');
    document.getElementById('admin-dashboard-bar')?.classList.add('hidden');
    const btn = document.getElementById('btn-edit-mode');
    if (btn) { btn.textContent = 'Edit'; btn.classList.remove('exit-mode'); }
  }

  /** Restore admin mode from sessionStorage (survives refresh, not tab close) */
  function restoreEditMode() {
    try {
      if (sessionStorage.getItem('bb_admin_active') === '1') {
        enterEditMode();
        return true;
      }
    } catch (_) { /* sessionStorage unavailable */ }
    return false;
  }

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
    const now = new Date().toISOString();
    return {
      id:        generateId(existingSetlists),
      name:      '',
      songs:     [],   // [{ id, comment }]
      gigDate:   '',   // ISO date string, optional
      archived:  false,
      createdAt: now,
      updatedAt: now,
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
    error.classList.add('hidden');
    overlay.classList.remove('hidden');
    const _ft = _trapFocus(overlay);

    let _confirming = false;
    const confirm = async () => {
      if (_confirming) return;
      _confirming = true;
      try {
        const ok = await checkPassword(input.value);
        if (ok) {
          overlay.classList.add('hidden');
          if (_ft) _ft.release();
          cleanup();
          onSuccess();
        } else {
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

    document.getElementById('btn-password-confirm').addEventListener('click', confirm);
    document.getElementById('btn-password-cancel').addEventListener('click', cancel);
    input.addEventListener('keydown', keydown);

    function cleanup() {
      document.getElementById('btn-password-confirm').removeEventListener('click', confirm);
      document.getElementById('btn-password-cancel').removeEventListener('click', cancel);
      input.removeEventListener('keydown', keydown);
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

    const ok     = () => { overlay.classList.add('hidden'); if (_ft) _ft.release(); cleanup(); if (typeof App !== 'undefined') App.hapticHeavy(); onConfirm(); };
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

    // Snapshot original config to restore on cancel
    const origPat   = localStorage.getItem('bb_github_pat')   || '';
    const origOwner = localStorage.getItem('bb_github_owner') || '';
    const origRepo  = localStorage.getItem('bb_github_repo')  || '';

    patInput.value   = origPat;
    // Pre-fill owner/repo with defaults from GitHub module (user only needs PAT)
    const ghConfig = GitHub.getConfig();
    ownerInput.value = origOwner || ghConfig.owner;
    repoInput.value  = origRepo || ghConfig.repo;
    resultEl.className = 'github-test-result hidden';
    resultEl.textContent = '';
    overlay.classList.remove('hidden');
    const _ft = _trapFocus(overlay);
    setTimeout(() => patInput.focus(), 50);

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

    const save = () => {
      const pat   = patInput.value.trim();
      const owner = ownerInput.value.trim();
      const repo  = repoInput.value.trim();
      if (!pat) {
        resultEl.className = 'github-test-result error';
        resultEl.textContent = 'Personal Access Token is required.';
        return;
      }
      GitHub.saveConfig({ pat, owner, repo });
      // Publish encrypted PAT to Drive for other devices to auto-detect
      GitHub.publishPat().catch(e => console.warn('Could not publish PAT', e));
      overlay.classList.add('hidden');
      if (_ft) _ft.release();
      cleanup();
      if (onSave) onSave();
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

  // ─── Focus trap utility (Feature 4) ──────────────────────

  function _trapFocus(modalEl) {
    if (!modalEl) return null;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const previousFocus = document.activeElement;
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = [...modalEl.querySelectorAll(focusableSelector)].filter(el => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    modalEl.addEventListener('keydown', handler);
    // Focus first focusable element
    const firstFocusable = modalEl.querySelector(focusableSelector);
    if (firstFocusable) setTimeout(() => firstFocusable.focus(), 50);
    return {
      release() {
        modalEl.removeEventListener('keydown', handler);
        if (previousFocus && previousFocus.focus) {
          try { previousFocus.focus(); } catch (_) {}
        }
      }
    };
  }

  return {
    isEditMode,
    enterEditMode,
    exitEditMode,
    restoreEditMode,
    generateId,
    newSong,
    newSetlist,
    checkPassword,
    setPassword,
    showPasswordModal,
    showConfirm,
    showDriveModal,
    showGitHubModal,
    _trapFocus,
  };

})();
