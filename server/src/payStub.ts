/**
 * PAY-STUB DELIVERY — pure rules module (x, 2026-10-27).
 *
 * Employers/owners send their drivers their W-2 pay stub or 1099 stub
 * INSIDE STONEMILES, before payday, instead of email. The stub lands
 * in the driver's Pay Book inbox; on the driver's acceptance it files
 * itself as a Pay Book entry ("gets uploaded").
 *
 * EMAIL IS DRIVER-OPTIONAL, TWO WAYS (x, 2026-10-30 — "keep it like
 * that but have both optional also", alongside the load-document
 * email toggle which defaults ON):
 *  1. The driver's own share (unchanged since 2026-10-27): the driver
 *     may email a copy of their own stub to themselves or others (tax
 *     preparer, bank, family) from their own mail app / the device
 *     share sheet — that flow lives client-side and is modelled here
 *     only by the posture constant below.
 *  2. The opt-in automatic copy (2026-10-30): a SEPARATE toggle in
 *     Document copies settings, DEFAULT OFF. Only when the DRIVER has
 *     turned it on does confirming a stub into the Pay Book (logging
 *     a scanned stub, or accepting a company-sent one) also email a
 *     copy to the driver / dispatch / owner seats — planned in
 *     docCopies.ts (planPayStubDeliveryStatus) and recorded in
 *     pay_stub_email_deliveries. Sending a stub (sendPayStub) NEVER
 *     emails anyone, whatever the toggle says: the copy fires on the
 *     driver's confirmation, mirroring the load-document rule.
 *
 * Every rule below is a pure function of its inputs (the
 * ownerGiveaway.ts pattern) so the role gates, the roster scoping,
 * the status machine, and the delivery → pay-entry mapping are
 * unit-tested without a database.
 */

import {
normalizeDeductionLines,
sumDeductionLines,
type DeductionLine,
} from "./payBook";

export type StubKind = "w2" | "1099";
export type StubDeliveryType = "stub" | "form";
export type StubStatus = "sent" | "accepted" | "flagged" | "withdrawn";

/** The email posture, stated plainly wherever the share action sits:
 *  emailing is the driver's choice, it opens the driver's own mail
 *  app, STONEMILES does not send the email and does not store the
 *  recipient. Nothing is ever sent automatically. */
export const DRIVER_EMAIL_POSTURE =
  "Emailing is your choice — it opens your own mail app. STONEMILES does not send the email and does not store who you send it to.";

/** The opt-in automatic-copy posture (2026-10-30): the second,
 *  separate email path for pay stubs. Default OFF; only the driver's
 *  own opt-in turns it on, and it fires only on confirmation. */
export const PAY_STUB_AUTO_EMAIL_POSTURE =
  "Pay-stub email copies are off unless you turn them on in Document copies settings (Loads → All loads). When they're on, confirming a stub into your Pay Book — logging a scanned stub, or accepting one your company sent — also emails a copy to the driver, dispatch, and owner addresses in those settings. Your Pay Book filing happens either way.";

/** Sending is in-app only — the line the Owner Console states. */
export const IN_APP_ONLY_NOTE =
  "Sent in STONEMILES, not by email — the sealed record lives here. A stub can go out before payday; the pay date on the stub is what the driver's totals follow.";

/**
 * Should confirming this stub attempt the automatic email copy?
 * All three must hold: the driver opted in, the confirmation carries
 * an actual stub FILE (a scanned/uploaded document — a hand-typed
 * entry with no file is not a confirmed upload), and the entry was
 * just created by this confirmation (the caller passes the fresh
 * entry id; dedupe in the actions layer makes a retry a no-op).
 */
export function shouldAutoEmailPayStub(args: {
  payStubEmailEnabled: boolean;
  hasStubFile: boolean;
}): boolean {
  return args.payStubEmailEnabled && args.hasStubFile;
}

// ---- Sender gate -------------------------------------------------------------

/** Who may send a stub: the company OWNER or DISPATCH seat only.
 *  Drivers never send; a solo account (no company) gets the fleet
 *  explanation, never a dead end. */
export function senderGate(args: {
  hasCompany: boolean;
  role: string | null;
}): { allowed: boolean; error: string | null } {
  if (!args.hasCompany) {
    return {
      allowed: false,
      error:
        "Pay stubs are a company tool. Create a fleet first — My company → Create a fleet — and add your drivers; then you can send them their stubs here, before payday, instead of email.",
    };
  }
  if (args.role === "owner" || args.role === "dispatch") {
    return { allowed: true, error: null };
  }
  return {
    allowed: false,
    error: "Only the company owner or dispatch can send pay stubs — drivers receive them in their Pay Book.",
  };
}

// ---- Roster scoping ------------------------------------------------------------

export type RosterMember = { username: string; role: string };

/** The ONLY eligible recipients: company members whose role is
 *  exactly "driver", sorted. The owner and dispatch never receive
 *  stubs — by construction, not by a UI filter. */
export function eligibleRecipients(members: RosterMember[]): string[] {
  return members
    .filter((m) => m.role === "driver")
    .map((m) => m.username)
    .sort();
}

/**
 * Validate a send's recipient against the SENDER's own company
 * roster. The recipient must be a role-"driver" member of this
 * company: a driver from another company is not on the roster and is
 * refused BY NAME; the owner or a dispatch seat named as recipient
 * is refused by name too (they are never recipients).
 */
export function validateStubRecipient(
  members: RosterMember[],
  recipient: string,
): { ok: boolean; error: string | null } {
  const byName = new Map(members.map((m) => [m.username, m]));
  const member = byName.get(recipient);
  if (member && member.role !== "driver") {
    return {
      ok: false,
      error: `@${recipient} is the ${member.role} — pay stubs go to your drivers only; the owner and dispatch are never recipients.`,
    };
  }
  if (!member) {
    return {
      ok: false,
      error: `@${recipient} is not a driver in your company — a stub can only be sent to your own roster.`,
    };
  }
  return { ok: true, error: null };
}

// ---- Status machine ------------------------------------------------------------

/** Accept files the Pay Book entry — only from "sent", and exactly
 *  once: an already-accepted delivery can never file a second entry
 *  (the action also claims the row with a conditional update). */
export function acceptGate(status: StubStatus): { allowed: boolean; error: string | null } {
  if (status === "sent") return { allowed: true, error: null };
  return {
    allowed: false,
    error:
      status === "accepted"
        ? "This stub is already in your Pay Book — it filed once and won't be counted twice."
        : `This stub was ${status} — it can't be accepted now.`,
  };
}

/** Flagging is the mismatch path: recipient only, only while "sent",
 *  with a short reason the sender sees. No Pay Book entry is created. */
export function flagGate(status: StubStatus): { allowed: boolean; error: string | null } {
  if (status === "sent") return { allowed: true, error: null };
  return {
    allowed: false,
    error:
      status === "accepted"
        ? "This stub already filed into your Pay Book — if the numbers are wrong, talk to your company and keep the sealed copy as your proof."
        : `This stub was ${status} — it can't be flagged now.`,
  };
}

/** Withdraw: the SENDER only, and only while the delivery is still
 *  "sent" — never after the driver accepted or flagged it. */
export function withdrawGate(args: {
  status: StubStatus;
  isSender: boolean;
}): { allowed: boolean; error: string | null } {
  if (!args.isSender) {
    return { allowed: false, error: "Only the person who sent this stub can withdraw it." };
  }
  if (args.status === "sent") return { allowed: true, error: null };
  return {
    allowed: false,
    error:
      args.status === "accepted"
        ? "This stub was already accepted into the driver's Pay Book — it can't be withdrawn now."
        : `This stub was ${args.status} — only a stub still waiting on the driver can be withdrawn.`,
  };
}

// ---- Delivery → Pay Book entry mapping -----------------------------------------

export type StubDeliveryLike = {
  kind: StubKind;
  deliveryType: StubDeliveryType;
  paidAtMs: number;
  taxYear: number | null;
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  otherDeductions: number;
  /** Itemized deduction lines (1099 stubs only): fuel, truck
   *  payment, insurance, escrow, fees — the named amounts that came
   *  off before the owner was paid. Never tax. */
  deductionLines?: DeductionLine[];
  /** Non-taxable per diem paid separately; carried intact onto the
   *  filed Pay Book entry for stub deliveries, ignored for forms. */
  perDiem?: number;
  notes: string | null;
};

export type PayEntryDraft = {
  kind: StubKind;
  /** "form" deliveries file as year-end form entries — excluded from
   *  the pay totals by the existing Pay Book rules, exactly like a
   *  form the driver logs by hand in January. */
  isForm: boolean;
  paidAtMs: number;
  taxYear: number | null;
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  otherDeductions: number;
  deductionLines: DeductionLine[];
  perDiem: number;
  notes: string | null;
};

/**
 * Map an accepted delivery onto the Pay Book entry it files. The
 * payer is the sending company's name (the action supplies it —
 * the delivery row carries the company id). A stub keeps its own
 * withholding figures; a form's tax year defaults to the year of
 * its date when the sender didn't print one, mirroring logPayEntry.
 */
export function deliveryToPayEntry(d: StubDeliveryLike): PayEntryDraft {
  const isForm = d.deliveryType === "form";
  // Itemized lines ride intact onto a 1099 STUB's entry and their sum
  // IS the entry's deductions total — the entry mirrors the stub line
  // by line. W-2 deliveries and forms carry no lines: a W-2 entry
  // keeps its lump other-deductions figure, a form's lines are
  // ignored exactly like its per diem. A 1099 stub also carries NO
  // tax withholding — none is ever taken from 1099 pay — so its
  // federal/state land as 0 whatever the delivery row holds.
  const lines = !isForm && d.kind === "1099" ? normalizeDeductionLines(d.deductionLines) : [];
  const is1099Stub = !isForm && d.kind === "1099";
  return {
    kind: d.kind,
    isForm,
    paidAtMs: d.paidAtMs,
    taxYear: isForm ? (d.taxYear ?? new Date(d.paidAtMs).getFullYear()) : d.taxYear,
    gross: d.gross,
    federalWithheld: is1099Stub ? 0 : d.federalWithheld,
    stateWithheld: is1099Stub ? 0 : d.stateWithheld,
    otherDeductions: lines.length > 0 ? sumDeductionLines(lines) : d.otherDeductions,
    deductionLines: lines,
    // Per diem rides intact onto a stub's entry; a form's is ignored.
    perDiem: isForm ? 0 : (d.perDiem ?? 0),
    notes: d.notes,
  };
}
