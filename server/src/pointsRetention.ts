/**
 * SM Points — balance retention + season clock (owner clause A2b,
 * 2026-10-26, on top of the rewards rework).
 *
 * THE RULE: a driver's SM Points balance is the sum of EVERY row in
 * their points ledger — all of it, from every day, month, and season.
 * The balance NEVER expires, is NEVER forfeited for staying on the
 * free Basic tier, and is NEVER wiped by a season reset or any other
 * rollover. Season ranks and season milestone titles reset each
 * 31-day season (the season clock below drives those scores only);
 * the points balance itself does not participate in any rollover.
 *
 * That is true BY CONSTRUCTION in this module: `pointsBalanceFromLedger`
 * takes the ledger rows and nothing else — no date, no season, no
 * month, no tier — so there is no rollover input that could reduce
 * it. It is the one balance computation `pointsBalance` in actions.ts
 * runs, for every tier alike.
 *
 * CONVERSION + CASH-OUT LOCK (clause A2c, 2026-10-26 — SUPERSEDES
 * the conversion-parity wording first drafted under A2b): while a
 * driver is on the free Basic tier they CANNOT convert points and
 * CANNOT cash out at all. The balance is retained in full and keeps
 * stacking (the retention rule above is unchanged); converting and
 * cashing out are paying-tier features, gated on the app's existing
 * plan resolution (any paid plan counts; fleet/company-covered
 * drivers count as paid — dailyPointsPaidTier in actions.ts). The
 * moment the driver upgrades to any paying tier, the retained
 * balance unlocks and converts under the normal rules (10,000-point
 * minimum, 1,000-point blocks, $0.25 per 1,000 anchor, same Earning
 * Pool queue, same points_conversion_live launch gate — which stays
 * OFF until Nov 20 + the owner's go-live word, for every tier).
 * The gate itself — extended by clause A2d (universal active-account
 * gate), A2e (14-day non-renewal retainer) and A2f (14-day
 * post-reactivation hold) — lives in accountStanding.ts:
 * moneyExitRefusal is the exact gate both money-exit handlers
 * (conversion + cash-out) run first, and planConversionRequest is
 * the exact decision the conversion handler runs. A locked request
 * is refused before any step-up, hold, queue row, or ledger movement
 * can happen, and the balance is untouched. This module keeps the
 * retention rule and the free-tier refusal texts the gate speaks.
 *
 * What CAN move a balance is unchanged and is none of the above: the
 * driver's own conversion payout (deducts exactly the converted
 * points, at payment), an owner's in-company gift, the House Rule 1
 * refund clawback (reverses only points a refunded PAID subscription
 * itself granted — a free signup has no subscription events, so it
 * can never touch free-earned points), and the POD-seal void
 * clawback (reverses a voided seal's own points — a record
 * correction, disclosed in the app). Subscription lapse rules for
 * UNVESTED WELCOME CREDITS operate on welcome_vesting USD-credit
 * rows, never on this ledger, and are untouched by clause A2b.
 *
 * Pure functions only: no I/O, unit-tested (pointsRetention.test.ts).
 */

/** Honest refusal spoken by the standing gate (accountStanding.ts)
 *  to a free-tier driver who asks to convert. The balance is
 *  untouched and keeps stacking; the lock lifts on upgrade to any
 *  paying tier. */
export const FREE_TIER_CONVERSION_REFUSAL =
  "Converting is a paid-plan feature. You're on the free Basic plan, so your SM Points stay right where they are — yours, still stacking, and they never expire. The moment you upgrade to any paid plan, converting unlocks and your full retained balance converts under the normal rules (10,000-point minimum, 1,000-point blocks, $0.25 of value per 1,000 points). Nothing was requested, nothing queued, and your balance is untouched.";

/** Honest refusal spoken by the standing gate to a free-tier driver
 *  who asks to cash out. */
export const FREE_TIER_CASHOUT_REFUSAL =
  "Cashing out is a paid-plan feature. You're on the free Basic plan, so nothing was requested and no money moved — your balance stays exactly where it is. Cash-out unlocks when you upgrade to any paid plan (and activates for everyone at go-live with the licensed payout provider).";

// ---- 31-day seasons ---------------------------------------------------------
// Fixed shared epoch: Season 1 starts 2026-10-12 UTC, so the current
// season is always a true 31-day window. Scores, ranks, and Safety
// Academy refreshers all key off this one cycle. The season clock
// NEVER feeds the points balance (see the retention rule above).
export const SEASON_MS = 31 * 86400000;
export const SEASON_EPOCH = Date.parse("2026-10-12T00:00:00Z");
export function seasonInfo(nowMs: number): { idx: number; number: number; start: number; end: number; daysLeft: number } {
  const idx = Math.max(0, Math.floor((nowMs - SEASON_EPOCH) / SEASON_MS));
  const start = SEASON_EPOCH + idx * SEASON_MS;
  const end = start + SEASON_MS;
  return {
    idx,
    number: idx + 1,
    start,
    end,
    daysLeft: Math.max(0, Math.ceil((end - nowMs) / 86400000)),
  };
}

/**
 * THE points balance: the sum of every ledger row's amount, with no
 * time window, season, month, or tier filter — clause A2b retention
 * by construction. Negative rows are only the pre-existing movement
 * kinds listed in this module's header (own conversion payout, gift,
 * House Rule 1 refund clawback of paid-subscription points, voided
 * POD-seal correction); no rollover ever writes one.
 */
export function pointsBalanceFromLedger(
  rows: readonly { amount: number }[],
): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}
