ALTER TABLE loads ADD COLUMN delivery_text TEXT;
--> statement-breakpoint
ALTER TABLE loads ADD COLUMN status TEXT NOT NULL DEFAULT 'booked';
--> statement-breakpoint
ALTER TABLE loads ADD COLUMN doc_sha256 TEXT;
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN auto_route INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN auto_trip INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN auto_alerts INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN auto_fuel INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN auto_seal INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN priority_1 TEXT NOT NULL DEFAULT 'safety';
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN priority_2 TEXT NOT NULL DEFAULT 'net';
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN priority_3 TEXT NOT NULL DEFAULT 'time';
--> statement-breakpoint
ALTER TABLE profile ADD COLUMN pin_hash TEXT;
--> statement-breakpoint
CREATE TABLE intel_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  note TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
