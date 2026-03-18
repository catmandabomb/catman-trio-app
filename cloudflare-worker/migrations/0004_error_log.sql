-- Migration 0004: Add error_log table for server-side error tracking
-- Run via: wrangler d1 execute catman-db --file=migrations/0004_error_log.sql

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  method TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);
