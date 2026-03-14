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
    document.getElementById('btn-add-song').classList.remove('hidden');
    const btn = document.getElementById('btn-edit-mode');
    btn.innerHTML = 'Exit Admin<br>Edit Mode';
    btn.classList.add('exit-mode');
  }

  function exitEditMode() {
    _editMode = false;
    document.getElementById('btn-add-song').classList.add('hidden');
    const btn = document.getElementById('btn-edit-mode');
    btn.textContent = 'Edit';
    btn.classList.remove('exit-mode');
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

  function showPasswordModal(onSuccess) {
    const overlay = document.getElementById('modal-password');
    const input   = document.getElementById('password-input');
    const error   = document.getElementById('password-error');

    input.value = '';
    error.classList.add('hidden');
    overlay.classList.remove('hidden');

    setTimeout(() => input.focus(), 50);

    const confirm = async () => {
      const ok = await checkPassword(input.value);
      if (ok) {
        overlay.classList.add('hidden');
        cleanup();
        onSuccess();
      } else {
        error.classList.remove('hidden');
        input.value = '';
        input.focus();
      }
    };

    const cancel = () => {
      overlay.classList.add('hidden');
      cleanup();
    };

    const keydown = (e) => { if (e.key === 'Enter') confirm(); };

    document.getElementById('btn-password-confirm').addEventListener('click', confirm);
    document.getElementById('btn-password-cancel').addEventListener('click', cancel);
    input.addEventListener('keydown', keydown);

    function cleanup() {
      document.getElementById('btn-password-confirm').removeEventListener('click', confirm);
      document.getElementById('btn-password-cancel').removeEventListener('click', cancel);
      input.removeEventListener('keydown', keydown);
    }
  }

  // ─── Confirm modal ────────────────────────────────────────

  function showConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('modal-confirm');
    document.getElementById('confirm-title').textContent   = title;
    document.getElementById('confirm-message').textContent = message;
    overlay.classList.remove('hidden');

    const ok     = () => { overlay.classList.add('hidden'); cleanup(); onConfirm(); };
    const cancel = () => { overlay.classList.add('hidden'); cleanup(); };

    document.getElementById('btn-confirm-ok').addEventListener('click', ok);
    document.getElementById('btn-confirm-cancel').addEventListener('click', cancel);

    function cleanup() {
      document.getElementById('btn-confirm-ok').removeEventListener('click', ok);
      document.getElementById('btn-confirm-cancel').removeEventListener('click', cancel);
    }
  }

  // ─── Drive setup modal ────────────────────────────────────

  function showDriveModal(onSave) {
    const overlay  = document.getElementById('modal-drive');
    const cfg      = Drive.getConfig();
    document.getElementById('drive-api-key').value   = cfg.apiKey;
    document.getElementById('drive-client-id').value = cfg.clientId;
    document.getElementById('drive-folder-id').value = cfg.folderId;
    overlay.classList.remove('hidden');

    const save = () => {
      Drive.saveConfig({
        apiKey:   document.getElementById('drive-api-key').value,
        clientId: document.getElementById('drive-client-id').value,
        folderId: document.getElementById('drive-folder-id').value,
      });
      overlay.classList.add('hidden');
      cleanup();
      if (onSave) onSave();
    };

    const cancel = () => { overlay.classList.add('hidden'); cleanup(); };

    document.getElementById('btn-drive-save').addEventListener('click', save);
    document.getElementById('btn-drive-cancel').addEventListener('click', cancel);

    function cleanup() {
      document.getElementById('btn-drive-save').removeEventListener('click', save);
      document.getElementById('btn-drive-cancel').removeEventListener('click', cancel);
    }
  }

  return {
    isEditMode,
    enterEditMode,
    exitEditMode,
    generateId,
    newSong,
    newSetlist,
    checkPassword,
    setPassword,
    showPasswordModal,
    showConfirm,
    showDriveModal,
  };

})();
