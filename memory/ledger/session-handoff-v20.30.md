# Session Handoff — v20.30

## What Shipped
1. **Offline Mutation Queue** — Full infrastructure:
   - IDB v5 upgrade: `mutationQueue` store with autoIncrement keys (FIFO)
   - New module: `js/mutation-queue.js` — queue manager with enqueue, flush, retry, badge
   - Bulk save queueing: songs, setlists, practice, wikicharts — one-per-type dedup via `pendingWrites`
   - Discrete mutation queueing: messages, suggestions, settings — FIFO replay
   - `_queueableWrite` helper in sync.js wraps all write operations
   - Flush triggers: `online` event, `visibilitychange`, app init, Background Sync API
   - Max 5 retries per discrete mutation before drop
   - Network error detection: `TypeError` from `fetch()` = offline; server errors handled separately
   - Background Sync: SW listens for `mutation-queue-flush` tag, messages client to flush
   - UI: cloud-off icon button with orange badge (pending count), offline indicator bar
   - 55 new unit tests (765 total, 0 failures)

## What Changed
- `idb.js` — v4 → v5: +`mutationQueue` store, +6 mutation CRUD functions, updated `clearAll`
- `js/mutation-queue.js` — NEW (~230 lines)
- `js/sync.js` — +MutationQueue import, 4 bulk saves + 8 discrete mutations wrapped with queue-on-fail
- `service-worker.js` — +`mutation-queue-flush` sync handler, +`mutation-queue.js` in SHELL_ASSETS
- `app.js` — +MutationQueue import+init, queue button handler, auth UI visibility
- `index.html` — +offline indicator bar, +queue button with badge
- `app.css` — +offline indicator, queue badge styles
- `tests/mutation-queue.test.js` — NEW (55 tests)
- `tests/run-all.js` — added mutation-queue.test.js
- Version bumped: v20.29 → v20.30 across all files

## Architecture Notes
- **Two queue types**: Bulk saves (pendingWrites store, type-keyed dedup) and discrete mutations (mutationQueue store, autoIncrement FIFO)
- **Optimistic UI**: `_queueableWrite` returns `true` when mutation is queued, so UI shows success + "will sync when back online"
- **Flush order**: Bulk saves first (higher priority), then discrete mutations in FIFO order
- **No new Worker endpoints needed** — this is entirely client-side infrastructure

## Known Issues
- Dead toggles: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` — saved but never consumed (15min cleanup)
- Browser back from practice mode still uses navStack (design constraint)

## Next Priorities
1. **Deploy migration 0015 + Worker** to make messaging live
2. **Nav API** — replace hash router (user requested, still pending)
3. **Practice Session Timer/Stats** — no timer tracking exists yet
