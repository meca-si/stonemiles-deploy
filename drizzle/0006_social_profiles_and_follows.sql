ALTER TABLE profile ADD COLUMN social_username TEXT NOT NULL DEFAULT 'driver';
--> statement-breakpoint
CREATE TABLE social_users (
  username TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  company TEXT,
  truck_info TEXT,
  home_city TEXT,
  home_state TEXT,
  avatar_blob_key TEXT,
  avatar_mime TEXT,
  dm_policy TEXT NOT NULL DEFAULT 'everyone',
  group_policy TEXT NOT NULL DEFAULT 'everyone',
  show_reputation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower TEXT NOT NULL,
  followee TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE social_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
