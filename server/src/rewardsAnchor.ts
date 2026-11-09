/**
 * Option C — dollar-anchored rewards (owner-approved 2026-10-26;
 * anchor raised by the REWARDS REWORK, owner-approved 2026-10-26 with
 * amendments A1/A2 — spec rewards-rework-proposal-2026-10-26.md).
 *
 * Points conversion and the welcome/yearly credits used to promise a
 * FIXED token count (1,000 pts = 100 $STONER; Gold 1,000 / Diamond
 * 10,000 / Fleet 100,000 $STONER) while the Earning Pool refills in
 * DOLLARS (the 25% rewards slice of the 75% converted subscription
 * revenue). The 2026-10-26 profitability sim proved that mismatch
 * breaks driver pay whenever the token price runs hot: demand in
 * tokens grows with price, funding in dollars does not.
 *
 * The anchored design matches the promise to the funding:
 * - Each 1,000-point block carries a fixed USD value — the ANCHOR,
 *   $0.25 per 1,000 SM Points (raised from the original Option C
 *   $0.20 by the 2026-10-26 rewards rework; the rework's profit sim
 *   Part 5 verified conversions still pay 100% at earner ratios 1.0
 *   and 1.5 in base and zero-breakage stress, pool never negative).
 * - Welcome/yearly credits are USD entitlements: Gold $1.00 (liquid),
 *   Diamond $5.00 (25% head + remainder in 6 monthly tranches),
 *   Fleet/Owner $25.00 (25% head + remainder in 12 monthly tranches),
 *   yearly-subscriber credit $1.00 (annual subs only, locked until the
 *   first sealed trip — the lock is unchanged).
 * - At payout time the token amount is computed as USD ÷ the live
 *   $STONER price read server-side at that moment, rounded DOWN to 6
 *   decimals so a payout never exceeds its USD anchor or the pool.
 *   With no live price the payout path pays NOTHING and every row
 *   stays queued/pending — fail closed, never a guessed price.
 *
 * Derivation (blended sub $16.994/mo; rewards slice $3.186375/sub-mo =
 * $38.2365/sub-yr): expected credits $7.595 per initial sub over the
 * launch year; earned conversions at the original $0.20 anchor with
 * 30% breakage $15.475/yr at earner ratio 1.0 and $22.317/yr at 1.5 →
 * totals 60.3% and 78.2% of the annual slice. Solvent at any token
 * price by construction — the price cancels out. Full arithmetic in
 * the sim memo (rewards-profit-sim-2026-10-26.md, Option-C section);
 * the $0.25 rework was re-verified in the rework spec's profit sim
 * Part 5 (conversions pay 100% at ratios 1.0 and 1.5, base and
 * zero-breakage stress; pool never negative).
 *
 * Pure functions only: no I/O, unit-tested (rewardsAnchor.test.ts).
 */

/** The anchor: USD value carried by each 1,000-point block.
 *  $0.25 since the 2026-10-26 rewards rework (was $0.20 at Option C). */
export const ANCHOR_USD_PER_BLOCK = 0.25;

/** Points per conversion block (unchanged from the locked terms). */
export const CONV_BLOCK_POINTS = 1000;

/** Minimum points balance to convert (unchanged). */
export const CONV_MIN_BALANCE = 10000;

/** Monthly conversion cap, in POINTS per driver (unchanged). */
export const CONV_MONTHLY_CAP_POINTS = 100000;

/** Welcome credit USD entitlements per first paid plan. */
export const WELCOME_CREDIT_USD = {
  gold: 1,
  diamond: 5,
  owner: 25,
} as const;

/** Yearly-subscriber credit USD entitlement (annual subs only). */
export const YEARLY_CREDIT_USD = 1;

/** Monthly vesting tranches per plan (Diamond ×6, Fleet/Owner ×12;
 *  Gold has no entry — its credit is liquid). Plan shape governs
 *  vesting for anchored credits; there is no token threshold. */
export const WELCOME_VEST_MONTHLY_TRANCHES: Readonly<
  Partial<Record<"gold" | "diamond" | "owner", number>>
> = {
  diamond: 6,
  owner: 12,
};

/**
 * Earning Pool queue priority, highest first (SEALED MILES update,
 * owner-approved 2026-10-26): (1) the TASK portions of queued points
 * conversions, (2) welcome/yearly bonus credits, (3) the MILES
 * portions of queued points conversions — conversions spend
 * task-earned points before miles points, and miles portions drain
 * LAST at every pool-funding/grant call site
 * (processEarningPoolQueues in actions.ts runs the phases in
 * exactly this order). The driver who did the work is paid before
 * signup bonuses draw on what remains, and miles points convert
 * after all other earned points.
 */
export const EARNING_POOL_QUEUE_ORDER = [
  "points_conversions_task",
  "welcome_credits",
  "points_conversions_miles",
] as const;

/**
 * USD value of a points amount under the anchor. Conversions run in
 * whole 1,000-point blocks only: a non-positive amount or one that
 * is not an exact block multiple has no anchored value → null.
 */
export function anchorUsdForPoints(points: number): number | null {
  if (!Number.isFinite(points) || !Number.isInteger(points) || points <= 0) {
    return null;
  }
  if (points % CONV_BLOCK_POINTS !== 0) return null;
  const usd = (points / CONV_BLOCK_POINTS) * ANCHOR_USD_PER_BLOCK;
  // Round to cents-precision dollars to keep float dust out of rows.
  return Math.round(usd * 100) / 100;
}

/**
 * Token amount for a USD entitlement at a live price:
 * tokens = USD ÷ price, rounded DOWN to 6 decimals so a payout never
 * exceeds its USD anchor. FAILS CLOSED: a missing, non-finite, or
 * non-positive price — or a non-positive USD entitlement — returns
 * null and the caller must leave the row queued/pending. A computed
 * amount that floors to 0 (price so high the entitlement is worth
 * less than 0.000001 tokens) also returns null: paying 0 tokens is
 * not a payout.
 */
export function tokensForUsd(
  amountUsd: number,
  priceUsd: number | null | undefined,
): number | null {
  if (priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const raw = amountUsd / priceUsd;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const floored = Math.floor(raw * 1_000_000) / 1_000_000;
  return floored > 0 ? floored : null;
}

/**
 * Split a USD credit into its liquid head (25%) and equal monthly
 * tranches, in integer USD cents so the parts sum EXACTLY to the
 * credit: the head rounds to the nearest cent and the last tranche
 * absorbs the rounding remainder. With 0 tranches the whole credit
 * is the liquid head (Gold).
 */
export function splitVestedCreditUsd(
  totalUsd: number,
  monthlyTranches: number,
): { headUsd: number; tranchesUsd: number[] } {
  const totalCents = Math.round(totalUsd * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0 || monthlyTranches <= 0) {
    return { headUsd: Math.max(0, totalCents) / 100, tranchesUsd: [] };
  }
  const headCents = Math.round(totalCents * 0.25);
  const restCents = totalCents - headCents;
  const base = Math.floor(restCents / monthlyTranches);
  const tranchesCents: number[] = [];
  for (let i = 0; i < monthlyTranches; i++) {
    tranchesCents.push(
      i === monthlyTranches - 1 ? restCents - base * (monthlyTranches - 1) : base,
    );
  }
  return {
    headUsd: headCents / 100,
    tranchesUsd: tranchesCents.map((c) => c / 100),
  };
}
