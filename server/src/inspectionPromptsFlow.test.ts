// inspectionPromptsFlow.test.ts — INTEGRATION tests for the
// inspection auto-flows + duty remarks build (2026-11-15), run
// against the REAL action handlers over a throwaway migrated
// SQLite database:
//
//   (a) first On Duty of a duty day → getInspectionPrompts returns
//       the pre-trip prompt keyed to the HOS window;
//   (b) dismissing it (sealed) → the prompt is gone for the day;
//   (c) a sealed delivery + a new load in the same window → the
//       post-trip prompt fires for that delivery; sealing the
//       post-trip DVIR clears it;
//   (d) after a 10h reset, the next duty day's pre-trip fires again
//       under a new key — and the prior window's delivery does NOT
//       drag a post-trip across the day boundary;
//   (e) duty remarks: a setDuty with the Fuel quick-pick seals
//       remark + note + city + state + time, readable in listDuty;
//       a setDuty with no remark seals the explicit system default
//       (never remark-less); the pre-trip checklist stamp carries
//       remark "pretrip" + the place stamp; an offline capture
//       seals its driver's remark, and one without a remark seals
//       the honest offline default.
//
// The chain is one timeline per database (the app's standing
// design), so the duty narrative below is ONE driver's sequence.
// The prompt facts are cut per driver before evaluation (own duty
// changes by the username every seal stamps; delivery / pickup
// seals for the driver's OWN loads only), so other suites' chain
// rows in a shared test process cannot raise this driver's prompt.
// Historical duty changes / delivery seals are inserted as chain
// rows directly (readers parse payloads; the hashes are dummies) —
// the live handlers (setDuty, saveDvir, dismiss, sync) do the rest.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-insp-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");

type CtxT = Ctx;
const privStub = async () => ({
  ok: false, status: "not_configured", notConfigured: true, providerId: null, errorMessage: null, detail: "test stub", id: null,
});

const db = getDb();
const HOUR = 3_600_000;
const T0 = Date.now();
const isoAgo = (h: number) => new Date(T0 - h * HOUR).toISOString();
const msAgo = (h: number) => T0 - h * HOUR;

async function seedUser(username: string) {
  const email = `${username}@test.local`;
  const acct = await db.insert(schema.accounts).values({ email, passwordHash: null, status: "active" }).returning({ id: schema.accounts.id });
  const prof = await db.insert(schema.profile).values({
    accountId: acct[0]!.id, socialUsername: username, plan: "diamond",
    heightFt: 6, heightIn: 1, weightLbs: 200, lengthFt: 13, mpg: 7, dieselPrice: 4, tankRangeMi: 800,
  }).returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: { accountId: number; profileId: number; username: string; email: string }): CtxT {
  return createInvocation({
    executePrivileged: privStub as never,
    viewer: { accountId: u.accountId, profileId: u.profileId, username: u.username, email: u.email, isOwner: false, status: "active", totpPending: false, hasTeamSeat: false, sessionId: 1 },
  }).ctx as unknown as CtxT;
}

let chainSeq = 0;
async function seedChain(event: string, refKind: string, refId: number | null, payload: Record<string, unknown>) {
  chainSeq += 1;
  await db.insert(schema.chainLog).values({
    refKind, refId, sessionId: null, event,
    payload: JSON.stringify(payload),
    prevHash: "test-prev", hash: `test-insp-${chainSeq}-${Math.random().toString(36).slice(2)}`,
  });
}
const seedDuty = (username: string, state: string, atIso: string) =>
  seedChain("duty_change", "driver", null, { state, at: atIso, location: null, username, source: "manual", autoStage: null, stillSince: null });

async function insertLoad(profileId: number): Promise<number> {
  const rows = await db.insert(schema.loads).values({ profileId }).returning({ id: schema.loads.id });
  return rows[0]!.id;
}

const driver = await seedUser("inspdriver");
const ctx = ctxFor(driver);

// Day one: sleeper from 30h ago, On Duty since 20h ago — the duty
// window opened at the On Duty (the 10h reset completed 20h ago).
await seedDuty(driver.username, "sleeper", isoAgo(30));
await seedDuty(driver.username, "on_duty", isoAgo(20));

describe("inspection prompts — flow", () => {
  test("(a) first On Duty of the duty day → the pre-trip prompt fires, keyed to the window", async () => {
    const r = await Actions.getInspectionPrompts.handler(ctx, {});
    expect(r.currentDuty).toBe("on_duty");
    expect(r.prompt?.kind).toBe("pretrip");
    expect(r.prompt?.key).toBe(`pretrip:${msAgo(20)}`);
    expect(r.windowStart).toBe(isoAgo(20));
  });

  test("(b) skipping seals the dismissal — the prompt does not re-fire that day", async () => {
    const r = await Actions.getInspectionPrompts.handler(ctx, {});
    await Actions.dismissInspectionPrompt.handler(ctx, { kind: "pretrip", key: r.prompt!.key });
    const after = await Actions.getInspectionPrompts.handler(ctx, {});
    expect(after.prompt).toBeNull();
  });

  test("(c) delivery + new load in the same window → the post-trip prompt fires for that delivery", async () => {
    const loadA = await insertLoad(driver.profileId);
    const loadB = await insertLoad(driver.profileId);
    await seedChain("delivery_confirmed", "load", loadA, { loadId: loadA, at: isoAgo(2) });
    await seedChain("pickup_sealed", "load", loadB, { loadId: loadB, at: isoAgo(1) });
    const r = await Actions.getInspectionPrompts.handler(ctx, {});
    expect(r.prompt?.kind).toBe("posttrip");
    expect(r.prompt?.deliveryLoadId).toBe(loadA);
    expect(r.prompt?.key).toBe(`posttrip:${loadA}:${msAgo(2)}`);
    // Sealing the post-trip clears it (and the pre-trip was dismissed).
    await Actions.saveDvir.handler(ctx, {
      kind: "posttrip",
      items: [{ item: "Brakes", ok: true }],
      defects: [],
      signedName: "Insp Driver",
      odometer: 410000,
      lat: 30.69, lon: -88.04,
      safeToOperate: true,
    });
    const after = await Actions.getInspectionPrompts.handler(ctx, {});
    expect(after.prompt).toBeNull();
  });

  test("(d) the next duty day fires the pre-trip again — and the old delivery drags no post-trip across", async () => {
    // 10.5h in the sleeper from 11h ago, then On Duty 30 min ago:
    // a fresh window opened half an hour ago.
    await seedDuty(driver.username, "sleeper", isoAgo(11));
    await seedDuty(driver.username, "on_duty", isoAgo(0.5));
    const r = await Actions.getInspectionPrompts.handler(ctx, {});
    expect(r.prompt?.kind).toBe("pretrip");
    expect(r.prompt?.key).toBe(`pretrip:${msAgo(0.5)}`);
    expect(r.windowStart).toBe(isoAgo(0.5));
  });
});

describe("duty remarks + city/state stamps — flow", () => {
  test("(e) the Fuel quick-pick seals remark + note + city + state, readable in the log", async () => {
    await Actions.setDuty.handler(ctx, {
      state: "on_duty",
      locationLabel: "Mobile, Alabama",
      city: "Mobile",
      usState: "Alabama",
      remark: "fuel",
      remarkNote: "Filled up at the truck stop",
    });
    const duty = await Actions.listDuty.handler(ctx, { limit: 200 });
    const ev = duty.events.find((e) => e.remark === "fuel");
    expect(ev).toBeTruthy();
    expect(ev!.remarkNote).toBe("Filled up at the truck stop");
    expect(ev!.remarkSource).toBe("driver");
    expect(ev!.city).toBe("Mobile");
    expect(ev!.usState).toBe("Alabama");
    expect(ev!.location).toBe("Mobile, Alabama");
    expect(typeof ev!.at).toBe("string");
  });

  test("(e) a duty change with no remark seals the explicit system default — never remark-less", async () => {
    await Actions.setDuty.handler(ctx, { state: "off_duty" });
    const duty = await Actions.listDuty.handler(ctx, { limit: 200 });
    const ev = duty.events[duty.events.length - 1]!;
    expect(ev.state).toBe("off_duty");
    expect(ev.remark).toBe("other");
    expect(ev.remarkSource).toBe("default");
  });

  test("(e) the pre-trip checklist stamp carries remark 'pretrip' + the place stamp", async () => {
    const r = await Actions.beginDvirChecklist.handler(ctx, {
      kind: "pretrip",
      locationLabel: "Mobile, Alabama",
      city: "Mobile",
      usState: "Alabama",
    });
    expect(r.dutyStamped).toBe(true);
    const duty = await Actions.listDuty.handler(ctx, { limit: 200 });
    const ev = duty.events[duty.events.length - 1]!;
    expect(ev.state).toBe("on_duty");
    expect(ev.source).toBe("pretrip_checklist");
    expect(ev.remark).toBe("pretrip");
    expect(ev.city).toBe("Mobile");
    expect(ev.usState).toBe("Alabama");
  });

  test("(e) offline captures seal their remark; one without seals the honest offline default", async () => {
    const capAt = isoAgo(0.25);
    const r1 = await Actions.syncDutyCapture.handler(ctx, {
      captureId: "insp-cap-1",
      state: "driving",
      locationLabel: "Mobile, Alabama",
      city: "Mobile",
      usState: "Alabama",
      remark: "loading",
      remarkNote: "Dock door 4",
      capturedAt: capAt,
    });
    expect(r1.status).toBe("sealed");
    const duty = await Actions.listDuty.handler(ctx, { limit: 200 });
    const ev = duty.events.find((e) => e.at === new Date(capAt).toISOString());
    expect(ev?.remark).toBe("loading");
    expect(ev?.remarkSource).toBe("driver");
    expect(ev?.city).toBe("Mobile");

    const cap2At = isoAgo(0.1);
    const r2 = await Actions.syncDutyCapture.handler(ctx, {
      captureId: "insp-cap-2",
      state: "off_duty",
      capturedAt: cap2At,
    });
    expect(r2.status).toBe("sealed");
    const duty2 = await Actions.listDuty.handler(ctx, { limit: 200 });
    const ev2 = duty2.events.find((e) => e.at === new Date(cap2At).toISOString());
    expect(ev2?.remark).toBe("other");
    expect(ev2?.remarkSource).toBe("default");
    expect(ev2?.remarkNote).toContain("Captured offline");
  });
});
