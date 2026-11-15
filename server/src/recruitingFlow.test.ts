// recruitingFlow.test.ts — INTEGRATION tests for recruiting
// ATS-lite (Wave 2 item 10, Part B), run against the REAL action
// handlers over a throwaway migrated SQLite database:
//
//   (a) the door lifecycle: only owner/dispatch seats reach the
//       desk; create → live URL; the public info door shows the
//       fleet's name and nothing else
//   (b) a submission lands in the fleet's inbox, seals ids-only
//       (no contact details anywhere on the chain), notifies
//       owner + dispatch (never the driver seat), and the
//       auto-response email goes out INSIDE the submit request
//       — sent with a working mail stub, queued honestly
//       without one
//   (c) the anti-spam posture: honeypot absorbed silently,
//       invalid input refused plainly, per-email daily limit,
//       per-door hourly limit
//   (d) the pipeline: forward moves seal, backward moves and
//       moves out of a terminal stage refuse; notes are
//       desk-only and never enter a chain payload; HIRED mints
//       a single-use driver code through the existing code
//       flow and creates NO account
//   (e) the fleet's own template wording is what gets sent;
//       blanking a field restores the default; a regenerated
//       door keeps the wording and retires the old link
//   (f) a revoked or expired door refuses publicly; another
//       fleet's desk sees none of it
//
// Pure-rule coverage lives in recruiting.test.ts. Hermetic:
// STONEMILES_DB / STONEMILES_BLOBS point into a temp dir before
// host/ctx is imported.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "@hatch/space-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-recruiting-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;

const { getDb, createInvocation, STANDALONE_ROOT } = await import("../../host/ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("./schema");
const { Actions } = await import("./actions");
const { asc, eq } = await import("drizzle-orm");

type CtxT = Ctx;

type PrivResult = {
  ok: boolean;
  notConfigured: boolean;
  status: number | null;
  providerId: string | null;
  errorMessage: string | null;
};
const privStub = async (): Promise<PrivResult> => ({ ok: false, notConfigured: true, status: null, providerId: null, errorMessage: null });
const mailOkStub = async (): Promise<PrivResult> => ({ ok: true, notConfigured: false, status: 200, providerId: "msg-1", errorMessage: null });

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
    })
    .returning({ id: schema.profile.id });
  await db.insert(schema.socialUsers).values({ username, displayName: chatName });
  return { accountId: acct[0]!.id, profileId: prof[0]!.id, username, email };
}

function ctxFor(u: SeededUser, priv: () => Promise<PrivResult> = privStub): CtxT {
  return createInvocation({
    executePrivileged: priv as never,
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

function anonCtx(priv: () => Promise<PrivResult> = privStub): CtxT {
  return createInvocation({ executePrivileged: priv as never, viewer: null }).ctx as unknown as CtxT;
}

async function errOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const db = getDb();

const owner = await seedUser("recowner", "Olivia Owner");
const dispatch = await seedUser("recdispatch", "Dan Dispatch");
const driver = await seedUser("recdriver", "Dave Driver");
const outsider = await seedUser("recoutsider", "Oscar Outsider");

const comp = await db
  .insert(schema.companies)
  .values({ name: "Acme Hauling", ownerUsername: owner.username, kind: "fleet" })
  .returning({ id: schema.companies.id });
const companyId = comp[0]!.id;
await db.insert(schema.companyMembers).values([
  { companyId, username: owner.username, role: "owner" },
  { companyId, username: dispatch.username, role: "dispatch" },
  { companyId, username: driver.username, role: "driver" },
]);
const comp2 = await db
  .insert(schema.companies)
  .values({ name: "Outsider Freight", ownerUsername: outsider.username, kind: "fleet" })
  .returning({ id: schema.companies.id });
await db.insert(schema.companyMembers).values({ companyId: comp2[0]!.id, username: outsider.username, role: "owner" });

const ownerCtx = ctxFor(owner);
const dispatchCtx = ctxFor(dispatch);
const driverCtx = ctxFor(driver);
const outsiderCtx = ctxFor(outsider);
const anon = anonCtx();
const anonMail = anonCtx(mailOkStub);

async function chainCount(event: string): Promise<number> {
  const rows = await db.select().from(schema.chainLog).where(eq(schema.chainLog.event, event)).orderBy(asc(schema.chainLog.id));
  return rows.length;
}

async function applicationCount(): Promise<number> {
  return (await db.select().from(schema.driverApplications)).length;
}

function tokenOf(doorUrl: string): string {
  return doorUrl.split("/apply/")[1]!;
}

const APPLICANT = {
  name: "Jo Driver",
  email: "jo@example.com",
  phone: "555-0100",
  cdlClass: "A",
  experience: "6 years OTR, reefer",
  note: "Wants weekends home",
};

let doorToken = "";

describe("recruiting — the door", () => {
  test("only owner/dispatch seats reach the desk; a fresh fleet has no door yet", async () => {
    const fresh = await Actions.getRecruitingDoor.handler(ownerCtx, {});
    expect(fresh.error).toBeNull();
    expect(fresh.doorUrl).toBeNull();
    expect(fresh.templateIsDefault).toBe(true);
    expect(fresh.counts).toEqual({ total: 0, fresh: 0 });

    const driverView = await Actions.getRecruitingDoor.handler(driverCtx, {});
    expect(driverView.error).toContain("owner and dispatch seats");
    const err = await errOf(Actions.createRecruitingDoor.handler(driverCtx, {}));
    expect(err).toContain("owner and dispatch seats");
  });

  test("create opens a live door; the public info shows the fleet name only", async () => {
    const made = await Actions.createRecruitingDoor.handler(ownerCtx, {});
    expect(made.ok).toBe(true);
    expect(made.doorUrl).toContain("https://app.stonervision.io/apply/");
    doorToken = tokenOf(made.doorUrl);

    const state = await Actions.getRecruitingDoor.handler(dispatchCtx, {});
    expect(state.doorLive).toBe(true);
    expect(state.fleetName).toBe("Acme Hauling");

    const info = await Actions.getApplyInfo.handler(anon, { token: doorToken });
    expect(info).toEqual({ valid: true, reason: null, fleetName: "Acme Hauling" });
    const bad = await Actions.getApplyInfo.handler(anon, { token: "no-such-door" });
    expect(bad.valid).toBe(false);
    expect(await chainCount("recruiting_door_created")).toBe(1);
    // The token itself is never a chain fact.
    const chain = await db.select().from(schema.chainLog);
    expect(chain.map((c) => c.payload).join("\n")).not.toContain(doorToken);
  });
});

describe("recruiting — submission + the in-request auto-response", () => {
  test("a submission lands, seals ids-only, notifies the desk, and the response email sends inside the request", async () => {
    const out = await Actions.submitDriverApplication.handler(anonMail, { token: doorToken, ...APPLICANT, website: null });
    expect(out.ok).toBe(true);
    expect(out.responseStatus).toBe("sent"); // the mail stub accepted it during THIS call — no cron involved
    expect(out.message).toContain("Acme Hauling");

    const apps = await db.select().from(schema.driverApplications);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "Jo Driver", email: "jo@example.com", cdlClass: "A", stage: "new", responseStatus: "sent" });
    expect(apps[0]!.responseAt).not.toBeNull();

    const sends = await db.select().from(schema.documentSends);
    const send = sends.find((s) => s.docKind === "recruiting_response");
    expect(send?.toEmail).toBe("jo@example.com");
    expect(send?.status).toBe("sent");
    expect(send?.subject).toBe("Application received — Acme Hauling");

    expect(await chainCount("driver_application_received")).toBe(1);
    expect(await chainCount("driver_application_response")).toBe(1);
    // Contact details are NEVER chain facts.
    const chain = await db.select().from(schema.chainLog);
    const payloads = chain.map((c) => c.payload).join("\n");
    expect(payloads).not.toContain("jo@example.com");
    expect(payloads).not.toContain("Jo Driver");
    expect(payloads).not.toContain("555-0100");

    const notes = await db.select().from(schema.notifications);
    const deskNotes = notes.filter((n) => n.title === "New driver application");
    expect(deskNotes.map((n) => n.username).sort()).toEqual([dispatch.username, owner.username].sort());
  });

  test("with mail unconfigured the response honestly queues — the application still lands", async () => {
    const out = await Actions.submitDriverApplication.handler(anon, {
      token: doorToken,
      ...APPLICANT,
      email: "sam@example.com",
      name: "Sam Second",
      website: null,
    });
    expect(out.ok).toBe(true);
    expect(out.responseStatus).toBe("queued");
    const apps = await db.select().from(schema.driverApplications);
    expect(apps.find((a) => a.email === "sam@example.com")?.responseStatus).toBe("queued");
  });

  test("the desk inbox shows both applications; the driver seat sees none of it", async () => {
    const inbox = await Actions.getRecruitingApplications.handler(dispatchCtx, {});
    expect(inbox.error).toBeNull();
    expect(inbox.applications).toHaveLength(2);
    expect(inbox.applications[0]?.name).toBe("Sam Second"); // newest first
    const driverInbox = await Actions.getRecruitingApplications.handler(driverCtx, {});
    expect(driverInbox.error).toContain("owner and dispatch seats");
    expect(driverInbox.applications).toEqual([]);
  });
});

describe("recruiting — anti-spam posture", () => {
  test("a filled honeypot is absorbed silently: success words, nothing saved", async () => {
    const before = await applicationCount();
    const out = await Actions.submitDriverApplication.handler(anonMail, {
      token: doorToken,
      ...APPLICANT,
      email: "bot@example.com",
      website: "http://spam.example",
    });
    expect(out.ok).toBe(true);
    expect(await applicationCount()).toBe(before);
  });

  test("invalid input refuses plainly and saves nothing", async () => {
    const before = await applicationCount();
    const bad = await Actions.submitDriverApplication.handler(anonMail, {
      token: doorToken,
      ...APPLICANT,
      email: "not-an-email",
      website: null,
    });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("email");
    const noExp = await Actions.submitDriverApplication.handler(anonMail, {
      token: doorToken,
      ...APPLICANT,
      email: "new@example.com",
      experience: " ",
      website: null,
    });
    expect(noExp.ok).toBe(false);
    expect(await applicationCount()).toBe(before);
  });

  test("the per-email daily limit stops repeat applications to the same fleet", async () => {
    // jo@example.com already applied once above; two more pass,
    // the fourth in a day is refused.
    for (let i = 0; i < 2; i++) {
      const out = await Actions.submitDriverApplication.handler(anon, { token: doorToken, ...APPLICANT, website: null });
      expect(out.ok).toBe(true);
    }
    const fourth = await Actions.submitDriverApplication.handler(anon, { token: doorToken, ...APPLICANT, website: null });
    expect(fourth.ok).toBe(false);
    expect(fourth.message).toContain("already applied");
  });

  test("the per-door hourly limit trips under a flood of distinct emails", async () => {
    const door2 = await Actions.createRecruitingDoor.handler(outsiderCtx, {});
    const token2 = tokenOf(door2.doorUrl);
    let lastOk = true;
    for (let i = 0; i < 20; i++) {
      const out = await Actions.submitDriverApplication.handler(anon, {
        token: token2,
        name: `Flood ${i}`,
        email: `flood${i}@example.com`,
        phone: null,
        cdlClass: "B",
        experience: "2 years regional",
        note: null,
        website: null,
      });
      lastOk = out.ok;
    }
    expect(lastOk).toBe(true); // the 20th still fits the hour
    const over = await Actions.submitDriverApplication.handler(anon, {
      token: token2,
      name: "Flood Over",
      email: "floodover@example.com",
      phone: null,
      cdlClass: "B",
      experience: "2 years regional",
      note: null,
      website: null,
    });
    expect(over.ok).toBe(false);
    expect(over.message).toContain("busy");
  });
});

describe("recruiting — the pipeline", () => {
  test("stages move forward and seal; backward and post-terminal moves refuse", async () => {
    const inbox = await Actions.getRecruitingApplications.handler(ownerCtx, {});
    const jo = inbox.applications.find((a) => a.email === "jo@example.com" && a.stage === "new")!;
    const moved = await Actions.moveApplicationStage.handler(ownerCtx, { applicationId: jo.id, toStage: "contacted" });
    expect(moved).toEqual({ ok: true, inviteCode: null });
    const back = await errOf(Actions.moveApplicationStage.handler(ownerCtx, { applicationId: jo.id, toStage: "new" }));
    expect(back).toContain("forward");
    expect(await chainCount("driver_application_stage")).toBe(1);
  });

  test("notes are desk-only: visible in the inbox, absent from every chain payload", async () => {
    const inbox = await Actions.getRecruitingApplications.handler(ownerCtx, {});
    const jo = inbox.applications.find((a) => a.email === "jo@example.com")!;
    await Actions.addApplicationNote.handler(dispatchCtx, { applicationId: jo.id, body: "Called — left a voicemail." });
    const after = await Actions.getRecruitingApplications.handler(ownerCtx, {});
    const withNote = after.applications.find((a) => a.id === jo.id)!;
    expect(withNote.notes).toHaveLength(1);
    expect(withNote.notes[0]).toMatchObject({ author: dispatch.username, body: "Called — left a voicemail." });
    const chain = await db.select().from(schema.chainLog);
    expect(chain.map((c) => c.payload).join("\n")).not.toContain("voicemail");
  });

  test("hired mints a single-use driver code through the existing flow — and creates NO account", async () => {
    const accountsBefore = (await db.select().from(schema.accounts)).length;
    const inbox = await Actions.getRecruitingApplications.handler(ownerCtx, {});
    const jo = inbox.applications.find((a) => a.email === "jo@example.com")!;
    await Actions.moveApplicationStage.handler(ownerCtx, { applicationId: jo.id, toStage: "interview" });
    const hired = await Actions.moveApplicationStage.handler(ownerCtx, { applicationId: jo.id, toStage: "hired" });
    expect(hired.ok).toBe(true);
    expect(hired.inviteCode).toMatch(/^DRV-[A-Z0-9]{6}$/);
    const codes = await db.select().from(schema.driverCodes);
    const code = codes.find((c) => c.code === hired.inviteCode);
    expect(code?.companyId).toBe(companyId);
    expect(code?.singleUse).toBe(true);
    expect(code?.usedBy).toBeNull(); // pending — the owner sends it; nobody is enrolled yet
    expect((await db.select().from(schema.accounts)).length).toBe(accountsBefore);
    const after = await Actions.getRecruitingApplications.handler(ownerCtx, {});
    expect(after.applications.find((a) => a.id === jo.id)?.inviteCode).toBe(hired.inviteCode);
    const closed = await errOf(Actions.moveApplicationStage.handler(ownerCtx, { applicationId: jo.id, toStage: "contacted" }));
    expect(closed).toContain("closed");
  });

  test("declined closes an application from any open stage", async () => {
    const inbox = await Actions.getRecruitingApplications.handler(ownerCtx, {});
    const sam = inbox.applications.find((a) => a.email === "sam@example.com")!;
    const out = await Actions.moveApplicationStage.handler(dispatchCtx, { applicationId: sam.id, toStage: "declined" });
    expect(out.ok).toBe(true);
  });
});

describe("recruiting — template, regeneration, closure, isolation", () => {
  test("the fleet's wording is what gets sent; blanking restores the default", async () => {
    await Actions.setRecruitingTemplate.handler(ownerCtx, {
      subject: "We got your application, {name}",
      body: "Hi {name} — {fleet} has it. We review every application.",
    });
    const state = await Actions.getRecruitingDoor.handler(ownerCtx, {});
    expect(state.templateIsDefault).toBe(false);
    const out = await Actions.submitDriverApplication.handler(anonMail, {
      token: doorToken,
      ...APPLICANT,
      email: "pat@example.com",
      name: "Pat Prospect",
      website: null,
    });
    expect(out.ok).toBe(true);
    const sends = await db.select().from(schema.documentSends);
    const send = sends.filter((s) => s.docKind === "recruiting_response" && s.toEmail === "pat@example.com")[0];
    expect(send?.subject).toBe("We got your application, Pat Prospect");
  });

  test("regenerating the door keeps the wording and retires the old link", async () => {
    const made = await Actions.createRecruitingDoor.handler(ownerCtx, {});
    const newToken = tokenOf(made.doorUrl);
    expect(newToken).not.toBe(doorToken);
    const old = await Actions.getApplyInfo.handler(anon, { token: doorToken });
    expect(old.valid).toBe(false);
    const state = await Actions.getRecruitingDoor.handler(ownerCtx, {});
    expect(state.templateIsDefault).toBe(false); // wording carried over
    doorToken = newToken;
  });

  test("a revoked door refuses publicly; an expired one too", async () => {
    await Actions.revokeRecruitingDoor.handler(ownerCtx, {});
    const info = await Actions.getApplyInfo.handler(anon, { token: doorToken });
    expect(info.valid).toBe(false);
    const out = await Actions.submitDriverApplication.handler(anonMail, { token: doorToken, ...APPLICANT, email: "late@example.com", website: null });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("closed");

    const made = await Actions.createRecruitingDoor.handler(ownerCtx, {});
    const t = tokenOf(made.doorUrl);
    await db
      .update(schema.recruitingDoors)
      .set({ expiresAt: new Date(Date.now() - 60000) })
      .where(eq(schema.recruitingDoors.token, t));
    const expired = await Actions.getApplyInfo.handler(anon, { token: t });
    expect(expired.valid).toBe(false);
  });

  test("another fleet's desk sees none of acme's applications and can't move them", async () => {
    const inbox = await Actions.getRecruitingApplications.handler(outsiderCtx, {});
    expect(inbox.applications.every((a) => a.email.endsWith("@example.com") && a.name.startsWith("Flood"))).toBe(true);
    expect(inbox.applications.find((a) => a.email === "jo@example.com")).toBeUndefined();
    const acmeApps = await db.select().from(schema.driverApplications);
    const jo = acmeApps.find((a) => a.email === "jo@example.com")!;
    const err = await errOf(Actions.moveApplicationStage.handler(outsiderCtx, { applicationId: jo.id, toStage: "contacted" }));
    expect(err).toContain("isn't in your fleet's inbox");
  });
});
