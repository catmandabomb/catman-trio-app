-- App data tables: songs, setlists, practice
-- Replaces GitHub data branch encrypted JSON storage

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,             -- 4-digit hex (e.g. "3f9a")
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '',
  bpm TEXT NOT NULL DEFAULT '',
  time_sig TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  notes TEXT NOT NULL DEFAULT '',
  assets TEXT NOT NULL DEFAULT '{}', -- JSON: { charts: [], audio: [], links: [] }
  chart_order TEXT NOT NULL DEFAULT '[]', -- JSON array of { driveId/r2Key, order }
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setlists (
  id TEXT PRIMARY KEY,             -- 4-digit hex
  venue TEXT NOT NULL DEFAULT '',
  gig_date TEXT NOT NULL DEFAULT '',
  override_title TEXT NOT NULL DEFAULT '',
  songs TEXT NOT NULL DEFAULT '[]', -- JSON array of { id, comment }
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practice_lists (
  id TEXT PRIMARY KEY,             -- 4-digit hex
  name TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '', -- user ID (owner of this list)
  songs TEXT NOT NULL DEFAULT '[]', -- JSON array of practice entries
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_setlists_archived ON setlists(archived);
CREATE INDEX IF NOT EXISTS idx_setlists_gig_date ON setlists(gig_date);
CREATE INDEX IF NOT EXISTS idx_practice_created_by ON practice_lists(created_by);

-- File registry: maps file IDs to R2 keys (replaces Drive file references)
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,             -- unique file ID (was driveId, now generated)
  r2_key TEXT NOT NULL,            -- R2 object key (e.g. "files/abc123.pdf")
  filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  song_id TEXT,                    -- which song this belongs to (nullable for orphans)
  file_type TEXT NOT NULL DEFAULT 'chart', -- 'chart' | 'audio'
  uploaded_by TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_song_id ON files(song_id);
CREATE INDEX IF NOT EXISTS idx_files_r2_key ON files(r2_key);

-- Migration state tracking
CREATE TABLE IF NOT EXISTS migration_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
