/**
 * TEAM PORTAL — pure rules module (x, 2026-10-30).
 *
 * The Team Portal is the platform-level developer / support desk:
 * named team seats only, separate from every company owner/dispatch
 * seat. The team fixes ACCOUNT-level problems — tier, seats, a stuck
 * (locked) account, beta/trial access, shipper & broker portal
 * accounts, invites — and nothing else.
 *
 * SEAT ACCESS (owner's lock, 2026-10-30): the owner is the ONLY seat
 * holder until he approves an addition. New seats come ONLY from
 * owner-issued single-use TEAM INVITE CODES tied to a specific email
 * (see the invite section below) — direct grants by username are
 * closed, and no other code type can ever grant a seat.
 *
 * THE WALL (the whole point of this module): a team-facing "account
 * shell" carries ONLY these fields — username, display name, email,
 * account type, tier, company, fleet seats, account status, beta
 * access, signup date. Pay Book entries and totals, pay stubs,
 * documents/photos and filed copies, load paperwork contents,
 * chat/messages, passwords and PIN hashes, wallet keys, seed phrases,
 * and payment credentials are NEVER part of a shell: the actions layer
 * builds shells through `buildAccountShell` below, which copies a
 * fixed whitelist of fields out of its inputs, and the test suite
 * proves a shell can never carry a forbidden key even when the input
 * rows are stuffed with sensitive fields. Enforcement is server-side
 * by construction — the sensitive columns are never selected into a
 * shell, not merely hidden in the UI.
 *
 * There is no impersonation anywhere in the portal: no function here
 * or in the actions layer signs anyone in as another user.
 *
 * TEAM CONTACT EMAIL (owner, 2026-10-30): the Stonervision team's own
 * mailbox is stonervisionteam@gmail.com — THE team email. It is the
 * address recorded as the team's own wherever the app records a team
 * email: team notices are addressed from/for the team under it,
 * seat-invite issuance is recorded under it, and consent-session
 * closeouts are addressed from it. It is SEPARATE from the owner's own
 * account email (the owner's account keeps its own address) and from
 * ruggsllc7@gmail.com, which stays for RUGGS LOGISTICS only and is never used as a
 * team address. Email transport stays in its staged state — notices
 * queue honestly while no provider is connected; recording and using
 * this address does not change transport.
 */

export const TEAM_CONTACT_EMAIL = "stonervisionteam@gmail.com";
export const TEAM_CONTACT_NAME = "Stonervision Team";

/** The one-line team contact footer used in every team email body and
 *  notice: names the team's own mailbox so a user who gets a team
 *  notice knows exactly which address speaks for the team. Its role
 *  label (owner's wording, 2026-10-30) is "Stonervision team —
 *  brokers, shippers & help" — the same label the Broker Portal and
 *  Shipper Portal access doors and the help/support contacts carry. */
export function teamContactFooter(): string {
  return `Team contact — Stonervision team — brokers, shippers & help: ${TEAM_CONTACT_NAME} <${TEAM_CONTACT_EMAIL}> — this is the Stonervision team's own mailbox, covering brokers, shippers & help.`;
}

/** True when an address IS the team mailbox (case-insensitive). */
export function isTeamContactEmail(address: string | null | undefined): boolean {
  return (address ?? "").trim().toLowerCase() === TEAM_CONTACT_EMAIL;
}

export type AccountShellInput = {
  username: string;
  displayName: string | null;
  email: string | null;
  /** team | owner | dispatch | driver — resolved by the caller from
   *  the account's real records (team seat, company role, beta kind). */
  accountType: string;
  /** basic | gold | diamond | owner (already normalized). */
  tier: string;
  companyName: string | null;
  trucks: number | null;
  dispatchSeats: number | null;
  /** The team overlay said "suspended". */
  adminSuspended: boolean;
  /** A login lock is on the account (account lock row or a company
   *  member login cut-off). */
  locked: boolean;
  /** Beta / trial access: true granted, false revoked, null never set
   *  either way that the records can tell. */
  betaAccess: boolean | null;
  signupAt: Date | null;
};

export type AccountShell = {
  username: string;
  displayName: string;
  email: string | null;
  accountType: string;
  tier: string;
  companyName: string | null;
  trucks: number | null;
  dispatchSeats: number | null;
  status: "active" | "locked" | "suspended";
  betaAccess: boolean | null;
  signupAt: string | null;
};

/** The ONLY keys a team-facing account shell may ever carry. */
export const ACCOUNT_SHELL_KEYS = [
  "username",
  "displayName",
  "email",
  "accountType",
  "tier",
  "companyName",
  "trucks",
  "dispatchSeats",
  "status",
  "betaAccess",
  "signupAt",
] as const;

/** Substrings that must never appear in a shell key — the sensitive
 *  domains the team can never touch. The test suite asserts every
 *  shell key is clean against this list. */
export const FORBIDDEN_SHELL_KEY_PARTS = [
  "pay",
  "stub",
  "doc",
  "blob",
  "photo",
  "chat",
  "message",
  "password",
  "pin",
  "hash",
  "wallet",
  "seed",
  "key",
  "card",
  "bank",
  "ein",
  "ssn",
  "token",
  "balance",
  "amount",
  "rate",
  "bol",
  "pod",
] as const;

/** Build the account shell from its resolved parts. Copies ONLY the
 *  whitelisted fields — anything else on the input object (a caller
 *  bug stuffing a full DB row in) is dropped here, by construction. */
export function buildAccountShell(input: AccountShellInput): AccountShell {
  const status: AccountShell["status"] = input.adminSuspended
    ? "suspended"
    : input.locked
      ? "locked"
      : "active";
  return {
    username: input.username,
    displayName: input.displayName?.trim() ? input.displayName : input.username,
    email: input.email,
    accountType: input.accountType,
    tier: input.tier,
    companyName: input.companyName,
    trucks: input.trucks,
    dispatchSeats: input.dispatchSeats,
    status,
    betaAccess: input.betaAccess,
    signupAt: input.signupAt ? input.signupAt.toISOString() : null,
  };
}

/** Case-insensitive account lookup match: username, display name, or
 *  email contains the (trimmed) query. An empty query matches every
 *  account (the portal's browse list). */
export function accountMatchesQuery(
  shell: Pick<AccountShell, "username" | "displayName" | "email">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    shell.username.toLowerCase().includes(q) ||
    shell.displayName.toLowerCase().includes(q) ||
    (shell.email ?? "").toLowerCase().includes(q)
  );
}

export const TEAM_TIERS = ["basic", "gold", "diamond", "owner"] as const;
export type TeamTier = (typeof TEAM_TIERS)[number];

export function isTeamTier(value: string): value is TeamTier {
  return (TEAM_TIERS as readonly string[]).includes(value);
}

export const TEAM_SEAT_ROLES = ["developer", "support"] as const;
export type TeamSeatRole = (typeof TEAM_SEAT_ROLES)[number];

export function isTeamSeatRole(value: string): value is TeamSeatRole {
  return (TEAM_SEAT_ROLES as readonly string[]).includes(value);
}

// ---- Team invite codes — the ONLY way a new seat is granted (x, 2026-10-30) --
// OWNER'S LOCK: right now the owner is the ONLY team seat holder. A new
// seat exists only when (a) it is the owner's own seat, or (b) the
// invited developer redeems an owner-issued TEAM INVITE CODE. Direct
// seat grants by username are closed — there is no grant path left.
//
// Team invite codes are a DISTINCT code type with their own namespace
// and format: `TEAM-XXXX-XXXX-XXXX` (prefix TEAM-, three groups of
// four). They share NOTHING with the other code families:
//   - referral codes:      MILE-REF-XXXXXX
//   - beta / driver codes: MILE-XXXX-XXXX
//   - owner/master code:   MILE-X-OWNER1
// None of those can ever grant a team seat (the redeem action reads
// ONLY the team-invite table), and a team invite code does nothing
// else (no beta unlock, no referral link — redemption touches only
// the invite row and the seat row it creates).
//
// An invite is SINGLE-USE and tied to ONE specific email address: it
// redeems only from the account whose email on file matches that
// address exactly (case-insensitive). Issuance is the owner's own
// explicit action in the app; issuance, redemption, and revocation
// all land in the audit log and notify the owner in-app and by email.
// Revoking a seat is instant and owner-only.

export const TEAM_INVITE_PREFIX = "TEAM-";
export const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days to redeem

// Character class mirrors CODE_ALPHABET in actions.ts exactly
// (no I, L, O, 0, or 1 — the letters that read as other letters).
const TEAM_INVITE_RE = /^TEAM-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** Normalize a typed code for comparison: trim + uppercase. */
export function normalizeTeamInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** True only for a well-formed TEAM invite code — the distinct format.
 *  A MILE-… code (referral / beta / driver) is never one of these. */
export function isTeamInviteCode(raw: string): boolean {
  return TEAM_INVITE_RE.test(normalizeTeamInviteCode(raw));
}

/** Which OTHER code family a typed code belongs to, if any — used to
 *  refuse a redemption attempt in plain words ("that's a beta code;
 *  those never grant a team seat"). Returns null for anything else. */
export function otherCodeFamily(raw: string): "referral" | "beta_or_driver" | null {
  const code = normalizeTeamInviteCode(raw);
  if (code.startsWith("MILE-REF-")) return "referral";
  if (code.startsWith("MILE-")) return "beta_or_driver";
  return null;
}

/** Normalize an email for invite matching: trim + lowercase. */
export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Invite redemption matching: the account's email on file must equal
 *  the invite's email exactly (after trim/case normalization). Either
 *  side missing/blank never matches. */
export function inviteEmailMatches(inviteEmail: string, accountEmail: string | null | undefined): boolean {
  const a = normalizeInviteEmail(inviteEmail);
  const b = normalizeInviteEmail(accountEmail ?? "");
  return a.length > 3 && b.length > 3 && a === b;
}

/** Mask an invite email for a refusal message: "j•••@example.com" —
 *  enough for the holder to recognize it isn't theirs, never the full
 *  address handed to whoever typed the code. */
export function maskInviteEmail(email: string): string {
  const e = normalizeInviteEmail(email);
  const at = e.indexOf("@");
  if (at <= 0) return "a different email address";
  return `${e.slice(0, 1)}•••${e.slice(at)}`;
}

/** Mask a team invite code for lists: "TEAM-••••-••••-AB12" — the
 *  owner identifies an invite by its last group; the full single-use
 *  code is shown exactly once, at issuance. */
export function maskTeamInviteCode(code: string): string {
  const c = normalizeTeamInviteCode(code);
  const last = c.split("-").pop() ?? "";
  return `TEAM-••••-••••-${last}`;
}

/** An invite's effective state at `nowMs`: a stored "pending" invite
 *  past its expiry reads as expired, whether or not anything has
 *  swept the row yet. */
export function teamInviteState(
  row: { status: string; expiresAtMs: number | null },
  nowMs: number,
): "pending" | "redeemed" | "revoked" | "expired" {
  if (row.status === "pending" && row.expiresAtMs != null && nowMs >= row.expiresAtMs) return "expired";
  if (row.status === "pending" || row.status === "redeemed" || row.status === "revoked" || row.status === "expired") {
    return row.status;
  }
  return "expired";
}

/** Consent-gated sensitive help (x, 2026-10-30): the ONLY item kinds a
 *  consent window can ever name. The closed set is the hard line —
 *  there is no kind for a password, a seed phrase, or payment
 *  credentials, so no approval can ever open them. */
export const ITEM_CONSENT_KINDS = ["pay_entry", "pay_stub", "document"] as const;
export type ItemConsentKind = (typeof ITEM_CONSENT_KINDS)[number];

export function isItemConsentKind(value: string): value is ItemConsentKind {
  return (ITEM_CONSENT_KINDS as readonly string[]).includes(value);
}

export function itemKindLabel(kind: string): string {
  switch (kind) {
    case "pay_entry":
      return "Pay Book entry";
    case "pay_stub":
      return "Pay stub";
    case "document":
      return "Document";
    default:
      return kind;
  }
}

/** A consent window lasts exactly 30 minutes from the user's approval. */
export const ITEM_CONSENT_WINDOW_MS = 30 * 60 * 1000;

/** The window's effective state at `nowMs`: a stored "active" window
 *  whose expiry has passed reads as expired (it closes on its own,
 *  whether or not anything has swept the row yet). */
export function itemWindowState(
  row: { status: string; expiresAtMs: number | null },
  nowMs: number,
): "pending" | "active" | "denied" | "revoked" | "expired" {
  if (row.status === "active" && row.expiresAtMs != null && nowMs >= row.expiresAtMs) return "expired";
  if (row.status === "pending" || row.status === "active" || row.status === "denied" || row.status === "revoked" || row.status === "expired") {
    return row.status;
  }
  return "expired";
}

/** One board row, reduced to what double-booking detection needs. */
export type BoardRowLite = {
  id: number;
  boardScope: string; // fleet | open
  status: string; // open | taken | overflowed
  overflowFromBoardLoadId: number | null;
  brokerPosterLoadId: number | null;
  loadId: number | null;
};

/** The lineage a board row belongs to: an overflow copy and its fleet
 *  source are ONE load; broker-poster copies of one portal load are
 *  ONE load; every other row is its own load. */
export function boardLineageKey(row: BoardRowLite): string {
  if (row.overflowFromBoardLoadId != null) return `fleet:${row.overflowFromBoardLoadId}`;
  if (row.boardScope === "fleet") return `fleet:${row.id}`;
  if (row.brokerPosterLoadId != null) return `broker:${row.brokerPosterLoadId}`;
  return `open:${row.id}`;
}

/** Detect double booking across BOTH boards. A row is LIVE while it
 *  can still produce (or already produced) a booking: status open or
 *  taken. A fleet row in "overflowed" status is not live — its load
 *  moved to the open copy by design. Returns a map of boardLoadId →
 *  plain-language conflict reason for every row in a conflicted
 *  lineage (plus rows that share one claimed driver load). */
export function boardConflicts(rows: BoardRowLite[]): Map<number, string> {
  const conflicts = new Map<number, string>();
  const live = rows.filter((r) => r.status === "open" || r.status === "taken");
  const byLineage = new Map<string, BoardRowLite[]>();
  for (const r of live) {
    const key = boardLineageKey(r);
    const group = byLineage.get(key) ?? [];
    group.push(r);
    byLineage.set(key, group);
  }
  for (const group of byLineage.values()) {
    if (group.length < 2) continue;
    const taken = group.filter((r) => r.status === "taken").length;
    const reason =
      taken > 1
        ? "Double booked — the same load is claimed on more than one board."
        : taken === 1
          ? "Double booked — the load is claimed on one board and still open on another."
          : "Posted on more than one board at once — it can be claimed twice.";
    for (const r of group) conflicts.set(r.id, reason);
  }
  // The same driver load claimed from two different rows is a double
  // booking even if the rows' lineages differ.
  const byLoad = new Map<number, BoardRowLite[]>();
  for (const r of live) {
    if (r.status === "taken" && r.loadId != null) {
      const group = byLoad.get(r.loadId) ?? [];
      group.push(r);
      byLoad.set(r.loadId, group);
    }
  }
  for (const group of byLoad.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      conflicts.set(r.id, "Double booked — the same driver load was claimed from more than one board row.");
    }
  }
  return conflicts;
}

/** Human label for a team audit action, for the portal's log view. */
export function teamActionLabel(action: string): string {
  switch (action) {
    case "grant_seat":
      return "Team seat granted";
    case "revoke_seat":
      return "Team seat revoked";
    case "view_account":
      return "Viewed account shell";
    case "set_tier":
      return "Tier changed";
    case "set_seats":
      return "Seats changed";
    case "unlock_account":
      return "Account unlocked";
    case "set_status":
      return "Account status changed";
    case "set_beta_access":
      return "Beta / trial access changed";
    case "resend_invite":
      return "Invite resent";
    case "portal_account_status":
      return "Portal account status changed";
    case "board_claim_returned":
      return "Board claim returned";
    case "board_row_withdrawn":
      return "Duplicate board row withdrawn";
    case "board_flagged":
      return "Board load flagged";
    case "board_flag_cleared":
      return "Board flag cleared";
    case "send_reward":
      return "Reward sent";
    case "giveaway_created":
      return "Giveaway created";
    case "giveaway_funded":
      return "Giveaway funded";
    case "giveaway_drawn":
      return "Giveaway drawn";
    case "giveaway_distributed":
      return "Giveaway distributed";
    case "giveaway_cancelled":
      return "Giveaway cancelled";
    case "consent_requested":
      return "Consent requested";
    case "consent_approved":
      return "Consent approved by user";
    case "consent_denied":
      return "Consent denied by user";
    case "consent_applied":
      return "Approved change applied";
    case "password_reset_triggered":
      return "Password reset triggered";
    case "item_consent_requested":
      return "Item access requested (opens nothing)";
    case "item_consent_approved":
      return "Item access approved by user";
    case "item_consent_denied":
      return "Item access denied by user";
    case "item_consent_revoked":
      return "Item access revoked by user";
    case "item_viewed":
      return "Consented item viewed";
    case "item_edited":
      return "Consented item edited";
    case "item_window_closed":
      return "Consent window closed";
    case "invite_issued":
      return "Team invite issued (owner)";
    case "invite_redeemed":
      return "Team invite redeemed — seat granted";
    case "invite_revoked":
      return "Team invite revoked (owner)";
    case "invite_redeem_failed":
      return "Team invite redemption refused";
    default:
      return action;
  }
}
