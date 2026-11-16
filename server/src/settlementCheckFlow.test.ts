// settlementCheckFlow.test.ts — INTEGRATION tests for the
// settlement cross-check (owner's build, 2026-11-15), run against
// the REAL action handlers over a throwaway migrated SQLite db:
//
//   (a) AUTOMATIC detail: a Pay Book entry's check runs itself on
//       the deterministic automatic window (pay date − the payer's
//       pay lag; default lag 0 = same week, arrears never assumed)
//       and flags a shortage plainly
//   (b) the second entry from the same payer chains from the first
//       one's window end — the first entry's loads never
//       double-count, and no day is skipped
//   (c) VERIFY + EDIT: stored per-entry overrides (window dates,
//       load hold-outs / pull-ins) change the check immediately,
//       are labelled as driver adjustments on its face, and clear
//       back to the raw automatic check
//   (d) BADGE path: listPayEntries carries the automatic verdict on
//       the caller's own entries
//   (e) IDOR (pinned): another driver's payEntryId returns NOTHING
//       (found:false, no figures), and their list carries no badge
//       on an entry that isn't theirs
//
// Pure-math coverage lives in settlementCheck.test.ts.
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-settlecheck-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { desc } = await import("drizzle-orm");

type CtxT = Ctx;

const privStub = async () => ({ ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null });

interface SeededUser {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
}

async function seedUser(
  username: string,
  chatName: string,
  pay: { payBasis: string; driverCpm: number | null; driverPayPct: number | null; companyName: string | null },
): Promise<SeededUser> {
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
      payBasis: pay.payBasis,
      driverCpm: pay.driverCpm,
      driverPayPct: pay.driverPayPct,
      companyName: pay.companyName,
    })
    .returning({ id: schema.profile.id });
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

// Chain helper with an explicit createdAt — podStatusByLoad reads
// the seal's time from the chain row, so the delivery date is the
// row's createdAt.
const headRows = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
let chainPrev = headRows[0]?.hash ?? "GENESIS";
const addChainAt = async (refId: number, event: string, atMs: number) => {
  const payloadText = JSON.stringify({ at: new Date(atMs).toISOString(), autoSealed: false });
  const hash = createHash("sha256").update(`${chainPrev}|${event}|${payloadText}`).digest("hex");
  const rows = await db
    .insert(schema.chainLog)
    .values({ refKind: "load", refId, sessionId: null, event, payload: payloadText, prevHash: chainPrev, hash, createdAt: new Date(atMs) })
    .returning({ id: schema.chainLog.id });
  chainPrev = hash;
  return rows[0]!.id;
};

async function seedLoad(
  owner: SeededUser,
  fields: { rate: number | null; extraCharges?: number; loadedMiles: number | null; shipper: string },
): Promise<number> {
  const rows = await db
    .insert(schema.loads)
    .values({
      profileId: owner.profileId,
      shipper: fields.shipper,
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      rate: fields.rate,
      extraCharges: fields.extraCharges ?? 0,
      loadedMiles: fields.loadedMiles,
      status: "booked",
    })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

async function seedPayEntry(
  owner: SeededUser,
  fields: { payer: string; paidAtMs: number; gross: number; otherDeductions?: number; deductionLines?: { label: string; amount: number }[] },
): Promise<number> {
  const rows = await db
    .insert(schema.payEntries)
    .values({
      username: owner.username,
      kind: "1099",
      isForm: false,
      payer: fields.payer,
      paidAt: new Date(fields.paidAtMs),
      gross: fields.gross,
      federalWithheld: 0,
      stateWithheld: 0,
      otherDeductions: fields.otherDeductions ?? 0,
      deductionLines: fields.deductionLines ? JSON.stringify(fields.deductionLines) : null,
      perDiem: 0,
    })
    .returning({ id: schema.payEntries.id });
  return rows[0]!.id;
}

const NOON = (y: number, m: number, d: number) => Date.UTC(y, m, d, 17); // Pay Book entries stamp at local noon

// Carol: percent-paid (90%) driver at Fleetly.
//  L1 delivered Nov 10 — gross 2200 → should pay 1980.
//  Entry 1 paid Nov 15, gross 1900 → SHORT $80 (Fuel $300 off).
//  L2 delivered Nov 18 — gross 1000 → should pay 900.
//  Entry 2 paid Nov 22, gross 900 → matches; its automatic window
//  starts Nov 16 (day after entry 1's pay date), so L1 stays out.
const carol = await seedUser("checkcarol", "Carol C", { payBasis: "percent", driverCpm: null, driverPayPct: 90, companyName: "Fleetly" });
const carolCtx = ctxFor(carol);
const carolL1 = await seedLoad(carol, { rate: 2000, extraCharges: 200, loadedMiles: 1100, shipper: "Acme Steel" });
await addChainAt(carolL1, "pod_seal", NOON(2026, 10, 10));
const carolE1 = await seedPayEntry(carol, {
  payer: "Fleetly",
  paidAtMs: NOON(2026, 10, 15),
  gross: 1900,
  otherDeductions: 300,
  deductionLines: [{ label: "Fuel", amount: 300 }],
});
//  L0 delivered Nov 1 — outside every default window below; the
//  pull-in candidate for the override tests (gross 500 → 450).
const carolL0 = await seedLoad(carol, { rate: 500, extraCharges: 0, loadedMiles: 400, shipper: "Early Load Co" });
await addChainAt(carolL0, "pod_seal", NOON(2026, 10, 1));
const carolL2 = await seedLoad(carol, { rate: 1000, extraCharges: 0, loadedMiles: 500, shipper: "Second Load Co" });
await addChainAt(carolL2, "pod_seal", NOON(2026, 10, 18));
const carolE2 = await seedPayEntry(carol, { payer: "Fleetly", paidAtMs: NOON(2026, 10, 22), gross: 900 });

// Dave: CPM driver elsewhere — his own entry + load, for isolation.
const dave = await seedUser("checkdave", "Dave D", { payBasis: "cpm", driverCpm: 0.62, driverPayPct: null, companyName: "Other Fleet LLC" });
const daveCtx = ctxFor(dave);
const daveL1 = await seedLoad(dave, { rate: 1500, extraCharges: 0, loadedMiles: 1000, shipper: "Dave's Shipper" });
await addChainAt(daveL1, "pod_seal", NOON(2026, 10, 10));
const daveE1 = await seedPayEntry(dave, { payer: "Other Fleet LLC", paidAtMs: NOON(2026, 10, 15), gross: 620 });

describe("settlement check — automatic detail (Carol)", () => {
  test("entry 1: automatic weekly window at the default 0-day lag, SHORT $80 against her sealed load", async () => {
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(r.found).toBe(true);
    expect(r.entry?.payer).toBe("Fleetly");
    expect(r.lagDays).toBe(0); // unset reads as same-week — arrears are never assumed
    expect(r.window?.automatic).toBe(true);
    expect(r.window?.fromIso.slice(0, 10)).toBe("2026-11-09"); // weekly window ending on the Nov 15 pay date
    expect(r.window?.toIso.slice(0, 10)).toBe("2026-11-15");
    expect(r.window?.basis).toContain("pays the same week (0-day lag)");
    expect(r.lines.map((l) => l.loadId)).toEqual([carolL1]);
    expect(r.expectedTotal).toBe(1980);
    expect(r.actualGross).toBe(1900);
    expect(r.status).toBe("short");
    expect(r.shortBy).toBe(80);
    // Deductions ride along, categorized, and nets carry the shortage.
    expect(r.totalDeductions).toBe(300);
    expect(r.deductionBreakdown).toEqual([{ category: "Fuel", amount: 300 }]);
    expect(r.actualNet).toBe(1600);
    expect(r.expectedNet).toBe(1680);
  });

  test("entry 2: window chains from entry 1's window end — L1 never double-counts", async () => {
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE2 });
    expect(r.found).toBe(true);
    expect(r.window?.fromIso.slice(0, 10)).toBe("2026-11-16");
    expect(r.window?.basis).toContain("no day is counted twice or skipped");
    expect(r.lines.map((l) => l.loadId)).toEqual([carolL2]);
    expect(r.expectedTotal).toBe(900);
    expect(r.status).toBe("matches");
  });

  test("the raw automatic check carries no adjusted flag", async () => {
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(r.adjusted).toBe(false);
    expect(r.adjustmentNotes).toEqual([]);
    expect(r.override).toBeNull();
  });
});

describe("settlement check — verify + edit overrides (Carol)", () => {
  test("a stored window override re-runs the check on the driver's dates, labelled as adjusted", async () => {
    const set = await Actions.setSettlementCheckOverride.handler(carolCtx, {
      payEntryId: carolE1,
      windowFromMs: Date.UTC(2026, 10, 12),
      windowToMs: Date.UTC(2026, 10, 13, 23, 59, 59, 999),
      excludedLoadIds: [],
      includedLoadIds: [],
    });
    expect(set.ok).toBe(true);
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(r.found).toBe(true);
    expect(r.window?.automatic).toBe(false);
    expect(r.window?.basis).toContain("adjusted by driver for this settlement");
    expect(r.lines.length).toBe(0); // L1 delivered Nov 10 — outside the override
    expect(r.status).toBe("no_data");
    expect(r.statusReason).toContain("No sealed loads delivered in that window");
    expect(r.adjusted).toBe(true);
    expect(r.adjustmentNotes.join(" ")).toContain("Window adjusted by driver");

    const cleared = await Actions.clearSettlementCheckOverride.handler(carolCtx, { payEntryId: carolE1 });
    expect(cleared.ok).toBe(true);
    const back = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(back.status).toBe("short");
    expect(back.adjusted).toBe(false);
  });

  test("pull in a load from before the window; hold out the window's own load; badges follow", async () => {
    // Pull L0 (delivered Nov 1, figures 450) into entry 1's check.
    await Actions.setSettlementCheckOverride.handler(carolCtx, {
      payEntryId: carolE1,
      windowFromMs: null,
      windowToMs: null,
      excludedLoadIds: [],
      includedLoadIds: [carolL0],
    });
    const pulled = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(pulled.expectedTotal).toBe(2430); // 1980 + 450
    expect(pulled.status).toBe("short");
    expect(pulled.shortBy).toBe(530);
    expect(pulled.adjusted).toBe(true);
    expect(pulled.adjustmentNotes.join(" ")).toContain("pulled in by driver");
    expect(pulled.lines.find((l) => l.loadId === carolL0)?.pulledIn).toBe(true);
    expect(pulled.lines.find((l) => l.loadId === carolL1)?.pulledIn).toBe(false);

    // Hold L1 out instead (it was paid on the next settlement):
    // nothing figured remains, the badge follows, all labelled.
    await Actions.setSettlementCheckOverride.handler(carolCtx, {
      payEntryId: carolE1,
      windowFromMs: null,
      windowToMs: null,
      excludedLoadIds: [carolL1],
      includedLoadIds: [],
    });
    const held = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(held.lines.length).toBe(0);
    expect(held.heldOut.map((l) => l.loadId)).toEqual([carolL1]);
    expect(held.status).toBe("no_data");
    expect(held.adjusted).toBe(true);
    expect(held.adjustmentNotes.join(" ")).toContain("held out by driver");
    const list = await Actions.listPayEntries.handler(carolCtx, { limit: 300 });
    expect(list.entries.find((e) => e.id === carolE1)?.check?.status).toBe("no_data");

    // Overrides never touched the sealed load or the entry itself:
    // clearing restores the raw automatic SHORT $80 exactly.
    await Actions.clearSettlementCheckOverride.handler(carolCtx, { payEntryId: carolE1 });
    const back = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(back.status).toBe("short");
    expect(back.shortBy).toBe(80);
    expect(back.adjusted).toBe(false);
  });

  test("a half-set window is refused plainly", async () => {
    const r = await Actions.setSettlementCheckOverride.handler(carolCtx, {
      payEntryId: carolE1,
      windowFromMs: Date.UTC(2026, 10, 12),
      windowToMs: null,
      excludedLoadIds: [],
      includedLoadIds: [],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("both window dates");
  });
});

describe("settlement check — automatic badges on the Pay Book list", () => {
  test("Carol's entries carry their verdicts; Dave's entry carries his own", async () => {
    const carolList = await Actions.listPayEntries.handler(carolCtx, { limit: 300 });
    const e1 = carolList.entries.find((e) => e.id === carolE1)!;
    const e2 = carolList.entries.find((e) => e.id === carolE2)!;
    expect(e1.check?.status).toBe("short");
    expect(e1.check?.difference).toBe(-80);
    expect(e1.check?.expectedTotal).toBe(1980);
    expect(e2.check?.status).toBe("matches");

    const daveList = await Actions.listPayEntries.handler(daveCtx, { limit: 300 });
    const d1 = daveList.entries.find((e) => e.id === daveE1)!;
    expect(d1.check?.status).toBe("matches"); // 0.62 × 1000 loaded mi = 620 = his gross
    expect(d1.check?.expectedTotal).toBe(620);
  });
});

describe("settlement check — pay lag setting (per payer, per driver)", () => {
  test("setting Fleetly to a 7-day lag re-runs its checks on the shifted window — the window follows the setting, never the answer", async () => {
    const before = await Actions.getPayerPayLag.handler(carolCtx, { payer: "Fleetly" });
    expect(before.lagDays).toBe(0);
    expect(before.isSet).toBe(false);

    const set = await Actions.setPayerPayLag.handler(carolCtx, { payer: "Fleetly", lagDays: 7 });
    expect(set.ok).toBe(true);
    const after = await Actions.getPayerPayLag.handler(carolCtx, { payer: "Fleetly" });
    expect(after.lagDays).toBe(7);
    expect(after.isSet).toBe(true);

    // Same records as the SHORT $80 verdict above — but at a 7-day
    // lag entry 1's window is Nov 2–8, L1 (delivered Nov 10) falls
    // outside, and the honest result is no_data. The lag was NOT
    // chosen by which window makes the numbers line up.
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(r.lagDays).toBe(7);
    expect(r.window?.fromIso.slice(0, 10)).toBe("2026-11-02");
    expect(r.window?.toIso.slice(0, 10)).toBe("2026-11-08");
    expect(r.window?.basis).toContain("pays a week in the hole (7-day lag)");
    expect(r.lines.length).toBe(0);
    expect(r.status).toBe("no_data");

    // The badge follows the setting too.
    const list = await Actions.listPayEntries.handler(carolCtx, { limit: 300 });
    expect(list.entries.find((e) => e.id === carolE1)?.check?.status).toBe("no_data");
    expect(list.entries.find((e) => e.id === carolE1)?.check?.lagDays).toBe(7);

    // Dave's payer is a different setting entirely — untouched.
    const daveLag = await Actions.getPayerPayLag.handler(daveCtx, { payer: "Fleetly" });
    expect(daveLag.lagDays).toBe(0);
    expect(daveLag.isSet).toBe(false);

    // Setting it back to 0 restores the original verdict.
    await Actions.setPayerPayLag.handler(carolCtx, { payer: "Fleetly", lagDays: 0 });
    const back = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(back.status).toBe("short");
    expect(back.shortBy).toBe(80);
  });
});

describe("settlement check — cross-driver IDOR (pinned)", () => {
  test("Dave asking for Carol's entry gets nothing — no figures, no lines, no leak", async () => {
    const r = await Actions.getSettlementCheck.handler(daveCtx, { payEntryId: carolE1 });
    expect(r.found).toBe(false);
    expect(r.entry).toBeNull();
    expect(r.lines).toEqual([]);
    expect(r.expectedTotal).toBe(0);
    expect(r.actualGross).toBe(0);
    expect(JSON.stringify(r)).not.toContain("Acme");
    expect(JSON.stringify(r)).not.toContain("1980");
  });

  test("the badge path never badges another driver's entry", async () => {
    const daveList = await Actions.listPayEntries.handler(daveCtx, { limit: 300 });
    const foreign = daveList.entries.find((e) => e.id === carolE1);
    // Whether or not the raw list surfaces the row in this harness,
    // it must never carry a check computed from anyone's records.
    if (foreign) expect(foreign.check).toBeNull();
  });

  test("a missing entry id answers the same as a foreign one", async () => {
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: 999999 });
    expect(r.found).toBe(false);
    expect(r.entry).toBeNull();
  });

  test("Dave cannot set or clear overrides on Carol's entry", async () => {
    const set = await Actions.setSettlementCheckOverride.handler(daveCtx, {
      payEntryId: carolE1,
      windowFromMs: null,
      windowToMs: null,
      excludedLoadIds: [carolL1],
      includedLoadIds: [],
    });
    expect(set.ok).toBe(false);
    const clear = await Actions.clearSettlementCheckOverride.handler(daveCtx, { payEntryId: carolE1 });
    expect(clear.ok).toBe(false);
    // Carol's check is untouched by the attempt.
    const r = await Actions.getSettlementCheck.handler(carolCtx, { payEntryId: carolE1 });
    expect(r.status).toBe("short");
    expect(r.adjusted).toBe(false);
  });
});
