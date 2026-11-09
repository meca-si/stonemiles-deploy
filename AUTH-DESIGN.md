# STONEMILES — Multi-Driver Sign-In: Auth Design

> **Status:** Phase 1 design deliverable. Design + schema only — **no auth code is built by this document.**
> **Scope:** STONEMILES standalone re-platform (Phase 1: local proof on SQLite; Phase 2: Render + Postgres at `app.stonervision.io`).
> **Sources grounded in:** export at `../stonemiles-src/` — `server/src/schema.ts` (4,116 lines, ~152 tables, `drizzle-orm/sqlite-core`), `server/src/actions.ts` (43,533 lines, 464 `defineAction`s), `server/src/privileged.ts`, `server/src/teamPortal.ts`, and `../DEPLOY.md` / `../render.yaml`. The standalone tree (`stonemiles-standalone/`) is currently a copy of the same source with `host/` empty and `shim/space-sdk/dist/*` still stubs — the host described in §5 is where auth lands.
> **House rules honoured throughout:** passwords are never stored in plaintext anywhere; the agent never holds user passwords or seed phrases; secrets live in env, and this document names env vars only — never values.

---

## 1. Current state (as the code actually is)

### 1.1 Identity today: there is none

- There is **no auth provider, no login, no password, and no per-request caller** anywhere in the codebase. `DEPLOY.md` §2.8 states it plainly: *"there is no auth provider in the code: the app is single-user staging."*
- The entire identity model is one helper in `actions.ts`:

  ```ts
  async function myUsername(ctx: Ctx): Promise<string> {
    const rows = await ctx.db().select().from(schema.profile)
      .where(eq(schema.profile.id, 1)).limit(1);
    return rows[0]?.socialUsername ?? "driver";
  }
  ```

  Every handler that needs "me" calls `myUsername(ctx)` and gets `profile.social_username` of row **id = 1**, falling back to the literal `"driver"`.
- `myPlan(ctx)` does the same read for the tier: `profile` id 1 → `normalizePlan(rows[0]?.plan)`. `normalizePlan` maps legacy `simple → basic`, `full → diamond`, passes `basic | gold | diamond | owner` through, and **defaults to `"diamond"` when no row exists** — a staging convenience that becomes a privilege bug the moment a second account exists (see §7).
- Direct `eq(schema.profile.id, 1)` reads appear **63 times** in `actions.ts` (profile, plan, settings, onboarding facts, account shells, …), independent of `myUsername`/`myPlan`.
- `Ctx` (from `@hatch/space-sdk`) carries `ctx.db()`, `ctx.blobs`, `ctx.invalidateQueries()`, `ctx.executePrivileged(...)`, `ctx.inference` — and **nothing about the caller**. There is no `ctx.user`, `ctx.viewer`, or session concept for the host to populate today. The client (`client/src/api.ts`) is a typed proxy that POSTs `{ action, args }` to a relative `./actions` endpoint with no credential attached.

### 1.2 The `profile` table (the row auth must attach to)

`profile` in `schema.ts` — note the table is named **`profile` (singular)** in SQL, exported as `profile`:

| Column | Type / notes |
|---|---|
| `id` | `integer` PK, **no autoincrement** — the singleton convention; the only row is id 1 |
| Truck/fuel block | `height_ft`, `height_in`, `weight_lbs`, `length_ft`, `mpg`, `diesel_price`, `tank_range_mi`, brand-off flags, automation toggles, `priority_1..3`, `hazmat`, `hazmat_class`, `current_trailer`, `trailer_type` |
| `pin_hash` | `text`, nullable — SHA-256-era app-lock PIN hash (Security Pack upgrades it to salted PBKDF2-SHA256, 120k iterations — see `logSecurityEvent` detail strings). **This is a device app-lock, not an account password. Auth must not reuse it.** |
| `chat_name` | `text`, default `"Driver"` |
| `social_username` | `text`, default `"driver"` — **this string is the de-facto primary key of the whole app** (see §1.3) |
| `company_name`, `driver_cpm`, `pay_basis`, `driver_pay_pct` | Company-driver pay settings, nullable |
| `plan` | `text`, default `"diamond"` — `basic \| gold \| diamond \| owner`; prices are **not** stored per user (locked price constants live in `actions.ts`); `owner_price` is a legacy column, no longer read/written |
| `owner_trucks`, `owner_seats` | `integer`, defaults 3 / 1 — Owner-plan fleet size |
| `kyc_status` | `text`, default `not_started` |
| `updated_at` | `integer timestamp_ms` |

The row is created lazily (e.g. `setPlan` inserts a defaults row at id 1 when none exists). **There is no email column on `profile`.** The only email "on file" for the current user is indirect — `accountEmailFor(ctx, username)` resolves, in order: `doc_copy_settings.driver_email` → linked `shipper_accounts.email` → linked `broker_accounts.email`, else `null`.

### 1.3 How data is keyed today — three shapes, only one of them multi-user-ready

| Shape | Count / examples | Multi-account consequence |
|---|---|---|
| **(a) Username-keyed** — rows carry a `username` / `*_username` text column whose value is `profile.social_username` | ~74 tables: `points_log`, `points_conversions`, `subscription_events`, `social_users` (PK = `username`), `company_members`, `chat_members`, `referral_codes` (PK = `username`), `daily_logs`, `pay_entries`, `onboarding_state` (PK = `username`), `totp_credentials` (PK), `recovery_codes`, `account_locks` (PK), `stepup_state` (PK), `security_prefs`, `track_points`, `doc_copy_settings`, … | Portable **if and only if** usernames become unique per account and every query is filtered by the *session* username. Today most queries trust `myUsername()`; some (e.g. `myMembership`) load a whole table and `.find()` in memory — correct only while there is one user. |
| **(b) Singleton `id = 1`** — one global row | `profile`, `beta_access`, `app_settings`, `admin_settings`, `learning_state`, `pin_guard`, `si_settings`, `app_health_settings`, `passport_prefs`, `vault_keys` (id-keyed) | **Breaks outright.** A second driver would read/write the owner's settings, PIN guard, learning state, and beta gate. Each needs a per-account conversion (§4.4) or an explicit "stays global, owner-only" ruling (`admin_settings` is the clear global; `vault_keys` is server crypto state, not user data). |
| **(c) No owner column at all** — rows exist in one shared pile | ~69 tables, including the core records: **`trips`, `trip_queue`, `loads`**, `expenses`, `settlements`, `scale_tickets`, `personal_docs`, `dvir_reports`, `fuel_purchases`, `saved_places`, `recent_destinations`, `eld_connections`, `fleet_trucks`, plus genuinely shared data (`chain_log`, `intel_reports`, `weigh_station_*`, `work_zones`, `hazard_reports`, `market_pulse_weeks`, `eia_diesel_snapshots`, `giveaway_cycles`, `chat_messages`) | The dangerous split. *Private* records in this pile (`trips`, `loads`, settlements, documents…) are currently "private" only because there is one user. Serving them to account B unfiltered would leak account A's records. *Shared* records (road intel, hash chain, market data) are global **by design** and must stay global. §9 step 4 classifies every (c) table into one of the two before any tester is invited. |

### 1.4 Auth-adjacent systems that already exist (integrate, do not rebuild)

These are real, shipped staging logic — several are *simulated* multi-user systems built on top of the single username. Auth must plug into them, not replace them:

| System | Tables (in `schema.ts`) | Actions / helpers (in `actions.ts`) | Auth integration point |
|---|---|---|---|
| **Beta gate** | `beta_codes` (`code`, `kind: owner\|driver`, `single_use`, `used_by`, `used_at`, `revoked` — **note: `code` is not `.unique()`**), `beta_access` (singleton id 1: `unlocked`, `account_kind`, `code_used`, `unlocked_at`) | `getBetaStatus`, `redeemBetaCode`, `getBetaPanel`, helpers `betaAccessRow`, `isBetaOwner`, `mintBetaDriverCode` (format `MILE-XXXX-XXXX`) | `isBetaOwner()` — *the* admin check today (`unlocked && account_kind === "owner"`) — is global, not per-account. It gates team-seat management, the beta panel, and owner surfaces. Auth replaces its *source* (§7.3). Redemption also fires `maybeAwardSignupPoints` + optional `linkReferral` — keep those hooks. |
| **Team seats (locked rules)** | `team_seats` (PK `username`; `role: developer\|support`, `active`, `granted_by`), `team_invite_codes` (`code` unique, `email`, `role`, `issued_by`, `status: pending\|redeemed\|revoked\|expired`, `expires_at`, `redeemed_by/at`), `team_audit_log`, `account_admin` (per-username team overlay: tier/trucks/status), `team_change_notices` | `teamListSeats`, `teamGrantSeat` (**refuses every caller by design** — direct grants are closed), `teamRevokeSeat`, `teamCreateInvite`, `teamListInvites`, `teamRevokeInvite`, `teamRedeemInvite`, `teamResendInvite`, `teamGetAuditLog`; helpers `myTeamSeat`, `canManageTeamSeats` (= `isBetaOwner`), `canViewTeamSeats`, `mintTeamInviteCode` (`TEAM-XXXX-XXXX-XXXX`), `teamLog` (audit row + sealed `chain_log` event `team_action`) | Already correct in shape — it is written *as if* accounts existed. It breaks today only because `myUsername()` always returns the same person, `accountEmailFor` reads doc-copy settings, and `canManageTeamSeats` rests on the global beta flag. Give it real accounts and it works as locked: owner-only issuance, email-bound, single-use, 7-day TTL (`TEAM_INVITE_TTL_MS` in `teamPortal.ts`), audit-logged. **Do not redesign it.** |
| **Consent-gated help** | `team_consent_requests` (`kind: password_reset\|personal_info`, `status: pending\|approved\|denied\|consumed`), `team_item_consent_windows` (one item, one named seat, 30 min — `ITEM_CONSENT_WINDOW_MS`), `team_item_access_log` | `teamRequestConsent`, `teamListConsentRequests`, `teamApplyConsent`, `teamRequestItemConsent`, `teamViewConsentedItem`, `teamEditConsentedPayEntry`, … | `teamApplyConsent` for `password_reset` already revokes the target's `login_sessions` rows. In the auth world this flow must call the real password-reset path (§6.4) instead of simulating one — and it stays **consent-first**: a team seat never resets a password unilaterally. |
| **Security Pack (staged device security)** | `login_sessions` (`username`, `device_id`, `device_label`, `token_hash`, `last_active_at`, `revoked_at`), `totp_credentials` (vault-encrypted secret), `recovery_codes` (SHA-256 hashes, single-use), `account_locks`, `stepup_state` (5-min freshness), `security_events`, `security_alerts`, `security_prefs`, `record_access_log` | `revokeAllSessions`, `isAccountLocked`, `myAccessCutOff` (reads `company_members.login_disabled`), `logSecurityEvent` (row + `chain_log` event), TOTP setup/verify actions | `login_sessions` is the *shape* of the real session table but is written by simulated sign-in actions — no real token is ever validated against it. §5 reuses its vocabulary (device label, `revoked_at`, hash-only storage) for the real table under a new name, so staged rows are never mistaken for live sessions. TOTP/recovery/step-up are account-keyed by username and carry over unchanged once usernames are real. |
| **Companies / fleets** | `companies` (`owner_username`, `kind: fleet\|dispatch`), `company_members` (`username`, `role: owner\|dispatch\|driver`, `login_disabled`), `driver_codes` (company join codes), `client_fleets` | `myMembership`, `myRole`, `hosEditAccess`, fleet/dispatch gates in `fleetCreation.ts` / `dispatchCompany.ts` / `myDesk.ts` | Membership is username-keyed and survives auth intact. `company_members.login_disabled` ("Cut Off Access") must additionally revoke real sessions (§5.4) — today it only flips a flag that staged actions check. |
| **Portal accounts** | `shipper_accounts`, `broker_accounts` (both: `email`, `linked_username`, `owner_username`, `status` — **no credential columns at all**) | Portal actions via `brokerContext` / shipper equivalents | These are desk-managed records, not logins. Phase 1 ruling: they stay non-login records linked to a driver account by `linked_username`. Giving shippers/brokers their own logins is out of scope (Open Decision D6). |
| **Referrals** | `referral_codes` (PK `username`), `referral_links`, `referral_rewards`, `referral_milestones` | `myReferralCode`, `linkReferral`, `maybeAwardReferralReward` | Keyed by username; the signup hook (currently fired from `redeemBetaCode`) moves to account creation (§6.3). |
| **Mail transport** | — (no table; deliveries recorded in `doc_email_deliveries` / `team_change_notices.email_status`) | Privileged handlers in `privileged.ts`: `docEmailConfig`, `sendDocEmail` — Resend API, key + sender read from env at call time (`RESEND_API_KEY`, `DOC_EMAIL_FROM`); unconfigured ⇒ actions record mail as **queued**, never as sent | This is the mail path for invite + reset email (§6, §10-D1). On the standalone host `ctx.executePrivileged` collapses into direct `process.env` reads in the host process (per `DEPLOY.md` §2.4) — the *contract* (configured? / send / provider id back) stays identical. |
| **Hash chain** | `chain_log` (`prev_hash`, `hash`, SHA-256 linked) | `appendChain`, `logSecurityEvent`, `teamLog` | Auth audit events mirror into the chain exactly like security/team events do today (§8.4). The chain itself is global by design. |

### 1.5 What breaks, and the owner-resolution path it forces

1. **Every row in the database belongs to profile 1.** All (a)-shape rows carry the owner's current `social_username`; all (c)-shape private rows carry nothing. There is no query that can separate "mine" from "yours" for shape (c), and no second `profile` row can even be inserted without breaking the 63 hardcoded `id = 1` reads.
2. **The fallback identity is shared.** No profile row ⇒ username `"driver"`, plan `"diamond"`. Two fresh testers would collide on the same username and the same points/ledger keys.
3. **Admin is a global flag, not a person.** `isBetaOwner()` is true for *the install*, so in a multi-user build it would be true for *every caller* whose handler asks. Any design that ships sessions before replacing this check ships owner powers to all testers.
4. **Email identity is borrowed.** Team-invite redemption matches against `accountEmailFor` (a document-delivery address). A driver who never set doc-copy email cannot redeem — acceptable in staging, wrong for real invites. Accounts need their own authoritative email (§2).
5. **Owner-resolution path (required, in order):** (i) create the owner's account first, bound to profile 1 (§3); (ii) backfill every (a)-shape row's username stays valid because the owner's username does not change; (iii) backfill every (c)-shape *private* row to the owner's profile/username (§9); (iv) only then enable a second account. Skipping (iii) is the one migration error that cannot be undone quietly — unowned rows must default to the owner, never to "shared."

---

## 2. Account model

### 2.1 Principle: account ≠ profile

- **`accounts`** (new, §4.1) is the *credential + identity* record: who can sign in, with what email, in what state. It owns no app data.
- **`profile`** stays the *app-data* record: truck, plan, pay, settings. All 464 existing actions keep reading app data exactly as they do now.
- The link is one column: **`profile.account_id`** (§4.4). One account ↔ one profile (unique). `accounts` never duplicates plan/truck fields; `profile` never stores a password.

### 2.2 Email + password credentials

- **Sign-in identifier is email.** Username (`profile.social_username` / `social_users.username`) remains the in-app handle for chat, social, points, and ledgers — it is *derived at account creation* (§6.1), not a login credential.
- **Normalization (one function, used everywhere):** `trim()` → Unicode NFC → lowercase the whole address for the stored/lookup form. This matches the existing precedent: `team_invite_codes.email` is *"normalized lowercase at issuance"* and `teamPortal.ts` `normalizeInviteEmail()` is `trim().toLowerCase()`; `inviteEmailMatches()` compares normalized-to-normalized. Auth adopts the same rule so an invite issued to an address matches the account created with that address, byte-for-byte after normalization.
  - Store two columns: `email` (normalized, unique — the lookup key) and keep the as-typed form only in the invite row that issued it, never as a second account key.
  - Validation: the existing `isValidEmail()` shape check in `teamPortal.ts` is the floor; the host additionally requires a single `@`, a dotted domain, max 254 chars. Plus-addressing and Gmail-dot tricks are **not** folded — `a+b@x` and `a@x` are different accounts unless an invite says otherwise (folding them silently would break the email-bound invite guarantee).
- **Password hashing: Argon2id via Bun's password API.**
  - Hash: `Bun.password.hash(password, { algorithm: "argon2id" })` — Bun (runtime is Bun 1.3.10, per `package.json` `packageManager`) defaults Argon2id to memory-hard parameters (64 MiB / t=2 at time of writing); **pin the parameters explicitly in code** (`memoryCost`, `timeCost`) so a Bun upgrade never silently weakens new hashes, and record the parameter set version in the hash string itself — `Bun.password.hash` returns a PHC-format string (`$argon2id$v=19$m=…,t=…,p=…$…`) which is self-describing.
  - Verify: `Bun.password.verify(password, storedHash)` (constant-time in the library). If verify succeeds but the stored parameters are below the current pinned set, re-hash on that successful sign-in and update the row (transparent upgrade, audit event `password_rehash` with no detail beyond the fact).
  - Store **only** the PHC string in `accounts.password_hash`. Plaintext passwords never touch the database, logs, audit details, chain payloads, or error messages (§8.3). The agent/operator never sees or sets a user's password — resets are token flows (§6.4), support resets are consent flows (§1.4).
  - Portability note: PHC Argon2id strings verify identically under any Argon2id library, so the Phase 2 Postgres move and any future non-Bun verifier do not strand existing hashes. (The existing PIN hash — PBKDF2-SHA256 — is a separate, weaker, *device-local* credential and stays exactly where it is, on `profile.pin_hash`.)
  - Password policy: minimum 12 characters, maximum 128 (reject longer rather than truncating), no composition rules, checked against a bundled common-password denylist. No forced rotation.

### 2.3 Account states

`accounts.status`: **`invited | active | locked | disabled`**

| State | Meaning | Can sign in? | Entered by |
|---|---|---|---|
| `invited` | Row created by an invite (§6); no password set yet (`password_hash IS NULL`) | No — the invite token is the only key, and it leads to password-set, not to a session | Invite issuance |
| `active` | Password set; normal account | Yes | Invite redemption / owner claim / admin re-enable |
| `locked` | Temporary, automatic: too many failed sign-ins (§8.1). Carries `locked_until`; self-expires | No, until `locked_until` passes | Rate limiter only — never set by hand |
| `disabled` | Deliberate off-switch: owner/admin disable, team revocation, or company cut-off cascade. No expiry | No; all sessions revoked at the moment of disabling | Owner/admin action (audited), or `company_members.login_disabled` cascade |

State is checked **at session resolution on every request** (§5.3), not only at sign-in — a disabled account's live sessions die on the next request even if revocation missed one.

`accounts.is_owner` (boolean, default false) marks the platform owner's account. Exactly one row may carry it (enforced in the claim flow + a partial unique index where the dialect allows it, §4.5). This — not `beta_access` — is the long-term source of owner authority (§7.3).

### 2.4 The username bridge

At account creation the host derives the handle: invite/profile-supplied handle if free, else the email local-part sanitized to the existing handle rules, else suffixed. It is written **once** to `profile.social_username` and `social_users.username` in the same transaction as the profile row. After that, username is ordinary app data (the driver can change display/chat names through existing actions; the *account* never keys off a mutable field — all auth tables key off `accounts.id`).

---

## 3. The owner's account: first-run claim (profile 1 → x)

**Invariant: no default password ever exists, at any point, for any account — including the owner's.** There is no seeded credential, no "changeme", no env-var password.

### 3.1 Preconditions

Migration §9 steps 1–3 are done: `accounts` exists, profile 1 exists (or is created with today's defaults), `profile.account_id` column exists and is null everywhere.

### 3.2 Claim flow

1. **Arm (operator action, local/CLI only).** A one-off host CLI command (`bun run host/auth-claim.ts --arm`) runs **on the server, by whoever operates the deploy** — it is not an HTTP endpoint and is not reachable from the client. It:
   - refuses to run if any `accounts` row with `is_owner = true` already exists, or if profile 1 already has `account_id` set;
   - creates the owner `accounts` row in state `invited`, `is_owner = true`, with the owner's email **as supplied to the command** (normalized per §2.2) and `password_hash = NULL`;
   - mints a claim token: 32 bytes from `crypto.getRandomValues`, base64url-encoded; stores only its SHA-256 hash in `password_reset_tokens` with `purpose = 'owner_claim'` (§4.3), expiry **24 hours**, single-use;
   - prints the token **once, to the operator's terminal only**. It is never written to a file, a table (beyond its hash), a log, or an email. Delivery to x is out-of-band by the operator (in person / existing trusted channel) — the system deliberately has no channel for it.
2. **Claim (x, in the browser).** Claim page (host route, not an action): x enters the token + his email. Host checks: token hash matches, `purpose = 'owner_claim'`, unexpired, unused, and the entered email normalizes to the armed row's email (enumeration resistance §8.2 — failures are one generic message). On match, the same page takes his **new password** (§2.2 policy), hashes it with Argon2id, and in one transaction: sets `password_hash`, flips status `invited → active`, sets `profile.account_id` for profile id 1 to this account, burns the token (`used_at`), writes audit events `owner_claimed` + `password_set`, and mirrors both into `chain_log`.
3. **First sign-in** proceeds through the normal session flow (§5). The claim flow itself also issues a session (so x lands signed-in), with the same cookie rules.
4. **Expiry / loss:** an expired or lost token is re-armed by re-running the CLI, which invalidates any prior unused `owner_claim` token first. Because arming requires server access, token loss is an inconvenience, never a lockout and never a support-desk password reset.
5. **After claim:** the CLI refuses to arm again (owner exists). `beta_access` is then backfilled (§7.3) and `isBetaOwner`'s replacement reads `accounts.is_owner` for the session account.

---

## 4. Schema additions

Style rules, matching `schema.ts` exactly: `sqliteTable` from `drizzle-orm/sqlite-core`; `integer("…", { mode: "timestamp_ms" })` with `.$defaultFn(() => new Date())` for timestamps; `integer("…", { mode: "boolean" })` for booleans; snake_case column names; `integer("id").primaryKey({ autoIncrement: true })` for surrogate keys; uniqueness via `.unique()` on the column or a named `uniqueIndex` where composite. New migration numbers continue the existing sequence (last on disk: `0107_…`).

### 4.1 `accounts` (new)

```ts
export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Normalized (trim + lowercase) sign-in email — the lookup key.
  email: text("email").notNull().unique(),
  // PHC Argon2id string from Bun.password.hash. NULL while invited
  // (no password has ever been set — there is no default).
  passwordHash: text("password_hash"),
  // invited | active | locked | disabled  (§2.3)
  status: text("status").notNull().default("invited"),
  // The platform owner's account (profile 1). Exactly one row.
  isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
  // Failed-sign-in lockout (§8.1); locked_until self-expires the lock.
  failedSignins: integer("failed_signins").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
  lastSigninAt: integer("last_signin_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
```

Indexes: unique on `email` (column-level, above). Lookup by id is the PK. *Dialect note:* the "exactly one owner" rule wants `CREATE UNIQUE INDEX … ON accounts(is_owner) WHERE is_owner = 1` — SQLite supports partial indexes and Postgres supports them identically, so this one survives the dialect move unchanged; Drizzle expresses it via `uniqueIndex(...).where(...)` in pg-core and via raw SQL in the sqlite migration — write it as raw SQL in both migration sets to keep them semantically identical.

### 4.2 `auth_sessions` (new — the real session table)

Named `auth_sessions`, **not** `sessions` and not a reuse of `login_sessions`: `login_sessions` holds staged Security Pack rows (§1.4) and must never be trusted as live auth state. Its good ideas (device label, hash-only token, `revoked_at`) are carried over. On cutover, the Security Pack's device list reads from `auth_sessions` (a view/projection in the action layer: `device_label`, `created_at`, `last_active_at`, `revoked_at`), and `login_sessions` is left as historical staging data.

```ts
export const authSessions = sqliteTable("auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(), // → accounts.id (app-enforced; see §4.5)
  // SHA-256 hex of the opaque session token. The token itself is
  // never stored. High-entropy token ⇒ fast hash is correct here
  // (unlike passwords, §5.1).
  tokenHash: text("token_hash").notNull().unique(),
  deviceLabel: text("device_label").notNull().default(""),
  // Coarse client hint for the device list ("Android — Capacitor" etc.).
  userAgent: text("user_agent"),
  ipFirstSeen: text("ip_first_seen"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // Absolute expiry — never extended (§5.2).
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  // signin | claim | invite_accept — how this session was born.
  createdVia: text("created_via").notNull().default("signin"),
}, (t) => [
  index("auth_sessions_account_idx").on(t.accountId),
  index("auth_sessions_expires_idx").on(t.expiresAt),
]);
```

### 4.3 `password_reset_tokens` (new — resets **and** the owner claim)

One table, discriminated by `purpose`, so token hygiene (hash-only, single-use, short TTL) is implemented once:

```ts
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(), // → accounts.id
  // reset | owner_claim
  purpose: text("purpose").notNull().default("reset"),
  // SHA-256 hex of the token. Plaintext token exists only in the
  // email (reset) or the operator's terminal (claim), once.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), // reset: +60 min; claim: +24 h
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  // Set when a newer token supersedes this one (re-request, re-arm).
  supersededAt: integer("superseded_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [ index("pw_reset_account_idx").on(t.accountId) ]);
```

Issuing a token supersedes all prior unused tokens for the same `(account_id, purpose)`. Verification is a single indexed lookup by `token_hash` + state checks — failures are indistinguishable (§8.2).

### 4.4 `account_invites` (new) + existing-table changes

**`account_invites`** covers the *account-creation* invites. It deliberately does **not** absorb `team_invite_codes`: the team table is locked behaviour with its own audit trail (§1.4) and stays authoritative for seats. The two are distinguished by what redemption produces:

| | `account_invites` (new) | `team_invite_codes` (existing) |
|---|---|---|
| Redeemer | A person with **no account yet** (or an invited tester) | An **existing account** gaining a privilege |
| Produces | An `accounts` row + a `profile` row | A `team_seats` row on an existing account |
| Kinds | `tester` (closed test), `trial` (30-day trial, §6.3) | (single purpose: team seat; `role: developer\|support`) |
| Code shape | Link token (32-byte, hash-stored) — no typed code | Typed code `TEAM-XXXX-XXXX-XXXX` (existing `mintTeamInviteCode`) |
| TTL | `tester`: 14 days; `trial`: 30 days (owner-adjustable at issuance) | 7 days (`TEAM_INVITE_TTL_MS`, existing) |

A team-seat invite issued to an email with **no account** composes the two: the owner first issues an `account_invites` row (kind `tester`, flagged `grants_team_seat` intent recorded in `note`), the invitee creates the account, *then* redeems the `TEAM-…` code from inside it — exactly the email-match flow `teamRedeemInvite` already implements. Neither table ever reads the other (the existing namespace-separation rule in `teamRedeemInvite` — referral/beta codes refused by name — extends to invite tokens).

```ts
export const accountInvites = sqliteTable("account_invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // tester | trial
  kind: text("kind").notNull(),
  // Normalized email the invite is bound to. Redemption requires
  // creating the account under exactly this address.
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the link token
  // Entitlement granted on acceptance (see §6): tester → Diamond
  // during test; trial → plan recorded on the invite.
  grantPlan: text("grant_plan"), // diamond | gold | basic | null
  invitedByAccountId: integer("invited_by_account_id"), // → accounts.id (owner)
  note: text("note").notNull().default(""),
  // pending | accepted | revoked | expired  (expired derived from expires_at, as in teamInviteState)
  status: text("status").notNull().default("pending"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAccountId: integer("accepted_account_id"), // → accounts.id, set once
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [ index("account_invites_email_idx").on(t.email) ]);
```

One live (`pending`, unexpired) invite per `(email, kind)` — enforced in the issuance action by the same check-then-insert pattern `teamCreateInvite` uses today (refuse + name the live invite), not by a unique index, because expired/revoked history rows must be kept.

**Changes to existing tables:**

| Table | Change | Why |
|---|---|---|
| `profile` | **Add `account_id integer` nullable, unique** (`accountId: integer("account_id").unique()`). Backfilled for id 1 by the claim flow; set at creation for every new profile. All other `profile` columns unchanged. | The §2.1 link. Nullable only during migration; once §9 completes, every profile row must have one — enforced by a host startup check, not a DB `NOT NULL` (SQLite cannot add `NOT NULL` to an existing table without a rebuild; Postgres phase may rebuild it then). |
| `profile` | No change to `plan` semantics, but the **`normalizePlan` no-row default flips from `"diamond"` to `"basic"`** for any profile whose account is not the owner (code change in the auth phase, §7.2 — flagged here because it is a behaviour change hiding in a schema-adjacent default). | A missing row must fail closed, not premium. |
| Singleton tables (shape (b), §1.3) | `app_settings`, `learning_state`, `passport_prefs`, `security_prefs`(already username-keyed): **re-key from `id = 1` to `profile_id`** in their own migrations — new PK/FK column `profile_id integer NOT NULL UNIQUE`, backfill `1`, old `id` kept as an alias column for one release. `pin_guard` gains `account_id` (brute-force state is per-account once sign-in exists; the app-lock PIN guard itself stays per-profile). `beta_access` / `admin_settings` / `si_settings` / `app_health_settings` / `vault_keys`: **stay global** by ruling — beta gate is replaced (§7.3), the rest are operator/server state, owner-session-only. | Each singleton silently shared across drivers is a cross-account leak; converting them is mechanical because each is read through a small helper surface. |
| Shape-(c) private tables (§1.3) | **Add `profile_id integer` (nullable in migration, backfilled to 1, indexed)** to the private set — at minimum: `trips`, `trip_queue`, `loads`, `expenses`, `settlements`, `scale_tickets`, `personal_docs`, `dvir_reports`, `pretrip_inspections`, `reefer_checks`, `fuel_purchases`, `saved_places`, `recent_destinations`, `eld_connections`, `eld_identity`, `fleet_trucks`, `payment_packets`, `filed_doc_copies`, `load_doc_extractions/verifications/exceptions`, `pickup_extra_photos`, `trailer_swaps`, `pay_entries` is already username-keyed. The full classification list is a §9 deliverable, table by table. Shared tables (`chain_log`, intel/weigh/work-zone/hazard, market/EIA snapshots, `giveaway_cycles`, `chat_*` membership-scoped tables) get **no** owner column. | This is the largest migration in the phase and the one that makes per-account filtering (§5.3) possible for records that today have no owner at all. Username was *not* chosen for these: `profile_id` is stable across handle changes and matches the `profile.account_id` link direction. |

### 4.5 `auth_audit_log` (new)

Distinct from `team_audit_log` (team-portal actions) and `security_events` (device security pack): this log is the **auth system's** record — append-only, never updated, never deleted.

```ts
export const authAuditLog = sqliteTable("auth_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id"), // subject account; null when the attempt named no account (enumeration-safe logging, §8.2)
  actorAccountId: integer("actor_account_id"), // who did it, when different (admin disable, owner issuance)
  // signin_ok | signin_fail | signin_locked | signout | session_revoked |
  // password_set | password_change | password_rehash | reset_requested |
  // reset_completed | invite_issued | invite_accepted | invite_revoked |
  // owner_claim_armed | owner_claimed | account_disabled | account_enabled |
  // trial_started | trial_expired  (§8.4 — full list)
  event: text("event").notNull(),
  // Short factual detail. NEVER a password, token, full invite code,
  // or seed material (§8.3). Masked email / masked code forms only,
  // following the teamLog precedent (codes are never written in full).
  detail: text("detail").notNull().default(""),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  index("auth_audit_account_idx").on(t.accountId),
  index("auth_audit_event_idx").on(t.event),
]);
```

Every row also mirrors into `chain_log` via the existing `appendChain` with `event = "auth_event"` and the same redacted payload — the pattern `logSecurityEvent` and `teamLog` already established.

**Foreign keys:** the existing schema declares **no** Drizzle relations and no SQL FK constraints (joins are app-level, e.g. `myMembership` loads and matches in code). The new tables follow suit — `account_id` / `profile_id` are plain indexed integers, integrity enforced by the host's auth layer + startup checks. *Dialect note:* this is also the Postgres-friendly choice — §5 of `DEPLOY.md` already requires regenerating migrations for pg-core; adding real FKs there is a separate, optional hardening step, not a Phase 1 dependency. Timestamp/boolean encodings (`timestamp_ms` integers, 0/1 booleans) are the two dialect-sensitive conventions to convert mechanically (`bigint`/`timestamptz`, `boolean`) in that same pass; nothing in this design depends on either encoding.

---

## 5. Session model

### 5.1 Token

- On sign-in (or claim / invite acceptance), the host generates **32 bytes from `crypto.getRandomValues`**, base64url-encoded (43 chars). That string is the session token — opaque, no payload, no JWT.
- Only `SHA-256(token)` (hex) is stored (`auth_sessions.token_hash`, unique). A database leak yields no usable sessions. A fast hash is correct here precisely because the token has 256 bits of entropy — the opposite trade-off from passwords (§2.2).
- Optional hardening (host env, name only): `AUTH_TOKEN_PEPPER` — if set, the stored hash is `HMAC-SHA256(pepper, token)`. Recommended on Render; harmless locally.

### 5.2 Cookie + lifetimes

Cookie name: **`sm_session`**. Attributes on every issue/renewal:

```
Set-Cookie: sm_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<remaining absolute lifetime>
```

- `HttpOnly` always (no client JS reads the token — the client SDK shim sends it implicitly; this also keeps the Capacitor WebView wrapper working, since the AAB loads `app.stonervision.io` as a remote URL and cookies ride along natively).
- `Secure` always in any deployed environment; the Phase 1 local proof may omit it **only** on `localhost` and only behind a host env flag (name only: `AUTH_ALLOW_INSECURE_LOCALHOST`).
- `SameSite=Lax` — the app is same-origin (client + `./actions` on one host); `Strict` was considered and rejected because emailed invite/reset links must land signed-in-able on first navigation.
- **Absolute lifetime: 30 days** from creation (`auth_sessions.expires_at`), never extended. **Idle/sliding renewal:** `last_active_at` updates at most once per hour per session; if a session is active on day 29 it still dies on day 30 — sliding applies to the *idle timeout*, not the absolute cap: a session unused for **7 days** is treated as expired at resolution even before `expires_at`. (Lifetime values are Open Decision D3 — these are the recommended defaults.)
- No token in URLs, `localStorage`, or action payloads, ever. The one exception path: if a future native wrapper cannot persist cookies, it may send the same token as an `Authorization: Bearer` header — the host accepts it through the identical hash lookup, and the session row records nothing different. Cookie remains the primary and only Phase 1 mechanism.

### 5.3 Resolution: request → session → account → profile (where `ctx` gains the viewer)

Auth lives in the **host shim** (`host/server.ts`, per `DEPLOY.md` step 4), not in `actions.ts`:

1. Host receives `POST /actions` (or any `/auth/*` route) with the `sm_session` cookie.
2. Host hashes the presented token, looks up `auth_sessions` by `token_hash`. Reject (treat as anonymous) if: no row, `revoked_at` set, past `expires_at`, idle > 7 days, **or the joined `accounts` row is `locked` (and `locked_until` has not passed) or `disabled`**.
3. Host loads `accounts` → finds `profile` by `profile.account_id` → obtains `profile.id` and `profile.social_username`.
4. Host constructs `ctx` exactly as the shim already must (per `DEPLOY.md` §2.1: shim-built Drizzle handle for `ctx.db()`, plus `blobs`, `invalidateQueries`, `executePrivileged`, `inference`) and adds **one new field**: `ctx.viewer = { accountId, profileId, username, isOwner, status }`.
5. The actions module is adapted at exactly two choke points, so **handlers keep calling `ctx.db()` unchanged** and 464 handlers need no signature changes:
   - `myUsername(ctx)` → returns `ctx.viewer.username` (fallback `"driver"` retained *only* for the pre-auth staging mode, §9 step 2, behind the same host flag that permits anonymous staging access locally).
   - `myPlan(ctx)` and the 63 direct `profile.id = 1` reads → read `ctx.viewer.profileId`. This is a mechanical sweep with a lint rule at the end: **no literal `profile.id, 1` may remain in `actions.ts`** except the claim/backfill code itself.
   - Per-account filtering for shape-(c) tables (§4.4) keys off `ctx.viewer.profileId`; shape-(a) tables key off `ctx.viewer.username`. Shared tables stay unfiltered by design.
6. **Unauthenticated requests:** once multi-account mode is on (§9 step 6), the host refuses `/actions` calls without a valid session — except the small public allowlist (§6 routes + existing public verify-code lookups, which are capability-URL style today via `verify_codes`). The refusal is at the host, so a forgotten gate inside an action cannot leak data.

Auth endpoints themselves (`/auth/signin`, `/auth/signout`, `/auth/request-reset`, `/auth/reset`, `/auth/claim`, `/auth/accept-invite`) are **host routes, not `defineAction`s** — they must run *before* a session exists, set cookies, and be rate-limited independently of the action dispatcher (§8.1).

### 5.4 Revocation

Setting `auth_sessions.revoked_at` (resolution rejects revoked rows immediately — no cache in Phase 1):

| Trigger | Scope |
|---|---|
| Sign-out (self) | That session only |
| "Sign out everywhere" (self; the Security Pack already promises this semantic over `login_sessions`) | All of the account's sessions |
| Password change (self, authenticated) | All **other** sessions; the changing session survives |
| Password reset completed (§6.4) | **All** sessions, including any the requester holds |
| Owner/admin disables the account (`status → disabled`) | All sessions, at the moment of the status write (same transaction) |
| Team seat revoked (`teamRevokeSeat`) | **Not** the account's sessions — a seat is a privilege, not the login. (Existing behaviour preserved.) |
| Company cut-off (`company_members.login_disabled` set) | All sessions of that member — the flag's existing comment already promises *"the member's login is disabled and all their sessions revoked"*; auth makes it literally true |
| Consent-applied password reset (`teamApplyConsent`, §1.4) | All sessions (it calls the §6.4 completion path) |
| Absolute/idle expiry | No write needed — resolution rejects; a nightly host job hard-deletes rows expired > 30 days for table hygiene |

---

## 6. Invite + onboarding flows

### 6.1 (a) Closed-test tester invite — the 12+ tester path

Requirement (goal record): closed testing needs **12+ testers with their own accounts for 14 days**; the Founding Tester offer is **Diamond during the test, Gold free for a year after launch** for testers who complete the 14 days.

1. **Issue (owner, signed in as owner).** Owner enters the tester's email in the invite desk (new host-backed action surface, owner-session-gated, mirroring `teamCreateInvite`'s shape). Host: normalizes email, refuses if a live `tester` invite exists for that email (same rule as `teamCreateInvite`), refuses if an `active` account already owns that email, inserts `account_invites` (`kind = tester`, `grant_plan = diamond`, TTL 14 days), audit `invite_issued`, and emails the accept link via the Resend transport (§1.4) — link carries the plaintext token once; only its hash is stored. If mail is unconfigured, the invite is recorded **queued** and the owner is shown the link once in-app to deliver himself — the same honest-staging posture as `notifyTeamChange`.
2. **Accept (tester, no account yet).** Link → host route validates token hash + state → tester sets a password (§2.2) → one transaction: create `accounts` (`status = active`, `email_verified_at = now` — possession of the emailed token *is* the verification), create `profile` row (new id, today's lazy defaults, `plan = diamond`, `account_id` set), create `social_users` row with the derived username (§2.4), mark invite `accepted` (+ `accepted_account_id`), audit `invite_accepted`, issue a session (`created_via = invite_accept`).
3. **Entitlement bookkeeping (no new billing machinery).** Founding Tester standing is recorded as a `subscription_events`-style entitlement row is **not** the right fit (that table is payment-keyed, `payment_ref` unique, House Rules 1–2 apply to *settled payments*) — instead: `account_invites.kind = tester` + acceptance timestamp is the durable record; a small derived rule in the standing helpers (`accountStanding.ts` family) computes: *tester & accepted ≥ 14 days ago & still active at launch ⇒ Gold entitlement for 12 months from launch*. The Diamond-during-test period is simply `profile.plan = diamond` until the owner flips testers at launch (a bulk owner action, audited per account). Completion of the 14 days is measured from `accepted_at` + session activity (`auth_sessions.last_active_at` presence across the window) — the exact completion rule is Open Decision D4.
4. **Google Play side stays separate:** the Play Console closed-track tester list (Google accounts) is an owner task in the Console; the in-app invite does not replace it, and the two lists are reconciled by email — which is precisely why the invite is email-bound.

### 6.2 (b) Team-seat invite — locked rules, unchanged

The flow is the existing one (§1.4) and this design changes only its foundations:

- Issuance stays **owner-only** — and "owner" now means *a session whose `accounts.is_owner` is true*, replacing `canManageTeamSeats = isBetaOwner(ctx)` (§7.3). `teamCreateInvite`'s act of issuance remains **the owner's approval action itself**; there is no second approver and no self-serve path.
- `teamGrantSeat` continues to refuse every caller. No new grant path is added anywhere in this design.
- Redemption stays: single-use `TEAM-…` code, 7-day TTL, email match — but the match now reads **`accounts.email`** (authoritative, normalized at account creation) instead of `accountEmailFor`'s doc-copy fallback chain. `accountEmailFor` remains for *notices*; invite matching moves to the account row. This fixes §1.5.4 without changing any visible rule.
- Audit stays: `teamLog` rows + `chain_log` mirrors for issue/redeem/revoke, exactly as today, **plus** the corresponding `auth_audit_log` rows when an invite creates an account (§6.1). Seat revocation behaviour is unchanged (§5.4).

### 6.3 (c) Beta codes + trial codes — recommendation: **replace the gate, keep the codes' jobs separated**

Current tangle: `beta_codes`/`beta_access` gate *the whole install* (singleton), trial-by-email exists only as a goal-record rule ("trial codes run 30 days via email, then Basic"), and referral codes (`MILE-REF-…`) ride along in `redeemBetaCode`. In a multi-account world an install-wide gate is meaningless. Recommendation:

- **Replace** `beta_access` (singleton) as a gate. Per-account beta standing becomes two columns' worth of fact on the account's record: derive it from (i) the account's invite kind (`tester` ⇒ beta tester), and (ii) a new per-account redemption record — reuse `beta_codes.used_by` (already per-user!) and drop the singleton write from `redeemBetaCode`: redemption marks the code used by *this* username and grants *this* account its `account_kind`. `getBetaStatus` keeps its response shape, sourced per-account; `isBetaOwner` is re-sourced per §7.3 and the singleton row is frozen as history.
- **Keep** `beta_codes` as the code stock (owner-minted `MILE-…` driver codes remain a valid *account-creation* alternative during closed test: redeeming one at signup = the §6.1 accept flow with the code typed instead of a link token). Add `.unique()` to `beta_codes.code` in the same migration (minting already checks uniqueness in code; the constraint makes it structural).
- **Trial codes become `account_invites` kind `trial`** — not a third code family. A trial is issued to an email (per the locked rule), lives 30 days to redeem *and* the trial itself runs 30 days from acceptance (recorded on the invite + mirrored as `profile`-level standing with an expiry the standing helpers already know how to honour — cf. retainers/holds in `accountStanding.ts`), then the account drops to **Basic** automatically at resolution time (plan derivation checks trial expiry; no cron needs to rewrite the row). "Trial ended → Basic" never deletes data, points, or records (retention rules in `points_log` comments already forbid tier-based wipes).
- **Referral codes are untouched** — they were never an access mechanism; `linkReferral` simply moves its call site from `redeemBetaCode` to account creation (invite accept + code signup both call it).

### 6.4 Password reset (self-serve)

1. `POST /auth/request-reset { email }` → **always** the same response, whether or not the email exists (§8.2). If it exists and the account is `active`: supersede prior reset tokens, mint a 60-minute token (§4.3), email the link via Resend, audit `reset_requested` (account id recorded; for unknown emails, `account_id = NULL` + masked-email detail only).
2. Link → `POST /auth/reset { token, newPassword }` → validate hash/state/expiry → Argon2id-hash the new password → burn token, clear `failed_signins`/`locked_until`, revoke **all** sessions, audit `reset_completed` (+ chain mirror), land on the sign-in page (no auto-session — the user proves the new password by using it).
3. If mail is unconfigured (pre-go-live staging), reset email is recorded queued exactly like other mail — and the owner can complete a reset for a *tester* only through the consent flow (§1.4), never by learning or setting the password himself in plaintext anywhere.

---

## 7. Authorization mapping: tiers + seats over real accounts

### 7.1 Where tier checks live today

Tier authority is `profile.plan` read through `myPlan(ctx)` → `normalizePlan`, with two pure gates in `actions.ts`: `isDiamondPlan` (`diamond | owner`) and `isGoldPlan` (`gold | diamond | owner`). Call sites (representative, all via `hasDiamondAccess(ctx)` / `myPlan` / direct `isDiamondPlan(plan)`): ELD management (`eldManageGate` — premium **and** solo-or-company-owner), AI learning opt-in, copilot/advisor surfaces, stats/map premium layers, My Desk and broker-desk access (`brokerContext` also admits company `owner`/`dispatch` roles), HOS edit rights (`hosEditAccess` — role-derived, not tier-derived), points earning class (`earningClass.ts`: paid-tier vs free-tier rates, sealed-miles cohorts), money-exit gates (`accountStanding.ts`: conversion/cash-out refused on Basic by design). Team overlay `account_admin.tier` can override a shell's displayed tier but does not drive these gates.

**Nothing about the check *sites* changes.** What changes is the *subject*: `myPlan` reads the **session profile's** plan instead of profile 1's.

### 7.2 Tier semantics per account (locked pricing, unchanged)

| Tier | Price (locked) | Stored as | Notes under auth |
|---|---|---|---|
| Basic | FREE | `profile.plan = basic` | The fail-closed default: **new profiles are created `basic`**, and `normalizePlan`'s no-row fallback becomes `basic` for non-owner accounts (§4.4). Testers/trials are *explicit grants* of a higher plan, never defaults. |
| Gold | $9.99/mo · $99/yr | `gold` | Founding Tester post-launch year (§6.1) lands here as an entitlement, not a payment. |
| Diamond | $19.99/mo · $199/yr | `diamond` | Owner-plan drivers get Diamond features via `isDiamondPlan(owner) = true` — the existing rule already encodes "drivers under an Owner plan get Diamond included"; under auth this reads correctly per-driver because a fleet driver's own standing is resolved through their company membership + the fleet's plan record, **not** because they share the owner's profile row. ⚠️ Migration watch-item: today that inclusion works *by accident* (one shared row reads `owner`). The per-account equivalent — membership-based Diamond inclusion — must be explicitly implemented in `hasDiamondAccess` (session username → `company_members` → fleet owner's plan) before testers join fleets, or fleet drivers silently drop to their own row's plan. |
| Owner / Fleet | $49.99/mo up to 3 trucks · $499/yr · +$9.99/mo per extra seat | `owner` + `profile.owner_trucks` / `owner_seats` | Fleet size stays on the owner's profile; roster counting (`countFleetRosterSeats` over `company_members`) is already username-based and carries over. |

Billing remains **staged until app-store release** — `setPlan` continues to *record* choices (it is the staging stand-in for settled payments, per its own comments and House Rules 1–2/4–5); auth does not turn on charging. Trial/tester entitlements never write `subscription_events` rows (§6.1.3).

### 7.3 Owner authority: `isBetaOwner` → `accounts.is_owner`

- Today: `canManageTeamSeats`, the beta panel, and owner surfaces gate on the global `beta_access` row. Under auth, each gate's question becomes *"is the **session account** the owner?"* — `ctx.viewer.isOwner`, sourced from `accounts.is_owner`.
- Transition: at owner claim (§3), backfill `beta_access` stays as-is (history); a compatibility shim implements `isBetaOwner(ctx)` as `ctx.viewer.isOwner || (staging-anonymous mode && legacy beta_access check)` during §9 steps 2–5, and the legacy branch is deleted at step 6. No handler call site changes — only the helper's body.
- Team seats (`team_seats`, by username) are orthogonal to tiers: a seat grants Team Portal access (shells only, behind the existing sensitive wall in `teamPortal.ts`), never Diamond, never company rights. That separation is preserved verbatim.

### 7.4 What a real caller changes, concretely

- **Self-scoping becomes real:** actions that today `.find()` over whole tables (`myMembership` over all `company_members`, `myAccessCutOff`, `knownAccountUsernames` unions) keep working functionally but must be audited for the inverse leak — actions that *list* (chat members, company rosters, board, social directory) now genuinely list *other people*. Each list action's existing membership/company scoping becomes load-bearing instead of decorative; the §9 classification pass (§1.3c) includes a per-action "who may see these rows" check for the ~40 list-shaped actions.
- **The Team Portal wall becomes real:** `accountShellFor`'s shell-only column discipline (no Pay Book, stubs, documents, hashes, keys — enforced by `FORBIDDEN_SHELL_KEY_PARTS`) was written for this moment; with real seats it is the actual privacy boundary and must not be widened during the auth work.
- **Consent windows become real:** `team_item_consent_windows` (one item, one seat, 30 min, view-first) finally binds two different people. No design change — only the session check that the approver is the item's owner, which `myUsername` fakery previously made tautological.

---

## 8. Security requirements

### 8.1 Rate limiting (host-level, per §5.3 — before the action dispatcher)

| Endpoint | Limit (recommended defaults) | Enforcement |
|---|---|---|
| `POST /auth/signin` | 5 failures / account / 15 min ⇒ `status = locked`, `locked_until = +15 min` (mirrors the existing PIN-guard precedent: 5 fails → 15 min, `pin_guard`); plus 20 attempts / IP / 15 min regardless of account | Counters in `accounts.failed_signins` + a host in-memory IP window (Phase 1); Phase 2 may move IP windows to a shared store — the account lock must stay in the DB so it survives restarts |
| `POST /auth/request-reset` | 3 / account / hour; 10 / IP / hour | Excess requests return the standard response and send nothing |
| `POST /auth/reset`, `/auth/claim`, `/auth/accept-invite` | 10 token attempts / IP / 15 min | Token failures are cheap to count; lockout is per-IP so a burned token can't be brute-forced |
| Invite issuance (owner) | 50 / day / owner (sanity bound, audited) | Prevents a hijacked owner session from spamming invites unnoticed |

Successful sign-in resets `failed_signins`. Lock state is revealed **only** as the generic sign-in failure (§8.2) — the account holder learns of the lock from the `security_alerts` row written at lock time (existing table, kind `account_locked`), visible after they next get in.

### 8.2 Enumeration resistance

- Sign-in: one message for unknown email, wrong password, locked, disabled, and invited-not-yet-claimed — *"Email or password doesn't match."* Timing: on unknown email, run `Bun.password.verify` against a **precomputed dummy Argon2id hash** so the response time doesn't disclose existence.
- Reset request: identical response + identical timing envelope for known/unknown emails (§6.4).
- Invite accept / claim / reset token failures: one generic *"This link isn't valid — it may have expired or already been used."* for unknown, expired, used, and superseded tokens alike.
- No endpoint returns whether an email "already has an account" except inside an authenticated owner session (invite desk, where the owner supplied the email) — the same posture `teamCreateInvite` already takes.

### 8.3 Hygiene

- **Reset/claim/invite tokens:** 256-bit, hash-only at rest, single-use (`used_at` burn in the same transaction as the effect), short TTLs (reset 60 min, claim 24 h, invites §4.4), supersede-on-reissue. Plaintext exists only in the one email / one terminal print.
- **No secret logging:** passwords, tokens, full invite codes, and session tokens are never written to `auth_audit_log.detail`, `chain_log` payloads, `security_events`, server logs, or error responses. The `teamLog` precedent — *"the code itself is NEVER written to the audit detail"* — is adopted as a blanket auth rule; masked forms (`maskTeamInviteCode`, `maskInviteEmail` in `teamPortal.ts`) are the only permitted representations.
- **Session fixation:** a fresh token is minted at every privilege transition — sign-in, claim, invite acceptance, password change/reset completion (revoke-all + the user signs in fresh), and trial/tester entitlement changes do **not** reuse a pre-auth token. Any anonymous staging cookie is discarded at sign-in. The host never accepts a client-proposed session id.
- **CSRF posture:** `SameSite=Lax` + same-origin app + state-changing calls only via `POST /actions` with a custom header required by the client shim (the typed client already POSTs JSON; the shim adds a fixed `X-Stonemiles-Client` header the host checks on cookie-authenticated mutations). Documented as Phase 1 posture; a full CSRF token is a Phase 2 hardening candidate, not a closed-test blocker.
- **Transport/storage:** HTTPS everywhere deployed (`Secure` cookie, §5.2); Argon2id PHC strings and token hashes are the only credential material in the DB; env-held secrets stay env-held (names in `render.yaml`: `RESEND_API_KEY`, `DOC_EMAIL_FROM`, `STRIPE_SECRET_KEY`, …) — the host reads them via `process.env` directly once `executePrivileged` collapses (§1.4), with the same never-return-to-client rule `privileged.ts` documents today.

### 8.4 Audit events that must be recorded (`auth_audit_log` + `chain_log` mirror)

`signin_ok`, `signin_fail` (account id when known, else null + masked email), `signin_locked`, `signout`, `session_revoked` (with scope: self / all / admin / cascade), `password_set` (first set via invite/claim), `password_change`, `password_rehash`, `reset_requested`, `reset_completed`, `invite_issued`, `invite_accepted`, `invite_revoked`, `owner_claim_armed`, `owner_claimed`, `account_disabled`, `account_enabled`, `trial_started`, `trial_expired`, `tester_completed_14d` (when the §6.1 rule fires). Team-seat events continue to live in `team_audit_log` (existing) — auth does not duplicate them, it cross-references by username/timestamp.

---

## 9. Migration plan — single-user staging → multi-account

Ordered; each step is independently shippable and the live artifact is never touched (all work is in the standalone tree, per the re-platform ruling).

1. **Schema first, behaviour unchanged.** Add §4 tables + `profile.account_id` + singleton re-keying columns (§4.4) as new migrations (`0108_…` onward) against the standalone SQLite copy. Run against a scratch DB; verify the existing 464 actions still answer with the staging identity path. *Rollback: drop the new tables/columns — nothing reads them yet.*
2. **Host viewer plumbing, staging-compatible.** Host shim resolves `ctx.viewer`: with no cookie and the local-staging flag on, it injects the legacy viewer (profile 1) so local proof continues to work end-to-end. Sweep `myUsername` / `myPlan` / the 63 `profile.id = 1` reads to `ctx.viewer` (§5.3.5); add the lint rule. *Rollback: the flag restores literal staging behaviour; the sweep is behaviour-identical while only profile 1 exists.*
3. **Owner claim.** Ship the claim CLI + claim route; run the backfill classification for shape-(c) tables (§1.3): produce the table-by-table ruling (private ⇒ add `profile_id`, backfill `1`; shared ⇒ no column), apply it, and verify row counts + chain verification (`computeChainVerification` must pass on the migrated copy, per `DEPLOY.md` §5.3's spot-check rule). x performs §3 claim. **Gate: no second account may be created before this step completes.**
4. **Auth routes live (owner-only at first).** `/auth/*` routes + session resolution enforced for the owner's account; staging-anonymous mode still available *only* on localhost. Verify: owner signs in/out, password change revokes other sessions, disable ⇒ next request refused.
5. **Invites on.** Tester invite flow (§6.1) + team-invite email source switched to `accounts.email` (§6.2) + beta-gate replacement (§6.3) + trial invites. Founding Tester entitlement rule wired into standing helpers. Invite a **single** pilot tester; walk §6.1 end-to-end including the Play closed-track email match.
6. **Multi-account mode on.** Anonymous `/actions` refused (allowlist §5.3.6 only); `normalizePlan` fallback → `basic`; fleet-Diamond inclusion implemented per §7.2; list-action scoping audit (§7.4) signed off. Open invites to the full 12+ tester cohort.
7. **Phase 2 carry-over (Render + Postgres).** pg-core conversion per `DEPLOY.md` §5 — the §4 schema converts mechanically (PHC hashes, token hashes, normalized emails, and partial-index owner rule all port as-is); sessions/tokens/in invites are re-issued at cutover rather than migrated (all testers simply sign in again — state this in the cutover note so it isn't mistaken for data loss).

**Rollback (general):** every step before 6 is reversible by configuration (staging flag) or by additive-schema abandonment (new tables are unread by old code). Step 6's rollback is the staging flag plus keeping profile 1's data untouched — multi-account rows created during a pilot are additive (new profile ids) and can be quarantined by disabling those accounts (`status = disabled`) without touching the owner's history. The one irreversible act is the §3 claim binding profile 1 to the owner's account — which is the intent, and is itself recoverable by the operator clearing `profile.account_id` + `is_owner` on the server if x is ever locked out (server access is the root of trust, by design).

---

## 10. Open decisions for the owner (x)

| # | Decision | Recommendation in this design | Why it's x's |
|---|---|---|---|
| **D1** | **Password-reset / invite email readiness.** Resend is wired as a privileged handler (`RESEND_API_KEY`, `DOC_EMAIL_FROM`) but mail is still staged/queued until go-live. Do invite + reset emails go live with the closed test, or do testers get links hand-delivered while mail stays queued? | Design works either way (queued ⇒ owner-delivered links); going live is smoother for 12+ testers. | Sending real mail from the team address is a public-facing go-live act. |
| **D2** | **Closed-test registration: invite-only, or open self-registration** (anyone with the AAB can create an account, owner approves)? | Invite-only (§6.1) — matches the email-bound Play tester list and the Founding Tester offer's need to know exactly who the testers are. | It's a policy call about who gets in, and it shapes the signup UI either way. |
| **D3** | **Session lifetime preference:** 30-day absolute / 7-day idle (recommended) vs. longer (90-day, fewer re-logins on the road) vs. shorter for team seats. | 30 / 7 for drivers; team seats inherit the same (their portal wall is the protection, not the clock). | Road usability vs. lost-phone risk is the owner's trade-off to set. |
| **D4** | **Founding Tester "completes the 14 days" rule:** calendar days since acceptance, or days with actual app activity (sessions/trips)? And who flips testers from Diamond-at-test to Gold-year at launch — automatic rule or owner's manual pass? | Activity-based (a session on ≥ 10 of the 14 days) with an owner-visible completion list before any flip. | It defines what testers were promised; changing it later would break the offer. |
| **D5** | **Trial shape:** trial invites grant which plan (Diamond, to show the full app, or Gold), and does the 30-day trial require a beta/trial code at all once public signup exists post-launch? | Diamond for 30 days, then Basic (per the locked trial rule). | Trial generosity is a growth/pricing call. |
| **D6** | **Shipper/broker portal logins:** `shipper_accounts` / `broker_accounts` have no credentials today. Do portals get their own sign-ins in a later phase, or stay desk-linked records permanently? | Out of Phase 1 scope either way (§1.4); deciding now prevents the account model from being bent around them later. | It commits a whole second user class. |
| **D7** | **2FA at sign-in:** the Security Pack already has TOTP + recovery codes per username. Does password sign-in require TOTP for (a) the owner, (b) team seats, (c) everyone, at closed-test launch — or is TOTP left as today's optional in-app layer? | Require for owner + team seats at launch; optional for drivers. | Security posture on the highest-privilege accounts is the owner's call. |

---

*End of design. Implementation order, when approved, is §9 as written. No file other than this document was created or modified.*
