// dvirDetention.test.ts — INTEGRATION tests for the DVIR completion
// + detention timer (migration 0122), run against the REAL action
// handlers over a throwaway migrated SQLite database:
//
//   (a) a signed DVIR stamps GPS + truck/trailer identity snapshot +
//       safe-to-operate attestation, and seals into the chain
//   (b) a defect auto-drafts a maintenance entry (mapped category,
//       status "draft"), files its photo as paperwork on the draft,
//       and links back to the DVIR; a defect without a note is refused
//   (c) open-defect carry-over: the defect lists as open until its
//       entry is closed; confirming the draft (edit-save) flips it to
//       "logged" but does NOT clear the defect — closing does
//   (d) detention math: grace default 120, wait + billable past grace;
//       a second ARRIVE returns the running clock; the proof text
//       carries times + place and NO rate/money anywhere
//   (e) on-time fairness: five loads sealed past their appointment
//       but inside sealed destination detention still complete the
//       Lane 1 on-time block; the same lateness without detention
//       does not
//   (f) ownership: another account sees no drafts, no open defects,
//       no detention records, and cannot end a clock it does not own
//
// Pure-math coverage for detention.ts / dvir.ts lives in
// dvirDetentionMath.test.ts.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-dvirdet-"));
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
      truckYear: 2021,
      truckMake: "Kenworth",
      truckModel: "W900",
      truckUnitNumber: "12",
      trailerYear: 2022,
      trailerMake: "Fontaine",
      trailerType: "step_deck",
    })
    .returning({ id: schema.profile.id });
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

const alice = await seedUser("dviralice", "Alice A");
const bob = await seedUser("dvirbob", "Bob B");
const carl = await seedUser("detcarl", "Carl C");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";

// ---- DVIR ----------------------------------------------------------------------

describe("DVIR completion — defects draft maintenance entries", () => {
  test("clean DVIR: identity snapshot + GPS + attestation sealed, no drafts", async () => {
    const res = await Actions.saveDvir.handler(aliceCtx, {
      kind: "pretrip",
      items: [{ item: "Brakes", ok: true }, { item: "Tires & wheels", ok: true }],
      defects: [],
      signedName: "Alice A",
      odometer: 310000,
      lat: 30.69,
      lon: -88.04,
      safeToOperate: true,
    });
    expect(res.draftEntryIds).toEqual([]);
    const list = await Actions.listDvirs.handler(aliceCtx, { limit: 5 });
    const r = list.reports.find((x) => x.id === res.id)!;
    expect(r.truckLabel).toBe("2021 Kenworth W900 · Unit 12");
    expect(r.trailerLabel).toBe("2022 Fontaine · step deck");
    expect(r.safeToOperate).toBe(true);
    expect(r.hasLocation).toBe(true);
    // Sealed: the chain carries the signing event with the snapshot.
    const chain = await getDb().select().from(schema.chainLog);
    const ev = chain.find((c) => c.event === "dvir_signed" && (JSON.parse(c.payload) as { dvirId?: number }).dvirId === res.id);
    expect(ev).toBeTruthy();
    expect((JSON.parse(ev!.payload) as { truckLabel?: string }).truckLabel).toBe("2021 Kenworth W900 · Unit 12");
  });

  test("defect: note required; with a note it drafts a mapped maintenance entry + photo paperwork", async () => {
    await expect(
      Actions.saveDvir.handler(aliceCtx, {
        kind: "pretrip",
        items: [{ item: "Brakes", ok: false }],
        defects: [{ item: "Brakes", note: "  ", critical: true }],
        signedName: "Alice A",
        odometer: 310100,
        lat: null,
        lon: null,
        safeToOperate: false,
      }),
    ).rejects.toThrow(/needs a note/);

    const res = await Actions.saveDvir.handler(aliceCtx, {
      kind: "pretrip",
      items: [{ item: "Brakes", ok: false }, { item: "Lights & reflectors", ok: false }],
      defects: [
        { item: "Brakes", note: "Pedal fades at the third stop", critical: true, photoDataBase64: TINY_PNG_B64, photoMime: "image/png" },
        { item: "Lights & reflectors", note: "Right trailer marker out", critical: false },
      ],
      signedName: "Alice A",
      odometer: 310100,
      lat: 30.69,
      lon: -88.04,
      safeToOperate: false,
    });
    expect(res.criticalDefect).toBe(true);
    expect(res.draftEntryIds.length).toBe(2);

    const log = await Actions.listMaintenanceLog.handler(aliceCtx, {});
    const drafts = log.entries.filter((e) => res.draftEntryIds.includes(e.id));
    expect(drafts.length).toBe(2);
    const brake = drafts.find((e) => e.category === "brakes")!;
    expect(brake.status).toBe("draft");
    expect(brake.description).toBe("DVIR defect — Brakes");
    expect(brake.dvirId).toBe(res.id);
    expect(brake.notes).toContain("Pedal fades at the third stop");
    // The defect photo filed as paperwork on the draft.
    expect(brake.attachments.length).toBe(1);
    expect(brake.attachments[0]!.label).toBe("Defect photo — Brakes");
    expect(brake.attachments[0]!.hasFile).toBe(true);
    const file = await Actions.getMaintenanceLogAttachmentFile.handler(aliceCtx, { id: brake.attachments[0]!.id });
    expect(file.url).toBeTruthy();
    // Lights map to electrical.
    expect(drafts.find((e) => e.category === "electrical")).toBeTruthy();
  });

  test("open defects carry over until the linked entry is CLOSED — confirming alone does not clear", async () => {
    const open1 = await Actions.getOpenDvirDefects.handler(aliceCtx, {});
    expect(open1.defects.length).toBe(2);
    expect(open1.defects[0]!.item).toBe("Brakes"); // critical sorts first
    expect(open1.defects[0]!.critical).toBe(true);
    const brakeEntryId = open1.defects[0]!.entryId!;

    // Confirm the draft by editing it in the log (save flips draft → logged).
    const entry = (await Actions.listMaintenanceLog.handler(aliceCtx, {})).entries.find((e) => e.id === brakeEntryId)!;
    await Actions.saveMaintenanceLogEntry.handler(aliceCtx, {
      id: brakeEntryId,
      performedAt: entry.performedAt,
      odometer: entry.odometer,
      category: "brakes",
      description: entry.description,
      shop: "Bayou Truck Repair",
      cost: 240,
      nextDueMiles: null,
      nextDueAt: null,
      notes: entry.notes,
    });
    const after = (await Actions.listMaintenanceLog.handler(aliceCtx, {})).entries.find((e) => e.id === brakeEntryId)!;
    expect(after.status).toBe("logged");
    // Still open — the repair is logged, not closed.
    const open2 = await Actions.getOpenDvirDefects.handler(aliceCtx, {});
    expect(open2.defects.some((d) => d.entryId === brakeEntryId)).toBe(true);

    await Actions.setMaintenanceLogEntryStatus.handler(aliceCtx, { id: brakeEntryId, status: "closed" });
    const open3 = await Actions.getOpenDvirDefects.handler(aliceCtx, {});
    expect(open3.defects.some((d) => d.entryId === brakeEntryId)).toBe(false);
    expect(open3.defects.length).toBe(1); // the lights defect remains open
  });

  test("truck record export carries the DVIR history", async () => {
    const rec = await Actions.exportTruckRecord.handler(aliceCtx, {});
    expect(rec.text).toContain("INSPECTIONS (DVIR)");
    expect(rec.text).toContain("Brakes");
    expect(rec.csv).toContain("DVIR INSPECTIONS");
    expect(rec.csv).toContain("2021 Kenworth W900");
  });

  test("ownership: bob sees none of alice's drafts or open defects", async () => {
    const bobLog = await Actions.listMaintenanceLog.handler(bobCtx, {});
    expect(bobLog.entries.length).toBe(0);
    const bobOpen = await Actions.getOpenDvirDefects.handler(bobCtx, {});
    expect(bobOpen.defects.length).toBe(0);
    const bobDvirs = await Actions.listDvirs.handler(bobCtx, { limit: 5 });
    expect(bobDvirs.reports.length).toBe(0);
  });
});

// ---- Detention -------------------------------------------------------------------

async function insertLoad(u: SeededUser, fields: Record<string, unknown> = {}): Promise<number> {
  const rows = await getDb()
    .insert(schema.loads)
    .values({ profileId: u.profileId, ...fields })
    .returning({ id: schema.loads.id });
  return rows[0]!.id;
}

describe("detention timer — sealed dock clock", () => {
  test("start snapshots the load appointment + default grace; second ARRIVE returns the running clock", async () => {
    const appt = new Date(Date.now() - 5 * 3600000);
    const loadId = await insertLoad(alice, {
      pickupCity: "Mobile", pickupState: "AL",
      deliveryCity: "Dallas", deliveryState: "TX",
      deliveryText: appt.toISOString(),
    });
    const s1 = await Actions.startDetention.handler(aliceCtx, {
      loadId, site: "delivery", placeLabel: null, graceMinutes: null, apptAt: null, lat: 32.78, lon: -96.8,
    });
    expect(s1.alreadyOpen).toBe(false);
    expect(s1.graceMinutes).toBe(120);
    expect(s1.apptAt).toBe(appt.toISOString());
    const s2 = await Actions.startDetention.handler(aliceCtx, {
      loadId, site: "delivery", placeLabel: null, graceMinutes: null, apptAt: null, lat: null, lon: null,
    });
    expect(s2.alreadyOpen).toBe(true);
    expect(s2.id).toBe(s1.id);

    const end = await Actions.endDetention.handler(aliceCtx, { id: s1.id, lat: 32.78, lon: -96.8 });
    expect(end.waitMinutes).toBeGreaterThanOrEqual(0);
    expect(end.chainHash).toBeTruthy();
    // Ending twice is a no-op read of the sealed record.
    const end2 = await Actions.endDetention.handler(aliceCtx, { id: s1.id, lat: null, lon: null });
    expect(end2.waitMinutes).toBe(end.waitMinutes);
    expect(end2.chainHash).toBe(end.chainHash);
  });

  test("math + proof: 3h25m wait on a 2h grace bills 1h25m of TIME; the proof has no money in it", async () => {
    // Seed a visit directly so the clock math is exact.
    const arrived = new Date("2026-11-10T08:00:00Z");
    const departed = new Date("2026-11-10T11:25:00Z");
    const ins = await getDb()
      .insert(schema.detentionRecords)
      .values({
        profileId: alice.profileId,
        loadId: null,
        site: "delivery",
        placeLabel: "Dallas, TX",
        apptAt: new Date("2026-11-10T08:00:00Z"),
        graceMinutes: 120,
        arrivedAt: arrived,
        departedAt: departed,
        chainHash: "abc123seal",
      })
      .returning({ id: schema.detentionRecords.id });
    const id = ins[0]!.id;
    const list = await Actions.listDetention.handler(aliceCtx, { limit: 30 });
    const rec = list.records.find((r) => r.id === id)!;
    expect(rec.waitMinutes).toBe(205);
    expect(rec.billableMinutes).toBe(85);

    const proof = await Actions.getDetentionProof.handler(aliceCtx, { id });
    expect(proof.text).toContain("Dallas, TX");
    expect(proof.text).toContain("Total wait: 3 h 25 min");
    expect(proof.text).toContain("Time past free time: 1 h 25 min");
    // NEVER a rate or an amount — the proof proves time only.
    expect(proof.text).not.toMatch(/\$/);
    expect(proof.text.toLowerCase()).not.toMatch(/per hour|\/hr|rate of|amount due|invoice/);
    expect(proof.filename).toBe(`stonemiles-detention-${id}.txt`);
  });

  test("ownership: bob cannot see or end alice's detention", async () => {
    const s = await Actions.startDetention.handler(aliceCtx, {
      loadId: null, site: "stop", placeLabel: "Rest area I-10", graceMinutes: 60, apptAt: null, lat: null, lon: null,
    });
    const bobList = await Actions.listDetention.handler(bobCtx, { limit: 30 });
    expect(bobList.records.some((r) => r.id === s.id)).toBe(false);
    await expect(Actions.endDetention.handler(bobCtx, { id: s.id, lat: null, lon: null })).rejects.toThrow();
    await Actions.endDetention.handler(aliceCtx, { id: s.id, lat: null, lon: null });
  });
});

// ---- On-time fairness --------------------------------------------------------------

async function insertChain(event: string, refId: number | null, payload: Record<string, unknown>) {
  await getDb()
    .insert(schema.chainLog)
    .values({
      refKind: "load",
      refId,
      sessionId: null,
      event,
      payload: JSON.stringify(payload),
      prevHash: "test-prev",
      hash: `test-${event}-${refId ?? 0}-${Math.random().toString(36).slice(2)}`,
    });
}

describe("Lane 1 on-time fairness — detention is not the driver's late mark", () => {
  test("loads sealed 90 min past appointment but detained at the dock still complete the block", async () => {
    const base = Date.now() - 30 * 3600000;
    for (let i = 0; i < 5; i++) {
      const appt = new Date(base + i * 6 * 3600000);
      const sealAt = new Date(appt.getTime() + 90 * 60000); // 30 min past the +60 grace
      const loadId = await insertLoad(carl, {
        pickupCity: "Mobile", pickupState: "AL",
        deliveryCity: "Dallas", deliveryState: "TX",
        deliveryText: appt.toISOString(),
      });
      // Sealed detention at the destination covering the whole
      // post-appointment span: arrived at the appointment, released
      // exactly when the POD sealed.
      await getDb().insert(schema.detentionRecords).values({
        profileId: carl.profileId,
        loadId,
        site: "delivery",
        placeLabel: "Dallas, TX",
        apptAt: appt,
        graceMinutes: 120,
        arrivedAt: appt,
        departedAt: sealAt,
        chainHash: "sealed",
      });
      await insertChain("pod_seal", loadId, { loadId, at: sealAt.toISOString() });
    }
    const res = await Actions.getPoints.handler(ctxFor(carl), {});
    expect(res.lanes.totals.lane1).toBeGreaterThanOrEqual(100);
    const rows = await getDb().select().from(schema.pointsLog).where(eq(schema.pointsLog.username, carl.username));
    expect(rows.some((r) => r.source === "lane1_ontime_streak")).toBe(true);
  });

  test("control: the same lateness WITHOUT detention earns no on-time block", async () => {
    const dave = await seedUser("detdave", "Dave D");
    const base = Date.now() - 30 * 3600000;
    for (let i = 0; i < 5; i++) {
      const appt = new Date(base + i * 6 * 3600000);
      const sealAt = new Date(appt.getTime() + 90 * 60000);
      const loadId = await insertLoad(dave, {
        pickupCity: "Mobile", pickupState: "AL",
        deliveryCity: "Dallas", deliveryState: "TX",
        deliveryText: appt.toISOString(),
      });
      await insertChain("pod_seal", loadId, { loadId, at: sealAt.toISOString() });
    }
    await Actions.getPoints.handler(ctxFor(dave), {});
    const rows = await getDb().select().from(schema.pointsLog).where(eq(schema.pointsLog.username, dave.username));
    expect(rows.some((r) => r.source === "lane1_ontime_streak")).toBe(false);
  });
});
