// eldSamsaraFlow.test.ts — INTEGRATION tests for the Samsara ELD
// connection (2026-11-24), run against the REAL action handlers over
// a throwaway migrated SQLite database, with globalThis.fetch stubbed
// to a fake Samsara REST API (no network is ever touched):
//
//   connectEld stores the API token encrypted in the vault slot (a
//   bad-shape token stores nothing); syncEldNow pulls the fake
//   provider's feeds through the REAL pipeline with source "provider"
//   — so the mirrored HOS clocks and the identity log light up as
//   OFFICIAL data; a token Samsara refuses syncs nothing and records
//   the refusal; the vehicle is matched by the truck profile's VIN;
//   revoke wipes the token. Mirrors eldGeotabFlow.test.ts.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-eld-samsara-"));
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

// --- Fake Samsara ---------------------------------------------------------

const VIN = "1XKYDP9X8PJ238669";
const GOOD_TOKEN = "samsara-good-token-123456";

function installFakeSamsara() {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  globalThis.fetch = (async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
    const respond = (status: number, payload: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
    if (init.headers?.Authorization !== `Bearer ${GOOD_TOKEN}`) {
      return respond(401, { message: "Invalid API token" });
    }
    const p = new URL(url).pathname;
    if (p === "/fleet/vehicles") {
      return respond(200, {
        data: [
          { id: "v-other", name: "1111", vin: "1XKOTHER000000000" },
          { id: "v-8669", name: "8669", vin: VIN, licensePlate: "P1357517", make: "Kenworth", model: "T680", year: 2023 },
        ],
        pagination: { hasNextPage: false },
      });
    }
    if (p === "/fleet/hos/logs") {
      return respond(200, {
        data: [
          {
            driver: { id: "d1", name: "Sam Driver" },
            hosLogs: [
              { hosStatusType: "offDuty", logStartTime: iso(12 * 3_600_000), logEndTime: iso(2 * 3_600_000), vehicle: { id: "v-8669" } },
              { hosStatusType: "onDuty", logStartTime: iso(2 * 3_600_000), logEndTime: iso(1 * 3_600_000), vehicle: { id: "v-8669" } },
              { hosStatusType: "driving", logStartTime: iso(1 * 3_600_000), logEndTime: iso(0), vehicle: { id: "v-8669" } },
            ],
          },
        ],
        pagination: { hasNextPage: false },
      });
    }
    if (p === "/fleet/hos/clocks") {
      return respond(200, {
        data: [
          {
            driver: { id: "d1" },
            clocks: {
              break: { timeUntilBreakDurationMs: 25_200_000 },
              cycle: { timeUntilBreakDurationMs: 244_800_000 },
              drive: { timeUntilBreakDurationMs: 36_000_000 },
              shift: { timeUntilBreakDurationMs: 43_200_000 },
            },
            currentVehicle: { id: "v-8669" },
          },
        ],
      });
    }
    if (p === "/fleet/vehicles/stats") {
      return respond(200, {
        data: [{ id: "v-8669", gps: { latitude: 30.33, longitude: -81.65 }, obdOdometerMeters: { value: 732_646_000 }, obdEngineSeconds: { value: 22_647_600 } }],
      });
    }
    if (p === "/fleet/dvirs/history") {
      return respond(200, {
        data: [{ id: "dv1", type: "preTrip", safetyStatus: "safe", startTime: iso(1_800_000), vehicle: { id: "v-8669", name: "8669" }, vehicleDefects: [] }],
        pagination: { hasNextPage: false },
      });
    }
    if (p === "/fleet/reports/ifta/jurisdiction") {
      return respond(200, { data: [{ jurisdiction: "FL", distanceMiles: 200.1 }] });
    }
    if (p === "/fleet/drivers") {
      return respond(200, {
        data: [{ id: "d1", name: "Sam Driver", licenseNumber: "R200", licenseState: "AL" }],
        pagination: { hasNextPage: false },
      });
    }
    return respond(200, { data: [] });
  }) as typeof fetch;
}
installFakeSamsara();

const db = getDb();
const sam = await seedUser("samsarasam", "Sam S");
await db.update(schema.profile).set({ truckVin: VIN }).where(eq(schema.profile.id, sam.profileId));
const samCtx = ctxFor(sam);
let samsaraConnId = 0;

describe("Samsara ELD connection — connect, live sync, revoke", () => {
  test("a bad-shape token connects nothing and stores nothing", async () => {
    const r = await Actions.connectEld.handler(samCtx, { provider: "samsara", token: "short", label: "Nope" });
    expect(r.ok).toBe(false);
    const rows = (await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "samsara")))
      .filter((c) => c.label === "Nope");
    expect(rows).toHaveLength(0);
  });

  test("a token Samsara refuses syncs nothing and records the refusal", async () => {
    const c = await Actions.connectEld.handler(samCtx, { provider: "samsara", token: "refused-token-999999", label: "Bad token" });
    expect(c.ok).toBe(true);
    const r = await Actions.syncEldNow.handler(samCtx, { connectionId: c.connectionId! });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Invalid API token");
    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, c.connectionId!));
    expect(snaps).toHaveLength(0);
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, c.connectionId!));
    expect(rows[0]!.lastError).toContain("Invalid API token");
    const revoked = await Actions.revokeEldConnection.handler(samCtx, { connectionId: c.connectionId! });
    expect(revoked.ok).toBe(true);
  });

  test("connect stores the token encrypted in the vault slot, feeds awaiting first sync", async () => {
    const r = await Actions.connectEld.handler(samCtx, { provider: "samsara", token: GOOD_TOKEN, label: "Fleet Samsara" });
    expect(r.ok).toBe(true);
    samsaraConnId = r.connectionId!;
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, samsaraConnId));
    const conn = rows[0]!;
    expect(conn.status).toBe("connected");
    expect(conn.tokenEnc).not.toBeNull();
    expect(conn.tokenEnc).not.toContain(GOOD_TOKEN);
    expect(conn.tokenLast4).toBe(GOOD_TOKEN.slice(-4));

    const hub = await Actions.getEldHub.handler(samCtx, {});
    const shown = hub.connections.find((c) => c.id === samsaraConnId)!;
    expect(shown.providerName).toBe("Samsara");
    expect(shown.tokenMasked).toBe(`••••••••${GOOD_TOKEN.slice(-4)}`);
    expect(shown.feeds.every((f) => f.state === "awaiting_first_sync")).toBe(true);
    expect(shown.feeds[0]!.detail).toContain("Sync now");
    expect(hub.syncStaged).toBe(false);
    const catalog = hub.providers.find((p) => p.key === "samsara")!;
    expect(catalog.state).toBe("available");
    expect(catalog.blurb).toContain("wired live");
    expect(catalog.feeds).toHaveLength(6);
  });

  test("syncEldNow pulls real feeds through the pipeline — official surfaces light up", async () => {
    const r = await Actions.syncEldNow.handler(samCtx, { connectionId: samsaraConnId });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(6);
    expect(r.rejected).toBe(0);
    expect(r.note).toContain("Live sync from Samsara");

    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, samsaraConnId));
    expect(snaps.map((s) => s.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    for (const s of snaps) {
      expect((JSON.parse(s.payloadJson) as { simulated?: unknown }).simulated).toBeUndefined();
    }
    const sealed = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_sync_received")))
      .filter((s) => s.payload.includes(`"connectionId":${samsaraConnId}`));
    expect(sealed).toHaveLength(1);
    expect(sealed[0]!.payload).toContain('"source":"provider"');
    expect(sealed[0]!.payload).toContain('"simulated":false');

    const hub = await Actions.getEldHub.handler(samCtx, {});
    // Samsara's OWN clocks are the official mirrored record here:
    // drive 10h / shift 12h remaining, exactly as the provider said.
    expect(hub.mirroredHos).not.toBeNull();
    expect(hub.mirroredHos!.providerName).toBe("Samsara");
    expect(hub.mirroredHos!.driveRemainH).toBe(10);
    expect(hub.mirroredHos!.windowRemainH).toBe(12);

    const identity = await Actions.getEldIdentity.handler(samCtx, {});
    expect(identity.identity?.provider).toBe("samsara");
    expect(identity.identity?.driver.name).toBe("Sam Driver");
    expect(identity.identity?.truck.vin).toBe(VIN);
    expect(identity.identity?.truck.unitNumber).toBe("8669");
    expect(identity.identity?.truck.odometerMi).toBeGreaterThan(455000);

    const now = new Date();
    const ifta = await Actions.getEldIftaReconciliation.handler(samCtx, {
      year: now.getFullYear(),
      quarter: Math.floor(now.getMonth() / 3) + 1,
    });
    const fl = ifta.rows.find((row) => row.state === "FL");
    expect(fl?.eldMiles).toBeCloseTo(200.1, 0);
  });

  test("revoke wipes the token", async () => {
    const r = await Actions.revokeEldConnection.handler(samCtx, { connectionId: samsaraConnId });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, samsaraConnId));
    expect(rows[0]!.status).toBe("revoked");
    expect(rows[0]!.tokenEnc).toBeNull();
    expect(rows[0]!.tokenLast4).toBeNull();
    expect(rows[0]!.providerAccount).toBeNull();
  });
});
