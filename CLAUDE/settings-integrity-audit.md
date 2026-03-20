# Settings Integrity Audit — Catman Trio App v20.22

**Date**: 2026-03-20
**Scope**: localStorage keys, settings persistence, role-gated features, data corruption risks
**Auditor**: Claude Opus 4.6

---

## Complete localStorage Key Inventory

### Preference keys (`ct_pref_*`) — Settings page
| Key | Default | Written by | Read by |
|-----|---------|-----------|---------|
| `ct_pref_lm_dark_default` | `'0'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_half_default` | `'0'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_auto_hide` | `'0'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_auto_hide_delay` | `'4'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_auto_advance_secs` | `'30'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_show_nav_buttons` | `'1'` | app.js settings | setlists.js live mode |
| `ct_pref_live_show_dark` | `'1'` | app.js settings | setlists.js live mode |
| `ct_pref_live_show_halfpage` | `'1'` | app.js settings | setlists.js live mode |
| `ct_pref_live_show_autoadvance` | `'1'` | app.js settings | setlists.js live mode |
| `ct_pref_live_show_redmode` | `'1'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_stage_red` | `'0'` | app.js settings | setlists.js live mode |
| `ct_pref_lm_rehearsal_notes` | `'0'` | app.js settings | setlists.js live mode |
| `ct_pref_tf_default_pitch` | `'0'` | app.js settings | practice.js tuning fork |
| `ct_pref_date_format` | `'relative'` | app.js settings | **NOWHERE** (see Finding #1) |
| `ct_pref_list_density` | `'normal'` | app.js settings | songs.js `renderList()` |
| `ct_pref_notif_sync_conflict` | `'1'` | app.js settings | **NOWHERE** (see Finding #1) |
| `ct_pref_push_enabled` | `'0'` | app.js settings | app.js settings (read-back only) |
| `ct_pref_setlist_insights` | `'1'` | app.js settings | **NOWHERE** (see Finding #2) |
| `ct_pref_wc_fontsize` | `'18'` | app.js settings + wikicharts.js | wikicharts.js detail view |
| `ct_pref_wc_scroll_speed` | `'1'` | app.js settings | wikicharts.js (module init + detail) |
| `ct_pref_wc_condensed` | `'false'` | wikicharts.js (detail toggle) | wikicharts.js (module init) |
| `ct_pref_wc_slashes` | `'false'` | wikicharts.js (detail toggle) | wikicharts.js (module init) |
| `ct_pref_wc_playback_mute_metro` | `'false'` | wikicharts.js (detail toggle) | wikicharts.js (module init) |
| `ct_pref_wc_section_colors` | `'1'` | app.js settings | wikicharts.js detail view |
| `ct_pref_wc_metro_vol` | `'50'` | app.js settings | wikicharts.js `_getMetroVol()` |
| `ct_pref_wc_metro_sound` | `'click'` | app.js settings | wikicharts.js `_getMetroSound()` |

### Dynamic keys (per-song/per-entity)
| Key pattern | Growth | Written by | Read by |
|-------------|--------|-----------|---------|
| `ct_audio_speed_{songId}` | 1 per song practiced at non-1x speed | player.js (practice only) | player.js (practice only) |
| `ct_last_played` | Single JSON object, grows with song count | setlists.js `_exitLiveMode()` | **NOWHERE** (see Finding #2) |

### System keys (non-preference)
| Key | Purpose |
|-----|---------|
| `ct_auth` | Session token + user object |
| `ct_pw_hash` | Legacy password hash (removed on logout) |
| `ct_session` | Legacy session ref (removed on account delete) |
| `ct_volume` | Audio player volume (0-1) |
| `ct_install_dismissed` | PWA install banner dismissed flag |
| `ct_welcome_seen` | Welcome modal seen flag |
| `ct_shared_pdf` | Last shared PDF filename + timestamp |
| `ct_last_open` | Last app open timestamp |
| `ct_ptr_seen` | Pull-to-refresh tutorial seen |
| `ct_error_log` | JSON array of last 50 errors |
| `ct_last_synced` | Last successful sync timestamp |
| `ct_github_pat` | GitHub PAT (legacy) |
| `ct_github_owner` | GitHub repo owner (legacy) |
| `ct_github_repo` | GitHub repo name (legacy) |
| `ct_github_pending` | Pending GitHub writes (crash recovery) |
| `ct_github_deletions` | Pending GitHub deletions (crash recovery) |
| `ct_migrated_to_github` | Migration flag |
| `ct_api_key` | Google Drive API key (legacy) |
| `ct_client_id` | Google Drive client ID (legacy) |
| `ct_folder_id` | Google Drive folder ID (legacy) |
| `ct_access_token` | Google Drive OAuth token (legacy) |
| `ct_token_expiry` | Google Drive token expiry (legacy) |

---

## Findings

### Finding #1: Dead Settings (saved but never consumed)
**Risk**: LOW
**Keys affected**: `ct_pref_date_format`, `ct_pref_notif_sync_conflict`

These preferences are saved via the settings page but no code reads them to change behavior:

- **`ct_pref_date_format`**: The settings page lets users pick "Relative / Short / ISO" but no rendering code in `songs.js`, `setlists.js`, or `utils.js` reads this preference. Dates are always rendered the same way regardless of this setting.
- **`ct_pref_notif_sync_conflict`**: Saved in settings but no sync code checks this flag before showing conflict toasts.

**Impact**: No data corruption. Users toggle a setting and nothing happens -- this is a UX integrity issue rather than a data safety issue. The settings are harmlessly stored.

**Recommendation**: Either wire these settings to actual behavior or remove them from the settings page to avoid user confusion.

---

### Finding #2: `ct_pref_setlist_insights` -- Setting Without a Consumer
**Risk**: LOW (functional gap, not corruption risk)

The "Setlist Insights" toggle under Conductr Tools saves `ct_pref_setlist_insights` to localStorage, but **no code anywhere in `setlists.js` reads this preference**. The `ct_last_played` data IS being written (on live mode exit), but nothing reads `ct_last_played` to display insights either.

This means:
1. The setting does nothing -- toggling it has no visible effect.
2. `ct_last_played` data accumulates but is never displayed.
3. The feature appears to be **partially implemented**: the data collection and settings toggle exist, but the display layer (showing last-played dates, duplicate warnings, key flow indicators) was never built.

**Impact**: No data corruption. Orphaned data in `ct_last_played` (see Finding #4).

**Recommendation**: Either complete the Setlist Insights display feature or remove the toggle and stop writing `ct_last_played` data.

---

### Finding #3: Orphaned `ct_audio_speed_*` Keys from Pre-`persistSpeed` Era
**Risk**: NONE

Analysis of the current code shows:
- `player.js` only reads/writes `ct_audio_speed_{songId}` when BOTH `songId` AND `persistSpeed` are truthy (lines 323, 341).
- Only `practice.js` passes `persistSpeed: true` (line 1096).
- `songs.js` passes `songId: driveId` but does NOT pass `persistSpeed` (line 871).
- When speed returns to 1x, the key is explicitly deleted via `localStorage.removeItem()` (line 345).

**If any `ct_audio_speed_*` keys existed before the `persistSpeed` flag was introduced**: They would be truly orphaned -- never read, never cleaned up. However:
- They are tiny (key + a 3-character float value like `0.7`).
- Even hundreds of them would be under 10KB total.
- They cause zero functional side effects since the non-practice player ignores them entirely.
- The practice player WILL read them, which is actually correct behavior -- it restores the user's last practice speed for that song.

**Impact**: None. The orphaned keys are harmless and will eventually be cleaned up naturally as users practice those songs and return speed to 1x.

**Recommendation**: No action needed. If a clean sweep is desired, a one-time migration could iterate `localStorage` keys and remove any `ct_audio_speed_*` entries, but this is unnecessary.

---

### Finding #4: `ct_last_played` Unbounded Growth
**Risk**: MEDIUM

The `ct_last_played` key stores a JSON object mapping song IDs and setlist IDs to ISO timestamps. Every time a user exits live mode, ALL songs in that setlist plus the setlist ID itself are written:

```js
const log = JSON.parse(localStorage.getItem('ct_last_played') || '{}');
for (const id of _lmSongIds) { log[id] = now; }
if (_lmSetlistId) log[`setlist:${_lmSetlistId}`] = now;
localStorage.setItem('ct_last_played', JSON.stringify(log));
```

This object **never shrinks**. Over time:
- With 200 songs and 50 setlists, the object reaches ~15KB.
- With 1000 songs across multiple orchestras, it could reach ~60KB.
- Deleted songs/setlists leave orphaned entries that are never pruned.

Additionally, this data is **never read by any feature** (see Finding #2), making it pure dead weight.

**Impact**: Slow, unbounded localStorage growth. Not a near-term corruption risk, but could contribute to quota pressure in combination with other keys (see Finding #7).

**Recommendation**:
1. If Setlist Insights is planned: add a pruning step that removes entries for songs no longer in the song library (e.g., on sync). Cap at last 500 entries.
2. If Setlist Insights is NOT planned: remove the `ct_last_played` write entirely.

---

### Finding #5: Role Change Data Leaks
**Risk**: LOW

When a user is demoted from `conductr`/`admin` to `member`:

**Settings page gating**: The Conductr Tools section is gated by `Auth.canEditSongs()` (line 1228 of app.js), which checks for `owner`, `admin`, or `conductr` roles. A demoted member will no longer see the section. This is correct.

**Stale localStorage values**: The following keys would remain in localStorage after demotion:
- `ct_pref_setlist_insights` -- harmless (the setting does nothing anyway, per Finding #2)
- No other conductr-specific keys exist.

**Role-sensitive behavior**: All permission checks (`canEditSongs`, `canEditSetlists`, `canManageUsers`, etc.) are evaluated at call time from `_user.role`, which is refreshed on login/session-refresh. The role in `ct_auth` is updated by `refreshSession()` when `/auth/me` returns the new role. There is no window where stale role data enables unauthorized actions, because:
1. The server enforces all write operations with role checks.
2. The client-side `_user` object is refreshed from the server response on each `refreshSession()` call.

**Offline edge case**: If a user's role is changed while they are offline, `refreshSession()` falls back to cached data (line 161 of auth.js: `return !!_token`). The user retains their old role in the UI until they go online. However, any mutations they attempt will fail server-side when connectivity returns.

**Impact**: Stale settings keys are cosmetic -- they sit unused. The offline stale-role scenario is inherent to offline-first architecture and already mitigated by server-side enforcement.

**Recommendation**: No immediate action needed. Optionally, on logout, clear all `ct_pref_*` keys to ensure a clean slate for the next user on the same device.

---

### Finding #6: Setting Key Collisions
**Risk**: NONE

All `ct_pref_*` keys have unique suffixes. The namespace breakdown:
- `lm_*` -- Live mode settings (11 keys)
- `live_show_*` -- Live mode header toggle visibility (4 keys)
- `tf_*` -- Tuning fork (1 key)
- `wc_*` -- WikiCharts (7 keys)
- `date_format`, `list_density` -- Display (2 keys)
- `notif_*` -- Notifications (1 key)
- `push_*` -- Push notifications (1 key)
- `setlist_*` -- Setlist tools (1 key)

No collisions detected. The prefix-based namespace convention is well-organized.

The only subtle inconsistency is naming style:
- Live mode toggles use `live_show_*` prefix
- Live mode defaults use `lm_*` prefix
- This is not a collision risk, just a readability note.

---

### Finding #7: localStorage Quota Risk Assessment
**Risk**: LOW

**Fixed keys**: ~35 distinct keys, estimated total size ~5-15KB depending on `ct_error_log` and `ct_auth` content.

**Variable keys**:
- `ct_audio_speed_*`: Up to ~10KB for a heavy practitioner (200 songs x ~50 bytes each)
- `ct_last_played`: Up to ~15-60KB depending on library size (see Finding #4)
- `ct_github_pending`: Can be large during offline mutations -- up to ~200KB for bulk song edits
- `ct_error_log`: Capped at 50 entries (~15KB max)

**Total estimated ceiling**: ~300KB in extreme cases.

**localStorage limit**: ~5MB (5,120KB) in all modern browsers.

**Verdict**: Well under the limit. The biggest risk factor is `ct_github_pending` during extended offline editing sessions, but this is a temporary key that flushes on sync. No quota risk.

---

### Finding #8: Cross-Tab Consistency
**Risk**: LOW

The app does NOT listen for the `storage` event (which fires when another tab modifies localStorage). This means:

1. **Settings changes**: If a user changes a setting in Tab A, Tab B will NOT pick up the change until the setting is re-read (which happens on view re-render, not continuously).
2. **Auth changes**: If a user logs out in Tab A, Tab B retains the stale `_user` and `_token` in memory. The next API call from Tab B will fail (401), but the UI won't update until the user interacts.
3. **Live mode `ct_last_played`**: Two tabs running live mode simultaneously could overwrite each other's entries. However, since both write the same timestamp format and `ct_last_played` is never read (Finding #2), this is academic.

**Impact**: This is expected behavior for an offline-first PWA. The app is designed for single-tab usage. Multi-tab scenarios are unusual and the failure mode is graceful (stale UI, not data corruption).

**Recommendation**: No action needed for settings. For auth, optionally add a `storage` event listener for `ct_auth` to trigger logout in other tabs when one tab logs out:
```js
window.addEventListener('storage', (e) => {
  if (e.key === 'ct_auth' && !e.newValue) location.reload();
});
```
This is a nice-to-have, not a safety requirement.

---

### Finding #9: Default Value Consistency
**Risk**: NONE

All preferences are read through consistent `_getPref(key, fallback)` or `_lmPref(key, fallback)` helper functions, both of which use the same pattern:
```js
localStorage.getItem('ct_pref_' + key) ?? fallback
```

Every read site specifies a default that matches the settings page default:
- `lm_dark_default`: `'0'` everywhere
- `lm_auto_hide_delay`: `'4'` everywhere
- `lm_show_nav_buttons`: `'1'` everywhere
- `wc_scroll_speed`: `'1'` everywhere (settings + wikicharts.js init + detail)
- `wc_fontsize`: `'18'` everywhere (settings + wikicharts.js detail + print)
- `tf_default_pitch`: `'0'` everywhere (settings + practice.js)
- etc.

The WikiCharts module reads some preferences at module initialization time (IIFE pattern), which means changes in settings won't take effect until page reload. This is intentional -- these are session-level defaults that are overridden by in-view toggles.

**One minor inconsistency**: `ct_pref_wc_condensed` and `ct_pref_wc_slashes` store `'true'`/`'false'` strings (via `String(boolean)`), while all other toggle prefs store `'1'`/`'0'`. This does not cause any bug because the wikicharts code consistently uses `=== 'true'` to read them, but it is a style inconsistency.

---

### Finding #10: Migration Safety
**Risk**: NONE

The recent changes (persistSpeed flag, last-played tracking, Conductr Tools section) are all **additive**:

1. **`persistSpeed`**: New opt-in flag. Old code never passed it, so old players never saved speed. New practice players save speed. No existing behavior is broken.
2. **`ct_last_played`**: New key, written only on live mode exit. No existing code reads it. No existing behavior is affected.
3. **Conductr Tools settings section**: New UI section gated by `Auth.canEditSongs()`. The `ct_pref_setlist_insights` key is new. No existing setting was renamed or removed.
4. **No localStorage schema migrations were needed** -- all new keys use the existing `ct_pref_*` convention.

Existing users upgrading to v20.22 will experience zero regressions. Their existing preferences are untouched.

---

## Summary Table

| # | Finding | Risk | Action Needed? |
|---|---------|------|----------------|
| 1 | Dead settings (date_format, notif_sync_conflict) | LOW | Wire to behavior or remove |
| 2 | Setlist Insights setting has no consumer | LOW | Complete feature or remove toggle |
| 3 | Orphaned `ct_audio_speed_*` keys | NONE | No action |
| 4 | `ct_last_played` unbounded growth | MEDIUM | Add pruning or remove if unneeded |
| 5 | Role change data leaks | LOW | No action (server enforces) |
| 6 | Setting key collisions | NONE | No action |
| 7 | localStorage quota risk | LOW | No action (~300KB max vs 5MB limit) |
| 8 | Cross-tab consistency | LOW | Optional: auth sync listener |
| 9 | Default value consistency | NONE | No action |
| 10 | Migration safety | NONE | No action |

---

## Recommended Fixes (MEDIUM and above only)

### Fix for Finding #4 (ct_last_played growth) -- MEDIUM

**Option A** (if Setlist Insights feature is planned):
Add pruning to the `_exitLiveMode` write:
```js
// Prune entries for songs no longer in the library
const songIds = new Set(Store.get('songs').map(s => s.id));
const setlistIds = new Set(Store.get('setlists').map(s => s.id));
for (const key of Object.keys(log)) {
  if (key.startsWith('setlist:')) {
    if (!setlistIds.has(key.slice(8))) delete log[key];
  } else {
    if (!songIds.has(key)) delete log[key];
  }
}
```

**Option B** (if Setlist Insights feature is NOT planned):
Remove the `ct_last_played` write block from `_exitLiveMode()` entirely (setlists.js lines 2493-2500).

---

*No CRITICAL or HIGH findings. The app's localStorage usage is well-structured with low corruption risk.*
