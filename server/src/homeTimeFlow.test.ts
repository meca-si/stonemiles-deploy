// homeTimeFlow.test.ts — INTEGRATION tests for the home-time
// guarantee + retention build (Research Wave 2 item 9, migration
// 0135), run against the REAL action handlers over a throwaway
// migrated SQLite database:
//
//   (a) commitments are recorded as stated — the driver's own
//       (setBy driver) or the fleet's for them (setBy fleet, the
//       driver notified); malformed terms are refused whole.
//   (b) no commitment / a comfortable load → claims land clean,
//       no warning, nothing sealed.
//   (c) a conflicting claim WARNS with the plain math and binds
//       NOTHING — no load, no override row, no seal.
//   (d) the driver overrides their own term → binds, the override
//       row carries the created load id, home_time_overridden
//       seals.
//   (e) the desk CANNOT override a driver-stated term, with or
//       without a reason — the load stays open.
//   (f) a fleet-stated term: the desk overrides at assign (the
//       driver is notified in-app), and the driver's accept then
//       passes on that same override — no double row.
//   (g) hit-rate outcomes derive from sealed records only: a home
//       spell over the deadline reads kept; sealed proof of
//       still being out reads missed; an override row reads
//       overridden; no evidence reads no_home_record.
//   (h) pulse: cadence state per driver, invalid answer sets
//       refused, the fleet aggregate shows averages only at 3+
//       respondents (counts only below), and a driver's note
//       NEVER appears in the fleet payload.
//   (i) void authority mirrors override authority; a voided
//       commitment stops warning.
//   (j) access: another fleet and a fellow driver are refused.
//   (k) retention signals rise from sealed facts (detention
//       overruns, a falling miles trend, a second missed
//       commitment) — facts, never a score.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp
// dir before host/ctx is imported. Every driver who binds loads
// carries a complete DQF (the item-6 gate runs first in the same
// funnels) — recorded through the real saveDqfEntry action.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-hometime-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { and, desc, eq } = await import("drizzle-orm");

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

async function seedUser(username: string): Promise<SeededUser> {
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
      plan: "diamond",
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 7,
      dieselPrice: 4,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
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

async function seedFleet(owner: SeededUser, name: string): Promise<number> {
  const db = getDb();
  const c = await db
    .insert(schema.companies)
    .values({ name, ownerUsername: owner.username })
    .returning({ id: schema.companies.id });
  const companyId = c[0]!.id;
  await db.insert(schema.companyMembers).values({ companyId, username: owner.username, role: "owner" });
  return companyId;
}

const db = getDb();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const dateOnly = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString().slice(0, 10);
const isoAt = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

const owner1 = await seedUser("htowner");
const dispatch1 = await seedUser("htdispatch");
const driverA = await seedUser("htdriver");
const driverB = await seedUser("htdriver2");
const driverC = await seedUser("htdriver3");
const owner2 = await seedUser("htother");

const fleet1 = await seedFleet(owner1, "HomeTime Fleet LLC");
await db.insert(schema.companyMembers).values({ companyId: fleet1, username: dispatch1.username, role: "dispatch" });
await db.insert(schema.companyMembers).values({ companyId: fleet1, username: driverA.username, role: "driver" });
await db.insert(schema.companyMembers).values({ companyId: fleet1, username: driverB.username, role: "driver" });
await db.insert(schema.companyMembers).values({ companyId: fleet1, username: driverC.username, role: "driver" });
await seedFleet(owner2, "Other Fleet LLC");

// Home places on file: A and C live in Mobile, AL. B has none —
// no home evidence can exist for B, by design.
await db.update(schema.socialUsers).set({ homeCity: "Mobile", homeState: "AL" }).where(eq(schema.socialUsers.username, driverA.username));
await db.update(schema.socialUsers).set({ homeCity: "Mobile", homeState: "AL" }).where(eq(schema.socialUsers.username, driverC.username));

const ownerCtx = ctxFor(owner1);
const dispatchCtx = ctxFor(dispatch1);
const aCtx = ctxFor(driverA);
const bCtx = ctxFor(driverB);
const cCtx = ctxFor(driverC);
const otherCtx = ctxFor(owner2);

// ---- DQF seeding (the item-6 gate runs ahead of the home-time
// gate in the same funnels) ------------------------------------

async function saveEntry(driver: string, kind: string, entryDate: string, expiresOn: string | null, payload: Record<string, unknown>): Promise<void> {
  const r = await Actions.saveDqfEntry.handler(ownerCtx, {
    driverUsername: driver,
    kind,
    entryDate,
    expiresOn,
    payloadJson: JSON.stringify(payload),
    dataBase64: null,
    mime: null,
  } as never);
  expect(r.ok).toBe(true);
}

async function recordCompleteFile(driver: string) {
  await saveEntry(driver, "application", dateOnly(-300 * DAY), null, {});
  await saveEntry(driver, "cdl", dateOnly(-600 * DAY), dateOnly(400 * DAY), { state: "AL", licenseClass: "A" });
  await saveEntry(driver, "medical", dateOnly(-100 * DAY), dateOnly(400 * DAY), { examinerName: "Dr. A", registryNumber: "12345" });
  await saveEntry(driver, "road_test", dateOnly(-299 * DAY), null, { examinerName: "Tester" });
  await saveEntry(driver, "mvr_review", dateOnly(-30 * DAY), null, { outcome: "acceptable" });
  await saveEntry(driver, "clearinghouse_query", dateOnly(-301 * DAY), null, { queryType: "pre_employment", result: "clear" });
}

await recordCompleteFile(driverA.username);
await recordCompleteFile(driverB.username);
await recordCompleteFile(driverC.username);

// ---- Board loads ----------------------------------------------

const boardFields = {
  shipper: "Acme Steel",
  pickupCity: "Mobile",
  pickupState: "AL",
  deliveryCity: "Dallas",
  deliveryState: "TX",
  pickupText: "Mon 8a",
  deliveryText: "Wed 5p",
  rate: 2400,
  loadedMiles: null,
  milesSource: null,
  extraCharges: 0,
  extraChargesNote: null,
  weightLbs: 40000,
  commodity: "steel coils",
  hazmat: false,
  equipmentType: "flatbed" as const,
  notes: null,
  brokerName: null,
  brokerCompany: null,
  brokerMc: null,
  referenceNumber: "HT-1",
  pickupApptAt: null,
  deliveryApptAt: null as string | null,
};

async function postLoad(deliveryApptAt: string | null): Promise<number> {
  const r = await Actions.postBoardLoad.handler(ownerCtx, { ...boardFields, deliveryApptAt } as never);
  expect(r.ok).toBe(true);
  return r.id!;
}

async function boardStatus(id: number): Promise<string> {
  const rows = await db.select().from(schema.boardLoads).where(eq(schema.boardLoads.id, id));
  return rows[0]!.status;
}

async function chainCount(event: string): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event));
  return rows.length;
}

async function overrideRows(driver: string) {
  return db
    .select()
    .from(schema.homeTimeOverrides)
    .where(and(eq(schema.homeTimeOverrides.companyId, fleet1), eq(schema.homeTimeOverrides.driverUsername, driver)));
}

// Chain helper — re-reads the live head on every call (the real
// actions append their own seals between these inserts), with an
// explicit createdAt so seals land when the test says they did.
async function addChain(refKind: string, refId: number | null, event: string, payload: Record<string, unknown>, atIso: string) {
  const head = await db.select({ hash: schema.chainLog.hash }).from(schema.chainLog).orderBy(desc(schema.chainLog.id)).limit(1);
  const prev = head[0]?.hash ?? "GENESIS";
  const payloadText = JSON.stringify(payload);
  const hash = createHash("sha256").update(`${prev}|${event}|${payloadText}`).digest("hex");
  const rows = await db
    .insert(schema.chainLog)
    .values({ refKind, refId, sessionId: null, event, payload: payloadText, prevHash: prev, hash, createdAt: new Date(atIso) })
    .returning({ id: schema.chainLog.id });
  return rows[0]!.id;
}

async function setCommitment(
  ctx: CtxT,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; error: string | null; commitmentId: number | null }> {
  return Actions.setHomeTimeCommitment.handler(ctx, args as never);
}

/** The first Saturday 00:00 UTC whose "Friday noon" delivery
 * (deadline − 12h) is still comfortably in the future. */
function nextSaturdayMs(): number {
  const d = new Date(Date.now() + DAY);
  d.setUTCHours(0, 0, 0, 0);
  let t = d.getTime();
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  while (t - 12 * HOUR < Date.now() + HOUR) t += 7 * DAY;
  return t;
}

describe("(a) commitments record as stated", () => {
  test("malformed terms are refused whole", async () => {
    const noDate = await setCommitment(aCtx, { driverUsername: "htdriver", kind: "by_date", homeByAt: null });
    expect(noDate.ok).toBe(false);
    const noAnchor = await setCommitment(aCtx, { driverUsername: "htdriver", kind: "every_n_days", everyNDays: 14, anchorAt: null });
    expect(noAnchor.ok).toBe(false);
    const badDate = await setCommitment(aCtx, { driverUsername: "htdriver", kind: "by_date", homeByAt: "not a date" });
    expect(badDate.ok).toBe(false);
  });

  test("the driver's own term records setBy driver", async () => {
    const r = await setCommitment(aCtx, {
      driverUsername: "htdriver",
      kind: "by_date",
      homeByAt: isoAt(2 * DAY),
      note: "Anniversary weekend",
    });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.homeTimeCommitments).where(eq(schema.homeTimeCommitments.id, r.commitmentId!));
    expect(rows[0]!.setBy).toBe("driver");
    expect(rows[0]!.createdBy).toBe("htdriver");
    expect(await chainCount("home_time_commitment_set")).toBeGreaterThanOrEqual(1);
  });
});

describe("(b) no conflict — claims land clean", () => {
  test("a driver with NO commitments claims with no warning", async () => {
    const id = await postLoad(isoAt(5 * DAY));
    const res = await Actions.claimBoardLoad.handler(cCtx, { id } as never);
    expect(res.ok).toBe(true);
    expect(res.loadId).not.toBeNull();
    expect(res.homeTimeWarning ?? null).toBeNull();
    expect((await overrideRows("htdriver3")).length).toBe(0);
  });

  test("a comfortable load under an active commitment also lands clean", async () => {
    // A is due home in ~2 days; this load delivers in 6 hours,
    // home state — home ETA lands well before the deadline.
    const id = await postLoad(isoAt(6 * HOUR));
    await db.update(schema.boardLoads).set({ deliveryCity: "Mobile", deliveryState: "AL" }).where(eq(schema.boardLoads.id, id));
    const res = await Actions.claimBoardLoad.handler(aCtx, { id } as never);
    expect(res.ok).toBe(true);
    expect(res.homeTimeWarning ?? null).toBeNull();
  });
});

describe("(c) a conflicting claim warns and binds NOTHING", () => {
  test("warn carries the math; board, overrides, and chain are untouched", async () => {
    const sealedBefore = await chainCount("home_time_overridden");
    // A's deadline is ~now+2d; delivery 10h before it in TX with
    // the 24h out-of-state allowance lands the home ETA past it.
    const id = await postLoad(isoAt(2 * DAY - 10 * HOUR));
    const res = await Actions.claimBoardLoad.handler(aCtx, { id } as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("breaks a home-time commitment");
    expect(res.homeTimeWarning).not.toBeNull();
    expect(res.homeTimeWarning!.summary).toContain("drive home");
    expect(await boardStatus(id)).toBe("open");
    expect((await overrideRows("htdriver")).length).toBe(0);
    expect(await chainCount("home_time_overridden")).toBe(sealedBefore);
  });
});

describe("(d) the driver overrides their own term", () => {
  test("override binds, seals, and the row carries the load id", async () => {
    const sealedBefore = await chainCount("home_time_overridden");
    const id = await postLoad(isoAt(2 * DAY - 10 * HOUR));
    const res = await Actions.claimBoardLoad.handler(aCtx, { id, homeTimeOverride: { reason: "Family knows — one-off" } } as never);
    expect(res.ok).toBe(true);
    expect(res.loadId).not.toBeNull();
    const rows = await overrideRows("htdriver");
    expect(rows.length).toBe(1);
    expect(rows[0]!.method).toBe("claim");
    expect(rows[0]!.overriddenBy).toBe("htdriver");
    expect(rows[0]!.reason).toBe("Family knows — one-off");
    expect(rows[0]!.loadId).toBe(res.loadId);
    expect(await chainCount("home_time_overridden")).toBe(sealedBefore + 1);
  });
});

describe("(e) the desk cannot override a driver-stated term", () => {
  test("assign warns without a reason and refuses with one", async () => {
    const id = await postLoad(isoAt(2 * DAY - 10 * HOUR));
    const warn = await Actions.assignBoardLoad.handler(ownerCtx, { id, targetUsername: "htdriver" } as never);
    expect(warn.ok).toBe(false);
    expect(warn.homeTimeWarning).not.toBeNull();
    expect(await boardStatus(id)).toBe("open");

    const refused = await Actions.assignBoardLoad.handler(ownerCtx, {
      id,
      targetUsername: "htdriver",
      homeTimeOverride: { reason: "Customer needs it" },
    } as never);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("only they can override");
    expect(await boardStatus(id)).toBe("open");
    expect((await overrideRows("htdriver")).length).toBe(1); // still only the driver's own from (d)
  });
});

describe("(f) a fleet-stated term — desk override, driver notified, accept passes through", () => {
  test("weekends for B: warn, desk override at assign, accept on the same override", async () => {
    const set = await setCommitment(ownerCtx, { driverUsername: "htdriver2", kind: "weekends", note: "Home weekends" });
    expect(set.ok).toBe(true);
    const rows = await db.select().from(schema.homeTimeCommitments).where(eq(schema.homeTimeCommitments.id, set.commitmentId!));
    expect(rows[0]!.setBy).toBe("fleet");
    const setNotes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, "htdriver2"));
    expect(setNotes.some((n) => n.title.includes("home-time commitment was set for you"))).toBe(true);

    const saturday = nextSaturdayMs();
    const delivery = new Date(saturday - 12 * HOUR).toISOString(); // Friday noon UTC, TX → ETA Saturday noon

    // B claiming a conflicting load themselves warns first.
    const own = await postLoad(delivery);
    const ownWarn = await Actions.claimBoardLoad.handler(bCtx, { id: own } as never);
    expect(ownWarn.ok).toBe(false);
    expect(ownWarn.homeTimeWarning).not.toBeNull();
    expect(await boardStatus(own)).toBe("open");

    // The desk assigns a second conflicting load: warn, then
    // override with a reason → assigned, sealed, B notified.
    const id = await postLoad(delivery);
    const warn = await Actions.assignBoardLoad.handler(dispatchCtx, { id, targetUsername: "htdriver2" } as never);
    expect(warn.ok).toBe(false);
    expect(warn.homeTimeWarning).not.toBeNull();

    const sealedBefore = await chainCount("home_time_overridden");
    const asg = await Actions.assignBoardLoad.handler(dispatchCtx, {
      id,
      targetUsername: "htdriver2",
      homeTimeOverride: { reason: "Customer window moved" },
    } as never);
    expect(asg.ok).toBe(true);
    expect(await boardStatus(id)).toBe("assigned");
    expect(await chainCount("home_time_overridden")).toBe(sealedBefore + 1);
    const orows = await overrideRows("htdriver2");
    expect(orows.length).toBe(1);
    expect(orows[0]!.method).toBe("assign");
    expect(orows[0]!.overriddenBy).toBe("htdispatch");
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, "htdriver2"));
    expect(notes.some((n) => n.title.includes("home-time commitment was overridden"))).toBe(true);

    // B accepts with NO override argument — the assign-time
    // override is already on the record for this deadline.
    const acc = await Actions.acceptAssignedLoad.handler(bCtx, { id } as never);
    expect(acc.ok).toBe(true);
    expect(acc.loadId).not.toBeNull();
    const after = await overrideRows("htdriver2");
    expect(after.length).toBe(1);
    expect(after[0]!.loadId).toBe(acc.loadId);
  });
});

describe("(g) hit-rate outcomes derive from sealed records only", () => {
  test("kept / missed / overridden / no_home_record — never a guess", async () => {
    // Three past deadlines for C (Mobile, AL on file). Seeded as
    // rows recorded a week before each deadline — a commitment
    // only counts from when it was STATED (effectiveFrom), so a
    // term recorded today can never backfill last week's record.
    const seedPast = async (deadlineMs: number): Promise<number> => {
      const ins = await db
        .insert(schema.homeTimeCommitments)
        .values({
          companyId: fleet1,
          driverUsername: "htdriver3",
          kind: "by_date",
          homeByAt: new Date(deadlineMs),
          everyNDays: null,
          anchorAt: null,
          setBy: "driver",
          createdBy: "htdriver3",
          note: null,
          effectiveFrom: new Date(deadlineMs - 7 * DAY),
          effectiveTo: null,
        })
        .returning({ id: schema.homeTimeCommitments.id });
      return ins[0]!.id;
    };
    const D1 = Date.now() - 3 * DAY;
    const D2 = Date.now() - 1 * DAY;
    const D3 = Date.now() - 12 * HOUR;
    await seedPast(D1);
    await seedPast(D2);
    const d3Id = await seedPast(D3);

    // Nothing sealed yet → every outcome is unprovable.
    let view = await Actions.getHomeTime.handler(cCtx, { driverUsername: null } as never);
    expect(view.ok).toBe(true);
    expect(view.hitRate.total).toBe(3);
    expect(view.hitRate.decided).toBe(0);
    expect(view.hitRate.noHomeRecord).toBe(3);

    // Sealed facts: off duty at home from a day before D1 until
    // 2h before D2 (kept for D1); a driving event 5h after D2
    // (missed for D2); an override row naming D3 (overridden).
    await addChain("driver", null, "duty_change", { state: "off_duty", at: new Date(D1 - DAY).toISOString(), location: "Mobile, AL", username: "htdriver3", source: "manual" }, new Date(D1 - DAY).toISOString());
    await addChain("driver", null, "duty_change", { state: "on_duty", at: new Date(D2 - 2 * HOUR).toISOString(), location: "Dallas, TX", username: "htdriver3", source: "manual" }, new Date(D2 - 2 * HOUR).toISOString());
    await addChain("driver", null, "duty_change", { state: "driving", at: new Date(D2 + 5 * HOUR).toISOString(), location: "Dallas, TX", username: "htdriver3", source: "manual" }, new Date(D2 + 5 * HOUR).toISOString());
    await db.insert(schema.homeTimeOverrides).values({
      companyId: fleet1,
      driverUsername: "htdriver3",
      commitmentId: d3Id,
      deadlineAt: new Date(D3),
      boardLoadId: 999001,
      loadId: null,
      method: "claim",
      overriddenBy: "htdriver3",
      reason: "test override",
      deliveryAt: new Date(D3),
      homeEtaAt: new Date(D3 + HOUR),
    });

    view = await Actions.getHomeTime.handler(cCtx, { driverUsername: null } as never);
    const outcomes = view.outcomes.map((o) => o.outcome).sort();
    expect(outcomes).toEqual(["kept", "missed", "overridden"]);
    expect(view.hitRate).toEqual({ kept: 1, missed: 1, overridden: 1, noHomeRecord: 0, decided: 3, total: 3 });
    // The desk sees the same tallies for C.
    const desk = await Actions.getHomeTime.handler(ownerCtx, { driverUsername: "htdriver3" } as never);
    expect(desk.hitRate).toEqual(view.hitRate);
    expect(desk.pulse).toBeNull(); // pulse state is the driver's own view only
  });
});

describe("(h) pulse — cadence, validation, aggregate privacy", () => {
  test("prompt is due, invalid sets refuse, answers record as the driver's own", async () => {
    const prompt = await Actions.getPulsePrompt.handler(aCtx, {} as never);
    expect(prompt.ok).toBe(true);
    expect(prompt.due).toBe(true);
    expect(prompt.questions.length).toBe(3);

    const bad = await Actions.answerPulse.handler(aCtx, { answers: { home_time: 4, workload: 3 }, note: null } as never);
    expect(bad.ok).toBe(false);
    const still = await Actions.getPulsePrompt.handler(aCtx, {} as never);
    expect(still.due).toBe(true);

    const good = await Actions.answerPulse.handler(aCtx, {
      answers: { home_time: 5, workload: 4, staying: 3 },
      note: null,
    } as never);
    expect(good.ok).toBe(true);
    const after = await Actions.getPulsePrompt.handler(aCtx, {} as never);
    expect(after.due).toBe(false);
    expect(after.status).toBe("answered");
    expect(after.myAnswers).toEqual({ home_time: 5, workload: 4, staying: 3 });
    // The seal records the answer landed — never its content.
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "pulse_answered"));
    expect(seals.length).toBeGreaterThanOrEqual(1);
    expect(seals.every((s) => !s.payload.includes("home_time"))).toBe(true);
  });

  test("dismissal quiets the episode", async () => {
    const d = await Actions.dismissPulse.handler(dispatchCtx, {} as never);
    expect(d.ok).toBe(true);
    const prompt = await Actions.getPulsePrompt.handler(dispatchCtx, {} as never);
    expect(prompt.due).toBe(false);
    expect(prompt.status).toBe("dismissed");
  });

  test("fleet aggregate: averages at 3 respondents, notes never surface", async () => {
    await Actions.answerPulse.handler(bCtx, { answers: { home_time: 4, workload: 4, staying: 4 }, note: null } as never);
    await Actions.answerPulse.handler(cCtx, {
      answers: { home_time: 3, workload: 4, staying: 5 },
      note: "SECRET NOTE — do not surface",
    } as never);
    const board = await Actions.getFleetHomeTime.handler(ownerCtx, {} as never);
    expect(board.ok).toBe(true);
    expect(board.pulse.respondentCount).toBe(3);
    expect(board.pulse.averages).toEqual({ home_time: 4, workload: 4, staying: 4 });
    const wire = JSON.stringify(board);
    expect(wire.includes("SECRET NOTE")).toBe(false);
    expect(wire.includes("myAnswers")).toBe(false);
    // The driver's own view still carries their note.
    const mine = await Actions.getHomeTime.handler(cCtx, { driverUsername: null } as never);
    expect(mine.pulse?.myNote).toBe("SECRET NOTE — do not surface");
  });

  test("below 3 respondents the fleet sees counts only", async () => {
    // owner2's fleet has exactly one member; they answer alone.
    await Actions.answerPulse.handler(otherCtx, { answers: { home_time: 1, workload: 1, staying: 1 }, note: null } as never);
    const board = await Actions.getFleetHomeTime.handler(otherCtx, {} as never);
    expect(board.ok).toBe(true);
    expect(board.pulse.respondentCount).toBe(1);
    expect(board.pulse.averages).toBeNull();
  });
});

describe("(i) void authority mirrors override authority", () => {
  test("the desk cannot void the driver's own term; the driver can; the deadline stops warning", async () => {
    const mine = await Actions.getHomeTime.handler(aCtx, { driverUsername: null } as never);
    const own = mine.commitments.find((c) => !c.voided && c.kind === "by_date")!;
    const deskTry = await Actions.voidHomeTimeCommitment.handler(ownerCtx, { commitmentId: own.id } as never);
    expect(deskTry.ok).toBe(false);
    expect(deskTry.error).toContain("only they can end it");

    const byDriver = await Actions.voidHomeTimeCommitment.handler(aCtx, { commitmentId: own.id } as never);
    expect(byDriver.ok).toBe(true);
    // No active commitments remain for A → a formerly conflicting
    // delivery now claims clean.
    const id = await postLoad(isoAt(2 * DAY - 10 * HOUR));
    const res = await Actions.claimBoardLoad.handler(aCtx, { id } as never);
    expect(res.ok).toBe(true);
  });

  test("the desk can void a fleet-stated term, and the driver hears about it", async () => {
    const view = await Actions.getHomeTime.handler(ownerCtx, { driverUsername: "htdriver2" } as never);
    const fleetTerm = view.commitments.find((c) => !c.voided && c.setBy === "fleet")!;
    const r = await Actions.voidHomeTimeCommitment.handler(ownerCtx, { commitmentId: fleetTerm.id } as never);
    expect(r.ok).toBe(true);
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.username, "htdriver2"));
    expect(notes.some((n) => n.title.includes("home-time commitment was ended"))).toBe(true);
  });
});

describe("(j) access scope", () => {
  test("another fleet and a fellow driver are refused", async () => {
    const outsider = await Actions.getHomeTime.handler(otherCtx, { driverUsername: "htdriver" } as never);
    expect(outsider.ok).toBe(false);
    const fellow = await Actions.getHomeTime.handler(bCtx, { driverUsername: "htdriver" } as never);
    expect(fellow.ok).toBe(false);
    const setOutsider = await setCommitment(otherCtx, { driverUsername: "htdriver", kind: "weekends" });
    expect(setOutsider.ok).toBe(false);
  });
});

describe("(k) retention signals from sealed facts", () => {
  test("detention overruns, a miles fall, and a second miss each surface as facts", async () => {
    // Three detention waits past their free time in 90 days.
    for (let i = 0; i < 3; i++) {
      const arrived = new Date(Date.now() - (10 + i) * DAY);
      await db.insert(schema.detentionRecords).values({
        profileId: driverC.profileId,
        loadId: null,
        site: "delivery",
        placeLabel: "Test DC",
        graceMinutes: 120,
        arrivedAt: arrived,
        departedAt: new Date(arrived.getTime() + 5 * HOUR),
      });
    }
    // Miles: 1,200 in the prior 30 days, 100 in the last 30.
    await db.insert(schema.trips).values({
      profileId: driverC.profileId,
      startedAt: new Date(Date.now() - 45 * DAY),
      endedAt: new Date(Date.now() - 44 * DAY),
      totalMiles: 1200,
      totalPay: 0,
      stateBreakdown: "[]",
    });
    await db.insert(schema.trips).values({
      profileId: driverC.profileId,
      startedAt: new Date(Date.now() - 5 * DAY),
      endedAt: new Date(Date.now() - 4 * DAY),
      totalMiles: 100,
      totalPay: 0,
      stateBreakdown: "[]",
    });
    // A second missed deadline for C (the first was in (g)) —
    // seeded as a row stated before the deadline, like (g).
    const D4 = Date.now() - 6 * HOUR;
    await db.insert(schema.homeTimeCommitments).values({
      companyId: fleet1,
      driverUsername: "htdriver3",
      kind: "by_date",
      homeByAt: new Date(D4),
      everyNDays: null,
      anchorAt: null,
      setBy: "driver",
      createdBy: "htdriver3",
      note: null,
      effectiveFrom: new Date(D4 - 7 * DAY),
      effectiveTo: null,
    });
    await addChain("driver", null, "duty_change", { state: "driving", at: new Date(D4 + HOUR).toISOString(), location: "Dallas, TX", username: "htdriver3", source: "manual" }, new Date(D4 + HOUR).toISOString());

    const view = await Actions.getHomeTime.handler(cCtx, { driverUsername: null } as never);
    const keys = view.signals.map((s) => s.key).sort();
    expect(keys).toEqual(["detention_overruns", "miles_down", "missed_home_time"]);
    expect(view.hitRate.missed).toBe(2);
    // The fleet board carries the same signals for C, framed as
    // facts to check on.
    const board = await Actions.getFleetHomeTime.handler(ownerCtx, {} as never);
    const crow = board.drivers.find((d) => d.username === "htdriver3")!;
    expect(crow.signals.map((s) => s.key).sort()).toEqual(["detention_overruns", "miles_down", "missed_home_time"]);
    expect(crow.hitRate.total).toBe(4);
  });
});
