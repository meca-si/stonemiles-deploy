// eldMotiveFlow.test.ts — INTEGRATION tests for the Motive ELD
// connection (2026-11-24), run against the REAL action handlers over
// a throwaway migrated SQLite database, with globalThis.fetch stubbed
// to a fake Motive REST API (no network is ever touched):
//
//   connectEld stores the API key encrypted in the vault slot (a
//   bad-shape key stores nothing); syncEldNow pulls the fake
//   provider's feeds through the REAL pipeline with source "provider"
//   — so the mirrored HOS clocks and the identity log light up as
//   OFFICIAL data; a key Motive refuses syncs nothing and records the
//   refusal; the vehicle is matched by the truck profile's VIN;
//   revoke wipes the key. Mirrors eldGeotabFlow.test.ts.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-eld-motive-"));
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

// --- Fake Motive ------------------------------------------------------------

const VIN = "1XKYDP9X8PJ238669";
const GOOD_KEY = "motive-good-key-123456";

function installFakeMotive() {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  globalThis.fetch = (async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
    const respond = (status: number, payload: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
    if (init.headers?.["X-Api-Key"] !== GOOD_KEY) {
      return respond(401, { error_message: "Invalid API key" });
    }
    const p = new URL(url).pathname;
    if (p === "/v1/vehicles") {
      return respond(200, {
        vehicles: [
          { vehicle: { id: 41, number: "1111", vin: "1XKOTHER000000000" } },
          { vehicle: { id: 42, number: "8669", vin: VIN, license_plate_number: "P1357517", make: "Kenworth", model: "T680", year: 2023, current_driver: { id: 7 } } },
        ],
      });
    }
    if (p === "/v1/users") {
      return respond(200, { users: [{ user: { id: 7, first_name: "Mo", last_name: "Driver", license_number: "R200", license_state: "AL" } }] });
    }
    if (p === "/v1/logs") {
      return respond(200, {
        logs: [
          { log: { id: 1, user_id: 7, vehicle_id: 42, duty_status: "off_duty", start_time: iso(12 * 3_600_000), end_time: iso(2 * 3_600_000), location: "Jacksonville, FL" } },
          { log: { id: 2, user_id: 7, vehicle_id: 42, duty_status: "on_duty", start_time: iso(2 * 3_600_000), end_time: iso(1 * 3_600_000) } },
          { log: { id: 3, user_id: 7, vehicle_id: 42, duty_status: "driving", start_time: iso(1 * 3_600_000), end_time: iso(0) } },
        ],
      });
    }
    if (p === "/v1/available_time") {
      return respond(200, { users: [{ user: { id: 7 }, available_time: { drive: 36000, shift: 43200, cycle: 244800, break: 25200 } }] });
    }
    if (p === "/v1/vehicle_locations") {
      return respond(200, {
        vehicle_locations: [
          { vehicle_location: { vehicle_id: 42, current_location: { lat: 30.33, lon: -81.65, located_at: iso(0) }, odometer: 455404.9 } },
        ],
      });
    }
    if (p === "/v1/inspection_reports") {
      return respond(200, {
        inspection_reports: [
          { inspection_report: { id: 5, vehicle_id: 42, inspection_type: "pre_trip", created_at: iso(1_800_000), status: "satisfactory", defects: [] } },
        ],
      });
    }
    if (p === "/v1/ifta/trips") {
      return respond(200, { trips: [{ trip: { id: 1, vehicle_id: 42, jurisdictions: [{ jurisdiction: "FL", miles: 200.1 }] } }] });
    }
    if (p === "/v1/ifta/summary") return respond(200, { summaries: [] });
    return respond(200, {});
  }) as typeof fetch;
}
installFakeMotive();

const db = getDb();
const mo = await seedUser("motivemo", "Mo M");
await db.update(schema.profile).set({ truckVin: VIN }).where(eq(schema.profile.id, mo.profileId));
const moCtx = ctxFor(mo);
let motiveConnId = 0;

describe("Motive ELD connection — connect, live sync, revoke", () => {
  test("a bad-shape key connects nothing and stores nothing", async () => {
    const r = await Actions.connectEld.handler(moCtx, { provider: "motive", token: "short", label: "Nope" });
    expect(r.ok).toBe(false);
    const rows = (await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "motive")))
      .filter((c) => c.label === "Nope");
    expect(rows).toHaveLength(0);
  });

  test("a key Motive refuses syncs nothing and records the refusal", async () => {
    const c = await Actions.connectEld.handler(moCtx, { provider: "motive", token: "refused-key-999999", label: "Bad key" });
    expect(c.ok).toBe(true);
    const r = await Actions.syncEldNow.handler(moCtx, { connectionId: c.connectionId! });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Invalid API key");
    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, c.connectionId!));
    expect(snaps).toHaveLength(0);
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, c.connectionId!));
    expect(rows[0]!.lastError).toContain("Invalid API key");
    const revoked = await Actions.revokeEldConnection.handler(moCtx, { connectionId: c.connectionId! });
    expect(revoked.ok).toBe(true);
  });

  test("connect stores the key encrypted in the vault slot, feeds awaiting first sync", async () => {
    const r = await Actions.connectEld.handler(moCtx, { provider: "motive", token: GOOD_KEY, label: "Fleet Motive" });
    expect(r.ok).toBe(true);
    motiveConnId = r.connectionId!;
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, motiveConnId));
    const conn = rows[0]!;
    expect(conn.status).toBe("connected");
    expect(conn.tokenEnc).not.toBeNull();
    expect(conn.tokenEnc).not.toContain(GOOD_KEY);
    expect(conn.tokenLast4).toBe(GOOD_KEY.slice(-4));

    const hub = await Actions.getEldHub.handler(moCtx, {});
    const shown = hub.connections.find((c) => c.id === motiveConnId)!;
    expect(shown.providerName).toBe("Motive");
    expect(shown.tokenMasked).toBe(`••••••••${GOOD_KEY.slice(-4)}`);
    expect(shown.feeds.every((f) => f.state === "awaiting_first_sync")).toBe(true);
    expect(shown.feeds[0]!.detail).toContain("Sync now");
    const catalog = hub.providers.find((p) => p.key === "motive")!;
    expect(catalog.state).toBe("available");
    expect(catalog.blurb).toContain("wired live");
    expect(catalog.feeds).toHaveLength(6);
  });

  test("syncEldNow pulls real feeds through the pipeline — official surfaces light up", async () => {
    const r = await Actions.syncEldNow.handler(moCtx, { connectionId: motiveConnId });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(6);
    expect(r.rejected).toBe(0);
    expect(r.note).toContain("Live sync from Motive");

    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, motiveConnId));
    expect(snaps.map((s) => s.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    for (const s of snaps) {
      expect((JSON.parse(s.payloadJson) as { simulated?: unknown }).simulated).toBeUndefined();
    }
    const sealed = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_sync_received")))
      .filter((s) => s.payload.includes(`"connectionId":${motiveConnId}`));
    expect(sealed).toHaveLength(1);
    expect(sealed[0]!.payload).toContain('"source":"provider"');
    expect(sealed[0]!.payload).toContain('"simulated":false');

    const hub = await Actions.getEldHub.handler(moCtx, {});
    // Motive's OWN availability clocks are the official mirrored
    // record here: drive 10h / shift 12h remaining, as reported.
    expect(hub.mirroredHos).not.toBeNull();
    expect(hub.mirroredHos!.providerName).toBe("Motive");
    expect(hub.mirroredHos!.driveRemainH).toBe(10);
    expect(hub.mirroredHos!.windowRemainH).toBe(12);

    const identity = await Actions.getEldIdentity.handler(moCtx, {});
    expect(identity.identity?.provider).toBe("motive");
    expect(identity.identity?.driver.name).toBe("Mo Driver");
    expect(identity.identity?.truck.vin).toBe(VIN);
    expect(identity.identity?.truck.unitNumber).toBe("8669");
    expect(identity.identity?.truck.odometerMi).toBeCloseTo(455404.9, 1);

    const now = new Date();
    const ifta = await Actions.getEldIftaReconciliation.handler(moCtx, {
      year: now.getFullYear(),
      quarter: Math.floor(now.getMonth() / 3) + 1,
    });
    const fl = ifta.rows.find((row) => row.state === "FL");
    expect(fl?.eldMiles).toBeCloseTo(200.1, 0);
  });

  test("revoke wipes the key", async () => {
    const r = await Actions.revokeEldConnection.handler(moCtx, { connectionId: motiveConnId });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, motiveConnId));
    expect(rows[0]!.status).toBe("revoked");
    expect(rows[0]!.tokenEnc).toBeNull();
    expect(rows[0]!.tokenLast4).toBeNull();
    expect(rows[0]!.providerAccount).toBeNull();
  });
});
