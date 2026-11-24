// loadAddFlow.test.ts — INTEGRATION tests for the add-a-load door
// (driver report, 2026-11-24: "wouldn't let me add load" — a rate
// con PDF added by hand), run against the REAL action handlers over
// a throwaway migrated SQLite database:
//
//   (a) the deterministic text read finds the load in a BVB-style
//       rate con's printed text (labels and values on separate
//       lines, TOTAL COST line for the money);
//   (b) saveLoad with the PDF attached creates the load and files
//       the confirmed-document copy;
//   (c) the created load's PICKUP and DELIVERY appointments land on
//       the driver's Schedule calendar (getCalendar) at their own
//       appointment times — not at the moment the load was typed —
//       and the pickup becomes the next move;
//   (d) a load whose appointment text carries no readable date
//       keeps the old behaviour: one calendar event anchored at
//       creation time, nothing invented.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-loadadd-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");

const privStub = async () => ({
  ok: false,
  status: "not_configured",
  notConfigured: true,
  providerId: null,
  errorMessage: null,
  detail: "test stub",
  id: null,
});

const db = getDb();

async function seedUser(username: string, plan: string) {
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
      mpg: 6.5,
      dieselPrice: 3.65,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: { accountId: number; profileId: number; username: string; email: string }): Ctx {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: {
      accountId: u.accountId,
      profileId: u.profileId,
      username: u.username,
      email: u.email,
      isOwner: true,
      status: "active",
      totpPending: false,
      hasTeamSeat: false,
      sessionId: 1,
    },
  }).ctx as unknown as Ctx;
}

// The printed-text shape PDF.js hands the client for a BVB-style
// rate con: every label and value on its own line.
const BVB_TEXT = [
  "CARRIER RATE AND LOAD CONFIRMATION",
  "LOAD NUMBER",
  "31229",
  "BROKER NAME",
  "Tim Miller",
  "CARRIER NAME",
  "ROBERT L GAST INC",
  "CARRIER MC#",
  "326661",
  "EQUIPMENT TYPE",
  "53' Van",
  "SHIPPER — PICKUP",
  "SHIPPER NAME AND ADDRESS",
  "BRWY-- Jacksonville",
  "Address: 111 BUSCH DRIVE",
  "JACKSONVILLE, FL 32218",
  "EXPECTED DATE 11/24/2026",
  "PICKUP INSTRUCTIONS",
  "9PM",
  "CONSIGNEE — DELIVERY",
  "CONSIGNEE NAME AND ADDRESS",
  "WSLR-- Bama Bud Of Montgomery Inc",
  "Address: 1700 EMORY FOLMAR BLVD.",
  "MONTGOMERY, AL 36110",
  "EXPECTED DATE 11/25/2026",
  "DELIVERY INSTRUCTIONS",
  "7AM",
  "TOTAL COST $ 600.00",
].join("\n");

// A minimal valid PDF — the save path only needs real PDF bytes
// for the upload guard and the sealed copy.
const TINY_PDF_B64 = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
).toString("base64");

const saveArgs = {
  id: null,
  shipper: "BRWY-- Jacksonville",
  pickupCity: "Jacksonville",
  pickupState: "FL",
  deliveryCity: "Montgomery",
  deliveryState: "AL",
  rate: 600,
  loadedMiles: null,
  milesSource: null,
  extraCharges: 0,
  extraChargesNote: null,
  weightLbs: 40000,
  commodity: "beer",
  hazmat: false,
  docDataBase64: TINY_PDF_B64,
  docMime: "application/pdf",
  equipmentType: "dry_van" as const,
  trailerNumber: null,
  brokerName: "Tim Miller",
  brokerCompany: "BVB EXPRESS LLC",
  brokerMc: "1164350",
  docLoadNumber: "31229",
  docPoNumber: null,
  docProNumber: null,
  docPickupAddress: "111 BUSCH DRIVE, JACKSONVILLE, FL 32218",
  docDeliveryAddress: "1700 EMORY FOLMAR BLVD, MONTGOMERY, AL 36110",
  docPieces: null,
  docKind: "rate_con" as const,
};

describe("add-a-load flow", () => {
  test("(a) the text read finds the BVB-style rate con", async () => {
    const u = await seedUser("loadaddread", "owner");
    const ctx = ctxFor(u);
    const ex = await Actions.extractLoadFromText.handler(ctx, { text: BVB_TEXT } as never);
    expect(ex.locked).toBe(false);
    expect(ex.found).toBe(true);
    expect(ex.pickupCity).toBe("JACKSONVILLE");
    expect(ex.deliveryCity).toBe("MONTGOMERY");
    expect(ex.pickupText).toBe("11/24/2026");
    expect(ex.deliveryText).toBe("11/25/2026");
  });

  test("(b)+(c) save with the PDF attached; pickup + delivery bind to the calendar at their own times", async () => {
    const u = await seedUser("loadaddsave", "owner");
    const ctx = ctxFor(u);
    const saved = await Actions.saveLoad.handler(ctx, {
      ...saveArgs,
      pickupText: "11/24/2027 9:00 PM",
      deliveryText: "11/25/2027 7:00 AM",
    } as never);
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.copies.filed).toBe(true);

    const list = await Actions.listLoads.handler(ctx, { limit: 50 } as never);
    expect(list.loads.map((l) => l.id)).toContain(saved.id);

    const cal = await Actions.getCalendar.handler(ctx, {
      fromIso: "2027-11-22T00:00:00.000Z",
      toIso: "2027-11-29T00:00:00.000Z",
    } as never);
    const mine = cal.events.filter((e) => e.kind === "load" && e.loadId === saved.id);
    const pickup = mine.find((e) => e.title.startsWith("Pickup"));
    const delivery = mine.find((e) => e.title.startsWith("Delivery"));
    expect(pickup?.at).toBe("2027-11-24T21:00:00.000Z");
    expect(delivery?.at).toBe("2027-11-25T07:00:00.000Z");
    expect(cal.nextMove?.loadId).toBe(saved.id);
    expect(cal.nextMove?.at).toBe("2027-11-24T21:00:00.000Z");
  });

  test("(d) unreadable appointment text keeps the creation-anchored fallback event", async () => {
    const u = await seedUser("loadaddfallback", "owner");
    const ctx = ctxFor(u);
    const saved = await Actions.saveLoad.handler(ctx, {
      ...saveArgs,
      docDataBase64: null,
      docMime: null,
      pickupText: "FCFS",
      deliveryText: null,
    } as never);
    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 86_400_000).toISOString();
    const cal = await Actions.getCalendar.handler(ctx, { fromIso: from, toIso: to } as never);
    const mine = cal.events.filter((e) => e.kind === "load" && e.loadId === saved.id);
    expect(mine.length).toBe(1);
    expect(mine[0]!.title).toBe("Jacksonville → Montgomery");
  });
});
