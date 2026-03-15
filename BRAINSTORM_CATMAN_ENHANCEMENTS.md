# Catman Trio App — Enhancement Brainstorm

## Context
Based on competitive research (BandHelper, OnSong, ForScore, Planning Center, SongBook), modern PWA UI techniques, and the priorities: **learning new material > setlist coordination > keeping in sync > finding charts fast**.

Updated with post-migration architecture (GitHub encrypted metadata + Drive for files), modern 2025-2026 web platform capabilities, and efficiency audit findings.

---

## Tier 1: High-Impact, Moderate Effort

### 1. "Learn This" Workflow (No competitor does this well)
**The killer feature.** When new material is added, band members see a clear learning queue.

- Each song gets a **status per member**: `new` → `learning` → `ready`
- A "New Material" badge/section at the top of the song list shows unlearned songs
- Bandleader marks songs as "assigned" to specific members
- Members tap "Got it" to mark as learned
- Dashboard view: "3/5 members have learned 'Solar'"
- Push notification via PWA: "2 new songs added — charts and demos attached"

**Why this wins:** Every bandleader's #1 question is "has everyone learned the new tunes?" Right now this happens via text threads. Baking it into the app is a genuine workflow improvement no competitor offers.

### 2. View Transitions API (10 lines of code, massive feel upgrade)
Wrap view-switching in `document.startViewTransition()`. Gives native-app crossfade/morph between list → detail → edit views. Falls back gracefully to instant swap.

```js
function showView(name) {
  const swap = () => { /* existing view toggle logic */ };
  if (document.startViewTransition) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}
```

Add `view-transition-name` to song card titles and detail headers for automatic morphing animation.

### 3. "Gig Packet" for Sub Musicians
One-tap share: generates a link or bundled view with the setlist + all charts + audio demos + notes for a specific gig. A substitute player opens one link and has everything.

- Export setlist as shareable URL (public read-only view, no login needed)
- Or generate a "gig packet" page with embedded PDFs and audio players
- Eliminates the "I'll email you a zip file" workflow that every band suffers from

### 4. Setlist Intelligence
- "Last played" date per song — track when songs were on setlists
- "You haven't played X in 3 months" suggestions
- Automatic set-time calculation (sum of song durations)
- Duplicate detection: warn if same song appears twice in a setlist
- Set break markers with intermission timing

### 5. Media Session API (lock screen controls)
Integrate `navigator.mediaSession` to show song title, artist, and album art on the lock screen, notification shade, and OS media controls. Users can play/pause/skip from lock screen or Bluetooth headphones. **High-impact, ~3 hours effort.**

### 6. Screen Wake Lock (keep screen on during practice/gigs)
Use `navigator.wakeLock.request('screen')` (Baseline 2025) to keep the screen on during live performance or practice. Musicians reading charts off a phone/tablet need the screen awake. Release the lock when leaving the view. **~1 hour effort.**

---

## Tier 2: Polish & Delight

### 7. Skeleton Loading States
Replace "Loading songs..." with animated skeleton cards (shimmer effect). Pure CSS:
```css
.skeleton {
  background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius);
}
```

### 8. Dark Theme Depth Refinements
- **Mesh gradient background** (subtle gold + purple radials) instead of flat dark
- **Glow effect on currently-playing song** card/player
- **Layered glass surfaces**: increase backdrop-filter blur on elevated elements (modals, bottom sheets)
- Use `color-mix(in oklch, ...)` for dynamic accent tints (Baseline 2023)

### 9. Swipe Gestures
- Swipe right on detail view → go back to list (replaces back button tap)
- Swipe left on setlist song row → quick actions (remove, move)
- Pure pointer events, no library needed

### 10. Smart Filtering Enhancements
- Filter by **multiple tags simultaneously** (AND/OR toggle)
- Sort by: title, key, date added, last played, tempo
- "Songs I haven't learned" filter (ties into learn-this workflow)
- Quick key filter: tap "A" "Bb" "C" etc. in a horizontal scroller

### 11. Audio Player Enhancements
- **Playback speed control** (0.75x, 1x, 1.25x) — critical for learning
- **A-B loop** — set loop points to practice a section
- **Mini-player bar** at bottom of screen that persists across views (like Spotify)
- Waveform visualization (canvas-based, lightweight)

### 12. PDF Annotation Overlay
- Draw on PDF charts (highlight sections, add cue marks)
- Per-member annotations (my notes vs. band notes)
- Annotations stored in GitHub encrypted storage

### 13. Auto-Scroll for Charts
Auto-scroll PDF charts at a configurable speed synced to song tempo. This is OnSong's killer feature. Musicians need hands-free chart advancement during live performance. **~1 day effort.**

### 14. Fullscreen Performance Mode
Combine fullscreen API + wake lock + simplified UI: just the current song chart, large next/prev buttons, and a minimal setlist navigator. Triggered by a "Perform" button on setlist detail. Great for tablets on music stands. **~3 hours effort.**

### 15. Song Duration & Set Timing
Store duration per song. Auto-calculate total set time in setlists as songs are added/removed/reordered. Show running totals. Bands need to hit exact time windows for gigs. **~3 hours effort.**

### 16. CSS Scroll Snap for Setlist Performance
Add `scroll-snap-type: y mandatory` to the setlist live/performance view so songs snap into view one at a time during a gig. Combined with full-height song cards, creates a "teleprompter-like" experience. **~2 hours effort.**

---

## Tier 3: Future Vision

### 17. Collaborative Setlist Builder
- Real-time: multiple members add/reorder songs simultaneously
- "Suggest" mode: members propose songs, bandleader approves
- Voting: "Which songs should we add to the set?"
- Drag-and-drop reordering with live sync

### 18. Practice Mode Enhancements
- Built-in metronome synced to song BPM (Web Audio API, sample-accurate)
- Practice timer: "I practiced Solar for 15 minutes today"
- Practice streak tracking (gamification)
- Slow-down audio playback for woodshedding
- Practice session logging: when songs were practiced, how many times, last practiced date
- "Days since last practiced" per song to identify songs needing rehearsal

### 19. Song Status & Analytics
- Per-song stats: times played live, last rehearsal date
- Band readiness dashboard: "78% of repertoire is gig-ready"
- Tempo/key distribution charts (visual overview of repertoire balance)

### 20. Chord Transposition
- If songs have key metadata, offer quick transpose view
- Nashville Number System toggle
- Capo calculator for guitarists

### 21. Offline-First File Caching
- Option to pre-cache all PDFs and audio for a setlist (before a gig with bad wifi)
- "Download setlist for offline" button
- Storage management UI showing cached vs. uncached files
- Use `navigator.storage.persist()` + `navigator.storage.estimate()` for storage awareness

### 22. Gig/Event Management
Associate setlists with dates/venues. Track upcoming gigs, past gigs, venue contacts. Even a simple gig list with date, venue, setlist link, and notes adds significant value. **~3-5 day effort.**

### 23. Song Sections / Structure Markers
Allow marking sections in audio files (intro, verse, chorus, bridge, solo) with timestamps. Display these as markers on the audio player progress bar. Helps musicians jump to specific sections during practice.

### 24. MIDI Foot Pedal Control
Web MIDI API for hands-free setlist navigation during live performance. Trigger song changes from a MIDI foot pedal. Chrome supports Web MIDI. **~3 day effort.**

---

## Modern PWA Capabilities (2025-2026)

| Feature | API | Effort | Impact |
|---------|-----|--------|--------|
| Lock screen media controls | Media Session API | ~3 hrs | Huge for audio playback UX |
| Keep screen on | Screen Wake Lock API | ~1 hr | Essential for live performance |
| Native share button | Web Share API | ~1 hr | Share setlists/songs natively |
| App icon badge (unsynced changes) | Badging API | ~1 hr | Users know to open & sync |
| Persistent storage (prevent eviction) | Storage API | ~30 min | Prevent iOS data loss |
| Custom install prompt | beforeinstallprompt | ~2 hrs | Polished install experience |
| Haptic feedback on interactions | Vibration API | ~1 hr | Native app feel (Android only) |
| Storage usage display | Storage Estimate API | ~1 hr | User transparency |

---

## Performance & Efficiency Improvements

### Critical / High Priority

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| `lucide.createIcons()` called unscoped | app.js (~15 calls), player.js (~7 calls) | Full document scan on every render, play/pause, error | Scope to container: `lucide.createIcons({ nodes: [el] })` |
| Full DOM rebuild on every search keystroke | `renderList()` app.js:467 | Destroys/recreates 50+ song cards per keystroke (80ms debounce) | Use CSS show/hide instead of innerHTML rebuild, or scope icon scan |
| O(n^2) string concat in `_toBase64` | github.js:139-143 | Quadratic for large encrypted payloads | Use chunked `String.fromCharCode.apply(null, bytes.subarray(i, i+8192))` |
| `_revokeBlobCache()` called during search | `renderList()` app.js:468 | Unnecessarily revokes blobs on list view (no players active) | Skip when already on list view |

### Medium Priority

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| `_filteredSongs()` re-sorts on every call | app.js:451-465 | O(n log n) per keystroke | Cache sorted array, invalidate on `_songs` change |
| `highlight()` recompiles regex per field per card | app.js:50-55 | ~250 `new RegExp()` per search render | Compile once per render pass |
| `_songs.find()` in render loops | setlist/practice detail renders | O(m*n) per render | Build `Map(id → song)` before loop |
| `_persistPending` on every queue write | github.js:487 | Full JSON.stringify to localStorage on every edit | Debounce separately or persist on interval + beforeunload |
| `JSON.stringify` comparison for change detection | `_syncAllFromDrive` app.js:247 | Serializes full arrays twice | Compare lengths first as short-circuit |
| `timeupdate` rebuilds gradient string ~4x/sec | player.js:74-83 | Unnecessary string rebuilding | Use CSS custom property `--pct` |
| `_ensurePublic` checks permissions on every Drive save | drive.js:295-316 | Extra API call per save | Cache "is public" status per file |
| `_allTags()` rebuilds on every render | app.js:446-449 | Full iteration + sort on every keystroke | Cache and invalidate on `_songs` change |

### Low Priority

| Issue | Location | Fix |
|-------|----------|-----|
| SW fetch handler string matching on every request | service-worker.js:117-125 | Use hostname check or Set lookup |
| `SHELL_ASSETS.some()` on every GET response | service-worker.js:133 | Precompute `Set` for O(1) lookup |
| SW message handler uses if-chain (no short-circuit) | service-worker.js:48-112 | Use `if/else if` or dispatch map |
| `JSON.stringify(data, null, 2)` pretty-prints Drive uploads | drive.js:321 | Use compact `JSON.stringify(data)` |

---

## Visual / UI Quick Wins

| Change | Effort | Impact |
|--------|--------|--------|
| View Transitions API on all view switches | ~30 min | Feels like a native app |
| `@starting-style` on toasts and modals | ~15 min | Smooth entry animations |
| Mesh gradient body background | ~5 min | Richer, more alive feel |
| Skeleton loading cards | ~20 min | Professional loading state |
| Bump body font-weight to 500 | ~2 min | Better dark-mode readability |
| Body text color to #d4d4d4 (off-white) | ~2 min | Reduces glare |
| `-webkit-tap-highlight-color: transparent` | ~1 min | Removes web-page feel on mobile |
| `user-select: none` on buttons/chrome | ~5 min | Prevents accidental text selection |
| Glow shadow on active audio player | ~5 min | Visual "now playing" indicator |
| Tabular nums on all timing/numbering | ~2 min | Aligned numbers in lists |
| `overscroll-behavior: contain` on scrollable panels | ~5 min | Prevent scroll chaining / accidental pull-to-refresh |
| `content-visibility: auto` on song cards | ~10 min | Skip rendering off-screen cards |
| CSS containment on major sections | ~10 min | Limit scope of browser reflows |
| `@media (prefers-reduced-motion)` | ~15 min | Accessibility compliance |
| Native `<dialog>` for modals | ~3 hrs | Built-in focus trapping, ESC, backdrop |
| Popover API for dropdowns/tooltips | ~2 hrs | Native dismiss, focus management |

---

## Accessibility Gaps

| Issue | Effort | Priority |
|-------|--------|----------|
| Audio player missing keyboard controls (spacebar, arrows) | ~2 hrs | High |
| Volume slider missing `aria-label` | ~5 min | High |
| Progress bar needs `role="slider"` + `aria-valuetext` | ~2 hrs | High |
| Focus not managed on view transitions | ~2 hrs | High |
| No skip-to-content link | ~30 min | Medium |
| Tag chip remove button unclear to screen readers | ~30 min | Medium |
| PDF viewer lacks keyboard navigation | ~1 hr | Medium |
| Drag-drop reorder not keyboard accessible | ~1 day | Medium |
| Color contrast audit (gold on dark) | ~2 hrs | Medium |
| Reduced motion support (`prefers-reduced-motion`) | ~1 hr | Medium |

---

## Competitor Gaps This App Can Own

1. **Web-first PWA** — No app store, works on any device. BandHelper/OnSong are native-only.
2. **Learning workflow** — No competitor tracks "who has learned what."
3. **Sub musician sharing** — No competitor makes it easy to share a gig packet with a fill-in.
4. **Song + PDF + Audio unified** — Most competitors are strong in 1-2, not all 3.
5. **Free for members** — Only admin/bandleader needs to manage; everyone else just uses it.
6. **Beautiful, modern UI** — BandHelper looks dated. OnSong is iPad-only. This app already looks better.
7. **Zero bloat** — BandHelper tries to do gig finances, MIDI, contacts. This stays focused.
8. **Encrypted sync** — No competitor offers client-side encrypted storage. Privacy-first.
9. **Cross-platform write** — Mobile devices can edit data (via GitHub). BandHelper restricts mobile to read-only for many features.

---

## Recommended Implementation Order

### Phase 1: Foundation (do now)
1. Performance fixes — scoped `lucide.createIcons()`, `_toBase64` chunking, cached sorted songs
2. View Transitions API (instant feel upgrade)
3. Media Session API (lock screen controls)
4. Screen Wake Lock (keep screen on)
5. `navigator.storage.persist()` (prevent iOS data eviction)
6. Visual quick wins (skeleton loading, mesh gradient, typography tuning)

### Phase 2: Core Features
7. Audio player enhancements (speed control, A-B loop)
8. "Learn This" workflow (the differentiator)
9. Song duration + set timing
10. Fullscreen performance mode + auto-scroll
11. Accessibility audit + fixes

### Phase 3: Expansion
12. Gig packet sharing
13. Setlist intelligence (last played, timing, suggestions)
14. Practice mode enhancements (metronome, session logging)
15. Swipe gestures
16. Offline file caching

### Phase 4: Future
17. Collaborative setlist builder
18. Gig/event management
19. Chord transposition
20. PDF annotations
21. MIDI foot pedal control
