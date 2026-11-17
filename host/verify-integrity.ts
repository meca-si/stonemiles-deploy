// STONEMILES SENTRY — integrity check CLI (2026-11-17).
//
//   bun run host/verify-integrity.ts                  verify chain + code
//   bun run host/verify-integrity.ts --write-manifest (re)generate the
//                                                     code fingerprint
//
// Chain: recomputed from the database the host is configured for
// (SQLite at STONEMILES_DB / data/app.db by default; Postgres when
// STONEMILES_DIALECT=postgres + DATABASE_URL are set — same getDb
// the server runs). Prints "CHAIN OK" with the entry count, or
// "CHAIN BROKEN" naming the first broken link.
//
// Code: recomputes the fingerprint of host/ + server/src/ +
// bun.lock and diffs it against host/integrity-manifest.json.
// Prints "CODE OK", or "CODE DRIFT" naming every changed / added /
// removed file.
//
// Exit code 0 only when both checks pass (or the manifest was
// written). Designed to run in a deploy pipeline or by hand —
// read-only except in --write-manifest mode.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { STANDALONE_ROOT, getDb } from "./ctx";
import {
  MANIFEST_REL_PATH,
  buildManifest,
  diffManifest,
  manifestIsIntact,
  readManifest,
  verifyChainFromDb,
} from "./integrity";
import * as schema from "../server/src/schema";
import { eq } from "drizzle-orm";

const writeMode = process.argv.includes("--write-manifest");
const manifestAbs = path.join(STANDALONE_ROOT, MANIFEST_REL_PATH);

if (writeMode) {
  const manifest = buildManifest(STANDALONE_ROOT);
  writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `MANIFEST WRITTEN: ${MANIFEST_REL_PATH} — ${Object.keys(manifest.files).length} files fingerprinted`,
  );
  process.exit(0);
}

let ok = true;

// ---- Code ----------------------------------------------------------------
const expected = readManifest(manifestAbs);
if (!expected) {
  console.log(
    `CODE UNKNOWN: no readable manifest at ${MANIFEST_REL_PATH} — generate one with --write-manifest`,
  );
  ok = false;
} else {
  const actual = buildManifest(STANDALONE_ROOT);
  const diff = diffManifest(expected, actual);
  if (manifestIsIntact(diff)) {
    console.log(`CODE OK: ${Object.keys(actual.files).length} files match the shipped fingerprint`);
  } else {
    ok = false;
    console.log("CODE DRIFT: the code on disk is not the code the manifest shipped");
    for (const f of diff.changed) console.log(`  changed: ${f}`);
    for (const f of diff.added) console.log(`  added:   ${f}`);
    for (const f of diff.removed) console.log(`  removed: ${f}`);
  }
}

// ---- Chain ---------------------------------------------------------------
try {
  const db = getDb();
  const verdict = await verifyChainFromDb(db);
  if (verdict.intact) {
    console.log(
      verdict.checked === 0
        ? "CHAIN OK: no sealed records yet (empty chain)"
        : `CHAIN OK: ${verdict.checked} sealed entries verified, head ${verdict.headHash.slice(0, 16)}…`,
    );
  } else {
    ok = false;
    console.log(
      `CHAIN BROKEN: first bad link at entry #${verdict.brokenAtId} (${verdict.brokenReason}) after ${verdict.checked} entries walked`,
    );
    if (verdict.brokenAtId != null) {
      const rows = await db
        .select()
        .from(schema.chainLog)
        .where(eq(schema.chainLog.id, verdict.brokenAtId))
        .limit(1);
      const bad = rows[0];
      if (bad) {
        console.log(
          `  entry: id=${bad.id} ref=${bad.refKind}:${bad.refId ?? "-"} event=${bad.event} sealed=${bad.createdAt.toISOString()}`,
        );
      }
    }
  }
} catch (err) {
  ok = false;
  console.log(
    `CHAIN UNKNOWN: could not read the database (${err instanceof Error ? err.message : String(err)})`,
  );
}

process.exit(ok ? 0 : 1);
