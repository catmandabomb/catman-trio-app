# Barrel Round 1 — Android & Desktop Device Compatibility Audit

**Date:** 2026-03-20
**Auditor:** Claude Opus 4.6
**Scope:** Post-fix verification of all device compatibility fixes across 12 source files.

---

## ANDROID CHECKLIST

### 1. Samsung Internet — Chrome-only behavior assumptions
**RESULT: ADVISORY (no explicit handling)**

- `detectPlatform()` in `js/utils.js:206-218` does not return a Samsung-specific value. Samsung Internet on Android would match the generic `android` path (line 214: `/Android/i.test(ua)`).
- The install gate (`app.js:1794-1813`) shows Chrome-specific instructions ("top right of Chrome") for the `android` platform. Samsung Internet users would see these Chrome-specific instructions.
- `beforeinstallprompt` works on Samsung Internet (Chromium-based), so the install banner should fire correctly.
- No Samsung-specific breakages found in core code paths — Samsung Internet's Chromium engine handles all used APIs.

**Risk:** Low. Samsung Internet users get Chrome-branded install instructions but the flow still works.

---

### 2. Firefox Android install hint — install gate code path
**RESULT: PASS** — `app.js:1752-1772`

- `detectPlatform()` returns `'android-firefox'` at `js/utils.js:213`.
- The install gate handles `android-firefox` explicitly at `app.js:1752-1772`.
- Instructions correctly say: "Tap the **menu** button (vertical ellipsis) in the top right", then "Tap **Install**", then "Tap **Add** to confirm".
- Includes note: "Using Firefox? The install option is in Firefox's main menu -- not a popup."
- This correctly addresses the known issue that Firefox Android does not fire `beforeinstallprompt`.

---

### 3. WebView escape hatch — detection + "Open in Browser" button
**RESULT: PASS** — `js/utils.js:209`, `app.js:1737-1889`

- **Detection:** `detectPlatform()` at `js/utils.js:209` checks `/FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|MicroMessenger/i` and returns `'webview'`.
- **Install gate:** `app.js:1737-1751` renders an "Open in Browser" button + URL copy fallback.
- **Button wiring:** `app.js:1856-1888` uses `intent://` scheme for Android, falls back to `window.open(_system)` then `window.open(_blank)`. Copy button uses `navigator.clipboard` with `document.execCommand('copy')` fallback.
- Fully functional escape hatch for WebView users.

---

### 4. Low-memory adaptation — `navigator.deviceMemory` usage
**RESULT: PASS** — `app.js:53-54`, `pdf-viewer.js:46-47`

- **app.js:53:** `const _deviceMem = navigator.deviceMemory || 4;` — fallback to 4GB.
- **app.js:54:** `BLOB_CACHE_MAX` adapts: iOS=10, <=2GB=5, <=4GB=15, else=30.
- **pdf-viewer.js:46:** `const _deviceMemGB = navigator.deviceMemory || (_isMobileDevice ? 2 : 8);` — conservative mobile fallback (2GB).
- **pdf-viewer.js:47:** `MAX_RENDER_CACHE` adapts: <=2GB=8, <=4GB=15, else=20.
- **js/setlists.js:2537-2538:** `const mem = navigator.deviceMemory || 4;` — used to limit pre-renders on low-memory devices.
- All three locations have proper fallbacks for browsers that don't expose `deviceMemory`.

---

### 5. Foldable viewport handling — `visualViewport` resize listener
**RESULT: PASS** — `pdf-viewer.js:1221-1234`

- Comment explicitly mentions "Stage Manager / foldable viewport resize".
- Checks `window.visualViewport` exists before attaching listener.
- Tracks `_lastVVWidth` and only re-renders when width changes by >50px (avoids keyboard resize thrash).
- Clears render cache and re-renders current page on significant resize.

---

### 6. Audio autoplay — user gesture requirement
**RESULT: PASS** — `player.js:521-561`, `player.js:307`

- **Primary play:** `player.js:521` — `playBtn.addEventListener('click', ...)` triggers `audio.play()` inside a click handler. This is a user gesture.
- **Play promise handling:** `player.js:534-545` — properly handles the play() promise rejection (Android fires spurious pause during play negotiation).
- **Loop replay:** `player.js:307` — `audio.play().catch(...)` is called from the `ended` event handler. This is NOT preceded by a user gesture, but it is a continuation of already-playing audio (A/B loop re-seek at end of track). Browsers generally allow this since the audio context is already unlocked.
- **No rogue autoplay calls found** — all initial plays are user-initiated.

---

### 7. Chrome Custom Tabs — install gate awareness
**RESULT: MISSING**

- No detection of Chrome Custom Tabs (CCT) anywhere in the codebase.
- Chrome Custom Tabs report `display-mode: browser` (not `standalone`) and the UA looks like normal Chrome. `isPWAInstalled()` in `js/utils.js:191-200` would return `false`, triggering the install gate.
- CCT users would see the install gate even though they may have intentionally opened a link from another app. However, the install gate's instructions for `android` are valid in CCT (user can install from there).
- **Risk:** Low-medium. CCT users hit the install gate unnecessarily, but the experience is still functional.

---

### 8. `beforeinstallprompt` — does NOT assume it fires on all browsers
**RESULT: PASS** — `app.js:2129-2137`, `app.js:2153-2158`

- The `beforeinstallprompt` listener at `app.js:2129` is registered as a passive event listener — it only fires on Chromium browsers.
- The install gate at `app.js:2153-2158` does NOT depend on `beforeinstallprompt`. It checks `_isMobile() || _isMacSafari` and `!_isPWAInstalled()`, then shows platform-specific instructions.
- iOS hint at `app.js:2659-2661` explicitly checks `_isIOS() && !_isPWAInstalled() && !_deferredInstallPrompt` — handles the case where `beforeinstallprompt` never fires.
- Firefox Android gets its own install instructions without relying on the prompt event.

---

### 9. `detectPlatform()` — return value verification
**RESULT: PARTIAL PASS** — `js/utils.js:206-218`

| Platform | Expected | Actual Return | Status |
|---|---|---|---|
| android (Chrome) | `android` | `android` (line 214) | PASS |
| android-firefox | `android-firefox` | `android-firefox` (line 213) | PASS |
| webview (FB/IG) | `webview` | `webview` (line 209) | PASS |
| ios | `ios` | `ios` (line 211) | PASS |
| ipados | `ipad` | `ipad` (line 210) | PASS (returns `ipad` not `ipados`) |
| macos-safari | `macos-safari` | `macos-safari` (line 217) | PASS |
| desktop | `desktop` | `desktop` (line 218) | PASS |

**Note:** The JSDoc at line 204 says the return type includes `'ipad'` not `'ipados'`. The question asked for `ipados` but the function returns `ipad`. This is consistent with how the function is used everywhere in the codebase.

---

## DESKTOP CHECKLIST

### 10. Dark Reader meta tag
**RESULT: PASS** — `index.html:10`

```html
<meta name="darkreader-lock">
```

Present and correctly placed in `<head>`. Prevents Dark Reader from interfering with the app's dark theme.

---

### 11. `color-scheme` meta
**RESULT: PASS** — `index.html:11`

```html
<meta name="color-scheme" content="dark">
```

Present. Tells the browser the page uses a dark color scheme (affects form controls, scrollbars, etc.).

---

### 12. Brave Shields fetch handling — TypeError catch
**RESULT: PASS** — `js/sync.js:44-65`

- Line 44: `let _braveShieldsToastShown = false;` — one-per-session guard.
- Line 58-65: `catch (err)` block catches `TypeError` from `fetch()` (which means request was blocked).
- Checks `err instanceof TypeError` and shows a helpful toast once: "Network request blocked -- if using Brave, try disabling Shields for this site." with an 8-second duration.
- Correctly avoids spamming the toast on every blocked request.

---

### 13. Grammarly block attributes
**RESULT: PARTIAL PASS** — `index.html`

Present on these inputs:
- `#search-input` (line 162) — PASS
- `#login-password` (line 320) — PASS
- `#login-confirm-password` (line 324) — PASS
- `#github-pat` (line 442) — PASS

**MISSING on these inputs:**
- `#login-username` (line 316) — no Grammarly attributes. Less critical (usernames, not prose), but Grammarly can still add a floating icon.
- `#login-email` (line 328) — no Grammarly attributes.
- `#login-confirm-email` (line 332) — no Grammarly attributes.
- `#drive-api-key` (line 418) — no Grammarly attributes.
- `#drive-client-id` (line 424) — no Grammarly attributes.
- `#drive-folder-id` (line 426) — no Grammarly attributes.
- `#github-owner` (line 446) — no Grammarly attributes.
- `#github-repo` (line 449) — no Grammarly attributes.

**Risk:** Low. Grammarly mainly annoys on text/password fields where prose is typed. API keys, email, and username fields are less affected. But for consistency, all inputs should have the attributes.

---

### 14. Edge Sleeping Tabs — visibilitychange listener for sync
**RESULT: PASS** — `app.js:2671-2683`

- Comment explicitly mentions "Edge Sleeping Tabs / background tab sync-on-wake".
- Listens for `visibilitychange` event, checks `document.visibilityState === 'visible'`.
- Checks `Auth.isLoggedIn()` before syncing.
- Has 10-second debounce (`now - _lastVisibilitySync < 10000`).
- Calls `_syncAllFromDrive()` to trigger a full re-sync when tab wakes up.

---

### 15. `defer` on blocking scripts
**RESULT: PASS** — `index.html:91-92`

```html
<script src="lib/pdf.min.js" defer></script>
<script src="lib/Sortable.min.js" defer></script>
```

Both third-party library scripts have `defer`. The main `app.js` is loaded as `type="module"` (line 465), which is implicitly deferred.

---

### 16. Touch targets 44px — `@media (any-pointer: coarse)` rule
**RESULT: PASS** — `app.css:466-483`

- Line 466-474: `@media (pointer: coarse)` adds invisible 44x44 pseudo-element hit area on `.icon-btn`.
- Line 478-483: `@media (any-pointer: coarse)` enforces explicit `min-width: 44px; min-height: 44px` on `.icon-btn`, `.tag-filter-chip`, `.tag-chip`.
- Additional 44px enforcement found at lines 1144, 2126, 2453, 2888-2890, 4725-4739, 4878, 4935, 5455 for various interactive elements.

---

### 17. Keyboard shortcuts — conflicts with browser defaults
**RESULT: PASS (no conflicts)** — `app.js:2797-2852`, `player.js:672-703`

Shortcuts defined:
| Key | Action | Conflicts? |
|---|---|---|
| `?` | Show help overlay | No (only outside inputs, skipped during PDF/live mode) |
| `Esc` | Go back / close help | No (standard dismiss behavior) |
| `Space` | Play/pause audio | Guarded: only when `_active` audio exists, skips inputs. Browser default (scroll) is prevented. |
| `ArrowLeft/Right` | Seek audio / PDF nav | Guarded: only when `_active` audio exists or PDF is open. |
| `ArrowUp/Down` | Volume | Guarded: only when `_active` audio exists. |
| `+/-/0` | PDF zoom | Only in PDF viewer context (pdf-viewer.js). |
| `PgUp/PgDn` | PDF/Live mode page turn | Standard page turner behavior. |

All keyboard handlers check for `INPUT`/`TEXTAREA`/`isContentEditable` targets before acting. No conflicts with Ctrl+key browser shortcuts. Space is properly `preventDefault`ed to avoid scroll-on-space.

---

### 18. Firefox scrollbar styles
**RESULT: PASS** — `app.css:3758-3761`

```css
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-light) transparent;
}
```

Firefox-standard `scrollbar-width` and `scrollbar-color` properties applied globally. Chromium/WebKit scrollbar styling also present at lines 3764-3766.

Additionally, `scrollbar-width: none` used at lines 888 and 943 for hidden-scrollbar containers.

---

### 19. Firefox slider styles
**RESULT: PASS** — `app.css:382-395`, `app.css:1731-1750`

**Volume slider:**
- `::-moz-range-thumb` at line 382 — 14px circle, accent color, shadow.
- `::-moz-range-track` at line 390 — 4px height, rounded.

**Audio progress slider:**
- `::-moz-range-track` at line 1731 — gradient fill showing progress.
- `::-moz-range-track` (loop-active variant) at line 1736 — A/B loop overlay.
- `::-moz-range-thumb` at line 1743 — 12px circle, accent color.

Both sliders have full Firefox (Gecko) styling parity with the WebKit versions.

---

## SUMMARY

| # | Check | Status | File:Line |
|---|---|---|---|
| 1 | Samsung Internet | ADVISORY | `js/utils.js:214`, `app.js:1794` |
| 2 | Firefox Android install hint | PASS | `app.js:1752-1772` |
| 3 | WebView escape hatch | PASS | `js/utils.js:209`, `app.js:1737-1889` |
| 4 | Low-memory adaptation | PASS | `app.js:53-54`, `pdf-viewer.js:46-47`, `js/setlists.js:2537-2538` |
| 5 | Foldable viewport | PASS | `pdf-viewer.js:1221-1234` |
| 6 | Audio autoplay | PASS | `player.js:521, 534, 307` |
| 7 | Chrome Custom Tabs | MISSING | No CCT detection anywhere |
| 8 | beforeinstallprompt | PASS | `app.js:2129-2137, 2153-2158` |
| 9 | detectPlatform() | PASS | `js/utils.js:206-218` (returns `ipad` not `ipados`) |
| 10 | Dark Reader meta | PASS | `index.html:10` |
| 11 | color-scheme meta | PASS | `index.html:11` |
| 12 | Brave Shields catch | PASS | `js/sync.js:44-65` |
| 13 | Grammarly block | PARTIAL | `index.html:162,320,324,442` (8 inputs missing attrs) |
| 14 | Edge Sleeping Tabs | PASS | `app.js:2671-2683` |
| 15 | defer on scripts | PASS | `index.html:91-92` |
| 16 | Touch targets 44px | PASS | `app.css:466-483` + many others |
| 17 | Keyboard shortcuts | PASS | `app.js:2797-2852`, `player.js:672-703` |
| 18 | Firefox scrollbar | PASS | `app.css:3758-3761` |
| 19 | Firefox slider | PASS | `app.css:382-395, 1731-1750` |

**Score: 16/19 PASS, 1 PARTIAL, 1 ADVISORY, 1 MISSING**

### Action Items (if desired)

1. **[LOW] Grammarly attrs on remaining inputs** — Add `data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"` to 8 inputs in `index.html` (lines 316, 328, 332, 418, 424, 426, 446, 449).
2. **[LOW] Samsung Internet install instructions** — Could add Samsung-specific wording ("menu button in your browser") instead of Chrome-specific "top right of Chrome".
3. **[LOW] Chrome Custom Tabs detection** — Could detect CCT via `document.referrer` containing `android-app://` or checking for specific UA features, and skip the install gate. Current behavior (showing install gate) is functional but mildly annoying for CCT users.
