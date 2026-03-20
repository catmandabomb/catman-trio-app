-- Migration 0010: Orchestras + Members
-- Core multi-tenancy tables for the Orchestra system.

CREATE TABLE IF NOT EXISTS orchestras (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '[]',
  conductr_id TEXT NOT NULL REFERENCES users(id),
  max_members INTEGER NOT NULL DEFAULT 50,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orchestra_members (
  orchestra_id TEXT NOT NULL REFERENCES orchestras(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_visible INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (orchestra_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_orch_conductr ON orchestras(conductr_id);
CREATE INDEX IF NOT EXISTS idx_orch_members_user ON orchestra_members(user_id);
