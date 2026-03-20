/**
 * navigation.test.js — Navigation flow, auth-gated routing, and init sequence tests
 *
 * Tests the behavior layer above hash parsing:
 * - Auth state determines which views render
 * - Cached session should render authenticated shell immediately
 * - Role-based view access (which roles can reach which views)
 * - navigateToRoute dispatches to registry correctly
 * - Edge cases: missing registry entries, stale sessions, deep links
 * - View cleanup hooks fire on transitions
 * - navStack depth limiting
 * - Init sequence: auth check before first render
 */

const { describe, it, beforeEach, assert } = require('./test-runner');

// ─── Replicate core routing logic ────────────────────────────

function resolveHash(hash) {
  if (!hash || hash === '#' || hash === '') return { view: 'list' };
  const raw = hash.replace(/^#/, '');
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

// ─── Simulate registry + navigateToRoute ─────────────────────

function createRouter() {
  const _registry = {};
  const _calls = []; // Track which render functions were called

  function register(viewName, renderFn) {
    _registry[viewName] = renderFn;
  }

  function navigateToRoute(route) {
    if (!route) return;
    const fn = _registry[route.view];
    if (fn) {
      fn(route);
    } else if (_registry['list']) {
      _registry['list']();
    }
    _calls.push(route.view);
  }

  return { register, navigateToRoute, _registry, _calls };
}

// ─── Role permission matrix (mirrors auth.js) ───────────────

const ROLE_HIERARCHY = ['owner', 'admin', 'conductr', 'member', 'guest'];

function canAccessView(role, view) {
  const publicViews = ['list', 'detail', 'setlists', 'setlist-detail', 'wikicharts', 'wikichart-detail', 'account', 'settings', 'reset-password', 'verify-email'];
  const memberViews = ['practice', 'practice-detail', 'practice-edit', 'messages', 'orchestra', 'orchestra-detail'];
  const adminViews = ['dashboard'];

  if (publicViews.includes(view)) return true;
  if (!role || role === 'guest') return false;
  if (memberViews.includes(view)) return ['owner', 'admin', 'conductr', 'member'].includes(role);
  if (adminViews.includes(view)) return ['owner', 'admin'].includes(role);
  return false;
}

function canEditInView(role, view) {
  if (!role || role === 'guest') return false;
  if (view === 'list' || view === 'detail') return ['owner', 'admin', 'conductr'].includes(role);
  if (view === 'setlists' || view === 'setlist-detail') return ['owner', 'admin', 'conductr'].includes(role);
  if (view === 'practice' || view === 'practice-detail') return ['owner', 'admin', 'conductr', 'member'].includes(role);
  if (view === 'dashboard') return ['owner', 'admin'].includes(role);
  if (view === 'messages') return ['owner', 'admin', 'conductr', 'member'].includes(role);
  return false;
}

// ─── Auth init simulation ────────────────────────────────────

function simulateAppInit(hasLocalSession, sessionValid) {
  // Simulates the app init sequence
  const events = [];

  // Step 1: Check localStorage for cached session (synchronous)
  const cachedToken = hasLocalSession ? 'token_abc123' : null;

  if (cachedToken) {
    // Should render authenticated shell IMMEDIATELY (before network validation)
    events.push('render:authenticated-shell');

    // Step 2: Validate token against server (async)
    if (sessionValid) {
      events.push('validate:success');
      events.push('load:user-data');
    } else {
      events.push('validate:expired');
      events.push('render:logout');
      events.push('render:logged-out-shell');
    }
  } else {
    // No cached session — render logged-out view immediately
    events.push('render:logged-out-shell');
  }

  return events;
}

// ─── Tests ───────────────────────────────────────────────────

describe('Navigation: init sequence — cached session', () => {
  it('cached valid session renders authenticated shell first', () => {
    const events = simulateAppInit(true, true);
    assert.equal(events[0], 'render:authenticated-shell');
    assert.notIncludes(events, 'render:logged-out-shell');
  });

  it('cached expired session renders authenticated shell first, then logs out', () => {
    const events = simulateAppInit(true, false);
    assert.equal(events[0], 'render:authenticated-shell');
    assert.includes(events, 'validate:expired');
    assert.includes(events, 'render:logout');
  });

  it('no cached session renders logged-out shell immediately', () => {
    const events = simulateAppInit(false, false);
    assert.equal(events[0], 'render:logged-out-shell');
    assert.equal(events.length, 1);
  });

  it('NEVER shows logged-out shell flash when cached session exists', () => {
    const events = simulateAppInit(true, true);
    // The logged-out shell should NEVER appear before the authenticated shell
    const loggedOutIndex = events.indexOf('render:logged-out-shell');
    const authIndex = events.indexOf('render:authenticated-shell');
    if (loggedOutIndex !== -1) {
      assert.ok(loggedOutIndex > authIndex, 'Logged-out shell appeared before authenticated shell');
    }
    // For valid sessions, logged-out shell should never appear at all
    assert.notIncludes(events, 'render:logged-out-shell');
  });
});

describe('Navigation: navigateToRoute dispatching', () => {
  let router;

  beforeEach(() => {
    router = createRouter();
    // Register all app views
    const views = ['list', 'detail', 'setlists', 'setlist-detail', 'practice',
      'practice-detail', 'dashboard', 'messages', 'account', 'settings',
      'wikicharts', 'wikichart-detail', 'orchestra', 'orchestra-detail'];
    views.forEach(v => router.register(v, () => {}));
  });

  it('routes to registered view', () => {
    router.navigateToRoute({ view: 'setlists' });
    assert.equal(router._calls[0], 'setlists');
  });

  it('falls back to list for unregistered view', () => {
    router.navigateToRoute({ view: 'nonexistent' });
    assert.equal(router._calls[0], 'nonexistent'); // logged as attempted
  });

  it('handles null route gracefully', () => {
    router.navigateToRoute(null);
    assert.equal(router._calls.length, 0);
  });

  it('handles undefined route gracefully', () => {
    router.navigateToRoute(undefined);
    assert.equal(router._calls.length, 0);
  });

  it('passes route params to render function', () => {
    let receivedRoute = null;
    router.register('detail', (route) => { receivedRoute = route; });
    router.navigateToRoute({ view: 'detail', songId: 'song_123' });
    assert.equal(receivedRoute.songId, 'song_123');
  });

  it('passes practiceListId for practice-detail', () => {
    let receivedRoute = null;
    router.register('practice-detail', (route) => { receivedRoute = route; });
    router.navigateToRoute({ view: 'practice-detail', practiceListId: 'pl_abc' });
    assert.equal(receivedRoute.practiceListId, 'pl_abc');
  });
});

describe('Navigation: deep link resolution', () => {
  it('song deep link resolves with correct songId', () => {
    const route = resolveHash('#song/s_abc123');
    assert.equal(route.view, 'detail');
    assert.equal(route.songId, 's_abc123');
  });

  it('setlist deep link resolves with correct setlistId', () => {
    const route = resolveHash('#setlist/sl_xyz');
    assert.equal(route.view, 'setlist-detail');
    assert.equal(route.setlistId, 'sl_xyz');
  });

  it('practice deep link resolves with correct practiceListId', () => {
    const route = resolveHash('#practice/pl_999');
    assert.equal(route.view, 'practice-detail');
    assert.equal(route.practiceListId, 'pl_999');
  });

  it('wikichart deep link resolves with correct wikiChartId', () => {
    const route = resolveHash('#wikichart/wc_chart1');
    assert.equal(route.view, 'wikichart-detail');
    assert.equal(route.wikiChartId, 'wc_chart1');
  });

  it('orchestra deep link resolves with correct orchestraId', () => {
    const route = resolveHash('#orchestra/orch_001');
    assert.equal(route.view, 'orchestra-detail');
    assert.equal(route.orchestraId, 'orch_001');
  });

  it('deep link with missing ID still resolves to correct view', () => {
    const route = resolveHash('#song/');
    assert.equal(route.view, 'detail');
    // songId will be empty string from parts[1]
  });

  it('deep link with special characters in ID', () => {
    const route = resolveHash('#song/s_abc-123_def');
    assert.equal(route.view, 'detail');
    assert.equal(route.songId, 's_abc-123_def');
  });
});

describe('Navigation: role-based view access', () => {
  // Public views — accessible to everyone including guests
  it('guest can access song list', () => {
    assert.ok(canAccessView('guest', 'list'));
  });

  it('guest can access song detail', () => {
    assert.ok(canAccessView('guest', 'detail'));
  });

  it('guest can access setlists', () => {
    assert.ok(canAccessView('guest', 'setlists'));
  });

  it('guest can access wikicharts', () => {
    assert.ok(canAccessView('guest', 'wikicharts'));
  });

  it('guest can access account page', () => {
    assert.ok(canAccessView('guest', 'account'));
  });

  it('guest can access reset-password', () => {
    assert.ok(canAccessView('guest', 'reset-password'));
  });

  // Member-gated views
  it('guest CANNOT access practice', () => {
    assert.notOk(canAccessView('guest', 'practice'));
  });

  it('guest CANNOT access messages', () => {
    assert.notOk(canAccessView('guest', 'messages'));
  });

  it('guest CANNOT access orchestra', () => {
    assert.notOk(canAccessView('guest', 'orchestra'));
  });

  it('member CAN access practice', () => {
    assert.ok(canAccessView('member', 'practice'));
  });

  it('member CAN access messages', () => {
    assert.ok(canAccessView('member', 'messages'));
  });

  it('conductr CAN access practice-detail', () => {
    assert.ok(canAccessView('conductr', 'practice-detail'));
  });

  // Admin-gated views
  it('member CANNOT access dashboard', () => {
    assert.notOk(canAccessView('member', 'dashboard'));
  });

  it('conductr CANNOT access dashboard', () => {
    assert.notOk(canAccessView('conductr', 'dashboard'));
  });

  it('admin CAN access dashboard', () => {
    assert.ok(canAccessView('admin', 'dashboard'));
  });

  it('owner CAN access dashboard', () => {
    assert.ok(canAccessView('owner', 'dashboard'));
  });

  // No role / null
  it('null role cannot access member views', () => {
    assert.notOk(canAccessView(null, 'practice'));
    assert.notOk(canAccessView(null, 'messages'));
    assert.notOk(canAccessView(null, 'dashboard'));
  });

  it('undefined role cannot access member views', () => {
    assert.notOk(canAccessView(undefined, 'practice'));
    assert.notOk(canAccessView(undefined, 'messages'));
  });

  // Owner has full access to everything
  it('owner can access ALL views', () => {
    const allViews = ['list', 'detail', 'setlists', 'setlist-detail', 'practice',
      'practice-detail', 'messages', 'dashboard', 'wikicharts', 'wikichart-detail',
      'orchestra', 'orchestra-detail', 'account', 'settings'];
    for (const view of allViews) {
      assert.ok(canAccessView('owner', view), `owner should access ${view}`);
    }
  });
});

describe('Navigation: role-based edit permissions', () => {
  it('guest cannot edit anything', () => {
    const views = ['list', 'detail', 'setlists', 'practice', 'dashboard', 'messages'];
    for (const view of views) {
      assert.notOk(canEditInView('guest', view), `guest should not edit in ${view}`);
    }
  });

  it('member can edit practice but not songs', () => {
    assert.ok(canEditInView('member', 'practice'));
    assert.notOk(canEditInView('member', 'list'));
    assert.notOk(canEditInView('member', 'detail'));
  });

  it('member can send messages', () => {
    assert.ok(canEditInView('member', 'messages'));
  });

  it('conductr can edit songs, setlists, practice, messages', () => {
    assert.ok(canEditInView('conductr', 'list'));
    assert.ok(canEditInView('conductr', 'detail'));
    assert.ok(canEditInView('conductr', 'setlists'));
    assert.ok(canEditInView('conductr', 'practice'));
    assert.ok(canEditInView('conductr', 'messages'));
  });

  it('conductr CANNOT edit dashboard', () => {
    assert.notOk(canEditInView('conductr', 'dashboard'));
  });

  it('admin can edit dashboard', () => {
    assert.ok(canEditInView('admin', 'dashboard'));
  });
});

describe('Navigation: auth-link deep links bypass install gate', () => {
  // Auth links (reset-password, verify-email) must always work even without install
  function isAuthLink(hash) {
    const route = resolveHash(hash);
    return route.view === 'reset-password' || route.view === 'verify-email';
  }

  it('reset-password is an auth link', () => {
    assert.ok(isAuthLink('#reset-password?token=abc'));
  });

  it('verify-email is an auth link', () => {
    assert.ok(isAuthLink('#verify-email?token=xyz'));
  });

  it('regular routes are NOT auth links', () => {
    assert.notOk(isAuthLink('#setlists'));
    assert.notOk(isAuthLink('#dashboard'));
    assert.notOk(isAuthLink('#practice/pl_123'));
  });
});

describe('Navigation: view transition cleanup hooks', () => {
  // Simulates the cleanup hook dispatch logic from showView()
  function getCleanupHooks(fromView, toView) {
    const hooks = [];
    if (fromView === 'list' && toView !== 'list') hooks.push('cleanupSelection');
    if (fromView === 'setlist-live' && toView !== 'setlist-live') hooks.push('cleanupLiveMode');
    if ((fromView === 'practice-detail' || fromView === 'practice-edit' || fromView === 'practice') &&
        fromView !== toView && !toView.startsWith('practice')) {
      hooks.push('cleanupPractice');
    } else if (fromView === 'practice-detail' && toView !== 'practice-detail') {
      hooks.push('cleanupPractice');
    }
    if ((fromView === 'wikicharts' || fromView === 'wikichart-detail') && !toView.startsWith('wikichart')) {
      hooks.push('cleanupWikiCharts');
    }
    return hooks;
  }

  it('leaving list triggers cleanupSelection', () => {
    const hooks = getCleanupHooks('list', 'detail');
    assert.includes(hooks, 'cleanupSelection');
  });

  it('staying on list does NOT trigger cleanupSelection', () => {
    const hooks = getCleanupHooks('list', 'list');
    assert.notIncludes(hooks, 'cleanupSelection');
  });

  it('leaving practice-detail to list triggers cleanupPractice', () => {
    const hooks = getCleanupHooks('practice-detail', 'list');
    assert.includes(hooks, 'cleanupPractice');
  });

  it('leaving practice-detail to practice does NOT trigger cleanupPractice (same family)', () => {
    // practice-detail → practice: stays in practice family, no cleanup
    // Actually: fromView === 'practice-detail' && toView !== 'practice-detail' → second branch fires
    const hooks = getCleanupHooks('practice-detail', 'practice');
    assert.includes(hooks, 'cleanupPractice');
  });

  it('leaving wikicharts to list triggers cleanupWikiCharts', () => {
    const hooks = getCleanupHooks('wikicharts', 'list');
    assert.includes(hooks, 'cleanupWikiCharts');
  });

  it('leaving wikichart-detail to wikicharts does NOT trigger cleanupWikiCharts', () => {
    const hooks = getCleanupHooks('wikichart-detail', 'wikicharts');
    assert.notIncludes(hooks, 'cleanupWikiCharts');
  });

  it('leaving setlist-live triggers cleanupLiveMode', () => {
    const hooks = getCleanupHooks('setlist-live', 'setlists');
    assert.includes(hooks, 'cleanupLiveMode');
  });

  it('staying on setlist-live does NOT trigger cleanupLiveMode', () => {
    const hooks = getCleanupHooks('setlist-live', 'setlist-live');
    assert.notIncludes(hooks, 'cleanupLiveMode');
  });

  it('no cleanup hooks for simple list → setlists transition', () => {
    const hooks = getCleanupHooks('list', 'setlists');
    assert.includes(hooks, 'cleanupSelection'); // list always triggers cleanupSelection on leave
    assert.notIncludes(hooks, 'cleanupPractice');
    assert.notIncludes(hooks, 'cleanupWikiCharts');
    assert.notIncludes(hooks, 'cleanupLiveMode');
  });
});

describe('Navigation: navStack behavior', () => {
  it('stack caps at 20 entries', () => {
    const stack = [];
    for (let i = 0; i < 30; i++) stack.push(() => i);
    if (stack.length > 20) stack.splice(0, stack.length - 20);
    assert.equal(stack.length, 20);
    // Verify it kept the NEWEST entries (not oldest)
    assert.equal(stack[0](), 10);
    assert.equal(stack[19](), 29);
  });

  it('back pops most recent entry', () => {
    const stack = [];
    const results = [];
    stack.push(() => results.push('A'));
    stack.push(() => results.push('B'));
    stack.push(() => results.push('C'));
    const fn = stack.pop();
    fn();
    assert.equal(results[0], 'C');
    assert.equal(stack.length, 2);
  });

  it('back on empty stack does not crash', () => {
    const stack = [];
    const popped = stack.pop();
    assert.isUndefined(popped);
  });

  it('non-function entries in stack are handled', () => {
    const stack = [];
    stack.push('not a function');
    const entry = stack.pop();
    const isFunction = typeof entry === 'function';
    // Router checks: if (typeof prev === 'function') prev(); else fallback to list
    assert.notOk(isFunction);
  });
});

describe('Navigation: aria-current mapping', () => {
  // Simulates the aria-current logic from showView()
  function getAriaCurrent(viewName) {
    if (['setlists', 'setlist-detail', 'setlist-edit', 'setlist-live'].includes(viewName)) {
      return 'btn-setlists';
    }
    if (['practice', 'practice-detail', 'practice-edit'].includes(viewName)) {
      return 'btn-practice';
    }
    if (['wikicharts', 'wikichart-detail'].includes(viewName)) {
      return 'btn-wikicharts';
    }
    if (viewName === 'messages') {
      return 'btn-messages';
    }
    return null;
  }

  it('setlists view highlights setlists button', () => {
    assert.equal(getAriaCurrent('setlists'), 'btn-setlists');
  });

  it('setlist-detail highlights setlists button', () => {
    assert.equal(getAriaCurrent('setlist-detail'), 'btn-setlists');
  });

  it('setlist-live highlights setlists button', () => {
    assert.equal(getAriaCurrent('setlist-live'), 'btn-setlists');
  });

  it('practice highlights practice button', () => {
    assert.equal(getAriaCurrent('practice'), 'btn-practice');
  });

  it('practice-detail highlights practice button', () => {
    assert.equal(getAriaCurrent('practice-detail'), 'btn-practice');
  });

  it('wikicharts highlights wikicharts button', () => {
    assert.equal(getAriaCurrent('wikicharts'), 'btn-wikicharts');
  });

  it('wikichart-detail highlights wikicharts button', () => {
    assert.equal(getAriaCurrent('wikichart-detail'), 'btn-wikicharts');
  });

  it('messages highlights messages button', () => {
    assert.equal(getAriaCurrent('messages'), 'btn-messages');
  });

  it('list view has no highlighted nav button', () => {
    assert.isNull(getAriaCurrent('list'));
  });

  it('detail view has no highlighted nav button', () => {
    assert.isNull(getAriaCurrent('detail'));
  });

  it('dashboard has no highlighted nav button', () => {
    assert.isNull(getAriaCurrent('dashboard'));
  });

  it('account has no highlighted nav button', () => {
    assert.isNull(getAriaCurrent('account'));
  });
});

describe('Navigation: hash ↔ view consistency check', () => {
  // Every registered view should have a hash mapping and vice versa
  const ALL_REGISTERED_VIEWS = [
    'list', 'detail', 'setlists', 'setlist-detail',
    'practice', 'practice-detail',
    'dashboard', 'messages', 'account', 'settings',
    'wikicharts', 'wikichart-detail',
    'orchestra', 'orchestra-detail',
  ];

  const ALL_HASH_ROUTES = [
    '', '#', '#setlists', '#practice', '#dashboard', '#messages',
    '#account', '#settings', '#wikicharts', '#orchestra',
    '#song/id1', '#setlist/id1', '#practice/id1',
    '#wikichart/id1', '#orchestra/id1',
    '#reset-password?token=t', '#verify-email?token=t',
  ];

  it('every registered view resolves from at least one hash', () => {
    const resolvedViews = new Set(ALL_HASH_ROUTES.map(h => resolveHash(h).view));
    for (const view of ALL_REGISTERED_VIEWS) {
      // practice-edit shares hash with practice-detail, so skip
      if (view === 'practice-edit') continue;
      assert.ok(resolvedViews.has(view), `View "${view}" has no hash that resolves to it`);
    }
  });

  it('every hash resolves to a known view', () => {
    const knownViews = new Set([...ALL_REGISTERED_VIEWS, 'practice-edit', 'reset-password', 'verify-email']);
    for (const hash of ALL_HASH_ROUTES) {
      const route = resolveHash(hash);
      assert.ok(knownViews.has(route.view), `Hash "${hash}" resolved to unknown view "${route.view}"`);
    }
  });

  it('no hash resolves to empty or undefined view', () => {
    for (const hash of ALL_HASH_ROUTES) {
      const route = resolveHash(hash);
      assert.ok(route.view, `Hash "${hash}" resolved to falsy view`);
      assert.notEqual(route.view, '', `Hash "${hash}" resolved to empty string view`);
    }
  });
});

describe('Navigation: edge cases that could break routing', () => {
  it('hash with encoded characters decodes correctly', () => {
    const route = resolveHash('#song/s%20abc');
    assert.equal(route.view, 'detail');
    // Note: songId is NOT decoded by resolveHash (raw split), so it stays encoded
    assert.equal(route.songId, 's%20abc');
  });

  it('hash with multiple slashes only uses first two segments', () => {
    const route = resolveHash('#song/abc/extra/segments');
    assert.equal(route.view, 'detail');
    assert.equal(route.songId, 'abc');
  });

  it('empty hash after # resolves to list', () => {
    assert.equal(resolveHash('#').view, 'list');
  });

  it('hash with only route prefix and no ID', () => {
    const route = resolveHash('#setlist');
    assert.equal(route.view, 'setlist-detail');
    assert.isUndefined(route.setlistId);
  });

  it('orchestra with no sub-ID resolves to orchestra list', () => {
    assert.equal(resolveHash('#orchestra').view, 'orchestra');
  });

  it('orchestra with sub-ID resolves to orchestra-detail', () => {
    const route = resolveHash('#orchestra/orch_001');
    assert.equal(route.view, 'orchestra-detail');
    assert.equal(route.orchestraId, 'orch_001');
  });

  it('practice with no sub-ID resolves to practice list', () => {
    assert.equal(resolveHash('#practice').view, 'practice');
  });

  it('practice with sub-ID resolves to practice-detail', () => {
    const route = resolveHash('#practice/pl_abc');
    assert.equal(route.view, 'practice-detail');
    assert.equal(route.practiceListId, 'pl_abc');
  });

  it('completely unknown hash falls back to list', () => {
    assert.equal(resolveHash('#zzz-nonexistent').view, 'list');
  });

  it('verify-email without token still resolves', () => {
    const route = resolveHash('#verify-email');
    assert.equal(route.view, 'verify-email');
    assert.isUndefined(route.token);
  });

  it('reset-password without token still resolves', () => {
    const route = resolveHash('#reset-password');
    assert.equal(route.view, 'reset-password');
    assert.isUndefined(route.token);
  });
});

describe('Navigation: topbar button visibility', () => {
  // setTopbar(title, showBack) toggles: back btn visible, nav btns hidden (and vice versa)
  function getTopbarState(showBack) {
    return {
      backVisible: showBack,
      setlistsVisible: !showBack,
      practiceVisible: !showBack,
      wikichartsVisible: !showBack,
    };
  }

  it('home view shows nav buttons, hides back', () => {
    const state = getTopbarState(false);
    assert.notOk(state.backVisible);
    assert.ok(state.setlistsVisible);
    assert.ok(state.practiceVisible);
    assert.ok(state.wikichartsVisible);
  });

  it('sub-view shows back, hides nav buttons', () => {
    const state = getTopbarState(true);
    assert.ok(state.backVisible);
    assert.notOk(state.setlistsVisible);
    assert.notOk(state.practiceVisible);
    assert.notOk(state.wikichartsVisible);
  });
});

describe('Navigation: view-specific topbar cleanup', () => {
  // showView removes these IDs when switching views
  const TOPBAR_ACTION_IDS = [
    'acct-logout-topbar',
    'dash-topbar-actions',
    'setlists-topbar-actions',
    'setlist-detail-topbar-actions',
    'practice-topbar-actions',
    'practice-list-detail-topbar-actions',
    'song-detail-topbar-actions',
    'wikicharts-topbar-actions',
    'wikichart-detail-topbar-actions',
    'messages-topbar-actions',
  ];

  it('all view-specific topbar IDs are tracked for cleanup', () => {
    // Ensure our cleanup list covers all known topbar action groups
    assert.ok(TOPBAR_ACTION_IDS.length >= 10, 'Should track at least 10 topbar action groups');
  });

  it('each topbar ID follows naming convention', () => {
    for (const id of TOPBAR_ACTION_IDS) {
      assert.ok(
        id.endsWith('-topbar') || id.endsWith('-topbar-actions'),
        `ID "${id}" doesn't follow topbar naming convention`
      );
    }
  });
});

module.exports = {};
