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
 *   GET     /auth/key     — Encryption key seed (session or admin hash auth)
 *   PUT     /users/me/password — Change own password (session auth)
 *   GET/POST/PUT/DELETE /users/* — User management (owner only)
 *   *       /github/*     — GitHub API proxy (session or admin hash auth)
 *   POST    /email/send   — Send email via Resend (admin/owner only)
 */

import { handlePreflight, withCors } from './cors.js';
import { validateAuth } from './auth.js';
import { checkRateLimit } from './rate-limit.js';
import { proxyToGitHub } from './github-proxy.js';
import { handleGetKey } from './crypto.js';
import {
  verifyPassword, createSession, validateSession, deleteSession,
  cleanExpiredSessions, createUser, getUser, listUsers, updateUser,
  deleteUser, changePassword, getUserByUsername, countUsers,
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

function _safeAppUrl(env) {
  const raw = env.APP_URL || 'https://catmandabomb.github.io/catmantrio';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'https://catmandabomb.github.io/catmantrio';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch { return 'https://catmandabomb.github.io/catmantrio'; }
}

/**
 * Authenticate via session token OR admin hash (Phase 1 backward compat).
 * Returns { user, authMethod } or null.
 */
async function authenticateRequest(request, env) {
  // Try session token first (Authorization: Bearer <token>)
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ') && env.DB) {
    const token = authHeader.slice(7);
    const user = await validateSession(env.DB, token);
    if (user) return { user, authMethod: 'session' };
  }

  // Fall back to admin hash (Phase 1 compat)
  const adminAuth = validateAuth(request, env);
  if (adminAuth.ok) {
    return {
      user: { userId: '__admin__', username: 'admin', role: 'owner', displayName: 'Admin' },
      authMethod: 'admin-hash',
    };
  }

  return null;
}

export default {
  async fetch(request, env) {
    try {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // ─── CORS preflight ──────────────────────────────
    if (method === 'OPTIONS') {
      return handlePreflight(request);
    }

    // ─── Health check (no auth) ──────────────────────
    if (path === '/health') {
      let needsSetup = false;
      if (env.DB) {
        try { needsSetup = (await countUsers(env.DB)) === 0; } catch (_) {}
      }
      return withCors(request, json({
        status: 'ok',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        hasDb: !!env.DB,
        needsSetup,
      }));
    }

    // ─── Rate limiting (all non-health routes) ───────
    const rateResult = await checkRateLimit(request, env);
    if (!rateResult.ok) {
      return withCors(request, json({ error: rateResult.error }, 429));
    }

    // ─── PUBLIC: POST /auth/login ────────────────────
    if (path === '/auth/login' && method === 'POST') {
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.username || !body.password) {
        return withCors(request, json({ error: 'Username and password required' }, 400));
      }
      if (body.username.length > 50 || body.password.length > 128) {
        return withCors(request, json({ error: 'Invalid input length' }, 400));
      }
      const user = await getUserByUsername(env.DB, body.username);
      if (!user) {
        // Dummy PBKDF2 to equalize timing (prevent username enumeration)
        await verifyPassword(body.password, 'pbkdf2:0000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000');
        return withCors(request, json({ error: 'Invalid credentials' }, 401));
      }
      const ok = await verifyPassword(body.password, user.pw_hash);
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
              }).catch(() => {}); // fire-and-forget
              } // end if (!alreadySent)
            }
          } catch (_) {}
        }
        return withCors(request, json({ error: 'Invalid credentials' }, 401));
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
              }).catch(() => {}); // fire-and-forget
            }
          }
        } catch (_) { /* non-fatal */ }
      }

      const session = await createSession(env.DB, user.id, deviceInfo);
      // Clean up expired sessions occasionally (1 in 10 logins)
      if (Math.random() < 0.1) cleanExpiredSessions(env.DB).catch(() => {});
      return withCors(request, json({
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
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.username || !body.password || !body.email) {
        return withCors(request, json({ error: 'Username, password, and email required' }, 400));
      }
      // Input length limits
      if (body.username.length > 25 || body.password.length > 128 || body.email.length > 200) {
        return withCors(request, json({ error: 'Invalid input length' }, 400));
      }
      if (body.displayName && body.displayName.length > 100) {
        return withCors(request, json({ error: 'Invalid input length' }, 400));
      }
      // Trim username (like email is trimmed)
      body.username = body.username.trim();
      // Username format: 2-25 chars, alphanumeric + underscores only
      if (body.username.length < 2) {
        return withCors(request, json({ error: 'Username must be at least 2 characters' }, 400));
      }
      if (!/^[a-zA-Z0-9_]+$/.test(body.username)) {
        return withCors(request, json({ error: 'Username may only contain letters, numbers, and underscores' }, 400));
      }
      // Password complexity
      const regPwErr = validatePasswordComplexity(body.password);
      if (regPwErr) {
        return withCors(request, json({ error: regPwErr }, 400));
      }
      // Email format validation
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return withCors(request, json({ error: 'Invalid email format' }, 400));
      }
      // Reject placeholder emails
      if (email.endsWith('@placeholder.local')) {
        return withCors(request, json({ error: 'A valid email address is required' }, 400));
      }
      // Check username uniqueness
      const existingUser = await getUserByUsername(env.DB, body.username);
      if (existingUser) {
        return withCors(request, json({ error: 'Username already taken' }, 409));
      }
      // Check email uniqueness
      const emailExists = await env.DB.prepare(
        'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1'
      ).bind(email).first();
      if (emailExists) {
        return withCors(request, json({ error: 'Email already in use' }, 409));
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
          return withCors(request, json({ error: 'Username or email already in use' }, 409));
        }
        return withCors(request, json({ error: 'Registration failed' }, 400));
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
        return withCors(request, json({
          ok: true,
          message: 'Account created — please log in',
          user: { id: user.id, username: user.username, displayName: displayName, role: 'member' },
        }, 201));
      }
      return withCors(request, json({
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
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      const existing = await countUsers(env.DB);
      if (existing > 0) {
        return withCors(request, json({ error: 'Setup already completed — users exist' }, 409));
      }
      const body = await parseBody(request);
      if (!body || !body.username || !body.password) {
        return withCors(request, json({ error: 'Username and password required' }, 400));
      }
      if (body.username.length > 50 || (body.displayName && body.displayName.length > 100) || (body.email && body.email.length > 200)) {
        return withCors(request, json({ error: 'Invalid input length' }, 400));
      }
      const setupPwErr = validatePasswordComplexity(body.password);
      if (setupPwErr) {
        return withCors(request, json({ error: setupPwErr }, 400));
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
          return withCors(request, json({ error: 'Setup already completed — users exist' }, 409));
        }
        return withCors(request, json({ error: 'Setup failed' }, 500));
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
        return withCors(request, json({ ok: true, message: 'Account created — please log in', user }, 201));
      }
      user.emailVerified = true;
      return withCors(request, json({ token: session.token, expires: session.expires, user }, 201));
    }

    // ─── PUBLIC: POST /auth/forgot-password ────────────
    if (path === '/auth/forgot-password' && method === 'POST') {
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.email) {
        return withCors(request, json({ error: 'Email is required' }, 400));
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
        } catch (_) { /* silently fail — don't leak info */ }
        // Clean up old tokens occasionally
        if (Math.random() < 0.2) cleanExpiredResetTokens(env.DB).catch(() => {});
      }
      return withCors(request, json({ ok: true, message: 'If that email is registered, a reset link has been sent.' }));
    }

    // ─── PUBLIC: POST /auth/reset-password ─────────────
    if (path === '/auth/reset-password' && method === 'POST') {
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      const body = await parseBody(request);
      if (!body || !body.token || !body.password) {
        return withCors(request, json({ error: 'Token and new password required' }, 400));
      }
      const resetPwErr = validatePasswordComplexity(body.password);
      if (resetPwErr) {
        return withCors(request, json({ error: resetPwErr }, 400));
      }
      const tokenData = await validateAndConsumeResetToken(env.DB, body.token);
      if (!tokenData) {
        return withCors(request, json({ error: 'Invalid or expired reset link' }, 400));
      }
      await changePassword(env.DB, tokenData.userId, body.password);
      return withCors(request, json({ ok: true, message: 'Password reset — please log in' }));
    }

    // ─── PUBLIC: GET /auth/verify-email?token=... ──────
    if (path === '/auth/verify-email' && method === 'GET') {
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      const token = url.searchParams.get('token');
      if (!token) {
        return withCors(request, json({ error: 'Token required' }, 400));
      }
      const result = await verifyEmail(env.DB, token);
      if (!result) {
        return withCors(request, json({ error: 'Invalid or expired verification link' }, 400));
      }
      return withCors(request, json({ ok: true, message: 'Email verified!', username: result.username }));
    }

    // ─── PUBLIC: POST /auth/resend-verification ────────
    if (path === '/auth/resend-verification' && method === 'POST') {
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));
      // Per-user rate limit: max 3 verification emails per hour
      if (env.CATMAN_RATE) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const window = Math.floor(Date.now() / 3600000);
        const verifyKey = `verify:${ip}:${window}`;
        try {
          const current = parseInt(await env.CATMAN_RATE.get(verifyKey) || '0', 10);
          if (current >= 3) {
            return withCors(request, json({ error: 'Too many verification requests — try again later' }, 429));
          }
          await env.CATMAN_RATE.put(verifyKey, String(current + 1), { expirationTtl: 3660 });
        } catch (_) {}
      }
      // Requires session auth
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return withCors(request, json({ error: 'Authentication required' }, 401));
      }
      const token = authHeader.slice(7);
      const sessionUser = await validateSession(env.DB, token);
      if (!sessionUser) {
        return withCors(request, json({ error: 'Authentication required' }, 401));
      }
      if (sessionUser.emailVerified) {
        return withCors(request, json({ ok: true, message: 'Email already verified' }));
      }
      // Get user email
      const dbUser = await getUserByUsername(env.DB, sessionUser.username);
      if (!dbUser || !dbUser.email || dbUser.email.endsWith('@placeholder.local')) {
        return withCors(request, json({ error: 'No valid email on file' }, 400));
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
          if (!emailResp.ok) {
            console.error('Resend error on resend-verification:', await emailResp.text().catch(() => 'unknown'));
            return withCors(request, json({ ok: false, error: 'Email service error — try again later' }, 502));
          }
        } catch (e) {
          console.error('Email send failed on resend-verification:', e.message || e);
          return withCors(request, json({ ok: false, error: 'Email service error — try again later' }, 502));
        }
      } else {
        return withCors(request, json({ ok: false, error: 'Email service not configured' }, 500));
      }
      return withCors(request, json({ ok: true, message: 'Verification email sent' }));
    }

    // ─── All other routes require authentication ─────
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return withCors(request, json({ error: 'Authentication required' }, 401));
    }
    const { user: currentUser, authMethod } = authResult;

    // ─── POST /auth/logout ───────────────────────────
    if (path === '/auth/logout' && method === 'POST') {
      if (authMethod === 'session') {
        const token = (request.headers.get('Authorization') || '').slice(7);
        await deleteSession(env.DB, token);
      }
      return withCors(request, json({ ok: true }));
    }

    // ─── GET /auth/me ────────────────────────────────
    if (path === '/auth/me' && method === 'GET') {
      return withCors(request, json({ user: currentUser }));
    }

    // ─── GET /auth/key — encryption key seed (owner/admin only) ─────────
    if (path === '/auth/key' && method === 'GET') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return withCors(request, json({ error: 'Admin access required' }, 403));
      }
      return withCors(request, handleGetKey(env));
    }

    // ─── PUT /users/me/password ──────────────────────
    if (path === '/users/me/password' && method === 'PUT') {
      if (authMethod !== 'session' || !env.DB) {
        return withCors(request, json({ error: 'Session auth required' }, 400));
      }
      const body = await parseBody(request);
      if (!body || !body.currentPassword || !body.newPassword) {
        return withCors(request, json({ error: 'Current and new password required' }, 400));
      }
      const changePwErr = validatePasswordComplexity(body.newPassword);
      if (changePwErr) {
        return withCors(request, json({ error: changePwErr }, 400));
      }
      // Verify current password
      const dbUser = await getUserByUsername(env.DB, currentUser.username);
      if (!dbUser) return withCors(request, json({ error: 'User not found' }, 404));
      const ok = await verifyPassword(body.currentPassword, dbUser.pw_hash);
      if (!ok) return withCors(request, json({ error: 'Current password is incorrect' }, 403));
      await changePassword(env.DB, currentUser.userId, body.newPassword);
      return withCors(request, json({ ok: true, message: 'Password changed — please log in again' }));
    }

    // ─── PUT /users/me/email ───────────────────────────
    if (path === '/users/me/email' && method === 'PUT') {
      if (authMethod !== 'session' || !env.DB) {
        return withCors(request, json({ error: 'Session auth required' }, 400));
      }
      const body = await parseBody(request);
      if (!body || !body.email || !body.password) {
        return withCors(request, json({ error: 'Email and current password required' }, 400));
      }
      // Re-verify password before allowing email change
      const emailChangeUser = await getUserByUsername(env.DB, currentUser.username);
      if (!emailChangeUser) return withCors(request, json({ error: 'User not found' }, 404));
      const pwOk = await verifyPassword(body.password, emailChangeUser.pw_hash);
      if (!pwOk) return withCors(request, json({ error: 'Current password is incorrect' }, 403));
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return withCors(request, json({ error: 'Invalid email format' }, 400));
      }
      // Check email uniqueness
      const emailTaken = await env.DB.prepare(
        'SELECT id FROM users WHERE LOWER(email) = ? AND id != ? LIMIT 1'
      ).bind(email, currentUser.userId).first();
      if (emailTaken) {
        return withCors(request, json({ error: 'Email already in use' }, 409));
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
        } catch (_) {}
      }
      return withCors(request, json({ ok: true, message: 'Email updated — check your inbox to verify' }));
    }

    // ─── /users/* — User management (owner only, session auth required) ─────
    if (path.startsWith('/users')) {
      // Block admin-hash from user management (security: prevent synthetic owner from managing real users)
      if (authMethod === 'admin-hash') {
        return withCors(request, json({ error: 'Session auth required for user management' }, 403));
      }
      if (currentUser.role !== 'owner') {
        return withCors(request, json({ error: 'Owner access required' }, 403));
      }
      if (!env.DB) return withCors(request, json({ error: 'Database not configured' }, 500));

      // GET /users — list all
      if (path === '/users' && method === 'GET') {
        const users = await listUsers(env.DB);
        return withCors(request, json({ users }));
      }

      // POST /users — create user
      if (path === '/users' && method === 'POST') {
        const body = await parseBody(request);
        if (!body || !body.username || !body.password || !body.email) {
          return withCors(request, json({ error: 'Username, password, and email required' }, 400));
        }
        if (body.username.length > 50 || body.email.length > 200 || (body.displayName && body.displayName.length > 100)) {
          return withCors(request, json({ error: 'Invalid input length' }, 400));
        }
        const createPwErr = validatePasswordComplexity(body.password);
        if (createPwErr) {
          return withCors(request, json({ error: createPwErr }, 400));
        }
        // Don't allow creating another owner
        if (body.role === 'owner') {
          return withCors(request, json({ error: 'Cannot create another owner' }, 400));
        }
        // Check email uniqueness
        if (body.email && !body.email.endsWith('@placeholder.local')) {
          const emailExists = await env.DB.prepare(
            'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1'
          ).bind(body.email.trim().toLowerCase()).first();
          if (emailExists) {
            return withCors(request, json({ error: 'Email already in use' }, 409));
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
            } catch (_) { /* email send failure is non-fatal */ }
          }
          return withCors(request, json({ user }, 201));
        } catch (e) {
          const safeMsg = e.message?.includes('already exists') ? 'Username already exists' : 'User creation failed';
          return withCors(request, json({ error: safeMsg }, 400));
        }
      }

      // GET/PUT/DELETE /users/:id
      const userIdMatch = path.match(/^\/users\/([a-f0-9]{16})$/);
      if (userIdMatch) {
        const userId = userIdMatch[1];

        if (method === 'GET') {
          const user = await getUser(env.DB, userId);
          if (!user) return withCors(request, json({ error: 'User not found' }, 404));
          return withCors(request, json({ user }));
        }

        if (method === 'PUT') {
          const body = await parseBody(request);
          if (!body) return withCors(request, json({ error: 'Body required' }, 400));
          // Prevent changing own role away from owner
          if (userId === currentUser.userId && body.role && body.role !== 'owner') {
            return withCors(request, json({ error: 'Cannot demote yourself from owner' }, 400));
          }
          // Prevent promoting anyone to owner via PUT
          if (body.role === 'owner' && userId !== currentUser.userId) {
            return withCors(request, json({ error: 'Cannot promote to owner' }, 400));
          }
          // Handle password reset by owner
          if (body.password) {
            const resetPwErr = validatePasswordComplexity(body.password);
            if (resetPwErr) {
              return withCors(request, json({ error: resetPwErr }, 400));
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
                  }).catch(() => {});
                } catch (_) {}
              }
            }
          }
          await updateUser(env.DB, userId, body);
          const user = await getUser(env.DB, userId);
          return withCors(request, json({ user }));
        }

        if (method === 'DELETE') {
          // Can't delete yourself
          if (userId === currentUser.userId) {
            return withCors(request, json({ error: 'Cannot delete yourself' }, 400));
          }
          await deleteUser(env.DB, userId);
          return withCors(request, json({ ok: true }));
        }
      }
    }

    // ─── /github/* — GitHub API proxy ────────────────
    if (path.startsWith('/github/') || path === '/github') {
      // Check write permission for non-GET requests
      if (method !== 'GET' && !['owner', 'admin'].includes(currentUser.role)) {
        return withCors(request, json({ error: 'Write access requires admin or owner role' }, 403));
      }
      const resp = await proxyToGitHub(request, env);
      return withCors(request, resp);
    }

    // ─── POST /email/send — Send email via Resend (admin/owner) ──
    if (path === '/email/send' && method === 'POST') {
      if (!['owner', 'admin'].includes(currentUser.role)) {
        return withCors(request, json({ error: 'Admin access required' }, 403));
      }
      if (!env.RESEND_API_KEY) {
        return withCors(request, json({ error: 'Email service not configured' }, 500));
      }
      const body = await parseBody(request);
      if (!body || !body.to || !body.subject || !body.html) {
        return withCors(request, json({ error: 'to, subject, and html are required' }, 400));
      }
      // Validate recipients — only allow registered user emails
      const recipients = Array.isArray(body.to) ? body.to : [body.to];
      if (recipients.length === 0 || recipients.length > 50) {
        return withCors(request, json({ error: 'Must have 1-50 recipients' }, 400));
      }
      if (!env.DB) {
        return withCors(request, json({ error: 'Database not configured — cannot validate recipients' }, 500));
      }
      const allUsers = await listUsers(env.DB);
      const validEmails = new Set(allUsers.map(u => u.email?.toLowerCase()).filter(Boolean));
      const invalid = recipients.filter(r => !validEmails.has(r.toLowerCase()));
      if (invalid.length > 0) {
        return withCors(request, json({ error: 'One or more recipients are not registered users' }, 400));
      }
      try {
        const fromAddr = env.EMAIL_FROM || 'Catman Trio <onboarding@resend.dev>';
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddr,
            to: recipients,
            subject: body.subject,
            html: body.html,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          return withCors(request, json({ error: data.message || 'Email send failed' }, resp.status));
        }
        return withCors(request, json({ ok: true, id: data.id }));
      } catch (_) {
        return withCors(request, json({ error: 'Email send failed' }, 500));
      }
    }

    // ─── 404 — unknown route ─────────────────────────
    return withCors(request, json({ error: 'Not found' }, 404));

    } catch (e) {
      // Top-level safety net — prevent bare 500s leaking stack traces
      console.error('Unhandled Worker error:', e.message || e);
      return withCors(request, json({ error: 'Internal error' }, 500));
    }
  },
};
