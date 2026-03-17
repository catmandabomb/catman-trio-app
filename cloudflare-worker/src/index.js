/**
 * index.js — Catman API Worker entry point
 *
 * Routes:
 *   OPTIONS /*            — CORS preflight (no auth)
 *   GET     /health       — Health check (no auth)
 *   GET     /auth/key     — Encryption key seed (admin auth)
 *   *       /github/*     — GitHub API proxy (admin auth)
 */

import { handlePreflight, withCors } from './cors.js';
import { validateAuth } from './auth.js';
import { checkRateLimit } from './rate-limit.js';
import { proxyToGitHub } from './github-proxy.js';
import { handleGetKey } from './crypto.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ─── CORS preflight ──────────────────────────────
    if (request.method === 'OPTIONS') {
      return handlePreflight(request);
    }

    // ─── Health check (no auth) ──────────────────────
    if (url.pathname === '/health') {
      return withCors(request, new Response(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    // ─── All other routes require admin auth ─────────
    const auth = validateAuth(request, env);
    if (!auth.ok) {
      return withCors(request, new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    // ─── Rate limiting ───────────────────────────────
    const rateResult = await checkRateLimit(request, env);
    if (!rateResult.ok) {
      return withCors(request, new Response(JSON.stringify({ error: rateResult.error }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      }));
    }

    // ─── /auth/key — encryption key seed ─────────────
    if (url.pathname === '/auth/key' && request.method === 'GET') {
      return withCors(request, handleGetKey(env));
    }

    // ─── /github/* — GitHub API proxy ────────────────
    if (url.pathname.startsWith('/github/') || url.pathname === '/github') {
      const resp = await proxyToGitHub(request, env);
      return withCors(request, resp);
    }

    // ─── 404 — unknown route ─────────────────────────
    return withCors(request, new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));
  },
};
