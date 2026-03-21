# MASTER LEDGER — Catman Trio App

**Last updated**: v20.40 (2026-03-20)

---

## Vision

Vanilla JS PWA for a working band. Offline-first, mobile-first, dark theme. Cloudflare Worker + D1 + R2 backend. No framework, no build tools. Songs, setlists, practice lists, WikiCharts, live mode, orchestra management, member messaging. Deployed via Cloudflare Pages.

---

## Feature Tracker

### Shipped

| Feature | Version | Key files |
|---|---|---|
| Core app shell + routing | v20.01+ | `app.js`, `js/router.js`, `index.html` |
| D1 auth (PBKDF2, 5 roles) | v20.10+ | `auth.js`, Worker |
| Songs CRUD + search + tags + keys | v20.01+ | `js/songs.js` |
| Setlists + live mode + carousel | v20.01+ | `js/setlists.js` |
| Practice lists + accordion + jump bar | v20.01+ | `js/practice.js` |
| WikiCharts + reference links overlay | v20.28 | `js/wikicharts.js` |
| PDF viewer + zoom/pan + margin crop | v20.05+ | `pdf-viewer.js` |
| Audio player + Media Session | v20.05+ | `player.js` (not in repo) |
| Metronome + tuning fork | v20.10+ | `metronome.js` |
| Orchestra system (migrations 0009-0014) | v20.21 | `js/orchestra.js`, `js/instruments.js` |
| Conductr Settings (18 behaviors) | v20.28 | `js/sync.js` getOrchestraSetting() |
| Admin dashboard + tag manager + user mgmt | v20.15+ | `js/dashboard.js` |
| Member-to-Conductr messaging | v20.29 | `js/messages.js`, migration 0015 |
| Offline mutation queue (IDB v5) | v20.30 | `js/mutation-queue.js` |
| Navigation API progressive enhancement | v20.31 | `js/router.js` |
| Client error reporting | v20.28 | `app.js` POST /client-errors |
| SW health check + version-aware cache bust | v20.28 | `service-worker.js` |
| Key pills (24 canonical, enharmonic normalization) | v20.40 | `js/utils.js` parseKeyField() |
| Compressed localStorage (gz: prefix) | v20.34 | `js/sync.js` |
| Cross-tab auth sync | v20.20+ | `auth.js` storage event |
| Practice detail deep links (#practice/:id) | v20.29 | `js/practice.js` |

### In Progress / Pending Deploy

| Feature | Status | Blocker |
|---|---|---|
| Migration 0015 (orchestra_messages) | Code complete | Needs `wrangler d1 migrations apply` on prod |

### Parked

| Feature | Context | Source |
|---|---|---|
| Rename WikiCharts to Sheets | User wants full rename of area + references | User request |
| Practice Session Timer/Stats | No timer tracking exists | v20.28 handoff |
| AI song detection (auto key/BPM/duration) | MusicBrainz or similar API for new song form + WikiChart quicktext | v20.40, `CLAUDE/song-detection-research.md` |
| Dynamic header button sizing | Resize nav buttons based on available space | v20.40, research agent launched |
| Stage Red Theme | CSS custom property swap for Live Mode | v20.28 handoff |
| Setlist Intelligence | Last-played tracking, duplicate detection, key transition warnings | v20.28 handoff |
| OPFS Write Buffer | Crash-resilient alternative to localStorage | v20.28 handoff |
| Guest sharing links | Share setlists/practice lists via link | v20.28 handoff |
| Tablet two-column layout | `@media (min-width: 768px)` song grid | Android audit |
| Per-song audio settings | Persist speed/pitch per song ID | v20.28 handoff |

---

## Bug Tracker

### Open

| Bug | Severity | Source | Effort |
|---|---|---|---|
| Auth init race condition | MEDIUM | v20.33+ | App renders logged-out skeleton before checking cached session |
| Dead toggles: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` | LOW | v20.28+ | 15 min cleanup |
| CSP inline handler warning (`onclick=""` on topbar-title) | LOW | v20.33 | Cosmetic |
| Samsung DeX falsely detected as mobile | MEDIUM | Android audit | 30 min |
| No viewport resize handler (foldables, DeX) | MEDIUM | Android audit | 2 hr |
| Form inputs invisible focus indicators | MEDIUM | A11y audit | 30 min |
| Song cards not keyboard-focusable | HIGH | A11y audit | 1 hr |
| Song list changes not announced to SRs | HIGH | A11y audit | 30 min |
| Audio controls undersized touch targets | MEDIUM | A11y audit | 15 min |

### Fixed (Recent)

| Bug | Fixed in | Notes |
|---|---|---|
| Sort button invisible on mobile | v20.40 | Removed inherited CSS hide rules |
| + button missing after app reopen | v20.40 | Changed to `Auth.canEditSongs()` |
| Sync replaces data with empty arrays | v20.40 | Never overwrite local with empty API response |
| Practice jump bar overlap on wide screens | v20.40 | Scoped mobile margin, fixed right position |
| Post-login flow broken (songs empty) | v20.35 | Added immediate cloud sync after login |
| Compressed localStorage not loading | v20.34 | Added async `_getDecompressed()` fallback |
| Browser back from practice detail | v20.29 | Deep links via `#practice/:id` |
| ct_last_played unbounded growth | v20.28+ | Capped at 500 |
| Metronome/tuning fork AudioContext zombie | v20.28 | `close()` + null instead of `suspend()` |

---

## Device Audit Priorities

*From 4 deep audits (Android, iOS, Desktop, A11y/i18n/Perf). Full details: `research/ARCHITECTURE AND SHORTHANDS/device-compatibility-cheatsheet.md`.*

### P0 — Fix Now

| # | Issue | Source | Effort |
|---|---|---|---|
| 1 | Add `defer` to `pdf.min.js` + `Sortable.min.js` | Perf audit | 5 min |
| 2 | Cap PDF render cache (LRU, 4-6 entries) | Perf audit | 30 min |
| 3 | Canvas DPR cap 1.5 on 2GB devices | Android audit | 5 min |
| 4 | Samsung Night Mode meta tag | Android audit | 2 min |
| 5 | Song cards: `tabindex="0"` + `role="button"` + `aria-label` | A11y audit | 1 hr |

### P1 — Fix Soon

| # | Issue | Source | Effort |
|---|---|---|---|
| 6 | Ad blocker detection toast (fetch TypeError) | Desktop audit | 20 min |
| 7 | Grammarly suppression on search/password | Desktop audit | 5 min |
| 8 | `visibilitychange` sync trigger | Desktop audit | 15 min |
| 9 | Touch targets `@media (any-pointer: coarse)` | Desktop/A11y audit | 30 min |
| 10 | macOS Safari install hint | Desktop audit | 45 min |
| 11 | Viewport resize handler (foldables, DeX) | Android audit | 2 hr |
| 12 | Song list `aria-live` result count | A11y audit | 30 min |
| 13 | Form input focus indicators | A11y audit | 30 min |

### P2 — Nice to Have

| # | Issue | Source | Effort |
|---|---|---|---|
| 14 | DeX mobile detection fix | Android audit | 30 min |
| 15 | Missing WebView detections (LinkedIn, Telegram) | Android audit | 5 min |
| 16 | Install gate wording for non-Chrome Android | Android audit | 2 min |
| 17 | Media Session seek handlers | Android audit | 15 min |
| 18 | Firefox `::-moz-range-track` styling | Desktop audit | 20 min |
| 19 | `#login-error` `role="alert"` | A11y audit | 5 min |
| 20 | Tag/key chips `aria-pressed` | A11y audit | 15 min |

### P3 — Low Priority

| # | Issue | Source |
|---|---|---|
| 21 | Battery optimization OEM warning (dontkillmyapp.com) | Android audit |
| 22 | Tablet two-column layout | Android audit |
| 23 | Lazy-load decorative Google Fonts | Perf audit |
| 24 | Chunked song list rendering | Perf audit |
| 25 | RTL layout support | i18n audit |

---

## Key Decisions Log

| Date | Decision | Context |
|---|---|---|
| v20.21 | Orchestra system shipped | Multi-orchestra with role hierarchy |
| v20.28 | Conductr Settings: 18 GO items | Wired into view modules via `Sync.getOrchestraSetting()` |
| v20.28 | AudioContext `close()` not `suspend()` | Prevents zombie contexts on metronome/tuning fork |
| v20.29 | Migration 0015: orchestra_messages | Member-to-conductr messaging pipeline |
| v20.30 | IDB v5: mutation queue | Two queue types: bulk dedup + discrete FIFO |
| v20.31 | Navigation API confirmed already in place | Progressive enhancement in router.js |
| v20.34 | Compressed localStorage with gz: prefix | Async decompression fallback added |
| v20.36 | Removed sync button from search bar | Moved to footer "Sync" link |
| v20.40 | 24 canonical key pills | Enharmonic normalization, multi-key parsing |

---

## Test Suite

- **883 tests**, 0 failures, ~49ms
- **Location**: `tests/` (16 files)
- **Run**: `node tests/run-all.js`
- **Mandatory**: before every push

---

## Next Priorities (from v20.40 handoff)

1. Verify v20.40 fixes on user's iPad (sort button, + button, key pills)
2. AI song detection planning (API integration + UX)
3. Dynamic header button sizing (use research results)
4. Auth init race condition fix
5. Continue region-by-region bug hunt
