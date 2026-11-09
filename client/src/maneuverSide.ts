// maneuverSide.ts — geometry check on a maneuver's stated side
// (field fix 2026-11-05, the driver's I-10 report).
//
// The report, in the driver's words: the place card said "Turn
// left to take the I 10 ramp," but the ramp was on his RIGHT —
// and the follow-on guidance then called for the left lane at an
// exit that also ran the other way. Everything else checked out.
//
// Diagnosis: guidance took a maneuver's side purely from the
// routing response's type code and narrative (laneSideOf in
// signCheck.ts, the placard arrow, the spoken lines — all read the
// same fields). That word is usually right — replaying live
// Valhalla truck routes around the driver's own I-10 corridor
// (Theodore → Mobile) showed the type code agreeing with the
// shape's turn at every ordinary turn, and at the genuine
// left-turn ramp onto I-10 at Theodore Dawes Road (shape turns
// ~66° left; "Turn left to take the I 10 ramp" is the road's real
// shape there). But the router computes a ramp's side from the
// turn angle at its chosen node, and at ramp forks / collectors
// that node can sit past the point where the ramp presented to
// the driver — the narrative then names the opposite side from
// the one the driver is looking at, and nothing in the app ever
// checked it against the road the route actually draws.
//
// The check below is that check, run ONCE at route build
// (App.tsx buildRouteOption) so every downstream surface — the
// top strip, the docked board, the sign prompt, voice, the saved
// route snapshot — reads the same corrected maneuver:
//
//   Measure the signed turn of the route's OWN shape at the
//   maneuver's begin point (incoming bearing over the last ~50 m
//   of shape, outgoing over the next ~80 m, interpolated). When
//   the shape CLEARLY turns the other way from the side the
//   maneuver states (≥15° the opposite way; ≥30° to override a
//   "straight" ramp/keep), the shape wins: the type code is
//   mirrored to its other-side twin and the direction word in
//   the instruction / verbal text is swapped to match. When the
//   shape is near-straight, unavailable, or agrees, the router's
//   word stands untouched — a gentle fork's side is the router's
//   call, and a checked-but-agreeing maneuver is byte-identical
//   to what the router returned.
//
// Honesty rules, same family as signCheck.ts: the correction is
// derived only from the routing response's own shape geometry
// (never the truck's heading — on a bend that points the wrong
// way), it fires only on a clear contradiction, and it never
// ADDS a side the response didn't state in words — for a
// "straight" ramp/keep only the type code (arrow / lane side)
// is corrected, the text is left exactly as returned.
//
// Pure logic (no DOM, no React), unit-testable like the rest of
// the guidance family (see maneuverSide.test.ts).

import { laneSideOf, type LaneSide } from "./signCheck";

/** The maneuver fields the check reads and (on a verdict) rewrites. */
export type SideCheckManeuver = {
  type: number | null;
  instruction: string;
  verbal: string | null;
};

export type SideFix = {
  type: number | null;
  instruction: string;
  verbal: string | null;
};

/** Incoming bearing window (m of shape before the maneuver point). */
export const SIDE_IN_WINDOW_M = 50;
/** Outgoing bearing window (m of shape past the maneuver point).
 *  Longer than the incoming window on purpose: an exit ramp runs
 *  parallel to the mainline for its first stretch, so the side it
 *  actually takes only reads over a longer run — while staying
 *  short of where a looping ramp curves back the other way. */
export const SIDE_OUT_WINDOW_M = 80;
/** A stated left/right is contradicted only when the shape turns
 *  at least this far the OTHER way. Below it the fork is gentle
 *  and the router's stated side stands. */
export const SIDE_CONTRA_DEG = 15;
/** A stated "straight" (ramp-straight / stay-straight) is
 *  corrected only on a decisive bend — a keep on a curving
 *  mainline bends with the road without being a side at all. */
export const STRAIGHT_CONTRA_DEG = 30;
/** Past this the maneuver is U-turn territory: the sign of the
 *  swing says nothing about which side the driver perceives, so
 *  no verdict is ever given. */
const UTURN_GUARD_DEG = 150;
/** A window side with less real shape than this is no evidence. */
const MIN_WINDOW_M = 12;

const EARTH_R_M = 6371000;

function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(s));
}

/** Bearing (deg, 0 = north, clockwise) from a to b, local-plane. */
function bearingDeg(a: [number, number], b: [number, number]): number {
  const x = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  const y = b[0] - a[0];
  return (Math.atan2(x, y) * 180) / Math.PI;
}

/** The point `meters` of shape away from coords[idx] in direction
 *  `step` (-1 back, +1 forward), interpolated inside the segment
 *  that crosses the window so a sparse shape (highway node spacing
 *  can exceed the window) still measures the window, not the whole
 *  segment. Null when the shape runs out before MIN_WINDOW_M. */
function windowPoint(
  coords: [number, number][],
  idx: number,
  step: -1 | 1,
  meters: number,
): [number, number] | null {
  let acc = 0;
  let j = idx;
  while (j + step >= 0 && j + step < coords.length) {
    const a = coords[j]!;
    const b = coords[j + step]!;
    const seg = haversineM(a, b);
    if (seg > 0 && acc + seg >= meters) {
      const f = (meters - acc) / seg;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    acc += seg;
    j += step;
  }
  if (j === idx || acc < MIN_WINDOW_M) return null;
  return coords[j]!;
}

/** The signed turn (deg) the route shape makes at the maneuver's
 *  begin point: negative = left, positive = right, measured
 *  incoming-window → outgoing-window. Null when the shape can't
 *  say (point at either end of the route, degenerate geometry). */
export function geometricTurnDeg(coords: [number, number][], beginShapeIndex: number): number | null {
  if (coords.length < 2) return null;
  if (!Number.isFinite(beginShapeIndex) || beginShapeIndex < 0 || beginShapeIndex >= coords.length) return null;
  const at = coords[beginShapeIndex]!;
  const back = windowPoint(coords, beginShapeIndex, -1, SIDE_IN_WINDOW_M);
  const fwd = windowPoint(coords, beginShapeIndex, 1, SIDE_OUT_WINDOW_M);
  if (!back || !fwd) return null;
  const inB = bearingDeg(back, at);
  const outB = bearingDeg(at, fwd);
  const delta = ((outB - inB + 540) % 360) - 180;
  return delta;
}

const RIGHT_TYPES = new Set([9, 10, 11, 18, 20, 23, 38]);
const LEFT_TYPES = new Set([14, 15, 16, 19, 21, 24, 39]);
const STRAIGHT_TYPES = new Set([17, 22]);
/** Type code → its other-side twin. Every pair stays inside its
 *  maneuver family (ramp ↔ ramp, exit ↔ exit, stay ↔ stay, turn
 *  ↔ turn), so family gates (split prompts, the board, turn
 *  cards) see the same family after a correction. */
const MIRROR_TYPE: Record<number, number> = {
  9: 16, 16: 9, // bear right / bear left
  10: 15, 15: 10, // turn right / turn left
  11: 14, 14: 11, // sharp right / sharp left
  18: 19, 19: 18, // ramp right / ramp left
  20: 21, 21: 20, // exit right / exit left
  23: 24, 24: 23, // stay right / stay left
  38: 39, 39: 38, // merge right / merge left
};
/** Straight family → the sided type for the side the shape takes. */
const STRAIGHT_SIDE_TYPE: Record<number, { right: number; left: number }> = {
  17: { right: 18, left: 19 }, // ramp straight → ramp right/left
  22: { right: 23, left: 24 }, // stay straight → stay right/left
};

/** The side a maneuver states: type code first (the same sets
 *  signCheck's laneSideOf uses, plus the sharp-turn codes whose
 *  arrows claim a side even though they claim no lane), then the
 *  maneuver's own wording via laneSideOf. */
export function statedSideOf(m: SideCheckManeuver): LaneSide | null {
  const t = m.type;
  if (t != null) {
    if (RIGHT_TYPES.has(t)) return "right";
    if (LEFT_TYPES.has(t)) return "left";
    if (STRAIGHT_TYPES.has(t)) return "straight";
  }
  const byWording = laneSideOf({
    instruction: m.instruction,
    verbal: m.verbal,
    type: null,
    miles: 0,
    streetNames: [],
    beginStreetNames: [],
    exitNumber: null,
    exitName: null,
    exitToward: null,
    exitBranch: null,
  });
  if (byWording) return byWording;
  // laneSideOf deliberately never parses "turn" (its prompts are
  // split-only); a type-less maneuver whose only side claim is a
  // turn phrase still states a side, and the check reads it.
  const turnWord = /\bturn\s+(right|left)\b/i.exec(`${m.instruction} ${m.verbal ?? ""}`);
  if (turnWord && turnWord[1]) return turnWord[1].toLowerCase() as LaneSide;
  return null;
}

function casedLike(word: string, replacement: "left" | "right"): string {
  if (word === word.toUpperCase()) return replacement.toUpperCase();
  if (word[0] === word[0]!.toUpperCase()) return replacement[0]!.toUpperCase() + replacement.slice(1);
  return replacement;
}

/** Swap the stated direction word for the other side in the
 *  direction phrases the router's narrative actually uses —
 *  verb phrases ("Turn left"), "on the left", "<side> lane",
 *  "the <side> exit/ramp". Road NAMES are never touched: only a
 *  direction word riding in one of those slots is rewritten. */
export function swapDirectionWords(text: string, from: "left" | "right", to: "left" | "right"): string {
  if (from === to) return text;
  const swap = (word: string) => casedLike(word, to);
  return text
    .replace(new RegExp(`\\b(turn|bear|keep|stay|merge|head|exit)\\s+(${from})\\b`, "gi"), (_m, verb: string, dir: string) => `${verb} ${swap(dir)}`)
    .replace(new RegExp(`\\bon\\s+the\\s+(${from})\\b`, "gi"), (_m, dir: string) => `on the ${swap(dir)}`)
    .replace(new RegExp(`\\bthe\\s+(${from})\\s+(exit|ramp)\\b`, "gi"), (_m, dir: string, noun: string) => `the ${swap(dir)} ${noun}`)
    .replace(new RegExp(`\\b(${from})\\s+(lane|exit|ramp)\\b`, "gi"), (_m, dir: string, noun: string) => `${swap(dir)} ${noun}`);
}

/** The geometry check: returns the corrected maneuver fields when
 *  the route shape CLEARLY contradicts the side the maneuver
 *  states, or null when the shape agrees, is near-straight, or
 *  can't say — the overwhelming majority, where the returned
 *  maneuver must stay byte-identical to the router's own. */
export function correctManeuverSide(
  m: SideCheckManeuver,
  coords: [number, number][],
  beginShapeIndex: number,
): SideFix | null {
  const stated = statedSideOf(m);
  if (!stated) return null;
  const turn = geometricTurnDeg(coords, beginShapeIndex);
  if (turn == null) return null;
  const abs = Math.abs(turn);
  if (abs > UTURN_GUARD_DEG) return null;
  const geoSide: LaneSide = abs < SIDE_CONTRA_DEG ? "straight" : turn > 0 ? "right" : "left";
  if (stated === "straight") {
    if (abs < STRAIGHT_CONTRA_DEG || geoSide === "straight") return null;
    const sided = m.type != null ? STRAIGHT_SIDE_TYPE[m.type] : undefined;
    if (!sided) return null;
    // Text untouched: the router's words claimed no side, so no
    // word is false — only the arrow / lane side (the type code)
    // is corrected to the side the shape takes.
    return { type: sided[geoSide], instruction: m.instruction, verbal: m.verbal };
  }
  if (geoSide === "straight" || geoSide === stated) return null;
  const mirrored = m.type != null ? MIRROR_TYPE[m.type] : undefined;
  return {
    type: mirrored ?? m.type,
    instruction: swapDirectionWords(m.instruction, stated, geoSide),
    verbal: m.verbal ? swapDirectionWords(m.verbal, stated, geoSide) : m.verbal,
  };
}
