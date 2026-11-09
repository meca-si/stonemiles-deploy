// trailer.ts — the Trailer Package's pure logic (no DOM, no React),
// like routeWeather.ts / permit.ts, so every rule here is unit-testable
// (see trailer.test.ts). The UI lives in TrailerPanel.tsx; persistence
// lives in the server actions (profile.trailerType + the load trailer
// fields + the sealed reefer-check / pre-trip-inspection records).
//
// What this module owns:
//  - the five trailer profiles and how each one tunes the app
//    (default heights, high-profile flag, which tools surface first);
//  - the FMCSA cargo-securement minimums (49 CFR 393.110) and the
//    aggregate working-load-limit rule (49 CFR 393.106(d)) — a
//    PLANNING GUIDE, not legal advice, and honest about the cases
//    the general rule does not cover;
//  - the federal Bridge Formula (23 CFR 658.17) allowed-weight math —
//    planning guidance beside Permit Mode, never a permit substitute;
//  - the reefer cold-chain band check (driver-entered temps, always
//    labelled driver-entered — never sensor readings);
//  - the high-wind blow-over advisory for empty high-profile trailers
//    (a STONEMILES advisory threshold, never an official warning);
//  - the per-trailer-type pre-trip inspection checklists.

// ---------- Trailer profiles -------------------------------------------------

export type TrailerType = "dry_van" | "reefer" | "flatbed" | "step_deck" | "rgn";

export const TRAILER_TYPES: TrailerType[] = ["dry_van", "reefer", "flatbed", "step_deck", "rgn"];

export type TrailerToolId = "reefer" | "securement" | "height" | "axle" | "dock" | "checklist";

export type TrailerProfile = {
  type: TrailerType;
  label: string;
  /** Typical overall height of the empty rig with this trailer, in
   *  inches — the STARTING suggestion for height fields. The truck
   *  profile's own height stays the fallback until a loaded height is
   *  recorded on the load; nothing here overrides it silently. */
  emptyHeightIn: number;
  /** Deck height in inches for open decks (null for enclosed boxes) —
   *  the loaded-height prompt starts from deck + cargo height. */
  deckHeightIn: number | null;
  /** Tall, flat-sided box that catches crosswind when empty. */
  highProfile: boolean;
  /** Open deck — securement + loaded height apply. */
  openDeck: boolean;
  /** Tools in the order they should surface for this trailer. */
  toolOrder: TrailerToolId[];
};

export const TRAILER_PROFILES: Record<TrailerType, TrailerProfile> = {
  dry_van: {
    type: "dry_van",
    label: "Dry Van",
    emptyHeightIn: 162, // 13'6"
    deckHeightIn: null,
    highProfile: true,
    openDeck: false,
    toolOrder: ["dock", "checklist", "height"],
  },
  reefer: {
    type: "reefer",
    label: "Reefer",
    emptyHeightIn: 162, // 13'6"
    deckHeightIn: null,
    highProfile: true,
    openDeck: false,
    toolOrder: ["reefer", "dock", "checklist", "height"],
  },
  flatbed: {
    type: "flatbed",
    label: "Flatbed",
    emptyHeightIn: 162,
    deckHeightIn: 60,
    highProfile: false,
    openDeck: true,
    toolOrder: ["securement", "height", "checklist", "dock"],
  },
  step_deck: {
    type: "step_deck",
    label: "Step Deck",
    emptyHeightIn: 162,
    deckHeightIn: 42, // lower deck; upper deck ~60"
    highProfile: false,
    openDeck: true,
    toolOrder: ["securement", "height", "checklist", "dock"],
  },
  rgn: {
    type: "rgn",
    label: "RGN / Lowboy",
    emptyHeightIn: 162,
    deckHeightIn: 24, // the well
    highProfile: false,
    openDeck: true,
    toolOrder: ["axle", "height", "securement", "checklist", "dock"],
  },
};

export function trailerProfile(type: TrailerType): TrailerProfile {
  return TRAILER_PROFILES[type];
}

export function isTrailerType(v: unknown): v is TrailerType {
  return typeof v === "string" && (TRAILER_TYPES as string[]).includes(v);
}

/** "13'6\"" from total inches; em-dash for a missing value. */
export function fmtHeightIn(totalIn: number | null | undefined): string {
  if (totalIn == null || !Number.isFinite(totalIn) || totalIn <= 0) return "—";
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return inch === 0 ? `${ft}'0"` : `${ft}'${inch}"`;
}

/** Which height is driving low-bridge alerts right now: the active
 *  load's recorded loaded height when there is one, else the truck
 *  profile's height (the empty fallback). Always labelled. */
export function heightInUse(args: {
  loadedHeightIn: number | null;
  truckHeightIn: number;
}): { inches: number; source: "loaded" | "truck"; label: string } {
  if (args.loadedHeightIn != null && args.loadedHeightIn > 0) {
    return {
      inches: args.loadedHeightIn,
      source: "loaded",
      label: `Loaded height ${fmtHeightIn(args.loadedHeightIn)} — from this load's record`,
    };
  }
  return {
    inches: args.truckHeightIn,
    source: "truck",
    label: `Truck height ${fmtHeightIn(args.truckHeightIn)} — your profile's empty height (no loaded height recorded on this load)`,
  };
}

// ---------- Securement calculator — 49 CFR 393.110 / 393.106(d) ---------------
//
// PLANNING GUIDE, NOT LEGAL ADVICE. Implements the GENERAL freight
// rule only:
//  - §393.110(b) — article NOT blocked against forward movement:
//      ≤5 ft and ≤1,100 lb          → 1 tiedown
//      ≤5 ft and >1,100 lb          → 2 tiedowns
//      >5 ft and ≤10 ft             → 2 tiedowns
//      >10 ft                       → 2, plus 1 for every 10 ft
//                                     (or part of 10 ft) past 10 ft
//  - §393.110(c) — article blocked / braced against forward movement
//    (headerboard, bulkhead, other cargo, blocking devices):
//      1 tiedown for every 10 ft of length or part thereof (min 1)
//  - §393.106(d) — the AGGREGATE working load limit of the tiedowns
//    used must be at least 50% of the article's weight. Counting: an
//    indirect tiedown (attached to the vehicle on both ends, passing
//    over/around the cargo) contributes its full WLL; a direct
//    tiedown (vehicle to cargo) contributes half its WLL.
// Special-commodity sections (§§393.116–393.136 — logs, metal coils,
// paper rolls, concrete pipe, crushed cars, boulders, dressed lumber,
// intermodal containers…) have their own rules and are OUT OF SCOPE:
// the calculator says so instead of guessing.

export type TiedownKind = "indirect" | "direct";

export type SecurementInput = {
  lengthFt: number;
  weightLbs: number;
  /** Blocked / braced against forward movement (§393.110(c)). */
  blockedForward: boolean;
  /** The tiedowns the driver plans to use: count × rated WLL each. */
  tiedowns: { count: number; wllLbs: number; kind: TiedownKind }[];
};

export type SecurementResult = {
  inScope: boolean;
  outOfScopeReason: string | null;
  minTiedowns: number | null;
  tiedownsPlanned: number;
  tiedownCountPass: boolean | null;
  aggregateWllLbs: number;
  requiredWllLbs: number;
  wllPass: boolean;
  rule: string;
  notes: string[];
};

export function minTiedowns393110(lengthFt: number, weightLbs: number, blockedForward: boolean): number {
  if (blockedForward) {
    // §393.110(c): one per 10 ft or part thereof, minimum one.
    return Math.max(1, Math.ceil(lengthFt / 10));
  }
  if (lengthFt <= 5) return weightLbs <= 1100 ? 1 : 2;
  if (lengthFt <= 10) return 2;
  return 2 + Math.ceil((lengthFt - 10) / 10);
}

export function securementCalc(input: SecurementInput): SecurementResult {
  const notes: string[] = [
    "Planning guide only — not legal advice. The securement rules that govern are 49 CFR 393.100–393.136 and the posted inspection standard; when in doubt, add another tiedown.",
  ];
  const requiredWllLbs = Math.ceil(input.weightLbs * 0.5);
  const aggregateWllLbs = input.tiedowns.reduce(
    (sum, t) => sum + t.count * t.wllLbs * (t.kind === "direct" ? 0.5 : 1),
    0,
  );
  const tiedownsPlanned = input.tiedowns.reduce((sum, t) => sum + t.count, 0);
  const wllPass = aggregateWllLbs >= requiredWllLbs;

  if (!Number.isFinite(input.lengthFt) || input.lengthFt <= 0 || !Number.isFinite(input.weightLbs) || input.weightLbs <= 0) {
    return {
      inScope: false,
      outOfScopeReason: "Enter the article's length and weight — the §393.110 table keys off both, and the tool won't guess them.",
      minTiedowns: null,
      tiedownsPlanned,
      tiedownCountPass: null,
      aggregateWllLbs,
      requiredWllLbs: Number.isFinite(input.weightLbs) && input.weightLbs > 0 ? requiredWllLbs : 0,
      wllPass: false,
      rule: "49 CFR 393.110",
      notes,
    };
  }

  const minTiedowns = minTiedowns393110(input.lengthFt, input.weightLbs, input.blockedForward);
  if (input.blockedForward) {
    notes.push("Blocked count (§393.110(c)) — the article is braced against forward movement by a headerboard, bulkhead, other cargo, or blocking devices.");
  } else {
    notes.push("Unblocked count (§393.110(b)) — nothing is bracing this article against forward movement.");
  }
  notes.push("Aggregate WLL (§393.106(d)) counts indirect tiedowns at full WLL and direct tiedowns at half WLL, and must reach at least 50% of the article's weight.");
  notes.push("Special freight has its own sections — logs, metal coils, paper rolls, concrete pipe, automobiles, boulders, dressed lumber, intermodal containers (§§393.116–393.136). This general-freight table does not cover them.");
  return {
    inScope: true,
    outOfScopeReason: null,
    minTiedowns,
    tiedownsPlanned,
    tiedownCountPass: tiedownsPlanned >= minTiedowns,
    aggregateWllLbs,
    requiredWllLbs,
    wllPass,
    rule: input.blockedForward ? "49 CFR 393.110(c) + 393.106(d)" : "49 CFR 393.110(b) + 393.106(d)",
    notes,
  };
}

/** Common tiedown WLLs (lbs) from the §393.104 marking table — offered
 *  as quick-pick ratings in the calculator; the driver can type any
 *  rating printed on their own gear. */
export const TIEDOWN_PRESETS: { label: string; wllLbs: number }[] = [
  { label: "2\" strap — 3,333 lb WLL", wllLbs: 3333 },
  { label: "4\" strap — 5,400 lb WLL", wllLbs: 5400 },
  { label: "5/16\" chain (G70) — 4,700 lb WLL", wllLbs: 4700 },
  { label: "3/8\" chain (G70) — 6,600 lb WLL", wllLbs: 6600 },
  { label: "1/2\" chain (G70) — 11,300 lb WLL", wllLbs: 11300 },
];

// ---------- Bridge formula — 23 CFR 658.17 -----------------------------------
//
// W = 500 × [ (L×N)/(N−1) + 12N + 36 ], where L is the distance in
// feet between the outer axles of the group and N is the number of
// axles in the group; results round to the nearest 500 lb, the way
// the published FHWA table reads. Statutory caps ride on top: a
// single axle is capped at 20,000 lb, a tandem (two axles 8 ft or
// less apart) at 34,000 lb — a wider-spread pair is governed by the
// formula itself (the 10-ft spread-axle case), and gross weight is
// capped at 80,000 lb. PLANNING GUIDANCE ONLY: state rules, permits,
// and posted bridge limits govern — this sits beside Permit Mode and
// never replaces it.

export type BridgeGroupInput = { axles: number; spacingFt: number; actualLbs: number | null };

export type BridgeGroupResult = {
  axles: number;
  spacingFt: number;
  allowedLbs: number | null;
  actualLbs: number | null;
  overLbs: number | null;
  pass: boolean | null;
  basis: string;
  outOfScopeReason: string | null;
};

export const BRIDGE_SINGLE_AXLE_CAP_LBS = 20_000;
export const BRIDGE_TANDEM_CAP_LBS = 34_000;
export const BRIDGE_GROSS_CAP_LBS = 80_000;

export function bridgeGroupAllowed(axles: number, spacingFt: number): BridgeGroupResult["allowedLbs"] {
  if (!Number.isFinite(axles) || axles < 1 || !Number.isFinite(spacingFt) || spacingFt <= 0) return null;
  if (axles === 1) return BRIDGE_SINGLE_AXLE_CAP_LBS;
  const raw = 500 * ((spacingFt * axles) / (axles - 1) + 12 * axles + 36);
  const rounded = Math.round(raw / 500) * 500;
  if (axles === 2 && spacingFt <= 8) return Math.min(rounded, BRIDGE_TANDEM_CAP_LBS);
  return rounded;
}

export function bridgeFormulaCalc(groups: BridgeGroupInput[]): {
  groups: BridgeGroupResult[];
  grossActualLbs: number | null;
  grossPass: boolean | null;
  allPass: boolean | null;
} {
  const results: BridgeGroupResult[] = groups.map((g) => {
    if (!Number.isFinite(g.axles) || g.axles < 1 || g.axles > 9 || !Number.isFinite(g.spacingFt) || g.spacingFt <= 0) {
      return {
        axles: g.axles,
        spacingFt: g.spacingFt,
        allowedLbs: null,
        actualLbs: g.actualLbs,
        overLbs: null,
        pass: null,
        basis: "—",
        outOfScopeReason: "Enter 1–9 axles and the spacing between the group's outer axles — outside that, the published table doesn't apply and the tool won't guess.",
      };
    }
    const allowed = bridgeGroupAllowed(g.axles, g.spacingFt)!;
    const basis =
      g.axles === 1
        ? "Single-axle limit, 23 CFR 658.17"
        : g.axles === 2 && g.spacingFt <= 8
          ? "Tandem cap (axles ≤8 ft apart), 23 CFR 658.17"
          : "Bridge Formula, 23 CFR 658.17";
    const over = g.actualLbs != null ? g.actualLbs - allowed : null;
    return {
      axles: g.axles,
      spacingFt: g.spacingFt,
      allowedLbs: allowed,
      actualLbs: g.actualLbs,
      overLbs: over,
      pass: over != null ? over <= 0 : null,
      basis,
      outOfScopeReason: null,
    };
  });
  const grossActual = groups.every((g) => g.actualLbs != null)
    ? groups.reduce((s, g) => s + (g.actualLbs ?? 0), 0)
    : null;
  const grossPass = grossActual != null ? grossActual <= BRIDGE_GROSS_CAP_LBS : null;
  const groupPasses = results.map((r) => r.pass);
  const allPass =
    grossPass == null && groupPasses.every((p) => p == null)
      ? null
      : grossPass !== false && groupPasses.every((p) => p !== false);
  return { groups: results, grossActualLbs: grossActual, grossPass, allPass };
}

// ---------- Reefer cold chain --------------------------------------------------
//
// Every temperature here is DRIVER-ENTERED — typed in by the driver at
// a stop. The app has no reefer sensor feed and never presents these
// numbers as sensor readings. The band is the driver's own: setpoint
// ± the band they set.

export const REEFER_DEFAULT_BAND_F = 5;

export type ReeferBandStatus = "in_band" | "above" | "below";

export function reeferBandStatus(args: { setpointF: number; bandF: number; tempF: number }): {
  status: ReeferBandStatus;
  deviationF: number;
  label: string;
} {
  const deviation = Math.round((args.tempF - args.setpointF) * 10) / 10;
  if (args.tempF > args.setpointF + args.bandF) {
    return { status: "above", deviationF: deviation, label: `${deviation > 0 ? "+" : ""}${deviation}°F — ABOVE the band (setpoint ${args.setpointF}°F ± ${args.bandF}°F)` };
  }
  if (args.tempF < args.setpointF - args.bandF) {
    return { status: "below", deviationF: deviation, label: `${deviation}°F — BELOW the band (setpoint ${args.setpointF}°F ± ${args.bandF}°F)` };
  }
  return { status: "in_band", deviationF: deviation, label: `${deviation > 0 ? "+" : ""}${deviation}°F — inside the band` };
}

// ---------- High-wind advisory -------------------------------------------------
//
// A STONEMILES ADVISORY — not an official NWS warning. An empty
// high-profile trailer (dry van / reefer) is a sail; when forecast or
// observed gusts cross the advisory threshold the Drive screen says
// so, plainly labelled. Threshold: gusts of 40 mph.

export const WIND_ADVISORY_GUST_MPH = 40;

export function windAdvisory(args: {
  trailerType: TrailerType;
  /** True when the trailer is running empty (no freight on board). */
  trailerEmpty: boolean;
  gustMph: number | null;
  windMph: number | null;
}): { show: boolean; text: string | null } {
  const profile = TRAILER_PROFILES[args.trailerType];
  if (!profile.highProfile || !args.trailerEmpty) return { show: false, text: null };
  if (args.gustMph == null || args.gustMph < WIND_ADVISORY_GUST_MPH) return { show: false, text: null };
  return {
    show: true,
    text:
      `⚠️ STONEMILES wind advisory — not an official warning: gusts to ${Math.round(args.gustMph)} mph` +
      `${args.windMph != null ? ` (sustained ${Math.round(args.windMph)} mph)` : ""} with an EMPTY ${profile.label.toLowerCase()} behind you. ` +
      `An empty high-profile trailer can be pushed over in crosswind gusts at or above the ${WIND_ADVISORY_GUST_MPH} mph advisory threshold. ` +
      `Slow down, keep both hands on the wheel, and consider parking somewhere sheltered until the gusts drop.`,
  };
}

// ---------- Pre-trip inspection checklists -------------------------------------

export type PretripItem = { id: string; label: string };

const COMMON_PRETRIP: PretripItem[] = [
  { id: "coupling", label: "Coupling — kingpin / fifth wheel locked, jaws closed, release handle seated" },
  { id: "landing_gear", label: "Landing gear — fully raised, handle stowed, legs sound" },
  { id: "lights", label: "Lights & reflectors — head, tail, brake, turn, markers all working and clean" },
  { id: "tires", label: "Tires — pressure, tread, no cuts/bulges, lug nuts tight, no duals touching" },
  { id: "brakes", label: "Brakes — air build-up, leak-down, slack adjusters, hoses and gladhands sealed" },
  { id: "suspension", label: "Suspension — springs / air bags, shocks, no cracked or shifted parts" },
  { id: "frame", label: "Frame & crossmembers — no cracks, bends, or broken welds" },
  { id: "mudflaps", label: "Mudflaps in place and secure" },
];

export const PRETRIP_CHECKLISTS: Record<TrailerType, PretripItem[]> = {
  dry_van: [
    ...COMMON_PRETRIP,
    { id: "doors", label: "Doors — hinges, latches and lock rods sound; doors close and seal fully" },
    { id: "seal", label: "Seal — seal number matches the paperwork; seal intact before departure" },
    { id: "walls_floor", label: "Walls, roof & floor — no holes, no light leaks, floor sound for the freight" },
    { id: "load_bars", label: "Load bars / straps inside, freight blocked or braced" },
  ],
  reefer: [
    ...COMMON_PRETRIP,
    { id: "reefer_unit", label: "Reefer unit — starts, runs, no fault codes on the controller" },
    { id: "setpoint_check", label: "Setpoint — controller set to the load's setpoint; mode (continuous / start-stop) as required" },
    { id: "reefer_fuel", label: "Reefer fuel — tank level enough for the run" },
    { id: "reefer_battery", label: "Reefer battery & belts — cranks strong, belts and hoses sound" },
    { id: "air_chute", label: "Air chute & bulkhead — chute intact, return-air bulkhead in place, floor drains clear" },
    { id: "doors", label: "Doors — gaskets seal fully, hinges and latches sound" },
    { id: "seal", label: "Seal — seal number matches the paperwork; seal intact before departure" },
    { id: "box_temp", label: "Box temp — pulp/box temperature checked and in range before departure" },
  ],
  flatbed: [
    ...COMMON_PRETRIP,
    { id: "deck", label: "Deck — clear of debris, no cracked boards or damaged deck surface" },
    { id: "winches", label: "Winches & winch track — slide free, lock down, no bent teeth" },
    { id: "straps_chains", label: "Straps, chains & binders — enough for the load, no cuts, frays, or bent hooks" },
    { id: "rub_rail", label: "Rub rail & stake pockets — sound anchor points along both sides" },
    { id: "racks", label: "Headache rack / bulkhead — mounted solid, no cracked welds" },
    { id: "tarp", label: "Tarps — no tears, enough bungees, tarp gear stowed" },
  ],
  step_deck: [
    ...COMMON_PRETRIP,
    { id: "deck", label: "Upper & lower decks — clear of debris, surfaces sound" },
    { id: "winches", label: "Winches & winch track — slide free, lock down, no bent teeth" },
    { id: "straps_chains", label: "Straps, chains & binders — enough for the load, no cuts, frays, or bent hooks" },
    { id: "rub_rail", label: "Rub rail & stake pockets — sound anchor points along both sides" },
    { id: "ramps", label: "Ramps (if fitted) — pins, hinges and keepers sound, ramps stowed and locked" },
    { id: "racks", label: "Headache rack / bulkhead — mounted solid, no cracked welds" },
  ],
  rgn: [
    ...COMMON_PRETRIP,
    { id: "neck", label: "Detachable neck — locking pins seated, neck cylinders hold, no drift" },
    { id: "hydraulics", label: "Hydraulics — hoses, fittings and PTO/wet kit: no leaks, no chafing" },
    { id: "deck_well", label: "Deck & well — clear, deck boards/panels sound, outriggers stow and lock" },
    { id: "booster", label: "Booster / flip axle (if fitted) — pins seated, air and light lines connected" },
    { id: "straps_chains", label: "Chains & binders — enough for the load, no bent hooks or stretched links" },
    { id: "clearance_lights", label: "Oversize lighting & flags/signs on board for the permit load" },
  ],
};

export function pretripChecklist(type: TrailerType): PretripItem[] {
  return PRETRIP_CHECKLISTS[type];
}
