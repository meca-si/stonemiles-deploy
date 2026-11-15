// moneyOverviewFlow.test.ts — INTEGRATION tests for the Money
// Overview action, run against the REAL handler over a throwaway
// migrated SQLite database:
//
//   (a) the overview is computed from the caller's own Pay Book
//       entries (categories classified from the stub labels) and
//       their own SEALED loads' miles — unsealed loads never count
//   (b) ISOLATION (the pinned rule): a driver never sees another
//       driver's pay or miles — each overview contains exactly the
//       caller's own figures
//
// Pure-math coverage lives in moneyOverview.test.ts.
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-money-overview-"));
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

async function seedUser(username: string, chatName: string): Promise<SeededUser> {
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
      payBasis: "cpm",
      driverCpm: 0.62,
      driverPayPct: null,
      companyName: null,
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

// Chain helper — continues from the live head (same pattern as the
// settlement flow tests).
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

const DAY = 86400000;
const now = Date.now();

// Alice: one 1099 paycheck two weeks ago (itemized deductions), one
// sealed load (1,000 loaded + 100 deadhead), one unsealed load.
const alice = await seedUser("ovalice", "Alice A");
const aliceCtx = ctxFor(alice);
await db.insert(schema.payEntries).values({
  username: alice.username,
  kind: "1099",
  isForm: false,
  payer: "Fleetly",
  paidAt: new Date(now - 14 * DAY),
  gross: 4000,
  federalWithheld: 0,
  stateWithheld: 0,
  otherDeductions: 1000,
  deductionLines: JSON.stringify([
    { label: "Fuel", amount: 600 },
    { label: "Escrow", amount: 400 },
  ]),
  perDiem: 0,
});
const aliceSealed = await db
  .insert(schema.loads)
  .values({
    profileId: alice.profileId,
    shipper: "Acme Steel",
    pickupCity: "Mobile",
    pickupState: "AL",
    deliveryCity: "Dallas",
    deliveryState: "TX",
    rate: 4000,
    extraCharges: 0,
    loadedMiles: 1000,
    deadheadMiles: 100,
    status: "booked",
  })
  .returning({ id: schema.loads.id });
await addChain(aliceSealed[0]!.id, "pod_seal", { at: new Date().toISOString(), autoSealed: false });
await db.insert(schema.loads).values({
  profileId: alice.profileId,
  shipper: "Unsealed Freight Co",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
  rate: 9000,
  extraCharges: 0,
  loadedMiles: 5000,
  deadheadMiles: 500,
  status: "booked",
});

// Bob: his own paycheck, no loads — his figures must never touch
// Alice's overview, and hers never his.
const bob = await seedUser("ovbob", "Bob B");
const bobCtx = ctxFor(bob);
await db.insert(schema.payEntries).values({
  username: bob.username,
  kind: "1099",
  isForm: false,
  payer: "Other Fleet LLC",
  paidAt: new Date(now - 7 * DAY),
  gross: 777,
  federalWithheld: 0,
  stateWithheld: 0,
  otherDeductions: 77,
  deductionLines: null,
  perDiem: 0,
});

describe("money overview — the caller's own records", () => {
  test("Alice: YTD from her Pay Book, categories from her stub labels, RPM from her sealed load only", async () => {
    const r = await Actions.getMoneyOverview.handler(aliceCtx, {});
    expect(r.hasData).toBe(true);
    expect(r.ytd.gross).toBe(4000);
    expect(r.ytd.deductions).toBe(1000);
    expect(r.ytd.net).toBe(3000);
    expect(r.keep).toEqual({ kept: 3000, takenOut: 1000 });
    const byCat = new Map(r.categories.map((c) => [c.category, c.amount]));
    expect(byCat.get("Fuel")).toBe(600);
    expect(byCat.get("Escrow")).toBe(400);
    // Sealed load only: 1,000 loaded + 100 deadhead; the unsealed
    // load's 5,500 miles never count.
    expect(r.ytd.miles).toBe(1100);
    expect(r.ytd.grossPerMile).toBe(3.64);
    expect(r.ytd.netPerMile).toBe(2.73);
  });

  test("ISOLATION: Bob's overview holds only Bob's figures", async () => {
    const r = await Actions.getMoneyOverview.handler(bobCtx, {});
    expect(r.ytd.gross).toBe(777);
    expect(r.ytd.deductions).toBe(77);
    expect(r.ytd.miles).toBe(0);
    expect(r.ytd.grossPerMile).toBeNull();
    const byCat = new Map(r.categories.map((c) => [c.category, c.amount]));
    expect(byCat.get("Other")).toBe(77); // unitemized lump — honestly Other
    expect(byCat.has("Fuel")).toBe(false);
  });
});
