/**
 * utils.js — Shared utility functions
 *
 * Pure utilities used across multiple modules. No state dependencies —
 * functions that need state take it as parameters.
 *
 * @module utils
 */

import * as Store from './store.js?v=20.43';

// ─── HTML / String helpers ──────────────────────────────────

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Escape HTML and wrap search query matches in <mark> tags.
 * @param {string} text
 * @param {string} query
 * @returns {string} HTML with highlighted matches
 */
function highlight(text, query) {
  if (!query) return esc(text);
  const escaped = esc(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${q})`, 'gi'), '<mark class="search-hi">$1</mark>');
}

/**
 * Deep clone an object using structuredClone or JSON fallback.
 * @param {*} obj
 * @returns {*}
 */
function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Format a timestamp as relative time (e.g. "5m ago", "2h ago").
 * @param {number} ts - Unix timestamp in milliseconds
 * @returns {string}
 */
function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

/**
 * Render text with a per-character RGB gradient.
 * @param {string} str
 * @param {[number,number,number]} from - Starting RGB color
 * @param {[number,number,number]} to - Ending RGB color
 * @returns {string} HTML with colored spans
 */
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

/**
 * Parse duration input ("3:45" or "225") to seconds.
 * @param {string} val
 * @returns {number} Duration in seconds
 */
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

/**
 * Format seconds as "m:ss" string.
 * @param {number} secs
 * @returns {string}
 */
function formatDuration(secs) {
  if (!secs || secs <= 0) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// ─── Haptic feedback ───────────────────────────────────────
// Gracefully degrades on iOS / unsupported browsers (no-op)

const _canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/**
 * Trigger haptic feedback via the Vibration API. No-op on unsupported devices.
 * @param {number|number[]} pattern - Vibration pattern in ms
 */
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

/**
 * Show a toast notification. Supports <br> tags for line breaks.
 * @param {string} msg - Message text (HTML <br> is preserved, all other HTML escaped)
 * @param {number} [duration=3000] - Duration in ms before auto-hide
 */
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

/**
 * Show a technical/diagnostic toast. Hidden by default unless the user
 * has enabled "Show technical toasts" in settings.
 */
function showTechnicalToast(msg, duration = 3000) {
  if (localStorage.getItem('ct_pref_show_technical_toasts') !== '1') return;
  showToast(msg, duration);
}

/**
 * Fallback clipboard copy using a hidden textarea (for older browsers).
 * @param {string} text
 */
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

/** @returns {boolean} True if running on iOS/iPadOS */
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** @returns {boolean} True if running on a mobile/tablet device */
function isMobile() {
  const ua = navigator.userAgent;
  // Samsung DeX: Android UA but using mouse/keyboard on large screen — treat as desktop
  if (/Android/i.test(ua) && window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth > 1024) return false;
  if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  if (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024) return true;
  return false;
}

/** @returns {boolean} True if the app is running as an installed PWA */
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

/**
 * Detect the user's platform.
 * @returns {'ipad'|'ios'|'android'|'android-firefox'|'webview'|'macos-safari'|'other'|'desktop'}
 */
function detectPlatform() {
  const ua = navigator.userAgent;
  // WebView detection: Facebook, Instagram, and other in-app browsers
  if (/FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|MicroMessenger|LinkedIn|Telegram|Pinterest|Reddit/i.test(ua)) return 'webview';
  if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/iPhone|iPod/i.test(ua)) return 'ios';
  // Firefox on Android (distinct from Chrome — no beforeinstallprompt)
  if (/Android/i.test(ua) && /Firefox/i.test(ua) && !/Seamonkey/i.test(ua)) return 'android-firefox';
  // Samsung Internet on Android (distinct install flow)
  if (/Android/i.test(ua) && /SamsungBrowser/i.test(ua)) return 'android-samsung';
  if (/Android/i.test(ua)) return 'android';
  if (navigator.maxTouchPoints > 1) return 'other';
  // macOS Safari: Safari UA present, no Chrome/Firefox/Edge/Opera identifiers
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|CriOS|Firefox|FxiOS|Edg|OPR/i.test(ua)) return 'macos-safari';
  return 'desktop';
}

// ─── Chart ordering helpers ─────────────────────────────────

/**
 * Get charts for a song in their user-defined order.
 * @param {import('./store.js').Song} song
 * @returns {Array} Ordered chart objects
 */
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

/**
 * Get the ordering number for a specific chart within a song.
 * @param {import('./store.js').Song} song
 * @param {string} driveId
 * @returns {number} Order number (0 if not set)
 */
function getChartOrderNum(song, driveId) {
  const order = song.chartOrder || [];
  const entry = order.find(o => o.driveId === driveId);
  return entry ? entry.order : 0;
}

// ─── Key filter helper ──────────────────────────────────────

/**
 * Check if a musical key is a hybrid/multi-key designation.
 * @param {string} k
 * @returns {boolean}
 */
function isHybridKey(k) {
  if (k.includes('/')) return true;
  const low = k.toLowerCase();
  return low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed';
}

/**
 * The 24 canonical keys: 12 major + 12 minor.
 * Ordered by circle of fifths (C, G, D, A, E, B, F#/Gb, Db, Ab, Eb, Bb, F).
 */
const CANONICAL_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const CANONICAL_MINOR = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const ALL_CANONICAL_KEYS = [...CANONICAL_MAJOR, ...CANONICAL_MINOR];

/** Enharmonic equivalents → canonical name */
const _enharmonicMap = {
  // Major
  'C#': 'Db', 'D#': 'Eb', 'E#': 'F', 'Fb': 'E', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb', 'B#': 'C', 'Cb': 'B',
  // Minor
  'C#m': 'C#m', 'Dbm': 'C#m', 'D#m': 'Ebm', 'Fbm': 'Em', 'Gbm': 'F#m', 'G#m': 'G#m', 'Abm': 'G#m', 'A#m': 'Bbm', 'B#m': 'Cm', 'Cbm': 'Bm', 'E#m': 'Fm',
};

/**
 * Normalize a single key name to its canonical form.
 * e.g. "Db" → "Db", "C#" → "Db", "Gbm" → "F#m", "E" → "E", "Em" → "Em"
 * @param {string} raw - A single key like "C#", "Ebmaj", "Fm", "Amin", "E"
 * @returns {string|null} Canonical key or null if unrecognized
 */
function normalizeKey(raw) {
  let s = raw.trim();
  if (!s) return null;

  // Extract root note: A-G with optional # or b
  const rootMatch = s.match(/^([A-Ga-g][#b]?)/);
  if (!rootMatch) return null;
  let root = rootMatch[1];
  root = root.charAt(0).toUpperCase() + root.slice(1); // Capitalize root

  // Extract quality from the remainder
  const remainder = s.slice(rootMatch[0].length).toLowerCase().trim();
  let isMinor = false;
  if (remainder === 'm' || remainder === 'min' || remainder === 'minor' || remainder.startsWith('min')) {
    isMinor = true;
  }
  // "maj" or "major" or empty = major

  const key = isMinor ? root + 'm' : root;
  // Normalize enharmonics
  if (_enharmonicMap[key]) return _enharmonicMap[key];
  // Check if it's already canonical
  if (ALL_CANONICAL_KEYS.includes(key)) return key;
  return null;
}

/**
 * Parse a song's key field into an array of canonical keys.
 * Handles slash-separated multi-keys, "maj/min" suffixes, etc.
 * e.g. "E maj/min" → ["E", "Em"]
 *      "F#min/Ebmaj" → ["F#m", "Eb"]
 *      "C" → ["C"]
 *      "Multiple" → []
 * @param {string} keyField - The song's key field
 * @returns {string[]} Array of canonical key names
 */
function parseKeyField(keyField) {
  if (!keyField) return [];
  const s = keyField.trim();
  if (!s) return [];

  // Reject non-key strings
  const low = s.toLowerCase();
  if (low === 'multiple' || low === 'various' || low === 'hybrid' || low === 'mixed' || low === 'n/a' || low === 'none') return [];

  const results = new Set();

  // Special case: "X maj/min" or "X major/minor" → both major and minor of same root
  const majMinMatch = s.match(/^([A-Ga-g][#b]?)\s*maj(?:or)?\s*\/\s*min(?:or)?$/i);
  if (majMinMatch) {
    let root = majMinMatch[1];
    root = root.charAt(0).toUpperCase() + root.slice(1);
    const major = normalizeKey(root);
    const minor = normalizeKey(root + 'm');
    if (major) results.add(major);
    if (minor) results.add(minor);
    return [...results];
  }

  // Split on "/" and parse each part
  const parts = s.split('/');
  // Track the last known root for parts that are just qualities
  let lastRoot = null;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if this part is just a quality (min/minor/maj/major) without a root
    const qualOnly = trimmed.match(/^(min|minor|maj|major)$/i);
    if (qualOnly && lastRoot) {
      const isMinor = qualOnly[1].toLowerCase().startsWith('min');
      const key = normalizeKey(lastRoot + (isMinor ? 'min' : ''));
      if (key) results.add(key);
      continue;
    }

    const key = normalizeKey(trimmed);
    if (key) {
      results.add(key);
      // Extract root for context
      const rm = trimmed.match(/^([A-Ga-g][#b]?)/);
      if (rm) lastRoot = rm[1].charAt(0).toUpperCase() + rm[1].slice(1);
    }
  }
  return [...results];
}

/**
 * Check if a song's key field matches a canonical key filter.
 * @param {string} songKey - The song's raw key field
 * @param {string} filterKey - A canonical key like "E" or "F#m"
 * @returns {boolean}
 */
function songMatchesKey(songKey, filterKey) {
  return parseKeyField(songKey).includes(filterKey);
}

// ─── Duplicate detection (Levenshtein) ──────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
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

/**
 * Parse a time signature string into a TimeSig object.
 * @param {string} ts - e.g. "3/4"
 * @returns {import('./store.js').TimeSig}
 */
function parseTimeSig(ts) {
  const TIME_SIGS = Store.get('TIME_SIGS');
  if (!ts) return TIME_SIGS[0];
  const match = TIME_SIGS.find(t => t.display === ts.trim());
  return match || TIME_SIGS[0];
}

// ─── Error boundary wrapper ─────────────────────────────────

/**
 * Wrap a render function with error boundary that shows a friendly error UI.
 * @param {string} name - View name for error messages
 * @param {Function} renderFn - The render function to wrap
 * @returns {Function} Wrapped render function
 */
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

// ─── Form dirty tracking ─────────────────────────────────────

/**
 * Track whether a form has unsaved changes.
 * Call markDirty() when any input changes.
 * Call confirmDiscard() before navigating away.
 * @returns {{ markDirty: Function, isDirty: Function, confirmDiscard: (onDiscard: Function) => void, reset: Function }}
 */
function createDirtyTracker() {
  let _dirty = false;
  return {
    markDirty() { _dirty = true; },
    isDirty() { return _dirty; },
    reset() { _dirty = false; },
    confirmDiscard(onDiscard) {
      if (!_dirty) { onDiscard(); return; }
      // Use the app's confirm modal
      const overlay = document.getElementById('modal-confirm');
      const okBtn = document.getElementById('btn-confirm-ok');
      const cancelBtn = document.getElementById('btn-confirm-cancel');
      const titleEl = document.getElementById('confirm-title');
      const msgEl = document.getElementById('confirm-message');
      if (!overlay || !okBtn || !cancelBtn) { onDiscard(); return; }
      titleEl.textContent = 'Unsaved Changes';
      msgEl.textContent = 'You have unsaved changes. Discard them?';
      okBtn.textContent = 'Discard';
      okBtn.className = 'btn-danger';
      overlay.classList.remove('hidden');
      const cleanup = () => {
        overlay.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
      };
      const onOk = () => { cleanup(); _dirty = false; onDiscard(); };
      const onCancel = () => { cleanup(); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    },
  };
}

/**
 * Attach dirty tracking to all inputs/textareas/selects within a container.
 * @param {HTMLElement} container
 * @param {{ markDirty: Function }} tracker
 */
function trackFormInputs(container, tracker) {
  container.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', tracker.markDirty);
    el.addEventListener('change', tracker.markDirty);
  });
}

// ─── Screen Wake Lock ───────────────────────────────────────

let _wakeLockSentinel = null;
let _wakeLockRefCount = 0;

async function requestWakeLock() {
  _wakeLockRefCount++;
  if (_wakeLockSentinel) return;
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLockSentinel = await navigator.wakeLock.request('screen');
    _wakeLockSentinel.addEventListener('release', () => { _wakeLockSentinel = null; });
  } catch (_) { /* low battery or hidden tab — silently ignore */ }
}

function releaseWakeLock() {
  _wakeLockRefCount = Math.max(0, _wakeLockRefCount - 1);
  if (_wakeLockRefCount > 0) return; // other callers still need it
  if (_wakeLockSentinel) { try { _wakeLockSentinel.release(); } catch (_) {} _wakeLockSentinel = null; }
}

// Re-acquire on visibility change (OS releases wake lock when tab is hidden)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _wakeLockRefCount > 0 && !_wakeLockSentinel) {
    requestWakeLock();
  }
});

// ─── Public API ─────────────────────────────────────────────

export { esc, highlight, deepClone, timeAgo, gradientText, parseDurationInput, formatDuration, haptic, showToast, showTechnicalToast, fallbackCopy, isIOS, isMobile, isPWAInstalled, detectPlatform, getOrderedCharts, getChartOrderNum, isHybridKey, ALL_CANONICAL_KEYS, normalizeKey, parseKeyField, songMatchesKey, levenshtein, findSimilarSongsSync, findSimilarSongsAsync, parseTimeSig, safeRender, createDirtyTracker, trackFormInputs, requestWakeLock, releaseWakeLock };
