// maintenanceSheetFlow.test.ts — INTEGRATION tests for the
// Maintenance Sheet (2026-11-24), run against the REAL action
// handlers over a throwaway migrated SQLite database:
//
//   a driver saves a scheduled service (oil change, with parts +
//   oil brand/weight) and an unscheduled repair; the log reads the
//   new fields back; the sheet exports as text and as a Library PDF
//   (ref maintenance-sheet:{id}); because the driver belongs to a
//   company, each save publishes a fleet copy the company's owner
//   reads in the fleet view — while the driver seat itself is not a
//   fleet viewer, an edit refreshes the copy, a delete removes it,
//   and a solo driver (no company) publishes nothing.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-maint-sheet-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { eq } = await import("drizzle-orm");

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

const owner = await seedUser("msheetowner", "Fleet Owner");
const driver = await seedUser("msheetdriver", "Fleet Driver");
const solo = await seedUser("msheetsolo", "Solo Driver");
const ownerCtx = ctxFor(owner);
const driverCtx = ctxFor(driver);
const soloCtx = ctxFor(solo);

// One company: owner + driver members.
{
  const db = getDb();
  const comp = await db
    .insert(schema.companies)
    .values({ name: "Test Fleet LLC", ownerUsername: owner.username })
    .returning({ id: schema.companies.id });
  await db.insert(schema.companyMembers).values([
    { companyId: comp[0]!.id, username: owner.username, role: "owner" },
    { companyId: comp[0]!.id, username: driver.username, role: "driver" },
  ]);
  // The driver's truck identity, as Settings → Truck records it.
  await db
    .update(schema.profile)
    .set({
      truckYear: 2023,
      truckMake: "Kenworth",
      truckModel: "T680",
      truckUnitNumber: "8669",
      truckVin: "1XKYDP9X8PJ238669",
      truckPlate: "P1357517",
      truckEngine: "PACCAR MX-13",
    })
    .where(eq(schema.profile.id, driver.profileId));
}

const baseEntry = {
  id: null,
  performedAt: "2026-11-24T15:00:00.000Z",
  odometer: 455404,
  shop: null,
  nextDueMiles: null,
  nextDueAt: null,
  notes: null,
};

describe("maintenance sheet — driver log", () => {
  test("a scheduled oil service saves kind, parts and oil, and reads them back", async () => {
    const saved = await Actions.saveMaintenanceLogEntry.handler(driverCtx, {
      ...baseEntry,
      category: "oil",
      kind: "service",
      description: "Oil change + filters",
      cost: 292.63,
      parts: [{ name: "Oil filter", partNumber: "LF16233" }],
      oilBrand: "Shell Rotella T5",
      oilWeight: "10W-30",
      nextDueMiles: 490404,
    });
    expect(saved.id).toBeGreaterThan(0);
    const log = await Actions.listMaintenanceLog.handler(driverCtx, {});
    const e = log.entries.find((x) => x.id === saved.id);
    expect(e).toBeDefined();
    expect(e!.kind).toBe("service");
    expect(e!.category).toBe("oil");
    expect(e!.parts).toEqual([{ name: "Oil filter", partNumber: "LF16233" }]);
    expect(e!.oilBrand).toBe("Shell Rotella T5");
    expect(e!.oilWeight).toBe("10W-30");
    expect(log.truck.truckUnitNumber).toBe("8669");
  });

  test("an unscheduled fix saves as a repair", async () => {
    const saved = await Actions.saveMaintenanceLogEntry.handler(driverCtx, {
      ...baseEntry,
      category: "electrical",
      kind: "repair",
      description: "Alternator replaced on the road",
      shop: "TA Truck Service",
      cost: 640,
      parts: [{ name: "Alternator", partNumber: null }],
      oilBrand: null,
      oilWeight: null,
    });
    const log = await Actions.listMaintenanceLog.handler(driverCtx, {});
    const e = log.entries.find((x) => x.id === saved.id);
    expect(e!.kind).toBe("repair");
    expect(e!.shop).toBe("TA Truck Service");
  });

  test("the sheet exports as text and as a Library PDF", async () => {
    const log = await Actions.listMaintenanceLog.handler(driverCtx, {});
    const oil = log.entries.find((x) => x.category === "oil");
    const sheet = await Actions.exportMaintenanceSheet.handler(driverCtx, { id: oil!.id });
    expect(sheet.filename).toBe(`stonemiles-maintenance-sheet-${oil!.id}.txt`);
    expect(sheet.text).toContain("MAINTENANCE SHEET");
    expect(sheet.text).toContain("2023 Kenworth T680");
    expect(sheet.text).toContain("Unit: 8669");
    expect(sheet.text).toContain("VIN: 1XKYDP9X8PJ238669");
    expect(sheet.text).toContain("Oil: Shell Rotella T5 10W-30");
    expect(sheet.text).toContain("Oil filter - Part # LF16233");
    expect(sheet.text).toContain("$292.63");

    const doc = await Actions.getLibraryDocument.handler(driverCtx, { ref: `maintenance-sheet:${oil!.id}` });
    expect(doc.ok).toBe(true);
    expect(doc.mime).toBe("application/pdf");
    const bytes = Buffer.from(doc.dataBase64!, "base64");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("another driver's sheet ref reads as no document", async () => {
    const log = await Actions.listMaintenanceLog.handler(driverCtx, {});
    const oil = log.entries.find((x) => x.category === "oil");
    const doc = await Actions.getLibraryDocument.handler(soloCtx, { ref: `maintenance-sheet:${oil!.id}` });
    expect(doc.ok).toBe(false);
  });
});

describe("maintenance sheet — fleet view", () => {
  test("the owner sees both records with the truck to filter by; the driver seat does not", async () => {
    const fleet = await Actions.listFleetMaintenance.handler(ownerCtx, {});
    expect(fleet.isFleetViewer).toBe(true);
    expect(fleet.companyName).toBe("Test Fleet LLC");
    expect(fleet.records.length).toBe(2);
    expect(fleet.trucks).toEqual([{ key: `${driver.username}::8669`, driverUsername: driver.username, unit: "8669", label: "2023 Kenworth T680" }]);
    const repair = fleet.records.find((r) => r.kind === "repair");
    expect(repair!.driverUsername).toBe(driver.username);
    expect(repair!.truckUnit).toBe("8669");

    const asDriver = await Actions.listFleetMaintenance.handler(driverCtx, {});
    expect(asDriver.isFleetViewer).toBe(false);
    expect(asDriver.records).toEqual([]);
  });

  test("an edit refreshes the fleet copy; a delete removes it", async () => {
    const log = await Actions.listMaintenanceLog.handler(driverCtx, {});
    const repair = log.entries.find((x) => x.kind === "repair");
    await Actions.saveMaintenanceLogEntry.handler(driverCtx, {
      ...baseEntry,
      id: repair!.id,
      category: "electrical",
      kind: "repair",
      description: "Alternator replaced on the road",
      shop: "TA Truck Service",
      cost: 615,
      parts: [{ name: "Alternator", partNumber: "A-123" }],
      oilBrand: null,
      oilWeight: null,
    });
    let fleet = await Actions.listFleetMaintenance.handler(ownerCtx, {});
    expect(fleet.records.find((r) => r.entryId === repair!.id)!.cost).toBe(615);

    await Actions.deleteMaintenanceLogEntry.handler(driverCtx, { id: repair!.id });
    fleet = await Actions.listFleetMaintenance.handler(ownerCtx, {});
    expect(fleet.records.length).toBe(1);
    expect(fleet.records[0]!.kind).toBe("service");
  });

  test("a solo driver publishes nothing", async () => {
    await Actions.saveMaintenanceLogEntry.handler(soloCtx, {
      ...baseEntry,
      category: "tires",
      kind: "service",
      description: "Steer tires",
      cost: 900,
      parts: [],
      oilBrand: null,
      oilWeight: null,
    });
    const db = getDb();
    const copies = await db.select().from(schema.maintenanceFleetRecords).where(eq(schema.maintenanceFleetRecords.username, solo.username));
    expect(copies).toEqual([]);
  });
});
