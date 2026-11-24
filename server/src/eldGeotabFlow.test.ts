// eldGeotabFlow.test.ts — INTEGRATION tests for the Geotab ELD
// connection (2026-11-24), run against the REAL action handlers over
// a throwaway migrated SQLite database, with globalThis.fetch stubbed
// to a fake MyGeotab (no network is ever touched):
//
//   connectEld verifies the MyGeotab login BEFORE storing anything
//   (a refused login connects nothing), stores the password in the
//   vault slot and the identifiers in provider_account; syncEldNow
//   pulls the fake provider's feeds through the REAL pipeline with
//   source "provider" — so the mirrored HOS clocks and the identity
//   log light up as OFFICIAL data (unlike the simulated harness,
//   whose snapshots official surfaces skip); the device is matched
//   by the truck profile's VIN; revoke wipes password AND account.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-eld-geotab-"));
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

// --- Fake MyGeotab -----------------------------------------------------

const VIN = "1XKYDP9X8PJ238669";
let authShouldFail = false;

function installFakeGeotab() {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
    const respond = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
    if (body.method === "Authenticate") {
      if (authShouldFail) {
        return respond({ error: { name: "InvalidUserException", message: "Incorrect user name or password." } });
      }
      return respond({
        result: {
          credentials: { database: "gastdb", sessionId: "sess-1", userName: "greg@gast.example" },
          path: "my123.geotab.com/",
        },
      });
    }
    const typeName = body.params.typeName as string;
    if (typeName === "Device") {
      return respond({
        result: [
          { id: "dev-other", name: "1111", vehicleIdentificationNumber: "1XKOTHER000000000" },
          { id: "dev-8669", name: "8669", vehicleIdentificationNumber: VIN, licensePlate: "AL-9" },
        ],
      });
    }
    if (typeName === "DutyStatusLog") {
      return respond({
        result: [
          { status: "OFF", dateTime: iso(12 * 3_600_000), driver: { id: "u1" } },
          { status: "ON", dateTime: iso(2 * 3_600_000), driver: { id: "u1" } },
          { status: "D", dateTime: iso(1 * 3_600_000), driver: { id: "u1" } },
        ],
      });
    }
    if (typeName === "DeviceStatusInfo") return respond({ result: [{ odometer: 732_646_000, latitude: 30.33, longitude: -81.65 }] });
    if (typeName === "DVIRLog") return respond({ result: [{ id: "dv1", dateTime: iso(1_800_000), isSafeToOperate: true, defects: [] }] });
    if (typeName === "FuelTaxDetail") return respond({ result: [{ stateProvince: "FL", distanceKm: 322 }] });
    if (typeName === "StatusData") return respond({ result: [{ data: 6291 }] });
    if (typeName === "User") return respond({ result: [{ id: "u1", name: "Greg Driver", licenseNumber: "R200", licenseProvince: "AL" }] });
    return respond({ result: [] });
  }) as typeof fetch;
}
installFakeGeotab();

const db = getDb();
const greg = await seedUser("geotabgreg", "Greg G");
await db.update(schema.profile).set({ truckVin: VIN }).where(eq(schema.profile.id, greg.profileId));
const gregCtx = ctxFor(greg);
let geotabConnId = 0;

describe("Geotab ELD connection — connect, live sync, revoke", () => {
  test("a refused MyGeotab login connects nothing and stores nothing", async () => {
    authShouldFail = true;
    const r = await Actions.connectEld.handler(gregCtx, {
      provider: "geotab",
      label: "Gast Geotab",
      geotab: { database: "gastdb", username: "greg@gast.example", password: "wrong-password" },
    });
    authShouldFail = false;
    expect(r.ok).toBe(false);
    expect(r.error).toContain("InvalidUserException");
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "geotab"));
    expect(rows).toHaveLength(0);
  });

  test("connect verifies the login, stores password in the vault slot + identifiers in provider_account", async () => {
    const r = await Actions.connectEld.handler(gregCtx, {
      provider: "geotab",
      label: "Gast Geotab",
      geotab: { server: "my.geotab.com", database: "gastdb", username: "greg@gast.example", password: "correct-horse-9" },
    });
    expect(r.ok).toBe(true);
    geotabConnId = r.connectionId!;
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.provider, "geotab"));
    expect(rows).toHaveLength(1);
    const conn = rows[0]!;
    expect(conn.status).toBe("connected");
    expect(conn.tokenEnc).not.toBeNull();
    expect(conn.tokenEnc).not.toContain("correct-horse-9");
    expect(conn.tokenLast4).toBe("se-9");
    // The session's resolved host is what got stored.
    expect(JSON.parse(conn.providerAccount!)).toEqual({ server: "my123.geotab.com", database: "gastdb", username: "greg@gast.example" });

    const hub = await Actions.getEldHub.handler(gregCtx, {});
    const shown = hub.connections.find((c) => c.id === geotabConnId)!;
    expect(shown.providerName).toBe("Geotab");
    expect(shown.accountNote).toContain("gastdb");
    expect(shown.tokenMasked).toBe("••••••••se-9");
    expect(shown.feeds.every((f) => f.state === "awaiting_first_sync")).toBe(true);
    expect(shown.feeds[0]!.detail).toContain("Sync now");
    const catalog = hub.providers.find((p) => p.key === "geotab")!;
    expect(catalog.state).toBe("available");
    expect(catalog.feeds).toHaveLength(6);
  });

  test("a second Geotab connect is refused while one is active", async () => {
    const r = await Actions.connectEld.handler(gregCtx, {
      provider: "geotab",
      label: "Duplicate",
      geotab: { database: "gastdb", username: "greg@gast.example", password: "correct-horse-9" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("already connected");
  });

  test("syncEldNow pulls real feeds through the pipeline — official surfaces light up", async () => {
    const r = await Actions.syncEldNow.handler(gregCtx, { connectionId: geotabConnId });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(6);
    expect(r.rejected).toBe(0);
    expect(r.note).toContain("Live sync from Geotab");

    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, geotabConnId));
    expect(snaps.map((s) => s.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    for (const s of snaps) {
      expect((JSON.parse(s.payloadJson) as { simulated?: unknown }).simulated).toBeUndefined();
    }
    const sealed = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_sync_received")))
      .filter((s) => s.payload.includes(`"connectionId":${geotabConnId}`));
    expect(sealed).toHaveLength(1);
    expect(sealed[0]!.payload).toContain('"source":"provider"');
    expect(sealed[0]!.payload).toContain('"simulated":false');

    const hub = await Actions.getEldHub.handler(gregCtx, {});
    // Real (non-simulated) clocks ARE the official mirrored record:
    // 10h rest, then 1h on-duty + 1h driving before `now`.
    expect(hub.mirroredHos).not.toBeNull();
    expect(hub.mirroredHos!.providerName).toBe("Geotab");
    expect(hub.mirroredHos!.driveRemainH).toBe(10);
    expect(hub.mirroredHos!.windowRemainH).toBe(12);

    const identity = await Actions.getEldIdentity.handler(gregCtx, {});
    expect(identity.identity?.provider).toBe("geotab");
    expect(identity.identity?.driver.name).toBe("Greg Driver");
    expect(identity.identity?.truck.vin).toBe(VIN);
    expect(identity.identity?.truck.unitNumber).toBe("8669");
    expect(identity.identity?.truck.odometerMi).toBeGreaterThan(455000);

    const now = new Date();
    const ifta = await Actions.getEldIftaReconciliation.handler(gregCtx, {
      year: now.getFullYear(),
      quarter: Math.floor(now.getMonth() / 3) + 1,
    });
    const fl = ifta.rows.find((row) => row.state === "FL");
    expect(fl?.eldMiles).toBeCloseTo(200.1, 0);
  });

  test("syncEldNow on a token provider is wired too — a Samsara-shaped refusal stores nothing", async () => {
    const c = await Actions.connectEld.handler(gregCtx, { provider: "samsara", token: "samsara-token-123456", label: "Sam" });
    expect(c.ok).toBe(true);
    // The stub in this file speaks MyGeotab JSON-RPC, not Samsara REST,
    // so the wired Samsara sync fails plainly against it — the point is
    // it no longer answers "only Geotab", and nothing is stored. (The
    // full Samsara sync is proven in eldSamsaraFlow.test.ts.)
    const r = await Actions.syncEldNow.handler(gregCtx, { connectionId: c.connectionId! });
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("only Geotab");
    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, c.connectionId!));
    expect(snaps).toHaveLength(0);
  });

  test("revoke wipes the password AND the account identifiers", async () => {
    const r = await Actions.revokeEldConnection.handler(gregCtx, { connectionId: geotabConnId });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.eldConnections).where(eq(schema.eldConnections.id, geotabConnId));
    expect(rows[0]!.status).toBe("revoked");
    expect(rows[0]!.tokenEnc).toBeNull();
    expect(rows[0]!.tokenLast4).toBeNull();
    expect(rows[0]!.providerAccount).toBeNull();
  });
});
