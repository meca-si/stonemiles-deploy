// autonomyFlow.test.ts — INTEGRATION tests for the autonomy core
// (Research Wave 2 item 1, migrations 0129/0022), run against the
// REAL action handlers over a throwaway migrated SQLite database:
//
//   (a) auto status: creating a track share evaluates the load —
//       sealed milestones publish to the syndication outbox and
//       onto the public track timeline with no driver taps, each
//       carrying chain evidence + confidence; the seeded rate
//       (4321) rides NO payload anywhere (rate law)
//   (b) exceptions: a stale position + a missing appointment open
//       ranked exceptions routed to driver + fleet; the broker
//       sees the queue for loads they posted; a stranger fleet
//       sees nothing; new opens notify in-app (recordNotification)
//   (c) resolves: supplying the appointment seals
//       exception_resolved and writes the fact; a bare dismissal
//       is refused; a dismissal with a note holds across
//       re-evaluation (episode fingerprint)
//   (d) corrections: voiding an auto status seals
//       auto_status_voided and the track timeline shows the
//       correction in place of the original (guardrail e)
//   (e) a detention record with NO sealed chain event behind it
//       publishes nothing — the chain is the only source
//
// Pure-rule coverage lives in autonomy.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-autonomy-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { asc, desc, eq } = await import("drizzle-orm");

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

// Chain writer that always extends the CURRENT head (the action
// handlers append their own events between test writes).
async function addChain(refKind: string, refId: number | null, event: string, payload: Record<string, unknown>, atIso: string) {
  const head = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
  const prev = head[0]?.hash ?? "GENESIS";
  const payloadText = JSON.stringify(payload);
  const hash = createHash("sha256").update(`${prev}|${event}|${payloadText}`).digest("hex");
  const rows = await db
    .insert(schema.chainLog)
    .values({ refKind, refId, sessionId: null, event, payload: payloadText, prevHash: prev, hash, createdAt: new Date(atIso) })
    .returning({ id: schema.chainLog.id });
  return rows[0]!.id;
}

// ---- Users, fleet, broker ----------------------------------------------------

const owner = await seedUser("auowner", "Olivia Owner");
const driver1 = await seedUser("audriver1", "Frank Driver");
const ownerB = await seedUser("auownerb", "Oscar Other");
const brokerUser = await seedUser("aubroker", "Bea Broker");

const fleetRows = await db
  .insert(schema.companies)
  .values({ name: "Autonomy Fleet LLC", ownerUsername: owner.username })
  .returning({ id: schema.companies.id });
const fleetA = fleetRows[0]!.id;
await db.insert(schema.companyMembers).values([
  { companyId: fleetA, username: owner.username, role: "owner" },
  { companyId: fleetA, username: driver1.username, role: "driver" },
]);
const fleetBRows = await db
  .insert(schema.companies)
  .values({ name: "Stranger Fleet LLC", ownerUsername: ownerB.username })
  .returning({ id: schema.companies.id });
await db.insert(schema.companyMembers).values({ companyId: fleetBRows[0]!.id, username: ownerB.username, role: "owner" });

const brokerRows = await db
  .insert(schema.brokerAccounts)
  .values({ name: "Bea Brokerage", email: brokerUser.email, ownerUsername: brokerUser.username, linkedUsername: brokerUser.username, status: "active" })
  .returning({ id: schema.brokerAccounts.id });
const brokerId = brokerRows[0]!.id;

const ownerCtx = ctxFor(owner);
const driver1Ctx = ctxFor(driver1);
const ownerBCtx = ctxFor(ownerB);
const brokerCtx = ctxFor(brokerUser);
const anonCtx = createInvocation({ executePrivileged: privStub as never, viewer: null }).ctx as unknown as CtxT;

// ---- Load 1: picked up, rate 4321 (must never leak), no appointment,
// ---- stale position -----------------------------------------------------------

const nowMs = Date.now();
const iso = (msAgo: number) => new Date(nowMs - msAgo).toISOString();
const HOUR = 3600_000;

const load1Rows = await db
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
    rate: 4321,
    status: "picked_up",
  })
  .returning({ id: schema.loads.id });
const load1 = load1Rows[0]!.id;
await addChain("load", load1, "load_saved", { loadId: load1 }, iso(5 * HOUR));
await addChain("load", load1, "pickup_sealed", { loadId: load1 }, iso(4 * HOUR));
// The driver's last fix is two hours old — stale at a milestone moment.
await db.insert(schema.driverPositions).values({ username: driver1.username, lat: 33.4, lon: -94.0, updatedAt: new Date(nowMs - 2 * HOUR) });

// Load 2: the broker's posted load, claimed by driver1, booked only.
const load2Rows = await db
  .insert(schema.loads)
  .values({
    profileId: driver1.profileId,
    shipper: "Broker Freight Co",
    pickupCity: "Dallas",
    pickupState: "TX",
    deliveryCity: "Austin",
    deliveryState: "TX",
    commodity: "lumber",
    weightLbs: 30000,
    rate: 7777,
    status: "booked",
  })
  .returning({ id: schema.loads.id });
const load2 = load2Rows[0]!.id;
await addChain("load", load2, "load_saved", { loadId: load2 }, iso(3 * HOUR));
const board2Rows = await db
  .insert(schema.boardLoads)
  .values({
    companyId: fleetA,
    postedBy: owner.username,
    pickupCity: "Dallas",
    pickupState: "TX",
    deliveryCity: "Austin",
    deliveryState: "TX",
    rate: 7777,
    status: "taken",
    claimedBy: driver1.username,
    loadId: load2,
  })
  .returning({ id: schema.boardLoads.id });
await db.insert(schema.brokerPosterLoads).values({
  brokerId,
  companyId: fleetA,
  createdBy: brokerUser.username,
  boardLoadId: board2Rows[0]!.id,
  pickupCity: "Dallas",
  pickupState: "TX",
  deliveryCity: "Austin",
  deliveryState: "TX",
});

// A detention record for load 2 with NO sealed chain event behind
// it — it must publish nothing (the chain is the only source).
await db.insert(schema.detentionRecords).values({
  profileId: driver1.profileId,
  loadId: load2,
  site: "pickup",
  placeLabel: "Dallas yard",
  arrivedAt: new Date(nowMs - 3 * HOUR),
  departedAt: new Date(nowMs - 1 * HOUR),
  graceMinutes: 60,
});

let trackToken = "";

describe("auto status — sealed milestones publish themselves", () => {
  test("creating the share evaluates: outbox gains booked + picked_up with chain evidence", async () => {
    const created = await Actions.createLoadShareLink.handler(driver1Ctx, { loadId: load1 } as never);
    expect(created.ok).toBe(true);
    trackToken = created.url!.split("/track/")[1]!;
    const outbox = await db.select().from(schema.statusOutbox).where(eq(schema.statusOutbox.loadId, load1)).orderBy(asc(schema.statusOutbox.id));
    expect(outbox.map((r) => r.kind)).toEqual(["booked", "picked_up"]);
    for (const row of outbox) {
      expect(row.confidence).toBe(1);
      expect(row.chainHash).not.toBeNull();
      const evidence = JSON.parse(row.evidenceJson) as { kind: string; ref: string }[];
      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence[0]!.kind).toBe("chain");
    }
    // Rate law: the seeded rate rides no outbox field.
    expect(JSON.stringify(outbox)).not.toContain("4321");
  });

  test("the public track page shows the timeline — and no rate anywhere", async () => {
    const info = await Actions.getTrackInfo.handler(anonCtx, { token: trackToken } as never);
    expect(info.valid).toBe(true);
    expect(info.timeline.map((t) => t.kind)).toEqual(["booked", "picked_up"]);
    expect(info.timeline.every((t) => t.corrected === false)).toBe(true);
    const blob = JSON.stringify(info);
    expect(blob).not.toContain("4321");
    expect(blob.toLowerCase()).not.toContain('"rate"');
  });

  test("re-evaluation is idempotent — no duplicate milestones", async () => {
    await Actions.getTrackInfo.handler(anonCtx, { token: trackToken } as never);
    const outbox = await db.select().from(schema.statusOutbox).where(eq(schema.statusOutbox.loadId, load1));
    expect(outbox.length).toBe(2);
  });

  test("a detention record with no chain event behind it publishes nothing", async () => {
    const auto = await Actions.getLoadAutonomy.handler(driver1Ctx, { loadId: load2 } as never);
    expect(auto.ok).toBe(true);
    expect(auto.updates.map((u) => u.kind)).toEqual(["booked"]);
    const outbox = await db.select().from(schema.statusOutbox).where(eq(schema.statusOutbox.loadId, load2));
    expect(outbox.map((r) => r.kind)).toEqual(["booked"]);
  });
});

describe("exception queues — one ranked queue per role", () => {
  test("the driver's queue holds the stale-location + missing-appointment exceptions", async () => {
    const q = await Actions.getExceptionQueue.handler(driver1Ctx, {} as never);
    const mine = q.items.filter((e) => e.loadId === load1);
    expect(mine.map((e) => e.kind).sort()).toEqual(["missing_appointment", "stale_location"]);
    // Ranked: severity 2 (stale) ahead of severity 1 (appointment).
    expect(mine[0]!.kind).toBe("stale_location");
    expect(mine[0]!.detail).toContain("minutes old");
    expect(q.counts.driver).toBeGreaterThanOrEqual(2);
  });

  test("the fleet owner sees the same load's exceptions; a stranger fleet sees none", async () => {
    const q = await Actions.getExceptionQueue.handler(ownerCtx, {} as never);
    expect(q.items.filter((e) => e.loadId === load1).length).toBeGreaterThanOrEqual(2);
    expect(q.counts.fleet).toBeGreaterThanOrEqual(2);
    const stranger = await Actions.getExceptionQueue.handler(ownerBCtx, {} as never);
    expect(stranger.items).toEqual([]);
  });

  test("the broker sees the queue for the load they posted", async () => {
    const q = await Actions.getExceptionQueue.handler(brokerCtx, {} as never);
    expect(q.counts.broker).toBeGreaterThanOrEqual(1);
    const theirs = q.items.filter((e) => e.loadId === load2);
    expect(theirs.map((e) => e.kind)).toContain("missing_appointment");
    // …and nothing for a load they didn't post.
    expect(q.items.filter((e) => e.loadId === load1)).toEqual([]);
  });

  test("new exceptions notified the responsible roles in-app (no email path exists)", async () => {
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, driver1.username));
    const system = notes.filter((n) => n.kind === "system");
    expect(system.length).toBeGreaterThanOrEqual(2);
    expect(system.some((n) => n.body.includes("Location gone stale"))).toBe(true);
    expect(system.some((n) => n.body.includes("No appointment on file"))).toBe(true);
    const ownerNotes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, owner.username));
    expect(ownerNotes.some((n) => n.kind === "system")).toBe(true);
  });
});

describe("resolves — supply the fact or dismiss with a note, never invent a status", () => {
  test("supplying the appointment seals exception_resolved and writes the fact", async () => {
    const q = await Actions.getExceptionQueue.handler(driver1Ctx, {} as never);
    const appt = q.items.find((e) => e.loadId === load1 && e.kind === "missing_appointment")!;
    const r = await Actions.resolveException.handler(driver1Ctx, {
      exceptionId: appt.id,
      resolution: "supplied_fact",
      note: "Dock confirmed by phone",
      appointmentAt: "2026-11-16T14:00:00.000Z",
    } as never);
    expect(r.ok).toBe(true);
    const row = (await db.select().from(schema.autoExceptions).where(eq(schema.autoExceptions.id, appt.id)))[0]!;
    expect(row.status).toBe("resolved");
    expect(row.resolution).toBe("supplied_fact");
    const load = (await db.select().from(schema.loads).where(eq(schema.loads.id, load1)))[0]!;
    expect(load.dockApptAt?.toISOString()).toBe("2026-11-16T14:00:00.000Z");
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "exception_resolved"));
    expect(seals.length).toBeGreaterThanOrEqual(1);
    const payload = JSON.parse(seals[seals.length - 1]!.payload) as Record<string, unknown>;
    expect(payload.appointmentAt).toBe("2026-11-16T14:00:00.000Z");
    expect(payload.by).toBe(driver1.username);
    // And it stays resolved — re-evaluation does not reopen it.
    const q2 = await Actions.getExceptionQueue.handler(driver1Ctx, {} as never);
    expect(q2.items.find((e) => e.loadId === load1 && e.kind === "missing_appointment")).toBeUndefined();
  });

  test("a supplied_fact that isn't the missing appointment is refused", async () => {
    const q = await Actions.getExceptionQueue.handler(driver1Ctx, {} as never);
    const stale = q.items.find((e) => e.loadId === load1 && e.kind === "stale_location")!;
    const r = await Actions.resolveException.handler(driver1Ctx, {
      exceptionId: stale.id,
      resolution: "supplied_fact",
      note: "trust me",
      appointmentAt: null,
    } as never);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("can't take a supplied fact");
  });

  test("a bare dismissal is refused; a dismissal with a note holds across re-evaluation", async () => {
    const q = await Actions.getExceptionQueue.handler(driver1Ctx, {} as never);
    const stale = q.items.find((e) => e.loadId === load1 && e.kind === "stale_location")!;
    const bare = await Actions.resolveException.handler(driver1Ctx, {
      exceptionId: stale.id,
      resolution: "dismissed",
      note: null,
      appointmentAt: null,
    } as never);
    expect(bare.ok).toBe(false);
    expect(bare.error).toContain("needs a short note");
    const noted = await Actions.resolveException.handler(driver1Ctx, {
      exceptionId: stale.id,
      resolution: "dismissed",
      note: "Driver parked for the night, rest break",
      appointmentAt: null,
    } as never);
    expect(noted.ok).toBe(true);
    // The position is still stale — but the episode was answered,
    // so the queue stays clear of it.
    const q2 = await Actions.getExceptionQueue.handler(driver1Ctx, {} as never);
    expect(q2.items.find((e) => e.loadId === load1 && e.kind === "stale_location")).toBeUndefined();
  });

  test("a stranger cannot resolve another fleet's exception", async () => {
    const q = await Actions.getExceptionQueue.handler(ownerCtx, {} as never);
    const any = q.items.find((e) => e.loadId === load2);
    expect(any).toBeDefined();
    const r = await Actions.resolveException.handler(ownerBCtx, {
      exceptionId: any!.id,
      resolution: "dismissed",
      note: "not mine to answer",
      appointmentAt: null,
    } as never);
    expect(r.ok).toBe(false);
  });
});

describe("corrections — every auto action is reversible (guardrail e)", () => {
  test("voiding a milestone seals the void and the track page shows the correction instead", async () => {
    const auto = await Actions.getLoadAutonomy.handler(driver1Ctx, { loadId: load1 } as never);
    const picked = auto.updates.find((u) => u.kind === "picked_up")!;
    const r = await Actions.voidAutoStatus.handler(driver1Ctx, { outboxId: picked.id, reason: "Pickup seal was for the wrong trailer" } as never);
    expect(r.ok).toBe(true);
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "auto_status_voided"));
    expect(seals.length).toBe(1);
    const info = await Actions.getTrackInfo.handler(anonCtx, { token: trackToken } as never);
    expect(info.timeline.map((t) => t.kind)).toEqual(["booked", "correction"]);
    expect(info.timeline[1]!.corrected).toBe(true);
    // The driver's own view still shows the original, marked superseded.
    const auto2 = await Actions.getLoadAutonomy.handler(driver1Ctx, { loadId: load1 } as never);
    expect(auto2.updates.find((u) => u.id === picked.id)!.superseded).toBe(true);
    // Voiding again is a no-op success, not a second correction.
    const again = await Actions.voidAutoStatus.handler(driver1Ctx, { outboxId: picked.id, reason: null } as never);
    expect(again.ok).toBe(true);
    const corrections = await db.select().from(schema.statusOutbox).where(eq(schema.statusOutbox.kind, "correction"));
    expect(corrections.length).toBe(1);
  });
});
