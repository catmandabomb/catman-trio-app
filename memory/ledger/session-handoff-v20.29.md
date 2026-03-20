# Session Handoff — v20.29

## What Shipped
1. **Member-to-Conductr Messaging** — Full pipeline:
   - D1 migration 0015: `orchestra_messages` table
   - Worker: 5 CRUD endpoints + push notifications on new message/reply
   - Client: 7 sync functions in sync.js
   - UI: `js/messages.js` — list view with category/status filters, compose view, thread view with reply + status workflow
   - Unread badge (mail icon next to Account button, 60s polling)
   - Permission matrix enforced end-to-end (guest blocked, member sees own, conductr sees all)

2. **Practice Detail Deep Links** — `#practice/:id`
   - Browser back now works for practice list detail views (was a known issue)
   - Deep linking to specific practice lists via URL
   - Route registration in practice.js

3. **UI Clutter Pass**
   - Messages button: icon-only (mail icon + badge) in the admin bar area, NOT in the main topbar nav row
   - Hidden for guests and non-logged-in users — zero clutter for most users

4. **109 New Unit Tests** (594 → 710)
   - Router tests for new routes (practice/:id, #messages)
   - Messages module tests (categories, statuses, permission logic)

## What Changed
- `cloudflare-worker/migrations/0015_orchestra_messages.sql` — NEW
- `cloudflare-worker/src/app-data.js` — +184 lines (message CRUD)
- `cloudflare-worker/src/index.js` — +80 lines (message routes + push)
- `js/messages.js` — NEW (~300 lines)
- `js/sync.js` — +125 lines (message sync functions)
- `js/router.js` — practice-detail, practice-edit, messages routes
- `js/practice.js` — route registrations + practiceListId in params
- `index.html` — messages view container + icon button
- `app.js` — messages import, button handler, unread polling, auth UI
- `app.css` — +170 lines (message styles)
- `tests/` — router.test.js updated, messages.test.js NEW

## Migration Required
- Run `0015_orchestra_messages.sql` on D1 before deploying Worker
- Deploy Worker after migration

## Known Issues
- Dead toggles: `ct_pref_date_format`, `ct_pref_notif_sync_conflict` — saved but never consumed (15min cleanup)
- Browser back from practice mode (not detail) still uses navStack (design constraint)

## DNS TODO
- Created `C:\Users\catremblay\Documents\PERSONAL\CLAUDE\3-20\dns-catmanbeats-setup.md` with setup instructions for catmanbeats.com + trio.catmanbeats.com

## Next Priorities
1. **Deploy migration 0015 + Worker** to make messaging live
2. **Nav API** — replace hash router (user requested, still pending — was in the request but messaging+practice were higher priority for this session)
3. **Practice Session Timer/Stats** — no timer tracking exists yet
4. **WikiCharts deep-dive agent** completed in background (check output)
