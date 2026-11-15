// factoringFlow.test.ts — INTEGRATION tests for instant pay /
// factoring + AR + broker credit (Wave 2 item 7, migration
// 0134), run against the REAL action handlers over a throwaway
// migrated SQLite database:
//
//   (a) the package assembles from an issued invoice + CONFIRMED
//       POD paperwork and stops honestly at "packaged" with no
//       partner configured — sealed once, never called submitted
//   (b) the refusals: draft invoice, unconfirmed POD, advance
//       before submission, another driver's invoice
//   (c) with a partner configured (a local test double answering
//       the seam's POST), the submit lands "submitted" with the
//       partner's ref; a partner failure leaves it packaged
//   (d) advance → settlement closes the invoice as paid, records
//       the covering payment, and seals every transition
//   (e) the package sheet resolves through the Library doors,
//       owner scope only
//   (f) accounts receivable rolls the driver's own invoices up
//       by age / factored / paid
//   (g) broker credit derives from the sealed chain onto BOTH
//       board shapes — averages at 3+ paid loads, facts-only
//       below that, "no payment history" for a fresh broker —
//       and the payloads never carry an invoice amount
//
// Pure-rule coverage lives in factoring.test.ts /
// brokerCredit.test.ts. Hermetic: STONEMILES_DB /
// STONEMILES_BLOBS point into a temp dir before host/ctx is
// imported (both bind at module load).

import { afterAll, describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-factoring-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.FACTOR_PARTNER_API_KEY;
delete process.env.FACTOR_PARTNER_BASE_URL;

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

async function errOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const db = getDb();

// Chain helper — re-reads the live head on every call (the real
// actions append their own seals between these inserts), with an
// explicit createdAt so seals land when the test says they did.
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

async function chainCount(event: string, refId?: number): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event)).orderBy(asc(schema.chainLog.id));
  return refId == null ? rows.length : rows.filter((r) => r.refId === refId).length;
}

async function seedLoad(u: SeededUser, values: Record<string, unknown>): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({ profileId: u.profileId, weightLbs: 40000, status: "Delivered", ...values })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

async function seedPodPaperwork(loadId: number, username: string, confirmed: boolean) {
  await db.insert(schema.loadPaperwork).values({
    loadId,
    docKind: "pod",
    driverUsername: username,
    blobKey: `pod-${loadId}.bin`,
    mime: "image/jpeg",
    sha256: "0".repeat(64),
    filedBy: username,
    confirmStatus: confirmed ? "confirmed" : "unconfirmed",
    confirmedFieldsJson: confirmed ? JSON.stringify({ lane: null, reference: null, weightLbs: null, pieces: null, deliveryText: null }) : null,
    confirmedBy: confirmed ? username : null,
    confirmedAt: confirmed ? new Date("2026-11-10T15:00:00Z") : null,
  });
}

/** A sealed load with (optionally) confirmed POD paperwork and a
 *  cut + issued invoice on it. Returns { loadId, invoiceId }. */
async function sealedInvoicedLoad(
  u: SeededUser,
  ctx: CtxT,
  rate: number,
  pod: "confirmed" | "unconfirmed" | "none",
): Promise<{ loadId: number; invoiceId: number }> {
  const loadId = await seedLoad(u, { shipper: "Factor Freight", rate, brokerCompany: "Blue Ridge Logistics" });
  await addChain("load", loadId, "pod_seal", { autoSealed: false }, "2026-11-10T15:00:00Z");
  if (pod !== "none") await seedPodPaperwork(loadId, u.username, pod === "confirmed");
  const made = await Actions.createInvoice.handler(ctx, { loadId, dueDays: 30, notes: null });
  await Actions.issueInvoice.handler(ctx, { id: made.id });
  return { loadId, invoiceId: made.id };
}

const alice = await seedUser("facalice", "Alice A");
const bob = await seedUser("facbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

// (a)/(b) fixtures — distinct rates so AR totals are exact.
const l1 = await sealedInvoicedLoad(alice, aliceCtx, 2400, "confirmed"); // packaged (no partner)
const l2 = await sealedInvoicedLoad(alice, aliceCtx, 1000, "unconfirmed"); // refused: POD unconfirmed
const l3load = await seedLoad(alice, { shipper: "Draft Co", rate: 700, brokerCompany: "Blue Ridge Logistics" });
await addChain("load", l3load, "pod_seal", { autoSealed: false }, "2026-11-10T15:00:00Z");
await seedPodPaperwork(l3load, alice.username, true);
const l3inv = await Actions.createInvoice.handler(aliceCtx, { loadId: l3load, dueDays: 30, notes: null }); // stays a draft

describe("factoring — packaging with no partner connected", () => {
  test("the state reads eligible + partner not connected before packaging", async () => {
    const f = await Actions.getInvoiceFactoring.handler(aliceCtx, { id: l1.invoiceId });
    expect(f.status).toBe("none");
    expect(f.eligible).toBe(true);
    expect(f.partnerConnected).toBe(false);
    expect(f.checks.every((c) => c.ok)).toBe(true);
  });

  test("submit assembles the package and stops honestly at packaged", async () => {
    const out = await Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l1.invoiceId });
    expect(out.factorStatus).toBe("packaged");
    expect(out.partnerConnected).toBe(false);
    expect(out.message).toContain("No factoring partner is connected yet");
    const f = await Actions.getInvoiceFactoring.handler(aliceCtx, { id: l1.invoiceId });
    expect(f.status).toBe("packaged");
    expect(f.statusLabel).toContain("Packaged");
    expect(f.packageInvoiceRef).toBe(`invoice:${l1.invoiceId}`);
    expect(f.packagePodRef).toBe(`pod:${l1.loadId}`);
    expect(f.submittedAt).toBeNull();
    expect(await chainCount("invoice_factor_packaged", l1.loadId)).toBe(1);
    expect(await chainCount("invoice_factor_submitted", l1.loadId)).toBe(0);
  });

  test("re-submitting a packaged invoice seals nothing twice", async () => {
    const out = await Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l1.invoiceId });
    expect(out.factorStatus).toBe("packaged");
    expect(await chainCount("invoice_factor_packaged", l1.loadId)).toBe(1);
  });

  test("an advance can't be recorded before a submission exists", async () => {
    const err = await errOf(Actions.recordFactorAdvance.handler(aliceCtx, { id: l1.invoiceId }));
    expect(err).toContain("isn't with a factor yet");
  });

  test("the package sheet resolves through the Library doors", async () => {
    const doc = await Actions.getLibraryDocument.handler(aliceCtx, { ref: `factor-package:${l1.invoiceId}` });
    expect(doc.ok).toBe(true);
    expect(doc.filename).toContain("factoring-package");
    const other = await Actions.getLibraryDocument.handler(bobCtx, { ref: `factor-package:${l1.invoiceId}` });
    expect(other.ok).toBe(false);
  });
});

describe("factoring — the refusals", () => {
  test("unconfirmed POD paperwork is refused — a factor buys confirmed paperwork", async () => {
    const err = await errOf(Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l2.invoiceId }));
    expect(err).toContain("isn't confirmed yet");
    const f = await Actions.getInvoiceFactoring.handler(aliceCtx, { id: l2.invoiceId });
    expect(f.status).toBe("none");
    expect(f.eligible).toBe(false);
    expect(f.checks.find((c) => c.key === "pod_confirmed")!.ok).toBe(false);
  });

  test("a draft invoice is refused — issue it first", async () => {
    const err = await errOf(Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l3inv.id }));
    expect(err).toContain("still a draft");
  });

  test("another driver can't reach the invoice at all", async () => {
    const err = await errOf(Actions.submitInvoiceForFactoring.handler(bobCtx, { id: l1.invoiceId }));
    expect(err).toContain("no such invoice");
    const err2 = await errOf(Actions.getInvoiceFactoring.handler(bobCtx, { id: l1.invoiceId }));
    expect(err2).toContain("no such invoice");
  });
});

// (c)/(d) — the configured lane, against a local partner double.
let partnerMode: "ok" | "fail" = "ok";
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method === "POST" && new URL(req.url).pathname === "/submissions") {
      if (partnerMode === "fail") return new Response("down", { status: 503 });
      const body = (await req.json()) as { invoiceNumber?: string };
      return Response.json({ id: `SUB-${body.invoiceNumber ?? "X"}` });
    }
    return new Response("nope", { status: 404 });
  },
});
const partnerBase = `http://127.0.0.1:${server.port}`;

const l4 = await sealedInvoicedLoad(alice, aliceCtx, 3000, "confirmed"); // full ladder → settled
const l5 = await sealedInvoicedLoad(alice, aliceCtx, 1200, "confirmed"); // partner failure → stays packaged

describe("factoring — the configured lane", () => {
  test("submit lands submitted with the partner's ref, sealed", async () => {
    process.env.FACTOR_PARTNER_API_KEY = "test-key";
    process.env.FACTOR_PARTNER_BASE_URL = partnerBase;
    process.env.FACTOR_PARTNER_NAME = "Test Factor";
    try {
      const out = await Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l4.invoiceId });
      expect(out.factorStatus).toBe("submitted");
      expect(out.partnerConnected).toBe(true);
      const f = await Actions.getInvoiceFactoring.handler(aliceCtx, { id: l4.invoiceId });
      expect(f.status).toBe("submitted");
      expect(f.partnerName).toBe("Test Factor");
      expect(f.partnerRef).toContain("SUB-INV-");
      expect(f.submittedAt).not.toBeNull();
      expect(await chainCount("invoice_factor_submitted", l4.loadId)).toBe(1);
    } finally {
      delete process.env.FACTOR_PARTNER_API_KEY;
      delete process.env.FACTOR_PARTNER_BASE_URL;
      delete process.env.FACTOR_PARTNER_NAME;
    }
  });

  test("a partner failure leaves the package packaged — nothing fake-submitted", async () => {
    partnerMode = "fail";
    process.env.FACTOR_PARTNER_API_KEY = "test-key";
    process.env.FACTOR_PARTNER_BASE_URL = partnerBase;
    try {
      const err = await errOf(Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l5.invoiceId }));
      expect(err).toContain("didn't accept it");
      const f = await Actions.getInvoiceFactoring.handler(aliceCtx, { id: l5.invoiceId });
      expect(f.status).toBe("packaged");
      expect(await chainCount("invoice_factor_submitted", l5.loadId)).toBe(0);
    } finally {
      partnerMode = "ok";
      delete process.env.FACTOR_PARTNER_API_KEY;
      delete process.env.FACTOR_PARTNER_BASE_URL;
    }
  });

  test("advance, then settlement closes the invoice as paid and clears the board", async () => {
    const adv = await Actions.recordFactorAdvance.handler(aliceCtx, { id: l4.invoiceId });
    expect(adv.ok).toBe(true);
    const mid = await Actions.getInvoiceFactoring.handler(aliceCtx, { id: l4.invoiceId });
    expect(mid.status).toBe("advanced");
    const settled = await Actions.recordFactorSettlement.handler(aliceCtx, { id: l4.invoiceId });
    expect(settled.ok).toBe(true);
    expect(settled.recordedPayment).toBe(3000);
    const inv = await Actions.getInvoice.handler(aliceCtx, { id: l4.invoiceId });
    expect(inv.status).toBe("paid");
    expect(inv.factoring.status).toBe("settled");
    expect(await chainCount("invoice_factor_advanced", l4.loadId)).toBe(1);
    expect(await chainCount("invoice_factor_settled", l4.loadId)).toBe(1);
    expect(await chainCount("invoice_paid", l4.loadId)).toBe(1);
    expect(await chainCount("load_payment", l4.loadId)).toBe(1);
    const owed = await Actions.getOwedBoard.handler(aliceCtx, {});
    expect(owed.rows.some((r) => r.loadId === l4.loadId)).toBe(false);
    // The lane is closed now.
    const err = await errOf(Actions.submitInvoiceForFactoring.handler(aliceCtx, { id: l4.invoiceId }));
    expect(err).toContain("already settled");
  });
});

describe("accounts receivable — the driver's own rollup", () => {
  test("buckets, factored split, and paid totals come from the invoice rows", async () => {
    const ar = await Actions.getAccountsReceivable.handler(aliceCtx, {});
    // Alice: L1 2400 packaged+issued, L2 1000 issued, L3 700 draft,
    // L4 3000 paid via factoring, L5 1200 packaged+issued.
    expect(ar.draftCount).toBe(1);
    expect(ar.paidCount).toBe(1);
    expect(ar.paidTotal).toBe(3000);
    expect(ar.settledFactoredCount).toBe(1);
    expect(ar.factoredCount).toBe(0);
    expect(ar.packagedCount).toBe(2);
    expect(ar.outstandingCount).toBe(3);
    expect(ar.outstandingTotal).toBe(4600);
    const current = ar.buckets.find((b) => b.key === "current")!;
    expect(current.count).toBe(3); // all issued now, due in 30 days
    expect(current.total).toBe(4600);
  });

  test("bob's book is empty — no bleed across drivers", async () => {
    const ar = await Actions.getAccountsReceivable.handler(bobCtx, {});
    expect(ar.outstandingCount).toBe(0);
    expect(ar.paidTotal).toBe(0);
  });
});

// (g) — broker credit from the chain, onto both board shapes.
const olivia = await seedUser("facolivia", "Olivia O");
const oliviaCtx = ctxFor(olivia);
const solo = await seedUser("facsolo", "Solo S");
const soloCtx = ctxFor(solo);

const fleet = await db
  .insert(schema.companies)
  .values({ name: "Olivia Fleet LLC", ownerUsername: olivia.username })
  .returning({ id: schema.companies.id });
const fleetId = fleet[0]!.id;
await db.insert(schema.companyMembers).values({ companyId: fleetId, username: olivia.username, role: "owner" });

async function seedBroker(name: string, email: string): Promise<number> {
  const rows = await db
    .insert(schema.brokerAccounts)
    .values({ name, email, ownerUsername: olivia.username, brokerMc: "MC-1" })
    .returning({ id: schema.brokerAccounts.id });
  return rows[0]!.id;
}

async function seedPoster(brokerId: number): Promise<number> {
  const rows = await db
    .insert(schema.brokerPosterLoads)
    .values({ brokerId, createdBy: olivia.username, status: "released", rate: 4321 })
    .returning({ id: schema.brokerPosterLoads.id });
  return rows[0]!.id;
}

async function seedBoardRow(args: {
  companyId: number;
  scope: string;
  posterId: number;
  driverLoadId: number | null;
}): Promise<number> {
  const rows = await db
    .insert(schema.boardLoads)
    .values({
      companyId: args.companyId,
      postedBy: olivia.username,
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      rate: 4321,
      status: args.driverLoadId != null ? "taken" : "open",
      boardScope: args.scope,
      brokerPosterLoadId: args.posterId,
      loadId: args.driverLoadId,
    })
    .returning({ id: schema.boardLoads.id });
  const boardId = rows[0]!.id;
  await db.update(schema.brokerPosterLoads).set({ boardLoadId: boardId }).where(eq(schema.brokerPosterLoads.id, args.posterId));
  return boardId;
}

/** One carried load for a broker: driver load + pod seal + the
 *  invoice chain events (amount 7777 rides the payloads — the
 *  board payloads must never show it). */
async function seedCarriedLoad(owner: SeededUser, daysToPay: number | null): Promise<number> {
  const loadId = await seedLoad(owner, { shipper: "Credit Freight", rate: 7777 });
  await addChain("load", loadId, "pod_seal", { autoSealed: false }, "2026-10-02T15:00:00Z");
  await addChain("load", loadId, "invoice_issued", { invoiceId: 1, number: "INV-X", loadId, amount: 7777, issuedAt: "2026-10-03T00:00:00.000Z", dueAt: "2026-11-02T00:00:00.000Z" }, "2026-10-03T00:00:00Z");
  if (daysToPay != null) {
    const paidAt = new Date(Date.parse("2026-10-03T00:00:00.000Z") + daysToPay * 86_400_000).toISOString();
    await addChain("load", loadId, "invoice_paid", { invoiceId: 1, number: "INV-X", loadId, amount: 7777, paidAt, recordedPayment: 7777 }, "2026-10-03T00:00:00Z");
  }
  return loadId;
}

const brokerA = await seedBroker("Apex Freight", "apex@test.local");
const brokerB = await seedBroker("Beacon Brokerage", "beacon@test.local");
const brokerC = await seedBroker("Cinder New Co", "cinder@test.local");

// Broker A: three carried + paid (10 / 20 / 30 days) → a score.
const aBoardIds: number[] = [];
for (const days of [10, 20, 30]) {
  const poster = await seedPoster(brokerA);
  const driverLoad = await seedCarriedLoad(alice, days);
  aBoardIds.push(await seedBoardRow({ companyId: fleetId, scope: "fleet", posterId: poster, driverLoadId: driverLoad }));
}
// Broker B: one carried + paid (the history) plus a fresh OPEN
// offer — the credit aggregates across all of the broker's
// loads, so the open row carries the record. On the OPEN board.
const bPoster = await seedPoster(brokerB);
const bDriverLoad = await seedCarriedLoad(alice, 12);
await seedBoardRow({ companyId: fleetId, scope: "open", posterId: bPoster, driverLoadId: bDriverLoad });
const bOpenPoster = await seedPoster(brokerB);
const bBoardId = await seedBoardRow({ companyId: fleetId, scope: "open", posterId: bOpenPoster, driverLoadId: null });
// Broker C: a live open post, never carried → no payment history.
const cPoster = await seedPoster(brokerC);
const cBoardId = await seedBoardRow({ companyId: fleetId, scope: "open", posterId: cPoster, driverLoadId: null });

describe("broker credit — derived from the chain onto both boards", () => {
  test("fleet board: 3+ paid loads earn the average, sample printed", async () => {
    const board = await Actions.getLoadBoard.handler(oliviaCtx, {});
    const row = board.board.find((r) => aBoardIds.includes(r.id))!;
    expect(row).toBeDefined();
    expect(row.brokerCredit).not.toBeNull();
    expect(row.brokerCredit!.paidLoads).toBe(3);
    expect(row.brokerCredit!.loadsCarried).toBe(3);
    expect(row.brokerCredit!.avgDaysToPay).toBe(20);
    expect(row.brokerCredit!.hasScore).toBe(true);
    expect(row.brokerCredit!.label).toBe("Pays in about 20 days on average · 3 paid loads on record");
    expect(JSON.stringify(board)).not.toContain("7777");
  });

  test("open board: below the sample, facts print without a score", async () => {
    const board = await Actions.getOpenBoard.handler(soloCtx, {});
    const rowB = board.board.find((r) => r.id === bBoardId)!;
    expect(rowB).toBeDefined();
    expect(rowB.brokerCredit).not.toBeNull();
    expect(rowB.brokerCredit!.paidLoads).toBe(1);
    expect(rowB.brokerCredit!.hasScore).toBe(false);
    expect(rowB.brokerCredit!.label).toBe("1 paid load on record");
    expect(JSON.stringify(board)).not.toContain("7777");
  });

  test("open board: a broker with no carried loads reads as no history", async () => {
    const board = await Actions.getOpenBoard.handler(soloCtx, {});
    const rowC = board.board.find((r) => r.id === cBoardId)!;
    expect(rowC).toBeDefined();
    expect(rowC.brokerCredit).not.toBeNull();
    expect(rowC.brokerCredit!.label).toBe("No payment history in STONEMILES yet");
    expect(rowC.brokerCredit!.loadsCarried).toBe(0);
  });
});

afterAll(() => {
  server.stop(true);
});
