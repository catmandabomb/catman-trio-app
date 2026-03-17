/**
 * crypto.js — Encryption key management
 *
 * Serves the encryption key seed to authenticated clients.
 * The seed is used client-side: AES key = SHA-256(seed).
 */

/**
 * Handle GET /auth/key — return the encryption key seed.
 * @param {object} env - Must have ENCRYPTION_KEY_SEED secret
 * @returns {Response}
 */
function handleGetKey(env) {
  if (!env.ENCRYPTION_KEY_SEED) {
    return new Response(JSON.stringify({ error: 'Encryption key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ seed: env.ENCRYPTION_KEY_SEED }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export { handleGetKey };
