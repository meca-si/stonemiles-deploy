// offlineNotificationsFlow.test.ts — INTEGRATION tests for TMS
// queue items 7 + 8 + 9 (migration 0128), run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   (7) offline sync — a duty capture seals at its captured time,
//       flagged offlineCapture, and a re-sync returns the original
//       hash without duplicating the record; a DVIR capture files
//       through the live insert path at its signing time (identity
//       snapshot, defect drafts, seal) with the same idempotency;
//       a pairing-breaking auto-swap capture and a note-less defect
//       capture are refused ONCE and stay refused; captures are
//       keyed per driver.
//   (9) notification center — a DM records one unread row per
//       conversation (count bumps), reading re-arms it, the
//       sender gets none, and a member with message alerts OFF gets
//       none; a sealed HOS warning records (deduped until read); a
//       credential alert records once per threshold per card; a
//       send-door load offer records for the fleet owner with NO
//       rate in the copy; push devices register/list/unregister
//       with tokens masked, move with re-registration, and rows
//       carry the honest push states (no_devices / not_configured
//       — no sender exists in this build, so nothing reads "sent").
//   (8) ELD test sync — connect + runEldTestSync pushes the
//       simulated payload set through the real pipeline: snapshots
//       stored stamped simulated, identity landed, feed states read
//       "received" with the simulated truth in the detail, the
//       mirrored official clocks SKIP simulated data, the batch
//       seals as eld_sync_received, and the gates hold (non-premium
//       refused, revoked connection refused).
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-offline-notif-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { and, eq } = await import("drizzle-orm");

type CtxT = Ctx;

const privStub = async () => ({ ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null });

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
const alice = await seedUser("offalice", "Alice A");
const bob = await seedUser("offbob", "Bob B");
const carol = await seedUser("offcarol", "Carol C");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);
const carolCtx = ctxFor(carol);
const anonCtx = ctxFor(null);

// Carol has message alerts OFF (her app_settings row says so).
await db.insert(schema.appSettings).values({ id: carol.profileId, notifyChat: false });

async function dmBetween(a: SeededUser, b: SeededUser): Promise<number> {
  const g = await db
    .insert(schema.chatGroups)
    .values({ name: b.username, kind: "dm", createdBy: a.username })
    .returning({ id: schema.chatGroups.id });
  const gid = g[0]!.id;
  await db.insert(schema.chatMembers).values({ groupId: gid, username: a.username });
  await db.insert(schema.chatMembers).values({ groupId: gid, username: b.username });
  return gid;
}
const dmAliceBob = await dmBetween(alice, bob);
const dmAliceCarol = await dmBetween(alice, carol);

async function send(ctx: CtxT, groupId: number, body: string): Promise<void> {
  await Actions.sendChatMessage.handler(ctx, { groupId, kind: "text", body, payload: null });
}

async function notifRows(username: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.username, username));
}

const HOUR = 3600000;
const isoAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

// ---------------------------------------------------------------------
describe("offline duty sync (item 7)", () => {
  const capturedAt = isoAgo(3);

  test("a capture seals at its captured time, flagged as an offline capture", async () => {
    const r = await Actions.syncDutyCapture.handler(aliceCtx, {
      captureId: "cap-duty-1",
      state: "driving",
      locationLabel: "AL (GPS state at the change)",
      capturedAt,
    });
    expect(r.status).toBe("sealed");
    expect(r.duplicate).toBe(false);
    expect(r.hash).toBeTruthy();
    const duty = await Actions.listDuty.handler(aliceCtx, { limit: 200 });
    const ev = duty.events.find((e) => e.at === new Date(capturedAt).toISOString());
    expect(ev?.state).toBe("driving");
    const chain = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "duty_change"));
    const mine = chain.find((c) => c.hash === r.hash);
    expect(mine?.payload).toContain('"offlineCapture":true');
    expect(mine?.payload).toContain('"captureId":"cap-duty-1"');
    const ledger = await db
      .select()
      .from(schema.offlineCaptures)
      .where(and(eq(schema.offlineCaptures.username, alice.username), eq(schema.offlineCaptures.captureId, "cap-duty-1")));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.chainHash).toBe(r.hash);
  });

  test("a re-sync returns the original hash and seals nothing twice", async () => {
    const before = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "duty_change"))).length;
    const r = await Actions.syncDutyCapture.handler(aliceCtx, {
      captureId: "cap-duty-1",
      state: "driving",
      locationLabel: "AL (GPS state at the change)",
      capturedAt,
    });
    expect(r.status).toBe("sealed");
    expect(r.duplicate).toBe(true);
    const after = (await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "duty_change"))).length;
    expect(after).toBe(before);
  });

  test("a pairing-breaking auto-swap capture is refused once and stays refused", async () => {
    const bad = {
      captureId: "cap-duty-bad",
      state: "driving" as const,
      source: "auto_no_movement" as const,
      autoStage: "off_duty_2min" as const,
      stillSince: isoAgo(1),
      capturedAt: isoAgo(1),
    };
    const r1 = await Actions.syncDutyCapture.handler(aliceCtx, bad);
    expect(r1.status).toBe("refused");
    expect(r1.error).toContain("Auto-swap refused");
    const r2 = await Actions.syncDutyCapture.handler(aliceCtx, bad);
    expect(r2.status).toBe("refused");
    expect(r2.duplicate).toBe(true);
    // The refusal never sealed a duty_change for that capture.
    const chain = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "duty_change"));
    expect(chain.some((c) => c.payload.includes("cap-duty-bad"))).toBe(false);
  });

  test("capture ids are keyed per driver — bob's sync of the same id is his own record", async () => {
    const r = await Actions.syncDutyCapture.handler(bobCtx, {
      captureId: "cap-duty-1",
      state: "sleeper",
      capturedAt: isoAgo(2),
    });
    expect(r.status).toBe("sealed");
    expect(r.duplicate).toBe(false);
    const bobDuty = await Actions.listDuty.handler(bobCtx, { limit: 200 });
    expect(bobDuty.events.some((e) => e.state === "sleeper")).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("offline DVIR sync (item 7)", () => {
  const capturedAt = isoAgo(2);
  const capture = {
    captureId: "cap-dvir-1",
    capturedAt,
    kind: "pretrip" as const,
    items: [
      { item: "Brakes", ok: false },
      { item: "Tires & wheels", ok: true },
    ],
    defects: [{ item: "Brakes", note: "Pedal feels soft at the top of travel", critical: true }],
    signedName: "Alice A",
    odometer: 512000,
    lat: 30.69,
    lon: -88.04,
    safeToOperate: false,
  };

  test("a capture files at its signing time through the live insert path", async () => {
    const r = await Actions.syncDvirCapture.handler(aliceCtx, capture);
    expect(r.status).toBe("sealed");
    expect(r.duplicate).toBe(false);
    expect(r.id).toBeGreaterThan(0);
    expect(r.criticalDefect).toBe(true);
    expect(r.draftEntryIds).toHaveLength(1);
    const rows = await db.select().from(schema.dvirReports).where(eq(schema.dvirReports.id, r.id!));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inspectedAt.getTime()).toBe(Date.parse(capturedAt));
    expect(rows[0]?.status).toBe("defects_reported");
    // The defect drafted a maintenance entry, linked.
    const links = await db.select().from(schema.dvirDefectLinks).where(eq(schema.dvirDefectLinks.dvirId, r.id!));
    expect(links).toHaveLength(1);
    expect(links[0]?.maintenanceEntryId).toBe(r.draftEntryIds[0]);
    // The seal is flagged as an offline capture in the chain payload.
    const chain = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "dvir_signed"));
    const mine = chain.find((c) => c.hash === r.hash);
    expect(mine?.payload).toContain('"offlineCapture":true');
  });

  test("a re-sync returns the original report and files nothing twice", async () => {
    const dvirsBefore = (await db.select().from(schema.dvirReports)).length;
    const draftsBefore = (await db.select().from(schema.dvirDefectLinks)).length;
    const r = await Actions.syncDvirCapture.handler(aliceCtx, capture);
    expect(r.status).toBe("sealed");
    expect(r.duplicate).toBe(true);
    expect((await db.select().from(schema.dvirReports)).length).toBe(dvirsBefore);
    expect((await db.select().from(schema.dvirDefectLinks)).length).toBe(draftsBefore);
  });

  test("a defect without a note is refused once and stays refused", async () => {
    const bad = { ...capture, captureId: "cap-dvir-bad", defects: [{ item: "Brakes", note: "  ", critical: false }] };
    const r1 = await Actions.syncDvirCapture.handler(aliceCtx, bad);
    expect(r1.status).toBe("refused");
    expect(r1.error).toContain("needs a note");
    const r2 = await Actions.syncDvirCapture.handler(aliceCtx, bad);
    expect(r2.status).toBe("refused");
    expect(r2.duplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("notification center — messages (item 9)", () => {
  test("a DM records one unread row for the other member; a burst bumps its count", async () => {
    await send(aliceCtx, dmAliceBob, "At the gate, door 12");
    let rows = (await notifRows(bob.username)).filter((n) => n.kind === "dm");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Alice A");
    expect(rows[0]?.body).toContain("door 12");
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.readAt).toBeNull();
    // No devices registered for bob yet — the honest push state.
    expect(rows[0]?.pushState).toBe("no_devices");
    await send(aliceCtx, dmAliceBob, "Bring the seal");
    rows = (await notifRows(bob.username)).filter((n) => n.kind === "dm");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    const center = await Actions.getNotifications.handler(bobCtx, { limit: 50 });
    expect(center.unreadCount).toBe(1);
  });

  test("the sender gets no notification for their own message", async () => {
    const rows = (await notifRows(alice.username)).filter((n) => n.kind === "dm");
    expect(rows).toHaveLength(0);
  });

  test("reading re-arms the conversation: the next message is a fresh row", async () => {
    const marked = await Actions.markNotificationsRead.handler(bobCtx, { all: true });
    expect(marked.marked).toBe(1);
    await send(aliceCtx, dmAliceBob, "Rolling now");
    const rows = (await notifRows(bob.username)).filter((n) => n.kind === "dm");
    expect(rows).toHaveLength(2);
    expect(rows.filter((n) => n.readAt == null)).toHaveLength(1);
  });

  test("a member with message alerts OFF gets no row", async () => {
    await send(aliceCtx, dmAliceCarol, "You there?");
    const rows = (await notifRows(carol.username)).filter((n) => n.kind === "dm");
    expect(rows).toHaveLength(0);
    void carolCtx;
  });

  test("centers are per-user: bob sees none of alice's alert kinds", async () => {
    const center = await Actions.getNotifications.handler(bobCtx, { limit: 50 });
    expect(center.notifications.every((n) => n.kind === "dm")).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("notification center — HOS + credential producers (item 9)", () => {
  test("a sealed HOS warning records, deduped until read", async () => {
    const payload = JSON.stringify({ clock: "drive", thresholdMin: 30, at: new Date().toISOString() });
    await Actions.logSealedEvent.handler(aliceCtx, { event: "hos_warning", refKind: "driver", refId: null, payload });
    await Actions.logSealedEvent.handler(aliceCtx, { event: "hos_warning", refKind: "driver", refId: null, payload });
    const rows = (await notifRows(alice.username)).filter((n) => n.kind === "hos");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.body).toContain("30 minutes left");
    expect(rows[0]?.dedupeKey).toBe("hos:drive:30");
  });

  test("a credential alert records once per threshold per card", async () => {
    const DAY = 86400000;
    await Actions.savePersonalDoc.handler(aliceCtx, {
      kind: "cdl",
      label: "CDL",
      expiresAt: new Date(Date.now() + 20 * DAY).toISOString(),
      docNumberLast4: null,
      notes: null,
      dataBase64: null,
      mime: null,
    });
    const alerts = await Actions.getCredentialAlerts.handler(aliceCtx, {});
    expect(alerts.alerts.some((a) => a.key === "cdl" && a.threshold === 30)).toBe(true);
    await Actions.getCredentialAlerts.handler(aliceCtx, {});
    const rows = (await notifRows(alice.username)).filter((n) => n.kind === "credential");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("CDL");
    expect(rows[0]?.dedupeKey).toMatch(/^credential:cdl:30:/);
  });
});

// ---------------------------------------------------------------------
describe("notification center — load offers (item 9)", () => {
  test("a send-door submission records an offer for the fleet owner — no rate in the copy", async () => {
    const owner = await seedUser("offowner", "Fleet Owner");
    void owner;
    const comp = await db
      .insert(schema.companies)
      .values({ name: "Fleet One LLC", ownerUsername: "offowner" })
      .returning({ id: schema.companies.id });
    const companyId = comp[0]!.id;
    await db.insert(schema.companyMembers).values({ companyId, username: "offowner", role: "owner" });
    const scopeKey = `company:${companyId}`;
    await db.insert(schema.brokerOptins).values({ scopeKey, companyId, ownerUsername: "offowner", enabled: true });
    const doorToken = ["off", "door", "token", "7"].join("-");
    await db.insert(schema.brokerLinks).values({
      scopeKey,
      companyId,
      ownerUsername: "offowner",
      kind: "door",
      brokerName: "",
      token: doorToken,
      expiresAt: new Date(Date.now() + 7 * 24 * HOUR * 1000),
      createdBy: "offowner",
    });
    const r = await Actions.submitBrokerUpload.handler(anonCtx, {
      token: doorToken,
      brokerName: "Sam Shipper",
      brokerCompany: "Peacock Pavers",
      senderContact: "sam@peacock.test",
      referenceNumber: "REF-9",
      pickupApptAt: null,
      deliveryApptAt: null,
      shipper: "Peacock Pavers",
      pickupCity: "Mobile",
      pickupState: "AL",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      pickupText: null,
      deliveryText: null,
      rate: 2400,
      loadedMiles: null,
      milesSource: null,
      extraCharges: 0,
      extraChargesNote: null,
      weightLbs: 40000,
      commodity: "paver",
      hazmat: false,
      equipmentType: "step_deck",
      notes: null,
      docDataBase64: null,
      docMime: null,
    } as never);
    expect((r as { ok: boolean }).ok).toBe(true);
    const rows = (await notifRows("offowner")).filter((n) => n.kind === "load_offer");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain("Sam Shipper");
    expect(rows[0]?.body).toContain("Mobile, AL → Dallas, TX");
    expect(rows[0]?.body).not.toContain("2400");
    expect(rows[0]?.body).not.toContain("$");
    expect(rows[0]?.dedupeKey).toBe(`offer:${(r as { submissionId: number }).submissionId}`);
  });
});

// ---------------------------------------------------------------------
describe("push device plumbing (item 9)", () => {
  const deviceToken = ["fcm", "device", "token", "xyz", "9876"].join("-");

  test("register → list (masked) → a new alert records not_configured, never sent", async () => {
    const reg = await Actions.registerPushDevice.handler(aliceCtx, { platform: "android", token: deviceToken });
    expect(reg.ok).toBe(true);
    // No FCM sender exists in this build — the registration itself
    // must say so, not pretend delivery is live.
    expect(reg.senderConfigured).toBe(false);
    const list = await Actions.getPushDevices.handler(aliceCtx, {});
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]?.tokenLast4).toBe("9876");
    expect(JSON.stringify(list)).not.toContain(deviceToken);
    // A fresh alert for alice now resolves its push state against
    // the registered device: devices exist, sender doesn't.
    const payload = JSON.stringify({ clock: "cycle", thresholdMin: 60, at: new Date().toISOString() });
    await Actions.logSealedEvent.handler(aliceCtx, { event: "hos_warning", refKind: "driver", refId: null, payload });
    const rows = (await notifRows(alice.username)).filter((n) => n.dedupeKey === "hos:cycle:60");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pushState).toBe("not_configured");
    const center = await Actions.getNotifications.handler(aliceCtx, { limit: 50 });
    expect(center.push.deviceCount).toBe(1);
    expect(center.push.senderConfigured).toBe(false);
    expect(center.push.statusLine).toContain("Android app");
  });

  test("re-registering a token moves it to the new user; unregister removes it", async () => {
    await Actions.registerPushDevice.handler(bobCtx, { platform: "android", token: deviceToken });
    expect((await Actions.getPushDevices.handler(aliceCtx, {})).devices).toHaveLength(0);
    expect((await Actions.getPushDevices.handler(bobCtx, {})).devices).toHaveLength(1);
    await Actions.unregisterPushDevice.handler(bobCtx, { token: deviceToken });
    expect((await Actions.getPushDevices.handler(bobCtx, {})).devices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe("ELD test-harness sync (item 8)", () => {
  const eldToken = ["sim", "eld", "token", "abc123"].join("-");
  let connectionId = 0;

  test("connect stores the connection read-only, awaiting first sync", async () => {
    const r = await Actions.connectEld.handler(aliceCtx, { provider: "samsara", token: eldToken, label: "Sim fleet" });
    expect(r.ok).toBe(true);
    connectionId = r.connectionId!;
    const hub = await Actions.getEldHub.handler(aliceCtx, {});
    expect(hub.connections).toHaveLength(1);
    expect(hub.mirroredHos).toBeNull();
    const feeds = hub.connections[0]?.feeds ?? [];
    expect(feeds.every((f) => f.state === "awaiting_first_sync")).toBe(true);
  });

  test("the test sync pushes simulated data through the real pipeline", async () => {
    const r = await Actions.runEldTestSync.handler(aliceCtx, { connectionId });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(6);
    expect(r.rejected).toBe(0);
    expect(r.note).toContain("simulated");
    // Snapshots landed for every feed, each stamped simulated in the
    // stored payload itself.
    const snaps = await db.select().from(schema.eldSnapshots).where(eq(schema.eldSnapshots.connectionId, connectionId));
    expect(snaps.map((s) => s.feed).sort()).toEqual(["dvirs", "hos_clocks", "hos_logs", "identity", "ifta", "vehicle_stats"]);
    for (const s of snaps) {
      const p = JSON.parse(s.payloadJson) as { simulated?: unknown };
      expect(p.simulated).toBe(true);
    }
    // Identity landed in eld_identity and reads back labelled.
    const identity = await Actions.getEldIdentity.handler(aliceCtx, {});
    expect(identity.identity?.driver.name).toBe("Simulated Driver");
    expect(identity.identity?.truck.unitNumber).toBe("SIM-1");
    // The batch sealed into the chain as a test-harness sync.
    const chain = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, "eld_sync_received"));
    expect(chain).toHaveLength(1);
    expect(chain[0]?.payload).toContain('"simulated":true');
    expect(chain[0]?.payload).toContain('"source":"test_harness"');
  });

  test("after a test sync the hub reads received-with-the-truth, and official surfaces skip simulated data", async () => {
    const hub = await Actions.getEldHub.handler(aliceCtx, {});
    const feeds = hub.connections[0]?.feeds ?? [];
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds.every((f) => f.state === "received")).toBe(true);
    expect(feeds.every((f) => f.detail.toLowerCase().includes("simulated"))).toBe(true);
    // The mirrored "official record" clocks must NOT light up from
    // simulated data.
    expect(hub.mirroredHos).toBeNull();
    expect(hub.activeProviderName).toBe("Samsara");
  });

  test("the gates hold: non-premium refused, revoked connection refused", async () => {
    const basic = await seedUser("offbasic", "Basic B", "basic");
    const basicCtx = ctxFor(basic);
    const r1 = await Actions.runEldTestSync.handler(basicCtx, { connectionId });
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain("Diamond");
    const revoked = await Actions.revokeEldConnection.handler(aliceCtx, { connectionId });
    expect(revoked.ok).toBe(true);
    const r2 = await Actions.runEldTestSync.handler(aliceCtx, { connectionId });
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain("revoked");
  });
});
