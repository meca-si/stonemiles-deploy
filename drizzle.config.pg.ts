// Drizzle Kit config for the POSTGRES migration set (Phase 2a).
// Generates into drizzle-pg/ from the pg-core schema twin.
// The SQLite set in drizzle/ stays the Phase 1 historical record.
//
//   bun x drizzle-kit generate --config drizzle.config.pg.ts
//   bun x drizzle-kit migrate  --config drizzle.config.pg.ts   (needs DATABASE_URL)

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/src/schema-pg.ts",
  out: "./drizzle-pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
