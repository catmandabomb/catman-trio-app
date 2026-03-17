/**
 * store.js — Centralized application state
 *
 * Single source of truth for all mutable state. Modules read/write via
 * Store.get(key) / Store.set(key, val) or direct Store.state access.
 *
 * Phase 1: app.js keeps local `let` vars and syncs to Store at key boundaries.
 * Phase 4: View modules own state through Store directly.
 */

const Store = (() => {

  const _state = {
    // ─── Version / Schema ────────────────────────────────────
    APP_VERSION:        'v19.4',
    DATA_SCHEMA_VERSION: 1,

    // ─── Core data arrays ────────────────────────────────────
    songs:              [],
    setlists:           [],
    practice:           [],

    // ─── View / Navigation ───────────────────────────────────
    view:               'list',
    showViewCalled:     false,
    navStack:           [],
    isPopstateNavigation: false,
    currentRouteParams: {},

    // ─── Song list state ─────────────────────────────────────
    activeSong:         null,
    editSong:           null,
    editIsNew:          false,
    searchText:         '',
    activeTags:         [],
    activeKeys:         [],
    selectionMode:      false,
    selectedSongIds:    new Set(),

    // ─── Setlist state ───────────────────────────────────────
    activeSetlist:      null,
    editSetlist:        null,
    editSetlistIsNew:   false,
    showArchived:       false,
    liveModeActive:     false,
    exitLiveModeRef:    null,
    sortableSetlist:    null,

    // ─── Practice state ──────────────────────────────────────
    activePersona:      null,
    editPersona:        null,
    editPersonaIsNew:   false,
    activePracticeList: null,
    editPracticeList:   null,
    editPracticeListIsNew: false,
    practicePersona:    null,
    practiceList:       null,

    // ─── Sync / Save state ───────────────────────────────────
    syncing:            false,
    lastDriveSnapshot:  null,
    savingSongs:        false,
    savingSetlists:     false,
    savingPractice:     false,
    autoConfigAttempted: false,
    manualSyncHistory:  [],

    // ─── Cache / Blob state ──────────────────────────────────
    blobCache:          {},
    playerRefs:         [],
    cachedPdfSet:       new Set(),

    // ─── Render fingerprints (dedup) ─────────────────────────
    lastListFingerprint: '',
    lastTagBarFP:       '',
    lastKeyBarFP:       '',

    // ─── Detail view ─────────────────────────────────────────
    detailAnchorObserver: null,

    // ─── Misc ────────────────────────────────────────────────
    levWorker:          null,
    toastTimer:         null,
    deferredInstallPrompt: null,
  };

  // ─── Constants (immutable config, not state) ──────────────
  const _constants = {
    SYNC_COOLDOWN_MS:        10 * 60 * 1000,  // 10 minutes
    MANUAL_SYNC_COOLDOWN_MS: 10 * 1000,       // 10 seconds per 2 clicks
    TIME_SIGS: [
      { display: '4/4', beats: 4 },
      { display: '3/4', beats: 3 },
      { display: '6/8', beats: 6 },
      { display: '2/4', beats: 2 },
      { display: '5/4', beats: 5 },
      { display: '7/8', beats: 7 },
    ],
  };

  return {
    /**
     * Get a state value by key.
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      if (key in _constants) return _constants[key];
      return _state[key];
    },

    /**
     * Set a state value by key. Returns the new value.
     * @param {string} key
     * @param {*} val
     * @returns {*}
     */
    set(key, val) {
      _state[key] = val;
      return val;
    },

    /**
     * Direct access to the state object.
     * Use for Phase 1 backward-compat or when batch-reading many keys.
     */
    state: _state,

    /**
     * Read-only access to constants.
     */
    constants: _constants,
  };

})();
