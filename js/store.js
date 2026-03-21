/**
 * store.js — Centralized application state
 *
 * Single source of truth for all mutable state. Modules read/write via
 * get(key) / set(key, val) or direct state access.
 *
 * Phase 1: app.js keeps local `let` vars and syncs to Store at key boundaries.
 * Phase 4: View modules own state through Store directly.
 *
 * @module store
 */

/**
 * @typedef {Object} Song
 * @property {string} id - 4-digit hex ID
 * @property {string} title
 * @property {string} subtitle
 * @property {string} key - Musical key (e.g. "C", "Am")
 * @property {string} bpm
 * @property {string} timeSig - Time signature (e.g. "4/4")
 * @property {number} duration - Duration in seconds
 * @property {string[]} tags
 * @property {string} notes
 * @property {{ charts?: Array, audio?: Array, links?: Array }} assets
 * @property {Array<{driveId: string, order: number}>} chartOrder
 * @property {number} [version] - Optimistic locking version
 * @property {string} updatedAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Setlist
 * @property {string} id
 * @property {string} venue
 * @property {string} gigDate
 * @property {string} overrideTitle
 * @property {Array<{id: string, comment?: string}>} songs
 * @property {string} notes
 * @property {boolean} archived
 * @property {number} [version]
 * @property {string} updatedAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PracticeList
 * @property {string} id
 * @property {string} name
 * @property {string} createdBy
 * @property {Array} songs
 * @property {boolean} archived
 * @property {number} [version]
 * @property {string} updatedAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} TimeSig
 * @property {string} display - e.g. "4/4"
 * @property {number} beats - e.g. 4
 */

const _state = {
  // ─── Version / Schema ────────────────────────────────────
  APP_VERSION:        'v20.37',
  DATA_SCHEMA_VERSION: 1,

  // ─── Core data arrays ────────────────────────────────────
  songs:              [],
  setlists:           [],
  practice:           [],
  wikiCharts:         [],

  // ─── View / Navigation ───────────────────────────────────
  view:               'list',
  showViewCalled:     false,
  navStack:           [],
  navDirection:       'forward',
  isPopstateNavigation: false,
  skipViewTransition: false,
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
  activePracticeList: null,
  editPracticeList:   null,
  editPracticeListIsNew: false,
  practiceList:       null,

  // ─── WikiChart state ────────────────────────────────────
  activeWikiChart:    null,

  // ─── Orchestra state ──────────────────────────────────
  activeOrchestraId:    null,
  orchestras:           [],
  instrumentHierarchy:  null,   // { sections: [...] } cached tree
  userInstrumentId:     null,
  chartFilterMode:      'smart', // 'smart' | 'section' | 'all' | 'mine-only'
  orchestraSettings:    {},      // per-orchestra conductr settings (key-value)

  // ─── Sync / Save state ───────────────────────────────────
  syncing:            false,
  lastDriveSnapshot:  null,
  savingSongs:        false,
  savingSetlists:     false,
  savingPractice:     false,
  savingWikiCharts:   false,
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

/**
 * Get a state value by key.
 * @param {string} key
 * @returns {*}
 */
function get(key) {
  if (key in _constants) return _constants[key];
  return _state[key];
}

/**
 * Set a state value by key. Returns the new value.
 * @param {string} key
 * @param {*} val
 * @returns {*}
 */
function set(key, val) {
  _state[key] = val;
  return val;
}

/**
 * Direct access to the state object.
 * Use for Phase 1 backward-compat or when batch-reading many keys.
 */
const state = _state;

/**
 * Read-only access to constants.
 */
const constants = _constants;

export { get, set, state, constants };
