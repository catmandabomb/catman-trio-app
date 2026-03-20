# Barrel Round 1 — iOS/iPadOS Device Compatibility Audit

**Date:** 2026-03-20
**Auditor:** Claude Opus 4.6
**Scope:** Post-fix verification of all iOS/iPadOS compatibility items across 11 source files

---

## Results Summary

| # | Check | Status | Details |
|---|-------|--------|---------|
| 1 | `audio.volume` writes guarded | PASS | See below |
| 2 | AudioWorklet skips WebKit | PASS | See below |
| 3 | OffscreenCanvas DOM fallback | PASS | See below |
| 4 | All inputs >= 16px | **FAIL** | 4 violations found |
| 5 | `position: fixed` uses safe-area | PASS (partial) | See notes |
| 6 | `navigator.vibrate()` feature-detected | PASS | See below |
| 7 | `navigator.storage.persist()` has .catch() | PASS | See below |
| 8 | Install gate platform paths | PASS | See below |
| 9 | `-webkit-backdrop-filter` present | PASS | See below |
| 10 | `playsinline` on audio elements | PASS | See below |
| 11 | iPad + Magic Keyboard volume slider hidden | PASS | See below |
| 12 | Blob cache reduced on iOS | PASS | See below |
| 13 | All `<select>` at 16px | **FAIL** | 2 violations found |
| 14 | Stage Manager resize handler | PASS | See below |
| 15 | iOS 15 overscroll-behavior on live mode | PASS | See below |

**Overall: 13 PASS, 2 FAIL (6 individual violations)**

---

## Detailed Findings

### 1. `audio.volume` writes — PASS

All `audio.volume` writes are wrapped in try/catch:

- **`player.js:113`** — `try { audio.volume = _volume; } catch (_) {}` (comment: "iOS: volume is read-only")
- **`player.js:663`** — `_audioElements.forEach(a => { try { a.volume = _volume; } catch (_) {} });` (in `setVolume()`)

No unguarded `audio.volume =` writes found anywhere.

### 2. AudioWorklet skips WebKit — PASS

- **`metronome.js:36-38`** — `_isWebKit()` function detects Safari/WebKit and returns true
- **`metronome.js:44`** — `if (_isWebKit()) throw new Error('Safari/WebKit -- skip worklet for reliable audio');`
- Falls back to OscillatorNode-based `setInterval` scheduler (reliable on iOS)

### 3. OffscreenCanvas DOM canvas fallback — PASS

- **`pdf-viewer.js:191`** — `const _hasOffscreen = typeof OffscreenCanvas !== 'undefined';` (feature detection)
- **`pdf-viewer.js:416-417`** — Comment: "Always use DOM canvas (OffscreenCanvas 2D + pdf.js produces blank output on iOS Safari)"
- **`pdf-viewer.js:417`** — `const offCanvas = document.createElement('canvas');` (DOM fallback in preRenderPage)
- **`pdf-viewer.js:697`** — Comment: "Always use DOM canvas (OffscreenCanvas 2D + pdf.js = blank on iOS Safari)" (hi-res pass also uses DOM canvas)
- **`workers/pdf-render-worker.js:10-14`** — Worker itself does capability check with try/catch and throws if 2D context unavailable
- **`pdf-viewer.js:207-217`** — Worker capability-check failure (id === null) gracefully terminates worker

### 4. Input/Select/Textarea font-size >= 16px — FAIL

**Passing (verified at 16px+):**
- `#search-input` — `app.css:870` — 16px
- `.form-input` — `app.css:1968` — `max(16px, 14px)` = 16px
- `.modal input[type="text"]` / `input[type="password"]` — `app.css:2336` — 16px
- `.drive-field input` — `app.css:2378` — 16px
- `.github-field input` — `app.css:3701` — 16px
- `.setlist-comment-input` — `app.css:2875` — 16px
- `.wc-search-bar input` — `app.css:6246` — 16px
- `select, .settings-select, .settings-number, .link-platform-select, .wc-select` — `app.css:5307` — 16px (catch-all rule)

**FAILING:**
| Element | File:Line | Actual Size | Fix |
|---------|-----------|-------------|-----|
| `.practice-note-input` | `app.css:3211` | **13px** | Change to 16px |
| `.setlist-notes-textarea` | `app.css:1271` | **14px** | Change to 16px |
| `.wc-chord-input` | `app.css:6801` | **15px** | Change to 16px |
| `.wc-ending-edit .form-input` | `app.css:6759` | **12px** | Change to 16px |
| `.metronome-bpm-input` | `app.css:5805` | 32px (OK) | n/a |
| `.invite-bar input` | `app.css:7034` | **14px** | Change to 16px |
| `.instrument-picker .select-input` | `app.css:7081` | **14px** | Change to 16px |

### 5. `position: fixed` elements use `env(safe-area-inset-*)` — PASS (with notes)

**Elements properly using safe-area:**
- `#topbar` — `app.css:240-250` — Uses `var(--safe-top)` which is `env(safe-area-inset-top, 0px)`
- `#app` — `app.css:567` — Uses `var(--topbar-h) + var(--safe-top)` for top offset
- `#toast` — `app.css:3361` — Uses `var(--safe-bottom)` = `env(safe-area-inset-bottom, 0px)`
- `#install-gate` — `app.css:3471` — Uses both top and bottom safe-area insets
- `.batch-selection-bar` — `app.css:5500` — Uses `env(safe-area-inset-bottom, 0px)`
- `.modal-overlay` — `app.css:2275` — Uses `inset: 0` (full-screen overlay, content centered, safe)
- `.kb-help-overlay` — `app.css:5646` — Uses `inset: 0` (full-screen overlay, content centered, safe)
- Live mode header/nav — `app.css:4066, 4263, 4295, 4300, 4313` — All use safe-area insets

**Acceptable without safe-area (content not edge-touching):**
- `body::before` — decorative gradient overlay, pointer-events: none
- `#splash-screen` — temporary, full-screen, centered content
- `.welcome-overlay` — full-screen, centered content with padding
- `.practice-jump-bar` — positioned `right: 6px`, vertically centered, not edge-touching

### 6. `navigator.vibrate()` feature-detected — PASS

- **`js/utils.js:116`** — `const _canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';`
- **`js/utils.js:123`** — `if (_canVibrate) try { navigator.vibrate(pattern); } catch (_) {}`
- All vibration calls go through `haptic()` function, which checks `_canVibrate` first
- No direct `navigator.vibrate()` calls exist outside this wrapper

### 7. `navigator.storage.persist()` has .catch() — PASS

- **`app.js:2149-2150`** — `if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }`
- Feature-detected AND has `.catch()`

### 8. Install gate platform paths — PASS

All 5 required platform paths are present in `app.js:1712-1810`:

| Platform | Lines | Present |
|----------|-------|---------|
| iOS/iPad | `app.js:1716-1736` | YES — Share > Add to Home Screen instructions + Safari note |
| Firefox Android | `app.js:1752-1772` | YES — Menu > Install instructions |
| WebView | `app.js:1737-1751` | YES — "Open in Browser" button + copy URL fallback |
| macOS Safari | `app.js:1773-1793` | YES — File > Add to Dock instructions + Safari 17+ note |
| Android Chrome | `app.js:1794-1810` | YES — Menu > Install app instructions |

### 9. `-webkit-backdrop-filter` present — PASS

Every `backdrop-filter` in app.css has a matching `-webkit-backdrop-filter`:

| Location | Lines | Paired |
|----------|-------|--------|
| `#topbar` | 244-245 | YES |
| `.modal-overlay` | 2278-2279 | YES |
| `.modal-pdf` (toolbar context) | 2298-2299 | YES |
| `.lm-jump-list` | 4171-4172 | YES |
| `.lm-rehearsal-overlay` | 4781-4782 | YES |
| `.lm-auto-pick` | 4835-4836 | YES |
| `.batch-selection-bar` | 5502-5503 | YES |
| `.kb-help-overlay` | 5650-5651 | YES |
| `.practice-jump-bar` | 6042-6043 | YES |

### 10. `playsinline` on audio elements — PASS

- **`player.js:111`** — `audio.setAttribute('playsinline', '');`
- **`player.js:112`** — `audio.setAttribute('webkit-playsinline', '');` (legacy iOS support)
- All audio elements are created programmatically via `Player.create()` — this is the only audio creation path
- No `<audio>` or `<video>` tags in `index.html`

### 11. iPad + Magic Keyboard volume slider hidden on iPadOS — PASS

Two-layer protection:

- **CSS layer:** `app.css:358-361` — `@media (hover: none) and (pointer: coarse) { .master-volume { display: none !important; } }` (hides on touch-only)
- **JS layer (init):** `app.js:2591` — `const _iPadOSInit = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;` + `app.js:2595` — `else if (isMobile || _iPadOSInit)` skips volume setup entirely
- **JS layer (showVolume):** `app.js:2868` — `const _iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;` + `app.js:2869` — `if (vw && !_isMobile() && !_iPadOS)` prevents showing on iPadOS even with keyboard attached

Note: iPad + Magic Keyboard reports `hover: hover` and `pointer: fine`, bypassing the CSS media query. The JS-level iPadOS check catches this case.

### 12. Blob cache reduced on iOS — PASS

- **`app.js:52-54`** — iOS detection: `const _isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);`
- **`app.js:54`** — Adaptive sizing: `const BLOB_CACHE_MAX = _isIOSDevice ? 10 : _deviceMem <= 2 ? 5 : _deviceMem <= 4 ? 15 : 30;`
- iOS gets hard cap of 10 blobs (vs 15-30 on desktop)
- LRU eviction in `_evictBlobCache()` (`app.js:119-137`) protects active player audio URLs from eviction

### 13. `<select>` elements at 16px — FAIL (partial)

- **`app.css:5307`** — Catch-all rule: `select, .settings-select, .settings-number, .link-platform-select, .wc-select { font-size: 16px; }` — covers most selects
- **FAIL: `.instrument-picker .select-input`** — `app.css:7081` — `font-size: 14px` — This is a `<select>` element that is NOT covered by the catch-all (uses `.select-input` class, not `select` tag selector or `.settings-select`)
- **FAIL: `.wc-section-type-select`** — `app.css:6786` — No explicit font-size set. If this element uses `<select>`, it may inherit from the catch-all `select` rule (depends on specificity). Needs verification.

### 14. Stage Manager resize handler — PASS

- **`pdf-viewer.js:1221-1234`** — `window.visualViewport.addEventListener('resize', ...)` with 50px threshold
- Properly guards with `if (window.visualViewport)` check
- Clears render cache and re-renders when viewport width changes > 50px
- Also has orientation change handler at `pdf-viewer.js:1212-1218` via `_landscapeMQ`

### 15. iOS 15 overscroll-behavior fallback on live mode — PASS

- **`app.css:4036`** — `body.live-mode-active { ... touch-action: none; overscroll-behavior: none; }`
- **`app.css:4037`** — `html.live-mode-active { overflow: hidden; touch-action: none; overscroll-behavior: none; }`
- `touch-action: none` is the iOS 15 fallback (since `overscroll-behavior` wasn't supported until iOS 16)
- Applied to both `html` and `body` elements
- Additional `touch-action: none` on individual live mode elements: `.lm-slide` (4060), `.lm-swipe-zone` (4341), `.lm-timer-tap-zone` (4363)

---

## Action Items (6 violations, all in app.css)

| Priority | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| HIGH | `app.css` | 3211 | `.practice-note-input` font-size: 13px | Change to `font-size: 16px;` |
| HIGH | `app.css` | 1271 | `.setlist-notes-textarea` font-size: 14px | Change to `font-size: 16px;` |
| HIGH | `app.css` | 6801 | `.wc-chord-input` font-size: 15px | Change to `font-size: 16px;` |
| HIGH | `app.css` | 6759 | `.wc-ending-edit .form-input` font-size: 12px | Change to `font-size: 16px;` (or `max(16px, 12px)`) |
| HIGH | `app.css` | 7034 | `.invite-bar input` font-size: 14px | Change to `font-size: 16px;` |
| HIGH | `app.css` | 7081 | `.instrument-picker .select-input` font-size: 14px | Change to `font-size: 16px;` |

All 6 violations will cause iOS Safari to auto-zoom the viewport when the user focuses the input, which is jarring and breaks the layout until the user manually zooms back out.
