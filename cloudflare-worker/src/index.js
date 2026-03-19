/**
 * index.js — Catman API Worker entry point
 *
 * Routes:
 *   OPTIONS /*            — CORS preflight (no auth)
 *   GET     /health       — Health check (no auth)
 *   POST    /auth/login   — Login (public)
 *   POST    /auth/register — Self-registration for new members (public)
 *   POST    /setup/init   — Create first owner account (public, one-time)
 *   POST    /auth/logout  — Invalidate session (session auth)
 *   GET     /auth/me      — Current user info (session auth)
 *   GET     /auth/sessions — List active sessions (session auth)
 *   DELETE  /auth/sessions/:id — Revoke a session (session auth)
 *   GET     /auth/key     — Encryption key seed (session auth)
 *   PUT     /users/me/password — Change own password (session auth)
 *   GET/POST/PUT/DELETE /users/* — User management (owner only)
 *   GET/POST /data/songs       — D1 songs CRUD (auth, write=admin/owner)
 *   GET/POST /data/setlists    — D1 setlists CRUD (auth, write=admin/owner)
 *   GET/POST /data/practice    — D1 practice CRUD (auth, write=any)
 *   POST    /files/upload      — R2 file upload (admin/owner)
 *   GET     /files/:id         — R2 file download (auth)
 *   DELETE  /files/:id         — R2 file delete (admin/owner)
 *   GET     /files?songId=     — List files (auth)
 *   GET/POST /migration/state  — Migration tracking (owner only)
 *   *       /github/*     — GitHub API proxy (session auth)
 *   POST    /email/send   — Send email via Resend (admin/owner only)
 *   POST    /gig/share              — Create/replace shared packet (auth, admin/owner)
 *   DELETE  /gig/share/:setlistId   — Unshare a packet (auth, admin/owner)
 *   GET     /gig/shared             — List active shared packets (auth)
 *   GET     /gig/:token             — Serve public gig packet page (no auth)
 *   POST    /gig/:token/verify-pin  — Verify PIN for downloads (no auth)
 *   GET     /gig/:token/file/:idx   — Download individual file (PIN cookie required)
 *   GET     /gig/:token/zip         — Download zip bundle (PIN cookie required)
 */

import { handlePreflight, withCors } from './cors.js';
// Legacy admin hash auth removed — session-only auth now
import { checkRateLimit } from './rate-limit.js';
import { proxyToGitHub } from './github-proxy.js';
import { handleGetKey } from './crypto.js';
import * as GigPackets from './gig-packets.js';
import * as AppData from './app-data.js';
import {
  verifyPassword, createSession, validateSession, deleteSession, rotateSession,
  cleanExpiredSessions, listUserSessions, deleteSessionByPrefix,
  createUser, getUser, listUsers, updateUser, deleteUser,
  changePassword, rehashPassword, getUserByUsername, countUsers,
  createResetToken, validateAndConsumeResetToken, cleanExpiredResetTokens,
  createEmailVerifyToken, verifyEmail, isPasswordExpired,
} from './users.js';

function _escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function _hashFingerprint(ip, ua) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${ip}:${ua}`));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validatePasswordComplexity(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be 128 characters or less';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^a-zA-Z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

async function parseBody(request) {
  try { return await request.json(); } catch { return null; }
}

/**
 * Track email sends for quota monitoring.
 * Increments daily and monthly KV counters (best-effort).
 */
async function _trackEmailSend(env, count = 1) {
  if (!env.CATMAN_RATE) return;
  try {
    const now = new Date();
    const dayKey = `emails:day:${now.toISOString().slice(0, 10)}`;
    const monthKey = `emails:month:${now.toISOString().slice(0, 7)}`;
    const dayCount = parseInt(await env.CATMAN_RATE.get(dayKey) || '0', 10) + count;
    const monthCount = parseInt(await env.CATMAN_RATE.get(monthKey) || '0', 10) + count;
    await env.CATMAN_RATE.put(dayKey, String(dayCount), { expirationTtl: 86400 * 2 });
    await env.CATMAN_RATE.put(monthKey, String(monthCount), { expirationTtl: 86400 * 35 });
  } catch (_) {}
}

function _safeAppUrl(env) {
  const raw = env.APP_URL || 'https://trio.catmanbeats.com';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'https://trio.catmanbeats.com';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch { return 'https://trio.catmanbeats.com'; }
}

/**
 * Authenticate via session token.
 * Returns { user, authMethod } or null.
 */
async function authenticateRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ') && env.DB) {
    const token = authHeader.slice(7);
    const user = await validateSession(env.DB, token);
    if (user) return { user, authMethod: 'session' };
  }
  return null;
}

export default {
  async fetch(request, env) {
    try {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // Scoped CORS helper — passes env automatically
    const cors = (resp) => withCors(request, resp, env);

    // ─── CORS preflight ──────────────────────────────
    if (method === 'OPTIONS') {
      return handlePreflight(request, env);
    }

    // ─── Health check (no auth) ──────────────────────
    if (path === '/health') {
      let needsSetup = false;
      if (env.DB) {
        try { needsSetup = (await countUsers(env.DB)) === 0; } catch (_) {}
      }
      return cors(json({
        status: 'ok',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        hasDb: !!env.DB,
        needsSetup,
      }));
    }

    // ─── Rate limiting (sensitive endpoints only) ───────
    // Only burn KV ops on login/register/reset/setup to stay within free tier.
    // Authenticated requests are gated by D1 session tokens already.
    const _isSensitivePath = path === '/auth/login' || path === '/auth/register'
      || path === '/auth/forgot-password' || path === '/auth/reset-password'
      || path === '/setup/init';
    if (_isSensitivePath) {
      const rateResult = await checkRateLimit(request, env);
      if (!rateResult.ok) {
        return cors(json({ error: rateResult.error }, 429));
      }
    }

    // ─── PUBLIC: POST /auth/login ────────────────────
    if (path === '/auth/login' && method === 'POST') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.username || !body.password) {
        return cors(json({ error: 'Username and password required' }, 400));
      }
      if (body.username.length > 25 || body.password.length > 128) {
        return cors(json({ error: 'Invalid input length' }, 400));
      }
      // Per-username lockout: block after 10 failed attempts per hour
      if (env.CATMAN_RATE) {
        const lockWindow = Math.floor(Date.now() / 3600000);
        const failKey = `fail:${body.username.toLowerCase()}:${lockWindow}`;
        try {
          const fails = parseInt(await env.CATMAN_RATE.get(failKey) || '0', 10);
          if (fails >= 10) {
            return cors(json({ error: 'Account temporarily locked — too many failed attempts. Try again in an hour.' }, 429));
          }
        } catch (_) {}
      }
      const user = await getUserByUsername(env.DB, body.username);
      if (!user) {
        // Dummy PBKDF2 to equalize timing (prevent username enumeration)
        await verifyPassword(body.password, 'pbkdf2:0000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000');
        // Track failed attempt even for non-existent usernames (prevent enumeration via lockout behavior)
        if (env.CATMAN_RATE) {
          const lockWindow = Math.floor(Date.now() / 3600000);
          const failKey = `fail:${body.username.toLowerCase()}:${lockWindow}`;
          try {
            const fails = parseInt(await env.CATMAN_RATE.get(failKey) || '0', 10) + 1;
            await env.CATMAN_RATE.put(failKey, String(fails), { expirationTtl: 3660 });
          } catch (_) {}
        }
        return cors(json({ error: 'Invalid credentials' }, 401));
      }
      const ok = await verifyPassword(body.password, user.pw_hash);
      // Transparent rehash: if password was hashed with legacy iterations, rehash at current 100k
      if (ok === 'needs_rehash' && env.DB) {
        rehashPassword(env.DB, user.id, body.password).catch(() => {});
      }
      if (!ok) {
        // Track failed attempts per username for lockout alerts
        if (env.CATMAN_RATE) {
          const window = Math.floor(Date.now() / 3600000);
          const failKey = `fail:${body.username.toLowerCase()}:${window}`;
          try {
            const fails = parseInt(await env.CATMAN_RATE.get(failKey) || '0', 10) + 1;
            await env.CATMAN_RATE.put(failKey, String(fails), { expirationTtl: 3660 });
            // Send lockout alert on 5th failed attempt (max 1 per 24h per user)
            if (fails === 5 && user.email && env.RESEND_API_KEY) {
              const lockoutEmailKey = `lockout-email:${user.id}`;
              const alreadySent = await env.CATMAN_RATE.get(lockoutEmailKey);
              if (!alreadySent) {
                await env.CATMAN_RATE.put(lockoutEmailKey, '1', { expirationTtl: 86400 }); // 24h cooldown
                const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
                fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    from: fromAddr, to: [user.email],
                    subject: 'Security Alert: Multiple failed login attempts',
                    html: `<p>Hi ${_escHtml(user.display_name || user.username)},</p>
                      <p>We detected <strong>5 failed login attempts</strong> on your Catman Trio account in the last hour.</p>
                      <p><strong>IP address:</strong> ${_escHtml(ip)}</p>
                      <p><strong>Time:</strong> ${new Date().toISOString()}</p>
                      <p>If this was you, no action is needed. If not, consider changing your password immediately.</p>
                      <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
                  }),
                }).then(() => _trackEmailSend(env)).catch(() => {}); // fire-and-forget
              }
            }
          } catch (_) {}
        }
        return cors(json({ error: 'Invalid credentials' }, 401));
      }
      // Clear failed attempt counter on successful login
      if (env.CATMAN_RATE) {
        const window = Math.floor(Date.now() / 3600000);
        env.CATMAN_RATE.delete(`fail:${body.username.toLowerCase()}:${window}`).catch(() => {});
      }
      const deviceInfo = request.headers.get('User-Agent') || null;
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

      // New device detection — hash IP + User-Agent, check against known devices
      if (env.CATMAN_RATE && user.email && env.RESEND_API_KEY) {
        try {
          const fingerprint = await _hashFingerprint(ip, deviceInfo || '');
          const knownKey = `devices:${user.id}`;
          const knownRaw = await env.CATMAN_RATE.get(knownKey);
          const known = knownRaw ? JSON.parse(knownRaw) : [];
          if (!known.includes(fingerprint)) {
            known.push(fingerprint);
            // Keep only last 20 device fingerprints
            if (known.length > 20) known.shift();
            await env.CATMAN_RATE.put(knownKey, JSON.stringify(known), { expirationTtl: 90 * 86400 }); // 90 days
            // Send alert if this isn't the first login ever (known was not empty)
            if (knownRaw) {
              const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
              fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: fromAddr, to: [user.email],
                  subject: 'New login to your Catman Trio account',
                  html: `<p>Hi ${_escHtml(user.display_name || user.username)},</p>
                    <p>Your Catman Trio account was just signed into from a new device or location.</p>
                    <p><strong>IP:</strong> ${_escHtml(ip)}<br><strong>Device:</strong> ${_escHtml((deviceInfo || 'Unknown').substring(0, 100))}<br><strong>Time:</strong> ${new Date().toISOString()}</p>
                    <p>If this was you, no action needed. Otherwise, change your password immediately.</p>
                    <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
                }),
              }).then(() => _trackEmailSend(env)).catch(() => {}); // fire-and-forget
            }
          }
        } catch (_) { /* non-fatal */ }
      }

      const session = await createSession(env.DB, user.id, deviceInfo);
      // Clean up expired sessions occasionally (1 in 10 logins)
      if (Math.random() < 0.1) cleanExpiredSessions(env.DB).catch(() => {});
      return cors(json({
        token: session.token,
        expires: session.expires,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          personaId: user.persona_id,
          emailVerified: !!user.email_verified,
          passwordExpired: isPasswordExpired(user),
        },
      }));
    }

    // ─── PUBLIC: POST /auth/register (self-registration) ────
    if (path === '/auth/register' && method === 'POST') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.username || !body.password || !body.email) {
        return cors(json({ error: 'Username, password, and email required' }, 400));
      }
      // Input length limits
      if (body.username.length > 25 || body.password.length > 128 || body.email.length > 200) {
        return cors(json({ error: 'Invalid input length' }, 400));
      }
      if (body.displayName && body.displayName.length > 100) {
        return cors(json({ error: 'Invalid input length' }, 400));
      }
      // Trim username (like email is trimmed)
      body.username = body.username.trim();
      // Username format: 2-25 chars, alphanumeric + underscores only
      if (body.username.length < 2) {
        return cors(json({ error: 'Username must be at least 2 characters' }, 400));
      }
      if (!/^[a-zA-Z0-9_]+$/.test(body.username)) {
        return cors(json({ error: 'Username may only contain letters, numbers, and underscores' }, 400));
      }
      // Password complexity
      const regPwErr = validatePasswordComplexity(body.password);
      if (regPwErr) {
        return cors(json({ error: regPwErr }, 400));
      }
      // Email format validation
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return cors(json({ error: 'Invalid email format' }, 400));
      }
      // Reject placeholder emails
      if (email.endsWith('@placeholder.local')) {
        return cors(json({ error: 'A valid email address is required' }, 400));
      }
      // Check username uniqueness
      const existingUser = await getUserByUsername(env.DB, body.username);
      if (existingUser) {
        return cors(json({ error: 'Username already taken' }, 409));
      }
      // Check email uniqueness
      const emailExists = await env.DB.prepare(
        'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1'
      ).bind(email).first();
      if (emailExists) {
        return cors(json({ error: 'Email already in use' }, 409));
      }
      // Create user with member role
      const displayName = (body.displayName || body.username).trim();
      let user;
      try {
        user = await createUser(env.DB, {
          username: body.username,
          displayName,
          email: email,
          password: body.password,
          role: 'member',
        });
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('UNIQUE') || msg.includes('already exists')) {
          return cors(json({ error: 'Username or email already in use' }, 409));
        }
        return cors(json({ error: 'Registration failed' }, 400));
      }
      // Send verification email
      let emailSent = false;
      if (env.RESEND_API_KEY) {
        try {
          const verifyToken = await createEmailVerifyToken(env.DB, user.id);
          const appUrl = _safeAppUrl(env);
          const verifyLink = `${appUrl}#verify-email?token=${verifyToken}`;
          const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
          const emailResp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromAddr,
              to: [email],
              subject: 'Verify your Catman Trio email',
              html: `<p>Hi ${_escHtml(displayName)},</p>
                <p>Welcome to Catman Trio! Click below to verify your email:</p>
                <p><a href="${verifyLink}" style="display:inline-block;padding:10px 24px;background:#d4b478;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">Verify Email</a></p>
                <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
            }),
          });
          emailSent = emailResp.ok;
          if (emailSent) _trackEmailSend(env);
          if (!emailResp.ok) {
            console.error('Resend error on register:', await emailResp.text().catch(() => 'unknown'));
          }
        } catch (e) {
          console.error('Email send failed on register:', e.message || e);
        }
      }
      // Create session
      const deviceInfo = request.headers.get('User-Agent') || null;
      let session;
      try {
        session = await createSession(env.DB, user.id, deviceInfo);
      } catch (_) {
        // User created but session failed — they can log in manually
        return cors(json({
          ok: true,
          message: 'Account created — please log in',
          user: { id: user.id, username: user.username, displayName: displayName, role: 'member' },
        }, 201));
      }
      return cors(json({
        token: session.token,
        expires: session.expires,
        user: {
          id: user.id,
          username: user.username,
          displayName: displayName,
          role: 'member',
          personaId: null,
          emailVerified: false,
          passwordExpired: false,
        },
        emailSent,
      }, 201));
    }

    // ─── PUBLIC: POST /setup/init (one-time owner creation) ──
    if (path === '/setup/init' && method === 'POST') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      const existing = await countUsers(env.DB);
      if (existing > 0) {
        return cors(json({ error: 'Setup already completed — users exist' }, 409));
      }
      const body = await parseBody(request);
      if (!body || !body.username || !body.password) {
        return cors(json({ error: 'Username and password required' }, 400));
      }
      if (body.username.length > 25 || (body.displayName && body.displayName.length > 100) || (body.email && body.email.length > 200)) {
        return cors(json({ error: 'Invalid input length' }, 400));
      }
      const setupPwErr = validatePasswordComplexity(body.password);
      if (setupPwErr) {
        return cors(json({ error: setupPwErr }, 400));
      }
      let user;
      try {
        user = await createUser(env.DB, {
          username: body.username,
          displayName: body.displayName || body.username,
          email: body.email || null,
          password: body.password,
          role: 'owner',
        });
      } catch (e) {
        // Race condition: another request may have created a user first
        const recheck = await countUsers(env.DB);
        if (recheck > 0) {
          return cors(json({ error: 'Setup already completed — users exist' }, 409));
        }
        return cors(json({ error: 'Setup failed' }, 500));
      }
      // Auto-verify owner email
      try {
        await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(user.id).run();
      } catch (_) {}
      const deviceInfo = request.headers.get('User-Agent') || null;
      let session;
      try {
        session = await createSession(env.DB, user.id, deviceInfo);
      } catch (_) {
        user.emailVerified = true;
        return cors(json({ ok: true, message: 'Account created — please log in', user }, 201));
      }
      user.emailVerified = true;
      return cors(json({ token: session.token, expires: session.expires, user }, 201));
    }

    // ─── PUBLIC: POST /auth/forgot-password ────────────
    if (path === '/auth/forgot-password' && method === 'POST') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.email) {
        return cors(json({ error: 'Email is required' }, 400));
      }
      // Always return success to prevent email enumeration
      // Direct query instead of fetching all users (O(1) vs O(n))
      const userRow = await env.DB.prepare(
        'SELECT id, username, display_name, email FROM users WHERE LOWER(email) = ? AND is_active = 1 LIMIT 1'
      ).bind(body.email.toLowerCase()).first();
      const user = userRow ? { id: userRow.id, username: userRow.username, displayName: userRow.display_name, email: userRow.email } : null;
      if (user && env.RESEND_API_KEY) {
        try {
          const reset = await createResetToken(env.DB, user.id);
          const appUrl = _safeAppUrl(env);
          const resetLink = `${appUrl}#reset-password?token=${reset.token}`;
          const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromAddr,
              to: [user.email],
              subject: 'Reset your Catman Trio password',
              html: `<p>Hi ${_escHtml(user.displayName || user.username)},</p>
                <p>Click the link below to reset your password. This link expires in 1 hour.</p>
                <p><a href="${resetLink}" style="display:inline-block;padding:10px 24px;background:#d4b478;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">Reset Password</a></p>
                <p>If you didn't request this, you can ignore this email.</p>
                <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
            }),
          });
          _trackEmailSend(env);
        } catch (_) { /* silently fail — don't leak info */ }
        // Clean up old tokens occasionally
        if (Math.random() < 0.2) cleanExpiredResetTokens(env.DB).catch(() => {});
      }
      return cors(json({ ok: true, message: 'If that email is registered, a reset link has been sent.' }));
    }

    // ─── PUBLIC: POST /auth/reset-password ─────────────
    if (path === '/auth/reset-password' && method === 'POST') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.token || !body.password) {
        return cors(json({ error: 'Token and new password required' }, 400));
      }
      const resetPwErr = validatePasswordComplexity(body.password);
      if (resetPwErr) {
        return cors(json({ error: resetPwErr }, 400));
      }
      const tokenData = await validateAndConsumeResetToken(env.DB, body.token);
      if (!tokenData) {
        return cors(json({ error: 'Invalid or expired reset link' }, 400));
      }
      await changePassword(env.DB, tokenData.userId, body.password);
      return cors(json({ ok: true, message: 'Password reset — please log in' }));
    }

    // ─── PUBLIC: GET /auth/verify-email?token=... ──────
    if (path === '/auth/verify-email' && method === 'GET') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      const token = url.searchParams.get('token');
      if (!token) {
        return cors(json({ error: 'Token required' }, 400));
      }
      const result = await verifyEmail(env.DB, token);
      if (!result) {
        return cors(json({ error: 'Invalid or expired verification link' }, 400));
      }
      return cors(json({ ok: true, message: 'Email verified!', username: result.username }));
    }

    // ─── PUBLIC: POST /auth/resend-verification ────────
    if (path === '/auth/resend-verification' && method === 'POST') {
      if (!env.DB) return cors(json({ error: 'Database not configured' }, 500));
      // Per-user rate limit: max 3 verification emails per hour
      if (env.CATMAN_RATE) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const window = Math.floor(Date.now() / 3600000);
        const verifyKey = `verify:${ip}:${window}`;
        try {
          const current = parseInt(await env.CATMAN_RATE.get(verifyKey) || '0', 10);
          if (current >= 3) {
            return cors(json({ error: 'Too many verification requests — try again later' }, 429));
          }
          await env.CATMAN_RATE.put(verifyKey, String(current + 1), { expirationTtl: 3660 });
        } catch (_) {}
      }
      // Requires session auth
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return cors(json({ error: 'Authentication required' }, 401));
      }
      const token = authHeader.slice(7);
      const sessionUser = await validateSession(env.DB, token);
      if (!sessionUser) {
        return cors(json({ error: 'Authentication required' }, 401));
      }
      if (sessionUser.emailVerified) {
        return cors(json({ ok: true, message: 'Email already verified' }));
      }
      // Get user email
      const dbUser = await getUserByUsername(env.DB, sessionUser.username);
      if (!dbUser || !dbUser.email || dbUser.email.endsWith('@placeholder.local')) {
        return cors(json({ error: 'No valid email on file' }, 400));
      }
      if (env.RESEND_API_KEY) {
        try {
          const verifyToken = await createEmailVerifyToken(env.DB, sessionUser.userId);
          const appUrl = _safeAppUrl(env);
          const verifyLink = `${appUrl}#verify-email?token=${verifyToken}`;
          const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
          const emailResp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromAddr,
              to: [dbUser.email],
              subject: 'Verify your Catman Trio email',
              html: `<p>Hi ${_escHtml(sessionUser.displayName || sessionUser.username)},</p>
                <p>Click the link below to verify your email. This link expires in 24 hours.</p>
                <p><a href="${verifyLink}" style="display:inline-block;padding:10px 24px;background:#d4b478;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">Verify Email</a></p>
                <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
            }),
          });
          if (emailResp.ok) _trackEmailSend(env);
          if (!emailResp.ok) {
            console.error('Resend error on resend-verification:', await emailResp.text().catch(() => 'unknown'));
            return cors(json({ ok: false, error: 'Email service error — try again later' }, 502));
          }
        } catch (e) {
          console.error('Email send failed on resend-verification:', e.message || e);
          return cors(json({ ok: false, error: 'Email service error — try again later' }, 502));
        }
      } else {
        return cors(json({ ok: false, error: 'Email service not configured' }, 500));
      }
      return cors(json({ ok: true, message: 'Verification email sent' }));
    }

    // ─── Public gig packet routes (no auth required) ─────
    // GET /gig/:token — serve the public packet page
    const gigTokenMatch = path.match(/^\/gig\/([a-f0-9]{32})$/);
    if (gigTokenMatch && method === 'GET') {
      return GigPackets.handleServePage(env, gigTokenMatch[1]);
    }

    // POST /gig/:token/verify-pin — verify PIN for download access
    const gigPinMatch = path.match(/^\/gig\/([a-f0-9]{32})\/verify-pin$/);
    if (gigPinMatch && method === 'POST') {
      const resp = await GigPackets.handleVerifyPin(request, env, gigPinMatch[1]);
      return resp;
    }

    // GET /gig/:token/file/:idx — download individual file (PIN cookie required)
    const gigFileMatch = path.match(/^\/gig\/([a-f0-9]{32})\/file\/(\d+)$/);
    if (gigFileMatch && method === 'GET') {
      return GigPackets.handleFileDownload(request, env, gigFileMatch[1], parseInt(gigFileMatch[2], 10));
    }

    // GET /gig/:token/zip — download zip bundle (PIN cookie required)
    const gigZipMatch = path.match(/^\/gig\/([a-f0-9]{32})\/zip$/);
    if (gigZipMatch && method === 'GET') {
      return GigPackets.handleZipDownload(request, env, gigZipMatch[1]);
    }

    // ─── All other routes require authentication ─────
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return cors(json({ error: 'Authentication required' }, 401));
    }
    const { user: currentUser, authMethod } = authResult;

    // ─── Session token rotation (>24h since last used) ─────
    let _rotatedToken = null;
    if (authMethod === 'session' && currentUser.lastUsed && env.DB) {
      const lastUsedMs = new Date(currentUser.lastUsed).getTime();
      if (Date.now() - lastUsedMs > 24 * 60 * 60 * 1000) {
        try {
          const oldToken = (request.headers.get('Authorization') || '').slice(7);
          _rotatedToken = await rotateSession(env.DB, oldToken);
        } catch (_) { /* rotation failure is non-fatal */ }
      }
    }
    // Helper: wrap response with rotated token header + CORS
    function respond(resp) {
      const corsResp = cors(resp);
      if (_rotatedToken) {
        const newHeaders = new Headers(corsResp.headers);
        newHeaders.set('X-New-Token', _rotatedToken);
        newHeaders.set('Access-Control-Expose-Headers', 'X-New-Token');
        return new Response(corsResp.body, {
          status: corsResp.status,
          statusText: corsResp.statusText,
          headers: newHeaders,
        });
      }
      return corsResp;
    }

    // ─── POST /auth/logout ───────────────────────────
    if (path === '/auth/logout' && method === 'POST') {
      if (authMethod === 'session') {
        const token = _rotatedToken || (request.headers.get('Authorization') || '').slice(7);
        await deleteSession(env.DB, token);
      }
      return respond(json({ ok: true }));
    }

    // ─── GET /auth/me ────────────────────────────────
    if (path === '/auth/me' && method === 'GET') {
      return respond(json({ user: {
        id: currentUser.userId,
        username: currentUser.username,
        displayName: currentUser.displayName,
        role: currentUser.role,
        personaId: currentUser.personaId,
        emailVerified: !!currentUser.emailVerified,
        passwordExpired: !!currentUser.passwordExpired,
      } }));
    }

    // ─── GET /auth/sessions — list active sessions ──
    if (path === '/auth/sessions' && method === 'GET') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      const currentToken = _rotatedToken || (request.headers.get('Authorization') || '').slice(7);
      const currentPrefix = currentToken.substring(0, 8);
      const sessions = await listUserSessions(env.DB, currentUser.userId);
      // Mark which session is the current one
      const sessionsWithCurrent = sessions.map(s => ({
        ...s,
        isCurrent: s.id === currentPrefix,
      }));
      return respond(json({ sessions: sessionsWithCurrent }));
    }

    // ─── DELETE /auth/sessions/:id — revoke a session ──
    const sessionIdMatch = path.match(/^\/auth\/sessions\/([a-f0-9]{8})$/);
    if (sessionIdMatch && method === 'DELETE') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      const tokenPrefix = sessionIdMatch[1];
      const currentToken = _rotatedToken || (request.headers.get('Authorization') || '').slice(7);
      if (currentToken.startsWith(tokenPrefix)) {
        return respond(json({ error: 'Cannot revoke current session — use logout instead' }, 400));
      }
      const deleted = await deleteSessionByPrefix(env.DB, currentUser.userId, tokenPrefix);
      if (deleted === 0) {
        return respond(json({ error: 'Session not found' }, 404));
      }
      return respond(json({ ok: true }));
    }

    // ─── GET /auth/key — encryption key seed (owner/admin only) ─────────
    if (path === '/auth/key' && method === 'GET') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      return respond(handleGetKey(env));
    }

    // ─── PUT /users/me/password ──────────────────────
    if (path === '/users/me/password' && method === 'PUT') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      const body = await parseBody(request);
      if (!body || !body.currentPassword || !body.newPassword) {
        return respond(json({ error: 'Current and new password required' }, 400));
      }
      const changePwErr = validatePasswordComplexity(body.newPassword);
      if (changePwErr) {
        return respond(json({ error: changePwErr }, 400));
      }
      // Verify current password
      const dbUser = await getUserByUsername(env.DB, currentUser.username);
      if (!dbUser) return respond(json({ error: 'User not found' }, 404));
      const ok = await verifyPassword(body.currentPassword, dbUser.pw_hash);
      if (!ok) return respond(json({ error: 'Current password is incorrect' }, 403));
      await changePassword(env.DB, currentUser.userId, body.newPassword);
      return respond(json({ ok: true, message: 'Password changed — please log in again' }));
    }

    // ─── PUT /users/me/email ───────────────────────────
    if (path === '/users/me/email' && method === 'PUT') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      const body = await parseBody(request);
      if (!body || !body.email || !body.password) {
        return respond(json({ error: 'Email and current password required' }, 400));
      }
      // Re-verify password before allowing email change
      const emailChangeUser = await getUserByUsername(env.DB, currentUser.username);
      if (!emailChangeUser) return respond(json({ error: 'User not found' }, 404));
      const pwOk = await verifyPassword(body.password, emailChangeUser.pw_hash);
      if (!pwOk) return respond(json({ error: 'Current password is incorrect' }, 403));
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return respond(json({ error: 'Invalid email format' }, 400));
      }
      // Check email uniqueness
      const emailTaken = await env.DB.prepare(
        'SELECT id FROM users WHERE LOWER(email) = ? AND id != ? LIMIT 1'
      ).bind(email, currentUser.userId).first();
      if (emailTaken) {
        return respond(json({ error: 'Email already in use' }, 409));
      }
      // Update email and reset verification
      await env.DB.prepare(
        'UPDATE users SET email = ?, email_verified = 0, email_verify_token = NULL, email_verify_expires = NULL, updated_at = ? WHERE id = ?'
      ).bind(email, new Date().toISOString(), currentUser.userId).run();
      // Send verification email to new address
      if (env.RESEND_API_KEY) {
        try {
          const verifyToken = await createEmailVerifyToken(env.DB, currentUser.userId);
          const appUrl = _safeAppUrl(env);
          const verifyLink = `${appUrl}#verify-email?token=${verifyToken}`;
          const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: fromAddr, to: [email],
              subject: 'Verify your new Catman Trio email',
              html: `<p>Hi ${_escHtml(currentUser.displayName || currentUser.username)},</p>
                <p>Your email was updated. Click below to verify this new address:</p>
                <p><a href="${verifyLink}" style="display:inline-block;padding:10px 24px;background:#d4b478;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">Verify Email</a></p>
                <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
            }),
          });
          _trackEmailSend(env);
        } catch (_) {}
      }
      return respond(json({ ok: true, message: 'Email updated — check your inbox to verify' }));
    }

    // ─── PUT /users/me/username ─────────────────────────
    if (path === '/users/me/username' && method === 'PUT') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      const body = await parseBody(request);
      if (!body || !body.username || !body.password) {
        return respond(json({ error: 'Username and current password required' }, 400));
      }
      const newUsername = body.username.trim();
      if (!newUsername || newUsername.length > 25) {
        return respond(json({ error: 'Username must be 1-25 characters' }, 400));
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
        return respond(json({ error: 'Username can only contain letters, numbers, hyphens, and underscores' }, 400));
      }
      const dbUser = await getUserByUsername(env.DB, currentUser.username);
      if (!dbUser) return respond(json({ error: 'User not found' }, 404));
      const pwOk = await verifyPassword(body.password, dbUser.pw_hash);
      if (!pwOk) return respond(json({ error: 'Current password is incorrect' }, 403));
      // Check uniqueness
      const taken = await env.DB.prepare(
        'SELECT id FROM users WHERE LOWER(username) = ? AND id != ? LIMIT 1'
      ).bind(newUsername.toLowerCase(), currentUser.userId).first();
      if (taken) return respond(json({ error: 'Username already taken' }, 409));
      await env.DB.prepare(
        'UPDATE users SET username = ?, updated_at = ? WHERE id = ?'
      ).bind(newUsername, new Date().toISOString(), currentUser.userId).run();
      return respond(json({ ok: true, message: 'Username updated' }));
    }

    // ─── DELETE /users/me — Self-delete account (non-owner only) ──
    if (path === '/users/me' && method === 'DELETE') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      if (currentUser.role === 'owner') {
        return respond(json({ error: 'Owner account cannot be deleted' }, 403));
      }
      // Delete all sessions for this user
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(currentUser.userId).run();
      // Delete the user record
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(currentUser.userId).run();
      return respond(json({ ok: true, message: 'Account deleted' }));
    }

    // ─── POST /users/reset-password — Admin resets a user's password ──
    if (path === '/users/reset-password' && method === 'POST') {
      if (authMethod !== 'session' || !env.DB) {
        return respond(json({ error: 'Session auth required' }, 400));
      }
      if (currentUser.role !== 'owner') {
        return respond(json({ error: 'Owner access required' }, 403));
      }
      const body = await parseBody(request);
      if (!body || !body.userId || !body.newPassword) {
        return respond(json({ error: 'userId and newPassword required' }, 400));
      }
      const pwErr = validatePasswordComplexity(body.newPassword);
      if (pwErr) return respond(json({ error: pwErr }, 400));
      await changePassword(env.DB, body.userId, body.newPassword);
      // Invalidate all sessions for that user (force re-login)
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(body.userId).run();
      return respond(json({ ok: true, message: 'Password reset — user must log in again' }));
    }

    // ─── /users/* — User management (owner only, session auth required) ─────
    if (path.startsWith('/users')) {
      if (currentUser.role !== 'owner') {
        return respond(json({ error: 'Owner access required' }, 403));
      }
      if (!env.DB) return respond(json({ error: 'Database not configured' }, 500));

      // GET /users — list all
      if (path === '/users' && method === 'GET') {
        const users = await listUsers(env.DB);
        return respond(json({ users }));
      }

      // POST /users — create user
      if (path === '/users' && method === 'POST') {
        const body = await parseBody(request);
        if (!body || !body.username || !body.password || !body.email) {
          return respond(json({ error: 'Username, password, and email required' }, 400));
        }
        if (body.username.length > 25 || body.email.length > 200 || (body.displayName && body.displayName.length > 100)) {
          return respond(json({ error: 'Invalid input length' }, 400));
        }
        const createPwErr = validatePasswordComplexity(body.password);
        if (createPwErr) {
          return respond(json({ error: createPwErr }, 400));
        }
        // Don't allow creating another owner
        if (body.role === 'owner') {
          return respond(json({ error: 'Cannot create another owner' }, 400));
        }
        // Check email uniqueness
        if (body.email && !body.email.endsWith('@placeholder.local')) {
          const emailExists = await env.DB.prepare(
            'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1'
          ).bind(body.email.trim().toLowerCase()).first();
          if (emailExists) {
            return respond(json({ error: 'Email already in use' }, 409));
          }
        }
        try {
          const user = await createUser(env.DB, body);
          // Send verification email if real email provided
          if (body.email && !body.email.endsWith('@placeholder.local') && env.RESEND_API_KEY) {
            try {
              const verifyToken = await createEmailVerifyToken(env.DB, user.id);
              const appUrl = _safeAppUrl(env);
              const verifyLink = `${appUrl}#verify-email?token=${verifyToken}`;
              const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: fromAddr,
                  to: [body.email],
                  subject: 'Verify your Catman Trio email',
                  html: `<p>Hi ${_escHtml(body.displayName || body.username)},</p>
                    <p>Your Catman Trio account has been created. Click below to verify your email:</p>
                    <p><a href="${verifyLink}" style="display:inline-block;padding:10px 24px;background:#d4b478;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">Verify Email</a></p>
                    <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
                }),
              });
              _trackEmailSend(env);
            } catch (_) { /* email send failure is non-fatal */ }
          }
          return respond(json({ user }, 201));
        } catch (e) {
          const safeMsg = e.message?.includes('already exists') ? 'Username already exists' : 'User creation failed';
          return respond(json({ error: safeMsg }, 400));
        }
      }

      // GET/PUT/DELETE /users/:id
      const userIdMatch = path.match(/^\/users\/([a-f0-9]{16})$/);
      if (userIdMatch) {
        const userId = userIdMatch[1];

        if (method === 'GET') {
          const user = await getUser(env.DB, userId);
          if (!user) return respond(json({ error: 'User not found' }, 404));
          return respond(json({ user }));
        }

        if (method === 'PUT') {
          const body = await parseBody(request);
          if (!body) return respond(json({ error: 'Body required' }, 400));
          // Prevent changing own role away from owner
          if (userId === currentUser.userId && body.role && body.role !== 'owner') {
            return respond(json({ error: 'Cannot demote yourself from owner' }, 400));
          }
          // Prevent promoting anyone to owner via PUT
          if (body.role === 'owner' && userId !== currentUser.userId) {
            return respond(json({ error: 'Cannot promote to owner' }, 400));
          }
          // Handle password reset by owner
          if (body.password) {
            const resetPwErr = validatePasswordComplexity(body.password);
            if (resetPwErr) {
              return respond(json({ error: resetPwErr }, 400));
            }
            await changePassword(env.DB, userId, body.password);
          }
          // If email changed, reset verification and send new verification email
          if (body.email) {
            const oldUser = await getUser(env.DB, userId);
            if (oldUser && oldUser.email !== body.email) {
              await env.DB.prepare(
                'UPDATE users SET email_verified = 0, email_verify_token = NULL, email_verify_expires = NULL WHERE id = ?'
              ).bind(userId).run();
              if (body.email && !body.email.endsWith('@placeholder.local') && env.RESEND_API_KEY) {
                try {
                  const verifyToken = await createEmailVerifyToken(env.DB, userId);
                  const appUrl = _safeAppUrl(env);
                  const verifyLink = `${appUrl}#verify-email?token=${verifyToken}`;
                  const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
                  fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      from: fromAddr, to: [body.email],
                      subject: 'Verify your Catman Trio email',
                      html: `<p>Your email was updated by an admin. Click below to verify:</p>
                        <p><a href="${verifyLink}" style="display:inline-block;padding:10px 24px;background:#d4b478;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;">Verify Email</a></p>
                        <p style="color:#888;font-size:12px;">Catman Trio App</p>`,
                    }),
                  }).then(() => _trackEmailSend(env)).catch(() => {});
                } catch (_) {}
              }
            }
          }
          await updateUser(env.DB, userId, body);
          const user = await getUser(env.DB, userId);
          return respond(json({ user }));
        }

        if (method === 'DELETE') {
          // Can't delete yourself
          if (userId === currentUser.userId) {
            return respond(json({ error: 'Cannot delete yourself' }, 400));
          }
          await deleteUser(env.DB, userId);
          return respond(json({ ok: true }));
        }
      }
    }

    // ─── /data/* — D1-backed app data (replaces GitHub) ─────

    // GET /data/songs — list all songs
    if (path === '/data/songs' && method === 'GET') {
      return respond(await AppData.listSongs(env));
    }
    // POST /data/songs — save songs (upsert + deletions)
    if (path === '/data/songs' && method === 'POST') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      return respond(await AppData.saveSongs(request, env));
    }

    // GET /data/setlists — list all setlists
    if (path === '/data/setlists' && method === 'GET') {
      return respond(await AppData.listSetlists(env));
    }
    // POST /data/setlists — save setlists
    if (path === '/data/setlists' && method === 'POST') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      return respond(await AppData.saveSetlists(request, env));
    }

    // GET /data/practice — list practice lists
    if (path === '/data/practice' && method === 'GET') {
      return respond(await AppData.listPractice(env));
    }
    // POST /data/practice — save practice lists (any authenticated user, owns their lists)
    if (path === '/data/practice' && method === 'POST') {
      return respond(await AppData.savePractice(request, env, currentUser));
    }

    // ─── /files/* — R2-backed file storage (replaces Drive) ─────

    // POST /files/upload — upload a file to R2
    if (path === '/files/upload' && method === 'POST') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      return respond(await AppData.uploadFile(request, env, currentUser));
    }
    // GET /files/:id — download a file from R2
    const fileDownloadMatch = path.match(/^\/files\/([a-f0-9]{16})$/);
    if (fileDownloadMatch && method === 'GET') {
      return respond(await AppData.downloadFile(env, fileDownloadMatch[1]));
    }
    // DELETE /files/:id — delete a file from R2
    if (fileDownloadMatch && method === 'DELETE') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      return respond(await AppData.deleteFile(env, fileDownloadMatch[1]));
    }
    // GET /files?songId=xxx — list files for a song
    if (path === '/files' && method === 'GET') {
      const songId = new URL(request.url).searchParams.get('songId') || '';
      return respond(await AppData.listFiles(env, songId));
    }

    // ─── /migration/* — migration state (owner only) ─────

    // GET /migration/state
    if (path === '/migration/state' && method === 'GET') {
      if (currentUser.role !== 'owner') return respond(json({ error: 'Owner only' }, 403));
      return respond(await AppData.getMigrationState(env));
    }
    // POST /migration/state
    if (path === '/migration/state' && method === 'POST') {
      if (currentUser.role !== 'owner') return respond(json({ error: 'Owner only' }, 403));
      return respond(await AppData.setMigrationState(request, env));
    }

    // ─── /github/* — GitHub API proxy ────────────────
    if (path.startsWith('/github/') || path === '/github') {
      // Check write permission for non-GET requests
      if (method !== 'GET' && !['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Write access requires admin or owner role' }, 403));
      }
      const resp = await proxyToGitHub(request, env);
      return respond(resp);
    }

    // ─── Gig packet sharing (authenticated routes) ─────

    // POST /gig/share — create or replace a shared packet
    if (path === '/gig/share' && method === 'POST') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      const result = await GigPackets.handleShare(request, env, currentUser);
      return respond(result);
    }

    // DELETE /gig/share/:setlistId — unshare a packet
    const unshareMatch = path.match(/^\/gig\/share\/(.+)$/);
    if (unshareMatch && method === 'DELETE') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return respond(json({ error: 'Admin access required' }, 403));
      }
      const result = await GigPackets.handleUnshare(env, decodeURIComponent(unshareMatch[1]));
      return respond(result);
    }

    // GET /gig/shared — list all active shared packets
    if (path === '/gig/shared' && method === 'GET') {
      const result = await GigPackets.handleListShared(env);
      return respond(result);
    }

    // ─── POST /email/send — Send email via Resend (any authenticated user) ──
    if (path === '/email/send' && method === 'POST') {
      if (!env.RESEND_API_KEY) {
        return respond(json({ error: 'Email service not configured' }, 500));
      }
      // Per-user email rate limiting: 10 sends per hour
      if (env.CATMAN_RATE && currentUser.userId) {
        const emailWindow = Math.floor(Date.now() / 3600000);
        const emailKey = `email:${currentUser.userId}:${emailWindow}`;
        try {
          const sent = parseInt(await env.CATMAN_RATE.get(emailKey) || '0', 10);
          if (sent >= 10) {
            return respond(json({ error: 'Email rate limit reached — max 10 per hour' }, 429));
          }
          await env.CATMAN_RATE.put(emailKey, String(sent + 1), { expirationTtl: 3600 });
        } catch (_) {}
      }
      const body = await parseBody(request);
      if (!body || !body.to || !body.subject || !body.html) {
        return respond(json({ error: 'to, subject, and html are required' }, 400));
      }
      // Subject length limit
      if (typeof body.subject !== 'string' || body.subject.length > 200) {
        return respond(json({ error: 'Subject must be 200 characters or less' }, 400));
      }
      // HTML body size limit (100KB) and strip dangerous tags
      if (typeof body.html !== 'string' || body.html.length > 102400) {
        return respond(json({ error: 'Email body too large' }, 400));
      }
      const sanitizedHtml = body.html
        .replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[\s>][\s\S]*?<\/iframe>/gi, '')
        .replace(/<object[\s>][\s\S]*?<\/object>/gi, '')
        .replace(/<embed[\s>][\s\S]*?>/gi, '')
        .replace(/\bon\w+\s*=/gi, 'data-removed=');
      const recipients = Array.isArray(body.to) ? body.to : [body.to];
      if (recipients.length === 0 || recipients.length > 10) {
        return respond(json({ error: 'Must have 1-10 recipients' }, 400));
      }
      // Basic email format validation
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalid = recipients.filter(r => !emailRe.test(r));
      if (invalid.length > 0) {
        return respond(json({ error: 'Invalid email address: ' + invalid[0] }, 400));
      }
      try {
        const fromAddr = env.EMAIL_FROM_PERSONAL || env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
        // Always send TO cat@catmanbeats.com (owner copy), BCC all entered recipients
        const emailPayload = {
          from: fromAddr,
          to: ['cat@catmanbeats.com'],
          bcc: recipients,
          subject: body.subject,
          html: sanitizedHtml,
        };
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return respond(json({ error: data.message || 'Email send failed' }, resp.status));
        }
        _trackEmailSend(env, recipients.length);
        return respond(json({ ok: true, id: data.id, sent: recipients.length }));
      } catch (_) {
        return respond(json({ error: 'Email send failed' }, 500));
      }
    }

    // ─── GET /admin/quotas — Service quota usage (owner only) ──
    if (path === '/admin/quotas' && method === 'GET') {
      if (currentUser.role !== 'owner') {
        return respond(json({ error: 'Owner access required' }, 403));
      }
      const quotas = {};
      // Resend email quotas
      if (env.CATMAN_RATE) {
        try {
          const now = new Date();
          const dayKey = `emails:day:${now.toISOString().slice(0, 10)}`;
          const monthKey = `emails:month:${now.toISOString().slice(0, 7)}`;
          const dailySent = parseInt(await env.CATMAN_RATE.get(dayKey) || '0', 10);
          const monthlySent = parseInt(await env.CATMAN_RATE.get(monthKey) || '0', 10);
          quotas.resend = {
            daily: { used: dailySent, limit: 100, pct: Math.round(dailySent / 100 * 100) },
            monthly: { used: monthlySent, limit: 3000, pct: Math.round(monthlySent / 3000 * 100) },
          };
        } catch (_) {
          quotas.resend = { daily: { used: 0, limit: 100, pct: 0 }, monthly: { used: 0, limit: 3000, pct: 0 } };
        }
      }
      // D1 table sizes + active sessions
      if (env.DB) {
        try {
          const userCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();
          const sessionCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sessions').first();
          const nowISO = new Date().toISOString();
          let activeSessionCount = { cnt: 0 };
          try { activeSessionCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE expires_at > ?').bind(nowISO).first(); } catch (_) {}
          let errorCount = { cnt: 0 };
          try { errorCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM error_log').first(); } catch (_) {}
          quotas.d1 = {
            users: userCount?.cnt || 0,
            sessions: sessionCount?.cnt || 0,
            activeSessions: activeSessionCount?.cnt || 0,
            errorLog: errorCount?.cnt || 0,
          };
        } catch (_) {
          quotas.d1 = { users: 0, sessions: 0, activeSessions: 0, errorLog: 0 };
        }
      }
      // R2 file stats (from D1 files table)
      if (env.DB) {
        try {
          const fileStats = await env.DB.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as totalBytes FROM files').first();
          quotas.r2 = {
            fileCount: fileStats?.cnt || 0,
            totalBytes: fileStats?.totalBytes || 0,
          };
        } catch (_) {
          quotas.r2 = { fileCount: 0, totalBytes: 0 };
        }
      }
      // KV write estimation (rate limit entries for today + email sends × 2)
      if (env.DB && env.CATMAN_RATE) {
        try {
          const nowMs = Date.now();
          // Rate limit windows: sensitive = 15min (LOGIN_WINDOW_SECS=900), general = 1hr
          // Count rate_limits rows from today (each row = 1 KV write)
          const todayStart = Math.floor(nowMs / 86400000);
          const minWindow15 = Math.floor((todayStart * 86400000) / (900 * 1000)); // earliest 15-min window today
          const minWindow60 = Math.floor((todayStart * 86400000) / (3600 * 1000)); // earliest 1-hr window today
          let rlWrites = 0;
          try {
            const r = await env.DB.prepare('SELECT COALESCE(SUM(count), 0) as total FROM rate_limits WHERE window >= ?').bind(Math.min(minWindow15, minWindow60)).first();
            rlWrites = r?.total || 0;
          } catch (_) {}
          // Email sends: each send = 2 KV writes (day + month keys)
          const emailDaily = quotas.resend?.daily?.used || 0;
          const estimatedKvWrites = rlWrites + (emailDaily * 2);
          quotas.kv = {
            estimatedWrites: estimatedKvWrites,
            limit: 1000,
            pct: Math.round(estimatedKvWrites / 1000 * 100),
          };
        } catch (_) {
          quotas.kv = { estimatedWrites: 0, limit: 1000, pct: 0 };
        }
      } else {
        quotas.kv = { estimatedWrites: 0, limit: 1000, pct: 0 };
      }
      return respond(json({ quotas }));
    }

    // ─── GET /admin/errors — Server error log (owner only) ──
    if (path === '/admin/errors' && method === 'GET') {
      if (currentUser.role !== 'owner') {
        return respond(json({ error: 'Owner access required' }, 403));
      }
      if (!env.DB) return respond(json({ errors: [] }));
      try {
        const { results } = await env.DB.prepare(
          'SELECT id, message, stack, path, method, ip, created_at FROM error_log ORDER BY created_at DESC LIMIT 50'
        ).all();
        return respond(json({ errors: results || [] }));
      } catch (_) {
        return respond(json({ errors: [] }));
      }
    }

    // ─── 404 — unknown route ─────────────────────────
    return respond(json({ error: 'Not found' }, 404));

    } catch (e) {
      // Top-level safety net — prevent bare 500s leaking stack traces
      console.error('Unhandled Worker error:', e.message || e);
      // Log to D1 error_log table (best-effort)
      if (env.DB) {
        try {
          const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
          let errPath = '', errMethod = '';
          try { errPath = new URL(request.url).pathname; errMethod = request.method; } catch (_) {}
          await env.DB.prepare(
            'INSERT INTO error_log (message, stack, path, method, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(
            String(e.message || e).substring(0, 500),
            String(e.stack || '').substring(0, 2000),
            errPath,
            errMethod,
            ip,
            new Date().toISOString()
          ).run();
          // Probabilistic cleanup: keep last 500 rows (10% chance per error)
          if (Math.random() < 0.1) {
            env.DB.prepare('DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY created_at DESC LIMIT 500)').run().catch(() => {});
          }
        } catch (_) { /* logging failure is non-fatal */ }
      }
      return withCors(request, json({ error: 'Internal error' }, 500), env);
    }
  },
};
