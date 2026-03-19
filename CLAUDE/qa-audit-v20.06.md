# QA Audit — v20.06 (Barrel Mode)
**Date**: 2026-03-19
**Scope**: Health, Security, UX, QA stress testing

---

## Findings

### [I-1] IMPORTANT — KV Write Estimation Cross-Day Contamination
**File**: `cloudflare-worker/src/index.js` (`/admin/quotas` endpoint)
**Issue**: The rate_limits query `SELECT COUNT(*) ... WHERE created_at >= ?` uses `toISOString()` for "start of today", but `login` tier rows from yesterday that haven't expired may still be counted if their `created_at` falls before midnight UTC but the query start time is local midnight converted to UTC.
**Impact**: KV write estimate could overcount by including prior-day rows, showing inflated usage.
**Fix**: Use explicit UTC date boundaries: `new Date().toISOString().slice(0,10) + 'T00:00:00.000Z'` for start-of-day.

### [I-2] IMPORTANT — Missing `resp.ok` Guards in Dashboard Fetches
**File**: `js/dashboard.js`
**Issue**: `_loadSharedPackets()` and `_loadMigrationUI()` call `fetch()` but don't check `resp.ok` before parsing JSON. A 4xx/5xx response would throw on `.json()` with a confusing error.
**Impact**: Dashboard could show cryptic errors instead of graceful fallback when Worker returns non-200.
**Fix**: Add `if (!resp.ok) throw new Error(resp.status)` before `.json()` calls.

### [L-1] LOW — Drive Section Title Uses Wrong Check
**File**: `js/dashboard.js` (line ~382)
**Issue**: Drive section title uses `localStorage.getItem('ct_use_cloudflare') === '1'` but `Sync.useCloudflare()` returns true when the key is *absent* (default). So the title could say "Google Drive" when the app is actually using Cloudflare.
**Fix**: Use `Sync.useCloudflare()` instead of direct localStorage check.

---

## Previously Known (from v20.05 audit, still open)
- **[L-1]** Stale `ADMIN_HASH` comment in `cloudflare-worker/wrangler.toml`
- **[L-2]** Dead migration key `bb_pw_hash -> ct_pw_hash` in `js/migrate.js:32`

## Status
Awaiting user prioritization (DO / KEEP / PARK / NUKE).
