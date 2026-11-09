// STONEMILES Atlas — the in-app truckers' road atlas (x's green light,
// 2026-11-06, a code-freeze exception in the same class as the Fuel +
// Stop Planner). One page per US state: weight limits, length/width
// basics, low-clearance highlights, weigh/inspection stations, and
// state DOT / patrol contacts.
//
// COPYRIGHT LINE (absolute): nothing here is copied from the Rand
// McNally Motor Carriers' Road Atlas — not its tables, not its layout,
// not its wording. Every page is original copy built from public
// federal and state facts (FMCSA / Federal Highway Administration
// size-and-weight standards and state DOT class information).
//
// HONESTY RULES (the reason this file is data + tests, not prose
// scattered through the UI):
// - The federal Interstate baseline prints on EVERY state page:
//   80,000 lb GVW, 20,000 lb single axle, 34,000 lb tandem axle,
//   102-inch width. Those are federal law for the National Network
//   and are never in doubt.
// - A state note appears ONLY where the deviation is a well-established
//   public fact (Michigan's 164,000 lb axle-table law, the Maine /
//   Vermont 100,000 lb Interstate exception, California's 40-ft and
//   Florida's 41-ft kingpin rules, NYC's 55-ft overall-length cap,
//   Durham's "Can Opener", New York's car-only parkways, Boston's
//   Storrow Drive). When a state has no confident note, the page
//   prints the federal baseline under the label FEDERAL_STANDARD_LABEL
//   — a state number is never invented to fill the space.
// - Low-clearance highlights follow the same rule: a specific bridge
//   is named only when the fact is famous and sourced. Otherwise the
//   page points at the app's REAL clearance data — the OpenStreetMap
//   maxheight tags the Drive map already reads around the truck —
//   and says exactly that. No clearance height is ever fabricated.
// - Weigh/inspection stations are NOT re-listed here. The app already
//   holds that data (OpenStreetMap stations + driver-added stations,
//   with driver-reported OPEN/CLOSED status); the Atlas page hands
//   the driver to that one list. A second, diverging list would be
//   worse than none.
// - Phone numbers print ONLY where the real published number is known
//   with confidence (the short list in ATLAS_STATES below). Everywhere
//   else the number is omitted — never guessed — and the page says so.
// - Everything here is BUNDLED and STATIC: the Atlas works fully
//   offline in dead zones, costs nothing per request, and is a
//   planning reference — never presented as live or real-time data.
//   The standing label on every page: ATLAS_REFERENCE_NOTE.

/** The standing honesty label — Atlas home and every state page. */
export const ATLAS_REFERENCE_NOTE =
  "Reference only — posted signs, your permit, and your ELD govern.";

/** The label under a federal-baseline entry with no confident state
 *  note. Wording is the driver's, from the build order. */
export const FEDERAL_STANDARD_LABEL =
  "Federal standard — verify state specifics before you roll.";

/** Federal Interstate / National Network baseline (23 CFR 658,
 *  23 U.S.C. 127): the numbers that print on every page. */
export const FEDERAL_WEIGHTS = {
  gvwLbs: 80_000,
  singleAxleLbs: 20_000,
  tandemAxleLbs: 34_000,
} as const;

/** Federal width standard on the National Network, in inches. */
export const FEDERAL_WIDTH_IN = 102;

/** One state's atlas facts. Every field past the names is optional
 *  ON PURPOSE: null means "no confident public fact on file", and the
 *  page falls back to the federal baseline + label rather than
 *  inventing one. */
export type AtlasState = {
  /** USPS code, e.g. "TX". */
  code: string;
  name: string;
  /** State DOT name (public agency name) + its road-condition line
   *  ONLY where the published number is known with confidence. */
  dotName: string;
  dotPhone: string | null;
  /** State patrol / state police name + non-emergency line ONLY
   *  where the published number is known with confidence. */
  patrolName: string;
  patrolPhone: string | null;
  /** State weight deviation from the federal baseline, in our own
   *  words — only well-established public facts. */
  weightNote: string | null;
  /** State length / kingpin deviation — same honesty standard. */
  sizeNote: string | null;
  /** A notable low-clearance fact for the state — only famous,
   *  confidently sourced ones. Null states point at the app's real
   *  OSM clearance-tag data instead. */
  clearanceNote: string | null;
};

const S = (
  code: string,
  name: string,
  dotName: string,
  patrolName: string,
  extra: Partial<Pick<AtlasState, "dotPhone" | "patrolPhone" | "weightNote" | "sizeNote" | "clearanceNote">> = {},
): AtlasState => ({
  code,
  name,
  dotName,
  dotPhone: extra.dotPhone ?? null,
  patrolName,
  patrolPhone: extra.patrolPhone ?? null,
  weightNote: extra.weightNote ?? null,
  sizeNote: extra.sizeNote ?? null,
  clearanceNote: extra.clearanceNote ?? null,
});

/** All 50 states, alphabetical. Phone numbers appear only for the
 *  handful of agencies whose published line is known with confidence:
 *  Caltrans 1-800-427-7623 and CHP non-emergency 1-800-835-5247
 *  (1-800-TELL-CHP), TxDOT 1-800-558-9368, Florida Highway Patrol
 *  *FHP (*347), Georgia State Patrol *GSP (*477), Missouri State
 *  Highway Patrol *55, Ohio State Highway Patrol #677. Every other
 *  number is deliberately omitted rather than guessed. */
export const ATLAS_STATES: AtlasState[] = [
  S("AL", "Alabama", "Alabama Department of Transportation (ALDOT)", "Alabama Highway Patrol (ALEA)"),
  S("AK", "Alaska", "Alaska Department of Transportation & Public Facilities", "Alaska State Troopers"),
  S("AZ", "Arizona", "Arizona Department of Transportation (ADOT)", "Arizona Highway Patrol (Dept. of Public Safety)"),
  S("AR", "Arkansas", "Arkansas Department of Transportation (ArDOT)", "Arkansas State Police"),
  S("CA", "California", "California Department of Transportation (Caltrans)", "California Highway Patrol (CHP)", {
    dotPhone: "1-800-427-7623",
    patrolPhone: "1-800-835-5247",
    sizeNote:
      "California's kingpin rule: on a 53-ft trailer, kingpin to the center of the rear axle group may not exceed 40 ft — slide the tandems forward before you cross the state line, not after.",
  }),
  S("CO", "Colorado", "Colorado Department of Transportation (CDOT)", "Colorado State Patrol"),
  S("CT", "Connecticut", "Connecticut Department of Transportation (CTDOT)", "Connecticut State Police"),
  S("DE", "Delaware", "Delaware Department of Transportation (DelDOT)", "Delaware State Police"),
  S("FL", "Florida", "Florida Department of Transportation (FDOT)", "Florida Highway Patrol (FHP)", {
    patrolPhone: "*347",
    sizeNote:
      "Florida's kingpin rule: kingpin to the center of the rear tandem may not exceed 41 ft on a 53-ft trailer.",
  }),
  S("GA", "Georgia", "Georgia Department of Transportation (GDOT)", "Georgia State Patrol (GSP)", {
    patrolPhone: "*477",
  }),
  S("HI", "Hawaii", "Hawaii Department of Transportation (HDOT)", "County police departments (Hawaii has no state highway patrol)"),
  S("ID", "Idaho", "Idaho Transportation Department (ITD)", "Idaho State Police", {
    weightNote:
      "Idaho allows gross weights up to 105,500 lb on designated state routes with the right axle configuration, under its long-running state program. Interstate travel stays at the federal caps above.",
  }),
  S("IL", "Illinois", "Illinois Department of Transportation (IDOT)", "Illinois State Police", {
    clearanceNote:
      "Chicago's railroad viaducts are the classic trap — many city underpasses post well under 13 ft 6 in. The Drive map flags every clearance the map data tags around you; trust the posted sign on each viaduct over any list, this one included.",
  }),
  S("IN", "Indiana", "Indiana Department of Transportation (INDOT)", "Indiana State Police"),
  S("IA", "Iowa", "Iowa Department of Transportation (Iowa DOT)", "Iowa State Patrol"),
  S("KS", "Kansas", "Kansas Department of Transportation (KDOT)", "Kansas Highway Patrol"),
  S("KY", "Kentucky", "Kentucky Transportation Cabinet (KYTC)", "Kentucky State Police"),
  S("LA", "Louisiana", "Louisiana Department of Transportation and Development (LaDOTD)", "Louisiana State Police"),
  S("ME", "Maine", "Maine Department of Transportation (MaineDOT)", "Maine State Police", {
    weightNote:
      "Federal law carries a Maine exception: trucks may gross up to 100,000 lb on the Interstate system in Maine. Off the Interstate, state limits and permits govern.",
  }),
  S("MD", "Maryland", "Maryland Department of Transportation — State Highway Administration", "Maryland State Police"),
  S("MA", "Massachusetts", "Massachusetts Department of Transportation (MassDOT)", "Massachusetts State Police", {
    clearanceNote:
      "Boston's Storrow Drive is the local trap: trucks are banned and the bridges stand around 10 ft — a moving truck stuck under one ('Storrowed') is a Boston news staple. Stay on the truck routes and I-93.",
  }),
  S("MI", "Michigan", "Michigan Department of Transportation (MDOT)", "Michigan State Police", {
    weightNote:
      "Michigan is the famous exception: state law judges weight by axle loadings instead of the federal bridge formula, and with enough axles and the right spacing a rig may gross up to 164,000 lb on designated routes. Axle counts, spacings, and route designations govern — this is permit-and-table country, not a free pass. Michigan also posts spring-thaw weight restrictions on many roads for a few weeks each spring.",
  }),
  S("MN", "Minnesota", "Minnesota Department of Transportation (MnDOT)", "Minnesota State Patrol", {
    weightNote:
      "Minnesota posts spring-thaw load restrictions that drop the posted limit on many state and county roads for a few weeks each spring — check MnDOT's seasonal postings before you roll a heavy load in thaw season.",
  }),
  S("MS", "Mississippi", "Mississippi Department of Transportation (MDOT)", "Mississippi Highway Patrol"),
  S("MO", "Missouri", "Missouri Department of Transportation (MoDOT)", "Missouri State Highway Patrol", {
    patrolPhone: "*55",
  }),
  S("MT", "Montana", "Montana Department of Transportation (MDT)", "Montana Highway Patrol"),
  S("NE", "Nebraska", "Nebraska Department of Transportation (NDOT)", "Nebraska State Patrol"),
  S("NV", "Nevada", "Nevada Department of Transportation (NDOT)", "Nevada Highway Patrol"),
  S("NH", "New Hampshire", "New Hampshire Department of Transportation (NHDOT)", "New Hampshire State Police"),
  S("NJ", "New Jersey", "New Jersey Department of Transportation (NJDOT)", "New Jersey State Police"),
  S("NM", "New Mexico", "New Mexico Department of Transportation (NMDOT)", "New Mexico State Police"),
  S("NY", "New York", "New York State Department of Transportation (NYSDOT)", "New York State Police", {
    weightNote:
      "New York moves heavier loads under divisible-load permits; without a permit in hand, the federal caps above are the law of the road.",
    sizeNote:
      "New York City caps overall combination length at 55 ft inside the city unless a permit says otherwise — a 53-ft trailer behind a tractor doesn't fit the city rule. City deliveries run on New York City's own rules, not just the state's.",
    clearanceNote:
      "New York's parkways — the New York City and Long Island parkway system — are passenger-car roads: commercial vehicles are prohibited outright and many parkway bridges stand far too low for any trailer. If the sign says PARKWAY, a truck does not belong there, full stop. Never follow a car GPS onto one.",
  }),
  S("NC", "North Carolina", "North Carolina Department of Transportation (NCDOT)", "North Carolina State Highway Patrol", {
    clearanceNote:
      "Durham's famous 'Can Opener' — the railroad bridge over S. Gregson St downtown — sat at 11 ft 8 in for years and was raised in 2019; it's now posted 12 ft 4 in. Still a full foot under a 13 ft 6 in trailer: route around it.",
  }),
  S("ND", "North Dakota", "North Dakota Department of Transportation (NDDOT)", "North Dakota Highway Patrol", {
    weightNote:
      "North Dakota posts spring-thaw load restrictions that drop the posted limit on many state and county roads for a few weeks each spring — check NDDOT's seasonal postings before you roll a heavy load in thaw season.",
  }),
  S("OH", "Ohio", "Ohio Department of Transportation (ODOT)", "Ohio State Highway Patrol", {
    patrolPhone: "#677",
  }),
  S("OK", "Oklahoma", "Oklahoma Department of Transportation (ODOT)", "Oklahoma Highway Patrol"),
  S("OR", "Oregon", "Oregon Department of Transportation (ODOT)", "Oregon State Police"),
  S("PA", "Pennsylvania", "Pennsylvania Department of Transportation (PennDOT)", "Pennsylvania State Police"),
  S("RI", "Rhode Island", "Rhode Island Department of Transportation (RIDOT)", "Rhode Island State Police"),
  S("SC", "South Carolina", "South Carolina Department of Transportation (SCDOT)", "South Carolina Highway Patrol"),
  S("SD", "South Dakota", "South Dakota Department of Transportation (SDDOT)", "South Dakota Highway Patrol", {
    weightNote:
      "South Dakota posts spring-thaw load restrictions that drop the posted limit on many state and county roads for a few weeks each spring — check SDDOT's seasonal postings before you roll a heavy load in thaw season.",
  }),
  S("TN", "Tennessee", "Tennessee Department of Transportation (TDOT)", "Tennessee Highway Patrol"),
  S("TX", "Texas", "Texas Department of Transportation (TxDOT)", "Texas Highway Patrol (Dept. of Public Safety)", {
    dotPhone: "1-800-558-9368",
  }),
  S("UT", "Utah", "Utah Department of Transportation (UDOT)", "Utah Highway Patrol"),
  S("VT", "Vermont", "Vermont Agency of Transportation (VTrans)", "Vermont State Police", {
    weightNote:
      "Federal law carries a Vermont exception: trucks may gross up to 100,000 lb on the Interstate system in Vermont. Off the Interstate, state limits and permits govern.",
  }),
  S("VA", "Virginia", "Virginia Department of Transportation (VDOT)", "Virginia State Police"),
  S("WA", "Washington", "Washington State Department of Transportation (WSDOT)", "Washington State Patrol"),
  S("WV", "West Virginia", "West Virginia Division of Highways (WVDOH)", "West Virginia State Police"),
  S("WI", "Wisconsin", "Wisconsin Department of Transportation (WisDOT)", "Wisconsin State Patrol", {
    weightNote:
      "Wisconsin posts spring-thaw load restrictions that drop the posted limit on many state and county roads for a few weeks each spring — check WisDOT's seasonal postings before you roll a heavy load in thaw season.",
  }),
  S("WY", "Wyoming", "Wyoming Department of Transportation (WYDOT)", "Wyoming Highway Patrol"),
];

const BY_CODE = new Map(ATLAS_STATES.map((s) => [s.code, s]));

/** Look a state up by USPS code ("tx" and "TX" both work). */
export function atlasStateByCode(code: string | null | undefined): AtlasState | null {
  if (!code) return null;
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** Find the state a free-text question names — "open the Texas atlas
 *  page", "weight limit in Michigan", "show me TX". Full names match
 *  anywhere in the text; a bare two-letter code matches only when the
 *  text itself carries it uppercase as its own token AND the text is
 *  about atlas topics (so a chatty "me" or "or" or "in" never reads
 *  as Maine, Oregon, or Indiana). Returns null when no state is
 *  named — the caller opens the Atlas home instead of guessing. */
export function findAtlasStateInText(raw: string): AtlasState | null {
  const q = ` ${raw.toLowerCase()} `;
  for (const s of ATLAS_STATES) {
    if (q.includes(` ${s.name.toLowerCase()} `) || q.includes(` ${s.name.toLowerCase()},`) || q.includes(` ${s.name.toLowerCase()}.`) || q.includes(` ${s.name.toLowerCase()}?`)) {
      return s;
    }
  }
  if (/atlas|weight|gross|axle|length|width|kingpin|clearance|low bridge|station|dot\b|patrol|police/.test(q)) {
    const tokens = raw.match(/\b[A-Z]{2}\b/g) ?? [];
    for (const t of tokens) {
      const hit = BY_CODE.get(t);
      if (hit) return hit;
    }
  }
  return null;
}

/** A plain-words one-paragraph summary of a state's page — the Ask
 *  Meca local (offline) answer and the state row's sub-label share
 *  this wording so the app never describes a state's rules two
 *  different ways. */
export function atlasStateSummary(s: AtlasState): string {
  const weights = s.weightNote
    ? `Weights: federal caps are ${FEDERAL_WEIGHTS.gvwLbs.toLocaleString()} lb gross, ${FEDERAL_WEIGHTS.singleAxleLbs.toLocaleString()} lb single axle, ${FEDERAL_WEIGHTS.tandemAxleLbs.toLocaleString()} lb tandem — and ${s.name} has a state note: ${s.weightNote}`
    : `Weights: ${FEDERAL_WEIGHTS.gvwLbs.toLocaleString()} lb gross, ${FEDERAL_WEIGHTS.singleAxleLbs.toLocaleString()} lb single axle, ${FEDERAL_WEIGHTS.tandemAxleLbs.toLocaleString()} lb tandem — ${FEDERAL_STANDARD_LABEL.charAt(0).toLowerCase()}${FEDERAL_STANDARD_LABEL.slice(1)}`;
  const size = s.sizeNote ? ` Size: ${s.sizeNote}` : ` Width: ${FEDERAL_WIDTH_IN} in federal standard.`;
  const clearance = s.clearanceNote ? ` Low clearance: ${s.clearanceNote}` : "";
  return `${weights}${size}${clearance} ${ATLAS_REFERENCE_NOTE}`;
}
