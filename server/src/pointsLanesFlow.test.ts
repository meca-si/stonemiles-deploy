// pointsLanesFlow.test.ts — INTEGRATION tests for the three SM Points
// earning lanes (locked by x, 2026-11-15), run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   Lane 1 — miles milestone pays once (idempotent); on-time streak
//     block pays, and voiding a seal in the run reverses it; a clean
//     inspection day pays; a zero-violation HOS week pays while a
//     12h-driving week does not.
//   Lane 2 — a solo report earns nothing; a second driver's
//     consistent report pays BOTH reporters; a GPS confirm pays the
//     reporter; self-confirmation pays nothing; a contradicted spot
//     pays nothing; fuel prices corroborate the same way; the daily
//     Lane 2 award cap holds.
//   Lane 3 — a poster referral pays only when the referred shipper's
//     first load reaches a board (not at signup); an unknown code is
//     ignored; the first sealed load on a lane pays its sealer only,
//     and voiding that seal reverses the award and frees the lane;
//     Founding Tester completion pays.
//   Gates — a Basic-plan driver and a comped fleet-included driver
//     earn NO lane points even with qualifying records.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-lanes-"));
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

const privStub = async () => ({
  ok: false,
  status: "not_configured",
  notConfigured: true,
  providerId: null,
  errorMessage: null,
  detail: "test stub",
  id: null,
});

interface SeededUser {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
}

async function seedUser(username: string, plan = "diamond"): Promise<SeededUser> {
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
      plan,
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 7,
      dieselPrice: 4,
      tankRangeMi: 800,
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

// ---- seeding helpers ---------------------------------------------------------

async function insertTrip(u: SeededUser, totalMiles: number) {
  const now = new Date();
  await getDb()
    .insert(schema.trips)
    .values({
      profileId: u.profileId,
      startedAt: now,
      endedAt: now,
      totalMiles,
      totalPay: 0,
      stateBreakdown: "{}",
    });
}

async function insertLoad(
  u: SeededUser,
  fields: {
    pickupCity?: string | null;
    pickupState?: string | null;
    deliveryCity?: string | null;
    deliveryState?: string | null;
    deliveryText?: string | null;
  } = {},
): Promise<number> {
  const rows = await getDb()
    .insert(schema.loads)
    .values({ profileId: u.profileId, ...fields })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

async function insertChain(event: string, refId: number | null, payload: Record<string, unknown>) {
  await getDb()
    .insert(schema.chainLog)
    .values({
      refKind: event === "duty_change" ? "driver" : "load",
      refId,
      sessionId: null,
      event,
      payload: JSON.stringify(payload),
      prevHash: "test-prev",
      hash: `test-${event}-${refId ?? 0}-${Math.random().toString(36).slice(2)}`,
    });
}

const sealLoad = (loadId: number, at: Date) =>
  insertChain("pod_seal", loadId, { loadId, at: at.toISOString() });

async function laneRows(username: string, source?: string) {
  const rows = await getDb()
    .select()
    .from(schema.pointsLog)
    .where(eq(schema.pointsLog.username, username));
  return source ? rows.filter((r) => r.source === source) : rows;
}

const getPoints = (u: SeededUser) => Actions.getPoints.handler(ctxFor(u), {});

// ---- users -------------------------------------------------------------------

const alice = await seedUser("lanealice");
const bob = await seedUser("lanebob");
const carl = await seedUser("lanecarl", "basic");
const capuser = await seedUser("lanecap");
const desk = await seedUser("lanedesk");
const comped = await seedUser("lanecomped");

// desk owns a fleet company; comped sits in it as a fleet DRIVER —
// the comped fleet-included seat the House Rule 4 gate excludes.
const companyRows = await getDb()
  .insert(schema.companies)
  .values({ name: "Lane Test Fleet", ownerUsername: desk.username })
  .returning({ id: schema.companies.id });
const companyId = companyRows[0]!.id;
await getDb().insert(schema.companyMembers).values({ companyId, username: desk.username, role: "owner" });
await getDb().insert(schema.companyMembers).values({ companyId, username: comped.username, role: "driver" });

// ---- Lane 1 --------------------------------------------------------------------

describe("Lane 1 — driving well", () => {
  test("sealed-miles milestone pays once at 10,000 and never twice", async () => {
    await insertTrip(alice, 6000);
    await insertTrip(alice, 4500);
    const res = await getPoints(alice);
    const rows = await laneRows(alice.username, "lane1_miles_milestone");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(250);
    expect(rows[0]!.refKey).toBe("lane1-miles-10000");
    expect(res.lanes.totals.lane1).toBeGreaterThanOrEqual(250);
    expect(res.lanes.eligible).toBe(true);
    expect(res.history.some((h) => h.lane === "lane1")).toBe(true);
    await getPoints(alice);
    expect((await laneRows(alice.username, "lane1_miles_milestone")).length).toBe(1);
  });

  test("gate: a Basic-plan driver earns no lane points", async () => {
    await insertTrip(carl, 12000);
    const res = await getPoints(carl);
    expect(res.lanes.eligible).toBe(false);
    expect((await laneRows(carl.username)).filter((r) => r.source.startsWith("lane")).length).toBe(0);
  });

  test("gate: a comped fleet-included driver earns no lane points", async () => {
    await insertTrip(comped, 12000);
    const res = await getPoints(comped);
    expect(res.lanes.eligible).toBe(false);
    expect((await laneRows(comped.username)).filter((r) => r.source.startsWith("lane")).length).toBe(0);
  });

  test("on-time streak block pays; voiding a seal in the run reverses it", async () => {
    const base = Date.now() - 6 * 3600000;
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const sealAt = new Date(base + i * 3600000);
      const id = await insertLoad(alice, {
        pickupCity: "Mobile",
        pickupState: "AL",
        deliveryCity: "Dallas",
        deliveryState: "TX",
        deliveryText: new Date(sealAt.getTime() + 2 * 3600000).toISOString(),
      });
      ids.push(id);
      await sealLoad(id, sealAt);
    }
    await getPoints(alice);
    const blocks = await laneRows(alice.username, "lane1_ontime_streak");
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.amount).toBe(100);
    expect(blocks[0]!.refKey).toBe(`lane1-ontime-${ids[0]}-1`);
    // Void the middle seal: the run drops to 2 + 2, the block is
    // no longer justified, and the next points read reverses it.
    await Actions.voidPodSeal.handler(ctxFor(alice), { loadId: ids[2]! });
    await getPoints(alice);
    const all = await laneRows(alice.username);
    const claw = all.find((r) => r.refKey === `clawback:lane1-ontime-${ids[0]}-1`);
    expect(claw).toBeTruthy();
    expect(claw!.amount).toBe(-100);
    const net = (await laneRows(alice.username, "lane1_ontime_streak")).reduce((s, r) => s + r.amount, 0)
      + (claw ? claw.amount : 0);
    expect(net).toBe(0);
  });

  test("a clean-inspection day pays; a defects day does not", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    await getDb().insert(schema.dailyLogs).values({
      username: alice.username,
      logDate: today,
      status: "closed",
      openedAt: new Date(),
      pretrip: JSON.stringify({ result: "pass", defects: [] }),
    });
    await getDb().insert(schema.dailyLogs).values({
      username: alice.username,
      logDate: "2026-01-05",
      status: "closed",
      openedAt: new Date(),
      pretrip: JSON.stringify({ result: "defects", defects: ["light out"] }),
    });
    await getPoints(alice);
    const rows = await laneRows(alice.username, "lane1_clean_inspection");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(25);
  });

  test("HOS week: zero violations pays; a 12-hour driving day does not", async () => {
    const dayMs = 86400000;
    const target = new Date(Date.now() - 10 * dayMs);
    const logDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(target);
    const noonUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 12, 0, 0);
    const duty = async (u: SeededUser, seq: [string, number][]) => {
      for (const [state, offsetMin] of seq) {
        await insertChain("duty_change", null, {
          state,
          at: new Date(noonUtc + offsetMin * 60000).toISOString(),
          username: u.username,
        });
      }
      await getDb().insert(schema.dailyLogs).values({
        username: u.username,
        logDate,
        status: "closed",
        openedAt: new Date(noonUtc),
      });
    };
    // Alice: a short clean day (4h driving) in that week.
    await duty(alice, [["on_duty", 0], ["driving", 5], ["on_duty", 245], ["off_duty", 250]]);
    await getPoints(alice);
    const aliceHos = await laneRows(alice.username, "lane1_hos_week");
    expect(aliceHos.length).toBe(1);
    expect(aliceHos[0]!.amount).toBe(150);
    // Bob: 12 straight hours of driving the same week.
    await duty(bob, [["on_duty", 0], ["driving", 5], ["off_duty", 725]]);
    await getPoints(bob);
    expect((await laneRows(bob.username, "lane1_hos_week")).length).toBe(0);
  });
});

// ---- Lane 2 --------------------------------------------------------------------

describe("Lane 2 — feeding the map", () => {
  test("solo intel report earns nothing; a second driver's consistent report pays both", async () => {
    const a = await Actions.addIntelReport.handler(ctxFor(alice), {
      kind: "parking_open", note: null, lat: 30.0, lon: -90.0,
    });
    expect((await laneRows(alice.username, "lane2_intel_report")).length).toBe(0);
    await Actions.addIntelReport.handler(ctxFor(bob), {
      kind: "parking_open", note: null, lat: 30.0005, lon: -90.0005,
    });
    const aliceRows = await laneRows(alice.username, "lane2_intel_report");
    const bobRows = await laneRows(bob.username, "lane2_intel_report");
    expect(aliceRows.some((r) => r.refKey === `lane2-intel-${a.id}` && r.amount === 20)).toBe(true);
    expect(bobRows.length).toBe(1);
    const res = await getPoints(bob);
    expect(res.lanes.totals.lane2).toBe(20);
  });

  test("a contradicted spot pays nobody", async () => {
    const a = await Actions.addIntelReport.handler(ctxFor(alice), {
      kind: "parking_open", note: null, lat: 33.0, lon: -93.0,
    });
    const b = await Actions.addIntelReport.handler(ctxFor(bob), {
      kind: "parking_full", note: null, lat: 33.0, lon: -93.0,
    });
    const all = [...(await laneRows(alice.username)), ...(await laneRows(bob.username))];
    expect(all.some((r) => r.refKey === `lane2-intel-${a.id}`)).toBe(false);
    expect(all.some((r) => r.refKey === `lane2-intel-${b.id}`)).toBe(false);
  });

  test("self-confirmation pays nothing; another driver's GPS confirm pays the reporter", async () => {
    const own = await Actions.addIntelReport.handler(ctxFor(alice), {
      kind: "weigh_open", note: null, lat: 32.0, lon: -92.0,
    });
    await getDb()
      .update(schema.intelReports)
      .set({ createdAt: new Date(Date.now() - 15 * 60000) })
      .where(eq(schema.intelReports.id, own.id));
    await Actions.confirmIntelReport.handler(ctxFor(alice), { id: own.id, lat: 32.0, lon: -92.0 });
    expect((await laneRows(alice.username)).some((r) => r.refKey === `lane2-intel-${own.id}`)).toBe(false);

    const other = await Actions.addIntelReport.handler(ctxFor(alice), {
      kind: "hazard", note: null, lat: 32.5, lon: -92.5,
    });
    await getDb()
      .update(schema.intelReports)
      .set({ createdAt: new Date(Date.now() - 15 * 60000) })
      .where(eq(schema.intelReports.id, other.id));
    await Actions.confirmIntelReport.handler(ctxFor(bob), { id: other.id, lat: 32.5, lon: -92.5 });
    const rows = await laneRows(alice.username, "lane2_intel_report");
    expect(rows.some((r) => r.refKey === `lane2-intel-${other.id}` && r.amount === 20)).toBe(true);
  });

  test("fuel prices corroborate the same way (and the reporter is stamped)", async () => {
    const a = await Actions.reportFuelPrice.handler(ctxFor(alice), {
      station: "Lane Test Stop", lat: 34.0, lon: -94.0, state: "AL", price: 3.5,
    });
    expect(a.ok).toBe(true);
    expect((await laneRows(alice.username, "lane2_fuel_report")).length).toBe(0);
    await Actions.reportFuelPrice.handler(ctxFor(bob), {
      station: "Lane Test Stop", lat: 34.0005, lon: -94.0005, state: "AL", price: 3.58,
    });
    const aliceRows = await laneRows(alice.username, "lane2_fuel_report");
    expect(aliceRows.length).toBe(1);
    expect(aliceRows[0]!.amount).toBe(20);
    const stamped = await getDb()
      .select()
      .from(schema.fuelPriceReports)
      .where(eq(schema.fuelPriceReports.id, a.id!));
    expect(stamped[0]!.reporter).toBe(alice.username);
  });

  test("the daily Lane 2 award cap holds at 5", async () => {
    for (let i = 0; i < 6; i++) {
      const lat = 40 + i;
      await Actions.addIntelReport.handler(ctxFor(capuser), {
        kind: "hazard", note: null, lat, lon: -100,
      });
      await Actions.addIntelReport.handler(ctxFor(bob), {
        kind: "hazard", note: null, lat: lat + 0.0005, lon: -100.0005,
      });
    }
    const rows = (await laneRows(capuser.username)).filter(
      (r) => r.source === "lane2_intel_report" || r.source === "lane2_fuel_report",
    );
    expect(rows.length).toBe(5);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(100);
  });
});

// ---- Lane 3 --------------------------------------------------------------------

describe("Lane 3 — growing it", () => {
  test("poster referral pays at the first board load, not at signup", async () => {
    await getDb().insert(schema.referralCodes).values({ username: alice.username, code: "MILE-REF-LANE3" });
    const created = await Actions.createShipperAccount.handler(ctxFor(desk), {
      name: "Lane3 Shipper",
      email: "lane3shipper@test.local",
      contactName: null,
      linkedUsername: null,
      isDemo: false,
      defaultPickupAddress: null,
      defaultPickupCity: null,
      defaultPickupState: null,
      defaultCommodity: null,
      defaultFreightClass: null,
      defaultContactName: null,
      defaultContactPhone: null,
      referralCode: "MILE-REF-LANE3",
    });
    expect(created.ok).toBe(true);
    const refs = await getDb().select().from(schema.posterReferrals);
    expect(refs.length).toBe(1);
    expect(refs[0]!.status).toBe("pending");
    // Signup alone pays nothing.
    await getPoints(alice);
    expect((await laneRows(alice.username, "lane3_poster_referral")).length).toBe(0);
    // The shipper's first load reaches a board → the award lands.
    await getDb().insert(schema.shipperLoads).values({
      shipperId: created.id!,
      companyId,
      createdBy: desk.username,
      status: "released",
      boardLoadId: 777001,
    });
    await getPoints(alice);
    const rows = await laneRows(alice.username, "lane3_poster_referral");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(500);
    const refsAfter = await getDb().select().from(schema.posterReferrals);
    expect(refsAfter[0]!.status).toBe("landed");
    await getPoints(alice);
    expect((await laneRows(alice.username, "lane3_poster_referral")).length).toBe(1);
  });

  test("an unknown referral code is ignored and creation still succeeds", async () => {
    const before = (await getDb().select().from(schema.posterReferrals)).length;
    const created = await Actions.createBrokerAccount.handler(ctxFor(desk), {
      name: "No Code Broker",
      email: "nocode@test.local",
      contactName: null,
      brokerMc: null,
      dispatcherFeePct: null,
      linkedUsername: null,
      isDemo: false,
      defaultPickupAddress: null,
      defaultPickupCity: null,
      defaultPickupState: null,
      defaultCommodity: null,
      defaultFreightClass: null,
      defaultContactName: null,
      defaultContactPhone: null,
      referralCode: "BOGUS-CODE",
    });
    expect(created.ok).toBe(true);
    expect((await getDb().select().from(schema.posterReferrals)).length).toBe(before);
  });

  test("first sealed lane pays its sealer only; voiding frees the lane for the next sealer", async () => {
    const aliceLoad = await insertLoad(alice, {
      pickupCity: "Birmingham", pickupState: "AL", deliveryCity: "Atlanta", deliveryState: "GA",
    });
    await sealLoad(aliceLoad, new Date(Date.now() - 2 * 3600000));
    const bobLoad = await insertLoad(bob, {
      pickupCity: "Birmingham", pickupState: "AL", deliveryCity: "Atlanta", deliveryState: "GA",
    });
    await sealLoad(bobLoad, new Date(Date.now() - 1 * 3600000));
    await getPoints(alice);
    await getPoints(bob);
    // (Alice also holds the Mobile→Dallas first-lane award from the
    // streak test above — assertions here key on THIS lane's loads.)
    const aliceRows = (await laneRows(alice.username, "lane3_first_lane")).filter(
      (r) => r.refKey === `lane3-firstlane-${aliceLoad}`,
    );
    expect(aliceRows.length).toBe(1);
    expect(aliceRows[0]!.amount).toBe(100);
    expect((await laneRows(bob.username, "lane3_first_lane")).length).toBe(0);
    // Void Alice's seal: award reversed, registry row deleted.
    const voided = await Actions.voidPodSeal.handler(ctxFor(alice), { loadId: aliceLoad });
    expect(voided.pointsClawedBack).toBeGreaterThanOrEqual(100);
    const regRows = await getDb()
      .select()
      .from(schema.sealedLanes)
      .where(eq(schema.sealedLanes.laneKey, "BIRMINGHAM,AL->ATLANTA,GA"));
    expect(regRows.length).toBe(0);
    const claw = (await laneRows(alice.username)).find((r) => r.refKey === `clawback:lane3-firstlane-${aliceLoad}`);
    expect(claw?.amount).toBe(-100);
    // Bob's seal is now the first on the lane.
    await getPoints(bob);
    const bobRows = await laneRows(bob.username, "lane3_first_lane");
    expect(bobRows.length).toBe(1);
    expect(bobRows[0]!.refKey).toBe(`lane3-firstlane-${bobLoad}`);
  });

  test("Founding Tester completion pays once", async () => {
    const acceptedAt = new Date(Date.now() - 15 * 86400000);
    await getDb().insert(schema.accountInvites).values({
      kind: "tester",
      email: alice.email,
      tokenHash: "lane3-founding-hash",
      status: "accepted",
      expiresAt: new Date(Date.now() + 30 * 86400000),
      acceptedAccountId: alice.accountId,
      acceptedAt,
    });
    for (let i = 0; i < 10; i++) {
      await getDb().insert(schema.authActivityDays).values({
        accountId: alice.accountId,
        day: new Date(acceptedAt.getTime() + i * 86400000).toISOString().slice(0, 10),
      });
    }
    await getPoints(alice);
    const rows = await laneRows(alice.username, "lane3_founding_tester");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(250);
    await getPoints(alice);
    expect((await laneRows(alice.username, "lane3_founding_tester")).length).toBe(1);
  });
});
