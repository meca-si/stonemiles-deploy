// brokerIdentityFlow.test.ts — INTEGRATION tests for broker-grade
// identity + continuous monitoring (Research Wave 2 item 3,
// migration 0131), run against the REAL action handlers over a
// throwaway migrated SQLite database:
//
//   (a) identity self-service: the broker saves their record
//       (sealed), reads it back as "on file", and the verification
//       seam — unconfigured in this environment — stamps NOTHING
//       and says so (configured: false).
//   (b) tender screen at SEND: an expired bond holds the send with
//       a plain reason, seals broker_tender_blocked, notifies the
//       broker, and opens a tender_blocked exception in the
//       broker's queue; fixing the bond sends clean, stamps the
//       load, and auto-clears the exception.
//   (c) tender screen at RELEASE: a revoked authority holds the
//       desk release; restoring it releases, and the board row
//       carries the poster link the trust display reads.
//   (d) bond monitoring: a 30-day bond alert records ONCE into the
//       broker's center, a dismissal silences that threshold for
//       that date, and a new expiry date re-arms at the 7-day mark.
//   (e) anti-double-brokering: the carrier who claimed the load
//       cannot re-post it (same reference) — refused + sealed —
//       while an unrelated post sails through and a fleet re-posting
//       its OWN claimed freight is unaffected.
//   (f) carrier of record: claiming binds the carrier on the board
//       row; a row still naming another carrier refuses a different
//       claimant and seals the conflict.
//   (g) the 371.3 record file: broker A sees A's agreed rate;
//       broker B's file excludes A's loads; a non-broker gets an
//       empty file; the outward track payload stays rate-free.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported. BROKER_IDENTITY_API_KEY is deleted —
// the seam must read unconfigured throughout.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-brokerid-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.BROKER_IDENTITY_API_KEY;

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
  await db.insert(schema.brokerOptins).values({
    scopeKey: `company:${companyId}`,
    companyId,
    ownerUsername: owner.username,
    enabled: true,
  });
  return companyId;
}

const db = getDb();
const DAY = 86_400_000;
const dateOnly = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString().slice(0, 10);

// Users + fleets -------------------------------------------------------------
const deskOwner = await seedUser("deskowner");
const deskDriver = await seedUser("deskdriver");
const brokerAUser = await seedUser("brokera");
const brokerBUser = await seedUser("brokerb");
const carrier = await seedUser("carrierx");

const deskFleet = await seedFleet(deskOwner, "Desk Fleet LLC");
await db.insert(schema.companyMembers).values({ companyId: deskFleet, username: deskDriver.username, role: "driver" });
await seedFleet(carrier, "Carrier Fleet LLC");

const deskCtx = ctxFor(deskOwner);
const deskDriverCtx = ctxFor(deskDriver);
const brokerACtx = ctxFor(brokerAUser);
const brokerBCtx = ctxFor(brokerBUser);
const carrierCtx = ctxFor(carrier);
const anonCtx = ctxFor(null);

const GOOD_IDENTITY = {
  legalName: "Apex Freight Brokers LLC",
  bondCarrier: "Surety One",
  bondAmount: 100000,
  bondExpiresOn: dateOnly(400 * DAY),
  authorityStatus: "active" as const,
};

async function createBroker(ctx: CtxT, name: string, email: string, linked: string, identity: Record<string, unknown>) {
  const res = await Actions.createBrokerAccount.handler(ctx, {
    name,
    email,
    contactName: null,
    brokerMc: "MC-123456",
    dispatcherFeePct: null,
    linkedUsername: linked,
    isDemo: false,
    defaultPickupAddress: null,
    defaultPickupCity: null,
    defaultPickupState: null,
    defaultCommodity: null,
    defaultFreightClass: null,
    defaultContactName: null,
    defaultContactPhone: null,
    referralCode: null,
    ...identity,
  } as never);
  expect(res.ok).toBe(true);
  return res.id!;
}

const brokerAId = await createBroker(deskCtx, "Apex Freight", "ops@apex.test", brokerAUser.username, GOOD_IDENTITY);
const brokerBId = await createBroker(deskCtx, "Beacon Brokerage", "ops@beacon.test", brokerBUser.username, {
  ...GOOD_IDENTITY,
  legalName: "Beacon Brokerage LLC",
});

const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF").toString("base64");

function loadArgs(over: Record<string, unknown>) {
  return {
    id: null,
    send: true,
    referenceNumber: "BI-1",
    pickupAddress: null,
    pickupCity: "Mobile",
    pickupState: "AL",
    pickupDate: "2026-12-16",
    pickupWindow: null,
    deliveryAddress: null,
    deliveryCity: "Dallas",
    deliveryState: "TX",
    deliveryDate: "2026-12-18",
    deliveryWindow: null,
    commodity: "lumber",
    freightClass: null,
    weightLbs: 30000,
    pieces: null,
    dimensions: null,
    equipment: "flatbed",
    tarps: false,
    edgeProtectors: false,
    rate: 2000,
    signoffConfirmed: true,
    offloadConfirmed: true,
    contactName: "Broker Ops",
    contactPhone: null,
    notes: null,
    docDataBase64: tinyPdf,
    docMime: "application/pdf",
    ...over,
  };
}

async function chainCount(event: string): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event));
  return rows.length;
}

async function notificationsFor(username: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.username, username));
}

describe("(a) identity self-service + seam honesty", () => {
  test("the broker saves their record — sealed — and reads it back on file", async () => {
    const saved = await Actions.updateMyBrokerIdentity.handler(brokerACtx, {
      legalName: "Apex Freight Brokers LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety Prime",
      bondAmount: 100000,
      bondExpiresOn: dateOnly(400 * DAY),
      authorityStatus: "active",
    } as never);
    expect(saved.ok).toBe(true);
    expect(saved.account?.bondCarrier).toBe("Surety Prime");
    expect(await chainCount("broker_identity_updated")).toBeGreaterThanOrEqual(1);

    const read = await Actions.getMyBrokerIdentity.handler(brokerACtx, {} as never);
    expect(read.account?.identityState).toBe("on_file");
    expect(read.account?.identityLabel).toContain("not connected");
    expect(read.account?.bondAmount).toBe(100000);
    expect(read.seamConfigured).toBe(false);
  });

  test("verify with no source connected stamps nothing and says so", async () => {
    const res = await Actions.verifyBrokerIdentity.handler(brokerACtx, {} as never);
    expect(res.ok).toBe(true);
    expect(res.configured).toBe(false);
    expect(res.message).toContain("not connected");
    const read = await Actions.getMyBrokerIdentity.handler(brokerACtx, {} as never);
    expect(read.account?.identityVerifiedAt).toBeNull();
    expect(read.account?.identityState).toBe("on_file");
    const checks = await db
      .select()
      .from(schema.chainLog)
      .where(and(eq(schema.chainLog.event, "broker_identity_check")));
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(checks[checks.length - 1]!.payload).outcome).toBe("not_configured");
  });

  test("a caller with no broker account reads account: null", async () => {
    const read = await Actions.getMyBrokerIdentity.handler(carrierCtx, {} as never);
    expect(read.account).toBeNull();
  });
});

describe("(b) tender screen at send — expired bond", () => {
  let posterId = 0;

  test("an expired bond holds the send, seals the block, notifies, and queues the exception", async () => {
    await Actions.updateMyBrokerIdentity.handler(brokerACtx, {
      legalName: "Apex Freight Brokers LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety Prime",
      bondAmount: 100000,
      bondExpiresOn: dateOnly(-1 * DAY),
      authorityStatus: "active",
    } as never);

    const saved = await Actions.saveBrokerLoad.handler(brokerACtx, loadArgs({}) as never);
    expect(saved.ok).toBe(false);
    expect(saved.error).toContain("expired");
    posterId = saved.id!;
    expect(posterId).toBeGreaterThan(0);

    const rows = await db.select().from(schema.brokerPosterLoads).where(eq(schema.brokerPosterLoads.id, posterId));
    expect(rows[0]!.status).toBe("draft");
    expect(rows[0]!.identityScreenedAt).toBeNull();
    expect(await chainCount("broker_tender_blocked")).toBeGreaterThanOrEqual(1);

    const ex = await db
      .select()
      .from(schema.autoExceptions)
      .where(and(eq(schema.autoExceptions.loadId, posterId), eq(schema.autoExceptions.kind, "tender_blocked")));
    expect(ex.length).toBe(1);
    expect(ex[0]!.status).toBe("open");

    const queue = await Actions.getExceptionQueue.handler(brokerACtx, {} as never);
    const mine = queue.items.filter((i) => i.loadId === posterId && i.kind === "tender_blocked");
    expect(mine.length).toBe(1);
    expect(mine[0]!.kindLabel).toContain("identity check");

    const notes = await notificationsFor(brokerAUser.username);
    expect(notes.some((n) => n.refId === posterId)).toBe(true);
  });

  test("fixing the bond sends clean, stamps the load, and auto-clears the exception", async () => {
    await Actions.updateMyBrokerIdentity.handler(brokerACtx, {
      legalName: "Apex Freight Brokers LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety Prime",
      bondAmount: 100000,
      bondExpiresOn: dateOnly(400 * DAY),
      authorityStatus: "active",
    } as never);
    const saved = await Actions.saveBrokerLoad.handler(brokerACtx, loadArgs({ id: posterId }) as never);
    expect(saved.ok).toBe(true);
    expect(saved.sent).toBe(true);
    const rows = await db.select().from(schema.brokerPosterLoads).where(eq(schema.brokerPosterLoads.id, posterId));
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.identityScreenedAt).not.toBeNull();
    expect(rows[0]!.identityScreenJson).toContain("Apex Freight Brokers LLC");
    const ex = await db
      .select()
      .from(schema.autoExceptions)
      .where(and(eq(schema.autoExceptions.loadId, posterId), eq(schema.autoExceptions.kind, "tender_blocked")));
    expect(ex[0]!.status).toBe("resolved");
    expect(await chainCount("broker_tender_screened")).toBeGreaterThanOrEqual(1);
  });
});

let releasedBoardLoadId = 0;

describe("(c) tender screen at release — revoked authority", () => {
  let posterId = 0;
  let boardLoadId = 0;

  test("a clean send, then a revoked authority holds the desk release", async () => {
    const saved = await Actions.saveBrokerLoad.handler(
      brokerACtx,
      loadArgs({ referenceNumber: "BI-2", rate: 4321, deliveryCity: "Atlanta", deliveryState: "GA" }) as never,
    );
    expect(saved.ok).toBe(true);
    expect(saved.sent).toBe(true);
    posterId = saved.id!;

    await Actions.updateMyBrokerIdentity.handler(brokerACtx, {
      legalName: "Apex Freight Brokers LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety Prime",
      bondAmount: 100000,
      bondExpiresOn: dateOnly(400 * DAY),
      authorityStatus: "revoked",
    } as never);
    const held = await Actions.releaseBrokerLoad.handler(deskCtx, { id: posterId } as never);
    expect(held.ok).toBe(false);
    expect(held.error).toContain("REVOKED");
    expect(held.boardLoadId).toBeNull();

    await Actions.updateMyBrokerIdentity.handler(brokerACtx, {
      legalName: "Apex Freight Brokers LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety Prime",
      bondAmount: 100000,
      bondExpiresOn: dateOnly(400 * DAY),
      authorityStatus: "active",
    } as never);
    const rel = await Actions.releaseBrokerLoad.handler(deskCtx, { id: posterId } as never);
    expect(rel.ok).toBe(true);
    boardLoadId = rel.boardLoadId!;
    releasedBoardLoadId = boardLoadId;
    expect(boardLoadId).toBeGreaterThan(0);
    const brows = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, boardLoadId));
    expect(brows[0]!.brokerPosterLoadId).toBe(posterId);
  });

  test("the open board carries the trust summary — and no bond amount", async () => {
    const open = await Actions.getOpenBoard.handler(carrierCtx, {} as never);
    const row = open.board.find((l) => l.id === boardLoadId);
    expect(row).toBeDefined();
    expect(row!.brokerTrust?.legalName).toBe("Apex Freight Brokers LLC");
    expect(row!.brokerTrust?.bondStatus).toBe("active");
    expect(row!.brokerTrust?.verificationStatus).toBe("on_file");
    expect(JSON.stringify(row)).not.toContain("100000");
  });
});

describe("(d) bond monitoring — alerts, dismissal, re-arm", () => {
  const in20 = dateOnly(20 * DAY);
  const in5 = dateOnly(5 * DAY);

  test("the 30-day alert records once; dismissal silences it; a new date re-arms at 7", async () => {
    await Actions.updateMyBrokerIdentity.handler(brokerBCtx, {
      legalName: "Beacon Brokerage LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety One",
      bondAmount: 100000,
      bondExpiresOn: in20,
      authorityStatus: "active",
    } as never);

    const read1 = await Actions.getMyBrokerIdentity.handler(brokerBCtx, {} as never);
    expect(read1.bondAlert.threshold).toBe(30);
    const key30 = `bond:${brokerBId}:30:${in20}`;
    const after1 = (await notificationsFor(brokerBUser.username)).filter((n) => n.dedupeKey === key30);
    expect(after1.length).toBe(1);
    expect(after1[0]!.kind).toBe("credential");

    await Actions.getMyBrokerIdentity.handler(brokerBCtx, {} as never);
    const after2 = (await notificationsFor(brokerBUser.username)).filter((n) => n.dedupeKey === key30);
    expect(after2.length).toBe(1); // dedupe: still exactly one

    const dis = await Actions.dismissBrokerBondAlert.handler(brokerBCtx, {} as never);
    expect(dis.ok).toBe(true);
    const read2 = await Actions.getMyBrokerIdentity.handler(brokerBCtx, {} as never);
    expect(read2.bondAlert.dismissed).toBe(true);
    expect(await chainCount("broker_bond_alert_dismissed")).toBeGreaterThanOrEqual(1);

    await Actions.updateMyBrokerIdentity.handler(brokerBCtx, {
      legalName: "Beacon Brokerage LLC",
      brokerMc: "MC-123456",
      bondCarrier: "Surety One",
      bondAmount: 100000,
      bondExpiresOn: in5,
      authorityStatus: "active",
    } as never);
    const read3 = await Actions.getMyBrokerIdentity.handler(brokerBCtx, {} as never);
    expect(read3.bondAlert.threshold).toBe(7);
    expect(read3.bondAlert.dismissed).toBe(false);
    const key7 = `bond:${brokerBId}:7:${in5}`;
    const after3 = (await notificationsFor(brokerBUser.username)).filter((n) => n.dedupeKey === key7);
    expect(after3.length).toBe(1);
  });
});

describe("(e)+(f) anti-double-brokering + carrier of record", () => {
  test("claiming binds the carrier of record on the board row", async () => {
    const open = await Actions.getOpenBoard.handler(carrierCtx, {} as never);
    const row = open.board.find((l) => l.id === releasedBoardLoadId);
    expect(row).toBeDefined();
    const claim = await Actions.claimOpenBoardLoad.handler(carrierCtx, { id: row!.id } as never);
    expect(claim.ok).toBe(true);
    const brows = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, row!.id));
    expect(brows[0]!.claimedBy).toBe(carrier.username);
    expect(brows[0]!.carrierOfRecord).toBe(carrier.username);
  });

  test("the claiming carrier cannot re-post the load — refused and sealed", async () => {
    const repost = await Actions.postBoardLoad.handler(carrierCtx, {
      shipper: "Acme Steel",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Atlanta",
      deliveryState: "GA",
      pickupText: null,
      deliveryText: null,
      rate: 4321,
      loadedMiles: null,
      milesSource: null,
      extraCharges: 0,
      extraChargesNote: null,
      weightLbs: 30000,
      commodity: "lumber",
      hazmat: false,
      equipmentType: "flatbed",
      notes: null,
      brokerName: null,
      brokerCompany: null,
      brokerMc: null,
      referenceNumber: "BI-2",
      pickupApptAt: null,
      deliveryApptAt: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(repost.ok).toBe(false);
    expect(repost.error).toContain("reference number");
    expect(await chainCount("double_broker_attempt")).toBeGreaterThanOrEqual(1);
  });

  test("an unrelated post by the same carrier sails through", async () => {
    const ok = await Actions.postBoardLoad.handler(carrierCtx, {
      shipper: "Delta Mills",
      pickupCity: "Memphis",
      pickupState: "TN",
      deliveryCity: "Nashville",
      deliveryState: "TN",
      pickupText: null,
      deliveryText: null,
      rate: 900,
      loadedMiles: null,
      milesSource: null,
      extraCharges: 0,
      extraChargesNote: null,
      weightLbs: 20000,
      commodity: "paper",
      hazmat: false,
      equipmentType: "flatbed",
      notes: null,
      brokerName: null,
      brokerCompany: null,
      brokerMc: null,
      referenceNumber: "OWN-1",
      pickupApptAt: null,
      deliveryApptAt: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(ok.ok).toBe(true);
  });

  test("a fleet re-posting its OWN claimed freight is unaffected", async () => {
    const post = await Actions.postBoardLoad.handler(deskCtx, {
      shipper: "Acme Steel",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      pickupText: null,
      deliveryText: null,
      rate: 2400,
      loadedMiles: null,
      milesSource: null,
      extraCharges: 0,
      extraChargesNote: null,
      weightLbs: 40000,
      commodity: "steel coils",
      hazmat: false,
      equipmentType: "flatbed",
      notes: null,
      brokerName: null,
      brokerCompany: null,
      brokerMc: null,
      referenceNumber: "OWN-FLEET-1",
      pickupApptAt: null,
      deliveryApptAt: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(post.ok).toBe(true);
    const claim = await Actions.claimBoardLoad.handler(deskDriverCtx, { id: post.id! } as never);
    expect(claim.ok).toBe(true);
    const repost = await Actions.postBoardLoad.handler(deskCtx, {
      shipper: "Acme Steel",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      pickupText: null,
      deliveryText: null,
      rate: 2400,
      loadedMiles: null,
      milesSource: null,
      extraCharges: 0,
      extraChargesNote: null,
      weightLbs: 40000,
      commodity: "steel coils",
      hazmat: false,
      equipmentType: "flatbed",
      notes: null,
      brokerName: null,
      brokerCompany: null,
      brokerMc: null,
      referenceNumber: "OWN-FLEET-1",
      pickupApptAt: null,
      deliveryApptAt: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(repost.ok).toBe(true);
  });

  test("a row still naming another carrier of record refuses a different claimant", async () => {
    const ins = await db
      .insert(schema.boardLoads)
      .values({
        companyId: deskFleet,
        postedBy: deskOwner.username,
        pickupCity: "Mobile",
        pickupState: "AL",
        deliveryCity: "Dallas",
        deliveryState: "TX",
        rate: 1500,
        status: "open",
        carrierOfRecord: "someoneelse",
      })
      .returning({ id: schema.boardLoads.id });
    const claim = await Actions.claimBoardLoad.handler(deskDriverCtx, { id: ins[0]!.id } as never);
    expect(claim.ok).toBe(false);
    expect(claim.error).toContain("carrier of record");
    expect(await chainCount("carrier_of_record_conflict")).toBeGreaterThanOrEqual(1);
  });
});

describe("(g) the 371.3 record file — broker-self-scoped", () => {
  test("broker A sees A's agreed rate; B's file excludes it; a non-broker gets an empty file", async () => {
    const fileA = await Actions.getBrokerRecordFile.handler(brokerACtx, {} as never);
    expect(fileA.accountName).toBe("Apex Freight");
    const row = fileA.rows.find((r) => r.referenceNumber === "BI-2");
    expect(row).toBeDefined();
    expect(row!.agreedRate).toBe(4321);
    expect(row!.brokerLegalName).toBe("Apex Freight Brokers LLC");
    expect(row!.carrierUsername).toBe(carrier.username);
    expect(row!.identityScreenedAt).not.toBeNull();

    const fileB = await Actions.getBrokerRecordFile.handler(brokerBCtx, {} as never);
    expect(fileB.rows.some((r) => r.referenceNumber === "BI-2")).toBe(false);

    const fileNone = await Actions.getBrokerRecordFile.handler(carrierCtx, {} as never);
    expect(fileNone.rows).toEqual([]);
    expect(fileNone.accountName).toBeNull();
  });

  test("the outward track payload for the same load stays rate-free", async () => {
    const posters = await db
      .select()
      .from(schema.brokerPosterLoads)
      .where(eq(schema.brokerPosterLoads.brokerId, brokerAId));
    const released = posters.find((p) => p.referenceNumber === "BI-2");
    expect(released?.trackToken).toBeTruthy();
    const info = await Actions.getTrackInfo.handler(anonCtx, { token: released!.trackToken! } as never);
    expect(JSON.stringify(info)).not.toContain("4321");
  });
});
