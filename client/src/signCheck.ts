// signCheck.ts — Split-sign prompts (driver order 2026-11-01).
//
// The driver's scenario, in his words: you're westbound, the road
// bends east for a stretch to get you west, and up ahead the route
// SPLITS east/west. Instinct says "don't go east," but the exit you
// need comes off that bend — miss the moment and you've missed your
// west exit. So before the split the app pops the ACTUAL ROAD SIGN:
// the shield the way it reads on the gantry ("I-10 WEST") plus the
// lane the routing data calls for ("right lane"), and says it out
// loud. The driver matches the sign on the screen to the sign over
// the road — no compass reasoning at 65 mph.
//
// This is NOT a wrong-way alarm: it never judges the truck's current
// heading (a bend can legitimately point the truck opposite its
// route direction for miles). It reads the NEXT split maneuver off
// the route's own routing data (Valhalla), exactly like the rest of
// guidance.
//
// Honesty rules, same as the rest of guidance:
//  - The shield is built ONLY from sign fields the routing response
//    actually returned (exit_branch / street names / instruction /
//    verbal). A route number with NO cardinal direction in the data
//    produces NO prompt — the direction is never guessed from the
//    truck's heading or the road's geometry, because on the bend in
//    the driver's own scenario those point the wrong way.
//  - The lane is stated ONLY when the maneuver itself carries a
//    side (type code or keep/exit wording). No side in the data →
//    the prompt says "follow this sign" and claims no lane.
//  - Ordinary turns never get a SIGN prompt: only split-family
//    maneuvers (stay / keep / fork / exit / ramp / merge) with a
//    signed highway branch qualify. Ordinary turns and exits DO
//    get their own prompt cards (evaluateManeuverCard, below) —
//    the field fix for "no prompt signs to exits or road sign,
//    just the prompt at the top": the exit number / the named
//    road at sign scale, from the same routing fields, never
//    invented.
//
// Pure logic (no DOM, no React) like routeGeometry.ts /
// routeWeather.ts, so the production behaviour is unit-testable
// (see signCheck.test.ts).

/** The subset of the app's Maneuver the sign logic reads. The full
 *  Maneuver type in App.tsx satisfies this structurally. */
export type SignManeuverLike = {
  instruction: string;
  miles: number;
  type: number | null;
  streetNames: string[];
  beginStreetNames: string[];
  exitNumber: string | null;
  exitName: string | null;
  exitToward: string | null;
  exitBranch: string | null;
  verbal: string | null;
};

export type Cardinal = "North" | "South" | "East" | "West";
export type LaneSide = "right" | "left" | "straight";

export type RoadSign = {
  kind: "interstate" | "us" | "highway";
  /** Route number as it reads on the shield, e.g. "10". */
  number: string;
  direction: Cardinal;
  directionAbbr: "N" | "S" | "E" | "W";
  /** Short route label, e.g. "I-10" / "US 98". */
  label: string;
  /** The sign as it reads on the gantry, e.g. "I-10 WEST". */
  fullLabel: string;
  /** Spoken form, e.g. "I-10 West" / "US 98 West". */
  spokenLabel: string;
};

const CARDINAL_WORD: Record<string, Cardinal> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  n: "North",
  s: "South",
  e: "East",
  w: "West",
};
const CARDINAL_ABBR: Record<Cardinal, "N" | "S" | "E" | "W"> = {
  North: "N",
  South: "S",
  East: "E",
  West: "W",
};

type RouteHit = { kind: RoadSign["kind"]; number: string; end: number };

/** Find a highway route token in one text. Interstate first (the
 *  driver's case), then US highways, then a plain "Highway NN" /
 *  "State Route NN". */
function findRoute(text: string): RouteHit | null {
  let m = /\bInterstate[\s-]?(\d{1,3})\b/i.exec(text) ?? /\bI-(\d{1,3})\b/.exec(text) ?? /\bI\s(\d{1,3})\b/.exec(text);
  if (m && m[1]) return { kind: "interstate", number: m[1], end: m.index + m[0].length };
  m = /\bU\.?S\.?[\s-]?(\d{1,3})\b/i.exec(text);
  if (m && m[1]) return { kind: "us", number: m[1], end: m.index + m[0].length };
  m = /\b(?:Highway|State\s+Route|State\s+Highway|Route)\s+(\d{1,3})\b/i.exec(text);
  if (m && m[1]) return { kind: "highway", number: m[1], end: m.index + m[0].length };
  return null;
}

/** The cardinal direction attached to a route token in the SAME
 *  text: a full word anywhere after the token ("I-10 West",
 *  "I-10 Westbound"), or the single letter riding right on the
 *  number ("I-10 W", "I-10 W."). A cardinal that belongs to some
 *  other road named earlier in the text is never borrowed — the
 *  search starts at the route token. */
function directionAfter(text: string, routeEnd: number): Cardinal | null {
  const rest = text.slice(routeEnd);
  const word = /\b(North|South|East|West)(?:bound)?\b/i.exec(rest);
  if (word && word[1]) return CARDINAL_WORD[word[1].toLowerCase()] ?? null;
  const letter = /^[\s\-–—.]*([NSEW])(?:\.|\b)/.exec(rest);
  if (letter && letter[1]) return CARDINAL_WORD[letter[1].toLowerCase()] ?? null;
  return null;
}

/** The cardinal direction stated immediately BEFORE a route token
 *  in the same text ("Westbound I-10", "West I-10") — Valhalla
 *  phrases some branches this way. Only a cardinal riding directly
 *  ahead of a route token counts; nothing is borrowed from
 *  farther back in the text. */
function directionBeforeToken(text: string): Cardinal | null {
  const m = /\b(North|South|East|West)(?:bound)?[\s\-–—]*(?=(?:Interstate[\s-]?\d|I-\d|I\s\d|U\.?S\.?[\s-]?\d|Highway\s+\d|State\s+Route\s+\d|Route\s+\d))/i.exec(text);
  return m && m[1] ? (CARDINAL_WORD[m[1].toLowerCase()] ?? null) : null;
}

function buildSign(kind: RoadSign["kind"], number: string, direction: Cardinal): RoadSign {
  const label = kind === "interstate" ? `I-${number}` : kind === "us" ? `US ${number}` : `Highway ${number}`;
  return {
    kind,
    number,
    direction,
    directionAbbr: CARDINAL_ABBR[direction],
    label,
    fullLabel: `${label} ${direction.toUpperCase()}`,
    spokenLabel: `${label} ${direction}`,
  };
}

/** Parse the road sign off ONE text. Returns the route found even
 *  when the text carries no direction for it (direction null) so
 *  the caller can keep looking in the maneuver's other fields —
 *  but a sign is only ever RETURNED complete, never completed by
 *  guessing. Exported for the docked sign board (placard.ts), which
 *  reads the same branch texts into shield refs — one parser, so
 *  the prompt family and the board can never disagree about what
 *  a branch says. */
export function parseSignText(text: string): { kind: RoadSign["kind"]; number: string; direction: Cardinal | null } | null {
  const route = findRoute(text);
  if (!route) return null;
  return { kind: route.kind, number: route.number, direction: directionAfter(text, route.end) ?? directionBeforeToken(text) };
}

/** Candidate sign texts off a maneuver, in sign-authority order:
 *  the exit branch IS the gantry sign's branch line; the street
 *  names the road runs on come next; the instruction/verbal carry
 *  the same wording the driver hears. exit_toward is deliberately
 *  NOT a candidate — it names the destination town, not the sign's
 *  route or direction. */
function signTexts(m: SignManeuverLike): string[] {
  const out: string[] = [];
  if (m.exitBranch) out.push(m.exitBranch);
  for (const s of m.beginStreetNames) if (s) out.push(s);
  for (const s of m.streetNames) if (s) out.push(s);
  if (m.instruction) out.push(m.instruction);
  if (m.verbal) out.push(m.verbal);
  if (m.exitName) out.push(m.exitName);
  return out;
}

/** The complete road sign for a maneuver, or null when the routing
 *  data doesn't carry one. A route number found in one field may
 *  take its direction from another field ONLY when that field names
 *  the same route with its direction attached (e.g. begin street
 *  "I-10" + instruction "Keep right to stay on I-10 W"). */
export function parseRoadSign(m: SignManeuverLike): RoadSign | null {
  const texts = signTexts(m);
  let routeOnly: { kind: RoadSign["kind"]; number: string } | null = null;
  for (const t of texts) {
    const hit = parseSignText(t);
    if (!hit) continue;
    if (hit.direction) return buildSign(hit.kind, hit.number, hit.direction);
    if (!routeOnly) routeOnly = { kind: hit.kind, number: hit.number };
  }
  if (routeOnly) {
    // Second pass: some other field may carry the same route WITH
    // its direction (the parse above returns the first complete
    // hit, so reaching here means none did — this pass exists for
    // fields whose route token differs in spacing, e.g. "I 10 W").
    for (const t of texts) {
      const hit = parseSignText(t);
      if (hit && hit.number === routeOnly.number && hit.direction) return buildSign(hit.kind, hit.number, hit.direction);
    }
  }
  return null;
}

/** Split-family maneuver types (Valhalla codes): ramps (17–19),
 *  exits (20–21), stay/keep (22–24), merges (38–39). */
const SPLIT_TYPES = new Set([17, 18, 19, 20, 21, 22, 23, 24, 38, 39]);

/** Is this maneuver a highway split — the route forks/branches and
 *  the driver must pick the signed branch — rather than an ordinary
 *  turn? True from the maneuver type, or from keep/stay/fork/exit
 *  wording in the instruction the routing data itself wrote. */
export function isSplitManeuver(m: SignManeuverLike): boolean {
  if (m.type != null && SPLIT_TYPES.has(m.type)) return true;
  // Exit data on the maneuver IS split evidence (field fix
  // 2026-11-01: Valhalla returned exit fields for splits whose
  // type code sat outside the split set, and the old gate dropped
  // them — the driver saw only the top banner, no sign prompt).
  if (m.exitBranch || m.exitNumber) return true;
  const text = `${m.instruction} ${m.verbal ?? ""}`;
  return /\b(keep|stay|fork|split)\b/i.test(text) || /\bexit\b/i.test(text);
}

/** The side the maneuver itself calls for, from its type code
 *  first, then its own wording. Null when the routing data carries
 *  no side — the prompt then claims no lane. */
export function laneSideOf(m: SignManeuverLike): LaneSide | null {
  const t = m.type;
  if (t != null) {
    if ([9, 10, 18, 20, 23, 38].includes(t)) return "right";
    if ([15, 16, 19, 21, 24, 39].includes(t)) return "left";
    if ([17, 22].includes(t)) return "straight";
  }
  const text = `${m.instruction} ${m.verbal ?? ""}`;
  if (/\b(keep|stay|exit|take|merge|bear)s?\b[^.]*\bright\b/i.test(text) || /\bright lane\b/i.test(text)) return "right";
  if (/\b(keep|stay|exit|take|merge|bear)s?\b[^.]*\bleft\b/i.test(text) || /\bleft lane\b/i.test(text)) return "left";
  if (/\bstraight\b/i.test(text)) return "straight";
  return null;
}

export function laneLabelOf(side: LaneSide | null): string | null {
  if (side === "right") return "Right lane";
  if (side === "left") return "Left lane";
  if (side === "straight") return "Stay straight";
  return null;
}

export type SignPromptPhase = "ahead" | "early" | "prepare" | "now";

export type SignPrompt = {
  maneuverIndex: number;
  sign: RoadSign;
  laneSide: LaneSide | null;
  /** "Right lane" / "Left lane" / "Stay straight" — null when the
   *  routing data carries no side, and no lane is claimed. */
  laneLabel: string | null;
  /** Miles from the truck to the START of the split maneuver. */
  atMi: number;
  phase: SignPromptPhase;
  /** e.g. "Exit 25" — only when the routing data returned it. */
  exitLine: string | null;
  /** The routing data's own words for the maneuver. */
  instruction: string;
  /** Voice line for the early warning (~2 mi out). */
  spokenEarly: string;
  /** Voice line at the split (~¼ mi out and at it). */
  spokenNow: string;
  /** Stable per maneuver + sign: the same split never re-prompts. */
  dedupeKey: string;
};

/** The prompt window: the sign pops within 2 miles of the split —
 *  early enough to pick a lane in a loaded truck, late enough that
 *  the gantry it names is the next decision, not a future one. */
export const SIGN_PROMPT_WINDOW_MI = 2;

function phaseFor(atMi: number): SignPromptPhase {
  if (atMi <= 0.15) return "now";
  if (atMi <= 0.6) return "prepare";
  if (atMi <= SIGN_PROMPT_WINDOW_MI) return "early";
  return "ahead";
}

function distWords(mi: number): string {
  if (mi <= 0.15) return "now";
  if (mi < 0.95) return "in under a mile";
  return `in about ${Math.round(mi)} mile${Math.round(mi) === 1 ? "" : "s"}`;
}

function buildPrompt(m: SignManeuverLike, maneuverIndex: number, atMi: number): SignPrompt | null {
  if (!isSplitManeuver(m)) return null;
  const sign = parseRoadSign(m);
  if (!sign) return null;
  const laneSide = laneSideOf(m);
  const laneLabel = laneLabelOf(laneSide);
  const laneSpoken = laneLabel ? `, ${laneLabel.toLowerCase()}` : "";
  return {
    maneuverIndex,
    sign,
    laneSide,
    laneLabel,
    atMi: Math.round(atMi * 100) / 100,
    phase: phaseFor(atMi),
    exitLine: m.exitNumber ? `Exit ${m.exitNumber}` : null,
    instruction: m.instruction,
    spokenEarly: `Sign ahead — ${distWords(atMi)}, follow the sign for ${sign.spokenLabel}${laneSpoken}.`,
    spokenNow: `Now — follow the sign: ${sign.spokenLabel}${laneSpoken}.`,
    dedupeKey: `sign-${maneuverIndex}-${sign.label}-${sign.directionAbbr}-${laneSide ?? "noside"}`,
  };
}

/** The prompt for the maneuver guidance is counting down to RIGHT
 *  NOW (the current next maneuver), or null: beyond the 2-mile
 *  window, not a split, or the routing data carries no complete
 *  sign (route + direction) for it. */
export function evaluateSignPrompt(m: SignManeuverLike, distToMi: number, maneuverIndex: number): SignPrompt | null {
  if (!Number.isFinite(distToMi) || distToMi < 0 || distToMi > SIGN_PROMPT_WINDOW_MI) return null;
  return buildPrompt(m, maneuverIndex, distToMi);
}

/** The next split sign anywhere ahead on the route — the panel's
 *  "next sign ahead" read and the prompt's early sighting. Scans
 *  from the current maneuver forward; atMi for a later maneuver is
 *  the countdown to the current one plus the full lengths of every
 *  maneuver in between. Returns the prompt with phase "ahead" when
 *  it's still beyond the pop-up window. */
export function findNextSplitSign(
  maneuvers: SignManeuverLike[],
  fromIndex: number,
  distToCurrentMi: number,
): SignPrompt | null {
  if (maneuvers.length === 0 || fromIndex < 0 || fromIndex >= maneuvers.length) return null;
  let atMi = Math.max(0, distToCurrentMi);
  for (let i = fromIndex; i < maneuvers.length; i++) {
    // Distance to maneuver i's point (the guidance convention):
    // the countdown to the current maneuver, plus the full lengths
    // of every maneuver strictly between it and maneuver i.
    if (i > fromIndex + 1) atMi += maneuvers[i - 1]!.miles;
    const m = maneuvers[i]!;
    const prompt = buildPrompt(m, i, atMi);
    if (prompt) return prompt;
  }
  return null;
}

// ---------- Exit & turn prompt cards (field fix 2026-11-01) -----------------
// The driver's screenshot verdict: at an ordinary turn (Turn left
// onto Michael Boulevard) the ONLY prompt was the thin banner at
// the top — no road-sign card, no exit card, nothing at sign
// scale. The split-sign prompt above can never cover that case:
// it is split-only by design. These cards are the rest of the
// prompt family, built from the same honesty rules — every word
// on the card comes from the maneuver's own routing fields:
//  - EXIT card: the maneuver carries exit data (exit number /
//    branch / toward) → the card shows the exit the way the
//    guide sign reads it, within 2 miles.
//  - TURN card: an ordinary turn onto a NAMED road → the card
//    shows that road's name big with the turn arrow and the
//    countdown, within 0.6 miles (city scale — earlier is noise).
// A maneuver with neither exit data nor a named road gets NO
// card — nothing is invented to fill the space. The split-sign
// prompt outranks both (the caller renders it first).

export type ManeuverCardKind = "exit" | "turn";

export type ManeuverCard = {
  kind: ManeuverCardKind;
  maneuverIndex: number;
  /** Big line: "EXIT 49" for an exit, the road name for a turn. */
  title: string;
  /** The routing data's own instruction for the maneuver. */
  instruction: string;
  /** "Exit 49 · I-10 W · toward Mobile" — only fields the data
   *  actually returned, or null. */
  exitLine: string | null;
  /** The named road the maneuver runs onto, or null. */
  street: string | null;
  /** Miles from the truck to the maneuver. */
  atMi: number;
  /** Stable per maneuver: the same maneuver never re-cards. */
  dedupeKey: string;
};

/** Exit window: guide signs matter from 2 miles out, same as the
 *  split-sign window. */
export const EXIT_CARD_WINDOW_MI = 2;
/** Turn window: an ordinary city turn cards inside 0.6 miles. */
export const TURN_CARD_WINDOW_MI = 0.6;

/** Valhalla turn-family type codes (turn / bear / sharp, both
 *  sides) — an ordinary turn, not a split, ramp, or continue. */
const TURN_TYPES = new Set([9, 10, 11, 12, 13, 14, 15, 16]);

/** The exit line for a maneuver, from its own exit fields only. */
export function exitLineOf(m: SignManeuverLike): string | null {
  const parts: string[] = [];
  if (m.exitNumber) parts.push(`Exit ${m.exitNumber}`);
  if (m.exitBranch) parts.push(m.exitBranch);
  if (m.exitToward) parts.push(`toward ${m.exitToward}`);
  if (m.exitName && m.exitName !== m.exitToward) parts.push(m.exitName);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The named road a maneuver turns onto / runs on, or null when
 *  the routing data names none. */
export function streetOf(m: SignManeuverLike): string | null {
  const names = m.beginStreetNames.length > 0 ? m.beginStreetNames : m.streetNames;
  return names.length > 0 ? names.join(" / ") : null;
}

/** The prompt card for the maneuver guidance is counting down to
 *  RIGHT NOW, or null: beyond its window, an arrival/continue
 *  maneuver, or a maneuver whose data carries neither exit detail
 *  nor a named road. Split-sign prompts are evaluated separately
 *  (evaluateSignPrompt) and outrank this card. */
export function evaluateManeuverCard(
  m: SignManeuverLike,
  distToMi: number,
  maneuverIndex: number,
): ManeuverCard | null {
  if (!Number.isFinite(distToMi) || distToMi < 0) return null;
  const exitLine = exitLineOf(m);
  const street = streetOf(m);
  if (exitLine && distToMi <= EXIT_CARD_WINDOW_MI) {
    return {
      kind: "exit",
      maneuverIndex,
      title: m.exitNumber ? `EXIT ${m.exitNumber}` : "EXIT",
      instruction: m.instruction,
      exitLine,
      street,
      atMi: Math.round(distToMi * 100) / 100,
      dedupeKey: `card-exit-${maneuverIndex}-${m.exitNumber ?? m.exitBranch ?? "x"}`,
    };
  }
  const isTurn =
    (m.type != null && TURN_TYPES.has(m.type)) || /\bturn\b/i.test(m.instruction);
  if (isTurn && street && distToMi <= TURN_CARD_WINDOW_MI) {
    return {
      kind: "turn",
      maneuverIndex,
      title: street,
      instruction: m.instruction,
      exitLine: null,
      street,
      atMi: Math.round(distToMi * 100) / 100,
      dedupeKey: `card-turn-${maneuverIndex}-${street}`,
    };
  }
  return null;
}
