# Multi-driver sign-in — DESIGN ONLY (not built in Phase 1)

Status: **designed, not built.** Phase 1 proved the standalone boot with
the app's current single-user identity. This document is the Phase 2
auth build plan. Nothing in this file is live code.

## Where identity stands today (verified in source)

- There is no host-level auth. Every action resolves "me" through
  `myUsername(ctx)` in `server/src/actions.ts`, which reads **profile
  id 1** and returns its `socialUsername` (default `"driver"`).
- Nearly all per-driver data across the 150+ tables is keyed by that
  username string (trips, loads, pay book, road intel, team seats…).
- The app already carries an in-app security pack (migration 0041):
  `login_sessions` (username, deviceId, tokenHash, expiry), 
  `totp_credentials`, `recovery_codes`, `account_locks`, `stepup_state`,
  plus `profile.pin_hash`. These were designed for in-app device/PIN
  flows inside the Muse runtime, where the runtime itself was the
  identity boundary. On a public host, the host must become that
  boundary.

## Design

### New tables (one new migration, SQLite now, Postgres in Phase 2)

```sql
CREATE TABLE host_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,          -- login identifier, lowercased
  password_hash TEXT NOT NULL,                 -- Argon2id via Bun.password.hash
  profile_id    INTEGER NOT NULL UNIQUE        -- the profile row this account owns
                REFERENCES profile(id),
  role          TEXT NOT NULL DEFAULT 'driver' -- 'owner' | 'driver'
                CHECK (role IN ('owner','driver')),
  status        TEXT NOT NULL DEFAULT 'active' -- 'active' | 'disabled'
                CHECK (status IN ('active','disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE host_sessions (
  id           TEXT PRIMARY KEY,               -- sha256(session token) hex, never the raw token
  account_id   INTEGER NOT NULL REFERENCES host_accounts(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,               -- 30 days, sliding on use
  revoked_at   INTEGER,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX idx_host_sessions_account ON host_sessions(account_id);
```

Passwords are hashed with `Bun.password.hash(pw, { algorithm: "argon2id" })`
(built into the Bun runtime — no new dependency). Raw session tokens are
256-bit random values; only their SHA-256 hash is stored, mirroring the
existing `login_sessions.tokenHash` pattern.

### Request flow (host layer, `host/server.ts` + `host/auth.ts`)

1. `POST /auth/register` — email + password → creates `host_accounts`
   row **and** a fresh `profile` row (next id), links them, starts a
   session. Registration is invite-gated during closed test (a
   `host_invites` table or a single `REGISTRATION_INVITE_CODE` env var;
   decide at build time — the app already has a beta-code system whose
   pattern can be reused).
2. `POST /auth/login` — verifies Argon2id hash, enforces
   `account_locks`, mints a session, sets cookie:
   `sm_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
3. `POST /auth/logout` — revokes the session row, clears the cookie.
4. On every `POST /actions`, the host resolves the cookie → account →
   `profile_id`, and passes it into the invocation ctx as
   `ctx.viewer` + a host-only `profileId` field.
5. Unauthenticated `/actions` calls (except a small allowlist) get
   `401 {error:{code:"auth_required"}}` once auth is switched on.

### The one server-code change auth requires

`myUsername(ctx)` and the handful of `profile.id = 1` reads
(`getProfile`, `getAppSettings`/`saveAppSettings` use id 1 directly)
must resolve the **session's** profile instead of the constant 1:

- Add `profileId` to the standalone Ctx (host-supplied; the Muse
  runtime ignores unknown ctx fields, but the actions code is shared —
  so the change is: `const pid = (ctx as {profileId?: number}).profileId ?? 1`).
- `myUsername` then reads `profile.id = pid`; per-username data follows
  automatically because it keys off the returned username.
- Every other `eq(schema.profile.id, 1)` / `appSettings.id = 1` site
  (grep-counted at build time) gets the same substitution.
- Until auth ships, the host passes `profileId: 1`, preserving today's
  behavior exactly — which is what Phase 1 proved.

### Profile id 1 becomes the owner's account

One-time seed step at auth launch (script, run by the owner):

1. Insert `host_accounts` row #1: owner's email, Argon2id hash of a
   password the **owner sets interactively** (never via chat, never
   stored anywhere else), `profile_id = 1`, `role = 'owner'`.
2. All existing data (keyed to profile 1's `socialUsername`) is
   untouched and now belongs to that account.
3. New tester accounts get fresh profile rows (ids 2, 3, …) with their
   own usernames, fully isolated by the existing username keying.

### Client changes

- A sign-in/register screen in the client (new route-level component,
  shown when `/actions` answers 401 or `GET /auth/me` answers null).
- `createActionClient` already sends cookies same-origin by default
  fetch semantics in browsers; Capacitor builds need
  `credentials: "include"` verified on device.
- The in-app Security Pack (PIN, TOTP, recovery codes) stays as a
  second factor / device layer on top of host sessions — it is
  complementary, not replaced.

### Open decisions for the owner (at build time, not now)

- Invite-gating mechanism for closed-test registration.
- Whether `login_sessions` (in-app device sessions) and
  `host_sessions` merge or stay layered.
- Password reset transport (depends on the Resend go-live decision).

## Why this was not built in Phase 1

The Phase 1 brief scopes auth as "scaffold only if the boot proof lands
cleanly with time to spare." The boot proof is the gate for everything
else; auth touches the shared identity helper (`myUsername`) used by
hundreds of actions and deserves its own verified pass, its own
migration, and the owner's decisions above — not a rushed scaffold.
