/**
 * SUGGESTED NEXT LOAD — pure ranking rules (Alvys-grab build, x
 * 2026-11-15: the desk sees, for each driver, the open loads that
 * FIT — ranked, with the reasons printed).
 *
 * A suggestion is a RANKING, never a bypass: it reads the same
 * facts the binding funnels judge (calendar, item-9 home-time,
 * sealed duty record, position) and prints them. Binding still
 * runs through assignBoardLoad / claimBoardLoad, where the DQF
 * gate, the home-time gate, the dispatch mode, and the fee gate
 * all run exactly as they do without a suggestion.
 *
 * THE RULES:
 * (a) Four legs per suggestion — deadhead, calendar availability,
 *     home-time, hours (HOS). Every leg answers ok / conflict /
 *     not_checked. A leg whose facts are missing answers
 *     not_checked and SAYS SO — a missing fact never poses as a
 *     pass (the standing honesty rule, same as the fleet board's
 *     position gate and the assign ranking's unknown basis).
 * (b) Deadhead spends the route end for a truck finishing a load
 *     and the current position for an empty one — the same basis
 *     rule as rankAssignCandidates (fleetVisibility.ts).
 * (c) Availability stands on appointment times only: a candidate
 *     with no pickup/delivery time on file cannot be overlap-
 *     checked, and a bound load with no times cannot conflict —
 *     both are stated, never guessed.
 * (d) Home-time is judged by the item-9 pure check itself
 *     (checkHomeTimeConflict in homeTime.ts), computed by the
 *     caller and handed in as a verdict — this module never
 *     re-derives it, so the suggestion and the gate can never
 *     disagree about the math. (The gate still re-checks at bind
 *     time; a suggestion is a snapshot.)
 * (e) Hours stand on the sealed duty timeline replay: the 14-hour
 *     window from the first duty after the last completed
 *     10-hour reset — the same window the in-app clocks and
 *     hosViolationsInWindow use. No duty record → not_checked.
 * (f) NO rate or money value exists in any shape below.
 *
 * Pure functions only — the database half lives in actions.ts.
 */

import { haversineMi, type LatLonLike } from "./fleetVisibility";

export type LegStatus = "ok" | "conflict" | "not_checked";

export interface SuggestionLeg {
  status: LegStatus;
  /** The full sentence for the desk. */
  detail: string;
  /** The short form for the one-line reason string. */
  short: string;
}

export interface NextLoadCandidateLike {
  boardLoadId: number;
  pickupAtMs: number | null;
  deliveryAtMs: number | null;
  /** The pickup point, geocoded by the desk's client through the
   * app's existing geocode chain (the getAssignCandidates
   * pattern); null when the city couldn't be located. */
  pickupPoint: LatLonLike | null;
}

export interface TimedWindow {
  startMs: number;
  endMs: number;
  label: string;
}

export interface DriverFitFacts {
  /** Privacy-visible current position, or null. */
  currentPos: LatLonLike | null;
  /** The published route end of the driver's active load. */
  routeEnd: LatLonLike | null;
  hasActiveLoad: boolean;
  /** Bound loads WITH appointment times (overlap-checkable). */
  boundWindows: readonly TimedWindow[];
  /** Bound loads with NO times on file — counted, never judged. */
  untimedBoundCount: number;
  /** Approved off-duty blocks. */
  offDutyWindows: readonly TimedWindow[];
  /** The driver's sealed duty events (state + ISO time). */
  dutyEvents: readonly { state: string; at: string }[];
}

export interface CandidateFitInput {
  candidate: NextLoadCandidateLike;
  /** The item-9 verdict for this (driver, candidate), computed by
   * the caller with checkHomeTimeConflict. */
  homeTime: SuggestionLeg;
}

export interface RankedSuggestion {
  boardLoadId: number;
  deadheadMi: number | null;
  legs: {
    deadhead: SuggestionLeg;
    availability: SuggestionLeg;
    homeTime: SuggestionLeg;
    hos: SuggestionLeg;
  };
  /** The printed reasons, leg by leg: "12 mi deadhead · free from
   * Tue · home-time safe · hours check out". */
  reasons: string[];
  /** Any leg in conflict — the suggestion still shows (the desk
   * decides), ranked below clean fits. */
  conflict: boolean;
  score: number;
}

const HOUR_MS = 3_600_000;
const WINDOW_MS = 14 * HOUR_MS;
const RESET_MS = 10 * HOUR_MS;

const round1 = (n: number) => Math.round(n * 10) / 10;
const weekdayOf = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
const whenOf = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

// ---------------------------------------------------------------------------
// Leg: deadhead (basis rule shared with rankAssignCandidates).
// ---------------------------------------------------------------------------

function deadheadLeg(
  facts: DriverFitFacts,
  candidate: NextLoadCandidateLike,
): { leg: SuggestionLeg; mi: number | null } {
  const fromRouteEnd = facts.hasActiveLoad && facts.routeEnd != null;
  const anchor = fromRouteEnd ? facts.routeEnd : facts.currentPos;
  if (!candidate.pickupPoint) {
    return {
      mi: null,
      leg: {
        status: "not_checked",
        detail: "Deadhead not checked — the pickup city couldn't be located.",
        short: "deadhead not checked",
      },
    };
  }
  if (!anchor) {
    return {
      mi: null,
      leg: {
        status: "not_checked",
        detail: "Deadhead not checked — the truck's position isn't shared right now.",
        short: "deadhead not checked",
      },
    };
  }
  const mi = round1(haversineMi(anchor, candidate.pickupPoint));
  return {
    mi,
    leg: {
      status: "ok",
      detail: fromRouteEnd
        ? `${mi.toLocaleString()} mi deadhead from where the current load ends.`
        : `${mi.toLocaleString()} mi deadhead from the truck's current position.`,
      short: `${mi.toLocaleString()} mi deadhead`,
    },
  };
}

// ---------------------------------------------------------------------------
// Leg: calendar availability — bound loads + approved time off.
// ---------------------------------------------------------------------------

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function availabilityLeg(
  facts: DriverFitFacts,
  candidate: NextLoadCandidateLike,
): SuggestionLeg {
  if (candidate.pickupAtMs == null || candidate.deliveryAtMs == null) {
    return {
      status: "not_checked",
      detail: "Availability not checked — this load has no pickup or delivery time on file to check the calendar against.",
      short: "availability not checked",
    };
  }
  for (const w of facts.boundWindows) {
    if (overlaps(candidate.pickupAtMs, candidate.deliveryAtMs, w.startMs, w.endMs)) {
      return {
        status: "conflict",
        detail: `Overlaps ${w.label} already on the calendar.`,
        short: "overlaps a bound load",
      };
    }
  }
  for (const w of facts.offDutyWindows) {
    if (overlaps(candidate.pickupAtMs, candidate.deliveryAtMs, w.startMs, w.endMs)) {
      return {
        status: "conflict",
        detail: `Overlaps approved time off (${w.label}).`,
        short: "overlaps time off",
      };
    }
  }
  // The plain "free" statement: from the last bound end before the
  // pickup, or until the next bound start after the delivery.
  let freeFrom: number | null = null;
  let freeUntil: number | null = null;
  for (const w of [...facts.boundWindows, ...facts.offDutyWindows]) {
    if (w.endMs <= candidate.pickupAtMs && (freeFrom == null || w.endMs > freeFrom)) freeFrom = w.endMs;
    if (w.startMs >= candidate.deliveryAtMs && (freeUntil == null || w.startMs < freeUntil)) freeUntil = w.startMs;
  }
  const caveat =
    facts.untimedBoundCount > 0
      ? ` ${facts.untimedBoundCount} bound load${facts.untimedBoundCount === 1 ? " has" : "s have"} no times on file — those couldn't be overlap-checked.`
      : "";
  if (freeFrom != null) {
    return {
      status: "ok",
      detail: `Free from ${whenOf(freeFrom)} UTC — nothing bound or off-duty overlaps this load.${caveat}`,
      short: `free from ${weekdayOf(freeFrom)}`,
    };
  }
  if (freeUntil != null) {
    return {
      status: "ok",
      detail: `Calendar clear — next commitment starts ${whenOf(freeUntil)} UTC.${caveat}`,
      short: "calendar clear",
    };
  }
  return {
    status: "ok",
    detail: `Calendar clear — nothing bound or off-duty overlaps this load.${caveat}`,
    short: "calendar clear",
  };
}

// ---------------------------------------------------------------------------
// Leg: hours — the sealed duty replay (14h window / 10h reset).
// ---------------------------------------------------------------------------

/** Replay the sealed duty timeline to "now": the open 14-hour
 * window's start (first on-duty/driving after the last completed
 * 10-hour reset), or null when no window is open. Mirrors the
 * replay in hosViolationsInWindow (pointsLanes.ts). */
export function openDutyWindowStart(events: readonly { state: string; at: string }[], nowMs: number): number | null {
  const sorted = [...events]
    .map((e) => ({ state: e.state, start: Date.parse(e.at) }))
    .filter((e) => Number.isFinite(e.start) && e.start <= nowMs)
    .sort((a, b) => a.start - b.start);
  let resetAt = 0;
  let offRun = 0;
  let offRunStart = 0;
  let windowStart: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const segStart = sorted[i]!.start;
    const segEnd = i + 1 < sorted.length ? sorted[i + 1]!.start : nowMs;
    if (segEnd <= segStart) continue;
    const state = sorted[i]!.state;
    if (state === "off_duty" || state === "sleeper") {
      if (offRun === 0) offRunStart = segStart;
      offRun += segEnd - segStart;
      if (offRun >= RESET_MS && resetAt < offRunStart + RESET_MS) {
        resetAt = offRunStart + RESET_MS;
        windowStart = null;
      }
      continue;
    }
    offRun = 0;
    if ((state === "on_duty" || state === "driving") && windowStart === null && segEnd > resetAt) {
      windowStart = Math.max(segStart, resetAt);
    }
  }
  return windowStart;
}

export function hosLeg(
  events: readonly { state: string; at: string }[],
  nowMs: number,
  pickupAtMs: number | null,
): SuggestionLeg {
  if (events.length === 0) {
    return {
      status: "not_checked",
      detail: "Hours not checked — no sealed duty record on file for this driver.",
      short: "hours not checked",
    };
  }
  if (pickupAtMs == null) {
    return {
      status: "not_checked",
      detail: "Hours not checked — this load has no pickup time on file to check the duty clock against.",
      short: "hours not checked",
    };
  }
  const windowStart = openDutyWindowStart(events, nowMs);
  if (windowStart == null) {
    return {
      status: "ok",
      detail: "Hours check out — no open duty window on the sealed record; a fresh 14-hour window starts at pickup.",
      short: "hours check out",
    };
  }
  const windowEnd = windowStart + WINDOW_MS;
  if (pickupAtMs <= windowEnd) {
    return {
      status: "ok",
      detail: `Hours check out — pickup lands inside the current 14-hour duty window (open since ${whenOf(windowStart)} UTC).`,
      short: "hours check out",
    };
  }
  if (pickupAtMs - nowMs >= RESET_MS) {
    return {
      status: "ok",
      detail: "Hours check out — there is room for a full 10-hour reset before pickup.",
      short: "hours check out",
    };
  }
  return {
    status: "conflict",
    detail: `Hours run out ${whenOf(windowEnd)} UTC — the current 14-hour window closes before pickup, with no room for a 10-hour reset first.`,
    short: "hours run out",
  };
}

// ---------------------------------------------------------------------------
// The ranking.
// ---------------------------------------------------------------------------

/** Rank one driver's candidate next loads. Conflicts sink below
 * clean fits; unchecked legs cost a little; deadhead decides
 * between equals; earlier pickups win ties. Deterministic: the
 * same facts always produce the same order. */
export function rankNextLoadsForDriver(
  facts: DriverFitFacts,
  inputs: readonly CandidateFitInput[],
  nowMs: number,
): RankedSuggestion[] {
  const ranked = inputs.map(({ candidate, homeTime }): RankedSuggestion => {
    const { leg: deadhead, mi } = deadheadLeg(facts, candidate);
    const availability = availabilityLeg(facts, candidate);
    const hos = hosLeg(facts.dutyEvents, nowMs, candidate.pickupAtMs);
    const legs = { deadhead, availability, homeTime, hos };
    const legList = [deadhead, availability, homeTime, hos];
    const conflicts = legList.filter((l) => l.status === "conflict").length;
    const unchecked = legList.filter((l) => l.status === "not_checked").length;
    const score = conflicts * 100_000 + unchecked * 1_000 + (mi ?? 5_000);
    return {
      boardLoadId: candidate.boardLoadId,
      deadheadMi: mi,
      legs,
      reasons: legList.map((l) => l.short),
      conflict: conflicts > 0,
      score,
    };
  });
  const pickupOf = (id: number) => inputs.find((i) => i.candidate.boardLoadId === id)?.candidate.pickupAtMs ?? null;
  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const pa = pickupOf(a.boardLoadId);
    const pb = pickupOf(b.boardLoadId);
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return a.boardLoadId - b.boardLoadId;
  });
  return ranked;
}
