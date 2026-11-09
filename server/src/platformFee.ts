/**
 * PLATFORM FEE — pure rules (x, 2026-11-02 correction).
 *
 * A dispatch-only company (companies.kind = "dispatch" whose Fleet
 * Owner plan has NOT been activated) pays the PLATFORM 2% of a
 * load's gross pay per dispatched load, recorded when the load
 * reaches SEALED DELIVERY and labelled plainly "Platform fee 2% —
 * invoiced at sealed delivery" — the same invoiced-at-sealed-
 * delivery pattern as the RUGGS LLC house dispatch fee
 * (dispatchFee.ts), and like it, RECORDS ONLY: the app moves no
 * money for this fee.
 *
 * Who pays, exactly:
 * - The load must have reached the Open Board from a POSTER
 *   (originKind "broker_poster") — that is the public dispatch path.
 * - The poster's account must belong to a dispatch company.
 * - That company must still be dispatch-only at the seal (not
 *   converted). Converted companies never accrue the fee, and their
 *   private-board loads carry no fee mechanics at all.
 * Fleet posters, shipper posters, and fleet overflow never accrue
 * it. The accrual itself (one entry per load, idempotent) lives in
 * actions.ts (ensurePlatformFeeEntry) on this module's decision.
 *
 * ROUND 3 EXTENSION (x, 2026-11-02 — My Desk): a SOLO DISPATCHER
 * POSTER accrues the same 2% the same way. That is a poster account
 * whose owner has opened My Desk (social_users.dispatcher_poster —
 * the flag IS the dispatcherhood): the person owes it, and the
 * entry records them as the owing entity (company_id NULL,
 * poster_username set). A shipper or broker direct poster who
 * never opened a dispatcher desk is NOT a dispatcher and never
 * accrues — the flag is the whole difference. Posters under a
 * DISPATCH company's roof are judged by the company rule above
 * alone (the accounting entity stays the company). A poster under
 * any other roof (a fleet company, or none) accrues exactly when
 * they personally carry the flag — they opted into dispatcher
 * economics on their own account; without the flag they are a
 * fleet/shipper poster and never accrue (the round-2 rule).
 *
 * ROUND 4 RECONCILIATION (x, 2026-11-02 — dispatcher exclusivity):
 * the flag the caller hands in as `posterIsSoloDispatcher` is the
 * poster's EFFECTIVE solo standing (resolveDispatcherStanding in
 * myDesk.ts), not the raw stored flag: while the poster holds
 * company standing — a dispatch seat in any company, or a dispatch
 * company of their own — the flag is treated as closed for accrual,
 * and a poster under a fleet roof with company standing accrues
 * nothing on the solo door. Company standing wins. Entries already
 * recorded are history and are never rewritten by the switch.
 */

/** The platform fee rate, in percent of the load's gross pay. */
export const PLATFORM_FEE_PCT = 2;

/** The plain label every platform-fee record carries. */
export const PLATFORM_FEE_LABEL = "Platform fee 2% — invoiced at sealed delivery";

/** 2% of the load's gross pay, at cent precision. */
export function platformFeeForGross(grossAmount: number): number {
  return Math.round(grossAmount * (PLATFORM_FEE_PCT / 100) * 100) / 100;
}

/**
 * Does this sealed load accrue a platform fee? Decided from the
 * load's origin and the POSTER's state at the seal — resolved
 * server-side from records, never from client input.
 *
 * `posterIsSoloDispatcher` is the round-3 door as reconciled by
 * round 4: the posting person's EFFECTIVE solo standing — they
 * opened My Desk AND hold no company standing (a dispatch seat
 * anywhere, or a dispatch company of their own, suppresses it).
 * It decides for every poster NOT under a dispatch company's
 * roof. Dispatch-company posters never consult it — the company
 * rule (dispatch-only accrues, converted never) is theirs.
 */
export function platformFeeApplies(args: {
  originKind: string | null;
  posterCompanyKind: "fleet" | "dispatch" | null;
  posterCompanyActivated: boolean;
  posterIsSoloDispatcher?: boolean;
}): boolean {
  if (args.originKind !== "broker_poster") return false;
  if (args.posterCompanyKind === "dispatch") return !args.posterCompanyActivated;
  return args.posterIsSoloDispatcher === true;
}
