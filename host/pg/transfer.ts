// Phase 2a — table-by-table data move, SQLite -> Postgres.
//
// Source: a COPY of the seeded live DB (default host/pg/work/source.db;
// the seeded data/app.db is never opened by this script). Target: the
// Postgres database in DATABASE_URL, already migrated by
// host/migrate-pg.ts (target tables must be EMPTY — the script aborts
// otherwise, so a half-finished move can't be silently doubled).
//
// Conversions (driven by the pg-core schema twin, per column):
//   PgBoolean         SQLite integer 0/1        -> boolean
//   PgTimestamp       SQLite integer ms-epoch   -> Date (timestamptz)
//   PgDoublePrecision SQLite REAL               -> number (float8, lossless)
//   PgInteger/PgSerial integer                 -> integer (range-checked)
//   PgText            text                      -> text (exact bytes)
//
// Anything that does not fit its target type is recorded as an anomaly
// (table, column, row id, value) in host/pg/work/transfer-result.json;
// anomalies ABORT the run before any insert (exit 2) unless they are in
// the safe-coercion set (integral float -> integer col, number -> text
// col), which are coerced and still recorded.
//
// Excluded source tables (documented in PHASE2A-REPORT.md):
//   __drizzle_migrations — journal of the SQLite set; the PG side has
//                          its own journal from drizzle-pg/.
//   entries              — 0001_initial scaffold table, 0 rows, absent
//                          from the schema, never referenced by actions.
//
// After inserts, every serial sequence is reset to MAX(id) so the app's
// next autoincrement continues where the SQLite data left off.
//
//   DATABASE_URL=postgres://… bun run host/pg/transfer.ts
//
// Phase 2 merge (auth Phase 2b): the pg schema now also carries the auth
// tables and the profile_id scoping columns, which the seeded SQLite
// source predates. Handled explicitly below:
//   - TARGET_ONLY_TABLES: pg tables with no source counterpart. They
//     start empty on Postgres by design (accounts are created by the
//     owner claim; sessions/tokens/invites are re-issued at cutover —
//     AUTH-DESIGN.md §9 step 7). Skipped, and listed in the result file.
//   - PG_ONLY_COLUMNS: pg columns with no source column (profile_id on
//     the 28 scoped tables, profile.account_id). Inserted as NULL, then
//     profile_id is backfilled to the owner profile (id 1), mirroring
//     the backfill UPDATEs in the SQLite migration drizzle/0108.

import { createClient } from "@libsql/client";
import { getTableConfig } from "drizzle-orm/pg-core";
import { writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import * as pgSchema from "../../server/src/schema-pg";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const SOURCE_DB =
  process.env.SOURCE_DB ?? path.join(ROOT, "host", "pg", "work", "source.db");
const DATABASE_URL = process.env.DATABASE_URL;
const RESULT_PATH = path.join(ROOT, "host", "pg", "work", "transfer-result.json");

if (!DATABASE_URL) {
  console.error("[transfer] DATABASE_URL is not set — aborting");
  process.exit(1);
}

const EXCLUDED = new Set(["__drizzle_migrations", "entries"]);

// Legacy columns present in the live DB but removed from the declared
// schema by a later refactor (no DROP migration was ever written). They
// are knowingly NOT carried: no action reads them (grep-verified), and
// adding them to the pg twin would diverge it from the app's schema.
// Their live values are captured into the result file before the move,
// so the drop is on record, never silent. Any OTHER parity mismatch
// still aborts the run.
const KNOWN_DROPS: Record<string, string[]> = {
  // migration 0030's original base welcome-credit column; superseded by
  // the per-tier welcome_credit_{gold,diamond,owner}_stoner columns.
  admin_settings: ["welcome_credit_stoner"],
};

const TARGET_ONLY_TABLES = new Set([
  "accounts",
  "auth_sessions",
  "password_reset_tokens",
  "account_invites",
  "auth_audit_log",
  "auth_mail_queue",
  "auth_activity_days",
]);

const SCOPED_TABLES = [
  "breakdown_logs", "claim_events", "dvir_reports", "eld_connections",
  "eld_identity", "eld_snapshots", "expenses", "filed_doc_copies",
  "fleet_trucks", "fuel_purchases", "load_doc_exceptions",
  "load_doc_extractions", "load_doc_verifications", "load_payments",
  "loads", "maintenance_services", "payment_packets", "personal_docs",
  "pickup_extra_photos", "pretrip_inspections", "recent_destinations",
  "reefer_checks", "saved_places", "scale_tickets", "settlements",
  "trailer_swaps", "trip_queue", "trips",
];

const PG_ONLY_COLUMNS: Record<string, string[]> = {
  profile: ["account_id"],
  ...Object.fromEntries(SCOPED_TABLES.map((t) => [t, ["profile_id"]])),
};

interface Anomaly {
  table: string;
  column: string;
  rowId: unknown;
  value: string;
  kind: string;
  coerced: boolean;
}

const anomalies: Anomaly[] = [];
const MS_MIN = Date.UTC(2000, 0, 1);
const MS_MAX = Date.UTC(2100, 0, 1);

function describe(v: unknown): string {
  if (v === null) return "null";
  if (v instanceof Uint8Array) return `<bytes ${v.byteLength}>`;
  const s = typeof v === "string" ? v : String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** Convert one source value for its pg column type. Records anomalies. */
function convert(
  table: string,
  column: string,
  columnType: string,
  rowId: unknown,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null;
  const bad = (kind: string, coerced: boolean, out: unknown): unknown => {
    anomalies.push({
      table,
      column,
      rowId,
      value: describe(value),
      kind,
      coerced,
    });
    return out;
  };
  switch (columnType) {
    case "PgBoolean": {
      if (value === 0 || value === false) return false;
      if (value === 1 || value === true) return true;
      return bad("boolean-not-0/1", false, null);
    }
    case "PgTimestamp": {
      if (typeof value === "number" && Number.isInteger(value)) {
        if (value < MS_MIN || value > MS_MAX)
          return bad("timestamp-ms-out-of-range", false, null);
        return new Date(value);
      }
      return bad("timestamp-not-integer-ms", false, null);
    }
    case "PgDoublePrecision": {
      if (typeof value === "number") return value;
      if (typeof value === "bigint") return bad("bigint-to-double", true, Number(value));
      return bad("real-not-number", false, null);
    }
    case "PgInteger":
    case "PgSerial": {
      if (typeof value === "number") {
        if (Number.isInteger(value)) {
          if (value < -2147483648 || value > 2147483647)
            return bad("integer-out-of-int4-range", false, null);
          return value;
        }
        return bad("float-in-integer-column", false, null);
      }
      if (typeof value === "bigint") {
        const n = Number(value);
        if (Number.isSafeInteger(n) && n >= -2147483648 && n <= 2147483647)
          return bad("bigint-in-integer-column", true, n);
        return bad("bigint-out-of-int4-range", false, null);
      }
      return bad("integer-not-number", false, null);
    }
    case "PgText": {
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "bigint")
        return bad("number-in-text-column", true, String(value));
      if (value instanceof Uint8Array)
        return bad("bytes-in-text-column", false, null);
      return bad("text-unexpected-type", false, null);
    }
    default:
      return bad(`unknown-column-type-${columnType}`, false, null);
  }
}

// ---------------------------------------------------------------------------
// Preflight: column parity between source tables and the pg schema twin.
// ---------------------------------------------------------------------------

const source = createClient({ url: `file:${SOURCE_DB}` });

interface TablePlan {
  exportName: string;
  table: string;
  columns: Array<{ dbName: string; columnType: string; isSerial: boolean }>;
}

const plans: TablePlan[] = [];
for (const [exportName, tableObj] of Object.entries(pgSchema)) {
  const cfg = getTableConfig(tableObj as never);
  plans.push({
    exportName,
    table: cfg.name,
    columns: cfg.columns.map((c) => ({
      dbName: c.name,
      columnType: (c as { columnType: string }).columnType,
      isSerial: (c as { columnType: string }).columnType === "PgSerial",
    })),
  });
}
plans.sort((a, b) => (a.table < b.table ? -1 : 1));

const sourceTablesRes = await source.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
);
const sourceTables = new Set(sourceTablesRes.rows.map((r) => String(r.name)));

const targetOnlyTables: string[] = [];
for (let i = plans.length - 1; i >= 0; i--) {
  if (TARGET_ONLY_TABLES.has(plans[i].table) && !sourceTables.has(plans[i].table)) {
    targetOnlyTables.push(plans[i].table);
    plans.splice(i, 1);
  }
}
targetOnlyTables.sort();
if (targetOnlyTables.length > 0) {
  console.log(
    `[transfer] target-only tables (start empty on pg, by design): ${targetOnlyTables.join(", ")}`,
  );
}

const parityProblems: string[] = [];
const droppedLegacyColumns: Array<{
  table: string;
  column: string;
  values: Array<{ id: unknown; value: unknown }>;
}> = [];
for (const plan of plans) {
  if (!sourceTables.has(plan.table)) {
    parityProblems.push(`table ${plan.table}: in pg schema, missing in source`);
    continue;
  }
  const pragma = await source.execute(`PRAGMA table_info("${plan.table}")`);
  const srcCols = pragma.rows.map((r) => String(r.name)).sort();
  const pgCols = plan.columns.map((c) => c.dbName).sort();
  const extraInSource = srcCols.filter((c) => !pgCols.includes(c));
  const missingInSource = pgCols.filter((c) => !srcCols.includes(c));
  const knownDrops = KNOWN_DROPS[plan.table] ?? [];
  const pgOnly = PG_ONLY_COLUMNS[plan.table] ?? [];
  const unexplained = extraInSource.filter((c) => !knownDrops.includes(c));
  const unexplainedMissing = missingInSource.filter((c) => !pgOnly.includes(c));
  if (unexplained.length > 0 || unexplainedMissing.length > 0) {
    parityProblems.push(
      `table ${plan.table}: column mismatch source=[${srcCols}] pg=[${pgCols}]`,
    );
    continue;
  }
  for (const col of extraInSource) {
    const vals = await source.execute(
      `SELECT id, "${col}" AS v FROM "${plan.table}"`,
    );
    droppedLegacyColumns.push({
      table: plan.table,
      column: col,
      values: vals.rows.map((r) => ({ id: r.id, value: r.v })),
    });
    console.log(
      `[transfer] known legacy drop: ${plan.table}.${col} (values recorded in result file)`,
    );
  }
}
for (const t of sourceTables) {
  if (!plans.some((p) => p.table === t) && !EXCLUDED.has(t)) {
    parityProblems.push(`table ${t}: in source, not in pg schema, not excluded`);
  }
}
if (parityProblems.length > 0) {
  console.error("[transfer] PREFLIGHT FAILED:");
  for (const p of parityProblems) console.error(`  - ${p}`);
  process.exit(2);
}
console.log(
  `[transfer] preflight ok: ${plans.length} tables, columns match source (pg-only columns allowlisted: profile.account_id + profile_id x${SCOPED_TABLES.length})`,
);

// FK order: parse REFERENCES edges from the generated PG migration so
// referenced tables are inserted before their dependents.
const { readFileSync } = await import("node:fs");
const { readdirSync } = await import("node:fs");
const migrationSql = readdirSync(path.join(ROOT, "drizzle-pg"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(ROOT, "drizzle-pg", f), "utf8"))
  .join("\n");
const fkEdges: Array<[string, string]> = []; // [dependent, referenced]
for (const m of migrationSql.matchAll(
  /ALTER TABLE "([a-z0-9_]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("[^"]+"\) REFERENCES "public"\."([a-z0-9_]+)"/g,
)) {
  fkEdges.push([m[1], m[2]]);
}
if (fkEdges.length > 0) {
  const order = new Map(plans.map((p, i) => [p.table, i]));
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 50) {
    moved = false;
    for (const [dep, ref] of fkEdges) {
      if ((order.get(dep) ?? 0) < (order.get(ref) ?? 0)) {
        const depPlan = plans.splice(plans.findIndex((p) => p.table === dep), 1)[0];
        plans.splice(plans.findIndex((p) => p.table === ref) + 1, 0, depPlan);
        plans.forEach((p, i) => order.set(p.table, i));
        moved = true;
      }
    }
  }
  console.log(
    `[transfer] fk order applied: ${fkEdges.map(([d, r]) => `${d}->${r}`).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Convert everything in memory first; abort on non-coercible anomalies
// before a single row is inserted.
// ---------------------------------------------------------------------------

interface PreparedTable {
  plan: TablePlan;
  sourceRows: number;
  rows: unknown[][];
}

const prepared: PreparedTable[] = [];
for (const plan of plans) {
  const res = await source.execute(`SELECT * FROM "${plan.table}"`);
  const colIndex = new Map(res.columns.map((c, i) => [c, i]));
  const rows: unknown[][] = [];
  for (const row of res.rows) {
    const idIdx = colIndex.get("id");
    const rowId = idIdx !== undefined ? row[idIdx] : null;
    rows.push(
      plan.columns.map((col) =>
        convert(
          plan.table,
          col.dbName,
          col.columnType,
          rowId,
          row[colIndex.get(col.dbName)!],
        ),
      ),
    );
  }
  prepared.push({ plan, sourceRows: res.rows.length, rows });
}

const hardAnomalies = anomalies.filter((a) => !a.coerced);
if (hardAnomalies.length > 0) {
  console.error(
    `[transfer] ABORT: ${hardAnomalies.length} value(s) do not fit their Postgres types:`,
  );
  for (const a of hardAnomalies.slice(0, 25)) {
    console.error(
      `  - ${a.table}.${a.column} row=${String(a.rowId)} value=${a.value} (${a.kind})`,
    );
  }
  writeFileSync(
    RESULT_PATH,
    JSON.stringify(
      { phase: "aborted-pre-insert", anomalies, droppedLegacyColumns },
      null,
      2,
    ),
  );
  process.exit(2);
}
if (anomalies.length > 0) {
  console.log(
    `[transfer] ${anomalies.length} safe coercion(s) recorded (see result file)`,
  );
} else {
  console.log("[transfer] value validation clean: 0 anomalies");
}

// ---------------------------------------------------------------------------
// Insert, per-table transaction, then reset serial sequences.
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const results: Array<{
  table: string;
  sourceRows: number;
  targetRows: number;
  ok: boolean;
}> = [];

const profileIdBackfill: Array<{ table: string; updated: number }> = [];
const client = await pool.connect();
try {
  for (const { plan, sourceRows, rows } of prepared) {
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM "${plan.table}"`,
    );
    if (countRes.rows[0].n !== 0) {
      throw new Error(
        `target table ${plan.table} is not empty (${countRes.rows[0].n} rows) — aborting to avoid a doubled move`,
      );
    }
    await client.query("BEGIN");
    try {
      const colList = plan.columns.map((c) => `"${c.dbName}"`).join(", ");
      for (let i = 0; i < rows.length; i++) {
        const placeholders = plan.columns.map((_, j) => `$${j + 1}`).join(", ");
        await client.query(
          `INSERT INTO "${plan.table}" (${colList}) VALUES (${placeholders})`,
          rows[i] as unknown[],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    const after = await client.query(
      `SELECT COUNT(*)::int AS n FROM "${plan.table}"`,
    );
    const targetRows = after.rows[0].n as number;
    results.push({
      table: plan.table,
      sourceRows,
      targetRows,
      ok: targetRows === sourceRows,
    });
    if (targetRows !== sourceRows) {
      throw new Error(
        `row count mismatch on ${plan.table}: source ${sourceRows}, target ${targetRows}`,
      );
    }
  }

  // Serial sequences: continue autoincrement where SQLite left off.
  let sequencesReset = 0;
  for (const { plan } of prepared) {
    for (const col of plan.columns) {
      if (!col.isSerial) continue;
      await client.query(
        `SELECT setval(pg_get_serial_sequence('"${plan.table}"', '${col.dbName}'),
                COALESCE((SELECT MAX("${col.dbName}") FROM "${plan.table}"), 1),
                (SELECT COUNT(*) > 0 FROM "${plan.table}"))`,
      );
      sequencesReset++;
    }
  }
  console.log(`[transfer] serial sequences reset: ${sequencesReset}`);

  // profile_id backfill (mirrors drizzle/0108 on the SQLite side): every
  // pre-auth row belongs to the owner profile, id 1.
  for (const t of SCOPED_TABLES) {
    const r = await client.query(
      `UPDATE "${t}" SET profile_id = 1 WHERE profile_id IS NULL`,
    );
    profileIdBackfill.push({ table: t, updated: r.rowCount ?? 0 });
  }
  const backfilled = profileIdBackfill.reduce((n, r) => n + r.updated, 0);
  console.log(
    `[transfer] profile_id backfill: ${backfilled} row(s) set to profile 1 across ${SCOPED_TABLES.length} tables`,
  );
} finally {
  client.release();
  await pool.end();
}

const totalSource = results.reduce((s, r) => s + r.sourceRows, 0);
const totalTarget = results.reduce((s, r) => s + r.targetRows, 0);
writeFileSync(
  RESULT_PATH,
  JSON.stringify(
    {
      phase: "complete",
      sourceDb: SOURCE_DB,
      tables: results,
      totalSource,
      totalTarget,
      anomalies,
      droppedLegacyColumns,
      targetOnlyTables,
      pgOnlyColumns: PG_ONLY_COLUMNS,
      profileIdBackfill,
    },
    null,
    2,
  ),
);
console.log(
  `[transfer] DONE: ${results.length} tables, ${totalTarget}/${totalSource} rows -> ${RESULT_PATH}`,
);
source.close();
process.exit(0);
