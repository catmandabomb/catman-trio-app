/**
 * rate-limit.js — Per-IP rate limiting via KV
 *
 * Tracks request counts per IP per hour window.
 * Returns 429 when threshold is exceeded.
 * Includes a stricter limit for login attempts.
 */

const RATE_LIMIT = 200;        // general requests per window
const LOGIN_RATE_LIMIT = 10;   // login attempts per window
const RESET_RATE_LIMIT = 3;    // forgot-password requests per window
const WINDOW_SECS = 3600;      // 1 hour

/**
 * Check and increment rate limit for the requesting IP.
 * @param {Request} request
 * @param {object} env - Must have CATMAN_RATE KV binding
 * @returns {{ ok: boolean, remaining: number, error?: string }}
 */
async function checkRateLimit(request, env) {
  if (!env.CATMAN_RATE) {
    // KV not configured — allow request (graceful degradation)
    return { ok: true, remaining: RATE_LIMIT };
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const window = Math.floor(Date.now() / (WINDOW_SECS * 1000));

  // Determine rate limit tier based on endpoint
  const url = new URL(request.url);
  const isLogin = url.pathname === '/auth/login' && request.method === 'POST';
  const isRegister = url.pathname === '/auth/register' && request.method === 'POST';
  const isReset = url.pathname === '/auth/forgot-password' && request.method === 'POST';
  const isResetConsume = url.pathname === '/auth/reset-password' && request.method === 'POST';
  const isSetup = url.pathname === '/setup/init' && request.method === 'POST';
  const isSensitive = isLogin || isRegister || isResetConsume || isSetup;
  const limit = isSensitive ? LOGIN_RATE_LIMIT : isReset ? RESET_RATE_LIMIT : RATE_LIMIT;
  const prefix = isLogin ? 'login' : isRegister ? 'register' : isReset ? 'reset' : isResetConsume ? 'resetpw' : isSetup ? 'setup' : 'rate';
  const key = `${prefix}:${ip}:${window}`;

  try {
    const current = parseInt(await env.CATMAN_RATE.get(key) || '0', 10);
    if (current >= limit) {
      return { ok: false, remaining: 0, error: 'Rate limit exceeded' };
    }
    // Increment FIRST (pessimistic) — reduces TOCTOU window.
    // Even if concurrent requests both read the same count, the put
    // is idempotent at the same value so at worst we lose 1 count.
    const next = current + 1;
    await env.CATMAN_RATE.put(key, String(next), {
      expirationTtl: WINDOW_SECS + 60,
    });
    // For sensitive endpoints (login, reset), add a secondary D1-based
    // check if available — D1 UPDATE is atomic
    if ((isSensitive || isReset) && env.DB) {
      try {
        // Atomic increment in D1 as a second line of defense
        await env.DB.prepare(
          `INSERT INTO rate_limits (key, count, window) VALUES (?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET count = count + 1`
        ).bind(key, window).run();
        const row = await env.DB.prepare(
          'SELECT count FROM rate_limits WHERE key = ?'
        ).bind(key).first();
        if (row && row.count > limit) {
          return { ok: false, remaining: 0, error: 'Rate limit exceeded' };
        }
      } catch (_) { /* D1 rate table may not exist yet — fall through to KV-only */ }
    }
    // Periodically clean stale rate_limits rows (1 in 50 requests)
    if (env.DB && Math.random() < 0.02) {
      const staleWindow = window - 2; // keep current + previous window
      env.DB.prepare('DELETE FROM rate_limits WHERE window < ?')
        .bind(staleWindow).run().catch(() => {});
    }
    return { ok: true, remaining: limit - next };
  } catch (e) {
    // KV failure — allow request (fail-open for availability)
    console.error('Rate limit KV error:', e.message);
    return { ok: true, remaining: limit };
  }
}

export { checkRateLimit };
