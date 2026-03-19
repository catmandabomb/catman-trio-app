# Glockenspiel — Session Resume Point

## What's Done (ALL code changes complete, saved to disk, NOT committed)

### Part 1: Legacy Admin Hash Nuke
- Removed DEFAULT_HASH, _sha256, checkPassword, setPassword, showPasswordModal from admin.js
- Removed getAdminHash from auth.js
- Removed X-Admin-Hash headers, publishPat, loadPublishedPat from github.js
- Removed password modal from index.html
- Stubbed cloudflare-worker/src/auth.js
- Simplified authenticateRequest in worker index.js to session-only
- Removed stale admin-hash CORS header, dead guard, stale comments in worker

### Part 2: Dead Code Cleanup
- Removed saveRawFile from drive.js
- Removed publishPat call + _migration_backup from js/dashboard.js
- Simplified tryAutoConfigureGitHub to no-op in js/sync.js
- Removed dead wasPtr variable from app.js

### Part 3: PTR Fix
- Added `opacity: 1` to `.ptr-indicator.ptr-hint` in app.css

### Part 4: Classic 4 Fixes (js/setlists.js)
- _afterSnap: skip center re-render if slot already has correct content
- _revealLiveMode: made async, await center render before removing overlay
- Removed redundant 300ms re-render in cleanup setTimeout
- Reduced stuck detection threshold from 1000ms/1500ms to 500ms

### Part 5: Title Click Fixes (app.js)
- Admin on song list -> dashboard
- Non-admin on song list -> sync refresh
- Added padding to tap target

### Part 6: Idle Charts Bug (js/setlists.js + pdf-viewer.js)
- _onVisibilityChange: clears render cache + calls _updateSlots() on return from background
- Worker timeout: kills dead worker, rejects all pending, re-inits fresh worker
- Cache validation: checks for lost canvas context before blitting

### Part 7: Audio Player Redesign (app.css + player.js)
- Progress bar: element background -> track pseudo-elements (thin 4px Spotify-style)
- Play button: 42px -> 36px, icon 16px -> 14px
- Tighter spacing, speed btn smaller, time labels cleaner

### Part 8: Practice Mode Changes (js/practice.js + app.css)
- Removed "Exit Practice Mode" button
- Added tuning fork A440 button in topbar-right (Web Audio API sine wave, 8s decay)
- Practice jump bar opacity: 0.5 -> 0.3

### Part 9: Barrel Mode Fixes
1. Tuning fork: added _tfGain.disconnect() in catch, onended=null, AudioContext suspend on cleanup, handles closed state
2. CORS: removed X-Admin-Hash from allowed headers
3. Practice list ownership: server-side D1 query before upsert (not client createdBy)
4. _revealTimeout: promoted to function scope, cleared in _exitLiveMode
5. Visibility re-render: uses _updateSlots() instead of direct _renderPageIntoSlide
6. Dead wasPtr removed from app.js
7. tfRing animation: force reflow for replay on rapid taps
8. AudioContext: suspended on practice exit

## What's NOT Done Yet

### Deploy
- `wrangler deploy` for worker changes (auth stub, CORS, practice ownership fix, dead guard removal)
- Push static files to live site
- Version bump (4 locations: js/store.js, index.html, service-worker.js)

### Visual UX Audit (authenticated views)
- Plan: open Nightly at mobile viewport (390x844), user logs in on live site, hide install screen via JS eval, then screenshot all authenticated views (song list, song detail, audio player, setlists, practice mode with tuning fork, dashboard)
- Unauth views verified: gate page, login modal, topbar, footer all look clean

### Testing on Device
- Classic 4: code applied, needs iOS testing
- Idle charts bug: code applied, needs real-world testing
- Title click -> dashboard: needs verification
- Tuning fork: needs audio verification
- Audio player redesign: needs visual verification on real device

## Files Modified (20 files)
admin.js, app.css, app.js, auth.js, cloudflare-worker/src/app-data.js,
cloudflare-worker/src/auth.js, cloudflare-worker/src/cors.js,
cloudflare-worker/src/gig-packets.js, cloudflare-worker/src/index.js,
drive.js, github.js, index.html, js/dashboard.js, js/practice.js,
js/setlists.js, js/songs.js, js/sync.js, pdf-viewer.js, player.js

## Playwright/Firefox Config
- .mcp.json updated to `--browser firefox` (working, confirmed)
- Firefox Nightly installed for Playwright
- Can bypass install screen via JS: `document.querySelector('.pwa-install-prompt')?.remove()` or similar
