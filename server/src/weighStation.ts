/**
 * Weigh-station crowd-sourced status — server-side pure rules
 * (migration 0092, x's order 2026-11-02: "on the gps can we add when
 * approaching weight stations a prompt of open n close pop up to
 * update status").
 *
 * Stations are OpenStreetMap POIs the client discovers through the
 * existing hazard layer (stable id "weigh-<osm node id>"); status is
 * crowd-sourced from drivers who actually roll up on them. This
 * module owns the honesty rules, framework-free so they are
 * unit-testable (weighStation.test.ts); actions.ts owns the DB.
 *
 * - FRESH (60 min): a status reported within the last hour is fresh —
 *   the client shows it on the station's alert line and does NOT
 *   prompt approaching drivers for a new one.
 * - STALE (4 h): a status older than four hours renders as UNKNOWN
 *   again everywhere. The stored row is never rewritten — staleness
 *   is a read-time rule, so the last report stays on the record.
 * - VERIFIED: a report earns road-intel points only when the
 *   reporter's own GPS sits inside the verification radius below.
 *   An unverified report still updates the station's status — it
 *   just earns nothing and is marked unverified on the report log.
 * - STATION HERE (x's follow-up order, 2026-11-02): a driver standing
 *   at a station that is not on the map can add it in two taps. The
 *   save is GPS-verified by definition (the driver is standing
 *   there), so creation pays through the same road-intel path as a
 *   verified report. Dedupe: a tap within 0.3 mi of a station that
 *   already exists (OSM or driver-added) is a status report on THAT
 *   station, never a second station — which is also what makes the
 *   creation reward land exactly once per location.
 */

export type WeighStatusValue = "open" | "closed";
export type WeighEffectiveStatus = WeighStatusValue | "unknown";

/** The approach zone: the prompt fires at 0.7 mi ahead (x's order
 *  2026-11-02, down from ~2 mi). Client mirror: WEIGH_TRIGGER_MI. */
export const WEIGH_APPROACH_MI = 0.7;
/** GPS-verification radius for awarding road-intel points.
 *  DELIBERATELY decoupled from the prompt distance: it was 2.5 mi
 *  when the prompt fired at ~2 mi, and it does NOT shrink with the
 *  0.7 mi prompt — verification proved a paid report at 1.5 mi, and
 *  the wider zone absorbs the lag between the prompt firing and the
 *  driver tapping an answer. */
export const WEIGH_VERIFY_RADIUS_MI = 2.5;
/** Station-here dedupe radius (miles). */
export const WEIGH_DEDUPE_MI = 0.3;
/** A status younger than this is fresh — no prompt, just display. */
export const WEIGH_FRESH_MS = 60 * 60_000;
/** A status older than this renders as unknown again. */
export const WEIGH_STALE_MS = 4 * 60 * 60_000;

/** The status a station shows right now: the stored value while it
 *  is inside the 4-hour honesty window, "unknown" before the first
 *  report and after the window closes. */
export function effectiveWeighStatus(
  status: string | null | undefined,
  updatedAtMs: number | null | undefined,
  nowMs: number,
): WeighEffectiveStatus {
  if (status !== "open" && status !== "closed") return "unknown";
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return "unknown";
  if (nowMs - updatedAtMs > WEIGH_STALE_MS) return "unknown";
  if (updatedAtMs - nowMs > WEIGH_STALE_MS) return "unknown"; // clock skew guard
  return status;
}

/** True while a status is fresh enough that approaching drivers
 *  should NOT be prompted for a new report (under 60 minutes old). */
export function weighStatusIsFresh(
  status: string | null | undefined,
  updatedAtMs: number | null | undefined,
  nowMs: number,
): boolean {
  if (effectiveWeighStatus(status, updatedAtMs, nowMs) === "unknown") return false;
  if (updatedAtMs == null) return false;
  return nowMs - updatedAtMs < WEIGH_FRESH_MS;
}

/** Whether a report at this driver↔station distance (miles) counts
 *  as GPS-verified — the driver was actually in the approach zone. */
export function weighReportVerified(distanceMi: number): boolean {
  return Number.isFinite(distanceMi) && distanceMi >= 0 && distanceMi <= WEIGH_VERIFY_RADIUS_MI;
}

/** Whole minutes since the last report, floored at 0. */
export function weighStatusAgeMin(updatedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - updatedAtMs) / 60000));
}

export type LatLon = { lat: number; lon: number };

/** Great-circle distance in miles (server twin of the client's). */
export function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type StationHereCandidate = LatLon & { stationId: string };

export type StationHerePlan =
  | { kind: "create" }
  | { kind: "update"; stationId: string; distanceMi: number };

/**
 * The Station-here save decision: if any existing station (OSM or
 * driver-added — the caller passes the whole known universe) sits
 * within the dedupe radius of the tap position, the flow is a status
 * UPDATE on the nearest such station; otherwise it CREATES a new
 * driver-reported station at the tap position. The create branch is
 * the only one that can pay a creation reward, so one location can
 * never earn it twice.
 */
export function planStationHereReport(
  candidates: readonly StationHereCandidate[],
  tap: LatLon,
): StationHerePlan {
  let best: { stationId: string; distanceMi: number } | null = null;
  for (const c of candidates) {
    const d = haversineMi(tap, c);
    if (d <= WEIGH_DEDUPE_MI && (!best || d < best.distanceMi)) {
      best = { stationId: c.stationId, distanceMi: d };
    }
  }
  return best ? { kind: "update", stationId: best.stationId, distanceMi: best.distanceMi } : { kind: "create" };
}

/**
 * Station-here dedupe never lands on a RETIRED place (migration
 * 0094): a spot two drivers marked "Not here" (or its creator
 * deleted) is out of the universe — a fresh Station-here tap near
 * it creates a new station instead of resurrecting the retired one
 * with a status update.
 */
export function excludeRetiredCandidates<T extends { stationId: string }>(
  candidates: readonly T[],
  retiredPlaceIds: ReadonlySet<string>,
): T[] {
  return candidates.filter((c) => !retiredPlaceIds.has(c.stationId));
}

// ---------- "Not here" place corrections (migration 0094) ------------------
// X's order (2026-11-03), from a bogus weigh-station spot sitting in
// a residential neighborhood near Government Blvd, Mobile: every
// road-intel place needs a way to say "this isn't here." The rules:
//
// - A mark ALWAYS hides the spot for the marking driver,
//   immediately and permanently (per-driver hide, persisted).
// - A mark by the spot's CREATOR deletes the spot outright for
//   everyone (driver-owned rows are deleted; the tombstone keeps
//   the history).
// - Otherwise, when the mark is the SECOND independent driver's
//   (two distinct reporters total), the spot is RETIRED for
//   everyone: kept in history as retired, never rendered, never
//   prompted.
// - The same driver marking twice never counts twice — distinct
//   reporters are what the threshold counts.
// - No points move in either direction: road-intel point values
//   are still un-locked, and a correction is not an earn event.
//
// The client mirror lives in client/src/weighStation.ts; both sides
// plan the same outcome from the same inputs.

/** Independent drivers' marks needed to retire a spot for everyone. */
export const NOT_HERE_RETIRE_THRESHOLD = 2;

export type NotHereOutcome = "hidden" | "deleted" | "retired";

export type NotHerePlan = {
  outcome: NotHereOutcome;
  /** Distinct reporters who will have marked the spot, this mark
   *  included (an idempotent re-mark does not grow the count). */
  distinctReporters: number;
  /** True when this driver already marked this spot — the mark is
   *  a no-op beyond the hide they already have. */
  alreadyMarked: boolean;
};

/** The unified place-kind for a road-intel place id. */
export function roadPlaceKindForId(placeId: string): "weigh_station" | "driver_weigh_station" | "intel_report" | "place" {
  if (placeId.startsWith("driver-")) return "driver_weigh_station";
  if (placeId.startsWith("intel-")) return "intel_report";
  if (placeId.startsWith("weigh-")) return "weigh_station";
  return "place";
}

/** The numeric intel-report id inside an "intel-<id>" place id, or
 *  null for any other place id / a malformed one. */
export function intelReportIdForPlaceId(placeId: string): number | null {
  if (!placeId.startsWith("intel-")) return null;
  const n = Number(placeId.slice("intel-".length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function planNotHereCorrection(input: {
  reporter: string;
  /** Username of the driver who created the spot, or null when the
   *  spot has no known creator (OpenStreetMap stations, legacy
   *  intel reports filed before creators were recorded). */
  creator: string | null;
  /** Distinct usernames who already marked this spot Not here. */
  existingReporters: readonly string[];
}): NotHerePlan {
  const existing = new Set(input.existingReporters);
  if (existing.has(input.reporter)) {
    return { outcome: "hidden", distinctReporters: existing.size, alreadyMarked: true };
  }
  const distinctReporters = existing.size + 1;
  if (input.creator != null && input.creator === input.reporter) {
    return { outcome: "deleted", distinctReporters, alreadyMarked: false };
  }
  if (distinctReporters >= NOT_HERE_RETIRE_THRESHOLD) {
    return { outcome: "retired", distinctReporters, alreadyMarked: false };
  }
  return { outcome: "hidden", distinctReporters, alreadyMarked: false };
}

/** True when a place must not render or prompt for this driver:
 *  they hid it themselves, or it is retired for everyone. */
export function isPlaceSuppressedForDriver(
  placeId: string,
  hiddenPlaceIds: ReadonlySet<string>,
  retiredPlaceIds: ReadonlySet<string>,
): boolean {
  return hiddenPlaceIds.has(placeId) || retiredPlaceIds.has(placeId);
}
