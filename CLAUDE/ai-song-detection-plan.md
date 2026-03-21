# AI Song Detection — Detailed Feature Plan

## Vision

When a user types a song title anywhere in the app — new song form (+), WikiChart quicktext, or song edit — the app silently searches for matching songs in the background and offers to auto-populate metadata: **key, BPM, duration, time signature, artist/subtitle, genre tags**.

Think: Google search autocomplete meets Shazam metadata. Type "Brown Eyed Girl" → instant suggestion card: `G major | 147 BPM | 3:03 | 4/4 | Van Morrison | Rock`.

One-tap accept fills all fields. Zero friction.

---

## UX Flow

### Trigger Points (3 entry points)

| Entry Point | Where | Who |
|---|---|---|
| **New Song (+)** | Song edit form → title field | Conductr, Admin, Owner |
| **Edit Song** | Song edit form → title field | Conductr, Admin, Owner |
| **WikiChart Quicktext** | WikiChart add modal → title field | Conductr, Admin, Owner |

### User Journey

```
1. User starts typing song title
2. After 600ms pause (debounce), app queries metadata API
3. Subtle loading indicator appears below title field (pulsing dot or "Searching...")
4. Results arrive → suggestion card slides in below the title field:
   ┌─────────────────────────────────────────────────┐
   │  Brown Eyed Girl — Van Morrison                 │
   │  G major · 147 BPM · 3:03 · 4/4                │
   │  [Apply All]  [Pick & Choose]  [Dismiss ×]      │
   ╘═════════════════════════════════════════════════╛
5a. [Apply All] → fills key, BPM, duration, time sig, subtitle
5b. [Pick & Choose] → expandable checklist of individual fields
5c. [Dismiss] or tap outside → card disappears, no changes
6. If multiple matches → horizontal scroll of suggestion cards
7. If no match → card says "No match found" (auto-dismisses after 2s)
```

### Edge Cases

| Scenario | Behavior |
|---|---|
| Title < 3 chars | No search triggered |
| Title matches multiple songs | Show top 3 matches as swipeable cards |
| Title matches but fields empty | Show partial card (only available fields) |
| Offline | No search, no indicator, graceful no-op |
| API error/timeout | Silent failure, no UI disturbance |
| User already filled fields | Suggestion card shows diff ("BPM: 120 → 147") |
| User clears title | Dismiss any active suggestion |
| Rapid typing | Cancel previous in-flight request (AbortController) |

---

## Data Architecture

### What We Want Per Song

| Field | Source Priority | Notes |
|---|---|---|
| **Key** | Spotify audio features > MusicBrainz > Last.fm | Musical key (C, Am, F#m, etc.) |
| **BPM** | Spotify audio features > AcousticBrainz | Tempo as integer |
| **Duration** | Spotify/MusicBrainz/iTunes | In seconds |
| **Time Signature** | Spotify audio features | Usually 4/4, sometimes 3/4, 6/8 |
| **Artist** | MusicBrainz > Spotify > iTunes | For subtitle field |
| **Genre/Tags** | Last.fm top tags > Spotify | Map to existing tag system |
| **Year** | MusicBrainz > Spotify | For metadata display |

### API Strategy: Cascading Multi-Source

No single API has everything. Strategy: **primary + enrichment**.

```
Title typed
  → Primary search: MusicBrainz (free, no auth, good fuzzy match)
  → Get: artist, duration, year, recording ID
  → Enrichment: Spotify Audio Features (key, BPM, time sig, energy)
  → Enrichment: Last.fm (genre tags)
  → Merge results → present to user
```

**Why this order:**
1. MusicBrainz is free, no API key, excellent fuzzy search, CORS-friendly
2. Spotify has the ONLY reliable key/BPM data but needs auth
3. Last.fm has excellent genre tagging

### Fallback Chain

```
MusicBrainz → Spotify → iTunes Search → Last.fm → "No match"
```

If MusicBrainz is down, try iTunes Search API (no auth, good coverage).
If Spotify auth fails, skip BPM/key enrichment and show what we have.

---

## API Integration Details

### MusicBrainz (Primary — Free, No Auth)

- **Endpoint**: `https://musicbrainz.org/ws/2/recording?query={title}&fmt=json&limit=5`
- **Auth**: None (but MUST send custom User-Agent header)
- **CORS**: Yes (browser-callable)
- **Rate limit**: 1 req/sec (free), 10 req/sec with auth
- **Fields**: title, artist, duration, release date, ISRC, Spotify ID link
- **Fuzzy search**: Excellent Lucene-based query parser
- **Reliability**: Very stable, community-maintained

**Example query**: `recording?query=brown%20eyed%20girl&fmt=json&limit=3`

### Spotify Web API (Enrichment — Key/BPM)

- **Endpoint**: `https://api.spotify.com/v1/search?q={title}+artist:{artist}&type=track&limit=1`
- **Audio features**: `https://api.spotify.com/v1/audio-features/{trackId}`
- **Auth**: Client Credentials flow (app-level, no user login needed)
- **CORS**: No — needs proxy (Cloudflare Worker)
- **Rate limit**: ~180 req/min
- **Fields**: key (pitch class 0-11), mode (major/minor), tempo, time_signature, duration_ms, energy, danceability
- **Key mapping**: `{0:'C', 1:'C#', 2:'D', 3:'Eb', 4:'E', 5:'F', 6:'F#', 7:'G', 8:'Ab', 9:'A', 10:'Bb', 11:'B'}`

**Proxy needed**: Add `/api/spotify-search` and `/api/spotify-features` routes to Cloudflare Worker.

### iTunes Search API (Fallback — Free, No Auth)

- **Endpoint**: `https://itunes.apple.com/search?term={title}&media=music&limit=5`
- **Auth**: None
- **CORS**: Yes (JSONP also available)
- **Rate limit**: ~20 req/min (undocumented)
- **Fields**: artistName, trackTimeMillis, primaryGenreName, releaseDate
- **Missing**: No key, no BPM, no time signature
- **Reliability**: Very stable (Apple infrastructure)

### Last.fm (Enrichment — Genre Tags)

- **Endpoint**: `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&track={title}&artist={artist}&api_key={key}&format=json`
- **Auth**: API key (free, instant registration)
- **CORS**: Yes
- **Rate limit**: 5 req/sec
- **Fields**: top tags (genre), play count, listeners, album
- **Reliability**: Stable

---

## Cloudflare Worker Additions

### New Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/song-lookup` | GET | Unified search — queries MusicBrainz + caches |
| `/api/song-enrich` | GET | Spotify audio features via Worker proxy |

### `/api/song-lookup` Logic

```
1. Receive ?title=Brown+Eyed+Girl
2. Check KV cache: `song_meta:{normalized_title}` → if hit, return cached
3. Query MusicBrainz: /ws/2/recording?query={title}&fmt=json&limit=5
4. Parse top results: extract title, artist, duration, MusicBrainz ID
5. For top result: query Spotify (server-side, using client credentials)
   → Get key, BPM, time signature, energy
6. Merge all data into response
7. Cache in KV with 30-day TTL
8. Return merged result
```

### Response Shape

```json
{
  "matches": [
    {
      "title": "Brown Eyed Girl",
      "artist": "Van Morrison",
      "key": "G",
      "bpm": 147,
      "duration": 183,
      "timeSig": "4/4",
      "genre": ["Rock", "Classic Rock"],
      "year": 1967,
      "confidence": 0.95,
      "source": "musicbrainz+spotify"
    }
  ],
  "cached": false
}
```

### KV Caching Strategy

- **Key**: `song_meta:{sha256(lowercase(title))}` — normalized for fuzzy dedup
- **TTL**: 30 days (song metadata doesn't change)
- **Size**: ~500 bytes per entry
- **Quota impact**: Minimal — one KV read per unique title, one write on miss
- **Benefits**: Instant response for repeated lookups, reduces upstream API calls

---

## Client Implementation

### New Module: `js/song-lookup.js` (~150 lines)

```javascript
// Public API
export async function lookupSong(title, options = {}) → Promise<SongMatch[]>
export function cancelLookup() → void

// Internal
- _debounceTimer: 600ms after last keystroke
- _abortController: cancels in-flight fetch on new input
- _minChars: 3 (don't search for "Br")
- _maxResults: 3
- _workerEndpoint: '/api/song-lookup'
```

### Integration Points

**Song Edit Form** (`js/songs.js` — `renderEdit()`):
```javascript
// After title input is rendered:
const titleInput = document.getElementById('edit-title');
titleInput.addEventListener('input', () => {
  SongLookup.lookupSong(titleInput.value).then(matches => {
    _showSuggestionCard(matches, songForm);
  });
});
```

**WikiChart Quicktext** (`js/wikicharts.js`):
```javascript
// After quicktext title input is rendered:
titleInput.addEventListener('input', () => {
  SongLookup.lookupSong(titleInput.value).then(matches => {
    _showSuggestionCard(matches, wikiForm);
  });
});
```

### Suggestion Card Component

Reusable UI component rendered below the title field:

```html
<div class="song-suggestion-card" role="region" aria-label="Song suggestions">
  <div class="ssc-header">
    <span class="ssc-title">Brown Eyed Girl</span>
    <span class="ssc-artist">Van Morrison</span>
    <button class="ssc-dismiss" aria-label="Dismiss">×</button>
  </div>
  <div class="ssc-details">
    <span class="ssc-chip">G major</span>
    <span class="ssc-chip">147 BPM</span>
    <span class="ssc-chip">3:03</span>
    <span class="ssc-chip">4/4</span>
  </div>
  <div class="ssc-actions">
    <button class="ssc-apply-all">Apply All</button>
    <button class="ssc-pick">Pick & Choose</button>
  </div>
</div>
```

### Offline Behavior

- `navigator.onLine` check before triggering search
- No search indicator shown when offline
- Graceful no-op — user can still fill fields manually
- If app comes back online mid-edit, doesn't auto-trigger (avoids surprise)

---

## CSS Design

```css
.song-suggestion-card {
  background: var(--bg-3);
  border: 1px solid var(--accent-dim);
  border-radius: var(--radius);
  padding: 12px;
  margin-top: 8px;
  animation: ssc-slide-in 0.2s ease;
}

.ssc-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ssc-title { font-weight: 600; color: var(--text); }
.ssc-artist { color: var(--text-2); font-size: 0.85em; }
.ssc-dismiss { margin-left: auto; opacity: 0.5; }

.ssc-details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ssc-chip {
  background: var(--accent-bg);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: 500;
}

.ssc-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.ssc-apply-all {
  background: var(--accent);
  color: var(--bg);
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.85em;
}

.ssc-pick {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent-dim);
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85em;
}

@keyframes ssc-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## Conductr Settings Integration

New conductr setting to enable/disable the feature per orchestra:

| Setting Key | Type | Default | Description |
|---|---|---|---|
| `song_lookup_enabled` | boolean | true | Enable AI song detection when adding/editing songs |

This lets conductrs who work with original compositions (not cover songs) disable the feature.

---

## Privacy & Data Considerations

- **What leaves the device**: Song titles only (sent to Cloudflare Worker → MusicBrainz/Spotify)
- **What's cached**: Normalized title → metadata mapping in KV (no PII)
- **User data**: No user IDs, orchestra IDs, or personal data sent to external APIs
- **GDPR**: Song titles are not personal data; no consent needed
- **Transparency**: Small info icon on suggestion card: "Powered by MusicBrainz & Spotify"

---

## Quota Impact Assessment

| Resource | Impact | Notes |
|---|---|---|
| Worker requests | +1-2 per song add/edit | Negligible |
| KV reads | +1 per lookup (cache check) | ~50 reads/day max |
| KV writes | +1 per cache miss | ~10 writes/day max |
| D1 rows | 0 | No database writes |
| External API calls | 1-3 per cache miss | MusicBrainz (free) + Spotify (free tier) |

**Verdict**: Well within free tier quotas. KV caching aggressively reduces external calls.

---

## Files Modified/Created

| File | Changes |
|---|---|
| `js/song-lookup.js` | **NEW** — lookup module (~150 lines) |
| `js/songs.js` | Wire lookup to song edit form title input |
| `js/wikicharts.js` | Wire lookup to WikiChart quicktext title input |
| `app.css` | Suggestion card styles (~50 lines) |
| `service-worker.js` | Add `song-lookup.js` to SHELL_ASSETS |
| `cloudflare-worker/src/index.js` | Add `/api/song-lookup` + `/api/song-enrich` routes |
| `cloudflare-worker/src/app-data.js` | Add KV caching helpers for song metadata |

---

## Implementation Phases

### Phase 1: Worker Proxy + MusicBrainz (MVP)
- Add `/api/song-lookup` route to Worker
- Query MusicBrainz, return artist + duration
- Client module with debounce + AbortController
- Basic suggestion card UI
- Wire to song edit form only
- **Ships**: Title → artist + duration auto-fill

### Phase 2: Spotify Enrichment (Key/BPM)
- Add Spotify client credentials flow to Worker
- Add `/api/song-enrich` route
- Merge Spotify audio features (key, BPM, time sig) into response
- KV caching layer
- **Ships**: Full metadata card with key + BPM

### Phase 3: WikiChart + Polish
- Wire to WikiChart quicktext form
- Add "Pick & Choose" UI for partial apply
- Multiple result cards (swipeable)
- Last.fm genre tag enrichment
- Conductr setting toggle
- **Ships**: Feature complete across all entry points

### Phase 4: iReal Charts (Stretch)
- Research iReal Pro public database format
- If viable: detect matching chord charts
- Offer to import chart data alongside metadata
- **Ships**: One-tap song + chart creation

---

## Success Metrics

| Metric | Target |
|---|---|
| Lookup response time | < 1.5s (cache miss), < 200ms (cache hit) |
| Match accuracy (top result) | > 80% for well-known songs |
| User adoption | > 50% of new songs use Apply All |
| API error rate | < 5% |
| Cache hit rate after 1 month | > 60% |

---

## Open Questions

1. **Spotify API key**: Do we want to register a Spotify app for client credentials? Free tier is generous but requires developer account setup.
2. **iReal Pro**: Is there a legal/public API, or only forum scraping? Need to verify terms.
3. **Bundled database**: Should we ship a lightweight JSON of the top 5,000 songs for instant offline lookup? (~200KB gzipped)
4. **Original compositions**: How to handle songs that won't be in any database? The "no match" state needs to feel helpful, not disappointing.
5. **Key format mapping**: Spotify uses pitch class integers (0-11) + mode (0=minor, 1=major). Need to map to our canonical 24-key system (already built in v20.40).
