-- Migration 0001: Create user accounts, sessions, and permissions tables
-- Run via: wrangler d1 execute catman-db --file=migrations/0001_create_tables.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  email TEXT,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  persona_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  CHECK (role IN ('owner', 'admin', 'member', 'guest'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  device_info TEXT,
  last_used TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setlist_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  setlist_id TEXT NOT NULL,
  can_edit INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, setlist_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
