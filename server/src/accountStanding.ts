/**
 * Account standing — the universal money-exit gate (owner clauses
 * A2c/A2d/A2e/A2f, 2026-10-26). Pure functions only: no I/O,
 * unit-tested (accountStanding.test.ts). actions.ts resolves the
 * caller's facts (recorded plan + retainer/hold rows) and runs every
 * conversion and cash-out decision through here.
 *
 * STATES:
 * - "free": never had a paying account (or no retainer history).
 *   Points are retained and keep stacking (clause A2b), but
 *   converting and cashing out NEVER unlock while free (A2c).
 * - "paid_active": a paying account in good standing, not in a
 *   reactivation hold. The ONLY state that may convert or cash out
 *   (A2d) — and even then the separate launch gate
 *   (points_conversion_live, OFF until Nov 20 + the owner's go-live
 *   word) and the normal anchored rules still apply.
 * - "in_retainer": a paying account did not renew; the 14-day
 *   retainer (A2e) is running from the non-renewal date. Conversion
 *   and both cash-out lanes locked; the earned balance is retained
 *   in full and displayed as on retainer; welcome vesting clocks
 *   PAUSE (no tranche time is consumed).
 * - "lapsed_locked": the retainer expired un-renewed. Unvested
 *   welcome credits returned to the Earning Pool at expiry (the
 *   existing lapse rule, retimed to retainer end); the EARNED points
 *   balance stays retained and locked indefinitely — reactivatable
 *   on any later return, no further decay, ever.
 * - "reactivated_hold": any reactivation after a non-renewal starts
 *   a 14-day HOLD from the reactivation date (A2f), in both branches
 *   (renewed inside the retainer, or returned after its expiry).
 *   Conversion and both cash-out lanes stay locked until the hold
 *   ends; the account must stay ACTIVE through the whole hold —
 *   cancelling during the hold drops the balance into a FRESH 14-day
 *   retainer cycle from that cancellation. Vesting is NOT held:
 *   clocks resumed at reactivation (A2e) and tranches pay on their
 *   resumed schedule into the wallet balance — they unlock nothing.
 *   In the after-expiry branch the returned welcome credits do NOT
 *   come back; the hold covers the earned points balance only.
 *
 * Plan resolution is the app's existing one (the recorded plan;
 * fleet/company-covered drivers count as paid because an Owner
 * install's recorded plan reads "owner" — see dailyPointsPaidTier in
 * actions.ts). This module receives the already-resolved plan rank
 * facts as plain inputs.
 */

import {
FREE_TIER_CASHOUT_REFUSAL,
FREE_TIER_CONVERSION_REFUSAL,
} from "./pointsRetention";
import {
CONV_BLOCK_POINTS,
CONV_MIN_BALANCE,
CONV_MONTHLY_CAP_POINTS,
anchorUsdForPoints,
} from "./rewardsAnchor";

/** Retainer length: 14 days from the non-renewal date (A2e). */
export const RETAINER_MS = 14 * 86400000;

/** Post-reactivation hold length: 14 days from reactivation (A2f). */
export const REACTIVATION_HOLD_MS = 14 * 86400000;

export type StandingState =
  | "free"
  | "paid_active"
  | "in_retainer"
  | "lapsed_locked"
  | "reactivated_hold";

export interface AccountStanding {
  state: StandingState;
  /** The recorded plan the standing was resolved from. */
  plan: string;
  /** When the current lock lifts: the retainer end (in_retainer) or
   *  the hold end (reactivated_hold); null in every other state. */
  lockEndsAt: number | null;
}

/** Tier rank, mirroring planRank in actions.ts (basic 0 · gold 1 ·
 *  diamond 2 · owner 3). */
export function standingPlanRank(plan: string): number {
  return plan === "owner" ? 3 : plan === "diamond" ? 2 : plan === "gold" ? 1 : 0;
}

export interface RetainerFact {
  status: string; // active | lifted | expired
  endsAt: number;
}

export interface HoldFact {
  status: string; // active | completed | cancelled
  endsAt: number;
}

/**
 * Resolve the account standing from its facts at an instant. Pure
 * time math: an "active" retainer whose end has passed resolves to
 * lapsed_locked even before the settle pass flips its row, and an
 * "active" hold whose end has passed (account still paying) resolves
 * to paid_active — the displays are correct before any lazy settle
 * runs.
 */
export function resolveStanding(args: {
  plan: string;
  retainer: RetainerFact | null;
  hold: HoldFact | null;
  now: number;
}): AccountStanding {
  const paid = standingPlanRank(args.plan) > 0;
  if (paid) {
    if (args.hold && args.hold.status === "active" && args.now < args.hold.endsAt) {
      return { state: "reactivated_hold", plan: args.plan, lockEndsAt: args.hold.endsAt };
    }
    return { state: "paid_active", plan: args.plan, lockEndsAt: null };
  }
  const r = args.retainer;
  if (r && r.status === "active" && args.now < r.endsAt) {
    return { state: "in_retainer", plan: args.plan, lockEndsAt: r.endsAt };
  }
  if (r && (r.status === "active" || r.status === "expired")) {
    // An active-but-past-end retainer is an expired one awaiting its
    // settle pass; either way the account is lapsed and locked.
    return { state: "lapsed_locked", plan: args.plan, lockEndsAt: null };
  }
  return { state: "free", plan: args.plan, lockEndsAt: null };
}

/** Retainer end for a non-renewal at `startedAt` (A2e: +14 days). */
export function retainerEndsAt(startedAt: number): number {
  return startedAt + RETAINER_MS;
}

/** Hold end for a reactivation at `startedAt` (A2f: +14 days). */
export function holdEndsAt(startedAt: number): number {
  return startedAt + REACTIVATION_HOLD_MS;
}

/**
 * How far a pending vesting tranche's due date shifts when a retainer
 * lifts at renewal: exactly the paused span, so no tranche time is
 * consumed by the retainer (A2e). The same shift applies to every
 * pending tranche of the account.
 */
export function vestingShiftOnLift(retainerStartedAt: number, liftedAt: number): number {
  return Math.max(0, liftedAt - retainerStartedAt);
}

/** A tranche's due date after its clock was paused for `shiftMs`. */
export function trancheDueAfterPause(dueAt: number, shiftMs: number): number {
  return dueAt + shiftMs;
}

/**
 * What the welcome-vesting processor may do with a pending tranche
 * under a standing: "run" (pay on schedule — paid_active, and
 * reactivated_hold too: A2f resumes vesting, payouts land in the
 * wallet balance and unlock nothing), "pause" (in_retainer: neither
 * pay nor return — the clock is frozen), "return" (lapsed_locked:
 * the retainer expired un-renewed, so unvested tranches return to
 * the Earning Pool; also the legacy fallback for a free account that
 * somehow holds tranches with no retainer record — the pre-A2e lapse
 * behavior for state that predates retainers).
 */
export function vestingClockAction(standing: AccountStanding): "run" | "pause" | "return" {
  switch (standing.state) {
    case "paid_active":
    case "reactivated_hold":
      return "run";
    case "in_retainer":
      return "pause";
    case "lapsed_locked":
    case "free":
      return "return";
  }
}

/** Plain date for lock copy: "November 9, 2026" (driver-local CT). */
export function standingDateText(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
}

/**
 * THE universal money-exit gate (A2d): the refusal a conversion or
 * cash-out request must be answered with, or null when the account
 * may proceed (paid_active only). Applies identically to points
 * conversion and to BOTH cash-out lanes (instant and standard) —
 * requestCashout runs this before its lane handling.
 */
export function moneyExitRefusal(
  kind: "conversion" | "cashout",
  standing: AccountStanding,
): string | null {
  switch (standing.state) {
    case "paid_active":
      return null;
    case "free":
      return kind === "conversion" ? FREE_TIER_CONVERSION_REFUSAL : FREE_TIER_CASHOUT_REFUSAL;
    case "in_retainer": {
      const date = standing.lockEndsAt != null ? standingDateText(standing.lockEndsAt) : "the retainer end date";
      return `Your balance is on a 2-week retainer — renew by ${date} to unlock everything as it was. Your earned points are retained in full, but converting and cashing out stay locked while the retainer runs (renewing starts a 14-day reactivation hold). Nothing was requested and your balance is untouched.`;
    }
    case "lapsed_locked":
      return "Your account is inactive — reactivate to convert and cash out. Your points are still here, retained in full, and they never expire; reactivating starts a 14-day hold before converting and cashing out unlock. Nothing was requested and your balance is untouched.";
    case "reactivated_hold": {
      const date = standing.lockEndsAt != null ? standingDateText(standing.lockEndsAt) : "the hold end date";
      return `Reactivated — your balance unlocks on ${date} while your account stays active. Until then converting and cashing out stay locked; your points are retained in full and keep stacking. Nothing was requested and your balance is untouched.`;
    }
  }
}

export type ConversionPlan =
  | { outcome: "queued"; anchorUsd: number }
  | { outcome: "refused"; error: string };

/**
 * THE conversion-request decision, in the handler's exact order:
 * (1) the universal standing gate (A2c/A2d/A2e/A2f — only a
 * paid_active account proceeds); (2) the launch gate
 * (points_conversion_live, OFF for every tier until Nov 20 + the
 * owner's go-live word); (3) 1,000-point blocks; (4) the 10,000-point
 * minimum balance; (5) the request may not exceed the balance;
 * (6) the 100,000-point monthly cap. Only a "queued" outcome lets
 * the handler write a conversion row; every refusal writes nothing
 * and moves no points. After an upgrade/reactivation the SAME
 * retained balance runs through checks (2)–(6) unchanged once the
 * account reaches paid_active.
 */
export function planConversionRequest(args: {
  standing: AccountStanding;
  live: boolean;
  points: number;
  balance: number;
  convertedThisMonth: number;
}): ConversionPlan {
  const gate = moneyExitRefusal("conversion", args.standing);
  if (gate) return { outcome: "refused", error: gate };
  if (!args.live) {
    return {
      outcome: "refused",
      error:
        "Conversion isn't live yet. It activates at the November 20 launch, on the owner's separate on-chain go-live word — until then points keep earning, nothing converts, and no conversion is promised.",
    };
  }
  if (args.points % CONV_BLOCK_POINTS !== 0) {
    return {
      outcome: "refused",
      error: `Conversions run in ${CONV_BLOCK_POINTS.toLocaleString("en-US")}-point blocks — pick a multiple of ${CONV_BLOCK_POINTS.toLocaleString("en-US")}.`,
    };
  }
  if (args.balance < CONV_MIN_BALANCE) {
    return {
      outcome: "refused",
      error: `You need a balance of at least ${CONV_MIN_BALANCE.toLocaleString("en-US")} points to convert — yours is ${args.balance.toLocaleString("en-US")}.`,
    };
  }
  if (args.points > args.balance) {
    return {
      outcome: "refused",
      error: `That's more than your balance of ${args.balance.toLocaleString("en-US")} points.`,
    };
  }
  if (args.convertedThisMonth + args.points > CONV_MONTHLY_CAP_POINTS) {
    return {
      outcome: "refused",
      error: `The monthly cap is ${CONV_MONTHLY_CAP_POINTS.toLocaleString("en-US")} points per driver — you've already converted or queued ${args.convertedThisMonth.toLocaleString("en-US")} this month, so ${Math.max(0, CONV_MONTHLY_CAP_POINTS - args.convertedThisMonth).toLocaleString("en-US")} points of room are left.`,
    };
  }
  return { outcome: "queued", anchorUsd: anchorUsdForPoints(args.points) ?? 0 };
}
