/**
 * FUEL RECEIPT BONUS + purchase-fed price grades (owner-approved
 * 2026-10-26: "Build it — wire receipts into fuel prices + receipt
 * bonus points"). Economics gate: rewards profit sim Part 7 PASSED —
 * at the expected frequency of 11 receipt-bearing fuel purchases per
 * paid earner per month, task conversions pay 100% at earner ratios
 * 1.0 and 1.5 in base and zero-breakage stress and the pool never
 * goes negative. (Ceiling sensitivity, disclosed: at 22/mo the
 * ratio-1.5 stress pays 98.7%.)
 *
 * Two mechanisms live here, both pure:
 *
 * 1) PRICE GRADES. Every row in the shared fuel-price layer carries
 *    a grade: "receipt_verified" (filed from a logged fuel purchase
 *    whose receipt photo was fingerprinted), "purchase" (filed from
 *    a logged purchase without a receipt), or "reported" (a manual
 *    driver sighting). The layer is anonymous — no username is ever
 *    stored on a price row, in its chain payload, or in any response.
 *    Purchase-derived rows carry NO coordinates (the purchase form
 *    collects none and coordinates are never fabricated); the client
 *    matches them to stops by station name + state.
 *
 * 2) THE +15 RECEIPT BONUS. When the call that WINS the day's
 *    fuel_stop daily award also carried a fingerprinted receipt, the
 *    driver earns RECEIPT_BONUS_POINTS on top of the fuel_stop award:
 *    - Evaluated ONLY on the winning call (awardDailyTask returned
 *      > 0). If an earlier purchase already won the day's fuel_stop
 *      award — with or without a receipt — no bonus fires that day.
 *    - Paid tier only, for free: fuel_stop pays 0 on the free tier,
 *      so awardDailyTask returns 0 and the bonus can never fire.
 *      There is deliberately NO second tier check here.
 *    - Once per driver per driver-local day.
 *    - GLOBAL receipt dedupe: a receipt's SHA-256 fingerprint can
 *      earn the bonus exactly once across ALL accounts. A duplicate
 *      receipt still logs its purchase and files its price report —
 *      it just pays no bonus.
 *    - The bonus counts INSIDE the 500/day cap with the same
 *      daily-row accounting awardDailyTask uses; if base + 15 would
 *      pass the cap the bonus pays 0 (no partial award) and the base
 *      award is unaffected.
 *    The bonus is NOT a DAILY_TASKS entry and dailyTaskPoints is
 *    untouched — it rides the fuel_stop win via awardPoints with
 *    source "daily_fuel_receipt_bonus".
 *
 * Pure functions only: no I/O, unit-tested (fuelReceiptBonus.test.ts).
 * actions.ts resolves the ledger state and routes every decision
 * through here.
 */

import { DAILY_POINTS_CAP } from "./dailyPoints";

/** The receipt bonus: +15 SM Points on the winning fuel_stop call. */
export const RECEIPT_BONUS_POINTS = 15;

/** points_log source for the receipt bonus award. */
export const RECEIPT_BONUS_SOURCE = "daily_fuel_receipt_bonus";

/** The award's ledger reason, verbatim. */
export const RECEIPT_BONUS_REASON =
  "Fuel receipt bonus — receipt fingerprinted & sealed";

/** The grade a manually reported price (reportFuelPrice) carries. */
export const REPORTED_PRICE_GRADE = "reported" as const;

export type FuelPriceGrade =
  | "receipt_verified"
  | "purchase"
  | typeof REPORTED_PRICE_GRADE;

/**
 * The grade a purchase-derived price report carries: a fingerprinted
 * receipt makes it "receipt_verified"; without one it is a plain
 * logged "purchase".
 */
export function fuelPriceGradeForPurchase(
  receiptSha256: string | null | undefined,
): FuelPriceGrade {
  return receiptSha256 != null ? "receipt_verified" : "purchase";
}

/**
 * Preference rank between grades when freshness ties (higher wins):
 * receipt_verified > purchase > reported. Unknown grades rank last.
 */
export function fuelPriceGradeRank(grade: string): number {
  if (grade === "receipt_verified") return 3;
  if (grade === "purchase") return 2;
  if (grade === "reported") return 1;
  return 0;
}

/** The bonus award's refKey: one per (driver-local day, receipt). */
export function receiptBonusRefKey(dayKey: string, receiptSha256: string): string {
  return `daily:fuel_receipt_bonus:${dayKey}:${receiptSha256}`;
}

type BonusLedgerRow = {
  username: string;
  amount: number;
  source: string;
  refKey: string | null;
  createdAt: Date;
};

/** Driver-local calendar day (YYYY-MM-DD) in America/Chicago — the
 *  same rule the daily award path uses (localDayKey in actions.ts). */
export function receiptBonusDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Is this ledger row part of the driver's daily-task total for
 * `dayKey`? The exact accounting awardDailyTask uses: rows whose
 * refKey starts with "daily:" and stamps that day, plus same-day
 * daily clawbacks (negative rows from a daily_* source stamped that
 * driver-local day). The receipt bonus's own refKey starts with
 * "daily:", so a landed bonus counts inside the cap too.
 */
export function isDailyCapRow(row: BonusLedgerRow, dayKey: string): boolean {
  return (
    (row.refKey != null &&
      row.refKey.startsWith("daily:") &&
      row.refKey.includes(`:${dayKey}`)) ||
    (row.amount < 0 &&
      row.source.startsWith("daily_") &&
      receiptBonusDayKey(row.createdAt) === dayKey)
  );
}

/** The driver's net daily-task total for `dayKey` from their rows. */
export function dailyCapTotal(rows: readonly BonusLedgerRow[], dayKey: string): number {
  return rows.filter((r) => isDailyCapRow(r, dayKey)).reduce((s, r) => s + r.amount, 0);
}

/**
 * Did this driver already land a receipt bonus stamped for `dayKey`?
 * (Net of any clawback — a reversed bonus frees the day again, the
 * same net accounting the daily table uses.)
 */
export function alreadyBonusedToday(
  driverRows: readonly BonusLedgerRow[],
  dayKey: string,
): boolean {
  const prefix = `daily:fuel_receipt_bonus:${dayKey}:`;
  const net = driverRows
    .filter(
      (r) =>
        r.source === RECEIPT_BONUS_SOURCE &&
        r.refKey != null &&
        r.refKey.startsWith(prefix),
    )
    .reduce((s, r) => s + r.amount, 0);
  return net > 0;
}

/**
 * Has ANY account already earned the bonus for this receipt? The
 * global dedupe: any points_log row, on any account, with the bonus
 * source and a refKey ending in ":" + the receipt's fingerprint.
 * (awardPoints' own refKey check is per-user, so this scan is what
 * makes a receipt pay once, anywhere.)
 */
export function receiptAlreadyBonused(
  allRows: readonly BonusLedgerRow[],
  receiptSha256: string,
): boolean {
  const suffix = `:${receiptSha256}`;
  return allRows.some(
    (r) =>
      r.source === RECEIPT_BONUS_SOURCE &&
      r.refKey != null &&
      r.refKey.endsWith(suffix) &&
      r.amount > 0,
  );
}

/**
 * The receipt bonus decision for one logFuelPurchase call. Returns
 * RECEIPT_BONUS_POINTS (15) or 0. Call ONLY with the state AFTER the
 * call's fuel_stop award landed:
 * - `baseAwardPoints`: what awardDailyTask returned for THIS call.
 *   0 → no bonus (already won earlier today, capped, or free tier —
 *   the paid-tier gate rides entirely on this value).
 * - `receiptSha256`: the fingerprint of THIS call's receipt, or null.
 * - `dayKey`: the driver's local day (same key the award path used).
 * - `driverRows`: the driver's full points ledger (day-total + the
 *   once-per-day check run over it).
 * - `allRows`: every account's bonus-source rows (the global dedupe
 *   scan); the full ledger is equally valid input.
 */
export function receiptBonusEligibility(args: {
  baseAwardPoints: number;
  receiptSha256: string | null;
  dayKey: string;
  driverRows: readonly BonusLedgerRow[];
  allRows: readonly BonusLedgerRow[];
}): number {
  if (args.baseAwardPoints <= 0) return 0; // not the winning call (or free tier)
  if (args.receiptSha256 == null) return 0; // no receipt on this call
  if (alreadyBonusedToday(args.driverRows, args.dayKey)) return 0; // once/day
  if (receiptAlreadyBonused(args.allRows, args.receiptSha256)) return 0; // once, anywhere
  const dayTotal = dailyCapTotal(args.driverRows, args.dayKey);
  if (dayTotal + RECEIPT_BONUS_POINTS > DAILY_POINTS_CAP) return 0; // inside the cap, no partial
  return RECEIPT_BONUS_POINTS;
}
