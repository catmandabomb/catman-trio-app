# Device & Browser Compatibility Audit — Catman Trio App

**Date:** 2026-03-20
**App Version:** v20.23
**Architecture:** Vanilla JS PWA (no framework, no build tools)

---

## Table of Contents

1. [Device Coverage Matrix](#1-device-coverage-matrix)
2. [Browser Engine Support Table](#2-browser-engine-support-table)
3. [PWA Feature Compatibility](#3-pwa-feature-compatibility)
4. [Current Code Audit Findings](#4-current-code-audit-findings)
5. [Critical Gaps](#5-critical-gaps)
6. [Recommendations](#6-recommendations)
7. [Weird Edge Cases](#7-weird-edge-cases)

---

## 1. Device Coverage Matrix

### Global Device Market Share (2025-2026 estimates)

| Device Category | Examples | Est. Global % | Our Support Status |
|---|---|---|---|
| **Android phones** | Samsung Galaxy S/A series, Pixel, Xiaomi, OnePlus | ~45% | GOOD — tested, but Samsung Internet overlooked |
| **iPhones** | iPhone 12-16 (iOS 16-18) | ~27% | GOOD — iOS-specific audio proxy, safe areas |
| **iPads** | iPad Air/Pro, iPad mini (iPadOS 16-18) | ~5% | GOOD — explicit iPadOS detection, landscape PDF |
| **Android tablets** | Samsung Galaxy Tab, Lenovo Tab | ~3% | PARTIAL — no tablet-specific layout optimizations |
| **Windows desktops/laptops** | Various (Chrome/Edge/Firefox) | ~12% | GOOD — desktop centering, keyboard shortcuts |
| **macOS desktops/laptops** | MacBook, iMac (Safari/Chrome) | ~5% | GOOD — works well in browser |
| **Linux desktops** | Various distros (Chrome/Firefox) | ~2% | GOOD — no special handling needed |
| **Chromebooks** | Various (Chrome OS) | ~1% | PARTIAL — touch + keyboard hybrid not tested |
| **Foldable phones** | Samsung Galaxy Z Fold/Flip | ~0.5% | UNKNOWN — no viewport change handling |
| **Low-end Android** | Sub-$150 phones, Android Go | ~8% | AT RISK — blob cache + PDF rendering may strain |
| **Wearables/TV** | Smart TVs, watches | <0.5% | NOT SUPPORTED (acceptable) |

### Operating System Breakdown

| OS | Global Share | Status |
|---|---|---|
| Android 12-15 | ~40% | Supported |
| Android 10-11 | ~10% | Supported (WebView limits on 10) |
| Android 9 and below | ~5% | Partial (ES module support varies) |
| iOS/iPadOS 17-18 | ~22% | Fully supported |
| iOS/iPadOS 16 | ~5% | Supported |
| iOS/iPadOS 15 | ~2% | Supported with caveats (PWA limits) |
| Windows 10/11 | ~14% | Fully supported |
| macOS 13-15 | ~4% | Fully supported |
| macOS 12 | ~1% | Supported |
| Linux | ~2% | Supported |
| Chrome OS | ~1% | Supported |

---

## 2. Browser Engine Support Table

### Browser Engine Market Share (2025-2026)

| Engine | Browsers | Global Desktop % | Global Mobile % |
|---|---|---|---|
| **Blink (Chromium)** | Chrome, Edge, Opera, Brave, Samsung Internet, Vivaldi | ~78% | ~65% |
| **WebKit** | Safari, ALL iOS browsers (Chrome/Firefox/Edge on iOS use WebKit) | ~9% | ~30% |
| **Gecko** | Firefox (desktop), Firefox on Android | ~3% | ~0.5% |

### Feature-by-Feature Browser Support

| Feature | Chrome 90+ | Safari 16+ | Safari 15 | Firefox 100+ | Samsung Internet 20+ | Chrome Android | Notes |
|---|---|---|---|---|---|---|---|
| **ES Modules** (`type="module"`) | YES | YES | YES | YES | YES | YES | App requires this |
| **Service Workers** | YES | YES | Partial | YES | YES | YES | Safari 15: limited cache quota |
| **Cache API** | YES | YES | YES | YES | YES | YES | |
| **Web App Manifest** | YES | Partial | Partial | YES | YES | YES | Safari: limited manifest fields |
| **`beforeinstallprompt`** | YES | NO | NO | NO | YES | YES | Safari/Firefox never fire this |
| **Push Notifications** | YES | iOS 16.4+ | NO | YES | YES | YES | Safari needs web push setup |
| **Background Sync** | YES | NO | NO | NO | YES | YES | App handles gracefully |
| **View Transition API** | YES (111+) | NO | NO | YES (133+) | YES (recent) | YES | **App uses with fallback** |
| **`backdrop-filter`** | YES | YES | YES | YES | YES | YES | Needs `-webkit-` prefix |
| **`overscroll-behavior`** | YES | YES (16+) | NO | YES | YES | YES | Safari 15 ignores it |
| **`color-mix()`** | YES (111+) | YES (16.2+) | NO | YES (113+) | YES | YES | Used for topbar bg |
| **`env(safe-area-inset-*)`** | YES | YES | YES | YES | YES | YES | |
| **Web Audio API** | YES | YES | YES | YES | YES | YES | Autoplay restrictions vary |
| **AudioWorklet** | YES | Buggy | NO | YES | YES | YES | App skips on WebKit (good) |
| **`AudioContext`** | YES | YES | Partial | YES | YES | YES | Needs `webkitAudioContext` fallback |
| **MediaSession API** | YES | YES (15+) | YES | YES | YES | YES | |
| **Screen Wake Lock** | YES | YES (16.4+) | NO | YES (126+) | YES | YES | App uses with feature detection |
| **IndexedDB** | YES | YES | YES | YES | YES | YES | |
| **`structuredClone()`** | YES (98+) | YES (15.4+) | Partial | YES (94+) | YES | YES | App has JSON fallback |
| **`ResizeObserver`** | YES | YES (13.1+) | YES | YES (69+) | YES | YES | |
| **`IntersectionObserver`** | YES | YES (12.2+) | YES | YES (55+) | YES | YES | |
| **OffscreenCanvas** | YES | NO (2D) | NO | YES | YES | YES | App detects and falls back |
| **Pointer Events** | YES | YES (13+) | YES | YES | YES | YES | |
| **`navigator.vibrate()`** | YES | NO | NO | YES | YES | YES | App gracefully degrades |
| **Share Target API** | YES | NO | NO | NO | YES | YES | Manifest + SW handler |
| **`navigator.storage.persist()`** | YES | NO | NO | YES | YES | YES | App calls with `.catch()` |
| **`navigator.storage.estimate()`** | YES | YES (17+) | NO | YES | YES | YES | SW uses for PDF cache sizing |
| **Popover API** | YES (114+) | YES (17+) | NO | YES (125+) | YES | YES | Not currently used |
| **CSS Anchor Positioning** | YES (125+) | NO | NO | NO | NO | YES | Not currently used |
| **`preservesPitch`** | YES | YES (16+) | NO | YES | YES | YES | App uses with `mozPreservesPitch` + `webkitPreservesPitch` fallbacks |

---

## 3. PWA Feature Compatibility

### Install Experience by Platform

| Platform | Install Mechanism | Status in App |
|---|---|---|
| Chrome (Android) | `beforeinstallprompt` + install banner | IMPLEMENTED — custom banner + button |
| Chrome (Desktop) | `beforeinstallprompt` + address bar icon | IMPLEMENTED |
| Samsung Internet | `beforeinstallprompt` | IMPLEMENTED (shares Chrome path) |
| Safari (iOS) | Manual "Add to Home Screen" only | IMPLEMENTED — custom iOS hint modal |
| Safari (macOS) | Dock option (Safari 17+) | NOT HANDLED — no macOS-specific hint |
| Firefox (Android) | Add to Home Screen (no prompt API) | NOT HANDLED — no Firefox install hint |
| Firefox (Desktop) | No PWA install support | N/A |
| Edge (Desktop) | `beforeinstallprompt` | IMPLEMENTED (shares Chrome path) |
| Edge (Android) | Uses Chromium engine | IMPLEMENTED |

### PWA Install Gate Analysis

The app has an **install gate** (`_showInstallGate()` at line 2073 of `app.js`) that blocks mobile browser users from accessing the app unless installed as a PWA. This is aggressive but intentional for the use case.

**Potential issue:** The `isPWAInstalled()` check relies on:
1. `window.navigator.standalone` (iOS only)
2. `matchMedia('(display-mode: standalone)')` (Chrome/Android)
3. `document.referrer.includes('android-app://')` (TWA)

This covers the major cases well. However, `display-mode: minimal-ui` is also checked, which is good for edge cases.

### Offline Capabilities

| Feature | Implementation | Status |
|---|---|---|
| App shell caching | Service worker `SHELL_ASSETS` array | GOOD |
| Song data caching | SW message-based cache/retrieve | GOOD |
| PDF caching | Dedicated `catmantrio-pdfs` cache with storage checks | GOOD |
| Audio caching | IndexedDB via `idb.js` | GOOD |
| Offline write queue | `github.js` write queue with Background Sync | GOOD |
| Network detection | `navigator.onLine` + queue indicator badge | GOOD |

---

## 4. Current Code Audit Findings

### What the App Handles Well

1. **iOS Safari audio proxy (2A pattern):** Sophisticated service-worker-based audio proxy that converts `blob:` URLs to real URL paths for iOS Safari. Includes Range request support for seeking. This is excellent and handles a real iOS bug.

2. **Safe area insets:** Used throughout — topbar (`var(--safe-top)`), live mode (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`), PDF viewer, and navigation bars. `viewport-fit=cover` is set in the meta tag.

3. **View Transition API:** Properly feature-detected via `document.startViewTransition` check (router.js line 216). Falls back to instant swap. `prefers-reduced-motion` is respected both in CSS and JS.

4. **AudioWorklet fallback:** Metronome properly detects WebKit (Safari) and falls back to `setInterval` + `OscillatorNode` scheduler. Safari's AudioWorklet `process()` output bug is documented and avoided.

5. **`webkitAudioContext` fallback:** `new (window.AudioContext || window.webkitAudioContext)()` in metronome.js. This covers Safari versions that still use the prefixed API.

6. **OffscreenCanvas detection:** `pdf-viewer.js` detects `OffscreenCanvas` availability and has notes about iOS Safari's broken 2D context. Falls back to DOM canvas rendering.

7. **`-webkit-` CSS prefixes:** Present for `backdrop-filter`, `tap-highlight-color`, `overflow-scrolling`, `text-size-adjust`, `user-select`, `font-smoothing`, slider pseudo-elements, and `-webkit-line-clamp`.

8. **Reduced motion:** Two `@media (prefers-reduced-motion: reduce)` blocks — one for view transitions (line 106), one global reset of all animations/transitions (line 6049). Also checked in JS via `matchMedia`.

9. **High contrast:** `@media (prefers-contrast: more)` support with adjusted colors (line 6016).

10. **Print stylesheet:** Hides UI chrome, adjusts colors (line 5641).

11. **Input font-size 16px:** Prevents iOS/Android auto-zoom on input focus (lines 3619, 1950).

12. **`touch-action: manipulation`:** Applied to interactive elements to eliminate 300ms tap delay.

13. **Error recovery:** Audio error handler with visual indicator, global `window.onerror` + `unhandledrejection` capture with localStorage logging.

14. **`playsinline` + `webkit-playsinline`:** Set on audio elements to prevent fullscreen playback on iOS.

15. **`preservesPitch` triple prefix:** `audio.preservesPitch`, `audio.mozPreservesPitch`, `audio.webkitPreservesPitch` — covers all browsers for speed-changed audio.

16. **Clipboard fallback:** `document.execCommand('copy')` fallback for browsers without `navigator.clipboard` API.

17. **Media Session API:** Properly feature-detected and used for lock screen controls.

18. **iPad detection:** Correctly detects iPadOS via `navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1` (iPadOS reports as macOS since iPadOS 13).

### What's Partially Handled

1. **Mobile detection via UA sniffing:** Multiple places use `navigator.userAgent` regex tests (player.js line 670, app.js line 2812, pdf-viewer.js line 41, utils.js lines 178-213). While this works today, UA strings are increasingly unreliable. The app mixes UA sniffing with proper feature detection (e.g., `navigator.maxTouchPoints`, `matchMedia`), which is fine but inconsistent.

2. **`overscroll-behavior: none`:** Set on `html, body` (line 211) which works on Chrome/Firefox but was only added to Safari in version 16. Safari 15 will ignore it, allowing bounce scrolling.

3. **`color-mix()` in CSS:** Used for topbar background (line 243). Not supported in Safari 15, Chrome < 111, Firefox < 113. There IS a fallback on line 242 (`rgba(14,14,16,0.85)`) which is the correct pattern — the `color-mix` line overrides it in supporting browsers.

4. **Volume control on iOS:** `audio.volume` is read-only on iOS. The app has a try/catch (player.js line 113) but the master volume slider will appear non-functional on iOS, which could confuse users.

5. **Haptic feedback:** `navigator.vibrate()` is NOT supported on iOS Safari. The app correctly no-ops via `_canVibrate` check, but users get no tactile feedback on iPhones/iPads.

---

## 5. Critical Gaps

### GAP 1: Samsung Internet Browser Not Specifically Tested
**Impact: HIGH (5-8% of mobile users globally)**

Samsung Internet is the 3rd most popular mobile browser. It uses Blink (Chromium) so most features work, BUT:
- Some Samsung Internet versions have quirks with `blob:` URL handling
- Samsung Internet has its own content blocking ("Smart Anti-Tracking") that could interfere with Cloudflare Worker API calls
- The install prompt (`beforeinstallprompt`) fires but Samsung Internet's mini-app install flow differs from Chrome's

**Current code impact:** The iOS Safari audio proxy explicitly excludes non-Safari browsers on iOS (`!/CriOS|FxiOS|OPiOS|EdgiOS/`), but Samsung Internet on Android shares the standard Chromium audio path, which is correct.

### GAP 2: Firefox on Android — No Install Hint
**Impact: MODERATE (0.5-1% of mobile users)**

Firefox on Android supports "Add to Home Screen" but does NOT fire `beforeinstallprompt`. The app shows iOS install hints but has NO Firefox-specific install guidance. Given the install gate blocks mobile browser access, Firefox Android users will see the install gate but with only a generic "install" message — no specific instructions.

### GAP 3: Foldable Device Viewport Changes
**Impact: MODERATE-LOW (~0.5% but growing)**

Samsung Galaxy Z Fold/Flip devices change viewport dimensions when folded/unfolded. The app has:
- No `visualViewport` resize listener
- No `screen.orientation` change handler
- No `resize` event handling for layout recalculation

The PDF viewer and live mode carousel could break or render incorrectly when the viewport suddenly changes from ~370px to ~712px (Fold) mid-use.

### GAP 4: `navigator.platform` Deprecation
**Impact: FUTURE (all browsers eventually)**

`navigator.platform` is deprecated. The app uses it for iPadOS detection:
```js
navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
```
This still works today but Chrome has been returning empty strings in some contexts. The `navigator.userAgentData` API is the replacement, but Safari doesn't support it yet. This creates a catch-22. For now this is fine, but needs monitoring.

### GAP 5: Safari 15 CSS Incompatibilities
**Impact: LOW-MODERATE (~2% of iOS users)**

Safari 15 doesn't support:
- `overscroll-behavior` (bounce scrolling not preventable)
- `color-mix()` (fallback exists but only for topbar)
- Screen Wake Lock API (PDFs/live mode may sleep the screen)
- Push Notifications
- `navigator.storage.estimate()` (SW PDF cache size check fails silently)

The app generally degrades gracefully, but there's no explicit Safari 15 testing path.

### GAP 6: Low-End Android Devices — Memory Pressure
**Impact: MODERATE (8% of global users)**

The app caches up to 30 blob URLs in memory (`BLOB_CACHE_MAX = 30`), renders PDFs to full-resolution canvases, and maintains a render cache in `pdf-viewer.js`. On devices with 2-3GB RAM running Android Go:
- The blob LRU cache could consume 100-200MB if audio files are large
- PDF canvas rendering at high DPR could crash the tab
- No `memory` pressure event handling (Chrome's `navigator.deviceMemory` could be used to reduce cache size)

### GAP 7: Missing `scrollbar-width` for Firefox
**Impact: LOW**

The CSS only styles scrollbars via `::-webkit-scrollbar` pseudo-elements (line 3676-3678). Firefox uses the standard `scrollbar-width` and `scrollbar-color` properties. Firefox users will see the default system scrollbar instead of the custom thin one.

### GAP 8: No `manifest.json` `id` Field
**Impact: LOW (future-proofing)**

The manifest lacks an `id` field. Chrome now recommends including `id` to ensure stable PWA identity across URL changes. Without it, if the `start_url` ever changes, Chrome may treat it as a different app.

### GAP 9: Manifest Icon `purpose` — Combined `any maskable`
**Impact: LOW-MODERATE**

Both icons use `"purpose": "any maskable"`. Best practice (per Google/web.dev) is to provide SEPARATE icons for `any` and `maskable` because maskable icons need safe-zone padding that looks wrong when used as regular icons (and vice versa). A maskable icon used as `any` will have excessive padding, and a regular icon used as `maskable` may get clipped.

### GAP 10: No `orientation` Lock Handling in JS
**Impact: LOW**

The manifest sets `"orientation": "portrait"` but this only applies when installed as a PWA. In-browser usage on tablets (especially iPad) will freely rotate to landscape. The CSS has desktop breakpoints (1024px) but no explicit orientation-specific media queries for tablets in landscape (768px-1023px range in landscape).

---

## 6. Recommendations

### Priority 1: Critical (Fix Now)

| # | Issue | Fix | Effort |
|---|---|---|---|
| 1.1 | **Firefox Android install hint** | Add Firefox-specific install instructions to the install gate. Detect Firefox via `navigator.userAgent` containing `Firefox` but not `Seamonkey`. Show "Tap the 3-dot menu, then 'Install'" | 30 min |
| 1.2 | **Separate maskable icons** | Create a maskable version of `icon-192.png` and `icon-512.png` with proper safe-zone padding. Update manifest with separate entries: `"purpose": "any"` and `"purpose": "maskable"` | 1 hr |
| 1.3 | **iOS volume slider visibility** | Hide or disable the master volume slider on iOS (where `audio.volume` is read-only). Show a tooltip explaining iOS controls volume via hardware buttons | 30 min |

### Priority 2: Important (Fix Soon)

| # | Issue | Fix | Effort |
|---|---|---|---|
| 2.1 | **Firefox scrollbar styling** | Add `scrollbar-width: thin; scrollbar-color: var(--border-light) transparent;` to the `html` or `:root` selector alongside the existing `-webkit-scrollbar` rules | 10 min |
| 2.2 | **Foldable viewport handling** | Add a `visualViewport.resize` listener that triggers PDF re-render and carousel recalculation. Also handle `screen.orientation?.addEventListener('change', ...)` | 2 hr |
| 2.3 | **Low-memory device mitigation** | Check `navigator.deviceMemory` (Chromium-only) and reduce `BLOB_CACHE_MAX` to 10 on devices with <= 4GB RAM. Cap PDF render DPR to 1.5 on low-memory devices | 1 hr |
| 2.4 | **Manifest `id` field** | Add `"id": "catman-trio"` to `manifest.json` | 5 min |
| 2.5 | **Samsung Internet testing path** | Document Samsung Internet as a test target. Its "Smart Anti-Tracking" feature can block third-party requests — verify Cloudflare Worker API calls aren't affected | 2 hr |
| 2.6 | **macOS Safari install hint** | Safari 17+ supports "Add to Dock" for PWAs. Detect macOS Safari and show an appropriate hint similar to the iOS one | 45 min |

### Priority 3: Nice to Have

| # | Issue | Fix | Effort |
|---|---|---|---|
| 3.1 | **Replace UA sniffing with feature detection** | Consolidate `isMobile()` / `isIOS()` / `detectPlatform()` to prefer `navigator.maxTouchPoints`, `matchMedia('(pointer: coarse)')`, `matchMedia('(hover: none)')` over UA regex. Keep UA as final fallback only | 3 hr |
| 3.2 | **Tablet landscape layout** | Add `@media (min-width: 768px) and (max-width: 1023px) and (orientation: landscape)` queries for two-column song list and side-by-side PDF view on tablets | 4 hr |
| 3.3 | **`navigator.userAgentData` migration** | For Chromium browsers, use `navigator.userAgentData.platform` and `navigator.userAgentData.mobile` where available, falling back to `navigator.platform`/UA string | 2 hr |
| 3.4 | **Add `display_override` to manifest** | Add `"display_override": ["standalone", "minimal-ui"]` for better browser fallback chain | 5 min |
| 3.5 | **Chromebook keyboard+touch hybrid** | Test and handle the case where a device has both `pointer: fine` (trackpad) and `pointer: coarse` (touchscreen). Use `any-pointer: coarse` media query for touch targets | 1 hr |
| 3.6 | **Dark/light color scheme meta** | Add `<meta name="color-scheme" content="dark">` to `index.html` to prevent white flash during page load on browsers that support it. Also add `color-scheme: dark;` to CSS `:root` | 10 min |

---

## 7. Weird Edge Cases

### 7.1 iOS Safari "Lockdown Mode"
Apple's Lockdown Mode (available since iOS 16) disables JIT compilation in the JS engine, making the app significantly slower. PDF rendering and the Levenshtein search worker could become noticeably sluggish. No workaround — just be aware.

### 7.2 Samsung Internet "Secret Mode"
Samsung Internet's secret/private browsing mode has stricter storage limits. Service worker registration may work, but Cache API storage could be limited or cleared on exit. Users may lose offline cached PDFs.

### 7.3 iPad Stage Manager (iPadOS 16+)
Stage Manager allows resizing the Safari window to arbitrary dimensions on iPad. This creates viewport widths that don't match any standard breakpoint (e.g., 504px wide). The app's responsive breakpoints (380/500/600/768/1024) handle this reasonably well, but the PDF viewer's "landscape dual-page" mode detection (`min-width: 768px`) could trigger at inappropriate window sizes.

### 7.4 Chrome Custom Tabs (Android)
When the app link is opened from another app (email, messaging), Android uses Chrome Custom Tabs. The `beforeinstallprompt` doesn't fire here. The install gate will block access, but the user can't install from a Custom Tab — they'd need to open in full Chrome first. Consider relaxing the install gate for Custom Tabs (detectable via `document.referrer`).

### 7.5 Facebook/Instagram In-App Browser (WebView)
Meta's in-app browser is a WebView that:
- Doesn't fire `beforeinstallprompt`
- Has limited service worker support
- May not support `standalone` display mode detection
- Uses Chromium on Android, WebKit on iOS

If users share the app link on social media, recipients will hit the install gate in a WebView where they literally cannot install the app. Consider adding a "Open in Browser" escape hatch.

### 7.6 Firefox's Enhanced Tracking Protection
Firefox's default "Standard" ETP mode blocks known tracking scripts. While the Cloudflare Worker URL is not a known tracker, custom Workers domains CAN trigger heuristic blocking in "Strict" mode. Worth testing.

### 7.7 iOS WKWebView Cookie Isolation
On iOS, PWAs run in a separate WKWebView container. Cookies and localStorage are isolated from Safari. This means:
- Logging in via Safari then opening the PWA = not logged in
- The `ct_auth_token` in localStorage is PWA-specific
- This is actually correct behavior for the app, but worth noting

### 7.8 Android WebView (Android 10-11)
The app uses ES modules (`type="module"`). Android WebView's ES module support arrived with Chrome 61 (Android 8+), so this should be fine for Android 10+. However, some OEM devices ship with outdated system WebViews that don't auto-update.

### 7.9 Windows Tablet Mode (Surface Pro)
Windows 2-in-1 devices switch between desktop and tablet modes. In tablet mode, touch targets should be at least 44x44px. The app's `.icon-btn` size of 36x36px (default) may be too small for comfortable touch in tablet mode. The `@media (pointer: coarse)` query would help here.

### 7.10 Screen Readers (VoiceOver, TalkBack, NVDA)
The app has good ARIA foundations:
- `role="dialog"` + `aria-modal` on modals
- `aria-label` on buttons
- `aria-live="polite"` on dynamic content
- `aria-current="page"` on active nav
- Skip-to-content link
- Focus management on view transitions

However, some dynamically rendered content (song cards, setlist items) may not announce properly. The `tabindex="-1"` on views for focus management is correct.

### 7.11 Slow 3G / Offline-First Edge Cases
The app caches the shell but fetches songs data from the Cloudflare Worker on every load. On slow connections:
- The app shell loads instantly from SW cache (good)
- Song data may take 3-10 seconds on slow 3G
- If the SW message-based cache retrieval times out (1000ms), the loading spinner persists until network completes
- PDFs require network fetch on first view — could be 5-30 seconds on slow 3G for a 2MB PDF

### 7.12 Multiple Tabs
Opening the app in multiple tabs creates potential conflicts:
- `localStorage` is shared between tabs — OK for read, risky for concurrent writes
- Service worker is shared — `_audioProxyMap` entries from one tab could collide with another
- The audio proxy counter uses `Date.now()` suffix which should prevent collisions

---

## Appendix A: Tested API Fallback Coverage

| API | Feature Detection Method | Fallback | Status |
|---|---|---|---|
| `document.startViewTransition` | Direct property check | Instant swap | GOOD |
| `navigator.vibrate` | `typeof navigator.vibrate === 'function'` | No-op | GOOD |
| `navigator.wakeLock` | `'wakeLock' in navigator` | No-op | GOOD |
| `navigator.mediaSession` | `'mediaSession' in navigator` | No-op | GOOD |
| `navigator.clipboard` | Used `document.execCommand` fallback | `fallbackCopy()` | GOOD |
| `structuredClone` | `typeof structuredClone === 'function'` | `JSON.parse/stringify` | GOOD |
| `AudioContext` | `window.AudioContext \|\| window.webkitAudioContext` | webkitAudioContext | GOOD |
| `AudioWorklet` | `ctx.audioWorklet` check + WebKit skip | setInterval scheduler | GOOD |
| `OffscreenCanvas` | `typeof OffscreenCanvas !== 'undefined'` | DOM canvas | GOOD |
| `navigator.storage.persist` | `navigator.storage && navigator.storage.persist` | No-op | GOOD |
| `navigator.storage.estimate` | `navigator.storage && navigator.storage.estimate` | Skip cache check | GOOD |
| `Background Sync` | `self.registration.sync` check | localStorage persistence | GOOD |
| `IndexedDB` | `IDB.isAvailable()` | localStorage | GOOD |
| `beforeinstallprompt` | Event listener | iOS hint / install gate | GOOD |
| `self.registration.sync` | Checked in SW | No-op (comment documents Safari gap) | GOOD |

## Appendix B: CSS Prefix Coverage

| Property | Standard | `-webkit-` | `-moz-` | Notes |
|---|---|---|---|---|
| `backdrop-filter` | YES | YES | N/A | Both present everywhere used |
| `user-select` | YES (`none` via class) | YES | Missing | Should add standard |
| `text-size-adjust` | YES | YES | Missing | Firefox ignores anyway |
| `font-smoothing` | N/A | YES | N/A | Non-standard, WebKit-only |
| `tap-highlight-color` | N/A | YES | N/A | WebKit-only |
| `overflow-scrolling` | N/A | YES (`touch`) | N/A | Deprecated but harmless |
| `appearance` | Missing in some | YES | YES (metronome input) | Should add standard `appearance: none` |
| `line-clamp` | Via `-webkit-line-clamp` | YES | N/A | Standard `line-clamp` not widely supported yet |
| `touch-callout` | N/A | YES | N/A | WebKit-only |
| Slider thumb | Via pseudo-elements | `::-webkit-slider-thumb` | Missing `::-moz-range-thumb` | Firefox sliders unstyled |
| Slider track | Via pseudo-elements | `::-webkit-slider-runnable-track` | Missing `::-moz-range-track` | Firefox sliders unstyled |

### Missing Slider Styles for Firefox
The audio progress bar and volume slider ONLY have `-webkit-slider-thumb` and `-webkit-slider-runnable-track` styles. Firefox renders these with its default browser styles, which will look inconsistent with the app's design. This affects both desktop Firefox and Firefox on Android.

---

## Summary Score

| Category | Score | Notes |
|---|---|---|
| **iOS Safari** | 9/10 | Excellent — audio proxy, safe areas, fallbacks. Volume slider is the gap. |
| **Chrome Android** | 9/10 | Excellent — install prompt, service worker, all APIs. |
| **Samsung Internet** | 7/10 | Likely works but untested. Smart Anti-Tracking is a risk. |
| **Desktop Chrome/Edge** | 9/10 | Excellent — keyboard shortcuts, desktop layout. |
| **Desktop Firefox** | 7/10 | Works but unstyled scrollbars and slider elements. |
| **Desktop Safari** | 8/10 | Good — no install hint for "Add to Dock" feature. |
| **Firefox Android** | 6/10 | No install hint + install gate = poor onboarding. |
| **iPadOS** | 8/10 | Good detection, but Stage Manager + landscape could be better. |
| **Android Tablets** | 7/10 | Works but no tablet-optimized layouts. |
| **Foldables** | 5/10 | Untested, no viewport change handling. |
| **Low-end Android** | 6/10 | Memory pressure from blob cache + PDF rendering. |
| **Accessibility** | 8/10 | Good ARIA, reduced motion, high contrast. Screen reader testing needed. |
| **Offline** | 9/10 | Excellent caching strategy, graceful degradation. |

**Overall: 7.8/10** — The app is well-built for its target audience (band members on iPhones and Android phones). The main gaps are around edge-case browsers (Firefox Android, Samsung Internet), uncommon device types (foldables, Chromebooks), and Firefox CSS styling.
