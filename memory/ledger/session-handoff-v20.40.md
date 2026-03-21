# Session Handoff — v20.40

## What Shipped

### Sort button visibility fix
- Removed old CSS rules that hid sort button on touch/mobile (was inherited from refresh button)
- Sort button now visible for all authenticated users, hidden for unauth (`body:not(.authed)`)
- Sort button was invisible on iPad/mobile since v20.36 rename — now works everywhere

### + button auth fix
- `songs.js:346` used `Admin.isEditMode()` (requires admin mode toggle) → changed to `Auth.canEditSongs()`
- Now shows for any user with edit permissions, regardless of admin mode state
- Fixes: + button missing after app reopen, + button missing for conductr role

### Admin icon button padding
- `.admin-buttons .icon-btn` now overrides 44px touch target min-width to 32px
- Icons (mail, user, plus) are tighter in the admin-buttons area

### Sync data protection
- Never replaces existing data with empty arrays from API response
- If sync returns `songs: []` but local has 50 songs, local data is kept
- Applies to all 4 data types: songs, setlists, practice, wikiCharts
- Logs a console.warn when this protection triggers

### Practice jump bar — wide screen fix
- Removed `right: calc(15vw - 35px)` on 900px+ screens (pushed bar inward)
- Now uses `right: 6px` on wide screens — stays near screen edge
- Mobile margin-right: 36px scoped to `@media (max-width: 768px)` only
- Wide screens: content padding (15vw) naturally provides clearance

### Key pills overhaul — 24 canonical keys
- Hardcoded 24 pills: 12 major + 12 minor (circle of fifths order)
- New key parser in `utils.js`: `parseKeyField()`, `normalizeKey()`, `songMatchesKey()`
- Multi-key parsing: "E maj/min" → E + Em, "F#min/Ebmaj" → F#m + Eb
- Enharmonic normalization: C# → Db, Gb → F#, etc.
- Songs with compound key fields now match ALL constituent keys
- "Multiple", "Various" gracefully ignored (return empty)
- Pills ordered by song count, then canonical order for ties
- 14 new tests (883 total, 0 failures)

## Test Suite
- 883 tests, 0 failures, ~49ms

## Known Issues
- **Auth init race condition**: App renders logged-out skeleton before checking cached session. Not fixed yet.
- **Dead toggles**: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` — saved but never consumed.
- **Migration 0015 pending deploy**: `orchestra_messages` table needs D1 migration.

## Parked/Requested Features
- **AI song detection**: Auto-populate key/BPM/duration when adding a song by title. Use MusicBrainz or similar API. Applies to: new song form, WikiChart quicktext. User wants this for conductrs adding proper songs too.
- **Dynamic header dead space detection**: Resize nav buttons based on available space between title and first button. Background research agent launched.
- **Rename WikiCharts → Sheets**: User wants this, not yet implemented.

## Next Priorities
1. **Verify v20.40 fixes on user's iPad** — sort button visible, + button present, key pills showing
2. **AI song detection planning** — design the API integration and UX
3. **Dynamic header button sizing** — use research results
4. **Auth init race condition fix**
5. **Continue region-by-region bug hunt**
