import { describe, expect, test } from "bun:test";
import {
FLEET_CREATION_MEMBERSHIP_ERROR,
FLEET_CREATION_STANDING_ERROR,
FLEET_CREATION_UPGRADE_ERROR,
countFleetRosterSeats,
fleetBillingBasisChanged,
fleetCreationGate,
fleetCreationPlanTransition,
fleetSwitchBillingBasis,
fleetSwitchBillingLine,
fleetUsd,
type FleetBillingPeriod,
} from "./fleetCreation";
import { resolveEarningClass } from "./earningClass";

/**
 * FLEET-CREATION RIGHT (2026-10-27, Part C). These tests run the
 * EXACT pure decision createCompany runs in actions.ts
 * (fleetCreationGate, fed server-side by myMembership / myPlan /
 * myStanding), plus the post-creation facts the handler writes —
 * company role "owner", recorded plan transitioned to "owner" —
 * resolved through the Part B cohort (earningClass.ts) to prove
 * cohort continuity via the fleet-owner branch.
 */

const PAID_ACTIVE = "paid_active";

describe("fleet creation — allowed", () => {
  test("OO Gold paid_active may create (basis oo_gold_diamond)", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "gold", standingState: PAID_ACTIVE });
    expect(d.allowed).toBe(true);
    expect(d.basis).toBe("oo_gold_diamond");
    expect(d.error).toBeNull();
  });

  test("OO Diamond paid_active may create (basis oo_gold_diamond)", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "diamond", standingState: PAID_ACTIVE });
    expect(d.allowed).toBe(true);
    expect(d.basis).toBe("oo_gold_diamond");
    expect(d.error).toBeNull();
  });

  test("solo Owner-plan paid_active may create (basis fleet_owner_class)", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "owner", standingState: PAID_ACTIVE });
    expect(d.allowed).toBe(true);
    expect(d.basis).toBe("fleet_owner_class");
  });

  test("creator ends as company role owner on the owner/Fleet plan basis", () => {
    // The handler inserts the membership with role "owner" and runs
    // fleetCreationPlanTransition on the recorded plan.
    for (const plan of ["gold", "diamond"]) {
      const t = fleetCreationPlanTransition(plan);
      expect(t.fromPlan).toBe(plan);
      expect(t.toPlan).toBe("owner");
      expect(t.transitions).toBe(true);
    }
    // Already on the Owner plan: no transition, plan stays "owner".
    const t = fleetCreationPlanTransition("owner");
    expect(t.toPlan).toBe("owner");
    expect(t.transitions).toBe(false);
  });

  test("cohort continuity: after creation the creator resolves via the fleet-owner branch", () => {
    // Post-creation facts exactly as createCompany leaves them:
    // membership role "owner" + recorded plan "owner" + paid_active.
    for (const before of ["gold", "diamond", "owner"]) {
      const gate = fleetCreationGate({ membershipRole: null, plan: before, standingState: PAID_ACTIVE });
      expect(gate.allowed).toBe(true);
      const afterPlan = fleetCreationPlanTransition(before).toPlan;
      const ec = resolveEarningClass({
        membershipRole: "owner",
        plan: afterPlan,
        standingState: PAID_ACTIVE,
      });
      expect(ec.inCohort).toBe(true);
      expect(ec.kind).toBe("fleet_owner");
      expect(ec.milesMultiplier).toBe(2);
      expect(ec.label).toBe("2x miles earning — Fleet Owner");
    }
  });
});

describe("fleet creation — refused", () => {
  test("solo Basic (free standing) refused — upgrade path", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "basic", standingState: "free" });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe("upgrade");
    expect(d.error).toBe(FLEET_CREATION_UPGRADE_ERROR);
    expect(d.error).toContain("Owner-Operator Gold/Diamond");
    // Basic is refused on class even if a standing reads paid_active.
    expect(
      fleetCreationGate({ membershipRole: null, plan: "basic", standingState: PAID_ACTIVE }).refusal,
    ).toBe("upgrade");
  });

  test("solo Gold in_retainer refused — active-standing path", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "gold", standingState: "in_retainer" });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe("standing");
    expect(d.error).toBe(FLEET_CREATION_STANDING_ERROR);
    expect(d.error).toContain("active standing");
  });

  test("solo Gold lapsed_locked refused — active-standing path", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "gold", standingState: "lapsed_locked" });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe("standing");
    expect(d.error).toBe(FLEET_CREATION_STANDING_ERROR);
  });

  test("solo Gold reactivated_hold refused — active-standing path", () => {
    const d = fleetCreationGate({ membershipRole: null, plan: "gold", standingState: "reactivated_hold" });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe("standing");
    expect(d.error).toBe(FLEET_CREATION_STANDING_ERROR);
    // Diamond and the Owner plan take the same standing refusal.
    for (const plan of ["diamond", "owner"]) {
      expect(
        fleetCreationGate({ membershipRole: null, plan, standingState: "in_retainer" }).refusal,
      ).toBe("standing");
    }
  });

  test("company driver refused — membership held, at any plan", () => {
    for (const plan of ["basic", "gold", "diamond", "owner"]) {
      const d = fleetCreationGate({ membershipRole: "driver", plan, standingState: PAID_ACTIVE });
      expect(d.allowed).toBe(false);
      expect(d.refusal).toBe("membership");
      expect(d.error).toBe(FLEET_CREATION_MEMBERSHIP_ERROR);
    }
  });

  test("dispatch refused — membership held", () => {
    const d = fleetCreationGate({ membershipRole: "dispatch", plan: "owner", standingState: PAID_ACTIVE });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe("membership");
    expect(d.error).toBe(FLEET_CREATION_MEMBERSHIP_ERROR);
  });

  test("already a company owner refused — no second company", () => {
    const d = fleetCreationGate({ membershipRole: "owner", plan: "owner", standingState: PAID_ACTIVE });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe("membership");
    expect(d.error).toBe(FLEET_CREATION_MEMBERSHIP_ERROR);
  });
});

/**
 * FLEET-SWITCH BILLING BASIS (amendment, x 2026-10-27): an OO who
 * switches to Fleet Owner pays the DIFFERENCE from their current
 * subscription (same billing period, locked public prices) plus
 * $9.99/mo ($99/yr) per driver/dispatcher seat beyond the included
 * allowances (3 drivers, first dispatch seat). These tests run the
 * EXACT pure functions createCompany records and getCompany previews
 * (fleetSwitchBillingBasis / countFleetRosterSeats /
 * fleetSwitchBillingLine), plus the change detector the living
 * recompute (refreshFleetBillingBasis) runs on roster changes.
 */
describe("fleet-switch billing basis — difference math", () => {
  const solo = { driverSeats: 1, dispatchSeats: 0 };
  test("monthly: Gold OO pays $40.00 difference (49.99 − 9.99)", () => {
    const b = fleetSwitchBillingBasis({ fromPlan: "gold", period: "monthly", ...solo });
    expect(b.fromPriceCents).toBe(999);
    expect(b.fleetBaseCents).toBe(4999);
    expect(b.differenceCents).toBe(4000);
    expect(fleetUsd(b.differenceCents)).toBe("$40.00");
  });

  test("monthly: Diamond OO pays $30.00 difference (49.99 − 19.99) — x's example", () => {
    const b = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", ...solo });
    expect(b.fromPriceCents).toBe(1999);
    expect(b.differenceCents).toBe(3000);
    expect(fleetUsd(b.differenceCents)).toBe("$30.00");
  });

  test("monthly: already on Fleet/Owner pays $0.00 difference", () => {
    const b = fleetSwitchBillingBasis({ fromPlan: "owner", period: "monthly", ...solo });
    expect(b.fromPriceCents).toBe(4999);
    expect(b.differenceCents).toBe(0);
  });

  test("annual: difference computed on the annual prices (Gold $400, Diamond $300, Fleet $0)", () => {
    const gold = fleetSwitchBillingBasis({ fromPlan: "gold", period: "yearly", ...solo });
    expect(gold.fromPriceCents).toBe(9900);
    expect(gold.fleetBaseCents).toBe(49900);
    expect(gold.differenceCents).toBe(40000);
    const diamond = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "yearly", ...solo });
    expect(diamond.differenceCents).toBe(30000);
    const owner = fleetSwitchBillingBasis({ fromPlan: "owner", period: "yearly", ...solo });
    expect(owner.differenceCents).toBe(0);
  });

  test("legacy plan spellings normalize before pricing (full → diamond)", () => {
    const b = fleetSwitchBillingBasis({ fromPlan: "full", period: "monthly", ...solo });
    expect(b.fromPlan).toBe("diamond");
    expect(b.differenceCents).toBe(3000);
  });
});

describe("fleet-switch billing basis — seat counting", () => {
  test("roster at transition (creator alone) is inside the allowances — $0 seat charges", () => {
    const seats = countFleetRosterSeats([{ role: "owner" }]);
    expect(seats).toEqual({ driverSeats: 1, dispatchSeats: 0 });
    const b = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", ...seats });
    expect(b.extraSeats).toBe(0);
    expect(b.seatChargeCents).toBe(0);
    expect(b.totalFirstCycleCents).toBe(b.differenceCents);
  });

  test("full included allowances exactly — 3 drivers + 1 dispatch = $0 seat charges", () => {
    const seats = countFleetRosterSeats([
      { role: "owner" },
      { role: "driver" },
      { role: "driver" },
      { role: "dispatch" },
    ]);
    expect(seats).toEqual({ driverSeats: 3, dispatchSeats: 1 });
    const b = fleetSwitchBillingBasis({ fromPlan: "gold", period: "monthly", ...seats });
    expect(b.includedDriverSeats).toBe(3);
    expect(b.includedDispatchSeats).toBe(1);
    expect(b.extraDriverSeats).toBe(0);
    expect(b.extraDispatchSeats).toBe(0);
    expect(b.seatChargeCents).toBe(0);
  });

  test("extras are exact: 5 drivers + 3 dispatch = 2 + 2 extra seats × $9.99 = $39.96/mo", () => {
    const seats = countFleetRosterSeats([
      { role: "owner" },
      { role: "driver" },
      { role: "driver" },
      { role: "driver" },
      { role: "driver" },
      { role: "dispatch" },
      { role: "dispatch" },
      { role: "dispatch" },
    ]);
    expect(seats).toEqual({ driverSeats: 5, dispatchSeats: 3 });
    const b = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", ...seats });
    expect(b.extraDriverSeats).toBe(2);
    expect(b.extraDispatchSeats).toBe(2);
    expect(b.extraSeats).toBe(4);
    expect(b.seatRateCents).toBe(999);
    expect(b.seatChargeCents).toBe(3996);
    // Total first-cycle basis = difference + seat charges.
    expect(b.totalFirstCycleCents).toBe(3000 + 3996);
  });

  test("annual extras bill at $99/yr per seat", () => {
    const b = fleetSwitchBillingBasis({
      fromPlan: "gold",
      period: "yearly" as FleetBillingPeriod,
      driverSeats: 4,
      dispatchSeats: 1,
    });
    expect(b.extraSeats).toBe(1);
    expect(b.seatRateCents).toBe(9900);
    expect(b.seatChargeCents).toBe(9900);
    expect(b.totalFirstCycleCents).toBe(40000 + 9900);
  });

  test("living-basis change detector: same roster = no new record; grown roster = new record", () => {
    const before = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", driverSeats: 3, dispatchSeats: 1 });
    const same = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", driverSeats: 3, dispatchSeats: 1 });
    expect(fleetBillingBasisChanged(before, same)).toBe(false);
    const grown = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", driverSeats: 4, dispatchSeats: 1 });
    expect(fleetBillingBasisChanged(before, grown)).toBe(true);
    expect(grown.totalFirstCycleCents - before.totalFirstCycleCents).toBe(999);
    const shrunk = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", driverSeats: 2, dispatchSeats: 0 });
    expect(fleetBillingBasisChanged(before, shrunk)).toBe(true);
  });
});

describe("fleet-switch billing basis — itemization + switch copy", () => {
  test("the transition record's itemization carries every required field", () => {
    const b = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", driverSeats: 1, dispatchSeats: 0 });
    // previous plan, fleet plan, difference, included seats, extra
    // seats × rate, total first-cycle basis — all present, all exact.
    expect(b.fromPlan).toBe("diamond");
    expect(b.toPlan).toBe("owner");
    expect(b.period).toBe("monthly");
    expect(b.differenceCents).toBe(3000);
    expect(b.includedDriverSeats).toBe(3);
    expect(b.includedDispatchSeats).toBe(1);
    expect(b.extraSeats).toBe(0);
    expect(b.seatRateCents).toBe(999);
    expect(b.seatChargeCents).toBe(0);
    expect(b.totalFirstCycleCents).toBe(3000);
  });

  test("switch copy is x's line verbatim for the Diamond monthly case", () => {
    const b = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "monthly", driverSeats: 1, dispatchSeats: 0 });
    expect(fleetSwitchBillingLine(b)).toBe(
      "Switching to Fleet Owner: $30.00 difference from your Diamond plan + $9.99 per extra driver/dispatcher seat — charged when billing opens at app-store release; nothing is charged today.",
    );
  });

  test("switch copy follows the account's own figures (Gold monthly, Diamond annual)", () => {
    const gold = fleetSwitchBillingBasis({ fromPlan: "gold", period: "monthly", driverSeats: 1, dispatchSeats: 0 });
    expect(fleetSwitchBillingLine(gold)).toContain("$40.00 difference from your Gold plan");
    expect(fleetSwitchBillingLine(gold)).toContain("nothing is charged today");
    const annual = fleetSwitchBillingBasis({ fromPlan: "diamond", period: "yearly", driverSeats: 1, dispatchSeats: 0 });
    expect(fleetSwitchBillingLine(annual)).toContain("$300.00 difference from your Diamond plan");
    expect(fleetSwitchBillingLine(annual)).toContain("$99.00 per extra driver/dispatcher seat");
    const owner = fleetSwitchBillingBasis({ fromPlan: "owner", period: "monthly", driverSeats: 1, dispatchSeats: 0 });
    expect(fleetSwitchBillingLine(owner)).toContain("$0.00 difference from your Fleet Owner plan");
  });
});
