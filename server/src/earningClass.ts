/**
 * EARNING CLASS — miles-only 2x cohort (owner-approved narrower 2x,
 * 2026-10-27; sim gate Part 9 in rewards-profit-sim-2026-10-26.md
 * PASSED for the miles-only variant — script
 * rewards-profit-sim-narrow2x-2026-10-27.mjs; the FULL 2x — doubled
 * daily table + 1,000 cap — FAILED its gate and stays UNSHIPPED, and
 * the fuel receipt bonus stays 15 for everyone).
 *
 * Pure functions only: no I/O, unit-tested (earningClass.test.ts).
 * actions.ts resolves the caller's facts server-side (company
 * membership via myMembership, recorded plan via myPlan /
 * normalizePlan, standing via myStanding / resolveStanding) and runs
 * every cohort decision through here. The cohort is NEVER
 * client-supplied.
 *
 * IN the cohort (miles multiplier 2) ONLY when the standing state is
 * "paid_active" AND either:
 *   (a) no company membership (owner-operator) AND plan is gold or
 *       diamond; or
 *   (b) company role "owner" AND plan is "owner" (Fleet).
 * Company drivers (role driver) are NEVER in the cohort at any tier;
 * dispatch never; free/Basic never; any non-paid_active standing
 * (free, in_retainer, lapsed_locked, reactivated_hold) never — a
 * lapsed owner-operator loses the 2x until paid_active again.
 *
 * The cohort changes SEALED MILES only: rate 0.8 pts/mile (1 point
 * per 1.25 miles) and monthly ceiling 16,000 pts (see sealedMiles.ts).
 * Daily table values, the 500 cap, welcome/yearly credits, referral
 * points, and the fuel receipt bonus are NOT multiplied.
 */

import {
SEALED_MILES_MONTHLY_CEILING_COHORT,
SEALED_MILES_MONTHLY_CEILING_FREE,
SEALED_MILES_MONTHLY_CEILING_PAID,
SEALED_MILES_RATE_COHORT,
SEALED_MILES_RATE_FREE,
SEALED_MILES_RATE_PAID,
} from "./sealedMiles";

export type EarningClassKind = "oo" | "fleet_owner" | null;

export interface EarningClass {
  milesMultiplier: 1 | 2;
  kind: EarningClassKind;
  label: string;
  milesRatePerMile: number;
  milesMonthlyCeiling: number;
  inCohort: boolean;
}

/** Normalize a recorded plan the same way actions.ts does
 *  (simple → basic, full → diamond; unknown → diamond default is NOT
 *  applied here — callers pass myPlan's already-normalized value, and
 *  an unknown value simply matches no cohort branch). */
function normalizePlanInput(raw: string | null | undefined): string {
  if (raw === "simple") return "basic";
  if (raw === "full") return "diamond";
  return raw ?? "";
}

function isPaidPlan(plan: string): boolean {
  return plan === "gold" || plan === "diamond" || plan === "owner";
}

/**
 * Resolve the earning class from server-side facts.
 * - `membershipRole`: null = no company membership (owner-operator);
 *   otherwise the company role ("owner" | "driver" | "dispatch").
 * - `plan`: the recorded plan, normalized (basic|gold|diamond|owner).
 * - `standingState`: the resolved account standing state.
 */
export function resolveEarningClass(args: {
  membershipRole: string | null;
  plan: string;
  standingState: string;
}): EarningClass {
  const plan = normalizePlanInput(args.plan);
  const role = args.membershipRole;
  const paidActive = args.standingState === "paid_active";

  if (paidActive && role == null && (plan === "gold" || plan === "diamond")) {
    const planWord = plan === "diamond" ? "Diamond" : "Gold";
    return {
      milesMultiplier: 2,
      kind: "oo",
      label: `2x miles earning — Owner-Operator ${planWord}`,
      milesRatePerMile: SEALED_MILES_RATE_COHORT,
      milesMonthlyCeiling: SEALED_MILES_MONTHLY_CEILING_COHORT,
      inCohort: true,
    };
  }

  if (paidActive && role === "owner" && plan === "owner") {
    return {
      milesMultiplier: 2,
      kind: "fleet_owner",
      label: "2x miles earning — Fleet Owner",
      milesRatePerMile: SEALED_MILES_RATE_COHORT,
      milesMonthlyCeiling: SEALED_MILES_MONTHLY_CEILING_COHORT,
      inCohort: true,
    };
  }

  const paid = isPaidPlan(plan);
  return {
    milesMultiplier: 1,
    kind: null,
    label: "Standard miles earning",
    milesRatePerMile: paid ? SEALED_MILES_RATE_PAID : SEALED_MILES_RATE_FREE,
    milesMonthlyCeiling: paid
      ? SEALED_MILES_MONTHLY_CEILING_PAID
      : SEALED_MILES_MONTHLY_CEILING_FREE,
    inCohort: false,
  };
}

/** Is this fact set in the miles-only 2x cohort? */
export function isInMilesCohort(args: {
  membershipRole: string | null;
  plan: string;
  standingState: string;
}): boolean {
  return resolveEarningClass(args).inCohort;
}

/**
 * The cohort descriptor used inside the sealed-miles ledger reason:
 * "Owner-Operator Diamond" / "Owner-Operator Gold" / "Fleet Owner",
 * or null when not in the cohort (non-cohort reason strings stay
 * exactly as they were before the cohort existed).
 */
export function cohortReasonDescriptor(ec: EarningClass): string | null {
  if (!ec.inCohort) return null;
  // The label is "2x miles earning — <descriptor>".
  const idx = ec.label.indexOf("— ");
  return idx >= 0 ? ec.label.slice(idx + 2) : ec.label;
}
