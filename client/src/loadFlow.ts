// loadFlow.ts — the pure math behind the load-flow panel (2026-11-24,
// x's order): after a load saves, its info screen answers three
// questions in taps — what does it pay ME, can I make it on the fuel
// I have, and where do I stop. Everything here is a pure function of
// real inputs; a figure that can't be figured from real numbers
// comes back null and the panel asks for the missing input instead
// of presenting a stand-in as fact.
//
// Two honesty rules the panel inherits from here:
// - Percent pay is figured from the load's GROSS (rate + charges).
//   A per-mile figure for a percent load is DERIVED (cut ÷ miles)
//   for display only — it never drives the pay.
// - CPM pay uses the driver's own set CPM only. The app's $0.55
//   standing default is NEVER substituted here: an unset CPM reads
//   as "not set up", not as $0.55/mi math wearing the driver's name.

import { effectiveMpg, gallonsForMiles, tankPctAfterMiles, usableRangeMi } from "./stopPlanner";

// ---------- Fuel advice ------------------------------------------------------

export interface LoadFuelAdvice {
  capacityGal: number;
  tankPct: number;
  gallonsOnBoard: number;
  /** Weight-adjusted MPG the burn is figured at. */
  effMpg: number;
  miles: number;
  /** Gallons the run itself burns. */
  gallonsNeeded: number;
  /** Reserve kept in the tank on arrival (percent of capacity). */
  reservePct: number;
  /** True when the run finishes at or above the reserve. */
  canMakeIt: boolean;
  /** Tank % on arrival with no stops. */
  arrivalPct: number;
  /** Gallons short of finishing at the reserve (0 when canMakeIt). */
  shortfallGal: number;
  /** Gallons to buy along the way to finish at the reserve. */
  buyGalToFinish: number;
  /** Miles the current fuel covers before the reserve floor. */
  rangeMi: number;
}

export function fuelAdviceForLoad(input: {
  tankPct: number;
  capacityGal: number;
  baseMpg: number;
  loadWeightLbs: number | null;
  miles: number;
  reservePct?: number;
}): LoadFuelAdvice {
  const reservePct = input.reservePct ?? 15;
  const capacityGal = Math.max(0, input.capacityGal);
  const tankPct = Math.max(0, Math.min(100, input.tankPct));
  const effMpg = effectiveMpg(input.baseMpg, input.loadWeightLbs);
  const gallonsOnBoard = Math.round(((tankPct / 100) * capacityGal) * 10) / 10;
  const gallonsNeeded = Math.round(gallonsForMiles(input.miles, effMpg) * 10) / 10;
  const arrivalPct = tankPctAfterMiles(tankPct, input.miles, capacityGal, input.baseMpg, input.loadWeightLbs);
  const reserveGal = (reservePct / 100) * capacityGal;
  const shortfallGal = Math.max(0, Math.round((gallonsNeeded + reserveGal - gallonsOnBoard) * 10) / 10);
  return {
    capacityGal,
    tankPct,
    gallonsOnBoard,
    effMpg: Math.round(effMpg * 100) / 100,
    miles: input.miles,
    gallonsNeeded,
    reservePct,
    canMakeIt: shortfallGal <= 0,
    arrivalPct,
    shortfallGal,
    buyGalToFinish: shortfallGal,
    rangeMi: Math.round(usableRangeMi(tankPct, capacityGal, input.baseMpg, input.loadWeightLbs, reservePct)),
  };
}

// ---------- Pay figures ------------------------------------------------------

export interface LoadPayFigures {
  /** The load's gross (rate + charges); null when no rate is on file. */
  gross: number | null;
  basis: "percent" | "cpm";
  /** The percent the driver keeps (percent basis), else null. */
  pct: number | null;
  /** The driver's own set CPM (cpm basis), else null. */
  cpm: number | null;
  /** The driver's cut in dollars; null when it can't be figured
   *  from real numbers (model not set up, no gross, no miles). */
  cut: number | null;
  /** DERIVED display figure: cut ÷ miles. Never an input. */
  cutPerMile: number | null;
  /** True when the driver's chosen pay model has no value yet —
   *  the panel asks for it in the flow; no default is substituted. */
  needsSetup: boolean;
}

export function loadPayFigures(input: {
  payBasis: "cpm" | "percent";
  driverCpm: number | null;
  driverPayPct: number | null;
  gross: number | null;
  miles: number | null;
}): LoadPayFigures {
  const miles = input.miles != null && input.miles > 0 ? input.miles : null;
  if (input.payBasis === "percent") {
    const pct = input.driverPayPct != null && input.driverPayPct > 0 ? input.driverPayPct : null;
    const cut = pct != null && input.gross != null ? Math.round(input.gross * pct) / 100 : null;
    return {
      gross: input.gross,
      basis: "percent",
      pct,
      cpm: null,
      cut,
      cutPerMile: cut != null && miles != null ? Math.round((cut / miles) * 100) / 100 : null,
      needsSetup: pct == null,
    };
  }
  const cpm = input.driverCpm != null && input.driverCpm > 0 ? input.driverCpm : null;
  const cut = cpm != null && miles != null ? Math.round(miles * cpm * 100) / 100 : null;
  return {
    gross: input.gross,
    basis: "cpm",
    pct: null,
    cpm,
    cut,
    cutPerMile: cut != null && miles != null ? Math.round((cut / miles) * 100) / 100 : null,
    needsSetup: cpm == null,
  };
}

/**
 * The one-line label naming the split a pay figure was figured at —
 * "at 90% of gross" on percent pay, "at $0.72/mi" on CPM — or null
 * when the driver's model carries no value to name. Route cards put
 * this under their NET PAY (driver report, 2026-11-24: a route card
 * read NET $299.74 on a $600 load — figured at the 90% in his saved
 * My-pay model, the split Alex Murphy promised, while his signed
 * carrier paper pays 80%; the number was right from the model and
 * still read as a silent surprise because the card never said which
 * split it used). The math itself never lives here: percent cuts
 * come from the same stored driverPayPct loadPayFigures reads.
 */
export function paySplitLabel(input: {
  payBasis: "cpm" | "percent";
  driverCpm: number | null;
  driverPayPct: number | null;
}): string | null {
  if (input.payBasis === "percent") {
    return input.driverPayPct != null && input.driverPayPct > 0 ? `at ${input.driverPayPct}% of gross` : null;
  }
  return input.driverCpm != null && input.driverCpm > 0 ? `at $${input.driverCpm.toFixed(2)}/mi` : null;
}

// ---------- Tank-level memory --------------------------------------------------
//
// The load flow and the Stop Planner share ONE memory of the tank:
// the planner's localStorage key, same shape ({pct, atProgressMi}).
// A level entered in either place is the level the other place
// reads. atProgressMi is the route progress the reading was taken
// at; the load flow plans from the start, so it stores 0.

export const TANK_STORAGE_KEY = "tgps-planner-tank";

export function readStoredTankPct(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = JSON.parse(localStorage.getItem(TANK_STORAGE_KEY) ?? "null") as { pct?: unknown } | null;
    if (raw && typeof raw.pct === "number" && Number.isFinite(raw.pct)) {
      return Math.max(0, Math.min(100, raw.pct));
    }
  } catch {
    /* storage unavailable — the flow asks for the level instead */
  }
  return null;
}

export function storeTankPct(pct: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    const v = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
    localStorage.setItem(TANK_STORAGE_KEY, JSON.stringify({ pct: v, atProgressMi: 0 }));
  } catch {
    /* storage unavailable — the level just won't persist */
  }
}

// ---------- After-fuel estimate (board card, x 2026-11-25) ------------------
// The decision-time line on a load offer: what is left of MY cut
// after the fuel the run burns. Figured from the driver's current
// position (deadhead to the pickup, when a position is known), the
// loaded miles, the weight-adjusted MPG off the driver's own
// profile MPG, and a labelled fuel price (the driver's own last
// purchase price, or the EIA weekly average — never a live pump
// price, and never presented as one).
//
// Honesty rules, same family as the rest of this module:
// - Any missing real input (no cut, no miles, no MPG on the
//   profile, no price) → null, and the card shows nothing rather
//   than a stand-in figure. The profile MPG is REQUIRED: the
//   planner's 6.5 fallback is never substituted under the driver's
//   name here.
// - A null deadhead means "not figured" — the total runs on the
//   loaded miles alone and the line says so; it never reads as
//   though the deadhead were zero-cost, it just isn't in the math.

export interface AfterFuelEstimate {
  /** The driver's cut (from loadPayFigures), dollars. */
  cut: number;
  loadedMi: number;
  /** Deadhead miles from the driver's position to the pickup, or
   *  null when no position was available to figure it from. */
  deadheadMi: number | null;
  /** loadedMi + (deadheadMi ?? 0). */
  totalMi: number;
  /** Weight-adjusted MPG the burn is figured at. */
  effMpg: number;
  gallons: number;
  pricePerGal: number;
  fuelCost: number;
  /** cut − fuelCost; may be negative — a money-losing run says so. */
  afterFuel: number;
  /** The profitability figure drivers judge a load by: afterFuel
   *  spread over every mile the run takes (deadhead included). */
  afterFuelPerMi: number;
}

export function afterFuelEstimate(input: {
  cut: number | null;
  loadedMiles: number | null;
  deadheadMi: number | null;
  baseMpg: number | null;
  weightLbs: number | null;
  pricePerGal: number | null;
}): AfterFuelEstimate | null {
  const cut = input.cut;
  const loadedMi = input.loadedMiles;
  const baseMpg = input.baseMpg;
  const pricePerGal = input.pricePerGal;
  if (cut == null || !Number.isFinite(cut)) return null;
  if (loadedMi == null || !(loadedMi > 0)) return null;
  if (baseMpg == null || !(baseMpg > 0)) return null;
  if (pricePerGal == null || !(pricePerGal > 0)) return null;
  const deadheadMi =
    input.deadheadMi != null && Number.isFinite(input.deadheadMi) && input.deadheadMi >= 0
      ? Math.round(input.deadheadMi)
      : null;
  const totalMi = Math.round(loadedMi) + (deadheadMi ?? 0);
  const effMpg = effectiveMpg(baseMpg, input.weightLbs);
  const gallons = Math.round(gallonsForMiles(totalMi, effMpg) * 10) / 10;
  const fuelCost = Math.round(gallons * pricePerGal * 100) / 100;
  return {
    cut,
    loadedMi: Math.round(loadedMi),
    deadheadMi,
    totalMi,
    effMpg: Math.round(effMpg * 100) / 100,
    gallons,
    pricePerGal,
    fuelCost,
    afterFuel: Math.round((cut - fuelCost) * 100) / 100,
    afterFuelPerMi: Math.round(((cut - fuelCost) / totalMi) * 100) / 100,
  };
}

/** The card's worth-it call, judged on the after-fuel figure alone
 *  (x 2026-11-25). Fuel is the largest running cost, so a load that
 *  doesn't clear fuel truly loses money (red, no caveat needed);
 *  clearing it is necessary, not sufficient — the full Worth-It
 *  Advisor scores against the driver's whole break-even (every
 *  logged cost), and the card's words stay in fuel scope so the two
 *  never blur. Green asks a real cushion over fuel — $0.50/mi left
 *  after fuel — before it calls a load worth taking. */
export function afterFuelVerdict(est: AfterFuelEstimate): "green" | "yellow" | "red" {
  if (est.afterFuel < 0) return "red";
  return est.afterFuelPerMi >= 0.5 ? "green" : "yellow";
}
