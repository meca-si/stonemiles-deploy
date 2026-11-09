// Railroad crossing alerts + the high-center warning (migration
// 0107, x's order 2026-11-08: "Build all five").
//
// Pure and framework-free (no DOM, no React), like hillGrade.ts, so
// the exact production behavior is unit-testable (see
// railCrossings.test.ts).
//
// Crossing LOCATIONS come from real inventory data, never guesses:
//   - OpenStreetMap railway=level_crossing nodes, fetched by the
//     same Overpass pass as the hazards — THE LIVE CHANNEL in this
//     build (the same crossing locations the federal inventory
//     tracks), and
//   - the federal FRA Grade Crossing Inventory (the free national
//     dataset — records carry the crossing's position and, where
//     the railroad reported it, its vertical profile), parsed by
//     parseFraCrossings below for when inventory records are
//     loaded into the same RailCrossing shape.
// HIGH-CENTER DISCIPLINE (absolute): the "humped crossing" call
// fires ONLY where crossing profile data actually says the
// crossing is humped (an FRA profile record). Where the profile is
// unknown — every OSM-only crossing today — the plain crossing
// alert shows WITHOUT the high-center claim. A hang-up warning
// invented from no data would be worse than none.

import { projectOntoRoute } from "./routeGeometry";

export interface RailCrossing {
  /** "fra-<crossing number>" or "osm-xing-<node id>". */
  id: string;
  lat: number;
  lon: number;
  /** True ONLY when profile data says this crossing is humped.
   *  False when data says it isn't; null when the profile is
   *  unknown (the common case) — null never claims. */
  humped: boolean | null;
  source: "fra" | "osm";
}

/** The Overpass element shape the crossing parse reads. */
export interface CrossingElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

/** Parse Overpass elements into crossings. Only nodes actually
 *  tagged railway=level_crossing count. OSM carries no vertical
 *  profile, so humped is null — unknown, never claimed. */
export function parseOsmCrossings(elements: CrossingElement[] | null | undefined): RailCrossing[] {
  if (!Array.isArray(elements)) return [];
  const seen = new Set<number>();
  const out: RailCrossing[] = [];
  for (const el of elements) {
    if (el.type !== "node") continue;
    if (el.tags?.railway !== "level_crossing") continue;
    if (el.lat == null || el.lon == null || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    out.push({ id: `osm-xing-${el.id}`, lat: el.lat, lon: el.lon, humped: null, source: "osm" });
  }
  return out;
}

/** One row of the FRA Grade Crossing Inventory (the fields this
 *  app reads from the free federal dataset). */
export interface FraCrossingRecord {
  crossingId: string;
  lat: number;
  lon: number;
  /** The inventory's vertical-profile description for the
   *  crossing, when the railroad reported one. */
  profile?: string | null;
}

/** Whether an FRA profile description says the crossing is humped
 *  (a raised, crowned profile a long low trailer can hang up on). */
export function fraProfileHumped(profile: string | null | undefined): boolean | null {
  if (profile == null) return null;
  const p = profile.trim().toLowerCase();
  if (p === "") return null;
  if (/hump/.test(p)) return true;
  if (/level|flat|depress|sag/.test(p)) return false;
  return null;
}

/** Parse FRA inventory records into crossings, profile included. */
export function parseFraCrossings(records: FraCrossingRecord[] | null | undefined): RailCrossing[] {
  if (!Array.isArray(records)) return [];
  const out: RailCrossing[] = [];
  for (const r of records) {
    if (!r.crossingId || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    out.push({ id: `fra-${r.crossingId}`, lat: r.lat, lon: r.lon, humped: fraProfileHumped(r.profile), source: "fra" });
  }
  return out;
}

/** The advance-call distance before a crossing. */
export const CROSSING_ALERT_MI = 0.5;
/** A crossing counts as on the route within this distance. */
export const CROSSING_ON_ROUTE_MI = 0.15;

export interface CrossingAhead {
  crossing: RailCrossing;
  distAheadMi: number;
  /** The high-center warning applies: profile data says humped
   *  AND this rig is a long, low trailer (step-deck / lowboy). */
  highCenter: boolean;
}

/**
 * The nearest crossing ahead on the route inside the alert
 * distance, or null. highCenter is set ONLY from data + rig:
 * humped === true (never null/false) and a long, low trailer.
 */
export function crossingAhead(
  crossings: RailCrossing[],
  coords: [number, number][] | null | undefined,
  progressMi: number,
  rig: { lowLongTrailer: boolean },
): CrossingAhead | null {
  if (!coords || coords.length < 2 || !Number.isFinite(progressMi)) return null;
  let best: CrossingAhead | null = null;
  for (const c of crossings) {
    const proj = projectOntoRoute({ lat: c.lat, lon: c.lon }, coords);
    if (proj.offMi > CROSSING_ON_ROUTE_MI) continue;
    const dist = proj.alongMi - progressMi;
    if (dist <= 0.02 || dist > CROSSING_ALERT_MI) continue;
    const highCenter = c.humped === true && rig.lowLongTrailer;
    if (!best || dist < best.distAheadMi) best = { crossing: c, distAheadMi: dist, highCenter };
  }
  return best;
}

/** The banner headline. The humped call names the risk plainly;
 *  an unknown-profile crossing NEVER gets this line. */
export function crossingHeadline(ahead: CrossingAhead): string {
  return ahead.highCenter ? "HUMPED CROSSING — HIGH-CENTER RISK" : "RAILROAD CROSSING AHEAD";
}

/** The spoken call — the brief's own words. */
export function crossingSpoken(ahead: CrossingAhead): string {
  return ahead.highCenter
    ? "Humped crossing ahead. High-center risk for your trailer. Approach slow and square."
    : "Railroad crossing ahead.";
}
