// hosDutyReviewFlow.test.ts — INTEGRATION tests for the B1 + B2
// HOS build (owner's rulings 2026-11-15), run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   B1 federal pattern (49 CFR Part 395 Appendix A §4.4.1.2) —
//       the only automatic duty change is the stopped 5-minute
//       on-duty default: setDuty seals it with the federal default
//       remark; an automatic change aimed at Off Duty or Sleeper
//       Berth is refused and the refusal seals; offline captures
//       carrying the RETIRED 2-min/10-min stages are refused, the
//       new stage seals; the shared HOS engine reckons a default
//       on-duty segment as break-satisfying non-driving time.
//   B2 driver review (49 CFR 395.30 doctrine) — an owner's
//       correction to a driver's entry lands PENDING (driver
//       notified in-app, original entry operative, packet prints
//       PENDING); only the targeted driver can review, once;
//       dispute requires a note, keeps the original operative,
//       prints DISPUTED + the note in the packet, keeps the note
//       OUT of the chain, and notifies the owner; acknowledge
//       makes the correction stand; self-corrections are exempt
//       and apply on their seal.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported. The chain is one timeline per
// database shared with the other flow suites, so every assertion
// is scoped to the ids/usernames this file creates.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-hosreview-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { hosClocksFromEvents } = await import("./hosEngine");
const { eq } = await import("drizzle-orm");

type CtxT = Ctx;
const db = getDb();
const HOUR = 3_600_000;
const T0 = Date.now();
const isoAgo = (h: number) => new Date(T0 - h * HOUR).toISOString();
const todayUtc = new Date().toISOString().slice(0, 10);

type PrivResult = {
  ok: boolean; status: number | null; notConfigured: boolean; providerId: string | null;
  errorMessage: string | null; detail: string | null; id: string | null;
};
const privStub = async (): Promise<PrivResult> => ({
  ok: false, status: null, notConfigured: true, providerId: null, errorMessage: null, detail: "test stub", id: null,
});

interface SeededUser { accountId: number; profileId: number; username: string; email: string }

async function seedUser(username: string): Promise<SeededUser> {
  const email = `${username}@test.local`;
  const acct = await db.insert(schema.accounts).values({ email, passwordHash: null, status: "active" }).returning({ id: schema.accounts.id });
  const prof = await db.insert(schema.profile).values({
    accountId: acct[0]!.id, socialUsername: username, plan: "diamond",
    heightFt: 6, heightIn: 1, weightLbs: 200, lengthFt: 13, mpg: 7, dieselPrice: 4, tankRangeMi: 800,
  }).returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: { accountId: u.accountId, profileId: u.profileId, username: u.username, email: u.email, isOwner: false, status: "active", totpPending: false, hasTeamSeat: false, sessionId: 1 },
  }).ctx as unknown as CtxT;
}

let chainSeq = 0;
async function seedDuty(username: string, state: string, atIso: string): Promise<number> {
  chainSeq += 1;
  const rows = await db.insert(schema.chainLog).values({
    refKind: "driver", refId: null, sessionId: null, event: "duty_change",
    payload: JSON.stringify({ state, at: atIso, location: null, city: "Mobile", usState: "AL", username, source: "manual", autoStage: null, stillSince: null, remark: "other", remarkNote: null, remarkSource: "driver" }),
    prevHash: "test-prev", hash: `test-hosrev-${chainSeq}-${Math.random().toString(36).slice(2)}`,
  }).returning({ id: schema.chainLog.id });
  return rows[0]!.id;
}

async function chainRowByHash(hash: string) {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.hash, hash));
  return rows[0];
}

async function notificationsFor(username: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.username, username));
}

// ---- Cast -------------------------------------------------------------
const owner = await seedUser("hosowner");
const driver = await seedUser("hosdriver");
const solo = await seedUser("hossolo");
const comp = await db.insert(schema.companies).values({ name: "HOS Review Fleet LLC", ownerUsername: owner.username }).returning({ id: schema.companies.id });
await db.insert(schema.companyMembers).values({ companyId: comp[0]!.id, username: owner.username, role: "owner" });
await db.insert(schema.companyMembers).values({ companyId: comp[0]!.id, username: driver.username, role: "driver" });
const ownerCtx = ctxFor(owner);
const driverCtx = ctxFor(driver);
const soloCtx = ctxFor(solo);

// ------------------------------------------------------------------ B1
describe("B1 — the federal stopped default, server side", () => {
  test("the default seals On Duty with the federal default remark", async () => {
    const r = await Actions.setDuty.handler(driverCtx, {
      state: "on_duty",
      source: "auto_no_movement",
      autoStage: "on_duty_default",
      stillSince: isoAgo(0.1),
    });
    const row = await chainRowByHash(r.hash);
    expect(row?.event).toBe("duty_change");
    const p = JSON.parse(row!.payload) as Record<string, unknown>;
    expect(p.state).toBe("on_duty");
    expect(p.source).toBe("auto_no_movement");
    expect(p.autoStage).toBe("on_duty_default");
    expect(p.remarkNote).toBe("Stopped 5 min — no response; on-duty default");
    expect(p.remarkSource).toBe("default");
    expect(p.username).toBe(driver.username);
  });

  test("an automatic change can NEVER land on Off Duty or Sleeper Berth", async () => {
    for (const state of ["off_duty", "sleeper"] as const) {
      const r = await Actions.setDuty.handler(driverCtx, {
        state,
        source: "auto_no_movement",
        autoStage: "on_duty_default",
        stillSince: isoAgo(0.1),
      });
      const row = await chainRowByHash(r.hash);
      expect(row?.event).toBe("duty_auto_swap_rejected");
      const p = JSON.parse(row!.payload) as Record<string, unknown>;
      expect(p.attemptedState).toBe(state);
    }
    // No duty_change for this driver carries an automatic rest.
    const changes = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "duty_change"));
    const autoRest = changes.filter((c) => {
      const p = JSON.parse(c.payload) as Record<string, unknown>;
      return p.username === driver.username && p.source === "auto_no_movement" && p.state !== "on_duty";
    });
    expect(autoRest).toHaveLength(0);
  });

  test("an offline capture with a RETIRED stage is refused; the new stage seals", async () => {
    const legacy = {
      captureId: "cap-hosrev-legacy",
      state: "off_duty" as const,
      source: "auto_no_movement" as const,
      // A capture queued by the pre-B1 client: the retired pairing.
      autoStage: "off_duty_2min" as unknown as "on_duty_default",
      stillSince: isoAgo(1),
      capturedAt: isoAgo(1),
    };
    const refused = await Actions.syncDutyCapture.handler(driverCtx, legacy);
    expect(refused.status).toBe("refused");
    expect(refused.error).toContain("Automatic duty change refused");

    const sealed = await Actions.syncDutyCapture.handler(driverCtx, {
      captureId: "cap-hosrev-default",
      state: "on_duty",
      source: "auto_no_movement",
      autoStage: "on_duty_default",
      stillSince: isoAgo(1),
      capturedAt: isoAgo(1),
    });
    expect(sealed.status).toBe("sealed");
    const row = await chainRowByHash(sealed.hash!);
    const p = JSON.parse(row!.payload) as Record<string, unknown>;
    expect(p.state).toBe("on_duty");
    expect(p.offlineCapture).toBe(true);
    expect(p.remarkNote).toBe("Stopped 5 min — no response; on-duty default");
  });

  test("break replay: a default on-duty segment satisfies the 30-minute break like any on-duty-not-driving", () => {
    const H = HOUR;
    const base = Date.parse("2026-11-10T00:00:00Z");
    // Span-start events, the hosEngine.test.ts shape: an event
    // marks the START of a state; ends derive from the next event.
    const evs = (rows: [string, number, number][]) =>
      rows.map(([state, from]) => ({ state, at: new Date(base + from * H).toISOString() }));
    // 10h rest, 8h driving, then the stopped default's shape — 30
    // minutes On Duty (not driving) — then 1h more driving: the
    // break is satisfied, 7h of break clock remain after 1h back.
    const withDefault = hosClocksFromEvents(
      evs([["off_duty", 0, 10], ["driving", 10, 18], ["on_duty", 18, 18.5], ["driving", 18.5, 19.5]]),
      base + 19.5 * H,
    );
    expect(withDefault.breakRemainH).toBeCloseTo(7, 5);
    // Only 20 minutes of it: the break is NOT satisfied.
    const tooShort = hosClocksFromEvents(
      evs([["off_duty", 0, 10], ["driving", 10, 18], ["on_duty", 18, 18 + 1 / 3], ["driving", 18 + 1 / 3, 19]]),
      base + 19 * H,
    );
    expect(tooShort.breakRemainH).toBeCloseTo(0, 5);
  });
});

// ------------------------------------------------------------------ B2
describe("B2 — driver acknowledge/dispute on owner corrections", () => {
  let entryA = 0;
  let correctionA = 0;
  let entryB = 0;
  let correctionB = 0;

  test("an owner's correction lands PENDING: original operative, driver notified, packet prints PENDING", async () => {
    entryA = await seedDuty(driver.username, "driving", isoAgo(3));
    const fix = await Actions.editDutyLog.handler(ownerCtx, {
      eventId: entryA,
      targetUsername: driver.username,
      correctedState: "on_duty",
      correctedAt: isoAgo(3),
      reason: "Driver was fueling, not driving",
    });
    expect(fix.ok).toBe(true);
    const corrRow = await chainRowByHash(fix.hash!);
    correctionA = corrRow!.id;

    const duty = await Actions.listDuty.handler(driverCtx, { limit: 500 });
    const edit = duty.edits.find((e) => e.id === correctionA);
    expect(edit?.reviewState).toBe("pending");
    const ev = duty.events.find((e) => e.id === entryA);
    expect(ev?.state).toBe("driving"); // the original still stands
    expect(ev?.edited).toBe(false);
    expect(ev?.correctionReview).toBe("pending");
    expect(duty.pendingReviewCount).toBe(1);

    const notes = await notificationsFor(driver.username);
    expect(notes.some((n) => n.title.includes("corrected"))).toBe(true);

    const packet = await Actions.getInspectionPacket.handler(driverCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    const allNotes = packet.days.flatMap((d) => d.dutyNotes).join("\n");
    expect(allNotes).toContain("PENDING");
    expect(packet.packetText).toContain("PENDING");
  });

  test("only the targeted driver can review — and a dispute needs a note", async () => {
    const byOwner = await Actions.reviewDutyCorrection.handler(ownerCtx, { correctionId: correctionA, decision: "acknowledge" });
    expect(byOwner.ok).toBe(false);
    const noNote = await Actions.reviewDutyCorrection.handler(driverCtx, { correctionId: correctionA, decision: "dispute", note: "  " });
    expect(noNote.ok).toBe(false);
    expect(noNote.error).toContain("needs a short note");
    // Still pending after both refusals.
    const duty = await Actions.listDuty.handler(driverCtx, { limit: 500 });
    expect(duty.edits.find((e) => e.id === correctionA)?.reviewState).toBe("pending");
  });

  test("dispute: original stays operative, dispute + note print in the packet, note stays OFF the chain, owner notified", async () => {
    const r = await Actions.reviewDutyCorrection.handler(driverCtx, {
      correctionId: correctionA,
      decision: "dispute",
      note: "I was rolling to the fuel island, not parked — GPS lag made it look stopped.",
    });
    expect(r.ok).toBe(true);

    const duty = await Actions.listDuty.handler(driverCtx, { limit: 500 });
    const edit = duty.edits.find((e) => e.id === correctionA);
    expect(edit?.reviewState).toBe("disputed");
    expect(edit?.disputeNote).toContain("fuel island");
    const ev = duty.events.find((e) => e.id === entryA);
    expect(ev?.state).toBe("driving");
    expect(ev?.correctionReview).toBe("disputed");
    expect(duty.pendingReviewCount).toBe(0);

    const packet = await Actions.getInspectionPacket.handler(driverCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    const allNotes = packet.days.flatMap((d) => d.dutyNotes).join("\n");
    expect(allNotes).toContain("DISPUTED");
    expect(allNotes).toContain("fuel island");

    // The chain seal carries ids + state only — never the note.
    const seals = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "duty_correction_review"));
    const mine = seals.map((s) => s.payload).filter((p) => p.includes(`"correctionId":${correctionA}`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toContain("fuel island");
    expect(JSON.parse(mine[0]!)["reviewState"]).toBe("disputed");

    const ownerNotes = await notificationsFor(owner.username);
    expect(ownerNotes.some((n) => n.title.includes("disputed"))).toBe(true);

    // Reviewed once — a second decision is refused.
    const again = await Actions.reviewDutyCorrection.handler(driverCtx, { correctionId: correctionA, decision: "acknowledge" });
    expect(again.ok).toBe(false);
    expect(again.error).toContain("already disputed");
  });

  test("acknowledge: the correction stands and applies to the timeline", async () => {
    entryB = await seedDuty(driver.username, "off_duty", isoAgo(2));
    const fix = await Actions.editDutyLog.handler(ownerCtx, {
      eventId: entryB,
      targetUsername: driver.username,
      correctedState: "sleeper",
      correctedAt: isoAgo(2),
      reason: "Driver was in the sleeper, not off duty",
    });
    expect(fix.ok).toBe(true);
    correctionB = (await chainRowByHash(fix.hash!))!.id;

    let duty = await Actions.listDuty.handler(driverCtx, { limit: 500 });
    expect(duty.events.find((e) => e.id === entryB)?.state).toBe("off_duty"); // pending: not yet applied
    expect(duty.pendingReviewCount).toBe(1);

    const r = await Actions.reviewDutyCorrection.handler(driverCtx, { correctionId: correctionB, decision: "acknowledge" });
    expect(r.ok).toBe(true);

    duty = await Actions.listDuty.handler(driverCtx, { limit: 500 });
    const ev = duty.events.find((e) => e.id === entryB);
    expect(ev?.state).toBe("sleeper");
    expect(ev?.edited).toBe(true);
    expect(ev?.correctionReview).toBe(null);
    expect(duty.edits.find((e) => e.id === correctionB)?.reviewState).toBe("acknowledged");
    expect(duty.pendingReviewCount).toBe(0);

    const packet = await Actions.getInspectionPacket.handler(driverCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    const allNotes = packet.days.flatMap((d) => d.dutyNotes).join("\n");
    expect(allNotes).toContain("acknowledged");
  });

  test("self-corrections are exempt: they apply on their seal with no review state", async () => {
    // The owner correcting their OWN entry.
    const ownEntry = await seedDuty(owner.username, "driving", isoAgo(1));
    const ownFix = await Actions.editDutyLog.handler(ownerCtx, {
      eventId: ownEntry,
      targetUsername: owner.username,
      correctedState: "on_duty",
      correctedAt: isoAgo(1),
      reason: "I was at the fuel desk",
    });
    expect(ownFix.ok).toBe(true);
    const ownCorr = (await chainRowByHash(ownFix.hash!))!.id;
    const ownerDuty = await Actions.listDuty.handler(ownerCtx, { limit: 500 });
    expect(ownerDuty.events.find((e) => e.id === ownEntry)?.state).toBe("on_duty");
    expect(ownerDuty.edits.find((e) => e.id === ownCorr)?.reviewState).toBe(null);
    expect(ownerDuty.pendingReviewCount).toBe(0);
    // And reviewing it is refused — there is nothing to review.
    const review = await Actions.reviewDutyCorrection.handler(ownerCtx, { correctionId: ownCorr, decision: "acknowledge" });
    expect(review.ok).toBe(false);

    // A solo owner-operator's own fix — same exemption.
    const soloEntry = await seedDuty(solo.username, "sleeper", isoAgo(1));
    const soloFix = await Actions.editDutyLog.handler(soloCtx, {
      eventId: soloEntry,
      targetUsername: solo.username,
      correctedState: "off_duty",
      correctedAt: isoAgo(1),
      reason: "I was home, not in the berth",
    });
    expect(soloFix.ok).toBe(true);
    const soloDuty = await Actions.listDuty.handler(soloCtx, { limit: 500 });
    expect(soloDuty.events.find((e) => e.id === soloEntry)?.state).toBe("off_duty");
  });

  test("an employee driver still cannot edit history at all (the review step changes nothing there)", async () => {
    const entry = await seedDuty(driver.username, "driving", isoAgo(0.5));
    const r = await Actions.editDutyLog.handler(driverCtx, {
      eventId: entry,
      targetUsername: driver.username,
      correctedState: "off_duty",
      correctedAt: isoAgo(0.5),
      reason: "Trying to fix my own log",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("can't edit HOS logs");
  });
});
