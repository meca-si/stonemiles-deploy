/**
 * PAPERWORK-TO-PAY — pure rules module (Research Wave 2 item 2,
 * approved by x 2026-11-15).
 *
 * The pipeline: a driver attaches a scanned BOL/POD to a load →
 * an extraction read proposes candidate fields → the DRIVER
 * confirms or corrects them → once the delivery is sealed and the
 * POD is confirmed, the POD copy goes out to the broker/factor
 * address on file by itself and the invoice is cut by itself →
 * the paperwork/invoice stage shows on the load and on the
 * outward tracking page.
 *
 * THE GUARDRAILS (written here, enforced here and in actions.ts,
 * pinned by paperwork.test.ts + paperworkFlow.test.ts):
 * (a) Extraction NEVER writes load facts. A read produces
 *     CANDIDATES only; they land on the load record nowhere. Only
 *     the driver's confirmation records fields, and confirmation
 *     is what the send/invoice trigger stands on.
 * (b) The extraction seam is honest. paperworkExtractorFromEnv is
 *     the single place the configuration decision lives: no
 *     INFERENCE_API_KEY in the environment → NO provider (null),
 *     and the flow says plainly that automatic reading isn't set
 *     up and goes straight to manual confirm. A configured
 *     provider reads ONLY what is printed — the underlying reader
 *     (extractDocFieldsExtended in actions.ts) is instructed to
 *     return nulls rather than guesses, and a document with no
 *     load details reads as found:false, never as invented values.
 * (c) No send and no invoice without BOTH a sealed delivery and a
 *     confirmed POD (the evaluator in actions.ts checks the sealed
 *     POD status from the chain and the paperwork row's confirm
 *     state before either side effect; re-runs are idempotent —
 *     the send and the invoice each land at most once per load).
 * (d) NO rate or money field exists in any shape below. The stage
 *     derivation is never handed a rate or an amount, so neither
 *     can leak into the track payload, the driver's paperwork
 *     view, or a notification. The rate prints ONLY on the
 *     invoice document, as always (invoicing.ts).
 * (e) Low confidence is marked, never hidden: a candidate field
 *     that DISAGREES with the load record is flagged "needs a
 *     look" at confirm time (flagCandidateFields). Fields the
 *     load record can't check stay unflagged — unflagged means
 *     "nothing contradicted it", never "verified".
 *
 * Pure functions only — the database half (intake, evaluation,
 * sends, invoice cut) lives in actions.ts.
 */

import type { DocSideFields } from "./docVerify";

export type PaperworkDocKind = "bol" | "pod";

/** The candidate fields one extraction read proposes. Every field
 * is nullable: null means "not printed / not read", never zero or
 * empty by invention. */
export interface PaperworkCandidates {
  /** "City, ST → City, ST" as read from the document. */
  lane: string | null;
  /** Load / PO / PRO reference as printed. */
  reference: string | null;
  weightLbs: number | null;
  pieces: number | null;
  /** Delivery date/time as printed (free text — documents print
   * these a dozen ways; the driver confirms the reading). */
  deliveryText: string | null;
}

export const EMPTY_PAPERWORK_CANDIDATES: PaperworkCandidates = {
  lane: null,
  reference: null,
  weightLbs: null,
  pieces: null,
  deliveryText: null,
};

/** Map the document reader's field set onto the paperwork
 * candidate shape. The reader's own rate/charges fields are
 * deliberately NOT carried over — paperwork candidates never hold
 * money (guardrail d). */
export function candidatesFromDocFields(fields: DocSideFields): PaperworkCandidates {
  const place = (city: string | null, state: string | null) =>
    [city, state].filter((p) => p != null && p.trim() !== "").join(", ");
  const pickup = place(fields.pickupCity, fields.pickupState);
  const delivery = place(fields.deliveryCity, fields.deliveryState);
  return {
    lane: pickup && delivery ? `${pickup} → ${delivery}` : null,
    reference: fields.loadNumber ?? fields.poNumber ?? fields.proNumber ?? null,
    weightLbs: fields.weightLbs ?? null,
    pieces: fields.pieces ?? null,
    deliveryText: fields.deliveryWindow ?? null,
  };
}

// ---------------------------------------------------------------------------
// The extraction seam — in the style of pushSenderFromEnv
// (notifications.ts). The provider wraps the host inference reader,
// which is a host capability, so the reader is injected; the ENV
// decision lives here and nowhere else.
// ---------------------------------------------------------------------------

export interface PaperworkExtractor {
  /** Read one document image. Returns null when the read itself
   * could not be performed (unreadable file, provider error) —
   * the caller lands that as a failed read and manual confirm,
   * never as values. found:false means the document was read and
   * held no load details. */
  extract(args: {
    dataBase64: string;
    mimeType: string;
    docKind: PaperworkDocKind;
  }): Promise<{ found: boolean; fields: PaperworkCandidates } | null>;
}

/** The underlying document reader (actions.ts's
 * extractDocFieldsExtended over ctx.inference). */
export type PaperworkDocReader = (args: {
  dataBase64: string;
  mimeType: "image/jpeg" | "image/png";
}) => Promise<{ found: boolean; fields: DocSideFields } | null>;

/** Returns a provider ONLY when an extraction provider is
 * configured via env (INFERENCE_API_KEY — the same key the host's
 * real inference provider will sit behind). Unconfigured → null,
 * and the paperwork flow says so plainly and goes straight to
 * manual confirm. The reader takes document IMAGES; a PDF scan
 * cannot be read by it and the extract call returns null (a
 * failed read → manual confirm), never a guess. */
export function paperworkExtractorFromEnv(
  env: Record<string, string | undefined>,
  read: PaperworkDocReader,
): PaperworkExtractor | null {
  if (!env.INFERENCE_API_KEY) return null;
  return {
    async extract(args) {
      if (args.mimeType !== "image/jpeg" && args.mimeType !== "image/png") return null;
      const res = await read({ dataBase64: args.dataBase64, mimeType: args.mimeType });
      if (!res) return null;
      if (!res.found) return { found: false, fields: { ...EMPTY_PAPERWORK_CANDIDATES } };
      return { found: true, fields: candidatesFromDocFields(res.fields) };
    },
  };
}

// ---------------------------------------------------------------------------
// Low-confidence flags — a candidate that disagrees with the load
// record needs a look before the driver confirms it.
// ---------------------------------------------------------------------------

/** Per-field "needs a look" flags (true = flagged). */
export type PaperworkFieldFlags = Record<keyof PaperworkCandidates, boolean>;

export const NO_FIELD_FLAGS: PaperworkFieldFlags = {
  lane: false,
  reference: false,
  weightLbs: false,
  pieces: false,
  deliveryText: false,
};

function normText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Flag every candidate field that DISAGREES with what the load
 * record already carries. A field the record cannot check (no
 * load value, or free text like the delivery window) is never
 * flagged — and a candidate that is null (not read) is never
 * flagged either: absence is shown as a blank to fill, not as a
 * conflict. */
export function flagCandidateFields(
  candidates: PaperworkCandidates,
  load: {
    lane: string | null;
    referenceNumber: string | null;
    weightLbs: number | null;
  },
): PaperworkFieldFlags {
  return {
    lane:
      candidates.lane != null && load.lane != null && normText(candidates.lane) !== normText(load.lane),
    reference:
      candidates.reference != null &&
      load.referenceNumber != null &&
      normText(candidates.reference) !== normText(load.referenceNumber),
    weightLbs:
      candidates.weightLbs != null && load.weightLbs != null && candidates.weightLbs !== load.weightLbs,
    pieces: false,
    deliveryText: false,
  };
}

// ---------------------------------------------------------------------------
// Pipeline stage — the self-serve status. Derived from paperwork
// state + invoice state only; never handed a rate or an amount
// (guardrail d).
// ---------------------------------------------------------------------------

export type PaperworkStage = "none" | "received" | "confirmed" | "sent" | "invoiced" | "paid";

export const PAPERWORK_STAGE_LABELS: Record<PaperworkStage, string> = {
  none: "No paperwork filed yet",
  received: "Document received — waiting on the driver's check",
  confirmed: "Paperwork confirmed",
  sent: "POD copy sent",
  invoiced: "Invoice cut",
  paid: "Invoice marked paid",
};

/** The furthest stage the load's paperwork has reached. "sent"
 * requires the mail provider to have actually accepted the copy
 * (sendStatus "sent") — a queued send (mail still being set up)
 * stays at "confirmed" here and says so in the driver's own view;
 * the stage never overclaims. Invoice stages stand on the
 * invoice's own lifecycle (draft counts as cut only once issued —
 * the auto-cut lands issued; a still-draft invoice reads as the
 * stage before it). */
export function paperworkStage(input: {
  filed: boolean;
  confirmed: boolean;
  sendStatus: string | null;
  invoiceStatus: string | null; // draft | issued | paid | null
}): PaperworkStage {
  if (input.invoiceStatus === "paid") return "paid";
  if (input.invoiceStatus === "issued") return "invoiced";
  if (input.sendStatus === "sent") return "sent";
  if (input.confirmed) return "confirmed";
  if (input.filed) return "received";
  return "none";
}

/** Notification-center copy for paperwork events (in-app only —
 * these never become email; the broker/factor POD copy is a
 * document send through the mail transport, a separate path).
 * Lane and load only — never a rate, never a money figure. */
export function paperworkNotification(
  kind: "pod_sent" | "pod_queued" | "no_recipient" | "invoice_cut",
  args: { loadId: number; lane: string | null },
): { title: string; body: string } {
  const lane = args.lane ?? `Load #${args.loadId}`;
  switch (kind) {
    case "pod_sent":
      return {
        title: `Load #${args.loadId} — POD copy sent`,
        body: `${lane} — the confirmed proof of delivery went out to the broker/factor address on file. The send is on the load's sealed record.`,
      };
    case "pod_queued":
      return {
        title: `Load #${args.loadId} — POD copy queued`,
        body: `${lane} — the confirmed proof of delivery is ready to go out, and the copy is queued until mail is set up. Nothing else is needed from you.`,
      };
    case "no_recipient":
      return {
        title: `Load #${args.loadId} needs a look — no paperwork address on file`,
        body: `${lane} — the proof of delivery is confirmed, but no broker or factor email is on file for this load, so the copy can't go out on its own. Add the address in the load's paperwork section and it sends itself.`,
      };
    case "invoice_cut":
      return {
        title: `Load #${args.loadId} — invoice cut`,
        body: `${lane} — the invoice for this sealed load was cut automatically once the paperwork was confirmed. It is in Money → Invoices.`,
      };
  }
}

/** The outbound POD copy email body (the broker/factor document
 * send). Load facts only — the rate is not the paperwork's to
 * carry; it prints on the invoice document itself. */
export function podCopyOutboundText(args: {
  loadId: number;
  lane: string | null;
  reference: string | null;
  sha256: string;
  hasAttachment: boolean;
}): string {
  return [
    `Proof of delivery — Load #${args.loadId}`,
    "",
    ...(args.lane ? [`Lane: ${args.lane}`] : []),
    ...(args.reference ? [`Reference: ${args.reference}`] : []),
    `Document fingerprint (SHA-256): ${args.sha256}`,
    args.hasAttachment
      ? "The confirmed proof of delivery document is attached to this email."
      : "The confirmed proof of delivery is filed in the carrier's STONEMILES record for this load.",
    "",
    "This copy was sent automatically by STONEMILES once the delivery was sealed and the document was confirmed by the driver. The send is recorded on the load's sealed record.",
    "",
    "— STONEMILES by Stonervision",
  ].join("\n");
}

/** Attachment filename for an outbound paperwork copy. */
export function paperworkAttachmentFilename(docKind: PaperworkDocKind, loadId: number, mime: string): string {
  const ext =
    mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "bin";
  return `${docKind}-load-${loadId}.${ext}`;
}
