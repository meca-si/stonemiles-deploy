// Owner claim CLI (AUTH-DESIGN.md §3.2) — operator-only, run ON the
// server. NOT an HTTP endpoint.
//
//   bun run host/auth-claim.ts --arm --email owner@example.com
//
// Creates the owner's invited account (profile 1 unbound, no owner yet —
// refuses otherwise), mints the one-time claim token, stores only its
// SHA-256 hash (24h TTL, single-use), and prints the token ONCE to this
// terminal. The token is never written to a file, a log, or an email —
// hand it to the owner out-of-band; he enters it with his email and a
// NEW password of his own choosing on the /auth/claim page. There is no
// default password at any point in this flow.

import { armOwnerClaim } from "./auth";
import path from "node:path";
import { DIALECT, STANDALONE_ROOT, getDb } from "./ctx";

const args = process.argv.slice(2);
const emailFlag = args.indexOf("--email");
const email = emailFlag >= 0 ? args[emailFlag + 1] : undefined;
if (!args.includes("--arm") || !email) {
  console.error("usage: bun run host/auth-claim.ts --arm --email <owner-email>");
  process.exit(2);
}

// Migrations first (idempotent), in the active dialect: Postgres applies
// the drizzle-pg/ set + index parity (same code path as host/migrate-pg.ts,
// imported lazily so the SQLite path never loads it); SQLite applies the
// drizzle/ set via the libsql migrator, unchanged from the auth build.
if (DIALECT === "postgres") {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { readFileSync } = await import("node:fs");
  const pg = (await import("pg")).default;
  const pgSchema = await import("../server/src/schema-pg");
  const { DATABASE_URL } = await import("./ctx");
  if (!DATABASE_URL) {
    console.error("[auth-claim] DATABASE_URL is not set — aborting");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    const db = drizzle(pool, { schema: pgSchema });
    await migrate(db, {
      migrationsFolder: path.join(STANDALONE_ROOT, "drizzle-pg"),
    });
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
  } finally {
    await pool.end();
  }
} else {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  await migrate(getDb(), {
    migrationsFolder: path.join(STANDALONE_ROOT, "drizzle"),
  });
}
const token = await armOwnerClaim(email);
console.log("");
console.log("OWNER CLAIM ARMED — token printed ONCE, shown only here:");
console.log("");
console.log(`  ${token}`);
console.log("");
console.log("The owner opens /auth/claim, enters this token + the same email,");
console.log("and sets his own password. Expires in 24 hours; single use.");
console.log("Re-running --arm supersedes any unused claim token.");
process.exit(0);
