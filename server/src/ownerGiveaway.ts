/**
 * OWNER GIVEAWAY PORTAL — pure rules module (locked by x, 2026-10-27;
 * Part D of the narrower-2x order).
 *
 * OWNER MONEY ONLY. A giveaway here is one company owner's own funds,
 * given to that owner's OWN company drivers. This portal never reads
 * or writes the Earning Pool, the Reward Wallet, or any platform
 * giveaway table, and the app never holds owner funds: it records,
 * verifies on chain, and publishes. Every rule below is a pure
 * function of its inputs (hashing is INJECTED by the caller, the
 * verifyAudit.ts pattern) so the split math, the commitment, the
 * draw, the roster scoping, and the state machine are unit-tested
 * without a database.
 *
 * SPLIT: amounts are handled in integer minor units (USD 2dp;
 * USDG / $STONER / ETH 6dp). Equal splits use largest-remainder
 * distribution so recipient amounts sum EXACTLY to the pot.
 * Per-driver amounts validate sum == pot exactly (in minor units)
 * or refuse with the signed difference named.
 *
 * COMMITMENT (random mode): at creation the server seals SHA-256
 * over the canonical string of {companyId, sorted entrant usernames,
 * pot, currency, winnerCount, createdAt ISO} (see
 * commitmentCanonicalString). The commitment fixes the entrant list
 * and the pot BEFORE any draw exists — anyone with the published
 * record can recompute it.
 *
 * DRAW: seed = SHA-256(commitmentHash || seal-chain head hash
 * immediately before the draw entry is appended). Winners are a
 * deterministic sample without replacement from the SORTED entrant
 * list, drawn with mulberry32 seeded from the seed's first 32 bits
 * (partial Fisher–Yates). Same seed + same entrants always yields
 * the same winners. Winners share the pot equally (the split above).
 *
 * HONEST LIMIT (stated in DATA-PLAN.md too): the published record
 * makes post-commitment tampering DETECTABLE — it is a verifiable
 * record, not a claim of owner-proof randomness. The owner runs the
 * draw; what the record guarantees is that the entrants, the pot,
 * and the seed inputs were fixed in public before the draw ran and
 * that anyone can recompute the outcome from them.
 *
 * STATE MACHINE: draft → funded → distributed; draft → cancelled.
 * funded ⟺ every winner/recipient's amount is covered by a VERIFIED
 * recorded payout (verifiedAmount ≥ amount for each). Only the
 * "verified" outcome counts — not_found / recipient_mismatch /
 * unavailable never fund anything. distributed only from funded, by
 * owner confirmation. cancelled only from draft. USD giveaways can
 * never record a payout (the Stripe-rails gate below), so they can
 * never reach funded or distributed.
 */

export type GiveawayCurrency = "USDG" | "USD" | "STONER" | "ETH";
export type GiveawayMode = "selected" | "random";
export type GiveawayStatus = "draft" | "funded" | "distributed" | "cancelled";
export type PayoutVerification =
  | "verified"
  | "not_found"
  | "recipient_mismatch"
  | "unavailable";

export const GIVEAWAY_CURRENCIES: GiveawayCurrency[] = ["USDG", "USD", "STONER", "ETH"];

/** The honest USD gate, shown to owner and drivers alike: USD
 *  campaigns can be created, rosters set, and draws run, but no USD
 *  payout can be recorded until Stripe rails exist (the app has no
 *  server-secret slot for a payout processor). No fake money
 *  movement, no fake balances — a USD giveaway stays in draft. */
export const USD_GATE_NOTE =
  "USD giveaways open with Stripe rails — campaigns, rosters, and draws work now, but USD payouts can't be recorded yet (the app has no payout-processor secret slot), so a USD giveaway stays in draft until those rails land. No money moves through the app.";

/** A solo account (no company) asking for the portal gets the path
 *  forward, never a dead end. */
export const SOLO_NO_COMPANY_ERROR =
  "Giveaways are a company-owner tool. Create a fleet first — My company → Create a fleet (Owner-Operator Gold/Diamond accounts can) — and add your drivers; then you can run a giveaway for your own roster here.";

export const COMMITMENT_VERSION = "stonemiles-owner-giveaway-v1";

export const DRAW_SEED_METHOD =
  "sha256(commitmentHash | chain head hash at draw time) → mulberry32 sampling without replacement over the sorted entrant list";

/** Decimal places for a currency: USD is cents; the Robinhood Chain
 *  assets are tracked at 6dp in this portal. */
export function currencyDecimals(currency: GiveawayCurrency): number {
  return currency === "USD" ? 2 : 6;
}

/** Major units → integer minor units at the currency's precision. */
export function toMinor(amount: number, currency: GiveawayCurrency): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 10 ** currencyDecimals(currency));
}

/** Integer minor units → major units. */
export function fromMinor(minor: number, currency: GiveawayCurrency): number {
  return minor / 10 ** currencyDecimals(currency);
}

/** Format an amount exactly at the currency's precision — the format
 *  the commitment string binds. */
export function formatAmount(amount: number, currency: GiveawayCurrency): string {
  return (toMinor(amount, currency) / 10 ** currencyDecimals(currency)).toFixed(
    currencyDecimals(currency),
  );
}

// ---- Split math --------------------------------------------------------------

/**
 * Equal split of a pot across `count` recipients at currency
 * precision, largest-remainder: the pot in minor units is divided
 * evenly and the leftover minor units go one each to the FIRST
 * recipients (callers pass recipients in sorted order, so the
 * remainder lands deterministically). The returned amounts sum
 * EXACTLY to the pot. count ≤ 0 → [].
 */
export function equalSplit(pot: number, count: number, currency: GiveawayCurrency): number[] {
  if (!Number.isFinite(pot) || pot <= 0 || !Number.isFinite(count) || count <= 0) return [];
  const n = Math.floor(count);
  const potMinor = toMinor(pot, currency);
  const base = Math.floor(potMinor / n);
  const remainder = potMinor - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(fromMinor(base + (i < remainder ? 1 : 0), currency));
  }
  return out;
}

/**
 * Validate per-driver amounts against the pot: the amounts must sum
 * EXACTLY to the pot in minor units. On mismatch the result names
 * the signed difference (sum − pot) so the owner sees how far off
 * the roster is, in the giveaway's own currency precision.
 */
export function validatePerDriverAmounts(
  pot: number,
  amounts: number[],
  currency: GiveawayCurrency,
): { ok: boolean; sum: number; difference: number } {
  const potMinor = toMinor(pot, currency);
  const sumMinor = amounts.reduce((s, a) => s + toMinor(a, currency), 0);
  const difference = fromMinor(sumMinor - potMinor, currency);
  return {
    ok: sumMinor === potMinor,
    sum: fromMinor(sumMinor, currency),
    difference,
  };
}

// ---- Roster scoping ------------------------------------------------------------

export type RosterMember = { username: string; role: string };

/** The ONLY eligible entrants/recipients: company members whose role
 *  is exactly "driver", sorted. The owner and dispatch are never
 *  entrants — by construction, not by a UI filter. */
export function eligibleEntrants(members: RosterMember[]): string[] {
  return members
    .filter((m) => m.role === "driver")
    .map((m) => m.username)
    .sort();
}

/**
 * Validate a requested recipient/entrant list against the owner's
 * roster. Every requested username must be a driver IN THIS COMPANY:
 * a driver from another company is not on the roster and is refused;
 * the owner or a dispatch seat requested as a recipient is refused
 * by name (they are never entrants). Duplicates are refused too.
 */
export function validateRosterSelection(
  members: RosterMember[],
  requested: string[],
): { ok: boolean; error: string | null; eligible: string[] } {
  const eligible = eligibleEntrants(members);
  const eligibleSet = new Set(eligible);
  const byName = new Map(members.map((m) => [m.username, m]));
  const seen = new Set<string>();
  for (const name of requested) {
    if (seen.has(name)) {
      return { ok: false, error: `@${name} is listed twice — each driver can appear once.`, eligible };
    }
    seen.add(name);
    const member = byName.get(name);
    if (member && member.role !== "driver") {
      return {
        ok: false,
        error: `@${name} is the ${member.role} — giveaways go to your drivers only; the owner and dispatch are never entrants.`,
        eligible,
      };
    }
    if (!eligibleSet.has(name)) {
      return {
        ok: false,
        error: `@${name} is not a driver in your company — a giveaway can only include your own roster.`,
        eligible,
      };
    }
  }
  return { ok: true, error: null, eligible };
}

// ---- Commitment ------------------------------------------------------------------

export type CommitmentFacts = {
  companyId: number;
  /** Entrant usernames (any order — sorted inside). */
  entrants: string[];
  potAmount: number;
  currency: GiveawayCurrency;
  winnerCount: number;
  /** ISO timestamp of giveaway creation. */
  createdAtIso: string;
};

/**
 * The canonical string the commitment hash covers — versioned, one
 * fact per line, entrants sorted. Anyone with the published record
 * (company, entrants, pot, currency, winner count, creation time)
 * recomputes this string and its SHA-256 to check the commitment.
 */
export function commitmentCanonicalString(facts: CommitmentFacts): string {
  const entrants = [...facts.entrants].sort();
  return [
    COMMITMENT_VERSION,
    `company:${facts.companyId}`,
    `entrants:${entrants.join(",")}`,
    `pot:${formatAmount(facts.potAmount, facts.currency)}`,
    `currency:${facts.currency}`,
    `winners:${facts.winnerCount}`,
    `created:${facts.createdAtIso}`,
  ].join("\n");
}

/** The string hashed to produce the draw seed: the sealed commitment
 *  bound to the seal-chain head as it stood immediately before the
 *  draw entry was appended. */
export function drawSeedInput(commitmentHash: string, headHash: string): string {
  return `${commitmentHash}|${headHash}`;
}

// ---- Draw ------------------------------------------------------------------------

/** mulberry32 — a small documented PRNG: deterministic from a 32-bit
 *  seed, period 2^32, identical output on every platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic winners: partial Fisher–Yates over the SORTED
 * entrant list, driven by mulberry32 seeded from the draw seed's
 * first 32 bits, sampling WITHOUT replacement. Returns the winners
 * sorted (shares are equal, so order carries no value). Same seed +
 * same entrants → same winners, always.
 */
export function drawWinners(args: {
  entrants: string[];
  winnerCount: number;
  /** Hex draw seed (the SHA-256 of drawSeedInput). */
  seedHex: string;
}): string[] {
  const sorted = [...args.entrants].sort();
  const count = Math.max(0, Math.min(Math.floor(args.winnerCount), sorted.length));
  if (count === 0) return [];
  const seedWord = parseInt(args.seedHex.replace(/^0x/, "").slice(0, 8) || "0", 16) >>> 0;
  const rand = mulberry32(seedWord);
  const pool = [...sorted];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, count).sort();
}

// ---- Funding coverage + state machine --------------------------------------------

export type RecipientFunding = {
  amount: number;
  isWinner: boolean;
  verification: PayoutVerification | null;
  verifiedAmount: number | null;
};

/** One recipient is covered only by a VERIFIED payout whose verified
 *  amount reaches their share. Any other outcome — not_found,
 *  recipient_mismatch, unavailable, or no record — covers nothing. */
export function isRecipientCovered(r: RecipientFunding, currency: GiveawayCurrency): boolean {
  if (r.verification !== "verified" || r.verifiedAmount == null) return false;
  return toMinor(r.verifiedAmount, currency) >= toMinor(r.amount, currency);
}

/** The recipients who must be covered for the giveaway to fund:
 *  every row in selected mode; only the winners in random mode
 *  (non-winner entrants carry amount 0 and are never payees). */
export function payeesOf<T extends { isWinner: boolean }>(recipients: T[]): T[] {
  return recipients.filter((r) => r.isWinner);
}

/** funded ⟺ there is at least one payee and EVERY payee is covered
 *  by a verified payout. Partial verification stays draft. */
export function allPayeesCovered(recipients: RecipientFunding[], currency: GiveawayCurrency): boolean {
  const payees = payeesOf(recipients);
  if (payees.length === 0) return false;
  return payees.every((r) => isRecipientCovered(r, currency));
}

/**
 * The status after a payout record lands: a draft giveaway whose
 * payees are now all verified-covered flips to "funded"; anything
 * else keeps its status (a funded giveaway never falls back — the
 * latest record stands, and funded was sealed when it was reached).
 */
export function statusAfterPayoutRecord(
  current: GiveawayStatus,
  recipients: RecipientFunding[],
  currency: GiveawayCurrency,
): GiveawayStatus {
  if (current !== "draft") return current;
  return allPayeesCovered(recipients, currency) ? "funded" : "draft";
}

/** Can a payout be recorded against this giveaway at all? USD is
 *  refused outright (the Stripe-rails gate); cancelled/distributed
 *  giveaways take no records; draft and funded do (a corrected tx
 *  hash can replace a failed record — the latest record stands). */
export function payoutRecordingGate(g: {
  currency: GiveawayCurrency;
  status: GiveawayStatus;
}): { allowed: boolean; error: string | null } {
  if (g.currency === "USD") {
    return { allowed: false, error: USD_GATE_NOTE };
  }
  if (g.status === "cancelled") {
    return { allowed: false, error: "This giveaway was cancelled — no payouts can be recorded against it." };
  }
  if (g.status === "distributed") {
    return { allowed: false, error: "This giveaway is already distributed — its payout record is closed." };
  }
  return { allowed: true, error: null };
}

/** distributed only from funded, by owner confirmation. */
export function distributionGate(status: GiveawayStatus): { allowed: boolean; error: string | null } {
  if (status === "funded") return { allowed: true, error: null };
  return {
    allowed: false,
    error:
      status === "draft"
        ? "This giveaway isn't funded yet — every winner's share must be covered by a verified on-chain payout before it can be marked distributed."
        : `A ${status} giveaway can't be distributed.`,
  };
}

/** cancelled only from draft. */
export function cancelGate(status: GiveawayStatus): { allowed: boolean; error: string | null } {
  if (status === "draft") return { allowed: true, error: null };
  return {
    allowed: false,
    error: `Only a draft giveaway can be cancelled — this one is ${status}.`,
  };
}

/** A USD giveaway can never reach funded/distributed: payouts can
 *  never be recorded (payoutRecordingGate), so the coverage check
 *  has nothing verified to count. This predicate states the same
 *  fact directly for tests and guards. */
export function canEverFund(currency: GiveawayCurrency): boolean {
  return currency !== "USD";
}
