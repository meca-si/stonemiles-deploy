// social-auth.test.ts — unit + integration coverage for the social /
// passkey sign-in build (x's order, 2026-11-10), against the REAL
// host auth modules over a throwaway migrated SQLite database:
//
//   config:  env-unset ⇒ doors inert (methods + start handlers 404)
//   oauth:   flow store single-use + expiry; ID-token verification
//            (signature, aud, nonce, exp, email_verified) via a local
//            RS256 key + stubbed JWKS/token endpoints
//   gate:    uninvited social email refused, NOTHING created
//   invite:  invite consumed via Google → account + profile + identity
//   link:    same verified email links to the existing account
//   conflict: subject and email pointing at different accounts refused
//   totp:    D7 gate still fires after social AND passkey sign-ins
//   webauthn: challenge lifecycle (issue/consume/replay/expiry),
//            software-authenticator registration + authentication
//            happy path, origin mismatch, sign-counter regression
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (both bind at module load) — the same
// pattern as server/src/boardAssignFlow.test.ts; if that suite loaded
// first in this process the singleton is shared and every assertion
// below is scoped to this suite's own emails/subjects.

import { describe, expect, test } from "bun:test";
import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-socialauth-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.APPLE_CLIENT_ID;
delete process.env.APPLE_TEAM_ID;
delete process.env.APPLE_KEY_ID;
delete process.env.APPLE_PRIVATE_KEY;
delete process.env.STONEMILES_PUBLIC_ORIGIN;
delete process.env.WEBAUTHN_RP_ID;

const { getDb, STANDALONE_ROOT } = await import("./ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });
const schema = await import("../server/src/schema");
const { eq } = await import("drizzle-orm");
const auth = await import("./auth");
const social = await import("./social-auth");
import type {
  AuthenticationCredential,
  RegistrationCredential,
} from "./social-auth";

const db = getDb();
const ORIGIN = "https://app.stonervision.io";
const RP_ID = "app.stonervision.io";
const B64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

let seq = 0;
function uniqueEmail(tag: string): string {
  seq += 1;
  return `socialauth-${tag}-${seq}@test.local`;
}

async function seedAccount(email: string, opts?: { isOwner?: boolean }): Promise<number> {
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
  const username = `social${accountId}`;
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

async function seedInvite(email: string, token: string): Promise<void> {
  await db.insert(schema.accountInvites).values({
    kind: "tester",
    email,
    tokenHash: auth.sha256Hex(token),
    grantPlan: "diamond",
    status: "pending",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

async function accountRows(email: string) {
  return db.select().from(schema.accounts).where(eq(schema.accounts.email, email));
}

async function identityRows(provider: string, subject: string) {
  const rows = await db
    .select()
    .from(schema.accountIdentities)
    .where(eq(schema.accountIdentities.provider, provider));
  return rows.filter((r) => r.providerSubject === subject);
}

// ---------------------------------------------------------------------------
// Config + inert doors
// ---------------------------------------------------------------------------

describe("social auth config", () => {
  test("env unset ⇒ google/apple inert, email + passkey on", () => {
    expect(social.authMethods({})).toEqual({
      email: true,
      google: false,
      apple: false,
      passkey: true,
    });
  });

  test("google needs BOTH id and secret; apple needs all four values", () => {
    expect(social.authMethods({ GOOGLE_OAUTH_CLIENT_ID: "x" }).google).toBe(false);
    expect(
      social.authMethods({
        GOOGLE_OAUTH_CLIENT_ID: "x",
        GOOGLE_OAUTH_CLIENT_SECRET: "y",
      }).google,
    ).toBe(true);
    expect(
      social.authMethods({
        APPLE_CLIENT_ID: "a",
        APPLE_TEAM_ID: "b",
        APPLE_KEY_ID: "c",
      }).apple,
    ).toBe(false);
    expect(
      social.authMethods({
        APPLE_CLIENT_ID: "a",
        APPLE_TEAM_ID: "b",
        APPLE_KEY_ID: "c",
        APPLE_PRIVATE_KEY: "d",
      }).apple,
    ).toBe(true);
  });

  test("start handlers refuse honestly when the door is unset", async () => {
    const g = await social.handleGoogleStart(
      new Request("https://app.stonervision.io/auth/google/start"),
    );
    expect(g.status).toBe(404);
    const a = await social.handleAppleStart(
      new Request("https://app.stonervision.io/auth/apple/start"),
    );
    expect(a.status).toBe(404);
    const m = await social.handleAuthMethods();
    expect(await m.json()).toEqual({
      email: true,
      google: false,
      apple: false,
      passkey: true,
    });
  });

  test("google authorization URL carries PKCE S256, nonce, state", () => {
    const url = new URL(
      social.googleAuthorizationUrl({
        config: { clientId: "cid", clientSecret: "sec" },
        origin: ORIGIN,
        state: "st",
        nonce: "nn",
        codeVerifier: "verifier-123",
      }),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update("verifier-123").digest("base64url"),
    );
    expect(url.searchParams.get("nonce")).toBe("nn");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.stonervision.io/auth/google/callback",
    );
  });
});

// ---------------------------------------------------------------------------
// OAuth flow store
// ---------------------------------------------------------------------------

describe("oauth flow store", () => {
  test("state is single-use", () => {
    const state = social.beginOAuthFlow({
      provider: "google",
      nonce: "n",
      codeVerifier: "v",
      inviteToken: null,
    });
    const flow = social.consumeOAuthFlow(state);
    expect(flow?.provider).toBe("google");
    expect(social.consumeOAuthFlow(state)).toBeNull();
  });

  test("expired state is refused", () => {
    const state = social.beginOAuthFlow(
      { provider: "apple", nonce: "n", codeVerifier: "v", inviteToken: null },
      -1,
    );
    expect(social.consumeOAuthFlow(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ID-token verification with a local RS256 key + stubbed JWKS
// ---------------------------------------------------------------------------

const idKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const idJwk = idKey.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
idJwk.kid = "test-kid-1";
idJwk.alg = "RS256";

function mintIdToken(payload: Record<string, unknown>, key: KeyObject = idKey.privateKey): string {
  const head = B64(Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-kid-1", typ: "JWT" })));
  const body = B64(Buffer.from(JSON.stringify(payload)));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  const sig = signer.sign(key);
  return `${head}.${body}.${B64(sig)}`;
}

const jwksFetch = (async (input: unknown) => {
  const url = String(input);
  if (url.includes("oauth2/v3/certs")) {
    return new Response(JSON.stringify({ keys: [idJwk] }), {
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;

const basePayload = {
  iss: "https://accounts.google.com",
  aud: "google-client-id",
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: "google-subject-1",
  email: "driver@test.local",
  email_verified: true,
  nonce: "nonce-1",
  name: "Test Driver",
};

describe("id token verification", () => {
  const verify = (token: string, nonce: string | null = "nonce-1") =>
    social.verifyIdToken({
      token,
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      issuers: ["https://accounts.google.com", "accounts.google.com"],
      audience: "google-client-id",
      nonce,
      fetchFn: jwksFetch,
    });

  test("a properly signed token verifies", async () => {
    const payload = await verify(mintIdToken(basePayload));
    expect(payload.sub).toBe("google-subject-1");
  });

  test("tampered payload is refused", async () => {
    const token = mintIdToken(basePayload);
    const [h, , s] = token.split(".");
    const forged = `${h}.${B64(Buffer.from(JSON.stringify({ ...basePayload, sub: "attacker" })))}.${s}`;
    await expect(verify(forged)).rejects.toThrow();
  });

  test("wrong audience / nonce / expired are refused", async () => {
    await expect(verify(mintIdToken({ ...basePayload, aud: "someone-else" }))).rejects.toThrow();
    await expect(verify(mintIdToken(basePayload), "other-nonce")).rejects.toThrow();
    await expect(
      verify(mintIdToken({ ...basePayload, exp: Math.floor(Date.now() / 1000) - 60 })),
    ).rejects.toThrow();
  });

  test("google exchange maps a verified token to an identity", async () => {
    const token = mintIdToken(basePayload);
    const fetchFn = (async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (url.includes("oauth2/v3/certs")) {
        return new Response(JSON.stringify({ keys: [idJwk] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("oauth2.googleapis.com/token")) {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ id_token: token }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const identity = await social.exchangeGoogleCode({
      config: { clientId: "google-client-id", clientSecret: "sec" },
      origin: ORIGIN,
      code: "auth-code",
      codeVerifier: "verifier",
      nonce: "nonce-1",
      fetchFn,
    });
    expect(identity).toEqual({
      provider: "google",
      subject: "google-subject-1",
      email: "driver@test.local",
      name: "Test Driver",
    });
  });

  test("google exchange refuses an unverified email", async () => {
    const token = mintIdToken({ ...basePayload, email_verified: false });
    const fetchFn = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("oauth2/v3/certs")) {
        return new Response(JSON.stringify({ keys: [idJwk] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id_token: token }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await expect(
      social.exchangeGoogleCode({
        config: { clientId: "google-client-id", clientSecret: "sec" },
        origin: ORIGIN,
        code: "auth-code",
        codeVerifier: "verifier",
        nonce: "nonce-1",
        fetchFn,
      }),
    ).rejects.toThrow();
  });

  test("apple client secret is a verifiable ES256 JWT", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = ec.privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    const jwt = social.appleClientSecret(
      { clientId: "io.stonervision.signin", teamId: "TEAM123", keyId: "KEY123", privateKey: pem },
      1700000000,
    );
    const [h, p, s] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    expect(payload.iss).toBe("TEAM123");
    expect(payload.sub).toBe("io.stonervision.signin");
    expect(payload.aud).toBe("https://appleid.apple.com");
    const v = createVerify("SHA256");
    v.update(`${h}.${p}`);
    expect(
      v.verify(
        { key: ec.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(s!, "base64url"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The invite gate + linking semantics (completeSocialSignIn)
// ---------------------------------------------------------------------------

describe("social sign-in gate", () => {
  const meta = { ip: null, userAgent: "unit-test" };

  test("uninvited social email is refused and NOTHING is created", async () => {
    const email = uniqueEmail("stranger");
    const outcome = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      ...meta,
    });
    expect(outcome).toEqual({ kind: "refused", reason: "invite_only" });
    expect((await accountRows(email)).length).toBe(0);
    expect((await identityRows("google", `sub-${email}`)).length).toBe(0);
    const audits = await db
      .select()
      .from(schema.authAuditLog)
      .where(eq(schema.authAuditLog.event, "social_signin_refused"));
    expect(audits.length).toBeGreaterThan(0);
  });

  test("invite is consumed via Google: account + profile + identity + session", async () => {
    const email = uniqueEmail("invited");
    const token = `invite-token-${email}`;
    await seedInvite(email, token);
    const outcome = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      name: "Invited Driver",
      inviteToken: token,
      ...meta,
    });
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") return;
    expect(outcome.created).toBe(true);
    expect(outcome.totpRequired).toBe(false);
    const accounts = await accountRows(email);
    expect(accounts.length).toBe(1);
    expect(accounts[0]!.status).toBe("active");
    expect(accounts[0]!.passwordHash).toBeNull();
    const invites = await db
      .select()
      .from(schema.accountInvites)
      .where(eq(schema.accountInvites.email, email));
    expect(invites[0]!.status).toBe("accepted");
    expect((await identityRows("google", `sub-${email}`)).length).toBe(1);
    // The issued session resolves (the D7 gate is shared, not bypassed).
    const resolved = await auth.resolveSession(db, outcome.token);
    expect(resolved?.viewer.email).toBe(email);
    expect(resolved?.viewer.totpPending).toBe(false);
  });

  test("second sign-in rides the linked identity (no invite needed)", async () => {
    const email = uniqueEmail("invited2");
    await seedInvite(email, `tok-${email}`);
    const first = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      ...meta,
    });
    expect(first.kind).toBe("session");
    const second = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      ...meta,
    });
    expect(second.kind).toBe("session");
    if (second.kind === "session") expect(second.created).toBe(false);
    expect((await accountRows(email)).length).toBe(1);
  });

  test("same verified email links to the existing password account", async () => {
    const email = uniqueEmail("linkme");
    const accountId = await seedAccount(email);
    const outcome = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      ...meta,
    });
    expect(outcome.kind).toBe("session");
    if (outcome.kind === "session") {
      expect(outcome.accountId).toBe(accountId);
      expect(outcome.created).toBe(false);
    }
    expect((await accountRows(email)).length).toBe(1);
    const identities = await identityRows("google", `sub-${email}`);
    expect(identities.length).toBe(1);
    expect(identities[0]!.accountId).toBe(accountId);
  });

  test("subject pointing at A with B's email is refused (no implicit merge)", async () => {
    const emailA = uniqueEmail("conflict-a");
    const emailB = uniqueEmail("conflict-b");
    await seedAccount(emailA);
    await seedAccount(emailB);
    const linked = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${emailA}`,
      email: emailA,
      ...meta,
    });
    expect(linked.kind).toBe("session");
    const conflict = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${emailA}`,
      email: emailB,
      ...meta,
    });
    expect(conflict).toEqual({ kind: "refused", reason: "generic" });
  });

  test("owner with TOTP enabled still hits the D7 gate after social sign-in", async () => {
    const email = uniqueEmail("owner");
    const accountId = await seedAccount(email, { isOwner: true });
    const profile = await db
      .select()
      .from(schema.profile)
      .where(eq(schema.profile.accountId, accountId))
      .limit(1);
    await db.insert(schema.totpCredentials).values({
      username: profile[0]!.socialUsername,
      secretEnc: "JBSWY3DPEHPK3PXP", // raw base32 stands in for the vault value in tests
      enabled: true,
    });
    const outcome = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      ...meta,
    });
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") return;
    expect(outcome.totpRequired).toBe(true);
    const resolved = await auth.resolveSession(db, outcome.token);
    expect(resolved?.viewer.totpPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WebAuthn: software authenticator + ceremony coverage
// ---------------------------------------------------------------------------

// Minimal CBOR encoder for the shapes the authenticator must emit.
function cborHead(major: number, arg: number): number[] {
  if (arg < 24) return [(major << 5) | arg];
  if (arg < 256) return [(major << 5) | 24, arg];
  if (arg < 65536) return [(major << 5) | 25, (arg >> 8) & 255, arg & 255];
  return [
    (major << 5) | 26,
    (arg >>> 24) & 255,
    (arg >>> 16) & 255,
    (arg >>> 8) & 255,
    arg & 255,
  ];
}

function cborEncode(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array([...cborHead(2, value.length), ...value]);
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return new Uint8Array([...cborHead(3, bytes.length), ...bytes]);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("test encoder: ints only");
    if (value >= 0) return new Uint8Array(cborHead(0, value));
    return new Uint8Array(cborHead(1, -1 - value));
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => cborEncode(v));
    return new Uint8Array([
      ...cborHead(4, value.length),
      ...parts.flatMap((p) => [...p]),
    ]);
  }
  if (value instanceof Map) {
    const entries = [...value.entries()];
    const parts = entries.flatMap(([k, v]) => [cborEncode(k), cborEncode(v)]);
    return new Uint8Array([
      ...cborHead(5, entries.length),
      ...parts.flatMap((p) => [...p]),
    ]);
  }
  throw new Error("test encoder: unsupported value");
}

interface SoftAuthenticator {
  privateKey: KeyObject;
  credentialId: Uint8Array;
  coseKey: Uint8Array;
  signCount: number;
}

function makeAuthenticator(): SoftAuthenticator {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = pair.publicKey.export({ format: "jwk" }) as {
    x: string;
    y: string;
  };
  const cose = new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
    [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
  ]);
  return {
    privateKey: pair.privateKey,
    credentialId: new Uint8Array(randomBytes(16)),
    coseKey: cborEncode(cose),
    signCount: 0,
  };
}

function buildAuthData(opts: {
  flags: number;
  signCount: number;
  credId?: Uint8Array;
  coseKey?: Uint8Array;
}): Uint8Array {
  const rpHash = createHash("sha256").update(RP_ID).digest();
  const count = Buffer.alloc(4);
  count.writeUInt32BE(opts.signCount);
  const parts: Uint8Array[] = [
    new Uint8Array(rpHash),
    new Uint8Array([opts.flags]),
    new Uint8Array(count),
  ];
  if (opts.credId && opts.coseKey) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(opts.credId.length);
    parts.push(new Uint8Array(16), new Uint8Array(len), opts.credId, opts.coseKey);
  }
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

function clientDataJson(type: string, challenge: string, origin = ORIGIN): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ type, challenge, origin, crossOrigin: false }),
  );
}

function makeRegistration(
  authn: SoftAuthenticator,
  accountId: number,
  opts?: { origin?: string; challengeForAccount?: number },
): RegistrationCredential {
  const { challengeB64 } = social.issueWebauthnChallenge(
    opts?.challengeForAccount ?? accountId,
  );
  authn.signCount = 1;
  const authData = buildAuthData({
    flags: 0x01 | 0x04 | 0x40, // UP | UV | AT
    signCount: authn.signCount,
    credId: authn.credentialId,
    coseKey: authn.coseKey,
  });
  const attestation = new Map<string, unknown>([
    ["fmt", "none"],
    ["attStmt", new Map()],
    ["authData", authData],
  ]);
  return {
    id: B64(authn.credentialId),
    type: "public-key",
    response: {
      attestationObject: B64(cborEncode(attestation)),
      clientDataJSON: B64(clientDataJson("webauthn.create", challengeB64, opts?.origin)),
      transports: ["internal"],
    },
  };
}

function makeAssertion(
  authn: SoftAuthenticator,
  challengeB64: string,
  opts?: { signCount?: number; origin?: string },
): AuthenticationCredential {
  const count = opts?.signCount ?? ++authn.signCount;
  const authData = buildAuthData({
    flags: 0x01 | 0x04, // UP | UV
    signCount: count,
  });
  const cd = clientDataJson("webauthn.get", challengeB64, opts?.origin);
  const clientHash = createHash("sha256").update(cd).digest();
  const base = Buffer.concat([Buffer.from(authData), clientHash]);
  const signer = createSign("SHA256");
  signer.update(base);
  const sig = signer.sign({
    key: authn.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return {
    id: B64(authn.credentialId),
    type: "public-key",
    response: {
      authenticatorData: B64(authData),
      clientDataJSON: B64(cd),
      signature: B64(sig),
    },
  };
}

describe("webauthn challenges", () => {
  test("issue → consume works exactly once; replay refused", () => {
    const { challengeB64 } = social.issueWebauthnChallenge(42);
    const got = social.consumeWebauthnChallenge(challengeB64);
    expect(got?.accountId).toBe(42);
    expect(social.consumeWebauthnChallenge(challengeB64)).toBeNull();
  });

  test("expired challenge is refused", () => {
    const { challengeB64 } = social.issueWebauthnChallenge(42, -1);
    expect(social.consumeWebauthnChallenge(challengeB64)).toBeNull();
  });

  test("unknown challenge is refused", () => {
    expect(social.consumeWebauthnChallenge("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
  });
});

describe("webauthn ceremonies (software authenticator)", () => {
  test("registration + authentication happy path; assertion replay refused", async () => {
    const email = uniqueEmail("passkey");
    const accountId = await seedAccount(email);
    const authn = makeAuthenticator();
    const { credentialId } = await social.verifyRegistration(db, {
      accountId,
      credential: makeRegistration(authn, accountId),
      origin: ORIGIN,
      rpId: RP_ID,
    });
    expect(credentialId).toBe(B64(authn.credentialId));
    const stored = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.accountId, accountId));
    expect(stored.length).toBe(1);

    // Authentication via the exported ceremony.
    const { challengeB64 } = social.issueWebauthnChallenge(null);
    const assertion = makeAssertion(authn, challengeB64);
    const outcome = await social.verifyAuthentication(db, {
      credential: assertion,
      origin: ORIGIN,
      rpId: RP_ID,
      ip: null,
      userAgent: "unit-test",
    });
    expect(outcome.kind).toBe("session");
    if (outcome.kind === "session") {
      expect(outcome.accountId).toBe(accountId);
      expect(outcome.totpRequired).toBe(false);
    }
    // Replay: the challenge inside that assertion is consumed — the
    // identical payload can never sign in twice.
    const replay = await social.verifyAuthentication(db, {
      credential: assertion,
      origin: ORIGIN,
      rpId: RP_ID,
      ip: null,
      userAgent: "unit-test",
    });
    expect(replay).toEqual({ kind: "refused", reason: "generic" });
  });

  test("registration with a foreign origin is refused", async () => {
    const email = uniqueEmail("passkey-origin");
    const accountId = await seedAccount(email);
    const authn = makeAuthenticator();
    await expect(
      social.verifyRegistration(db, {
        accountId,
        credential: makeRegistration(authn, accountId, {
          origin: "https://evil.example",
        }),
        origin: ORIGIN,
        rpId: RP_ID,
      }),
    ).rejects.toThrow();
    const stored = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.accountId, accountId));
    expect(stored.length).toBe(0);
  });

  test("registration with another account's challenge is refused", async () => {
    const email = uniqueEmail("passkey-mismatch");
    const accountId = await seedAccount(email);
    const otherId = await seedAccount(uniqueEmail("passkey-other"));
    const authn = makeAuthenticator();
    await expect(
      social.verifyRegistration(db, {
        accountId,
        credential: makeRegistration(authn, accountId, {
          challengeForAccount: otherId,
        }),
        origin: ORIGIN,
        rpId: RP_ID,
      }),
    ).rejects.toThrow();
  });

  test("sign-counter regression (cloned authenticator) is refused", async () => {
    const email = uniqueEmail("passkey-counter");
    const accountId = await seedAccount(email);
    const authn = makeAuthenticator();
    await social.verifyRegistration(db, {
      accountId,
      credential: makeRegistration(authn, accountId),
      origin: ORIGIN,
      rpId: RP_ID,
    });
    const okChallenge = social.issueWebauthnChallenge(null);
    const ok = await social.verifyAuthentication(db, {
      credential: makeAssertion(authn, okChallenge.challengeB64),
      origin: ORIGIN,
      rpId: RP_ID,
      ip: null,
      userAgent: "unit-test",
    });
    expect(ok.kind).toBe("session");
    // Fresh challenge, but the counter goes BACKWARDS: refuse.
    const badChallenge = social.issueWebauthnChallenge(null);
    const bad = await social.verifyAuthentication(db, {
      credential: makeAssertion(authn, badChallenge.challengeB64, { signCount: 1 }),
      origin: ORIGIN,
      rpId: RP_ID,
      ip: null,
      userAgent: "unit-test",
    });
    expect(bad).toEqual({ kind: "refused", reason: "generic" });
  });

  test("handler round-trip: options → verify issues a session cookie", async () => {
    const email = uniqueEmail("passkey-handler");
    const accountId = await seedAccount(email);
    const authn = makeAuthenticator();
    await social.verifyRegistration(db, {
      accountId,
      credential: makeRegistration(authn, accountId),
      origin: ORIGIN,
      rpId: RP_ID,
    });
    const optRes = await social.handlePasskeyAuthOptions(
      new Request("https://app.stonervision.io/auth/passkey/auth/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(optRes.status).toBe(200);
    const options = (await optRes.json()) as {
      challenge: string;
      allowCredentials: unknown[];
    };
    expect(options.allowCredentials).toEqual([]); // discoverable flow
    const verifyRes = await social.handlePasskeyAuthVerify(
      new Request("https://app.stonervision.io/auth/passkey/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential: makeAssertion(authn, options.challenge),
        }),
      }),
    );
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.headers.get("set-cookie")).toContain("sm_session=");
    const body = (await verifyRes.json()) as { ok: boolean; totpRequired: boolean };
    expect(body.ok).toBe(true);
    expect(body.totpRequired).toBe(false);
  });

  test("handler verify with a foreign origin is a clean 401", async () => {
    const email = uniqueEmail("passkey-handler-origin");
    const accountId = await seedAccount(email);
    const authn = makeAuthenticator();
    await social.verifyRegistration(db, {
      accountId,
      credential: makeRegistration(authn, accountId),
      origin: ORIGIN,
      rpId: RP_ID,
    });
    const { challengeB64 } = social.issueWebauthnChallenge(null);
    const res = await social.handlePasskeyAuthVerify(
      new Request("https://app.stonervision.io/auth/passkey/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential: makeAssertion(authn, challengeB64, {
            origin: "https://evil.example",
          }),
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("owner with TOTP: passkey sign-in still pauses at the D7 gate", async () => {
    // (Team seat rather than a second owner row: a partial unique index
    // allows exactly one owner account per database. Team seats are under
    // the same D7 TOTP rule, so the gate exercised is identical.)
    const email = uniqueEmail("passkey-owner");
    const accountId = await seedAccount(email);
    const profile = await db
      .select()
      .from(schema.profile)
      .where(eq(schema.profile.accountId, accountId))
      .limit(1);
    await db.insert(schema.teamSeats).values({
      username: profile[0]!.socialUsername,
      role: "dispatcher",
      active: true,
      grantedBy: "unit-test",
    });
    await db.insert(schema.totpCredentials).values({
      username: profile[0]!.socialUsername,
      secretEnc: "JBSWY3DPEHPK3PXP",
      enabled: true,
    });
    const authn = makeAuthenticator();
    await social.verifyRegistration(db, {
      accountId,
      credential: makeRegistration(authn, accountId),
      origin: ORIGIN,
      rpId: RP_ID,
    });
    const { challengeB64 } = social.issueWebauthnChallenge(null);
    const outcome = await social.verifyAuthentication(db, {
      credential: makeAssertion(authn, challengeB64),
      origin: ORIGIN,
      rpId: RP_ID,
      ip: null,
      userAgent: "unit-test",
    });
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") return;
    expect(outcome.totpRequired).toBe(true);
    const resolved = await auth.resolveSession(db, outcome.token);
    expect(resolved?.viewer.totpPending).toBe(true);
  });

  test("enrollment over the session-gated handlers, then list + remove", async () => {
    const email = uniqueEmail("passkey-enroll");
    const accountId = await seedAccount(email);
    // A live session for the account (via the social door machinery).
    const session = await social.completeSocialSignIn(db, {
      provider: "google",
      subject: `sub-${email}`,
      email,
      ip: null,
      userAgent: "unit-test",
    });
    expect(session.kind).toBe("session");
    if (session.kind !== "session") return;
    const cookie = { cookie: `sm_session=${session.token}` };
    const optRes = await social.handlePasskeyRegisterOptions(
      new Request("https://app.stonervision.io/auth/passkey/register/options", {
        method: "POST",
        headers: { "content-type": "application/json", ...cookie },
        body: "{}",
      }),
    );
    expect(optRes.status).toBe(200);
    const options = (await optRes.json()) as {
      challenge: string;
      authenticatorSelection: { userVerification: string };
    };
    expect(options.authenticatorSelection.userVerification).toBe("required");
    // Feed the handler-issued challenge through the authenticator.
    const authn = makeAuthenticator();
    authn.signCount = 1;
    const authData = buildAuthData({
      flags: 0x01 | 0x04 | 0x40,
      signCount: 1,
      credId: authn.credentialId,
      coseKey: authn.coseKey,
    });
    const attestation = new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]);
    const credential: RegistrationCredential = {
      id: B64(authn.credentialId),
      type: "public-key",
      response: {
        attestationObject: B64(cborEncode(attestation)),
        clientDataJSON: B64(
          clientDataJson("webauthn.create", options.challenge),
        ),
        transports: ["internal"],
      },
    };
    const verifyRes = await social.handlePasskeyRegisterVerify(
      new Request("https://app.stonervision.io/auth/passkey/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json", ...cookie },
        body: JSON.stringify({ credential, deviceLabel: "Test iPhone" }),
      }),
    );
    expect(verifyRes.status).toBe(200);
    const listRes = await social.handlePasskeyList(
      new Request("https://app.stonervision.io/auth/passkey", {
        headers: { ...cookie },
      }),
    );
    const list = (await listRes.json()) as {
      passkeys: Array<{ id: number; deviceLabel: string }>;
    };
    expect(list.passkeys.length).toBe(1);
    expect(list.passkeys[0]!.deviceLabel).toBe("Test iPhone");
    const removeRes = await social.handlePasskeyRemove(
      new Request("https://app.stonervision.io/auth/passkey/remove", {
        method: "POST",
        headers: { "content-type": "application/json", ...cookie },
        body: JSON.stringify({ id: list.passkeys[0]!.id }),
      }),
    );
    expect(removeRes.status).toBe(200);
    const after = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.accountId, accountId));
    expect(after.length).toBe(0);
    // And the whole enrollment is refused without a session.
    const anon = await social.handlePasskeyRegisterOptions(
      new Request("https://app.stonervision.io/auth/passkey/register/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(anon.status).toBe(401);
  });
});
