-- Migration 0012: Orchestra scoping on all data tables
-- Adds nullable orchestra_id to songs, setlists, practice_lists, wiki_charts, files.
-- Also adds instrument_tags to files for chart-level instrument tagging.
-- Nullable first (safe migration), backfilled later, then enforced in a future migration.

ALTER TABLE songs ADD COLUMN orchestra_id TEXT;
ALTER TABLE setlists ADD COLUMN orchestra_id TEXT;
ALTER TABLE practice_lists ADD COLUMN orchestra_id TEXT;
ALTER TABLE wiki_charts ADD COLUMN orchestra_id TEXT;
ALTER TABLE files ADD COLUMN orchestra_id TEXT;

-- Chart instrument tagging (JSON array of IDs at any tier: section, archetype, or specific)
ALTER TABLE files ADD COLUMN instrument_tags TEXT NOT NULL DEFAULT '[]';

-- Role constraint expansion: conductr + guest
-- SQLite can't ALTER CHECK constraints, so we add triggers
CREATE TRIGGER IF NOT EXISTS check_user_role_insert
  BEFORE INSERT ON users
  WHEN NEW.role NOT IN ('owner', 'admin', 'conductr', 'member', 'guest')
BEGIN
  SELECT RAISE(ABORT, 'Invalid role');
END;

CREATE TRIGGER IF NOT EXISTS check_user_role_update
  BEFORE UPDATE OF role ON users
  WHEN NEW.role NOT IN ('owner', 'admin', 'conductr', 'member', 'guest')
BEGIN
  SELECT RAISE(ABORT, 'Invalid role');
END;

-- Indexes for orchestra-scoped queries
CREATE INDEX IF NOT EXISTS idx_songs_orchestra ON songs(orchestra_id);
CREATE INDEX IF NOT EXISTS idx_setlists_orchestra ON setlists(orchestra_id);
CREATE INDEX IF NOT EXISTS idx_practice_orchestra ON practice_lists(orchestra_id);
CREATE INDEX IF NOT EXISTS idx_wiki_charts_orchestra ON wiki_charts(orchestra_id);
CREATE INDEX IF NOT EXISTS idx_files_orchestra ON files(orchestra_id);
