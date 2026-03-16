/**
 * levenshtein-worker.js — Web Worker for fuzzy duplicate detection
 *
 * Offloads Levenshtein distance computation to a background thread
 * so the main thread stays responsive during song saves.
 *
 * Message protocol:
 *   IN:  { title: string, excludeId: string|null, songs: [{id, title}] }
 *   OUT: { similar: [{id, title}] }
 */

self.addEventListener('message', (e) => {
  const { title, excludeId, songs } = e.data;
  if (!title) { self.postMessage({ similar: [] }); return; }

  const norm = title.trim().toLowerCase();
  const similar = [];

  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    if (s.id === excludeId) continue;
    const other = (s.title || '').trim().toLowerCase();
    if (!other) continue;
    if (norm === other) { similar.push(s); continue; }
    if (norm.length >= 4 && other.length >= 4 && Math.abs(norm.length - other.length) <= 3) {
      if (_levenshtein(norm, other) <= 2) similar.push(s);
    }
  }

  self.postMessage({ similar });
});

function _levenshtein(a, b) {
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp = Array.from({ length: la + 1 }, (_, i) => i);
  for (let j = 1; j <= lb; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= la; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[la];
}
