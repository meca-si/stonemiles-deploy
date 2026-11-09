// placard.ts — the docked gantry sign board (Rand McNally-style
// sign placards, x's order 2026-11-05, a Nov 13 freeze exception).
//
// While the truck closes on a signed exit / branch, the Drive
// screen's top maneuver presentation becomes the board the driver
// sees over the real road: a green gantry board docked to the top
// edge of the map — yellow EXIT tab, route shield, destination
// towns — over a lane strip when (and only when) lane data exists.
// The map's camera framing shifts down by the board's height, so
// the puck and the road ahead always render in the unobstructed
// area below it.
//
// Honesty rules, the same family as signCheck.ts — every word and
// number on the board comes from the routing response's own sign
// fields (Valhalla's per-maneuver `sign` object: exit number /
// branch / toward elements, verified live against the routing
// server at build time) or from the feeds named per chip:
//  - A maneuver with NO sign data gets NO board — the existing
//    one-line maneuver strip stays. Nothing is filled in.
//  - Lane arrows render ONLY from a lane record on the maneuver.
//    Valhalla returns no lane data today, so the field is null and
//    the board shows without the lane strip — lanes are never
//    invented from the maneuver's side or wording.
//  - Plain turns and merges never get a board (mini strip family).
//  - Smart chips appear only when their data is real: a weigh
//    station ahead with a CURRENT reported status (road intel,
//    staleness judged by weighStation.ts's rule), a bridge whose
//    clearance the map data actually tags, measured against the
//    truck profile's height. Unknown → the chip is omitted.
//  - The red permit variant fires only off Diamond, only while a
//    filed permit with an approved route is active and the truck
//    is NOT driving that permit's matched corridor — AND only when
//    the board's exit/branch is verified absent from the permit's
//    own printed route (permitExitVerdict): an exit the permit
//    names, or one that can't be matched either way, keeps the
//    green board with no permit claim.
//
// Pure logic (no DOM, no React) like signCheck.ts / permit.ts, so
// the production behaviour is unit-testable (see placard.test.ts).

import {
  isSplitManeuver,
  laneSideOf,
  parseRoadSign,
  parseSignText,
  type Cardinal,
  type LaneSide,
  type RoadSign,
  type SignManeuverLike,
} from "./signCheck";

/** The routing response's per-maneuver sign object (Valhalla
 *  `sign`), flattened to plain arrays at the parse point in
 *  App.tsx: exit numbers, branch lines (the gantry's route lines,
 *  with the response's consecutive count where it gave one),
 *  toward towns (the gantry's destination lines), and exit names.
 *  An element is present only where the response carried it. */
export type ManeuverSignData = {
  exitNumbers: string[];
  branches: { text: string; consecutive: number }[];
  towards: string[];
  names: string[];
};

/** One lane of a maneuver's lane record: what the lane does and
 *  whether it serves the maneuver's move (the highlighted exit
 *  lane on the board). A maneuver carries a lane record ONLY when
 *  the routing source returned one — never derived. */
export type PlacardLane = {
  move: "straight" | "left" | "right" | "exit-right" | "exit-left";
  active: boolean;
};

/** The subset of the app's Maneuver the board reads. The full
 *  Maneuver type in App.tsx satisfies this structurally; routes
 *  saved by older builds may lack `sign`/`lanes` at runtime, and
 *  every read below tolerates that (absent = no data). */
export type PlacardManeuverLike = SignManeuverLike & {
  sign?: ManeuverSignData | null;
  lanes?: PlacardLane[] | null;
};

// ---------- Windows & stages ----------------------------------------------

/** The board opens about a mile out (x's locked staging): slim
 *  approach strip from here to PLACARD_FULL_MI, full board inside
 *  that. Outside the window the existing presentations stand. */
export const PLACARD_APPROACH_MI = 1.0;
/** Inside ~0.3 mi the board grows to full size (the split). */
export const PLACARD_FULL_MI = 0.3;

export type PlacardStage = "slim" | "full" | "mini";

/** The board's stage at a distance, or null when no board shows
 *  (beyond the approach window — or the maneuver is passed, which
 *  guidance expresses by advancing to the next maneuver, so the
 *  board re-derives or vanishes on its own). A shrunk board (one
 *  tap on it) stays "mini" at any in-window distance until the
 *  next maneuver. */
export function placardStage(distToMi: number, shrunk: boolean): PlacardStage | null {
  if (!Number.isFinite(distToMi) || distToMi < 0 || distToMi > PLACARD_APPROACH_MI) return null;
  if (shrunk) return "mini";
  return distToMi <= PLACARD_FULL_MI ? "full" : "slim";
}

// ---------- Route refs ------------------------------------------------------

export type PlacardRefKind = "interstate" | "us" | "highway" | "state" | "text";

export type PlacardRef = {
  kind: PlacardRefKind;
  /** Route number as it reads on the shield, e.g. "65" — null for
   *  a plain-text branch with no route token. */
  number: string | null;
  direction: Cardinal | null;
  directionAbbr: "N" | "S" | "E" | "W" | null;
  /** Shield label: "I-65" / "US 98" / "Highway 20" / "AL 79", or
   *  the branch text itself for a text ref. */
  label: string;
  /** The branch text exactly as the routing data returned it. */
  text: string;
};

const CARDINAL_ABBR_OF: Record<Cardinal, "N" | "S" | "E" | "W"> = {
  North: "N",
  South: "S",
  East: "E",
  West: "W",
};
const CARDINAL_WORD_RE = /\b(North|South|East|West)(?:bound)?\b/i;

/** One branch line → the shield ref it names. Interstate / US /
 *  Highway tokens parse through signCheck's parser (one parser for
 *  the whole prompt family); a state-route ref ("AL 79", "MS 98")
 *  parses here; anything else stays a text ref carrying the
 *  branch's own words — displayed as printed, never dressed up as
 *  a numbered shield it isn't. */
export function parsePlacardRef(text: string): PlacardRef {
  const hit = parseSignText(text);
  if (hit) {
    const label =
      hit.kind === "interstate" ? `I-${hit.number}` : hit.kind === "us" ? `US ${hit.number}` : `Highway ${hit.number}`;
    return {
      kind: hit.kind,
      number: hit.number,
      direction: hit.direction,
      directionAbbr: hit.direction ? CARDINAL_ABBR_OF[hit.direction] : null,
      label,
      text,
    };
  }
  const st = /^\s*([A-Z]{2})[\s-]?(\d{1,3})\b/.exec(text);
  if (st && st[1] && st[2]) {
    const dirWord = CARDINAL_WORD_RE.exec(text.slice(st[0].length));
    const direction = dirWord && dirWord[1] ? ((dirWord[1][0]!.toUpperCase() + dirWord[1].slice(1).toLowerCase()) as Cardinal) : null;
    return {
      kind: "state",
      number: st[2],
      direction,
      directionAbbr: direction ? CARDINAL_ABBR_OF[direction] : null,
      label: `${st[1]} ${st[2]}`,
      text,
    };
  }
  return { kind: "text", number: null, direction: null, directionAbbr: null, label: text, text };
}

// ---------- The board -------------------------------------------------------

export type Placard = {
  maneuverIndex: number;
  /** Stable per maneuver: the same exit never re-shrinks/re-pops. */
  dedupeKey: string;
  /** Exit number exactly as the sign data returned it ("242",
   *  "261B"), or null when the data carried none. */
  exitNumber: string | null;
  /** Branch refs in the sign's own order (the primary shield
   *  first), capped at 3 — further branches stay off the board
   *  rather than shrinking its type. */
  refs: PlacardRef[];
  /** The complete sign (route + direction) when one parses. */
  sign: RoadSign | null;
  /** The cardinal the board headlines ("NORTH"), from the primary
   *  ref or the complete sign — null when the data names none. */
  directionWord: string | null;
  /** Destination towns from the sign's toward lines, capped at 2
   *  (a gantry's two lines). Empty when the data names none. */
  destinations: string[];
  /** The routing data's own instruction for the maneuver. */
  instruction: string;
  /** The side the maneuver itself calls for (signCheck's rule:
   *  type code first, then the maneuver's own wording), or null
   *  when the data carries no side — the board then shows a
   *  straight arrow and claims no side. */
  side: LaneSide | null;
  /** The maneuver's lane record, or null when the routing data
   *  carried none — null renders NO lane strip, ever. */
  lanes: PlacardLane[] | null;
  /** Lane caption derived ONLY from a lane record ("Keep right —
   *  1 lane exits"); null with no lane record. */
  laneCaption: string | null;
};

/** Maneuver families that can carry a board: ramps (17–19), exits
 *  (20–21), stay/keep branches (22–24). Merges (38–39) are
 *  deliberately OUT — x's rule gives merges the mini strip — and
 *  plain turns / continues / roundabouts never board. */
const BOARD_TYPES = new Set([17, 18, 19, 20, 21, 22, 23, 24]);
const MERGE_TYPES = new Set([38, 39]);

/** The sign fields a maneuver carries, from its structured sign
 *  object first, then the flat exit fields (routes saved before
 *  the sign parse, or responses that use the flat shape). */
function signFieldsOf(m: PlacardManeuverLike): {
  exitNumber: string | null;
  branchTexts: string[];
  towards: string[];
  names: string[];
} {
  const s = m.sign ?? null;
  const exitNumber =
    (s && s.exitNumbers.length > 0 ? s.exitNumbers.join(", ") : null) ?? m.exitNumber ?? null;
  const branchTexts =
    s && s.branches.length > 0
      ? s.branches.map((b) => b.text)
      : m.exitBranch
        ? m.exitBranch.split(" · ").map((t) => t.trim()).filter(Boolean)
        : [];
  const towards =
    s && s.towards.length > 0
      ? s.towards
      : m.exitToward
        ? m.exitToward.split(" · ").map((t) => t.trim()).filter(Boolean)
        : [];
  const names =
    s && s.names.length > 0
      ? s.names
      : m.exitName
        ? m.exitName.split(" · ").map((t) => t.trim()).filter(Boolean)
        : [];
  return { exitNumber, branchTexts, towards, names };
}

/** The lane caption for a lane record, in the preview's words.
 *  Counts come from the record itself — this is arithmetic on
 *  returned data, never a guess about the road. */
export function laneCaptionOf(lanes: PlacardLane[]): string | null {
  const exitLanes = lanes.filter((l) => l.active && (l.move === "exit-right" || l.move === "exit-left"));
  if (exitLanes.length > 0) {
    const side = exitLanes[0]!.move === "exit-right" ? "right" : "left";
    return `Keep ${side} — ${exitLanes.length} lane${exitLanes.length === 1 ? "" : "s"} exit${exitLanes.length === 1 ? "s" : ""}`;
  }
  if (lanes.some((l) => l.active)) return "Follow the marked lanes";
  return null;
}

/** Build the board for the maneuver guidance is counting down to,
 *  or null — beyond family (turn/merge/continue), or NO sign data
 *  at all (the caller then keeps the existing one-line strip; an
 *  empty or guessed board never renders). */
export function buildPlacard(m: PlacardManeuverLike, maneuverIndex: number): Placard | null {
  if (m.type != null && MERGE_TYPES.has(m.type)) return null;
  const fields = signFieldsOf(m);
  const sign = parseRoadSign(m);
  const hasSignData =
    fields.exitNumber != null || fields.branchTexts.length > 0 || fields.towards.length > 0 || fields.names.length > 0 || sign != null;
  if (!hasSignData) return null;
  const inFamily =
    (m.type != null && BOARD_TYPES.has(m.type)) ||
    fields.exitNumber != null ||
    // A signed split whose type code sits outside the family set
    // still boards (the signCheck field-fix lesson: Valhalla
    // returns exit fields for splits with odd type codes) — but
    // merges were excluded above and never reach here.
    isSplitManeuver(m);
  if (!inFamily) return null;

  const refs = fields.branchTexts.slice(0, 3).map(parsePlacardRef);
  if (refs.length === 0 && sign) {
    refs.push({
      kind: sign.kind,
      number: sign.number,
      direction: sign.direction,
      directionAbbr: sign.directionAbbr,
      label: sign.label,
      text: sign.fullLabel,
    });
  }
  const directionWord =
    sign?.direction.toUpperCase() ?? refs.find((r) => r.direction)?.direction?.toUpperCase() ?? null;
  const destinations = (fields.towards.length > 0 ? fields.towards : fields.names).slice(0, 2);
  const lanes = m.lanes && m.lanes.length > 0 ? m.lanes : null;
  return {
    maneuverIndex,
    dedupeKey: `placard-${maneuverIndex}-${fields.exitNumber ?? refs[0]?.label ?? "sign"}`,
    exitNumber: fields.exitNumber,
    refs,
    sign,
    directionWord,
    destinations,
    instruction: m.instruction,
    side: laneSideOf(m),
    lanes,
    laneCaption: lanes ? laneCaptionOf(lanes) : null,
  };
}

// ---------- Night dim -------------------------------------------------------

export type PlacardPalette = {
  boardBg: string;
  boardBorder: string;
  text: string;
  subText: string;
  exitTabBg: string;
  exitTabText: string;
  arrow: string;
  asphalt: string;
  laneCellActiveBg: string;
  permitBg: string;
};

/** Day and night looks for the board. Night (x's rule: after dark
 *  the green and text dim to a night level — readable, no glare)
 *  is the same board at lower luminance across every surface: the
 *  green deepens, the EXIT tab's yellow drops to a dimmer amber,
 *  the text warms and softens. The pair is pinned by tests so the
 *  night level can never drift back up to day brightness. */
export const PLACARD_PALETTES: Record<"day" | "night", PlacardPalette> = {
  day: {
    boardBg: "linear-gradient(180deg, #0d7a40, #065c2c)",
    boardBorder: "rgba(255,255,255,0.92)",
    text: "#ffffff",
    subText: "#dcf2e4",
    exitTabBg: "#ffd21f",
    exitTabText: "#141414",
    arrow: "#ffb020",
    asphalt: "#151a21",
    laneCellActiveBg: "rgba(255,176,32,0.28)",
    permitBg: "linear-gradient(180deg, #c22727, #8f1a1a)",
  },
  night: {
    boardBg: "linear-gradient(180deg, #084c27, #053a1d)",
    boardBorder: "rgba(233,230,218,0.55)",
    text: "#e9e6da",
    subText: "#b9c9bd",
    exitTabBg: "#c79a17",
    exitTabText: "#141414",
    arrow: "#d9931c",
    asphalt: "#10141a",
    laneCellActiveBg: "rgba(217,147,28,0.22)",
    permitBg: "linear-gradient(180deg, #7e1d1d, #5f1414)",
  },
};

export function placardPalette(night: boolean): PlacardPalette {
  return night ? PLACARD_PALETTES.night : PLACARD_PALETTES.day;
}

// ---------- Smart chips -----------------------------------------------------

export type PlacardChip = {
  key: "weigh" | "bridge";
  tone: "open" | "closed" | "clear" | "short";
  text: string;
};

export type PlacardChips = { weigh: PlacardChip | null; bridge: PlacardChip | null };

export const EMPTY_PLACARD_CHIPS: PlacardChips = { weigh: null, bridge: null };

/** The weigh-station chip: the next station ahead on the route
 *  with its CURRENT status from road intel. The caller judges the
 *  status with weighStation.ts's staleness rule and passes only
 *  "open"/"closed"/"unknown" — unknown (never reported, or the
 *  last report aged out) omits the chip entirely: a chip guessing
 *  a status would be worse than none. */
export function weighChipFor(input: {
  distanceMi: number;
  distanceLabel: string;
  status: "open" | "closed" | "unknown";
} | null): PlacardChip | null {
  if (!input) return null;
  if (input.status === "unknown") return null;
  if (!Number.isFinite(input.distanceMi) || input.distanceMi < 0) return null;
  return {
    key: "weigh",
    tone: input.status,
    text: `Weigh station ${input.distanceLabel} — ${input.status === "open" ? "OPEN" : "CLOSED"}`,
  };
}

/** Feet → the way a clearance reads on the sign: 14'2". Rounds to
 *  the nearest inch; the numbers compared underneath stay exact. */
export function heightLabel(ft: number): string {
  const totalIn = Math.max(0, Math.round(ft * 12));
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

/** The bridge chip: the next bridge ahead whose clearance the map
 *  data actually tags, against the truck profile's height. Clear
 *  (clearance ≥ truck height) reads as a check; short reads as
 *  the warning it is. A bridge with no tagged clearance never
 *  reaches this builder — the caller only passes tagged ones. */
export function bridgeChipFor(input: {
  clearanceFt: number;
  truckHeightFt: number;
} | null): PlacardChip | null {
  if (!input) return null;
  if (!Number.isFinite(input.clearanceFt) || !Number.isFinite(input.truckHeightFt)) return null;
  const clear = heightLabel(input.clearanceFt);
  const truck = heightLabel(input.truckHeightFt);
  if (input.clearanceFt < input.truckHeightFt) {
    return { key: "bridge", tone: "short", text: `Bridge ${clear} — you're ${truck} — TOO LOW` };
  }
  return { key: "bridge", tone: "clear", text: `Bridge ${clear} — you're ${truck} ✓` };
}

// ---------- Permit variant --------------------------------------------------

/** The road the approved route stays on, parsed from the permit
 *  docket's own printed route lines ("I-65 N …", "US 98 …") — the
 *  first route ref they name. Null when the docket's lines name no
 *  route token: the banner then speaks generally rather than
 *  inventing a road. */
export function permitStayRoute(docket: { routeSteps: string[]; routePlaces: string[] }): string | null {
  for (const line of [...docket.routeSteps, ...docket.routePlaces]) {
    const ref = parsePlacardRef(line);
    if (ref.kind !== "text") return ref.label;
  }
  return null;
}

/** The red banner's second line: "Permit route stays on I-65"
 *  when the docket names the road, the general form when it
 *  doesn't. */
export function permitStayLine(docket: { routeSteps: string[]; routePlaces: string[] }): string {
  const route = permitStayRoute(docket);
  return route ? `Permit route stays on ${route}` : "Stay on your approved permit route";
}

export type PermitExitVerdict = "off-route" | "on-route" | "unknown";

/** Normalize a place / town name for comparison: lowercase,
 *  punctuation stripped, whitespace collapsed. */
function normPlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Judge the board's maneuver against the permit's approved
 *  route, from the docket's own printed lines — the red variant
 *  may only claim "not on your approved route" when that is
 *  VERIFIED, never merely because a permit exists:
 *  - "on-route": the maneuver's branch ref or destination town
 *    appears in the permit's route steps/places (the driver may
 *    simply not have started permit navigation yet — the exit is
 *    still the approved one, and the board stays green).
 *  - "off-route": BOTH sides name comparable tokens (route refs
 *    or destination/place names) and they share NONE — the exit
 *    verifiably goes somewhere the approved route doesn't.
 *  - "unknown": either side names nothing comparable — no claim
 *    is made and the board stays green. */
export function permitExitVerdict(
  docket: { routeSteps: string[]; routePlaces: string[] },
  placard: Pick<Placard, "refs" | "destinations">,
): PermitExitVerdict {
  const permitRefs = new Set<string>();
  for (const line of [...docket.routeSteps, ...docket.routePlaces]) {
    const ref = parsePlacardRef(line);
    if (ref.kind !== "text") permitRefs.add(ref.label);
  }
  const permitPlaces = new Set(docket.routePlaces.map(normPlace).filter(Boolean));
  // Route steps often carry their towns in prose ("…to Birmingham");
  // a step line with no route token contributes its whole line as a
  // place candidate too — matching stays conservative either way,
  // since a hit only ever turns the board GREEN.
  for (const line of docket.routeSteps) {
    const p = normPlace(line);
    if (p) permitPlaces.add(p);
  }
  const maneuverRefs = placard.refs.filter((r) => r.kind !== "text").map((r) => r.label);
  const maneuverPlaces = placard.destinations.map(normPlace).filter(Boolean);
  const refHit = maneuverRefs.some((l) => permitRefs.has(l));
  const placeHit = maneuverPlaces.some((mp) =>
    [...permitPlaces].some((pp) => pp === mp || pp.includes(mp) || mp.includes(pp)),
  );
  if (refHit || placeHit) return "on-route";
  const permitComparable = permitRefs.size > 0 || docket.routePlaces.length > 0;
  const maneuverComparable = maneuverRefs.length > 0 || maneuverPlaces.length > 0;
  return permitComparable && maneuverComparable ? "off-route" : "unknown";
}
