-- Shared gig packets — public read-only setlist views for sub musicians
CREATE TABLE IF NOT EXISTS shared_packets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL UNIQUE,          -- URL token (random 16-char hex)
  pin         TEXT NOT NULL,                 -- 4-digit PIN for download auth
  setlist_id  TEXT NOT NULL,                 -- setlist ID from app data
  title       TEXT NOT NULL,                 -- display title at share time
  venue       TEXT NOT NULL DEFAULT '',
  gig_date    TEXT NOT NULL DEFAULT '',
  setlist_json TEXT NOT NULL,                -- full setlist + song data snapshot (JSON)
  file_manifest TEXT NOT NULL DEFAULT '[]',  -- JSON array of { filename, r2Key, type, songTitle }
  zip_r2_key  TEXT,                          -- R2 key for pre-built zip file
  zip_filename TEXT,                         -- display filename for the zip
  shared_by   TEXT NOT NULL,                 -- user ID who shared
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(setlist_id)                         -- only one active share per setlist
);

CREATE INDEX IF NOT EXISTS idx_shared_packets_token ON shared_packets(token);
CREATE INDEX IF NOT EXISTS idx_shared_packets_setlist ON shared_packets(setlist_id);
