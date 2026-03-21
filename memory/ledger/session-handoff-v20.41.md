# Session Handoff — v20.41

## What Shipped
- **Dashboard reorg**: Removed purge section, fixed Storage×3 redundancy, renamed "Storage"→"Data Backend", fixed admin toggle stuck bug (inline update)
- **Settings overhaul**: Collapsible sections (title-text-keyed persistence), purge practice lists moved to conductr-only Danger Zone with confirm dialog, technical toast preference toggle
- **PDF annotation fixes**: Zoom desync (transform synced to overlay in `applyTransform()`), annotation bleed between songs (stale overlay cleanup in `attachLiveMode()`)
- **Nav hardening**: Account/settings navStack wipe fix (only wipe on fresh entry)
- **Technical toast system**: `showTechnicalToast()` in utils.js, 13 diagnostic toasts gated behind user pref
- **Admin.js stale imports**: Fixed v20.27→v20.41
- **Research docs**: AI song detection plan + research committed
- **Tests**: 883/883 passing

## Known Issues
- **Migration 0015 pending**: `orchestra_messages` table needs Cloudflare deploy (needs user auth)
- **Dead toggles**: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` still exist — 15min cleanup (Task #28)

## Next Priorities
1. **Dynamic header button sizing** (Task #29) — ResizeObserver on topbar, audit ALL headers, new standard for app look/feel. USER PRIORITY.
2. **Dead toggles cleanup** (Task #28) — Quick 15min fix
3. **Migration 0015 deploy** — Come back ASAP, needs user's Cloudflare auth
4. **AI Song Detection** — Plan + research complete, ready to build
5. **Navigation API full migration** — Partially in place as progressive enhancement, not full hash router replacement yet

## NUKED
- Practice session timer/stats — killed permanently per user request
