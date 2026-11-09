// Driver-reported road hazards — the pure lifecycle rules behind
// the hazard_reports table (migration 0107, x's order 2026-11-08:
// "Build all five"). The hazard extension of the construction
// work-zone system (migration 0106, server/src/workZone.ts): same
// vote discipline, a SHORTER clock — a stopped-traffic jam, debris,
// or a vehicle on the shoulder is a right-now fact, not a 12-hour
// one.
//
// Framework-free (no DB, no DOM), like workZone.ts, so the exact
// production rules are unit-testable (see hazardReport.test.ts).
// The actions in actions.ts own the rows; every decision about
// whether a hazard is live, extended, or retired is made HERE.
//
// THE RULES (the build brief, verbatim law):
//   - Three quick types only: traffic stopped, debris in road,
//     vehicle on shoulder.
//   - A report lives 2 HOURS from when it was dropped.
//   - "Still there" from a driver at the hazard extends it: a
//     fresh 2 hours from the confirmation, and the confirmation
//     counts.
//   - "Gone" retires it: immediately when the hazard's own
//     reporter says it, otherwise once a SECOND independent
//     driver confirms it's gone (one stray tap never kills
//     another driver's live warning).
//   - Every vote is GPS-checked server-side: the voter's own
//     position must be within VOTE_RADIUS_MI of the hazard — you
//     can only judge a hazard you're actually at.

/** The three quick hazard types the Drive / Road alerts screens offer. */
export const HAZARD_KINDS = ["traffic_stopped", "debris", "vehicle_shoulder"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export function isHazardKind(v: string): v is HazardKind {
  return (HAZARD_KINDS as readonly string[]).includes(v);
}

/** How long a hazard report lives without re-confirmation: 2 hours. */
export const HAZARD_TTL_MS = 2 * 3600_000;

/** "Gone" votes from independent drivers needed to retire a hazard
 *  (the reporter's own Gone retires at once — see applyGone). */
export const HAZARD_GONE_VOTES_TO_RETIRE = 2;

/** A Still-there / Gone vote counts only from a driver whose GPS is
 *  within this distance of the hazard. */
export const HAZARD_VOTE_RADIUS_MI = 1.0;

export interface HazardRow {
  id: number;
  kind: string;
  lat: number;
  lon: number;
  note: string | null;
  reporter: string | null;
  confirmCount: number;
  goneCount: number;
  status: string; // active | retired
  createdAtMs: number;
  expiresAtMs: number;
  lastConfirmedAtMs: number | null;
}

export type HazardState = "active" | "expired" | "retired";

/** Where a hazard stands right now. Retired outranks expired. */
export function hazardState(h: HazardRow, nowMs: number): HazardState {
  if (h.status === "retired" || h.goneCount >= HAZARD_GONE_VOTES_TO_RETIRE) return "retired";
  if (nowMs >= h.expiresAtMs) return "expired";
  return "active";
}

/** Whether the hazard shows to other drivers right now. */
export function hazardIsLive(h: HazardRow, nowMs: number): boolean {
  return hazardState(h, nowMs) === "active";
}

/** The stored fields for a brand-new report: a 2-hour window. */
export function newHazardWindow(nowMs: number): { createdAtMs: number; expiresAtMs: number } {
  return { createdAtMs: nowMs, expiresAtMs: nowMs + HAZARD_TTL_MS };
}

export interface HazardStillThereResult {
  applied: boolean;
  reason: string | null;
  expiresAtMs: number;
  confirmCount: number;
}

/** "Still there": extends a LIVE hazard by a fresh 2 hours from the
 *  confirmation and counts it. An expired or retired hazard is not
 *  revived — a driver at a live hazard with no live report drops a
 *  fresh one instead. */
export function applyHazardStillThere(h: HazardRow, nowMs: number): HazardStillThereResult {
  const state = hazardState(h, nowMs);
  if (state !== "active") {
    return {
      applied: false,
      reason:
        state === "retired"
          ? "That hazard was marked gone and retired — it no longer shows."
          : "That report already expired — drop a fresh hazard report if it's still there.",
      expiresAtMs: h.expiresAtMs,
      confirmCount: h.confirmCount,
    };
  }
  return { applied: true, reason: null, expiresAtMs: nowMs + HAZARD_TTL_MS, confirmCount: h.confirmCount + 1 };
}

export interface HazardGoneResult {
  applied: boolean;
  retired: boolean;
  reason: string | null;
  goneCount: number;
}

/** "Gone": the reporter's own verdict retires the hazard at once;
 *  anyone else's vote counts toward the two-vote retirement line. */
export function applyHazardGone(h: HazardRow, voter: string | null, nowMs: number): HazardGoneResult {
  const state = hazardState(h, nowMs);
  if (state !== "active") {
    return {
      applied: false,
      retired: state === "retired",
      reason: state === "retired" ? "That hazard is already retired." : "That report already expired — nothing to retire.",
      goneCount: h.goneCount,
    };
  }
  const ownReport = voter != null && h.reporter != null && voter === h.reporter;
  const goneCount = ownReport ? HAZARD_GONE_VOTES_TO_RETIRE : h.goneCount + 1;
  return { applied: true, retired: goneCount >= HAZARD_GONE_VOTES_TO_RETIRE, reason: null, goneCount };
}

/** Great-circle distance in miles (the server copy — this module
 *  stays dependency-free for tests). */
export function hazardHaversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Whether a vote from this GPS position counts for this hazard. */
export function hazardVoteInRange(h: HazardRow, lat: number, lon: number): boolean {
  return hazardHaversineMi(lat, lon, h.lat, h.lon) <= HAZARD_VOTE_RADIUS_MI;
}
