-- 0015: Orchestra messaging (member-to-conductr)
CREATE TABLE IF NOT EXISTS orchestra_messages (
  id TEXT PRIMARY KEY,
  orchestra_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_username TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'open',
  parent_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_msg_orchestra ON orchestra_messages(orchestra_id, status);
CREATE INDEX IF NOT EXISTS idx_msg_sender ON orchestra_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_msg_parent ON orchestra_messages(parent_id);
