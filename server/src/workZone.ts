// Driver-reported construction work zones — the pure lifecycle rules
// behind the work_zones table (migration 0106, x's order 2026-11-08).
//
// Framework-free (no DB, no DOM), like weighStation.ts, so the exact
// production rules are unit-testable (see workZone.test.ts). The
// actions in actions.ts own the rows; every decision about whether a
// zone is live, extended, or retired is made HERE.
//
// THE RULES (the build brief, verbatim law):
//   - A report lives 12 HOURS from when it was dropped.
//   - "Still there" from a driver at the zone extends it: a fresh
//     12 hours from the confirmation, and the confirmation counts.
//   - Reports auto-expire at the end of their window unless
//     re-confirmed — an expired zone is never served as live.
//   - "Gone" retires a zone: immediately when the zone's own
//     reporter says it, otherwise once a SECOND independent driver
//     confirms it's gone (one stray tap never kills another
//     driver's live warning).
//   - Every vote (Still there / Gone) is GPS-checked server-side:
//     the voter's own position must be within VOTE_RADIUS_MI of the
//     zone — you can only judge a work zone you're actually at.
//
// Official DOT zones never enter this lifecycle: they come from the
// state's published WZDx feed (wzdx.ts), carry their own start/end
// dates, and are labelled "DOT reported" wherever they show.

/** How long a driver report lives without re-confirmation: 12 hours. */
export const WORK_ZONE_TTL_MS = 12 * 3600_000;

/** "Gone" votes from independent drivers needed to retire a zone
 *  (the reporter's own Gone retires at once — see applyGone). */
export const WORK_ZONE_GONE_VOTES_TO_RETIRE = 2;

/** A Still-there / Gone vote counts only from a driver whose GPS is
 *  within this distance of the zone — work zones are places you
 *  judge by being there, and a zone's pin sits at its near edge. */
export const WORK_ZONE_VOTE_RADIUS_MI = 1.0;

export interface WorkZoneRow {
  id: number;
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

export type WorkZoneState = "active" | "expired" | "retired";

/** Where a zone stands right now. Retired (an explicit Gone verdict)
 *  outranks expired (the clock) — the displays word them alike
 *  ("no longer shown"), but the record keeps the difference. */
export function workZoneState(zone: WorkZoneRow, nowMs: number): WorkZoneState {
  if (zone.status === "retired" || zone.goneCount >= WORK_ZONE_GONE_VOTES_TO_RETIRE) return "retired";
  if (nowMs >= zone.expiresAtMs) return "expired";
  return "active";
}

/** Whether the zone shows to other drivers right now. */
export function workZoneIsLive(zone: WorkZoneRow, nowMs: number): boolean {
  return workZoneState(zone, nowMs) === "active";
}

/** The stored fields for a brand-new report: a 12-hour window from
 *  the drop, no votes yet. */
export function newWorkZoneWindow(nowMs: number): { createdAtMs: number; expiresAtMs: number } {
  return { createdAtMs: nowMs, expiresAtMs: nowMs + WORK_ZONE_TTL_MS };
}

export interface StillThereResult {
  applied: boolean;
  reason: string | null;
  /** The zone's new expiry when applied (a fresh 12h from now). */
  expiresAtMs: number;
  confirmCount: number;
}

/** "Still there": extends a LIVE zone by a fresh 12 hours from the
 *  confirmation and counts the confirmation. An expired or retired
 *  zone is not revived by a vote — a driver at a live zone with no
 *  live report drops a fresh one instead. */
export function applyStillThere(zone: WorkZoneRow, nowMs: number): StillThereResult {
  const state = workZoneState(zone, nowMs);
  if (state !== "active") {
    return {
      applied: false,
      reason:
        state === "retired"
          ? "That work zone was marked gone and retired — it no longer shows."
          : "That report already expired — drop a fresh construction report if the zone is still active.",
      expiresAtMs: zone.expiresAtMs,
      confirmCount: zone.confirmCount,
    };
  }
  return {
    applied: true,
    reason: null,
    expiresAtMs: nowMs + WORK_ZONE_TTL_MS,
    confirmCount: zone.confirmCount + 1,
  };
}

export interface GoneResult {
  applied: boolean;
  retired: boolean;
  reason: string | null;
  goneCount: number;
}

/** "Gone": the reporter's own verdict retires the zone at once;
 *  anyone else's vote counts toward the two-vote retirement line.
 *  Voting on an already-dead zone changes nothing. */
export function applyGone(
  zone: WorkZoneRow,
  voter: string | null,
  nowMs: number,
): GoneResult {
  const state = workZoneState(zone, nowMs);
  if (state !== "active") {
    return {
      applied: false,
      retired: state === "retired",
      reason:
        state === "retired"
          ? "That work zone is already retired."
          : "That report already expired — nothing to retire.",
      goneCount: zone.goneCount,
    };
  }
  const ownReport = voter != null && zone.reporter != null && voter === zone.reporter;
  const goneCount = ownReport ? WORK_ZONE_GONE_VOTES_TO_RETIRE : zone.goneCount + 1;
  return {
    applied: true,
    retired: goneCount >= WORK_ZONE_GONE_VOTES_TO_RETIRE,
    reason: null,
    goneCount,
  };
}

/** Great-circle distance in miles (the server copy — actions.ts has
 *  its own; this module stays dependency-free for tests). */
export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Whether a vote from this GPS position counts for this zone. */
export function voteInRange(zone: WorkZoneRow, lat: number, lon: number): boolean {
  return haversineMi(lat, lon, zone.lat, zone.lon) <= WORK_ZONE_VOTE_RADIUS_MI;
}
