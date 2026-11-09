// STONEMILES SI — Super Intelligent layer (driver order 2026-11-01).
//
// The SI layer is the autonomous back-office the driver approved:
// it heals its own road-matching (via the road-learning layer),
// files and seals its own paperwork, chases its own fuel plan,
// preps trip sheets state-by-state without being asked, catches
// its own bad data and corrects it, vets brokers / shippers /
// owners / loads BEFORE they reach a board, and surfaces ONLY
// decisions — never chores.
//
// THE RULES (set in stone by the driver, 2026-11-01 — this array
// is the canonical copy the UI renders and the sweep enforces):
//   1. Public information only. No personal data is ever read or
//      accessed by SI. Vetting uses public records only — FMCSA
//      SAFER and other public sources. Sealed documents, Pay Book,
//      credentials, and private identifiers are never inputs.
//   2. Self-healing. Road-matching learns and corrects its own
//      mistakes; bad data is caught and corrected as NEW log
//      entries — sealed history is never rewritten.
//   3. Paperwork runs itself. Filing and sealing prep happens
//      without being asked; anything that needs a signature or a
//      legal call surfaces as a decision.
//   4. Fuel plan runs itself. SI chases the fuel plan from the
//      driver's own logged purchases and settings.
//   5. Trip sheets prep themselves, state by state, before the
//      driver asks — from the trip queue and sealed records.
//   6. Vet before posting. Brokers, shippers, owners, and loads
//      are checked against public records before they land on a
//      board. A flag surfaces as a decision — SI never silently
//      rejects a person or publishes a verdict on anybody.
//   7. Duty status is ASKED, never assumed. The 1-mile auto-start
//      prompt asks; duty never changes without the driver's
//      answer, and the answer is stamped in the sealed record.
//      SI never touches, pre-answers, or bypasses that prompt.
//   8. Standard rules govern. SI runs under ALL standing house
//      rules (security standard, numbers rule, pay-document
//      privacy, every approval gate). Where a standard rule and
//      an autonomous feature collide, the standard rule wins and
//      the feature yields. No autonomous money moves. The driver
//      keeps every driving and legal call.
//
// This module is pure and tested (si.test.ts): vetting math, the
// personal-data guard, load checks, and trip-sheet data-quality
// checks. The actions layer (actions.ts) owns storage and the
// sweep that runs these checks over the driver's real records.

import { authorityDigits, saferUrlFor } from "./safer";

export const SI_RULES_VERSION = "2026-11-01";

export type SiRule = { n: number; title: string; text: string };

export const SI_RULES: SiRule[] = [
  {
    n: 1,
    title: "Public information only — no personal data",
    text: "SI reads public records and the public web only. It never reads or accesses anyone's personal data — no sealed documents, no Pay Book, no credentials, no private identifiers are ever an input to an SI check.",
  },
  {
    n: 2,
    title: "It heals itself",
    text: "Road-matching learns and corrects its own mistakes (the road-learning layer), and SI catches its own bad data and corrects it — always as a new log entry. Sealed records, miles, and pay are never rewritten after the fact.",
  },
  {
    n: 3,
    title: "It does the paperwork",
    text: "SI files and seals its own paperwork prep without being asked — expiring documents, unsealed paperwork, and missing filings surface early. Anything needing a signature or a legal call comes to the driver as a decision.",
  },
  {
    n: 4,
    title: "It chases its own fuel plan",
    text: "SI keeps the fuel plan current from the driver's own logged purchases, MPG, and tank range — flagging when a planned trip outruns the fuel on the plan. It never invents a price.",
  },
  {
    n: 5,
    title: "Trip sheets prep themselves, state by state",
    text: "For every planned or active queued trip, SI preps the trip sheet skeleton — origin, destination, stops, pay basis, and the state-by-state lines that will fill as the truck crosses state lines — without being asked.",
  },
  {
    n: 6,
    title: "Vet before anything posts",
    text: "Brokers, shippers, owners, and loads are checked against public records (FMCSA SAFER and the public web) before they land on a board. Flags surface as decisions for a human — SI never silently rejects anyone and never publishes a verdict on anybody.",
  },
  {
    n: 7,
    title: "Duty status: the prompt asks",
    text: "The duty-status prompt asks, and duty never changes without the driver's answer; the answer is stamped in the sealed record. SI never touches that prompt, never pre-answers it, and never changes duty on its own.",
  },
  {
    n: 8,
    title: "Standard rules govern",
    text: "SI runs under all the standing house rules — the Security Standard, the numbers rule, pay-document privacy, and every approval gate. Where a standard rule and an autonomous feature collide, the standard rule wins and the feature yields. No autonomous money moves; the driver keeps every driving and legal call.",
  },
];

// ---- Personal-data guard (Rule 1) -------------------------------------------
// Vetting inputs are BUSINESS identifiers only: a company/broker name
// plus MC / USDOT numbers (public business information). Anything
// that looks like personal data is refused before it is stored or
// checked — SI never becomes a place personal data lives.

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const CARD_RE = /\b(?:\d[ -]?){13,16}\d\b/;
const SEED_OR_SECRET_RE = /\b(seed phrase|private key|password|passwd|ssn|social security)\b/i;

/** Returns a plain-words refusal reason when the text carries what
 *  looks like personal data, or null when it is clean. Deliberately
 *  conservative: a false refusal costs a retype; a false pass would
 *  break Rule 1. Email addresses and phone numbers are NOT refused
 *  here — they are contact data a user may type about a business —
 *  but they are also never used by vetting (see vetEntity: only the
 *  name + authority numbers are checked). */
export function personalDataRefusal(text: string | null | undefined): string | null {
  if (!text) return null;
  if (SSN_RE.test(text)) return "That looks like a Social Security number — SI checks public business records only and never touches personal identifiers. Remove it and run the check with the company name and MC / USDOT number.";
  if (CARD_RE.test(text)) return "That looks like a card number — SI never accepts payment credentials. Run the check with the company name and MC / USDOT number only.";
  if (SEED_OR_SECRET_RE.test(text)) return "That mentions a secret (seed phrase, private key, password, or SSN) — SI never accepts secrets. Run the check with public business identifiers only.";
  return null;
}

// ---- Entity vetting (Rule 6, public records only) ---------------------------

export type SiEntityType = "broker" | "shipper" | "owner" | "carrier";
export type SiVerdict = "clear" | "review" | "hold";
export type SiFlag = { code: string; label: string; severity: "review" | "hold" };

export type SiVetResult = {
  verdict: SiVerdict;
  flags: SiFlag[];
  saferUrl: string | null;
  mcDigits: string;
  dotDigits: string;
  /** Plain-words summary of what was checked — public sources only. */
  summary: string;
};

/**
 * Vet one broker / shipper / owner / carrier from PUBLIC business
 * identifiers only. The check is structural and link-building: it
 * validates the authority numbers' shape, builds the official
 * FMCSA SAFER snapshot link for a human (or a later public fetch)
 * to confirm, and flags what is missing. It never fetches private
 * data, never computes a safety score, and never returns a verdict
 * ON a person — "hold" means "a human must look before this posts",
 * not "this party is bad".
 */
export function vetEntity(args: {
  entityType: SiEntityType;
  name: string | null | undefined;
  mcNumber: string | null | undefined;
  dotNumber: string | null | undefined;
}): SiVetResult {
  const flags: SiFlag[] = [];
  const name = (args.name ?? "").trim();
  const mcDigits = authorityDigits(args.mcNumber ?? "");
  const dotDigits = authorityDigits(args.dotNumber ?? "");

  if (!name) flags.push({ code: "missing_name", label: "No company / broker name on the submission — a board post must name who it comes from.", severity: "hold" });

  // Brokers must hold broker authority (an MC number is the public
  // marker). Shippers are not carriers — no authority is required of
  // them, but at least one public identifier is asked for. Owners /
  // carriers posting or claiming need MC or USDOT.
  if (args.entityType === "broker" && !mcDigits) {
    flags.push({ code: "broker_missing_mc", label: "Broker with no MC number on file — broker authority can't be confirmed from public records without one. Hold for a human check before posting.", severity: "hold" });
  }
  if ((args.entityType === "owner" || args.entityType === "carrier") && !mcDigits && !dotDigits) {
    flags.push({ code: "carrier_missing_authority", label: "No MC or USDOT number on file — carrier authority can't be confirmed from public records. Hold for a human check before posting.", severity: "hold" });
  }
  if (args.entityType === "shipper" && !mcDigits && !dotDigits) {
    flags.push({ code: "shipper_no_identifier", label: "Shipper named with no MC / USDOT on file (shippers don't need carrier authority — this is a note, not a block). A human should confirm the shipper's identity before the load posts.", severity: "review" });
  }
  if (mcDigits && (mcDigits.length < 5 || mcDigits.length > 8)) {
    flags.push({ code: "mc_shape", label: `MC number "${mcDigits}" doesn't look like a real MC number (5–8 digits) — check for a typo before posting.`, severity: "review" });
  }
  if (dotDigits && (dotDigits.length < 5 || dotDigits.length > 8)) {
    flags.push({ code: "dot_shape", label: `USDOT number "${dotDigits}" doesn't look like a real USDOT number (5–8 digits) — check for a typo before posting.`, severity: "review" });
  }

  const saferUrl = saferUrlFor({ dotNumber: dotDigits || null, mcNumber: mcDigits || null });
  if ((mcDigits || dotDigits) && !saferUrl) {
    flags.push({ code: "no_safer_link", label: "No FMCSA SAFER snapshot link could be built from the numbers given — a human should verify authority another public way before posting.", severity: "review" });
  }

  const verdict: SiVerdict = flags.some((f) => f.severity === "hold") ? "hold" : flags.length > 0 ? "review" : "clear";
  const summary =
    verdict === "clear"
      ? `Public-record check passed on structure: ${name || "the party"} carries ${[mcDigits ? `MC ${mcDigits}` : null, dotDigits ? `USDOT ${dotDigits}` : null].filter(Boolean).join(" · ")}. Confirm the live record on the FMCSA SAFER snapshot before relying on it — SI links the official record, it does not copy or score it.`
      : verdict === "hold"
        ? `Held for a human decision before posting: ${flags.filter((f) => f.severity === "hold").map((f) => f.label).join(" ")}`
        : `Postable, with notes for a human to see: ${flags.map((f) => f.label).join(" ")}`;
  return { verdict, flags, saferUrl, mcDigits, dotDigits, summary };
}

// ---- Load vetting (Rule 6) ---------------------------------------------------

export type SiLoadInput = {
  shipper: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  rate: number | null;
  loadedMiles: number | null;
  weightLbs: number | null;
  commodity: string | null;
  hazmat: boolean;
  equipmentType: string | null;
};

export type SiLoadResult = { verdict: SiVerdict; flags: SiFlag[]; ratePerMile: number | null; summary: string };

/** Pre-post load check: completeness + sanity from the load's own
 *  fields only (no external data, nothing personal). A "hold" here
 *  means the post is not board-ready — missing rate or an end of
 *  the lane — mirroring the portals' own draft-only gates. */
export function vetLoadForBoard(load: SiLoadInput): SiLoadResult {
  const flags: SiFlag[] = [];
  if (!load.pickupCity && !load.pickupState) flags.push({ code: "missing_pickup", label: "No pickup city/state — the lane has no start. Hold until the pickup is named.", severity: "hold" });
  if (!load.deliveryCity && !load.deliveryState) flags.push({ code: "missing_delivery", label: "No delivery city/state — the lane has no end. Hold until the delivery is named.", severity: "hold" });
  if (load.rate == null) flags.push({ code: "missing_rate", label: "No rate on the load — board posts must carry their rate (draft-only until one is set, same as the portals).", severity: "hold" });
  if (load.rate != null && load.rate <= 0) flags.push({ code: "zero_rate", label: "Rate is $0 — that reads as a placeholder, not a real offer. Hold for a human check.", severity: "hold" });

  const ratePerMile = load.rate != null && load.loadedMiles != null && load.loadedMiles > 0 ? Math.round((load.rate / load.loadedMiles) * 100) / 100 : null;
  if (load.rate != null && load.loadedMiles == null) flags.push({ code: "missing_miles", label: "No loaded miles on file — the $/mi can't be shown, so drivers can't judge the load. Note for the poster; the board will show $/mi as unknown, never guessed.", severity: "review" });
  if (ratePerMile != null && ratePerMile < 1) flags.push({ code: "rpm_very_low", label: `Rate works out to $${ratePerMile.toFixed(2)}/mi — well under typical operating cost. Flagged so a human confirms it's real before it posts.`, severity: "review" });
  if (ratePerMile != null && ratePerMile > 10) flags.push({ code: "rpm_very_high", label: `Rate works out to $${ratePerMile.toFixed(2)}/mi — unusually high. Flagged so a human confirms the rate and miles were typed right before it posts.`, severity: "review" });
  if (load.weightLbs != null && load.weightLbs > 80000) flags.push({ code: "overweight", label: `Weight ${load.weightLbs.toLocaleString()} lbs is over the standard 80,000-lb gross — needs an oversize/overweight check by a human before posting.`, severity: "review" });
  if (load.weightLbs == null) flags.push({ code: "missing_weight", label: "No weight on file — drivers can't judge fit for their truck. Note for the poster.", severity: "review" });
  if (!load.commodity) flags.push({ code: "missing_commodity", label: "No commodity named — drivers can't judge the freight. Note for the poster.", severity: "review" });
  if (load.hazmat && !load.commodity) flags.push({ code: "hazmat_no_commodity", label: "Hazmat flagged with no commodity named — a human should confirm the hazmat class and paperwork before this posts.", severity: "review" });
  if (!load.shipper) flags.push({ code: "missing_shipper", label: "No shipper named on the load — a note for the poster; board readers should know whose freight it is.", severity: "review" });

  const verdict: SiVerdict = flags.some((f) => f.severity === "hold") ? "hold" : flags.length > 0 ? "review" : "clear";
  const summary =
    verdict === "clear"
      ? `Load is board-ready: lane, rate${ratePerMile != null ? ` ($${ratePerMile.toFixed(2)}/mi)` : ""}, weight, and freight are all on file with nothing flagged.`
      : verdict === "hold"
        ? `Not board-ready yet: ${flags.filter((f) => f.severity === "hold").map((f) => f.label).join(" ")}`
        : `Board-ready with notes: ${flags.map((f) => f.label).join(" ")}`;
  return { verdict, flags, ratePerMile, summary };
}

// ---- Bad-data checks (Rule 2: catch its own bad data) ------------------------

export type SiDataFlag = { code: string; label: string; autoCorrectable: boolean };

/** Trip-sheet arithmetic check over a SAVED sheet's own numbers.
 *  A mismatch is never "fixed" by rewriting the sealed sheet —
 *  it is flagged as a correction entry for a human (Rule 2 + the
 *  sealed-records line). autoCorrectable is always false here on
 *  purpose: the honest correction is a new entry, not an edit. */
export function checkTripSheet(args: {
  totalMiles: number;
  totalPay: number;
  payRate: number | null;
  stateBreakdown: { state: string; miles: number; pay: number }[];
}): SiDataFlag[] {
  const flags: SiDataFlag[] = [];
  const stateMiles = args.stateBreakdown.reduce((s, r) => s + r.miles, 0);
  if (Math.abs(stateMiles - args.totalMiles) > 0.6) {
    flags.push({
      code: "state_sum_mismatch",
      label: `State lines add to ${stateMiles.toFixed(1)} mi but the sheet total is ${args.totalMiles.toFixed(1)} mi — a ${(stateMiles - args.totalMiles).toFixed(1)} mi gap. The sealed sheet is NOT edited; this flag is the correction record, for a human to resolve on the next sheet.`,
      autoCorrectable: false,
    });
  }
  const rate = args.payRate ?? 0.55;
  const expectedPay = Math.round(args.totalMiles * rate * 100) / 100;
  // Percent-basis sheets and sheets with extra charges legitimately
  // differ — only flag a LARGE unexplained gap (> $5 and > 2%).
  if (Math.abs(args.totalPay - expectedPay) > 5 && Math.abs(args.totalPay - expectedPay) > expectedPay * 0.02) {
    flags.push({
      code: "pay_mismatch",
      label: `Sheet pay $${args.totalPay.toFixed(2)} vs ${args.totalMiles.toFixed(1)} mi × $${rate.toFixed(2)}/mi = $${expectedPay.toFixed(2)}. If this sheet carries extra charges or percent pay, that's the explanation and a human can dismiss the flag; otherwise the numbers disagree and the sealed sheet stays as-is with this flag attached.`,
      autoCorrectable: false,
    });
  }
  for (const row of args.stateBreakdown) {
    if (row.miles < 0) flags.push({ code: "negative_state_miles", label: `${row.state} shows negative miles (${row.miles}) — impossible on a real sheet; flagged, never silently zeroed.`, autoCorrectable: false });
  }
  return flags;
}

/** Fuel-log sanity: gallons × price should equal the total, and a
 *  purchase's implied MPG context is the driver's own business —
 *  only arithmetic is checked here. */
export function checkFuelPurchase(args: { gallons: number; pricePerGallon: number; total: number }): SiDataFlag[] {
  const flags: SiDataFlag[] = [];
  if (args.gallons <= 0) flags.push({ code: "fuel_no_gallons", label: "Fuel purchase with no gallons — the IFTA fuel-by-state line for it can't be right. Flagged for a human; the sealed purchase is not edited.", autoCorrectable: false });
  const expected = Math.round(args.gallons * args.pricePerGallon * 100) / 100;
  if (args.gallons > 0 && Math.abs(args.total - expected) > 0.5) {
    flags.push({ code: "fuel_total_mismatch", label: `Fuel total $${args.total.toFixed(2)} vs ${args.gallons} gal × $${args.pricePerGallon.toFixed(3)} = $${expected.toFixed(2)} — the receipt total may include more than fuel, or a digit is off. Flagged, not rewritten.`, autoCorrectable: false });
  }
  return flags;
}
