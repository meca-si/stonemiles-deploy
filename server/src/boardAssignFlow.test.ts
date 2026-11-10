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
