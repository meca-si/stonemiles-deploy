// pointsLayer2Flow.test.ts — INTEGRATION tests for SM Points
// Rewards Layer 2 + the anti-cheat safety net (locked by x,
// 2026-11-15), run against the REAL action handlers over a
// throwaway migrated SQLite database:
//
//   Birthday — month + day save together, an impossible day is
//     refused, and a birth YEAR is structurally impossible to store
//     (the profile table has no such column); the birthday drop pays.
//   Gate — a Basic-plan driver earns no Layer 2 points.
//   Safety net (maintenance) — an in-window, receipt-backed entry
//     pays once; a near-duplicate copy earns zero; an out-of-window
//     entry earns zero; a no-receipt entry earns zero; entries whose
//     odometer contradicts the sealed record earn zero AND open an
//     owner-visible hold; while the hold is open a clean new entry
//     WITHHOLDS; the owner lists and clears the hold and the
//     withheld award lands. Nothing auto-bans, nothing forfeits.
//   Referral ladder — pays at 5 ACTIVE referrals only: a settled
//     reward with almost no usage doesn't count, a clawed-back
//     referral doesn't count, raw signups never count.
//   Renewal streak — six settled monthly payments pay the 6-month
//     rung; reversing one payment (a refund) breaks the streak and
//     the next read claws the award back.
//   Rig record — the complete set-up pays once.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-layer2-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { eq, getTableColumns } = await import("drizzle-orm");

type CtxT = Ctx;

const privStub = async () => ({
  ok: false,
  status: "not_configured",
  notConfigured: true,
  providerId: null,
  errorMessage: null,
  detail: "test stub",
  id: null,
});

interface SeededUser {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
}

async function seedUser(username: string, plan = "diamond"): Promise<SeededUser> {
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
      plan,
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 7,
      dieselPrice: 4,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser, isOwner = false): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: {
      accountId: u.accountId,
      profileId: u.profileId,
      username: u.username,
      email: u.email,
      isOwner,
      status: "active",
      totpPending: false,
      hasTeamSeat: false,
      sessionId: 1,
    },
  }).ctx as unknown as CtxT;
}

const getPoints = (u: SeededUser) => Actions.getPoints.handler(ctxFor(u), {});

async function layer2Rows(username: string, source?: string) {
  const rows = await getDb()
    .select()
    .from(schema.pointsLog)
    .where(eq(schema.pointsLog.username, username));
  const l2 = rows.filter((r) => r.source.startsWith("layer2_"));
  return source ? l2.filter((r) => r.source === source) : l2;
}

/** Today's month/day in the app's home timezone (America/Chicago). */
function todayMonthDay(): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  return {
    month: Number(parts.find((p) => p.type === "month")!.value),
    day: Number(parts.find((p) => p.type === "day")!.value),
  };
}

// ---- Birthday ------------------------------------------------------------------

describe("Layer 2 — birthday (month + day only, never a year)", () => {
  test("the profile table has no birth-year column to store", () => {
    const cols = Object.keys(getTableColumns(schema.profile));
    expect(cols).toContain("birthMonth");
    expect(cols).toContain("birthDay");
    expect(cols.filter((c) => /birth/i.test(c)).sort()).toEqual(["birthDay", "birthMonth"]);
  });

  test("month without day is refused; an impossible day is refused; a real pair saves and pays", async () => {
    const u = await seedUser("l2bday");
    const gp = await Actions.getProfile.handler(ctxFor(u), {});
    const { pinSet: _pinSet, ...base } = gp.profile!;
    await expect(
      Actions.saveProfile.handler(ctxFor(u), { ...base, birthMonth: 6, birthDay: null }),
    ).rejects.toThrow();
    await expect(
      Actions.saveProfile.handler(ctxFor(u), { ...base, birthMonth: 2, birthDay: 30 }),
    ).rejects.toThrow();
    const { month, day } = todayMonthDay();
    await Actions.saveProfile.handler(ctxFor(u), { ...base, birthMonth: month, birthDay: day });
    const after = await Actions.getProfile.handler(ctxFor(u), {});
    expect(after.profile!.birthMonth).toBe(month);
    expect(after.profile!.birthDay).toBe(day);
    const res = await getPoints(u);
    const rows = await layer2Rows(u.username, "layer2_birthday");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(100);
    expect(res.layer2.total).toBeGreaterThanOrEqual(100);
    expect(res.history.some((h) => h.lane === "layer2")).toBe(true);
    // Idempotent: a second read pays nothing new.
    await getPoints(u);
    expect((await layer2Rows(u.username, "layer2_birthday")).length).toBe(1);
  });

  test("gate: a Basic-plan driver earns no Layer 2 points", async () => {
    const u = await seedUser("l2basic", "basic");
    const { month, day } = todayMonthDay();
    await getDb()
      .update(schema.profile)
      .set({ birthMonth: month, birthDay: day })
      .where(eq(schema.profile.id, u.profileId));
    const res = await getPoints(u);
    expect(res.layer2.total).toBe(0);
    expect((await layer2Rows(u.username)).length).toBe(0);
  });
});

// ---- Birthday via the My social profile editor (updateMyProfile) -----------------
//
// Regression pin for the Layer 2 ship defect: the birthday selects
// were placed on the Settings → Truck fold (the saveProfile draft),
// NOT on the profile edit screen (Settings → My social profile), and
// neither getUserProfile nor updateMyProfile carried the fields —
// so from the profile editor a birthday could never be set and the
// +100 drop could never fire from UI input. These tests pin the
// profile-editor path end to end.

describe("Layer 2 — birthday through the My social profile editor", () => {
  const socialArgs = (over: Record<string, unknown> = {}) => ({
    displayName: "Test Driver",
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
    showTruck: true,
    featuredBadge: null,
    birthMonth: null as number | null,
    birthDay: null as number | null,
    avatarDataBase64: null,
    avatarMime: null,
    ...over,
  });

  test("saving month/day on the profile editor persists, loads back owner-only, and pays the drop", async () => {
    const u = await seedUser("l2bdayeditor");
    const { month, day } = todayMonthDay();
    await Actions.updateMyProfile.handler(ctxFor(u), socialArgs({ birthMonth: month, birthDay: day }));
    // Persisted on the profile row (the same columns saveProfile writes).
    const prof = await Actions.getProfile.handler(ctxFor(u), {});
    expect(prof.profile!.birthMonth).toBe(month);
    expect(prof.profile!.birthDay).toBe(day);
    // The editor's own load path returns the saved values to the owner…
    const mine = await Actions.getUserProfile.handler(ctxFor(u), { username: u.username });
    expect(mine.birthMonth).toBe(month);
    expect(mine.birthDay).toBe(day);
    // …and to NOBODY else: another driver viewing this profile gets nulls.
    const other = await seedUser("l2bdayviewer");
    const theirs = await Actions.getUserProfile.handler(ctxFor(other), { username: u.username });
    expect(theirs.birthMonth).toBeNull();
    expect(theirs.birthDay).toBeNull();
    // And the award the defect starved now fires from editor input.
    await getPoints(u);
    const rows = await layer2Rows(u.username, "layer2_birthday");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(100);
  });

  test("clearing both fields on the editor clears the stored birthday", async () => {
    const u = await seedUser("l2bdayclear");
    await Actions.updateMyProfile.handler(ctxFor(u), socialArgs({ birthMonth: 6, birthDay: 15 }));
    let prof = await Actions.getProfile.handler(ctxFor(u), {});
    expect(prof.profile!.birthMonth).toBe(6);
    expect(prof.profile!.birthDay).toBe(15);
    await Actions.updateMyProfile.handler(ctxFor(u), socialArgs({ birthMonth: null, birthDay: null }));
    prof = await Actions.getProfile.handler(ctxFor(u), {});
    expect(prof.profile!.birthMonth).toBeNull();
    expect(prof.profile!.birthDay).toBeNull();
    const mine = await Actions.getUserProfile.handler(ctxFor(u), { username: u.username });
    expect(mine.birthMonth).toBeNull();
    expect(mine.birthDay).toBeNull();
  });

  test("the editor refuses a half-set or impossible birthday", async () => {
    const u = await seedUser("l2bdaybad");
    await expect(
      Actions.updateMyProfile.handler(ctxFor(u), socialArgs({ birthMonth: 6, birthDay: null })),
    ).rejects.toThrow();
    await expect(
      Actions.updateMyProfile.handler(ctxFor(u), socialArgs({ birthMonth: null, birthDay: 15 })),
    ).rejects.toThrow();
    await expect(
      Actions.updateMyProfile.handler(ctxFor(u), socialArgs({ birthMonth: 2, birthDay: 30 })),
    ).rejects.toThrow();
    const prof = await Actions.getProfile.handler(ctxFor(u), {});
    expect(prof.profile!.birthMonth).toBeNull();
    expect(prof.profile!.birthDay).toBeNull();
  });
});

// ---- Maintenance safety net ------------------------------------------------------

describe("Layer 2 — maintenance discipline + the safety net", () => {
  test("due-window + receipt pays once; duplicate / out-of-window / no-receipt / contradicting entries earn zero; a hold withholds, surfaces, and clears", async () => {
    const u = await seedUser("l2maint");
    const db = getDb();
    const dayMs = 86400000;
    const now = Date.now();
    // The real schedule state: oil due at 125,000 miles.
    await db.insert(schema.maintenanceServices).values({
      profileId: u.profileId,
      item: "oil",
      intervalMiles: 25000,
      lastDoneOdometer: 100000,
      lastDoneAt: new Date(now - 200 * dayMs),
    });
    // The sealed record's odometer truth (fuel log): 175,000 miles.
    await db.insert(schema.fuelPurchases).values({
      profileId: u.profileId,
      purchasedAt: new Date(now - dayMs),
      state: "AL",
      gallons: 100,
      pricePerGallon: 4,
      total: 400,
      odometer: 175000,
    });
    const entry = async (fields: {
      daysAgo: number;
      odometer: number;
      cost: number;
      nextDueMiles: number;
      receipt: boolean;
    }): Promise<number> => {
      const rows = await db
        .insert(schema.maintenanceLogEntries)
        .values({
          profileId: u.profileId,
          performedAt: new Date(now - fields.daysAgo * dayMs),
          odometer: fields.odometer,
          category: "oil",
          description: "Oil change",
          cost: fields.cost,
          nextDueMiles: fields.nextDueMiles,
          status: "logged",
        })
        .returning({ id: schema.maintenanceLogEntries.id });
      const id = rows[0]!.id;
      if (fields.receipt) {
        await db.insert(schema.maintenanceLogAttachments).values({
          profileId: u.profileId,
          entryId: id,
          label: "Receipt",
          blobKey: `test-${id}`,
          mime: "image/jpeg",
        });
      }
      return id;
    };

    // Out of window (110,000 vs due 125,000): earns zero.
    await entry({ daysAgo: 30, odometer: 110000, cost: 400, nextDueMiles: 135000, receipt: true });
    // In window (124,800, inside [124,500, 125,000]) + receipt: pays.
    const good = await entry({ daysAgo: 10, odometer: 124800, cost: 450, nextDueMiles: 149800, receipt: true });
    // Near-duplicate copy of the good entry: earns zero.
    await entry({ daysAgo: 10, odometer: 124800, cost: 450, nextDueMiles: 149800, receipt: true });
    // In the NEXT window (149,700) but NO receipt: earns zero.
    await entry({ daysAgo: 5, odometer: 149700, cost: 460, nextDueMiles: 174700, receipt: false });
    // Odometer contradicts the sealed record (200,000 / 210,000 vs a
    // sealed 175,000): earn zero, and two of them open the hold.
    await entry({ daysAgo: 2, odometer: 200000, cost: 500, nextDueMiles: 225000, receipt: true });
    await entry({ daysAgo: 1, odometer: 210000, cost: 500, nextDueMiles: 235000, receipt: true });

    const res = await getPoints(u);
    const maint = await layer2Rows(u.username, "layer2_maintenance");
    expect(maint.length).toBe(1);
    expect(maint[0]!.amount).toBe(50);
    expect(maint[0]!.refKey).toBe("layer2-maint-oil-m125000");
    expect(maint[0]!.refKey).not.toBe(`layer2-maint-${good}`);
    expect(res.layer2.openHolds).toBeGreaterThanOrEqual(1);

    // The hold is on the table, open, for the owner.
    const holds = await db
      .select()
      .from(schema.pointsSafetyHolds)
      .where(eq(schema.pointsSafetyHolds.username, u.username));
    const open = holds.filter((h) => h.status === "open");
    expect(open.length).toBe(1);
    expect(open[0]!.kind).toBe("maintenance_odometer");

    // A clean, in-window, receipt-backed entry now WITHHOLDS.
    const late = await entry({ daysAgo: 0, odometer: 174600, cost: 470, nextDueMiles: 199600, receipt: true });
    await getPoints(u);
    expect((await layer2Rows(u.username, "layer2_maintenance")).length).toBe(1);

    // The driver cannot clear their own hold; the owner can.
    const denied = await Actions.clearPointsSafetyHold.handler(ctxFor(u), { holdId: open[0]!.id });
    expect(denied.ok).toBe(false);
    const owner = await seedUser("l2owner");
    const list = await Actions.getPointsSafetyHolds.handler(ctxFor(owner, true), {});
    expect(list.holds.some((h) => h.id === open[0]!.id && h.username === u.username)).toBe(true);
    const cleared = await Actions.clearPointsSafetyHold.handler(ctxFor(owner, true), { holdId: open[0]!.id });
    expect(cleared.ok).toBe(true);

    // With the hold cleared, the withheld award lands.
    await getPoints(u);
    const after = await layer2Rows(u.username, "layer2_maintenance");
    expect(after.length).toBe(2);
    expect(after.some((r) => r.refKey === "layer2-maint-oil-m174700" && r.amount === 50)).toBe(true);
    expect(after.some((r) => r.refKey === `layer2-maint-${late}`)).toBe(false);
  });
});

// ---- Referral ladder ---------------------------------------------------------------

describe("Layer 2 — referral ladder counts ACTIVE referrals only", () => {
  test("5 active referrals pay the 5-rung; low-usage and clawed-back referrals don't count", async () => {
    const db = getDb();
    const referrer = await seedUser("l2referrer");
    const addActivityDays = async (accountId: number, n: number) => {
      for (let i = 0; i < n; i++) {
        await db.insert(schema.authActivityDays).values({
          accountId,
          day: `2026-10-${String(10 + i).padStart(2, "0")}`,
        });
      }
    };
    const addReferred = async (name: string, activityDays: number) => {
      const r = await seedUser(name);
      await db.insert(schema.referralRewards).values({
        referrerUsername: referrer.username,
        referredUsername: r.username,
        amountStoner: 100,
        status: "paid",
      });
      await addActivityDays(r.accountId, activityDays);
      return r;
    };
    for (let i = 1; i <= 5; i++) await addReferred(`l2refactive${i}`, 4);
    // Settled but barely used: NOT active.
    await addReferred("l2reflowuse", 1);
    // Settled + used, but the subscription was clawed back: NOT active.
    const clawed = await addReferred("l2refclawed", 4);
    await db.insert(schema.pointsLog).values({
      username: referrer.username,
      amount: -100,
      reason: "Referral reversed",
      source: "referral_points",
      refKey: `clawback-referral-points:${clawed.username}`,
    });

    await getPoints(referrer);
    const ladder = await layer2Rows(referrer.username, "layer2_referral_ladder");
    expect(ladder.length).toBe(1);
    expect(ladder[0]!.amount).toBe(250);
    expect(ladder[0]!.refKey).toBe("layer2-refladder-5");
  });
});

// ---- Renewal streak ------------------------------------------------------------------

describe("Layer 2 — renewal streaks (settled payments only)", () => {
  test("six settled months pay the 6-month rung; a refund reversal breaks it and claws back", async () => {
    const db = getDb();
    const u = await seedUser("l2renew");
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    for (const [i, m] of months.entries()) {
      await db.insert(schema.subscriptionEvents).values({
        username: u.username,
        plan: "diamond",
        period: "monthly",
        kind: i === 0 ? "new" : "renewal",
        paymentRef: `l2renew-pay-${m}`,
        createdAt: new Date(`${m}-15T12:00:00Z`),
      });
    }
    await getPoints(u);
    const rows = await layer2Rows(u.username, "layer2_renewal_streak");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(250);
    expect(rows[0]!.refKey).toBe("layer2-renewal-6");

    // A refund reverses the first payment: the run drops to 5 and
    // the next read reverses the award (House Rule 1).
    await db
      .update(schema.subscriptionEvents)
      .set({ reversed: true })
      .where(eq(schema.subscriptionEvents.paymentRef, "l2renew-pay-2026-05"));
    await getPoints(u);
    const all = await db
      .select()
      .from(schema.pointsLog)
      .where(eq(schema.pointsLog.username, u.username));
    const claw = all.find((r) => r.refKey === "clawback:layer2-renewal-6");
    expect(claw).toBeTruthy();
    expect(claw!.amount).toBe(-250);
  });
});

// ---- Rig record ------------------------------------------------------------------------

describe("Layer 2 — set up right: the complete rig record", () => {
  test("full truck + trailer identity, photos, and current credentials pay once", async () => {
    const db = getDb();
    const u = await seedUser("l2rig");
    await db
      .update(schema.profile)
      .set({
        truckYear: 2021,
        truckMake: "Kenworth",
        truckModel: "W900",
        trailerYear: 2022,
        trailerMake: "Great Dane",
        trailerModel: "Everest",
      })
      .where(eq(schema.profile.id, u.profileId));
    await db.insert(schema.vehiclePhotos).values({ profileId: u.profileId, kind: "truck", blobKey: "t1", mime: "image/jpeg" });
    await db.insert(schema.vehiclePhotos).values({ profileId: u.profileId, kind: "trailer", blobKey: "t2", mime: "image/jpeg" });
    await db.insert(schema.personalDocs).values({
      profileId: u.profileId,
      kind: "cdl",
      label: "CDL",
      expiresAt: new Date(Date.now() + 365 * 86400000),
    });
    await db.insert(schema.personalDocs).values({ profileId: u.profileId, kind: "medical", label: "Medical card" });

    await getPoints(u);
    const rows = await layer2Rows(u.username, "layer2_rig_record");
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(250);
    await getPoints(u);
    expect((await layer2Rows(u.username, "layer2_rig_record")).length).toBe(1);
  });

  test("an expired medical card keeps the rig record unpaid", async () => {
    const db = getDb();
    const u = await seedUser("l2rigexpired");
    await db
      .update(schema.profile)
      .set({
        truckYear: 2021,
        truckMake: "Kenworth",
        truckModel: "W900",
        trailerYear: 2022,
        trailerMake: "Great Dane",
        trailerModel: "Everest",
      })
      .where(eq(schema.profile.id, u.profileId));
    await db.insert(schema.vehiclePhotos).values({ profileId: u.profileId, kind: "truck", blobKey: "t1", mime: "image/jpeg" });
    await db.insert(schema.vehiclePhotos).values({ profileId: u.profileId, kind: "trailer", blobKey: "t2", mime: "image/jpeg" });
    await db.insert(schema.personalDocs).values({
      profileId: u.profileId,
      kind: "cdl",
      label: "CDL",
      expiresAt: new Date(Date.now() + 365 * 86400000),
    });
    await db.insert(schema.personalDocs).values({
      profileId: u.profileId,
      kind: "medical",
      label: "Medical card",
      expiresAt: new Date(Date.now() - 86400000),
    });
    await getPoints(u);
    expect((await layer2Rows(u.username, "layer2_rig_record")).length).toBe(0);
  });
});
