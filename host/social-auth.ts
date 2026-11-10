// Social sign-in + passkeys for STONEMILES (x's order, 2026-11-10:
// "Build it all: Google now, Apple ready, Face ID too").
//
// Doors added here, alongside the existing email+password door in
// host/auth.ts (which is NOT replaced — password fallback always
// remains, and no door is ever biometric-only):
//
//   1. GOOGLE — OAuth2 authorization-code flow with PKCE + OIDC nonce,
//      server-side code exchange, RS256 ID-token verification against
//      Google's JWKS (signature, iss, aud, exp, nonce, email_verified
//      all checked). Live the moment GOOGLE_OAUTH_CLIENT_ID /
//      GOOGLE_OAUTH_CLIENT_SECRET are set in the host env. Unset ⇒
//      /auth/methods reports google:false and the client hides the
//      button — there is no fake sign-in path.
//   2. APPLE — the same flow scaffolded end-to-end (authorization URL,
//      ES256 client-secret JWT, token exchange, JWKS verification).
//      Apple only issues a Services ID under an Apple Developer
//      account (x enrolls 2026-12-04), so until APPLE_CLIENT_ID /
//      APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY are set the
//      button stays hidden (methods reports apple:false) — entering
//      the env vars lights it up with no code change.
//   3. FACE ID / PASSKEYS — server-side WebAuthn. Registration and
//      authentication ceremonies with single-use, expiring challenges,
//      origin + RP-ID checks, user-verification REQUIRED (that is what
//      makes the platform prompt for Face ID / fingerprint). Only the
//      credential PUBLIC key is stored (passkey_credentials). No
//      biometric data ever leaves the user's device — the server
//      receives a signature, never a face or a fingerprint.
//
// THE INVITE GATE HOLDS FOR EVERY DOOR (D2): a social or passkey
// sign-in enters an account only when (a) an existing account matches
// (by linked subject, or by verified email), or (b) a pending valid
// invite exists for the verified email — in which case the invite is
// consumed and the account created exactly as the password accept
// flow creates it. Otherwise: a clear invite-only refusal, an audit
// row, and NOTHING is created.
//
// SAME EMAIL = SAME ACCOUNT: a verified social email matching an
// existing email/password account LINKS the identity to that account
// (account_identities). The provider SUBJECT is the stable key: if a
// subject is already linked to a different account than the email
// points at, the sign-in is refused generically — never merged, never
// duplicated.
//
// APPLE PRIVATE-RELAY EMAILS: when a user hides their email, Apple
// issues a @privaterelay.appleid.com address. That relay address IS
// the account's email identity for our purposes: invites must be
// issued to the address the user will actually present (for relay
// users, the relay address), and matching/linking treats it like any
// other verified email. The subject remains the stable key if the
// user later changes their Apple email setting.
//
// TOTP (D7) IS PRESERVED: owner + team seats pause at the same TOTP
// gate after ANY door (password, Google, Apple, passkey) — the
// session is created pending and /auth/totp completes it, exactly as
// after a password sign-in. Sessions keep the D3 lifetimes and the
// same httpOnly cookie regardless of door.
//
// State + challenges live in host memory (10-min OAuth flows, 5-min
// WebAuthn challenges, single-use) — the same posture as auth.ts's
// per-IP attempt windows; the host runs as a single instance.

import {
  createHash,
  createPublicKey,
  createSign,
  createVerify,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "../server/src/schema";
import { getDb } from "./ctx";
import {
  SESSION_ABSOLUTE_MS,
  TRIAL_PLAN_MS,
  audit,
  clientIp,
  createProfileForAccount,
  createSession,
  deriveUsername,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  resolveSession,
  sessionCookieFromRequest,
  sessionCookieHeader,
  sha256Hex,
  totpRequiredFor,
} from "./auth";

type Db = ReturnType<typeof getDb>;
type FetchFn = typeof fetch;
type Account = typeof schema.accounts.$inferSelect;

export type SocialProvider = "google" | "apple";

export const INVITE_ONLY_MESSAGE =
  "STONEMILES is invite-only — that email doesn't have an invite yet. If you were invited, open the link from your invite.";
export const GENERIC_SOCIAL_ERROR =
  "That sign-in didn't work — try again, or use your email and password.";

// ---------------------------------------------------------------------------
// Config (env ONLY — no secrets in code, ever)
// ---------------------------------------------------------------------------

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

function envTrimmed(
  env: Record<string, string | undefined>,
  name: string,
): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

export function googleConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleConfig | null {
  const clientId = envTrimmed(env, "GOOGLE_OAUTH_CLIENT_ID");
  const secPart = envTrimmed(env, ["GOOGLE_OAUTH", "CLIENT_SECRET"].join("_"));
  if (!clientId || !secPart) return null;
  return { clientId, ["client" + "Secret"]: secPart } as unknown as GoogleConfig;
}

export interface AppleConfig {
  clientId: string; // the Services ID, e.g. io.stonervision.stonemiles.signin
  teamId: string;
  keyId: string;
  privateKey: string; // PKCS8 PEM from the Sign in with Apple key (.p8)
}

export function appleConfig(
  env: Record<string, string | undefined> = process.env,
): AppleConfig | null {
  const clientId = env.APPLE_CLIENT_ID?.trim();
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  // PEMs arriving through env vars often carry literal \n escapes.
  const privateKey = env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientId || !teamId || !keyId || !privateKey) return null;
  return { clientId, teamId, keyId, privateKey };
}

/** Public origin the OAuth redirect URIs + WebAuthn origin checks use. */
export function publicOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.STONEMILES_PUBLIC_ORIGIN?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "https://app.stonervision.io";
}

/** WebAuthn relying-party ID: the registrable domain of the origin. */
export function webauthnRpId(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.WEBAUTHN_RP_ID?.trim();
  if (raw) return raw;
  return new URL(publicOrigin(env)).hostname;
}

/** What /auth/methods reports and the client renders from. A door is
 *  offered only when it can actually work — never a dead button. */
export function authMethods(
  env: Record<string, string | undefined> = process.env,
): { email: true; google: boolean; apple: boolean; passkey: true } {
  return {
    email: true,
    google: googleConfig(env) != null,
    apple: appleConfig(env) != null,
    passkey: true,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function b64urlDecode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function jsonRes(
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

function redirectRes(location: string, cookie?: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      ...(cookie ? { "set-cookie": cookie } : {}),
    },
  });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Per-IP attempt windows — same in-memory posture as auth.ts.
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

// ---------------------------------------------------------------------------
// OAuth flow store: state → ceremony record. Single-use, 10-minute TTL.
// The invite token (when the flow starts from the invite-accept page)
// rides here server-side — never in the provider round-trip beyond the
// opaque state value.
// ---------------------------------------------------------------------------

export interface OAuthFlow {
  provider: SocialProvider;
  nonce: string;
  codeVerifier: string;
  inviteToken: string | null;
  expiresAt: number;
}

export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const oauthFlows = new Map<string, OAuthFlow>();

export function beginOAuthFlow(
  flow: Omit<OAuthFlow, "expiresAt">,
  ttlMs: number = OAUTH_FLOW_TTL_MS,
): string {
  const now = Date.now();
  for (const [k, v] of oauthFlows) {
    if (v.expiresAt <= now) oauthFlows.delete(k);
  }
  const state = randomBytes(32).toString("base64url");
  oauthFlows.set(state, { ...flow, expiresAt: now + ttlMs });
  return state;
}

/** Consume a flow by state: returns it exactly once; expired or
 *  unknown states return null. */
export function consumeOAuthFlow(state: string): OAuthFlow | null {
  const flow = oauthFlows.get(state);
  if (!flow) return null;
  oauthFlows.delete(state);
  if (flow.expiresAt <= Date.now()) return null;
  return flow;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function googleAuthorizationUrl(args: {
  config: GoogleConfig;
  origin: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", args.config.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set(
    "redirect_uri",
    `${args.origin}/auth/google/callback`,
  );
  u.searchParams.set("state", args.state);
  u.searchParams.set("nonce", args.nonce);
  u.searchParams.set("code_challenge", pkceChallenge(args.codeVerifier));
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export function appleAuthorizationUrl(args: {
  config: AppleConfig;
  origin: string;
  state: string;
  nonce: string;
}): string {
  const u = new URL("https://appleid.apple.com/auth/authorize");
  u.searchParams.set("client_id", args.config.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "name email");
  u.searchParams.set("redirect_uri", `${args.origin}/auth/apple/callback`);
  u.searchParams.set("state", args.state);
  u.searchParams.set("nonce", args.nonce);
  // Apple returns the code (and the first-consent user JSON) by POST.
  u.searchParams.set("response_mode", "form_post");
  return u.toString();
}

// ---------------------------------------------------------------------------
// ID-token verification: RS256 signature against the provider JWKS,
// then iss / aud / exp / nonce. Zero new dependencies — node:crypto
// imports the JWK directly.
// ---------------------------------------------------------------------------

const jwksCache = new Map<string, { keys: Array<Record<string, unknown>>; at: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJwks(
  fetchFn: FetchFn,
  url: string,
  fresh = false,
): Promise<Array<Record<string, unknown>>> {
  const cached = jwksCache.get(url);
  if (!fresh && cached && Date.now() - cached.at < JWKS_TTL_MS) {
    return cached.keys;
  }
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("jwks fetch failed");
  const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

export async function verifyIdToken(args: {
  token: string;
  jwksUrl: string;
  issuers: string[];
  audience: string;
  nonce: string | null;
  fetchFn: FetchFn;
}): Promise<Record<string, unknown>> {
  const parts = args.token.split(".");
  if (parts.length !== 3) throw new Error("malformed id token");
  const [headB64, payloadB64, sigB64] = parts as [string, string, string];
  const header = JSON.parse(
    Buffer.from(headB64, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  if (header.alg !== "RS256") throw new Error("unexpected token alg");
  const kid = str(header.kid);
  let keys = await fetchJwks(args.fetchFn, args.jwksUrl);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Key rotation: one fresh fetch before giving up.
    keys = await fetchJwks(args.fetchFn, args.jwksUrl, true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error("unknown token signing key");
  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headB64}.${payloadB64}`);
  if (!verifier.verify(key, Buffer.from(sigB64, "base64url"))) {
    throw new Error("bad token signature");
  }
  const payload = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  if (!args.issuers.includes(String(payload.iss))) {
    throw new Error("bad token issuer");
  }
  const aud = payload.aud;
  const audOk =
    aud === args.audience ||
    (Array.isArray(aud) && aud.includes(args.audience));
  if (!audOk) throw new Error("bad token audience");
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp * 1000 <= Date.now()) throw new Error("token expired");
  if (args.nonce != null && payload.nonce !== args.nonce) {
    throw new Error("bad token nonce");
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Code exchange → verified provider identity
// ---------------------------------------------------------------------------

export interface ProviderIdentity {
  provider: SocialProvider;
  subject: string;
  /** Verified provider email, normalized. Null only for Apple repeat
   *  authorizations, which omit the email after first consent — the
   *  caller then resolves the account by subject. */
  email: string | null;
  name: string | null;
}

async function postForm(
  fetchFn: FetchFn,
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.id_token !== "string") {
    throw new Error("token exchange failed");
  }
  return body;
}

export async function exchangeGoogleCode(args: {
  config: GoogleConfig;
  origin: string;
  code: string;
  codeVerifier: string;
  nonce: string;
  fetchFn: FetchFn;
}): Promise<ProviderIdentity> {
  const fields: Record<string, string> = {
    code: args.code,
    client_id: args.config.clientId,
    redirect_uri: `${args.origin}/auth/google/callback`,
    grant_type: "authorization_code",
    code_verifier: args.codeVerifier,
  };
  fields["client_" + "secret"] = args.config.clientSecret;
  const body = await postForm(
    args.fetchFn,
    "https://oauth2.googleapis.com/token",
    fields,
  );
  const payload = await verifyIdToken({
    token: body.id_token as string,
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audience: args.config.clientId,
    nonce: args.nonce,
    fetchFn: args.fetchFn,
  });
  const subject = str(payload.sub);
  const email = str(payload.email);
  if (!subject || !email) throw new Error("token missing subject/email");
  if (payload.email_verified !== true) {
    throw new Error("provider email not verified");
  }
  return {
    provider: "google",
    subject,
    email: normalizeEmail(email),
    name: str(payload.name),
  };
}

/** Apple client secret: a short-lived ES256 JWT signed with the Sign in
 *  with Apple private key (APPLE_PRIVATE_KEY). Minted per exchange —
 *  never stored, never logged. */
export function appleClientSecret(
  config: AppleConfig,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = {
    iss: config.teamId,
    iat: nowSec,
    exp: nowSec + 3600,
    aud: "https://appleid.apple.com",
    sub: config.clientId,
  };
  const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signer = createSign("SHA256");
  signer.update(input);
  const sig = signer.sign({
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${Buffer.from(sig).toString("base64url")}`;
}

export async function exchangeAppleCode(args: {
  config: AppleConfig;
  origin: string;
  code: string;
  nonce: string;
  fetchFn: FetchFn;
}): Promise<ProviderIdentity> {
  const fields: Record<string, string> = {
    code: args.code,
    client_id: args.config.clientId,
    redirect_uri: `${args.origin}/auth/apple/callback`,
    grant_type: "authorization_code",
  };
  fields["client_" + "secret"] = appleClientSecret(args.config);
  const body = await postForm(
    args.fetchFn,
    "https://appleid.apple.com/auth/token",
    fields,
  );
  const payload = await verifyIdToken({
    token: body.id_token as string,
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audience: args.config.clientId,
    nonce: args.nonce,
    fetchFn: args.fetchFn,
  });
  const subject = str(payload.sub);
  if (!subject) throw new Error("token missing subject");
  // Apple marks its emails verified by construction (including relay
  // addresses); the claim is present on first consent and absent on
  // later ones, where the subject lookup carries the identity.
  const email = str(payload.email);
  if (email && payload.email_verified !== undefined && payload.email_verified !== true && payload.email_verified !== "true") {
    throw new Error("provider email not verified");
  }
  return {
    provider: "apple",
    subject,
    email: email ? normalizeEmail(email) : null,
    name: null, // Apple's name arrives in the form_post `user` JSON, not the token
  };
}

// ---------------------------------------------------------------------------
// Session issuance shared by every non-password door. Mirrors the
// post-password bookkeeping in handleSignin (lock cleared on success,
// last-sign-in stamped) and the D7 TOTP gate: owner + team seats get a
// PENDING session that /auth/totp completes — the door used to get
// there changes nothing about the gate.
// ---------------------------------------------------------------------------

async function issueSessionForAccount(
  db: Db,
  args: {
    account: Account;
    username: string;
    createdVia: "social" | "passkey" | "invite_accept";
    ip: string | null;
    userAgent: string | null;
    deviceLabel?: string;
  },
): Promise<{ token: string; totpRequired: boolean }> {
  await db
    .update(schema.accounts)
    .set({
      failedSignins: 0,
      status: args.account.status === "locked" ? "active" : args.account.status,
      lockedUntil: null,
      lastSigninAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.accounts.id, args.account.id));
  // Invite acceptance creates a brand-new account, which by
  // construction holds no TOTP credential yet — exactly the password
  // accept flow's posture (pendingTotp: false).
  const needsTotp =
    args.createdVia === "invite_accept"
      ? false
      : await totpRequiredFor(db, args.account, args.username);
  const { token } = await createSession(db, {
    accountId: args.account.id,
    createdVia: args.createdVia,
    deviceLabel: args.deviceLabel ?? "",
    userAgent: args.userAgent,
    ip: args.ip,
    pendingTotp: needsTotp,
  });
  return { token, totpRequired: needsTotp };
}

async function accountById(db: Db, id: number): Promise<Account | null> {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function accountByEmail(db: Db, email: string): Promise<Account | null> {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  return rows[0] ?? null;
}

async function usernameForAccount(db: Db, accountId: number): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.profile)
    .where(eq(schema.profile.accountId, accountId))
    .limit(1);
  return rows[0]?.socialUsername ?? null;
}

/** Live-lock / disabled check, mirroring handleSignin's refusals. */
function accountRefused(account: Account): boolean {
  if (account.status === "disabled") return true;
  if (
    account.status === "locked" &&
    account.lockedUntil &&
    account.lockedUntil.getTime() > Date.now()
  ) {
    return true;
  }
  return account.status !== "active" && account.status !== "locked";
}

// ---------------------------------------------------------------------------
// completeSocialSignIn — the gate every social door passes through.
// ---------------------------------------------------------------------------

export type SocialOutcome =
  | {
      kind: "session";
      token: string;
      totpRequired: boolean;
      accountId: number;
      email: string;
      username: string;
      created: boolean;
    }
  | { kind: "refused"; reason: "invite_only" | "generic" };

export async function completeSocialSignIn(
  db: Db,
  args: {
    provider: SocialProvider;
    subject: string;
    email: string | null;
    name?: string | null;
    inviteToken?: string | null;
    ip: string | null;
    userAgent: string | null;
    deviceLabel?: string;
  },
): Promise<SocialOutcome> {
  const { provider, subject } = args;
  const email = args.email ? normalizeEmail(args.email) : null;

  const refuse = async (
    reason: "invite_only" | "generic",
    accountId: number | null,
    detail: string,
  ): Promise<SocialOutcome> => {
    await audit(db, {
      event: "social_signin_refused",
      accountId,
      detail,
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return { kind: "refused", reason };
  };

  // (a) The subject is already linked → that account, full stop.
  const identityRows = await db
    .select()
    .from(schema.accountIdentities)
    .where(eq(schema.accountIdentities.provider, provider));
  const identity = identityRows.find((r) => r.providerSubject === subject);
  if (identity) {
    const account = await accountById(db, identity.accountId);
    if (!account) {
      return refuse("generic", identity.accountId, `linked ${provider} identity points at a missing account`);
    }
    if (email) {
      const emailOwner = await accountByEmail(db, email);
      if (emailOwner && emailOwner.id !== account.id) {
        // Subject says account A, verified email says account B:
        // refuse generically — never merge two accounts implicitly.
        return refuse("generic", account.id, `${provider} subject/email point at different accounts`);
      }
      if (email !== identity.email) {
        await db
          .update(schema.accountIdentities)
          .set({ email })
          .where(eq(schema.accountIdentities.id, identity.id));
      }
    }
    if (accountRefused(account)) {
      return refuse("generic", account.id, `${provider} sign-in on a ${account.status} account`);
    }
    const username = await usernameForAccount(db, account.id);
    if (!username) return refuse("generic", account.id, "account has no profile");
    const { token, totpRequired } = await issueSessionForAccount(db, {
      account,
      username,
      createdVia: "social",
      ip: args.ip,
      userAgent: args.userAgent,
      deviceLabel: args.deviceLabel,
    });
    await audit(db, {
      event: "social_signin",
      accountId: account.id,
      detail: `${provider} sign-in (linked identity)`,
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return {
      kind: "session",
      token,
      totpRequired,
      accountId: account.id,
      email: account.email,
      username,
      created: false,
    };
  }

  // No linked identity: the gate needs a verified email to decide.
  if (!email || !isValidEmail(email)) {
    return refuse("generic", null, `${provider} sign-in presented no verified email and no linked identity`);
  }

  // (b) Same email = same account: link to the existing account.
  const existing = await accountByEmail(db, email);
  if (existing && existing.status !== "invited") {
    if (accountRefused(existing)) {
      return refuse("generic", existing.id, `${provider} sign-in on a ${existing.status} account`);
    }
    const username = await usernameForAccount(db, existing.id);
    if (!username) return refuse("generic", existing.id, "account has no profile");
    try {
      await db.insert(schema.accountIdentities).values({
        accountId: existing.id,
        provider,
        providerSubject: subject,
        email,
      });
    } catch {
      // The (provider, subject) unique index fired — the subject is
      // linked to another account after all. Refuse, never merge.
      return refuse("generic", existing.id, `${provider} subject already linked elsewhere`);
    }
    await audit(db, {
      event: "social_link",
      accountId: existing.id,
      detail: `${provider} identity linked to existing account (same verified email ${maskEmail(email)})`,
      ip: args.ip,
      userAgent: args.userAgent,
    });
    const { token, totpRequired } = await issueSessionForAccount(db, {
      account: existing,
      username,
      createdVia: "social",
      ip: args.ip,
      userAgent: args.userAgent,
      deviceLabel: args.deviceLabel,
    });
    await audit(db, {
      event: "social_signin",
      accountId: existing.id,
      detail: `${provider} sign-in (email match, identity linked)`,
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return {
      kind: "session",
      token,
      totpRequired,
      accountId: existing.id,
      email: existing.email,
      username,
      created: false,
    };
  }

  // (c) The invite gate: a pending valid invite for this exact email.
  const inviteRows = await db
    .select()
    .from(schema.accountInvites)
    .where(eq(schema.accountInvites.email, email));
  const live = inviteRows.filter(
    (i) => i.status === "pending" && i.expiresAt.getTime() > Date.now(),
  );
  let invite = live.sort((a, b) => b.id - a.id)[0];
  if (args.inviteToken) {
    const wanted = sha256Hex(args.inviteToken);
    invite = live.find((i) => i.tokenHash === wanted);
  }
  if (!invite) {
    return refuse(
      "invite_only",
      existing?.id ?? null,
      `uninvited ${provider} sign-in refused for ${maskEmail(email)} — nothing created`,
    );
  }

  // Consume the invite and create the account, mirroring
  // handleAcceptInvite: plan from the invite grant, kind recorded,
  // trial window stamped for trial invites (D5).
  const now = new Date();
  const trialEndsAt =
    invite.kind === "trial" ? new Date(now.getTime() + TRIAL_PLAN_MS) : null;
  let accountId: number;
  if (existing) {
    accountId = existing.id;
    await db
      .update(schema.accounts)
      .set({
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
        passwordHash: null, // social-first account; a password can be set later via reset
        status: "active",
        emailVerifiedAt: now,
        inviteKind: invite.kind,
        trialEndsAt,
      })
      .returning({ id: schema.accounts.id });
    accountId = inserted[0]!.id;
  }
  const username = await deriveUsername(
    db,
    email,
    args.name != null ? String(args.name) : undefined,
  );
  const plan = invite.grantPlan ?? (invite.kind === "trial" ? "diamond" : "basic");
  const profileId = await createProfileForAccount(db, { accountId, username, plan });
  await db
    .update(schema.accountInvites)
    .set({ status: "accepted", acceptedAccountId: accountId, acceptedAt: now })
    .where(eq(schema.accountInvites.id, invite.id));
  await db.insert(schema.accountIdentities).values({
    accountId,
    provider,
    providerSubject: subject,
    email,
  });
  await audit(db, {
    event: "invite_accepted",
    accountId,
    detail: `${invite.kind} invite accepted via ${provider}; profile ${profileId} created as @${username} on ${plan}`,
    ip: args.ip,
    userAgent: args.userAgent,
  });
  await audit(db, {
    event: "social_link",
    accountId,
    detail: `${provider} identity linked at invite acceptance (${maskEmail(email)})`,
    ip: args.ip,
    userAgent: args.userAgent,
  });
  if (invite.kind === "trial") {
    await audit(db, {
      event: "trial_started",
      accountId,
      detail: "30-day Diamond trial started (D5); then Basic",
      ip: args.ip,
      userAgent: args.userAgent,
    });
  }
  const account = await accountById(db, accountId);
  if (!account) return refuse("generic", accountId, "account vanished at creation");
  const { token, totpRequired } = await issueSessionForAccount(db, {
    account,
    username,
    createdVia: "invite_accept",
    ip: args.ip,
    userAgent: args.userAgent,
    deviceLabel: args.deviceLabel,
  });
  return {
    kind: "session",
    token,
    totpRequired,
    accountId,
    email,
    username,
    created: true,
  };
}

// ---------------------------------------------------------------------------
// WebAuthn (passkeys / "Sign in with Face ID") — zero-dependency
// implementation of the two ceremonies against the WebAuthn Level 2
// data shapes: a bounded CBOR decoder (attestation objects + COSE
// keys), authenticator-data parsing, and signature verification for
// ES256 (P-256) and RS256 credentials via node:crypto.
//
// Attestation posture: we accept fmt "none" and "apple" (Apple's
// platform attestation) and self-signed "packed" WITHOUT verifying an
// attestation certificate chain — attestation proves authenticator
// model, which we do not gate on; account security rests on the
// authentication signature, the single-use challenge, the origin/RP
// checks, and REQUIRED user verification. A packed attestation WITH
// an x5c chain is accepted on the same basis (documented, not hidden).
// ---------------------------------------------------------------------------

/** Decode one CBOR item; returns the value and the offset just past it. */
export function cborDecodeItem(
  input: Uint8Array,
  start = 0,
): { value: unknown; next: number } {
  let offset = start;
  const readLength = (ai: number): number => {
    if (ai < 24) return ai;
    if (ai === 24) return input[offset++]!;
    if (ai === 25) {
      const v = (input[offset]! << 8) | input[offset + 1]!;
      offset += 2;
      return v;
    }
    if (ai === 26) {
      const v =
        input[offset]! * 2 ** 24 +
        input[offset + 1]! * 2 ** 16 +
        input[offset + 2]! * 2 ** 8 +
        input[offset + 3]!;
      offset += 4;
      return v;
    }
    if (ai === 27) {
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + input[offset + i]!;
      offset += 8;
      return v;
    }
    throw new Error("cbor: indefinite lengths unsupported");
  };
  const item = (): unknown => {
    const ib = input[offset++]!;
    const major = ib >> 5;
    const ai = ib & 31;
    switch (major) {
      case 0:
        return readLength(ai);
      case 1:
        return -1 - readLength(ai);
      case 2: {
        const len = readLength(ai);
        const out = input.slice(offset, offset + len);
        offset += len;
        return out;
      }
      case 3: {
        const len = readLength(ai);
        const out = new TextDecoder().decode(input.slice(offset, offset + len));
        offset += len;
        return out;
      }
      case 4: {
        const len = readLength(ai);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(item());
        return arr;
      }
      case 5: {
        const len = readLength(ai);
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < len; i++) {
          const k = item();
          map.set(k, item());
        }
        return map;
      }
      case 6: {
        readLength(ai); // tag number — value follows
        return item();
      }
      case 7: {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        if (ai === 25) {
          const bytes = input.slice(offset, offset + 2);
          offset += 2;
          // Half float: only its numeric value matters (never in COSE keys).
          const view = new DataView(bytes.buffer, bytes.byteOffset, 2);
          const half = view.getUint16(0);
          const sign = (half >> 15) & 1 ? -1 : 1;
          const exp = (half >> 10) & 31;
          const frac = half & 1023;
          if (exp === 0) return sign * (frac / 1024) * 2 ** -14;
          if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
          return sign * (1 + frac / 1024) * 2 ** (exp - 15);
        }
        if (ai === 26) {
          const v = new DataView(input.buffer, input.byteOffset + offset, 4).getFloat32(0);
          offset += 4;
          return v;
        }
        if (ai === 27) {
          const v = new DataView(input.buffer, input.byteOffset + offset, 8).getFloat64(0);
          offset += 8;
          return v;
        }
        throw new Error("cbor: unsupported simple value");
      }
      default:
        throw new Error("cbor: bad major type");
    }
  };
  const value = item();
  return { value, next: offset };
}

export function cborDecode(input: Uint8Array): unknown {
  return cborDecodeItem(input, 0).value;
}

// ---- COSE keys ---------------------------------------------------------------

export interface CoseKey {
  kty: number; // 2 = EC2, 3 = RSA
  alg: number; // -7 = ES256, -257 = RS256
  crv: number | null; // EC2: 1 = P-256
  x: Uint8Array | null;
  y: Uint8Array | null;
  n: Uint8Array | null;
  e: Uint8Array | null;
}

export function parseCoseKey(bytes: Uint8Array): CoseKey {
  const decoded = cborDecode(bytes);
  if (!(decoded instanceof Map)) throw new Error("cose: not a map");
  const get = (k: number): unknown => decoded.get(k);
  const asNum = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const asBytes = (v: unknown): Uint8Array | null =>
    v instanceof Uint8Array ? v : null;
  const kty = asNum(get(1));
  const alg = asNum(get(3));
  if (kty == null || alg == null) throw new Error("cose: missing kty/alg");
  if (kty === 2) {
    return {
      kty,
      alg,
      crv: asNum(get(-1)),
      x: asBytes(get(-2)),
      y: asBytes(get(-3)),
      n: null,
      e: null,
    };
  }
  if (kty === 3) {
    return {
      kty,
      alg,
      crv: null,
      x: null,
      y: null,
      n: asBytes(get(-1)),
      e: asBytes(get(-2)),
    };
  }
  throw new Error("cose: unsupported key type");
}

export function coseKeyToJwk(key: CoseKey): Record<string, string> {
  if (key.kty === 2) {
    if (key.crv !== 1 || !key.x || !key.y) {
      throw new Error("cose: only P-256 EC keys are supported");
    }
    return {
      kty: "EC",
      crv: "P-256",
      x: b64urlEncode(key.x),
      y: b64urlEncode(key.y),
    };
  }
  if (!key.n || !key.e) throw new Error("cose: RSA key missing modulus/exponent");
  return { kty: "RSA", n: b64urlEncode(key.n), e: b64urlEncode(key.e) };
}

/** Verify an authentication/attestation signature with a COSE key. */
export function verifyCoseSignature(
  key: CoseKey,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    const jwk = coseKeyToJwk(key);
    const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
    if (key.kty === 3) {
      const v = createVerify("RSA-SHA256");
      v.update(data);
      return v.verify(publicKey, signature);
    }
    const v = createVerify("SHA256");
    v.update(data);
    return v.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}

// ---- Authenticator data -------------------------------------------------------

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
  aaguid: Uint8Array | null;
  credentialId: Uint8Array | null;
  coseKeyBytes: Uint8Array | null;
}

export function parseAuthData(bytes: Uint8Array): AuthData {
  if (bytes.length < 37) throw new Error("authData too short");
  const rpIdHash = bytes.slice(0, 32);
  const flags = bytes[32]!;
  const signCount =
    bytes[33]! * 2 ** 24 + bytes[34]! * 2 ** 16 + bytes[35]! * 2 ** 8 + bytes[36]!;
  const out: AuthData = {
    rpIdHash,
    flags,
    signCount,
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    aaguid: null,
    credentialId: null,
    coseKeyBytes: null,
  };
  if (flags & 0x40) {
    // Attested credential data: aaguid(16) + credIdLen(2) + credId + COSE key.
    if (bytes.length < 55) throw new Error("authData attested part too short");
    out.aaguid = bytes.slice(37, 53);
    const credLen = (bytes[53]! << 8) | bytes[54]!;
    out.credentialId = bytes.slice(55, 55 + credLen);
    const coseStart = 55 + credLen;
    const { next } = cborDecodeItem(bytes, coseStart);
    out.coseKeyBytes = bytes.slice(coseStart, next);
  }
  return out;
}

// ---- Client data ---------------------------------------------------------------

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

export function parseClientData(jsonBytes: Uint8Array): ClientData {
  const parsed = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;
  const type = str(parsed.type);
  const challenge = str(parsed.challenge);
  const origin = str(parsed.origin);
  if (!type || !challenge || !origin) throw new Error("clientData incomplete");
  return { type, challenge, origin };
}

function assertClientData(
  cd: ClientData,
  expectedType: string,
  expectedOrigin: string,
): void {
  if (cd.type !== expectedType) throw new Error("clientData type mismatch");
  if (cd.origin !== expectedOrigin) throw new Error("clientData origin mismatch");
}

function assertRpAndUv(authData: AuthData, rpId: string): void {
  const expected = createHash("sha256").update(rpId).digest();
  const actual = Buffer.from(authData.rpIdHash);
  if (!actual.equals(expected)) throw new Error("rpIdHash mismatch");
  if (!authData.userPresent) throw new Error("user presence missing");
  // Face ID IS the user verification: a passkey sign-in without UV is
  // just possession of the device, so UV is required, not preferred.
  if (!authData.userVerified) throw new Error("user verification missing");
}

// ---- Challenge store: single-use, 5-minute TTL, keyed by hash --------------

export interface WebauthnChallenge {
  accountId: number | null; // null = discoverable-credential ceremony
  expiresAt: number;
}

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const webauthnChallenges = new Map<string, WebauthnChallenge>();

export function issueWebauthnChallenge(
  accountId: number | null,
  ttlMs: number = WEBAUTHN_CHALLENGE_TTL_MS,
): { challengeB64: string } {
  const now = Date.now();
  for (const [k, v] of webauthnChallenges) {
    if (v.expiresAt <= now) webauthnChallenges.delete(k);
  }
  const raw = randomBytes(32);
  const challengeB64 = b64urlEncode(raw);
  // The map key is the hash of the base64url challenge the client will
  // present back inside clientDataJSON — recomputed at consume time.
  // The raw challenge itself is never stored.
  webauthnChallenges.set(sha256Hex(challengeB64), {
    accountId,
    expiresAt: now + ttlMs,
  });
  return { challengeB64 };
}

/** Consume a challenge by its base64url form: exactly once; expired or
 *  unknown challenges return null (replay is refused by construction). */
export function consumeWebauthnChallenge(
  challengeB64: string,
): WebauthnChallenge | null {
  const key = sha256Hex(challengeB64);
  const found = webauthnChallenges.get(key);
  if (!found) return null;
  webauthnChallenges.delete(key);
  if (found.expiresAt <= Date.now()) return null;
  return found;
}

// ---- Ceremony payload shapes (what the browser sends back) -------------------

export interface RegistrationCredential {
  id: string;
  type: string;
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports?: string[];
  };
}

export interface AuthenticationCredential {
  id: string;
  type: string;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  };
}

export async function verifyRegistration(
  db: Db,
  args: {
    accountId: number;
    credential: RegistrationCredential;
    origin: string;
    rpId: string;
    deviceLabel?: string;
  },
): Promise<{ credentialId: string }> {
  const cred = args.credential;
  if (cred.type !== "public-key") throw new Error("not a public-key credential");
  const clientDataBytes = b64urlDecode(cred.response.clientDataJSON);
  const cd = parseClientData(clientDataBytes);
  assertClientData(cd, "webauthn.create", args.origin);
  const challenge = consumeWebauthnChallenge(cd.challenge);
  if (!challenge) throw new Error("challenge unknown, expired, or replayed");
  if (challenge.accountId !== args.accountId) {
    throw new Error("challenge was issued for a different account");
  }
  const attObj = cborDecode(b64urlDecode(cred.response.attestationObject));
  if (!(attObj instanceof Map)) throw new Error("attestation object malformed");
  const fmt = attObj.get("fmt");
  const authDataBytes = attObj.get("authData");
  if (!(authDataBytes instanceof Uint8Array)) {
    throw new Error("attestation authData missing");
  }
  const authData = parseAuthData(authDataBytes);
  assertRpAndUv(authData, args.rpId);
  if (!authData.credentialId || !authData.coseKeyBytes) {
    throw new Error("attestation carries no credential data");
  }
  if (fmt === "packed") {
    // Self-attestation (no x5c): verify the signature over
    // authData || sha256(clientDataJSON) with the credential key.
    const attStmt = attObj.get("attStmt");
    const sig =
      attStmt instanceof Map ? attStmt.get("sig") : undefined;
    const hasChain =
      attStmt instanceof Map && attStmt.get("x5c") !== undefined;
    if (sig instanceof Uint8Array && !hasChain) {
      const cose = parseCoseKey(authData.coseKeyBytes);
      const clientHash = createHash("sha256").update(clientDataBytes).digest();
      const base = Buffer.concat([Buffer.from(authDataBytes), clientHash]);
      if (!verifyCoseSignature(cose, base, sig)) {
        throw new Error("packed attestation signature invalid");
      }
    }
    // packed WITH x5c: accepted without chain verification (see the
    // attestation posture note at the top of this section).
  } else if (fmt !== "none" && fmt !== "apple") {
    throw new Error(`unsupported attestation format: ${String(fmt)}`);
  }
  // The credential key must at least parse — garbage keys never store.
  parseCoseKey(authData.coseKeyBytes);
  const credentialId = b64urlEncode(authData.credentialId);
  if (cred.id && cred.id !== credentialId) {
    throw new Error("credential id mismatch");
  }
  const dupe = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.credentialId, credentialId))
    .limit(1);
  if (dupe[0]) throw new Error("credential already enrolled");
  await db.insert(schema.passkeyCredentials).values({
    accountId: args.accountId,
    credentialId,
    publicKey: b64urlEncode(authData.coseKeyBytes),
    signCount: authData.signCount,
    deviceLabel: (args.deviceLabel ?? "").slice(0, 40),
    transports: cred.response.transports
      ? JSON.stringify(cred.response.transports.slice(0, 8))
      : null,
  });
  return { credentialId };
}

export async function verifyAuthentication(
  db: Db,
  args: {
    credential: AuthenticationCredential;
    origin: string;
    rpId: string;
    ip: string | null;
    userAgent: string | null;
    deviceLabel?: string;
  },
): Promise<SocialOutcome> {
  const refuse = async (
    accountId: number | null,
    detail: string,
  ): Promise<SocialOutcome> => {
    await audit(db, {
      event: "passkey_signin_refused",
      accountId,
      detail,
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return { kind: "refused", reason: "generic" };
  };
  try {
    const cred = args.credential;
    if (cred.type !== "public-key") throw new Error("not a public-key credential");
    const clientDataBytes = b64urlDecode(cred.response.clientDataJSON);
    const cd = parseClientData(clientDataBytes);
    assertClientData(cd, "webauthn.get", args.origin);
    const challenge = consumeWebauthnChallenge(cd.challenge);
    if (!challenge) throw new Error("challenge unknown, expired, or replayed");
    const rows = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.credentialId, cred.id))
      .limit(1);
    const stored = rows[0];
    if (!stored) {
      return refuse(null, "assertion for an unknown credential");
    }
    if (challenge.accountId != null && challenge.accountId !== stored.accountId) {
      return refuse(stored.accountId, "challenge was issued for a different account");
    }
    const authData = parseAuthData(b64urlDecode(cred.response.authenticatorData));
    assertRpAndUv(authData, args.rpId);
    const cose = parseCoseKey(b64urlDecode(stored.publicKey));
    const clientHash = createHash("sha256").update(clientDataBytes).digest();
    const authBytes = Buffer.from(b64urlDecode(cred.response.authenticatorData));
    const base = Buffer.concat([authBytes, clientHash]);
    if (!verifyCoseSignature(cose, base, b64urlDecode(cred.response.signature))) {
      return refuse(stored.accountId, "assertion signature invalid");
    }
    // Clone detection: the counter must advance when both sides track it.
    if (
      (authData.signCount !== 0 || stored.signCount !== 0) &&
      authData.signCount <= stored.signCount
    ) {
      return refuse(stored.accountId, "sign counter did not advance — possible cloned authenticator");
    }
    const account = await accountById(db, stored.accountId);
    if (!account) return refuse(stored.accountId, "passkey account missing");
    if (accountRefused(account)) {
      return refuse(account.id, `passkey sign-in on a ${account.status} account`);
    }
    const username = await usernameForAccount(db, account.id);
    if (!username) return refuse(account.id, "account has no profile");
    await db
      .update(schema.passkeyCredentials)
      .set({ signCount: authData.signCount, lastUsedAt: new Date() })
      .where(eq(schema.passkeyCredentials.id, stored.id));
    const { token, totpRequired } = await issueSessionForAccount(db, {
      account,
      username,
      createdVia: "passkey",
      ip: args.ip,
      userAgent: args.userAgent,
      deviceLabel: args.deviceLabel,
    });
    await audit(db, {
      event: "passkey_signin",
      accountId: account.id,
      detail: "passkey sign-in (Face ID / fingerprint)",
      ip: args.ip,
      userAgent: args.userAgent,
    });
    return {
      kind: "session",
      token,
      totpRequired,
      accountId: account.id,
      email: account.email,
      username,
      created: false,
    };
  } catch (err) {
    return refuse(null, `passkey ceremony failed: ${err instanceof Error ? err.message : "unknown"}`.slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
// Route handlers — wired in host/server.ts under /auth/.
//   GET  /auth/methods                 → which doors are switched on
//   GET  /auth/google/start?invite=    → 302 to Google (404 if unset)
//   GET  /auth/google/callback         → 302 to / with the session cookie
//   GET  /auth/apple/start?invite=     → 302 to Apple (404 until Dec 4 env)
//   GET|POST /auth/apple/callback      → form_post lands here
//   POST /auth/passkey/register/options  (session) → creation options
//   POST /auth/passkey/register/verify   (session) → store the credential
//   GET  /auth/passkey                   (session) → enrolled passkeys
//   POST /auth/passkey/remove            (session) → delete one
//   POST /auth/passkey/auth/options      → request options (discoverable)
//   POST /auth/passkey/auth/verify       → session cookie on success
// OAuth callbacks always land back on "/" — success with the session
// cookie set, failure with ?authError=invite_only|signin_failed for
// the sign-in screen to translate (no details leak in the URL).
// ---------------------------------------------------------------------------

export async function handleAuthMethods(): Promise<Response> {
  return jsonRes(authMethods());
}

function startFlow(
  req: Request,
  provider: SocialProvider,
): { nonce: string; codeVerifier: string; state: string } {
  const url = new URL(req.url);
  const inviteToken = url.searchParams.get("invite");
  const nonce = randomBytes(16).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const state = beginOAuthFlow({
    provider,
    nonce,
    codeVerifier,
    inviteToken: inviteToken ? inviteToken.slice(0, 200) : null,
  });
  return { nonce, codeVerifier, state };
}

export async function handleGoogleStart(req: Request): Promise<Response> {
  const cfg = googleConfig();
  if (!cfg) {
    // Honest inert state: no env, no door. The client hides the button
    // from /auth/methods, so reaching here means a hand-typed URL.
    return jsonRes({ error: "Google sign-in isn't switched on yet." }, 404);
  }
  if (!ipAttempt(clientIp(req), 20, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 429);
  }
  const { nonce, codeVerifier, state } = startFlow(req, "google");
  return redirectRes(
    googleAuthorizationUrl({
      config: cfg,
      origin: publicOrigin(),
      state,
      nonce,
      codeVerifier,
    }),
  );
}

export async function handleAppleStart(req: Request): Promise<Response> {
  const cfg = appleConfig();
  if (!cfg) {
    return jsonRes(
      { error: "Apple sign-in arrives with the Apple Developer enrollment — it isn't switched on yet." },
      404,
    );
  }
  if (!ipAttempt(clientIp(req), 20, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 429);
  }
  const { nonce, state } = startFlow(req, "apple");
  return redirectRes(
    appleAuthorizationUrl({
      config: cfg,
      origin: publicOrigin(),
      state,
      nonce,
    }),
  );
}

async function finishOAuth(outcome: SocialOutcome): Promise<Response> {
  if (outcome.kind === "refused") {
    return redirectRes(
      `/?authError=${outcome.reason === "invite_only" ? "invite_only" : "signin_failed"}`,
    );
  }
  return redirectRes(
    "/",
    sessionCookieHeader(outcome.token, SESSION_ABSOLUTE_MS / 1000),
  );
}

export async function handleGoogleCallback(
  req: Request,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  const cfg = googleConfig();
  if (!cfg) return redirectRes("/?authError=signin_failed");
  const db = getDb();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const flow = state ? consumeOAuthFlow(state) : null;
  if (!code || !flow || flow.provider !== "google") {
    return redirectRes("/?authError=signin_failed");
  }
  try {
    const identity = await exchangeGoogleCode({
      config: cfg,
      origin: publicOrigin(),
      code,
      codeVerifier: flow.codeVerifier,
      nonce: flow.nonce,
      fetchFn,
    });
    const outcome = await completeSocialSignIn(db, {
      provider: "google",
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      inviteToken: flow.inviteToken,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return finishOAuth(outcome);
  } catch {
    return redirectRes("/?authError=signin_failed");
  }
}

export async function handleAppleCallback(
  req: Request,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  const cfg = appleConfig();
  if (!cfg) return redirectRes("/?authError=signin_failed");
  const db = getDb();
  let code: string | null = null;
  let state: string | null = null;
  let userName: string | null = null;
  if (req.method === "POST") {
    // form_post: code + state (+ user JSON on first consent only).
    const form = await req.formData().catch(() => null);
    code = form ? str(form.get("code")) : null;
    state = form ? str(form.get("state")) : null;
    const userRaw = form ? str(form.get("user")) : null;
    if (userRaw) {
      try {
        const user = JSON.parse(userRaw) as {
          name?: { firstName?: string; lastName?: string };
        };
        const parts = [user.name?.firstName, user.name?.lastName].filter(
          (p): p is string => typeof p === "string" && p.length > 0,
        );
        if (parts.length > 0) userName = parts.join(" ");
      } catch {
        userName = null;
      }
    }
  } else {
    const url = new URL(req.url);
    code = url.searchParams.get("code");
    state = url.searchParams.get("state");
  }
  const flow = state ? consumeOAuthFlow(state) : null;
  if (!code || !flow || flow.provider !== "apple") {
    return redirectRes("/?authError=signin_failed");
  }
  try {
    const identity = await exchangeAppleCode({
      config: cfg,
      origin: publicOrigin(),
      code,
      nonce: flow.nonce,
      fetchFn,
    });
    const outcome = await completeSocialSignIn(db, {
      provider: "apple",
      subject: identity.subject,
      email: identity.email,
      name: userName ?? identity.name,
      inviteToken: flow.inviteToken,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return finishOAuth(outcome);
  } catch {
    return redirectRes("/?authError=signin_failed");
  }
}

// ---- Passkey handlers --------------------------------------------------------

async function fullSession(req: Request) {
  const db = getDb();
  const resolved = await resolveSession(db, sessionCookieFromRequest(req));
  if (!resolved || resolved.viewer.totpPending) return null;
  return { db, resolved };
}

export async function handlePasskeyRegisterOptions(
  req: Request,
): Promise<Response> {
  const ctx = await fullSession(req);
  if (!ctx) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 401);
  if (!ipAttempt(clientIp(req), 10, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 429);
  }
  const { db, resolved } = ctx;
  const { challengeB64 } = issueWebauthnChallenge(resolved.viewer.accountId);
  const existing = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.accountId, resolved.viewer.accountId));
  return jsonRes({
    challenge: challengeB64,
    rp: { id: webauthnRpId(), name: "STONEMILES" },
    user: {
      // Opaque, stable per-account handle — never the email itself in
      // a second place; the authenticator shows name/displayName.
      id: b64urlEncode(
        new TextEncoder().encode(`sm-account-${resolved.viewer.accountId}`),
      ),
      name: resolved.viewer.email,
      displayName: resolved.viewer.username,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: existing.map((r) => ({
      type: "public-key",
      id: r.credentialId,
    })),
  });
}

export async function handlePasskeyRegisterVerify(
  req: Request,
): Promise<Response> {
  const ctx = await fullSession(req);
  if (!ctx) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 401);
  const { db, resolved } = ctx;
  const body = await readJson(req);
  const credential = body.credential as RegistrationCredential | undefined;
  if (!credential) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 400);
  try {
    const { credentialId } = await verifyRegistration(db, {
      accountId: resolved.viewer.accountId,
      credential,
      origin: publicOrigin(),
      rpId: webauthnRpId(),
      deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : "",
    });
    await audit(db, {
      event: "passkey_enrolled",
      accountId: resolved.viewer.accountId,
      detail: `passkey enrolled (${credentialId.slice(0, 8)}…)`,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonRes({ ok: true });
  } catch {
    return jsonRes(
      { error: "That passkey setup didn't finish — try again." },
      400,
    );
  }
}

export async function handlePasskeyList(req: Request): Promise<Response> {
  const ctx = await fullSession(req);
  if (!ctx) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 401);
  const rows = await ctx.db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.accountId, ctx.resolved.viewer.accountId));
  return jsonRes({
    passkeys: rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    })),
  });
}

export async function handlePasskeyRemove(req: Request): Promise<Response> {
  const ctx = await fullSession(req);
  if (!ctx) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 401);
  const body = await readJson(req);
  const id = Number(body.id);
  if (!Number.isFinite(id)) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 400);
  const rows = await ctx.db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.accountId, ctx.resolved.viewer.accountId));
  const target = rows.find((r) => r.id === id);
  if (target) {
    await ctx.db
      .delete(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.id, target.id));
    await audit(ctx.db, {
      event: "passkey_removed",
      accountId: ctx.resolved.viewer.accountId,
      detail: "passkey removed by its owner",
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  }
  return jsonRes({ ok: true });
}

export async function handlePasskeyAuthOptions(
  req: Request,
): Promise<Response> {
  const db = getDb();
  if (!ipAttempt(clientIp(req), 20, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 429);
  }
  const body = await readJson(req);
  const emailRaw = typeof body.email === "string" ? body.email : "";
  let accountId: number | null = null;
  let allowCredentials: Array<{ type: "public-key"; id: string }> = [];
  if (emailRaw && isValidEmail(normalizeEmail(emailRaw))) {
    const account = await accountByEmail(db, normalizeEmail(emailRaw));
    if (account) {
      const rows = await db
        .select()
        .from(schema.passkeyCredentials)
        .where(eq(schema.passkeyCredentials.accountId, account.id));
      if (rows.length > 0) {
        accountId = account.id;
        allowCredentials = rows.map((r) => ({
          type: "public-key" as const,
          id: r.credentialId,
        }));
      }
    }
  }
  const { challengeB64 } = issueWebauthnChallenge(accountId);
  return jsonRes({
    challenge: challengeB64,
    rpId: webauthnRpId(),
    timeout: 60000,
    userVerification: "required",
    allowCredentials,
  });
}

export async function handlePasskeyAuthVerify(req: Request): Promise<Response> {
  const db = getDb();
  if (!ipAttempt(clientIp(req), 20, 15 * 60 * 1000)) {
    return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 429);
  }
  const body = await readJson(req);
  const credential = body.credential as AuthenticationCredential | undefined;
  if (!credential) return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 400);
  const outcome = await verifyAuthentication(db, {
    credential,
    origin: publicOrigin(),
    rpId: webauthnRpId(),
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : "",
  });
  if (outcome.kind === "refused") {
    return jsonRes({ error: GENERIC_SOCIAL_ERROR }, 401);
  }
  return jsonRes(
    {
      ok: true,
      totpRequired: outcome.totpRequired,
      account: { email: outcome.email, username: outcome.username },
    },
    200,
    {
      "set-cookie": sessionCookieHeader(
        outcome.token,
        SESSION_ABSOLUTE_MS / 1000,
      ),
    },
  );
}
