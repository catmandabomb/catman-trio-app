# Cutting-Edge Tech — Prioritized Implementation Map

Generated: 2026-03-20 | Based on: `research/CUTTING_EDGE_TECH_RESEARCH.txt`, `research/INDUSTRY_STANDARD_TECH_NOTES.txt`

---

## Already Implemented

These items from the research are **already live** in the Catman Trio codebase.

| Feature | Where | Notes |
|---|---|---|
| View Transitions API (SPA) | `js/router.js`, `js/setlists.js`, `app.css` | `startViewTransition()` integrated into router with `skipViewTransition` pattern (v20.18) |
| Screen Wake Lock | `js/utils.js`, `js/setlists.js` | Active during Live Mode (v17.83) |
| OffscreenCanvas + Web Worker PDF | `pdf-viewer.js`, `workers/pdf-render-worker.js` | Background rendering via transferred canvas, progressive 1x/2x resolution |
| AudioWorklet Metronome | `metronome.js`, `workers/metronome-processor.js` | Sample-accurate beat generation in audio thread |
| Web Locks API | `github.js` | `navigator.locks.request('catmantrio-write')` for exclusive write coordination |
| Popover API | `js/modal.js` | `popover="manual"` on modal overlays, top-layer rendering |
| Persistent Storage | `app.js`, `js/dashboard.js` | `navigator.storage.persist()` called at init, health check verifies |
| content-visibility: auto | `app.css` | Applied to song cards with `contain-intrinsic-size` |
| Pre-render + LRU Cache | `pdf-viewer.js` | Adjacent page pre-rendering with eviction |
| Loading Skeletons | `app.css` | `skeleton-card`, `audio-skeleton`, shimmer animation |

---

## Ready to Build Now

High browser support, high impact, not yet in the codebase. **These are the priority targets.**

| Feature | Browser Support | Difficulty | Impact | Notes |
|---|---|---|---|---|
| **Navigation API** | Baseline Jan 2026 (Chrome 102+, Firefox 133+, Safari 18.2+) | **Medium** | **Critical** | Replaces the entire manual `router.js` hashchange + navStack system with a single `navigate` event handler. Returns `{committed, finished}` promises. Full history stack via `navigation.entries()`. Eliminates the class of navStack bugs fixed in v20.20. |
| **@starting-style + transition-behavior** | Baseline Aug 2024 — all browsers | **Easy** | **High** | Animate modals/toasts from `display:none` without JS rAF hacks. Drop-in CSS upgrade to existing modal and toast transitions. Works with the Popover API already in `modal.js`. |
| **CSS Anchor Positioning** | Baseline Jan 2026 (Chrome 125+, Firefox 133+, Safari 18.2+) | **Easy** | **Medium** | Replace JS-based tooltip/dropdown positioning with pure CSS `anchor()`. Useful for action menus, tag dropdowns, tuning fork popups. |
| **Compression Streams API** | Baseline May 2023 — all browsers | **Easy** | **Medium** | Native gzip compress/decompress. Could compress localStorage/IDB cached data (60-80% size reduction). Useful if offline data footprint grows. |
| **Linearized PDFs** | N/A (pre-processing) | **Easy** | **High** | Run `qpdf --linearize` on all PDFs in R2 storage. First page renders instantly while rest streams. Zero code changes — pure infrastructure win. |
| **Opus Audio Format** | Universal (Safari 17+) | **Easy** | **Medium** | Accept/convert audio to Opus (96-128kbps matches MP3 320kbps at 1/3 size). Faster downloads, less storage. Add to accepted upload formats. |
| **OPFS Write Buffer** | Baseline Mar 2023 — all browsers | **Medium** | **High** | Origin Private File System for crash-resilient write buffer. Survives tab crash better than localStorage. Sync access in workers is much faster than IDB. |
| **Rehearsal Mode Overlay** | N/A (app feature) | **Medium** | **High** | Top 10 Suggestion #3: translucent notes overlay in Live Mode for rehearsal. One-tap toggle between clean performance view and notes-visible rehearsal view. |
| **Practice Session Timer + Stats** | N/A (app feature) | **Medium** | **High** | Top 10 Suggestion #8: track time-per-song, cumulative stats. "Total practice: 2h 15m across 8 sessions." Drives engagement. |
| **Stage Red Theme** | N/A (app feature) | **Easy** | **Medium** | Top 10 Suggestion #7: deep red tint for Live Mode preserving night vision on dark stages. CSS custom property swap. |

---

## Worth Watching

Browser support is improving but has gaps. Build as progressive enhancement or wait.

| Feature | Browser Support | Difficulty | Impact | Notes |
|---|---|---|---|---|
| **CSS Scroll-Driven Animations** | Chrome 115+, Firefox 137+, Safari: shipping soon (behind flag in TP) | **Easy** | **Medium** | Reveal-on-scroll, parallax, scroll progress indicators — all pure CSS. Wait for Safari stable. Progressive enhancement possible now. |
| **scheduler.postTask()** | Chrome 94+ only | **Easy** | **Medium** | Priority-based task scheduling. Could prioritize visible PDF page rendering over pre-render. Chrome-only but graceful fallback. |
| **setSinkId() Audio Routing** | Chrome 110+, Edge. No Firefox/Safari | **Easy** | **Medium** | Route metronome to specific output (e.g., headphones only while band hears backing track). Chrome-only kills it for iOS but great progressive enhancement. |
| **Background Sync (one-off)** | Chrome/Edge only | **Easy** | **High** | Sync write queue when connectivity returns. Perfect for the D1 sync pattern. No Safari = no iOS. |
| **SW Static Routing API** | Chrome 123+ only | **Easy** | **Medium** | Bypass SW boot latency for cache-first assets. ~50-200ms savings on cold navigation. Graceful fallback. |
| **File Handling API** | Chromium only | **Easy** | **Medium** | Open PDFs/MP3s directly into the app from file manager on desktop. Manifest-level declaration. |
| **Badging API** | Chrome/Edge, partial Firefox | **Easy** | **Low** | App icon badge with unread count. Limited cross-browser. |
| **WebCodecs AudioDecoder** | Chrome 94+, Safari 16.4+ partial. No Firefox | **Medium** | **Medium** | Streaming audio decode without loading entire file. Firefox gap blocks it as primary path. |
| **Yjs CRDTs** | Library (no browser API needed) | **Hard** | **Critical** | Conflict-free offline sync. Two users editing same practice list merge cleanly. Replaces manual field-level merge. ~15KB. Massive architectural win but large refactor. |
| **X25519 Key Exchange** | Chrome 113, Firefox 130, Safari 17 | **Medium** | **High** | Modern E2E encrypted key exchange between devices. Foundation for per-user encryption without server holding keys. |

---

## Parked

Too bleeding-edge, too much effort for the payoff, or blocked by platform constraints.

| Feature | Browser Support | Difficulty | Impact | Notes |
|---|---|---|---|---|
| WebGPU PDF Rendering | Chrome 113+, Firefox Nightly only, No Safari/iOS | **Very Hard** | **Very High** | No production WebGPU PDF renderer exists. No iOS support. Revisit 2027+. |
| PDFium WASM | All browsers | **Hard** | **High** | Replace PDF.js with Chrome's native engine. ~10MB binary, no built-in UI/text layer. Current OffscreenCanvas + PDF.js is already performant. Overkill unless fidelity issues surface. |
| WASM Threads | Requires COOP/COEP headers | **Hard** | **High** | Multi-threaded PDFium. COOP/COEP headers break Google Fonts. Not worth the tradeoff. |
| OPFS + SQLite-WASM | All browsers (OPFS baseline) | **Hard** | **High** | Full SQL offline. Powerful but D1 backend already handles structured queries server-side. Only relevant if offline-first becomes a priority. |
| TC39 Signals | Not in browsers yet | N/A | **High** | Native reactive state. Stage 1. No polyfill worth adopting. Watch. |
| Temporal API | Not in browsers yet | N/A | **Low** | Replaces Date. Polyfillable but not urgent — the app barely uses dates. |
| Web MIDI | Chrome/Edge only, No Firefox/Safari | **Medium** | **Low** | MIDI foot pedals, program changes. No Safari = no iPad. Keyboard page turners already work via standard key events. |
| SharedArrayBuffer | Requires COOP/COEP | **Medium** | **Medium** | Lock-free audio thread communication. Headers break Google Fonts/Drive. Hard no. |
| MuPDF WASM | All browsers | **Medium** | **High** | AGPL license. Toxic for this project. |
| Import Maps | Baseline | **Easy** | **Low** | Native module resolution. The app uses `<script type="module">` already. Marginal benefit without a bundler migration. |

---

## Top 5 Next Moves (Recommended Order)

1. **Navigation API** — Architectural upgrade that eliminates an entire class of routing/navStack bugs. The router is a recurring pain point (v20.18, v20.19, v20.20 all touched it). One `navigate` event handler replaces the whole system.

2. **@starting-style + CSS Anchor Positioning** — Two CSS-only upgrades that immediately polish modals, toasts, dropdowns, and tooltips. Zero JS changes. Pure visual refinement.

3. **Linearized PDFs** — Run `qpdf --linearize` on R2 storage PDFs. Instant first-page render. Zero code changes, pure infrastructure.

4. **OPFS Write Buffer** — Replace localStorage crash-recovery buffer with OPFS. More reliable, no size limits, sync access in workers.

5. **Rehearsal Mode + Practice Stats** — Feature-level wins from the Top 10 list that directly serve the band's daily workflow.
