// loadFees.ts — the driver's OWN per-load fee percentages, as pure
// math (no DB, no ctx), so the Worth-It Advisor's deduction rules are
// unit-testable (see loadFees.test.ts). Added 2026-11-13 on x's order
// ("Add the % fields first") after a competitor load check showed a
// load can look good on rate alone while the driver's own factoring
// and dispatcher cuts quietly eat it.
//
// What these percentages ARE: what the DRIVER's factoring company
// and the DRIVER's dispatcher take out of a load's gross pay. They
// are the driver's own costs, saved on the driver's profile
// (migration 0115) and editable per Worth-It check.
//
// What they are NOT: the platform's internal fees. The platform
// dispatch fee / platform fee are computed elsewhere (dispatchFee.ts
// / platformFee.ts) off sealed deliveries and are never touched,
// mixed in, or shown by this module.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Clamp a driver-entered percentage into 0–100. Non-finite input
 *  (NaN from a blank field upstream) reads as 0 — no deduction is
 *  ever invented from a missing number. */
export function clampPct(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

export type LoadFeeBreakdown = {
  /** The percentages actually applied (after clamping). */
  factoringPct: number;
  dispatcherPct: number;
  /** gross × factoringPct% — what the driver's factoring company takes. */
  factoringAmt: number;
  /** gross × dispatcherPct% — what the driver's dispatcher takes. */
  dispatcherAmt: number;
  /** factoringAmt + dispatcherAmt. */
  totalFees: number;
  /** gross − totalFees: the pay the score is judged on. */
  netRate: number;
};

/** The deduction math for one load's gross pay. Amounts round to
 *  cents individually (each fee is a real invoice line), and netRate
 *  is gross minus the two rounded amounts, so the lines a driver sees
 *  always add up exactly. */
export function loadFeeBreakdown(
  grossRate: number,
  factoringPct: number | null | undefined,
  dispatcherPct: number | null | undefined,
): LoadFeeBreakdown {
  const fPct = clampPct(factoringPct);
  const dPct = clampPct(dispatcherPct);
  const factoringAmt = round2((grossRate * fPct) / 100);
  const dispatcherAmt = round2((grossRate * dPct) / 100);
  const totalFees = round2(factoringAmt + dispatcherAmt);
  const netRate = round2(grossRate - totalFees);
  return { factoringPct: fPct, dispatcherPct: dPct, factoringAmt, dispatcherAmt, totalFees, netRate };
}
