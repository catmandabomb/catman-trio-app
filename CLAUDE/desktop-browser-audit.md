# Desktop Browser & Extension Compatibility Audit — Catman Trio App

**Date:** 2026-03-20
**App Version:** v20.24
**Scope:** Desktop/laptop browsers, browser extensions, hybrid devices (Chromebook, Surface)
**Companion doc:** `device-compatibility-audit.md` (mobile-focused)

---

## Table of Contents

1. [Brave Browser](#1-brave-browser)
2. [Opera / Opera GX](#2-opera--opera-gx)
3. [Vivaldi](#3-vivaldi)
4. [Arc Browser](#4-arc-browser)
5. [Microsoft Edge](#5-microsoft-edge)
6. [Browser Extensions](#6-browser-extensions)
7. [Safari on macOS](#7-safari-on-macos)
8. [Firefox Desktop](#8-firefox-desktop)
9. [Chromebook / Chrome OS](#9-chromebook--chrome-os)
10. [Windows Tablet Mode](#10-windows-tablet-mode)
11. [Summary Matrix](#11-summary-matrix)
12. [Recommendations](#12-recommendations)

---

## 1. Brave Browser

**Engine:** Chromium (Blink) | **Desktop share:** ~3-4% | **PWA install:** YES (shares Chrome path)

### 1.1 Shields — API Call Blocking

| Risk | Detail |
|---|---|
| **What** | Brave Shields blocks third-party requests by default. "Aggressive" mode blocks all cross-origin fetch/XHR. |
| **Our exposure** | All Worker API calls go to `catman-api.catmandabomb.workers.dev` — a different origin from the app host. If the app is served from a different domain (e.g., `catmantrio.com`), Shields may classify Worker API calls as third-party and block them. |
| **Affected code** | `sync.js` `_workerFetch()`, `auth.js` `_api()`, `service-worker.js` prefetch PDFs, every `fetch()` to the Worker |
| **Severity** | **HIGH** if app and Worker are on different domains; **LOW** if same-origin |
| **Fix** | 1. Serve app from a subdomain of `catmandabomb.workers.dev` or use same TLD. 2. Add clear error handling in `_workerFetch()` that detects blocked requests (TypeError: "Failed to fetch") and shows a toast: "Ad blocker may be blocking sync. Please whitelist this site." 3. The SW already bypasses Worker URLs in the fetch handler (line 461) -- good. |

### 1.2 Fingerprinting Protection — navigator.deviceMemory

| Risk | Detail |
|---|---|
| **What** | Brave randomizes/blocks fingerprinting APIs. `navigator.deviceMemory` returns `undefined` or a randomized value. `navigator.hardwareConcurrency` returns a randomized count (2 or 4, regardless of actual). |
| **Our exposure** | `pdf-viewer.js` line 46: `const _deviceMemGB = navigator.deviceMemory || (_isMobileDevice ? 2 : 8);` — the fallback is correct. `setlists.js` line 2532: `const mem = navigator.deviceMemory || 4;` — also has fallback. |
| **Severity** | **LOW** — fallbacks exist and are reasonable |
| **Fix** | No code change needed. Fallback values handle this. |

### 1.3 PWA Install Support

| Risk | Detail |
|---|---|
| **What** | Brave supports `beforeinstallprompt` and PWA install via address bar. |
| **Our exposure** | Works identically to Chrome. The install gate and custom install banner should work. |
| **Severity** | **NONE** |

### 1.4 Brave's Built-in Tor / Private Tabs

| Risk | Detail |
|---|---|
| **What** | Brave's Tor mode routes traffic through Tor. Private windows block third-party cookies and storage. |
| **Our exposure** | localStorage and IndexedDB are ephemeral in private mode. Auth tokens (`ct_auth` in localStorage) and all cached data will be lost on window close. Service worker may not register. |
| **Severity** | **LOW** — Private/Tor browsing is opt-in, users expect ephemeral sessions |
| **Fix** | No code change needed. The app gracefully handles missing localStorage (try/catch wrappers in `auth.js` `_save()` and `_restore()`). |

---

## 2. Opera / Opera GX

**Engine:** Chromium (Blink) | **Desktop share:** ~2-3% | **PWA install:** YES

### 2.1 Built-in VPN (Opera Free VPN)

| Risk | Detail |
|---|---|
| **What** | Opera's free VPN proxies all traffic through Opera's servers. This adds latency and can cause Cloudflare Worker geo-routing differences. |
| **Our exposure** | Worker API calls may be slower. Cloudflare's rate limiting is IP-based — shared VPN IPs could trigger rate limits if other Opera VPN users hit the same Worker. |
| **Severity** | **LOW** — unlikely with our low traffic volume |
| **Fix** | No code change needed. The sync cooldown (`SYNC_COOLDOWN_MS`) and manual sync rate limiting already prevent excessive requests. |

### 2.2 Built-in Ad Blocker

| Risk | Detail |
|---|---|
| **What** | Opera's built-in ad blocker uses EasyList and similar filter lists. Generally does NOT block first-party API calls, but can block requests to domains on tracker lists. |
| **Our exposure** | `catmandabomb.workers.dev` is not on any known filter list. Low risk unless the domain gets flagged. |
| **Severity** | **LOW** |

### 2.3 Opera GX — Viewport Quirks

| Risk | Detail |
|---|---|
| **What** | Opera GX has a sidebar (GX Corner, Twitch, Messenger) that reduces the viewport width by ~50-60px. The sidebar is always visible by default. Users may also use GX's "Force Dark Pages" feature. |
| **Our exposure** | The sidebar reduction means a 1920px monitor shows ~1860px viewport. Our desktop content centering (`max-width` at 1024px breakpoint) handles this fine. However, on smaller monitors (1366px), the viewport could drop to ~1306px — still above our 1024px desktop breakpoint, so no issue. |
| **Severity** | **LOW** |
| **Additional risk** | Opera GX's "Force Dark Pages" injects CSS to invert colors. Since our app already has a dark theme, the double-inversion could make it look broken (light backgrounds, inverted gold accents). |
| **Fix** | Add `<meta name="color-scheme" content="dark">` to `index.html` and `color-scheme: dark;` to CSS `:root`. This tells Opera GX (and Dark Reader, etc.) that the page is already dark and should NOT be auto-darkened. This was already recommended in the mobile audit (item 3.6) but not yet implemented. |

### 2.4 Opera GX CPU/RAM/Network Limiters

| Risk | Detail |
|---|---|
| **What** | GX lets users cap CPU, RAM, and bandwidth for the browser. Under heavy limits, PDF rendering and audio decoding could be throttled. |
| **Our exposure** | PDF.js rendering (`pdf-viewer.js`) is CPU-intensive. The Levenshtein search worker runs in a Web Worker. Under CPU limits, both become sluggish. |
| **Severity** | **LOW** — opt-in feature, users set limits intentionally |

---

## 3. Vivaldi

**Engine:** Chromium (Blink) | **Desktop share:** ~0.5-1% | **PWA install:** YES

### 3.1 Tab Stacking

| Risk | Detail |
|---|---|
| **What** | Vivaldi allows stacking tabs and tiling them side-by-side within the browser window. Tiled tabs get arbitrary viewport widths (e.g., 500px on a 1920px monitor). |
| **Our exposure** | The app's responsive breakpoints (380/500/600/768/1024) handle narrow viewports well since the app is mobile-first. Tiled tabs will trigger the mobile layout, which is correct behavior. |
| **Severity** | **NONE** |

### 3.2 Web Panels (Sidebar)

| Risk | Detail |
|---|---|
| **What** | Vivaldi's Web Panels load a page in a ~400px sidebar. The page runs as a normal web page but in a very narrow viewport. |
| **Our exposure** | At 400px, the app would show the mobile layout. The topbar buttons and song list render fine at this width. However, the PWA install gate would trigger since `isMobile()` may return true in this narrow viewport. If `navigator.maxTouchPoints > 0` is used (which it isn't — `isMobile()` uses UA sniffing), it would correctly identify desktop. Currently, the UA-sniffing approach returns false for Vivaldi desktop, so the install gate should NOT trigger. |
| **Severity** | **LOW** |
| **Fix** | Ensure the install gate does not trigger in desktop browsers with narrow viewports. The current UA-based `isMobile()` handles this correctly since Vivaldi desktop does not match mobile UA patterns. |

### 3.3 PWA Support

| Risk | Detail |
|---|---|
| **What** | Vivaldi supports `beforeinstallprompt` and PWA install. Behavior matches Chrome. |
| **Severity** | **NONE** |

---

## 4. Arc Browser

**Engine:** Chromium (Blink) | **Desktop share:** ~0.3-0.5% (growing, macOS-primary)

### 4.1 Spaces & Split View

| Risk | Detail |
|---|---|
| **What** | Arc uses "Spaces" (workspaces) and split view (two pages side-by-side). Split view creates ~50% viewport width per pane. |
| **Our exposure** | On a 1440px display, split view gives ~720px per pane. This falls between our 600px and 768px breakpoints — the app shows a mobile-ish layout, which is acceptable. On a 2560px display, each pane gets ~1280px, which triggers the desktop layout. Both scenarios are fine. |
| **Severity** | **NONE** |

### 4.2 PWA Install

| Risk | Detail |
|---|---|
| **What** | Arc's PWA install experience differs from Chrome. Arc does NOT show the traditional install prompt in the address bar. Instead, users must go to Arc menu > "Install Page as App". `beforeinstallprompt` fires but Arc's UI for acting on it is non-obvious. |
| **Our exposure** | The custom install banner button calls `_deferredPrompt.prompt()` which works in Arc. However, users who dismiss the banner may not find the install option again. |
| **Severity** | **LOW** — Arc users are typically power users who can find the option |

### 4.3 Arc Boost (Custom CSS/JS)

| Risk | Detail |
|---|---|
| **What** | Arc Boost lets users inject custom CSS/JS into any page. Community-shared Boosts could conflict with our styles. |
| **Our exposure** | User-initiated and rare. Not something we can or should defend against. |
| **Severity** | **NONE** |

### 4.4 Arc Max (AI Features)

| Risk | Detail |
|---|---|
| **What** | Arc Max summarizes pages and can interact with page content. No known issues with PWAs. |
| **Severity** | **NONE** |

---

## 5. Microsoft Edge

**Engine:** Chromium (Blink) | **Desktop share:** ~12-15% | **PWA install:** YES

### 5.1 Sleeping Tabs

| Risk | Detail |
|---|---|
| **What** | Edge puts background tabs to sleep after 30 min (default) of inactivity. Sleeping tabs discard the tab's JS context and service worker communication. When the tab wakes up, the page is restored from a saved state. |
| **Our exposure** | The sync polling timer (`_pollTimer` in `sync.js`, 30-second interval) will stop during sleep. When the tab wakes, the `setInterval` callback resumes but `_lastChanges` may be stale. The tab restoration triggers a page reload, which re-initializes everything — so this is actually fine. |
| **Severity** | **LOW** |
| **Potential issue** | If the user has the app open as a pinned tab and Edge sleeps it, the real-time sync polling stops. On wake, there may be a brief period of stale data until the next poll or manual refresh. |
| **Fix** | Add a `visibilitychange` listener that triggers a sync when the page becomes visible after being hidden: `document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAll(false); });`. This is already a good practice for any browser. |

### 5.2 Edge Sidebar

| Risk | Detail |
|---|---|
| **What** | Edge's sidebar can open web pages in a ~375px panel (similar to Vivaldi Web Panels). |
| **Our exposure** | Same as Vivaldi 3.2 — mobile layout triggers, install gate does NOT trigger (desktop UA). |
| **Severity** | **LOW** |

### 5.3 Collections

| Risk | Detail |
|---|---|
| **What** | Edge Collections saves pages for later reading. Collections captures the URL and a screenshot. No interference with the running app. |
| **Severity** | **NONE** |

### 5.4 Edge PWA with Sidebar Badge

| Risk | Detail |
|---|---|
| **What** | When installed as a PWA, Edge shows the app in a dedicated window. Edge supports the App Badge API (`navigator.setAppBadge()`). The app already calls this in `sync.js` line 576: `navigator.setAppBadge?.(1)?.catch?.(() => {});` |
| **Severity** | **NONE** — already handled |

### 5.5 Edge Efficiency Mode

| Risk | Detail |
|---|---|
| **What** | Edge Efficiency Mode throttles background activities and reduces CPU usage. This can slow down Web Workers (Levenshtein search, metronome processor, PDF render worker). |
| **Our exposure** | The metronome AudioWorklet could experience timing drift under efficiency mode. The existing fallback to `setInterval` scheduler (for WebKit) does not activate on Edge since Edge is Chromium-based and supports AudioWorklet. |
| **Severity** | **LOW** — efficiency mode is opt-in and primarily affects background tabs |

---

## 6. Browser Extensions

### 6.1 uBlock Origin / AdBlock Plus

| Aspect | Detail |
|---|---|
| **Risk** | Filter lists (EasyList, EasyPrivacy) block requests matching known tracker patterns. Custom filter rules can block any domain. |
| **Our Worker URL** | `catman-api.catmandabomb.workers.dev` — not on any standard filter list. The `.workers.dev` TLD is used by millions of legitimate sites and is NOT broadly blocked. However, specific `*.workers.dev` subdomains CAN be added to filter lists if they are reported as trackers/malware. |
| **Specific risk** | uBlock Origin's "Block 3rd-party scripts and frames" option (off by default) would block ALL cross-origin fetch requests, including our Worker API. |
| **Severity** | **LOW** for default settings; **HIGH** if user enables strict blocking |
| **Fix** | Add user-facing error detection: when `fetch()` throws `TypeError` (network error), check if the error message indicates blocking rather than network failure. Show a specific toast: "Connection blocked -- an ad blocker or privacy extension may be interfering. Try disabling it for this site." |

### 6.2 Privacy Badger / Ghostery

| Aspect | Detail |
|---|---|
| **Risk** | Privacy Badger uses heuristic learning — it tracks which domains appear across multiple sites and blocks those it classifies as trackers. Ghostery uses a curated database. |
| **Our Worker URL** | Privacy Badger: LOW risk. `catman-api.catmandabomb.workers.dev` is only used by our app, so Privacy Badger's heuristic ("seen on 3+ sites") would never trigger. Ghostery: LOW risk unless manually added to their database. |
| **Cookie blocking** | Both extensions can block third-party cookies. Our app does NOT use cookies for auth (uses `localStorage` + `Authorization` header), so cookie blocking has no effect. |
| **Severity** | **LOW** |

### 6.3 Dark Reader

| Aspect | Detail |
|---|---|
| **Risk** | Dark Reader injects a `<style>` element and a `<meta name="darkreader">` tag. It inverts/adjusts colors for pages it detects as "light". It uses multiple strategies: CSS filter inversion, static theme generation, or dynamic theme analysis. |
| **Our app** | Already has a dark theme (`--bg: #0e0e10`). Dark Reader's detection may or may not identify it as already dark. |
| **Worst case** | If Dark Reader applies its filter, it would invert our dark theme to light, making the app unusable. Gold accents become blue, dark backgrounds become white. |
| **Affected CSS** | All CSS variables in `:root`, `backdrop-filter` effects, canvas-rendered PDFs (inverted colors), the metronome visualizer. |
| **Severity** | **MEDIUM** |
| **Fix** | Add `<meta name="color-scheme" content="dark">` to `<head>` in `index.html`. Add `color-scheme: dark;` to CSS `:root`. This is the standard signal to Dark Reader (and browsers) that the page is already dark-themed. Dark Reader respects this meta tag and will skip the page. Also add `<meta name="darkreader-lock">` as a secondary signal. |

### 6.4 Grammarly

| Aspect | Detail |
|---|---|
| **Risk** | Grammarly injects `<grammarly-desktop-integration>` shadow DOM elements into every `<textarea>` and `contenteditable` element. It adds a floating button, underlines, and suggestion popups. It can modify the DOM structure around text inputs. |
| **Our affected elements** | Login form inputs (`#login-username`, `#login-password`), search input (`#search-input`), edit form textareas (song notes, lyrics — rendered by `admin.js`), dashboard text inputs (tag manager, user management). |
| **Specific risks** | 1. The login form: Grammarly may add a floating icon inside the password field, overlapping our compact input styling. 2. Textareas in edit modals: Grammarly suggestions could cause layout shifts in absolutely-positioned modals. 3. Performance: Grammarly runs on every keystroke, adding latency to the search-as-you-type in `#search-input`. |
| **Severity** | **LOW-MEDIUM** |
| **Fix** | Add `data-gramm="false"` and `data-gramm_editor="false"` attributes to inputs where Grammarly interference is unwanted (search input, password fields). Leave it enabled on textareas where spell-check is useful (song notes). |

### 6.5 1Password / LastPass / Bitwarden

| Aspect | Detail |
|---|---|
| **Risk** | Password managers inject icons into input fields and can auto-fill form data. They detect login forms by looking for `<input type="password">` and `autocomplete` attributes. |
| **Our login form** | Has proper `autocomplete` attributes: `autocomplete="username"` on username, `autocomplete="current-password"` on password, `autocomplete="new-password"` on confirm password, `autocomplete="email"` on email. This is correct and password managers will work well. |
| **Potential issue** | The injected icons (1Password's inline icon, LastPass's "..." icon) may overlap with our input padding. The login inputs have `padding: 10px 12px` — there is enough right padding for typical PM icons (~30px). However, on narrow mobile viewports, the icon could overlap text. |
| **Severity** | **LOW** |
| **Fix** | Consider adding `padding-right: 40px` to login form password inputs to ensure space for PM icons. Or no action — PM icon overlap is cosmetic and users expect it. |

### 6.6 React DevTools / Vue DevTools / Other Dev Tools

| Aspect | Detail |
|---|---|
| **Risk** | Framework-specific dev tools extensions scan the DOM for framework markers. React DevTools looks for `__REACT_DEVTOOLS_GLOBAL_HOOK__`, Vue DevTools looks for `__VUE_DEVTOOLS_GLOBAL_HOOK__`. |
| **Our app** | Vanilla JS — no framework markers. These extensions will detect "no framework" and do nothing. Minimal overhead. |
| **Severity** | **NONE** |

### 6.7 Wappalyzer / BuiltWith

| Aspect | Detail |
|---|---|
| **Risk** | Technology detection extensions scan page source, headers, and JS globals. They run passively and do not modify the DOM. |
| **Severity** | **NONE** |

### 6.8 Honey / Rakuten / Shopping Extensions

| Aspect | Detail |
|---|---|
| **Risk** | Shopping extensions inject banners and popups on e-commerce sites. They detect shopping-related DOM patterns. Our app has no shopping-related content. |
| **Severity** | **NONE** |

### 6.9 Tampermonkey / Violentmonkey

| Aspect | Detail |
|---|---|
| **Risk** | Userscript managers run arbitrary user-installed scripts on matching URLs. A malicious script could interfere with the app. |
| **Our exposure** | User-initiated. Cannot defend against arbitrary JS injection. |
| **Severity** | **NONE** (accepted risk) |

---

## 7. Safari on macOS

**Engine:** WebKit | **Desktop share:** ~8-9% (higher among macOS users: ~60-70%)

### 7.1 "Add to Dock" PWA (Safari 17+)

| Risk | Detail |
|---|---|
| **What** | Safari 17+ (macOS Sonoma 14+) supports "Add to Dock" which installs the PWA as a standalone desktop app. The app runs in its own WKWebView process with separate storage from Safari. |
| **Our exposure** | The app has NO macOS Safari-specific install hint. The install gate only shows iOS Safari hints. macOS Safari users who visit the app in a browser will see the generic "install" message but no specific instructions. |
| **Detection** | macOS Safari can be detected via: `navigator.userAgent` containing "Safari" but not "Chrome/Edge/Firefox" + `navigator.platform === 'MacIntel'` + `navigator.maxTouchPoints === 0` (distinguishes from iPadOS). |
| **Severity** | **MEDIUM** |
| **Fix** | Add macOS Safari detection and show: "In Safari, click File > Add to Dock to install this app." This was already identified in the mobile audit (item 2.6) but not yet implemented. |

### 7.2 Lockdown Mode

| Risk | Detail |
|---|---|
| **What** | Lockdown Mode (macOS Ventura 13.0+, Safari 16+) disables JIT compilation, blocks non-standard fonts, disables some CSS features, blocks most JS APIs that could be used for exploitation. |
| **Specific impacts** | 1. JIT disabled: PDF.js rendering becomes ~3-5x slower. 2. Web fonts: Inter font (loaded from local files, not CDN) should still work since it is same-origin. 3. WebGL: may be disabled, but our app does not use WebGL. 4. Service Worker: still functions but with stricter CSP. |
| **Severity** | **LOW** — Lockdown Mode is for high-risk users who expect degraded performance |

### 7.3 ITP (Intelligent Tracking Prevention)

| Risk | Detail |
|---|---|
| **What** | ITP classifies domains as "trackers" based on cross-site usage patterns. Classified trackers have their cookies purged after 7 days (or 24 hours for script-writable storage in some cases). Starting with Safari 17, ITP also limits `localStorage` lifespan for third-party contexts. |
| **Our exposure** | Since the app runs as a first-party page (not embedded in an iframe), ITP does NOT affect our `localStorage` or IndexedDB. The Worker API at `catman-api.catmandabomb.workers.dev` is a cross-origin fetch, but ITP focuses on cookies, not `fetch()` with `Authorization` headers. Our auth uses `Authorization: Bearer <token>` headers, NOT cookies. |
| **Severity** | **LOW** |
| **Edge case** | If the Worker ever sets cookies (it currently does not), ITP would classify it as a cross-site tracker and purge those cookies. As long as auth stays header-based, no issue. |

### 7.4 Safari Content Blockers

| Risk | Detail |
|---|---|
| **What** | Safari supports native Content Blockers (e.g., 1Blocker, AdGuard for Safari). These use Apple's Content Blocking API, which is more limited than Chrome extension APIs but can block URLs by pattern. |
| **Our exposure** | Same as uBlock Origin (6.1) — `catmandabomb.workers.dev` is not on standard block lists. |
| **Severity** | **LOW** |

### 7.5 Safari Private Relay (iCloud+)

| Risk | Detail |
|---|---|
| **What** | Private Relay (iCloud+ subscribers) routes traffic through Apple's relay servers. It masks the user's IP and location. |
| **Our exposure** | Same as Opera VPN (2.1) — adds latency, IP-based rate limiting could be affected. No functional impact. |
| **Severity** | **LOW** |

---

## 8. Firefox Desktop

**Engine:** Gecko | **Desktop share:** ~6-8%

### 8.1 Enhanced Tracking Protection (ETP) — Strict Mode

| Risk | Detail |
|---|---|
| **What** | Firefox ETP has three levels: Standard (default), Strict, Custom. Strict mode blocks ALL third-party cookies, all cross-site tracking content, cryptominers, fingerprinters. It also isolates storage (dFPI — dynamic First-Party Isolation). |
| **Impact of dFPI** | dFPI creates separate storage buckets per first-party domain. Since our app is a single first-party page making fetch requests to the Worker, dFPI does NOT affect us — there is no cross-site storage sharing to isolate. |
| **Worker API calls** | The Worker URL (`catman-api.catmandabomb.workers.dev`) is NOT on Firefox's tracking protection lists (disconnect.me-based). Cross-origin fetch requests with custom headers are NOT blocked by ETP unless the domain is on the list. |
| **Severity** | **LOW** in Standard/Strict modes |
| **Custom mode risk** | Custom ETP allows users to block "All Third-Party Cookies" and "All Third-Party Content" (aka "Tracking content in all windows"). The latter could potentially block fetch requests to the Worker if Firefox classifies it as "tracking content". In practice, this only blocks URLs on the disconnect.me tracking list. |

### 8.2 Container Tabs (Multi-Account Containers)

| Risk | Detail |
|---|---|
| **What** | Firefox Container Tabs isolate cookies, localStorage, and IndexedDB per container. Each container has separate storage. |
| **Our exposure** | If a user opens the app in two different containers, they will have separate login sessions, separate cached data, and separate service worker registrations. This is expected behavior and is actually correct — each container is effectively a separate browser profile. |
| **Severity** | **LOW** — no action needed, this is correct behavior |

### 8.3 about:config Privacy Tweaks

| Risk | Detail |
|---|---|
| **What** | Advanced Firefox users modify `about:config` settings. Common privacy tweaks that could affect us: |
| `dom.storage.enabled = false` | Disables localStorage entirely. App would fail to save auth tokens, preferences, and cached data. The app has try/catch wrappers around localStorage access but does not have a clear error message for when storage is disabled entirely. |
| `javascript.options.wasm = false` | Disables WebAssembly. PDF.js modern versions may use WASM for performance. If our version falls back to JS, no issue. |
| `media.autoplay.default = 5` | Blocks all autoplay. Our audio requires user interaction to start (click play button), so this should not affect us. |
| `network.http.referer.XOriginPolicy = 2` | Blocks cross-origin referers. Our Worker API does not check the `Referer` header for auth — it uses `Authorization` header. No impact. |
| `privacy.resistFingerprinting = true` | Spoofs `navigator.userAgent`, `screen.width/height`, timezone, canvas fingerprint, `navigator.hardwareConcurrency`, etc. This would cause `isMobile()` to potentially return incorrect values. Also causes `canvas.toDataURL()` to return a blank image, which could break PDF rendering if it relies on canvas fingerprinting. |
| **Severity** | **LOW-MEDIUM** for `privacy.resistFingerprinting`; **LOW** for others |
| **Fix for resistFingerprinting** | PDF.js uses canvas for rendering, not fingerprinting. The `privacy.resistFingerprinting` canvas poisoning only affects `canvas.toDataURL()` and `canvas.toBlob()`, NOT `canvas.getContext('2d').drawImage()` or `canvas.getContext('2d').putImageData()`. PDF rendering should still work. The `devicePixelRatio` spoofing (reports 1.0) would cause lower-resolution PDF rendering, which is acceptable. |

### 8.4 Firefox PWA Support (Desktop)

| Risk | Detail |
|---|---|
| **What** | Firefox desktop does NOT support PWA installation. No `beforeinstallprompt`, no "Install as App" option. The removed "SSB" (Site-Specific Browser) feature was deprecated and removed. |
| **Our exposure** | The install gate is mobile-only, so desktop Firefox users are not blocked. They just use the app in-browser. |
| **Severity** | **NONE** — correct behavior, desktop users don't need PWA install |

### 8.5 CSS Compatibility

Firefox-specific CSS issues already identified and fixed:
- **Scrollbar:** `scrollbar-width: thin; scrollbar-color: var(--border-light) transparent;` is applied globally in `app.css` line 3746. FIXED.
- **Slider thumb/track:** `::-moz-range-thumb` styles exist in `app.css` line 382 (volume) and line 1729 (audio progress). PARTIALLY FIXED.
- **`::-moz-range-track`** is NOT styled. Firefox uses default track appearance. This is a visual-only issue.

| Remaining gap | Detail |
|---|---|
| `::-moz-range-track` | Volume slider and audio progress bar tracks are unstyled in Firefox. Add styles matching `::-webkit-slider-runnable-track`. |
| `::-moz-range-progress` | Firefox supports a pseudo-element for the filled portion of a range input. Could be used to show progress fill color. |
| **Severity** | **LOW** — cosmetic only |

---

## 9. Chromebook / Chrome OS

**Engine:** Chromium (Blink) | **Device share:** ~1-2% | **Contexts:** Browser, Android app, Linux container

### 9.1 Browser PWA

| Risk | Detail |
|---|---|
| **What** | Chrome on Chrome OS supports full PWA installation. Installs as a standalone window with shelf icon. `beforeinstallprompt` works identically to desktop Chrome. |
| **Severity** | **NONE** — fully supported |

### 9.2 Touch + Keyboard Hybrid

| Risk | Detail |
|---|---|
| **What** | Chromebooks have both touchscreen and keyboard/trackpad. `matchMedia('(pointer: fine)')` returns true (trackpad). `matchMedia('(any-pointer: coarse)')` returns true (touchscreen). `navigator.maxTouchPoints` returns a positive number. |
| **Our exposure** | `isMobile()` uses UA sniffing which correctly identifies Chrome OS as desktop. However, touch target sizes are important — the app's `.icon-btn` at 36x36px may be small for finger taps on the touchscreen. The existing 44px tap targets on mobile are not triggered since `isMobile()` returns false. |
| **Severity** | **LOW-MEDIUM** |
| **Fix** | Use `@media (any-pointer: coarse)` to apply touch-friendly tap target sizes (min 44x44px) regardless of primary pointer type. This catches Chromebooks, Windows tablets, and any touch-capable desktop. |

### 9.3 Android App Mode (ARC / Play Store)

| Risk | Detail |
|---|---|
| **What** | Chrome OS can run Android apps via ARC++/ARCVM. If the PWA is installed from the Play Store (via TWA), it runs in an Android container with different viewport and storage behavior. |
| **Our exposure** | The app is not published on the Play Store, so TWA mode is not relevant. Users would install via Chrome browser. |
| **Severity** | **NONE** |

### 9.4 Linux Container (Crostini)

| Risk | Detail |
|---|---|
| **What** | Chrome OS's Linux container allows running full Linux desktop browsers (Firefox, Chromium). These run in a VM with separate networking. |
| **Our exposure** | Standard browser behavior — no special handling needed. |
| **Severity** | **NONE** |

### 9.5 Low-End Chromebook Hardware

| Risk | Detail |
|---|---|
| **What** | Many Chromebooks have 4GB RAM and Intel Celeron/MediaTek processors. These are low-power compared to typical desktops. |
| **Our exposure** | PDF.js rendering with full DPR canvas can be memory-intensive. The blob cache (30 entries) could consume significant RAM. `navigator.deviceMemory` returns actual value on Chrome OS (not spoofed). |
| **Severity** | **LOW-MEDIUM** |
| **Fix** | The existing `navigator.deviceMemory` fallback in `pdf-viewer.js` already handles this. Could also check `navigator.hardwareConcurrency` to limit Web Worker parallelism on low-core-count devices. |

---

## 10. Windows Tablet Mode

**Affected devices:** Surface Pro, Surface Go, Lenovo Yoga, HP Spectre x360, various 2-in-1s

### 10.1 Touch Targets

| Risk | Detail |
|---|---|
| **What** | Windows tablet mode provides a touch-optimized interface. Users interact primarily via touch. Microsoft's Fluent Design guidelines recommend 40x40px minimum touch targets (44x44px preferred). |
| **Our exposure** | The app's `.icon-btn` defaults to 36x36px. The bottom nav buttons, topbar buttons, and action buttons are the primary interaction targets. At 36px, they are below the recommended minimum for comfortable touch. |
| **Severity** | **MEDIUM** |
| **Fix** | Apply larger touch targets via `@media (any-pointer: coarse)`. Set `.icon-btn` to 44x44px minimum when a coarse pointer is available. |

### 10.2 Split-Screen PWA

| Risk | Detail |
|---|---|
| **What** | Windows 11 Snap Layouts allow snapping a PWA to half, third, or quarter of the screen. A quarter-screen PWA on a 1920x1080 display gets ~480x540px viewport. |
| **Our exposure** | At 480px width, the app hits the mobile layout (below 500px breakpoint). The topbar, search bar, and song list render correctly. However, the height is only 540px, which means the visible content area (after topbar 90px + subheader ~50px) is only ~400px. This is tight but usable. |
| **Severity** | **LOW** |

### 10.3 Pen/Stylus Input

| Risk | Detail |
|---|---|
| **What** | Surface Pen and other styluses register as `pointer: fine` (precise input) with `pointerType: 'pen'`. Touch targets can be smaller since the pen is precise. |
| **Our exposure** | No specific pen handling. Pointer events work normally. The app's existing `touch-action: manipulation` and pointer event handling cover pen input correctly. |
| **Severity** | **NONE** |

### 10.4 Virtual Keyboard

| Risk | Detail |
|---|---|
| **What** | In tablet mode, tapping an input field opens the on-screen keyboard, which pushes up the viewport (or overlays it depending on browser). This reduces the visible content area by ~40%. |
| **Our exposure** | The login form, search input, and edit form textareas could be obscured by the virtual keyboard. The `visualViewport` API can detect keyboard appearance. |
| **Severity** | **LOW-MEDIUM** |
| **Fix** | Use `visualViewport.addEventListener('resize', ...)` to detect keyboard appearance and scroll the focused input into view. Most browsers do this automatically, but Edge in tablet mode can be inconsistent with fixed-position topbar elements. |

---

## 11. Summary Matrix

| Browser/Context | API Blocking Risk | CSS Issues | PWA Install | Storage/Auth | Overall Risk |
|---|---|---|---|---|---|
| **Brave** | MEDIUM (Shields) | NONE | GOOD | LOW (private mode) | MEDIUM |
| **Opera** | LOW | LOW (GX dark mode) | GOOD | NONE | LOW |
| **Opera GX** | LOW | MEDIUM (Force Dark) | GOOD | NONE | LOW-MEDIUM |
| **Vivaldi** | NONE | NONE | GOOD | NONE | LOW |
| **Arc** | NONE | NONE | PARTIAL (non-obvious UI) | NONE | LOW |
| **Edge** | NONE | NONE | GOOD | LOW (Sleeping Tabs) | LOW |
| **uBlock Origin** | LOW-MEDIUM | NONE | N/A | NONE | LOW-MEDIUM |
| **Privacy Badger** | LOW | NONE | N/A | NONE | LOW |
| **Dark Reader** | NONE | MEDIUM | N/A | NONE | MEDIUM |
| **Grammarly** | NONE | LOW | N/A | NONE | LOW-MEDIUM |
| **1Password/LastPass** | NONE | LOW (icon overlap) | N/A | NONE | LOW |
| **Safari macOS** | LOW (ITP) | NONE | PARTIAL (no hint) | NONE | MEDIUM |
| **Firefox Desktop** | LOW (ETP) | LOW (track styles) | NO PWA | LOW (about:config) | LOW-MEDIUM |
| **Chromebook** | NONE | NONE | GOOD | NONE | LOW-MEDIUM |
| **Windows Tablet** | NONE | NONE | GOOD | NONE | MEDIUM |

---

## 12. Recommendations

### Priority 1: Do Now (High impact, low effort)

| # | Issue | Fix | Effort |
|---|---|---|---|
| 1.1 | **`<meta name="color-scheme">`** | Add `<meta name="color-scheme" content="dark">` to `index.html` `<head>`. Add `color-scheme: dark;` to CSS `:root`. Also add `<meta name="darkreader-lock">`. Prevents Dark Reader, Opera GX "Force Dark", and other auto-dark tools from double-darkening our already-dark theme. | 5 min |
| 1.2 | **Ad blocker detection** | In `_workerFetch()` and `auth.js` `_api()`, catch `TypeError` from `fetch()` and show a specific toast: "Sync failed -- if you have an ad blocker or privacy extension, try disabling it for this site." Only show once per session (flag in `sessionStorage`). | 20 min |
| 1.3 | **Grammarly suppression on search/password** | Add `data-gramm="false"` and `data-gramm_editor="false"` to `#search-input`, `#login-password`, `#login-confirm-password`. Leave other textareas alone. | 5 min |

### Priority 2: Do Soon (Medium impact)

| # | Issue | Fix | Effort |
|---|---|---|---|
| 2.1 | **macOS Safari install hint** | Detect macOS Safari (UA contains `Safari`, not `Chrome`, `navigator.maxTouchPoints === 0`). Show install hint: "In Safari, click File > Add to Dock". Re-identified from mobile audit item 2.6. | 45 min |
| 2.2 | **visibilitychange sync trigger** | Add `document.addEventListener('visibilitychange', () => { if (!document.hidden && Auth.isLoggedIn()) syncAll(false); });` in `app.js` init. Fixes stale data after Edge Sleeping Tabs, OS suspend/resume, and any tab-backgrounding scenario. | 15 min |
| 2.3 | **Touch targets for hybrid devices** | Add `@media (any-pointer: coarse) { .icon-btn { min-width: 44px; min-height: 44px; } }` to `app.css`. Catches Chromebooks, Surface tablets, and any touch-capable device. | 30 min |
| 2.4 | **Firefox `::-moz-range-track`** | Add track styles for volume slider and audio progress bar to match `::-webkit-slider-runnable-track` appearance. | 20 min |

### Priority 3: Nice to Have

| # | Issue | Fix | Effort |
|---|---|---|---|
| 3.1 | **Password manager input padding** | Add `padding-right: 40px` to password inputs to avoid PM icon overlap with typed text. | 5 min |
| 3.2 | **Keyboard shortcut for sync** | Document `Ctrl+Shift+R` as manual sync shortcut for desktop users. Already handled by browser hard-refresh but a custom `Ctrl+S` shortcut for save could be useful. | 30 min |
| 3.3 | **Chromebook low-memory detection** | Use `navigator.deviceMemory` (already has fallback) to reduce blob cache size on Chromebooks with <= 4GB RAM. Already documented in stability framework. | 30 min |
| 3.4 | **Windows virtual keyboard handling** | Add `visualViewport.resize` listener to auto-scroll focused input into view when on-screen keyboard appears. | 45 min |

---

## Appendix A: Worker API Blocking Risk Assessment

The core question: **Can ad blockers/privacy extensions block our Cloudflare Worker API calls?**

| Scenario | Blocked? | Why |
|---|---|---|
| Default uBlock Origin (EasyList + EasyPrivacy) | **NO** | `catmandabomb.workers.dev` is not on any filter list |
| uBlock with "Block 3rd-party scripts/frames" | **YES** | Blocks ALL cross-origin requests |
| Brave Shields (Standard) | **NO** | Only blocks known tracker domains |
| Brave Shields (Aggressive) | **MAYBE** | Blocks all cross-origin third-party resources |
| Firefox ETP (Standard/Strict) | **NO** | Only blocks disconnect.me-listed domains |
| Firefox ETP (Custom: "All 3rd-party content") | **MAYBE** | Could block if classified as third-party content |
| Privacy Badger | **NO** | Heuristic never triggers for single-site domains |
| Safari Content Blockers | **NO** | Not on any standard list |
| Opera ad blocker | **NO** | Uses EasyList, domain not listed |

**Mitigation strategy:** Graceful degradation with clear error messaging. The app already falls back to localStorage/IDB cache when Worker API calls fail. Adding specific ad-blocker-detection messaging ensures users know WHY sync failed and HOW to fix it.

## Appendix B: Extension DOM Injection Map

| Extension | Injected Elements | Affected Area | Impact |
|---|---|---|---|
| **Dark Reader** | `<style class="darkreader">`, `<meta name="darkreader">` | `<head>` + global styles | Color inversion of entire app |
| **Grammarly** | `<grammarly-desktop-integration>` (Shadow DOM) | Every `<textarea>`, `contenteditable` | Floating icon, underlines, popups |
| **1Password** | `<com-1password-...>` elements | `<input type="password">`, `<input type="text">` near passwords | Inline fill icon |
| **LastPass** | `<div class="lastpass-icon">` | Password inputs | Inline fill icon |
| **Bitwarden** | Shadow DOM popup anchored to inputs | Password inputs | Floating fill menu |
| **Honey** | `<div id="honey-*">` | N/A (only on shopping sites) | None |
| **uBlock Origin** | None (network-only blocking) | N/A | None |
| **Privacy Badger** | None (network-only blocking) | N/A | None |

## Appendix C: Brave Shields Decision Tree

```
User loads Catman Trio in Brave
  |
  +-- Shields DOWN (disabled for site)
  |     All Worker API calls succeed. Normal operation.
  |
  +-- Shields UP (Standard — default)
  |     |
  |     +-- Is catmandabomb.workers.dev on a filter list?
  |     |     NO -> API calls succeed
  |     |     YES -> API calls blocked (UNLIKELY — monitor)
  |     |
  |     +-- Fingerprinting protection
  |           navigator.deviceMemory -> undefined (fallback: 8)
  |           navigator.hardwareConcurrency -> randomized (2 or 4)
  |           canvas fingerprint -> randomized (PDF rendering unaffected)
  |
  +-- Shields UP (Aggressive)
        |
        +-- All cross-origin fetch blocked?
              MAYBE -> depends on "Block all 3rd-party resources" toggle
              If blocked: TypeError on fetch() -> show ad-blocker toast
```
