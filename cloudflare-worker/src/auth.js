/**
 * auth.js — Admin hash validation
 *
 * Validates the X-Admin-Hash header against the stored ADMIN_HASH secret.
 * Uses constant-time comparison to prevent timing attacks.
 */

/**
 * Validate the admin hash from the request.
 * @param {Request} request
 * @param {object} env - Worker environment (must have ADMIN_HASH secret)
 * @returns {{ ok: boolean, error?: string, status?: number }}
 */
function validateAuth(request, env) {
  const hash = request.headers.get('X-Admin-Hash');
  if (!hash) {
    return { ok: false, error: 'Missing X-Admin-Hash header', status: 401 };
  }
  if (!env.ADMIN_HASH) {
    return { ok: false, error: 'Server auth not configured', status: 500 };
  }

  // Constant-time comparison
  if (!timingSafeEqual(hash, env.ADMIN_HASH)) {
    return { ok: false, error: 'Invalid credentials', status: 403 };
  }

  return { ok: true };
}

/**
 * Constant-time string comparison.
 * Prevents timing attacks by always comparing all characters.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still do a dummy comparison to avoid length-based timing leak
    b = a;
    var result = 1;
  } else {
    var result = 0;
  }
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export { validateAuth };
