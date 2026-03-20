# iOS & iPadOS Deep Edge Case Audit — Catman Trio App

**Date:** 2026-03-20
**App Version:** v20.24
**Auditor:** Claude Opus 4.6 (deep research pass)
**Scope:** 12 iOS/iPadOS-specific edge case categories against actual codebase

---

## Table of Contents

1. [iPadOS Stage Manager](#1-ipados-stage-manager)
2. [iPadOS Keyboard & Trackpad](#2-ipados-keyboard--trackpad)
3. [iOS 15 Degradation](#3-ios-15-degradation)
4. [iOS Lockdown Mode](#4-ios-lockdown-mode)
5. [Dynamic Island / Notch Variations](#5-dynamic-island--notch-variations)
6. [Safari Version Matrix](#6-safari-version-matrix)
7. [iOS WKWebView Isolation](#7-ios-wkwebview-isolation)
8. [Home Screen Web App Limits](#8-home-screen-web-app-limits)
9. [iOS Audio Autoplay](#9-ios-audio-autoplay)
10. [iPhone SE / Smaller Screens](#10-iphone-se--smaller-screens)
11. [Low Power Mode](#11-low-power-mode)
12. [iOS Focus / Zoom Behavior](#12-ios-focus--zoom-behavior)
13. [Summary & Priority Matrix](#13-summary--priority-matrix)

---

## 1. iPadOS Stage Manager

### What it is
iPadOS 16+ Stage Manager allows resizing Safari/PWA windows to arbitrary dimensions on M1/M2/M4 iPads. Windows snap to system-defined sizes but can be freely dragged to non-standard widths: 504px, 540px, 639px, 678px, 744px, 810px, 954px, 1024px, and more. iPad apps can also run in split-view (50/50, 33/66, 25/75) producing widths like 320px, 375px, 507px, 678px depending on iPad model.

### Affected devices
- iPad Pro 11" and 12.9" (M1+): Full Stage Manager with external display support
- iPad Air (M1+): Stage Manager, no external display
- iPadOS 16.1+ required

### What in our code is vulnerable

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **Breakpoint gaps** | `app.css` | Breakpoints at 340/360/380/400/500/600/768/900/1024 leave gaps. At 504px (common Stage Manager size) the layout falls between the 500px and 600px breakpoints — no explicit handling. | MEDIUM |
| **PDF dual-page mode** | `pdf-viewer.js` | Landscape dual-page triggers at `min-width: 768px` (line 7195 of app.css `@media (orientation: landscape) and (min-width: 768px)`). In Stage Manager, a 768px-wide portrait window would NOT trigger this, but an 810px landscape window would — at that width, two half-width pages may be too narrow to read. | MEDIUM |
| **Topbar layout** | `app.css:305` | `@media (max-width: 1023px)` hides desktop-only elements. A Stage Manager window at 1024px+ in landscape shows desktop layout on what is still a touch device. | LOW |
| **Live mode carousel** | `app.css:4285` | `@media (min-width: 768px) and (pointer: coarse)` — this is good, it correctly targets iPad-sized touch screens. But live mode calculates page dimensions from container width at init time. If the Stage Manager window resizes mid-live-mode, the PDF canvas does not reflow. | HIGH |
| **`isMobile()` detection** | `utils.js:183-187` | Returns `true` for iPad (`navigator.platform === 'MacIntel' && maxTouchPoints > 1`). This is correct even in Stage Manager — the device is still a touch device. However, `window.innerWidth <= 1024` check on line 186 could flip between mobile/desktop as the Stage Manager window resizes. | LOW |

### Fix approach
1. **Add `resize` / `visualViewport.resize` listener** for live mode and PDF viewer to re-render on window geometry change. Estimated effort: 2hr.
2. **Test intermediate breakpoints**: Manually verify layout at 504, 540, 639, 678, 810px in Chrome DevTools responsive mode. Fix any broken layouts. Estimated effort: 1hr.
3. **Consider `container queries`** for card layouts (Safari 16+, so Stage Manager devices are covered). PARK for now — breakpoint fixes are sufficient.

### Priority: **MEDIUM** (affects M1+ iPad users in Stage Manager mode, growing audience)

---

## 2. iPadOS Keyboard & Trackpad

### What it is
iPad Magic Keyboard and Smart Keyboard Folio add cursor hover, right-click (two-finger tap / Control+click), and keyboard shortcuts. iPadOS treats Magic Keyboard as `pointer: fine` + `hover: hover`, making the iPad behave like a laptop.

### Affected devices
- Any iPad with Magic Keyboard, Smart Keyboard Folio, or connected Bluetooth mouse/trackpad
- iPadOS 13.4+ (cursor support), iPadOS 15+ (keyboard shortcuts framework)

### What in our code is vulnerable

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **Hover states visible** | `app.css` | Uses `@media (hover: hover)` for tag filter chip hover (line 904) and key filter chip hover (line 957). These WILL fire on Magic Keyboard iPad. This is **correct behavior** — hover is available, so showing hover effects is appropriate. | OK |
| **`@media (hover: none)` volume hide** | `app.css:359` | Volume slider hidden via `@media (hover: none) and (pointer: coarse)`. With Magic Keyboard attached, iPad reports `hover: hover` and `pointer: fine`, so the volume slider WILL show. But `audio.volume` is still read-only on iPadOS. The slider appears functional but does nothing. | HIGH |
| **Right-click / context menu** | `app.js` | No `contextmenu` event handlers. Two-finger tap on Magic Keyboard trackpad opens the browser default context menu on all interactive elements. Not harmful, but "Copy Link" on internal SPA links copies `#hash` URLs which don't work externally. | LOW |
| **Keyboard shortcuts conflicts** | `player.js:672-703` | Global keyboard shortcuts (Space, Arrow keys) only activate when `!_isMobileDevice`. The check is UA-based: `/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)`. iPadOS 13+ spoofs macOS in Safari UA, so `iPad` is NOT in the UA string. Result: **keyboard shortcuts ARE active on iPad with keyboard**, which is correct and desirable. | OK |
| **Tab focus order** | Various | Focus-visible styles exist (`.icon-btn:focus-visible` at line 538-543, `.lm-close-btn:focus-visible` at line 4114). Tab navigation with physical keyboard works. However, the PDF viewer's zoom controls and live mode navigation buttons lack explicit `tabindex` ordering — Tab may jump unpredictably. | LOW |
| **Escape key** | `app.js:2802` | Escape closes the live mode overlay. This conflicts with iPadOS system gesture (Escape = Globe key on some keyboards, also used for Stage Manager window management). In practice, the `keydown` event fires before iPadOS intercepts it, so this works fine. | OK |

### Fix approach
1. **Volume slider on iPad with keyboard**: The `@media (hover: none) and (pointer: coarse)` guard is insufficient. Add a JS-based check: if `isIOS()` is true, force-hide the volume slider regardless of pointer/hover media queries. Or: show the slider but add a tooltip "Volume controlled by hardware buttons on this device". Estimated effort: 30min.
2. **Tab order in PDF viewer / live mode**: Add `tabindex` attributes to zoom buttons and navigation buttons in order. Estimated effort: 30min.

### Priority: **MEDIUM** (volume slider is the main issue — confusing UX for iPad + keyboard users)

---

## 3. iOS 15 Degradation

### What it is
iOS 15 (Safari 15.x) shipped Sept 2021. Still ~2% of iOS users as of 2026. Multiple Web APIs are missing or buggy.

### Affected devices
- iPhone 6s, iPhone 7, iPhone SE 1st gen (stuck on iOS 15 — no iOS 16 support)
- Any device whose user chose not to update

### What specifically breaks in our codebase

| Feature | Safari 15 Status | Our Code | Impact | Fallback Sufficient? |
|---------|-------------------|----------|--------|---------------------|
| **`overscroll-behavior: none`** | NOT SUPPORTED | `app.css:211` | Rubber-band bounce scrolling on all pages. Particularly annoying during live mode page swipes — an accidental over-scroll bounces the entire page. | NO — no CSS fallback exists. JS-based prevention (`touchmove` + `preventDefault`) is possible but fragile. |
| **Screen Wake Lock API** | NOT SUPPORTED | `utils.js:432-453` | `navigator.wakeLock` check returns false. Screen dims/locks during PDF viewing and live mode performance. | YES — feature-detected with `if (!('wakeLock' in navigator)) return;`. Graceful no-op. But the USE CASE (reading sheet music on stage) makes this a real pain point for iOS 15 users. |
| **Web Push Notifications** | NOT SUPPORTED | `service-worker.js:339-374` | Push handler exists but iOS 15 has no push permission prompt. Users simply never see notifications. | YES — no crash, feature just doesn't exist. |
| **`navigator.storage.estimate()`** | NOT SUPPORTED | `service-worker.js:193-199` | PDF cache storage check `if (navigator.storage && navigator.storage.estimate)` — condition is false, so the check is SKIPPED. PDFs cache without size guard. Could fill storage silently. | PARTIAL — won't crash but could evict other site data when storage is full. |
| **`color-mix()` in CSS** | NOT SUPPORTED | `app.css:243` | Topbar background. Fallback on line 242 (`rgba(14,14,16,0.85)`) catches this. | YES |
| **`structuredClone()`** | PARTIAL (15.4+) | `utils.js:43-45` | JSON fallback covers iOS 15.0-15.3. | YES |
| **Popover API** | NOT SUPPORTED | Not currently used | N/A | N/A |
| **`AudioWorklet`** | BUGGY (process() output silent) | `metronome.js:36-44` | `_isWebKit()` detection forces fallback scheduler. | YES — explicitly handled |
| **`preservesPitch`** | NOT SUPPORTED (added in Safari 16) | `player.js:360-362` | All three prefixed attempts (`preservesPitch`, `mozPreservesPitch`, `webkitPreservesPitch`) will be no-ops on Safari 15. Pitch WILL shift when speed is changed. Not a crash — just a degraded experience. | PARTIAL — no crash, but pitch shifts are disorienting for musicians. |

### Fix approach
1. **`overscroll-behavior` on iOS 15**: Add `position: fixed; overflow: hidden` on `body` during live mode as a CSS-only fallback. For general pages, accept bounce scrolling. Estimated effort: 30min.
2. **Wake Lock on iOS 15**: Consider the `NoSleep.js` pattern (silent invisible video loop) as a fallback. This is a hack but works on iOS 15. PARK unless iOS 15 users report the issue. Estimated effort: 2hr.
3. **`preservesPitch`**: Show a warning toast when speed is changed on Safari 15: "Pitch correction unavailable on this browser version." Detection: check if `audio.preservesPitch` is `undefined` AND `audio.webkitPreservesPitch` is `undefined`. Estimated effort: 15min.
4. **Storage estimate fallback**: Add a simple `try/catch` with a conservative 50MB cap when `storage.estimate` is unavailable. Estimated effort: 15min.

### Priority: **LOW-MEDIUM** (shrinking user base, but includes stuck devices like iPhone 6s/7)

---

## 4. iOS Lockdown Mode

### What it is
Available since iOS 16. Disables JIT compilation in JavaScriptCore (Safari's JS engine), reducing JS performance by 2-10x. Also blocks WebFonts, restricts WebRTC, and tightens CSP-like protections.

### Affected devices
- Any iOS 16+ device where user has enabled Lockdown Mode (Settings > Privacy & Security > Lockdown Mode)
- Primarily used by journalists, activists, high-profile targets — low adoption

### What in our code is vulnerable

| Area | Impact without JIT | Severity |
|------|-------------------|----------|
| **Levenshtein search** | `utils.js:274-289` — O(n*m) string comparison. With 200+ songs and JIT disabled, `findSimilarSongsSync` could take 200-500ms instead of 20-50ms. The worker version (`findSimilarSongsAsync`) has a 2000ms timeout — may hit it. | MEDIUM |
| **PDF.js rendering** | `pdf-viewer.js` uses `pdf.min.js` which is computation-heavy (canvas draw ops, font parsing). Without JIT, first page render could take 2-5s instead of 0.5-1s. | MEDIUM |
| **Metronome timing** | Fallback scheduler (`setInterval` at 25ms) relies on main thread timing. Without JIT, timer resolution may degrade, causing audible timing drift at high BPMs. AudioWorklet is already disabled on Safari, so the fallback is all we have. | LOW |
| **Web Fonts** | Lockdown Mode blocks web fonts loaded via `@font-face` pointing to external URLs. Our fonts (Inter) are loaded from... need to check. If CDN-loaded, they'll be blocked. If self-hosted, they'll work. | NEEDS CHECK |
| **CRYPTO operations** | `workers/crypto-worker.js` — PBKDF2 runs in a Web Worker. Without JIT in the worker, 100k iterations could take 10-20s instead of 2-3s. This only affects login/register, not ongoing use. | LOW |

### Can we detect Lockdown Mode?
**No reliable detection exists.** Apple deliberately provides no API or header to detect Lockdown Mode. Heuristic approaches:
- Time a known computation and check if it's >5x slower than expected — unreliable and invasive.
- Check if WebFonts loaded (Lockdown Mode blocks external fonts) — only works if fonts are external.
- Check `window.crossOriginIsolated` — not related to Lockdown Mode.

**Recommended approach:** Do NOT detect. Instead, ensure all code paths have reasonable timeouts and progressive rendering so degraded performance doesn't cause hangs or timeouts.

### Fix approach
1. **Increase Levenshtein worker timeout** from 2000ms to 4000ms. The sync fallback already exists. Estimated effort: 5min.
2. **PDF progressive rendering** (already implemented in Phase 3 of pdf-viewer.js — low-res fast render, then high-res). Verify this works well under slowdown. Estimated effort: 0 (already done).
3. **Confirm font loading**: Check if Inter is loaded from CDN or self-hosted. If CDN, add `font-display: swap` and system font fallback. Estimated effort: 15min.

### Priority: **LOW** (tiny user base, existing timeouts cover most cases)

---

## 5. Dynamic Island / Notch Variations

### What it is
Different iPhone models have different top insets:
- **iPhone SE (2nd/3rd gen)**: No notch, no Dynamic Island. `safe-area-inset-top: 20px` (status bar only).
- **iPhone X/XS/11 Pro/12 mini/13 mini**: Notch. `safe-area-inset-top: 47px`.
- **iPhone 14 Pro/15/15 Pro/16/16 Pro**: Dynamic Island (pill shape). `safe-area-inset-top: 59px`.
- **iPhone 14/14 Plus**: Notch (no Dynamic Island). `safe-area-inset-top: 47px`.
- **iPhone SE (1st gen)**: No notch, 20px status bar. `safe-area-inset-top: 20px`.
- **Bottom insets**: 34px on Face ID devices (home indicator), 0px on Touch ID devices.

### What in our code is vulnerable

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **Topbar safe area** | `app.css:161-162` | `--safe-top: env(safe-area-inset-top, 0px)` and `--safe-bottom: env(safe-area-inset-bottom, 0px)` — defined at `:root`. This is correct. The topbar height (`--topbar-h: 90px` at line 160) is a FIXED value that does NOT include the safe area. Actual topbar rendering must ADD safe-top. | OK |
| **Live mode header** | `app.css:4052` | `padding-top: calc(6px + env(safe-area-inset-top, 0px))` — correctly handles all inset sizes. | OK |
| **Live mode nav bar** | `app.css:4249,4281,4299` | All use `calc(Xpx + env(safe-area-inset-bottom, 0px))` — correct. | OK |
| **PDF viewer** | `app.css:3457` | `padding: env(safe-area-inset-top, 20px) 20px calc(20px + env(safe-area-inset-bottom, 0px))` — correctly adapts. | OK |
| **Left/Right safe areas** | `app.css:4040-4041` | `padding-left: env(safe-area-inset-left, 0px)` and `padding-right: env(safe-area-inset-right, 0px)` — only on live mode container. This is important for landscape on iPhone (notch on left/right). | OK |
| **`viewport-fit=cover`** | `index.html:5` | Present. Required for `env(safe-area-inset-*)` to work on iOS. | OK |
| **Dynamic Island overlap** | All | The Dynamic Island is INSIDE the `safe-area-inset-top` zone. Our topbar padding respects this. However, at 59px inset, the topbar becomes very tall. On pages with a search bar + tag filters below the topbar, the above-the-fold content is significantly reduced. On iPhone 16 Pro in PWA mode, ~140px of vertical space is consumed by topbar + safe area before any content. | LOW |
| **Landscape rotation** | `app.css` | No landscape-specific safe-area handling for iPhones. When an iPhone with a notch is in landscape, `safe-area-inset-left` or `safe-area-inset-right` becomes ~47px (notch side). The manifest sets `"orientation": "portrait"` which prevents rotation in PWA mode, but in-browser usage can rotate. | LOW |

### Fix approach
1. **No immediate fixes needed.** Safe area handling is comprehensive and correct.
2. **Consider**: On Dynamic Island devices (59px inset), reduce topbar internal padding to reclaim vertical space. Detection: `env(safe-area-inset-top)` > 50px via JS `getComputedStyle`. PARK — cosmetic only.

### Priority: **LOW** (already well-handled)

---

## 6. Safari Version Matrix

### Feature gaps specific to our codebase

| Feature | Safari 15 | Safari 16 | Safari 16.4 | Safari 17 | Safari 18 | Our Usage |
|---------|-----------|-----------|-------------|-----------|-----------|-----------|
| `overscroll-behavior` | NO | YES | YES | YES | YES | `app.css:211` — bounce scrolling on Safari 15 |
| Screen Wake Lock | NO | NO | YES | YES | YES | `utils.js:432` — screen locks during PDF/live mode on Safari <16.4 |
| Web Push | NO | NO | YES | YES | YES | `service-worker.js:339` — no push on Safari <16.4 |
| `storage.estimate()` | NO | NO | NO | YES | YES | `service-worker.js:193` — no storage check on Safari <17 |
| `color-mix()` | NO | 16.2+ | YES | YES | YES | `app.css:243` — fallback covers Safari <16.2 |
| `preservesPitch` | NO | YES | YES | YES | YES | `player.js:360` — pitch shifts on Safari 15 speed change |
| View Transition API | NO | NO | NO | NO | NO* | `router.js` — feature-detected, fallback instant swap. *Safari 18.2+ has partial support behind flag. |
| Popover API | NO | NO | NO | YES | YES | Not currently used |
| `structuredClone` | 15.4+ | YES | YES | YES | YES | `utils.js:43` — JSON fallback for Safari <15.4 |
| `navigator.storage.persist()` | NO | NO | NO | NO | NO | `app.js:2122` — called with `.catch()`, no-op on Safari |
| Background Sync | NO | NO | NO | NO | NO | `service-worker.js:294` — checked with `self.registration.sync` |
| `AudioWorklet` (working) | BUGGY | BUGGY | BUGGY | PARTIAL | PARTIAL | `metronome.js:44` — correctly skipped on all WebKit |
| Badging API (`setAppBadge`) | NO | NO | YES | YES | YES | `app.js:363` — called with `.catch()`, no-op on older Safari |
| Share Target API | NO | NO | NO | NO | NO | `manifest.json` / `service-worker.js:382` — Safari ignores share_target |
| `navigator.vibrate()` | NO | NO | NO | NO | NO | `utils.js:116` — `_canVibrate` check, no-op on all iOS |
| ResizeObserver | YES | YES | YES | YES | YES | Not directly used but good to note |
| CSS Container Queries | NO | YES | YES | YES | YES | Not currently used |
| `:has()` selector | NO | 15.4+ | YES | YES | YES | Not currently used |

### Key insight
**Safari 16.4 is the real feature cliff.** Below 16.4, three major features (Wake Lock, Push, Badging) are missing. Our fallbacks are sufficient for all cases except Wake Lock during live performance (see iOS 15 section).

### Priority: **LOW** (matrix is informational; specific issues covered in other sections)

---

## 7. iOS WKWebView Isolation

### What it is
On iOS, each "context" runs in its own WKWebView process with isolated storage:
- **Safari** has its own localStorage, cookies, IndexedDB, Cache API
- **PWA (Home Screen)** has its own isolated localStorage, cookies, IndexedDB, Cache API
- **In-app browsers** (Facebook, Instagram, Twitter) have their own isolated storage
- **SFSafariViewController** (used by some apps for "Open in Safari") shares Safari's storage

### Impact on our auth system

| Scenario | What happens | Is this a problem? |
|----------|-------------|-------------------|
| User logs in via Safari, opens PWA | NOT logged in. `ct_auth` localStorage key doesn't exist in PWA context. Must log in again. | EXPECTED. Documented in existing audit (7.7). Not a bug — by design. |
| User logs in via PWA, opens link in Safari | NOT logged in in Safari. | EXPECTED. Auth is per-context. |
| User logs in, closes PWA, reopens PWA | STILL logged in. PWA WKWebView preserves localStorage across app restarts (unless user clears website data). | OK |
| iOS update / storage pressure | iOS may evict PWA storage after 7 days of non-use (changed in iOS 16.4+ with `navigator.storage.persist()`). `ct_auth` token, cached songs, practice data, settings — ALL wiped. | MEDIUM RISK |
| User adds PWA to Home Screen from Chrome/Firefox iOS | Chrome/Firefox on iOS use WKWebView with Safari's storage partition. The PWA opens in its OWN context, separate from both Chrome and Safari. User must log in again in the PWA. | EXPECTED, but confusing for users. |

### Service Worker implications
- Service worker is shared within the same origin within a context. PWA gets its own SW instance separate from Safari's.
- `_audioProxyMap` in the SW is per-context — no cross-contamination.
- SW cache (`catmantrio-v20.24`, `catmantrio-songs`, `catmantrio-pdfs`) is per-context. PDFs cached in Safari are NOT available in the PWA and vice versa.

### Specific code vulnerability

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **Token in localStorage** | `auth.js:30-41` | `_save()` writes to `localStorage`. If iOS evicts storage, user is silently logged out on next open. The `refreshSession()` at init handles this: `_restore()` returns false, `_checked = true`, user sees login screen. | LOW — graceful, but user loses cached songs/practice data too. |
| **`navigator.storage.persist()`** | `app.js:2122` | Called but returns `false` on all Safari versions (Safari does not support persistent storage opt-in). iOS uses its own heuristic (frequency of visits) to decide what to evict. | NO FIX — Apple hasn't implemented this. |
| **IDB + localStorage double-write** | `js/sync.js:168-175` | Songs saved to both IDB and localStorage. If one is evicted, the other may survive (they share the same WKWebView storage pool, but eviction is not always all-or-nothing). | LOW — defense in depth, already implemented. |

### Fix approach
1. **Show a toast on storage loss**: On app init, check if `ct_auth` was expected but missing (e.g., check a separate `ct_auth_existed` flag in a cookie or different storage mechanism). If storage was evicted, show "Session expired, please log in again." Estimated effort: 30min.
2. **No fix possible for `storage.persist()`** — Apple doesn't support it. Document this limitation.

### Priority: **LOW** (existing behavior is correct; storage eviction is rare for frequently-used apps)

---

## 8. Home Screen Web App Limits

### What it is
iOS PWAs ("Home Screen Web Apps") have specific limitations that differ from Safari.

### Storage quotas

| iOS Version | IDB Quota per PWA | Cache API Quota | localStorage Quota | Total Origin Quota |
|-------------|-------------------|-----------------|--------------------|--------------------|
| iOS 15 | ~50MB (some reports say lower) | Shared with IDB | ~5MB | ~50MB |
| iOS 16 | ~100MB (variable) | Shared with IDB | ~5MB | Up to ~500MB |
| iOS 16.4+ | ~500MB-1GB (with frequent use) | Shared with IDB | ~5MB | Up to ~1GB (heuristic) |
| iOS 17+ | ~1GB+ (with `persist()` request, though Safari ignores it — based on usage frequency) | Shared with IDB | ~5MB | Up to several GB |

### What in our code is vulnerable

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **PDF cache growth** | `service-worker.js:187-209` | PDFs cached in Cache API. A single PDF can be 0.5-5MB. With 50+ songs, cache could reach 100MB+. On iOS 15 (50MB limit), this hits the cap. The `storage.estimate()` guard only works on Safari 17+. | HIGH (iOS 15/16) |
| **Audio cache in IDB** | `idb.js` (via `app.js:150-153`) | Audio files cached in IndexedDB. MP3s are typically 3-10MB each. 10 cached audios = 30-100MB. Shares quota with PDF cache. | HIGH (iOS 15/16) |
| **Blob cache in memory** | `app.js:52-53` | `BLOB_CACHE_MAX = 30` blob URLs in memory. On iOS, each blob URL retains the underlying data in the WKWebView process. 30 audio blobs at 5MB each = 150MB process memory. iOS will terminate the PWA process if memory exceeds ~200-300MB. | HIGH |
| **Write queue in localStorage** | `github.js` | Pending write queue serialized to localStorage (5MB limit). Large batch edits could approach this limit. | LOW |

### Background execution limits
- iOS terminates PWA background processes after ~30 seconds.
- No background fetch, no background sync on Safari.
- The `REGISTER_SYNC` handler in SW (line 293-298) correctly checks `self.registration.sync` which is `undefined` on Safari — no crash.
- If user switches apps during a bulk PDF prefetch (`PREFETCH_PDFS`), the SW may be terminated mid-download. Partially cached PDFs could be corrupt.

### Notification quirks (iOS 16.4+)
- Push notifications require BOTH: (1) the PWA is added to Home Screen, AND (2) the user grants notification permission.
- The permission prompt only appears if triggered by a user gesture (button click).
- Notifications delivered when the PWA is closed show as regular iOS notifications but tapping them may take 2-3 seconds to cold-start the PWA.
- Badge count (`setAppBadge`) works on iOS 16.4+ but only updates when the PWA is in the foreground.

### Fix approach
1. **Add aggressive PDF cache eviction on iOS**: Check if `isIOS()` and total PDF cache > 30MB, evict oldest entries. Use the `GET_PDF_CACHE_SIZE` SW message. Estimated effort: 1hr.
2. **Reduce BLOB_CACHE_MAX on iOS**: If `isIOS()`, set `BLOB_CACHE_MAX = 15` instead of 30. Estimated effort: 10min.
3. **Prefetch resilience**: Mark prefetch as "in progress" and on next open, check for incomplete downloads (e.g., PDF blobs that are too small to be valid). Estimated effort: 1hr. PARK.

### Priority: **HIGH** (storage limits on iOS 15/16 are tight; blob memory pressure can crash the PWA)

---

## 9. iOS Audio Autoplay

### What it is
iOS Safari and PWAs require a user gesture (tap, click) to start audio playback. The first `audio.play()` call MUST originate from a user-initiated event handler call stack. After the first gesture-initiated play, subsequent plays may be allowed without a gesture (until the AudioContext is suspended by the OS).

### Exact trigger requirements
1. `audio.play()` must be called within a `click`, `touchend`, `pointerup`, or `keydown` event handler.
2. The event must be `isTrusted: true` (not dispatched via `dispatchEvent()`).
3. If `AudioContext` state is `suspended`, `ctx.resume()` must also be called from a user gesture.
4. In PWA mode, audio plays slightly more permissively — the first gesture "unlocks" audio for the session.

### What in our code is vulnerable

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **Play button handler** | `player.js:521-561` | Play button click calls `audio.play()` directly in the `click` handler. This is correct — user gesture chain is maintained. The `.catch()` handler properly resets UI if play is rejected. | OK |
| **Media Session play action** | `player.js:580` | `navigator.mediaSession.setActionHandler('play', _msPlay)` — the Media Session play action (lock screen play button) calls `playBtn.click()` which triggers the click handler. On iOS, Media Session actions ARE considered user gestures. | OK |
| **Metronome start** | `metronome.js:108-161` | `start()` is `async` — called from a button click in the UI. `ctx.resume()` is called on line 118. Because `start()` is called in the same microtask as the click, this works. However, if `_initWorklet()` takes too long (line 123), the gesture may be "consumed" by the time `ctx.resume()` runs, causing a silent failure. | MEDIUM |
| **A/B Loop replay** | `player.js:307` | `audio.play().catch(...)` called from `ended` event — NOT a user gesture. On iOS, this works because the AudioContext was already unlocked by the initial play gesture. But if the PWA was backgrounded and foregrounded between loops, iOS may have suspended the AudioContext. | LOW |
| **Audio proxy setup** | `player.js:121-138` | The `async` IIFE that sets up the iOS audio proxy runs in the background. If it updates `audio.src` after the user has already pressed play, it could interrupt playback. The `if (audio.paused)` guard on line 130 prevents this. | OK |
| **2A proxy blob fetch** | `player.js:124` | `fetch(blobUrl)` inside the async proxy setup. On iOS, this fetch is fine because it's reading a local blob URL, not network. | OK |

### Gap: Metronome gesture timing
The metronome's `start()` function does `await _initWorklet()` which includes `await ctx.audioWorklet.addModule(...)`. On Safari, this is skipped (WebKit detection), so the `_getCtx()` + `ctx.resume()` call is the critical path. But `ctx.resume()` returns a Promise and the function `await`s it. The user gesture is consumed by the first `await` — if `ctx.state === 'suspended'`, the `await ctx.resume()` MUST be the first async operation after the gesture.

**Current code analysis**: On Safari/iOS, `_initWorklet()` immediately throws in the `try` block (`_isWebKit()` returns true), setting `_mode = 'fallback'` synchronously. Then back in `start()`, `ctx.resume()` on line 118 runs synchronously in the gesture context. This is fine.

**Edge case**: If `_mode` is already `'fallback'` from a previous start, `_initWorklet()` is skipped entirely (line 122-124), and `ctx.resume()` runs immediately. Also fine.

### Fix approach
1. **No immediate fixes needed.** Audio autoplay handling is robust.
2. **Consider**: Pre-unlock AudioContext on first user interaction anywhere in the app (not just play button). Add a one-time `touchend` listener that calls `new AudioContext().resume()`. This ensures the metronome and audio work on first press, not second. Estimated effort: 15min. LOW priority.

### Priority: **LOW** (well-handled; metronome edge case is theoretical)

---

## 10. iPhone SE / Smaller Screens

### What it is
- **iPhone SE 1st gen** (2016): 320px viewport width, 568px height
- **iPhone SE 2nd gen** (2020): 375px viewport width, 667px height
- **iPhone SE 3rd gen** (2022): 375px viewport width, 667px height
- **iPhone 12/13 mini**: 375px viewport width, 812px height (with notch)

### What in our code is vulnerable

| Area | File | Issue | Severity |
|------|------|-------|----------|
| **No 320px breakpoint** | `app.css` | Smallest breakpoint is `max-width: 340px` (line 6068) and `max-width: 360px` (line 5621). iPhone SE 1st gen at 320px falls below both. Any element with fixed px widths > 320px will overflow. | MEDIUM |
| **Song card layout** | `app.css:400` | `@media (max-width: 380px)` adjusts song cards. At 320px, card padding + title + buttons must fit in 320px minus scrollbar minus body padding. With 16px body padding on each side, content area is 288px. | MEDIUM |
| **Topbar at 320px** | `app.css` | Topbar contains: back button + title + right buttons. At 320px, long page titles overflow. The title uses `text-overflow: ellipsis` (not verified — need to check). | MEDIUM |
| **Form inputs at 320px** | `app.css` | Form inputs have `max-width: 100%` but some hardcoded widths exist: `.link-platform-select` at 13px font (fine), `.settings-select` at 13px font (fine). Likely OK but untested. | LOW |
| **Live mode at 320px** | `app.css:4274` | `@media (max-width: 600px)` reduces live mode padding. At 320px, PDF pages are 288px wide after padding — readable for lead sheets but very tight for dense charts. | MEDIUM |
| **Modal dialogs** | `app.css` | Modals use `max-width: min(420px, 90vw)`. At 320px, modal is 288px wide. Login form with two fields + labels + buttons fits. Edit song form with many fields might feel cramped. | LOW |
| **Metronome BPM display** | Various | BPM controls (tap button + slider + display) in a row. At 320px, likely needs wrapping. | LOW |
| **Tag filter chips** | `app.css:1454-1460` | At `max-width: 500px`, chip font is `11px`. At 320px, multiple chips may wrap to 3-4 lines, consuming significant vertical space. | LOW |

### Fix approach
1. **Add `@media (max-width: 320px)` breakpoint** with: reduced body padding (12px instead of 16px), smaller topbar, compressed tag chips. Estimated effort: 1hr.
2. **Test in 320px viewport** (Chrome DevTools, iPhone SE 1st gen preset). Fix any overflows. Estimated effort: 30min.
3. **Consider**: iPhone SE 1st gen max iOS is 15.8. The intersection of "320px viewport" AND "iOS 15" is a very small user group. Prioritize accordingly.

### Priority: **LOW-MEDIUM** (iPhone SE 1st gen is legacy; 375px devices are well-covered by existing breakpoints)

---

## 11. Low Power Mode

### What it is
iOS Low Power Mode reduces CPU/GPU clock speeds, disables background app refresh, reduces display brightness, and throttles some APIs. Users can enable it at any time or it auto-activates at 20% battery.

### Impact on our code

| Area | Effect | Severity |
|------|--------|----------|
| **Service Worker** | SW is NOT terminated by Low Power Mode. Cache operations and fetch interception continue normally. However, SW `sync` events (Background Sync) are delayed — irrelevant since Safari doesn't support Background Sync anyway. | NONE |
| **`requestAnimationFrame`** | rAF is throttled to 30fps instead of 60fps. Affects: player progress bar animation (`player.js:422-443`), A/B loop precision, live mode carousel transitions. At 30fps, the player progress update runs every ~33ms instead of ~16ms — still smooth enough. A/B loop precision drops to ~33ms — acceptable. | LOW |
| **Audio playback** | Audio decoding and playback continue normally. No impact on `audio.play()`, `AudioContext`, or `OscillatorNode`. | NONE |
| **CSS animations/transitions** | iOS may throttle CSS animations to 30fps. Our 0.15s transitions and `@keyframes` animations are short enough that 30fps vs 60fps is imperceptible. | NONE |
| **Wake Lock** | Wake Lock (`navigator.wakeLock`) behavior is UNCHANGED in Low Power Mode. If acquired, the screen stays on. The OS respects the Wake Lock regardless of power mode. | NONE |
| **Network requests** | Fetch requests are NOT throttled in Low Power Mode (they are throttled when in airplane mode or poor signal). API calls to the Cloudflare Worker are unaffected. | NONE |
| **WebGL / Canvas rendering** | GPU is clock-reduced. PDF rendering on canvas may take 20-50% longer. With our progressive rendering (Phase 3: low-res first, then high-res), the user sees a blurry page faster, then sharp page slightly delayed. | LOW |
| **Timer accuracy** | `setInterval` and `setTimeout` may have slightly reduced accuracy. The metronome fallback scheduler uses `setInterval(25ms)` with lookahead scheduling — the scheduling algorithm compensates for timer drift by scheduling notes based on AudioContext.currentTime, not timer timing. | NONE |

### Can we detect Low Power Mode?
**No.** There is no API to detect Low Power Mode on iOS. The `navigator.getBattery()` API is not available on iOS Safari. No media query exists for power mode.

### Fix approach
**No fixes needed.** Low Power Mode has minimal impact on our app. The most significant effect (rAF throttling) is handled gracefully — 30fps is sufficient for all our animation needs.

### Priority: **NONE** (no action needed)

---

## 12. iOS Focus / Zoom Behavior

### What it is
iOS Safari auto-zooms to input fields on focus if the computed font-size is less than 16px. This applies to `<input>`, `<textarea>`, `<select>`, and `contenteditable` elements. The viewport meta tag `maximum-scale=1, user-scalable=no` previously prevented this zoom, but Safari 10+ ignores these attributes for accessibility reasons (users must always be able to zoom).

### What in our code is vulnerable

| Element | File | Font Size | Zooms? | Severity |
|---------|------|-----------|--------|----------|
| `#search-input` | `app.css:856` | `16px` | NO | OK |
| `.form-input` | `app.css:1954` | `max(16px, 14px)` = 16px | NO | OK |
| `.form-input textarea` | `app.css:1965` | Inherits from `.form-input` = 16px | NO | OK |
| Modal inputs | `app.css:2322,2364` | `16px` | NO | OK |
| `.link-platform-select` | `app.css:2129-2139` | **`13px`** | **YES** | **HIGH** |
| `.settings-select` | `app.css:5262-5267` | **`13px`** | **YES** | **HIGH** |
| `.settings-number` | `app.css:5277-5282` | **`13px`** | **YES** | **HIGH** |
| `.wc-select` | `app.css:6313` | Likely inherits or custom — needs check | LIKELY YES | MEDIUM |
| `.wc-ref-link-type-select` | `app.css:6699` | Likely inherits | LIKELY YES | MEDIUM |
| `.wc-section-type-select` | `app.css:6770` | Likely inherits | LIKELY YES | MEDIUM |
| `.instrument-picker .select-input` | `app.css:7058` | Needs check | POSSIBLY | MEDIUM |
| Live mode search input | `app.css:4167,4240` | `16px` | NO | OK |
| GitHub config inputs | `app.css:3687` | `16px` | NO | OK |
| Setlist notes textarea | `app.css:1252` | Needs check — likely inherits | POSSIBLY | MEDIUM |
| `.practice-note-input` | `app.css:3208` | Needs check | POSSIBLY | MEDIUM |

### The zoom behavior in detail
When a user taps a `<select>` with `font-size: 13px`, iOS:
1. Zooms the viewport to make the select appear at 16px
2. Opens the native picker wheel overlay
3. After dismissing the picker, the viewport stays zoomed
4. User must manually pinch-to-zoom back out OR tap elsewhere

This is extremely disorienting in a single-page app — the zoomed state persists across navigation, breaking the layout until the user manually unzooms.

### `contenteditable` elements
The app does not appear to use `contenteditable` elements directly. Player.js checks for `e.target.isContentEditable` (line 674) in the keyboard handler to skip shortcuts, which is defensive coding — good.

### Fix approach
1. **Set all `<select>` elements to `font-size: 16px`**: Update `.link-platform-select`, `.settings-select`, `.settings-number`, `.wc-select`, `.wc-ref-link-type-select`, `.wc-section-type-select`, `.instrument-picker .select-input` to `font-size: 16px`. Use `transform: scale(0.8125)` with appropriate `transform-origin` if the visual size needs to remain small. Estimated effort: 30min.
2. **Audit all remaining input-like elements**: grep for `<select`, `<textarea`, `contenteditable` in `index.html` and JS files, verify all have 16px font-size. Estimated effort: 15min.

### Priority: **HIGH** (affects every iOS user who interacts with select elements in settings, edit forms, or wikicharts)

---

## 13. Summary & Priority Matrix

### Critical (fix now)

| # | Issue | Section | Effort | Impact |
|---|-------|---------|--------|--------|
| **C1** | `<select>` elements at 13px font-size cause iOS auto-zoom | 12 | 30min | Every iOS user touching settings/edit forms |
| **C2** | iPad + Magic Keyboard: volume slider shows but does nothing (`audio.volume` read-only) | 2 | 30min | iPad + keyboard users |
| **C3** | iOS 15/16 PDF cache can exceed storage quota (50-100MB limit), no eviction | 8 | 1hr | iOS 15/16 users with many songs |
| **C4** | BLOB_CACHE_MAX=30 can consume 150MB+ process memory, causing iOS to kill PWA | 8 | 10min | All iOS users with many audio files |

### Important (fix soon)

| # | Issue | Section | Effort | Impact |
|---|-------|---------|--------|--------|
| **I1** | Stage Manager window resize doesn't trigger PDF/live-mode re-render | 1 | 2hr | iPad Pro + Stage Manager users |
| **I2** | No `@media (max-width: 320px)` breakpoint for iPhone SE 1st gen | 10 | 1hr | iPhone SE 1st gen (tiny user base) |
| **I3** | `overscroll-behavior` unsupported on iOS 15 — bounce scrolling in live mode | 3 | 30min | iOS 15 users in live mode |
| **I4** | `preservesPitch` unsupported on Safari 15 — pitch shifts on speed change | 3 | 15min | iOS 15 users using practice speed |

### Low priority / Monitor

| # | Issue | Section | Effort | Impact |
|---|-------|---------|--------|--------|
| **L1** | Lockdown Mode: increase Levenshtein worker timeout to 4000ms | 4 | 5min | Lockdown Mode users |
| **L2** | Storage eviction after 7 days of non-use — show "session expired" toast | 7 | 30min | Infrequent users |
| **L3** | Dynamic Island: large safe-area-inset-top reduces content area | 5 | 1hr | iPhone 14 Pro+ |
| **L4** | Tab focus order in PDF viewer / live mode for iPad keyboard | 2 | 30min | iPad keyboard users |
| **L5** | Pre-unlock AudioContext on first user interaction | 9 | 15min | All iOS users (marginal improvement) |
| **L6** | SW PDF prefetch may be interrupted by iOS backgrounding | 8 | 1hr | Users who trigger bulk prefetch then switch apps |
| **L7** | Wake Lock on iOS 15: consider NoSleep.js pattern | 3 | 2hr | iOS 15 users in live mode |

### No action needed

| Area | Reason |
|------|--------|
| Low Power Mode | Minimal impact, all animations/audio/SW work normally |
| Dynamic Island / notch safe areas | Already correctly handled with `env(safe-area-inset-*)` |
| iOS audio autoplay | Correctly gated behind user gestures |
| WKWebView cookie isolation | Expected behavior, auth flow handles it |
| Safari keyboard shortcuts | iPadOS correctly reports as desktop, shortcuts work |
| Metronome on iOS | WebKit detection + OscillatorNode fallback is robust |

---

### Total estimated effort for all Critical + Important fixes: ~5.5 hours
### Total estimated effort for Critical fixes only: ~2 hours
