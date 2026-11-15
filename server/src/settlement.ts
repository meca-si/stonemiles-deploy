/**
 * FLEET-DRIVER SETTLEMENT VIEW — pure rules module (TMS completion
 * queue item 2, approved by x 2026-11-15).
 *
 * A driver under a fleet sees their OWN sealed loads and what each
 * one paid THEM, line by line, computed from their own My Pay setting
 * against the sealed load:
 *  - CPM basis: the driver's $/mi (their saved driverCpm, or the
 *    standing $0.55/mi standard when they never set one — the same
 *    fallback the trip sheets have always used, and the line SAYS so)
 *    times the load's loaded miles — the miles the load pays over
 *    (loads.loaded_miles; deadhead is the driver's true-rate honesty
 *    number, never the pay basis).
 *  - Percent basis: the driver's % of the load's pay, where the
 *    load's pay is rate + additional charges — the exact gross the
 *    profile's pay-basis comment has always named. Percent math only
 *    ever runs off a real gross: no rate on file, no figure, and the
 *    line says why instead of inventing one.
 *
 * Read-only by construction: this module computes display numbers
 * from records that already exist. Nothing here moves money, edits a
 * load, or writes anything. A line that can't be figured returns a
 * null pay with the plain reason — never a guess.
 *
 * Every rule is a pure function of its inputs (the credentialAlerts /
 * pointsLayer2 pattern) so both bases' math is unit-tested without a
 * database.
 */

/** The standing standard CPM used when the driver never set their
 *  own — the same $0.55/mi default the profile + trip sheets use. */
export const DEFAULT_DRIVER_CPM = 0.55;

export interface SettlementPaySetting {
  payBasis: string; // "cpm" | "percent"
  driverCpm: number | null;
  driverPayPct: number | null;
}

export interface SettlementLoadLike {
  rate: number | null;
  extraCharges: number;
  loadedMiles: number | null;
}

export interface SettlementLine {
  /** The load's pay (rate + additional charges); null = no rate on file. */
  gross: number | null;
  /** Loaded miles the CPM basis pays over; null = not on file. */
  miles: number | null;
  /** What this load paid the driver under their setting; null when
   *  it can't be figured (basisNote says why, plainly). */
  pay: number | null;
  /** The $/mi actually used on a CPM line (the driver's own, or the
   *  standard when defaulted). Null on percent lines. */
  cpmUsed: number | null;
  /** True when the CPM line ran at the standard $0.55/mi because the
   *  driver never set their own rate. */
  cpmDefaulted: boolean;
  /** How the line was figured, or why it couldn't be — driver-facing. */
  basisNote: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** One sealed load's settlement line under the driver's pay setting. */
export function settlementLineFor(
  setting: SettlementPaySetting,
  load: SettlementLoadLike,
): SettlementLine {
  const gross = load.rate != null ? round2(load.rate + (load.extraCharges ?? 0)) : null;
  const miles = load.loadedMiles ?? null;

  if (setting.payBasis === "percent") {
    if (setting.driverPayPct == null) {
      return {
        gross,
        miles,
        pay: null,
        cpmUsed: null,
        cpmDefaulted: false,
        basisNote: "Can't figure this one yet — set your percent in Settings → My pay and it figures itself.",
      };
    }
    if (gross == null) {
      return {
        gross,
        miles,
        pay: null,
        cpmUsed: null,
        cpmDefaulted: false,
        basisNote: "Can't figure this one yet — this load has no rate on file, and percent pay only runs off a real rate.",
      };
    }
    return {
      gross,
      miles,
      pay: round2((gross * setting.driverPayPct) / 100),
      cpmUsed: null,
      cpmDefaulted: false,
      basisNote: `${setting.driverPayPct}% of the load's pay (${money(gross)})`,
    };
  }

  // CPM basis (the default for anything that isn't "percent").
  const cpmDefaulted = setting.driverCpm == null;
  const cpmUsed = setting.driverCpm ?? DEFAULT_DRIVER_CPM;
  if (miles == null) {
    return {
      gross,
      miles,
      pay: null,
      cpmUsed,
      cpmDefaulted,
      basisNote: "Can't figure this one yet — this load has no loaded miles on file, and CPM pay runs off the loaded miles.",
    };
  }
  return {
    gross,
    miles,
    pay: round2(cpmUsed * miles),
    cpmUsed,
    cpmDefaulted,
    basisNote: cpmDefaulted
      ? `Standard ${money(DEFAULT_DRIVER_CPM)}/mi × ${miles.toLocaleString("en-US")} loaded mi — your own CPM isn't set (Settings → My pay)`
      : `${money(cpmUsed)}/mi × ${miles.toLocaleString("en-US")} loaded mi`,
  };
}

/** Rollup over a driver's settlement lines: what's figured, what
 *  isn't, and the gross those lines ran against. */
export function settlementTotals(lines: readonly SettlementLine[]): {
  totalPay: number;
  totalGross: number;
  figured: number;
  unfigured: number;
} {
  let totalPay = 0;
  let totalGross = 0;
  let figured = 0;
  for (const l of lines) {
    if (l.pay != null) {
      totalPay += l.pay;
      figured++;
    }
    if (l.gross != null) totalGross += l.gross;
  }
  return {
    totalPay: round2(totalPay),
    totalGross: round2(totalGross),
    figured,
    unfigured: lines.length - figured,
  };
}
