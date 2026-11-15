// regulatoryFixesFlow.test.ts — INTEGRATION tests for the
// regulatory audit fixes build (2026-11-15), run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   A3 cycle type — a 60/7 driver caps at 60 in 7 days on the duty
//       feed and the DOT packet (and reads 70/8 until they change
//       the setting); the packet prints the cycle it reckoned.
//   A1 certification — closing with a typed name seals the
//       certification into daily_log_close and shows on the log
//       list, the export, and the packet; closing without one reads
//       "not yet certified" until certifyDailyLog seals it; a
//       certification is never rewritten.
//   A2 unit numbers — the packet day carries the truck unit from
//       the day's signed DVIR snapshot, source-labelled.
//   A5 DVIR repair certification — a DVIR-linked maintenance close
//       without the certification is refused; with it, the
//       certification lands on the DVIR record (listDvirs + packet).
//   T1/T2 packet transfer — the packet resolves as a Library PDF;
//       emailing with unconfigured mail reports plainly and seals
//       nothing; with a working transport it seals packet_emailed
//       (address + days covered, no packet contents).
//   Remark gate (owner addition) — getInspectionSealedState tracks
//       sealed-in-scope only; a dismissal is not a sealing.
//   F1 — a duty change sealed with NO place (no GPS fix) carries
//       null city/state, never blocks, and the packet prints
//       "not recorded" for its segments.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported. The chain is one timeline per
// database, so describes run in file order and the cycle narrative
// (which reads the whole timeline through the packet) runs FIRST,
// before any other driver seals a duty change.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-regfix-"));
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
const daysAgoUtc = (n: number) => new Date(T0 - n * 86400000).toISOString().slice(0, 10);

type PrivResult = {
  ok: boolean; status: number | null; notConfigured: boolean; providerId: string | null;
  errorMessage: string | null; detail: string | null; id: string | null;
};
const privStub = async (): Promise<PrivResult> => ({
  ok: false, status: null, notConfigured: true, providerId: null, errorMessage: null, detail: "test stub", id: null,
});
const privSentStub = async (): Promise<PrivResult> => ({
  ok: true, status: 200, notConfigured: false, providerId: "test-provider-1", errorMessage: null, detail: null, id: null,
});

interface SeededUser { accountId: number; profileId: number; username: string; email: string }

async function seedUser(username: string, extra: Record<string, unknown> = {}): Promise<SeededUser> {
  const email = `${username}@test.local`;
  const acct = await db.insert(schema.accounts).values({ email, passwordHash: null, status: "active" }).returning({ id: schema.accounts.id });
  const prof = await db.insert(schema.profile).values({
    accountId: acct[0]!.id, socialUsername: username, plan: "diamond",
    heightFt: 6, heightIn: 1, weightLbs: 200, lengthFt: 13, mpg: 7, dieselPrice: 4, tankRangeMi: 800,
    ...extra,
  }).returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: username });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser, stub: typeof privStub = privStub): CtxT {
  return createInvocation({
    executePrivileged: stub as never,
    viewer: { accountId: u.accountId, profileId: u.profileId, username: u.username, email: u.email, isOwner: false, status: "active", totpPending: false, hasTeamSeat: false, sessionId: 1 },
  }).ctx as unknown as CtxT;
}

let chainSeq = 0;
async function seedChain(event: string, refKind: string, refId: number | null, payload: Record<string, unknown>) {
  chainSeq += 1;
  await db.insert(schema.chainLog).values({
    refKind, refId, sessionId: null, event,
    payload: JSON.stringify(payload),
    prevHash: "test-prev", hash: `test-reg-${chainSeq}-${Math.random().toString(36).slice(2)}`,
  });
}
const seedDuty = (username: string, state: string, atIso: string) =>
  seedChain("duty_change", "driver", null, { state, at: atIso, location: null, username, source: "manual", autoStage: null, stillSince: null });

async function chainEvents(event: string): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event));
  return rows.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
}

// ---------------------------------------------------------------- A3
const cyc = await seedUser("cycledriver");
// Seven 9-hour duty blocks inside the trailing 7 days = 63h of duty:
// over the 60/7 cap, under the 70/8 cap.
for (let d = 6; d >= 0; d--) {
  await seedDuty(cyc.username, "on_duty", isoAgo(d * 24 + 13));
  await seedDuty(cyc.username, "off_duty", isoAgo(d * 24 + 4));
}
const cycCtx = ctxFor(cyc);

describe("A3 — cycle type end to end (60/7 caps at 60)", () => {
  // The packet reckons over the whole effective timeline (the app's
  // one-driver-per-database staging design), and bun runs every
  // flow suite against one shared test database — so absolute
  // clock values from OTHER suites' rows are not this test's to
  // assert. What is: (1) the setting wiring (profile → duty feed →
  // packet), (2) the packet's clocks EQUAL the shared engine's
  // reckoning of the same timeline under the set cycle (no third
  // copy, no hard-coded 70/8), and (3) the cap itself — this
  // driver's own 63h in 7 days alone exceeds 60, so at 60/7 the
  // remaining cycle is 0 no matter what else the timeline holds.
  test("default is 70/8 everywhere, and the packet runs the shared engine under it", async () => {
    const prof = await Actions.getProfile.handler(cycCtx, {});
    expect(prof.profile?.cycleType).toBe("70/8");
    const duty = await Actions.listDuty.handler(cycCtx, { limit: 500 });
    expect(duty.cycleType).toBe("70/8");
    const packet = await Actions.getInspectionPacket.handler(cycCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    expect(packet.cycleType).toBe("70/8");
    expect(packet.packetText).toContain("Cycle remaining (70h/8-day)");
    const engine = hosClocksFromEvents(duty.events, Date.now(), "70/8");
    expect(packet.hos.cycleRemainH).toBeCloseTo(engine.cycleRemainH, 1);
    // (No absolute bound here: in the shared test timeline other
    // suites' status changes interleave with this driver's blocks
    // and re-cut the segments — the merged total is whatever the
    // sealed record says. The engine equality above is the pin.)
  });

  test("switching the profile to 60/7 caps the same record at 60 everywhere", async () => {
    const prof = (await Actions.getProfile.handler(cycCtx, {})).profile!;
    const saved = await Actions.saveProfile.handler(cycCtx, { ...prof, cycleType: "60/7" });
    expect(saved).toBeTruthy();
    const after = await Actions.getProfile.handler(cycCtx, {});
    expect(after.profile?.cycleType).toBe("60/7");
    const duty = await Actions.listDuty.handler(cycCtx, { limit: 500 });
    expect(duty.cycleType).toBe("60/7");
    const packet = await Actions.getInspectionPacket.handler(cycCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    expect(packet.cycleType).toBe("60/7");
    // 63h of this driver's own duty inside 7 days exceeds the 60h
    // cap by itself — the cycle reads exhausted.
    expect(packet.hos.cycleRemainH).toBe(0);
    const engine = hosClocksFromEvents(duty.events, Date.now(), "60/7");
    expect(engine.cycleRemainH).toBe(0);
    expect(packet.packetText).toContain("Cycle remaining (60h/7-day)");
  });
});

// ---------------------------------------------------------------- A1
const cert = await seedUser("certdriver");
const certCtx = ctxFor(cert);

describe("A1 — log certification (49 CFR 395.8(d)(5))", () => {
  test("closing with a typed name seals the certification into daily_log_close", async () => {
    const started = await Actions.startDailyLog.handler(certCtx, {
      logDate: todayUtc, startMiles: 100000, startMilesSource: "Driver-entered odometer (no ELD connected)",
      fuelStart: null, hosStart: "{}", pretrip: JSON.stringify({ result: "pass", defects: [] }),
    });
    expect(started.ok).toBe(true);
    const closed = await Actions.closeDailyLog.handler(certCtx, {
      logId: started.logId!, finishMiles: 100100, fuelUsage: null, hosEnd: "{}",
      loadsDelivered: 0, detentionText: null, certifyName: "Cert Driver",
    });
    expect(closed.ok).toBe(true);
    const logs = (await Actions.listDailyLogs.handler(certCtx, { limit: 10 })).logs;
    const log = logs.find((l) => l.id === started.logId)!;
    expect(log.certifiedName).toBe("Cert Driver");
    expect(log.certifiedAt).toBeTruthy();
    const closes = await chainEvents("daily_log_close");
    const mine = closes.find((p) => p.logId === started.logId) as { certification?: { name: string; statement: string; logDate: string } | null };
    expect(mine.certification?.name).toBe("Cert Driver");
    expect(mine.certification?.statement).toBe("I certify these entries are true and correct");
    expect(mine.certification?.logDate).toBe(todayUtc);
    const exported = await Actions.exportDailyLogs.handler(certCtx, { logId: started.logId! });
    expect(exported.text).toContain("Certification (49 CFR 395.8(d)(5))");
    expect(exported.text).toContain("Cert Driver");
    const packet = await Actions.getInspectionPacket.handler(certCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    const day = packet.days.find((d) => d.date === todayUtc)!;
    expect(day.certifiedName).toBe("Cert Driver");
    expect(packet.packetText).toContain("Certification (49 CFR 395.8(d)(5))");
  });

  test("closing without a name reads 'not yet certified' until certifyDailyLog seals it — once", async () => {
    const started = await Actions.startDailyLog.handler(certCtx, {
      logDate: daysAgoUtc(1), startMiles: 99900, startMilesSource: "Driver-entered odometer (no ELD connected)",
      fuelStart: null, hosStart: "{}", pretrip: JSON.stringify({ result: "pass", defects: [] }),
    });
    expect(started.ok).toBe(true);
    const closed = await Actions.closeDailyLog.handler(certCtx, {
      logId: started.logId!, finishMiles: 100000, fuelUsage: null, hosEnd: "{}",
      loadsDelivered: 0, detentionText: null,
    });
    expect(closed.ok).toBe(true);
    let logs = (await Actions.listDailyLogs.handler(certCtx, { limit: 10 })).logs;
    expect(logs.find((l) => l.id === started.logId)!.certifiedName).toBeNull();
    const exported = await Actions.exportDailyLogs.handler(certCtx, { logId: started.logId! });
    expect(exported.text).toContain("Certification: not yet certified");
    const certified = await Actions.certifyDailyLog.handler(certCtx, { logId: started.logId!, certifyName: "Cert Driver" });
    expect(certified.ok).toBe(true);
    logs = (await Actions.listDailyLogs.handler(certCtx, { limit: 10 })).logs;
    expect(logs.find((l) => l.id === started.logId)!.certifiedName).toBe("Cert Driver");
    const seals = await chainEvents("daily_log_certified");
    expect(seals.some((p) => p.logId === started.logId)).toBe(true);
    // A certification is never rewritten.
    const again = await Actions.certifyDailyLog.handler(certCtx, { logId: started.logId!, certifyName: "Someone Else" });
    expect(again.ok).toBe(false);
    logs = (await Actions.listDailyLogs.handler(certCtx, { limit: 10 })).logs;
    expect(logs.find((l) => l.id === started.logId)!.certifiedName).toBe("Cert Driver");
  });
});

// ------------------------------------------------------- A5 + A2 flow
const dv = await seedUser("dvirdriver", {
  truckYear: 2021, truckMake: "Kenworth", truckModel: "W900", truckUnitNumber: "12",
  trailerYear: 2022, trailerMake: "Fontaine", trailerType: "step_deck",
});
const dvCtx = ctxFor(dv);

describe("A5 — DVIR repair certification + A2 packet units", () => {
  test("a DVIR-linked close needs the certification; with it, the DVIR record carries it", async () => {
    const res = await Actions.saveDvir.handler(dvCtx, {
      kind: "pretrip",
      items: [{ item: "Brakes", ok: false }, { item: "Tires & wheels", ok: true }],
      defects: [{ item: "Brakes", note: "Pedal soft", critical: true }],
      signedName: "Dvir Driver", odometer: 310000, lat: null, lon: null, safeToOperate: false,
    });
    expect(res).toBeTruthy();
    const entries = (await Actions.listMaintenanceLog.handler(dvCtx, {})).entries;
    const entry = entries.find((e) => e.dvirId != null)!;
    expect(entry).toBeTruthy();

    const refused = await Actions.setMaintenanceLogEntryStatus.handler(dvCtx, { id: entry.id, status: "closed" });
    expect(refused.ok).toBe(false);
    const open1 = await Actions.getOpenDvirDefects.handler(dvCtx, {});
    expect(open1.defects.some((d) => d.item === "Brakes")).toBe(true);

    const closed = await Actions.setMaintenanceLogEntryStatus.handler(dvCtx, {
      id: entry.id, status: "closed", certifiedBy: "Bayou Truck Repair", repairDetermination: "repaired",
    });
    expect(closed.ok).toBe(true);
    const open2 = await Actions.getOpenDvirDefects.handler(dvCtx, {});
    expect(open2.defects.some((d) => d.item === "Brakes")).toBe(false);

    const seals = await chainEvents("dvir_repair_certified");
    expect(seals.some((p) => p.item === "Brakes" && p.certifiedBy === "Bayou Truck Repair" && p.determination === "repaired")).toBe(true);

    const reports = (await Actions.listDvirs.handler(dvCtx, { limit: 5 })).reports;
    const brakes = reports[0]!.defects.find((d) => d.item === "Brakes")!;
    expect(brakes.certification?.certifiedBy).toBe("Bayou Truck Repair");
    expect(brakes.certification?.determination).toBe("repaired");

    // The packet shows the certification AND the day's unit number
    // from the DVIR snapshot (A2).
    const packet = await Actions.getInspectionPacket.handler(dvCtx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    const pDefect = packet.dvirs.flatMap((r) => r.defects).find((d) => d.item === "Brakes")!;
    expect(pDefect.certification?.certifiedBy).toBe("Bayou Truck Repair");
    expect(packet.packetText).toContain("Repair certification (49 CFR 396.11(a)(2)): repaired — certified by Bayou Truck Repair");
    const day = packet.days.find((d) => d.date === todayUtc)!;
    expect(day.truckUnit).toBe("12");
    expect(day.unitSource).toBe("dvir");
    expect(packet.packetText).toContain("Unit 12");
  });
});

// ------------------------------------------------------------- T1/T2
const mail = await seedUser("maildriver");
const mailCtx = ctxFor(mail);
const mailSentCtx = ctxFor(mail, privSentStub);

describe("T1/T2 — packet PDF + packet email", () => {
  test("the packet resolves as a Library PDF (inspection kind)", async () => {
    const doc = await Actions.getLibraryDocument.handler(mailCtx, { ref: `inspection:${todayUtc}:0` });
    expect(doc.ok).toBe(true);
    expect(doc.mime).toBe("application/pdf");
    expect(doc.filename).toBe("stonemiles-dot-inspection-packet.pdf");
    const bytes = Buffer.from(doc.dataBase64!, "base64");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("unconfigured mail: plain refusal, and NO packet_emailed seal", async () => {
    const r = await Actions.sendInspectionPacketEmail.handler(mailCtx, {
      toEmail: "officer@example.gov", todayLocal: todayUtc, utcOffsetMinutes: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("isn't set up");
    const seals = await chainEvents("packet_emailed");
    expect(seals.length).toBe(0);
  });

  test("a real send seals packet_emailed with address + days covered only", async () => {
    const r = await Actions.sendInspectionPacketEmail.handler(mailSentCtx, {
      toEmail: "officer@example.gov", todayLocal: todayUtc, utcOffsetMinutes: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("sent");
    const seals = await chainEvents("packet_emailed");
    expect(seals.length).toBe(1);
    const seal = seals[0] as { to?: string; daysCovered?: { first: string; last: string } };
    expect(seal.to).toBe("officer@example.gov");
    expect(seal.daysCovered?.last).toBe(todayUtc);
    expect(seal.daysCovered?.first).toBe(daysAgoUtc(7));
    const sends = await db.select().from(schema.documentSends).where(eq(schema.documentSends.docKind, "inspection"));
    expect(sends.length).toBe(1);
    expect(sends[0]!.status).toBe("sent");
  });
});

// ------------------------------------------------------- remark gate
const gate = await seedUser("gatedriver");
const gateCtx = ctxFor(gate);

describe("remark gate — getInspectionSealedState (owner addition 2026-11-15)", () => {
  test("nothing sealed → both kinds report not sealed; a dismissal changes nothing", async () => {
    // Seeded here, not at module level: the packet reads the whole
    // chain timeline (one driver per database in the app's staging
    // design), and the A3 narrative above must run on its own rows.
    await seedDuty(gate.username, "sleeper", isoAgo(30));
    await seedDuty(gate.username, "on_duty", isoAgo(20));
    expect((await Actions.getInspectionSealedState.handler(gateCtx, { kind: "pretrip" })).sealed).toBe(false);
    expect((await Actions.getInspectionSealedState.handler(gateCtx, { kind: "posttrip" })).sealed).toBe(false);
    const prompt = await Actions.getInspectionPrompts.handler(gateCtx, {});
    await Actions.dismissInspectionPrompt.handler(gateCtx, { kind: "pretrip", key: prompt.prompt!.key });
    expect((await Actions.getInspectionSealedState.handler(gateCtx, { kind: "pretrip" })).sealed).toBe(false);
  });

  test("sealing the pre-trip flips its gate; the post-trip gate follows its own sealing", async () => {
    await Actions.saveDvir.handler(gateCtx, {
      kind: "pretrip",
      items: [{ item: "Brakes", ok: true }],
      defects: [],
      signedName: "Gate Driver", odometer: null, lat: null, lon: null, safeToOperate: true,
    });
    expect((await Actions.getInspectionSealedState.handler(gateCtx, { kind: "pretrip" })).sealed).toBe(true);
    expect((await Actions.getInspectionSealedState.handler(gateCtx, { kind: "posttrip" })).sealed).toBe(false);
    await Actions.saveDvir.handler(gateCtx, {
      kind: "posttrip",
      items: [{ item: "Brakes", ok: true }],
      defects: [],
      signedName: "Gate Driver", odometer: null, lat: null, lon: null, safeToOperate: true,
    });
    expect((await Actions.getInspectionSealedState.handler(gateCtx, { kind: "posttrip" })).sealed).toBe(true);
  });
});

// ---------------------------------------------------------------- F1
const f1 = await seedUser("f1driver");
const f1Ctx = ctxFor(f1);

describe("F1 — a duty change with no GPS fix seals with honest nulls", () => {
  test("no city/state/location: seals fine, lists nulls, packet prints 'not recorded'", async () => {
    await Actions.setDuty.handler(f1Ctx, { state: "on_duty", remark: "fuel" });
    const duty = await Actions.listDuty.handler(f1Ctx, { limit: 50 });
    const ev = duty.events[duty.events.length - 1]!;
    expect(ev.state).toBe("on_duty");
    expect(ev.city).toBeNull();
    expect(ev.usState).toBeNull();
    expect(ev.location).toBeNull();
    const packet = await Actions.getInspectionPacket.handler(f1Ctx, { todayLocal: todayUtc, utcOffsetMinutes: 0 });
    expect(packet.packetText).toContain("Location: not recorded");
  });
});
