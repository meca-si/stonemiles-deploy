// invoicingFlow.test.ts — INTEGRATION tests for invoicing + P&L
// (TMS queue item 3, migration 0126), run against the REAL action
// handlers over a throwaway migrated SQLite database:
//
//   (a) an invoice is cut from a SEALED load only — unsealed loads
//       and loads with no rate on file are refused, and the amount
//       is the sealed load's freight (rate + extras) plus its claim
//       events, snapshotted at creation
//   (b) numbering is per-driver sequential (INV-<year>-NNNN)
//   (c) the lifecycle: draft → issued (due date from terms) → paid;
//       overdue is derived from the due date; marking paid records
//       the covering payment and clears the who-owes-me board
//   (d) one invoice per load; only drafts delete, and deleting frees
//       the load to be invoiced again
//   (e) the business identity (Settings → Business profile) brands
//       the invoice; the invoice resolves as a Library PDF document
//   (f) P&L aggregates the caller's own sealed loads, claims,
//       expenses, fuel purchases, and maintenance log for a period,
//       with per-load lines and honest unfigured-load handling
//   (g) isolation: another driver cannot invoice, read, pay, or
//       delete against loads/invoices that aren't theirs, and their
//       P&L contains none of the first driver's numbers
//
// Pure-rule coverage lives in invoicing.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-invoicing-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { desc, eq } = await import("drizzle-orm");

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

// Chain helper — continues from the live head (sha256 of
// "prevHash|event|payload", genesis "GENESIS"), with an explicit
// createdAt so seals land in the period under test.
const headRows = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
let chainPrev = headRows[0]?.hash ?? "GENESIS";
async function addChain(refKind: string, refId: number | null, event: string, payload: Record<string, unknown>, atIso: string) {
  const payloadText = JSON.stringify(payload);
  const hash = createHash("sha256").update(`${chainPrev}|${event}|${payloadText}`).digest("hex");
  const rows = await db
    .insert(schema.chainLog)
    .values({ refKind, refId, sessionId: null, event, payload: payloadText, prevHash: chainPrev, hash, createdAt: new Date(atIso) })
    .returning({ id: schema.chainLog.id });
  chainPrev = hash;
  return rows[0]!.id;
}

async function seedLoad(u: SeededUser, values: Record<string, unknown>): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({ profileId: u.profileId, weightLbs: 40000, status: "Delivered", ...values })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

const alice = await seedUser("invalice", "Alice A");
const bob = await seedUser("invbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);
const anonCtx = createInvocation({
  executePrivileged: privStub as never,
  viewer: null,
}).ctx as unknown as CtxT;

// Alice A1 — sealed Nov 10 2026, rate 2400 + 150 extras, broker
// company on file, two claim events (TONU 250 + layover 350).
const a1 = await seedLoad(alice, {
  shipper: "Acme Steel",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
  commodity: "steel coils",
  rate: 2400,
  extraCharges: 150,
  extraChargesNote: "lumper",
  referenceNumber: "REF-A1",
  brokerName: "Sam Shipper",
  brokerCompany: "Blue Ridge Logistics",
});
await addChain("load", a1, "load_saved", { lane: "Mobile, AL → Dallas, TX" }, "2026-11-09T15:00:00Z");
await addChain("load", a1, "pod_seal", { autoSealed: false }, "2026-11-10T15:00:00Z");
await db.insert(schema.claimEvents).values([
  { profileId: alice.profileId, loadId: a1, kind: "tonu", amount: 250, occurredAt: new Date("2026-11-10T16:00:00Z") },
  { profileId: alice.profileId, loadId: a1, kind: "layover", amount: 350, occurredAt: new Date("2026-11-10T17:00:00Z") },
]);

// Alice A2 — sealed Nov 20 2026 with NO rate on file (P&L unfigured;
// invoicing must refuse it rather than invent an amount).
const a2 = await seedLoad(alice, {
  shipper: "Rate Pending Co",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Atlanta",
  deliveryState: "GA",
  rate: null,
});
await addChain("load", a2, "pod_seal", { autoSealed: false }, "2026-11-20T15:00:00Z");

// Alice A3 — never sealed.
const a3 = await seedLoad(alice, { shipper: "Not Delivered Co", rate: 900, status: "En route" });

// Alice A4 — sealed, plain rate, for the delete-draft flow.
const a4 = await seedLoad(alice, { shipper: "Drafty Co", rate: 700 });
await addChain("load", a4, "pod_seal", { autoSealed: false }, "2026-11-21T15:00:00Z");

// Bob B1 — sealed with a big rate; Alice must never reach it.
const b1 = await seedLoad(bob, { shipper: "Bob Freight", rate: 5000 });
await addChain("load", b1, "pod_seal", { autoSealed: false }, "2026-11-11T15:00:00Z");

// Alice's November costs: fuel purchase 500.50 (Nov 3), expenses
// fuel-cat 300 tagged A1 (Nov 5), tolls 120 untagged (Nov 6), food
// 80 tagged A1 (Nov 7); maintenance logged 200 (Nov 12) + a DRAFT
// entry at 999 that must NOT count.
await db.insert(schema.fuelPurchases).values({ profileId: alice.profileId, purchasedAt: new Date("2026-11-03T12:00:00Z"), state: "AL", gallons: 100, pricePerGallon: 5.005, total: 500.5 });
await db.insert(schema.expenses).values([
  { profileId: alice.profileId, spentAt: new Date("2026-11-05T12:00:00Z"), category: "fuel", amount: 300, loadId: a1 },
  { profileId: alice.profileId, spentAt: new Date("2026-11-06T12:00:00Z"), category: "tolls", amount: 120 },
  { profileId: alice.profileId, spentAt: new Date("2026-11-07T12:00:00Z"), category: "food", amount: 80, loadId: a1 },
]);
await db.insert(schema.maintenanceLogEntries).values([
  { profileId: alice.profileId, performedAt: new Date("2026-11-12T12:00:00Z"), category: "repair", description: "Brake pads", cost: 200, status: "logged" },
  { profileId: alice.profileId, performedAt: new Date("2026-11-12T13:00:00Z"), category: "repair", description: "DVIR draft guess", cost: 999, status: "draft" },
]);

const YEAR = new Date().getUTCFullYear();
let invoiceA1 = 0;

describe("invoicing — cutting the invoice", () => {
  test("an unsealed load cannot be invoiced", async () => {
    const err = await errOf(Actions.createInvoice.handler(aliceCtx, { loadId: a3, dueDays: 30, notes: null }));
    expect(err).toContain("sealed");
  });

  test("a sealed load with no rate on file is refused — never an invented amount", async () => {
    const err = await errOf(Actions.createInvoice.handler(aliceCtx, { loadId: a2, dueDays: 30, notes: null }));
    expect(err).toContain("no rate on file");
  });

  test("the invoice snapshots freight + claims from the sealed load", async () => {
    const made = await Actions.createInvoice.handler(aliceCtx, { loadId: a1, dueDays: 30, notes: null });
    invoiceA1 = made.id;
    expect(made.number).toBe(`INV-${YEAR}-0001`);
    const inv = await Actions.getInvoice.handler(aliceCtx, { id: made.id });
    expect(inv.amount).toBe(3150); // 2400 rate + 150 extras + 250 TONU + 350 layover
    expect(inv.lines).toEqual([
      { label: "Freight", amount: 2400 },
      { label: "Additional charges — lumper", amount: 150 },
      { label: "TONU (truck ordered, not used)", amount: 250 },
      { label: "Layover", amount: 350 },
    ]);
    expect(inv.billToName).toBe("Blue Ridge Logistics");
    expect(inv.status).toBe("draft");
    expect(inv.displayStatus).toBe("draft");
    expect(inv.deliveredAt.slice(0, 10)).toBe("2026-11-10");
  });

  test("one invoice per load — a second cut is refused", async () => {
    const err = await errOf(Actions.createInvoice.handler(aliceCtx, { loadId: a1, dueDays: 30, notes: null }));
    expect(err).toContain("already has invoice");
  });

  test("editing the load afterwards never rewrites the cut bill", async () => {
    await db.update(schema.loads).set({ rate: 9999 }).where(eq(schema.loads.id, a1));
    const inv = await Actions.getInvoice.handler(aliceCtx, { id: invoiceA1 });
    await db.update(schema.loads).set({ rate: 2400 }).where(eq(schema.loads.id, a1));
    expect(inv.amount).toBe(3150);
  });
});

describe("invoicing — lifecycle", () => {
  test("issue stamps the due date from the terms; overdue is derived", async () => {
    const issued = await Actions.issueInvoice.handler(aliceCtx, { id: invoiceA1 });
    expect(issued.ok).toBe(true);
    const inv = await Actions.getInvoice.handler(aliceCtx, { id: invoiceA1 });
    expect(inv.status).toBe("issued");
    expect(inv.displayStatus).toBe("issued");
    expect(inv.issuedAt).not.toBeNull();
    expect(inv.dueAt!.slice(0, 10)).toBe(new Date(Date.parse(inv.issuedAt!) + 30 * 86400000).toISOString().slice(0, 10));
    // Push the due date into the past: the display status flips to
    // overdue without any stored flag changing.
    await db.update(schema.loadInvoices).set({ dueAt: new Date(Date.now() - 86400000) }).where(eq(schema.loadInvoices.id, invoiceA1));
    const list = await Actions.listInvoices.handler(aliceCtx, {});
    expect(list.invoices.find((i) => i.id === invoiceA1)!.displayStatus).toBe("overdue");
    const again = await errOf(Actions.issueInvoice.handler(aliceCtx, { id: invoiceA1 }));
    expect(again).toContain("already issued");
  });

  test("marking paid records the covering payment and clears the owed board", async () => {
    const before = await Actions.getOwedBoard.handler(aliceCtx, {});
    expect(before.rows.some((r) => r.loadId === a1)).toBe(true);
    const paid = await Actions.markInvoicePaid.handler(aliceCtx, { id: invoiceA1, paidAt: null, note: null });
    expect(paid.recordedPayment).toBe(3150);
    const inv = await Actions.getInvoice.handler(aliceCtx, { id: invoiceA1 });
    expect(inv.status).toBe("paid");
    expect(inv.displayStatus).toBe("paid");
    const after = await Actions.getOwedBoard.handler(aliceCtx, {});
    expect(after.rows.some((r) => r.loadId === a1)).toBe(false);
    const pays = await db.select().from(schema.loadPayments).where(eq(schema.loadPayments.loadId, a1));
    expect(pays.length).toBe(1);
    expect(pays[0]!.amount).toBe(3150);
    expect(pays[0]!.chainHash).not.toBeNull();
  });

  test("a paid invoice cannot be deleted or re-paid", async () => {
    expect(await errOf(Actions.deleteInvoice.handler(aliceCtx, { id: invoiceA1 }))).toContain("only a draft");
    expect(await errOf(Actions.markInvoicePaid.handler(aliceCtx, { id: invoiceA1, paidAt: null, note: null }))).toContain("already marked paid");
  });

  test("deleting a draft frees the load; numbering keeps climbing", async () => {
    const made = await Actions.createInvoice.handler(aliceCtx, { loadId: a4, dueDays: 14, notes: null });
    expect(made.number).toBe(`INV-${YEAR}-0002`);
    const del = await Actions.deleteInvoice.handler(aliceCtx, { id: made.id });
    expect(del.ok).toBe(true);
    const remade = await Actions.createInvoice.handler(aliceCtx, { loadId: a4, dueDays: 14, notes: null });
    expect(remade.number).toBe(`INV-${YEAR}-0003`);
  });
});

describe("invoicing — business identity + Library document", () => {
  test("the business profile brands the invoice", async () => {
    const saved = await Actions.saveBusinessProfile.handler(aliceCtx, {
      name: "Alice Trucking LLC",
      address: "1 Dock Way\nMobile, AL",
      phone: "251-555-0100",
      email: "billing@alicetrucking.test",
      paymentInstructions: "ACH to the account on file",
      logoDataBase64: null,
      logoMime: null,
      removeLogo: false,
    });
    expect(saved.ok).toBe(true);
    const inv = await Actions.getInvoice.handler(aliceCtx, { id: invoiceA1 });
    expect(inv.business.name).toBe("Alice Trucking LLC");
    expect(inv.business.paymentInstructions).toBe("ACH to the account on file");
    const biz = await Actions.getBusinessProfile.handler(aliceCtx, {});
    expect(biz.name).toBe("Alice Trucking LLC");
    expect(biz.hasLogo).toBe(false);
  });

  test("the invoice resolves as a Library PDF and lists as a statement", async () => {
    const doc = await Actions.getLibraryDocument.handler(aliceCtx, { ref: `invoice:${invoiceA1}` });
    expect(doc.ok).toBe(true);
    expect(doc.mime).toBe("application/pdf");
    const bytes = Buffer.from(doc.dataBase64 ?? "", "base64");
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const lib = await Actions.getLibrary.handler(aliceCtx, {});
    expect(lib.statements.some((s) => s.ref === `invoice:${invoiceA1}`)).toBe(true);
    expect(lib.statements.some((s) => s.ref === "pl:month:2026:11")).toBe(true);
  });
});

describe("the rate law — the rate lives on the invoice only", () => {
  test("the public receive page for an invoiced load carries no rate, no amount, no invoice", async () => {
    const link = await Actions.getLoadReceiveLink.handler(aliceCtx, { loadId: a1 });
    expect(link.ok).toBe(true);
    const info = await Actions.getReceiveInfo.handler(anonCtx, { token: link.token! });
    expect(info.valid).toBe(true);
    const wire = JSON.stringify(info);
    expect(wire).not.toContain('"rate"');
    expect(wire).not.toContain("2400"); // the load's rate
    expect(wire).not.toContain("2550"); // freight with extras
    expect(wire).not.toContain("3150"); // the invoice total
    expect(wire.toLowerCase()).not.toContain("invoice");
  });

  test("the public profile carries no business identity and no invoice data", async () => {
    const pub = await Actions.getUserProfile.handler(bobCtx, { username: alice.username });
    const wire = JSON.stringify(pub);
    expect(wire).not.toContain("Alice Trucking LLC");
    expect(wire).not.toContain("ACH to the account on file");
    expect(wire.toLowerCase()).not.toContain("invoice");
    expect(wire).not.toContain("3150");
  });
});

describe("P&L — aggregation over the caller's own records", () => {
  test("November 2026 rolls up income, costs, and per-load lines", async () => {
    const pl = await Actions.getProfitLoss.handler(aliceCtx, { kind: "month", year: 2026, index: 11 });
    expect(pl.period.label).toBe("November 2026");
    expect(pl.incomeFreight).toBe(3250); // A1 2550 + A4 700
    expect(pl.incomeClaims).toBe(600);
    expect(pl.incomeTotal).toBe(3850);
    expect(pl.unfiguredLoads).toBe(1); // A2 — sealed, no rate
    const byKey = new Map(pl.costLines.map((l) => [l.key, l.amount]));
    expect(byKey.get("fuel_purchases")).toBe(500.5);
    expect(byKey.get("expense:fuel")).toBe(300);
    expect(byKey.get("expense:tolls")).toBe(120);
    expect(byKey.get("expense:food")).toBe(80);
    expect(byKey.get("maintenance_log")).toBe(200); // the 999 draft entry is NOT a cost
    expect(pl.costsTotal).toBe(1200.5);
    expect(pl.net).toBe(2649.5);
    const a4Line = pl.perLoad.find((l) => l.loadId === a4)!;
    expect(a4Line.income).toBe(700);
    expect(a4Line.net).toBe(700);
    expect(pl.unassignedExpenses).toBe(120);
    const a1Line = pl.perLoad.find((l) => l.loadId === a1)!;
    expect(a1Line.income).toBe(3150);
    expect(a1Line.costs).toBe(380); // 300 fuel + 80 food tagged to A1
    expect(a1Line.net).toBe(2770);
    const a2Line = pl.perLoad.find((l) => l.loadId === a2)!;
    expect(a2Line.income).toBeNull();
    expect(a2Line.net).toBeNull();
  });

  test("the P&L statement resolves as a Library PDF", async () => {
    const doc = await Actions.getLibraryDocument.handler(aliceCtx, { ref: "pl:month:2026:11" });
    expect(doc.ok).toBe(true);
    expect(doc.mime).toBe("application/pdf");
    expect(Buffer.from(doc.dataBase64 ?? "", "base64").subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("invoicing + P&L — cross-driver isolation", () => {
  test("Bob cannot invoice, read, pay, or delete against Alice's records", async () => {
    expect(await errOf(Actions.createInvoice.handler(bobCtx, { loadId: a1, dueDays: 30, notes: null }))).not.toBeNull();
    expect(await errOf(Actions.getInvoice.handler(bobCtx, { id: invoiceA1 }))).not.toBeNull();
    const bobInvoice = await Actions.createInvoice.handler(bobCtx, { loadId: b1, dueDays: 30, notes: null });
    expect(await errOf(Actions.markInvoicePaid.handler(aliceCtx, { id: bobInvoice.id, paidAt: null, note: null }))).not.toBeNull();
    expect(await errOf(Actions.deleteInvoice.handler(aliceCtx, { id: bobInvoice.id }))).not.toBeNull();
    const bobList = await Actions.listInvoices.handler(bobCtx, {});
    expect(bobList.invoices.map((i) => i.id)).toEqual([bobInvoice.id]);
    // Numbering is per-driver: Bob's first invoice starts his own run.
    expect(bobInvoice.number).toBe(`INV-${YEAR}-0001`);
  });

  test("Bob's P&L contains none of Alice's numbers", async () => {
    const pl = await Actions.getProfitLoss.handler(bobCtx, { kind: "month", year: 2026, index: 11 });
    expect(pl.incomeTotal).toBe(5000);
    expect(pl.costsTotal).toBe(0);
    expect(pl.perLoad.length).toBe(1);
    expect(pl.perLoad[0]!.loadId).toBe(b1);
  });
});
