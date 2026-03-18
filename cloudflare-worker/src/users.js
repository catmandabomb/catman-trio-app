/**
 * users.js — User management endpoints
 *
 * Handles user CRUD operations and password hashing.
 * All passwords are hashed with PBKDF2 (600k iterations, SHA-256).
 */

const PBKDF2_ITERATIONS = 600000;
const SESSION_TTL_DAYS = 30;     // Sliding window TTL (reduced from 90d for security)
const SESSION_MAX_LIFETIME = 365; // Absolute max session lifetime in days (1 year)

// ─── Password hashing ───────────────────────────────────

function _randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  const salt = _randomHex(16);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const saltBytes = new Uint8Array(salt.match(/.{2}/g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'pbkdf2:' + salt + ':' + hashHex;
}

const LEGACY_ITERATIONS = 100000; // Old iteration count for backward compat

async function verifyPassword(password, stored) {
  if (!stored.startsWith('pbkdf2:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  // Try current iteration count first
  const computed = await hashPassword_withIterations(password, parts[1], PBKDF2_ITERATIONS);
  if (timingSafeEqual(computed, stored)) return true;
  // Fall back to legacy iteration count (100k) for pre-upgrade hashes
  const legacy = await hashPassword_withIterations(password, parts[1], LEGACY_ITERATIONS);
  if (timingSafeEqual(legacy, stored)) return 'needs_rehash';
  return false;
}

async function hashPassword_withIterations(password, saltHex, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'pbkdf2:' + saltHex + ':' + hashHex;
}

// Keep old name for any callers
async function hashPassword_withSalt(password, saltHex) {
  return hashPassword_withIterations(password, saltHex, PBKDF2_ITERATIONS);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  // Always iterate over max length to prevent length leakage
  const len = Math.max(aBuf.length, bBuf.length);
  let result = aBuf.length !== bBuf.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    result |= (aBuf[i] || 0) ^ (bBuf[i] || 0);
  }
  return result === 0;
}

// ─── Session management ─────────────────────────────────

function generateToken() {
  return _randomHex(32); // 64-char hex token
}

async function createSession(db, userId, deviceInfo) {
  const token = generateToken();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, device_info, last_used) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, userId, now, expires, deviceInfo || null, now).run();
  return { token, expires };
}

async function validateSession(db, token) {
  if (!token) return null;
  const row = await db.prepare(
    'SELECT s.*, u.id AS uid, u.username, u.display_name, u.role, u.persona_id, u.is_active, u.email_verified, u.password_changed_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1'
  ).bind(token, new Date().toISOString()).first();
  if (!row) return null;
  // Enforce absolute max session lifetime (1 year from creation)
  const created = new Date(row.created_at).getTime();
  if (Date.now() - created > SESSION_MAX_LIFETIME * 24 * 60 * 60 * 1000) {
    // Session too old — force re-login
    db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run().catch(() => {});
    return null;
  }
  // Sliding window: extend session expiry on each use + update last_used
  const now = new Date().toISOString();
  const newExpires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE sessions SET last_used = ?, expires_at = ? WHERE token = ?')
    .bind(now, newExpires, token).run().catch(() => {});
  return {
    userId: row.uid,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    personaId: row.persona_id,
    emailVerified: !!row.email_verified,
    passwordExpired: isPasswordExpired(row),
  };
}

async function deleteSession(db, token) {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

async function listUserSessions(db, userId) {
  const { results } = await db.prepare(
    'SELECT token, created_at, last_used, device_info, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used DESC'
  ).bind(userId, new Date().toISOString()).all();
  return results.map(row => ({
    id: row.token.substring(0, 8),
    createdAt: row.created_at,
    lastUsed: row.last_used,
    deviceInfo: row.device_info,
    expiresAt: row.expires_at,
  }));
}

async function deleteSessionByPrefix(db, userId, tokenPrefix) {
  if (!tokenPrefix || !/^[0-9a-f]+$/i.test(tokenPrefix)) return 0;
  const result = await db.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND token LIKE ?'
  ).bind(userId, tokenPrefix + '%').run();
  return result.meta?.changes || 0;
}

// Clean up expired sessions (call periodically)
async function cleanExpiredSessions(db) {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?')
    .bind(new Date().toISOString()).run();
}

// ─── User CRUD ──────────────────────────────────────────

async function createUser(db, { username, displayName, email, password, role, personaId }) {
  const id = _randomHex(8); // 16-char hex ID
  const pwHash = await hashPassword(password);
  const now = new Date().toISOString();
  try {
    await db.prepare(
      'INSERT INTO users (id, username, display_name, email, pw_hash, role, persona_id, created_at, updated_at, password_changed_at, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, username.toLowerCase(), displayName || username, email || null, pwHash, role || 'member', personaId || null, now, now, now, 0).run();
    return { id, username: username.toLowerCase(), displayName: displayName || username, role: role || 'member' };
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      throw new Error('Username already exists');
    }
    throw e;
  }
}

async function getUser(db, userId) {
  const row = await db.prepare(
    'SELECT id, username, display_name, email, role, persona_id, created_at, updated_at, is_active, email_verified FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row) return null;
  return {
    id: row.id, username: row.username, displayName: row.display_name,
    email: row.email, role: row.role, personaId: row.persona_id,
    createdAt: row.created_at, updatedAt: row.updated_at, isActive: row.is_active,
    emailVerified: !!row.email_verified,
  };
}

async function listUsers(db) {
  const { results } = await db.prepare(
    'SELECT id, username, display_name, email, role, persona_id, created_at, updated_at, is_active, email_verified FROM users ORDER BY created_at'
  ).all();
  return results.map(row => ({
    id: row.id, username: row.username, displayName: row.display_name,
    email: row.email, role: row.role, personaId: row.persona_id,
    createdAt: row.created_at, updatedAt: row.updated_at, isActive: row.is_active,
    emailVerified: !!row.email_verified,
  }));
}

async function updateUser(db, userId, updates) {
  const allowed = ['display_name', 'email', 'role', 'persona_id', 'is_active'];
  const fieldMap = { displayName: 'display_name', personaId: 'persona_id', isActive: 'is_active' };
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(updates)) {
    const col = fieldMap[key] || key;
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    vals.push(val);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  vals.push(new Date().toISOString());
  vals.push(userId);
  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

async function deleteUser(db, userId) {
  // Cascade: sessions and permissions are deleted by FK constraint
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

async function changePassword(db, userId, newPassword) {
  const pwHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET pw_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?')
    .bind(pwHash, now, now, userId).run();
  // Invalidate all sessions for this user
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

// ─── Password reset tokens ──────────────────────────────

const RESET_TOKEN_TTL_HOURS = 1;

async function createResetToken(db, userId) {
  const token = _randomHex(32);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
  // Invalidate any existing tokens for this user
  await db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(userId).run();
  await db.prepare(
    'INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, userId, now, expires).run();
  return { token, expires };
}

/**
 * Atomically validate AND consume a reset token in one step.
 * This prevents race conditions where two concurrent requests
 * both validate the same token before either consumes it.
 */
async function validateAndConsumeResetToken(db, token) {
  if (!token) return null;
  const now = new Date().toISOString();
  // Atomic: UPDATE used=1 WHERE used=0, then check if a row was affected
  const result = await db.prepare(
    'UPDATE password_reset_tokens SET used = 1 WHERE token = ? AND used = 0 AND expires_at > ?'
  ).bind(token, now).run();
  if (!result.meta?.changes || result.meta.changes === 0) return null;
  // Token was consumed — now look up the user
  const row = await db.prepare(
    'SELECT rt.user_id, u.id AS uid, u.username, u.email FROM password_reset_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.token = ? AND u.is_active = 1'
  ).bind(token).first();
  if (!row) return null;
  return { userId: row.uid, username: row.username, email: row.email };
}

async function cleanExpiredResetTokens(db) {
  await db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ? OR used = 1')
    .bind(new Date().toISOString()).run();
}

// ─── Email verification ─────────────────────────────────

async function createEmailVerifyToken(db, userId) {
  const token = _randomHex(32);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  await db.prepare(
    'UPDATE users SET email_verify_token = ?, email_verify_expires = ?, email_verified = 0 WHERE id = ?'
  ).bind(token, expires, userId).run();
  return token;
}

async function verifyEmail(db, token) {
  if (!token) return null;
  const row = await db.prepare(
    'SELECT id, username, email FROM users WHERE email_verify_token = ? AND email_verify_expires > ? AND email_verified = 0 AND is_active = 1'
  ).bind(token, new Date().toISOString()).first();
  if (!row) return null;
  await db.prepare(
    'UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL, updated_at = ? WHERE id = ?'
  ).bind(new Date().toISOString(), row.id).run();
  return { userId: row.id, username: row.username, email: row.email };
}

// ─── Password expiry check ──────────────────────────────

const PASSWORD_MAX_AGE_DAYS = 365; // 12 months

function isPasswordExpired(user) {
  if (!user.password_changed_at) return true; // Never set = expired
  const changedAt = new Date(user.password_changed_at).getTime();
  const maxAge = PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return (Date.now() - changedAt) > maxAge;
}

async function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
    .bind(username.toLowerCase()).first();
}

async function countUsers(db) {
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM users').first();
  return row ? row.cnt : 0;
}

export {
  hashPassword, verifyPassword, generateToken,
  createSession, validateSession, deleteSession, cleanExpiredSessions,
  listUserSessions, deleteSessionByPrefix,
  createUser, getUser, listUsers, updateUser, deleteUser,
  changePassword, getUserByUsername, countUsers,
  createResetToken, validateAndConsumeResetToken, cleanExpiredResetTokens,
  createEmailVerifyToken, verifyEmail, isPasswordExpired,
};
