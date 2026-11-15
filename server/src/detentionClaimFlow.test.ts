// detentionClaimFlow.test.ts — INTEGRATION tests for the
// detention collection pack (Research Wave 2 item 5), run against
// the REAL action handlers over a throwaway migrated SQLite
// database:
//
//   terms recorded on the load (driver-entered, chain-sealed) →
//   pack generation prices from them, moves the claim to
//   "generated" exactly once, and seals → the pack resolves
//   through the Library doors as a PDF for the owner and is
//   refused for anyone else → send goes through the document
//   email path (capturing stub) and advances the claim to "sent"
//   only when the mail actually goes out → lifecycle moves are
//   order-enforced and sealed → a load with no terms packs with
//   amountCents null → facility stats aggregate the driver's own
//   sealed visits with the 3-visit score gate.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-detclaim-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { privileged } = await import("../.generated/privileged.contract");
const { eq } = await import("drizzle-orm");

type CtxT = Ctx;

// Capturing mail transport: configured, records every send.
const sentMail: { to: string; subject: string }[] = [];
const privStub = async (contract: unknown, args: never) => {
  if (contract === privileged.docEmailConfig) {
    return { configured: true, from: "docs@test.local" };
  }
  if (contract === privileged.sendDocEmail) {
    const a = args as { to: string; subject: string };
    sentMail.push({ to: a.to, subject: a.subject });
    return { ok: true, notConfigured: false, status: 200, providerId: "test-provider-1", errorMessage: null };
  }
  return { ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null };
};

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
const alice = await seedUser("claimalice", "Alice A");
const bob = await seedUser("claimbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

// Alice's delivered load + a closed, sealed detention visit on it:
// 4.5 h at the facility, 2 h free → 150 min beyond free time.
const loadIns = await db
  .insert(schema.loads)
  .values({
    profileId: alice.profileId,
    status: "delivered",
    pickupCity: "Fort Worth",
    pickupState: "TX",
    deliveryCity: "Dallas",
    deliveryState: "TX",
    referenceNumber: "REF-1042",
    brokerName: "Sam Broker",
    brokerCompany: "Broker Co",
    brokerMc: "MC123456",
  })
  .returning({ id: schema.loads.id });
const loadId = loadIns[0]!.id;

async function seedVisit(arrived: string, departed: string, placeLabel = "Test Facility — Dallas, TX"): Promise<number> {
  const ins = await db
    .insert(schema.detentionRecords)
    .values({
      profileId: alice.profileId,
      loadId,
      site: "delivery",
      placeLabel,
      graceMinutes: 120,
      arrivedAt: new Date(arrived),
      departedAt: new Date(departed),
      arriveLat: 32.7767,
      arriveLon: -96.797,
      departLat: 32.7768,
      departLon: -96.7971,
      chainHash: "seal-test-1",
    })
    .returning({ id: schema.detentionRecords.id });
  return ins[0]!.id;
}

const visitId = await seedVisit("2026-11-10T13:00:00.000Z", "2026-11-10T17:30:00.000Z");

describe("detention collection pack (item 5)", () => {
  test("terms record on the load, driver-entered and sealed", async () => {
    const r = await Actions.setLoadDetentionTerms.handler(aliceCtx, { loadId, ratePerHour: 65 });
    expect(r.ok).toBe(true);
    const loads = await db.select().from(schema.loads).where(eq(schema.loads.id, loadId));
    expect(loads[0]?.detentionRatePerHour).toBe(65);
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "detention_terms_recorded"));
    expect(seals).toHaveLength(1);
    // Bob can't set terms on a load that isn't his (host scope).
    const b = await Actions.setLoadDetentionTerms.handler(bobCtx, { loadId, ratePerHour: 10 });
    expect(b.ok).toBe(false);
  });

  test("pack generation prices from the recorded terms and seals the transition once", async () => {
    const r = await Actions.getDetentionClaimPack.handler(aliceCtx, { id: visitId });
    expect(r.ok).toBe(true);
    expect(r.amountCents).toBe(16250); // 150 min = 2.5 h × $65
    expect(r.claimStatus).toBe("generated");
    expect(r.text).toContain("driver's recorded terms");
    const again = await Actions.getDetentionClaimPack.handler(aliceCtx, { id: visitId });
    expect(again.ok).toBe(true);
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "detention_claim_generated"));
    expect(seals).toHaveLength(1);
    const rows = await db.select().from(schema.detentionRecords).where(eq(schema.detentionRecords.id, visitId));
    expect(rows[0]?.claimStatus).toBe("generated");
    expect(rows[0]?.claimGeneratedAt).not.toBeNull();
  });

  test("the pack resolves through the Library doors for the owner — and only the owner", async () => {
    const doc = await Actions.getLibraryDocument.handler(aliceCtx, { ref: `detention-claim:${visitId}` });
    expect(doc.ok).toBe(true);
    expect(doc.filename).toBe(`detention-claim-${visitId}.pdf`);
    expect(doc.dataBase64).toBeTruthy();
    const other = await Actions.getLibraryDocument.handler(bobCtx, { ref: `detention-claim:${visitId}` });
    expect(other.ok).toBe(false);
  });

  test("lifecycle order is enforced before the send", async () => {
    const early = await Actions.setDetentionClaimStatus.handler(aliceCtx, { id: visitId, status: "paid" });
    expect(early.ok).toBe(false);
    expect(early.claimStatus).toBe("generated");
  });

  test("send goes through the document email path and advances the claim to sent", async () => {
    const r = await Actions.sendDetentionClaimPack.handler(aliceCtx, { id: visitId, toEmail: "ap@broker.example" });
    expect(r.ok).toBe(true);
    expect(r.sendStatus).toBe("sent");
    expect(r.claimStatus).toBe("sent");
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]?.to).toBe("ap@broker.example");
    const sends = await db.select().from(schema.documentSends).where(eq(schema.documentSends.docKind, "detention_claim"));
    expect(sends).toHaveLength(1);
    expect(sends[0]?.status).toBe("sent");
    const rows = await db.select().from(schema.detentionRecords).where(eq(schema.detentionRecords.id, visitId));
    expect(rows[0]?.claimStatus).toBe("sent");
    expect(rows[0]?.claimRecipient).toBe("ap@broker.example");
    expect(rows[0]?.claimSentAt).not.toBeNull();
    // A claim isn't sent twice.
    const twice = await Actions.sendDetentionClaimPack.handler(aliceCtx, { id: visitId, toEmail: "ap@broker.example" });
    expect(twice.ok).toBe(false);
    expect(sentMail).toHaveLength(1);
  });

  test("sent → acknowledged → paid, each sealed", async () => {
    const a = await Actions.setDetentionClaimStatus.handler(aliceCtx, { id: visitId, status: "acknowledged" });
    expect(a.ok).toBe(true);
    const p = await Actions.setDetentionClaimStatus.handler(aliceCtx, { id: visitId, status: "paid" });
    expect(p.ok).toBe(true);
    expect(p.claimStatus).toBe("paid");
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "detention_claim_status"));
    expect(seals).toHaveLength(2);
    const back = await Actions.setDetentionClaimStatus.handler(aliceCtx, { id: visitId, status: "disputed" });
    expect(back.ok).toBe(false);
  });

  test("listDetention carries the claim state and the load's terms", async () => {
    const r = await Actions.listDetention.handler(aliceCtx, { limit: 30 });
    const rec = r.records.find((x) => x.id === visitId);
    expect(rec?.claimStatus).toBe("paid");
    expect(rec?.claimRecipient).toBe("ap@broker.example");
    expect(rec?.detentionRatePerHour).toBe(65);
  });

  test("a load with no terms packs with a blank amount", async () => {
    const cleared = await Actions.setLoadDetentionTerms.handler(aliceCtx, { loadId, ratePerHour: null });
    expect(cleared.ok).toBe(true);
    const v2 = await seedVisit("2026-11-12T13:00:00.000Z", "2026-11-12T17:30:00.000Z");
    const r = await Actions.getDetentionClaimPack.handler(aliceCtx, { id: v2 });
    expect(r.ok).toBe(true);
    expect(r.amountCents).toBeNull();
    expect(r.text).toContain("Detention claimed: __________");
    expect(r.text).not.toMatch(/Detention claimed: \$/);
  });

  test("facility stats aggregate Alice's sealed visits with the 3-visit gate", async () => {
    const v3 = await seedVisit("2026-11-13T13:00:00.000Z", "2026-11-13T16:00:00.000Z");
    void v3;
    const r = await Actions.getFacilityDetentionStats.handler(aliceCtx, {});
    expect(r.facilities).toHaveLength(1);
    const f = r.facilities[0]!;
    expect(f.placeLabel).toBe("Test Facility — Dallas, TX");
    expect(f.visits).toBe(3);
    expect(f.detainedCount).toBe(3);
    expect(f.scoreEligible).toBe(true);
    // Bob has no sealed visits of his own.
    const b = await Actions.getFacilityDetentionStats.handler(bobCtx, {});
    expect(b.facilities).toHaveLength(0);
  });
});
