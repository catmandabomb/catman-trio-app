/**
 * store.test.js — Tests for js/store.js (state management)
 */

const { describe, it, beforeEach, assert } = require('./test-runner');
const { setupGlobals, resetAll } = require('./mocks');

// Since store.js is an ES module, we replicate its logic for testing
// (the actual module uses import/export which can't be required directly)

function createStore() {
  const _state = {
    APP_VERSION: 'v20.23',
    DATA_SCHEMA_VERSION: 1,
    songs: [],
    setlists: [],
    practice: [],
    wikiCharts: [],
    view: 'list',
    showViewCalled: false,
    navStack: [],
    navDirection: 'forward',
    isPopstateNavigation: false,
    skipViewTransition: false,
    currentRouteParams: {},
    activeSong: null,
    editSong: null,
    editIsNew: false,
    searchText: '',
    activeTags: [],
    activeKeys: [],
    selectionMode: false,
    selectedSongIds: new Set(),
    activeSetlist: null,
    editSetlist: null,
    showArchived: false,
    liveModeActive: false,
    syncing: false,
    lastDriveSnapshot: null,
    blobCache: {},
    playerRefs: [],
    cachedPdfSet: new Set(),
    toastTimer: null,
    manualSyncHistory: [],
    activeOrchestraId: null,
    orchestras: [],
    instrumentHierarchy: null,
    userInstrumentId: null,
    chartFilterMode: 'smart',
  };

  const _constants = {
    SYNC_COOLDOWN_MS: 10 * 60 * 1000,
    MANUAL_SYNC_COOLDOWN_MS: 10 * 1000,
    TIME_SIGS: [
      { display: '4/4', beats: 4 },
      { display: '3/4', beats: 3 },
      { display: '6/8', beats: 6 },
      { display: '2/4', beats: 2 },
      { display: '5/4', beats: 5 },
      { display: '7/8', beats: 7 },
    ],
  };

  function get(key) {
    if (key in _constants) return _constants[key];
    return _state[key];
  }

  function set(key, val) {
    _state[key] = val;
    return val;
  }

  return { get, set, state: _state, constants: _constants };
}

// ─── Tests ───────────────────────────────────────────────────

describe('Store — get/set basics', () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it('get returns initial state values', () => {
    assert.equal(store.get('view'), 'list');
    assert.deepEqual(store.get('songs'), []);
    assert.equal(store.get('syncing'), false);
    assert.isNull(store.get('activeSong'));
  });

  it('set updates state and returns new value', () => {
    const result = store.set('view', 'detail');
    assert.equal(result, 'detail');
    assert.equal(store.get('view'), 'detail');
  });

  it('set overwrites previous value', () => {
    store.set('searchText', 'hello');
    store.set('searchText', 'world');
    assert.equal(store.get('searchText'), 'world');
  });

  it('set can store any type', () => {
    store.set('songs', [{ id: '1', title: 'Test' }]);
    assert.equal(store.get('songs').length, 1);
    store.set('activeSong', { id: 'abc' });
    assert.equal(store.get('activeSong').id, 'abc');
    store.set('syncing', true);
    assert.equal(store.get('syncing'), true);
  });

  it('set can store null, undefined, 0, empty string', () => {
    store.set('activeSong', null);
    assert.isNull(store.get('activeSong'));
    store.set('activeSong', undefined);
    assert.isUndefined(store.get('activeSong'));
    store.set('searchText', '');
    assert.equal(store.get('searchText'), '');
    store.set('toastTimer', 0);
    assert.equal(store.get('toastTimer'), 0);
  });
});

describe('Store — constants', () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it('get returns constant values', () => {
    assert.equal(store.get('SYNC_COOLDOWN_MS'), 600000);
    assert.equal(store.get('MANUAL_SYNC_COOLDOWN_MS'), 10000);
  });

  it('TIME_SIGS has expected entries', () => {
    const ts = store.get('TIME_SIGS');
    assert.equal(ts.length, 6);
    assert.equal(ts[0].display, '4/4');
    assert.equal(ts[0].beats, 4);
    assert.equal(ts[1].display, '3/4');
    assert.equal(ts[1].beats, 3);
  });

  it('constants take priority over state keys of same name', () => {
    // If someone tries to set a constant key, it writes to state
    // but get() still returns the constant
    store.set('SYNC_COOLDOWN_MS', 999);
    assert.equal(store.get('SYNC_COOLDOWN_MS'), 600000);
  });
});

describe('Store — state object direct access', () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it('state object reflects get/set changes', () => {
    store.set('view', 'setlists');
    assert.equal(store.state.view, 'setlists');
  });

  it('direct state mutation is visible via get()', () => {
    store.state.view = 'dashboard';
    assert.equal(store.get('view'), 'dashboard');
  });

  it('navStack is mutable by reference', () => {
    const stack = store.get('navStack');
    stack.push(() => {});
    assert.equal(store.get('navStack').length, 1);
  });
});

describe('Store — initial state integrity', () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it('APP_VERSION matches expected format', () => {
    assert.match(store.get('APP_VERSION'), /^v\d+\.\d+$/);
  });

  it('all array states initialize empty', () => {
    assert.deepEqual(store.get('songs'), []);
    assert.deepEqual(store.get('setlists'), []);
    assert.deepEqual(store.get('practice'), []);
    assert.deepEqual(store.get('wikiCharts'), []);
    assert.deepEqual(store.get('activeTags'), []);
    assert.deepEqual(store.get('activeKeys'), []);
    assert.deepEqual(store.get('navStack'), []);
    assert.deepEqual(store.get('playerRefs'), []);
    assert.deepEqual(store.get('manualSyncHistory'), []);
    assert.deepEqual(store.get('orchestras'), []);
  });

  it('boolean states initialize to false', () => {
    assert.equal(store.get('showViewCalled'), false);
    assert.equal(store.get('isPopstateNavigation'), false);
    assert.equal(store.get('skipViewTransition'), false);
    assert.equal(store.get('selectionMode'), false);
    assert.equal(store.get('showArchived'), false);
    assert.equal(store.get('liveModeActive'), false);
    assert.equal(store.get('syncing'), false);
  });

  it('get on non-existent key returns undefined', () => {
    assert.isUndefined(store.get('nonExistentKey'));
  });

  it('navDirection starts as forward', () => {
    assert.equal(store.get('navDirection'), 'forward');
  });

  it('chartFilterMode defaults to smart', () => {
    assert.equal(store.get('chartFilterMode'), 'smart');
  });
});

module.exports = {};
