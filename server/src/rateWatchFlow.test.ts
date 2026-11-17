// rateWatchFlow.test.ts — INTEGRATION tests for getRateWatch
// (2026-11-17): the Pay door's Rate Watch — the week's published
// benchmarks ride along untouched, and the Stonervision Rate Index
// assembles from the caller's sealed loads only: 90-day window,
// equipment buckets, the 5-load honesty gate, deadhead excluded.
// Hermetic like the other flow tests: throwaway migrated SQLite DB.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-ratewatch-"));
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

async function seedUser(username: string, chatName: string, plan: string): Promise<SeededUser> {
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

const DAY = 86_400_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const dana = await seedUser("watchdana", "Dana D", "diamond");
const eli = await seedUser("watcheli", "Eli E", "basic");
const danaCtx = ctxFor(dana);
const eliCtx = ctxFor(eli);

// Dana — five flatbed loads sealed inside the window, each $3,000
// (rate 2,900 + 100 extras) over 1,000 loaded miles, WITH deadhead
// recorded: the index must still divide by loaded miles alone.
for (let i = 0; i < 5; i++) {
  const id = await seedLoad(dana, {
    shipper: `Shipper ${i}`,
    rate: 2900,
    extraCharges: 100,
    loadedMiles: 1000,
    deadheadMiles: 250,
    equipmentType: "flatbed",
  });
  await addChain("load", id, "pod_seal", { autoSealed: false }, iso(now - (i + 1) * DAY));
}
// Dana — one sealed load 100 days back: outside the 90-day window.
const oldId = await seedLoad(dana, { shipper: "Old Co", rate: 9000, loadedMiles: 3000, equipmentType: "reefer" });
await addChain("load", oldId, "pod_seal", { autoSealed: false }, iso(now - 100 * DAY));
// Dana — one load never sealed: invisible to the index.
await seedLoad(dana, { shipper: "Rolling Co", rate: 5000, loadedMiles: 2000, status: "En route", equipmentType: "dry_van" });

// Eli — three sealed loads: under the gate, the index is building.
for (let i = 0; i < 3; i++) {
  const id = await seedLoad(eli, { shipper: `Small ${i}`, rate: 2000, loadedMiles: 800, equipmentType: "dry_van" });
  await addChain("load", id, "pod_seal", { autoSealed: false }, iso(now - (i + 1) * DAY));
}

describe("getRateWatch", () => {
  test("the benchmarks ride along exactly as seeded for Week 45", async () => {
    const r = await Actions.getRateWatch.handler(danaCtx, {});
    expect(r.benchmarks.weekLabel).toBe("Week 45");
    expect(r.benchmarks.totalSpotPerMile).toBe(3.16);
    expect(r.benchmarks.source).toContain("Truckstop.com / FTR");
    expect(r.benchmarks.rows).toHaveLength(3);
    expect(r.note).toContain("not a quote");
  });

  test("five sealed loads clear the gate: overall + flatbed bucket, deadhead excluded", async () => {
    const r = await Actions.getRateWatch.handler(danaCtx, {});
    expect(r.index.hasIndex).toBe(true);
    expect(r.index.sealedLoadCount).toBe(5); // the 100-day-old seal and the unsealed load are out
    expect(r.index.countedLoadCount).toBe(5);
    expect(r.index.overall?.rpm).toBe(3); // 15,000 over 5,000 LOADED miles — the 250/load deadhead never enters
    expect(r.index.byEquipment).toEqual([{ equipment: "flatbed", label: "Flatbed", loadCount: 5, rpm: 3 }]);
    expect(r.index.windowDays).toBe(90);
    expect(r.index.minLoads).toBe(5);
  });

  test("three sealed loads read as the honest building state — count, no rate", async () => {
    const r = await Actions.getRateWatch.handler(eliCtx, {});
    expect(r.index.hasIndex).toBe(false);
    expect(r.index.overall).toBe(null);
    expect(r.index.byEquipment).toEqual([]);
    expect(r.index.sealedLoadCount).toBe(3);
  });
});
