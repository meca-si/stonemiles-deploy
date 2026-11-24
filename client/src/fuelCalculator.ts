/**
 * Fuel cost calculator math (2026-11-24, x's ask — a simple tab like
 * the classic web fuel calculators, but fed by the driver's own
 * numbers). Pure functions, unit-tested in fuelCalculator.test.ts.
 *
 * gallons = total miles ÷ MPG; cost = gallons × price; the rest is
 * presentation. Nothing here reads or writes app state — the panel
 * (FuelCostCalculator.tsx) owns the inputs and their sources, and
 * labels every prefill with where it came from.
 */

export interface FuelCalcInput {
  /** Loaded (or plain trip) miles. */
  distanceMi: number;
  /** Empty miles to the pickup — counted in the burn, said out loud. */
  deadheadMi: number;
  mpg: number;
  pricePerGal: number;
  /** The load's total pay, when the calc is tied to a load. */
  loadPay?: number | null;
}

export interface FuelCalcResult {
  totalMiles: number;
  gallons: number;
  totalCost: number;
  costPerMile: number;
  /** Fuel cost as a % of the load's pay (only with a pay figure). */
  fuelSharePct: number | null;
  /** Pay minus fuel cost (only with a pay figure). */
  netAfterFuel: number | null;
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Returns null when the inputs can't support an honest answer
 *  (no miles, or MPG/price not positive) — the panel then shows the
 *  prompt to fill the fields, never a fabricated zero. */
export function fuelCostFor(input: FuelCalcInput): FuelCalcResult | null {
  const totalMiles = input.distanceMi + input.deadheadMi;
  if (!Number.isFinite(totalMiles) || totalMiles <= 0) return null;
  if (!Number.isFinite(input.mpg) || input.mpg <= 0) return null;
  if (!Number.isFinite(input.pricePerGal) || input.pricePerGal <= 0) return null;
  const gallonsRaw = totalMiles / input.mpg;
  const costRaw = gallonsRaw * input.pricePerGal;
  const pay = input.loadPay != null && Number.isFinite(input.loadPay) && input.loadPay > 0 ? input.loadPay : null;
  return {
    totalMiles: round(totalMiles, 1),
    gallons: round(gallonsRaw, 1),
    totalCost: round(costRaw, 2),
    costPerMile: round(costRaw / totalMiles, 2),
    fuelSharePct: pay != null ? round((costRaw / pay) * 100, 1) : null,
    netAfterFuel: pay != null ? round(pay - costRaw, 2) : null,
  };
}
