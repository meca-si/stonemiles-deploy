/**
 * Dispatch fee (RUGGS LLC load-board lane) — pure rules module.
 *
 * The locked rules (owner, 2026-10-26):
 *  - A carrier who claims a load off the Fleet Load Board owes RUGGS LLC a
 *    dispatch fee of 10% of that load's final freight amount (the
 *    Payment Packet's invoice amount: rate + additional charges).
 *  - The fee invoice is generated automatically when the board-claimed
 *    load's delivery POD seals. ONE fee per load, ever: packet
 *    refreshes / re-seals never double-bill; if the packet amount is
 *    later corrected, the fee follows the final amount.
 *  - Rails: ACH, debit card, crypto. Card + crypto are config-gated
 *    (below) and render as "being set up" until configured — never a
 *    fake checkout.
 *  - Settle-to-claim gate: a carrier with an unpaid dispatch fee cannot
 *    claim any new board load until it is paid IN FULL (partial
 *    payments record but do not clear the gate).
 *  - Ladder, computed from the delivery (POD seal) date + payment
 *    state: days 0–7 = collection window (gate closed until paid);
 *    day 7 unpaid → WARNING flag on the carrier's record; day 10
 *    unpaid → board permission REVOKED until the debt is settled in
 *    full. Payment restores standing; warning/late history remains
 *    visible (everWarned / everRevoked are computed from the payment
 *    timestamp, so they survive payment).
 *  - Granted-lane guard: loads that ran under the RUGGS LLC→Granted agent
 *    agreement are NOT board loads. Only board-claimed origin (a
 *    board_loads row claimed/assigned to a carrier) ever generates a
 *    fee — manual loads, solo loads, and Granted-lane loads have no
 *    board row and are excluded.
 *
 * Everything here is a pure function of its inputs (timestamps are
 * passed in as epoch ms) so the fee math, the idempotency plan, the
 * gate, and the ladder boundaries are unit-tested without a database.
 * The stateful wrappers live in actions.ts and call these.
 */

export const DISPATCH_FEE_RATE = 0.1;
export const COLLECTION_WINDOW_DAYS = 7;
export const REVOKE_DAYS = 10;

/** Config-gated rails. The crypto rail's receiving address is the
 *  STONEMILES house lane (owner decision, 2026-10-26) on Robinhood
 *  Chain (4663) — invoices render this address with the fee amount,
 *  and crypto payment records verify the tx hash on chain 4663
 *  against this recipient where verification is possible. Ledger rows
 *  are labelled as RUGGS LLC dispatch fees so they stay distinguishable
 *  from subscription team-share receipts even though the wallet is
 *  shared. The debit card link stays null until the owner's Stripe is
 *  connected — the invoice states the rail and "being set up", never
 *  a fake checkout or a dead button dressed as live. */
export const DISPATCH_FEE_CRYPTO_ADDRESS: string | null = "0x3a6fEBE311F98629C9A98452dB0968C315930447";
export const DISPATCH_FEE_CRYPTO_CHAIN_ID = 4663;
export const DISPATCH_FEE_CARD_LINK: string | null = null;

const DAY_MS = 86_400_000;
const CENT_EPSILON = 0.005;

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The packet's final freight amount for a load: rate + additional
 *  charges — the exact amount invoiceFingerprintFor computes. Null
 *  when the load carries no rate (no freight amount, no fee yet). */
export function freightAmountFor(rate: number | null, extraCharges: number | null | undefined): number | null {
  if (rate == null) return null;
  return roundCents(rate + (extraCharges ?? 0));
}

/** 10% of the freight amount, rounded to cents. $2,500 → $250. */
export function dispatchFeeFor(freightAmount: number): number {
  return roundCents(freightAmount * DISPATCH_FEE_RATE);
}

/** Whole days since delivery (POD seal), never negative. */
export function daysOutstandingFor(deliveredAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - deliveredAtMs) / DAY_MS));
}

export type DispatchFeeStatus = "paid" | "window" | "warning" | "revoked";

export type LadderResult = {
  status: DispatchFeeStatus;
  daysOutstanding: number;
  balanceDue: number;
  /** The carrier's record carries a warning — true once the fee was
   *  ever unpaid at day 7, including after a late payment. */
  everWarned: boolean;
  /** Board permission was revoked — true once the fee was ever unpaid
   *  at day 10, including after a late settlement. */
  everRevoked: boolean;
};

/**
 * The ladder for one invoice. `paidAtMs` is when the invoice reached
 * paid-in-full (null while any balance remains). Boundaries are whole
 * days since delivery: day 7 (exactly 7×24h after the seal) is the
 * warning day; day 10 is revocation.
 */
export function ladderFor(input: {
  deliveredAtMs: number;
  feeAmount: number;
  paidAmount: number;
  paidAtMs: number | null;
  nowMs: number;
}): LadderResult {
  const balanceDue = roundCents(Math.max(0, input.feeAmount - input.paidAmount));
  const paidInFull = balanceDue <= CENT_EPSILON;
  // How long the fee sat (or has sat) unpaid: for a paid invoice the
  // clock stops at the moment it was paid in full — that is what makes
  // the warning/revocation history persist after settlement.
  const unpaidUntilMs = paidInFull ? (input.paidAtMs ?? input.nowMs) : input.nowMs;
  const unpaidDays = daysOutstandingFor(input.deliveredAtMs, unpaidUntilMs);
  const everWarned = unpaidDays >= COLLECTION_WINDOW_DAYS;
  const everRevoked = unpaidDays >= REVOKE_DAYS;
  const daysOutstanding = daysOutstandingFor(input.deliveredAtMs, input.nowMs);
  if (paidInFull) {
    return { status: "paid", daysOutstanding, balanceDue: 0, everWarned, everRevoked };
  }
  const status: DispatchFeeStatus =
    unpaidDays >= REVOKE_DAYS ? "revoked" : unpaidDays >= COLLECTION_WINDOW_DAYS ? "warning" : "window";
  return { status, daysOutstanding, balanceDue, everWarned, everRevoked };
}

/**
 * Board-claim provenance — the ONLY origin that can ever owe a
 * dispatch fee. A load is board-claimed when a board_loads row exists
 * for it AND that row was taken by a carrier (claim or assign).
 * Granted-lane loads (RUGGS LLC→Granted agent agreement), manual loads,
 * and solo broker-approval loads have no taken board row → excluded,
 * never invoiced.
 */
export function feeEligibility(input: {
  boardRow: { status: string; claimedBy: string | null } | null;
}): { eligible: boolean; reason: string } {
  if (!input.boardRow) {
    return {
      eligible: false,
      reason: "Not a board-claimed load — no Fleet Load Board row for this load (manual, solo, or Granted-lane loads never generate a dispatch fee).",
    };
  }
  if (input.boardRow.status !== "taken" || !input.boardRow.claimedBy) {
    return {
      eligible: false,
      reason: "The board row for this load was never claimed by a carrier — no carrier owes a dispatch fee on it.",
    };
  }
  return { eligible: true, reason: "Board-claimed load — the claiming carrier owes RUGGS LLC 10% of the final freight amount." };
}

export type FeeSyncPlan =
  | { action: "create"; feeAmount: number }
  | { action: "none"; feeAmount: number }
  | { action: "update_amount"; feeAmount: number; previousFeeAmount: number; previousFreightAmount: number };

/**
 * Idempotency plan for syncing an invoice to the packet's final
 * freight amount (called on every packet assembly / refresh):
 *  - no invoice yet → create (exactly once — the caller also relies on
 *    the UNIQUE load_id constraint);
 *  - invoice exists, freight unchanged → none (a re-seal or packet
 *    refresh NEVER double-bills);
 *  - invoice exists, freight corrected → update_amount: the fee
 *    follows the final amount (the caller seals the change as an
 *    event).
 */
export function planFeeSync(
  existing: { freightAmount: number; feeAmount: number } | null,
  freightAmount: number,
): FeeSyncPlan {
  const feeAmount = dispatchFeeFor(freightAmount);
  if (!existing) return { action: "create", feeAmount };
  if (roundCents(existing.freightAmount) === roundCents(freightAmount)) {
    return { action: "none", feeAmount: existing.feeAmount };
  }
  return {
    action: "update_amount",
    feeAmount,
    previousFeeAmount: existing.feeAmount,
    previousFreightAmount: existing.freightAmount,
  };
}

export type GateInvoice = {
  loadId: number;
  boardLoadId: number | null;
  status: DispatchFeeStatus;
  balanceDue: number;
  feeAmount: number;
  daysOutstanding: number;
};

export type GateResult = {
  /** Any unpaid fee at all — the settle-to-claim gate is closed. */
  blocked: boolean;
  /** Permission-level block: an invoice reached day 10 unpaid. */
  revoked: boolean;
  /** Any invoice at/past the day-7 warning. */
  warned: boolean;
  /** The oldest unpaid invoice — the one the gate message names. */
  blocking: GateInvoice | null;
  totalDue: number;
};

/**
 * The settle-to-claim gate over a carrier's invoices. Blocked while
 * ANY invoice has a balance due (partial payments do not clear it);
 * revoked when any blocking invoice is at the ladder's revoked step.
 * Paid invoices never block — payment restores standing.
 */
export function gateFor(invoices: GateInvoice[]): GateResult {
  const unpaid = invoices
    .filter((i) => i.status !== "paid" && i.balanceDue > CENT_EPSILON)
    .sort((a, b) => b.daysOutstanding - a.daysOutstanding || a.loadId - b.loadId);
  const blocking = unpaid[0] ?? null;
  return {
    blocked: blocking != null,
    revoked: unpaid.some((i) => i.status === "revoked"),
    warned: unpaid.some((i) => i.status === "warning" || i.status === "revoked"),
    blocking,
    totalDue: roundCents(unpaid.reduce((sum, i) => sum + i.balanceDue, 0)),
  };
}
