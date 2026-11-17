// payRpmFlow.test.ts — INTEGRATION tests for the 2026-11-17 builds:
//   (a) getPayRpm — the Pay door's revenue-per-mile over the caller's
//       loads sealed in the last 30 days (pure math in payRpm.ts;
//       here: scoping, window, and the sealed-load assembly).
//   (b) extractLoadFromText — the deterministic rate-con text read:
//       a Diamond (Gold+) caller gets the parsed fields; a Basic
//       caller gets the locked shape and manual entry stays the path.
// Hermetic like the other flow tests: throwaway migrated SQLite DB.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-payrpm-"));
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

const carol = await seedUser("rpmcarol", "Carol C", "diamond");
const basic = await seedUser("rpmbasic", "Basic B", "basic");
const carolCtx = ctxFor(carol);
const basicCtx = ctxFor(basic);

// Carol L1 — sealed 2 days ago: rate 2400 + 100 extras over 1000 mi.
const l1 = await seedLoad(carol, { shipper: "Acme", rate: 2400, extraCharges: 100, loadedMiles: 1000 });
await addChain("load", l1, "pod_seal", { autoSealed: false }, iso(now - 2 * DAY));
// Carol L2 — sealed 5 days ago: rate 1200, NO miles recorded (skipped + counted).
const l2 = await seedLoad(carol, { shipper: "No Miles Co", rate: 1200, loadedMiles: null });
await addChain("load", l2, "pod_seal", { autoSealed: false }, iso(now - 5 * DAY));
// Carol L3 — sealed 45 days ago: outside the window entirely.
const l3 = await seedLoad(carol, { shipper: "Old Co", rate: 9000, loadedMiles: 3000 });
await addChain("load", l3, "pod_seal", { autoSealed: false }, iso(now - 45 * DAY));
// Carol L4 — never sealed.
await seedLoad(carol, { shipper: "Rolling Co", rate: 5000, loadedMiles: 2000, status: "En route" });

const RATE_CON_TEXT = `
RATE CONFIRMATION
Broker: Blue Peak Logistics LLC
MC#: 1234567
Load #: 884120
Shipper
Acme Steel Co
1200 Industrial Pkwy
Mobile, AL 36608
Pickup Date: 11/20/2026 08:00 AM
Delivery
4400 Port Rd
Houston, TX 77032
Delivery Date: 11/22/2026
Commodity: Steel coils
Weight: 42,500 lbs
Loaded Miles: 512
Linehaul Rate: $2,450.00
Total Pay: $2,450.00
`;

describe("getPayRpm", () => {
  test("counts only the caller's in-window sealed loads with miles", async () => {
    const r = await Actions.getPayRpm.handler(carolCtx, {});
    expect(r.hasData).toBe(true);
    expect(r.rpm).toBe(2.5);
    expect(r.revenue).toBe(2500);
    expect(r.miles).toBe(1000);
    expect(r.loadCount).toBe(1);
    expect(r.loadsSkippedNoMiles).toBe(1);
    expect(r.windowDays).toBe(30);
  });

  test("a caller with no sealed loads reads an honest empty figure", async () => {
    const r = await Actions.getPayRpm.handler(basicCtx, {});
    expect(r.hasData).toBe(false);
    expect(r.rpm).toBe(null);
    expect(r.loadCount).toBe(0);
  });
});

describe("extractLoadFromText", () => {
  test("a Gold+ caller gets the deterministic read of the printed text", async () => {
    const r = await Actions.extractLoadFromText.handler(carolCtx, { text: RATE_CON_TEXT });
    expect(r.locked).toBe(false);
    expect(r.found).toBe(true);
    expect(r.source).toBe("pdf_text");
    expect(r.docKind).toBe("rate_con");
    expect(r.brokerCompany).toBe("Blue Peak Logistics LLC");
    expect(r.brokerMc).toBe("1234567");
    expect(r.loadNumber).toBe("884120");
    expect(r.pickupCity).toBe("Mobile");
    expect(r.deliveryCity).toBe("Houston");
    expect(r.rate).toBe(2450);
    expect(r.miles).toBe(512);
    expect(r.weightLbs).toBe(42500);
    expect(r.commodity).toBe("Steel coils");
    expect(r.sealNumber).toBe(null);
  });

  test("a Basic caller is locked out of the read (manual entry stays the path)", async () => {
    const r = await Actions.extractLoadFromText.handler(basicCtx, { text: RATE_CON_TEXT });
    expect(r.locked).toBe(true);
    expect(r.found).toBe(false);
    expect(r.rate).toBe(null);
  });
});
