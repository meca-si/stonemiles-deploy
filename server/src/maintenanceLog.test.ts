// maintenanceLog.test.ts — INTEGRATION tests for the My Truck
// identity + maintenance log (migration 0118), run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   (a) truck identity round-trips through saveProfile / getProfile
//   (b) log entries: add, list newest first, running total cost
//   (c) edit an entry in place; delete removes it (and its files)
//   (d) attachments: base64 receipt lands in the same blob store the
//       Document Vault uses; the file reads back with a download URL
//   (e) ownership: another account sees none of it and cannot delete
//       or attach to entries it does not own
//   (f) the truck record export: CSV headed by the truck identity
//       with every log field + total; text version names the truck
//   (g) the public truck line on the social profile: year/make/
//       model + trailer type only — never VIN, plate, or unit
//   (h) the Show-my-truck toggle stores and reads back
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-maintlog-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");

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

const alice = await seedUser("maintalice", "Alice A");
const bob = await seedUser("maintbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

const fullProfile = {
  heightFt: 13,
  heightIn: 6,
  weightLbs: 80000,
  lengthFt: 53,
  mpg: 6.5,
  dieselPrice: 3.89,
  tankRangeMi: 1000,
  lovesOff: false,
  pilotOff: false,
  brandOffs: [],
  autoRoute: true,
  autoTrip: true,
  autoAlerts: true,
  autoFuel: true,
  autoSeal: true,
  priority1: "safety",
  priority2: "net",
  priority3: "time",
  chatName: "Alice A",
  hazmat: false,
  hazmatClass: null,
  companyName: null,
  driverCpm: null,
  payBasis: "cpm",
  driverPayPct: null,
  factoringPct: 0,
  dispatcherPct: 0,
  trailerType: "step_deck",
  truckYear: 2021,
  truckMake: "Kenworth",
  truckModel: "W900",
  truckUnitNumber: "12",
  truckVin: "1XKWD49X7MJ123456",
  truckPlate: "AL-8842",
  truckEngine: "Cummins X15",
  truckTransmission: "18-speed",
} as const;

describe("My Truck identity (migration 0118)", () => {
  test("(a) identity round-trips through saveProfile / getProfile", async () => {
    await Actions.saveProfile.handler(aliceCtx, { ...fullProfile } as never);
    const r = (await Actions.getProfile.handler(aliceCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(r.profile?.truckYear).toBe(2021);
    expect(r.profile?.truckMake).toBe("Kenworth");
    expect(r.profile?.truckModel).toBe("W900");
    expect(r.profile?.truckUnitNumber).toBe("12");
    expect(r.profile?.truckVin).toBe("1XKWD49X7MJ123456");
    expect(r.profile?.truckPlate).toBe("AL-8842");
    expect(r.profile?.truckEngine).toBe("Cummins X15");
    expect(r.profile?.truckTransmission).toBe("18-speed");
    // Bob never set his — all null, not Alice's.
    const rb = (await Actions.getProfile.handler(bobCtx, {} as never)) as { profile: Record<string, unknown> | null };
    expect(rb.profile?.truckMake ?? null).toBeNull();
  });
});

describe("maintenance log CRUD + totals", () => {
  let firstId = 0;
  let secondId = 0;

  test("(b) add two entries; list is newest first with a running total", async () => {
    const a = (await Actions.saveMaintenanceLogEntry.handler(aliceCtx, {
      id: null,
      performedAt: "2026-10-01T12:00:00.000Z",
      odometer: 500000,
      category: "oil",
      description: "Oil + both filters",
      shop: "Speedco",
      cost: 429.99,
      nextDueMiles: 525000,
      nextDueAt: null,
      notes: null,
    } as never)) as { id: number };
    firstId = a.id;
    const b = (await Actions.saveMaintenanceLogEntry.handler(aliceCtx, {
      id: null,
      performedAt: "2026-11-02T12:00:00.000Z",
      odometer: 512400,
      category: "tires",
      description: "Two steer tires",
      shop: "Love's Tire Care",
      cost: 1150.01,
      nextDueMiles: null,
      nextDueAt: null,
      notes: "Rotated drives too",
    } as never)) as { id: number };
    secondId = b.id;
    expect(firstId).toBeGreaterThan(0);
    expect(secondId).toBeGreaterThan(firstId);

    const list = (await Actions.listMaintenanceLog.handler(aliceCtx, {} as never)) as {
      entries: { id: number; description: string }[];
      totalCost: number;
      truck: { truckMake: string | null; truckModel: string | null; trailerType: string | null };
    };
    expect(list.entries.map((e) => e.id)).toEqual([secondId, firstId]);
    expect(list.totalCost).toBe(1580);
    expect(list.truck.truckMake).toBe("Kenworth");
    expect(list.truck.truckModel).toBe("W900");
    expect(list.truck.trailerType).toBe("step_deck");
  });

  test("(c) edit updates in place; delete removes the entry", async () => {
    await Actions.saveMaintenanceLogEntry.handler(aliceCtx, {
      id: firstId,
      performedAt: "2026-10-01T12:00:00.000Z",
      odometer: 500000,
      category: "oil",
      description: "Oil + both filters + fuel filter",
      shop: "Speedco",
      cost: 479.99,
      nextDueMiles: 525000,
      nextDueAt: null,
      notes: null,
    } as never);
    let list = (await Actions.listMaintenanceLog.handler(aliceCtx, {} as never)) as { entries: { id: number; description: string }[]; totalCost: number };
    expect(list.entries.length).toBe(2);
    expect(list.entries.find((e) => e.id === firstId)?.description).toBe("Oil + both filters + fuel filter");
    expect(list.totalCost).toBe(1630);

    await Actions.deleteMaintenanceLogEntry.handler(aliceCtx, { id: secondId } as never);
    const afterDelete = (await Actions.listMaintenanceLog.handler(aliceCtx, {} as never)) as { entries: { id: number }[]; totalCost: number };
    expect(afterDelete.entries.map((e) => e.id)).toEqual([firstId]);
    expect(afterDelete.totalCost).toBe(479.99);
  });

  test("(d) attachment: receipt uploads to the blob store and reads back", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake receipt");
    const b64 = Buffer.from(pdfBytes).toString("base64");
    const add = (await Actions.addMaintenanceLogAttachment.handler(aliceCtx, {
      entryId: firstId,
      label: "Speedco receipt",
      dataBase64: b64,
      mime: "application/pdf",
    } as never)) as { id: number; error: string | null };
    expect(add.error).toBeNull();
    expect(add.id).toBeGreaterThan(0);

    const list = (await Actions.listMaintenanceLog.handler(aliceCtx, {} as never)) as {
      entries: { id: number; attachments: { id: number; label: string; hasFile: boolean }[] }[];
    };
    const entry = list.entries.find((e) => e.id === firstId);
    expect(entry?.attachments.length).toBe(1);
    expect(entry?.attachments[0]?.label).toBe("Speedco receipt");
    expect(entry?.attachments[0]?.hasFile).toBe(true);

    const file = (await Actions.getMaintenanceLogAttachmentFile.handler(aliceCtx, { id: add.id } as never)) as { url: string | null; mime: string | null };
    expect(file.mime).toBe("application/pdf");
    expect(file.url).toBeTruthy();

    await Actions.deleteMaintenanceLogAttachment.handler(aliceCtx, { id: add.id } as never);
    const after = (await Actions.listMaintenanceLog.handler(aliceCtx, {} as never)) as { entries: { id: number; attachments: unknown[] }[] };
    expect(after.entries.find((e) => e.id === firstId)?.attachments.length).toBe(0);
  });

  test("(e) ownership: Bob sees none of Alice's log and cannot touch it", async () => {
    const bobList = (await Actions.listMaintenanceLog.handler(bobCtx, {} as never)) as { entries: unknown[]; totalCost: number };
    expect(bobList.entries.length).toBe(0);
    expect(bobList.totalCost).toBe(0);

    await Actions.deleteMaintenanceLogEntry.handler(bobCtx, { id: firstId } as never);
    const add = (await Actions.addMaintenanceLogAttachment.handler(bobCtx, {
      entryId: firstId,
      label: "Bob's intrusion",
      dataBase64: null,
      mime: null,
    } as never)) as { id: number; error: string | null };
    expect(add.error).toBeTruthy();

    const aliceList = (await Actions.listMaintenanceLog.handler(aliceCtx, {} as never)) as { entries: { id: number; attachments: unknown[] }[] };
    expect(aliceList.entries.map((e) => e.id)).toEqual([firstId]);
    expect(aliceList.entries[0]?.attachments.length).toBe(0);
  });

  test("(f) truck record export: identity-headed CSV + printable text", async () => {
    const r = (await Actions.exportTruckRecord.handler(aliceCtx, {} as never)) as { csv: string; text: string; entryCount: number; totalCost: number };
    expect(r.entryCount).toBe(1);
    expect(r.totalCost).toBe(479.99);
    // Identity heads the CSV.
    expect(r.csv).toContain("STONEMILES — TRUCK RECORD");
    expect(r.csv).toContain("Truck,2021 Kenworth W900");
    expect(r.csv).toContain("Unit number,12");
    expect(r.csv).toContain("VIN,1XKWD49X7MJ123456");
    expect(r.csv).toContain("Transmission,18-speed");
    // Log section with header row, the entry, and the total.
    expect(r.csv).toContain("Date,Odometer (mi),Category,Description,Shop / vendor,Cost (USD),Next due (mi),Next due (date),Notes,Attachments");
    expect(r.csv).toContain("2026-10-01,500000,Oil & filters,Oil + both filters + fuel filter,Speedco,479.99,525000");
    expect(r.csv).toContain("TOTAL");
    expect(r.csv).toContain("479.99");
    // Printable text names the truck and the total.
    expect(r.text).toContain("Truck: 2021 Kenworth W900");
    expect(r.text).toContain("TOTAL LOGGED COST: $479.99");
    // Bob's export is his own (empty) record — no identity, no entries.
    const rb = (await Actions.exportTruckRecord.handler(bobCtx, {} as never)) as { csv: string; entryCount: number };
    expect(rb.entryCount).toBe(0);
    expect(rb.csv).not.toContain("Kenworth");
  });
});

describe("public truck line on the social profile", () => {
  const socialArgs = (showTruck: boolean) => ({
    displayName: "Alice A",
    bio: null,
    company: null,
    truckInfo: null,
    homeCity: null,
    homeState: null,
    contactPhone: null,
    contactEmail: null,
    mcNumber: null,
    dotNumber: null,
    twicHas: false,
    twicExpires: null,
    endorsements: [],
    dmPolicy: "everyone" as const,
    groupPolicy: "everyone" as const,
    showReputation: false,
    showMilesPanel: true,
    showTruck,
    featuredBadge: null,
    avatarDataBase64: null,
    avatarMime: null,
  });

  test("(g) year/make/model + trailer type show; VIN, plate, unit never do", async () => {
    await Actions.updateMyProfile.handler(aliceCtx, socialArgs(true) as never);
    const mine = (await Actions.getUserProfile.handler(aliceCtx, { username: "maintalice" } as never)) as { showTruck: boolean; truckLine: string | null };
    expect(mine.showTruck).toBe(true);
    expect(mine.truckLine).toBe("2021 Kenworth W900 · Step Deck");
    expect(mine.truckLine).not.toContain("1XKWD");
    expect(mine.truckLine).not.toContain("AL-8842");
    expect(mine.truckLine).not.toContain("Unit");
    // Another driver's view: identity lives on their own device in
    // this staging build (same rule as the tier chip) — null, and
    // the toggle itself is visible.
    const bobs = (await Actions.getUserProfile.handler(bobCtx, { username: "maintalice" } as never)) as { showTruck: boolean; truckLine: string | null };
    expect(bobs.showTruck).toBe(true);
    expect(bobs.truckLine).toBeNull();
  });

  test("(h) toggle off: flag stored; the owner still sees their own line", async () => {
    await Actions.updateMyProfile.handler(aliceCtx, socialArgs(false) as never);
    const mine = (await Actions.getUserProfile.handler(aliceCtx, { username: "maintalice" } as never)) as { showTruck: boolean; truckLine: string | null };
    expect(mine.showTruck).toBe(false);
    expect(mine.truckLine).toBe("2021 Kenworth W900 · Step Deck");
    const bobs = (await Actions.getUserProfile.handler(bobCtx, { username: "maintalice" } as never)) as { showTruck: boolean; truckLine: string | null };
    expect(bobs.showTruck).toBe(false);
    expect(bobs.truckLine).toBeNull();
  });
});
