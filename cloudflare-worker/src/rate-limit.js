/**
 * rate-limit.js — Per-IP rate limiting via KV
 *
 * Tracks request counts per IP per hour window.
 * Returns 429 when threshold is exceeded.
 */

const RATE_LIMIT = 200;   // requests per window
const WINDOW_SECS = 3600; // 1 hour

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
  const key = `rate:${ip}:${window}`;

  try {
    const current = parseInt(await env.CATMAN_RATE.get(key) || '0', 10);
    if (current >= RATE_LIMIT) {
      return { ok: false, remaining: 0, error: 'Rate limit exceeded' };
    }
    // Increment — fire and forget (non-blocking)
    await env.CATMAN_RATE.put(key, String(current + 1), {
      expirationTtl: WINDOW_SECS + 60, // auto-expire shortly after window ends
    });
    return { ok: true, remaining: RATE_LIMIT - current - 1 };
  } catch (e) {
    // KV failure — allow request (fail-open for availability)
    console.error('Rate limit KV error:', e);
    return { ok: true, remaining: RATE_LIMIT };
  }
}

export { checkRateLimit };
