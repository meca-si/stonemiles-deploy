/**
 * BOARD ASSIGNMENT FLOW — pure rules (x, 2026-11-10).
 *
 * Pure functions only: no I/O, unit-tested (boardAssignment.test.ts).
 * actions.ts resolves the caller's facts server-side (membership,
 * role, the board row) and runs every assignment decision through
 * here. Nothing here trusts client input beyond cleaning it.
 *
 * The flow, in x's terms: the desk (fleet owner or a dispatch seat)
 * books a load on the company board and ASSIGNS it to one of the
 * fleet's own drivers. Assignment is an OFFER, not a drop: the board
 * row sits in status "assigned" naming the driver, and NO driver
 * load exists yet. The driver sees it in an "Assigned to you" list —
 * nobody else does, not even other drivers in the same fleet — and
 * answers it:
 *  - ACCEPT: the row flips to "taken" and the driver's real load +
 *    trip are created at that moment (the sealed Load Tracker runs
 *    from the booked load, exactly like a claim).
 *  - DECLINE (with a reason): the row returns to "open" and the
 *    reason rides back to the desk on the row itself, so the desk
 *    sees why before it re-offers or reassigns the load.
 * The desk can reassign a still-pending offer to a different driver
 * in the same fleet, or cancel it back to open. Once accepted, the
 * existing unassign-before-pickup rule governs taking it back.
 */

/** The assignment phase a board row is in, derived from the row's
 *  standing fields — never stored separately, so it can't drift. */
export type AssignmentPhase = "none" | "pending" | "accepted";

export function assignmentPhaseFor(args: {
  status: string;
  claimMethod: string | null | undefined;
}): AssignmentPhase {
  if (args.status === "assigned") return "pending";
  if (args.status === "taken" && args.claimMethod === "assign") return "accepted";
  return "none";
}

const sameUser = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** May this user answer (accept / decline) the assignment on a row?
 *  Only the named driver, and only while the offer is still pending. */
export function canRespondToAssignment(args: {
  status: string;
  claimedBy: string | null | undefined;
  username: string;
}): boolean {
  return args.status === "assigned" && sameUser(args.claimedBy, args.username);
}

export type AssignDecision =
  | { kind: "assign" }
  | { kind: "reassign"; from: string }
  | { kind: "refuse"; error: string };

/**
 * What an assign request means for a row in its current state:
 *  - open row            → a fresh offer to the target;
 *  - assigned row        → a REASSIGN when the target is a different
 *                          driver; a refusal when it's the same one
 *                          (the offer is already theirs, pending);
 *  - taken / overflowed  → refused; the caller phrases the remedy
 *                          (unassign a taken load, recall an
 *                          overflowed one) since it owns the row.
 */
export function assignDecisionFor(args: {
  status: string;
  claimedBy: string | null | undefined;
  targetUsername: string;
}): AssignDecision {
  if (args.status === "open") return { kind: "assign" };
  if (args.status === "assigned") {
    if (sameUser(args.claimedBy, args.targetUsername)) {
      return {
        kind: "refuse",
        error: `@${args.targetUsername} already has this assignment — it's waiting on them to accept or decline.`,
      };
    }
    return { kind: "reassign", from: args.claimedBy ?? "" };
  }
  return { kind: "refuse", error: "That load is no longer open." };
}

/**
 * Validate + clean a decline reason. A reason is REQUIRED — the desk
 * gets words back, never a silent no — and it is stored on the board
 * row where the desk reads it. Capped at 300 chars like the other
 * desk-facing notes in this codebase.
 */
export function validateDeclineReason(
  input: string | null | undefined,
): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = (input ?? "").trim().slice(0, 300);
  if (!reason) {
    return {
      ok: false,
      error: "Give the desk a reason — a decline always carries words back, so they know how to cover the load.",
    };
  }
  return { ok: true, reason };
}

/** Validate + clean the reference number a booked load carries (BOL /
 *  PO / order number the shipper or broker named). Optional — a desk
 *  often books first and gets the number later — capped at 80 chars. */
export function cleanReferenceNumber(input: string | null | undefined): string | null {
  const t = (input ?? "").trim().slice(0, 80);
  return t ? t : null;
}
