/**
 * SEALED MILES (owner-approved 2026-10-26; spec:
 * rewards-rework-proposal-2026-10-26.md § Sealed Miles; profit sim
 * Part 6 in rewards-profit-sim-2026-10-26.md PASSED the gate — task
 * conversions pay 100% at earner ratios 1.0 and 1.5, base and
 * zero-breakage stress, pool never negative).
 *
 * A sealed trip also earns points for the miles ON THE SEALED TRIP
 * RECORD (the trip-sheet / IFTA figure recorded at seal time — never
 * a live GPS estimate):
 * - paid tier: 1 point per 2.5 sealed miles (0.4 pts/mile)
 * - free/Basic tier: half rate (0.2 pts/mile)
 * - miles-only 2x cohort (2026-10-27, earningClass.ts; sim gate
 *   Part 9 PASSED): 1 point per 1.25 sealed miles (0.8 pts/mile)
 *   under a 16,000 pts/month ceiling. Cohort membership never
 *   changes the non-cohort math above.
 * The tier resolution is the SAME one the daily award path uses
 * (dailyPointsPaidTier in actions.ts — company/fleet-covered drivers
 * count as paid tier).
 *
 * Miles points accrue OUTSIDE the 500/day daily cap (like the
 * clean-week bonus), as points-ledger rows with source
 * "sealed_miles". Anti-fraud monthly ceilings cap miles awards per
 * driver-local calendar month: 8,000 pts/month paid tier, 4,000
 * pts/month free tier. Points are whole numbers: each trip's award
 * is floored and fractional value is NOT carried.
 *
 * CONVERSION ATTRIBUTION: conversions spend task-earned points
 * BEFORE miles points. A request's miles portion is whole
 * 1,000-point blocks only, capped at the driver's unconverted miles
 * balance (miles awards − miles portions of conversions already
 * paid or queued). In the Earning Pool queues, miles portions pay
 * LAST: (1) task portions of queued conversions, (2) welcome/yearly
 * credits, (3) miles portions. Points leave the ledger only as each
 * portion pays.
 *
 * Pure functions only: no I/O, unit-tested (sealedMiles.test.ts).
 * actions.ts resolves the tier and the ledger state and routes every
 * miles award / attribution through here.
 */

import { CONV_BLOCK_POINTS } from "./rewardsAnchor";

/** Points per sealed mile, paid tier: 1 point per 2.5 miles. */
export const SEALED_MILES_RATE_PAID = 0.4;

/** Points per sealed mile, free/Basic tier: half the paid rate. */
export const SEALED_MILES_RATE_FREE = 0.2;

/**
 * Points per sealed mile, miles-only 2x cohort (2026-10-27): 1 point
 * per 1.25 miles. Cohort membership is resolved in earningClass.ts;
 * sim gate Part 9 PASSED for this miles-only variant.
 */
export const SEALED_MILES_RATE_COHORT = 0.8;

/** Anti-fraud monthly ceiling on miles awards, paid tier. */
export const SEALED_MILES_MONTHLY_CEILING_PAID = 8000;

/** Anti-fraud monthly ceiling on miles awards, free tier. */
export const SEALED_MILES_MONTHLY_CEILING_FREE = 4000;

/** Anti-fraud monthly ceiling on miles awards, 2x cohort. */
export const SEALED_MILES_MONTHLY_CEILING_COHORT = 16000;

/** Points per sealed mile for the tier. */
export function sealedMilesRatePerMile(paidTier: boolean): number {
  return paidTier ? SEALED_MILES_RATE_PAID : SEALED_MILES_RATE_FREE;
}

/** Monthly miles-award ceiling for the tier. */
export function sealedMilesMonthlyCeiling(paidTier: boolean): number {
  return paidTier
    ? SEALED_MILES_MONTHLY_CEILING_PAID
    : SEALED_MILES_MONTHLY_CEILING_FREE;
}

/**
 * Points one sealed trip earns: floor(sealed miles × tier rate),
 * clamped so the month's miles awards never pass the tier ceiling
 * given what was already awarded from miles this month. Never
 * negative; a non-finite or non-positive mileage earns 0.
 * `alreadyAwardedThisMonth` is the NET miles total for the month
 * (awards minus void clawbacks — see milesAwardedInMonth), so a
 * clawed-back award frees ceiling room again, exactly like the
 * daily table's net-of-clawback accounting.
 */
export function sealedMilesPointsForTrip(
  sealedMiles: number,
  paidTier: boolean,
  alreadyAwardedThisMonth: number,
): number {
  if (!Number.isFinite(sealedMiles) || sealedMiles <= 0) return 0;
  const raw = Math.floor(sealedMiles * sealedMilesRatePerMile(paidTier));
  const already = Number.isFinite(alreadyAwardedThisMonth)
    ? Math.max(0, Math.floor(alreadyAwardedThisMonth))
    : 0;
  const room = sealedMilesMonthlyCeiling(paidTier) - already;
  if (room <= 0) return 0;
  return Math.max(0, Math.min(raw, room));
}

/** Points per sealed mile, honoring the 2x cohort when present. */
export function sealedMilesRatePerMileWithCohort(
  paidTier: boolean,
  inCohort: boolean,
): number {
  return inCohort ? SEALED_MILES_RATE_COHORT : sealedMilesRatePerMile(paidTier);
}

/** Monthly miles-award ceiling, honoring the 2x cohort when present. */
export function sealedMilesMonthlyCeilingWithCohort(
  paidTier: boolean,
  inCohort: boolean,
): number {
  return inCohort
    ? SEALED_MILES_MONTHLY_CEILING_COHORT
    : sealedMilesMonthlyCeiling(paidTier);
}

/**
 * Points one sealed trip earns for a driver who may be in the 2x
 * cohort: floor(sealed miles × cohort-or-tier rate), clamped so the
 * month's miles awards never pass the cohort-or-tier ceiling given
 * what was already awarded from miles this month (NET of clawbacks,
 * exactly like sealedMilesPointsForTrip). A non-cohort call is
 * byte-identical to sealedMilesPointsForTrip — the cohort branch is
 * the only new arithmetic, and points already earned are never
 * re-rated (the award path's refKey idempotency is unchanged).
 */
export function sealedMilesPointsForTripWithCohort(
  sealedMiles: number,
  paidTier: boolean,
  inCohort: boolean,
  alreadyAwardedThisMonth: number,
): number {
  if (!inCohort) {
    return sealedMilesPointsForTrip(sealedMiles, paidTier, alreadyAwardedThisMonth);
  }
  if (!Number.isFinite(sealedMiles) || sealedMiles <= 0) return 0;
  const raw = Math.floor(sealedMiles * SEALED_MILES_RATE_COHORT);
  const already = Number.isFinite(alreadyAwardedThisMonth)
    ? Math.max(0, Math.floor(alreadyAwardedThisMonth))
    : 0;
  const room = SEALED_MILES_MONTHLY_CEILING_COHORT - already;
  if (room <= 0) return 0;
  return Math.max(0, Math.min(raw, room));
}

/** Driver-local (America/Chicago) calendar month key, YYYY-MM. */
export function milesMonthKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  }).format(d);
}

type MilesLedgerRow = { amount: number; source: string; createdAt: Date };

/**
 * NET points awarded from miles in the driver-local calendar month
 * containing `when`: every "sealed_miles" ledger row in that month,
 * awards positive and void clawbacks negative (a clawback is stamped
 * with its award's instant, so it nets inside the award's month).
 */
export function milesAwardedInMonth(rows: MilesLedgerRow[], when: Date): number {
  const mk = milesMonthKey(when);
  return rows
    .filter((r) => r.source === "sealed_miles" && milesMonthKey(r.createdAt) === mk)
    .reduce((s, r) => s + r.amount, 0);
}

/** NET miles points across the whole ledger (awards − clawbacks). */
export function netSealedMilesPoints(rows: MilesLedgerRow[]): number {
  return rows
    .filter((r) => r.source === "sealed_miles")
    .reduce((s, r) => s + r.amount, 0);
}

/**
 * Miles points not yet committed to any conversion: net miles
 * awards minus the miles portions of conversions already paid or
 * queued. Never negative (a void clawback can push awards below
 * what queued rows already committed — the committed portions stand
 * and the unconverted balance simply reads 0).
 */
export function unconvertedMilesBalance(
  netMilesPoints: number,
  committedMilesPortions: number,
): number {
  const awards = Number.isFinite(netMilesPoints) ? Math.floor(netMilesPoints) : 0;
  const committed = Number.isFinite(committedMilesPortions)
    ? Math.max(0, Math.floor(committedMilesPortions))
    : 0;
  return Math.max(0, awards - committed);
}

/**
 * The miles portion of a conversion request, in whole 1,000-point
 * blocks only: min(requested points, floor(unconverted miles
 * balance / 1000) × 1000). Never negative, never past the request,
 * never past the unconverted miles balance's whole blocks.
 */
export function milesPortionForRequest(
  requestedPoints: number,
  unconvertedMiles: number,
): number {
  if (!Number.isFinite(requestedPoints) || requestedPoints <= 0) return 0;
  if (!Number.isFinite(unconvertedMiles) || unconvertedMiles <= 0) return 0;
  const blocks = Math.floor(unconvertedMiles / CONV_BLOCK_POINTS) * CONV_BLOCK_POINTS;
  return Math.max(0, Math.min(Math.floor(requestedPoints), blocks));
}

/**
 * Split a conversion into its task and miles portions. The miles
 * portion is clamped to whole blocks within [0, points]; the task
 * portion is the remainder — task-earned points always spend first.
 */
export function conversionPortions(
  points: number,
  milesPoints: number,
): { taskPoints: number; milesPoints: number } {
  const total = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  let miles = Number.isFinite(milesPoints) ? Math.floor(milesPoints) : 0;
  miles = Math.max(0, Math.min(total, miles));
  miles = Math.floor(miles / CONV_BLOCK_POINTS) * CONV_BLOCK_POINTS;
  return { taskPoints: total - miles, milesPoints: miles };
}
