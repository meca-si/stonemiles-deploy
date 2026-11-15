// settlementFlow.test.ts — INTEGRATION tests for the fleet-driver
// settlement view (TMS queue item 2), run against the REAL action
// handlers over a throwaway migrated SQLite database:
//
//   (a) percent basis: a sealed load pays the driver's % of its gross
//       (rate + additional charges), line by line, newest first
//   (b) CPM basis: a sealed load pays CPM × loaded miles
//   (c) only SEALED loads appear — booked loads and voided seals are
//       excluded; a sealed load whose pay can't be figured (no rate
//       on a percent line) still lists, with a null pay and the reason
//   (d) ISOLATION (the pinned rule): a driver never sees another
//       driver's loads or pay — each view contains exactly the
//       caller's own sealed loads
//
// Pure-math coverage lives in settlement.test.ts.
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-settlement-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { desc } = await import("drizzle-orm");

type CtxT = Ctx;

const privStub = async () => ({ ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null });

interface SeededUser {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
}

async function seedUser(
  username: string,
  chatName: string,
  pay: { payBasis: string; driverCpm: number | null; driverPayPct: number | null; companyName: string | null },
): Promise<SeededUser> {
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
      plan: "diamond",
      heightFt: 13,
      heightIn: 6,
      weightLbs: 80000,
      lengthFt: 53,
      mpg: 6.5,
      dieselPrice: 3.89,
      tankRangeMi: 1000,
      payBasis: pay.payBasis,
      driverCpm: pay.driverCpm,
      driverPayPct: pay.driverPayPct,
      companyName: pay.companyName,
    })
    .returning({ id: schema.profile.id });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: {
      accountId: u.accountId,
      profileId: u.profileId,
      username: u.username,
      email: u.email,
      isOwner: false,
      status: "active",
      totpPending: false,
      hasTeamSeat: false,
      sessionId: 1,
    },
  }).ctx as unknown as CtxT;
}

const db = getDb();

// Chain helper — continues from the live head (appendChain's own
// rule: sha256 of "prevHash|event|payload", genesis "GENESIS").
const headRows = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
let chainPrev = headRows[0]?.hash ?? "GENESIS";
const addChain = async (refId: number, event: string, payload: Record<string, unknown>) => {
  const payloadText = JSON.stringify(payload);
  const hash = createHash("sha256").update(`${chainPrev}|${event}|${payloadText}`).digest("hex");
  const rows = await db
    .insert(schema.chainLog)
    .values({ refKind: "load", refId, sessionId: null, event, payload: payloadText, prevHash: chainPrev, hash })
    .returning({ id: schema.chainLog.id });
  chainPrev = hash;
  return rows[0]!.id;
};

async function seedLoad(
  owner: SeededUser,
  fields: { rate: number | null; extraCharges?: number; loadedMiles: number | null; shipper: string },
): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({
      profileId: owner.profileId,
      shipper: fields.shipper,
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      rate: fields.rate,
      extraCharges: fields.extraCharges ?? 0,
      loadedMiles: fields.loadedMiles,
      status: "booked",
    })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

const seal = (loadId: number) => addChain(loadId, "pod_seal", { at: new Date().toISOString(), autoSealed: false });

// Alice: percent-paid (90%) fleet driver.
const alice = await seedUser("setalice", "Alice A", { payBasis: "percent", driverCpm: null, driverPayPct: 90, companyName: "Fleetly" });
const aliceCtx = ctxFor(alice);
const aliceL1 = await seedLoad(alice, { rate: 2000, extraCharges: 200, loadedMiles: 1100, shipper: "Acme Steel" });
await seal(aliceL1);
const aliceUnsealed = await seedLoad(alice, { rate: 5000, extraCharges: 0, loadedMiles: 2000, shipper: "Unsealed Freight Co" });
const aliceNoRate = await seedLoad(alice, { rate: null, extraCharges: 0, loadedMiles: 800, shipper: "No Rate Loads Inc" });
await seal(aliceNoRate);
const aliceVoided = await seedLoad(alice, { rate: 3000, extraCharges: 0, loadedMiles: 1200, shipper: "Voided Ventures" });
await seal(aliceVoided);
await addChain(aliceVoided, "pod_seal_void", { at: new Date().toISOString() });

// Bob: CPM-paid ($0.62/mi) driver in a different fleet.
const bob = await seedUser("setbob", "Bob B", { payBasis: "cpm", driverCpm: 0.62, driverPayPct: null, companyName: "Other Fleet LLC" });
const bobCtx = ctxFor(bob);
const bobL1 = await seedLoad(bob, { rate: 1500, extraCharges: 0, loadedMiles: 1000, shipper: "Bob's Shipper" });
await seal(bobL1);

describe("settlement view — percent basis (Alice)", () => {
  test("sealed loads only, each figured from her 90% of gross", async () => {
    const r = await Actions.getMySettlement.handler(aliceCtx, {});
    expect(r.payBasis).toBe("percent");
    expect(r.driverPayPct).toBe(90);
    expect(r.companyName).toBe("Fleetly");
    const ids = r.lines.map((l) => l.loadId);
    expect(ids).toContain(aliceL1);
    expect(ids).toContain(aliceNoRate);
    expect(ids).not.toContain(aliceUnsealed); // never sealed
    expect(ids).not.toContain(aliceVoided); // seal was voided
    const l1 = r.lines.find((l) => l.loadId === aliceL1)!;
    expect(l1.gross).toBe(2200);
    expect(l1.pay).toBe(1980);
    expect(l1.basisNote).toContain("90% of the load's pay");
    expect(l1.sealedAt).toBeTruthy();
  });

  test("a sealed load with no rate lists honestly — null pay, plain reason, counted unfigured", async () => {
    const r = await Actions.getMySettlement.handler(aliceCtx, {});
    const nr = r.lines.find((l) => l.loadId === aliceNoRate)!;
    expect(nr.pay).toBeNull();
    expect(nr.basisNote).toContain("no rate on file");
    expect(r.figured).toBe(1);
    expect(r.unfigured).toBe(1);
    expect(r.totalPay).toBe(1980);
    expect(r.totalGross).toBe(2200);
  });
});

describe("settlement view — CPM basis (Bob)", () => {
  test("sealed load pays CPM × loaded miles", async () => {
    const r = await Actions.getMySettlement.handler(bobCtx, {});
    expect(r.payBasis).toBe("cpm");
    expect(r.driverCpm).toBe(0.62);
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]!.loadId).toBe(bobL1);
    expect(r.lines[0]!.pay).toBe(620);
    expect(r.totalPay).toBe(620);
  });
});

describe("settlement view — cross-driver isolation (pinned)", () => {
  test("Alice's view contains none of Bob's loads or pay, and Bob's none of Alice's", async () => {
    const a = await Actions.getMySettlement.handler(aliceCtx, {});
    const b = await Actions.getMySettlement.handler(bobCtx, {});
    expect(a.lines.some((l) => l.loadId === bobL1)).toBe(false);
    expect(b.lines.some((l) => l.loadId === aliceL1 || l.loadId === aliceNoRate)).toBe(false);
    // Totals are strictly the caller's own.
    expect(a.totalPay).toBe(1980);
    expect(b.totalPay).toBe(620);
    // No line anywhere carries the other driver's shipper.
    expect(a.lines.some((l) => l.shipper === "Bob's Shipper")).toBe(false);
    expect(b.lines.some((l) => l.shipper === "Acme Steel")).toBe(false);
  });
});
