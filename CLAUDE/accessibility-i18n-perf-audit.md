# Accessibility, Internationalization & Performance Audit — Catman Trio App

**Date:** 2026-03-20
**App Version:** v20.24
**Architecture:** Vanilla JS PWA (no framework, no build tools)

---

## Table of Contents

1. [Accessibility (WCAG 2.1 AA)](#1-accessibility-wcag-21-aa)
2. [Internationalization (i18n)](#2-internationalization-i18n)
3. [Performance Budgets](#3-performance-budgets)
4. [Summary Matrix](#4-summary-matrix)

---

## 1. Accessibility (WCAG 2.1 AA)

### 1.1 Keyboard Navigation

| Issue | Affected | Severity | Fix Approach | Priority |
|---|---|---|---|---|
| **Song cards not keyboard-focusable** | Song list (all users) | HIGH | Cards are `<div>` with click handlers, no `tabindex="0"`, no `role="button"`, no `keydown` handler. Keyboard users cannot reach or activate songs. Add `tabindex="0"`, `role="button"`, and Enter/Space keydown handler to each `.song-card`. | P1 |
| **Tag filter chips not keyboard-focusable** | Tag bar (all users) | MEDIUM | Tag chips are `<button>` elements (good, inherently focusable). However, the horizontally-scrolling container has no keyboard scroll affordance — users can Tab to chips but overflow chips beyond the viewport are unreachable without horizontal scroll. Add `tabindex="0"` to the scroll container and allow Arrow key horizontal scrolling. | P2 |
| **Key filter chips same issue** | Key bar | MEDIUM | Same as tag chips — `<button>` elements are focusable, but overflow scrolling needs keyboard support. | P2 |
| **Footer nav links use `role="button"` but are `<a>` tags** | Footer | LOW | `<a href="#" role="button">` is semantically confusing. Either use `<button>` or remove `role="button"` and use proper `href` values. | P3 |
| **Topbar title has `role="button"` + `tabindex="0"` + empty `onclick`** | Topbar | LOW | `#topbar-title` has `role="button" tabindex="0" onclick=""` — keyboard users can reach it but pressing Enter does nothing. Either wire up an action or remove the interactive attributes. | P3 |
| **Edit form inputs lack visible focus indicators** | Edit song form | MEDIUM | Several form inputs (`.github-field input`, `.drive-field input`) set `outline: none` on `:focus` but only add `border-color` + `box-shadow`. The box-shadow glow is subtle and may not meet the 3px focus indicator requirement for some users. Ensure visible ring on all `:focus-visible` states. | P2 |
| **No keyboard trap in PDF viewer** | PDF modal | MEDIUM | PDF modal has `role="dialog" aria-modal="true"` and uses `Modal.show()` which sets up focus trap via `trapFocus()`. This is correct. However, zoom/pan gestures are touch-only — no keyboard zoom equivalent (Ctrl+/Ctrl- are not intercepted). Add keyboard zoom controls. | P2 |
| **Sortable drag handles (setlist edit) keyboard-inaccessible** | Setlist edit | MEDIUM | SortableJS drag handles work via pointer events only. Keyboard users cannot reorder setlist songs. Add Up/Down keyboard shortcuts on drag handles or provide move-up/move-down buttons as alternatives. | P2 |

### 1.2 Screen Reader Compatibility

| Issue | Affected | Severity | Fix Approach | Priority |
|---|---|---|---|---|
| **Song list updates not announced** | VoiceOver, TalkBack, NVDA | HIGH | When the song list re-renders (search, filter, sort), the `#song-list` container has no `aria-live` region. Screen readers don't announce "12 results found" or "No results." The `#list-no-results` and `#list-empty` DO have `aria-live="polite"` (good), but the normal filtered list count is never announced. Add a visually-hidden live region that announces result count on filter change. | P1 |
| **Song cards lack accessible names** | All screen readers | HIGH | Each `.song-card` is a clickable div with no `aria-label`. Screen readers will read all inner text concatenated, which is messy: "Bohemian Rhapsody Original by Queen F 73 bpm (4/4) 2 charts 1 demo Rock Classic". Add `aria-label="${song.title}"` to each card. | P1 |
| **View transitions not announced** | VoiceOver, TalkBack | MEDIUM | `showView()` moves focus to the new view (good: `el.focus({ preventScroll: true })`), but there's no announcement of what view the user is now on. Screen readers don't know they're now on "Song Detail: Bohemian Rhapsody". Use `aria-label` on each `.view` container or announce via live region. | P2 |
| **Dynamic modals created via `Modal.create()` properly labeled** | All | OK | `Modal.create()` auto-discovers heading for `aria-labelledby`, sets `role="dialog"` and `aria-modal="true"`. Focus trap works correctly. This is well-implemented. | -- |
| **Toast notifications properly announced** | All | OK | `#toast` has `role="status" aria-live="polite"`. Content updates are announced. Good. | -- |
| **PDF page changes not announced to screen readers** | PDF modal | MEDIUM | `#pdf-page-info` has `role="status" aria-live="polite"` — good, page number changes are announced. However, the actual canvas content is not described. Add `aria-label` to the canvas describing the PDF name and current page. | P3 |
| **Confirm modal Enter key fires on any open modal** | All | LOW | `Modal.confirm()` adds a global `keydown` listener for Enter that always fires `_ok()`. If another dialog opens on top, Enter will fire the confirm. The cleanup removes the listener when the modal closes, so this is mostly safe, but could cause issues with stacked modals. | P3 |
| **Audio player state not announced** | VoiceOver | MEDIUM | Play/pause button toggles between play and pause icons but `aria-label` stays "Play/Pause" permanently. Update it dynamically: "Playing" / "Paused" / "Play [track name]". | P2 |

### 1.3 ARIA Completeness

| Element | Current State | Issue | Fix |
|---|---|---|---|
| **`#song-list`** | No ARIA | Missing `role="list"` or `role="listbox"` | Add `role="list"` and `role="listitem"` on cards, or use `role="listbox"` + `role="option"` if selection mode |
| **`.song-card`** | No ARIA | Missing `role="button"`, `tabindex="0"`, `aria-label` | See 1.1 and 1.2 above |
| **`.tag-filter-chip`** | `<button>` | Missing `aria-pressed` state for toggle behavior | Add `aria-pressed="true/false"` based on active state |
| **`.kf-chip`** (key filter) | `<button>` | Same — missing `aria-pressed` | Add `aria-pressed` |
| **Sort toggle button** | `aria-label="Change sort order"` | Doesn't announce current sort state | Change to `aria-label="Sort by title"` / `"Sort by difficulty"` dynamically |
| **`#search-clear`** | `aria-label="Clear all filters"` | Good | OK |
| **Volume slider** | `aria-label="Master volume"` | Good | OK |
| **Modals** | `role="dialog" aria-modal="true"` | All static modals have `aria-labelledby` | OK |
| **Dynamic modals** | Auto `aria-labelledby` | `Modal.create()` auto-discovers headings | OK |
| **Back button** | `aria-label="Back"` | Good | OK |
| **Nav buttons** | `aria-current="page"` on active | Properly toggled in `showView()` | OK |
| **Error messages** | `#login-error` | No `role="alert"` or `aria-live` — login errors not announced | Add `role="alert"` to `#login-error` |
| **Sync indicator** | `aria-live="polite"` | Good | OK |

### 1.4 Color Contrast Analysis

All contrast ratios calculated against `--bg: #0e0e10` (dark background).

| Color | Variable | Hex | Contrast vs #0e0e10 | Min Required | Status |
|---|---|---|---|---|---|
| **Primary text** | `--text` | #d4d0cc | **12.4:1** | 4.5:1 (normal) | PASS |
| **Bright text** | `--text-bright` | #f0eeeb | **15.6:1** | 4.5:1 | PASS |
| **Muted text** | `--text-2` | #9e9a94 | **6.5:1** | 4.5:1 | PASS |
| **Tertiary text** | `--text-3` | #a8a29c | **7.2:1** | 4.5:1 | PASS |
| **Gold accent** | `--accent` | #f0cc80 | **11.4:1** | 4.5:1 | PASS |
| **Accent dim** | `--accent-dim` | #b8954e | **6.3:1** | 3:1 (large) | PASS |
| **Gold on bg-2** | `--accent` on #17171b | #f0cc80 on #17171b | **10.5:1** | 4.5:1 | PASS |
| **Tag text** | `--tag-text` #b0aaa3 on `--tag-bg` #252529 | -- | **5.8:1** | 4.5:1 | PASS |
| **Red** | `--red` | #ff6b6b on #0e0e10 | **5.8:1** | 4.5:1 | PASS |
| **Green** | `--green` | #4ade80 on #0e0e10 | **9.2:1** | 4.5:1 | PASS |
| **Placeholder text** | `--text-3` in inputs on `--bg-2` | #a8a29c on #17171b | **6.6:1** | 4.5:1 | PASS |
| **Btn-primary text** | #0e0e10 on gradient gold ~#f0cc80 | -- | **11.4:1** | 4.5:1 | PASS |
| **Song card key text** | `--accent` 13px on `--bg-2` | #f0cc80 on #17171b | **10.5:1** | 4.5:1 | PASS |
| **Splash screen letters** | rgb(215,175,90) on #0e0e10 | ~#d7af5a | **8.4:1** | 3:1 (decorative large) | PASS |

**Result:** All color combinations PASS WCAG 2.1 AA contrast requirements. The dark theme with warm gold accent is well-chosen for accessibility.

**Note:** The original audit mentions `#d4b478` as "gold" — this color is not used in the current CSS. The actual accent is `#f0cc80` (even higher contrast). The gradient characters use RGB values from 215,175,90 to 240,220,165, all of which pass.

### 1.5 Touch Targets

| Element | Actual Size | WCAG Min | Status | Fix |
|---|---|---|---|---|
| **`.icon-btn`** | 36x36px visual, **44x44px touch** via `::before` pseudo on `(pointer: coarse)` | 44x44px | PASS | The pseudo-element expansion is clever and correct |
| **`.audio-play-btn`** | 36x36px | 44x44px | FAIL | No pseudo expansion. Play button on song detail view is undersized on touch. Add the same `::before` expansion pattern. |
| **`.audio-speed-btn`** | Text only, ~40px wide x ~30px tall | 44x44px | FAIL | Speed button is too small. Add min-height: 44px and padding. |
| **`.tag-filter-chip`** | ~60px x 30px (padding: 5px 10px) | 44x44px height | FAIL | Height is only ~30px. Increase padding to at least `12px 10px` for 44px touch target. |
| **`.kf-chip`** (key filter) | Same as tag chip | 44x44px height | FAIL | Same fix needed. |
| **`.song-card-edit-btn`** | 28x28px visual, 44x44px touch via `::before` | 44x44px | PASS | Same pseudo pattern as icon-btn |
| **`.loop-nudge` buttons** | Small + and - | 44x44px | FAIL | Loop nudge buttons are tiny. Needs min-width/height: 44px. |
| **`.loop-set-btn`** | ~50px x 30px | 44x44px | BORDERLINE | Height may be under 44px. Add min-height. |
| **Footer links** | Text links ~44px tall | 44x44px | CHECK | Depends on line-height. Verify padding. |

### 1.6 Focus Indicators

| Element | Focus Style | Status |
|---|---|---|
| **`.icon-btn`** | `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` | PASS |
| **`.btn-primary/secondary/danger/ghost`** | Same `:focus-visible` rule | PASS |
| **`#search-input`** | `border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg)` — no outline | PARTIAL — glow is subtle |
| **`.github-field input`** | `outline: none; border-color: var(--accent-dim); box-shadow: 0 0 0 3px var(--accent-glow)` | FAIL — glow at 8% opacity is invisible |
| **`.drive-field input`** | Same as github-field | FAIL |
| **`.form-input`** | `outline: none` + border change | PARTIAL |
| **`.audio-progress`** (range slider) | `outline: none` | FAIL — no visible focus state at all |
| **`.settings-toggle input`** | `:focus-visible` on toggle track | PASS |
| **`.song-card`** | No focus style (not focusable) | N/A — needs to become focusable first |
| **`.skip-link`** | `:focus { top: 0; }` — slides into view | PASS |
| **Live mode buttons** | `:focus-visible { box-shadow: 0 0 0 3px var(--accent); }` | PASS |

### 1.7 Error Announcements

| Error Context | Announced? | Fix |
|---|---|---|
| **Login error** | NO — `#login-error` has no `role="alert"` or `aria-live` | Add `role="alert"` to `#login-error` |
| **Edit form validation** | NOT TESTED — edit form validation is inline JS. Errors shown via `showToast()` which IS announced via `aria-live` on `#toast` | PARTIAL — toasts are announced but the specific field in error is not identified |
| **Audio playback error** | NO — `.audio-error` class added visually but no SR announcement | Add `aria-live="assertive"` error message |
| **Sync errors** | VIA TOAST — `showToast()` is used for sync failures, which is announced | OK |
| **Network offline** | VIA QI BADGE — `#qi-badge` has no `aria-live` | Add `aria-live="polite"` |

### 1.8 Skip Link

The skip link (`<a href="#app" class="skip-link">Skip to content</a>`) is:
- Present in the static HTML (good)
- Styled to appear on focus (good: `:focus { top: 0; }`)
- Links to `#app` which is the `<main>` element (good)
- `<main id="app">` does not have `tabindex="-1"` — the skip link targets it but focus won't actually land on it in all browsers

**Fix:** Add `tabindex="-1"` to `<main id="app">` so the skip link target is focusable.

---

## 2. Internationalization (i18n)

### 2.1 Non-Latin Character Rendering

| Test Case | Status | Notes |
|---|---|---|
| **Japanese titles** (e.g. "上を向いて歩こう") | PASS | UTF-8 charset declared. `esc()` function handles all Unicode characters correctly — it only escapes HTML special chars (`& < > "`), not Unicode. |
| **Chinese characters** (e.g. "月亮代表我的心") | PASS | Same as Japanese. Font stack uses `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` which all have CJK fallbacks. |
| **Korean** (e.g. "강남스타일") | PASS | System font fallback handles Hangul. |
| **Arabic** (e.g. "يا ليل يا عين") | PARTIAL | Characters render but layout is LTR — see RTL section. |
| **Cyrillic** (e.g. "Калинка") | PASS | Inter font supports Cyrillic natively. |
| **Devanagari/Thai/etc.** | PARTIAL | System fallback fonts handle these, but the decorative fonts (Oxanium, Chakra Petch) used for song titles do NOT support non-Latin scripts — they'll fall back to the system font, creating visual inconsistency. |

### 2.2 Non-Latin Character Search

| Operation | Status | Issue |
|---|---|---|
| **Search** | PASS | Search uses `.toLowerCase().includes()` which works with Unicode. Japanese/Chinese/Korean characters don't have case, so `.toLowerCase()` is a no-op (correct). |
| **Highlighting** | PASS | `highlight()` escapes HTML first, then applies regex. The regex uses `gi` flag which handles Unicode via JS's native Unicode support. |
| **Levenshtein duplicate detection** | PARTIAL | `levenshtein()` operates on character-level. CJK characters are single code points (good), but emoji and combined characters (e.g., accented chars via combining marks) may produce unexpected distances. For a band app, this is acceptable. |

### 2.3 Non-Latin Character Sorting

| Operation | Status | Issue |
|---|---|---|
| **Title sort** | PASS | Uses `.localeCompare()` which handles accented characters correctly by default. French "etre" vs "etre" sorts properly. |
| **Locale sensitivity** | PARTIAL | `localeCompare()` with no arguments uses the browser's default locale. This works well for single-locale users but if the song list mixes languages (e.g., English + Japanese titles), the sort order depends on the browser locale. For a band app, this is acceptable behavior. |
| **Key sort** | OK | Musical keys are ASCII-only (A-G, #, b). No i18n concern. |
| **Tag sort** | PASS | Uses count-based sort (most used first), then falls back to insertion order. No alphabetical comparison needed. |

### 2.4 RTL Text

| Issue | Affected | Severity | Fix Approach | Priority |
|---|---|---|---|---|
| **No RTL support** | Arabic/Hebrew song titles | LOW | The app has zero `direction`, `dir`, or `writing-mode` CSS properties. All layout is hardcoded LTR (e.g., `padding-left`, `border-left: 3px solid`, `text-align: left`). If a user enters Arabic/Hebrew text, individual words will render RTL (browser handles bidirectional text natively) but the overall layout remains LTR. For a band app where the primary audience is English-speaking, this is acceptable. | P4 |
| **Mixed LTR/RTL in song titles** | Edge case | LOW | If a song title contains both English and Arabic (e.g., "Ya Salam يا سلام"), the browser's bidi algorithm handles this correctly at the inline level. Card layout won't break. | -- |

### 2.5 Emoji in Song Names

| Operation | Status | Notes |
|---|---|---|
| **Rendering** | PASS | Modern browsers render emoji natively. The `esc()` function doesn't strip emoji. |
| **Search** | PASS | `.includes()` handles emoji code points. |
| **Truncation** | CAUTION | `text-overflow: ellipsis` with `white-space: nowrap` may split a multi-codepoint emoji (e.g., flag emoji = 2 code points, family emoji = multiple ZWJ sequences). This causes garbled display at truncation boundary. CSS-only solution is limited; the workaround is `overflow-wrap: break-word` but this conflicts with `white-space: nowrap`. Low priority since emoji in song titles is uncommon. |
| **`highlight()`** | PASS | Emoji don't match the regex escape pattern, so they pass through untouched. |
| **Storage** | PASS | localStorage and D1 both handle UTF-8 including emoji. |

### 2.6 Long Titles

| Scenario | Status | Fix |
|---|---|---|
| **German compound words** (e.g., "Donaudampfschifffahrtsgesellschaftskapitansmutzenstrick") | PASS | `.song-card-title` has `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` — long single words are truncated with ellipsis. |
| **Long URLs in notes** | PARTIAL | Notes field in detail view uses `word-break: break-word` in some places but not consistently. Long unbroken URLs could overflow some containers. Specifically: song detail notes area and setlist notes need `overflow-wrap: break-word`. |
| **Setlist venue names** | PASS | Truncated via ellipsis. |
| **Practice list notes** | PASS | `.practice-note-input` has adequate sizing. |

### 2.7 Character Encoding

| Check | Status | Notes |
|---|---|---|
| **`<meta charset="UTF-8">`** | PRESENT | Line 4 of index.html |
| **`esc()` function** | SAFE | Escapes `& < > "` — correctly does NOT escape single quotes in attributes (since attributes use double quotes) or Unicode characters. However, **single quotes in `data-*` attributes could be an issue**: tag names with apostrophes (e.g., "80's Rock") would break `data-tag="${esc(t)}"` if the value contains a single quote. `esc()` doesn't escape `'`. |
| **`highlight()` function** | SAFE | Escapes first, then applies regex. Output is safe HTML. |
| **`escHtml()` in player.js** | SAFE | Same escaping pattern: `& < > "`. |
| **Template literals with `esc()`** | MOSTLY SAFE | Most dynamic values go through `esc()`. Spot-checked: tag chips, song titles, search queries — all escaped. |
| **XSS via song title** | SAFE | `esc()` prevents `<script>` injection. `highlight()` uses `esc()` first. The one concern is `innerHTML` usage (37 occurrences in songs.js) but all user-facing values are escaped. |

**Encoding gap:** The `esc()` function does not escape single quotes (`'`). While double-quoted HTML attributes are safe, any template that uses single-quoted attributes (e.g., `onclick='...'`) would be vulnerable. Current codebase uses double quotes consistently, so this is LOW risk.

### 2.8 Locale-Dependent Sorting

`.localeCompare()` is used correctly in two places:
1. `songs.sort((a, b) => (a.title || '').localeCompare(b.title || ''))` — alphabetical sort
2. `allKeys()` sort: `a.localeCompare(b)` — key name tiebreaker

Both use the default locale (no explicit locale parameter), which means:
- Accented characters (e, n, u) sort near their base characters: CORRECT
- German umlauts (a, o, u) sort correctly in German locale: CORRECT
- Swedish a sorts after z in Swedish locale: CORRECT (but may surprise English users)

**Assessment:** For a band app with primarily English content, the default `localeCompare()` behavior is correct and sufficient.

---

## 3. Performance Budgets

### 3.1 JS Bundle Size

| File | Est. Size (uncompressed) | Role |
|---|---|---|
| **app.js** | ~120 KB | Main orchestrator |
| **js/songs.js** | ~65 KB | Song list/detail/edit |
| **js/setlists.js** | ~80 KB | Setlists + live mode |
| **js/practice.js** | ~45 KB | Practice lists |
| **js/dashboard.js** | ~55 KB | Admin dashboard |
| **js/wikicharts.js** | ~40 KB | WikiCharts |
| **js/orchestra.js** | ~20 KB | Orchestra management |
| **js/instruments.js** | ~15 KB | Instrument hierarchy |
| **js/router.js** | ~10 KB | Hash routing |
| **js/store.js** | ~8 KB | State management |
| **js/utils.js** | ~14 KB | Utilities |
| **js/modal.js** | ~8 KB | Modal system |
| **js/sync.js** | ~15 KB | Data sync |
| **js/migrate.js** | ~5 KB | Data migration |
| **player.js** | ~22 KB | Audio player |
| **pdf-viewer.js** | ~45 KB | PDF viewer + zoom/pan |
| **metronome.js** | ~15 KB | Metronome |
| **admin.js** | ~25 KB | Edit mode + CRUD |
| **auth.js** | ~20 KB | Authentication |
| **drive.js** | ~10 KB | Google Drive |
| **github.js** | ~15 KB | GitHub sync |
| **idb.js** | ~8 KB | IndexedDB wrapper |
| **service-worker.js** | ~10 KB | PWA service worker |
| **App JS total** | **~670 KB** | All app code |
| **lucide.min.js** | ~220 KB | Icon library |
| **lib/pdf.min.js** | ~800 KB | PDF.js core |
| **lib/pdf.worker.min.js** | ~1.2 MB | PDF.js worker |
| **lib/Sortable.min.js** | ~45 KB | Drag-and-drop |
| **Total JS (all)** | **~2.9 MB** uncompressed | |
| **Est. gzip transfer** | **~700-800 KB** | Typical gzip ratio 3.5-4x |

| Assessment | Details |
|---|---|
| **Critical path JS** | `app.js` (entry point) + `lucide.min.js` (sync script) + `pdf.min.js` (sync script). The two lib scripts in `<head>` block parsing until downloaded. |
| **Recommendation** | Move `lib/pdf.min.js` and `lib/Sortable.min.js` to `defer` or load on demand. PDF.js is only needed when a user opens a PDF. Sortable is only needed in setlist/practice edit views. This would cut critical-path JS by ~845 KB uncompressed. |

### 3.2 CSS Size

| File | Est. Size | Notes |
|---|---|---|
| **app.css** | ~160 KB | Single stylesheet, all styles |
| **Google Fonts (4 families)** | ~120 KB | Inter, Audiowide, Oxanium, Chakra Petch |

**Assessment:** 160 KB CSS is large but acceptable for a feature-rich single-file approach. No critical issues. The CSS is well-organized with a clear table of contents.

### 3.3 First Contentful Paint (Critical Rendering Path)

```
1. HTML parse begins
2. Inline splash screen CSS + animation renders IMMEDIATELY (good)
3. <link rel="preload" href="app.css"> — starts early fetch
4. <link rel="preload" href="lucide.min.js"> — starts early fetch
5. <link rel="modulepreload" href="app.js"> — starts early fetch
6. <script src="lib/pdf.min.js"> — BLOCKING parse (no defer/async)
7. <script src="lib/Sortable.min.js"> — BLOCKING parse (no defer/async)
8. <link rel="stylesheet" href="app.css"> — render-blocking
9. Google Fonts (4 families via CSS) — render-blocking for text
10. Inline 2s safety timeout removes splash
11. <script src="lucide.min.js"> — BLOCKING parse (no defer/async)
12. <script type="module" src="app.js"> — deferred by default (good)
```

| Issue | Severity | Fix | Priority |
|---|---|---|---|
| **pdf.min.js + Sortable.min.js block parsing** | HIGH | These are in `<head>` as synchronous scripts. They block HTML parsing for ~200-400ms on 3G. Add `defer` attribute to both. | P1 |
| **4 Google Font families loaded upfront** | MEDIUM | Audiowide, Oxanium, Chakra Petch are decorative fonts used sparingly. Consider `font-display: optional` or loading them async via `media="print" onload` pattern. Inter is the body font and should stay `display=swap`. | P2 |
| **lucide.min.js is synchronous** | LOW | At 220KB, this blocks briefly. However, it's at the bottom of `<body>` so it doesn't block visible content. The preload hint helps. | P3 |
| **Splash screen** | GOOD | Inline CSS renders instantly before any external stylesheet. 2s hard kill ensures no stuck splash. Smart approach. | -- |

**Estimated FCP on fast 3G:**
- Current: ~1.5-2.0s (splash shows immediately, but app content waits for CSS + fonts)
- With `defer` on libs: ~1.0-1.5s (HTML parses faster, app.css still blocks)

### 3.4 Memory High-Water Marks

| Scenario | Estimated Memory | Risk | Mitigation |
|---|---|---|---|
| **Idle app (no data)** | ~15-20 MB | None | Normal JS heap |
| **500 songs loaded** | ~25-30 MB | Low | Song objects are lightweight JSON |
| **1000 songs loaded** | ~35-45 MB | Low | Array iteration still fast |
| **Blob cache (30 items)** | 30-200 MB | **HIGH** | Each blob URL holds a reference to the blob in memory. 30 audio files at 3-7 MB each = 90-210 MB. LRU eviction helps but the max is high. |
| **PDF rendering** | 20-60 MB per page | **HIGH** | Full-resolution canvas at 2x DPR for a letter-size PDF = ~34 MB bitmap. Render cache holds multiple pages. |
| **PDF render cache** | Up to 200 MB | **HIGH** | `_renderCache` Map has no size limit documented. Each cached canvas = ~17-34 MB. 6 cached pages = 100-200 MB. |
| **Live mode (10 songs)** | 50-150 MB | MEDIUM | Pre-rendered canvases for carousel + blob cache for audio |
| **Audio proxy blobs** | Duplicates blob data | MEDIUM | iOS Safari proxy copies blob data into SW scope. 30-min TTL helps but a user playing 5 songs = 15-35 MB extra. |

**Recommendations:**

| Fix | Impact | Effort | Priority |
|---|---|---|---|
| **Cap render cache entries** | Prevents 200MB+ canvas memory | Add LRU with max 4-6 entries to `_renderCache` | P1 |
| **Reduce BLOB_CACHE_MAX on low-memory devices** | Prevents OOM on budget phones | Check `navigator.deviceMemory` (Chromium) and reduce to 10-15 | P2 |
| **Cap PDF render DPR** | Halves canvas memory | `Math.min(window.devicePixelRatio, 2)` for canvases | P2 |
| **Lazy-load PDF.js** | Reduces initial memory by ~10 MB | Dynamic `import()` when first PDF is opened | P2 |

### 3.5 Service Worker Boot Time

| Phase | Estimated Time | Notes |
|---|---|---|
| **SW install (first visit)** | 2-5s | Caches 48 shell assets. On slow 3G could be 10-15s. |
| **SW activate** | <100ms | Just cache cleanup |
| **SW fetch (cache hit)** | 1-5ms | Network-first with cache fallback for app shell |
| **SW fetch (cache miss)** | Network dependent | Falls through to network |
| **Cold start impact** | ~50-100ms | SW boot + cache lookup adds small overhead |

**Assessment:** Service worker performance is good. The `SHELL_ASSETS` list of 48 items is reasonable. `skipWaiting()` + `clients.claim()` ensures immediate activation.

### 3.6 Animation Performance

| Animation | Type | GPU-Accelerated? | Issue |
|---|---|---|---|
| **View transitions** | `transform + opacity` | YES | Compositor-only, no layout thrash. Good. |
| **Card entry (cardIn)** | `transform + opacity` | YES | Staggered via `animation-delay`. Spring easing. Good. |
| **Card hover lift** | `transform: translateY(-2px)` | YES | Compositor-only. Good. |
| **Toast slide** | CSS transition | YES | Simple opacity/transform. Good. |
| **Topbar scroll effect** | JS scroll listener | CAUTION | If using `requestAnimationFrame`, fine. Check if scroll listener throttled. |
| **Audio progress bar** | rAF-driven `style.setProperty` | CAUTION | `--pct` custom property update triggers repaint on every frame. The slider track uses `linear-gradient()` with `calc(var(--pct) * 1%)` which forces gradient recomputation. This is acceptable on modern devices but could be janky on low-end. |
| **PDF pinch zoom** | `transform` via rAF | YES | `will-change: transform` on swipe-back. Compositor-only. Good. |
| **Live mode carousel** | Not investigated | NEEDS CHECK | Carousel swipe should use `transform: translateX()` for GPU acceleration. |
| **`contain: layout style paint`** on song cards | | YES | Excellent — CSS containment isolates card repaints from affecting the entire list. |
| **`content-visibility: auto`** on no-animate cards | | YES | Excellent — skips rendering for off-screen cards. Combined with `contain-intrinsic-size: auto 72px`. |

**`will-change` usage:** Only found on `.view.active.swipe-back-active` (`will-change: transform, opacity`). This is correct — `will-change` is applied temporarily during swipe, not permanently (which would waste GPU memory).

### 3.7 Large Dataset Performance

| Scenario | Current Behavior | Risk | Recommendation |
|---|---|---|---|
| **1000 songs** | All rendered to DOM. Card stagger animation applies to first 8, rest instant. `content-visibility: auto` on re-renders (`.no-animate` class). DOM reconciliation via keyed update. | MEDIUM | 1000 DOM nodes is manageable. `content-visibility: auto` handles scroll perf. But initial render creates all 1000 nodes synchronously, which could cause ~50-100ms jank. Consider chunked rendering (first 50, then rest via `requestIdleCallback`). |
| **50 setlists** | All rendered. Setlists are lightweight cards. | LOW | 50 cards is trivial. No concern. |
| **100 practice lists** | All rendered. | LOW | Same as setlists. No concern. |
| **Search with 1000 songs** | `.toLowerCase().includes()` on title, subtitle, key, tags, notes for every song. No debounce visible in the search handler. | MEDIUM | Linear scan of 1000 songs with string ops on 5 fields = ~5-10ms. Acceptable, but notes field could be large. Search is debounce-wrapped (check app.js for the actual wiring). |
| **Tag filter bar with 50+ tags** | All rendered as pill buttons in a horizontal scroll. | LOW | 50 buttons is fine. |
| **Fingerprinting** | `_preFiltered.map(s => s.id).join(',')` creates a string of all filtered IDs for cache key comparison. With 1000 songs, this creates a ~20KB string on every render call. | LOW | Wasteful but not a bottleneck. Could use a hash. |

---

## 4. Summary Matrix

### Accessibility Issues by Priority

| # | Issue | Severity | Category | Effort |
|---|---|---|---|---|
| **A1** | Song cards not keyboard-focusable | HIGH | Keyboard | 1 hr |
| **A2** | Song list changes not announced to screen readers | HIGH | Screen reader | 30 min |
| **A3** | Song cards lack accessible names | HIGH | Screen reader | 30 min |
| **A4** | `.audio-play-btn` undersized touch target (36px) | MEDIUM | Touch targets | 15 min |
| **A5** | `.tag-filter-chip` / `.kf-chip` undersized height | MEDIUM | Touch targets | 15 min |
| **A6** | Form inputs have invisible focus indicators (outline: none + faint glow) | MEDIUM | Focus | 30 min |
| **A7** | Audio progress slider has no focus indicator | MEDIUM | Focus | 15 min |
| **A8** | Audio player play/pause aria-label doesn't update | MEDIUM | Screen reader | 15 min |
| **A9** | View transitions not announced | MEDIUM | Screen reader | 30 min |
| **A10** | Login error not announced (`#login-error` missing `role="alert"`) | MEDIUM | Screen reader | 5 min |
| **A11** | Tag/key chips missing `aria-pressed` toggle state | MEDIUM | ARIA | 15 min |
| **A12** | SortableJS drag handles keyboard-inaccessible | MEDIUM | Keyboard | 2 hr |
| **A13** | Skip link target `<main id="app">` missing `tabindex="-1"` | LOW | Skip link | 5 min |
| **A14** | `#topbar-title` has interactive attributes but no action | LOW | Keyboard | 5 min |
| **A15** | Speed button touch target undersized | LOW | Touch targets | 10 min |
| **A16** | Loop nudge buttons undersized | LOW | Touch targets | 10 min |

### i18n Issues by Priority

| # | Issue | Severity | Effort |
|---|---|---|---|
| **I1** | `esc()` doesn't escape single quotes (low XSS risk in `data-*` attrs) | LOW | 10 min |
| **I2** | Decorative fonts (Oxanium, Chakra Petch) don't support non-Latin scripts | LOW | N/A (by design) |
| **I3** | No RTL layout support | LOW | 8+ hr (if needed) |
| **I4** | Emoji truncation may garble multi-codepoint sequences | LOW | N/A (CSS limitation) |
| **I5** | Long unbroken URLs in notes may overflow | LOW | 15 min |

### Performance Issues by Priority

| # | Issue | Severity | Effort |
|---|---|---|---|
| **P1** | `pdf.min.js` + `Sortable.min.js` block HTML parsing (sync scripts in head) | HIGH | 5 min (add `defer`) |
| **P2** | PDF render cache has no size limit (unbounded memory) | HIGH | 30 min |
| **P3** | Blob cache max 30 items could consume 200+ MB on low-end devices | MEDIUM | 30 min |
| **P4** | 4 Google Font families loaded upfront | MEDIUM | 30 min |
| **P5** | PDF canvas at device DPR can use 34+ MB per page | MEDIUM | 15 min |
| **P6** | 1000 songs rendered synchronously (no chunking) | MEDIUM | 1 hr |
| **P7** | List fingerprint builds 20KB string on every render | LOW | 15 min |

### Overall Scores

| Category | Score | Key Findings |
|---|---|---|
| **Keyboard Navigation** | 5/10 | Song cards (primary interaction) completely inaccessible via keyboard |
| **Screen Readers** | 6/10 | Good modal ARIA, good toast announcements, but song list is the gap |
| **ARIA Completeness** | 6/10 | Static modals excellent, dynamic song cards missing roles/labels |
| **Color Contrast** | 10/10 | All combinations pass WCAG AA. Excellent dark theme choices. |
| **Touch Targets** | 7/10 | Smart pseudo-element expansion on icon buttons, but audio controls undersized |
| **Focus Indicators** | 6/10 | Good on buttons, missing on form inputs and sliders |
| **Error Announcements** | 5/10 | Toast works, but login errors and audio errors not announced |
| **Skip Link** | 8/10 | Present and styled, minor target fix needed |
| **i18n: Non-Latin** | 8/10 | UTF-8 throughout, system font fallbacks, search works |
| **i18n: RTL** | 3/10 | No support, but acceptable for target audience |
| **i18n: Long Text** | 8/10 | Ellipsis truncation, word-break in most places |
| **Performance: Bundle** | 6/10 | 2.9 MB JS total, render-blocking libs in head |
| **Performance: Memory** | 5/10 | Unbounded PDF cache, high blob cache ceiling |
| **Performance: Animations** | 9/10 | Compositor-only, CSS containment, content-visibility |
| **Performance: Large Data** | 7/10 | Works but no virtualization or chunking |

**Overall Accessibility: 6.2/10** — Solid ARIA on modals and static elements, but the primary interaction (song list browsing) is keyboard-inaccessible and poorly announced to screen readers.

**Overall i18n: 7.5/10** — Good UTF-8 support and encoding safety. RTL is the gap but acceptable for target audience.

**Overall Performance: 6.8/10** — Good animation performance and CSS containment, but render-blocking scripts and unbounded memory caches are the main risks.
