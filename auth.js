/**
 * auth.js — Client-side authentication module
 *
 * Manages login/logout, session tokens, and role-based permissions.
 * Session data is cached in localStorage for offline access.
 *
 * Dependencies: GitHub (for workerUrl), Utils (for showToast)
 */

import * as GitHub from './github.js?v=20.05';

// ─── State ──────────────────────────────────────────────

let _token = null;
let _user = null;        // { id, username, displayName, role }
let _expires = null;
let _checked = false;    // Has refreshSession run at least once?

// ─── Config ─────────────────────────────────────────────

function _workerUrl() {
  return GitHub.workerUrl
    ? GitHub.workerUrl
    : 'https://catman-api.catmandabomb.workers.dev';
}

// ─── Persistence (localStorage for offline) ─────────────

function _save() {
  try {
    if (_token && _user) {
      localStorage.setItem('ct_auth', JSON.stringify({
        token: _token,
        user: _user,
        expires: _expires,
      }));
    } else {
      localStorage.removeItem('ct_auth');
    }
  } catch (_) {}
}

function _restore() {
  try {
    const raw = localStorage.getItem('ct_auth');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.token || !data.user) return false;
    // Check if expired
    if (data.expires && new Date(data.expires) < new Date()) {
      localStorage.removeItem('ct_auth');
      return false;
    }
    _token = data.token;
    _user = data.user;
    _expires = data.expires;
    return true;
  } catch (_) {
    return false;
  }
}

// ─── API helpers ────────────────────────────────────────

async function _api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (_token) {
    headers['Authorization'] = `Bearer ${_token}`;
  }
  const resp = await fetch(`${_workerUrl()}${path}`, {
    ...options,
    headers,
  });
  // Handle silent token rotation from server
  const newToken = resp.headers.get('X-New-Token');
  if (newToken && _token) {
    _token = newToken;
    _save();
  }
  return resp;
}

// ─── Login / Logout ─────────────────────────────────────

/**
 * Log in with username + password.
 * @returns {{ ok: boolean, error?: string }}
 */
async function login(username, password) {
  try {
    const resp = await _api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error || 'Login failed' };
    }
    _token = data.token;
    _user = data.user;
    _expires = data.expires;
    _checked = true;
    _save();
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

/**
 * Log out — invalidate session on server + clear local state.
 */
async function logout() {
  try {
    if (_token) {
      await _api('/auth/logout', { method: 'POST' }).catch(() => {});
    }
  } finally {
    _token = null;
    _user = null;
    _expires = null;
    _checked = true;
    _save();
    localStorage.removeItem('ct_pw_hash');
  }
}

/**
 * Refresh session — check if the cached token is still valid.
 * Called on app init. Falls back to cached data if offline.
 */
async function refreshSession() {
  _restore();
  if (!_token) {
    _checked = true;
    return false;
  }
  try {
    const resp = await _api('/auth/me');
    if (resp.ok) {
      const data = await resp.json();
      _user = data.user;
      // Server uses sliding window — extend local expiry to match (30d)
      _expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      _checked = true;
      _save();
      return true;
    } else {
      // Token invalid — clear
      _token = null;
      _user = null;
      _expires = null;
      _checked = true;
      _save();
      return false;
    }
  } catch (_) {
    // Network error — use cached data (offline mode)
    _checked = true;
    return !!_token;
  }
}

// ─── Register (public self-registration) ───────────────

/**
 * Register a new member account.
 * @returns {{ ok: boolean, error?: string, user?: object }}
 */
async function register(username, password, displayName, email) {
  try {
    const resp = await _api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, email }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error || 'Registration failed' };
    }
    if (data.token) {
      _token = data.token;
      _user = data.user;
      _expires = data.expires;
      _checked = true;
      _save();
    }
    // If server returned 201 but no token (session creation failed),
    // account was still created — user needs to log in manually
    return { ok: true, user: data.user, needsLogin: !data.token, emailSent: !!data.emailSent };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── Setup detection ───────────────────────────────────

/**
 * Check if the system needs first-time setup (no users exist).
 * @returns {Promise<boolean>} true if setup needed
 */
async function checkNeedsSetup() {
  try {
    const resp = await fetch(`${_workerUrl()}/health`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.needsSetup;
  } catch (_) {
    return false;
  }
}

// ─── Setup (first-time owner creation) ──────────────────

async function setupInit(username, password, displayName, email) {
  try {
    const resp = await _api('/setup/init', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, email }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error || 'Setup failed' };
    }
    _token = data.token;
    _user = data.user;
    _expires = data.expires;
    _checked = true;
    _save();
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── Password change ───────────────────────────────────

async function changePassword(currentPassword, newPassword) {
  try {
    const resp = await _api('/users/me/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error || 'Failed' };
    }
    // Session invalidated — need to re-login
    _token = null;
    _user = null;
    _expires = null;
    _save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── User management (owner only) ──────────────────────

async function listAllUsers() {
  const resp = await _api('/users');
  if (!resp.ok) throw new Error('Failed to load users');
  const data = await resp.json();
  return data.users;
}

async function createNewUser(userData) {
  const resp = await _api('/users', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Failed to create user');
  return data.user;
}

async function updateExistingUser(userId, updates) {
  const resp = await _api(`/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Failed to update user');
  return data.user;
}

async function deleteExistingUser(userId) {
  const resp = await _api(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!resp.ok) {
    const data = await resp.json();
    throw new Error(data.error || 'Failed to delete user');
  }
}

// ─── Email ─────────────────────────────────────────────

/**
 * Send an email via the Worker /email/send endpoint.
 * @param {{ to: string[], subject: string, html: string }} payload
 * @returns {{ ok: boolean, error?: string }}
 */
async function sendEmail(payload) {
  try {
    const resp = await _api('/email/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error || 'Email send failed' };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── Email Change ─────────────────────────────────────

async function changeEmail(newEmail, currentPassword) {
  try {
    const resp = await _api('/users/me/email', {
      method: 'PUT',
      body: JSON.stringify({ email: newEmail, password: currentPassword }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Failed' };
    // Update local user state
    if (_user) {
      _user.email = newEmail;
      _user.emailVerified = false;
      _save();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── Forgot / Reset Password ───────────────────────────

async function forgotPassword(email) {
  try {
    const resp = await fetch(`${_workerUrl()}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    // Surface rate limit errors instead of swallowing them
    if (resp.status === 429) {
      return { ok: false, error: data.error || 'Too many requests — try again later' };
    }
    return { ok: true, message: data.message || 'If that email is registered, a reset link has been sent.' };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

async function resetPassword(token, password) {
  try {
    const resp = await fetch(`${_workerUrl()}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Reset failed' };
    return { ok: true, message: data.message };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── Email Verification ───────────────────────────────

async function verifyEmailToken(token) {
  try {
    const resp = await fetch(`${_workerUrl()}/auth/verify-email?token=${encodeURIComponent(token)}`);
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Verification failed' };
    // Only update local state if the verified user matches the logged-in user
    if (_user && data.userId && data.userId === _user.id) {
      _user.emailVerified = true;
      _save();
    } else if (_user && !data.userId) {
      // Server didn't return userId — conservatively update (backward compat)
      _user.emailVerified = true;
      _save();
    }
    return { ok: true, message: data.message };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

async function resendVerification() {
  try {
    const resp = await _api('/auth/resend-verification', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Failed' };
    return { ok: true, message: data.message };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

function isEmailVerified() {
  return _user ? !!_user.emailVerified : false;
}

function isPasswordExpired() {
  return _user ? !!_user.passwordExpired : false;
}

// ─── Session management ─────────────────────────────────

async function listSessions() {
  const resp = await _api('/auth/sessions');
  if (!resp.ok) throw new Error('Failed to load sessions');
  const data = await resp.json();
  return data.sessions;
}

async function revokeSession(sessionId) {
  const resp = await _api(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!resp.ok) {
    const data = await resp.json();
    throw new Error(data.error || 'Failed to revoke session');
  }
}

// ─── Accessors ──────────────────────────────────────────

function getToken() { return _token; }
function getUser() { return _user ? { ..._user } : null; }
function getRole() { return _user ? _user.role : null; }
function isLoggedIn() { return !!_token && !!_user; }
function isChecked() { return _checked; }

// ─── Permission helpers ─────────────────────────────────

function canEditSongs() {
  if (!_user) return false;
  return ['owner', 'admin'].includes(_user.role);
}

function canEditSetlists() {
  if (!_user) return false;
  return ['owner', 'admin'].includes(_user.role);
}

function canEditPractice() {
  // All logged-in users can manage their own practice lists
  return !!_user;
}

function canManageUsers() {
  return _user && _user.role === 'owner';
}

function canViewAuditLog() {
  return _user && ['owner', 'admin'].includes(_user.role);
}

async function changeUsername(newUsername, currentPassword) {
  try {
    const resp = await _api('/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: newUsername, password: currentPassword }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Failed' };
    if (_user) {
      _user.username = newUsername;
      _save();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

async function adminResetPassword(userId, newPassword) {
  try {
    const resp = await _api('/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId, newPassword }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

async function deleteAccount() {
  try {
    const resp = await _api('/users/me', { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error || 'Failed' };
    // Clear all local auth state
    _token = null;
    _user = null;
    try { localStorage.removeItem('ct_session'); } catch (_) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// ─── Public API ─────────────────────────────────────────

export { login, logout, register, refreshSession, checkNeedsSetup, setupInit, changePassword, changeEmail, changeUsername, deleteAccount, adminResetPassword, forgotPassword, resetPassword, verifyEmailToken, resendVerification, isEmailVerified, isPasswordExpired, listAllUsers, createNewUser, updateExistingUser, deleteExistingUser, sendEmail, listSessions, revokeSession, getToken, getUser, getRole, isLoggedIn, isChecked, canEditSongs, canEditSetlists, canEditPractice, canManageUsers, canViewAuditLog };
