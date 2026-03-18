-- Migration 0003: Add unique constraint on email (prevents duplicate registrations)
-- Run via: wrangler d1 execute catman-db --file=migrations/0003_email_unique.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(LOWER(email));
