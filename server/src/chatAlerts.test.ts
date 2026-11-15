// chatAlerts.test.ts — INTEGRATION tests for chat-message email
// behavior and the send-door load-offer email, run against the REAL
// action handlers over a throwaway migrated SQLite database:
//
//   (a) a DM message sends fine but emails NOBODY — owner decision
//       2026-11-14: the in-app unread badge is the DM notification;
//       an email would duplicate the member's in-app inbox. The
//       sender's per-member read marker (migration 0117) still moves
//       and no alert state is recorded for the other member.
//   (b) a burst of follow-on messages also sends no email
//   (c) markChatRead still advances the member's per-member read
//       marker, and the next message still sends no email
//   (d) the "Company chat" notification switch OFF changes nothing
//       for email (there is none to change) — sends still work
//   (e) a group message emails no member either
//   (f) a send-door load submission emails the fleet owner once —
//       subject names it a new load offer, NO rate in the email — and
//       the honest alert status lands on the sealed chain (a separate
//       path, NOT affected by the chat decision)
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

describe("chat messages send no email", () => {
  test("(a) first DM message sends but emails nobody; read tracking intact", async () => {
    const id = await send(aliceCtx, dmId, "secret load details 12345");
    expect(id).toBeGreaterThan(0);
    // Owner decision 2026-11-14: NO email for chat messages — not to
    // the other member, not to the sender, not to anyone.
    expect(mailTo(bob.email).length).toBe(0);
    expect(mailTo(alice.email).length).toBe(0);
    expect(sentMail.length).toBe(0);
    // Reads tracking (migration 0117) is untouched: the sender's own
    // per-member marker moved to the new message…
    const rows = await db
      .select()
      .from(schema.chatMemberReads)
      .where(eq(schema.chatMemberReads.groupId, dmId));
    const aliceRow = rows.find((r) => r.username === "alice");
    expect(aliceRow?.lastReadId).toBe(id);
    // …and NO alert state was recorded for the other member.
    const bobRow = rows.find((r) => r.username === "bob");
    expect(bobRow).toBeUndefined();
  });

  test("(b) a burst also sends no email", async () => {
    await send(aliceCtx, dmId, "second");
    await send(aliceCtx, dmId, "third");
    expect(sentMail.length).toBe(0);
  });

  test("(c) markChatRead still advances the read marker; next message still no email", async () => {
    const msgs = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.groupId, dmId));
    const latest = Math.max(...msgs.map((m) => m.id));
    await Actions.markChatRead.handler(bobCtx, { groupId: dmId, messageId: latest } as never);
    const rows = await db
      .select()
      .from(schema.chatMemberReads)
      .where(eq(schema.chatMemberReads.groupId, dmId));
    const bobRow = rows.find((r) => r.username === "bob");
    expect(bobRow?.lastReadId).toBe(latest);
    expect(bobRow?.lastAlertedId).toBe(0);
    await send(aliceCtx, dmId, "fourth — fresh run");
    expect(sentMail.length).toBe(0);
  });

  test("(d) notifyChat OFF changes nothing for email — sends still work", async () => {
    await db.insert(schema.appSettings).values({ id: bob.profileId, notifyChat: false });
    const msgs = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.groupId, dmId));
    const latest = Math.max(...msgs.map((m) => m.id));
    await Actions.markChatRead.handler(bobCtx, { groupId: dmId, messageId: latest } as never);
    const id = await send(aliceCtx, dmId, "fifth — should not email");
    expect(id).toBeGreaterThan(0);
    expect(sentMail.length).toBe(0);
  });

  test("(e) a group message emails no member either", async () => {
    const g = await db
      .insert(schema.chatGroups)
      .values({ name: "Crew", kind: "group", createdBy: "alice" })
      .returning({ id: schema.chatGroups.id });
    const gid = g[0]!.id;
    for (const u of ["alice", "bob", "carol"]) {
      await db.insert(schema.chatMembers).values({ groupId: gid, username: u });
    }
    await send(aliceCtx, gid, "group hello");
    expect(mailTo(carol.email).length).toBe(0);
    expect(mailTo(bob.email).length).toBe(0);
    expect(sentMail.length).toBe(0);
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
