/**
 * utils.js — Shared utility functions
 *
 * Pure utilities used across multiple modules. No state dependencies —
 * functions that need state take it as parameters.
 */

import * as Store from './store.js?v=20.09';

// ─── HTML / String helpers ──────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(text, query) {
  if (!query) return esc(text);
  const escaped = esc(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${q})`, 'gi'), '<mark class="search-hi">$1</mark>');
}

function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function gradientText(str, from, to) {
  const chars = str.split('');
  const visible = chars.filter(c => c !== ' ');
  let vi = 0;
  return chars.map(c => {
    if (c === ' ') return ' ';
    const t = visible.length > 1 ? vi / (visible.length - 1) : 0;
    vi++;
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    return `<span style="color:rgb(${r},${g},${b})">${esc(c)}</span>`;
  }).join('');
}

// ─── Duration helpers ───────────────────────────────────────

function parseDurationInput(val) {
  if (!val) return 0;
  val = val.trim();
  if (/^\d+:\d{1,2}$/.test(val)) {
    const [m, s] = val.split(':').map(Number);
    return m * 60 + s;
  }
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// ─── Haptic feedback ───────────────────────────────────────
// Gracefully degrades on iOS / unsupported browsers (no-op)

const _canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function haptic(pattern) {
  if (_canVibrate) try { navigator.vibrate(pattern); } catch (_) {}
}
haptic.tap       = () => haptic(8);
haptic.light     = () => haptic(10);
haptic.medium    = () => haptic(25);
haptic.heavy     = () => haptic(50);
haptic.double    = () => haptic([12, 30, 12]);
haptic.success   = () => haptic([10, 40, 15]);

// ─── Toast ──────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  haptic.tap();
  // Sanitize: escape all HTML first, then restore <br> tags only
  el.innerHTML = esc(msg).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  el.classList.remove('hidden');
  el.classList.add('show');
  const timer = Store.get('toastTimer');
  if (timer) clearTimeout(timer);
  Store.set('toastTimer', setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 200);
  }, duration));
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Setlist copied!');
  } catch (_) {
    showToast('Copy failed \u2014 try manually.');
  }
  document.body.removeChild(ta);
}

// ─── Platform detection ─────────────────────────────────────

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobile() {
  if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  if (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024) return true;
  return false;
}

function isPWAInstalled() {
  if (window.navigator.standalone === true) return true;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  } catch (_) {}
  if (document.referrer.includes('android-app://')) return true;
  return false;
}

function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/iPhone|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (navigator.maxTouchPoints > 1) return 'other';
  return 'desktop';
}

// ─── Chart ordering helpers ─────────────────────────────────

function getOrderedCharts(song) {
  const charts = song.assets?.charts || [];
  if (!charts.length) return [];
  if (song.primaryChartId && !song.chartOrder) {
    song.chartOrder = [{ driveId: song.primaryChartId, order: 1 }];
    delete song.primaryChartId;
  }
  const order = song.chartOrder || [];
  if (!order.length) return [charts[0]];
  return order
    .sort((a, b) => a.order - b.order)
    .map(o => charts.find(c => c.driveId === o.driveId))
    .filter(Boolean);
}

function getChartOrderNum(song, driveId) {
  const order = song.chartOrder || [];
  const entry = order.find(o => o.driveId === driveId);
  return entry ? entry.order : 0;
}

// ─── Key filter helper ──────────────────────────────────────

function isHybridKey(k) {
  if (k.includes('/')) return true;
  const low = k.toLowerCase();
  return low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed';
}

// ─── Duplicate detection (Levenshtein) ──────────────────────

function levenshtein(a, b) {
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

/**
 * Find songs with similar titles (sync fallback).
 * @param {string} title
 * @param {string} excludeId
 * @param {Array} songs — songs array (passed in to avoid state dep)
 */
function findSimilarSongsSync(title, excludeId, songs) {
  if (!title) return [];
  const norm = title.trim().toLowerCase();
  return songs.filter(s => {
    if (s.id === excludeId) return false;
    const other = (s.title || '').trim().toLowerCase();
    if (!other) return false;
    if (norm === other) return true;
    if (norm.length >= 4 && other.length >= 4 && Math.abs(norm.length - other.length) <= 3) {
      return levenshtein(norm, other) <= 2;
    }
    return false;
  });
}

/**
 * Find songs with similar titles (async, worker-based).
 * @param {string} title
 * @param {string} excludeId
 * @param {Array} songs
 * @param {Worker|null} levWorker
 */
function findSimilarSongsAsync(title, excludeId, songs, levWorker) {
  if (!title) return Promise.resolve([]);
  if (!levWorker) return Promise.resolve(findSimilarSongsSync(title, excludeId, songs));
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(findSimilarSongsSync(title, excludeId, songs)), 2000);
    levWorker.onmessage = (e) => { clearTimeout(timeout); resolve(e.data.similar); };
    levWorker.postMessage({
      title,
      excludeId,
      songs: songs.map(s => ({ id: s.id, title: s.title })),
    });
  });
}

// ─── Metronome time sig helper ──────────────────────────────

function parseTimeSig(ts) {
  const TIME_SIGS = Store.get('TIME_SIGS');
  if (!ts) return TIME_SIGS[0];
  const match = TIME_SIGS.find(t => t.display === ts.trim());
  return match || TIME_SIGS[0];
}

// ─── Error boundary wrapper ─────────────────────────────────

function safeRender(name, renderFn) {
  return function(...args) {
    try {
      return renderFn(...args);
    } catch (err) {
      console.error(`[${name}] Render error:`, err);
      showToast('Something went wrong');
      const container = document.querySelector('.view.active > div') ||
        document.querySelector('.view.active');
      if (container) {
        container.innerHTML = `<div style="padding:32px;text-align:center;">
          <p style="color:var(--text-2);margin-bottom:12px;">Something went wrong rendering ${esc(name)}.</p>
          <button class="btn-primary" onclick="location.reload()">Reload</button>
        </div>`;
      }
    }
  };
}

// ─── Public API ─────────────────────────────────────────────

export { esc, highlight, deepClone, timeAgo, gradientText, parseDurationInput, formatDuration, haptic, showToast, fallbackCopy, isIOS, isMobile, isPWAInstalled, detectPlatform, getOrderedCharts, getChartOrderNum, isHybridKey, levenshtein, findSimilarSongsSync, findSimilarSongsAsync, parseTimeSig, safeRender };
