-- Migration 0014: Orchestra Settings + Admin Settings
-- Key-value store for per-orchestra Conductr settings and global admin settings.

CREATE TABLE IF NOT EXISTS orchestra_settings (
  orchestra_id TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (orchestra_id, key)
);

CREATE INDEX IF NOT EXISTS idx_orch_settings_orch ON orchestra_settings(orchestra_id);

-- Admin-level settings (global, not per-orchestra)
CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Song edit suggestions (member proposals for conductr approval)
CREATE TABLE IF NOT EXISTS song_suggestions (
  id            TEXT PRIMARY KEY,
  song_id       TEXT NOT NULL,
  orchestra_id  TEXT NOT NULL,
  submitted_by  TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  old_value     TEXT NOT NULL DEFAULT '',
  new_value     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suggestions_orch ON song_suggestions(orchestra_id, status);
CREATE INDEX IF NOT EXISTS idx_suggestions_song ON song_suggestions(song_id);

-- Default admin settings
INSERT OR IGNORE INTO admin_settings (key, value) VALUES ('upload_size_limit_mb', '50');
