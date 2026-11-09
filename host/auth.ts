// Standalone auth core for STONEMILES (Re-platform Phase 2b).
//
// Implements AUTH-DESIGN.md with the owner's adopted decisions D1–D7
// (2026-11-09):
//   D1 invite + reset email goes live via the Resend privileged-handler
//      contract (RESEND_API_KEY / DOC_EMAIL_FROM); unconfigured ⇒ the
//      link is recorded QUEUED in auth_mail_queue for owner delivery —
//      never fake-sent.
//   D2 registration is invite-only (account_invites; no open signup).
//   D3 sessions: 30-day absolute, 7-day idle, last-active slides at most
//      hourly. Team seats inherit the same lifetimes.
//   D4 Founding Tester completion = a session on >= 10 of the 14 days
//      since invite acceptance; owner-visible completion list; the
//      Diamond→Gold-year flip is a MANUAL audited owner action.
//   D5 trial invites grant Diamond for 30 days, then Basic (enforced at
//      plan-derivation time in actions.ts myPlan + here at resolution).
//   D6 shipper/broker portals stay desk-linked records — no portal
//      logins exist in this module, by design.
//   D7 TOTP required for owner + team seats at sign-in; optional for
//      drivers. Verification reuses the Security Pack's stored TOTP
//      secrets + recovery codes (same vault, same code math).
//
// Hygiene (design §8.3): passwords exist only as Argon2id PHC strings;
// session/reset/invite tokens only as SHA-256 hashes. Plaintext tokens
// leave the server exactly once — in the emailed link, in the queued
// mail row the owner hand-delivers, or on the operator terminal (claim).

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "../server/src/schema";
import { privilegedHandlers } from "../server/src/privileged";
import { getDb } from "./ctx";

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Constants (design §5.2 / §8.1 + adopted D3)
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "sm_session";
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_SLIDE_MS = 60 * 60 * 1000; // slide at most hourly
export const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes
export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TESTER_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const TRIAL_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TRIAL_PLAN_MS = 30 * 24 * 60 * 60 * 1000; // D5
export const LOCK_AFTER_FAILS = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const INVITE_ISSUE_DAILY_CAP = 50;

const GENERIC_SIGNIN_ERROR = "Email or password doesn't match.";
const GENERIC_LINK_ERROR =
  "This link isn't valid — it may have expired or already been used.";

// Precomputed dummy Argon2id hash so unknown-email sign-ins pay the same
// verify cost as real ones (enumeration timing resistance, §8.2). This is
// a hash of a random throwaway string; it matches no account.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = Bun.password.hash("dummy-timing-equalizer-7f3a", {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 2,
    });
  }
  return dummyHashPromise;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function normalizeEmail(raw: string): string {
  return raw.trim().normalize("NFC").toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  if (/\s/.test(email)) return false;
  return true;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashPassword(password: string): Promise<string> {
  // Parameters pinned explicitly (design §2.2) so a Bun upgrade never
  // silently weakens new hashes; the PHC string records them.
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });
}

const COMMON_PASSWORDS = new Set([
  "password1234", "123456789012", "qwertyuiop12", "letmein12345",
  "password12345", "1234567890ab", "abcd12345678", "iloveyou1234",
  "admin1234567", "welcome12345", "changeme1234", "truckdriver1",
]);

export function passwordPolicyError(password: string): string | null {
  if (typeof password !== "string" || password.length < 12) {
    return "Password must be at least 12 characters.";
  }
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common — pick something else.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit (auth_audit_log + chain_log mirror, §8.4). The chain mirror uses
// the host's own append against chain_log — payload carries ONLY the
// redacted event fields, same posture as logSecurityEvent/teamLog.
// ---------------------------------------------------------------------------

let chainQueue: Promise<unknown> = Promise.resolve();

export async function audit(
  db: Db,
  args: {
    event: string;
    accountId?: number | null;
    actorAccountId?: number | null;
    detail?: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.insert(schema.authAuditLog).values({
    accountId: args.accountId ?? null,
    actorAccountId: args.actorAccountId ?? null,
    event: args.event,
    detail: (args.detail ?? "").slice(0, 200),
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
  });
  const run = chainQueue.then(async () => {
    const last = await db
      .select({ hash: schema.chainLog.hash })
      .from(schema.chainLog)
      .orderBy(desc(schema.chainLog.id))
      .limit(1);
    const prevHash = last[0]?.hash ?? "GENESIS";
    const payload = JSON.stringify({
      kind: args.event,
      accountId: args.accountId ?? null,
      detail: (args.detail ?? "").slice(0, 200),
      at: new Date().toISOString(),
    });
    const hash = createHash("sha256")
      .update(`${prevHash}|auth_event|${payload}`)
      .digest("hex");
    await db.insert(schema.chainLog).values({
      refKind: "driver",
      refId: args.accountId ?? null,
      sessionId: null,
      event: "auth_event",
      payload,
      prevHash,
      hash,
    });
  });
  chainQueue = run.catch(() => undefined);
  await run;
}

// ---------------------------------------------------------------------------
// Mail (D1): send through the existing Resend privileged handlers
// directly (host process = the transport collapses to process.env reads,
// exactly the contract privileged.ts documents). Unconfigured ⇒ queued.
// ---------------------------------------------------------------------------

async function sendAuthMail(args: {
  db: Db;
  accountId: number | null;
  kind: "invite" | "reset";
  to: string;
  subject: string;
  text: string;
  linkToken: string;
}): Promise<{ sent: boolean; queued: boolean }> {
  const entry = privilegedHandlers.entries.find(
    (e) => e.contract.name === "sendDocEmail",
  );
  let providerId: string | null = null;
  if (entry) {
    try {
      const res = (await entry.handler({
        to: args.to,
        subject: args.subject,
        text: args.text,
        attachmentBase64: null,
        attachmentFilename: null,
      } as never)) as { ok: boolean; notConfigured: boolean; providerId: string | null };
      if (res.ok && res.providerId) providerId = res.providerId;
    } catch {
      providerId = null; // transport failure ⇒ queued, never fake-sent
    }
  }
  if (providerId) {
    await args.db.insert(schema.authMailQueue).values({
      accountId: args.accountId,
      kind: args.kind,
      toEmail: args.to,
      linkToken: null, // sent rows keep no token
      status: "sent",
      providerId,
      sentAt: new Date(),
    });
    return { sent: true, queued: false };
  }
  await args.db.insert(schema.authMailQueue).values({
    accountId: args.accountId,
    kind: args.kind,
    toEmail: args.to,
    linkToken: args.linkToken, // owner hand-delivers queued links (D1)
    status: "queued",
    providerId: null,
  });
  return { sent: false, queued: true };
}

function appBaseUrl(req: Request): string {
  const envBase = process.env.APP_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

// ---------------------------------------------------------------------------
// Viewer + session resolution (§5.3)
// ---------------------------------------------------------------------------

export interface AuthViewer {
  accountId: number;
  profileId: number;
  username: string;
  email: string;
  isOwner: boolean;
  status: string;
  /** True while the session is paused at the D7 TOTP gate. */
  totpPending: boolean;
  /** True when this account holds an active team seat (D7 gate input). */
  hasTeamSeat: boolean;
  sessionId: number;
}

export interface ResolvedSession {
  viewer: AuthViewer;
  session: typeof schema.authSessions.$inferSelect;
}

function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function recordActivityDay(db: Db, accountId: number): Promise<void> {
  const day = todayKey();
  const existing = await db
    .select({ id: schema.authActivityDays.id })
    .from(schema.authActivityDays)
    .where(
      and(
        eq(schema.authActivityDays.accountId, accountId),
        eq(schema.authActivityDays.day, day),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.authActivityDays).values({ accountId, day });
  }
}

export function sessionCookieFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (header) {
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE && rest.length > 0) {
        return decodeURIComponent(rest.join("="));
      }
    }
  }
  const authz = req.headers.get("authorization");
  if (authz && authz.toLowerCase().startsWith("bearer ")) {
    return authz.slice(7).trim();
  }
  return null;
}

export function sessionCookieHeader(token: string, maxAgeSec: number): string {
  const secure =
    process.env.AUTH_ALLOW_INSECURE_LOCALHOST === "1" ? "" : "; Secure";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`;
}

export function clearCookieHeader(): string {
  const secure =
    process.env.AUTH_ALLOW_INSECURE_LOCALHOST === "1" ? "" : "; Secure";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
}

/** Resolve a presented token to a live viewer, enforcing §5.3 step 2. */
export async function resolveSession(
  db: Db,
  token: string | null,
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const tokenHash = process.env.AUTH_TOKEN_PEPPER
    ? createHash("sha256")
        .update(`${process.env.AUTH_TOKEN_PEPPER}:${token}`)
        .digest("hex")
    : sha256Hex(token);
  const rows = await db
    .select()
    .from(schema.authSessions)
    .where(eq(schema.authSessions.tokenHash, tokenHash))
    .limit(1);
  const session = rows[0];
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastActiveAt.getTime() > SESSION_IDLE_MS) return null;

  const accountRows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, session.accountId))
    .limit(1);
  const account = accountRows[0];
  if (!account) return null;
  if (account.status === "disabled") return null;
  if (
    account.status === "locked" &&
    account.lockedUntil &&
    account.lockedUntil.getTime() > now
  ) {
    return null;
  }
  if (account.status !== "active") return null;

  const profileRows = await db
    .select()
    .from(schema.profile)
    .where(eq(schema.profile.accountId, account.id))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;

  const seatRows = await db
    .select()
    .from(schema.teamSeats)
    .where(eq(schema.teamSeats.username, profile.socialUsername))
    .limit(1);
  const hasTeamSeat = seatRows[0]?.active === true;

  // Sliding renewal: at most one write per hour (§5.2/D3).
  if (now - session.lastActiveAt.getTime() >= SESSION_SLIDE_MS) {
    await db
      .update(schema.authSessions)
      .set({ lastActiveAt: new Date(now) })
      .where(eq(schema.authSessions.id, session.id));
    session.lastActiveAt = new Date(now);
  }
  await recordActivityDay(db, account.id);

  return {
    session,
    viewer: {
      accountId: account.id,
      profileId: profile.id,
      username: profile.socialUsername,
      email: account.email,
      isOwner: account.isOwner === true,
      status: account.status,
      totpPending: session.pendingTotpAt != null,
      hasTeamSeat,
      sessionId: session.id,
    },
  };
}

async function createSession(
  db: Db,
  args: {
    accountId: number;
    createdVia: "signin" | "claim" | "invite_accept";
    deviceLabel: string;
    userAgent: string | null;
    ip: string | null;
    pendingTotp: boolean;
  },
): Promise<{ token: string; sessionId: number }> {
  const token = mintToken();
  const tokenHash = process.env.AUTH_TOKEN_PEPPER
    ? createHash("sha256")
        .update(`${process.env.AUTH_TOKEN_PEPPER}:${token}`)
        .digest("hex")
    : sha256Hex(token);
  const now = new Date();
  const inserted = await db
    .insert(schema.authSessions)
    .values({
      accountId: args.accountId,
      tokenHash,
      deviceLabel: args.deviceLabel.slice(0, 80),
      userAgent: args.userAgent,
      ipFirstSeen: args.ip,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      createdVia: args.createdVia,
      pendingTotpAt: args.pendingTotp ? now : null,
    })
    .returning({ id: schema.authSessions.id });
  await recordActivityDay(db, args.accountId);
  return { token, sessionId: inserted[0]!.id };
}

export async function revokeSessions(
  db: Db,
  accountId: number,
  scope: "all" | "others",
  exceptSessionId?: number,
): Promise<void> {
  const rows = await db
    .select({ id: schema.authSessions.id })
    .from(schema.authSessions)
    .where(
      and(
        eq(schema.authSessions.accountId, accountId),
        isNull(schema.authSessions.revokedAt),
      ),
    );
  for (const row of rows) {
    if (scope === "others" && exceptSessionId != null && row.id === exceptSessionId) {
      continue;
    }
    await db
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.authSessions.id, row.id));
  }
}

// ---------------------------------------------------------------------------
// TOTP gate (D7) — reuses Security Pack storage + code math. The vault
// key lives in vault_keys (id 1); the TOTP secret is AES-GCM encrypted
// under it in `enc:v1:<ivHex>:<cipherHex>` form (see actions.ts §PII
// vault). This is the same decryption, re-implemented host-side because
// actions.ts does not export its helpers.
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function decryptVaultValue(db: Db, stored: string): Promise<string | null> {
  if (!stored.startsWith("enc:v1:")) return stored;
  const parts = stored.split(":");
  const ivHex = parts[2] ?? "";
  const ctHex = parts[3] ?? "";
  if (!ivHex || !ctHex) return null;
  const keyRows = await db
    .select()
    .from(schema.vaultKeys)
    .where(eq(schema.vaultKeys.id, 1))
    .limit(1);
  const keyHex = keyRows[0]?.keyHex;
  if (!keyHex || !/^[0-9a-f]{64}$/.test(keyHex)) return null;
  try {
    const raw = hexToBytes(keyHex);
    const key = await crypto.subtle.importKey(
      "raw",
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const iv = hexToBytes(ivHex);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key,
      hexToBytes(ctHex).buffer.slice(0) as ArrayBuffer,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function totpCode(secretBytes: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer.slice(secretBytes.byteOffset, secretBytes.byteOffset + secretBytes.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, msg.buffer.slice(0) as ArrayBuffer),
  );
  const offset = (sig[sig.length - 1] ?? 0) & 0x0f;
  const binary =
    (((sig[offset] ?? 0) & 0x7f) << 24) |
    (((sig[offset + 1] ?? 0) & 0xff) << 16) |
    (((sig[offset + 2] ?? 0) & 0xff) << 8) |
    ((sig[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a code as TOTP or an unused recovery code (consumed on use) —
 *  the same semantics as actions.ts verifyTotpOrRecovery. */
export async function verifyTotpOrRecoveryFor(
  db: Db,
  username: string,
  code: string,
): Promise<{ ok: boolean; via: "totp" | "recovery" | null }> {
  const rows = await db
    .select()
    .from(schema.totpCredentials)
    .where(eq(schema.totpCredentials.username, username))
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) return { ok: false, via: null };
  const secretPlain = await decryptVaultValue(db, row.secretEnc);
  if (secretPlain) {
    const clean = code.replace(/\D/g, "");
    if (clean.length === 6) {
      const step = Math.floor(Date.now() / 30000);
      for (const delta of [-1, 0, 1]) {
        const expected = await totpCode(base32Decode(secretPlain), step + delta);
        if (timingSafeEqualStr(expected, clean)) return { ok: true, via: "totp" };
      }
    }
  }
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length >= 8) {
    const hash = sha256Hex(`recovery:${normalized}`);
    const codes = await db
      .select()
      .from(schema.recoveryCodes)
      .where(eq(schema.recoveryCodes.username, username));
    const hit = codes.find(
      (c) => !c.usedAt && timingSafeEqualStr(c.codeHash, hash),
    );
    if (hit) {
      await db
        .update(schema.recoveryCodes)
        .set({ usedAt: new Date() })
        .where(eq(schema.recoveryCodes.id, hit.id));
      return { ok: true, via: "recovery" };
    }
  }
  return { ok: false, via: null };
}

export async function totpEnabledForUser(db: Db, username: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.totpCredentials)
    .where(eq(schema.totpCredentials.username, username))
    .limit(1);
  return rows[0]?.enabled === true;
}

/** D7: TOTP is required at sign-in for the owner and for team seats. */
export async function totpRequiredFor(
  db: Db,
  account: typeof schema.accounts.$inferSelect,
  username: string,
): Promise<boolean> {
  if (!(await totpEnabledForUser(db, username))) return false;
  if (account.isOwner) return true;
  const seats = await db
    .select()
    .from(schema.teamSeats)
    .where(eq(schema.teamSeats.username, username))
    .limit(1);
  return seats[0]?.active === true;
}

// ---------------------------------------------------------------------------
// Username derivation (§2.4)
// ---------------------------------------------------------------------------

async function deriveUsername(db: Db, email: string, preferred?: string): Promise<string> {
  const sanitize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  const candidates: string[] = [];
  if (preferred) candidates.push(sanitize(preferred));
  candidates.push(sanitize(email.split("@")[0] ?? "driver"));
  candidates.push("driver");
  for (const base of candidates) {
    if (!base) continue;
    let candidate = base;
    for (let n = 0; n < 50; n++) {
      const taken = await db
        .select({ id: schema.profile.id })
        .from(schema.profile)
        .where(eq(schema.profile.socialUsername, candidate))
        .limit(1);
      const socialTaken = await db
        .select({ username: schema.socialUsers.username })
        .from(schema.socialUsers)
        .where(eq(schema.socialUsers.username, candidate))
        .limit(1);
      if (taken.length === 0 && socialTaken.length === 0) return candidate;
      candidate = `${base}${n + 2}`;
    }
  }
  return `driver${Math.floor(Math.random() * 90000 + 10000)}`;
}

// ---------------------------------------------------------------------------
// Profile creation (invite acceptance) — today's lazy defaults, plan from
// the invite grant (never the staging "diamond" fallback for new rows
// unless the invite grants it), account link set in the same write.
// ---------------------------------------------------------------------------

async function createProfileForAccount(
  db: Db,
  args: { accountId: number; username: string; plan: string },
): Promise<number> {
  // Next free id: max(id)+1 (profile ids are explicit, no autoincrement).
  const all = await db.select({ id: schema.profile.id }).from(schema.profile);
  const nextId = all.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  await db.insert(schema.profile).values({
    id: nextId,
    accountId: args.accountId,
    heightFt: 13,
    heightIn: 6,
    weightLbs: 80000,
    lengthFt: 53,
    mpg: 6.5,
    dieselPrice: 3.99,
    tankRangeMi: 800,
    chatName: "Driver",
    socialUsername: args.username,
    plan: args.plan,
    updatedAt: new Date(),
  });
  await db.insert(schema.socialUsers).values({
    username: args.username,
    displayName: "Driver",
  });
  return nextId;
}

// ---------------------------------------------------------------------------
// Route handlers — each returns a Response. Wired in host/server.ts.
// ---------------------------------------------------------------------------

function jsonRes(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

// Per-IP attempt windows (§8.1) — host in-memory, Phase 1 posture.
const ipWindows = new Map<string, { count: number; resetAt: number }>();
function ipAttempt(ip: string | null, limit: number, windowMs: number): boolean {
  if (!ip) return true;
  const now = Date.now();
  const cur = ipWindows.get(ip);
  if (!cur || cur.resetAt <= now) {
    ipWindows.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  cur.count += 1;
  return cur.count <= limit;
}

// ---- POST /auth/signin -----------------------------------------------------

export async function handleSignin(req: Request): Promise<Response> {
  const db = getDb();
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");
  if (!ipAttempt(ip, 20, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }
  const body = await readJson(req);
  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  const totp = body.totpCode != null ? String(body.totpCode) : null;

  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  const account = rows[0];

  if (!account || !account.passwordHash || account.status === "invited") {
    await Bun.password.verify(password, await dummyHash());
    await audit(db, {
      event: "signin_fail",
      accountId: account?.id ?? null,
      detail: `unknown or unclaimed account ${maskEmail(email)}`,
      ip,
      userAgent: ua,
    });
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }
  if (account.status === "disabled") {
    await Bun.password.verify(password, await dummyHash());
    await audit(db, { event: "signin_fail", accountId: account.id, detail: "disabled account", ip, userAgent: ua });
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }
  if (
    account.status === "locked" &&
    account.lockedUntil &&
    account.lockedUntil.getTime() > Date.now()
  ) {
    await audit(db, { event: "signin_locked", accountId: account.id, detail: "signin during lock", ip, userAgent: ua });
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }

  const okPw = await Bun.password.verify(password, account.passwordHash);
  if (!okPw) {
    const fails = account.failedSignins + 1;
    if (fails >= LOCK_AFTER_FAILS) {
      await db
        .update(schema.accounts)
        .set({
          failedSignins: fails,
          status: "locked",
          lockedUntil: new Date(Date.now() + LOCK_MS),
          updatedAt: new Date(),
        })
        .where(eq(schema.accounts.id, account.id));
      await audit(db, { event: "signin_locked", accountId: account.id, detail: `${fails} failed signins — locked 15 min`, ip, userAgent: ua });
      const prof = await db
        .select()
        .from(schema.profile)
        .where(eq(schema.profile.accountId, account.id))
        .limit(1);
      if (prof[0]) {
        await db.insert(schema.securityAlerts).values({
          username: prof[0].socialUsername,
          kind: "account_locked",
          detail: "Account locked for 15 minutes after repeated failed sign-ins.",
        });
      }
    } else {
      await db
        .update(schema.accounts)
        .set({ failedSignins: fails, updatedAt: new Date() })
        .where(eq(schema.accounts.id, account.id));
    }
    await audit(db, { event: "signin_fail", accountId: account.id, detail: "wrong password", ip, userAgent: ua });
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }

  // Password verified. Transparent rehash if parameters drifted (§2.2).
  let status = account.status;
  if (status === "locked") status = "active"; // lock expired (checked above)
  const updates: Partial<typeof schema.accounts.$inferInsert> = {
    failedSignins: 0,
    status,
    lockedUntil: null,
    lastSigninAt: new Date(),
    updatedAt: new Date(),
  };
  if (
    !account.passwordHash.startsWith("$argon2id$v=19$m=65536,t=2") &&
    !account.passwordHash.includes("m=65536,t=2")
  ) {
    updates.passwordHash = await hashPassword(password);
    await audit(db, { event: "password_rehash", accountId: account.id, detail: "argon2id parameters upgraded at signin", ip, userAgent: ua });
  }
  await db.update(schema.accounts).set(updates).where(eq(schema.accounts.id, account.id));

  const profileRows = await db
    .select()
    .from(schema.profile)
    .where(eq(schema.profile.accountId, account.id))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) {
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }

  // D7 TOTP gate: owner + team seats with TOTP enabled must complete the
  // second factor. The session is created PENDING — it authorizes
  // nothing until /auth/totp completes it.
  const needsTotp = await totpRequiredFor(db, account, profile.socialUsername);
  if (needsTotp) {
    if (totp) {
      const v = await verifyTotpOrRecoveryFor(db, profile.socialUsername, totp);
      if (!v.ok) {
        await audit(db, { event: "signin_fail", accountId: account.id, detail: "totp rejected at signin", ip, userAgent: ua });
        return jsonRes({ error: GENERIC_SIGNIN_ERROR, totpRequired: true }, 401);
      }
    } else {
      const { token } = await createSession(db, {
        accountId: account.id,
        createdVia: "signin",
        deviceLabel: String(body.deviceLabel ?? ""),
        userAgent: ua,
        ip,
        pendingTotp: true,
      });
      await audit(db, { event: "signin_ok", accountId: account.id, detail: "password ok — totp pending (D7)", ip, userAgent: ua });
      return jsonRes(
        { ok: true, totpRequired: true },
        200,
        { "set-cookie": sessionCookieHeader(token, SESSION_ABSOLUTE_MS / 1000) },
      );
    }
  }

  const { token } = await createSession(db, {
    accountId: account.id,
    createdVia: "signin",
    deviceLabel: String(body.deviceLabel ?? ""),
    userAgent: ua,
    ip,
    pendingTotp: false,
  });
  await audit(db, { event: "signin_ok", accountId: account.id, detail: "signin", ip, userAgent: ua });
  return jsonRes(
    {
      ok: true,
      totpRequired: false,
      account: {
        email: account.email,
        username: profile.socialUsername,
        isOwner: account.isOwner === true,
      },
    },
    200,
    { "set-cookie": sessionCookieHeader(token, SESSION_ABSOLUTE_MS / 1000) },
  );
}

// ---- POST /auth/totp — complete a pending D7 gate --------------------------

export async function handleTotp(req: Request): Promise<Response> {
  const db = getDb();
  const ip = clientIp(req);
  const token = sessionCookieFromRequest(req);
  const resolved = await resolveSession(db, token);
  if (!resolved || !resolved.viewer.totpPending) {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 401);
  }
  const body = await readJson(req);
  const code = String(body.totpCode ?? body.code ?? "");
  const v = await verifyTotpOrRecoveryFor(db, resolved.viewer.username, code);
  if (!v.ok) {
    await audit(db, { event: "signin_fail", accountId: resolved.viewer.accountId, detail: "totp gate rejected", ip, userAgent: req.headers.get("user-agent") });
    return jsonRes({ error: "That code doesn't match.", totpRequired: true }, 401);
  }
  await db
    .update(schema.authSessions)
    .set({ pendingTotpAt: null, lastActiveAt: new Date() })
    .where(eq(schema.authSessions.id, resolved.session.id));
  await audit(db, { event: "signin_ok", accountId: resolved.viewer.accountId, detail: `totp gate completed via ${v.via}`, ip, userAgent: req.headers.get("user-agent") });
  return jsonRes({ ok: true, totpRequired: false });
}

// ---- POST /auth/signout ------------------------------------------------------

export async function handleSignout(req: Request): Promise<Response> {
  const db = getDb();
  const token = sessionCookieFromRequest(req);
  const resolved = await resolveSession(db, token);
  if (resolved) {
    await db
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.authSessions.id, resolved.session.id));
    await audit(db, { event: "signout", accountId: resolved.viewer.accountId, detail: "self signout", ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  }
  return jsonRes({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
}

// ---- GET /auth/me --------------------------------------------------------------

export async function handleMe(req: Request): Promise<Response> {
  const db = getDb();
  // The client gate needs to know whether THIS host enforces sign-in:
  // the staging-anonymous local flag turns the gate off (Phase 1 proof
  // mode) — everywhere else the gate is enforced.
  const gateEnforced = process.env.AUTH_ALLOW_ANONYMOUS_LOCAL !== "1";
  const resolved = await resolveSession(db, sessionCookieFromRequest(req));
  if (!resolved) return jsonRes({ signedIn: false, gateEnforced }, 200);
  const v = resolved.viewer;
  return jsonRes({
    signedIn: true,
    gateEnforced,
    totpPending: v.totpPending,
    account: {
      email: v.email,
      username: v.username,
      isOwner: v.isOwner,
      hasTeamSeat: v.hasTeamSeat,
      profileId: v.profileId,
    },
  });
}

// ---- POST /auth/request-reset ---------------------------------------------------

export async function handleRequestReset(req: Request): Promise<Response> {
  const db = getDb();
  const ip = clientIp(req);
  ipAttempt(ip, 10, 60 * 60 * 1000);
  const body = await readJson(req);
  const email = normalizeEmail(String(body.email ?? ""));
  // Identical response whether or not the email exists (§8.2).
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  const account = rows[0];
  if (account && account.status !== "invited") {
    // Rate: 3 / account / hour (§8.1) — enforced by counting queue rows.
    const recent = await db
      .select()
      .from(schema.authMailQueue)
      .where(eq(schema.authMailQueue.accountId, account.id));
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentResets = recent.filter(
      (r) => r.kind === "reset" && r.createdAt.getTime() > hourAgo,
    );
    if (recentResets.length < 3) {
      const token = mintToken();
      const now = new Date();
      await db
        .update(schema.passwordResetTokens)
        .set({ supersededAt: now })
        .where(
          and(
            eq(schema.passwordResetTokens.accountId, account.id),
            eq(schema.passwordResetTokens.purpose, "reset"),
            isNull(schema.passwordResetTokens.usedAt),
          ),
        );
      await db.insert(schema.passwordResetTokens).values({
        accountId: account.id,
        purpose: "reset",
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      });
      const link = `${appBaseUrl(req)}/auth/reset?token=${encodeURIComponent(token)}`;
      await sendAuthMail({
        db,
        accountId: account.id,
        kind: "reset",
        to: account.email,
        subject: "STONEMILES — reset your password",
        text: `Use this link within 60 minutes to reset your STONEMILES password:\n\n${link}\n\nIf you didn't ask for this, ignore this email — your password hasn't changed.`,
        linkToken: token,
      });
      await audit(db, { event: "reset_requested", accountId: account.id, detail: `reset link issued for ${maskEmail(account.email)}`, ip, userAgent: req.headers.get("user-agent") });
    }
  } else {
    await audit(db, { event: "reset_requested", accountId: null, detail: `reset requested for unknown email ${maskEmail(email)}`, ip, userAgent: req.headers.get("user-agent") });
  }
  return jsonRes({ ok: true });
}

// ---- POST /auth/reset --------------------------------------------------------------

async function consumeToken(
  db: Db,
  token: string,
  purpose: "reset" | "owner_claim",
): Promise<typeof schema.passwordResetTokens.$inferSelect | null> {
  if (!token) return null;
  const rows = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, sha256Hex(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  if (row.usedAt || row.supersededAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function handleReset(req: Request): Promise<Response> {
  const db = getDb();
  const ip = clientIp(req);
  if (!ipAttempt(ip, 10, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  }
  const body = await readJson(req);
  const token = String(body.token ?? "");
  const newPassword = String(body.newPassword ?? body.password ?? "");
  const policyError = passwordPolicyError(newPassword);
  if (policyError) return jsonRes({ error: policyError }, 400);
  const row = await consumeToken(db, token, "reset");
  if (!row) return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  const hash = await hashPassword(newPassword);
  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResetTokens.id, row.id));
  await db
    .update(schema.accounts)
    .set({
      passwordHash: hash,
      status: "active",
      failedSignins: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.accounts.id, row.accountId));
  await revokeSessions(db, row.accountId, "all");
  await audit(db, { event: "reset_completed", accountId: row.accountId, detail: "password reset completed; all sessions revoked", ip, userAgent: req.headers.get("user-agent") });
  return jsonRes({ ok: true });
}

// ---- POST /auth/claim ------------------------------------------------------------------

export async function handleClaim(req: Request): Promise<Response> {
  const db = getDb();
  const ip = clientIp(req);
  if (!ipAttempt(ip, 10, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  }
  const body = await readJson(req);
  const token = String(body.token ?? "");
  const email = normalizeEmail(String(body.email ?? ""));
  const newPassword = String(body.newPassword ?? body.password ?? "");
  const row = await consumeToken(db, token, "owner_claim");
  if (!row) return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  const accountRows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, row.accountId))
    .limit(1);
  const account = accountRows[0];
  if (!account || !account.isOwner || account.email !== email) {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) return jsonRes({ error: policyError }, 400);
  const hash = await hashPassword(newPassword);
  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResetTokens.id, row.id));
  await db
    .update(schema.accounts)
    .set({
      passwordHash: hash,
      status: "active",
      emailVerifiedAt: new Date(),
      failedSignins: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.accounts.id, account.id));
  // Bind profile 1 (design §3.2 step 2).
  await db
    .update(schema.profile)
    .set({ accountId: account.id })
    .where(eq(schema.profile.id, 1));
  await audit(db, { event: "password_set", accountId: account.id, detail: "owner password set at claim", ip, userAgent: req.headers.get("user-agent") });
  await audit(db, { event: "owner_claimed", accountId: account.id, detail: "profile 1 bound to owner account", ip, userAgent: req.headers.get("user-agent") });
  const { token: sessionToken } = await createSession(db, {
    accountId: account.id,
    createdVia: "claim",
    deviceLabel: String(body.deviceLabel ?? ""),
    userAgent: req.headers.get("user-agent"),
    ip,
    pendingTotp: false,
  });
  return jsonRes(
    { ok: true, account: { email: account.email, isOwner: true } },
    200,
    { "set-cookie": sessionCookieHeader(sessionToken, SESSION_ABSOLUTE_MS / 1000) },
  );
}

// ---- Owner claim ARM (CLI helper — invoked by host/auth-claim.ts only) ---------------

export async function armOwnerClaim(emailRaw: string): Promise<string> {
  const db = getDb();
  const email = normalizeEmail(emailRaw);
  if (!isValidEmail(email)) throw new Error(`invalid email: ${emailRaw}`);
  const owners = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.isOwner, true));
  if (owners.length > 0) {
    throw new Error("an owner account already exists — refusing to arm a second claim");
  }
  const profileRows = await db
    .select()
    .from(schema.profile)
    .where(eq(schema.profile.id, 1))
    .limit(1);
  if (profileRows[0]?.accountId != null) {
    throw new Error("profile 1 is already bound to an account — refusing to arm");
  }
  const existing = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  let account = existing[0];
  if (!account) {
    const inserted = await db
      .insert(schema.accounts)
      .values({ email, status: "invited", isOwner: true, passwordHash: null })
      .returning({ id: schema.accounts.id });
    account = { ...(existing[0] ?? {}), id: inserted[0]!.id, email, status: "invited", isOwner: true } as typeof schema.accounts.$inferSelect;
  } else if (!account.isOwner) {
    await db
      .update(schema.accounts)
      .set({ isOwner: true, status: "invited", updatedAt: new Date() })
      .where(eq(schema.accounts.id, account.id));
  }
  const now = new Date();
  await db
    .update(schema.passwordResetTokens)
    .set({ supersededAt: now })
    .where(
      and(
        eq(schema.passwordResetTokens.accountId, account.id),
        eq(schema.passwordResetTokens.purpose, "owner_claim"),
        isNull(schema.passwordResetTokens.usedAt),
      ),
    );
  const token = mintToken();
  await db.insert(schema.passwordResetTokens).values({
    accountId: account.id,
    purpose: "owner_claim",
    tokenHash: sha256Hex(token),
    expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
  });
  await audit(db, {
    event: "owner_claim_armed",
    accountId: account.id,
    detail: `claim armed for ${maskEmail(email)}`,
  });
  return token; // printed ONCE to the operator terminal by the CLI
}

// ---- POST /auth/accept-invite ------------------------------------------------------------

export async function handleAcceptInvite(req: Request): Promise<Response> {
  const db = getDb();
  const ip = clientIp(req);
  if (!ipAttempt(ip, 10, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  }
  const body = await readJson(req);
  const token = String(body.token ?? "");
  const newPassword = String(body.newPassword ?? body.password ?? "");
  if (!token) return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  const inviteRows = await db
    .select()
    .from(schema.accountInvites)
    .where(eq(schema.accountInvites.tokenHash, sha256Hex(token)))
    .limit(1);
  const invite = inviteRows[0];
  if (
    !invite ||
    invite.status !== "pending" ||
    invite.expiresAt.getTime() <= Date.now()
  ) {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) return jsonRes({ error: policyError }, 400);

  const email = invite.email; // account is created under the invited address (§4.4)
  const existing = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  if (existing[0] && existing[0].status !== "invited") {
    return jsonRes({ error: GENERIC_LINK_ERROR }, 400);
  }
  const hash = await hashPassword(newPassword);
  const now = new Date();
  let accountId: number;
  const trialEndsAt =
    invite.kind === "trial" ? new Date(now.getTime() + TRIAL_PLAN_MS) : null;
  if (existing[0]) {
    accountId = existing[0].id;
    await db
      .update(schema.accounts)
      .set({
        passwordHash: hash,
        status: "active",
        emailVerifiedAt: now,
        inviteKind: invite.kind,
        trialEndsAt,
        updatedAt: now,
      })
      .where(eq(schema.accounts.id, accountId));
  } else {
    const inserted = await db
      .insert(schema.accounts)
      .values({
        email,
        passwordHash: hash,
        status: "active",
        emailVerifiedAt: now,
        inviteKind: invite.kind,
        trialEndsAt,
      })
      .returning({ id: schema.accounts.id });
    accountId = inserted[0]!.id;
  }
  const username = await deriveUsername(db, email, body.username != null ? String(body.username) : undefined);
  const plan = invite.grantPlan ?? (invite.kind === "trial" ? "diamond" : "basic");
  const profileId = await createProfileForAccount(db, { accountId, username, plan });
  await db
    .update(schema.accountInvites)
    .set({ status: "accepted", acceptedAccountId: accountId, acceptedAt: now })
    .where(eq(schema.accountInvites.id, invite.id));
  await audit(db, { event: "invite_accepted", accountId, detail: `${invite.kind} invite accepted; profile ${profileId} created as @${username} on ${plan}`, ip, userAgent: req.headers.get("user-agent") });
  if (invite.kind === "trial") {
    await audit(db, { event: "trial_started", accountId, detail: "30-day Diamond trial started (D5); then Basic", ip, userAgent: req.headers.get("user-agent") });
  }
  const { token: sessionToken } = await createSession(db, {
    accountId,
    createdVia: "invite_accept",
    deviceLabel: String(body.deviceLabel ?? ""),
    userAgent: req.headers.get("user-agent"),
    ip,
    pendingTotp: false,
  });
  return jsonRes(
    { ok: true, account: { email, username, plan } },
    200,
    { "set-cookie": sessionCookieHeader(sessionToken, SESSION_ABSOLUTE_MS / 1000) },
  );
}

// ---- Owner-only invite issuance + tester completion (host routes) -------------------------
// POST /auth/invites        { email, kind, note? }        → owner session only
// GET  /auth/testers                                   → owner session only (D4 list)
// POST /auth/testers/flip   { accountId }                → owner session only (D4 manual flip)
// POST /auth/password       { currentPassword, newPassword } → any full session

export async function handleIssueInvite(req: Request): Promise<Response> {
  const db = getDb();
  const resolved = await resolveSession(db, sessionCookieFromRequest(req));
  if (!resolved || !resolved.viewer.isOwner || resolved.viewer.totpPending) {
    return jsonRes({ error: "Owner sign-in required." }, 403);
  }
  const body = await readJson(req);
  const email = normalizeEmail(String(body.email ?? ""));
  const kind = String(body.kind ?? "tester");
  if (!isValidEmail(email)) return jsonRes({ error: "Enter a valid email address." }, 400);
  if (kind !== "tester" && kind !== "trial") {
    return jsonRes({ error: "Invite kind must be 'tester' or 'trial'." }, 400);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const issuedToday = await db
    .select()
    .from(schema.authAuditLog)
    .where(eq(schema.authAuditLog.event, "invite_issued"));
  const issuedCount = issuedToday.filter(
    (r) => r.actorAccountId === resolved.viewer.accountId && r.createdAt.getTime() >= today.getTime(),
  ).length;
  if (issuedCount >= INVITE_ISSUE_DAILY_CAP) {
    return jsonRes({ error: "Daily invite cap reached." }, 429);
  }
  const acct = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  if (acct[0] && acct[0].status === "active") {
    return jsonRes({ error: "That email already has an active account." }, 409);
  }
  const live = await db
    .select()
    .from(schema.accountInvites)
    .where(eq(schema.accountInvites.email, email));
  const hasLive = live.some(
    (i) => i.kind === kind && i.status === "pending" && i.expiresAt.getTime() > Date.now(),
  );
  if (hasLive) {
    return jsonRes({ error: "A live invite already exists for that email." }, 409);
  }
  const token = mintToken();
  const ttl = kind === "trial" ? TRIAL_INVITE_TTL_MS : TESTER_INVITE_TTL_MS;
  const inserted = await db
    .insert(schema.accountInvites)
    .values({
      kind,
      email,
      tokenHash: sha256Hex(token),
      grantPlan: "diamond",
      invitedByAccountId: resolved.viewer.accountId,
      note: String(body.note ?? "").slice(0, 200),
      status: "pending",
      expiresAt: new Date(Date.now() + ttl),
    })
    .returning({ id: schema.accountInvites.id });
  const link = `${appBaseUrl(req)}/auth/accept?token=${encodeURIComponent(token)}`;
  const mail = await sendAuthMail({
    db,
    accountId: null,
    kind: "invite",
    to: email,
    subject: "You're invited to STONEMILES by Stonervision",
    text: `You've been invited to the STONEMILES closed test. Set your password and create your account here:\n\n${link}\n\nThis link is tied to this email address and expires. Diamond is free during the test.`,
    linkToken: token,
  });
  await audit(db, {
    event: "invite_issued",
    accountId: null,
    actorAccountId: resolved.viewer.accountId,
    detail: `${kind} invite #${inserted[0]!.id} issued for ${maskEmail(email)} (${mail.sent ? "emailed" : "queued for owner delivery"})`,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  return jsonRes({
    ok: true,
    inviteId: inserted[0]!.id,
    emailed: mail.sent,
    queued: mail.queued,
    // When mail is queued the owner delivers the link himself — returned
    // ONCE here to the owner session only (D1 honest-staging posture).
    acceptLink: mail.queued ? link : null,
  });
}

export interface TesterCompletion {
  accountId: number;
  email: string;
  username: string | null;
  acceptedAt: string | null;
  daysActiveOf14: number;
  windowComplete: boolean;
  completed: boolean;
  currentPlan: string | null;
  flippedToGoldYear: boolean;
}

export async function testerCompletionList(db: Db): Promise<TesterCompletion[]> {
  const invites = await db
    .select()
    .from(schema.accountInvites)
    .where(eq(schema.accountInvites.kind, "tester"));
  const out: TesterCompletion[] = [];
  for (const invite of invites) {
    if (!invite.acceptedAccountId || !invite.acceptedAt) continue;
    const accountId = invite.acceptedAccountId;
    const acceptedAt = invite.acceptedAt;
    const days = await db
      .select()
      .from(schema.authActivityDays)
      .where(eq(schema.authActivityDays.accountId, accountId));
    // Days are server-local YYYY-MM-DD; window = the 14 days starting on
    // acceptance day.
    const startDay = acceptedAt.toISOString().slice(0, 10);
    const windowDays = new Set<string>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(acceptedAt.getTime() + i * 24 * 60 * 60 * 1000);
      windowDays.add(d.toISOString().slice(0, 10));
    }
    const activeInWindow = days.filter((d) => windowDays.has(d.day)).length;
    const profile = await db
      .select()
      .from(schema.profile)
      .where(eq(schema.profile.accountId, accountId))
      .limit(1);
    const account = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    const events = await db
      .select()
      .from(schema.authAuditLog)
      .where(eq(schema.authAuditLog.accountId, accountId));
    const flipped = events.some((e) => e.event === "tester_gold_year_flip");
    const windowComplete = Date.now() >= acceptedAt.getTime() + 14 * 24 * 60 * 60 * 1000;
    out.push({
      accountId,
      email: account[0]?.email ?? invite.email,
      username: profile[0]?.socialUsername ?? null,
      acceptedAt: acceptedAt.toISOString(),
      daysActiveOf14: activeInWindow,
      windowComplete,
      completed: windowComplete && activeInWindow >= 10,
      currentPlan: profile[0]?.plan ?? null,
      flippedToGoldYear: flipped,
    });
    void startDay;
  }
  return out;
}

export async function handleTesterList(req: Request): Promise<Response> {
  const db = getDb();
  const resolved = await resolveSession(db, sessionCookieFromRequest(req));
  if (!resolved || !resolved.viewer.isOwner || resolved.viewer.totpPending) {
    return jsonRes({ error: "Owner sign-in required." }, 403);
  }
  return jsonRes({ testers: await testerCompletionList(db) });
}

/** D4 flip: manual, audited owner action — Diamond(test) → Gold for a
 *  year from launch. Represented as plan=gold + an audit event carrying
 *  the flip; NEVER automatic. */
export async function handleTesterFlip(req: Request): Promise<Response> {
  const db = getDb();
  const resolved = await resolveSession(db, sessionCookieFromRequest(req));
  if (!resolved || !resolved.viewer.isOwner || resolved.viewer.totpPending) {
    return jsonRes({ error: "Owner sign-in required." }, 403);
  }
  const body = await readJson(req);
  const accountId = Number(body.accountId);
  if (!Number.isFinite(accountId)) return jsonRes({ error: "accountId required." }, 400);
  const list = await testerCompletionList(db);
  const entry = list.find((t) => t.accountId === accountId);
  if (!entry) return jsonRes({ error: "Not a Founding Tester account." }, 404);
  if (!entry.completed) {
    return jsonRes({ error: "Tester has not completed the 14-day activity rule yet." }, 409);
  }
  if (entry.flippedToGoldYear) {
    return jsonRes({ error: "Already flipped." }, 409);
  }
  await db
    .update(schema.profile)
    .set({ plan: "gold", updatedAt: new Date() })
    .where(eq(schema.profile.accountId, accountId));
  await audit(db, {
    event: "tester_gold_year_flip",
    accountId,
    actorAccountId: resolved.viewer.accountId,
    detail: `D4 manual flip: Diamond(test) → Gold-year for ${maskEmail(entry.email)} (${entry.daysActiveOf14}/14 active days)`,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  return jsonRes({ ok: true, accountId, plan: "gold" });
}

// ---- POST /auth/password (authenticated change) ---------------------------------------------

export async function handlePasswordChange(req: Request): Promise<Response> {
  const db = getDb();
  const resolved = await resolveSession(db, sessionCookieFromRequest(req));
  if (!resolved || resolved.viewer.totpPending) {
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }
  const body = await readJson(req);
  const current = String(body.currentPassword ?? "");
  const next = String(body.newPassword ?? "");
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, resolved.viewer.accountId))
    .limit(1);
  const account = rows[0];
  if (!account?.passwordHash) return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  if (!(await Bun.password.verify(current, account.passwordHash))) {
    return jsonRes({ error: GENERIC_SIGNIN_ERROR }, 401);
  }
  const policyError = passwordPolicyError(next);
  if (policyError) return jsonRes({ error: policyError }, 400);
  await db
    .update(schema.accounts)
    .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
    .where(eq(schema.accounts.id, account.id));
  await revokeSessions(db, account.id, "others", resolved.session.id);
  await audit(db, { event: "password_change", accountId: account.id, detail: "password changed; other sessions revoked", ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  return jsonRes({ ok: true });
}

/** Public-action allowlist for the /actions gate (§5.3 step 6): actions
 *  that must answer without a session. Everything else requires one. */
export const PUBLIC_ACTIONS = new Set<string>([
  // Capability-style public verification lookups that exist today:
  // both take an unguessable verify/seal code as the capability and
  // return only the verdict for that one code (design §5.3 step 6).
  "verifyCode",
  "checkCustody",
]);
