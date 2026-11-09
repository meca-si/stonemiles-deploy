/**
 * FLEET-CREATION RIGHT — owner-operator Gold/Diamond (locked by x,
 * 2026-10-27; Part C of the narrower-2x order).
 *
 * Pure functions only: no I/O, unit-tested (fleetCreation.test.ts).
 * actions.ts resolves the caller's facts server-side (company
 * membership via myMembership, recorded plan via myPlan /
 * normalizePlan, standing via myStanding / resolveStanding) and runs
 * every createCompany decision through here. The right is NEVER
 * client-supplied.
 *
 * Creating a fleet requires BOTH:
 *   (a) no existing company membership — company drivers and dispatch
 *       hold a membership and can never create a fleet; a company
 *       owner cannot create a second company; AND
 *   (b) an eligible class in ACTIVE standing (paid_active):
 *       - the owner-operator branch: no membership + plan gold or
 *         diamond + paid_active (the Part B cohort's OO branch), or
 *       - the fleet-owner class: no membership + plan "owner" +
 *         paid_active (a solo account already recorded on Fleet
 *         pricing).
 *
 * On creation the creator's recorded plan transitions to "owner"
 * (Fleet pricing from creation) through the same recorded-plan
 * transition path a normal plan change uses — see createCompany in
 * actions.ts. NO charge is taken and NO checkout is faked: billing
 * begins at app-store release, like all billing in this app.
 *
 * FLEET-SWITCH BILLING BASIS (amendment locked by x, 2026-10-27):
 * an owner-operator who switches to Fleet Owner pays the DIFFERENCE
 * from their current subscription plus per-seat charges for driver /
 * dispatcher seats beyond the Fleet plan's included allowances. The
 * basis is computed, itemized, recorded (subscription event + sealed
 * chain entry) and shown BEFORE the owner confirms the switch — it is
 * what WILL be charged when billing opens at app-store release;
 * nothing is charged today. The basis is a living figure: it is
 * recomputed from the company's roster whenever the roster changes
 * (see refreshFleetBillingBasis in actions.ts), and each change is
 * recorded the same way. An OO switching back down is out of scope —
 * no downgrade flow exists.
 */

/** Why a creation was refused, in refusal-priority order. */
export type FleetCreationRefusal = "membership" | "upgrade" | "standing";

export type FleetCreationDecision =
  | {
      allowed: true;
      /** Which eligible class the creator qualified under. */
      basis: "oo_gold_diamond" | "fleet_owner_class";
      refusal: null;
      error: null;
    }
  | {
      allowed: false;
      basis: null;
      refusal: FleetCreationRefusal;
      /** Plain driver language with the path forward. */
      error: string;
    };

export const FLEET_CREATION_MEMBERSHIP_ERROR =
  "You already belong to a company — leave it first.";

export const FLEET_CREATION_UPGRADE_ERROR =
  "Creating a fleet is an Owner-Operator Gold/Diamond right — upgrade to Gold or Diamond first, and keep the account active, then you can create your fleet here.";

export const FLEET_CREATION_STANDING_ERROR =
  "Creating a fleet unlocks when your account is back in active standing — renew or finish your reactivation hold, and the fleet-creation right is yours again.";

/** Normalize a recorded plan the same way earningClass.ts does
 *  (simple → basic, full → diamond; callers pass myPlan's
 *  already-normalized value, and an unknown value matches no
 *  eligible branch). */
function normalizePlanInput(raw: string | null | undefined): string {
  if (raw === "simple") return "basic";
  if (raw === "full") return "diamond";
  return raw ?? "";
}

/**
 * The fleet-creation gate, from server-side facts.
 * - `membershipRole`: null = no company membership (solo); otherwise
 *   the company role ("owner" | "driver" | "dispatch").
 * - `plan`: the recorded plan, normalized (basic|gold|diamond|owner).
 * - `standingState`: the resolved account standing state.
 */
export function fleetCreationGate(args: {
  membershipRole: string | null;
  plan: string;
  standingState: string;
}): FleetCreationDecision {
  // (a) Any membership at all ends it — company drivers and dispatch
  // can never create, and a company owner can't create a second one.
  if (args.membershipRole != null) {
    return {
      allowed: false,
      basis: null,
      refusal: "membership",
      error: FLEET_CREATION_MEMBERSHIP_ERROR,
    };
  }
  const plan = normalizePlanInput(args.plan);
  const paidActive = args.standingState === "paid_active";
  // (b) Owner-operator branch: Gold/Diamond in active standing.
  if ((plan === "gold" || plan === "diamond") && paidActive) {
    return { allowed: true, basis: "oo_gold_diamond", refusal: null, error: null };
  }
  // (b) Fleet-owner class: already recorded on the Owner plan, solo,
  // in active standing — Fleet pricing already applies.
  if (plan === "owner" && paidActive) {
    return { allowed: true, basis: "fleet_owner_class", refusal: null, error: null };
  }
  // Eligible plan, wrong standing (retainer / lapsed / reactivation
  // hold): the right returns with active standing — no upgrade talk.
  if (plan === "gold" || plan === "diamond" || plan === "owner") {
    return {
      allowed: false,
      basis: null,
      refusal: "standing",
      error: FLEET_CREATION_STANDING_ERROR,
    };
  }
  // Basic / free solo: fleet creation is a Gold/Diamond right.
  return {
    allowed: false,
    basis: null,
    refusal: "upgrade",
    error: FLEET_CREATION_UPGRADE_ERROR,
  };
}

/** The plan the creator's record transitions to at fleet creation:
 *  "owner" (Fleet pricing from creation) — unless the record is
 *  already on the Owner plan, in which case nothing transitions. */
export function fleetCreationPlanTransition(plan: string): {
  fromPlan: string;
  toPlan: "owner";
  transitions: boolean;
} {
  const fromPlan = normalizePlanInput(plan);
  return { fromPlan, toPlan: "owner", transitions: fromPlan !== "owner" };
}

// ---- Fleet-switch billing basis (x, 2026-10-27) -----------------------------

/** LOCKED public plan prices, in cents (x, 2026-10-22 — the same
 *  prices the Plans surface shows; change only on x's word):
 *  Gold $9.99/mo · $99/yr, Diamond $19.99/mo · $199/yr,
 *  Fleet/Owner $49.99/mo · $499/yr. Basic is free. */
export const PLAN_PRICE_CENTS: Record<
  "basic" | "gold" | "diamond" | "owner",
  { monthly: number; yearly: number }
> = {
  basic: { monthly: 0, yearly: 0 },
  gold: { monthly: 999, yearly: 9900 },
  diamond: { monthly: 1999, yearly: 19900 },
  owner: { monthly: 4999, yearly: 49900 },
};

/** Seats included in the Fleet (Owner) base price: up to 3
 *  trucks/drivers and the first dispatch seat. */
export const FLEET_INCLUDED_DRIVER_SEATS = 3;
export const FLEET_INCLUDED_DISPATCH_SEATS = 1;

/** Per-seat charge beyond the included allowances, in cents:
 *  $9.99/mo billed monthly, $99/yr billed annually — per extra driver
 *  OR dispatcher seat (the locked Owner-plan add-on rate). */
export const FLEET_EXTRA_SEAT_CENTS = { monthly: 999, yearly: 9900 } as const;

export type FleetBillingPeriod = "monthly" | "yearly";

/** Short plan label for the switch copy ("your Diamond plan"). */
export function fleetPlanShortLabel(plan: string): string {
  const p = normalizePlanInput(plan);
  if (p === "gold") return "Gold";
  if (p === "diamond") return "Diamond";
  if (p === "owner") return "Fleet Owner";
  return "Basic";
}

/** Cents → "$30.00" (exact, no rounding surprises — all inputs are
 *  already integer cents). */
export function fleetUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Seat counts from a company roster. The owner occupies one of the
 * driver/truck seats (an owner-operator drives one of the fleet's
 * trucks — the same counting the Owner plan's "up to 3 trucks" uses);
 * members with role "driver" fill the rest. Dispatch seats are
 * members with role "dispatch".
 */
export function countFleetRosterSeats(members: readonly { role: string }[]): {
  driverSeats: number;
  dispatchSeats: number;
} {
  let driverSeats = 0;
  let dispatchSeats = 0;
  for (const m of members) {
    if (m.role === "owner" || m.role === "driver") driverSeats += 1;
    else if (m.role === "dispatch") dispatchSeats += 1;
  }
  return { driverSeats, dispatchSeats };
}

/** The full itemized fleet-switch billing basis. All amounts are
 *  integer cents on the account's own billing period. */
export interface FleetBillingBasis {
  /** The switching account's recorded plan before the switch. */
  fromPlan: string;
  /** Always the Fleet plan. */
  toPlan: "owner";
  /** The billing period the account is on — the difference is
   *  computed on this same period. */
  period: FleetBillingPeriod;
  /** What the account's current plan costs per cycle, cents. */
  fromPriceCents: number;
  /** The Fleet base price per cycle, cents. */
  fleetBaseCents: number;
  /** Fleet base − current plan price (never negative; an account
   *  already on the Fleet/Owner plan pays $0 difference). */
  differenceCents: number;
  includedDriverSeats: number;
  includedDispatchSeats: number;
  /** Roster seats at the moment of computation. */
  driverSeats: number;
  dispatchSeats: number;
  extraDriverSeats: number;
  extraDispatchSeats: number;
  extraSeats: number;
  /** Per-extra-seat rate on this period, cents. */
  seatRateCents: number;
  /** extraSeats × seatRateCents. */
  seatChargeCents: number;
  /** difference + seat charges — the first-cycle fleet billing
   *  basis: what will be charged per cycle when billing opens. */
  totalFirstCycleCents: number;
}

/**
 * The fleet-switch billing basis (x, 2026-10-27): difference from the
 * current subscription (Fleet base − current plan price, same billing
 * period) + $9.99/mo ($99/yr) per driver/dispatcher seat beyond the
 * included allowances (3 drivers, first dispatch seat).
 */
export function fleetSwitchBillingBasis(args: {
  fromPlan: string;
  period: FleetBillingPeriod;
  driverSeats: number;
  dispatchSeats: number;
}): FleetBillingBasis {
  const fromPlan = normalizePlanInput(args.fromPlan);
  const fromPrices =
    fromPlan === "basic" || fromPlan === "gold" || fromPlan === "diamond" || fromPlan === "owner"
      ? PLAN_PRICE_CENTS[fromPlan]
      : undefined;
  const fromPriceCents = fromPrices?.[args.period] ?? 0;
  const fleetBaseCents = PLAN_PRICE_CENTS.owner[args.period];
  const differenceCents = Math.max(0, fleetBaseCents - fromPriceCents);
  const driverSeats = Math.max(0, Math.floor(args.driverSeats));
  const dispatchSeats = Math.max(0, Math.floor(args.dispatchSeats));
  const extraDriverSeats = Math.max(0, driverSeats - FLEET_INCLUDED_DRIVER_SEATS);
  const extraDispatchSeats = Math.max(0, dispatchSeats - FLEET_INCLUDED_DISPATCH_SEATS);
  const extraSeats = extraDriverSeats + extraDispatchSeats;
  const seatRateCents = FLEET_EXTRA_SEAT_CENTS[args.period];
  const seatChargeCents = extraSeats * seatRateCents;
  return {
    fromPlan,
    toPlan: "owner",
    period: args.period,
    fromPriceCents,
    fleetBaseCents,
    differenceCents,
    includedDriverSeats: FLEET_INCLUDED_DRIVER_SEATS,
    includedDispatchSeats: FLEET_INCLUDED_DISPATCH_SEATS,
    driverSeats,
    dispatchSeats,
    extraDriverSeats,
    extraDispatchSeats,
    extraSeats,
    seatRateCents,
    seatChargeCents,
    totalFirstCycleCents: differenceCents + seatChargeCents,
  };
}

/** Whether a recomputed basis differs from the last recorded one in
 *  any figure that changes what will be charged (used by the living
 *  recompute on roster changes — a record is appended only when the
 *  basis actually moved). */
export function fleetBillingBasisChanged(
  prev: {
    driverSeats: number;
    dispatchSeats: number;
    seatChargeCents: number;
    totalFirstCycleCents: number;
  },
  next: FleetBillingBasis,
): boolean {
  return (
    prev.driverSeats !== next.driverSeats ||
    prev.dispatchSeats !== next.dispatchSeats ||
    prev.seatChargeCents !== next.seatChargeCents ||
    prev.totalFirstCycleCents !== next.totalFirstCycleCents
  );
}

/** The plain before-you-confirm line for the switch (x's copy,
 *  2026-10-27; amounts are the account's own computed figures). */
export function fleetSwitchBillingLine(basis: FleetBillingBasis): string {
  return (
    `Switching to Fleet Owner: ${fleetUsd(basis.differenceCents)} difference from your ` +
    `${fleetPlanShortLabel(basis.fromPlan)} plan + ${fleetUsd(basis.seatRateCents)} per extra ` +
    `driver/dispatcher seat — charged when billing opens at app-store release; nothing is charged today.`
  );
}
