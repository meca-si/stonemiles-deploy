import { describe, expect, test } from "bun:test";
import {
cohortReasonDescriptor,
isInMilesCohort,
resolveEarningClass,
} from "./earningClass";
import {
SEALED_MILES_MONTHLY_CEILING_COHORT,
SEALED_MILES_MONTHLY_CEILING_FREE,
SEALED_MILES_MONTHLY_CEILING_PAID,
SEALED_MILES_RATE_COHORT,
SEALED_MILES_RATE_FREE,
SEALED_MILES_RATE_PAID,
milesAwardedInMonth,
sealedMilesMonthlyCeilingWithCohort,
sealedMilesPointsForTrip,
sealedMilesPointsForTripWithCohort,
sealedMilesRatePerMileWithCohort,
} from "./sealedMiles";

/**
 * MILES-ONLY 2x COHORT (2026-10-27; sim gate Part 9 PASSED for the
 * miles-only variant; FULL 2x stays unshipped; receipt bonus stays
 * 15). These tests run the EXACT pure decisions the server paths
 * run: resolveEarningClass in earningClass.ts (fed server-side by
 * myMembership / myPlan / myStanding in actions.ts) and the cohort
 * math in sealedMiles.ts that awardSealedMiles routes through
 * (sealedMilesPointsForTripWithCohort).
 */

const PAID_ACTIVE = "paid_active";

describe("earning class — cohort matrix", () => {
  test("OO Gold paid_active IN (2x, oo, Gold label)", () => {
    const ec = resolveEarningClass({ membershipRole: null, plan: "gold", standingState: PAID_ACTIVE });
    expect(ec.inCohort).toBe(true);
    expect(ec.milesMultiplier).toBe(2);
    expect(ec.kind).toBe("oo");
    expect(ec.label).toBe("2x miles earning — Owner-Operator Gold");
    expect(ec.milesRatePerMile).toBe(0.8);
    expect(ec.milesMonthlyCeiling).toBe(16000);
    expect(isInMilesCohort({ membershipRole: null, plan: "gold", standingState: PAID_ACTIVE })).toBe(true);
  });

  test("OO Diamond paid_active IN (2x, oo, Diamond label)", () => {
    const ec = resolveEarningClass({ membershipRole: null, plan: "diamond", standingState: PAID_ACTIVE });
    expect(ec.inCohort).toBe(true);
    expect(ec.milesMultiplier).toBe(2);
    expect(ec.kind).toBe("oo");
    expect(ec.label).toBe("2x miles earning — Owner-Operator Diamond");
    expect(ec.milesRatePerMile).toBe(SEALED_MILES_RATE_COHORT);
    expect(ec.milesMonthlyCeiling).toBe(SEALED_MILES_MONTHLY_CEILING_COHORT);
    expect(cohortReasonDescriptor(ec)).toBe("Owner-Operator Diamond");
  });

  test("Fleet owner (role owner + plan owner) paid_active IN", () => {
    const ec = resolveEarningClass({ membershipRole: "owner", plan: "owner", standingState: PAID_ACTIVE });
    expect(ec.inCohort).toBe(true);
    expect(ec.milesMultiplier).toBe(2);
    expect(ec.kind).toBe("fleet_owner");
    expect(ec.label).toBe("2x miles earning — Fleet Owner");
    expect(ec.milesRatePerMile).toBe(0.8);
    expect(ec.milesMonthlyCeiling).toBe(16000);
    expect(cohortReasonDescriptor(ec)).toBe("Fleet Owner");
  });

  test("company driver on Diamond OUT — drivers are never in the cohort at any tier", () => {
    const ec = resolveEarningClass({ membershipRole: "driver", plan: "diamond", standingState: PAID_ACTIVE });
    expect(ec.inCohort).toBe(false);
    expect(ec.milesMultiplier).toBe(1);
    expect(ec.kind).toBeNull();
    expect(ec.label).toBe("Standard miles earning");
    // paid tier underneath: today's rate/ceiling, unchanged
    expect(ec.milesRatePerMile).toBe(SEALED_MILES_RATE_PAID);
    expect(ec.milesMonthlyCeiling).toBe(SEALED_MILES_MONTHLY_CEILING_PAID);
    expect(cohortReasonDescriptor(ec)).toBeNull();
  });

  test("company driver on Owner-plan install OUT (role driver decides, not the install plan)", () => {
    const ec = resolveEarningClass({ membershipRole: "driver", plan: "owner", standingState: PAID_ACTIVE });
    expect(ec.inCohort).toBe(false);
    expect(ec.milesMultiplier).toBe(1);
    expect(ec.kind).toBeNull();
    expect(ec.milesRatePerMile).toBe(0.4);
    expect(ec.milesMonthlyCeiling).toBe(8000);
  });

  test("dispatch OUT at every plan", () => {
    for (const plan of ["basic", "gold", "diamond", "owner"]) {
      const ec = resolveEarningClass({ membershipRole: "dispatch", plan, standingState: PAID_ACTIVE });
      expect(ec.inCohort).toBe(false);
      expect(ec.milesMultiplier).toBe(1);
      expect(ec.kind).toBeNull();
    }
  });

  test("OO Basic OUT — free/Basic never doubles, standard free rate/ceiling", () => {
    const ec = resolveEarningClass({ membershipRole: null, plan: "basic", standingState: PAID_ACTIVE });
    expect(ec.inCohort).toBe(false);
    expect(ec.milesRatePerMile).toBe(SEALED_MILES_RATE_FREE);
    expect(ec.milesMonthlyCeiling).toBe(SEALED_MILES_MONTHLY_CEILING_FREE);
    // a free standing is also out, whatever the plan reads
    expect(
      resolveEarningClass({ membershipRole: null, plan: "basic", standingState: "free" }).inCohort,
    ).toBe(false);
  });

  test("OO Gold in_retainer / lapsed_locked / reactivated_hold OUT — 2x follows paid_active only", () => {
    for (const standingState of ["in_retainer", "lapsed_locked", "reactivated_hold", "free"]) {
      const ec = resolveEarningClass({ membershipRole: null, plan: "gold", standingState });
      expect(ec.inCohort).toBe(false);
      expect(ec.milesMultiplier).toBe(1);
      expect(ec.kind).toBeNull();
      expect(ec.label).toBe("Standard miles earning");
      // underneath, the paid tier's standard rate/ceiling still apply
      expect(ec.milesRatePerMile).toBe(0.4);
      expect(ec.milesMonthlyCeiling).toBe(8000);
    }
    // the fleet owner loses the 2x the same way when not paid_active
    for (const standingState of ["in_retainer", "lapsed_locked", "reactivated_hold"]) {
      expect(
        resolveEarningClass({ membershipRole: "owner", plan: "owner", standingState }).inCohort,
      ).toBe(false);
    }
    // and regains it the moment standing is paid_active again
    expect(
      resolveEarningClass({ membershipRole: null, plan: "gold", standingState: PAID_ACTIVE }).inCohort,
    ).toBe(true);
  });

  test("near-misses stay OUT: OO on the Owner plan alone is not fleet; fleet role without the Owner plan is not fleet", () => {
    // No membership + plan owner: branch (a) needs gold/diamond, branch (b) needs the owner role.
    expect(
      resolveEarningClass({ membershipRole: null, plan: "owner", standingState: PAID_ACTIVE }).inCohort,
    ).toBe(false);
    // Company owner whose recorded plan is not "owner": branch (b) needs plan owner.
    expect(
      resolveEarningClass({ membershipRole: "owner", plan: "diamond", standingState: PAID_ACTIVE }).inCohort,
    ).toBe(false);
    expect(
      resolveEarningClass({ membershipRole: "owner", plan: "gold", standingState: PAID_ACTIVE }).inCohort,
    ).toBe(false);
  });
});

describe("cohort miles math (sealedMiles cohort extension)", () => {
  test("cohort constants: 0.8 pts/mile (1 per 1.25 miles), 16,000 ceiling", () => {
    expect(SEALED_MILES_RATE_COHORT).toBe(0.8);
    expect(SEALED_MILES_MONTHLY_CEILING_COHORT).toBe(16000);
    expect(sealedMilesRatePerMileWithCohort(true, true)).toBe(0.8);
    expect(sealedMilesRatePerMileWithCohort(false, true)).toBe(0.8);
    expect(sealedMilesMonthlyCeilingWithCohort(true, true)).toBe(16000);
  });

  test("cohort per-trip award: floor at 0.8/mi, fractional value not carried", () => {
    expect(sealedMilesPointsForTripWithCohort(1.25, true, true, 0)).toBe(1);
    expect(sealedMilesPointsForTripWithCohort(2500, true, true, 0)).toBe(2000);
    expect(sealedMilesPointsForTripWithCohort(101, true, true, 0)).toBe(80); // 80.8 → 80
    expect(sealedMilesPointsForTripWithCohort(1, true, true, 0)).toBe(0); // 0.8 → 0
    expect(sealedMilesPointsForTripWithCohort(0, true, true, 0)).toBe(0);
    expect(sealedMilesPointsForTripWithCohort(-50, true, true, 0)).toBe(0);
    expect(sealedMilesPointsForTripWithCohort(Number.NaN, true, true, 0)).toBe(0);
  });

  test("cohort ceiling clamp: 16,000/month, already-awarded accounting", () => {
    expect(sealedMilesPointsForTripWithCohort(100000, true, true, 0)).toBe(16000);
    expect(sealedMilesPointsForTripWithCohort(1000, true, true, 15900)).toBe(100); // raw 800, room 100
    expect(sealedMilesPointsForTripWithCohort(1000, true, true, 16000)).toBe(0);
    expect(sealedMilesPointsForTripWithCohort(1000, true, true, 99999)).toBe(0);
    expect(sealedMilesPointsForTripWithCohort(1000, true, true, Number.NaN)).toBe(800);
  });

  test("month netting with clawbacks: a clawed-back cohort award frees ceiling room", () => {
    type Row = { amount: number; source: string; createdAt: Date; refKey?: string };
    const NOV5 = new Date("2026-11-05T15:00:00Z");
    const NOV20 = new Date("2026-11-20T15:00:00Z");
    const ledger: Row[] = [];
    const award = (tripId: number, miles: number, at: Date): number => {
      const already = milesAwardedInMonth(ledger, at);
      const points = sealedMilesPointsForTripWithCohort(miles, true, true, already);
      if (points > 0) {
        ledger.push({ amount: points, source: "sealed_miles", createdAt: at, refKey: `sealed_miles:trip:${tripId}` });
      }
      return points;
    };
    expect(award(1, 20000, NOV5)).toBe(16000); // at the cohort ceiling
    expect(award(2, 2500, NOV20)).toBe(0); // no room left
    // void clawback: negative row stamped at the award's instant, like voidPodSeal
    ledger.push({ amount: -16000, source: "sealed_miles", createdAt: NOV5, refKey: "clawback:sealed_miles:1" });
    expect(milesAwardedInMonth(ledger, NOV20)).toBe(0); // nets inside the award's month
    expect(award(3, 2500, NOV20)).toBe(2000); // freed room earns again at the cohort rate
  });

  test("non-cohort math is byte-identical to today's sealedMilesPointsForTrip", () => {
    for (const paidTier of [true, false]) {
      expect(sealedMilesRatePerMileWithCohort(paidTier, false)).toBe(paidTier ? 0.4 : 0.2);
      expect(sealedMilesMonthlyCeilingWithCohort(paidTier, false)).toBe(paidTier ? 8000 : 4000);
      for (const miles of [0, 1, 2.5, 101, 2500, 10000, 100000]) {
        for (const already of [0, 100, 3950, 7900, 8000, 99999]) {
          expect(sealedMilesPointsForTripWithCohort(miles, paidTier, false, already)).toBe(
            sealedMilesPointsForTrip(miles, paidTier, already),
          );
        }
      }
    }
  });
});
