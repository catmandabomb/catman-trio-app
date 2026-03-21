# Session Handoff — v20.37

## What Shipped (v20.33–v20.37)

### v20.33 — Naming + padding + empty state
- Renamed legacy "Drive sync failed" → context-aware (GitHub/Cloud/Drive)
- Renamed `_syncAllFromDrive` → `_syncFromCloud`
- Smarter empty states: loading/logged-out/retry
- Tightened admin-buttons, search bar, subheader padding
- Fixed `is-mobile` body class to also check UA string

### v20.34 — CRITICAL: compressed localStorage not loading
- All four `loadInstant` functions used `_getLocalSync()` which returns null for `gz:` compressed data
- Added async `_getDecompressed()` fallback between sync localStorage read and SW cache fallback
- Songs/setlists/practice/wikicharts all fixed

### v20.35 — CRITICAL: post-login flow broken
- After login, `_syncFromCloud()` was never called — songs stayed empty
- Added immediate cloud sync after login with loading state
- CSS-hidden + button when not authed
- + button shows for canEditSongs users (removed editMode gate)
- Icon gap: 0px between icons, 2px margin on Log Out btn-ghost

### v20.36 — Remove sync button, add to footer
- Removed `#btn-refresh` from search bar entirely
- Removed "Retry Sync" from empty state
- Added "Sync" text link to footer Navigate column (above Dashboard)
- Renamed `search-refresh-btn` → `search-sort-btn`
- Cleaned up unused refresh throttle code

### v20.37 — Practice jump bar overlap
- 36px right margin on `.practice-accordion-item` on mobile (<768px)
- Jump bar moved from right:6px to right:4px

## Test Suite
- 869 tests, 0 failures, 46ms

## Known Issues
- **Auth init race condition**: App renders logged-out skeleton before checking cached session. Navigation tests codify expected behavior but fix NOT implemented yet.
- **Dead toggles**: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` — saved but never consumed.
- **CSP inline handler warning**: `onclick=""` on topbar-title triggers CSP violation (cosmetic).

## Next Priorities
1. **Verify post-login sync on user's iPad** — user was testing actively
2. **Auth init race condition fix** — synchronous localStorage check before first render
3. **Continue region-by-region bug hunt** — song list first, then setlists, practice, etc.
4. **Toast silencing verification** — confirm silent sync works on user devices
