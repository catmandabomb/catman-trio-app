# QA Audit — Catman Trio App v20.05
**Date:** 2026-03-19
**Scope:** All files modified since v20.04

## Summary
9 functional areas reviewed across 20 files. **No critical bugs.** 1 important UX issue. 3 low-severity doc/config items.

## IMPORTANT

### [I-1] `github.js:331` — testConnection() fails in Worker mode
`testConnection()` checks `if (!pat)` and bails with "PAT is required". In Worker mode (`USE_WORKER = true`), PAT is server-side so `_getPat()` returns `''` — function never makes a network call. GitHub modal test button shows confusing error.

**Fix:** Add early return for Worker mode: `if (USE_WORKER) return { ok: true, repoName: 'Worker proxy active' };`

## LOW

### [L-1] `cloudflare-worker/wrangler.toml` — Stale ADMIN_HASH comment
`#   ADMIN_HASH — PBKDF2 admin password hash` comment remains but no code reads it.

### [L-2] Dead migration key `bb_pw_hash -> ct_pw_hash` in `js/migrate.js:32`
Harmless but residual hash-system debt.

## VERIFIED CLEAN
- Version bump: all 4 locations at v20.05, 0 stale `?v=20.04` refs
- Legacy admin hash: all functions/headers confirmed removed
- Dead code: saveRawFile, publishPat, loadPublishedPat, _migration_backup, wasPtr — all gone
- PTR fix: opacity:1 on .ptr-indicator.ptr-hint confirmed
- Classic 4: _afterSnap skip guard, async _revealLiveMode, stuck threshold reduction — all correct
- Idle charts: render cache clear, worker timeout, canvas context validation — all confirmed
- Title click: admin->dashboard, non-admin->sync, else->list — correct
- Tuning fork: cleanup chain complete, no leaks
- Audio player: 36px button, 4px track — confirmed
- Dangling listeners: all cleanup patterns intact
- Import versions: all `?v=20.05` consistent
