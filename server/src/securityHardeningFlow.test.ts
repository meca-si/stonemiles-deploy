// securityHardeningFlow.test.ts — INTEGRATION tests for the Wave 2
// item 12 security hardening pass, run against the REAL action
// handlers over a throwaway migrated SQLite database:
//
//   (a) Pay Book IDOR: deletePayEntry / updatePayEntryDeductions
//       refuse another driver's entry (no mutation, no chain event,
//       no existence leak) and still work for the owner
//   (b) Chat admin IDOR: renameChatGroup / addChatMembers refuse
//       callers who are not the creator, a member, or the owning
//       company's owner/dispatch; DM membership never changes
//   (c) Send door: submitBrokerUpload refuses a non-document mime
//       (HTML/SVG) and caps submissions per link per hour
//   (d) Receiver copy: emailReceiverCopy caps sends per load per
//       hour (public spam-relay guard)
//   (e) Sealed chain: a directly tampered chain row is caught by
//       BOTH verifyChain and the operator runChainVerification
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load).

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-secharden-"));
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
      chatName: username,
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

const alice = await seedUser("secalice");
const bob = await seedUser("secbob");
const carol = await seedUser("seccarol");
const fleetOwner = await seedUser("secfleet");
const aliceCtx = ctxFor(alice);
const bobCtx = ctxFor(bob);
const fleetCtx = ctxFor(fleetOwner);
const anonCtx = ctxFor(null);

// ---------------------------------------------------------------------------
describe("item 12 — Pay Book IDOR", () => {
  let entryId = 0;

  test("setup: alice logs a pay entry", async () => {
    const ins = await getDb()
      .insert(schema.payEntries)
      .values({
        username: alice.username,
        kind: "1099",
        payer: "Acme Hauling",
        paidAt: new Date(),
        gross: 2400,
        otherDeductions: 0,
      })
      .returning({ id: schema.payEntries.id });
    entryId = ins[0]!.id;
    expect(entryId).toBeGreaterThan(0);
  });

  test("another driver cannot edit the entry's deductions — and learns nothing", async () => {
    const r = await Actions.updatePayEntryDeductions.handler(bobCtx, {
      id: entryId,
      deductionLines: [{ label: "Fuel advance", amount: 999 }],
    } as never);
    expect(r.ok).toBe(false);
    // The refusal is byte-identical to the missing-entry refusal.
    expect(r.error).toBe("That pay entry no longer exists.");
    const row = (await getDb().select().from(schema.payEntries).where(eq(schema.payEntries.id, entryId)))[0]!;
    expect(row.otherDeductions).toBe(0);
    expect(row.deductionLines).toBeNull();
    const edits = (await getDb().select().from(schema.chainLog)).filter(
      (c) => c.event === "pay_entry_deductions_edited",
    );
    expect(edits.length).toBe(0);
  });

  test("another driver cannot delete the entry", async () => {
    const r = await Actions.deletePayEntry.handler(bobCtx, { id: entryId } as never);
    expect(r.ok).toBe(true); // same outward shape as a successful delete
    const row = (await getDb().select().from(schema.payEntries).where(eq(schema.payEntries.id, entryId)))[0];
    expect(row).toBeDefined();
    const dels = (await getDb().select().from(schema.chainLog)).filter(
      (c) => c.event === "pay_entry_deleted",
    );
    expect(dels.length).toBe(0);
  });

  test("the owner still edits and deletes normally", async () => {
    const edit = await Actions.updatePayEntryDeductions.handler(aliceCtx, {
      id: entryId,
      deductionLines: [{ label: "Fuel advance", amount: 50 }],
    } as never);
    expect(edit.ok).toBe(true);
    expect(edit.otherDeductions).toBe(50);
    const del = await Actions.deletePayEntry.handler(aliceCtx, { id: entryId } as never);
    expect(del.ok).toBe(true);
    const row = (await getDb().select().from(schema.payEntries).where(eq(schema.payEntries.id, entryId)))[0];
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("item 12 — chat admin IDOR", () => {
  let companyId = 0;
  let groupId = 0;
  let dmId = 0;

  test("setup: a company group with a named creator", async () => {
    const db = getDb();
    const c = await db
      .insert(schema.companies)
      .values({ name: "Sec Fleet LLC", ownerUsername: fleetOwner.username })
      .returning({ id: schema.companies.id });
    companyId = c[0]!.id;
    await db.insert(schema.companyMembers).values({ companyId, username: fleetOwner.username, role: "owner" });
    await db.insert(schema.companyMembers).values({ companyId, username: alice.username, role: "driver" });
    const g = await db
      .insert(schema.chatGroups)
      .values({ name: "Fleet Room", kind: "group", createdBy: alice.username, companyId })
      .returning({ id: schema.chatGroups.id });
    groupId = g[0]!.id;
    await db.insert(schema.chatMembers).values({ groupId, username: alice.username });
    const dm = await db
      .insert(schema.chatGroups)
      .values({ name: "dm", kind: "dm", createdBy: alice.username })
      .returning({ id: schema.chatGroups.id });
    dmId = dm[0]!.id;
    await db.insert(schema.chatMembers).values({ groupId: dmId, username: alice.username });
    await db.insert(schema.chatMembers).values({ groupId: dmId, username: bob.username });
  });

  async function groupName(id: number): Promise<string> {
    const g = (await getDb().select().from(schema.chatGroups).where(eq(schema.chatGroups.id, id)))[0]!;
    return g.name;
  }
  async function memberNames(id: number): Promise<string[]> {
    const rows = await getDb().select().from(schema.chatMembers).where(eq(schema.chatMembers.groupId, id));
    return rows.map((r) => r.username).sort();
  }

  test("an outsider cannot rename the group", async () => {
    await Actions.renameChatGroup.handler(bobCtx, { id: groupId, name: "Defaced" } as never);
    expect(await groupName(groupId)).toBe("Fleet Room");
  });

  test("an outsider cannot add themselves (or anyone) to the group", async () => {
    await Actions.addChatMembers.handler(bobCtx, { id: groupId, members: [bob.username, carol.username] } as never);
    expect(await memberNames(groupId)).toEqual([alice.username]);
  });

  test("the creator renames and adds; a member can then add", async () => {
    await Actions.renameChatGroup.handler(aliceCtx, { id: groupId, name: "Dispatch Room" } as never);
    expect(await groupName(groupId)).toBe("Dispatch Room");
    await Actions.addChatMembers.handler(aliceCtx, { id: groupId, members: [bob.username] } as never);
    expect(await memberNames(groupId)).toEqual([alice.username, bob.username].sort());
    await Actions.addChatMembers.handler(bobCtx, { id: groupId, members: [carol.username] } as never);
    expect(await memberNames(groupId)).toEqual([alice.username, bob.username, carol.username].sort());
  });

  test("the company owner can rename a group in their company", async () => {
    await Actions.renameChatGroup.handler(fleetCtx, { id: groupId, name: "Fleet Room" } as never);
    expect(await groupName(groupId)).toBe("Fleet Room");
  });

  test("DM membership never changes through addChatMembers — even for a member", async () => {
    await Actions.addChatMembers.handler(aliceCtx, { id: dmId, members: [carol.username] } as never);
    expect(await memberNames(dmId)).toEqual([alice.username, bob.username].sort());
  });
});

// ---------------------------------------------------------------------------
describe("item 12 — send door upload discipline", () => {
  let doorToken = "";

  test("setup: a fleet send door", async () => {
    // A dedicated owner: the chat describe already made fleetOwner a
    // member of another company, and membership resolution would
    // land on that fleet (which has no broker opt-in).
    const doorOwner = await seedUser("secdoor");
    const doorCtx = ctxFor(doorOwner);
    const db = getDb();
    const c = await db
      .insert(schema.companies)
      .values({ name: "Door Fleet LLC", ownerUsername: doorOwner.username })
      .returning({ id: schema.companies.id });
    await db.insert(schema.companyMembers).values({ companyId: c[0]!.id, username: doorOwner.username, role: "owner" });
    await db.insert(schema.brokerOptins).values({
      scopeKey: `company:${c[0]!.id}`,
      companyId: c[0]!.id,
      ownerUsername: doorOwner.username,
      enabled: true,
    });
    const door = await Actions.createSendDoor.handler(doorCtx, {} as never);
    expect(door.ok).toBe(true);
    doorToken = door.door!.token;
  });

  const doorArgs = {
    brokerName: "Sam Shipper",
    brokerCompany: "Sam Logistics",
    senderContact: "sam@samlogistics.test",
    pickupCity: "Mobile",
    pickupState: "AL",
  };

  async function myLinkId(): Promise<number> {
    const link = (await getDb().select().from(schema.brokerLinks).where(eq(schema.brokerLinks.token, doorToken)))[0]!;
    return link.id;
  }
  async function mySubmissionCount(): Promise<number> {
    const id = await myLinkId();
    const rows = await getDb().select().from(schema.brokerSubmissions).where(eq(schema.brokerSubmissions.linkId, id));
    return rows.length;
  }

  test("an HTML attachment is refused before it reaches the blob store", async () => {
    const before = await mySubmissionCount();
    const r = await Actions.submitBrokerUpload.handler(anonCtx, {
      ...doorArgs,
      token: doorToken,
      docDataBase64: Buffer.from("<html><script>alert(1)</script></html>").toString("base64"),
      docMime: "text/html",
    } as never);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PDF or a photo");
    expect(await mySubmissionCount()).toBe(before);
  });

  test("an SVG attachment is refused the same way", async () => {
    const r = await Actions.submitBrokerUpload.handler(anonCtx, {
      ...doorArgs,
      token: doorToken,
      docDataBase64: Buffer.from("<svg onload=alert(1)>").toString("base64"),
      docMime: "image/svg+xml",
    } as never);
    expect(r.ok).toBe(false);
  });

  test("a PDF rate con is accepted", async () => {
    const r = await Actions.submitBrokerUpload.handler(anonCtx, {
      ...doorArgs,
      token: doorToken,
      docDataBase64: Buffer.from("%PDF-1.4 fake but typed right").toString("base64"),
      docMime: "application/pdf",
    } as never);
    expect(r.ok).toBe(true);
    expect(r.submissionId).toBeGreaterThan(0);
  });

  test("the per-link hourly cap stops a flood at 30", async () => {
    // One submission already landed (the PDF above). 29 more fit;
    // the 31st in the hour is refused.
    for (let i = 0; i < 29; i++) {
      const r = await Actions.submitBrokerUpload.handler(anonCtx, { ...doorArgs, token: doorToken } as never);
      expect(r.ok).toBe(true);
    }
    const flooded = await Actions.submitBrokerUpload.handler(anonCtx, { ...doorArgs, token: doorToken } as never);
    expect(flooded.ok).toBe(false);
    expect(flooded.error).toContain("last hour");
    expect(await mySubmissionCount()).toBe(30);
  });
});

// ---------------------------------------------------------------------------
describe("item 12 — receiver copy send cap", () => {
  let loadId = 0;
  let token = "";

  test("setup: a delivered load with a receive link", async () => {
    const db = getDb();
    const ins = await db
      .insert(schema.loads)
      .values({
        profileId: alice.profileId,
        shipper: "Acme Steel",
        commodity: "steel coils",
        pickupCity: "Mobile",
        pickupState: "AL",
        deliveryCity: "Dallas",
        deliveryState: "TX",
      })
      .returning({ id: schema.loads.id });
    loadId = ins[0]!.id;
    token = `rcv_${"a".repeat(32)}`;
    await db.insert(schema.receiveLinks).values({
      loadId,
      token,
      kind: "action",
      status: "active",
      createdBy: alice.username,
    });
    const conf = await Actions.confirmReceive.handler(anonCtx, {
      token,
      receiverName: "Sam Receiver",
      exceptionNotes: null,
      photoDataBase64: null,
      photoMime: null,
    } as never);
    expect(conf.ok).toBe(true);
  });

  test("the first copy emails fine; past five in an hour the door closes", async () => {
    const first = await Actions.emailReceiverCopy.handler(anonCtx, {
      token,
      toEmail: "sam@receiver.example",
    } as never);
    expect(first.ok).toBe(true);
    expect(first.status).toBe("queued");
    // Four more audited sends inside the hour (direct rows, same
    // docRef the action writes) bring the load to the cap.
    const db = getDb();
    for (let i = 0; i < 4; i++) {
      await db.insert(schema.documentSends).values({
        profileId: alice.profileId,
        username: alice.username,
        docRef: `podcopy:${loadId}`,
        docKind: "receiver_copy",
        docTitle: "Signed POD copy",
        toEmail: "sam@receiver.example",
        subject: "Your signed delivery copy",
        status: "queued",
      });
    }
    const capped = await Actions.emailReceiverCopy.handler(anonCtx, {
      token,
      toEmail: "spam-target@elsewhere.example",
    } as never);
    expect(capped.ok).toBe(false);
    expect(capped.error).toContain("already been emailed");
    const sends = (await getDb().select().from(schema.documentSends)).filter(
      (d) => d.docRef === `podcopy:${loadId}`,
    );
    expect(sends.length).toBe(5);
    expect(sends.some((d) => d.toEmail === "spam-target@elsewhere.example")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("item 12 — sealed chain tamper detection", () => {
  test("a directly edited chain row is caught by verifyChain AND the operator verification", async () => {
    const db = getDb();
    // Tamper a row THIS suite sealed: the delivery_confirmed event
    // for the receiver-copy load above. (Suites can share one
    // database in a full run, so the assertions pin the detection
    // to this suite's own record rather than assuming a pristine
    // global chain.)
    const rows = await db.select().from(schema.chainLog);
    const target = rows.filter(
      (r) => r.event === "delivery_confirmed" && r.refKind === "load",
    ).at(-1)!;
    expect(target).toBeDefined();
    await db
      .update(schema.chainLog)
      .set({ payload: `${target.payload} ` })
      .where(eq(schema.chainLog.id, target.id));

    const v = await Actions.verifyChain.handler(aliceCtx, {} as never);
    expect(v.intact).toBe(false);
    expect(v.brokenAtId).not.toBeNull();
    expect(v.brokenAtId!).toBeLessThanOrEqual(target.id);

    const op = await Actions.runChainVerification.handler(aliceCtx, {} as never);
    expect(op.intact).toBe(false);
    // The operator report attributes the failure to the tampered
    // record itself: its entries no longer verify.
    const rec = op.records.find((r) => r.refKind === "load" && r.refId === target.refId);
    expect(rec).toBeDefined();
    expect(rec!.failedEntries).toBeGreaterThan(0);
  });
});
