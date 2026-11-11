// beta-join.test.ts — coverage for the beta join-request + owner
// approval flow (x's order, 2026-11-11), against the REAL host auth
// module over a throwaway migrated SQLite database:
//
//   submit:  creates a pending row; email normalized; fields capped
//   absorb:  duplicate-pending, existing account, live invite,
//            honeypot — all answer the same { ok: true }, create nothing
//   grants:  a submit creates NO account, NO session, NO invite, and
//            sets NO cookie
//   queue:   list is owner-only; decide is owner-only
//   approve: mints a tester invite through the manual path (kind,
//            grantPlan, TTL, queued mail + one-time link), links it to
//            the request, audits both events
//   refuse:  approval surfaces cap / live-invite errors verbatim and
//            leaves the request pending
//   deny:    flips to denied, mints nothing, audits the decision
//   limits:  per-IP window trips and absorbs whole
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (same pattern as social-auth.test.ts);
// assertions are scoped to this suite's own emails/IPs in case the
// singleton is shared with another suite in the process.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-betajoin-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.RESEND_API_KEY;
delete process.env.DOC_EMAIL_FROM;

const { getDb, STANDALONE_ROOT } = await import("./ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("../server/src/schema");
const { eq } = await import("drizzle-orm");
const auth = await import("./auth");

const db = getDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `betajoin-${tag}-${seq}@test.local`;
}
function uniqIp(): string {
  seq += 1;
  return `10.99.${Math.floor(seq / 250)}.${seq % 250}`;
}

function req(
  pathName: string,
  opts?: { method?: string; body?: unknown; ip?: string; cookie?: string },
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "beta-join-test",
  };
  if (opts?.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts?.cookie) headers["cookie"] = opts.cookie;
  return new Request(`http://localhost${pathName}`, {
    method: opts?.method ?? "POST",
    headers,
    body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function seedAccount(
  email: string,
  opts?: { isOwner?: boolean },
): Promise<number> {
  const inserted = await db
    .insert(schema.accounts)
    .values({
      email,
      passwordHash: "$argon2id$seeded-not-a-real-password",
      status: "active",
      isOwner: opts?.isOwner ?? false,
    })
    .returning({ id: schema.accounts.id });
  const accountId = inserted[0]!.id;
  const username = `beta${accountId}`;
  await db.insert(schema.profile).values({
    accountId,
    socialUsername: username,
    plan: "basic",
    heightFt: 6,
    heightIn: 1,
    weightLbs: 200,
    lengthFt: 13,
    mpg: 7,
    dieselPrice: 4,
    tankRangeMi: 800,
  });
  await db.insert(schema.socialUsers).values({ username, displayName: "Driver" });
  return accountId;
}

async function sessionCookie(accountId: number): Promise<string> {
  const { token } = await auth.createSession(db, {
    accountId,
    createdVia: "signin",
    deviceLabel: "beta-join-test",
    userAgent: "beta-join-test",
    ip: null,
    pendingTotp: false,
  });
  return `sm_session=${token}`;
}

async function requestRows(email: string) {
  return db
    .select()
    .from(schema.betaJoinRequests)
    .where(eq(schema.betaJoinRequests.email, email));
}

async function inviteRows(email: string) {
  return db
    .select()
    .from(schema.accountInvites)
    .where(eq(schema.accountInvites.email, email));
}

async function auditEvents(event: string) {
  const rows = await db
    .select()
    .from(schema.authAuditLog)
    .where(eq(schema.authAuditLog.event, event));
  return rows;
}

const ownerEmail = uniq("owner");
// Migration 0108 enforces exactly ONE owner account. When this suite
// shares the ctx singleton with an earlier suite in the same process
// (see the header note), that suite's owner already exists — reuse it
// instead of fighting the one-owner index; seed only when none exists.
async function ensureOwnerId(): Promise<number> {
  const existing = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.isOwner, true))
    .limit(1);
  if (existing[0]) return existing[0].id;
  try {
    return await seedAccount(ownerEmail, { isOwner: true });
  } catch {
    const again = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isOwner, true))
      .limit(1);
    if (again[0]) return again[0].id;
    throw new Error("could not seed or find the owner account");
  }
}
const ownerId = await ensureOwnerId();
const ownerCookie = await sessionCookie(ownerId);

// ---------------------------------------------------------------------------
// Submit path
// ---------------------------------------------------------------------------

describe("beta join submit", () => {
  test("creates a pending row with normalized email; grants nothing", async () => {
    const email = uniq("firstcase");
    const before = {
      accounts: (await db.select().from(schema.accounts)).length,
      sessions: (await db.select().from(schema.authSessions)).length,
      invites: (await db.select().from(schema.accountInvites)).length,
    };
    const res = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: {
          name: "  Case Driver  ",
          email: `  ${email.toUpperCase()} `,
          role: "driver",
          note: "  Run a flatbed out of the Southeast.  ",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toBeNull();

    const rows = await requestRows(email);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.name).toBe("Case Driver");
    expect(rows[0]!.role).toBe("driver");
    expect(rows[0]!.note).toBe("Run a flatbed out of the Southeast.");
    expect(rows[0]!.inviteId).toBeNull();
    expect(rows[0]!.decidedAt).toBeNull();

    // The public door granted NOTHING: no account, no session, no invite.
    const after = {
      accounts: (await db.select().from(schema.accounts)).length,
      sessions: (await db.select().from(schema.authSessions)).length,
      invites: (await db.select().from(schema.accountInvites)).length,
    };
    expect(after).toEqual(before);
  });

  test("duplicate submission while pending is absorbed — still one row", async () => {
    const email = uniq("dupe");
    const ip = uniqIp();
    const body = { name: "Dupe Dan", email, role: "just_testing", note: "" };
    const first = await auth.handleBetaJoinSubmit(req("/auth/beta-requests", { ip, body }));
    const second = await auth.handleBetaJoinSubmit(req("/auth/beta-requests", { ip, body }));
    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true });
    expect((await requestRows(email)).length).toBe(1);
  });

  test("email with an existing account absorbs silently", async () => {
    const email = uniq("hasacct");
    await seedAccount(email);
    const res = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Already In", email, role: "driver", note: "" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await requestRows(email)).length).toBe(0);
  });

  test("email with a live pending invite absorbs silently", async () => {
    const email = uniq("invited");
    await db.insert(schema.accountInvites).values({
      kind: "trial",
      email,
      tokenHash: auth.sha256Hex(`seed-token-${email}`),
      grantPlan: "diamond",
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const res = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Invited Already", email, role: "fleet_owner", note: "" },
      }),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect((await requestRows(email)).length).toBe(0);
  });

  test("honeypot trip absorbs silently", async () => {
    const email = uniq("bot");
    const res = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: {
          name: "Totally Human",
          email,
          role: "driver",
          note: "",
          website: "http://spam.example",
        },
      }),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect((await requestRows(email)).length).toBe(0);
  });

  test("invalid email is the one honest 400; unknown role coerces", async () => {
    const bad = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "No Mail", email: "not-an-email", role: "driver", note: "" },
      }),
    );
    expect(bad.status).toBe(400);

    const email = uniq("role");
    const res = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Odd Role", email, role: "pirate", note: "" },
      }),
    );
    expect(await res.json()).toEqual({ ok: true });
    const rows = await requestRows(email);
    expect(rows.length).toBe(1);
    expect(rows[0]!.role).toBe("just_testing");
  });

  test("per-IP rate limit trips and absorbs whole", async () => {
    const ip = uniqIp();
    // 10 submissions from distinct emails pass the window (10/hour)...
    for (let i = 0; i < 10; i++) {
      const email = uniq(`rl${i}`);
      const res = await auth.handleBetaJoinSubmit(
        req("/auth/beta-requests", {
          ip,
          body: { name: `RL ${i}`, email, role: "driver", note: "" },
        }),
      );
      expect(await res.json()).toEqual({ ok: true });
      expect((await requestRows(email)).length).toBe(1);
    }
    // ...the 11th from the same IP is absorbed: generic answer, no row.
    const blockedEmail = uniq("rlblocked");
    const res = await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip,
        body: { name: "RL Blocked", email: blockedEmail, role: "driver", note: "" },
      }),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect((await requestRows(blockedEmail)).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Owner queue
// ---------------------------------------------------------------------------

describe("beta join owner queue", () => {
  test("list is owner-only and pending-first", async () => {
    const email = uniq("queued");
    await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Queued Quinn", email, role: "dispatcher", note: "Runs a small fleet desk." },
      }),
    );

    const anon = await auth.handleBetaJoinList(req("/auth/beta-requests", { method: "GET" }));
    expect(anon.status).toBe(403);

    const nonOwnerId = await seedAccount(uniq("plain"));
    const nonOwner = await auth.handleBetaJoinList(
      req("/auth/beta-requests", { method: "GET", cookie: await sessionCookie(nonOwnerId) }),
    );
    expect(nonOwner.status).toBe(403);

    const res = await auth.handleBetaJoinList(
      req("/auth/beta-requests", { method: "GET", cookie: ownerCookie }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      pending: Array<{ email: string; name: string; role: string; note: string }>;
      decided: unknown[];
    };
    const mine = data.pending.find((r) => r.email === email);
    expect(mine).toBeTruthy();
    expect(mine!.name).toBe("Queued Quinn");
    expect(mine!.role).toBe("dispatcher");
    expect(mine!.note).toBe("Runs a small fleet desk.");
    expect(Array.isArray(data.decided)).toBe(true);
  });

  test("approve mints the manual-path tester invite and links it", async () => {
    const email = uniq("approve");
    await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Approve Amy", email, role: "driver", note: "" },
      }),
    );
    const [requestRow] = await requestRows(email);

    const res = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: requestRow!.id, decision: "approve" },
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      inviteId: number;
      emailed: boolean;
      queued: boolean;
      acceptLink: string | null;
    };
    expect(data.ok).toBe(true);
    // Mail transport is unconfigured in this suite ⇒ queued, and the
    // one-time accept link comes back to the owner session (D1).
    expect(data.emailed).toBe(false);
    expect(data.queued).toBe(true);
    expect(data.acceptLink).toContain("/auth/accept?token=");

    // The invite is EXACTLY what POST /auth/invites would mint.
    const invites = await inviteRows(email);
    expect(invites.length).toBe(1);
    expect(invites[0]!.id).toBe(data.inviteId);
    expect(invites[0]!.kind).toBe("tester");
    expect(invites[0]!.grantPlan).toBe("diamond");
    expect(invites[0]!.status).toBe("pending");
    expect(invites[0]!.invitedByAccountId).toBe(ownerId);
    const ttlMs = invites[0]!.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(14 * 24 * 60 * 60 * 1000 + 60 * 1000);

    // The request carries the decision + linkage.
    const [after] = await requestRows(email);
    expect(after!.status).toBe("approved");
    expect(after!.inviteId).toBe(data.inviteId);
    expect(after!.mailQueueId).not.toBeNull();
    expect(after!.decidedBy).toBe(ownerId);
    expect(after!.decidedAt).not.toBeNull();

    // Both audit events landed (the core's invite_issued + the decision).
    const issued = await auditEvents("invite_issued");
    expect(issued.some((e) => (e.detail ?? "").includes(`invite #${data.inviteId}`))).toBe(true);
    const approved = await auditEvents("beta_request_approved");
    expect(approved.some((e) => (e.detail ?? "").includes(`beta request #${requestRow!.id} approved`))).toBe(true);

    // Deciding again is a clean 409, and no second invite appears.
    const again = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: requestRow!.id, decision: "approve" },
      }),
    );
    expect(again.status).toBe(409);
    expect((await inviteRows(email)).length).toBe(1);
  });

  test("deny flips the request, mints nothing, audits the decision", async () => {
    const email = uniq("deny");
    await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Deny Dan", email, role: "just_testing", note: "" },
      }),
    );
    const [requestRow] = await requestRows(email);
    const res = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: requestRow!.id, decision: "deny" },
      }),
    );
    expect(res.status).toBe(200);
    const [after] = await requestRows(email);
    expect(after!.status).toBe("denied");
    expect(after!.inviteId).toBeNull();
    expect(after!.decidedBy).toBe(ownerId);
    expect((await inviteRows(email)).length).toBe(0);
    const denied = await auditEvents("beta_request_denied");
    expect(denied.some((e) => (e.detail ?? "").includes(`beta request #${requestRow!.id} denied`))).toBe(true);
  });

  test("decide is owner-only and validates its input", async () => {
    const email = uniq("guard");
    await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Guard Gail", email, role: "driver", note: "" },
      }),
    );
    const [requestRow] = await requestRows(email);

    const anon = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", { body: { id: requestRow!.id, decision: "approve" } }),
    );
    expect(anon.status).toBe(403);

    const nonOwnerId = await seedAccount(uniq("plain2"));
    const nonOwner = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: await sessionCookie(nonOwnerId),
        body: { id: requestRow!.id, decision: "approve" },
      }),
    );
    expect(nonOwner.status).toBe(403);

    const badDecision = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: requestRow!.id, decision: "maybe" },
      }),
    );
    expect(badDecision.status).toBe(400);

    const missing = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: 99999999, decision: "approve" },
      }),
    );
    expect(missing.status).toBe(404);

    // Untouched by all of the above.
    const [after] = await requestRows(email);
    expect(after!.status).toBe("pending");
    expect((await inviteRows(email)).length).toBe(0);
  });

  test("approve surfaces a live-invite refusal and stays pending", async () => {
    const email = uniq("conflict");
    await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Conflict Cal", email, role: "driver", note: "" },
      }),
    );
    const [requestRow] = await requestRows(email);
    // A live tester invite lands AFTER the request (manual issue).
    await db.insert(schema.accountInvites).values({
      kind: "tester",
      email,
      tokenHash: auth.sha256Hex(`seed-token-${email}`),
      grantPlan: "diamond",
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const res = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: requestRow!.id, decision: "approve" },
      }),
    );
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe("A live invite already exists for that email.");
    const [after] = await requestRows(email);
    expect(after!.status).toBe("pending");
    expect(after!.inviteId).toBeNull();
    // Still exactly the one manually-seeded invite.
    expect((await inviteRows(email)).length).toBe(1);
  });

  test("approve surfaces the daily cap and stays pending", async () => {
    const email = uniq("capped");
    await auth.handleBetaJoinSubmit(
      req("/auth/beta-requests", {
        ip: uniqIp(),
        body: { name: "Capped Carla", email, role: "driver", note: "" },
      }),
    );
    const [requestRow] = await requestRows(email);
    // Seed today's invite_issued audit rows up to the cap for the owner.
    for (let i = 0; i < auth.INVITE_ISSUE_DAILY_CAP; i++) {
      await db.insert(schema.authAuditLog).values({
        accountId: null,
        actorAccountId: ownerId,
        event: "invite_issued",
        detail: `seeded cap row ${i}`,
      });
    }
    const res = await auth.handleBetaJoinDecide(
      req("/auth/beta-requests/decide", {
        cookie: ownerCookie,
        body: { id: requestRow!.id, decision: "approve" },
      }),
    );
    expect(res.status).toBe(429);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBe("Daily invite cap reached.");
    const [after] = await requestRows(email);
    expect(after!.status).toBe("pending");
    expect((await inviteRows(email)).length).toBe(0);
  });
});
