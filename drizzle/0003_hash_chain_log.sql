CREATE TABLE chain_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_kind TEXT NOT NULL,
  ref_id INTEGER,
  session_id TEXT,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
