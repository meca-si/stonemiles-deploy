// Profile contact & carrier credentials — client mirror of
// server/src/safer.ts. The server is the authority (it validates on
// write and builds the SAFER link on every read); these helpers exist
// so the profile editor can preview the FMCSA SAFER Web link live as
// the number is typed, and so every surface labels CDL endorsements
// the same way.
//
// SAFER rule, everywhere: the link points at the carrier's OFFICIAL
// FMCSA SAFER Web Company Snapshot. STONEMILES never computes or
// shows a safety score of its own.

export type EndorsementKey =
  | "hazmat"
  | "tanker"
  | "doubles_triples"
  | "hazmat_tanker"
  | "passenger"
  | "school_bus";

export const ENDORSEMENT_OPTIONS: { key: EndorsementKey; code: string; label: string }[] = [
  { key: "hazmat", code: "H", label: "Hazmat" },
  { key: "tanker", code: "N", label: "Tanker (Tank Vehicles)" },
  { key: "doubles_triples", code: "T", label: "Doubles / Triples" },
  { key: "hazmat_tanker", code: "X", label: "Hazmat + Tanker" },
  { key: "passenger", code: "P", label: "Passenger" },
  { key: "school_bus", code: "S", label: "School Bus" },
];

export function endorsementLabel(key: string): string {
  const found = ENDORSEMENT_OPTIONS.find((e) => e.key === key);
  return found ? `${found.label} (${found.code})` : key;
}

export function saferUrlForNumbers(dotNumber: string, mcNumber: string): string | null {
  const dot = dotNumber.replace(/\D/g, "");
  if (dot) {
    return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${dot}`;
  }
  const mc = mcNumber.replace(/\D/g, "");
  if (mc) {
    return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mc}`;
  }
  return null;
}
