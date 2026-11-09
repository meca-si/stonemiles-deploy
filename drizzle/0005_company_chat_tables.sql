ALTER TABLE profile ADD COLUMN chat_name TEXT NOT NULL DEFAULT 'Driver';
--> statement-breakpoint
CREATE TABLE chat_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'group',
  created_by TEXT NOT NULL DEFAULT 'driver',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  username TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_reads (
  group_id INTEGER PRIMARY KEY,
  last_read_id INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE chat_blocks (
  username TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
