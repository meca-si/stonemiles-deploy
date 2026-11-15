// chatAlerts.test.ts — INTEGRATION tests for the new-message email
// alerts (2026-11-14), run against the REAL action handlers over a
// throwaway migrated SQLite database:
//
//   (a) a DM message emails the OTHER member once — sender named,
//       conversation named, app linked, message body NEVER included
//   (b) a burst of follow-on messages does NOT re-alert
//   (c) after the member catches up (markChatRead), the next message
//       alerts again
//   (d) the "Company chat" notification switch OFF silences the alert
//   (e) a group message alerts every other caught-up member
//   (f) a send-door load submission emails the fleet owner once —
//       subject names it a new load offer, NO rate in the email — and
//       the honest alert status lands on the sealed chain
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load). The mail
// transport is a capturing stub standing in for Resend: configured,
// and every sendDocEmail call is recorded with a provider id, so a
// "sent" status here means the action layer did its half — it is not
// proof about any real mailbox.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-chatalerts-"));
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
const sentMail: { to: string; subject: string; text: string }[] = [];
const privStub = async (contract: unknown, args: never) => {
  if (contract === privileged.docEmailConfig) {
    return { configured: true, from: "alerts@test.local" };
  }
  if (contract === privileged.sendDocEmail) {
    const a = args as { to: string; subject: string; text: string };
    sentMail.push({ to: a.to, subject: a.subject, text: a.text });
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
      heightFt: 6,
      heightIn: 1,
      weightLbs: 200,
      lengthFt: 13,
      mpg: 7,
      dieselPrice: 4,
      tankRangeMi: 800,
    })
    .returning({ id: schema.profile.id });
  // The address accountEmailFor resolves for a non-session account.
  await db.insert(schema.docCopySettings).values({ username, driverEmail: email });
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

const alice = await seedUser("alice", "Alice A");
const bob = await seedUser("bob", "Bob B");
const carol = await seedUser("carol", "Carol C");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);
const anonCtx = ctxFor(null);

// A DM between alice and bob, seeded the way openDm creates it.
const db = getDb();
const dmIns = await db
  .insert(schema.chatGroups)
  .values({ name: "bob", kind: "dm", createdBy: "alice" })
  .returning({ id: schema.chatGroups.id });
const dmId = dmIns[0]!.id;
await db.insert(schema.chatMembers).values({ groupId: dmId, username: "alice" });
await db.insert(schema.chatMembers).values({ groupId: dmId, username: "bob" });

async function send(ctx: CtxT, groupId: number, body: string): Promise<number> {
  const r = await Actions.sendChatMessage.handler(ctx, {
    groupId,
    kind: "text",
    body,
    payload: null,
  } as never);
  return (r as { id: number }).id;
}

const mailTo = (email: string) => sentMail.filter((m) => m.to === email);

describe("chat email alerts", () => {
  test("(a) first DM message emails the other member once, no body text", async () => {
    const id = await send(aliceCtx, dmId, "secret load details 12345");
    expect(id).toBeGreaterThan(0);
    const mail = mailTo("bob@test.local");
    expect(mail.length).toBe(1);
    expect(mail[0]!.subject).toBe("STONEMILES — new message from Alice A");
    expect(mail[0]!.text).toContain("https://app.stonervision.io");
    expect(mail[0]!.text).not.toContain("secret load details");
    // The sender is never emailed about their own message.
    expect(mailTo("alice@test.local").length).toBe(0);
    // Alert state recorded for bob: alerted at this message, read still 0.
    const rows = await db
      .select()
      .from(schema.chatMemberReads)
      .where(eq(schema.chatMemberReads.groupId, dmId));
    const bobRow = rows.find((r) => r.username === "bob");
    expect(bobRow?.lastAlertedId).toBe(id);
    expect(bobRow?.lastReadId).toBe(0);
  });

  test("(b) a burst does not re-alert", async () => {
    await send(aliceCtx, dmId, "second");
    await send(aliceCtx, dmId, "third");
    expect(mailTo("bob@test.local").length).toBe(1);
  });

  test("(c) after bob catches up, the next message alerts again", async () => {
    const msgs = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.groupId, dmId));
    const latest = Math.max(...msgs.map((m) => m.id));
    await Actions.markChatRead.handler(bobCtx, { groupId: dmId, messageId: latest } as never);
    await send(aliceCtx, dmId, "fourth — fresh run");
    expect(mailTo("bob@test.local").length).toBe(2);
  });

  test("(d) notifyChat OFF silences the alert", async () => {
    await db.insert(schema.appSettings).values({ id: bob.profileId, notifyChat: false });
    const msgs = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.groupId, dmId));
    const latest = Math.max(...msgs.map((m) => m.id));
    await Actions.markChatRead.handler(bobCtx, { groupId: dmId, messageId: latest } as never);
    await send(aliceCtx, dmId, "fifth — should not email");
    expect(mailTo("bob@test.local").length).toBe(2);
  });

  test("(e) a group message alerts every other caught-up member", async () => {
    const g = await db
      .insert(schema.chatGroups)
      .values({ name: "Crew", kind: "group", createdBy: "alice" })
      .returning({ id: schema.chatGroups.id });
    const gid = g[0]!.id;
    for (const u of ["alice", "bob", "carol"]) {
      await db.insert(schema.chatMembers).values({ groupId: gid, username: u });
    }
    await send(aliceCtx, gid, "group hello");
    // Carol (no prior state) is alerted; bob's switch is OFF (d).
    expect(mailTo("carol@test.local").length).toBe(1);
    expect(mailTo("carol@test.local")[0]!.text).toContain('"Crew"');
    expect(mailTo("bob@test.local").length).toBe(2);
  });
});

describe("send-door email alert", () => {
  test("(f) a door submission emails the fleet owner once, no rate, status sealed", async () => {
    const owner = await seedUser("fleetowner", "Fleet Owner");
    void owner;
    const comp = await db
      .insert(schema.companies)
      .values({ name: "Fleet One LLC", ownerUsername: "fleetowner" })
      .returning({ id: schema.companies.id });
    const companyId = comp[0]!.id;
    await db.insert(schema.companyMembers).values({ companyId, username: "fleetowner", role: "owner" });
    const scopeKey = `company:${companyId}`;
    await db.insert(schema.brokerOptins).values({
      scopeKey,
      companyId,
      ownerUsername: "fleetowner",
      enabled: true,
    });
    await db.insert(schema.brokerLinks).values({
      scopeKey,
      companyId,
      ownerUsername: "fleetowner",
      kind: "door",
      brokerName: "",
      token: "door-token-123456",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      createdBy: "fleetowner",
    });
    const before = mailTo("fleetowner@test.local").length;
    const r = await Actions.submitBrokerUpload.handler(anonCtx, {
      token: "door-token-123456",
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
    const mail = mailTo("fleetowner@test.local");
    expect(mail.length).toBe(before + 1);
    const m = mail[mail.length - 1]!;
    expect(m.subject).toBe("STONEMILES — new load offer in your desk inbox");
    expect(m.text).toContain("Peacock Pavers");
    expect(m.text).not.toContain("2400");
    // Honest status sealed to the chain.
    const chain = await db
      .select()
      .from(schema.chainLog)
      .where(eq(schema.chainLog.event, "broker_submission_email_alert"));
    expect(chain.length).toBe(1);
    expect(chain[0]!.payload).toContain('"emailStatus":"sent"');
  });
});
