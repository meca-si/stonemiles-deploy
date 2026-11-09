CREATE TABLE profile (
  id INTEGER PRIMARY KEY,
  height_ft INTEGER NOT NULL,
  height_in INTEGER NOT NULL,
  weight_lbs INTEGER NOT NULL,
  length_ft INTEGER NOT NULL,
  mpg REAL NOT NULL,
  diesel_price REAL NOT NULL,
  tank_range_mi INTEGER NOT NULL,
  loves_off INTEGER NOT NULL DEFAULT 0,
  pilot_off INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  total_miles REAL NOT NULL,
  total_pay REAL NOT NULL,
  state_breakdown TEXT NOT NULL,
  destination TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipper TEXT,
  pickup_city TEXT,
  pickup_state TEXT,
  delivery_city TEXT,
  delivery_state TEXT,
  pickup_text TEXT,
  rate REAL,
  weight_lbs INTEGER,
  commodity TEXT,
  doc_blob_key TEXT,
  doc_mime TEXT,
  created_at INTEGER NOT NULL
);
