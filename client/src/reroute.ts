// reroute.ts — Automatic-reroute timing + settle logic (driver
// order 2026-11-01, road test #6: "reroute should be 3-6 sec or
// less" — and the field verdict that it "wasn't working").
//
// What the drive actually showed (perf log + screenshot):
//  - Reroute attempts took 12–13.6 s. The fast path allowed a 20 s
//    Valhalla timeout, and when the direct request failed on a long
//    haul it fell into sectioned routing — many serial requests —
//    so the driver sat off-route watching nothing settle.
//  - Reroutes fired four times in ~12 minutes and never settled:
//    at city speeds the new line could snap onto the wrong parallel
//    road (the origin heading is starved under ~5 mph), the truck
//    still read off-route against the NEW line, and the loop fired
//    again on the ordinary cooldown — forever, same spot, same
//    answer.
//
// This module owns the rules that fix both, as pure logic (no DOM,
// no React) like routeGeometry.ts, so the production behaviour is
// unit-testable (see reroute.test.ts):
//  - THE BUDGET: a reroute publishes inside 6 s or it does not
//    publish at all in this attempt. Attempt timeouts are carved
//    out of the remaining budget, a retry only runs when it can
//    FIT inside the budget, and the sectioned long-haul fallback
//    is never started on the reroute path — it cannot fit, so the
//    honest outcome is the not-settling state, surfaced on screen.
//  - SETTLE: a published reroute only counts as settled when the
//    truck actually reads ON the new line (off-route distance at
//    or under the ordinary threshold). A line that lands on the
//    wrong parallel road is not a settle.
//  - NO LOOP: after a reroute, another automatic reroute for the
//    SAME episode only fires when the truck has genuinely moved
//    (≥ REFIRE_TRAVEL_MI from the reroute origin — a new spot can
//    earn a new answer) or a long gap has passed. Three attempts
//    at effectively the same spot = the not-settling state: the Go
//    screen says so plainly and offers a manual "Reroute now",
//    instead of silently re-planning the same point forever.

/** The whole reroute — detection hand-off to published line —
 *  must land inside this. The driver's words: "3-6 sec or less." */
export const REROUTE_BUDGET_MS = 6000;
/** First attempt's share of the budget. Leaves room for exactly
 *  one retry inside the same budget when the first attempt hangs
 *  or lands on the wrong road. */
export const REROUTE_FIRST_TIMEOUT_MS = 2700;
/** The retry gets what's left, capped at this. */
export const REROUTE_RETRY_TIMEOUT_MS = 2700;
/** Never start an attempt with less than this left — it cannot
 *  meaningfully answer, and starting it would blow the budget. */
export const REROUTE_MIN_ATTEMPT_MS = 700;
/** Reserve kept at the end of the budget for publishing state. */
export const REROUTE_PUBLISH_RESERVE_MS = 250;

/** A reroute is settled when the truck reads this close to the
 *  new line — the same 0.08 mi the off-route detector uses, so
 *  "settled" and "not off route" can never disagree. */
export const REROUTE_SETTLE_OFF_MI = 0.08;

/** How far the truck must travel from the reroute origin before
 *  the same off-route episode may fire another automatic reroute. */
export const REROUTE_REFIRE_TRAVEL_MI = 0.18;
/** …or how long may pass before it may fire again regardless. */
export const REROUTE_REFIRE_GAP_MS = 45_000;
/** Attempts at effectively one spot before the state is declared
 *  not-settling and automatic refires stop until the truck moves. */
export const REROUTE_MAX_EPISODE_ATTEMPTS = 3;

/** Timeout for attempt `attempt` (0-based) given how much of the
 *  budget has already elapsed. 0 means: no attempt may start —
 *  the budget is spent, surface not-settling instead. */
export function rerouteTimeoutForAttempt(attempt: number, elapsedMs: number): number {
  const remaining = REROUTE_BUDGET_MS - elapsedMs - REROUTE_PUBLISH_RESERVE_MS;
  if (remaining < REROUTE_MIN_ATTEMPT_MS) return 0;
  const cap = attempt <= 0 ? REROUTE_FIRST_TIMEOUT_MS : REROUTE_RETRY_TIMEOUT_MS;
  return Math.min(cap, remaining);
}

/** May another attempt start inside this reroute's budget? At most
 *  two attempts ever ride one budget (first + one retry). */
export function rerouteMayRetry(attemptsSoFar: number, elapsedMs: number): boolean {
  if (attemptsSoFar >= 2) return false;
  return rerouteTimeoutForAttempt(attemptsSoFar, elapsedMs) > 0;
}

/** Did a published reroute actually settle the truck onto its line? */
export function isRerouteSettled(offMi: number): boolean {
  return Number.isFinite(offMi) && offMi <= REROUTE_SETTLE_OFF_MI;
}

export type RerouteEpisode = {
  /** Attempts fired for this off-route episode. */
  attempts: number;
  /** Epoch ms of the most recent attempt, 0 when none yet. */
  lastAttemptAtMs: number;
  /** Travel (mi) from the origin of the most recent attempt to
   *  the truck's position now — the caller supplies it. */
  travelledSinceLastMi: number;
};

/** May the automatic rerouter fire (again) for this episode?
 *  First attempt: always. Refires: only on real movement from the
 *  last reroute origin, or after the long gap — and never past
 *  the per-episode attempt cap without that movement. This is the
 *  rule that kills the same-spot loop from the field report. */
export function canFireReroute(ep: RerouteEpisode, nowMs: number): boolean {
  if (ep.attempts <= 0 || ep.lastAttemptAtMs <= 0) return true;
  const moved = ep.travelledSinceLastMi >= REROUTE_REFIRE_TRAVEL_MI;
  if (moved) return true;
  if (ep.attempts >= REROUTE_MAX_EPISODE_ATTEMPTS) return false;
  return nowMs - ep.lastAttemptAtMs >= REROUTE_REFIRE_GAP_MS;
}

/** The episode is not settling: attempts have been spent at
 *  effectively the same spot and the truck is still off the line.
 *  The UI surfaces this state instead of looping silently. */
export function isNotSettling(ep: RerouteEpisode): boolean {
  return ep.attempts >= REROUTE_MAX_EPISODE_ATTEMPTS && ep.travelledSinceLastMi < REROUTE_REFIRE_TRAVEL_MI;
}
