/**
 * router.js — Hash routing + view management
 *
 * Registry pattern: view modules register render functions at load time.
 * Router calls them by key, avoiding circular deps.
 *
 * @module router
 */

import * as Store from './store.js?v=20.29';
import * as Player from '../player.js?v=20.29';
import * as Metronome from '../metronome.js?v=20.29';

// Lazy import to break circular dep (app.js imports router.js)
let _App = null;
function _getApp() {
  if (!_App) _App = import('../app.js?v=20.29');
  return _App;
}

// ─── View registry ──────────────────────────────────────────
const _registry = {};       // viewName → renderFn(route)
const _hooks = {};          // hookName → fn

// ─── Navigation API feature detection ───────────────────────
const _hasNavigationAPI = typeof window.navigation !== 'undefined';

// ─── Cached DOM references ─────────────────────────────────
let _viewEls = null;        // cached .view NodeList
let _navBtns = null;        // cached .topbar-nav-btn NodeList
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Register a render function for a view name.
 * Called by view modules at load time.
 */
function register(viewName, renderFn) {
  _registry[viewName] = renderFn;
}

/**
 * Register a named hook (e.g. 'cleanupDetailAnchors').
 */
function registerHook(name, fn) {
  _hooks[name] = fn;
}

function _callHook(name) {
  if (_hooks[name]) _hooks[name]();
}

// ─── Hash ↔ View mapping ───────────────────────────────────

/**
 * Convert a view name and optional params to a URL hash.
 * @param {string} viewName
 * @param {{songId?: string, setlistId?: string}} [params]
 * @returns {string} Hash string (e.g. "#song/abc1")
 */
function viewToHash(viewName, params) {
  switch (viewName) {
    case 'list': return '#';
    case 'detail': return params?.songId ? `#song/${params.songId}` : '#';
    case 'setlists': return '#setlists';
    case 'setlist-detail': return params?.setlistId ? `#setlist/${params.setlistId}` : '#setlists';
    case 'practice': return '#practice';
    case 'practice-detail': return params?.practiceListId ? `#practice/${params.practiceListId}` : '#practice';
    case 'practice-edit': return params?.practiceListId ? `#practice/${params.practiceListId}` : '#practice';
    case 'dashboard': return '#dashboard';
    case 'messages': return '#messages';
    case 'account': return '#account';
    case 'settings': return '#settings';
    case 'wikicharts': return '#wikicharts';
    case 'wikichart-detail': return params?.wikiChartId ? `#wikichart/${params.wikiChartId}` : '#wikicharts';
    case 'orchestra': return '#orchestra';
    case 'orchestra-detail': return params?.orchestraId ? `#orchestra/${params.orchestraId}` : '#orchestra';
    default: return '#';
  }
}

/**
 * Parse a URL hash into a route object.
 * @param {string} hash - e.g. "#song/abc1" or "#setlists"
 * @returns {{view: string, songId?: string, setlistId?: string, token?: string}}
 */
function resolveHash(hash) {
  if (!hash || hash === '#' || hash === '') return { view: 'list' };
  const raw = hash.replace(/^#/, '');
  // Handle routes with query params (e.g. reset-password?token=...)
  const [routePart, queryPart] = raw.split('?');
  const params = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }
  const parts = routePart.split('/');
  switch (parts[0]) {
    case 'song': return { view: 'detail', songId: parts[1] };
    case 'setlists': return { view: 'setlists' };
    case 'setlist': return { view: 'setlist-detail', setlistId: parts[1] };
    case 'practice':
      return parts[1] ? { view: 'practice-detail', practiceListId: parts[1] } : { view: 'practice' };
    case 'messages': return { view: 'messages' };
    case 'dashboard': return { view: 'dashboard' };
    case 'account': return { view: 'account' };
    case 'settings': return { view: 'settings' };
    case 'wikicharts': return { view: 'wikicharts' };
    case 'wikichart': return { view: 'wikichart-detail', wikiChartId: parts[1] };
    case 'reset-password': return { view: 'reset-password', token: params.token };
    case 'verify-email': return { view: 'verify-email', token: params.token };
    case 'orchestra': return parts[1] ? { view: 'orchestra-detail', orchestraId: parts[1] } : { view: 'orchestra' };
    default: return { view: 'list' };
  }
}

/**
 * Navigate to a resolved route using the registry.
 * Falls back to 'list' if no handler registered.
 */
function navigateToRoute(route) {
  if (!route) return;
  const fn = _registry[route.view];
  if (fn) {
    fn(route);
  } else if (_registry['list']) {
    _registry['list']();
  }
}

// ─── View switching ─────────────────────────────────────────

function _ensureCached() {
  if (!_viewEls) _viewEls = document.querySelectorAll('.view');
  if (!_navBtns) _navBtns = document.querySelectorAll('.topbar-nav-btn');
}

/**
 * Switch to a named view, updating DOM, URL hash, and ARIA state.
 * @param {string} name - View name (e.g. 'list', 'detail', 'setlists')
 */
function showView(name) {
  _ensureCached();
  const popstateNav = Store.get('isPopstateNavigation');
  const isFirstCall = !Store.get('showViewCalled');
  const currentView = Store.get('view');
  const alreadyActive = Store.get('showViewCalled') && currentView === name;
  Store.set('showViewCalled', true);

  const swap = () => {
    if (!alreadyActive) {
      if (currentView === 'list' && name !== 'list') _callHook('cleanupSelection');
      if (currentView === 'setlist-live' && name !== 'setlist-live') _callHook('cleanupLiveMode');
      // Clean up practice mode (tuning fork, metronome) when leaving any practice view
      if ((currentView === 'practice-detail' || currentView === 'practice-edit' || currentView === 'practice') && (currentView !== name && !name.startsWith('practice'))) {
        _callHook('cleanupPractice');
        document.body.classList.remove('practice-mode-active');
      } else if (currentView === 'practice-detail' && name !== 'practice-detail') {
        // Leaving practice-detail for another practice sub-view (e.g. practice list)
        _callHook('cleanupPractice');
        document.body.classList.remove('practice-mode-active');
      }
      // Clean up WikiCharts auto-scroll when leaving wikichart views
      if ((currentView === 'wikicharts' || currentView === 'wikichart-detail') && !name.startsWith('wikichart')) {
        _callHook('cleanupWikiCharts');
      }
      // Clean up live mode classes inside transition to avoid layout jitter
      if (name !== 'setlist-live') {
        document.body.classList.remove('live-mode-active');
        document.documentElement.classList.remove('live-mode-active');
      }
      // Hide volume slider when leaving detail view (songs.js shows it when audio exists)
      if (name !== 'detail') _getApp().then(App => App.showVolume && App.showVolume(false));
      // Remove view-specific topbar buttons when leaving
      document.querySelectorAll('#acct-logout-topbar, #dash-topbar-actions, #setlists-topbar-actions, #setlist-detail-topbar-actions, #practice-topbar-actions, #practice-list-detail-topbar-actions, #song-detail-topbar-actions, #wikicharts-topbar-actions, #wikichart-detail-topbar-actions, #messages-topbar-actions').forEach(el => el.remove());
      // Tuning fork wrap: only remove when NOT entering practice-detail (it injects its own)
      if (name !== 'practice-detail') document.getElementById('tuning-fork-wrap')?.remove();
      _viewEls.forEach(v => v.classList.remove('active'));
      const el = document.getElementById(`view-${name}`);
      if (el) {
        el.classList.add('active');
        el.scrollTop = 0;
        // Focus management for accessibility — move focus to new view
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => el.focus({ preventScroll: true }));
        if (name === 'list') {
          const sw = document.getElementById('song-list-scroll');
          if (sw) sw.scrollTop = 0;
        }
      }
    }
    Store.set('view', name);
    // Announce page change to screen readers
    const _announcer = document.getElementById('route-announcer');
    if (_announcer) {
      const _viewLabel = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      _announcer.textContent = 'Navigated to ' + _viewLabel;
    }
    // Update URL hash for deep linking (don't push on popstate-driven navigation)
    if (!popstateNav) {
      const hash = viewToHash(name, Store.get('currentRouteParams'));
      if (hash === '#' || hash === '') {
        if (location.hash) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
        }
      } else if (location.hash !== hash) {
        // Navigation API: use navigation.navigate() for push navigations
        if (_hasNavigationAPI) {
          try {
            _internalNavigation = true;
            const url = new URL(hash, location.href);
            window.navigation.navigate(url.href, { history: 'push' });
          } catch (_navErr) {
            // Fallback to History API if Navigation API call fails
            try { history.pushState(null, '', hash); } catch (_) {}
          } finally {
            _internalNavigation = false;
          }
        } else {
          try { history.pushState(null, '', hash); } catch (_) {}
        }
      }
    }
    // aria-current on active nav button
    _navBtns.forEach(btn => btn.removeAttribute('aria-current'));
    if (name === 'setlists' || name === 'setlist-detail' || name === 'setlist-edit' || name === 'setlist-live') {
      document.getElementById('btn-setlists')?.setAttribute('aria-current', 'page');
    } else if (name === 'practice' || name === 'practice-detail' || name === 'practice-edit') {
      document.getElementById('btn-practice')?.setAttribute('aria-current', 'page');
    } else if (name === 'wikicharts' || name === 'wikichart-detail') {
      document.getElementById('btn-wikicharts')?.setAttribute('aria-current', 'page');
    } else if (name === 'messages') {
      document.getElementById('btn-messages')?.setAttribute('aria-current', 'page');
    }
    // Topbar refresh always hidden (PTR on main list handles refresh; desktop has search-refresh-btn)
    document.getElementById('btn-topbar-refresh')?.classList.add('hidden');
  };

  const skipTransition = Store.get('skipViewTransition');
  if (skipTransition) Store.set('skipViewTransition', false);
  if (alreadyActive || isFirstCall || _prefersReducedMotion.matches || skipTransition) {
    swap();
  } else if (document.startViewTransition) {
    // A1: Set nav direction class for directional slide transitions
    const isBack = Store.get('navDirection') === 'back';
    if (isBack) document.documentElement.classList.add('nav-back');
    try {
      const t = document.startViewTransition(swap);
      t.finished.then(() => {
        document.documentElement.classList.remove('nav-back');
        Store.set('navDirection', 'forward');
      }).catch(() => {
        document.documentElement.classList.remove('nav-back');
        Store.set('navDirection', 'forward');
      });
    } catch (_) {
      swap();
      document.documentElement.classList.remove('nav-back');
      Store.set('navDirection', 'forward');
    }
  } else {
    swap();
  }
}

/**
 * Update the topbar title and back button visibility.
 * @param {string} title - Title text or HTML
 * @param {boolean} showBack - Show the back arrow button
 * @param {boolean} [isHtml] - If true, title is set as innerHTML
 * @param {boolean} [isHome] - If true, only update version badge
 */
// Cache the original home HTML once at startup so setTopbar can restore it
let _homeHtml = null;
function setTopbar(title, showBack, isHtml, isHome) {
  const el = document.getElementById('topbar-title');
  if (el) {
    if (!_homeHtml && el.classList.contains('title-home')) _homeHtml = el.innerHTML;
    if (isHome && el.classList.contains('title-home')) {
      // Already showing home — just update version badge
      const badge = el.querySelector('#admin-version-badge');
      const ver = Store.get('APP_VERSION');
      if (badge && badge.textContent !== ver) badge.textContent = ver;
    } else if (isHome && _homeHtml) {
      // Returning home from a sub-view — restore original HTML
      el.innerHTML = _homeHtml;
      const badge = el.querySelector('#admin-version-badge');
      const ver = Store.get('APP_VERSION');
      if (badge && badge.textContent !== ver) badge.textContent = ver;
    } else {
      if (isHtml) el.innerHTML = title; else el.textContent = title;
    }
    el.classList.toggle('title-home', !!isHome);
  }
  document.getElementById('btn-back')?.classList.toggle('hidden', !showBack);
  document.getElementById('btn-setlists')?.classList.toggle('hidden', showBack);
  document.getElementById('btn-practice')?.classList.toggle('hidden', showBack);
  document.getElementById('btn-wikicharts')?.classList.toggle('hidden', showBack);
}

/**
 * Push a render function onto the navigation stack (for back button behavior).
 * @param {Function} renderFn - Function to call when navigating back
 */
function pushNav(renderFn) {
  const stack = Store.get('navStack');
  stack.push(renderFn);
  // Cap stack depth to prevent memory leaks from deep navigation chains
  if (stack.length > 20) stack.splice(0, stack.length - 20);
}

function navigateBack() {
  Store.set('navDirection', 'back');
  if (Metronome.isPlaying()) Metronome.stop();
  Player.stopAll();
  // Clean up live mode if active
  if (Store.get('liveModeActive') && Store.get('exitLiveModeRef')) {
    Store.get('exitLiveModeRef')();
    return;
  }
  // Note: live-mode-active and practice-mode-active classes are removed inside
  // showView's swap() callback (via cleanup hooks) so they're part of the view
  // transition and don't cause visible layout shifts before the crossfade.
  const navStack = Store.get('navStack');
  if (navStack.length > 0) {
    const prev = navStack.pop();
    if (typeof prev === 'function') prev();
    else if (_registry['list']) _registry['list']();
  } else if (_registry['list']) {
    // Navigation API: use navigation.back() for browser-level back
    if (_hasNavigationAPI && window.navigation.canGoBack) {
      try {
        window.navigation.back();
        return;
      } catch (_) { /* fall through to registry fallback */ }
    }
    _registry['list']();
  }
}

/**
 * Re-render the current view (e.g. after sync).
 * Uses the registry to find the appropriate render function.
 */
function rerenderCurrentView() {
  const view = Store.get('view');
  const fn = _registry[view];
  if (fn) fn({ rerender: true });
}

// ─── Navigation API intercept listener ──────────────────────
// Progressive enhancement: when the Navigation API is available, intercept
// same-document navigations via the 'navigate' event. This supplements (and
// in supporting browsers, supersedes) the popstate listener in app.js.

let _navigateListenerAttached = false;
let _internalNavigation = false;  // Guard to prevent re-entrant navigate events from showView

/**
 * Attach the Navigation API 'navigate' listener.
 * Safe to call multiple times — only attaches once.
 * Call after DOM + modules are ready (e.g. from app.js init).
 */
function initNavigationAPI() {
  if (!_hasNavigationAPI || _navigateListenerAttached) return;
  _navigateListenerAttached = true;

  try {
    window.navigation.addEventListener('navigate', (event) => {
      // Skip if this navigation was triggered by showView() itself (avoid re-entrant loop)
      if (_internalNavigation) return;
      // Only intercept same-origin, same-document hash navigations
      if (!event.canIntercept || event.hashChange === false) return;
      // Don't intercept downloads or form submissions
      if (event.downloadRequest || event.formData) return;
      // Don't intercept when live mode is active — it manages its own history state
      if (Store.get('liveModeActive')) return;

      const destUrl = new URL(event.destination.url);
      // Only handle navigations within our own origin
      if (destUrl.origin !== location.origin) return;

      const hash = destUrl.hash || '';
      const route = resolveHash(hash);

      event.intercept({
        handler() {
          // Mark as popstate-equivalent for back/forward traversals
          const isTraversal = event.navigationType === 'traverse';
          if (isTraversal) {
            Store.set('isPopstateNavigation', true);
            Store.set('navDirection', 'back');
            // Pop navStack entry to mirror popstate behavior
            const navStack = Store.get('navStack');
            if (navStack.length > 0) navStack.pop();
          }
          try {
            navigateToRoute(route);
          } finally {
            if (isTraversal) {
              Store.set('isPopstateNavigation', false);
            }
          }
        }
      });
    });
  } catch (_) {
    // Navigation API listener failed — popstate fallback remains active
  }
}

// ─── Public API ─────────────────────────────────────────────

export { register, registerHook, viewToHash, resolveHash, navigateToRoute, showView, setTopbar, pushNav, navigateBack, rerenderCurrentView, initNavigationAPI };
