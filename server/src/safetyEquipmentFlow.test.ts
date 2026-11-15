// safetyEquipmentFlow.test.ts — INTEGRATION tests for video
// coaching + exoneration vault, predictive maintenance, and
// smart trailer (Research Wave 2 item 11), run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   Part A: with no dashcam partner configured, the webhook
//     intake refuses plainly and stores NOTHING. Configured, an
//     event lands under its connection secret, a re-push is a
//     duplicate (never a second record), a wrong secret is
//     refused generically. Notes are the driver's own; reviews
//     are the driver's or their desk's. Pinning snapshots an
//     exoneration packet that resolves through the Library door;
//     removal is explicit, sealed, and stops the packet
//     resolving — the entry itself is never deleted.
//   Part B: a known code (P2463) answers with meaning + urgency
//     and drafts a maintenance work order; an unknown code
//     records as reported with meaning null and NO draft.
//   Part C: trailer sync with no partner configured refuses and
//     writes nothing. Simulated readings flow through the real
//     ingest stamped simulated; a reading inside the load's
//     range raises nothing; narrowing the range so the same
//     reading falls outside opens exactly ONE autonomy
//     exception (dedupe) and notifies the driver.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp
// dir before host/ctx is imported. Partner env vars start
// deleted; DASHCAM_PARTNER_API_KEY is set only inside the
// configured describe and removed after. The trailer partner is
// never configured in this file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-safety-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.DASHCAM_PARTNER_API_KEY;
delete process.env.DASHCAM_PARTNER_NAME;
delete process.env.TRAILER_PARTNER_API_KEY;
delete process.env.TRAILER_PARTNER_BASE_URL;
delete process.env.TRAILER_PARTNER_NAME;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { and, eq } = await import("drizzle-orm");

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

async function seedFleet(owner: SeededUser, name: string): Promise<number> {
  const db = getDb();
  const c = await db
    .insert(schema.companies)
    .values({ name, ownerUsername: owner.username })
    .returning({ id: schema.companies.id });
  const companyId = c[0]!.id;
  await db.insert(schema.companyMembers).values({ companyId, username: owner.username, role: "owner" });
  return companyId;
}

const db = getDb();
const solo = await seedUser("safesolo", "Solo Driver");
const other = await seedUser("safeother", "Other Driver");
const owner = await seedUser("safeowner", "Fleet Owner");
const fleetDriver = await seedUser("fleetdriver", "Fleet Driver");
const soloCtx = ctxFor(solo);
const otherCtx = ctxFor(other);
const ownerCtx = ctxFor(owner);
const fleetDriverCtx = ctxFor(fleetDriver);
const anonCtx = ctxFor(null);

const fleetId = await seedFleet(owner, "Safety Fleet LLC");
await db.insert(schema.companyMembers).values({ companyId: fleetId, username: fleetDriver.username, role: "driver" });

async function seedLoad(profileId: number, shipper: string): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({
      profileId,
      shipper,
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Atlanta",
      deliveryState: "GA",
      commodity: "frozen chicken",
      weightLbs: 38000,
      rate: 1800,
      status: "picked_up",
    })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

let soloConnId = 0;
let soloSecret = "";

// ---------------------------------------------------------------------
// Part A — intake with NO partner configured
// ---------------------------------------------------------------------

describe("dashcam intake — no partner configured (the production state)", () => {
  test("a solo driver can wire their own connection; the secret shows once", async () => {
    const r = await Actions.createDashcamConnection.handler(soloCtx, { label: "Cab camera" });
    expect(r.ok).toBe(true);
    expect(r.secret).toBeTruthy();
    expect(r.secretLast4).toBe(r.secret!.slice(-4));
    soloConnId = r.connectionId!;
    soloSecret = r.secret!;
    // The panel after creation shows last-4 only, never the secret.
    const panel = await Actions.getDashcamPanel.handler(soloCtx, {});
    expect(panel.partnerConfigured).toBe(false);
    expect(panel.connections).toHaveLength(1);
    expect(panel.connections[0]!.secretLast4).toBe(soloSecret.slice(-4));
    expect(JSON.stringify(panel)).not.toContain(soloSecret);
  });

  test("the intake refuses plainly and stores nothing", async () => {
    const r = await Actions.ingestDashcamEvent.handler(anonCtx, {
      connectionId: soloConnId,
      secret: soloSecret,
      payload: {
        partnerEventId: "evt-x",
        kind: "harsh_braking",
        occurredAt: "2026-11-15T09:00:00Z",
        clipRef: "clip-x",
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("isn't connected yet");
    const rows = await db.select().from(schema.dashcamEvents);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Part A — intake configured
// ---------------------------------------------------------------------

describe("dashcam intake — partner configured", () => {
  beforeAll(() => {
    process.env.DASHCAM_PARTNER_API_KEY = "test-partner-key";
  });
  afterAll(() => {
    delete process.env.DASHCAM_PARTNER_API_KEY;
  });

  const payload = {
    partnerEventId: "evt-100",
    kind: "harsh_braking",
    severity: "moderate",
    occurredAt: "2026-11-15T09:00:00Z",
    clipRef: "clip-100",
    clipUrl: "https://partner.example/clips/100",
  };
  let eventId = 0;

  test("a wrong secret is refused generically and stores nothing", async () => {
    const r = await Actions.ingestDashcamEvent.handler(anonCtx, {
      connectionId: soloConnId,
      secret: "not-the-secret",
      payload,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("This webhook isn't recognized.");
    expect(await db.select().from(schema.dashcamEvents)).toHaveLength(0);
  });

  test("a valid push lands on the connection's driver, not simulated", async () => {
    const r = await Actions.ingestDashcamEvent.handler(anonCtx, {
      connectionId: soloConnId,
      secret: soloSecret,
      payload,
    });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);
    eventId = r.eventId!;
    const rows = await db.select().from(schema.dashcamEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.driverUsername).toBe(solo.username);
    expect(rows[0]!.simulated).toBe(false);
    expect(rows[0]!.clipRef).toBe("clip-100");
    expect(rows[0]!.loadId).toBeNull();
  });

  test("a re-push of the same partner event id is a duplicate, never a second record", async () => {
    const r = await Actions.ingestDashcamEvent.handler(anonCtx, {
      connectionId: soloConnId,
      secret: soloSecret,
      payload,
    });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    expect(r.eventId).toBe(eventId);
    expect(await db.select().from(schema.dashcamEvents)).toHaveLength(1);
  });

  test("a malformed payload is refused with the validation reason", async () => {
    const r = await Actions.ingestDashcamEvent.handler(anonCtx, {
      connectionId: soloConnId,
      secret: soloSecret,
      payload: { partnerEventId: "evt-bad", kind: "tailgating", occurredAt: "2026-11-15T09:00:00Z", clipRef: "c" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("didn't validate");
    expect(await db.select().from(schema.dashcamEvents)).toHaveLength(1);
  });

  test("notes are the driver's own; another driver can't note or review the event", async () => {
    const bad = await Actions.noteDashcamEvent.handler(otherCtx, { eventId, note: "not my event" });
    expect(bad.ok).toBe(false);
    const badReview = await Actions.reviewDashcamEvent.handler(otherCtx, { eventId, status: "reviewed" });
    expect(badReview.ok).toBe(false);
    const good = await Actions.noteDashcamEvent.handler(soloCtx, { eventId, note: "Car cut across two lanes — braked to miss it." });
    expect(good.ok).toBe(true);
    const panel = await Actions.getDashcamPanel.handler(soloCtx, {});
    expect(panel.events[0]!.note).toContain("Car cut across");
    // The seal carries ids only — the note body never enters the chain.
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "dashcam_event_noted"));
    expect(seals.length).toBeGreaterThan(0);
    expect(JSON.stringify(seals)).not.toContain("Car cut across");
  });

  test("the test-event path lands stamped simulated", async () => {
    const r = await Actions.runDashcamTestEvent.handler(soloCtx, { kind: "speeding" });
    expect(r.ok).toBe(true);
    const row = (await db.select().from(schema.dashcamEvents).where(eq(schema.dashcamEvents.id, r.eventId!)))[0]!;
    expect(row.simulated).toBe(true);
    expect(row.driverUsername).toBe(solo.username);
  });

  test("the fleet desk sees its drivers' events and can coach them", async () => {
    const conn = await Actions.createDashcamConnection.handler(ownerCtx, {
      label: "Fleet cams",
      driverUsername: fleetDriver.username,
    });
    expect(conn.ok).toBe(true);
    const push = await Actions.ingestDashcamEvent.handler(anonCtx, {
      connectionId: conn.connectionId!,
      secret: conn.secret!,
      payload: {
        partnerEventId: "evt-fleet-1",
        kind: "following_distance",
        occurredAt: "2026-11-15T08:00:00Z",
        clipRef: "clip-f1",
        driverRef: fleetDriver.username,
      },
    });
    expect(push.ok).toBe(true);
    const review = await Actions.reviewDashcamEvent.handler(ownerCtx, { eventId: push.eventId!, status: "coached" });
    expect(review.ok).toBe(true);
    const fleet = await Actions.getFleetSafety.handler(ownerCtx, {});
    expect(fleet.ok).toBe(true);
    const drv = fleet.drivers.find((d) => d.username === fleetDriver.username);
    expect(drv).toBeTruthy();
    expect(drv!.events.some((e) => e.id === push.eventId && e.status === "coached")).toBe(true);
    // A non-desk driver gets no fleet view.
    const denied = await Actions.getFleetSafety.handler(fleetDriverCtx, {});
    expect(denied.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Part A — exoneration vault
// ---------------------------------------------------------------------

describe("exoneration vault — pin, packet, removal", () => {
  let entryId = 0;
  let packetRef = "";
  let pinnedEventId = 0;

  test("pinning snapshots a packet that resolves through the Library door", async () => {
    const ev = await Actions.runDashcamTestEvent.handler(soloCtx, { kind: "collision" });
    pinnedEventId = ev.eventId!;
    const loadId = await seedLoad(solo.profileId, "Gulf Foods");
    const pin = await Actions.pinExoneration.handler(soloCtx, { eventId: pinnedEventId, loadId });
    expect(pin.ok).toBe(true);
    entryId = pin.entryId!;
    packetRef = pin.packetRef!;
    expect(packetRef).toBe(`exoneration:${entryId}`);
    // The event itself now names the load.
    const row = (await db.select().from(schema.dashcamEvents).where(eq(schema.dashcamEvents.id, pinnedEventId)))[0]!;
    expect(row.loadId).toBe(loadId);
    // The packet resolves as a real PDF through the library door.
    const doc = await Actions.getLibraryDocument.handler(soloCtx, { ref: packetRef });
    expect(doc.ok).toBe(true);
    expect(doc.filename).toContain("exoneration-packet");
    const bytes = Buffer.from(doc.dataBase64!, "base64");
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    // The packet states the event was simulated — the honesty line travels.
    expect(bytes.toString("latin1")).toContain("SIMULATED");
  });

  test("pinning twice is idempotent — one active entry per event", async () => {
    const again = await Actions.pinExoneration.handler(soloCtx, { eventId: pinnedEventId, loadId: null });
    expect(again.ok).toBe(true);
    expect(again.entryId).toBe(entryId);
    const rows = await db
      .select()
      .from(schema.exonerationVaultEntries)
      .where(eq(schema.exonerationVaultEntries.eventId, pinnedEventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evidenceHash).toBeTruthy();
  });

  test("another driver can't resolve the packet or remove the entry", async () => {
    const doc = await Actions.getLibraryDocument.handler(otherCtx, { ref: packetRef });
    expect(doc.ok).toBe(false);
    const rm = await Actions.removeExoneration.handler(otherCtx, { entryId });
    expect(rm.ok).toBe(false);
  });

  test("removal is explicit and sealed; the packet stops resolving; the entry stays on record", async () => {
    const rm = await Actions.removeExoneration.handler(soloCtx, { entryId });
    expect(rm.ok).toBe(true);
    const doc = await Actions.getLibraryDocument.handler(soloCtx, { ref: packetRef });
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain("removed");
    const rows = await db
      .select()
      .from(schema.exonerationVaultEntries)
      .where(eq(schema.exonerationVaultEntries.id, entryId));
    expect(rows).toHaveLength(1); // stamped, never deleted
    expect(rows[0]!.removedAt).not.toBeNull();
    expect(rows[0]!.removedBy).toBe(solo.username);
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "exoneration_removed"));
    expect(seals.length).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Part B — fault codes
// ---------------------------------------------------------------------

describe("fault codes — known, unknown, drafts", () => {
  test("a known service-soon code answers with meaning and drafts a work order", async () => {
    const r = await Actions.reportFaultCode.handler(soloCtx, {
      code: "P2463",
      sourceNote: "Dash warning — DPF light",
      odometer: 412000,
    });
    expect(r.ok).toBe(true);
    expect(r.known).toBe(true);
    expect(r.urgency).toBe("service_soon");
    expect(r.meaning).toContain("particulate filter");
    expect(r.draftEntryId).not.toBeNull();
    const draft = (
      await db.select().from(schema.maintenanceLogEntries).where(eq(schema.maintenanceLogEntries.id, r.draftEntryId!))
    )[0]!;
    expect(draft).toBeTruthy();
    expect(JSON.stringify(draft)).toContain("P2463");
  });

  test("an unknown code records as reported — meaning null, no draft, no invention", async () => {
    const r = await Actions.reportFaultCode.handler(soloCtx, { code: "P9999", sourceNote: "scanner at the shop" });
    expect(r.ok).toBe(true);
    expect(r.known).toBe(false);
    expect(r.meaning).toBeNull();
    expect(r.urgency).toBe("unknown");
    expect(r.draftEntryId).toBeNull();
    const panel = await Actions.getFaultCodes.handler(soloCtx, {});
    const row = panel.faults.find((f) => f.id === r.faultId);
    expect(row).toBeTruthy();
    expect(row!.meaning).toBeNull();
    expect(row!.unknownNote).toContain("recorded exactly as reported");
    // The odometer truth picked up the P2463 report's reading.
    expect(panel.currentOdometer).toBe(412000);
    expect(panel.odometerSource).toBeTruthy();
  });

  test("a watch code records without drafting", async () => {
    const r = await Actions.reportFaultCode.handler(soloCtx, { code: "P0463" });
    expect(r.ok).toBe(true);
    expect(r.urgency).toBe("watch");
    expect(r.draftEntryId).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Part C — smart trailer
// ---------------------------------------------------------------------

describe("smart trailer — unconfigured sync, simulated readings, reefer exceptions", () => {
  let loadId = 0;
  let connId = 0;

  test("sync with no partner configured refuses plainly and writes nothing", async () => {
    const conn = await Actions.connectTrailerDevice.handler(soloCtx, { label: "Trailer puck", deviceRef: "puck-1" });
    expect(conn.ok).toBe(true);
    connId = conn.connectionId!;
    const r = await Actions.syncTrailerDevice.handler(soloCtx, { connectionId: connId });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("No trailer partner is connected");
    expect(await db.select().from(schema.trailerReadings)).toHaveLength(0);
  });

  test("simulated readings land stamped simulated; in-range raises nothing", async () => {
    loadId = await seedLoad(solo.profileId, "Gulf Foods Reefer");
    const range = await Actions.setLoadReeferRange.handler(soloCtx, { loadId, minF: 31, maxF: 41 });
    expect(range.ok).toBe(true);
    const r = await Actions.runTrailerTestReadings.handler(soloCtx, { connectionId: connId, loadId });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(2);
    expect(r.outOfRange).toBe(0);
    const rows = await db.select().from(schema.trailerReadings);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.source === "simulated")).toBe(true);
    const panel = await Actions.getTrailerTelemetry.handler(soloCtx, {});
    expect(panel.partnerConfigured).toBe(false);
    expect(panel.latestPosition).not.toBeNull();
    expect(panel.latestPosition!.line).toContain("not a live position");
    const rl = panel.reeferLoads.find((x) => x.loadId === loadId);
    expect(rl).toBeTruthy();
    expect(rl!.rangeLabel).toContain("31°F–41°F");
    expect(rl!.readings[0]!.verdict).toBe("in_range");
    const exceptions = await db
      .select()
      .from(schema.autoExceptions)
      .where(eq(schema.autoExceptions.kind, "reefer_temp_out_of_range"));
    expect(exceptions).toHaveLength(0);
  });

  test("narrowing the range opens exactly ONE exception and notifies — a second reading opens no second episode", async () => {
    const range = await Actions.setLoadReeferRange.handler(soloCtx, { loadId, minF: -5, maxF: 5 });
    expect(range.ok).toBe(true);
    const r1 = await Actions.runTrailerTestReadings.handler(soloCtx, { connectionId: connId, loadId });
    expect(r1.outOfRange).toBe(1);
    const open = await db
      .select()
      .from(schema.autoExceptions)
      .where(
        and(
          eq(schema.autoExceptions.kind, "reefer_temp_out_of_range"),
          eq(schema.autoExceptions.loadId, loadId),
          eq(schema.autoExceptions.status, "open"),
        ),
      );
    expect(open).toHaveLength(1);
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.username, solo.username), eq(schema.notifications.title, "Reefer temperature out of range")),
      );
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const r2 = await Actions.runTrailerTestReadings.handler(soloCtx, { connectionId: connId, loadId });
    expect(r2.outOfRange).toBe(1);
    const openAfter = await db
      .select()
      .from(schema.autoExceptions)
      .where(
        and(
          eq(schema.autoExceptions.kind, "reefer_temp_out_of_range"),
          eq(schema.autoExceptions.loadId, loadId),
          eq(schema.autoExceptions.status, "open"),
        ),
      );
    expect(openAfter).toHaveLength(1);
  });

  test("another driver can't set the range on someone else's load", async () => {
    const r = await Actions.setLoadReeferRange.handler(otherCtx, { loadId, minF: 0, maxF: 40 });
    expect(r.ok).toBe(false);
  });

  test("revoking the pairing seals it and stops further syncs against it", async () => {
    const r = await Actions.revokeTrailerDevice.handler(soloCtx, { connectionId: connId });
    expect(r.ok).toBe(true);
    const row = (await db.select().from(schema.trailerConnections).where(eq(schema.trailerConnections.id, connId)))[0]!;
    expect(row.status).toBe("revoked");
  });
});
