/**
 * cors.js — CORS handling for the Catman API Worker
 *
 * Allows requests from the app's production origins.
 * Localhost origins are gated behind DEV_MODE env var.
 * Rejects other origins with no CORS headers.
 */

const PROD_ORIGINS = [
  'https://trio.catmanbeats.com',
  'https://catmandabomb.github.io',  // keep during transition
];

const DEV_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

/**
 * Build CORS headers for a given request origin.
 * Returns null if origin is not allowed.
 * @param {Request} request
 * @param {object} [env] - Worker env bindings (checks DEV_MODE)
 */
function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env && env.DEV_MODE
    ? [...PROD_ORIGINS, ...DEV_ORIGINS]
    : PROD_ORIGINS;
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Hash, Authorization',
    'Access-Control-Expose-Headers': 'X-New-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Handle CORS preflight (OPTIONS) requests.
 */
function handlePreflight(request, env) {
  const corsHeaders = getCorsHeaders(request, env);
  if (!corsHeaders) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Add CORS headers to an existing Response.
 * Returns a new Response with CORS headers merged in.
 */
function withCors(request, response, env) {
  const corsHeaders = getCorsHeaders(request, env);
  if (!corsHeaders) return response;
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    newHeaders.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export { getCorsHeaders, handlePreflight, withCors, PROD_ORIGINS, DEV_ORIGINS };
