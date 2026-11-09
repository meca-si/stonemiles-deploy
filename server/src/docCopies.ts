/**
 * CONFIRMED-DOCUMENT COPIES — pure rules module (x, 2026-10-30).
 *
 * X's order: "a copy of any confirmed uploads get emailed to driver,
 * dispatch and owner / fleet owner after upload and saved in users
 * file." Scope as clarified the same morning: confirmed LOAD documents
 * — the rate con / BOL attached when a load is saved after the
 * driver confirms the scan-filled form, the pickup BOL once the driver
 * confirms its read, and the POD at the delivery seal.
 *
 * X's follow-up the same morning ("keep it like that but have both
 * optional also"): BOTH email paths are optional settings. Load
 * documents use the `enabled` toggle (default ON). Pay stubs gained
 * their own toggle (default OFF, driver opts in) — when it is ON, a
 * CONFIRMED pay stub (logged from a scan, or a company stub accepted
 * into the Pay Book) emails the same three seats through the planner
 * at the bottom of this file; when it is OFF, pay stubs stay in-app
 * only exactly as before. Filing in the user's files is never gated
 * by either toggle.
 *
 * Every rule below is a pure function of its inputs (the payStub.ts /
 * ownerGiveaway.ts pattern) so recipient resolution, address checks,
 * and the delivery-status plan are unit-tested without a database or
 * a mail provider. The actions layer owns the side effects: filing the
 * copy (always), recording one delivery row per seat (always), and
 * attempting the send through the privileged mail transport (only when
 * a provider is connected — a delivery may read "sent" only with a
 * provider id in hand).
 */

export type DocCopyKind = "rate_con" | "bol" | "pod" | "load_sheet" | "load_document";
export type DocRecipientRole = "driver" | "dispatch" | "owner";
export type DocDeliveryStatus = "sent" | "queued" | "no_address" | "off" | "failed";

/** Human label for a document kind, used in copy titles and emails. */
export function docKindLabel(kind: string): string {
  switch (kind) {
    case "rate_con":
      return "Rate confirmation";
    case "bol":
      return "Bill of lading (BOL)";
    case "pod":
      return "Proof of delivery (POD)";
    case "load_sheet":
      return "Load sheet";
    default:
      return "Load document";
  }
}

/** Map the scan read's kind onto the filed-copy kinds. Anything the
 *  read didn't classify files as a plain load document — never
 *  upgraded to a rate con or BOL the paper didn't claim to be. */
export function filedKindForScanKind(scanKind: string | null | undefined): DocCopyKind {
  if (scanKind === "rate_con" || scanKind === "bol" || scanKind === "load_sheet") return scanKind;
  return "load_document";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An address the app will actually use: trimmed, single @, a dotted
 *  domain, no spaces, sane length. Anything else is "not an address"
 *  and the settings save rejects it by field name. */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length >= 5 && v.length <= 120 && EMAIL_RE.test(v);
}

/** Normalize a stored/entered address: the trimmed address when it is
 *  valid, else null (an invalid stored value reads as "no address on
 *  file" — it is never mailed to and never guessed at). */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return isValidEmail(v) ? v : null;
}

export type ResolvedRecipient = {
  role: DocRecipientRole;
  /** The address a copy goes to, or null when none is on file. */
  email: string | null;
  /** Where the address came from, in plain words for the UI. */
  emailSource: string;
  /** The seat's account name when the app knows one (company roster /
   *  the uploader). Null when the seat is only an email address. */
  username: string | null;
};

/**
 * Resolve the three copy recipients for one confirmed upload.
 *
 * Sources, in the order they win:
 *  - Driver: the Document copies settings' driver email. (The app
 *    holds no login email for the driver in this staging model, so
 *    there is nothing to fall back to — the settings field IS the
 *    driver's address of record for copies.)
 *  - Dispatch: the settings' dispatch email; the username is the
 *    first dispatch seat on the company roster when there is one.
 *  - Owner / fleet owner: the settings' owner email, else the company
 *    setup's contact email (the fleet's business contact of record).
 *    Solo (no company): the owner seat is the driver themselves.
 */
export function resolveDocRecipients(args: {
  driverUsername: string;
  driverEmail: string | null;
  dispatchEmail: string | null;
  ownerEmailSetting: string | null;
  companyContactEmail: string | null;
  ownerUsername: string | null;
  dispatchUsernames: string[];
  inCompany: boolean;
}): ResolvedRecipient[] {
  const driverEmail = normalizeEmail(args.driverEmail);
  const dispatchEmail = normalizeEmail(args.dispatchEmail);
  const ownerSetting = normalizeEmail(args.ownerEmailSetting);
  const ownerContact = normalizeEmail(args.companyContactEmail);
  const ownerEmail = ownerSetting ?? ownerContact;
  return [
    {
      role: "driver",
      email: driverEmail,
      emailSource: driverEmail ? "Document copies settings" : "No driver email on file",
      username: args.driverUsername,
    },
    {
      role: "dispatch",
      email: dispatchEmail,
      emailSource: dispatchEmail
        ? "Document copies settings"
        : args.inCompany
          ? "No dispatch email on file"
          : "No dispatch email on file — solo account",
      username: args.dispatchUsernames[0] ?? null,
    },
    {
      role: "owner",
      email: ownerEmail,
      emailSource: ownerSetting
        ? "Document copies settings"
        : ownerContact
          ? "Company setup contact email"
          : args.inCompany
            ? "No owner email on file"
            : "No owner email on file — solo account",
      username: args.ownerUsername ?? (args.inCompany ? null : args.driverUsername),
    },
  ];
}

/**
 * The status a fresh delivery row starts with, before any send is
 * attempted. "send" is the caller's cue to attempt the transport;
 * the row lands as sent/failed from the transport's answer.
 */
export function planDeliveryStatus(args: {
  enabled: boolean;
  email: string | null;
  providerConfigured: boolean;
}): { status: DocDeliveryStatus | "send"; detail: string } {
  if (!args.enabled) {
    return {
      status: "off",
      detail: "Email copies are turned off in Document copies settings — the copy was filed in the user's Files only.",
    };
  }
  if (!args.email) {
    return {
      status: "no_address",
      detail: "No email address on file for this seat — add one in Document copies settings (Loads → All loads) and the next confirmed document copies them in.",
    };
  }
  if (!args.providerConfigured) {
    return {
      status: "queued",
      detail: "Queued — the mail provider isn't connected yet, so nothing has been sent. The copy is filed in the user's Files now; queued copies send when email is connected at go-live.",
    };
  }
  return { status: "send", detail: "Sending through the connected mail provider." };
}

/** Dedupe identity for a filed copy: one copy per document per load.
 *  The SHA-256 is the document's fingerprint, so re-confirming the
 *  same bytes never files or emails a second copy. */
export function filedCopyDedupeKey(loadId: number, docKind: string, sha256: string): string {
  return `load:${loadId}:${docKind}:${sha256}`;
}

export function deliveryDedupeKey(filedDedupeKey: string, role: DocRecipientRole): string {
  return `${filedDedupeKey}:${role}`;
}

// ---- Pay-stub email copies (x, 2026-10-30: "both optional also") -----------
//
// The load-document rule above gained a sibling the same morning:
// BOTH email paths are optional settings. Load documents keep the
// `enabled` toggle (default ON). Pay stubs get their OWN toggle
// (default OFF — the driver opts in), planned here with the same
// honest statuses. A pay stub is "confirmed" when the driver logs a
// scanned stub into their Pay Book or accepts a company-sent stub
// into it — never at scan time and never at company-send time.

/**
 * The status a fresh PAY-STUB delivery row starts with. Same ladder
 * as planDeliveryStatus, with pay-stub wording: "off" names the
 * pay-stub toggle specifically, so a driver reading the record can
 * tell which switch was off.
 */
export function planPayStubDeliveryStatus(args: {
  enabled: boolean;
  email: string | null;
  providerConfigured: boolean;
}): { status: DocDeliveryStatus | "send"; detail: string } {
  if (!args.enabled) {
    return {
      status: "off",
      detail: "Pay-stub email copies are turned off — the stub was filed in the Pay Book only. Turn them on in Document copies settings (Loads → All loads) if you want confirmed stubs emailed too.",
    };
  }
  if (!args.email) {
    return {
      status: "no_address",
      detail: "No email address on file for this seat — add one in Document copies settings (Loads → All loads) and the next confirmed stub copies them in.",
    };
  }
  if (!args.providerConfigured) {
    return {
      status: "queued",
      detail: "Queued — the mail provider isn't connected yet, so nothing has been sent. The stub is filed in the Pay Book now; queued copies send when email is connected at go-live.",
    };
  }
  return { status: "send", detail: "Sending through the connected mail provider." };
}

/** Dedupe identity for a pay-stub email copy: one copy per confirmed
 *  Pay Book entry per seat. The entry id is the confirmation — an
 *  entry is created exactly once, so its copies can never double. */
export function payStubEmailDedupeKey(payEntryId: number, role: DocRecipientRole): string {
  return `payentry:${payEntryId}:${role}`;
}

/** Human label for a pay-stub email copy, used in subjects and lists.
 *  One pile only — a W-2 copy never names 1099 figures and vice
 *  versa; the two piles are never merged into one email. */
export function payStubKindLabel(kind: string, isForm: boolean): string {
  const pile = kind === "1099" ? "1099" : "W-2";
  return isForm ? `${pile} year-end form` : `${pile} pay stub`;
}
