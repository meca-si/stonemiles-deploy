// driverCalendarFlow.test.ts — INTEGRATION tests for the Driver
// Calendar build (Research Wave 2 item 10.5, migration 0138), run
// against the REAL action handlers over a throwaway migrated
// SQLite database:
//
//   (a) settings: offered/24h/no-cycle defaults; owner-only writes;
//       a settings change seals.
//   (b) OFFERED mode: assignment is an offer on the calendar;
//       declining inside the safety window is refused (locked) and
//       the release-request door opens instead; the desk's
//       approval recycles the load to open.
//   (c) OFFERED decline before the window recycles at once, with
//       the reason on the row.
//   (d) ASSIGNED mode: assignment binds immediately (row taken,
//       no offer), the driver is notified, and the load + trip
//       materialize in the DRIVER's own session on their next
//       read — the sealed record is born in their profile.
//   (e) bound decline before the window recycles + removes the
//       driver's load in their own session; inside the window it
//       is refused; a denied release leaves the load bound; an
//       approved release recycles and the driver's copy is swept
//       on their next read.
//   (f) off-duty requests: Offered fleet → effective as stated,
//       with a commitment shadow the gate reads; cancel voids the
//       shadow. Assigned fleet → pending until the desk decides;
//       approval creates the shadow, denial creates none. A
//       sub-34h reset is refused.
//   (g) reassignment: consent fires the move (old driver's load
//       closes in their session; the new driver materializes on
//       their next read); refusal leaves the load; DISPATCH
//       cannot override a refusal; the OWNER can, with a reason —
//       and the old driver's copy is swept on their next read.
//   (h) role gating: a company driver cannot read the fleet grid.
//   (i) paydays: the fleet's stated weekly cycle projects
//       "expected" paydays; an accepted pay stub on the date
//       flips it to "paid". No cycle → no paydays.
//   (j) credential markers: a medical card expiring in 20 days
//       puts the 30/7-day warnings and the expiry flag on the
//       calendar.
//   (k) RATE LAW: seeded rate / pay figures never appear in any
//       calendar payload.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp
// dir before host/ctx is imported. Every driver who binds loads
// carries a complete DQF (the item-6 gate runs first in the same
// funnels) — recorded through the real saveDqfEntry action.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-calendar-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { and, eq } = await import("drizzle-orm");

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

async function seedUser(username: string): Promise<SeededUser> {
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
      plan: "diamond",
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 7,
      dieselPrice: 4,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
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
const DAY = 86_400_000;
const HOUR = 3_600_000;
const dateOnly = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString().slice(0, 10);
const isoAt = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const windowArgs = { fromIso: isoAt(-40 * DAY), toIso: isoAt(80 * DAY) };

const owner = await seedUser("calowner");
const dispatch = await seedUser("caldispatch");
const driverA = await seedUser("caldriver");
const driverB = await seedUser("caldriver2");
const driverC = await seedUser("caldriver3");

const fleet = await seedFleet(owner, "Calendar Fleet LLC");
await db.insert(schema.companyMembers).values({ companyId: fleet, username: dispatch.username, role: "dispatch" });
await db.insert(schema.companyMembers).values({ companyId: fleet, username: driverA.username, role: "driver" });
await db.insert(schema.companyMembers).values({ companyId: fleet, username: driverB.username, role: "driver" });
await db.insert(schema.companyMembers).values({ companyId: fleet, username: driverC.username, role: "driver" });

const ownerCtx = ctxFor(owner);
const dispatchCtx = ctxFor(dispatch);
const aCtx = ctxFor(driverA);
const bCtx = ctxFor(driverB);
const cCtx = ctxFor(driverC);

async function saveEntry(driver: string, kind: string, entryDate: string, expiresOn: string | null, payload: Record<string, unknown>): Promise<void> {
  const r = await Actions.saveDqfEntry.handler(ownerCtx, {
    driverUsername: driver,
    kind,
    entryDate,
    expiresOn,
    payloadJson: JSON.stringify(payload),
    dataBase64: null,
    mime: null,
  } as never);
  expect(r.ok).toBe(true);
}

async function recordCompleteFile(driver: string) {
  await saveEntry(driver, "application", dateOnly(-300 * DAY), null, {});
  await saveEntry(driver, "cdl", dateOnly(-600 * DAY), dateOnly(400 * DAY), { state: "AL", licenseClass: "A" });
  await saveEntry(driver, "medical", dateOnly(-100 * DAY), dateOnly(400 * DAY), { examinerName: "Dr. A", registryNumber: "12345" });
  await saveEntry(driver, "road_test", dateOnly(-299 * DAY), null, { examinerName: "Tester" });
  await saveEntry(driver, "mvr_review", dateOnly(-30 * DAY), null, { outcome: "acceptable" });
  await saveEntry(driver, "clearinghouse_query", dateOnly(-301 * DAY), null, { queryType: "pre_employment", result: "clear" });
  await saveEntry(driver, "employment_history", dateOnly(-300 * DAY), null, { employer: "Prior Carrier LLC" });
  await saveEntry(driver, "violation_record", dateOnly(-30 * DAY), null, { description: "No violations in the past year" });
}

await recordCompleteFile(driverA.username);
await recordCompleteFile(driverB.username);
await recordCompleteFile(driverC.username);

const boardFields = {
  shipper: "Acme Steel",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
  pickupText: "Mon 8a",
  deliveryText: "Wed 5p",
  rate: 4321,
  loadedMiles: null,
  milesSource: null,
  extraCharges: 0,
  extraChargesNote: null,
  weightLbs: 40000,
  commodity: "steel coils",
  hazmat: false,
  equipmentType: "flatbed" as const,
  notes: null,
  brokerName: null,
  brokerCompany: null,
  brokerMc: null,
  referenceNumber: "CAL-1",
};

async function postLoad(pickupInMs: number, deliveryInMs: number): Promise<number> {
  const r = await Actions.postBoardLoad.handler(ownerCtx, {
    ...boardFields,
    pickupApptAt: isoAt(pickupInMs),
    deliveryApptAt: isoAt(deliveryInMs),
  } as never);
  expect(r.ok).toBe(true);
  return r.id!;
}

async function boardRow(id: number) {
  const rows = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, id));
  return rows[0]!;
}

async function chainCount(event: string): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event));
  return rows.length;
}

async function driverLoadIds(ctx: CtxT): Promise<number[]> {
  const r = await Actions.listLoads.handler(ctx, { limit: 50 } as never);
  return r.loads.map((l) => l.id);
}

async function setSettings(ctx: CtxT, args: Record<string, unknown>) {
  return Actions.setFleetCalendarSettings.handler(ctx, {
    dispatchMode: "offered",
    safetyWindowHours: 24,
    payCycleKind: "none",
    payWeekday: null,
    payAnchorOn: null,
    ...args,
  } as never);
}

describe("driver calendar flow", () => {
  test("(a) settings default to offered/24h/no-cycle; owner-only; writes seal", async () => {
    const cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    expect(cal.ok).toBe(true);
    expect(cal.settings?.dispatchMode).toBe("offered");
    expect(cal.settings?.safetyWindowHours).toBe(24);
    expect(cal.settings?.payCycleKind).toBe("none");

    const byDispatch = await setSettings(dispatchCtx, { dispatchMode: "assigned" });
    expect(byDispatch.ok).toBe(false);
    const byDriver = await setSettings(aCtx, { dispatchMode: "assigned" });
    expect(byDriver.ok).toBe(false);

    const before = await chainCount("fleet_calendar_settings_updated");
    const byOwner = await setSettings(ownerCtx, {});
    expect(byOwner.ok).toBe(true);
    expect(await chainCount("fleet_calendar_settings_updated")).toBe(before + 1);
  });

  test("(b) offered assignment shows as an offer; inside the window it locks; release approval recycles", async () => {
    const id = await postLoad(12 * HOUR, 2 * DAY); // pickup inside the 24h window
    const asg = await Actions.assignBoardLoad.handler(ownerCtx, { id, targetUsername: driverA.username, homeTimeOverride: null } as never);
    expect(asg.ok).toBe(true);
    expect((await boardRow(id)).status).toBe("assigned");

    const cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    expect(cal.pendingOffers.map((o) => o.boardLoadId)).toContain(id);
    expect(cal.pendingOffers.find((o) => o.boardLoadId === id)?.locked).toBe(true);
    const evt = cal.events.find((e) => e.boardLoadId === id);
    expect(evt?.state).toBe("offered");

    // Locked: a plain decline is refused, with the release door named.
    const decline = await Actions.declineAssignedLoad.handler(aCtx, { id, reason: "Can't make it" } as never);
    expect(decline.ok).toBe(false);
    expect(decline.error).toContain("safety window");
    expect((await boardRow(id)).status).toBe("assigned");

    // Release request → desk approval → back to open.
    const rel = await Actions.requestLoadRelease.handler(aCtx, { id, reason: "Truck is in the shop" } as never);
    expect(rel.ok).toBe(true);
    const grid = await Actions.getFleetCalendar.handler(dispatchCtx, windowArgs as never);
    expect(grid.ok).toBe(true);
    expect(grid.pendingReleases.map((r) => r.id)).toContain(rel.requestId!);
    const decide = await Actions.decideLoadRelease.handler(dispatchCtx, { id: rel.requestId!, approve: true, note: null } as never);
    expect(decide.ok).toBe(true);
    expect((await boardRow(id)).status).toBe("open");
    expect(await chainCount("load_release_approved")).toBeGreaterThan(0);
  });

  test("(c) offered decline before the window recycles at once with the reason on the row", async () => {
    const id = await postLoad(72 * HOUR, 5 * DAY);
    await Actions.assignBoardLoad.handler(ownerCtx, { id, targetUsername: driverA.username, homeTimeOverride: null } as never);
    const decline = await Actions.declineAssignedLoad.handler(aCtx, { id, reason: "Home time that weekend" } as never);
    expect(decline.ok).toBe(true);
    const row = await boardRow(id);
    expect(row.status).toBe("open");
    expect(row.declineReason).toBe("Home time that weekend");
    expect(row.declinedBy).toBe(driverA.username);
  });

  test("(d) assigned mode binds at once, notifies, and materializes in the driver's own session", async () => {
    const set = await setSettings(ownerCtx, { dispatchMode: "assigned" });
    expect(set.ok).toBe(true);
    const id = await postLoad(72 * HOUR, 5 * DAY);
    const asg = await Actions.assignBoardLoad.handler(dispatchCtx, { id, targetUsername: driverA.username, homeTimeOverride: null } as never);
    expect(asg.ok).toBe(true);
    let row = await boardRow(id);
    expect(row.status).toBe("taken");
    expect(row.claimedBy).toBe(driverA.username);
    expect(row.loadId).toBeNull(); // not yet born — the driver's session births it

    const notes = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.username, driverA.username), eq(schema.notifications.title, "Load assigned to you")));
    expect(notes.length).toBeGreaterThan(0);

    // The driver's next calendar read materializes the load.
    const cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    expect(cal.ok).toBe(true);
    row = await boardRow(id);
    expect(row.loadId).not.toBeNull();
    expect(await driverLoadIds(aCtx)).toContain(row.loadId!);
    const evt = cal.events.find((e) => e.boardLoadId === id);
    expect(evt?.state).toBe("committed");
    expect(cal.nextMove?.boardLoadId).toBe(id);
    // Back to offered for the following tests.
    await setSettings(ownerCtx, { dispatchMode: "offered" });
  });

  test("(e) bound decline recycles before the window; inside it, release denial keeps the load, approval sweeps the copy", async () => {
    // Bind A to a load the offered way (assign + accept).
    const id1 = await postLoad(72 * HOUR, 5 * DAY);
    await Actions.assignBoardLoad.handler(ownerCtx, { id: id1, targetUsername: driverA.username, homeTimeOverride: null } as never);
    const acc = await Actions.acceptAssignedLoad.handler(aCtx, { id: id1, homeTimeOverride: null } as never);
    expect(acc.ok).toBe(true);
    const loadId1 = acc.loadId!;
    expect(await driverLoadIds(aCtx)).toContain(loadId1);

    const decline = await Actions.declineBoundLoad.handler(aCtx, { id: id1, reason: "Family emergency" } as never);
    expect(decline.ok).toBe(true);
    expect((await boardRow(id1)).status).toBe("open");
    expect(await driverLoadIds(aCtx)).not.toContain(loadId1);
    expect(await chainCount("board_load_bound_declined")).toBe(1);

    // Inside the window: decline refused; release denied → still
    // bound; release approved → recycled + copy swept on A's read.
    const id2 = await postLoad(10 * HOUR, 2 * DAY);
    await Actions.assignBoardLoad.handler(ownerCtx, { id: id2, targetUsername: driverA.username, homeTimeOverride: null } as never);
    const acc2 = await Actions.acceptAssignedLoad.handler(aCtx, { id: id2, homeTimeOverride: null } as never);
    expect(acc2.ok).toBe(true);
    const loadId2 = acc2.loadId!;
    const locked = await Actions.declineBoundLoad.handler(aCtx, { id: id2, reason: "Too tight" } as never);
    expect(locked.ok).toBe(false);
    expect(locked.error).toContain("safety window");

    const rel1 = await Actions.requestLoadRelease.handler(aCtx, { id: id2, reason: "Breakdown risk" } as never);
    expect(rel1.ok).toBe(true);
    const deny = await Actions.decideLoadRelease.handler(ownerCtx, { id: rel1.requestId!, approve: false, note: "Cover it — you're the only truck in range." } as never);
    expect(deny.ok).toBe(true);
    expect((await boardRow(id2)).status).toBe("taken");
    expect(await driverLoadIds(aCtx)).toContain(loadId2);

    const rel2 = await Actions.requestLoadRelease.handler(aCtx, { id: id2, reason: "Truck died" } as never);
    expect(rel2.ok).toBe(true);
    const approve = await Actions.decideLoadRelease.handler(ownerCtx, { id: rel2.requestId!, approve: true, note: null } as never);
    expect(approve.ok).toBe(true);
    expect((await boardRow(id2)).status).toBe("open");
    // The desk couldn't delete A's copy — A's next read sweeps it.
    expect(await driverLoadIds(aCtx)).not.toContain(loadId2);
    expect(await chainCount("driver_load_handback_swept")).toBeGreaterThan(0);
  });

  test("(f) off-duty requests: offered = effective as stated + shadow; assigned = desk decides; cancel voids", async () => {
    // Offered fleet: a medical request takes effect at once.
    const r1 = await Actions.requestOffDuty.handler(aCtx, {
      type: "medical",
      startsAtIso: isoAt(6 * DAY),
      endsAtIso: isoAt(6 * DAY + 4 * HOUR),
      note: "DOT physical",
    } as never);
    expect(r1.ok).toBe(true);
    expect(r1.status).toBe("approved");
    const reqRows = await db.select().from(schema.offDutyRequests).where(eq(schema.offDutyRequests.id, r1.requestId!));
    expect(reqRows[0]?.commitmentId).not.toBeNull();
    const shadow = await db
      .select()
      .from(schema.homeTimeCommitments)
      .where(eq(schema.homeTimeCommitments.id, reqRows[0]!.commitmentId!));
    expect(shadow[0]?.setBy).toBe("driver");
    expect(shadow[0]?.kind).toBe("by_date");

    // A sub-34h reset is refused.
    const badReset = await Actions.requestOffDuty.handler(aCtx, {
      type: "reset",
      startsAtIso: isoAt(3 * DAY),
      endsAtIso: isoAt(3 * DAY + 20 * HOUR),
      note: null,
    } as never);
    expect(badReset.ok).toBe(false);

    // A proper reset block is fine.
    const rReset = await Actions.requestOffDuty.handler(aCtx, {
      type: "reset",
      startsAtIso: isoAt(3 * DAY),
      endsAtIso: isoAt(3 * DAY + 40 * HOUR),
      note: null,
    } as never);
    expect(rReset.ok).toBe(true);

    // Cancel voids the shadow.
    const cancel = await Actions.cancelOffDutyRequest.handler(aCtx, { id: r1.requestId! } as never);
    expect(cancel.ok).toBe(true);
    const shadowAfter = await db
      .select()
      .from(schema.homeTimeCommitments)
      .where(eq(schema.homeTimeCommitments.id, reqRows[0]!.commitmentId!));
    expect(shadowAfter[0]?.voidedAt).not.toBeNull();

    // Assigned fleet: the request waits; approval shadows it,
    // denial doesn't.
    await setSettings(ownerCtx, { dispatchMode: "assigned" });
    const r2 = await Actions.requestOffDuty.handler(aCtx, {
      type: "home_time",
      startsAtIso: isoAt(10 * DAY),
      endsAtIso: isoAt(12 * DAY),
      note: null,
    } as never);
    expect(r2.ok).toBe(true);
    expect(r2.status).toBe("pending");
    const grid = await Actions.getFleetCalendar.handler(dispatchCtx, windowArgs as never);
    expect(grid.pendingOffDuty.map((r) => r.id)).toContain(r2.requestId!);
    const calA = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    expect(calA.events.some((e) => e.kind === "off_duty_pending" && e.requestId === r2.requestId)).toBe(true);
    const approve = await Actions.decideOffDutyRequest.handler(dispatchCtx, { id: r2.requestId!, approve: true, note: null } as never);
    expect(approve.ok).toBe(true);
    const req2 = await db.select().from(schema.offDutyRequests).where(eq(schema.offDutyRequests.id, r2.requestId!));
    expect(req2[0]?.commitmentId).not.toBeNull();

    const r3 = await Actions.requestOffDuty.handler(aCtx, {
      type: "personal",
      startsAtIso: isoAt(20 * DAY),
      endsAtIso: isoAt(21 * DAY),
      note: null,
    } as never);
    const deny = await Actions.decideOffDutyRequest.handler(ownerCtx, { id: r3.requestId!, approve: false, note: "Peak week — pick another." } as never);
    expect(deny.ok).toBe(true);
    const req3 = await db.select().from(schema.offDutyRequests).where(eq(schema.offDutyRequests.id, r3.requestId!));
    expect(req3[0]?.status).toBe("denied");
    expect(req3[0]?.commitmentId).toBeNull();
    await setSettings(ownerCtx, { dispatchMode: "offered" });
  });

  test("(g) reassignment: consent moves it; refusal holds; dispatch can't override; the owner can, with a reason", async () => {
    // Consent path.
    const id1 = await postLoad(30 * DAY, 32 * DAY);
    await Actions.assignBoardLoad.handler(ownerCtx, { id: id1, targetUsername: driverC.username, homeTimeOverride: null } as never);
    const acc = await Actions.acceptAssignedLoad.handler(cCtx, { id: id1, homeTimeOverride: null } as never);
    expect(acc.ok).toBe(true);
    const aLoadId = acc.loadId!;
    const prop = await Actions.proposeReassignment.handler(dispatchCtx, {
      id: id1,
      targetUsername: driverB.username,
      reason: "B is staged in Dallas already",
      homeTimeOverride: null,
    } as never);
    expect(prop.ok).toBe(true);
    const calA = await Actions.getCalendar.handler(cCtx, windowArgs as never);
    expect(calA.pendingReassignments.map((p) => p.id)).toContain(prop.proposalId!);
    expect(calA.pendingReassignments[0]?.reason).toBe("B is staged in Dallas already");
    const consent = await Actions.respondReassignment.handler(cCtx, { id: prop.proposalId!, consent: true } as never);
    expect(consent.ok).toBe(true);
    let row = await boardRow(id1);
    expect(row.claimedBy).toBe(driverB.username);
    expect(row.loadId).toBeNull();
    expect(await driverLoadIds(cCtx)).not.toContain(aLoadId);
    const calB = await Actions.getCalendar.handler(bCtx, windowArgs as never);
    expect(calB.events.some((e) => e.boardLoadId === id1)).toBe(true);
    row = await boardRow(id1);
    expect(row.loadId).not.toBeNull(); // materialized in B's session

    // Refusal path.
    const id2 = await postLoad(30 * DAY, 32 * DAY);
    await Actions.assignBoardLoad.handler(ownerCtx, { id: id2, targetUsername: driverC.username, homeTimeOverride: null } as never);
    const acc2 = await Actions.acceptAssignedLoad.handler(cCtx, { id: id2, homeTimeOverride: null } as never);
    expect(acc2.ok).toBe(true);
    const aLoadId2 = acc2.loadId!;
    const prop2 = await Actions.proposeReassignment.handler(dispatchCtx, {
      id: id2,
      targetUsername: driverB.username,
      reason: "Coverage",
      homeTimeOverride: null,
    } as never);
    expect(prop2.ok).toBe(true);
    const refuse = await Actions.respondReassignment.handler(cCtx, { id: prop2.proposalId!, consent: false } as never);
    expect(refuse.ok).toBe(true);
    expect((await boardRow(id2)).claimedBy).toBe(driverC.username);

    // Dispatch cannot override. The owner cannot override without
    // a reason. The owner can, with one.
    const byDispatch = await Actions.overrideReassignmentRefusal.handler(dispatchCtx, { id: prop2.proposalId!, reason: "Because I said so" } as never);
    expect(byDispatch.ok).toBe(false);
    const noReason = await Actions.overrideReassignmentRefusal.handler(ownerCtx, { id: prop2.proposalId!, reason: " " } as never);
    expect(noReason.ok).toBe(false);
    const override = await Actions.overrideReassignmentRefusal.handler(ownerCtx, { id: prop2.proposalId!, reason: "C's truck goes into the shop Friday" } as never);
    expect(override.ok).toBe(true);
    expect((await boardRow(id2)).claimedBy).toBe(driverB.username);
    expect(await chainCount("load_reassignment_overridden")).toBe(1);
    // A's copy is swept on A's next read.
    expect(await driverLoadIds(cCtx)).not.toContain(aLoadId2);
    // The driver was told, with the reason.
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.username, driverC.username), eq(schema.notifications.title, "A load was moved off your calendar")));
    expect(notes.length).toBe(1);
    expect(notes[0]?.body).toContain("shop Friday");
  });

  test("(h) a company driver cannot read the fleet grid; the grid never shows another fleet", async () => {
    const asDriver = await Actions.getFleetCalendar.handler(aCtx, windowArgs as never);
    expect(asDriver.ok).toBe(false);
    const asDispatch = await Actions.getFleetCalendar.handler(dispatchCtx, windowArgs as never);
    expect(asDispatch.ok).toBe(true);
    expect(asDispatch.isOwner).toBe(false);
    expect(asDispatch.drivers.map((d) => d.username)).toContain(driverA.username);
    const asOwner = await Actions.getFleetCalendar.handler(ownerCtx, windowArgs as never);
    expect(asOwner.isOwner).toBe(true);
  });

  test("(i) paydays project from the stated cycle and flip to paid on a recorded payment", async () => {
    // No cycle yet → no payday events.
    let cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    expect(cal.events.some((e) => e.kind === "payday")).toBe(false);

    // Weekly on Fridays (weekday 5).
    await setSettings(ownerCtx, { payCycleKind: "weekly", payWeekday: 5 });
    cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    const paydays = cal.events.filter((e) => e.kind === "payday");
    expect(paydays.length).toBeGreaterThan(3);
    expect(paydays.every((p) => p.state === "expected")).toBe(true);
    expect(paydays.every((p) => new Date(p.at).getUTCDay() === 5)).toBe(true);

    // An accepted pay stub on one of those Fridays flips it.
    const firstFriday = new Date(paydays[0]!.at);
    await db.insert(schema.payStubDeliveries).values({
      companyId: fleet,
      senderUsername: owner.username,
      recipientUsername: driverA.username,
      kind: "1099",
      deliveryType: "stub",
      paidAt: firstFriday,
      gross: 7777,
      status: "accepted",
    });
    cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    const flipped = cal.events.find((e) => e.kind === "payday" && e.at === paydays[0]!.at);
    expect(flipped?.state).toBe("paid");
    // The stub's gross never rides the calendar (see also (k)).
    expect(JSON.stringify(cal)).not.toContain("7777");
  });

  test("(j) credential expiry + warnings land on the calendar", async () => {
    const expiresAt = new Date(Date.now() + 20 * DAY);
    await db.insert(schema.personalDocs).values({
      profileId: driverA.profileId,
      kind: "medical",
      label: "Medical card",
      expiresAt,
    });
    const cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    const expiry = cal.events.find((e) => e.kind === "credential_expiry" && e.credentialKey === "medical");
    expect(expiry).toBeDefined();
    const warnings = cal.events.filter((e) => e.kind === "credential_warning" && e.credentialKey === "medical");
    // The 30-day warning is in the past relative to a 20-day
    // expiry only if the window reaches back 40 days — it does;
    // the 7-day warning is ahead. Both are markers of the ladder.
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("(k) rate law: seeded figures never appear in calendar payloads", async () => {
    const cal = await Actions.getCalendar.handler(aCtx, windowArgs as never);
    expect(JSON.stringify(cal)).not.toContain("4321");
    const grid = await Actions.getFleetCalendar.handler(ownerCtx, windowArgs as never);
    expect(JSON.stringify(grid)).not.toContain("4321");
    expect(JSON.stringify(grid)).not.toContain("7777");
  });
});
