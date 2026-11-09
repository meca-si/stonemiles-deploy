// One-shot migration runner for the standalone host's scratch DB.
//
// Applies the app's drizzle/ migrations (SQLite dialect) to data/app.db
// (or $STONEMILES_DB) via drizzle-orm/libsql/migrator. Only needed when no
// live app.db copy was seeded — see host/seed-notes.md. Safe to re-run:
// drizzle records applied migrations in its journal table.
//
//   bun run host/migrate.ts

import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import { DB_PATH, STANDALONE_ROOT, getDb } from "./ctx";

const migrationsFolder = path.join(STANDALONE_ROOT, "drizzle");

console.log(`[migrate] db: ${DB_PATH}`);
console.log(`[migrate] migrations: ${migrationsFolder}`);
await migrate(getDb(), { migrationsFolder });
console.log("[migrate] done");
process.exit(0);
