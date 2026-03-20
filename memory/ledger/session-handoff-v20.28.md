# Session Handoff — v20.28

**Pushed**: 2026-03-20
**Branch**: main
**Tests**: 594 passed, 0 failed (32ms)

---

## What Shipped

### Conductr Settings System (18 behaviors)
All 18 GO Conductr Settings wired into view modules:
- **Songs**: hide notes from members, hide difficulty, required fields validation, quick-add mode, duplicate detection
- **Setlists**: default sort, auto-archive days, set-length warning (toggle + minutes threshold)
- **WikiCharts**: default key pre-fill
- **Practice**: (inherits from member-level prefs)
- **Live Mode**: default theme cascade (session > orchestra > device pref), font size override, auto-advance seconds override

### Infrastructure
- `orchestra_settings` D1 table (migration 0014)
- Worker CRUD: `GET/POST /orchestras/:id/settings`
- Client: `Sync.getOrchestraSetting(key, fallback)` — synchronous read from localStorage cache
- `admin_settings` D1 table + `Sync.getAdminSetting(key, fallback)`
- Admin dashboard: file upload size limit slider (10-250MB + No limit)

### WikiChart Reference Links Overlay
- Replaced inline editing with `+ Reference Links` button
- Button turns green with checkmark when links exist
- Modal overlay for editing (label, URL, type, delete)
- Max 5 links enforced

### Audio Fixes
- **Metronome**: `stop()` now `close()`s AudioContext + nulls all worklet state (was `suspend()`)
- **Tuning fork**: Same fix — `_cleanupTuningFork()` uses `close()` + null
- Root cause: `suspend()` left AudioContext in zombie state; `resume()` sometimes couldn't recover

### Practice Single-Expand
- Device-level pref: `ct_pref_practice_single_expand`
- When enabled, opening one accordion item closes all others
- Toggle in Settings page under Practice section

### Stability Hardening (Tier 3)
- **Client error flush**: `POST /client-errors` Worker endpoint; client flushes unflushed entries every 5min
- **SW health check**: MessageChannel ping/pong on app init; auto-triggers SKIP_WAITING on version mismatch

---

## Already Implemented (Verified This Session)

All Tier 1 and Tier 2 stability items were ALREADY shipped in prior versions:
- Practice POST auth guard (guest check)
- `overscroll-behavior: none` on body
- `font-variant-numeric: tabular-nums` across all numeric displays
- Cross-tab auth sync (`storage` event on `ct_auth`)
- Firefox scrollbar styling (`scrollbar-width: thin`)
- Manifest `id` field
- Dashboard `resp.ok` guards on quotas + errors fetches
- Bluetooth page turner keys (Enter/Backspace in Live Mode)
- `@starting-style` on modals/toasts
- Firefox slider styling (`::-moz-range-thumb` + `::-moz-range-track`)
- CSP meta tag (comprehensive)
- Online/offline status listener + auto-sync
- Persistent storage request

---

## Known Issues

- **Metronome in PDF viewer**: Button displays but audio might not start on first tap after practice panel metronome was used. The `close()` fix should resolve this — needs browser testing.
- **ct_last_played unbounded growth**: Still needs pruning (keep last 500). Quick fix.
- **Dead toggles**: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` saved but never consumed.

---

## Next Priorities (Recommended)

### Immediate (quick wins)
1. `ct_last_played` pruning — 10 lines, fixes unbounded localStorage growth
2. Per-song audio settings — persist speed/pitch per song ID (~50 lines)
3. Linearized PDFs — run `qpdf --linearize` on R2 files (no code changes)

### Short-term (feature wins)
4. Practice Session Timer + Stats — track time-per-song, cumulative stats
5. Stage Red Theme — CSS custom property swap for Live Mode
6. Setlist Intelligence — last-played tracking, duplicate detection, key transition warnings

### Medium-term (architectural)
7. Navigation API — replace hash router with native `navigate` event
8. OPFS Write Buffer — crash-resilient alternative to localStorage
9. Member-to-Conductr messaging
10. Guest sharing links

---

## File Changes Summary

| File | Changes |
|------|---------|
| `cloudflare-worker/src/index.js` | +POST /client-errors endpoint, route comment |
| `cloudflare-worker/src/app-data.js` | Orchestra settings CRUD helpers |
| `cloudflare-worker/migrations/0014_orchestra_settings.sql` | NEW — orchestra_settings + admin_settings tables |
| `js/songs.js` | 5 conductr settings behaviors (#9, 12, 18, 24, 25) |
| `js/setlists.js` | 6 conductr settings behaviors (#5, 6, 7, 13, 14, 15) |
| `js/wikicharts.js` | Reference links overlay + default key setting (#20) |
| `js/practice.js` | Tuning fork audio fix + single-expand setting |
| `js/sync.js` | getOrchestraSetting(), getAdminSetting(), loadAdminSettings() |
| `js/dashboard.js` | Admin settings section with upload limit slider |
| `metronome.js` | AudioContext close() fix in stop() |
| `app.js` | Client error flush, SW health check, practice single-expand toggle, admin settings init |
| `service-worker.js` | HEALTH_CHECK message handler |
| `app.css` | Reference links button styles |
