// boardAssignFlow.test.ts — INTEGRATION tests for the assign-to-driver
// flow + broker inbound doors (owner orders, 2026-11-10), run against
// the REAL action handlers over a throwaway migrated SQLite database:
//
//   (a) dispatcher assigns → the named driver sees exactly that load
//   (b) driver B of the same fleet does NOT see driver A's assignment
//   (c) another fleet's driver/dispatcher sees nothing, cannot act
//   (d) driver accept binds the load to the sealed Load Tracker record
//   (e) decline returns the load to the desk with the reason on it
//   (f) reassignment of a pending/declined offer works
//   (g) outsider / anonymous calls are refused
//   (h) a send-door offer is visible ONLY to the addressed fleet's desk
//   (i) accepting a door offer → booked load → assignable end-to-end
//   (j) a broker board post is NOT public before platform approval and
//       IS claimable after release
//   (k) wrong/unknown door codes and identity-less door offers refused
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-assign-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT, blobs } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { eq, desc } = await import("drizzle-orm");

type CtxT = Ctx;

// The sendDocEmail not-configured shape (D1 mechanics): sends queue.
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

function ctxFor(u: SeededUser | null): CtxT {
  return createInvocation({
    // The host's invocation ctx is the runtime twin of the SDK Ctx the
    // handlers are typed against (host/server.ts passes it the same way).
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

async function addMember(companyId: number, username: string, role: string) {
  await getDb().insert(schema.companyMembers).values({ companyId, username, role });
}

// Users + fleets ------------------------------------------------------------
const owner1 = await seedUser("owner1");
const driverA = await seedUser("drivera");
const driverB = await seedUser("driverb");
const owner2 = await seedUser("owner2");
const driverC = await seedUser("driverc");
const drifter = await seedUser("drifter"); // no company at all
const brokerUser = await seedUser("brokeruser");
const claimer = await seedUser("claimer"); // vetted owner-operator: Diamond, no fleet seat

const fleet1 = await seedFleet(owner1, "Fleet One LLC");
await addMember(fleet1, driverA.username, "driver");
await addMember(fleet1, driverB.username, "driver");
const fleet2 = await seedFleet(owner2, "Fleet Two LLC");
await addMember(fleet2, driverC.username, "driver");

const owner1Ctx = ctxFor(owner1);
const aCtx = ctxFor(driverA);
const bCtx = ctxFor(driverB);
const owner2Ctx = ctxFor(owner2);
const cCtx = ctxFor(driverC);
const anonCtx = ctxFor(null);

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
  referenceNumber: "REF-100",
  pickupApptAt: "2026-11-16T13:00:00.000Z",
  deliveryApptAt: "2026-11-18T22:00:00.000Z",
};

async function postFleetLoad(ctx: CtxT) {
  const r = await Actions.postBoardLoad.handler(ctx, boardFields as never);
  expect(r.ok).toBe(true);
  return r.id!;
}

async function boardOf(ctx: CtxT) {
  const r = await Actions.getLoadBoard.handler(ctx, {} as never);
  return r.board;
}

describe("assign-to-driver flow", () => {
  test("(a) dispatcher assigns → driver sees exactly that load, no driver load exists yet", async () => {
    const id = await postFleetLoad(owner1Ctx);
    const asg = await Actions.assignBoardLoad.handler(owner1Ctx, { id, targetUsername: "drivera" } as never);
    expect(asg.ok).toBe(true);

    const aLoads = await boardOf(aCtx);
    const mine = aLoads.filter((l) => l.id === id);
    expect(mine.length).toBe(1);
    expect(mine[0]!.status).toBe("assigned");
    expect(mine[0]!.assignmentPhase).toBe("pending");
    expect(mine[0]!.referenceNumber).toBe("REF-100");

    // The offer is NOT a driver load yet — nothing in the sealed tracker.
    const loads = await getDb().select().from(schema.loads);
    expect(loads.length).toBe(0);
  });

  test("(b) driver B of the same fleet does NOT see driver A's assignment", async () => {
    const bLoads = await boardOf(bCtx);
    expect(bLoads.some((l) => l.status === "assigned")).toBe(false);
  });

  test("(c) another fleet sees nothing and cannot act on it", async () => {
    const id = (await boardOf(aCtx)).find((l) => l.status === "assigned")!.id;
    expect((await boardOf(cCtx)).some((l) => l.id === id)).toBe(false);
    expect((await boardOf(owner2Ctx)).some((l) => l.id === id)).toBe(false);
    const steal = await Actions.assignBoardLoad.handler(owner2Ctx, { id, targetUsername: "driverc" } as never);
    expect(steal.ok).toBe(false);
    const stealAccept = await Actions.acceptAssignedLoad.handler(cCtx, { id } as never);
    expect(stealAccept.ok).toBe(false);
  });

  test("(d) accept binds the load to the sealed tracker record", async () => {
    const id = (await boardOf(aCtx)).find((l) => l.status === "assigned")!.id;
    const acc = await Actions.acceptAssignedLoad.handler(aCtx, { id } as never);
    expect(acc.ok).toBe(true);
    expect(acc.loadId).not.toBeNull();

    const db = getDb();
    const loadRows = await db.select().from(schema.loads).where(eq(schema.loads.id, acc.loadId!));
    expect(loadRows.length).toBe(1);
    expect(loadRows[0]!.profileId).toBe(driverA.profileId);
    expect(loadRows[0]!.referenceNumber).toBe("REF-100");

    const boardRows = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, id));
    expect(boardRows[0]!.status).toBe("taken");
    expect(boardRows[0]!.loadId).toBe(acc.loadId);

    const events = (await db.select().from(schema.chainLog)).map((r) => r.event);
    expect(events).toContain("board_load_assignment_accepted");
    expect(events).toContain("load_saved");
  });

  test("(e) decline returns the load to the desk with the reason", async () => {
    const id = await postFleetLoad(owner1Ctx);
    await Actions.assignBoardLoad.handler(owner1Ctx, { id, targetUsername: "drivera" } as never);

    const noReason = await Actions.declineAssignedLoad.handler(aCtx, { id, reason: "   " } as never);
    expect(noReason.ok).toBe(false);

    const dec = await Actions.declineAssignedLoad.handler(aCtx, { id, reason: "Home time Friday" } as never);
    expect(dec.ok).toBe(true);

    const desk = (await boardOf(owner1Ctx)).find((l) => l.id === id)!;
    expect(desk.status).toBe("open");
    expect(desk.declineReason).toBe("Home time Friday");
    expect(desk.declinedBy).toBe("drivera");
    // Driver A no longer holds an offer on it.
    const aView = (await boardOf(aCtx)).find((l) => l.id === id);
    expect(aView?.assignmentPhase).not.toBe("pending");
  });

  test("(f) reassign works — declined load to B, then pending offer moved B → A", async () => {
    const deskLoads = await boardOf(owner1Ctx);
    const id = deskLoads.find((l) => l.status === "open" && l.declineReason)?.id;
    expect(id).toBeDefined();

    const toB = await Actions.assignBoardLoad.handler(owner1Ctx, { id: id!, targetUsername: "driverb" } as never);
    expect(toB.ok).toBe(true);
    expect((await boardOf(bCtx)).some((l) => l.id === id && l.status === "assigned")).toBe(true);

    const toA = await Actions.assignBoardLoad.handler(owner1Ctx, { id: id!, targetUsername: "drivera" } as never);
    expect(toA.ok).toBe(true);
    expect((await boardOf(bCtx)).some((l) => l.id === id)).toBe(false);
    const aRow = (await boardOf(aCtx)).find((l) => l.id === id)!;
    expect(aRow.status).toBe("assigned");
    // The earlier decline note is cleared by the fresh offer.
    expect(aRow.declineReason).toBeNull();
  });

  test("(g) outsider and anonymous calls are refused", async () => {
    const drifterCtx = ctxFor(drifter);
    const post = await Actions.postBoardLoad.handler(drifterCtx, boardFields as never);
    expect(post.ok).toBe(false);
    const id = (await boardOf(aCtx)).find((l) => l.status === "assigned")!.id;
    const acc = await Actions.acceptAssignedLoad.handler(drifterCtx, { id } as never);
    expect(acc.ok).toBe(false);
    let anonFailed = false;
    try {
      const r = await Actions.acceptAssignedLoad.handler(anonCtx, { id } as never);
      anonFailed = !r.ok;
    } catch {
      anonFailed = true; // identity resolution throws without a session — refused either way
    }
    expect(anonFailed).toBe(true);
  });
});

describe("broker inbound doors", () => {
  let doorToken = "";
  let doorSubmissionId = 0;

  test("(h) a send-door offer is visible ONLY to the addressed fleet's desk", async () => {
    const door = await Actions.createSendDoor.handler(owner1Ctx, {} as never);
    expect(door.ok).toBe(true);
    doorToken = door.door!.token;

    const info = await Actions.getBrokerUploadInfo.handler(anonCtx, { token: doorToken } as never);
    expect(info.valid).toBe(true);
    expect(info.isDoor).toBe(true);

    const boardBefore = (await getDb().select().from(schema.boardLoads)).length;
    const sub = await Actions.submitBrokerUpload.handler(anonCtx, {
      ...boardFields,
      token: doorToken,
      brokerName: "Sam Shipper",
      brokerCompany: "Sam Logistics",
      senderContact: "sam@samlogistics.test",
      referenceNumber: "SAM-9",
      pickupApptAt: null,
      deliveryApptAt: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(sub.ok).toBe(true);
    doorSubmissionId = sub.submissionId!;

    // Nothing touched any board.
    expect((await getDb().select().from(schema.boardLoads)).length).toBe(boardBefore);

    const center1 = await Actions.getBrokerCenter.handler(owner1Ctx, {} as never);
    const seen = center1.submissions.find((s) => s.id === doorSubmissionId);
    expect(seen).toBeDefined();
    expect(seen!.sourceKind).toBe("door");
    expect(seen!.senderContact).toBe("sam@samlogistics.test");

    const center2 = await Actions.getBrokerCenter.handler(owner2Ctx, {} as never);
    expect(center2.submissions.some((s) => s.id === doorSubmissionId)).toBe(false);
  });

  test("(k) wrong door code and identity-less door offers are refused", async () => {
    const bad = await Actions.submitBrokerUpload.handler(anonCtx, {
      ...boardFields,
      token: "no-such-door-code",
      brokerName: "X",
      brokerCompany: "Y",
      senderContact: "x@y.test",
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(bad.ok).toBe(false);

    const noIdentity = await Actions.submitBrokerUpload.handler(anonCtx, {
      ...boardFields,
      token: doorToken,
      brokerName: null,
      brokerCompany: null,
      senderContact: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect(noIdentity.ok).toBe(false);
  });

  test("(i) accepting a door offer creates the booked load, assignable end-to-end", async () => {
    const appr = await Actions.approveBrokerSubmission.handler(owner1Ctx, { id: doorSubmissionId, ...boardFields, reviewNote: null } as never);
    expect(appr.ok).toBe(true);
    expect(appr.boardLoadId).not.toBeNull();

    const deskRow = (await boardOf(owner1Ctx)).find((l) => l.id === appr.boardLoadId)!;
    expect(deskRow.status).toBe("open");
    expect(deskRow.referenceNumber).toBe("SAM-9");

    const asg = await Actions.assignBoardLoad.handler(owner1Ctx, { id: appr.boardLoadId!, targetUsername: "driverb" } as never);
    expect(asg.ok).toBe(true);
    const acc = await Actions.acceptAssignedLoad.handler(bCtx, { id: appr.boardLoadId! } as never);
    expect(acc.ok).toBe(true);
    expect(acc.loadId).not.toBeNull();
  });

  test("(j) broker board post: not public before approval, claimable after release", async () => {
    const acct = await Actions.createBrokerAccount.handler(owner1Ctx, {
      name: "BrokerCo",
      email: "ops@brokerco.test",
      contactName: null,
      brokerMc: "MC-123",
      dispatcherFeePct: null,
      linkedUsername: "brokeruser",
      isDemo: false,
      defaultPickupAddress: null,
      defaultPickupCity: null,
      defaultPickupState: null,
      defaultCommodity: null,
      defaultFreightClass: null,
      defaultContactName: null,
      defaultContactPhone: null,
    } as never);
    expect(acct.ok).toBe(true);

    const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF").toString("base64");
    const saved = await Actions.saveBrokerLoad.handler(ctxFor(brokerUser), {
      id: null,
      send: true,
      referenceNumber: "BC-1",
      pickupAddress: null,
      pickupCity: "Mobile",
      pickupState: "AL",
      pickupDate: "2026-11-16",
      pickupWindow: null,
      deliveryAddress: null,
      deliveryCity: "Dallas",
      deliveryState: "TX",
      deliveryDate: "2026-11-18",
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
    } as never);
    expect(saved.ok).toBe(true);
    expect(saved.sent).toBe(true);

    // Not public: the open board does not carry it, and the other
    // fleet's desk cannot release it.
    const openBefore = await Actions.getOpenBoard.handler(ctxFor(claimer), {} as never);
    expect(openBefore.board.length).toBe(0);
    const wrongDesk = await Actions.releaseBrokerLoad.handler(owner2Ctx, { id: saved.id! } as never);
    expect(wrongDesk.ok).toBe(false);

    const rel = await Actions.releaseBrokerLoad.handler(owner1Ctx, { id: saved.id! } as never);
    expect(rel.ok).toBe(true);
    expect(rel.boardLoadId).not.toBeNull();

    const openAfter = await Actions.getOpenBoard.handler(ctxFor(claimer), {} as never);
    expect(openAfter.board.some((l) => l.id === rel.boardLoadId)).toBe(true);

    const claim = await Actions.claimOpenBoardLoad.handler(ctxFor(claimer), { id: rel.boardLoadId! } as never);
    expect(claim.ok).toBe(true);
    expect(claim.loadId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// User Library seeds + tests (l)-(q). Seeding runs in beforeAll AFTER the
// assign-flow suites above: one database, one chain — the chain helper
// continues from the live head, exactly like the app's appendChain.
// ---------------------------------------------------------------------------

let libDriverCtx: CtxT;
let libOwnerCtx: CtxT;
let libOtherCtx: CtxT;
let libStrangerCtx: CtxT;
let libLoadId = 0;
let libPodSealEntryId = 0;
let libDriverEmail = "";

async function seedLibrary() {
  const libowner = await seedUser("libowner");
  const libdriver = await seedUser("libdriver");
  const otherowner = await seedUser("otherowner");
  const stranger = await seedUser("stranger");
  libDriverEmail = libdriver.email;
  libDriverCtx = ctxFor(libdriver);
  libOwnerCtx = ctxFor(libowner);
  libOtherCtx = ctxFor(otherowner);
  libStrangerCtx = ctxFor(stranger);

  const db = getDb();
  const libFleet1 = (
    await db.insert(schema.companies).values({ name: "Library Fleet LLC", ownerUsername: "libowner" }).returning({ id: schema.companies.id })
  )[0]!.id;
  await db.insert(schema.companyMembers).values({ companyId: libFleet1, username: "libowner", role: "owner" });
  await db.insert(schema.companyMembers).values({ companyId: libFleet1, username: "libdriver", role: "driver" });
  const libFleet2 = (
    await db.insert(schema.companies).values({ name: "Other Fleet LLC", ownerUsername: "otherowner" }).returning({ id: schema.companies.id })
  )[0]!.id;
  await db.insert(schema.companyMembers).values({ companyId: libFleet2, username: "otherowner", role: "owner" });

  // Chain helper — continues from the live head (appendChain's own rule:
  // sha256 of "prevHash|event|payload", genesis "GENESIS").
  const headRows = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
  let chainPrev = headRows[0]?.hash ?? "GENESIS";
  const addChain = async (refKind: string, refId: number | null, event: string, payload: Record<string, unknown>) => {
    const payloadText = JSON.stringify(payload);
    const hash = createHash("sha256").update(`${chainPrev}|${event}|${payloadText}`).digest("hex");
    const rows = await db
      .insert(schema.chainLog)
      .values({ refKind, refId, sessionId: null, event, payload: payloadText, prevHash: chainPrev, hash })
      .returning({ id: schema.chainLog.id });
    chainPrev = hash;
    return rows[0]!.id;
  };

  // Delivered load L1 (chain: load_saved + pod_seal) + its fleet board row.
  const load = (
    await db
      .insert(schema.loads)
      .values({
        profileId: libdriver.profileId,
        shipper: "Acme Steel",
        pickupCity: "Mobile",
        pickupState: "AL",
        deliveryCity: "Dallas",
        deliveryState: "TX",
        commodity: "steel coils",
        weightLbs: 40000,
        rate: 2400,
        status: "Delivered",
        referenceNumber: "REF-L1",
        brokerName: "Sam Shipper",
      })
      .returning({ id: schema.loads.id })
  )[0]!;
  libLoadId = load.id;
  await addChain("load", load.id, "load_saved", { lane: "Mobile, AL → Dallas, TX" });
  libPodSealEntryId = await addChain("load", load.id, "pod_seal", { autoSealed: false });
  await db.insert(schema.boardLoads).values({
    companyId: libFleet1,
    postedBy: "libowner",
    status: "taken",
    claimedBy: "libdriver",
    claimMethod: "assign",
    loadId: load.id,
    shipper: "Acme Steel",
    pickupCity: "Mobile",
    pickupState: "AL",
    deliveryCity: "Dallas",
    deliveryState: "TX",
    pickupText: "Mon 8a",
    deliveryText: "Wed 5p",
    rate: 2400,
    weightLbs: 40000,
    commodity: "steel coils",
    referenceNumber: "REF-L1",
  });

  // Trip in Q3 2026 with state lines + fuel in the same quarter.
  const trip = (
    await db
      .insert(schema.trips)
      .values({
        profileId: libdriver.profileId,
        startedAt: new Date("2026-08-10T12:00:00Z"),
        endedAt: new Date("2026-08-12T12:00:00Z"),
        totalMiles: 1000,
        totalPay: 550,
        stateBreakdown: JSON.stringify([
          { state: "AL", miles: 600 },
          { state: "TX", miles: 400 },
        ]),
      })
      .returning({ id: schema.trips.id })
  )[0]!;
  await addChain("trip", trip.id, "trip_saved", { totalMiles: 1000 });
  await db.insert(schema.fuelPurchases).values({
    profileId: libdriver.profileId,
    purchasedAt: new Date("2026-08-11T12:00:00Z"),
    state: "AL",
    gallons: 80,
    pricePerGallon: 3.9,
    total: 312,
  });
  await db.insert(schema.fuelPurchases).values({
    profileId: libdriver.profileId,
    purchasedAt: new Date("2026-08-12T12:00:00Z"),
    state: "TX",
    gallons: 50,
    pricePerGallon: 3.8,
    total: 190,
  });

  // Statements: one settlement + one pay entry.
  await db.insert(schema.settlements).values({
    profileId: libdriver.profileId,
    carrier: "Library Fleet LLC",
    periodLabel: "Nov 2026",
    gross: 3000,
  });
  await db.insert(schema.payEntries).values({
    username: "libdriver",
    kind: "w2",
    payer: "Library Fleet LLC",
    paidAt: new Date("2026-11-05T12:00:00Z"),
    gross: 1200,
    federalWithheld: 100,
    stateWithheld: 40,
    otherDeductions: 10,
  });

  // Uploads: a filed POD copy + a personal doc, both with real blobs.
  await blobs.put("test/pod.pdf", new TextEncoder().encode("%PDF-1.4 pod"), { contentType: "application/pdf" });
  await db.insert(schema.filedDocCopies).values({
    profileId: libdriver.profileId,
    loadId: load.id,
    docKind: "pod",
    label: "POD — Dallas",
    blobKey: "test/pod.pdf",
    mime: "application/pdf",
    sha256: "a".repeat(64),
    source: "pod_seal",
    filedBy: "libdriver",
    dedupeKey: `pod:${load.id}:test`,
  });
  await blobs.put("test/cdl.jpg", new TextEncoder().encode("cdl-image"), { contentType: "image/jpeg" });
  await db.insert(schema.personalDocs).values({
    profileId: libdriver.profileId,
    kind: "cdl",
    label: "CDL front",
    blobKey: "test/cdl.jpg",
    mime: "image/jpeg",
  });

  // A filing: the real export appends its own chain event.
  await Actions.exportIftaReport.handler(libDriverCtx, { year: 2026, quarter: 3 } as never);
}

describe("user library", () => {
  beforeAll(seedLibrary);

  test("(l) delivered load appears in the driver's library and his fleet's, sealed record linked", async () => {
    const mine = await Actions.getLibrary.handler(libDriverCtx, {} as never);
    const delivered = mine.deliveredLoads.find((l) => l.loadId === libLoadId);
    expect(delivered).toBeDefined();
    expect(delivered!.lane).toContain("Mobile");
    const sealed = mine.sealedFiles.find((s) => s.recordKind === "load" && s.recordId === libLoadId);
    expect(sealed).toBeDefined();
    expect(sealed!.ref).toBe(`sealed:${libLoadId}`);
    expect(sealed!.status).toBe("verified");
    expect(mine.chain.intact).toBe(true);
    // Statements ride along, grouped by period.
    expect(mine.statements.length).toBeGreaterThanOrEqual(2);
    expect(mine.statements.some((s) => s.periodKey === "Nov 2026")).toBe(true);
    const pay = mine.statements.find((s) => s.kind !== "settlement");
    expect(pay?.net).toBe(1050);

    const fleet = await Actions.getLibrary.handler(libOwnerCtx, {} as never);
    expect(fleet.fleet).not.toBeNull();
    const fDelivered = fleet.fleet!.deliveredLoads.find((l) => l.loadId === libLoadId);
    expect(fDelivered).toBeDefined();
    expect(fDelivered!.driverUsername).toBe("libdriver");
    expect(fleet.fleet!.sealedFiles.some((s) => s.recordId === libLoadId)).toBe(true);
    // The desk's own personal sections stay the desk's.
    expect(fleet.deliveredLoads.length).toBe(0);
  });

  test("(m) another fleet sees none of it", async () => {
    const other = await Actions.getLibrary.handler(libOtherCtx, {} as never);
    expect(other.deliveredLoads.length).toBe(0);
    expect(other.fleet?.deliveredLoads.length ?? 0).toBe(0);
    expect(other.sealedFiles.some((s) => s.recordId === libLoadId)).toBe(false);
    expect(other.uploads.length).toBe(0);
    expect(other.statements.length).toBe(0);

    const solo = await Actions.getLibrary.handler(libStrangerCtx, {} as never);
    expect(solo.deliveredLoads.length).toBe(0);
    expect(solo.fleet).toBeNull();
    expect(solo.sealedFiles.length).toBe(0);
  });

  test("(n) fuel-tax state lines match getIftaReport for the same quarter", async () => {
    const mine = await Actions.getLibrary.handler(libDriverCtx, {} as never);
    const q = mine.fuelTax.find((x) => x.year === 2026 && x.quarter === 3);
    expect(q).toBeDefined();

    const report = await Actions.getIftaReport.handler(libDriverCtx, { year: 2026, quarter: 3 } as never);
    const reportRows = (report as unknown as { rows: { state: string; miles: number; gallonsBought: number }[] }).rows;
    expect(reportRows).toBeDefined();
    const byState = new Map(reportRows.map((r) => [r.state, r]));
    expect(q!.rows.length).toBe(byState.size);
    for (const row of q!.rows) {
      const src = byState.get(row.state);
      expect(src).toBeDefined();
      expect(row.miles).toBe(src!.miles);
      expect(row.gallonsBought).toBe(src!.gallonsBought);
    }
    const al = q!.rows.find((r) => r.state === "AL")!;
    expect(al.miles).toBe(600);
    expect(al.gallonsBought).toBe(80);
    // The filing generated earlier is listed.
    expect(mine.filings.some((f) => f.title.includes("2026") && f.kind === "ifta")).toBe(true);
  });

  test("(o) uploads are private to their owner/fleet scope", async () => {
    const mine = await Actions.getLibrary.handler(libDriverCtx, {} as never);
    expect(mine.uploads.some((u) => u.ref === `upload:filed:${libLoadId}` || u.label.includes("POD"))).toBe(true);
    expect(mine.uploads.some((u) => u.label.includes("CDL"))).toBe(true);
    const filedRef = mine.uploads.find((u) => u.label.includes("POD"))!.ref;

    const owner = await Actions.getLibrary.handler(libOwnerCtx, {} as never);
    expect(owner.uploads.some((u) => u.ref === filedRef)).toBe(false);

    const doc = await Actions.getLibraryDocument.handler(libDriverCtx, { ref: filedRef } as never);
    expect(doc.ok).toBe(true);
    expect(Buffer.from(doc.dataBase64!, "base64").toString()).toContain("pod");
    const cross = await Actions.getLibraryDocument.handler(libOtherCtx, { ref: filedRef } as never);
    expect(cross.ok).toBe(false);
  });

  test("(q) cross-scope download/email refused with no audit row; in-scope email queues + logs", async () => {
    const sealedRef = `sealed:${libLoadId}`;
    const dl = await Actions.getLibraryDocument.handler(libOtherCtx, { ref: sealedRef } as never);
    expect(dl.ok).toBe(false);
    const em = await Actions.emailLibraryDocument.handler(libOtherCtx, { ref: sealedRef, toEmail: "spy@other.test" } as never);
    expect(em.ok).toBe(false);
    expect((await getDb().select().from(schema.documentSends)).length).toBe(0);

    const own = await Actions.getLibraryDocument.handler(libDriverCtx, { ref: sealedRef } as never);
    expect(own.ok).toBe(true);
    expect(own.mime).toBe("application/pdf");
    expect(own.dataBase64!.startsWith("JVBERi")).toBe(true); // %PDF

    const sent = await Actions.emailLibraryDocument.handler(libDriverCtx, { ref: "ifta:2026:3", toEmail: libDriverEmail } as never);
    expect(sent.ok).toBe(true);
    expect(sent.status).toBe("queued"); // transport unconfigured in tests (D1 mechanics)
    const sends = await getDb().select().from(schema.documentSends);
    expect(sends.length).toBe(1);
    expect(sends[0]!.toEmail).toBe(libDriverEmail);
    expect(sends[0]!.replyTo).toBe(libDriverEmail);
    expect(sends[0]!.docRef).toBe("ifta:2026:3");
    const events = (await getDb().select().from(schema.chainLog)).map((r) => r.event);
    expect(events).toContain("document_emailed");
  });

  test("(p) sealed statuses match verifyChain — including after tampering", async () => {
    const before = await Actions.verifyChain.handler(libDriverCtx, {} as never);
    expect(before.intact).toBe(true);

    // Tamper with the POD seal entry's payload — the hash no longer matches.
    await getDb()
      .update(schema.chainLog)
      .set({ payload: JSON.stringify({ autoSealed: false, forged: true }) })
      .where(eq(schema.chainLog.id, libPodSealEntryId));

    const after = await Actions.verifyChain.handler(libDriverCtx, {} as never);
    expect(after.intact).toBe(false);

    const mine = await Actions.getLibrary.handler(libDriverCtx, {} as never);
    expect(mine.chain.intact).toBe(false);
    const sealed = mine.sealedFiles.find((s) => s.recordKind === "load" && s.recordId === libLoadId);
    expect(sealed).toBeDefined();
    expect(sealed!.status).toBe("broken");
  });
});

// ---------------------------------------------------------------------------
// Receive link + signature close-out (owner orders, 2026-11-10):
//   (r) the public receive page carries NO rate/money fields
//   (s) a receiver confirmation seals the delivery, flips the desk
//       status, and completes the Library packet
//   (t) a token cannot read or act on any other load; forged refused
//   (u) post-confirmation the link refuses further edits (first wins)
//   (v) the driver fallback close (standing POD seal) still works
//   (w) desk regeneration invalidates the old token
//   (x) phone-signature close seals + attaches the signature document
//   (y) paper-POD upload close seals; the desk sees status + proof
//   (x2) a second close path after the first writes NO duplicate event
//   (z) exception notes surface the flag at the desk
//   (aa) receiver copy by email queues/sends exactly one copy
//   (bb) the copy link is view-only
//   (cc) document download returns the signed POD PDF
//   (dd) skipping the copy prompt changes nothing about the seal
// ---------------------------------------------------------------------------

const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0),
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);
const TINY_JPEG_B64 = TINY_JPEG.toString("base64");
const TINY_JPEG_SHA = createHash("sha256").update(TINY_JPEG).digest("hex");

async function bookLoadFor(driverCtx: CtxT, username: string): Promise<{ boardId: number; loadId: number }> {
  const boardId = await postFleetLoad(owner1Ctx);
  const asg = await Actions.assignBoardLoad.handler(owner1Ctx, { id: boardId, targetUsername: username } as never);
  expect(asg.ok).toBe(true);
  const acc = await Actions.acceptAssignedLoad.handler(driverCtx, { id: boardId } as never);
  expect(acc.ok).toBe(true);
  return { boardId, loadId: acc.loadId! };
}

async function bookLoadForDriverA(): Promise<{ boardId: number; loadId: number }> {
  return bookLoadFor(aCtx, "drivera");
}

// NOTE: once a driver DELIVERS a load, the standing dispatch-fee gate
// blocks him from taking new board loads until the fee settles — so
// each close-out case books for a FRESH fleet driver (clean fee
// slate) instead of fighting the gate. The gate itself is Dispatch
// rounds behavior, unchanged by these legs.
let freshN = 0;
async function bookLoadForFreshDriver(): Promise<{ boardId: number; loadId: number; ctx: CtxT }> {
  freshN++;
  const u = await seedUser(`freshdrv${freshN}`);
  await addMember(fleet1, u.username, "driver");
  const ctx = ctxFor(u);
  const booked = await bookLoadFor(ctx, u.username);
  return { ...booked, ctx };
}

async function chainEvents(loadId: number, event: string) {
  const rows = await getDb().select().from(schema.chainLog);
  return rows.filter((r) => r.refKind === "load" && r.refId === loadId && r.event === event);
}

describe("receive link + signature close-out", () => {
  let boardId = 0;
  let loadId = 0;
  let token = "";

  test("setup: a booked load is born carrying a receive link", async () => {
    ({ boardId, loadId } = await bookLoadForDriverA());
    const link = await Actions.getLoadReceiveLink.handler(aCtx, { loadId } as never);
    expect(link.ok).toBe(true);
    expect(link.token).toMatch(/^rcv_[0-9a-f]{32}$/);
    expect(link.url).toContain(`/receive/${link.token}`);
    expect(link.confirmed).toBe(false);
    token = link.token!;
    // Minted at booking: the row already existed before this call.
    const rows = await getDb().select().from(schema.receiveLinks);
    expect(rows.filter((r) => r.loadId === loadId && r.kind === "action").length).toBe(1);
  });

  test("(r) the receive page data contains NO rate or money fields", async () => {
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(info.valid).toBe(true);
    expect(info.canConfirm).toBe(true);
    expect(info.shipperName).toBe("Acme Steel");
    expect(info.deliveryCity).toBe("Dallas");
    expect(info.commodity).toBe("steel coils");
    const wire = JSON.stringify(info);
    expect(wire).not.toContain('"rate"');
    expect(wire).not.toContain('"gross"');
    expect(wire).not.toContain('"totalWithExtras"');
    expect(wire).not.toContain("2400"); // the seeded load's rate value
    expect(wire.toLowerCase()).not.toContain("dispatcherfee");
  });

  test("(s) receiver confirmation seals the delivery, flips desk status, completes the Library packet", async () => {
    const r = await Actions.confirmReceive.handler(anonCtx, {
      token, receiverName: "Sam Receiver", exceptionNotes: null, photoDataBase64: null, photoMime: null,
    } as never);
    expect(r.ok).toBe(true);
    expect(r.alreadyConfirmed).toBe(false);
    expect(r.copyUrl).toContain("/pod/cpy_");

    expect((await chainEvents(loadId, "delivery_confirmed")).length).toBe(1);
    expect((await chainEvents(loadId, "pod_seal")).length).toBe(1);

    const desk = (await boardOf(owner1Ctx)).find((l) => l.id === boardId)!;
    expect(desk.linkedPodSealed).toBe(true);
    expect(desk.deliveryPath).toBe("receive_link");
    expect(desk.deliveryReceiver).toBe("Sam Receiver");
    expect(desk.deliveryException).toBeNull();

    const lib = await Actions.getLibrary.handler(aCtx, {} as never);
    expect(lib.deliveredLoads.some((l) => l.loadId === loadId)).toBe(true);
    const packet = await Actions.getLibraryDocument.handler(aCtx, { ref: `packet:${loadId}` } as never);
    expect(packet.ok).toBe(true);
    const pod = await Actions.getLibraryDocument.handler(aCtx, { ref: `pod:${loadId}` } as never);
    expect(pod.ok).toBe(true);
    expect(Buffer.from(pod.dataBase64!, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("(u) post-confirmation the link refuses further edits — first close wins", async () => {
    const again = await Actions.confirmReceive.handler(anonCtx, {
      token, receiverName: "Someone Else", exceptionNotes: "changed my mind", photoDataBase64: null, photoMime: null,
    } as never);
    expect(again.ok).toBe(true);
    expect(again.alreadyConfirmed).toBe(true);
    expect((await chainEvents(loadId, "delivery_confirmed")).length).toBe(1);
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(info.status).toBe("confirmed");
    expect(info.receiverName).toBe("Sam Receiver"); // the FIRST name stands
    expect(info.canConfirm).toBe(false);
  });

  test("(aa) receiver copy by email queues exactly one copy, audited against the load", async () => {
    const before = (await getDb().select().from(schema.documentSends)).filter((d) => d.docKind === "receiver_copy");
    expect(before.length).toBe(0);
    const r = await Actions.emailReceiverCopy.handler(anonCtx, { token, toEmail: "sam@receiver.example" } as never);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("queued"); // transport unconfigured in tests — queued honestly, never faked sent
    const after = (await getDb().select().from(schema.documentSends)).filter((d) => d.docKind === "receiver_copy");
    expect(after.length).toBe(1);
    expect(after[0]!.toEmail).toBe("sam@receiver.example");
    expect(after[0]!.docRef).toBe(`podcopy:${loadId}`);
    expect(after[0]!.profileId).toBe(driverA.profileId);
    const evts = await chainEvents(loadId, "receiver_copy_emailed");
    expect(evts.length).toBe(1);
    expect(evts[0]!.payload).not.toContain("sam@receiver.example"); // masked in the chain
  });

  test("(bb)+(cc) the copy link is view-only and its document is the signed POD PDF", async () => {
    const linkRes = await Actions.getReceiverCopyLink.handler(anonCtx, { token } as never);
    expect(linkRes.ok).toBe(true);
    const copyToken = linkRes.copyToken!;
    expect(copyToken).toMatch(/^cpy_/);
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token: copyToken } as never);
    expect(info.valid).toBe(true);
    expect(info.kind).toBe("copy");
    expect(info.canConfirm).toBe(false);
    const confirmTry = await Actions.confirmReceive.handler(anonCtx, {
      token: copyToken, receiverName: "Copy Holder", exceptionNotes: null, photoDataBase64: null, photoMime: null,
    } as never);
    expect(confirmTry.ok).toBe(false);
    expect((await chainEvents(loadId, "delivery_confirmed")).length).toBe(1);
    const doc = await Actions.getPodCopyDocument.handler(anonCtx, { token: copyToken } as never);
    expect(doc.ok).toBe(true);
    expect(doc.dataBase64!.startsWith("JVBERi")).toBe(true); // %PDF-
    const text = Buffer.from(doc.dataBase64!, "base64").toString("latin1");
    expect(text).toContain("Sam Receiver");
  });

  test("(dd) skipping the copy prompt changes nothing about the sealed delivery", async () => {
    const chainBefore = (await getDb().select().from(schema.chainLog)).filter((r) => r.refKind === "load" && r.refId === loadId).length;
    const sendsBefore = (await getDb().select().from(schema.documentSends)).length;
    // Receipt views + copy-link fetches are reads, not writes.
    await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    await Actions.getReceiverCopyLink.handler(anonCtx, { token } as never);
    const chainAfter = (await getDb().select().from(schema.chainLog)).filter((r) => r.refKind === "load" && r.refId === loadId).length;
    const sendsAfter = (await getDb().select().from(schema.documentSends)).length;
    expect(chainAfter).toBe(chainBefore);
    expect(sendsAfter).toBe(sendsBefore);
  });

  test("(t) a token cannot read or act on any other load; forged tokens get the generic refusal", async () => {
    const other = await bookLoadFor(bCtx, "driverb");
    const otherLink = await Actions.getLoadReceiveLink.handler(bCtx, { loadId: other.loadId } as never);
    // Load A's token shows ONLY load A's delivery (Dallas) — the other
    // load exists but is unreachable through it; there is no load id
    // parameter on the public surface at all.
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(info.deliveryCity).toBe("Dallas");
    const forged = await Actions.getReceiveInfo.handler(anonCtx, { token: "rcv_0000000000000000000000000000dead" } as never);
    expect(forged.valid).toBe(false);
    expect(forged.shipperName).toBeNull();
    const forgedConfirm = await Actions.confirmReceive.handler(anonCtx, {
      token: "rcv_0000000000000000000000000000dead", receiverName: "Forged", exceptionNotes: null, photoDataBase64: null, photoMime: null,
    } as never);
    expect(forgedConfirm.ok).toBe(false);
    expect(otherLink.token).not.toBe(token);
    expect((await chainEvents(other.loadId, "delivery_confirmed")).length).toBe(0);
  });

  test("(w) desk regeneration invalidates the old token", async () => {
    const regen = await Actions.regenerateReceiveLink.handler(owner1Ctx, { loadId } as never);
    expect(regen.ok).toBe(true);
    expect(regen.token).not.toBe(token);
    const old = await Actions.getReceiveInfo.handler(anonCtx, { token } as never);
    expect(old.valid).toBe(false);
    const fresh = await Actions.getReceiveInfo.handler(anonCtx, { token: regen.token! } as never);
    expect(fresh.valid).toBe(true);
    expect(fresh.status).toBe("confirmed"); // regeneration never un-delivers
    token = regen.token!;
  });

  test("the BOL PDF carries the receive link as text + a drawn QR", async () => {
    const bol = await Actions.getLibraryDocument.handler(aCtx, { ref: `bol:${loadId}` } as never);
    expect(bol.ok).toBe(true);
    const text = Buffer.from(bol.dataBase64!, "base64").toString("latin1");
    expect(text).toContain(`/receive/${token}`);
    expect(text).toContain(" re f"); // QR module rects in the content stream
  });

  test("(x) phone-signature close seals the delivery and attaches the signature document", async () => {
    const { boardId: b2, loadId: l2, ctx: xCtx } = await bookLoadForFreshDriver();
    const r = await Actions.signDeliveryOnPhone.handler(xCtx, {
      loadId: l2, receiverName: "Pat Dock", exceptionNotes: null,
      signatureDataBase64: TINY_JPEG_B64, signatureMime: "image/jpeg",
    } as never);
    expect(r.ok).toBe(true);
    expect(r.alreadyConfirmed).toBe(false);
    const conf = await chainEvents(l2, "delivery_confirmed");
    expect(conf.length).toBe(1);
    const payload = JSON.parse(conf[0]!.payload) as { path: string; docSha256: string };
    expect(payload.path).toBe("phone_signature");
    expect(payload.docSha256).toBe(TINY_JPEG_SHA);
    const copies = (await getDb().select().from(schema.filedDocCopies)).filter((c) => c.loadId === l2 && c.docKind === "pod");
    expect(copies.length).toBe(1);
    expect(copies[0]!.sha256).toBe(TINY_JPEG_SHA);
    const desk = (await boardOf(owner1Ctx)).find((l) => l.id === b2)!;
    expect(desk.deliveryPath).toBe("phone_signature");
    expect(desk.deliveryReceiver).toBe("Pat Dock");
    // The signed POD PDF embeds the signature image (DCTDecode).
    const pod = await Actions.getLibraryDocument.handler(xCtx, { ref: `pod:${l2}` } as never);
    expect(pod.ok).toBe(true);
    expect(Buffer.from(pod.dataBase64!, "base64").toString("latin1")).toContain("/DCTDecode");

    // (x2) a second close path writes NO duplicate delivery event.
    const link2 = await Actions.getLoadReceiveLink.handler(xCtx, { loadId: l2 } as never);
    const second = await Actions.confirmReceive.handler(anonCtx, {
      token: link2.token!, receiverName: "Late Link", exceptionNotes: null, photoDataBase64: null, photoMime: null,
    } as never);
    expect(second.ok).toBe(true);
    expect(second.alreadyConfirmed).toBe(true);
    expect((await chainEvents(l2, "delivery_confirmed")).length).toBe(1);
    expect((await chainEvents(l2, "pod_seal")).length).toBe(1);
  });

  test("(y) paper-POD upload close seals it and the desk sees status + proof", async () => {
    const { boardId: b3, loadId: l3, ctx: yCtx } = await bookLoadForFreshDriver();
    const r = await Actions.uploadSignedBolPod.handler(yCtx, {
      loadId: l3, receiverName: "Jo Paper", exceptionNotes: null,
      photoDataBase64: TINY_JPEG_B64, photoMime: "image/jpeg",
    } as never);
    expect(r.ok).toBe(true);
    const desk = (await boardOf(owner1Ctx)).find((l) => l.id === b3)!;
    expect(desk.linkedPodSealed).toBe(true);
    expect(desk.deliveryPath).toBe("paper_bol");
    const copies = (await getDb().select().from(schema.filedDocCopies)).filter((c) => c.loadId === l3 && c.docKind === "pod");
    expect(copies.length).toBe(1);
    expect(copies[0]!.sha256).toBe(TINY_JPEG_SHA); // the proof is filed + viewable
    const lib = await Actions.getLibrary.handler(owner1Ctx, {} as never);
    expect((lib.fleet?.deliveredLoads ?? []).some((l) => l.loadId === l3)).toBe(true);
  });

  test("(z) exception notes surface the flag at the desk — visibly, not buried", async () => {
    const { boardId: b4, loadId: l4, ctx: zCtx } = await bookLoadForFreshDriver();
    const r = await Actions.signDeliveryOnPhone.handler(zCtx, {
      loadId: l4, receiverName: "Rue Checker", exceptionNotes: "2 cases crushed, corner damage",
      signatureDataBase64: TINY_JPEG_B64, signatureMime: "image/jpeg",
    } as never);
    expect(r.ok).toBe(true);
    const desk = (await boardOf(owner1Ctx)).find((l) => l.id === b4)!;
    expect(desk.deliveryException).toBe("2 cases crushed, corner damage");
    const link = await Actions.getLoadReceiveLink.handler(zCtx, { loadId: l4 } as never);
    expect(link.exceptionNotes).toBe("2 cases crushed, corner damage");
  });

  test("(v) driver fallback close still works when the link was never used", async () => {
    const { loadId: l5, ctx: vCtx } = await bookLoadForFreshDriver();
    const seal = await Actions.sealDelivery.handler(vCtx, {
      loadId: l5, lat: 32.7767, lon: -96.797, autoSealed: false, deliveryLat: 32.7767, deliveryLon: -96.797,
    } as never);
    expect(seal.hash).toBeTruthy();
    expect((await chainEvents(l5, "pod_seal")).length).toBe(1);
    const link = await Actions.getLoadReceiveLink.handler(vCtx, { loadId: l5 } as never);
    expect(link.confirmed).toBe(true);
    expect(link.path).toBe("driver_pod");
    // And the link then reports already-confirmed instead of double-sealing.
    const viaLink = await Actions.confirmReceive.handler(anonCtx, {
      token: link.token!, receiverName: "Too Late", exceptionNotes: null, photoDataBase64: null, photoMime: null,
    } as never);
    expect(viaLink.alreadyConfirmed).toBe(true);
    expect((await chainEvents(l5, "delivery_confirmed")).length).toBe(0);
    expect((await chainEvents(l5, "pod_seal")).length).toBe(1);
  });

  test("no server SMS codepath exists — no action sends texts", () => {
    const names = Object.keys(Actions);
    expect(names.filter((n) => /sms|textmessage/i.test(n))).toEqual([]);
    // The text offer is an audit log of a DEVICE handoff, nothing more.
    expect(names).toContain("logReceiverCopyTextOffer");
  });
});
