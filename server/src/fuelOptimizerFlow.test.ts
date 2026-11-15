// fuelOptimizerFlow.test.ts — INTEGRATION tests for the route
// fuel optimizer + fuel-card geofence checks (Wave 2 item 8),
// run against the REAL action handlers over a throwaway migrated
// SQLite database:
//
//   (a) planFuelStops: Diamond gets a full ex-tax plan; a Basic
//       account gets the locked shape and no plan
//   (b) getFuelCardChecks evaluates the driver's logged purchases
//       against the truck's recorded track: a purchase at the
//       truck's position matches, one ~230 mi away flags, one
//       whose station has no location on file is not_checked
//   (c) the flag opens exactly ONE fuel_card_mismatch exception
//       (episode-deduped across re-runs) + an in-app notification
//       carrying the evidence — and surfaces in the exception
//       queue with its check-it label
//   (d) with no fuel-card partner configured, the panel reports
//       partnerConfigured false — the checks ran on the logged
//       purchases alone
//
// Pure-rule coverage lives in fuelOptimizer.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-fuel-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.FUEL_CARD_API_KEY;
delete process.env.FUEL_CARD_BASE_URL;

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

async function seedUser(username: string, chatName: string, plan: string): Promise<SeededUser> {
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

const NOW = Date.now();
const MIN = 60000;
// The truck sits in Mobile, AL the whole morning.
const MOBILE = { lat: 30.6944, lon: -88.0431 };
// Birmingham, AL — ~230 mi away.
const FAR = { lat: 33.5207, lon: -86.8025 };

const diamond = await seedUser("fuelexpert", "Fuel Expert", "diamond");
const basic = await seedUser("fuelbasic", "Fuel Basic", "basic");
const dctx = ctxFor(diamond);

const db = getDb();
// Truck track: readings before every purchase, inside the
// freshness window.
for (const agoMin of [120, 90, 20]) {
  await db.insert(schema.trackPoints).values({
    username: diamond.username,
    lat: MOBILE.lat,
    lon: MOBILE.lon,
    recordedAt: new Date(NOW - agoMin * MIN),
  });
}
// Station locations on file, from the shared price layer.
await db.insert(schema.fuelPriceReports).values([
  {
    station: "Love's #412",
    state: "Alabama",
    lat: MOBILE.lat,
    lon: MOBILE.lon,
    price: 3.9,
    reportedAt: new Date(NOW - 24 * 60 * MIN),
    grade: "reported",
  },
  {
    station: "Faraway Fuel",
    state: "Alabama",
    lat: FAR.lat,
    lon: FAR.lon,
    price: 4.1,
    reportedAt: new Date(NOW - 24 * 60 * MIN),
    grade: "reported",
  },
]);

async function logPurchase(station: string, agoMin: number, gallons: number, price: number) {
  return Actions.logFuelPurchase.handler(dctx, {
    purchasedAt: new Date(NOW - agoMin * MIN).toISOString(),
    state: "Alabama",
    station,
    gallons,
    pricePerGallon: price,
    odometer: null,
    notes: null,
    receiptDataBase64: null,
    receiptMime: null,
  });
}

const nearPurchase = await logPurchase("Love's #412", 60, 50, 3.95);
const farPurchase = await logPurchase("Faraway Fuel", 45, 40, 4.1);
await logPurchase("No Location Stop", 30, 25, 4.0);

describe("planFuelStops — Diamond plans, Basic is locked out of the math", () => {
  const planArgs = {
    totalMiles: 600,
    segments: [
      { state: "Texas", miles: 300 },
      { state: "Illinois", miles: 300 },
    ],
    stops: [
      { id: "tx", name: "Texas Stop", state: "Texas", alongMi: 100, price: 3.9, priceSource: "your fuel log · Nov 10" },
      { id: "il", name: "Illinois Stop", state: "Illinois", alongMi: 400, price: 4.3, priceSource: "reported 1d ago by a driver" },
    ],
    mpg: 10,
    tankCapacityGal: 120,
    startGallons: 30,
    reserveGallons: 10,
  };

  test("Diamond gets the ex-tax plan with the savings estimate", async () => {
    const res = await Actions.planFuelStops.handler(dctx, planArgs);
    expect(res.locked).toBe(false);
    expect(res.result).not.toBeNull();
    expect(res.result!.purchases.map((p) => p.stopId)).toEqual(["tx", "il"]);
    expect(res.result!.savingsEstimate).toBe(2.76);
    expect(res.result!.ratesAsOf).toContain("4th quarter 2026");
  });

  test("Basic gets the locked shape — no plan, no rates at work", async () => {
    const res = await Actions.planFuelStops.handler(ctxFor(basic), planArgs);
    expect(res.locked).toBe(true);
    expect(res.result).toBeNull();
  });
});

describe("getFuelCardChecks — purchases vs the truck's recorded position", () => {
  test("match / mismatch / not_checked, partner honestly unconfigured", async () => {
    const res = await Actions.getFuelCardChecks.handler(dctx, {});
    expect(res.partnerConfigured).toBe(false);
    expect(res.partnerName).toBeNull();
    expect(res.thresholdMi).toBe(25);
    expect(res.checks).toHaveLength(3);
    const byStation = new Map(res.checks.map((c) => [c.station, c]));
    expect(byStation.get("Love's #412")!.status).toBe("match");
    expect(byStation.get("Love's #412")!.purchaseId).toBe(nearPurchase.id);
    const far = byStation.get("Faraway Fuel")!;
    expect(far.status).toBe("mismatch");
    expect(far.purchaseId).toBe(farPurchase.id);
    expect(far.distanceMi!).toBeGreaterThan(200);
    expect(byStation.get("No Location Stop")!.status).toBe("not_checked");
    expect(res.flaggedCount).toBe(1);
  });

  test("the flag opened one exception + one notification, with evidence", async () => {
    const rows = await db
      .select()
      .from(schema.autoExceptions)
      .where(eq(schema.autoExceptions.kind, "fuel_card_mismatch"));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.loadId).toBe(farPurchase.id);
    expect(row.dedupeKey).toBe(`fuel:${farPurchase.id}:fuel_card_mismatch`);
    expect(row.status).toBe("open");
    expect(row.detail).toContain("Possible mismatch — check it");
    expect(row.detail).toContain("Nothing was declined, blocked, or changed");
    const evidence = JSON.parse(row.evidenceJson ?? "[]") as Array<{ kind: string }>;
    expect(evidence.map((e) => e.kind)).toEqual(["position", "snapshot"]);

    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.username, diamond.username));
    const flag = notes.find((n) => n.dedupeKey === `exception:${row.id}`);
    expect(flag).toBeTruthy();
    expect(flag!.title).toContain("possible card mismatch");
    expect(flag!.refKind).toBe("fuel_purchase");
    expect(flag!.refId).toBe(farPurchase.id);
  });

  test("re-running the checks does not duplicate the flag", async () => {
    const res = await Actions.getFuelCardChecks.handler(dctx, {});
    expect(res.flaggedCount).toBe(1);
    const rows = await db
      .select()
      .from(schema.autoExceptions)
      .where(eq(schema.autoExceptions.kind, "fuel_card_mismatch"));
    expect(rows).toHaveLength(1);
  });

  test("the flag surfaces in the exception queue with its check-it label", async () => {
    const queue = await Actions.getExceptionQueue.handler(dctx, {});
    const item = queue.items.find((i) => i.kind === "fuel_card_mismatch");
    expect(item).toBeTruthy();
    expect(item!.kindLabel).toBe("Fuel purchase far from the truck — check it");
    expect(item!.detail).toContain("Possible mismatch — check it");
  });

  test("another driver sees none of it — checks and queue are the caller's own", async () => {
    const bctx = ctxFor(basic);
    const res = await Actions.getFuelCardChecks.handler(bctx, {});
    expect(res.checks).toHaveLength(0);
    expect(res.flaggedCount).toBe(0);
    const queue = await Actions.getExceptionQueue.handler(bctx, {});
    expect(queue.items.find((i) => i.kind === "fuel_card_mismatch")).toBeUndefined();
  });
});
