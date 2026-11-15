// eldSimulatedFlow.test.ts — INTEGRATION tests for the ELD
// test-sync ZERO-CONNECTION path (Wave 2 items 4+5 Step 0), run
// against the REAL action handlers over a throwaway migrated
// SQLite database:
//
//   runEldTestSync with NO connection id stands up a dedicated
//   simulated connection (provider "simulated", label "Simulated
//   device", status "simulated", NO token stored) and pushes the
//   simulated payload set through the real applyEldSyncBatch
//   pipeline against it — snapshots stamped simulated, identity
//   landed, batch sealed, creation sealed. A second no-id run
//   reuses the same connection; a revoked simulated connection is
//   replaced by a fresh one; the mirrored official clocks stay
//   null; the premium/manage gates still hold.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-eld-sim-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { eq } = await import("drizzle-orm");

type CtxT = Ctx;

const privStub = async () => ({ ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null });

interface SeededUser {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
}

async function seedUser(username: string, chatName: string, plan = "diamond"): Promise<SeededUser> {
  const db = getDb();
  const email = `${username}@test.local`;
  const acct = await db
    .insert(schema.accounts)
    .values({ email, passwordHash: null, status: "active" })
    .returning({ id: schema.accounts.id });
  const prof = await db
    .insert(schema.profile)
    .values({
      accountId: acct[0]!.id,
      socialUsername: username,
      chatName,
      plan,
      heightFt: 13,
      heightIn: 6,
      weightLbs: 80000,
      lengthFt: 53,
      mpg: 6.5,
      dieselPrice: 3.89,
      tankRangeMi: 1000,
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: chatName });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser | null): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: u
      ? {
          accountId: u.accountId,
          profileId: u.profileId,
          username: u.username,
          email: u.email,
          isOwner: false,
          status: "active",
          totpPending: false,
          hasTeamSeat: false,
          sessionId: 1,
        }
      : null,
  }).ctx as unknown as CtxT;
}

const db = getDb();
const alice = await seedUser("simalice", "Alice A");
const aliceCtx = ctxFor(alice);
let simConnId = 0;

describe("ELD test sync — zero-connection path (Step 0)", () => {
  test("the account starts with zero saved connections", async () => {
    const hub = await Actions.getEldHub.handler(aliceCtx, {});
    expect(hub.connections).toHaveLength(0);
    expect(hub.canManage).toBe(true);
    expect(hub.premium).toBe(true);
  });

  test("a no-id run stands up the simulated connection and syncs through the real pipeline", async () => {
    const r = await Actions.runEldTestSync.handler(aliceCtx, {});
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(6);
    expect(r.rejected).toBe(0);
    expect(r.note).toContain("simulated");

    // Scoped to simulated rows: the suite shares one database
    // across flow files, and other files keep their own (real-
    // provider) connections in it.
    const conns = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "simulated"));
    expect(conns).toHaveLength(1);
    const conn = conns[0]!;
    simConnId = conn.id;
    expect(conn.provider).toBe("simulated");
    expect(conn.label).toBe("Simulated device");
    expect(conn.status).toBe("simulated");
    // No token exists for a device that doesn't exist — none stored.
    expect(conn.tokenEnc).toBeNull();
    expect(conn.tokenLast4).toBeNull();

    // Snapshots landed stamped simulated, like any test sync.
    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, conn.id));
    expect(snaps.map((s) => s.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    for (const s of snaps) {
      expect((JSON.parse(s.payloadJson) as { simulated?: unknown }).simulated).toBe(true);
    }

    // Both the stand-up and the sync sealed into the chain.
    const created = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_simulated_connection_created"));
    expect(created).toHaveLength(1);
    expect(created[0]?.payload).toContain('"simulated":true');
    expect(created[0]?.payload).toContain('"tokenStored":false');
    const synced = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_sync_received")))
      .filter((s) => s.payload.includes(`"connectionId":${simConnId}`));
    expect(synced).toHaveLength(1);
    expect(synced[0]?.payload).toContain('"source":"test_harness"');
  });

  test("the hub shows the simulated connection with received feeds; official surfaces stay clean", async () => {
    const hub = await Actions.getEldHub.handler(aliceCtx, {});
    expect(hub.connections).toHaveLength(1);
    const conn = hub.connections[0]!;
    expect(conn.provider).toBe("simulated");
    expect(conn.providerName).toBe("Simulated ELD");
    expect(conn.status).toBe("simulated");
    expect(conn.tokenMasked).toBeNull();
    expect(conn.feeds.length).toBeGreaterThan(0);
    expect(conn.feeds.every((f) => f.state === "received")).toBe(true);
    expect(conn.feeds.every((f) => f.detail.toLowerCase().includes("simulated"))).toBe(true);
    // Simulated data never becomes the official mirrored record.
    expect(hub.mirroredHos).toBeNull();
    const identity = await Actions.getEldIdentity.handler(aliceCtx, {});
    expect(identity.identity?.driver.name).toBe("Simulated Driver");
  });

  test("a second no-id run reuses the same simulated connection", async () => {
    const r = await Actions.runEldTestSync.handler(aliceCtx, {});
    expect(r.ok).toBe(true);
    const conns = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "simulated"));
    expect(conns).toHaveLength(1);
    const created = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_simulated_connection_created"));
    expect(created).toHaveLength(1);
  });

  test("a revoked simulated connection is replaced by a fresh one on the next no-id run", async () => {
    const revoked = await Actions.revokeEldConnection.handler(aliceCtx, { connectionId: simConnId });
    expect(revoked.ok).toBe(true);
    const r = await Actions.runEldTestSync.handler(aliceCtx, {});
    expect(r.ok).toBe(true);
    const after = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "simulated"));
    expect(after).toHaveLength(2);
    expect(after.filter((c) => c.status === "simulated")).toHaveLength(1);
    expect(after.filter((c) => c.status === "revoked")).toHaveLength(1);
  });

  test("the gates still hold on the no-id path", async () => {
    const basic = await seedUser("simbasic", "Basic B", "basic");
    const r = await Actions.runEldTestSync.handler(ctxFor(basic), {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Diamond");
  });
});
