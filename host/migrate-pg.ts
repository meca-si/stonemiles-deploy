// One-shot Postgres migration runner for the standalone host (Phase 2a).
//
// Applies the drizzle-pg/ migration set (generated from
// server/src/schema-pg.ts by drizzle-kit) via
// drizzle-orm/node-postgres/migrator, then applies
// host/pg/index-parity.sql (the standalone indexes the schema does not
// declare — see that file's header). Safe to re-run: the migrator is
// journal-aware and the index statements are IF NOT EXISTS.
//
// Self-contained: builds its own node-postgres Drizzle handle from
// DATABASE_URL and never touches the SQLite path.
//
//   DATABASE_URL=postgres://… bun run host/migrate-pg.ts

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import * as pgSchema from "../server/src/schema-pg";
import { STANDALONE_ROOT } from "./ctx";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate-pg] DATABASE_URL is not set — aborting");
  process.exit(1);
}

const migrationsFolder = path.join(STANDALONE_ROOT, "drizzle-pg");
console.log(`[migrate-pg] migrations: ${migrationsFolder}`);

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
  const db = drizzle(pool, { schema: pgSchema });
  await migrate(db, { migrationsFolder });
  console.log("[migrate-pg] drizzle migrations applied");

  const paritySql = readFileSync(
    path.join(STANDALONE_ROOT, "host", "pg", "index-parity.sql"),
    "utf8",
  );
  const statements = paritySql
    .split("\n")
    .filter((l) => l.startsWith("CREATE "))
    .map((l) => l.trim());
  for (const stmt of statements) {
    await pool.query(stmt);
  }
  console.log(`[migrate-pg] index parity applied (${statements.length} indexes)`);
} finally {
  await pool.end();
}
console.log("[migrate-pg] done");
process.exit(0);
