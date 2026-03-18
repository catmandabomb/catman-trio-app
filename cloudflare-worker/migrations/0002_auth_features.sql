-- Migration 0002: Add password expiry, forgot password, and email verification
-- Run via: wrangler d1 execute catman-db --file=migrations/0002_auth_features.sql

-- Password expiry tracking
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

-- Email verification
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verify_token TEXT;
ALTER TABLE users ADD COLUMN email_verify_expires TEXT;

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON password_reset_tokens(expires_at);

-- Atomic rate limiting (supplements KV for sensitive endpoints)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window INTEGER NOT NULL
);

-- Backfill password_changed_at for existing users
UPDATE users SET password_changed_at = updated_at WHERE password_changed_at IS NULL;
