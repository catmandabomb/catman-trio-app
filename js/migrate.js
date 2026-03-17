/**
 * migrate.js — One-time storage key migrations
 *
 * Runs synchronously before app.js init. Each migration is gated by a
 * "done" flag so it only executes once per device.
 *
 * Add new migrations at the bottom. Never remove old ones — they're
 * no-ops on devices that already ran them.
 */

const Migrate = (() => {
  'use strict';

  /**
   * v19.7: Rename bb_ → ct_ localStorage/sessionStorage keys.
   * The app was originally called "BandBook" — rebranded to Catman Trio.
   */
  function _bbToCt() {
    if (localStorage.getItem('ct_keys_migrated')) return;
    const lsMap = {
      'bb_install_dismissed': 'ct_install_dismissed',
      'bb_welcome_seen': 'ct_welcome_seen',
      'bb_ptr_seen': 'ct_ptr_seen',
      'bb_last_synced': 'ct_last_synced',
      'bb_migrated_to_github': 'ct_migrated_to_github',
      'bb_songs': 'ct_songs',
      'bb_setlists': 'ct_setlists',
      'bb_practice': 'ct_practice',
      'bb_github_pending': 'ct_github_pending',
      'bb_github_deletions': 'ct_github_deletions',
      'bb_github_pat': 'ct_github_pat',
      'bb_github_owner': 'ct_github_owner',
      'bb_github_repo': 'ct_github_repo',
      'bb_pw_hash': 'ct_pw_hash',
      'bb_schema_songs': 'ct_schema_songs',
      'bb_schema_setlists': 'ct_schema_setlists',
      'bb_schema_practice': 'ct_schema_practice',
      'bb_last_sync': 'ct_last_sync',
    };
    const ssMap = {
      'bb_refresh_times': 'ct_refresh_times',
      'bb_live_dark_mode': 'ct_live_dark_mode',
      'bb_live_half_page': 'ct_live_half_page',
      'bb_live_auto_secs': 'ct_live_auto_secs',
      'bb_live_state': 'ct_live_state',
      'bb_admin_active': 'ct_admin_active',
    };
    try {
      for (const [oldKey, newKey] of Object.entries(lsMap)) {
        const val = localStorage.getItem(oldKey);
        if (val !== null && localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, val);
        }
        localStorage.removeItem(oldKey);
      }
    } catch (_) {}
    try {
      for (const [oldKey, newKey] of Object.entries(ssMap)) {
        const val = sessionStorage.getItem(oldKey);
        if (val !== null && sessionStorage.getItem(newKey) === null) {
          sessionStorage.setItem(newKey, val);
        }
        sessionStorage.removeItem(oldKey);
      }
    } catch (_) {}
    try { localStorage.setItem('ct_keys_migrated', '1'); } catch (_) {}
  }

  /**
   * Run all migrations. Called once at app startup before init.
   */
  function runAll() {
    _bbToCt();
  }

  return { runAll };
})();
