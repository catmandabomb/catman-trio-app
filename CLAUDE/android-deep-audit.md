# Android Device/Browser/OS Deep Compatibility Audit — Catman Trio App

**Date:** 2026-03-20
**App Version:** v20.25
**Scope:** Android-specific device, browser, OS, and OEM fragmentation
**Companion doc:** `CLAUDE/device-compatibility-audit.md` (cross-platform audit)

---

## Table of Contents

1. [Samsung Devices](#1-samsung-devices)
2. [Google Pixel — Stock Android](#2-google-pixel--stock-android)
3. [Budget Android (Xiaomi, Oppo, Motorola, Realme, Vivo)](#3-budget-android)
4. [Huawei — HMS vs GMS](#4-huawei--hms-vs-gms)
5. [Samsung Internet Browser](#5-samsung-internet-browser)
6. [Android WebView Fragmentation](#6-android-webview-fragmentation)
7. [Android Go](#7-android-go)
8. [Foldable Devices](#8-foldable-devices)
9. [Android Tablets](#9-android-tablets)
10. [Audio on Android](#10-audio-on-android)
11. [PWA on Android](#11-pwa-on-android)
12. [CSS and Rendering](#12-css-and-rendering)
13. [Summary Matrix](#13-summary-matrix)
14. [Priority Action Items](#14-priority-action-items)

---

## 1. Samsung Devices

### 1A. Samsung One UI Overlay

Samsung's One UI (Android skin) adds behaviors not present on stock Android:

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Game Optimizing Service (GOS)** | Samsung throttles CPU/GPU for apps it detects as power-hungry. PWAs rendering PDFs at high DPR can trigger GOS throttling. | `pdf-viewer.js` renders at up to `_maxDPR = 3` on mobile (line 44). Heavy canvas rendering during live mode carousel could trigger GOS. | No code fix needed — this is a Samsung firmware issue. Document for users. Consider reducing `_maxDPR` to 2 on Samsung devices if performance complaints arise. | LOW |
| **Edge Panel integration** | Samsung Edge Panel can intercept swipe-from-right gestures. Live mode carousel swipe (`touch-action: none` at `app.css` line 4134) should prevent this, but only when the app is fullscreen PWA. | `app.css` line 4134: `touch-action: none` on live mode. This is correct. | No fix needed — Edge Panel doesn't activate inside standalone PWAs. | LOW |
| **One UI "Secure Folder"** | Running the PWA inside Samsung Secure Folder creates an isolated Chrome/Samsung Internet instance. localStorage and SW cache are separate from the main profile. | Auth token (`ct_auth_token`) stored in localStorage would not carry over. User would need to log in again inside Secure Folder. | No fix needed — this is expected sandboxing behavior. | LOW |
| **Samsung DeX mode** | DeX provides a desktop-like experience with resizable windows. The PWA opens as a resizable window, not fullscreen. | No `resize` event listener anywhere in the app. PDF viewer and live mode carousel dimensions are calculated once on render but never recalculated on window resize. | Add `window.addEventListener('resize', debounce(() => { /* re-render active view */ }, 250))` or use `ResizeObserver` on key containers. | MEDIUM |

### 1B. Galaxy S Series (Flagships)

| Issue | Details | Priority |
|-------|---------|----------|
| **Dynamic AMOLED refresh rate** | Galaxy S21+ and newer have 120Hz displays. The `requestAnimationFrame` loop in `player.js` (line 441) and PDF zoom/pan (`pdf-viewer.js`) will run at 120fps on these devices — extra smooth but also extra battery drain. | LOW — not a bug, just a note |
| **Ultra-high DPR** | Galaxy S24 Ultra has `devicePixelRatio` of 3.0-3.5 at max resolution. The `_maxDPR` cap of 3 in `pdf-viewer.js` line 44 correctly limits canvas size. | LOW — already handled |

### 1C. Galaxy A Series (Mid-range)

| Issue | Details | Priority |
|-------|---------|----------|
| **Galaxy A14, A15, A25** | These are among the most sold Android phones globally. Ship with 4-6GB RAM, Exynos/MediaTek chipsets. Performance is adequate for the app but PDF rendering at DPR 2.0+ may stutter. | MEDIUM |
| **Older Galaxy A series (A10, A12)** | Android 10-11, 2-3GB RAM, slow storage. `BLOB_CACHE_MAX` is already reduced to 5 for `_deviceMem <= 2` (`app.js` line 54). The `_deviceMemGB` in `pdf-viewer.js` (line 46) defaults to 2 for mobile when API unavailable — conservative and correct. | LOW — already handled |

### 1D. Galaxy Tab Series

See [Section 9: Android Tablets](#9-android-tablets).

### 1E. Galaxy Z Fold/Flip (Foldables)

See [Section 8: Foldable Devices](#8-foldable-devices).

---

## 2. Google Pixel — Stock Android

Pixel devices run stock Android with the fastest Chrome updates. They represent the "golden path" for PWA development.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Pixel-specific features work correctly** | `beforeinstallprompt`, service workers, AudioWorklet, View Transition API — all supported at latest versions. | Install gate at `app.js` line 1842 handles `platform === 'android'` correctly for Pixel/Chrome. | None needed. | N/A |
| **Pixel 6+ Tensor chip** | Custom silicon with ML capabilities. No impact on PWA. | N/A | N/A | N/A |
| **Android 14+ Predictive Back** | Android 14 introduced a "predictive back" gesture that shows a preview of the previous screen when swiping back. For PWAs, this uses the browser's back navigation, which fires `popstate`. | The app handles `popstate` via Router — `js/router.js`. The hash-based routing should work correctly with predictive back. However, the preview animation may show a white/empty screen since the browser doesn't know what the previous "screen" looks like in a SPA. | No code fix — this is a platform limitation for all SPAs. The `theme_color` in manifest ensures the animation bg matches the app. | LOW |
| **Pixel tablet (dock mode)** | Pixel Tablet has a charging speaker dock that switches to "hub mode". PWAs continue running normally. Screen is 10.95", viewport similar to iPad. | No tablet-specific layouts. See [Section 9](#9-android-tablets). | MEDIUM |

---

## 3. Budget Android

### 3A. OEM WebView Update Lag

Budget Android phones from Xiaomi, Oppo, Motorola, Realme, and Vivo often ship with outdated system WebView versions. While Chrome and Samsung Internet update independently, the system WebView (used by in-app browsers) may be stuck at Chrome 80-90 equivalent on some Android 10-11 devices.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **ES Modules in old WebView** | ES modules (`type="module"`) require Chrome 61+. Android 10+ ships with Chrome 74+ WebView minimum. Should be safe. | `index.html` uses `<script type="module" src="app.js">`. | No fix needed for Android 10+. Android 9 devices with outdated WebView are out of scope. | LOW |
| **`structuredClone()` in old WebView** | Available since Chrome 98. Android 10 devices stuck on Chrome 80-90 WebView won't have it. | `js/utils.js` line 44: `if (typeof structuredClone === 'function') return structuredClone(obj); return JSON.parse(JSON.stringify(obj));` — fallback exists. | Already handled. | N/A |
| **`color-mix()` in old WebView** | Requires Chrome 111+. | `app.css` line 243 has `color-mix()` with a fallback on line 242 (`rgba(14,14,16,0.85)`). | Already handled. | N/A |
| **View Transition API** | Requires Chrome 111+. | `js/router.js` properly feature-detects `document.startViewTransition`. Falls back to instant swap. | Already handled. | N/A |

### 3B. Aggressive Battery Optimization

This is the **single biggest Android fragmentation issue** for PWAs. OEM battery optimization kills background processes — including service workers.

| OEM | Battery Feature Name | SW Impact |
|-----|---------------------|-----------|
| **Xiaomi (MIUI/HyperOS)** | Battery Saver, App Battery Saver | Kills SW within seconds of backgrounding. Also blocks push notifications. |
| **Oppo/Realme (ColorOS)** | Battery Optimization, Smart Power Saver | SW terminated aggressively. "Allow background activity" is OFF by default. |
| **Vivo (FuntouchOS/OriginOS)** | Background Power Consumption Management | Kills PWA process after ~30 seconds in background. |
| **Huawei (EMUI/HarmonyOS)** | App Launch, Battery Optimization | Most aggressive — SW can be killed even while app is in foreground split-screen. |
| **Samsung (One UI)** | Adaptive Battery, Sleeping Apps | Less aggressive than Xiaomi/Oppo, but still kills SW for "sleeping" apps. |
| **Motorola** | Adaptive Battery (stock-like) | Relatively lenient — closer to Pixel behavior. |

**Codebase impact:**
- `service-worker.js`: The entire SW (cache, audio proxy, PDF cache, push notifications) can be killed at any time.
- `service-worker.js` line 57: `self.skipWaiting()` ensures quick reactivation, but the `_audioProxyMap` (line 79) is lost when SW dies. Audio proxy URLs become 404s.
- `player.js` line 121: iOS audio proxy relies on SW being alive. Not an issue on Android Chrome (blob URLs work), but if a future Android-specific proxy is added, it would be affected.
- Background Sync (`service-worker.js` line 341): `sync` events may never fire on Xiaomi/Oppo/Huawei because the SW is killed before the sync event dispatches.
- Push notifications (`service-worker.js` line 355): Push events may not wake the SW on aggressive OEMs.

| Fix | Details | Effort | Priority |
|-----|---------|--------|----------|
| **Detect aggressive battery optimization** | No reliable API exists. Could detect OEM via `navigator.userAgent` (Xiaomi includes "MIUI", Oppo includes "OPPO" or "ColorOS", etc.) and show a one-time prompt asking users to disable battery optimization for the app. | 2 hr | MEDIUM |
| **Resilient offline writes** | The write queue already uses `localStorage` persistence (`github.js`). When Background Sync fails, the queue is flushed on next app open — this is correct behavior. | Already handled | N/A |
| **Audio proxy resilience** | On Android, blob URLs work directly (no proxy needed). The proxy path is only for `_isIOSSafari` (`player.js` line 20-22). If SW dies on Android, audio continues playing from the blob URL. | Already handled | N/A |

### 3C. Memory Pressure on Budget Devices

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **2GB RAM devices** | Xiaomi Redmi 9A, Samsung Galaxy A03, Motorola Moto E — common in emerging markets. | `app.js` line 54: `BLOB_CACHE_MAX` = 5 for `_deviceMem <= 2`. `pdf-viewer.js` line 47: `MAX_RENDER_CACHE` = 8 for `_deviceMemGB <= 2`. These are correct. | Already handled. | N/A |
| **Canvas memory limits** | Android WebView has a per-canvas pixel limit. On 2GB devices, a single canvas exceeding ~4096x4096 pixels may fail silently (renders white). | `pdf-viewer.js` line 44: `_maxDPR = 3` on mobile. A typical A4 PDF page at DPR 3 = ~2480x3508 pixels = 34MB per canvas. Two such canvases (current + pre-rendered) = 68MB. On a 2GB device this is ~3.4% of total RAM but may be >10% of available RAM. | Cap `_maxDPR` to 1.5 on devices with `_deviceMemGB <= 2`. Currently it's 3 for all mobile, which is too high for 2GB devices. | MEDIUM |
| **`getImageData` in margin cropping** | `pdf-viewer.js` line 116: `ctx.getImageData(0, 0, sw, sh)` allocates a new pixel buffer. The scan canvas is capped at 400px wide (line 106), so this is ~400x560 = ~900KB. Fine even on low-memory devices. | Already optimized. | N/A |

### 3D. Slow Storage (eMMC vs UFS)

Budget devices use eMMC flash (100-300MB/s) vs flagship UFS 3.1 (2000MB/s+). Impact:
- Service worker cache reads/writes are slower (IndexedDB, Cache API backed by SQLite)
- PDF cache operations (`service-worker.js` lines 189-264) involve blob serialization/deserialization

No code fix needed — these are inherent hardware limitations. The existing loading states (skeleton, buffering indicator) handle the perceived delay.

---

## 4. Huawei — HMS vs GMS

### 4A. Post-2019 Huawei (No Google Play Services)

Huawei devices shipped after May 2019 (Mate 30 and later, P40 series, P50, Mate 50, etc.) do NOT have Google Play Services or the Google Play Store.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **No Chrome, no Google WebView** | These devices use Huawei Browser (HiSuite/HiView engine, Chromium-based but lagging). System WebView is Huawei's fork. | The app should still work — Huawei Browser supports ES modules, SW, Cache API. However, Huawei's WebView may be 6-12 months behind mainline Chromium. | No code fix. The app's progressive enhancement and feature detection covers this. | LOW |
| **PWA install on Huawei** | Huawei Browser supports `beforeinstallprompt` (it's Chromium-based). However, the install flow creates a "quick app" rather than a traditional PWA on some EMUI versions. Quick apps have different lifecycle behavior. | `detectPlatform()` in `js/utils.js` line 216 returns `'android'` for Huawei (correct — UA contains "Android"). Install gate instructions reference Chrome (`app.js` line 1842), which is incorrect for Huawei users without Chrome. | Detect Huawei Browser via UA (`HuaweiBrowser` or `HMSCore`) and adjust install instructions to reference Huawei Browser instead of Chrome. | LOW |
| **Aggressive battery optimization** | EMUI/HarmonyOS has the most aggressive background process killing of any Android OEM. See Section 3B. | Same as Section 3B — SW and push notifications at risk. | Same as Section 3B. | MEDIUM |

### 4B. Pre-2019 Huawei (With GMS)

These devices (P30, Mate 20, etc.) have Google Play Services and behave like standard Android. No special handling needed.

---

## 5. Samsung Internet Browser

Samsung Internet has ~5-8% global mobile market share (15%+ in some regions like Europe and Southeast Asia). It uses Blink (Chromium) but is typically 1-2 major versions behind Chrome.

### 5A. PWA Install Flow Differences

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **`beforeinstallprompt` fires** | Samsung Internet fires this event, same as Chrome. | The app captures this at `app.js` line 2165 and shows an install banner. This works for Samsung Internet. | No fix needed. | N/A |
| **Install flow UI** | Samsung Internet's install dialog says "Add to Home screen" (not "Install app"). The app's Samsung-specific install gate (`app.js` line 1821, `platform === 'android-samsung'`) correctly references "Add page to > Home screen". | Already handled well. The `detectPlatform()` function at `js/utils.js` line 215 correctly detects `SamsungBrowser` in UA. | N/A | N/A |
| **Mini-app install** | Samsung Internet 20+ has "Samsung Internet mini-app" support. Some versions may offer to install the PWA as a mini-app instead of a home screen shortcut. Mini-apps have a different lifecycle — they can be suspended/killed more aggressively. | No code impact — mini-apps still run the same web content. | No fix needed. | LOW |

### 5B. Smart Anti-Tracking

Samsung Internet's Smart Anti-Tracking (SAT) blocks third-party tracking via an ML-based classifier. It can misclassify legitimate API calls.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Cloudflare Worker API calls** | SAT could potentially flag `catman-api.catmandabomb.workers.dev` as a tracker if the ML model detects cross-origin API patterns. | All data sync goes through `js/sync.js` which calls the Worker API. Auth calls in `auth.js` also hit the Worker. If SAT blocks these, the app shows empty song lists and auth fails. | The Worker URL uses HTTPS and responds with proper CORS headers. SAT typically only blocks known tracking domains, not arbitrary Workers. However, Samsung Internet's "Secret Mode" (private browsing) enables stricter blocking. **Test recommendation**: Verify API calls work in Samsung Internet with SAT enabled (Standard + Strict modes). | MEDIUM |
| **`fetch()` with credentials** | The app sends `Authorization: Bearer <token>` headers. SAT does not strip first-party-equivalent headers, so this should be fine. | No impact expected. | No fix needed. | LOW |

### 5C. Samsung Internet CSS Rendering

Samsung Internet renders CSS identically to Chrome (both Blink). The only differences are in newer CSS features where Samsung Internet may be 1-2 versions behind:

| CSS Feature | Chrome Support | Samsung Internet Support | Our Usage |
|-------------|---------------|------------------------|-----------|
| `color-mix()` | Chrome 111+ | SI 20+ (yes) | `app.css` line 243 — has fallback |
| View Transition API | Chrome 111+ | SI 23+ | `js/router.js` — feature detected |
| `scrollbar-width` | Chrome 121+ | SI 24+ (recent) | `app.css` line 3834 — has `-webkit-scrollbar` fallback |
| `@starting-style` | Chrome 117+ | SI 23+ | Not used |
| Popover API | Chrome 114+ | SI 22+ | Not currently used |

No CSS issues specific to Samsung Internet.

### 5D. Samsung DeX

When Samsung Internet runs in DeX mode (desktop-like):
- User agent still reports `SamsungBrowser` + `Android`
- Viewport can be any size (resizable window, up to 2560x1600 on external monitor)
- `navigator.maxTouchPoints` may report 0 (if using mouse/keyboard)
- `isMobile()` in `js/utils.js` line 184 checks UA for `Android` — returns `true` even in DeX

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **DeX falsely detected as mobile** | `isMobile()` returns `true` in DeX because UA contains "Android". The install gate would block desktop-mode DeX users. | Add DeX detection: check `navigator.maxTouchPoints === 0 && /Android/i.test(ua)` or check if viewport width > 1024 to skip install gate for DeX. Alternatively, `window.matchMedia('(hover: hover) and (pointer: fine)')` returns true in DeX with mouse. | MEDIUM |

---

## 6. Android WebView Fragmentation

### 6A. In-App Browsers (Facebook, Instagram, Twitter/X, LinkedIn)

When users open the app link from social media, the link opens in an in-app WebView, NOT in the user's default browser.

| In-App Browser | WebView Version | PWA Install | SW Support | Notes |
|----------------|----------------|-------------|------------|-------|
| **Facebook** | System WebView (Chromium) | NO | Partial (registration works, but SW is killed when the in-app browser closes) | `detectPlatform()` correctly returns `'webview'` for FBAN/FBAV |
| **Instagram** | System WebView (Chromium) | NO | Partial | Same as Facebook |
| **Twitter/X** | System WebView or Chrome Custom Tabs | NO (Custom Tabs) / NO (WebView) | YES (Custom Tabs) / Partial (WebView) | `detectPlatform()` returns `'webview'` for `Twitter` UA |
| **LinkedIn** | System WebView | NO | Partial | Not detected by `detectPlatform()` — UA contains `LinkedInApp` |
| **WhatsApp** | Chrome Custom Tabs on modern Android | NO | YES | Not a traditional WebView — uses Custom Tabs |
| **Telegram** | System WebView | NO | Partial | UA may contain `Telegram` — not detected |

**Codebase impact:**

`detectPlatform()` at `js/utils.js` line 209 checks:
```js
/FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|MicroMessenger/i.test(ua)
```

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **Missing WebView detections** | LinkedIn (`LinkedInApp`), Telegram (`TelegramBot` or embedded browser), Pinterest (`Pinterest`), Reddit (`Reddit/` in UA) are not detected. | Add to the WebView regex: `LinkedIn|Telegram|Pinterest|Reddit` | LOW |
| **"Open in Browser" button** | The WebView install gate at `app.js` line 1910 uses Android `intent://` scheme to open in default browser. This works on Android Facebook/Instagram but may not work on all in-app browsers. | The fallback (`window.open(appUrl, '_system')`) at line 1915 provides a safety net. Could also try `window.open(appUrl, '_blank')` with `noopener` to hint at external browser. | LOW |
| **Chrome Custom Tabs** | WhatsApp, some email apps, and Twitter use Chrome Custom Tabs (CCT). CCT uses the real Chrome engine (not system WebView), supports full SW, but does NOT fire `beforeinstallprompt`. | The install gate correctly blocks CCT users. The "Open in Chrome" hint at `app.js` line 1862 is correct guidance for CCT users. | LOW |

### 6B. System WebView Version Distribution

On Android 10+, System WebView updates via Play Store independently. However:
- On Android Go devices, WebView may be stuck at the factory version
- On Huawei devices without GMS, Huawei ships their own WebView fork
- Some carrier-locked budget devices have auto-updates disabled

The app's minimum viable feature set (ES modules, SW, Cache API, CSS custom properties) is supported on Chrome/WebView 74+ (Android 10+). All feature-detection fallbacks are in place.

---

## 7. Android Go

Android Go is Google's lightweight OS for devices with 1-2GB RAM. It ships on phones under $100 and represents ~8% of the global Android installed base.

### 7A. Android Go Restrictions

| Restriction | Impact on App | Codebase Impact | Fix | Priority |
|-------------|---------------|-----------------|-----|----------|
| **1-2GB RAM** | Aggressive process killing. Chrome may kill the PWA tab even while in foreground if another app requests memory. | PDF rendering + blob cache could push memory over limits. `BLOB_CACHE_MAX` = 5 for `_deviceMem <= 2` (correct). | Already partially handled. See canvas DPR fix in Section 3C. | MEDIUM |
| **Chrome Go (lightweight Chrome)** | Chrome Go has most features of full Chrome but with lower memory thresholds. Service workers work but have shorter idle lifetimes. | SW `_audioProxyMap` could be cleared more aggressively. Not an issue for Android (blob URLs work without proxy). | No fix needed. | LOW |
| **32GB storage** | Many Go devices ship with 32GB internal storage. After OS + apps, ~10-15GB available. PDF cache (`service-worker.js` line 211 caps at 50 items) could consume 50-200MB. | SW checks storage quota at line 196: `if (remaining < blob.size * 2)` — this is correct. The 80% usage check at line 203 also protects against filling storage. | Already handled. | N/A |
| **No background processes** | Android Go kills background processes almost immediately. Background Sync, push notifications essentially do not work. | `service-worker.js` line 310: Background Sync registration will succeed but the `sync` event may never fire. | The app already handles this gracefully — writes are queued in localStorage and flushed on next app open. | N/A |
| **AudioWorklet** | Chrome Go supports AudioWorklet, but the extra thread may be killed under memory pressure, causing the metronome to silently fail. | `metronome.js` lines 142-154: The 500ms watchdog timer auto-falls back to `setInterval` scheduler if worklet produces no beats. This is exactly the right pattern for Go devices. | Already handled. | N/A |
| **Slow CPU (MediaTek Helio A22, Unisoc)** | PDF.js rendering is CPU-intensive. A multi-page PDF may take 2-5 seconds per page on Go-class chipsets. | `pdf-viewer.js` progressive rendering (Phase 3) renders a low-res preview first, then high-res. This provides immediate visual feedback. | Already handled. | N/A |

---

## 8. Foldable Devices

### 8A. Samsung Galaxy Z Fold Series

The Fold has two physical screens:
- **Cover screen**: 6.2" (832x2268, ~374px CSS width in portrait)
- **Inner screen**: 7.6" (1812x2176, ~712px CSS width in portrait unfolded)

When the user unfolds the device, the viewport width jumps from ~374px to ~712px instantly.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **No viewport resize handler** | The app has zero `window.resize`, `visualViewport.resize`, or `screen.orientation.change` listeners. | PDF viewer canvases are sized at render time and never recalculated. Live mode carousel calculates slide dimensions once. Song list layout is CSS-responsive (OK). | Add resize handling for PDF viewer and live mode. Debounce to 250ms. | MEDIUM |
| **PDF viewer breaks on unfold** | Canvas is rendered at cover screen width (~374px). After unfolding to ~712px, the canvas doesn't re-render — it appears blurry and small, centered in a much larger container. | `pdf-viewer.js` `renderToCanvas()` uses `containerEl.clientWidth` at call time. No re-render on resize. | Listen for viewport resize and re-trigger `renderToCanvas()` with the new container width. Clear the render cache for the active page to force a fresh render. | MEDIUM |
| **Live mode carousel breaks on unfold** | Slide widths are calculated once on init based on viewport width. After unfolding, slides are half the screen width. | `js/setlists.js` live mode calculates `slideWidth` from container at init. | Add a resize handler in live mode that recalculates slide dimensions and re-renders the current slide. | MEDIUM |
| **Breakpoint jumps** | Cover screen (~374px) hits the "small phone" layout. Inner screen (~712px) hits "large phone/small tablet" layout. Unfolding causes a dramatic layout shift. | CSS breakpoints at 380/500/600/768px. The jump from 374 to 712 crosses three breakpoints simultaneously. | Not a bug — the responsive CSS handles both widths correctly. The transition is jarring but functional. | LOW |

### 8B. Samsung Galaxy Z Flip Series

The Flip has:
- **Cover screen**: 3.4" (720x748, ~260px) — too small for the app
- **Main screen**: 6.7" (1080x2640, ~360px CSS width)

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **Cover screen** | The Flip's cover screen can run apps since One UI 5.1. At ~260px CSS width, the app's minimum useful width (~320px) is not met. Search bar, song cards, and buttons would overflow. | Detect ultra-narrow viewport (`< 300px`) and show a "please use main screen" message, or apply an ultra-compact layout. Realistically, few users would try this. | LOW |
| **Flex Mode (half-folded)** | When the Flip is half-folded (laptop-like), the top half shows content and the bottom half shows controls. Chrome supports Fold CSS media queries (`@media (horizontal-viewport-segments: 2)`). | No current usage of fold-aware CSS. Not needed unless specifically targeting flex mode. | LOW |

### 8C. Fold-Aware CSS APIs

| API | Status | Our Usage |
|-----|--------|-----------|
| `@media (horizontal-viewport-segments: 2)` | Chrome 111+ on foldables | Not used |
| `env(viewport-segment-width)` | Chrome 111+ on foldables | Not used |
| `window.getWindowSegments()` | Deprecated — replaced by CSS API | Not used |
| `screen.fold` API | Experimental | Not used |

These APIs are not needed unless we want to create a fold-aware split layout (e.g., song list on left, detail on right when unfolded).

---

## 9. Android Tablets

### 9A. Samsung Galaxy Tab Series

Galaxy Tab S9+ viewport: ~800px CSS width in portrait, ~1280px in landscape.
Galaxy Tab A9: ~600px CSS width in portrait.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **No tablet-optimized layout** | The app has breakpoints up to 1024px (desktop). Tablet portrait (600-800px) uses the "large phone" layout. Tablet landscape (1024-1280px) uses the desktop layout with centered content. | `app.css` desktop centering kicks in at 1024px (line ~3800+). Song list is single-column on tablets in portrait. | Add a tablet breakpoint at 768px-1023px that shows a two-column song list grid. Not critical for the small user base. | LOW |
| **S-Pen input** | S-Pen is a `pointerType: 'pen'` input. The app uses `pointerdown`/`pointerup` events in `player.js` (speed button, line 374) and PDF zoom/pan. These correctly handle pen input. | Pen events are a subset of pointer events — no special handling needed. | N/A | N/A |
| **Orientation lock** | `manifest.json` line 8: `"orientation": "portrait"`. When installed as PWA, the app is locked to portrait. On tablets, users may want landscape for wider PDF viewing. | The orientation lock applies only in standalone PWA mode. In-browser, tablets can rotate freely. | Consider changing to `"orientation": "any"` or `"orientation": "natural"` for tablet users, but this would also unlock phone orientation. Alternatively, handle orientation in JS for more control. | LOW |
| **Split-screen / multi-window** | Android 12+ supports split-screen for all apps. The PWA runs in a half-width window (~400px on tablet, ~180px on phone). On phones, 180px is too narrow for any meaningful UI. | No minimum width enforcement. At 180px, the app would be unusable. | Could add `@media (max-width: 280px) { /* show "too narrow" message */ }` but this is an extreme edge case. | LOW |

### 9B. Lenovo Tab, Other Android Tablets

These tablets use stock-ish Android. Same considerations as Galaxy Tab without Samsung-specific features (no S-Pen, no DeX). No additional issues.

---

## 10. Audio on Android

### 10A. Autoplay Policies

| Browser | Autoplay Policy | Impact |
|---------|----------------|--------|
| **Chrome Android** | Blocked until user gesture. First `play()` must be initiated by tap/click. | `player.js` line 534: `audio.play()` is called from a click handler (line 521) — correct. The `.catch()` at line 540 handles rejection. |
| **Samsung Internet** | Same as Chrome — Chromium policy. | Same handling works. |
| **Firefox Android** | Blocks autoplay. Requires user gesture. | Same handling works. |
| **Huawei Browser** | Same as Chrome — Chromium-based. | Same handling works. |

The app correctly handles autoplay in all cases:
- `player.js` line 535: `const playPromise = audio.play()` — returns a promise
- `player.js` line 540: `.catch(err => { ... })` — gracefully handles rejection
- `player.js` line 564: Spurious `pause` event handling for Android's play negotiation

### 10B. AudioWorklet on Android

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Chrome Android 66+** | AudioWorklet fully supported. | `metronome.js` uses AudioWorklet as primary mode. Works on Chrome Android. | N/A | N/A |
| **Samsung Internet 15+** | AudioWorklet supported (Chromium-based). | Works. | N/A | N/A |
| **Firefox Android** | AudioWorklet supported since Firefox 76. | Works. `_isWebKit()` check at `metronome.js` line 36 correctly does NOT skip Firefox. | N/A | N/A |
| **Budget devices** | AudioWorklet thread may be killed under memory pressure. | `metronome.js` lines 142-154: 500ms watchdog auto-fallback to `setInterval`. Excellent resilience. | Already handled. | N/A |

### 10C. Audio Focus

Android has a system-level "audio focus" mechanism. When another app (phone call, notification, navigation) takes audio focus, the current audio should duck (reduce volume) or pause.

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Phone call interruption** | Chrome Android automatically pauses audio when a phone call starts. The `pause` event fires on the audio element. | `player.js` line 563: The `pause` event handler updates UI correctly. When the call ends, Chrome does NOT auto-resume — user must press play again. | No fix needed — this is standard behavior. | N/A |
| **Notification sounds** | Brief notification sounds do NOT pause audio — they mix. | No impact. | N/A | N/A |
| **Google Assistant** | Activating Google Assistant pauses audio. Same as phone call behavior. | Handled by `pause` event. | N/A | N/A |
| **Bluetooth disconnect** | When Bluetooth headphones disconnect, Chrome pauses audio. | `pause` event fires. UI updates. | N/A | N/A |

### 10D. Bluetooth Audio Latency

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Bluetooth latency (100-300ms)** | Bluetooth audio (A2DP) has inherent latency. The metronome beat will be perceived 100-300ms late on Bluetooth. | `metronome.js` schedules beats via AudioContext timing (accurate) but the actual sound arrives late via Bluetooth. The visual beat indicator (`_onBeat` callback) fires immediately. | This creates a visual-audio desync when using Bluetooth. No practical fix — this is a hardware limitation. Document for users: "Use wired headphones or speaker for metronome practice." | LOW |
| **aptX/LDAC low latency** | Some premium Bluetooth codecs reduce latency to 40-80ms. Not detectable via web APIs. | No code impact. | N/A | N/A |

### 10E. Media Session API

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **Lock screen controls** | Chrome Android shows play/pause/stop on the lock screen via Media Session API. | `player.js` lines 30-55: Properly sets `MediaMetadata` and action handlers. Works on all Android browsers with Media Session support. | N/A | N/A |
| **Missing seek handlers** | `seekbackward` and `seekforward` Media Session actions are not registered. Some Android lock screen UIs and Bluetooth controllers send these. | `player.js` line 596-601: Only `play`, `pause`, `stop` are registered. | Add `seekbackward` (−5s) and `seekforward` (+5s) handlers for better Bluetooth headphone integration. | LOW |

---

## 11. PWA on Android

### 11A. Install Prompt by Browser

| Browser | Install Mechanism | Our Handling | Status |
|---------|-------------------|--------------|--------|
| **Chrome** | `beforeinstallprompt` event + "Install app" menu item | `app.js` line 2165: captures event, shows banner. Install gate at line 1842 shows Chrome-specific steps. | GOOD |
| **Samsung Internet** | `beforeinstallprompt` event + "Add page to > Home screen" | `app.js` line 1821: Samsung-specific install gate steps. `detectPlatform()` returns `'android-samsung'`. | GOOD |
| **Firefox Android** | No `beforeinstallprompt`. Menu item "Install". | `app.js` line 1779: Firefox-specific install gate steps. `detectPlatform()` returns `'android-firefox'`. | GOOD |
| **Edge Android** | `beforeinstallprompt` (Chromium). "Add to phone" menu item. | Falls through to `'android'` platform detection. Uses Chrome install steps. The wording says "Chrome" specifically at line 1847, which is wrong for Edge users. | MINOR GAP |
| **Opera Android** | `beforeinstallprompt` (Chromium). "Home screen" menu item. | Same as Edge — falls through to `'android'`. | MINOR GAP |
| **Brave Android** | `beforeinstallprompt` (Chromium). | Falls through to `'android'`. Works. | OK |
| **Huawei Browser** | `beforeinstallprompt` (Chromium-based). | Falls through to `'android'`. Install steps reference Chrome, but Huawei users don't have Chrome. | MINOR GAP |

| Fix | Details | Priority |
|-----|---------|----------|
| Change install gate wording for generic Android | At `app.js` line 1847, change "in the top right of Chrome" to "in the top right of your browser" for the generic `'android'` platform case. This handles Edge, Opera, Brave, and Huawei Browser. | LOW |

### 11B. Battery Optimization Killing Service Workers

See Section 3B for the full breakdown. Summary of PWA-specific impacts:

| Feature | Impact of SW Death | Resilience in App |
|---------|-------------------|-------------------|
| App shell cache | SW dies but cache persists. Re-registers on next open. | GOOD — shell loads from cache even without active SW |
| Songs data cache | Same as above — cache persists. | GOOD |
| PDF cache | Cache persists. SW must be alive for new PDF caching. | GOOD |
| Audio proxy | `_audioProxyMap` lost. Only affects iOS Safari (not Android). | N/A for Android |
| Push notifications | Push event may not wake SW on aggressive OEMs. | AT RISK on Xiaomi/Oppo/Huawei |
| Background Sync | Sync event may never fire. | MITIGATED — localStorage queue flushed on next open |
| Offline writes | Persisted in localStorage, flushed when app re-opens. | GOOD |

### 11C. Notification Permissions

Android 13+ requires runtime permission for notifications (POST_NOTIFICATIONS). For PWAs, the browser shows its own permission dialog when `Notification.requestPermission()` is called.

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **Android 13+ double permission** | On Android 13+, the user sees both the browser's notification permission dialog AND the OS-level permission dialog. If either is denied, notifications fail. | No code fix — this is platform behavior. Ensure the permission request is tied to a clear user action (button tap, not automatic). | LOW |
| **Notification grouping** | Android groups notifications from the same app. Chrome PWA notifications appear under the browser's notification channel. | No impact on functionality. | N/A |

### 11D. Share Target

The manifest declares a Share Target (`manifest.json` line 38). This allows other Android apps to share PDF files to the Catman Trio PWA.

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **Share Target only works when installed** | The share target only appears in Android's share sheet when the PWA is installed to the home screen. | Expected behavior. | N/A |
| **Samsung Internet Share Target** | Samsung Internet 15+ supports share target for installed PWAs. | Works. | N/A |
| **Large PDF sharing** | Android may pass files up to 100MB via share target. The SW handler at `service-worker.js` line 398-419 stores the entire PDF in a temporary cache. On low-memory devices, a large shared PDF could cause OOM. | Add a size check in the share target handler: reject files > 20MB with a user-friendly message. | LOW |

---

## 12. CSS and Rendering

### 12A. Vendor Prefixes

The app has good vendor prefix coverage. Android-specific findings:

| Property | Standard | `-webkit-` | Status in App |
|----------|----------|-----------|---------------|
| `backdrop-filter` | `app.css` lines 245, 2279, 2302, 4245, 5069 | Lines 244, 2278, 2301, 4246, 5070 | GOOD — both present everywhere |
| `user-select` | Lines 2540, 2565, 4130 | Lines 2539, 2566, 4131 | GOOD |
| `appearance` | Standard `appearance: none` | `-webkit-appearance` | Partial — check if both are present on all form controls |
| Slider pseudo-elements | N/A | `::-webkit-slider-thumb`, `::-webkit-slider-runnable-track` | `app.css` has both `-webkit-` and `-moz-range-*` styles (lines 382, 390, 1731-1743). GOOD |
| `scrollbar-width` | Line 3834 | `::-webkit-scrollbar` lines 3838-3840 | GOOD — both present |

### 12B. Display Notch / Punch-Hole / Camera Cutout

Modern Android phones have various display cutouts:
- Punch-hole (Samsung Galaxy S/A, Pixel)
- Teardrop notch (budget Xiaomi, Realme)
- Pill-shaped cutout (Samsung Dynamic Island on some models)
- Under-display camera (Samsung Z Fold 4+, some Xiaomi)

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **`viewport-fit=cover`** | `index.html` line 5: `viewport-fit=cover` is set. This tells the browser to render into the cutout area. | Without `env(safe-area-inset-*)`, content could be hidden behind the cutout. | The app uses safe area insets: `app.css` lines 161-162 define `--safe-top` and `--safe-bottom` from `env()`. Topbar padding at line 2486, live mode at lines 3545, 4128-4140 — all use safe area insets. | GOOD — already handled |
| **Landscape mode with cutout** | In landscape, the cutout is on the LEFT or RIGHT side. `env(safe-area-inset-left)` and `env(safe-area-inset-right)` apply. | Live mode uses left/right safe area insets at `app.css` lines 4128-4129. | Already handled for live mode. The main app (portrait-locked via manifest) doesn't need horizontal safe areas. | GOOD |
| **Android vs iOS safe area differences** | On Android, `env(safe-area-inset-top)` typically reports the STATUS BAR height (24-48px) plus the cutout overlap. On iOS, it reports only the notch area. The value semantics are the same but magnitudes may differ. | The CSS uses `env()` values additively (`calc(8px + env(safe-area-inset-top, 0px))` at line 2486). This scales correctly regardless of the actual inset value. | Already handled. | N/A |

### 12C. Dark Mode / Color Scheme

| Issue | Details | Codebase Impact | Fix | Priority |
|-------|---------|-----------------|-----|----------|
| **`prefers-color-scheme`** | Not used — the app is ALWAYS dark theme. | `index.html` line 11: `<meta name="color-scheme" content="dark">` is set. This prevents Chrome from applying its own dark mode transformations. | Already handled. | N/A |
| **Dark Reader extension** | `index.html` line 10: `<meta name="darkreader-lock">` prevents Dark Reader from mangling the already-dark UI. | Already handled. | N/A | N/A |
| **Samsung Internet Night Mode** | Samsung Internet has its own "Night Mode" that can darken webpages. The `color-scheme: dark` meta tag and `darkreader-lock` do NOT prevent Samsung's Night Mode. | If Night Mode is enabled, it could over-darken the already dark UI, making text unreadable. | Add `<meta name="nightmode" content="disable">` to `index.html`. This is Samsung Internet's proprietary meta tag for opting out of Night Mode. | MEDIUM |
| **Force Dark Mode (Chrome 96+)** | Chrome has `#enable-force-dark` flag and `Auto Dark Mode for Web Contents`. The `<meta name="color-scheme" content="dark">` should prevent this. | Already handled by `color-scheme: dark`. | N/A | N/A |

### 12D. Font Rendering

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **Inter font** | The app loads Inter from Google Fonts. On Android, if the font fails to load, Chrome falls back to Roboto (system sans-serif). Both are similar in metrics, so layout shift is minimal. | No fix needed. | N/A |
| **Emoji rendering** | Android uses Noto Color Emoji. No app content uses emoji in UI text. User-generated content (song titles, notes) could contain emoji — these render natively. | No fix needed. | N/A |
| **`text-size-adjust`** | `app.css` uses `-webkit-text-size-adjust`. Chrome Android respects this. Without it, Chrome may enlarge text in landscape mode. | Already handled. | N/A |

### 12E. `overscroll-behavior`

`app.css` line 211: `overscroll-behavior: none;` on `html, body`.
- Chrome Android: Fully supported (prevents pull-to-refresh in standalone PWA).
- Samsung Internet: Supported.
- Firefox Android: Supported.

In standalone PWA mode, Chrome Android still supports pull-to-refresh by default. `overscroll-behavior: none` correctly disables it. This is crucial for the app to prevent accidental refresh during scrolling.

### 12F. Hardware-Accelerated Animations

| Issue | Details | Fix | Priority |
|-------|---------|-----|----------|
| **`transform` and `opacity` animations** | The view transition animations in `app.css` lines 59-75 use `translateX` and `opacity` — these are GPU-composited on Android. | Correct approach — no layout thrash. | N/A |
| **`backdrop-filter` performance** | `backdrop-filter: blur(12px)` at `app.css` line 245 (topbar) triggers compositing on every frame during scroll. On budget Android devices with weak GPUs (Mali-G52, Adreno 610), this can cause scroll jank. | Could add `will-change: transform` to the topbar or reduce blur radius on low-end devices. However, detecting GPU capability is not possible via web APIs. `navigator.deviceMemory <= 2` is a reasonable proxy. | LOW |

---

## 13. Summary Matrix

| Category | Score | Key Issues |
|----------|-------|------------|
| **Samsung Galaxy (S/A/Tab)** | 8/10 | DeX false mobile detection; no resize handler for DeX; Night Mode over-darkening |
| **Google Pixel** | 9.5/10 | Near-perfect. Predictive back animation shows white (cosmetic). |
| **Budget Android (Xiaomi/Oppo/Vivo)** | 7/10 | Aggressive battery killing SW; canvas DPR too high for 2GB devices; backdrop-filter jank |
| **Huawei (HMS)** | 7/10 | Install instructions reference Chrome (incorrect); aggressive battery optimization |
| **Samsung Internet** | 8.5/10 | Smart Anti-Tracking untested; Night Mode; DeX + isMobile() issue |
| **Android WebView (in-app)** | 7.5/10 | WebView detection missing some apps; install gate blocks correctly; "Open in Browser" works |
| **Android Go** | 7/10 | Memory pressure; canvas DPR; AudioWorklet watchdog handles fallback well |
| **Foldable (Z Fold/Flip)** | 5/10 | No resize handler; PDF/live mode break on fold/unfold; no fold-aware CSS |
| **Android Tablets** | 7/10 | No tablet-optimized layout; portrait lock in manifest; works but underwhelming |
| **Audio** | 9/10 | Excellent autoplay handling; AudioWorklet fallback; missing seek Media Session handlers |
| **PWA Install** | 8.5/10 | Good per-browser detection; minor wording issues for Edge/Opera/Huawei |
| **CSS/Rendering** | 9/10 | Good safe areas; good prefix coverage; Samsung Night Mode gap |

**Overall Android Score: 7.7/10**

---

## 14. Priority Action Items

### Critical (Fix Now)

| # | Issue | File(s) | Fix | Effort |
|---|-------|---------|-----|--------|
| 1 | **Canvas DPR too high on 2GB devices** | `pdf-viewer.js` line 44 | Change `_maxDPR` calculation: `const _maxDPR = _isMobileDevice ? (_deviceMemGB <= 2 ? 1.5 : 3) : 4;` | 5 min |
| 2 | **Samsung Internet Night Mode** | `index.html` | Add `<meta name="nightmode" content="disable">` | 2 min |

### Important (Fix Soon)

| # | Issue | File(s) | Fix | Effort |
|---|-------|---------|-----|--------|
| 3 | **No viewport resize handler** | `pdf-viewer.js`, `js/setlists.js` | Add debounced `window.resize` handler that re-renders active PDF canvas and live mode carousel when viewport dimensions change significantly (>100px delta). | 2 hr |
| 4 | **DeX detected as mobile** | `js/utils.js` line 183-187 | In `isMobile()`, add: `if (/Android/i.test(ua) && window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth > 1024) return false;` This allows DeX (mouse+keyboard+large viewport) to bypass mobile detection. | 30 min |
| 5 | **Samsung Internet Smart Anti-Tracking** | N/A | Test the Worker API calls in Samsung Internet with SAT enabled (Standard and Strict modes). Document results. | 1 hr |
| 6 | **Install gate wording for non-Chrome Android** | `app.js` line 1847 | Change "in the top right of Chrome" to "in the top right of your browser" | 2 min |
| 7 | **Missing Media Session seek handlers** | `player.js` | Add `seekbackward` and `seekforward` handlers alongside existing play/pause/stop at line 596. | 15 min |

### Nice to Have

| # | Issue | File(s) | Fix | Effort |
|---|-------|---------|-----|--------|
| 8 | **Missing WebView detections** | `js/utils.js` line 209 | Add `LinkedIn\|Telegram\|Pinterest\|Reddit` to the WebView regex. | 5 min |
| 9 | **Battery optimization warning** | `app.js` | On first launch, detect OEM (Xiaomi/MIUI, Oppo/ColorOS, etc.) via UA and show a one-time prompt asking users to exclude the app from battery optimization. Link to dontkillmyapp.com instructions. | 2 hr |
| 10 | **Tablet two-column layout** | `app.css` | Add `@media (min-width: 768px) and (max-width: 1023px)` breakpoint with two-column song grid. | 3 hr |
| 11 | **Large shared PDF rejection** | `service-worker.js` line 402 | Add `if (file.size > 20 * 1024 * 1024) { /* skip, too large */ }` | 10 min |
| 12 | **Portrait lock for tablets** | `manifest.json` line 8 | Change `"orientation": "portrait"` to `"orientation": "any"` or add `"orientation_override"` logic. Requires testing landscape layouts. | 3 hr |
| 13 | **Backdrop-filter jank on budget GPU** | `app.css` line 244-245 | Add `@media (prefers-reduced-motion: reduce) { #topbar { backdrop-filter: none; background: rgba(14,14,16,0.95); } }` to skip blur on reduced-motion devices (partial proxy for low-end). Already has reduced-motion blocks — extend to cover topbar blur. | 15 min |
| 14 | **Huawei Browser install instructions** | `app.js`, `js/utils.js` | Detect `HuaweiBrowser` in UA, return `'android-huawei'` from `detectPlatform()`, add Huawei-specific install gate text. | 30 min |
