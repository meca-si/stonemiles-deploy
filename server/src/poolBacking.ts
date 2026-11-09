/**
 * USDG pool backing — DECIDED plan (x, 2026-10-26: "Add d1-d4 and Usdg
 * plan"). Spec: goals/trucker-gps-app/files/
 * usdg-pool-backing-spec-2026-10-26.md (the design authority).
 *
 * Under Option C every reward is a DOLLAR promise ($0.25 per 1,000 SM
 * Points; welcome credits $1/$5/$25; yearly credit $1) paid in $STONER
 * at the live price at payout. This module is the math for holding the
 * rewards slice's backing as USDG in the Earning Pool wallet instead
 * of pre-bought $STONER:
 *
 * - D1: public backing display (balance + coverage, delayed refresh) —
 *   the website scoreboard; the coverage math lives here.
 * - D2: payout buys at launch are MANUAL BATCH — payout runs execute
 *   only when an admin explicitly authorizes a batch.
 * - D3: a protected floor = the next 30 days of expected payouts
 *   (trailing payout run-rate). The floor blocks SWEEPS and other
 *   non-payout outflows; it NEVER blocks driver payouts — paying
 *   drivers is what the floor exists for. Surplus above the floor is
 *   sweepable only on x's action; nothing auto-sweeps.
 * - D4: backing is 100% on-chain USDG once verified live (the
 *   usdg_backing_live setting); until then the bank-dollar fallback
 *   posture governs and none of this gates anything.
 *
 * Depeg rule (locked with the plan): USDG is valued at its REAL market
 * price, never assumed to be $1. Payouts continue only while true
 * coverage ≥ 1.00; a severe depeg (>5% below peg) pauses payouts
 * outright. An unknown USDG price FAILS CLOSED (paused) — the same
 * discipline as the $STONER price read in rewardsAnchor.ts.
 *
 * Pure functions only: no I/O, unit-tested (poolBacking.test.ts).
 */

import { ANCHOR_USD_PER_BLOCK, CONV_BLOCK_POINTS } from "./rewardsAnchor";

/** Canonical Paxos USDG on Robinhood Chain (spec §8 — verify against
 *  Paxos's published address before the backing goes live). */
export const USDG_CONTRACT_ADDRESS =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** The Earning Pool wallet — holds the USDG backing under this plan
 *  (same wallet as today; only the asset it holds changes). */
export const EARNING_POOL_WALLET_ADDRESS =
  "0x4550E380182c8CdE5Fbc01004eb7DA42CF102213";

/** A USDG price more than this far below $1.00 is a severe depeg:
 *  payout runs pause outright pending x's word. */
export const DEPEG_PAUSE_DEVIATION = 0.05;

/** D3 floor window: the buffer covers this many days of expected
 *  payouts, measured from the trailing payout run-rate. */
export const FLOOR_WINDOW_DAYS = 30;

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * USD liability carried by outstanding SM Points at the anchor.
 * Points behind queued conversions are still in driver balances
 * (points leave the ledger only when a conversion pays), so the
 * aggregate outstanding balance IS the points liability — queued
 * conversion dollars must never be added on top (double count).
 */
export function pointsLiabilityUsd(totalOutstandingPoints: number): number {
  if (
    !Number.isFinite(totalOutstandingPoints) ||
    totalOutstandingPoints <= 0
  ) {
    return 0;
  }
  return roundUsd(
    (totalOutstandingPoints / CONV_BLOCK_POINTS) * ANCHOR_USD_PER_BLOCK,
  );
}

/** Total anchored liabilities (USD): points + unpaid credits. */
export function totalLiabilitiesUsd(parts: {
  outstandingPoints: number;
  unpaidCreditUsd: number;
  unpaidVestingUsd: number;
}): number {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return roundUsd(
    pointsLiabilityUsd(parts.outstandingPoints) +
      clean(parts.unpaidCreditUsd) +
      clean(parts.unpaidVestingUsd),
  );
}

/**
 * D3 floor: expected payouts over the next FLOOR_WINDOW_DAYS, measured
 * as the trailing window's actual anchored payout total. With no
 * payout history the floor is 0 — the pool is pre-launch and there is
 * nothing to protect yet; the floor grows teeth as payouts flow.
 */
export function expectedPayoutFloorUsd(
  payouts: readonly { amountUsd: number; paidAt: Date }[],
  now: Date,
  windowDays: number = FLOOR_WINDOW_DAYS,
): number {
  const start = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const p of payouts) {
    if (!Number.isFinite(p.amountUsd) || p.amountUsd <= 0) continue;
    const t = p.paidAt.getTime();
    if (Number.isFinite(t) && t >= start && t <= now.getTime()) {
      total += p.amountUsd;
    }
  }
  return roundUsd(total);
}

export type BackingPauseReason =
  | "usdg_price_unknown"
  | "usdg_severe_depeg"
  | "coverage_below_one";

export interface BackingAssessment {
  /** USDG units held in the Earning Pool (ledger balance). */
  backingUsdg: number;
  /** The USDG price input used; null = unknown (fails closed). */
  usdgPriceUsd: number | null;
  priceKnown: boolean;
  /** Signed deviation from $1.00 (e.g. -0.03 at $0.97); null if unknown. */
  deviation: number | null;
  severeDepeg: boolean;
  /** Backing valued at the REAL price (face value when unknown —
   *  display only; payout gating treats unknown as paused). */
  backingUsd: number;
  liabilitiesUsd: number;
  /** backing ÷ liabilities; null when there are no liabilities. */
  coverage: number | null;
  floorUsd: number;
  /** max(0, backing − floor): the only sweepable amount. */
  surplusAboveFloorUsd: number;
  payoutsPaused: boolean;
  pauseReason: BackingPauseReason | null;
}

/**
 * Assess the pool's backing: value, coverage, floor, and whether
 * payout runs must pause under the depeg rule. Pause order:
 * unknown price (fail closed) → severe depeg → coverage below 1.00.
 */
export function assessPoolBacking(input: {
  backingUsdg: number;
  usdgPriceUsd: number | null | undefined;
  liabilitiesUsd: number;
  floorUsd: number;
}): BackingAssessment {
  const backingUsdg =
    Number.isFinite(input.backingUsdg) && input.backingUsdg > 0
      ? input.backingUsdg
      : 0;
  const liabilitiesUsd =
    Number.isFinite(input.liabilitiesUsd) && input.liabilitiesUsd > 0
      ? roundUsd(input.liabilitiesUsd)
      : 0;
  const floorUsd =
    Number.isFinite(input.floorUsd) && input.floorUsd > 0
      ? roundUsd(input.floorUsd)
      : 0;
  const priceKnown =
    input.usdgPriceUsd != null &&
    Number.isFinite(input.usdgPriceUsd) &&
    input.usdgPriceUsd > 0;
  const usdgPriceUsd = priceKnown ? (input.usdgPriceUsd as number) : null;
  // Rounded to 6dp so the depeg threshold never hinges on float dust
  // (0.95 − 1 is −0.050000000000000044 in IEEE754 — exactly at −5%
  // must read as exactly −5%).
  const deviation = priceKnown
    ? Math.round(((usdgPriceUsd as number) - 1) * 1_000_000) / 1_000_000
    : null;
  const severeDepeg =
    priceKnown && deviation != null && deviation < -DEPEG_PAUSE_DEVIATION;
  const backingUsd = roundUsd(backingUsdg * (priceKnown ? (usdgPriceUsd as number) : 1));
  const coverage =
    liabilitiesUsd > 0
      ? Math.round((backingUsd / liabilitiesUsd) * 10000) / 10000
      : null;

  let pauseReason: BackingPauseReason | null = null;
  if (!priceKnown) pauseReason = "usdg_price_unknown";
  else if (severeDepeg) pauseReason = "usdg_severe_depeg";
  else if (coverage != null && coverage < 1) pauseReason = "coverage_below_one";

  return {
    backingUsdg,
    usdgPriceUsd,
    priceKnown,
    deviation,
    severeDepeg,
    backingUsd,
    liabilitiesUsd,
    coverage,
    floorUsd,
    surplusAboveFloorUsd: Math.max(0, roundUsd(backingUsd - floorUsd)),
    payoutsPaused: pauseReason != null,
    pauseReason,
  };
}

/**
 * D3 sweep guard: a non-payout outflow (sweep) may never draw the
 * backing below the floor. Blocked at the floor, blocked below it —
 * only the surplus above the floor can move, and only on x's action.
 */
export function sweepGuard(input: {
  backingUsd: number;
  floorUsd: number;
  sweepUsd: number;
}): { allowed: boolean; reason: string | null; backingAfterUsd: number } {
  const backingUsd = Number.isFinite(input.backingUsd) ? input.backingUsd : 0;
  const floorUsd =
    Number.isFinite(input.floorUsd) && input.floorUsd > 0 ? input.floorUsd : 0;
  const sweepUsd = input.sweepUsd;
  const backingAfterUsd = roundUsd(backingUsd - (Number.isFinite(sweepUsd) ? sweepUsd : 0));
  if (!Number.isFinite(sweepUsd) || sweepUsd <= 0) {
    return {
      allowed: false,
      reason: "Sweep amount must be a positive number.",
      backingAfterUsd,
    };
  }
  if (backingAfterUsd < floorUsd) {
    return {
      allowed: false,
      reason:
        "That sweep would draw the Earning Pool backing below its 30-day payout floor — the floor is protected and only the surplus above it can move.",
      backingAfterUsd,
    };
  }
  return { allowed: true, reason: null, backingAfterUsd };
}

/**
 * D3's other half: a DRIVER PAYOUT is never blocked by the floor —
 * paying drivers is the floor's purpose. A payout draws whenever the
 * backing covers the payout itself (queue-if-dry beyond that).
 */
export function payoutDrawAllowed(input: {
  backingUsd: number;
  payoutUsd: number;
}): boolean {
  if (!Number.isFinite(input.payoutUsd) || input.payoutUsd <= 0) return false;
  if (!Number.isFinite(input.backingUsd)) return false;
  return roundUsd(input.backingUsd) >= roundUsd(input.payoutUsd);
}

/**
 * The payout-run gate (D2 + depeg rule), evaluated before any payout
 * processor runs:
 * - Manual-batch mode (D2, the launch configuration) blocks every
 *   run that isn't an explicitly authorized admin batch.
 * - When USDG backing is live (D4 standing), a paused assessment
 *   (unknown USDG price / severe depeg / coverage < 1.00) blocks the
 *   run; rows stay queued. When backing is NOT live, the bank-dollar
 *   fallback posture governs and the depeg assessment does not gate.
 */
export function evaluatePayoutRunGate(input: {
  manualBatch: boolean;
  batchAuthorized: boolean;
  backingLive: boolean;
  payoutsPaused: boolean;
}): { run: boolean; blockedBy: "manual_batch" | "backing_paused" | null } {
  if (input.manualBatch && !input.batchAuthorized) {
    return { run: false, blockedBy: "manual_batch" };
  }
  if (input.backingLive && input.payoutsPaused) {
    return { run: false, blockedBy: "backing_paused" };
  }
  return { run: true, blockedBy: null };
}
