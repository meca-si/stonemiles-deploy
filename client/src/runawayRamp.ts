// Runaway ramp alerts — the rider on the hill grade engine
// (migration 0107, x's order 2026-11-08: "Build all five").
//
// Pure and framework-free (no DOM, no React), like hillGrade.ts, so
// the exact production behavior is unit-testable (see
// runawayRamp.test.ts).
//
// DATA HONESTY — the Atlas standard, absolute here: ramp locations
// come from OpenStreetMap escape-ramp data (ways/nodes the map tags
// as runaway truck ramps), fetched by the same Overpass pass as the
// hazards and cached on-device per area like the traffic signals.
// Where ramp data for a descent doesn't exist, this engine answers
// "no ramp" and the UI shows NOTHING — a ramp is never guessed,
// interpolated, or invented. A driver who needs a ramp needs a real
// one.
//
// The alert is a RIDER on the grade engine: it only speaks while
// the truck is approaching or on a DOWNGRADE segment from
// hillGrade.ts. A ramp beside a climb, or on flat ground, is map
// data — it is never called as an escape option.

import { projectOntoRoute } from "./routeGeometry";
import type { GradeSegment } from "./hillGrade";

export interface EscapeRamp {
  /** Stable id from the map data ("ramp-<osm id>"). */
  id: string;
  lat: number;
  lon: number;
}

/** The Overpass element shape the ramp parse reads. Escape ramps
 *  are usually drawn as short ways (highway=escape); some are nodes. */
export interface RampElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** OSM tags a runaway truck escape ramp: highway=escape is the
 *  established tag; emergency=escape_ramp appears too. Both are
 *  map-data claims about a real ramp — nothing else counts. */
function isRampTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  return tags.highway === "escape" || tags.emergency === "escape_ramp";
}

/** Parse Overpass elements into escape ramps. Ways resolve to the
 *  END of the ramp way nearest its start junction — approximated by
 *  the geometry midpoint, which is where the ramp bed sits; nodes
 *  use their own coordinates. Duplicates collapse. */
export function parseEscapeRamps(elements: RampElement[] | null | undefined): EscapeRamp[] {
  if (!Array.isArray(elements)) return [];
  const seen = new Set<string>();
  const out: EscapeRamp[] = [];
  for (const el of elements) {
    if (!isRampTags(el.tags)) continue;
    let lat: number | null = null;
    let lon: number | null = null;
    if (el.type === "node" && el.lat != null && el.lon != null) {
      lat = el.lat;
      lon = el.lon;
    } else if (el.geometry && el.geometry.length > 0) {
      const mid = el.geometry[Math.floor(el.geometry.length / 2)]!;
      lat = mid.lat;
      lon = mid.lon;
    }
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `ramp-${el.type}-${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, lat, lon });
  }
  return out;
}

/** A ramp counts as on the descent within this distance of the
 *  route line. */
export const RAMP_ON_ROUTE_MI = 0.3;
/** The call fires when a ramp on the active descent comes within
 *  this distance ahead — early enough to aim for it. */
export const RAMP_ALERT_MI = 1.0;

export type RampSide = "left" | "right";

export interface RampAhead {
  ramp: EscapeRamp;
  /** Miles from the truck's route position to the ramp. */
  distAheadMi: number;
  /** Which side of the road the ramp leaves from, when the map
   *  geometry says so; null when the offset is too small to call. */
  side: RampSide | null;
  /** The downgrade segment the ramp serves. */
  segment: GradeSegment;
}

/**
 * The nearest escape ramp ahead ON the active (or next, inside its
 * advance zone) DOWNGRADE — or null. The grade discipline is the
 * whole feature: no downgrade at the truck's position, no call,
 * however close a ramp pin sits. Ramps behind the truck, off the
 * line, or past the end of the descent never fire.
 */
export function rampAheadOnDescent(
  ramps: EscapeRamp[],
  coords: [number, number][] | null | undefined,
  progressMi: number,
  segments: GradeSegment[],
): RampAhead | null {
  if (!coords || coords.length < 2 || !Number.isFinite(progressMi)) return null;
  // The descent that matters: the segment the truck is on, or the
  // next downgrade whose start is within a mile (the grade banner's
  // own approach territory — the ramp call rides the same moment).
  let seg: GradeSegment | null = null;
  for (const s of segments) {
    if (s.direction !== "down") continue;
    if (progressMi >= s.startMi && progressMi <= s.endMi) {
      seg = s;
      break;
    }
    if (s.startMi > progressMi && s.startMi - progressMi <= RAMP_ALERT_MI) {
      seg = s;
      break;
    }
  }
  if (!seg) return null;
  let best: RampAhead | null = null;
  for (const r of ramps) {
    const proj = projectOntoRoute({ lat: r.lat, lon: r.lon }, coords);
    if (proj.offMi > RAMP_ON_ROUTE_MI) continue;
    if (proj.alongMi < seg.startMi - 0.05 || proj.alongMi > seg.endMi + 0.05) continue;
    const dist = proj.alongMi - progressMi;
    if (dist <= 0.02 || dist > RAMP_ALERT_MI) continue;
    // Side from the cross-track sign: offset of the ramp from its
    // snapped point on the line, against the segment's bearing.
    let side: RampSide | null = null;
    if (proj.bearingDeg != null && proj.offMi >= 0.01) {
      const b = (proj.bearingDeg * Math.PI) / 180;
      const dirX = Math.sin(b);
      const dirY = Math.cos(b);
      const offX = (r.lon - proj.snapped.lon) * Math.cos((r.lat * Math.PI) / 180);
      const offY = r.lat - proj.snapped.lat;
      const cross = dirX * offY - dirY * offX;
      side = cross < 0 ? "right" : "left";
    }
    if (!best || dist < best.distAheadMi) best = { ramp: r, distAheadMi: dist, side, segment: seg };
  }
  return best;
}

/** Distance text the way the banner says it: "0.4 miles". */
export function fmtRampDist(distMi: number): string {
  return `${(Math.round(distMi * 10) / 10).toFixed(1)} miles`;
}

/** The banner headline: "RUNAWAY RAMP — 0.4 MI, RIGHT SIDE". */
export function rampHeadline(ahead: RampAhead): string {
  const d = (Math.round(ahead.distAheadMi * 10) / 10).toFixed(1);
  return ahead.side ? `RUNAWAY RAMP — ${d} MI, ${ahead.side.toUpperCase()} SIDE` : `RUNAWAY RAMP — ${d} MI`;
}

/** The spoken call — the brief's own words. */
export function rampSpoken(ahead: RampAhead): string {
  return ahead.side
    ? `Runaway ramp. ${fmtRampDist(ahead.distAheadMi)}, ${ahead.side} side.`
    : `Runaway ramp. ${fmtRampDist(ahead.distAheadMi)} ahead.`;
}
