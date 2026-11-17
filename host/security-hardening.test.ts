// security-hardening.test.ts — coverage for the Wave 2 item 12 host
// hardening, in two parts:
//
//   Part A (in-process, the beta-join pattern — real host auth
//   handlers over a throwaway migrated SQLite database):
//     - password-reset requests: the per-IP window is now HONORED
//       (10/hour, then the identical { ok: true } with nothing
//       issued — no enumeration change)
//     - the TOTP gate now throttles: 10 attempts per IP per 15
//       minutes, checked before verification, so a correct code is
//       also refused while the window is tripped — and still works
//       from a fresh IP
//     - password change now throttles current-password guesses
//
//   Part B (the real server, spawned on a test port):
//     - private blobs refuse anonymous reads (404, existence not
//       leaked); the same key serves with a session; public blobs
//       serve openly; HTML downloads as an attachment under a
//       sandbox CSP; photos render inline
//     - every response family carries the security headers
//     - 2026-11-17 hardening: CSRF origin verification refuses
//       foreign-Origin POSTs to /actions and /auth/* (the Apple
//       form_post callback stays exempt, state-protected); the
//       static public pages carry the strict deny-by-default CSP
//       while action JSON keeps the baseline; Permissions-Policy
//       and X-Permitted-Cross-Domain-Policies ride along
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported.

import { afterAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-sechost-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.RESEND_API_KEY;
delete process.env.DOC_EMAIL_FROM;
delete process.env.AUTH_TOKEN_PEPPER;

const { getDb, createInvocation, STANDALONE_ROOT, DB_PATH, BLOBS_DIR } = await import("./ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("../server/src/schema");
const { eq } = await import("drizzle-orm");
const auth = await import("./auth");

const db = getDb();

let seq = 0;
function uniqIp(): string {
  seq += 1;
  return `10.77.${Math.floor(seq / 250)}.${seq % 250}`;
}

function req(pathName: string, ip: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
    "user-agent": "security-hardening-test",
  };
  if (cookie) headers["cookie"] = cookie;
  return new Request(`http://localhost${pathName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function seedAccount(email: string, password?: string): Promise<{ accountId: number; username: string }> {
  const username = email.split("@")[0]!.replace(/[^a-z0-9]/g, "");
  const acct = await db
    .insert(schema.accounts)
    .values({
      email,
      passwordHash: password ? await Bun.password.hash(password) : null,
      status: "active",
    })
    .returning({ id: schema.accounts.id });
  await db.insert(schema.profile).values({
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
  });
  return { accountId: acct[0]!.id, username };
}

async function sessionCookie(accountId: number, pendingTotp: boolean): Promise<string> {
  const { token } = await auth.createSession(db, {
    accountId,
    createdVia: "signin",
    deviceLabel: "security-hardening-test",
    userAgent: "security-hardening-test",
    ip: null,
    pendingTotp,
  });
  return `sm_session=${token}`;
}

// ---------------------------------------------------------------------------
describe("item 12 host — auth throttles (in-process)", () => {
  test("password reset: the per-IP cap is honored — the 11th request issues nothing but answers identically", async () => {
    const ip = uniqIp();
    const myAccounts = new Set<number>();
    for (let i = 1; i <= 11; i++) {
      const email = `resetcap${i}@test.local`;
      const { accountId } = await seedAccount(email);
      myAccounts.add(accountId);
      const res = await auth.handleRequestReset(req("/auth/request-reset", ip, { email }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true); // identical shape every time — no enumeration hint
    }
    // Scoped to this test's own accounts (suites can share one
    // database in a full run): exactly the first 10 requests queued
    // a reset mail; the 11th was silently absorbed by the IP cap.
    const mail = (await db.select().from(schema.authMailQueue)).filter(
      (m) => m.kind === "reset" && myAccounts.has(m.accountId),
    );
    expect(mail.length).toBe(10);
  });

  test("TOTP gate: 10 attempts per IP, then even the correct code is refused until the window resets", async () => {
    const { accountId, username } = await seedAccount("totpgate@test.local");
    // Plaintext secret on the legacy vault path (decryptVaultValue
    // passes non-"enc:v1:" values through) — base32 for 20 bytes.
    const secretB32 = "JBSWY3DPEHPK3PXPP7RPRSTLJBSWY3DP";
    await db.insert(schema.totpCredentials).values({ username, secretEnc: secretB32, enabled: true });
    const cookie = await sessionCookie(accountId, true);
    const ip = uniqIp();

    for (let i = 0; i < 10; i++) {
      const res = await auth.handleTotp(req("/auth/totp", ip, { totpCode: "000000" }, cookie));
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("That code doesn't match.");
    }
    // The correct code, same IP: the tripped window refuses BEFORE
    // verification.
    const correct = totpNow(secretB32);
    const blocked = await auth.handleTotp(req("/auth/totp", ip, { totpCode: correct }, cookie));
    expect(blocked.status).toBe(401);
    const blockedBody = (await blocked.json()) as { error: string };
    expect(blockedBody.error).toContain("Too many code attempts");
    // From a fresh IP the same correct code completes the gate.
    const ok = await auth.handleTotp(req("/auth/totp", uniqIp(), { totpCode: correct }, cookie));
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { ok: boolean };
    expect(okBody.ok).toBe(true);
  });

  test("password change: current-password guesses are throttled per IP", async () => {
    const { accountId } = await seedAccount("pwchange@test.local", "Correct-Horse-42");
    const cookie = await sessionCookie(accountId, false);
    const ip = uniqIp();
    for (let i = 0; i < 10; i++) {
      const res = await auth.handlePasswordChange(
        req("/auth/password", ip, { currentPassword: "wrong-guess", newPassword: "Whatever-123" }, cookie),
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toContain("Too many attempts");
    }
    const res = await auth.handlePasswordChange(
      req("/auth/password", ip, { currentPassword: "Correct-Horse-42", newPassword: "Whatever-123" }, cookie),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Too many attempts");
  });
});

/** RFC 6238 TOTP (SHA-1, 30s step, 6 digits) for the seeded secret. */
function totpNow(secretB32: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretB32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const sig = createHmac("sha1", Buffer.from(bytes)).update(msg).digest();
  const offset = sig[sig.length - 1]! & 0x0f;
  const binary =
    ((sig[offset]! & 0x7f) << 24) | ((sig[offset + 1]! & 0xff) << 16) | ((sig[offset + 2]! & 0xff) << 8) | (sig[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

// ---------------------------------------------------------------------------
describe("item 12 host — blob route + security headers (real server)", () => {
  const PORT = 18931;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let blobCookie = "";

  afterAll(() => {
    proc?.kill();
  });

  test("server boots and enforces blob visibility + headers", async () => {
    // Seed blobs + a session BEFORE boot (the server's blob metadata
    // cache loads from the sidecar on first use).
    const inv = createInvocation({ executePrivileged: (async () => ({})) as never, viewer: null });
    await inv.ctx.blobs.put("sec-public.txt", new TextEncoder().encode("open hello"), {
      contentType: "text/plain",
      public: true,
    });
    await inv.ctx.blobs.put("sec-private.html", new TextEncoder().encode("<html><script>alert(1)</script></html>"), {
      contentType: "text/html",
    });
    await inv.ctx.blobs.put("sec-photo.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      contentType: "image/jpeg",
    });
    const { accountId } = await seedAccount("blobviewer@test.local");
    blobCookie = await sessionCookie(accountId, false);

    // The spawned server must run against the SAME database and
    // blob root this process's host/ctx singleton bound at import —
    // in a full-suite run another suite may have imported ctx first
    // with its own temp paths, so use the bound DB_PATH / BLOBS_DIR
    // constants, never this file's env assignments.
    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(PORT),
      STONEMILES_DB: DB_PATH,
      STONEMILES_BLOBS: BLOBS_DIR,
    };
    delete spawnEnv.STONEMILES_DIALECT;
    delete spawnEnv.AUTH_ALLOW_ANONYMOUS_LOCAL;
    proc = Bun.spawn(["bun", "host/server.ts"], {
      cwd: STANDALONE_ROOT,
      env: spawnEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    const base = `http://127.0.0.1:${PORT}`;
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try {
        const h = await fetch(`${base}/healthz`);
        up = h.status === 200;
        if (up) {
          expect(h.headers.get("x-content-type-options")).toBe("nosniff");
          expect(h.headers.get("strict-transport-security")).toContain("max-age=31536000");
          expect(h.headers.get("x-frame-options")).toBe("SAMEORIGIN");
          expect(h.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
          // 2026-11-17 hardening: device-feature lockdown + the
          // cross-domain policy shut-off ride on every response.
          expect(h.headers.get("permissions-policy")).toContain("geolocation=(self)");
          expect(h.headers.get("permissions-policy")).toContain("camera=()");
          expect(h.headers.get("x-permitted-cross-domain-policies")).toBe("none");
        }
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(up).toBe(true);

    // Public blob: served openly, but a text file still downloads
    // as an attachment under the sandbox CSP.
    const pub = await fetch(`${base}/blobs/sec-public.txt`);
    expect(pub.status).toBe(200);
    expect(await pub.text()).toBe("open hello");
    expect(pub.headers.get("content-disposition")).toContain("attachment");
    expect(pub.headers.get("content-security-policy")).toContain("sandbox");

    // Private blob, anonymous: 404 — the key's existence is not
    // confirmed to anyone without a session.
    const anon = await fetch(`${base}/blobs/sec-private.html`);
    expect(anon.status).toBe(404);

    // Private blob with a session: served — as an attachment, never
    // inline HTML on the app origin.
    const authed = await fetch(`${base}/blobs/sec-private.html`, { headers: { cookie: blobCookie } });
    expect(authed.status).toBe(200);
    expect(authed.headers.get("content-disposition")).toContain("attachment");
    expect(authed.headers.get("content-type")).toBe("text/html");

    // A photo with a session renders inline (the app's viewing).
    const photo = await fetch(`${base}/blobs/sec-photo.jpg`, { headers: { cookie: blobCookie } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-disposition")).toContain("inline");

    // Public pages carry the headers too.
    const track = await fetch(`${base}/track/rcv_deadbeef`);
    expect(track.status).toBe(200);
    expect(track.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(track.headers.get("referrer-policy")).toBe("same-origin");
    // 2026-11-17 hardening: the static public pages carry the
    // STRICT CSP (deny-by-default), not the app-shell baseline.
    const pageCsp = track.headers.get("content-security-policy") ?? "";
    expect(pageCsp).toContain("default-src 'none'");
    expect(pageCsp).toContain("form-action 'self'");
    expect(pageCsp).toContain("connect-src 'self'");

    // And action responses (public action, no session needed).
    const act = await fetch(`${base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verifyCode", args: { code: "SM-XXXXXX" } }),
    });
    expect(act.status).toBe(200);
    expect(act.headers.get("x-content-type-options")).toBe("nosniff");
    // Action JSON keeps the BASELINE CSP — the strict page policy
    // belongs to the static pages only.
    expect(act.headers.get("content-security-policy")).not.toContain("default-src 'none'");

    // ---- CSRF origin verification (2026-11-17 hardening) --------
    // A state-changing POST arriving with a FOREIGN Origin is
    // refused before any handler runs…
    const csrfActions = await fetch(`${base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ action: "verifyCode", args: { code: "SM-XXXXXX" } }),
    });
    expect(csrfActions.status).toBe(403);
    // …on the auth routes too (login CSRF included)…
    const csrfSignin = await fetch(`${base}/auth/signin`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ email: "a@b.c", password: "x" }),
    });
    expect(csrfSignin.status).toBe(403);
    // …while a same-origin Origin passes the gate (the handler's
    // own answer follows — here the public action answers 200)…
    const csrfSame = await fetch(`${base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ action: "verifyCode", args: { code: "SM-XXXXXX" } }),
    });
    expect(csrfSame.status).toBe(200);
    // …and the ONE exempt route: Apple's form_post callback arrives
    // cross-site by design and is protected by its single-use OAuth
    // state instead. With Apple unconfigured in this env the handler
    // answers with its sign-in-failed redirect — never the CSRF 403.
    const appleCb = await fetch(`${base}/auth/apple/callback`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com" },
      body: "code=x&state=y",
    });
    expect(appleCb.status).toBe(302);
  }, 120_000);
});
