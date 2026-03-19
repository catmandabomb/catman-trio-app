-- Add version column for optimistic locking (prevents lost-update race conditions)
-- version starts at 1 and increments on every write

ALTER TABLE songs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE setlists ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE practice_lists ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
