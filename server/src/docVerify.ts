/**
 * Rate-con / BOL cross-verification — pure logic (no I/O, unit-tested).
 *
 * The app already reads both documents (the load-document vision
 * extraction) and seals both (rate-con document fingerprint on the
 * load, camera-sealed BOL photo + fingerprint at pickup). This module
 * is the check that was missing: put the two documents' extracted
 * field sets side by side and compare them field by field, so a rate
 * con that promises one thing and a BOL that says another is caught
 * BEFORE the invoice goes out — not in a dispute after delivery.
 *
 * Honesty rules (the same ones the whole proof spine runs on):
 *  - A field the extraction never produced is missing / not-readable,
 *    NEVER guessed, filled in, or quietly dropped from the report.
 *  - Money compares in INTEGER CENTS parsed from the value's decimal
 *    string form (see moneyToCents) — a real one-cent difference is a
 *    mismatch; no epsilon, no float fuzz.
 *  - Weight compares in whole pounds (extraction reports pounds; the
 *    value is rounded to the nearest pound once, at the boundary).
 *  - Addresses compare on a documented normalization (case,
 *    punctuation, ZIP, street-suffix and directional expansion) — the
 *    same address formatted differently matches; a different ZIP
 *    mismatches even when the street text agrees.
 *  - Appointment windows compare on the DATE (and the time, when both
 *    sides print one) parsed out of the as-printed text; when either
 *    side's text won't parse, the fallback is normalized-text equality.
 *
 * Verdicts:
 *  - verified: both documents present and read, and EVERY field in
 *    the comparison set matches.
 *  - differences_found: at least one field mismatches.
 *  - incomplete: no mismatch, but the pair cannot be fully checked —
 *    a document is missing, a document could not be read, or a field
 *    is missing from one (or both) documents. Fields a BOL simply
 *    does not print (money lines are the common case) hold the pair
 *    at incomplete — they are shown in the report, never dropped.
 */

export type DocFieldKey =
  | "identity"
  | "pickup_address"
  | "delivery_address"
  | "pickup_window"
  | "delivery_window"
  | "commodity"
  | "weight"
  | "pieces"
  | "seal_number"
  | "rate"
  | "charges_fuel_surcharge"
  | "charges_detention"
  | "charges_lumper"
  | "charges_other"
  | "charges_total"
  | "ref_load_number"
  | "ref_po_number"
  | "ref_pro_number";

export type FieldOutcome = "match" | "mismatch" | "missing_ratecon" | "missing_bol" | "not_readable";

export type PairVerdict = "verified" | "differences_found" | "incomplete";

/** One document's extracted field set, exactly as the extraction
 *  reported it — every field nullable, nothing inferred. Address
 *  parts ride separately so the comparison can compose the full
 *  address when the document printed one, or fall back to the
 *  city/state pair when that's all it printed. */
export type DocSideFields = {
  identity: string | null;
  pickupAddress: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  pickupWindow: string | null;
  deliveryWindow: string | null;
  commodity: string | null;
  weightLbs: number | null;
  pieces: number | null;
  sealNumber: string | null;
  rate: number | null;
  chargesFuelSurcharge: number | null;
  chargesDetention: number | null;
  chargesLumper: number | null;
  chargesOther: number | null;
  chargesTotal: number | null;
  loadNumber: string | null;
  poNumber: string | null;
  proNumber: string | null;
};

export const EMPTY_DOC_FIELDS: DocSideFields = {
  identity: null,
  pickupAddress: null,
  pickupCity: null,
  pickupState: null,
  deliveryAddress: null,
  deliveryCity: null,
  deliveryState: null,
  pickupWindow: null,
  deliveryWindow: null,
  commodity: null,
  weightLbs: null,
  pieces: null,
  sealNumber: null,
  rate: null,
  chargesFuelSurcharge: null,
  chargesDetention: null,
  chargesLumper: null,
  chargesOther: null,
  chargesTotal: null,
  loadNumber: null,
  poNumber: null,
  proNumber: null,
};

/** One side of the pair, as assembled by the caller from the
 *  document's stored extraction record.
 *  - present: the document itself is attached to the load.
 *  - readFailed: the document is attached but no usable field set
 *    exists for it (the read found no load details on it, or the
 *    document is a file type the reader can't read and no confirmed
 *    field set was ever recorded). Its fields are all null.
 *  - fields: the extracted values; all-null when never captured. */
export type DocSide = {
  present: boolean;
  readFailed: boolean;
  fields: DocSideFields;
};

export type FieldComparison = {
  field: DocFieldKey;
  label: string;
  outcome: FieldOutcome;
  /** As-printed values for display (money formatted, weight in lbs). */
  rateconValue: string | null;
  bolValue: string | null;
};

export type DocVerificationReport = {
  verdict: PairVerdict;
  fields: FieldComparison[];
  mismatchFields: DocFieldKey[];
  /** Fields that matched / mismatched / could not be fully checked. */
  matchedCount: number;
  missingCount: number;
};

// ---- Normalization -----------------------------------------------------------

/** Text comparison form: uppercase, punctuation becomes a space,
 *  whitespace collapsed. Used for identity / commodity / windows
 *  fallback and reference numbers (references additionally drop the
 *  spaces — see normalizeRef). */
export function normalizeText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Company-identity comparison form: normalizeText, then trailing
 *  legal-form tokens (INC / LLC / LTD / CORP / CO / COMPANY) dropped —
 *  "ACME TRUCKING INC" and "Acme Trucking" are the same counterparty
 *  printed two ways; a different NAME still mismatches. */
export function normalizeIdentity(raw: string): string {
  const tokens = normalizeText(raw).split(" ").filter(Boolean);
  const legal = new Set(["INC", "LLC", "LTD", "CORP", "CORPORATION", "CO", "COMPANY"]);
  while (tokens.length > 1 && legal.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(" ");
}

/** Reference numbers (load # / PO # / PRO #): case- and
 *  punctuation-insensitive — "LD-1042" and "ld1042" are one number. */
export function normalizeRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Seal numbers: uppercase alphanumerics only (the existing seal
 *  check's plain reading, made explicit here). */
export function normalizeSeal(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const STREET_SUFFIX: Record<string, string> = {
  ST: "STREET", STREET: "STREET",
  AVE: "AVENUE", AVENUE: "AVENUE", AV: "AVENUE",
  RD: "ROAD", ROAD: "ROAD",
  BLVD: "BOULEVARD", BOULEVARD: "BOULEVARD",
  DR: "DRIVE", DRIVE: "DRIVE",
  LN: "LANE", LANE: "LANE",
  HWY: "HIGHWAY", HIGHWAY: "HIGHWAY",
  CT: "COURT", COURT: "COURT",
  PL: "PLACE", PLACE: "PLACE",
  PKWY: "PARKWAY", PARKWAY: "PARKWAY",
  CIR: "CIRCLE", CIRCLE: "CIRCLE",
  TRL: "TRAIL", TRAIL: "TRAIL",
  STE: "SUITE", SUITE: "SUITE", APT: "SUITE", UNIT: "SUITE",
};
const DIRECTIONAL: Record<string, string> = {
  N: "NORTH", NORTH: "NORTH",
  S: "SOUTH", SOUTH: "SOUTH",
  E: "EAST", EAST: "EAST",
  W: "WEST", WEST: "WEST",
  NE: "NORTHEAST", NORTHEAST: "NORTHEAST",
  NW: "NORTHWEST", NORTHWEST: "NORTHWEST",
  SE: "SOUTHEAST", SOUTHEAST: "SOUTHEAST",
  SW: "SOUTHWEST", SOUTHWEST: "SOUTHWEST",
};

/** US state abbreviations → full names. Extraction returns the full
 *  state name when it can, but documents print both forms ("AL" on
 *  one, "Alabama" on the other), so address tokens canonicalize to
 *  the full name. */
const STATE_NAMES: Record<string, string> = {
  AL: "ALABAMA", AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA",
  CO: "COLORADO", CT: "CONNECTICUT", DE: "DELAWARE", DC: "DISTRICT OF COLUMBIA",
  FL: "FLORIDA", GA: "GEORGIA", HI: "HAWAII", ID: "IDAHO", IL: "ILLINOIS",
  IN: "INDIANA", IA: "IOWA", KS: "KANSAS", KY: "KENTUCKY", LA: "LOUISIANA",
  ME: "MAINE", MD: "MARYLAND", MA: "MASSACHUSETTS", MI: "MICHIGAN", MN: "MINNESOTA",
  MS: "MISSISSIPPI", MO: "MISSOURI", MT: "MONTANA", NE: "NEBRASKA", NV: "NEVADA",
  NH: "NEW HAMPSHIRE", NJ: "NEW JERSEY", NM: "NEW MEXICO", NY: "NEW YORK",
  NC: "NORTH CAROLINA", ND: "NORTH DAKOTA", OH: "OHIO", OK: "OKLAHOMA", OR: "OREGON",
  PA: "PENNSYLVANIA", RI: "RHODE ISLAND", SC: "SOUTH CAROLINA", SD: "SOUTH DAKOTA",
  TN: "TENNESSEE", TX: "TEXAS", UT: "UTAH", VT: "VERMONT", VA: "VIRGINIA",
  WA: "WASHINGTON", WV: "WEST VIRGINIA", WI: "WISCONSIN", WY: "WYOMING", PR: "PUERTO RICO",
};

/** Address comparison form. Normalization, in order: uppercase;
 *  the ZIP (5-digit, +4 accepted) is pulled out and compared
 *  separately; punctuation becomes spaces; whitespace collapses;
 *  street suffixes and directionals expand to their long forms, and
 *  state abbreviations expand to full state names — so "123 Main
 *  St N, Mobile, AL" and "123 MAIN STREET NORTH Mobile Alabama"
 *  are the same address. A different ZIP is a mismatch even if
 *  every other token agrees. */
export function normalizeAddress(raw: string): { text: string; zip: string | null } {
  const upper = raw.toUpperCase();
  const zipMatch = upper.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1]! : null;
  const noZip = zipMatch ? upper.replace(zipMatch[0], " ") : upper;
  const tokens = noZip
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => STREET_SUFFIX[t] ?? DIRECTIONAL[t] ?? STATE_NAMES[t] ?? t)
    .filter((t) => t !== "USA" && t !== "US");
  return { text: tokens.join(" "), zip };
}

export function addressesMatch(a: string, b: string): boolean {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (na.zip && nb.zip && na.zip !== nb.zip) return false;
  return na.text === nb.text;
}

/** Money → integer cents, parsed from the value's DECIMAL STRING
 *  form with exact digit arithmetic (BigInt on the integer part,
 *  digit-by-digit on the fraction, half-up at the third decimal —
 *  the same rounding a printed invoice uses). A JSON number's
 *  shortest round-trip string is its exact decimal value, so
 *  2500.1 → "2500.1" → 250010 cents exactly, and two amounts that
 *  differ by one cent NEVER compare equal. Returns null for values
 *  that aren't money-shaped. */
export function moneyToCents(value: number | string | null): number | null {
  if (value == null) return null;
  const raw = typeof value === "number" ? String(value) : value;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const m = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const negative = m[1] === "-";
  const intPart = BigInt(m[2]!);
  const frac = m[3] ?? "";
  const d1 = frac.length > 0 ? Number(frac[0]) : 0;
  const d2 = frac.length > 1 ? Number(frac[1]) : 0;
  const d3 = frac.length > 2 ? Number(frac[2]) : 0;
  let cents = intPart * 100n + BigInt(d1 * 10 + d2);
  if (d3 >= 5) cents += 1n;
  const n = Number(cents);
  return negative ? -n : n;
}

export function formatMoneyFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

// ---- Appointment windows -----------------------------------------------------

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Parse an as-printed appointment ("10/26/2026 8:00 AM", "Oct 26,
 *  2026 08:00", "2026-10-26") into a comparable date + optional time
 *  (minutes since midnight). Unparseable pieces come back null —
 *  the caller falls back to normalized-text equality. */
export function parseWindow(raw: string): { date: string | null; minutes: number | null } {
  const text = raw.toUpperCase();
  let date: string | null = null;
  let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    date = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  } else if ((m = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/))) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    date = `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  } else if ((m = text.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2})(?:ST|ND|RD|TH)?,?\s+(\d{4})/))) {
    date = `${m[3]}-${String(MONTHS[m[1]!] ?? 0).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  } else if ((m = text.match(/\b(\d{1,2})(?:ST|ND|RD|TH)?\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})/))) {
    date = `${m[3]}-${String(MONTHS[m[2]!] ?? 0).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  let minutes: number | null = null;
  const t = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/) ?? text.match(/(\d{1,2})\s*(AM|PM)\b/);
  if (t) {
    let hh = Number(t[1]);
    const mm = t[2] != null && /^\d{2}$/.test(t[2]) ? Number(t[2]) : 0;
    const meridiem = t[3] ?? (t[2] != null && /^(AM|PM)$/.test(t[2]) ? t[2] : null);
    if (meridiem === "PM" && hh < 12) hh += 12;
    if (meridiem === "AM" && hh === 12) hh = 0;
    if (hh <= 23 && mm <= 59) minutes = hh * 60 + mm;
  }
  return { date, minutes };
}

export function windowsMatch(a: string, b: string): boolean {
  const pa = parseWindow(a);
  const pb = parseWindow(b);
  if (pa.date && pb.date) {
    if (pa.date !== pb.date) return false;
    if (pa.minutes != null && pb.minutes != null) return pa.minutes === pb.minutes;
    return true;
  }
  return normalizeText(a) === normalizeText(b);
}

// ---- Field comparison ----------------------------------------------------------

type Comparator = "identity" | "address" | "window" | "text" | "seal" | "ref" | "money" | "weight" | "pieces";

type FieldDef = {
  key: DocFieldKey;
  label: string;
  kind: Comparator;
  /** The raw pair to compare + display, from a side's field set. */
  pick: (f: DocSideFields) => string | number | null;
  /** Compose the compared address from its parts (address fields). */
  compose?: (f: DocSideFields) => string | null;
};

function composeAddress(address: string | null, city: string | null, state: string | null): string | null {
  const parts = [address, city, state].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

const FIELD_DEFS: FieldDef[] = [
  { key: "identity", label: "Broker / shipper", kind: "identity", pick: (f) => f.identity },
  {
    key: "pickup_address", label: "Pickup address", kind: "address",
    pick: (f) => composeAddress(f.pickupAddress, f.pickupCity, f.pickupState),
  },
  {
    key: "delivery_address", label: "Delivery address", kind: "address",
    pick: (f) => composeAddress(f.deliveryAddress, f.deliveryCity, f.deliveryState),
  },
  { key: "pickup_window", label: "Pickup window", kind: "window", pick: (f) => f.pickupWindow },
  { key: "delivery_window", label: "Delivery window", kind: "window", pick: (f) => f.deliveryWindow },
  { key: "commodity", label: "Commodity", kind: "text", pick: (f) => f.commodity },
  { key: "weight", label: "Weight", kind: "weight", pick: (f) => f.weightLbs },
  { key: "pieces", label: "Pieces / pallets", kind: "pieces", pick: (f) => f.pieces },
  { key: "seal_number", label: "Seal number", kind: "seal", pick: (f) => f.sealNumber },
  { key: "rate", label: "Rate", kind: "money", pick: (f) => f.rate },
  { key: "charges_fuel_surcharge", label: "Fuel surcharge", kind: "money", pick: (f) => f.chargesFuelSurcharge },
  { key: "charges_detention", label: "Detention", kind: "money", pick: (f) => f.chargesDetention },
  { key: "charges_lumper", label: "Lumper", kind: "money", pick: (f) => f.chargesLumper },
  { key: "charges_other", label: "Other charges", kind: "money", pick: (f) => f.chargesOther },
  { key: "charges_total", label: "Additional charges (total)", kind: "money", pick: (f) => f.chargesTotal },
  { key: "ref_load_number", label: "Load #", kind: "ref", pick: (f) => f.loadNumber },
  { key: "ref_po_number", label: "PO #", kind: "ref", pick: (f) => f.poNumber },
  { key: "ref_pro_number", label: "PRO #", kind: "ref", pick: (f) => f.proNumber },
];

export const DOC_FIELD_LABELS: Record<DocFieldKey, string> = Object.fromEntries(
  FIELD_DEFS.map((d) => [d.key, d.label]),
) as Record<DocFieldKey, string>;

function displayValue(def: FieldDef, raw: string | number | null): string | null {
  if (raw == null) return null;
  if (def.kind === "money") {
    const cents = moneyToCents(raw);
    return cents != null ? formatMoneyFromCents(cents) : String(raw);
  }
  if (def.kind === "weight") return `${Math.round(Number(raw)).toLocaleString("en-US")} lbs`;
  if (def.kind === "pieces") return String(Math.round(Number(raw)));
  return String(raw);
}

function valuesMatch(def: FieldDef, a: string | number, b: string | number): boolean {
  switch (def.kind) {
    case "identity":
      return normalizeIdentity(String(a)) === normalizeIdentity(String(b));
    case "address":
      return addressesMatch(String(a), String(b));
    case "window":
      return windowsMatch(String(a), String(b));
    case "seal":
      return normalizeSeal(String(a)) === normalizeSeal(String(b));
    case "ref":
      return normalizeRef(String(a)) === normalizeRef(String(b));
    case "money": {
      const ca = moneyToCents(a);
      const cb = moneyToCents(b);
      return ca != null && cb != null && ca === cb;
    }
    case "weight":
      return Math.round(Number(a)) === Math.round(Number(b));
    case "pieces":
      return Math.round(Number(a)) === Math.round(Number(b));
    default:
      return normalizeText(String(a)) === normalizeText(String(b));
  }
}

/**
 * Compare two documents' field sets, field by field. Both values are
 * always carried into the report for display, including on missing /
 * not-readable outcomes — the reader sees exactly what each document
 * said, or that it said nothing.
 */
export function crossVerifyDocuments(ratecon: DocSide, bol: DocSide): DocVerificationReport {
  const fields: FieldComparison[] = [];
  for (const def of FIELD_DEFS) {
    const rv = def.pick(ratecon.fields);
    const bv = def.pick(bol.fields);
    let outcome: FieldOutcome;
    if (rv != null && bv != null) {
      outcome = valuesMatch(def, rv, bv) ? "match" : "mismatch";
    } else if (rv == null && bv == null) {
      // Neither document produced the field. If a document couldn't
      // be read at all (or isn't attached), that's the honest label;
      // both read fine and neither prints it → the rate con's absence
      // is reported first (it is the terms of record).
      if (ratecon.readFailed || bol.readFailed) outcome = "not_readable";
      else if (!ratecon.present) outcome = "missing_ratecon";
      else if (!bol.present) outcome = "missing_bol";
      else outcome = "missing_ratecon";
    } else if (rv == null) {
      outcome = ratecon.readFailed ? "not_readable" : "missing_ratecon";
    } else {
      outcome = bol.readFailed ? "not_readable" : "missing_bol";
    }
    fields.push({
      field: def.key,
      label: def.label,
      outcome,
      rateconValue: displayValue(def, rv),
      bolValue: displayValue(def, bv),
    });
  }
  const mismatchFields = fields.filter((f) => f.outcome === "mismatch").map((f) => f.field);
  const matchedCount = fields.filter((f) => f.outcome === "match").length;
  const missingCount = fields.length - matchedCount - mismatchFields.length;
  let verdict: PairVerdict;
  if (mismatchFields.length > 0) {
    verdict = "differences_found";
  } else if (
    ratecon.present &&
    bol.present &&
    !ratecon.readFailed &&
    !bol.readFailed &&
    fields.every((f) => f.outcome === "match")
  ) {
    verdict = "verified";
  } else {
    verdict = "incomplete";
  }
  return { verdict, fields, mismatchFields, matchedCount, missingCount };
}

/** Canonical JSON of a report's field outcomes — the exact string
 *  the caller hashes (SHA-256) onto the verification record and into
 *  the sealed chain event, so the sealed hash provably covers the
 *  verdict AND every field outcome. */
export function canonicalOutcomesJson(report: DocVerificationReport): string {
  return JSON.stringify({
    verdict: report.verdict,
    fields: report.fields.map((f) => [f.field, f.outcome, f.rateconValue, f.bolValue]),
  });
}

// ---- Exception planning --------------------------------------------------------

export type OpenExceptionLike = { field: DocFieldKey };

export type ExceptionPlan = {
  /** Mismatch fields with no open exception — open one. */
  toOpen: DocFieldKey[];
  /** Open exceptions whose field now MATCHES on the latest run —
   *  close them as resolved by re-run. (An open exception whose
   *  field is still mismatching, or merely missing, stays open —
   *  only a match or an explicit acknowledgment closes it.) */
  toCloseOnMatch: DocFieldKey[];
};

export function planExceptionChanges(
  report: DocVerificationReport,
  open: OpenExceptionLike[],
): ExceptionPlan {
  const openFields = new Set(open.map((e) => e.field));
  const outcomeByField = new Map(report.fields.map((f) => [f.field, f.outcome]));
  const toOpen = report.mismatchFields.filter((f) => !openFields.has(f));
  const toCloseOnMatch = [...openFields].filter((f) => outcomeByField.get(f) === "match");
  return { toOpen, toCloseOnMatch };
}

// ---- Per-load + hub summaries ----------------------------------------------------

export type LoadDocStatus = {
  /** A verification has ever run for this load. */
  checked: boolean;
  /** Verdict of the LATEST run (history is never rewritten — an
   *  acknowledged mismatch still shows differences_found here). */
  latestVerdict: PairVerdict | null;
  /** Exceptions open right now. */
  openExceptions: number;
};

export function loadDocStatus(
  latestVerdict: PairVerdict | null,
  openExceptions: number,
): LoadDocStatus {
  return { checked: latestVerdict != null, latestVerdict, openExceptions };
}

export type DocVerificationSummary = {
  loadsWithBothDocs: number;
  checked: number;
  verified: number;
  differencesOpen: number;
  incomplete: number;
  neverChecked: number;
};

/** Hub roll-up over per-load states. A load counts as verified only
 *  when its latest verdict is verified AND it carries no open
 *  exception; differencesOpen counts loads with at least one open
 *  exception (whatever their latest verdict says). */
export function summarizeDocVerification(
  loads: { hasBothDocs: boolean; status: LoadDocStatus }[],
): DocVerificationSummary {
  const s: DocVerificationSummary = {
    loadsWithBothDocs: 0,
    checked: 0,
    verified: 0,
    differencesOpen: 0,
    incomplete: 0,
    neverChecked: 0,
  };
  for (const l of loads) {
    if (l.hasBothDocs) s.loadsWithBothDocs += 1;
    if (!l.status.checked) {
      s.neverChecked += 1;
      continue;
    }
    s.checked += 1;
    if (l.status.openExceptions > 0) s.differencesOpen += 1;
    else if (l.status.latestVerdict === "verified") s.verified += 1;
    else if (l.status.latestVerdict === "incomplete") s.incomplete += 1;
  }
  return s;
}
