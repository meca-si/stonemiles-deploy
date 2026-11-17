// integrity.test.ts — coverage for the SENTRY integrity
// verifier (2026-11-17):
//
//   - the manifest diff: identical trees pass; a changed hash, an
//     added file, and a removed file are each named
//   - manifest building over a fixture tree: tests and the
//     manifest itself are excluded, bun.lock is included, hashes
//     are the files' real sha256
//   - the sealed-chain verification over a hermetic migrated
//     SQLite database: a correctly built chain verifies; a
//     tampered payload breaks at that entry (hash_mismatch); a
//     removed entry breaks at the next one (prev_mismatch)
//
// The chain fixture is built with appendChain's exact
// construction (sha256(prevHash | event | payload), genesis
// "GENESIS") over its OWN temp database — never the shared one.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  buildManifest,
  collectCodeFiles,
  diffManifest,
  manifestIsIntact,
  sha256Hex,
  verifyChainFromDb,
  MANIFEST_REL_PATH,
} = await import("./integrity");
const schema = await import("../server/src/schema");

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

describe("integrity — manifest diff", () => {
  const base = {
    version: 1 as const,
    generatedAt: "2026-11-17T00:00:00.000Z",
    files: { "host/a.ts": "aaa", "server/src/b.ts": "bbb", "bun.lock": "ccc" },
  };

  test("identical fingerprints are intact (generatedAt ignored)", () => {
    const same = { ...base, generatedAt: "2027-01-01T00:00:00.000Z", files: { ...base.files } };
    const diff = diffManifest(base, same);
    expect(diff).toEqual({ changed: [], added: [], removed: [] });
    expect(manifestIsIntact(diff)).toBe(true);
  });

  test("changed, added, and removed files are each named", () => {
    const drifted = {
      ...base,
      files: { "host/a.ts": "ZZZ", "server/src/b.ts": "bbb", "host/new.ts": "ddd" },
    };
    const diff = diffManifest(base, drifted);
    expect(diff.changed).toEqual(["host/a.ts"]);
    expect(diff.added).toEqual(["host/new.ts"]);
    expect(diff.removed).toEqual(["bun.lock"]);
    expect(manifestIsIntact(diff)).toBe(false);
  });
});

describe("integrity — manifest building over a fixture tree", () => {
  test("collects host/ + server/src/ + bun.lock, excludes tests and itself", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sm-manifest-"));
    mkdirSync(path.join(root, "host"), { recursive: true });
    mkdirSync(path.join(root, "server", "src"), { recursive: true });
    writeFileSync(path.join(root, "host", "server.ts"), "server code");
    writeFileSync(path.join(root, "host", "sentry.test.ts"), "test code");
    writeFileSync(path.join(root, "host", "integrity-manifest.json"), "{}");
    writeFileSync(path.join(root, "server", "src", "actions.ts"), "actions code");
    writeFileSync(path.join(root, "bun.lock"), "lockfile");

    expect(collectCodeFiles(root)).toEqual([
      "bun.lock",
      "host/server.ts",
      "server/src/actions.ts",
    ]);

    const manifest = buildManifest(root);
    expect(manifest.files["host/server.ts"]).toBe(sha("server code"));
    expect(manifest.files["bun.lock"]).toBe(sha("lockfile"));
    expect(Object.keys(manifest.files)).not.toContain(MANIFEST_REL_PATH);
    expect(sha256Hex("lockfile")).toBe(manifest.files["bun.lock"]);
  });
});

describe("integrity — sealed-chain verification from a database", () => {
  async function fixtureDb() {
    const { createClient } = await import("@libsql/client");
    const { drizzle } = await import("drizzle-orm/libsql");
    const { migrate } = await import("drizzle-orm/libsql/migrator");
    const { STANDALONE_ROOT } = await import("./ctx");
    const dir = mkdtempSync(path.join(tmpdir(), "sm-chain-"));
    const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
    return db;
  }

  async function seedChain(db: Awaited<ReturnType<typeof fixtureDb>>, events: string[]) {
    let prev = "GENESIS";
    const ids: number[] = [];
    for (const event of events) {
      const payload = JSON.stringify({ event, sealed: true });
      const hash = sha(`${prev}|${event}|${payload}`);
      const ins = await db
        .insert(schema.chainLog)
        .values({ refKind: "load", refId: 7, sessionId: null, event, payload, prevHash: prev, hash })
        .returning({ id: schema.chainLog.id });
      ids.push(ins[0]!.id);
      prev = hash;
    }
    return ids;
  }

  test("a correctly built chain verifies end to end", async () => {
    const db = await fixtureDb();
    await seedChain(db, ["pod_seal", "paperwork_filed", "delivery_confirmed"]);
    const v = await verifyChainFromDb(db as never);
    expect(v.intact).toBe(true);
    expect(v.checked).toBe(3);
    expect(v.brokenAtId).toBeNull();
  });

  test("an empty chain is intact with zero checked", async () => {
    const db = await fixtureDb();
    const v = await verifyChainFromDb(db as never);
    expect(v.intact).toBe(true);
    expect(v.checked).toBe(0);
  });

  test("a tampered payload breaks at that entry with hash_mismatch", async () => {
    const db = await fixtureDb();
    const ids = await seedChain(db, ["pod_seal", "paperwork_filed", "delivery_confirmed"]);
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.chainLog)
      .set({ payload: JSON.stringify({ event: "paperwork_filed", sealed: true, rate: 9999 }) })
      .where(eq(schema.chainLog.id, ids[1]!));
    const v = await verifyChainFromDb(db as never);
    expect(v.intact).toBe(false);
    expect(v.brokenAtId).toBe(ids[1]);
    expect(v.brokenReason).toBe("hash_mismatch");
  });

  test("a removed entry breaks at the next one with prev_mismatch", async () => {
    const db = await fixtureDb();
    const ids = await seedChain(db, ["pod_seal", "paperwork_filed", "delivery_confirmed"]);
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.chainLog).where(eq(schema.chainLog.id, ids[1]!));
    const v = await verifyChainFromDb(db as never);
    expect(v.intact).toBe(false);
    expect(v.brokenAtId).toBe(ids[2]);
    expect(v.brokenReason).toBe("prev_mismatch");
  });
});
