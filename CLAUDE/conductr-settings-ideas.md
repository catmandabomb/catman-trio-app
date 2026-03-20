# Conductr Settings Ideas

Brainstorm for meaningful Conductr (bandleader) settings in the Catman Trio App. Each setting is scoped to a single Orchestra -- when a Conductr manages multiple Orchestras, each can have different preferences.

Storage strategy: Server-side in D1 `orchestra_settings` table (keyed by `orchestraId`), synced to localStorage for offline access. Pattern mirrors the existing `ct_pref_*` convention but namespaced per-orchestra.

---

## 1. Rehearsal and Practice Settings

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 1 | **Practice list visibility** | Whether members see only practice lists assigned to them, or all lists in the Orchestra | `assigned-only` | Some bands want transparency (everyone sees everything); others want focused assignment so members aren't overwhelmed. BandHelper calls this "focused mode." | Small |
| 2 | **Practice list creation rights** | Who can create practice lists: `conductr-only` or `all-members` | `conductr-only` | Smaller bands may want members to self-organize practice. Larger ensembles need top-down control. Currently members can create lists -- this gives Conductrs the ability to lock it down. | Small |
| 3 | **Default practice due date** | Number of days from creation that a practice list is "due" (0 = no due date) | `0` (off) | Conductrs scheduling weekly rehearsals want a default deadline without setting it manually each time. Powers a future "due soon" badge on member views. | Medium |
| 4 | **Practice completion tracking** | Enable/disable a per-member "mark as practiced" checkbox on practice list songs | `off` | Lets the Conductr see who has actually looked at the material before rehearsal. Inspired by BandHelper's "song status" feature. Requires new D1 column + member UI. | Medium |

## 2. Setlist and Gig Settings

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 5 | **Default setlist sort** | How setlist list sorts: `date-desc` (newest first) or `date-asc` or `alpha` | `date-desc` | Working bands with frequent gigs want newest on top. Cover bands doing the same venue rotation may prefer alphabetical. | Tiny |
| 6 | **Auto-archive after gig date** | Automatically move setlists to archived once their `gigDate` passes | `off` | Prevents the active setlist list from growing indefinitely. Conductr can still un-archive manually. Just a daily check on load. | Small |
| 7 | **Setlist duration warnings** | Show a warning when a setlist exceeds a configurable total duration (in minutes) | `off` (0 = disabled) | Venues often give strict set lengths (45 min, 90 min). The Conductr sets their typical set length and gets a visual warning when they go over. Requires song durations to be populated. | Small |
| 8 | **Freetext entry default behavior** | When adding a freetext entry to a setlist, default to `break` type vs `announcement` vs `blank` | `blank` | Bands that always take set breaks between songs can default to "Break" freetext, saving a typing step every time. | Tiny |

## 3. Member Experience Settings

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 9 | **Song notes visibility** | Whether the Conductr's internal notes field on songs is visible to members | `hidden` | Notes often contain Conductr-only info ("needs better arrangement," "Bob always forgets the bridge"). Members should see clean song data. OnSong has a similar "private notes" feature. | Small |
| 10 | **Member song editing** | Whether members can suggest edits to song metadata (key, BPM, tags) | `off` | Some Conductrs want a locked-down repertoire. Others want collaborative metadata. When on, member edits go into a "pending suggestions" queue rather than applying directly. | Large |
| 11 | **Chart filter default for members** | Default `chartFilterMode` for new members joining the Orchestra | `smart` | Conductrs uploading instrument-specific charts (lead sheet vs bass chart vs drum chart) want members to automatically see only their part. Currently defaults to `smart` globally -- this lets the Conductr override per-Orchestra. | Tiny |
| 12 | **Song difficulty visibility** | Whether the 1-5 difficulty rating is visible to members | `visible` | Some Conductrs use difficulty internally for repertoire planning but don't want members to feel intimidated or to complain about hard songs. | Tiny |

## 4. Performance / Live Mode Settings

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 13 | **Live Mode default theme** | Dark mode on/off as the default when entering Live Mode | `dark` | Most stage environments need dark mode, but some well-lit venues (church, theater) work better with light. Saves toggling every gig. | Tiny |
| 14 | **Live Mode font size** | Default font size for chord charts in Live Mode | `22` | Depends on device distance from the musician. A tablet on a music stand needs different sizing than a phone on the floor. forScore has this per-device. | Tiny |
| 15 | **Auto-advance between songs** | In Live Mode, automatically advance to the next song in the setlist after a configurable delay (seconds) or manual trigger only | `manual` | Some bands want seamless medley transitions. Most want manual control between songs but the option to set a countdown for specific transitions. | Medium |
| 16 | **Live Mode toolbar items** | Which toolbar buttons appear in Live Mode (extends the existing 4 show/hide toggles: dark, half-page, auto-advance, red mode) | All visible | The existing `live_show_*` prefs are per-device. This promotes them to Orchestra-level defaults so all members get a consistent Live Mode UI on first use. | Small |
| 17 | **Bluetooth page turner mapping** | Map page turner buttons (typically Enter/Backspace or ArrowRight/ArrowLeft) to Live Mode actions | `Enter=next, Backspace=prev` | Different page turners send different keycodes. AirTurn sends arrows; PageFlip sends Enter/Space. Currently hardcoded -- this makes it configurable. | Small |

## 5. Content Management Settings

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 18 | **Required song fields** | Which metadata fields are mandatory when adding a song: title is always required, but the Conductr can also require `key`, `bpm`, `timeSig`, or at least one tag | `title only` | Ensures data quality. A jazz Conductr needs key on every chart. A rock band might not care about time signatures. Enforced in the song edit modal validation. | Small |
| 19 | **Default tags for new songs** | A set of tags automatically applied to newly created songs | `[]` (none) | Bands that categorize everything by genre or era can auto-tag. Saves repetitive tagging when bulk-adding repertoire. | Tiny |
| 20 | **WikiChart default key** | The default key pre-selected when creating a new WikiChart | `C` | Concert-pitch instruments (piano, guitar) think in C. Bb instruments (trumpet, tenor sax) might want Bb. Saves a step on every new chart. | Tiny |
| 21 | **File upload size limit** | Max file size (MB) for PDF/audio uploads, per Orchestra | `25 MB` | Controls R2 storage costs. A Conductr managing a free-tier Orchestra might want to cap at 10 MB. Enforced client-side + worker-side. | Small |

## 6. Notification and Communication

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 22 | **Rehearsal reminder lead time** | How far in advance (hours) to surface a "Rehearsal coming up" banner to members, based on setlist gigDate | `24` hours | Members forget rehearsals. A banner at the top of the app the day before is low-effort but high-value. No push notifications needed -- just an in-app banner on load. | Small |
| 23 | **New material alert** | Show a "New songs added" badge on the songs tab for members when the Conductr adds songs since the member's last visit | `on` | Members who check the app infrequently miss new additions. A simple badge counter (like "3 new") draws attention. Tracked via member's `lastSeen` timestamp vs song `createdAt`. | Medium |

## 7. Quality of Life

| # | Setting | What It Controls | Default | Why a Conductr Wants It | Effort |
|---|---------|-----------------|---------|------------------------|--------|
| 24 | **Quick-add song mode** | After saving a new song, immediately open a fresh "Add Song" modal instead of returning to the list | `off` | When bulk-loading 30+ songs into a new Orchestra, the Conductr saves enormous time not navigating back to the list and tapping "+" each time. iReal Pro has this for importing. | Tiny |
| 25 | **Setlist duplicate detection** | Warn when adding a song to a setlist that already contains it | `warn` (show warning but allow) | Prevents accidentally programming the same song twice in a set. Options: `off`, `warn`, `block`. | Small |

---

## 5 Switch Results (v20.26 session)

### NO (killed)
| # | Setting | Reason |
|---|---------|--------|
| 1 | Practice list visibility | All Rehearsal & Practice items rejected |
| 2 | Practice list creation rights | All Rehearsal & Practice items rejected |
| 3 | Default practice due date | All Rehearsal & Practice items rejected |
| 4 | Practice completion tracking | All Rehearsal & Practice items rejected |
| 21 | File upload size limit (as Conductr setting) | Moved to Admin Dashboard instead |

### GO (queued for implementation)
| # | Setting | Implementation Notes | Effort |
|---|---------|---------------------|--------|
| 5 | Default setlist sort | 3-way: "Newest first" / "Oldest first" / "A-Z". Clear labels. | Tiny |
| 6 | Auto-archive after gig | Slider 1-30 days (0=off). Purge at 8am next morning. | Small |
| 7 | Set-length warning | TWO settings: (a) enable/disable, (b) threshold in minutes. Gentle notification. | Small |
| 8 | Freetext entry redesign | Separate class for non-song fillers (BREAK, ANNOUNCEMENT). Don't count against song total. | Small |
| 9 | Song notes visibility | Hide Conductr notes from members. | Small |
| 10 | Member song editing | Suggestion queue — members propose, Conductr approves/rejects. | Large |
| 11 | Chart filter default | Per-orchestra default for `chartFilterMode` (smart/all/mine-only). | Tiny |
| 12 | Difficulty visibility | Toggle to hide ratings from members. | Tiny |
| 13 | Live Mode default theme | Dark/light default when entering Live Mode. | Tiny |
| 14 | Live Mode font size | Default font size for chord charts in Live Mode. | Tiny |
| 15 | Auto-advance between songs | Configurable delay (seconds) or manual-only. | Medium |
| 17 | Bluetooth page turner | Dedicated modal with "Learn" mode — press button → app captures keycode → maps to action. Pre-built profiles for AirTurn, PageFlip, iRig BlueTurn. Per-device storage. | Small |
| 18 | Required song fields | Lightweight popup with per-field enable/disable toggles. Granular control. | Small |
| 20 | WikiChart default key | Pre-selected key when creating a new WikiChart. | Tiny |
| 23 | New material alert | "X new songs" badge on songs tab for members since last visit. Based on `lastSeen` vs `createdAt`. | Medium |
| 24 | Quick-add song mode | After save, immediately open fresh Add Song modal. | Tiny |
| 25 | Duplicate detection | 3-way: Always Allow / Warn / Block. | Small |

### PARK (deferred)
| # | Setting | Reason |
|---|---------|--------|
| 16 | Live Mode toolbar defaults | Low value — per-device prefs sufficient |
| 19 | Default tags for new songs | |
| 22 | Rehearsal reminder lead time | |

### Admin-level feature (not a Conductr setting)
| Feature | Implementation Notes |
|---------|---------------------|
| File upload size limit | Admin Dashboard control. Slider: 10MB-250MB in 10MB increments + "No limit" option. Default 50MB for all new orchestras. Client-side + worker-side enforcement. Toast on rejection. |

### Section renames
- "Setlist & Gig" → "Live & Setlists"
- "Performance / Live Mode" → "Live Mode"

---

## Data Model Sketch

```sql
CREATE TABLE orchestra_settings (
  orchestra_id TEXT NOT NULL,
  key          TEXT NOT NULL,   -- e.g. 'practice_visibility', 'live_default_theme'
  value        TEXT NOT NULL,   -- JSON-encoded value
  updated_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (orchestra_id, key)
);
```

Client-side: `Sync.loadOrchestraSettings(orchId)` fetches all rows, caches in `Store.orchestraSettings`. Individual reads via `Store.getOrchestraSetting(key, default)`. Writes via `Sync.saveOrchestraSetting(key, value)` which PUTs to the worker and updates local cache.

Fallback: If offline or no Orchestra context, fall back to `ct_pref_*` localStorage values (existing behavior). Orchestra-level settings override device-level prefs when available.
