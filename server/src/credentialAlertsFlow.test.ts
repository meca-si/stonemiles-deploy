// credentialAlertsFlow.test.ts — INTEGRATION tests for credential
// expiry alerts (TMS queue item 1, migration 0125), run against the
// REAL action handlers over a throwaway migrated SQLite database:
//
//   (a) CDL + medical dates come from the driver's existing document
//       vault rows and TWIC from the profile — no parallel store;
//       alerts fire at the 60 / 30 / 7 thresholds and when expired
//   (b) dismissal is stateful per threshold: dismissing silences that
//       threshold's nag on every later read, the status still reports
//       the fact, and a repeat dismissal is a harmless no-op
//   (c) a dismissal against a stale threshold is refused (the alert
//       has moved on), and dismissing a credential with no date on
//       file is refused
//   (d) renewal re-arms: once the old card's row is replaced, the old
//       dismissal (keyed to the old expiry date) no longer applies
//   (e) isolation: another driver sees none of these alerts and
//       cannot dismiss against credentials they don't hold
//
// Pure-rule coverage lives in credentialAlerts.test.ts.
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-credalerts-"));
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

const DAY = 86400000;
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const dateIn = (days: number) => isoIn(days).slice(0, 10);

const alice = await seedUser("credalice", "Alice A");
const bob = await seedUser("credbob", "Bob B");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

// Alice's vault: medical card 20 days out (30-band), CDL 45 days out
// (60-band). TWIC on her profile: 5 days out (7-band).
const medSave = await Actions.savePersonalDoc.handler(aliceCtx, {
  kind: "medical",
  label: "Medical card",
  expiresAt: isoIn(20),
  docNumberLast4: null,
  notes: null,
  dataBase64: null,
  mime: null,
});
const cdlSave = await Actions.savePersonalDoc.handler(aliceCtx, {
  kind: "cdl",
  label: "CDL",
  expiresAt: isoIn(45),
  docNumberLast4: null,
  notes: null,
  dataBase64: null,
  mime: null,
});
await getDb()
  .update(schema.socialUsers)
  .set({ twicHas: true, twicExpires: dateIn(5) })
  .where(eq(schema.socialUsers.username, alice.username));

describe("credential alerts — sources + thresholds", () => {
  test("setup saved", () => {
    expect(medSave.error).toBeNull();
    expect(cdlSave.error).toBeNull();
  });

  test("all three credentials alert at their own thresholds", async () => {
    const r = await Actions.getCredentialAlerts.handler(aliceCtx, {});
    const byKey = new Map(r.credentials.map((c) => [c.key, c]));
    expect(byKey.get("medical")!.threshold).toBe(30);
    expect(byKey.get("cdl")!.threshold).toBe(60);
    expect(byKey.get("twic")!.threshold).toBe(7);
    expect(byKey.get("twic")!.expiresOn).toBe(dateIn(5));
    expect(r.alerts.map((a) => a.key).sort()).toEqual(["cdl", "medical", "twic"]);
    // Soonest first: TWIC (5d) leads the nag list.
    expect(r.alerts[0]!.key).toBe("twic");
  });

  test("a driver with nothing on file gets no alerts and no thresholds", async () => {
    const r = await Actions.getCredentialAlerts.handler(bobCtx, {});
    expect(r.alerts).toEqual([]);
    expect(r.credentials.every((c) => c.threshold == null && c.expiresOn == null)).toBe(true);
  });
});

describe("credential alerts — dismissal is stateful per threshold", () => {
  test("dismissing the medical 30-day alert silences it on every later read; the fact remains", async () => {
    const d = await Actions.dismissCredentialAlert.handler(aliceCtx, { credentialKey: "medical", threshold: 30 });
    expect(d).toEqual({ ok: true, error: null });
    for (let i = 0; i < 3; i++) {
      const r = await Actions.getCredentialAlerts.handler(aliceCtx, {});
      expect(r.alerts.some((a) => a.key === "medical")).toBe(false);
      const med = r.credentials.find((c) => c.key === "medical")!;
      expect(med.threshold).toBe(30); // still in the 30-day window — reported, not hidden
      expect(med.dismissed).toBe(true);
    }
    // The other credentials' alerts are untouched.
    const r = await Actions.getCredentialAlerts.handler(aliceCtx, {});
    expect(r.alerts.map((a) => a.key).sort()).toEqual(["cdl", "twic"]);
  });

  test("a repeat dismissal is a harmless no-op", async () => {
    const d = await Actions.dismissCredentialAlert.handler(aliceCtx, { credentialKey: "medical", threshold: 30 });
    expect(d.ok).toBe(true);
    const rows = await getDb()
      .select()
      .from(schema.credentialAlertDismissals)
      .where(eq(schema.credentialAlertDismissals.username, alice.username));
    expect(rows.length).toBe(1);
  });

  test("dismissing a stale or un-crossed threshold is refused", async () => {
    // CDL is in the 60 band; a 30 dismissal names a threshold that
    // isn't the live alert.
    const stale = await Actions.dismissCredentialAlert.handler(aliceCtx, { credentialKey: "cdl", threshold: 30 });
    expect(stale.ok).toBe(false);
    // Bob holds no credentials at all.
    const none = await Actions.dismissCredentialAlert.handler(bobCtx, { credentialKey: "medical", threshold: 30 });
    expect(none.ok).toBe(false);
  });

  test("isolation: Bob cannot see or affect Alice's alerts", async () => {
    const r = await Actions.getCredentialAlerts.handler(bobCtx, {});
    expect(r.alerts).toEqual([]);
    const rows = await getDb()
      .select()
      .from(schema.credentialAlertDismissals)
      .where(eq(schema.credentialAlertDismissals.username, bob.username));
    expect(rows.length).toBe(0);
  });
});

describe("credential alerts — renewal re-arms", () => {
  test("replacing the medical card re-arms its alerts (old dismissal was keyed to the old date)", async () => {
    // Retire the old card row and file the renewed one (25 days out —
    // still the 30 band, but a different expiry date).
    await Actions.deletePersonalDoc.handler(aliceCtx, { id: medSave.id });
    const renewed = await Actions.savePersonalDoc.handler(aliceCtx, {
      kind: "medical",
      label: "Medical card",
      expiresAt: isoIn(25),
      docNumberLast4: null,
      notes: null,
      dataBase64: null,
      mime: null,
    });
    expect(renewed.error).toBeNull();
    const r = await Actions.getCredentialAlerts.handler(aliceCtx, {});
    const med = r.credentials.find((c) => c.key === "medical")!;
    expect(med.threshold).toBe(30);
    expect(med.dismissed).toBe(false);
    expect(r.alerts.some((a) => a.key === "medical")).toBe(true);
  });

  test("an expired credential alerts at threshold 0", async () => {
    await Actions.savePersonalDoc.handler(bobCtx, {
      kind: "cdl",
      label: "CDL",
      expiresAt: isoIn(-3),
      docNumberLast4: null,
      notes: null,
      dataBase64: null,
      mime: null,
    });
    const r = await Actions.getCredentialAlerts.handler(bobCtx, {});
    const cdl = r.credentials.find((c) => c.key === "cdl")!;
    expect(cdl.threshold).toBe(0);
    expect(cdl.daysLeft).toBeLessThan(0);
    expect(r.alerts.some((a) => a.key === "cdl" && a.threshold === 0)).toBe(true);
  });
});
