// parkingFlow.test.ts — INTEGRATION tests for reservable
// HOS-aware parking (Research Wave 2 item 4), run against the
// REAL action handlers over a throwaway migrated SQLite database:
//
//   - No partner configured (the production state until a partner
//     agreement lands): reserveParking refuses with the plain
//     reason and writes NOTHING — no row, no chain event.
//   - Partner configured (env + a stubbed fetch standing in for
//     the partner): a reachable stop reserves end-to-end — partner
//     hold placed first, row written with the HOS arrival window,
//     chain sealed; a stop the clock can't reach is refused
//     before the partner is ever called; cancel releases the
//     partner hold and seals; "used" seals; another driver can't
//     touch the reservation.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load). The
// partner env vars are set only inside the configured describe
// and removed after.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-parking-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.PARKING_PARTNER_API_KEY;
delete process.env.PARKING_PARTNER_BASE_URL;
delete process.env.PARKING_PARTNER_NAME;

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

async function seedUser(username: string, chatName: string, plan = "diamond"): Promise<SeededUser> {
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
      plan,
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

const db = getDb();
const alice = await seedUser("parkalice", "Alice A");
const bob = await seedUser("parkbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

// Alice has been driving for 30 minutes — her sealed clocks say
// ~10.5 h of drive time remains. (Direct chain insert: the duty
// timeline reads payloads; hashes here are inert filler.)
await db.insert(schema.chainLog).values({
  refKind: "driver",
  event: "duty_change",
  payload: JSON.stringify({ state: "driving", at: new Date(Date.now() - 30 * 60000).toISOString(), username: "parkalice", source: "manual" }),
  prevHash: "seed",
  hash: "seed-duty-1",
});

describe("parking reservations — no partner configured", () => {
  test("reserve refuses plainly and writes nothing", async () => {
    const r = await Actions.reserveParking.handler(aliceCtx, {
      stopName: "Rest area MM 120",
      stopLat: 32.7,
      stopLon: -96.8,
      alongMi: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("aren't connected yet");
    const rows = await db.select().from(schema.parkingReservations);
    expect(rows).toHaveLength(0);
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "parking_reserved"));
    expect(seals).toHaveLength(0);
  });

  test("the read says unconfigured and lists nothing", async () => {
    const r = await Actions.getParkingReservations.handler(aliceCtx, {});
    expect(r.partnerConfigured).toBe(false);
    expect(r.partnerName).toBeNull();
    expect(r.reservations).toHaveLength(0);
  });
});

describe("parking reservations — partner configured", () => {
  const partnerCalls: { url: string; method: string }[] = [];
  const realFetch = globalThis.fetch;
  let reservationId = 0;

  test("setup: env + stubbed partner transport", () => {
    process.env.PARKING_PARTNER_API_KEY = "test-key";
    process.env.PARKING_PARTNER_BASE_URL = "https://partner.example";
    process.env.PARKING_PARTNER_NAME = "Test Parking Club";
    globalThis.fetch = (async (url: string, init?: { method?: string }) => {
      partnerCalls.push({ url: String(url), method: init?.method ?? "GET" });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "TPC-900", status: "held" }),
      } as Response;
    }) as typeof fetch;
    expect(process.env.PARKING_PARTNER_API_KEY).toBe("test-key");
  });

  test("a reachable stop reserves: partner hold, row with the HOS window, chain seal", async () => {
    const r = await Actions.reserveParking.handler(aliceCtx, {
      stopName: "Rest area MM 120",
      stopLat: 32.7,
      stopLon: -96.8,
      alongMi: 100,
      paceMph: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("held");
    expect(r.fit).toBe("fits");
    reservationId = r.reservationId!;
    expect(partnerCalls.some((c) => c.url === "https://partner.example/reservations" && c.method === "POST")).toBe(true);

    const rows = await db.select().from(schema.parkingReservations);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.driverUsername).toBe("parkalice");
    expect(row.partnerName).toBe("Test Parking Club");
    expect(row.partnerRef).toBe("TPC-900");
    // The window: ETA ~2 h out at 50 mph, latest = the clock's end
    // (~10.5 h of drive remaining after 30 min driven).
    expect(row.etaAt.getTime()).toBeLessThan(row.latestArrivalAt.getTime());
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "parking_reserved"));
    expect(seals).toHaveLength(1);
    expect(seals[0]?.payload).toContain('"partnerRef":"TPC-900"');

    const list = await Actions.getParkingReservations.handler(aliceCtx, {});
    expect(list.partnerConfigured).toBe(true);
    expect(list.reservations).toHaveLength(1);
    expect(list.reservations[0]?.status).toBe("held");
  });

  test("a stop the clock can't reach is refused BEFORE the partner is called", async () => {
    const before = partnerCalls.length;
    const r = await Actions.reserveParking.handler(aliceCtx, {
      stopName: "Far truck stop",
      stopLat: 35.0,
      stopLon: -100.0,
      alongMi: 600,
      paceMph: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.fit).toBe("wont_make_it");
    expect(r.error).toContain("hours run out");
    expect(partnerCalls.length).toBe(before);
    const rows = await db.select().from(schema.parkingReservations);
    expect(rows).toHaveLength(1);
  });

  test("another driver can't cancel or use Alice's reservation", async () => {
    const c = await Actions.cancelParkingReservation.handler(bobCtx, { id: reservationId });
    expect(c.ok).toBe(false);
    const u = await Actions.markParkingReservationUsed.handler(bobCtx, { id: reservationId });
    expect(u.ok).toBe(false);
    const rows = await db.select().from(schema.parkingReservations);
    expect(rows[0]?.status).toBe("held");
  });

  test("cancel releases the partner hold and seals", async () => {
    const r = await Actions.cancelParkingReservation.handler(aliceCtx, { id: reservationId });
    expect(r.ok).toBe(true);
    expect(partnerCalls.some((c) => c.url === "https://partner.example/reservations/TPC-900" && c.method === "DELETE")).toBe(true);
    const rows = await db.select().from(schema.parkingReservations);
    expect(rows[0]?.status).toBe("cancelled");
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "parking_reservation_cancelled"));
    expect(seals).toHaveLength(1);
    const again = await Actions.cancelParkingReservation.handler(aliceCtx, { id: reservationId });
    expect(again.ok).toBe(false);
  });

  test("a fresh reservation can be marked used, and that seals too", async () => {
    const r = await Actions.reserveParking.handler(aliceCtx, {
      stopName: "Rest area MM 120",
      stopLat: 32.7,
      stopLon: -96.8,
      alongMi: 80,
      paceMph: 50,
    });
    expect(r.ok).toBe(true);
    const u = await Actions.markParkingReservationUsed.handler(aliceCtx, { id: r.reservationId! });
    expect(u.ok).toBe(true);
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "parking_reservation_used"));
    expect(seals).toHaveLength(1);
  });

  test("teardown: env + fetch restored", () => {
    delete process.env.PARKING_PARTNER_API_KEY;
    delete process.env.PARKING_PARTNER_BASE_URL;
    delete process.env.PARKING_PARTNER_NAME;
    globalThis.fetch = realFetch;
    expect(process.env.PARKING_PARTNER_API_KEY).toBeUndefined();
  });
});
