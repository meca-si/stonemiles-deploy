// accountingFlow.test.ts — INTEGRATION tests for QuickBooks /
// Xero two-way sync (Wave 2 item 10, Part A), run against the
// REAL action handlers over a throwaway migrated SQLite
// database, with a local in-memory QuickBooks double answering
// the seam's HTTP calls (installed as globalThis.fetch — the
// seam's production transport is fetch):
//
//   (a) unconfigured: the connect attempt says "Accounting sync
//       isn't connected yet" and nothing pretends to sync
//   (b) connect: OAuth start → wrong state refused → completion
//       stores tokens server-side; NO action response and NO
//       chain payload ever contains a token (leak scan)
//   (c) first sync pushes the issued invoice + the settlement
//       (as a bill) exactly once; the run seals counts only
//   (d) a re-run is idempotent: zero new provider objects
//   (e) a local change pushes an UPDATE to the same object
//   (f) both-sides-changed → conflict with both versions in the
//       review list; another driver can't resolve it; winner
//       local restores the provider copy; a provider-only drift
//       conflicts again and winner provider adopts its figures
//   (g) an inbound provider payment matched by invoice id marks
//       the invoice paid through the sealed load_payment +
//       invoice_paid path — and never twice
//   (h) an unmatched inbound payment parks in review; dismiss
//       resolves one, linking resolves another onto its invoice
//   (i) isolation: a second driver sees no connection, no rows
//
// Pure-rule coverage lives in accounting.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-accounting-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.QUICKBOOKS_CLIENT_ID;
delete process.env.QUICKBOOKS_CLIENT_SECRET;
delete process.env.XERO_CLIENT_ID;
delete process.env.XERO_CLIENT_SECRET;

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

async function chainCount(event: string): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event)).orderBy(asc(schema.chainLog.id));
  return rows.length;
}

async function seedIssuedInvoice(u: SeededUser, ctx: CtxT, rate: number): Promise<{ loadId: number; invoiceId: number }> {
  const rows = await db
    .insert(schema.loads)
    .values({ profileId: u.profileId, weightLbs: 40000, status: "Delivered", shipper: "Acct Freight", rate, brokerCompany: "Blue Ridge Logistics" })
    .returning({ id: schema.loads.id });
  const loadId = rows[0]!.id;
  await addChain("load", loadId, "pod_seal", { autoSealed: false }, "2026-11-10T15:00:00Z");
  const made = await Actions.createInvoice.handler(ctx, { loadId, dueDays: 30, notes: null });
  await Actions.issueInvoice.handler(ctx, { id: made.id });
  return { loadId, invoiceId: made.id };
}

// ---------------------------------------------------------------------------
// The QuickBooks double — in-memory books behind fetch.
// ---------------------------------------------------------------------------

const ACCESS_TOKEN = "qb-access-SECRET-123";
const REFRESH_TOKEN = "qb-refresh-SECRET-456";

interface QbRow {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  CustomerRef?: { value: string; name?: string };
  VendorRef?: { value: string; name?: string };
  TxnDate?: string;
  DueDate?: string;
  PrivateNote?: string;
  Line?: {
    Amount: number;
    Description?: string;
    DetailType?: string;
    LinkedTxn?: { TxnId: string; TxnType: string }[];
  }[];
  TotalAmt?: number;
  Balance?: number;
  MetaData: { CreateTime?: string; LastUpdatedTime: string };
}

const qb = {
  customers: new Map<string, { Id: string; DisplayName: string }>(),
  invoices: new Map<string, QbRow>(),
  bills: new Map<string, QbRow>(),
  payments: [] as QbRow[],
  creates: { customer: 0, invoice: 0, bill: 0, payment: 0 },
  updates: { invoice: 0, bill: 0 },
  nextId: 5000,
  tick: 0,
};

function tickIso(): string {
  qb.tick += 1;
  return new Date(Date.now() + qb.tick * 60000).toISOString();
}

function qbJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function qbFetch(input: string, init?: { method?: string; body?: string }): Promise<Response> {
  const url = new URL(input);
  const method = init?.method ?? "GET";
  // The token exchange posts a form body; everything else is JSON.
  let body: Record<string, unknown> = {};
  if (init?.body) {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const p = url.pathname;

  if (p.endsWith("/oauth2/v1/tokens/bearer")) {
    return qbJson({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600 });
  }
  if (p.endsWith("/companyinfo/777")) {
    return qbJson({ CompanyInfo: { CompanyName: "Alice Trucking LLC" } });
  }
  if (p.endsWith("/query")) {
    const q = url.searchParams.get("query") ?? "";
    if (q.includes("from Customer")) {
      const name = q.match(/DisplayName = '([^']*)'/)?.[1] ?? "";
      const hit = [...qb.customers.values()].filter((c) => c.DisplayName === name);
      return qbJson({ QueryResponse: { Customer: hit } });
    }
    if (q.includes("from Payment")) {
      return qbJson({ QueryResponse: { Payment: qb.payments } });
    }
    return qbJson({ QueryResponse: {} });
  }
  if (method === "POST" && p.endsWith("/customer")) {
    const id = String(qb.nextId++);
    qb.customers.set(id, { Id: id, DisplayName: String(body.DisplayName ?? "") });
    qb.creates.customer++;
    return qbJson({ Customer: { Id: id, DisplayName: body.DisplayName } });
  }
  const invMatch = p.match(/\/invoice\/(\d+)$/);
  if (method === "GET" && invMatch) {
    const row = qb.invoices.get(invMatch[1]!);
    return row ? qbJson(row) : qbJson({}, 404);
  }
  if (method === "POST" && p.endsWith("/invoice")) {
    const lines = (body.Line as QbRow["Line"]) ?? [];
    const total = lines.reduce((s, l) => s + (l.Amount ?? 0), 0);
    if (body.Id) {
      const row = qb.invoices.get(String(body.Id))!;
      row.SyncToken = String(Number(row.SyncToken) + 1);
      row.DocNumber = String(body.DocNumber ?? row.DocNumber);
      row.TxnDate = body.TxnDate as string;
      row.DueDate = body.DueDate as string;
      row.PrivateNote = body.PrivateNote as string;
      row.Line = lines;
      row.TotalAmt = total;
      row.Balance = total;
      row.MetaData.LastUpdatedTime = tickIso();
      qb.updates.invoice++;
      return qbJson({ Invoice: row });
    }
    const id = String(qb.nextId++);
    const custId = (body.CustomerRef as { value: string }).value;
    const row: QbRow = {
      Id: id,
      SyncToken: "0",
      DocNumber: String(body.DocNumber ?? ""),
      CustomerRef: { value: custId, name: qb.customers.get(custId)?.DisplayName },
      TxnDate: body.TxnDate as string,
      DueDate: body.DueDate as string,
      PrivateNote: body.PrivateNote as string,
      Line: lines,
      TotalAmt: total,
      Balance: total,
      MetaData: { LastUpdatedTime: tickIso() },
    };
    qb.invoices.set(id, row);
    qb.creates.invoice++;
    return qbJson({ Invoice: row });
  }
  const billMatch = p.match(/\/bill\/(\d+)$/);
  if (method === "GET" && billMatch) {
    const row = qb.bills.get(billMatch[1]!);
    return row ? qbJson(row) : qbJson({}, 404);
  }
  if (method === "POST" && p.endsWith("/bill")) {
    const lines = (body.Line as QbRow["Line"]) ?? [];
    const total = lines.reduce((s, l) => s + (l.Amount ?? 0), 0);
    if (body.Id) {
      const row = qb.bills.get(String(body.Id))!;
      row.SyncToken = String(Number(row.SyncToken) + 1);
      row.Line = lines;
      row.TotalAmt = total;
      row.MetaData.LastUpdatedTime = tickIso();
      qb.updates.bill++;
      return qbJson({ Bill: row });
    }
    const id = String(qb.nextId++);
    const vendor = (body.VendorRef as { value: string }).value;
    const row: QbRow = {
      Id: id,
      SyncToken: "0",
      DocNumber: String(body.DocNumber ?? ""),
      VendorRef: { value: vendor, name: vendor },
      PrivateNote: body.PrivateNote as string,
      Line: lines,
      TotalAmt: total,
      MetaData: { LastUpdatedTime: tickIso() },
    };
    qb.bills.set(id, row);
    qb.creates.bill++;
    return qbJson({ Bill: row });
  }
  if (method === "POST" && p.endsWith("/payment")) {
    const id = String(qb.nextId++);
    const row: QbRow = {
      Id: id,
      SyncToken: "0",
      TotalAmt: body.TotalAmt as number,
      TxnDate: body.TxnDate as string,
      PrivateNote: body.PrivateNote as string,
      Line: body.Line as QbRow["Line"],
      MetaData: { CreateTime: new Date().toISOString(), LastUpdatedTime: tickIso() },
    };
    qb.payments.push(row);
    qb.creates.payment++;
    return qbJson({ Payment: row });
  }
  return qbJson({ error: `unhandled ${method} ${p}` }, 404);
}

// The adapter reads LinkedTxn off Line entries; keep the double's
// payment rows shaped the way the real API returns them.
function qbPaymentRow(id: string, total: number, invoiceId: string | null): QbRow {
  return {
    Id: id,
    SyncToken: "0",
    TotalAmt: total,
    TxnDate: "2026-11-20",
    Line: [
      {
        Amount: total,
        LinkedTxn: invoiceId ? [{ TxnId: invoiceId, TxnType: "Invoice" }] : [],
      },
    ],
    MetaData: { CreateTime: new Date().toISOString(), LastUpdatedTime: tickIso() },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const alice = await seedUser("acctalice", "Alice A");
const bob = await seedUser("acctbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

const inv1 = await seedIssuedInvoice(alice, aliceCtx, 2400);
const inv2 = await seedIssuedInvoice(alice, aliceCtx, 1100);
await db.insert(schema.settlements).values({
  profileId: alice.profileId,
  carrier: "Blue Ridge Logistics",
  periodLabel: "Nov 3–9",
  gross: 2600,
  net: 2400,
  linesJson: JSON.stringify([{ label: "Linehaul", amount: 2400 }]),
});

async function syncRowFor(recordKind: string, recordId: number) {
  const rows = await db.select().from(schema.accountingSyncRecords);
  return rows.find((r) => r.recordKind === recordKind && r.recordId === recordId) ?? null;
}

describe("accounting — unconfigured is honest", () => {
  test("the connect attempt says it isn't connected yet; state shows unconfigured", async () => {
    const out = await Actions.startAccountingConnect.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.ok).toBe(false);
    expect(out.authorizeUrl).toBeNull();
    expect(out.note).toContain("Accounting sync isn't connected yet");
    const state = await Actions.getAccountingSync.handler(aliceCtx, {});
    expect(state.providers.every((p) => !p.configured && !p.connected)).toBe(true);
    expect(state.review).toEqual([]);
    const err = await errOf(Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" }));
    expect(err).toContain("Connect an accounting provider first");
  });
});

describe("accounting — connect, with tokens staying server-side", () => {
  test("OAuth start → wrong state refused → completion connects as the books' name", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "test-client-id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "test-client-secret";
    globalThis.fetch = qbFetch as unknown as typeof fetch;

    const start = await Actions.startAccountingConnect.handler(aliceCtx, { provider: "quickbooks" });
    expect(start.ok).toBe(true);
    expect(start.authorizeUrl).toContain("appcenter.intuit.com");
    expect(start.state).toBeTruthy();

    const err = await errOf(
      Actions.completeAccountingConnect.handler(aliceCtx, { provider: "quickbooks", code: "c1", state: "wrong-state", realmId: "777" }),
    );
    expect(err).toContain("expired");

    const done = await Actions.completeAccountingConnect.handler(aliceCtx, {
      provider: "quickbooks",
      code: "auth-code-1",
      state: start.state!,
      realmId: "777",
    });
    expect(done).toEqual({ ok: true, connectedAs: "Alice Trucking LLC" });

    const conns = await db.select().from(schema.accountingConnections);
    expect(conns).toHaveLength(1);
    expect(conns[0]!.status).toBe("connected");
    expect(conns[0]!.accessToken).toBe(ACCESS_TOKEN); // stored server-side…
    expect(await chainCount("accounting_connected")).toBe(1);
  });

  test("no action response and no chain payload ever contains a token", async () => {
    const state = await Actions.getAccountingSync.handler(aliceCtx, {});
    expect(state.providers[0]).toMatchObject({ kind: "quickbooks", configured: true, connected: true, connectedAs: "Alice Trucking LLC" });
    const surface = JSON.stringify(state);
    expect(surface).not.toContain(ACCESS_TOKEN);
    expect(surface).not.toContain(REFRESH_TOKEN);
    const chain = await db.select().from(schema.chainLog);
    const allPayloads = chain.map((c) => c.payload).join("\n");
    expect(allPayloads).not.toContain(ACCESS_TOKEN);
    expect(allPayloads).not.toContain(REFRESH_TOKEN);
  });
});

describe("accounting — outbound sync + idempotency", () => {
  test("the first run pushes each invoice once and the settlement once, sealing counts only", async () => {
    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.connected).toBe(true);
    expect(out.pushed).toBe(3); // two invoices + one settlement bill
    expect(out.pulled).toBe(0);
    expect(out.errors).toBe(0);
    expect(qb.creates.invoice).toBe(2);
    expect(qb.creates.bill).toBe(1);
    const row = await syncRowFor("invoice", inv1.invoiceId);
    expect(row?.state).toBe("synced");
    expect(row?.providerObjectId).toBeTruthy();
    expect(await chainCount("accounting_sync_run")).toBe(1);
    const runSeal = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "accounting_sync_run")))[0]!;
    expect(runSeal.payload).not.toContain("2400"); // counts only — no amounts in the seal
  });

  test("a re-run duplicates nothing: no new objects, no updates, everything unchanged", async () => {
    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.pushed).toBe(0);
    expect(out.pulled).toBe(0);
    expect(out.conflicts).toBe(0);
    expect(qb.creates.invoice).toBe(2);
    expect(qb.creates.bill).toBe(1);
    expect(qb.updates.invoice).toBe(0);
    expect(out.unchanged).toBeGreaterThanOrEqual(3);
  });

  test("a local change pushes an update to the SAME provider object", async () => {
    await db
      .update(schema.loadInvoices)
      .set({ dueAt: new Date("2027-01-15T00:00:00.000Z") })
      .where(eq(schema.loadInvoices.id, inv1.invoiceId));
    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.pushed).toBe(1);
    expect(qb.creates.invoice).toBe(2); // still no new object
    expect(qb.updates.invoice).toBe(1);
    const row = await syncRowFor("invoice", inv1.invoiceId);
    const qbRow = qb.invoices.get(row!.providerObjectId!)!;
    expect(qbRow.DueDate).toBe("2027-01-15");
  });
});

describe("accounting — conflicts", () => {
  test("both sides changed → conflict; a stranger can't resolve it; winner local restores the provider copy", async () => {
    const row = await syncRowFor("invoice", inv1.invoiceId);
    const qbRow = qb.invoices.get(row!.providerObjectId!)!;
    // Provider side changes…
    qbRow.TotalAmt = 9999;
    qbRow.Line = [{ Amount: 9999, Description: "Freight", DetailType: "SalesItemLineDetail" }];
    qbRow.SyncToken = String(Number(qbRow.SyncToken) + 1);
    qbRow.MetaData.LastUpdatedTime = tickIso();
    // …and the local side changes too (amount + lines together,
    // the way the invoice system itself always writes them).
    await db
      .update(schema.loadInvoices)
      .set({ amount: 2500, linesJson: JSON.stringify([{ label: "Freight", amount: 2500 }]) })
      .where(eq(schema.loadInvoices.id, inv1.invoiceId));

    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.conflicts).toBe(1);
    const conflicted = await syncRowFor("invoice", inv1.invoiceId);
    expect(conflicted?.state).toBe("conflict");

    const state = await Actions.getAccountingSync.handler(aliceCtx, {});
    const item = state.review.find((r) => r.recordKind === "invoice" && r.recordId === inv1.invoiceId);
    expect(item?.state).toBe("conflict");
    expect(item?.providerLines.find((l) => l.label === "Amount")?.value).toBe("$9999.00");
    expect(item?.localLines.find((l) => l.label === "Amount")?.value).toBe("$2500.00");

    const err = await errOf(
      Actions.resolveAccountingConflict.handler(bobCtx, { syncRecordId: conflicted!.id, winner: "local" }),
    );
    expect(err).toContain("isn't on your books");

    const resolved = await Actions.resolveAccountingConflict.handler(aliceCtx, {
      syncRecordId: conflicted!.id,
      winner: "local",
    });
    expect(resolved.ok).toBe(true);
    expect(qb.invoices.get(row!.providerObjectId!)!.TotalAmt).toBe(2500);
    expect((await syncRowFor("invoice", inv1.invoiceId))?.state).toBe("synced");
    expect(await chainCount("accounting_conflict_resolved")).toBe(1);
  });

  test("a provider-only drift conflicts again, and winner provider adopts its figures", async () => {
    const row = await syncRowFor("invoice", inv1.invoiceId);
    const qbRow = qb.invoices.get(row!.providerObjectId!)!;
    qbRow.TotalAmt = 8888;
    qbRow.Line = [{ Amount: 8888, Description: "Freight", DetailType: "SalesItemLineDetail" }];
    qbRow.SyncToken = String(Number(qbRow.SyncToken) + 1);
    qbRow.MetaData.LastUpdatedTime = tickIso();

    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.conflicts).toBe(1);
    const conflicted = await syncRowFor("invoice", inv1.invoiceId);
    const resolved = await Actions.resolveAccountingConflict.handler(aliceCtx, {
      syncRecordId: conflicted!.id,
      winner: "provider",
    });
    expect(resolved.ok).toBe(true);
    const inv = (await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.id, inv1.invoiceId)))[0]!;
    expect(inv.amount).toBe(8888);
    expect((await syncRowFor("invoice", inv1.invoiceId))?.state).toBe("synced");
  });
});

describe("accounting — inbound payments", () => {
  test("a provider payment matched by invoice id marks the invoice paid through the sealed path — once", async () => {
    const row = await syncRowFor("invoice", inv1.invoiceId);
    qb.payments.push(qbPaymentRow("9100", 2400, row!.providerObjectId!));
    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.pulled).toBe(1);
    const inv = (await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.id, inv1.invoiceId)))[0]!;
    expect(inv.status).toBe("paid");
    expect(await chainCount("load_payment")).toBeGreaterThanOrEqual(1);
    expect(await chainCount("invoice_paid")).toBeGreaterThanOrEqual(1);
    const payRow = (await db.select().from(schema.accountingSyncRecords)).find(
      (r) => r.recordKind === "provider_payment" && r.providerObjectId === "9100",
    );
    expect(payRow?.state).toBe("resolved");

    const again = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(again.pulled).toBe(0); // never applied twice
  });

  test("an unmatched payment parks in review — dismiss resolves one, linking pays another", async () => {
    qb.payments.push(qbPaymentRow("9101", 500, "no-such-invoice"));
    qb.payments.push(qbPaymentRow("9102", 1100, null));
    const out = await Actions.runAccountingSync.handler(aliceCtx, { provider: "quickbooks" });
    expect(out.review).toBe(2);
    const state = await Actions.getAccountingSync.handler(aliceCtx, {});
    const items = state.review.filter((r) => r.state === "review");
    expect(items).toHaveLength(2);

    const dismissed = await Actions.resolveAccountingReview.handler(aliceCtx, {
      syncRecordId: items[0]!.syncRecordId,
      dismiss: true,
    });
    expect(dismissed.ok).toBe(true);

    const linked = await Actions.resolveAccountingReview.handler(aliceCtx, {
      syncRecordId: items[1]!.syncRecordId,
      invoiceId: inv2.invoiceId,
    });
    expect(linked.ok).toBe(true);
    const inv = (await db.select().from(schema.loadInvoices).where(eq(schema.loadInvoices.id, inv2.invoiceId)))[0]!;
    expect(inv.status).toBe("paid");
    const rows = await db.select().from(schema.accountingSyncRecords);
    // The three payments this describe pushed around are all
    // resolved. (A fourth resolved row is legitimate: the
    // payment the outbound leg posted in the earlier run is seen
    // by this run's inbound pull, matches its invoice, and
    // resolves as already-paid.)
    for (const pid of ["9100", "9101", "9102"]) {
      const row = rows.find((r) => r.recordKind === "provider_payment" && r.providerObjectId === pid);
      expect(row?.state).toBe("resolved");
    }
  });
});

describe("accounting — isolation", () => {
  test("another driver sees no connection and cannot run or read alice's sync", async () => {
    const state = await Actions.getAccountingSync.handler(bobCtx, {});
    expect(state.providers.every((p) => !p.connected)).toBe(true);
    expect(state.review).toEqual([]);
    const err = await errOf(Actions.runAccountingSync.handler(bobCtx, { provider: "quickbooks" }));
    expect(err).toContain("Connect an accounting provider first");
    const err2 = await errOf(Actions.disconnectAccounting.handler(bobCtx, { provider: "xero" }));
    expect(err2).toBeNull(); // disconnecting nothing is a no-op, not a leak
  });
});
