# Priority Roadmap — Catman Trio App
*Updated: March 20, 2026*

---

## IMMEDIATE — Quick Wins (minutes to implement, big user impact)

| # | Item | What It Actually Is | Effort | Why It Matters |
|---|------|---------------------|--------|----------------|
| 1 | **Screen Wake Lock** | A browser API (`navigator.wakeLock.request('screen')`) that prevents the phone screen from dimming/locking while you're staring at a chart. We already use it in Live Mode — but NOT in WikiCharts practice view or the PDF viewer. Any musician reading a chart for 2+ minutes sees their screen go dark. One API call to fix. | ~10 lines | Prevents screen dimming mid-practice. Baseline since 2025, all browsers. |
| 2 | **`overscroll-behavior: contain`** | A CSS property that stops "scroll chaining" — when you scroll to the end of a scrollable panel (like a song list or modal), the browser normally starts scrolling the parent page too, which can trigger pull-to-refresh or bounce the whole app. `contain` keeps scrolling trapped inside the panel. | 1 CSS line | Prevents accidental pull-to-refresh and scroll-bounce glitches. |
| 3 | **Tabular nums** | `font-variant-numeric: tabular-nums` — makes all digits the same width so numbers align in columns. Without it, "111" and "888" have different widths because 1 is narrower than 8. Affects BPM displays, timers, set timing, song counts — anywhere numbers appear in a list. | 1 CSS line | Numbers stop "jiggling" when they change. Tiny detail, noticeable polish. |
| 4 | **`@starting-style` on toasts/modals** | A CSS feature that lets you animate elements FROM `display: none` to visible. Normally CSS can't animate `display: none → block` because the browser skips the "from" state. `@starting-style` tells the browser "pretend this is the starting state before you show it." Our toasts and modals currently just pop in — this makes them smoothly fade/scale in. | ~15 min | Smooth entry animations without any JavaScript. Part of A3/A4 animation work. |
| 5 | **Bluetooth page turner keys** | Bluetooth foot pedals and page turners (used by musicians on stage) send standard keyboard events: Enter (next page), Backspace (previous page). Live Mode currently only responds to ArrowLeft/ArrowRight. Adding Enter/Backspace as aliases = instant hardware support. | ~15 lines | Stage musicians with foot pedals can use the app hands-free. |

---

## SHORT-TERM — v20.22-23 (hours of work, security + reliability)

| # | Item | What It Actually Is | Effort | Why It Matters |
|---|------|---------------------|--------|----------------|
| 6 | **Practice POST auth guard** | Our Cloudflare Worker (the server) has an endpoint for saving practice list data. Right now it doesn't check the user's role before allowing writes — meaning a guest or even an unauthenticated request could potentially write practice data. Need to add a role check: `if (!user || user.role === 'guest') return 403`. | 5 lines | Security hole. Anyone could write practice data without permission. |
| 7 | **PIN timing-safe comparison** | Gig Packets (shareable setlist links) are protected by a 4-digit PIN. The current comparison uses `===` which is vulnerable to a "timing attack" — an attacker can guess one digit at a time because wrong PINs fail faster than partially-right ones. Fix: use `crypto.timingSafeEqual()` so all comparisons take the same time regardless of how many digits match. | 10 lines | Prevents sophisticated PIN guessing attacks. Standard security practice. |
| 8 | **iOS audio blob URL workaround** | On iOS Safari, audio files served as blob URLs (our current approach for cached audio) sometimes fail silently — the audio element loads but produces no sound. iOS requires a direct URL or a specific MIME type handling. Need a platform-specific code path that uses `<audio src="direct-url">` on iOS instead of blob URLs. | ~50 lines | Audio playback is completely broken on some iOS devices. Critical for gigging musicians using iPhones/iPads. |
| 9 | **Per-song audio settings** | When you adjust playback speed or pitch on a song's audio, those settings reset when you navigate away. This saves speed/pitch per song ID to localStorage so your preferred settings persist. If you always practice "Giant Steps" at 80% speed, it remembers that. | ~50 lines | Musicians don't have to re-adjust speed/pitch every time they open a song. |
| 10 | **Practice Session Timer + Stats** | Track how long you practice each song and each session. Simple timer that starts when you enter practice mode, logs to localStorage. Shows "Total practice time: 2h 15m across 8 sessions" and per-song breakdowns. No competitor does this well. | 3-4 hrs | Helps musicians see which songs need more work. Unique differentiator. |
| 11 | **Setlist Intelligence** | Four related features: (a) Track when each song was last performed in Live Mode, (b) warn if the same song appears twice in a setlist, (c) sum song durations to show set timing ("Set 1: 47 min / 60 min target"), (d) flag jarring key transitions ("3 songs in Eb then suddenly A — reorder?"). All client-side logic, no server changes. | 4-6 hrs | Makes setlist building smarter. "Last played" and duplicate detection are table stakes for band apps. |

---

## MEDIUM-TERM — v20.24+ (significant effort, platform-defining features)

| # | Item | What It Actually Is | Effort | Why It Matters |
|---|------|---------------------|--------|----------------|
| 12 | **Piano voice leading upgrade** | Our WikiCharts piano playback currently uses a simple "closest inversion" algorithm — it picks the voicing that minimizes hand movement. Real pianists use "voice leading" rules: avoid parallel 5ths/octaves, keep the melody voice smooth, use shell voicings (root-3rd-7th only) on dominant chords. This upgrades the algorithm with a scoring system that penalizes bad voice leading and rewards jazz-idiomatic voicings. | 2-3 hrs | Makes piano playback sound like a real jazz pianist instead of a robot. You'd notice immediately as a 25-year pianist. |
| 13 | **AudioWorklet metronome** | Our metronome uses `setTimeout` + `OscillatorNode.start()` — the classic "lookahead scheduler." Problem: when the main thread is busy (DOM updates, tab switches, heavy scrolling), the metronome can stutter or drift. An **AudioWorklet** runs on the dedicated audio processing thread, which gets called every ~3ms regardless of what the main thread is doing. Rock-solid timing, immune to UI jank. | 3-4 hrs | Metronome never stutters, even during heavy page transitions or PDF rendering. Musicians rely on steady tempo. |
| 14 | **OffscreenCanvas PDF rendering** | PDF.js (our PDF renderer) does heavy CPU work to rasterize pages — this blocks the main thread, causing the UI to freeze briefly during page turns. **OffscreenCanvas** lets you transfer a `<canvas>` element to a Web Worker, where PDF rendering happens on a background thread. The result appears on screen without any main-thread cost. Zero jank during page turns. | 4-6 hrs | Eliminates the #1 source of lag in Live Mode. Page turns become instant and silky. |
| 15 | **"Prepare for Offline"** | A button that pre-downloads every PDF and audio file in a setlist to the device cache. Currently, files are cached on-demand (when you first view them). If you're heading to a gig with no WiFi and you haven't opened every chart, some will be missing. This bulk-caches everything so you're guaranteed to have all charts available offline. | 3-4 hrs | Can't miss charts on stage. Critical for gigging musicians in venues with bad WiFi. |
| 16 | **Member-to-Conductr messaging (#31)** | A simple message form on the Account page where orchestra members can send text messages to their Conductr (bandleader). Messages appear in the Conductr's inbox within the Orchestra management panel. Think of it like a band-internal suggestion box. Needs a D1 database table, Worker endpoints, and client UI. | 4-6 hrs | Band communication without leaving the app. Depends on Orchestra system being live. |
| 17 | **Guest sharing links (#32)** | Conductrs can generate time-limited read-only links (1-21 day expiry) to share setlists or songs with non-members. A sub musician gets a link, opens it, sees the charts — no login required. The link expires automatically. Token-based, like a Google Docs share link. | 3-4 hrs | The #1 organic growth vector: sub musicians discover the app through shared links. |
| 18 | **Gig Packet expansion** | Extension of #32. Instead of sharing a single resource, bundle an entire setlist: all charts, audio demos, keys, tempos, notes — one link. A sub musician gets everything they need for the gig in one click. | 6-8 hrs | "What app was that setlist on?" drives organic signups. Nobody does this beautifully. |

---

## BLUE OCEAN — Nobody Does These (competitive moats, future differentiators)

| # | Item | What It Actually Is | Effort | Why It's Interesting |
|---|------|---------------------|--------|---------------------|
| 19 | **Practice Debt (Spaced Repetition)** | Like Anki flashcard scheduling but for music practice. Each song accumulates "debt" based on: days since last practiced, difficulty rating (we just added 1-5 ratings!), proximity of next gig, historical time spent. The app generates a daily "practice queue" sorted by debt — stale/hard/urgent songs first. Heatmap visualization: green (fresh) to red (stale). **No music app does this.** iReal Pro has loop trainers, Guitar Pro has speed trainers, but nobody tracks practice longitudinally and prioritizes for you. | 6-8 hrs | Genuine blue ocean. Would be THE reason musicians choose this app over competitors. |
| 20 | **"Open Mic" QR Code** | Generate a QR code for the current gig. Audience members scan it and see: the current song title, upcoming setlist, band bio, a tip button, and a song request form. Turns the app into a **venue experience**. Every audience member who scans it discovers the app. Venue owners love interactive features. Could even show lyrics for singalong songs. | High | Organic growth: every audience member at every gig sees the app. No competitor does this. |
| 21 | **"Tempo Ghost"** | Uses the device microphone to detect the actual tempo during a live performance and compares it to the stored BPM. Shows a green/yellow/red indicator: "You're rushing by 4 BPM." After the gig, generates a tempo log: "You always rush the bridge of Come Together" or "Autumn Leaves dragged 8 BPM in the last chorus." Genuinely useful for bands that care about tight performances. | Medium | Post-gig analytics that help bands improve. Unique in the market. |
| 22 | **"Harmonic Radar"** | AI-powered chord analysis. Feed it a WikiChart's chord progression and it suggests: jazz substitutions (tritone subs, passing diminished), reharmonization options, scales for soloing over each section, and similar songs for medley transitions. Could use Claude API since we have the chord data infrastructure. Think "music theory assistant" built into the chart viewer. | High | With our piano engine + WikiCharts chord data, we have unique infrastructure for this. Nobody combines chart viewing with AI harmony analysis. |
| 23 | **"Setlist Roulette"** | After finishing a song in Live Mode, the app suggests 3 "next song" options based on: energy flow (don't put two ballads back-to-back), key compatibility, tempo range, time remaining in the set, and audience energy (if using Tempo Ghost). For bands that read the room and deviate from the planned setlist — structured spontaneity. | Medium | Helps bands that improvise their setlists on stage. Builds on setlist intelligence data. |

---

## Tech Upgrades Worth Knowing About

These are browser APIs that are now universally supported and relevant to our architecture:

| API | What It Does For Us |
|-----|---------------------|
| **Navigation API** | Could replace our entire hash router (`js/router.js`). One event handler catches ALL navigation. Returns promises. Structured state. Baseline since Jan 2026. |
| **Web Locks API** | Prevents two tabs from syncing simultaneously. "Leader election" — only one tab talks to the server. Eliminates race conditions. Baseline since 2022. |
| **Compression Streams** | Native gzip in the browser. JSON compresses 60-80%. Could compress localStorage data, sync payloads, export files. Zero dependencies. Baseline since 2023. |
| **CSS Anchor Positioning** | Position tooltips and dropdown menus relative to their trigger buttons with pure CSS. No more JavaScript positioning calculations. Baseline since Jan 2026. |
| **Popover API** | Native `popover="auto"` attribute on HTML elements. Free light-dismiss (click outside to close), automatic focus trapping, renders on top layer (no z-index wars). Could replace all our custom modal/dropdown JavaScript. Baseline since Jan 2025. |
