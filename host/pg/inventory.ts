// Phase 2a — source inventory of the seeded SQLite data (on the COPY at
// host/pg/work/source.db). Read-only intent: dumps table list, explicit
// index definitions, triggers, views, and per-table row counts to
// host/pg/work/inventory.json.
//
//   bun run host/pg/inventory.ts

import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const SRC = path.join(ROOT, "host", "pg", "work", "source.db");
const OUT = path.join(ROOT, "host", "pg", "work", "inventory.json");

const client = createClient({ url: `file:${SRC}` });

const master = await client.execute(
  "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
);
const tables: string[] = [];
const explicitIndexes: Array<{ name: string; table: string; sql: string }> = [];
const autoIndexes: string[] = [];
const triggers: Array<{ name: string; table: string }> = [];
const views: string[] = [];
for (const row of master.rows) {
  const type = String(row.type);
  const name = String(row.name);
  if (type === "table" && !name.startsWith("sqlite_")) tables.push(name);
  if (type === "index") {
    if (row.sql == null) autoIndexes.push(name);
    else
      explicitIndexes.push({
        name,
        table: String(row.tbl_name),
        sql: String(row.sql),
      });
  }
  if (type === "trigger") triggers.push({ name, table: String(row.tbl_name) });
  if (type === "view") views.push(name);
}

const rowCounts: Record<string, number> = {};
for (const t of tables) {
  const r = await client.execute(`SELECT COUNT(*) AS n FROM "${t}"`);
  rowCounts[t] = Number(r.rows[0].n);
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      tableCount: tables.length,
      tables,
      rowCounts,
      explicitIndexCount: explicitIndexes.length,
      explicitIndexes,
      autoIndexCount: autoIndexes.length,
      triggers,
      views,
    },
    null,
    2,
  ),
);
console.log(
  `[inventory] ${tables.length} tables, ${explicitIndexes.length} explicit indexes (${explicitIndexes.filter((i) => /UNIQUE/i.test(i.sql)).length} unique), ${autoIndexes.length} auto-indexes, ${triggers.length} triggers, ${views.length} views -> ${OUT}`,
);
const nonEmpty = Object.entries(rowCounts).filter(([, n]) => n > 0);
console.log(
  `[inventory] non-empty tables: ${nonEmpty.length} — ${nonEmpty.map(([t, n]) => `${t}:${n}`).join(", ")}`,
);
client.close();
