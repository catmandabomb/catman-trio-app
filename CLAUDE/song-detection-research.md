# Song Auto-Detection — Master Research Document

> Compiled from 2 parallel research agents + plan document. Reference for all future implementation work.
> Last updated: v20.40 (March 2026)

---

## 1. THE VISION

Type a song title anywhere in the app → instant metadata suggestion: **key, BPM, duration, time signature, artist, genre**. One-tap apply. Works offline for common songs.

**Entry points**: New song (+), Edit song, WikiChart quicktext.

---

## 2. API LANDSCAPE — WHAT EXISTS

### Metadata Coverage Matrix

| Source | Artist | Duration | Key | BPM | Time Sig | Genre | CORS | Auth | Rate Limit | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **Spotify** | Yes | Yes | **Yes** | **Yes** | **Yes** | Yes | Proxy | OAuth | ~180/min | Active |
| **MusicBrainz** | Yes | Yes | No | No | No | Yes | Proxy | UA header | 1/sec | Active |
| **iTunes** | Yes | Yes | No | No | No | Yes | **Direct** | None | ~20/sec | Active |
| **Last.fm** | Yes | No | No | No | No | **Yes** | Proxy | API key | 5/sec | Active |
| **Deezer** | Yes | Yes | No | No | No | Limited | Partial | App ID | ~10/sec | Active |
| **Discogs** | Yes | Partial | No | No | No | Yes | Proxy | Optional | 60/min | Active |
| **Genius** | Yes | No | No | No | No | No | Proxy | Token | ~5/sec | Active |
| **TheAudioDB** | Yes | Partial | No | No | No | Yes | Proxy | Key | ~1/sec | Active |
| **AcousticBrainz** | - | - | ~~Yes~~ | ~~Yes~~ | - | - | - | - | - | **DEAD (2023)** |

**Critical finding**: Spotify is the **ONLY** free source with key + BPM + time signature. Everything else has artist/duration/genre but zero harmonic data.

### API Details

**MusicBrainz** (Primary for artist/duration)
- Endpoint: `https://musicbrainz.org/ws/2/recording?query={title}&fmt=json&limit=5`
- Auth: Custom User-Agent header required (no API key)
- CORS: Not supported — needs Worker proxy
- License: **CC0 (public domain)** — can freely redistribute
- Fuzzy search: Excellent Lucene-based query parser
- Data dumps: Monthly full PostgreSQL dumps (~5-8GB)

**Spotify Web API** (Only source for key/BPM)
- Search: `https://api.spotify.com/v1/search?q={title}&type=track`
- Audio features: `https://api.spotify.com/v1/audio-features/{trackId}`
- Auth: Client Credentials flow (app-level, no user login)
- CORS: Needs Worker proxy for token management
- Key mapping: pitch class 0-11 → `['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']` + mode (0=minor, 1=major)
- Maps directly to our 24 canonical key system (built in v20.40)

**iTunes Search API** (Best browser-direct fallback)
- Endpoint: `https://itunes.apple.com/search?term={title}&media=music&limit=5`
- Auth: None
- CORS: **Works directly from browser**
- Fields: artistName, trackTimeMillis, primaryGenreName, releaseDate
- Missing: No key, no BPM, no time signature

**Last.fm** (Best for genre tags)
- Endpoint: `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&track={title}&artist={artist}&api_key={key}&format=json`
- Auth: API key (free, instant registration)
- CORS: Needs proxy
- Fields: top tags (genre), play count, listeners

### iReal Pro / Chord Chart Sources

| Source | Public API | Searchable | Metadata | Legal | Viability |
|---|---|---|---|---|---|
| iReal Pro | No | No (app only) | Key, BPM, chords, time sig | Proprietary | Not viable |
| Ultimate Guitar | No (TOS prohibits) | N/A | Chords, tabs | Prohibited | Not viable |
| Chordify | No | N/A | Auto-generated chords | N/A | Not viable |
| OpenRealBook | No API | Manual only | Chord PDFs | Mixed | Very low |

**Verdict**: No viable chord chart API exists. Chord data would need to come from our own database or user contribution.

### Client-Side Audio Analysis

| Library | Key Detection | BPM Detection | Size | Input Required |
|---|---|---|---|---|
| **Essentia.js** | Yes (~75% accuracy) | Yes (~80%) | ~500KB WASM | Audio file |
| **Meyda** | No | No | ~50KB | Audio stream |
| **Web Audio API** | No (too low-level) | No | Native | Audio file |

**Verdict**: Audio analysis requires the actual audio file, not just a title. Not useful for title-based auto-detection. Could be a Phase 4 enhancement for user-uploaded audio.

---

## 3. SELF-HOSTED DATABASE — THE WINNING APPROACH

### Why Self-Host?

- Zero external API dependencies at runtime
- Works offline (client bundle)
- No rate limits, no auth tokens, no CORS issues
- Data is stable (popular songs don't change)
- Well within Cloudflare free tier
- **One-time build, serve forever** (with periodic refresh)

### Public Domain Data Sources

| Source | License | Size | Key/BPM | Viability |
|---|---|---|---|---|
| **MusicBrainz Dumps** | CC0 (public domain) | ~5-8GB full | No (via enrichment) | Best |
| **Million Song Dataset** | CC0 research | ~280GB full | Tempo only | Good |
| **WASABI Dataset** | CC0 + Spotify TOS | ~30-40GB | Yes (from Spotify) | Good |
| **Wikidata SPARQL** | CC0 | Unbounded | Sparse | Fair |
| **FMA** | CC0 | ~80GB | No | Low |
| **AcousticBrainz Dumps** | CC0 | ~2-3GB | ~~Yes~~ | **DEAD** |

### Database Sizing (100K songs, 7 fields)

| Format | Size | Notes |
|---|---|---|
| JSON (uncompressed) | ~50 MB | 500 bytes/song avg |
| SQLite/D1 table | ~35-40 MB | With indexes |
| Gzipped JSON (10K songs) | **~1.2-1.5 MB** | Client bundle |
| Gzipped JSON (5K songs) | **~650 KB** | Minimal bundle |
| KV entries (100K) | ~50 MB | Cache layer, not primary |

### Cloudflare Free Tier Fit

| Resource | Free Tier | Our Usage | Headroom |
|---|---|---|---|
| D1 Storage | 5 GB | 40 MB | 125x |
| D1 Row Reads | 5M/day | ~50K est. | 100x |
| D1 Row Writes | 100K/day | 0 (read-only) | Infinite |
| KV Storage | 1 GB | 50 MB cache | 20x |
| KV Reads | 100K/day | ~10K est. | 10x |
| R2 Storage | 10 GB | ~50 MB backup | 200x |

**Verdict: Massive headroom. Zero quota concerns.**

---

## 4. THREE-TIER LOOKUP ARCHITECTURE (RECOMMENDED)

```
User types "Brown Eyed Girl"
         |
    TIER 1: Client Bundle (5-10K songs, gzipped JSON in SW cache)
    Speed: <10ms | Coverage: ~80% of common songs | Offline: YES
         |
    (miss) → TIER 2: D1 Database (100K songs, indexed SQLite)
    Speed: 50-150ms | Coverage: +15% | Offline: NO
         |
    (miss) → TIER 3: External API (MusicBrainz → Spotify → iTunes)
    Speed: 500-2000ms | Coverage: remaining 5% | Offline: NO
         |
    Cache API result back to D1 for future lookups
```

### D1 Search Strategy

```sql
-- Recommended: prefix match with index
SELECT * FROM song_metadata
WHERE lower(title) LIKE lower(?) || '%'
ORDER BY LENGTH(title), title ASC
LIMIT 5;
-- Performance: <100ms on 100K rows with index
```

D1 supports FTS5 (full-text search) but prefix LIKE is simpler and fast enough.

---

## 5. DATA BUILD PIPELINE

### One-Time Enrichment (Run Once, ~36-48 hours)

```
Step 1: MusicBrainz Dump → Filter to popular recordings
        (release_count >= 5 AND performer_count >= 1)
        → ~100K songs with title, artist, duration

Step 2: Spotify Enrichment → For each 100K song:
        search by title+artist → get track ID → get audio features
        → key (pitch class), BPM, time_sig, energy, mode
        → ~85-90% match rate
        → Rate: 180 req/min = ~33 hours for 100K

Step 3: Last.fm Fallback → Genre tags for gaps
        → ~95% coverage

Step 4: Normalize → Canonical 24-key system, valid BPM range,
        time sig format, deduplicate
        → Export: SQLite + JSON
```

### Weekly Refresh Pipeline (New Songs)

**The user's requirement**: Don't get stuck in 2026 — new songs need to be captured.

**Approach**: Cloudflare Cron Trigger runs weekly:

```
Every Sunday at 3am UTC (Cron Trigger):
  1. Query MusicBrainz "recently added recordings" (last 7 days)
     → GET /ws/2/recording?query=date:[NOW-7DAYS TO NOW]&limit=100
  2. Filter: only recordings with >= 3 releases (skip obscure)
  3. For each new recording:
     a. Check if already in D1 → skip if exists
     b. Search Spotify for audio features (key, BPM, time sig)
     c. INSERT into D1 song_metadata table
  4. Rebuild client bundle monthly:
     a. Query D1 for top 10K by a "popularity" score
     b. Generate gzipped JSON
     c. Upload to R2 as /data/top-songs.json.gz
     d. Bump bundle version → SW fetches new version
  5. Log: "Added N new songs this week" to admin dashboard
```

**Quota impact**: ~100-200 MusicBrainz queries + 100-200 Spotify queries/week = negligible.

**Client bundle refresh**: Monthly — rebuild top 10K from D1, upload to R2, SW auto-updates.

### Refined Weekly Refresh — Dual Source Strategy

**Primary: Spotify New Releases** (best for mainstream new songs)

```
GET https://api.spotify.com/v1/browse/new-releases?limit=50
→ Returns latest album releases (mainstream, chart-worthy)
→ For each album: get tracks → get audio features (key, BPM, time sig)
→ INSERT into D1
→ ~50-150 new tracks/week
→ Already has audio features — no second enrichment needed
```

**Secondary: MusicBrainz Recent Recordings** (deeper catalog coverage)

```
GET /ws/2/recording?query=date:[NOW-7DAYS TO NOW]&limit=100
→ Covers indie, jazz, classical, international — broader than Spotify alone
→ Filter: >= 3 releases (skip obscure one-offs)
→ Enrich via Spotify for key/BPM
→ Catches songs Spotify doesn't surface in "new releases"
```

**Tier 3 Cache-Back** (organic growth from user lookups)

```
User searches for a song not in D1
→ Tier 3 fetches from external APIs (MusicBrainz → Spotify → iTunes)
→ Result is written BACK to D1 before returning to client
→ Next user who searches same song gets Tier 2 speed (<150ms)
→ DB grows naturally from actual usage — zero cron cost
→ Most valuable growth: songs YOUR users actually need
```

This means the DB grows from three directions: weekly cron (proactive), cache-back (reactive), and the one-time initial build (seed). The cache-back is arguably the most valuable — it captures exactly the songs your conductrs care about, not just whatever's charting.

---

## 5B. HOW TO KICK OFF THE WEEKLY JOB

### Option A: Cloudflare Cron Triggers (RECOMMENDED)

Cloudflare Workers support native cron triggers — no external scheduler needed.

**How it works:**
- Define a `scheduled()` handler in `wrangler.toml` + Worker code
- Cloudflare invokes it on schedule — no HTTP request needed
- Runs in same Worker, has access to D1, KV, R2, secrets
- Free tier: **5 cron triggers per account** (we need 1-2)

**Setup:**

```toml
# wrangler.toml
[triggers]
crons = ["0 3 * * 0"]  # Every Sunday at 3am UTC
```

```javascript
// cloudflare-worker/src/index.js — add scheduled handler
export default {
  async fetch(request, env) { /* existing routes */ },

  async scheduled(event, env, ctx) {
    // event.cron === "0 3 * * 0"
    ctx.waitUntil(refreshSongDatabase(env));
  }
};

async function refreshSongDatabase(env) {
  // 1. Fetch Spotify new releases
  const token = await getSpotifyToken(env);
  const releases = await fetch('https://api.spotify.com/v1/browse/new-releases?limit=50', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());

  let added = 0;
  for (const album of releases.albums.items) {
    const tracks = await getAlbumTracks(token, album.id);
    for (const track of tracks) {
      // Check if already in D1
      const exists = await env.DB.prepare(
        'SELECT 1 FROM song_metadata WHERE spotify_id = ?'
      ).bind(track.id).first();
      if (exists) continue;

      // Get audio features
      const features = await getAudioFeatures(token, track.id);
      // INSERT into D1
      await env.DB.prepare(`
        INSERT INTO song_metadata (id, title, artist, key, bpm, duration, time_sig, genre, year, spotify_id, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spotify_weekly', datetime('now'))
      `).bind(/* ... */).run();
      added++;
    }
  }

  // 2. Optionally: MusicBrainz recent recordings (secondary)
  // ... similar pattern with enrichment step

  // 3. Log result
  console.log(`Weekly refresh: added ${added} new songs`);
}
```

**Pros:**
- Zero infrastructure outside Cloudflare
- Free, reliable, built-in
- Same Worker = same D1/KV/R2 access
- Logs visible in Cloudflare dashboard
- `ctx.waitUntil()` keeps Worker alive for up to 30s (free) or 15min (paid)

**Cons:**
- Free tier: 10ms CPU time per invocation (but `waitUntil` extends this)
- If job exceeds limits, need Workers Paid ($5/mo) for 30s CPU
- No retry on failure (would need to build own retry logic)

### Option B: GitHub Actions (Alternative)

If Cloudflare CPU limits are too tight for the enrichment loop:

```yaml
# .github/workflows/song-refresh.yml
name: Weekly Song DB Refresh
on:
  schedule:
    - cron: '0 3 * * 0'  # Sunday 3am UTC
  workflow_dispatch: {}   # Manual trigger button

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/refresh-songs.js
        env:
          SPOTIFY_CLIENT_ID: ${{ secrets.SPOTIFY_CLIENT_ID }}
          SPOTIFY_CLIENT_SECRET: ${{ secrets.SPOTIFY_CLIENT_SECRET }}
          D1_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}
```

**Pros:**
- No CPU time limits (6 hours/job on free tier)
- Easy manual trigger via GitHub UI
- Can run complex Python/Node scripts
- GitHub Actions free tier: 2000 min/month

**Cons:**
- Requires D1 HTTP API (slower than native binding)
- Another dependency (GitHub)
- Secrets management in GitHub
- Slightly more latency than native Worker

### Option C: Manual Trigger via Admin Endpoint

For the initial phase, skip automation entirely — add a button in admin dashboard:

```
POST /api/admin/song-db-refresh   (Owner only)
→ Triggers the refresh job on-demand
→ Returns: { added: 47, skipped: 203, errors: 0 }
```

Can start with this and add cron later.

### Recommendation

**Start with Option C (manual trigger)** → graduate to **Option A (Cron Trigger)** once the pipeline is proven.

1. Phase 2 (Worker endpoints): Add `/api/admin/song-db-refresh` — manual trigger
2. Phase 6 (Weekly refresh): Add Cron Trigger in wrangler.toml
3. If CPU limits bite: Fall back to Option B (GitHub Actions)

### Spotify Token Management for Cron

The weekly job needs a valid Spotify token. Client Credentials flow (no user login):

```javascript
async function getSpotifyToken(env) {
  // Check KV cache first
  const cached = await env.KV.get('spotify_token');
  if (cached) return cached;

  // Client Credentials flow
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET)
    },
    body: 'grant_type=client_credentials'
  });
  const { access_token, expires_in } = await resp.json();

  // Cache in KV (expires 1 hour, cache for 55 min)
  await env.KV.put('spotify_token', access_token, { expirationTtl: expires_in - 300 });
  return access_token;
}
```

**Secrets needed in wrangler.toml (or Cloudflare dashboard):**
- `SPOTIFY_CLIENT_ID` — from Spotify Developer Dashboard (free)
- `SPOTIFY_CLIENT_SECRET` — from Spotify Developer Dashboard (free)

### Monthly Client Bundle Rebuild

Separate from weekly refresh — rebuilds the top 10K gzipped JSON for offline use:

```
Monthly (1st of month, 4am UTC):
  1. Query D1: SELECT * FROM song_metadata ORDER BY popularity DESC LIMIT 10000
  2. Generate JSON, gzip it
  3. Upload to R2: /data/top-songs.json.gz
  4. Write version tag to KV: song_bundle_version = "2026-04-01"
  5. SW checks version on activate → fetches new bundle if changed
```

Could be a second Cron Trigger or just part of the weekly job (check if it's the 1st of the month).

---

## 6. WORKER ENDPOINTS (NEW)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/song-search` | POST | Auth | Search D1 by title (prefix match) |
| `/api/song-lookup` | GET | Auth | Full 3-tier lookup (client → D1 → external) |
| `/api/song-enrich` | GET | Auth | Spotify audio features proxy |
| `/api/admin/song-db-stats` | GET | Owner | DB row count, last refresh date |
| `/api/admin/song-db-refresh` | POST | Owner | Trigger manual refresh pipeline |

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
      "genres": ["Rock", "Classic Rock"],
      "year": 1967,
      "confidence": 0.95,
      "source": "local"
    }
  ],
  "tier": 1,
  "cached": true
}
```

---

## 7. CLIENT MODULE DESIGN

### `js/song-lookup.js` (~200 lines)

```
Public API:
  SongLookup.init()                    → Load client bundle from SW cache
  SongLookup.lookup(title)             → Promise<SongMatch[]> (3-tier)
  SongLookup.cancel()                  → Abort in-flight request

Internal:
  _localBundle: in-memory JSON array (5-10K songs)
  _debounceTimer: 600ms after last keystroke
  _abortController: cancels previous fetch
  _minChars: 3
  _maxResults: 5
```

### Integration Points

- `js/songs.js` — `renderEdit()`: wire to title input
- `js/wikicharts.js` — quicktext modal: wire to title input
- `app.js` — `SongLookup.init()` on app startup

### Suggestion Card UI

```
┌─────────────────────────────────────────────────┐
│  Brown Eyed Girl — Van Morrison                 │
│  G major . 147 BPM . 3:03 . 4/4                │
│  [Apply All]  [Pick & Choose]  [Dismiss x]      │
└─────────────────────────────────────────────────┘
```

- Slides in below title field with animation
- Multiple matches: horizontal swipeable cards (top 3)
- "Pick & Choose" expands checkboxes per field
- Dismiss: tap outside or X button

### Fuzzy Matching Strategy

1. Exact title match (case-insensitive)
2. Normalized: strip hyphens, apostrophes, parentheticals
3. Token match: "Brown Eyed Girl" matches "Brown-Eyed Girl"
4. Prefix match: "Brown E" matches "Brown Eyed Girl"
5. Levenshtein fallback (already in utils.js)

### Debounce + Cancel

```javascript
let _timer, _controller;
function lookup(title) {
  clearTimeout(_timer);
  _controller?.abort();
  if (title.length < 3) return Promise.resolve([]);
  return new Promise(resolve => {
    _timer = setTimeout(async () => {
      _controller = new AbortController();
      // Tier 1 → 2 → 3 cascade
      resolve(await _cascadeLookup(title, _controller.signal));
    }, 600);
  });
}
```

---

## 8. CONDUCTR SETTING

| Key | Type | Default | Description |
|---|---|---|---|
| `song_lookup_enabled` | boolean | true | Enable auto-detection when adding/editing songs |

Lets conductrs working with original compositions disable the feature.

---

## 9. PRIVACY & LEGAL

- **Data sent externally**: Song titles only (to Worker proxy → MusicBrainz/Spotify)
- **No PII**: No user IDs, orchestra IDs, or personal data
- **MusicBrainz data**: CC0 (public domain) — free to redistribute
- **Spotify enrichment**: TOS allows lookup but not bulk redistribution. Our one-time enrichment stored locally is fine for non-commercial private use.
- **Attribution**: "Song data from MusicBrainz (CC0) and Spotify"

---

## 10. IMPLEMENTATION PHASES

| Phase | What Ships | Effort | Dependencies |
|---|---|---|---|
| **Phase 1: Data Pipeline** | Python script: MusicBrainz dump → Spotify enrichment → D1 load | 2 weeks | Spotify dev account (free) |
| **Phase 2: D1 + Worker** | `song_metadata` table, `/api/song-search` endpoint | 2 days | Phase 1 data |
| **Phase 3: Client Module** | `js/song-lookup.js`, suggestion card UI, song edit integration | 3 days | Phase 2 |
| **Phase 4: Client Bundle** | Gzipped JSON (top 10K), SW cache, offline lookup | 2 days | Phase 1 data |
| **Phase 5: WikiChart + Polish** | WikiChart integration, "Pick & Choose", multiple results | 2 days | Phase 3 |
| **Phase 6: Weekly Refresh** | Cron Trigger for new songs, monthly bundle rebuild | 1 day | Phase 2 |
| **Phase 7: Audio Analysis** | Essentia.js for user-uploaded audio (stretch) | 1 week | Optional |

**Total: ~4 weeks for Phases 1-6. Phase 7 is optional stretch.**

---

## 11. OPEN DECISIONS

| Decision | Options | Recommendation |
|---|---|---|
| Spotify dev account | Register now vs defer | Register now (free, instant, needed for key/BPM) |
| Bundle size | 5K vs 10K songs | Start with 5K (~650KB), expand if needed |
| Refresh cadence | Weekly vs monthly | Weekly new songs to D1, monthly bundle rebuild |
| FTS5 vs LIKE | Full-text search vs prefix match | Start with LIKE, upgrade to FTS5 if needed |
| Build pipeline language | Python vs Node | Python (better data processing libs, one-time script) |
| Client fuzzy matching | Levenshtein (existing) vs Fuse.js | Levenshtein first (already in utils.js), add Fuse.js if needed |

---

## 12. FILES CREATED/MODIFIED (WHEN IMPLEMENTED)

| File | Changes |
|---|---|
| `js/song-lookup.js` | **NEW** — 3-tier lookup module (~200 lines) |
| `js/songs.js` | Wire lookup to song edit title input |
| `js/wikicharts.js` | Wire lookup to quicktext title input |
| `app.css` | Suggestion card styles (~50 lines) |
| `app.js` | Import + init SongLookup |
| `service-worker.js` | Add song-lookup.js to SHELL_ASSETS, cache bundle |
| `cloudflare-worker/src/index.js` | New routes: `/api/song-search`, `/api/song-lookup` |
| `cloudflare-worker/src/app-data.js` | D1 queries for song_metadata table |
| `cloudflare-worker/migrations/0016_song_metadata.sql` | **NEW** — song_metadata table + indexes |
| `scripts/build-song-db.py` | **NEW** — One-time data pipeline script |

---

## 13. REFERENCES

- MusicBrainz API: https://musicbrainz.org/doc/MusicBrainz_API
- MusicBrainz Data Dumps: https://musicbrainz.org/doc/MusicBrainz_Database (CC0)
- Spotify Web API: https://developer.spotify.com/documentation/web-api
- Spotify Audio Features: https://developer.spotify.com/documentation/web-api/reference/get-audio-features
- iTunes Search API: https://performance-partners.apple.com/search-api
- Last.fm API: https://www.last.fm/api
- Million Song Dataset: https://labrosa.ee.columbia.edu/millionsong/
- WASABI Dataset: https://www.dcc.fc.up.pt/~learner/wasabi/
- Essentia.js: https://github.com/mtg/essentia.js
- Cloudflare D1 Limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare KV Limits: https://developers.cloudflare.com/workers/runtime-apis/kv/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
