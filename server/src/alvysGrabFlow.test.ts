// alvysGrabFlow.test.ts — INTEGRATION tests for the Alvys-grab
// build (2026-11-15), run against the REAL action handlers over a
// throwaway migrated SQLite database:
//
//   SEARCH — the caller's scope is the whole law: a driver finds
//   their own loads (number / lane / shipper / reference) and never
//   another driver's; a desk finds its fleet's drivers + board and
//   never another fleet's; a broker finds only its own posted
//   loads. Seeded rates (4321 / 7777) ride NO result.
//
//   SUGGESTIONS — the desk's open loads rank per driver with the
//   reasons printed; the payload carries no rate; and the funnel
//   still rules: a driver with NO qualification file, suggested
//   like anyone else, is refused by assignBoardLoad's DQF gate.
//
//   PAPERWORK DOOR — a per-load "docs" link: the public face shows
//   lane + date only (no rate); uploads are SNIFFED (a text file
//   wearing a PDF's name is refused, an oversized file is
//   refused); a good filing lands in the load's paperwork pipeline
//   (rate_con row, extraction honestly not_configured), seals with
//   ids/kind only (no sender label on chain), and notifies the
//   driver in-app. The door closes at delivery and on revoke, and
//   the per-load hourly cap holds.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-alvys-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.INFERENCE_API_KEY;
delete process.env.PAPERWORK_INBOUND_EMAIL_ADDRESS;
delete process.env.PAPERWORK_INBOUND_EMAIL_SECRET;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { DOOR_SUBMISSIONS_PER_HOUR, paperworkInboundEmailFromEnv, sniffDoorDocMime } = await import("./paperworkDoor");
const { and, desc, eq } = await import("drizzle-orm");

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

const db = getDb();

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

async function seedFleet(owner: SeededUser, name: string): Promise<number> {
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
  await db.insert(schema.companyMembers).values({ companyId, username, role });
}

/** A complete, current DQF (the boardAssignFlow pattern) — the
 * dispatch gate reads it at assign time. */
async function seedDqf(companyId: number, username: string) {
  const f = await db
    .insert(schema.dqfFiles)
    .values({ companyId, driverUsername: username, createdBy: username })
    .returning({ id: schema.dqfFiles.id });
  const fileId = f[0]!.id;
  const d = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const rows = [
    { kind: "application", entryDate: d(-300), expiresOn: null, payloadJson: "{}" },
    { kind: "cdl", entryDate: d(-600), expiresOn: d(400), payloadJson: JSON.stringify({ state: "AL", licenseClass: "A" }) },
    { kind: "medical", entryDate: d(-100), expiresOn: d(400), payloadJson: JSON.stringify({ examinerName: "Dr. A", registryNumber: "12345" }) },
    { kind: "road_test", entryDate: d(-299), expiresOn: null, payloadJson: "{}" },
    { kind: "mvr_review", entryDate: d(-30), expiresOn: null, payloadJson: JSON.stringify({ outcome: "acceptable" }) },
    { kind: "clearinghouse_query", entryDate: d(-301), expiresOn: null, payloadJson: JSON.stringify({ queryType: "pre_employment", result: "clear" }) },
    { kind: "employment_history", entryDate: d(-300), expiresOn: null, payloadJson: JSON.stringify({ employer: "Prior Carrier LLC" }) },
    { kind: "violation_record", entryDate: d(-30), expiresOn: null, payloadJson: JSON.stringify({ description: "No violations in the past year" }) },
  ];
  for (const r of rows) await db.insert(schema.dqfEntries).values({ fileId, recordedBy: username, ...r });
}

// ---- Cast -------------------------------------------------------------------
const owner1 = await seedUser("agowner", "Olivia Owner");
const driverA = await seedUser("agdrivera", "Andy Alpha");
const driverB = await seedUser("agdriverb", "Ben Blocked"); // fleet driver, NO DQF on file
const owner2 = await seedUser("agowner2", "Oscar Other");
const driverC = await seedUser("agdriverc", "Cara Cross");
const solo = await seedUser("agsolo", "Sam Solo");
const brokerUser = await seedUser("agbroker", "Bea Broker");

const fleet1 = await seedFleet(owner1, "Grab Fleet One LLC");
await addMember(fleet1, driverA.username, "driver");
await addMember(fleet1, driverB.username, "driver");
await seedDqf(fleet1, driverA.username); // driverB deliberately gets NO file
const fleet2 = await seedFleet(owner2, "Grab Fleet Two LLC");
await addMember(fleet2, driverC.username, "driver");
await seedDqf(fleet2, driverC.username);
// The broker's posted loads ride a shell company; the broker is a
// plain member there (no desk seat) — their scope in search comes
// from the broker account, not a desk.
const brokerCoRows = await db
  .insert(schema.companies)
  .values({ name: "Broker Shell LLC", ownerUsername: brokerUser.username })
  .returning({ id: schema.companies.id });
const brokerCo = brokerCoRows[0]!.id;
await db.insert(schema.companyMembers).values({ companyId: brokerCo, username: brokerUser.username, role: "driver" });

const ownerCtx = ctxFor(owner1);
const aCtx = ctxFor(driverA);
const owner2Ctx = ctxFor(owner2);
const soloCtx = ctxFor(solo);
const brokerCtx = ctxFor(brokerUser);
const anonCtx = ctxFor(null);

// ---- Records ------------------------------------------------------------------
const nowMs = Date.now();
const DAY = 86_400_000;

async function seedLoad(profileId: number, over: Record<string, unknown>): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({
      profileId,
      shipper: "Acme Steel",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      commodity: "steel coils",
      weightLbs: 40000,
      status: "booked",
      ...over,
    })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

async function seedBoardLoad(over: Record<string, unknown>): Promise<number> {
  const rows = await db
    .insert(schema.boardLoads)
    .values({
      companyId: fleet1,
      postedBy: owner1.username,
      shipper: "Acme Steel",
      pickupCity: "Fort Worth",
      pickupState: "TX",
      deliveryCity: "Austin",
      deliveryState: "TX",
      pickupText: "Tue 8a",
      deliveryText: "Wed 5p",
      rate: 7777,
      weightLbs: 30000,
      commodity: "lumber",
      equipmentType: "flatbed",
      status: "open",
      pickupApptAt: new Date(nowMs + 2 * DAY),
      deliveryApptAt: new Date(nowMs + 3 * DAY),
      ...over,
    })
    .returning({ id: schema.boardLoads.id });
  return rows[0]!.id;
}

// driverA's own load — the seeded rate 4321 must never surface.
const loadA = await seedLoad(driverA.profileId, { rate: 4321, referenceNumber: "REF-ALVYS-1", status: "picked_up" });
// solo's load — invisible to everyone else.
const loadSolo = await seedLoad(solo.profileId, { shipper: "Zebra Freight", pickupCity: "Pensacola", pickupState: "FL", rate: 4321 });
// fleet1's open board load — the seeded rate 7777 must never surface.
const boardOpen = await seedBoardLoad({});
// fleet2's open board load — invisible to fleet1.
const boardOther = await seedBoardLoad({ companyId: fleet2, postedBy: owner2.username, shipper: "Other Fleet Goods" });
// the broker's own posted load.
const boardBroker = await seedBoardLoad({ companyId: brokerCo, postedBy: brokerUser.username, shipper: "Brokered Widgets" });
const brokerAcct = await db
  .insert(schema.brokerAccounts)
  .values({ name: "Bea Brokerage", email: brokerUser.email, linkedUsername: brokerUser.username, ownerUsername: brokerUser.username })
  .returning({ id: schema.brokerAccounts.id });
await db.insert(schema.brokerPosterLoads).values({ brokerId: brokerAcct[0]!.id, createdBy: brokerUser.username, boardLoadId: boardBroker });

// driverA is mid-load: the published route ends in Dallas and the
// truck's position is shared (the fleet-board gate's own rules).
await db.insert(schema.driverFleetStatus).values({
  username: driverA.username,
  loadId: loadA,
  loadStatus: "picked_up",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
  stopsJson: "[]",
  endLat: 32.78,
  endLon: -96.8,
  publishedAt: new Date(),
});
await db.insert(schema.driverPositions).values({ username: driverA.username, lat: 32.78, lon: -96.8, updatedAt: new Date() });

// ---- Document fixtures ---------------------------------------------------------
const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4\n% door fixture\n"), Buffer.alloc(64, 0x2e)]);
const PDF_B64 = PDF_BYTES.toString("base64");
const TEXT_B64 = Buffer.from("this is plain text wearing a document's name, definitely not a pdf or a photo scan").toString("base64");
const BIG_PDF_B64 = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(8_100_000, 0x2e)]).toString("base64");
const jpegBytes = (() => {
  const b = Buffer.alloc(48, 0);
  b[0] = 0xff; b[1] = 0xd8; // SOI
  b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(16, 4); // APP0, len 16
  b[20] = 0xff; b[21] = 0xc0; b.writeUInt16BE(17, 22); // SOF0
  b[24] = 8; b.writeUInt16BE(16, 25); b.writeUInt16BE(16, 27); // precision, height, width
  return b;
})();

// ============================================================================
describe("paperwork door sniffing (pure)", () => {
  test("PDF / JPEG / PNG pass on their bytes; text and oversize are refused", () => {
    expect(sniffDoorDocMime(new Uint8Array(PDF_BYTES))).toBe("application/pdf");
    expect(sniffDoorDocMime(new Uint8Array(jpegBytes))).toBe("image/jpeg");
    const png = Buffer.alloc(40, 0);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "ascii");
    expect(sniffDoorDocMime(new Uint8Array(png))).toBe("image/png");
    expect(sniffDoorDocMime(new Uint8Array(Buffer.from(TEXT_B64, "base64")))).toBeNull();
    expect(sniffDoorDocMime(new Uint8Array(Buffer.alloc(8_100_000, 0x2e)))).toBeNull();
    expect(sniffDoorDocMime(new Uint8Array(Buffer.from("%PDF-")))).toBeNull(); // too small to be a document
  });

  test("the inbound-email seam is env-gated: unconfigured claims nothing", () => {
    expect(paperworkInboundEmailFromEnv({})).toBeNull();
    expect(paperworkInboundEmailFromEnv({ PAPERWORK_INBOUND_EMAIL_ADDRESS: "loads@example.com" })).toBeNull();
    const seam = paperworkInboundEmailFromEnv({
      PAPERWORK_INBOUND_EMAIL_ADDRESS: "loads@example.com",
      PAPERWORK_INBOUND_EMAIL_SECRET: "s3cret",
    });
    expect(seam?.address).toBe("loads@example.com");
    // The secret itself never leaves the seam — only a verifier.
    expect(seam?.verifySecret("s3cret")).toBe(true);
    expect(seam?.verifySecret("wrong")).toBe(false);
    expect(JSON.stringify(seam)).not.toContain("s3cret");
  });
});

// ============================================================================
describe("global search — scope is the law", () => {
  test("a driver finds their own load by shipper, reference, and number — never the rate", async () => {
    const byShipper = await Actions.globalSearch.handler(aCtx, { query: "acme" } as never);
    expect(byShipper.ok).toBe(true);
    const loadsGroup = byShipper.groups.find((g) => g.kind === "loads");
    expect(loadsGroup?.results.some((r) => r.loadId === loadA)).toBe(true);
    const byRef = await Actions.globalSearch.handler(aCtx, { query: "ALVYS" } as never);
    expect(byRef.groups.some((g) => g.results.some((r) => r.loadId === loadA))).toBe(true);
    const byNumber = await Actions.globalSearch.handler(aCtx, { query: `#${loadA}` } as never);
    expect(byNumber.groups.some((g) => g.results.some((r) => r.loadId === loadA))).toBe(true);
    expect(JSON.stringify(byShipper)).not.toContain("4321");
    expect(JSON.stringify(byShipper)).not.toContain("7777");
  });

  test("a driver never sees another driver's records", async () => {
    const r = await Actions.globalSearch.handler(aCtx, { query: "zebra" } as never);
    expect(r.groups.every((g) => g.results.every((x) => x.loadId !== loadSolo))).toBe(true);
    expect(r.groups.length).toBe(0);
    const own = await Actions.globalSearch.handler(soloCtx, { query: "zebra" } as never);
    expect(own.groups.some((g) => g.results.some((x) => x.loadId === loadSolo))).toBe(true);
  });

  test("a desk finds its fleet's drivers and board — and never another fleet's", async () => {
    const byDriver = await Actions.globalSearch.handler(ownerCtx, { query: "andy" } as never);
    const drivers = byDriver.groups.find((g) => g.kind === "drivers");
    expect(drivers?.results.some((r) => r.username === driverA.username)).toBe(true);
    const board = await Actions.globalSearch.handler(ownerCtx, { query: "acme" } as never);
    expect(board.groups.some((g) => g.results.some((r) => r.boardLoadId === boardOpen))).toBe(true);
    expect(JSON.stringify(board)).not.toContain("7777");
    const other = await Actions.globalSearch.handler(ownerCtx, { query: "other fleet" } as never);
    expect(other.groups.every((g) => g.results.every((x) => x.boardLoadId !== boardOther))).toBe(true);
    const otherSide = await Actions.globalSearch.handler(owner2Ctx, { query: "other fleet" } as never);
    expect(otherSide.groups.some((g) => g.results.some((r) => r.boardLoadId === boardOther))).toBe(true);
  });

  test("a broker finds only its own posted loads", async () => {
    const r = await Actions.globalSearch.handler(brokerCtx, { query: "brokered" } as never);
    expect(r.groups.some((g) => g.results.some((x) => x.boardLoadId === boardBroker))).toBe(true);
    const driver = await Actions.globalSearch.handler(aCtx, { query: "brokered" } as never);
    expect(driver.groups.every((g) => g.results.every((x) => x.boardLoadId !== boardBroker))).toBe(true);
  });

  test("a one-letter query is refused, not widened", async () => {
    const r = await Actions.globalSearch.handler(aCtx, { query: "a" } as never);
    expect(r.ok).toBe(false);
  });
});

// ============================================================================
describe("suggested next load — ranking without bypass", () => {
  test("the desk gets ranked suggestions with reasons and no rate anywhere", async () => {
    const r = await Actions.getNextLoadSuggestions.handler(ownerCtx, {
      pickupPoints: [{ boardLoadId: boardOpen, lat: 32.75, lon: -97.33 }],
    } as never);
    expect(r.ok).toBe(true);
    const forA = r.drivers.find((d) => d.username === driverA.username);
    expect(forA?.suggestions.length).toBeGreaterThan(0);
    const top = forA!.suggestions[0]!;
    expect(top.boardLoadId).toBe(boardOpen);
    // Deadhead from the route END (Dallas) to the pickup (Fort Worth).
    expect(top.legs.deadhead.status).toBe("ok");
    expect(top.deadheadMi).toBeGreaterThan(25);
    expect(top.deadheadMi).toBeLessThan(40);
    expect(top.reasons.join(" · ")).toContain("mi deadhead");
    // The other fleet's open load is never suggested here.
    expect(r.drivers.every((d) => d.suggestions.every((s) => s.boardLoadId !== boardOther))).toBe(true);
    expect(JSON.stringify(r)).not.toContain("7777");
    expect(JSON.stringify(r)).not.toContain("4321");
  });

  test("a driver seat gets no suggestions surface at all", async () => {
    const r = await Actions.getNextLoadSuggestions.handler(aCtx, { pickupPoints: [] } as never);
    expect(r.ok).toBe(false);
  });

  test("THE GATE TEST: a suggested driver with no DQF is still refused by the assign funnel", async () => {
    const r = await Actions.getNextLoadSuggestions.handler(ownerCtx, { pickupPoints: [] } as never);
    const forB = r.drivers.find((d) => d.username === driverB.username);
    // driverB IS suggested (ranking doesn't gate)…
    expect(forB?.suggestions.some((s) => s.boardLoadId === boardOpen)).toBe(true);
    // …and the funnel still refuses the bind, on qualification.
    const assign = await Actions.assignBoardLoad.handler(ownerCtx, {
      id: boardOpen,
      targetUsername: driverB.username,
    } as never);
    expect(assign.ok).toBe(false);
    expect(assign.error ?? "").toMatch(/qualif/i);
    // The load never moved.
    const rows = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, boardOpen));
    expect(rows[0]!.status).toBe("open");
    expect(rows[0]!.claimedBy).toBeNull();
  });
});

// ============================================================================
describe("paperwork door — the link is the feature", () => {
  let token = "";

  test("the driver creates the link; the public face shows lane + date only", async () => {
    const created = await Actions.createLoadDocsLink.handler(aCtx, { loadId: loadA } as never);
    expect(created.ok).toBe(true);
    expect(created.url).toContain("/docs/doc_");
    token = created.url!.split("/docs/")[1]!;
    const links = await Actions.getLoadDocsLinks.handler(aCtx, { loadId: loadA } as never);
    expect(links.links.length).toBe(1);
    expect(links.links[0]!.state).toBe("live");
    const info = await Actions.getDocsDoorInfo.handler(anonCtx, { token } as never);
    expect(info.valid).toBe(true);
    expect(info.state).toBe("live");
    expect(info.lane).toBe("Mobile, AL → Dallas, TX");
    expect(JSON.stringify(info)).not.toContain("4321");
  });

  test("a bogus token gets the one generic refusal", async () => {
    const info = await Actions.getDocsDoorInfo.handler(anonCtx, { token: "<redacted>" } as never);
    expect(info.valid).toBe(false);
    const submit = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token: "<redacted>",
      docKind: "rate_con",
      senderLabel: null,
      dataBase64: PDF_B64,
    } as never);
    expect(submit.ok).toBe(false);
  });

  test("a text file wearing a document's name is refused — the bytes are sniffed", async () => {
    const r = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token,
      docKind: "rate_con",
      senderLabel: "Acme Brokerage",
      dataBase64: TEXT_B64,
    } as never);
    expect(r.ok).toBe(false);
    const rows = await db.select().from(schema.loadPaperwork).where(eq(schema.loadPaperwork.loadId, loadA));
    expect(rows.length).toBe(0);
  });

  test("an oversized file is refused", async () => {
    const r = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token,
      docKind: "rate_con",
      senderLabel: null,
      dataBase64: BIG_PDF_B64,
    } as never);
    expect(r.ok).toBe(false);
  });

  test("a real filing lands in the pipeline, seals ids/kind only, and notifies the driver in-app", async () => {
    const r = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token,
      docKind: "rate_con",
      senderLabel: "Acme Brokerage",
      dataBase64: PDF_B64,
    } as never);
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.loadPaperwork).where(eq(schema.loadPaperwork.loadId, loadA));
    expect(rows.length).toBe(1);
    expect(rows[0]!.docKind).toBe("rate_con");
    expect(rows[0]!.filedBy).toBe("door: Acme Brokerage");
    expect(rows[0]!.extractionStatus).toBe("not_configured"); // the seam's honest state
    // The driver's own paperwork panel sees the rate con.
    const state = await Actions.getLoadPaperwork.handler(aCtx, { loadId: loadA } as never);
    expect(state.rateCon.filed).toBe(true);
    // The seal carries ids/kind/fingerprint — never the sender label.
    const seals = await db
      .select()
      .from(schema.chainLog)
      .where(and(eq(schema.chainLog.refKind, "load"), eq(schema.chainLog.refId, loadA), eq(schema.chainLog.event, "paperwork_filed")));
    expect(seals.length).toBe(1);
    const payload = JSON.parse(seals[0]!.payload) as Record<string, unknown>;
    expect(payload.via).toBe("door");
    expect(payload.docKind).toBe("rate_con");
    expect(JSON.stringify(payload)).not.toContain("Acme");
    // In-app notification for the driver (never email).
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, driverA.username));
    expect(notes.some((n) => n.title.includes("Rate confirmation arrived"))).toBe(true);
    // Search finds the filed paperwork by its kind's name.
    const found = await Actions.globalSearch.handler(aCtx, { query: "rate confirmation" } as never);
    expect(found.groups.some((g) => g.kind === "documents" && g.results.some((x) => x.loadId === loadA))).toBe(true);
  });

  test("the hourly cap holds: the door stops taking uploads for the load", async () => {
    // One filing already landed above; fill the rest of the hour's
    // allowance, then the next must refuse.
    for (let i = 1; i < DOOR_SUBMISSIONS_PER_HOUR; i++) {
      const r = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
        token,
        docKind: "bol",
        senderLabel: null,
        dataBase64: PDF_B64,
      } as never);
      expect(r.ok).toBe(true);
    }
    const over = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token,
      docKind: "bol",
      senderLabel: null,
      dataBase64: PDF_B64,
    } as never);
    expect(over.ok).toBe(false);
    expect(over.error ?? "").toContain("last hour");
  });

  test("revoking the link kills the door everywhere", async () => {
    const links = await Actions.getLoadDocsLinks.handler(aCtx, { loadId: loadA } as never);
    const revoked = await Actions.revokeLoadDocsLink.handler(aCtx, { loadId: loadA, linkId: links.links[0]!.id } as never);
    expect(revoked.ok).toBe(true);
    const info = await Actions.getDocsDoorInfo.handler(anonCtx, { token } as never);
    expect(info.valid).toBe(false);
    const submit = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token,
      docKind: "pod",
      senderLabel: null,
      dataBase64: PDF_B64,
    } as never);
    expect(submit.ok).toBe(false);
  });

  test("the door ends at delivery: no new link, and an open link stops taking paper", async () => {
    const loadD = await seedLoad(driverA.profileId, { status: "picked_up" });
    const created = await Actions.createLoadDocsLink.handler(aCtx, { loadId: loadD } as never);
    expect(created.ok).toBe(true);
    const t2 = created.url!.split("/docs/")[1]!;
    await addChain(
      "load",
      loadD,
      "delivery_confirmed",
      { loadId: loadD, path: "phone_signature", receiverName: "Rob Receiver", at: new Date().toISOString() },
      new Date().toISOString(),
    );
    const info = await Actions.getDocsDoorInfo.handler(anonCtx, { token: t2 } as never);
    expect(info.valid).toBe(true);
    expect(info.state).toBe("delivered");
    const submit = await Actions.submitDocsDoorPaperwork.handler(anonCtx, {
      token: t2,
      docKind: "pod",
      senderLabel: null,
      dataBase64: PDF_B64,
    } as never);
    expect(submit.ok).toBe(false);
    const again = await Actions.createLoadDocsLink.handler(aCtx, { loadId: loadD } as never);
    expect(again.ok).toBe(false);
  });
});
