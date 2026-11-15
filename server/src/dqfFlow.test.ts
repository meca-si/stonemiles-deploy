// dqfFlow.test.ts — INTEGRATION tests for the driver
// qualification file manager (Research Wave 2 item 6, migration
// 0133), run against the REAL action handlers over a throwaway
// migrated SQLite database:
//
//   (a) no file → the claim is REFUSED with "No qualification
//       file on record", sealed dq_blocked, notified, and an open
//       dq_blocked exception sits in the fleet's queue; the board
//       load stays open.
//   (b) a complete recorded file → qualified; the claim lands and
//       the open exception auto-clears (condition_cleared).
//   (c) an expired medical → ASSIGN is refused naming the expiry;
//       fixing the record lets the assign through.
//   (d) a CDL that lapses after assignment → ACCEPT is refused;
//       fixing it lets the accept land.
//   (e) the medical verification seam, unconfigured: records
//       NOTHING, stamps NOTHING, seals not_configured, says so.
//   (f) the audit packet resolves through the Library doors for
//       the driver + their desk, and refuses another fleet.
//   (g) fleet alerts: a CDL 20 days out notifies the desk once,
//       a dismissal silences that threshold, the board still
//       shows the real state.
//   (h) solo load CREATION is never gated — an owner with no DQF
//       still builds his own loads (only binding is gated).
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported. MEDICAL_VERIFY_API_KEY is deleted —
// the seam must read unconfigured throughout.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-dqf-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.MEDICAL_VERIFY_API_KEY;

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
const dateOnly = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString().slice(0, 10);

const owner1 = await seedUser("dqfowner");
const driverA = await seedUser("dqfdriver");
const owner2 = await seedUser("dqfother");

const fleet1 = await seedFleet(owner1, "DQF Fleet LLC");
await db.insert(schema.companyMembers).values({ companyId: fleet1, username: driverA.username, role: "driver" });
await seedFleet(owner2, "Other Fleet LLC");

const ownerCtx = ctxFor(owner1);
const driverCtx = ctxFor(driverA);
const otherCtx = ctxFor(owner2);

const boardFields = {
  shipper: "Acme Steel",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
  pickupText: "Mon 8a",
  deliveryText: "Wed 5p",
  rate: 2400,
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
  referenceNumber: "DQF-1",
  pickupApptAt: null,
  deliveryApptAt: null,
};

async function postFleetLoad(): Promise<number> {
  const r = await Actions.postBoardLoad.handler(ownerCtx, boardFields as never);
  expect(r.ok).toBe(true);
  return r.id!;
}

async function saveEntry(
  ctx: CtxT,
  driver: string,
  kind: string,
  entryDate: string,
  expiresOn: string | null,
  payload: Record<string, unknown>,
): Promise<number> {
  const r = await Actions.saveDqfEntry.handler(ctx, {
    driverUsername: driver,
    kind,
    entryDate,
    expiresOn,
    payloadJson: JSON.stringify(payload),
    dataBase64: null,
    mime: null,
  } as never);
  expect(r.ok).toBe(true);
  return r.entryId!;
}

/** Record a complete, current qualification file for driverA. */
async function recordCompleteFile(ctx: CtxT) {
  await saveEntry(ctx, "dqfdriver", "application", dateOnly(-300 * DAY), null, {});
  await saveEntry(ctx, "dqfdriver", "cdl", dateOnly(-600 * DAY), dateOnly(400 * DAY), { state: "AL", licenseClass: "A" });
  await saveEntry(ctx, "dqfdriver", "medical", dateOnly(-100 * DAY), dateOnly(400 * DAY), { examinerName: "Dr. A", registryNumber: "12345" });
  await saveEntry(ctx, "dqfdriver", "road_test", dateOnly(-299 * DAY), null, { examinerName: "Tester" });
  await saveEntry(ctx, "dqfdriver", "mvr_review", dateOnly(-30 * DAY), null, { outcome: "acceptable" });
  await saveEntry(ctx, "dqfdriver", "clearinghouse_query", dateOnly(-301 * DAY), null, { queryType: "pre_employment", result: "clear" });
}

async function chainCount(event: string): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event));
  return rows.length;
}

async function dqExceptions(boardLoadId: number) {
  return db
    .select()
    .from(schema.autoExceptions)
    .where(and(eq(schema.autoExceptions.dedupeKey, `dq:${boardLoadId}:dq_blocked`)));
}

describe("(a) no file — the claim is refused, sealed, queued", () => {
  test("driver with NO DQF cannot claim; the load stays open", async () => {
    const sealedBefore = await chainCount("dq_blocked"); // other suites' gated attempts share this chain in a full run
    const id = await postFleetLoad();
    const res = await Actions.claimBoardLoad.handler(driverCtx, { id } as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("No qualification file on record");
    expect(res.loadId).toBeNull();

    const board = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, id));
    expect(board[0]!.status).toBe("open");
    expect(await chainCount("dq_blocked")).toBe(sealedBefore + 1);

    const rows = await dqExceptions(id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("open");
    expect(rows[0]!.companyId).toBe(fleet1);

    // The fleet's exception queue carries it.
    const queue = await Actions.getExceptionQueue.handler(ownerCtx, {} as never);
    expect(queue.items.some((i) => i.kind === "dq_blocked")).toBe(true);
    expect(queue.counts.fleet).toBeGreaterThanOrEqual(1);

    // The driver was notified in-app.
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, "dqfdriver"));
    expect(notes.some((n) => n.title.includes("Dispatch held"))).toBe(true);
  });
});

describe("(b) a complete file qualifies — claim lands, block clears", () => {
  test("record the file, read it back qualified, claim, exception auto-clears", async () => {
    await recordCompleteFile(ownerCtx);
    const read = await Actions.getDqfFile.handler(driverCtx, { driverUsername: null } as never);
    expect(read.ok).toBe(true);
    expect(read.qualified).toBe(true);
    expect(read.reasons).toEqual([]);
    expect(read.medicalVerification.state).toBe("on_file");
    expect(read.medicalVerification.label).toContain("electronic verification not connected");
    expect(read.seamConfigured).toBe(false);
    expect(read.entries.length).toBe(6);

    const id = await postFleetLoad();
    // Re-open a block on THIS load first: void the medical, claim
    // (refused), restore the medical, claim again (lands + clears).
    const med = read.entries.find((e) => e.kind === "medical")!;
    await Actions.voidDqfEntry.handler(ownerCtx, { entryId: med.id } as never);
    const refused = await Actions.claimBoardLoad.handler(driverCtx, { id } as never);
    expect(refused.ok).toBe(false);
    expect((await dqExceptions(id))[0]!.status).toBe("open");

    await saveEntry(ownerCtx, "dqfdriver", "medical", dateOnly(-10 * DAY), dateOnly(700 * DAY), { examinerName: "Dr. B", registryNumber: "6789" });
    const landed = await Actions.claimBoardLoad.handler(driverCtx, { id } as never);
    expect(landed.ok).toBe(true);
    expect(landed.loadId).not.toBeNull();
    const rows = await dqExceptions(id);
    expect(rows[0]!.status).toBe("resolved");
    expect(rows[0]!.resolution).toBe("condition_cleared");
  });
});

describe("(c) expired medical — assign refused, fix, assign lands", () => {
  test("dispatch cannot assign to a driver whose medical lapsed", async () => {
    const read = await Actions.getDqfFile.handler(ownerCtx, { driverUsername: "dqfdriver" } as never);
    const med = read.entries.filter((e) => e.kind === "medical" && !e.voided).sort((a, b) => b.id - a.id)[0]!;
    await Actions.voidDqfEntry.handler(ownerCtx, { entryId: med.id } as never);
    await saveEntry(ownerCtx, "dqfdriver", "medical", dateOnly(-800 * DAY), dateOnly(-1 * DAY), { examinerName: "Dr. Old" });

    const id = await postFleetLoad();
    const asg = await Actions.assignBoardLoad.handler(ownerCtx, { id, targetUsername: "dqfdriver" } as never);
    expect(asg.ok).toBe(false);
    expect(asg.error).toContain("Medical certificate expired");
    const board = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, id));
    expect(board[0]!.status).toBe("open");
    expect((await dqExceptions(id))[0]!.status).toBe("open");

    await saveEntry(ownerCtx, "dqfdriver", "medical", dateOnly(-5 * DAY), dateOnly(720 * DAY), { examinerName: "Dr. B", registryNumber: "6789" });
    const asg2 = await Actions.assignBoardLoad.handler(ownerCtx, { id, targetUsername: "dqfdriver" } as never);
    expect(asg2.ok).toBe(true);
  });
});

describe("(d) lapse after assignment — accept refused, fix, accept lands", () => {
  test("the accept screen re-runs the qualification check", async () => {
    const id = await postFleetLoad();
    const asg = await Actions.assignBoardLoad.handler(ownerCtx, { id, targetUsername: "dqfdriver" } as never);
    expect(asg.ok).toBe(true);

    // The CDL lapses (a newer record shows it expired yesterday).
    const read = await Actions.getDqfFile.handler(ownerCtx, { driverUsername: "dqfdriver" } as never);
    const cdl = read.entries.filter((e) => e.kind === "cdl" && !e.voided).sort((a, b) => b.id - a.id)[0]!;
    await Actions.voidDqfEntry.handler(ownerCtx, { entryId: cdl.id } as never);
    await saveEntry(ownerCtx, "dqfdriver", "cdl", dateOnly(-900 * DAY), dateOnly(-1 * DAY), { state: "AL", licenseClass: "A" });

    const acc = await Actions.acceptAssignedLoad.handler(driverCtx, { id } as never);
    expect(acc.ok).toBe(false);
    expect(acc.error).toContain("CDL expired");

    await saveEntry(ownerCtx, "dqfdriver", "cdl", dateOnly(-2 * DAY), dateOnly(1400 * DAY), { state: "AL", licenseClass: "A" });
    const acc2 = await Actions.acceptAssignedLoad.handler(driverCtx, { id } as never);
    expect(acc2.ok).toBe(true);
    expect(acc2.loadId).not.toBeNull();
  });
});

describe("(e) the verification seam — unconfigured honesty", () => {
  test("verify records nothing, stamps nothing, seals not_configured", async () => {
    const before = await chainCount("dqf_medical_check");
    const res = await Actions.verifyDqfMedical.handler(ownerCtx, { driverUsername: "dqfdriver" } as never);
    expect(res.ok).toBe(true);
    expect(res.configured).toBe(false);
    expect(res.label).toContain("isn't connected yet");
    expect(await chainCount("dqf_medical_check")).toBe(before + 1);
    const read = await Actions.getDqfFile.handler(ownerCtx, { driverUsername: "dqfdriver" } as never);
    expect(read.entries.some((e) => e.kind === "medical_verification")).toBe(false);
    expect(read.medicalVerification.state).toBe("on_file");
    // And a hand-recorded verification entry is refused outright.
    const manual = await Actions.saveDqfEntry.handler(ownerCtx, {
      driverUsername: "dqfdriver",
      kind: "medical_verification",
      entryDate: dateOnly(0),
      expiresOn: null,
      payloadJson: JSON.stringify({ outcome: "verified", source: "Me" }),
      dataBase64: null,
      mime: null,
    } as never);
    expect(manual.ok).toBe(false);
  });
});

describe("(f) the audit packet through the Library doors", () => {
  test("driver + desk resolve it; another fleet is refused like a missing file", async () => {
    const read = await Actions.getDqfFile.handler(ownerCtx, { driverUsername: "dqfdriver" } as never);
    const fileId = read.fileId!;
    expect(fileId).toBeGreaterThan(0);
    const ref = `dqf:${fileId}:${dateOnly(-20 * DAY)}`;
    const doc = await Actions.getLibraryDocument.handler(driverCtx, { ref } as never);
    expect(doc.ok).toBe(true);
    expect(doc.mime).toBe("application/pdf");
    expect(doc.filename).toContain("dqf-dqfdriver");
    expect((doc.dataBase64 ?? "").length).toBeGreaterThan(200);
    const deskDoc = await Actions.getLibraryDocument.handler(ownerCtx, { ref } as never);
    expect(deskDoc.ok).toBe(true);
    const cross = await Actions.getLibraryDocument.handler(otherCtx, { ref } as never);
    expect(cross.ok).toBe(false);
  });
});

describe("(g) fleet alerts — notify once, dismissal silences", () => {
  test("a CDL 20 days out alerts the desk; dismissing silences that threshold", async () => {
    // Renew the CDL to one expiring in 20 days (still valid) —
    // void every standing CDL record first so the renewal is the
    // latest fact on file.
    const read = await Actions.getDqfFile.handler(ownerCtx, { driverUsername: "dqfdriver" } as never);
    for (const c of read.entries.filter((e) => e.kind === "cdl" && !e.voided)) {
      await Actions.voidDqfEntry.handler(ownerCtx, { entryId: c.id } as never);
    }
    await saveEntry(ownerCtx, "dqfdriver", "cdl", dateOnly(-1400 * DAY), dateOnly(20 * DAY), { state: "AL", licenseClass: "A" });

    const board1 = await Actions.getFleetDqf.handler(ownerCtx, {} as never);
    expect(board1.ok).toBe(true);
    const drv = board1.drivers.find((d) => d.username === "dqfdriver")!;
    expect(drv.qualified).toBe(true);
    const alert = drv.alerts.find((a) => a.itemKey === "cdl")!;
    expect(alert.threshold).toBe(30);
    expect(alert.dismissed).toBe(false);

    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, "dqfowner"));
    const dqNotes = notes.filter((n) => (n.dedupeKey ?? "").startsWith("dqf:"));
    expect(dqNotes.length).toBe(1);

    const dis = await Actions.dismissDqfAlert.handler(ownerCtx, { driverUsername: "dqfdriver", itemKey: "cdl", threshold: 30 } as never);
    expect(dis.ok).toBe(true);
    const board2 = await Actions.getFleetDqf.handler(ownerCtx, {} as never);
    const alert2 = board2.drivers.find((d) => d.username === "dqfdriver")!.alerts.find((a) => a.itemKey === "cdl")!;
    expect(alert2.dismissed).toBe(true);
    // No second notification was recorded by the re-read.
    const notes2 = await db.select().from(schema.notifications).where(eq(schema.notifications.username, "dqfowner"));
    expect(notes2.filter((n) => (n.dedupeKey ?? "").startsWith("dqf:")).length).toBe(1);
  });
});

describe("(h) solo load creation is never gated", () => {
  test("an owner with no DQF still builds his own loads", async () => {
    const res = await Actions.saveLoad.handler(otherCtx, {
      id: null,
      shipper: "Solo Shipper",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      pickupText: null,
      deliveryText: null,
      rate: 1500,
      weightLbs: 20000,
      commodity: "general",
      hazmat: false,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(res.id).toBeGreaterThan(0);
    // But his own board claim IS gated (he has a company of one).
    const id = await (async () => {
      const r = await Actions.postBoardLoad.handler(otherCtx, boardFields as never);
      expect(r.ok).toBe(true);
      return r.id!;
    })();
    const claim = await Actions.claimBoardLoad.handler(otherCtx, { id } as never);
    expect(claim.ok).toBe(false);
    expect(claim.error).toContain("No qualification file on record");
  });
});
