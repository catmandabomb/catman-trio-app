# Band Book — Setup Guide

## What you have

A complete PWA (Progressive Web App) that works on iPhone and Android.
No App Store. Share a link, add to home screen, done.

---

## File Structure

```
bandapp/
├── index.html           App shell
├── manifest.json        PWA config
├── service-worker.js    Offline support
├── css/app.css          All styles
├── js/
│   ├── app.js           Main logic (views, routing)
│   ├── drive.js         Google Drive API
│   ├── pdf-viewer.js    PDF.js wrapper
│   ├── player.js        Custom audio player
│   └── admin.js         Edit mode + password
└── data/
    └── songs.example.json   Data schema reference
```

---

## Step 1: Host the app

You need a simple HTTPS host. Free options:

### Option A — GitHub Pages (recommended)
1. Create a GitHub repo (can be private)
2. Push the `bandapp/` folder contents to the repo root
3. Go to Settings → Pages → Source: main branch / root
4. Your app is live at `https://yourusername.github.io/reponame`

### Option B — Netlify Drop
1. Go to https://netlify.com/drop
2. Drag your `bandapp/` folder onto the page
3. You get an instant URL — add a custom domain if you want

### Option C — Any static host
Vercel, Cloudflare Pages, Firebase Hosting all work fine.
The only requirement is **HTTPS** (needed for PWA install + Google OAuth).

---

## Step 2: Generate PWA icons

You need two PNG icons: 192×192 and 512×512.

1. Create a simple image (any tool — even Paint)
2. Save as `icons/icon-192.png` and `icons/icon-512.png`
3. Or use https://realfavicongenerator.net to generate from any image

---

## Step 3: Google Drive API setup

> Skip this if you just want to test locally — songs save to localStorage by default.

### 3a. Create a Google Cloud Project
1. Go to https://console.cloud.google.com
2. New Project → name it "Band Book" or anything
3. Enable **Google Drive API**: APIs & Services → Enable APIs → search "Drive API"

### 3b. Create API credentials
1. APIs & Services → Credentials → Create Credentials → **API Key**
   - Copy this (your `API Key`)
   - Click Edit → restrict to "Google Drive API" for security

2. Create Credentials → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: add your hosted URL (e.g. `https://yourusername.github.io`)
   - Also add `http://localhost:8080` for local dev
   - Copy the Client ID

### 3c. Create your Drive folder
1. In Google Drive, create a folder called "Band Book" (or anything)
2. Open it — the URL will look like: `drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74`
3. Copy that long ID at the end — that's your `Folder ID`

### 3d. Enter credentials in the app
1. Open the app in your browser
2. Click **Edit** → enter your admin password (default: `bandbook`)
3. A "Google Drive Setup" prompt will appear on first add
   — or open it manually in the admin modal
4. Paste your API Key, Client ID, and Folder ID
5. Click Save & Connect → sign in with your Google account

> Credentials are stored in your browser's localStorage only.
> Bandmates' devices will need read-only Drive folder access (share the folder with them as "Viewer").

---

## Step 4: Change the admin password

The default password is `bandbook`. Change it:

1. Open browser DevTools console on your hosted app
2. Run: `Admin.setPassword('your-new-password')`
3. Done — the hash is stored in localStorage

---

## Step 5: Install on iPhone (iOS)

1. Open Safari → navigate to your app URL
2. Tap the Share button (box with arrow)
3. Scroll down → **"Add to Home Screen"**
4. Name it "Band Book" → Add

To share with bandmates: send them the URL, they repeat step 5.

---

## Step 6: Install on Android

1. Open Chrome → navigate to your app URL
2. Tap the three-dot menu → **"Add to Home Screen"** (or "Install App")

---

## Adding songs

1. Open the app → tap **Edit** in the top right
2. Enter password
3. Tap **+** to add a new song
4. Fill in title, key, BPM, tags, notes
5. Upload PDFs and audio files (they go to your Drive folder)
6. Paste streaming URLs (YouTube/Spotify/Apple Music) — embed IDs auto-extracted
7. Tap **Save Song**

---

## Local development (no host needed)

```bash
# Python 3
python -m http.server 8080

# Node
npx serve .
```

Then open http://localhost:8080

Note: Google OAuth won't work on localhost unless you add it to your OAuth origins.
For local testing, songs save to localStorage without Drive.

---

## Data format

Songs are stored in `bandbook_songs.json` in your Drive folder.
See `data/songs.example.json` for the full schema.

Each song has:
- `id`       — 4-digit hex (e.g. `"3f9a"`)
- `title`    — string
- `subtitle` — string
- `key`      — string (e.g. `"Bm"`, `"F#"`)
- `bpm`      — number
- `tags`     — string array
- `notes`    — string (multiline ok)
- `assets.charts` — `[{ driveId, name }]`
- `assets.audio`  — `[{ driveId, name }]`
- `assets.links`  — `[{ type, url, embedId }]`

---

## Troubleshooting

**PDF won't open** — Check that the file is in your Drive folder and the Drive API has access.

**Audio won't load** — Same as above. Large files may take a moment; a "Loading…" indicator shows while fetching.

**Drive sync fails** — Check your credentials in localStorage. Re-enter them in Edit mode.

**App won't install on iPhone** — Must be opened in Safari (not Chrome) on iOS for Add to Home Screen to work as a PWA.

**Google sign-in popup blocked** — Allow popups for your app domain in Safari settings.
