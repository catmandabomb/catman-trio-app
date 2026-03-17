/**
 * github-proxy.js — GitHub API proxy
 *
 * Strips the /github prefix, forwards to api.github.com with the
 * server-side PAT, and strips rate-limit headers from the response.
 */

const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 30000;

// Headers to strip from GitHub's response (don't leak server PAT rate limits)
const STRIP_HEADERS = [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
];

/**
 * Proxy a request to GitHub API.
 * @param {Request} request - Original request (path starts with /github/)
 * @param {object} env - Must have GITHUB_PAT secret
 * @returns {Response}
 */
async function proxyToGitHub(request, env) {
  if (!env.GITHUB_PAT) {
    return new Response(JSON.stringify({ error: 'GitHub PAT not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Strip /github prefix to get the real GitHub API path
  const url = new URL(request.url);
  const githubPath = url.pathname.replace(/^\/github/, '') + url.search;

  // Build proxied request
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${env.GITHUB_PAT}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('User-Agent', 'CatmanTrio-Worker/1.0');

  // Forward Content-Type for PUT/POST requests
  const ct = request.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);

  const init = {
    method: request.method,
    headers,
  };

  // Forward body for non-GET methods
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  try {
    const ghResp = await fetch(`${GITHUB_API}${githubPath}`, init);

    // Build response, stripping sensitive headers
    const respHeaders = new Headers(ghResp.headers);
    for (const h of STRIP_HEADERS) {
      respHeaders.delete(h);
    }

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: respHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'GitHub API request failed', detail: e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export { proxyToGitHub };
