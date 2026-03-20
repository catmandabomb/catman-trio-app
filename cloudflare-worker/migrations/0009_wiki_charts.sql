-- Migration 0009: WikiCharts D1 table
-- WikiCharts exist client-side (Store.state.wikiCharts) but have no D1 backing table.
-- Must exist before 0012 adds orchestra_id column.

CREATE TABLE IF NOT EXISTS wiki_charts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '',
  bpm INTEGER NOT NULL DEFAULT 0,
  time_sig TEXT NOT NULL DEFAULT '4/4',
  feel TEXT NOT NULL DEFAULT '',
  sections TEXT NOT NULL DEFAULT '[]',
  structure_tag TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  versions TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wiki_charts_created_by ON wiki_charts(created_by);
