// FMCSA SAFER Web auto-link + CDL endorsement catalog (pure, tested).
//
// The SAFER part of the profile credentials (migration 0083): from the
// DOT or MC number a carrier puts on their own profile, build the
// link to that carrier's OFFICIAL FMCSA SAFER Web Company Snapshot —
// the federal safety record itself. The app links to the record; it
// never fetches, stores, computes, or displays a safety "score" of
// its own. URL shapes verified against live SAFER snapshot results:
//   USDOT: https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=293351
//   MC/MX: https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=812024
// Only the digits of the entered number go into the link ("MC-123456"
// and "123456" link identically); a number with no digits links
// nowhere — the caller renders "not on file" instead of a dead link.

export function authorityDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function saferUrlForDot(dotNumber: string | null | undefined): string | null {
  const digits = authorityDigits(dotNumber);
  if (!digits) return null;
  return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${digits}`;
}

export function saferUrlForMc(mcNumber: string | null | undefined): string | null {
  const digits = authorityDigits(mcNumber);
  if (!digits) return null;
  return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${digits}`;
}

/** The one SAFER link for a profile: the USDOT snapshot when a DOT
 *  number is on file (the most direct record), else the MC/MX
 *  snapshot, else null — no number, no link. */
export function saferUrlFor(args: {
  dotNumber: string | null | undefined;
  mcNumber: string | null | undefined;
}): string | null {
  return saferUrlForDot(args.dotNumber) ?? saferUrlForMc(args.mcNumber);
}

// ---- CDL endorsements -------------------------------------------------------
// The federal CDL endorsement set (the letters printed on the license).
// X (Hazmat + Tanker) is its own endorsement on a real CDL, listed
// alongside H and N exactly as FMCSA lists them — a driver picks what
// is actually printed on their license, nothing is inferred: holding
// H and N does NOT auto-add X here.

export const ENDORSEMENTS = [
  { key: "hazmat", code: "H", label: "Hazmat" },
  { key: "tanker", code: "N", label: "Tanker (Tank Vehicles)" },
  { key: "doubles_triples", code: "T", label: "Doubles / Triples" },
  { key: "hazmat_tanker", code: "X", label: "Hazmat + Tanker" },
  { key: "passenger", code: "P", label: "Passenger" },
  { key: "school_bus", code: "S", label: "School Bus" },
] as const;

export type EndorsementKey = (typeof ENDORSEMENTS)[number]["key"];

const ENDORSEMENT_KEYS = new Set<string>(ENDORSEMENTS.map((e) => e.key));

export function isEndorsementKey(value: string): value is EndorsementKey {
  return ENDORSEMENT_KEYS.has(value);
}

/** Parse the stored comma-separated endorsement list, dropping
 *  anything that isn't a real endorsement key and de-duplicating —
 *  a hand-edited or legacy row can never surface an invented
 *  endorsement. Order follows the catalog, not the stored string. */
export function parseEndorsements(stored: string | null | undefined): EndorsementKey[] {
  if (!stored) return [];
  const found = new Set(stored.split(",").map((s) => s.trim()).filter(isEndorsementKey));
  return ENDORSEMENTS.map((e) => e.key).filter((k) => found.has(k));
}

/** Validate + normalize a client-supplied endorsement list for
 *  storage: real keys only, catalog order, comma-joined. */
export function endorsementsToStored(keys: readonly string[]): string {
  const found = new Set(keys.filter(isEndorsementKey));
  return ENDORSEMENTS.map((e) => e.key)
    .filter((k) => found.has(k))
    .join(",");
}

export function endorsementLabel(key: EndorsementKey): string {
  const found = ENDORSEMENTS.find((e) => e.key === key);
  return found ? `${found.label} (${found.code})` : key;
}
