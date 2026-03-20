# Barrel Round 1 -- Accessibility, i18n, Performance Audit

**Date**: 2026-03-20
**Auditor**: Claude Opus 4.6
**Scope**: Post-fix verification of device compatibility fixes across 14 core files
**Method**: Static code analysis (no runtime testing)

---

## Summary

| Category | Checks | PASS | FAIL/MISSING | Notes |
|----------|--------|------|-------------|-------|
| Accessibility | 16 | 10 | 6 | Cards partially done; router announcements missing |
| i18n | 3 | 3 | 0 | All green |
| Performance | 7 | 6 | 1 | No virtualization for large lists |
| PWA | 4 | 2 | 2 | Missing modules in SHELL_ASSETS; no multi-tab guard |

**Total: 30 checks -- 21 PASS, 9 FAIL/MISSING**

---

## Accessibility

### 1. Song cards -- tabindex, role, aria-label
**PASS**
`js/songs.js` lines 369-371 and 386-388:
```
card.setAttribute('tabindex', '0');
card.setAttribute('role', 'button');
card.setAttribute('aria-label', `Song: ${song.title || 'Untitled'}`);
```
Applied on both reused and newly created cards.

### 2. Setlist cards -- tabindex, role, aria-label
**PASS**
`js/setlists.js` line 330 -- inline in HTML template:
```html
<div class="setlist-card" ... tabindex="0" role="button" aria-label="Setlist: ${esc(title)}">
```

### 3. Practice list cards -- tabindex, role, aria-label
**FAIL**
`js/practice.js` lines 493, 513 -- `.pl-card` elements have NO `tabindex`, NO `role="button"`, NO `aria-label`.
Cards are only clickable via JS event listeners (line 532-538). Screen readers and keyboard users cannot reach or activate them.

**Fix needed**: Add `tabindex="0" role="button" aria-label="Practice list: ${esc(pl.name || 'Untitled')}"` to the `.pl-card` div.

### 4. WikiChart cards -- tabindex, role, aria-label
**FAIL**
`js/wikicharts.js` line 528 -- `.wc-list-row` elements have NO `tabindex`, NO `role="button"`, NO `aria-label`.

**Fix needed**: Add `tabindex="0" role="button" aria-label="WikiChart: ${esc(chart.title || 'Untitled')}"` to the `.wc-list-row` div.

### 5. Song list container -- aria-live="polite"
**PASS**
`index.html` line 190: `<div id="song-list" aria-live="polite" aria-relevant="additions removals">`

### 6. Setlist list container -- aria-live="polite"
**PASS**
`index.html` line 245: `<div id="setlists-list" ... aria-live="polite" aria-relevant="additions removals">`

### 7. Filter/tag chips -- aria-pressed
**PASS**
`js/songs.js` line 220: `aria-pressed="${activeTags.includes(t)}"` on `.tag-filter-chip` buttons.

### 8. Key filter chips -- aria-pressed
**PASS**
`js/songs.js` line 270: `aria-pressed="${activeKeys.includes(k)}"` on `.kf-chip` buttons.

### 9. Modals -- role="dialog", aria-modal="true", focus trap
**PASS**
- All static modals in `index.html` have `role="dialog" aria-modal="true" aria-labelledby="..."` (lines 310, 360, 400, 412, 436).
- Dynamic modals via `Modal.create()` in `js/modal.js` line 248-257 also set these attributes.
- Focus trap implemented in `js/modal.js` lines 30-56 with `trapFocus()`. Tab/Shift-Tab cycling, auto-focus first element, restore previous focus on release.

### 10. Color contrast -- gold (#d4b478) on dark (#1a1a1d)
**PASS**
Calculated contrast ratio:
- #d4b478 luminance: ~0.426
- #1a1a1d luminance: ~0.014
- Ratio: (0.426 + 0.05) / (0.014 + 0.05) = ~7.4:1
This exceeds WCAG AA (4.5:1) and AAA (7:1) for normal text.

### 11. .icon-btn touch targets >= 44px on coarse pointer
**PASS**
`app.css` line 480: `@media (any-pointer: coarse) { .icon-btn { min-width: 44px; min-height: 44px; } }`
Also has pseudo-element expansion at line 467-474 for `(pointer: coarse)`.

### 12. Focus indicators visible
**PARTIAL PASS / CONCERN**
- Good: `app.css` lines 552-560 define `focus-visible` rings with 2px solid accent + 2px offset for `.icon-btn`, `.text-btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`.
- Concern: Multiple `outline: none` declarations (lines 369, 872, 1701, 1970, 2035, 2150, 2338, 2380, 3223, 3708, 5288, 5304, 5344, 5815, 6248) on inputs and sliders. Most of these are inputs that have `border-color` or `box-shadow` focus indicators instead, so this is acceptable browser-reset behavior.
- The `outline: none` usages are on form inputs that have visible `:focus` styles (border-color transitions), so they are **acceptable**. No hidden focus rings on interactive elements.

**Verdict: PASS** (with note that live-mode buttons correctly use `box-shadow` + `outline: none` at lines 4128, 4148, 4285).

### 13. Skip-to-content link
**PASS**
`index.html` line 108: `<a href="#app" class="skip-link">Skip to content</a>`
`app.css` lines 181-195: Positioned off-screen, slides in on `:focus`.

### 14. Router announces page changes to screen readers
**FAIL**
`js/router.js` `showView()` (line 137) does set focus on the new view container (line 180: `el.focus({ preventScroll: true })`), which helps screen readers know the view changed. However, there is NO `aria-live` region or visually-hidden announcer element that announces the page name (e.g., "Navigated to Setlists"). Focus alone is insufficient for some screen readers that do not announce the newly focused container.

**Fix needed**: Add a visually-hidden `aria-live="assertive"` announcer element and update it in `showView()` with the view name.

### 15. Form validation errors -- aria-live or role="alert"
**FAIL**
`index.html` line 338: `<div id="login-error" class="error-msg hidden">` -- NO `role="alert"` and NO `aria-live`. When login fails, the error message appears but is not announced to screen readers.

**Fix needed**: Add `role="alert" aria-live="assertive"` to `#login-error`.

### 16. Keyboard navigation -- no traps
**PARTIAL PASS**
- Song cards have `tabindex="0"` and `role="button"` but NO keydown handler for Enter/Space activation. `js/songs.js` has no `keydown` or `keypress` listener on song cards. The `role="button"` contract requires Enter/Space to activate.
- Same issue for setlist cards (inline `tabindex="0" role="button"` but no keyboard activation handler visible).
- Practice and WikiChart cards lack tabindex entirely (see items 3 and 4).

**Verdict: FAIL** -- `role="button"` elements must have keyboard activation. Song cards and setlist cards are keyboard-focusable but not keyboard-activatable.

---

## i18n

### 17. esc() handles all HTML special chars
**PASS**
`js/utils.js` lines 19-23: Escapes `&`, `<`, `>`, `"`.
Note: Single quotes (`'`) are NOT escaped, which is fine because the app uses double-quoted HTML attributes consistently. The `esc()` function in `player.js` (line 652-658) matches the same pattern.

### 18. Text overflow handling
**PASS**
`app.css` has extensive `text-overflow: ellipsis` usage (20+ instances at lines 286, 451, 1069, 1079, 1496, 1638, 2092, 2424, 2564, 2762, 2815, 2970, 3004, 3093, 3136, 3241, 4101). Also `word-break: break-all` (lines 824, 3627) and `word-break: break-word` (line 3813).

### 19. Sorting uses localeCompare
**PASS**
All text sorting uses `localeCompare`:
- `js/songs.js` line 98: `(a.title || '').localeCompare(b.title || '')`
- `js/setlists.js` lines 380-381
- `js/wikicharts.js` line 482
- `js/practice.js` line 714

---

## Performance

### 20. defer on blocking scripts
**PASS**
`index.html` lines 91-92:
```html
<script src="lib/pdf.min.js" defer></script>
<script src="lib/Sortable.min.js" defer></script>
```

### 21. PDF render cache capped at 20
**PASS**
`pdf-viewer.js` line 47: `const MAX_RENDER_CACHE = Math.min(20, ...)`
Adaptive sizing: 8 for <= 2GB RAM, 15 for <= 4GB, 20 max.

### 22. Blob cache adaptive (iOS/low-mem)
**PASS**
`app.js` lines 52-54:
```js
const _isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || ...
const _deviceMem = navigator.deviceMemory || 4;
const BLOB_CACHE_MAX = _isIOSDevice ? 10 : _deviceMem <= 2 ? 5 : _deviceMem <= 4 ? 15 : 30;
```
iOS = 10, low-mem (<=2GB) = 5. LRU eviction at lines 119-140 with active-URL protection.

### 23. SW PDF cache capped at 50 with eviction
**PASS**
`service-worker.js` lines 209-215:
```js
if (keys.length >= 50) {
  const deleteCount = keys.length - 40 + 1; // evict down to 40
  ...
}
```
Also has storage quota check at lines 193-205 (skip if >80% usage).

### 24. content-visibility: auto on song cards
**PASS (conditional)**
`app.css` lines 1041-1044:
```css
#song-list.no-animate .song-card {
  animation: none;
  content-visibility: auto;
  contain-intrinsic-size: auto 72px;
}
```
Only active when `.no-animate` class is on `#song-list` (data-refresh re-renders). Initial render with card animations does NOT have `content-visibility` (noted in comment at line 1016: "removed -- breaks cardIn animation"). This is a reasonable tradeoff.

### 25. Animations compositor-only (transform/opacity)
**PASS**
View transitions use only `opacity` and `transform` (lines 60-78, 82-93). Card entrance animation at line 998 uses `opacity` + `transform: translateY + scale`. Toast, buttons, and other UI transitions also use `transform`/`opacity`.

### 26. Large dataset virtualization or pagination
**FAIL**
`js/songs.js` has NO virtualization, NO pagination, NO lazy rendering for the song list. All songs are rendered to DOM at once. For 500+ songs, this means 500+ DOM nodes with event listeners. The `content-visibility: auto` on refresh helps with paint cost but does not reduce DOM size.

**Impact**: Medium. For current dataset sizes (~100 songs?) this is fine. For 500+ it would cause jank on low-end mobile.

---

## PWA

### 27. SHELL_ASSETS includes all JS/CSS files
**FAIL**
`service-worker.js` lines 13-48 list SHELL_ASSETS. **Missing**:
- `/js/orchestra.js` -- imported by `app.js` line 22
- `/js/instruments.js` -- imported by `app.js` line 23

These modules are loaded at runtime but will fail offline because they are not in the precache.

**Fix needed**: Add `/js/orchestra.js` and `/js/instruments.js` to the SHELL_ASSETS array.

### 28. Cache version matches APP_VERSION
**PASS**
- `js/store.js` line 65: `APP_VERSION: 'v20.24'`
- `service-worker.js` line 9: `CACHE_NAME = 'catmantrio-v20.24'`
These match.

### 29. Offline fallback
**PASS**
`service-worker.js` lines 481-494: Navigation requests use network-first with `catch(() => caches.match('/index.html'))`. Shell assets use stale-while-revalidate (line 505). Version-mismatch falls back to cache then 503 (line 521). The app loads from cache when offline.

### 30. Multi-tab localStorage race conditions
**CONCERN (no guard)**
The app uses `localStorage` for state (songs, settings, preferences) but has no `storage` event listener to detect writes from other tabs. If a user has two tabs open:
- Tab A saves songs to localStorage
- Tab B reads stale data from its in-memory copy
- Tab B saves, overwriting Tab A's changes

No `window.addEventListener('storage', ...)` found in any of the audited files. The Cloudflare sync + optimistic locking (`version` field) mitigates server-side conflicts, but local overwrites between tabs are unguarded.

**Impact**: Low-medium. PWA users rarely have multiple tabs, but it is possible on desktop.

---

## Action Items (sorted by severity)

| # | Severity | Item | File | Fix |
|---|----------|------|------|-----|
| 1 | **HIGH** | Practice cards missing tabindex/role/aria-label | `js/practice.js:493,513` | Add `tabindex="0" role="button" aria-label="..."` |
| 2 | **HIGH** | WikiChart rows missing tabindex/role/aria-label | `js/wikicharts.js:528` | Add `tabindex="0" role="button" aria-label="..."` |
| 3 | **HIGH** | Song/setlist cards have `role="button"` but no Enter/Space handler | `js/songs.js`, `js/setlists.js` | Add keydown listener for Enter/Space on cards |
| 4 | **HIGH** | SHELL_ASSETS missing orchestra.js + instruments.js | `service-worker.js:13-48` | Add `/js/orchestra.js` and `/js/instruments.js` |
| 5 | **MEDIUM** | Login error not announced to screen readers | `index.html:338` | Add `role="alert"` to `#login-error` |
| 6 | **MEDIUM** | No screen reader page-change announcements | `js/router.js` | Add visually-hidden aria-live announcer |
| 7 | **LOW** | No song list virtualization for 500+ items | `js/songs.js` | Consider virtual scrolling or pagination |
| 8 | **LOW** | No multi-tab localStorage sync | Multiple files | Add `storage` event listener for cross-tab sync |
