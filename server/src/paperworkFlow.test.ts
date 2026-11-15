// paperworkFlow.test.ts — INTEGRATION tests for paperwork-to-pay
// (Research Wave 2 item 2, migrations 0130/0023), run against the
// REAL action handlers over a throwaway migrated SQLite database:
//
//   (a) intake + seam honesty: with no INFERENCE_API_KEY in the
//       environment the read lands "not_configured" and says so;
//       the load record is untouched by the filing. With the key
//       set, the host reader runs and a no-details document lands
//       "no_details" — never invented values.
//   (b) the trigger: confirmed POD + sealed delivery → the POD
//       copy goes out through document mail (queued under the
//       not-configured test transport) AND the invoice is cut
//       issued at Net-30, sealed as automatic. Either half alone
//       (unconfirmed, or unsealed) fires NOTHING.
//   (c) no recipient on file → the send parks at no_recipient and
//       the autonomy exception queue gains a
//       paperwork_no_recipient row for the driver/desk; adding
//       the address sends the copy and clears the exception.
//   (d) idempotency: re-reads and re-confirms never double-send
//       and never double-invoice.
//   (e) rate law: the seeded rates (4321 / 7777) ride NO state
//       payload and NO track payload anywhere.
//
// Pure-rule coverage lives in paperwork.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-paperwork-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.INFERENCE_API_KEY;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
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

const nowMs = Date.now();
const iso = (msAgo: number) => new Date(nowMs - msAgo).toISOString();
const HOUR = 3600_000;
const JPEG_B64 = Buffer.from(`fake-jpeg-scan-bytes-${"x".repeat(120)}`).toString("base64");

const driver = await seedUser("pwdriver", "Pete Paperwork");
const brokerUser = await seedUser("pwbroker", "Bea Broker");
const driverCtx = ctxFor(driver);
const anonCtx = createInvocation({ executePrivileged: privStub as never, viewer: null }).ctx as unknown as CtxT;

async function seedLoad(over: Record<string, unknown>): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({
      profileId: driver.profileId,
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
  const id = rows[0]!.id;
  await addChain("load", id, "load_saved", { loadId: id }, iso(5 * HOUR));
  return id;
}

async function sealDelivery(loadId: number) {
  await addChain("load", loadId, "delivery_confirmed", { loadId, path: "phone_signature", receiverName: "Rob Receiver", at: iso(1 * HOUR) }, iso(1 * HOUR));
  await addChain("load", loadId, "pod_seal", { loadId, at: iso(1 * HOUR), autoSealed: false }, iso(1 * HOUR));
}

async function chainEvents(loadId: number, event: string) {
  return db
    .select()
    .from(schema.chainLog)
    .where(and(eq(schema.chainLog.refKind, "load"), eq(schema.chainLog.refId, loadId), eq(schema.chainLog.event, event)));
}

async function sendsFor(loadId: number) {
  return db.select().from(schema.documentSends).where(eq(schema.documentSends.docRef, `paperwork-pod:${loadId}`));
}

// ---- Load A: the full pipeline ---------------------------------------------
const loadA = await seedLoad({ rate: 4321, referenceNumber: "REF-1", status: "picked_up" });

describe("intake + the extraction seam's honesty", () => {
  test("unconfigured: the filing lands, the read says not_configured, the load record is untouched", async () => {
    const state = await Actions.fileLoadPaperwork.handler(driverCtx, {
      loadId: loadA,
      docKind: "pod",
      dataBase64: JPEG_B64,
      mime: "image/jpeg",
    } as never);
    expect(state.ok).toBe(true);
    expect(state.pod.filed).toBe(true);
    expect(state.pod.extractionStatus).toBe("not_configured");
    expect(state.pod.extractionNote).toContain("isn't set up");
    const filed = await chainEvents(loadA, "paperwork_filed");
    expect(filed.length).toBe(1);
    const reads = await chainEvents(loadA, "paperwork_extraction");
    expect(reads.length).toBe(1);
    expect(JSON.parse(reads[0]!.payload).configured).toBe(false);
    // Extraction writes nothing to the load record.
    const loadRows = await db.select().from(schema.loads).where(eq(schema.loads.id, loadA));
    expect(loadRows[0]!.referenceNumber).toBe("REF-1");
    expect(loadRows[0]!.weightLbs).toBe(40000);
  });

  test("configured: the host reader runs and a no-details document lands no_details, never invented values", async () => {
    process.env.INFERENCE_API_KEY = "test-key";
    try {
      const state = await Actions.fileLoadPaperwork.handler(driverCtx, {
        loadId: loadA,
        docKind: "bol",
        dataBase64: JPEG_B64,
        mime: "image/jpeg",
      } as never);
      expect(state.ok).toBe(true);
      expect(state.bol.filed).toBe(true);
      expect(state.bol.extractionStatus).toBe("no_details");
      expect(state.bol.candidates).toEqual({ lane: null, reference: null, weightLbs: null, pieces: null, deliveryText: null });
    } finally {
      delete process.env.INFERENCE_API_KEY;
    }
  });
});

describe("the trigger — sealed + confirmed, both halves required", () => {
  let trackTokenA = "";

  test("confirmed but NOT sealed: nothing sends, nothing invoices", async () => {
    // The outward share is created now, while the load is still
    // out — shares end at delivery and can't be created after.
    const share = await Actions.createLoadShareLink.handler(driverCtx, { loadId: loadA } as never);
    expect(share.ok).toBe(true);
    trackTokenA = share.url!.split("/track/")[1]!;
    const state = await Actions.confirmPaperwork.handler(driverCtx, {
      loadId: loadA,
      docKind: "pod",
      fields: { lane: "Mobile, AL → Dallas, TX", reference: "REF-1", weightLbs: 40000, pieces: 12, deliveryText: "Nov 15, 09:00" },
      recipientEmail: "factor@pay.test",
      recipientLabel: "Factor Co",
    } as never);
    expect(state.ok).toBe(true);
    expect(state.pod.confirmed).toBe(true);
    expect(state.sealed).toBe(false);
    expect(state.stage).toBe("confirmed");
    expect(await sendsFor(loadA)).toEqual([]);
    const inv = await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.loadId, loadA));
    expect(inv).toEqual([]);
  });

  test("sealed + confirmed: the POD copy goes out and the invoice is cut issued at Net-30, sealed as automatic", async () => {
    await sealDelivery(loadA);
    const state = await Actions.getLoadPaperwork.handler(driverCtx, { loadId: loadA } as never);
    expect(state.ok).toBe(true);
    expect(state.sealed).toBe(true);
    // Send: one document send, queued under the not-configured
    // test transport, addressed to the confirmed recipient.
    const sends = await sendsFor(loadA);
    expect(sends.length).toBe(1);
    expect(sends[0]!.docKind).toBe("paperwork_pod");
    expect(sends[0]!.toEmail).toBe("factor@pay.test");
    expect(sends[0]!.status).toBe("queued");
    expect(state.sendStatus).toBe("queued");
    const sentEvents = await chainEvents(loadA, "paperwork_sent");
    expect(sentEvents.length).toBe(1);
    expect(JSON.parse(sentEvents[0]!.payload).toMasked).not.toContain("factor@pay.test");
    // Invoice: cut through the standing construction, issued,
    // Net-30, sealed as automatic. The amount lives ONLY on the
    // invoice record itself.
    const inv = await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.loadId, loadA));
    expect(inv.length).toBe(1);
    expect(inv[0]!.status).toBe("issued");
    expect(inv[0]!.dueDays).toBe(30);
    expect(inv[0]!.amount).toBe(4321);
    expect(inv[0]!.dueAt).not.toBeNull();
    const created = await chainEvents(loadA, "invoice_created");
    expect(created.length).toBe(1);
    expect(JSON.parse(created[0]!.payload).automatic).toBe(true);
    // State payload: stage + invoice number/status, NO amount.
    expect(state.stage).toBe("invoiced");
    expect(state.invoice?.number).toBe(inv[0]!.number);
    const blob = JSON.stringify(state);
    expect(blob).not.toContain("4321");
    expect(blob.toLowerCase()).not.toContain('"amount"');
    expect(blob.toLowerCase()).not.toContain('"rate"');
  });

  test("idempotent: re-reads and re-confirms never double-send or double-invoice", async () => {
    await Actions.getLoadPaperwork.handler(driverCtx, { loadId: loadA } as never);
    await Actions.confirmPaperwork.handler(driverCtx, {
      loadId: loadA,
      docKind: "pod",
      fields: { lane: "Mobile, AL → Dallas, TX", reference: "REF-1", weightLbs: 40000, pieces: 12, deliveryText: "Nov 15, 09:00" },
      recipientEmail: "factor@pay.test",
      recipientLabel: "Factor Co",
    } as never);
    await Actions.getLoadPaperwork.handler(driverCtx, { loadId: loadA } as never);
    expect((await sendsFor(loadA)).length).toBe(1);
    expect((await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.loadId, loadA))).length).toBe(1);
    expect((await chainEvents(loadA, "paperwork_sent")).length).toBe(1);
    expect((await chainEvents(loadA, "invoice_created")).length).toBe(1);
  });

  test("the outward track page shows the paperwork stage — and no rate anywhere", async () => {
    const info = await Actions.getTrackInfo.handler(anonCtx, { token: trackTokenA } as never);
    expect(info.valid).toBe(true);
    expect(info.paperwork?.stage).toBe("invoiced");
    const blob = JSON.stringify(info);
    expect(blob).not.toContain("4321");
    expect(blob.toLowerCase()).not.toContain('"rate"');
    expect(blob.toLowerCase()).not.toContain('"amount"');
    // Marking the invoice paid moves the outward stage to paid.
    const inv = await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.loadId, loadA));
    await Actions.markInvoicePaid.handler(driverCtx, { id: inv[0]!.id, paidAt: null, note: null } as never);
    const info2 = await Actions.getTrackInfo.handler(anonCtx, { token: trackTokenA } as never);
    expect(info2.paperwork?.stage).toBe("paid");
  });
});

// ---- Load B: broker prefill --------------------------------------------------
const loadB = await seedLoad({ rate: 7777, referenceNumber: "REF-2" });
const fleetRows = await db
  .insert(schema.companies)
  .values({ name: "Paperwork Fleet LLC", ownerUsername: driver.username })
  .returning({ id: schema.companies.id });
await db.insert(schema.companyMembers).values({ companyId: fleetRows[0]!.id, username: driver.username, role: "owner" });
const brokerRows = await db
  .insert(schema.brokerAccounts)
  .values({ name: "Bea Brokerage", email: "broker@pay.test", ownerUsername: brokerUser.username, linkedUsername: brokerUser.username, status: "active" })
  .returning({ id: schema.brokerAccounts.id });
const boardBRows = await db
  .insert(schema.boardLoads)
  .values({
    companyId: fleetRows[0]!.id,
    postedBy: brokerUser.username,
    pickupCity: "Mobile",
    pickupState: "AL",
    deliveryCity: "Dallas",
    deliveryState: "TX",
    rate: 7777,
    status: "taken",
    claimedBy: driver.username,
    loadId: loadB,
  })
  .returning({ id: schema.boardLoads.id });
await db.insert(schema.brokerPosterLoads).values({
  brokerId: brokerRows[0]!.id,
  companyId: fleetRows[0]!.id,
  createdBy: brokerUser.username,
  boardLoadId: boardBRows[0]!.id,
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
});

describe("recipient prefill from the broker account on file", () => {
  test("filing the POD prefills the broker's address; confirming with it sends there", async () => {
    await sealDelivery(loadB);
    const filed = await Actions.fileLoadPaperwork.handler(driverCtx, {
      loadId: loadB,
      docKind: "pod",
      dataBase64: JPEG_B64,
      mime: "image/jpeg",
    } as never);
    expect(filed.recipientEmail).toBe("broker@pay.test");
    const state = await Actions.confirmPaperwork.handler(driverCtx, {
      loadId: loadB,
      docKind: "pod",
      fields: { lane: null, reference: "REF-2", weightLbs: null, pieces: null, deliveryText: null },
      recipientEmail: "broker@pay.test",
      recipientLabel: null,
    } as never);
    expect(state.sendStatus).toBe("queued");
    const sends = await sendsFor(loadB);
    expect(sends.length).toBe(1);
    expect(sends[0]!.toEmail).toBe("broker@pay.test");
    expect(JSON.stringify(state)).not.toContain("7777");
  });
});

// ---- Load C: no recipient → exception queue ---------------------------------
const loadC = await seedLoad({ rate: 2500, referenceNumber: "REF-3" });

describe("no recipient on file — exception, not silence", () => {
  test("the send parks at no_recipient, the invoice still cuts, and the exception opens", async () => {
    await sealDelivery(loadC);
    await Actions.fileLoadPaperwork.handler(driverCtx, { loadId: loadC, docKind: "pod", dataBase64: JPEG_B64, mime: "image/jpeg" } as never);
    const state = await Actions.confirmPaperwork.handler(driverCtx, {
      loadId: loadC,
      docKind: "pod",
      fields: { lane: null, reference: "REF-3", weightLbs: null, pieces: null, deliveryText: null },
      recipientEmail: null,
      recipientLabel: null,
    } as never);
    expect(state.sendStatus).toBe("no_recipient");
    expect(await sendsFor(loadC)).toEqual([]);
    // The invoice half of the trigger is independent of the send.
    expect((await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.loadId, loadC))).length).toBe(1);
    const ex = await db
      .select()
      .from(schema.autoExceptions)
      .where(and(eq(schema.autoExceptions.loadId, loadC), eq(schema.autoExceptions.kind, "paperwork_no_recipient")));
    expect(ex.length).toBe(1);
    expect(ex[0]!.status).toBe("open");
    expect(ex[0]!.driverUsername).toBe(driver.username);
  });

  test("adding the address sends the copy and clears the exception", async () => {
    const state = await Actions.confirmPaperwork.handler(driverCtx, {
      loadId: loadC,
      docKind: "pod",
      fields: { lane: null, reference: "REF-3", weightLbs: null, pieces: null, deliveryText: null },
      recipientEmail: "factor@pay.test",
      recipientLabel: "Factor Co",
    } as never);
    expect(state.sendStatus).toBe("queued");
    expect((await sendsFor(loadC)).length).toBe(1);
    const ex = await db
      .select()
      .from(schema.autoExceptions)
      .where(and(eq(schema.autoExceptions.loadId, loadC), eq(schema.autoExceptions.kind, "paperwork_no_recipient")));
    expect(ex[0]!.status).toBe("resolved");
  });
});

// ---- Load D: sealed but never confirmed --------------------------------------
const loadD = await seedLoad({ rate: 3000, referenceNumber: "REF-4" });

describe("sealed but unconfirmed — nothing fires", () => {
  test("a filed, unconfirmed POD sends nothing and invoices nothing", async () => {
    await sealDelivery(loadD);
    const state = await Actions.fileLoadPaperwork.handler(driverCtx, {
      loadId: loadD,
      docKind: "pod",
      dataBase64: JPEG_B64,
      mime: "image/jpeg",
    } as never);
    expect(state.stage).toBe("received");
    await Actions.getLoadPaperwork.handler(driverCtx, { loadId: loadD } as never);
    expect(await sendsFor(loadD)).toEqual([]);
    expect(await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.loadId, loadD))).toEqual([]);
  });
});
