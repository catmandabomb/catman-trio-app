/**
 * drive.js — Google Drive API integration
 *
 * Handles:
 *  - OAuth2 sign-in via GIS (Google Identity Services)
 *  - songs.json read/write in the configured folder
 *  - File fetch (PDF/audio) returning blob URLs
 *  - File upload (PDF/audio) to the configured folder
 *
 * Config stored in localStorage:
 *   bb_api_key, bb_client_id, bb_folder_id
 *
 * After sign-in, access token stored in memory only (never persisted).
 */

const Drive = (() => {

  const SONGS_FILENAME = 'catmantrio_songs.json';
  const SCOPES = 'https://www.googleapis.com/auth/drive';

  let _accessToken = null;
  let _tokenClient = null;
  let _resolveToken = null;

  // ─── Config ───────────────────────────────────────────────

  // Default credentials — public read access, no sign-in needed
  const DEFAULT_API_KEY   = 'AIzaSyBuM22B_16Xu3Kl6kcgQynlriPCO5G8oZ8';
  const DEFAULT_FOLDER_ID = '101APHEiSfaRofwi6e58bfhMbarek4w-y';

  function getConfig() {
    return {
      apiKey:   localStorage.getItem('bb_api_key')   || DEFAULT_API_KEY,
      clientId: localStorage.getItem('bb_client_id') || '',
      folderId: localStorage.getItem('bb_folder_id') || DEFAULT_FOLDER_ID,
    };
  }

  function saveConfig({ apiKey, clientId, folderId }) {
    localStorage.setItem('bb_api_key',   apiKey.trim());
    localStorage.setItem('bb_client_id', clientId.trim());
    localStorage.setItem('bb_folder_id', folderId.trim());
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.apiKey && c.folderId);
  }

  function isWriteConfigured() {
    const c = getConfig();
    return !!(c.apiKey && c.clientId && c.folderId);
  }

  // ─── Auth ──────────────────────────────────────────────────

  /**
   * Ensure we have a valid access token. Returns a promise that
   * resolves with the token string.
   */
  function ensureToken() {
    if (_accessToken) return Promise.resolve(_accessToken);
    return new Promise((resolve, reject) => {
      const { clientId } = getConfig();
      if (!clientId) return reject(new Error('Drive not configured'));

      if (!_tokenClient) {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: (resp) => {
            if (resp.error) {
              if (_resolveToken) _resolveToken.reject(new Error(resp.error));
              return;
            }
            _accessToken = resp.access_token;
            if (_resolveToken) _resolveToken.resolve(_accessToken);
          },
        });
      }

      _resolveToken = { resolve, reject };
      _tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function signOut() {
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken);
      _accessToken = null;
    }
  }

  // ─── Core fetch helper ─────────────────────────────────────

  async function driveRequest(url, options = {}) {
    const token = await ensureToken();
    const resp = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Drive API ${resp.status}: ${text}`);
    }
    return resp;
  }

  // ─── Find file by name in folder ──────────────────────────

  async function findFile(name) {
    const { folderId, apiKey } = getConfig();
    const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&key=${apiKey}`;
    const resp = await driveRequest(url);
    const data = await resp.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  // ─── Public read (no auth, folder must be shared) ────────

  async function findFilePublic(name) {
    const { folderId, apiKey } = getConfig();
    const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Drive API ${resp.status}`);
    const data = await resp.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  // ─── Songs JSON ────────────────────────────────────────────

  async function loadSongs() {
    if (!isConfigured()) return null;
    try {
      const file = await findFilePublic(SONGS_FILENAME);
      if (!file) return [];
      const { apiKey } = getConfig();
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`
      );
      if (!resp.ok) throw new Error(`Drive API ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error('loadSongs error', e);
      throw e;
    }
  }

  async function saveSongs(songs) {
    const { folderId } = getConfig();
    const existing = await findFile(SONGS_FILENAME);
    const content = JSON.stringify(songs, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    if (existing) {
      // Update existing file
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json' }));
      form.append('file', blob);
      await driveRequest(
        `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`,
        { method: 'PATCH', body: form }
      );
    } else {
      // Create new file
      const form = new FormData();
      const meta = { name: SONGS_FILENAME, parents: [folderId], mimeType: 'application/json' };
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', blob);
      await driveRequest(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        { method: 'POST', body: form }
      );
    }
  }

  // ─── File upload ───────────────────────────────────────────

  /**
   * Upload a File object to the Drive folder.
   * Returns { id, name } of the created Drive file.
   */
  async function uploadFile(file) {
    const { folderId } = getConfig();
    const meta = { name: file.name, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', file);
    const resp = await driveRequest(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      { method: 'POST', body: form }
    );
    return await resp.json();
  }

  /**
   * Delete a file from Drive by ID.
   */
  async function deleteFile(fileId) {
    await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      { method: 'DELETE' }
    );
  }

  // ─── File fetch → blob URL ─────────────────────────────────

  /**
   * Fetch a Drive file by ID and return a temporary blob URL.
   * Caller is responsible for revoking: URL.revokeObjectURL(url)
   */
  async function fetchFileAsBlob(fileId) {
    const { apiKey } = getConfig();
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`
    );
    if (!resp.ok) throw new Error(`Drive API ${resp.status}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  }

  // ─── Get file metadata ─────────────────────────────────────

  async function getFileMeta(fileId) {
    const { apiKey } = getConfig();
    const resp = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size&key=${apiKey}`
    );
    return await resp.json();
  }

  // ─── Public API ────────────────────────────────────────────

  return {
    getConfig,
    saveConfig,
    isConfigured,
    isWriteConfigured,
    ensureToken,
    signOut,
    loadSongs,
    saveSongs,
    uploadFile,
    deleteFile,
    fetchFileAsBlob,
    getFileMeta,
  };

})();
