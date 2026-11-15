// fleetVisibilityFlow.test.ts — INTEGRATION tests for fleet
// visibility + outward sharing (TMS queue item 4, migration 0127),
// run against the REAL action handlers over a throwaway migrated
// SQLite database:
//
//   (a) the share-up pipe: a driver's publish derives lane/status
//       from their OWN load row, refuses another driver's load, and
//       clears when the named load is delivered
//   (b) the fleet board: owner + dispatch of THAT fleet only —
//       per-truck cards with load, stops, route end, and position
//       under the privacy gate; another fleet sees none of it, a
//       driver seat sees nothing, and NO rate rides the payload
//       even though the board rows carry one
//   (c) assign ranking: a truck finishing near the pickup outranks
//       an empty truck sitting farther away; unknown positions
//       rank last; another fleet's board load refuses
//   (d) outward shares: opt-in create by the load's driver OR the
//       fleet desk whose board took the load; the public track
//       view shows route/stops/ETA/location+freshness and NO rate;
//       track tokens never resolve on the receive/POD doors;
//       revoke kills the link; delivery expires it
//
// Pure-rule coverage lives in fleetVisibility.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-fleetvis-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { desc, eq } = await import("drizzle-orm");

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
      truckYear: 2022,
      truckMake: "Kenworth",
      truckModel: "T680",
      truckUnitNumber: "12",
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

const db = getDb();

const headRows = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
let chainPrev = headRows[0]?.hash ?? "GENESIS";
async function addChain(refKind: string, refId: number | null, event: string, payload: Record<string, unknown>, atIso: string) {
  const payloadText = JSON.stringify(payload);
  const hash = createHash("sha256").update(`${chainPrev}|${event}|${payloadText}`).digest("hex");
  const rows = await db
    .insert(schema.chainLog)
    .values({ refKind, refId, sessionId: null, event, payload: payloadText, prevHash: chainPrev, hash, createdAt: new Date(atIso) })
    .returning({ id: schema.chainLog.id });
  chainPrev = hash;
  return rows[0]!.id;
}

// ---- Users + fleets ---------------------------------------------------------

const ownerA = await seedUser("fvowner", "Olivia Owner");
const dispatchA = await seedUser("fvdispatch", "Dana Dispatch");
const driver1 = await seedUser("fvdriver1", "Frank Driver");
const driver2 = await seedUser("fvdriver2", "Erin Empty");
const driver3 = await seedUser("fvdriver3", "Bob Board");
const ownerB = await seedUser("fvownerb", "Oscar Other");
const driverB = await seedUser("fvdriverb", "Paul Private");
const solo = await seedUser("fvsolo", "Sam Solo");

async function seedFleet(owner: SeededUser, name: string): Promise<number> {
  const c = await db
    .insert(schema.companies)
    .values({ name, ownerUsername: owner.username })
    .returning({ id: schema.companies.id });
  const companyId = c[0]!.id;
  await db.insert(schema.companyMembers).values({ companyId, username: owner.username, role: "owner" });
  return companyId;
}
async function addMember(companyId: number, username: string, role: string) {
  await db.insert(schema.companyMembers).values({ companyId, username, role });
}

const fleetA = await seedFleet(ownerA, "Fleet A LLC");
await addMember(fleetA, dispatchA.username, "dispatch");
await addMember(fleetA, driver1.username, "driver");
await addMember(fleetA, driver2.username, "driver");
await addMember(fleetA, driver3.username, "driver");
const fleetB = await seedFleet(ownerB, "Fleet B LLC");
await addMember(fleetB, driverB.username, "driver");

const ownerACtx = ctxFor(ownerA);
const dispatchACtx = ctxFor(dispatchA);
const driver1Ctx = ctxFor(driver1);
const driver2Ctx = ctxFor(driver2);
const ownerBCtx = ctxFor(ownerB);
const soloCtx = ctxFor(solo);
const anonCtx = createInvocation({ executePrivileged: privStub as never, viewer: null }).ctx as unknown as CtxT;

// ---- Loads + board rows ------------------------------------------------------
// driver1's live load: Mobile, AL → Fort Worth, TX, rate 2500 (the
// number that must never ride any fleet/share payload).
const loadA1Rows = await db
  .insert(schema.loads)
  .values({
    profileId: driver1.profileId,
    shipper: "Acme Steel",
    pickupCity: "Mobile",
    pickupState: "AL",
    deliveryCity: "Fort Worth",
    deliveryState: "TX",
    commodity: "steel coils",
    weightLbs: 40000,
    rate: 2500,
    status: "picked_up",
  })
  .returning({ id: schema.loads.id });
const loadA1 = loadA1Rows[0]!.id;

// driver1's already-delivered load (pod seal standing).
const loadDoneRows = await db
  .insert(schema.loads)
  .values({
    profileId: driver1.profileId,
    shipper: "Done Co",
    pickupCity: "Mobile",
    pickupState: "AL",
    deliveryCity: "Biloxi",
    deliveryState: "MS",
    rate: 800,
    status: "picked_up",
  })
  .returning({ id: schema.loads.id });
const loadDone = loadDoneRows[0]!.id;
await addChain("load", loadDone, "pod_seal", { autoSealed: false }, "2026-11-14T15:00:00Z");

// Fleet A's taken board row naming loadA1 (the fleet-scope door for
// the desk) and driver3's taken row (the board-fallback card).
await db.insert(schema.boardLoads).values({
  companyId: fleetA,
  postedBy: ownerA.username,
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Fort Worth",
  deliveryState: "TX",
  rate: 2500,
  status: "taken",
  claimedBy: driver1.username,
  loadId: loadA1,
});
await db.insert(schema.boardLoads).values({
  companyId: fleetA,
  postedBy: ownerA.username,
  pickupCity: "Shreveport",
  pickupState: "LA",
  deliveryCity: "Tulsa",
  deliveryState: "OK",
  rate: 1750,
  status: "taken",
  claimedBy: driver3.username,
  loadId: null,
});
// The open board load dispatch will assign: pickup Dallas, rate 9999
// (the second number that must never ride a payload).
const openBoardRows = await db
  .insert(schema.boardLoads)
  .values({
    companyId: fleetA,
    postedBy: ownerA.username,
    pickupCity: "Dallas",
    pickupState: "TX",
    deliveryCity: "Austin",
    deliveryState: "TX",
    rate: 9999,
    status: "open",
  })
  .returning({ id: schema.boardLoads.id });
const openBoard = openBoardRows[0]!.id;

// Positions: driver1 mid-route near Texarkana; driver2 empty in
// Oklahoma City; driver3 has a fix but publishes nothing.
const now = new Date();
await db.insert(schema.driverPositions).values([
  { username: driver1.username, lat: 33.425, lon: -94.043, updatedAt: now },
  { username: driver2.username, lat: 35.4676, lon: -97.5164, updatedAt: now },
  { username: driver3.username, lat: 32.5, lon: -94.0, updatedAt: now },
  { username: driverB.username, lat: 30.0, lon: -90.0, updatedAt: now },
]);

const DALLAS = { lat: 32.7767, lon: -96.797 };
const FORT_WORTH = { lat: 32.7555, lon: -97.3308 };

// ---- (a) the share-up pipe ---------------------------------------------------

describe("publishFleetStatus — the share-up pipe", () => {
  test("a driver's publish derives the lane from their OWN load row", async () => {
    const r = await Actions.publishFleetStatus.handler(driver1Ctx, {
      loadId: loadA1,
      stops: ["Fuel — Little Rock", "Scale — Texarkana"],
      routeLabel: "I-30 west",
      endLat: FORT_WORTH.lat,
      endLon: FORT_WORTH.lon,
      etaAt: "2026-11-15T23:00:00Z",
    } as never);
    expect(r.ok).toBe(true);
    expect(r.hasActiveLoad).toBe(true);
    const rows = await db.select().from(schema.driverFleetStatus).where(eq(schema.driverFleetStatus.username, driver1.username));
    expect(rows[0]!.pickupCity).toBe("Mobile");
    expect(rows[0]!.deliveryCity).toBe("Fort Worth");
    expect(rows[0]!.loadStatus).toBe("picked_up");
    expect(JSON.parse(rows[0]!.stopsJson)).toEqual(["Fuel — Little Rock", "Scale — Texarkana"]);
    // The snapshot has no money anywhere on the row.
    expect(JSON.stringify(rows[0])).not.toContain("2500");
  });

  test("publishing another driver's load is refused — it isn't in the caller's scope", async () => {
    const r = await Actions.publishFleetStatus.handler(driver2Ctx, {
      loadId: loadA1, stops: [], routeLabel: null, endLat: null, endLon: null, etaAt: null,
    } as never);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("isn't in your scope");
  });

  test("an empty driver's cleared publish lands as no active load", async () => {
    const r = await Actions.publishFleetStatus.handler(driver2Ctx, {
      loadId: null, stops: [], routeLabel: null, endLat: null, endLon: null, etaAt: null,
    } as never);
    expect(r.ok).toBe(true);
    expect(r.hasActiveLoad).toBe(false);
  });

  test("naming a delivered load clears instead of pointing the fleet at a finished run", async () => {
    const r = await Actions.publishFleetStatus.handler(driver1Ctx, {
      loadId: loadDone, stops: [], routeLabel: null, endLat: null, endLon: null, etaAt: null,
    } as never);
    expect(r.ok).toBe(true);
    expect(r.hasActiveLoad).toBe(false);
    const rows = await db.select().from(schema.driverFleetStatus).where(eq(schema.driverFleetStatus.username, driver1.username));
    expect(rows[0]!.loadId).toBeNull();
    // Restore driver1's live publish for the board tests below.
    await Actions.publishFleetStatus.handler(driver1Ctx, {
      loadId: loadA1,
      stops: ["Fuel — Little Rock", "Scale — Texarkana"],
      routeLabel: "I-30 west",
      endLat: FORT_WORTH.lat,
      endLon: FORT_WORTH.lon,
      etaAt: "2026-11-15T23:00:00Z",
    } as never);
  });
});

// ---- (b) the fleet board -------------------------------------------------------

describe("getFleetBoard — per-fleet scoped live board", () => {
  test("the owner sees per-truck cards for their own fleet only", async () => {
    const board = await Actions.getFleetBoard.handler(ownerACtx, {} as never);
    expect(board.canView).toBe(true);
    expect(board.companyName).toBe("Fleet A LLC");
    const names = board.cards.map((c) => c.username);
    expect(names).toContain(driver1.username);
    expect(names).toContain(driver2.username);
    expect(names).toContain(driver3.username);
    expect(names).toContain(ownerA.username);
    // Dispatch seats are viewers, not truck cards; fleet B is invisible.
    expect(names).not.toContain(dispatchA.username);
    expect(names).not.toContain(driverB.username);
    expect(names).not.toContain(ownerB.username);

    const d1 = board.cards.find((c) => c.username === driver1.username)!;
    expect(d1.hasActiveLoad).toBe(true);
    expect(d1.lane).toBe("Mobile, AL → Fort Worth, TX");
    expect(d1.loadStatusLabel).toContain("on the road");
    expect(d1.stops).toEqual(["Fuel — Little Rock", "Scale — Texarkana"]);
    expect(d1.routeEndLabel).toBe("Fort Worth, TX");
    expect(d1.etaAt).toBe("2026-11-15T23:00:00.000Z");
    expect(d1.truckLine).toContain("Kenworth T680");
    expect(d1.positionVisible).toBe(true);
    expect(d1.lat).toBeCloseTo(33.425, 3);
    expect(d1.positionFreshness).toBeTruthy();

    const d2 = board.cards.find((c) => c.username === driver2.username)!;
    expect(d2.hasActiveLoad).toBe(false);
    // Fresh cleared snapshot = the driver's app is reporting in-fleet.
    expect(d2.positionVisible).toBe(true);
    expect(d2.positionLabel).toContain("Shared with the fleet");

    const d3 = board.cards.find((c) => c.username === driver3.username)!;
    // Board fallback: a taken company load, no snapshot published.
    expect(d3.hasActiveLoad).toBe(true);
    expect(d3.lane).toBe("Shreveport, LA → Tulsa, OK");
    expect(d3.loadStatusLabel).toContain("company load");
    // No publish, no duty signal: the fix stays private.
    expect(d3.positionVisible).toBe(false);
    expect(d3.lat).toBeNull();

    // THE RATE LAW: neither load's rate rides the board payload.
    const text = JSON.stringify(board);
    expect(text).not.toContain("2500");
    expect(text).not.toContain("1750");
    expect(text).not.toContain("9999");
  });

  test("a dispatch seat can view; a driver seat and a solo account cannot", async () => {
    const desk = await Actions.getFleetBoard.handler(dispatchACtx, {} as never);
    expect(desk.canView).toBe(true);
    const driver = await Actions.getFleetBoard.handler(driver1Ctx, {} as never);
    expect(driver.canView).toBe(false);
    expect(driver.cards).toEqual([]);
    const soloBoard = await Actions.getFleetBoard.handler(soloCtx, {} as never);
    expect(soloBoard.canView).toBe(false);
  });

  test("another fleet's owner sees only their own fleet", async () => {
    const board = await Actions.getFleetBoard.handler(ownerBCtx, {} as never);
    expect(board.canView).toBe(true);
    expect(board.companyName).toBe("Fleet B LLC");
    const names = board.cards.map((c) => c.username);
    expect(names).toContain(driverB.username);
    expect(names).not.toContain(driver1.username);
  });
});

// ---- (c) assign ranking --------------------------------------------------------

describe("getAssignCandidates — deadhead ranking", () => {
  test("a truck finishing near the pickup outranks an empty truck sitting farther away", async () => {
    const r = await Actions.getAssignCandidates.handler(dispatchACtx, {
      boardLoadId: openBoard, pickupLat: DALLAS.lat, pickupLon: DALLAS.lon,
    } as never);
    expect(r.ok).toBe(true);
    expect(r.rankedByDeadhead).toBe(true);
    expect(r.lane).toBe("Dallas, TX → Austin, TX");
    const first = r.candidates[0]!;
    expect(first.username).toBe(driver1.username);
    expect(first.basis).toBe("route_end");
    expect(first.effectiveMi).toBe(first.deadheadEndMi);
    expect(first.effectiveMi!).toBeLessThan(40);
    // driver1's CURRENT position (Texarkana) is much farther — the
    // ranking spends the route end, not the current dot.
    expect(first.deadheadNowMi!).toBeGreaterThan(120);
    const empty = r.candidates.find((c) => c.username === driver2.username)!;
    expect(empty.basis).toBe("current");
    expect(empty.effectiveMi!).toBeGreaterThan(150);
    expect(r.candidates.indexOf(empty)).toBeGreaterThan(0);
    // driver3 never published and isn't visible: unknown position,
    // in the unranked tail (with the owner, who also has no fix).
    const ghost = r.candidates.find((c) => c.username === driver3.username)!;
    expect(ghost.effectiveMi).toBeNull();
    expect(ghost.basis).toBe("unknown");
    const tail = r.candidates.slice(-2).map((c) => c.username);
    expect(tail).toEqual([driver3.username, ownerA.username]);
    expect(r.candidates.slice(-2).every((c) => c.effectiveMi == null)).toBe(true);
    // THE RATE LAW: the board load's own rate never rides the ranking.
    expect(JSON.stringify(r)).not.toContain("9999");
  });

  test("without a pickup point the candidates come back unranked, distances null", async () => {
    const r = await Actions.getAssignCandidates.handler(ownerACtx, {
      boardLoadId: openBoard, pickupLat: null, pickupLon: null,
    } as never);
    expect(r.ok).toBe(true);
    expect(r.rankedByDeadhead).toBe(false);
    expect(r.candidates.every((c) => c.effectiveMi == null)).toBe(true);
  });

  test("another fleet's desk is refused, and a driver seat is refused", async () => {
    const other = await Actions.getAssignCandidates.handler(ownerBCtx, {
      boardLoadId: openBoard, pickupLat: DALLAS.lat, pickupLon: DALLAS.lon,
    } as never);
    expect(other.ok).toBe(false);
    expect(other.error).toContain("isn't on your company's board");
    const driver = await Actions.getAssignCandidates.handler(driver1Ctx, {
      boardLoadId: openBoard, pickupLat: DALLAS.lat, pickupLon: DALLAS.lon,
    } as never);
    expect(driver.ok).toBe(false);
  });
});

// ---- (d) outward shares ---------------------------------------------------------

describe("outward tracking shares — opt-in, revocable, expiring at delivery", () => {
  let trackToken = "";
  let linkId = 0;

  test("the driver creates a share; the public view shows route/stops/ETA/location and NO rate", async () => {
    const created = await Actions.createLoadShareLink.handler(driver1Ctx, { loadId: loadA1 } as never);
    expect(created.ok).toBe(true);
    expect(created.url).toContain("/track/trk_");
    trackToken = created.url!.split("/track/")[1]!;

    const list = await Actions.getLoadShareLinks.handler(driver1Ctx, { loadId: loadA1 } as never);
    expect(list.ok).toBe(true);
    expect(list.delivered).toBe(false);
    expect(list.links.length).toBe(1);
    expect(list.links[0]!.state).toBe("live");
    linkId = list.links[0]!.id;

    const info = await Actions.getTrackInfo.handler(anonCtx, { token: trackToken } as never);
    expect(info.valid).toBe(true);
    expect(info.state).toBe("live");
    expect(info.lane).toBe("Mobile, AL → Fort Worth, TX");
    expect(info.shipperName).toBe("Acme Steel");
    expect(info.commodity).toBe("steel coils");
    expect(info.statusLabel).toContain("on the road");
    expect(info.stops).toEqual(["Fuel — Little Rock", "Scale — Texarkana"]);
    expect(info.etaAt).toBeTruthy();
    expect(info.driverFirstName).toBe("Frank");
    expect(info.positionVisible).toBe(true);
    expect(info.lat).toBeCloseTo(33.425, 3);
    expect(info.positionFreshness).toBeTruthy();
    // THE RATE LAW over the wire: no rate key, no rate value.
    const text = JSON.stringify(info);
    expect(text).not.toContain("2500");
    expect(text).not.toContain("\"rate\"");
  });

  test("a track token never resolves on the receive / POD doors", async () => {
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token: trackToken } as never);
    expect(info.valid).toBe(false);
    const confirm = await Actions.confirmReceive.handler(anonCtx, {
      token: trackToken, receiverName: "Nosy Parker", exceptionNotes: null, photoDataBase64: null, photoMime: null,
    } as never);
    expect(confirm.ok).toBe(false);
    const copy = await Actions.getPodCopyDocument.handler(anonCtx, { token: trackToken } as never);
    expect(copy.ok).toBe(false);
  });

  test("the fleet desk can share its own board load; another fleet cannot touch it", async () => {
    const desk = await Actions.createLoadShareLink.handler(ownerACtx, { loadId: loadA1 } as never);
    expect(desk.ok).toBe(true);
    expect(desk.url).toContain(trackToken); // the same standing link
    const other = await Actions.createLoadShareLink.handler(ownerBCtx, { loadId: loadA1 } as never);
    expect(other.ok).toBe(false);
    const otherList = await Actions.getLoadShareLinks.handler(ownerBCtx, { loadId: loadA1 } as never);
    expect(otherList.ok).toBe(false);
  });

  test("revoke kills the link everywhere, immediately", async () => {
    const r = await Actions.revokeLoadShareLink.handler(driver1Ctx, { loadId: loadA1, linkId } as never);
    expect(r.ok).toBe(true);
    const info = await Actions.getTrackInfo.handler(anonCtx, { token: trackToken } as never);
    expect(info.valid).toBe(false);
    const list = await Actions.getLoadShareLinks.handler(driver1Ctx, { loadId: loadA1 } as never);
    expect(list.links[0]!.state).toBe("revoked");
  });

  test("delivery expires the share: state delivered, position gone, no new shares", async () => {
    const created = await Actions.createLoadShareLink.handler(driver1Ctx, { loadId: loadA1 } as never);
    expect(created.ok).toBe(true);
    const freshToken = created.url!.split("/track/")[1]!;
    await addChain("load", loadA1, "pod_seal", { autoSealed: false }, "2026-11-15T20:00:00Z");
    const info = await Actions.getTrackInfo.handler(anonCtx, { token: freshToken } as never);
    expect(info.valid).toBe(true);
    expect(info.state).toBe("delivered");
    expect(info.statusLabel).toBe("Delivered");
    expect(info.positionVisible).toBe(false);
    expect(info.lat).toBeNull();
    const again = await Actions.createLoadShareLink.handler(driver1Ctx, { loadId: loadA1 } as never);
    expect(again.ok).toBe(false);
    expect(again.error).toContain("already delivered");
  });
});
